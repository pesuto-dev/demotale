/**
 * `demotale init` — put the files a project needs in place, and nothing else.
 *
 * It never overwrites. Somebody running this a second time, in a project that already records, has
 * usually mistyped something; silently replacing their config with a template would be the worst
 * possible response to that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { agentsBlock, AGENTS_MARKER } from '../agent-guide.js';
import { say, UserFacingError } from './ui.js';

const TEMPLATE_DIR = fileURLToPath(new URL('../../templates/init', import.meta.url));
const CI_DIR = fileURLToPath(new URL('../../templates/ci', import.meta.url));

/** Written into .gitignore, with the reason, because two of these are not obvious. */
const IGNORE_LINES = [
  ['.auth/', 'a stored browser session is a credential, in plain JSON, on disk'],
  ['demo/output/', 'recordings are built artefacts'],
  ['test-results/', 'Playwright leaves these behind'],
  ['playwright-report/', 'Playwright leaves these behind'],
] as const;

const SCRIPTS: Record<string, string> = {
  demo: 'demotale record',
  'demo:render': 'demotale render',
};

export interface InitResult {
  written: string[];
  skipped: string[];
}

function copyTree(from: string, to: string, result: InitResult, root: string): void {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target, result, root);
      continue;
    }

    const shown = path.relative(root, target);
    if (fs.existsSync(target)) {
      result.skipped.push(shown);
      continue;
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    result.written.push(shown);
  }
}

function updateGitignore(root: string, result: InitResult): void {
  const file = path.join(root, '.gitignore');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const lines = new Set(existing.split('\n').map((line) => line.trim()));

  const missing = IGNORE_LINES.filter(([pattern]) => !lines.has(pattern));
  if (missing.length === 0) return;

  // The reason goes on its own line above the pattern. gitignore has no trailing comments: written
  // as `.auth/    # ...` the whole string is the pattern, it matches nothing, and the file that was
  // supposed to be kept out of git is a stored browser session for a real account.
  const block = [
    '',
    '# demotale',
    ...missing.flatMap(([pattern, why]) => [`# ${why}`, pattern]),
    '',
  ];
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fs.writeFileSync(file, existing + separator + block.join('\n'));
  result.written.push(path.relative(root, file));
}

function updatePackageScripts(root: string, result: InitResult): void {
  const file = path.join(root, 'package.json');
  if (!fs.existsSync(file)) return;

  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};

  const added = Object.entries(SCRIPTS).filter(([name]) => scripts[name] === undefined);
  if (added.length === 0) return;

  for (const [name, command] of added) scripts[name] = command;
  pkg.scripts = scripts;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  result.written.push(`${path.relative(root, file)} (${added.map(([name]) => name).join(', ')})`);
}

/**
 * Points whatever writes code in this repository at `demotale agent-guide`.
 *
 * Appends rather than writes, because AGENTS.md belongs to the project and usually already says
 * things. A marker keeps a second run from stacking the block up again.
 */
function updateAgentsFile(root: string, result: InitResult): void {
  const file = path.join(root, 'AGENTS.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  if (existing.includes(AGENTS_MARKER)) {
    result.skipped.push('AGENTS.md (already points at the agent guide)');
    return;
  }

  const separator = existing === '' ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(file, `${existing}${separator}${agentsBlock()}\n`);
  result.written.push(existing === '' ? 'AGENTS.md' : 'AGENTS.md (five lines appended)');
}

export function init(root = process.cwd(), options: { agent?: boolean; ci?: boolean } = {}): InitResult {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    throw new UserFacingError(
      `demotale: the init templates are missing from the installed package (${TEMPLATE_DIR}).`,
      'Reinstall @pesuto/demotale.',
    );
  }

  const result: InitResult = { written: [], skipped: [] };
  copyTree(TEMPLATE_DIR, root, result, root);
  updateGitignore(root, result);
  updatePackageScripts(root, result);
  if (options.agent === true) updateAgentsFile(root, result);
  if (options.ci === true) {
    if (!fs.existsSync(CI_DIR)) {
      throw new UserFacingError(
        `demotale: the CI workflow template is missing from the installed package (${CI_DIR}).`,
        'Reinstall @pesuto/demotale.',
      );
    }
    copyTree(CI_DIR, root, result, root);
  }

  for (const file of result.written) say(`wrote    ${file}`);
  for (const file of result.skipped) say(`kept     ${file} (already there)`);

  say('');
  say('Next: point baseUrl and webServer in demotale.config.ts at your app, then run');
  say('  npx demotale check');
  if (options.agent !== true) {
    say('');
    say('If an agent writes the demos here, run "demotale init --agent" as well.');
  }
  if (options.ci !== true) {
    say('');
    say('If CI should re-record the demo, run "demotale init --ci" as well.');
  }

  return result;
}
