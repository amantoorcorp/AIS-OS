// Blends several songs into one audio file with crossfades. ffmpeg runs with an argument array and shell: false.
// Each song is brought to the same loudness first so one is not much louder than the next. A song can also be
// sped up or slowed down a little (pitch stays the same) so its tempo matches the song before it.

import { execFile } from 'node:child_process';

export interface MixAudioPlan {
  files: string[];
  /** Blend before each song after the first, in seconds (index 0 unused). */
  fadesSec: number[];
  /** Speed of each song; 1 = unchanged. */
  ratios: number[];
}

export function buildMixArgs(plan: MixAudioPlan, outPath: string): string[] {
  const n = plan.files.length;
  if (n < 2) throw new Error('A mix needs at least two songs.');
  const args = ['-hide_banner', '-nostdin', '-y'];
  for (const f of plan.files) args.push('-i', f);
  const parts = plan.files.map((_, i) => {
    const r = plan.ratios[i] ?? 1;
    const stretch = Math.abs(r - 1) > 0.0005 ? `atempo=${r.toFixed(5)},` : '';
    return `[${i}:a]aresample=44100,${stretch}aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a${i}]`;
  });
  let last = 'a0';
  for (let i = 1; i < n; i++) {
    const next = `m${i}`;
    const d = plan.fadesSec[i] ?? 0;
    parts.push(d >= 0.05 ? `[${last}][a${i}]acrossfade=d=${d.toFixed(3)}:c1=qsin:c2=qsin[${next}]` : `[${last}][a${i}]concat=n=2:v=0:a=1[${next}]`);
    last = next;
  }
  args.push('-filter_complex', parts.join(';'), '-map', `[${last}]`, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outPath);
  return args;
}

export function mixAudio(ffmpegPath: string, plan: MixAudioPlan, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, buildMixArgs(plan, outPath), { shell: false, windowsHide: true, timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`Could not blend the songs: ${(stderr || err.message).trim().split('\n').slice(-2).join(' ')}`));
      else resolve();
    });
  });
}
