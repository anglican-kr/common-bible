"use strict";
// @ts-check

// Bookmark tab-view title-row actions — extracted from bookmark.js (ADR-034 후속).
// The "⋯" (더 보기) overflow menu (새 폴더·내보내기·가져오기·선택) + the 정렬 field /
// 오름·내림 order radio groups + the "🛈" add-help popover + the 전체 선택 toggle, all
// built into the #page-title row by renderBookmarksView. Plus exportBookmarks
// (plain JSON download) — a leaf used by both this menu and the drawer's export
// button, so it lives here and bookmark.js imports it back for that listener.
//
// The only orchestrator callback is the post-sort re-render, injected via
// initBookmarkMenu() (의존성 주입, like the gesture/select rounds) so this module
// never imports bookmark.js back. Deps: appHelpers, appStorage, bookmark-core
// (sort prefs + BOOKMARK_ADD_HELP), bookmark-modals (새 폴더/가져오기), bookmark-select
// (선택 진입 + 전체 선택), window.announce.

const { el } = window.appHelpers;
const { loadBookmarks } = window.appStorage;

import {
  getBookmarkSort, getBookmarkSortDir, setBookmarkSort, setBookmarkSortDir,
  BOOKMARK_ADD_HELP,
} from "./bookmark-core.js";
import { openNewFolderModal, openImportFilePicker } from "./bookmark-modals.js";
import { enterBookmarkSelectMode, _bmToggleSelectAll } from "./bookmark-select.js";

// ── Dependency injection ──
// bookmark.js injects the tree re-render at startup (initBookmarkMenu) so a sort
// change / new folder can repaint without importing bookmark.js back.
let _rerenderTree = () => {};
/** @param {{ rerenderTree: () => void }} deps */
function initBookmarkMenu(deps) {
  _rerenderTree = deps.rerenderTree;
}

// Build an inline-SVG glyph for a menu item from one or more stroked paths.
// Matches the hairline weight of the other header icons (~1.7 stroke).
/** @param {string[]} paths @returns {SVGSVGElement} */
function _bmMenuIcon(paths) {
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

// Build the right-aligned action cluster for the bookmark tab view's title row.
// Following Apple Music's pattern, the only header affordance is a single "⋯"
// (더 보기) button; every global management action lives inside its dismissible
// popup menu (새 폴더 / 내보내기 / 가져오기 / 삭제). Each menu row carries an SF-style
// glyph (HIG). Returns a DocumentFragment with the 전체 선택 toggle (shown only in
// select mode) + the .title-actions cluster (🛈 + ⋯), both appended into #page-title.
// .title-action-btn mirrors the other header icon buttons (44px touch target).
function buildBmViewActions() {
  const wrap = el("div", { className: "title-actions" });

  // ── "⋯" 더 보기 + menu ──
  const moreSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  moreSvg.setAttribute("viewBox", "0 0 24 24");
  moreSvg.setAttribute("fill", "currentColor");
  moreSvg.setAttribute("aria-hidden", "true");
  for (const cx of [6, 12, 18]) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(cx));
    dot.setAttribute("cy", "12");
    dot.setAttribute("r", "1.6");
    moreSvg.appendChild(dot);
  }
  const moreBtn = el("button", {
    className: "title-action-btn",
    type: "button",
    "aria-label": "더 보기",
    "aria-haspopup": "menu",
    "aria-expanded": "false",
  }, moreSvg);

  const menu = el("div", { className: "title-action-menu", role: "menu", "aria-label": "더 보기", hidden: "" });
  /** @type {{ item: HTMLElement, mode: string }[]} */
  const sortItems = [];
  /** @type {{ item: HTMLButtonElement, dir: string, note: HTMLElement }[]} */
  const dirItems = [];
  // 오름/내림 alone is ambiguous and its meaning flips per field (제목 오름=가나다,
  // but 추가된 날짜 오름=오래된 순), so each row carries a field-specific clarifier
  // shown muted after the label, refreshed on open. "manual" has no direction
  // (no entry → no note, rows disabled).
  /** @type {Record<string, { asc: string, desc: string }>} */
  const _DIR_CLARIFY = {
    title:    { asc: "가나다순",    desc: "ㅎ→ㄱ" },
    created:  { asc: "오래된 순",   desc: "최신 순" },
    modified: { asc: "오래된 순",   desc: "최근 순" },
    viewed:   { asc: "오래전 본 순", desc: "최근 본 순" },
  };

  // The menu DOM outlives a tree re-render (only the tree is rebuilt when sort
  // changes), so refresh the radio checks from the live preference on each open.
  function syncSortChecks() {
    const cur = getBookmarkSort();
    for (const { item, mode } of sortItems) item.setAttribute("aria-checked", String(mode === cur));
  }
  // 오름/내림 reflects the *active* mode's direction + its field-specific note.
  // "manual" has no direction, so both rows go disabled (greyed, no check, no
  // note) until a key-sorted mode is picked.
  function syncDirChecks() {
    const mode = getBookmarkSort();
    const manual = mode === "manual";
    const cur = manual ? null : getBookmarkSortDir(mode);
    const clar = _DIR_CLARIFY[mode] || null;
    for (const { item, dir, note } of dirItems) {
      item.disabled = manual;
      item.setAttribute("aria-checked", String(!manual && dir === cur));
      note.textContent = clar ? clar[dir] : "";
    }
  }

  // Assigned once the 선택 item is built; refreshes its enabled state per open.
  let refreshSelectEnabled = () => {};

  // Cap the menu so it never spills past the viewport bottom (landscape: its
  // rows are taller than the short height, leaving lower items unreachable —
  // ADR-030 후속⁷). Measure from the trigger button (not the menu, whose
  // scale-in transform would skew getBoundingClientRect) and leave a bottom gap;
  // CSS then scrolls the overflow with the iOS-26 thin scrollbar. Recomputed on
  // every resize while open so a rotation flips the cap with the orientation
  // (both the available height and the anchor's top change) — without it a menu
  // opened in one orientation keeps the other's cap (stale scrollbar / overflow).
  function sizeMenu() {
    if (!moreBtn.isConnected) { window.removeEventListener("resize", sizeMenu); return; }
    const anchorTop = moreBtn.getBoundingClientRect().top;
    menu.style.maxHeight = `${Math.max(180, Math.round(window.innerHeight - anchorTop - 16))}px`;
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    moreBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKeydown, true);
    window.removeEventListener("resize", sizeMenu);
  }
  function openMenu() {
    if (!menu.hidden) return;
    syncSortChecks();
    syncDirChecks();
    refreshSelectEnabled();
    menu.hidden = false;
    moreBtn.setAttribute("aria-expanded", "true");
    sizeMenu();
    window.addEventListener("resize", sizeMenu);
    // Capture phase so an outside click closes before it acts elsewhere.
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("keydown", onKeydown, true);
  }
  // SPA navigation can remove the header (and this menu's DOM) while the menu
  // is open, without calling closeMenu — leaving these document listeners
  // attached. Both handlers self-clean if the trigger is detached.
  /** @param {MouseEvent} e */
  function onDocClick(e) {
    if (!moreBtn.isConnected) { closeMenu(); return; }
    const t = /** @type {Node} */ (e.target);
    if (wrap.contains(t)) return;
    closeMenu();
  }
  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!moreBtn.isConnected) { closeMenu(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      moreBtn.focus();
    }
  }

  moreBtn.addEventListener("click", () => {
    if (menu.hidden) { closeInfo(); openMenu(); }
    else closeMenu();
  });

  // ── 정렬 group (menuitemradio, 현재 선택에 체크) ──
  // Per-device sort preference (localStorage), so selecting one re-renders the
  // tree in place. Leading checkmark slot mirrors Apple Music's sort group.
  const sortGroup = el("div", { className: "title-action-menu-group", role: "group", "aria-label": "정렬" });
  /** @param {string} label @param {string} mode */
  function addSortItem(label, mode) {
    const item = el("button", {
      className: "title-action-menu-item title-action-menu-item--sort",
      type: "button",
      role: "menuitemradio",
      "aria-checked": String(getBookmarkSort() === mode),
    });
    // The check glyph is always present; CSS reveals it only on the active row
    // (aria-checked), so syncSortChecks just flips the attribute.
    const check = el("span", { className: "title-action-menu-check", "aria-hidden": "true" });
    check.appendChild(_bmMenuIcon(["M5 12.5 10 17.5 19 7"]));
    item.appendChild(check);
    item.appendChild(el("span", { className: "title-action-menu-label" }, label));
    item.addEventListener("click", () => {
      setBookmarkSort(mode);
      closeMenu();
      _rerenderTree();
    });
    sortGroup.appendChild(item);
    sortItems.push({ item, mode });
    return item;
  }
  addSortItem("제목", "title");
  addSortItem("직접 정렬", "manual");
  addSortItem("추가된 날짜", "created");
  addSortItem("최근에 본 날짜", "viewed");
  addSortItem("수정한 날짜", "modified");

  // ── 정렬 순서 group (오름/내림, menuitemradio) ──
  // A second radio set under the 정렬 fields (Apple Music pattern): applies to
  // whichever field is active, remembered per field. Reuses the --sort row
  // (leading checkmark slot) so it lines up with the fields above.
  const dirGroup = el("div", { className: "title-action-menu-group", role: "group", "aria-label": "정렬 순서" });
  /** @param {string} label @param {string} dir */
  function addDirItem(label, dir) {
    const item = /** @type {HTMLButtonElement} */ (el("button", {
      className: "title-action-menu-item title-action-menu-item--sort",
      type: "button",
      role: "menuitemradio",
      "aria-checked": "false",
    }));
    const check = el("span", { className: "title-action-menu-check", "aria-hidden": "true" });
    check.appendChild(_bmMenuIcon(["M5 12.5 10 17.5 19 7"]));
    item.appendChild(check);
    // The clarifier sits inside the label so it reads as one phrase ("오름차순
    // 가나다순"); the parentheses are CSS-only so screen readers skip them.
    const labelSpan = el("span", { className: "title-action-menu-label" }, label);
    const note = el("span", { className: "title-action-menu-dir-note" });
    labelSpan.appendChild(note);
    item.appendChild(labelSpan);
    item.addEventListener("click", () => {
      const mode = getBookmarkSort();
      if (mode === "manual") return; // inert under 직접 정렬 (also disabled)
      setBookmarkSortDir(mode, dir);
      closeMenu();
      _rerenderTree();
    });
    dirGroup.appendChild(item);
    dirItems.push({ item, dir, note });
    return item;
  }
  addDirItem("오름차순", "asc");
  addDirItem("내림차순", "desc");

  // ── 액션 group ──
  const actionGroup = el("div", { className: "title-action-menu-group", role: "group" });
  // Build a menu row: leading SF-style glyph + label. The glyph sits in the
  // same far-left column as the sort group's checkmark (deliberate HIG
  // deviation) so both groups share one icon column and one label column.
  /** @param {string} label @param {string[]} iconPaths @param {() => void} onActivate */
  function addMenuItem(label, iconPaths, onActivate) {
    const item = el("button", { className: "title-action-menu-item title-action-menu-item--action", type: "button", role: "menuitem" });
    const glyph = el("span", { className: "title-action-menu-icon", "aria-hidden": "true" });
    glyph.appendChild(_bmMenuIcon(iconPaths));
    item.appendChild(glyph);
    item.appendChild(el("span", { className: "title-action-menu-label" }, label));
    item.addEventListener("click", () => {
      closeMenu();
      onActivate();
    });
    actionGroup.appendChild(item);
    return item;
  }

  // 새 폴더 — folder.badge.plus
  addMenuItem("새 폴더", [
    "M3 7.5a2 2 0 0 1 2-2h3.6l1.8 2H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z",
    "M12 11.5v4",
    "M10 13.5h4",
  ], () => {
    openNewFolderModal((_newId) => { _rerenderTree(); });
  });
  // 내보내기 — square.and.arrow.up. Arrow + tray are a true vertical mirror of
  // 가져오기, and both arrowheads stop one unit above the tray (y12 vs tray y13)
  // so neither fuses with it — the head fusing into the tray is what made the
  // down arrow read as smaller (optical illusion, not actual size).
  addMenuItem("내보내기", [
    "M12 12V4",
    "M8.5 7.5 12 4l3.5 3.5",
    "M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  ], () => {
    exportBookmarks();
  });
  // 가져오기 — square.and.arrow.down (mirror of 내보내기 above)
  addMenuItem("가져오기", [
    "M12 4v8",
    "M8.5 8.5 12 12l3.5-3.5",
    "M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5",
  ], () => {
    openImportFilePicker();
  });
  // 선택 — checkmark.circle. Enters the in-place select mode (ADR-029 개정): rows
  // reveal a leading selection circle and the tab dock yields to #bm-select-bar
  // (공유·이동·삭제 pill + 취소). A neutral management action, so it sits in the
  // action group right after 가져오기 (the destructive 삭제 lives in the dock, so
  // there's no "destructive-last" reason to strand it at the bottom).
  const selectItem = addMenuItem("선택", [
    "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z",
    "M8.5 12.5 11 15 15.5 9.5",
  ], () => {
    enterBookmarkSelectMode();
  });
  // Reflect emptiness whenever the menu opens (the DOM outlives re-renders).
  refreshSelectEnabled = () => { selectItem.disabled = loadBookmarks().length === 0; };

  // Three groups separated by hairlines: management actions (새 폴더·내보내기·
  // 가져오기·선택), then the 정렬 field radios, then the 오름/내림 order radios —
  // "do something" / "sort by what" / "in which direction" (Apple Music pattern).
  menu.appendChild(actionGroup);
  menu.appendChild(el("div", { className: "title-action-menu-sep", role: "separator" }));
  menu.appendChild(sortGroup);
  menu.appendChild(el("div", { className: "title-action-menu-sep", role: "separator" }));
  menu.appendChild(dirGroup);

  // ── "🛈" 북마크 추가 방법 안내 팝오버 ──
  // Sits to the LEFT of ⋯ (⋯ stays trailing-most as the overflow affordance).
  // Reuses .title-action-btn so it shares the neutral charcoal (--accent) chrome
  // — deliberately NOT a tinted / iOS-blue info glyph: ADR-028 froze chrome to
  // neutral and reserves --theme for the nav signature only. Tap toggles a small
  // text popover that reuses the empty-state guidance, so users who already have
  // bookmarks still have a reminder of how adding works (reading-context only).
  const infoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  infoSvg.setAttribute("viewBox", "0 -960 960 960");
  infoSvg.setAttribute("fill", "currentColor");
  infoSvg.setAttribute("aria-hidden", "true");
  const infoPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // Material Symbols "info" (outlined).
  infoPath.setAttribute("d", "M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z");
  infoSvg.appendChild(infoPath);
  const infoBtn = el("button", {
    className: "title-action-btn",
    type: "button",
    "aria-label": "북마크 추가 방법",
    "aria-haspopup": "dialog",
    "aria-expanded": "false",
  }, infoSvg);

  const infoPop = el("div", {
    className: "title-action-popover",
    role: "dialog",
    "aria-labelledby": "bm-add-help-title",
    hidden: "",
  });
  infoPop.appendChild(el("h2", { className: "title-action-popover-title", id: "bm-add-help-title" }, "북마크 추가하기"));
  infoPop.appendChild(el("p", { className: "title-action-popover-text" }, BOOKMARK_ADD_HELP));

  function closeInfo() {
    if (infoPop.hidden) return;
    infoPop.hidden = true;
    infoBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", onInfoDocClick, true);
    document.removeEventListener("keydown", onInfoKeydown, true);
  }
  function openInfo() {
    if (!infoPop.hidden) return;
    infoPop.hidden = false;
    infoBtn.setAttribute("aria-expanded", "true");
    document.addEventListener("click", onInfoDocClick, true);
    document.addEventListener("keydown", onInfoKeydown, true);
  }
  // Mirror the ⋯ menu's self-cleaning listeners: SPA nav can drop this DOM while
  // the popover is open without calling closeInfo, so both handlers bail (and
  // detach) once the trigger is disconnected.
  /** @param {MouseEvent} e */
  function onInfoDocClick(e) {
    if (!infoBtn.isConnected) { closeInfo(); return; }
    const t = /** @type {Node} */ (e.target);
    if (wrap.contains(t)) return;
    closeInfo();
  }
  /** @param {KeyboardEvent} e */
  function onInfoKeydown(e) {
    if (!infoBtn.isConnected) { closeInfo(); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      closeInfo();
      infoBtn.focus();
    }
  }
  infoBtn.addEventListener("click", () => {
    if (infoPop.hidden) { closeMenu(); openInfo(); }
    else closeInfo();
  });

  wrap.appendChild(infoBtn);
  wrap.appendChild(infoPop);
  wrap.appendChild(moreBtn);
  wrap.appendChild(menu);

  // 전체 선택 toggle — shown only in select mode (CSS swaps it for the .title-actions
  // cluster via body.bm-select-active). iOS Mail/Files put Select All in the title
  // bar; "전체 삭제" is just 전체 선택 → 삭제 (no separate one-tap nuke). Label/pressed
  // state are refreshed by _syncSelectAllBtn; built fresh on each renderBookmarksView.
  const selectAllBtn = el("button", {
    className: "bm-select-allbtn",
    type: "button",
    "aria-pressed": "false",
  }, "전체 선택");
  selectAllBtn.addEventListener("click", _bmToggleSelectAll);

  const frag = document.createDocumentFragment();
  frag.appendChild(selectAllBtn);
  frag.appendChild(wrap);
  return frag;
}

// Export the whole bookmark store as a timestamped JSON download. Used by the ⋯
// menu's 내보내기 item and the drawer's #bm-export-btn (bookmark.js imports it for
// that listener). Plain download — no dialog, so it stays a leaf here.
function exportBookmarks() {
  const store = loadBookmarks();
  const payload = {
    _version: 1,
    exportedAt: Date.now(),
    bookmarks: store,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const _d = new Date();
  const date = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, "0")}-${String(_d.getDate()).padStart(2, "0")}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = `bible-bookmarks-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  announce("북마크를 내보냈습니다.");
}

export { initBookmarkMenu, buildBmViewActions, exportBookmarks };
