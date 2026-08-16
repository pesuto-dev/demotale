/**
 * The Playwright config, generated rather than hand-written.
 *
 * A handful of these settings are not preferences, they are the difference between a recording and a
 * ruined afternoon, so they are not exposed: `bypassCSP` (without it any application sending
 * `style-src 'self'` refuses the overlay and every subtitle turns into unstyled text at the bottom of
 * the page), `retries: 0` (a second attempt makes a second video and the renderer must never have to
 * guess which one is the good one) and a single worker (two browsers recording at once is two videos
 * of half a demo).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

import { resolveConfig, type DemotaleConfig } from './config.js';
import type { DemotaleOptions } from './demo.js';

/**
 * Moves a configured webServer to the same port the browser was told to use.
 *
 * A `--port` that moves the browser but leaves the server where it was is a trap: Playwright would
 * wait for the old port, find whatever else is listening there, and record that. `PORT` is added to
 * the server's environment as well, since that is the variable nearly every `npm start` reads.
 */
function webServerOn(
  webServer: DemotaleConfig['webServer'],
  baseUrl: string,
): DemotaleConfig['webServer'] {
  if (webServer === undefined || Array.isArray(webServer)) return webServer;
  if (typeof webServer.url !== 'string') return webServer;

  const port = new URL(baseUrl).port;
  const url = new URL(webServer.url);
  if (url.port === port) return webServer;
  url.port = port;

  return {
    ...webServer,
    url: url.toString().replace(/\/$/, ''),
    env: { ...webServer.env, PORT: port },
  };
}

/**
 * A recording insists on a freshly started application, because leftover state is the most common
 * reason a demo lies. A dry run is checking locators, not filming, and restarting an application
 * that takes twenty seconds to boot would cost more than the check itself. So check reuses whatever
 * is already running, and the report says so.
 */
function reusableFor(
  webServer: NonNullable<DemotaleConfig['webServer']>,
  check: boolean,
): NonNullable<DemotaleConfig['webServer']> {
  if (!check) return webServer;
  if (Array.isArray(webServer)) {
    return webServer.map((server) => ({ ...server, reuseExistingServer: true }));
  }
  return { ...webServer, reuseExistingServer: true };
}

/** Environment overrides, so the CLI can pass `--speed` through without rewriting the config file. */
function withEnvOverrides(config: DemotaleConfig): DemotaleConfig {
  const speed = Number(process.env['DEMOTALE_SPEED']);
  const slowMo = Number(process.env['DEMOTALE_SLOWMO']);
  const baseUrl = process.env['DEMOTALE_BASE_URL'];

  return {
    ...config,
    ...(Number.isFinite(speed) && speed > 0 ? { speed } : {}),
    ...(Number.isFinite(slowMo) && slowMo >= 0 ? { slowMo } : {}),
    ...(baseUrl ? { baseUrl, webServer: webServerOn(config.webServer, baseUrl) } : {}),
  };
}

export interface PlaywrightConfigOptions {
  /** What relative paths in the demotale config are resolved against. Defaults to the cwd. */
  rootDir?: string;
}

export function definePlaywrightConfig(
  config: DemotaleConfig = {},
  options: PlaywrightConfigOptions = {},
): PlaywrightTestConfig<DemotaleOptions> {
  const resolved = resolveConfig(withEnvOverrides(config));
  const root = options.rootDir ?? process.cwd();
  const { viewport } = resolved;

  /**
   * The dry run behind `demotale check`. Set by the CLI, never by a user's config file, because it
   * is a property of this run rather than of this project.
   *
   * Its own `outputDir` is not tidiness. Playwright empties a test's output directory before every
   * run, so a check that shared one with the recorder would delete the video that was there.
   */
  const check = process.env['DEMOTALE_CHECK'] === '1';

  /**
   * A session stored earlier by `demotale auth`. Absent is a supported state: everything that films
   * a public part of an application works without one.
   */
  const storageState = resolve(root, resolved.storageState);

  return defineConfig<DemotaleOptions>({
    testDir: resolve(root, resolved.scenarios),
    outputDir: resolve(root, resolved.output, check ? 'check' : 'raw'),
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: resolved.timeout,
    // A dry run is supposed to come back in seconds, and an assertion that is going to fail should
    // not spend twenty of them proving it.
    expect: { timeout: check ? 5_000 : 20_000 },
    reporter: [['list']],
    ...(resolved.webServer ? { webServer: reusableFor(resolved.webServer, check) } : {}),
    use: {
      baseURL: resolved.baseUrl,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
      viewport,
      // The dry run drops the per-action delay that makes a click watchable. It is the second
      // biggest reason a check is quick, and the second biggest way it differs from the recording.
      launchOptions: { slowMo: check ? 0 : resolved.slowMo },
      trace: 'off',
      screenshot: 'off',
      ...(existsSync(storageState) ? { storageState } : {}),
      // Read back by the demo fixture, so a scenario never loads the config file itself.
      demotale: resolved,
      demotaleMode: check ? 'check' : 'record',
    },
    projects: [
      {
        // Warm-up that puts demo data in place. Not recorded, because nobody wants to watch seeding.
        name: 'prepare',
        testMatch: /\.prepare\.ts$/,
        use: { ...devices['Desktop Chrome'], viewport, video: 'off' },
      },
      {
        // Only the click path the viewer is meant to see.
        name: 'record',
        testMatch: /\.demo\.ts$/,
        dependencies: ['prepare'],
        use: {
          ...devices['Desktop Chrome'],
          viewport,
          ...(check ? { video: 'off' as const } : { video: { mode: 'on' as const, size: viewport } }),
        },
      },
    ],
  });
}
