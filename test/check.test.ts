import { describe, expect, it } from 'vitest';

import {
  describeLocator,
  formatReport,
  locatorFromMessage,
  locatorWords,
  origins,
  parseAriaSnapshot,
  rank,
  stripAnsi,
  wrongOrigin,
  type Candidate,
  type CheckReport,
} from '../src/check.js';

describe('parseAriaSnapshot', () => {
  it('reads roles and accessible names', () => {
    const candidates = parseAriaSnapshot(
      ['- button "Only priority"', '- textbox "Track a parcel"', '- text: 3 parcels'].join('\n'),
    );
    expect(candidates).toEqual([
      { role: 'button', name: 'Only priority' },
      { role: 'textbox', name: 'Track a parcel' },
      { role: 'text', name: '', text: '3 parcels' },
    ]);
  });

  it('drops structural nodes that say nothing', () => {
    expect(parseAriaSnapshot(['- generic:', '- list:', '- button "Save"'].join('\n'))).toEqual([
      { role: 'button', name: 'Save' },
    ]);
  });

  it('survives an empty snapshot', () => {
    expect(parseAriaSnapshot('')).toEqual([]);
  });
});

describe('describeLocator', () => {
  it('leaves a plain locator as the author wrote it', () => {
    expect(describeLocator("getByRole('button', { name: 'Save' })")).toBe(
      "getByRole('button', { name: 'Save' })",
    );
  });

  it('drops the frame chain, which the report does not need', () => {
    expect(describeLocator("locator('#frame') >> getByTestId('total')")).toBe(
      "getByTestId('total')",
    );
  });
});

describe('stripAnsi and locatorFromMessage', () => {
  const message =
    'Timed out 5000ms waiting for expect(locator).toHaveText(expected)\n\n' +
    '[2mLocator: [22mgetByTestId(\'row-counter\')\n' +
    'Expected string: [32m"2 parcels"[39m\n';

  it('takes the escape codes out, because JSON is not a terminal', () => {
    expect(stripAnsi(message)).not.toMatch(//);
    expect(stripAnsi(message)).toContain('Expected string: "2 parcels"');
  });

  it('finds the locator inside an assertion failure, which has no other structure', () => {
    expect(locatorFromMessage(message)).toBe("getByTestId('row-counter')");
  });

  it('says nothing rather than guessing when there is no locator', () => {
    expect(locatorFromMessage('page.goto: net::ERR_CONNECTION_REFUSED')).toBeUndefined();
  });
});

describe('wrongOrigin', () => {
  const filming = (pages: { url: string; title: string; atStep: number }[]): CheckReport => ({
    title: 'x',
    scenario: 'demo/x.demo.ts',
    ok: true,
    durationMs: 1,
    frameDir: '/tmp',
    baseUrl: 'http://localhost:4173',
    pages,
    steps: [],
  });

  it('says nothing when the page came from the configured address', () => {
    expect(wrongOrigin(filming([{ url: 'http://localhost:4173/x', title: 'a', atStep: 0 }]))).toBeUndefined();
  });

  it('names the page when it came from somewhere else', () => {
    const report = filming([{ url: 'http://localhost:3000/auth/sign-in', title: 'Sign in', atStep: 0 }]);
    expect(wrongOrigin(report)?.title).toBe('Sign in');
  });

  it('says nothing when nothing was filmed at all', () => {
    expect(wrongOrigin(filming([]))).toBeUndefined();
  });
});

describe('origins', () => {
  const at = (...urls: string[]) => urls.map((url) => ({ url, title: 't', atStep: 0 }));

  it('counts an application with routes as one place', () => {
    expect(origins(at('http://localhost:4173/', 'http://localhost:4173/parcels/7'))).toEqual([
      'http://localhost:4173',
    ]);
  });

  it('keeps a different port apart, because that is a different application', () => {
    expect(origins(at('http://localhost:4173/', 'http://localhost:3000/login'))).toHaveLength(2);
  });

  it('counts an address it cannot parse as itself', () => {
    expect(origins(at('about:blank', 'not a url'))).toEqual(['null', 'not a url']);
  });
});

describe('locatorWords', () => {
  it('takes the quoted parts, which is what the author typed', () => {
    expect(locatorWords("getByRole('button', { name: 'Only priority' })")).toEqual([
      'button',
      'only',
      'priority',
    ]);
  });
});

describe('rank', () => {
  const page: Candidate[] = [
    { role: 'link', name: 'Home' },
    { role: 'button', name: 'Track' },
    { role: 'button', name: 'Only priority' },
    { role: 'div', name: '', testId: 'row-count', text: '3 parcels' },
  ];

  it('puts the typo the author made first', () => {
    const [closest] = rank("getByRole('button', { name: 'Only priorty' })", page);
    expect(closest).toEqual({ role: 'button', name: 'Only priority' });
  });

  it('finds a test id by its name', () => {
    const [closest] = rank("getByTestId('row-counter')", page);
    expect(closest?.testId).toBe('row-count');
  });

  it('keeps the page order when nothing is close', () => {
    expect(rank("getByRole('link', { name: 'Nothing alike here' })", page, 2)).toEqual(
      page.slice(0, 2),
    );
  });

  it('answers a missed test id with test ids, even when none of them is close', () => {
    // Otherwise a page full of test ids answers "no candidate has one", which reads as "this page
    // has none" — the opposite of the truth, and measured: it cost a run.
    const [closest] = rank("getByTestId('nothing-alike-here')", page);
    expect(closest?.testId).toBe('row-count');
  });

  it('returns at most the limit', () => {
    expect(rank("getByRole('button')", page, 2)).toHaveLength(2);
  });
});

const report: CheckReport = {
  title: 'The priority filter',
  scenario: 'demo/priority-filter.demo.ts',
  ok: false,
  durationMs: 6_400,
  frameDir: '/tmp/frames',
  pages: [{ url: 'http://localhost:4173/', title: 'Parcel desk', atStep: 0 }],
  baseUrl: 'http://localhost:4173',
  steps: [
    { kind: 'card', text: 'Parcel desk', atMs: 0, frames: [{ file: '01-card.png', of: 'card' }] },
    {
      kind: 'step',
      text: 'The button hides everything else.',
      badge: '1',
      atMs: 900,
      frames: [{ file: '02-caption-1.png', of: 'caption' }],
    },
  ],
  failure: {
    stepIndex: 1,
    message: "getByRole('button', { name: 'Only priorty' }) matched nothing after 4.0s",
    fromAssertion: false,
    probe: {
      locator: "getByRole('button', { name: 'Only priorty' })",
      matched: 0,
      visible: 0,
      waitedMs: 4_000,
      url: 'http://localhost:4173/',
      title: 'Parcel desk',
      candidates: [
        { role: 'button', name: 'Only priority' },
        { role: 'div', name: '', testId: 'row-count', text: '3 parcels' },
      ],
    },
  },
};

describe('formatReport', () => {
  const text = formatReport(report, 'demo/output/check/run').join('\n');

  it('names the step it died on', () => {
    expect(text).toContain('✗');
    expect(text).toContain('The button hides everything else.');
  });

  it('quotes the locator and says what it matched', () => {
    expect(text).toContain("getByRole('button', { name: 'Only priorty' })");
    expect(text).toContain('matched nothing after 4.0s');
  });

  it('says what was there instead, closest first', () => {
    const instead = text.slice(text.indexOf('instead'));
    expect(instead).toContain('button "Only priority"');
    expect(instead.indexOf('Only priority')).toBeLessThan(instead.indexOf('row-count'));
  });

  it('says which page it actually filmed, so a green tick cannot hide the wrong app', () => {
    expect(text).toContain('filmed   http://localhost:4173/ — "Parcel desk" (before step 1)');
  });

  it('points at the frames and admits it is a dry run', () => {
    expect(text).toContain('demo/output/check/run');
    expect(text).toContain('a dry run');
  });

  it('lists the frame files beside their step', () => {
    expect(text).toContain('01-card.png');
    expect(text).toContain('02-caption-1.png');
  });

  it('stays quiet about a second path, which every application with routes has', () => {
    // A warning you get on every run is a warning you learn to ignore. The `filmed` lines already
    // list the addresses.
    const routed = formatReport(
      {
        ...report,
        pages: [
          { url: 'http://localhost:4173/', title: 'Parcel desk', atStep: 0 },
          { url: 'http://localhost:4173/parcels/7', title: 'Parcel 7', atStep: 2 },
        ],
      },
      'x',
    ).join('\n');
    expect(routed).not.toContain('moved');
    expect(routed).toContain('http://localhost:4173/parcels/7');
  });

  it('says so when the frames came from a second origin', () => {
    const hopped = formatReport(
      {
        ...report,
        pages: [
          { url: 'http://localhost:4173/', title: 'Parcel desk', atStep: 0 },
          { url: 'https://login.example.com/', title: 'Sign in', atStep: 2 },
        ],
      },
      'x',
    ).join('\n');
    expect(hopped).toContain('moved');
  });

  it('says so plainly when nothing failed', () => {
    const ok = formatReport({ ...report, ok: true, failure: undefined as never }, 'x').join('\n');
    expect(ok).toContain('ok in 6.4s');
    expect(ok).not.toContain('instead');
  });
});
