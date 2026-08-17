/**
 * Assert the install smoke: ffmpeg (on PATH), chromium, and playwright are ok, and nothing asks
 * for a separate `npm i -D @playwright/test`.
 */
import fs from 'node:fs';

const file = process.argv[2];
if (file === undefined) {
  console.error('usage: assert-doctor-smoke.mjs <doctor.json>');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const checks = report.result?.checks;
if (!Array.isArray(checks)) {
  console.error('doctor JSON missing result.checks', report);
  process.exit(1);
}

const by = Object.fromEntries(checks.map((check) => [check.label, check]));

for (const label of ['ffmpeg', 'chromium', 'playwright']) {
  const check = by[label];
  if (check?.status !== 'ok') {
    console.error(`expected ${label} ok, got`, check);
    process.exit(1);
  }
}

if (by.ffmpeg.detail !== 'bundled' && by.ffmpeg.detail !== 'on PATH') {
  console.error('unexpected ffmpeg detail', by.ffmpeg);
  process.exit(1);
}

// This image installs ffmpeg with apt, matching what CI has to do on GitHub-hosted Ubuntu.
if (by.ffmpeg.detail !== 'on PATH') {
  console.error('expected ffmpeg on PATH in the smoke image, got', by.ffmpeg.detail);
  process.exit(1);
}

const playwrightFix = String(by.playwright.fix ?? '');
if (playwrightFix.includes('npm i') && playwrightFix.includes('@playwright/test')) {
  console.error('unexpected playwright fix (should not ask for a separate install)', by.playwright);
  process.exit(1);
}

console.log(
  'doctor smoke ok:',
  `ffmpeg=${by.ffmpeg.detail}`,
  `chromium=${by.chromium.detail}`,
  `playwright=${by.playwright.detail}`,
);
