// Every IPC channel and the Zod schema its payload must satisfy. The main
// process validates each payload against these before doing anything.
// The renderer never sends file paths, URLs or commands: files are chosen
// through native dialogs in the main process and referenced by ID.

import { z } from 'zod';

const id = z.uuid();
const shortText = (max: number) => z.string().max(max);

export const BrandingSchema = z.strictObject({
  watermarkText: shortText(80),
  watermarkPosition: z.enum(['top_left', 'bottom_right']),
  textCase: z.enum(['as_written', 'upper']),
  textScale: z.number().min(0.8).max(1.6),
  backgroundMotion: z.enum(['none', 'drift']),
  backgroundDim: z.number().min(0).max(0.8),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  lyricPosition: z.enum(['center', 'lower']),
  fontFamily: z.string().min(1).max(64).regex(/^[A-Za-z0-9 _-]+$/),
});

export const CueSchema = z.strictObject({
  id,
  startMs: z.number().int().min(0).max(24 * 3600 * 1000),
  endMs: z.number().int().min(0).max(24 * 3600 * 1000),
  text: shortText(400),
});

export const ProjectPatchSchema = z
  .strictObject({
    title: z.string().min(1).max(200),
    artist: shortText(200),
    lyrics: shortText(20_000),
    stylePrompt: shortText(2_000),
    rightsNotes: shortText(10_000),
    chosenAudioAssetId: id.nullable(),
    backgroundAssetId: id.nullable(),
    branding: BrandingSchema,
  })
  .partial();

export const channels = {
  'dashboard:get': z.undefined(),
  'projects:list': z.undefined(),
  'projects:get': z.strictObject({ projectId: id }),
  'projects:create': z.strictObject({ title: z.string().min(1).max(200), artist: shortText(200) }),
  'projects:update': z.strictObject({ projectId: id, patch: ProjectPatchSchema }),
  'projects:archive': z.strictObject({ projectId: id }),
  'assets:import': z.strictObject({ projectId: id, kind: z.enum(['audio', 'image', 'video']) }),
  'assets:importPreset': z.strictObject({ projectId: id, presetId: z.enum(['sunset', 'dusk', 'golden', 'night']) }),
  'cues:save': z.strictObject({ projectId: id, cues: z.array(CueSchema).max(2000) }),
  'render:start': z.strictObject({ projectId: id }),
  'render:cancel': z.strictObject({ jobId: id }),
  'render:saveCopy': z.strictObject({ outputId: id }),
  'render:reveal': z.strictObject({ outputId: id }),
  'jobs:list': z.strictObject({ projectId: id.optional() }),
  'providers:list': z.undefined(),
  'generation:prepare': z.strictObject({ projectId: id, providerId: z.string().min(1).max(40) }),
  'generation:approveAndSubmit': z.strictObject({ projectId: id, token: z.string().min(16).max(128) }),
  'generation:refresh': z.strictObject({ jobId: id }),
  'review:approveFinal': z.strictObject({
    projectId: id,
    outputId: id,
    checks: z.strictObject({
      watchedFullVideo: z.literal(true),
      lyricsMatchVocals: z.literal(true),
      rightsReviewed: z.literal(true),
    }),
  }),
  'settings:get': z.undefined(),
  'settings:update': z.strictObject({
    defaultTimezone: z.string().min(1).max(64).optional(),
    defaultArtist: shortText(200).optional(),
    generationLimitPer24h: z.number().int().min(0).max(50).optional(),
    defaultBranding: BrandingSchema.optional(),
  }),
  'settings:pickBinary': z.strictObject({ which: z.enum(['ffmpeg', 'ffprobe']) }),
  'settings:resetBinary': z.strictObject({ which: z.enum(['ffmpeg', 'ffprobe']) }),
  'settings:checkTools': z.undefined(),
  'diagnostics:export': z.undefined(),
} as const;

export type Channel = keyof typeof channels;
export type ChannelInput<C extends Channel> = z.infer<(typeof channels)[C]>;

export const EVENT_RENDER_PROGRESS = 'event:render-progress';
export const EVENT_JOBS_CHANGED = 'event:jobs-changed';

/** Shape of an IPC reply. Errors are redacted strings, never raw objects. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
