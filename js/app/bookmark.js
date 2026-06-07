"use strict";
// @ts-check

// Bookmark module: utility helpers (verse spec, query, drag&drop) +
// UI rendering (drawer, tree, save/merge/import modals, verse selection
// mode, drawer toolbar handlers).
//
// Phase 6a (ADR-018) introduced the helpers + drag&drop core. Phase 6b
// added the UI surface — drawer open/close, tree render, modal flows, verse
// selection mode. Cross-module callers in app.js (Views/Routing/audio bar
// in Phase 7 territory) reach into bookmark.js via window facade
// assignments at the bottom of this file.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */
/** @typedef {import("../types").VerseSelectDrag} VerseSelectDrag */
/** @typedef {import("../types").DragState} DragState */
/** @typedef {import("../types").BooksData} BooksData */

const { _$, el, clearNode, chUnit, emptyState } = window.appHelpers;
const { createOverlay, attachSheetDrag, attachSheetResize } = window.appOverlay;
const { loadBookmarks, saveBookmarks, generateId } = window.appStorage;
const { readingContext } = window;

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
// Shared by the article-level system-copy handler (views-routing.js, fires on
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

// Tri-state for the "전체 선택" checkbox given how many of the chapter's
// bookmarks are currently ticked: none → unchecked, all → checked, otherwise
// indeterminate.
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

// Confirm-button label: bare "삭제" with nothing selected (button is disabled),
// else the count appended so the destructive action states its scope.
/**
 * @param {number} selectedCount
 * @returns {string}
 */
function _deleteBtnLabel(selectedCount) {
  return selectedCount > 0 ? `삭제 (${selectedCount})` : "삭제";
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

// ── BEGIN DRAG_CORE ──
// Exercised by tests/unit/bookmark.test.js. The test loader concatenates
// this block AFTER the BOOKMARK_QUERY block (since `moveBookmarkItem` calls
// `_findItemInStore` from there) and provides `loadBookmarks` /
// `saveBookmarks` / `window.renderBookmarkTree` stubs in the prelude.
// ── Drag & drop helpers ──

/** @param {BookmarkTreeFolder} folder @param {string} id */
function _isDescendant(folder, id) {
  return (folder.children || []).some((c) =>
    c.id === id || (c.type === "folder" && _isDescendant(c, id)));
}

/**
 * @param {string} draggedId
 * @param {string} targetId
 * @param {"before" | "after" | "into"} position
 */
function moveBookmarkItem(draggedId, targetId, position) {
  if (draggedId === targetId) return;
  const store = loadBookmarks();
  const df = _findItemInStore(store, draggedId);
  if (!df) return;
  const draggedItem = df.item;

  // "into" only valid for folders; validate no circular drop
  if (position === "into") {
    const t = _findItemInStore(store, targetId);
    if (!t || t.item.type !== "folder") position = "after";
    else if (draggedItem.type === "folder" && _isDescendant(draggedItem, targetId)) return;
  } else if (draggedItem.type === "folder" && _isDescendant(draggedItem, targetId)) {
    return;
  }
  df.parent.splice(df.index, 1); // remove from current location

  if (position === "into") {
    const tf = _findItemInStore(store, targetId);
    if (tf && tf.item.type === "folder") tf.item.children.unshift(draggedItem);
    else store.push(draggedItem);
  } else {
    const tf = _findItemInStore(store, targetId);
    if (!tf) {
      store.push(draggedItem);
    } else {
      tf.parent.splice(position === "before" ? tf.index : tf.index + 1, 0, draggedItem);
    }
  }

  saveBookmarks(store);
  // renderBookmarkTree lives in the Phase 6b block below — same module
  // after the Phase 6b extraction, so we call directly.
  _rerenderActiveBookmarkTree();
}
// ── END DRAG_CORE ──

function _clearDragIndicators() {
  document.querySelectorAll(".drag-over-before, .drag-over-after, .drag-over-into")
    .forEach((n) => n.classList.remove("drag-over-before", "drag-over-after", "drag-over-into"));
}

/**
 * @param {number} clientX
 * @param {number} clientY
 */
function _updateDragIndicators(clientX, clientY) {
  _clearDragIndicators();
  const hitEl = document.elementFromPoint(clientX, clientY);
  const target = /** @type {HTMLElement | null} */ (hitEl?.closest("[data-id]"));
  if (!target || target.dataset.id === _dragState?.id) return;
  const rowEl = target.querySelector(".bm-folder-row, .bm-bookmark-row");
  const r = (rowEl || target).getBoundingClientRect();
  const isFolder = target.classList.contains("bm-folder");
  const rel = clientY - r.top;
  if (isFolder && rel > r.height * 0.3 && rel < r.height * 0.7) {
    target.classList.add("drag-over-into");
  } else {
    target.classList.add(rel < r.height / 2 ? "drag-over-before" : "drag-over-after");
  }
}

// ── BEGIN SWIPED_ROW ──
// Exercised by tests/unit/bookmark.test.js. Owns `_swipedRow` (the single
// row currently in mobile swipe-to-reveal state) and the four mutators that
// app.js's Phase 6b territory drives: closeSwipedRow / _openSwipedRow are
// internal callees, while resetSwipedRow / closeSwipedRowIfOutside are the
// cross-module accessors that bookmark UI handlers call. `_dragState` and
// the constants are co-located (ADR-010 mobile pattern) but are not part
// of the swipe state surface.

// Mobile swipe-to-reveal + long-press: tracks the single revealed row so
// opening a new one auto-closes the previous. Bidirectional (ADR-010 개정
// 2026-06-06): swiping a row left reveals 수정 on the right edge, swiping right
// reveals 삭제 on the left edge, and a full swipe executes the action. The
// opaque .bm-row-content is the slider that exposes the edge-anchored actions.
const SWIPE_REVEAL_PX = 88;
const LONG_PRESS_MS = 500;
/** @type {HTMLElement | null} */
let _swipedRow = null;
/** @type {DragState | null} */
let _dragState = null;

// ── Bookmark select-delete mode (ADR-029 개정 / ADR-010) ──
// In-place multi-select on the mobile /bookmarks full view: rows reveal a
// leading selection circle, the tab dock is replaced by #bm-select-bar, and the
// title row swaps ⋯/🛈 for a 전체 선택 toggle. Replaces the old #bm-bulk-delete-modal.
// `_bmSelected` holds only EXPLICIT ticks; a row under an explicitly-ticked
// folder is "covered" (derived, not stored) so the folder owns its subtree.
let _bmSelectMode = false;
/** @type {Set<string>} */
const _bmSelected = new Set();

function _isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

// Clear any open-swipe state + inline slide transform on a row.
/** @param {HTMLElement} row */
function _resetRowSwipe(row) {
  row.classList.remove("bm-swiped", "bm-swiped-edit", "bm-swiped-delete");
  const content = /** @type {HTMLElement | null} */ (row.querySelector(".bm-row-content"));
  if (content) content.style.transform = "";
}

/** @param {HTMLElement | null} except */
function closeSwipedRow(except) {
  if (_swipedRow && _swipedRow !== except) {
    _resetRowSwipe(_swipedRow);
    _swipedRow = null;
  }
}

// Snap a row open in `dir`: "edit" reveals 수정 (right edge, content slid left),
// "delete" reveals 삭제 (left edge, content slid right). The CSS class drives the
// slide, so the inline transform left by the drag is cleared.
/** @param {HTMLElement} row @param {"edit" | "delete"} dir */
function _openSwipedRow(row, dir) {
  closeSwipedRow(row);
  // Reset THIS row too: closeSwipedRow skips it when it's already the tracked
  // row, so re-snapping to the opposite edge would otherwise leave the prior
  // bm-swiped-edit/delete class stacked alongside the new one.
  _resetRowSwipe(row);
  row.classList.add("bm-swiped", dir === "delete" ? "bm-swiped-delete" : "bm-swiped-edit");
  _swipedRow = row;
}

// ── Module-private state accessors (for Phase 6b callers in app.js) ──

// Called by app.js's renderBookmarkTree when the tree re-renders — the
// previously-swiped row may no longer exist after re-render, so reset.
function resetSwipedRow() {
  _swipedRow = null;
}

// Called by app.js's drawer pointerdown handler: closes the swiped row if
// the tap landed outside it. Encapsulates the "is something swiped + did
// the user tap outside" check so app.js doesn't reach into module state.
/** @param {EventTarget | null} target */
function closeSwipedRowIfOutside(target) {
  if (!_swipedRow) return;
  if (target instanceof Node && _swipedRow.contains(target)) return;
  closeSwipedRow(null);
}
// ── END SWIPED_ROW ──

/** @param {HTMLElement} li @param {HTMLElement} row */
function _setupDragHandle(li, row) {
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Select mode owns the row: taps toggle selection, so swipe-to-reveal and
    // drag-to-reorder are both suppressed (the row click handler does the work).
    if (_bmSelectMode) return;
    if (/** @type {HTMLElement} */ (e.target).closest("button")) return;
    // Buttons inside the mobile-only revealed actions live outside .bm-row-content
    // but inside the row; the closest("button") check above already excludes them.

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const origRect = li.getBoundingClientRect();
    const isTouch = e.pointerType !== "mouse";
    const contentEl = /** @type {HTMLElement | null} */ (row.querySelector(".bm-row-content"));
    const canSwipe = _isMobileViewport() && isTouch && !!contentEl;
    // Pointer started on the reorder handle (≡, manual mode only): treat it as a
    // dedicated grab — start the drag immediately on move (no long-press, no
    // swipe classification), the way iOS's reorder control behaves.
    const onHandle = e.target instanceof Element && !!e.target.closest(".bm-drag-handle");
    // Drag-to-reorder only makes sense under 직접 정렬 (manual); an active
    // auto-sort would re-sort the drop away. Evaluated per gesture so a sort
    // change takes effect immediately. Swipe-to-reveal is always available.
    const canDrag = getBookmarkSort() === "manual";
    // null until the first significant move classifies the gesture.
    // "drag" → reorder, "swipe" → reveal actions, "abort" → cede to browser scroll
    /** @type {"drag" | "swipe" | "abort" | null} */
    let mode = null;
    let dragStarted = false;
    // Direction the row is already open in, so a re-grab continues from the
    // revealed offset. "edit" = 수정 (left edge, content slid right), "delete" =
    // 삭제 (right edge, content slid left).
    /** @type {"edit" | "delete" | null} */
    const startedDir = row.classList.contains("bm-swiped-edit") ? "edit"
      : row.classList.contains("bm-swiped-delete") ? "delete" : null;
    const startedSwiped = !!startedDir;
    const baseOffset = startedDir === "edit" ? SWIPE_REVEAL_PX
      : startedDir === "delete" ? -SWIPE_REVEAL_PX : 0;
    const rowWidth = origRect.width;
    // Full-swipe threshold: past this on release, the action executes.
    const commitPx = Math.max(rowWidth * 0.45, SWIPE_REVEAL_PX + 40);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let longPressTimer = null;

    // Touch devices: long-press without movement enters drag-to-reorder mode
    // (haptic feedback acts as the visual cue). Action panel reveal is
    // horizontal-swipe only. Mouse users start dragging immediately on move.
    if (canDrag && isTouch && !startedSwiped) {
      longPressTimer = setTimeout(() => {
        if (mode !== null) return;
        mode = "drag";
        _beginDrag();
        if (navigator.vibrate) {
          try { navigator.vibrate(10); } catch {}
        }
      }, LONG_PRESS_MS);
    }

    function _beginDrag() {
      dragStarted = true;
      const ghost = document.createElement("li");
      ghost.className = "bm-drag-ghost";
      ghost.style.width = origRect.width + "px";
      ghost.style.left = origRect.left + "px";
      // Pin to the source row's position so long-press entry (where no
      // pointermove has fired yet) doesn't flash the ghost at the document's
      // default position before the user starts moving.
      ghost.style.top = origRect.top + "px";
      // li always renders a row child first (.bm-folder-row or .bm-bookmark-row);
      // the cascade is defensive against partial DOM during transitions.
      const rowSource = li.querySelector(".bm-folder-row, .bm-bookmark-row") || li.firstElementChild;
      if (rowSource) ghost.appendChild(rowSource.cloneNode(true));
      document.body.appendChild(ghost);
      try { row.setPointerCapture(pointerId); } catch {}
      li.classList.add("bm-dragging");
      _dragState = { id: li.dataset.id ?? "", ghost, origLi: li, startY, origTop: origRect.top };
    }

    const clearLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const cleanupPointerHandlers = () => {
      clearLongPress();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      if (row.hasPointerCapture(pointerId)) {
        try { row.releasePointerCapture(pointerId); } catch {}
      }
    };

    /** @param {PointerEvent} e */
    function onMove(e) {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (mode === null) {
        if (Math.hypot(dx, dy) < 5) return;
        clearLongPress();
        if (onHandle && canDrag) {
          // Dedicated reorder handle → start dragging right away (touch + mouse),
          // bypassing long-press and swipe classification.
          mode = "drag";
          _beginDrag();
        } else if (canSwipe && Math.abs(dx) > Math.abs(dy)) {
          // Horizontal-dominant gesture on touch → swipe-reveal action panel.
          mode = "swipe";
          row.classList.add("bm-swiping");
          row.setPointerCapture(pointerId);
        } else if (isTouch) {
          // Touch + vertical movement before long-press fired → user is
          // scrolling the drawer body, not dragging. Cede to the browser.
          mode = "abort";
          cleanupPointerHandlers();
          return;
        } else if (canDrag) {
          // Mouse user → immediate drag-to-reorder on any movement.
          mode = "drag";
          _beginDrag();
        } else {
          // Mouse + auto-sort: no reorder. Cede to scroll/click.
          mode = "abort";
          cleanupPointerHandlers();
          return;
        }
      }

      if (mode === "swipe") {
        let offset = baseOffset + dx;
        // Clamp within the row; either direction is allowed (bidirectional).
        if (offset > rowWidth) offset = rowWidth;
        if (offset < -rowWidth) offset = -rowWidth;
        // Slide the content; the edge-anchored action beneath is exposed. iOS
        // convention: swipe left (offset < 0) → content slides left → expose the
        // RIGHT (trailing) edge → 삭제. Swipe right (offset > 0) → 수정 (left).
        if (contentEl) contentEl.style.transform = `translateX(${offset}px)`;
        // Show the action for the current direction (full-bleed behind content).
        row.classList.toggle("bm-swiping-delete", offset < 0);
        row.classList.toggle("bm-swiping-edit", offset > 0);
        return;
      }

      // mode === "drag"
      if (!_dragState) return;
      _dragState.ghost.style.top = (_dragState.origTop + (e.clientY - _dragState.startY)) + "px";
      _updateDragIndicators(e.clientX, e.clientY);
    }

    /** @param {PointerEvent} e */
    function finish(e) {
      if (e.pointerId !== pointerId) return;
      cleanupPointerHandlers();

      if (mode === "swipe") {
        row.classList.remove("bm-swiping", "bm-swiping-delete", "bm-swiping-edit");
        if (contentEl) contentEl.style.transform = "";
        const finalOffset = baseOffset + (e.clientX - startX);
        if (finalOffset <= -commitPx) {
          // Full swipe left → 삭제 (trigger the revealed button's handler).
          closeSwipedRow(null);
          /** @type {HTMLElement | null} */ (row.querySelector(".bm-swipe-delete"))?.click();
        } else if (finalOffset >= commitPx) {
          // Full swipe right → 수정.
          closeSwipedRow(null);
          /** @type {HTMLElement | null} */ (row.querySelector(".bm-swipe-edit"))?.click();
        } else if (finalOffset <= -SWIPE_REVEAL_PX / 2) {
          _openSwipedRow(row, "delete");
        } else if (finalOffset >= SWIPE_REVEAL_PX / 2) {
          _openSwipedRow(row, "edit");
        } else {
          _resetRowSwipe(row);
          if (_swipedRow === row) _swipedRow = null;
        }
        return;
      }

      if (dragStarted) {
        // Suppress the synthetic click that follows pointerup so the bookmark
        // link doesn't navigate / the folder doesn't toggle when the user
        // releases a drag.
        document.addEventListener("click", (ce) => { ce.stopPropagation(); ce.preventDefault(); }, { capture: true, once: true });
      }

      if (!_dragState) return;
      const ds = _dragState;
      _dragState = null;
      ds.ghost.remove();
      ds.origLi.classList.remove("bm-dragging");
      const overItem = /** @type {HTMLElement | null} */ (document.querySelector(".drag-over-before, .drag-over-after, .drag-over-into"));
      if (overItem) {
        const pos = overItem.classList.contains("drag-over-into") ? "into"
          : overItem.classList.contains("drag-over-before") ? "before" : "after";
        const targetId = overItem.dataset.id;
        if (targetId) moveBookmarkItem(ds.id, targetId, /** @type {"before" | "after" | "into"} */ (pos));
      }
      _clearDragIndicators();
    }

    /** @param {PointerEvent} e */
    function cancel(e) {
      if (e.pointerId !== pointerId) return;
      cleanupPointerHandlers();

      if (mode === "swipe") {
        row.classList.remove("bm-swiping", "bm-swiping-delete", "bm-swiping-edit");
        if (contentEl) contentEl.style.transform = "";
        // Snap back to the pre-gesture state on cancel.
        if (startedDir) {
          _openSwipedRow(row, startedDir);
        } else {
          _resetRowSwipe(row);
          if (_swipedRow === row) _swipedRow = null;
        }
        return;
      }

      if (!_dragState) return;
      _dragState.ghost.remove();
      _dragState.origLi.classList.remove("bm-dragging");
      _clearDragIndicators();
      _dragState = null;
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  });
}


// ── BEGIN PHASE 6B (UI) ──
// Bookmark UI: drawer + tree rendering + save/merge/import modals + verse
// selection mode + drawer toolbar handlers. Phase 6b of ADR-018; the state
// vars below were previously in app.js's "// ── Bookmark state ──" section.

// ── Bookmark state ──
// Verse-selection state + current book/chapter were extracted to
// js/app/reading-context.js (ADR-018 Phase 6a) — see destructured
// `readingContext` at the top of this file. Only bookmark-UI-specific
// state remains here pending Phase 6b extraction to bookmark.js.
// All overlay lifecycle (focus-trap, last-focus, background inert, scrim) now
// lives inside the overlay controllers (ADR-032) — modals, drawer, etc. The
// drawer's only remaining per-flow state is the animated-dismiss fallback timer
// (its closeTransition; cleared on reopen). _bmNewFolderCallback is the
// create-folder continuation.
/** @type {((id: string) => void) | null} */
let _bmNewFolderCallback = null;
/** @type {{ getValue: () => string|null, close: () => void } | null} */
let _bmNewFolderParentCombo = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookmarkDrawerCloseTimer = null;
// `_dragState` was extracted to js/app/bookmark.js (ADR-018 Phase 6a) along
// with the drag & drop pointer handling that owns it.
const BOOKMARK_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #launch-screen, #install-scrim, #install-modal, #verse-select-bar, #bm-select-bar";

// ── Bookmark UI ──

const $bookmarkScrim = _$("bookmark-scrim");
const $bookmarkDrawer = _$("bookmark-drawer");
const $bookmarkDrawerClose = _$("bookmark-drawer-close");
const $bookmarkDrawerBody = _$("bookmark-drawer-body");
const $bmSaveChapterBtn = /** @type {HTMLButtonElement} */ (_$("bm-save-chapter-btn"));
const $bmSelectVersesBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-verses-btn"));
const $bmAddFolderBtn = /** @type {HTMLButtonElement} */ (_$("bm-add-folder-btn"));
const $bmOverflowBtn = _$("bm-overflow-btn");
const $bmOverflowPanel = _$("bm-overflow-panel");
const $bmExportBtn = _$("bm-export-btn");
const $bmImportBtn = _$("bm-import-btn");
const $bmImportInput = /** @type {HTMLInputElement} */ (_$("bm-import-input"));
const $driveDisconnectScrim = _$("drive-disconnect-scrim");
const $driveDisconnectModal = _$("drive-disconnect-modal");
const $driveDisconnectDelete = _$("drive-disconnect-delete");
const $driveDisconnectKeep = _$("drive-disconnect-keep");
const $driveDisconnectCancel = _$("drive-disconnect-cancel");

// Standalone modal (settings flow), not part of the stacked bookmark Escape
// group — so it owns Escape directly via closeOnEsc (ADR-032).
const driveDisconnectOverlay = createOverlay({
  panel: $driveDisconnectModal,
  scrim: $driveDisconnectScrim,
  closeOnEsc: true,
  initialFocus: () => $driveDisconnectKeep,
});

function openDriveDisconnectModal() { driveDisconnectOverlay.open(); }
function closeDriveDisconnectModal() { driveDisconnectOverlay.close(); }

$driveDisconnectCancel.addEventListener("click", closeDriveDisconnectModal);
$driveDisconnectScrim.addEventListener("click", closeDriveDisconnectModal);

$driveDisconnectKeep.addEventListener("click", () => {
  closeDriveDisconnectModal();
  window.driveSync?.signOut();
});

$driveDisconnectDelete.addEventListener("click", async () => {
  closeDriveDisconnectModal();
  await window.driveSync?.deleteRemoteFile();
  window.driveSync?.signOut();
});
const $bmImportScrim = _$("bm-import-scrim");
const $bmImportModal = _$("bm-import-modal");
const $bmImportBody = _$("bm-import-body");
const $bmImportMerge = _$("bm-import-merge");
const $bmImportOverwrite = _$("bm-import-overwrite");
const $bmImportCancel = _$("bm-import-cancel");
const $bmSaveScrim = _$("bm-save-scrim");
const $bmSaveModal = _$("bm-save-modal");
const $bmSaveClose = _$("bm-save-close");
const $bmSaveTitle = _$("bm-save-title");
const $bmSaveBody = _$("bm-save-body");
const $bmNewFolderScrim = _$("bm-new-folder-scrim");
const $bmNewFolderModal = _$("bm-new-folder-modal");
const $bmNewFolderClose = _$("bm-new-folder-close");
const $bmNewFolderInput = /** @type {HTMLInputElement} */ (_$("bm-new-folder-input"));
const $bmNewFolderParent = _$("bm-new-folder-parent");
const $bmNewFolderConfirm = _$("bm-new-folder-confirm");
const $bmNewFolderCancel = _$("bm-new-folder-cancel");
const $bmMergeScrim = _$("bm-merge-scrim");
const $bmMergeModal = _$("bm-merge-modal");
const $bmMergeBody = _$("bm-merge-body");
const $bmMergeYes = _$("bm-merge-yes");
const $bmMergeNo = _$("bm-merge-no");
const $bmMergeCancel = _$("bm-merge-cancel");
const $bmConfirmScrim = _$("bm-confirm-scrim");
const $bmConfirmModal = _$("bm-confirm-modal");
const $bmConfirmTitle = _$("bm-confirm-title");
const $bmConfirmBody = _$("bm-confirm-body");
const $bmConfirmOk = _$("bm-confirm-ok");
const $bmConfirmCancel = _$("bm-confirm-cancel");
const $bmChapterDeleteScrim = _$("bm-chapter-delete-scrim");
const $bmChapterDeleteModal = _$("bm-chapter-delete-modal");
const $bmChapterDeleteAll = /** @type {HTMLInputElement} */ (_$("bm-chapter-delete-all"));
const $bmChapterDeleteList = _$("bm-chapter-delete-list");
const $bmChapterDeleteConfirm = /** @type {HTMLButtonElement} */ (_$("bm-chapter-delete-confirm"));
const $bmChapterDeleteCancel = _$("bm-chapter-delete-cancel");
const $verseSelectBar = _$("verse-select-bar");
const $verseSelectCount = _$("verse-select-count");
const $verseSelectBookmarkBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-bookmark-btn"));
const $verseSelectCopyBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-copy-btn"));
// Note action is a placeholder slot (ADR-030) — not yet built. It uses
// aria-disabled (not `disabled`) so a tap still announces "coming soon".
const $verseSelectNoteBtn = _$("verse-select-note-btn");
const $verseSelectCancelBtn = _$("verse-select-cancel-btn");
// Bookmark select dock (ADR-029 개정) — mirrors the verse-select bar (공유·이동·삭제 pill + 취소).
const $bmSelectBar = _$("bm-select-bar");
const $bmSelectCount = _$("bm-select-count");
const $bmSelectShareBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-share-btn"));
const $bmSelectMoveBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-move-btn"));
const $bmSelectDeleteBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-delete-btn"));
const $bmSelectCancelBtn = _$("bm-select-cancel-btn");
// Move-to-folder modal (선택 모드 → 이동).
const $bmMoveScrim = _$("bm-move-scrim");
const $bmMoveModal = _$("bm-move-modal");
const $bmMoveList = _$("bm-move-list");
const $bmMoveNewFolder = _$("bm-move-new-folder");
const $bmMoveCancel = _$("bm-move-cancel");

// Build the chevron-left back button for page title headers
function buildBackBtn(ariaLabel, fallback) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "title-back-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M15.5 5 8.5 12l7 7");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  const btn = el("button", { className: "title-back-btn", "aria-label": ariaLabel }, svg);
  btn.addEventListener("click", () => {
    if (history.length > 1) history.back();
    else navigate(fallback);
  });
  return btn;
}

// Build the home button for reading-view headers. Unlike buildBackBtn this
// always navigates to a fixed destination (the book list / division tab),
// never history.back() — the breadcrumb is gone, so this is the canonical way
// back up to the book list from a chapter / prologue / chapter-list view.
function buildHomeBtn(target, ariaLabel) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "title-back-icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M3 11.5 12 4l9 7.5M5.5 9.8V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.8");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  const btn = el("button", { className: "title-back-btn title-home-btn", "aria-label": ariaLabel }, svg);
  btn.addEventListener("click", () => navigate(target));
  return btn;
}

// Material Symbols "bookmarks" — outlined for the empty state, filled for the
// has-bookmark state. The icon now uses var(--accent) in both states (matches
// the other header icons); the outline ↔ fill swap is the only "this chapter
// is bookmarked" visual cue.
const BOOKMARK_ICON_OUTLINE = "M160-80v-560q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v560L400-200 160-80Zm80-121 160-86 160 86v-439H240v439Zm480-39v-560H280v-80h440q33 0 56.5 23.5T800-800v560h-80ZM240-640h320-320Z";
const BOOKMARK_ICON_FILLED = "M160-80v-560q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v560L400-200 160-80Zm560-160v-560H280v-80h440q33 0 56.5 23.5T800-800v560h-80Z";
// "+" glyph centred in the front bookmark's hollow — composited as a second
// <path> for the not-yet-bookmarked ("add this chapter") state. Same
// 0 -960 960 960 coordinate system as the bookmark paths above.
const BOOKMARK_ICON_ADD_PLUS = "M372-555h56v57h57v56h-57v57h-56v-57h-57v-56h57v-57Z";

// Paint the header bookmark button's glyph for the current state. Bookmarked =
// filled (unchanged cue). Not bookmarked = outline + "+" badge so the affordance
// reads as "add this chapter". Rebuilds children because the add state needs two
// paths; both buildBookmarkHeaderBtn and refreshBookmarkHeaderBtn route through
// here so the build and the live toggle stay in sync.
/** @param {SVGElement} svg @param {boolean} hasBookmark */
function _setBookmarkBtnIcon(svg, hasBookmark) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const mk = (d) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    return p;
  };
  if (hasBookmark) {
    svg.appendChild(mk(BOOKMARK_ICON_FILLED));
  } else {
    svg.appendChild(mk(BOOKMARK_ICON_OUTLINE));
    svg.appendChild(mk(BOOKMARK_ICON_ADD_PLUS));
  }
}

// Build the bookmark icon SVG button for the chapter header
function buildBookmarkHeaderBtn(bookId, chapter) {
  const btn = el("button", {
    className: "title-bookmark-btn",
    "aria-label": "북마크",
    type: "button",
  });
  const hasBookmark = findExistingChapterBookmarks(bookId, chapter).length > 0;
  if (hasBookmark) {
    btn.classList.add("has-bookmark");
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Size comes from CSS (.title-bookmark-btn svg) in rem — see style.css header-icon rule.
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  _setBookmarkBtnIcon(svg, hasBookmark);
  btn.appendChild(svg);
  // 모바일 읽기 화면(장 맥락 있음)에선 헤더 북마크가 토글로 동작 —
  // 이미 북마크된 장이면 삭제 확인 모달, 아니면 '이 장 저장' 모달.
  // 그 외(데스크탑 전체, 또는 책 목록·장 선택처럼 장 맥락 없음)는 기존 드로어.
  btn.addEventListener("click", () => {
    if (_isMobileViewport() && bookId && chapter != null) {
      // Re-check live: the rendered state may be stale after edits elsewhere.
      const existing = findExistingChapterBookmarks(bookId, chapter);
      if (existing.length > 0) openChapterDeleteModal(existing);
      else openSaveModal("chapter");
    } else {
      openBookmarkDrawer(bookId, chapter);
    }
  });
  return btn;
}

function refreshBookmarkHeaderBtn() {
  const btn = document.querySelector(".title-bookmark-btn");
  if (!btn || !readingContext.bookId || !readingContext.chapter) return;
  const hasBookmark = findExistingChapterBookmarks(readingContext.bookId, readingContext.chapter).length > 0;
  btn.classList.toggle("has-bookmark", hasBookmark);
  const svg = btn.querySelector("svg");
  if (svg) _setBookmarkBtnIcon(svg, hasBookmark);
}

// The drawer's overlay lifecycle now runs through the shared controller
// (ADR-032). Its one bespoke trait — an animated slide-out dismiss — is carried
// by closeTransition: the logical close (scrim, inert, trap, focus restore)
// happens immediately while `drawer-closing` plays, then finalizeHide hides the
// panel on animationend (350ms fallback). The controller's seq guard cancels a
// pending hide if the drawer is reopened mid-animation; we still clear the
// fallback timer + the drawer-closing class on (re)open so the in-animation
// can take over and a stale timer never resets a freshly dragged height.
// closeOnEsc stays off — bookmark.js's stacked Escape router closes the drawer
// (lowest priority). Background scroll-lock (iOS position:fixed) is drawer-
// specific, handled via onOpen/onClose like the install modal.
const drawerOverlay = createOverlay({
  panel: $bookmarkDrawer,
  scrim: $bookmarkScrim,
  inertSelectors: BOOKMARK_INERT_SELECTORS,
  initialFocus: () => $bookmarkDrawerClose,
  onOpen: () => {
    if (_bookmarkDrawerCloseTimer) { clearTimeout(_bookmarkDrawerCloseTimer); _bookmarkDrawerCloseTimer = null; }
    $bookmarkDrawer.classList.remove("drawer-closing"); // cancel any in-flight close anim
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.dataset.scrollY = String(scrollY);
  },
  onClose: () => {
    closeSwipedRow(null);
    $bmOverflowPanel.hidden = true;
    $bmOverflowBtn.setAttribute("aria-expanded", "false");
    const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
  },
  closeTransition: (panel, finalizeHide) => {
    panel.classList.add("drawer-closing");
    const done = () => {
      if (_bookmarkDrawerCloseTimer) { clearTimeout(_bookmarkDrawerCloseTimer); _bookmarkDrawerCloseTimer = null; }
      finalizeHide(); // no-op if reopened in the meantime (seq guard)
      panel.classList.remove("drawer-closing");
      panel.style.height = "";
      panel.style.width = "";
    };
    panel.addEventListener("animationend", done, { once: true });
    _bookmarkDrawerCloseTimer = setTimeout(done, 350); // fallback
  },
});

function openBookmarkDrawer(bookId, chapter) {
  // Update toolbar visibility based on whether we're in a chapter, and render
  // the tree before the controller reveals the drawer.
  const inChapter = bookId && chapter;
  $bmSaveChapterBtn.disabled = !inChapter;
  $bmSelectVersesBtn.disabled = !inChapter;
  _rerenderActiveBookmarkTree();
  drawerOverlay.open();
}

function closeBookmarkDrawer() { drawerOverlay.close(); }

// ── Bookmark tree rendering ──

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

// Build the two edge-anchored mobile swipe actions: 삭제 (left edge, revealed by
// swiping the row right) and 수정 (right edge, revealed by swiping left). They sit
// behind the opaque .bm-row-content, which slides to expose them. Hidden on
// desktop via CSS. Returns the buttons so the row can append them under content.
/** @param {string} label @param {() => void} editAction @param {() => void} deleteAction */
function _buildSwipeActions(label, editAction, deleteAction) {
  const del = el("button", {
    className: "bm-swipe-action bm-swipe-delete",
    type: "button",
    "aria-label": `${label} 삭제`,
  }, el("span", { className: "bm-swipe-label" }, "삭제"));
  del.addEventListener("click", deleteAction);
  const edit = el("button", {
    className: "bm-swipe-action bm-swipe-edit",
    type: "button",
    "aria-label": `${label} 수정`,
  }, el("span", { className: "bm-swipe-label" }, "수정"));
  edit.addEventListener("click", editAction);
  return { del, edit };
}

// Reorder grab handle (≡) shown at a row's trailing edge ONLY in 직접 정렬
// (manual) mode — renderBookmarkTree toggles `bm-sortable` on the tree and CSS
// reveals it. Three stacked lines = iOS's reorder control; it both affords drag
// and signals "you're in the reorderable mode". aria-hidden: a pointer-only
// affordance (no keyboard reorder yet), and the row already names itself.
function _buildDragHandle() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  for (const y of [8, 12, 16]) {
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", "5");
    line.setAttribute("x2", "19");
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    svg.appendChild(line);
  }
  return el("span", { className: "bm-drag-handle", "aria-hidden": "true" }, svg);
}

// Leading selection circle for select mode (ADR-029 개정). Always built into the
// row; hidden until body.bm-select-active reveals it (slide-in). The checkmark
// inside only shows on .is-selected / .is-covered rows (CSS). aria-hidden: the
// row's own click toggles it and the count is announced via #bm-select-count.
function _buildSelectCircle() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M5 12.5 10 17.5 19 7");
  svg.appendChild(path);
  return el("span", { className: "bm-select-circle", "aria-hidden": "true" }, svg);
}

function _buildBookmarkItem(bm, depth) {
  const li = el("li", { role: "treeitem", className: "bm-bookmark", "data-id": bm.id, tabIndex: "-1" });
  if (depth > 0) li.setAttribute("aria-level", String(depth + 1));
  const isActive = _isActiveBookmark(bm);
  const row = el("div", { className: "bm-bookmark-row" + (isActive ? " bm-active" : "") });
  // Always wire the gesture handler: it owns mobile swipe-to-reveal (rename/
  // delete) too, which must work under any sort. Drag-to-reorder self-gates on
  // the active sort inside the handler.
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
  // Nested-row indent lives on the content (mobile keeps the row full-bleed so
  // the swipe action reaches the screen edge) — one folder level = --space-8.
  if (depth > 0) content.style.setProperty("--bm-indent", `calc(var(--space-8) * ${depth})`);
  const typeIcon = el("span", { className: "bm-bookmark-type-icon" });
  typeIcon.appendChild(_buildBookmarkTypeIcon(isActive));
  const link = el("a", { className: "bm-bookmark-link", href: _bookmarkHref(bm), draggable: "false" });
  link.appendChild(el("span", { className: "bm-bookmark-label" }, bm.label));
  const book = (window.getBooksCache() ?? []).find(b => b.id === bm.bookId);
  const bookName = book ? (book.short_name_ko || book.name_ko) : bm.bookId;
  const refText = bm.verseSpec === "all"
    ? `${bookName} ${bm.chapter}${chUnit(bm.bookId)}`
    : `${bookName} ${bm.chapter}:${bm.verseSpec}`;
  link.appendChild(el("span", { className: "bm-bookmark-ref" }, refText));
  link.addEventListener("click", (e) => {
    e.preventDefault();
    // In select mode the row click (below) toggles selection; never navigate.
    if (_bmSelectMode) return;
    if (row.classList.contains("bm-swiped")) {
      closeSwipedRow(null);
      return;
    }
    markBookmarkViewed(bm.id);
    closeBookmarkDrawer();
    navigate(_bookmarkHref(bm));
  });

  const editAction = () => {
    closeSwipedRow(null);
    openSaveModal("edit", { existingId: bm.id });
  };
  const deleteAction = () => {
    // Close the swipe panel up front (mirrors editAction) — otherwise canceling
    // the confirm leaves the row stuck open with the 삭제 action still exposed,
    // since closing only happened inside onConfirm.
    closeSwipedRow(null);
    openConfirmModal({
      title: "북마크 삭제",
      message: `"${bm.label}" 북마크를 삭제할까요?`,
      confirmLabel: "삭제",
      onConfirm: () => {
        _forgetViewed(bm.id);
        const store = loadBookmarks();
        removeItemById(store, bm.id);
        saveBookmarks(store);
        _rerenderActiveBookmarkTree();
        refreshBookmarkHeaderBtn();
      },
    });
  };

  const actions = el("div", { className: "bm-item-actions" });
  const editBtn = el("button", { className: "bm-action-btn bm-edit-btn", type: "button" }, "수정");
  editBtn.addEventListener("click", editAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  // Mobile swipe actions (edge-anchored, hidden on desktop): 삭제 left, 수정 right.
  const { del, edit } = _buildSwipeActions(bm.label ?? "", editAction, deleteAction);

  content.appendChild(typeIcon);
  content.appendChild(link);
  content.appendChild(actions);
  content.appendChild(_buildDragHandle());
  row.appendChild(del);
  row.appendChild(edit);
  row.appendChild(content);
  row.appendChild(_buildSelectCircle());
  // Select mode: a row tap toggles selection instead of navigating.
  row.addEventListener("click", (e) => {
    if (!_bmSelectMode) return;
    e.preventDefault();
    _toggleBmSelect(bm.id);
  });
  li.appendChild(row);
  return li;
}

/**
 * Material Icons "folder" (24dp) — same contour as the filled symbol, stroked only (hollow).
 * @param {boolean} [active]
 * @param {number} [size]
 */
function _buildBookmarkTypeIcon(active = false, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  if (active) {
    svg.setAttribute("viewBox", "0 0 24 24");
    path.setAttribute("d", "M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z");
  } else {
    svg.setAttribute("viewBox", "0 -960 960 960");
    path.setAttribute("d", "M200-120v-640q0-33 23.5-56.5T280-840h400q33 0 56.5 23.5T760-760v640L480-240 200-120Zm80-122 200-86 200 86v-518H280v518Zm0-518h400-400Z");
  }
  svg.appendChild(path);
  return svg;
}

// ── BEGIN BOOKMARK_ACTIVE ──
// Exercised by tests/unit/bookmark.test.js. Tracks the pathname rendered by
// the bookmark tree so each bookmark/folder can self-highlight when the URL
// matches it. The `pathname` parameter defaults to the module-scoped tracker
// (set by renderBookmarkTree() from window.location.pathname) and exists as
// an explicit parameter so tests can call without needing to drive the full
// renderer.
let _renderPathname = "";

function _isActiveBookmark(bm, pathname = _renderPathname) {
  return pathname === _bookmarkHref(bm);
}

function _hasActiveDescendant(folder, pathname = _renderPathname) {
  for (const child of (folder.children || [])) {
    if (child.type === "bookmark" && _isActiveBookmark(child, pathname)) return true;
    if (child.type === "folder" && _hasActiveDescendant(child, pathname)) return true;
  }
  return false;
}
// ── END BOOKMARK_ACTIVE ──

function _buildMaterialFolderIcon({ size = 18 } = {}) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z");
  svg.appendChild(path);
  return svg;
}

function _buildFolderToggleIcon(open, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  if (open) {
    path.setAttribute("d", "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640H447l-80-80H160v480l96-320h684L837-217q-8 26-29.5 41.5T760-160H160Zm84-80h516l72-240H316l-72 240Zm0 0 72-240-72 240Zm-84-400v-80 80Z");
  } else {
    path.setAttribute("d", "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z");
  }
  svg.appendChild(path);
  return svg;
}

/**
 * @param {Array<{ id: string, name: string, depth: number }>} folderOptions
 * @param {string|null|undefined} selectedFolderId
 * @param {{ idPrefix?: string, allowNewFolder?: boolean }} [opts] idPrefix scopes the
 *   element ids so two comboboxes can coexist (save modal + new-folder parent picker);
 *   allowNewFolder=false drops the inline "+ 새 폴더" action (the new-folder modal's own
 *   parent picker must not spawn another new-folder modal).
 * @returns {{ el: HTMLElement, getValue: () => string|null, close: () => void }}
 */
function _buildFolderCombobox(folderOptions, selectedFolderId, opts = {}) {
  const idPrefix = opts.idPrefix || "bm-folder-combobox";
  const allowNewFolder = opts.allowNewFolder !== false;
  const initial = selectedFolderId != null && String(selectedFolderId) !== "" ? String(selectedFolderId) : "";
  const wrap = el("div", { className: "bm-folder-combobox", id: idPrefix });
  const hidden = el("input", { type: "hidden", className: "bm-folder-combobox-input", value: initial });
  const listId = `${idPrefix}-listbox`;
  const iconSlot = el("span", { className: "bm-folder-combobox-btn-icon" });
  iconSlot.appendChild(_buildMaterialFolderIcon({ size: 16 }));
  const textSlot = el("span", { className: "bm-folder-combobox-btn-label" });
  const chevron = el("span", { className: "bm-folder-combobox-chevron", "aria-hidden": "true" }, "▾");
  const btn = el("button", {
    type: "button",
    id: `${idPrefix}-btn`,
    className: "bm-folder-combobox-btn",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-controls": listId,
  });
  btn.appendChild(iconSlot);
  btn.appendChild(textSlot);
  btn.appendChild(chevron);

  const list = el("ul", { id: listId, className: "bm-folder-combobox-list", role: "listbox" });
  list.hidden = true;

  let currentOptions = folderOptions;

  function labelForId(id) {
    if (id === "" || id == null) return "최상위";
    const o = currentOptions.find(f => f.id === id);
    return o ? o.name : "최상위";
  }

  function updateButton() {
    const id = hidden.value;
    textSlot.textContent = labelForId(id);
    btn.setAttribute("aria-label", `저장 위치: ${labelForId(id)}`);
  }

  function updateOptionSelected() {
    const v = hidden.value;
    for (const opt of list.querySelectorAll("[role=option]")) {
      const oid = opt.getAttribute("data-id") || "";
      opt.setAttribute("aria-selected", oid === v ? "true" : "false");
    }
  }

  let docHandler = null;
  let keyHandler = null;

  function closeList() {
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (docHandler) {
      document.removeEventListener("click", docHandler, true);
      if (keyHandler) document.removeEventListener("keydown", keyHandler, true);
      docHandler = null;
      keyHandler = null;
    }
  }

  function openList() {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    updateOptionSelected();
    keyHandler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeList();
        btn.focus();
      }
    };
    docHandler = (e) => {
      if (!wrap.contains(e.target)) closeList();
    };
    setTimeout(() => {
      document.addEventListener("keydown", keyHandler, true);
      document.addEventListener("click", docHandler, true);
    }, 0);
  }

  function addOption(dataId, displayName, depth) {
    const li = el("li", { role: "option", className: "bm-folder-combobox-option", "data-id": dataId });
    if (depth > 0) li.style.paddingLeft = `calc(0.55rem + ${depth} * 0.9rem)`;
    const oIcon = el("span", { className: "bm-folder-combobox-option-icon" });
    oIcon.appendChild(_buildMaterialFolderIcon({ size: 16 }));
    li.appendChild(oIcon);
    li.appendChild(el("span", { className: "bm-folder-combobox-option-label" }, displayName));
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      hidden.value = dataId;
      updateButton();
      updateOptionSelected();
      closeList();
      btn.focus();
    });
    list.appendChild(li);
  }

  // Persistent "+ 새 폴더" action at the bottom of the listbox (omitted when
  // allowNewFolder=false — e.g. the new-folder modal's own parent picker).
  // role="presentation" so screen readers don't read it as a folder option.
  let newFolderItem = null;
  if (allowNewFolder) {
    newFolderItem = el("li", { role: "presentation", className: "bm-folder-combobox-new" });
    const newFolderBtn = el("button", {
      type: "button",
      className: "bm-folder-combobox-new-btn",
    }, "+ 새 폴더");
    newFolderBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeList();
      openNewFolderModal((newId) => {
        const updated = collectFolderOptions(loadBookmarks());
        rebuildOptions(updated);
        hidden.value = String(newId);
        updateButton();
        updateOptionSelected();
      });
    });
    newFolderItem.appendChild(newFolderBtn);
  }

  function rebuildOptions(options) {
    currentOptions = options;
    list.replaceChildren();
    addOption("", "최상위", 0);
    for (const o of options) addOption(String(o.id), o.name, o.depth);
    if (newFolderItem) list.appendChild(newFolderItem);
  }

  rebuildOptions(folderOptions);
  updateButton();
  updateOptionSelected();

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list.hidden) openList();
    else closeList();
  });

  /** @type {HTMLElement & { _bmClose?: () => void }} */ (wrap)._bmClose = closeList;
  wrap.appendChild(hidden);
  wrap.appendChild(btn);
  wrap.appendChild(list);

  return {
    el: wrap,
    getValue: () => (hidden.value ? hidden.value : null),
    close: closeList,
  };
}

function _buildFolderItem(folder, depth) {
  const expanded = _hasActiveDescendant(folder) || !!(folder.expanded);
  const li = el("li", {
    role: "treeitem",
    className: "bm-folder",
    "data-id": folder.id,
    "aria-expanded": String(expanded),
    tabIndex: "-1",
  });
  if (depth > 0) li.setAttribute("aria-level", String(depth + 1));
  const row = el("div", { className: "bm-folder-row" });
  // See bookmark row: handler owns swipe-to-reveal; reorder self-gates on sort.
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
  // Same depth indent as bookmark rows (one folder level = --space-8).
  if (depth > 0) content.style.setProperty("--bm-indent", `calc(var(--space-8) * ${depth})`);
  const toggle = el("span", { className: "bm-folder-toggle", "aria-hidden": "true" });
  toggle.appendChild(_buildFolderToggleIcon(expanded));
  const name = el("span", { className: "bm-folder-name" }, folder.name);
  row.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest(".bm-item-actions, .bm-swipe-action")) return;
    // Select mode: tapping a folder row toggles its selection (cascades to its
    // subtree) rather than expanding/collapsing.
    if (_bmSelectMode) { _toggleBmSelect(folder.id); return; }
    if (row.classList.contains("bm-swiped")) {
      closeSwipedRow(null);
      return;
    }
    const newExpanded = li.getAttribute("aria-expanded") !== "true";
    li.setAttribute("aria-expanded", String(newExpanded));
    toggle.replaceChildren(_buildFolderToggleIcon(newExpanded));
    // Persist expanded state so it survives re-render
    const store = loadBookmarks();
    const found = _findItemInStore(store, folder.id);
    if (found && found.item.type === "folder") { found.item.expanded = newExpanded; saveBookmarks(store); }
  });

  const renameAction = () => {
    closeSwipedRow(null);
    const newName = window.prompt("폴더 이름:", folder.name);
    if (!newName || !newName.trim()) return;
    const store = loadBookmarks();
    const found = _findItemInStore(store, folder.id);
    if (found) { found.item.name = newName.trim(); found.item.updatedAt = Date.now(); }
    saveBookmarks(store);
    _rerenderActiveBookmarkTree();
  };
  const deleteAction = () => {
    const childCount = folder.children ? folder.children.length : 0;
    // Folder delete = delete the folder AND its contents (cascade), consistent
    // with select mode — "delete" means delete everywhere. The confirm states the
    // count so the scope is explicit.
    const msg = childCount > 0
      ? `"${folder.name}" 폴더와 안의 항목 ${childCount}개를 모두 삭제할까요?`
      : `"${folder.name}" 폴더를 삭제할까요?`;
    // Close the swipe panel up front so canceling the confirm returns the row to
    // place (not stuck open) — mirrors renameAction / the bookmark deleteAction.
    closeSwipedRow(null);
    openConfirmModal({
      title: "폴더 삭제",
      message: msg,
      confirmLabel: "삭제",
      onConfirm: () => {
        const store = loadBookmarks();
        // Cascade: forget per-device viewed timestamps for every nested bookmark,
        // mirroring single-bookmark delete, so the map doesn't accrue stale ids.
        const found = _findItemInStore(store, folder.id);
        if (found && found.item.type === "folder") {
          _walkBookmarks(found.item.children, (it) => {
            if (it.type === "bookmark") _forgetViewed(it.id);
          });
        }
        removeItemById(store, folder.id);
        saveBookmarks(store);
        _rerenderActiveBookmarkTree();
      },
    });
  };

  const actions = el("div", { className: "bm-item-actions" });
  const renameBtn = el("button", { className: "bm-action-btn", type: "button" }, "수정");
  renameBtn.addEventListener("click", renameAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(renameBtn);
  actions.appendChild(delBtn);

  // Mobile swipe actions (edge-anchored, hidden on desktop): 삭제 left, 수정 right.
  const { del, edit } = _buildSwipeActions(folder.name, renameAction, deleteAction);

  content.appendChild(toggle);
  content.appendChild(name);
  content.appendChild(actions);
  content.appendChild(_buildDragHandle());
  row.appendChild(del);
  row.appendChild(edit);
  row.appendChild(content);
  row.appendChild(_buildSelectCircle());
  li.appendChild(row);
  const children = el("ul", { role: "group", className: "bm-folder-children" });
  for (const child of sortBookmarkNodes(folder.children || [])) {
    children.appendChild(child.type === "folder"
      ? _buildFolderItem(child, depth + 1)
      : _buildBookmarkItem(child, depth + 1));
  }
  li.appendChild(children);
  return li;
}

/**
 * Render the bookmark tree into a target `<ul role="tree">`. Defaults to the
 * drawer body so the existing drawer keeps calling this with no arguments. The
 * mobile full-screen view (renderBookmarksView) passes its own in-page `<ul>`.
 * Roving-tabindex + keyboard arrow navigation are wired only on the drawer body
 * (the listeners below are bound to `$bookmarkDrawerBody`); the full view relies
 * on each bookmark's own `<a>` for keyboard reachability.
 * @param {HTMLElement} [target]
 */
// Single source for the "how to add a bookmark" guidance. Adding is reading-
// context only — you bookmark the chapter/verses you're reading (ADR-029) — so
// the guidance points back to the reading screen rather than offering an add
// action in the management view. Shared by two surfaces: the empty state (shown
// when there are no bookmarks yet) and the 🛈 info popover in the full view's
// title row (shown when bookmarks already exist, so returning users who forgot
// the flow still have a reminder).
const BOOKMARK_ADD_HELP =
  "성서를 읽다가 오른쪽 위의 북마크 버튼을 누르면 이곳에 북마크가 기록됩니다. 읽던 구절을 누른 후, 여러 절을 선택해 북마크할 수도 있습니다.";

// Empty-state placeholder for the bookmark list (drawer + full view). Beyond the
// "none yet" line it explains how bookmarks are created, so the screen is
// actionable rather than a dead end. The icon matches the header add affordance.
function _buildEmptyState() {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 -960 960 960");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("aria-hidden", "true");
  _setBookmarkBtnIcon(/** @type {SVGElement} */ (icon), false);
  // Shared empty-state component (ADR-032 / DESIGN.md §6). Mounted as a
  // presentational <li> since the list is a <ul>.
  return emptyState({
    tag: "li",
    role: "presentation",
    icon,
    title: "저장된 북마크가 없습니다",
    subtitle: BOOKMARK_ADD_HELP,
  });
}

function renderBookmarkTree(target = $bookmarkDrawerBody) {
  _renderPathname = window.location.pathname;
  // The previously swiped row may be replaced when we re-render; drop the
  // stale reference held by js/app/bookmark.js.
  resetSwipedRow();
  clearNode(target);
  // Reveal per-row reorder handles (≡) only under 직접 정렬 (manual), where a
  // drag actually reorders; auto-sorts would re-sort the drop away, so no handle.
  target.classList.toggle("bm-sortable", getBookmarkSort() === "manual");
  const store = loadBookmarks();
  if (!store.length) {
    target.appendChild(_buildEmptyState());
    return;
  }
  for (const item of sortBookmarkNodes(store)) {
    target.appendChild(item.type === "folder"
      ? _buildFolderItem(item, 0)
      : _buildBookmarkItem(item, 0));
  }
  // Roving tabindex only applies to the drawer body, where the arrow-key
  // handlers below live. In the full view, leave the default treeitem tabindex.
  if (target === $bookmarkDrawerBody) {
    const items = _getVisibleTreeItems();
    items.forEach((item, i) => item.setAttribute("tabIndex", i === 0 ? "0" : "-1"));
  }
  // A re-render mid-select (e.g. Drive sync) rebuilds the rows; re-apply the
  // selection chrome so ticked/covered circles survive the rebuild.
  if (_bmSelectMode) _syncBmSelectChrome();
}

/**
 * Re-render whichever bookmark tree is currently on screen. When the mobile
 * full-screen view is mounted (#bookmarks-view-tree exists in #app), re-render
 * that; otherwise fall back to the drawer body. Item-level mutation handlers
 * (delete / rename) call this so the visible surface updates regardless of
 * which one the user is looking at.
 */
function _rerenderActiveBookmarkTree() {
  const fullViewTree = document.getElementById("bookmarks-view-tree");
  renderBookmarkTree(
    fullViewTree && document.getElementById("app")?.contains(fullViewTree)
      ? /** @type {HTMLElement} */ (fullViewTree)
      : undefined,
  );
}

/**
 * Full-screen bookmark list view for the mobile tab bar (ADR-029 / P2).
 * Renders into `#app`: a page title + the bookmark tree (same item builders as
 * the drawer), WITHOUT the drawer's reading-context toolbar (save current
 * chapter / select verses) — that affordance stays in the drawer, reached from
 * the reading header. Bookmark links navigate normally (closeBookmarkDrawer is
 * a no-op while the drawer is hidden).
 */
function renderBookmarksView() {
  const $app = _$("app");
  const $title = _$("page-title");
  window.setTitle("북마크");
  // Navigation is the tab bar's job now (ADR-029), so this full-screen view no
  // longer mints a home/settings header button. Instead the title row carries
  // two global management actions on the right: "+" (new folder) and "⋯" (more).
  // Reading-context actions (이 장 저장 / 절 선택) belong only to the drawer.
  $title.appendChild(buildBmViewActions());
  window.hideAudioBar();
  clearNode($app);

  const panel = el("div", { className: "bookmarks-view", role: "region", "aria-label": "북마크 목록" });
  const tree = el("ul", { id: "bookmarks-view-tree", role: "tree", className: "bm-tree", "aria-label": "북마크 목록" });
  panel.appendChild(tree);
  $app.appendChild(panel);
  renderBookmarkTree(tree);
}

// Build an inline-SVG glyph for a menu item from one or more stroked paths.
// Matches the hairline weight of the other header icons (~1.7 stroke).
/** @param {string[]} paths @returns {SVGSVGElement} */
function _bmMenuIcon(paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "1.7");
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
  }
  return svg;
}

// Build the right-aligned action cluster for the bookmark tab view's title row.
// Following Apple Music's pattern, the only header affordance is a single "⋯"
// (더 보기) button; every global management action lives inside its dismissible
// popup menu (새 폴더 / 내보내기 / 가져오기 / 삭제). Each menu row carries an SF-style
// glyph (HIG). Returns a DocumentFragment with the 전체 선택 toggle (shown only in
// select mode) + the .title-actions cluster (🛈 + ⋯), both appended into #page-title.
// .title-action-btn mirrors the other header icon buttons (44px touch target).
function buildBmViewActions() {
  const wrap = el("div", { className: "title-actions" });

  // ── "⋯" 더 보기 + menu ──
  const moreSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  moreSvg.setAttribute("viewBox", "0 0 24 24");
  moreSvg.setAttribute("fill", "currentColor");
  moreSvg.setAttribute("aria-hidden", "true");
  for (const cx of [6, 12, 18]) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", "12");
    dot.setAttribute("r", "1.6");
    moreSvg.appendChild(dot);
  }
  const moreBtn = el("button", {
    className: "title-action-btn",
    type: "button",
    "aria-label": "더 보기",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  }, moreSvg);

  const menu = el("div", { className: "title-action-menu", role: "menu", "aria-label": "더 보기", hidden: "" });
  /** @type {{ item: HTMLElement, mode: string }[]} */
  const sortItems = [];

  // The menu DOM outlives a tree re-render (only the tree is rebuilt when sort
  // changes), so refresh the radio checks from the live preference on each open.
  function syncSortChecks() {
    const cur = getBookmarkSort();
    for (const { item, mode } of sortItems) item.setAttribute("aria-checked", String(mode === cur));
  }

  // Assigned once the 선택 item is built; refreshes its enabled state per open.
  let refreshSelectEnabled = () => {};

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    moreBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKeydown, true);
  }
  function openMenu() {
    if (!menu.hidden) return;
    syncSortChecks();
    refreshSelectEnabled();
    menu.hidden = false;
    moreBtn.setAttribute("aria-expanded", "true");
    // Capture phase so an outside click closes before it acts elsewhere.
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKeydown, true);
  }
  // SPA navigation can remove the header (and this menu's DOM) while the menu
  // is open, without calling closeMenu — leaving these document listeners
  // attached. Both handlers self-clean if the trigger is detached.
  /** @param {MouseEvent} e */
  function onDocClick(e) {
    if (!moreBtn.isConnected) { closeMenu(); return; }
    const t = /** @type {Node} */ (e.target);
    if (wrap.contains(t)) return;
    closeMenu();
  }
  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!moreBtn.isConnected) { closeMenu(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      moreBtn.focus();
    }
  }

  moreBtn.addEventListener("click", () => {
    if (menu.hidden) { closeInfo(); openMenu(); }
    else closeMenu();
  });

  // ── 정렬 group (menuitemradio, 현재 선택에 체크) ──
  // Per-device sort preference (localStorage), so selecting one re-renders the
  // tree in place. Leading checkmark slot mirrors Apple Music's sort group.
  const sortGroup = el("div", { className: "title-action-menu-group", role: "group", "aria-label": "정렬" });
  /** @param {string} label @param {string} mode */
  function addSortItem(label, mode) {
    const item = el("button", {
      className: "title-action-menu-item title-action-menu-item--sort",
      type: "button",
      role: "menuitemradio",
      "aria-checked": String(getBookmarkSort() === mode),
    });
    // The check glyph is always present; CSS reveals it only on the active row
    // (aria-checked), so syncSortChecks just flips the attribute.
    const check = el("span", { className: "title-action-menu-check", "aria-hidden": "true" });
    check.appendChild(_bmMenuIcon(["M5 12.5 10 17.5 19 7"]));
    item.appendChild(check);
    item.appendChild(el("span", { className: "title-action-menu-label" }, label));
    item.addEventListener("click", () => {
      setBookmarkSort(mode);
      closeMenu();
      _rerenderActiveBookmarkTree();
    });
    sortGroup.appendChild(item);
    sortItems.push({ item, mode });
    return item;
  }
  addSortItem("제목", "title");
  addSortItem("직접 정렬", "manual");
  addSortItem("추가된 날짜", "created");
  addSortItem("최근에 본 날짜", "viewed");
  addSortItem("수정한 날짜", "modified");

  // ── 액션 group ──
  const actionGroup = el("div", { className: "title-action-menu-group", role: "group" });
  // Build a menu row: leading SF-style glyph + label. The glyph sits in the
  // same far-left column as the sort group's checkmark (deliberate HIG
  // deviation) so both groups share one icon column and one label column.
  /** @param {string} label @param {string[]} iconPaths @param {() => void} onActivate */
  function addMenuItem(label, iconPaths, onActivate) {
    const item = el("button", { className: "title-action-menu-item title-action-menu-item--action", type: "button", role: "menuitem" });
    const glyph = el("span", { className: "title-action-menu-icon", "aria-hidden": "true" });
    glyph.appendChild(_bmMenuIcon(iconPaths));
    item.appendChild(glyph);
    item.appendChild(el("span", { className: "title-action-menu-label" }, label));
    item.addEventListener("click", () => {
      closeMenu();
      onActivate();
    });
    actionGroup.appendChild(item);
    return item;
  }

  // 새 폴더 — folder.badge.plus
  addMenuItem("새 폴더", [
    "M3 7.5a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z",
    "M12 11.5v4",
    "M10 13.5h4",
  ], () => {
    openNewFolderModal((_newId) => { _rerenderActiveBookmarkTree(); });
  });
  // 내보내기 — square.and.arrow.up. Arrow + tray are a true vertical mirror of
  // 가져오기, and both arrowheads stop one unit above the tray (y12 vs tray y13)
  // so neither fuses with it — the head fusing into the tray is what made the
  // down arrow read as smaller (optical illusion, not actual size).
  addMenuItem("내보내기", [
    "M12 12V4",
    "M8.5 7.5 12 4l3.5 3.5",
    "M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  ], () => {
    exportBookmarks();
  });
  // 가져오기 — square.and.arrow.down (mirror of 내보내기 above)
  addMenuItem("가져오기", [
    "M12 4v8",
    "M8.5 8.5 12 12l3.5-3.5",
    "M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  ], () => {
    $bmImportInput.value = "";
    $bmImportInput.click();
  });
  // 선택 — checkmark.circle. Enters the in-place select mode (ADR-029 개정): rows
  // reveal a leading selection circle and the tab dock yields to #bm-select-bar
  // (공유·이동·삭제 pill + 취소). A neutral management action, so it sits in the
  // action group right after 가져오기 (the destructive 삭제 lives in the dock, so
  // there's no "destructive-last" reason to strand it at the bottom).
  const selectItem = addMenuItem("선택", [
    "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z",
    "M8.5 12.5 11 15 15.5 9.5",
  ], () => {
    enterBookmarkSelectMode();
  });
  // Reflect emptiness whenever the menu opens (the DOM outlives re-renders).
  refreshSelectEnabled = () => { selectItem.disabled = loadBookmarks().length === 0; };

  // Two groups: management actions (새 폴더·내보내기·가져오기·선택) then a single
  // hairline then the 정렬 radio set — the divider separates "do something" from
  // "change ordering" (one group divider, Apple Music pattern).
  menu.appendChild(actionGroup);
  menu.appendChild(el("div", { className: "title-action-menu-sep", role: "separator" }));
  menu.appendChild(sortGroup);

  // ── "🛈" 북마크 추가 방법 안내 팝오버 ──
  // Sits to the LEFT of ⋯ (⋯ stays trailing-most as the overflow affordance).
  // Reuses .title-action-btn so it shares the neutral charcoal (--accent) chrome
  // — deliberately NOT a tinted / iOS-blue info glyph: ADR-028 froze chrome to
  // neutral and reserves --theme for the nav signature only. Tap toggles a small
  // text popover that reuses the empty-state guidance, so users who already have
  // bookmarks still have a reminder of how adding works (reading-context only).
  const infoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  infoSvg.setAttribute("viewBox", "0 -960 960 960");
  infoSvg.setAttribute("fill", "currentColor");
  infoSvg.setAttribute("aria-hidden", "true");
  const infoPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Material Symbols "info" (outlined).
  infoPath.setAttribute("d", "M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z");
  infoSvg.appendChild(infoPath);
  const infoBtn = el("button", {
    className: "title-action-btn",
    type: "button",
    "aria-label": "북마크 추가 방법",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
  }, infoSvg);

  const infoPop = el("div", {
    className: "title-action-popover",
    role: "dialog",
    "aria-labelledby": "bm-add-help-title",
    hidden: "",
  });
  infoPop.appendChild(el("h2", { className: "title-action-popover-title", id: "bm-add-help-title" }, "북마크 추가하기"));
  infoPop.appendChild(el("p", { className: "title-action-popover-text" }, BOOKMARK_ADD_HELP));

  function closeInfo() {
    if (infoPop.hidden) return;
    infoPop.hidden = true;
    infoBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onInfoDocClick, true);
    document.removeEventListener("keydown", onInfoKeydown, true);
  }
  function openInfo() {
    if (!infoPop.hidden) return;
    infoPop.hidden = false;
    infoBtn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onInfoDocClick, true);
    document.addEventListener("keydown", onInfoKeydown, true);
  }
  // Mirror the ⋯ menu's self-cleaning listeners: SPA nav can drop this DOM while
  // the popover is open without calling closeInfo, so both handlers bail (and
  // detach) once the trigger is disconnected.
  /** @param {MouseEvent} e */
  function onInfoDocClick(e) {
    if (!infoBtn.isConnected) { closeInfo(); return; }
    const t = /** @type {Node} */ (e.target);
    if (wrap.contains(t)) return;
    closeInfo();
  }
  /** @param {KeyboardEvent} e */
  function onInfoKeydown(e) {
    if (!infoBtn.isConnected) { closeInfo(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      closeInfo();
      infoBtn.focus();
    }
  }
  infoBtn.addEventListener("click", () => {
    if (infoPop.hidden) { closeMenu(); openInfo(); }
    else closeInfo();
  });

  wrap.appendChild(infoBtn);
  wrap.appendChild(infoPop);
  wrap.appendChild(moreBtn);
  wrap.appendChild(menu);

  // 전체 선택 toggle — shown only in select mode (CSS swaps it for the .title-actions
  // cluster via body.bm-select-active). iOS Mail/Files put Select All in the title
  // bar; "전체 삭제" is just 전체 선택 → 삭제 (no separate one-tap nuke). Label/pressed
  // state are refreshed by _syncSelectAllBtn; built fresh on each renderBookmarksView.
  const selectAllBtn = el("button", {
    className: "bm-select-allbtn",
    type: "button",
    "aria-pressed": "false",
  }, "전체 선택");
  selectAllBtn.addEventListener("click", _bmToggleSelectAll);

  const frag = document.createDocumentFragment();
  frag.appendChild(selectAllBtn);
  frag.appendChild(wrap);
  return frag;
}

// Returns all currently visible treeitems in DOM order (skips children of collapsed folders)
function _getVisibleTreeItems() {
  const result = [];
  function walk(ul) {
    for (const li of ul.children) {
      if (!li.matches("[role=treeitem]")) continue;
      result.push(li);
      const expanded = li.getAttribute("aria-expanded") === "true";
      const group = li.querySelector(":scope > [role=group]");
      if (expanded && group) walk(group);
    }
  }
  walk($bookmarkDrawerBody);
  return result;
}

function _focusTreeItem(item) {
  const prev = $bookmarkDrawerBody.querySelector("[role=treeitem][tabindex='0']");
  if (prev && prev !== item) prev.setAttribute("tabIndex", "-1");
  item.setAttribute("tabIndex", "0");
  item.focus();
}

function _toggleFolder(li) {
  const toggle = li.querySelector(".bm-folder-toggle");
  const newExpanded = li.getAttribute("aria-expanded") !== "true";
  li.setAttribute("aria-expanded", String(newExpanded));
  if (toggle) toggle.replaceChildren(_buildFolderToggleIcon(newExpanded));
}

// Tap on empty drawer area closes any revealed mobile-swipe actions.
// `closeSwipedRowIfOutside` is a bookmark.js (Phase 6a) accessor — it
// encapsulates the "is something swiped + did the tap land outside" check
// so app.js doesn't reach into the module's private `_swipedRow` state.
$bookmarkDrawerBody.addEventListener("pointerdown", (e) => {
  closeSwipedRowIfOutside(e.target);
});

$bookmarkDrawerBody.addEventListener("keydown", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  // Ignore keypresses originating from interactive controls inside the row (buttons, inputs)
  if (t.closest(".bm-item-actions, .bm-bookmark-link")) return;
  const item = /** @type {HTMLElement | null} */ (t.closest("[role=treeitem]"));
  if (!item || !$bookmarkDrawerBody.contains(item)) return;

  const items = _getVisibleTreeItems();
  const idx = items.indexOf(item);
  const isFolder = item.classList.contains("bm-folder");

  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (idx < items.length - 1) _focusTreeItem(items[idx + 1]);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (idx > 0) _focusTreeItem(items[idx - 1]);
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    if (isFolder) {
      if (item.getAttribute("aria-expanded") !== "true") {
        _toggleFolder(item);
        // after expand, re-query and stay on same item
        _focusTreeItem(item);
      } else {
        const group = item.querySelector(":scope > [role=group]");
        const firstChild = group && group.querySelector("[role=treeitem]");
        if (firstChild) _focusTreeItem(firstChild);
      }
    }
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    if (isFolder && item.getAttribute("aria-expanded") === "true") {
      _toggleFolder(item);
      _focusTreeItem(item);
    } else {
      // Move to parent treeitem
      const parentGroup = item.closest("[role=group]");
      const parentItem = parentGroup && parentGroup.closest("[role=treeitem]");
      if (parentItem) _focusTreeItem(parentItem);
    }
  } else if (e.key === "Home") {
    e.preventDefault();
    if (items.length) _focusTreeItem(items[0]);
  } else if (e.key === "End") {
    e.preventDefault();
    if (items.length) _focusTreeItem(items[items.length - 1]);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (isFolder) {
      _toggleFolder(item);
      _focusTreeItem(item);
    } else {
      // Activate bookmark: follow its link
      const link = /** @type {HTMLElement | null} */ (item.querySelector(".bm-bookmark-link"));
      if (link) link.click();
    }
  }
});

// ── Save bookmark modal ──

function openSaveModal(mode, opts = {}) {
  const bookId = readingContext.bookId;
  const chapter = readingContext.chapter;
  let verseSpec = "all";
  let existingId = opts.existingId || null;
  let existing = null;

  if (existingId) {
    const found = _findItemInStore(loadBookmarks(), existingId);
    if (found && found.item.type === "bookmark") existing = found.item;
  }

  if (mode === "verses") {
    const article = document.querySelector("article.chapter-text");
    // Bookmarks treat a cite-split prose verse as one whole verse, so a partial
    // span selection (e.g. 23a but not 23b/23c) is promoted to 23.
    const refs = collapseSegmentedVerses(Array.from(readingContext.selectedVerses), article);
    verseSpec = refs.length ? selectedVersesToSpec(refs) : "all";
  } else if (existing) {
    verseSpec = existing.verseSpec ?? "all";
  }

  // Merge check (skip for edit mode)
  if (mode !== "edit" && bookId && chapter) {
    const sameChapterBms = findExistingChapterBookmarks(bookId, chapter)
      .filter(bm => !existingId || bm.id !== existingId);
    if (sameChapterBms.length > 0) {
      openMergeDialog(sameChapterBms, verseSpec, mode, { bookId, chapter });
      return;
    }
  }

  _showSaveModal(mode, bookId, chapter, verseSpec, existing);
}

function _showSaveModal(mode, bookId, chapter, verseSpec, existing) {
  const prevCombo = /** @type {HTMLElement & { _bmClose?: () => void } | null} */ (document.getElementById("bm-folder-combobox"));
  if (prevCombo && prevCombo._bmClose) prevCombo._bmClose();

  const store = loadBookmarks();
  const folderOptions = collectFolderOptions(store);

  const book = (window.getBooksCache() ?? []).find(b => b.id === bookId);
  const bookName = book ? (book.short_name_ko || book.name_ko) : bookId;
  const unit = chUnit(bookId);
  let defaultLabel;
  if (existing) {
    defaultLabel = existing.label;
  } else if (verseSpec === "all") {
    defaultLabel = `${bookName} ${chapter}${unit}`;
  } else {
    defaultLabel = `${bookName} ${chapter}:${verseSpec}`;
  }

  clearNode($bmSaveBody);
  $bmSaveTitle.textContent = existing ? "북마크 수정" : "북마크 저장";

  const labelField = el("div", { className: "bm-form-field" });
  labelField.appendChild(el("label", { className: "bm-form-label", for: "bm-label-input" }, "제목"));
  const labelInput = el("input", {
    id: "bm-label-input",
    className: "bm-form-input",
    type: "text",
    value: defaultLabel,
  });
  labelField.appendChild(labelInput);

  const noteField = el("div", { className: "bm-form-field" });
  noteField.appendChild(el("label", { className: "bm-form-label", for: "bm-note-input" }, "메모 (선택)"));
  const noteInput = el("textarea", {
    id: "bm-note-input",
    className: "bm-form-textarea",
    placeholder: "메모를 입력하세요",
  }, existing ? existing.note || "" : "");
  noteField.appendChild(noteInput);

  const folderField = el("div", { className: "bm-form-field" });
  folderField.appendChild(el("label", { className: "bm-form-label", for: "bm-folder-combobox-btn" }, "저장 위치"));
  const currentParentFolderId = existing ? _findParentFolderId(store, existing.id) : undefined;
  const folderCombo = _buildFolderCombobox(folderOptions, currentParentFolderId);
  folderField.appendChild(folderCombo.el);

  const actions = el("div", { className: "bm-form-actions" });
  const saveBtn = el("button", { className: "bm-btn-primary", type: "button" }, existing ? "수정" : "저장");
  const cancelBtn = el("button", { className: "bm-btn-secondary", type: "button" }, "취소");
  saveBtn.addEventListener("click", () => {
    const label = labelInput.value.trim();
    if (!label) {
      labelInput.setAttribute("aria-invalid", "true");
      labelInput.focus();
      return;
    }
    labelInput.removeAttribute("aria-invalid");
    const note = noteInput.value.trim();
    const folderId = folderCombo.getValue();
    commitSaveBookmark(existing ? existing.id : null, label, note, folderId, bookId, chapter, verseSpec);
    closeSaveModal();
    if (mode === "verses") exitVerseSelectMode();
  });
  cancelBtn.addEventListener("click", closeSaveModal);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  $bmSaveBody.appendChild(labelField);
  $bmSaveBody.appendChild(noteField);
  $bmSaveBody.appendChild(folderField);
  $bmSaveBody.appendChild(actions);

  saveOverlay.open();
}

// closeOnEsc stays off: the save modal participates in the stacked Escape
// router below. Initial focus = the first input (label). onClose also dismisses
// the folder combobox dropdown (ADR-032).
const saveOverlay = createOverlay({
  panel: $bmSaveModal,
  scrim: $bmSaveScrim,
  initialFocus: () => $bmSaveModal.querySelector("input"),
  onClose: () => {
    const c = /** @type {HTMLElement & { _bmClose?: () => void } | null} */ (document.getElementById("bm-folder-combobox"));
    if (c && c._bmClose) c._bmClose();
  },
});

function closeSaveModal() { saveOverlay.close(); }

// Overlay lifecycle (scrim/hidden/focus-trap/focus-restore) is owned by the
// shared controller (ADR-032). closeOnEsc stays off: Escape participates in the
// stacked bookmark router below, so every focused control closes only this modal.
const newFolderOverlay = createOverlay({
  panel: $bmNewFolderModal,
  scrim: $bmNewFolderScrim,
  initialFocus: () => $bmNewFolderInput,
  onClose: () => {
    _bmNewFolderCallback = null;
    if (_bmNewFolderParentCombo) _bmNewFolderParentCombo.close();
    _bmNewFolderParentCombo = null;
  },
});

/**
 * @param {((id: string) => void) | null} [onConfirm]
 * @param {string|null} [presetParentId] preselect a parent folder (null/undefined = 최상위).
 * @param {{ folderFilter?: (f: { id: string, name: string, depth: number }) => boolean }} [opts]
 *   folderFilter narrows the parent options — used by the move flow to drop the folders
 *   that are being moved (and their subtrees), so the new folder can't be created inside
 *   the very selection it will receive (which would no-op the move and leave it empty).
 */
function openNewFolderModal(onConfirm, presetParentId, opts = {}) {
  $bmNewFolderInput.value = "";
  $bmNewFolderInput.removeAttribute("aria-invalid");
  _bmNewFolderCallback = onConfirm || null;
  // Parent-folder picker: same combobox as the save modal, but scoped ids and no
  // nested "+ 새 폴더" (it would re-open this very modal). 최상위 = create at root
  // (always offered by the combobox, even when every folder is filtered out).
  clearNode($bmNewFolderParent);
  let folderOptions = collectFolderOptions(loadBookmarks());
  if (opts.folderFilter) folderOptions = folderOptions.filter(opts.folderFilter);
  const combo = _buildFolderCombobox(
    folderOptions,
    presetParentId,
    { idPrefix: "bm-newfolder-parent", allowNewFolder: false },
  );
  _bmNewFolderParentCombo = combo;
  $bmNewFolderParent.appendChild(combo.el);
  newFolderOverlay.open();
}

function closeNewFolderModal() {
  newFolderOverlay.close();
}

function _commitNewFolder() {
  const name = $bmNewFolderInput.value.trim();
  if (!name) {
    $bmNewFolderInput.setAttribute("aria-invalid", "true");
    $bmNewFolderInput.focus();
    return;
  }
  $bmNewFolderInput.removeAttribute("aria-invalid");
  const store = loadBookmarks();
  const id = generateId();
  const parentId = _bmNewFolderParentCombo ? _bmNewFolderParentCombo.getValue() : null;
  insertItem(store, parentId, { type: "folder", id, name, children: [], expanded: false, createdAt: Date.now() });
  // Reveal the destination so the new folder is visible after re-render.
  if (parentId) {
    const dest = _findItemInStore(store, parentId);
    if (dest && dest.item.type === "folder") dest.item.expanded = true;
  }
  saveBookmarks(store);
  _rerenderActiveBookmarkTree();
  const cb = _bmNewFolderCallback;
  closeNewFolderModal();
  if (cb) cb(id);
}

function commitSaveBookmark(existingId, label, note, folderId, bookId, chapter, verseSpec) {
  const store = loadBookmarks();
  if (existingId) {
    const found = _findItemInStore(store, existingId);
    if (found && found.item.type === "bookmark") {
      found.item.label = label;
      found.item.note = note;
      found.item.verseSpec = verseSpec;
      found.item.updatedAt = Date.now();
      const updatedItem = found.item;
      removeItemById(store, existingId);
      insertItem(store, folderId, updatedItem);
    }
  } else {
    /** @type {BookmarkTreeBookmark} */
    const bm = {
      type: "bookmark",
      id: generateId(),
      bookId,
      chapter,
      verseSpec,
      label,
      note,
      createdAt: Date.now(),
    };
    insertItem(store, folderId, bm);
  }
  saveBookmarks(store);
  _rerenderActiveBookmarkTree();
  refreshBookmarkHeaderBtn();
  announce(existingId ? "북마크를 수정했습니다." : "북마크를 저장했습니다.");
}

// ── Merge dialog ──

/**
 * @param {BookmarkTreeBookmark[]} candidates
 * @param {string} incomingSpec
 * @param {string} mode
 * @param {{ bookId?: string | null, chapter?: number | null } | null} [fallbackContext]
 */
// closeOnEsc off: in the stacked Escape router. onClose clears the per-open
// onclick handlers (ADR-032).
const mergeOverlay = createOverlay({
  panel: $bmMergeModal,
  scrim: $bmMergeScrim,
  initialFocus: () => $bmMergeYes,
  onClose: () => {
    $bmMergeYes.onclick = null;
    $bmMergeNo.onclick = null;
    $bmMergeCancel.onclick = null;
  },
});

function closeMergeModal() { mergeOverlay.close(); }

function openMergeDialog(candidates, incomingSpec, mode, fallbackContext = null) {
  clearNode($bmMergeBody);
  const resolvedBookId =
    (fallbackContext && fallbackContext.bookId) || readingContext.bookId;
  const resolvedChapter =
    (fallbackContext && fallbackContext.chapter) || readingContext.chapter;

  let target = candidates[0];

  if (candidates.length === 1) {
    const desc = el("p", { className: "bm-merge-desc" },
      `이 장에 이미 북마크("${candidates[0].label}")가 있습니다. 절을 합칠까요?`);
    $bmMergeBody.appendChild(desc);
  } else {
    $bmMergeBody.appendChild(
      el("p", { className: "bm-merge-desc" }, "이 장에 여러 북마크가 있습니다. 어느 북마크에 합칠까요?")
    );
    const radioGroup = el("div", { className: "bm-merge-radio-group" });
    candidates.forEach((bm, i) => {
      const id = `bm-merge-r${i}`;
      const labelEl = el("label", { className: "bm-merge-radio", for: id });
      const input = el("input", { type: "radio", id, name: "bm-merge-target" });
      if (i === 0) input.checked = true;
      input.addEventListener("change", () => { target = bm; });
      const specNote = bm.verseSpec !== "all" ? ` (${bm.verseSpec}절)` : "";
      labelEl.appendChild(input);
      labelEl.appendChild(el("span", {}, bm.label + specNote));
      radioGroup.appendChild(labelEl);
    });
    $bmMergeBody.appendChild(radioGroup);
  }

  mergeOverlay.open();
  const cleanup = closeMergeModal;

  $bmMergeYes.onclick = () => {
    const merged = mergeVerseSpecs(target.verseSpec ?? "all", incomingSpec);
    const store = loadBookmarks();
    const found = _findItemInStore(store, target.id);
    if (found && found.item.type === "bookmark") {
      found.item.verseSpec = merged;
      // Sync label to reflect the merged verse spec
      const targetBookId = target.bookId ?? "";
      const book = (window.getBooksCache() ?? []).find((b) => b.id === targetBookId);
      const bookName = book ? (book.short_name_ko || book.name_ko) : targetBookId;
      const unit = chUnit(targetBookId);
      found.item.label = merged === "all"
        ? `${bookName} ${target.chapter}${unit}`
        : `${bookName} ${target.chapter}:${merged}`;
    }
    saveBookmarks(store);
    _rerenderActiveBookmarkTree();
    refreshBookmarkHeaderBtn();

    if (mode === "verses") exitVerseSelectMode();
    announce("북마크를 합쳤습니다.");
    cleanup();
  };

  $bmMergeNo.onclick = () => {
    cleanup();
    _showSaveModal(mode, resolvedBookId, resolvedChapter, incomingSpec, null);
  };

  $bmMergeCancel.onclick = cleanup;
}

// ── Destructive confirm modal ──
// Reusable confirmation for destructive actions (bookmark/folder delete,
// header bookmark toggle-off). Replaces the old native window.confirm() so the
// prompt is themed, focus-trapped, and stacks above the drawer/save modals.
/**
 * @param {{ title: string, message: string, confirmLabel?: string, onConfirm: () => void }} opts
 */
// Overlay lifecycle (scrim/hidden/focus-trap/focus-restore) is owned by the
// shared controller (ADR-032). closeOnEsc stays off: this modal participates in
// bookmark.js's stacked Escape router (confirm > chapter-delete > … > drawer),
// which calls closeConfirmModal() for the topmost overlay. A controller-level
// Escape listener here would double-handle and also close whatever sits beneath.
// Default initial focus = cancel (safe action); destructive button is opt-in.
const confirmOverlay = createOverlay({
  panel: $bmConfirmModal,
  scrim: $bmConfirmScrim,
  initialFocus: () => $bmConfirmCancel,
  onClose: () => { $bmConfirmOk.onclick = null; },
});

function openConfirmModal({ title, message, confirmLabel = "삭제", onConfirm }) {
  $bmConfirmTitle.textContent = title;
  $bmConfirmBody.textContent = message;
  $bmConfirmOk.textContent = confirmLabel;
  $bmConfirmOk.onclick = () => {
    closeConfirmModal();
    onConfirm();
  };
  confirmOverlay.open();
}

function closeConfirmModal() {
  confirmOverlay.close();
}

// Header bookmark toggle-off (mobile): instead of a blunt "delete all", present
// the chapter's bookmarks (whole-chapter + verse ranges) as a checkbox list so
// the reader removes only what they mean to. "전체 선택" ticks them all at once.
// Nothing is pre-selected (the select-all is the bulk affordance) and the
// delete button stays disabled until at least one row is ticked.
/**
 * @param {BookmarkTreeBookmark[]} candidates
 */
// closeOnEsc off: in the stacked Escape router. onClose clears per-open
// handlers; returnFocus restores the pre-open focus (ADR-032).
const chapterDeleteOverlay = createOverlay({
  panel: $bmChapterDeleteModal,
  scrim: $bmChapterDeleteScrim,
  initialFocus: () => $bmChapterDeleteCancel,
  onClose: () => {
    $bmChapterDeleteConfirm.onclick = null;
    $bmChapterDeleteCancel.onclick = null;
    $bmChapterDeleteAll.onchange = null;
  },
});

function openChapterDeleteModal(candidates) {
  if (!candidates.length) return;
  /** @type {Set<string>} */
  const selected = new Set();

  const syncChrome = () => {
    const state = _selectAllState(selected.size, candidates.length);
    $bmChapterDeleteAll.checked = state === "all";
    $bmChapterDeleteAll.indeterminate = state === "some";
    $bmChapterDeleteConfirm.textContent = _deleteBtnLabel(selected.size);
    $bmChapterDeleteConfirm.disabled = selected.size === 0;
  };

  clearNode($bmChapterDeleteList);
  /** @type {HTMLInputElement[]} */
  const rowChecks = [];
  candidates.forEach((bm, i) => {
    const id = `bm-chapter-del-${i}`;
    const li = el("li", { className: "bm-chapter-delete-item" });
    const labelEl = el("label", { className: "bm-chapter-delete-label", for: id });
    const input = /** @type {HTMLInputElement} */ (el("input", { type: "checkbox", id }));
    rowChecks.push(input);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(bm.id);
      else selected.delete(bm.id);
      syncChrome();
    });
    const book = (window.getBooksCache() ?? []).find((b) => b.id === bm.bookId);
    const bookName = book ? (book.short_name_ko || book.name_ko) : bm.bookId;
    const refText = bm.verseSpec === "all"
      ? `${bookName} ${bm.chapter}${chUnit(bm.bookId)}`
      : `${bookName} ${bm.chapter}:${bm.verseSpec}`;
    const text = el("span", { className: "bm-chapter-delete-text" });
    text.appendChild(el("span", { className: "bm-chapter-delete-item-label" }, bm.label));
    text.appendChild(el("span", { className: "bm-chapter-delete-item-ref" }, refText));
    labelEl.appendChild(input);
    labelEl.appendChild(text);
    li.appendChild(labelEl);
    $bmChapterDeleteList.appendChild(li);
  });

  $bmChapterDeleteAll.onchange = () => {
    const checkAll = $bmChapterDeleteAll.checked;
    selected.clear();
    if (checkAll) candidates.forEach((bm) => selected.add(bm.id));
    rowChecks.forEach((c) => { c.checked = checkAll; });
    syncChrome();
  };

  syncChrome();
  chapterDeleteOverlay.open();

  $bmChapterDeleteConfirm.onclick = () => {
    if (!selected.size) return;
    const store = loadBookmarks();
    for (const bmId of selected) {
      // Mirror swipe-row/folder delete: clear the per-device viewed timestamp
      // so removed ids don't accrue as stale entries in the viewed map.
      _forgetViewed(bmId);
      removeItemById(store, bmId);
    }
    const removed = selected.size;
    saveBookmarks(store);
    _rerenderActiveBookmarkTree();
    refreshBookmarkHeaderBtn();
    announce(removed === 1 ? "북마크를 삭제했습니다." : `북마크 ${removed}개를 삭제했습니다.`);
    closeChapterDeleteModal();
  };
  $bmChapterDeleteCancel.onclick = closeChapterDeleteModal;
}

function closeChapterDeleteModal() { chapterDeleteOverlay.close(); }

// ── Bookmark select mode (ADR-029 개정 / ADR-010) ──
// In-place multi-select over the mobile /bookmarks full view, replacing the old
// #bm-bulk-delete-modal. Entered from the ⋯ menu "선택"; rows reveal a leading
// selection circle, the tab dock yields to #bm-select-bar (공유·이동·삭제 pill +
// 취소 원형 + floating count chip), and the title row swaps ⋯/🛈 for a 전체 선택 toggle.
// `_bmSelected` (module state, above) holds only EXPLICIT ticks; ticking a folder
// "covers" its subtree (derived, not stored), so the folder owns its descendants.

// ── BEGIN BOOKMARK_SELECT ──
// Exercised by tests/unit/bookmark.test.js. Pure cascade math for select mode
// (parent map / covered-by-ancestor / marked count / effective targets); reads
// the module-scoped `_bmSelected` set, which the unit loader provides as a stub.

// Map every node id → its parent folder id (null at root). Rebuilt per call so it
// always reflects the live store (a delete/sync may have reshaped the tree).
/**
 * @param {BookmarkTreeNode[]} store
 * @returns {Map<string, string | null>}
 */
function _bmBuildParentMap(store) {
  /** @type {Map<string, string | null>} */
  const map = new Map();
  /** @param {BookmarkTreeNode[]} items @param {string | null} parentId */
  const walk = (items, parentId) => {
    for (const it of items || []) {
      map.set(it.id, parentId);
      if (it.type === "folder") walk(it.children, it.id);
    }
  };
  walk(store, null);
  return map;
}

// True when an ancestor folder is explicitly ticked — the row is removed as part
// of that folder ("covered") and can't be toggled on its own.
/**
 * @param {string} id
 * @param {Map<string, string | null>} parentMap
 * @returns {boolean}
 */
function _bmAncestorSelected(id, parentMap) {
  let p = parentMap.get(id);
  while (p != null) {
    if (_bmSelected.has(p)) return true;
    p = parentMap.get(p);
  }
  return false;
}

// Count of nodes that will actually be removed = explicitly ticked OR covered by a
// ticked ancestor. Equals the marked-row count shown in the dock's count chip.
/**
 * @param {Map<string, string | null>} parentMap
 * @returns {number}
 */
function _bmCountMarked(parentMap) {
  let n = 0;
  for (const id of parentMap.keys()) {
    if (_bmSelected.has(id) || _bmAncestorSelected(id, parentMap)) n++;
  }
  return n;
}

// Top-most explicit ticks only — the ids handed to removeItemById (folders splice
// their whole subtree, so deleting a covered descendant too would be redundant).
/**
 * @param {Map<string, string | null>} parentMap
 * @returns {string[]}
 */
function _bmEffectiveTargets(parentMap) {
  return [..._bmSelected].filter((id) => !_bmAncestorSelected(id, parentMap));
}

// Every BOOKMARK leaf currently marked (ticked directly or covered by a ticked
// folder), in tree order. Used by 공유 to build links — folders have no URL, so
// share expands a selected folder to the bookmarks inside it.
/**
 * @param {BookmarkTreeNode[]} store
 * @returns {BookmarkTreeBookmark[]}
 */
function _collectSelectedBookmarks(store) {
  const parentMap = _bmBuildParentMap(store);
  /** @type {BookmarkTreeBookmark[]} */
  const out = [];
  /** @param {BookmarkTreeNode[]} items */
  const visit = (items) => {
    for (const it of items || []) {
      if (it.type === "folder") visit(it.children);
      else if (_bmSelected.has(it.id) || _bmAncestorSelected(it.id, parentMap)) out.push(it);
    }
  };
  visit(store);
  return out;
}
// ── END BOOKMARK_SELECT ──

function enterBookmarkSelectMode() {
  if (_bmSelectMode) return;
  if (loadBookmarks().length === 0) return;
  _bmSelectMode = true;
  _bmSelected.clear();
  closeSwipedRow(null);
  document.body.classList.add("bm-select-active");
  $bmSelectBar.hidden = false;
  _syncBmSelectChrome();
  announce("선택 모드. 항목을 누르세요.");
}

function exitBookmarkSelectMode() {
  if (!_bmSelectMode) return;
  _bmSelectMode = false;
  _bmSelected.clear();
  document.body.classList.remove("bm-select-active");
  $bmSelectBar.hidden = true;
  // Clear the per-row selection visuals without a full re-render (avoids flicker).
  document.querySelectorAll(".bm-select-circle.is-selected, .bm-select-circle.is-covered")
    .forEach((c) => c.classList.remove("is-selected", "is-covered"));
  _syncSelectAllBtn("none");
}

// Toggle one node's explicit selection. Ticking a folder subsumes any already-
// ticked descendants (the folder now owns them); covered rows ignore taps.
/** @param {string} id */
function _toggleBmSelect(id) {
  const store = loadBookmarks();
  const parentMap = _bmBuildParentMap(store);
  if (_bmAncestorSelected(id, parentMap)) return; // covered — owned by an ancestor
  if (_bmSelected.has(id)) {
    _bmSelected.delete(id);
  } else {
    const found = _findItemInStore(store, id);
    if (found && found.item.type === "folder") {
      for (const childId of _descendantIds(found.item)) _bmSelected.delete(childId);
    }
    _bmSelected.add(id);
  }
  _syncBmSelectChrome();
}

// Title-row 전체 선택 toggle: select every root node (covers the whole tree) unless
// already all-selected, in which case clear. Mirrors iOS Mail/Files "Select All".
function _bmToggleSelectAll() {
  const store = loadBookmarks();
  const parentMap = _bmBuildParentMap(store);
  const wasAll = _selectAllState(_bmCountMarked(parentMap), parentMap.size) === "all";
  _bmSelected.clear();
  if (!wasAll) for (const it of store) _bmSelected.add(it.id); // roots cover all
  _syncBmSelectChrome();
}

// Reflect the current selection into the DOM circles + dock count/button + the
// 전체 선택 toggle. Only the full-view tree carries circles (select mode is mobile-
// only); a missing root just means there's nothing to paint.
function _syncBmSelectChrome() {
  const root = document.getElementById("bookmarks-view-tree");
  const store = loadBookmarks();
  const parentMap = _bmBuildParentMap(store);
  let marked = 0;
  for (const id of parentMap.keys()) {
    const covered = _bmAncestorSelected(id, parentMap);
    const ticked = _bmSelected.has(id);
    if (covered || ticked) marked++;
    if (!root) continue;
    const li = root.querySelector(`li[data-id="${CSS.escape(id)}"]`);
    const circle = li && li.querySelector(
      ":scope > .bm-bookmark-row > .bm-select-circle, :scope > .bm-folder-row > .bm-select-circle",
    );
    if (circle) {
      circle.classList.toggle("is-selected", ticked && !covered);
      circle.classList.toggle("is-covered", covered);
    }
  }
  $bmSelectCount.textContent = _bmSelectCountLabel(marked);
  const none = marked === 0;
  $bmSelectDeleteBtn.disabled = none;
  $bmSelectMoveBtn.disabled = none;
  // 공유 needs at least one bookmark leaf (a folder-only selection has no link).
  $bmSelectShareBtn.disabled = none || _collectSelectedBookmarks(store).length === 0;
  _syncSelectAllBtn(_selectAllState(marked, parentMap.size));
}

// Update the title-row 전체 선택 toggle label/pressed state. It's rebuilt on each
// renderBookmarksView, so query it fresh rather than hold a stale reference.
/** @param {"none" | "some" | "all"} state */
function _syncSelectAllBtn(state) {
  const btn = document.querySelector(".bm-select-allbtn");
  if (!(btn instanceof HTMLButtonElement)) return;
  const all = state === "all";
  btn.textContent = all ? "선택 해제" : "전체 선택";
  btn.setAttribute("aria-pressed", String(all));
}

// 삭제 (dock): hand the top-most ticks to the shared destructive confirm, then
// cascade-delete (forgetting per-device viewed timestamps like single/folder
// delete), exit select mode, and re-render.
function _runBookmarkSelectDelete() {
  const parentMap = _bmBuildParentMap(loadBookmarks());
  const targets = _bmEffectiveTargets(parentMap);
  const removed = _bmCountMarked(parentMap);
  if (!targets.length) return;
  openConfirmModal({
    title: "북마크 삭제",
    message: removed === 1 ? "선택한 항목을 삭제할까요?" : `선택한 항목 ${removed}개를 삭제할까요?`,
    confirmLabel: "삭제",
    onConfirm: () => {
      const live = loadBookmarks();
      for (const id of targets) {
        const found = _findItemInStore(live, id);
        if (!found) continue;
        if (found.item.type === "folder") {
          _walkBookmarks(found.item.children, (it) => { if (it.type === "bookmark") _forgetViewed(it.id); });
        } else {
          _forgetViewed(id);
        }
        removeItemById(live, id);
      }
      saveBookmarks(live);
      announce(removed === 1 ? "1개 항목을 삭제했습니다." : `${removed}개 항목을 삭제했습니다.`);
      exitBookmarkSelectMode();
      _rerenderActiveBookmarkTree();
      refreshBookmarkHeaderBtn();
    },
  });
}

// 공유 (dock): expand the selection to bookmark leaves, build absolute
// bible.anglican.kr links, and hand them to the native share sheet (Web Share).
// Falls back to clipboard where Web Share is unavailable (desktop). On a
// successful share / copy we leave select mode; a canceled share sheet stays.
function _runBookmarkSelectShare() {
  const bookmarks = _collectSelectedBookmarks(loadBookmarks());
  if (!bookmarks.length) return;
  const payload = _buildSharePayload(bookmarks);
  if (typeof navigator.share === "function") {
    navigator.share(payload)
      .then(() => exitBookmarkSelectMode())
      .catch(() => { /* user dismissed the share sheet — keep the selection */ });
    return;
  }
  // Fallback: copy the link(s) to the clipboard.
  const text = payload.url ? `${payload.title}\n${payload.url}` : (payload.text ?? "");
  if (navigator.clipboard && text) {
    navigator.clipboard.writeText(text)
      .then(() => { announce("링크를 복사했습니다."); exitBookmarkSelectMode(); })
      .catch(() => announce("링크를 복사하지 못했습니다."));
  } else {
    announce("이 기기에서는 공유를 지원하지 않습니다.");
  }
}

// ── 이동 (dock): move the selection into a chosen folder ──
// Overlay lifecycle via the shared controller (ADR-032). closeOnEsc off — the
// central Escape router closes it (above select mode). Reuses the chapter-delete
// modal styling family.
const moveOverlay = createOverlay({
  panel: $bmMoveModal,
  scrim: $bmMoveScrim,
  initialFocus: () => $bmMoveCancel,
  onClose: () => { $bmMoveCancel.onclick = null; $bmMoveNewFolder.onclick = null; },
});

// One destination row in the move modal: leading glyph + label, indented by depth.
// 최상위(root) gets a home glyph; folders get a folder glyph. (새 폴더 is a dedicated
// button below the list, not a row.)
/** @param {string} label @param {"root" | "folder"} kind @param {number} [depth] */
function _buildMoveRow(label, kind, depth = 0) {
  const btn = el("button", { className: "bm-move-item", type: "button" });
  if (depth > 0) btn.style.setProperty("--bm-move-indent", `calc(var(--space-5) * ${depth})`);
  const icon = el("span", { className: "bm-move-icon", "aria-hidden": "true" });
  const paths = kind === "root"
    ? ["M4 10.5 12 4l8 6.5", "M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5"]
    : ["M3 7.5a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"];
  icon.appendChild(_bmMenuIcon(paths));
  btn.appendChild(icon);
  btn.appendChild(el("span", { className: "bm-move-label" }, label));
  return btn;
}

// Move the top-most selected nodes into `targetFolderId` (null = root), preserving
// each item (folders move whole). Skips a folder dropped into itself/its subtree.
/** @param {string | null} targetFolderId */
function _moveSelectedToFolder(targetFolderId) {
  const live = loadBookmarks();
  const targets = _bmEffectiveTargets(_bmBuildParentMap(live));
  let moved = 0;
  for (const id of targets) {
    const found = _findItemInStore(live, id);
    if (!found) continue;
    if (found.item.type === "folder" && targetFolderId
        && (found.item.id === targetFolderId || _isDescendant(found.item, targetFolderId))) continue;
    const [item] = found.parent.splice(found.index, 1);
    item.updatedAt = Date.now();
    insertItem(live, targetFolderId, item);
    moved++;
  }
  // Reveal the destination so the moved items are visible after re-render.
  if (targetFolderId) {
    const dest = _findItemInStore(live, targetFolderId);
    if (dest && dest.item.type === "folder") dest.item.expanded = true;
  }
  saveBookmarks(live);
  closeMoveModal();
  announce(moved === 1 ? "1개 항목을 이동했습니다." : `${moved}개 항목을 이동했습니다.`);
  exitBookmarkSelectMode();
  _rerenderActiveBookmarkTree();
  refreshBookmarkHeaderBtn();
}

function openMoveModal() {
  const store = loadBookmarks();
  const parentMap = _bmBuildParentMap(store);
  if (!_bmEffectiveTargets(parentMap).length) return;
  clearNode($bmMoveList);

  // 최상위 (root) first, then the folder list (indented by depth).
  const rootRow = _buildMoveRow("최상위", "root");
  rootRow.addEventListener("click", () => _moveSelectedToFolder(null));
  $bmMoveList.appendChild(rootRow);

  // Every folder except the ones being moved (a folder can't move into itself or
  // its own subtree) — i.e. selected folders + folders under a selected folder.
  for (const f of collectFolderOptions(store)) {
    if (_bmSelected.has(f.id) || _bmAncestorSelected(f.id, parentMap)) continue;
    const row = _buildMoveRow(f.name, "folder", f.depth);
    row.addEventListener("click", () => _moveSelectedToFolder(f.id));
    $bmMoveList.appendChild(row);
  }

  // 새 폴더 (below the list) — opens the new-folder modal where a parent can be
  // chosen (미지정=최상위); the created folder then receives the selection. The
  // parent options exclude the same folders the move list omits (selected folders +
  // folders under a selected ancestor) so the new folder can't be created inside the
  // selection — otherwise the move would be a no-op and leave a stray empty folder.
  $bmMoveNewFolder.onclick = () => {
    closeMoveModal();
    openNewFolderModal(
      (newId) => { if (newId) _moveSelectedToFolder(newId); },
      null,
      { folderFilter: (f) => !(_bmSelected.has(f.id) || _bmAncestorSelected(f.id, parentMap)) },
    );
  };

  moveOverlay.open();
  $bmMoveCancel.onclick = closeMoveModal;
}

function closeMoveModal() { moveOverlay.close(); }

$bmSelectShareBtn.addEventListener("click", _runBookmarkSelectShare);
$bmSelectMoveBtn.addEventListener("click", openMoveModal);
$bmSelectDeleteBtn.addEventListener("click", _runBookmarkSelectDelete);
$bmSelectCancelBtn.addEventListener("click", exitBookmarkSelectMode);
$bmMoveScrim.addEventListener("click", closeMoveModal);

// ── Export / Import bookmarks (Phase 2a) ──

function exportBookmarks() {
  const store = loadBookmarks();
  const payload = {
    _version: 1,
    exportedAt: Date.now(),
    bookmarks: store,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const _d = new Date();
  const date = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `bible-bookmarks-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  announce("북마크를 내보냈습니다.");
}

// ── BEGIN IMPORT_EXPORT ──
// Exercised by tests/unit/bookmark.test.js. Pure helpers for the import
// pipeline: validation (structural), merge (id-deduped union with existing
// taking precedence), and recursive count.
function _validateImportData(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.bookmarks)) return false;
  return true;
}

function _mergeBookmarkStores(existing, incoming) {
  const existingIds = new Set();
  function collectIds(items) {
    for (const item of items) {
      existingIds.add(item.id);
      if (item.type === "folder" && Array.isArray(item.children)) {
        collectIds(item.children);
      }
    }
  }
  collectIds(existing);

  function filterNew(items) {
    const result = [];
    for (const item of items) {
      if (item.type === "folder") {
        if (!existingIds.has(item.id)) {
          const mergedChildren = filterNew(item.children || []);
          result.push({ ...item, children: mergedChildren });
        }
      } else {
        if (!existingIds.has(item.id)) {
          result.push(item);
        }
      }
    }
    return result;
  }

  return [...existing, ...filterNew(incoming)];
}

function _countBookmarks(items) {
  let count = 0;
  for (const item of items) {
    if (item.type === "bookmark") {
      count += 1;
    } else if (item.type === "folder" && Array.isArray(item.children)) {
      count += _countBookmarks(item.children);
    }
  }
  return count;
}
// ── END IMPORT_EXPORT ──

// closeOnEsc off: in the stacked Escape router. onClose clears per-open
// handlers and resets the file input (ADR-032).
const importOverlay = createOverlay({
  panel: $bmImportModal,
  scrim: $bmImportScrim,
  initialFocus: () => $bmImportMerge,
  onClose: () => {
    $bmImportMerge.onclick = null;
    $bmImportOverwrite.onclick = null;
    $bmImportCancel.onclick = null;
    $bmImportInput.value = "";
  },
});

function closeImportModal() { importOverlay.close(); }

function openImportModal(incoming) {
  const bmCount = _countBookmarks(incoming.bookmarks);
  clearNode($bmImportBody);
  $bmImportBody.appendChild(
    el("p", {}, `북마크 ${bmCount}개를 현재 목록에 병합하거나 덮어쓸 수 있습니다.`)
  );

  importOverlay.open();
  const cleanup = closeImportModal;

  $bmImportMerge.onclick = () => {
    const existing = loadBookmarks();
    const merged = _mergeBookmarkStores(existing, incoming.bookmarks);
    saveBookmarks(merged);
    _rerenderActiveBookmarkTree();
    announce("북마크를 병합했습니다.");
    cleanup();
  };

  $bmImportOverwrite.onclick = () => {
    saveBookmarks(incoming.bookmarks);
    _rerenderActiveBookmarkTree();
    announce("북마크를 덮어썼습니다.");
    cleanup();
  };

  $bmImportCancel.onclick = cleanup;
}

// ── Verse selection mode ──

// Flatten the inner corners between adjacent selected verses so a run of
// consecutive selections renders as a single highlighted block.
function updateVerseSelectionBoundaries(scope) {
  const root = scope || document;
  const verses = [...root.querySelectorAll(".verse[data-vref]")];
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    const sel = v.classList.contains("verse-selected");
    const prevSel = sel && i > 0 && verses[i - 1].classList.contains("verse-selected");
    const nextSel = sel && i < verses.length - 1 && verses[i + 1].classList.contains("verse-selected");
    v.classList.toggle("verse-selected-join-prev", prevSel);
    v.classList.toggle("verse-selected-join-next", nextSel);
  }
}

function enterVerseSelectMode(bookId, chapter) {
  readingContext.verseSelectMode = true;
  readingContext.selectedVerses.clear();
  readingContext.bookId = bookId;
  readingContext.chapter = chapter;
  document.body.classList.add("verse-select-active");
  $verseSelectBar.hidden = false;
  updateVerseSelectBar();
  announce("절 선택 모드. 절을 눌러서 선택하세요.");
}

function exitVerseSelectMode() {
  readingContext.verseSelectMode = false;
  readingContext.selectedVerses.clear();
  document.body.classList.remove("verse-select-active");
  $verseSelectBar.hidden = true;
  document.querySelectorAll(".verse-selected, .verse-selected-join-prev, .verse-selected-join-next")
    .forEach(v => v.classList.remove("verse-selected", "verse-selected-join-prev", "verse-selected-join-next"));
}

function updateVerseSelectBar() {
  const count = readingContext.selectedVerses.size;
  if (count === 0) {
    $verseSelectCount.textContent = "구절을 눌러서 선택";
  } else {
    const articleEl = document.querySelector("article.chapter-text");
    const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), articleEl);
    const spec = refs.length
      ? selectedVersesToSpec(refs)
      : selectedVersesToSpec(Array.from(readingContext.selectedVerses));
    $verseSelectCount.textContent = `${spec.replace(/,/g, ', ')}절 선택됨`;
  }
  $verseSelectBookmarkBtn.disabled = count === 0;
  $verseSelectCopyBtn.disabled = count === 0;
}

// Serialize the currently selected verses to a clipboard-friendly text block
// with a trailing citation. Mirrors the article-level copy handler: groups of
// consecutive selected line-spans share their inter-verse breaks (stanza /
// paragraph / hemistich), non-consecutive groups separate with a blank line.
async function copySelectedVerses() {
  const article = document.querySelector("article.chapter-text");
  if (!article || readingContext.selectedVerses.size === 0) return;

  const children = [...article.children];
  /** @type {Array<[Element, Element]>} */
  const groups = [];
  /** @type {[Element, Element] | null} */
  let current = null;
  for (const child of children) {
    if (!child.classList.contains("verse")) continue;
    if (child.classList.contains("verse-selected")) {
      if (!current) {
        current = [child, child];
        groups.push(current);
      } else {
        current[1] = child;
      }
    } else {
      current = null;
    }
  }
  if (!groups.length) return;

  const textParts = groups.map(([first, last]) => serializeVerseRange(first, last));

  const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), article);
  const spec = refs.length
    ? selectedVersesToSpec(refs)
    : selectedVersesToSpec(Array.from(readingContext.selectedVerses));
  const book = (window.getBooksCache() ?? []).find((b) => b.id === readingContext.bookId);
  const bookName = book ? book.name_ko : readingContext.bookId;
  const citation = `— ${bookName} ${readingContext.chapter}:${spec} (공동번역성서)`;
  const fullText = `${textParts.join("\n\n")}\n\n${citation}`;

  try {
    await navigator.clipboard.writeText(fullText);
    announce("복사했습니다.");
    window._showSyncSnackbar?.("복사했습니다.");
    exitVerseSelectMode();
  } catch {
    announce("복사하지 못했습니다.");
    window._showSyncSnackbar?.("복사하지 못했습니다.");
  }
}

// ── Drawer toolbar event handlers ──

$bookmarkDrawerClose.addEventListener("click", closeBookmarkDrawer);
$bookmarkScrim.addEventListener("click", closeBookmarkDrawer);

$bmSaveClose.addEventListener("click", closeSaveModal);
$bmSaveScrim.addEventListener("click", closeSaveModal);

$bmConfirmCancel.addEventListener("click", closeConfirmModal);
$bmConfirmScrim.addEventListener("click", closeConfirmModal);

$bmChapterDeleteScrim.addEventListener("click", closeChapterDeleteModal);

$bmNewFolderClose.addEventListener("click", closeNewFolderModal);
$bmNewFolderScrim.addEventListener("click", closeNewFolderModal);
$bmNewFolderCancel.addEventListener("click", closeNewFolderModal);
$bmNewFolderConfirm.addEventListener("click", _commitNewFolder);
$bmNewFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _commitNewFolder(); }
});

$bmSaveChapterBtn.addEventListener("click", () => {
  openSaveModal("chapter");
});

$bmSelectVersesBtn.addEventListener("click", () => {
  closeBookmarkDrawer();
  enterVerseSelectMode(readingContext.bookId, readingContext.chapter);
});

$bmAddFolderBtn.addEventListener("click", () => {
  const toolbar = _$("bookmark-drawer-toolbar");
  if (toolbar.querySelector(".bm-new-folder-form")) return; // already open
  $bmAddFolderBtn.disabled = true;

  const form = el("div", { className: "bm-new-folder-form" });
  const input = el("input", {
    type: "text",
    className: "bm-new-folder-input",
    placeholder: "예: 대림1주일",
    maxlength: "50",
  });
  const confirmBtn = el("button", { type: "button", className: "bm-toolbar-btn" }, "추가");
  const cancelBtn = el("button", { type: "button", className: "bm-toolbar-btn" }, "취소");

  function cleanup() {
    form.remove();
    $bmAddFolderBtn.disabled = false;
  }
  function commit() {
    const name = input.value.trim();
    if (!name) { cleanup(); return; }
    const store = loadBookmarks();
    store.push({ type: "folder", id: generateId(), name, children: [], expanded: false, createdAt: Date.now() });
    saveBookmarks(store);
    _rerenderActiveBookmarkTree();
    cleanup();
  }

  confirmBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", cleanup);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    // Consume Escape here so it cancels only this inline form — without
    // stopPropagation it bubbles to the document Escape router, whose drawer
    // fallback would also close the drawer underneath (ADR-032).
    if (e.key === "Escape") { e.stopPropagation(); cleanup(); }
  });

  form.appendChild(input);
  form.appendChild(confirmBtn);
  form.appendChild(cancelBtn);
  toolbar.appendChild(form);
  requestAnimationFrame(() => input.focus());
});

$verseSelectCancelBtn.addEventListener("click", exitVerseSelectMode);
$verseSelectBookmarkBtn.addEventListener("click", () => openSaveModal("verses"));
$verseSelectCopyBtn.addEventListener("click", copySelectedVerses);
// Placeholder — note-taking is a follow-up feature (ADR-030 note slot).
$verseSelectNoteBtn.addEventListener("click", () => announce("노트 기능은 준비 중입니다."));

$bmOverflowBtn.addEventListener("click", () => {
  const isOpen = !$bmOverflowPanel.hidden;
  $bmOverflowPanel.hidden = isOpen;
  $bmOverflowBtn.setAttribute("aria-expanded", String(!isOpen));
});

$bmExportBtn.addEventListener("click", exportBookmarks);

$bmImportBtn.addEventListener("click", () => {
  $bmImportInput.value = "";
  $bmImportInput.click();
});

$bmImportInput.addEventListener("change", () => {
  const file = $bmImportInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      const result = /** @type {FileReader} */ (e.target).result;
      data = JSON.parse(typeof result === "string" ? result : "");
    } catch (_) {
      announce("파일을 읽을 수 없습니다. 올바른 JSON 파일인지 확인해 주세요.");
      $bmImportInput.value = "";
      return;
    }
    if (!_validateImportData(data)) {
      announce("북마크 파일 형식이 올바르지 않습니다.");
      $bmImportInput.value = "";
      return;
    }
    openImportModal(data);
  };
  reader.readAsText(file);
});

$bmImportScrim.addEventListener("click", closeImportModal);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$bmNewFolderModal.hidden) { e.preventDefault(); e.stopPropagation(); closeNewFolderModal(); return; }
    if (!$bmConfirmModal.hidden) { closeConfirmModal(); return; }
    if (!$bmChapterDeleteModal.hidden) { closeChapterDeleteModal(); return; }
    if (!$bmMoveModal.hidden) { closeMoveModal(); return; }
    if (!$bmImportModal.hidden) { closeImportModal(); return; }
    if (!$bmMergeModal.hidden) { closeMergeModal(); return; }
    if (!$bmSaveModal.hidden) { closeSaveModal(); return; }
    if (!$bookmarkDrawer.hidden) { closeBookmarkDrawer(); return; }
    if (readingContext.verseSelectMode) { exitVerseSelectMode(); return; }
    if (_bmSelectMode) { exitBookmarkSelectMode(); return; }
  }
});

// ── Drawer drag/resize handle init (called from app.js bootstrap) ──
// Operate on the bookmark drawer handle/resize affordances. They were
// historically in app.js's Audio Player section as hand-crafted geometry
// utilities; Phase 7b moved them next to the bookmark module they actually
// belong to. App.js's DOMContentLoaded bootstrap calls them via the
// `window.initBookmarkSheetDrag` / `window.initBookmarkDrawerResize`
// facade entries below.

// Drag (mobile) + width-resize (desktop) plumbing is shared with the cite sheet
// via the overlay factory (ADR-032 §2). The drawer's animated dismiss stays in
// closeBookmarkDrawer; onClose also clears the dragged inline height so the
// close animation starts from the CSS default. maxRatio 0.92 is the drawer's
// (slightly taller than the cite sheet's default 0.9).
function initBookmarkSheetDrag() {
  // onClose just dismisses; the drawer's closeTransition resets the inline
  // height after the slide-out, so the exit animates from the dragged height
  // (no jump to the rest size first).
  attachSheetDrag(_$("bookmark-drawer-handle"), _$("bookmark-drawer"), {
    onClose: closeBookmarkDrawer,
    maxRatio: 0.92,
  });
}

function initBookmarkDrawerResize() {
  attachSheetResize(_$("bookmark-drawer-resize"), _$("bookmark-drawer"));
}

// ── Window facade ──
// Both an `appBookmark` aggregate (for new ESM-style import-or-window
// access) and per-name globals (so existing bare `parseVerseSpec(...)` /
// `buildBackBtn(...)` calls in app.js's Phase 7 territory resolve via
// globalThis until those callers move into this module). Also exposes
// `renderBookmarkTree` for sync/state-machine.js's post-sync re-render.

const appBookmark = {
  // Phase 6a helpers
  parseVerseSpec, collapseFullVerseRefs, collapseSegmentedVerses, selectedVersesToSpec, mergeVerseSpecs,
  serializeVerseRange,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
  // Phase 6b UI
  buildBackBtn, buildBookmarkHeaderBtn,
  openBookmarkDrawer, closeBookmarkDrawer,
  renderBookmarkTree, renderBookmarksView, refreshBookmarkHeaderBtn,
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
  enterBookmarkSelectMode, exitBookmarkSelectMode,
  openDriveDisconnectModal,
  // Phase 8 drawer geometry init
  initBookmarkSheetDrag, initBookmarkDrawerResize,
};
window.appBookmark = appBookmark;

// Phase 6a per-name globals (existing)
window.parseVerseSpec = parseVerseSpec;
window.collapseFullVerseRefs = collapseFullVerseRefs;
window.selectedVersesToSpec = selectedVersesToSpec;
window.mergeVerseSpecs = mergeVerseSpecs;
window.serializeVerseRange = serializeVerseRange;
window.findExistingChapterBookmarks = findExistingChapterBookmarks;
window._walkBookmarks = _walkBookmarks;
window._findItemInStore = _findItemInStore;
window._findParentFolderId = _findParentFolderId;
window.removeItemById = removeItemById;
window.insertItem = insertItem;
window.collectFolderOptions = collectFolderOptions;
window.moveBookmarkItem = moveBookmarkItem;
window.closeSwipedRow = closeSwipedRow;
window._setupDragHandle = _setupDragHandle;
window.resetSwipedRow = resetSwipedRow;
window.closeSwipedRowIfOutside = closeSwipedRowIfOutside;

// Phase 6b per-name globals
window.buildBackBtn = buildBackBtn;
window.buildHomeBtn = buildHomeBtn;
window.buildBookmarkHeaderBtn = buildBookmarkHeaderBtn;
window.openBookmarkDrawer = openBookmarkDrawer;
window.closeBookmarkDrawer = closeBookmarkDrawer;
window.closeSaveModal = closeSaveModal;
window.closeNewFolderModal = closeNewFolderModal;
window.closeMergeModal = closeMergeModal;
window.closeImportModal = closeImportModal;
// Exposed so route() can dismiss the destructive-confirm overlay on any nav
// (e.g. OS back gesture mid-confirm) — its scrim would otherwise persist over
// the rebuilt view. Safe to call when already hidden (self-guards).
window.closeConfirmModal = closeConfirmModal;
// Same rationale for the chapter-delete picker (header bookmark toggle-off).
window.closeChapterDeleteModal = closeChapterDeleteModal;
// Same rationale for the move-to-folder modal (선택 모드 → 이동).
window.closeMoveModal = closeMoveModal;
window.renderBookmarkTree = renderBookmarkTree;
// Re-render whichever bookmark surface is mounted (drawer OR /bookmarks full
// view). Sync layer + mutation flows use this so the visible tree refreshes.
window.rerenderActiveBookmarkTree = _rerenderActiveBookmarkTree;
window.renderBookmarksView = renderBookmarksView;
window.enterVerseSelectMode = enterVerseSelectMode;
window.exitVerseSelectMode = exitVerseSelectMode;
// Exposed so route() can drop select mode on any nav (its bottom bar would
// otherwise linger over the rebuilt view), and for e2e to drive the mode.
window.enterBookmarkSelectMode = enterBookmarkSelectMode;
window.exitBookmarkSelectMode = exitBookmarkSelectMode;
window.updateVerseSelectionBoundaries = updateVerseSelectionBoundaries;
window.updateVerseSelectBar = updateVerseSelectBar;
window.openDriveDisconnectModal = openDriveDisconnectModal;
window.closeDriveDisconnectModal = closeDriveDisconnectModal;
// Phase 8: drawer drag/resize handle init — called from app.js bootstrap.
window.initBookmarkSheetDrag = initBookmarkSheetDrag;
window.initBookmarkDrawerResize = initBookmarkDrawerResize;

export {
  parseVerseSpec, collapseFullVerseRefs, selectedVersesToSpec, mergeVerseSpecs,
  serializeVerseRange,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
  buildBackBtn, buildBookmarkHeaderBtn,
  openBookmarkDrawer, closeBookmarkDrawer,
  renderBookmarkTree, renderBookmarksView, refreshBookmarkHeaderBtn,
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
  openDriveDisconnectModal,
  initBookmarkSheetDrag, initBookmarkDrawerResize,
};
