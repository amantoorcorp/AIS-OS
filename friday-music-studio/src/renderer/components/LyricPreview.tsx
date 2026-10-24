import { useRef } from 'react';
import { assetUrl } from '../api';
import { Badge } from './common';
import { layoutCue } from '../../shared/cues';
import type { Branding, LyricCue } from '../../shared/types';

/** Offsets are % of the frame: X of its width, Y of its height (16:9: 1% of height = 0.5625cqw; 9:16: 1.7778cqw). */
export function lyricTransform(b: Branding, heightRatio = 0.5625): string {
  const x = b.lyricOffsetX ?? 0;
  const y = (b.lyricOffsetY ?? 0) * heightRatio;
  return b.lyricPosition === 'center' ? `translate(${x}cqw, calc(-50% + ${y}cqw))` : `translate(${x}cqw, ${y}cqw)`;
}

export function lyricLook(b: Branding, ref = 1920): React.CSSProperties {
  const px = (n: number) => `calc(${n} / ${ref} * 100cqw)`;
  const outline = b.lyricOutline ?? 3;
  return {
    color: b.lyricColor ?? '#FFFFFF',
    fontWeight: b.lyricBold === false ? 400 : 700,
    letterSpacing: px(b.letterSpacing ?? 1),
    paintOrder: 'stroke fill',
    WebkitTextStroke: outline > 0 ? `${px(outline * 2)} rgba(0,0,0,.56)` : undefined,
  };
}

export interface ShortFrame {
  focusX: number;
  focusY: number;
  zoom: number;
  fit: 'fill' | 'whole';
  /** Width divided by height of the picture, needed to turn a drag into a move. */
  imageAspect: number;
  /** A picture just for the Short. Falls back to the video's background. */
  assetId?: string | null;
  /** Called while the user drags the picture. Values are 0..1. */
  onPan?: (focusX: number, focusY: number) => void;
}

/** Same layout rules as the ASS export: sizes are measured in a 1920 (or, for a Short, 1080) wide frame. */
export function LyricPreview({
  branding,
  background,
  cue,
  short,
}: {
  branding: Branding;
  background: { kind: string; id: string } | null;
  cue: LyricCue | null;
  /** A vertical 9:16 Short preview: how the picture is framed and where the lyrics sit. */
  short?: ShortFrame;
}) {
  const ref = short ? 1080 : 1920;
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const layout = cue ? layoutCue(cue.text, { upper: branding.textCase === 'upper', scale: branding.textScale, offsetXPx: ((branding.lyricOffsetX ?? 0) * ref) / 100, frameWidth: ref }) : null;
  const pic = short?.assetId ? { kind: 'image', id: short.assetId } : background;
  const whole = pic?.kind === 'image' && (short ? short.fit === 'whole' : branding.backgroundFit === 'whole');
  const drift = !short && pic?.kind === 'image' && branding.backgroundMotion === 'drift' && !whole;
  const lowerStyle = short && branding.lyricPosition === 'lower' ? { bottom: `calc(22 * 1.7778 * 1cqw)` } : undefined;

  // Same maths as the export: the picture covers the frame, is zoomed, then a window is cut at focus (0..1) of the overflow.
  const z = short?.zoom ?? 1;
  const fx = short?.focusX ?? 0.5;
  const fy = short?.focusY ?? 0.5;
  const fillStyle: React.CSSProperties | undefined =
    short && !whole
      ? { width: `${z * 100}%`, height: `${z * 100}%`, left: `${-(z - 1) * fx * 100}%`, top: `${-(z - 1) * fy * 100}%`, objectPosition: `${fx * 100}% ${fy * 100}%`, inset: 'auto' }
      : undefined;

  const canDrag = !!short?.onPan && !whole && pic?.kind === 'image';
  const overflow = () => {
    // Pixels the zoomed picture sticks out beyond the frame, in each direction.
    const r = box.current!.getBoundingClientRect();
    const aspect = short?.imageAspect ?? 16 / 9;
    const coverW = Math.max(r.width, r.height * aspect);
    const coverH = Math.max(r.height, r.width / aspect);
    return { ox: coverW * z - r.width, oy: coverH * z - r.height };
  };

  return (
    <div
      ref={box}
      id={short ? undefined : 'lyric-preview'}
      className={`preview ${short ? 'vertical' : ''} ${canDrag ? 'draggable' : ''}`}
      style={{ background: branding.backgroundColor }}
      onPointerDown={(e) => {
        if (!canDrag) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, fx, fy };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !short?.onPan) return;
        const { ox, oy } = overflow();
        const nx = ox > 1 ? Math.min(1, Math.max(0, d.fx - (e.clientX - d.x) / ox)) : d.fx;
        const ny = oy > 1 ? Math.min(1, Math.max(0, d.fy - (e.clientY - d.y) / oy)) : d.fy;
        short.onPan(nx, ny);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
    >
      {whole && <img className="blurfill" src={assetUrl(pic!.id)} alt="" draggable={false} />}
      {pic?.kind === 'image' && <img className={`${drift ? 'drift' : ''} ${whole ? 'whole' : ''}`} style={fillStyle} src={assetUrl(pic.id)} alt="" draggable={false} />}
      {pic?.kind === 'video' && <video src={assetUrl(pic.id)} muted loop autoPlay playsInline />}
      {pic && <div className="dim" style={{ opacity: branding.backgroundDim }} />}
      {branding.logoAssetId && <img className={`logo-img ${branding.watermarkPosition}`} style={{ width: `${branding.logoSize}%` }} src={assetUrl(branding.logoAssetId)} alt="" draggable={false} />}
      {branding.watermarkText && (
        <div className={`watermark ${branding.watermarkPosition}`} style={{ fontFamily: `"${branding.fontFamily}", sans-serif` }}>
          {branding.watermarkText}
        </div>
      )}
      {layout && (
        <div
          className={`lyric ${branding.lyricPosition}`}
          style={{ transform: lyricTransform(branding, short ? 1.7778 : 0.5625), fontSize: `calc(${layout.fontPx} / ${ref} * 100cqw)`, fontFamily: `"${branding.fontFamily}", sans-serif`, ...lyricLook(branding, ref), ...lowerStyle }}
        >
          {layout.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      <Badge tone="muted">{canDrag ? 'Drag the picture' : 'Preview'}</Badge>
    </div>
  );
}
