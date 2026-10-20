// Sandboxed preload. Exposes a fixed set of named methods; the renderer cannot
// pick arbitrary channels, send paths, or reach Node/Electron APIs directly.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Branding, LyricCue, RenderProgressEvent } from '../shared/types';

const EVENT_RENDER_PROGRESS = 'event:render-progress';
const EVENT_JOBS_CHANGED = 'event:jobs-changed';

type Patch = Partial<{
  title: string;
  artist: string;
  lyrics: string;
  stylePrompt: string;
  rightsNotes: string;
  chosenAudioAssetId: string | null;
  backgroundAssetId: string | null;
  branding: Branding;
}>;

const call = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api = {
  dashboard: () => call('dashboard:get'),
  listProjects: () => call('projects:list'),
  getProject: (projectId: string) => call('projects:get', { projectId }),
  createProject: (title: string, artist: string) => call('projects:create', { title, artist }),
  updateProject: (projectId: string, patch: Patch) => call('projects:update', { projectId, patch }),
  archiveProject: (projectId: string) => call('projects:archive', { projectId }),
  importAsset: (projectId: string, kind: 'audio' | 'image' | 'video') => call('assets:import', { projectId, kind }),
  importLogo: (projectId: string) => call('assets:importLogo', { projectId }),
  importPreset: (projectId: string, presetId: string) => call('assets:importPreset', { projectId, presetId }),
  autoTimeCues: (projectId: string, estimateMissing: boolean) => call('cues:autoTime', { projectId, estimateMissing }),
  saveCues: (projectId: string, cues: LyricCue[]) => call('cues:save', { projectId, cues }),
  startRender: (projectId: string, quality: '1080p' | '4k') => call('render:start', { projectId, quality }),
  cancelRender: (jobId: string) => call('render:cancel', { jobId }),
  saveRenderCopy: (outputId: string) => call('render:saveCopy', { outputId }),
  revealRender: (outputId: string) => call('render:reveal', { outputId }),
  listJobs: (projectId?: string) => call('jobs:list', projectId ? { projectId } : {}),
  listProviders: () => call('providers:list'),
  prepareGeneration: (projectId: string, providerId: string) => call('generation:prepare', { projectId, providerId }),
  approveAndSubmitGeneration: (projectId: string, token: string) => call('generation:approveAndSubmit', { projectId, token }),
  refreshGeneration: (jobId: string) => call('generation:refresh', { jobId }),
  approveFinalReview: (projectId: string, outputId: string) =>
    call('review:approveFinal', { projectId, outputId, checks: { watchedFullVideo: true, lyricsMatchVocals: true, rightsReviewed: true } }),
  getSettings: () => call('settings:get'),
  updateSettings: (patch: Record<string, unknown>) => call('settings:update', patch),
  pickBinary: (which: 'ffmpeg' | 'ffprobe') => call('settings:pickBinary', { which }),
  resetBinary: (which: 'ffmpeg' | 'ffprobe') => call('settings:resetBinary', { which }),
  checkTools: () => call('settings:checkTools'),
  getLibrary: () => call('library:get'),
  openLibrary: () => call('library:open'),
  pickLibrary: () => call('library:pick'),
  exportDiagnostics: () => call('diagnostics:export'),
  onRenderProgress: (cb: (e: RenderProgressEvent) => void) => {
    const listener = (_e: IpcRendererEvent, payload: RenderProgressEvent) => cb(payload);
    ipcRenderer.on(EVENT_RENDER_PROGRESS, listener);
    return (): void => {
      ipcRenderer.removeListener(EVENT_RENDER_PROGRESS, listener);
    };
  },
  onJobsChanged: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on(EVENT_JOBS_CHANGED, listener);
    return (): void => {
      ipcRenderer.removeListener(EVENT_JOBS_CHANGED, listener);
    };
  },
};

export type FridayApi = typeof api;

contextBridge.exposeInMainWorld('friday', api);
