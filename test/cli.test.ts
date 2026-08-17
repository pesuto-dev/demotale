import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flagBoolean, flagNumber, flagString, parseArgs, parseDuration } from '../src/cli/args.js';
import { init } from '../src/cli/init.js';

describe('parseArgs', () => {
  it('reads a flag with a value', () => {
    expect(flagString(parseArgs(['--out', 'x.json']), 'out')).toBe('x.json');
  });

  it('reads --key=value', () => {
    expect(flagString(parseArgs(['--out=x.json']), 'out')).toBe('x.json');
  });

  it('treats a flag with nothing after it as true', () => {
    expect(flagBoolean(parseArgs(['--headed']), 'headed')).toBe(true);
  });

  it('does not swallow the next flag as a value', () => {
    const args = parseArgs(['--headed', '--speed', '1.4']);
    expect(flagBoolean(args, 'headed')).toBe(true);
    expect(flagNumber(args, 'speed')).toBe(1.4);
  });

  it('does not swallow a positional after a declared boolean flag', () => {
    // Without this, "demotale record --headed demo/tour.demo.ts" records every scenario instead of
    // the one that was named, and says nothing about it.
    const args = parseArgs(['--headed', 'demo/tour.demo.ts'], ['headed']);
    expect(flagBoolean(args, 'headed')).toBe(true);
    expect(args.positional).toEqual(['demo/tour.demo.ts']);
  });

  it('treats any --no-something as boolean without being told', () => {
    const args = parseArgs(['--no-render', 'demo/tour.demo.ts']);
    expect(flagBoolean(args, 'no-render')).toBe(true);
    expect(args.positional).toEqual(['demo/tour.demo.ts']);
  });

  it('keeps positionals in order', () => {
    expect(parseArgs(['a.mp4', 'b.mp4', 'out.mp4']).positional).toEqual(['a.mp4', 'b.mp4', 'out.mp4']);
  });

  it('hands everything after a bare -- straight through', () => {
    expect(parseArgs(['--headed', '--', '--grep', 'smoke']).rest).toEqual(['--grep', 'smoke']);
  });

  it('says which flag was wrong rather than passing NaN along', () => {
    expect(() => flagNumber(parseArgs(['--speed', 'fast']), 'speed')).toThrow(/--speed/);
  });
});

describe('parseDuration', () => {
  it('defaults to seconds', () => {
    expect(parseDuration('15', 'settle')).toBe(15_000);
  });

  it('understands minutes', () => {
    expect(parseDuration('10m', 'timeout')).toBe(600_000);
  });

  it('rejects what it cannot read', () => {
    expect(() => parseDuration('soon', 'timeout')).toThrow(/--timeout/);
  });
});

describe('init', () => {
  let root = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-init-'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes the config, the example scenario and a Playwright config', () => {
    const { written } = init(root);
    expect(written).toContain('demotale.config.ts');
    expect(written).toContain(path.join('demo', 'example.demo.ts'));
    expect(written).toContain('playwright.config.ts');
  });

  it('never overwrites what is already there', () => {
    fs.writeFileSync(path.join(root, 'demotale.config.ts'), 'mine, and hard won');
    const { written, skipped } = init(root);

    expect(skipped).toContain('demotale.config.ts');
    expect(written).not.toContain('demotale.config.ts');
    expect(fs.readFileSync(path.join(root, 'demotale.config.ts'), 'utf8')).toBe('mine, and hard won');
  });

  it('says in .gitignore that a stored session is a credential', () => {
    init(root);
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.auth/');
    expect(gitignore).toContain('credential');
  });

  // Asking git, not reading the file. The first version of this wrote `.auth/    # why`, which
  // reads correctly and matches nothing, because gitignore has no trailing comments. A test that
  // only looked for the text passed the whole time.
  it('writes patterns git actually honours', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    init(root);

    const ignored = (file: string): boolean => {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'x');
      return (
        execFileSync('git', ['check-ignore', '--no-index', file], {
          cwd: root,
          encoding: 'utf8',
        }).trim() !== ''
      );
    };

    expect(ignored('.auth/session.json')).toBe(true);
    expect(ignored('demo/output/tour.mp4')).toBe(true);
    expect(ignored('test-results/thing.png')).toBe(true);
    expect(ignored('playwright-report/index.html')).toBe(true);
  });

  // Anyone who ran the broken version has `.auth/    # ...` in their .gitignore, which matches
  // nothing. init never rewrites what is there, so the repair has to be that a second run adds the
  // working lines beside the dead ones.
  it('repairs a project that ran the version whose patterns did not work', () => {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(
      path.join(root, '.gitignore'),
      '\n# demotale\n.auth/    # a stored browser session is a credential\n',
    );

    init(root);

    fs.mkdirSync(path.join(root, '.auth'), { recursive: true });
    fs.writeFileSync(path.join(root, '.auth/session.json'), 'x');
    const answer = execFileSync('git', ['check-ignore', '--no-index', '.auth/session.json'], {
      cwd: root,
      encoding: 'utf8',
    });

    expect(answer.trim()).not.toBe('');
  });

  it('leaves an existing .gitignore intact and appends to it', () => {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    init(root);
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore.startsWith('node_modules/')).toBe(true);
    expect(gitignore).toContain('.auth/');
  });

  it('adds scripts to package.json without touching the ones already there', () => {
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'app', scripts: { start: 'node server.js', demo: 'my own thing' } }),
    );
    init(root);

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['start']).toBe('node server.js');
    expect(pkg.scripts['demo']).toBe('my own thing');
    expect(pkg.scripts['demo:render']).toBe('demotale render');
  });

  describe('--ci', () => {
    const workflow = path.join('.github', 'workflows', 'demotale.yml');

    it('leaves the workflow alone without the flag', () => {
      init(root);
      expect(fs.existsSync(path.join(root, workflow))).toBe(false);
    });

    it('writes a GitHub Actions workflow that re-records', () => {
      const { written } = init(root, { ci: true });
      expect(written).toContain(workflow);

      const yaml = fs.readFileSync(path.join(root, workflow), 'utf8');
      expect(yaml).toContain('npx demotale record');
      expect(yaml).toContain('playwright install --with-deps chromium');
      expect(yaml).toContain('if-no-files-found: error');
      expect(yaml).toContain('demo/output/*');
      expect(yaml).toContain('sudo apt-get update && sudo apt-get install -y ffmpeg');
    });

    it('never overwrites a workflow that is already there', () => {
      fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(root, workflow), 'mine, and hard won\n');

      const { written, skipped } = init(root, { ci: true });
      expect(skipped).toContain(workflow);
      expect(written).not.toContain(workflow);
      expect(fs.readFileSync(path.join(root, workflow), 'utf8')).toBe('mine, and hard won\n');
    });

    it('does not stack a second copy on a second run', () => {
      init(root, { ci: true });
      const first = fs.readFileSync(path.join(root, workflow), 'utf8');
      const { skipped } = init(root, { ci: true });
      expect(skipped).toContain(workflow);
      expect(fs.readFileSync(path.join(root, workflow), 'utf8')).toBe(first);
    });
  });
});
