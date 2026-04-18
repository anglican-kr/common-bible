"use strict";

const DATA_DIR = "data";
// Psalms use "편" instead of "장" as the chapter unit
function chUnit(bookId) { return bookId === "ps" ? "편" : "장"; }
const $app = document.getElementById("app");
const $title = document.getElementById("page-title");
const $breadcrumb = document.getElementById("breadcrumb");
const $announce = document.getElementById("a11y-announce");
const $audioBar = document.getElementById("audio-bar");
const $searchInput = document.getElementById("search-input");
const $searchClear = document.getElementById("search-clear");
const $searchFab = document.getElementById("search-fab");
const $searchScrim = document.getElementById("search-scrim");
const $searchSheet = document.getElementById("search-sheet");
const $searchSheetInput = document.getElementById("search-sheet-input");
const $searchSheetClear = document.getElementById("search-sheet-clear");
const $searchSheetResults = document.getElementById("search-sheet-results");

let booksCache = null;
let appVersion = null;
let currentAudio = null;

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
const FONT_SIZES = [16, 18, 20, 22, 24];

const COLOR_SCHEMES = [
  { id: "navy",       name: "네이비",   swatch: "#1e3a5f", iconBg: "#1a1a2e" },
  { id: "terracotta", name: "버건디",   swatch: "#6b3a2a", iconBg: "#6b3a2a" },
  { id: "green",      name: "초록",     swatch: "#1a6b50", iconBg: "#1a6b50" },
  { id: "purple",     name: "보라",     swatch: "#5a2d82", iconBg: "#5a2d82" },
];
const DEFAULT_FONT_SIZE = 18;

function saveReadingPosition(bookId, chapter) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ bookId, chapter }));
  } catch (_) {}
}

function loadReadingPosition() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return null;
  }
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
    alert("오프라인 상태에서는 캐시를 초기화할 수 없습니다.\n인터넷에 연결된 후 다시 시도해 주세요.");
    return;
  }
  if (!confirm("캐시를 초기화하면 오프라인 데이터가 삭제됩니다.\n계속하시겠습니까?")) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.unregister();
    window.location.reload();
  } catch (err) {
    console.error("Cache clear failed:", err);
    alert("캐시 초기화에 실패했습니다. 다시 시도해 주세요.");
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

  function rebuild() {
    clearNode(popover);

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
    popover.appendChild(sizeRow);

    // Theme
    const themeRow = el("div", { className: "settings-row" });
    themeRow.appendChild(el("span", { className: "settings-label" }, "테마"));
    const current = loadTheme();
    const themeGroup = el("div", { className: "btn-group" });
    for (const [value, label] of [["light", "라이트"], ["system", "시스템"], ["dark", "다크"]]) {
      const btn = el("button", { className: "toolbar-btn", "aria-pressed": String(current === value) }, label);
      btn.addEventListener("click", () => {
        saveTheme(value);
        applyTheme(value);
        rebuild();
        announce(label + " 테마");
      });
      themeGroup.appendChild(btn);
    }
    themeRow.appendChild(themeGroup);
    popover.appendChild(themeRow);

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
    popover.appendChild(colorRow);

    // Book order
    const orderRow = el("div", { className: "settings-row" });
    orderRow.appendChild(el("span", { className: "settings-label" }, "책 배열"));
    const currentOrder = loadBookOrder();
    const orderGroup = el("div", { className: "btn-group", role: "group", "aria-label": "책 배열 선택" });
    for (const [value, label] of [["canonical", "외경 분리"], ["vulgate", "구약에 외경 포함"]]) {
      const orderBtn = el("button", { className: "toolbar-btn", "aria-pressed": String(currentOrder === value) }, label);
      orderBtn.addEventListener("click", () => {
        saveBookOrder(value);
        route();
        rebuild();
        announce(label + " 배열");
      });
      orderGroup.appendChild(orderBtn);
    }
    orderRow.appendChild(orderGroup);
    popover.appendChild(orderRow);

    // Cache clear
    if ("caches" in window) {
      const cacheRow = el("div", { className: "settings-row" });
      cacheRow.appendChild(el("span", { className: "settings-label" }, "캐시"));
      const clearBtn = el("button", { className: "cache-clear-btn", "aria-label": "캐시 초기화" }, "초기화");
      clearBtn.addEventListener("click", () => clearAllCaches());
      cacheRow.appendChild(clearBtn);
      popover.appendChild(cacheRow);
    }

    // About
    const aboutRow = el("div", { className: "settings-about" });
    aboutRow.appendChild(document.createTextNode("대한성서공회 허락 하에 대한성공회 사용"));
    aboutRow.appendChild(el("br"));
    const versionLabel = appVersion ? `공동번역성서 ${appVersion}` : "공동번역성서";
    aboutRow.appendChild(el("a", { href: "https://github.com/anglican-kr/common-bible", target: "_blank", rel: "noopener noreferrer" }, versionLabel));
    popover.appendChild(aboutRow);
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

let _origIconData = null;

function loadOrigIcon() {
  if (_origIconData) return Promise.resolve(_origIconData);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      _origIconData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve(_origIconData);
    };
    img.onerror = reject;
    img.src = "/assets/icons/icon-512-maskable.png";
  });
}

function updateAppIcons(scheme) {
  loadOrigIcon().then((origData) => {
    const [nr, ng, nb] = hexToRgb(scheme.iconBg);
    const canvas = document.createElement("canvas");
    canvas.width = origData.width;
    canvas.height = origData.height;
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(new Uint8ClampedArray(origData.data), origData.width, origData.height);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      // Normalize luminance: 0 = original bg, 1 = white cross
      const lum = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const t = Math.max(0, Math.min(1, (lum - ICON_BG_LUM) / (1 - ICON_BG_LUM)));
      d[i]     = Math.round(nr + (255 - nr) * t);
      d[i + 1] = Math.round(ng + (255 - ng) * t);
      d[i + 2] = Math.round(nb + (255 - nb) * t);
    }
    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL("image/png");
    const faviconLink = document.querySelector("link[rel='icon']");
    if (faviconLink) faviconLink.href = dataUrl;
    const appleLink = document.querySelector("link[rel='apple-touch-icon']");
    if (appleLink) appleLink.href = dataUrl;
  }).catch(() => { /* non-critical */ });
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

function applyColorScheme(schemeName) {
  const scheme = COLOR_SCHEMES.find(s => s.id === schemeName) || COLOR_SCHEMES[0];
  if (schemeName === "navy") {
    document.documentElement.removeAttribute("data-color-scheme");
  } else {
    document.documentElement.setAttribute("data-color-scheme", schemeName);
  }
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

let _launchScreenDismissed = false;

function dismissLaunchScreen() {
  if (_launchScreenDismissed) return;
  _launchScreenDismissed = true;
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
    const res = await fetch("version.json");
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
    popover.appendChild(el("li", null, el("a", { className: cls, href: `#/${div}` }, labels[div])));
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
      el("a", { className: "popover-item popover-prologue", href: `#/${book.id}/prologue` }, "머리말")
    );
  }
  for (let i = 1; i <= book.chapter_count; i++) {
    const cls = i === currentCh ? "popover-item current" : "popover-item";
    grid.appendChild(el("a", { className: cls, href: `#/${book.id}/${i}` }, String(i)));
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

  $title.appendChild(btn);
  $title.appendChild(popover);
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
  return el("a", { href: `#/${activeDivision}` }, label);
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
          ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
        }
        section.appendChild(ul);
        details.appendChild(section);
      }
    } else {
      const ul = el("ul", { className: "book-list", role: "list" });
      for (const b of list) {
        ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
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
  const href = `#/${pos.bookId}/${pos.chapter}`;
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

  $app.appendChild(wrapper);
}

function renderDivisionList(books, division) {
  setTitleWithDivisionPicker(division);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
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
        ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
      }
      section.appendChild(ul);
      details.appendChild(section);
    }
  } else {
    const ul = el("ul", { className: "book-list", role: "list" });
    for (const b of list) {
      ul.appendChild(el("li", null, el("a", { href: `#/${b.id}` }, b.name_ko)));
    }
    details.appendChild(ul);
  }
  $app.appendChild(details);
}

function renderChapterList(book, books) {
  setTitle(book.name_ko);
  hideAudioBar();
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "#/" },
    { divisionPicker: true, label: divisionLabels()[effDiv], activeDivision: effDiv },
  ]);
  clearNode($app);

  renderResumeBanner(books);

  const grid = el("div", { className: "chapter-grid" });

  if (book.has_prologue) {
    grid.appendChild(
      el("a", { className: "prologue-link", href: `#/${book.id}/prologue` }, "머리말")
    );
  }

  for (let i = 1; i <= book.chapter_count; i++) {
    grid.appendChild(
      el("a", { href: `#/${book.id}/${i}`, "aria-label": `${book.name_ko} ${i}${chUnit(book.id)}` }, String(i))
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

  // Clip verseEnd to the chapter's actual max verse so "창세 3:1-100"
  // behaves as "창세 3:1-24" when the chapter only has 24 verses.
  if (hlVerseEnd) {
    let maxVerse = 0;
    for (const v of data.verses) {
      const vn = v.range_end != null ? v.range_end : v.number;
      if (vn > maxVerse) maxVerse = vn;
    }
    if (hlVerseEnd > maxVerse) {
      hlVerseEnd = maxVerse;
      const [base, qs] = location.hash.split("?");
      const pathMatch = base.match(/^(#\/[^/]+\/\d+\/\d+)-\d+$/);
      if (pathMatch) {
        const suffix = qs ? `?${qs}` : "";
        history.replaceState(null, "", `${pathMatch[1]}-${maxVerse}${suffix}`);
      }
    }
  }

  setTitleWithChapterPicker(book, ch);
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "#/" },
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
      } else if (startsWithPoetry || v.has_paragraph) {
        article.appendChild(el("span", { className: "paragraph-break", role: "presentation" }));
      }
    }

    const verseLabel = formatVerseLabel(v);
    let verseId = `v${v.number}`;
    if (v.part) verseId += v.part;
    if (v.alt_ref != null) verseId += `_${v.alt_ref}`;
    const baseClasses = v.chapter_ref ? "verse verse-cross-ref" : "verse";

    // Verse highlight (from verse reference navigation)
    const vn = v.number;
    const isHighlightedVerse = hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse);

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
          const breakClass = (isSegChange && li === 0) ? "paragraph-break"
            : isPoetry ? "hemistich-break" : "paragraph-break";
          article.appendChild(el("span", {
            className: breakClass,
            role: "presentation"
          }));
        }

        let classes = baseClasses;
        if (isPoetry) classes += " verse-poetry";
        if (isHighlightedVerse) classes += " verse-highlight";

        const span = el("span", { className: classes });
        if (isFirstLine) {
          span.id = verseId;
          const sup = el("sup", { className: "verse-num", "aria-hidden": "true", "data-v": dataV });
          span.appendChild(sup);
          span.appendChild(document.createTextNode("\u2060"));
        }

        const vref = isFirstLine && !isMultiPart
          ? verseLabel
          : isFirstLine
            ? `${verseLabel}a`
            : `${verseLabel}${partLetters[partIdx++]}`;
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

  // Announce verse number on click/tap for screen reader users
  article.addEventListener("click", (e) => {
    const vs = e.target.closest(".verse[data-vref]");
    if (vs) announce(`${vs.getAttribute("data-vref")}절`);
  });

  // Copy handler: serialize the selection ourselves so that stanza breaks
  // become blank lines and the appended reference uses plain verse numbers
  // (no line-part letters like "1a").
  article.addEventListener("copy", (e) => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const work = document.createElement("div");
    work.appendChild(sel.getRangeAt(0).cloneContents());

    // Drop the aria-hidden verse-number glyph; it is rendered via ::before.
    work.querySelectorAll(".verse-num").forEach((n) => n.remove());
    // Stanza breaks become blank lines; inline line breaks become newlines.
    work.querySelectorAll(".stanza-break").forEach((n) => { n.textContent = "\n\n"; });
    work.querySelectorAll(".paragraph-break, .hemistich-break").forEach((n) => { n.textContent = "\n"; });

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

  // Scroll to highlighted verse or top
  if (hlVerse) {
    const target = document.getElementById(`v${hlVerse}`);
    if (target) {
      requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  } else {
    window.scrollTo(0, 0);
  }
}

function renderPrologue(data, book) {
  setTitle(`${book.name_ko} 머리말`);
  const effDiv = effectiveDivision(book);
  setBreadcrumb([
    { label: "목록", href: "#/" },
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
  nav.appendChild(el("a", { href: `#/${book.id}/1` }, `1${chUnit(book.id)} →`));
  $app.appendChild(nav);
  showAudioPlayer(book.id, 0);
  observeFabLift();
  window.scrollTo(0, 0);
}

function buildChapterNav(book, currentCh) {
  const unit = chUnit(book.id);
  const nav = el("nav", { className: "chapter-nav", "aria-label": `${unit} 이동` });

  if (currentCh > 1) {
    nav.appendChild(el("a", { href: `#/${book.id}/${currentCh - 1}` }, `← ${currentCh - 1}${unit}`));
  } else if (book.has_prologue) {
    nav.appendChild(el("a", { href: `#/${book.id}/prologue` }, "← 머리말"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  if (currentCh < book.chapter_count) {
    nav.appendChild(el("a", { href: `#/${book.id}/${currentCh + 1}` }, `${currentCh + 1}${unit} →`));
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

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (!hash) return { view: "books" };

  const [pathStr, queryStr] = hash.split("?");
  const query = new URLSearchParams(queryStr || "");

  // Search route: #/search?q=...&page=...
  if (pathStr === "search") {
    return {
      view: "search",
      query: query.get("q") || "",
      page: parseInt(query.get("page"), 10) || 1,
    };
  }

  const parts = pathStr.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };

  // Chapter view with optional verse deep-link: #/john/3/16 or #/john/3/16-20.
  // ?hl=... carries the search-term highlight as a separate concern.
  const highlightQuery = query.get("hl") || null;
  let highlightVerse = null;
  let highlightVerseEnd = null;

  if (parts[2]) {
    const m = parts[2].match(/^(\d+)(?:-(\d+))?$/);
    if (m) {
      const v1 = parseInt(m[1], 10);
      const v2 = m[2] ? parseInt(m[2], 10) : null;
      if (v1 > 0) {
        if (v2 && v2 > 0 && v2 !== v1) {
          highlightVerse = Math.min(v1, v2);
          highlightVerseEnd = Math.max(v1, v2);
        } else {
          highlightVerse = v1;
        }
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
  };
}

function trackPageView() {
  if (typeof gtag !== "function") return;
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  idle(() => {
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: location.href,
      page_path: location.hash || "/",
    });
  });
}

async function route() {
  const parsed = parseHash();
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
      } else {
        const books = await loadBooks();
        renderBookList(books);
      }
      trackPageView();
      return;
    }

    const books = await loadBooks();

    if (view === "books") {
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books);
      trackPageView();
      return;
    }

    if (view === "division") {
      // In vulgate mode, deuterocanon has no separate page — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        location.hash = "#/old_testament";
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderDivisionList(books, division);
      trackPageView();
      return;
    }

    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성경을 찾을 수 없습니다.");
      dismissLaunchScreen();
      return;
    }

    if (view === "chapters") {
      dismissLaunchScreen(); // Start fade-out immediately
      renderChapterList(book, books);
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
      trackPageView();
      return;
    }

    if (view === "chapter") {
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      renderChapter(data, book, {
        highlightQuery: parsed.highlightQuery,
        highlightVerse: parsed.highlightVerse,
        highlightVerseEnd: parsed.highlightVerseEnd,
      });
      saveReadingPosition(bookId, chapter);
      trackPageView();
    }
  } catch (err) {
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  } finally {
    dismissLaunchScreen(); // safety fallback (already a no-op if called above)
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", () => {
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  
  // 1. Prioritize UI rendering
  route().finally(() => {
    // 2. Load non-critical data after first paint
    idle(() => {
      loadVersion();
      initCompactHeader();
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

function hideAudioBar() {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  $audioBar.hidden = true;
  clearNode($audioBar);
}

function showAudioPlayer(bookId, chapter) {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  const src = `${DATA_DIR}/audio/${bookId}-${chapter}.mp3`;
  clearNode($audioBar);

  const audio = new Audio();
  audio.preload = "metadata";
  currentAudio = audio;

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

  container.appendChild(playBtn);
  container.appendChild(progressWrap);

  // Play/pause toggle
  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", () => {
    playIcon.className = "audio-icon-pause";
    playBtn.setAttribute("aria-label", "일시정지");
    announce("재생");
  });

  audio.addEventListener("pause", () => {
    playIcon.className = "audio-icon-play";
    playBtn.setAttribute("aria-label", "재생");
    announce("일시정지");
  });

  // Progress updates
  audio.addEventListener("loadedmetadata", () => {
    progress.max = String(Math.floor(audio.duration));
    timeDisplay.textContent = formatTime(audio.duration);
  });

  audio.addEventListener("timeupdate", () => {
    if (!seekingByUser) {
      progress.value = String(Math.floor(audio.currentTime));
    }
    updateProgressFill();
    timeDisplay.textContent = `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`;
  });

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
    currentAudio = null;
    showAudioUnavailable();
  });

  $audioBar.appendChild(container);
  $audioBar.hidden = false;
  $audioBar.style.position = "sticky";
  audio.src = src;
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
      if (pendingSearchCb && msg.searchId === activeSearchId) {
        const cb = pendingSearchCb;
        pendingSearchCb = null;
        cb(msg.type === "error" ? null : msg);
      }
    }
  });
  searchWorker.postMessage({
    type: "init",
    metaUrl: `/${DATA_DIR}/search-meta.json`,
    chunks: [
      { name: "nt", url: `/${DATA_DIR}/search-nt.json` },
      { name: "dc", url: `/${DATA_DIR}/search-dc.json` },
      { name: "ot", url: `/${DATA_DIR}/search-ot.json` },
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
    nav.appendChild(el("a", { href: `#/search?q=${encoded}&page=${currentPage - 1}` }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", { href: `#/search?q=${encoded}&page=${currentPage + 1}` }, "다음 →"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

// Render search result list into a container node (used by both page and sheet views)
function renderSearchResultList(container, result, query, page, pageSize, paginationBuilder) {
  clearNode(container);
  if (result.total === 0) {
    container.appendChild(el("p", { className: "search-empty" }, `"${query}"에 대한 검색 결과가 없습니다.`));
    return;
  }
  const totalPages = Math.ceil(result.total / pageSize);
  const isPending = result.pendingChunks && result.pendingChunks.length > 0;
  const countLabel = isPending
    ? `"${query}" 검색 중… (현재 ${result.total}건)`
    : `총 ${result.total}건 (${page}/${totalPages}쪽)`;
  container.appendChild(el("p", { className: "search-count" }, countLabel));

  const list = el("ul", { className: "search-results", role: "list" });
  for (const r of result.results) {
    const li = el("li", { className: "search-result-item" });
    const link = el("a", { href: `#/${r.b}/${r.c}/${r.v}?hl=${encodeURIComponent(query)}` });
    link.appendChild(el("span", { className: "search-result-ref" }, `${r.bookNameKo} ${r.c}:${r.v}`));
    link.appendChild(buildSnippet(r.t, query));
    li.appendChild(link);
    list.appendChild(li);
  }
  container.appendChild(list);

  if (!isPending && totalPages > 1 && paginationBuilder) {
    container.appendChild(paginationBuilder(query, page, totalPages));
  }
}

async function renderSearchResults(query, page, autoNavigate = false) {
  setTitle(`"${query}" 검색`);
  setBreadcrumb([{ label: "목록", href: "#/" }]);
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
    let hash = `#/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      hash += `/${ref.verse}`;
      if (ref.verseEnd) hash += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      location.replace(hash);
    }
    return;
  }

  renderSearchResultList($app, result, query, page, pageSize, buildSearchPagination);

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
    const newHash = `#/search?q=${encodeURIComponent(q)}`;
    // If hash is unchanged, hashchange won't fire — call route() directly.
    if (location.hash === newHash) {
      route();
    } else {
      location.hash = newHash;
    }
  }
});

let searchAutoNavTimer = null;

$searchInput.addEventListener("input", () => {
  const q = $searchInput.value.trim();
  $searchClear.hidden = !q;
  clearTimeout(searchDebounceTimer);
  clearTimeout(searchAutoNavTimer);
  if (!q) return;
  searchDebounceTimer = setTimeout(() => {
    searchAutoNavigate = false;
    location.hash = `#/search?q=${encodeURIComponent(q)}`;
  }, 400);
  // After 3s of no input, treat as Enter (auto-navigate on verse ref match)
  searchAutoNavTimer = setTimeout(() => {
    searchAutoNavigate = true;
    const newHash = `#/search?q=${encodeURIComponent(q)}`;
    if (location.hash === newHash) { route(); } else { location.hash = newHash; }
  }, 3000);
});

$searchClear.addEventListener("click", () => {
  $searchInput.value = "";
  $searchClear.hidden = true;
  clearTimeout(searchDebounceTimer);
  clearTimeout(searchAutoNavTimer);
  $searchInput.focus();
  if (parseHash().view === "search") location.hash = "#/";
});

// ── Search bottom sheet (Mobile FAB) ──

function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function openSearchSheet(query) {
  $searchScrim.hidden = false;
  $searchSheet.hidden = false;
  $searchSheetInput.value = query || "";
  $searchSheetClear.hidden = !query;
  $searchFab.hidden = true;
  requestAnimationFrame(() => $searchSheetInput.focus());
  if (query) runSheetSearch(query, 1);
}

function closeSearchSheet() {
  $searchScrim.hidden = true;
  $searchSheet.hidden = true;
  $searchSheet.style.height = "";
  $searchFab.hidden = false;
  clearNode($searchSheetResults);
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
    let hash = `#/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      hash += `/${ref.verse}`;
      if (ref.verseEnd) hash += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      closeSearchSheet();
      location.hash = hash;
    }
    return;
  }

  renderSearchResultList($searchSheetResults, result, query, page, pageSize, buildSheetPagination);
  // Attach closeSearchSheet to all result links
  $searchSheetResults.querySelectorAll("a[href^='#/']").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));

  announce(`"${query}" 검색 결과 ${result.total}건`);
}

$searchFab.addEventListener("click", () => openSearchSheet(""));

$searchScrim.addEventListener("click", closeSearchSheet);

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
  clearTimeout(sheetAutoNavTimer);
  if (!q) { clearNode($searchSheetResults); return; }
  sheetDebounceTimer = setTimeout(() => runSheetSearch(q, 1, false), 400);
  sheetAutoNavTimer = setTimeout(() => runSheetSearch(q, 1, true), 3000);
});

$searchSheetClear.addEventListener("click", () => {
  $searchSheetInput.value = "";
  $searchSheetClear.hidden = true;
  clearTimeout(sheetDebounceTimer);
  clearTimeout(sheetAutoNavTimer);
  clearNode($searchSheetResults);
  $searchSheetInput.focus();
});

// Drag handle to resize sheet
(function initSheetDrag() {
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
})();

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

// ── Service Worker Registration & Update ──

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function showUpdateToast(waitingSW) {
    // Prevent duplicate toasts
    if (document.getElementById("sw-update-toast")) return;
    const btn = el("button", { id: "sw-update-btn", "aria-label": "새 버전으로 업데이트" }, "업데이트");
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

  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
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
