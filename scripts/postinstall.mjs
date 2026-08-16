/**
 * Download Chromium for the Playwright that ships with demotale.
 *
 * Skipped when the environment asks: CI that already has browsers, air-gapped installs, or anyone
 * who ran `npm i --ignore-scripts` and will call `npx demotale setup` instead.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (
  process.env.DEMOTALE_SKIP_POSTINSTALL === '1' ||
  process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD === '1'
) {
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));

let cli;
try {
  const entry = require.resolve('@playwright/test');
  cli = path.join(path.dirname(entry), 'cli.js');
} catch {
  // Dev checkout before dependencies are installed, or a broken pack. Not fatal for npm itself.
  process.exit(0);
}

const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], {
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status === null ? 1 : result.status);
