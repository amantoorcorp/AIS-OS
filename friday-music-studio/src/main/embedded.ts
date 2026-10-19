// Reads the timed lyrics Suno embeds in its audio files (a text track in the
// m4a). ffmpeg runs with an argument array and shell: false.

import { execFile } from 'node:child_process';
import { parseSrt, usableEntries, type EmbeddedLine } from '../shared/embedded';

export function readEmbeddedLyrics(ffmpegPath: string, audioPath: string): Promise<EmbeddedLine[]> {
  return new Promise((resolve) => {
    // "0:s:0?" = first subtitle stream if there is one; a file without it gives empty output.
    execFile(
      ffmpegPath,
      ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', audioPath, '-map', '0:s:0?', '-f', 'srt', '-'],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, shell: false },
      (err, stdout) => resolve(err ? [] : usableEntries(parseSrt(stdout))),
    );
  });
}
