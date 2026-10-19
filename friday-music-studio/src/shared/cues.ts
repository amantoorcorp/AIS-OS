// Pure lyric-cue logic shared by the preview (renderer) and the export (main).
// Both sides use layoutCue() so the preview matches the MP4.

import type { LyricCue } from './types';

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const BASE_FONT_PX = 84;
export const MIN_FONT_PX = 52;
/** Characters per line that fit at BASE_FONT_PX inside the safe area. */
export const COMFORT_CHARS = 34;
/** Beyond this a line is rejected: it would be unreadably small. */
export const MAX_LINE_CHARS = 56;
export const MAX_LINES = 2;

export interface CueLayout {
  lines: string[];
  fontPx: number;
}

export function splitCueLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export interface LayoutOptions {
  upper?: boolean;
  /** Size multiplier, 0.4..2. */
  scale?: number;
  /** Sideways move of the lyrics in px of the 1920-wide frame. Lines shrink so they stay inside the frame. */
  offsetXPx?: number;
}

/** Side margin kept free on each side of the frame when lyrics are moved sideways. */
const EDGE_MARGIN_PX = 60;
/** Usable width of a centred line before it starts to shrink (matches COMFORT_CHARS). */
const COMFORT_WIDTH_PX = 1680;
/** Smallest size a line may shrink to when it has to fit beside the edge. */
const MIN_EDGE_FONT_PX = 24;

/** Splits one line at the space nearest its middle. Returns it unchanged when there is no space. */
function balancedSplit(line: string): string[] {
  const chars = [...line];
  const mid = chars.length / 2;
  let best = -1;
  chars.forEach((c, i) => {
    if (c === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  });
  return best < 0 ? [line] : [chars.slice(0, best).join('').trim(), chars.slice(best + 1).join('').trim()];
}

/**
 * Long lines shrink the font instead of wrapping. The one exception: when the lyrics are moved
 * toward an edge there is little room, so a single long line is split in two balanced lines first.
 */
export function layoutCue(text: string, opts: LayoutOptions = {}): CueLayout {
  const scale = Math.min(2, Math.max(0.4, opts.scale ?? 1));
  let lines = splitCueLines(text).slice(0, MAX_LINES);
  if (opts.upper) lines = lines.map((l) => l.toLocaleUpperCase());
  let longest = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
  const base = Math.round(BASE_FONT_PX * scale);
  // Capitals run wider, so they get fewer characters per line before shrinking.
  // Moving sideways leaves less room on one side; text is centred on its anchor, so room = twice the nearer edge.
  const cx = VIDEO_WIDTH / 2 + (opts.offsetXPx ?? 0);
  const room = 2 * Math.max(0, Math.min(cx, VIDEO_WIDTH - cx) - EDGE_MARGIN_PX);
  const roomFactor = Math.min(1, Math.max(0.1, room / COMFORT_WIDTH_PX));
  const comfort = (COMFORT_CHARS * (opts.upper ? 0.85 : 1) * roomFactor) / scale;
  if (roomFactor < 1 && lines.length === 1 && longest > comfort) {
    lines = balancedSplit(lines[0]!);
    longest = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
  }
  let fontPx = base;
  if (longest > comfort) {
    const floor = Math.min(base, roomFactor < 1 ? MIN_EDGE_FONT_PX : MIN_FONT_PX);
    fontPx = Math.max(floor, Math.floor((base * comfort) / longest));
  }
  return { lines, fontPx };
}

export type CueIssueLevel = 'error' | 'warning';

export interface CueIssue {
  cueId: string | null;
  level: CueIssueLevel;
  message: string;
}

export function validateCues(cues: LyricCue[], audioDurationMs: number | null): CueIssue[] {
  const issues: CueIssue[] = [];
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  sorted.forEach((cue, i) => {
    const lines = splitCueLines(cue.text);
    if (lines.length === 0) issues.push({ cueId: cue.id, level: 'error', message: 'Cue has no text.' });
    if (lines.length > MAX_LINES)
      issues.push({ cueId: cue.id, level: 'error', message: `Cue has ${lines.length} lines; maximum is ${MAX_LINES}.` });
    for (const line of lines) {
      const n = [...line].length;
      if (n > MAX_LINE_CHARS)
        issues.push({ cueId: cue.id, level: 'error', message: `Line is ${n} characters; split it (max ${MAX_LINE_CHARS}).` });
      else if (n > COMFORT_CHARS)
        issues.push({ cueId: cue.id, level: 'warning', message: `Long line (${n} chars) will render smaller.` });
    }
    if (!(cue.endMs > cue.startMs))
      issues.push({ cueId: cue.id, level: 'error', message: 'End time must be after start time.' });
    else if (cue.endMs - cue.startMs < 300)
      issues.push({ cueId: cue.id, level: 'warning', message: 'Cue is shown for under 0.3s.' });
    if (cue.startMs < 0) issues.push({ cueId: cue.id, level: 'error', message: 'Start time is negative.' });
    if (audioDurationMs != null && cue.endMs > audioDurationMs + 1)
      issues.push({ cueId: cue.id, level: 'error', message: 'Cue ends after the audio ends.' });
    const next = sorted[i + 1];
    if (next && cue.endMs > next.startMs)
      issues.push({ cueId: cue.id, level: 'error', message: 'Overlaps the next cue.' });
  });
  return issues;
}

const SECTION_TAG = /^\s*[[(].*[\])]\s*$/;

/**
 * One cue per lyric line, section tags like [Chorus] skipped. Timings are left
 * at zero-length placeholders: lyrics on paper rarely match the sung timing,
 * so the user must sync them (tap-sync or manual edit).
 */
export function cuesFromLyrics(lyrics: string, makeId: () => string): LyricCue[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !SECTION_TAG.test(l))
    .map((text) => ({ id: makeId(), startMs: 0, endMs: 0, text }));
}

/** Optional rough timing: spread cues evenly over [startMs, endMs]. Always editable afterwards. */
export function distributeEvenly(cues: LyricCue[], startMs: number, endMs: number, gapMs = 150): LyricCue[] {
  if (cues.length === 0 || endMs <= startMs) return cues;
  const slot = (endMs - startMs) / cues.length;
  return cues.map((c, i) => {
    const s = Math.round(startMs + i * slot);
    const e = Math.round(startMs + (i + 1) * slot - Math.min(gapMs, slot / 4));
    return { ...c, startMs: s, endMs: Math.max(e, s + 1) };
  });
}

export function activeCue(cues: LyricCue[], timeMs: number): LyricCue | null {
  for (const c of cues) if (timeMs >= c.startMs && timeMs < c.endMs) return c;
  return null;
}

/** mm:ss.mmm */
export function formatMs(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const m = Math.floor(safe / 60000);
  const s = Math.floor((safe % 60000) / 1000);
  const milli = safe % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(milli).padStart(3, '0')}`;
}

/** Accepts "m:ss", "m:ss.mmm", "ss.mmm" or plain seconds. Returns null when unparseable. */
export function parseTime(input: string): number | null {
  const t = input.trim();
  const m = /^(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  if (m[1] && seconds >= 60) return null;
  const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0;
  return minutes * 60000 + seconds * 1000 + frac;
}

/** Moves every cue by deltaMs (negative = earlier). Cues stay inside [0, durationMs] and keep their length where possible. */
export function shiftCues(cues: LyricCue[], deltaMs: number, durationMs: number | null): LyricCue[] {
  const max = durationMs ?? Number.POSITIVE_INFINITY;
  return cues
    .map((c) => {
      const len = c.endMs - c.startMs;
      const start = Math.min(Math.max(0, c.startMs + deltaMs), Math.max(0, max - 1));
      const end = Math.min(max, Math.max(start + 1, c.endMs + deltaMs));
      return { ...c, startMs: Math.round(start), endMs: Math.round(Math.max(end, Math.min(max, start + Math.min(len, 1)))) };
    })
    .sort((a, b) => a.startMs - b.startMs);
}
