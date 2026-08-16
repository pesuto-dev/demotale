/**
 * `demotale record` — run the scenarios and turn the result into a video.
 *
 * This is a thin wrapper around Playwright on purpose: everything that makes a recording work sits in
 * the generated Playwright config, not in flags here. What this adds is the tempo knobs, and the fact
 * that it renders afterwards, so a first recording is one command rather than two.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { loadConfig } from '../config.js';
import { resolvePlaywright } from '../playwright-resolve.js';
import { emitJson, jsonReport } from '../report.js';
import { flagBoolean, flagNumber, flagString, type Args } from './args.js';
import { renderCommand, runRender } from './render.js';
import { say, UserFacingError } from './ui.js';

const PLAYWRIGHT_CONFIGS = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.mjs',
  'playwright.config.js',
];

export function findPlaywrightConfig(root: string): string {
  for (const name of PLAYWRIGHT_CONFIGS) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new UserFacingError(
    'demotale: no playwright.config.ts in this directory, so there is nothing to run.',
    'Run "npx demotale init" to write one.',
  );
}

/** The Playwright CLI: the project's copy when present, otherwise the one that ships with demotale. */
export function resolvePlaywrightCli(root: string): string {
  const resolved = resolvePlaywright(root);
  if (resolved === undefined) {
    throw new UserFacingError(
      'demotale: @playwright/test is not installed.',
      'Run "npx demotale setup".',
    );
  }
  return resolved.cli;
}

function withPort(baseUrl: string, port: number): string {
  const url = new URL(baseUrl);
  url.port = String(port);
  return url.toString().replace(/\/$/, '');
}

/**
 * The address this run should use, from `--base-url` or `--port`, or nothing to leave the config
 * alone.
 *
 * `--port` moves the port and keeps the rest; `--base-url` replaces the lot, which is what you want
 * when the obstacle is the server rather than the port — checking a scenario against a copy of the
 * app somewhere else, for instance, instead of editing the config and remembering to put it back.
 */
export function resolveBaseUrl(args: Args, configured: string): string | undefined {
  const given = flagString(args, 'base-url');
  if (given !== undefined) {
    try {
      return new URL(given).toString().replace(/\/$/, '');
    } catch {
      throw new UserFacingError(
        `demotale: --base-url ${given} is not a URL.`,
        'It needs the scheme too, as in --base-url http://localhost:4173',
      );
    }
  }

  const port = flagNumber(args, 'port');
  return port === undefined ? undefined : withPort(configured, port);
}

export async function recordCommand(args: Args, root = process.cwd()): Promise<number> {
  const { config } = await loadConfig(root);
  const playwrightConfig = findPlaywrightConfig(root);
  const cli = resolvePlaywrightCli(root);

  const speed = flagNumber(args, 'speed');
  const slowMo = flagNumber(args, 'slow-mo');
  const baseUrl = resolveBaseUrl(args, config.baseUrl);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (speed !== undefined) env['DEMOTALE_SPEED'] = String(speed);
  if (slowMo !== undefined) env['DEMOTALE_SLOWMO'] = String(slowMo);
  if (baseUrl !== undefined) env['DEMOTALE_BASE_URL'] = baseUrl;

  const filter = args.positional[0];
  const playwrightArgs = [
    cli,
    'test',
    '--config',
    playwrightConfig,
    ...(flagBoolean(args, 'headed') ? ['--headed'] : []),
    ...(filter === undefined ? [] : [filter]),
    ...args.rest,
  ];

  // In JSON mode Playwright's output would land in front of the document and make it unparseable,
  // so it is captured and handed back inside the document instead.
  const json = flagBoolean(args, 'json');
  const result = spawnSync(process.execPath, playwrightArgs, {
    stdio: json ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    // Playwright colours its output even into a pipe, and escape codes inside a JSON string are
    // noise to the only reader that asked for JSON.
    env: json ? { ...env, NO_COLOR: '1', FORCE_COLOR: '0' } : env,
    cwd: root,
  });

  const noRender = flagString(args, 'render') === 'false' || flagBoolean(args, 'no-render');

  if (json) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.toString().trimEnd();
    const recorded = result.status === 0;
    const rendered = recorded && !noRender ? await runRender(root) : undefined;

    emitJson(
      jsonReport(
        'record',
        recorded && (rendered?.ok ?? true),
        [
          ...(recorded
            ? []
            : [
                {
                  code: 'record-failed' as const,
                  message:
                    'The recording did not finish. Playwright\'s own output is under ' +
                    'result.playwright.output; run "demotale check" for the same click path with ' +
                    'the failure spelled out.',
                  fix: 'npx demotale check',
                },
              ]),
          ...(rendered?.problems ?? []),
        ],
        {
          playwright: { exitCode: result.status ?? 1, output },
          rendered: rendered?.payload,
        },
      ),
    );
    return result.status ?? (rendered?.ok === false && rendered.payload.recordings.length === 0 ? 1 : 0);
  }

  if (result.status !== 0) {
    // Playwright has already said what went wrong, in more detail than this could.
    return result.status ?? 1;
  }

  if (noRender) {
    say('');
    say('Recorded. Run "demotale render" to turn it into a video.');
    return 0;
  }

  say('');
  return renderCommand(root);
}
