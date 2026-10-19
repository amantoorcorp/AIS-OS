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
/** fill: crop the picture to cover the frame. whole: show the entire picture, blurred copy behind it. */
export type BackgroundFit = 'fill' | 'whole';

export interface Branding {
  watermarkText: string;
  watermarkPosition: WatermarkPosition;
  textCase: TextCase;
  /** Lyric size multiplier, 0.4..2. */
  textScale: number;
  /** Slow pan across still-image backgrounds. */
  backgroundMotion: BackgroundMotion;
  backgroundFit: BackgroundFit;
  /** 0..0.8 darkening applied over the background so white lyrics stay readable. */
  backgroundDim: number;
  /** Used when no background asset is chosen. */
  backgroundColor: string;
  lyricPosition: LyricPosition;
  /** Moves the lyrics sideways, as a % of frame width (-45 left .. 45 right). */
  lyricOffsetX: number;
  /** Moves the lyrics up or down, as a % of frame height (-45 up .. 45 down). */
  lyricOffsetY: number;
  fontFamily: string;
  /** Lyric colour, #RRGGBB. */
  lyricColor: string;
  lyricBold: boolean;
  /** Extra space between letters, in px of a 1080p frame (0..20). */
  letterSpacing: number;
  /** Dark outline around each letter, in px of a 1080p frame (0..12). */
  lyricOutline: number;
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

export type RenderQuality = '1080p' | '4k';

/** Automatic check run after every export so colour problems are caught without eyeballing. */
export interface QualityCheck {
  /** The file is tagged as BT.709 matrix, sRGB transfer, BT.709 primaries, limited range. */
  tagsOk: boolean;
  /** Picture fidelity of the export pipeline against the source picture, in dB (higher is better). Null when not measurable. */
  psnrDb: number | null;
  verdict: 'excellent' | 'good' | 'warning' | 'not_measured';
  note: string;
}

export interface RenderProbe {
  check?: QualityCheck;
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

/** Result of auto lyric timing. Nothing is saved; the user reviews the cues first. */
export interface AutoTimeResponse {
  cues: LyricCue[];
  /** Cues recognised only with the lyrics as a hint. Real timing, but check them by ear. */
  hintedCueIds: string[];
  /** Cues placed by estimate because nothing was heard there. Check these by ear. */
  estimatedCueIds: string[];
  /** Lyric lines that were not heard in the audio, in song order. */
  unheardLines: string[];
  coverage: number;
  /** suno_embedded: timed lyrics found inside the audio file. speech: heard by the local speech model. */
  source: 'suno_embedded' | 'speech';
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
