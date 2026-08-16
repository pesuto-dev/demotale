import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readingTimeMs, slugify } from '../src/demo.js';
import { findRecordings, uniqueNames, type Recording } from '../src/render.js';

describe('slugify', () => {
  it('turns a test title into a file name', () => {
    expect(slugify('From a ticket to a run')).toBe('from-a-ticket-to-a-run');
  });

  it('strips accents rather than dropping the letters', () => {
    expect(slugify('Één opname')).toBe('een-opname');
  });

  it('leaves no leading or trailing dashes', () => {
    expect(slugify('  ...Hello!  ')).toBe('hello');
  });
});

describe('readingTimeMs', () => {
  it('never flashes a short line past the viewer', () => {
    expect(readingTimeMs('Done.')).toBe(1_900);
  });

  it('caps a long line, because a subtitle is not a paragraph', () => {
    expect(readingTimeMs('x'.repeat(500))).toBe(9_000);
  });

  it('scales with the length in between', () => {
    expect(readingTimeMs('x'.repeat(60))).toBe(4_000);
  });
});

describe('uniqueNames', () => {
  const named = (...names: string[]): Recording[] =>
    names.map((name) => ({ webm: `${name}.webm`, name, meta: undefined, modifiedAt: 0 }));

  it('leaves distinct names alone', () => {
    expect(uniqueNames(named('a-tour', 'a-signup'))).toEqual(['a-tour', 'a-signup']);
  });

  it('suffixes a repeat instead of overwriting the first one', () => {
    expect(uniqueNames(named('a-tour', 'a-tour', 'a-tour'))).toEqual([
      'a-tour',
      'a-tour-2',
      'a-tour-3',
    ]);
  });

  it('does not collide with a name that already ends in that suffix', () => {
    expect(uniqueNames(named('a-tour', 'a-tour-2', 'a-tour'))).toEqual([
      'a-tour',
      'a-tour-2',
      'a-tour-3',
    ]);
  });
});

describe('findRecordings', () => {
  let raw = '';

  beforeEach(() => {
    raw = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-test-'));
  });

  afterEach(() => {
    fs.rmSync(raw, { recursive: true, force: true });
  });

  function recording(dir: string, meta?: { name: string }): void {
    const full = path.join(raw, dir);
    fs.mkdirSync(full, { recursive: true });
    fs.writeFileSync(path.join(full, 'video.webm'), 'not really a video');
    if (meta) fs.writeFileSync(path.join(full, 'demo-meta.json'), JSON.stringify(meta));
  }

  it('finds nothing in a directory that does not exist', () => {
    expect(findRecordings(path.join(raw, 'nope'))).toEqual([]);
  });

  it('takes the file name from the sidecar the fixture left behind', () => {
    recording('some-playwright-invented-name-record', { name: 'a-tour-of-the-desk' });
    expect(findRecordings(raw).map((r) => r.name)).toEqual(['a-tour-of-the-desk']);
  });

  it('falls back to the directory name when the sidecar is missing', () => {
    recording('scenario-record');
    expect(findRecordings(raw)[0]?.name).toBe('scenario-record');
  });

  it('ignores a directory without a webm in it', () => {
    fs.mkdirSync(path.join(raw, 'empty'));
    expect(findRecordings(raw)).toEqual([]);
  });
});
