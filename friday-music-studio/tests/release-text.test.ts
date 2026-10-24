import { describe, expect, it } from 'vitest';
import { buildReleaseText, hashtagSlug, lyricsForDescription } from '../src/shared/release-text';

const base = {
  artist: 'HEATDRIFT',
  songTitle: 'Day Light',
  lyrics: '[Intro]\nDa-da, daylight\nComing through the blinds\n\n[Verse 1]\nTwo cups sitting by the kitchen sink\n\n\n(Outro)\nThis morning\'s mine',
  genreTags: '#deephouse #englishdeephouse',
  subscribeUrl: 'https://www.youtube.com/@HEATDRIFT?sub_confirmation=1',
  streamUrl: '',
  aiCredit: 'Made with AI tools (Suno). The picture is AI-generated.',
};

describe('release text', () => {
  it('uses the Artist - Song (Lyrics) title and three hashtags first', () => {
    const r = buildReleaseText(base);
    expect(r.title).toBe('HEATDRIFT - Day Light (Lyrics)');
    expect(r.topHashtags).toEqual(['#heatdrift', '#daylight', '#lyrics']);
    expect(r.description.split('\n')[0]).toBe('#heatdrift #daylight #lyrics');
    expect(r.description).toContain('🎵 Subscribe for a new track every week: https://www.youtube.com/@HEATDRIFT?sub_confirmation=1');
    expect(r.description).toContain('🎧 HEATDRIFT - Day Light (Lyrics)');
    expect(r.description).not.toContain('⏬'); // no stream link given
    expect(r.description.endsWith('Made with AI tools (Suno). The picture is AI-generated.')).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('drops section tags and collapses blank lines in the lyrics', () => {
    expect(lyricsForDescription(base.lyrics)).toBe("Da-da, daylight\nComing through the blinds\n\nTwo cups sitting by the kitchen sink\n\nThis morning's mine");
  });

  it('adds the stream line when a link is given', () => {
    expect(buildReleaseText({ ...base, streamUrl: 'https://example.com/song' }).description).toContain('⏬ Stream / Download: https://example.com/song');
  });

  it('shortens a title over 100 characters and warns', () => {
    const r = buildReleaseText({ ...base, songTitle: 'x'.repeat(150) });
    expect(r.title.length).toBeLessThanOrEqual(100);
    expect(r.title.endsWith('(Lyrics)')).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/shortened/);
  });

  it('keeps the description within 5000 characters and keeps the tail', () => {
    const r = buildReleaseText({ ...base, lyrics: 'la la la\n'.repeat(2000) });
    expect(r.description.length).toBeLessThanOrEqual(5000);
    expect(r.description.endsWith(base.aiCredit)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/cut/);
  });

  it('blocks another channel name and asks for an artist', () => {
    expect(buildReleaseText({ ...base, artist: '7clouds' }).warnings.join(' ')).toMatch(/another channel/);
    expect(buildReleaseText({ ...base, artist: '' }).warnings.join(' ')).toMatch(/artist/);
    expect(hashtagSlug("Heater on Low!")).toBe('heateronlow');
  });
});

import { buildShortCaptions } from '../src/shared/release-text';
import { clampShort, cuesForWindow, hookLine, suggestHookStart } from '../src/shared/shorts';

describe('short captions', () => {
  const input = { artist: 'HEATDRIFT', songTitle: 'Day Light', hook: 'No more maybe', fullVideoUrl: 'https://youtu.be/abc', genreTags: '#deephouse #englishdeephouse' };
  it('writes a YouTube Shorts title and description and a TikTok caption', () => {
    const r = buildShortCaptions(input);
    expect(r.youtubeTitle).toBe('HEATDRIFT - Day Light #Shorts');
    expect(r.youtubeDescription).toContain('"No more maybe"');
    expect(r.youtubeDescription).toContain('▶ Full song: https://youtu.be/abc');
    expect(r.youtubeDescription).toContain('#shorts #deephouse #englishdeephouse #newmusic #originalsong');
    expect(r.tiktokCaption).toContain('Full song on YouTube: https://youtu.be/abc');
    expect(r.tiktokCaption.split('\n').pop()!.split(' ').length).toBeLessThanOrEqual(5); // few hashtags
    expect(r.warnings).toEqual([]);
  });
  it('warns when the full-video link is missing and blocks another channel name', () => {
    expect(buildShortCaptions({ ...input, fullVideoUrl: '' }).warnings.join(' ')).toMatch(/link/);
    expect(buildShortCaptions({ ...input, artist: '7clouds' }).warnings.join(' ')).toMatch(/another channel/);
  });
});

describe('short helpers', () => {
  const cue = (id: string, s: number, e: number, text: string) => ({ id, startMs: s, endMs: e, text });
  const cues = [cue('a', 1000, 3000, 'verse one'), cue('b', 5000, 7000, 'No more maybe'), cue('c', 9000, 11000, 'verse two'), cue('d', 13000, 15000, 'no more maybe!')];
  it('finds the hook and starts a little before it', () => {
    expect(hookLine(cues)).toBe('No more maybe');
    expect(suggestHookStart(cues)).toBe(3500);
    expect(suggestHookStart([cue('x', 2000, 3000, 'only once')])).toBe(500);
  });
  it('prefers a repeated block of lines (the chorus) over a short repeated line', () => {
    const c = (i: number, text: string) => ({ id: String(i), startMs: i * 4000, endMs: i * 4000 + 3000, text });
    const lines = ['da da daylight', 'verse a', 'verse b', 'no more maybe', 'saving you a seat', 'got my hands up', 'da da daylight', 'verse c', 'no more maybe', 'saving you a seat', 'got my hands up', 'da da daylight'];
    const cs = lines.map((l, i) => c(i, l));
    expect(hookLine(cs)).toBe('no more maybe');
    expect(suggestHookStart(cs)).toBe(3 * 4000 - 1500);
  });
  it('cuts cues to a window and moves it to start at zero', () => {
    const w = cuesForWindow(cues, 4000, 6000);
    expect(w.map((c) => [c.id, c.startMs, c.endMs])).toEqual([['b', 1000, 3000], ['c', 5000, 6000]]);
  });
  it('keeps a window inside the song and inside the Shorts limits', () => {
    expect(clampShort({ startMs: 100_000, lengthMs: 60_000, focusX: 2, focusY: 0.5, zoom: 1, fit: 'fill' }, 120_000)).toEqual({ startMs: 60_000, lengthMs: 60_000, focusX: 1, focusY: 0.5, zoom: 1, fit: 'fill' });
    expect(clampShort({ startMs: 0, lengthMs: 999_999, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'whole' }, 600_000).lengthMs).toBe(180_000);
    expect(clampShort({ startMs: 0, lengthMs: 1000, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill' }, 600_000).lengthMs).toBe(5000);
  });
});

import { snapWindow, suggestShortParts } from '../src/shared/shorts';

describe('best parts of a song', () => {
  // A 120 s song: lines every 3 s. Chorus lines repeat at 30-54 s and 78-102 s; the second is louder.
  const lines: string[] = [];
  const cues = Array.from({ length: 40 }, (_, k) => {
    const t = k * 3000;
    const chorus = (t >= 30_000 && t < 54_000) || (t >= 78_000 && t < 102_000);
    const idx = t >= 78_000 ? (t - 78_000) / 3000 : (t - 30_000) / 3000;
    lines.push(chorus ? `chorus line ${idx}` : `other line ${k}`);
    return { id: String(k), startMs: t, endMs: t + 2800, text: chorus ? `chorus line ${idx}` : `other line ${k}` };
  });
  const peaks = Array.from({ length: 600 }, (_, i) => {
    const t = i * 200;
    if (t >= 78_000 && t < 102_000) return 0.9;
    if (t >= 30_000 && t < 54_000) return 0.6;
    return 0.4;
  });

  it('puts the loudest repeat of the chorus first, starting at a line and ending at a line', () => {
    const s = suggestShortParts({ cues, peaks, durationMs: 120_000 });
    expect(s[0]!.label).toBe('Chorus');
    expect(s[0]!.startMs).toBe(78_000);
    expect((s[0]!.startMs + s[0]!.lengthMs) % 3000).toBe(2800); // ends where a line ends
    expect(s[0]!.lengthMs).toBeGreaterThanOrEqual(5000);
    expect(s[0]!.lengthMs).toBeLessThanOrEqual(180_000);
  });

  it('never offers two parts that mostly overlap, and keeps every part inside the song', () => {
    const s = suggestShortParts({ cues, peaks, durationMs: 120_000 });
    expect(s.length).toBeGreaterThanOrEqual(2);
    for (const a of s) {
      expect(a.startMs).toBeGreaterThanOrEqual(0);
      expect(a.startMs + a.lengthMs).toBeLessThanOrEqual(120_000);
      for (const b of s) {
        if (a === b) continue;
        const ov = Math.min(a.startMs + a.lengthMs, b.startMs + b.lengthMs) - Math.max(a.startMs, b.startMs);
        expect(ov).toBeLessThanOrEqual(Math.min(a.lengthMs, b.lengthMs) * 0.5);
      }
    }
  });

  it('snaps to lines only when one is close, and returns nothing for a song with no waveform', () => {
    expect(snapWindow(cues, 77_000, 30_000)).toEqual({ startMs: 78_000, lengthMs: 29_800 });
    expect(snapWindow([], 1234, 30_000)).toEqual({ startMs: 1234, lengthMs: 30_000 });
    expect(suggestShortParts({ cues, peaks: [], durationMs: 120_000 })).toEqual([]);
  });
});
