/**
 * The dry run: what `demotale check` collects, and how it reads.
 *
 * The recorder answers one question, "is there a video", and answers it in a minute. Writing a
 * scenario asks a different question twenty times in a row: does this locator hit the thing I mean,
 * and does the subtitle sit on top of it. That question deserves seconds, not a minute, and a page
 * of screenshots rather than a video nobody can grep.
 *
 * A missing locator is the common case, so it gets the long answer: not only "matched nothing" but
 * what was on the page instead, ranked by how close it is to what the scenario asked for. That is
 * the difference between an author opening a browser and an author fixing one line.
 *
 * Nothing in this file touches a page or the filesystem, so all of it is testable without a browser.
 */
import type { TimelineKind } from './captions.js';

/** One thing that was on the page when a locator found nothing. */
export interface Candidate {
  /** ARIA role, as the accessibility tree reports it. */
  role: string;
  /** Accessible name, empty when the element has none. */
  name: string;
  /** `data-testid`, when the element carries one. */
  testId?: string;
  /** Visible text, trimmed, when it says more than the name does. */
  text?: string;
}

/** What was true of the page at the moment a locator failed. */
export interface LocatorProbe {
  /** The locator as the scenario wrote it, e.g. `getByRole('button', { name: 'Save' })`. */
  locator: string;
  /** How many elements it matched at all. Zero and "three, all hidden" are different bugs. */
  matched: number;
  /** How many of those were visible. */
  visible: number;
  /** How long the check waited before giving up. */
  waitedMs: number;
  url: string;
  title: string;
  /** What was there instead, closest first. */
  candidates: Candidate[];
  /** Set when the element did turn up, late. Then it is a warning, not a failure. */
  appearedAfterMs?: number;
}

export interface CheckFrame {
  /** File name inside the frame directory. */
  file: string;
  /**
   * What the frame is of: the subtitle going up, a spotlight being drawn, a title card, or the page
   * as the step leaves it. The last one exists because the others all show the page as it was
   * before the action, which for a step about a click is the state that proves nothing. It is taken
   * when the step ends rather than when the click lands, because a click landing says nothing about
   * whether the application has answered yet.
   */
  of: 'caption' | 'spotlight' | 'card' | 'result';
}

export interface CheckStep {
  kind: TimelineKind;
  text: string;
  /** The step number, for a numbered step. */
  badge?: string;
  /** Milliseconds since the scenario started. A dry run's clock, not the recording's. */
  atMs: number;
  frames: CheckFrame[];
  /** A locator that was slow but did turn up. The recording would have caught it. */
  warning?: LocatorProbe;
}

/**
 * Playwright colours its errors, and those escape codes end up inside `message`.
 *
 * A terminal renders them; a reader parsing JSON has to strip them before it can even see the text.
 * Doing it here means terminal prose never gets smuggled through a machine channel.
 */
export function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * The locator out of an assertion's message.
 *
 * An `expect()` written by the scenario author never passes through this package, so all that is
 * left of it is Playwright's own sentence. Pulling the locator out of that sentence once, here, is
 * uglier than having it structurally but better than every reader writing the same regex.
 */
export function locatorFromMessage(message: string): string | undefined {
  const match = /^\s*Locator:\s*(.+)$/m.exec(stripAnsi(message));
  return match?.[1]?.trim();
}

export interface CheckFailure {
  /**
   * Index into `steps` of the step it died on. An index rather than the step itself: the report
   * travels through JSON on its way to the CLI, and a copy is never the same object twice.
   */
  stepIndex?: number;
  /** Set when a locator was the cause, which is the case worth reporting well. */
  probe?: LocatorProbe;
  /** Playwright's own message, for everything else: an assertion, a navigation, a crash. */
  message: string;
  /** True when the failure came from the scenario's own `expect`, not from the demo API. */
  fromAssertion: boolean;
  /**
   * The locator, also for an assertion failure, where it is the only structure there is.
   *
   * A reader should find the same key whatever kind of failure it is looking at; a schema that
   * changes shape per failure kind is a schema every consumer has to branch on.
   */
  locator?: string;
}

/** A page the dry run had in front of it while it was taking frames. */
export interface PageSeen {
  url: string;
  title: string;
  /**
   * How many steps had started when this address first appeared.
   *
   * Zero means it was already there before the first step, so a second entry at zero is the browser
   * moving on its own: a redirect, most often to a login. Whether that is wrong is not something
   * this package can know — an application may legitimately be filmed at its sign-in screen — so it
   * is reported as the fact it is rather than as a verdict.
   */
  atStep: number;
}

export interface CheckReport {
  /** The scenario title, as written in the test. */
  title: string;
  /** Scenario file, relative to the project root. */
  scenario: string;
  ok: boolean;
  /** How long the dry run took. Not what the recording will take. */
  durationMs: number;
  /** Absolute path of the directory the frames were written to. */
  frameDir: string;
  /**
   * Every page that was actually filmed, in order.
   *
   * A dry run cannot know which application you meant, and a scenario whose only assertion is
   * "the title is not empty" passes against anybody's login screen. Measured, not imagined: a check
   * once came back green having filmed an unrelated dev server that happened to hold the default
   * port. Printing the address and the title turns that from a green tick into an obvious mistake.
   */
  pages: PageSeen[];
  /** The address the run was pointed at, so `pages` can be judged against something. */
  baseUrl: string;
  steps: CheckStep[];
  failure?: CheckFailure;
}

/**
 * Paths that mean "you are not signed in".
 *
 * A guess, and named as one wherever it is used. It exists because the alternative — reporting a
 * locator that missed and saying nothing about the sign-in form it missed on — sends the reader
 * looking for a typo in a scenario that is fine.
 */
const LOGIN_PATH = /\b(login|log-in|signin|sign-in|auth|oauth2?|saml)\b/i;

export function looksLikeLogin(url: string): boolean {
  return LOGIN_PATH.test(url);
}

/**
 * Whether the first thing filmed came from somewhere other than the address that was configured.
 *
 * Both ways this happens end the same: you are looking at a recording of the wrong thing. Either the
 * port holds a different application, or the application bounced the browser to a login. The data to
 * notice it was already in the report; a reader should not have to compare two URLs by eye.
 */
export function wrongOrigin(report: CheckReport): PageSeen | undefined {
  const first = report.pages[0];
  if (first === undefined) return undefined;
  try {
    const wanted = new URL(report.baseUrl).origin;
    return new URL(first.url).origin === wanted ? undefined : first;
  } catch {
    return undefined;
  }
}

/**
 * The distinct origins the frames came from, in the order they were filmed.
 *
 * An address that will not parse counts as itself, because two of them are still two places.
 */
export function origins(pages: readonly PageSeen[]): string[] {
  const seen: string[] = [];
  for (const page of pages) {
    let origin: string;
    try {
      origin = new URL(page.url).origin;
    } catch {
      origin = page.url;
    }
    if (!seen.includes(origin)) seen.push(origin);
  }
  return seen;
}

/**
 * A locator as the author wrote it.
 *
 * Playwright's own `toString` is already the source form — `getByRole('button', { name: 'Save' })` —
 * which is the string the author has to go and edit. All this does is drop the frame chain in front
 * of it, which is noise in a report that already says which step it was.
 */
export function describeLocator(source: string): string {
  return source.replace(/^.*?>>\s*/, '').trim();
}

/** Words in a locator worth matching on: `getByRole('button', { name: 'Only priority' })`. */
export function locatorWords(locator: string): string[] {
  const quoted = [...locator.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? '');
  return words(quoted.join(' '));
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word.length > 1);
}

/**
 * How close a candidate is to what the scenario asked for.
 *
 * Deliberately crude: shared words, with a bonus for one string containing the other, because the
 * mistakes this has to catch are a typo, a renamed label and a test id that moved. Anything cleverer
 * would be guessing about a page it cannot see.
 */
export function score(wanted: string[], candidate: Candidate): number {
  if (wanted.length === 0) return 0;
  const haystack = words(`${candidate.name} ${candidate.testId ?? ''} ${candidate.text ?? ''}`);
  if (haystack.length === 0) return 0;

  const shared = wanted.filter((word) => haystack.includes(word)).length;
  const joinedWant = wanted.join(' ');
  const joinedHave = haystack.join(' ');
  const contains = joinedHave.includes(joinedWant) || joinedWant.includes(joinedHave) ? 1 : 0;

  // A near miss on a long name should still beat a one-word coincidence.
  return shared / wanted.length + contains * 0.5 + (shared > 0 ? 0.01 * shared : 0);
}

/**
 * The candidates worth printing, closest first. Ties keep the page's own order.
 *
 * A `getByTestId` that missed is answered with test ids. Measured: without this, a run whose locator
 * was one character off `priority-count` got six candidates back and not one of them carried a test
 * id, because named roles outscored an unnamed div. The absence then reads as "this page has no test
 * ids", which is the opposite of the truth.
 */
export function rank(locator: string, candidates: Candidate[], limit = 6): Candidate[] {
  const wanted = locatorWords(locator);
  const byTestId = /getByTestId\(/.test(locator);

  const scored = candidates.map((candidate, index) => ({
    candidate,
    index,
    score: score(wanted, candidate),
    // Not a score bump: a separate key, so a test id can never be edged out by a well-named button.
    preferred: byTestId && candidate.testId !== undefined,
  }));

  scored.sort(
    (a, b) =>
      Number(b.preferred) - Number(a.preferred) || b.score - a.score || a.index - b.index,
  );
  return scored.slice(0, limit).map((entry) => entry.candidate);
}

/**
 * Playwright's `ariaSnapshot()` as candidates.
 *
 * The snapshot is YAML shaped like `- button "Only priority": Only priority`, one line per node of
 * the accessibility tree. That is exactly the vocabulary `getByRole` uses, which is why this is the
 * right thing to show somebody whose `getByRole` just missed.
 */
export function parseAriaSnapshot(snapshot: string, limit = 80): Candidate[] {
  const candidates: Candidate[] = [];
  for (const line of snapshot.split('\n')) {
    const match = /^\s*-\s+([a-zA-Z]+)(?:\s+"([^"]*)")?\s*(?::\s*(.*))?$/.exec(line);
    if (match === null) continue;

    const role = match[1] ?? '';
    const name = match[2] ?? '';
    const trailing = (match[3] ?? '').trim();
    // Structural nodes with no name say nothing useful about why a locator missed.
    if (name === '' && trailing === '') continue;

    const candidate: Candidate = { role, name };
    if (trailing !== '' && trailing !== name) candidate.text = trailing.slice(0, 60);
    candidates.push(candidate);
    if (candidates.length >= limit) break;
  }
  return candidates;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function describe(candidate: Candidate): string {
  const parts = [candidate.role];
  if (candidate.name !== '') parts.push(`"${candidate.name}"`);
  if (candidate.testId !== undefined) parts.push(`data-testid="${candidate.testId}"`);
  if (candidate.text !== undefined && candidate.text !== candidate.name) {
    parts.push(`— ${candidate.text}`);
  }
  return parts.join(' ');
}

function label(step: CheckStep): string {
  if (step.badge !== undefined) return step.badge.padStart(2);
  return step.kind === 'step' ? ' ·' : ' ·';
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

/**
 * The report as a person reads it. One line per step, and the failure spelled out underneath: which
 * step, which locator, what the page held instead. An agent reads the same thing from `check.json`.
 */
export function formatReport(report: CheckReport, frameDir: string): string[] {
  const lines: string[] = [];
  const status = report.ok ? 'ok' : 'FAILED';

  lines.push(`${report.scenario} — ${report.title} — ${status} in ${seconds(report.durationMs)}`);
  for (const page of report.pages) {
    const when = page.atStep === 0 ? 'before step 1' : `from step ${String(page.atStep)}`;
    lines.push(`  filmed   ${page.url} — "${page.title}" (${when})`);
  }

  // More than one origin means the frames are not all of the same application, which the `filmed`
  // lines above show but nobody compares by eye. Paths deliberately do not count: measured on an
  // application with routes, where every demo that clicks anything films a second path, so the
  // signal fired on every run. A warning you always get teaches you to ignore warnings. A first
  // page from the wrong origin is `WRONG` below; this catches the hop that happens later.
  if (origins(report.pages).length > 1) {
    lines.push(
      '  moved    frames came from more than one origin. Check that each is the one you meant.',
    );
  }

  const elsewhere = wrongOrigin(report);
  if (elsewhere) {
    lines.push(
      `  WRONG    that is not ${report.baseUrl}. Either the port holds a different application, ` +
        'or yours sent the browser to a login.',
    );
  }
  lines.push('');

  // Where it died. A failure with no step of its own belongs to the last one that started, which is
  // what an author reading the report assumes anyway.
  const failedAt =
    report.failure === undefined
      ? -1
      : (report.failure.stepIndex ?? report.steps.length - 1);

  for (const [index, step] of report.steps.entries()) {
    const frames = step.frames.map((frame) => frame.file).join(' ');
    const mark = index === failedAt ? '✗' : step.warning ? '!' : ' ';
    lines.push(
      `  ${mark} ${label(step)}  ${truncate(step.text, 58).padEnd(58)}  ${frames}`.trimEnd(),
    );
    if (step.warning) {
      lines.push(
        `        slow: ${step.warning.locator} appeared after ` +
          `${seconds(step.warning.appearedAfterMs ?? 0)}`,
      );
    }
  }

  if (report.failure) {
    const { probe, message, fromAssertion } = report.failure;
    lines.push('');
    if (probe) {
      const what =
        probe.matched === 0
          ? `matched nothing after ${seconds(probe.waitedMs)}`
          : `matched ${probe.matched}, none visible, after ${seconds(probe.waitedMs)}`;
      lines.push(`  locator  ${probe.locator} ${what}`);
      lines.push(`  page     ${probe.url} — "${probe.title}"`);
      if (probe.candidates.length > 0) {
        lines.push(`  instead  ${describe(probe.candidates[0] as Candidate)}`);
        for (const candidate of probe.candidates.slice(1)) {
          lines.push(`           ${describe(candidate)}`);
        }
      } else {
        lines.push('  instead  nothing on this page carries a role, a name or a test id');
      }
    } else {
      lines.push(fromAssertion ? '  an assertion in the scenario failed:' : '  the run stopped:');
      for (const line of message.split('\n').slice(0, 12)) lines.push(`  ${line}`);
    }
  }

  lines.push('');
  lines.push(`  frames   ${frameDir}`);
  lines.push('  note     a dry run: no video, no reading pauses, so these timings are not the demo.');
  return lines;
}
