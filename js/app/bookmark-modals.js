"use strict";
// @ts-check

// Bookmark modals — extracted from bookmark.js (ADR-034 후속 PR5). DOM-bound
// dialog UI: confirm + chapter-delete picker (PR5a), folder combobox + new-folder
// modal (PR5b); save/merge/move/import to follow. bookmark.js (drawer/tree UI)
// opens these and injects its
// render callbacks once via initBookmarkModals(), so the modal→render cycle
// needs no circular import (의존성 주입). The modal Escape stack lives here as
// closeTopmostModal(), which bookmark.js's document keydown handler delegates to
// before its own drawer/select handling. Deps: appHelpers, appOverlay,
// appStorage, bookmark-core, window.{announce, getBooksCache}.

/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */

import {
  _selectAllState, _deleteBtnLabel, _forgetViewed, removeItemById,
  collectFolderOptions, insertItem, _findItemInStore,
} from "./bookmark-core.js";

const { _$, el, clearNode, chUnit } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const { loadBookmarks, saveBookmarks, generateId } = window.appStorage;

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
const $bmNewFolderScrim = _$("bm-new-folder-scrim");
const $bmNewFolderModal = _$("bm-new-folder-modal");
const $bmNewFolderClose = _$("bm-new-folder-close");
const $bmNewFolderInput = /** @type {HTMLInputElement} */ (_$("bm-new-folder-input"));
const $bmNewFolderParent = _$("bm-new-folder-parent");
const $bmNewFolderConfirm = _$("bm-new-folder-confirm");
const $bmNewFolderCancel = _$("bm-new-folder-cancel");

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

// ── BEGIN BOOKMARK_FOLDER_ICON ──
// Material "folder" glyph (currentColor-filled SVG). Used only by the folder
// combobox below — the button icon and each option's leading icon.
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
// ── END BOOKMARK_FOLDER_ICON ──

// ── BEGIN BOOKMARK_FOLDER_COMBOBOX ──
// Custom listbox folder picker shared by the save modal (저장 위치) and the
// new-folder modal's own parent picker. Self-contained widget returning
// { el, getValue, close }; the "+ 새 폴더" affordance re-enters openNewFolderModal.
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
// ── END BOOKMARK_FOLDER_COMBOBOX ──

// ── BEGIN BOOKMARK_NEWFOLDER ──
// Create-folder modal. _bmNewFolderCallback is the create-folder continuation
// (invoked with the new id, e.g. the combobox re-selects it); _bmNewFolderParentCombo
// holds the open parent-picker so onClose can dismiss its dropdown.
/** @type {((id: string) => void) | null} */
let _bmNewFolderCallback = null;
/** @type {{ getValue: () => string|null, close: () => void } | null} */
let _bmNewFolderParentCombo = null;

// Overlay lifecycle (scrim/hidden/focus-trap/focus-restore) is owned by the
// shared controller (ADR-032). closeOnEsc stays off: Escape participates in the
// stacked bookmark router, so every focused control closes only this modal.
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
  _deps.rerenderActiveBookmarkTree();
  const cb = _bmNewFolderCallback;
  closeNewFolderModal();
  if (cb) cb(id);
}
// ── END BOOKMARK_NEWFOLDER ──

// ── Static listeners (moved from bookmark.js) ──
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

// ── Modal Escape stack ──
// Topmost-first dismissal for the modal overlays, priority order matching the
// pre-split bookmark.js router. Returns true when it closed one so bookmark.js's
// document keydown handler can stop before its drawer/select handling. As more
// modals move here (PR5b~), the chain grows and bookmark.js's local checks shrink.
// new-folder sits at the top and consumes the event (preventDefault/stopPropagation)
// to match the pre-split behavior.
/** @param {KeyboardEvent} e @returns {boolean} */
function closeTopmostModal(e) {
  if (!$bmNewFolderModal.hidden) { e.preventDefault(); e.stopPropagation(); closeNewFolderModal(); return true; }
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
window.closeNewFolderModal = closeNewFolderModal;

export {
  initBookmarkModals, closeTopmostModal,
  openConfirmModal, closeConfirmModal,
  openChapterDeleteModal, closeChapterDeleteModal,
  openNewFolderModal, closeNewFolderModal,
  _buildFolderCombobox,
};
