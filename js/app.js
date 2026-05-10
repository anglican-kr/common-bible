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
// Routing + rendering facade entries (parsePath / route / navigate /
// hideAudioBar / renderError + setTitle / setBreadcrumb / getBooksCache)
// moved to views-routing.js (ADR-018 Phase 7) alongside their owning
// functions — keeping the assignments here would `ReferenceError` at
// module-load time since the bare names are no longer in scope.
// `openDriveDisconnectModal` was extracted to bookmark.js (Phase 6b).
window.clearAllCaches = clearAllCaches;

// Anchors retained here — still referenced by app.js's `announce()`
// ($announce) and Escape keydown handler ($searchSheet). All other
// $X anchors moved to their owning modules in earlier phases (helpers /
// storage / settings-ui / install / search / bookmark / views-routing).
const $announce = _$("a11y-announce");
const $searchSheet = _$("search-sheet");

// `booksCache` / `appVersion` / `currentAudio` / `_audioController` /
// `_audioSaveTimer` were extracted to js/app/views-routing.js
// (ADR-018 Phase 7a/7b). `_scrollTrackCleanup` / `_isInitialLoad` /
// `startScrollTracking` moved with them.

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
  // Space to toggle audio playback (when not in an input/button). Audio
  // Player state lives in views-routing.js (Phase 7b) — read via window
  // getter; null while no chapter audio is loaded.
  const audio = window.getCurrentAudio?.();
  const target = e.target;
  if (e.key === " " && audio && target instanceof Element && !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    e.preventDefault();
    if (audio.paused) audio.play(); else audio.pause();
  }
});

// ── Reading position persistence ──
// Storage key constants + load/save helpers were extracted to
// js/app/storage.js (ADR-018 Phase 2). `SEARCH_HISTORY_VISIBLE` moved to
// js/app/search.js (Phase 5) — search history panel controller is the only
// consumer.

// Reading position helpers (`saveReadingPosition` / `loadReadingPosition` /
// `saveAudioTime` / `loadAudioTime` / `clearAudioTime`) live in
// js/app/storage.js (ADR-018 Phase 2). `startScrollTracking` and the
// `_scrollTrackCleanup` / `_isInitialLoad` state moved to
// js/app/views-routing.js with the rest of Routing (ADR-018 Phase 7b).

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


// PWA install detection + Install guide modal + Install nudge auto-show
// live in js/app/install.js (ADR-018 Phase 4). Loaded as ESM in index.html;
// the module assigns `window.install` / `window.openInstallModal` /
// `window.maybeShowInstallNudge` for legacy callers (settings popover +
// app.js bootstrap).
//
// Background-inert helper shared with the bookmark drawer/sheet UI. Moves
// alongside bookmark UI when Phase 6 ships.
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

// ── Bootstrap ──
// route() / loadVersion() / initCompactHeader() / maybeShowInstallNudge() —
// all bare-global resolves via window facade set by views-routing.js /
// install.js. initSheetDrag (search.js), initBookmarkSheetDrag /
// initBookmarkDrawerResize (still in app.js, Phase 8 cleanup), and
// registerServiceWorker (this file) are module-local hoisted functions.
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

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
