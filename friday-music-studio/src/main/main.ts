// Electron main process: window, protocols, validated IPC, render worker.

import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell, utilityProcess, type IpcMainInvokeEvent, type UtilityProcess } from 'electron';
import { execFile } from 'node:child_process';
import { createReadStream, promises as fs, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { channels, EVENT_JOBS_CHANGED, EVENT_RENDER_PROGRESS, type Channel, type ChannelInput, type IpcResult } from '../shared/ipc';
import type { RenderProgressEvent } from '../shared/types';
import { Store } from './db';
import { redact, redactError } from './redact';
import { checkFfmpeg } from './render/ffmpeg';
import type { WorkerOutMsg } from './render/worker';
import { IMPORT_EXTENSIONS, StudioService } from './studio';

const APP_SCHEME = 'fms-app';
const MEDIA_SCHEME = 'fms-media';
const DEV_URL = !app.isPackaged ? process.env.FMS_DEV_SERVER_URL : undefined;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
// Containers that run as root cannot use Chromium's OS sandbox. Dev/CI escape
// hatch only; ignored in packaged builds. Renderers keep sandbox: true either way.
if (!app.isPackaged && process.env.FMS_NO_CHROMIUM_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox');
else app.enableSandbox();

const dataDir = process.env.FMS_DATA_DIR ? path.resolve(process.env.FMS_DATA_DIR) : app.getPath('userData');
mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
const logFile = path.join(dataDir, 'logs', 'main.log');
function log(level: 'info' | 'warn' | 'error', msg: string) {
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${level} ${redact(msg)}\n`);
  } catch {
    /* logging must never crash the app */
  }
}

let studio: StudioService;
let mainWindow: BrowserWindow | null = null;

// ---------- protocols ----------

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${MEDIA_SCHEME}:`,
  `media-src ${MEDIA_SCHEME}:`,
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const RENDERER_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

async function serveFile(file: string, mime: string, request: Request, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const { size } = await fs.stat(file);
  const range = request.headers.get('range');
  const base = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', ...extraHeaders };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    start = Math.max(0, start);
    end = Math.max(start, end);
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, 'Content-Length': String(size) } });
}

function registerProtocols() {
  const rendererRoot = path.join(__dirname, '..', 'renderer');
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'bundle') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(rendererRoot, `.${rel}`);
    if (!file.startsWith(path.resolve(rendererRoot) + path.sep)) return new Response('Forbidden', { status: 403 });
    try {
      return await serveFile(file, RENDERER_MIME[path.extname(file)] ?? 'application/octet-stream', request, { 'Content-Security-Policy': CSP });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  // fms-media://asset/<id> and fms-media://render/<id>: looked up by ID, never by path.
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const id = url.pathname.replace(/^\//, '');
      if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Bad request', { status: 400 });
      if (url.host === 'asset') {
        const a = studio.store.getAssetPath(id);
        if (!a) return new Response('Not found', { status: 404 });
        return await serveFile(studio.assertInsideData(a.storedPath), a.asset.mime, request);
      }
      if (url.host === 'render') {
        const r = studio.store.getRender(id);
        if (!r) return new Response('Not found', { status: 404 });
        return await serveFile(studio.assertInsideData(r.storedPath), 'video/mp4', request);
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      log('warn', `media protocol: ${redactError(err)}`);
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- IPC ----------

function isTrustedSender(e: IpcMainInvokeEvent): boolean {
  const url = e.senderFrame?.url ?? '';
  if (url.startsWith(`${APP_SCHEME}://bundle/`)) return true;
  return !!DEV_URL && url.startsWith(DEV_URL);
}

function handle<C extends Channel>(channel: C, fn: (input: ChannelInput<C>) => unknown) {
  ipcMain.handle(channel, async (e, raw): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(e)) {
      log('warn', `rejected IPC ${channel} from untrusted frame`);
      return { ok: false, error: 'Request rejected.' };
    }
    const parsed = channels[channel].safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: `Invalid request${issue ? `: ${issue.path.join('.') || 'input'} ${issue.message}` : ''}` };
    }
    try {
      return { ok: true, data: await fn(parsed.data as ChannelInput<C>) };
    } catch (err) {
      const msg = redactError(err);
      log('error', `${channel}: ${msg}`);
      return { ok: false, error: msg };
    }
  });
}

function broadcast(channel: string, payload?: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

// ---------- render worker ----------

let worker: UtilityProcess | null = null;
const activeRenders = new Map<string, string>(); // jobId -> projectId

function emitRender(jobId: string, projectId: string, status: RenderProgressEvent['status'], progress: number, error: string | null) {
  broadcast(EVENT_RENDER_PROGRESS, { jobId, projectId, status, progress, error } satisfies RenderProgressEvent);
}

function getWorker(): UtilityProcess {
  if (worker) return worker;
  const w = utilityProcess.fork(path.join(__dirname, 'render-worker.js'), [], { serviceName: 'friday-render-worker', stdio: 'ignore' });
  w.on('message', (msg: WorkerOutMsg) => void onWorkerMessage(msg));
  w.on('exit', (code) => {
    worker = null;
    for (const [jobId, projectId] of activeRenders) {
      void studio.failRender(jobId, 'failed', `Render worker exited unexpectedly (code ${code}).`).then(() => {
        emitRender(jobId, projectId, 'failed', 0, 'Render worker exited unexpectedly.');
        broadcast(EVENT_JOBS_CHANGED);
      });
    }
    activeRenders.clear();
  });
  worker = w;
  return w;
}

async function onWorkerMessage(msg: WorkerOutMsg) {
  const projectId = activeRenders.get(msg.jobId);
  if (!projectId) return;
  try {
    if (msg.type === 'progress') {
      studio.store.updateJob(msg.jobId, { progress: msg.progress });
      emitRender(msg.jobId, projectId, 'running', msg.progress, null);
      return;
    }
    activeRenders.delete(msg.jobId);
    if (msg.type === 'done') {
      await studio.finishRender(msg.jobId, msg.result);
      emitRender(msg.jobId, projectId, 'succeeded', 1, null);
      log('info', `render ${msg.jobId} verified ${msg.result.sizeBytes} bytes`);
    } else if (msg.type === 'cancelled') {
      await studio.failRender(msg.jobId, 'cancelled', null);
      emitRender(msg.jobId, projectId, 'cancelled', 0, null);
    } else {
      const job = await studio.failRender(msg.jobId, 'failed', msg.message);
      emitRender(msg.jobId, projectId, 'failed', 0, job.error);
      log('error', `render ${msg.jobId}: ${job.error}`);
    }
  } catch (err) {
    log('error', `render bookkeeping: ${redactError(err)}`);
  }
  broadcast(EVENT_JOBS_CHANGED);
}

// ---------- handlers ----------

function checkFfprobe(p: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile(p, ['-version'], { shell: false, timeout: 15_000 }, (err, out) => resolve(!err && out.startsWith('ffprobe version'))),
  );
}

function registerHandlers() {
  handle('dashboard:get', () => studio.dashboard());
  handle('projects:list', () => studio.store.listProjects());
  handle('projects:get', ({ projectId }) => studio.getDetail(projectId));
  handle('projects:create', ({ title, artist }) => studio.createProject(title, artist));
  handle('projects:update', ({ projectId, patch }) => studio.updateProject(projectId, patch));
  handle('projects:archive', ({ projectId }) => studio.store.archiveProject(projectId));

  handle('assets:import', async ({ projectId, kind }) => {
    studio.requireProject(projectId);
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: `Import ${kind}`,
      properties: ['openFile'],
      filters: [{ name: kind, extensions: IMPORT_EXTENSIONS[kind] }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return studio.importAsset(projectId, kind, res.filePaths[0]);
  });

  handle('assets:importLogo', async ({ projectId }) => {
    studio.requireProject(projectId);
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose your logo (PNG with a transparent background works best)',
      properties: ['openFile'],
      filters: [{ name: 'image', extensions: IMPORT_EXTENSIONS.image }],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return studio.importLogo(projectId, res.filePaths[0]);
  });

  handle('assets:importPreset', ({ projectId, presetId }) => studio.importPreset(projectId, presetId));

  handle('cues:autoTime', ({ projectId, estimateMissing }) => studio.autoTimeCues(projectId, estimateMissing));
  handle('cues:save', ({ projectId, cues }) => studio.saveCues(projectId, cues));

  /** Renders that are still preparing (e.g. AI-upscaling the picture) and have not reached the worker yet. */
  const preparing = new Set<string>();

  handle('render:start', ({ projectId, quality, short }) => {
    const { job, spec } = studio.prepareRender(projectId, quality, short);
    activeRenders.set(job.id, projectId);
    preparing.add(job.id);
    studio.store.updateJob(job.id, { status: 'running' });
    emitRender(job.id, projectId, 'running', 0, null);
    broadcast(EVENT_JOBS_CHANGED);
    // The optional AI upscale can take about 30 s the first time; it must not block the window.
    void studio
      .applyUpscale(projectId, spec, quality)
      .catch(() => spec)
      .then((finalSpec) => {
        if (!preparing.delete(job.id)) return; // cancelled while preparing
        getWorker().postMessage({ type: 'start', jobId: job.id, spec: finalSpec });
      });
    return { jobId: job.id };
  });
  handle('render:cancel', async ({ jobId }) => {
    if (!activeRenders.has(jobId)) throw new Error('That render is not running.');
    if (preparing.delete(jobId)) {
      const projectId = activeRenders.get(jobId)!;
      activeRenders.delete(jobId);
      await studio.failRender(jobId, 'cancelled', null);
      emitRender(jobId, projectId, 'cancelled', 0, null);
      broadcast(EVENT_JOBS_CHANGED);
      return true;
    }
    worker?.postMessage({ type: 'cancel', jobId });
    return true;
  });
  handle('render:saveCopy', async ({ outputId }) => {
    const r = studio.store.getRender(outputId);
    if (!r) throw new Error('Render not found');
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: r.output.fileName, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] });
    if (res.canceled || !res.filePath) return null;
    await fs.copyFile(studio.assertInsideData(r.storedPath), res.filePath);
    return path.basename(res.filePath);
  });
  handle('render:reveal', ({ outputId }) => {
    const r = studio.store.getRender(outputId);
    if (!r) throw new Error('Render not found');
    shell.showItemInFolder(studio.assertInsideData(r.storedPath));
    return true;
  });

  handle('mix:analyze', ({ projectIds }) => studio.analyzeSongs(projectIds));
  handle('mix:pickPicture', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { title: 'Choose the picture for the mix', properties: ['openFile'], filters: [{ name: 'image', extensions: IMPORT_EXTENSIONS.image }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return studio.holdMixPicture(res.filePaths[0]);
  });
  handle('mix:create', ({ title, projectIds, crossfadeMs, auto, matchTempo, picture }) => studio.createMix(title, projectIds, { crossfadeMs, auto, matchTempo, picture }));
  handle('mix:get', ({ projectId }) => studio.mixInfo(projectId));
  handle('audio:peaks', ({ projectId }) => studio.songPeaks(projectId));
  handle('library:get', () => ({ dir: studio.libraryDir() }));
  handle('library:open', async () => {
    const dir = studio.libraryDir();
    await fs.mkdir(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
    return true;
  });
  handle('library:pick', async () => {
    const res = await dialog.showOpenDialog(mainWindow!, { title: 'Choose the folder for finished videos', properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    studio.updateSettings({ libraryDir: res.filePaths[0] });
    await studio.syncLibrary();
    return { dir: studio.libraryDir() };
  });

  handle('jobs:list', ({ projectId }) => studio.store.listJobs(projectId));
  handle('providers:list', () => studio.listProviders());
  handle('generation:prepare', ({ projectId, providerId }) => studio.prepareGeneration(projectId, providerId));
  handle('generation:approveAndSubmit', async ({ projectId, token }) => {
    const job = await studio.approveAndSubmitGeneration(projectId, token);
    broadcast(EVENT_JOBS_CHANGED);
    return job;
  });
  handle('generation:refresh', async ({ jobId }) => {
    const job = await studio.refreshGeneration(jobId);
    broadcast(EVENT_JOBS_CHANGED);
    return job;
  });
  handle('review:approveFinal', ({ projectId, outputId }) => studio.approveFinalReview(projectId, outputId));

  handle('settings:get', () => studio.store.getSettings());
  handle('settings:update', (patch) => studio.updateSettings(patch));
  handle('settings:pickBinary', async ({ which }) => {
    const res = await dialog.showOpenDialog(mainWindow!, { title: `Locate ${which}`, properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return studio.store.getSettings();
    const p = res.filePaths[0];
    if (which === 'ffmpeg') {
      const status = await checkFfmpeg(p);
      if (!status.ok) throw new Error(status.error ?? 'Not a usable ffmpeg');
      return studio.updateSettings({ ffmpegPath: p });
    }
    if (!(await checkFfprobe(p))) throw new Error('Selected file is not ffprobe.');
    return studio.updateSettings({ ffprobePath: p });
  });
  handle('settings:resetBinary', ({ which }) => studio.updateSettings(which === 'ffmpeg' ? { ffmpegPath: null } : { ffprobePath: null }));
  handle('settings:checkTools', () => studio.checkTools());

  handle('diagnostics:export', async () => {
    const res = await dialog.showSaveDialog(mainWindow!, { defaultPath: 'friday-diagnostics.json' });
    if (res.canceled || !res.filePath) return null;
    // Deliberately excludes lyrics, notes, file paths and settings values.
    const report = {
      app: app.getVersion(),
      electron: process.versions.electron,
      platform: `${process.platform}-${process.arch}`,
      ffmpeg: await studio.checkTools(),
      providers: await studio.listProviders(),
      jobs: studio.store.listJobs(undefined, 50).map((j) => ({ type: j.type, status: j.status, error: j.error ? redact(j.error) : null, updatedAt: j.updatedAt })),
    };
    report.ffmpeg.path = path.basename(report.ffmpeg.path);
    await fs.writeFile(res.filePath, JSON.stringify(report, null, 2));
    return path.basename(res.filePath);
  });
}

// ---------- window ----------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Friday Music Studio',
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  const wc = mainWindow.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${APP_SCHEME}://bundle/`) && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`);
  mainWindow.on('closed', () => (mainWindow = null));
}

app.whenReady().then(async () => {
  // Everything is denied except full screen for the app's own pages (the preview's Full screen button).
  const isOwnPage = (url: string) => url.startsWith('fms-app://');
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) => cb(perm === 'fullscreen' && isOwnPage(details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm, origin) => perm === 'fullscreen' && isOwnPage(origin));

  const store = new Store(path.join(dataDir, 'friday.sqlite'));
  // Vite copies src/renderer/public into dist/renderer, so fonts/ and backgrounds/ live there.
  studio = new StudioService(store, dataDir, path.join(__dirname, '..', 'renderer'));
  await studio.detectTools();
  void studio.syncLibrary().catch(() => undefined);
  const recovered = await studio.recover();
  if (recovered.interrupted.length || recovered.reconcile.length)
    log('warn', `recovered jobs: ${recovered.interrupted.length} interrupted, ${recovered.reconcile.length} need reconcile`);

  registerProtocols();
  registerHandlers();
  createWindow();
  log('info', 'started');
});

app.on('window-all-closed', () => {
  worker?.kill();
  studio?.store.close();
  app.quit();
});
