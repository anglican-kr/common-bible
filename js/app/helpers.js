"use strict";
// @ts-check

// Common DOM helpers used by all app modules. Anchored to `window.appHelpers`
// so other modules can `const { el } = window.appHelpers;` after defer load.
//
// Module pattern: IIFE + window namespace, mirrors the sync layer
// (`window.driveSync`/`window.syncTransport`). See ADR-018 + design doc
// `docs/design/app-modularization.md`.
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

  return { _$, chUnit, el, clearNode, trapFocus };
})();
