/**
 * The scenario API, and the Playwright fixture that hands it to a test.
 *
 * A scenario is a Playwright test that happens to be watchable. Everything here exists to make the
 * recording look like a person using the application: text that appears before the action rather
 * than after it, a pointer that travels to a button instead of teleporting onto it, and a highlight
 * that is only drawn once the thing it points at is actually on screen.
 */
import fs from 'node:fs';
import path from 'node:path';

import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import type { DemoMeta, TimelineEntry } from './captions.js';
import {
  describeLocator,
  locatorFromMessage,
  parseAriaSnapshot,
  rank,
  stripAnsi,
  type Candidate,
  type CheckFailure,
  type CheckFrame,
  type CheckReport,
  type CheckStep,
  type LocatorProbe,
  type PageSeen,
} from './check.js';
import { resolveConfig, type DemotaleConfig, type ResolvedConfig } from './config.js';
import { overlayScript, type OverlayWindow } from './overlay.js';

/** Reading time for a subtitle: about 15 characters per second, with a floor and a ceiling. */
export function readingTimeMs(text: string): number {
  return Math.min(9_000, Math.max(1_900, (text.length / 15) * 1_000));
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * How long to wait for something a scenario is about to point at.
 *
 * Deliberately short. Waiting on an element that may never appear once burned a fifteen-minute test
 * budget with a fully provisioned environment around it; a missing panel should cost seconds and
 * produce a sentence.
 */
const POINT_AT_TIMEOUT = 10_000;
const CLICK_TIMEOUT = 15_000;
/** Applications that scroll smoothly need this before a bounding box means anything. */
const SCROLL_SETTLE_MS = 450;

/**
 * A dry run waits less, because it is allowed to be wrong about a slow element and say so.
 *
 * First a short wait, then look at the page while it is still in the state that went wrong, then
 * keep waiting to the shorter ceiling. An element that turns up in between is a warning with a
 * number on it rather than an accusation: the recording, which waits ten seconds, would have caught
 * it.
 */
const CHECK_FIRST_WAIT_MS = 1_200;
const CHECK_TIMEOUT_MS = 4_000;

/** How a `Demo` was started: filming, or the dry run behind `demotale check`. */
export type DemoMode = 'record' | 'check';

export interface DemoRunOptions {
  mode?: DemoMode;
  /** Where a dry run writes its frames. Required in check mode, ignored otherwise. */
  frameDir?: string;
}

/** Thrown by the dry run when a locator missed, carrying the report the CLI prints. */
class CheckStop extends Error {
  override readonly name = 'CheckStop';
  constructor(
    message: string,
    readonly probe: LocatorProbe,
  ) {
    super(message);
  }
}

export class Demo {
  private stepNumber = 0;
  private readonly script: string;
  private readonly mode: DemoMode;
  private readonly frameDir: string;
  private frameCount = 0;
  /** How many `step()` bodies are running. Zero means an action has no step to close. */
  private stepDepth = 0;
  /** Set by an action inside a step, so the step knows it has a result worth a frame. */
  private acted = false;
  /** Only filled in check mode: one entry per timeline mark, with the frames taken during it. */
  private readonly checkSteps: CheckStep[] = [];
  private readonly pagesSeen: PageSeen[] = [];
  private checkFailure: CheckFailure | undefined;

  /**
   * Everything that was said, and when. The fixture writes it out beside the video, and the renderer
   * turns it into a `.vtt` and a transcript. A scenario writer does nothing to get this.
   */
  readonly timeline: TimelineEntry[] = [];
  private readonly startedAt = Date.now();

  constructor(
    private readonly page: Page,
    private readonly config: ResolvedConfig,
    run: DemoRunOptions = {},
  ) {
    this.script = overlayScript(config.theme, config.redact);
    this.mode = run.mode ?? 'record';
    this.frameDir = run.frameDir ?? '';
  }

  /** Milliseconds since the overlay went in, which is as close to the video's zero as we can get. */
  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  private mark(entry: Omit<TimelineEntry, 'at'>): void {
    const at = this.elapsedMs();
    this.timeline.push({ at, ...entry });
    if (this.mode === 'check') {
      this.checkSteps.push({
        kind: entry.kind,
        text: entry.text,
        ...(entry.badge === undefined ? {} : { badge: entry.badge }),
        atMs: at,
        frames: [],
      });
    }
  }

  private get currentStep(): CheckStep | undefined {
    return this.checkSteps[this.checkSteps.length - 1];
  }

  /** Injects the overlay, including into the page that is already open. */
  async install(): Promise<void> {
    await this.page.addInitScript(this.script);
    await this.page.evaluate(this.script).catch(() => {
      // No document yet (about:blank before the first navigation). addInitScript covers that.
    });
  }

  /**
   * A pause that exists for the viewer: reading time, a title card holding, a spotlight standing
   * still. Scaled by `speed`, and skipped entirely by the dry run, which has no viewer.
   */
  async pause(ms: number): Promise<void> {
    if (this.mode === 'check') return;
    await this.page.waitForTimeout(Math.round(ms * this.config.speed));
  }

  /**
   * A pause the application needs: a smooth scroll finishing, a click landing, a card fading out of
   * the way. The dry run keeps every one of these, because skipping them changes what the page is
   * doing rather than how long you look at it, and then the check would be measuring a different
   * application than the recording does.
   */
  private async settle(ms: number): Promise<void> {
    await this.page.waitForTimeout(this.mode === 'check' ? ms : Math.round(ms * this.config.speed));
  }

  /**
   * A frame of the dry run, taken while the subtitle is up.
   *
   * The timing is the whole point. A frame from before the caption, or from after the spotlight was
   * cleared, would show something the viewer never sees, and an author checking it would be checking
   * the wrong picture. `animations: 'disabled'` finishes the overlay's 260ms fade instead of catching
   * it at opacity zero.
   */
  private async shoot(of: CheckFrame['of']): Promise<void> {
    if (this.mode !== 'check') return;

    this.frameCount += 1;
    const badge = this.currentStep?.badge;
    const name =
      `${String(this.frameCount).padStart(2, '0')}-${of}` +
      `${badge === undefined ? '' : `-${badge}`}.png`;

    try {
      fs.mkdirSync(this.frameDir, { recursive: true });
      await this.page.screenshot({
        path: path.join(this.frameDir, name),
        animations: 'disabled',
        caret: 'initial',
      });
      this.currentStep?.frames.push({ file: name, of });

      // Which page this frame is of. Same reason the report prints it: a check cannot know which
      // application you meant, so it says which one it filmed.
      const url = this.page.url();
      const title = await this.page.title().catch(() => '');
      const last = this.pagesSeen[this.pagesSeen.length - 1];
      if (last?.url !== url || last.title !== title) {
        this.pagesSeen.push({ url, title, atStep: this.stepNumber });
      }
    } catch {
      // A frame is diagnostics. Losing one must not end a run that is otherwise fine.
    }
  }

  /**
   * Wait for something the scenario is about to point at.
   *
   * In a recording this is one `waitFor` and nothing else, exactly as it always was. In a dry run it
   * is the one door every locator goes through, so it is also the only place that can look at the
   * page at the moment it went wrong and say what was there instead.
   */
  private async find(locator: Locator, timeout: number): Promise<void> {
    if (this.mode !== 'check') {
      await locator.waitFor({ state: 'visible', timeout });
      return;
    }

    const startedAt = Date.now();
    try {
      await locator.waitFor({ state: 'visible', timeout: CHECK_FIRST_WAIT_MS });
      return;
    } catch {
      // Look at the page while it is still in the state that failed, before waiting any longer.
    }

    const probe = await this.probeLocator(locator, Date.now() - startedAt);
    const ambiguous = probe.matched > 1;
    const remaining = CHECK_TIMEOUT_MS - (Date.now() - startedAt);

    if (!ambiguous && remaining > 0) {
      try {
        await locator.waitFor({ state: 'visible', timeout: remaining });
        const step = this.currentStep;
        if (step) step.warning = { ...probe, appearedAfterMs: Date.now() - startedAt };
        return;
      } catch {
        // Still not there. Now it is a failure.
      }
    }

    const waited = Date.now() - startedAt;
    const what = ambiguous
      ? `matched ${probe.matched} elements, so it is ambiguous`
      : `matched nothing after ${(waited / 1000).toFixed(1)}s`;
    const failed: LocatorProbe = { ...probe, waitedMs: waited };

    // Recorded before throwing, because the report is written in fixture teardown and by then the
    // error is only a string.
    this.checkFailure = {
      ...(this.checkSteps.length === 0 ? {} : { stepIndex: this.checkSteps.length - 1 }),
      probe: failed,
      message: `${failed.locator} ${what}`,
      fromAssertion: false,
    };
    throw new CheckStop(`demotale check: ${failed.locator} ${what}.`, failed);
  }

  /**
   * The dry run's findings. `fallback` is Playwright's own message, used when the run died on
   * something this file never saw: an assertion in the scenario, a navigation, a crash.
   */
  checkReport(title: string, scenario: string, fallback?: string): CheckReport {
    const plain = fallback === undefined ? undefined : stripAnsi(fallback);
    const locator = plain === undefined ? undefined : locatorFromMessage(plain);
    const failure =
      this.checkFailure ??
      (plain === undefined
        ? undefined
        : {
            ...(this.checkSteps.length === 0 ? {} : { stepIndex: this.checkSteps.length - 1 }),
            message: plain,
            fromAssertion: /expect\(/.test(plain),
            ...(locator === undefined ? {} : { locator }),
          });

    return {
      title,
      scenario,
      ok: failure === undefined,
      durationMs: this.elapsedMs(),
      frameDir: this.frameDir,
      pages: this.pagesSeen,
      baseUrl: this.config.baseUrl,
      steps: this.checkSteps,
      ...(failure === undefined ? {} : { failure }),
    };
  }

  /** What the page actually held when a locator missed. Only ever runs in check mode. */
  private async probeLocator(locator: Locator, waitedMs: number): Promise<LocatorProbe> {
    const source = describeLocator(String(locator));
    const matched = await locator.count().catch(() => 0);

    let visible = 0;
    for (let index = 0; index < Math.min(matched, 10); index += 1) {
      if (await locator.nth(index).isVisible().catch(() => false)) visible += 1;
    }

    const snapshot = await this.page
      .locator('body')
      .ariaSnapshot()
      .catch(() => '');

    const byTestId = (await this.page
      .evaluate(() => {
        const found: { role: string; name: string; testId: string; text?: string }[] = [];
        for (const element of Array.from(document.querySelectorAll('[data-testid]')).slice(0, 60)) {
          const style = window.getComputedStyle(element as HTMLElement);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
          found.push({
            role: element.tagName.toLowerCase(),
            name: '',
            testId: element.getAttribute('data-testid') ?? '',
            ...(text === '' ? {} : { text }),
          });
        }
        return found;
      })
      .catch(() => [] as Candidate[])) as Candidate[];

    return {
      locator: source,
      matched,
      visible,
      waitedMs,
      url: this.page.url(),
      title: await this.page.title().catch(() => ''),
      candidates: rank(source, [...parseAriaSnapshot(snapshot), ...byTestId]),
    };
  }

  /** Show a subtitle and leave it standing, for as long as it takes to read it. */
  async say(text: string, opts: { badge?: string; hold?: number } = {}): Promise<void> {
    this.mark({ kind: 'say', text, ...(opts.badge === undefined ? {} : { badge: opts.badge }) });
    await this.showCaption(text, opts.badge ?? '', opts.hold);
  }

  private async showCaption(text: string, badge: string, hold?: number): Promise<void> {
    await this.ensureOverlay();
    await this.page.evaluate(
      (arg) => (window as OverlayWindow).__demo?.say(arg.text, arg.badge),
      { text, badge },
    );
    await this.shoot('caption');
    await this.pause(hold ?? readingTimeMs(text));
  }

  /** Take the subtitle away, just before a title card for instance. */
  async hide(): Promise<void> {
    await this.page.evaluate(() => (window as OverlayWindow).__demo?.hide()).catch(() => {});
  }

  /**
   * A numbered step: show the text, wait until it can have been read, and only then act. The text
   * stays up during the action, so the viewer knows what they are looking at rather than what they
   * have just looked at.
   */
  async step(text: string, body?: () => Promise<void>): Promise<void> {
    this.stepNumber += 1;
    const badge = String(this.stepNumber);
    this.mark({ kind: 'step', text, badge });
    await this.showCaption(text, badge);
    if (!body) return;

    const outerActed = this.acted;
    this.stepDepth += 1;
    this.acted = false;
    try {
      await body();
      // The frame that shows what the step did is taken here, after the body, not next to the
      // click that set it off. Measured on an application that loads asynchronously: Playwright's
      // click waits for the element to be clickable, not for the application to answer, so the
      // frame beside it caught a spinner reading "Loading parcels…" under a subtitle promising a
      // table. One arm went looking for a broken locator that was fine. By the time the body
      // returns the author's own waits and assertions have passed, so the frame shows the state
      // the step claims. Only when something acted, so a step that just points at the page keeps
      // the frames it always had.
      if (this.acted) await this.shoot('result');
    } finally {
      this.stepDepth -= 1;
      this.acted = outerActed;
    }
  }

  /** A full-screen title card, for the beginning and the end. */
  async card(title: string, subtitle = '', holdMs = 2_600): Promise<void> {
    this.mark({ kind: 'card', text: title, ...(subtitle === '' ? {} : { subtitle }) });
    await this.ensureOverlay();
    await this.hide();
    await this.page.evaluate(
      (arg) => (window as OverlayWindow).__demo?.card(arg.title, arg.subtitle),
      { title, subtitle },
    );
    await this.shoot('card');
    await this.pause(holdMs);
  }

  /** Take the title card away. */
  async hideCard(): Promise<void> {
    await this.page.evaluate(() => (window as OverlayWindow).__demo?.hideCard()).catch(() => {});
    // A settle, not a pause: the card is opaque and fades over 400ms, and a dry run that skipped
    // this would take every later frame through a half-visible card.
    await this.settle(500);
  }

  /**
   * Draw a frame around an element and dim the rest of the picture.
   *
   * It scrolls there first, and a first recording is why: `boundingBox` is viewport-relative and
   * answers for an element below the fold too, so three spotlights in a row were drawn off screen and
   * the video showed a dimmed page with nothing marked on it. Scrolling is also what a person does
   * before pointing at something.
   */
  async spotlight(locator: Locator, holdMs = 0, opts: { timeout?: number } = {}): Promise<void> {
    const timeout = opts.timeout ?? POINT_AT_TIMEOUT;
    await this.find(locator, timeout);
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    // A settle: a box measured halfway through a smooth scroll frames empty space, in a dry run
    // exactly as in a recording.
    await this.settle(SCROLL_SETTLE_MS);

    const box = await locator.boundingBox();
    if (box === null) {
      throw new Error(
        'demotale: spotlight found the element but it has no box on screen, so there is nothing ' +
          'to frame. It is probably collapsed or clipped to zero size.',
      );
    }

    await this.ensureOverlay();
    await this.page.evaluate((b) => (window as OverlayWindow).__demo?.ring(b), box);
    // The frame worth having: caption up and the ring drawn, so it shows whether the subtitle sits
    // on top of the thing it points at.
    await this.shoot('spotlight');
    if (holdMs) await this.pause(holdMs);
  }

  /** Take the frame away and undim the page. */
  async clearSpotlight(): Promise<void> {
    await this.page.evaluate(() => (window as OverlayWindow).__demo?.ring(null)).catch(() => {});
  }

  /**
   * Click the way a person does: the pointer travels there in steps, holds still, then clicks.
   * Without that movement the cursor jumps out of nowhere onto the target and the video reads as a
   * script rather than as somebody using the application.
   */
  async click(
    locator: Locator,
    opts: { force?: boolean; timeout?: number; settleMs?: number } = {},
  ): Promise<void> {
    const timeout = opts.timeout ?? CLICK_TIMEOUT;
    await this.find(locator, timeout);
    await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});

    const box = await locator.boundingBox().catch(() => null);
    if (box !== null) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
      await this.pause(320);
    }

    await locator.click({ timeout, force: opts.force });
    // A settle: whatever the click set off has to have happened before the next step looks.
    await this.settle(opts.settleMs ?? 450);
    // The result is worth a frame, but not yet: `step()` takes it once its body is done, when the
    // application has answered. A frame here would show the page mid-load. Outside a step there is
    // nothing to wait for it, so then this is the only chance.
    this.acted = true;
    if (this.stepDepth === 0) await this.shoot('result');
  }

  /**
   * A standing label in the corner, for something that is true of the whole recording rather than of
   * this moment: "seeded data, no real customer", "staging".
   *
   * A demo that overstates is worse than no demo. If something on screen is not what it looks like,
   * this is where you say so, and it stays said. Pass nothing to take the label away.
   */
  async note(text: string | null = null): Promise<void> {
    if (text !== null) this.mark({ kind: 'note', text });
    await this.ensureOverlay();
    await this.page
      .evaluate((value) => (window as OverlayWindow).__demo?.note(value), text)
      .catch(() => {});
  }

  /**
   * Marks a chapter. Nothing appears on screen; it shows up in the transcript and in the subtitle
   * file, which is where somebody looking for one part of a long recording actually looks.
   */
  chapter(title: string): void {
    this.mark({ kind: 'chapter', text: title });
  }

  /**
   * A long wait with a name on it.
   *
   * Some things genuinely take minutes. Filming a spinner for four of them helps nobody, so this
   * shows what is being waited for, waits for the real thing, and writes down how long it actually
   * took. The transcript then says "waited 3m 41s for the run to finish", which is the honest version
   * of cutting it out.
   */
  async wait<T>(label: string, work: Promise<T>): Promise<T> {
    // Through `mark` like everything else, so a named wait gets its own line in a check report as
    // well as in the transcript. The entry is kept because its duration is only known afterwards.
    this.mark({ kind: 'wait', text: label });
    const entry = this.timeline[this.timeline.length - 1] as TimelineEntry;

    await this.showCaption(label, '', 600);
    const startedAt = Date.now();
    try {
      return await work;
    } finally {
      entry.durationMs = Date.now() - startedAt;
    }
  }

  /**
   * Take one element out of the picture for the rest of the recording.
   *
   * For anything that must never be filmed, prefer the `redact` list in the config: that is a rule
   * about the recording, applied before the first frame and again after every navigation. This is the
   * one-off version, and a re-render can bring the element back.
   */
  async redact(locator: Locator): Promise<void> {
    await locator
      .evaluate((element: HTMLElement) => {
        element.style.setProperty('visibility', 'hidden', 'important');
      })
      .catch(() => {});
  }

  /** Type with visible keystrokes instead of filling the field in one go. */
  async type(locator: Locator, text: string, delay = 55): Promise<void> {
    await this.click(locator, { settleMs: 150 });
    await locator.pressSequentially(text, { delay: this.mode === 'check' ? 0 : delay });
    await this.settle(350);
  }

  /** Restore the overlay when a navigation or a re-render has thrown it away. */
  private async ensureOverlay(): Promise<void> {
    const alive = await this.page
      .evaluate(() => (window as OverlayWindow).__demo?.ready() === true)
      .catch(() => false);
    if (!alive) await this.page.evaluate(this.script).catch(() => {});
  }
}

export interface DemotaleFixtures {
  demo: Demo;
}

export interface DemotaleOptions {
  /**
   * Set by `definePlaywrightConfig`, so a scenario never has to load the config itself. Writing it
   * by hand in `use` works too, and is what a one-off recording without a config file does.
   */
  demotale: DemotaleConfig;
  /**
   * Filming, or the dry run behind `demotale check`. Set by `definePlaywrightConfig`; a scenario
   * never mentions it, which is the point: one scenario, one code path, two speeds.
   */
  demotaleMode: DemoMode;
}

/**
 * The scenario entry point. Besides `demo` it leaves a small sidecar next to the recording: Playwright
 * names the video directory itself, and the renderer has to know which mp4 this was meant to become.
 */
export const test = base.extend<DemotaleOptions & DemotaleFixtures>({
  demotale: [{}, { option: true }],
  demotaleMode: ['record', { option: true }],

  demo: async ({ page, demotale, demotaleMode }, use, testInfo: TestInfo) => {
    const config = resolveConfig(demotale);
    const demo = new Demo(page, config, { mode: demotaleMode, frameDir: testInfo.outputDir });
    await demo.install();

    await use(demo);

    if (demotaleMode === 'check') {
      // No demo-meta.json here on purpose: its durations come from a run with the pauses taken out,
      // and the renderer would turn those numbers into subtitle timings that are simply wrong.
      const report = demo.checkReport(
        testInfo.title,
        path.relative(process.cwd(), testInfo.file),
        testInfo.error?.message,
      );
      fs.mkdirSync(testInfo.outputDir, { recursive: true });
      fs.writeFileSync(
        path.join(testInfo.outputDir, 'check.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      );
      return;
    }

    const meta: DemoMeta = {
      name: slugify(testInfo.title),
      title: testInfo.title,
      recordedAt: new Date().toISOString(),
      durationMs: demo.elapsedMs(),
      entries: demo.timeline,
    };

    fs.mkdirSync(testInfo.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(testInfo.outputDir, 'demo-meta.json'),
      `${JSON.stringify(meta, null, 2)}\n`,
    );
  },
});

export { expect };
