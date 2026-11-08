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

/** @typedef {import("../types.js").AppStorage} AppStorage */

// The return type is declared so a helper missing from `AppStorage` (types.d.ts) fails typecheck here, not
// later in whichever module destructures it (helpers.js does the same for `AppHelpers`).
window.appStorage = (/** @returns {AppStorage} */ () => {
  /** @typedef {import("../types.js").ReadingPosition} ReadingPosition */
  /** @typedef {import("../types.js").AudioPosition} AudioPosition */
  /** @typedef {import("../types.js").SearchHistoryList} SearchHistoryList */
  /** @typedef {import("../types.js").SearchHistoryEntry} SearchHistoryEntry */
  /** @typedef {import("../types.js").ColorSchemeId} ColorSchemeId */
  /** @typedef {import("../types.js").ColorSchemeEntry} ColorSchemeEntry */
  /** @typedef {import("../types.js").ThemeMode} ThemeMode */
  /** @typedef {import("../types.js").BookOrderKind} BookOrderKind */
  /** @typedef {import("../types.js").BookmarkTreeNode} BookmarkTreeNode */
  /** @typedef {import("../types.js").BookmarkTreeBookmark} BookmarkTreeBookmark */
  /** @typedef {import("../types.js").SyncFlatItem} SyncFlatItem */
  /** @typedef {import("../types.js").SaveOutcome} SaveOutcome */
  /** @typedef {import("../types.js").InstallNudgeState} InstallNudgeState */
  /** @typedef {import("../types.js").StartPage} StartPage */
  // ── Storage keys (private to this module) ──
  const STORAGE_KEY = "bible-last-read";
  const FONT_SIZE_KEY = "bible-font-size";
  const THEME_KEY = "bible-theme";
  const BOOK_ORDER_KEY = "bible-book-order";
  const COLOR_SCHEME_KEY = "bible-color-scheme";
  const STARTUP_BEHAVIOR_KEY = "bible-startup"; // "resume" | "home"
  const START_PAGE_KEY = "bible-start-page"; // "bible" | "lectionary"; unset = "bible"
  const CITE_SHOW_KEY = "bible-cite-show"; // "1"/"0" (saveCiteShow) or "true"/"false" (sync applyToLegacyKeys); default ON when unset
  const AUDIO_SHOW_KEY = "bible-audio-show"; // "1"/"0" or "true"/"false" via sync; default ON when unset
  const AUDIO_POS_KEY = "bible-audio-pos";
  const BOOKMARK_KEY = "bible-bookmarks";
  const INSTALL_NUDGE_KEY = "bible-install-nudge";
  const SEARCH_HISTORY_KEY = "bible-search-history";
  // ADR-038 §3 — 전례독서 뷰의 연중 주일 트랙 선택(카드 「연속 독서」, 「복음 주제」). 값 하나 "1" | "2" — 마지막으로 고른 트랙이 날짜 · 해와
  // 무관하게 기본값이다(사용자 결정 2026-10-13 · ADR-036 §2 독서 연속성). 로컬 전용.
  const LECTIONARY_TRACK_KEY = "bible-lectionary-track";
  // ADR-038 §3 — 전례독서의 독서 카드를 접어 두었는가. 값 "1"이면 접음이고, 없으면 펼침이다. 한 번 접으면 모든 날에 접힌
  // 채로 보인다(사용자 결정 2026-11-05). 로컬 전용.
  const LECTIONARY_CARDS_FOLDED_KEY = "bible-lectionary-cards-folded";
  const LECTIONARY_ALT_SHOW_KEY = "bible-lectionary-alt-show"; // "1"/"0" or "true"/"false" via sync; default OFF when unset
  // ADR-038 §1 — 캘린더 탭이 돌아갈 마지막 캘린더 보기의 주소. 앱을 다시 열어도 이어진다(사용자 결정 2026-11-07). 로컬 전용.
  const CALENDAR_LAST_VIEW_KEY = "bible-calendar-last-view";
  const SEARCH_HISTORY_MAX = 30; // storage cap (LRU)

  // ── UI-shared constants (consumed by settings-ui in Phase 3) ──
  const FONT_SIZES = [16, 18, 20, 22, 24];
  const DEFAULT_FONT_SIZE = 18;
  /** @type {ReadonlyArray<ColorSchemeEntry>} */
  const COLOR_SCHEMES = [
    { id: "navy",   name: "네이비", swatch: "#22244a", iconBg: "#1a1a2e" },
    { id: "red",    name: "빨강",   swatch: "#a01828", iconBg: "#a01828" },
    { id: "green",  name: "초록",   swatch: "#1a6b50", iconBg: "#1a6b50" },
    { id: "purple", name: "보라",   swatch: "#5a2d82", iconBg: "#5a2d82" },
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
      window.syncStoreV2?.saveLastRead(/** @type {import("../types.js").LastReadValue} */ (val));
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
  // Local-only (not Drive-synced — see ADR-014). Whitespace-normalized queries,
  // LRU-deduped, capped at SEARCH_HISTORY_MAX. Each entry now carries a `ts`
  // (search time) so the /search recents list can show an absolute date
  // (ADR-014 개정 2026-06-07). Stored shape is `[{ q, ts }]`; legacy `string[]`
  // is migrated on read (ts → null). loadSearchHistory() keeps returning
  // `string[]` (queries) for the header dropdown + existing callers; the dated
  // view uses loadSearchHistoryEntries().

  /** @param {unknown} q @returns {string} */
  function normalizeSearchQuery(q) {
    return String(q || "").trim().replace(/\s+/g, " ");
  }

  /** @returns {SearchHistoryEntry[]} */
  function loadSearchHistoryEntries() {
    try {
      const rawStr = localStorage.getItem(SEARCH_HISTORY_KEY);
      if (!rawStr) return [];
      const raw = JSON.parse(rawStr);
      if (!Array.isArray(raw)) return [];
      /** @type {SearchHistoryEntry[]} */
      const entries = [];
      for (const item of raw) {
        // Legacy format: bare query string (no timestamp).
        if (typeof item === "string") {
          if (item.length > 0) entries.push({ q: item, ts: null });
        } else if (item && typeof item.q === "string" && item.q.length > 0) {
          entries.push({ q: item.q, ts: typeof item.ts === "number" ? item.ts : null });
        }
      }
      return entries.slice(0, SEARCH_HISTORY_MAX);
    } catch (_) {
      return [];
    }
  }

  /** @returns {SearchHistoryList} */
  function loadSearchHistory() {
    return loadSearchHistoryEntries().map((e) => e.q);
  }

  /** @param {SearchHistoryEntry[]} entries */
  function saveSearchHistoryEntries(entries) {
    try {
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(entries.slice(0, SEARCH_HISTORY_MAX)));
    } catch (_) {}
  }

  /**
   * Legacy API: accepts a `string[]` (or entry array) and persists it. Strings
   * are stored with `ts: null`. Kept for API/back-compat; the timestamped path
   * is pushSearchHistory.
   * @param {SearchHistoryList | SearchHistoryEntry[]} list
   */
  function saveSearchHistory(list) {
    const entries = list.map((item) =>
      typeof item === "string" ? { q: item, ts: null } : { q: item.q, ts: item.ts ?? null });
    saveSearchHistoryEntries(entries);
  }

  /** @param {string} q @returns {SearchHistoryList} */
  function pushSearchHistory(q) {
    const norm = normalizeSearchQuery(q);
    if (!norm) return loadSearchHistory();
    const entries = loadSearchHistoryEntries().filter((e) => e.q !== norm);
    entries.unshift({ q: norm, ts: Date.now() });
    const trimmed = entries.slice(0, SEARCH_HISTORY_MAX);
    saveSearchHistoryEntries(trimmed);
    return trimmed.map((e) => e.q);
  }

  /** @param {string} q @returns {SearchHistoryList} */
  function removeSearchHistory(q) {
    const norm = normalizeSearchQuery(q);
    const entries = loadSearchHistoryEntries().filter((e) => e.q !== norm);
    saveSearchHistoryEntries(entries);
    return entries.map((e) => e.q);
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

  // ── Start page ──

  /**
   * 시작 화면의 값마다 단추에 보일 이름과 앱을 「/」로 새로 열 때 갈 주소(ADR-041 §2). 값이 늘면 여기에 한 줄을 더한다.
   * 「/」는 옮기지 않고 성서 목록에 머무는 값이고, 「읽던 페이지에서 시작」은 이 값에서만 쓰인다(§3).
   * @type {Record<StartPage, { label: string, path: string }>}
   */
  const START_PAGES = {
    bible: { label: "성서", path: "/" },
    lectionary: { label: "전례독서", path: "/lectionary" },
  };

  /**
   * 앱을 「/」로 열 때 처음 보일 화면(사용자 결정 2026-11-05). 모르는 값은 성서다 — 기도서처럼 값이 늘어난 판이 동기화로 보낸 값을
   * 옛 판이 받아도 앱이 열린다.
   * @returns {StartPage}
   */
  function loadStartPage() {
    try {
      const page = localStorage.getItem(START_PAGE_KEY);
      return page !== null && Object.hasOwn(START_PAGES, page) ? /** @type {StartPage} */ (page) : "bible";
    } catch {
      return "bible";
    }
  }

  /** @param {StartPage} page */
  function saveStartPage(page) {
    try {
      localStorage.setItem(START_PAGE_KEY, page);
      window.syncStoreV2?.saveSetting("startPage", page);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
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
      let v = localStorage.getItem(COLOR_SCHEME_KEY);
      // Renamed/replaced 2026-05-29: burgundy scheme was retired in favour of
      // a true liturgical red. Pre-migration users (localStorage or Drive
      // restore) read as red so their warm-dark preference isn't reset to navy.
      if (v === "terracotta") v = "red";
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

  // The sync store goes first: it is the copy loadBookmarks reads, so when it refuses the list, the legacy key is left
  // as it was and the two copies still agree. The legacy key refusing alone does not fail the save — the next save or
  // the sync's merge result (applyToLegacyKeys) writes it again. The bookmark screens tell the user of a refused save
  // (bookmark-core.js commitBookmarks, ADR-015 D7, known-issues §15.4). A full storage gives up the base list for the
  // legacy key too, as it does for the sync store (store-v2.js saveLocal), so both copies hold the list whenever giving
  // the base list up makes room.
  /** @param {BookmarkTreeNode[]} store @returns {SaveOutcome} */
  function saveBookmarks(store) {
    const V2 = window.syncStoreV2;
    /** @type {SaveOutcome} */
    let outcome;
    try {
      if (V2) outcome = V2.saveBookmarks(store);
      else { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(store)); outcome = "saved"; }
    } catch (err) {
      // Same reading as store-v2.js saveLocal; a sync store that throws while flattening the tree is "failed".
      outcome = !V2 && /** @type {{ name?: unknown } | null} */ (err)?.name === "QuotaExceededError" ? "full" : "failed";
    }
    if (outcome !== "saved") return outcome;
    if (V2) {
      try {
        const text = JSON.stringify(store);
        try { localStorage.setItem(BOOKMARK_KEY, text); }
        catch (err) {
          if (/** @type {{ name?: unknown } | null} */ (err)?.name === "QuotaExceededError" && V2.clearBaseIds()) {
            localStorage.setItem(BOOKMARK_KEY, text);
          }
        }
      } catch (_) {}
    }
    try {
      if (window.driveSync) window.driveSync.scheduleUpload();
      _maybeRequestPersist();
    } catch (_) {}
    return "saved";
  }

  // Rewrite stored bookmarks in place, both copies, keeping the sync store's per-item time (_u) — saveBookmarks would
  // give every changed item a new one, and a new time wins the sync over another device's edit. Nothing to upload, so
  // the sync is not woken. Used for the move of pre-#205 verse ranges (bookmark-core.js migrateStoredBookmarks).
  /** @param {(bm: BookmarkTreeBookmark | SyncFlatItem) => boolean} patch  changes a bookmark in place, true when it did */
  function rewriteBookmarks(patch) {
    /** @param {BookmarkTreeNode[]} nodes @returns {boolean} */
    const patchTree = (nodes) => {
      let changed = false;
      for (const node of nodes) {
        if (node?.type === "bookmark") changed = patch(node) || changed;
        else if (node?.type === "folder" && Array.isArray(node.children)) changed = patchTree(node.children) || changed;
      }
      return changed;
    };
    try {
      const raw = localStorage.getItem(BOOKMARK_KEY);
      const tree = raw ? JSON.parse(raw) : null;
      if (Array.isArray(tree) && patchTree(tree)) localStorage.setItem(BOOKMARK_KEY, JSON.stringify(tree));
    } catch (_) {}
    try {
      const V2 = window.syncStoreV2;
      if (!V2) return;
      const doc = V2.loadLocal();
      let changed = false;
      for (const item of Object.values(doc.bookmarks.items)) {
        if (item?.type === "bookmark") changed = patch(item) || changed;
      }
      if (changed) V2.saveLocal(doc);
    } catch (_) {}
  }

  // The most characters localStorage holds while saveBookmarks(store) runs — keys and values: the sync store's entry
  // measured from the very document it writes, and the legacy key at the larger of the list and what it holds now (it
  // still holds the old list when the sync store is written first, ADR-015 D7), every other key as it is. The bookmark
  // import checks this first, against Safari's quota on every browser — sync carries the list to every device (ADR-040).
  // A key the sync store gives up when storage is full (the base list, store-v2.js saveLocal) is not counted: counted,
  // it refused an import the save would take (기준 목록을 빼고 센다, 사용자 결정 2026-10-31). `withGivenUp` counts it,
  // for an import that fits only without it to give the list up first (bookmark-modals.js _makeRoomForImport).
  /** @param {BookmarkTreeNode[]} store @param {boolean} [withGivenUp] @returns {number} */
  function projectedStorageChars(store, withGivenUp = false) {
    const entry = window.syncStoreV2?.projectedBookmarksEntry(store);
    const list = JSON.stringify(store).length;
    const legacy = entry ? Math.max(list, (localStorage.getItem(BOOKMARK_KEY) ?? "").length) : list;
    let chars = BOOKMARK_KEY.length + legacy + (entry ? entry.chars : 0);
    const skip = new Set([BOOKMARK_KEY, entry?.key, ...(withGivenUp ? [] : entry?.givesUp ?? [])]);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key === null || skip.has(key)) continue;
      chars += key.length + (localStorage.getItem(key) ?? "").length;
    }
    return chars;
  }

  // ── Install nudge state ──

  /** @returns {InstallNudgeState} */
  function _loadNudgeState() {
    try {
      const raw = localStorage.getItem(INSTALL_NUDGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    // nextShow starts at 2 so the install nudge never fires on the first visit:
    // it would cover the content like an intrusive interstitial for search
    // arrivals, and crawlers (stateless → always visit 1) would otherwise see
    // it on every render. A returning (2nd-visit) reader gets the nudge.
    return { visits: 0, nextShow: 2, neverShow: false };
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

  // ── Lectionary track (ADR-038 §3) ──

  /**
   * 기억된 독서 트랙 — 마지막으로 고른 트랙이 날짜와 해를 가리지 않고 기본값이다(사용자 결정 2026-10-13: 「한번 선택하면
   * 계속 일관성 있게 같은 트랙이 기본값」). 없거나 깨졌으면 null(뷰가 1 을 기본으로 삼는다). 이 PR 안에서 잠시 쓰인
   * 전례년별 표(`{"2026":2}`)는 숫자가 아니라 null 로 읽힌다.
   * @returns {1 | 2 | null}
   */
  function loadLectionaryTrack() {
    try {
      const t = Number(localStorage.getItem(LECTIONARY_TRACK_KEY));
      return t === 1 || t === 2 ? t : null;
    } catch {
      return null;
    }
  }

  /** @param {1 | 2} track */
  function saveLectionaryTrack(track) {
    if (track !== 1 && track !== 2) return;
    try { localStorage.setItem(LECTIONARY_TRACK_KEY, String(track)); } catch { /* quota / private mode */ }
  }

  /**
   * 독서 카드를 접어 두었는가 — 처음에는 펼친다(사용자 결정 2026-11-05). 읽기에 실패하면 펼친다.
   * @returns {boolean}
   */
  function loadLectionaryCardsFolded() {
    try {
      return localStorage.getItem(LECTIONARY_CARDS_FOLDED_KEY) === "1";
    } catch {
      return false;
    }
  }

  /** @param {boolean} folded */
  function saveLectionaryCardsFolded(folded) {
    try {
      if (folded) localStorage.setItem(LECTIONARY_CARDS_FOLDED_KEY, "1");
      else localStorage.removeItem(LECTIONARY_CARDS_FOLDED_KEY);
    } catch { /* quota / private mode */ }
  }

  /**
   * 마지막으로 본 캘린더 보기의 주소. 없거나 캘린더 주소가 아니면 null이고, 그때 탭은 이번 달로 간다. 좁은 화면은 오늘 줄의 목록이다(ADR-038 §1).
   * @returns {string | null}
   */
  function loadCalendarLastView() {
    try {
      const path = localStorage.getItem(CALENDAR_LAST_VIEW_KEY);
      return path !== null && /^\/calendar(\/|$)/.test(path) ? path : null;
    } catch {
      return null;
    }
  }

  /** @param {string} path */
  function saveCalendarLastView(path) {
    try { localStorage.setItem(CALENDAR_LAST_VIEW_KEY, path); } catch { /* quota / private mode */ }
  }

  /**
   * 대체 독서(대축일, 주요축일, 고유 독서가 있는 축일에 그날의 평일, 주일 줄)를 전례독서 목록에 보이는가 — 처음에는 숨긴다(사용자 결정 2026-11-05).
   * 동기화가 쓰는 "true"/"false"도 읽는다(`loadCiteShow`와 같다).
   * @returns {boolean}
   */
  function loadLectionaryAltShow() {
    try {
      const v = localStorage.getItem(LECTIONARY_ALT_SHOW_KEY);
      return v === "1" || v === "true";
    } catch {
      return false;
    }
  }

  /** @param {boolean} on */
  function saveLectionaryAltShow(on) {
    try {
      localStorage.setItem(LECTIONARY_ALT_SHOW_KEY, on ? "1" : "0");
      window.syncStoreV2?.saveSetting("lectionaryAltShow", on);
      if (window.driveSync) window.driveSync.scheduleUpload();
    } catch (_) {}
  }

  return {
    FONT_SIZES, DEFAULT_FONT_SIZE, COLOR_SCHEMES, SEARCH_HISTORY_MAX, START_PAGES,
    saveReadingPosition, loadReadingPosition, clearReadingPosition,
    saveAudioTime, loadAudioTime, clearAudioTime,
    normalizeSearchQuery, loadSearchHistory, loadSearchHistoryEntries, saveSearchHistory,
    pushSearchHistory, removeSearchHistory, clearSearchHistory,
    loadStartupBehavior, saveStartupBehavior,
    loadStartPage, saveStartPage,
    loadCiteShow, saveCiteShow,
    loadAudioShow, saveAudioShow,
    loadFontSize, saveFontSize,
    loadColorScheme, saveColorScheme,
    loadTheme, saveTheme,
    loadBookOrder, saveBookOrder,
    generateId, loadBookmarks, saveBookmarks, rewriteBookmarks, projectedStorageChars,
    loadLectionaryTrack, saveLectionaryTrack,
    loadLectionaryCardsFolded, saveLectionaryCardsFolded,
    loadLectionaryAltShow, saveLectionaryAltShow,
    loadCalendarLastView, saveCalendarLastView,
    _loadNudgeState, _saveNudgeState,
    _maybeRequestPersist,
  };
})();

// Marker so TypeScript treats this file as an ES module (function/typedef
// scope = module scope). No actual exports needed — `window.appStorage` is
// the runtime contract.
export {};
