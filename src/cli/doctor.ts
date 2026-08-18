/**
 * `demotale doctor` — everything that can be missing, checked before it costs an afternoon.
 *
 * The reason this command exists: a recording that fails on a missing browser fails *after* the
 * environment is up and part one is filmed, twenty minutes in. Every check here is cheap and runs
 * inside ten seconds, and each problem is one sentence saying what to do about it.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

import { AGENTS_MARKER } from '../agent-guide.js';
import { looksLikeLogin } from '../check.js';
import { findConfigFile, loadConfig, type ResolvedConfig } from '../config.js';
import { ffmpegMissingFix, ffmpegSourceDetail, resolveFfmpeg } from '../ffmpeg.js';
import { resolvePlaywright } from '../playwright-resolve.js';
import { configEcho, emitJson, jsonReport, type ProblemCode } from '../report.js';
import { say, warn } from './ui.js';

type Status = 'ok' | 'warn' | 'problem';

export interface Check {
  status: Status;
  label: string;
  detail: string;
  /**
   * The command that fixes it, when a command can.
   *
   * A field rather than a sentence inside `detail`, because the reader might be an agent deciding
   * what to run next, and "the command is in there somewhere, in quotes" is not an interface.
   */
  fix?: string;
  /**
   * What kind of thing is missing, for a reader that has to decide what to do next. Same reason the
   * rest of the JSON carries codes: "needs a login" and "chromium is not downloaded" are different
   * situations and should not have to be told apart by reading English.
   */
  code?: ProblemCode;
}

const MARK: Record<Status, string> = { ok: ' ok ', warn: 'warn', problem: 'fail' };

/** The floor comes from our own package.json, so this check can never drift away from what npm says. */
function nodeCheck(): Check {
  const pkg = createRequire(import.meta.url)('../../package.json') as {
    engines: { node: string };
  };
  const required = pkg.engines.node.replace(/^[^\d]*/, '');
  const parts = (version: string): number[] => version.split('.').map(Number);
  const [wantMajor = 0, wantMinor = 0] = parts(required);
  const [haveMajor = 0, haveMinor = 0] = parts(process.versions.node);

  const good = haveMajor > wantMajor || (haveMajor === wantMajor && haveMinor >= wantMinor);
  return good
    ? { status: 'ok', label: 'node', detail: process.versions.node }
    : {
        status: 'problem',
        label: 'node',
        code: 'node-too-old',
        detail:
          `${process.versions.node}; demotale needs ${required} or later. It reads TypeScript ` +
          'config files without a build step, and that is where Node learned to do it.',
      };
}

function ffmpegCheck(): Check {
  const resolved = resolveFfmpeg();
  if (resolved !== undefined) {
    return {
      status: 'ok',
      label: 'ffmpeg',
      detail: ffmpegSourceDetail(resolved.source),
    };
  }
  return {
    status: 'warn',
    label: 'ffmpeg',
    detail: 'not available, so recordings stay as webm.',
    fix: ffmpegMissingFix(),
  };
}

/**
 * The version in a package's own package.json, found from the file that was resolved out of it.
 *
 * Two ways in, because neither works everywhere: the subpath resolves only while a package exports
 * `./package.json`, and walking up from the entry file only works while the install is a plain
 * directory. Nothing is guessed if both miss.
 */
function packageVersion(
  require: ReturnType<typeof createRequire>,
  name: string,
  entry: string,
): string | undefined {
  const read = (file: string): string | undefined => {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: string; version?: string };
      return pkg.name === name ? pkg.version : undefined;
    } catch {
      return undefined;
    }
  };

  try {
    const found = read(require.resolve(`${name}/package.json`));
    if (found !== undefined) return found;
  } catch {
    // No exports entry for it; the walk below is the other way in.
  }

  let dir = path.dirname(entry);
  // Three levels is `dist/cjs/index.js` and then some; further up is somebody else's package.
  for (let level = 0; level < 4; level += 1) {
    const found = read(path.join(dir, 'package.json'));
    if (found !== undefined) return found;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function playwrightCheck(root: string): Check[] {
  const resolved = resolvePlaywright(root);
  if (resolved === undefined) {
    return [
      {
        status: 'problem',
        label: 'playwright',
        code: 'missing-dependency',
        detail: 'not installed.',
        fix: 'npx demotale setup',
      },
    ];
  }

  // The version, not the path it was found at. A path is only ever the diagnosis when something is
  // wrong with it, and on a hoisting monorepo the right path is one the reader does not recognise:
  // three trials in a row read a correct line as their gravest finding. Failures below still carry
  // the path, because there the location is the thing worth knowing.
  const version = packageVersion(resolved.require, '@playwright/test', resolved.entry);
  const checks: Check[] = [{ status: 'ok', label: 'playwright', detail: version ?? 'installed' }];

  try {
    const { chromium } = resolved.require('@playwright/test') as typeof import('@playwright/test');
    const executable = chromium.executablePath();
    checks.push(
      fs.existsSync(executable)
        ? { status: 'ok', label: 'chromium', detail: 'downloaded' }
        : {
            status: 'problem',
            label: 'chromium',
            code: 'missing-dependency',
            detail: 'not downloaded.',
            fix: 'npx demotale setup',
          },
    );
  } catch (error) {
    checks.push({
      status: 'problem',
      label: 'chromium',
      code: 'missing-dependency',
      // With the path, because a package that resolves but will not load is a broken install and
      // where it sits is the first thing you want to know about it.
      detail: `${(error as Error).message} (from ${path.dirname(resolved.entry)})`,
      fix: 'npx demotale setup',
    });
  }

  return checks;
}

function configChecks(root: string, config: ResolvedConfig, file: string | undefined): Check[] {
  const checks: Check[] = [
    file === undefined
      ? {
          status: 'warn',
          label: 'config',
          detail: 'no demotale.config found, so every default applies.',
          fix: 'npx demotale init',
        }
      : { status: 'ok', label: 'config', detail: path.relative(root, file) },
  ];

  // Recursive, because Playwright's testMatch is: counting only the top level would report "nothing
  // to record" for a project that keeps its scenarios in folders.
  const scenarios = path.resolve(root, config.scenarios);
  const found = fs.existsSync(scenarios)
    ? fs
        .readdirSync(scenarios, { recursive: true, encoding: 'utf8' })
        .filter((name) => name.endsWith('.demo.ts')).length
    : 0;
  checks.push(
    found > 0
      ? { status: 'ok', label: 'scenarios', detail: `${String(found)} in ${config.scenarios}` }
      : {
          status: 'problem',
          label: 'scenarios',
          code: 'no-scenarios',
          detail:
            `no *.demo.ts in ${config.scenarios}, so there is nothing to record. Write one; init ` +
            'leaves an example behind to start from.',
          fix: 'npx demotale init',
        },
  );

  const storageState = path.resolve(root, config.storageState);
  checks.push(
    fs.existsSync(storageState)
      ? { status: 'ok', label: 'session', detail: `${config.storageState} (a credential, keep it out of git)` }
      : {
          status: 'ok',
          label: 'session',
          detail: 'none stored, which is fine unless the app needs a login',
        },
  );

  if (config.timeout > 15 * 60_000) {
    checks.push({
      status: 'warn',
      label: 'timeout',
      detail:
        `${String(Math.round(config.timeout / 60_000))} minutes per scenario. A scenario that waits ` +
        'on something that never appears will burn all of it before saying so.',
    });
  }

  return checks;
}

/** Whether Playwright has been told to start the app itself and refuse to reuse a running one. */
function startsItsOwnServer(config: ResolvedConfig): boolean {
  const { webServer } = config;
  if (webServer === undefined) return false;
  const servers = Array.isArray(webServer) ? webServer : [webServer];
  return servers.some((server) => server.reuseExistingServer === false);
}

/**
 * Does the command that is supposed to start the application exist at all?
 *
 * `init` writes `npm start`, and plenty of projects have no `start` script. Nothing checked this, so
 * the way you found out was a recording that died after the browser was already up. Two agents in a
 * row worked it out by reading package.json themselves, which is a job a preflight should have done.
 */
function webServerCheck(root: string, config: ResolvedConfig): Check[] {
  const { webServer } = config;
  if (webServer === undefined) return [];

  const servers = Array.isArray(webServer) ? webServer : [webServer];
  const file = path.join(root, 'package.json');
  const scripts = fs.existsSync(file)
    ? ((JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: Record<string, string> }).scripts ??
      {})
    : {};

  return servers.flatMap((server): Check[] => {
    const mismatch = urlMismatch(config.baseUrl, server.url);
    const script = npmScriptName(server.command);
    const body = script === undefined ? undefined : scripts[script];
    const command: Check =
      script === undefined
        ? { status: 'ok', label: 'webServer', detail: server.command }
        : body !== undefined
          ? { status: 'ok', label: 'webServer', detail: `${server.command} → ${body}` }
          : {
              status: 'problem',
              label: 'webServer',
              code: 'webserver-command-missing',
              detail:
                `webServer.command is "${server.command}" but this project has no "${script}" ` +
                'script' +
                (Object.keys(scripts).length === 0
                  ? '.'
                  : `. It has: ${Object.keys(scripts).join(', ')}. Put the right one in ` +
                    'demotale.config.ts.'),
            };

    const port =
      body === undefined ? undefined : scriptPortMismatch(server.command, body, server.url);

    return [
      command,
      ...(port === undefined ? [] : [port]),
      ...(mismatch === undefined ? [] : [mismatch]),
    ];
  });
}

/**
 * Ports a shell command hands to whatever it starts.
 *
 * Only the forms that spell a number out: `--port 4300`, `--port=4300`, `-p 4300`, `PORT=4300`. A
 * command that says nothing about a port says nothing here either, on purpose. Which port a server
 * picks when it is not told is knowledge about that particular server, and guessing it is how a
 * preflight starts inventing.
 */
export function scriptPorts(command: string): string[] {
  const ports = new Set<string>();
  for (const pattern of [
    /--port[= ]\s*(\d{2,5})\b/g,
    /(?:^|\s)-p[= ]?\s*(\d{2,5})\b/g,
    /(?:^|\s)PORT=(\d{2,5})\b/g,
  ]) {
    for (const match of command.matchAll(pattern)) {
      if (match[1] !== undefined) ports.add(match[1]);
    }
  }
  return [...ports];
}

/**
 * The script names a port, and it is not the one the recording will wait on.
 *
 * A warning rather than a failure: the number is a fact, but which process it belongs to is not.
 * A script that starts an API on one port and the application on its default would land here
 * wrongly, and being wrong about that is cheaper as a remark than as a refusal.
 */
function scriptPortMismatch(
  command: string,
  script: string,
  serverUrl: string | undefined,
): Check | undefined {
  if (typeof serverUrl !== 'string') return undefined;

  let expected: string;
  try {
    const url = new URL(serverUrl);
    expected = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
  } catch {
    return undefined;
  }

  const ports = scriptPorts(script);
  if (ports.length === 0 || ports.includes(expected)) return undefined;

  return {
    status: 'warn',
    label: 'webServer',
    code: 'webserver-url-mismatch',
    detail:
      `"${command}" runs "${script}", which names port ${ports.join(' and ')}, while ` +
      `webServer.url waits on ${serverUrl}. If the application comes up on the port in that ` +
      'script, a recording starts the server on one address and then waits on another. Either put ' +
      `port ${ports[0] ?? expected} in baseUrl and webServer.url, or tell the script to serve on ` +
      `${expected}.`,
  };
}

/**
 * baseUrl and webServer.url have to be the same address.
 *
 * They are two settings for one thing: where the application is. Move one and Playwright starts the
 * server on one port and then waits for it on another, which reads as "the app never came up".
 */
function urlMismatch(baseUrl: string, serverUrl: string | undefined): Check | undefined {
  if (typeof serverUrl !== 'string') return undefined;
  try {
    if (new URL(baseUrl).origin === new URL(serverUrl).origin) return undefined;
  } catch {
    return undefined;
  }

  return {
    status: 'problem',
    label: 'webServer',
    code: 'webserver-url-mismatch',
    detail:
      `baseUrl is ${baseUrl} but webServer.url is ${serverUrl}. They are two settings for one ` +
      'address: the recording would start the server on one and then wait for it on the other.',
  };
}

/** The script an npm-shaped command runs, or nothing when the command is something else entirely. */
export function npmScriptName(command: string): string | undefined {
  const match = /^\s*(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:@./-]+)/.exec(command);
  const name = match?.[1];
  if (name === undefined) return undefined;
  // `npm test` and `npm start` are the two that run without `run`, and both are real script names.
  return ['exec', 'dlx', 'x'].includes(name) ? undefined : name;
}

/**
 * The three values `templates/init/demotale.config.ts` writes, kept here so this check can compare
 * against them rather than against an idea of them.
 */
const INIT_WROTE = {
  baseUrl: 'http://localhost:3000',
  command: 'npm start',
  url: 'http://localhost:3000',
} as const;

/** All three still literally what `init` wrote. Not an inference: a string comparison. */
function stillAsInitWroteIt(config: ResolvedConfig): boolean {
  if (config.baseUrl !== INIT_WROTE.baseUrl) return false;
  const { webServer } = config;
  if (webServer === undefined) return false;
  const servers = Array.isArray(webServer) ? webServer : [webServer];
  // More than one server means somebody has been in here.
  const [server] = servers;
  if (servers.length !== 1 || server === undefined) return false;
  return server.command === INIT_WROTE.command && server.url === INIT_WROTE.url;
}

/**
 * Whether the config still holds the address `init` wrote.
 *
 * On its own the address means nothing; plenty of applications really do run on port 3000. Two
 * signals make it say something.
 *
 * The first is decisive: the default address next to a webServer command that does not resolve.
 * That pair is the state two trials got into, a config nobody had pointed at anything, quietly
 * filming whatever held the port.
 *
 * The second is weaker but always measurable, and it exists because the first one only fires on
 * projects without a `start` script. Every framework generator writes one, so on an Angular or Vite
 * project `npm start` resolves and the decisive pair never forms; measured on an Angular project
 * where nothing but `init` had run, and doctor said there was nothing in the way. What can still be
 * measured there is whether all three values init writes are untouched. That is a fact, and it can
 * be a coincidence, so it is a remark and not a refusal, and it says which part is certain.
 */
function untouchedConfigCheck(config: ResolvedConfig, checks: Check[]): Check[] {
  const defaultBaseUrl = config.baseUrl === INIT_WROTE.baseUrl;
  const brokenServer = checks.some(
    (check) => check.label === 'webServer' && check.status === 'problem',
  );

  if (defaultBaseUrl && brokenServer) {
    return [
      {
        status: 'problem',
        label: 'config',
        code: 'config-untouched',
        detail:
          'baseUrl is still http://localhost:3000 and the webServer command does not resolve, so ' +
          'this config was never pointed at your application. Whatever answers that port is ' +
          "somebody else's program, and a recording would film it.",
      },
    ];
  }

  if (!stillAsInitWroteIt(config)) return [];

  return [
    {
      status: 'warn',
      label: 'config',
      code: 'config-untouched',
      detail:
        `baseUrl, webServer.url and webServer.command are still exactly what init wrote ` +
        `(${INIT_WROTE.baseUrl} and "${INIT_WROTE.command}"), so nothing has pointed this config ` +
        'at your application yet. That can be right by accident, and only you can settle it: open ' +
        `${INIT_WROTE.baseUrl} and confirm the program answering there is yours. If it is not, put ` +
        'the address your application serves in baseUrl and webServer.url, and the script that ' +
        'starts it in webServer.command.',
    },
  ];
}

async function baseUrlCheck(config: ResolvedConfig, hasSession: boolean): Promise<Check> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    // Manual, because following the redirect is how you come to report success for a browser that
    // is not signed in: an application answers an unauthenticated request with a redirect, and the
    // login page it lands on returns 200.
    const response = await fetch(config.baseUrl, {
      signal: controller.signal,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') ?? '(no Location header)';
      // A login with no stored session is not a warning, it is the recording you are about to make:
      // a video of somebody else's sign-in screen. With a session on disk it is expected, because
      // the browser that records carries that session and this bare fetch does not.
      const isLogin = looksLikeLogin(location);
      return {
        status: isLogin ? (hasSession ? 'warn' : 'problem') : 'ok',
        label: 'baseUrl',
        ...(isLogin ? { code: 'needs-login' as const } : {}),
        detail:
          `${config.baseUrl} answers ${String(response.status)} and sends the browser to ` +
          `${location}` +
          (isLogin
            ? hasSession
              ? ', which looks like a sign-in. You have a stored session, so the browser that ' +
                'records may well get past it; this bare request has no session at all.'
              : ', which looks like a sign-in, and there is no stored session. Signing in is a ' +
                'one-off job for a person, not something a recording can do.'
            : '.'),
        ...(isLogin ? { fix: `npx demotale auth ${config.baseUrl}` } : {}),
      };
    }

    // Something answering is good news only if nothing is about to try to take that port. With
    // reuseExistingServer: false, Playwright refuses to start and the recording is over before it
    // began, so this is the one case where a reachable baseUrl is the problem.
    if (startsItsOwnServer(config)) {
      return {
        status: 'warn',
        label: 'baseUrl',
        detail:
          `something already answers on ${config.baseUrl}, and webServer.reuseExistingServer is ` +
          'false, so a recording will refuse to start. First make sure that address is your ' +
          'application at all: if baseUrl is still the one init wrote, this is a different program ' +
          'holding the port, and changing the port would only hide that.',
      };
    }

    return {
      status: 'ok',
      label: 'baseUrl',
      detail: `${config.baseUrl} answers ${String(response.status)}`,
    };
  } catch {
    return config.webServer === undefined
      ? {
          status: 'problem',
          label: 'baseUrl',
          code: 'unreachable',
          detail:
            `${config.baseUrl} does not answer, and no webServer is configured to start it. Either ` +
            'start the application yourself, or add webServer to demotale.config.ts so a recording ' +
            'starts it.',
        }
      : {
          status: 'ok',
          label: 'baseUrl',
          detail:
            `${config.baseUrl} is not up; webServer will start it for the recording. Nothing was ` +
            'asked of it, so whether it wants a sign-in is not known yet — start it and run this ' +
            'again if you want that answered before you record.',
        };
  } finally {
    clearTimeout(timer);
  }
}

function agentGuideCheck(root: string): Check {
  const file = path.join(root, 'AGENTS.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (existing.includes(AGENTS_MARKER)) {
    return { status: 'ok', label: 'agent', detail: 'AGENTS.md points at demotale agent-guide' };
  }
  return {
    status: 'warn',
    label: 'agent',
    code: 'missing-agent-guide',
    detail:
      'AGENTS.md does not point at demotale agent-guide, so an agent will invent a scenario from memory.',
    fix: 'npx demotale init',
  };
}

function ciWorkflowCheck(root: string): Check {
  const workflow = path.join('.github', 'workflows', 'demotale.yml');
  if (fs.existsSync(path.join(root, workflow))) {
    return { status: 'ok', label: 'ci', detail: workflow };
  }
  return {
    status: 'warn',
    label: 'ci',
    code: 'missing-ci-workflow',
    detail: 'no GitHub Actions workflow, so a UI change will not re-record the demo.',
    fix: 'npx demotale init --ci',
  };
}

export async function collectChecks(
  root: string,
): Promise<{ checks: Check[]; config: ResolvedConfig | undefined }> {
  const checks: Check[] = [nodeCheck(), ffmpegCheck(), ...playwrightCheck(root)];
  let config: ResolvedConfig | undefined;

  const file = findConfigFile(root);
  try {
    const loaded = await loadConfig(root);
    config = loaded.config;
    checks.push(...configChecks(root, loaded.config, loaded.file));
    if (loaded.file !== undefined) {
      checks.push(agentGuideCheck(root), ciWorkflowCheck(root));
    }

    const server = webServerCheck(root, loaded.config);
    checks.push(...server);
    checks.push(...untouchedConfigCheck(loaded.config, server));
    const hasSession = fs.existsSync(path.resolve(root, loaded.config.storageState));
    checks.push(await baseUrlCheck(loaded.config, hasSession));
  } catch (error) {
    checks.push({
      status: 'problem',
      label: 'config',
      code: 'environment',
      detail: `${file ?? 'demotale.config'} could not be read. ${(error as Error).message}`,
    });
  }

  return { checks, config };
}

export async function doctorCommand(root = process.cwd(), json = false): Promise<number> {
  const { checks, config } = await collectChecks(root);
  const problems = checks.filter((check) => check.status === 'problem');

  if (json) {
    emitJson(
      jsonReport(
        'doctor',
        problems.length === 0,
        // Warnings are not problems: ffmpeg missing still leaves you a webm. They stay in `checks`,
        // where a reader that cares can find them.
        problems.map((check) => ({
          code: check.code ?? 'environment',
          message: `${check.label}: ${check.detail}`,
          ...(check.fix === undefined ? {} : { fix: check.fix }),
        })),
        { checks, ...(config === undefined ? {} : { config: configEcho(config, root) }) },
      ),
    );
    return problems.length === 0 ? 0 : 1;
  }

  for (const check of checks) {
    const fix = check.fix === undefined ? '' : ` Run: ${check.fix}`;
    const line = `[${MARK[check.status]}] ${check.label.padEnd(10)} ${check.detail}${fix}`;
    if (check.status === 'problem') warn(line);
    else say(line);
  }

  say('');
  say(
    problems.length === 0
      ? 'Nothing in the way of a recording.'
      : `${String(problems.length)} to fix first. Nothing was installed or started: this command ` +
          'only looks.',
  );
  return problems.length === 0 ? 0 : 1;
}
