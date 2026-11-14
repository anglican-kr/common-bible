// @ts-check
"use strict";

// PWA install detection + Install guide modal + Install nudge auto-show.
// Phase 4 of the app.js modularization (ADR-018). First module written in
// the ESM-preferred pattern (ADR-019): named exports + window facade for
// legacy callers.

/** @typedef {import("../types.js").InstallNudgeState} InstallNudgeState */
/** @typedef {import("../types.js").InstallObject} InstallObject */

const { _$, el, clearNode } = window.appHelpers;
const { createOverlay } = window.appOverlay;
const { _loadNudgeState, _saveNudgeState } = window.appStorage;

// Platform detection states:
//   "installed"    — already running as a standalone PWA, nothing to show
//   "in-app"       — in-app browser (KakaoTalk, Line, …); cannot install, open in the device browser
//   "ios-safari"   — iPhone/iPad Safari; manual "Add to Home Screen" guide
//   "ios-other"    — iOS 17+ Chrome/Firefox/Edge/etc; share-menu install guide
//   "ios-legacy"   — iOS ≤16 non-Safari (Add-to-Home-Screen unsupported); open in Safari
//   "android"      — Chromium-based Android; beforeinstallprompt available
//   "desktop"      — Chromium-based desktop; beforeinstallprompt available
//   "unsupported"  — Firefox/Safari desktop, etc; hide install entry
//
// beforeinstallprompt is captured and stored so the install modal can call prompt()
// on user gesture. The `appinstalled` event and display-mode change both flip state.

// ── BEGIN IN_APP ──
// Exercised by tests/unit/install.test.js. In-app browsers (the web view a
// messenger or SNS app opens links in) cannot install a PWA: no "Add to Home
// Screen", no beforeinstallprompt, and storage is separate from the device
// browser. We detect them by UA token and hand the current URL to the device
// browser (ADR-008 §7).

// Apps known to handle the hand-off URLs below. Anything else that looks like
// a web view is "webview": detected, but never redirected automatically —
// an Android web view that does not handle intent:// shows an error page
// (ERR_UNKNOWN_URL_SCHEME) instead of the text.
/** @type {Array<[string, RegExp]>} */
const IN_APP_TOKENS = [
  // Upper case only: the link-preview crawler sends "kakaotalk-scrap".
  ["kakaotalk", /KAKAOTALK/],
  ["line", /\bLine\//],
  ["naver", /NAVER\(inapp/i],
  ["instagram", /Instagram/],
  ["facebook", /FBAN|FBAV|FB_IAB/],
];

const IN_APP_LEFT_KEY = "bible-inapp-left";
// This tab is the Naver app acting as the device's default browser (Android).
const IN_APP_HOME_KEY = "bible-inapp-home";
// Line hands a URL carrying this query to the device browser. Every hand-off
// URL carries it, as the mark of "already handed off": opened in an in-app
// browser again (Line ignored it, the Android fallback URL reloaded the page,
// or the default browser is itself an in-app one), we do not hand off twice.
const HAND_OFF_PARAM = "openExternalBrowser";
// Give up the hand-off when the load event takes longer than this — a late
// redirect would pull away someone who is already reading.
const HAND_OFF_LOAD_WAIT_MS = 3000;
// A hand-off that worked puts another app in front and hides this document.
// Still visible after this long means it failed.
const HAND_OFF_CHECK_MS = 2500;
// The check timer firing this much later than scheduled means the web view
// was suspended meanwhile — it was away without telling us.
const HAND_OFF_LATE_MS = 1500;

// Tokens the non-Safari iOS browsers add to the UA. Safari has none of them.
const IOS_BROWSER_TOKENS = /CriOS|FxiOS|EdgiOS|OPiOS|GSA/;

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+
}

// Returns the iOS major version, or 0 if not iOS / version is unknown.
// Sources, in order of reliability:
//   1. "CPU iPhone OS X_Y" / "CPU OS X_Y" — present on iPhone and on iPad
//      when not in desktop-class UA mode. Reliable.
//   2. "Version/X.Y" — Safari's marketing version, which tracks iOS major.
//      Fallback for iPadOS desktop-class UA (masquerades as Mac).
//   3. iPad-masking with no Version/ token (e.g. CriOS on iPad in desktop
//      mode) — assume 17 (modern), since older iPadOS Chrome did not mask.
function getIOSMajor() {
  const ua = navigator.userAgent;
  const osMatch = ua.match(/OS (\d+)_/);
  if (osMatch) return parseInt(osMatch[1], 10);
  const isIPadMask = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (!isIPadMask) return 0;
  const verMatch = ua.match(/Version\/(\d+)/);
  if (verMatch) return parseInt(verMatch[1], 10);
  return 17; // best-effort: modern iPadOS without Version/ token
}

// The value of the hand-off mark on the current address, or null.
// "1": handed off. "0": the Android fallback URL — the hand-off failed.
function handOffMark() {
  try { return new URL(location.href).searchParams.get(HAND_OFF_PARAM); } catch { return null; }
}

// On Android the Naver app can be the default browser, and its menu has
// "홈 화면에 추가". A handed-off URL (mark "1") opening in the Naver app means
// exactly that: the default browser took it, and it is Naver. Such a tab is
// an ordinary Android browser to us — no hand-off, no "cannot install" guide.
// dropHandOffQuery records it for the tab session and drops the mark.
// iOS Naver has no "Add to Home Screen", so the rule is Android only.
/** @param {{ app: string; ios: boolean }} inApp */
function isDefaultBrowserTab(inApp) {
  if (inApp.app !== "naver" || inApp.ios) return false;
  if (handOffMark() === "1") return true;
  try { return sessionStorage.getItem(IN_APP_HOME_KEY) === "1"; } catch { return false; }
}

/** @returns {{ app: string; ios: boolean } | null} */
function detectInAppBrowser() {
  const inApp = _detectInAppByUA();
  return inApp && isDefaultBrowserTab(inApp) ? null : inApp;
}

/** @returns {{ app: string; ios: boolean } | null} */
function _detectInAppByUA() {
  const ua = navigator.userAgent;
  const ios = isIOSDevice();
  for (const [app, re] of IN_APP_TOKENS) {
    if (re.test(ua)) return { app, ios };
  }
  // Generic web views. Android marks them with "; wv)". On iOS Safari carries
  // a "Safari/" token and the other browsers their own (CriOS, FxiOS, …);
  // a bare WKWebView has neither.
  if (!ios && /Android/.test(ua) && /; wv\)/.test(ua)) return { app: "webview", ios };
  if (ios && !/Safari\//.test(ua) && !IOS_BROWSER_TOKENS.test(ua)) return { app: "webview", ios };
  return null;
}

// The URL that makes the in-app browser hand `href` to the device browser,
// or null when there is no known way (unknown web view, iOS ≤16).
/**
 * @param {{ app: string; ios: boolean }} inApp
 * @param {string} href
 * @returns {string | null}
 */
function externalBrowserUrl(inApp, href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (inApp.app === "webview") return null;
  const scheme = u.protocol.slice(0, -1);
  u.searchParams.set(HAND_OFF_PARAM, "1");

  if (inApp.app === "kakaotalk") {
    return "kakaotalk://web/openExternal?url=" + encodeURIComponent(u.href);
  }
  // Line reloads the URL in the device browser when it sees the query.
  if (inApp.app === "line") return u.href;

  if (inApp.ios) {
    // x-safari-https:// opens Safari from iOS 17. Undocumented by Apple.
    const major = getIOSMajor();
    if (major && major < 17) return null;
    return `x-safari-${scheme}://${u.host}${u.pathname}${u.search}${u.hash}`;
  }
  // Android: an intent with no package resolves to the default browser.
  // The fragment is dropped — "#Intent" owns it. With no browser to take it,
  // the web view loads the fallback URL (this same page) instead of an error.
  const intent = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${scheme};`;
  u.searchParams.set(HAND_OFF_PARAM, "0"); // the fallback URL says "it failed"
  return `${intent}S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
}

// True when this page was opened from a hand-off URL.
function hasHandOffMark() {
  return handOffMark() !== null;
}

// The current address without the hand-off mark — what the user should copy.
function shareableHref() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete(HAND_OFF_PARAM);
    return u.href;
  } catch {
    return location.href;
  }
}

// Arrived in the device browser (or the installed app) — drop the hand-off
// mark from the address. Inside an in-app browser it stays: it is the loop
// guard. Called at module load, before routing reads the URL.
function dropHandOffQuery() {
  if (detectInAppBrowser() && !install.isStandalone()) return;
  if (!hasHandOffMark()) return;
  const byUA = _detectInAppByUA();
  if (byUA && isDefaultBrowserTab(byUA)) {
    // Naver as the default browser: remember it before the mark goes. If it
    // cannot be remembered the mark stays, or a reload would hand off again.
    try { sessionStorage.setItem(IN_APP_HOME_KEY, "1"); } catch { return; }
  }
  try {
    const u = new URL(shareableHref());
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
  } catch {}
}

// The hand-off URL for this page load, or null when we stay: not an in-app
// browser, no known way out, already handed off once (the mark, or this tab
// session's record). Judged once per page load so the nudge and the hand-off
// cannot disagree; cleared when the hand-off starts or is given up.
/** @type {string | null | undefined} */
let _handOffDecision;
function handOffUrl() {
  if (_handOffDecision === undefined) _handOffDecision = _judgeHandOff();
  return _handOffDecision;
}
function _judgeHandOff() {
  const inApp = detectInAppBrowser();
  if (!inApp) return null;
  if (install.isStandalone()) return null;
  if (hasHandOffMark()) return null;
  const url = externalBrowserUrl(inApp, location.href);
  if (!url) return null;
  try {
    if (sessionStorage.getItem(IN_APP_LEFT_KEY)) return null;
  } catch {
    return null; // cannot remember the attempt — never risk a redirect loop
  }
  return url;
}

// Called by the app.js bootstrap after the first view is on screen, and the
// hand-off itself waits for the load event — one started while the document
// is still loading stops the remaining scripts and the load event (seen in
// Chromium), leaving a blank or forever-loading page behind if it fails.
// Returns true when a hand-off was started. One attempt per tab session: if
// it failed, or the user comes back to the in-app browser and reloads, we stay.
// When the hand-off does not happen (load too slow, attempt cannot be
// recorded) or does not work (the document is still in front afterwards),
// the install guide opens instead.
function maybeLeaveInAppBrowser() {
  const url = handOffUrl();
  if (!url) return false;
  const viaReplace = detectInAppBrowser()?.app === "line";
  let settled = false;

  // Record the attempt. False when it cannot be recorded.
  const settle = () => {
    settled = true;
    _handOffDecision = null;
    try {
      sessionStorage.setItem(IN_APP_LEFT_KEY, "1");
      return true;
    } catch {
      return false;
    }
  };

  const go = () => {
    if (settled) return;
    if (!settle()) { showInAppGuide(); return; }
    // A hand-off that worked puts another app in front. Some web views are
    // suspended before they report it, so a timer that fires late also
    // counts as "we were away".
    const started = Date.now();
    let left = document.visibilityState === "hidden";
    const onAway = () => { left = true; };
    const onVisibility = () => { if (document.visibilityState === "hidden") left = true; };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onAway);
    window.addEventListener("blur", onAway);
    setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onAway);
      window.removeEventListener("blur", onAway);
      const late = Date.now() - started > HAND_OFF_CHECK_MS + HAND_OFF_LATE_MS;
      if (!left && !late) showInAppGuide();
    }, HAND_OFF_CHECK_MS);
    if (viaReplace) location.replace(url);
    else location.href = url;
  };

  if (document.readyState === "complete") {
    go();
  } else {
    window.addEventListener("load", go, { once: true });
    setTimeout(() => {
      if (settled) return;
      // Recorded too: a reload of this tab must not pull the reader away either.
      settle();
      window.removeEventListener("load", go);
      showInAppGuide();
    }, HAND_OFF_LOAD_WAIT_MS);
  }
  return true;
}
// ── END IN_APP ──

// ── BEGIN INSTALL_STATE ──
// Exercised by tests/unit/install.test.js. Platform detection state machine
// + beforeinstallprompt / appinstalled / display-mode listeners. Does NOT
// touch DOM beyond window.matchMedia + navigator. The IIFE returns the
// public install API; the IIFE-internal `deferredPrompt` and `listeners`
// are observable only via subscribe()/triggerPrompt()/notify().
/** @type {InstallObject} */
const install = (() => {
  /** @type {any} */
  let deferredPrompt = null;
  /** @type {Set<(s: { platform: string; canPrompt: boolean }) => void>} */
  const listeners = new Set();

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      /** @type {any} */ (window.navigator).standalone === true
    );
  }

  function detectPlatform() {
    if (isStandalone()) return "installed";
    if (detectInAppBrowser()) return "in-app";
    const ua = navigator.userAgent;
    if (isIOSDevice()) {
      // All iOS browsers wrap WebKit. Safari UA omits the CriOS/FxiOS/etc tokens.
      const isSafari = !IOS_BROWSER_TOKENS.test(ua);
      if (isSafari) return "ios-safari";
      // iOS 17+ exposes "Add to Home Screen" inside Chrome/Firefox/Edge/Opera
      // share sheets, and the resulting icon launches in standalone mode.
      return getIOSMajor() >= 17 ? "ios-other" : "ios-legacy";
    }
    if (deferredPrompt) {
      // Android UA: "Android" token. Otherwise treat as desktop.
      return /Android/.test(ua) ? "android" : "desktop";
    }
    // No beforeinstallprompt seen yet — guess from UA.
    if (/Android/.test(ua)) return "android";
    const isChromium = /Chrome|Chromium|Edg/.test(ua) && !/Edge\//.test(ua);
    return isChromium ? "desktop" : "unsupported";
  }

  function notify() {
    const state = { platform: detectPlatform(), canPrompt: !!deferredPrompt };
    listeners.forEach((fn) => { try { fn(state); } catch {} });
  }

  /** @param {(state: { platform: string; canPrompt: boolean }) => void} fn */
  function subscribe(fn) {
    listeners.add(fn);
    fn({ platform: detectPlatform(), canPrompt: !!deferredPrompt });
    return () => listeners.delete(fn);
  }

  async function triggerPrompt() {
    if (!deferredPrompt) return { outcome: "unavailable" };
    const evt = deferredPrompt;
    deferredPrompt = null;
    notify();
    evt.prompt();
    const choice = await evt.userChoice;
    return { outcome: choice.outcome };
  }

  // Note: we intentionally do NOT call e.preventDefault() here.
  // Modern Chromium (>=76) no longer auto-shows a mini-infobar, and calling
  // preventDefault() without a matching prompt() produces a noisy console
  // warning ("Banner not shown: beforeinstallpromptevent.preventDefault()
  // called..."). Capturing the event is sufficient to defer the prompt.
  window.addEventListener("beforeinstallprompt", (e) => {
    deferredPrompt = e;
    notify();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });

  // display-mode changes when the PWA is launched after install.
  try {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", notify);
  } catch {}

  return { isStandalone, detectPlatform, subscribe, triggerPrompt };
})();
// ── END INSTALL_STATE ──

dropHandOffQuery();

// Tag the document so CSS can distinguish a real browser tab from a
// standalone PWA. CSS @media (display-mode: browser) is unreliable on Safari,
// which reports browser mode even in installed standalone (mdn/browser-compat-data
// #18807) — the same WebKit quirk isStandalone() compensates for above.
// Re-synced on display-mode change to cover the desktop "install while open"
// flow where the same document transitions from tab to standalone window.
function syncDisplayMode() {
  document.documentElement.dataset.displayMode = install.isStandalone() ? "standalone" : "browser";
}
syncDisplayMode();
try {
  window.matchMedia("(display-mode: standalone)").addEventListener("change", syncDisplayMode);
} catch {}

// ── Install guide modal ──

const $installScrim = _$("install-scrim");
const $installModal = _$("install-modal");
const $installModalBody = _$("install-modal-body");
const $installModalClose = _$("install-modal-close");

// Modal lifecycle (scrim/hidden/inert/focus-trap/focus-restore) now lives in
// the overlay controller (ADR-032). Background scroll-lock + neverShow
// persistence + carousel cleanup are install-specific, handled via onOpen/onClose.

// Elements that become inert (background) while the install modal is open —
// passed to the overlay controller, which applies/clears inert itself (ADR-032).
const INSTALL_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #launch-screen, #bookmark-scrim, #bookmark-drawer, #verse-select-bar, #bm-select-bar";

function _buildNeverShowRow() {
  const row = el("div", { className: "install-never-show-row" });
  const checkbox = el("input", { type: "checkbox", id: "install-never-show" });
  const label = el("label", { for: "install-never-show" }, " 다시 열지 않음");
  row.appendChild(checkbox);
  row.appendChild(label);
  return row;
}

// "주소 복사" button. Many in-app web views have no Clipboard API, so fall back
// to execCommand, and when that fails too show the address in a field the
// user can long-press and copy. The outcome goes into a status region that
// exists from the start, so screen readers announce it.
/** @param {string} text */
function _buildCopyButton(text) {
  const wrap = el("div", { className: "install-copy" });
  const btn = el("button", { className: "install-cta", type: "button" }, "주소 복사");
  const status = el("p", { className: "install-note install-copy-status", role: "status" });
  const copied = () => {
    btn.textContent = "복사됨";
    status.textContent = "주소를 복사했습니다.";
    setTimeout(() => { btn.textContent = "주소 복사"; }, 2000);
  };
  // Copies a selected text node — focus stays on the button.
  const legacyCopy = () => {
    const span = el("span", { className: "install-copy-source" }, text);
    wrap.appendChild(span);
    const sel = window.getSelection();
    let ok = false;
    try {
      const range = document.createRange();
      range.selectNodeContents(span);
      sel?.removeAllRanges();
      sel?.addRange(range);
      ok = document.execCommand("copy");
    } catch {}
    sel?.removeAllRanges();
    span.remove();
    return ok;
  };
  const showField = () => {
    if (!wrap.querySelector(".install-url-field")) {
      const field = /** @type {HTMLInputElement} */ (el("input", {
        className: "install-url-field", type: "text", readonly: "", "aria-label": "이 쪽의 주소",
      }));
      field.value = text;
      field.addEventListener("focus", () => field.select());
      wrap.insertBefore(field, status);
    }
    status.textContent = "복사하지 못했습니다. 위 주소를 길게 눌러 복사해 주세요.";
  };
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      copied();
    } catch {
      if (legacyCopy()) copied();
      else showField();
    }
  });
  wrap.appendChild(btn);
  wrap.appendChild(status);
  return wrap;
}

/** @param {string} platform */
function buildInstallBody(platform) {
  clearNode($installModalBody);

  if (platform === "installed") {
    $installModalBody.appendChild(el("p", {}, "이미 앱으로 설치되어 있습니다."));
    return;
  }

  if (platform === "in-app") {
    const inApp = detectInAppBrowser() || { app: "webview", ios: false };
    /** @type {Record<string, string>} */
    const names = { kakaotalk: "카카오톡", line: "라인", naver: "네이버 앱", instagram: "인스타그램", facebook: "페이스북" };
    const where = names[inApp.app] || "이 앱";
    $installModalBody.appendChild(el("p", {},
      `${where} 안에서는 홈 화면에 앱을 설치할 수 없습니다.`));
    $installModalBody.appendChild(el("p", {},
      `${inApp.ios ? "Safari" : "Chrome"} 같은 브라우저에서 열면 설치할 수 있습니다.`));
    const row = el("div", { className: "install-cta-row" });
    const url = externalBrowserUrl(inApp, location.href);
    if (url) {
      const openBtn = el("button", { className: "install-cta", type: "button" }, "브라우저에서 열기");
      openBtn.addEventListener("click", () => { location.href = url; });
      row.appendChild(openBtn);
    }
    row.appendChild(_buildCopyButton(shareableHref()));
    $installModalBody.appendChild(row);
    if (!url) {
      $installModalBody.appendChild(el("p", { className: "install-note" },
        "주소를 복사해 브라우저의 주소창에 붙여 넣어 주세요."));
    }
    $installModalBody.appendChild(_buildNeverShowRow());
    return;
  }

  if (platform === "ios-safari") {
    const steps = [
      {
        img: "/assets/install-guide/install-step-1.webp",
        alt: "Safari 주소창 하단의 ··· 버튼",
        caption: "Safari에서 주소창 오른쪽 ··· 버튼을 누릅니다.",
        objectPosition: "50% 85%",
      },
      {
        img: "/assets/install-guide/install-step-2.webp",
        alt: "··· 메뉴에서 공유 선택",
        caption: "메뉴에서 '공유'를 선택합니다.",
        objectPosition: "50% 45%",
      },
      {
        img: "/assets/install-guide/install-step-3.webp",
        alt: "공유 시트에서 홈 화면에 추가 선택",
        caption: "'홈 화면에 추가'를 누르면 홈 화면에 아이콘이 생깁니다.",
        objectPosition: "50% 20%",
      },
    ];

    let currentStep = 0;

    const wrap = el("div", { className: "install-slider-wrap" });
    const track = el("div", { className: "install-slider-track" });
    const slides = steps.map(({ img, alt, objectPosition }, i) => {
      const slide = el("div", {
        className: "install-slide",
        role: "tabpanel",
        id: `install-slide-${i}`,
        "aria-label": `${i + 1}단계`,
      });
      const image = el("img", { src: img, alt, loading: "lazy" });
      image.style.objectPosition = objectPosition;
      slide.appendChild(image);
      track.appendChild(slide);
      return slide;
    });
    wrap.appendChild(track);
    $installModalBody.appendChild(wrap);

    const dotsEl = el("div", { className: "install-dots", role: "tablist", "aria-label": "설치 단계" });
    const dotBtns = steps.map((_, i) => {
      const btn = el("button", {
        type: "button",
        className: "install-dot",
        role: "tab",
        "aria-label": `${i + 1}단계`,
        "aria-selected": i === 0 ? "true" : "false",
        "aria-controls": `install-slide-${i}`,
        tabindex: i === 0 ? "0" : "-1",
      });
      btn.addEventListener("click", () => { goToStep(i); resetTimer(); dotBtns[i].focus(); });
      dotsEl.appendChild(btn);
      return btn;
    });
    // Arrow key navigation (WAI-ARIA tab pattern)
    dotsEl.addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowRight") next = (currentStep + 1) % steps.length;
      else if (e.key === "ArrowLeft") next = (currentStep - 1 + steps.length) % steps.length;
      if (next !== -1) {
        goToStep(next);
        resetTimer();
        dotBtns[next].focus();
        e.preventDefault();
      }
    });
    $installModalBody.appendChild(dotsEl);

    // aria-live: announces caption changes to screen readers
    const captionEl = el("p", {
      className: "install-step-caption",
      "aria-live": "polite",
      "aria-atomic": "true",
    });
    $installModalBody.appendChild(captionEl);

    /** @param {number} index */
    function goToStep(index) {
      currentStep = index;
      track.style.transform = `translateX(${-index * 100}%)`;
      slides.forEach((slide, i) => {
        const active = i === index;
        slide.setAttribute("aria-hidden", active ? "false" : "true");
      });
      dotBtns.forEach((btn, i) => {
        const active = i === index;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.setAttribute("tabindex", active ? "0" : "-1");
      });
      captionEl.textContent = `${index + 1}. ${steps[index].caption}`;
    }

    // Auto-advance every 3 s; skip if user prefers reduced motion
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    /** @type {ReturnType<typeof setInterval> | null} */
    let timer = reducedMotion ? null : setInterval(() => goToStep((currentStep + 1) % steps.length), 3000);
    function resetTimer() {
      if (reducedMotion) return;
      if (timer !== null) clearInterval(timer);
      timer = setInterval(() => goToStep((currentStep + 1) % steps.length), 3000);
    }
    $installModal.addEventListener("install:cleanup", () => { if (timer !== null) clearInterval(timer); }, { once: true });

    // Pointer-based swipe (touch + mouse)
    let pointerStartX = 0;
    let pointerStartTime = 0;
    track.addEventListener("pointerdown", (e) => {
      pointerStartX = e.clientX;
      pointerStartTime = Date.now();
      track.setPointerCapture(e.pointerId);
    });
    track.addEventListener("pointerup", (e) => {
      const dx = e.clientX - pointerStartX;
      if (Math.abs(dx) > 40 && Date.now() - pointerStartTime < 400) {
        if (dx < 0 && currentStep < steps.length - 1) goToStep(currentStep + 1);
        else if (dx > 0 && currentStep > 0) goToStep(currentStep - 1);
        resetTimer();
      }
    });

    goToStep(0);

    const bookmarkNotice = el("p", { className: "install-bookmark-notice" },
      "Safari에서 이용하시는 경우, 7일 이상 방문하지 않으면 앱에 저장한 북마크가 삭제될 수 있으므로 홈 화면에 추가해서 사용하세요.");
    $installModalBody.appendChild(bookmarkNotice);
    $installModalBody.appendChild(_buildNeverShowRow());
    return;
  }

  if (platform === "ios-other") {
    const ua = navigator.userAgent;
    const browserName =
      /CriOS/.test(ua) ? "Chrome" :
      /FxiOS/.test(ua) ? "Firefox" :
      /EdgiOS/.test(ua) ? "Edge" :
      /OPiOS/.test(ua) ? "Opera" :
      "브라우저";
    $installModalBody.appendChild(el("p", {},
      `${browserName}에서 공유 메뉴를 열고 '홈 화면에 추가'를 선택하면 앱처럼 실행됩니다.`));
    const list = el("ol", { className: "install-step-list" });
    list.appendChild(el("li", {}, "주소창 또는 메뉴(···)에서 공유 버튼을 누릅니다."));
    list.appendChild(el("li", {}, "공유 시트에서 '홈 화면에 추가'를 선택합니다."));
    list.appendChild(el("li", {}, "오른쪽 위 '추가'를 누르면 홈 화면에 아이콘이 생깁니다."));
    $installModalBody.appendChild(list);
    $installModalBody.appendChild(el("p", { className: "install-note" },
      "메뉴에 '홈 화면에 추가'가 없으면 브라우저를 최신 버전으로 업데이트한 뒤 다시 시도해 주세요."));
    $installModalBody.appendChild(_buildNeverShowRow());
    return;
  }

  if (platform === "ios-legacy") {
    $installModalBody.appendChild(el("p", {},
      "이 iOS 버전에서는 Safari에서만 홈 화면에 앱을 설치할 수 있습니다."));
    $installModalBody.appendChild(el("p", {},
      "이 페이지 주소를 복사해 Safari에서 열어 주세요."));
    $installModalBody.appendChild(el("p", { className: "install-bookmark-notice" },
      "Safari에서 이용하시는 경우, 7일 이상 방문하지 않으면 앱에 저장한 북마크가 삭제될 수 있으므로 홈 화면에 추가해서 사용하세요."));
    $installModalBody.appendChild(_buildCopyButton(location.origin + "/"));
    return;
  }

  if (platform === "android" || platform === "desktop") {
    $installModalBody.appendChild(el("p", {},
      platform === "android"
        ? "홈 화면에 추가하면 앱처럼 실행되고 오프라인에서도 사용할 수 있습니다."
        : "바탕화면·시작 메뉴에 추가하면 독립된 창으로 실행됩니다."));

    const cta = el("button", {
      className: platform === "desktop" ? "install-cta install-cta--end" : "install-cta",
      type: "button",
    }, platform === "android" ? "홈 화면에 추가" : "앱 설치");

    /** @param {{ canPrompt: boolean }} state */
    const updateCta = (state) => {
      if (state.canPrompt) {
        cta.removeAttribute("aria-disabled");
      } else {
        cta.setAttribute("aria-disabled", "true");
      }
    };

    cta.addEventListener("click", async () => {
      // Keep aria-disabled (not native `disabled`) so the button stays focusable
      // while the focus trap is active. Guard the action here instead.
      if (cta.getAttribute("aria-disabled") === "true") return;
      const { outcome } = await install.triggerPrompt();
      if (outcome === "accepted") {
        closeInstallModal();
      }
    });

    $installModalBody.appendChild(cta);

    const fallback = el("p", { className: "install-note" },
      platform === "desktop"
        ? "브라우저 주소창 오른쪽의 설치 아이콘을 눌러도 됩니다."
        : "브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해도 됩니다.");
    $installModalBody.appendChild(fallback);

    const unsub = install.subscribe(updateCta);
    $installModal.addEventListener("install:cleanup", unsub, { once: true });
    $installModalBody.appendChild(_buildNeverShowRow());
    return;
  }

  // unsupported
  $installModalBody.appendChild(el("p", {},
    "이 브라우저는 홈 화면 설치를 지원하지 않습니다."));
  $installModalBody.appendChild(el("p", { className: "install-note" },
    "Chrome, Edge, Safari(iOS) 등에서 열면 앱으로 설치할 수 있습니다."));
}

// Standalone modal — owns Escape via closeOnEsc (ADR-032). onOpen/onClose carry
// the install-specific background scroll-lock (iOS Safari position:fixed
// technique), neverShow persistence, and carousel teardown.
const installOverlay = createOverlay({
  panel: $installModal,
  scrim: $installScrim,
  inertSelectors: INSTALL_INERT_SELECTORS,
  closeOnEsc: true,
  initialFocus: () => $installModalClose,
  onOpen: () => {
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.dataset.scrollY = String(scrollY);
  },
  onClose: () => {
    const neverShowCb = /** @type {HTMLInputElement | null} */ (document.getElementById("install-never-show"));
    if (neverShowCb && neverShowCb.checked) {
      const state = _loadNudgeState();
      state.neverShow = true;
      _saveNudgeState(state);
    }
    $installModal.dispatchEvent(new Event("install:cleanup"));
    const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    // 루트의 `smooth`를 따르면 페이지가 맨 위에서부터 움직이고, 그 사이 캘린더 목록은 맨 위에 왔다고 보고 줄을 더해 보던 줄을 잃는다(pitfalls §42)
    window.scrollTo({ top: scrollY, behavior: "instant" });
  },
});

function openInstallModal() {
  const platform = install.detectPlatform();
  buildInstallBody(platform);
  installOverlay.open();
}

function closeInstallModal() { installOverlay.close(); }

$installModalClose.addEventListener("click", closeInstallModal);
$installScrim.addEventListener("click", closeInstallModal);

// ── Install nudge (auto-show) ──
// ── BEGIN NUDGE ──
// Exercised by tests/unit/install.test.js. Decides whether to auto-open
// the install modal based on platform + visit counter + neverShow flag.
// Counters are persisted via window.appStorage's _loadNudgeState/_saveNudgeState.
function maybeShowInstallNudge() {
  const platform = install.detectPlatform();
  // Only nudge platforms where installation is meaningful and possible
  const nudgeable =
    platform === "ios-safari" || platform === "ios-other" || platform === "android" ||
    platform === "in-app";
  if (!nudgeable) return;
  if (_loadNudgeState().neverShow) return;

  // A page reloaded from a hand-off URL is the same visit as the one that
  // tried the hand-off — and proof that it failed.
  const failedHandOff = platform === "in-app" && hasHandOffMark();
  const state = _loadNudgeState();
  if (!failedHandOff) {
    state.visits += 1;
    _saveNudgeState(state);
  }

  if (platform === "in-app") {
    // About to be handed to the device browser — maybeLeaveInAppBrowser opens
    // the guide itself if that does not work.
    if (handOffUrl()) return;
    // Stuck here with no way out (unknown web view, iOS ≤16): do not wait for
    // a second visit. Shared links are first visits, and in-app storage is
    // often wiped before a second one is counted.
    if (!failedHandOff && state.visits > 1 && state.visits < state.nextShow) return;
  } else if (state.visits < state.nextShow) {
    return;
  }

  // Delay so the page content renders first
  setTimeout(() => {
    // Re-check in case the user just installed between page load and timeout
    if (install.detectPlatform() === "installed") return;
    // Mark next show before opening, preventing double-shows on rapid reloads
    const current = _loadNudgeState();
    current.nextShow = current.visits + 3;
    _saveNudgeState(current);
    openInstallModal();
  }, 1500);
}

// The hand-off to the device browser did not happen or did not work: open the
// guide now, whatever the visit count. It carries "브라우저에서 열기" and "주소 복사".
function showInAppGuide() {
  if (install.detectPlatform() !== "in-app") return;
  const state = _loadNudgeState();
  if (state.neverShow) return;
  if (installOverlay.isOpen) return;
  state.nextShow = state.visits + 3;
  _saveNudgeState(state);
  openInstallModal();
}
// ── END NUDGE ──

// Window facade for legacy callers (settings-ui reads `window.install`,
// app.js bootstrap calls bare `maybeShowInstallNudge()` / `openInstallModal`).
// `const` destructure does not auto-register on window — must be explicit.
window.install = install;
window.openInstallModal = openInstallModal;
window.closeInstallModal = closeInstallModal;
window.maybeShowInstallNudge = maybeShowInstallNudge;
window.maybeLeaveInAppBrowser = maybeLeaveInAppBrowser;

export { install, openInstallModal, closeInstallModal, maybeShowInstallNudge, maybeLeaveInAppBrowser };
