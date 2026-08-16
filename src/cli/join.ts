/**
 * `demotale join` — two parts into one video, without re-encoding.
 */
import { join } from '../join.js';
import { hasFfmpeg, ffmpegInstallHint } from '../render.js';
import { megabytes, relative, say, UserFacingError } from './ui.js';

export function joinCommand(positional: string[], root = process.cwd()): number {
  const [first, second, target] = positional;
  if (first === undefined || second === undefined || target === undefined) {
    throw new UserFacingError('usage: demotale join <first.mp4> <second.mp4> <target.mp4>');
  }

  if (!hasFfmpeg()) {
    throw new UserFacingError(
      'demotale: joining needs ffmpeg, and it is not available.',
      `Run "npx demotale setup", or install a system build with: ${ffmpegInstallHint()}`,
    );
  }

  const result = join(first, second, target);
  say(`joined: ${relative(result.file, root)} (${megabytes(result.bytes)})`);
  return 0;
}
