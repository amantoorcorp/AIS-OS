// Guards against a font silently falling back to Arial in exports (this happened with variable fonts whose
// default instance is Thin). libass logs which file it picked for each font request.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAss } from '../src/main/render/ass';
import { BUNDLED_FONTS, DEFAULT_BRANDING } from '../src/shared/defaults';

const fontsDir = path.resolve(__dirname, '../src/renderer/public/fonts');

describe('bundled fonts', () => {
  for (const f of BUNDLED_FONTS) {
    it(`${f.family} is found by the export engine, not replaced by a fallback`, () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'fms-font-'));
      try {
        writeFileSync(path.join(dir, 'l.ass'), buildAss([{ id: '1', startMs: 0, endMs: 2000, text: 'No more maybe' }], { ...DEFAULT_BRANDING, fontFamily: f.family }, 2000));
        const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'verbose', '-f', 'lavfi', '-i', 'color=c=black:s=640x360', '-vf', `subtitles=l.ass:fontsdir=${fontsDir}`, '-frames:v', '1', '-ss', '0.5', '-f', 'null', '-'], { cwd: dir, encoding: 'utf8' });
        const picked = /fontselect: \(([^)]*)\)[^\n]*->\s*(\S+)/.exec(r.stderr ?? '');
        expect(picked, r.stderr?.slice(-300)).not.toBeNull();
        // A bundled font is served from memory (no path). A system fallback such as Helvetica shows a /System/... path.
        expect(picked![2]!.startsWith('/'), `libass fell back to ${picked![2]} for ${f.family}`).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
