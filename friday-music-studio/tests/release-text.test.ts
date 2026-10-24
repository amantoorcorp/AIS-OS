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

import { chapterTime, clampCrossfade, mergeMixCues, planMix, tracklist } from '../src/shared/mix';

describe('mix planning', () => {
  it('starts each song while the previous one fades out', () => {
    const p = planMix([180_000, 200_000, 150_000], 6000);
    expect(p.fadesMs).toEqual([0, 6000, 6000]);
    expect(p.tracks.map((t) => t.startMs)).toEqual([0, 174_000, 368_000]);
    expect(p.totalMs).toBe(518_000); // 530 s of music minus two crossfades
  });
  it('keeps the crossfade inside limits', () => {
    expect(clampCrossfade(99_000, [180_000, 180_000])).toBe(15_000);
    expect(clampCrossfade(10_000, [20_000, 180_000])).toBe(6800); // at most about a third of the shortest song
    expect(clampCrossfade(-5, [60_000])).toBe(0);
    expect(planMix([], 5000).totalMs).toBe(0);
  });
  it('moves lyrics to where each song starts and removes overlaps', () => {
    const c = (id: string, s: number, e: number, t: string) => ({ id, startMs: s, endMs: e, text: t });
    let n = 0;
    const merged = mergeMixCues(
      [
        { startMs: 0, endMs: 100_000, cues: [c('a', 1000, 4000, 'one'), c('b', 96_000, 100_000, 'tail line')] },
        { startMs: 94_000, endMs: 190_000, cues: [c('c', 1000, 5000, 'two'), c('d', 90_000, 99_000, 'end')] },
      ],
      () => `id${n++}`,
    );
    expect(merged.map((m) => m.text)).toEqual(['one', 'two', 'end']); // 'tail line' started inside the blend and is dropped
    expect(merged.map((m) => [m.startMs, m.endMs])).toEqual([[1000, 4000], [95_000, 99_000], [184_000, 190_000]]);
    for (let i = 0; i < merged.length - 1; i++) expect(merged[i]!.endMs).toBeLessThanOrEqual(merged[i + 1]!.startMs);
  });
  it('writes a tracklist YouTube can turn into chapters', () => {
    expect(chapterTime(61_000, false)).toBe('01:01');
    expect(chapterTime(3_725_000, true)).toBe('1:02:05');
    expect(tracklist([{ title: 'A', artist: 'HEATDRIFT', startMs: 0 }, { title: 'B', startMs: 174_000 }], 400_000)).toBe('00:00 HEATDRIFT - A\n02:54 B');
    expect(tracklist([{ title: 'A', startMs: 0 }, { title: 'B', startMs: 3_600_000 }], 4_000_000)).toBe('0:00:00 A\n1:00:00 B');
  });
});

describe('mix description', () => {
  it('adds the tracklist as chapters before the lyrics', () => {
    const r = buildReleaseText({
      artist: 'HEATDRIFT', songTitle: 'Deep House Mix', lyrics: '[Song A]\nline one', genreTags: '#deephouse', subscribeUrl: '', streamUrl: '', aiCredit: 'Made with AI tools.',
      tracklist: '00:00 HEATDRIFT - A\n03:30 HEATDRIFT - B\n07:10 HEATDRIFT - C',
    });
    const i = r.description.indexOf('Tracklist:\n00:00 HEATDRIFT - A');
    expect(i).toBeGreaterThan(0);
    expect(r.description.indexOf('line one')).toBeGreaterThan(i); // chapters come before the lyrics
  });
});

import { detectBpm } from '../src/main/tempo';
import { execFileSync as exec2 } from 'node:child_process';
import { mkdtempSync as mk2, rmSync as rm2 } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as join2 } from 'node:path';
import { autoFadeMs, introOutro, tempoRatio } from '../src/shared/mix';

describe('tempo detection', () => {
  const dir = mk2(join2(tmpdir(), 'fms-bpm-'));
  const kick = (bpm: number, seconds = 40) => {
    const f = join2(dir, `k${bpm}.wav`);
    // A kick-like thump every beat: a decaying 60 Hz sine restarted on each beat.
    exec2('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=0.8*sin(2*PI*60*mod(t\\,${(60 / bpm).toFixed(6)}))*exp(-18*mod(t\\,${(60 / bpm).toFixed(6)})):s=22050:d=${seconds}`, f]);
    return f;
  };
  it.each([118, 124, 128])('finds %i BPM from a steady kick', async (bpm) => {
    const t = await detectBpm('ffmpeg', kick(bpm));
    expect(t).not.toBeNull();
    expect(Math.abs(t!.bpm - bpm)).toBeLessThan(1.5);
    expect(t!.confidence).toBeGreaterThan(1.5);
  });
  it('says nothing about a clip that is too short', async () => {
    expect(await detectBpm('ffmpeg', kick(124, 5))).toBeNull();
    rm2(dir, { recursive: true, force: true });
  });
});

describe('auto blend rules', () => {
  it('only stretches songs that are close in tempo, at most 6%', () => {
    expect(tempoRatio(124, 122)).toBeCloseTo(124 / 122, 5);
    expect(tempoRatio(124, 100)).toBe(1);
    expect(tempoRatio(null, 122)).toBe(1);
    expect(tempoRatio(124, null)).toBe(1);
  });
  it('picks a blend as long as the quiet parts it joins, between 4 and 12 seconds', () => {
    expect(autoFadeMs(30_000, 20_000)).toBe(12_000);
    expect(autoFadeMs(2000, 9000)).toBe(4000);
    expect(autoFadeMs(7000, 9000)).toBe(6300);
  });
  it('measures the intro and outro from loudness', () => {
    // 100 buckets over 100 s: quiet for 10 s, loud, quiet for the last 15 s.
    const peaks = Array.from({ length: 100 }, (_, i) => (i < 10 || i >= 85 ? 0.05 : 0.9));
    const { introMs, outroMs } = introOutro(peaks, 100_000);
    expect(introMs).toBeGreaterThanOrEqual(9000);
    expect(introMs).toBeLessThanOrEqual(11_000);
    expect(outroMs).toBeGreaterThanOrEqual(14_000);
    expect(outroMs).toBeLessThanOrEqual(16_000);
  });
});
