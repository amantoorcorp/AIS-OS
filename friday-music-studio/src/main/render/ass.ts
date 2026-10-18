// Builds an ASS subtitle script for libass. Layout comes from shared/cues so
// the export matches the in-app preview.

import { layoutCue, VIDEO_HEIGHT, VIDEO_WIDTH } from '../../shared/cues';
import type { Branding, LyricCue } from '../../shared/types';

/** ASS has no escaping for override braces or backslashes, so substitute look-alikes. */
export function sanitizeAssText(text: string): string {
  return text.replace(/\\/g, '⧵').replace(/\{/g, '(').replace(/\}/g, ')');
}

/** ASS timestamps are H:MM:SS.cc (centiseconds). */
export function assTime(ms: number): string {
  const cs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function sanitizeFontName(name: string): string {
  const cleaned = name.replace(/[,\r\n{}\\]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'DejaVu Sans';
}

export function buildAss(cues: LyricCue[], branding: Branding, durationMs: number): string {
  const font = sanitizeFontName(branding.fontFamily);
  // Alignment 5 = middle centre, 2 = bottom centre.
  const alignment = branding.lyricPosition === 'center' ? 5 : 2;
  const marginV = branding.lyricPosition === 'center' ? 0 : 140;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${VIDEO_WIDTH}`,
    `PlayResY: ${VIDEO_HEIGHT}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // White text, translucent black outline blurred into a soft shadow.
    `Style: Lyric,${font},84,&H00FFFFFF,&H00FFFFFF,&H90000000,&HA0000000,1,0,0,0,100,100,0,0,1,3,3,${alignment},120,120,${marginV},1`,
    `Style: Mark,${font},34,&H40FFFFFF,&H40FFFFFF,&HC0000000,&HC0000000,1,0,0,0,100,100,1,0,1,1,1,7,60,60,50,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  const watermark = sanitizeAssText(branding.watermarkText.replace(/[\r\n]+/g, ' ').trim());
  if (watermark) {
    events.push(`Dialogue: 0,${assTime(0)},${assTime(durationMs)},Mark,,0,0,0,,${watermark}`);
  }
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (const cue of sorted) {
    if (!(cue.endMs > cue.startMs)) continue;
    const { lines, fontPx } = layoutCue(cue.text);
    if (lines.length === 0) continue;
    const body = lines.map(sanitizeAssText).join('\\N');
    events.push(
      `Dialogue: 1,${assTime(cue.startMs)},${assTime(Math.min(cue.endMs, durationMs))},Lyric,,0,0,0,,{\\fs${fontPx}\\blur4}${body}`,
    );
  }
  return [...header, ...events, ''].join('\n');
}
