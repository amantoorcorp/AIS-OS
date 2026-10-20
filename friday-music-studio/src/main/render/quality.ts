// Automatic colour and fidelity check after an export. It renders a 1-second lyric-free clip with the exact
// same filters and encoder settings, decodes it the way a player does, and compares it with the picture
// processed by the same geometry filters. A regression in the colour path then shows up as a number
// instead of someone noticing pale skin on YouTube.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { QualityCheck } from '../../shared/types';
import { backgroundFilters, backgroundInput, buildFfmpegArgs, type RenderSpec } from './ffmpeg';

const EMPTY_ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Lyric,Arial,84,&H00FFFFFF,&H00FFFFFF,&H90000000,&H50000000,1,0,0,0,100,100,1,0,1,3,5,5,120,120,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

/** PSNR (dB) thresholds. Measured on a real picture: a correct export scores about 42, the old washed-out one 36. */
const EXCELLENT_DB = 40;
const GOOD_DB = 37;

function run(file: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, shell: false, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).slice(-300)));
      else resolve(`${stdout}\n${stderr}`);
    });
  });
}

async function readTags(ffprobePath: string, file: string): Promise<boolean> {
  const out = await run(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_range,color_space,color_transfer,color_primaries', '-of', 'csv=p=0', file], path.dirname(file), 30_000);
  return out.trim().split('\n')[0] === 'tv,bt709,iec61966-2-1,bt709';
}

export async function checkColour(spec: RenderSpec, finalFile: string): Promise<QualityCheck> {
  let tagsOk = false;
  try {
    tagsOk = await readTags(spec.ffprobePath, finalFile);
  } catch {
    /* reported below */
  }
  if (spec.background.kind !== 'image') {
    return { tagsOk, psnrDb: null, verdict: 'not_measured', note: 'Colour fidelity is only measured for still-picture backgrounds.' };
  }
  const dir = path.join(spec.workDir, 'quality');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'lyrics.ass'), EMPTY_ASS, 'utf8');
    // 1. The real pipeline on 1 second without lyrics (same filters, same encoder).
    const clip = path.join(dir, 'clip.mp4');
    const clipSpec: RenderSpec = { ...spec, workDir: dir, durationSec: 1, assContent: EMPTY_ASS, logo: undefined }; // the reference picture has no logo
    await run(spec.ffmpegPath, buildFfmpegArgs(clipSpec, clip), dir, 300_000);
    // 2. Decode like a player: BT.709 limited range back to full-range RGB.
    await run(spec.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-i', clip, '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24', '-frames:v', '1', path.join(dir, 'decoded.png')], dir);
    // 3. The picture through the same geometry filters, kept as RGB (what the export should look like).
    await run(
      spec.ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', ...backgroundInput(spec), '-filter_complex', `[0:v]${[...backgroundFilters(spec), 'format=rgb24'].join(',')}[v]`, '-map', '[v]', '-frames:v', '1', path.join(dir, 'reference.png')],
      dir,
    );
    const out = await run(spec.ffmpegPath, ['-hide_banner', '-i', path.join(dir, 'decoded.png'), '-i', path.join(dir, 'reference.png'), '-lavfi', 'psnr', '-f', 'null', '-'], dir);
    const m = /average:(inf|[0-9.]+)/.exec(out);
    const psnr = m ? (m[1] === 'inf' ? 99 : Number(m[1])) : null;
    if (psnr === null) return { tagsOk, psnrDb: null, verdict: 'not_measured', note: 'Could not read the fidelity score.' };
    const verdict = psnr >= EXCELLENT_DB ? 'excellent' : psnr >= GOOD_DB ? 'good' : 'warning';
    const dimmed = spec.backgroundDim > 0 ? ' Dim is on, so the picture is intentionally darker than the original.' : '';
    return {
      tagsOk,
      psnrDb: Math.round(psnr * 10) / 10,
      verdict: verdict === 'excellent' && !tagsOk ? 'warning' : verdict,
      note: (tagsOk ? 'Colour tags correct.' : 'Colour tags are NOT the expected BT.709 / sRGB set.') + dimmed,
    };
  } catch (e) {
    return { tagsOk, psnrDb: null, verdict: 'not_measured', note: `Check could not run: ${e instanceof Error ? e.message.split('\n')[0] : 'unknown error'}` };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
