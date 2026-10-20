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
