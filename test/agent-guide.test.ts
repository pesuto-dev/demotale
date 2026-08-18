import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentGuide, agentsBlock, AGENTS_MARKER } from '../src/agent-guide.js';
import { init } from '../src/cli/init.js';

describe('agentsBlock', () => {
  const block = agentsBlock();

  it('is short, because context costs something on every task', () => {
    expect(block.split('\n').filter((line) => line.trim() !== '').length).toBeLessThanOrEqual(8);
  });

  it('points at the command rather than repeating it', () => {
    expect(block).toContain('demotale agent-guide');
    expect(block).toContain(AGENTS_MARKER);
  });
});

describe('agentGuide', () => {
  const guide = agentGuide();

  // Each of these is a mistake an agent actually made, in a trial with no instructions. The test
  // exists so a future edit of the page cannot quietly drop one of them.
  it.each([
    ['fixing the placeholder config', 'npm start'],
    ['who can tell whether it is your app', 'cannot know is whether the program'],
    ['redaction', 'redact'],
    ['one page load', "page.goto('/')"],
    ['a step is one sentence', 'A step is one sentence'],
    ['asserting before pointing', 'Assert before you point'],
    ['assertions that fail on the wrong page', 'toHaveTitle(/./)'],
    ['spotlighting the container', 'point at the container'],
    ['deleting the generated example', 'demo/example.demo.ts'],
    ['seeding out of the recording', 'prepare.ts'],
    ['saying what is not real', 'demo.note'],
    ['checking before recording', 'demotale check'],
    ['opening the frames', 'open the frames'],
    ['the json envelope', 'problems'],
    ['not installing things unasked', 'only if the person asked'],
    ['login being a human job', 'demotale auth'],
    ['reading the diff instead of clicking around', 'git diff'],
    // Added after the first trial on a framework application: two arms, no test id anywhere in it.
    ['locating by role rather than by CSS class', "getByRole('button', { name: 'Filter' })"],
    ['filtering a container by a child role', "has: page.getByRole('heading'"],
    ['visible text living in a translation file', 'translation file'],
    ['not editing the application to get data in', 'never by editing it'],
    ['redacting an internal string you cannot ask about', 'Redaction is reversible'],
    ['the last frame of a step waiting for the step', 'the step has finished'],
    ['recording taking as long as the video', 'plays in real time'],
    // From the framework trial: an arm asserted on a heading that renders before the data behind it
    // arrives, so its frame proved a loading spinner and it went looking for a locator bug it did
    // not have. Twice measured now.
    ['asserting on the end state rather than the first thing to render', 'Assert the end state'],
  ])('says something about %s', (_what, needle) => {
    expect(guide).toContain(needle);
  });

  it('stays a page rather than a manual', () => {
    expect(guide.split('\n').length).toBeLessThan(110);
  });
});

describe('init agent block', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-agents-'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes AGENTS.md by default', () => {
    init(root);
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toContain('demotale agent-guide');
  });

  it('says what the new AGENTS.md is for, without a mutation notice', () => {
    init(root);
    const out = vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0])).join('');
    expect(out).toContain('run `demotale agent-guide` instead of inventing a scenario');
    expect(out).not.toContain('Appended five lines to AGENTS.md');
  });

  it('appends to an AGENTS.md that already says things', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# House rules\n\nUse tabs.\n');
    init(root);

    const written = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(written).toContain('Use tabs.');
    expect(written).toContain('demotale agent-guide');
  });

  it('says so in one sentence when it appends to an existing AGENTS.md', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# House rules\n\nUse tabs.\n');
    init(root);
    const out = vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0])).join('');
    expect(out).toContain(
      'Appended five lines to AGENTS.md so an agent runs `demotale agent-guide` instead of inventing a scenario.',
    );
  });

  it('does not stack the block up on a second run', () => {
    init(root);
    vi.mocked(process.stdout.write).mockClear();
    init(root);

    const written = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(written.split(AGENTS_MARKER)).toHaveLength(2);
    const out = vi.mocked(process.stdout.write).mock.calls.map((call) => String(call[0])).join('');
    expect(out).not.toContain('Appended five lines to AGENTS.md');
  });

  it('skips AGENTS.md when asked', () => {
    init(root, { agent: false });
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);
  });
});
