// Tempo (BPM) of a song, so a mix can bring the next song to the same speed. Local and approximate:
// the kick drum is isolated with a low-pass, turned into a pulse train of onsets, and the tempo is the
// one whose beat spacing repeats best over several beats. Deep house is steady, so this works well there.

import { spawn } from 'node:child_process';

const RATE = 11025;
const HOP = 110; // 10 ms
const MIN_BPM = 80;
const MAX_BPM = 180;
/** Deep house sits around here; the prior only breaks ties between half and double speed. */
const PRIOR_BPM = 122;

export interface Tempo {
  bpm: number;
  /** How much stronger the best tempo is than the average one; below about 1.5 the answer is a guess. */
  confidence: number;
}

/** Onset strength per 10 ms: rises in the low (kick) band. */
export function onsetEnvelope(samples: Int16Array): Float32Array {
  const frames = Math.floor(samples.length / HOP);
  const a = 1 - Math.exp((-2 * Math.PI * 200) / RATE);
  let y = 0;
  const e = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) {
      y += a * (samples[i]! / 32768 - y);
      sum += y * y;
    }
    e[f] = Math.log(1e-6 + Math.sqrt(sum / HOP));
  }
  const o = new Float32Array(frames);
  for (let f = 1; f < frames; f++) o[f] = Math.max(0, e[f]! - e[f - 1]!);
  return o;
}

/** BPM from an onset envelope (10 ms frames). */
export function bpmFromOnsets(o: Float32Array): Tempo | null {
  const n = o.length;
  if (n < 1000) return null; // under ten seconds: not enough to tell
  let mean = 0;
  for (const v of o) mean += v;
  mean /= n;
  const x = o.map((v) => v - mean);
  const maxLag = Math.ceil((60 / MIN_BPM) * 100 * 4) + 2;
  const acf = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < n; i++) s += x[i]! * x[i - lag]!;
    acf[lag] = s / (n - lag);
  }
  const at = (lag: number) => {
    const i = Math.floor(lag);
    const f = lag - i;
    return (acf[i] ?? 0) * (1 - f) + (acf[i + 1] ?? 0) * f;
  };
  let best = { bpm: 0, score: -Infinity };
  let total = 0;
  let count = 0;
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.25) {
    const beat = (60 / bpm) * 100; // frames per beat
    let score = 0;
    for (let k = 1; k <= 4; k++) score += at(beat * k);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / 0.4) ** 2);
    const weighted = score * (0.5 + 0.5 * prior);
    total += Math.max(0, weighted);
    count++;
    if (weighted > best.score) best = { bpm, score: weighted };
  }
  if (best.score <= 0) return null;
  return { bpm: Math.round(best.bpm * 10) / 10, confidence: Math.round((best.score / (total / count)) * 100) / 100 };
}

export function detectBpm(ffmpegPath: string, audioPath: string): Promise<Tempo | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-t', '300', '-i', audioPath, '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'], { shell: false, windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.stderr.on('data', (c: Buffer) => (err = (err + c.toString()).slice(-300)));
    child.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg could not read the audio: ${err.trim().split('\n').pop()}`));
      const buf = Buffer.concat(chunks);
      resolve(bpmFromOnsets(onsetEnvelope(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2)))));
    });
  });
}
