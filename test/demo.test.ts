import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveConfig } from '../src/config.js';
import { Demo } from '../src/demo.js';

/**
 * A page that does nothing but write down the order it was asked to do it in.
 *
 * Enough for the dry run: it takes screenshots, reads the address and waits, and none of that needs
 * a browser to be ordered correctly.
 */
function fakePage(events: string[]): Page {
  const page = {
    addInitScript: async () => {},
    evaluate: async (fn: (...args: never[]) => unknown) => {
      const text = String(fn);
      if (text.includes('stillClean') && text.length < 200) {
        events.push(text.includes('stillClean(true)') ? 'eval stillClean on' : 'eval stillClean off');
      }
      return undefined;
    },
    waitForTimeout: async () => {},
    title: async () => 'Parcel desk',
    url: () => 'http://localhost:4173/parcels',
    on: () => {},
    mouse: { move: async () => {} },
    screenshot: async (opts: { path: string }) => {
      events.push(`frame ${path.basename(opts.path)}`);
    },
  };
  return page as unknown as Page;
}

function fakeLocator(events: string[], name: string): Locator {
  const locator = {
    waitFor: async () => {},
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => null,
    click: async () => {
      events.push(`click ${name}`);
    },
  };
  return locator as unknown as Locator;
}

describe('the frame that ends a step', () => {
  let frameDir = '';
  let events: string[] = [];
  let demo: Demo;

  beforeEach(() => {
    frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-frames-'));
    events = [];
    demo = new Demo(fakePage(events), resolveConfig(), { mode: 'check', frameDir });
  });

  afterEach(() => {
    fs.rmSync(frameDir, { recursive: true, force: true });
  });

  const frames = (): string[] => events.filter((event) => event.startsWith('frame'));

  it('is taken after the body, not beside the click', async () => {
    // The whole point. An application that answers a click asynchronously is still loading when the
    // click returns, so a frame there shows a spinner under a subtitle promising the result.
    await demo.step('The table now shows only priority parcels.', async () => {
      await demo.click(fakeLocator(events, 'filter'));
      events.push('waited for the table');
    });

    expect(events).toEqual([
      'frame 01-caption-1.png',
      'click filter',
      'waited for the table',
      'frame 02-result-1.png',
    ]);
  });

  it('costs a step no more frames than it used to', async () => {
    await demo.step('Open the parcel.', async () => {
      await demo.click(fakeLocator(events, 'row'));
    });

    expect(frames()).toEqual(['frame 01-caption-1.png', 'frame 02-result-1.png']);
    expect(demo.checkReport('t', 's').steps[0]?.frames).toEqual([
      { file: '01-caption-1.png', of: 'caption' },
      { file: '02-result-1.png', of: 'result' },
    ]);
  });

  it('is one frame however often the body clicks', async () => {
    await demo.step('Filter, then sort.', async () => {
      await demo.click(fakeLocator(events, 'filter'));
      await demo.click(fakeLocator(events, 'sort'));
    });

    expect(frames()).toEqual(['frame 01-caption-1.png', 'frame 02-result-1.png']);
  });

  it('is not taken at all by a step that only reads the page', async () => {
    await demo.step('Three parcels are waiting.', async () => {
      // An assertion by the author, which changes nothing and therefore proves nothing new.
    });

    expect(frames()).toEqual(['frame 01-caption-1.png']);
  });

  it('still comes with the click when there is no step to close', async () => {
    await demo.click(fakeLocator(events, 'cookie banner'));

    expect(events).toEqual(['click cookie banner', 'frame 01-result.png']);
  });

  it('keeps the step number when say() runs inside the step', async () => {
    await demo.step('An analyst submits a new plan.', async () => {
      await demo.say('The plan is now in Ready.');
    });

    const steps = demo.checkReport('t', 's').steps;
    expect(steps[1]).toMatchObject({ kind: 'say', badge: '1', text: 'The plan is now in Ready.' });
  });

  it('leaves say() unnumbered outside a step', async () => {
    await demo.say('Someone picks the order.');
    expect(demo.checkReport('t', 's').steps[0]?.badge).toBeUndefined();
  });

  it('drops the number when say() is asked to', async () => {
    await demo.step('An analyst submits a new plan.', async () => {
      await demo.say('The plan is now in Ready.', { badge: '' });
    });

    expect(demo.checkReport('t', 's').steps[1]?.badge).toBeUndefined();
  });

  it('records how many lines the caption painted', async () => {
    const page = fakePage(events);
    page.evaluate = (async (fn: (...args: never[]) => unknown) => {
      if (String(fn).includes('demo-text')) return 2.04;
      return undefined;
    }) as Page['evaluate'];
    const measuring = new Demo(page, resolveConfig(), { mode: 'check', frameDir });

    await measuring.step('A long line.', async () => {});

    expect(measuring.checkReport('t', 's').steps[0]?.captionLines).toBe(2);
  });

  it('leaves the next step to take its own', async () => {
    await demo.step('Filter.', async () => {
      await demo.click(fakeLocator(events, 'filter'));
    });
    await demo.step('Sort.', async () => {
      await demo.click(fakeLocator(events, 'sort'));
    });

    const report = demo.checkReport('t', 's');
    expect(report.steps.map((step) => step.frames.map((frame) => frame.of))).toEqual([
      ['caption', 'result'],
      ['caption', 'result'],
    ]);
  });
});

describe('demo.still', () => {
  let frameDir = '';
  let events: string[] = [];

  beforeEach(() => {
    frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demotale-stills-'));
    events = [];
  });

  afterEach(() => {
    fs.rmSync(frameDir, { recursive: true, force: true });
  });

  it('writes a picture in images mode, after hiding the overlay', async () => {
    const demo = new Demo(fakePage(events), resolveConfig(), { mode: 'images', frameDir });
    await demo.still('order-open');
    expect(events.filter((event) => event.startsWith('eval') || event.startsWith('frame'))).toEqual([
      'eval stillClean on',
      'frame 01-order-open.png',
      'eval stillClean off',
    ]);
    expect(demo.stillsReport('t', 's').stills).toEqual([
      { name: 'order-open', file: '01-order-open.png' },
    ]);
  });

  it('is a no-op while recording, so the same scenario can film and illustrate', async () => {
    const demo = new Demo(fakePage(events), resolveConfig(), { mode: 'record', frameDir });
    await demo.still('order-open');
    expect(events.filter((event) => event.startsWith('frame'))).toEqual([]);
    expect(demo.stillsReport('t', 's').stills).toEqual([]);
  });

  it('rejects a name that cannot become a file name', async () => {
    const demo = new Demo(fakePage(events), resolveConfig(), { mode: 'images', frameDir });
    await expect(demo.still('???')).rejects.toThrow(/file name/);
  });
});
