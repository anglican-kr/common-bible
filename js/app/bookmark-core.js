"use strict";
// @ts-check

// Bookmark core — extracted from bookmark.js (ADR-034 후속 PR2). Pure bookmark
// display/link logic with no DOM or UI state: href/share builders (HREF block)
// and the sort/last-viewed helpers (SORT block, localStorage-backed per-device
// view settings). bookmark.js (UI) imports these; no external callers, no
// window facade. Leaf module (localStorage only).

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */

// ── BEGIN BOOKMARK_HREF ──
// Exercised by tests/unit/bookmark.test.js. Pure URL builder — verseSpec="all"
// drops the verse segment so the link points at the whole chapter.
function _bookmarkHref(bm) {
  if (bm.verseSpec === "all") return `/${bm.bookId}/${bm.chapter}`;
  return `/${bm.bookId}/${bm.chapter}/${bm.verseSpec}`;
}

// Public site origin used to build absolute shareable links. Deliberately a
// single named constant (not the live `location.origin`) for two reasons: a link
// copied from localhost / dev must still open the real app, and the domain may
// change later (e.g. a unified bok.anglican.kr — "book of prayer"). Change it
// HERE to repoint every shared link. NOTE: the canonical URL also appears in
// index.html (<link rel="canonical">, og:*) and sitemap.xml — update those too if
// the domain moves.
const SITE_BASE = "https://bible.anglican.kr";

// Build a Web Share API payload for one or more bookmarks. A single bookmark
// shares as {title, url} (the native sheet shows a rich link); multiple share as
// a {title, text} list (label + absolute URL per line). Pure — testable without
// navigator.share.
/**
 * @param {BookmarkTreeBookmark[]} bookmarks
 * @returns {{ title: string, url?: string, text?: string }}
 */
function _buildSharePayload(bookmarks) {
  if (bookmarks.length === 1) {
    const bm = bookmarks[0];
    return { title: bm.label ?? "공동번역성서", url: SITE_BASE + _bookmarkHref(bm) };
  }
  const text = bookmarks
    .map((bm) => `${bm.label ?? ""}\n${SITE_BASE}${_bookmarkHref(bm)}`.trim())
    .join("\n\n");
  return { title: "공동번역성서 북마크", text };
}
// ── END BOOKMARK_HREF ──

// ── BEGIN BOOKMARK_SORT ──
// Bookmark list ordering. The chosen sort is a per-device preference kept in
// localStorage and deliberately NOT synced to Drive — ADR-011 sync covers the
// bookmark objects, not this view setting. "manual" preserves the stored
// (drag-reordered) order; the other modes cluster folders first, then
// bookmarks, each group sorted by the chosen key. Sorting is display-only — it
// returns a shallow copy and never rewrites the store.
const _BM_SORT_KEY = "bible-bookmark-sort";
/** @type {readonly string[]} */
const _BM_SORT_MODES = ["manual", "title", "created", "modified", "viewed"];

/** @returns {string} */
function getBookmarkSort() {
  try {
    const v = localStorage.getItem(_BM_SORT_KEY);
    return v && _BM_SORT_MODES.includes(v) ? v : "manual";
  } catch { return "manual"; }
}
/** @param {string} mode */
function setBookmarkSort(mode) {
  if (!_BM_SORT_MODES.includes(mode)) return;
  try { localStorage.setItem(_BM_SORT_KEY, mode); } catch { /* private mode */ }
}

// Per-device "last viewed" timestamps, keyed by bookmark id. Kept in
// localStorage only: tracking this on the synced object would rewrite (and
// re-sync) a bookmark every time it is merely opened, and would drag the
// "수정한 날짜" key along with it.
const _BM_VIEWED_KEY = "bible-bookmark-viewed";
/** @returns {Record<string, number>} */
function _loadViewedMap() {
  try {
    const raw = localStorage.getItem(_BM_VIEWED_KEY);
    const m = raw ? JSON.parse(raw) : null;
    return (m && typeof m === "object") ? m : {};
  } catch { return {}; }
}
/** @param {string} id */
function markBookmarkViewed(id) {
  if (!id) return;
  try {
    const m = _loadViewedMap();
    m[id] = Date.now();
    localStorage.setItem(_BM_VIEWED_KEY, JSON.stringify(m));
  } catch { /* private mode */ }
}
/** @param {string} id */
function _forgetViewed(id) {
  try {
    const m = _loadViewedMap();
    if (m[id] != null) { delete m[id]; localStorage.setItem(_BM_VIEWED_KEY, JSON.stringify(m)); }
  } catch { /* private mode */ }
}

/** @param {BookmarkTreeNode} n @returns {string} */
function _nodeTitle(n) {
  return (n.type === "folder" ? n.name : n.label) || "";
}

// Build a comparator for a sort mode. Date modes sort newest-first; "title"
// uses Korean locale collation. The viewed map is read once per sort rather
// than once per comparison.
/** @param {string} mode @returns {(a: BookmarkTreeNode, b: BookmarkTreeNode) => number} */
function _bookmarkComparator(mode) {
  if (mode === "title") {
    return (a, b) => _nodeTitle(a).localeCompare(_nodeTitle(b), "ko");
  }
  const viewed = mode === "viewed" ? _loadViewedMap() : null;
  /** @param {BookmarkTreeNode} n @returns {number} */
  const keyOf = (n) => {
    if (mode === "created")  return n.createdAt || 0;
    if (mode === "modified") return n.updatedAt || n.createdAt || 0;
    if (mode === "viewed")   return (viewed && viewed[n.id]) || n.createdAt || 0;
    return 0;
  };
  return (a, b) => keyOf(b) - keyOf(a);
}

// Display-ordered shallow copy of `nodes` for the active sort mode. "manual"
// keeps the exact stored order (including any folder/bookmark interleaving from
// drag); other modes put folders before bookmarks, each sorted by the key.
/** @param {BookmarkTreeNode[]} nodes @returns {BookmarkTreeNode[]} */
function sortBookmarkNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const mode = getBookmarkSort();
  if (mode === "manual") return list.slice();
  const cmp = _bookmarkComparator(mode);
  const folders = list.filter(n => n.type === "folder").sort(cmp);
  const marks   = list.filter(n => n.type !== "folder").sort(cmp);
  return [...folders, ...marks];
}
// ── END BOOKMARK_SORT ──

export {
  _bookmarkHref, _buildSharePayload,
  getBookmarkSort, setBookmarkSort, markBookmarkViewed, _forgetViewed,
  sortBookmarkNodes,
};
