"use strict";
// @ts-check
// ADR-012 2차 적용 2라운드 종료 시점에 영구 활성화. Phase 8(2026-05-10)에
// app.js가 ~280줄의 부트스트랩으로 축소된 후 추가됨. tsconfig.app.json은
// 동시에 삭제됐고, 이제 메인 tsconfig.json(checkJs: false + 모듈별 opt-in)
// 한 곳에서만 검증한다.

// ── app-main ──
// app.js is the residual app-bootstrap module after the ADR-018 modular
// split (Phases 1–8). It owns: the document-level Accessibility keydown
// handler (Escape + spacebar audio toggle), `clearAllCaches`, the
// visibilitychange handler (audio cache soft-cap eviction + Drive sync
// trigger on tab return), `registerServiceWorker`, and the
// DOMContentLoaded bootstrap that kicks off route() and the deferred
// init chain. Everything else lives in js/app/*.js or js/sync/*.js.

const { _$, el } = window.appHelpers;
const {
  loadFontSize, loadTheme, loadColorScheme, loadCiteShow,
} = window.appStorage;
const {
  initSettings, applyFontSize, applyTheme, applyColorScheme, applyCiteShow,
} = window.appSettings;

// Re-expose on window so the sync layer (state-machine.js) can apply Drive
// settings updates via its `typeof window.applyXxx === "function"` guards.
// `const` destructure does not auto-register on window — must be explicit.
window.applyFontSize = applyFontSize;
window.applyTheme = applyTheme;
window.applyColorScheme = applyColorScheme;
window.applyCiteShow = applyCiteShow;

// Cross-module bare-global facade for what app.js itself owns. Other
// modules (settings-ui, bookmark) call `announce(...)` and
// `clearAllCaches()` as bare globals; the assignments here promote the
// module-scoped functions to globalThis.
window.announce = announce;
window.clearAllCaches = clearAllCaches;

// DOM anchors used directly by this module's handlers.
const $announce = _$("a11y-announce");
const $searchSheet = _$("search-sheet");

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
      document.querySelectorAll(".chapter-popover:not([hidden]), .settings-popover:not([hidden])")
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

// ── Audio cache LRU helpers (ADR-016) ──

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
    // made on another device are reflected without a manual reload. pollSync
    // applies a throttle (POLL_THROTTLE_MS) so rapid tab switches don't fan
    // out into back-to-back full sync cycles — the 304 fast path isn't
    // currently free in practice (each GET is a 1+s round-trip with status
    // 200, see sync debug log analysis), so swallowing redundant polls is the
    // cheaper option until ETag conditional-GET observability lands.
    window.driveSync?.pollSync?.();
  }
});

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

// Apply saved settings on load
window.syncStoreV2?.migrateLegacyIfNeeded();
window.syncStoreV2?.sweepTombstones();
// Load the notes IDB cache into memory + restore any durability draft (ADR-026).
window.notesStore?.init();
applyFontSize(loadFontSize());
applyTheme(loadTheme());
applyColorScheme(loadColorScheme());
applyCiteShow(loadCiteShow());
initSettings();
window.appCitations?.initCiteSheet();
window.appParallels?.initParallels();


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

    // Manual check trigger — settings panel's "업데이트 지금 확인" button calls
    // this. Returns a small status object so the caller can render transient
    // feedback ("최신 버전" / "업데이트 발견" / "오류"). The actual update
    // banner is the same toast the automatic flow uses.
    /** @returns {Promise<{ok: boolean, status?: string, reason?: string}>} */
    window.checkForUpdates = async () => {
      try {
        if (reg.waiting) {
          showUpdateToast(reg.waiting);
          return { ok: true, status: "waiting" };
        }
        if (reg.installing) return { ok: true, status: "installing" };
        await reg.update();
        if (reg.waiting) {
          showUpdateToast(reg.waiting);
          return { ok: true, status: "waiting" };
        }
        if (reg.installing) return { ok: true, status: "installing" };
        return { ok: true, status: "up-to-date" };
      } catch (_) {
        return { ok: false, reason: "error" };
      }
    };
  }).catch(() => {});
}

// ── Bootstrap ──
// All deferred init calls below resolve via the window facade set by their
// owning module: route / loadVersion / initCompactHeader (views-routing.js),
// initSheetDrag (search.js), initBookmarkSheetDrag / initBookmarkDrawerResize
// (bookmark.js), maybeShowInstallNudge (install.js). registerServiceWorker
// is module-local to this file.
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
      initScrollElevation();
      window.appBottomNav?.init();
      initSheetDrag();
      initBookmarkSheetDrag();
      initBookmarkDrawerResize();
      registerServiceWorker();
      // Manifest-driven lazy cache invalidation (ADR-021). Runs after SW
      // registration so cache.open targets the freshly named caches; safe
      // when SW is still installing — diff is a no-op without entries.
      if (window.manifestSync) {
        window.manifestSync.syncManifests().catch(() => { /* best-effort */ });
      }
      maybeShowInstallNudge();
      if (window.driveSync) window.driveSync.initDriveSync();
    });
  });
});

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
