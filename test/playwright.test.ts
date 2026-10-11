import { afterEach, describe, expect, it } from 'vitest';

import { definePlaywrightConfig } from '../src/playwright.js';

const CHECK = 'DEMOTALE_CHECK';
const IMAGES = 'DEMOTALE_IMAGES';

function restoreEnv(): void {
  delete process.env[CHECK];
  delete process.env[IMAGES];
}

afterEach(restoreEnv);

function configFor(mode: 'check' | 'images' | 'record') {
  restoreEnv();
  if (mode === 'check') process.env[CHECK] = '1';
  if (mode === 'images') process.env[IMAGES] = '1';

  return definePlaywrightConfig({
    webServer: {
      command: 'npm start',
      url: 'http://localhost:3000',
      reuseExistingServer: false,
    },
  });
}

function recordProject(config: ReturnType<typeof definePlaywrightConfig>) {
  const projects = config.projects ?? [];
  const record = projects.find((project) => project.name === 'record');
  if (record === undefined) throw new Error('missing record project');
  return record;
}

describe('definePlaywrightConfig', () => {
  it('keeps check fast: short expect, reuse the server that is already up', () => {
    const config = configFor('check');
    expect(config.expect?.timeout).toBe(5_000);
    expect(config.webServer).toMatchObject({ reuseExistingServer: true });
    expect(config.use?.launchOptions).toEqual({ slowMo: 0 });
    expect(recordProject(config).use?.video).toBe('off');
  });

  it('lets images wait like a recording, and honours reuseExistingServer', () => {
    const config = configFor('images');
    expect(config.expect?.timeout).toBe(20_000);
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    expect(config.use?.launchOptions).toEqual({ slowMo: 0 });
    expect(recordProject(config).use?.video).toBe('off');
  });

  it('films with the long expect and a fresh server', () => {
    const config = configFor('record');
    expect(config.expect?.timeout).toBe(20_000);
    expect(config.webServer).toMatchObject({ reuseExistingServer: false });
    expect(config.use?.launchOptions).toEqual({ slowMo: 120 });
    expect(recordProject(config).use?.video).toEqual({ mode: 'on', size: { width: 1440, height: 900 } });
  });

  it('starts nothing when the scenario owns the server', () => {
    expect(definePlaywrightConfig({ webServer: false }).webServer).toBeUndefined();
  });
});
