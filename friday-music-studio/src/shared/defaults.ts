import type { Branding, Settings } from './types';

export const DEFAULT_TIMEZONE = 'America/Toronto';

export const DEFAULT_BRANDING: Branding = {
  watermarkText: '',
  watermarkPosition: 'top_left',
  textCase: 'as_written',
  textScale: 1,
  backgroundMotion: 'none',
  backgroundFit: 'fill',
  backgroundUpscale: false,
  logoAssetId: null,
  logoSize: 9,
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
  { family: 'Rock Salt', file: 'RockSalt-Regular.ttf', licence: 'Apache-2.0' },
  { family: 'Gochi Hand', file: 'GochiHand-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Caveat Brush', file: 'CaveatBrush-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Kalam', file: 'Kalam-Regular.ttf', licence: 'OFL-1.1', boldFile: 'Kalam-Bold.ttf' },
  { family: 'Montserrat', file: 'Montserrat-Regular.ttf', licence: 'OFL-1.1', boldFile: 'Montserrat-Bold.ttf' },
  { family: 'Oswald', file: 'Oswald-Variable.ttf', licence: 'OFL-1.1' },
  { family: 'Playfair Display', file: 'PlayfairDisplay-Variable.ttf', licence: 'OFL-1.1' },
  { family: 'Dancing Script', file: 'DancingScript-Variable.ttf', licence: 'OFL-1.1' },
  { family: 'Raleway', file: 'Raleway-Regular.ttf', licence: 'OFL-1.1', boldFile: 'Raleway-Bold.ttf' },
  { family: 'Abril Fatface', file: 'AbrilFatface-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Fredericka the Great', file: 'FrederickaTheGreat-Regular.ttf', licence: 'OFL-1.1' },
  { family: 'Shadows Into Light', file: 'ShadowsIntoLight-Regular.ttf', licence: 'OFL-1.1' },
] as const;

/** Original procedurally generated skies (scripts/make-sky.py), shipped in src/renderer/public/backgrounds. */
export const BACKGROUND_PRESETS = [
  { id: 'sunset', label: 'Sunset', file: 'sunset.jpg' },
  { id: 'dusk', label: 'Dusk', file: 'dusk.jpg' },
  { id: 'golden', label: 'Golden hour', file: 'golden.jpg' },
  { id: 'night', label: 'Night', file: 'night.jpg' },
  { id: 'coral', label: 'Coral dawn', file: 'coral.jpg' },
  { id: 'mountains', label: 'Mountain layers', file: 'mountains.jpg' },
  { id: 'city', label: 'City dusk', file: 'city.jpg' },
  { id: 'ocean', label: 'Ocean sunset', file: 'ocean.jpg' },
  { id: 'palms', label: 'Palm sunset', file: 'palms.jpg' },
  { id: 'neon', label: 'Neon bokeh', file: 'neon.jpg' },
  { id: 'aurora', label: 'Aurora', file: 'aurora.jpg' },
  { id: 'desert', label: 'Desert dunes', file: 'desert.jpg' },
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
  libraryDir: null,
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
