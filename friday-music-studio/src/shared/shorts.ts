// Shorts (vertical 9:16 clips for YouTube Shorts and TikTok): which part of the song, how it is framed,
// and the lyric cues that fall inside it. Pure functions shared by the app and tests.

import { splitCueLines } from './cues';
import type { LyricCue } from './types';

export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;
export const SHORT_MIN_MS = 5_000;
export const SHORT_MAX_MS = 180_000;
export const SHORT_DEFAULT_MS = 30_000;

export interface ShortSpec {
  startMs: number;
  lengthMs: number;
  /** Which part of a wider picture to keep when cropping to 9:16: 0 = left edge, 1 = right edge. */
  focusX: number;
  /** Same for the vertical direction: 0 = top, 1 = bottom. Matters once the picture is zoomed in. */
  focusY: number;
  /** 1 = the picture just fills the frame, 3 = three times closer. */
  zoom: number;
  /** A different picture for the Short than the video's background. Null or missing = the video's background. */
  backgroundAssetId?: string | null;
  /** fill = crop the picture to fill the frame. whole = whole picture across the middle with a blurred copy above and below. */
  fit: 'fill' | 'whole';
}

/** Keeps a requested window inside the song and inside the Shorts limits. */
export function clampShort(spec: ShortSpec, audioMs: number): ShortSpec {
  const length = Math.round(Math.min(SHORT_MAX_MS, Math.max(SHORT_MIN_MS, spec.lengthMs, 0), Math.max(SHORT_MIN_MS, audioMs)));
  const start = Math.round(Math.min(Math.max(0, spec.startMs), Math.max(0, audioMs - length)));
  const unit = (v: number, d: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
  return {
    startMs: start,
    lengthMs: Math.min(length, Math.max(1, audioMs - start)),
    focusX: unit(spec.focusX, 0.5),
    focusY: unit(spec.focusY, 0.5),
    zoom: Number.isFinite(spec.zoom) ? Math.min(3, Math.max(1, spec.zoom)) : 1,
    fit: spec.fit,
    ...(spec.backgroundAssetId ? { backgroundAssetId: spec.backgroundAssetId } : {}),
  };
}

/** Cues that overlap the window, moved so the window starts at 0 and cut to its length. */
export function cuesForWindow(cues: LyricCue[], startMs: number, lengthMs: number): LyricCue[] {
  const end = startMs + lengthMs;
  return cues
    .filter((c) => c.endMs > startMs && c.startMs < end && c.endMs > c.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((c) => ({ ...c, startMs: Math.max(c.startMs, startMs) - startMs, endMs: Math.min(c.endMs, end) - startMs }))
    .filter((c) => c.endMs - c.startMs >= 200);
}

const norm = (t: string) => splitCueLines(t).join(' ').toLowerCase().replace(/[^a-z0-9 ]+/g, '').trim();

/**
 * The chorus: the block of consecutive lines that repeats, preferring long blocks that repeat often.
 * Repeats may differ slightly in punctuation. Returns the index of the block's first cue, or null.
 */
function repeatedBlock(timed: LyricCue[]): { index: number; len: number; count: number; starts: number[] } | null {
  const t = timed.map((c) => norm(c.text));
  const n = t.length;
  let best: { index: number; len: number; count: number; score: number; starts: number[] } | null = null;
  for (let len = Math.min(8, Math.floor(n / 2)); len >= 2; len--) {
    for (let i = 0; i + len <= n; i++) {
      const key = t.slice(i, i + len).join('|');
      let count = 1;
      const starts = [i];
      for (let j = i + len; j + len <= n; ) {
        if (t.slice(j, j + len).join('|') === key) {
          count++;
          starts.push(j);
          j += len;
        } else j++;
      }
      const score = len * count;
      if (count >= 2 && (!best || score > best.score)) best = { index: i, len, count, score, starts };
    }
  }
  return best;
}

/** The line the song repeats most, as written. Empty when nothing repeats. */
export function hookLine(cues: LyricCue[]): string {
  const timed = [...cues].filter((c) => c.endMs > c.startMs && norm(c.text)).sort((a, b) => a.startMs - b.startMs);
  const block = repeatedBlock(timed);
  if (block) return splitCueLines(timed[block.index]!.text).join(' ');
  const counts = new Map<string, { n: number; text: string }>();
  for (const c of timed) {
    const k = norm(c.text);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { n: 1, text: splitCueLines(c.text).join(' ') });
  }
  let best: { n: number; text: string } | null = null;
  for (const e of counts.values()) if (e.n >= 2 && (!best || e.n > best.n)) best = e;
  return best?.text ?? '';
}

/**
 * Suggests where a Short should start: the chorus (a repeated block of lines), a little before its first
 * sung time. Falls back to the most repeated single line, then to the first cue.
 */
export function suggestHookStart(cues: LyricCue[], leadMs = 1500): number {
  const timed = [...cues].filter((c) => c.endMs > c.startMs && norm(c.text)).sort((a, b) => a.startMs - b.startMs);
  if (timed.length === 0) return 0;
  const block = repeatedBlock(timed);
  if (block) return Math.max(0, timed[block.index]!.startMs - leadMs);
  const counts = new Map<string, { n: number; first: number }>();
  for (const c of timed) {
    const k = norm(c.text);
    const e = counts.get(k);
    if (e) e.n++;
    else counts.set(k, { n: 1, first: c.startMs });
  }
  let best: { n: number; first: number } | null = null;
  for (const e of counts.values()) if (e.n >= 2 && (!best || e.n > best.n || (e.n === best.n && e.first < best.first))) best = e;
  return Math.max(0, (best ?? { first: timed[0]!.startMs }).first - leadMs);
}


export interface PartSuggestion {
  label: string;
  why: string;
  startMs: number;
  lengthMs: number;
}

const mean = (peaks: number[], from: number, to: number) => {
  const n = peaks.length;
  const a = Math.max(0, Math.min(n - 1, from));
  const b = Math.max(a + 1, Math.min(n, to));
  let sum = 0;
  for (let i = a; i < b; i++) sum += peaks[i]!;
  return sum / (b - a);
};

/**
 * Moves a window so it starts at a line (not mid-word) and ends at the end of a line, when a cue boundary is
 * close. Keeps the length inside the Shorts limits.
 */
export function snapWindow(cues: LyricCue[], startMs: number, lengthMs: number, reachMs = 3000): { startMs: number; lengthMs: number } {
  const timed = cues.filter((c) => c.endMs > c.startMs);
  const nearest = (values: number[], target: number) => values.reduce<number | null>((best, v) => (Math.abs(v - target) <= reachMs && (best === null || Math.abs(v - target) < Math.abs(best - target)) ? v : best), null);
  const start = nearest(timed.map((c) => c.startMs), startMs) ?? startMs;
  const end = nearest(timed.map((c) => c.endMs), startMs + lengthMs) ?? startMs + lengthMs;
  const length = Math.min(SHORT_MAX_MS, Math.max(SHORT_MIN_MS, end - start));
  return { startMs: Math.max(0, start), lengthMs: length };
}

/**
 * Picks the best parts of a song for a Short, best first, from the lyrics and the loudness:
 * - the chorus, using the repeat that is loudest (usually the last, fullest one),
 * - the loudest stretch of the song,
 * - the opening, where the first line starts.
 * Parts that overlap an earlier pick by more than half are dropped. Starts and ends are snapped to lines.
 */
export function suggestShortParts(opts: { cues: LyricCue[]; peaks: number[]; durationMs: number; lengthMs?: number; max?: number }): PartSuggestion[] {
  const { cues, peaks, durationMs } = opts;
  const length = Math.min(SHORT_MAX_MS, Math.max(SHORT_MIN_MS, opts.lengthMs ?? SHORT_DEFAULT_MS));
  if (durationMs < SHORT_MIN_MS || peaks.length === 0) return [];
  const per = durationMs / peaks.length; // ms per peak
  const energy = (startMs: number, lenMs: number) => mean(peaks, Math.floor(startMs / per), Math.ceil((startMs + lenMs) / per));
  const timed = [...cues].filter((c) => c.endMs > c.startMs && norm(c.text)).sort((a, b) => a.startMs - b.startMs);
  const out: PartSuggestion[] = [];
  const add = (label: string, why: string, rawStart: number) => {
    const s = clampShort({ startMs: rawStart, lengthMs: length, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs);
    const w = snapWindow(timed, s.startMs, s.lengthMs);
    const fit = clampShort({ startMs: w.startMs, lengthMs: w.lengthMs, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, durationMs);
    const overlaps = out.some((o) => {
      const ov = Math.min(o.startMs + o.lengthMs, fit.startMs + fit.lengthMs) - Math.max(o.startMs, fit.startMs);
      return ov > Math.min(o.lengthMs, fit.lengthMs) * 0.5;
    });
    if (!overlaps) out.push({ label, why, startMs: fit.startMs, lengthMs: fit.lengthMs });
  };

  const block = repeatedBlock(timed);
  if (block) {
    const starts = block.starts.map((i) => timed[i]!.startMs);
    const best = starts.reduce((a, b) => (energy(b, length) > energy(a, length) ? b : a));
    add('Chorus', `The lines this song repeats ${block.count} times. This is the fullest repeat.`, best - 1000);
  }
  // Loudest stretch: slide a window across the song, one second at a time.
  let loud = 0;
  let loudAt = -1;
  for (let t = 0; t + length <= durationMs; t += 1000) {
    const e = energy(t, length);
    if (e > loud) {
      loud = e;
      loudAt = t;
    }
  }
  if (loudAt >= 0) add('Loudest part', 'The most energetic stretch of the song.', loudAt);
  if (timed[0]) add('Opening', 'Starts at the first line, so people hear the voice straight away.', timed[0].startMs - 500);
  // A quieter, emotional option: the bridge, found as the lowest-energy long stretch that still has lyrics.
  if (timed.length >= 6) {
    let calm = Infinity;
    let calmAt = -1;
    for (const c of timed) {
      if (c.startMs + length > durationMs) continue;
      const e = energy(c.startMs, length);
      if (e < calm) {
        calm = e;
        calmAt = c.startMs;
      }
    }
    if (calmAt >= 0) add('Calm moment', 'The softest part that still has words.', calmAt);
  }
  return out.slice(0, opts.max ?? 4);
}
