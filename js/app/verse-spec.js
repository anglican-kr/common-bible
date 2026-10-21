// @ts-check
"use strict";

// Verse-spec utilities — extracted from bookmark.js (ADR-034 후속 PR1). Verse
// spec parsing/serialization shared across modules: bookmark.js (save/copy),
// views.js (system-copy serializer), routing.js (parsePath verse deep-links).
// No bookmark/app state — operates on strings, arrays, and passed-in DOM nodes;
// serializeVerseRange uses the global `document` for a self-contained range→text
// transform. Leaf module: no imports.

// ── Verse spec utilities ──
// ── BEGIN VERSE_SPEC ──
// Exercised by tests/unit/bookmark.test.js · verse-spec.test.js. The functions below operate on plain strings and
// arrays; the ones that read the chapter article (selectedSpanVrefs · selectionCitation · collapseSegmentedVerses) take
// it as a parameter so the test loader provides a minimal DOM stub.

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

// A verse-spec segment: "16", "1-5", "3a" as the app writes them (selectedVersesToSpec · mergeVerseSpecs), and two forms
// the app wrote before 2026-06-06 (#205) for one line of a half verse or of a merged verse — "16aa", "16-17a" — kept as
// they are (사용자 결정 2026-10-19 — 지금 앱도 그 구간은 강조하지 않고 장만 연다. 그 상태 그대로 돌아온다). Numbers
// 1-999 without a leading 0 (the highest verse number is 176), part letters a-p (views.js appendVerses).
const SPEC_SEGMENT = /^([1-9]\d{0,2})(?:-([1-9]\d{0,2})([a-p])?|([a-p]{1,2}))?$/;
// More segments than any chapter can yield — Psalm 119 renders 357 selectable units. A flood of segments froze every
// scroll for seconds on its page (the tab bar parses the address on every scroll frame — tabbar.js `collapseEnabled`).
const SPEC_MAX_SEGMENTS = 1000;

/**
 * "all", or segments in the order the app writes them: ascending, a range runs forward, an integer segment never
 * repeats or overlaps the one before, the part segments of a verse ascend by letter. The pre-#205 forms only have to
 * be distinct — that serializer did not sort them. Checked against 34,003 specs today's app writes over every chapter
 * of the real data, 60,384 the pre-#205 app wrote over its chapters with parts, and the fixtures — all pass (the unit
 * test does the same over synthetic chapters).
 *
 * Two of the three ways a spec comes in from outside check it here: a bookmark file (bookmark-modals.js
 * `_isWellFormedBookmark` — ADR-040) and an address (routing.js `parsePath` — a shared or typed link, after trimming
 * commas at either end). A bookmark stored without this check — imported in 1.6.4 or earlier, kept on that device or
 * synced to another — is not checked again (known-issues §15). What got through before (PR #359 review ·
 * known-issues §15): a huge number hung 합치기, a huge range threw while routing (on a cold load the splash never
 * cleared; an ascending one crashed the tab), whitespace stayed in the link so nothing was highlighted, and "5-0" lost
 * verses on 합치기.
 * @param {string} spec
 * @returns {boolean}
 */
function isWellFormedSpec(spec) {
  if (spec === "all") return true;
  // Split no further than the limit — parsePath runs this on every scroll frame, whatever the address holds.
  const segs = spec.split(",", SPEC_MAX_SEGMENTS + 1);
  if (spec === "" || segs.length > SPEC_MAX_SEGMENTS) return false;
  let prevStart = 0;
  let prevIntEnd = 0;
  /** @type {[number, string] | null} */
  let prevPart = null;
  /** @type {Set<string>} */
  const legacy = new Set();
  for (const seg of segs) {
    const m = SPEC_SEGMENT.exec(seg);
    if (!m) return false;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if ((m[2] && end <= start) || start < prevStart) return false;
    if (m[3] || (m[4] && m[4].length === 2)) {               // pre-#205 "16-17a" · "16aa"
      if ((start < prevIntEnd && start !== prevStart) || legacy.has(seg)) return false;
      legacy.add(seg);
    } else if (m[4]) {                                        // "3a"
      if (start < prevIntEnd && start !== prevStart) return false;
      if (prevPart && (start < prevPart[0] || (start === prevPart[0] && m[4] <= prevPart[1]))) return false;
      prevPart = [start, m[4]];
    } else {                                                  // "16" · "1-5"
      if (start <= prevIntEnd) return false;
      prevIntEnd = end;
    }
    prevStart = start;
  }
  return true;
}

// The verse-select bar keys its selection by `data-vkey` (views.js appendVerses — instance key "/" data-vref), not by
// `data-vref`: a number does not identify a verse (verseInstanceKey below), so selecting by `data-vref` lit up every
// span that shared it — 이사 40 의 41:6 을 누르면 40:6 도, 에스델 4:17(5) 하나에 추가 본문 25 절이(main 부터,
// known-issues §5).

/**
 * `data-vref` of the selected spans, document order — what the bookmark save path stores (ADR-010 — the stored spec
 * stays number-based).
 * @param {ReadonlySet<string>} selected `data-vkey` values
 * @param {ParentNode | null | undefined} article
 * @returns {string[]}
 */
function selectedSpanVrefs(selected, article) {
  if (!article) return [];
  return [...article.querySelectorAll(".verse[data-vkey]")]
    .filter((s) => selected.has(s.getAttribute("data-vkey") ?? ""))
    .map((s) => s.getAttribute("data-vref") ?? "");
}

/**
 * What a verse-select selection cites — the bar's 「…절 선택됨」 and the 복사 citation (citationVerseSpec turns `refs`
 * into the text). A ref is a verse number, never a line: the selection unit is a whole verse (views.js
 * `_verseSelectionUnit` — 사용자 결정 2026-10-22), so a multi-line verse cites its number ("3a,3b" → "3", a merged
 * verse "7-8a,7-8b" → "7-8"). The one unit smaller than a verse is a data half verse (이사 7 의 8a · 8b — 9a 를 사이에
 * 두고 나뉘어 실림): one half alone cites as that half ("8a", lines "8aa,8ab" included), both halves as "8". `chapter`
 * is null for the open chapter's own numbering.
 *
 * The numbers follow the chapter's own numbering, as the drag-copy citation does (views.js bindCopyAttribution —
 * pre-merge review 2026-10-14): spans moved in from another chapter (`verse-cross-ref`, 이사 40 의 41:6-7) and
 * Greek-only additions (`verse-lxx`, 다니 3 의 (24)-(90)) are left out unless nothing else is selected — then their
 * numbers alone, and moved-in verses under their own chapter (`data-chapter-ref` → 「41:6-7」, 사용자 결정
 * 2026-10-21 — 「40:6-7」 named chapter 40's own verses). And where two verses of that numbering share a number
 * (에스델 4:17 과 그 추가 본문, a ¶ clause and its verse — 전례시편, a duplicated source marker — 토비 11:15), any
 * selection there cites the number. Verses are told apart by the instance key less its part letter: the two halves of
 * a data half verse are parts of one verse, not two verses.
 * @param {ReadonlySet<string>} selected `data-vkey` values
 * @param {ParentNode | null | undefined} article
 * @returns {{ chapter: number | null, refs: string[] }}
 */
function selectionCitation(selected, article) {
  if (!article) return { chapter: null, refs: [] };
  const spans = [...article.querySelectorAll(".verse[data-vkey]")];
  /** @param {Element} s */
  const foreign = (s) => s.classList.contains("verse-cross-ref") || s.classList.contains("verse-lxx");
  /** @param {Element} s */
  const isSelected = (s) => selected.has(s.getAttribute("data-vkey") ?? "");
  const picked = spans.filter(isSelected);
  if (!picked.length) return { chapter: null, refs: [] };
  const ownNumbering = picked.some((s) => !foreign(s));
  const fromChapters = new Set(picked.map((s) => s.getAttribute("data-chapter-ref")));
  const fromChapter = !ownNumbering && fromChapters.size === 1 ? [...fromChapters][0] : null;
  /** @type {Map<number, { lines: number, sel: string[], halves: Set<string>, verses: Set<string> }>} */
  const byNumber = new Map();
  for (const s of spans) {
    if (foreign(s) === ownNumbering) continue;
    const ref = s.getAttribute("data-vref") ?? "";
    const key = s.getAttribute("data-vkey") ?? "";
    const instance = key.slice(0, key.indexOf("/"));
    const n = parseInt(ref, 10);
    let g = byNumber.get(n);
    if (!g) byNumber.set(n, g = { lines: 0, sel: [], halves: new Set(), verses: new Set() });
    g.lines++;
    g.verses.add(instance.replace(/^(\d+)[a-p]/, "$1"));
    if (isSelected(s)) {
      g.sel.push(ref);
      g.halves.add(/^\d+[a-p]/.exec(instance)?.[0] ?? "");   // "" — a line of a whole verse
    }
  }
  const refs = [];
  for (const { lines, sel, halves, verses } of byNumber.values()) {
    if (!sel.length) continue;
    if (verses.size === 1 && sel.length < lines && !halves.has("")) {
      refs.push(...[...halves].sort());
    } else {
      // 글자를 모두 뗀다 — 병합 절 「7-8a」「7-8b」는 「7-8」(끝 번호를 잃지 않게, Copilot 리뷰 9회차), 데이터의
      // 반쪽 절이 다시 두 줄인 「8aa」…「8bb」는 「8」(줄 글자 하나만 떼면 「8a」가 됐다 — 자체 리뷰 2026-10-13)
      refs.push(...new Set(sel.map((r) => r.replace(/[a-z]+$/, ""))));
    }
  }
  return { chapter: fromChapter ? Number(fromChapter) : null, refs };
}

/**
 * The citation a person reads — the verse-select bar's 「…절 선택됨」 and the 복사 citation, from selectionCitation's
 * `refs`. The numbers are those selectedVersesToSpec writes in the spec grammar of addresses and bookmarks, written two
 * ways it does not: a merged verse joins the run around it (나훔 1:1-9 — 「1-6,7-8,9」 before), and a data half verse
 * takes the printed letter (「9a」 → 「9ㄱ」).
 * @param {string[]} refs
 * @returns {string}
 */
function citationVerseSpec(refs) {
  const nums = refs.flatMap((r) => {
    const m = /^(\d+)-(\d+)$/.exec(r);
    if (!m) return [r];
    const a = Number(m[1]);
    return Array.from({ length: Number(m[2]) - a + 1 }, (_, i) => String(a + i));
  });
  return selectedVersesToSpec(nums).replace(/(\d)([a-p])(?=,|$)/g, (_, d, p) => d + halfVerseMark(p));
}

// 데이터의 반쪽 절(`part`)을 사람이 읽는 표기로 — 인쇄본은 「이사 7:8ㄱ」 「8ㄴ」이다(사용자 결정 2026-10-22). 화면의 절
// 번호와 절 선택 출처가 쓴다. 주소와 저장 표기는 「8a」 그대로다(ADR-010 · 040). 데이터의 `part`는 a · b뿐이다.
/** @param {string} part @returns {string} */
function halfVerseMark(part) {
  return "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ".charAt(part.charCodeAt(0) - 97) || part;
}

// Bookmark-only (ADR-010): a prose verse split into a/b/c line-spans by an
// inline citation is conceptually one verse, so bookmarks ignore the sub-verse
// segmentation — selecting *any* span of a multi-part verse stores the whole
// verse number, even on a partial selection. Verse select picks whole verses
// (views.js _verseSelectionUnit), so a partial selection here is one half of a
// data half verse — saved as the number too ("8aa,8ab" → "8"), while the bar
// and the copy cite it as 「8ㄱ」 (selectionCitation).
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

// Is verse number `n` covered by a verse spec? "all" covers everything; a
// hemistich part ("4a") promotes to the whole verse 4 — continuous reading reads
// whole verses (same spirit as ADR-010's prose-verse collapse).
// Moved here from bookmark-read.js (ADR-038 §3) so the lectionary view shares
// one implementation instead of copying the filter.
/** @param {string} spec @param {number} n @returns {boolean} */
function specCoversVerse(spec, n) {
  if (spec === "all") return true;
  for (const seg of parseVerseSpec(spec)) {
    if (n >= seg.start && n <= seg.end) return true;
  }
  return false;
}

// Highest verse number in a chapter (counting a merged verse's range_end).
/** @param {{ verses?: ReadonlyArray<{ number: number, range_end?: number|null }> } | null | undefined} data @returns {number} */
function chapterMaxVerse(data) {
  let m = 0;
  for (const v of (data && data.verses) || []) {
    const n = v.range_end != null ? v.range_end : v.number;
    if (n > m) m = n;
  }
  return m;
}

// ── Verse instance identity ──
// A verse number does NOT identify a verse: several verses in one chapter can
// share a number and still be different verses —
//   · `versicle` — 전례시편's unnumbered ¶ clause inherits the previous number (ADR-039)
//   · `alt_ref`  — Greek Esther's additions all sit under one number (ADR-003)
//   · `lxx_only` / `part` / `chapter_ref` — LXX-only, hemistich part, displaced verse
// Keying by number alone therefore *drops* verses: the subset renderer deduped
// on number+part+lxx_only and silently lost 130 verses across 77 chapters
// (전례시편 69편의 ¶ 구절, 에스델 4장 31절 — 실측 2026-07-13).

/**
 * Content-derived identity of one verse instance.
 * @param {{ number: number, part?: string|null, alt_ref?: number|null, lxx_only?: boolean, versicle?: boolean, chapter_ref?: number|null }} v
 * @returns {string}
 */
function verseInstanceKey(v) {
  let k = String(v.number);
  if (v.part) k += v.part;
  if (v.alt_ref != null) k += `_${v.alt_ref}`;
  if (v.lxx_only) k += "_lxx";
  if (v.versicle) k += "_v";
  if (v.chapter_ref != null) k += `_c${v.chapter_ref}`;
  return k;
}

/**
 * Keys for a verse list, guaranteed unique within it.
 *
 * The content key above separates every legitimate instance, but a duplicated
 * verse marker in the source text (5 chapters as of 2026-07-27 — job 32:9,
 * 1chr 6:33, sir 29:15, lam 1:10, tob 11:15) can still collide. Rather than
 * dropping the second one, an ordinal is appended so a data defect degrades to
 * an odd id instead of a missing verse.
 * @param {ReadonlyArray<Parameters<typeof verseInstanceKey>[0]>} verses
 * @returns {string[]}
 */
function verseInstanceKeys(verses) {
  /** @type {Record<string, number>} */
  const seen = {};
  return (verses || []).map((v) => {
    const base = verseInstanceKey(v);
    seen[base] = (seen[base] ?? 0) + 1;
    return seen[base] === 1 ? base : `${base}~${seen[base]}`;
  });
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
// Exercised by the e2e copy tests (tests/e2e/test_copy.py · test_lectionary_view.py — the transform needs a real
// DOM Range). Pure DOM transform: clone the range bounded by [firstNode, lastNode] (inclusive), strip aria-hidden
// verse-number glyphs, drop citation chips and ※ variant-note markers, expand stanza/paragraph/pilcrow markers to
// blank lines and hemistich markers to single line breaks, then normalize whitespace.
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
  // ADR-039 부(部): the 「(N)」 sub-heading sits right before its section's first verse (views.js appendVerses), outside
  // the verse spans — a copy that starts at that verse carries it too (사용자 결정 2026-10-13 — before this only the
  // headings *inside* the range came along, so a whole-psalm copy had 「(2)」 but not 「(1)」).
  const prev = firstNode instanceof Element ? firstNode.previousElementSibling : null;
  range.setStartBefore(prev && prev.classList.contains("psalm-section") ? prev : firstNode);
  range.setEndAfter(lastNode);
  const work = document.createElement("div");
  work.appendChild(range.cloneContents());
  work.querySelectorAll(".verse-num").forEach((n) => n.remove());
  // Drop citation chips and the appended ※ variant-note markers entirely —
  // they are reading aids, not scripture text. Text-anchored `.note-anchor`
  // wraps real verse words, so it stays (its textContent flows through).
  // Presentation-only markers that the UI makes unselectable must not leak into copied scripture
  // either: opt-out `data-copy-omit` (lectionary 〔 〕 optional-verse brackets) and the ※ parallel-passage
  // anchor — a reading aid like the variant-note ※ above (self-review 2026-10-13).
  work.querySelectorAll(".cite-chip, .note-anchor--variant, [data-copy-omit], .parallel-anchor").forEach((n) => n.remove());
  // The liturgical marks stay — they are what a bulletin needs (사용자 결정 2026-10-13, docs/known-issues.md §4): ◯ already
  // ends the cantor's half-line after a space; ¶ (unnumbered versicle) stands where a verse number would, so it takes a
  // space; 「(N)」 gets a line of its own so it does not read as a verse number glued to the next line.
  work.querySelectorAll(".versicle-mark").forEach((n) => { n.textContent = "¶ "; });
  work.querySelectorAll(".psalm-section").forEach((n) => { n.textContent = `\n\n${(n.textContent ?? "").trim()}\n`; });
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

// ── BEGIN CITATION_SOURCE ──
/**
 * 복사 출처 줄 끝의 번역 표기 — 전례시편 · 송가(`division: "liturgical"`)는 대한성공회 기도서의 번역이라(ADR-037 §1 · §3)
 * 「(대한성공회 기도서)」, 성서 본문은 「(공동번역성서)」(사용자 결정 2026-10-13). 장 본문 복사(views.js) · 전례독서 복사
 * (lectionary.js) · 절 선택 복사 버튼(bookmark-verse-select.js)이 함께 쓴다.
 * @param {boolean} liturgical
 * @returns {string}
 */
function citationSource(liturgical) {
  return liturgical ? "(대한성공회 기도서)" : "(공동번역성서)";
}
// ── END CITATION_SOURCE ──

// ── Window facade ──
// External callers (views.js system-copy, routing.js parsePath) call these as
// bare globals; bookmark.js receives them as ESM imports.
window.parseVerseSpec = parseVerseSpec;
window.selectedVersesToSpec = selectedVersesToSpec;
window.mergeVerseSpecs = mergeVerseSpecs;
window.serializeVerseRange = serializeVerseRange;
window.verseInstanceKeys = verseInstanceKeys;

export {
  parseVerseSpec, isWellFormedSpec, selectedSpanVrefs, selectionCitation, citationVerseSpec, halfVerseMark,
  collapseSegmentedVerses, selectedVersesToSpec, mergeVerseSpecs, serializeVerseRange, citationSource,
  specCoversVerse, chapterMaxVerse, verseInstanceKey, verseInstanceKeys,
};
