/**
 * `demotale check` — play the click path without filming it.
 *
 * Writing a scenario is a loop: guess a locator, find out, fix it. Doing that loop through `record`
 * costs a minute and a video nobody wants, and the answer it gives when a locator is wrong is a
 * timeout with the locator quoted back at you. This is the same click path at speed, with a frame
 * per subtitle and, when something misses, a list of what the page held instead.
 *
 * It is deliberately the same fixture and the same config as the recording. A second code path that
 * agreed with the recorder on Tuesday would be the thing everybody stops trusting on Wednesday.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { formatReport, looksLikeLogin, wrongOrigin, type CheckReport } from '../check.js';
import { loadConfig } from '../config.js';
import { configEcho, emitJson, jsonReport, type Problem, type ProblemCode } from '../report.js';
import { flagBoolean, type Args } from './args.js';
import { findPlaywrightConfig, resolveBaseUrl, resolvePlaywrightCli } from './record.js';
import { relative, say, warn } from './ui.js';

/** Every `check.json` under a directory, newest first, with the directory it came from. */
function readReports(dir: string): { report: CheckReport; dir: string }[] {
  if (!fs.existsSync(dir)) return [];

  const found: { report: CheckReport; dir: string; at: number }[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'check.json');
    if (!fs.existsSync(file)) continue;
    try {
      found.push({
        report: JSON.parse(fs.readFileSync(file, 'utf8')) as CheckReport,
        dir: path.join(dir, entry.name),
        at: fs.statSync(file).mtimeMs,
      });
    } catch {
      // A half-written report is not worth crashing the command over.
    }
  }

  found.sort((a, b) => a.at - b.at);
  return found.map(({ report, dir: from }) => ({ report, dir: from }));
}

/**
 * A failed scenario as one entry in the shared `problems` list.
 *
 * The whole report is in `result` for a reader that wants the candidates and the frames. This is the
 * short version: which file, which step, which locator, and the fact that the fix is an edit rather
 * than a command.
 */
function problemFrom(report: CheckReport): Problem {
  const { failure } = report;
  const step = failure?.stepIndex === undefined ? undefined : report.steps[failure.stepIndex];
  const badge = step?.badge;
  const locator = failure?.probe?.locator ?? failure?.locator;

  const code: ProblemCode =
    failure === undefined
      ? 'scenario-failed'
      : failure.fromAssertion
        ? 'assertion-failed'
        : failure.probe === undefined
          ? 'scenario-failed'
          : failure.probe.matched > 1
            ? 'locator-ambiguous'
            : 'locator-no-match';

  return {
    code,
    message: failure?.message ?? 'The scenario did not finish.',
    scenario: report.scenario,
    ...(badge === undefined ? {} : { step: badge }),
    ...(locator === undefined ? {} : { locator }),
  };
}

/**
 * Filming somewhere other than the configured address, as a problem in its own right.
 *
 * A green check against the wrong application is the worst answer this command can give, and it has
 * happened: a dry run once came back ok having filmed an unrelated dev server that held the default
 * port. The frames showed it and the report did not, so now the report does.
 */
function wrongOriginProblem(report: CheckReport): Problem[] {
  const elsewhere = wrongOrigin(report);
  if (elsewhere === undefined) return [];

  return [
    {
      code: 'wrong-origin',
      message:
        `The browser was on ${elsewhere.url} ("${elsewhere.title}"), not on the configured ` +
        `${report.baseUrl}. Either that port holds a different application, or yours sent the ` +
        'browser to a login. Everything else in this report is about that page, candidates ' +
        'included.',
      scenario: report.scenario,
      fix: `npx demotale doctor  # then fix baseUrl and webServer, or run: npx demotale auth ${report.baseUrl}`,
    },
  ];
}

/**
 * A run that ended up on a sign-in page, said as such.
 *
 * `doctor` catches this before you start, but only if the application was already up; when the
 * recording starts it itself, the dry run is the first thing that sees the login. Without this the
 * report blames the locator, and the author goes looking for a typo in a scenario that is fine.
 */
function loginProblem(report: CheckReport): Problem[] {
  const filmed = report.pages.filter((page) => looksLikeLogin(page.url));
  if (filmed.length === 0 || report.ok) return [];

  const page = filmed[filmed.length - 1] as (typeof filmed)[number];
  return [
    {
      code: 'needs-login',
      message:
        `The browser was on ${page.url} ("${page.title}"), which looks like a sign-in. Everything ` +
        'below is about that page, so the locator that missed is probably fine. Signing in is a ' +
        'one-off job for a person.',
      scenario: report.scenario,
      fix: `npx demotale auth ${report.baseUrl}`,
    },
  ];
}

export async function checkCommand(args: Args, root = process.cwd()): Promise<number> {
  const { config } = await loadConfig(root);
  const playwrightConfig = findPlaywrightConfig(root);
  const cli = resolvePlaywrightCli(root);

  const outputDir = path.resolve(root, config.output, 'check');
  // Stale frames from a previous check read as this run's, which is worse than having none.
  fs.rmSync(outputDir, { recursive: true, force: true });

  const env: NodeJS.ProcessEnv = { ...process.env, DEMOTALE_CHECK: '1' };
  const baseUrl = resolveBaseUrl(args, config.baseUrl);
  if (baseUrl !== undefined) env['DEMOTALE_BASE_URL'] = baseUrl;

  const filter = args.positional[0];
  const playwrightArgs = [
    cli,
    'test',
    '--config',
    playwrightConfig,
    '--reporter',
    'line',
    ...(flagBoolean(args, 'headed') ? ['--headed'] : []),
    ...(filter === undefined ? [] : [filter]),
    ...args.rest,
  ];

  const started = Date.now();
  const result = spawnSync(process.execPath, playwrightArgs, {
    // The dry run's own output is the report below. Playwright's stack traces would bury it.
    stdio: ['inherit', 'ignore', 'pipe'],
    env,
    cwd: root,
  });
  const elapsed = Date.now() - started;

  const reports = readReports(outputDir);
  const json = flagBoolean(args, 'json');

  if (reports.length === 0) {
    const stderr = (result.stderr ?? '').toString().trim();
    const nothing =
      filter === undefined
        ? 'No scenario ran: there is no *.demo.ts under the scenarios directory.'
        : `No scenario matched "${filter}". The argument is part of a file name, not a path pattern.`;

    if (json) {
      emitJson(
        jsonReport('check', false, [{ code: 'no-scenario-matched', message: nothing }], {
          scenarios: [],
          frameDir: outputDir,
          config: configEcho(config, root),
          playwright: stderr,
        }),
      );
      return result.status === 0 ? 1 : (result.status ?? 1);
    }

    warn(
      filter === undefined
        ? 'demotale check: no scenario ran. There is no *.demo.ts under the scenarios directory.'
        : `demotale check: no scenario matched "${filter}". The argument is part of a file name, ` +
            'not a path pattern.',
    );
    if (stderr !== '') warn(stderr.split('\n').slice(0, 10).join('\n'));
    return result.status === 0 ? 1 : (result.status ?? 1);
  }

  const problems = reports.flatMap(({ report }) => [
    ...loginProblem(report),
    ...(report.ok ? [] : [problemFrom(report)]),
    ...wrongOriginProblem(report),
  ]);

  if (json) {
    emitJson(
      jsonReport('check', problems.length === 0, problems, {
        scenarios: reports.map(({ report }) => report),
        frameDir: outputDir,
        config: configEcho(config, root),
      }),
    );
    return problems.length === 0 ? 0 : 1;
  }

  let failed = 0;
  for (const { report, dir } of reports) {
    say('');
    for (const line of formatReport(report, relative(dir, root))) say(line);
    if (!report.ok) failed += 1;
  }

  say('');
  say(
    failed === 0
      ? `${reports.length} scenario${reports.length === 1 ? '' : 's'} checked in ` +
          `${(elapsed / 1000).toFixed(1)}s. Run "demotale record" to film it.`
      : `${failed} of ${reports.length} failed in ${(elapsed / 1000).toFixed(1)}s.`,
  );

  return failed === 0 ? 0 : 1;
}
