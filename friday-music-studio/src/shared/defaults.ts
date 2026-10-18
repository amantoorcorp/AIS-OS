import type { Branding, Settings } from './types';

export const DEFAULT_TIMEZONE = 'America/Toronto';

export const DEFAULT_BRANDING: Branding = {
  watermarkText: '',
  backgroundDim: 0.35,
  backgroundColor: '#14141c',
  lyricPosition: 'center',
  fontFamily: 'DejaVu Sans',
};

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
