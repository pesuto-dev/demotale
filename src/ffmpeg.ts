/**
 * Where the ffmpeg binary comes from.
 *
 * Prefer a system install on PATH (what operators already trust). If the project has
 * `ffmpeg-static` installed, use that binary next. demotale is Apache-2.0; a bundled FFmpeg
 * binary is GPL — see NOTICE.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';

export type FfmpegSource = 'path' | 'bundled';

export interface ResolvedFfmpeg {
  /** Absolute path, or `ffmpeg` when the PATH entry is the one that works. */
  command: string;
  source: FfmpegSource;
}

function works(command: string): boolean {
  return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
}

function bundledPath(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const found = require('ffmpeg-static') as string | null;
    if (typeof found === 'string' && found.length > 0 && fs.existsSync(found)) return found;
  } catch {
    // Optional: only present when the project installed ffmpeg-static itself.
  }
  return undefined;
}

/** The ffmpeg to spawn, or `undefined` when nothing usable is available. */
export function resolveFfmpeg(): ResolvedFfmpeg | undefined {
  if (works('ffmpeg')) return { command: 'ffmpeg', source: 'path' };

  const bundled = bundledPath();
  if (bundled !== undefined && works(bundled)) {
    return { command: bundled, source: 'bundled' };
  }

  return undefined;
}

export function hasFfmpeg(): boolean {
  return resolveFfmpeg() !== undefined;
}

/** Last-resort hint when neither PATH nor the bundled binary works. */
export function ffmpegInstallHint(): string {
  if (os.platform() === 'darwin') return 'brew install ffmpeg';
  if (os.platform() === 'win32') return 'winget install ffmpeg';
  return 'apt install ffmpeg';
}

/** Run ffmpeg with the resolved binary. Throws when ffmpeg is missing or exits non-zero. */
export function runFfmpeg(args: string[]): void {
  const resolved = resolveFfmpeg();
  if (resolved === undefined) {
    throw new Error(`ffmpeg is not available. Install it with: ${ffmpegInstallHint()}`);
  }
  const result = spawnSync(resolved.command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim().split('\n').slice(-6).join('\n') ?? '';
    throw new Error(`ffmpeg failed (exit ${String(result.status)}).\n${stderr}`);
  }
}
