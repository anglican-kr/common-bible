"use strict";

// App-level domain types live in js/types.d.ts. See ADR-012.
/** @typedef {import("./types").ReadingPosition} ReadingPosition */
/** @typedef {import("./types").AudioPosition} AudioPosition */
/** @typedef {import("./types").SearchHistoryList} SearchHistoryList */
/** @typedef {import("./types").VerseSelectDrag} VerseSelectDrag */
/** @typedef {import("./types").DragState} DragState */
/** @typedef {import("./types").ColorSchemeId} ColorSchemeId */
/** @typedef {import("./types").ThemeMode} ThemeMode */
/** @typedef {import("./types").BookOrderKind} BookOrderKind */
/** @typedef {import("./types").ColorSchemeEntry} ColorSchemeEntry */
/** @typedef {import("./types").BookEntry} BookEntry */
/** @typedef {import("./types").BooksData} BooksData */
/** @typedef {import("./types").BibleChapter} BibleChapter */
/** @typedef {import("./types").BiblePrologue} BiblePrologue */
/** @typedef {import("./types").BibleVerse} BibleVerse */
// `BookmarkTreeNode` was previously deferred to the global typedef declared
// in js/sync/store-v2.js, but ADR-018 Phase 2 opted store-v2.js into an ES
// module (so its `saveBookmarks`/`loadBookmarks` no longer collide with
// js/app/storage.js). That moved the alias into module scope, so app.js now
// declares its own typedef.
/** @typedef {import("./types").BookmarkTreeNode} BookmarkTreeNode */
/** @typedef {import("./types").BookmarkTreeBookmark} BookmarkTreeBookmark */
/** @typedef {import("./types").BookmarkTreeFolder} BookmarkTreeFolder */

const DATA_DIR = "/data";

// Common DOM helpers live in js/app/helpers.js (ADR-018 Phase 1). `defer`
// load order in index.html guarantees window.appHelpers is populated by
// the time this script runs.
const { _$, chUnit, el, clearNode, setInert, trapFocus } = window.appHelpers;

// localStorage helpers + UI-shared constants live in js/app/storage.js
// (ADR-018 Phase 2). All save fns also notify window.syncStoreV2 + driveSync.
const {
  FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES, SEARCH_HISTORY_MAX,
  saveReadingPosition, loadReadingPosition, clearReadingPosition,
  saveAudioTime, loadAudioTime, clearAudioTime,
  normalizeSearchQuery, loadSearchHistory, saveSearchHistory,
  pushSearchHistory, removeSearchHistory, clearSearchHistory,
  loadStartupBehavior, saveStartupBehavior,
  loadFontSize, saveFontSize,
  loadColorScheme, saveColorScheme,
  loadTheme, saveTheme,
  loadBookOrder, saveBookOrder,
  generateId, loadBookmarks, saveBookmarks,
  _maybeRequestPersist,
} = window.appStorage;

// Settings popover + icon recoloring + theme/color/font apply + launch
// screen live in js/app/settings-ui.js (ADR-018 Phase 3).
const {
  initSettings, applyFontSize, applyTheme, applyColorScheme,
  dismissLaunchScreen,
} = window.appSettings;

// Cross-module reading-view state (current book/chapter + verse selection)
// owned by js/app/reading-context.js (ADR-018 Phase 6a). Local reference for
// terse access — `readingContext.bookId = "gen"` mutates the shared object.
const { readingContext } = window;
// Re-expose on window so the sync layer (state-machine.js) can apply Drive
// settings updates via its `typeof window.applyXxx === "function"` guards.
// `const` destructure does not auto-register on window — must be explicit.
window.applyFontSize = applyFontSize;
window.applyTheme = applyTheme;
window.applyColorScheme = applyColorScheme;

// Window facade for cross-module bare global calls (settings-ui.js,
// search.js, future bookmark.js). Before ADR-019's ESM bulk conversion
// these were resolved via classic-script shared global scope; ESM module
// scope makes each `function X()` module-private, so callers in another
// module would hit `globalThis.X` and fail. Each name below is hoisted
// within this module and re-exposed for ESM bare-global resolution.
// Migrates out as each owner ships in a later phase (ADR-018):
//   announce               → Phase 8 (with $announce anchor)
//   parsePath, route, navigate → Phase 7 (views-routing.js)
//   setTitle, setBreadcrumb    → Phase 7 (rendering helpers)
//   hideAudioBar               → Phase 7 (audio player)
//   renderError                → Phase 7 (rendering helpers)
//   openDriveDisconnectModal   → Phase 6 (bookmark.js) or stays in app-main
//   clearAllCaches             → Phase 8 (app-main)
window.announce = announce;
window.parsePath = parsePath;
window.route = route;
window.navigate = navigate;
window.setTitle = setTitle;
window.setBreadcrumb = setBreadcrumb;
window.hideAudioBar = hideAudioBar;
window.renderError = renderError;
window.openDriveDisconnectModal = openDriveDisconnectModal;
window.clearAllCaches = clearAllCaches;

const $app = _$("app");
const $title = _$("page-title");
const $breadcrumb = _$("breadcrumb");
const $announce = _$("a11y-announce");
const $audioBar = _$("audio-bar");
const $resumeBannerSlot = _$("resume-banner-slot");
// Search-related anchors retained here — still referenced by app.js's
// Escape keydown handler ($searchSheet), route() handler ($searchBar /
// $searchInput / $searchClear), and audio bar lift ($searchFab). The
// remaining 11 search-only anchors live inside js/app/search.js (Phase 5).
const $searchBar = _$("search-bar");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchFab = _$("search-fab");
const $searchSheet = _$("search-sheet");

/** @type {BooksData | null} */
let booksCache = null;
/** @type {string | null} */
let appVersion = null;
/** @type {HTMLAudioElement | null} */
let currentAudio = null;
/** @type {AbortController | null} */
let _audioController = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let _audioSaveTimer = null;

// ── Accessibility ──

/** @param {string} msg */
function announce(msg) {
  $announce.textContent = "";
  requestAnimationFrame(() => { $announce.textContent = msg; });
}

// `trapFocus` was extracted to js/app/helpers.js (ADR-018 Phase 1).

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Close search overlay if open
    if ($searchSheet && !$searchSheet.hidden) {
      closeSearchSheet();
      return;
    }
    /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll(".chapter-popover:not([hidden]), .bc-division-popover:not([hidden]), .settings-popover:not([hidden]), .title-division-popover:not([hidden])")
    ).forEach((p) => { p.hidden = true; });
    /** @type {NodeListOf<HTMLElement>} */ (
      document.querySelectorAll("[aria-expanded='true']")
    ).forEach((b) => { b.setAttribute("aria-expanded", "false"); b.focus(); });
  }
  // Space to toggle audio playback (when not in an input/button)
  const target = e.target;
  if (e.key === " " && currentAudio && target instanceof Element && !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    e.preventDefault();
    if (currentAudio.paused) currentAudio.play(); else currentAudio.pause();
  }
});

// ── Reading position persistence ──
// Storage key constants + load/save helpers were extracted to
// js/app/storage.js (ADR-018 Phase 2). `SEARCH_HISTORY_VISIBLE` moved to
// js/app/search.js (Phase 5) — search history panel controller is the only
// consumer.

/** @type {(() => void) | null} */
let _scrollTrackCleanup = null;
let _isInitialLoad = true;

// ── Bookmark state ──
// Verse-selection state + current book/chapter were extracted to
// js/app/reading-context.js (ADR-018 Phase 6a) — see destructured
// `readingContext` at the top of this file. Only bookmark-UI-specific
// state remains here pending Phase 6b extraction to bookmark.js.
/** @type {(() => void) | null} */
let _bookmarkDrawerTrap = null;
/** @type {HTMLElement | null} */
let _bookmarkDrawerLastFocus = null;
/** @type {(() => void) | null} */
let _bmSaveModalTrap = null;
/** @type {(() => void) | null} */
let _bmMergeModalTrap = null;
/** @type {(() => void) | null} */
let _bmNewFolderTrap = null;
/** @type {((id: string) => void) | null} */
let _bmNewFolderCallback = null;
let _bookmarkDrawerCloseSeq = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookmarkDrawerCloseTimer = null;
// `_dragState` was extracted to js/app/bookmark.js (ADR-018 Phase 6a) along
// with the drag & drop pointer handling that owns it.

// `saveReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

/**
 * @param {string} bookId
 * @param {number} chapter
 */
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

// `loadReadingPosition`, `saveAudioTime`, `loadAudioTime`, `clearAudioTime`
// were extracted to js/app/storage.js (ADR-018 Phase 2).

// ── Audio cache LRU helpers (ADR-016) ──
// One-shot persisted-storage request: called on the first value moment
// (audio play, bookmark save, etc.). navigator.storage.persist() may show a
// browser prompt on Safari/Firefox; on Chrome it grants silently when the
// site has high engagement. We swallow result errors — even if denied, the
// LRU loop in audio-cache.js still functions, just without iOS 7-day evict
// immunity.
// `_maybeRequestPersist` was extracted to js/app/storage.js (ADR-018 Phase 2).

// Soft-cap eviction. Page-driven (SW only enforces hard cap on put). Called
// on visibilitychange→hidden so the work runs while the user is not actively
// reading. SW already opens AUDIO_CACHE under the same name; we use the
// constant exported by audio-cache.js to avoid drift.
async function _enforceAudioSoftCap() {
  const ac = window.bibleAudioCache;
  if (!ac) return;
  try {
    const total = await ac.totalSize();
    if (total <= ac.SOFT_CAP) return;
    const { urls } = await ac.pickEvictions(ac.SOFT_CAP);
    if (!urls.length) return;
    const cache = await caches.open(ac.AUDIO_CACHE_NAME);
    await Promise.all(urls.map((u) => cache.delete(u)));
    await ac.removeEntries(urls);
    window.syncDebugLog?.log({
      kind: "ACTION", event: "audio-evict", reason: "soft",
      count: urls.length, totalBefore: total,
    });
  } catch (_) { /* best-effort */ }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    _enforceAudioSoftCap();
  } else if (document.visibilityState === "visible") {
    // Pull updates from Drive when the user returns to this tab so changes
    // made on another device are reflected without a manual reload.
    // requestSync only dispatches if the machine is IDLE, so rapid toggles
    // can't overlap cycles, and ETag 304 makes a no-change check ~free.
    window.driveSync?.requestSync?.();
  }
});

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
  const MODAL_SELECTORS = "#bookmark-drawer, #search-sheet, #install-modal, #bm-save-modal, #bm-new-folder-modal, #bm-import-modal, #bm-merge-modal, #drive-disconnect-modal, .settings-popover, .chapter-popover, .bc-division-popover, .title-division-popover";

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

// Search history helpers were extracted to js/app/storage.js
// (ADR-018 Phase 2). The BEGIN/END markers + tests/unit/storage.test.js
// follow the new location.

// `loadStartupBehavior`, `saveStartupBehavior`, `loadFontSize`, `saveFontSize`
// were extracted to js/app/storage.js (ADR-018 Phase 2).

// ── Font size ──
// `applyFontSize` was extracted to js/app/settings-ui.js (ADR-018 Phase 3).

// ── Cache management ──

/** @returns {Promise<void>} */
async function clearAllCaches() {
  if (!("caches" in window)) return;
  if (!navigator.onLine) {
    alert("오프라인 상태에서는 캐시를 비울 수 없습니다.\n인터넷에 연결된 후 다시 시도해 주세요.");
    return;
  }
  if (!confirm("캐시를 비우면 오프라인 데이터가 삭제됩니다.\n저장된 북마크는 사라지지 않습니다.\n비울까요?")) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.unregister();
    } catch (_) { /* SW unregister failed — continue to reload */ }
    window.location.reload();
  } catch (err) {
    console.error("Cache clear failed:", err);
    alert("캐시를 비우지 못했습니다. 다시 시도해 주세요.");
  }
}

// ── Book order ──
// `loadBookOrder`/`saveBookOrder` were extracted to js/app/storage.js.

// Apply saved settings on load
window.syncStoreV2?.migrateLegacyIfNeeded();
window.syncStoreV2?.sweepTombstones();
applyFontSize(loadFontSize());
applyTheme(loadTheme());
applyColorScheme(loadColorScheme());
initSettings();


// ── Helpers ──
// `el`, `clearNode`, `_$`, `chUnit`, `trapFocus` were extracted to
// js/app/helpers.js (ADR-018 Phase 1). Imported via destructure at module head.

// Verse spec utilities + bookmark query helpers + drag & drop pointer
// handling were extracted to js/app/bookmark.js (ADR-018 Phase 6a). The
// module assigns its functions to `window.X` for legacy bare-global
// callers (Phase 6b territory: bookmark UI / tree / modals / drawer
// handlers — those move out in Phase 6b).

// ── Data fetching ──

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

// ── Rendering helpers ──

function setTitle(text) {
  clearNode($title);
  $title.appendChild(document.createTextNode(text));
  document.title = text === "공동번역성서" ? text : `${text} — 공동번역성서`;
  announce(text);
}

function setTitleWithDivisionPicker(activeDivision) {
  clearNode($title);
  const labels = divisionLabels();
  const order = divisionOrder();
  const label = labels[activeDivision];
  document.title = `${label} — 공동번역성서`;
  announce(label);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": "구분 선택", "aria-expanded": "false" },
    label
  );

  const popover = el("ul", { className: "bc-division-popover title-division-popover", role: "listbox", "aria-label": "구분 선택" });
  popover.hidden = true;

  for (const div of order) {
    const cls = div === activeDivision ? "bc-division-item active" : "bc-division-item";
    popover.appendChild(el("li", null, el("a", { className: cls, href: `/${div}` }, labels[div])));
  }

  /** @type {(() => void) | null} */
  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!popover.hidden && t instanceof Node && !$title.contains(t)) {
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

  $title.appendChild(btn);
  $title.appendChild(popover);
}

/**
 * @param {BookEntry} book
 * @param {number} currentCh
 */
function setTitleWithChapterPicker(book, currentCh) {
  clearNode($title);
  const unit = chUnit(book.id);
  document.title = `${book.name_ko} ${currentCh}${unit} — 공동번역성서`;
  announce(`${book.name_ko} ${currentCh}${unit}`);

  const btn = el(
    "button",
    { className: "title-picker-btn", "aria-label": `${unit} 선택`, "aria-expanded": "false" },
    `${book.name_ko} ${currentCh}${unit}`
  );

  const popover = el("div", { className: "chapter-popover", role: "listbox", "aria-label": `${unit} 선택` });
  popover.hidden = true;

  const grid = el("div", { className: "popover-grid" });
  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "popover-item popover-prologue", href: `/${book.id}/prologue` }, "머리말")
    );
  }
  for (let i = 1; i <= book.chapter_count; i++) {
    const cls = i === currentCh ? "popover-item current" : "popover-item";
    grid.appendChild(el("a", { className: cls, href: `/${book.id}/${i}` }, String(i)));
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
      const first = /** @type {HTMLElement | null} */ (popover.querySelector('a[href]'));
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!popover.hidden && t instanceof Node && !$title.contains(t)) {
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

  $title.appendChild(buildBackBtn(`${book.name_ko} 목록으로`, `/${book.id}`));
  $title.appendChild(btn);
  $title.appendChild(popover);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, currentCh));
}

function setBreadcrumb(crumbs) {
  clearNode($breadcrumb);
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = el("span", { className: "sep", "aria-hidden": "true" }, "›");
      $breadcrumb.appendChild(sep);
    }
    if (c.href) {
      $breadcrumb.appendChild(el("a", { href: c.href }, c.label));
    } else if (c.divisionPicker) {
      $breadcrumb.appendChild(buildDivisionBreadcrumb(c.label, c.activeDivision));
    } else {
      $breadcrumb.appendChild(el("span", null, c.label));
    }
  });
}

function buildDivisionBreadcrumb(label, activeDivision) {
  return el("a", { href: `/${activeDivision}` }, label);
}

const DIVISION_LABELS = {
  old_testament: "구약",
  deuterocanon: "외경",
  new_testament: "신약",
};

const DIVISION_ORDER = ["old_testament", "deuterocanon", "new_testament"];

// Old Testament subcategories (also covers deuterocanon books for vulgate mode)
const OT_SUBCATEGORY = {
  gen: "pentateuch", exod: "pentateuch", lev: "pentateuch", num: "pentateuch", deut: "pentateuch",
  josh: "history", judg: "history", ruth: "history",
  "1sam": "history", "2sam": "history", "1kgs": "history", "2kgs": "history",
  "1chr": "history", "2chr": "history", ezra: "history", neh: "history",
  tob: "history", jdt: "history", esth: "history", "1macc": "history", "2macc": "history",
  job: "wisdom", ps: "wisdom", prov: "wisdom", eccl: "wisdom", song: "wisdom",
  wis: "wisdom", sir: "wisdom",
  isa: "prophets", jer: "prophets", lam: "prophets", bar: "prophets",
  ezek: "prophets", dan: "prophets", hos: "prophets", joel: "prophets", amos: "prophets",
  obad: "prophets", jonah: "prophets", mic: "prophets", nah: "prophets", hab: "prophets",
  zeph: "prophets", hag: "prophets", zech: "prophets", mal: "prophets",
};
const OT_SUBCATEGORY_ORDER = ["pentateuch", "history", "wisdom", "prophets"];
const OT_SUBCATEGORY_LABELS = {
  pentateuch: "오경",
  history: "역사서",
  wisdom: "시서와 지혜서",
  prophets: "예언서",
};

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

// ── Views ──

function renderBookList(books) {
  setTitle("공동번역성서");
  $title.appendChild(buildBookmarkHeaderBtn(null, null));
  setBreadcrumb([]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  const labels = divisionLabels();
  const order = divisionOrder();

  const grouped = {};
  for (const b of books) {
    const key = effectiveDivision(b);
    (grouped[key] ??= []).push(b);
  }

  for (const div of order) {
    const list = grouped[div];
    if (!list) continue;

    const details = el("details", { className: "division", open: "" });
    details.appendChild(el("summary", { className: "division-title" }, labels[div]));

    if (div === "old_testament") {
      // Group OT books into subcategories
      const subGrouped = {};
      for (const b of list) {
        const sub = OT_SUBCATEGORY[b.id] ?? "other";
        (subGrouped[sub] ??= []).push(b);
      }
      for (const sub of OT_SUBCATEGORY_ORDER) {
        const subList = subGrouped[sub];
        if (!subList) continue;
        const section = el("div", { className: "ot-subcategory" });
        section.appendChild(el("h3", { className: "ot-subcategory-title" }, OT_SUBCATEGORY_LABELS[sub]));
        const ul = el("ul", { className: "book-list", role: "list" });
        for (const b of subList) {
          ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
        }
        section.appendChild(ul);
        details.appendChild(section);
      }
    } else {
      const ul = el("ul", { className: "book-list", role: "list" });
      for (const b of list) {
        ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
      }
      details.appendChild(ul);
    }
    $app.appendChild(details);
  }
}

// `clearReadingPosition` was extracted to js/app/storage.js (ADR-018 Phase 2).

function renderResumeBanner(books) {
  const pos = loadReadingPosition();
  if (!pos) return;
  const lastBook = books.find((b) => b.id === pos.bookId);
  if (!lastBook) return;
  const isPrologue = pos.chapter === "prologue";
  const href = `/${pos.bookId}/${pos.chapter}?resume=1`;
  const label = isPrologue
    ? `이어읽기: ${lastBook.name_ko} 머리말`
    : `이어읽기: ${lastBook.name_ko} ${pos.chapter}${chUnit(lastBook.id)}`;

  const wrapper = el("div", { className: "resume-banner" });
  wrapper.appendChild(el("a", { className: "resume-banner-link", href }, label));

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
}

function renderDivisionList(books, division) {
  setTitleWithDivisionPicker(division);
  $title.insertBefore(buildBackBtn("목록으로", "/"), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(null, null));
  setBreadcrumb([{ label: "목록", href: "/" }]);
  hideAudioBar();
  clearNode($app);

  renderResumeBanner(books);

  // In vulgate mode, old_testament division includes deuterocanon books (in file order)
  const list = (loadBookOrder() === "vulgate" && division === "old_testament")
    ? books.filter((b) => b.division !== "new_testament")
    : books.filter((b) => b.division === division);

  const details = el("details", { className: "division", open: "" });
  details.appendChild(el("summary", { className: "division-title" }, divisionLabels()[division]));

  if (division === "old_testament") {
    const subGrouped = {};
    for (const b of list) {
      const sub = OT_SUBCATEGORY[b.id] ?? "other";
      (subGrouped[sub] ??= []).push(b);
    }
    for (const sub of OT_SUBCATEGORY_ORDER) {
      const subList = subGrouped[sub];
      if (!subList) continue;
      const section = el("div", { className: "ot-subcategory" });
      section.appendChild(el("h3", { className: "ot-subcategory-title" }, OT_SUBCATEGORY_LABELS[sub]));
      const ul = el("ul", { className: "book-list", role: "list" });
      for (const b of subList) {
        ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
      }
      section.appendChild(ul);
      details.appendChild(section);
    }
  } else {
    const ul = el("ul", { className: "book-list", role: "list" });
    for (const b of list) {
      ul.appendChild(el("li", null, el("a", { href: `/${b.id}` }, b.name_ko)));
    }
    details.appendChild(ul);
  }
  $app.appendChild(details);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko);
  $title.insertBefore(buildBackBtn(`${divisionLabels()[effectiveDivision(book)]}으로`, `/${effectiveDivision(book)}`), $title.firstChild);
  $title.appendChild(buildBookmarkHeaderBtn(book.id, null));
  hideAudioBar();
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
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

function formatVerseLabel(v) {
  let label = String(v.number);
  if (v.part) label += v.part;
  if (v.range_end) label += `-${v.range_end}`;
  return label;
}

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
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
  clearNode($app);

  if (data.has_dual_numbering) {
    $app.appendChild(
      el("p", { className: "dual-numbering-note" }, "※ 괄호 안 번호는 70인역 사본(그리스어)의 절 번호입니다.")
    );
  }

  const article = el("article", { className: "chapter-text", lang: "ko" });
  let isFirst = true;
  let prevVerseEndType = null;

  for (const v of data.verses) {
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

    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    const vn = v.number;

    // Verse number (rendered via CSS ::before to exclude from clipboard)
    let dataV = v.chapter_ref ? `${v.chapter_ref}:${verseLabel}` : verseLabel;
    if (v.alt_ref != null) dataV += `(${v.alt_ref})`;

    function appendSegText(target, raw) {
      const hasPilcrow = raw.startsWith("¶");
      if (hasPilcrow) {
        target.appendChild(el("span", { className: "pilcrow", "aria-hidden": "true" }, "¶"));
      }
      const textContent = hasPilcrow ? raw.replace(/^¶\s*/, "") : raw;
      appendTextWithHighlight(target, textContent + " ", hlQuery);
    }

    // Count total lines across all segments to determine if multi-part
    const totalLines = segs.reduce((n, s) => n + s.text.split("\n").filter(l => l !== "").length, 0);
    const isMultiPart = totalLines > 1;
    const partLetters = "bcdefghijklmnop";
    let partIdx = 0;
    let isFirstLine = true;
    let prevSegType = null;

    for (const seg of segs) {
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

        // Break before non-first lines
        if (!isFirstLine) {
          const breakClass = ((seg.paragraph_break || isSegChange) && li === 0) ? "paragraph-break"
            : isPoetry ? "hemistich-break" : "paragraph-break";
          article.appendChild(el("span", {
            className: breakClass,
            role: "presentation"
          }));
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
        // Hanging punctuation: pull leading quote outside the indent.
        // Single quote is narrower, so it uses a smaller offset (see .hanging-quote--single).
        if (isPoetry && (line[0] === '"' || line[0] === "'")) {
          const cls = line[0] === '"' ? "hanging-quote" : "hanging-quote hanging-quote--single";
          span.appendChild(el("span", { className: cls }, line[0]));
          appendSegText(span, line.slice(1));
        } else {
          appendSegText(span, line);
        }
        article.appendChild(span);
        isFirstLine = false;
      }
      prevSegType = seg.type;
    }

    prevVerseEndType = segs[segs.length - 1]?.type;
    isFirst = false;
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
      const isAdding = !readingContext.selectedVerses.has(vs.getAttribute("data-vref") ?? "");
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
        readingContext.selectedVerses.add(vref);
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
      allVerses.forEach((v, i) => {
        const vref = v.getAttribute("data-vref") ?? "";
        if (i >= lo && i <= hi) {
          if (isAdding) readingContext.selectedVerses.add(vref);
          else readingContext.selectedVerses.delete(vref);
        }
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
        // Simple tap: toggle start verse
        const vs = readingContext.verseSelectDrag.allVerses[readingContext.verseSelectDrag.startIdx];
        if (vs) {
          const vref = vs.getAttribute("data-vref") ?? "";
          if (readingContext.verseSelectDrag.isAdding) readingContext.selectedVerses.add(vref);
          else readingContext.selectedVerses.delete(vref);
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
  // (no line-part letters like "1a").
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

    const expanded = document.createRange();
    expanded.setStartBefore(firstVerse);
    expanded.setEndAfter(lastVerse);

    const work = document.createElement("div");
    work.appendChild(expanded.cloneContents());

    // Drop aria-hidden verse-number glyphs (rendered via ::before).
    work.querySelectorAll(".verse-num").forEach((n) => n.remove());
    // Stanza and paragraph boundaries become blank lines; pilcrow markers also
    // emit a blank line (redundant \n\n adjacent to a paragraph-break collapses
    // via the \n{3,} rule below). Hemistich breaks stay as a single line break.
    work.querySelectorAll(".stanza-break, .paragraph-break, .pilcrow").forEach((n) => { n.textContent = "\n\n"; });
    work.querySelectorAll(".hemistich-break").forEach((n) => { n.textContent = "\n"; });

    /** @type {number | null} */
    let firstNum = null;
    /** @type {number | null} */
    let lastNum = null;
    for (const vs of work.querySelectorAll(".verse[data-vref]")) {
      const n = parseInt(vs.getAttribute("data-vref") ?? "", 10);
      if (!Number.isFinite(n)) continue;
      if (firstNum === null) firstNum = n;
      lastNum = n;
    }
    if (firstNum === null) return;

    const plainText = (work.textContent ?? "")
      .replace(/\u2060/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

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
  observeFabLift();

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
  setTitle(`${book.name_ko} 머리말`);
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
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
  observeFabLift();
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
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  clearNode($resumeBannerSlot);
  if (readingContext.verseSelectMode) exitVerseSelectMode();
  const parsed = parsePath();
  const { view, bookId, chapter, division } = parsed;

  // Sync search input with current route
  if (view === "search") {
    if (isMobile()) {
      // On mobile, redirect search route to overlay
      openSearchSheet(parsed.query);
      dismissLaunchScreen();
      return;
    }
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
        await renderSearchResults(parsed.query, parsed.page, autoNav);
        // If renderSearchResults auto-navigated to a chapter, the inner route() call
        // already handles meta and analytics for that view — don't overwrite.
        if (parsePath().view !== "search") return;
        updatePageMeta({
          title: `"${parsed.query}" 검색`,
          description: `공동번역성서에서 "${parsed.query}" 검색 결과`,
        });
      } else {
        const books = await loadBooks();
        renderBookList(books);
        dismissLaunchScreen();
        updatePageMeta();
      }
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
      renderBookList(books);
      updatePageMeta();
      trackPageView();
      return;
    }

    if (view === "division") {
      // In vulgate mode, deuterocanon has no separate page — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        navigate("/old_testament");
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderDivisionList(books, division);
      const divLabel = DIVISION_LABELS[division] ?? division;
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

window.addEventListener("popstate", route);
window.addEventListener("DOMContentLoaded", () => {
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));

  // Redirect legacy hash URLs: bible.anglican.kr/#/gen/1 → /gen/1
  if (location.hash.startsWith("#/")) {
    history.replaceState(null, "", location.hash.slice(1));
  }

  // 1. Prioritize UI rendering
  route().finally(() => {
    // 2. Load non-critical work after first paint. Each item targets a surface
    //    the user cannot interact with until they explicitly open it (drawers,
    //    search sheet) or that has no first-paint impact (version label,
    //    compact-header scroll listener, install nudge, SW registration).
    idle(() => {
      loadVersion();
      initCompactHeader();
      initSheetDrag();
      initBookmarkSheetDrag();
      initBookmarkDrawerResize();
      registerServiceWorker();
      maybeShowInstallNudge();
      if (window.driveSync) window.driveSync.initDriveSync();
    });
  });
});

// ── Audio Player ──

/** @param {number} sec @returns {string} */
function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Lift FAB above chapter-nav when it scrolls into view on mobile.
// Anchors against the nav's real viewport position so the audio bar's
// height doesn't matter — the FAB always sits centered in the gap
// above chapter-nav.
let _fabNavObserver = null;
let _fabScrollHandler = null;
let _fabRafPending = false;
/** @param {HTMLElement} nav */
function _updateFabLift(nav) {
  const fabH = $searchFab.offsetHeight;
  const gapPx = parseFloat(getComputedStyle(nav).marginTop) || 0;
  const navTop = nav.getBoundingClientRect().top;
  const liftPx = window.innerHeight - navTop + (gapPx - fabH) / 2;
  $searchFab.style.setProperty("--fab-lift-nav", `${Math.max(liftPx, 0)}px`);
}
function observeFabLift() {
  if (_fabNavObserver) { _fabNavObserver.disconnect(); _fabNavObserver = null; }
  if (_fabScrollHandler) {
    window.removeEventListener("scroll", _fabScrollHandler);
    _fabScrollHandler = null;
  }
  _fabRafPending = false;
  const nav = /** @type {HTMLElement | null} */ ($app.querySelector(".chapter-nav"));
  if (!nav) return;
  const onScroll = () => {
    if (_fabRafPending) return;
    _fabRafPending = true;
    requestAnimationFrame(() => {
      _fabRafPending = false;
      if (!nav.isConnected) return;
      _updateFabLift(nav);
    });
  };
  _fabNavObserver = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible) {
      _updateFabLift(nav);
      if (!_fabScrollHandler) {
        _fabScrollHandler = onScroll;
        window.addEventListener("scroll", onScroll, { passive: true });
      }
    } else {
      $searchFab.style.removeProperty("--fab-lift-nav");
      if (_fabScrollHandler) {
        window.removeEventListener("scroll", _fabScrollHandler);
        _fabScrollHandler = null;
      }
    }
  }, { threshold: 0 });
  _fabNavObserver.observe(nav);
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
  $audioBar.style.position = "sticky";
}

function showAudioUnavailable() {
  clearNode($audioBar);
  const msg = el("p", { className: "audio-unavailable" });
  msg.appendChild(el("span", { className: "audio-unavailable-icon", "aria-hidden": "true" }));
  msg.appendChild(document.createTextNode(" 오디오 파일을 준비 중입니다."));
  $audioBar.appendChild(msg);
  $audioBar.hidden = false;
  $audioBar.style.position = "static";
}

// Search engine + history panel + bottom sheet + drag init live in
// js/app/search.js (ADR-018 Phase 5). The module assigns
// `window.openSearchSheet` / `window.closeSearchSheet` /
// `window.renderSearchResults` / `window.initSheetDrag` for legacy callers
// (route handler, Escape keydown, bootstrap).

function initBookmarkSheetDrag() {
  const handle = _$("bookmark-drawer-handle");
  const drawer = _$("bookmark-drawer");
  let startY = 0;
  let startH = 0;

  function onMove(clientY) {
    const delta = startY - clientY;
    const newH = Math.min(Math.max(startH + delta, window.innerHeight * 0.3), window.innerHeight * 0.92);
    drawer.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth >= 769) return; // desktop uses fixed-size side panel
    e.preventDefault();
    startY = e.clientY;
    startH = drawer.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    if (drawer.offsetHeight < window.innerHeight * 0.2) {
      closeBookmarkDrawer();
      drawer.style.height = "";
    }
  }
}

function initBookmarkDrawerResize() {
  const handle = _$("bookmark-drawer-resize");
  const drawer = _$("bookmark-drawer");
  let startX = 0;
  let startW = 0;

  handle.addEventListener("pointerdown", (e) => {
    if (window.innerWidth < 769) return;
    e.preventDefault();
    startX = e.clientX;
    startW = drawer.offsetWidth;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) {
    const delta = startX - e.clientX; // drag left = wider
    const newW = Math.min(Math.max(startW + delta, 240), window.innerWidth * 0.85);
    drawer.style.width = `${newW}px`;
  }

  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
  }
}

// ── Compact Header on Scroll ──
// Deferred: not needed until after first render and first scroll.

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

// PWA install detection + Install guide modal + Install nudge auto-show
// live in js/app/install.js (ADR-018 Phase 4). Loaded as ESM in index.html;
// the module assigns `window.install` / `window.openInstallModal` /
// `window.maybeShowInstallNudge` for legacy callers (settings popover +
// app.js bootstrap).
//
// Background-inert helper shared with the bookmark drawer/sheet UI. Moves
// alongside bookmark UI when Phase 6 ships.
const BOOKMARK_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #search-fab, #search-sheet, #search-scrim, #launch-screen, #install-scrim, #install-modal, #verse-select-bar";
/** @param {boolean} on */
function setBookmarkBackgroundInert(on) { setInert(on, BOOKMARK_INERT_SELECTORS); }

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
const $bmImportBtn = _$("bm-import-btn");
const $bmImportInput = /** @type {HTMLInputElement} */ (_$("bm-import-input"));
const $driveDisconnectScrim = _$("drive-disconnect-scrim");
const $driveDisconnectModal = _$("drive-disconnect-modal");
const $driveDisconnectDelete = _$("drive-disconnect-delete");
const $driveDisconnectKeep = _$("drive-disconnect-keep");
const $driveDisconnectCancel = _$("drive-disconnect-cancel");

let _driveDisconnectTrap = null;

function openDriveDisconnectModal() {
  $driveDisconnectScrim.hidden = false;
  $driveDisconnectModal.hidden = false;
  _driveDisconnectTrap = trapFocus($driveDisconnectModal);
  requestAnimationFrame(() => $driveDisconnectKeep.focus());
}

function closeDriveDisconnectModal() {
  $driveDisconnectScrim.hidden = true;
  $driveDisconnectModal.hidden = true;
  if (_driveDisconnectTrap) { _driveDisconnectTrap(); _driveDisconnectTrap = null; }
}

$driveDisconnectCancel.addEventListener("click", closeDriveDisconnectModal);
$driveDisconnectScrim.addEventListener("click", closeDriveDisconnectModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$driveDisconnectModal.hidden) closeDriveDisconnectModal();
});

$driveDisconnectKeep.addEventListener("click", () => {
  closeDriveDisconnectModal();
  window.driveSync?.signOut();
});

$driveDisconnectDelete.addEventListener("click", async () => {
  closeDriveDisconnectModal();
  await window.driveSync?.deleteRemoteFile();
  window.driveSync?.signOut();
});
const $bmImportScrim = _$("bm-import-scrim");
const $bmImportModal = _$("bm-import-modal");
const $bmImportBody = _$("bm-import-body");
const $bmImportMerge = _$("bm-import-merge");
const $bmImportOverwrite = _$("bm-import-overwrite");
const $bmImportCancel = _$("bm-import-cancel");
const $bmSaveScrim = _$("bm-save-scrim");
const $bmSaveModal = _$("bm-save-modal");
const $bmSaveClose = _$("bm-save-close");
const $bmSaveTitle = _$("bm-save-title");
const $bmSaveBody = _$("bm-save-body");
const $bmNewFolderScrim = _$("bm-new-folder-scrim");
const $bmNewFolderModal = _$("bm-new-folder-modal");
const $bmNewFolderClose = _$("bm-new-folder-close");
const $bmNewFolderInput = /** @type {HTMLInputElement} */ (_$("bm-new-folder-input"));
const $bmNewFolderConfirm = _$("bm-new-folder-confirm");
const $bmNewFolderCancel = _$("bm-new-folder-cancel");
const $bmMergeScrim = _$("bm-merge-scrim");
const $bmMergeModal = _$("bm-merge-modal");
const $bmMergeBody = _$("bm-merge-body");
const $bmMergeYes = _$("bm-merge-yes");
const $bmMergeNo = _$("bm-merge-no");
const $bmMergeCancel = _$("bm-merge-cancel");
const $verseSelectBar = _$("verse-select-bar");
const $verseSelectCount = _$("verse-select-count");
const $verseSelectBookmarkBtn = /** @type {HTMLButtonElement} */ (_$("verse-select-bookmark-btn"));
const $verseSelectCancelBtn = _$("verse-select-cancel-btn");

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

// Build the bookmark icon SVG button for the chapter header
function buildBookmarkHeaderBtn(bookId, chapter) {
  const btn = el("button", {
    className: "title-bookmark-btn",
    "aria-label": "북마크",
    type: "button",
  });
  if (findExistingChapterBookmarks(bookId, chapter).length > 0) {
    btn.classList.add("has-bookmark");
  }
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("viewBox", "0 -960 960 960");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M160-80v-560q0-33 23.5-56.5T240-720h320q33 0 56.5 23.5T640-640v560L400-200 160-80Zm80-121 160-86 160 86v-439H240v439Zm480-39v-560H280v-80h440q33 0 56.5 23.5T800-800v560h-80ZM240-640h320-320Z");
  svg.appendChild(path);
  btn.appendChild(svg);
  btn.addEventListener("click", () => openBookmarkDrawer(bookId, chapter));
  return btn;
}

function refreshBookmarkHeaderBtn() {
  const btn = document.querySelector(".title-bookmark-btn");
  if (!btn || !readingContext.bookId || !readingContext.chapter) return;
  btn.classList.toggle(
    "has-bookmark",
    findExistingChapterBookmarks(readingContext.bookId, readingContext.chapter).length > 0
  );
}

function openBookmarkDrawer(bookId, chapter) {
  _bookmarkDrawerCloseSeq += 1;
  if (_bookmarkDrawerCloseTimer) {
    clearTimeout(_bookmarkDrawerCloseTimer);
    _bookmarkDrawerCloseTimer = null;
  }
  $bookmarkDrawer.classList.remove("drawer-closing");
  _bookmarkDrawerLastFocus = /** @type {HTMLElement | null} */ (document.activeElement);
  $bookmarkScrim.hidden = false;
  $bookmarkDrawer.hidden = false;
  // Update toolbar visibility based on whether we're in a chapter
  const inChapter = bookId && chapter;
  $bmSaveChapterBtn.disabled = !inChapter;
  $bmSelectVersesBtn.disabled = !inChapter;
  renderBookmarkTree();
  setBookmarkBackgroundInert(true);
  const scrollY = window.scrollY;
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
  document.body.dataset.scrollY = String(scrollY);
  _bookmarkDrawerTrap = trapFocus($bookmarkDrawer);
  requestAnimationFrame(() => $bookmarkDrawerClose.focus());
}

function closeBookmarkDrawer() {
  if ($bookmarkDrawer.hidden || $bookmarkDrawer.classList.contains("drawer-closing")) return;
  closeSwipedRow(null);
  $bmOverflowPanel.hidden = true;
  $bmOverflowBtn.setAttribute("aria-expanded", "false");
  const closeSeq = ++_bookmarkDrawerCloseSeq;
  $bookmarkScrim.hidden = true;
  $bookmarkDrawer.classList.add("drawer-closing");

  // Restore body scroll and focus immediately so the page feels responsive
  setBookmarkBackgroundInert(false);
  const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollY);
  if (_bookmarkDrawerTrap) { _bookmarkDrawerTrap(); _bookmarkDrawerTrap = null; }
  if (_bookmarkDrawerLastFocus && _bookmarkDrawerLastFocus.focus) {
    try { _bookmarkDrawerLastFocus.focus(); } catch {}
  }

  let finalized = false;
  const finalize = () => {
    if (finalized || closeSeq !== _bookmarkDrawerCloseSeq) return;
    finalized = true;
    if (_bookmarkDrawerCloseTimer) {
      clearTimeout(_bookmarkDrawerCloseTimer);
      _bookmarkDrawerCloseTimer = null;
    }
    $bookmarkDrawer.hidden = true;
    $bookmarkDrawer.classList.remove("drawer-closing");
    $bookmarkDrawer.style.height = "";
    $bookmarkDrawer.style.width = "";
  };
  $bookmarkDrawer.addEventListener("animationend", finalize, { once: true });
  _bookmarkDrawerCloseTimer = setTimeout(() => {
    _bookmarkDrawerCloseTimer = null;
    finalize();
  }, 350); // fallback
}

// ── Bookmark tree rendering ──

function _bookmarkHref(bm) {
  if (bm.verseSpec === "all") return `/${bm.bookId}/${bm.chapter}`;
  return `/${bm.bookId}/${bm.chapter}/${bm.verseSpec}`;
}

function _buildBookmarkItem(bm, depth) {
  const li = el("li", { role: "treeitem", className: "bm-bookmark", "data-id": bm.id, tabIndex: "-1" });
  if (depth > 0) li.setAttribute("aria-level", String(depth + 1));
  const isActive = _isActiveBookmark(bm);
  const row = el("div", { className: "bm-bookmark-row" + (isActive ? " bm-active" : "") });
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
  const typeIcon = el("span", { className: "bm-bookmark-type-icon" });
  typeIcon.appendChild(_buildBookmarkTypeIcon(isActive));
  const link = el("a", { className: "bm-bookmark-link", href: _bookmarkHref(bm), draggable: "false" });
  link.appendChild(el("span", { className: "bm-bookmark-label" }, bm.label));
  const book = booksCache && booksCache.find(b => b.id === bm.bookId);
  const bookName = book ? (book.short_name_ko || book.name_ko) : bm.bookId;
  const refText = bm.verseSpec === "all"
    ? `${bookName} ${bm.chapter}${chUnit(bm.bookId)}`
    : `${bookName} ${bm.chapter}:${bm.verseSpec}`;
  link.appendChild(el("span", { className: "bm-bookmark-ref" }, refText));
  link.addEventListener("click", (e) => {
    e.preventDefault();
    if (row.classList.contains("bm-swiped")) {
      closeSwipedRow(null);
      return;
    }
    closeBookmarkDrawer();
    navigate(_bookmarkHref(bm));
  });

  const editAction = () => {
    closeSwipedRow(null);
    openSaveModal("edit", { existingId: bm.id });
  };
  const deleteAction = () => {
    if (!window.confirm(`"${bm.label}" 북마크를 삭제할까요?`)) return;
    closeSwipedRow(null);
    const store = loadBookmarks();
    removeItemById(store, bm.id);
    saveBookmarks(store);
    renderBookmarkTree();
    refreshBookmarkHeaderBtn();
  };

  const actions = el("div", { className: "bm-item-actions" });
  const editBtn = el("button", { className: "bm-action-btn bm-edit-btn", type: "button" }, "수정");
  editBtn.addEventListener("click", editAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);

  // Mobile swipe-to-reveal actions panel (hidden on desktop via CSS).
  // Slides in from the right and overlays the right edge of the row content.
  const mobileActions = el("div", { className: "bm-row-actions-mobile", "aria-hidden": "true" });
  const mEditBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-edit-btn",
    type: "button",
    "aria-label": `${bm.label} 수정`,
  }, "수정");
  mEditBtn.addEventListener("click", editAction);
  const mDelBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-delete-btn",
    type: "button",
    "aria-label": `${bm.label} 삭제`,
  }, "삭제");
  mDelBtn.addEventListener("click", deleteAction);
  mobileActions.appendChild(mEditBtn);
  mobileActions.appendChild(mDelBtn);

  content.appendChild(typeIcon);
  content.appendChild(link);
  content.appendChild(actions);
  row.appendChild(content);
  row.appendChild(mobileActions);
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

let _renderPathname = "";

function _isActiveBookmark(bm) {
  return _renderPathname === _bookmarkHref(bm);
}

function _hasActiveDescendant(folder) {
  for (const child of (folder.children || [])) {
    if (child.type === "bookmark" && _isActiveBookmark(child)) return true;
    if (child.type === "folder" && _hasActiveDescendant(child)) return true;
  }
  return false;
}

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

/**
 * @param {Array<{ id: string, name: string, depth: number }>} folderOptions
 * @param {string|null|undefined} selectedFolderId
 * @returns {{ el: HTMLElement, getValue: () => string|null, close: () => void }}
 */
function _buildFolderCombobox(folderOptions, selectedFolderId) {
  const initial = selectedFolderId != null && String(selectedFolderId) !== "" ? String(selectedFolderId) : "";
  const wrap = el("div", { className: "bm-folder-combobox", id: "bm-folder-combobox" });
  const hidden = el("input", { type: "hidden", className: "bm-folder-combobox-input", value: initial });
  const listId = "bm-folder-listbox";
  const iconSlot = el("span", { className: "bm-folder-combobox-btn-icon" });
  iconSlot.appendChild(_buildMaterialFolderIcon({ size: 16 }));
  const textSlot = el("span", { className: "bm-folder-combobox-btn-label" });
  const chevron = el("span", { className: "bm-folder-combobox-chevron", "aria-hidden": "true" }, "▾");
  const btn = el("button", {
    type: "button",
    id: "bm-folder-combobox-btn",
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

  // Persistent "+ 새 폴더" action at the bottom of the listbox.
  // role="presentation" so screen readers don't read it as a folder option.
  const newFolderItem = el("li", { role: "presentation", className: "bm-folder-combobox-new" });
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

  function rebuildOptions(options) {
    currentOptions = options;
    list.replaceChildren();
    addOption("", "최상위", 0);
    for (const o of options) addOption(String(o.id), o.name, o.depth);
    list.appendChild(newFolderItem);
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
  _setupDragHandle(li, row);
  const content = el("div", { className: "bm-row-content" });
  const toggle = el("span", { className: "bm-folder-toggle", "aria-hidden": "true" });
  toggle.appendChild(_buildFolderToggleIcon(expanded));
  const name = el("span", { className: "bm-folder-name" }, folder.name);
  row.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest(".bm-item-actions, .bm-row-actions-mobile")) return;
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
    if (found) found.item.name = newName.trim();
    saveBookmarks(store);
    renderBookmarkTree();
  };
  const deleteAction = () => {
    const childCount = folder.children ? folder.children.length : 0;
    const msg = childCount > 0
      ? `"${folder.name}" 폴더와 안의 항목 ${childCount}개를 모두 삭제할까요?`
      : `"${folder.name}" 폴더를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    closeSwipedRow(null);
    const store = loadBookmarks();
    removeItemById(store, folder.id);
    saveBookmarks(store);
    renderBookmarkTree();
  };

  const actions = el("div", { className: "bm-item-actions" });
  const renameBtn = el("button", { className: "bm-action-btn", type: "button" }, "수정");
  renameBtn.addEventListener("click", renameAction);
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", deleteAction);
  actions.appendChild(renameBtn);
  actions.appendChild(delBtn);

  const mobileActions = el("div", { className: "bm-row-actions-mobile", "aria-hidden": "true" });
  const mRenameBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-edit-btn",
    type: "button",
    "aria-label": `${folder.name} 수정`,
  }, "수정");
  mRenameBtn.addEventListener("click", renameAction);
  const mDelBtn = el("button", {
    className: "bm-mobile-action-btn bm-mobile-delete-btn",
    type: "button",
    "aria-label": `${folder.name} 삭제`,
  }, "삭제");
  mDelBtn.addEventListener("click", deleteAction);
  mobileActions.appendChild(mRenameBtn);
  mobileActions.appendChild(mDelBtn);

  content.appendChild(toggle);
  content.appendChild(name);
  content.appendChild(actions);
  row.appendChild(content);
  row.appendChild(mobileActions);
  li.appendChild(row);
  const children = el("ul", { role: "group", className: "bm-folder-children" });
  for (const child of (folder.children || [])) {
    children.appendChild(child.type === "folder"
      ? _buildFolderItem(child, depth + 1)
      : _buildBookmarkItem(child, depth + 1));
  }
  li.appendChild(children);
  return li;
}

function renderBookmarkTree() {
  _renderPathname = window.location.pathname;
  // The previously swiped row may be replaced when we re-render; drop the
  // stale reference held by js/app/bookmark.js.
  resetSwipedRow();
  clearNode($bookmarkDrawerBody);
  const store = loadBookmarks();
  if (!store.length) {
    $bookmarkDrawerBody.appendChild(el("li", { className: "bm-empty", role: "presentation" }, "저장된 북마크가 없습니다."));
    return;
  }
  for (const item of store) {
    $bookmarkDrawerBody.appendChild(item.type === "folder"
      ? _buildFolderItem(item, 0)
      : _buildBookmarkItem(item, 0));
  }
  // Set roving tabindex: first treeitem is reachable, rest are -1
  const items = _getVisibleTreeItems();
  items.forEach((item, i) => item.setAttribute("tabIndex", i === 0 ? "0" : "-1"));
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

// ── Save bookmark modal ──

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
    const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), article);
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

  const book = booksCache && booksCache.find(b => b.id === bookId);
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
    if (mode === "verses") exitVerseSelectMode();
  });
  cancelBtn.addEventListener("click", closeSaveModal);
  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  $bmSaveBody.appendChild(labelField);
  $bmSaveBody.appendChild(noteField);
  $bmSaveBody.appendChild(folderField);
  $bmSaveBody.appendChild(actions);

  $bmSaveScrim.hidden = false;
  $bmSaveModal.hidden = false;
  _bmSaveModalTrap = trapFocus($bmSaveModal);
  requestAnimationFrame(() => labelInput.focus());
}

function closeSaveModal() {
  const c = /** @type {HTMLElement & { _bmClose?: () => void } | null} */ (document.getElementById("bm-folder-combobox"));
  if (c && c._bmClose) c._bmClose();
  $bmSaveScrim.hidden = true;
  $bmSaveModal.hidden = true;
  if (_bmSaveModalTrap) { _bmSaveModalTrap(); _bmSaveModalTrap = null; }
}

function openNewFolderModal(onConfirm) {
  $bmNewFolderInput.value = "";
  $bmNewFolderInput.removeAttribute("aria-invalid");
  _bmNewFolderCallback = onConfirm || null;
  $bmNewFolderScrim.hidden = false;
  $bmNewFolderModal.hidden = false;
  _bmNewFolderTrap = trapFocus($bmNewFolderModal);
  requestAnimationFrame(() => $bmNewFolderInput.focus());
}

function closeNewFolderModal() {
  $bmNewFolderScrim.hidden = true;
  $bmNewFolderModal.hidden = true;
  _bmNewFolderCallback = null;
  if (_bmNewFolderTrap) { _bmNewFolderTrap(); _bmNewFolderTrap = null; }
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
  store.push({ type: "folder", id, name, children: [], expanded: false });
  saveBookmarks(store);
  renderBookmarkTree();
  const cb = _bmNewFolderCallback;
  closeNewFolderModal();
  if (cb) cb(id);
}

function commitSaveBookmark(existingId, label, note, folderId, bookId, chapter, verseSpec) {
  const store = loadBookmarks();
  if (existingId) {
    const found = _findItemInStore(store, existingId);
    if (found && found.item.type === "bookmark") {
      found.item.label = label;
      found.item.note = note;
      found.item.verseSpec = verseSpec;
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
  renderBookmarkTree();
  refreshBookmarkHeaderBtn();
  announce(existingId ? "북마크를 수정했습니다." : "북마크를 저장했습니다.");
}

// ── Merge dialog ──

/**
 * @param {BookmarkTreeBookmark[]} candidates
 * @param {string} incomingSpec
 * @param {string} mode
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

  $bmMergeScrim.hidden = false;
  $bmMergeModal.hidden = false;
  _bmMergeModalTrap = trapFocus($bmMergeModal);
  requestAnimationFrame(() => $bmMergeYes.focus());

  function cleanup() {
    $bmMergeScrim.hidden = true;
    $bmMergeModal.hidden = true;
    if (_bmMergeModalTrap) { _bmMergeModalTrap(); _bmMergeModalTrap = null; }
    $bmMergeYes.onclick = null;
    $bmMergeNo.onclick = null;
    $bmMergeCancel.onclick = null;
  }

  $bmMergeYes.onclick = () => {
    const merged = mergeVerseSpecs(target.verseSpec ?? "all", incomingSpec);
    const store = loadBookmarks();
    const found = _findItemInStore(store, target.id);
    if (found && found.item.type === "bookmark") {
      found.item.verseSpec = merged;
      // Sync label to reflect the merged verse spec
      const targetBookId = target.bookId ?? "";
      const book = booksCache && booksCache.find((b) => b.id === targetBookId);
      const bookName = book ? (book.short_name_ko || book.name_ko) : targetBookId;
      const unit = chUnit(targetBookId);
      found.item.label = merged === "all"
        ? `${bookName} ${target.chapter}${unit}`
        : `${bookName} ${target.chapter}:${merged}`;
    }
    saveBookmarks(store);
    renderBookmarkTree();
    refreshBookmarkHeaderBtn();

    if (mode === "verses") exitVerseSelectMode();
    announce("북마크를 합쳤습니다.");
    cleanup();
  };

  $bmMergeNo.onclick = () => {
    cleanup();
    _showSaveModal(mode, resolvedBookId, resolvedChapter, incomingSpec, null);
  };

  $bmMergeCancel.onclick = cleanup;
}

// ── Export / Import bookmarks (Phase 2a) ──

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

let _bmImportModalTrap = null;

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

function openImportModal(incoming) {
  const bmCount = _countBookmarks(incoming.bookmarks);
  clearNode($bmImportBody);
  $bmImportBody.appendChild(
    el("p", {}, `북마크 ${bmCount}개를 현재 목록에 병합하거나 덮어쓸 수 있습니다.`)
  );

  $bmImportScrim.hidden = false;
  $bmImportModal.hidden = false;
  _bmImportModalTrap = trapFocus($bmImportModal);
  requestAnimationFrame(() => $bmImportMerge.focus());

  function cleanup() {
    $bmImportScrim.hidden = true;
    $bmImportModal.hidden = true;
    if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
    $bmImportMerge.onclick = null;
    $bmImportOverwrite.onclick = null;
    $bmImportCancel.onclick = null;
    $bmImportInput.value = "";
  }

  $bmImportMerge.onclick = () => {
    const existing = loadBookmarks();
    const merged = _mergeBookmarkStores(existing, incoming.bookmarks);
    saveBookmarks(merged);
    renderBookmarkTree();
    announce("북마크를 병합했습니다.");
    cleanup();
  };

  $bmImportOverwrite.onclick = () => {
    saveBookmarks(incoming.bookmarks);
    renderBookmarkTree();
    announce("북마크를 덮어썼습니다.");
    cleanup();
  };

  $bmImportCancel.onclick = cleanup;
}

// ── Verse selection mode ──

// Flatten the inner corners between adjacent selected verses so a run of
// consecutive selections renders as a single highlighted block.
function updateVerseSelectionBoundaries(scope) {
  const root = scope || document;
  const verses = [...root.querySelectorAll(".verse[data-vref]")];
  for (let i = 0; i < verses.length; i++) {
    const v = verses[i];
    const sel = v.classList.contains("verse-selected");
    const prevSel = sel && i > 0 && verses[i - 1].classList.contains("verse-selected");
    const nextSel = sel && i < verses.length - 1 && verses[i + 1].classList.contains("verse-selected");
    v.classList.toggle("verse-selected-join-prev", prevSel);
    v.classList.toggle("verse-selected-join-next", nextSel);
  }
}

function enterVerseSelectMode(bookId, chapter) {
  readingContext.verseSelectMode = true;
  readingContext.selectedVerses.clear();
  readingContext.bookId = bookId;
  readingContext.chapter = chapter;
  document.body.classList.add("verse-select-active");
  $verseSelectBar.hidden = false;
  updateVerseSelectBar();
  announce("절 선택 모드. 절을 탭해서 선택하세요.");
}

function exitVerseSelectMode() {
  readingContext.verseSelectMode = false;
  readingContext.selectedVerses.clear();
  document.body.classList.remove("verse-select-active");
  $verseSelectBar.hidden = true;
  document.querySelectorAll(".verse-selected, .verse-selected-join-prev, .verse-selected-join-next")
    .forEach(v => v.classList.remove("verse-selected", "verse-selected-join-prev", "verse-selected-join-next"));
}

function updateVerseSelectBar() {
  const count = readingContext.selectedVerses.size;
  if (count === 0) {
    $verseSelectCount.textContent = "절을 눌러 선택하세요.";
  } else {
    const articleEl = document.querySelector("article.chapter-text");
    const refs = collapseFullVerseRefs(Array.from(readingContext.selectedVerses), articleEl);
    const spec = refs.length
      ? selectedVersesToSpec(refs)
      : selectedVersesToSpec(Array.from(readingContext.selectedVerses));
    $verseSelectCount.textContent = `${spec.replace(/,/g, ', ')}절 선택됨`;
  }
  $verseSelectBookmarkBtn.disabled = count === 0;
}

// ── Drawer toolbar event handlers ──

$bookmarkDrawerClose.addEventListener("click", closeBookmarkDrawer);
$bookmarkScrim.addEventListener("click", closeBookmarkDrawer);

$bmSaveClose.addEventListener("click", closeSaveModal);
$bmSaveScrim.addEventListener("click", closeSaveModal);

$bmNewFolderClose.addEventListener("click", closeNewFolderModal);
$bmNewFolderScrim.addEventListener("click", closeNewFolderModal);
$bmNewFolderCancel.addEventListener("click", closeNewFolderModal);
$bmNewFolderConfirm.addEventListener("click", _commitNewFolder);
$bmNewFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); _commitNewFolder(); }
  else if (e.key === "Escape") { e.preventDefault(); closeNewFolderModal(); }
});

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
    store.push({ type: "folder", id: generateId(), name, children: [], expanded: false });
    saveBookmarks(store);
    renderBookmarkTree();
    cleanup();
  }

  confirmBtn.addEventListener("click", commit);
  cancelBtn.addEventListener("click", cleanup);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") cleanup();
  });

  form.appendChild(input);
  form.appendChild(confirmBtn);
  form.appendChild(cancelBtn);
  toolbar.appendChild(form);
  requestAnimationFrame(() => input.focus());
});

$verseSelectCancelBtn.addEventListener("click", exitVerseSelectMode);
$verseSelectBookmarkBtn.addEventListener("click", () => openSaveModal("verses"));

$bmOverflowBtn.addEventListener("click", () => {
  const isOpen = !$bmOverflowPanel.hidden;
  $bmOverflowPanel.hidden = isOpen;
  $bmOverflowBtn.setAttribute("aria-expanded", String(!isOpen));
});

$bmExportBtn.addEventListener("click", exportBookmarks);

$bmImportBtn.addEventListener("click", () => {
  $bmImportInput.value = "";
  $bmImportInput.click();
});

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

$bmImportScrim.addEventListener("click", () => {
  if (!$bmImportModal.hidden) {
    $bmImportScrim.hidden = true;
    $bmImportModal.hidden = true;
    if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
    $bmImportMerge.onclick = null;
    $bmImportOverwrite.onclick = null;
    $bmImportCancel.onclick = null;
    $bmImportInput.value = "";
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$bmImportModal.hidden) {
      $bmImportScrim.hidden = true;
      $bmImportModal.hidden = true;
      if (_bmImportModalTrap) { _bmImportModalTrap(); _bmImportModalTrap = null; }
      $bmImportMerge.onclick = null;
      $bmImportOverwrite.onclick = null;
      $bmImportCancel.onclick = null;
      $bmImportInput.value = "";
      return;
    }
    if (!$bmMergeModal.hidden) {
      $bmMergeScrim.hidden = true;
      $bmMergeModal.hidden = true;
      if (_bmMergeModalTrap) { _bmMergeModalTrap(); _bmMergeModalTrap = null; }
      $bmMergeYes.onclick = null;
      $bmMergeNo.onclick = null;
      $bmMergeCancel.onclick = null;
      return;
    }
    if (!$bmSaveModal.hidden) { closeSaveModal(); return; }
    if (!$bookmarkDrawer.hidden) { closeBookmarkDrawer(); return; }
    if (readingContext.verseSelectMode) { exitVerseSelectMode(); return; }
  }
});

// ── Service Worker Registration & Update ──
// Invoked from the deferred startup hook (DOMContentLoaded → requestIdleCallback)
// so SW lookup, update checks, and shell pre-caching never block first paint.

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Ask the waiting SW for the version it has cached, since loadVersion()
  // returns the version of the currently running app (served by the active SW).
  // Falls back to "" on timeout/error so the toast still renders.
  function fetchWaitingVersion(waitingSW) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      let settled = false;
      const finish = (v) => {
        if (settled) return;
        settled = true;
        resolve(v || "");
      };
      channel.port1.onmessage = (e) => finish(e.data && e.data.version);
      try {
        waitingSW.postMessage({ type: "GET_VERSION" }, [channel.port2]);
      } catch {
        finish("");
        return;
      }
      setTimeout(() => finish(""), 1500);
    });
  }

  async function showUpdateToast(waitingSW) {
    // Prevent duplicate toasts
    if (document.getElementById("sw-update-toast")) return;
    const version = await fetchWaitingVersion(waitingSW);
    const btn = el("button", { id: "sw-update-btn", "aria-label": "새 버전이 있습니다." }, "업데이트");
    const releaseUrl = version
      ? `https://github.com/anglican-kr/common-bible/releases/tag/${encodeURIComponent(version)}`
      : "https://github.com/anglican-kr/common-bible/releases";
    const versionLink = el("a", {
      href: releaseUrl,
      target: "_blank",
      rel: "noopener noreferrer",
      id: "sw-update-release-link",
    }, version || "최신 버전");
    const toast = el("div", { id: "sw-update-toast", role: "alert", "aria-label": "앱 업데이트 알림" },
      el("span", {}, "새 버전이 있습니다: "),
      versionLink,
      btn,
    );
    btn.addEventListener("click", () => {
      waitingSW.postMessage({ type: "SKIP_WAITING" });
      toast.remove();
    });
    document.body.appendChild(toast);
  }

  function trackInstalling(reg) {
    if (!reg.installing) return;
    reg.installing.addEventListener("statechange", () => {
      if (reg.waiting) showUpdateToast(reg.waiting);
    });
  }

  // Poll for a new SW at most once per hour, and only while the tab is visible
  // and online — a phone in the user's pocket performs zero update traffic.
  // visibilitychange/online also retrigger the check on tab return / reconnect,
  // since interval timers are heavily throttled in hidden tabs.
  const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
  function schedulePeriodicUpdate(reg) {
    let lastCheck = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (navigator.onLine === false) return;
      const now = Date.now();
      if (now - lastCheck < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheck = now;
      reg.update().catch(() => {});
    };
    setInterval(tick, UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
  }

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    // A waiting SW already exists (e.g. installed on a previous visit)
    if (reg.waiting) showUpdateToast(reg.waiting);
    // A new SW is being installed right now
    else if (reg.installing) trackInstalling(reg);
    // Listen for future updates — fired when reg.update() finds a new SW too
    reg.addEventListener("updatefound", () => trackInstalling(reg));
    schedulePeriodicUpdate(reg);
  }).catch(() => {});
}

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
