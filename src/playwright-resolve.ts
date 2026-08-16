/**
 * Where `@playwright/test` comes from for this install of demotale.
 *
 * Prefer the project's copy when it has one (one Playwright, one browser download). Fall back to the
 * copy that ships with demotale, which is what a one-package `npm i -D @pesuto/demotale` leaves you
 * with under pnpm and other non-hoisting layouts.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

export type PlaywrightModule = typeof import('@playwright/test');

export interface ResolvedPlaywright {
  /** Absolute path of the package entry that resolved. */
  entry: string;
  /** Absolute path of Playwright's CLI (`cli.js`). */
  cli: string;
  /** `require` bound to the place the package was found, so version walks stay consistent. */
  require: NodeRequire;
}

function tryResolve(require: NodeRequire): ResolvedPlaywright | undefined {
  try {
    const entry = require.resolve('@playwright/test');
    const cli = path.join(path.dirname(entry), 'cli.js');
    if (!fs.existsSync(cli)) return undefined;
    return { entry, cli, require };
  } catch {
    return undefined;
  }
}

/** Resolve Playwright for `root`, or `undefined` when neither the project nor demotale has it. */
export function resolvePlaywright(root: string): ResolvedPlaywright | undefined {
  return (
    tryResolve(createRequire(path.join(root, 'package.json'))) ??
    tryResolve(createRequire(import.meta.url))
  );
}

/** Load the Playwright module the same way `auth` always had to: via `require`, not `import()`. */
export function loadPlaywright(root: string): PlaywrightModule | undefined {
  const resolved = resolvePlaywright(root);
  if (resolved === undefined) return undefined;
  return resolved.require('@playwright/test') as PlaywrightModule;
}
