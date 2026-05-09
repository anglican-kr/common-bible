// ── Unit tests for js/app/storage.js ────────────────────────────────────────
// Run with: node --test tests/unit/storage.test.js
//
// Currently exercises the search-history helpers only (BEGIN/END markers in
// js/app/storage.js). Other storage.js helpers — settings load/save, reading
// position, bookmarks — are not yet covered; future tests will land in this
// same file under additional `// ── <영역> ──` sections (per ADR-013
// 2026-05-09 naming convention: one test file per source module).
//
// Slice loader: extracts just the marked block and evaluates it in a vm
// context with a stubbed localStorage. Returned arrays are rehydrated
// through JSON so deepStrictEqual doesn't trip over cross-realm Array
// prototypes.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PATH = path.resolve(__dirname, "../../js/app/storage.js");
const APP_SOURCE = fs.readFileSync(APP_PATH, "utf8");

const BEGIN = "// ── BEGIN SEARCH HISTORY HELPERS ──";
const END = "// ── END SEARCH HISTORY HELPERS ──";

function extractHelpers() {
  const start = APP_SOURCE.indexOf(BEGIN);
  const end = APP_SOURCE.indexOf(END);
  if (start < 0 || end < 0) {
    throw new Error("BEGIN/END SEARCH HISTORY HELPERS markers not found in js/app.js");
  }
  return APP_SOURCE.slice(start, end + END.length);
}

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    _raw: store,
  };
}

function loadHelpers(initial = {}) {
  const localStorage = makeLocalStorage(initial);
  const ctx = {
    localStorage,
    JSON, Array, String, console, Error, Math, Number, Boolean, Object,
  };
  vm.createContext(ctx);
  const prelude = `
    const SEARCH_HISTORY_KEY = "bible-search-history";
    const SEARCH_HISTORY_MAX = 30;
    const SEARCH_HISTORY_VISIBLE = 10;
  `;
  vm.runInContext(prelude + extractHelpers(), ctx, { filename: "search-history-helpers.js" });

  // Rehydrate arrays returned from the vm so deepStrictEqual works.
  const reload = () => JSON.parse(JSON.stringify(ctx.loadSearchHistory()));
  const push = (q) => JSON.parse(JSON.stringify(ctx.pushSearchHistory(q)));
  const remove = (q) => JSON.parse(JSON.stringify(ctx.removeSearchHistory(q)));
  const clear = () => JSON.parse(JSON.stringify(ctx.clearSearchHistory()));
  const normalize = (q) => ctx.normalizeSearchQuery(q);

  return {
    ctx, localStorage,
    loadSearchHistory: reload,
    pushSearchHistory: push,
    removeSearchHistory: remove,
    clearSearchHistory: clear,
    normalizeSearchQuery: normalize,
  };
}

// ── normalizeSearchQuery ─────────────────────────────────────────────────────

test("normalizeSearchQuery: trims and collapses whitespace", () => {
  const h = loadHelpers();
  assert.equal(h.normalizeSearchQuery("  사랑  "), "사랑");
  assert.equal(h.normalizeSearchQuery("사랑   in:요한"), "사랑 in:요한");
  assert.equal(h.normalizeSearchQuery("\t사랑\n"), "사랑");
});

test("normalizeSearchQuery: handles null/undefined/non-string", () => {
  const h = loadHelpers();
  assert.equal(h.normalizeSearchQuery(null), "");
  assert.equal(h.normalizeSearchQuery(undefined), "");
  assert.equal(h.normalizeSearchQuery(""), "");
});

// ── loadSearchHistory ────────────────────────────────────────────────────────

test("loadSearchHistory: returns [] when storage is empty", () => {
  const h = loadHelpers();
  assert.deepEqual(h.loadSearchHistory(), []);
});

test("loadSearchHistory: returns [] for malformed JSON", () => {
  const h = loadHelpers({ "bible-search-history": "not json" });
  assert.deepEqual(h.loadSearchHistory(), []);
});

test("loadSearchHistory: returns [] for non-array JSON", () => {
  const h = loadHelpers({ "bible-search-history": JSON.stringify({ foo: 1 }) });
  assert.deepEqual(h.loadSearchHistory(), []);
});

test("loadSearchHistory: filters non-string and empty entries", () => {
  const h = loadHelpers({
    "bible-search-history": JSON.stringify(["사랑", null, "", 42, "은혜"]),
  });
  assert.deepEqual(h.loadSearchHistory(), ["사랑", "은혜"]);
});

test("loadSearchHistory: caps at SEARCH_HISTORY_MAX (30)", () => {
  const big = Array.from({ length: 50 }, (_, i) => `q${i}`);
  const h = loadHelpers({ "bible-search-history": JSON.stringify(big) });
  const list = h.loadSearchHistory();
  assert.equal(list.length, 30);
  assert.equal(list[0], "q0");
  assert.equal(list[29], "q29");
});

// ── pushSearchHistory: LRU semantics ─────────────────────────────────────────

test("pushSearchHistory: empty query is a no-op", () => {
  const h = loadHelpers();
  const list = h.pushSearchHistory("   ");
  assert.deepEqual(list, []);
  assert.equal(h.localStorage.getItem("bible-search-history"), null);
});

test("pushSearchHistory: prepends new entry", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑");
  h.pushSearchHistory("은혜");
  assert.deepEqual(h.loadSearchHistory(), ["은혜", "사랑"]);
});

test("pushSearchHistory: dedupes and moves to top (LRU)", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑");
  h.pushSearchHistory("은혜");
  h.pushSearchHistory("진리");
  h.pushSearchHistory("사랑");
  assert.deepEqual(h.loadSearchHistory(), ["사랑", "진리", "은혜"]);
});

test("pushSearchHistory: dedupe matches after whitespace normalization", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑 in:요한");
  h.pushSearchHistory("  사랑   in:요한  ");
  assert.deepEqual(h.loadSearchHistory(), ["사랑 in:요한"]);
});

test("pushSearchHistory: enforces max of 30 entries", () => {
  const h = loadHelpers();
  for (let i = 1; i <= 35; i++) h.pushSearchHistory(`q${i}`);
  const list = h.loadSearchHistory();
  assert.equal(list.length, 30);
  assert.equal(list[0], "q35");
  assert.equal(list[29], "q6");
  assert.ok(!list.includes("q1"), "oldest entry should be evicted");
  assert.ok(!list.includes("q5"), "fifth-oldest entry should be evicted");
});

test("pushSearchHistory: returns the new list", () => {
  const h = loadHelpers();
  const list = h.pushSearchHistory("사랑");
  assert.deepEqual(list, ["사랑"]);
});

// ── removeSearchHistory ──────────────────────────────────────────────────────

test("removeSearchHistory: removes a single matching entry", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑");
  h.pushSearchHistory("은혜");
  h.pushSearchHistory("진리");
  const list = h.removeSearchHistory("은혜");
  assert.deepEqual(list, ["진리", "사랑"]);
});

test("removeSearchHistory: matches after normalization", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑 in:요한");
  const list = h.removeSearchHistory("  사랑   in:요한 ");
  assert.deepEqual(list, []);
});

test("removeSearchHistory: missing entry leaves list unchanged", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑");
  const list = h.removeSearchHistory("없는키워드");
  assert.deepEqual(list, ["사랑"]);
});

// ── clearSearchHistory ───────────────────────────────────────────────────────

test("clearSearchHistory: empties storage", () => {
  const h = loadHelpers();
  h.pushSearchHistory("사랑");
  h.pushSearchHistory("은혜");
  assert.notEqual(h.localStorage._raw["bible-search-history"], undefined);
  const list = h.clearSearchHistory();
  assert.deepEqual(list, []);
  assert.equal(h.localStorage._raw["bible-search-history"], undefined);
});

// ── persistence ──────────────────────────────────────────────────────────────

test("persists across reloads via localStorage", () => {
  const h1 = loadHelpers();
  h1.pushSearchHistory("사랑");
  h1.pushSearchHistory("은혜");
  const h2 = loadHelpers(h1.localStorage._raw);
  assert.deepEqual(h2.loadSearchHistory(), ["은혜", "사랑"]);
});

test("persists 30 entries across reloads (deep history)", () => {
  const h1 = loadHelpers();
  for (let i = 1; i <= 30; i++) h1.pushSearchHistory(`q${i}`);
  const h2 = loadHelpers(h1.localStorage._raw);
  const list = h2.loadSearchHistory();
  assert.equal(list.length, 30);
  assert.equal(list[0], "q30");
  assert.equal(list[29], "q1");
});
