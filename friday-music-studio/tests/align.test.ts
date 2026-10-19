import { describe, expect, it } from 'vitest';
import { alignLyrics, cuesFromAlignment, similarity, wordsOf, type HeardWord } from '../src/shared/align';
import { parseWhisperWords } from '../src/main/transcribe';
import { autoTimeLines } from '../src/main/autotime';
import type { Ears } from '../src/main/transcribe';

const w = (text: string, startMs: number, endMs: number, prob?: number): HeardWord => ({ text, startMs, endMs, ...(prob !== undefined ? { prob } : {}) });

describe('wordsOf / similarity', () => {
  it('normalises case, punctuation and hyphens', () => {
    expect(wordsOf("Da-da, Daylight! I'm")).toEqual(['da', 'da', 'daylight', 'im']);
  });
  it('tolerates a one-letter mishear but not a different word', () => {
    expect(similarity('colour', 'colur')).toBeGreaterThan(0.7);
    expect(similarity('maybe', 'seat')).toBeLessThan(0.7);
  });
});

describe('alignLyrics', () => {
  const lines = ['No more maybe', 'Give me something real', 'Da-da, daylight', 'This morning is mine'];

  it('times heard lines and leaves unsung lines out', () => {
    const heard = [
      w('No', 1000, 1200), w('more', 1200, 1500), w('maybe', 1500, 2200),
      w('Give', 3000, 3300), w('me', 3300, 3500), w('something', 3500, 4000), w('real', 4000, 4600),
    ];
    const r = alignLyrics(lines, heard, { audioDurationMs: 20_000 });
    expect(r.lines.map((l) => l.timed)).toEqual([true, true, false, false]);
    expect(r.lines[0]!.startMs).toBe(1000);
    expect(r.lines[1]!.startMs).toBe(3000);
    expect(r.coverage).toBeCloseTo(0.5);
  });

  it('survives a mis-heard word and keeps cues in order without overlap', () => {
    const heard = [w('No', 1000, 1200), w('more', 1200, 1500), w('maybe', 1500, 2200), w('give', 2300, 2600), w('me', 2600, 2800), w('something', 2800, 3300), w('reel', 3300, 3800)];
    const cues = cuesFromAlignment(alignLyrics(lines.slice(0, 2), heard, { audioDurationMs: 10_000 }), () => 'id');
    expect(cues).toHaveLength(2);
    expect(cues[0]!.endMs).toBeLessThanOrEqual(cues[1]!.startMs);
    expect(cues.every((c) => c.endMs > c.startMs)).toBe(true);
  });

  it('does not match a line from one stray word', () => {
    const r = alignLyrics(['I want something I can feel'], [w('feel', 5000, 5500)], { audioDurationMs: 9000 });
    expect(r.lines[0]!.timed).toBe(false);
  });

  it('ignores low-confidence words and noise', () => {
    const heard = [w('No', 1000, 1200, 0.05), w('more', 1200, 1500, 0.05), w('maybe', 1500, 2200, 0.05)];
    expect(alignLyrics(['No more maybe'], heard, { audioDurationMs: 9000 }).lines[0]!.timed).toBe(false);
  });

  it('never ends a cue after the audio ends', () => {
    const heard = [w('This', 9000, 9300), w('morning', 9300, 9800), w('is', 9800, 9900), w('mine', 9900, 10_000)];
    const r = alignLyrics(['This morning is mine'], heard, { audioDurationMs: 10_100 });
    expect(r.lines[0]!.endMs).toBeLessThanOrEqual(10_100);
  });

  it('repeated chorus lines are matched in order, not all to the first one', () => {
    const chorus = ['No more maybe', 'Give me something real'];
    const heard = [
      w('No', 1000, 1100), w('more', 1100, 1300), w('maybe', 1300, 1800), w('give', 2000, 2200), w('me', 2200, 2300), w('something', 2300, 2700), w('real', 2700, 3000),
      w('no', 9000, 9100), w('more', 9100, 9300), w('maybe', 9300, 9800), w('give', 10_000, 10_200), w('me', 10_200, 10_300), w('something', 10_300, 10_700), w('real', 10_700, 11_000),
    ];
    const r = alignLyrics([...chorus, ...chorus], heard, { audioDurationMs: 20_000 });
    expect(r.lines.map((l) => Math.round(l.startMs / 1000))).toEqual([1, 2, 9, 10]);
  });
});

describe('parseWhisperWords', () => {
  it('drops music markers, strips note symbols and reads confidence', () => {
    const words = parseWhisperWords({
      transcription: [
        { text: ' (upbeat', offsets: { from: 0, to: 500 } },
        { text: ' music)', offsets: { from: 500, to: 900 } },
        { text: ' ♪ Hello', offsets: { from: 1000, to: 1400 }, tokens: [{ text: ' Hello', p: 0.8 }, { text: '[_TT_70]', p: 0.1 }] },
      ],
    });
    expect(words).toEqual([{ text: 'Hello', startMs: 1000, endMs: 1400, prob: 0.8 }]);
  });
});

describe('autoTimeLines', () => {
  const lines = ['Da-da, daylight', 'Coming through the blinds', 'No more maybe', 'Give me something real'];
  // Fake listener: hears only the last two lines, nothing at the start (quiet vocals).
  const heardWords: HeardWord[] = [
    w('No', 10_000, 10_200), w('more', 10_200, 10_500), w('maybe', 10_500, 11_200),
    w('Give', 12_000, 12_300), w('me', 12_300, 12_500), w('something', 12_500, 13_000), w('real', 13_000, 13_600),
  ];
  const ears: Ears = {
    hear: async (from, to, prompt) => (prompt ? [] : heardWords.filter((x) => x.startMs >= from && (to === null || x.endMs <= to))),
    close: async () => {},
  };

  it('leaves unheard lines out by default', async () => {
    const r = await autoTimeLines(lines, ears, 20_000);
    expect(r.lines.map((l) => l.timed)).toEqual([false, false, true, true]);
  });

  it('can place unheard lines between their neighbours, flagged as estimated', async () => {
    const r = await autoTimeLines(lines, ears, 20_000, { estimateMissing: true });
    expect(r.coverage).toBeCloseTo(0.5);
    const [a, b] = r.lines;
    expect(a!.estimated && b!.estimated).toBe(true);
    expect(a!.startMs).toBeGreaterThanOrEqual(0);
    expect(a!.endMs).toBeLessThanOrEqual(b!.startMs);
    expect(b!.endMs).toBeLessThanOrEqual(r.lines[2]!.startMs);
    expect(r.lines[2]!.estimated).toBeUndefined();
  });
});
