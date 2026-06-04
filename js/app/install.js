"use strict";
// @ts-check

// PWA install detection + Install guide modal + Install nudge auto-show.
// Phase 4 of the app.js modularization (ADR-018). First module written in
// the ESM-preferred pattern (ADR-019): named exports + window facade for
// legacy callers.

/** @typedef {import("../types").InstallNudgeState} InstallNudgeState */
/** @typedef {import("../types").InstallObject} InstallObject */

const { _$, el, clearNode, setInert, trapFocus } = window.appHelpers;
const { _loadNudgeState, _saveNudgeState } = window.appStorage;

// Platform detection states:
//   "installed"    — already running as a standalone PWA, nothing to show
//   "ios-safari"   — iPhone/iPad Safari; manual "Add to Home Screen" guide
//   "ios-other"    — iOS 17+ Chrome/Firefox/Edge/etc; share-menu install guide
//   "ios-legacy"   — iOS ≤16 non-Safari (Add-to-Home-Screen unsupported); open in Safari
//   "android"      — Chromium-based Android; beforeinstallprompt available
//   "desktop"      — Chromium-based desktop; beforeinstallprompt available
//   "unsupported"  — Firefox/Safari desktop, etc; hide install entry
//
// beforeinstallprompt is captured and stored so the install modal can call prompt()
// on user gesture. The `appinstalled` event and display-mode change both flip state.

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

  function detectPlatform() {
    if (isStandalone()) return "installed";
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+
    if (isIOS) {
      // All iOS browsers wrap WebKit. Safari UA omits the CriOS/FxiOS/etc tokens.
      const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
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

/** @type {(() => void) | null} */
let installModalTrap = null;
/** @type {Element | null} */
let installModalLastFocus = null;

// Elements that become inert (background) while the install modal is open.
const INSTALL_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #launch-screen, #bookmark-scrim, #bookmark-drawer, #verse-select-bar";

/** @param {boolean} on */
function setBackgroundInert(on) { setInert(on, INSTALL_INERT_SELECTORS); }

function _buildNeverShowRow() {
  const row = el("div", { className: "install-never-show-row" });
  const checkbox = el("input", { type: "checkbox", id: "install-never-show" });
  const label = el("label", { for: "install-never-show" }, " 다시 열지 않음");
  row.appendChild(checkbox);
  row.appendChild(label);
  return row;
}

/** @param {string} platform */
function buildInstallBody(platform) {
  clearNode($installModalBody);

  if (platform === "installed") {
    $installModalBody.appendChild(el("p", {}, "이미 앱으로 설치되어 있습니다."));
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
    const btn = el("button", { className: "install-cta", type: "button" }, "주소 복사");
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.origin + "/");
        btn.textContent = "복사됨";
        setTimeout(() => { btn.textContent = "주소 복사"; }, 2000);
      } catch {
        btn.textContent = "복사 실패";
      }
    });
    $installModalBody.appendChild(btn);
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

function openInstallModal() {
  const platform = install.detectPlatform();
  buildInstallBody(platform);
  installModalLastFocus = document.activeElement;
  $installScrim.hidden = false;
  $installModal.hidden = false;
  setBackgroundInert(true);
  // Lock background scroll (iOS Safari requires position:fixed technique)
  const scrollY = window.scrollY;
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = "100%";
  document.body.dataset.scrollY = String(scrollY);
  installModalTrap = trapFocus($installModal);
  requestAnimationFrame(() => $installModalClose.focus());
}

function closeInstallModal() {
  if ($installModal.hidden) return;
  const neverShowCb = /** @type {HTMLInputElement | null} */ (document.getElementById("install-never-show"));
  if (neverShowCb && neverShowCb.checked) {
    const state = _loadNudgeState();
    state.neverShow = true;
    _saveNudgeState(state);
  }
  $installModal.dispatchEvent(new Event("install:cleanup"));
  $installScrim.hidden = true;
  $installModal.hidden = true;
  setBackgroundInert(false);
  // Restore background scroll and position
  const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollY);
  if (installModalTrap) { installModalTrap(); installModalTrap = null; }
  if (installModalLastFocus && /** @type {HTMLElement} */ (installModalLastFocus).focus) {
    try { /** @type {HTMLElement} */ (installModalLastFocus).focus(); } catch {}
  }
}

$installModalClose.addEventListener("click", closeInstallModal);
$installScrim.addEventListener("click", closeInstallModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$installModal.hidden) closeInstallModal();
});

// ── Install nudge (auto-show) ──
// ── BEGIN NUDGE ──
// Exercised by tests/unit/install.test.js. Decides whether to auto-open
// the install modal based on platform + visit counter + neverShow flag.
// Counters are persisted via window.appStorage's _loadNudgeState/_saveNudgeState.
function maybeShowInstallNudge() {
  const platform = install.detectPlatform();
  // Only nudge platforms where installation is meaningful and possible
  const nudgeable =
    platform === "ios-safari" || platform === "ios-other" || platform === "android";
  if (!nudgeable) return;
  if (_loadNudgeState().neverShow) return;

  const state = _loadNudgeState();
  state.visits += 1;
  _saveNudgeState(state);

  if (state.visits < state.nextShow) return;

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
// ── END NUDGE ──

// Window facade for legacy callers (settings-ui reads `window.install`,
// app.js bootstrap calls bare `maybeShowInstallNudge()` / `openInstallModal`).
// `const` destructure does not auto-register on window — must be explicit.
window.install = install;
window.openInstallModal = openInstallModal;
window.maybeShowInstallNudge = maybeShowInstallNudge;
window.appInstall = { install, openInstallModal, closeInstallModal, maybeShowInstallNudge };

export { install, openInstallModal, closeInstallModal, maybeShowInstallNudge };
