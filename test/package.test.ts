import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * There is nothing to test yet, so this guards the thing that is easy to get wrong and hard to
 * notice: what actually ends up in the published tarball, and whether the entry points it advertises
 * are the ones the build produces.
 */

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  type: string;
  bin: Record<string, string>;
  main: string;
  types: string;
  exports: Record<string, unknown>;
  files: string[];
  engines: { node: string };
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

describe('package shape', () => {
  it('is an ES module', () => {
    expect(pkg.type).toBe('module');
  });

  it('ships the built output, templates, postinstall and notices', () => {
    expect(pkg.files).toContain('dist');
    expect(pkg.files).toContain('templates');
    expect(pkg.files).toContain('scripts/postinstall.mjs');
    expect(pkg.files).toContain('NOTICE');
    expect(pkg.files).not.toContain('.plan');
    expect(pkg.files).not.toContain('src');
  });

  it('points every entry point at dist', () => {
    const entries = [pkg.main, pkg.types, ...Object.values(pkg.bin)];
    for (const entry of entries) expect(entry).toMatch(/^(\.\/)?dist\//);
  });

  it('ships Playwright and ffmpeg-static as dependencies, not peers', () => {
    expect(pkg.dependencies?.['@playwright/test']).toBeTruthy();
    expect(pkg.dependencies?.['ffmpeg-static']).toBeTruthy();
    expect(pkg.peerDependencies?.['@playwright/test']).toBeUndefined();
    expect(pkg.scripts?.postinstall).toContain('postinstall.mjs');
  });

  it('requires the Node version the package actually needs', () => {
    // 22.12 is not a preference. Below it Node cannot strip types from a demotale.config.ts, and a
    // CommonJS project cannot require this ESM-only package at all.
    expect(pkg.engines.node).toBe('>=22.12');
  });

  it('is reachable from a CommonJS project, which is how Playwright loads a config', () => {
    const entry = pkg.exports['.'] as Record<string, string>;
    expect(entry['require']).toBe(entry['import']);
  });
});

describe('working documents', () => {
  it('keeps the Dutch plan out of git', () => {
    const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(gitignore).toMatch(/^\.plan\/$/m);
  });

  it('has a CLAUDE.md that points at it', () => {
    const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
    expect(claude).toContain('.plan/KOERS.md');
    expect(claude).toContain('.plan/achtergrond/PLAN.md');
  });
});
