"use strict";
// @ts-check

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

  return { _$, chUnit, el, clearNode, setInert, trapFocus, dragReleaseAction, emptyState };
})();

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
