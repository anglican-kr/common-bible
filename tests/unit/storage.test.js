// ── Unit tests for js/app/storage.js ────────────────────────────────────────
// Run with: node --test tests/unit/storage.test.js
//
// Loads the full storage.js IIFE in a vm context with stubbed localStorage,
// navigator, and sync hooks (window.syncStoreV2 / window.driveSync /
// window.syncDebugLog). Tests call methods on the returned `appStorage`
// object — the same public API the rest of the app consumes.
//
// Sections (one per `// ── <area> ──` block in storage.js):
//   - search history
//   - reading position
//   - audio time
//   - startup behavior
//   - font size
//   - color scheme
//   - theme
//   - book order
//   - generateId
//   - bookmarks
//   - install nudge
//   - persisted-storage one-shot

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.resolve(__dirname, "../../js/app/storage.js");
// Strip the trailing `export {};` ESM marker so vm.runInContext (classic
// script) can evaluate the file. Comments before the marker are harmless.
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

// ── In-memory localStorage ───────────────────────────────────────────────────

function makeLocalStorage(initial = {}, opts = {}) {
  const { throwOn = null } = opts;
  // throwOn: null | "all" | Set<string> — simulates SecurityError/QuotaExceeded
  const store = { ...initial };
  function maybeThrow(k) {
    if (throwOn === "all" || (throwOn instanceof Set && throwOn.has(k))) {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    }
  }
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem(k, v) { maybeThrow(k); store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    _raw: store,
  };
}

// ── Sync-hook spy stubs ──────────────────────────────────────────────────────

function makeSyncStoreV2Spy(opts = {}) {
  const { bookmarks = [] } = opts;
  const calls = {
    saveLastRead: [],
    saveSetting: [],
    saveBookmarks: [],
    loadBookmarks: 0,
  };
  let bookmarksReturn = bookmarks;
  return {
    saveLastRead: (val) => { calls.saveLastRead.push(val); },
    saveSetting: (key, val) => { calls.saveSetting.push({ key, val }); },
    saveBookmarks: (val) => { calls.saveBookmarks.push(val); },
    loadBookmarks: () => { calls.loadBookmarks++; return bookmarksReturn; },
    _calls: calls,
    _setBookmarks: (b) => { bookmarksReturn = b; },
  };
}

function makeDriveSyncSpy() {
  const calls = { scheduleUpload: 0 };
  return {
    scheduleUpload: () => { calls.scheduleUpload++; },
    _calls: calls,
  };
}

function makeSyncDebugLogSpy() {
  const entries = [];
  return {
    log: (entry) => { entries.push(entry); },
    _entries: entries,
  };
}

// ── navigator.storage with traceable persist() ───────────────────────────────

function makePersistEnv(mode) {
  const calls = { count: 0 };
  let storage;
  if (mode === "no-storage") {
    storage = undefined;
  } else if (mode === "no-method") {
    storage = {};
  } else if (mode === "rejected") {
    storage = { persist: () => { calls.count++; return Promise.reject(new Error("test reject")); } };
  } else if (mode === "denied") {
    storage = { persist: () => { calls.count++; return Promise.resolve(false); } };
  } else {
    storage = { persist: () => { calls.count++; return Promise.resolve(true); } };
  }
  return { navigator: storage === undefined ? {} : { storage }, _calls: calls };
}

// Cross-realm rehydration: arrays/objects returned from the vm context have
// a different Array/Object prototype than the test realm, which trips
// `assert.deepEqual` (strict). JSON-roundtrip rebuilds them in this realm.
function rehydrate(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

// ── Loader ───────────────────────────────────────────────────────────────────

/**
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.localStorageInit]
 * @param {null | "all" | Set<string>} [opts.localStorageThrowOn]
 * @param {boolean} [opts.withSyncStoreV2]   default true
 * @param {boolean} [opts.withDriveSync]     default true
 * @param {boolean} [opts.withSyncDebugLog]  default true
 * @param {Array<unknown>} [opts.syncBookmarks] preset bookmarks the syncStoreV2 stub returns
 * @param {"granted"|"denied"|"rejected"|"no-method"|"no-storage"} [opts.persist]
 */
function loadStorage(opts = {}) {
  const {
    localStorageInit = {},
    localStorageThrowOn = null,
    withSyncStoreV2 = true,
    withDriveSync = true,
    withSyncDebugLog = true,
    syncBookmarks,
    persist = "granted",
  } = opts;

  const localStorage = makeLocalStorage(localStorageInit, { throwOn: localStorageThrowOn });

  const syncStoreV2 = withSyncStoreV2
    ? makeSyncStoreV2Spy(syncBookmarks ? { bookmarks: syncBookmarks } : {})
    : null;
  const driveSync = withDriveSync ? makeDriveSyncSpy() : null;
  const syncDebugLog = withSyncDebugLog ? makeSyncDebugLogSpy() : null;
  const persistEnv = makePersistEnv(persist);

  const ctx = {
    console, JSON, Date, Math, Object, Array, Set, Map, Promise, Error,
    String, Number, Boolean, parseInt, parseFloat,
    localStorage,
    navigator: persistEnv.navigator,
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  if (syncStoreV2)    ctx.syncStoreV2 = syncStoreV2;
  if (driveSync)      ctx.driveSync = driveSync;
  if (syncDebugLog)   ctx.syncDebugLog = syncDebugLog;

  vm.runInContext(APP_SOURCE, ctx, { filename: "storage.js" });

  return {
    appStorage: ctx.appStorage,
    localStorage,
    syncStoreV2,
    driveSync,
    syncDebugLog,
    persistCalls: persistEnv._calls,
    ctx,
  };
}

// Microtask drain — `_maybeRequestPersist` returns a Promise; one
// `setImmediate` tick is enough to settle one .then() callback.
async function drain(times = 1) {
  for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
}

// ── search history ──────────────────────────────────────────────────────────

test("normalizeSearchQuery: trims and collapses whitespace", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.normalizeSearchQuery("  사랑  "), "사랑");
  assert.equal(h.appStorage.normalizeSearchQuery("사랑   in:요한"), "사랑 in:요한");
  assert.equal(h.appStorage.normalizeSearchQuery("\t사랑\n"), "사랑");
});

test("normalizeSearchQuery: handles null/undefined/non-string", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.normalizeSearchQuery(null), "");
  assert.equal(h.appStorage.normalizeSearchQuery(undefined), "");
  assert.equal(h.appStorage.normalizeSearchQuery(""), "");
});

test("loadSearchHistory: returns [] when storage is empty", () => {
  const h = loadStorage();
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), []);
});

test("loadSearchHistory: returns [] for malformed JSON", () => {
  const h = loadStorage({ localStorageInit: { "bible-search-history": "not json" } });
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), []);
});

test("loadSearchHistory: returns [] for non-array JSON", () => {
  const h = loadStorage({ localStorageInit: { "bible-search-history": JSON.stringify({ foo: 1 }) } });
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), []);
});

test("loadSearchHistory: filters non-string and empty entries", () => {
  const h = loadStorage({
    localStorageInit: { "bible-search-history": JSON.stringify(["사랑", null, "", 42, "은혜"]) },
  });
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), ["사랑", "은혜"]);
});

test("loadSearchHistory: caps at SEARCH_HISTORY_MAX (30)", () => {
  const big = Array.from({ length: 50 }, (_, i) => `q${i}`);
  const h = loadStorage({ localStorageInit: { "bible-search-history": JSON.stringify(big) } });
  const list = rehydrate(h.appStorage.loadSearchHistory());
  assert.equal(list.length, 30);
  assert.equal(list[0], "q0");
  assert.equal(list[29], "q29");
});

test("pushSearchHistory: empty query is a no-op", () => {
  const h = loadStorage();
  const list = rehydrate(h.appStorage.pushSearchHistory("   "));
  assert.deepEqual(list, []);
  assert.equal(h.localStorage.getItem("bible-search-history"), null);
});

test("pushSearchHistory: prepends new entry", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑");
  h.appStorage.pushSearchHistory("은혜");
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), ["은혜", "사랑"]);
});

test("pushSearchHistory: dedupes and moves to top (LRU)", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑");
  h.appStorage.pushSearchHistory("은혜");
  h.appStorage.pushSearchHistory("진리");
  h.appStorage.pushSearchHistory("사랑");
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), ["사랑", "진리", "은혜"]);
});

test("pushSearchHistory: dedupe matches after whitespace normalization", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑 in:요한");
  h.appStorage.pushSearchHistory("  사랑   in:요한  ");
  assert.deepEqual(rehydrate(h.appStorage.loadSearchHistory()), ["사랑 in:요한"]);
});

test("pushSearchHistory: enforces max of 30 entries", () => {
  const h = loadStorage();
  for (let i = 1; i <= 35; i++) h.appStorage.pushSearchHistory(`q${i}`);
  const list = rehydrate(h.appStorage.loadSearchHistory());
  assert.equal(list.length, 30);
  assert.equal(list[0], "q35");
  assert.equal(list[29], "q6");
  assert.ok(!list.includes("q1"), "oldest entry should be evicted");
  assert.ok(!list.includes("q5"), "fifth-oldest entry should be evicted");
});

test("pushSearchHistory: returns the new list", () => {
  const h = loadStorage();
  const list = rehydrate(h.appStorage.pushSearchHistory("사랑"));
  assert.deepEqual(list, ["사랑"]);
});

test("removeSearchHistory: removes a single matching entry", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑");
  h.appStorage.pushSearchHistory("은혜");
  h.appStorage.pushSearchHistory("진리");
  const list = rehydrate(h.appStorage.removeSearchHistory("은혜"));
  assert.deepEqual(list, ["진리", "사랑"]);
});

test("removeSearchHistory: matches after normalization", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑 in:요한");
  const list = rehydrate(h.appStorage.removeSearchHistory("  사랑   in:요한 "));
  assert.deepEqual(list, []);
});

test("removeSearchHistory: missing entry leaves list unchanged", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑");
  const list = rehydrate(h.appStorage.removeSearchHistory("없는키워드"));
  assert.deepEqual(list, ["사랑"]);
});

test("clearSearchHistory: empties storage", () => {
  const h = loadStorage();
  h.appStorage.pushSearchHistory("사랑");
  h.appStorage.pushSearchHistory("은혜");
  assert.notEqual(h.localStorage._raw["bible-search-history"], undefined);
  const list = rehydrate(h.appStorage.clearSearchHistory());
  assert.deepEqual(list, []);
  assert.equal(h.localStorage._raw["bible-search-history"], undefined);
});

test("search history: persists across reloads via localStorage", () => {
  const h1 = loadStorage();
  h1.appStorage.pushSearchHistory("사랑");
  h1.appStorage.pushSearchHistory("은혜");
  const h2 = loadStorage({ localStorageInit: h1.localStorage._raw });
  assert.deepEqual(rehydrate(h2.appStorage.loadSearchHistory()), ["은혜", "사랑"]);
});

test("search history: persists 30 entries across reloads", () => {
  const h1 = loadStorage();
  for (let i = 1; i <= 30; i++) h1.appStorage.pushSearchHistory(`q${i}`);
  const h2 = loadStorage({ localStorageInit: h1.localStorage._raw });
  const list = rehydrate(h2.appStorage.loadSearchHistory());
  assert.equal(list.length, 30);
  assert.equal(list[0], "q30");
  assert.equal(list[29], "q1");
});

// ── reading position ─────────────────────────────────────────────────────────

test("saveReadingPosition: writes JSON to bible-last-read", () => {
  const h = loadStorage();
  h.appStorage.saveReadingPosition("gen", 1, 3);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-last-read"]),
    { bookId: "gen", chapter: 1, verse: 3 });
});

test("saveReadingPosition: verse defaults to null when omitted", () => {
  const h = loadStorage();
  h.appStorage.saveReadingPosition("ps", 23);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-last-read"]),
    { bookId: "ps", chapter: 23, verse: null });
});

test("saveReadingPosition: notifies syncStoreV2.saveLastRead and driveSync", () => {
  const h = loadStorage();
  h.appStorage.saveReadingPosition("gen", 2, 5);
  assert.equal(h.syncStoreV2._calls.saveLastRead.length, 1);
  assert.deepEqual(rehydrate(h.syncStoreV2._calls.saveLastRead[0]),
    { bookId: "gen", chapter: 2, verse: 5 });
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

test("saveReadingPosition: works without syncStoreV2 / driveSync (no throw)", () => {
  const h = loadStorage({ withSyncStoreV2: false, withDriveSync: false });
  h.appStorage.saveReadingPosition("gen", 1);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-last-read"]),
    { bookId: "gen", chapter: 1, verse: null });
});

test("saveReadingPosition: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  // Must not throw; sync side-effects also intercepted before the throw so
  // syncStoreV2.saveLastRead won't run (writes happen first).
  assert.doesNotThrow(() => h.appStorage.saveReadingPosition("gen", 1, 1));
  assert.equal(h.localStorage._raw["bible-last-read"], undefined);
});

test("loadReadingPosition: returns null when storage is empty", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadReadingPosition(), null);
});

test("loadReadingPosition: returns parsed value", () => {
  const h = loadStorage({
    localStorageInit: { "bible-last-read": JSON.stringify({ bookId: "ps", chapter: 23, verse: 1 }) },
  });
  assert.deepEqual(rehydrate(h.appStorage.loadReadingPosition()),
    { bookId: "ps", chapter: 23, verse: 1 });
});

test("loadReadingPosition: returns null on malformed JSON", () => {
  const h = loadStorage({ localStorageInit: { "bible-last-read": "{not json" } });
  assert.equal(h.appStorage.loadReadingPosition(), null);
});

test("clearReadingPosition: removes the key", () => {
  const h = loadStorage({ localStorageInit: { "bible-last-read": "{}" } });
  h.appStorage.clearReadingPosition();
  assert.equal(h.localStorage._raw["bible-last-read"], undefined);
});

// ── audio time ───────────────────────────────────────────────────────────────

test("saveAudioTime: writes {bookId, chapter, time}", () => {
  const h = loadStorage();
  h.appStorage.saveAudioTime("gen", 3, 42.5);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-audio-pos"]),
    { bookId: "gen", chapter: 3, time: 42.5 });
});

test("saveAudioTime: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage.saveAudioTime("gen", 1, 5));
});

test("saveAudioTime: does NOT notify sync layer (audio is local-only)", () => {
  const h = loadStorage();
  h.appStorage.saveAudioTime("gen", 1, 10);
  assert.equal(h.syncStoreV2._calls.saveSetting.length, 0);
  assert.equal(h.driveSync._calls.scheduleUpload, 0);
});

test("loadAudioTime: returns time when bookId+chapter match and time>0", () => {
  const h = loadStorage({
    localStorageInit: { "bible-audio-pos": JSON.stringify({ bookId: "gen", chapter: 3, time: 42.5 }) },
  });
  assert.equal(h.appStorage.loadAudioTime("gen", 3), 42.5);
});

test("loadAudioTime: returns null when bookId mismatches", () => {
  const h = loadStorage({
    localStorageInit: { "bible-audio-pos": JSON.stringify({ bookId: "gen", chapter: 3, time: 42 }) },
  });
  assert.equal(h.appStorage.loadAudioTime("ex", 3), null);
});

test("loadAudioTime: returns null when chapter mismatches", () => {
  const h = loadStorage({
    localStorageInit: { "bible-audio-pos": JSON.stringify({ bookId: "gen", chapter: 3, time: 42 }) },
  });
  assert.equal(h.appStorage.loadAudioTime("gen", 4), null);
});

test("loadAudioTime: returns null when time<=0", () => {
  const h = loadStorage({
    localStorageInit: { "bible-audio-pos": JSON.stringify({ bookId: "gen", chapter: 3, time: 0 }) },
  });
  assert.equal(h.appStorage.loadAudioTime("gen", 3), null);
});

test("loadAudioTime: returns null on missing storage", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadAudioTime("gen", 1), null);
});

test("loadAudioTime: returns null on malformed JSON", () => {
  const h = loadStorage({ localStorageInit: { "bible-audio-pos": "garbage" } });
  assert.equal(h.appStorage.loadAudioTime("gen", 1), null);
});

test("clearAudioTime: removes the key", () => {
  const h = loadStorage({ localStorageInit: { "bible-audio-pos": "{}" } });
  h.appStorage.clearAudioTime();
  assert.equal(h.localStorage._raw["bible-audio-pos"], undefined);
});

// ── startup behavior ─────────────────────────────────────────────────────────

test("loadStartupBehavior: defaults to 'resume' when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadStartupBehavior(), "resume");
});

test("loadStartupBehavior: returns saved value", () => {
  const h = loadStorage({ localStorageInit: { "bible-startup": "home" } });
  assert.equal(h.appStorage.loadStartupBehavior(), "home");
});

test("saveStartupBehavior: writes value and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveStartupBehavior("home");
  assert.equal(h.localStorage._raw["bible-startup"], "home");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "startupBehavior", val: "home" }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

// ── cite/note visibility (ADR-022) ───────────────────────────────────────────

test("loadCiteShow: defaults to true when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadCiteShow(), true);
});

test("loadCiteShow: reads '1' as true and '0' as false (save format)", () => {
  const hOn  = loadStorage({ localStorageInit: { "bible-cite-show": "1" } });
  const hOff = loadStorage({ localStorageInit: { "bible-cite-show": "0" } });
  assert.equal(hOn.appStorage.loadCiteShow(), true);
  assert.equal(hOff.appStorage.loadCiteShow(), false);
});

// Sync's applyToLegacyKeys writes JSON.stringify(boolean), producing
// "true"/"false". Without this tolerance, citeShow appears to reset on the
// next cold start whenever Drive sync has run.
test("loadCiteShow: reads 'true'/'false' written by sync applyToLegacyKeys", () => {
  const hOn  = loadStorage({ localStorageInit: { "bible-cite-show": "true" } });
  const hOff = loadStorage({ localStorageInit: { "bible-cite-show": "false" } });
  assert.equal(hOn.appStorage.loadCiteShow(), true);
  assert.equal(hOff.appStorage.loadCiteShow(), false);
});

test("saveCiteShow: writes '1'/'0' and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveCiteShow(false);
  assert.equal(h.localStorage._raw["bible-cite-show"], "0");
  h.appStorage.saveCiteShow(true);
  assert.equal(h.localStorage._raw["bible-cite-show"], "1");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "citeShow", val: false }, { key: "citeShow", val: true }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 2);
});

test("saveCiteShow: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage.saveCiteShow(false));
});

// ── audio player visibility ──────────────────────────────────────────────────

test("loadAudioShow: defaults to true when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadAudioShow(), true);
});

test("loadAudioShow: reads '1' as true and '0' as false (save format)", () => {
  const hOn  = loadStorage({ localStorageInit: { "bible-audio-show": "1" } });
  const hOff = loadStorage({ localStorageInit: { "bible-audio-show": "0" } });
  assert.equal(hOn.appStorage.loadAudioShow(), true);
  assert.equal(hOff.appStorage.loadAudioShow(), false);
});

// Mirrors loadCiteShow tolerance for sync's JSON-serialized "true"/"false".
test("loadAudioShow: reads 'true'/'false' written by sync applyToLegacyKeys", () => {
  const hOn  = loadStorage({ localStorageInit: { "bible-audio-show": "true" } });
  const hOff = loadStorage({ localStorageInit: { "bible-audio-show": "false" } });
  assert.equal(hOn.appStorage.loadAudioShow(), true);
  assert.equal(hOff.appStorage.loadAudioShow(), false);
});

test("saveAudioShow: writes '1'/'0' and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveAudioShow(false);
  assert.equal(h.localStorage._raw["bible-audio-show"], "0");
  h.appStorage.saveAudioShow(true);
  assert.equal(h.localStorage._raw["bible-audio-show"], "1");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "audioShow", val: false }, { key: "audioShow", val: true }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 2);
});

test("saveAudioShow: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage.saveAudioShow(false));
});

// ── font size ────────────────────────────────────────────────────────────────

test("loadFontSize: defaults to DEFAULT_FONT_SIZE (18) when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadFontSize(), 18);
});

test("loadFontSize: returns saved valid size from FONT_SIZES", () => {
  const h = loadStorage({ localStorageInit: { "bible-font-size": "22" } });
  assert.equal(h.appStorage.loadFontSize(), 22);
});

test("loadFontSize: falls back to DEFAULT for out-of-list values", () => {
  const h = loadStorage({ localStorageInit: { "bible-font-size": "999" } });
  assert.equal(h.appStorage.loadFontSize(), 18);
});

test("loadFontSize: falls back to DEFAULT for non-numeric values", () => {
  const h = loadStorage({ localStorageInit: { "bible-font-size": "abc" } });
  assert.equal(h.appStorage.loadFontSize(), 18);
});

test("saveFontSize: writes string and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveFontSize(20);
  assert.equal(h.localStorage._raw["bible-font-size"], "20");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "fontSize", val: 20 }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

test("saveFontSize: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage.saveFontSize(20));
});

test("FONT_SIZES is exposed and DEFAULT_FONT_SIZE is in it", () => {
  const h = loadStorage();
  const sizes = rehydrate(h.appStorage.FONT_SIZES);
  assert.deepEqual(sizes, [16, 18, 20, 22, 24]);
  assert.ok(sizes.includes(h.appStorage.DEFAULT_FONT_SIZE));
});

// ── color scheme ─────────────────────────────────────────────────────────────

test("loadColorScheme: defaults to 'navy' when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadColorScheme(), "navy");
});

test("loadColorScheme: returns saved scheme when valid", () => {
  const h = loadStorage({ localStorageInit: { "bible-color-scheme": "red" } });
  assert.equal(h.appStorage.loadColorScheme(), "red");
});

test("loadColorScheme: falls back to 'navy' for unknown id", () => {
  const h = loadStorage({ localStorageInit: { "bible-color-scheme": "midnight-emerald" } });
  assert.equal(h.appStorage.loadColorScheme(), "navy");
});

test("saveColorScheme: writes value and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveColorScheme("green");
  assert.equal(h.localStorage._raw["bible-color-scheme"], "green");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "colorScheme", val: "green" }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

test("COLOR_SCHEMES exposes the 4 known schemes", () => {
  const h = loadStorage();
  const ids = rehydrate(h.appStorage.COLOR_SCHEMES).map((/** @type {{id: string}} */ s) => s.id);
  assert.deepEqual(ids.sort(), ["green", "navy", "purple", "red"]);
});

// ── theme ────────────────────────────────────────────────────────────────────

test("loadTheme: defaults to 'system' when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadTheme(), "system");
});

test("loadTheme: returns 'dark' when saved", () => {
  const h = loadStorage({ localStorageInit: { "bible-theme": "dark" } });
  assert.equal(h.appStorage.loadTheme(), "dark");
});

test("loadTheme: returns 'light' when saved", () => {
  const h = loadStorage({ localStorageInit: { "bible-theme": "light" } });
  assert.equal(h.appStorage.loadTheme(), "light");
});

test("loadTheme: falls back to 'system' for unrecognized values", () => {
  const h = loadStorage({ localStorageInit: { "bible-theme": "sepia" } });
  assert.equal(h.appStorage.loadTheme(), "system");
});

test("saveTheme: writes value and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveTheme("dark");
  assert.equal(h.localStorage._raw["bible-theme"], "dark");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "theme", val: "dark" }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

// ── book order ───────────────────────────────────────────────────────────────

test("loadBookOrder: defaults to 'canonical' when unset", () => {
  const h = loadStorage();
  assert.equal(h.appStorage.loadBookOrder(), "canonical");
});

test("loadBookOrder: returns saved 'vulgate'", () => {
  const h = loadStorage({ localStorageInit: { "bible-book-order": "vulgate" } });
  assert.equal(h.appStorage.loadBookOrder(), "vulgate");
});

test("loadBookOrder: falls back to 'canonical' for unknown values", () => {
  const h = loadStorage({ localStorageInit: { "bible-book-order": "septuagint" } });
  assert.equal(h.appStorage.loadBookOrder(), "canonical");
});

test("saveBookOrder: writes value and notifies sync + drive", () => {
  const h = loadStorage();
  h.appStorage.saveBookOrder("vulgate");
  assert.equal(h.localStorage._raw["bible-book-order"], "vulgate");
  assert.deepEqual(h.syncStoreV2._calls.saveSetting,
    [{ key: "bookOrder", val: "vulgate" }]);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

// ── generateId ───────────────────────────────────────────────────────────────

test("generateId: returns a base36-ish string", () => {
  const h = loadStorage();
  const id = h.appStorage.generateId();
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
  assert.match(id, /^[0-9a-z]+$/);
});

test("generateId: returns unique values across calls", () => {
  const h = loadStorage();
  const ids = new Set();
  for (let i = 0; i < 100; i++) ids.add(h.appStorage.generateId());
  assert.equal(ids.size, 100);
});

// ── bookmarks ────────────────────────────────────────────────────────────────

test("loadBookmarks: delegates to syncStoreV2.loadBookmarks when present", () => {
  const remote = [{ id: "1", title: "remote" }];
  const h = loadStorage({ syncBookmarks: remote });
  assert.deepEqual(rehydrate(h.appStorage.loadBookmarks()), remote);
  assert.equal(h.syncStoreV2._calls.loadBookmarks, 1);
});

test("loadBookmarks: falls back to localStorage when syncStoreV2 missing", () => {
  const items = [{ id: "1", title: "local" }];
  const h = loadStorage({
    withSyncStoreV2: false,
    localStorageInit: { "bible-bookmarks": JSON.stringify(items) },
  });
  assert.deepEqual(rehydrate(h.appStorage.loadBookmarks()), items);
});

test("loadBookmarks: returns [] in fallback when no storage", () => {
  const h = loadStorage({ withSyncStoreV2: false });
  assert.deepEqual(rehydrate(h.appStorage.loadBookmarks()), []);
});

test("loadBookmarks: returns [] in fallback on malformed JSON", () => {
  const h = loadStorage({
    withSyncStoreV2: false,
    localStorageInit: { "bible-bookmarks": "{not json" },
  });
  assert.deepEqual(rehydrate(h.appStorage.loadBookmarks()), []);
});

test("saveBookmarks: writes JSON and notifies syncStoreV2 + driveSync", () => {
  const h = loadStorage();
  const items = [{ id: "1", title: "test" }];
  h.appStorage.saveBookmarks(items);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-bookmarks"]), items);
  assert.equal(h.syncStoreV2._calls.saveBookmarks.length, 1);
  assert.deepEqual(rehydrate(h.syncStoreV2._calls.saveBookmarks[0]), items);
  assert.equal(h.driveSync._calls.scheduleUpload, 1);
});

test("saveBookmarks: triggers _maybeRequestPersist on first call", async () => {
  const h = loadStorage();
  h.appStorage.saveBookmarks([{ id: "1", title: "first" }]);
  await drain();
  assert.equal(h.persistCalls.count, 1);
});

test("saveBookmarks: _maybeRequestPersist guards against double-call", async () => {
  const h = loadStorage();
  h.appStorage.saveBookmarks([{ id: "1" }]);
  h.appStorage.saveBookmarks([{ id: "1" }, { id: "2" }]);
  h.appStorage.saveBookmarks([{ id: "1" }, { id: "2" }, { id: "3" }]);
  await drain();
  assert.equal(h.persistCalls.count, 1);
});

test("saveBookmarks: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage.saveBookmarks([{ id: "1" }]));
});

// ── install nudge ────────────────────────────────────────────────────────────

test("_loadNudgeState: returns default when no storage", () => {
  const h = loadStorage();
  assert.deepEqual(rehydrate(h.appStorage._loadNudgeState()),
    { visits: 0, nextShow: 1, neverShow: false });
});

test("_loadNudgeState: returns parsed value", () => {
  const state = { visits: 5, nextShow: 8, neverShow: false };
  const h = loadStorage({ localStorageInit: { "bible-install-nudge": JSON.stringify(state) } });
  assert.deepEqual(rehydrate(h.appStorage._loadNudgeState()), state);
});

test("_loadNudgeState: returns default on malformed JSON", () => {
  const h = loadStorage({ localStorageInit: { "bible-install-nudge": "{not json" } });
  assert.deepEqual(rehydrate(h.appStorage._loadNudgeState()),
    { visits: 0, nextShow: 1, neverShow: false });
});

test("_saveNudgeState: writes serialized state", () => {
  const h = loadStorage();
  const state = { visits: 3, nextShow: 5, neverShow: true };
  h.appStorage._saveNudgeState(state);
  assert.deepEqual(JSON.parse(h.localStorage._raw["bible-install-nudge"]), state);
});

test("_saveNudgeState: swallows localStorage errors", () => {
  const h = loadStorage({ localStorageThrowOn: "all" });
  assert.doesNotThrow(() => h.appStorage._saveNudgeState({ visits: 1, nextShow: 1, neverShow: false }));
});

// ── _maybeRequestPersist ─────────────────────────────────────────────────────

test("_maybeRequestPersist: granted → debug log entry granted=true", async () => {
  const h = loadStorage({ persist: "granted" });
  h.appStorage._maybeRequestPersist();
  await drain();
  assert.equal(h.persistCalls.count, 1);
  const log = h.syncDebugLog._entries.find((e) => e.event === "storage-persist");
  assert.ok(log, "expected storage-persist log entry");
  assert.equal(log.granted, true);
});

test("_maybeRequestPersist: denied → debug log entry granted=false", async () => {
  const h = loadStorage({ persist: "denied" });
  h.appStorage._maybeRequestPersist();
  await drain();
  const log = h.syncDebugLog._entries.find((e) => e.event === "storage-persist");
  assert.ok(log);
  assert.equal(log.granted, false);
});

test("_maybeRequestPersist: rejection is swallowed silently", async () => {
  const h = loadStorage({ persist: "rejected" });
  h.appStorage._maybeRequestPersist();
  await drain(2);
  // No throw, no granted log entry (rejection skips the .then handler).
  assert.equal(h.persistCalls.count, 1);
  assert.equal(h.syncDebugLog._entries.find((e) => e.event === "storage-persist"), undefined);
});

test("_maybeRequestPersist: no-op when navigator.storage absent", async () => {
  const h = loadStorage({ persist: "no-storage" });
  h.appStorage._maybeRequestPersist();
  await drain();
  assert.equal(h.persistCalls.count, 0);
});

test("_maybeRequestPersist: no-op when navigator.storage.persist missing", async () => {
  const h = loadStorage({ persist: "no-method" });
  h.appStorage._maybeRequestPersist();
  await drain();
  assert.equal(h.persistCalls.count, 0);
});

test("_maybeRequestPersist: only the first call invokes persist (one-shot)", async () => {
  const h = loadStorage({ persist: "granted" });
  h.appStorage._maybeRequestPersist();
  h.appStorage._maybeRequestPersist();
  h.appStorage._maybeRequestPersist();
  await drain();
  assert.equal(h.persistCalls.count, 1);
});
