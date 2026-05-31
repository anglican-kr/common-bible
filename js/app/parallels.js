"use strict";
// @ts-check

// ADR-027 chapter-level parallel-passage marker — footnote-anchor rendering.
//
// A `<parallel src="2사무 5:1-10" range="11:1-9"/>` marker in source markdown
// becomes a `ChapterParallel` entry in `chapter.parallels` (data pipeline,
// ADR-027 Phase 1). This module renders a small `※` anchor at the start of
// the first verse of each parallel's `range`. Clicking the anchor opens a
// note-style tooltip whose body shows the parallel range + clickable source
// reference(s); clicking a reference opens the existing cite-sheet
// (`appCitations.openCiteSheet`) to load the parallel passage(s).
//
// ADR-027 §2 개정 (post dev-review, 2026-05-31): the initial banner design
// was replaced with this footnote-anchor pattern after dev review showed
// banners weren't communicating per-paragraph parallels well in chapters
// with multiple parallel sections. The footnote pattern reuses the existing
// `※` variant-marker convention readers already understand from notes.
//
// Visibility is governed by the same `bible-cite-show` localStorage toggle as
// cite chips (`body.cites-shown`) — anchors hide when the user turns off the
// "인용 본문·주석" setting. No separate toggle.
//
// Cross-module dependencies:
//   - window.appHelpers: el (DOM builder)
//   - window.appCitations: openNoteTooltip, closeNoteTooltip, openCiteSheet

window.appParallels = (() => {
  /** @typedef {import("../types").ChapterParallel} ChapterParallel */
  /** @typedef {import("../types").CiteParallelRef} CiteParallelRef */

  const { el } = window.appHelpers;

  // ADR-027 §2 range grammar — same shape as cite src verse-spec.
  const _RANGE_RE = /^(\d+)(?::(\d+)(?:-(?:(\d+):)?(\d+))?)?$/;

  // The parallel-marker glyph. Intentionally identical to note-anchor--variant
  // so readers see one consistent "this verse carries supplementary info" cue.
  const PARALLEL_GLYPH = "※";

  /**
   * Parse a `range` attribute value into structured chapter/verse bounds.
   *
   * @param {string} range
   * @returns {{ startCh: number, startV: number, endCh: number, endV: number | null } | null}
   */
  function parseRange(range) {
    const m = _RANGE_RE.exec(range);
    if (!m) return null;
    const startCh = parseInt(m[1], 10);
    const startV  = m[2] ? parseInt(m[2], 10) : 1;
    const endCh   = m[3] ? parseInt(m[3], 10) : startCh;
    const endV    = m[4] ? parseInt(m[4], 10) : (m[2] ? startV : null);
    return { startCh, startV, endCh, endV };
  }

  /**
   * Compose tooltip body parts: ["1역대 11:1-9", " 참조"] for single-src;
   * link element(s) interspersed for multi-src. Each ref becomes a clickable
   * `<button class="parallel-tooltip-ref">` carrying the ref + tradition in
   * data-* attrs. The terminating " 참조" word ties the references to the
   * "see also" wording the user requested.
   *
   * @param {ChapterParallel} parallel
   * @returns {Array<string | HTMLElement>}
   */
  function buildTooltipBody(parallel) {
    /** @type {Array<string | HTMLElement>} */
    const parts = [];
    const srcs = parallel.src || [];
    for (let i = 0; i < srcs.length; i++) {
      if (i > 0) parts.push(" · ");
      parts.push(_buildRefLink(srcs[i]));
    }
    if (srcs.length) parts.push(" 참조");
    return parts;
  }

  /**
   * @param {CiteParallelRef} ref
   * @returns {HTMLElement}
   */
  function _buildRefLink(ref) {
    const label = (ref.tradition ? `${ref.tradition} ` : "") + ref.ref;
    return el("button", {
      type: "button",
      className: "parallel-tooltip-ref",
      "data-parallel-ref": ref.ref,
      ...(ref.tradition ? { "data-parallel-ref-tradition": ref.tradition } : {}),
      "aria-label": `${label} 본문 보기`,
    }, label);
  }

  /**
   * Build the start-of-section anchor element for one parallel marker.
   *
   * `<button class="parallel-anchor">※</button>` with structured payload on
   * data-* attrs so the click handler can rebuild the tooltip body without
   * re-walking chapter data.
   *
   * @param {ChapterParallel} parallel
   * @returns {HTMLElement}
   */
  function buildParallelAnchor(parallel) {
    /** @type {Record<string, string>} */
    const attrs = {
      type: "button",
      className: "parallel-anchor",
      "data-parallel-range": parallel.range,
      "data-parallel-src": _serializeSrc(parallel.src || []),
      "aria-label": `${parallel.range} 병행 본문 안내`,
    };
    return el("button", attrs, PARALLEL_GLYPH);
  }

  /**
   * Serialize parallel `src` for the data attribute using the same
   * `[전통]` inline notation as source markdown / cite chips.
   *
   * @param {ReadonlyArray<CiteParallelRef>} src
   * @returns {string}
   */
  function _serializeSrc(src) {
    return src
      .map((r) => (r.tradition ? `${r.ref} [${r.tradition}]` : r.ref))
      .join(";");
  }

  // Round-trip inverse of `_serializeSrc`. Same shape as the regex used by
  // citations.js's `_parseParallelsAttr` — kept local so the two modules stay
  // independent.
  const _PARALLEL_TRADITION_RE = /^(.+?)\s*\[([^\[\]]+)\]\s*$/;

  /**
   * @param {string | null} raw
   * @returns {Array<CiteParallelRef>}
   */
  function _parseSrcAttr(raw) {
    if (!raw) return [];
    const out = [];
    for (const part of raw.split(";")) {
      const s = part.trim();
      if (!s) continue;
      const m = _PARALLEL_TRADITION_RE.exec(s);
      out.push(m ? { ref: m[1].trim(), tradition: m[2].trim() } : { ref: s });
    }
    return out;
  }

  /**
   * Find every parallel whose range starts at the given (chapter, verse). Plural
   * because ADR-027 §2 (개정 2026-05-31) allows range 중첩 — two markers may
   * legitimately share a start verse (e.g. the outer "5:11-25" and the inner
   * "5:11-20" both start at v11). Each match renders its own ※ anchor.
   *
   * `currentChapter` (optional but recommended) guards against rendering a ※
   * on a verse number that happens to match a parallel whose range belongs to
   * a different chapter — parser cross-check normally prevents this but defense
   * in depth keeps stray data from polluting the UI.
   *
   * @param {ReadonlyArray<ChapterParallel> | null | undefined} parallels
   * @param {number} verseNumber
   * @param {number} [currentChapter]
   * @returns {Array<ChapterParallel>}
   */
  function findParallelsStartingAt(parallels, verseNumber, currentChapter) {
    if (!parallels || !parallels.length) return [];
    const out = [];
    for (const p of parallels) {
      const r = parseRange(p.range);
      if (!r) continue;
      if (r.startV !== verseNumber) continue;
      if (currentChapter !== undefined && r.startCh !== currentChapter) continue;
      out.push(p);
    }
    return out;
  }

  // Track the ※ anchor whose tooltip is currently open. When the user clicks a
  // ref link inside that tooltip, focus must restore to the anchor (which
  // stays in the verse and remains focusable) rather than to the link itself
  // (which lives inside the about-to-close tooltip — closeCiteSheet then can't
  // restore focus to a visible control). Cleared in closeNoteTooltip-equivalent
  // paths by the next openCiteSheet call sequencing.
  /** @type {HTMLElement | null} */
  let _activeAnchor = null;

  /**
   * Open the tooltip for a parallel anchor: title = range, body = clickable
   * reference link(s). Reuses citations.openNoteTooltip's positioning logic
   * (same DOM `#note-tooltip` element, same scroll-follow). The body's link
   * elements get a delegated click handler (initParallels) that opens the
   * cite-sheet for the chosen reference.
   *
   * @param {HTMLElement} anchorEl
   */
  function _openTooltipForAnchor(anchorEl) {
    const range = anchorEl.getAttribute("data-parallel-range") || "";
    const refs = _parseSrcAttr(anchorEl.getAttribute("data-parallel-src"));
    const cites = window.appCitations;
    if (!cites || typeof cites.openNoteTooltip !== "function") return;
    const parallel = { src: refs, range };
    _activeAnchor = anchorEl;
    cites.openNoteTooltip(anchorEl, range, buildTooltipBody(parallel));
  }

  /**
   * Wire the delegated click + keyboard handlers. Two delegations:
   *   1. `.parallel-anchor` (the ※ marker) → open tooltip
   *   2. `.parallel-tooltip-ref` (link inside tooltip body) → openCiteSheet
   *      for that ref, then close the tooltip
   *
   * Body-level delegation lets us handle the anchor and tooltip-link in one
   * place without per-render listeners.
   */
  /**
   * Forward a ref-link activation to the cite-sheet, then close the tooltip.
   * `returnFocusEl` is the ※ anchor that opened the tooltip (tracked in
   * `_activeAnchor`) rather than the link itself, so when the cite-sheet
   * closes focus restores to a visible, in-document control. Falls back to
   * the link only when the active anchor is unavailable (defensive — should
   * not happen in normal flow since the link only exists inside an open tooltip).
   *
   * @param {HTMLElement} refLink
   */
  function _activateRefLink(refLink) {
    const ref = refLink.getAttribute("data-parallel-ref");
    if (!ref) return;
    const tradition = refLink.getAttribute("data-parallel-ref-tradition") || null;
    const cites = window.appCitations;
    if (!cites) return;
    const returnFocus = _activeAnchor || refLink;
    if (typeof cites.openCiteSheet === "function") {
      void cites.openCiteSheet(ref, null, tradition, returnFocus);
    }
    if (typeof cites.closeNoteTooltip === "function") {
      cites.closeNoteTooltip();
    }
    _activeAnchor = null;
  }

  function initParallels() {
    document.body.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const refLink = target.closest(".parallel-tooltip-ref");
      if (refLink instanceof HTMLElement) {
        _activateRefLink(refLink);
        return;
      }

      const anchor = target.closest(".parallel-anchor");
      if (anchor instanceof HTMLElement) {
        _openTooltipForAnchor(anchor);
        return;
      }

      // Click that misses anchor + ref-link likely closes the tooltip via
      // citations.js's outside-click logic — drop the tracked anchor so a
      // later ref-link activation (without re-opening a tooltip) doesn't
      // stale-restore focus to a now-irrelevant anchor.
      if (_activeAnchor && !target.closest("#note-tooltip")) {
        _activeAnchor = null;
      }
    });

    document.addEventListener("keydown", (e) => {
      // ESC closes the tooltip via citations.js — clear the active anchor so
      // it doesn't linger past tooltip lifetime.
      if (e.key === "Escape") {
        _activeAnchor = null;
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("parallel-anchor")) {
        e.preventDefault();
        _openTooltipForAnchor(target);
      } else if (target.classList.contains("parallel-tooltip-ref")) {
        e.preventDefault();
        _activateRefLink(target);
      }
    });
  }

  return {
    parseRange,
    buildTooltipBody,
    buildParallelAnchor,
    findParallelsStartingAt,
    initParallels,
  };
})();

// ESM module marker (ADR-019)
export {};
