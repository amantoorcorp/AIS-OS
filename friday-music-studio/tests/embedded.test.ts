import { describe, expect, it } from 'vitest';
import { matchEmbedded, parseSrt, usableEntries } from '../src/shared/embedded';
import { autoTimeFromEmbedded } from '../src/main/autotime';

const SRT = `1
00:00:01,596 --> 00:00:01,596
[Intro — soft]

2
00:00:01,596 --> 00:00:04,309
Da-da, daylight

3
00:00:04,309 --> 00:00:09,654
Coming through the blinds

4
00:00:09,654 --> 00:00:10,200
You can keep your almost

5
00:00:10,200 --> 00:00:14,000
You can keep your almost

6
00:00:14,000 --> 00:00:20,500
This morning's mine
`;

describe('embedded lyrics', () => {
  it('parses SRT and drops section tags and repeated entries (keeping the longer)', () => {
    const e = usableEntries(parseSrt(SRT));
    expect(e.map((x) => x.text)).toEqual(['Da-da, daylight', 'Coming through the blinds', 'You can keep your almost', "This morning's mine"]);
    expect(e[2]).toMatchObject({ startMs: 10_200, endMs: 14_000 });
    expect(e[0]).toMatchObject({ startMs: 1596, endMs: 4309 });
  });

  it('matches lyric lines in order and gives null to lines Suno did not include', () => {
    const e = usableEntries(parseSrt(SRT));
    const m = matchEmbedded(['Da-da, daylight', 'A line that is not there at all', 'Coming through the blinds', "This morning's mine"], e);
    expect(m.map((x) => x?.text ?? null)).toEqual(['Da-da, daylight', null, 'Coming through the blinds', "This morning's mine"]);
  });

  it('times from the window: heard onset wins, otherwise a quarter in, ends before the next cue', async () => {
    const e = usableEntries(parseSrt(SRT));
    const lines = ['Da-da, daylight', 'Coming through the blinds'];
    const ears = {
      hear: async () => [
        { text: 'Coming', startMs: 7000, endMs: 7400 }, { text: 'through', startMs: 7400, endMs: 7800 },
        { text: 'the', startMs: 7800, endMs: 8000 }, { text: 'blinds', startMs: 8000, endMs: 9000 },
      ],
      close: async () => {},
    };
    const r = await autoTimeFromEmbedded(lines, matchEmbedded(lines, e), ears, 30_000);
    const [a, b] = r.lines;
    expect(b!.estimated).toBeUndefined();
    expect(b!.startMs).toBe(7000);
    expect(a!.estimated).toBe(true);
    expect(a!.startMs).toBeGreaterThan(1596);
    expect(a!.endMs).toBeLessThan(b!.startMs);
    expect(b!.endMs).toBeLessThanOrEqual(9654);
  });

  it('works without a speech model', async () => {
    const e = usableEntries(parseSrt(SRT));
    const lines = ['Da-da, daylight'];
    const r = await autoTimeFromEmbedded(lines, matchEmbedded(lines, e), null, 30_000);
    expect(r.lines[0]!.timed).toBe(true);
  });
});
