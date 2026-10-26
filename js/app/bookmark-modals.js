"use strict";

// Bookmark modals — extracted from bookmark.js (ADR-034 후속 PR5). DOM-bound
// dialog UI: confirm (PR5a), folder combobox + new-folder
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
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */
/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {"chapter" | "verses" | "edit"} SaveMode  이 장 저장 · 절 선택 저장 · 북마크 수정 */

import {
  _selectAllState, _forgetViewed, removeItemById,
  collectFolderOptions, insertItem, _findItemInStore,
  findExistingChapterBookmarks, _findParentFolderId, _walkBookmarks, migrateLegacyBookmark,
} from "./bookmark-core.js";
import { verseNumberSpec, selectedSpanVrefs, mergeVerseSpecs, isWellFormedSpec } from "./verse-spec.js";

const { _$, el, clearNode, chUnit } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const { loadBookmarks, saveBookmarks, generateId, projectedStorageChars } = window.appStorage;
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
// bookmark.js's stacked Escape router (confirm > … > drawer),
// which calls closeConfirmModal() for the topmost overlay. A controller-level
// Escape listener here would double-handle and also close whatever sits beneath.
// Default initial focus = cancel (safe action); destructive button is opt-in.
const confirmOverlay = createOverlay({
  panel: $bmConfirmModal,
  scrim: $bmConfirmScrim,
  initialFocus: () => $bmConfirmCancel,
  onClose: () => { $bmConfirmOk.onclick = null; },
});

/** @param {{ title: string, message: string, confirmLabel?: string, onConfirm: () => void }} opts */
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

  /** @param {string} id */
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

  /** @type {((e: MouseEvent) => void) | null} */
  let docHandler = null;
  /** @type {((e: KeyboardEvent) => void) | null} */
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
      if (!(e.target instanceof Node && wrap.contains(e.target))) closeList();
    };
    // Closed again before the timer ran → the handlers are null and there is nothing to add
    // (adding a null listener was a no-op too).
    setTimeout(() => {
      if (keyHandler) document.addEventListener("keydown", keyHandler, true);
      if (docHandler) document.addEventListener("click", docHandler, true);
    }, 0);
  }

  /** @param {string} dataId @param {string} displayName @param {number} depth */
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
  /** @type {HTMLLIElement | null} */
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

  /** @param {Array<{ id: string, name: string, depth: number }>} options */
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
/** @param {SaveMode} mode @param {{ existingId?: string }} [opts]  existingId — the bookmark being edited */
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
    // The selection holds span keys (`data-vkey`); the stored spec is by verse number (ADR-010), so it goes through
    // the spans' `data-vref` — a line or a half verse stores its number, a merged verse its range ("7-8").
    verseSpec = verseNumberSpec(selectedSpanVrefs(readingContext.selectedVerses, article));
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

/**
 * `bookId` · `chapter` are the reading context — null only when editing from outside a chapter
 * (the 북마크 tab), where the label is the existing one and they go unused.
 * @param {SaveMode} mode @param {string | null} bookId @param {number | null} chapter
 * @param {string} verseSpec @param {BookmarkTreeBookmark | null} existing
 */
function _showSaveModal(mode, bookId, chapter, verseSpec, existing) {
  const prevCombo = /** @type {HTMLElement & { _bmClose?: () => void } | null} */ (document.getElementById("bm-folder-combobox"));
  if (prevCombo && prevCombo._bmClose) prevCombo._bmClose();

  const store = loadBookmarks();
  const folderOptions = collectFolderOptions(store);

  const book = (window.getBooksCache() ?? []).find(b => b.id === bookId);
  const bookName = book ? (book.short_name_ko || book.name_ko) : bookId;
  const unit = chUnit(bookId ?? "");
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

/**
 * @param {string | null} existingId  set when editing — the item keeps its own book and chapter
 * @param {string} label @param {string} note @param {string | null} folderId  null = 최상위
 * @param {string | null} bookId @param {number | null} chapter @param {string} verseSpec
 */
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
    // A new bookmark needs its chapter. Every create path (이 장 저장 · 절 선택 저장) runs in a chapter
    // view, so this does not trip — it keeps an item with a null book or chapter out of the store if one ever did.
    if (!bookId || chapter == null) return;
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

// The JSDoc sat above `mergeOverlay` (the overlay was declared between it and this function), so these
// types never reached the parameters — the same detached-JSDoc shape as pitfalls §27's citations.js case.
/**
 * @param {BookmarkTreeBookmark[]} candidates
 * @param {string} incomingSpec
 * @param {SaveMode} mode
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
// Structural only — the envelope, not the items (bookmark.test.js pins `{ bookmarks: [{}] }` → true),
// so the predicate promises `unknown[]`; openImportModal is where the items are taken as nodes.
/** @param {unknown} data @returns {data is { bookmarks: unknown[] }} */
function _validateImportData(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(/** @type {{ bookmarks?: unknown }} */ (data).bookmarks)) return false;
  return true;
}

// 병합 adds, by id, what the file has and the list lacks; an item the list has stays as it is. A folder the list
// already has is entered, not skipped: the file's new items join it there, and it keeps its own name and place
// (ADR-011 Phase 2a, known-issues §15.1 — skipping it left the backup's new bookmarks in that folder behind).
/** @param {BookmarkTreeNode[]} existing @param {BookmarkTreeNode[]} incoming @returns {BookmarkTreeNode[]} */
function _mergeBookmarkStores(existing, incoming) {
  /** @type {Set<string>} */
  const ids = new Set();
  /** @type {Map<string, BookmarkTreeFolder>} */
  const folders = new Map();
  // Every folder is copied, so new items can join one without touching the tree the caller passed in.
  /** @param {BookmarkTreeNode[]} items @returns {BookmarkTreeNode[]} */
  function copyExisting(items) {
    return items.map((item) => {
      ids.add(item.id);
      if (item.type !== "folder") return item;
      const folder = { ...item, children: copyExisting(Array.isArray(item.children) ? item.children : []) };
      folders.set(item.id, folder);
      return folder;
    });
  }
  const result = copyExisting(existing);

  /** @param {BookmarkTreeNode[]} items @param {BookmarkTreeNode[]} into */
  function addNew(items, into) {
    for (const item of items) {
      if (item.type === "folder") {
        const same = folders.get(item.id);
        if (same) { addNew(item.children || [], same.children); continue; }
        if (ids.has(item.id)) continue;   // a bookmark has this id — the import check leaves these out first (ADR-040)
        const folder = { ...item, children: [] };
        ids.add(item.id);
        folders.set(item.id, folder);
        into.push(folder);
        addNew(item.children || [], folder.children);
      } else if (!ids.has(item.id)) {
        ids.add(item.id);
        into.push(item);
      }
    }
  }
  addNew(incoming, result);
  return result;
}

/** @param {BookmarkTreeNode[]} items @returns {number} */
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

// ── Import item check ──
// 가져오기는 어긋난 항목만 빼고 들인다 — 뺀 개수는 확인 대화상자가 병합 · 덮어쓰기 전에 알린다(사용자 결정
// 2026-10-18 — 파일 전체 거절과 견준 뒤. 북마크는 서로를 가리키지 않는 기록이라 일부만 들어와도 목록이 어긋나지
// 않고, 깨진 항목 하나 때문에 백업 전체를 못 쓰는 쪽이 더 큰 손실이다). 「올바르다」는 앱이 북마크를 처음
// 저장한 날(2026-04-25)부터 써 온 모양 그대로다(ADR-010) — 이 앱이 내보낸 파일은 모두 통과한다.

/** @param {unknown} x @returns {x is Record<string, unknown>} */
function _isRecord(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

// How many nodes an item stands for: itself plus whatever it holds, read as loosely as possible — a skipped folder's
// count includes everything inside it. A loop, not recursion: a skipped subtree can be thousands of levels deep.
/** @param {unknown} x @returns {number} */
function _nodeCount(x) {
  let count = 0;
  /** @type {unknown[]} */
  const stack = [x];
  while (stack.length) {
    const cur = stack.pop();
    count += 1;
    const kids = _isRecord(cur) ? cur.children : undefined;
    if (Array.isArray(kids)) for (const k of kids) stack.push(k);
  }
  return count;
}

/** @param {unknown} v @param {string} type  optional fields are checked only when present */
function _optionalOf(v, type) {
  return v === undefined || typeof v === type;
}

// A time stamp, checked only when present: a finite number. JSON reads 1e400 as Infinity, which saving stored as
// null — and the app's own export then failed this check, losing the item on restore (PR #359 review).
/** @param {unknown} v */
function _optionalTime(v) {
  return v === undefined || (typeof v === "number" && Number.isFinite(v));
}

// An id the app can key, link and sync by. The app's own ids (`generateId` — base-36 time + random) are lower-case
// letters and digits. The sync store keys records by id in plain objects (store-v2.js `_flattenTree` ·
// `bookmarkTreeFromFlat`), so an id naming an Object.prototype member broke it — `toString` · `constructor` made the
// next read call `.sort()` on the inherited function and the whole list failed to load, `__proto__` vanished. A folder
// id also goes into the 모아 읽기 URL unencoded (`/read/<id>` — bookmark-tree.js), so `?` · `#` · `/` · `%` ·
// whitespace · `..` broke that route (PR #359 review).
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** @param {unknown} id @returns {id is string} */
function _isUsableId(id) {
  return typeof id === "string" && ID_PATTERN.test(id) && !Object.hasOwn(Object.prototype, id);
}

/**
 * A bookmark the app can draw and open: a known book, a chapter inside it, a readable verse spec and a label
 * (the tree link reads `/<book>/<chapter>/<spec>` — a missing spec made it `/gen/1/undefined`). It has no
 * `children`: that field is structure, not an unknown extra — the sync store walks any node's children while
 * flattening, so `[null]` threw inside `saveBookmarks` (which swallows it — 「덮어썼습니다」 over an unchanged
 * list) and a child reusing an existing id overwrote that item on 병합 (PR #359 review). In the app's own data a
 * bookmark never has children, so it never carries the field (`bookmarkTreeFromFlat` adds `children` to folders
 * and to any node that has children).
 * @param {unknown} x
 * @param {(bookId: string) => number | null} chapterCountOf  chapters in that book, null for an unknown book
 * @returns {x is BookmarkTreeBookmark}
 */
function _isWellFormedBookmark(x, chapterCountOf) {
  if (!_isRecord(x) || x.type !== "bookmark" || x.children !== undefined) return false;
  const { id, bookId, chapter, verseSpec, label } = x;
  const count = typeof bookId === "string" ? chapterCountOf(bookId) : null;
  return typeof id === "string" && count != null
    && typeof chapter === "number" && Number.isInteger(chapter) && chapter >= 1 && chapter <= count
    && typeof verseSpec === "string" && isWellFormedSpec(verseSpec)
    && typeof label === "string"
    && _optionalOf(x.note, "string") && _optionalTime(x.createdAt) && _optionalTime(x.updatedAt);
}

/**
 * @param {unknown} x
 * @returns {x is { type: "folder", id: string, name: string, children: unknown[], expanded?: boolean }}
 */
function _isWellFormedFolder(x) {
  if (!_isRecord(x) || x.type !== "folder") return false;
  const { id, name, children } = x;
  return typeof id === "string" && typeof name === "string" && Array.isArray(children)
    && _optionalOf(x.expanded, "boolean") && _optionalTime(x.createdAt) && _optionalTime(x.updatedAt);
}

// Folders nested deeper than this are left out with everything inside them. The app sets no limit, but nobody builds
// 64 levels one 새 폴더 at a time — and every level recurses somewhere: a few hundred levels stalled the list for
// seconds, a few thousand broke the sync store's read (neither the chapter view nor the list drew again, and the chain
// synced to other devices) or overflowed this very check (PR #359 review).
const IMPORT_MAX_FOLDER_DEPTH = 64;

/**
 * Keep the well-formed items of an import file. A skipped folder takes its subtree with it — nothing inside is moved
 * elsewhere. A repeated id keeps its first well-formed item (two rows answering to one id would break move · delete ·
 * sync). Unknown fields ride along, so a newer app's extra fields survive on this device (the sync store's content key
 * lists the known fields only).
 * @param {unknown[]} items  the file's `bookmarks`
 * @param {(bookId: string) => number | null} chapterCountOf
 * @param {(id: string) => string | null} [existingTypeOf]  the kind the current list already uses an id for. An id
 *   reused for the other kind (bookmark ↔ folder) is left out: the sync store merges record by record, last write
 *   wins, so a later edit of the old kind on another device brought it back with this item's children hidden under
 *   a bookmark on every device (PR #359 review).
 * @returns {{ nodes: BookmarkTreeNode[], skipped: number }}  `skipped` counts every node left out
 */
function _sanitizeImportItems(items, chapterCountOf, existingTypeOf = () => null) {
  /** @type {Set<string>} */
  const seen = new Set();
  let skipped = 0;
  /** @param {unknown[]} list @param {number} depth @returns {BookmarkTreeNode[]} */
  function walk(list, depth) {
    /** @type {BookmarkTreeNode[]} */
    const out = [];
    for (const x of list) {
      const id = _isRecord(x) ? x.id : undefined;
      const prior = _isUsableId(id) ? existingTypeOf(id) : null;
      if (!_isUsableId(id) || seen.has(id) || (prior !== null && _isRecord(x) && prior !== x.type)) {
        skipped += _nodeCount(x);
      } else if (_isWellFormedFolder(x) && depth <= IMPORT_MAX_FOLDER_DEPTH) {
        seen.add(id);
        out.push({ ...x, children: walk(x.children, depth + 1) });
      } else if (_isWellFormedBookmark(x, chapterCountOf)) {
        seen.add(id);
        out.push(x);
      } else {
        skipped += _nodeCount(x);
      }
    }
    return out;
  }
  return { nodes: walk(items, 1), skipped };
}

// The quota an import is checked against: Safari's — 5 MiB per origin counted in bytes, 2 bytes a character once any
// Korean is in the text (WebKit `localStorageQuotaInBytes` · `String::sizeInBytes`; WebKit 26.4 measures the same), the
// strictest engine. Chromium counts characters (5,242,880), so this is half its room; kept for every engine, as sync
// carries the list to the user's other devices. Past the quota, saving failed silently (saveBookmarks swallows it):
// 「덮어썼습니다」 over the old list, later edits lost, another device's sync stopped (PR #359 review).
const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024;
// Left free after an import, for what the app saves next — about 90 bookmarks (714 bytes each, both copies).
const STORAGE_HEADROOM_BYTES = 64 * 1024;

/**
 * Whether the device takes a save, counted the strictest way. The measure is what will actually be stored, not the
 * list: a fixed budget on the list's JSON (600,000 characters) let a 1,000-character folder id through — the sync store
 * repeats it under every child, 21 times the list — yet turned away the app's own backup of notes, about twice the list
 * (PR #359 review).
 * @param {number} chars  every character localStorage would hold after the save (storage.js projectedStorageChars)
 */
function _fitsStorage(chars) {
  return 2 * chars <= STORAGE_QUOTA_BYTES - STORAGE_HEADROOM_BYTES;
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

/**
 * @param {BookmarkTreeNode[]} items  the well-formed items (_sanitizeImportItems)
 * @param {number} skipped  items left out — said before 병합 · 덮어쓰기 so nobody takes a partial import for a whole one
 */
function openImportModal(items, skipped) {
  const bmCount = _countBookmarks(items);
  clearNode($bmImportBody);
  $bmImportBody.appendChild(
    el("p", {}, `북마크 ${bmCount}개를 현재 목록에 병합하거나 덮어쓸 수 있습니다.`)
  );
  if (skipped > 0) {
    $bmImportBody.appendChild(el("p", {}, `올바르지 않은 항목 ${skipped}개는 빼고 가져옵니다.`));
  }

  importOverlay.open();
  const cleanup = closeImportModal;

  $bmImportMerge.onclick = () => {
    const existing = loadBookmarks();
    const merged = _mergeBookmarkStores(existing, items);
    if (!_fitsStorage(projectedStorageChars(merged))) {
      // Said in the dialog, which stays open — 덮어쓰기 was checked to fit when the file was read. A snackbar sat over
      // the dialog's buttons on a phone held sideways (PR #359 review).
      const msg = "합친 목록이 너무 커서 병합할 수 없습니다. 「덮어쓰기」나 「취소」를 눌러 주세요.";
      if (!$bmImportBody.querySelector(".bm-import-refusal")) {
        $bmImportBody.appendChild(el("p", { className: "bm-import-refusal" }, msg));
      }
      announce(msg);
      return;
    }
    saveBookmarks(merged);
    _deps.rerenderActiveBookmarkTree();
    announce("북마크를 병합했습니다.");
    cleanup();
  };

  $bmImportOverwrite.onclick = () => {
    saveBookmarks(items);
    _deps.rerenderActiveBookmarkTree();
    announce("북마크를 덮어썼습니다.");
    cleanup();
  };

  $bmImportCancel.onclick = cleanup;
}

// An import that stops early says why on screen — the snackbar also reads it to the live region. These lines
// were live-region-only before, so a sighted user saw nothing happen.
/** @param {string} msg */
function _importStopped(msg) {
  if (window._showSyncSnackbar) window._showSyncSnackbar(msg);
  else announce(msg);
  $bmImportInput.value = "";
}

$bmImportBtn.addEventListener("click", openImportFilePicker);
$bmImportInput.addEventListener("change", () => {
  const file = $bmImportInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    let data;
    try {
      const result = /** @type {FileReader} */ (e.target).result;
      data = JSON.parse(typeof result === "string" ? result : "");
    } catch (_) {
      _importStopped("파일을 읽을 수 없습니다. 올바른 JSON 파일인지 확인해 주세요.");
      return;
    }
    if (!_validateImportData(data)) {
      _importStopped("북마크 파일 형식이 올바르지 않습니다.");
      return;
    }
    // The item check needs each book's chapter count (an unknown book or a chapter past the end is left out), and
    // the move of the pre-#205 verse ranges each book's name (an old default name follows its range).
    /** @type {import("../types").BooksData} */
    let books;
    try {
      books = await window.loadBooks();
    } catch (_) {
      _importStopped("성서 목록을 불러오지 못해 가져오지 않았습니다. 연결을 확인한 뒤 「가져오기」를 다시 눌러 주세요.");
      return;
    }
    // The kind each id has in the current list. A list the sync store cannot read (a broken entry in the stored
    // document — a `toString` id did this until known-issues §15.2) has nothing to compare against — and 덮어쓰기 is
    // how it gets fixed, so the import goes on.
    /** @type {Map<string, string>} */
    const existingTypes = new Map();
    try {
      _walkBookmarks(loadBookmarks(), (item) => { existingTypes.set(item.id, item.type); });
    } catch (_) { /* nothing to compare */ }
    const chapterCounts = new Map(books.map((b) => [b.id, b.chapter_count]));
    const { nodes, skipped } = _sanitizeImportItems(
      data.bookmarks,
      (id) => chapterCounts.get(id) ?? null,
      (id) => existingTypes.get(id) ?? null,
    );
    // 옛 판의 절 범위는 들이면서 지금 표기로 옮긴다(ADR-040 「절 범위」, coding-pitfalls §38) — before the size check,
    // which measures what gets stored.
    _walkBookmarks(nodes, (item) => { if (item.type === "bookmark") migrateLegacyBookmark(item, books); });
    if (!nodes.length && skipped > 0) {
      _importStopped(`가져올 수 있는 항목이 없습니다. 파일에는 올바르지 않은 항목 ${skipped}개만 들어 있습니다.`);
      return;
    }
    if (!_fitsStorage(projectedStorageChars(nodes))) {
      _importStopped("북마크를 가져오지 않았습니다. 목록이 너무 커서 저장할 수 없습니다.");
      return;
    }
    openImportModal(nodes, skipped);
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
/** @param {string[]} paths  SVG path data @returns {SVGSVGElement} */
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
  openConfirmModal,
  openNewFolderModal, openSaveModal,
  openImportFilePicker, openMoveModal,
};
