/**
 * `demotale auth` — sign in once by hand, and keep the session for later recordings.
 *
 * This is the part with the most ways to believe it worked when it did not, so the order of
 * operations here is the whole design, and every step of it was paid for:
 *
 * 1. **Wait for a positive answer, never for something to disappear.** An earlier version waited for
 *    the "sign in" link to go away. An identity provider's login page has no "sign in" link either,
 *    so the check passed a second after the browser opened and stored the negotiation cookies as if
 *    they were a session.
 * 2. **Ask the page, not Node.** The same request through `context.request` shares the cookie jar but
 *    not the origin, and never once answered for a browser that was demonstrably signed in.
 * 3. **Save the moment it is real, not at the end.** Somebody signed in, saw the page they expected,
 *    closed the window, and the script was still in its polling loop: the login was good and nothing
 *    was ever written. Everything after the first save is an improvement on a file that already
 *    exists.
 * 4. **Then test the file in a fresh browser before claiming it works.** If it does not, delete it,
 *    rather than let it fail a recording that is already twenty minutes in.
 *
 * And the waiting loop hangs off a Node timer, not off the page: `page.waitForTimeout` throws the
 * moment the window closes, which turns a person shutting their browser into a stack trace.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContext, Page } from '@playwright/test';

import { loadConfig } from '../config.js';
import { loadPlaywright, type PlaywrightModule } from '../playwright-resolve.js';
import { flagString, parseDuration, type Args } from './args.js';
import { say, UserFacingError, warn } from './ui.js';

/**
 * Playwright for this project: its own copy when present, otherwise demotale's.
 *
 * Loaded with `require` and not with `import()`. @playwright/test resolves to a CommonJS entry, and
 * importing that file by path hands back a namespace whose named exports are not filled in: the first
 * thing this command did with it was read `chromium` off `undefined`.
 */
function importPlaywright(root: string): PlaywrightModule {
  const playwright = loadPlaywright(root);
  if (playwright === undefined) {
    throw new UserFacingError(
      'demotale: @playwright/test is not installed.',
      'Run "npx demotale setup".',
    );
  }
  return playwright;
}

/** A Node timer, deliberately not `page.waitForTimeout`. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * Ask the application who it thinks you are, from inside the page, exactly the way the application's
 * own front end asks. Only a 2xx that arrived without a detour counts as an answer.
 *
 * `redirect: 'manual'` is the load-bearing part. Applications routinely answer an unauthenticated API
 * call with a redirect to a login page, and that page returns 200. Following redirects turns "you are
 * not signed in" into a success, which is the same mistake as treating a missing sign-in link as
 * proof of a session, wearing a different coat.
 */
async function probeSaysSignedIn(page: Page, probe: string): Promise<boolean> {
  try {
    const status = await page.evaluate(async (target: string) => {
      try {
        const response = await fetch(target, {
          credentials: 'include',
          redirect: 'manual',
          headers: { accept: 'application/json' },
        });
        // An opaque redirect reports status 0, which is exactly the answer we want it to be.
        return response.status;
      } catch {
        return 0;
      }
    }, probe);
    return status >= 200 && status < 300;
  } catch {
    // Navigated, or the window went away. Neither is an answer; try again next tick.
    return false;
  }
}

function activePage(context: BrowserContext): Page | undefined {
  const pages = context.pages().filter((page) => !page.isClosed());
  return pages[pages.length - 1];
}

async function save(context: BrowserContext, out: string): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await context.storageState({ path: out });
}

type Verdict = 'works' | 'failed' | 'inconclusive';

interface Verification {
  verdict: Verdict;
  landedOn: string;
  why: string;
}

/** Load a URL in a throwaway browser and report where it ended up. */
async function land(
  playwright: PlaywrightModule,
  url: string,
  storageState: string | undefined,
  probe: string | undefined,
): Promise<{ url: string; probeOk: boolean }> {
  const browser: Browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      ...(storageState === undefined ? {} : { storageState }),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Give a redirect to an identity provider, or a client-side one, time to happen.
    await page.waitForTimeout(2_000);
    return {
      url: page.url(),
      probeOk: probe === undefined ? false : await probeSaysSignedIn(page, probe),
    };
  } finally {
    await browser.close();
  }
}

/**
 * Test the stored file in a browser that has never seen this site, before claiming it works.
 *
 * There are three answers, not two, and the difference matters because the wrong one deletes a file
 * somebody just signed in to produce:
 *
 * - Bounced to another origin, or a named probe says no: it does not work. Delete it.
 * - A named probe says yes, or the page lands somewhere an anonymous browser does not: it works.
 * - No probe given and a signed-in browser lands exactly where an anonymous one lands: unknown. That
 *   is what a single-page app rendering its own login screen at the same URL looks like, and it is
 *   also what a dead session looks like. Say so and keep the file; deleting on a guess is worse than
 *   letting the recording find out.
 */
async function verifyStoredSession(
  playwright: PlaywrightModule,
  out: string,
  verifyUrl: string,
  probe: string | undefined,
): Promise<Verification> {
  const withSession = await land(playwright, verifyUrl, out, probe);

  if (originOf(withSession.url) !== originOf(verifyUrl)) {
    return {
      verdict: 'failed',
      landedOn: withSession.url,
      why: 'it was sent to another origin, which is what an expired session looks like',
    };
  }

  if (probe !== undefined) {
    return withSession.probeOk
      ? { verdict: 'works', landedOn: withSession.url, why: `${probe} answered` }
      : { verdict: 'failed', landedOn: withSession.url, why: `${probe} did not answer` };
  }

  const anonymous = await land(playwright, verifyUrl, undefined, undefined);
  if (anonymous.url !== withSession.url) {
    return {
      verdict: 'works',
      landedOn: withSession.url,
      why: `an anonymous browser lands on ${anonymous.url} instead`,
    };
  }

  return {
    verdict: 'inconclusive',
    landedOn: withSession.url,
    why: 'a browser without the session lands in exactly the same place',
  };
}

export async function authCommand(args: Args, root = process.cwd()): Promise<number> {
  const url = args.positional[0];
  if (url === undefined) {
    throw new UserFacingError('usage: demotale auth <url> [--out .auth/session.json]');
  }

  const targetOrigin = originOf(url);
  if (targetOrigin === undefined) {
    throw new UserFacingError(`demotale: "${url}" is not a URL.`);
  }

  const { config } = await loadConfig(root);
  const out = path.resolve(root, flagString(args, 'out') ?? config.storageState);
  const verifyUrl = flagString(args, 'verify') ?? url;
  const probe = flagString(args, 'probe');
  const settleMs = parseDuration(flagString(args, 'settle') ?? '15s', 'settle');
  const timeoutMs = parseDuration(flagString(args, 'timeout') ?? '10m', 'timeout');

  const playwright = importPlaywright(root);
  const browser = await playwright.chromium.launch({ headless: false });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  say(`Opening ${url}.`);
  say('Sign in the way you normally would. This waits, and saves the session by itself.');
  say('');

  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {
    // A login flow that redirects immediately is normal; the loop below sorts it out.
  });

  const deadline = Date.now() + timeoutMs;
  let restingSince: number | undefined;
  let saved = false;

  while (Date.now() < deadline) {
    const current = activePage(context);
    if (current === undefined) {
      // The person closed the browser. Not an error, just the end of the waiting.
      break;
    }

    let positive = false;

    if (probe !== undefined && (await probeSaysSignedIn(current, probe))) {
      positive = true;
    }

    // A window that simply stays put on the private origin is already what a recording needs. The
    // identity probe is the better signal when it comes, but once it did not come at all while
    // everything was fine, and the file gets tested afterwards regardless.
    const here = originOf(current.url());
    if (here === targetOrigin) {
      restingSince ??= Date.now();
      if (Date.now() - restingSince >= settleMs) positive = true;
    } else {
      restingSince = undefined;
    }

    if (positive) {
      await save(context, out);
      saved = true;
      break;
    }

    await delay(1_000);
  }

  if (saved) {
    // Everything from here on is an improvement on a file that is already on disk.
    try {
      const current = activePage(context);
      if (current !== undefined) {
        await current.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        await delay(1_500);
        await save(context, out);
      }
    } catch {
      // The window went away, or the second load failed. The first save still stands.
    }
  }

  await browser.close().catch(() => {});

  if (!saved) {
    warn('demotale: no session was stored.');
    warn(
      probe === undefined
        ? `Nothing settled on ${targetOrigin} for ${String(Math.round(settleMs / 1_000))}s before the window closed or the wait ran out.`
        : `Neither ${probe} nor a settled window on ${targetOrigin} said you were signed in.`,
    );
    return 1;
  }

  say('');
  say('Testing the stored session in a fresh browser.');

  const { verdict, landedOn, why } = await verifyStoredSession(playwright, out, verifyUrl, probe);

  if (verdict === 'failed') {
    fs.rmSync(out, { force: true });
    warn(`demotale: the stored session did not work. It loaded ${landedOn}, and ${why}.`);
    warn('The file has been deleted rather than left to fail a recording later. Try again.');
    return 1;
  }

  if (verdict === 'inconclusive') {
    warn(`demotale: cannot tell whether the stored session works: ${why}.`);
    warn(`The file is kept at ${path.relative(root, out)}, unverified.`);
    warn('Pass --probe <path> with a URL that only answers for a signed-in user to be sure.');
    return 0;
  }

  say(`verified: ${path.relative(root, out)} (${why})`);
  say('That file is a signed-in browser session for a real account, in plain JSON.');
  say('Treat it as a credential and keep it out of git.');
  return 0;
}
