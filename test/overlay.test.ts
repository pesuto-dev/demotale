import { describe, expect, it } from 'vitest';

import { overlayScript } from '../src/overlay.js';
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
    expect(script).toContain('top: 64px');
    expect(script).not.toContain('bottom: 64px');
  });

  it('moves the subtitle to the bottom when the theme says so', () => {
    const bottom = overlayScript({ ...defaultTheme, captionPosition: 'bottom' });
    expect(bottom).toContain('bottom: 64px');
    expect(bottom).not.toContain('top: 64px');
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
  });

  it('survives a theme value containing a quote instead of breaking the script', () => {
    const script = overlayScript({ ...defaultTheme, fontFamily: `"Escape's Font", sans-serif` });
    expect(() => new Function(script)).not.toThrow();
  });
});
