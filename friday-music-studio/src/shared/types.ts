// Domain types shared by main, preload and renderer. No runtime code here.

export type AssetKind = 'audio' | 'image' | 'video';

/** Where an asset came from. Mock assets must never be presented as real API output. */
export type AssetSource = 'local_import' | 'mock_provider' | 'provider';

export interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  source: AssetSource;
  providerId: string | null;
  originalName: string;
  mime: string;
  sizeBytes: number;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export interface LyricCue {
  id: string;
  startMs: number;
  endMs: number;
  /** Up to two lines separated by "\n". */
  text: string;
}

export type LyricPosition = 'center' | 'lower';
export type TextCase = 'as_written' | 'upper';
export type WatermarkPosition = 'top_left' | 'bottom_right';
export type BackgroundMotion = 'none' | 'drift';

export interface Branding {
  watermarkText: string;
  watermarkPosition: WatermarkPosition;
  textCase: TextCase;
  /** Lyric size multiplier, 0.8..1.6. */
  textScale: number;
  /** Slow pan across still-image backgrounds. */
  backgroundMotion: BackgroundMotion;
  /** 0..0.8 darkening applied over the background so white lyrics stay readable. */
  backgroundDim: number;
  /** Used when no background asset is chosen. */
  backgroundColor: string;
  lyricPosition: LyricPosition;
  fontFamily: string;
}

export interface Project {
  id: string;
  title: string;
  artist: string;
  lyrics: string;
  stylePrompt: string;
  providerId: string | null;
  providerJobId: string | null;
  chosenAudioAssetId: string | null;
  backgroundAssetId: string | null;
  rightsNotes: string;
  branding: Branding;
  youtubeVideoId: string | null;
  /** ISO-8601 UTC. Null until a release is scheduled (Phase 4). */
  releaseAtUtc: string | null;
  releaseTimezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail {
  project: Project;
  assets: Asset[];
  cues: LyricCue[];
  renders: RenderOutput[];
  approvals: Approval[];
  jobs: Job[];
}

export type JobType = 'generation' | 'download' | 'render' | 'upload' | 'schedule';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  /** Local, reversible job stopped by an app exit. Safe to start again manually. */
  | 'interrupted'
  /** Irreversible/external job whose outcome is unknown. Must be checked before any retry. */
  | 'needs_reconcile';

export interface Job {
  id: string;
  projectId: string | null;
  type: JobType;
  status: JobStatus;
  progress: number;
  externalId: string | null;
  error: string | null;
  input: unknown;
  output: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RenderOutput {
  id: string;
  projectId: string;
  jobId: string;
  fileName: string;
  sizeBytes: number;
  verified: boolean;
  probe: RenderProbe | null;
  createdAt: string;
}

export interface RenderProbe {
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  durationSec: number;
}

export type ApprovalKind = 'generation' | 'final_review' | 'upload' | 'schedule';

export interface Approval {
  id: string;
  projectId: string;
  kind: ApprovalKind;
  snapshot: unknown;
  createdAt: string;
}

export interface Settings {
  ffmpegPath: string | null;
  ffprobePath: string | null;
  defaultTimezone: string;
  defaultArtist: string;
  /** Max provider generations allowed per rolling 24 hours (applies to every provider, mock included). */
  generationLimitPer24h: number;
  defaultBranding: Branding;
}

export interface ToolStatus {
  ok: boolean;
  path: string;
  version: string | null;
  error: string | null;
  hasSubtitlesFilter: boolean;
}

export type ProviderState = 'ready' | 'not_configured' | 'error';

export interface ProviderInfo {
  id: string;
  label: string;
  isMock: boolean;
  state: ProviderState;
  detail: string;
}

export interface GenerationPreview {
  token: string;
  providerId: string;
  providerLabel: string;
  isMock: boolean;
  title: string;
  lyrics: string;
  stylePrompt: string;
  count: number;
  /** Null when the provider has not published a cost we can trust. */
  costText: string | null;
  usedLast24h: number;
  limitPer24h: number;
}

export interface DashboardSummary {
  projectCount: number;
  recentProjects: Project[];
  attentionJobs: Job[];
  ffmpeg: ToolStatus;
  providers: ProviderInfo[];
}

export interface RenderProgressEvent {
  jobId: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
}
