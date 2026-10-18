import { useEffect, useState } from 'react';
import type { Branding } from '../../shared/types';

export function BrandingEditor({ value, onSave }: { value: Branding; onSave: (b: Branding) => void }) {
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
      <label className="field">
        <span>Fallback background colour</span>
        <input type="color" value={b.backgroundColor} onChange={(e) => setB({ ...b, backgroundColor: e.target.value })} />
      </label>
      <label className="field">
        <span>Font family (installed on this computer)</span>
        <input value={b.fontFamily} maxLength={64} onChange={(e) => setB({ ...b, fontFamily: e.target.value.replace(/[^A-Za-z0-9 _-]/g, '') })} />
      </label>
      <button disabled={!dirty || !b.fontFamily.trim()} onClick={() => onSave(b)}>Save branding</button>
    </div>
  );
}
