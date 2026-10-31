// @ts-check
"use strict";

// Bookmark core — extracted from bookmark.js (ADR-034 후속 PR2~4). DOM-free
// bookmark logic: query/tree ops (QUERY block, loadBookmarks-backed), href/share
// builders (HREF), sort/last-viewed helpers (SORT, localStorage), active-route
// highlight predicates (ACTIVE, _renderPathname set by UI via setRenderPathname),
// the move of pre-#205 verse ranges to today's form (LEGACY — at startup, on import
// and on a sync merge), and the one save every bookmark screen goes through (COMMIT —
// a refused save is said through window._showSyncSnackbar). bookmark.js (UI) and
// bookmark-modals.js import these via ESM. Deps: appStorage, localStorage,
// verse-spec.js, window.getBooksCache.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */

import { wholeVerseSpec } from "./verse-spec.js";

const { loadBookmarks, saveBookmarks, rewriteBookmarks } = window.appStorage;

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

// True when `id` is anywhere inside `folder`'s subtree. A pure tree predicate used
// by drag-reorder (bookmark-gestures) and select-mode move (bookmark-select) to
// reject dropping a folder into itself/its descendants. Lives here as core tree
// logic (was in bookmark-gestures' DRAG_CORE block; moved ADR-034 후속).
/** @param {BookmarkTreeFolder} folder @param {string} id @returns {boolean} */
function _isDescendant(folder, id) {
  return (folder.children || []).some((c) =>
    c.id === id || (c.type === "folder" && _isDescendant(c, id)));
}

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
/** @param {BookmarkTreeBookmark} bm @returns {string} */
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
    if (Object.hasOwn(m, id)) { delete m[id]; localStorage.setItem(_BM_VIEWED_KEY, JSON.stringify(m)); }
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
    // Own entries only: the map is a plain object, and an id like `toString` read an inherited function (NaN key).
    if (mode === "viewed")   return (viewed && Object.hasOwn(viewed, n.id) && viewed[n.id]) || n.createdAt || 0;
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
  /** @param {BookmarkTreeNode} a @param {BookmarkTreeNode} b */
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

// ── BEGIN BOOKMARK_LEGACY ──
// Exercised by tests/unit/bookmark.test.js — with the VERSE_SPEC block for wholeVerseSpec, and stubs for the store
// (`loadBookmarks` · `rewriteBookmarks`) and `window` (`loadBooks` · `getBooksCache`).
/**
 * 옛 판(2026-04-25부터 06-06 #205까지)이 저장한 절 범위의 줄 글자를 떼어 지금 표기로 옮긴다(사용자 결정 2026-10-22,
 * coding-pitfalls §38 — 「16aa」 → 「16」). 이름이 그 북마크의 옛 기본 이름(「책 장:옛 저장값」 — 저장 대화상자와
 * 합치기가 짓는 이름)과 정확히 같을 때만 새 기본 이름으로 바꾼다. 사용자가 고친 이름은 그대로 둔다. Works on a tree
 * node and on a sync store's flat item alike — both carry these fields.
 * @param {{ bookId?: string, chapter?: number, verseSpec?: string, label?: string }} bm  changed in place
 * @param {import("../types").BooksData} books
 * @returns {boolean} whether it changed
 */
function migrateLegacyBookmark(bm, books) {
  const spec = bm.verseSpec;
  if (typeof spec !== "string") return false;
  const next = wholeVerseSpec(spec);
  if (next === spec) return false;
  const book = books.find((b) => b.id === bm.bookId);
  const prefix = `${book ? (book.short_name_ko || book.name_ko) : bm.bookId} ${bm.chapter}:`;
  if (bm.label === prefix + spec) bm.label = prefix + next;
  bm.verseSpec = next;
  return true;
}

/** @param {BookmarkTreeNode[] | undefined} nodes @returns {boolean} */
function _hasLegacyVerseSpec(nodes) {
  for (const node of nodes || []) {
    if (node?.type === "bookmark" && typeof node.verseSpec === "string" && wholeVerseSpec(node.verseSpec) !== node.verseSpec) {
      return true;
    }
    if (node?.type === "folder" && _hasLegacyVerseSpec(node.children)) return true;
  }
  return false;
}

/**
 * The stored list, both copies, before the first view draws (app.js, through bookmark.js's window facade). The sync
 * store's per-item time (_u) stays as it was: this runs before the sync reads Drive, and a newer time would let this
 * device's copy win over an edit another device made since (사용자 결정 2026-10-22). The default-name rule needs the
 * book list, so only a start with something to move waits for it. The others — every start after the move — draw at
 * once: the calendar, 전례독서 and mobile 설정 views do not load the book list (PR #367 review). If the list does not
 * load, nothing moves and the next start tries again.
 * @returns {Promise<void>}
 */
function migrateStoredBookmarks() {
  let pending = false;
  try {
    pending = _hasLegacyVerseSpec(loadBookmarks());
  } catch (_) { /* a list the store cannot read — nothing to move */ }
  if (!pending) return Promise.resolve();
  return window.loadBooks().then((books) => { rewriteBookmarks((bm) => migrateLegacyBookmark(bm, books)); }, () => {});
}

/**
 * A merged sync document, in place, before it is saved (state-machine.js _applyMergedDoc). Without this the old form
 * came back: the per-item time did not change, so the merge keeps Drive's copy of the two (equal times keep Drive's,
 * store-v2.js mergeDocs), and Drive may still hold the old form. The document
 * came from Drive, and a throw here would stop the save — so an item that is not an object is passed over. The book
 * list is usually loaded by then (search.js preloads it at boot), but a start on a view that does not need it can
 * merge first (PR #367 review). Then the document is saved as it came, and the stored list moves once the list loads
 * — the startup move, a microtask after this save.
 * @param {import("../types").SyncDoc} doc
 */
function migrateLegacyBookmarkDoc(doc) {
  const books = window.getBooksCache();
  if (!books) {
    Promise.resolve().then(migrateStoredBookmarks).then(() => window.rerenderActiveBookmarkTree?.());
    return;
  }
  for (const item of Object.values(doc?.bookmarks?.items ?? {})) {
    if (item?.type === "bookmark") migrateLegacyBookmark(item, books);
  }
}
// ── END BOOKMARK_LEGACY ──

// ── BEGIN BOOKMARK_COMMIT ──
// Every bookmark screen saves the list through this. A save the device refuses changes nothing in storage, and the next
// draw of the list from storage drops the change — so it is said on screen, with what to do (사용자 결정 2026-10-26,
// known-issues §15.4). Dialogs the user typed into stay open when this returns false; the rest redraw or do nothing.
/** @param {BookmarkTreeNode[]} store @returns {boolean} true when the list was saved */
function commitBookmarks(store) {
  const outcome = saveBookmarks(store);
  if (outcome === "saved") return true;
  const msg = outcome === "full"
    ? "저장 공간이 가득 차 바꾼 내용을 저장하지 못했습니다. 쓰지 않는 북마크를 지운 뒤 다시 시도해 주세요."
    : "북마크를 저장하지 못했습니다.";
  if (window._showSyncSnackbar) window._showSyncSnackbar(msg);
  else window.announce?.(msg);
  return false;
}
// ── END BOOKMARK_COMMIT ──

export {
  BOOKMARK_ADD_HELP,
  _bookmarkHref, _buildSharePayload,
  getBookmarkSort, setBookmarkSort, getBookmarkSortDir, setBookmarkSortDir,
  markBookmarkViewed, _forgetViewed,
  sortBookmarkNodes,
  _isDescendant,
  _walkBookmarks, findExistingChapterBookmarks, _findItemInStore,
  _findParentFolderId, removeItemById, insertItem, collectFolderOptions,
  _selectAllState, _bmSelectCountLabel, _descendantIds,
  _isActiveBookmark, _hasActiveDescendant, setRenderPathname,
  migrateLegacyBookmark, migrateStoredBookmarks, migrateLegacyBookmarkDoc,
  commitBookmarks,
};
