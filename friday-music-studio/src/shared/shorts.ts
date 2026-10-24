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
function repeatedBlock(timed: LyricCue[]): { index: number; len: number; count: number } | null {
  const t = timed.map((c) => norm(c.text));
  const n = t.length;
  let best: { index: number; len: number; count: number; score: number } | null = null;
  for (let len = Math.min(8, Math.floor(n / 2)); len >= 2; len--) {
    for (let i = 0; i + len <= n; i++) {
      const key = t.slice(i, i + len).join('|');
      let count = 1;
      for (let j = i + len; j + len <= n; ) {
        if (t.slice(j, j + len).join('|') === key) {
          count++;
          j += len;
        } else j++;
      }
      const score = len * count;
      if (count >= 2 && (!best || score > best.score)) best = { index: i, len, count, score };
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
