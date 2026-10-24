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
  /** Length of this song in the mix, after any tempo change. */
  durationMs: number;
}

export interface MixPlan {
  /** Blend length before each song after the first, in ms. Index 0 is unused (0). */
  fadesMs: number[];
  tracks: MixTrackPlan[];
  totalMs: number;
}

/** Keeps one crossfade inside sensible limits for the two songs it joins. */
export function clampFade(fadeMs: number, aMs: number, bMs: number): number {
  const cap = Math.min(MIX_MAX_CROSSFADE_MS, Math.floor(Math.min(aMs, bMs) * MAX_SHARE_OF_SONG));
  return Math.max(0, Math.min(Math.round(Number.isFinite(fadeMs) ? fadeMs : 0), cap));
}

/** Keeps the crossfade inside sensible limits for these songs (the shortest song sets the cap). */
export function clampCrossfade(crossfadeMs: number, durationsMs: number[]): number {
  const shortest = durationsMs.length ? Math.min(...durationsMs) : 0;
  return clampFade(crossfadeMs, shortest, shortest);
}

/**
 * Where each song starts. Each song after the first starts while the previous one fades out, so it starts at
 * (end of the previous song) minus (the blend between them). fadeMs is one length for every blend, or one per song.
 */
export function planMix(durationsMs: number[], fadeMs: number | number[]): MixPlan {
  const fades = durationsMs.map((d, i) => {
    if (i === 0) return 0;
    const want = Array.isArray(fadeMs) ? (fadeMs[i] ?? 0) : fadeMs;
    return clampFade(want, durationsMs[i - 1]!, d);
  });
  let at = 0;
  const tracks = durationsMs.map((d, i) => {
    const startMs = i === 0 ? 0 : at - fades[i]!;
    const endMs = startMs + d;
    at = endMs;
    return { startMs, endMs, durationMs: d };
  });
  return { fadesMs: fades, tracks, totalMs: tracks.length ? tracks[tracks.length - 1]!.endMs : 0 };
}

/** How quiet the start and end of a song are: time until it gets going, and time it spends winding down. */
export function introOutro(peaks: number[], durationMs: number): { introMs: number; outroMs: number } {
  if (peaks.length < 8 || durationMs <= 0) return { introMs: 0, outroMs: 0 };
  const sorted = [...peaks].sort((a, b) => a - b);
  const thr = sorted[Math.floor(sorted.length * 0.75)]! * 0.5;
  const per = durationMs / peaks.length;
  const smooth = (i: number) => (peaks[Math.max(0, i - 1)]! + peaks[i]! + peaks[Math.min(peaks.length - 1, i + 1)]!) / 3;
  let first = 0;
  while (first < peaks.length - 1 && smooth(first) < thr) first++;
  let last = peaks.length - 1;
  while (last > first && smooth(last) < thr) last--;
  return { introMs: Math.round(first * per), outroMs: Math.round((peaks.length - 1 - last) * per) };
}

/** A blend as long as the quiet parts it joins (the outgoing outro and the incoming intro), between 4 and 12 seconds. */
export function autoFadeMs(outroMs: number, introMs: number): number {
  return Math.max(4000, Math.min(12_000, Math.round(Math.min(outroMs, introMs) * 0.9)));
}

/** Stretch needed to bring a song to the previous song's tempo. 1 = leave it alone (too far apart, or unsure). */
export function tempoRatio(prevBpm: number | null, bpm: number | null, maxStretch = 0.06): number {
  if (!prevBpm || !bpm) return 1;
  const r = prevBpm / bpm;
  return Math.abs(r - 1) <= maxStretch ? r : 1;
}

export interface SongAnalysis {
  durationMs: number;
  bpm: number | null;
  /** Below about 1.5 the tempo is a guess and is not used. */
  bpmConfidence: number;
  introMs: number;
  outroMs: number;
}

export interface MixOptions {
  /** One blend length for every song change, used when auto is off. */
  crossfadeMs: number;
  /** Pick each blend from the quiet intro and outro of the two songs. */
  auto: boolean;
  /** Bring each song to the previous song's tempo (up to 6%). */
  matchTempo: boolean;
}

export interface MixPlanFull extends MixPlan {
  /** Playback speed of each song in the mix (1 = unchanged). */
  ratios: number[];
}

const MIN_BPM_CONFIDENCE = 1.5;

/** Everything the mix needs to know: speed of each song, blend before each song, and where each song starts. */
export function planWithAnalysis(songs: SongAnalysis[], opts: MixOptions): MixPlanFull {
  const ratios: number[] = [];
  let prevBpm: number | null = null;
  songs.forEach((s, i) => {
    const bpm = s.bpm && s.bpmConfidence >= MIN_BPM_CONFIDENCE ? s.bpm : null;
    const r = opts.matchTempo && i > 0 ? tempoRatio(prevBpm, bpm) : 1;
    ratios.push(r);
    prevBpm = bpm ? bpm * r : null;
  });
  const lengths = songs.map((s, i) => Math.round(s.durationMs / ratios[i]!));
  const fades = songs.map((s, i) => (i === 0 ? 0 : opts.auto ? autoFadeMs(songs[i - 1]!.outroMs / ratios[i - 1]!, s.introMs / ratios[i]!) : opts.crossfadeMs));
  return { ...planMix(lengths, fades), ratios };
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
  /** Blend lengths before each song after the first. */
  fadesMs: number[];
  auto: boolean;
  totalMs: number;
  tracks: { projectId: string; title: string; artist: string; startMs: number; endMs: number; durationMs: number; bpm: number | null; tempoRatio: number }[];
  tracklist: string;
  createdAt: string;
}
