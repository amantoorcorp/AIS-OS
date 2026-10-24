// Typed wrapper over the preload bridge. Unwraps { ok, data | error } replies.
import type { FridayApi } from '../preload/preload';
import type { MixInfo, SongAnalysis } from '../shared/mix';
import type { IpcResult } from '../shared/ipc';
import type {
  Approval,
  Asset,
  AutoTimeResponse,
  DashboardSummary,
  GenerationPreview,
  Job,
  LyricCue,
  Project,
  ProjectDetail,
  ProviderInfo,
  RenderOutput,
  RenderProgressEvent,
  Settings,
  ToolStatus,
} from '../shared/types';

declare global {
  interface Window {
    friday: FridayApi;
  }
}

const b = () => window.friday;

async function u<T>(p: Promise<unknown>): Promise<T> {
  const r = (await p) as IpcResult<T>;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export const api = {
  dashboard: () => u<DashboardSummary>(b().dashboard()),
  listProjects: () => u<Project[]>(b().listProjects()),
  getProject: (id: string) => u<ProjectDetail>(b().getProject(id)),
  createProject: (title: string, artist: string) => u<Project>(b().createProject(title, artist)),
  updateProject: (id: string, patch: Parameters<FridayApi['updateProject']>[1]) => u<Project>(b().updateProject(id, patch)),
  archiveProject: (id: string) => u<void>(b().archiveProject(id)),
  importAsset: (id: string, kind: 'audio' | 'image' | 'video') => u<Asset | null>(b().importAsset(id, kind)),
  importLogo: (id: string) => u<Asset | null>(b().importLogo(id)),
  importPreset: (id: string, presetId: string) => u<Asset>(b().importPreset(id, presetId)),
  autoTimeCues: (id: string, estimateMissing: boolean) => u<AutoTimeResponse>(b().autoTimeCues(id, estimateMissing)),
  saveCues: (id: string, cues: LyricCue[]) => u<void>(b().saveCues(id, cues)),
  startRender: (id: string, quality: '1080p' | '4k', short?: { startMs: number; lengthMs: number; focusX: number; focusY: number; zoom: number; fit: 'fill' | 'whole'; backgroundAssetId?: string | null }) => u<{ jobId: string }>(b().startRender(id, quality, short)),
  cancelRender: (jobId: string) => u<boolean>(b().cancelRender(jobId)),
  saveRenderCopy: (outputId: string) => u<string | null>(b().saveRenderCopy(outputId)),
  revealRender: (outputId: string) => u<boolean>(b().revealRender(outputId)),
  listJobs: (projectId?: string) => u<Job[]>(b().listJobs(projectId)),
  listProviders: () => u<ProviderInfo[]>(b().listProviders()),
  prepareGeneration: (id: string, providerId: string) => u<GenerationPreview>(b().prepareGeneration(id, providerId)),
  approveAndSubmitGeneration: (id: string, token: string) => u<Job>(b().approveAndSubmitGeneration(id, token)),
  refreshGeneration: (jobId: string) => u<Job>(b().refreshGeneration(jobId)),
  approveFinalReview: (id: string, outputId: string) => u<Approval>(b().approveFinalReview(id, outputId)),
  getSettings: () => u<Settings>(b().getSettings()),
  updateSettings: (patch: Partial<Omit<Settings, 'ffmpegPath' | 'ffprobePath' | 'libraryDir'>>) => u<Settings>(b().updateSettings(patch)),
  pickBinary: (which: 'ffmpeg' | 'ffprobe') => u<Settings>(b().pickBinary(which)),
  resetBinary: (which: 'ffmpeg' | 'ffprobe') => u<Settings>(b().resetBinary(which)),
  checkTools: () => u<ToolStatus>(b().checkTools()),
  analyzeMix: (projectIds: string[]) => u<(SongAnalysis & { projectId: string; title: string })[]>(b().analyzeMix(projectIds)),
  pickMixPicture: () => u<{ token: string; name: string } | null>(b().pickMixPicture()),
  createMix: (title: string, projectIds: string[], crossfadeMs: number, auto: boolean, matchTempo: boolean, picture: { type: 'first' } | { type: 'preset'; id: string } | { type: 'upload'; token: string }) =>
    u<{ project: Project; mix: MixInfo }>(b().createMix(title, projectIds, crossfadeMs, auto, matchTempo, picture)),
  getMix: (projectId: string) => u<MixInfo | null>(b().getMix(projectId)),
  songPeaks: (id: string) => u<{ peaks: number[]; durationMs: number }>(b().songPeaks(id)),
  getLibrary: () => u<{ dir: string }>(b().getLibrary()),
  openLibrary: () => u<boolean>(b().openLibrary()),
  pickLibrary: () => u<{ dir: string } | null>(b().pickLibrary()),
  exportDiagnostics: () => u<string | null>(b().exportDiagnostics()),
  onRenderProgress: (cb: (e: RenderProgressEvent) => void) => b().onRenderProgress(cb),
  onJobsChanged: (cb: () => void) => b().onJobsChanged(cb),
};

export const assetUrl = (assetId: string) => `fms-media://asset/${assetId}`;
export const renderUrl = (outputId: string) => `fms-media://render/${outputId}`;
export type { RenderOutput };
