// FFmpeg/ffprobe helpers. Every call uses an argument array with shell: false;
// nothing from the renderer is ever interpreted as a command.

import { spawn, execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RenderProbe, ToolStatus } from '../../shared/types';

export interface RenderSpec {
  ffmpegPath: string;
  ffprobePath: string;
  /** Scratch dir; the ASS file is written here and ffmpeg runs with it as cwd. */
  workDir: string;
  outputPath: string;
  audioPath: string;
  durationSec: number;
  background: { kind: 'image' | 'video'; path: string } | { kind: 'color'; color: string };
  backgroundDim: number;
  /** Slow pan across a still image. Ignored for video and colour backgrounds. */
  backgroundMotion: 'none' | 'drift';
  /** whole: letterbox the entire picture over a blurred copy instead of cropping it. Stills only. */
  backgroundFit?: 'fill' | 'whole';
  assContent: string;
  /** Directory of bundled fonts for libass, or null to use system fonts only. */
  fontsDir: string | null;
}

export interface RenderResult {
  outputPath: string;
  sizeBytes: number;
  probe: RenderProbe;
}

export class RenderCancelledError extends Error {
  constructor() {
    super('Render cancelled');
  }
}

const FPS = 30;

export function buildFfmpegArgs(spec: RenderSpec, partialPath: string): string[] {
  const args = ['-hide_banner', '-nostdin', '-y'];
  const bg = spec.background;
  if (bg.kind === 'color') {
    const hex = bg.color.replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Invalid background colour');
    args.push('-f', 'lavfi', '-i', `color=c=0x${hex}:s=1920x1080:r=${FPS}`);
  } else if (bg.kind === 'image') {
    args.push('-loop', '1', '-framerate', String(FPS), '-i', bg.path);
  } else {
    args.push('-stream_loop', '-1', '-i', bg.path);
  }
  args.push('-i', spec.audioPath);

  const dim = Math.min(0.8, Math.max(0, spec.backgroundDim));
  const drift = bg.kind === 'image' && spec.backgroundMotion === 'drift' && spec.backgroundFit !== 'whole';
  const whole = bg.kind === 'image' && spec.backgroundFit === 'whole';
  const filters = drift
    ? [
        // Overscan 15%, then slide the 1080p window across it on a 90s sine.
        'scale=2208:1242:force_original_aspect_ratio=increase',
        'crop=2208:1242',
        `crop=1920:1080:x='(iw-ow)/2*(1+sin(2*PI*t/90))':y='(ih-oh)/2*(1+0.5*sin(2*PI*t/70))'`,
        'setsar=1',
        `fps=${FPS}`,
      ]
    : whole
      ? [
          // Whole picture centred; a cheap blurred, cropped copy fills the bars.
          'split=2[a][b];[a]scale=480:270:force_original_aspect_ratio=increase,crop=480:270,boxblur=8:2,scale=1920:1080[bg];[b]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2',
          'setsar=1',
          `fps=${FPS}`,
        ]
      : ['scale=1920:1080:force_original_aspect_ratio=increase', 'crop=1920:1080', 'setsar=1', `fps=${FPS}`];
  if (dim > 0) filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=black@${dim.toFixed(2)}:t=fill`);
  // Relative filename: avoids filter-graph escaping of absolute paths. cwd = workDir.
  filters.push(spec.fontsDir ? 'subtitles=filename=lyrics.ass:fontsdir=fonts' : 'subtitles=filename=lyrics.ass', 'format=yuv420p');

  args.push(
    '-filter_complex', `[0:v]${filters.join(',')}[v]`,
    '-map', '[v]',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', spec.durationSec.toFixed(3),
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    '-nostats',
    '-f', 'mp4',
    partialPath,
  );
  return args;
}

export async function runRender(
  spec: RenderSpec,
  onProgress: (ratio: number) => void,
  signal: AbortSignal,
): Promise<RenderResult> {
  await fs.mkdir(spec.workDir, { recursive: true });
  await fs.mkdir(path.dirname(spec.outputPath), { recursive: true });
  await fs.writeFile(path.join(spec.workDir, 'lyrics.ass'), spec.assContent, 'utf8');
  if (spec.fontsDir) {
    const fontsOut = path.join(spec.workDir, 'fonts');
    await fs.mkdir(fontsOut, { recursive: true });
    for (const f of await fs.readdir(spec.fontsDir)) {
      if (/\.(ttf|otf)$/i.test(f)) await fs.copyFile(path.join(spec.fontsDir, f), path.join(fontsOut, f));
    }
  }
  const partialPath = `${spec.outputPath}.partial`;
  const args = buildFfmpegArgs(spec, partialPath);

  try {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new RenderCancelledError());
      const child = spawn(spec.ffmpegPath, args, { cwd: spec.workDir, shell: false, windowsHide: true });
      let stderrTail = '';
      let stdoutBuf = '';
      const onAbort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf8');
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_us=(\d+)/.exec(line.trim());
          if (m) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / spec.durationSec));
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000);
      });
      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error(`Could not start ffmpeg: ${err.message}`));
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) return reject(new RenderCancelledError());
        if (code === 0) return resolve();
        const lastLines = stderrTail.trim().split('\n').slice(-6).join('\n');
        reject(new Error(`ffmpeg exited with code ${code}.\n${lastLines}`));
      });
    });

    const probe = await probeMedia(spec.ffprobePath, partialPath);
    verifyRender(probe, spec.durationSec);
    await fs.rename(partialPath, spec.outputPath);
    const stat = await fs.stat(spec.outputPath);
    onProgress(1);
    return {
      outputPath: spec.outputPath,
      sizeBytes: stat.size,
      probe: {
        width: probe.width ?? 0,
        height: probe.height ?? 0,
        videoCodec: probe.videoCodec ?? 'unknown',
        audioCodec: probe.audioCodec,
        durationSec: probe.durationSec ?? 0,
      },
    };
  } finally {
    await fs.rm(partialPath, { force: true });
  }
}

/** Throws when the output is not the MP4 we promised. */
export function verifyRender(probe: MediaProbe, expectedDurationSec: number): void {
  const problems: string[] = [];
  if (probe.videoCodec !== 'h264') problems.push(`video codec is ${probe.videoCodec ?? 'missing'}`);
  if (probe.width !== 1920 || probe.height !== 1080) problems.push(`resolution is ${probe.width}x${probe.height}`);
  if (!probe.audioCodec) problems.push('no audio stream');
  if (probe.durationSec == null || Math.abs(probe.durationSec - expectedDurationSec) > 0.75)
    problems.push(`duration ${probe.durationSec?.toFixed(2)}s, expected ${expectedDurationSec.toFixed(2)}s`);
  if (problems.length) throw new Error(`Export failed verification: ${problems.join('; ')}`);
}

export interface MediaProbe {
  durationSec: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  formatName: string | null;
}

interface FfprobeJson {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }>;
}

export function probeMedia(ffprobePath: string, file: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      { shell: false, windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 30_000 },
      (err, stdout) => {
        if (err) return reject(new Error(`ffprobe could not read the file: ${err.message.split('\n')[0]}`));
        try {
          const json = JSON.parse(stdout) as FfprobeJson;
          const streams = json.streams ?? [];
          const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
          const audio = streams.find((s) => s.codec_type === 'audio');
          const d = Number(json.format?.duration ?? audio?.duration ?? video?.duration);
          resolve({
            durationSec: Number.isFinite(d) ? d : null,
            width: video?.width ?? null,
            height: video?.height ?? null,
            videoCodec: video?.codec_name ?? null,
            audioCodec: audio?.codec_name ?? null,
            formatName: json.format?.format_name ?? null,
          });
        } catch {
          reject(new Error('ffprobe returned unreadable output'));
        }
      },
    );
  });
}

export function checkFfmpeg(ffmpegPath: string): Promise<ToolStatus> {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-filters'], { shell: false, windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        return resolve({ ok: false, path: ffmpegPath, version: null, error: `ffmpeg not usable: ${err.message.split('\n')[0]}`, hasSubtitlesFilter: false });
      }
      const hasSubtitlesFilter = /\bsubtitles\b/.test(stdout);
      execFile(ffmpegPath, ['-version'], { shell: false, windowsHide: true, timeout: 15_000 }, (err2, out2) => {
        const first = out2?.split('\n')[0] ?? '';
        const looksRight = !err2 && first.startsWith('ffmpeg version');
        resolve({
          ok: looksRight && hasSubtitlesFilter,
          path: ffmpegPath,
          version: looksRight ? first.replace('ffmpeg version ', '').split(' ')[0] ?? null : null,
          error: !looksRight
            ? 'Selected file is not ffmpeg.'
            : hasSubtitlesFilter
              ? null
              : 'This ffmpeg build lacks libass (the "subtitles" filter), which lyric rendering needs.',
          hasSubtitlesFilter,
        });
      });
    });
  });
}

/** Writes a sine-tone test file. Used only by the clearly-labelled mock provider and tests. */
export function synthesizeTone(ffmpegPath: string, outPath: string, seconds: number, freqHz: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-y', '-f', 'lavfi', '-i', `sine=frequency=${Math.round(freqHz)}:duration=${seconds}:sample_rate=44100`, '-c:a', 'libmp3lame', '-b:a', '128k', outPath],
      { shell: false, windowsHide: true, timeout: 60_000 },
      (err) => (err ? reject(new Error(`Could not synthesise tone: ${err.message.split('\n')[0]}`)) : resolve()),
    );
  });
}
