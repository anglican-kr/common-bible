"use strict";
// @ts-check

// Bookmark tree rendering — extracted from bookmark.js (ADR-034 후속, 마지막 라운드 2/2).
// The bookmark UI's core: per-row builders (bookmark/folder items, swipe actions,
// drag handle, select circle, folder read button, empty state), renderBookmarkTree
// (drawer body OR #bookmarks-view-tree full view), _rerenderActiveBookmarkTree
// (the re-render hub injected into gestures/select/menu/modals), renderBookmarksView
// (full-screen tab view), and the drawer-body keyboard navigation (roving tabindex +
// arrow/Home/End/Enter) + swipe-outside pointerdown.
//
// The renderers reach back into the drawer/header orchestrator for three things,
// injected via initBookmarkTree() (의존성 주입, like the earlier rounds) so this
// module never imports bookmark.js back: closeBookmarkDrawer (a bookmark link/
// folder-read tap dismisses the drawer), refreshBookmarkHeaderBtn (reflect store
// changes in the reading header), _setBookmarkBtnIcon (the empty-state glyph, shared
// with the header button). Everything else is a downward import. Deps: appHelpers,
// appStorage, bookmark-core, bookmark-gestures, bookmark-select, bookmark-menu,
// window.{navigate, setTitle, hideAudioBar}.

/** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("../types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("../types").BookmarkTreeFolder} BookmarkTreeFolder */

const { _$, el, clearNode, chUnit, emptyState } = window.appHelpers;
const { loadBookmarks, saveBookmarks } = window.appStorage;

import {
  sortBookmarkNodes, getBookmarkSort, markBookmarkViewed, _forgetViewed,
  _isActiveBookmark, _hasActiveDescendant, _bookmarkHref, BOOKMARK_ADD_HELP,
  _walkBookmarks, _findItemInStore, removeItemById, setRenderPathname,
} from "./bookmark-core.js";
import {
  _setupDragHandle, closeSwipedRow, resetSwipedRow, closeSwipedRowIfOutside,
} from "./bookmark-gestures.js";
import { _bmSelectMode, _toggleBmSelect, _syncBmSelectChrome } from "./bookmark-select.js";
import { buildBmViewActions } from "./bookmark-menu.js";
// Row actions: swipe-edit (수정) opens the save/edit modal, swipe-delete (삭제) the
// destructive confirm. tree → modals is one-way (modals gets its render callbacks
// injected from bookmark.js, not from here), so no cycle.
import { openSaveModal, openConfirmModal } from "./bookmark-modals.js";

// ── Dependency injection ──
// bookmark.js (drawer/header orchestrator) injects these at startup so the
// renderers can dismiss the drawer / refresh the header / draw the empty-state
// glyph without importing bookmark.js back. Declared under the same names the
// builders call, so the extracted bodies need no rewrite. No-op defaults guard a
// pre-init call.
let closeBookmarkDrawer = () => {};
let refreshBookmarkHeaderBtn = () => {};
/** @param {SVGElement} _svg @param {boolean} _hasBookmark */
let _setBookmarkBtnIcon = (_svg, _hasBookmark) => {};
/**
 * @param {{
 *   closeDrawer: () => void,
 *   refreshHeaderBtn: () => void,
 *   bookmarkBtnIcon: (svg: SVGElement, hasBookmark: boolean) => void,
 * }} deps
 */
function initBookmarkTree(deps) {
  closeBookmarkDrawer = deps.closeDrawer;
  refreshBookmarkHeaderBtn = deps.refreshHeaderBtn;
  _setBookmarkBtnIcon = deps.bookmarkBtnIcon;
}

// Drawer body — the tree's render target (default) + roving-tabindex nav root.
// Owned here now (only the tree touches it); the orchestrator's drawer lifecycle
// works through the overlay controller + renderBookmarkTree, not this element.
const $bookmarkDrawerBody = _$("bookmark-drawer-body");

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

export {
  initBookmarkTree,
  renderBookmarkTree, _rerenderActiveBookmarkTree, renderBookmarksView,
};
