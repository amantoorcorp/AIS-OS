import type { Branding, Settings } from './types';

export const DEFAULT_TIMEZONE = 'America/Toronto';

export const DEFAULT_BRANDING: Branding = {
  watermarkText: '',
  watermarkPosition: 'top_left',
  textCase: 'as_written',
  textScale: 1,
  backgroundMotion: 'none',
  backgroundFit: 'fill',
  backgroundDim: 0.35,
  backgroundColor: '#14141c',
  lyricPosition: 'center',
  lyricOffsetX: 0,
  lyricOffsetY: 0,
  fontFamily: 'Arial',
  lyricColor: '#FFFFFF',
  lyricBold: true,
  letterSpacing: 1,
  lyricOutline: 3,
};

/** Fonts shipped with the app (src/renderer/public/fonts). All are open-licence and free for commercial use (licence files sit beside them). */
export const BUNDLED_FONTS = [
  { family: 'Permanent Marker', file: 'PermanentMarker-Regular.ttf', licence: 'Apache-2.0' },
  { family: 'Anton', file: 'Anton-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Poppins', file: 'Poppins-Regular.ttf', licence: 'OFL-1.1', boldFile: 'Poppins-Bold.ttf' },
  { family: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Righteous', file: 'Righteous-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Bangers', file: 'Bangers-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Lobster', file: 'Lobster-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Pacifico', file: 'Pacifico-Regular.ttf', licence: 'OFL-1.1' },
] as const;

/** Original procedurally generated skies (scripts/make-sky.py), shipped in src/renderer/public/backgrounds. */
export const BACKGROUND_PRESETS = [
  { id: 'sunset', label: 'Sunset', file: 'sunset.jpg' },
  { id: 'dusk', label: 'Dusk', file: 'dusk.jpg' },
  { id: 'golden', label: 'Golden hour', file: 'golden.jpg' },
  { id: 'night', label: 'Night', file: 'night.jpg' },
] as const;
export type BackgroundPresetId = (typeof BACKGROUND_PRESETS)[number]['id'];

/** One-click "sky lyric" look: brush capitals over a slowly drifting sky, logo bottom-right. */
export function skyLyricBranding(current: Branding): Branding {
  return {
    ...current,
    fontFamily: 'Permanent Marker',
    textCase: 'upper',
    textScale: 1.5,
    lyricPosition: 'center',
    watermarkPosition: 'bottom_right',
    // No dim: the picture must export exactly as it looks. The lyric outline keeps text readable.
    backgroundDim: 0,
    // Drift zooms the picture in 15% and pans it, which crops user pictures. Opt in from Branding.
    backgroundMotion: 'none',
    backgroundFit: 'whole',
  };
}

export const DEFAULT_SETTINGS: Settings = {
  ffmpegPath: null,
  ffprobePath: null,
  defaultTimezone: DEFAULT_TIMEZONE,
  defaultArtist: '',
  generationLimitPer24h: 5,
  defaultBranding: DEFAULT_BRANDING,
};

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Display a UTC ISO timestamp in a named zone; DST handled by Intl. */
export function formatInZone(isoUtc: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(isoUtc));
}
