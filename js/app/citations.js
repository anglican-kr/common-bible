"use strict";
// @ts-check

// ADR-022 citation + annotation chip rendering helpers.
//
// Phase 2 C2 scope (this file):
//   - _computeCiteShowPositions: dedup consecutive same-cite verses → only
//     the LAST emits a chip (ADR-022 §6 dedup rule).
//   - buildCiteChip: build a clickable chip showing src + optional parallels
//     + optional tradition.
//   - buildNoteElement: build a verse-attached annotation paragraph.
//
// Click wiring (cite chip → bottom sheet) lives in C3 (cite-sheet logic),
// also added to this module. C2 only renders chips with data-* attrs that
// C3's delegated click listener will read.
//
// Cross-module dependencies:
//   - window.appHelpers: el (DOM builder)

window.appCitations = (() => {
  /** @typedef {import("../types").BibleVerseSegment} BibleVerseSegment */
  /** @typedef {import("../types").BibleVerse} BibleVerse */
  /** @typedef {import("../types").BibleVerseNote} BibleVerseNote */

  const { el } = window.appHelpers;

  /**
   * For each `(verseIndex, segmentIndex)` whose segment has a `cite`, decide
   * whether that segment should render a chip. Per ADR-022 §6: when consecutive
   * cite segments share `(src, tradition, parallels)`, only the LAST emits a
   * chip — earlier ones suppress (visually merged into one citation unit).
   *
   * Adjacency rule: a "consecutive" group means cite segments either in the
   * same verse or in immediately neighboring verses (no gap verse in between).
   *
   * @param {ReadonlyArray<BibleVerse>} verses
   * @returns {Set<string>} keys of the form `"<vi>:<si>"` that SHOULD render
   */
  function _computeCiteShowPositions(verses) {
    const flat = [];
    verses.forEach((v, vi) => {
      const segs = v.segments || [];
      segs.forEach((s, si) => {
        if (s.cite) {
          flat.push({
            vi, si,
            src: s.cite,
            tr: s.tradition || null,
            // Stringify parallels list for cheap equality comparison.
            par: s.parallels ? s.parallels.join("|") : "",
            vNum: v.number,
          });
        }
      });
    });

    const showAt = new Set();
    for (let i = 0; i < flat.length; i++) {
      const cur = flat[i];
      const next = flat[i + 1];
      const sameGroup = next
        && cur.src === next.src
        && cur.tr  === next.tr
        && cur.par === next.par
        && (next.vNum === cur.vNum || next.vNum === cur.vNum + 1);
      if (!sameGroup) showAt.add(`${cur.vi}:${cur.si}`);
    }
    return showAt;
  }

  /**
   * Compose the chip text "(src · tradition · parallel1 · parallel2 …)".
   * tradition (if present) follows src; parallels follow tradition.
   *
   * @param {string} src
   * @param {ReadonlyArray<string> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @returns {string}
   */
  function chipText(src, parallels, tradition) {
    const parts = [src];
    if (tradition) parts.push(tradition);
    if (parallels && parallels.length) parts.push(...parallels);
    return `(${parts.join(" · ")})`;
  }

  /**
   * Build a chip element. Render style depends on segment type:
   *   - "poetry" → block-style chip on its own line (ADR-022 §6 운문 예외)
   *   - "prose"  → inline chip following the segment text
   *
   * The chip is a `<button>` for keyboard accessibility. Data attributes
   * carry src/tradition/parallels for the C3 click delegation.
   *
   * @param {string} src
   * @param {ReadonlyArray<string> | null | undefined} parallels
   * @param {string | null | undefined} tradition
   * @param {"prose" | "poetry"} segmentType
   * @returns {HTMLElement}
   */
  function buildCiteChip(src, parallels, tradition, segmentType) {
    const label = chipText(src, parallels, tradition);
    const cls = segmentType === "poetry" ? "cite-chip cite-chip--poetry" : "cite-chip";
    /** @type {Record<string, string>} */
    const attrs = {
      type: "button",
      className: cls,
      "data-cite-src": src,
      "aria-label": `인용 출처 ${label} — 본문 보기`,
    };
    if (tradition) attrs["data-cite-tradition"] = tradition;
    if (parallels && parallels.length) attrs["data-cite-parallels"] = parallels.join(";");
    return el("button", attrs, label);
  }

  /**
   * Build a verse-attached note paragraph: "anchor — body".
   * Block-level; placed after the verse text. Visible only when body has
   * the `cites-shown` class.
   *
   * @param {BibleVerseNote} note
   * @returns {HTMLElement}
   */
  function buildNoteElement(note) {
    const wrap = el("div", { className: "verse-note", role: "note" });
    wrap.appendChild(el("span", { className: "verse-note-anchor" }, note.anchor));
    wrap.appendChild(document.createTextNode(" — " + note.body));
    return wrap;
  }

  return {
    _computeCiteShowPositions,
    chipText,
    buildCiteChip,
    buildNoteElement,
  };
})();

// ESM module marker (ADR-019)
export {};
