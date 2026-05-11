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

const { _$, el, clearNode, chUnit, setInert, trapFocus } = window.appHelpers;
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
  for (const item of store) {
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
  renderBookmarkTree();
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
// opening a new one auto-closes the previous. See ADR-010 (2026-05-03).
const SWIPE_REVEAL_PX = 140;
const LONG_PRESS_MS = 500;
/** @type {HTMLElement | null} */
let _swipedRow = null;
/** @type {DragState | null} */
let _dragState = null;

function _isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

/** @param {HTMLElement | null} except */
function closeSwipedRow(except) {
  if (_swipedRow && _swipedRow !== except) {
    _swipedRow.classList.remove("bm-swiped");
    const prevActions = /** @type {HTMLElement | null} */ (_swipedRow.querySelector(".bm-row-actions-mobile"));
    if (prevActions) prevActions.style.transform = "";
    _swipedRow = null;
  }
}

/** @param {HTMLElement} row */
function _openSwipedRow(row) {
  closeSwipedRow(row);
  row.classList.add("bm-swiped");
  const actions = /** @type {HTMLElement | null} */ (row.querySelector(".bm-row-actions-mobile"));
  if (actions) actions.style.transform = "";
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
    if (/** @type {HTMLElement} */ (e.target).closest("button")) return;
    // Buttons inside the mobile-only revealed actions live outside .bm-row-content
    // but inside the row; the closest("button") check above already excludes them.

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const origRect = li.getBoundingClientRect();
    const isTouch = e.pointerType !== "mouse";
    const swipeActions = /** @type {HTMLElement | null} */ (row.querySelector(".bm-row-actions-mobile"));
    const canSwipe = _isMobileViewport() && isTouch && !!swipeActions;
    // null until the first significant move classifies the gesture.
    // "drag" → reorder, "swipe" → reveal actions, "abort" → cede to browser scroll
    /** @type {"drag" | "swipe" | "abort" | null} */
    let mode = null;
    let dragStarted = false;
    const startedSwiped = canSwipe && row.classList.contains("bm-swiped");
    const baseOffset = startedSwiped ? -SWIPE_REVEAL_PX : 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let longPressTimer = null;

    // Touch devices: long-press without movement enters drag-to-reorder mode
    // (haptic feedback acts as the visual cue). Action panel reveal is
    // horizontal-swipe only. Mouse users start dragging immediately on move.
    if (isTouch && !startedSwiped) {
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
        if (canSwipe && Math.abs(dx) > Math.abs(dy)) {
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
        } else {
          // Mouse user → immediate drag-to-reorder on any movement.
          mode = "drag";
          _beginDrag();
        }
      }

      if (mode === "swipe") {
        let offset = baseOffset + dx;
        if (offset > 0) offset = 0;
        if (offset < -SWIPE_REVEAL_PX * 1.2) offset = -SWIPE_REVEAL_PX * 1.2;
        // Slide the action panel in from the right; row content stays put.
        // offset 0 → panel translateX(140) (off-screen); offset -140 → translateX(0) (open).
        if (swipeActions) {
          const panelTx = SWIPE_REVEAL_PX + offset;
          swipeActions.style.transform = `translateX(${panelTx}px)`;
        }
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
        row.classList.remove("bm-swiping");
        const finalOffset = baseOffset + (e.clientX - startX);
        if (finalOffset < -SWIPE_REVEAL_PX / 2) {
          _openSwipedRow(row);
        } else {
          row.classList.remove("bm-swiped");
          if (swipeActions) swipeActions.style.transform = "";
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
        row.classList.remove("bm-swiping");
        // Snap back to the pre-gesture state on cancel.
        if (startedSwiped) {
          _openSwipedRow(row);
        } else {
          row.classList.remove("bm-swiped");
          if (swipeActions) swipeActions.style.transform = "";
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
/** @type {(() => void) | null} */
let _bookmarkDrawerTrap = null;
/** @type {HTMLElement | null} */
let _bookmarkDrawerLastFocus = null;
/** @type {(() => void) | null} */
let _bmSaveModalTrap = null;
/** @type {(() => void) | null} */
let _bmMergeModalTrap = null;
/** @type {(() => void) | null} */
let _bmNewFolderTrap = null;
/** @type {((id: string) => void) | null} */
let _bmNewFolderCallback = null;
let _bookmarkDrawerCloseSeq = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookmarkDrawerCloseTimer = null;
// `_dragState` was extracted to js/app/bookmark.js (ADR-018 Phase 6a) along
// with the drag & drop pointer handling that owns it.
const BOOKMARK_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #search-fab, #search-sheet, #search-scrim, #launch-screen, #install-scrim, #install-modal, #verse-select-bar";
/** @param {boolean} on */
function setBookmarkBackgroundInert(on) { setInert(on, BOOKMARK_INERT_SELECTORS); }

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

let _driveDisconnectTrap = null;

function openDriveDisconnectModal() {
  $driveDisconnectScrim.hidden = false;
  $driveDisconnectModal.hidden = false;
  _driveDisconnectTrap = trapFocus($driveDisconnectModal);
  requestAnimationFrame(() => $driveDisconnectKeep.focus());
}

function closeDriveDisconnectModal() {
  $driveDisconnectScrim.hidden = true;
  $driveDisconnectModal.hidden = true;
  if (_driveDisconnectTrap) { _driveDisconnectTrap(); _driveDisconnectTrap = null; }
}

$driveDisconnectCancel.addEventListener("click", closeDriveDisconnectModal);
$driveDisconnectScrim.addEventListener("click", closeDriveDisconnectModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$driveDisconnectModal.hidden) closeDriveDisconnectModal();
});

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
const $bmNewFolderConfirm = _$("bm-new-folder-confirm");
const $bmNewFolderCancel = _$("bm-new-folder-cancel");
const $bmMergeScrim = _$("bm-merge-scrim");
const $bmMergeModal = _$("bm-merge-modal");
const $bmMergeBody = _$("bm-merge-body");
const $bmMergeYes = _$("bm-merge-yes");
const $bmMergeNo = _$("bm-merge-no");
const $bmMergeCancel = _$("bm-merge-cancel");
const $verseSelectBar = _$("verse-select-bar");
const $verseSelectCount = _$("verse-select-count");
const $verseSelectBookmarkBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-bookmark-btn"));
const $verseSelectCopyBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-copy-btn"));
const $verseSelectCancelBtn = _$("verse-select-cancel-btn");

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

// Build the bookmark icon SVG button for the chapter header
function buildBookmarkHeaderBtn(bookId, chapter) {
  const btn = el("button", {
    className: "title-bookmark-btn",
    "aria-label": "북마크",
    type: "button",
  });
  if (findExistingChapterBookmarks(bookId, chapter).length > 0) {
    btn.classList.add("has-bookmark");
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M160-80v-560q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v560L400-200 160-80Zm80-121 160-86 160 86v-439H240v439Zm480-39v-560H280v-80h440q33 0 56.5 23.5T800-800v560h-80ZM240-640h320-320Z");
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.addEventListener("click", () => openBookmarkDrawer(bookId, chapter));
  return btn;
}

function refreshBookmarkHeaderBtn() {
  const btn = document.querySelector(".title-bookmark-btn");
  if (!btn || !readingContext.bookId || !readingContext.chapter) return;
  btn.classList.toggle(
    "has-bookmark",
    findExistingChapterBookmarks(readingContext.bookId, readingContext.chapter).length > 0
  );
}

function openBookmarkDrawer(bookId, chapter) {
  _bookmarkDrawerCloseSeq += 1;
  if (_bookmarkDrawerCloseTimer) {
    clearTimeout(_bookmarkDrawerCloseTimer);
    _bookmarkDrawerCloseTimer = null;
  }
  $bookmarkDrawer.classList.remove("drawer-closing");
  _bookmarkDrawerLastFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  $bookmarkScrim.hidden = false;
  $bookmarkDrawer.hidden = false;
  // Update toolbar visibility based on whether we're in a chapter
  const inChapter = bookId && chapter;
  $bmSaveChapterBtn.disabled = !inChapter;
  $bmSelectVersesBtn.disabled = !inChapter;
  renderBookmarkTree();
  setBookmarkBackgroundInert(true);
  const scrollY = window.scrollY;
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
  document.body.dataset.scrollY = String(scrollY);
  _bookmarkDrawerTrap = trapFocus($bookmarkDrawer);
  requestAnimationFrame(() => $bookmarkDrawerClose.focus());
}

function closeBookmarkDrawer() {
  if ($bookmarkDrawer.hidden || $bookmarkDrawer.classList.contains("drawer-closing")) return;
  closeSwipedRow(null);
  $bmOverflowPanel.hidden = true;
  $bmOverflowBtn.setAttribute("aria-expanded", "false");
  const closeSeq = ++_bookmarkDrawerCloseSeq;
  $bookmarkScrim.hidden = true;
  $bookmarkDrawer.classList.add("drawer-closing");

  // Restore body scroll and focus immediately so the page feels responsive
  setBookmarkBackgroundInert(false);
  const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollY);
  if (_bookmarkDrawerTrap) { _bookmarkDrawerTrap(); _bookmarkDrawerTrap = null; }
  if (_bookmarkDrawerLastFocus && _bookmarkDrawerLastFocus.focus) {
    try { _bookmarkDrawerLastFocus.focus(); } catch {}
  }

  let finalized = false;
  const finalize = () => {
    if (finalized || closeSeq !== _bookmarkDrawerCloseSeq) return;
    finalized = true;
    if (_bookmarkDrawerCloseTimer) {
      clearTimeout(_bookmarkDrawerCloseTimer);
      _bookmarkDrawerCloseTimer = null;
    }
    $bookmarkDrawer.hidden = true;
    $bookmarkDrawer.classList.remove("drawer-closing");
    $bookmarkDrawer.style.height = "";
    $bookmarkDrawer.style.width = "";
  };
  $bookmarkDrawer.addEventListener("animationend", finalize, { once: true });
  _bookmarkDrawerCloseTimer = setTimeout(() => {
    _bookmarkDrawerCloseTimer = null;
    finalize();
  }, 350); // fallback
}

// ── Bookmark tree rendering ──

// ── BEGIN BOOKMARK_HREF ──
// Exercised by tests/unit/bookmark.test.js. Pure URL builder — verseSpec="all"
// drops the verse segment so the link points at the whole chapter.
function _bookmarkHref(bm) {
  if (bm.verseSpec === "all") return `/${bm.bookId}/${bm.chapter}`;
  return `/${bm.bookId}/${bm.chapter}/${bm.verseSpec}`;
}
// ── END BOOKMARK_HREF ──

function _buildBookmarkItem(bm, depth) {
  const li = el("li", { role: "treeitem", className: "bm-bookmark", "data-id": bm.id, tabIndex: "-1" });
  if (depth > 0) li.setAttribute("aria-level", String(depth + 1));
  const isActive = _isActiveBookmark(bm);
  const row = el("div", { className: "bm-bookmark-row" + (isActive ? " bm-active" : "") });
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
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
    if (row.classList.contains("bm-swiped")) {
      closeSwipedRow(null);
      return;
    }
    closeBookmarkDrawer();
    navigate(_bookmarkHref(bm));
  });

  const editAction = () => {
    closeSwipedRow(null);
    openSaveModal("edit", { existingId: bm.id });
  };
  const deleteAction = () => {
    if (!window.confirm(`"${bm.label}" 북마크를 삭제할까요?`)) return;
    closeSwipedRow(null);
    const store = loadBookmarks();
    removeItemById(store, bm.id);
    saveBookmarks(store);
    renderBookmarkTree();
    refreshBookmarkHeaderBtn();
  };

  const actions = el("div", { className: "bm-item-actions" });
  const editBtn = el("button", { className: "bm-action-btn bm-edit-btn", type: "button" }, "수정");
  editBtn.addEventListener("click", editAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  // Mobile swipe-to-reveal actions panel (hidden on desktop via CSS).
  // Slides in from the right and overlays the right edge of the row content.
  const mobileActions = el("div", { className: "bm-row-actions-mobile", "aria-hidden": "true" });
  const mEditBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-edit-btn",
    type: "button",
    "aria-label": `${bm.label} 수정`,
  }, "수정");
  mEditBtn.addEventListener("click", editAction);
  const mDelBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-delete-btn",
    type: "button",
    "aria-label": `${bm.label} 삭제`,
  }, "삭제");
  mDelBtn.addEventListener("click", deleteAction);
  mobileActions.appendChild(mEditBtn);
  mobileActions.appendChild(mDelBtn);

  content.appendChild(typeIcon);
  content.appendChild(link);
  content.appendChild(actions);
  row.appendChild(content);
  row.appendChild(mobileActions);
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
 * @returns {{ el: HTMLElement, getValue: () => string|null, close: () => void }}
 */
function _buildFolderCombobox(folderOptions, selectedFolderId) {
  const initial = selectedFolderId != null && String(selectedFolderId) !== "" ? String(selectedFolderId) : "";
  const wrap = el("div", { className: "bm-folder-combobox", id: "bm-folder-combobox" });
  const hidden = el("input", { type: "hidden", className: "bm-folder-combobox-input", value: initial });
  const listId = "bm-folder-listbox";
  const iconSlot = el("span", { className: "bm-folder-combobox-btn-icon" });
  iconSlot.appendChild(_buildMaterialFolderIcon({ size: 16 }));
  const textSlot = el("span", { className: "bm-folder-combobox-btn-label" });
  const chevron = el("span", { className: "bm-folder-combobox-chevron", "aria-hidden": "true" }, "▾");
  const btn = el("button", {
    type: "button",
    id: "bm-folder-combobox-btn",
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

  // Persistent "+ 새 폴더" action at the bottom of the listbox.
  // role="presentation" so screen readers don't read it as a folder option.
  const newFolderItem = el("li", { role: "presentation", className: "bm-folder-combobox-new" });
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

  function rebuildOptions(options) {
    currentOptions = options;
    list.replaceChildren();
    addOption("", "최상위", 0);
    for (const o of options) addOption(String(o.id), o.name, o.depth);
    list.appendChild(newFolderItem);
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
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
  const toggle = el("span", { className: "bm-folder-toggle", "aria-hidden": "true" });
  toggle.appendChild(_buildFolderToggleIcon(expanded));
  const name = el("span", { className: "bm-folder-name" }, folder.name);
  row.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest(".bm-item-actions, .bm-row-actions-mobile")) return;
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
    if (found) found.item.name = newName.trim();
    saveBookmarks(store);
    renderBookmarkTree();
  };
  const deleteAction = () => {
    const childCount = folder.children ? folder.children.length : 0;
    const msg = childCount > 0
      ? `"${folder.name}" 폴더와 안의 항목 ${childCount}개를 모두 삭제할까요?`
      : `"${folder.name}" 폴더를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    closeSwipedRow(null);
    const store = loadBookmarks();
    removeItemById(store, folder.id);
    saveBookmarks(store);
    renderBookmarkTree();
  };

  const actions = el("div", { className: "bm-item-actions" });
  const renameBtn = el("button", { className: "bm-action-btn", type: "button" }, "수정");
  renameBtn.addEventListener("click", renameAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(renameBtn);
  actions.appendChild(delBtn);

  const mobileActions = el("div", { className: "bm-row-actions-mobile", "aria-hidden": "true" });
  const mRenameBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-edit-btn",
    type: "button",
    "aria-label": `${folder.name} 수정`,
  }, "수정");
  mRenameBtn.addEventListener("click", renameAction);
  const mDelBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-delete-btn",
    type: "button",
    "aria-label": `${folder.name} 삭제`,
  }, "삭제");
  mDelBtn.addEventListener("click", deleteAction);
  mobileActions.appendChild(mRenameBtn);
  mobileActions.appendChild(mDelBtn);

  content.appendChild(toggle);
  content.appendChild(name);
  content.appendChild(actions);
  row.appendChild(content);
  row.appendChild(mobileActions);
  li.appendChild(row);
  const children = el("ul", { role: "group", className: "bm-folder-children" });
  for (const child of (folder.children || [])) {
    children.appendChild(child.type === "folder"
      ? _buildFolderItem(child, depth + 1)
      : _buildBookmarkItem(child, depth + 1));
  }
  li.appendChild(children);
  return li;
}

function renderBookmarkTree() {
  _renderPathname = window.location.pathname;
  // The previously swiped row may be replaced when we re-render; drop the
  // stale reference held by js/app/bookmark.js.
  resetSwipedRow();
  clearNode($bookmarkDrawerBody);
  const store = loadBookmarks();
  if (!store.length) {
    $bookmarkDrawerBody.appendChild(el("li", { className: "bm-empty", role: "presentation" }, "저장된 북마크가 없습니다."));
    return;
  }
  for (const item of store) {
    $bookmarkDrawerBody.appendChild(item.type === "folder"
      ? _buildFolderItem(item, 0)
      : _buildBookmarkItem(item, 0));
  }
  // Set roving tabindex: first treeitem is reachable, rest are -1
  const items = _getVisibleTreeItems();
  items.forEach((item, i) => item.setAttribute("tabIndex", i === 0 ? "0" : "-1"));
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
    const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), article);
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

  $bmSaveScrim.hidden = false;
  $bmSaveModal.hidden = false;
  _bmSaveModalTrap = trapFocus($bmSaveModal);
  requestAnimationFrame(() => labelInput.focus());
}

function closeSaveModal() {
  const c = /** @type {HTMLElement & { _bmClose?: () => void } | null} */ (document.getElementById("bm-folder-combobox"));
  if (c && c._bmClose) c._bmClose();
  $bmSaveScrim.hidden = true;
  $bmSaveModal.hidden = true;
  if (_bmSaveModalTrap) { _bmSaveModalTrap(); _bmSaveModalTrap = null; }
}

function openNewFolderModal(onConfirm) {
  $bmNewFolderInput.value = "";
  $bmNewFolderInput.removeAttribute("aria-invalid");
  _bmNewFolderCallback = onConfirm || null;
  $bmNewFolderScrim.hidden = false;
  $bmNewFolderModal.hidden = false;
  _bmNewFolderTrap = trapFocus($bmNewFolderModal);
  requestAnimationFrame(() => $bmNewFolderInput.focus());
}

function closeNewFolderModal() {
  $bmNewFolderScrim.hidden = true;
  $bmNewFolderModal.hidden = true;
  _bmNewFolderCallback = null;
  if (_bmNewFolderTrap) { _bmNewFolderTrap(); _bmNewFolderTrap = null; }
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
  store.push({ type: "folder", id, name, children: [], expanded: false });
  saveBookmarks(store);
  renderBookmarkTree();
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
  renderBookmarkTree();
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

  $bmMergeScrim.hidden = false;
  $bmMergeModal.hidden = false;
  _bmMergeModalTrap = trapFocus($bmMergeModal);
  requestAnimationFrame(() => $bmMergeYes.focus());

  function cleanup() {
    $bmMergeScrim.hidden = true;
    $bmMergeModal.hidden = true;
    if (_bmMergeModalTrap) { _bmMergeModalTrap(); _bmMergeModalTrap = null; }
    $bmMergeYes.onclick = null;
    $bmMergeNo.onclick = null;
    $bmMergeCancel.onclick = null;
  }

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
    renderBookmarkTree();
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

let _bmImportModalTrap = null;

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

function openImportModal(incoming) {
  const bmCount = _countBookmarks(incoming.bookmarks);
  clearNode($bmImportBody);
  $bmImportBody.appendChild(
    el("p", {}, `북마크 ${bmCount}개를 현재 목록에 병합하거나 덮어쓸 수 있습니다.`)
  );

  $bmImportScrim.hidden = false;
  $bmImportModal.hidden = false;
  _bmImportModalTrap = trapFocus($bmImportModal);
  requestAnimationFrame(() => $bmImportMerge.focus());

  function cleanup() {
    $bmImportScrim.hidden = true;
    $bmImportModal.hidden = true;
    if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
    $bmImportMerge.onclick = null;
    $bmImportOverwrite.onclick = null;
    $bmImportCancel.onclick = null;
    $bmImportInput.value = "";
  }

  $bmImportMerge.onclick = () => {
    const existing = loadBookmarks();
    const merged = _mergeBookmarkStores(existing, incoming.bookmarks);
    saveBookmarks(merged);
    renderBookmarkTree();
    announce("북마크를 병합했습니다.");
    cleanup();
  };

  $bmImportOverwrite.onclick = () => {
    saveBookmarks(incoming.bookmarks);
    renderBookmarkTree();
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
  announce("절 선택 모드. 절을 탭해서 선택하세요.");
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
    $verseSelectCount.textContent = "절을 눌러 선택하세요.";
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

  const textParts = groups.map(([first, last]) => {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const work = document.createElement("div");
    work.appendChild(range.cloneContents());
    work.querySelectorAll(".verse-num").forEach((n) => n.remove());
    work.querySelectorAll(".stanza-break, .paragraph-break, .pilcrow").forEach((n) => { n.textContent = "\n\n"; });
    work.querySelectorAll(".hemistich-break").forEach((n) => { n.textContent = "\n"; });
    return (work.textContent ?? "")
      .replace(/\u2060/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  });

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
    exitVerseSelectMode();
  } catch {
    announce("복사에 실패했습니다.");
  }
}

// ── Drawer toolbar event handlers ──

$bookmarkDrawerClose.addEventListener("click", closeBookmarkDrawer);
$bookmarkScrim.addEventListener("click", closeBookmarkDrawer);

$bmSaveClose.addEventListener("click", closeSaveModal);
$bmSaveScrim.addEventListener("click", closeSaveModal);

$bmNewFolderClose.addEventListener("click", closeNewFolderModal);
$bmNewFolderScrim.addEventListener("click", closeNewFolderModal);
$bmNewFolderCancel.addEventListener("click", closeNewFolderModal);
$bmNewFolderConfirm.addEventListener("click", _commitNewFolder);
$bmNewFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _commitNewFolder(); }
  else if (e.key === "Escape") { e.preventDefault(); closeNewFolderModal(); }
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
    store.push({ type: "folder", id: generateId(), name, children: [], expanded: false });
    saveBookmarks(store);
    renderBookmarkTree();
    cleanup();
  }

  confirmBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", cleanup);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") cleanup();
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

$bmImportScrim.addEventListener("click", () => {
  if (!$bmImportModal.hidden) {
    $bmImportScrim.hidden = true;
    $bmImportModal.hidden = true;
    if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
    $bmImportMerge.onclick = null;
    $bmImportOverwrite.onclick = null;
    $bmImportCancel.onclick = null;
    $bmImportInput.value = "";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$bmImportModal.hidden) {
      $bmImportScrim.hidden = true;
      $bmImportModal.hidden = true;
      if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
      $bmImportMerge.onclick = null;
      $bmImportOverwrite.onclick = null;
      $bmImportCancel.onclick = null;
      $bmImportInput.value = "";
      return;
    }
    if (!$bmMergeModal.hidden) {
      $bmMergeScrim.hidden = true;
      $bmMergeModal.hidden = true;
      if (_bmMergeModalTrap) { _bmMergeModalTrap(); _bmMergeModalTrap = null; }
      $bmMergeYes.onclick = null;
      $bmMergeNo.onclick = null;
      $bmMergeCancel.onclick = null;
      return;
    }
    if (!$bmSaveModal.hidden) { closeSaveModal(); return; }
    if (!$bookmarkDrawer.hidden) { closeBookmarkDrawer(); return; }
    if (readingContext.verseSelectMode) { exitVerseSelectMode(); return; }
  }
});

// ── Drawer drag/resize handle init (called from app.js bootstrap) ──
// Operate on the bookmark drawer handle/resize affordances. They were
// historically in app.js's Audio Player section as hand-crafted geometry
// utilities; Phase 7b moved them next to the bookmark module they actually
// belong to. App.js's DOMContentLoaded bootstrap calls them via the
// `window.initBookmarkSheetDrag` / `window.initBookmarkDrawerResize`
// facade entries below.

function initBookmarkSheetDrag() {
  const handle = _$("bookmark-drawer-handle");
  const drawer = _$("bookmark-drawer");
  let startY = 0;
  let startH = 0;

  function onMove(clientY) {
    const delta = startY - clientY;
    const newH = Math.min(Math.max(startH + delta, window.innerHeight * 0.3), window.innerHeight * 0.92);
    drawer.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth >= 769) return; // desktop uses fixed-size side panel
    e.preventDefault();
    startY = e.clientY;
    startH = drawer.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  /** @param {PointerEvent} e */
  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    if (drawer.offsetHeight < window.innerHeight * 0.2) {
      closeBookmarkDrawer();
      drawer.style.height = "";
    }
  }
}

function initBookmarkDrawerResize() {
  const handle = _$("bookmark-drawer-resize");
  const drawer = _$("bookmark-drawer");
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth < 769) return;
    e.preventDefault();
    startX = e.clientX;
    startW = drawer.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  /** @param {PointerEvent} e */
  function onPointerMove(e) {
    const delta = startX - e.clientX; // drag left = wider
    const newW = Math.min(Math.max(startW + delta, 240), window.innerWidth * 0.85);
    drawer.style.width = `${newW}px`;
  }

  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
  }
}

// ── Window facade ──
// Both an `appBookmark` aggregate (for new ESM-style import-or-window
// access) and per-name globals (so existing bare `parseVerseSpec(...)` /
// `buildBackBtn(...)` calls in app.js's Phase 7 territory resolve via
// globalThis until those callers move into this module). Also exposes
// `renderBookmarkTree` for sync/state-machine.js's post-sync re-render.

const appBookmark = {
  // Phase 6a helpers
  parseVerseSpec, collapseFullVerseRefs, selectedVersesToSpec, mergeVerseSpecs,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
  // Phase 6b UI
  buildBackBtn, buildBookmarkHeaderBtn,
  openBookmarkDrawer, closeBookmarkDrawer,
  renderBookmarkTree, refreshBookmarkHeaderBtn,
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
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
window.buildBookmarkHeaderBtn = buildBookmarkHeaderBtn;
window.openBookmarkDrawer = openBookmarkDrawer;
window.closeBookmarkDrawer = closeBookmarkDrawer;
window.renderBookmarkTree = renderBookmarkTree;
window.enterVerseSelectMode = enterVerseSelectMode;
window.exitVerseSelectMode = exitVerseSelectMode;
window.updateVerseSelectionBoundaries = updateVerseSelectionBoundaries;
window.updateVerseSelectBar = updateVerseSelectBar;
window.openDriveDisconnectModal = openDriveDisconnectModal;
// Phase 8: drawer drag/resize handle init — called from app.js bootstrap.
window.initBookmarkSheetDrag = initBookmarkSheetDrag;
window.initBookmarkDrawerResize = initBookmarkDrawerResize;

export {
  parseVerseSpec, collapseFullVerseRefs, selectedVersesToSpec, mergeVerseSpecs,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
  buildBackBtn, buildBookmarkHeaderBtn,
  openBookmarkDrawer, closeBookmarkDrawer,
  renderBookmarkTree, refreshBookmarkHeaderBtn,
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
  openDriveDisconnectModal,
  initBookmarkSheetDrag, initBookmarkDrawerResize,
};
