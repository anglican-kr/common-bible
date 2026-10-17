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

/** @typedef {import("../types").FocusSpot} FocusSpot */
/** @typedef {import("../types").FocusMemory} FocusMemory */

window.appHelpers = (() => {
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
   * The glyph of a page-title icon control — the 24×24 stroked SVG every header
   * button / link draws (home → book list, up a level → the calendar month).
   * Only the path differs per icon, so the header icon spec (viewBox, stroke,
   * the `title-back-icon` class) lives here once; the caller owns the element
   * (a `<button>` or an `<a>`) and what it does. No width / height: the
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
   * screen back where it was; an inline `auto` for the call (a CSSOM write —
   * the CSP allows it) makes the plain two-argument scrollTo instant.
   * @param {number} y
   */
  function scrollToInstantly(y) {
    if (Math.abs(window.scrollY - y) < 1) return;
    const root = document.documentElement;
    const prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    try {
      window.scrollTo(0, y);
    } finally {
      root.style.scrollBehavior = prev;
    }
  }

  /**
   * Focus memory for a view whose own links redraw the whole screen (WCAG
   * 2.4.3 — PR #348 review). route() empties #app before the new screen
   * commits, so the pressed link is gone and focus falls back to <body>: a
   * keyboard or screen-reader user would walk back from the skip link after
   * every press. The view tags those links with `data-focus-key`, listens with
   * `remember` on its root (the click reaches it before the global <a>
   * interceptor on document), `take`s the spot when its render starts (one
   * render per press — a stale or failed render drops it) and hands the new
   * root to `restore` after committing. Each view makes its own memory, so a
   * spot one screen remembered never lands on another screen's control (a
   * press overtaken by a tab switch).
   * @returns {FocusMemory}
   */
  function createFocusMemory() {
    /** @type {FocusSpot | null} */
    let pending = null;
    return {
      remember(e) {
        if (isModifiedClick(e)) return;   // a new tab / window — this page does not redraw
        const t = e.target;
        const root = e.currentTarget;
        const a = t instanceof Element ? t.closest("a[data-focus-key]") : null;
        pending = a instanceof HTMLElement && a.dataset.focusKey && root instanceof Element
          ? { key: a.dataset.focusKey, y: window.scrollY, offset: a.getBoundingClientRect().top - root.getBoundingClientRect().top }
          : null;
      },
      take() {
        const spot = pending;
        pending = null;
        return spot;
      },
      restore(root, spot, fallbackKey) {
        if (!spot) return null;
        // Compare dataset values, not a selector string — keys carry colons and
        // Hangul (an observance id such as `grid:lent-2-weekday-tue`).
        const tagged = Array.from(root.querySelectorAll("[data-focus-key]"));
        const find = (/** @type {string} */ key) =>
          tagged.find((n) => n instanceof HTMLElement && n.dataset.focusKey === key) || null;
        // No twin (the step that led here is gone at the end of the computable range) → the fallback control.
        const target = find(spot.key) || (fallbackKey ? find(fallbackKey) : null);
        if (!(target instanceof HTMLElement)) return null;
        // Keep the control where it was on screen. A redraw that had to fetch
        // first painted the skeleton, which clamped the scroll to the top —
        // without this the pressed control jumps, and one far down (a segment
        // below the fold on a phone) comes back off-screen (2.4.7). Offsets are
        // taken within the view root, so the header collapsing or expanding on
        // the way does not skew them.
        const offset = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
        scrollToInstantly(spot.y + offset - spot.offset);
        target.focus({ preventScroll: true });
        // Still nowhere on screen (the page came back much shorter) — bring it to the middle.
        const r = target.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) {
          scrollToInstantly(window.scrollY + r.top - (window.innerHeight - r.height) / 2);
        }
        return target;
      },
    };
  }

  return {
    _$, chUnit, el, clearNode, hangingQuoteClass, setInert, trapFocus, dragReleaseAction, emptyState, headerIcon,
    isModifiedClick, createFocusMemory,
  };
})();

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
