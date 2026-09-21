/**
 * The overlay layer, which runs inside the PAGE itself.
 *
 * Why in the page and not in post-production: Playwright records the viewport as the browser paints
 * it, so anything in the DOM ends up in the video by itself. Burning subtitles in afterwards with
 * ffmpeg would create a second timeline that has to be lined up again for every recording. This way
 * the text is synchronous with the action by definition.
 *
 * Five properties this layer must keep, each of which cost a recording to learn:
 *
 * - It catches no mouse and no keys (`pointer-events: none` on the layer *and* everything in it),
 *   so a subtitle can never swallow the click meant for the button underneath.
 * - It draws its own cursor from real mousemove events. Playwright's video does not capture the
 *   operating system's pointer.
 * - It re-injects itself. An SPA navigation or a full reload throws it away, so the guard at the top
 *   makes running the script twice free.
 * - It keeps itself the last child of `body`. Applications append modals and toasts there, and those
 *   would otherwise cover the subtitle.
 * - It covers the page from the first paint. Playwright's video starts before `goto` returns and
 *   before `card()` runs, so a card that fades in from opacity 0 films the application first.
 *
 * The style block it injects is refused by any application that sends `style-src 'self'`, which is
 * why `definePlaywrightConfig` sets `bypassCSP` on the recording browser. That is a property of the
 * browser doing the filming, not of the application: the served headers do not change.
 */
import type { Theme } from './theme.js';

const ID = '__demo-layer';

export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Gap kept between the subtitle and the spotlight ring, in pixels. */
export const CAPTION_RING_GAP = 12;

export function boxesOverlap(a: OverlayBox, b: OverlayBox, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

/**
 * Preferred edge unless the ring sits on it; the other edge if that is free; preferred again if
 * both would cover the ring (a near-full-viewport highlight).
 */
export function pickCaptionEdge(
  preferred: 'top' | 'bottom',
  preferredBox: OverlayBox,
  otherBox: OverlayBox,
  ring: OverlayBox,
  gap = 12,
): 'top' | 'bottom' {
  if (!boxesOverlap(preferredBox, ring, gap)) return preferred;
  const other: 'top' | 'bottom' = preferred === 'top' ? 'bottom' : 'top';
  if (!boxesOverlap(otherBox, ring, gap)) return other;
  return preferred;
}

/** What the injected script hangs on `window.__demo`. */
export interface DemoOverlay {
  say(text: string, badge?: string): void;
  hide(): void;
  card(title: string, subtitle?: string): void;
  hideCard(): void;
  ring(box: OverlayBox | null): void;
  /** A standing label in the corner. `null` takes it away. */
  note(text: string | null): void;
  /**
   * Hide every painted overlay piece so a screenshot is the application. Redaction stays: it is a
   * style rule, not a painted element.
   */
  stillClean(on: boolean): void;
  ready(): boolean;
}

/** `window` inside the recorded page, once the overlay has run. */
export type OverlayWindow = Window & { __demo?: DemoOverlay };

/**
 * Elements that must not be in the picture, whatever the click path does.
 *
 * `visibility` rather than `display`, because a demo should film the layout the application really
 * has: removing an element from the flow moves everything around it and the recording stops matching
 * what a viewer sees in their own browser.
 */
function redactionCss(selectors: readonly string[]): string {
  if (selectors.length === 0) return '';
  return `\n    ${selectors.join(',\n    ')} { visibility: hidden !important; }`;
}

function css(theme: Theme): string {
  // The subtitle slides in towards its edge, so it arrives from off-frame rather than appearing.
  // Two edge classes: the spotlight may flip the caption to the other rim so it does not cover the
  // ring. The theme's captionPosition is only the preferred rim.
  return `
    #${ID}, #${ID} * { pointer-events: none !important; box-sizing: border-box; }
    #${ID} {
      position: fixed; inset: 0; z-index: 2147483647;
      font-family: ${theme.fontFamily};
    }
    #${ID} .demo-caption {
      position: absolute; left: 50%;
      max-width: ${theme.captionMaxWidth}; display: flex; align-items: flex-start; gap: 14px;
      padding: 16px 24px; border-radius: ${theme.radius}px;
      background: ${theme.surface}; color: ${theme.text};
      font-size: ${theme.captionFontSize}px; line-height: 1.45; font-weight: 500;
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
      opacity: 0; transition: opacity 260ms ease, transform 260ms ease, top 260ms ease, bottom 260ms ease;
    }
    #${ID} .demo-caption.edge-top { top: ${theme.captionOffset}px; bottom: auto; transform: translate(-50%, -16px); }
    #${ID} .demo-caption.edge-bottom { bottom: ${theme.captionOffset}px; top: auto; transform: translate(-50%, 16px); }
    #${ID} .demo-caption.visible { opacity: 1; transform: translate(-50%, 0); }
    #${ID} .demo-badge {
      flex: 0 0 auto; min-width: 30px; height: 30px; border-radius: 15px;
      background: ${theme.accent}; color: ${theme.onAccent};
      font-size: 15px; font-weight: 700;
      display: flex; align-items: center; justify-content: center; padding: 0 9px; margin-top: 2px;
    }
    #${ID} .demo-badge.hidden { display: none; }
    #${ID} .demo-cursor {
      position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border-radius: 50%; border: 2px solid ${theme.onAccent};
      background: ${theme.accent};
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      opacity: 0; transition: transform 110ms linear, opacity 200ms ease;
    }
    #${ID} .demo-cursor.visible { opacity: 0.75; }
    #${ID} .demo-ring {
      position: absolute; border: 3px solid ${theme.accent}; border-radius: ${theme.radius}px;
      box-shadow: 0 0 0 9999px ${theme.dim};
      opacity: 0; transition: opacity 220ms ease, top 260ms ease, left 260ms ease,
                              width 260ms ease, height 260ms ease;
    }
    #${ID} .demo-ring.visible { opacity: 1; }
    /* Opposite the subtitle, so a standing note never collides with the line being read. */
    #${ID} .demo-note {
      position: absolute; left: 24px;
      max-width: 40%; padding: 8px 14px; border-radius: ${theme.radius}px;
      background: ${theme.surface}; color: ${theme.text};
      font-size: ${Math.round(theme.captionFontSize * 0.7)}px; line-height: 1.4; font-weight: 500;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
      opacity: 0; transition: opacity 260ms ease, top 260ms ease, bottom 260ms ease;
    }
    #${ID} .demo-note.note-bottom { bottom: 24px; top: auto; }
    #${ID} .demo-note.note-top { top: 24px; bottom: auto; }
    #${ID}.still-clean .demo-caption,
    #${ID}.still-clean .demo-cursor,
    #${ID}.still-clean .demo-ring,
    #${ID}.still-clean .demo-note,
    #${ID}.still-clean .demo-card,
    #${ID}.still-clean .demo-pulse {
      opacity: 0 !important; visibility: hidden !important;
    }
    #${ID} .demo-note.visible { opacity: 1; }
    #${ID} .demo-card {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 14px; text-align: center;
      background: ${theme.cardSurface}; color: ${theme.text};
      opacity: 1; transition: opacity 400ms ease;
    }
    #${ID} .demo-card.hidden { opacity: 0; }
    #${ID} .demo-card h1 { font-size: 46px; margin: 0; font-weight: 700; letter-spacing: -0.5px; }
    #${ID} .demo-card p { font-size: 22px; margin: 0; color: ${theme.muted}; }
    @keyframes demo-pulse {
      from { transform: scale(0.4); opacity: 0.75; }
      to { transform: scale(2.4); opacity: 0; }
    }
    #${ID} .demo-pulse {
      position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px;
      border-radius: 50%; background: ${theme.accent};
      animation: demo-pulse 520ms ease-out forwards;
    }`;
}

/**
 * The script that is injected into the page, built for one theme.
 *
 * The styling is baked in here as a JSON string rather than interpolated inside the injected source,
 * so a colour containing a quote or a backtick can never break the script it lands in.
 */
export function overlayScript(theme: Theme, redact: readonly string[] = []): string {
  return `(() => {
  if (window.__demo) return;

  const ID = ${JSON.stringify(ID)};
  const CSS = ${JSON.stringify(css(theme) + redactionCss(redact))};
  const SHOW_BADGE = ${theme.badge ? 'true' : 'false'};
  const CARD_SURFACE = ${JSON.stringify(theme.cardSurface)};
  const PREFERRED = ${JSON.stringify(theme.captionPosition)};
  const RING_GAP = ${CAPTION_RING_GAP};
  const OFFSET = ${theme.captionOffset};
  const COVER_KEY = '__demotale_cover';
  const COVER_STYLE_ID = '__demo-cover-style';
  const state = {};
  const boxesOverlap = ${boxesOverlap.toString()};
  const pickCaptionEdge = ${pickCaptionEdge.toString()};

  function captionBox(edge, width, height) {
    return {
      x: (window.innerWidth - width) / 2,
      y: edge === 'top' ? OFFSET : window.innerHeight - OFFSET - height,
      width: width,
      height: height
    };
  }

  function setCaptionEdge(edge) {
    if (!state.caption) return;
    state.caption.classList.toggle('edge-top', edge === 'top');
    state.caption.classList.toggle('edge-bottom', edge === 'bottom');
    if (!state.note) return;
    // Note stays opposite the subtitle.
    state.note.classList.toggle('note-bottom', edge === 'top');
    state.note.classList.toggle('note-top', edge === 'bottom');
  }

  let coverWaiter = null;

  function dismissed() {
    try { return sessionStorage.getItem(COVER_KEY) === 'off'; } catch { return false; }
  }

  function paintHtmlCover() {
    const html = document.documentElement;
    if (!html) {
      // addInitScript can run before the parser has created <html>. Returning here would skip
      // the cover until DOMContentLoaded, and a deferred script can paint the application in
      // that gap. MutationObserver callbacks run before the next paint.
      if (!coverWaiter) {
        coverWaiter = new MutationObserver(() => { paintHtmlCover(); });
        coverWaiter.observe(document, { childList: true });
      }
      return;
    }
    if (coverWaiter) {
      coverWaiter.disconnect();
      coverWaiter = null;
    }
    if (dismissed()) {
      html.classList.remove('demotale-cover');
      return;
    }
    if (!document.getElementById(COVER_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = COVER_STYLE_ID;
      style.textContent = 'html.demotale-cover::before{content:"";position:fixed;inset:0;background:'
        + CARD_SURFACE + ';z-index:2147483647;pointer-events:none;}';
      (document.head || html).appendChild(style);
    }
    html.classList.add('demotale-cover');
  }

  function clearHtmlCover() {
    const html = document.documentElement;
    if (html) html.classList.remove('demotale-cover');
  }

  // Before body exists, and so before the overlay can mount: this is what the first video frame
  // actually is. Without it, goto paints the application and card() fades in over the top.
  paintHtmlCover();

  function ensureRoot() {
    if (state.root && document.body && document.body.contains(state.root)) return state.root;
    if (!document.body) return null;

    const root = document.createElement('div');
    root.id = ID;
    root.setAttribute('aria-hidden', 'true');

    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    const cursor = document.createElement('div');
    cursor.className = 'demo-cursor';

    const ring = document.createElement('div');
    ring.className = 'demo-ring';

    const caption = document.createElement('div');
    caption.className = 'demo-caption edge-' + PREFERRED;
    const badge = document.createElement('span');
    badge.className = 'demo-badge hidden';
    const text = document.createElement('span');
    text.className = 'demo-text';
    caption.append(badge, text);

    const note = document.createElement('div');
    note.className = 'demo-note ' + (PREFERRED === 'top' ? 'note-bottom' : 'note-top');

    const card = document.createElement('div');
    card.className = dismissed() ? 'demo-card hidden' : 'demo-card';
    if (dismissed()) card.style.transition = 'none';
    const title = document.createElement('h1');
    const subtitle = document.createElement('p');
    card.append(title, subtitle);

    root.append(cursor, ring, caption, note, card);
    document.body.appendChild(root);

    Object.assign(state, { root, cursor, ring, caption, badge, text, note, card, title, subtitle });
    if (!dismissed()) clearHtmlCover();
    return root;
  }

  if (document.body) ensureRoot();
  else document.addEventListener('DOMContentLoaded', () => { paintHtmlCover(); ensureRoot(); }, { once: true });

  // Applications append modals and toasts to the end of body, so being last is not a one-time thing.
  function raise() {
    const root = ensureRoot();
    if (root && document.body.lastElementChild !== root) document.body.appendChild(root);
    return root;
  }

  document.addEventListener('mousemove', (e) => {
    if (!ensureRoot()) return;
    state.cursor.style.left = e.clientX + 'px';
    state.cursor.style.top = e.clientY + 'px';
    state.cursor.classList.add('visible');
  }, true);

  document.addEventListener('mousedown', (e) => {
    const root = ensureRoot();
    if (!root) return;
    const pulse = document.createElement('div');
    pulse.className = 'demo-pulse';
    pulse.style.left = e.clientX + 'px';
    pulse.style.top = e.clientY + 'px';
    root.appendChild(pulse);
    setTimeout(() => pulse.remove(), 600);
  }, true);

  window.__demo = {
    say(text, badge) {
      if (!raise()) return;
      state.text.textContent = text;
      if (badge && SHOW_BADGE) {
        state.badge.textContent = badge;
        state.badge.classList.remove('hidden');
      } else {
        state.badge.classList.add('hidden');
      }
      state.caption.classList.add('visible');
    },
    hide() { if (state.caption) state.caption.classList.remove('visible'); },
    card(title, subtitle) {
      try { sessionStorage.removeItem(COVER_KEY); } catch {}
      if (!raise()) return;
      clearHtmlCover();
      state.title.textContent = title;
      state.subtitle.textContent = subtitle || '';
      state.card.style.transition = '';
      state.card.classList.remove('hidden');
    },
    hideCard() {
      try { sessionStorage.setItem(COVER_KEY, 'off'); } catch {}
      clearHtmlCover();
      if (state.card) {
        state.card.style.transition = '';
        state.card.classList.add('hidden');
      }
    },
    note(text) {
      if (!raise()) return;
      if (text === null || text === undefined || text === '') {
        state.note.classList.remove('visible');
        return;
      }
      state.note.textContent = text;
      state.note.classList.add('visible');
    },
    ring(box) {
      if (!raise()) return;
      if (!box) {
        state.ring.classList.remove('visible');
        setCaptionEdge(PREFERRED);
        return;
      }
      const pad = 6;
      state.ring.style.left = (box.x - pad) + 'px';
      state.ring.style.top = (box.y - pad) + 'px';
      state.ring.style.width = (box.width + pad * 2) + 'px';
      state.ring.style.height = (box.height + pad * 2) + 'px';
      state.ring.classList.add('visible');
      if (!state.caption.classList.contains('visible')) {
        setCaptionEdge(PREFERRED);
        return;
      }
      const width = state.caption.offsetWidth;
      const height = state.caption.offsetHeight;
      const other = PREFERRED === 'top' ? 'bottom' : 'top';
      setCaptionEdge(pickCaptionEdge(
        PREFERRED,
        captionBox(PREFERRED, width, height),
        captionBox(other, width, height),
        { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
        RING_GAP
      ));
    },
    stillClean(on) {
      const root = raise();
      if (!root) return;
      root.classList.toggle('still-clean', !!on);
      if (on) clearHtmlCover();
    },
    ready() { return !!ensureRoot(); }
  };
})();`;
}
