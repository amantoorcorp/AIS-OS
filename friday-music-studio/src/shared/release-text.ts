// YouTube title, description and hashtags in the lyric-video pattern studied from channels like 7clouds
// (see references/heatdrift-style-notes.md): "Artist - Song (Lyrics)", three hashtags first, three short
// emoji lines, then the lyrics. Pure functions so the app and tests share them.

export interface ReleaseTextInput {
  /** Channel or artist name shown in the title, for example HEATDRIFT. */
  artist: string;
  songTitle: string;
  lyrics: string;
  /** Genre hashtags shown after the lyrics, for example "#deephouse #englishdeephouse". */
  genreTags: string;
  /** Channel link, ideally ending in ?sub_confirmation=1. Optional. */
  subscribeUrl: string;
  /** Spotify, Apple Music or other link for the song. Optional. */
  streamUrl: string;
  /** Honest note that AI tools were used. */
  aiCredit: string;
}

export interface ReleaseText {
  title: string;
  description: string;
  /** The three hashtags YouTube shows above the title. */
  topHashtags: string[];
  warnings: string[];
}

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const SECTION_TAG = /^\s*[[(].*[\])]\s*$/;
/** Names of other channels must never appear in our titles, tags or descriptions. */
const BLOCKED = /7\s*-?\s*clouds?/i;

export function hashtagSlug(text: string): string {
  return text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

/** Lyrics for the description: section tags removed, paragraph breaks kept. */
export function lyricsForDescription(lyrics: string): string {
  const out: string[] = [];
  for (const raw of lyrics.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (SECTION_TAG.test(line)) continue;
    if (line === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(line);
  }
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

export interface ShortCaptionInput {
  artist: string;
  songTitle: string;
  /** The most repeated lyric line, shown as the hook. May be empty. */
  hook: string;
  /** Link to the full video on YouTube. May be empty. */
  fullVideoUrl: string;
  genreTags: string;
}

export interface ShortCaptions {
  youtubeTitle: string;
  youtubeDescription: string;
  tiktokCaption: string;
  warnings: string[];
}

const TIKTOK_MAX = 2200;

/** Titles and captions for a vertical Short on YouTube Shorts and TikTok. */
export function buildShortCaptions(input: ShortCaptionInput): ShortCaptions {
  const warnings: string[] = [];
  const song = input.songTitle.trim();
  const artist = input.artist.trim();
  const genre = input.genreTags.trim().split(/\s+/).filter((t) => t.startsWith('#')).slice(0, 3);
  const base = `${artist ? `${artist} - ` : ''}${song}`;
  let youtubeTitle = `${base} #Shorts`;
  if (youtubeTitle.length > TITLE_MAX) {
    youtubeTitle = `${base.slice(0, TITLE_MAX - ' #Shorts…'.length).trimEnd()}… #Shorts`;
    warnings.push(`The Short title was shortened to fit YouTube's ${TITLE_MAX} character limit.`);
  }
  const url = input.fullVideoUrl.trim();
  const hook = input.hook.trim();
  const ytTags = ['#shorts', ...genre, '#newmusic', '#originalsong'];
  const youtubeDescription = [hook ? `"${hook}"` : '', `🎧 ${base}`, url ? `▶ Full song: ${url}` : '', ytTags.join(' ')].filter(Boolean).join('\n');
  const ttTags = [...genre, '#newmusic', '#originalsong', '#lyrics'].slice(0, 5);
  const tiktokCaption = [hook ? `${hook} 🎶` : '', `${base} 🎧`, url ? `Full song on YouTube: ${url}` : 'Full song on YouTube (link in bio)', ttTags.join(' ')].filter(Boolean).join('\n').slice(0, TIKTOK_MAX);
  if (BLOCKED.test(`${youtubeTitle}\n${youtubeDescription}\n${tiktokCaption}`)) warnings.push('Remove the name of another channel (7clouds). It misleads viewers and can cause a strike.');
  if (!url) warnings.push('Add the link to the full video so viewers can find the whole song.');
  return { youtubeTitle, youtubeDescription, tiktokCaption, warnings };
}

export function buildReleaseText(input: ReleaseTextInput): ReleaseText {
  const artist = input.artist.trim();
  const song = input.songTitle.trim();
  const warnings: string[] = [];

  const suffix = ' (Lyrics)';
  const prefix = artist ? `${artist} - ` : '';
  let title = `${prefix}${song}${suffix}`;
  if (title.length > TITLE_MAX) {
    const room = TITLE_MAX - prefix.length - suffix.length - 1;
    title = `${prefix}${song.slice(0, Math.max(1, room)).trimEnd()}…${suffix}`;
    warnings.push(`The title was shortened to fit YouTube's ${TITLE_MAX} character limit.`);
  }

  const topHashtags = [artist ? hashtagSlug(artist) : '', hashtagSlug(song), 'lyrics'].filter(Boolean).map((t) => `#${t}`);
  const lines: string[] = [topHashtags.join(' ')];
  const sub = input.subscribeUrl.trim();
  lines.push(`🎵 Subscribe for a new track every week${sub ? `: ${sub}` : ''}`);
  lines.push(`🎧 ${title}`);
  if (input.streamUrl.trim()) lines.push(`⏬ Stream / Download: ${input.streamUrl.trim()}`);

  const body = lyricsForDescription(input.lyrics);
  let description = lines.join('\n');
  if (body) description += `\n\n${body}`;
  const tail = [input.genreTags.trim(), input.aiCredit.trim()].filter(Boolean).join('\n');
  if (tail) description += `\n\n${tail}`;

  if (description.length > DESCRIPTION_MAX) {
    const keep = DESCRIPTION_MAX - tail.length - 4;
    description = `${description.slice(0, Math.max(0, keep)).trimEnd()}\n\n${tail}`.slice(0, DESCRIPTION_MAX);
    warnings.push(`The lyrics were cut so the description fits YouTube's ${DESCRIPTION_MAX} character limit.`);
  }
  if (BLOCKED.test(`${title}\n${description}`)) warnings.push('Remove the name of another channel (7clouds). It misleads viewers and can cause a strike.');
  if (!artist) warnings.push('Add an artist or channel name so the title reads "Artist - Song (Lyrics)".');
  return { title, description, topHashtags, warnings };
}
