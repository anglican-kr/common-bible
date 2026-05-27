// @ts-check

// All localStorage-backed load/save helpers. Each save also notifies the
// sync layer (window.syncStoreV2 + window.driveSync) when applicable, so
// settings/bookmarks/reading-position changes propagate to Drive.
//
// Module pattern: ES module + window.appStorage assignment. Phase 2 of the
// app.js modularization (ADR-018). This file is loaded as
// `<script type="module">` (rather than the multi-script `defer` baseline
// used by helpers.js) so its function declarations and `@typedef`s are
// confined to module scope — without this, names like `saveBookmarks` /
// `loadBookmarks` collide with store-v2.js (sync layer) at the TypeScript
// global level. See ADR-018 §"채택 방식 — module-vs-script 예외".

window.appStorage = (() => {
  /** @typedef {import("../types").ReadingPosition} ReadingPosition */
  /** @typedef {import("../types").AudioPosition} AudioPosition */
  /** @typedef {import("../types").SearchHistoryList} SearchHistoryList */
  /** @typedef {import("../types").ColorSchemeId} ColorSchemeId */
  /** @typedef {import("../types").ColorSchemeEntry} ColorSchemeEntry */
  /** @typedef {import("../types").ThemeMode} ThemeMode */
  /** @typedef {import("../types").BookOrderKind} BookOrderKind */
  /** @typedef {import("../types").BookmarkTreeNode} BookmarkTreeNode */
  /** @typedef {import("../types").InstallNudgeState} InstallNudgeState */
  // ── Storage keys (private to this module) ──
  const STORAGE_KEY = "bible-last-read";
  const FONT_SIZE_KEY = "bible-font-size";
  const THEME_KEY = "bible-theme";
  const BOOK_ORDER_KEY = "bible-book-order";
  const COLOR_SCHEME_KEY = "bible-color-scheme";
  const STARTUP_BEHAVIOR_KEY = "bible-startup"; // "resume" | "home"
  const CITE_SHOW_KEY = "bible-cite-show"; // "1"/"0" (saveCiteShow) or "true"/"false" (sync applyToLegacyKeys); default ON when unset
  const AUDIO_SHOW_KEY = "bible-audio-show"; // "1"/"0" or "true"/"false" via sync; default ON when unset
  const AUDIO_POS_KEY = "bible-audio-pos";
  const BOOKMARK_KEY = "bible-bookmarks";
  const INSTALL_NUDGE_KEY = "bible-install-nudge";
  const SEARCH_HISTORY_KEY = "bible-search-history";
  const SEARCH_HISTORY_MAX = 30; // storage cap (LRU)

  // ── UI-shared constants (consumed by settings-ui in Phase 3) ──
  const FONT_SIZES = [16, 18, 20, 22, 24];
  const DEFAULT_FONT_SIZE = 18;
  /** @type {ReadonlyArray<ColorSchemeEntry>} */
  const COLOR_SCHEMES = [
    { id: "navy",       name: "네이비",   swatch: "#1e3a5f", iconBg: "#1a1a2e" },
    { id: "terracotta", name: "버건디",   swatch: "#6b3a2a", iconBg: "#6b3a2a" },
    { id: "green",      name: "초록",     swatch: "#1a6b50", iconBg: "#1a6b50" },
    { id: "purple",     name: "보라",     swatch: "#5a2d82", iconBg: "#5a2d82" },
  ];

  // ── Reading position ──

  /**
   * @param {string} bookId
   * @param {number | "prologue"} chapter
   * @param {number | null} [verse]
   */
  function saveReadingPosition(bookId, chapter, verse = null) {
    try {
      const val = { bookId, chapter, verse };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
      // Local form (verse: number|null) intentionally diverges from the synced
      // LastReadValue (verseSpec?: string). Excess properties on a variable
      // are not checked at the call site, so this is safe.
      window.syncStoreV2?.saveLastRead(/** @type {import("../types").LastReadValue} */ (val));
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  /** @returns {ReadingPosition | null} */
  function loadReadingPosition() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      // Shape relies on saveReadingPosition writers; not validated at runtime.
      return /** @type {ReadingPosition} */ (JSON.parse(raw));
    } catch (_) {
      return null;
    }
  }

  function clearReadingPosition() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
  }

  // ── Audio time ──

  /**
   * @param {string} bookId
   * @param {number} chapter
   * @param {number} time
   */
  function saveAudioTime(bookId, chapter, time) {
    try {
      localStorage.setItem(AUDIO_POS_KEY, JSON.stringify({ bookId, chapter, time }));
    } catch (_) {}
  }

  /**
   * @param {string} bookId
   * @param {number} chapter
   * @returns {number | null}
   */
  function loadAudioTime(bookId, chapter) {
    try {
      const raw = localStorage.getItem(AUDIO_POS_KEY);
      if (!raw) return null;
      /** @type {AudioPosition} */
      const pos = JSON.parse(raw);
      if (pos && pos.bookId === bookId && pos.chapter === chapter && pos.time > 0) return pos.time;
    } catch (_) {}
    return null;
  }

  function clearAudioTime() {
    try { localStorage.removeItem(AUDIO_POS_KEY); } catch (_) {}
  }

  // ── BEGIN SEARCH HISTORY HELPERS ──
  // Local-only (not Drive-synced — see ADR-014). Whitespace-normalized strings,
  // LRU-deduped, capped at SEARCH_HISTORY_MAX. The block between the BEGIN/END
  // markers is sliced into tests/unit/storage.test.js, so changes to the
  // LRU/normalization semantics need a corresponding test update.

  /** @param {unknown} q @returns {string} */
  function normalizeSearchQuery(q) {
    return String(q || "").trim().replace(/\s+/g, " ");
  }

  /** @returns {SearchHistoryList} */
  function loadSearchHistory() {
    try {
      const rawStr = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!rawStr) return [];
      const raw = JSON.parse(rawStr);
      if (!Array.isArray(raw)) return [];
      return raw.filter((s) => typeof s === "string" && s.length > 0).slice(0, SEARCH_HISTORY_MAX);
    } catch (_) {
      return [];
    }
  }

  /** @param {SearchHistoryList} list */
  function saveSearchHistory(list) {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, SEARCH_HISTORY_MAX)));
    } catch (_) {}
  }

  /** @param {string} q @returns {SearchHistoryList} */
  function pushSearchHistory(q) {
    const norm = normalizeSearchQuery(q);
    if (!norm) return loadSearchHistory();
    const list = loadSearchHistory().filter((s) => s !== norm);
    list.unshift(norm);
    const trimmed = list.slice(0, SEARCH_HISTORY_MAX);
    saveSearchHistory(trimmed);
    return trimmed;
  }

  /** @param {string} q @returns {SearchHistoryList} */
  function removeSearchHistory(q) {
    const norm = normalizeSearchQuery(q);
    const list = loadSearchHistory().filter((s) => s !== norm);
    saveSearchHistory(list);
    return list;
  }

  /** @returns {SearchHistoryList} */
  function clearSearchHistory() {
    try { localStorage.removeItem(SEARCH_HISTORY_KEY); } catch (_) {}
    return [];
  }
  // ── END SEARCH HISTORY HELPERS ──

  // ── Startup behavior ──

  /** @returns {string} */
  function loadStartupBehavior() {
    return localStorage.getItem(STARTUP_BEHAVIOR_KEY) || "resume";
  }

  /** @param {string} val */
  function saveStartupBehavior(val) {
    localStorage.setItem(STARTUP_BEHAVIOR_KEY, val);
    window.syncStoreV2?.saveSetting("startupBehavior", val);
    if (window.driveSync) window.driveSync.scheduleUpload();
  }

  // ── Cite/note visibility (ADR-022) ──

  /** @returns {boolean} */
  function loadCiteShow() {
    const v = localStorage.getItem(CITE_SHOW_KEY);
    if (v === null) return true;  // default ON (ADR-022 §6)
    // Accept both this module's "1"/"0" save format and the JSON-serialized
    // "true"/"false" written by sync's applyToLegacyKeys (which always passes
    // non-string values through JSON.stringify). Without this, a cite=true
    // value round-tripped through Drive sync is read back as false on next
    // cold start, causing the setting to appear to reset.
    return v === "1" || v === "true";
  }

  /** @param {boolean} on */
  function saveCiteShow(on) {
    try {
      localStorage.setItem(CITE_SHOW_KEY, on ? "1" : "0");
      window.syncStoreV2?.saveSetting("citeShow", on);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Audio player visibility ──

  /** @returns {boolean} */
  function loadAudioShow() {
    const v = localStorage.getItem(AUDIO_SHOW_KEY);
    if (v === null) return true;  // default ON
    // Mirrors loadCiteShow's tolerance for the JSON-serialized "true"/"false"
    // shape that sync's applyToLegacyKeys writes back.
    return v === "1" || v === "true";
  }

  /** @param {boolean} on */
  function saveAudioShow(on) {
    try {
      localStorage.setItem(AUDIO_SHOW_KEY, on ? "1" : "0");
      window.syncStoreV2?.saveSetting("audioShow", on);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Font size ──

  /** @returns {number} */
  function loadFontSize() {
    try {
      const v = parseInt(localStorage.getItem(FONT_SIZE_KEY) ?? "", 10);
      return FONT_SIZES.includes(v) ? v : DEFAULT_FONT_SIZE;
    } catch (_) {
      return DEFAULT_FONT_SIZE;
    }
  }

  /** @param {number} size */
  function saveFontSize(size) {
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(size));
      window.syncStoreV2?.saveSetting("fontSize", size);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Color scheme ──

  /** @returns {ColorSchemeId} */
  function loadColorScheme() {
    try {
      const v = localStorage.getItem(COLOR_SCHEME_KEY);
      const found = COLOR_SCHEMES.find((s) => s.id === v);
      if (found) return found.id;
    } catch (_) {}
    return "navy";
  }

  /** @param {ColorSchemeId} scheme */
  function saveColorScheme(scheme) {
    try {
      localStorage.setItem(COLOR_SCHEME_KEY, scheme);
      window.syncStoreV2?.saveSetting("colorScheme", scheme);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Theme ──

  /** @returns {ThemeMode} */
  function loadTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "dark" || saved === "light" || saved === "system") return saved;
    } catch (_) {}
    return "system";
  }

  /** @param {string} theme */
  function saveTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
      window.syncStoreV2?.saveSetting("theme", theme);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Book order ──

  /** @returns {BookOrderKind} */
  function loadBookOrder() {
    try {
      const v = localStorage.getItem(BOOK_ORDER_KEY);
      if (v === "canonical" || v === "vulgate") return v;
    } catch (_) {}
    return "canonical";
  }

  /** @param {string} order */
  function saveBookOrder(order) {
    try {
      localStorage.setItem(BOOK_ORDER_KEY, order);
      window.syncStoreV2?.saveSetting("bookOrder", order);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  // ── Bookmarks ──

  /** @returns {string} */
  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /** @returns {BookmarkTreeNode[]} */
  function loadBookmarks() {
    if (window.syncStoreV2) return window.syncStoreV2.loadBookmarks();
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  /** @param {BookmarkTreeNode[]} store */
  function saveBookmarks(store) {
    try {
      localStorage.setItem(BOOKMARK_KEY, JSON.stringify(store));
      window.syncStoreV2?.saveBookmarks(store);
      if (window.driveSync) window.driveSync.scheduleUpload();
      _maybeRequestPersist();
    } catch (_) {}
  }

  // ── Install nudge state ──

  /** @returns {InstallNudgeState} */
  function _loadNudgeState() {
    try {
      const raw = localStorage.getItem(INSTALL_NUDGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return { visits: 0, nextShow: 1, neverShow: false };
  }

  /** @param {InstallNudgeState} state */
  function _saveNudgeState(state) {
    try { localStorage.setItem(INSTALL_NUDGE_KEY, JSON.stringify(state)); } catch (_) {}
  }

  // ── Persisted-storage one-shot request ──
  // Called on the first value moment (audio play, bookmark save). Result is
  // best-effort: navigator.storage.persist() may show a browser prompt on
  // Safari/Firefox; on Chrome it grants silently when the site has high
  // engagement. Even if denied, the LRU loop in audio-cache.js still
  // functions, just without iOS 7-day evict immunity.
  let _persistAttempted = false;
  function _maybeRequestPersist() {
    if (_persistAttempted) return;
    _persistAttempted = true;
    if (!navigator.storage?.persist) return;
    navigator.storage.persist()
      .then((granted) => {
        window.syncDebugLog?.log({ kind: "ACTION", event: "storage-persist", granted });
      })
      .catch(() => {});
  }

  return {
    FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES, SEARCH_HISTORY_MAX,
    saveReadingPosition, loadReadingPosition, clearReadingPosition,
    saveAudioTime, loadAudioTime, clearAudioTime,
    normalizeSearchQuery, loadSearchHistory, saveSearchHistory,
    pushSearchHistory, removeSearchHistory, clearSearchHistory,
    loadStartupBehavior, saveStartupBehavior,
    loadCiteShow, saveCiteShow,
    loadAudioShow, saveAudioShow,
    loadFontSize, saveFontSize,
    loadColorScheme, saveColorScheme,
    loadTheme, saveTheme,
    loadBookOrder, saveBookOrder,
    generateId, loadBookmarks, saveBookmarks,
    _loadNudgeState, _saveNudgeState,
    _maybeRequestPersist,
  };
})();

// Marker so TypeScript treats this file as an ES module (function/typedef
// scope = module scope). No actual exports needed — `window.appStorage` is
// the runtime contract.
export {};
