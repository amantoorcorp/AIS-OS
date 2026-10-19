// Optional AI upscaling of a small background picture before a 4K render. Real-ESRGAN (ncnn/Vulkan, MIT
// licence, bundled model realesrgan-x4plus) runs locally; nothing is uploaded. The result is cached per
// picture so it only costs time once. If anything goes wrong the render simply uses the original picture.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Pictures at least this wide gain little from x4 upscaling for a 3840-wide frame. */
const ALREADY_BIG_PX = 3200;

export function needsUpscale(opts: { enabled: boolean; quality: '1080p' | '4k'; kind: string; widthPx: number | null }): boolean {
  return opts.enabled && opts.quality === '4k' && opts.kind === 'image' && opts.widthPx !== null && opts.widthPx < ALREADY_BIG_PX;
}

export function upscalerPaths(dataDir: string): { bin: string; models: string } {
  // FMS_TOOLS_DIR lets tests (which use a throwaway data folder) point at the installed tools.
  const root = path.join(process.env.FMS_TOOLS_DIR ?? path.join(dataDir, 'tools'), 'realesrgan');
  return { bin: path.join(root, 'realesrgan-ncnn-vulkan'), models: path.join(root, 'models') };
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

export async function upscalerInstalled(dataDir: string): Promise<boolean> {
  const { bin, models } = upscalerPaths(dataDir);
  return (await exists(bin)) && (await exists(path.join(models, 'realesrgan-x4plus.bin'))) && (await exists(path.join(models, 'realesrgan-x4plus.param')));
}

/** Returns the path of the x4 upscaled picture (made once, then cached), or null if the upscaler is unavailable or fails. */
export async function upscalePicture(dataDir: string, cacheDir: string, assetId: string, srcPath: string): Promise<string | null> {
  if (!(await upscalerInstalled(dataDir))) return null;
  const out = path.join(cacheDir, `${assetId}-x4.png`);
  if (await exists(out)) return out;
  await fs.mkdir(cacheDir, { recursive: true });
  const tmp = `${out}.partial.png`;
  const { bin, models } = upscalerPaths(dataDir);
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(bin, ['-i', srcPath, '-o', tmp, '-n', 'realesrgan-x4plus', '-m', models, '-f', 'png'], { shell: false, timeout: 10 * 60_000, maxBuffer: 8 * 1024 * 1024 }, (err) => (err ? reject(err) : resolve()));
    });
    await fs.rename(tmp, out);
    return out;
  } catch {
    await fs.rm(tmp, { force: true });
    return null;
  }
}
