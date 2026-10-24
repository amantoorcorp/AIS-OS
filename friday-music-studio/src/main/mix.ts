// Blends several songs into one audio file with crossfades. ffmpeg runs with an argument array and shell: false.
// Each song is brought to the same loudness first so one is not much louder than the next.

import { execFile } from 'node:child_process';

export function buildMixArgs(inputs: string[], crossfadeSec: number, outPath: string): string[] {
  if (inputs.length < 2) throw new Error('A mix needs at least two songs.');
  const args = ['-hide_banner', '-nostdin', '-y'];
  for (const f of inputs) args.push('-i', f);
  const parts = inputs.map((_, i) => `[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=44100[a${i}]`);
  let last = 'a0';
  if (crossfadeSec > 0) {
    for (let i = 1; i < inputs.length; i++) {
      const next = `m${i}`;
      parts.push(`[${last}][a${i}]acrossfade=d=${crossfadeSec.toFixed(3)}:c1=tri:c2=tri[${next}]`);
      last = next;
    }
  } else {
    parts.push(`${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1[m]`);
    last = 'm';
  }
  args.push('-filter_complex', parts.join(';'), '-map', `[${last}]`, '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', outPath);
  return args;
}

export function mixAudio(ffmpegPath: string, inputs: string[], crossfadeSec: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, buildMixArgs(inputs, crossfadeSec, outPath), { shell: false, windowsHide: true, timeout: 30 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) reject(new Error(`Could not blend the songs: ${(stderr || err.message).trim().split('\n').slice(-2).join(' ')}`));
      else resolve();
    });
  });
}
