"use strict";
// @ts-check

// Bookmark utility helpers — verse spec parsing, store query, drag & drop
// pointer handling. UI rendering (tree, drawer, modals, save/merge dialogs)
// remains in app.js pending Phase 6b extraction; the drag handler calls
// `window.renderBookmarkTree()` after a successful move.
//
// Phase 6a of the app.js modularization (ADR-018). The swipe-to-reveal
// mobile pattern (`_swipedRow`) and the drag ghost state (`_dragState`)
// are module-private; callers in Phase 6b territory (`renderBookmarkTree`
// + drawer pointerdown handler) interact with that state through the
// `resetSwipedRow` / `closeSwipedRowIfOutside` helpers exposed below.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */
/** @typedef {import("../types").VerseSelectDrag} VerseSelectDrag */
/** @typedef {import("../types").DragState} DragState */

const { loadBookmarks, saveBookmarks } = window.appStorage;

// ── Verse spec utilities ──

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
  if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
}

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

// ── Window facade ──
// Both an `appBookmark` aggregate (for new ESM-style import-or-window
// access) and per-name globals (so existing bare `parseVerseSpec(...)` /
// `findExistingChapterBookmarks(...)` calls in app.js's Phase 6b territory
// resolve via globalThis until those callers move into this module).

const appBookmark = {
  parseVerseSpec, collapseFullVerseRefs, selectedVersesToSpec, mergeVerseSpecs,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
};
window.appBookmark = appBookmark;

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

export {
  parseVerseSpec, collapseFullVerseRefs, selectedVersesToSpec, mergeVerseSpecs,
  findExistingChapterBookmarks,
  _walkBookmarks, _findItemInStore, _findParentFolderId,
  removeItemById, insertItem, collectFolderOptions,
  moveBookmarkItem, closeSwipedRow, _setupDragHandle,
  resetSwipedRow, closeSwipedRowIfOutside,
};
