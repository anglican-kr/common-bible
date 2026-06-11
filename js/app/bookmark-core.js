"use strict";
// @ts-check

// Bookmark core — extracted from bookmark.js (ADR-034 후속 PR2~4). DOM-free
// bookmark logic: query/tree ops (QUERY block, loadBookmarks-backed), href/share
// builders (HREF), sort/last-viewed helpers (SORT, localStorage), active-route
// highlight predicates (ACTIVE, _renderPathname set by UI via setRenderPathname).
// bookmark.js (UI) and bookmark-modals.js import these via ESM. Deps: appStorage,
// localStorage.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */

const { loadBookmarks } = window.appStorage;

// Shared guidance copy for "how bookmarks are created" — used by the empty-state
// placeholder (drawer + full view) and the ⋯ menu's 🛈 info popover (bookmark.js /
// bookmark-menu.js). A DOM-free content constant, so it lives in core.
const BOOKMARK_ADD_HELP =
  "성서를 읽다가 오른쪽 위의 북마크 버튼을 누르면 이곳에 북마크가 기록됩니다. 읽던 구절을 누른 후, 여러 절을 선택해 북마크할 수도 있습니다.";

// ── BEGIN BOOKMARK_QUERY ──
// Exercised by tests/unit/bookmark.test.js. Pure tree operations on the
// in-memory bookmark store; only `findExistingChapterBookmarks` calls out
// to `loadBookmarks` (provided as a stub by the test loader prelude).
// ── Bookmark query helpers ──

/**
 * @param {BookmarkTreeNode[]} store
 * @param {(item: BookmarkTreeNode, parent: BookmarkTreeNode[]) => unknown} fn
 * @returns {boolean}
 */
function _walkBookmarks(store, fn) {
  // Guard against folders with missing/null `children` (and a null root) so the
  // walk — and any caller mid-mutation (e.g. cascade delete) — can't throw.
  for (const item of store || []) {
    if (fn(item, store) === false) return false;
    if (item.type === "folder") {
      if (_walkBookmarks(item.children, fn) === false) return false;
    }
  }
  return true;
}

/**
 * @param {string} bookId
 * @param {number} chapter
 * @returns {BookmarkTreeBookmark[]}
 */
function findExistingChapterBookmarks(bookId, chapter) {
  /** @type {BookmarkTreeBookmark[]} */
  const results = [];
  _walkBookmarks(loadBookmarks(), (item) => {
    if (item.type === "bookmark" && item.bookId === bookId && item.chapter === chapter) {
      results.push(item);
    }
  });
  return results;
}

// Header bookmark toggle-off (mobile) presents the chapter's bookmarks with
// checkboxes so the reader removes only the ones they mean to. These two pure
// helpers drive that picker's chrome.

// Tri-state for a "전체 선택" checkbox given how many of N items are currently
// ticked: none → unchecked, all → checked, otherwise indeterminate. Used by the
// bookmark bulk-select mode's select-all toggle.
/**
 * @param {number} selectedCount
 * @param {number} totalCount
 * @returns {"none" | "some" | "all"}
 */
function _selectAllState(selectedCount, totalCount) {
  if (totalCount <= 0 || selectedCount <= 0) return "none";
  if (selectedCount >= totalCount) return "all";
  return "some";
}

// Floating count-chip text for the bookmark select dock (#bm-select-count).
// 0 → the guidance prompt; otherwise the marked-node count (a ticked folder
// counts every node under it, mirroring _bmCountMarked).
/**
 * @param {number} markedCount
 * @returns {string}
 */
function _bmSelectCountLabel(markedCount) {
  return markedCount > 0 ? `${markedCount}개 선택됨` : "항목을 선택하세요";
}

/**
 * @param {BookmarkTreeNode[]} store
 * @param {string} id
 * @returns {{ item: BookmarkTreeNode, parent: BookmarkTreeNode[], index: number } | null}
 */
function _findItemInStore(store, id) {
  for (let i = 0; i < store.length; i++) {
    const it = store[i];
    if (it.id === id) return { item: it, parent: store, index: i };
    if (it.type === "folder") {
      const found = _findItemInStore(it.children, id);
      if (found) return found;
    }
  }
  return null;
}

// Returns the parent folder's id (null = root), or undefined if not found.
/**
 * @param {BookmarkTreeNode[]} store
 * @param {string} id
 * @param {string | null} [parentId]
 * @returns {string | null | undefined}
 */
function _findParentFolderId(store, id, parentId = null) {
  for (const item of store) {
    if (item.id === id) return parentId;
    if (item.type === "folder") {
      const r = _findParentFolderId(item.children, id, item.id);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

/** @param {BookmarkTreeNode[]} store @param {string} id */
function removeItemById(store, id) {
  const found = _findItemInStore(store, id);
  if (found) found.parent.splice(found.index, 1);
}

/**
 * @param {BookmarkTreeNode[]} store
 * @param {string | null | undefined} folderId
 * @param {BookmarkTreeNode} item
 */
function insertItem(store, folderId, item) {
  if (!folderId) {
    store.push(item);
    return;
  }
  const found = _findItemInStore(store, folderId);
  if (found && found.item.type === "folder") {
    found.item.children.push(item);
  } else {
    store.push(item);
  }
}

/**
 * @param {BookmarkTreeNode[]} store
 * @param {number} [depth]
 * @param {Array<{ id: string, name: string, depth: number }>} [options]
 * @returns {Array<{ id: string, name: string, depth: number }>}
 */
function collectFolderOptions(store, depth = 0, options = []) {
  for (const item of store) {
    if (item.type === "folder") {
      options.push({ id: item.id, name: item.name, depth });
      collectFolderOptions(item.children, depth + 1, options);
    }
  }
  return options;
}

/**
 * Ids of every descendant under a node (folders + bookmarks), excluding the
 * node itself; empty for a bookmark. Lets folder delete + the select-delete mode
 * forget the per-device viewed timestamps of a folder's nested bookmarks before
 * the folder is spliced out, and lets a folder tick subsume already-ticked
 * descendants in select mode.
 * @param {BookmarkTreeNode} node
 * @param {string[]} [out]
 * @returns {string[]}
 */
function _descendantIds(node, out = []) {
  if (node && node.type === "folder") {
    for (const child of node.children || []) {
      out.push(child.id);
      _descendantIds(child, out);
    }
  }
  return out;
}
// ── END BOOKMARK_QUERY ──

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

// Sort direction, remembered per mode so switching fields restores that field's
// last direction (and its natural default the first time). The defaults
// reproduce the pre-direction behavior exactly: "title" reads A→Z (asc), the
// date keys read newest-first (desc). "manual" has no direction. Stored as a
// {mode: "asc"|"desc"} map in localStorage, per-device like the mode itself.
const _BM_SORT_DIR_KEY = "bible-bookmark-sort-dir";
/** @type {Record<string, "asc" | "desc">} */
const _BM_SORT_DIR_DEFAULTS = { title: "asc", created: "desc", modified: "desc", viewed: "desc" };
/** @returns {Record<string, string>} */
function _loadSortDirMap() {
  try {
    const raw = localStorage.getItem(_BM_SORT_DIR_KEY);
    const m = raw ? JSON.parse(raw) : null;
    return (m && typeof m === "object") ? m : {};
  } catch { return {}; }
}
/** @param {string} mode @returns {"asc" | "desc"} */
function getBookmarkSortDir(mode) {
  const stored = _loadSortDirMap()[mode];
  if (stored === "asc" || stored === "desc") return stored;
  return _BM_SORT_DIR_DEFAULTS[mode] || "asc";
}
/** @param {string} mode @param {string} dir */
function setBookmarkSortDir(mode, dir) {
  // Direction only applies to the key-sorted modes (not "manual").
  if (!(mode in _BM_SORT_DIR_DEFAULTS)) return;
  if (dir !== "asc" && dir !== "desc") return;
  try {
    const m = _loadSortDirMap();
    m[mode] = dir;
    localStorage.setItem(_BM_SORT_DIR_KEY, JSON.stringify(m));
  } catch { /* private mode */ }
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

// Build an ASCENDING comparator for a sort mode: "title" uses Korean locale
// collation (A→Z), the date keys sort oldest-first. Direction is applied on top
// by sortBookmarkNodes (desc flips the sign). The viewed map is read once per
// sort rather than once per comparison.
/** @param {string} mode @returns {(a: BookmarkTreeNode, b: BookmarkTreeNode) => number} */
function _bookmarkAscComparator(mode) {
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
  return (a, b) => keyOf(a) - keyOf(b);
}

// Display-ordered shallow copy of `nodes` for the active sort mode + direction.
// "manual" keeps the exact stored order (including any folder/bookmark
// interleaving from drag); other modes put folders before bookmarks, each
// sorted by the key, then reversed when the mode's direction is "desc".
/** @param {BookmarkTreeNode[]} nodes @returns {BookmarkTreeNode[]} */
function sortBookmarkNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const mode = getBookmarkSort();
  if (mode === "manual") return list.slice();
  const asc = _bookmarkAscComparator(mode);
  const sign = getBookmarkSortDir(mode) === "desc" ? -1 : 1;
  const cmp = (a, b) => sign * asc(a, b);
  const folders = list.filter(n => n.type === "folder").sort(cmp);
  const marks   = list.filter(n => n.type !== "folder").sort(cmp);
  return [...folders, ...marks];
}
// ── END BOOKMARK_SORT ──

// ── BEGIN BOOKMARK_ACTIVE ──
// Exercised by tests/unit/bookmark.test.js. Tracks the pathname rendered by
// the bookmark tree so each bookmark/folder can self-highlight when the URL
// matches it. The `pathname` parameter defaults to the module-scoped tracker,
// which the bookmark.js (UI) renderer sets via setRenderPathname() from
// window.location.pathname; the explicit parameter lets tests call without
// driving the full renderer. Depends on `_bookmarkHref` (HREF block above).
let _renderPathname = "";

/** @param {string} pathname */
function setRenderPathname(pathname) {
  _renderPathname = pathname;
}

/** @param {BookmarkTreeBookmark} bm @param {string} [pathname] @returns {boolean} */
function _isActiveBookmark(bm, pathname = _renderPathname) {
  return pathname === _bookmarkHref(bm);
}

/** @param {BookmarkTreeFolder} folder @param {string} [pathname] @returns {boolean} */
function _hasActiveDescendant(folder, pathname = _renderPathname) {
  for (const child of (folder.children || [])) {
    if (child.type === "bookmark" && _isActiveBookmark(child, pathname)) return true;
    if (child.type === "folder" && _hasActiveDescendant(child, pathname)) return true;
  }
  return false;
}
// ── END BOOKMARK_ACTIVE ──

export {
  BOOKMARK_ADD_HELP,
  _bookmarkHref, _buildSharePayload,
  getBookmarkSort, setBookmarkSort, getBookmarkSortDir, setBookmarkSortDir,
  markBookmarkViewed, _forgetViewed,
  sortBookmarkNodes,
  _walkBookmarks, findExistingChapterBookmarks, _findItemInStore,
  _findParentFolderId, removeItemById, insertItem, collectFolderOptions,
  _selectAllState, _bmSelectCountLabel, _descendantIds,
  _isActiveBookmark, _hasActiveDescendant, setRenderPathname,
};
