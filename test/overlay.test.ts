import { describe, expect, it } from 'vitest';

import { overlayScript, pickCaptionEdge, boxesOverlap } from '../src/overlay.js';
import { defaultTheme, lightTheme } from '../src/theme.js';

/**
 * The overlay is a string that runs in someone else's page, so it cannot be unit-tested by calling
 * it. What is worth pinning down is the handful of properties that each cost a recording to learn,
 * and that a refactor could quietly drop.
 */
describe('overlayScript', () => {
  const script = overlayScript(defaultTheme);

  it('does nothing when it runs twice', () => {
    expect(script).toContain('if (window.__demo) return;');
  });

  it('never catches a click meant for the application', () => {
    expect(script).toContain('pointer-events: none !important');
  });

  it('keeps itself the last child of body, where modals and toasts also land', () => {
    expect(script).toContain('document.body.lastElementChild !== root');
  });

  it('draws its own cursor, because Playwright does not record the real one', () => {
    expect(script).toContain("addEventListener('mousemove'");
    expect(script).toContain('demo-cursor');
  });

  it('puts the subtitle at the top by default, away from where new rows appear', () => {
    expect(script).toContain('edge-top { top: 64px');
    expect(script).not.toContain('PREFERRED = "bottom"');
  });

  it('moves the subtitle to the bottom when the theme says so', () => {
    const bottom = overlayScript({ ...defaultTheme, captionPosition: 'bottom' });
    expect(bottom).toContain('PREFERRED = "bottom"');
    expect(bottom).toContain('edge-bottom { bottom: 64px');
  });

  it('takes its colours from the theme rather than from a constant', () => {
    expect(script).toContain(defaultTheme.accent);
    expect(overlayScript(lightTheme)).toContain(lightTheme.accent);
    expect(overlayScript(lightTheme)).not.toContain(defaultTheme.accent);
  });

  it('drops the step badge when the theme turns it off', () => {
    expect(overlayScript({ ...defaultTheme, badge: false })).toContain('SHOW_BADGE = false');
  });

  it('hides redacted selectors without moving the layout around them', () => {
    const redacted = overlayScript(defaultTheme, ['.org-switcher', '#account']);
    // visibility rather than display: removing an element from the flow moves everything around it,
    // and then the recording no longer matches the application a viewer opens themselves.
    expect(redacted).toContain('.org-switcher,\\n    #account { visibility: hidden !important; }');
  });

  it('covers the page from the first paint, so the video does not open on the application', () => {
    // Opacity 1 is the default; hideCard adds .hidden. The old fade-in from 0 is what filmed the
    // application for a beat before the title card.
    expect(script).toContain('.demo-card.hidden');
    expect(script).not.toContain('.demo-card.visible');
    expect(script).toContain('html.demotale-cover::before');
    expect(script).toContain("sessionStorage.getItem(COVER_KEY) === 'off'");
    // addInitScript can run before <html> exists. Returning then would skip the cover until
    // DOMContentLoaded; a MutationObserver paints as soon as the element appears, before first paint.
    expect(script).toContain('new MutationObserver');
    expect(script).toContain('coverWaiter.observe(document, { childList: true })');
    expect(script).not.toContain('if (!document.documentElement) return;');
  });

  it('survives a theme value containing a quote instead of breaking the script', () => {
    const script = overlayScript({ ...defaultTheme, fontFamily: `"Escape's Font", sans-serif` });
    expect(() => new Function(script)).not.toThrow();
  });

  it('can hide the painted overlay so a docs still is the application', () => {
    expect(script).toContain('still-clean');
    expect(script).toContain('stillClean(on)');
  });

  it('flips the subtitle off a spotlight that would cover it', () => {
    expect(script).toContain('pickCaptionEdge');
    expect(script).toContain('captionBox');
    expect(script).not.toContain('getBoundingClientRect');
  });

  it('installs the API when <html> is still missing, and paints the cover as soon as it appears', () => {
    const tokens = new Set<string>();
    const html = {
      classList: {
        add: (name: string) => {
          tokens.add(name);
        },
        remove: (name: string) => {
          tokens.delete(name);
        },
      },
      appendChild: (node: unknown) => node,
    };
    const created: Array<{ id: string }> = [];
    let observerCb: (() => void) | undefined;
    const document = {
      documentElement: null as typeof html | null,
      head: null,
      body: null,
      getElementById: () => null,
      createElement: () => {
        const el = { id: '', textContent: '' };
        created.push(el);
        return el;
      },
      addEventListener: () => {},
    };
    let observed: { target: unknown; options: unknown } | undefined;
    class FakeObserver {
      constructor(cb: () => void) {
        observerCb = cb;
      }
      observe(target: unknown, options: unknown) {
        observed = { target, options };
      }
      disconnect() {}
    }
    const window: { __demo?: unknown } = {};
    const sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

    expect(() =>
      new Function('window', 'document', 'sessionStorage', 'MutationObserver', script)(
        window,
        document,
        sessionStorage,
        FakeObserver,
      ),
    ).not.toThrow();
    expect(window.__demo).toBeTruthy();
    expect(observerCb).toBeTypeOf('function');
    expect(observed).toEqual({ target: document, options: { childList: true } });
    expect(tokens.has('demotale-cover')).toBe(false);

    document.documentElement = html;
    observerCb?.();
    expect(tokens.has('demotale-cover')).toBe(true);
    expect(created.some((el) => el.id === '__demo-cover-style')).toBe(true);
  });

  it('does not paint the cover after hideCard, even if <html> appears later', () => {
    const tokens = new Set<string>();
    const html = {
      classList: {
        add: (name: string) => {
          tokens.add(name);
        },
        remove: (name: string) => {
          tokens.delete(name);
        },
      },
      appendChild: (node: unknown) => node,
    };
    let observerCb: (() => void) | undefined;
    const document = {
      documentElement: null as typeof html | null,
      head: null,
      body: null,
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '' }),
      addEventListener: () => {},
    };
    class FakeObserver {
      constructor(cb: () => void) {
        observerCb = cb;
      }
      observe() {}
      disconnect() {}
    }
    const window: { __demo?: unknown } = {};
    const sessionStorage = {
      getItem: () => 'off',
      setItem: () => {},
      removeItem: () => {},
    };

    new Function('window', 'document', 'sessionStorage', 'MutationObserver', script)(
      window,
      document,
      sessionStorage,
      FakeObserver,
    );
    document.documentElement = html;
    observerCb?.();
    expect(tokens.has('demotale-cover')).toBe(false);
  });
});

describe('pickCaptionEdge', () => {
  const captionTop = { x: 200, y: 64, width: 400, height: 60 };
  const captionBottom = { x: 200, y: 780, width: 400, height: 60 };
  const ringLow = { x: 100, y: 700, width: 200, height: 80 };
  const ringHigh = { x: 200, y: 50, width: 300, height: 80 };
  const ringTall = { x: 0, y: 0, width: 800, height: 900 };

  it('keeps the preferred edge when the ring is elsewhere', () => {
    expect(pickCaptionEdge('top', captionTop, captionBottom, ringLow)).toBe('top');
  });

  it('flips when the ring sits on the preferred edge and the other is free', () => {
    expect(pickCaptionEdge('top', captionTop, captionBottom, ringHigh)).toBe('bottom');
  });

  it('stays put when both edges would cover the ring', () => {
    expect(pickCaptionEdge('top', captionTop, captionBottom, ringTall)).toBe('top');
  });

  it('treats a gap as overlap, so the subtitle does not graze the frame', () => {
    expect(boxesOverlap(captionTop, { x: 200, y: 130, width: 10, height: 10 }, 12)).toBe(true);
    expect(boxesOverlap(captionTop, { x: 200, y: 140, width: 10, height: 10 }, 12)).toBe(false);
  });
});
