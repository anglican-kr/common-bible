"use strict";
// @ts-check

// Overlay/dialog lifecycle controller (ADR-032). One factory gathers the
// open/close + `.hidden` toggle + scrim + trapFocus + Escape + setInert +
// focus-restore plumbing that was hand-rolled at 12 call sites (bookmark
// modals/drawer, install modal, cite sheet, settings/chapter popovers). Built
// on `window.appHelpers` primitives — no framework, no deps. IIFE + window
// namespace mirrors helpers.js (ADR-018) + ESM marker (ADR-019).
//
// Migration note: this is introduced one overlay at a time (ADR-032 "점진
// 교체"). The Escape key is *opt-in* per overlay (`closeOnEsc`) precisely so a
// freshly-migrated dialog can keep deferring to a pre-existing stacked Escape
// router (e.g. bookmark.js's document-level handler that closes the topmost of
// confirm > chapter-delete > import > merge > save > drawer) until every
// sibling migrates and that router can be retired wholesale. Turning closeOnEsc
// on while such a router still runs would double-handle Escape and close the
// dialog *and* whatever sits beneath it.

window.appOverlay = (() => {
  const { setInert, trapFocus, dragReleaseAction } = window.appHelpers;

  /**
   * @typedef {Object} OverlayOptions
   * @property {HTMLElement} panel  Dialog root; shown/hidden via `.hidden`.
   * @property {HTMLElement | null} [scrim]  Optional backdrop, toggled with the panel.
   * @property {string | null} [inertSelectors]  Background `inert` targets (delegated to `setInert`).
   * @property {string | null} [rootClass]  Class added to `<html>` while open (e.g. cite sheet).
   * @property {boolean} [closeOnEsc]  Escape (document keydown) closes. Default false — see migration note.
   * @property {boolean} [closeOnOutside]  Click outside the panel closes (popovers). Default false.
   * @property {string | null} [outsideIgnore]  Selector of trigger(s) to ignore on outside-click (so the toggle button doesn't reopen).
   * @property {HTMLElement} [trapContainer]  Focus-trap root; defaults to `panel`.
   * @property {(() => (HTMLElement | null)) | HTMLElement | string | null} [initialFocus]  Focused after open (next frame).
   * @property {boolean | HTMLElement} [returnFocus]  Restore focus on close. `true` (default) = element focused just before open; or an explicit element.
   * @property {string | null} [ariaExpanded]  Selector of trigger(s) whose `aria-expanded` mirrors the open state.
   * @property {(() => void) | null} [onOpen]
   * @property {(() => void) | null} [onClose]  Runs before focus restore, so it can tear down child state first.
   * @property {((panel: HTMLElement, finalizeHide: () => void) => void) | null} [closeTransition]
   *   Animated/async dismiss. When set, close() runs the logical close
   *   immediately (scrim hide, inert off, trap/listener teardown, onClose, focus
   *   restore) but DEFERS `panel.hidden = true` to `finalizeHide` — call it when
   *   the exit animation ends. A re-open before then cancels the pending hide
   *   (sequence-guarded), so rapid close→open never hides the freshly reopened
   *   panel. Without it, the panel hides synchronously.
   */

  /**
   * Build a controller for a single overlay. Returns stable `open`/`close`
   * handles plus an `isOpen` getter; both are idempotent (re-`open` while open
   * or `close` while closed is a no-op).
   *
   * @param {OverlayOptions} opts
   * @returns {{ open: (returnFocusEl?: HTMLElement | null) => void, close: () => void, readonly isOpen: boolean }}
   */
  function createOverlay(opts) {
    const {
      panel,
      scrim = null,
      inertSelectors = null,
      rootClass = null,
      closeOnEsc = false,
      closeOnOutside = false,
      outsideIgnore = null,
      trapContainer = undefined,
      initialFocus = null,
      returnFocus = true,
      ariaExpanded = null,
      onOpen = null,
      onClose = null,
      closeTransition = null,
    } = opts;

    let _open = false;
    // Monotonic guard bumped on every open + close. A deferred (animated) hide
    // captures the seq at close time and only fires if it's still current —
    // a re-open (which bumps the seq) cancels a pending hide.
    let _seq = 0;
    /** @type {(() => void) | null} */
    let _trapCleanup = null;
    /** @type {HTMLElement | null} */
    let _returnTarget = null;
    /** @type {((e: KeyboardEvent) => void) | null} */
    let _escHandler = null;
    /** @type {((e: MouseEvent) => void) | null} */
    let _outsideHandler = null;

    /** @param {"true" | "false"} val */
    function setAriaExpanded(val) {
      if (!ariaExpanded) return;
      document.querySelectorAll(ariaExpanded).forEach((t) => t.setAttribute("aria-expanded", val));
    }

    /** @returns {HTMLElement | null} */
    function resolveInitialFocus() {
      if (!initialFocus) return null;
      if (typeof initialFocus === "function") return initialFocus();
      if (typeof initialFocus === "string") {
        return /** @type {HTMLElement | null} */ (panel.querySelector(initialFocus));
      }
      return initialFocus;
    }

    /**
     * @param {HTMLElement | null} [explicitReturn]  Override the focus-restore
     *   target (else the element focused just before open, when returnFocus).
     */
    function open(explicitReturn) {
      if (_open) return;
      _open = true;
      _seq++; // cancel any pending deferred hide from a prior animated close

      _returnTarget =
        explicitReturn !== undefined
          ? explicitReturn
          : returnFocus === true
            ? /** @type {HTMLElement | null} */ (document.activeElement)
            : returnFocus instanceof HTMLElement
              ? returnFocus
              : null;

      if (scrim) scrim.hidden = false;
      panel.hidden = false;
      if (rootClass) document.documentElement.classList.add(rootClass);
      if (inertSelectors) setInert(true, inertSelectors);
      setAriaExpanded("true");

      _trapCleanup = trapFocus(trapContainer || panel);

      if (closeOnEsc) {
        _escHandler = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close();
          }
        };
        document.addEventListener("keydown", _escHandler);
      }

      if (closeOnOutside) {
        // Attach next frame so the very click that opened the overlay doesn't
        // bubble straight into this handler and close it immediately.
        requestAnimationFrame(() => {
          if (!_open) return;
          _outsideHandler = (e) => {
            const t = e.target;
            if (t instanceof Node && panel.contains(t)) return;
            if (outsideIgnore && t instanceof Element && t.closest(outsideIgnore)) return;
            close();
          };
          document.addEventListener("click", _outsideHandler);
        });
      }

      if (onOpen) onOpen();

      requestAnimationFrame(() => {
        const target = resolveInitialFocus();
        if (target && typeof target.focus === "function") target.focus();
      });
    }

    function close() {
      if (!_open) return;
      _open = false;
      const mySeq = ++_seq;

      // Logical close runs immediately regardless of animation: the scrim,
      // background inert, focus trap, listeners and focus are all released now
      // so the app is interactive even while an exit animation plays.
      if (scrim) scrim.hidden = true;
      if (rootClass) document.documentElement.classList.remove(rootClass);
      if (inertSelectors) setInert(false, inertSelectors);
      setAriaExpanded("false");

      if (_trapCleanup) { _trapCleanup(); _trapCleanup = null; }
      if (_escHandler) { document.removeEventListener("keydown", _escHandler); _escHandler = null; }
      if (_outsideHandler) { document.removeEventListener("click", _outsideHandler); _outsideHandler = null; }

      if (onClose) onClose();

      if (_returnTarget && typeof _returnTarget.focus === "function") {
        // Guard: a re-render in onClose may have detached the element.
        try { _returnTarget.focus(); } catch { /* element gone — ignore */ }
      }
      _returnTarget = null;

      // Hide the panel: synchronously by default, or deferred to the exit
      // animation when closeTransition is set. The seq guard drops the hide if
      // the overlay was reopened in the meantime.
      if (closeTransition) {
        closeTransition(panel, () => { if (mySeq === _seq) panel.hidden = true; });
      } else {
        panel.hidden = true;
      }
    }

    return {
      open,
      close,
      get isOpen() { return _open; },
    };
  }

  // ── Bottom-sheet drag plumbing (ADR-032 §2) ─────────────────────────────────
  // Shared pointer batching for drag-resizable bottom sheets, factored out of
  // the bookmark drawer + cite sheet (which previously hand-rolled identical
  // pointerdown→capture→move→up handlers, sharing only the pure
  // `dragReleaseAction`). The lifecycle (open/close, scrim, focus) is the
  // overlay's / caller's concern; this only wires the drag gesture.

  /**
   * Drag the sheet's top handle to resize, and release to close / snap-min /
   * stay (mobile only; desktop ≥769px uses a fixed side panel and is a no-op).
   * The move clamp's lower bound is 0 (NOT the rest min) so the user can drag
   * visually below the rest height — that's the affordance the snap-close
   * gesture needs, and a hard rest-min clamp would make `dragReleaseAction`'s
   * close branch unreachable (Bugbot caught exactly that regression).
   *
   * @param {HTMLElement} handle
   * @param {HTMLElement} sheet
   * @param {{ onClose: () => void, maxRatio?: number }} opts
   *   onClose runs when the release gesture decides "close"; the caller owns the
   *   actual dismiss (and any inline-height reset). maxRatio caps the dragged
   *   height as a fraction of viewport height (default 0.9).
   */
  function attachSheetDrag(handle, sheet, { onClose, maxRatio = 0.9 }) {
    let startY = 0;
    let startH = 0;
    /** @param {number} clientY */
    function onMove(clientY) {
      const delta = startY - clientY;
      const newH = Math.min(Math.max(startH + delta, 0), window.innerHeight * maxRatio);
      sheet.style.height = `${newH}px`;
    }
    /** @param {PointerEvent} e */
    function onPointerMove(e) { onMove(e.clientY); }
    function onPointerUp() {
      handle.removeEventListener("pointermove", onPointerMove);
      const action = dragReleaseAction(sheet.offsetHeight, window.innerHeight);
      if (action === "close") onClose();
      else if (action === "snap-min") sheet.style.height = `${window.innerHeight * 0.3}px`;
    }
    handle.addEventListener("pointerdown", (e) => {
      if (window.innerWidth >= 769) return; // desktop: fixed-size side panel
      e.preventDefault();
      startY = e.clientY;
      startH = sheet.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp, { once: true });
    });
  }

  /**
   * Desktop-only (≥769px): drag a left-edge handle to resize the side panel's
   * width. Drag left widens; clamp to [minWidth, maxRatio·viewport-width].
   * Mobile (<769px) is a no-op (the sheet is a bottom drawer there).
   *
   * @param {HTMLElement} handle
   * @param {HTMLElement} sheet
   * @param {{ minWidth?: number, maxRatio?: number }} [opts]
   */
  function attachSheetResize(handle, sheet, { minWidth = 240, maxRatio = 0.85 } = {}) {
    let startX = 0;
    let startW = 0;
    /** @param {PointerEvent} e */
    function onPointerMove(e) {
      const delta = startX - e.clientX; // drag left = wider
      const newW = Math.min(Math.max(startW + delta, minWidth), window.innerWidth * maxRatio);
      sheet.style.width = `${newW}px`;
    }
    function onPointerUp() {
      handle.removeEventListener("pointermove", onPointerMove);
    }
    handle.addEventListener("pointerdown", (e) => {
      if (window.innerWidth < 769) return; // mobile: bottom sheet, no width resize
      e.preventDefault();
      startX = e.clientX;
      startW = sheet.offsetWidth;
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp, { once: true });
    });
  }

  return { createOverlay, attachSheetDrag, attachSheetResize };
})();

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
