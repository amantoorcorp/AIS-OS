// Suno writes the song's lyrics into the audio file as a timed text track.
// Each entry runs from the end of the previous line to the end of this one, so
// the END is reliable but the START includes any pause or instrumental before
// the singer comes in. These helpers read that track and match it to the
// project's lyric lines.

import { wordsOf } from './align';

export interface EmbeddedLine {
  startMs: number;
  endMs: number;
  text: string;
}

const SECTION_TAG = /^\s*[[(].*[\])]\s*$/;
const MIN_MATCH = 0.6;

function srtTime(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms.padEnd(3, '0').slice(0, 3));
}

/** Parses ffmpeg's SRT output. Unreadable blocks are skipped. */
export function parseSrt(srt: string): EmbeddedLine[] {
  const out: EmbeddedLine[] = [];
  for (const block of srt.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/)) {
    const lines = block.split('\n');
    const m = /(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/.exec(lines[1] ?? '');
    if (!m) continue;
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) out.push({ startMs: srtTime(m[1]!, m[2]!, m[3]!, m[4]!), endMs: srtTime(m[5]!, m[6]!, m[7]!, m[8]!), text });
  }
  return out;
}

/** Drops [Section] tags and zero-length entries; of consecutive repeats keeps the longer one. */
export function usableEntries(entries: EmbeddedLine[]): EmbeddedLine[] {
  const out: EmbeddedLine[] = [];
  for (const e of entries) {
    if (SECTION_TAG.test(e.text) || e.endMs <= e.startMs) continue;
    const prev = out[out.length - 1];
    if (prev && wordsOf(prev.text).join(' ') === wordsOf(e.text).join(' ')) {
      if (e.endMs - e.startMs > prev.endMs - prev.startMs) out[out.length - 1] = e;
      continue;
    }
    out.push(e);
  }
  return out;
}

function similarity(a: string, b: string): number {
  const x = new Set(wordsOf(a));
  const y = new Set(wordsOf(b));
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(x.size, y.size);
}

/** Matches each lyric line to an embedded entry, in order. Lines with no counterpart get null. */
export function matchEmbedded(lines: string[], entries: EmbeddedLine[]): (EmbeddedLine | null)[] {
  const n = lines.length;
  const m = entries.length;
  const W = m + 1;
  const H = new Float32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = similarity(lines[i - 1]!, entries[j - 1]!.text);
      const diag = s >= MIN_MATCH ? H[(i - 1) * W + j - 1]! + s : -1;
      H[i * W + j] = Math.max(diag, H[(i - 1) * W + j]!, H[i * W + j - 1]!);
    }
  }
  const out = new Array<EmbeddedLine | null>(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const s = similarity(lines[i - 1]!, entries[j - 1]!.text);
    const here = H[i * W + j]!;
    if (s >= MIN_MATCH && here === H[(i - 1) * W + j - 1]! + s) {
      out[i - 1] = entries[j - 1]!;
      i--;
      j--;
    } else if (here === H[(i - 1) * W + j]!) i--;
    else j--;
  }
  return out;
}
