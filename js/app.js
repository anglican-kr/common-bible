"use strict";

const DATA_DIR = "/data";
// Psalms use "편" instead of "장" as the chapter unit
function chUnit(bookId) { return bookId === "ps" ? "편" : "장"; }
const $app = document.getElementById("app");
const $title = document.getElementById("page-title");
const $breadcrumb = document.getElementById("breadcrumb");
const $announce = document.getElementById("a11y-announce");
const $audioBar = document.getElementById("audio-bar");
const $resumeBannerSlot = document.getElementById("resume-banner-slot");
const $searchInput = document.getElementById("search-input");
const $searchClear = document.getElementById("search-clear");
const $searchFab = document.getElementById("search-fab");
const $searchScrim = document.getElementById("search-scrim");
const $searchSheet = document.getElementById("search-sheet");
const $searchSheetInput = document.getElementById("search-sheet-input");
const $searchSheetClear = document.getElementById("search-sheet-clear");
const $searchSheetClose = document.getElementById("search-sheet-close");
const $searchSheetResults = document.getElementById("search-sheet-results");

let booksCache = null;
let appVersion = null;
let currentAudio = null;
let _audioController = null;
let _audioSaveTimer = null;

// ── Accessibility ──

function announce(msg) {
  $announce.textContent = "";
  requestAnimationFrame(() => { $announce.textContent = msg; });
}

// Focus trap: keeps Tab cycling within a container while it is open.
// Returns a cleanup function to remove the listener.
function trapFocus(container) {
  function handler(e) {
    if (e.key !== "Tab") return;
    const focusable = container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener("keydown", handler);
  return () => container.removeEventListener("keydown", handler);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    // Close search overlay if open
    if ($searchSheet && !$searchSheet.hidden) {
      closeSearchSheet();
      return;
    }
    document.querySelectorAll(".chapter-popover:not([hidden]), .bc-division-popover:not([hidden]), .settings-popover:not([hidden]), .title-division-popover:not([hidden])")
      .forEach((p) => { p.hidden = true; });
    document.querySelectorAll("[aria-expanded='true']")
      .forEach((b) => { b.setAttribute("aria-expanded", "false"); b.focus(); });
  }
  // Space to toggle audio playback (when not in an input/button)
  if (e.key === " " && currentAudio && !["INPUT", "BUTTON", "TEXTAREA", "SELECT"].includes(e.target.tagName)) {
    e.preventDefault();
    if (currentAudio.paused) currentAudio.play(); else currentAudio.pause();
  }
});

// ── Reading position persistence ──

const STORAGE_KEY = "bible-last-read";
const FONT_SIZE_KEY = "bible-font-size";
const THEME_KEY = "bible-theme";
const BOOK_ORDER_KEY = "bible-book-order";
const COLOR_SCHEME_KEY = "bible-color-scheme";
const STARTUP_BEHAVIOR_KEY = "bible-startup"; // "resume" | "home"
const AUDIO_POS_KEY = "bible-audio-pos";
const BOOKMARK_KEY = "bible-bookmarks";
const INSTALL_NUDGE_KEY = "bible-install-nudge";
const FONT_SIZES = [16, 18, 20, 22, 24];

const COLOR_SCHEMES = [
  { id: "navy",       name: "네이비",   swatch: "#1e3a5f", iconBg: "#1a1a2e" },
  { id: "terracotta", name: "버건디",   swatch: "#6b3a2a", iconBg: "#6b3a2a" },
  { id: "green",      name: "초록",     swatch: "#1a6b50", iconBg: "#1a6b50" },
  { id: "purple",     name: "보라",     swatch: "#5a2d82", iconBg: "#5a2d82" },
];
const DEFAULT_FONT_SIZE = 18;

let _scrollTrackCleanup = null;
let _isInitialLoad = true;

// ── Bookmark state ──
let _verseSelectMode = false;
let _selectedVerseRefs = new Set();
let _verseSelectDrag = null; // { startIdx, allVerses, isAdding, moved }
let _currentBookId = null;
let _currentChapter = null;
let _bookmarkDrawerBook = null;
let _bookmarkDrawerChapter = null;
let _bookmarkDrawerTrap = null;
let _bookmarkDrawerLastFocus = null;
let _bmSaveModalTrap = null;
let _bmMergeModalTrap = null;
let _bookmarkDrawerCloseSeq = 0;
let _bookmarkDrawerCloseTimer = null;
let _dragState = null; // { id, ghost, origLi, startY, origTop }

function saveReadingPosition(bookId, chapter, verse = null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookId, chapter, verse }));
  } catch (_) {}
}

function startScrollTracking(bookId, chapter) {
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  let timer = null;
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const verses = document.querySelectorAll(".verse[data-vref]");
      let currentVerse = null;
      for (const v of verses) {
        const n = parseInt(v.getAttribute("data-vref"), 10);
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
    clearTimeout(timer);
    window.removeEventListener("scroll", handler);
    _scrollTrackCleanup = null;
  };
}

function loadReadingPosition() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

function saveAudioTime(bookId, chapter, time) {
  try {
    localStorage.setItem(AUDIO_POS_KEY, JSON.stringify({ bookId, chapter, time }));
  } catch (_) {}
}

function loadAudioTime(bookId, chapter) {
  try {
    const pos = JSON.parse(localStorage.getItem(AUDIO_POS_KEY));
    if (pos && pos.bookId === bookId && pos.chapter === chapter && pos.time > 0) return pos.time;
  } catch (_) {}
  return null;
}

function clearAudioTime() {
  try { localStorage.removeItem(AUDIO_POS_KEY); } catch (_) {}
}

function loadStartupBehavior() {
  return localStorage.getItem(STARTUP_BEHAVIOR_KEY) || "resume";
}

function saveStartupBehavior(val) {
  localStorage.setItem(STARTUP_BEHAVIOR_KEY, val);
}

// ── Font size ──

function loadFontSize() {
  try {
    const v = parseInt(localStorage.getItem(FONT_SIZE_KEY), 10);
    return FONT_SIZES.includes(v) ? v : DEFAULT_FONT_SIZE;
  } catch (_) {
    return DEFAULT_FONT_SIZE;
  }
}

function saveFontSize(size) {
  try { localStorage.setItem(FONT_SIZE_KEY, String(size)); } catch (_) {}
}

function applyFontSize(size) {
  document.documentElement.style.fontSize = `${size}px`;
}

// ── Cache management ──

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
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
    window.location.reload();
  } catch (err) {
    console.error("Cache clear failed:", err);
    alert("캐시를 비우지 못했습니다. 다시 시도해 주세요.");
  }
}

// ── Settings popover ──

const $settingsAnchor = document.getElementById("settings-anchor");

function initSettings() {
  clearNode($settingsAnchor);

  const wrapper = el("div", { className: "settings-wrapper" });
  const btn = el("button", { className: "settings-btn", "aria-label": "설정", "aria-expanded": "false" });
  const settingsSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  settingsSvg.setAttribute("width", "18");
  settingsSvg.setAttribute("height", "18");
  settingsSvg.setAttribute("viewBox", "0 0 24 24");
  settingsSvg.setAttribute("fill", "none");
  settingsSvg.setAttribute("stroke", "currentColor");
  settingsSvg.setAttribute("stroke-width", "2");
  settingsSvg.setAttribute("stroke-linecap", "round");
  settingsSvg.setAttribute("stroke-linejoin", "round");
  const gearCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  gearCircle.setAttribute("cx", "12");
  gearCircle.setAttribute("cy", "12");
  gearCircle.setAttribute("r", "3");
  const gearPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  gearPath.setAttribute("d", "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z");
  settingsSvg.appendChild(gearCircle);
  settingsSvg.appendChild(gearPath);
  btn.appendChild(settingsSvg);
  const popover = el("div", { className: "settings-popover" });
  popover.hidden = true;
  popover.addEventListener("click", (e) => e.stopPropagation());

  function rebuild() {
    clearNode(popover);

    // ── Section 1: Book order (deuterocanon placement) ──
    const section1 = el("section", { className: "settings-section" });
    const orderRow = el("div", { className: "settings-row" });
    orderRow.appendChild(el("span", { className: "settings-label" }, "외경"));
    const currentOrder = loadBookOrder();
    const orderGroup = el("div", { className: "btn-group", role: "group", "aria-label": "외경 배치 선택" });
    for (const [value, label, announceLabel] of [
      ["canonical", "분리", "외경 분리"],
      ["vulgate", "구약에 포함", "구약에 외경 포함"],
    ]) {
      const orderBtn = el("button", { className: "toolbar-btn", "aria-pressed": String(currentOrder === value) }, label);
      orderBtn.addEventListener("click", () => {
        saveBookOrder(value);
        const { view } = parsePath();
        if (view !== "chapter" && view !== "prologue") route();
        rebuild();
        announce(announceLabel);
      });
      orderGroup.appendChild(orderBtn);
    }
    orderRow.appendChild(orderGroup);

    // Startup behavior
    const startupRow = el("div", { className: "settings-row" });
    startupRow.appendChild(el("span", { className: "settings-label" }, "시작 화면"));
    const startupCurrent = loadStartupBehavior();
    const startupGroup = el("div", { className: "btn-group", role: "group", "aria-label": "앱 시작 화면 선택" });
    for (const { val, label } of [{ val: "resume", label: "읽던 곳" }, { val: "home", label: "첫 페이지" }]) {
      const startupBtn = el("button", {
        className: "toolbar-btn",
        "aria-pressed": String(startupCurrent === val),
      }, label);
      startupBtn.addEventListener("click", () => {
        saveStartupBehavior(val);
        startupGroup.querySelectorAll(".toolbar-btn").forEach((b) =>
          b.setAttribute("aria-pressed", String(b === startupBtn))
        );
        announce(`시작 화면: ${label}`);
      });
      startupGroup.appendChild(startupBtn);
    }
    startupRow.appendChild(startupGroup);
    section1.appendChild(startupRow);
    section1.appendChild(orderRow);
    popover.appendChild(section1);

    // ── Section 2: Typography & appearance ──
    const section2 = el("section", { className: "settings-section" });

    // Font size
    const sizeRow = el("div", { className: "settings-row" });
    sizeRow.appendChild(el("span", { className: "settings-label" }, "글자 크기"));
    const size = loadFontSize();
    const idx = FONT_SIZES.indexOf(size);

    const btnMinus = el("button", { className: "toolbar-btn", "aria-label": "글자 작게" }, "A-");
    const btnReset = el("button", { className: "toolbar-btn", "aria-label": "글자 크기 초기화" }, "A");
    const btnPlus = el("button", { className: "toolbar-btn", "aria-label": "글자 크게" }, "A+");
    if (idx <= 0) btnMinus.disabled = true;
    if (idx >= FONT_SIZES.length - 1) btnPlus.disabled = true;
    if (size === DEFAULT_FONT_SIZE) btnReset.disabled = true;

    btnMinus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur > 0) { const ns = FONT_SIZES[cur - 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
    });
    btnReset.addEventListener("click", () => {
      saveFontSize(DEFAULT_FONT_SIZE);
      applyFontSize(DEFAULT_FONT_SIZE);
      rebuild();
      announce("글자 크기 초기화");
    });
    btnPlus.addEventListener("click", () => {
      const cur = FONT_SIZES.indexOf(loadFontSize());
      if (cur < FONT_SIZES.length - 1) { const ns = FONT_SIZES[cur + 1]; saveFontSize(ns); applyFontSize(ns); rebuild(); announce(`글자 크기 ${ns}px`); }
    });

    const sizeGroup = el("div", { className: "btn-group" });
    sizeGroup.appendChild(btnMinus);
    sizeGroup.appendChild(btnReset);
    sizeGroup.appendChild(btnPlus);
    sizeRow.appendChild(sizeGroup);
    section2.appendChild(sizeRow);

    // Theme
    const themeRow = el("div", { className: "settings-row" });
    themeRow.appendChild(el("span", { className: "settings-label" }, "테마"));
    const current = loadTheme();
    const themeGroup = el("div", { className: "btn-group" });
    for (const [value, label] of [["light", "라이트"], ["system", "시스템"], ["dark", "다크"]]) {
      const tbtn = el("button", { className: "toolbar-btn", "aria-pressed": String(current === value) }, label);
      tbtn.addEventListener("click", () => {
        saveTheme(value);
        applyTheme(value);
        rebuild();
        announce(label + " 테마");
      });
      themeGroup.appendChild(tbtn);
    }
    themeRow.appendChild(themeGroup);
    section2.appendChild(themeRow);

    // Color scheme
    const colorRow = el("div", { className: "settings-row" });
    colorRow.appendChild(el("span", { className: "settings-label" }, "색상"));
    const currentScheme = loadColorScheme();
    const swatches = el("div", { className: "color-swatches", role: "group", "aria-label": "색상 테마 선택" });
    for (const scheme of COLOR_SCHEMES) {
      const swatchBtn = el("button", {
        className: "color-swatch",
        "aria-label": scheme.name,
        "aria-pressed": String(currentScheme === scheme.id),
      });
      swatchBtn.style.setProperty("--swatch-color", scheme.swatch);
      swatchBtn.addEventListener("click", () => {
        saveColorScheme(scheme.id);
        applyColorScheme(scheme.id);
        rebuild();
        announce(scheme.name + " 색상");
      });
      swatches.appendChild(swatchBtn);
    }
    colorRow.appendChild(swatches);
    section2.appendChild(colorRow);
    popover.appendChild(section2);

    // ── Section 3: App lifecycle (install, cache) ──
    const showInstall = typeof install !== "undefined" && install.detectPlatform() !== "installed";
    const showCache = "caches" in window;
    if (showInstall || showCache) {
      const section3 = el("section", { className: "settings-section" });

      if (showInstall) {
        const installRow = el("div", { className: "settings-row" });
        installRow.appendChild(el("span", { className: "settings-label" }, "앱 설치"));
        const installBtn = el("button", { className: "settings-action-btn", "aria-label": "앱으로 설치 안내 열기" }, "안내");
        installBtn.addEventListener("click", () => {
          popover.hidden = true;
          btn.setAttribute("aria-expanded", "false");
          if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
          openInstallModal();
        });
        installRow.appendChild(installBtn);
        section3.appendChild(installRow);
      }

      if (showCache) {
        const cacheRow = el("div", { className: "settings-row" });
        cacheRow.appendChild(el("span", { className: "settings-label" }, "캐시"));
        const clearBtn = el("button", { className: "cache-clear-btn", "aria-label": "캐시 비우기" });
        const ns = "http://www.w3.org/2000/svg";
        const warnIcon = document.createElementNS(ns, "svg");
        warnIcon.setAttribute("viewBox", "0 0 20 20");
        warnIcon.setAttribute("aria-hidden", "true");
        warnIcon.setAttribute("class", "warn-icon");
        const tri = document.createElementNS(ns, "path");
        tri.setAttribute("d", "M10 2 L18.66 17 H1.34 Z");
        tri.setAttribute("fill", "none");
        tri.setAttribute("stroke", "currentColor");
        tri.setAttribute("stroke-width", "1.5");
        tri.setAttribute("stroke-linejoin", "round");
        const stem = document.createElementNS(ns, "line");
        stem.setAttribute("x1", "10"); stem.setAttribute("y1", "8");
        stem.setAttribute("x2", "10"); stem.setAttribute("y2", "12.5");
        stem.setAttribute("stroke", "currentColor");
        stem.setAttribute("stroke-width", "1.5");
        stem.setAttribute("stroke-linecap", "round");
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", "10"); dot.setAttribute("cy", "14.5"); dot.setAttribute("r", "0.8");
        dot.setAttribute("fill", "currentColor");
        warnIcon.append(tri, stem, dot);
        clearBtn.appendChild(warnIcon);
        clearBtn.appendChild(document.createTextNode("초기화"));
        clearBtn.addEventListener("click", () => clearAllCaches());
        cacheRow.appendChild(clearBtn);
        section3.appendChild(cacheRow);
      }

      popover.appendChild(section3);
    }

    // About
    const aboutRow = el("div", { className: "settings-about" });
    aboutRow.appendChild(document.createTextNode("공동번역성서 개정판 © 대한성서공회"));
    aboutRow.appendChild(el("br"));
    aboutRow.appendChild(document.createTextNode("서비스 © 대한성공회"));
    aboutRow.appendChild(el("br"));
    const privacyLink = el("a", {
      href: "/privacy.html",
      target: "_blank",
      rel: "noopener noreferrer",
      className: "settings-privacy-link",
    }, "개인정보처리방침");
    aboutRow.appendChild(privacyLink);
    aboutRow.appendChild(el("br"));
    const versionLabel = appVersion ? `공동번역성서 ${appVersion}` : "공동번역성서";
    const githubLink = el("a", { href: "https://github.com/anglican-kr/common-bible", target: "_blank", rel: "noopener noreferrer" });
    const ns = "http://www.w3.org/2000/svg";
    const githubIcon = document.createElementNS(ns, "svg");
    githubIcon.setAttribute("viewBox", "0 0 16 16");
    githubIcon.setAttribute("width", "12");
    githubIcon.setAttribute("height", "12");
    githubIcon.setAttribute("aria-hidden", "true");
    githubIcon.setAttribute("class", "github-icon");
    const githubPath = document.createElementNS(ns, "path");
    githubPath.setAttribute("d", "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z");
    githubIcon.appendChild(githubPath);
    githubLink.appendChild(githubIcon);
    githubLink.appendChild(document.createTextNode(" " + versionLabel));
    aboutRow.appendChild(githubLink);
    popover.appendChild(aboutRow);

    if (!popover.hidden) {
      const firstFocusable = popover.querySelector("button:not([disabled]), a[href], input:not([disabled])");
      if (firstFocusable) firstFocusable.focus();
    }
  }

  function positionPopover() {
    const rect = btn.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.right = `${window.innerWidth - rect.right}px`;
  }

  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    if (!open) { rebuild(); positionPopover(); }
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = popover.querySelector('button, a[href], input');
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !wrapper.contains(e.target) && !popover.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  wrapper.appendChild(btn);
  document.body.appendChild(popover);
  $settingsAnchor.appendChild(wrapper);
}

// ── Icon recoloring ──

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// Luminance of the original icon background (#1a1a2e)
const ICON_BG_LUM = (26 * 0.299 + 26 * 0.587 + 46 * 0.114) / 255; // ≈ 0.111

// Monotonically-increasing counter used to cancel stale updateAppIcons calls.
// Incremented each time applyColorScheme is called so any in-flight async
// chain started by a previous call becomes a no-op when it resolves.
let _iconGeneration = 0;

// Loads the source icon's pixel data. Not cached: a decoded 512×512 ImageData is
// ~1 MB and color-scheme changes are rare; releasing it after use keeps idle
// memory low. The asset is served from the SW cache, so re-reads are cheap.
function loadOrigIcon() {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    img.onerror = reject;
    img.src = "/assets/icons/icon-512-maskable.png";
  });
}

function updateAppIcons(scheme) {
  // Capture the generation at dispatch time; discard the result if a newer
  // applyColorScheme call has already superseded this one.
  const gen = _iconGeneration;
  // Defer to idle: favicon/apple-touch-icon updates have no visible effect
  // during reading, and the canvas pass blocks the main thread for a frame.
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  idle(() => {
    if (_iconGeneration !== gen) return;
    loadOrigIcon().then((origData) => {
      if (_iconGeneration !== gen) return;
      const [nr, ng, nb] = hexToRgb(scheme.iconBg);
      const canvas = document.createElement("canvas");
      canvas.width = origData.width;
      canvas.height = origData.height;
      const ctx = canvas.getContext("2d");
      const d = origData.data;
      for (let i = 0; i < d.length; i += 4) {
        // Normalize luminance: 0 = original bg, 1 = white cross
        const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
        const t = Math.max(0, Math.min(1, (lum - ICON_BG_LUM) / (1 - ICON_BG_LUM)));
        d[i]     = Math.round(nr + (255 - nr) * t);
        d[i + 1] = Math.round(ng + (255 - ng) * t);
        d[i + 2] = Math.round(nb + (255 - nb) * t);
      }
      ctx.putImageData(origData, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const faviconLink = document.querySelector("link[rel='icon']");
      if (faviconLink) faviconLink.href = dataUrl;
      const appleLink = document.querySelector("link[rel='apple-touch-icon']");
      if (appleLink) appleLink.href = dataUrl;
    }).catch(() => { /* non-critical */ });
  });
}

// ── Color scheme ──

function loadColorScheme() {
  try {
    const v = localStorage.getItem(COLOR_SCHEME_KEY);
    if (COLOR_SCHEMES.some(s => s.id === v)) return v;
  } catch (_) {}
  return "navy";
}

function saveColorScheme(scheme) {
  try { localStorage.setItem(COLOR_SCHEME_KEY, scheme); } catch (_) {}
}

// Default favicon/apple-touch-icon URLs as shipped in index.html.
// Captured once so we can restore them when reverting to the navy scheme
// without re-running the canvas recolor pipeline.
const DEFAULT_FAVICON_HREF = "/favicon.ico";
const DEFAULT_APPLE_ICON_HREF = "/assets/icons/icon-512-maskable.png";

function applyColorScheme(schemeName) {
  // Invalidate any in-flight updateAppIcons call from a previous scheme.
  _iconGeneration++;
  const scheme = COLOR_SCHEMES.find(s => s.id === schemeName) || COLOR_SCHEMES[0];
  if (schemeName === "navy") {
    document.documentElement.removeAttribute("data-color-scheme");
    updateThemeMetaColor();
    // Default scheme: shipped favicon/apple-touch-icon already match. Skipping
    // the canvas recolor saves ~1 MB ImageData on every launch. If a previous
    // session left a recolored data: URL on these <link>s, restore the originals.
    const faviconLink = document.querySelector("link[rel='icon']");
    if (faviconLink && faviconLink.href !== new URL(DEFAULT_FAVICON_HREF, location.href).href) {
      faviconLink.href = DEFAULT_FAVICON_HREF;
    }
    const appleLink = document.querySelector("link[rel='apple-touch-icon']");
    if (appleLink && appleLink.href !== new URL(DEFAULT_APPLE_ICON_HREF, location.href).href) {
      appleLink.href = DEFAULT_APPLE_ICON_HREF;
    }
    return;
  }
  document.documentElement.setAttribute("data-color-scheme", schemeName);
  updateThemeMetaColor();
  updateAppIcons(scheme);
}

// ── Theme ──

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light" || saved === "system") return saved;
  } catch (_) {}
  return "system";
}

function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

let _systemThemeListener = null;
const _darkMQ = window.matchMedia("(prefers-color-scheme: dark)");

function updateThemeMetaColor() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const color = isDark ? "#1a1a2e" : "#faf8f5";
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", color);
  });
}

function applyTheme(theme) {
  if (_systemThemeListener) {
    _darkMQ.removeEventListener("change", _systemThemeListener);
    _systemThemeListener = null;
  }
  const resolved = theme === "system" ? (_darkMQ.matches ? "dark" : "light") : theme;
  document.documentElement.setAttribute("data-theme", resolved);
  updateThemeMetaColor();
  if (theme === "system") {
    _systemThemeListener = (e) => {
      document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
      updateThemeMetaColor();
    };
    _darkMQ.addEventListener("change", _systemThemeListener);
  }
}

// ── Book order ──

function loadBookOrder() {
  try {
    const v = localStorage.getItem(BOOK_ORDER_KEY);
    if (v === "canonical" || v === "vulgate") return v;
  } catch (_) {}
  return "canonical";
}

function saveBookOrder(order) {
  try { localStorage.setItem(BOOK_ORDER_KEY, order); } catch (_) {}
}

// Apply saved settings on load
applyFontSize(loadFontSize());
applyTheme(loadTheme());
applyColorScheme(loadColorScheme());
initSettings();

// ── Launch Screen ──

// Gate fade-out on font readiness so a cold-cache visit does not show
// system-font content briefly between fade-out end and swap arrival.
// Bounded by timeout to avoid stalling on slow networks.
const FONT_READY_TIMEOUT_MS = 1500;
const _fontReadyPromise = (() => {
  if (!document.fonts || !document.fonts.ready) return Promise.resolve();
  const ready = document.fonts.ready.catch(() => {});
  const timeout = new Promise((resolve) => setTimeout(resolve, FONT_READY_TIMEOUT_MS));
  return Promise.race([ready, timeout]);
})();

let _launchScreenDismissed = false;

function dismissLaunchScreen() {
  if (_launchScreenDismissed) return;
  _launchScreenDismissed = true;

  _fontReadyPromise.then(() => {
    const el = document.getElementById("launch-screen");
    if (!el) {
      document.documentElement.classList.add("launch-done");
      return;
    }

    // Decouple from heavy rendering task for smoother start
    requestAnimationFrame(() => {
      el.classList.add("fade-out");
      // Change background early to avoid flash but after animation has committed
      setTimeout(() => {
        document.documentElement.classList.add("launch-done");
      }, 50);
    });

    const handler = (e) => {
      if (e.target !== el || (e.animationName !== "launch-screen-out")) return;
      el.removeEventListener("animationend", handler);
      el.remove();
    };
    el.addEventListener("animationend", handler);
  });
}

// ── Helpers ──

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else node.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (typeof child === "string") node.appendChild(document.createTextNode(child));
    else if (child) node.appendChild(child);
  }
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ── Bookmark storage helpers ──

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) { return []; }
}

function saveBookmarks(store) {
  try {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(store));
  } catch (_) {}
}

// ── Verse spec utilities ──

// "1-5,10-15,3a,3b" → [{start:1,end:5},{start:10,end:15},{start:3,end:3,part:"a"},...]
function parseVerseSpec(spec) {
  if (!spec || spec === "all") return [];
  return spec.split(",").reduce((acc, seg) => {
    const trimmed = seg.trim();
    const alphaMatch = trimmed.match(/^(\d+)([a-z])$/);
    if (alphaMatch) {
      const n = parseInt(alphaMatch[1], 10);
      if (n > 0) acc.push({ start: n, end: n, part: alphaMatch[2] });
      return acc;
    }
    const m = trimmed.match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      const s = parseInt(m[1], 10);
      const e = m[2] ? parseInt(m[2], 10) : s;
      if (s > 0) acc.push({ start: Math.min(s, e), end: Math.max(s, e) });
    }
    return acc;
  }, []);
}

// If all rendered spans of a multi-part verse are selected, collapse "3a,3b" → "3".
// Single-part verses ("3" with no alpha suffix) are unchanged.
function collapseFullVerseRefs(refs, article) {
  if (!article) return refs;
  const selected = new Set(refs);
  // Group by integer verse number
  const byVerse = {};
  for (const ref of refs) {
    const n = parseInt(ref, 10);
    if (!byVerse[n]) byVerse[n] = [];
    byVerse[n].push(ref);
  }
  const result = [];
  for (const [n, verseRefs] of Object.entries(byVerse)) {
    // All spans rendered for this verse number
    const allSpanRefs = [...article.querySelectorAll(".verse[data-vref]")]
      .map(s => s.getAttribute("data-vref"))
      .filter(r => parseInt(r, 10) === Number(n));
    const hasAlpha = allSpanRefs.some(r => /[a-z]$/.test(r));
    const allSelected = allSpanRefs.length > 0 && allSpanRefs.every(r => selected.has(r));
    if (hasAlpha && allSelected) {
      result.push(`${n}`);
    } else {
      result.push(...verseRefs);
    }
  }
  return result;
}

// Compare verse refs: "3" < "3a" < "3b" < "4"
function _compareRefs(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  if (na !== nb) return na - nb;
  const pa = a.match(/[a-z]$/)?.[0] || "";
  const pb = b.match(/[a-z]$/)?.[0] || "";
  return pa.localeCompare(pb);
}

// Array of data-vref strings (e.g. ["3a","3b","5","6","7"]) → "3a,3b,5-7"
// Consecutive integer-only refs are compressed into ranges; alpha refs kept individually.
function selectedVersesToSpec(refs) {
  if (!refs.length) return "all";
  const unique = [...new Set(refs)].sort(_compareRefs);
  const result = [];
  let intRun = [];

  function flushRun() {
    if (!intRun.length) return;
    let s = intRun[0], e = intRun[0];
    for (let i = 1; i < intRun.length; i++) {
      if (intRun[i] === e + 1) { e = intRun[i]; }
      else { result.push(s === e ? `${s}` : `${s}-${e}`); s = e = intRun[i]; }
    }
    result.push(s === e ? `${s}` : `${s}-${e}`);
    intRun = [];
  }

  for (const ref of unique) {
    if (/^\d+$/.test(ref)) {
      intRun.push(parseInt(ref, 10));
    } else {
      flushRun();
      result.push(ref);
    }
  }
  flushRun();
  return result.join(",");
}

// Union of two verse spec strings
function mergeVerseSpecs(specA, specB) {
  if (specA === "all" || specB === "all") return "all";
  const intRefs = new Set();
  const partRefs = new Set();
  for (const seg of [...parseVerseSpec(specA), ...parseVerseSpec(specB)]) {
    if (seg.part) {
      partRefs.add(`${seg.start}${seg.part}`);
    } else {
      for (let n = seg.start; n <= seg.end; n++) intRefs.add(n);
    }
  }
  const refs = [...intRefs].map(String);
  for (const pr of partRefs) {
    if (!intRefs.has(parseInt(pr, 10))) refs.push(pr);
  }
  return selectedVersesToSpec(refs);
}

// ── Bookmark query helpers ──

function _walkBookmarks(store, fn) {
  for (const item of store) {
    if (fn(item, store) === false) return false;
    if (item.type === "folder") {
      if (_walkBookmarks(item.children, fn) === false) return false;
    }
  }
  return true;
}

function findExistingChapterBookmarks(bookId, chapter) {
  const results = [];
  _walkBookmarks(loadBookmarks(), (item) => {
    if (item.type === "bookmark" && item.bookId === bookId && item.chapter === chapter) {
      results.push(item);
    }
  });
  return results;
}

function _findItemInStore(store, id) {
  for (let i = 0; i < store.length; i++) {
    if (store[i].id === id) return { item: store[i], parent: store, index: i };
    if (store[i].type === "folder") {
      const found = _findItemInStore(store[i].children, id);
      if (found) return found;
    }
  }
  return null;
}

// Returns the parent folder's id (null = root), or undefined if not found.
function _findParentFolderId(store, id, parentId = null) {
  for (const item of store) {
    if (item.id === id) return parentId;
    if (item.type === "folder") {
      const r = _findParentFolderId(item.children, id, item.id);
      if (r !== undefined) return r;
    }
  }
  return undefined;
}

function removeItemById(store, id) {
  const found = _findItemInStore(store, id);
  if (found) found.parent.splice(found.index, 1);
}

function insertItem(store, folderId, item) {
  if (!folderId) {
    store.push(item);
    return;
  }
  const found = _findItemInStore(store, folderId);
  if (found && found.item.type === "folder") {
    found.item.children.push(item);
  } else {
    store.push(item);
  }
}

function collectFolderOptions(store, depth = 0, options = []) {
  for (const item of store) {
    if (item.type === "folder") {
      options.push({ id: item.id, name: item.name, depth });
      collectFolderOptions(item.children, depth + 1, options);
    }
  }
  return options;
}

// ── Drag & drop helpers ──

function _isDescendant(folder, id) {
  return (folder.children || []).some(c =>
    c.id === id || (c.type === "folder" && _isDescendant(c, id)));
}

function moveBookmarkItem(draggedId, targetId, position) {
  if (draggedId === targetId) return;
  const store = loadBookmarks();
  const df = _findItemInStore(store, draggedId);
  if (!df) return;
  const draggedItem = df.item;

  // "into" only valid for folders; validate no circular drop
  if (position === "into") {
    const t = _findItemInStore(store, targetId);
    if (!t || t.item.type !== "folder") position = "after";
    else if (draggedItem.type === "folder" && _isDescendant(draggedItem, targetId)) return;
  } else if (draggedItem.type === "folder" && _isDescendant(draggedItem, targetId)) {
    return;
  }
  df.parent.splice(df.index, 1); // remove from current location

  if (position === "into") {
    const tf = _findItemInStore(store, targetId);
    if (tf) tf.item.children.unshift(draggedItem);
    else store.push(draggedItem);
  } else {
    const tf = _findItemInStore(store, targetId);
    if (!tf) {
      store.push(draggedItem);
    } else {
      tf.parent.splice(position === "before" ? tf.index : tf.index + 1, 0, draggedItem);
    }
  }

  saveBookmarks(store);
  renderBookmarkTree();
}


function _clearDragIndicators() {
  document.querySelectorAll(".drag-over-before, .drag-over-after, .drag-over-into")
    .forEach(n => n.classList.remove("drag-over-before", "drag-over-after", "drag-over-into"));
}

function _updateDragIndicators(clientX, clientY) {
  _clearDragIndicators();
  const hitEl = document.elementFromPoint(clientX, clientY);
  const target = hitEl?.closest("[data-id]");
  if (!target || target.dataset.id === _dragState?.id) return;
  const rowEl = target.querySelector(".bm-folder-row, .bm-bookmark-row");
  const r = (rowEl || target).getBoundingClientRect();
  const isFolder = target.classList.contains("bm-folder");
  const rel = clientY - r.top;
  if (isFolder && rel > r.height * 0.3 && rel < r.height * 0.7) {
    target.classList.add("drag-over-into");
  } else {
    target.classList.add(rel < r.height / 2 ? "drag-over-before" : "drag-over-after");
  }
}

function _setupDragHandle(li, row) {
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("button")) return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const origRect = li.getBoundingClientRect();
    let dragStarted = false;

    const cleanupPointerHandlers = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", cancel);
      if (row.hasPointerCapture(pointerId)) {
        try { row.releasePointerCapture(pointerId); } catch {}
      }
    };

    function onMove(e) {
      if (e.pointerId !== pointerId) return;
      if (!dragStarted) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
        dragStarted = true;
        const ghost = document.createElement("li");
        ghost.className = "bm-drag-ghost";
        ghost.style.width = origRect.width + "px";
        ghost.style.left = origRect.left + "px";
        const rowClone = (li.querySelector(".bm-folder-row, .bm-bookmark-row") || li.firstElementChild).cloneNode(true);
        ghost.appendChild(rowClone);
        document.body.appendChild(ghost);
        row.setPointerCapture(e.pointerId);
        li.classList.add("bm-dragging");
        _dragState = { id: li.dataset.id, ghost, origLi: li, startY, origTop: origRect.top };
      }
      if (!_dragState) return;
      _dragState.ghost.style.top = (_dragState.origTop + (e.clientY - _dragState.startY)) + "px";
      _updateDragIndicators(e.clientX, e.clientY);
    }

    function finish(e) {
      if (e.pointerId !== pointerId) return;
      cleanupPointerHandlers();
      if (!_dragState) return;
      const ds = _dragState;
      _dragState = null;
      ds.ghost.remove();
      ds.origLi.classList.remove("bm-dragging");
      const overItem = document.querySelector(".drag-over-before, .drag-over-after, .drag-over-into");
      if (overItem) {
        const pos = overItem.classList.contains("drag-over-into") ? "into"
          : overItem.classList.contains("drag-over-before") ? "before" : "after";
        moveBookmarkItem(ds.id, overItem.dataset.id, pos);
      }
      _clearDragIndicators();
    }

    function cancel(e) {
      if (e.pointerId !== pointerId) return;
      cleanupPointerHandlers();
      if (!_dragState) return;
      _dragState.ghost.remove();
      _dragState.origLi.classList.remove("bm-dragging");
      _clearDragIndicators();
      _dragState = null;
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", cancel);
  });
}

// ── Data fetching ──

async function loadBooks() {
  if (booksCache) return booksCache;
  // Use pre-fetched promise if available
  const promise = window.booksPromise || fetch(`${DATA_DIR}/books.json`).then(res => {
    if (!res.ok) throw new Error("Failed to load books.json");
    return res.json();
  });
  booksCache = await promise;
  return booksCache;
}

async function loadVersion() {
  if (appVersion) return appVersion;
  try {
    const res = await fetch("/version.json");
    const data = await res.json();
    appVersion = data.version;
  } catch {
    appVersion = "";
  }
  return appVersion;
}

async function loadChapter(bookId, chapter) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-${chapter}.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-${chapter}.json`);
  return res.json();
}

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

  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = popover.querySelector('a[href]');
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !$title.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  popover.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  $title.appendChild(btn);
  $title.appendChild(popover);
}

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

  let cleanupTrap = null;

  btn.addEventListener("click", () => {
    const open = !popover.hidden;
    popover.hidden = open;
    btn.setAttribute("aria-expanded", String(!open));
    if (!open) {
      cleanupTrap = trapFocus(popover);
      const first = popover.querySelector('a[href]');
      if (first) first.focus();
    } else if (cleanupTrap) {
      cleanupTrap(); cleanupTrap = null;
    }
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !$title.contains(e.target)) {
      popover.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (cleanupTrap) { cleanupTrap(); cleanupTrap = null; }
    }
  });

  popover.addEventListener("click", (e) => {
    if (e.target.tagName === "A") {
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

function clearReadingPosition() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (_) {}
}

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
  _currentBookId = book.id;
  _currentChapter = ch;

  // Announce verse number on click/tap for screen reader users,
  // or toggle verse selection when in select mode.
  article.addEventListener("click", (e) => {
    const vs = e.target.closest(".verse[data-vref]");
    if (!vs) return;
    if (_verseSelectMode) {
      e.stopPropagation(); // selection is handled by pointer events
      return;
    }
    announce(`${vs.getAttribute("data-vref")}절`);
  });

  // Long-press (300ms) to enter verse selection mode.
  // pointermove only cancels after >10px of movement to tolerate natural finger drift.
  let _longPressTimer = null;
  let _longPressStartX = 0;
  let _longPressStartY = 0;
  article.addEventListener("pointerdown", (e) => {
    if (_verseSelectMode) {
      const vs = e.target.closest(".verse[data-vref]");
      if (!vs) return;
      e.preventDefault(); // prevent text selection during drag
      const allVerses = [...article.querySelectorAll(".verse[data-vref]")];
      const startIdx = allVerses.indexOf(vs);
      const isAdding = !_selectedVerseRefs.has(vs.getAttribute("data-vref"));
      _verseSelectDrag = { startIdx, allVerses, isAdding, moved: false, snapshot: new Set(_selectedVerseRefs) };
      article.setPointerCapture(e.pointerId);
      return;
    }
    const vs = e.target.closest(".verse[data-vref]");
    if (!vs) return;
    _longPressStartX = e.clientX;
    _longPressStartY = e.clientY;
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      enterVerseSelectMode(book.id, ch);
      const vref = vs.getAttribute("data-vref");
      if (vref) {
        _selectedVerseRefs.add(vref);
        article.querySelectorAll(".verse[data-vref]").forEach(v => {
          v.classList.toggle("verse-selected", _selectedVerseRefs.has(v.getAttribute("data-vref")));
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
    if (_verseSelectDrag) {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const vs = target && target.closest(".verse[data-vref]");
      if (!vs) return;
      const { startIdx, allVerses, isAdding, snapshot } = _verseSelectDrag;
      const currentIdx = allVerses.indexOf(vs);
      if (currentIdx === -1) return;
      if (!_verseSelectDrag.moved && currentIdx === startIdx) return;
      _verseSelectDrag.moved = true;
      const [lo, hi] = startIdx <= currentIdx ? [startIdx, currentIdx] : [currentIdx, startIdx];
      _selectedVerseRefs = new Set(snapshot);
      allVerses.forEach((v, i) => {
        const vref = v.getAttribute("data-vref");
        if (i >= lo && i <= hi) {
          if (isAdding) _selectedVerseRefs.add(vref);
          else _selectedVerseRefs.delete(vref);
        }
        v.classList.toggle("verse-selected", _selectedVerseRefs.has(vref));
      });
      updateVerseSelectionBoundaries(article);
      updateVerseSelectBar();
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointerup", (e) => {
    if (_verseSelectDrag) {
      if (!_verseSelectDrag.moved) {
        // Simple tap: toggle start verse
        const vs = _verseSelectDrag.allVerses[_verseSelectDrag.startIdx];
        if (vs) {
          const vref = vs.getAttribute("data-vref");
          if (_verseSelectDrag.isAdding) _selectedVerseRefs.add(vref);
          else _selectedVerseRefs.delete(vref);
          _verseSelectDrag.allVerses.forEach(v => {
            v.classList.toggle("verse-selected", _selectedVerseRefs.has(v.getAttribute("data-vref")));
          });
          updateVerseSelectionBoundaries(article);
          updateVerseSelectBar();
        }
      }
      _verseSelectDrag = null;
      return;
    }
    cancelLongPress(e);
  });

  article.addEventListener("pointercancel", (e) => {
    if (_verseSelectDrag) { _verseSelectDrag = null; return; }
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
    if (!firstVerse) return;

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

    let firstNum = null;
    let lastNum = null;
    for (const vs of work.querySelectorAll(".verse[data-vref]")) {
      const n = parseInt(vs.getAttribute("data-vref"), 10);
      if (!Number.isFinite(n)) continue;
      if (firstNum === null) firstNum = n;
      lastNum = n;
    }
    if (firstNum === null) return;

    const plainText = work.textContent
      .replace(/\u2060/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const ref = firstNum === lastNum
      ? `${book.name_ko} ${ch}:${firstNum}`
      : `${book.name_ko} ${ch}:${firstNum}-${lastNum}`;

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
      page: parseInt(query.get("page"), 10) || 1,
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

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

function updatePageMeta({ title, description } = {}) {
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
  if (_verseSelectMode) exitVerseSelectMode();
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
    $searchInput.value = parsed.query;
    $searchClear.hidden = !parsed.query;
  } else {
    $searchInput.value = "";
    $searchClear.hidden = true;
  }

  try {
    if (view === "search") {
      if (parsed.query) {
        const autoNav = searchAutoNavigate;
        searchAutoNavigate = false;
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
  const a = e.target.closest("a[href]");
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
    });
  });
});

// ── Audio Player ──

function formatTime(sec) {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Lift FAB above chapter-nav when it scrolls into view on mobile
let _fabNavObserver = null;
function observeFabLift() {
  if (_fabNavObserver) { _fabNavObserver.disconnect(); _fabNavObserver = null; }
  const nav = $app.querySelector(".chapter-nav");
  if (!nav) return;
  _fabNavObserver = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    if (visible) {
      // Center the FAB vertically in the gap (margin-top: 4.5rem) above chapter-nav
      const navH = nav.offsetHeight;
      const fabH = $searchFab.offsetHeight;
      const gapPx = parseFloat(getComputedStyle(nav).marginTop);
      const liftPx = navH + (gapPx - fabH) / 2;
      $searchFab.style.setProperty("--fab-lift-nav", `${Math.max(liftPx, navH + 4)}px`);
    } else {
      $searchFab.style.removeProperty("--fab-lift-nav");
    }
  }, { threshold: 0 });
  _fabNavObserver.observe(nav);
}

function _teardownAudio() {
  if (_audioController) { _audioController.abort(); _audioController = null; }
  clearTimeout(_audioSaveTimer); _audioSaveTimer = null;
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
}

function hideAudioBar() {
  _teardownAudio();
  $audioBar.hidden = true;
  clearNode($audioBar);
}

function showAudioPlayer(bookId, chapter) {
  _teardownAudio();
  _audioController = new AbortController();
  const { signal } = _audioController;
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  currentAudio = audio;

  const savedTime = loadAudioTime(bookId, chapter);
  let srcLoaded = false;
  if (savedTime) {
    // Eagerly load metadata to restore seek position before first play
    srcLoaded = true;
    audio.preload = "metadata";
    audio.src = src;
  } else {
    audio.preload = "none";
  }

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
    const pct = progress.max > 0 ? (Number(progress.value) / Number(progress.max)) * 100 : 0;
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

  // Play/pause toggle — load src lazily on first click (srcLoaded declared above)
  playBtn.addEventListener("click", () => {
    if (!srcLoaded) {
      srcLoaded = true;
      playIcon.className = "audio-icon-loading";
      audio.src = src;
      audio.play().catch(() => {});
      return;
    }
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
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
      timeDisplay.textContent = formatTime(audio.duration);
    }
  }, { signal });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
    clearTimeout(_audioSaveTimer);
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

// ── Search ──

let searchWorker = null;
let pendingSearchCb = null;
let activeSearchId = 0;
// Called when partial results arrive before all chunks are loaded.
// Overwritten by renderSearchResults / runSheetSearch for each search.
let partialResultsCb = null;

function ensureSearchWorker() {
  if (searchWorker) return searchWorker;
  searchWorker = new Worker("/js/search-worker.js");
  searchWorker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg.type === "partial-results" && msg.searchId === activeSearchId) {
      if (partialResultsCb) partialResultsCb(msg);
    }
    if (msg.type === "results" || msg.type === "error") {
      // Worker init/load failures may emit error without searchId in some browsers.
      // Treat those as terminal for the current pending search to avoid stuck UI.
      const isCurrentSearch =
        msg.searchId == null ? msg.type === "error" : msg.searchId === activeSearchId;
      if (pendingSearchCb && isCurrentSearch) {
        const cb = pendingSearchCb;
        pendingSearchCb = null;
        cb(msg.type === "error" ? null : msg);
      }
    }
  });
  searchWorker.postMessage({
    type: "init",
    metaUrl: `${DATA_DIR}/search-meta.json`,
    chunks: [
      { name: "nt", url: `${DATA_DIR}/search-nt.json` },
      { name: "dc", url: `${DATA_DIR}/search-dc.json` },
      { name: "ot", url: `${DATA_DIR}/search-ot.json` },
    ],
  });
  return searchWorker;
}

function doSearch(query, page, pageSize, onPartial) {
  return new Promise((resolve) => {
    const worker = ensureSearchWorker();
    activeSearchId += 1;
    pendingSearchCb = resolve;
    partialResultsCb = onPartial || null;
    worker.postMessage({ type: "search", q: query, page, pageSize, searchId: activeSearchId });
  });
}

// Text highlight helper: splits text on query matches and wraps in <mark>
function appendTextWithHighlight(target, text, query) {
  if (!query) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(qLower, pos);
  if (idx === -1) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  while (idx !== -1) {
    if (idx > pos) target.appendChild(document.createTextNode(text.substring(pos, idx)));
    target.appendChild(el("mark", { className: "search-highlight", role: "presentation" }, text.substring(idx, idx + query.length)));
    pos = idx + query.length;
    idx = lower.indexOf(qLower, pos);
  }
  if (pos < text.length) target.appendChild(document.createTextNode(text.substring(pos)));
}

// Build snippet with highlighted query for search results
function buildSnippet(text, query) {
  const frag = document.createDocumentFragment();
  const span = el("span", { className: "search-result-text" });

  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const matchIdx = lower.indexOf(qLower);

  // Show ~40 chars before/after match
  let displayText = text;
  let prefix = "";
  let suffix = "";
  if (text.length > 100 && matchIdx > 40) {
    displayText = text.substring(matchIdx - 30);
    prefix = "…";
  }
  if (displayText.length > 100) {
    displayText = displayText.substring(0, 100);
    suffix = "…";
  }

  if (prefix) span.appendChild(document.createTextNode(prefix));
  appendTextWithHighlight(span, displayText, query);
  if (suffix) span.appendChild(document.createTextNode(suffix));
  frag.appendChild(span);
  return frag;
}

function buildSearchPagination(query, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  const encoded = encodeURIComponent(query);

  if (currentPage > 1) {
    nav.appendChild(el("a", { href: `/search?q=${encoded}&page=${currentPage - 1}` }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", { href: `/search?q=${encoded}&page=${currentPage + 1}` }, "다음 →"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

// Render search result list into a container node (used by both page and sheet views)
function renderSearchResultList(container, result, query, page, pageSize, paginationBuilder) {
  clearNode(container);

  const hasRef = !!result.refMatch;
  const hasResults = result.results && result.results.length > 0;

  if (!hasRef && result.total === 0) {
    container.appendChild(el("p", { className: "search-empty" }, `"${query}"에 대한 검색 결과가 없습니다.`));
    return;
  }

  const list = el("ul", { className: "search-results", role: "list" });

  // 1. Display Reference Match Card if exists
  if (hasRef) {
    const ref = result.refMatch;
    const unit = chUnit(ref.bookId);
    let label = `${ref.bookNameKo} ${ref.chapter}${unit}`;
    if (ref.verse) label += ` ${ref.verse}절`;
    if (ref.verseEnd) label += `-${ref.verseEnd}절`;

    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }

    const li = el("li", { className: "search-result-item ref-match-item" });
    const link = el("a", { href: path, className: "search-result-ref-card" });
    link.appendChild(el("span", { className: "search-result-ref-label" }, "구절 바로가기"));
    link.appendChild(el("span", { className: "search-result-ref-title" }, label));
    li.appendChild(link);
    list.appendChild(li);
  }

  // 2. Display existing Search Results
  const totalPages = Math.ceil(result.total / pageSize);
  const isPending = result.pendingChunks && result.pendingChunks.length > 0;

  if (hasResults || isPending) {
    const countLabel = isPending
      ? `"${query}" 검색 중… (현재 ${result.total}건)`
      : `총 ${result.total}건 (${page}/${totalPages}쪽)`;
    container.appendChild(el("p", { className: "search-count" }, countLabel));

    for (const r of result.results) {
      const li = el("li", { className: "search-result-item" });
      const link = el("a", { href: `/${r.b}/${r.c}/${r.v}?hl=${encodeURIComponent(query)}` });
      link.appendChild(el("span", { className: "search-result-ref" }, `${r.bookNameKo} ${r.c}:${r.v}`));
      link.appendChild(buildSnippet(r.t, query));
      li.appendChild(link);
      list.appendChild(li);
    }
  }

  container.appendChild(list);

  if (!isPending && totalPages > 1 && paginationBuilder) {
    container.appendChild(paginationBuilder(query, page, totalPages));
  }
}

async function renderSearchResults(query, page, autoNavigate = false) {
  setTitle(`"${query}" 검색`);
  setBreadcrumb([{ label: "목록", href: "/" }]);
  hideAudioBar();
  clearNode($app);

  $app.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  // Estimate page size from available viewport height
  const headerH = document.getElementById("app-header").offsetHeight || 80;
  const availH = window.innerHeight - headerH - 40;
  const itemH = 80;
  const pageSize = Math.max(5, Math.floor(availH / itemH));

  function onPartial(partial) {
    renderSearchResultList($app, partial, query, page, pageSize, buildSearchPagination);
    announce(`"${query}" 검색 중… 현재 ${partial.total}건`);
  }

  const result = await doSearch(query, page, pageSize, onPartial);

  if (!result) {
    renderError("검색에 실패했습니다.");
    return;
  }

  // Verse reference match — navigate only when explicitly confirmed (Enter key).
  // On debounce, show a clickable card so partial input (e.g. "요한 3:1" while
  // typing "요한 3:16") doesn't cause premature navigation.
  if (result.refMatch) {
    const ref = result.refMatch;
    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      dismissLaunchScreen();
      history.replaceState(null, "", path);
      route();
    } else {
      // Show the refMatch as a clickable result, and ensure UI is visible
      renderSearchResultList($app, result, query, page, pageSize, buildSearchPagination);
      dismissLaunchScreen();
    }
    return;
  }

  renderSearchResultList($app, result, query, page, pageSize, buildSearchPagination);
  dismissLaunchScreen();

  announce(`"${query}" 검색 결과 ${result.total}건`);
  window.scrollTo(0, 0);
}

// ── Search input event handlers (Desktop inline) ──

let searchDebounceTimer = null;
// True only when search was explicitly confirmed via Enter — allows verse ref auto-navigation.
// Debounce path keeps this false so partial refs (e.g. "요한 3:1" while typing "요한 3:16")
// are shown as a clickable card instead of immediately navigating.
let searchAutoNavigate = false;

$searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(searchDebounceTimer);
    clearTimeout(searchAutoNavTimer);
    const q = $searchInput.value.trim();
    if (!q) return;
    searchAutoNavigate = true;
    const newPath = `/search?q=${encodeURIComponent(q)}`;
    // If path is unchanged, popstate won't fire — call route() directly.
    if (location.pathname + location.search === newPath) {
      route();
    } else {
      navigate(newPath);
    }
  }
});

let searchAutoNavTimer = null;

$searchInput.addEventListener("input", () => {
  const q = $searchInput.value.trim();
  $searchClear.hidden = !q;
  clearTimeout(searchDebounceTimer);
  if (!q) return;
  searchDebounceTimer = setTimeout(() => {
    searchAutoNavigate = false;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }, 400);
});

$searchClear.addEventListener("click", () => {
  $searchInput.value = "";
  $searchClear.hidden = true;
  clearTimeout(searchDebounceTimer);
  clearTimeout(searchAutoNavTimer);
  $searchInput.focus();
  if (parsePath().view === "search") navigate("/");
});

// ── Search bottom sheet (Mobile FAB) ──

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

// Lift the sheet above the on-screen keyboard. Default Android viewport
// behavior (`resizes-visual`) leaves position:fixed elements anchored to the
// layout viewport, so the bottom of the sheet would sit behind the keyboard.
function adjustSheetForKeyboard() {
  if (!window.visualViewport || $searchSheet.hidden) return;
  const vv = window.visualViewport;
  const keyboardOffset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  // Suppress the CSS height transition so viewport adjustments snap instantly
  // rather than lagging 200ms behind rapid visualViewport resize/scroll events.
  $searchSheet.style.transition = "none";
  if (keyboardOffset > 0) {
    // Fill the visible viewport so the page body cannot peek through
    // the gap between the sheet and the on-screen keyboard.
    $searchSheet.style.bottom = `${keyboardOffset}px`;
    $searchSheet.style.height = `${vv.height}px`;
    $searchSheet.style.maxHeight = `${vv.height}px`;
  } else {
    $searchSheet.style.transition = "";
    $searchSheet.style.bottom = "";
    $searchSheet.style.height = "";
    $searchSheet.style.maxHeight = "";
  }
}

function openSearchSheet(query) {
  $searchScrim.hidden = false;
  $searchSheet.hidden = false;
  $searchSheetInput.value = query || "";
  $searchSheetClear.hidden = !query;
  $searchFab.hidden = true;
  // Focus synchronously so iOS Safari opens the on-screen keyboard.
  // requestAnimationFrame would defer past the user-gesture context.
  $searchSheetInput.focus({ preventScroll: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", adjustSheetForKeyboard);
    window.visualViewport.addEventListener("scroll", adjustSheetForKeyboard);
  }
  if (query) runSheetSearch(query, 1);
}

function closeSearchSheet() {
  $searchScrim.hidden = true;
  $searchSheet.hidden = true;
  $searchSheet.style.transition = "";
  $searchSheet.style.height = "";
  $searchSheet.style.bottom = "";
  $searchSheet.style.maxHeight = "";
  $searchFab.hidden = false;
  clearNode($searchSheetResults);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener("resize", adjustSheetForKeyboard);
    window.visualViewport.removeEventListener("scroll", adjustSheetForKeyboard);
  }
}

let sheetDebounceTimer = null;

function getSheetPageSize() {
  // Estimate how many results fit in the visible sheet area
  const resultsH = $searchSheetResults.clientHeight || (window.innerHeight * 0.55 - 90);
  const itemH = 80; // approx height per result item
  return Math.max(5, Math.floor(resultsH / itemH));
}

function buildSheetPagination(query, page, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  if (page > 1) {
    const prev = el("a", { href: "#", "aria-label": "이전 페이지" }, "← 이전");
    prev.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page - 1); $searchSheetResults.scrollTop = 0; });
    nav.appendChild(prev);
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }
  nav.appendChild(el("span", { className: "search-page-info" }, `${page} / ${totalPages}`));
  if (page < totalPages) {
    const next = el("a", { href: "#", "aria-label": "다음 페이지" }, "다음 →");
    next.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page + 1); $searchSheetResults.scrollTop = 0; });
    nav.appendChild(next);
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }
  return nav;
}

async function runSheetSearch(query, page, autoNavigate = false) {
  clearNode($searchSheetResults);
  if (!query) return;

  $searchSheetResults.appendChild(el("div", { className: "loading" }, "검색 중…"));

  const pageSize = getSheetPageSize();

  function onPartial(partial) {
    // Add click-to-close to each result link for sheet view
    const frag = document.createDocumentFragment();
    const tempDiv = el("div");
    renderSearchResultList(tempDiv, partial, query, page, pageSize, null);
    // Attach closeSearchSheet to all links
    tempDiv.querySelectorAll("a[href]").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));
    while (tempDiv.firstChild) frag.appendChild(tempDiv.firstChild);
    clearNode($searchSheetResults);
    $searchSheetResults.appendChild(frag);
  }

  const result = await doSearch(query, page, pageSize, onPartial);
  clearNode($searchSheetResults);

  if (!result) {
    $searchSheetResults.appendChild(el("div", { className: "error" }, "검색에 실패했습니다."));
    return;
  }

  // Verse reference — navigate only when explicitly confirmed (Enter key).
  if (result.refMatch) {
    const ref = result.refMatch;
    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      closeSearchSheet();
      navigate(path);
    } else {
      // Show the refMatch as a clickable result in the sheet
      renderSearchResultList($searchSheetResults, result, query, page, pageSize, null);
      // Attach closeSearchSheet to the reference link
      $searchSheetResults.querySelectorAll("a[href^='/']").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));
    }
    return;
  }

  renderSearchResultList($searchSheetResults, result, query, page, pageSize, buildSheetPagination);
  // Attach closeSearchSheet to all result links
  $searchSheetResults.querySelectorAll("a[href^='/']").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));

  announce(`"${query}" 검색 결과 ${result.total}건`);
}

$searchFab.addEventListener("click", () => openSearchSheet(""));

$searchScrim.addEventListener("click", closeSearchSheet);
$searchSheetClose.addEventListener("click", closeSearchSheet);

let sheetAutoNavTimer = null;

$searchSheetInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(sheetDebounceTimer);
    clearTimeout(sheetAutoNavTimer);
    const q = $searchSheetInput.value.trim();
    if (q) runSheetSearch(q, 1, true);
  }
});

$searchSheetInput.addEventListener("input", () => {
  const q = $searchSheetInput.value.trim();
  $searchSheetClear.hidden = !q;
  clearTimeout(sheetDebounceTimer);
  if (!q) { clearNode($searchSheetResults); return; }
  sheetDebounceTimer = setTimeout(() => runSheetSearch(q, 1, false), 400);
});

$searchSheetClear.addEventListener("click", () => {
  $searchSheetInput.value = "";
  $searchSheetClear.hidden = true;
  clearTimeout(sheetDebounceTimer);
  clearTimeout(sheetAutoNavTimer);
  clearNode($searchSheetResults);
  $searchSheetInput.focus();
});

// Drag-handle initializers — registered later in the deferred startup hook.
// Each operates on a hidden surface (search sheet / bookmark drawer), so
// nothing is interactive before the user opens that surface; deferring
// keeps these listener attachments off the launch critical path.
function initSheetDrag() {
  const handle = document.getElementById("search-sheet-handle");
  let startY = 0;
  let startH = 0;

  function onMove(clientY) {
    const delta = startY - clientY;
    const newH = Math.min(Math.max(startH + delta, window.innerHeight * 0.3), window.innerHeight * 0.9);
    $searchSheet.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = $searchSheet.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    // Snap close if dragged very low
    if ($searchSheet.offsetHeight < window.innerHeight * 0.2) {
      closeSearchSheet();
      $searchSheet.style.height = "";
    }
  }
}

function initBookmarkSheetDrag() {
  const handle = document.getElementById("bookmark-drawer-handle");
  const drawer = document.getElementById("bookmark-drawer");
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
  const handle = document.getElementById("bookmark-drawer-resize");
  const drawer = document.getElementById("bookmark-drawer");
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
  const header = document.getElementById("app-header");
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

// ── PWA install detection ──
//
// Platforms:
//   "installed"    — already running as a standalone PWA, nothing to show
//   "ios-safari"   — iPhone/iPad Safari; manual "Add to Home Screen" guide
//   "ios-other"    — iOS Chrome/Firefox/etc (WebKit wrapper); prompt user to open in Safari
//   "android"      — Chromium-based Android; beforeinstallprompt available
//   "desktop"      — Chromium-based desktop; beforeinstallprompt available
//   "unsupported"  — Firefox/Safari desktop, etc; hide install entry
//
// beforeinstallprompt is captured and stored so the install modal can call prompt()
// on user gesture. The `appinstalled` event and display-mode change both flip state.

const install = (() => {
  let deferredPrompt = null;
  const listeners = new Set();

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true
    );
  }

  function detectPlatform() {
    if (isStandalone()) return "installed";
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS 13+
    if (isIOS) {
      // On iOS all browsers use WebKit, but only Safari can install.
      // Safari UA does not include CriOS/FxiOS/EdgiOS/OPiOS.
      const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
      return isSafari ? "ios-safari" : "ios-other";
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

// ── Install guide modal ──

const $installScrim = document.getElementById("install-scrim");
const $installModal = document.getElementById("install-modal");
const $installModalBody = document.getElementById("install-modal-body");
const $installModalClose = document.getElementById("install-modal-close");

let installModalTrap = null;
let installModalLastFocus = null;

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
    let timer = reducedMotion ? null : setInterval(() => goToStep((currentStep + 1) % steps.length), 3000);
    function resetTimer() {
      if (reducedMotion) return;
      clearInterval(timer);
      timer = setInterval(() => goToStep((currentStep + 1) % steps.length), 3000);
    }
    $installModal.addEventListener("install:cleanup", () => clearInterval(timer), { once: true });

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
    $installModalBody.appendChild(el("p", {},
      "iOS에서는 Safari에서만 홈 화면에 앱을 설치할 수 있습니다."));
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
        : "브라우저 메뉴의 \u2018앱 설치\u2019 또는 \u2018홈 화면에 추가\u2019를 선택해도 됩니다.");
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

// Elements that become inert (background) while a modal/drawer is open.
// Each selector excludes the modal/drawer that is currently active.
const INSTALL_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #search-fab, #search-sheet, #search-scrim, #launch-screen, #bookmark-scrim, #bookmark-drawer, #verse-select-bar";
const BOOKMARK_INERT_SELECTORS = "#sticky-group, main#app, #audio-bar, #search-fab, #search-sheet, #search-scrim, #launch-screen, #install-scrim, #install-modal, #verse-select-bar";

function setInert(on, selectors) {
  document.querySelectorAll(selectors).forEach((n) => {
    if (on) {
      n.inert = true;
      n.setAttribute("aria-hidden", "true");
    } else {
      n.inert = false;
      n.removeAttribute("aria-hidden");
    }
  });
}

function setBackgroundInert(on) { setInert(on, INSTALL_INERT_SELECTORS); }
function setBookmarkBackgroundInert(on) { setInert(on, BOOKMARK_INERT_SELECTORS); }

function _buildNeverShowRow() {
  const row = el("div", { className: "install-never-show-row" });
  const checkbox = el("input", { type: "checkbox", id: "install-never-show" });
  const label = el("label", { for: "install-never-show" }, " 다시 열지 않음");
  row.appendChild(checkbox);
  row.appendChild(label);
  return row;
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
  document.body.dataset.scrollY = scrollY;
  installModalTrap = trapFocus($installModal);
  requestAnimationFrame(() => $installModalClose.focus());
}

function closeInstallModal() {
  if ($installModal.hidden) return;
  const neverShowCb = document.getElementById("install-never-show");
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
  if (installModalLastFocus && installModalLastFocus.focus) {
    try { installModalLastFocus.focus(); } catch {}
  }
}

$installModalClose.addEventListener("click", closeInstallModal);
$installScrim.addEventListener("click", closeInstallModal);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$installModal.hidden) closeInstallModal();
});

// ── Install nudge (auto-show) ──

function _loadNudgeState() {
  try {
    const raw = localStorage.getItem(INSTALL_NUDGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { visits: 0, nextShow: 1, neverShow: false };
}

function _saveNudgeState(state) {
  try { localStorage.setItem(INSTALL_NUDGE_KEY, JSON.stringify(state)); } catch (_) {}
}

function maybeShowInstallNudge() {
  const platform = install.detectPlatform();
  // Only nudge platforms where installation is meaningful and possible
  const nudgeable = platform === "ios-safari" || platform === "android";
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

// ── Bookmark UI ──

const $bookmarkScrim = document.getElementById("bookmark-scrim");
const $bookmarkDrawer = document.getElementById("bookmark-drawer");
const $bookmarkDrawerClose = document.getElementById("bookmark-drawer-close");
const $bookmarkDrawerBody = document.getElementById("bookmark-drawer-body");
const $bmSaveChapterBtn = document.getElementById("bm-save-chapter-btn");
const $bmSelectVersesBtn = document.getElementById("bm-select-verses-btn");
const $bmAddFolderBtn = document.getElementById("bm-add-folder-btn");
const $bmOverflowBtn = document.getElementById("bm-overflow-btn");
const $bmOverflowPanel = document.getElementById("bm-overflow-panel");
const $bmExportBtn = document.getElementById("bm-export-btn");
const $bmImportBtn = document.getElementById("bm-import-btn");
const $bmImportInput = document.getElementById("bm-import-input");
const $bmImportScrim = document.getElementById("bm-import-scrim");
const $bmImportModal = document.getElementById("bm-import-modal");
const $bmImportBody = document.getElementById("bm-import-body");
const $bmImportMerge = document.getElementById("bm-import-merge");
const $bmImportOverwrite = document.getElementById("bm-import-overwrite");
const $bmImportCancel = document.getElementById("bm-import-cancel");
const $bmSaveScrim = document.getElementById("bm-save-scrim");
const $bmSaveModal = document.getElementById("bm-save-modal");
const $bmSaveClose = document.getElementById("bm-save-close");
const $bmSaveTitle = document.getElementById("bm-save-title");
const $bmSaveBody = document.getElementById("bm-save-body");
const $bmMergeScrim = document.getElementById("bm-merge-scrim");
const $bmMergeModal = document.getElementById("bm-merge-modal");
const $bmMergeBody = document.getElementById("bm-merge-body");
const $bmMergeYes = document.getElementById("bm-merge-yes");
const $bmMergeNo = document.getElementById("bm-merge-no");
const $bmMergeCancel = document.getElementById("bm-merge-cancel");
const $verseSelectBar = document.getElementById("verse-select-bar");
const $verseSelectCount = document.getElementById("verse-select-count");
const $verseSelectBookmarkBtn = document.getElementById("verse-select-bookmark-btn");
const $verseSelectCancelBtn = document.getElementById("verse-select-cancel-btn");

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
  if (!btn || !_currentBookId || !_currentChapter) return;
  btn.classList.toggle(
    "has-bookmark",
    findExistingChapterBookmarks(_currentBookId, _currentChapter).length > 0
  );
}

function openBookmarkDrawer(bookId, chapter) {
  _bookmarkDrawerCloseSeq += 1;
  if (_bookmarkDrawerCloseTimer) {
    clearTimeout(_bookmarkDrawerCloseTimer);
    _bookmarkDrawerCloseTimer = null;
  }
  $bookmarkDrawer.classList.remove("drawer-closing");
  _bookmarkDrawerBook = bookId;
  _bookmarkDrawerChapter = chapter;
  _bookmarkDrawerLastFocus = document.activeElement;
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
  document.body.dataset.scrollY = scrollY;
  _bookmarkDrawerTrap = trapFocus($bookmarkDrawer);
  requestAnimationFrame(() => $bookmarkDrawerClose.focus());
}

function closeBookmarkDrawer() {
  if ($bookmarkDrawer.hidden || $bookmarkDrawer.classList.contains("drawer-closing")) return;
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
  const typeIcon = el("span", { className: "bm-bookmark-type-icon" });
  typeIcon.appendChild(_buildBookmarkTypeIcon(isActive));
  const link = el("a", { className: "bm-bookmark-link", href: _bookmarkHref(bm), draggable: "false" });
  link.appendChild(el("span", { className: "bm-bookmark-label" }, bm.label));
  if (bm.verseSpec !== "all") {
    link.appendChild(el("span", { className: "bm-bookmark-ref" }, bm.verseSpec));
  }
  link.addEventListener("click", (e) => {
    e.preventDefault();
    closeBookmarkDrawer();
    navigate(_bookmarkHref(bm));
  });
  const actions = el("div", { className: "bm-item-actions" });
  const editBtn = el("button", { className: "bm-action-btn bm-edit-btn", type: "button" }, "수정");
  editBtn.addEventListener("click", () => openSaveModal("edit", { existingId: bm.id }));
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", () => {
    if (!window.confirm(`"${bm.label}" 북마크를 삭제할까요?`)) return;
    const store = loadBookmarks();
    removeItemById(store, bm.id);
    saveBookmarks(store);
    renderBookmarkTree();
    refreshBookmarkHeaderBtn();
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  row.appendChild(typeIcon);
  row.appendChild(link);
  row.appendChild(actions);
  li.appendChild(row);
  return li;
}

/**
 * Material Icons "folder" (24dp) — same contour as the filled symbol, stroked only (hollow).
 * @param {{ size?: number }} [opts]
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

  function labelForId(id) {
    if (id === "" || id == null) return "최상위";
    const o = folderOptions.find(f => f.id === id);
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

  addOption("", "최상위", 0);
  for (const o of folderOptions) addOption(String(o.id), o.name, o.depth);
  updateButton();
  updateOptionSelected();

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (list.hidden) openList();
    else closeList();
  });

  wrap._bmClose = closeList;
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
  const expanded = _hasActiveDescendant(folder);
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
  const toggle = el("span", { className: "bm-folder-toggle", "aria-hidden": "true" });
  toggle.appendChild(_buildFolderToggleIcon(expanded));
  const name = el("span", { className: "bm-folder-name" }, folder.name);
  row.addEventListener("click", (e) => {
    if (e.target.closest(".bm-item-actions")) return;
    const newExpanded = li.getAttribute("aria-expanded") !== "true";
    li.setAttribute("aria-expanded", String(newExpanded));
    toggle.replaceChildren(_buildFolderToggleIcon(newExpanded));
  });
  const actions = el("div", { className: "bm-item-actions" });
  const renameBtn = el("button", { className: "bm-action-btn", type: "button" }, "수정");
  renameBtn.addEventListener("click", () => {
    const newName = window.prompt("폴더 이름:", folder.name);
    if (!newName || !newName.trim()) return;
    const store = loadBookmarks();
    const found = _findItemInStore(store, folder.id);
    if (found) found.item.name = newName.trim();
    saveBookmarks(store);
    renderBookmarkTree();
  });
  const delBtn = el("button", { className: "bm-action-btn bm-delete-btn", type: "button" }, "삭제");
  delBtn.addEventListener("click", () => {
    const childCount = folder.children ? folder.children.length : 0;
    const msg = childCount > 0
      ? `"${folder.name}" 폴더와 안의 항목 ${childCount}개를 모두 삭제할까요?`
      : `"${folder.name}" 폴더를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    const store = loadBookmarks();
    removeItemById(store, folder.id);
    saveBookmarks(store);
    renderBookmarkTree();
  });
  actions.appendChild(renameBtn);
  actions.appendChild(delBtn);
  row.appendChild(toggle);
  row.appendChild(name);
  row.appendChild(actions);
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
  clearNode($bookmarkDrawerBody);
  const store = loadBookmarks();
  if (!store.length) {
    $bookmarkDrawerBody.appendChild(el("li", { className: "bm-empty" }, "저장된 북마크가 없습니다."));
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

$bookmarkDrawerBody.addEventListener("keydown", (e) => {
  // Ignore keypresses originating from interactive controls inside the row (buttons, inputs)
  if (e.target.closest(".bm-item-actions, .bm-bookmark-link")) return;
  const item = e.target.closest("[role=treeitem]");
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
      const link = item.querySelector(".bm-bookmark-link");
      if (link) link.click();
    }
  }
});

// ── Save bookmark modal ──

function openSaveModal(mode, opts = {}) {
  // Drawer may not be open when entering via long-press; fall back to current context.
  const bookId = _bookmarkDrawerBook || _currentBookId;
  const chapter = _bookmarkDrawerChapter || _currentChapter;
  let verseSpec = "all";
  let existingId = opts.existingId || null;
  let existing = null;

  if (existingId) {
    const found = _findItemInStore(loadBookmarks(), existingId);
    if (found && found.item.type === "bookmark") existing = found.item;
  }

  if (mode === "verses") {
    const article = document.querySelector("article.chapter-text");
    const refs = collapseFullVerseRefs(Array.from(_selectedVerseRefs), article);
    verseSpec = refs.length ? selectedVersesToSpec(refs) : "all";
  } else if (existing) {
    verseSpec = existing.verseSpec;
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
  const prevCombo = document.getElementById("bm-folder-combobox");
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
    const label = labelInput.value.trim() || defaultLabel;
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
  const c = document.getElementById("bm-folder-combobox");
  if (c && c._bmClose) c._bmClose();
  $bmSaveScrim.hidden = true;
  $bmSaveModal.hidden = true;
  if (_bmSaveModalTrap) { _bmSaveModalTrap(); _bmSaveModalTrap = null; }
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

function openMergeDialog(candidates, incomingSpec, mode, fallbackContext = null) {
  clearNode($bmMergeBody);
  const resolvedBookId =
    (fallbackContext && fallbackContext.bookId) || _bookmarkDrawerBook || _currentBookId;
  const resolvedChapter =
    (fallbackContext && fallbackContext.chapter) || _bookmarkDrawerChapter || _currentChapter;

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
    const merged = mergeVerseSpecs(target.verseSpec, incomingSpec);
    const store = loadBookmarks();
    const found = _findItemInStore(store, target.id);
    if (found) {
      found.item.verseSpec = merged;
      // Sync label to reflect the merged verse spec
      const book = booksCache && booksCache.find(b => b.id === target.bookId);
      const bookName = book ? (book.short_name_ko || book.name_ko) : target.bookId;
      const unit = chUnit(target.bookId);
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
  const date = new Date().toISOString().slice(0, 10);
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
  _verseSelectMode = true;
  _selectedVerseRefs.clear();
  _currentBookId = bookId;
  _currentChapter = chapter;
  document.body.classList.add("verse-select-active");
  $verseSelectBar.hidden = false;
  updateVerseSelectBar();
  announce("절 선택 모드. 절을 탭해서 선택하세요.");
}

function exitVerseSelectMode() {
  _verseSelectMode = false;
  _selectedVerseRefs.clear();
  document.body.classList.remove("verse-select-active");
  $verseSelectBar.hidden = true;
  document.querySelectorAll(".verse-selected, .verse-selected-join-prev, .verse-selected-join-next")
    .forEach(v => v.classList.remove("verse-selected", "verse-selected-join-prev", "verse-selected-join-next"));
}

function updateVerseSelectBar() {
  const count = _selectedVerseRefs.size;
  if (count === 0) {
    $verseSelectCount.textContent = "절을 눌러 선택하세요.";
  } else {
    const articleEl = document.querySelector("article.chapter-text");
    const refs = collapseFullVerseRefs(Array.from(_selectedVerseRefs), articleEl);
    const spec = refs.length
      ? selectedVersesToSpec(refs)
      : selectedVersesToSpec(Array.from(_selectedVerseRefs));
    $verseSelectCount.textContent = `${spec.replace(/,/g, ', ')}절 선택됨`;
  }
  $verseSelectBookmarkBtn.disabled = count === 0;
}

// ── Drawer toolbar event handlers ──

$bookmarkDrawerClose.addEventListener("click", closeBookmarkDrawer);
$bookmarkScrim.addEventListener("click", closeBookmarkDrawer);

$bmSaveClose.addEventListener("click", closeSaveModal);
$bmSaveScrim.addEventListener("click", closeSaveModal);

$bmSaveChapterBtn.addEventListener("click", () => {
  openSaveModal("chapter");
});

$bmSelectVersesBtn.addEventListener("click", () => {
  closeBookmarkDrawer();
  enterVerseSelectMode(_bookmarkDrawerBook, _bookmarkDrawerChapter);
});

$bmAddFolderBtn.addEventListener("click", () => {
  const toolbar = document.getElementById("bookmark-drawer-toolbar");
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
  const file = $bmImportInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
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
    if (_verseSelectMode) { exitVerseSelectMode(); return; }
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

  function showUpdateToast(waitingSW) {
    // Prevent duplicate toasts
    if (document.getElementById("sw-update-toast")) return;
    const btn = el("button", { id: "sw-update-btn", "aria-label": "새 버전이 있습니다." }, "업데이트");
    const toast = el("div", { id: "sw-update-toast", role: "alert", "aria-label": "앱 업데이트 알림" },
      el("span", { "aria-hidden": "true" }, "새 버전이 있습니다."),
      btn,
    );
    btn.addEventListener("click", () => {
      waitingSW.postMessage({ type: "SKIP_WAITING" });
      toast.remove();
    });
    document.body.appendChild(toast);
  }

  function trackInstalling(reg) {
    reg.installing.addEventListener("statechange", () => {
      if (reg.waiting) showUpdateToast(reg.waiting);
    });
  }

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((reg) => {
    // A waiting SW already exists (e.g. installed on a previous visit)
    if (reg.waiting) {
      showUpdateToast(reg.waiting);
      return;
    }
    // A new SW is being installed right now
    if (reg.installing) {
      trackInstalling(reg);
      return;
    }
    // Listen for future updates
    reg.addEventListener("updatefound", () => trackInstalling(reg));
  }).catch(() => {});
}
