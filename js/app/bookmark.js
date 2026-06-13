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
/** @typedef {import("../types").DragState} DragState */
/** @typedef {import("../types").BooksData} BooksData */

const { _$, el } = window.appHelpers;
const { createOverlay, attachSheetDrag, attachSheetResize } = window.appOverlay;
const { loadBookmarks, saveBookmarks, generateId } = window.appStorage;
const { readingContext } = window;

// Verse-spec utilities split out to verse-spec.js (ADR-034 후속). Imported for
// the save/copy paths; parseVerseSpec stays facade-only (routing/views call it).
import {
  collapseFullVerseRefs,
  selectedVersesToSpec, serializeVerseRange,
} from "./verse-spec.js";

// Bookmark logic split out to bookmark-core.js (ADR-034 후속 PR2~4). After the tree
// rendering round most core helpers are consumed by bookmark-tree.js / -menu / -select
// directly; the orchestrator only needs findExistingChapterBookmarks (header button
// "is this chapter bookmarked?" check).
import { findExistingChapterBookmarks } from "./bookmark-core.js";

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
} from "./bookmark-select.js";

// Verse selection mode (in-reading 절 선택 → 북마크/복사) split out to
// bookmark-verse-select.js (ADR-034 후속). A near-leaf (no orchestrator callback),
// so this module only imports the entry/exit + bar/boundary updaters it drives from
// the drawer toolbar, keydown, modal injection, and the window facade.
import {
  enterVerseSelectMode, exitVerseSelectMode,
  updateVerseSelectionBoundaries, updateVerseSelectBar,
} from "./bookmark-verse-select.js";

// Tab-view ⋯ menu + JSON export helper split out to bookmark-menu.js (ADR-034 후속).
// bookmark-tree.js's renderBookmarksView mounts buildBmViewActions; the orchestrator
// only needs exportBookmarks (drawer #bm-export-btn) + initBookmarkMenu (inject re-render).
import { initBookmarkMenu, exportBookmarks } from "./bookmark-menu.js";

// Tree rendering (per-row builders + renderBookmarkTree + the _rerenderActiveBookmarkTree
// hub + renderBookmarksView + drawer-body keyboard nav) split out to bookmark-tree.js
// (ADR-034 후속, 마지막 라운드). This module imports the renderers (openBookmarkDrawer +
// the facade use them; the hub feeds the gesture/select/menu rerender hooks) and injects
// the three drawer/header callbacks the tree reaches back for via initBookmarkTree.
import {
  initBookmarkTree,
  renderBookmarkTree, _rerenderActiveBookmarkTree, renderBookmarksView,
} from "./bookmark-tree.js";


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

// Wire the split bookmark modules back to the orchestrator (ADR-034 후속).
// gesture/select/menu reach back for the post-mutation re-render (select also for
// the header refresh; gesture also reads the live select-mode flag); _rerenderActiveBookmarkTree
// is the re-render hub, now imported from bookmark-tree.js. refreshBookmarkHeaderBtn /
// closeBookmarkDrawer / _setBookmarkBtnIcon are hoisted declarations below, injected into
// the tree so its renderers can dismiss the drawer / refresh the header / draw the
// empty-state glyph. _bmSelectMode is the live import binding from bookmark-select.js.
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
initBookmarkTree({
  closeDrawer: () => closeBookmarkDrawer(),
  refreshHeaderBtn: () => refreshBookmarkHeaderBtn(),
  bookmarkBtnIcon: _setBookmarkBtnIcon,
});

// ── Bookmark UI ──

const $bookmarkScrim = _$("bookmark-scrim");
const $bookmarkDrawer = _$("bookmark-drawer");
const $bookmarkDrawerClose = _$("bookmark-drawer-close");
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
