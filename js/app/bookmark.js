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

// Verse-spec utilities split out to verse-spec.js (ADR-034 후속). Imported for
// the save/copy paths; parseVerseSpec stays facade-only (routing/views call it).
import {
  collapseFullVerseRefs,
  selectedVersesToSpec, serializeVerseRange,
} from "./verse-spec.js";

// Bookmark logic (query/tree ops, href/share, sort, active-route highlight)
// split out to bookmark-core.js (ADR-034 후속 PR2~4). The QUERY tree helpers
// keep a window facade owned by bookmark-core; bookmark.js imports everything it
// calls. _renderPathname now lives in core; the UI sets it via setRenderPathname.
import {
  _bookmarkHref, BOOKMARK_ADD_HELP,
  getBookmarkSort,
  markBookmarkViewed, _forgetViewed,
  sortBookmarkNodes,
  _walkBookmarks, findExistingChapterBookmarks, _findItemInStore,
  removeItemById, insertItem,
  _isActiveBookmark, _hasActiveDescendant, setRenderPathname,
} from "./bookmark-core.js";

// Modal dialogs split out to bookmark-modals.js (ADR-034 후속 PR5). They own
// their overlays + DOM refs + Escape stack (closeTopmostModal); bookmark.js
// injects its render callbacks once via initBookmarkModals() so the modal→render
// path needs no circular import back here.
import {
  initBookmarkModals, closeTopmostModal,
  openConfirmModal,
  openNewFolderModal, openSaveModal,
  openImportFilePicker, openMoveModal,
} from "./bookmark-modals.js";

// Gesture engine (drag-to-reorder + swipe-to-reveal) split out to
// bookmark-gestures.js (ADR-034 후속). It owns the pointer handler + swipe
// state; this module imports the public surface and injects the two runtime
// hooks it needs (tree re-render + select-mode flag) via initBookmarkGestures
// — see the call right after _bmSelectMode is declared below.
import {
  initBookmarkGestures,
  moveBookmarkItem, _setupDragHandle, _isMobileViewport,
  closeSwipedRow, resetSwipedRow, closeSwipedRowIfOutside,
} from "./bookmark-gestures.js";

// Select-delete mode (state + cascade math + 삭제·공유·이동 actions) split out to
// bookmark-select.js (ADR-034 후속). It owns the #bm-select-bar dock + its
// listeners; this module imports the live `_bmSelectMode` flag (read by tree
// builders / keydown / header refresh) + the handlers the tree wires, and injects
// the re-render + header-refresh hooks via initBookmarkSelect below.
import {
  initBookmarkSelect, _bmSelectMode,
  enterBookmarkSelectMode, exitBookmarkSelectMode,
  _toggleBmSelect, _syncBmSelectChrome,
} from "./bookmark-select.js";

// Verse selection mode (in-reading 절 선택 → 북마크/복사) split out to
// bookmark-verse-select.js (ADR-034 후속). A near-leaf (no orchestrator callback),
// so this module only imports the entry/exit + bar/boundary updaters it drives from
// the drawer toolbar, keydown, modal injection, and the window facade.
import {
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
} from "./bookmark-verse-select.js";

// Tab-view ⋯ menu (정렬·새 폴더·내보내기·가져오기·선택 + 🛈 안내 + 전체 선택) and the
// JSON export helper split out to bookmark-menu.js (ADR-034 후속). renderBookmarksView
// mounts buildBmViewActions into the title row; the drawer's #bm-export-btn reuses
// exportBookmarks. The menu's post-sort re-render is injected via initBookmarkMenu.
import {
  initBookmarkMenu, buildBmViewActions, exportBookmarks,
} from "./bookmark-menu.js";


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
// (its closeTransition; cleared on reopen). The new-folder modal's continuation
// state (_bmNewFolderCallback / _bmNewFolderParentCombo) moved with it to
// bookmark-modals.js (PR5b).
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookmarkDrawerCloseTimer = null;
// Drag/swipe state (_dragState, _swipedRow) + the pointer handler that owns it
// moved to bookmark-gestures.js (ADR-034 후속).
const BOOKMARK_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #launch-screen, #install-scrim, #install-modal, #verse-select-bar, #bm-select-bar";

// Wire the gesture + select-mode modules back to the orchestrator (ADR-034 후속).
// Both reach back for the post-mutation re-render (select also for the header
// refresh); the gesture handler additionally reads the live select-mode flag so
// swipe/drag suppress during multi-select. _rerenderActiveBookmarkTree /
// refreshBookmarkHeaderBtn are hoisted declarations below; _bmSelectMode is the
// live import binding from bookmark-select.js.
initBookmarkGestures({
  rerenderTree: () => _rerenderActiveBookmarkTree(),
  isSelectMode: () => _bmSelectMode,
});
initBookmarkSelect({
  rerenderTree: () => _rerenderActiveBookmarkTree(),
  refreshHeaderBtn: () => refreshBookmarkHeaderBtn(),
});
initBookmarkMenu({
  rerenderTree: () => _rerenderActiveBookmarkTree(),
});

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
// $bmImportBtn / $bmImportInput + the import modal refs moved to bookmark-modals.js (PR5d).
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
// $bmImport* modal refs moved to bookmark-modals.js (PR5d).
// $bmSave* / $bmNewFolder* / $bmMerge* refs moved to bookmark-modals.js (PR5b~5c).
// $bmConfirm* refs moved to bookmark-modals.js (PR5a).
// Verse selection mode (#verse-select-bar) + its refs/listeners moved to
// bookmark-verse-select.js (ADR-034 후속).
// Bookmark select dock (#bm-select-bar) + its refs/listeners moved to
// bookmark-select.js (ADR-034 후속).
// Move-to-folder modal (선택 모드 → 이동).
// $bmMove* refs moved to bookmark-modals.js with the move picker (PR5e).

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
// `focusBookId`, when given, asks the book list to move focus onto the book
// we were just reading once it renders, so keyboard users land in context.
function buildHomeBtn(target, ariaLabel, focusBookId) {
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
  btn.addEventListener("click", () => {
    if (focusBookId) setPendingBookFocus(focusBookId);
    navigate(target);
  });
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
  // No single-chapter context (book's chapter-list header): nothing to "add", so
  // the mobile CSS hides it there (the tab bar's 북마크 탭 covers management).
  if (chapter == null) {
    btn.classList.add("is-list");
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  // Size comes from CSS (.title-bookmark-btn svg) in rem — see style.css header-icon rule.
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  _setBookmarkBtnIcon(svg, hasBookmark);
  btn.appendChild(svg);
  // 모바일(탭 바 있음, ≤768px)에선 헤더 북마크가 '이 장 추가' 어포던스 전용 —
  // 이미 북마크된 장(.has-bookmark)·장-목록(.is-list)에서는 CSS 가 숨기므로 보이는
  // 건 미저장 장뿐이고, 탭하면 폴더 위치를 고르는 저장 모달(openSaveModal)을 연다.
  // 그 외(데스크탑·가로 폰처럼 탭 바가 없는 >768px, 또는 장 맥락 없음)는 북마크 시트
  // (드로어)를 연다 — 거기선 헤더가 유일한 북마크 진입점이라 상태 표시 겸 관리 창구다.
  // 보임/숨김은 CSS 미디어 쿼리가 담당해 가로/세로 회전에도 자동으로 따라온다.
  btn.addEventListener("click", () => {
    if (_isMobileViewport() && bookId && chapter != null) {
      openSaveModal("chapter");
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

// _buildMaterialFolderIcon moved to bookmark-modals.js with the folder combobox (PR5b).

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

// _buildFolderCombobox moved to bookmark-modals.js (PR5b); imported above.

// Per-folder "읽기" entry (ADR-035): a continuous reading screen of every
// passage under this folder (nested sub-folders included, rendered as
// sub-headings). Always-visible trailing icon so each folder — a liturgical
// unit — is independently readable. Tap navigates to /read/<id> (a home-tab
// route, so the tab bar switches to 홈 for the read); stops propagation so it
// never toggles the folder's expand/collapse.
/** @param {{ id: string, name: string }} folder */
function _buildFolderReadBtn(folder) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Material Symbols "play_lesson" (a book with a play triangle) — frames each
  // folder's continuous read as "play this lesson," fitting the liturgical
  // reading unit better than the passive auto_stories book it replaced.
  path.setAttribute("d", "M452-160q6 20 16.5 41.5T490-80H200q-33 0-56.5-23.5T120-160v-640q0-33 23.5-56.5T200-880h480q33 0 56.5 23.5T760-800v284q-18-2-40-2t-40 2v-284H480v280l-100-60-100 60v-280h-80v640h252Zm126.5 61.5Q520-157 520-240t58.5-141.5Q637-440 720-440t141.5 58.5Q920-323 920-240T861.5-98.5Q803-40 720-40T578.5-98.5ZM670-140l160-100-160-100v200ZM280-800h200-200Zm172 0H200h480-240 12Z");
  svg.appendChild(path);
  const btn = el("button", {
    className: "bm-folder-read-btn",
    type: "button",
    "aria-label": `${folder.name} 모아 읽기`,
    draggable: "false",
  }, svg);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Select mode owns the row; don't navigate away mid-selection.
    if (_bmSelectMode) return;
    navigate(`/read/${folder.id}`);
  });
  // The drag handler treats the row as a drag/longpress surface; keep a pointer
  // press on the read button from arming a drag.
  btn.addEventListener("pointerdown", (e) => e.stopPropagation());
  return btn;
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
    if (t instanceof Element && t.closest(".bm-item-actions, .bm-swipe-action, .bm-folder-read-btn")) return;
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
  content.appendChild(_buildFolderReadBtn(folder));
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
// BOOKMARK_ADD_HELP (empty-state + 🛈 popover guidance) moved to bookmark-core.js
// (ADR-034 후속) — shared by the empty state here and the menu's info popover.

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
  setRenderPathname(window.location.pathname);
  // The previously swiped row may be replaced when we re-render; drop the
  // stale reference held by js/app/bookmark.js.
  resetSwipedRow();
  clearNode(target);
  // Reveal per-row reorder handles (≡) only under 직접 정렬 (manual), where a
  // drag actually reorders; auto-sorts would re-sort the drop away, so no handle.
  target.classList.toggle("bm-sortable", getBookmarkSort() === "manual");
  const store = loadBookmarks();
  // Full view: the 🛈 add-help button is for users who ALREADY have bookmarks (the
  // empty state already shows the same guidance), so hide it when the list is empty.
  if (target !== $bookmarkDrawerBody) {
    const bmInfoBtn = document.querySelector('.title-action-btn[aria-haspopup="dialog"]');
    if (bmInfoBtn instanceof HTMLElement) bmInfoBtn.hidden = !store.length;
  }
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

// Save/edit + merge modals moved to bookmark-modals.js (PR5c); openSaveModal
// imported above (openMergeDialog is reached only via openSaveModal, internal to
// that module).

// ── Destructive confirm modal ──
// openConfirmModal moved to bookmark-modals.js (PR5a).

// ── Export / Import bookmarks (Phase 2a) ──
// exportBookmarks (plain JSON download) moved to bookmark-menu.js (ADR-034 후속) —
// imported above for the #bm-export-btn listener below. Import flow + IMPORT_EXPORT
// pure helpers live in bookmark-modals.js (PR5d); 가져오기 calls openImportFilePicker.

// ── Drawer toolbar event handlers ──

$bookmarkDrawerClose.addEventListener("click", closeBookmarkDrawer);
$bookmarkScrim.addEventListener("click", closeBookmarkDrawer);

// save modal listeners moved to bookmark-modals.js (PR5c).

// bookmark-modals.js owns its own scrim/cancel listeners; bookmark.js only
// injects the render callbacks a modal needs to refresh the tree/header after a
// mutation (의존성 주입 — breaks the modal→render cycle without a circular import).
initBookmarkModals({
  rerenderActiveBookmarkTree: _rerenderActiveBookmarkTree,
  refreshBookmarkHeaderBtn,
  exitVerseSelectMode,
});

// new-folder modal listeners moved to bookmark-modals.js (PR5b).

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

$bmOverflowBtn.addEventListener("click", () => {
  const isOpen = !$bmOverflowPanel.hidden;
  $bmOverflowPanel.hidden = isOpen;
  $bmOverflowBtn.setAttribute("aria-expanded", String(!isOpen));
});

$bmExportBtn.addEventListener("click", exportBookmarks);
// import file-input + change listener moved to bookmark-modals.js (PR5d).

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (closeTopmostModal(e)) return;  // all bookmark modals incl. move (bookmark-modals.js)
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
  // Phase 6a helpers (verse-spec → verse-spec.js, query/href/sort → bookmark-core.js, ADR-034 후속)
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

// Phase 6a per-name globals (existing). Verse-spec facade (parseVerseSpec /
// collapseFullVerseRefs / selectedVersesToSpec / mergeVerseSpecs /
// serializeVerseRange) moved to verse-spec.js (ADR-034 후속).
// QUERY tree helpers' facade (findExistingChapterBookmarks / _walkBookmarks /
// _findItemInStore / _findParentFolderId / removeItemById / insertItem /
// collectFolderOptions) moved to bookmark-core.js (ADR-034 후속 PR3).
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
// (window.closeMoveModal moved to bookmark-modals.js with the move picker, PR5e.)
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
