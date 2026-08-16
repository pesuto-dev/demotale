import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectChecks, npmScriptName, scriptPorts, type Check } from '../src/cli/doctor.js';

describe('npmScriptName', () => {
  it.each([
    ['npm start', 'start'],
    ['npm run dev', 'dev'],
    ['pnpm dev', 'dev'],
    ['yarn run serve:demo', 'serve:demo'],
    ['npm run build --workspace app', 'build'],
  ])('reads the script out of %s', (command, expected) => {
    expect(npmScriptName(command)).toBe(expected);
  });

  it.each(['node serve.mjs', './scripts/start.sh', 'docker compose up', 'npx serve .'])(
    'leaves %s alone, because there is no script to look up',
    (command) => {
      expect(npmScriptName(command)).toBeUndefined();
    },
  );
});

describe('scriptPorts', () => {
  it.each([
    ['ng serve --port 4300', ['4300']],
    ['vite --port=5173', ['5173']],
    ['next dev -p 3001', ['3001']],
    ['PORT=8080 node server.mjs', ['8080']],
    ['concurrently "api --port 4000" "web --port 3000"', ['4000', '3000']],
  ])('reads the ports out of %s', (command, expected) => {
    expect(scriptPorts(command)).toEqual(expected);
  });

  it.each(['ng serve', 'react-scripts start', 'docker compose -p demo up', 'mkdir -p dist && vite'])(
    'finds nothing in %s, because nothing there is a port',
    (command) => {
      expect(scriptPorts(command)).toEqual([]);
    },
  );
});

describe('doctor', () => {
  let root: string;

  const write = (file: string, content: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };

  const config = (body: string): void =>
    write('demotale.config.ts', `export default ${body};\n`);

  /**
   * A @playwright/test that resolves out of this temporary project, so the check that looks it up
   * can be tested without the one installed here answering instead. `executablePath` points at a
   * file that certainly exists, which is all the chromium check asks of it.
   */
  const fakePlaywright = (pkg: Record<string, unknown>): void => {
    write(
      'node_modules/@playwright/test/package.json',
      JSON.stringify({ name: '@playwright/test', main: 'index.js', ...pkg }),
    );
    write(
      'node_modules/@playwright/test/index.js',
      `exports.chromium = { executablePath: () => ${JSON.stringify(process.execPath)} };\n`,
    );
    // resolvePlaywright requires cli.js beside the entry, so a stub here beats demotale's real copy.
    write('node_modules/@playwright/test/cli.js', '#!/usr/bin/env node\n');
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-doctor-'));
    write('package.json', JSON.stringify({ name: 'app', scripts: { dev: 'node serve.mjs' } }));
    write('demo/thing.demo.ts', '// a scenario\n');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const find = (checks: Check[], label: string): Check[] =>
    checks.filter((check) => check.label === label);

  // Three blind arms in a row read `[ ok ] playwright /Users/.../node_modules/@playwright/test` as
  // the gravest thing doctor told them, because the path was one they did not recognise. It was
  // correct every time. A path only carries information when something is wrong with it.
  it('reports the playwright version rather than where it lives', async () => {
    fakePlaywright({ version: '1.49.0' });
    config(`{ baseUrl: 'http://localhost:4173' }`);

    const { checks } = await collectChecks(root);
    const [playwright] = find(checks, 'playwright');

    expect(playwright?.status).toBe('ok');
    expect(playwright?.detail).toBe('1.49.0');
    expect(playwright?.detail).not.toContain(root);
    expect(playwright?.detail).not.toContain('node_modules');
  });

  it('says something short rather than the path when the version cannot be read', async () => {
    fakePlaywright({});
    config(`{ baseUrl: 'http://localhost:4173' }`);

    const { checks } = await collectChecks(root);
    const [playwright] = find(checks, 'playwright');

    expect(playwright?.status).toBe('ok');
    expect(playwright?.detail).toBe('installed');
    expect(playwright?.detail).not.toContain('node_modules');
  });

  it('says which script is missing, and which ones exist', async () => {
    config(`{ baseUrl: 'http://localhost:4173', webServer: { command: 'npm start', url: 'http://localhost:4173' } }`);

    const { checks } = await collectChecks(root);
    const [server] = find(checks, 'webServer');

    expect(server?.status).toBe('problem');
    expect(server?.detail).toContain('no "start" script');
    expect(server?.detail).toContain('It has: dev');
  });

  it('is happy when the command resolves, and shows what it runs', async () => {
    config(`{ baseUrl: 'http://localhost:4173', webServer: { command: 'npm run dev', url: 'http://localhost:4173' } }`);

    const { checks } = await collectChecks(root);
    const [server] = find(checks, 'webServer');

    expect(server?.status).toBe('ok');
    expect(server?.detail).toContain('node serve.mjs');
  });

  it('calls out a config that was never pointed at anything', async () => {
    config(`{ baseUrl: 'http://localhost:3000', webServer: { command: 'npm start', url: 'http://localhost:3000' } }`);

    const { checks } = await collectChecks(root);
    const untouched = find(checks, 'config').filter((check) => check.status === 'problem');

    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.detail).toContain('never pointed at your application');
  });

  it('does not accuse a project that really does run on port 3000', async () => {
    config(`{ baseUrl: 'http://localhost:3000', webServer: { command: 'npm run dev', url: 'http://localhost:3000' } }`);

    const { checks } = await collectChecks(root);
    expect(find(checks, 'config').filter((check) => check.status === 'problem')).toHaveLength(0);
  });

  it('still says so when npm start resolves, because init wrote all three of these values', async () => {
    // A framework project: `ng new`, `create-vite` and `create-react-app` all write a start script,
    // so "the command does not resolve" never fires and the config sails through untouched.
    write('package.json', JSON.stringify({ name: 'app', scripts: { start: 'ng serve' } }));
    config(`{ baseUrl: 'http://localhost:3000', webServer: { command: 'npm start', url: 'http://localhost:3000' } }`);

    const { checks } = await collectChecks(root);
    const untouched = find(checks, 'config').filter((check) => check.code === 'config-untouched');

    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.status).toBe('warn');
    expect(untouched[0]?.detail).toContain('exactly what init wrote');
    // The webServer command is fine here, so nothing may claim otherwise.
    expect(find(checks, 'webServer').every((check) => check.status === 'ok')).toBe(true);
  });

  it('says it once, not twice, when the command is missing as well', async () => {
    config(`{ baseUrl: 'http://localhost:3000', webServer: { command: 'npm start', url: 'http://localhost:3000' } }`);

    const { checks } = await collectChecks(root);
    const untouched = find(checks, 'config').filter((check) => check.code === 'config-untouched');

    expect(untouched).toHaveLength(1);
    expect(untouched[0]?.status).toBe('problem');
  });

  it('leaves a project alone that edited one of the three, start script or not', async () => {
    write('package.json', JSON.stringify({ name: 'app', scripts: { start: 'node server.mjs' } }));
    config(`{ baseUrl: 'http://localhost:3000', webServer: { command: 'npm start', url: 'http://localhost:3000/app' } }`);

    const { checks } = await collectChecks(root);
    expect(find(checks, 'config').filter((check) => check.code === 'config-untouched')).toHaveLength(
      0,
    );
  });

  it('points out a start script that names a port webServer.url does not', async () => {
    write('package.json', JSON.stringify({ name: 'app', scripts: { start: 'ng serve --port 4300' } }));
    config(`{ baseUrl: 'http://localhost:8974', webServer: { command: 'npm start', url: 'http://localhost:8974' } }`);

    const { checks } = await collectChecks(root);
    const port = find(checks, 'webServer').filter((check) => check.status === 'warn');

    expect(port).toHaveLength(1);
    expect(port[0]?.detail).toContain('names port 4300');
    expect(port[0]?.detail).toContain('http://localhost:8974');
  });

  it('says nothing about ports when the script serves the one webServer.url waits on', async () => {
    write('package.json', JSON.stringify({ name: 'app', scripts: { start: 'vite --port 8974' } }));
    config(`{ baseUrl: 'http://localhost:8974', webServer: { command: 'npm start', url: 'http://localhost:8974' } }`);

    const { checks } = await collectChecks(root);
    expect(find(checks, 'webServer').filter((check) => check.status !== 'ok')).toHaveLength(0);
  });

  it('says nothing about ports when the script names none, rather than guessing its default', async () => {
    write('package.json', JSON.stringify({ name: 'app', scripts: { start: 'ng serve' } }));
    config(`{ baseUrl: 'http://localhost:8974', webServer: { command: 'npm start', url: 'http://localhost:8974' } }`);

    const { checks } = await collectChecks(root);
    expect(find(checks, 'webServer').filter((check) => check.status !== 'ok')).toHaveLength(0);
  });

  it('catches baseUrl and webServer.url pointing at different addresses', async () => {
    config(`{ baseUrl: 'http://localhost:4173', webServer: { command: 'npm run dev', url: 'http://localhost:5173' } }`);

    const { checks } = await collectChecks(root);
    const mismatch = find(checks, 'webServer').filter((check) => check.status === 'problem');

    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.code).toBe('webserver-url-mismatch');
  });

  it('leaves a command that is not an npm script alone', async () => {
    config(`{ baseUrl: 'http://localhost:4173', webServer: { command: 'node serve.mjs', url: 'http://localhost:4173' } }`);

    const { checks } = await collectChecks(root);
    expect(find(checks, 'webServer')[0]?.status).toBe('ok');
  });
});
