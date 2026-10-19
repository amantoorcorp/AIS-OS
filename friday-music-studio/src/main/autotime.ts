// Auto lyric timing. Pass 1 hears the whole song and matches the words it is
// sure about. Sung or heavily produced vocals are often called "music" by the
// speech model, so pass 2 re-listens to each unmatched stretch with the
// expected lyrics as a hint. A hint can make the model repeat the hint over
// silence, so those lines are flagged "hinted" and the user checks them by ear.

import { alignLyrics, type AlignedLine } from '../shared/align';
import type { Ears } from './transcribe';

/** whisper's prompt holds ~224 tokens; stay well under it. */
const MAX_PROMPT_WORDS = 110;
const MIN_WINDOW_MS = 2000;
/** The model's output is sensitive to where the slice starts, so try a few starts. */
const START_SHIFTS_MS = [0, 600, -600, 1200, -1200];
const GOOD_ENOUGH = 0.8;

export interface AutoTimeResult {
  lines: AlignedLine[];
  coverage: number;
}

export interface AutoTimeOptions {
  /** Place lines nobody heard between their timed neighbours instead of dropping them. */
  estimateMissing?: boolean;
}

export async function autoTimeLines(lines: string[], ears: Ears, durationMs: number, opts: AutoTimeOptions = {}): Promise<AutoTimeResult> {
  const first = alignLyrics(lines, await ears.hear(0, null), { audioDurationMs: durationMs });
  const out = first.lines.map((l) => ({ ...l }));

  let i = 0;
  while (i < out.length) {
    if (out[i]!.timed) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !out[j]!.timed) j++;
    const from = out[i - 1] ? out[i - 1]!.endMs : 0;
    const to = out[j] ? out[j]!.startMs : durationMs;
    if (to - from >= MIN_WINDOW_MS) {
      const runLines = out.slice(i, j).map((l) => l.text);
      const prompt = runLines.join(' ').split(/\s+/).slice(0, MAX_PROMPT_WORDS).join(' ');
      let best: AlignedLine[] | null = null;
      let bestCount = 0;
      for (const shift of START_SHIFTS_MS) {
        const start = Math.max(0, from + shift);
        if (to - start < MIN_WINDOW_MS) continue;
        const second = alignLyrics(runLines, await ears.hear(start, to, prompt), { audioDurationMs: to });
        const count = second.lines.filter((l) => l.timed).length;
        if (count > bestCount) {
          best = second.lines;
          bestCount = count;
        }
        if (count / runLines.length >= GOOD_ENOUGH) break;
      }
      best?.forEach((l, k) => {
        if (l.timed) out[i + k] = { ...l, endMs: Math.min(l.endMs, to), hinted: true };
      });
    }
    i = j;
  }

  const coverage = out.length === 0 ? 0 : out.filter((l) => l.timed).length / out.length;
  if (opts.estimateMissing) estimateMissing(out, durationMs);
  return { lines: out, coverage };
}

const ESTIMATE_MARGIN_MS = 300;
const ESTIMATE_GAP_MS = 150;
const MIN_ESTIMATE_MS = 700;

/**
 * Lines the model could not hear at all. If the user knows they are sung (quiet or stylised
 * vocals), spread each stretch of them over the gap between its timed neighbours, in
 * proportion to line length. Flagged "estimated" so they are checked by ear.
 */
function estimateMissing(out: AlignedLine[], durationMs: number): void {
  let i = 0;
  while (i < out.length) {
    if (out[i]!.timed) {
      i++;
      continue;
    }
    let j = i;
    while (j < out.length && !out[j]!.timed) j++;
    const from = (out[i - 1] ? out[i - 1]!.endMs : 0) + (out[i - 1] ? ESTIMATE_GAP_MS : 0);
    const to = (out[j] ? out[j]!.startMs : durationMs) - (out[j] ? ESTIMATE_GAP_MS : 0);
    const run = out.slice(i, j);
    if (to - from >= run.length * MIN_ESTIMATE_MS) {
      const start = from + (out[i - 1] ? 0 : ESTIMATE_MARGIN_MS);
      const weights = run.map((l) => Math.max(4, l.text.replace(/\s/g, '').length));
      const total = weights.reduce((a, b) => a + b, 0);
      const slot = (to - start) / total;
      let at = start;
      run.forEach((l, k) => {
        const len = slot * weights[k]!;
        out[i + k] = { ...l, timed: true, estimated: true, startMs: Math.round(at), endMs: Math.round(at + len - ESTIMATE_GAP_MS) };
        at += len;
      });
    }
    i = j;
  }
}
