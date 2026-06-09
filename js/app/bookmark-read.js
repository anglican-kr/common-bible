"use strict";
// @ts-check

// Bookmark reading view (ADR-035). Gathers every saved bookmark's scripture
// text into one continuous reading screen. Renders in the bookmark list's
// display order; folders become section sub-headings; list-adjacent bookmarks
// that form a continuous text range (same book, consecutive verses/chapters)
// are joined under one combined reference (창세 1:1–2:4a). The verse text is
// drawn through views.js `appendVerses`, the same per-verse renderer the full
// chapter view uses — so this view is the reusable base for liturgical
// lectionary pages later (ADR-035 로드맵 메모).
//
// The screen is built from localStorage bookmarks, so the /bookmarks/read URL
// is effectively non-shareable: a copied link renders the recipient's own
// bookmarks (or nothing), never the author's reading list.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BibleChapter} BibleChapter */

import { loadChapter, getBooksCache } from "./data-fetch.js";
import { setTitle, appendVerses } from "./views.js";
import { sortBookmarkNodes, _findItemInStore } from "./bookmark-core.js";
import { parseVerseSpec } from "./verse-spec.js";

const { _$, el, clearNode, chUnit, emptyState } = window.appHelpers;
const { loadBookmarks } = window.appStorage;

const $app = _$("app");

// ── BEGIN BOOKMARK_READ ──
// Exercised by tests/unit/bookmark-read.test.js. Pure logic: range resolution,
// continuity test, combined-reference formatting, spec membership, and the
// tree→sequence flatten. `parseVerseSpec` / `sortBookmarkNodes` are provided by
// the test prelude (extracted from verse-spec.js / stubbed) — no DOM here.

/** @param {BibleChapter} data @returns {number} */
function _chapterMaxVerse(data) {
  let m = 0;
  for (const v of (data && data.verses) || []) {
    const n = v.range_end != null ? v.range_end : v.number;
    if (n > m) m = n;
  }
  return m;
}

/**
 * Resolve a bookmark to the verse range it occupies, so adjacency and the
 * combined heading can be computed without re-parsing the spec everywhere.
 * `endDisplay` keeps any hemistich part letter ("4a") for the heading, while
 * `endV` is the integer used for adjacency. `coversChapterEnd` is what lets a
 * whole-chapter (or chapter-tail) bookmark join the next chapter's verse 1.
 * @param {BookmarkTreeBookmark} bm
 * @param {number} maxVerse  chapter's highest verse number (0 if unknown)
 * @returns {{ bookId: string, startCh: number, startV: number, endCh: number, endV: number, endDisplay: string, coversChapterEnd: boolean, wholeChapter: boolean }}
 */
function _bmRange(bm, maxVerse) {
  const whole = {
    bookId: bm.bookId,
    startCh: bm.chapter, startV: 1,
    endCh: bm.chapter, endV: maxVerse,
    endDisplay: String(maxVerse),
    // "covers the chapter end" requires actually knowing the end. maxVerse is 0
    // when the chapter JSON failed to load — claim no coverage then, so an
    // unrenderable whole-chapter bookmark can't merge across a chapter boundary
    // and produce a cross-chapter heading with no body text.
    coversChapterEnd: maxVerse > 0,
    wholeChapter: true,
  };
  if (bm.verseSpec === "all") return whole;
  const segs = parseVerseSpec(bm.verseSpec);
  // A spec that parses to nothing (import corruption, typo) is NOT a whole
  // chapter — return a degenerate range with NaN bounds so it neither claims
  // chapter-end coverage nor satisfies adjacency in either direction (it renders
  // no verses and, with the empty-section guard, shows no heading).
  if (!segs.length) {
    return {
      bookId: bm.bookId,
      startCh: bm.chapter, startV: NaN,
      endCh: bm.chapter, endV: NaN,
      endDisplay: "", coversChapterEnd: false, wholeChapter: false,
    };
  }
  const ordered = segs.slice().sort((a, b) =>
    a.start !== b.start ? a.start - b.start : (a.part || "").localeCompare(b.part || ""));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  return {
    bookId: bm.bookId,
    startCh: bm.chapter, startV: first.start,
    endCh: bm.chapter, endV: last.end,
    endDisplay: last.part ? `${last.end}${last.part}` : `${last.end}`,
    coversChapterEnd: maxVerse > 0 && last.end >= maxVerse,
    wholeChapter: false,
  };
}

/**
 * Do two list-adjacent ranges form one continuous reading? Same book, and
 * either the next verse in the same chapter, or verse 1 of the next chapter
 * when the previous range ran to its chapter's end.
 * @param {ReturnType<typeof _bmRange>} prev
 * @param {ReturnType<typeof _bmRange>} cur
 * @returns {boolean}
 */
function _isContinuous(prev, cur) {
  if (!prev || !cur || prev.bookId !== cur.bookId) return false;
  if (cur.startCh === prev.endCh && cur.startV === prev.endV + 1) return true;
  if (cur.startCh === prev.endCh + 1 && cur.startV === 1 && prev.coversChapterEnd) return true;
  return false;
}

/**
 * Combined reference label for a joined group. A lone whole chapter reads as
 * "창세 1장"; everything else as a range "창세 1:1–2:4a" (collapsing to a single
 * "창세 3:5" when start and end coincide).
 * @param {string} bookName @param {string} unit
 * @param {ReturnType<typeof _bmRange>} first @param {ReturnType<typeof _bmRange>} last
 * @param {boolean} isSingleWhole  group is one whole-chapter bookmark
 * @returns {string}
 */
function _combinedRef(bookName, unit, first, last, isSingleWhole) {
  if (isSingleWhole) return `${bookName} ${first.startCh}${unit}`;
  const startRef = `${first.startCh}:${first.startV}`;
  // One-verse range collapses to a single ref — compared numerically so a
  // hemistich-part end (e.g. "5a") still collapses (창세 5:5, the whole verse the
  // body renders), not a degenerate "창세 5:5–5a".
  if (first.startCh === last.endCh && first.startV === last.endV) return `${bookName} ${startRef}`;
  const endRef = last.endCh === first.startCh ? last.endDisplay : `${last.endCh}:${last.endDisplay}`;
  return `${bookName} ${startRef}–${endRef}`;
}

/**
 * Is verse number `n` covered by a verse spec? "all" covers everything; a
 * hemistich part ("4a") promotes to the whole verse 4 (read whole verses for
 * continuous reading — same spirit as ADR-010's prose-verse collapse).
 * @param {string} spec @param {number} n @returns {boolean}
 */
function _specCoversVerse(spec, n) {
  if (spec === "all") return true;
  for (const seg of parseVerseSpec(spec)) {
    if (n >= seg.start && n <= seg.end) return true;
  }
  return false;
}

/**
 * Flatten the bookmark tree into a reading sequence in display order. Folders
 * emit a heading token (then their children, recursively); bookmarks emit a
 * leaf token. The active sort mode is applied at each level via
 * `sortBookmarkNodes`, so reading order matches what the list shows.
 * @param {BookmarkTreeNode[]} nodes @param {number} [depth]
 * @returns {Array<{ type: "folder", name: string, depth: number } | { type: "bookmark", bm: BookmarkTreeBookmark, depth: number }>}
 */
function buildReadingSequence(nodes, depth = 0) {
  /** @type {Array<any>} */
  const out = [];
  for (const node of sortBookmarkNodes(nodes || [])) {
    if (node.type === "folder") {
      out.push({ type: "folder", name: node.name || "", depth });
      out.push(...buildReadingSequence(node.children || [], depth + 1));
    } else {
      out.push({ type: "bookmark", bm: node, depth });
    }
  }
  return out;
}

/**
 * Plan the reading view's render units from a flattened sequence — the pure,
 * testable core of the merge/boundary logic (the DOM renderer just consumes the
 * result). Emits a "folder" unit per folder token and a "group" unit per run of
 * list-adjacent bookmarks that `_isContinuous` joins. A run is BROKEN (so two
 * regions never merge into one passage/heading) by any of:
 *   - a folder token (entering a sub-folder / new sibling folder),
 *   - an unloadable bookmark (`isLoaded` false — it can't render but WAS there),
 *   - a tree-depth change between consecutive bookmarks (folder *exit* back to a
 *     shallower parent emits no token; same-parent siblings share one depth).
 * `endsOf`/`isLoaded` are injected so this stays DOM-free and unit-testable.
 * @param {Array<{ type: "folder", name: string, depth: number } | { type: "bookmark", bm: BookmarkTreeBookmark, depth: number }>} seq
 * @param {(bm: BookmarkTreeBookmark) => ReturnType<typeof _bmRange>} endsOf
 * @param {(bm: BookmarkTreeBookmark) => boolean} isLoaded
 * @returns {Array<{ type: "folder", name: string, depth: number } | { type: "group", bms: BookmarkTreeBookmark[], depth: number }>}
 */
function _planReadingUnits(seq, endsOf, isLoaded) {
  /** @type {Array<any>} */
  const units = [];
  /** @type {BookmarkTreeBookmark[]} */
  let pending = [];
  let pendingDepth = -1;
  function flush() {
    if (!pending.length) return;
    // Every bookmark in a run shares one tree depth (a depth change breaks the
    // run below), so the groups it splits into all carry that depth — the DOM
    // renderer uses it to drop sibling-folder headings that don't contain them.
    const depth = pendingDepth;
    let group = [pending[0]];
    for (let i = 1; i < pending.length; i++) {
      if (_isContinuous(endsOf(pending[i - 1]), endsOf(pending[i]))) {
        group.push(pending[i]);
      } else {
        units.push({ type: "group", bms: group, depth });
        group = [pending[i]];
      }
    }
    units.push({ type: "group", bms: group, depth });
    pending = [];
  }
  for (const tok of seq) {
    if (tok.type === "folder") {
      flush();
      units.push({ type: "folder", name: tok.name, depth: tok.depth });
    } else if (isLoaded(tok.bm)) {
      if (pending.length && tok.depth !== pendingDepth) flush();
      pending.push(tok.bm);
      pendingDepth = tok.depth;
    } else {
      flush();
    }
  }
  flush();
  return units;
}
// ── END BOOKMARK_READ ──

/**
 * Full-screen reading view: every bookmark's scripture text under a folder (or
 * all bookmarks when no folder id), in display order, nested folders as
 * sub-headings, list-adjacent continuous passages joined. Rendered into #app
 * for the /bookmarks/read[/<folderId>] route (ADR-035). Returns the resolved
 * page title so the router's page-meta matches the visible header.
 * @param {string | null} [folderId]
 * @returns {Promise<string>}
 */
async function renderBookmarkReadView(folderId = null) {
  // ADR-031 staleness guard: this renderer awaits chapter loads, so a slower
  // fetch can resolve after the user has navigated away. Load ALL data first and
  // only touch #app after the post-await staleness check — so a navigation mid-
  // load bails having mutated nothing (no blank #app, no clobbered later view).
  // route()'s own isStale runs only after we return, too late to gate our DOM.
  const entrySeq = typeof window.routeSeq === "function" ? window.routeSeq() : null;
  const isStale = () => entrySeq !== null && window.routeSeq() !== entrySeq;
  const store = loadBookmarks();
  // Folder scope: read that folder's subtree (nested folders become
  // sub-headings); each folder is independently readable (ADR-035). No id →
  // every bookmark (kept as a fallback for a bare /bookmarks/read deep link).
  let nodes = store;
  let title = "북마크 읽기";
  if (folderId) {
    const found = _findItemInStore(store, folderId);
    if (found && found.item.type === "folder") {
      nodes = found.item.children || [];
      title = found.item.name || "북마크 읽기";
    } else {
      nodes = [];
    }
  }

  const seq = buildReadingSequence(nodes);
  const bmTokens = /** @type {Array<{ type: "bookmark", bm: BookmarkTreeBookmark, depth: number }>} */ (
    seq.filter((t) => t.type === "bookmark")
  );

  // Load every referenced chapter once (deduped) BEFORE touching the DOM. A
  // missing chapter is skipped (the bookmark just won't render) rather than
  // failing the whole view.
  /** @type {Map<string, BibleChapter>} */
  const chapterCache = new Map();
  if (bmTokens.length) {
    /** @type {Map<string, { bookId: string, chapter: number }>} */
    const needed = new Map();
    for (const t of bmTokens) needed.set(`${t.bm.bookId}:${t.bm.chapter}`, { bookId: t.bm.bookId, chapter: t.bm.chapter });
    await Promise.all([...needed.values()].map(async ({ bookId, chapter }) => {
      try { chapterCache.set(`${bookId}:${chapter}`, await loadChapter(bookId, chapter)); }
      catch { /* missing chapter — skip */ }
    }));
    // Navigation superseded this route during the chapter loads — bail before
    // any DOM mutation so #app keeps whatever the now-current route rendered.
    if (isStale()) return title;
  }

  // ── From here on everything is synchronous — safe to commit to the DOM. ──
  setTitle(title);
  const $title = _$("page-title");
  // Back to the bookmark list (reuses the shared header back/home affordance).
  $title.insertBefore(window.buildHomeBtn("/bookmarks", "북마크로 돌아가기"), $title.firstChild);
  window.hideAudioBar?.();
  clearNode($app);

  const panel = el("div", { className: "bookmark-read" });

  if (!bmTokens.length) {
    panel.appendChild(emptyState({
      icon: null,
      title: "읽을 북마크가 없습니다",
      subtitle: "성서를 읽다가 북마크를 추가하면 이곳에서 모아 읽을 수 있습니다.",
    }));
    $app.appendChild(panel);
    return title;
  }

  // Bookmarks exist but not a single chapter loaded (offline / all JSON missing):
  // every item would be skipped below, leaving only headings or a blank panel.
  // Show a load-failure state instead of a dead end.
  if (!chapterCache.size) {
    panel.appendChild(emptyState({
      icon: null,
      title: "본문을 불러오지 못했습니다",
      subtitle: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    }));
    $app.appendChild(panel);
    return title;
  }

  const books = getBooksCache() ?? [];
  /** @param {string} id */
  const bookOf = (id) => books.find((b) => b.id === id);
  /** @param {BookmarkTreeBookmark} bm */
  const endsOf = (bm) => {
    const data = chapterCache.get(`${bm.bookId}:${bm.chapter}`);
    return _bmRange(bm, data ? _chapterMaxVerse(data) : 0);
  };

  // Verses already rendered anywhere in this view, so overlapping bookmarks
  // (e.g. a whole chapter plus a sub-range of it, or two ranges that intersect)
  // don't print the same verse twice across separate passage groups. Keyed by
  // book:chapter:verse(+part/lxx) — a verse object renders at most once.
  /** @type {Set<string>} */
  const seenVerses = new Set();

  // Folder sub-headings are emitted lazily: a heading is only committed once a
  // real passage under it is about to render. An empty folder, or one whose
  // bookmarks all failed to load, thus never shows a body-less heading (the
  // folder-level analogue of the empty-passage guard below). Each queued heading
  // carries its tree depth so that, when a later folder at depth d appears, any
  // still-queued heading at depth ≥ d (a sibling/earlier subtree that ended with
  // no content) is dropped rather than flushed alongside the new folder's
  // content — only the current ancestor chain remains to flush.
  /** @type {{ el: HTMLElement, depth: number }[]} */
  const pendingHeadings = [];
  function flushPendingHeadings() {
    for (const h of pendingHeadings) panel.appendChild(h.el);
    pendingHeadings.length = 0;
  }
  // Did any passage actually render? Drives the "loaded but nothing to show"
  // empty state (every group skipped output via spec mismatch / dedup).
  let renderedAnySection = false;

  /** @param {BookmarkTreeBookmark[]} bms  contiguous group */
  function renderGroup(bms) {
    if (!bms.length) return;
    const first = bms[0];
    const last = bms[bms.length - 1];
    const book = bookOf(first.bookId);
    const bookName = book ? (book.short_name_ko || book.name_ko) : first.bookId;
    const unit = chUnit(first.bookId);
    const firstEnds = endsOf(first);
    const lastEnds = endsOf(last);
    const isSingleWhole = bms.length === 1 && firstEnds.wholeChapter;
    const ref = _combinedRef(bookName, unit, firstEnds, lastEnds, isSingleWhole);

    const section = el("section", { className: "reading-passage" });
    const heading = el("div", { className: "reading-heading" });
    heading.appendChild(el("h3", { className: "reading-ref" }, ref));
    // Just the scripture reference — no per-bookmark label line under it (the
    // combined reference is the section's title; the label was redundant).
    section.appendChild(heading);

    // Merge per-chapter verse coverage across the group, then render one
    // <article> per chapter — keeps each chapter a clean text block (a paragraph
    // gap between joined chapters, ADR-035) and keeps appendVerses' per-array
    // highlight/cite indexing scoped to a single chapter's verses.
    /** @type {Map<number, string[]>} */
    const byChapter = new Map();
    for (const bm of bms) {
      // Coerce the chapter to a number so a stray string ("1" vs 1) can't split
      // one chapter into two map entries (and two <article>s).
      const ch = Number(bm.chapter);
      const arr = byChapter.get(ch) || [];
      arr.push(bm.verseSpec);
      byChapter.set(ch, arr);
    }
    let appendedAny = false;
    for (const chNum of [...byChapter.keys()].sort((a, b) => a - b)) {
      const data = chapterCache.get(`${first.bookId}:${chNum}`);
      if (!data) continue;
      const specs = /** @type {string[]} */ (byChapter.get(chNum));
      const coversAll = specs.includes("all");
      const verses = (data.verses || []).filter((v) => {
        if (!coversAll) {
          const end = v.range_end != null ? v.range_end : v.number;
          let inSpec = false;
          for (let x = v.number; x <= end && !inSpec; x++) {
            if (specs.some((spec) => _specCoversVerse(spec, x))) inSpec = true;
          }
          if (!inSpec) return false;
        }
        // Drop verses already shown by an earlier (overlapping) group.
        const key = `${first.bookId}:${chNum}:${v.number}${v.part || ""}${v.lxx_only ? "_lxx" : ""}`;
        if (seenVerses.has(key)) return false;
        seenVerses.add(key);
        return true;
      });
      if (!verses.length) continue;
      const article = el("article", { className: "chapter-text", lang: "ko" });
      // Clean 봉독 surface (ADR-035): no study-aid chrome — cite chips suppressed
      // (hideCites), parallels (ADR-027 ※) not passed, note anchors not wrapped.
      appendVerses(article, verses, { hideCites: true });
      section.appendChild(article);
      appendedAny = true;
    }
    // Skip a heading-only section: if every chapter was empty (spec no longer
    // matches the loaded text, or all verses were deduped away), render nothing.
    // Commit any queued folder heading(s) only now that real content follows.
    if (appendedAny) {
      flushPendingHeadings();
      panel.appendChild(section);
      renderedAnySection = true;
    }
  }

  // Grouping/boundary logic lives in the pure `_planReadingUnits` (unit-tested);
  // here we just render each unit. Folder units queue a heading (committed lazily
  // when a passage under it actually renders, with depth-aware dropping of empty
  // earlier subtrees); group units render their passage.
  /** @param {BookmarkTreeBookmark} bm */
  const isLoaded = (bm) => chapterCache.has(`${bm.bookId}:${bm.chapter}`);
  for (const unit of _planReadingUnits(seq, endsOf, isLoaded)) {
    if (unit.type === "folder") {
      // A folder at depth d means we've exited every still-queued folder at depth
      // ≥ d whose subtree produced no content — drop those (don't let an empty
      // earlier sibling's heading flush alongside this folder's content).
      while (pendingHeadings.length && pendingHeadings[pendingHeadings.length - 1].depth >= unit.depth) {
        pendingHeadings.pop();
      }
      pendingHeadings.push({
        el: el("h2", { className: `reading-folder reading-folder--d${Math.min(unit.depth, 3)}` }, unit.name || "이름 없는 폴더"),
        depth: unit.depth,
      });
    } else {
      // Drop queued headings that don't CONTAIN this group: a heading at depth ≥
      // the group's depth is a sibling/earlier subtree (e.g. an empty folder that
      // is a sibling of this bookmark), not an ancestor, so it must not be
      // flushed above this group's text. Ancestors (depth < group depth) stay and
      // commit inside renderGroup when a passage actually renders.
      while (pendingHeadings.length && pendingHeadings[pendingHeadings.length - 1].depth >= unit.depth) {
        pendingHeadings.pop();
      }
      renderGroup(unit.bms);
    }
  }

  // Chapters loaded but every group skipped output (specs no longer match the
  // loaded text, or everything was deduped) — show a notice rather than a bare
  // header over an empty panel.
  if (!renderedAnySection) {
    panel.appendChild(emptyState({
      icon: null,
      title: "표시할 본문이 없습니다",
      subtitle: "북마크한 절을 현재 본문에서 찾지 못했습니다.",
    }));
  }

  $app.appendChild(panel);
  return title;
}

// ── Window facade ──
// routing.js calls this via window for the /bookmarks/read route (the views ↔
// router cycle stays on the facade per ADR-034).
window.renderBookmarkReadView = renderBookmarkReadView;

export { renderBookmarkReadView, buildReadingSequence };
