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

/** #RRGGBB to ASS &H00BBGGRR. Anything else falls back to white. */
export function assColour(hex: string | undefined): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex ?? '');
  return m ? `&H00${m[3]}${m[2]}${m[1]}`.toUpperCase() : '&H00FFFFFF';
}

function clampPct(v: number | undefined): number {
  return Number.isFinite(v) ? Math.min(45, Math.max(-45, v as number)) : 0;
}

function sanitizeFontName(name: string): string {
  const cleaned = name.replace(/[,\r\n{}\\]/g, '').trim();
  return cleaned.length > 0 ? cleaned : 'Arial';
}

/** Short fade in/out, never more than a quarter of the cue. */
function fadeMs(cue: LyricCue): number {
  return Math.max(0, Math.min(180, Math.floor((cue.endMs - cue.startMs) / 4)));
}

/** Lyrics laid out for a 1920x1080 video by default, or a vertical Short (1080x1920). */
export function buildAss(cues: LyricCue[], branding: Branding, durationMs: number, frame: { width: number; height: number } = { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }): string {
  const W = frame.width;
  const H = frame.height;
  const unit = W / VIDEO_WIDTH;
  const vertical = H > W;
  const font = sanitizeFontName(branding.fontFamily);
  const colour = assColour(branding.lyricColor);
  const bold = branding.lyricBold === false ? 0 : -1;
  const spacing = Math.min(20, Math.max(0, Number.isFinite(branding.letterSpacing) ? branding.letterSpacing : 1));
  const outline = Math.min(12, Math.max(0, Number.isFinite(branding.lyricOutline) ? branding.lyricOutline : 3));
  // Alignment 5 = middle centre, 2 = bottom centre.
  const alignment = branding.lyricPosition === 'center' ? 5 : 2;
  // Lower: 140px above the bottom of a 16:9 frame; in a Short, 22% up so the app's buttons and captions stay clear.
  const lowerFromBottom = vertical ? Math.round(H * 0.22) : 140;
  const marginV = branding.lyricPosition === 'center' ? 0 : lowerFromBottom;
  const sideMargin = Math.round((vertical ? 80 : 120) * (vertical ? 1 : unit));
  // 7 = top left, 3 = bottom right.
  const markAlignment = branding.watermarkPosition === 'bottom_right' ? 3 : 7;
  const layoutOpts = { upper: branding.textCase === 'upper', scale: branding.textScale, offsetXPx: clampPct(branding.lyricOffsetX) * (W / 100), frameWidth: W };
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // White text, translucent black outline blurred into a soft glow, plus a soft drop shadow down-right.
    `Style: Lyric,${font},84,${colour},${colour},&H90000000,&H50000000,${bold},0,0,0,100,100,${spacing},0,1,${outline},5,${alignment},${sideMargin},${sideMargin},${marginV},1`,
    `Style: Mark,${font},44,&H20FFFFFF,&H20FFFFFF,&HA0000000,&HA0000000,1,0,0,0,100,100,1,0,1,1,2,${markAlignment},${Math.round(60 * unit)},${Math.round(60 * unit)},${Math.round(50 * unit)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events: string[] = [];
  const watermark = sanitizeAssText(branding.watermarkText.replace(/[\r\n]+/g, ' ').trim());
  if (watermark) {
    events.push(`Dialogue: 0,${assTime(0)},${assTime(durationMs)},Mark,,0,0,0,,${watermark}`);
  }
  // Offsets are % of the frame. \pos anchors at the style's alignment (centre or bottom centre).
  const dx = Math.round(clampPct(branding.lyricOffsetX) * (W / 100));
  const dy = Math.round(clampPct(branding.lyricOffsetY) * (H / 100));
  const baseY = branding.lyricPosition === 'center' ? H / 2 : H - lowerFromBottom;
  const pos = dx === 0 && dy === 0 ? '' : `\\pos(${W / 2 + dx},${baseY + dy})`;
  const sorted = [...cues].sort((a, b) => a.startMs - b.startMs);
  for (const cue of sorted) {
    if (!(cue.endMs > cue.startMs)) continue;
    const { lines, fontPx } = layoutCue(cue.text, layoutOpts);
    if (lines.length === 0) continue;
    const body = lines.map(sanitizeAssText).join('\\N');
    events.push(
      `Dialogue: 1,${assTime(cue.startMs)},${assTime(Math.min(cue.endMs, durationMs))},Lyric,,0,0,0,,{\\fs${fontPx}${pos}\\blur3\\fad(${fadeMs(cue)},${fadeMs(cue)})}${body}`,
    );
  }
  return [...header, ...events, ''].join('\n');
}
