// Local speech-to-text with whisper.cpp (whisper-cli). Nothing is uploaded:
// the audio is converted to a temp WAV and heard on this machine. Arguments
// are always arrays with shell: false.

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HeardWord } from '../shared/align';

const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
/** Best first. Bigger models hear sung vocals better. */
const MODEL_PREFERENCE = ['ggml-small.en.bin', 'ggml-small.bin', 'ggml-base.en.bin', 'ggml-base.bin', 'ggml-medium.en.bin', 'ggml-medium.bin'];

export async function findWhisperCli(): Promise<string | null> {
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean), ...BIN_DIRS];
  for (const dir of dirs) {
    const p = path.join(dir, 'whisper-cli');
    try {
      await fs.access(p, fs.constants.X_OK);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export async function findModel(modelsDir: string): Promise<string | null> {
  for (const name of MODEL_PREFERENCE) {
    const p = path.join(modelsDir, name);
    try {
      await fs.access(p);
      return p;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function run(file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} failed: ${(stderr || err.message).slice(-400)}`));
      else resolve(stdout);
    });
  });
}

interface WhisperJson {
  transcription?: { text: string; offsets: { from: number; to: number }; tokens?: { text: string; p?: number }[] }[];
}

/** Parses whisper-cli JSON (one word per entry) into words, dropping music/noise markers. */
export function parseWhisperWords(json: WhisperJson): HeardWord[] {
  const words: HeardWord[] = [];
  let inMarker = 0; // "(upbeat" and "music)" arrive as separate entries; counts entries skipped
  for (const t of json.transcription ?? []) {
    const text = t.text.replace(/[♪♫]/g, '').trim();
    if (!text) continue;
    if (/^[[(]/.test(text)) inMarker = 1;
    if (inMarker > 0 && inMarker <= 5) {
      inMarker = /[\])]$/.test(text) ? 0 : inMarker + 1;
      continue;
    }
    inMarker = 0;
    const ps = (t.tokens ?? []).filter((k) => !k.text.startsWith('[') && typeof k.p === 'number').map((k) => k.p as number);
    const prob = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : undefined;
    words.push({ text, startMs: t.offsets.from, endMs: t.offsets.to, ...(prob !== undefined ? { prob } : {}) });
  }
  return words;
}

export interface TranscribeTools {
  ffmpegPath: string;
  whisperPath: string;
  modelPath: string;
}

export interface Ears {
  /** Hears [fromMs, toMs] of the song. A prompt nudges the model toward words expected there. */
  hear(fromMs: number, toMs: number | null, prompt?: string): Promise<HeardWord[]>;
  close(): Promise<void>;
}

/** Converts the song once; each hear() call slices it and returns words with song-absolute times. */
export async function openEars(audioPath: string, tools: TranscribeTools): Promise<Ears> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fms-stt-'));
  const wav = path.join(dir, 'audio.wav');
  try {
    await run(tools.ffmpegPath, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', audioPath, '-ar', '16000', '-ac', '1', wav], 120_000);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
  let n = 0;
  return {
    async hear(fromMs, toMs, prompt) {
      const slice = path.join(dir, `slice${n}.wav`);
      const outBase = path.join(dir, `words${n}`);
      n++;
      const cut = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-ss', (fromMs / 1000).toFixed(3)];
      if (toMs !== null) cut.push('-to', (toMs / 1000).toFixed(3));
      await run(tools.ffmpegPath, [...cut, '-i', wav, '-c', 'copy', slice], 60_000);
      // -ml 1 + -sow: one word per entry with its own start and end time. -ojf adds token probabilities.
      const args = ['-m', tools.modelPath, '-f', slice, '-l', 'en', '-ml', '1', '-sow', '-ojf', '-of', outBase];
      if (prompt) args.push('--prompt', prompt);
      await run(tools.whisperPath, args, 15 * 60_000);
      const json = JSON.parse(await fs.readFile(`${outBase}.json`, 'utf8')) as WhisperJson;
      return parseWhisperWords(json).map((w) => ({ ...w, startMs: w.startMs + fromMs, endMs: w.endMs + fromMs }));
    },
    close: () => fs.rm(dir, { recursive: true, force: true }),
  };
}
