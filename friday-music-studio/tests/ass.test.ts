import { describe, expect, it } from 'vitest';
import { assTime, buildAss, sanitizeAssText } from '../src/main/render/ass';
import { DEFAULT_BRANDING, skyLyricBranding } from '../src/shared/defaults';

describe('ass', () => {
  it('formats centisecond timestamps', () => {
    expect(assTime(0)).toBe('0:00:00.00');
    expect(assTime(3_723_450)).toBe('1:02:03.45');
  });

  it('neutralises override tags', () => {
    expect(sanitizeAssText('{\\pos(1,1)}hi')).not.toMatch(/[{}\\]/);
  });

  it('emits 1080p script with two-line cues, skipping untimed ones', () => {
    const ass = buildAss(
      [
        { id: '1', startMs: 1000, endMs: 2500, text: 'line one\nline two' },
        { id: '2', startMs: 0, endMs: 0, text: 'untimed' },
      ],
      { ...DEFAULT_BRANDING, watermarkText: 'My Channel' },
      10_000,
    );
    expect(ass).toContain('PlayResX: 1920');
    expect(ass).toContain('PlayResY: 1080');
    expect(ass).toContain('WrapStyle: 2');
    expect(ass).toContain('0:00:01.00,0:00:02.50,Lyric');
    expect(ass).toContain('line one\\Nline two');
    expect(ass).not.toContain('untimed');
    expect(ass).toContain(',Mark,,0,0,0,,My Channel');
    expect(ass).toMatch(/\\fad\(180,180\)/);
  });

  it('applies sky-lyric options: capitals, bottom-right logo, bundled font', () => {
    const ass = buildAss(
      [{ id: '1', startMs: 0, endMs: 3000, text: 'we chase the light' }],
      skyLyricBranding({ ...DEFAULT_BRANDING, watermarkText: 'Friday' }),
      5000,
    );
    expect(ass).toContain('WE CHASE THE LIGHT');
    expect(ass).toContain('Style: Lyric,Permanent Marker,84,');
    expect(ass).toContain('{\\fs126');
    expect(ass).toMatch(/Style: Mark,[^\n]*,3,60,60,50,1/);
  });
});
