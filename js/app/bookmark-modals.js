"use strict";
// @ts-check

// Bookmark modals — extracted from bookmark.js (ADR-034 후속 PR5). DOM-bound
// dialog UI: confirm + chapter-delete picker for PR5a (save/folder/merge/move/
// import to follow). bookmark.js (drawer/tree UI) opens these and injects its
// render callbacks once via initBookmarkModals(), so the modal→render cycle
// needs no circular import (의존성 주입). The modal Escape stack lives here as
// closeTopmostModal(), which bookmark.js's document keydown handler delegates to
// before its own drawer/select handling. Deps: appHelpers, appOverlay,
// appStorage, bookmark-core, window.{announce, getBooksCache}.

/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */

import {
  _selectAllState, _deleteBtnLabel, _forgetViewed, removeItemById,
} from "./bookmark-core.js";

const { _$, el, clearNode, chUnit } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const { loadBookmarks, saveBookmarks } = window.appStorage;

// ── Dependency injection ──
// bookmark.js injects its render callbacks at startup so a modal can refresh the
// tree/header after a mutation without importing bookmark.js back (which would be
// a circular import — the very class of break that hid behind tsc in PR1).
/**
 * @typedef {{
 *   rerenderActiveBookmarkTree: () => void,
 *   refreshBookmarkHeaderBtn: () => void,
 * }} BookmarkModalDeps
 */
/** @type {BookmarkModalDeps} */
let _deps;
/** @param {BookmarkModalDeps} deps */
function initBookmarkModals(deps) { _deps = deps; }

// ── DOM refs (moved from bookmark.js) ──
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

// ── BEGIN BOOKMARK_CONFIRM ──
// Generic destructive-confirm dialog. The caller passes the onConfirm action, so
// this stays a pure primitive with no render dependency.
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
// ── END BOOKMARK_CONFIRM ──

// ── BEGIN BOOKMARK_CHAPTER_DELETE ──
// Header bookmark toggle-off (mobile): instead of a blunt "delete all", present
// the chapter's bookmarks (whole-chapter + verse ranges) as a checkbox list so
// the reader removes only what they mean to. "전체 선택" ticks them all at once.
// Nothing is pre-selected (the select-all is the bulk affordance) and the
// delete button stays disabled until at least one row is ticked.
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

/**
 * @param {BookmarkTreeBookmark[]} candidates
 */
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
    _deps.rerenderActiveBookmarkTree();
    _deps.refreshBookmarkHeaderBtn();
    announce(removed === 1 ? "북마크를 삭제했습니다." : `북마크 ${removed}개를 삭제했습니다.`);
    closeChapterDeleteModal();
  };
  $bmChapterDeleteCancel.onclick = closeChapterDeleteModal;
}

function closeChapterDeleteModal() { chapterDeleteOverlay.close(); }
// ── END BOOKMARK_CHAPTER_DELETE ──

// ── Static listeners (moved from bookmark.js) ──
$bmConfirmCancel.addEventListener("click", closeConfirmModal);
$bmConfirmScrim.addEventListener("click", closeConfirmModal);
$bmChapterDeleteScrim.addEventListener("click", closeChapterDeleteModal);

// ── Modal Escape stack ──
// Topmost-first dismissal for the modal overlays, priority order matching the
// pre-split bookmark.js router. Returns true when it closed one so bookmark.js's
// document keydown handler can stop before its drawer/select handling. As more
// modals move here (PR5b~), the chain grows and bookmark.js's local checks shrink.
/** @returns {boolean} */
function closeTopmostModal() {
  if (!$bmConfirmModal.hidden) { closeConfirmModal(); return true; }
  if (!$bmChapterDeleteModal.hidden) { closeChapterDeleteModal(); return true; }
  return false;
}

// ── Window facade ──
// Vestigial: route() now dismisses every open overlay via
// appOverlay.closeAllOverlays() (ADR-034), which superseded these per-modal
// close facades. Kept behavior-neutral until a dedicated facade-cleanup pass
// confirms no remaining caller, then removable.
window.closeConfirmModal = closeConfirmModal;
window.closeChapterDeleteModal = closeChapterDeleteModal;

export {
  initBookmarkModals, closeTopmostModal,
  openConfirmModal, closeConfirmModal,
  openChapterDeleteModal, closeChapterDeleteModal,
};
