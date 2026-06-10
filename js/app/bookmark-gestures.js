"use strict";
// @ts-check

// Bookmark gesture engine — extracted from bookmark.js (ADR-034 후속). The
// interaction layer for the bookmark tree: drag-to-reorder (DRAG_CORE + drag
// indicators), mobile swipe-to-reveal-actions state (SWIPED_ROW), the pure
// swipe-release math (SWIPE_GESTURE), and the unified pointer handler
// (_setupDragHandle) that classifies a touch into drag / swipe / scroll and
// drives them. bookmark.js (drawer/tree UI) imports the public surface via ESM.
//
// The handler reaches back into the orchestrator for two runtime hooks, injected
// once via initBookmarkGestures() so this leaf never imports bookmark.js back (the
// circular-import class of break ADR-034 avoids — 의존성 주입, like initBookmarkModals):
//   - rerenderTree: re-render the mounted bookmark surface after a reorder
//   - isSelectMode: suppress swipe/drag while multi-select is active
//
// The DRAG_CORE / SWIPED_ROW / SWIPE_GESTURE marker blocks are sliced by
// tests/unit/bookmark.test.js, which reads this file's source. Deps: appStorage,
// bookmark-core (_findItemInStore, getBookmarkSort).

/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */
/** @typedef {import("../types").DragState} DragState */

const { loadBookmarks, saveBookmarks } = window.appStorage;

import { _findItemInStore, getBookmarkSort } from "./bookmark-core.js";

// ── Dependency injection ──
// bookmark.js injects these at startup (initBookmarkGestures). Defaults are
// no-ops so a stray pre-init call can't throw.
let _rerenderTree = () => {};
let _isSelectMode = () => false;
/** @param {{ rerenderTree: () => void, isSelectMode: () => boolean }} deps */
function initBookmarkGestures(deps) {
  _rerenderTree = deps.rerenderTree;
  _isSelectMode = deps.isSelectMode;
}

// ── BEGIN DRAG_CORE ──
// Exercised by tests/unit/bookmark.test.js. The test loader concatenates
// this block AFTER the BOOKMARK_QUERY block (since `moveBookmarkItem` calls
// `_findItemInStore` from there) and provides `loadBookmarks` /
// `saveBookmarks` / `_rerenderTree` stubs in the prelude.
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
  // Re-render whichever bookmark surface is mounted (drawer or /bookmarks full
  // view); the orchestrator owns that dispatch and injects it (initBookmarkGestures).
  _rerenderTree();
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
// bookmark.js's UI handlers drive: closeSwipedRow / _openSwipedRow are
// internal callees, while resetSwipedRow / closeSwipedRowIfOutside are the
// cross-module accessors. `_dragState` and the constants are co-located
// (ADR-010 mobile pattern) but are not part of the swipe state surface.

// Mobile swipe-to-reveal + long-press: tracks the single revealed row so
// opening a new one auto-closes the previous. Bidirectional (ADR-010 개정
// 2026-06-06): swiping a row left reveals 수정 on the right edge, swiping right
// reveals 삭제 on the left edge, and a full swipe executes the action. The
// opaque .bm-row-content is the slider that exposes the edge-anchored actions.
// (SWIPE_REVEAL_PX lives in the SWIPE_GESTURE block below with the rest of
// the gesture-math constants.)
const LONG_PRESS_MS = 500;
/** @type {HTMLElement | null} */
let _swipedRow = null;
/** @type {DragState | null} */
let _dragState = null;

function _isMobileViewport() {
  // Mobile/touch tier — same query as isMobile() (ADR-029 개정) so the header
  // bookmark / swipe gating tracks the tab bar's presence on every device.
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
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

// ── Module-private state accessors (for bookmark.js UI callers) ──

// Called by renderBookmarkTree when the tree re-renders — the previously-swiped
// row may no longer exist after re-render, so reset.
function resetSwipedRow() {
  _swipedRow = null;
}

// Called by the drawer pointerdown handler: closes the swiped row if the tap
// landed outside it. Encapsulates the "is something swiped + did the user tap
// outside" check so callers don't reach into module state.
/** @param {EventTarget | null} target */
function closeSwipedRowIfOutside(target) {
  if (!_swipedRow) return;
  if (target instanceof Node && _swipedRow.contains(target)) return;
  closeSwipedRow(null);
}
// ── END SWIPED_ROW ──

// ── BEGIN SWIPE_GESTURE ──
// Pure gesture math for the row swipe handler (_setupDragHandle). No DOM
// access: the handler feeds pointer deltas in and applies the returned
// decision to the row. Exercised by tests/unit/bookmark.test.js.

// How far the content slides to pin a revealed action; mirrored by the CSS
// token --swipe-reveal (ADR-010 개정 2026-06-06).
const SWIPE_REVEAL_PX = 88;
// Movement (px, hypot) below this is undecided — contact-point noise from a
// settling thumb. The old 5px classified before the thumb stabilized, so
// scroll attempts got grabbed as swipes.
const SWIPE_SLOP_PX = 8;
// Horizontal must dominate vertical by this factor to classify as a swipe.
// Inside the ambiguous diagonal cone (|dy| ≤ |dx| ≤ |dy|·bias) the gesture
// stays unclassified and the next sample decides — the old strict |dx|>|dy|
// one-shot meant a 1px difference at the 5px mark locked the mode for good.
const SWIPE_ANGLE_BIAS = 1.2;
// On release the velocity is projected this many ms forward before the snap
// thresholds apply, so a quick short flick opens/closes the panel without
// dragging the full distance. Flicks never escalate to commit (full-swipe
// execute) — that stays distance-gated so 삭제 can't fire from a twitch.
const SWIPE_FLICK_PROJECTION_MS = 80;
// Only pointer samples this recent (ms) count toward the release velocity,
// so pausing at the end of a drag releases at v≈0 (pure positional snap).
const SWIPE_VELOCITY_WINDOW_MS = 100;

// Classify the first significant movement of a touch gesture on a row.
// "swipe" → horizontal-dominant, reveal the action panel. "scroll" →
// vertical-dominant, cede to the browser. null → still ambiguous (sub-slop
// or inside the diagonal cone): keep sampling.
/** @param {number} dx @param {number} dy @returns {"swipe" | "scroll" | null} */
function _classifySwipeAxis(dx, dy) {
  if (Math.hypot(dx, dy) < SWIPE_SLOP_PX) return null;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx > absDy * SWIPE_ANGLE_BIAS) return "swipe";
  if (absDy >= absDx) return "scroll";
  return null;
}

// Release velocity (px/ms) over the recent sample window; 0 when fewer than
// two samples land inside it.
/** @param {{t: number, x: number}[]} samples @param {number} now */
function _swipeReleaseVelocity(samples, now) {
  let first = null;
  let last = null;
  for (const s of samples) {
    if (now - s.t > SWIPE_VELOCITY_WINDOW_MS) continue;
    if (!first) first = s;
    last = s;
  }
  if (!first || !last || last.t <= first.t) return 0;
  return (last.x - first.x) / (last.t - first.t);
}

// Decide what a released swipe does. `dx` is the gesture's own travel;
// `baseOffset` is the row's pre-gesture offset (±SWIPE_REVEAL_PX when a row
// was re-grabbed while open). Commit (full-swipe execute) is judged on the
// GESTURE distance, not the absolute offset — judging the offset alone let a
// re-grabbed open row execute 삭제 after a ~40px pull (hair-trigger) while
// the reverse direction needed 132px (dead). The absolute-offset guard keeps
// the reversal case (long pull from the opposite panel that has barely
// crossed center) from committing.
/**
 * @param {number} dx gesture travel (px, signed)
 * @param {number} baseOffset pre-gesture content offset (px, signed)
 * @param {number} velocityX release velocity (px/ms, signed)
 * @param {number} rowWidth
 * @returns {"commit-delete" | "commit-edit" | "open-delete" | "open-edit" | "close"}
 */
function _resolveSwipeRelease(dx, baseOffset, velocityX, rowWidth) {
  const commitPx = Math.max(rowWidth * 0.45, SWIPE_REVEAL_PX + 40);
  const finalOffset = baseOffset + dx;
  if (dx <= -commitPx && finalOffset <= -SWIPE_REVEAL_PX) return "commit-delete";
  if (dx >= commitPx && finalOffset >= SWIPE_REVEAL_PX) return "commit-edit";
  let projected = finalOffset + velocityX * SWIPE_FLICK_PROJECTION_MS;
  if (projected > rowWidth) projected = rowWidth;
  if (projected < -rowWidth) projected = -rowWidth;
  if (projected <= -SWIPE_REVEAL_PX / 2) return "open-delete";
  if (projected >= SWIPE_REVEAL_PX / 2) return "open-edit";
  return "close";
}
// ── END SWIPE_GESTURE ──

/** @param {HTMLElement} li @param {HTMLElement} row */
function _setupDragHandle(li, row) {
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Select mode owns the row: taps toggle selection, so swipe-to-reveal and
    // drag-to-reorder are both suppressed (the row click handler does the work).
    if (_isSelectMode()) return;
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
    // Recent pointer positions for the release-velocity (flick) calculation.
    /** @type {{t: number, x: number}[]} */
    const velocitySamples = [];
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
        if (Math.hypot(dx, dy) < SWIPE_SLOP_PX) return;
        clearLongPress();
        if (onHandle && canDrag) {
          // Dedicated reorder handle → start dragging right away (touch + mouse),
          // bypassing long-press and swipe classification.
          mode = "drag";
          _beginDrag();
        } else if (canSwipe) {
          const axis = _classifySwipeAxis(dx, dy);
          if (axis === "swipe") {
            // Horizontal-dominant gesture on touch → swipe-reveal action panel.
            mode = "swipe";
            row.classList.add("bm-swiping");
            row.setPointerCapture(pointerId);
          } else if (axis === "scroll") {
            // Vertical-dominant → user is scrolling the drawer body, not
            // swiping. Cede to the browser.
            mode = "abort";
            cleanupPointerHandlers();
            return;
          } else {
            // Ambiguous diagonal: stay unclassified and let the next sample
            // decide. (touch-action: pan-y means the browser may claim the
            // gesture meanwhile via pointercancel — that's the scroll path.)
            return;
          }
        } else if (isTouch) {
          // Touch + movement before long-press fired on a non-swipe surface →
          // user is scrolling. Cede to the browser.
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
        velocitySamples.push({ t: e.timeStamp, x: e.clientX });
        // Memory hygiene only — the velocity helper re-filters by window.
        while (velocitySamples.length > 1 && e.timeStamp - velocitySamples[0].t > SWIPE_VELOCITY_WINDOW_MS) {
          velocitySamples.shift();
        }
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
        velocitySamples.push({ t: e.timeStamp, x: e.clientX });
        const velocityX = _swipeReleaseVelocity(velocitySamples, e.timeStamp);
        const decision = _resolveSwipeRelease(e.clientX - startX, baseOffset, velocityX, rowWidth);
        if (decision === "commit-delete") {
          // Full swipe left → 삭제 (trigger the revealed button's handler).
          closeSwipedRow(null);
          /** @type {HTMLElement | null} */ (row.querySelector(".bm-swipe-delete"))?.click();
        } else if (decision === "commit-edit") {
          // Full swipe right → 수정.
          closeSwipedRow(null);
          /** @type {HTMLElement | null} */ (row.querySelector(".bm-swipe-edit"))?.click();
        } else if (decision === "open-delete") {
          _openSwipedRow(row, "delete");
        } else if (decision === "open-edit") {
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

export {
  initBookmarkGestures,
  moveBookmarkItem, _setupDragHandle, _isMobileViewport,
  closeSwipedRow, resetSwipedRow, closeSwipedRowIfOutside,
};
