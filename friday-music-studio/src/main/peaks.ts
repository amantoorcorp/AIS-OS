// Waveform for the Shorts screen: loudness peaks of the song, so the user can see where the
// verses, chorus and quiet parts are and drag to pick a section. ffmpeg decodes to mono 8 kHz
// 16-bit samples (arguments array, shell: false); we reduce them to a few hundred peaks.

import { spawn } from 'node:child_process';

const RATE = 8000;

/** Peaks from 0 to 1, one per bucket. */
export function reducePeaks(samples: Int16Array, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (samples.length === 0) return out;
  const per = samples.length / buckets;
  let max = 1;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const v = Math.abs(samples[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
    if (peak > max) max = peak;
  }
  return out.map((p) => Math.round((p / max) * 1000) / 1000);
}

export function audioPeaks(ffmpegPath: string, audioPath: string, buckets = 900): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', audioPath, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (err = (err + c.toString()).slice(-300)));
    child.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not read the audio: ${err.trim().split('\n').pop()}`));
      const buf = Buffer.concat(chunks);
      const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      resolve(reducePeaks(samples, buckets));
    });
  });
}
