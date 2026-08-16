import { describe, expect, it } from 'vitest';

import { toTranscript, toVtt, type DemoMeta } from '../src/captions.js';

const meta: DemoMeta = {
  name: 'a-tour',
  title: 'A tour',
  recordedAt: '2026-08-09T15:04:05.000Z',
  durationMs: 32_000,
  entries: [
    { at: 200, kind: 'card', text: 'A tour', subtitle: 'of the desk' },
    { at: 3_000, kind: 'note', text: 'Made-up data' },
    { at: 3_200, kind: 'say', text: 'Nobody recorded this.' },
    { at: 9_000, kind: 'chapter', text: 'What is waiting' },
    { at: 9_100, kind: 'step', text: 'The desk opens on what is waiting.', badge: '1' },
    { at: 20_000, kind: 'wait', text: 'Asking the carrier', durationMs: 4_400 },
    { at: 25_000, kind: 'step', text: 'And the answer comes back.', badge: '2' },
  ],
};

describe('toVtt', () => {
  const vtt = toVtt(meta);

  it('starts the way a WebVTT file has to', () => {
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
  });

  it('runs each cue up to the next one, so the file matches the screen', () => {
    expect(vtt).toContain('00:00:03.200 --> 00:00:09.100');
  });

  it('gives the last cue an end, rather than leaving it open', () => {
    expect(vtt).toContain('00:00:25.000 --> 00:00:32.000');
  });

  it('keeps chapters as comments, since they were never on screen', () => {
    expect(vtt).toContain('NOTE Chapter: What is waiting');
  });

  it('leaves a corner note out of the subtitles', () => {
    expect(vtt).not.toContain('Made-up data');
  });

  it('folds a title card into one readable line', () => {
    expect(vtt).toContain('A tour — of the desk');
  });
});

describe('toTranscript', () => {
  const markdown = toTranscript(meta);

  it('opens with the scenario title', () => {
    expect(markdown.startsWith('# A tour\n')).toBe(true);
  });

  it('makes chapters into headings, which is how somebody finds one part of a long recording', () => {
    expect(markdown).toContain('## What is waiting');
  });

  it('says how long a named wait actually took', () => {
    expect(markdown).toContain('Asking the carrier _(waited 4s)_');
  });

  it('keeps a blank line around a block, so the next list item is not folded into it', () => {
    expect(markdown).toContain('\n> Made-up data\n\n');
  });

  it('says it is generated, so nobody edits it by hand', () => {
    expect(markdown).toContain('Written by demotale');
  });
});

describe('an empty recording', () => {
  it('produces a valid, empty vtt rather than something a player rejects', () => {
    const empty = toVtt({ ...meta, entries: [] });
    expect(empty.startsWith('WEBVTT\n')).toBe(true);
    expect(empty).not.toContain('-->');
  });
});
