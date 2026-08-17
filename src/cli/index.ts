#!/usr/bin/env node
/**
 * The `demotale` command.
 *
 * Every subcommand returns an exit code rather than calling `process.exit`, so the dispatch below is
 * the only place that decides how the process ends, and a mistake in a command cannot cut off output
 * that was on its way to the terminal.
 */
import { createRequire } from 'node:module';

import { agentGuide } from '../agent-guide.js';
import { DemotaleConfigError } from '../config.js';
import { flagBoolean, parseArgs } from './args.js';
import { authCommand } from './auth.js';
import { checkCommand } from './check.js';
import { doctorCommand } from './doctor.js';
import { init } from './init.js';
import { joinCommand } from './join.js';
import { recordCommand } from './record.js';
import { renderCommand } from './render.js';
import { setupCommand } from './setup.js';
import { say, UserFacingError, warn } from './ui.js';

// Resolved from dist/cli/, which puts the package root two levels up.
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const COMMANDS = [
  ['init', 'Write a config, an example scenario and the npm scripts. Never overwrites.'],
  ['agent-guide', 'Print the instructions for whatever writes the scenarios. One page.'],
  ['setup', 'Download Chromium (and verify ffmpeg) when postinstall was skipped.'],
  ['check [file]', 'Play the click path without filming it, and write a frame per subtitle.'],
  ['record [file]', 'Play the click path, record it, and render the result.'],
  ['render', 'Turn what was recorded into a video.'],
  ['join <a> <b> <out>', 'Put two recordings end to end without re-encoding.'],
  ['auth <url>', 'Sign in once by hand and store the browser session.'],
  ['doctor', 'Check everything that can be missing, before a recording finds out.'],
] as const;

const OPTIONS = [
  ['init', '--agent (five lines in AGENTS.md pointing at the guide), --ci (GitHub Actions workflow)'],
  ['check', '--headed, --port <n>, --base-url <url>, --json, -- <playwright args>'],
  [
    'record',
    '--headed, --speed <n>, --slow-mo <ms>, --port <n>, --base-url <url>, --no-render, --json',
  ],
  ['render', '--json'],
  ['doctor', '--json'],
  ['auth', '--out <file>, --verify <url>, --probe <path>, --settle <15s>, --timeout <10m>'],
] as const;

function usage(): string {
  const width = Math.max(...COMMANDS.map(([name]) => name.length));
  return [
    `demotale ${pkg.version} — record a demo of your web app, from a script in your repository.`,
    '',
    'Usage: demotale <command> [options]',
    '',
    ...COMMANDS.map(([name, what]) => `  ${name.padEnd(width)}  ${what}`),
    '',
    'Options:',
    ...OPTIONS.map(([name, list]) => `  ${name.padEnd(width)}  ${list}`),
    '',
  ].join('\n');
}

async function run(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    say(usage());
    return 0;
  }

  if (command === '--version' || command === '-v') {
    say(pkg.version);
    return 0;
  }

  // `demotale check --help` used to run the check. Asking a command what it does should never be
  // the thing that does it. Anything after `--` belongs to Playwright, so it is left alone.
  const separator = rest.indexOf('--');
  const own = separator === -1 ? rest : rest.slice(0, separator);
  if (own.includes('--help') || own.includes('-h')) {
    say(usage());
    return 0;
  }

  // Flags that take no value. Anything not listed here swallows the next word, which for `record`
  // would quietly turn a single named scenario into all of them.
  const BOOLEAN_FLAGS: Record<string, string[]> = {
    init: ['agent', 'ci'],
    record: ['headed', 'json'],
    check: ['headed', 'json'],
    render: ['json'],
    doctor: ['json'],
  };
  const args = parseArgs(rest, BOOLEAN_FLAGS[command] ?? []);
  const json = flagBoolean(args, 'json');

  switch (command) {
    case 'init':
      init(process.cwd(), { agent: flagBoolean(args, 'agent'), ci: flagBoolean(args, 'ci') });
      return 0;
    case 'agent-guide':
      say(agentGuide());
      return 0;
    case 'setup':
      return setupCommand(process.cwd());
    case 'check':
      return checkCommand(args);
    case 'record':
      return recordCommand(args);
    case 'render':
      return renderCommand(process.cwd(), json);
    case 'join':
      return joinCommand(args.positional);
    case 'auth':
      return authCommand(args);
    case 'doctor':
      return doctorCommand(process.cwd(), json);
    default:
      warn(`demotale: unknown command "${command}".`);
      warn('');
      warn(usage());
      return 1;
  }
}

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (error) {
  if (error instanceof UserFacingError) {
    warn(error.message);
    if (error.hint !== undefined) warn(error.hint);
  } else if (error instanceof DemotaleConfigError) {
    warn(error.message);
  } else {
    warn(`demotale: ${(error as Error).stack ?? String(error)}`);
  }
  process.exitCode = 1;
}
