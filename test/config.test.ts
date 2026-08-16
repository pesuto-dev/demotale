import { describe, expect, it } from 'vitest';

import { defineConfig, DemotaleConfigError, resolveConfig } from '../src/config.js';

/**
 * The point of these is the wording. A recording provisions an application and runs for minutes, so
 * a wrong key has to produce a sentence naming the key before the browser opens.
 */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the config to be rejected, but it was accepted');
}

describe('defineConfig', () => {
  it('accepts an empty config', () => {
    expect(() => defineConfig({})).not.toThrow();
  });

  it('hands the config back unchanged', () => {
    const config = { baseUrl: 'http://localhost:4200' };
    expect(defineConfig(config)).toBe(config);
  });

  it('names the misspelled key and the one that was meant', () => {
    const message = messageOf(() => defineConfig({ baseURL: 'http://x' } as never));
    expect(message).toContain('"baseURL"');
    expect(message).toContain('"baseUrl"');
  });

  it('lists the known keys when a key is unrecognisable', () => {
    const message = messageOf(() => defineConfig({ colours: 'blue' } as never));
    expect(message).toContain('"colours"');
    expect(message).toContain('baseUrl');
  });

  it('rejects a baseUrl that is not a URL', () => {
    expect(messageOf(() => defineConfig({ baseUrl: 'localhost:3000' }))).toContain('"baseUrl"');
  });

  it('rejects a speed of zero, which would make every pause vanish', () => {
    expect(messageOf(() => defineConfig({ speed: 0 }))).toContain('"speed"');
  });

  it('allows a slowMo of zero, which only means no extra delay', () => {
    expect(() => defineConfig({ slowMo: 0 })).not.toThrow();
  });

  it('rejects a crf outside what x264 understands', () => {
    expect(messageOf(() => defineConfig({ video: { crf: 60 } }))).toContain('"video.crf"');
  });

  it('rejects a video format it cannot produce, and says what it can', () => {
    const message = messageOf(() => defineConfig({ video: { formats: ['mov' as never] } }));
    expect(message).toContain('mp4');
    expect(message).toContain('gif');
  });

  it('throws a DemotaleConfigError, so a CLI can tell it apart from a crash', () => {
    expect(() => defineConfig({ speed: -1 })).toThrow(DemotaleConfigError);
  });
});

describe('resolveConfig', () => {
  it('fills in every default', () => {
    const config = resolveConfig();
    expect(config.baseUrl).toBe('http://localhost:3000');
    expect(config.speed).toBe(1);
    expect(config.video.formats).toEqual(['mp4']);
    expect(config.redact).toEqual([]);
    expect(config.theme.captionPosition).toBe('top');
  });

  it('merges partial objects instead of replacing them', () => {
    const config = resolveConfig({ video: { crf: 18 }, viewport: { width: 1920, height: 1080 } });
    expect(config.video).toEqual({ fps: 30, crf: 18, formats: ['mp4'], gifWidth: 960, gifFps: 15 });
    expect(config.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it('takes a theme by name', () => {
    expect(resolveConfig({ theme: 'light' }).theme.text).toBe('#0f172a');
  });

  it('takes overrides on top of a named theme', () => {
    const { theme } = resolveConfig({ theme: { base: 'light', accent: '#ff0000' } });
    expect(theme.accent).toBe('#ff0000');
    expect(theme.cardSurface).toBe('#ffffff');
  });

  it('validates before it resolves', () => {
    expect(() => resolveConfig({ speed: -2 })).toThrow(DemotaleConfigError);
  });
});
