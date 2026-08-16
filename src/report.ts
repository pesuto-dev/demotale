/**
 * What every command answers when it is asked in JSON.
 *
 * The reader here is not a person scanning a terminal, it is whatever wrote the scenario and now has
 * to decide what to change. That reader needs two things: one envelope it can learn once, and one
 * place to look for "what do I fix". So every command answers the same shape, `problems` always
 * exists, and the command-specific detail sits under `result` where it cannot get in the way.
 *
 * The rule this file exists to keep: in JSON mode, stdout carries the document and nothing else.
 * A stray line of prose in front of it turns a parse into an error message about position 0.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import type { ResolvedConfig } from './config.js';

/** Resolved from dist/, which puts the package root one level up. */
const version = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

export type CommandName = 'check' | 'record' | 'render' | 'doctor';

/**
 * One thing that is wrong and, where such a thing exists, the command that would fix it.
 *
 * Everything is optional except the sentence, because the same list carries "chromium is not
 * downloaded" and "step 2 asked for a button that is not on the page".
 */
/**
 * What kind of thing went wrong, as a value rather than as a sentence.
 *
 * Without this a reader classifies failures by matching English prose, which breaks the first time
 * the prose is improved. These strings are the stable part; the message is the readable part.
 */
export type ProblemCode =
  | 'locator-no-match'
  | 'locator-ambiguous'
  | 'assertion-failed'
  | 'scenario-failed'
  | 'wrong-origin'
  | 'no-scenario-matched'
  | 'record-failed'
  | 'no-recording'
  | 'missing-ffmpeg'
  | 'needs-login'
  | 'webserver-command-missing'
  | 'webserver-url-mismatch'
  | 'config-untouched'
  | 'unreachable'
  | 'missing-dependency'
  | 'no-scenarios'
  | 'node-too-old'
  | 'environment';

export interface Problem {
  code: ProblemCode;
  message: string;
  /** A shell command that fixes it. Absent when the fix is an edit rather than a command. */
  fix?: string;
  /** Scenario file, relative to the project root, when the problem belongs to one. */
  scenario?: string;
  /** Step number as printed, when the problem belongs to a step. */
  step?: string;
  /** The locator as the author wrote it, when a locator was the cause. */
  locator?: string;
}

export interface JsonReport<T> {
  /** The version that produced this, so a reader can tell an old shape from a new one. */
  demotale: string;
  command: CommandName;
  ok: boolean;
  /** Empty when nothing is wrong. Never absent, so a reader never has to check for it. */
  problems: Problem[];
  result: T;
}

export function jsonReport<T>(
  command: CommandName,
  ok: boolean,
  problems: Problem[],
  result: T,
): JsonReport<T> {
  return { demotale: version, command, ok, problems, result };
}

/**
 * The settings a run actually used, echoed back.
 *
 * After editing a config, the next question is always "did that take effect". Without this the only
 * answer is to infer it from a changed failure, which is inference where a fact would do.
 */
export interface ConfigEcho {
  baseUrl: string;
  scenarios: string;
  output: string;
  storageState: string;
  webServer?: { command: string; url?: string }[];
}

export function configEcho(config: ResolvedConfig, root: string): ConfigEcho {
  const servers =
    config.webServer === undefined
      ? []
      : Array.isArray(config.webServer)
        ? config.webServer
        : [config.webServer];

  return {
    baseUrl: config.baseUrl,
    scenarios: resolve(root, config.scenarios),
    output: resolve(root, config.output),
    storageState: resolve(root, config.storageState),
    ...(servers.length === 0
      ? {}
      : {
          webServer: servers.map((server) => ({
            command: server.command,
            ...(typeof server.url === 'string' ? { url: server.url } : {}),
          })),
        }),
  };
}

/** The document, and nothing else, on stdout. */
export function emitJson(report: JsonReport<unknown>): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
