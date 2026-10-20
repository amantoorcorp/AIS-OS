import { useEffect, useState } from 'react';
import { BUNDLED_FONTS } from '../../shared/defaults';
import type { Branding } from '../../shared/types';

export function BrandingEditor({ value, onSave, logoName, onImportLogo }: { value: Branding; onSave: (b: Branding) => void; logoName?: string | null; onImportLogo?: () => void }) {
  const [b, setB] = useState(value);
  useEffect(() => setB(value), [value]);
  const dirty = JSON.stringify(b) !== JSON.stringify(value);
  return (
    <div className="branding">
      <label className="field">
        <span>Watermark / channel text</span>
        <input value={b.watermarkText} maxLength={80} onChange={(e) => setB({ ...b, watermarkText: e.target.value })} />
      </label>
      <label className="field">
        <span>Logo / text position</span>
        <select value={b.watermarkPosition} onChange={(e) => setB({ ...b, watermarkPosition: e.target.value as Branding['watermarkPosition'] })}>
          <option value="top_left">Top left</option>
          <option value="bottom_right">Bottom right</option>
        </select>
      </label>
      <div className="field">
        <span>Logo picture (PNG with a transparent background works best)</span>
        <div className="row wrap">
          <button disabled={!onImportLogo} onClick={() => onImportLogo?.()}>{logoName ? 'Change logo…' : 'Choose logo…'}</button>
          {logoName && <span className="muted small-text">{logoName}</span>}
          {logoName && <button onClick={() => onSave({ ...value, logoAssetId: null })}>Remove logo</button>}
        </div>
        {value.logoAssetId && (
          <label className="field">
            <span>Logo size ({value.logoSize}% of width, corner set by "Logo / text position")</span>
            <input type="range" min={3} max={30} step={1} value={b.logoSize} onChange={(e) => setB({ ...b, logoSize: Number(e.target.value) })} />
          </label>
        )}
      </div>
      <label className="field">
        <span>Lyric case</span>
        <select value={b.textCase} onChange={(e) => setB({ ...b, textCase: e.target.value as Branding['textCase'] })}>
          <option value="as_written">As written</option>
          <option value="upper">ALL CAPS</option>
        </select>
      </label>
      <label className="field">
        <span>Lyric size ({Math.round(b.textScale * 100)}%)</span>
        <input type="range" min={0.4} max={2} step={0.05} value={b.textScale} onChange={(e) => setB({ ...b, textScale: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Background motion</span>
        <select value={b.backgroundMotion} onChange={(e) => setB({ ...b, backgroundMotion: e.target.value as Branding['backgroundMotion'] })}>
          <option value="none">Still</option>
          <option value="drift">Slow drift (images)</option>
        </select>
      </label>
      <label className="field">
        <span>Picture fit</span>
        <select value={b.backgroundFit} onChange={(e) => setB({ ...b, backgroundFit: e.target.value as Branding['backgroundFit'] })}>
          <option value="fill">Fill the frame (crops the edges)</option>
          <option value="whole">Show the whole picture (as downloaded)</option>
        </select>
      </label>
      <label className="field">
        <span>Sharpen small pictures with AI (4K exports only)</span>
        <input type="checkbox" checked={b.backgroundUpscale} onChange={(e) => setB({ ...b, backgroundUpscale: e.target.checked })} />
        <span className="muted small-text">Runs on this Mac. About 30 seconds the first time, then remembered. Colours stay the same; skin may look slightly smoother.</span>
      </label>
      <label className="field">
        <span>Background dim ({Math.round(b.backgroundDim * 100)}%)</span>
        <input type="range" min={0} max={0.8} step={0.05} value={b.backgroundDim} onChange={(e) => setB({ ...b, backgroundDim: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Lyric position</span>
        <select value={b.lyricPosition} onChange={(e) => setB({ ...b, lyricPosition: e.target.value as Branding['lyricPosition'] })}>
          <option value="center">Centre</option>
          <option value="lower">Lower third</option>
        </select>
      </label>
      <div className="field">
        <span>Move lyrics (saves as you click)</span>
        <div className="row wrap">
          {(
            [
              ['◀', 'Left', 'lyricOffsetX', -2],
              ['▶', 'Right', 'lyricOffsetX', 2],
              ['▲', 'Up', 'lyricOffsetY', -2],
              ['▼', 'Down', 'lyricOffsetY', 2],
            ] as const
          ).map(([label, title, key, step]) => (
            <button
              key={key + step}
              title={`${title} 2%`}
              onClick={() => onSave({ ...value, [key]: Math.max(-45, Math.min(45, (value[key] ?? 0) + step)) })}
            >
              {label}
            </button>
          ))}
          <button title="Back to the middle" onClick={() => onSave({ ...value, lyricOffsetX: 0, lyricOffsetY: 0 })}>Reset</button>
          <span className="muted small-text">
            sideways {value.lyricOffsetX ?? 0}%, up/down {value.lyricOffsetY ?? 0}%
          </span>
        </div>
      </div>
      <label className="field">
        <span>Fallback background colour</span>
        <input type="color" value={b.backgroundColor} onChange={(e) => setB({ ...b, backgroundColor: e.target.value })} />
      </label>
      <div className="field wide">
        <span>Font style (click one)</span>
        <div className="font-chips">
          {BUNDLED_FONTS.map((f) => (
            <button
              key={f.family}
              className={`font-chip ${b.fontFamily === f.family ? 'active' : ''}`}
              style={{ fontFamily: `"${f.family}", sans-serif`, fontWeight: b.lyricBold ? 700 : 400 }}
              onClick={() => setB({ ...b, fontFamily: f.family })}
              title={f.family}
            >
              Aa {f.family}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Or any font installed on this computer</span>
        <input list="font-options" value={b.fontFamily} maxLength={64} onChange={(e) => setB({ ...b, fontFamily: e.target.value.replace(/[^A-Za-z0-9 _-]/g, '') })} />
        <datalist id="font-options">
          {BUNDLED_FONTS.map((f) => (
            <option key={f.family} value={f.family} />
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Lyric colour</span>
        <input type="color" value={b.lyricColor} onChange={(e) => setB({ ...b, lyricColor: e.target.value.toUpperCase() })} />
      </label>
      <label className="field">
        <span>Bold</span>
        <input type="checkbox" checked={b.lyricBold} onChange={(e) => setB({ ...b, lyricBold: e.target.checked })} />
      </label>
      <label className="field">
        <span>Letter spacing ({b.letterSpacing}px)</span>
        <input type="range" min={0} max={20} step={1} value={b.letterSpacing} onChange={(e) => setB({ ...b, letterSpacing: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span>Outline ({b.lyricOutline}px)</span>
        <input type="range" min={0} max={12} step={1} value={b.lyricOutline} onChange={(e) => setB({ ...b, lyricOutline: Number(e.target.value) })} />
      </label>
      <button disabled={!dirty || !b.fontFamily.trim()} onClick={() => onSave(b)}>Save branding</button>
    </div>
  );
}
