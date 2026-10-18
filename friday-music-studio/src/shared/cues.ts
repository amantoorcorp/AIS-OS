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

/** Lines are never auto-wrapped; long lines shrink the font instead. */
export function layoutCue(text: string): CueLayout {
  const lines = splitCueLines(text).slice(0, MAX_LINES);
  const longest = lines.reduce((m, l) => Math.max(m, [...l].length), 0);
  let fontPx = BASE_FONT_PX;
  if (longest > COMFORT_CHARS) {
    fontPx = Math.max(MIN_FONT_PX, Math.floor((BASE_FONT_PX * COMFORT_CHARS) / longest));
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
