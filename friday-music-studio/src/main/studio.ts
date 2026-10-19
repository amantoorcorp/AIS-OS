// Application logic with no Electron dependency, so it can be tested under
// plain Node. Electron glue (dialogs, windows, utilityProcess) lives in main.ts.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { cuesFromAlignment } from '../shared/align';
import { cuesFromLyrics, validateCues } from '../shared/cues';
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
import { autoTimeLines } from './autotime';
import { findModel, findWhisperCli, openEars } from './transcribe';

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

  ffmpegPath(): string {
    return this.store.getSettings().ffmpegPath ?? 'ffmpeg';
  }
  ffprobePath(): string {
    return this.store.getSettings().ffprobePath ?? 'ffprobe';
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
    return this.store.updateProject(projectId, patch);
  }

  private requireAsset(projectId: string, assetId: string, kinds: AssetKind[]): { asset: Asset; storedPath: string } {
    const a = this.store.getAssetPath(assetId);
    if (!a || a.asset.projectId !== projectId || !kinds.includes(a.asset.kind)) throw new Error('Asset not found in this project');
    return a;
  }

  // ---------- assets ----------

  /** Copies a user-chosen file into the project and probes it. srcPath comes from a native dialog, never the renderer. */
  async importAsset(projectId: string, kind: AssetKind, srcPath: string): Promise<Asset> {
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
    if (kind !== 'audio' && !p.backgroundAssetId) this.store.updateProject(projectId, { backgroundAssetId: id });
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

    const whisperPath = await findWhisperCli();
    if (!whisperPath) throw new Error('Auto timing needs whisper.cpp. In Terminal run: brew install whisper-cpp');
    const modelsDir = path.join(this.dataDir, 'models');
    const modelPath = await findModel(modelsDir);
    if (!modelPath) throw new Error(`Auto timing needs a speech model. Put ggml-small.en.bin in: ${modelsDir}`);

    const ears = await openEars(audio.storedPath, { ffmpegPath: this.ffmpegPath(), whisperPath, modelPath });
    try {
      const result = await autoTimeLines(lines, ears, durationMs, { estimateMissing });
      const cues = cuesFromAlignment(result, () => randomUUID());
      // cuesFromAlignment keeps the timed lines in order, so cue k belongs to the k-th timed line.
      const timed = result.lines.filter((l) => l.timed && l.endMs > l.startMs);
      return {
        cues,
        hintedCueIds: cues.filter((_, k) => timed[k]?.hinted && !timed[k]?.estimated).map((c) => c.id),
        estimatedCueIds: cues.filter((_, k) => timed[k]?.estimated).map((c) => c.id),
        unheardLines: result.lines.filter((l) => !l.timed).map((l) => l.text),
        coverage: result.coverage,
      };
    } finally {
      await ears.close();
    }
  }

  // ---------- render ----------

  /** Builds a render spec from stored state only; the renderer supplies nothing but a project ID. */
  prepareRender(projectId: string): { job: Job; spec: RenderSpec } {
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

    let background: RenderSpec['background'] = { kind: 'color', color: project.branding.backgroundColor };
    if (project.backgroundAssetId) {
      const bg = this.requireAsset(projectId, project.backgroundAssetId, ['image', 'video']);
      background = { kind: bg.asset.kind as 'image' | 'video', path: bg.storedPath };
    }

    const job = this.store.createJob('render', projectId, { audioAssetId: audio.asset.id, backgroundAssetId: project.backgroundAssetId, cueCount: cues.length });
    const dir = this.projectDir(projectId);
    const spec: RenderSpec = {
      ffmpegPath: this.ffmpegPath(),
      ffprobePath: this.ffprobePath(),
      workDir: path.join(dir, 'work', job.id),
      outputPath: path.join(dir, 'renders', `${job.id}.mp4`),
      audioPath: audio.storedPath,
      durationSec,
      background,
      backgroundDim: project.backgroundAssetId ? project.branding.backgroundDim : 0,
      backgroundMotion: project.branding.backgroundMotion,
      assContent: buildAss(cues, project.branding, durationSec * 1000),
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
      fileName: `${safeTitle}.mp4`,
      sizeBytes: result.sizeBytes,
      verified: true,
      probe: result.probe,
    });
    this.store.updateJob(jobId, { status: 'succeeded', progress: 1, output: { outputId: output.id } });
    await fs.rm(path.join(this.projectDir(job.projectId), 'work', jobId), { recursive: true, force: true });
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
