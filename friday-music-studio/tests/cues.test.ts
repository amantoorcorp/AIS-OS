import { describe, expect, it } from 'vitest';
import { activeCue, BASE_FONT_PX, cuesFromLyrics, distributeEvenly, formatMs, layoutCue, MIN_FONT_PX, parseTime, validateCues } from '../src/shared/cues';

let n = 0;
const mk = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

describe('cues', () => {
  it('builds cues from lyrics and skips section tags', () => {
    const cues = cuesFromLyrics('[Verse 1]\nHello night\n\n(Chorus)\nWe run\r\nforever', mk);
    expect(cues.map((c) => c.text)).toEqual(['Hello night', 'We run', 'forever']);
    expect(cues.every((c) => c.startMs === 0 && c.endMs === 0)).toBe(true);
  });

  it('never wraps, shrinks long lines, caps at two lines', () => {
    expect(layoutCue('short').fontPx).toBe(BASE_FONT_PX);
    const long = layoutCue('this is a much longer lyric line than usual okay');
    expect(long.fontPx).toBeLessThan(BASE_FONT_PX);
    expect(long.fontPx).toBeGreaterThanOrEqual(MIN_FONT_PX);
    expect(layoutCue('a\nb\nc').lines).toEqual(['a', 'b']);
  });

  it('validates overlap, ordering, line count and audio bounds', () => {
    const issues = validateCues(
      [
        { id: 'a', startMs: 0, endMs: 2000, text: 'one' },
        { id: 'b', startMs: 1500, endMs: 3000, text: 'two\nthree\nfour' },
        { id: 'c', startMs: 4000, endMs: 3500, text: 'back' },
        { id: 'd', startMs: 9000, endMs: 12000, text: 'late' },
      ],
      10_000,
    );
    const msg = (id: string) => issues.filter((i) => i.cueId === id && i.level === 'error').map((i) => i.message);
    expect(msg('a')).toContain('Overlaps the next cue.');
    expect(msg('b').some((m) => m.includes('3 lines'))).toBe(true);
    expect(msg('c')).toContain('End time must be after start time.');
    expect(msg('d')).toContain('Cue ends after the audio ends.');
  });

  it('distributes evenly without overlap', () => {
    const cues = distributeEvenly(cuesFromLyrics('a\nb\nc\nd', mk), 1000, 9000);
    expect(validateCues(cues, 10_000).filter((i) => i.level === 'error')).toEqual([]);
    expect(cues[0]!.startMs).toBe(1000);
    expect(activeCue(cues, 3100)?.text).toBe('b');
  });

  it('formats and parses times', () => {
    expect(formatMs(83_456)).toBe('01:23.456');
    expect(parseTime('01:23.456')).toBe(83_456);
    expect(parseTime('1:02.5')).toBe(62_500);
    expect(parseTime('12.25')).toBe(12_250);
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
