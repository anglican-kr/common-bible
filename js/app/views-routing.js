"use strict";
// @ts-check

// Phase 7a of the app.js modularization (ADR-018). Owns:
//  - Data fetching (loadBooks / loadVersion / loadChapter / loadPrologue)
//    + module-level caches (booksCache, appVersion) that feed everything else.
//  - Rendering helpers (setTitle / chapter picker / division tabs) + division
//    constants and book-order resolution (canonical vs vulgate ordering).
//  - Pull-to-refresh gesture (page-level mobile, ADR-010 follow-up).
//  - Compact Header on Scroll (collapses breadcrumb past 60px scroll).
//
// Views, Routing, Audio Player join this module in Phase 7b; the file name
// reflects that destination.

/** @typedef {import("../types").BooksData} BooksData */
/** @typedef {import("../types").BookEntry} BookEntry */
/** @typedef {import("../types").BibleChapter} BibleChapter */
/** @typedef {import("../types").BiblePrologue} BiblePrologue */

const { _$, el, clearNode, chUnit, trapFocus } = window.appHelpers;
const {
  loadBookOrder, loadStartupBehavior,
  loadReadingPosition, saveReadingPosition, clearReadingPosition,
  loadAudioTime, saveAudioTime, clearAudioTime,
  loadAudioShow,
  _maybeRequestPersist,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;
const { readingContext } = window;

// DOM anchors. Redeclared locally so views-routing.js is self-contained.
const $app = _$("app");
const $title = _$("page-title");
const $audioBar = _$("audio-bar");
const $resumeBannerSlot = _$("resume-banner-slot");
const $divisionTabsSlot = _$("division-tabs-slot");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchBar = _$("search-bar");
const $tabBar = _$("tab-bar");
const $tabSearch = _$("tab-search");

// ── Tab bar active state (ADR-029, ADR-030) ──
// The global <a> click interceptor (further below) already SPA-navigates the
// tab links; this only reflects the current route in the bar's active highlight.
// Reading routes (/, /<division>, /<book>/<chapter>, …) all map to the home tab.
// ADR-030: 검색은 탭에서 분리된 #tab-search 버튼 — seg==="search" 일 때 별도로 활성.
function syncTabBarActive() {
  if (!$tabBar) return;
  const seg = location.pathname.replace(/^\//, "").split("/")[0];
  const active = seg === "search" ? "search"
    : seg === "bookmarks" ? "bookmarks"
    : seg === "settings" ? "settings"
    : "home";
  for (const a of $tabBar.querySelectorAll(".tab-item")) {
    const on = a.getAttribute("data-tab") === active;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if ($tabSearch) {
    const on = active === "search";
    $tabSearch.classList.toggle("active", on);
    if (on) $tabSearch.setAttribute("aria-current", "page");
    else $tabSearch.removeAttribute("aria-current");
  }
  // ADR-030 P2: 검색 외 라우트로 가면(홈 탭 등) 검색 모핑을 복구. tabbar.js 가
  // 노출하는 exitTabSearch — 검색 진입 시엔 active==='search' 라 호출 안 됨.
  // 검색 라우트면(뒤로/앞으로로 ?q= 가 바뀌어도) dock 입력을 URL 에 동기화.
  if (active !== "search") window.exitTabSearch?.();
  else window.syncTabSearchQuery?.();
  // ADR-030 P3: 라우트 변경 시 스크롤 축소 복구(새 뷰는 최상단에서 시작).
  window.resetTabCollapse?.();
  // ADR-030 후속⁵: 공유 슬라이딩 인디케이터를 활성 탭으로 이동(없으면 숨김).
  _curTabActive = active;
  positionTabIndicator(active);
}

// ── ADR-030 후속⁵: 슬라이딩 인디케이터 ──
// division-tab 슬라이드(buildDivisionTabs)와 동일 패턴 — 단일 absolute 요소를 활성
// 탭의 실측 위치(offsetLeft/Width; space-between 60px 슬롯이라 비선형)로 translateX.
// 탭 사이 이동일 때만 슬라이드(CSS transition), 처음 표시/리사이즈/감속선호는 스냅.
// 모핑(.searching)·축소(.collapsed) 중 숨김은 CSS(특이도)가 담당.
let _prevTabIndic = null;   // 인디케이터가 현재 떠 있는 탭(없으면 null) — 슬라이드 판정
let _curTabActive = "home"; // 리사이즈 재배치용 현재 활성 탭
const _tabIndicMQL = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/** @param {string} active */
function positionTabIndicator(active) {
  if (!$tabBar) return;
  const ind = $tabBar.querySelector(".tab-indicator");
  if (!(ind instanceof HTMLElement)) return;
  const activeEl = active && active !== "search"
    ? $tabBar.querySelector(`.tab-item[data-tab="${active}"]:not([aria-disabled="true"])`)
    : null;
  if (!(activeEl instanceof HTMLElement)) {
    ind.classList.remove("is-shown");
    _prevTabIndic = null; // 다음 표시는 스냅(검색 등에서 돌아올 때 stale 위치서 미끄러짐 방지)
    return;
  }
  const apply = () => {
    const left = activeEl.offsetLeft + (activeEl.offsetWidth - ind.offsetWidth) / 2;
    const slide = _prevTabIndic !== null && _prevTabIndic !== active && !(_tabIndicMQL && _tabIndicMQL.matches);
    if (slide) {
      ind.style.transform = `translate(${left}px, -50%)`;
    } else {
      // 스냅: transition 잠시 끄고 위치 → reflow 커밋 → 복원(미끄러짐 없이 fade-in).
      const prev = ind.style.transition;
      ind.style.transition = "none";
      ind.style.transform = `translate(${left}px, -50%)`;
      void ind.offsetWidth;
      ind.style.transition = prev;
    }
    ind.classList.add("is-shown");
    _prevTabIndic = active;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  else apply();
}

// space-between 슬롯 위치는 폭 의존 → 리사이즈/회전 시 재배치(스냅, 디바운스).
// 라우트 변경이 아니므로 syncTabBarActive 가 안 불린다.
if (typeof window !== "undefined" && window.addEventListener) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _tabIndicTimer = null;
  const reposition = () => {
    _prevTabIndic = _curTabActive; // 같은 탭 → 슬라이드 없이 스냅
    positionTabIndicator(_curTabActive);
  };
  window.addEventListener("resize", () => {
    if (_tabIndicTimer) clearTimeout(_tabIndicTimer);
    _tabIndicTimer = setTimeout(reposition, 120);
  });
  window.addEventListener("orientationchange", reposition);
  // 모핑(검색/축소) 복귀 시 .tab-item max-width 가 ~0.25s 동안 애니메이트되므로,
  // syncTabBarActive 의 즉시 rAF 측정은 중간값(좁은 폭)을 읽어 인디케이터가 어긋난다.
  // → max-width transitionend 에서 활성 탭 실측으로 재배치(같은 탭이라 스냅). 한 번의
  // 모핑이 여러 탭의 transitionend 를 내지만 모두 같은 활성 탭 스냅이라 무해(저비용).
  if ($tabBar) {
    $tabBar.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "max-width") return;
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains("tab-item")) return;
      reposition();
    });
  }
  // tabbar.js 가 스크롤 축소 해제 후 재배치를 요청할 수 있도록 노출(필요 시).
  window.syncTabIndicator = reposition;
}

// Mirrors app.js's DATA_DIR — Phase 7b's audio player still uses the same
// constant in app.js until that section moves here as well.
const DATA_DIR = "/data";

// Module state — both caches are read by Phase 7b territory in app.js
// (Views/Routing) via `window.getBooksCache()` and `window.appVersion`.
/** @type {BooksData | null} */
let booksCache = null;
/** @type {string | null} */
let appVersion = null;

// ── Pull-to-refresh (mobile, page-level) ─────────────────────────────────────
// Drag-down gesture at the top of the page triggers Drive bookmark sync, the
// same operation visibilitychange→visible runs. The touchmove listener is
// non-passive (we preventDefault to suppress the rubber-band overscroll), so
// it is attached only for the duration of an active pull to keep the global
// scrolling fast path passive everywhere else.
(function setupPullToRefresh() {
  const PULL_THRESHOLD_PX  = 70;   // distance past which release triggers sync
  const PULL_MAX_PX        = 110;  // visual cap on indicator drop
  const PULL_RESISTANCE    = 0.5;  // 1px finger movement → 0.5px indicator drop
  const SYNC_FEEDBACK_MS   = 900;  // how long the spinner stays after trigger
  // Modal/sheet roots whose internal scroll must not be hijacked by PTR. We
  // walk e.target to see if the touch landed inside one of these.
  const MODAL_SELECTORS = "#bookmark-drawer, #install-modal, #bm-save-modal, #bm-new-folder-modal, #bm-import-modal, #bm-merge-modal, #drive-disconnect-modal, .settings-popover, .chapter-popover";

  /** @type {HTMLElement | null} */
  let indicator = null;
  /** @type {HTMLElement | null} */
  let scrim = null;
  let startY = 0;
  let delta = 0;
  let active = false;
  let syncing = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let resetCleanupTimer = null;

  // Inline styles always beat non-`!important` CSS, so the
  // `@media (prefers-reduced-motion: reduce)` block in style.css cannot
  // override `style.transition = "transform .25s ease, …"` we set below.
  // Gate the transition strings here in JS to honor the user preference.
  const _reducedMotionMQL = window.matchMedia("(prefers-reduced-motion: reduce)");
  function prefersReducedMotion() { return _reducedMotionMQL.matches; }

  function ensureIndicator() {
    if (indicator) return indicator;
    scrim = document.createElement("div");
    scrim.id = "pull-refresh-scrim";
    scrim.setAttribute("aria-hidden", "true");
    document.body.appendChild(scrim);
    indicator = document.createElement("div");
    indicator.id = "pull-refresh-indicator";
    indicator.setAttribute("aria-hidden", "true");
    indicator.innerHTML =
      '<svg class="ptr-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M21 12a9 9 0 1 1-2.64-6.36"/>' +
      '</svg>';
    document.body.appendChild(indicator);
    return indicator;
  }

  function setVisual(d) {
    const ind = ensureIndicator();
    const dropped = Math.min(d, PULL_MAX_PX);
    const progress = Math.min(d / PULL_THRESHOLD_PX, 1);
    // Force transition off during finger drag so motion tracks 1:1. Without
    // this, a lingering ease curve from a previous resetVisual would make the
    // indicator slide rather than follow the finger.
    ind.style.transition = "none";
    ind.style.transform = `translateX(-50%) translateY(${dropped}px)`;
    ind.style.opacity = String(progress);
    const rot = progress * 270;
    const icon = ind.querySelector(".ptr-icon");
    if (icon) /** @type {SVGElement} */ (icon).style.transform = `rotate(${rot}deg)`;
  }

  function resetVisual(animated) {
    const ind = ensureIndicator();
    // Cancel any pending cleanup from a previous reset so a fast second pull
    // doesn't have its `ptr-loading` class stripped (or its transition string
    // overwritten) by a stale timer.
    if (resetCleanupTimer !== null) {
      clearTimeout(resetCleanupTimer);
      resetCleanupTimer = null;
    }
    const smooth = animated && !prefersReducedMotion();
    ind.style.transition = smooth ? "transform .25s ease, opacity .2s ease" : "none";
    ind.style.transform = "translateX(-50%) translateY(0)";
    ind.style.opacity = "0";
    if (scrim) scrim.classList.remove("ptr-scrim-visible");
    if (smooth) {
      resetCleanupTimer = setTimeout(() => {
        resetCleanupTimer = null;
        ind.style.transition = "none";
        ind.classList.remove("ptr-loading");
      }, 260);
    } else {
      ind.classList.remove("ptr-loading");
    }
  }

  function eligibleAt(target) {
    if (syncing) return false;
    if (!window.matchMedia("(max-width: 768px)").matches) return false;
    if (window.scrollY > 0) return false;
    if (target instanceof Element && target.closest(MODAL_SELECTORS)) return false;
    return true;
  }

  function onMove(e) {
    if (!active || e.touches.length !== 1) return;
    const raw = e.touches[0].clientY - startY;
    if (raw <= 0) {
      // User reversed direction — let normal scroll resume.
      active = false;
      delta = 0;
      detachMoveEnd();
      resetVisual(true);
      return;
    }
    delta = raw * PULL_RESISTANCE;
    setVisual(delta);
    if (e.cancelable) e.preventDefault();
  }

  function onEnd() {
    if (!active) return;
    const triggered = delta >= PULL_THRESHOLD_PX;
    active = false;
    detachMoveEnd();
    if (triggered) trigger(); else resetVisual(true);
  }

  function onCancel() {
    if (!active) return;
    active = false;
    detachMoveEnd();
    resetVisual(true);
  }

  function attachMoveEnd() {
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onCancel, { passive: true });
  }

  function detachMoveEnd() {
    document.removeEventListener("touchmove", onMove, /** @type {any} */ ({ passive: false }));
    document.removeEventListener("touchend", onEnd);
    document.removeEventListener("touchcancel", onCancel);
  }

  function trigger() {
    syncing = true;
    const ind = ensureIndicator();
    // Cancel any pending resetVisual cleanup so it doesn't fire mid-spinner
    // and strip the `ptr-loading` class we just added.
    if (resetCleanupTimer !== null) {
      clearTimeout(resetCleanupTimer);
      resetCleanupTimer = null;
    }
    ind.classList.add("ptr-loading");
    if (scrim) scrim.classList.add("ptr-scrim-visible");
    ind.style.transition = prefersReducedMotion() ? "none" : "transform .2s ease";
    ind.style.transform = `translateX(-50%) translateY(${PULL_THRESHOLD_PX}px)`;
    ind.style.opacity = "1";
    const sync = window.driveSync;
    if (sync?.isAuthenticated?.()) {
      sync.requestSync();
    } else if (sync?.isEnabled?.()) {
      window._showSyncSnackbar?.("Google Drive 재연결이 필요합니다.");
    } else {
      window._showSyncSnackbar?.("Google Drive 동기화가 꺼져 있습니다.");
    }
    setTimeout(() => {
      syncing = false;
      resetVisual(true);
    }, SYNC_FEEDBACK_MS);
  }

  document.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    if (!eligibleAt(e.target)) return;
    active = true;
    delta = 0;
    startY = e.touches[0].clientY;
    attachMoveEnd();
  }, { passive: true });
})();

// ── Data fetching ──
// ── BEGIN DATA_FETCHING ──
// Exercised by tests/unit/views-routing.test.js. The 4 functions are
// fetch wrappers with caching: loadBooks/loadVersion update module state
// (booksCache/appVersion); loadChapter/loadPrologue are pure pass-throughs.
// Test loader provides `fetch` stub + booksCache/appVersion state in prelude.

/** @returns {Promise<BooksData>} */
async function loadBooks() {
  if (booksCache) return booksCache;
  // Use pre-fetched promise if available
  const promise = window.booksPromise || fetch(`${DATA_DIR}/books.json`).then((res) => {
    if (!res.ok) throw new Error("Failed to load books.json");
    return res.json();
  });
  const data = await promise;
  booksCache = data;
  return data;
}

/** @returns {Promise<string>} */
async function loadVersion() {
  if (appVersion) return appVersion;
  try {
    const res = await fetch("/version.json");
    const data = await res.json();
    appVersion = data.version;
  } catch {
    appVersion = "";
  }
  // Mirror to window so settings-ui.js can read it (ADR-018 Phase 3).
  // Will move into js/app/data-fetching.js (Phase 7) along with loadVersion.
  window.appVersion = appVersion;
  return appVersion ?? "";
}

/**
 * @param {string} bookId
 * @param {number} chapter
 * @returns {Promise<BibleChapter>}
 */
async function loadChapter(bookId, chapter) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-${chapter}.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-${chapter}.json`);
  return res.json();
}

/** @param {string} bookId @returns {Promise<BiblePrologue>} */
async function loadPrologue(bookId) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-prologue.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-prologue.json`);
  return res.json();
}
// ── END DATA_FETCHING ──

// ── Rendering helpers ──

// ── BEGIN TITLE ──
// Exercised by tests/unit/views-routing.test.js with a tiny $title stub
// + el / clearNode / announce shims provided by the loader prelude.
/**
 * @param {string} text  full (canonical) title text
 * @param {string} [mobileText]  shortened variant to swap to when the full
 *   text would overflow `#page-title` (back/bookmark buttons reserve space
 *   on either side). Omit to render plain text only.
 */
function setTitle(text, mobileText) {
  clearNode($title);
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
  announce(text);
  if (mobileText && mobileText !== text) {
    // Canonical name stays the accessible name; both visible spans are
    // aria-hidden so AT speaks aria-label regardless of which is shown.
    $title.setAttribute("aria-label", text);
    $title.appendChild(el("span", { className: "title-text-full", "aria-hidden": "true" }, text));
    $title.appendChild(el("span", { className: "title-text-mobile", "aria-hidden": "true" }, mobileText));
    applyTitleCompactness();
  } else {
    $title.removeAttribute("aria-label");
    $title.classList.remove("compact");
    $title.appendChild(document.createTextNode(text));
  }
}
// ── END TITLE ──

// ── BEGIN POPOVER ──
// Exercised by tests/unit/views-routing.test.js. setTitleWithChapterPicker
// renders a button that toggles a popover (focus trap inside,
// click-outside-to-close, click-on-link-to-close).
/**
 * @param {BookEntry} book
 * @param {number} currentCh
 */
function setTitleWithChapterPicker(book, currentCh) {
  clearNode($title);
  $title.removeAttribute("aria-label");
  $title.classList.remove("compact");
  const unit = chUnit(book.id);
  const fullText = `${book.name_ko} ${currentCh}${unit}`;
  const mobileBookName = NT_MOBILE_NAME[book.id];
  const mobileText = mobileBookName ? `${mobileBookName} ${currentCh}${unit}` : null;
  document.title = `${fullText} — 공동번역성서`;
  announce(fullText);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": `${unit} 선택`, "aria-expanded": "false" }
  );
  if (mobileText) {
    btn.appendChild(el("span", { className: "title-text-full", "aria-hidden": "true" }, fullText));
    btn.appendChild(el("span", { className: "title-text-mobile", "aria-hidden": "true" }, mobileText));
  } else {
    btn.appendChild(document.createTextNode(fullText));
  }

  const popover = el("div", { className: "chapter-popover", role: "listbox", "aria-label": `${unit} 선택` });
  popover.hidden = true;

  const grid = el("div", { className: "popover-grid" });
  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "popover-item popover-prologue", href: `/${book.id}/prologue` }, "머리말")
    );
  }
  for (let i = 1; i <= book.chapter_count; i++) {
    const isCurrent = i === currentCh;
    const item = el("a", { className: isCurrent ? "popover-item current" : "popover-item", href: `/${book.id}/${i}` }, String(i));
    if (isCurrent) item.setAttribute("aria-current", "true");
    grid.appendChild(item);
  }
  popover.appendChild(grid);

  /** @type {(() => void) | null} */
  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      // Land on the currently-open chapter (falling back to the first link, e.g.
      // when arriving from the prologue). preventScroll keeps the browser from
      // jumping the element to the viewport edge; we then center it within the
      // popover's own scroll box — popover is position:absolute, so children's
      // offsetTop is relative to it and the page never moves.
      const current = /** @type {HTMLElement | null} */ (popover.querySelector(".popover-item.current"));
      const target = current || /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (target) target.focus({ preventScroll: true });
      if (current) {
        popover.scrollTop = current.offsetTop - (popover.clientHeight - current.offsetHeight) / 2;
      }
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    // Close on any click outside the title row, OR on the settings gear — the
    // mobile settings trigger lives *inside* $title, so without the second
    // clause the chapter popover would stay open behind the settings popover
    // (two popovers visible at once).
    const outsideTitle = t instanceof Node && !$title.contains(t);
    const onSettingsBtn = t instanceof Element && !!t.closest(".title-settings-btn");
    if (!popover.hidden && (outsideTitle || onSettingsBtn)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  popover.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  $title.appendChild(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로"));
  $title.appendChild(btn);
  $title.appendChild(popover);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, currentCh));
  if (mobileText) {
    $title.setAttribute("aria-label", fullText);
    applyTitleCompactness();
  }
}
// ── END POPOVER ──

// ── BEGIN DIVISION ──
// Exercised by tests/unit/views-routing.test.js. Pure: loadBookOrder() is
// the only side-effect (provided as a stub by the loader prelude).
const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "외경",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

const VULGATE_DIVISION_LABELS = {
  old_testament: "구약",
  new_testament: "신약",
};

const VULGATE_DIVISION_ORDER = ["old_testament", "new_testament"];

// Returns the appropriate labels/order for the current book-order setting
function divisionLabels() {
  return loadBookOrder() === "vulgate" ? VULGATE_DIVISION_LABELS : DIVISION_LABELS;
}
function divisionOrder() {
  return loadBookOrder() === "vulgate" ? VULGATE_DIVISION_ORDER : DIVISION_ORDER;
}

// In vulgate mode, deuterocanon books are grouped under old_testament
function effectiveDivision(book) {
  if (loadBookOrder() === "vulgate" && book.division === "deuterocanon") return "old_testament";
  return book.division;
}
// ── END DIVISION ──

// ── BEGIN DIVISION_TABS ──
// Exercised by tests/unit/views-routing.test.js. The book-list page is a
// single tabbed view (구약 / 외경 / 신약); the tab set follows the active
// book-order setting (vulgate drops the 외경 tab). Tabs are anchors to the
// per-division routes (/old_testament etc.) so deep links, the back button,
// and SEO indexing (ADR-009) keep working. CSS flexes them to fill the row.
// Active-tab index of the most recent render, so the sliding indicator can
// animate from the previously selected tab to the new one across re-renders
// (each tab click is a full route change that rebuilds the nav).
let _prevDivisionIdx = null;

function buildDivisionTabs(activeDivision) {
  const labels = divisionLabels();
  const order = divisionOrder();
  const activeIdx = Math.max(0, order.indexOf(activeDivision));
  // Slide from the previous selection when one exists and differs; otherwise
  // render the indicator already under the active tab (no animation).
  const startIdx = _prevDivisionIdx != null && _prevDivisionIdx !== activeIdx && _prevDivisionIdx < order.length
    ? _prevDivisionIdx
    : activeIdx;
  const nav = el("nav", { className: "division-tabs", "aria-label": "구분" });
  // Style is applied via the CSSOM (.style), not a `style` attribute: the app's
  // CSP has no 'unsafe-inline' for style-src, so style attributes are blocked —
  // but programmatic .style assignments are always allowed.
  nav.style.setProperty("--tab-count", String(order.length));
  // The sliding accent-outlined box that marks the active tab. The transform is
  // set directly (not via a custom property) so `transition: transform` has a
  // proper before/after value to interpolate.
  const indicator = el("div", { className: "division-tab-indicator", "aria-hidden": "true" });
  indicator.style.transform = `translateX(${startIdx * 100}%)`;
  nav.appendChild(indicator);
  for (const div of order) {
    const isActive = div === activeDivision;
    const a = el("a", { className: isActive ? "division-tab active" : "division-tab", href: `/${div}` }, labels[div]);
    if (isActive) a.setAttribute("aria-current", "page");
    nav.appendChild(a);
  }
  // Browser-only: slide from the previously-active tab (startIdx, set inline
  // above) to the new one. Double rAF so the indicator is painted at startIdx in
  // the first frame, then moved in the next — giving `transition: transform` a
  // committed before/after pair to interpolate (a single frame can coalesce both
  // into one paint and skip the animation). Guarded so the unit-test vm harness
  // (no requestAnimationFrame) is unaffected.
  if (startIdx !== activeIdx && typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        indicator.style.transform = `translateX(${activeIdx * 100}%)`;
      });
    });
  }
  _prevDivisionIdx = activeIdx;
  return nav;
}
// ── END DIVISION_TABS ──

// ── BEGIN BOOK_LIST_LINK ──
// Book-list buttons (/, /old_testament, /new_testament, /deuterocanon) show
// `name_ko` by default. NT names are long enough that buttons can wrap to two
// lines, especially on narrow viewports or with enlarged text. For NT books we
// also emit a shortened name and let CSS swap to it on touch devices, or JS
// swap to it (.compact class) when the full name would wrap inside the button.
// 복음서 4권은 "~의 복음서" 접미사를 떼어 표시(마태오/마르코/루가/요한). 사도행전은
// 명칭 변경 없음.
const NT_MOBILE_NAME = {
  matt:   "마태오",
  mark:   "마르코",
  luke:   "루가",
  john:   "요한",
  rom:    "로마서",
  "1cor": "1고린토",
  "2cor": "2고린토",
  gal:    "갈라디아",
  eph:    "에페소",
  phil:   "필립비",
  col:    "골로사이",
  "1thess": "1데살로니카",
  "2thess": "2데살로니카",
  "1tim": "1디모테오",
  "2tim": "2디모테오",
  titus:  "디도서",
  phlm:   "필레몬서",
  heb:    "히브리서",
  jas:    "야고보서",
  "1pet": "1베드로",
  "2pet": "2베드로",
  "1john": "요한1서",
  "2john": "요한2서",
  "3john": "요한3서",
  jude:   "유다서",
  rev:    "요한묵시록",
};

// Returns the `<li>` for a book-list entry. When a NT mobile-shortened name
// exists, emits two spans (.book-name-full / .book-name-mobile) and sets the
// anchor's aria-label to the canonical name so screen readers always speak
// the formal title regardless of which span is visually shown.
function buildBookListItem(b) {
  const mobile = NT_MOBILE_NAME[b.id];
  if (!mobile) {
    return el("li", null, el("a", { href: `/${b.id}` }, b.name_ko));
  }
  const a = el("a", { href: `/${b.id}`, "aria-label": b.name_ko });
  a.appendChild(el("span", { className: "book-name-full" }, b.name_ko));
  a.appendChild(el("span", { className: "book-name-mobile" }, mobile));
  return el("li", null, a);
}

// Compactness fallback: on devices where the touch-device media query does
// not apply (desktop/laptop), the full NT name may still wrap when the user
// enlarges text (browser zoom, OS-level scaling, or the app's font-size
// setting). For each book-list anchor with a mobile-shortened span, measure
// the single-line natural width of `.book-name-full`; if it exceeds the
// anchor's available inner width, add the `.compact` class so CSS swaps to
// the shortened name. Re-runs on container resize via ResizeObserver, which
// also fires when root font-size changes (since item heights reflow).
/** @type {ResizeObserver | null} */
let _bookListResizeObs = null;
/** @type {Map<Element, ReturnType<typeof setTimeout>>} */
const _bookListDebounce = new Map();

function _getBookListResizeObserver() {
  if (_bookListResizeObs) return _bookListResizeObs;
  _bookListResizeObs = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const ul = entry.target;
      const prev = _bookListDebounce.get(ul);
      if (prev) clearTimeout(prev);
      _bookListDebounce.set(ul, setTimeout(() => {
        _bookListDebounce.delete(ul);
        if (ul.isConnected) applyBookListCompactness(/** @type {HTMLElement} */ (ul));
      }, 50));
    }
  });
  return _bookListResizeObs;
}

/** @param {HTMLElement} ul */
function applyBookListCompactness(ul) {
  const anchors = /** @type {NodeListOf<HTMLAnchorElement>} */ (
    ul.querySelectorAll("a")
  );
  for (const a of anchors) {
    const full = /** @type {HTMLElement | null} */ (a.querySelector(".book-name-full"));
    const mobile = a.querySelector(".book-name-mobile");
    if (!full || !mobile) continue;

    // Reset to measure the natural (non-compact) state.
    a.classList.remove("compact");

    const prevWs = full.style.whiteSpace;
    const prevDisplay = full.style.display;
    full.style.whiteSpace = "nowrap";
    full.style.display = "inline-block";
    const naturalWidth = full.offsetWidth;
    full.style.whiteSpace = prevWs;
    full.style.display = prevDisplay;

    const cs = getComputedStyle(a);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const availableWidth = a.clientWidth - padL - padR;

    if (naturalWidth > availableWidth + 0.5) {
      a.classList.add("compact");
    }
  }
}

/** @param {ParentNode} root */
function observeBookListsIn(root) {
  const lists = root.querySelectorAll(".book-list");
  const obs = _getBookListResizeObserver();
  for (const ul of lists) {
    applyBookListCompactness(/** @type {HTMLElement} */ (ul));
    obs.observe(ul);
  }
}

// Same idea as book-list compactness, but for the page-title header.
// `setTitle` / `setTitleWithChapterPicker` emit .title-text-full and
// .title-text-mobile spans when an NT mobile-shortened variant exists; this
// function measures whether the full text would overflow the room remaining
// in #page-title once the absolute-positioned back and bookmark buttons
// (~2.2rem each + breathing) are reserved. ResizeObserver on $title keeps
// the choice fresh across viewport resizes and root font-size changes.
/** @type {ResizeObserver | null} */
let _titleResizeObs = null;

function applyTitleCompactness() {
  // Lazy ResizeObserver setup on first call: keeps the title decision fresh
  // across viewport resize and root font-size changes without coupling to
  // the bootstrap path. (Tests load this module via vm with no $title — the
  // function early-returns there and the observer is never created.)
  if (!_titleResizeObs && typeof ResizeObserver !== "undefined" && $title) {
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    _titleResizeObs = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; applyTitleCompactness(); }, 50);
    });
    _titleResizeObs.observe($title);
  }

  // Defer the actual measurement to the next frame. Several render paths append
  // the settings gear *after* calling setTitle/setTitleWithChapterPicker, and on
  // mobile that gear is part of the right-side reservation — measuring before
  // it lands would undercount the reserved space. rAF also lets layout and web
  // fonts settle so offsetWidth reflects the final rendered title.
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(measureTitleCompactness);
  } else {
    measureTitleCompactness();
  }
}

function measureTitleCompactness() {
  if (!$title) return;
  const full = /** @type {HTMLElement | null} */ ($title.querySelector(".title-text-full"));
  const mobile = $title.querySelector(".title-text-mobile");
  if (!full || !mobile) {
    $title.classList.remove("compact");
    return;
  }
  const container = full.parentElement;
  if (!container) return;

  // Reset so measurement reflects the non-compact (full) layout.
  $title.classList.remove("compact");

  const prevWs = full.style.whiteSpace;
  const prevDisplay = full.style.display;
  full.style.whiteSpace = "nowrap";
  full.style.display = "inline-block";
  const naturalWidth = full.offsetWidth;
  full.style.whiteSpace = prevWs;
  full.style.display = prevDisplay;

  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  // The title text is centered (text-align: center) while the home / bookmark /
  // settings buttons are absolute-positioned at the edges. A centered string
  // overruns whichever side reaches furthest inward, symmetrically — so the room
  // for the text is clientWidth − 2 × (largest side reservation). Measure the
  // real buttons from the live DOM rather than hardcoding, because the layout
  // differs by breakpoint: on desktop the bookmark sits flush right (right: 0)
  // and the settings gear lives in the top row (absent here); on mobile the
  // settings gear is minted into this row at right: 0 and the bookmark is inset
  // to right: 2.4rem, so the right side reserves ~4.6rem, not 2.2rem. The old
  // fixed 5.2rem matched only the desktop layout, leaving mobile titles to
  // collide with the bookmark/gear.
  //
  // Use getBoundingClientRect, not getComputedStyle left/right: for an
  // abs-positioned element the browser resolves *both* insets to used pixels
  // even when only one was authored, so a left-anchored button would report a
  // right inset of ~full width and bogusly inflate the opposite side. Geometry
  // sidesteps that — classify each button by whichever container edge it sits
  // closer to, then take only that side's inward intrusion.
  const titleRect = $title.getBoundingClientRect();
  let leftReserve = 0;
  let rightReserve = 0;
  for (const b of $title.querySelectorAll(".title-back-btn, .title-bookmark-btn, .title-settings-btn")) {
    const r = b.getBoundingClientRect();
    if (r.width === 0) continue; // hidden at this breakpoint (e.g. desktop gear)
    if (r.left - titleRect.left <= titleRect.right - r.right) {
      leftReserve = Math.max(leftReserve, r.right - titleRect.left);
    } else {
      rightReserve = Math.max(rightReserve, titleRect.right - r.left);
    }
  }
  const breathing = 0.8 * rem;
  const sideReserve = Math.max(leftReserve, rightReserve) + breathing;
  // Picker button has a ~0.4em chevron after the label — allow for it.
  const chevronAllowance = container.classList.contains("title-picker-btn") ? 0.8 * rem : 0;
  const availableWidth = $title.clientWidth - 2 * sideReserve;

  if (naturalWidth + chevronAllowance > availableWidth + 0.5) {
    $title.classList.add("compact");
  }
}
// ── END BOOK_LIST_LINK ──

// ── Compact Header on Scroll ──
// Deferred: not needed until after first render and first scroll.

// ── BEGIN COMPACT_HEADER ──
// Exercised by tests/unit/views-routing.test.js. Hysteretic toggle:
// scrolling past 60px adds .compact to #app-header; only when returning
// near the top (<10px) do we remove it. Listener is passive — no
// preventDefault — so it cannot block scrolling.
function initCompactHeader() {
  const header = _$("app-header");
  const THRESHOLD_ON = 60;   // collapse breadcrumb when scrolling down past this
  const THRESHOLD_OFF = 10;  // restore breadcrumb only when near the very top
  let isCompact = false;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (!isCompact && y > THRESHOLD_ON) {
      isCompact = true;
      header.classList.add("compact");
    } else if (isCompact && y < THRESHOLD_OFF) {
      isCompact = false;
      header.classList.remove("compact");
    }
  }, { passive: true });
}
// ── END COMPACT_HEADER ──

// ── BEGIN SCROLL_ELEVATION ──
// ADR-025: toggle `.scrolled` on #sticky-group based on whether the
// zero-height #scroll-sentinel at the top of <body> is in the viewport.
// IntersectionObserver fires only on visibility flips (cheaper than a
// scroll listener + throttle) and route() resets to scroll-top, which
// naturally puts the sentinel back in view → `.scrolled` clears on its own.
function initScrollElevation() {
  const sentinel = document.getElementById("scroll-sentinel");
  const stickyGroup = _$("sticky-group");
  if (!sentinel || typeof IntersectionObserver === "undefined") return;
  const obs = new IntersectionObserver(([entry]) => {
    stickyGroup.classList.toggle("scrolled", !entry.isIntersecting);
  });
  obs.observe(sentinel);
}
// ── END SCROLL_ELEVATION ──


// ── Phase 7b additions ──
// Views (renderBookList / renderChapter / renderPrologue / etc.),
// Routing (parsePath / route / navigate + popstate listener),
// Audio Player. State vars + startScrollTracking from former app.js
// Reading position section also live here since they are Routing-internal.

// Audio Player module state (was app.js L112-L116).
let currentAudio = null;
/** @type {AbortController | null} */
let _audioController = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _audioSaveTimer = null;
let _scrollTrackCleanup = null;
let _isInitialLoad = true;
// ADR-031: route() 호출마다 증가. 리다이렉트(books→resume 등)로 route 가 재진입하면
// 바깥 호출의 finally(onRouteEnd 스크롤 복원)가 이미 낡았음을 알도록 시퀀스로 가드한다.
let _routeSeq = 0;
function startScrollTracking(bookId, chapter) {
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const handler = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const verses = document.querySelectorAll(".verse[data-vref]");
      /** @type {number | null} */
      let currentVerse = null;
      for (const v of verses) {
        const n = parseInt(v.getAttribute("data-vref") ?? "", 10);
        if (!Number.isFinite(n)) continue;
        const top = v.getBoundingClientRect().top;
        if (top <= 80) {
          currentVerse = n;
        } else {
          break;
        }
      }
      if (currentVerse !== null) saveReadingPosition(bookId, chapter, currentVerse);
    }, 500);
  };
  window.addEventListener("scroll", handler, { passive: true });
  _scrollTrackCleanup = () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("scroll", handler);
    _scrollTrackCleanup = null;
  };
}

// ── Views ──

// The unified book-list page. The first page (/) and the per-division routes
// (/old_testament · /deuterocanon · /new_testament) all render here, differing
// only by which tab is active — replacing the former separate landing +
// division pages. `activeDivision` falls back to the first tab when missing or
// invalid (e.g. /deuterocanon while in vulgate mode, which the router also
// redirects to /old_testament).
function renderBookList(books, activeDivision) {
  const labels = divisionLabels();
  const order = divisionOrder();
  const active = order.includes(activeDivision) ? activeDivision : order[0];

  setTitle("공동번역성서");
  $title.appendChild(buildBookmarkHeaderBtn(null, null));
  $title.appendChild(buildSettingsTrigger());
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  // Tabs live in the sticky group (after the resume banner) so they stay pinned
  // below the header — and below the banner whenever one is shown. route()
  // clears this slot on every navigation.
  clearNode($divisionTabsSlot);
  $divisionTabsSlot.appendChild(buildDivisionTabs(active));

  const panel = el("div", { className: "division-panel", role: "region", "aria-label": labels[active] });
  const list = books.filter((b) => effectiveDivision(b) === active);

  // Flat list for every division — OT is no longer split into 오경/역사서/etc.
  // subcategories, so all three tabs share one consistent layout.
  const ul = el("ul", { className: "book-list", role: "list" });
  for (const b of list) {
    ul.appendChild(buildBookListItem(b));
  }
  panel.appendChild(ul);
  $app.appendChild(panel);
  observeBookListsIn($app);
}

// `clearReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

function renderResumeBanner(books) {
  const pos = loadReadingPosition();
  if (!pos) return;
  const lastBook = books.find((b) => b.id === pos.bookId);
  if (!lastBook) return;
  const isPrologue = pos.chapter === "prologue";
  const href = `/${pos.bookId}/${pos.chapter}?resume=1`;
  const suffix = isPrologue ? "머리말" : `${pos.chapter}${chUnit(lastBook.id)}`;
  const fullLabel = `이어읽기: ${lastBook.name_ko} ${suffix}`;
  const mobileBookName = NT_MOBILE_NAME[lastBook.id];
  const mobileLabel = mobileBookName ? `이어읽기: ${mobileBookName} ${suffix}` : null;

  const wrapper = el("div", { className: "resume-banner" });
  const link = el("a", { className: "resume-banner-link", href });
  if (mobileLabel) {
    link.setAttribute("aria-label", fullLabel);
    link.appendChild(el("span", { className: "resume-text-full", "aria-hidden": "true" }, fullLabel));
    link.appendChild(el("span", { className: "resume-text-mobile", "aria-hidden": "true" }, mobileLabel));
  } else {
    link.textContent = fullLabel;
  }
  wrapper.appendChild(link);

  const closeBtn = el("button", {
    className: "resume-banner-close",
    type: "button",
    "aria-label": "이어읽기 기록 삭제",
  }, "\u00d7");
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    clearReadingPosition();
    wrapper.remove();
  });
  wrapper.appendChild(closeBtn);

  clearNode($resumeBannerSlot);
  $resumeBannerSlot.appendChild(wrapper);
  if (mobileLabel) {
    applyResumeBannerCompactness(wrapper);
    _observeResumeBanner(wrapper);
  }
}

// Resume banner compactness — same measurement idea as book-list / title.
// Banner is a flex row: .resume-banner-link (flex:1) + .resume-banner-close
// (2.2rem). When the full text natural width exceeds the link's available
// inner width, swap to the mobile-shortened label.
/** @type {ResizeObserver | null} */
let _resumeBannerObs = null;

/** @param {HTMLElement} wrapper */
function applyResumeBannerCompactness(wrapper) {
  const link = /** @type {HTMLElement | null} */ (wrapper.querySelector(".resume-banner-link"));
  const full = /** @type {HTMLElement | null} */ (wrapper.querySelector(".resume-text-full"));
  const mobile = wrapper.querySelector(".resume-text-mobile");
  if (!link || !full || !mobile) {
    wrapper.classList.remove("compact");
    return;
  }
  wrapper.classList.remove("compact");

  const prevWs = full.style.whiteSpace;
  const prevDisplay = full.style.display;
  full.style.whiteSpace = "nowrap";
  full.style.display = "inline-block";
  const naturalWidth = full.offsetWidth;
  full.style.whiteSpace = prevWs;
  full.style.display = prevDisplay;

  const cs = getComputedStyle(link);
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const availableWidth = link.clientWidth - padL - padR;

  if (naturalWidth > availableWidth + 0.5) {
    wrapper.classList.add("compact");
  }
}

/** @param {HTMLElement} wrapper */
function _observeResumeBanner(wrapper) {
  if (typeof ResizeObserver === "undefined") return;
  if (!_resumeBannerObs) {
    /** @type {Map<Element, ReturnType<typeof setTimeout>>} */
    const debounce = new Map();
    _resumeBannerObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target;
        const prev = debounce.get(target);
        if (prev) clearTimeout(prev);
        debounce.set(target, setTimeout(() => {
          debounce.delete(target);
          if (target.isConnected) applyResumeBannerCompactness(/** @type {HTMLElement} */ (target));
        }, 50));
      }
    });
  }
  _resumeBannerObs.observe(wrapper);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko, NT_MOBILE_NAME[book.id]);
  $title.insertBefore(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로"), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, null));
  $title.appendChild(buildSettingsTrigger());
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  const grid = el("div", { className: "chapter-grid" });

  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "prologue-link", href: `/${book.id}/prologue` }, "머리말")
    );
  }

  for (let i = 1; i <= book.chapter_count; i++) {
    grid.appendChild(
      el("a", { href: `/${book.id}/${i}`, "aria-label": `${book.name_ko} ${i}${chUnit(book.id)}` }, String(i))
    );
  }

  $app.appendChild(grid);
}

// ── BEGIN VERSE_NUMBER ──
// Exercised by tests/unit/views-routing.test.js. Pure: derives the displayed
// verse label/number from a verse object — no DOM, no global state.

function formatVerseLabel(v) {
  let label = String(v.number);
  if (v.part) label += v.part;
  if (v.range_end) label += `-${v.range_end}`;
  return label;
}

// Display string for the verse-number marker (rendered via CSS ::before).
// LXX-only verses ([_N]) show the LXX number in parens; dual-numbered verses
// ([N_M]) append the LXX number in parens; cross-chapter refs prefix the
// original chapter number.
function formatVerseNumber(v) {
  const label = formatVerseLabel(v);
  if (v.lxx_only) return `(${label})`;
  let dataV = v.chapter_ref ? `${v.chapter_ref}:${label}` : label;
  if (v.alt_ref != null) dataV += `(${v.alt_ref})`;
  return dataV;
}
// ── END VERSE_NUMBER ──

// ── BEGIN VERSE_SELECTION ──
// Exercised by tests/unit/views-routing.test.js. DOM-pure: reads classList +
// data-vref from a passed article node, no global state, no event bindings.

// Pure-poetry multi-part verses (e.g. Psalms, Proverbs, Wisdom books) are
// treated as a single selection unit: tapping one line selects/deselects the
// whole verse. Prose-only or mixed (poetry+prose) multi-part verses, plus
// single-span verses, keep per-line control.
//
// Returns the array of data-vref values that should be toggled together with
// `vref`. For pure-poetry multi-part verses this is every part of the verse
// number; otherwise just [vref].
/**
 * @param {ParentNode | null | undefined} article
 * @param {string} vref
 * @returns {string[]}
 */
function _verseSelectionUnit(article, vref) {
  if (!article) return [vref];
  const m = vref.match(/^(\d+)/);
  const num = m ? m[1] : vref;
  /** @type {Element[]} */
  const parts = [];
  for (const v of article.querySelectorAll(".verse[data-vref]")) {
    const r = v.getAttribute("data-vref") ?? "";
    const rm = r.match(/^(\d+)/);
    if ((rm ? rm[1] : r) === num) parts.push(v);
  }
  if (parts.length > 1 && parts.every((p) => p.classList.contains("verse-poetry"))) {
    return parts.map((p) => p.getAttribute("data-vref") ?? "");
  }
  return [vref];
}
// ── END VERSE_SELECTION ──

function renderChapter(data, book, opts) {
  const ch = data.chapter;
  const hlQuery = opts && opts.highlightQuery;
  const hlVerse = opts && opts.highlightVerse;
  let hlVerseEnd = opts && opts.highlightVerseEnd;
  const hlVerseSpec = opts && opts.highlightVerseSpec;
  let hlSegments = hlVerseSpec ? parseVerseSpec(hlVerseSpec) : null;

  // Compute max verse number once; used by both clipping paths below.
  let _maxVerse = 0;
  for (const v of data.verses) {
    const vn = v.range_end != null ? v.range_end : v.number;
    if (vn > _maxVerse) _maxVerse = vn;
  }

  // ── Single simple range: clip hlVerseEnd to chapter max ──
  // e.g. "창세 3:1-100" → "창세 3:1-24"
  if (hlVerseEnd && !hlSegments) {
    if (hlVerseEnd > _maxVerse) {
      hlVerseEnd = _maxVerse;
      const pathMatch = location.pathname.match(/^(\/[^/]+\/\d+\/\d+)-\d+$/);
      if (pathMatch) {
        history.replaceState(null, "", `${pathMatch[1]}-${_maxVerse}${location.search}`);
      }
    }
  }
  // Drop a single verse that is entirely out of range (works for both simple and range URLs).
  if (!hlSegments && hlVerse > _maxVerse) {
    const pathMatch = location.pathname.match(/^(\/[^/]+\/\d+)\/\d+.*$/);
    if (pathMatch) history.replaceState(null, "", pathMatch[1] + location.search);
  }

  // ── Multi-segment: clamp integer segments to chapter max; drop out-of-range.
  // Alpha-part segments (e.g. {start:3,end:3,part:"a"}) are kept as-is since
  // they don't extend beyond a single verse.
  if (hlSegments) {
    const clamped = hlSegments
      .map(s => s.part ? s : { start: s.start, end: Math.min(s.end, _maxVerse) })
      .filter(s => s.start <= _maxVerse);
    const pathBase = location.pathname.match(/^(\/[^/]+\/\d+)/)?.[1];
    if (clamped.length === 0) {
      hlSegments = null;
      if (pathBase) history.replaceState(null, "", pathBase + location.search);
    } else {
      const serializeSeg = s => s.part ? `${s.start}${s.part}` : s.start === s.end ? `${s.start}` : `${s.start}-${s.end}`;
      const newSpec = clamped.map(serializeSeg).join(",");
      const needsRewrite = newSpec !== hlSegments.map(serializeSeg).join(",");
      hlSegments = clamped;
      if (needsRewrite && pathBase) {
        history.replaceState(null, "", `${pathBase}/${newSpec}${location.search}`);
      }
    }
  }

  setTitleWithChapterPicker(book, ch);
  // setTitleWithChapterPicker already prepends the home button; add the mobile
  // settings trigger alongside the bookmark button it appended.
  $title.appendChild(buildSettingsTrigger());
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 괄호 안 번호는 70인역 사본(그리스어)의 절 번호입니다.")
    );
  }

  const article = el("article", { className: "chapter-text", lang: "ko" });
  let isFirst = true;
  let prevVerseEndType = null;

  // ADR-022: precompute which (verse, segment) cite chips actually render
  // (dedup of consecutive same-cite groups; only LAST in group renders).
  const _citeShowAt = window.appCitations
    ? window.appCitations._computeCiteShowPositions(data.verses)
    : new Set();

  for (let vIdx = 0; vIdx < data.verses.length; vIdx++) {
    const v = data.verses[vIdx];
    const segs = v.segments || [{ type: "prose", text: v.text || "" }];

    // Inter-verse break
    // hemistich-break (no gap): only when both prev and current are poetry (stanza continuation)
    // paragraph-break (gap): prose→poetry transition, or ¶ marker
    const startsWithPoetry = segs[0]?.type === "poetry";
    if (!isFirst) {
      if (v.stanza_break) {
        article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
      } else if (startsWithPoetry && prevVerseEndType === "poetry") {
        article.appendChild(el("span", { className: "hemistich-break", role: "presentation" }));
      } else if (startsWithPoetry || segs[0]?.paragraph_break) {
        article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
      }
    }

    // ADR-027 (개정 2026-05-31): section-level parallel-passage anchor(s) —
    // render a ※ marker right before the verse whose number matches a
    // parallel's range start. Plural — range 중첩 허용 (§2 검증 규칙 개정)
    // 이라 한 절에서 여러 marker 가 시작할 수 있고, 각자 자기 anchor 가
    // 나란히 렌더됨 (각 tooltip 독립). 클릭 시 footnote-style tooltip 이
    // 열리고 본문 안 sourceLink 가 cite-sheet 로 위임. 토글은 `body.cites-shown`.
    if (window.appParallels && data.parallels && data.parallels.length) {
      // Pass chapter so a range whose chapter prefix belongs elsewhere (rare —
      // parser cross-check normally catches it) cannot stray-render here.
      const matched = window.appParallels.findParallelsStartingAt(
        data.parallels, v.number, data.chapter,
      );
      for (const p of matched) {
        article.appendChild(window.appParallels.buildParallelAnchor(p));
      }
    }

    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    // LXX-only verses can share a number with a Hebrew verse in the same
    // chapter (e.g. Daniel 3); suffix keeps the DOM id unique.
    if (v.lxx_only) verseId += "_lxx";
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const vn = v.number;

    // Verse number (rendered via CSS ::before to exclude from clipboard)
    const dataV = formatVerseNumber(v);

    function appendSegText(target, raw, opts) {
      const hasPilcrow = raw.startsWith("¶");
      if (hasPilcrow) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      }
      const textContent = hasPilcrow ? raw.replace(/^¶\s*/, "") : raw;
      // Trailing space normally separates this span from the next inline
      // sibling (verse continuation). When a cite chip will be appended right
      // after this segment, the chip's own padding provides the gap — skip
      // the trailing space to avoid a double-gap (ADR-022 §6 dev-server tweak).
      // Also skip when the segment is punctuation-only (e.g. a stray opening
      // quote split off when a cite begins mid-quote like `'<cite>…</cite>'`):
      // appending a space would force `' 그는…` instead of the intended
      // `'그는…`. Punctuation glues to the next segment in Korean prose.
      const isPunctOnly = /^[\s'"“”‘’«»‹›()…,.;:!?¶·]+$/.test(textContent);
      const suffix = (opts && opts.noTrailingSpace) || isPunctOnly ? "" : " ";
      appendTextWithHighlight(target, textContent + suffix, hlQuery);
    }

    // Count total lines across all segments to determine if multi-part
    const totalLines = segs.reduce((n, s) => n + s.text.split("\n").filter(l => l !== "").length, 0);
    const isMultiPart = totalLines > 1;
    const partLetters = "bcdefghijklmnop";
    let partIdx = 0;
    let isFirstLine = true;
    let prevSegType = null;

    for (let segIdx = 0; segIdx < segs.length; segIdx++) {
      const seg = segs[segIdx];
      const isPoetry = seg.type === "poetry";
      const isSegChange = prevSegType !== null && prevSegType !== seg.type;
      const lines = seg.text.split("\n");

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];

        if (line === "") {
          // Empty line from \n\n = mid-verse stanza break
          article.appendChild(el("span", { className: "stanza-break", role: "presentation" }));
          continue;
        }

        // Break before non-first lines:
        // - explicit paragraph break (¶ or segment-type change) → paragraph-break
        // - poetry continuation → hemistich-break
        // - prose continuation (e.g. ADR-022 cite-split prose) → no break, text flows inline
        if (!isFirstLine) {
          let breakClass = null;
          if ((seg.paragraph_break || isSegChange) && li === 0) {
            breakClass = "paragraph-break";
          } else if (isPoetry) {
            breakClass = "hemistich-break";
          }
          if (breakClass) {
            article.appendChild(el("span", {
              className: breakClass,
              role: "presentation"
            }));
          }
        }

        // Compute vref before classes so per-span highlight can use it.
        let vref;
        if (isFirstLine && !isMultiPart) {
          vref = verseLabel;
        } else if (isFirstLine) {
          vref = `${verseLabel}a`;
        } else {
          vref = `${verseLabel}${partLetters[partIdx]}`;
          partIdx++;
        }

        // Per-span highlight: alpha-part segments match only the specific span;
        // integer-range segments match all spans of that verse.
        const isHighlightedSpan = hlSegments
          ? hlSegments.some(s => s.part ? vref === `${s.start}${s.part}` : (vn >= s.start && vn <= s.end))
          : (hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse));

        let classes = baseClasses;
        if (isPoetry) classes += " verse-poetry";
        if (isHighlightedSpan) classes += " verse-highlight";

        const span = el("span", { className: classes });
        if (isFirstLine) {
          span.id = verseId;
          const sup = el("sup", { className: "verse-num", "aria-hidden": "true", "data-v": dataV });
          span.appendChild(sup);
          span.appendChild(document.createTextNode("\u2060"));
        }

        span.setAttribute("data-vref", vref);
        // Suppress trailing space on the last line of a prose cite segment
        // — the chip that follows immediately provides its own padding gap.
        const segWillShowChip = !!(seg.cite && _citeShowAt.has(`${vIdx}:${segIdx}`));
        const isLastSegLine = li === lines.length - 1;
        const segTextOpts = (!isPoetry && segWillShowChip && isLastSegLine)
          ? { noTrailingSpace: true } : undefined;
        // Hanging punctuation: pull leading quote outside the indent.
        // Single quote is narrower, so it uses a smaller offset (see .hanging-quote--single).
        if (isPoetry && (line[0] === '"' || line[0] === "'")) {
          const cls = line[0] === '"' ? "hanging-quote" : "hanging-quote hanging-quote--single";
          span.appendChild(el("span", { className: cls }, line[0]));
          appendSegText(span, line.slice(1), segTextOpts);
        } else {
          appendSegText(span, line, segTextOpts);
        }
        article.appendChild(span);
        isFirstLine = false;
      }
      // ADR-022: append cite chip after this segment if it carries one and
      // dedup decided this position should render (not suppressed).
      if (seg.cite && window.appCitations && _citeShowAt.has(`${vIdx}:${segIdx}`)) {
        article.appendChild(window.appCitations.buildCiteChip(
          seg.cite, seg.parallels || null, seg.tradition || null, seg.type,
        ));
      }

      prevSegType = seg.type;
    }

    prevVerseEndType = segs[segs.length - 1]?.type;
    isFirst = false;
  }

  // ADR-022: wrap each note anchor in a clickable button — tooltip on click
  // shows the note body (no chapter-end section; ADR §6 개정 2026-05-24).
  if (window.appCitations) {
    window.appCitations.wrapNoteAnchorsInArticle(article, data.verses);
  }

  // Flatten inner corners between adjacent highlighted verses so a run from
  // a search/bookmark deep link renders as a single block.
  {
    const verses = [...article.querySelectorAll(".verse[data-vref]")];
    for (let i = 0; i < verses.length; i++) {
      const v = verses[i];
      if (!v.classList.contains("verse-highlight")) continue;
      if (i > 0 && verses[i - 1].classList.contains("verse-highlight")) {
        v.classList.add("verse-highlight-join-prev");
      }
      if (i < verses.length - 1 && verses[i + 1].classList.contains("verse-highlight")) {
        v.classList.add("verse-highlight-join-next");
      }
    }
  }

  // Track current chapter context for verse selection mode
  readingContext.bookId = book.id;
  readingContext.chapter = ch;

  // Announce verse number on click/tap for screen reader users,
  // or toggle verse selection when in select mode.
  article.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const vs = t.closest(".verse[data-vref]");
    if (!vs) return;
    if (readingContext.verseSelectMode) {
      e.stopPropagation(); // selection is handled by pointer events
      return;
    }
    announce(`${vs.getAttribute("data-vref")}절`);
  });

  // Long-press (300ms) to enter verse selection mode.
  // pointermove only cancels after >10px of movement to tolerate natural finger drift.
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _longPressTimer = null;
  let _longPressStartX = 0;
  let _longPressStartY = 0;

  article.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (readingContext.verseSelectMode) {
      const vs = t.closest(".verse[data-vref]");
      if (!vs) return;
      e.preventDefault(); // prevent text selection during drag
      const allVerses = /** @type {HTMLElement[]} */ ([...article.querySelectorAll(".verse[data-vref]")]);
      const startIdx = allVerses.indexOf(/** @type {HTMLElement} */ (vs));
      const startUnit = _verseSelectionUnit(article, vs.getAttribute("data-vref") ?? "");
      const isAdding = !startUnit.some((r) => readingContext.selectedVerses.has(r));
      readingContext.verseSelectDrag = { startIdx, allVerses, isAdding, moved: false, snapshot: new Set(readingContext.selectedVerses) };
      article.setPointerCapture(e.pointerId);
      return;
    }
    const vs = t.closest(".verse[data-vref]");
    if (!vs) return;
    _longPressStartX = e.clientX;
    _longPressStartY = e.clientY;
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      enterVerseSelectMode(book.id, ch);
      const vref = vs.getAttribute("data-vref");
      if (vref) {
        for (const r of _verseSelectionUnit(article, vref)) {
          readingContext.selectedVerses.add(r);
        }
        article.querySelectorAll(".verse[data-vref]").forEach((v) => {
          v.classList.toggle("verse-selected", readingContext.selectedVerses.has(v.getAttribute("data-vref") ?? ""));
        });
        updateVerseSelectionBoundaries(article);
        updateVerseSelectBar();
      }
    }, 300);
  });
  const cancelLongPress = (e) => {
    if (!_longPressTimer) return;
    if (e && e.type === "pointermove") {
      const dx = e.clientX - _longPressStartX;
      const dy = e.clientY - _longPressStartY;
      if (dx * dx + dy * dy < 100) return; // ignore drift < 10px
    }
    clearTimeout(_longPressTimer);
    _longPressTimer = null;
  };

  article.addEventListener("pointermove", (e) => {
    if (readingContext.verseSelectDrag) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const vs = /** @type {HTMLElement | null} */ (target && target.closest(".verse[data-vref]"));
      if (!vs) return;
      const { startIdx, allVerses, isAdding, snapshot } = readingContext.verseSelectDrag;
      const currentIdx = allVerses.indexOf(vs);
      if (currentIdx === -1) return;
      if (!readingContext.verseSelectDrag.moved && currentIdx === startIdx) return;
      readingContext.verseSelectDrag.moved = true;
      const [lo, hi] = startIdx <= currentIdx ? [startIdx, currentIdx] : [currentIdx, startIdx];
      readingContext.selectedVerses = new Set(snapshot);
      for (let i = lo; i <= hi; i++) {
        const vref = allVerses[i].getAttribute("data-vref") ?? "";
        if (isAdding) readingContext.selectedVerses.add(vref);
        else readingContext.selectedVerses.delete(vref);
      }
      // Pure-poetry verses are atomic: if any part falls in [lo, hi], extend
      // the toggle to all parts of that verse number.
      const seenNums = new Set();
      for (let i = lo; i <= hi; i++) {
        const vref = allVerses[i].getAttribute("data-vref") ?? "";
        const m = vref.match(/^(\d+)/);
        const num = m ? m[1] : vref;
        if (seenNums.has(num)) continue;
        seenNums.add(num);
        const unit = _verseSelectionUnit(article, vref);
        if (unit.length === 1) continue;
        if (isAdding) unit.forEach((r) => readingContext.selectedVerses.add(r));
        else unit.forEach((r) => readingContext.selectedVerses.delete(r));
      }
      allVerses.forEach((v) => {
        const vref = v.getAttribute("data-vref") ?? "";
        v.classList.toggle("verse-selected", readingContext.selectedVerses.has(vref));
      });
      updateVerseSelectionBoundaries(article);
      updateVerseSelectBar();
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointerup", (e) => {
    if (readingContext.verseSelectDrag) {
      if (!readingContext.verseSelectDrag.moved) {
        // Simple tap: toggle the verse's selection unit (whole verse for pure
        // poetry, single line otherwise).
        const vs = readingContext.verseSelectDrag.allVerses[readingContext.verseSelectDrag.startIdx];
        if (vs) {
          const vref = vs.getAttribute("data-vref") ?? "";
          const unit = _verseSelectionUnit(article, vref);
          if (readingContext.verseSelectDrag.isAdding) {
            unit.forEach((r) => readingContext.selectedVerses.add(r));
          } else {
            unit.forEach((r) => readingContext.selectedVerses.delete(r));
          }
          readingContext.verseSelectDrag.allVerses.forEach((v) => {
            v.classList.toggle("verse-selected", readingContext.selectedVerses.has(v.getAttribute("data-vref") ?? ""));
          });
          updateVerseSelectionBoundaries(article);
          updateVerseSelectBar();
        }
      }
      readingContext.verseSelectDrag = null;
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointercancel", (e) => {
    if (readingContext.verseSelectDrag) { readingContext.verseSelectDrag = null; return; }
    cancelLongPress(e);
  });

  // Copy handler: serialize the selection ourselves so that stanza breaks
  // become blank lines and the appended reference uses plain verse numbers
  // (no line-part letters like "1a"). Shared serializer lives in bookmark.js
  // (VERSE_SERIALIZE block) so this path and the 복사 button emit identical text.
  article.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    // Expand partial selections to full verse boundaries so a dragged-across
    // fragment still yields a complete citation.
    const range = sel.getRangeAt(0);
    let firstVerse = null;
    let lastVerse = null;
    for (const v of article.querySelectorAll(".verse")) {
      if (range.intersectsNode(v)) {
        if (!firstVerse) firstVerse = v;
        lastVerse = v;
      }
    }
    if (!firstVerse || !lastVerse) return;

    const firstNum = parseInt(firstVerse.getAttribute("data-vref") ?? "", 10);
    const lastNum = parseInt(lastVerse.getAttribute("data-vref") ?? "", 10);
    if (!Number.isFinite(firstNum) || !Number.isFinite(lastNum)) return;

    const plainText = window.serializeVerseRange(firstVerse, lastVerse);
    const ref = firstNum === lastNum
      ? `${book.name_ko} ${ch}:${firstNum}`
      : `${book.name_ko} ${ch}:${firstNum}-${lastNum}`;

    if (!e.clipboardData) return;
    e.clipboardData.setData("text/plain", `${plainText}\n\n— ${ref} (공동번역성서)`);
    e.preventDefault();
  });

  $app.appendChild(article);
  $app.appendChild(buildChapterNav(book, ch));
  showAudioPlayer(book.id, ch);
  // ADR-022: one-time hint pointing out the cite chips (no-op after first show
  // or chip click, and when toggle is OFF or chapter has no chips).
  window.appCitations?.maybeShowCoachmark();

  // Scroll to highlighted verse, resumed position, or top
  const scrollVerse = hlVerse || (opts && opts.resumeVerse) || null;
  if (scrollVerse) {
    const target = document.getElementById(`v${scrollVerse}`);
    if (target) {
      const behavior = hlVerse ? "smooth" : "instant";
      requestAnimationFrame(() => target.scrollIntoView({ behavior, block: hlVerse ? "center" : "start" }));
    }
  } else {
    window.scrollTo(0, 0);
  }
}

function renderPrologue(data, book) {
  const mobileBookName = NT_MOBILE_NAME[book.id];
  setTitle(`${book.name_ko} 머리말`, mobileBookName ? `${mobileBookName} 머리말` : undefined);
  $title.insertBefore(buildHomeBtn(`/${effectiveDivision(book)}`, "성서 목록으로"), $title.firstChild);
  $title.appendChild(buildSettingsTrigger());
  clearNode($app);

  const article = el("article", { className: "prologue-text", lang: "ko" });
  for (const p of data.paragraphs) {
    article.appendChild(el("p", null, p));
  }

  $app.appendChild(article);

  const nav = el("nav", { className: "chapter-nav", "aria-label": "장 이동" });
  nav.appendChild(el("span", { className: "placeholder" }));
  nav.appendChild(el("a", { href: `/${book.id}/1` }, `1${chUnit(book.id)} →`));
  $app.appendChild(nav);
  showAudioPlayer(book.id, 0);
  window.scrollTo(0, 0);
}

function buildChapterNav(book, currentCh) {
  const unit = chUnit(book.id);
  const nav = el("nav", { className: "chapter-nav", "aria-label": `${unit} 이동` });

  if (currentCh > 1) {
    nav.appendChild(el("a", { href: `/${book.id}/${currentCh - 1}` }, `← ${currentCh - 1}${unit}`));
  } else if (book.has_prologue) {
    nav.appendChild(el("a", { href: `/${book.id}/prologue` }, "← 머리말"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  if (currentCh < book.chapter_count) {
    nav.appendChild(el("a", { href: `/${book.id}/${currentCh + 1}` }, `${currentCh + 1}${unit} →`));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

function renderLoading() {
  clearNode($app);
  $app.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "불러오는 중…"));
}

function renderError(msg) {
  clearNode($app);
  $app.appendChild(el("div", { className: "error", role: "alert" }, msg));
}

// ── Routing ──

function parsePath() {
  const pathname = location.pathname.replace(/^\//, "");
  if (!pathname) return { view: "books" };

  const query = new URLSearchParams(location.search || "");

  // Search route: /search?q=...&page=...
  if (pathname === "search") {
    return {
      view: "search",
      query: query.get("q") || "",
      page: parseInt(query.get("page") ?? "", 10) || 1,
    };
  }

  // Tab-bar destinations (ADR-029 / P2). On mobile these render full-screen
  // views; on desktop route() falls back to the existing overlays.
  if (pathname === "bookmarks") return { view: "bookmarks" };
  if (pathname === "settings") return { view: "settings" };

  const parts = pathname.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };

  // Chapter view with optional verse deep-link: /john/3/16 or /john/3/16-20.
  // Multi-segment: /john/3/1-5,10-15  ?hl=... carries search-term highlight.
  const highlightQuery = query.get("hl") || null;
  let highlightVerse = null;
  let highlightVerseEnd = null;
  let highlightVerseSpec = null;

  if (parts[2]) {
    const spec = parts[2];
    const simpleMatch = spec.match(/^(\d+)(?:-(\d+))?$/);
    if (simpleMatch) {
      const v1 = parseInt(simpleMatch[1], 10);
      const v2 = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : null;
      if (v1 > 0) {
        if (v2 && v2 > 0 && v2 !== v1) {
          highlightVerse = Math.min(v1, v2);
          highlightVerseEnd = Math.max(v1, v2);
        } else {
          highlightVerse = v1;
        }
      }
    } else if (/^[\d,\-a-z]+$/.test(spec)) {
      const segs = parseVerseSpec(spec);
      if (segs.length > 0) {
        // Sort ascending (by start, then part letter) and re-serialize for canonical URLs.
        segs.sort((a, b) => a.start !== b.start ? a.start - b.start : (a.part || "").localeCompare(b.part || ""));
        highlightVerseSpec = selectedVersesToSpec(
          segs.flatMap(s => s.part ? [`${s.start}${s.part}`] : Array.from({ length: s.end - s.start + 1 }, (_, i) => `${s.start + i}`))
        );
        highlightVerse = segs[0].start;
        highlightVerseEnd = segs[segs.length - 1].end;
      }
    }
  }

  return {
    view: "chapter",
    bookId: parts[0],
    chapter: parseInt(parts[1], 10),
    highlightQuery,
    highlightVerse,
    highlightVerseEnd,
    highlightVerseSpec,
    resume: query.has("resume"),
  };
}

/** @param {string} path */
function navigate(path) {
  history.pushState(null, "", path);
  route();
}

/** @param {{ title?: string, description?: string }} [opts] */
function updatePageMeta(opts = {}) {
  const { title, description } = opts;
  const fullTitle = title ? `${title} — 공동번역성서` : "공동번역성서";
  document.title = fullTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", fullTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", `https://bible.anglican.kr${location.pathname}`);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://bible.anglican.kr${location.pathname}`);
}

function trackPageView() {
  if (typeof gtag !== "function") return;
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  idle(() => {
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: location.href,
      page_path: location.pathname + location.search,
    });
  });
}

async function route() {
  const isInitialLoad = _isInitialLoad;
  _isInitialLoad = false;
  // ADR-031: 떠나는 경로의 스크롤을 기억(DOM 변경 전) + 재진입 가드 시퀀스 발급.
  const routeSeq = ++_routeSeq;
  window.tabHistory?.onRouteStart();
  syncTabBarActive();
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  clearNode($resumeBannerSlot);
  clearNode($divisionTabsSlot);
  if (readingContext.verseSelectMode) exitVerseSelectMode();
  // The citation sheet is anchored to a specific citation context, so a route
  // change (link nav or back/forward — both land here) should dismiss it.
  // Tapping another cite chip re-opens it without routing, so the intended
  // non-modal "tap chips in the visible page" behavior is preserved.
  const citeSheet = document.getElementById("cite-sheet");
  if (citeSheet && !citeSheet.hidden) window.appCitations?.closeCiteSheet();
  // Overlays that lock body scroll (position:fixed / overflow:hidden) must be
  // dismissed on any nav — incl. tab-bar switches — or they (and the scroll
  // lock) persist over the new view, blocking it (ADR-029).
  const bmDrawer = document.getElementById("bookmark-drawer");
  if (bmDrawer && !bmDrawer.hidden) window.closeBookmarkDrawer?.();
  // Desktop settings popover: close on nav too (it has a focus trap). Closing
  // here also makes the /settings desktop fallback's gear.click() always OPEN
  // (never toggle-closed) since the popover is already dismissed by this point.
  const settingsPopover = document.querySelector(".settings-popover");
  if (settingsPopover && !(/** @type {HTMLElement} */ (settingsPopover)).hidden) window.closeSettings?.();
  const parsed = parsePath();
  const { view, bookId, chapter, division } = parsed;

  // Sync the desktop header search input with the current route. On mobile the
  // header bar is hidden and /search renders its own in-page input, so skip it.
  if (view === "search" && !isMobile()) {
    $searchInput.value = parsed.query ?? "";
    $searchClear.hidden = !parsed.query;
    $searchBar.dataset.clearHidden = String(!parsed.query);
  } else {
    $searchInput.value = "";
    $searchClear.hidden = true;
    $searchBar.dataset.clearHidden = "true";
  }

  try {
    if (view === "search") {
      if (parsed.query) {
        const autoNav = consumeSearchAutoNavigate();
        // ADR-031: search 탭의 마지막 경로를 미리 기록한다. verse-ref 검색이면
        // renderSearchResults 가 챕터로 auto-nav(replaceState+route 재진입)하며 바깥
        // onRouteEnd 가 _routeSeq 가드로 스킵돼, 안 하면 lastPathForTab.search 가
        // 이전 검색에 머문다. 복원 시엔 autoNavigate=false 라 refMatch 가 클릭 카드로
        // 떠 바운스 없이 마지막 검색이 그대로 복원된다.
        window.tabHistory?.recordPath(location.pathname + location.search);
        await renderSearchResults(parsed.query, parsed.page, autoNav);
        // If renderSearchResults auto-navigated to a chapter, the inner route() call
        // already handles meta and analytics for that view — don't overwrite.
        if (parsePath().view !== "search") return;
        updatePageMeta({
          title: `"${parsed.query}" 검색`,
          description: `공동번역성서에서 "${parsed.query}" 검색 결과`,
        });
      } else if (isMobile()) {
        // Empty-query /search on mobile: full-screen in-page search input (the
        // bottom sheet is retired on the tab-bar path).
        renderSearchView();
        dismissLaunchScreen();
        updatePageMeta({ title: "검색", description: "공동번역성서 검색" });
      } else {
        const books = await loadBooks();
        renderBookList(books, divisionOrder()[0]);
        dismissLaunchScreen();
        updatePageMeta();
      }
      trackPageView();
      return;
    }

    // Tab-bar destinations (ADR-029 / P2). On mobile, render full-screen views
    // into #app. On desktop (no tab bar yet — these routes are mobile-driven)
    // fall back to the least-surprising behavior: open the existing overlay
    // over the book list so a deep-link / resize-down never dead-ends.
    if (view === "bookmarks") {
      if (isMobile()) {
        window.renderBookmarksView();
        dismissLaunchScreen();
        updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
        trackPageView();
        return;
      }
      // Desktop fallback: show the book list, then open the bookmark drawer
      // (the established desktop affordance) over it.
      const books = await loadBooks();
      renderBookList(books, divisionOrder()[0]);
      dismissLaunchScreen();
      updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
      openBookmarkDrawer(null, null);
      trackPageView();
      return;
    }

    if (view === "settings") {
      if (isMobile()) {
        window.renderSettingsView();
        dismissLaunchScreen();
        updatePageMeta({ title: "설정", description: "공동번역성서 설정" });
        trackPageView();
        return;
      }
      // Desktop fallback: settings is a popover anchored to the header gear, not
      // a routable page. Show the book list and click the desktop trigger to
      // open the popover so a deep-link / resize-down still lands somewhere.
      const books = await loadBooks();
      renderBookList(books, divisionOrder()[0]);
      dismissLaunchScreen();
      updatePageMeta({ title: "설정", description: "공동번역성서 설정" });
      /** @type {HTMLElement | null} */
      const gear = document.querySelector("#settings-anchor .settings-btn");
      if (gear) gear.click();
      trackPageView();
      return;
    }

    const books = await loadBooks();

    if (view === "books") {
      if (isInitialLoad && loadStartupBehavior() === "resume") {
        const savedPos = loadReadingPosition();
        if (savedPos && savedPos.bookId) {
          navigate(`/${savedPos.bookId}/${savedPos.chapter}?resume=1`);
          return;
        }
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books, divisionOrder()[0]);
      updatePageMeta();
      trackPageView();
      return;
    }

    if (view === "division") {
      // In vulgate mode, deuterocanon has no separate tab — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        navigate("/old_testament");
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books, division);
      const divLabel = DIVISION_LABELS[division ?? ""] ?? division;
      updatePageMeta({
        title: divLabel,
        description: `공동번역성서 ${divLabel} 목록`,
      });
      trackPageView();
      return;
    }

    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성서를 찾을 수 없습니다.");
      dismissLaunchScreen();
      return;
    }

    if (view === "chapters") {
      dismissLaunchScreen(); // Start fade-out immediately
      renderChapterList(book, books);
      updatePageMeta({
        title: book.name_ko,
        description: `${book.name_ko} — 공동번역성서 전문 읽기`,
      });
      trackPageView();
      return;
    }

    // For chapter/prologue: dismiss as soon as the loading placeholder appears,
    // so the user sees the skeleton instead of the launch screen while data loads.
    renderLoading();
    dismissLaunchScreen();

    if (view === "prologue") {
      if (!bookId) return;
      const data = await loadPrologue(bookId);
      renderPrologue(data, book);
      saveReadingPosition(bookId, "prologue");
      updatePageMeta({
        title: `${book.name_ko} 머리말`,
        description: `${book.name_ko} 머리말 — 공동번역성서`,
      });
      trackPageView();
      return;
    }

    if (view === "chapter") {
      if (!bookId || typeof chapter !== "number") return;
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      const savedPos = loadReadingPosition();
      const autoRestore = isInitialLoad
        && loadStartupBehavior() === "resume"
        && savedPos
        && savedPos.bookId === bookId
        && savedPos.chapter === chapter
        && savedPos.verse;
      const resumeVerse = (parsed.resume || autoRestore) && savedPos && savedPos.verse
        ? savedPos.verse
        : null;
      renderChapter(data, book, {
        highlightQuery: parsed.highlightQuery,
        highlightVerse: parsed.highlightVerse,
        highlightVerseEnd: parsed.highlightVerseEnd,
        highlightVerseSpec: parsed.highlightVerseSpec,
        resumeVerse,
      });
      saveReadingPosition(bookId, chapter, resumeVerse);
      startScrollTracking(bookId, chapter);
      updatePageMeta({
        title: `${book.name_ko} ${chapter}${chUnit(book.id)}`,
        description: `${book.name_ko} ${chapter}${chUnit(book.id)} — 공동번역성서`,
      });
      trackPageView();
    }
  } catch (err) {
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  } finally {
    dismissLaunchScreen(); // safety fallback (already a no-op if called above)
    // ADR-031: 이 호출이 여전히 최신 라우트일 때만 새 경로 기록 + 스크롤 복원.
    // 내부 navigate()(리다이렉트)가 _routeSeq 를 올렸으면 낡은 바깥 호출이라 건너뛴다.
    if (routeSeq === _routeSeq) window.tabHistory?.onRouteEnd();
  }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const a = /** @type {HTMLAnchorElement | null} */ (t.closest("a[href]"));
  if (!a) return;
  if (e.defaultPrevented) return;
  if (a.href.startsWith("blob:")) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  if (a.target === "_blank") return;
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const path = url.pathname + url.search;
  if (path === location.pathname + location.search) {
    route();
  } else {
    navigate(path);
  }
});

// popstate stays here (route is module-local). The DOMContentLoaded
// bootstrap handler stayed in app.js (Phase 8 territory) — it kicks off
// route() and the deferred init chain (initCompactHeader /
// initBookmarkSheetDrag / registerServiceWorker / maybeShowInstallNudge /
// driveSync.initDriveSync), several of which still live in app.js.
// ADR-031: 뒤로/앞으로(POP)는 떠날 때의 스크롤로 복원(scrollRestoration=manual 이라
// 브라우저가 안 하므로 직접). 일반 링크 이동(PUSH)은 요청하지 않아 복원하지 않는다.
window.addEventListener("popstate", () => {
  window.tabHistory?.requestRestore();
  route();
});

// ── Audio Player ──

/** @param {number} sec @returns {string} */
function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function _teardownAudio() {
  if (_audioController) { _audioController.abort(); _audioController = null; }
  if (_audioSaveTimer !== null) { clearTimeout(_audioSaveTimer); _audioSaveTimer = null; }
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function hideAudioBar() {
  _teardownAudio();
  $audioBar.hidden = true;
  clearNode($audioBar);
}

/** @param {string} bookId @param {number} chapter */
function showAudioPlayer(bookId, chapter) {
  if (!loadAudioShow()) { hideAudioBar(); return; }
  _teardownAudio();
  _audioController = new AbortController();
  const { signal } = _audioController;
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  currentAudio = audio;

  const savedTime = loadAudioTime(bookId, chapter);
  // Always preload metadata so total duration is visible before first play.
  // ADR-016 excludes preload accesses from LRU, so this does not pollute cache signals.
  audio.preload = "metadata";
  audio.src = src;

  // Build player UI
  const container = el("div", { className: "audio-player" });

  const playBtn = el("button", {
    className: "audio-play-btn",
    "aria-label": "재생",
  });
  const playIcon = el("span", { className: "audio-icon-play", "aria-hidden": "true" });
  playBtn.appendChild(playIcon);

  const progress = document.createElement("input");
  progress.type = "range";
  progress.className = "audio-progress";
  progress.min = "0";
  progress.max = "100";
  progress.value = "0";
  progress.setAttribute("aria-label", "재생 위치");

  function updateProgressFill() {
    const max = Number(progress.max);
    const pct = max > 0 ? (Number(progress.value) / max) * 100 : 0;
    progress.style.setProperty("--fill", `${pct}%`);
  }
  updateProgressFill();

  const timeDisplay = el("span", { className: "audio-time" }, "0:00");

  const progressWrap = el("div", { className: "audio-progress-wrap" });
  progressWrap.appendChild(progress);
  progressWrap.appendChild(timeDisplay);

  const SPEEDS = [1, 1.25, 1.5];
  let speedIndex = 0;
  const speedBtn = el("button", {
    className: "audio-speed-btn",
    "aria-label": "재생 속도 1배속",
  }, "1×");
  speedBtn.addEventListener("click", () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    const rate = SPEEDS[speedIndex];
    audio.playbackRate = rate;
    const label = `재생 속도 ${rate}배속`;
    speedBtn.setAttribute("aria-label", label);
    speedBtn.textContent = `${rate}×`;
    announce(label);
  });

  container.appendChild(playBtn);
  container.appendChild(progressWrap);
  container.appendChild(speedBtn);

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
    // Touch LRU metadata + opportunistically request persisted storage on
    // first play after install (value moment, ADR-016 §F).
    const absUrl = new URL(src, location.href).href;
    window.bibleAudioCache?.touch(absUrl).catch(() => {});
    _maybeRequestPersist();
  }, { signal });

  audio.addEventListener("playing", () => {
    playIcon.className = "audio-icon-pause";
  }, { signal });

  audio.addEventListener("waiting", () => {
    playIcon.className = "audio-icon-loading";
  }, { signal });

  audio.addEventListener("pause", () => {
    playIcon.className = "audio-icon-play";
    playBtn.setAttribute("aria-label", "재생");
    announce("일시정지");
  }, { signal });

  // Progress updates
  audio.addEventListener("loadedmetadata", () => {
    progress.max = String(Math.floor(audio.duration));
    if (savedTime && savedTime < audio.duration - 3) {
      audio.currentTime = savedTime;
      progress.value = String(Math.floor(savedTime));
      updateProgressFill();
      timeDisplay.textContent = `${formatTime(savedTime)} / ${formatTime(audio.duration)}`;
    } else {
      timeDisplay.textContent = `${formatTime(0)} / ${formatTime(audio.duration)}`;
    }
  }, { signal });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    if (_audioSaveTimer !== null) clearTimeout(_audioSaveTimer);
    _audioSaveTimer = setTimeout(() => {
      if (audio.currentTime > 0 && !audio.ended) saveAudioTime(bookId, chapter, Math.floor(audio.currentTime));
    }, 1000);
  }, { signal });

  audio.addEventListener("ended", () => {
    clearAudioTime();
  }, { signal });

  // Seeking
  let seekingByUser = false;
  progress.addEventListener("input", () => {
    seekingByUser = true;
    audio.currentTime = Number(progress.value);
    updateProgressFill();
  });
  progress.addEventListener("change", () => {
    seekingByUser = false;
  });

  // Error: audio not found → show unavailable message
  audio.addEventListener("error", () => {
    _teardownAudio();
    showAudioUnavailable();
  }, { signal });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
}

function showAudioUnavailable() {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(" 오디오 파일을 준비 중입니다."));
  $audioBar.appendChild(msg);
  $audioBar.hidden = false;
}

// Live-toggle the audio player from the settings popover. Off: tear it down
// so the FAB's audio-bar CSS sibling rule drops it back to the lower default
// position. On: rebuild for the chapter currently in view (no-op on non-chapter
// routes — next chapter navigation will pick the toggle up via showAudioPlayer).
/** @param {boolean} on */
function applyAudioShow(on) {
  if (!on) { hideAudioBar(); return; }
  const parsed = parsePath();
  if (parsed.view === "chapter") showAudioPlayer(parsed.bookId, parsed.chapter);
  else if (parsed.view === "prologue") showAudioPlayer(parsed.bookId, 0);
}
// ── Window facade ──
// Both an `appViewsRouting` aggregate and per-name globals so app.js's
// Phase 7b territory (Views/Routing/Audio Player) can call setTitle / loadBooks
// / divisionLabels etc. as bare globals. `window.appVersion` is mirrored by
// `loadVersion` for settings-ui.js (Phase 3 owner) which reads it for the
// version footer.

const appViewsRouting = {
  loadBooks, loadVersion, loadChapter, loadPrologue,
  setTitle, setTitleWithChapterPicker,
  buildDivisionTabs, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader, initScrollElevation,
  parsePath, route, navigate, hideAudioBar, applyAudioShow, renderError,
  _verseSelectionUnit,
};
window.appViewsRouting = appViewsRouting;

window.loadBooks = loadBooks;
window.loadVersion = loadVersion;
window.loadChapter = loadChapter;
window.loadPrologue = loadPrologue;
window.setTitle = setTitle;
window.setTitleWithChapterPicker = setTitleWithChapterPicker;
window.buildDivisionTabs = buildDivisionTabs;
window.divisionLabels = divisionLabels;
window.divisionOrder = divisionOrder;
window.effectiveDivision = effectiveDivision;
window.initCompactHeader = initCompactHeader;
window.initScrollElevation = initScrollElevation;
window.getBooksCache = () => booksCache;

// Phase 7b ownership: routing + rendering helpers that earlier phases
// (settings-ui / search / bookmark / app.js bootstrap) call as bare
// globals. Without these assignments their bare calls would resolve to
// undefined on globalThis at runtime even though TS sees the global
// declares in types.d.ts (the exact ESM ReferenceError trap).
window.parsePath = parsePath;
window.route = route;
window.navigate = navigate;
window.hideAudioBar = hideAudioBar;
window.applyAudioShow = applyAudioShow;
window.renderError = renderError;

// Audio Player module state read accessor — app.js's Accessibility keydown
// handler (Phase 8 territory) reads `currentAudio` for the spacebar
// play/pause toggle. Migrates out when Accessibility itself moves into a
// dedicated app-main module.
window.getCurrentAudio = () => currentAudio;

// (Phase 7a's temporary window.DIVISION_LABELS / OT_SUBCATEGORY{,_ORDER,_LABELS}
// scaffolding was removed in Phase 7b — all callers (parsePath / route /
// renderBookList) now live in this module.)

export {
  loadBooks, loadVersion, loadChapter, loadPrologue,
  setTitle, setTitleWithChapterPicker,
  buildDivisionTabs, divisionLabels, divisionOrder, effectiveDivision,
  initCompactHeader, initScrollElevation,
  _verseSelectionUnit,
};
