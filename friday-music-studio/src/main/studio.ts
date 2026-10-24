// Application logic with no Electron dependency, so it can be tested under
// plain Node. Electron glue (dialogs, windows, utilityProcess) lives in main.ts.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cuesFromAlignment } from '../shared/align';
import { cuesFromLyrics, cuesToSrt, validateCues } from '../shared/cues';
import { BACKGROUND_PRESETS, isValidTimezone, type BackgroundPresetId } from '../shared/defaults';
import type {
  Asset,
  AssetKind,
  AutoTimeResponse,
  DashboardSummary,
  GenerationPreview,
  Job,
  LyricCue,
  Project,
  ProjectDetail,
  ProviderInfo,
  RenderQuality,
  Settings,
  ToolStatus,
} from '../shared/types';
import { Store } from './db';
import { buildAss } from './render/ass';
import { checkFfmpeg, probeMedia, type RenderSpec } from './render/ffmpeg';
import { MockProvider } from './providers/mock';
import { SunoProvider } from './providers/suno';
import { ProviderNotConfiguredError, type MusicProvider } from './providers/types';
import { redactError } from './redact';
import { autoTimeFromEmbedded, autoTimeLines } from './autotime';
import { readEmbeddedLyrics } from './embedded';
import { matchEmbedded } from '../shared/embedded';
import { findModel, findWhisperCli, openEars } from './transcribe';
import { needsUpscale, upscalePicture } from './upscale';
import { clampShort, cuesForWindow, SHORT_HEIGHT, SHORT_WIDTH, type ShortSpec } from '../shared/shorts';
import { audioPeaks } from './peaks';
import { mixAudio } from './mix';
import { MIX_MAX_SONGS, MIX_MIN_SONGS, mergeMixCues, planMix, tracklist, type MixInfo } from '../shared/mix';

const EXT: Record<AssetKind, Record<string, string>> = {
  audio: { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg' },
  image: { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' },
  video: { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' },
};
export const IMPORT_EXTENSIONS: Record<AssetKind, string[]> = {
  audio: Object.keys(EXT.audio).map((e) => e.slice(1)),
  image: Object.keys(EXT.image).map((e) => e.slice(1)),
  video: Object.keys(EXT.video).map((e) => e.slice(1)),
};
const MAX_IMPORT_BYTES = 4 * 1024 ** 3;
const GENERATION_COUNT = 1;
const PREVIEW_TTL_MS = 10 * 60 * 1000;

interface PendingGeneration {
  projectId: string;
  providerId: string;
  fingerprint: string;
  count: number;
  expiresAt: number;
}

export class StudioService {
  readonly providers: MusicProvider[];
  private pendingGenerations = new Map<string, PendingGeneration>();

  constructor(
    readonly store: Store,
    readonly dataDir: string,
    /** Read-only folder holding bundled fonts/ and backgrounds/. */
    readonly bundledDir: string,
  ) {
    this.providers = [new MockProvider(() => this.ffmpegPath()), new SunoProvider()];
  }

  // ---------- paths & tools ----------

  /** Found by detectTools(); a path chosen in Settings always wins over these. */
  private foundFfmpeg: string | null = null;
  private foundFfprobe: string | null = null;

  ffmpegPath(): string {
    return this.store.getSettings().ffmpegPath ?? this.foundFfmpeg ?? 'ffmpeg';
  }
  ffprobePath(): string {
    return this.store.getSettings().ffprobePath ?? this.foundFfprobe ?? 'ffprobe';
  }

  /**
   * Picks an FFmpeg that has libass without the user setting PATH. Homebrew's plain `ffmpeg` lacks it;
   * the keg-only `ffmpeg-full` has it but is not on PATH, so look there first. Runs once at startup.
   */
  async detectTools(): Promise<void> {
    const s = this.store.getSettings();
    if (s.ffmpegPath) return;
    const candidates = ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg', 'ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
    for (const c of candidates) {
      if (path.isAbsolute(c) && !(await fs.access(c).then(() => true, () => false))) continue;
      if (!(await checkFfmpeg(c)).ok) continue;
      this.foundFfmpeg = c;
      if (!s.ffprobePath && path.isAbsolute(c)) {
        const probe = path.join(path.dirname(c), 'ffprobe');
        if (await fs.access(probe).then(() => true, () => false)) this.foundFfprobe = probe;
      }
      return;
    }
  }
  projectDir(projectId: string): string {
    return path.join(this.dataDir, 'projects', projectId);
  }
  checkTools(): Promise<ToolStatus> {
    return checkFfmpeg(this.ffmpegPath());
  }

  /** Every file the app serves or reads must sit inside its data dir. */
  assertInsideData(p: string): string {
    const resolved = path.resolve(p);
    const root = path.resolve(this.dataDir) + path.sep;
    if (!resolved.startsWith(root)) throw new Error('Path outside the app data directory');
    return resolved;
  }

  // ---------- projects ----------

  createProject(title: string, artist: string): Project {
    const s = this.store.getSettings();
    return this.store.createProject({ title, artist: artist || s.defaultArtist, branding: s.defaultBranding, timezone: s.defaultTimezone });
  }

  requireProject(projectId: string): Project {
    const p = this.store.getProject(projectId);
    if (!p) throw new Error('Project not found');
    return p;
  }

  getDetail(projectId: string): ProjectDetail {
    const project = this.requireProject(projectId);
    return {
      project,
      assets: this.store.listAssets(projectId),
      cues: this.store.listCues(projectId),
      renders: this.store.listRenders(projectId),
      approvals: this.store.listApprovals(projectId),
      jobs: this.store.listJobs(projectId, 50),
    };
  }

  updateProject(projectId: string, patch: Parameters<Store['updateProject']>[1]): Project {
    this.requireProject(projectId);
    if (patch.chosenAudioAssetId) this.requireAsset(projectId, patch.chosenAudioAssetId, ['audio']);
    if (patch.backgroundAssetId) this.requireAsset(projectId, patch.backgroundAssetId, ['image', 'video']);
    if (patch.branding?.logoAssetId) this.requireAsset(projectId, patch.branding.logoAssetId, ['image']);
    return this.store.updateProject(projectId, patch);
  }

  private requireAsset(projectId: string, assetId: string, kinds: AssetKind[]): { asset: Asset; storedPath: string } {
    const a = this.store.getAssetPath(assetId);
    if (!a || a.asset.projectId !== projectId || !kinds.includes(a.asset.kind)) throw new Error('Asset not found in this project');
    return a;
  }

  // ---------- assets ----------

  /** Copies a user-chosen file into the project and probes it. srcPath comes from a native dialog, never the renderer. */
  async importAsset(projectId: string, kind: AssetKind, srcPath: string, opts: { asLogo?: boolean } = {}): Promise<Asset> {
    this.requireProject(projectId);
    const ext = path.extname(srcPath).toLowerCase();
    const mime = EXT[kind][ext];
    if (!mime) throw new Error(`Unsupported ${kind} file type "${ext}".`);
    const stat = await fs.stat(srcPath);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > MAX_IMPORT_BYTES) throw new Error('File is larger than 4 GB');

    const probe = await probeMedia(this.ffprobePath(), srcPath);
    if (kind === 'audio' && (!probe.audioCodec || !probe.durationSec)) throw new Error('No audio stream found in that file.');
    if (kind === 'video' && !probe.videoCodec) throw new Error('No video stream found in that file.');
    if (kind === 'image' && !probe.width) throw new Error('Could not read that image.');

    const id = randomUUID();
    const dir = path.join(this.projectDir(projectId), 'assets');
    await fs.mkdir(dir, { recursive: true });
    const storedPath = path.join(dir, `${id}${ext}`);
    await fs.copyFile(srcPath, storedPath);
    const asset = this.store.addAsset({
      id,
      projectId,
      kind,
      source: 'local_import',
      providerId: null,
      originalName: path.basename(srcPath),
      storedPath,
      mime,
      sizeBytes: stat.size,
      durationSec: kind === 'image' ? null : probe.durationSec,
      width: probe.width,
      height: probe.height,
    });
    // First audio/background imported becomes the project's choice.
    const p = this.requireProject(projectId);
    if (kind === 'audio' && !p.chosenAudioAssetId) this.store.updateProject(projectId, { chosenAudioAssetId: id });
    if (kind !== 'audio' && !p.backgroundAssetId && !opts.asLogo) this.store.updateProject(projectId, { backgroundAssetId: id });
    return asset;
  }

  /** Imports a picture as the project's logo (corner overlay). It never becomes the background. */
  async importLogo(projectId: string, srcPath: string): Promise<Asset> {
    const asset = await this.importAsset(projectId, 'image', srcPath, { asLogo: true });
    const p = this.requireProject(projectId);
    this.store.updateProject(projectId, { branding: { ...p.branding, logoAssetId: asset.id } });
    return asset;
  }

  /** Adds one of the bundled sky backgrounds to the project and selects it. */
  async importPreset(projectId: string, presetId: BackgroundPresetId): Promise<Asset> {
    this.requireProject(projectId);
    const preset = BACKGROUND_PRESETS.find((p) => p.id === presetId);
    if (!preset) throw new Error('Unknown background preset');
    const existing = this.store.listAssets(projectId).find((a) => a.originalName === `Preset: ${preset.label}` && a.kind === 'image');
    if (existing) {
      this.store.updateProject(projectId, { backgroundAssetId: existing.id });
      return existing;
    }
    const src = path.join(this.bundledDir, 'backgrounds', preset.file);
    const id = randomUUID();
    const dir = path.join(this.projectDir(projectId), 'assets');
    await fs.mkdir(dir, { recursive: true });
    const storedPath = path.join(dir, `${id}.jpg`);
    await fs.copyFile(src, storedPath);
    const probe = await probeMedia(this.ffprobePath(), storedPath);
    const st = await fs.stat(storedPath);
    const asset = this.store.addAsset({
      id,
      projectId,
      kind: 'image',
      source: 'local_import',
      providerId: null,
      originalName: `Preset: ${preset.label}`,
      storedPath,
      mime: 'image/jpeg',
      sizeBytes: st.size,
      durationSec: null,
      width: probe.width,
      height: probe.height,
    });
    this.store.updateProject(projectId, { backgroundAssetId: id });
    return asset;
  }

  // ---------- cues ----------

  saveCues(projectId: string, cues: LyricCue[]) {
    this.requireProject(projectId);
    const ids = new Set(cues.map((c) => c.id));
    if (ids.size !== cues.length) throw new Error('Duplicate cue IDs');
    this.store.replaceCues(projectId, [...cues].sort((a, b) => a.startMs - b.startMs));
  }

  /**
   * Hears the chosen audio locally (whisper.cpp) and matches the project's lyrics to it,
   * so each line gets the time it is actually sung. Returns a proposal; nothing is saved.
   */
  async autoTimeCues(projectId: string, estimateMissing: boolean): Promise<AutoTimeResponse> {
    const project = this.requireProject(projectId);
    if (!project.chosenAudioAssetId) throw new Error('Choose or import an audio track first.');
    const audio = this.requireAsset(projectId, project.chosenAudioAssetId, ['audio']);
    const durationMs = (audio.asset.durationSec ?? 0) * 1000;
    if (!durationMs) throw new Error('Audio duration unknown; re-import the track.');
    const lines = cuesFromLyrics(project.lyrics, () => '').map((c) => c.text);
    if (lines.length === 0) throw new Error('Add lyrics to the project first.');

    // Suno writes timed lyrics into its audio files. Prefer them; the speech model only refines.
    const embedded = await readEmbeddedLyrics(this.ffmpegPath(), audio.storedPath);
    const windows = embedded.length ? matchEmbedded(lines, embedded) : [];
    const useEmbedded = windows.filter(Boolean).length >= Math.ceil(lines.length * 0.6);

    const whisperPath = await findWhisperCli();
    const modelPath = await findModel(path.join(this.dataDir, 'models'));
    if (!useEmbedded) {
      if (!whisperPath) throw new Error('Auto timing needs whisper.cpp. In Terminal run: brew install whisper-cpp');
      if (!modelPath) throw new Error(`Auto timing needs a speech model. Put ggml-small.en.bin in: ${path.join(this.dataDir, 'models')}`);
    }
    const ears = whisperPath && modelPath ? await openEars(audio.storedPath, { ffmpegPath: this.ffmpegPath(), whisperPath, modelPath }) : null;
    try {
      const result = useEmbedded
        ? await autoTimeFromEmbedded(lines, windows, ears, durationMs)
        : await autoTimeLines(lines, ears!, durationMs, { estimateMissing });
      const cues = cuesFromAlignment(result, () => randomUUID());
      // cuesFromAlignment keeps the timed lines in order, so cue k belongs to the k-th timed line.
      const timed = result.lines.filter((l) => l.timed && l.endMs > l.startMs);
      return {
        cues,
        hintedCueIds: cues.filter((_, k) => timed[k]?.hinted && !timed[k]?.estimated).map((c) => c.id),
        estimatedCueIds: cues.filter((_, k) => timed[k]?.estimated).map((c) => c.id),
        unheardLines: result.lines.filter((l) => !l.timed).map((l) => l.text),
        coverage: result.coverage,
        source: useEmbedded ? 'suno_embedded' : 'speech',
      };
    } finally {
      await ears?.close();
    }
  }

  // ---------- render ----------

  /** Builds a render spec from stored state only; the renderer supplies nothing but a project ID. */
  prepareRender(projectId: string, quality: RenderQuality = '1080p', shortSpec?: ShortSpec): { job: Job; spec: RenderSpec } {
    const project = this.requireProject(projectId);
    if (!project.chosenAudioAssetId) throw new Error('Choose or import an audio track first.');
    const audio = this.requireAsset(projectId, project.chosenAudioAssetId, ['audio']);
    const durationSec = audio.asset.durationSec;
    if (!durationSec) throw new Error('Audio duration unknown; re-import the track.');
    const cues = this.store.listCues(projectId);
    const errors = validateCues(cues, durationSec * 1000).filter((i) => i.level === 'error');
    if (errors.length) throw new Error(`Fix ${errors.length} lyric timing error(s) before exporting. First: ${errors[0]!.message}`);
    const active = this.store.listJobs(projectId, 50).find((j) => j.type === 'render' && (j.status === 'running' || j.status === 'queued'));
    if (active) throw new Error('A render for this project is already running.');

    // A Short is a vertical 9:16 clip of one section of the song, with the cues that fall inside it.
    const short = shortSpec ? clampShort(shortSpec, durationSec * 1000) : null;
    const frame = short ? { width: quality === '4k' ? SHORT_WIDTH * 2 : SHORT_WIDTH, height: quality === '4k' ? SHORT_HEIGHT * 2 : SHORT_HEIGHT } : { width: quality === '4k' ? 3840 : 1920, height: quality === '4k' ? 2160 : 1080 };
    const renderCues = short ? cuesForWindow(cues, short.startMs, short.lengthMs) : cues;
    let backgroundSize: { width: number; height: number } | null = null;
    let logo: RenderSpec['logo'] | null = null;
    if (project.branding.logoAssetId) {
      const l = this.store.getAssetPath(project.branding.logoAssetId);
      if (l && l.asset.projectId === projectId && l.asset.kind === 'image') logo = { path: l.storedPath, widthPercent: project.branding.logoSize, position: project.branding.watermarkPosition };
    }
    let background: RenderSpec['background'] = { kind: 'color', color: project.branding.backgroundColor };
    // A Short may use its own picture instead of the video's background.
    const bgAssetId = short?.backgroundAssetId ?? project.backgroundAssetId;
    if (bgAssetId) {
      const bg = this.requireAsset(projectId, bgAssetId, short?.backgroundAssetId ? ['image'] : ['image', 'video']);
      background = { kind: bg.asset.kind as 'image' | 'video', path: bg.storedPath };
      if (bg.asset.width && bg.asset.height) backgroundSize = { width: bg.asset.width, height: bg.asset.height };
    }

    const job = this.store.createJob('render', projectId, { audioAssetId: audio.asset.id, backgroundAssetId: short?.backgroundAssetId ?? project.backgroundAssetId, cueCount: renderCues.length, quality, ...(short ? { short } : {}) });
    const dir = this.projectDir(projectId);
    const spec: RenderSpec = {
      ffmpegPath: this.ffmpegPath(),
      ffprobePath: this.ffprobePath(),
      workDir: path.join(dir, 'work', job.id),
      outputPath: path.join(dir, 'renders', `${job.id}.mp4`),
      audioPath: audio.storedPath,
      durationSec: short ? short.lengthMs / 1000 : durationSec,
      width: frame.width,
      height: frame.height,
      ...(short ? { audioStartSec: short.startMs / 1000, audioFadeSec: 0.6, focusX: short.focusX, focusY: short.focusY, zoom: short.zoom } : {}),
      background,
      backgroundDim: project.backgroundAssetId ? project.branding.backgroundDim : 0,
      backgroundMotion: project.branding.backgroundMotion,
      backgroundFit: short ? short.fit : project.branding.backgroundFit,
      backgroundSize: backgroundSize ?? undefined,
      ...(bgAssetId ? { backgroundAssetId: bgAssetId } : {}),
      logo: logo ?? undefined,
      assContent: short ? buildAss(renderCues, project.branding, short.lengthMs, { width: SHORT_WIDTH, height: SHORT_HEIGHT }) : buildAss(cues, project.branding, durationSec * 1000),
      fontsDir: path.join(this.bundledDir, 'fonts'),
    };
    return { job, spec };
  }

  async finishRender(jobId: string, result: { outputPath: string; sizeBytes: number; probe: NonNullable<import('../shared/types').RenderOutput['probe']> }) {
    const job = this.store.getJob(jobId);
    if (!job?.projectId) throw new Error('Unknown render job');
    const project = this.requireProject(job.projectId);
    const safeTitle = project.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 60) || 'lyric-video';
    const output = this.store.addRender({
      projectId: job.projectId,
      jobId,
      storedPath: this.assertInsideData(result.outputPath),
      fileName: result.probe.height > result.probe.width ? `${safeTitle} Short.mp4` : `${safeTitle}.mp4`,
      sizeBytes: result.sizeBytes,
      verified: true,
      probe: result.probe,
    });
    this.store.updateJob(jobId, { status: 'succeeded', progress: 1, output: { outputId: output.id } });
    await fs.rm(path.join(this.projectDir(job.projectId), 'work', jobId), { recursive: true, force: true });
    // A failure to mirror into the Library folder must never fail the render itself.
    await this.syncLibrary(job.projectId).catch(() => undefined);
    return output;
  }

  async failRender(jobId: string, status: 'failed' | 'cancelled', message: string | null) {
    const job = this.store.updateJob(jobId, { status, error: message ? redactError(message) : null });
    if (job.projectId) await fs.rm(path.join(this.projectDir(job.projectId), 'work', jobId), { recursive: true, force: true });
    return job;
  }

  /** Startup recovery: mark stale jobs and delete partial files. */
  async recover() {
    const result = this.store.recoverJobsAfterRestart();
    for (const j of result.interrupted) {
      if (j.type === 'render' && j.projectId) {
        const dir = this.projectDir(j.projectId);
        await fs.rm(path.join(dir, 'work', j.id), { recursive: true, force: true });
        await fs.rm(path.join(dir, 'renders', `${j.id}.mp4.partial`), { force: true });
      }
    }
    return result;
  }

  // ---------- providers & generation ----------

  provider(id: string): MusicProvider {
    const p = this.providers.find((x) => x.id === id);
    if (!p) throw new Error('Unknown provider');
    return p;
  }

  listProviders(): Promise<ProviderInfo[]> {
    return Promise.all(this.providers.map((p) => p.info()));
  }

  private fingerprint(p: Project, providerId: string, count: number): string {
    return createHash('sha256').update(JSON.stringify([p.id, providerId, p.title, p.lyrics, p.stylePrompt, count])).digest('hex');
  }

  private usage(settings: Settings) {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return { used: this.store.countJobsSince('generation', since), limit: settings.generationLimitPer24h };
  }

  /** Step 1: show exactly what would be sent. Nothing is submitted here. */
  async prepareGeneration(projectId: string, providerId: string): Promise<GenerationPreview> {
    const project = this.requireProject(projectId);
    const provider = this.provider(providerId);
    const info = await provider.info();
    if (info.state !== 'ready') throw new Error(info.detail);
    if (!project.lyrics.trim()) throw new Error('Add lyrics before generating.');
    if (!project.stylePrompt.trim()) throw new Error('Add a style prompt before generating.');
    const { used, limit } = this.usage(this.store.getSettings());
    const costText = await provider.estimateCost({ title: project.title, lyrics: project.lyrics, stylePrompt: project.stylePrompt, count: GENERATION_COUNT });
    const token = randomBytes(24).toString('hex');
    this.pendingGenerations.set(token, {
      projectId,
      providerId,
      fingerprint: this.fingerprint(project, providerId, GENERATION_COUNT),
      count: GENERATION_COUNT,
      expiresAt: Date.now() + PREVIEW_TTL_MS,
    });
    return {
      token,
      providerId,
      providerLabel: provider.label,
      isMock: provider.isMock,
      title: project.title,
      lyrics: project.lyrics,
      stylePrompt: project.stylePrompt,
      count: GENERATION_COUNT,
      costText,
      usedLast24h: used,
      limitPer24h: limit,
    };
  }

  /** Step 2: one approval = at most one submission. Tokens are single-use. */
  async approveAndSubmitGeneration(projectId: string, token: string): Promise<Job> {
    const pending = this.pendingGenerations.get(token);
    this.pendingGenerations.delete(token);
    if (!pending || pending.projectId !== projectId) throw new Error('Approval not found. Review the generation again.');
    if (Date.now() > pending.expiresAt) throw new Error('Approval expired. Review the generation again.');
    const project = this.requireProject(projectId);
    if (this.fingerprint(project, pending.providerId, pending.count) !== pending.fingerprint)
      throw new Error('Lyrics, style or title changed since review. Review again before submitting.');
    const { used, limit } = this.usage(this.store.getSettings());
    if (used + pending.count > limit) throw new Error(`Generation limit reached (${used}/${limit} in the last 24 hours). Change it in Settings.`);

    const provider = this.provider(pending.providerId);
    const request = { title: project.title, lyrics: project.lyrics, stylePrompt: project.stylePrompt, count: pending.count };
    this.store.addApproval(projectId, 'generation', { providerId: provider.id, isMock: provider.isMock, ...request });
    // Persist the job as running BEFORE the call, so a crash mid-request leaves a needs_reconcile record.
    const job = this.store.createJob('generation', projectId, { providerId: provider.id, isMock: provider.isMock, ...request }, 'running');
    try {
      const { providerJobId } = await provider.submitGeneration(request);
      this.store.updateProject(projectId, { providerId: provider.id, providerJobId });
      return this.store.updateJob(job.id, { externalId: providerJobId });
    } catch (err) {
      // A config error never reached the provider. Anything else (timeout, network) might have: reconcile, don't resubmit.
      const status = err instanceof ProviderNotConfiguredError ? 'failed' : 'needs_reconcile';
      return this.store.updateJob(job.id, { status, error: redactError(err) });
    }
  }

  /** Polls a generation job and downloads finished tracks. Never resubmits. */
  async refreshGeneration(jobId: string): Promise<Job> {
    const job = this.store.getJob(jobId);
    if (!job || job.type !== 'generation' || !job.projectId) throw new Error('Generation job not found');
    if (job.status === 'succeeded') return job;
    if (!job.externalId) {
      return this.store.updateJob(jobId, {
        status: 'needs_reconcile',
        error: 'No provider job ID was recorded. Check the provider dashboard manually; do not resubmit blindly.',
      });
    }
    const input = job.input as { providerId: string; isMock: boolean };
    const provider = this.provider(input.providerId);
    const status = await provider.getJobStatus(job.externalId);
    if (status.state === 'pending' || status.state === 'running') return this.store.updateJob(jobId, { status: 'running', error: null });
    if (status.state === 'failed') return this.store.updateJob(jobId, { status: 'failed', error: status.message ?? 'Provider reported failure' });
    if (status.state === 'unknown') return this.store.updateJob(jobId, { status: 'needs_reconcile', error: status.message ?? 'Outcome unknown' });

    const assetIds: string[] = [];
    for (const trackId of status.trackIds) {
      const dl = this.store.createJob('download', job.projectId, { generationJobId: jobId, trackId }, 'running');
      try {
        const id = randomUUID();
        const dir = path.join(this.projectDir(job.projectId), 'assets');
        await fs.mkdir(dir, { recursive: true });
        const dest = path.join(dir, `${id}.mp3`);
        const { mime } = await provider.downloadAudio(job.externalId, trackId, dest);
        const probe = await probeMedia(this.ffprobePath(), dest);
        const st = await fs.stat(dest);
        this.store.addAsset({
          id,
          projectId: job.projectId,
          kind: 'audio',
          source: provider.isMock ? 'mock_provider' : 'provider',
          providerId: provider.id,
          originalName: `${provider.isMock ? 'MOCK ' : ''}${trackId}.mp3`,
          storedPath: dest,
          mime,
          sizeBytes: st.size,
          durationSec: probe.durationSec,
          width: null,
          height: null,
        });
        assetIds.push(id);
        this.store.updateJob(dl.id, { status: 'succeeded', progress: 1, output: { assetId: id } });
      } catch (err) {
        this.store.updateJob(dl.id, { status: 'failed', error: redactError(err) });
      }
    }
    return this.store.updateJob(jobId, {
      status: assetIds.length ? 'succeeded' : 'failed',
      progress: 1,
      output: { assetIds },
      error: assetIds.length ? null : 'Downloads failed',
    });
  }

  // ---------- review ----------

  async approveFinalReview(projectId: string, outputId: string) {
    const project = this.requireProject(projectId);
    const r = this.store.getRender(outputId);
    if (!r || r.output.projectId !== projectId) throw new Error('Render not found in this project');
    if (!r.output.verified) throw new Error('Only verified exports can be approved.');
    const job = this.store.getJob(r.output.jobId);
    const audioId = (job?.input as { audioAssetId?: string } | null)?.audioAssetId;
    const audio = audioId ? this.store.getAsset(audioId) : null;
    if (!audio) throw new Error('Cannot determine which audio this export used.');
    if (audio.source === 'mock_provider') throw new Error('This export uses MOCK placeholder audio. It cannot be approved for release.');
    if (!project.rightsNotes.trim()) throw new Error('Add rights-review notes (who owns the music, lyrics and background) before approving.');
    const sha256 = await sha256File(this.assertInsideData(r.storedPath));
    return this.store.addApproval(projectId, 'final_review', {
      outputId,
      fileName: r.output.fileName,
      sizeBytes: r.output.sizeBytes,
      sha256,
      audioAssetId: audio.id,
      audioSource: audio.source,
      title: project.title,
      artist: project.artist,
      rightsNotes: project.rightsNotes,
    });
  }

  /**
   * 4K + "Sharpen with AI": swap the background for its cached x4 upscale. Never fails the render:
   * without the upscaler or on any error the original picture is used.
   */
  async applyUpscale(projectId: string, spec: RenderSpec, quality: RenderQuality): Promise<RenderSpec> {
    const project = this.requireProject(projectId);
    const bgId = spec.backgroundAssetId ?? project.backgroundAssetId;
    if (!bgId || spec.background.kind !== 'image') return spec;
    const a = this.store.getAssetPath(bgId);
    if (!a || !needsUpscale({ enabled: project.branding.backgroundUpscale === true, quality, kind: a.asset.kind, widthPx: a.asset.width })) return spec;
    const up = await upscalePicture(this.dataDir, path.join(this.projectDir(projectId), 'upscaled'), bgId, a.storedPath);
    if (!up) return spec;
    return {
      ...spec,
      background: { kind: 'image', path: up },
      backgroundSize: a.asset.width && a.asset.height ? { width: a.asset.width * 4, height: a.asset.height * 4 } : spec.backgroundSize,
    };
  }

  /** Loudness peaks of the chosen song for the waveform on the Shorts screen. */
  async songPeaks(projectId: string): Promise<{ peaks: number[]; durationMs: number }> {
    const project = this.requireProject(projectId);
    if (!project.chosenAudioAssetId) throw new Error('Choose or import an audio track first.');
    const audio = this.requireAsset(projectId, project.chosenAudioAssetId, ['audio']);
    return { peaks: await audioPeaks(this.ffmpegPath(), audio.storedPath, 900), durationMs: Math.round((audio.asset.durationSec ?? 0) * 1000) };
  }

  // ---------- long mixes: several songs blended into one video ----------

  /** The mix recipe of a project made with createMix, or null for an ordinary project. */
  async mixInfo(projectId: string): Promise<MixInfo | null> {
    this.requireProject(projectId);
    try {
      return JSON.parse(await fs.readFile(path.join(this.projectDir(projectId), 'mix.json'), 'utf8')) as MixInfo;
    } catch {
      return null;
    }
  }

  /**
   * Blends the chosen songs (each project's chosen audio, in the given order) with crossfades into a NEW project:
   * one long audio file, every song's lyrics moved to where it starts, the first song's picture and look,
   * and a tracklist. The new project is then styled and exported like any other.
   */
  async createMix(title: string, projectIds: string[], crossfadeMs: number): Promise<{ project: Project; mix: MixInfo }> {
    if (projectIds.length < MIX_MIN_SONGS) throw new Error('Choose at least two songs.');
    if (projectIds.length > MIX_MAX_SONGS) throw new Error(`A mix can hold at most ${MIX_MAX_SONGS} songs.`);
    const songs = projectIds.map((id) => {
      const project = this.requireProject(id);
      if (!project.chosenAudioAssetId) throw new Error(`"${project.title}" has no song yet.`);
      const audio = this.requireAsset(id, project.chosenAudioAssetId, ['audio']);
      if (!audio.asset.durationSec) throw new Error(`"${project.title}" has an audio file with unknown length. Import it again.`);
      return { project, audio, cues: this.store.listCues(id) };
    });
    const plan = planMix(songs.map((s) => Math.round(s.audio.asset.durationSec! * 1000)), crossfadeMs);
    const first = songs[0]!.project;
    const mixTitle = title.trim() || `Mix of ${songs.length} songs`;

    const mix = this.store.createProject({ title: mixTitle, artist: first.artist, branding: first.branding, timezone: first.releaseTimezone });
    const dir = this.projectDir(mix.id);
    const assets = path.join(dir, 'assets');
    await fs.mkdir(assets, { recursive: true });
    try {
      const audioId = randomUUID();
      const storedPath = path.join(assets, `${audioId}.m4a`);
      await mixAudio(this.ffmpegPath(), songs.map((s) => s.audio.storedPath), plan.crossfadeMs / 1000, storedPath);
      const probe = await probeMedia(this.ffprobePath(), storedPath);
      if (!probe.audioCodec || !probe.durationSec) throw new Error('The blended audio could not be read back.');
      const st = await fs.stat(storedPath);
      // A mix containing placeholder (mock) audio stays marked as mock, so it can never pass release review.
      const anyMock = songs.some((s) => s.audio.asset.source === 'mock_provider');
      this.store.addAsset({ id: audioId, projectId: mix.id, kind: 'audio', source: anyMock ? 'mock_provider' : 'local_import', providerId: anyMock ? 'mock' : null, originalName: `${mixTitle}.m4a`, storedPath, mime: 'audio/mp4', sizeBytes: st.size, durationSec: probe.durationSec, width: null, height: null });
      this.store.updateProject(mix.id, { chosenAudioAssetId: audioId });

      // The first song's picture becomes the mix's background (it can be changed in Video Studio).
      if (first.backgroundAssetId) {
        const bg = this.store.getAssetPath(first.backgroundAssetId);
        if (bg && bg.asset.kind === 'image') {
          const bgId = randomUUID();
          const bgPath = path.join(assets, `${bgId}${path.extname(bg.storedPath)}`);
          await fs.copyFile(bg.storedPath, bgPath);
          this.store.addAsset({ id: bgId, projectId: mix.id, kind: 'image', source: 'local_import', providerId: null, originalName: bg.asset.originalName, storedPath: bgPath, mime: bg.asset.mime, sizeBytes: bg.asset.sizeBytes, durationSec: null, width: bg.asset.width, height: bg.asset.height });
          this.store.updateProject(mix.id, { backgroundAssetId: bgId });
        }
      }

      const cues = mergeMixCues(songs.map((s, i) => ({ startMs: plan.tracks[i]!.startMs, endMs: plan.tracks[i]!.endMs, cues: s.cues })), () => randomUUID());
      this.store.replaceCues(mix.id, cues);
      const lyrics = songs.map((s) => `[${s.project.title}]\n${s.project.lyrics.trim()}`).join('\n\n');
      const rights = songs.map((s) => `${s.project.title}: ${s.project.rightsNotes.trim() || 'no rights notes'}`).join('\n');
      this.store.updateProject(mix.id, { lyrics, rightsNotes: rights });

      const info: MixInfo = {
        title: mixTitle,
        crossfadeMs: plan.crossfadeMs,
        totalMs: plan.totalMs,
        tracks: songs.map((s, i) => ({ projectId: s.project.id, title: s.project.title, artist: s.project.artist, startMs: plan.tracks[i]!.startMs, endMs: plan.tracks[i]!.endMs, durationMs: plan.tracks[i]!.durationMs })),
        tracklist: tracklist(songs.map((s, i) => ({ title: s.project.title, artist: s.project.artist, startMs: plan.tracks[i]!.startMs })), plan.totalMs),
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(dir, 'mix.json'), JSON.stringify(info, null, 2), 'utf8');
      return { project: this.requireProject(mix.id), mix: info };
    } catch (e) {
      this.store.archiveProject(mix.id); // do not leave a half-made project behind
      await fs.rm(dir, { recursive: true, force: true });
      throw e;
    }
  }

  // ---------- library: one visible folder with everything ----------

  /** The app keeps its own copy in the data folder; this mirror is what the user opens and uploads from. */
  libraryDir(): string {
    return this.store.getSettings().libraryDir ?? path.join(os.homedir(), 'Movies', 'Friday Music Studio');
  }

  /**
   * Puts every finished video plus its lyrics, subtitles, audio and picture into
   * <library>/<song title>/. Files are hard-linked when possible so nothing takes extra disk space.
   * Safe to run again: existing files are left alone, text files are refreshed.
   */
  async syncLibrary(projectId?: string): Promise<{ dir: string; videos: number }> {
    const root = path.resolve(this.libraryDir());
    let videos = 0;
    const projects = projectId ? [this.requireProject(projectId)] : this.store.listProjects();
    for (const project of projects) {
      const safeTitle = project.title.replace(/[^A-Za-z0-9 _-]+/g, '').trim().slice(0, 60) || 'lyric-video';
      const dir = path.join(root, safeTitle);
      const renders = this.store.listRenders(project.id);
      if (renders.length === 0) continue;
      await fs.mkdir(path.join(dir, 'source'), { recursive: true });

      for (const r of renders) {
        const full = this.store.getRender(r.id);
        if (!full) continue;
        const vertical = (r.probe?.height ?? 0) > (r.probe?.width ?? 0);
        const long = Math.max(r.probe?.height ?? 0, r.probe?.width ?? 0);
        const res = `${vertical ? 'Short ' : ''}${long >= 3840 ? '4K' : long >= 1920 ? '1080p' : `${r.probe?.height ?? '?'}p`}`;
        const stamp = new Date(r.createdAt);
        const pad = (n: number) => String(n).padStart(2, '0');
        const when = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
        const dest = path.join(dir, `${safeTitle} - ${res} - ${when}.mp4`);
        try {
          if (await linkOrCopy(this.assertInsideData(full.storedPath), dest)) videos++;
        } catch {
          // A missing or unreadable file must not stop the rest of the Library from syncing.
        }
      }

      await fs.writeFile(path.join(dir, 'lyrics.txt'), `${project.lyrics.trim()}\n`, 'utf8');
      const mixInfo = await this.mixInfo(project.id);
      if (mixInfo) await fs.writeFile(path.join(dir, 'tracklist.txt'), `${mixInfo.tracklist}\n`, 'utf8');
      const cues = this.store.listCues(project.id);
      if (cues.length) await fs.writeFile(path.join(dir, 'lyrics.srt'), cuesToSrt(cues), 'utf8');
      for (const assetId of [project.chosenAudioAssetId, project.backgroundAssetId]) {
        if (!assetId) continue;
        const a = this.store.getAssetPath(assetId);
        if (!a) continue;
        const name = path.basename(a.asset.originalName).replace(/[^A-Za-z0-9 ._()-]+/g, '_') || `${assetId}${path.extname(a.storedPath)}`;
        await linkOrCopy(this.assertInsideData(a.storedPath), path.join(dir, 'source', name)).catch(() => undefined);
      }
    }
    return { dir: root, videos };
  }

  // ---------- settings & dashboard ----------

  updateSettings(patch: Partial<Settings>) {
    if (patch.defaultTimezone !== undefined && !isValidTimezone(patch.defaultTimezone)) throw new Error('Unknown timezone');
    this.store.setSettings(patch);
    return this.store.getSettings();
  }

  async dashboard(): Promise<DashboardSummary> {
    const projects = this.store.listProjects();
    return {
      projectCount: projects.length,
      recentProjects: projects.slice(0, 5),
      attentionJobs: this.store.jobsNeedingAttention(),
      ffmpeg: await this.checkTools(),
      providers: await this.listProviders(),
    };
  }
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** Hard link (no extra disk space); falls back to a copy across volumes. Returns true when a new file was made. */
async function linkOrCopy(src: string, dest: string): Promise<boolean> {
  try {
    await fs.access(dest);
    return false;
  } catch {
    /* does not exist yet */
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
  return true;
}
