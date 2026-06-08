"use strict";
// @ts-check

// Verse-spec utilities — extracted from bookmark.js (ADR-034 후속 PR1). Verse
// spec parsing/serialization shared across modules: bookmark.js (save/copy),
// views.js (system-copy serializer), routing.js (parsePath verse deep-links).
// No bookmark/app state — operates on strings, arrays, and passed-in DOM nodes;
// serializeVerseRange uses the global `document` for a self-contained range→text
// transform. Leaf module: no imports.

// ── Verse spec utilities ──
// ── BEGIN VERSE_SPEC ──
// Exercised by tests/unit/bookmark.test.js. The 5 functions below operate
// on plain strings and arrays, with `collapseFullVerseRefs` taking the
// chapter article element as a parameter so the test loader provides a
// minimal DOM stub.

// "1-5,10-15,3a,3b" → [{start:1,end:5},{start:10,end:15},{start:3,end:3,part:"a"},...]
/**
 * @param {string} spec
 * @returns {Array<{start: number, end: number, part?: string}>}
 */
function parseVerseSpec(spec) {
  if (!spec || spec === "all") return [];
  /** @type {Array<{start: number, end: number, part?: string}>} */
  const init = [];
  return spec.split(",").reduce((acc, seg) => {
    const trimmed = seg.trim();
    const alphaMatch = trimmed.match(/^(\d+)([a-z])$/);
    if (alphaMatch) {
      const n = parseInt(alphaMatch[1], 10);
      if (n > 0) acc.push({ start: n, end: n, part: alphaMatch[2] });
      return acc;
    }
    const m = trimmed.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      const s = parseInt(m[1], 10);
      const e = m[2] ? parseInt(m[2], 10) : s;
      if (s > 0) acc.push({ start: Math.min(s, e), end: Math.max(s, e) });
    }
    return acc;
  }, init);
}

// If all rendered spans of a multi-part verse are selected, collapse "3a,3b" → "3".
// Single-part verses ("3" with no alpha suffix) are unchanged.
/**
 * @param {string[]} refs
 * @param {Element | null | undefined} article
 * @returns {string[]}
 */
function collapseFullVerseRefs(refs, article) {
  if (!article) return refs;
  const selected = new Set(refs);
  // Group by integer verse number
  /** @type {Record<string, string[]>} */
  const byVerse = {};
  for (const ref of refs) {
    const n = parseInt(ref, 10);
    if (!byVerse[n]) byVerse[n] = [];
    byVerse[n].push(ref);
  }
  const result = [];
  for (const [n, verseRefs] of Object.entries(byVerse)) {
    // All spans rendered for this verse number
    const allSpanRefs = [...article.querySelectorAll(".verse[data-vref]")]
      .map((s) => s.getAttribute("data-vref") ?? "")
      .filter((r) => r && parseInt(r, 10) === Number(n));
    const hasAlpha = allSpanRefs.some((r) => /[a-z]$/.test(r));
    const allSelected = allSpanRefs.length > 0 && allSpanRefs.every((r) => selected.has(r));
    if (hasAlpha && allSelected) {
      result.push(`${n}`);
    } else {
      result.push(...verseRefs);
    }
  }
  return result;
}

// Bookmark-only (ADR-010): a prose verse split into a/b/c line-spans by an
// inline citation is conceptually one verse, so bookmarks ignore the sub-verse
// segmentation — selecting *any* span of a multi-part verse stores the whole
// verse number, even on a partial selection. (The selection bar label and the
// copy serializer keep per-span granularity; only the saved bookmark collapses.)
// Single-part verses pass through unchanged.
/**
 * @param {string[]} refs
 * @param {Element | null | undefined} article
 * @returns {string[]}
 */
function collapseSegmentedVerses(refs, article) {
  if (!article) return refs;
  // Group by integer verse number, preserving first-seen order.
  /** @type {Record<string, string[]>} */
  const byVerse = {};
  /** @type {string[]} */
  const order = [];
  for (const ref of refs) {
    const n = parseInt(ref, 10);
    if (!byVerse[n]) { byVerse[n] = []; order.push(`${n}`); }
    byVerse[n].push(ref);
  }
  const result = [];
  for (const n of order) {
    // All spans rendered for this verse number
    const allSpanRefs = [...article.querySelectorAll(".verse[data-vref]")]
      .map((s) => s.getAttribute("data-vref") ?? "")
      .filter((r) => r && parseInt(r, 10) === Number(n));
    const hasAlpha = allSpanRefs.some((r) => /[a-z]$/.test(r));
    if (hasAlpha) {
      result.push(`${n}`);
    } else {
      result.push(...byVerse[n]);
    }
  }
  return result;
}

// Compare verse refs: "3" < "3a" < "3b" < "4"
/** @param {string} a @param {string} b */
function _compareRefs(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (na !== nb) return na - nb;
  const pa = a.match(/[a-z]$/)?.[0] || "";
  const pb = b.match(/[a-z]$/)?.[0] || "";
  return pa.localeCompare(pb);
}

// Array of data-vref strings (e.g. ["3a","3b","5","6","7"]) → "3a,3b,5-7"
// Consecutive integer-only refs are compressed into ranges; alpha refs kept individually.
/** @param {string[]} refs @returns {string} */
function selectedVersesToSpec(refs) {
  if (!refs.length) return "all";
  const unique = [...new Set(refs)].sort(_compareRefs);
  const result = [];
  /** @type {number[]} */
  let intRun = [];

  function flushRun() {
    if (!intRun.length) return;
    let s = intRun[0], e = intRun[0];
    for (let i = 1; i < intRun.length; i++) {
      if (intRun[i] === e + 1) { e = intRun[i]; }
      else { result.push(s === e ? `${s}` : `${s}-${e}`); s = e = intRun[i]; }
    }
    result.push(s === e ? `${s}` : `${s}-${e}`);
    intRun = [];
  }

  for (const ref of unique) {
    if (/^\d+$/.test(ref)) {
      intRun.push(parseInt(ref, 10));
    } else {
      flushRun();
      result.push(ref);
    }
  }
  flushRun();
  return result.join(",");
}

// Union of two verse spec strings
/** @param {string} specA @param {string} specB @returns {string} */
function mergeVerseSpecs(specA, specB) {
  if (specA === "all" || specB === "all") return "all";
  /** @type {Set<number>} */
  const intRefs = new Set();
  /** @type {Set<string>} */
  const partRefs = new Set();
  for (const seg of [...parseVerseSpec(specA), ...parseVerseSpec(specB)]) {
    if (seg.part) {
      partRefs.add(`${seg.start}${seg.part}`);
    } else {
      for (let n = seg.start; n <= seg.end; n++) intRefs.add(n);
    }
  }
  /** @type {string[]} */
  const refs = [...intRefs].map(String);
  for (const pr of partRefs) {
    if (!intRefs.has(parseInt(pr, 10))) refs.push(pr);
  }
  return selectedVersesToSpec(refs);
}
// ── END VERSE_SPEC ──

// ── BEGIN VERSE_SERIALIZE ──
// Exercised by tests/unit/bookmark.test.js. Pure DOM transform: clone the
// range bounded by [firstNode, lastNode] (inclusive), strip aria-hidden
// verse-number glyphs, drop citation chips and ※ variant-note markers,
// expand stanza/paragraph/pilcrow markers to blank lines and hemistich
// markers to single line breaks, then normalize whitespace.
//
// Shared by the article-level system-copy handler (views.js, fires on
// Cmd/Ctrl+C of a drag-selection) and the verse-select bar's 복사 button
// (copySelectedVerses below). Keeping a single source ensures both paths emit
// identical citation-ready text.

/**
 * @param {Node} firstNode
 * @param {Node} lastNode
 * @returns {string}
 */
function serializeVerseRange(firstNode, lastNode) {
  const range = document.createRange();
  range.setStartBefore(firstNode);
  range.setEndAfter(lastNode);
  const work = document.createElement("div");
  work.appendChild(range.cloneContents());
  work.querySelectorAll(".verse-num").forEach((n) => n.remove());
  // Drop citation chips and the appended ※ variant-note markers entirely —
  // they are reading aids, not scripture text. Text-anchored `.note-anchor`
  // wraps real verse words, so it stays (its textContent flows through).
  work.querySelectorAll(".cite-chip, .note-anchor--variant").forEach((n) => n.remove());
  work.querySelectorAll(".stanza-break, .paragraph-break, .pilcrow")
    .forEach((n) => { n.textContent = "\n\n"; });
  work.querySelectorAll(".hemistich-break").forEach((n) => { n.textContent = "\n"; });
  return (work.textContent ?? "")
    .replace(/\u2060/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
// ── END VERSE_SERIALIZE ──

// ── Window facade ──
// External callers (views.js system-copy, routing.js parsePath) call these as
// bare globals; bookmark.js receives them as ESM imports.
window.parseVerseSpec = parseVerseSpec;
window.selectedVersesToSpec = selectedVersesToSpec;
window.mergeVerseSpecs = mergeVerseSpecs;
window.collapseFullVerseRefs = collapseFullVerseRefs;
window.serializeVerseRange = serializeVerseRange;

export {
  parseVerseSpec, collapseFullVerseRefs, collapseSegmentedVerses,
  selectedVersesToSpec, mergeVerseSpecs, serializeVerseRange,
};
