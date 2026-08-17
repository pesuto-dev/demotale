/**
 * `demotale setup` — download what `npm i` should have left behind when postinstall was skipped.
 *
 * Doctor never runs this. It only names the command. Installing browsers is solicited here, or by
 * the package postinstall that `npm i` already asked for.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

import { ffmpegMissingFix, resolveFfmpeg } from '../ffmpeg.js';
import { resolvePlaywright } from '../playwright-resolve.js';
import { say, UserFacingError, warn } from './ui.js';

export function setupCommand(root = process.cwd()): number {
  const playwright = resolvePlaywright(root);
  if (playwright === undefined) {
    throw new UserFacingError(
      'demotale: @playwright/test is not installed.',
      'Reinstall the package: npm i -D @pesuto/demotale',
    );
  }

  say('demotale: ensuring Chromium is downloaded…');
  const install = spawnSync(process.execPath, [playwright.cli, 'install', 'chromium'], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
  });
  if (install.status !== 0) {
    throw new UserFacingError(
      'demotale: Playwright could not download Chromium.',
      'Check the network, or set PLAYWRIGHT_DOWNLOAD_HOST if you use a mirror.',
    );
  }

  const { chromium } = playwright.require('@playwright/test') as typeof import('@playwright/test');
  const executable = chromium.executablePath();
  if (!fs.existsSync(executable)) {
    throw new UserFacingError(
      'demotale: Chromium is still missing after install.',
      'Try: npx playwright install chromium',
    );
  }
  say('demotale: Chromium is ready.');

  const ffmpeg = resolveFfmpeg();
  if (ffmpeg === undefined) {
    warn('demotale: ffmpeg is not available, so recordings will stay as webm.');
    warn(`Install with: ${ffmpegMissingFix()}`);
    return 1;
  }

  switch (ffmpeg.source) {
    case 'path':
      say('demotale: ffmpeg is on PATH.');
      break;
    case 'ffmpeg-static':
      say('demotale: ffmpeg is available (ffmpeg-static in this project).');
      break;
    default: {
      const _exhaustive: never = ffmpeg.source;
      return _exhaustive;
    }
  }
  return 0;
}
