// Long mixes: several songs one after another, blended with a crossfade, as one long video.
// This file plans the timing. The song that follows starts while the previous one fades out, so each
// song begins at (sum of earlier lengths) minus (one crossfade per earlier song).

import type { LyricCue } from './types';

export const MIX_MIN_SONGS = 2;
export const MIX_MAX_SONGS = 40;
export const MIX_MAX_CROSSFADE_MS = 15_000;
/** The crossfade may not be longer than this share of the shortest song, or songs would blur together. */
const MAX_SHARE_OF_SONG = 0.34;

export interface MixTrackPlan {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface MixPlan {
  crossfadeMs: number;
  tracks: MixTrackPlan[];
  totalMs: number;
}

/** Keeps the crossfade inside sensible limits for these songs. */
export function clampCrossfade(crossfadeMs: number, durationsMs: number[]): number {
  const shortest = durationsMs.length ? Math.min(...durationsMs) : 0;
  const cap = Math.min(MIX_MAX_CROSSFADE_MS, Math.floor(shortest * MAX_SHARE_OF_SONG));
  return Math.max(0, Math.min(Math.round(Number.isFinite(crossfadeMs) ? crossfadeMs : 0), cap));
}

export function planMix(durationsMs: number[], crossfadeMs: number): MixPlan {
  const x = clampCrossfade(crossfadeMs, durationsMs);
  let at = 0;
  const tracks = durationsMs.map((d, i) => {
    const startMs = i === 0 ? 0 : at;
    const endMs = startMs + d;
    at = endMs - x;
    return { startMs, endMs, durationMs: d };
  });
  return { crossfadeMs: x, tracks, totalMs: tracks.length ? tracks[tracks.length - 1]!.endMs : 0 };
}

/** Lyric cues of every song, moved to where that song starts in the mix, with no cue overlapping the next. */
export function mergeMixCues(songs: { startMs: number; endMs: number; cues: LyricCue[] }[], makeId: () => string): LyricCue[] {
  const out: LyricCue[] = [];
  songs.forEach((song, i) => {
    const nextStart = songs[i + 1]?.startMs ?? Number.POSITIVE_INFINITY;
    for (const c of song.cues) {
      if (c.endMs <= c.startMs) continue;
      const start = c.startMs + song.startMs;
      if (start >= nextStart - 200) continue; // belongs to a part already blended into the next song
      out.push({ id: makeId(), startMs: Math.round(start), endMs: Math.round(Math.min(c.endMs + song.startMs, song.endMs)), text: c.text });
    }
  });
  out.sort((a, b) => a.startMs - b.startMs);
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i]!.endMs > out[i + 1]!.startMs - 50) out[i]!.endMs = Math.max(out[i]!.startMs + 1, out[i + 1]!.startMs - 50);
  }
  return out.filter((c) => c.endMs - c.startMs >= 200);
}

/** m:ss, or h:mm:ss for a mix longer than an hour, in the form YouTube turns into chapters. */
export function chapterTime(ms: number, withHours: boolean): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return withHours ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/**
 * Tracklist lines. YouTube makes them chapters when the first is 00:00, there are at least three,
 * and each lasts at least 10 seconds.
 */
export function tracklist(tracks: { title: string; artist?: string; startMs: number }[], totalMs: number): string {
  const withHours = totalMs >= 3_600_000;
  return tracks.map((t) => `${chapterTime(t.startMs, withHours)} ${t.artist ? `${t.artist} - ` : ''}${t.title}`).join('\n');
}

export interface MixInfo {
  title: string;
  crossfadeMs: number;
  totalMs: number;
  tracks: { projectId: string; title: string; artist: string; startMs: number; endMs: number; durationMs: number }[];
  tracklist: string;
  createdAt: string;
}
