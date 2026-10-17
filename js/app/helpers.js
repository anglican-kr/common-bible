// @ts-check
"use strict";

// Common DOM helpers used by all app modules. Anchored to `window.appHelpers`
// so other modules can `const { el } = window.appHelpers;` after defer load.
//
// Module pattern: IIFE + window namespace, mirrors the sync layer
// (`window.driveSync`/`window.syncTransport`). See ADR-018 + design doc
// `docs/archive/design/app-modularization.md`.
//
// Note: `announce(msg)` stays in app.js (Phase 8 owner) because it depends
// on the `$announce` anchor; that anchor will move once app.js anchor
// declarations are themselves modularized.

/** @typedef {import("../types").AppHelpers} AppHelpers */
/** @typedef {import("../types").FocusSpot} FocusSpot */

// The return type is declared so a helper missing from `AppHelpers` (types.d.ts) fails typecheck here, not
// later in whichever module destructures it.
window.appHelpers = (/** @returns {AppHelpers} */ () => {
  /**
   * Get the element by ID. Casts to HTMLElement non-null on the assumption
   * that the id is required by index.html. Anchors that are <input>/<button>
   * elements still require explicit narrowing at the call site (.value /
   * .disabled).
   * @param {string} id
   * @returns {HTMLElement}
   */
  function _$(id) {
    return /** @type {HTMLElement} */ (document.getElementById(id));
  }

  // Psalms use "편" instead of "장" as the chapter unit.
  /** @param {string} bookId */
  function chUnit(bookId) {
    return bookId === "ps" ? "편" : "장";
  }

  /**
   * Generic narrow: el("button", ...) returns HTMLButtonElement,
   * el("input", ...) returns HTMLInputElement, etc. — so call sites can read
   * .value/.disabled/.files without per-call casts. `attrs` accepts mixed
   * values (booleans for readOnly, strings for aria-*, numbers for rows)
   * since the DOM coerces in setAttribute.
   * @template {keyof HTMLElementTagNameMap} K
   * @param {K} tag
   * @param {Record<string, any> | null} [attrs]
   * @param {...(Node | string | null | undefined)} children
   * @returns {HTMLElementTagNameMap[K]}
   */
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") node.className = v;
        else if (k === "textContent") node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else if (child) node.appendChild(child);
    }
    return node;
  }

  /** @param {Node} node */
  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Hanging punctuation (ADR-006): a poetry line that opens with a quote
   * pulls that quote into the indent gutter so the first letter stays on
   * the baseline. Straight and curly forms both qualify — bible source is
   * typeset with " / ', the liturgical psalter with “ / ‘ (ADR-039) — and
   * both directions hang, since a line may begin with a closing quote.
   * Each modifier carries the offset for that glyph's advance width; curly
   * doubles are wider than straight ones, singles narrower than both.
   * Returns "" when the character does not open or close a quote.
   * @param {string | undefined} ch
   * @returns {string}
   */
  function hangingQuoteClass(ch) {
    if (ch === '"') return "hanging-quote";
    if (ch === "“" || ch === "”") return "hanging-quote hanging-quote--curly";
    if (ch === "'" || ch === "‘" || ch === "’") {
      return "hanging-quote hanging-quote--single";
    }
    return "";
  }

  /**
   * Toggle background `inert` + `aria-hidden` for elements outside the
   * currently active modal/drawer. Selectors should match the elements
   * that need to be excluded from focus and screen reader output.
   * @param {boolean} on
   * @param {string} selectors
   */
  function setInert(on, selectors) {
    document.querySelectorAll(selectors).forEach((n) => {
      const node = /** @type {HTMLElement} */ (n);
      if (on) {
        node.inert = true;
        node.setAttribute("aria-hidden", "true");
      } else {
        node.inert = false;
        node.removeAttribute("aria-hidden");
      }
    });
  }

  /**
   * Focus trap: keeps Tab cycling within a container while it is open.
   * Returns a cleanup function to remove the listener.
   * @param {HTMLElement} container
   * @returns {() => void}
   */
  function trapFocus(container) {
    /** @param {KeyboardEvent} e */
    function handler(e) {
      if (e.key !== "Tab") return;
      const focusable = /** @type {NodeListOf<HTMLElement>} */ (
        container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }

  /**
   * Decide what should happen when a drag-resizable bottom sheet finishes
   * a drag (pointerup). Pure function so the threshold semantics stay
   * unit-testable independently of the DOM/pointer plumbing — Cursor Bugbot
   * caught a regression where the move handler clamped at 30vh while
   * onPointerUp checked close at 20vh, making snap-close unreachable. This
   * helper pins the relationship between the three thresholds so the bug
   * class can't reappear in any sheet.
   *
   * Threshold semantics (using viewport-height ratios):
   *   - h < 20vh  → close
   *   - 20vh ≤ h < 30vh → snap-min (animate back to the 30vh rest min)
   *   - h ≥ 30vh → stay where released
   *
   * Callers' onMove handlers MUST allow the visual height to drop below the
   * 30vh rest min (clamp at 0, not 30vh) — otherwise the close branch is
   * structurally unreachable.
   *
   * @param {number} h    final sheet height in px (post-drag)
   * @param {number} vh   viewport innerHeight in px
   * @returns {"close" | "snap-min" | "stay"}
   */
  function dragReleaseAction(h, vh) {
    if (h < vh * 0.20) return "close";
    if (h < vh * 0.30) return "snap-min";
    return "stay";
  }

  /**
   * Build a centered empty-state placeholder — icon + title + subtitle, the
   * shared "nothing here yet" surface for the bookmark list and search
   * (ADR-032; DESIGN.md §6 상태 컴포넌트). Icon-agnostic: pass a built SVG/icon
   * NODE (not markup — keeps the shared builder XSS-free); the
   * `.empty-state-icon` slot normalizes its size/opacity via CSS, so both
   * contexts render identically while keeping their own glyph. `tag`/`role` let
   * the bookmark list mount it as a presentational <li> inside its <ul>.
   * @param {{ icon: Node | null, title: string, subtitle: string, tag?: keyof HTMLElementTagNameMap, role?: string }} opts
   * @returns {HTMLElement}
   */
  function emptyState({ icon, title, subtitle, tag = "div", role }) {
    const box = el(tag, role ? { className: "empty-state", role } : { className: "empty-state" });
    const iconWrap = el("div", { className: "empty-state-icon", "aria-hidden": "true" });
    if (icon) iconWrap.appendChild(icon);
    box.appendChild(iconWrap);
    box.appendChild(el("p", { className: "empty-state-title" }, title));
    box.appendChild(el("p", { className: "empty-state-subtitle" }, subtitle));
    return box;
  }

  /**
   * Path data of the header icons, one entry per glyph — every control that
   * draws a glyph passes the same entry to `headerIcon`.
   */
  const HEADER_ICON_PATHS = Object.freeze({
    // Left chevron — up a level / back (lectionary → its calendar month, the cite sheet's back button)
    back: "M15.5 5 8.5 12l7 7",
    // House — the reading headers' way up to the book list
    home: "M3 11.5 12 4l9 7.5M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8",
  });

  /**
   * The glyph of a page-title icon control — the 24×24 stroked SVG every header
   * button / link draws (home → book list, up a level → the calendar month, the
   * cite sheet's back button). Only the path differs per icon
   * (`HEADER_ICON_PATHS`), so the header icon spec (viewBox, stroke, the
   * `title-back-icon` class) lives here once; the caller owns the element (a
   * `<button>` or an `<a>`) and what it does. No width / height: the
   * `.title-back-icon` rem rule in style.css sizes it (DESIGN.md).
   * @param {string} d  the icon's path data
   * @returns {SVGSVGElement}
   */
  function headerIcon(d) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "title-back-icon");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    return svg;
  }

  /**
   * A click the browser should handle itself — modifier keys or a non-primary
   * button mean "open in a new tab / window", so nothing should happen in this
   * page. The global <a> interceptor (routing.js) bails on exactly this; any
   * other click handler on a link (tab bar entries, a view remembering which
   * control was pressed) must bail on the same condition, or it acts on a
   * navigation that never happens here (PR #348 review).
   * @param {Event} e  a click — typed as Event so listeners on a plain Element can pass theirs as is
   * @returns {boolean}
   */
  function isModifiedClick(e) {
    const m = /** @type {MouseEvent} */ (e);
    return m.ctrlKey || m.metaKey || m.shiftKey || m.altKey || m.button !== 0;
  }

  /**
   * Scroll the page to `y` at once. The root's `scroll-behavior: smooth`
   * (style.css) is for gestures and in-page jumps, not for putting a redrawn
   * screen back where it was. `behavior: "instant"` overrides it — every engine
   * that takes scroll options has the value (views.js renderChapter's resume
   * scroll uses it too). An inline `scroll-behavior: auto` around a two-argument
   * scrollTo is not equivalent: Chromium skips the style update for a scroll to
   * (0, 0), so that one still animated.
   * @param {number} y
   */
  function scrollToInstantly(y) {
    if (Math.abs(window.scrollY - y) < 1) return;
    window.scrollTo({ top: y, behavior: "instant" });
  }

  // Whether the browser holds the visible content still when something above it changes size (CSS scroll
  // anchoring — Chrome · Edge · Firefox, Safari 27+). restoreFocusSpot depends on it.
  const SCROLL_ANCHORING = typeof CSS !== "undefined" && typeof CSS.supports === "function"
    && CSS.supports("overflow-anchor", "auto");

  /**
   * Where the pressed control of a same-view redraw sat (WCAG 2.4.3). A link
   * tagged `data-focus-key` redraws the view it belongs to — the router measures
   * it right before routing and, once the new screen committed, puts focus back
   * on its twin with `restoreFocusSpot` (routing.js). `data-focus-fallback` names
   * the control that takes over when the new screen has no twin (the date step
   * at the end of the computable range → 「오늘」, the search page link on the
   * last page → the other one). `root` is the container a redraw replaces
   * (#app): the offset within it serves the browsers without scroll anchoring.
   * A control outside it (the division tabs in the sticky header) has none.
   * @param {Element} a  the pressed link
   * @param {Event} e  its click
   * @param {Element | null} root
   * @returns {FocusSpot | null}  null for a link without `data-focus-key`
   */
  function focusSpotOf(a, e, root) {
    if (!(a instanceof HTMLElement) || !a.dataset.focusKey) return null;
    const top = a.getBoundingClientRect().top;
    return {
      key: a.dataset.focusKey,
      fallback: a.dataset.focusFallback || null,
      y: window.scrollY,
      top,
      offset: root && root.contains(a) ? top - root.getBoundingClientRect().top : null,
      // A pointer press (mouse, tap — `detail` counts the clicks) vs. Enter on the link (a synthetic click, detail 0;
      // settings-ui.js tells the two apart the same way).
      pointer: /** @type {MouseEvent} */ (e).detail > 0,
    };
  }

  /**
   * Put focus back on the twin of the pressed control (`focusSpotOf`) once the
   * new screen committed, at the same place on screen. Acts only when focus was
   * really lost — the pressed link left with the old screen, so focus fell back
   * to <body>; anywhere else means the reader moved on while a slow redraw was
   * loading (the header search, a popover, the tab bar), or the view placed
   * focus itself, and focus and scroll stay where they are.
   * @param {FocusSpot | null} spot
   * @param {Element | null} root  the container the redraw replaced (#app)
   * @returns {HTMLElement | null}  the control that took focus, or null
   */
  function restoreFocusSpot(spot, root) {
    if (!spot) return null;
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement) return null;
    // Compare dataset values rather than build a selector — keys are data (an observance id such as
    // `grid:lent-2-weekday-tue`), and a value comparison needs no escaping (a quoted selector would break
    // on a `"` or `\` in a key; colons and Hangul are fine either way).
    const tagged = Array.from(document.querySelectorAll("[data-focus-key]"));
    const find = (/** @type {string} */ key) =>
      tagged.find((n) => n instanceof HTMLElement && n.dataset.focusKey === key) || null;
    const target = find(spot.key) || (spot.fallback ? find(spot.fallback) : null);
    if (!(target instanceof HTMLElement)) return null;
    // Keep the control where it was on screen. A redraw that had to fetch
    // first painted the skeleton, which clamped the scroll to the top —
    // without this the pressed control jumps, and one far down (a segment
    // below the fold on a phone) comes back off-screen (2.4.7). The clamp can
    // also re-expand the desktop header's search row (views.js
    // initCompactHeader), which collapses again once the page is back down.
    // With scroll anchoring the browser holds the content still through that
    // collapse, so the control goes to its click-time viewport top in today's
    // layout; without it (Safari before 27) the collapse itself moves the
    // content, so the control goes back to its offset within the root. A
    // control outside the root (sticky) keeps its place by itself.
    const r0 = target.getBoundingClientRect();
    if (SCROLL_ANCHORING) {
      scrollToInstantly(window.scrollY + r0.top - spot.top);
    } else if (spot.offset !== null && root && root.contains(target)) {
      scrollToInstantly(spot.y + (r0.top - root.getBoundingClientRect().top) - spot.offset);
    }
    // Focus goes back after every press — keyboard and VoiceOver users follow it — but a pointer press must not
    // leave a ring: WebKit (iOS) focuses nothing on a tap, so a script focus afterwards counts as focus-visible and
    // draws the accent outline (the book-list cards hit the same, 43db624). `focusVisible: false` (Safari 18.4+ ·
    // Chrome 145+ · Firefox 104+; older engines ignore the option) keeps the focus without the ring.
    target.focus(spot.pointer ? { preventScroll: true, focusVisible: false } : { preventScroll: true });
    // Still off-screen: the control was already out of view when it was activated (a keyboard user read on
    // with Space / Page Down, focus left on the link, then pressed Enter), or — without scroll anchoring —
    // the re-expanded header pushed it below the fold. Bring it to the middle. (A shorter page never does
    // this: the scroll clamp only moves an in-flow control toward the viewport.)
    const r = target.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) target.scrollIntoView({ block: "center", behavior: "instant" });
    return target;
  }

  return {
    _$, chUnit, el, clearNode, hangingQuoteClass, setInert, trapFocus, dragReleaseAction, emptyState, headerIcon,
    HEADER_ICON_PATHS, isModifiedClick, focusSpotOf, restoreFocusSpot,
  };
})();

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
