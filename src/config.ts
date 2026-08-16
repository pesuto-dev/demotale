/**
 * One config file in the root of the user's project, `demotale.config.ts`.
 *
 * Every key has a usable default, so `defineConfig({})` is a working configuration. What this module
 * cares about most is what happens when a key is *wrong*: a recording takes minutes and sets up an
 * application, so a typo has to surface as one sentence before the browser opens, not as a stack
 * trace twenty minutes in.
 */
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PlaywrightTestConfig } from '@playwright/test';

import { resolveTheme, type Theme, type ThemeInput } from './theme.js';

export type VideoFormat = 'mp4' | 'gif';

export interface VideoConfig {
  fps: number;
  crf: number;
  formats: VideoFormat[];
  /** Widest a gif may be. A gif of a full 1440-pixel viewport is far too heavy for a README. */
  gifWidth: number;
  /** Frames per second for the gif. Half the video's rate reads fine and halves the file. */
  gifFps: number;
}

export interface CaptionsConfig {
  vtt: boolean;
  transcript: boolean;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface DemotaleConfig {
  /** Where the application runs. A recording opens this once and clicks on from there. */
  baseUrl?: string;
  /** Directory holding `*.demo.ts` and `*.prepare.ts`. */
  scenarios?: string;
  /** Directory the videos, captions and the raw webm end up in. */
  output?: string;
  viewport?: Viewport;
  /** Scales every pause in a scenario. Never touches the application. */
  speed?: number;
  /** Milliseconds Playwright waits between actions, so a click is watchable. */
  slowMo?: number;
  /** Budget for one scenario, in milliseconds. */
  timeout?: number;
  /**
   * Passed to Playwright unchanged. Record against a freshly started application: a recording
   * against whatever happened to be running is a recording against unknown data.
   */
  webServer?: PlaywrightTestConfig['webServer'];
  /** A browser session stored once by `demotale auth`. Missing is a supported state. */
  storageState?: string;
  /** CSS selectors that are never in frame, whatever the click path does. */
  redact?: string[];
  video?: Partial<VideoConfig>;
  captions?: Partial<CaptionsConfig>;
  theme?: ThemeInput;
}

/** A config with every gap filled in. This is what the fixture and the renderer actually read. */
export interface ResolvedConfig {
  baseUrl: string;
  scenarios: string;
  output: string;
  viewport: Viewport;
  speed: number;
  slowMo: number;
  timeout: number;
  webServer: PlaywrightTestConfig['webServer'];
  storageState: string;
  redact: string[];
  video: VideoConfig;
  captions: CaptionsConfig;
  theme: Theme;
}

export class DemotaleConfigError extends Error {
  override readonly name = 'DemotaleConfigError';
}

const DEFAULTS = {
  baseUrl: 'http://localhost:3000',
  scenarios: './demo',
  output: './demo/output',
  viewport: { width: 1440, height: 900 },
  speed: 1,
  slowMo: 120,
  // Generous, because a demo is slower than a test on purpose: reading moments and mouse travel.
  timeout: 10 * 60_000,
  storageState: '.auth/session.json',
} as const;

const DEFAULT_VIDEO: VideoConfig = { fps: 30, crf: 23, formats: ['mp4'], gifWidth: 960, gifFps: 15 };
const DEFAULT_CAPTIONS: CaptionsConfig = { vtt: true, transcript: true };

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'baseUrl',
  'scenarios',
  'output',
  'viewport',
  'speed',
  'slowMo',
  'timeout',
  'webServer',
  'storageState',
  'redact',
  'video',
  'captions',
  'theme',
]);

const VIDEO_FORMATS: ReadonlySet<string> = new Set<VideoFormat>(['mp4', 'gif']);

function fail(message: string): never {
  throw new DemotaleConfigError(`demotale config: ${message}`);
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

function nearest(key: string): string | undefined {
  const lower = key.toLowerCase();
  return [...KNOWN_KEYS].find((known) => known.toLowerCase() === lower);
}

function positive(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`"${key}" must be a number above 0, got ${show(value)}.`);
  }
  return value;
}

function text(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`"${key}" must be a non-empty string, got ${show(value)}.`);
  }
  return value;
}

/**
 * Checks the config and hands it back unchanged, so a config file stays readable as data.
 *
 * It throws on a bad value and on an unknown key: a misspelled key is silently ignored otherwise,
 * and then the setting you thought you changed simply is not there.
 */
export function defineConfig(config: DemotaleConfig = {}): DemotaleConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail(`expected an object, got ${show(config)}.`);
  }

  for (const key of Object.keys(config)) {
    if (KNOWN_KEYS.has(key)) continue;
    const suggestion = nearest(key);
    fail(
      suggestion === undefined
        ? `unknown key "${key}". Known keys: ${[...KNOWN_KEYS].join(', ')}.`
        : `unknown key "${key}". Did you mean "${suggestion}"?`,
    );
  }

  if (config.baseUrl !== undefined) {
    const url = text(config.baseUrl, 'baseUrl');
    // `new URL('localhost:3000')` parses happily, with "localhost:" as the protocol. So the scheme
    // is checked as well, or the most common typo in this file goes through unnoticed.
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      parsed = undefined;
    }
    if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      fail(`"baseUrl" must start with http:// or https://, got ${show(url)}.`);
    }
  }

  if (config.scenarios !== undefined) text(config.scenarios, 'scenarios');
  if (config.output !== undefined) text(config.output, 'output');
  if (config.storageState !== undefined) text(config.storageState, 'storageState');

  if (config.viewport !== undefined) {
    positive(config.viewport?.width, 'viewport.width');
    positive(config.viewport?.height, 'viewport.height');
  }

  if (config.speed !== undefined) positive(config.speed, 'speed');
  if (config.timeout !== undefined) positive(config.timeout, 'timeout');

  if (config.slowMo !== undefined) {
    const { slowMo } = config;
    if (typeof slowMo !== 'number' || !Number.isFinite(slowMo) || slowMo < 0) {
      fail(`"slowMo" must be a number of milliseconds, 0 or more, got ${show(slowMo)}.`);
    }
  }

  if (config.redact !== undefined) {
    if (!Array.isArray(config.redact) || config.redact.some((one) => typeof one !== 'string')) {
      fail(`"redact" must be an array of CSS selectors, got ${show(config.redact)}.`);
    }
  }

  if (config.video !== undefined) {
    if (config.video.fps !== undefined) positive(config.video.fps, 'video.fps');
    if (config.video.gifWidth !== undefined) positive(config.video.gifWidth, 'video.gifWidth');
    if (config.video.gifFps !== undefined) positive(config.video.gifFps, 'video.gifFps');
    if (config.video.crf !== undefined) {
      const { crf } = config.video;
      if (typeof crf !== 'number' || !Number.isInteger(crf) || crf < 0 || crf > 51) {
        fail(`"video.crf" must be a whole number between 0 and 51, got ${show(crf)}.`);
      }
    }
    if (config.video.formats !== undefined) {
      const { formats } = config.video;
      if (!Array.isArray(formats) || formats.length === 0) {
        fail(`"video.formats" must list at least one format, got ${show(formats)}.`);
      }
      for (const format of formats) {
        if (!VIDEO_FORMATS.has(format)) {
          fail(`"video.formats" does not know ${show(format)}. Pick from mp4, gif.`);
        }
      }
    }
  }

  if (config.theme !== undefined && typeof config.theme === 'string') {
    if (config.theme !== 'dark' && config.theme !== 'light') {
      fail(`"theme" by name is either "dark" or "light", got ${show(config.theme)}.`);
    }
  }

  return config;
}

/** Fills every gap. Validates first, so `resolveConfig` on a broken config still explains itself. */
export function resolveConfig(config: DemotaleConfig = {}): ResolvedConfig {
  defineConfig(config);

  return {
    baseUrl: config.baseUrl ?? DEFAULTS.baseUrl,
    scenarios: config.scenarios ?? DEFAULTS.scenarios,
    output: config.output ?? DEFAULTS.output,
    viewport: { ...DEFAULTS.viewport, ...config.viewport },
    speed: config.speed ?? DEFAULTS.speed,
    slowMo: config.slowMo ?? DEFAULTS.slowMo,
    timeout: config.timeout ?? DEFAULTS.timeout,
    webServer: config.webServer,
    storageState: config.storageState ?? DEFAULTS.storageState,
    redact: config.redact ?? [],
    video: { ...DEFAULT_VIDEO, ...config.video },
    captions: { ...DEFAULT_CAPTIONS, ...config.captions },
    theme: resolveTheme(config.theme),
  };
}

/** The file names looked for, in the order they win. */
export const CONFIG_FILES = [
  'demotale.config.ts',
  'demotale.config.mts',
  'demotale.config.mjs',
  'demotale.config.js',
  'demotale.config.json',
] as const;

export interface LoadedConfig {
  /** Absolute path of the file that was read, or `undefined` when nothing was found. */
  file: string | undefined;
  config: ResolvedConfig;
}

export function findConfigFile(cwd = process.cwd()): string | undefined {
  for (const name of CONFIG_FILES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Whether a plain `.ts` file in this directory would be treated as an ES module.
 *
 * Node decides that from the nearest package.json, and a project without `"type": "module"` gets
 * "Cannot use import statement outside a module" for a config file that is obviously ESM. Rather
 * than tell people to change a field that governs their whole project, this is detected up front.
 */
function isEsmDirectory(dir: string): boolean {
  let current = dir;
  for (;;) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { type?: string };
        return pkg.type === 'module';
      } catch {
        return false;
      }
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/**
 * Imports a `.ts` config from a project that is not ESM, by way of a temporary `.mts` copy.
 *
 * `.mts` is ESM whatever the package.json says, and the copy sits next to the original so relative
 * imports inside the config still resolve. It is removed again straight away.
 */
async function importAsEsm(file: string): Promise<{ default?: unknown }> {
  const shadow = join(dirname(file), `.demotale.config.${String(process.pid)}.mts`);
  copyFileSync(file, shadow);
  try {
    return (await import(pathToFileURL(shadow).href)) as { default?: unknown };
  } finally {
    rmSync(shadow, { force: true });
  }
}

/**
 * Reads the config file if there is one, and falls back to the defaults if there is not: a project
 * that is happy with every default should not need an empty file to prove it.
 *
 * TypeScript config files are imported directly, because Node strips the types itself from 22.6 on.
 * When it cannot, this says so in a sentence: "unknown file extension .ts" is not something anybody
 * should have to translate.
 */
export async function loadConfig(cwd = process.cwd()): Promise<LoadedConfig> {
  const file = findConfigFile(cwd);
  if (file === undefined) return { file: undefined, config: resolveConfig({}) };

  if (file.endsWith('.json')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      fail(`${file} is not valid JSON. ${(error as Error).message}`);
    }
    return { file, config: resolveConfig(parsed as DemotaleConfig) };
  }

  const needsShadow = file.endsWith('.ts') && !isEsmDirectory(dirname(file));

  let module: { default?: unknown };
  try {
    module = needsShadow
      ? await importAsEsm(file)
      : ((await import(pathToFileURL(file).href)) as { default?: unknown });
  } catch (error) {
    const message = (error as Error).message;
    if (/[Uu]nknown file extension|Unsupported file/.test(message)) {
      fail(
        `${file} could not be imported by Node ${process.versions.node}, which does not strip ` +
          `TypeScript types. Upgrade to Node 22.6 or later, or rename the file to ` +
          `demotale.config.mjs.`,
      );
    }
    fail(`${file} could not be loaded. ${message}`);
  }

  if (module.default === undefined) {
    fail(`${file} has no default export. End it with "export default defineConfig({ ... })".`);
  }

  return { file, config: resolveConfig(module.default as DemotaleConfig) };
}
