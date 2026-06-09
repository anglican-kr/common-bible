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
  if (!segs.length) return whole;
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
  const endRef = last.endCh === first.startCh ? last.endDisplay : `${last.endCh}:${last.endDisplay}`;
  if (endRef === `${first.startV}` || endRef === startRef) return `${bookName} ${startRef}`;
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
    // The first bookmark's user label gives liturgical context (제1독서 등); show
    // it under the reference when it adds something beyond the bare ref.
    const label = (first.label || "").trim();
    if (label && label !== ref) heading.appendChild(el("p", { className: "reading-label" }, label));
    section.appendChild(heading);

    // Merge per-chapter verse coverage across the group, then render one
    // <article> per chapter — keeps each chapter a clean text block (a paragraph
    // gap between joined chapters, ADR-035) and keeps appendVerses' per-array
    // highlight/cite indexing scoped to a single chapter's verses.
    /** @type {Map<number, string[]>} */
    const byChapter = new Map();
    for (const bm of bms) {
      const arr = byChapter.get(bm.chapter) || [];
      arr.push(bm.verseSpec);
      byChapter.set(bm.chapter, arr);
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
    if (appendedAny) panel.appendChild(section);
  }

  /** @param {BookmarkTreeBookmark[]} bms  consecutive run within one parent */
  function flush(bms) {
    if (!bms.length) return;
    let group = [bms[0]];
    for (let i = 1; i < bms.length; i++) {
      if (_isContinuous(endsOf(bms[i - 1]), endsOf(bms[i]))) {
        group.push(bms[i]);
      } else {
        renderGroup(group);
        group = [bms[i]];
      }
    }
    renderGroup(group);
  }

  // Walk the sequence; a folder heading flushes (and so breaks) the current run
  // so different liturgical units never merge across a folder boundary. A
  // bookmark whose chapter JSON didn't load can't render, but it WAS present
  // between its neighbours — so it also breaks the run (flush), otherwise the
  // bookmarks on either side would be treated as list-adjacent and could merge
  // across the gap, violating the adjacent-only merge rule (ADR-035).
  /** @type {BookmarkTreeBookmark[]} */
  let pending = [];
  for (const tok of seq) {
    if (tok.type === "folder") {
      flush(pending);
      pending = [];
      const h = el("h2", { className: `reading-folder reading-folder--d${Math.min(tok.depth, 3)}` }, tok.name || "이름 없는 폴더");
      panel.appendChild(h);
    } else if (chapterCache.has(`${tok.bm.bookId}:${tok.bm.chapter}`)) {
      pending.push(tok.bm);
    } else {
      // Unloadable bookmark: end the current run so its neighbours don't merge.
      flush(pending);
      pending = [];
    }
  }
  flush(pending);

  $app.appendChild(panel);
  return title;
}

// ── Window facade ──
// routing.js calls this via window for the /bookmarks/read route (the views ↔
// router cycle stays on the facade per ADR-034).
window.renderBookmarkReadView = renderBookmarkReadView;

export { renderBookmarkReadView, buildReadingSequence };
