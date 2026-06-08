"use strict";
// @ts-check

// Bookmark modals — extracted from bookmark.js (ADR-034 후속 PR5). DOM-bound
// dialog UI: confirm + chapter-delete picker (PR5a), folder combobox + new-folder
// modal (PR5b), save/edit + merge dialog (PR5c), import flow (PR5d), move
// destination picker (PR5e — a parameterized folder picker; select-mode keeps the
// selection logic and passes excludeFolder/onPick). export stays in bookmark.js
// (plain download, no dialog). bookmark.js (drawer/tree UI) opens these and injects its
// render callbacks once via initBookmarkModals(), so the modal→render cycle
// needs no circular import (의존성 주입). The modal Escape stack lives here as
// closeTopmostModal(), which bookmark.js's document keydown handler delegates to
// before its own drawer/select handling. Deps: appHelpers, appOverlay,
// appStorage, bookmark-core, window.{announce, getBooksCache}.

/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */

import {
  _selectAllState, _deleteBtnLabel, _forgetViewed, removeItemById,
  collectFolderOptions, insertItem, _findItemInStore,
  findExistingChapterBookmarks, _findParentFolderId,
} from "./bookmark-core.js";
import { collapseSegmentedVerses, selectedVersesToSpec, mergeVerseSpecs } from "./verse-spec.js";

const { _$, el, clearNode, chUnit } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const { loadBookmarks, saveBookmarks, generateId } = window.appStorage;
const { readingContext } = window;

// ── Dependency injection ──
// bookmark.js injects its render callbacks at startup so a modal can refresh the
// tree/header after a mutation without importing bookmark.js back (which would be
// a circular import — the very class of break that hid behind tsc in PR1).
/**
 * @typedef {{
 *   rerenderActiveBookmarkTree: () => void,
 *   refreshBookmarkHeaderBtn: () => void,
 *   exitVerseSelectMode: () => void,
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
const $bmSaveScrim = _$("bm-save-scrim");
const $bmSaveModal = _$("bm-save-modal");
const $bmSaveClose = _$("bm-save-close");
const $bmSaveTitle = _$("bm-save-title");
const $bmSaveBody = _$("bm-save-body");
const $bmMergeScrim = _$("bm-merge-scrim");
const $bmMergeModal = _$("bm-merge-modal");
const $bmMergeBody = _$("bm-merge-body");
const $bmMergeYes = _$("bm-merge-yes");
const $bmMergeNo = _$("bm-merge-no");
const $bmMergeCancel = _$("bm-merge-cancel");
const $bmImportBtn = _$("bm-import-btn");
const $bmImportInput = /** @type {HTMLInputElement} */ (_$("bm-import-input"));
const $bmImportScrim = _$("bm-import-scrim");
const $bmImportModal = _$("bm-import-modal");
const $bmImportBody = _$("bm-import-body");
const $bmImportMerge = _$("bm-import-merge");
const $bmImportOverwrite = _$("bm-import-overwrite");
const $bmImportCancel = _$("bm-import-cancel");
const $bmMoveScrim = _$("bm-move-scrim");
const $bmMoveModal = _$("bm-move-modal");
const $bmMoveList = _$("bm-move-list");
const $bmMoveNewFolder = _$("bm-move-new-folder");
const $bmMoveCancel = _$("bm-move-cancel");

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

// ── BEGIN BOOKMARK_SAVE ──
// Save/edit bookmark modal. openSaveModal resolves the verse spec from the
// reading context, short-circuits to the merge dialog when the chapter already
// has bookmarks, then _showSaveModal builds the form (label/note/folder picker).
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
    if (mode === "verses") _deps.exitVerseSelectMode();
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
  _deps.rerenderActiveBookmarkTree();
  _deps.refreshBookmarkHeaderBtn();
  announce(existingId ? "북마크를 수정했습니다." : "북마크를 저장했습니다.");
}
// ── END BOOKMARK_SAVE ──

// ── BEGIN BOOKMARK_MERGE ──
// Shown when saving into a chapter that already has bookmark(s): offers to merge
// the incoming verse spec into an existing bookmark (single → yes/no, multiple →
// pick a target), or "아니오" falls through to a fresh save via _showSaveModal.
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
    _deps.rerenderActiveBookmarkTree();
    _deps.refreshBookmarkHeaderBtn();

    if (mode === "verses") _deps.exitVerseSelectMode();
    announce("북마크를 합쳤습니다.");
    cleanup();
  };

  $bmMergeNo.onclick = () => {
    cleanup();
    _showSaveModal(mode, resolvedBookId, resolvedChapter, incomingSpec, null);
  };

  $bmMergeCancel.onclick = cleanup;
}
// ── END BOOKMARK_MERGE ──

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

// ── BEGIN BOOKMARK_IMPORT ──
// Full import flow: a hidden file input + its trigger (openImportFilePicker, used
// by the ⋯ menu's 가져오기), the read/parse/validate step, then the
// merge-vs-overwrite confirmation modal. Export is a plain download and stays in
// bookmark.js (no dialog).
// closeOnEsc off: in the stacked Escape router. onClose clears per-open
// handlers and resets the file input (so re-picking the same file re-fires
// change) (ADR-032).
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

// Open the OS file picker (called from bookmark.js's ⋯ menu). Resetting value
// first lets the same file be picked twice in a row and still fire change.
function openImportFilePicker() {
  $bmImportInput.value = "";
  $bmImportInput.click();
}

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
    _deps.rerenderActiveBookmarkTree();
    announce("북마크를 병합했습니다.");
    cleanup();
  };

  $bmImportOverwrite.onclick = () => {
    saveBookmarks(incoming.bookmarks);
    _deps.rerenderActiveBookmarkTree();
    announce("북마크를 덮어썼습니다.");
    cleanup();
  };

  $bmImportCancel.onclick = cleanup;
}

$bmImportBtn.addEventListener("click", openImportFilePicker);
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
// ── END BOOKMARK_IMPORT ──

// ── BEGIN BOOKMARK_MOVE ──
// Generic "pick a destination folder" dialog. Caller (bookmark.js select mode)
// passes excludeFolder(id)→boolean to drop ineligible destinations and
// onPick(targetFolderId|null) to perform the move; the modal self-closes before
// invoking onPick. New-folder runs the create flow (filtered by the same
// predicate) and forwards the new id to onPick. No select-mode state lives here.
const moveOverlay = createOverlay({
  panel: $bmMoveModal,
  scrim: $bmMoveScrim,
  initialFocus: () => $bmMoveCancel,
  onClose: () => { $bmMoveCancel.onclick = null; $bmMoveNewFolder.onclick = null; },
});

// Stroke-style SVG from path data (same recipe as bookmark.js's menu icons),
// kept local so the move rows don't pull a cross-module icon helper.
function _moveRowIcon(paths) {
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

// One destination row: leading glyph + label, indented by depth. 최상위(root)
// gets a home glyph; folders get a folder glyph. (새 폴더 is a dedicated button
// below the list, not a row.)
/** @param {string} label @param {"root" | "folder"} kind @param {number} [depth] */
function _buildMoveRow(label, kind, depth = 0) {
  const btn = el("button", { className: "bm-move-item", type: "button" });
  if (depth > 0) btn.style.setProperty("--bm-move-indent", `calc(var(--space-5) * ${depth})`);
  const icon = el("span", { className: "bm-move-icon", "aria-hidden": "true" });
  const paths = kind === "root"
    ? ["M4 10.5 12 4l8 6.5", "M6 9.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.5"]
    : ["M3 7.5a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z"];
  icon.appendChild(_moveRowIcon(paths));
  btn.appendChild(icon);
  btn.appendChild(el("span", { className: "bm-move-label" }, label));
  return btn;
}

function closeMoveModal() { moveOverlay.close(); }

/**
 * @param {{ excludeFolder: (folderId: string) => boolean, onPick: (targetFolderId: string | null) => void }} opts
 */
function openMoveModal({ excludeFolder, onPick }) {
  clearNode($bmMoveList);

  // 최상위 (root) first, then the eligible folders (indented by depth).
  const rootRow = _buildMoveRow("최상위", "root");
  rootRow.addEventListener("click", () => { closeMoveModal(); onPick(null); });
  $bmMoveList.appendChild(rootRow);

  for (const f of collectFolderOptions(loadBookmarks())) {
    if (excludeFolder(f.id)) continue;
    const row = _buildMoveRow(f.name, "folder", f.depth);
    row.addEventListener("click", () => { closeMoveModal(); onPick(f.id); });
    $bmMoveList.appendChild(row);
  }

  // 새 폴더 (below the list) — opens the new-folder modal (parent picker filtered
  // by the same predicate so the new folder can't land inside the selection),
  // then forwards the created id to onPick.
  $bmMoveNewFolder.onclick = () => {
    closeMoveModal();
    openNewFolderModal(
      (newId) => { if (newId) onPick(newId); },
      null,
      { folderFilter: (f) => !excludeFolder(f.id) },
    );
  };

  moveOverlay.open();
  $bmMoveCancel.onclick = closeMoveModal;
}

$bmMoveScrim.addEventListener("click", closeMoveModal);
// ── END BOOKMARK_MOVE ──

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
$bmSaveClose.addEventListener("click", closeSaveModal);
$bmSaveScrim.addEventListener("click", closeSaveModal);

// ── Modal Escape stack ──
// Topmost-first dismissal for every bookmark modal. Returns true when it closed
// one so bookmark.js's document keydown handler can stop before its drawer/select
// handling. Order follows z-index so the visually topmost layer is dismissed
// first: new-folder (stacks above save/move, and consumes the event), then move
// (z 78-79), then import (z 76-77), then the mutually-exclusive rest.
/** @param {KeyboardEvent} e @returns {boolean} */
function closeTopmostModal(e) {
  if (!$bmNewFolderModal.hidden) { e.preventDefault(); e.stopPropagation(); closeNewFolderModal(); return true; }
  if (!$bmMoveModal.hidden) { closeMoveModal(); return true; }
  if (!$bmImportModal.hidden) { closeImportModal(); return true; }
  if (!$bmConfirmModal.hidden) { closeConfirmModal(); return true; }
  if (!$bmChapterDeleteModal.hidden) { closeChapterDeleteModal(); return true; }
  if (!$bmMergeModal.hidden) { closeMergeModal(); return true; }
  if (!$bmSaveModal.hidden) { closeSaveModal(); return true; }
  return false;
}

// Each modal's close fn stays module-internal (reached via closeTopmostModal +
// the scrim/cancel listeners above). route() dismisses any open overlay through
// appOverlay.closeAllOverlays() (ADR-034), so no per-modal window facade is
// needed. Only the entry points bookmark.js calls are exported.
export {
  initBookmarkModals, closeTopmostModal,
  openConfirmModal, openChapterDeleteModal,
  openNewFolderModal, openSaveModal,
  openImportFilePicker, openMoveModal,
};
