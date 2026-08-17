/**
 * Where the ffmpeg binary comes from.
 *
 * Prefer a system install on PATH (what operators already trust). If the project has
 * `ffmpeg-static` installed, use that binary next. demotale is Apache-2.0; an FFmpeg
 * binary from `ffmpeg-static` is GPL — see NOTICE.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';

export type FfmpegSource = 'path' | 'ffmpeg-static';

export interface ResolvedFfmpeg {
  /** Absolute path, or `ffmpeg` when the PATH entry is the one that works. */
  command: string;
  source: FfmpegSource;
}

function works(command: string): boolean {
  return spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0;
}

function ffmpegStaticPath(): string | undefined {
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

  const fromStatic = ffmpegStaticPath();
  if (fromStatic !== undefined && works(fromStatic)) {
    return { command: fromStatic, source: 'ffmpeg-static' };
  }

  return undefined;
}

export function hasFfmpeg(): boolean {
  return resolveFfmpeg() !== undefined;
}

/** The OS command that puts ffmpeg on PATH. */
export function ffmpegInstallHint(): string {
  if (os.platform() === 'darwin') return 'brew install ffmpeg';
  if (os.platform() === 'win32') return 'winget install ffmpeg';
  return 'apt install ffmpeg';
}

/** What to tell a person (or an agent) when ffmpeg is missing. */
export function ffmpegMissingFix(): string {
  return `${ffmpegInstallHint()}  # or: npm i -D ffmpeg-static`;
}

/** Machine-readable label for `doctor --json`. */
export function ffmpegSourceDetail(source: FfmpegSource): string {
  switch (source) {
    case 'path':
      return 'on PATH';
    case 'ffmpeg-static':
      return 'ffmpeg-static';
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/** Run ffmpeg with the resolved binary. Throws when ffmpeg is missing or exits non-zero. */
export function runFfmpeg(args: string[]): void {
  const resolved = resolveFfmpeg();
  if (resolved === undefined) {
    throw new Error(`ffmpeg is not available. Install it with: ${ffmpegMissingFix()}`);
  }
  const result = spawnSync(resolved.command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim().split('\n').slice(-6).join('\n') ?? '';
    throw new Error(`ffmpeg failed (exit ${String(result.status)}).\n${stderr}`);
  }
}
