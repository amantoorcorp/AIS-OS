// Pure lyric-to-transcript alignment. A speech model hears the sung words with
// timestamps; the user's lyrics say what the words should be. This matches the
// two in order, so each lyric line gets the time it is actually sung. Lines the
// singer never sings (Suno often skips sections) come back as unmatched.

import type { LyricCue } from './types';

export interface HeardWord {
  text: string;
  startMs: number;
  endMs: number;
  /** Speech-model confidence 0..1, when known. Low-confidence words are ignored. */
  prob?: number;
}

export interface AlignedLine {
  text: string;
  /** True when enough of the line was heard in the audio. */
  timed: boolean;
  startMs: number;
  endMs: number;
  /**
   * True when the speech model only recognised the line with the lyrics given as a hint.
   * Such timing is real but less certain, so the user should check it by ear.
   */
  hinted?: boolean;
}

export interface AlignResult {
  lines: AlignedLine[];
  /** Fraction of lyric lines that were found in the audio. */
  coverage: number;
}

export interface AlignOptions {
  audioDurationMs: number | null;
  /** Share of a line's word weight that must be heard to count as sung. */
  minLineShare?: number;
}

const GAP = -0.4;
const MISMATCH = -1.5;
const MIN_SIM = 0.7;
const MIN_PROB = 0.25;
/** Heard words of one line further apart than this belong to different places in the song. */
const MAX_WORD_GAP_MS = 4000;
const MIN_CUE_MS = 400;
const HOLD_MS = 500;
const SEPARATION_MS = 80;

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/'/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Splits text into normalised words. "Da-da" gives two words. */
export function wordsOf(text: string): string[] {
  return text
    .split(/[\s\-—–]+/)
    .map(normalizeWord)
    .filter((w) => w.length > 0);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 3 || b.length < 3) return 0;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** Long, rare words say more than "i" or "no". */
function weight(w: string): number {
  return 1 + Math.min(w.length, 6) * 0.4;
}

interface LyricWord {
  word: string;
  line: number;
}

export function alignLyrics(lines: string[], heard: HeardWord[], opts: AlignOptions): AlignResult {
  const minShare = opts.minLineShare ?? 0.4;
  const lw: LyricWord[] = [];
  lines.forEach((text, line) => wordsOf(text).forEach((word) => lw.push({ word, line })));
  const hw = heard
    .map((h) => ({ ...h, word: normalizeWord(h.text) }))
    .filter((h) => h.word.length > 0 && (h.prob ?? 1) >= MIN_PROB)
    .sort((a, b) => a.startMs - b.startMs);

  const n = lw.length;
  const m = hw.length;
  const score = (i: number, j: number): number => {
    const sim = similarity(lw[i]!.word, hw[j]!.word);
    return sim >= MIN_SIM ? weight(lw[i]!.word) * sim : MISMATCH;
  };

  // Needleman-Wunsch with cheap gaps. 0 = diagonal, 1 = skip lyric word, 2 = skip heard word.
  const W = m + 1;
  const H = new Float32Array((n + 1) * W);
  const back = new Uint8Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    H[i * W] = i * GAP;
    back[i * W] = 1;
  }
  for (let j = 1; j <= m; j++) {
    H[j] = j * GAP;
    back[j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = H[(i - 1) * W + j - 1]! + score(i - 1, j - 1);
      const up = H[(i - 1) * W + j]! + GAP;
      const left = H[i * W + j - 1]! + GAP;
      let best = diag;
      let dir = 0;
      if (up > best) {
        best = up;
        dir = 1;
      }
      if (left > best) {
        best = left;
        dir = 2;
      }
      H[i * W + j] = best;
      back[i * W + j] = dir;
    }
  }

  // Walk back, recording which heard word each lyric word landed on (-1 = not heard).
  const matchOf = new Array<number>(n).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = back[i * W + j]!;
    if (i > 0 && j > 0 && dir === 0) {
      if (similarity(lw[i - 1]!.word, hw[j - 1]!.word) >= MIN_SIM) matchOf[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && (dir === 1 || j === 0)) i--;
    else j--;
  }

  const out: AlignedLine[] = lines.map((text) => ({ text, timed: false, startMs: 0, endMs: 0 }));
  const byLine = new Map<number, number[]>();
  lw.forEach((w, idx) => {
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line)!.push(idx);
  });

  byLine.forEach((idxs, line) => {
    const total = idxs.reduce((s, k) => s + weight(lw[k]!.word), 0);
    const hits = idxs.filter((k) => matchOf[k]! >= 0).map((k) => ({ k, h: hw[matchOf[k]!]! }));
    if (hits.length === 0) return;
    hits.sort((a, b) => a.h.startMs - b.h.startMs);

    // Keep the largest cluster of heard words that sit close together in time.
    const clusters: (typeof hits)[] = [[hits[0]!]];
    for (let x = 1; x < hits.length; x++) {
      const last = clusters[clusters.length - 1]!;
      if (hits[x]!.h.startMs - last[last.length - 1]!.h.endMs > MAX_WORD_GAP_MS) clusters.push([hits[x]!]);
      else last.push(hits[x]!);
    }
    const share = (c: typeof hits) => c.reduce((s, x) => s + weight(lw[x.k]!.word), 0) / total;
    const best = clusters.reduce((a, b) => (share(b) > share(a) ? b : a));
    if (share(best) < minShare) return;

    const target = out[line]!;
    target.timed = true;
    target.startMs = best[0]!.h.startMs;
    target.endMs = best[best.length - 1]!.h.endMs;
  });

  // Order, spacing and a short hold so lyrics do not flicker.
  const timed = out.filter((l) => l.timed).sort((a, b) => a.startMs - b.startMs);
  const limit = opts.audioDurationMs ?? Number.POSITIVE_INFINITY;
  timed.forEach((l, idx) => {
    const next = timed[idx + 1];
    const ceiling = next ? next.startMs - SEPARATION_MS : limit;
    const wanted = Math.max(l.endMs + HOLD_MS, l.startMs + MIN_CUE_MS);
    l.endMs = Math.max(l.startMs + 1, Math.min(wanted, ceiling, limit));
  });
  for (const l of timed) {
    if (l.startMs >= limit) l.timed = false;
  }

  return { lines: out, coverage: lines.length === 0 ? 0 : out.filter((l) => l.timed).length / lines.length };
}

/** Turns aligned lines into cues, skipping lines that were not heard. */
export function cuesFromAlignment(result: AlignResult, makeId: () => string): LyricCue[] {
  return result.lines
    .filter((l) => l.timed && l.endMs > l.startMs)
    .map((l) => ({ id: makeId(), startMs: Math.round(l.startMs), endMs: Math.round(l.endMs), text: l.text }));
}
