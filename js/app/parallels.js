"use strict";
// @ts-check

// ADR-027 chapter-level parallel-passage banner.
//
// A `<parallel src="2사무 5:1-10" range="11:1-9"/>` marker in source markdown
// becomes a `ChapterParallel` entry in `chapter.parallels` (data pipeline,
// ADR-027 Phase 1). This module renders a small banner immediately before the
// first verse of each parallel's `range`. Clicking the banner opens the
// existing cite-sheet (`appCitations.openCiteSheet`) so the parallel passage(s)
// load in the same sheet UI that cite chips use — one infrastructure, two
// entry points.
//
// Visibility is governed by the same `bible-cite-show` localStorage toggle as
// cite chips (`body.cites-shown`) — banners hide when the user turns off the
// "인용 본문·주석" setting. No separate toggle.
//
// Cross-module dependencies:
//   - window.appHelpers: el (DOM builder)
//   - window.appCitations: openCiteSheet (delegated click target)

window.appParallels = (() => {
  /** @typedef {import("../types").ChapterParallel} ChapterParallel */
  /** @typedef {import("../types").CiteParallelRef} CiteParallelRef */

  const { el } = window.appHelpers;

  // ADR-027 §2 range grammar — same shape as cite src verse-spec.
  // Captures: (start_ch, start_v?, end_ch?, end_v?).
  // - "11"          → startCh=11, startV=1, endCh=11, endV=null (whole chapter)
  // - "11:1"        → startCh=11, startV=1, endCh=11, endV=1
  // - "11:1-9"      → startCh=11, startV=1, endCh=11, endV=9
  // - "11:1-12:5"   → startCh=11, startV=1, endCh=12, endV=5
  const _RANGE_RE = /^(\d+)(?::(\d+)(?:-(?:(\d+):)?(\d+))?)?$/;

  /**
   * Parse a `range` attribute value into structured chapter/verse bounds.
   * Returns null when the string is malformed (caller skips banner).
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
   * Compose banner label "병행: src1 · src2 …".
   * Each src's tradition (if present) prefixes its ref — mirrors the cite-chip
   * label format from ADR-022 §2 per-parallel tradition (`(칠십인역 시편 16:8)`).
   *
   * @param {ChapterParallel} parallel
   * @returns {string}
   */
  function bannerText(parallel) {
    const parts = (parallel.src || []).map((r) =>
      (r.tradition ? `${r.tradition} ` : "") + r.ref,
    );
    return parts.length ? `병행: ${parts.join(" · ")}` : "병행";
  }

  /**
   * Build the banner DOM element for one parallel marker.
   *
   * Rendered as `<aside class="parallel-banner" role="button" tabindex="0">`
   * with the structured payload stashed on `data-*` attrs so the delegated
   * click listener (initParallels) can rehydrate without re-parsing chapter
   * data. ARIA: `<aside>` implicitly maps to `role="complementary"`, but
   * because the banner is clickable we override with `role="button"`.
   *
   * @param {ChapterParallel} parallel
   * @returns {HTMLElement}
   */
  function buildParallelBanner(parallel) {
    const label = bannerText(parallel);
    /** @type {Record<string, string>} */
    const attrs = {
      role: "button",
      tabindex: "0",
      className: "parallel-banner",
      "data-parallel-range": parallel.range,
      "data-parallel-src": _serializeSrc(parallel.src || []),
      "aria-label": `${label} — 본문 보기`,
    };
    return el("aside", attrs, label);
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

  // Round-trip inverse of `_serializeSrc`. Lives next to citations.js's
  // `_parseParallelsAttr` (same regex shape) but kept local so the two modules
  // stay independent.
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
   * Find the parallel (if any) whose range starts at the given verse number.
   * Returns null when no parallel begins there. The renderer calls this for
   * each verse and inserts a banner before the verse on a non-null result.
   *
   * @param {ReadonlyArray<ChapterParallel> | null | undefined} parallels
   * @param {number} verseNumber
   * @returns {ChapterParallel | null}
   */
  function findParallelStartingAt(parallels, verseNumber) {
    if (!parallels || !parallels.length) return null;
    for (const p of parallels) {
      const r = parseRange(p.range);
      if (r && r.startV === verseNumber) return p;
    }
    return null;
  }

  /**
   * Wire the delegated click + keyboard handlers. Clicking a banner opens
   * the existing cite-sheet via `appCitations.openCiteSheet` — banner's
   * `src` entries become the sheet's primary + parallels (no `tradition`
   * argument at the sheet level since per-source tradition rides on each
   * src entry, matching the ADR-022 §2 개정 model).
   *
   * The first src entry becomes the sheet's primary `src`; subsequent
   * entries become the sheet's `parallels` list. When there is only one
   * src, the sheet shows that one passage with no parallels divider.
   */
  function initParallels() {
    const open = (banner) => {
      if (!(banner instanceof HTMLElement)) return;
      const srcRaw = banner.getAttribute("data-parallel-src") || "";
      const refs = _parseSrcAttr(srcRaw);
      if (!refs.length) return;
      const [primary, ...rest] = refs;
      const sheet = window.appCitations;
      if (!sheet || typeof sheet.openCiteSheet !== "function") return;
      const primaryTradition = primary.tradition || null;
      const parallelEntries = rest.length ? rest : null;
      void sheet.openCiteSheet(primary.ref, parallelEntries, primaryTradition, banner);
    };

    document.body.addEventListener("click", (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const banner = target.closest(".parallel-banner");
      if (banner instanceof HTMLElement) open(banner);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.classList.contains("parallel-banner")) return;
      e.preventDefault();
      open(target);
    });
  }

  return {
    parseRange,
    bannerText,
    buildParallelBanner,
    findParallelStartingAt,
    initParallels,
  };
})();

// ESM module marker (ADR-019)
export {};
