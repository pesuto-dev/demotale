/**
 * Two recordings into one video.
 *
 * A demonstration with a long wait in the middle is filmed as two parts, so nobody has to watch a
 * spinner for four minutes. Both parts come out of the same recorder at the same size and frame rate,
 * which is exactly the condition under which the concat demuxer can stream-copy: no re-encode, no
 * quality lost, about a second of work.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFfmpeg } from './ffmpeg.js';

export interface JoinResult {
  file: string;
  bytes: number;
}

export function join(first: string, second: string, target: string): JoinResult {
  for (const part of [first, second]) {
    if (!fs.existsSync(part)) throw new Error(`demotale: no such recording: ${part}`);
  }

  // The concat demuxer reads a file of paths and resolves them relative to itself, so they go in
  // absolute or it silently looks in the temp directory.
  const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-join-'));
  const listFile = path.join(listDir, 'parts.txt');
  fs.writeFileSync(
    listFile,
    [first, second].map((part) => `file '${path.resolve(part)}'\n`).join(''),
  );

  try {
    try {
      runFfmpeg([
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        target,
      ]);
    } catch (error) {
      throw new Error(`demotale: joining failed. ${(error as Error).message}`);
    }
  } finally {
    fs.rmSync(listDir, { recursive: true, force: true });
  }

  return { file: target, bytes: fs.statSync(target).size };
}
