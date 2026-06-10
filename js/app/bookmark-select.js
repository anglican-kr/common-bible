"use strict";
// @ts-check

// Bookmark select-delete mode — extracted from bookmark.js (ADR-034 후속). In-place
// multi-select over the mobile /bookmarks full view (ADR-029 개정 / ADR-010): rows
// reveal a leading selection circle, the tab dock yields to #bm-select-bar
// (공유·이동·삭제 + 취소 + count chip), and the title row swaps ⋯/🛈 for a 전체 선택 toggle.
// Owns the select state (_bmSelectMode / _bmSelected), the cascade math
// (BOOKMARK_SELECT marker block, unit-tested), the lifecycle/toggle/chrome sync,
// and the 삭제·공유·이동 actions.
//
// Coupling with the tree renderer (the bidirectional knot ADR-034 deferred) is cut
// the PR1/modals way:
//   - orchestrator → select: bookmark.js IMPORTS the state (live binding) + handlers
//     it calls from tree builders / keydown / header refresh.
//   - select → orchestrator: the post-mutation re-render + header refresh are
//     INJECTED via initBookmarkSelect(), so select never imports bookmark.js back.
// All per-row DOM the chrome touches is reached by SELECTOR (.bm-select-circle, the
// #bookmarks-view-tree root), so this module stays self-contained. Deps: appStorage,
// appHelpers, bookmark-core, bookmark-modals, bookmark-gestures, window.announce.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */

const { _$ } = window.appHelpers;
const { loadBookmarks, saveBookmarks } = window.appStorage;

import {
  _findItemInStore, _descendantIds, _selectAllState, _bmSelectCountLabel,
  _walkBookmarks, _forgetViewed, removeItemById, insertItem, _buildSharePayload,
} from "./bookmark-core.js";
import { openConfirmModal, openMoveModal } from "./bookmark-modals.js";
import { closeSwipedRow, _isDescendant } from "./bookmark-gestures.js";

// ── Dependency injection ──
// bookmark.js injects these at startup (initBookmarkSelect) so a delete/move can
// repaint the tree + header without importing bookmark.js back (의존성 주입, like
// initBookmarkModals / initBookmarkGestures). No-op defaults guard a pre-init call.
let _rerenderTree = () => {};
let _refreshHeaderBtn = () => {};
/** @param {{ rerenderTree: () => void, refreshHeaderBtn: () => void }} deps */
function initBookmarkSelect(deps) {
  _rerenderTree = deps.rerenderTree;
  _refreshHeaderBtn = deps.refreshHeaderBtn;
}

// ── Select-mode state ──
// `_bmSelected` holds only EXPLICIT ticks; a row under an explicitly-ticked folder
// is "covered" (derived, not stored) so the folder owns its subtree. `_bmSelectMode`
// is exported as a live binding — bookmark.js reads it from tree builders / keydown
// and feeds it to the gesture handler's isSelectMode hook.
let _bmSelectMode = false;
/** @type {Set<string>} */
const _bmSelected = new Set();

// ── Select-bar (dock) DOM refs ──
const $bmSelectBar = _$("bm-select-bar");
const $bmSelectCount = _$("bm-select-count");
const $bmSelectShareBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-share-btn"));
const $bmSelectMoveBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-move-btn"));
const $bmSelectDeleteBtn = /** @type {HTMLButtonElement} */ (_$("bm-select-delete-btn"));
const $bmSelectCancelBtn = _$("bm-select-cancel-btn");

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
      _rerenderTree();
      _refreshHeaderBtn();
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
// The move dialog (destination picker + 새 폴더) lives in bookmark-modals.js (PR5e);
// select mode keeps the selection logic below and drives the picker via
// openMoveModal({ excludeFolder, onPick }).

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
  // The picker self-closes before invoking this (onPick), so no close here.
  announce(moved === 1 ? "1개 항목을 이동했습니다." : `${moved}개 항목을 이동했습니다.`);
  exitBookmarkSelectMode();
  _rerenderTree();
  _refreshHeaderBtn();
}

// Open the move destination picker (bookmark-modals.js) for the current
// selection: guard on having effective targets, then hand it the exclude
// predicate (a selected folder or one under a selected ancestor can't be a
// destination — that would be a no-op/empty-folder move) and the mover callback.
function _openMoveSelection() {
  const parentMap = _bmBuildParentMap(loadBookmarks());
  if (!_bmEffectiveTargets(parentMap).length) return;
  const excludeFolder = (folderId) => _bmSelected.has(folderId) || _bmAncestorSelected(folderId, parentMap);
  openMoveModal({ excludeFolder, onPick: _moveSelectedToFolder });
}

$bmSelectShareBtn.addEventListener("click", _runBookmarkSelectShare);
$bmSelectMoveBtn.addEventListener("click", _openMoveSelection);
$bmSelectDeleteBtn.addEventListener("click", _runBookmarkSelectDelete);
$bmSelectCancelBtn.addEventListener("click", exitBookmarkSelectMode);

export {
  initBookmarkSelect,
  _bmSelectMode,
  enterBookmarkSelectMode, exitBookmarkSelectMode,
  _toggleBmSelect, _bmToggleSelectAll, _syncBmSelectChrome,
};
