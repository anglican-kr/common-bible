"use strict";
// @ts-check

// ── bottom-nav ── (ADR-026 Stage 0)
// 모바일 전용 하단 탭바: 읽기 / 검색 / 북마크 / 노트.
// Owns: tab→route mapping, active-state sync, per-tab last-location memory
// (in-memory, non-persistent — ADR-026 §3), and reading-view auto-hide on
// scroll-down (§2.1).
//
// Stage 0 interim: 검색·북마크 탭은 아직 기존 오버레이(검색 시트 / 북마크 드로어)를
// 연다. Stage 2·3 에서 각각 `/search` · `/bookmarks` 라우트로 이관되면, goTab() 의
// 해당 분기를 navigate() 로 바꾸고 routeToTab() 이 자연히 활성 상태를 잡는다.

const { _$ } = window.appHelpers;

const $nav = _$("bottom-nav");

/**
 * Last path visited per route-based tab. Search/Bookmarks are overlays in
 * Stage 0 so they have no remembered location yet.
 * @type {Record<string, string>}
 */
const _tabLast = { read: "/", notes: "/notes" };

// Auto-hide scroll state.
let _lastY = 0;
let _raf = false;

// ── BEGIN ROUTE_TO_TAB ──
/**
 * Map a location path to its owning tab id.
 * @param {string} path
 * @returns {"read"|"search"|"bookmarks"|"notes"}
 */
function routeToTab(path) {
  const p = (path || "/").split("?")[0];
  if (p === "/search") return "search";
  if (p === "/bookmarks") return "bookmarks";
  if (p === "/notes" || p.startsWith("/notes/")) return "notes";
  // Book list, divisions, chapters, prologue — all the reading stack.
  return "read";
}
// ── END ROUTE_TO_TAB ──

/** Reflect the active tab from the current route via aria-current. */
function syncActive() {
  const active = routeToTab(location.pathname);
  $nav.querySelectorAll(".bnav-item").forEach((b) => {
    if (b.getAttribute("data-tab") === active) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}

function showNav() { document.body.classList.remove("bottom-nav-hidden"); }

/**
 * Called by the router after every navigation (views-routing.js route()).
 * Records the last location per route-based tab, refreshes the active
 * indicator, and reveals the nav (a route change always shows it).
 * @param {string} path
 */
function onRoute(path) {
  const tab = routeToTab(path);
  if (tab === "read" || tab === "notes") _tabLast[tab] = path;
  syncActive();
  showNav();
  _lastY = window.scrollY;
}

/** @param {string} path */
function navigate(path) {
  window.appViewsRouting?.navigate?.(path);
}

/** @param {string} tab */
function goTab(tab) {
  const cur = routeToTab(location.pathname);
  switch (tab) {
    case "read":
      // Already reading → top of the reading stack (book list); else resume.
      navigate(cur === "read" ? "/" : (_tabLast.read || "/"));
      break;
    case "notes":
      navigate(cur === "notes" ? "/notes" : (_tabLast.notes || "/notes"));
      break;
    case "search":
      window.appSearch?.openSearchSheet?.(""); // interim — see header note
      break;
    case "bookmarks":
      window.appBookmark?.openBookmarkDrawer?.(); // interim — see header note
      break;
  }
}

// ── Reading-view auto-hide on scroll-down (§2.1) ──
// Only the reading tab hides the nav (long-form content); other screens keep
// it pinned. Window scroll is the source of truth (same as initCompactHeader).
function _onScroll() {
  if (_raf) return;
  _raf = true;
  requestAnimationFrame(() => {
    _raf = false;
    const y = window.scrollY;
    if (routeToTab(location.pathname) !== "read") { showNav(); _lastY = y; return; }
    // The state lives on <body> so CSS can move the nav *and* the stacked
    // audio bar together (the audio bar precedes the nav in the DOM, so a
    // sibling selector can't reach it).
    if (y > _lastY && y > 80) document.body.classList.add("bottom-nav-hidden");
    else if (y < _lastY - 4) showNav();
    _lastY = y;
  });
}

function init() {
  $nav.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const btn = t.closest(".bnav-item");
    if (!btn) return;
    const tab = btn.getAttribute("data-tab");
    if (tab) goTab(tab);
  });
  window.addEventListener("scroll", _onScroll, { passive: true });
  _lastY = window.scrollY;
  syncActive();
}

window.appBottomNav = { init, onRoute, routeToTab };

// ESM module marker (ADR-019). No runtime effect.
export {};
