import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { overlayScript, type OverlayWindow } from '../src/overlay.js';
import { defaultTheme } from '../src/theme.js';

/**
 * The overlay is a string injected with addInitScript. String tests can pin that the source still
 * mentions a MutationObserver; they cannot see Playwright run it before <html> exists. These cases
 * open a real Chromium, which is how issue #3 showed up.
 */
const script = overlayScript(defaultTheme);
/** `defaultTheme.cardSurface` (`#0f172a`) as computed CSS. */
const COVER_RGB = 'rgb(15, 23, 42)';
const SIMPLE =
  '<!doctype html><html><head><title>Repro</title></head><body><h1>Hello</h1></body></html>';

interface CoverState {
  readyState: DocumentReadyState;
  domContentLoaded: boolean;
  hasDemo: boolean;
  htmlCovered: boolean;
  hasCoverStyle: boolean;
  beforeBackground: string;
  cardVisible: boolean;
}

function pageIsCovered(state: CoverState): boolean {
  return state.htmlCovered || state.cardVisible;
}

describe('overlay init script in a real browser', { timeout: 30_000 }, () => {
  let browser: Browser | undefined;
  const servers: Server[] = [];
  const held: ServerResponse[] = [];
  const pages: Page[] = [];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  afterEach(async () => {
    for (const res of held.splice(0)) {
      if (!res.writableEnded) {
        res.writeHead(200, { 'Content-Type': 'text/javascript' });
        res.end('');
      }
    }
    await Promise.all(pages.splice(0).map((page) => page.context().close()));
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
      ),
    );
  });

  async function serve(
    handler: (req: IncomingMessage, res: ServerResponse) => void,
  ): Promise<string> {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  async function openCoveredPage(): Promise<{ page: Page; errors: string[] }> {
    if (browser === undefined) throw new Error('browser not launched');
    const context = await browser.newContext();
    await context.addInitScript(script);
    const page = await context.newPage();
    pages.push(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.stack ?? error.message);
    });
    return { page, errors };
  }

  function coverState(): CoverState {
    const loaded = (window as Window & { __domContentLoaded?: boolean }).__domContentLoaded;
    const html = document.documentElement;
    const card = document.querySelector('#__demo-layer .demo-card');
    return {
      readyState: document.readyState,
      domContentLoaded: loaded === true,
      hasDemo: !!(window as OverlayWindow).__demo,
      htmlCovered: html.classList.contains('demotale-cover'),
      hasCoverStyle: document.getElementById('__demo-cover-style') !== null,
      beforeBackground: getComputedStyle(html, '::before').backgroundColor,
      cardVisible: card !== null && !card.classList.contains('hidden'),
    };
  }

  it('does not throw when addInitScript runs before navigation to static HTML', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SIMPLE);
    });
    const { page, errors } = await openCoveredPage();
    await page.goto(origin);
    const state = await page.evaluate(coverState);

    expect(errors).toEqual([]);
    expect(state.hasDemo).toBe(true);
    expect(pageIsCovered(state)).toBe(true);
  });

  it('covers the page before DOMContentLoaded while a deferred script is still pending', async () => {
    const origin = await serve((req, res) => {
      if (req.url === '/hold.js') {
        held.push(res);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!doctype html>
<html>
<head>
  <title>Repro</title>
  <script>
    window.__domContentLoaded = false;
    document.addEventListener('DOMContentLoaded', function () {
      window.__domContentLoaded = true;
    });
  </script>
</head>
<body>
  <h1>Hello</h1>
  <script src="/hold.js" defer></script>
</body>
</html>`);
    });
    const { page, errors } = await openCoveredPage();
    await page.goto(origin, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.readyState === 'interactive');

    const state = await page.evaluate(coverState);
    expect(errors).toEqual([]);
    expect(state.readyState).toBe('interactive');
    expect(state.domContentLoaded).toBe(false);
    expect(state.hasDemo).toBe(true);
    expect(pageIsCovered(state)).toBe(true);
    // The incomplete fix (return until DOMContentLoaded) leaves both of these false here.
    if (!state.cardVisible) {
      expect(state.htmlCovered).toBe(true);
      expect(state.hasCoverStyle).toBe(true);
      expect(state.beforeBackground).toBe(COVER_RGB);
    }
  });

  it('keeps the cover dismissed across a later navigation', async () => {
    const origin = await serve((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(SIMPLE);
    });
    const { page, errors } = await openCoveredPage();
    await page.goto(origin);
    await page.evaluate(() => (window as OverlayWindow).__demo?.hideCard());

    const dismissed = await page.evaluate(coverState);
    expect(dismissed.hasDemo).toBe(true);
    expect(pageIsCovered(dismissed)).toBe(false);

    await page.goto(`${origin}/again`);
    const after = await page.evaluate(coverState);
    expect(errors).toEqual([]);
    expect(after.hasDemo).toBe(true);
    expect(pageIsCovered(after)).toBe(false);
    expect(after.beforeBackground).not.toBe(COVER_RGB);
  });
});
