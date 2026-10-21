// ── Unit tests for js/app/views.js ──────────────────────────────────
// Run with: node --test tests/unit/views.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark.test.js. Eight marker
// pairs cover the testable surface; Pull-to-refresh / startScrollTracking /
// Audio Player remain out of scope — those need touch gestures or
// `getBoundingClientRect` and are deferred until jsdom adoption (ADR-013
// dual-track, 2026-05-11).
//
// Coverage:
//   - DATA_FETCHING block — loadBooks / loadVersion / loadChapter /
//     loadPrologue. fetch + window stubs.
//   - TITLE block — setTitle. $title + clearNode + el + announce stubs.
//   - DIVISION block — divisionLabels / divisionOrder / effectiveDivision /
//     bookListPath + constants. loadBookOrder stub.
//   - DIVISION_TABS block — buildDivisionTabs. Tab anchors per book-order
//     setting + active-tab marking. el + divisionLabels/divisionOrder stubs.
//   - POPOVER block — setTitleWithChapterPicker. Open/close contract + focus
//     trap + click-outside-to-close + click-on-link-to-close. Richer DOM stub
//     with addEventListener + classList + hidden + querySelector + contains.
//   - COMPACT_HEADER block — initCompactHeader. Hysteretic 60px / 10px
//     scroll-based class toggle. Window scroll listener stub.
//   - VERSE_SELECTION block — _verseSelectionUnit (every line of a verse is
//     one unit, by verse instance — not by the number two verses can share; a
//     data half verse is its own unit) + _verseRangeKeys (anchor→target
//     inclusive range, either direction, verse-unit boundary expansion).
//   - VERSE_NUMBER block — formatVerseNumber. Verse-number display string:
//     plain / dual [N_M] / LXX-only [_N] / cross-ref / range / half verse (「2ㄱ」).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_PATH = path.resolve(__dirname, "../../js/app/views.js");
const VIEWS_SOURCE = fs.readFileSync(VIEWS_PATH, "utf8");
// Data fetching moved to its own module (ADR-034 PR2). The DATA_FETCHING marker
// block now lives there, so its loader slices from this source, not VIEWS_SOURCE.
const DATA_FETCH_PATH = path.resolve(__dirname, "../../js/app/data-fetch.js");
const DATA_FETCH_SOURCE = fs.readFileSync(DATA_FETCH_PATH, "utf8");
// The chapter popover drives the shared overlay controller (ADR-032). The
// POPOVER loader injects the REAL overlay.js so its open/close lifecycle runs
// against the test DOM stub. Strip the trailing `export {};` ESM marker.
const OVERLAY_PATH = path.resolve(__dirname, "../../js/app/overlay.js");
const OVERLAY_SOURCE = fs.readFileSync(OVERLAY_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

function extractBlock(name, source = VIEWS_SOURCE) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found`);
  }
  return source.slice(startIdx, endIdx + end.length);
}

// ── DATA_FETCHING loader ─────────────────────────────────────────────────────
// Provides:
//   - `fetch` — assignable from outside via `ctx._fetchImpl` so each test
//     can supply a different response without rebuilding the context.
//   - `DATA_DIR` — mirrors the production constant.
//   - `booksCache` / `appVersion` — module state declared in prelude.
//   - `window` — stub object so `window.booksPromise` / `window.appVersion`
//     reads/writes work.

function loadDataFetching() {
  const fetchCalls = [];
  /** @type {(url: string) => Promise<any>} */
  let fetchImpl = async (_url) => ({
    ok: true,
    json: async () => ({}),
  });
  const windowStub = { booksPromise: undefined, appVersion: null };

  const ctx = {
    Promise, Object, Array, Set, Map, JSON, console, Error,
    window: windowStub,
    fetch: async (url) => {
      fetchCalls.push(url);
      return fetchImpl(url);
    },
  };
  vm.createContext(ctx);
  // Prelude: DATA_DIR + module state + peek helpers (function declarations
  // hoist into globalThis even when `let` declarations don't).
  const prelude = `
    const DATA_DIR = "/data";
    let booksCache = null;
    let appVersion = null;
    function _peekBooksCache() { return booksCache; }
    function _peekAppVersion() { return appVersion; }
    function _setBooksCache(v) { booksCache = v; }
  `;
  vm.runInContext(prelude + extractBlock("DATA_FETCHING", DATA_FETCH_SOURCE), ctx, {
    filename: "data-fetch.js",
  });
  return {
    ctx, fetchCalls, windowStub,
    setFetch: (fn) => { fetchImpl = fn; },
    loadBooks: ctx.loadBooks,
    loadVersion: ctx.loadVersion,
    loadChapter: ctx.loadChapter,
    loadPrologue: ctx.loadPrologue,
    peekBooksCache: () => ctx._peekBooksCache(),
    peekAppVersion: () => ctx._peekAppVersion(),
    setBooksCache: (v) => ctx._setBooksCache(v),
  };
}

// ── DIVISION loader ──────────────────────────────────────────────────────────

function loadDivision(initialBookOrder = "canonical") {
  const ctx = { Object, Array, String, Number, Boolean, console, Error };
  vm.createContext(ctx);
  let bookOrder = initialBookOrder;
  ctx._bookOrderImpl = () => bookOrder;
  const prelude = `function loadBookOrder() { return _bookOrderImpl(); }`;
  vm.runInContext(prelude + extractBlock("DIVISION"), ctx, {
    filename: "views-division.js",
  });
  return {
    ctx,
    setBookOrder: (v) => { bookOrder = v; },
    divisionLabels: ctx.divisionLabels,
    divisionOrder: ctx.divisionOrder,
    effectiveDivision: ctx.effectiveDivision,
    bookListPath: ctx.bookListPath,
    DIVISION_LABELS: ctx.DIVISION_LABELS,
    DIVISION_ORDER: ctx.DIVISION_ORDER,
  };
}

// ── Minimal DOM stub (shared by TITLE + BREADCRUMB) ──────────────────────────
// Same shape as search.test.js / bookmark.test.js Element stubs but pared to
// what setTitle / setTitleWithChapterPicker actually use.

function makeDom() {
  class StubText {
    constructor(text) {
      this.nodeType = 3;
      this.data = String(text);
    }
    get textContent() { return this.data; }
  }
  class StubElement {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this._textOverride = null;
      // Minimal CSSOM shim: production code sets custom properties / transform
      // via .style (CSP blocks style *attributes*, so .style is the only path).
      this.style = {
        _props: {},
        setProperty(k, v) { this._props[k] = String(v); },
        getPropertyValue(k) { return this._props[k] || ""; },
        removeProperty(k) { delete this._props[k]; },
      };
    }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    removeAttribute(k) { delete this.attributes[k]; }
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }
    set className(v) { this.attributes.class = String(v); }
    get className() { return this.attributes.class || ""; }
    get classList() {
      // Minimal classList shim: setTitle calls .remove("compact"); the simple
      // StubElement doesn't track classes structurally, so remove is a no-op.
      // The popover loader's RichElement has its own (fuller) implementation.
      return this._classList || (this._classList = {
        add: () => {},
        remove: () => {},
        contains: () => false,
        toggle: () => false,
      });
    }
    set textContent(v) {
      this.children = [];
      this._textOverride = String(v);
    }
    get textContent() {
      if (this._textOverride !== null) return this._textOverride;
      return this.children
        .map((c) => (c && typeof c.textContent === "string" ? c.textContent : ""))
        .join("");
    }
  }
  const document = {
    createElement: (tag) => new StubElement(tag),
    createTextNode: (text) => new StubText(text),
    title: "",
  };
  return { document, StubElement, StubText };
}

// `el` shim — copy of helpers.js's el(). String/className/textContent/
// fall-through-to-setAttribute matches production.
const EL_SHIM = `
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
  node.children = [];
  if ("_textOverride" in node) node._textOverride = null;
}
`;

// ── TITLE loader ─────────────────────────────────────────────────────────────

function loadTitle() {
  const { document, StubElement } = makeDom();
  const $title = new StubElement("h1");
  $title.id = "page-title";
  const announceCalls = [];
  const ctx = {
    Object, Array, String, Number, Boolean, JSON, console, Error,
    document, $title,
    announce: (msg) => { announceCalls.push(msg); },
  };
  vm.createContext(ctx);
  vm.runInContext(EL_SHIM + extractBlock("TITLE"), ctx, {
    filename: "views-title.js",
  });
  return {
    ctx, document, $title, announceCalls,
    setTitle: ctx.setTitle,
  };
}

// ── DIVISION_TABS loader ─────────────────────────────────────────────────────

function loadDivisionTabs(order = ["old_testament", "deuterocanon", "new_testament"]) {
  const { document } = makeDom();
  const labels = {
    old_testament: "구약",
    deuterocanon: "외경",
    new_testament: "신약",
  };
  const ctx = {
    Object, Array, String, Number, Boolean, JSON, console, Error,
    document,
    divisionLabels: () => labels,
    divisionOrder: () => order,
  };
  vm.createContext(ctx);
  vm.runInContext(EL_SHIM + extractBlock("DIVISION_TABS"), ctx, {
    filename: "views-division-tabs.js",
  });
  return {
    ctx,
    buildDivisionTabs: ctx.buildDivisionTabs,
    buildSegmentTabs: ctx.buildSegmentTabs,
  };
}

// ── VERSE_SELECTION loader ───────────────────────────────────────────────────
// DOM-pure helper that reads classList + data-vkey off a passed article node.
// Mini article stub returns the supplied verse spans for querySelectorAll
// (".verse[data-vkey]"); per-span classList.contains is a one-class check.

function loadVerseSelection() {
  const ctx = { Object, Array, String, Number, Boolean, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SELECTION"), ctx, {
    filename: "views-verse-selection.js",
  });
  return {
    ctx,
    verseSelectionUnit: ctx._verseSelectionUnit,
    verseRangeKeys: ctx._verseRangeKeys,
  };
}

/** @param {Array<[string, boolean]>} verses [data-vkey, isPoetry] tuples — "<instance key>/<data-vref>" */
function makeArticleStub(verses) {
  const elements = verses.map(([key, isPoetry]) => ({
    getAttribute: (k) => (k === "data-vkey" ? key : null),
    classList: { contains: (cls) => isPoetry && cls === "verse-poetry" },
  }));
  return {
    querySelectorAll: (sel) => (sel === ".verse[data-vkey]" ? elements : []),
  };
}

// ── VERSE_NUMBER loader ──────────────────────────────────────────────────────
// Pure verse-number formatting. No DOM, no globals.

// formatVerseNumber imports halfVerseMark from verse-spec.js — run that module's block first so the test uses the
// real mapping.
const VERSE_SPEC_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/verse-spec.js"), "utf8");

function loadVerseNumber() {
  const ctx = { Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error, parseInt, isNaN };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(extractBlock("VERSE_NUMBER"), ctx, {
    filename: "views-verse-number.js",
  });
  return { formatVerseNumber: ctx.formatVerseNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

// ── DATA_FETCHING ────────────────────────────────────────────────────────────

test("loadBooks: returns cached value without fetching when booksCache is set", async () => {
  const h = loadDataFetching();
  const cached = [{ id: "gen", name_ko: "창세기" }];
  h.setBooksCache(cached);
  const result = await h.loadBooks();
  assert.equal(h.fetchCalls.length, 0);
  // Cross-realm equality: compare via JSON
  assert.deepEqual(JSON.parse(JSON.stringify(result)), cached);
});

test("loadBooks: uses window.booksPromise if available (skips fetch)", async () => {
  const h = loadDataFetching();
  const prefetched = [{ id: "rev", name_ko: "묵시록" }];
  h.windowStub.booksPromise = Promise.resolve(prefetched);
  const result = await h.loadBooks();
  assert.equal(h.fetchCalls.length, 0, "fetch should not be called when booksPromise is present");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), prefetched);
  // Cache populated for subsequent calls
  assert.deepEqual(JSON.parse(JSON.stringify(h.peekBooksCache())), prefetched);
});

test("loadBooks: falls back to fetch when no cache and no booksPromise", async () => {
  const h = loadDataFetching();
  const fetched = [{ id: "matt", name_ko: "마태오" }];
  h.setFetch(async () => ({ ok: true, json: async () => fetched }));
  const result = await h.loadBooks();
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0], "/data/books.json");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), fetched);
});

test("loadBooks: throws on fetch !ok response", async () => {
  const h = loadDataFetching();
  h.setFetch(async () => ({ ok: false, json: async () => null }));
  await assert.rejects(() => h.loadBooks(), /Failed to pre-fetch books\.json|Failed to load books\.json/);
});

test("loadVersion: returns cached value when appVersion is set", async () => {
  const h = loadDataFetching();
  // Initially appVersion is null. First call fetches; subsequent returns cached.
  h.setFetch(async () => ({ ok: true, json: async () => ({ version: "1.4.7" }) }));
  const v1 = await h.loadVersion();
  assert.equal(v1, "1.4.7");
  h.setFetch(async () => { throw new Error("should not fetch again"); });
  const v2 = await h.loadVersion();
  assert.equal(v2, "1.4.7");
});

test("loadVersion: mirrors result onto window.appVersion", async () => {
  const h = loadDataFetching();
  h.setFetch(async () => ({ ok: true, json: async () => ({ version: "1.5.0" }) }));
  await h.loadVersion();
  assert.equal(h.windowStub.appVersion, "1.5.0");
});

test("loadVersion: returns empty string on fetch failure", async () => {
  const h = loadDataFetching();
  h.setFetch(async () => { throw new Error("network down"); });
  const v = await h.loadVersion();
  assert.equal(v, "");
});

test("loadChapter: hits /data/bible/{bookId}-{chapter}.json", async () => {
  const h = loadDataFetching();
  const chapterData = { book_id: "gen", chapter: 1, verses: [] };
  h.setFetch(async () => ({ ok: true, json: async () => chapterData }));
  const result = await h.loadChapter("gen", 1);
  assert.equal(h.fetchCalls[0], "/data/bible/gen-1.json");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), chapterData);
});

test("loadChapter: throws on !ok", async () => {
  const h = loadDataFetching();
  h.setFetch(async () => ({ ok: false, json: async () => null }));
  await assert.rejects(() => h.loadChapter("gen", 1), /Failed to load gen-1\.json/);
});

test("loadPrologue: hits /data/bible/{bookId}-prologue.json", async () => {
  const h = loadDataFetching();
  const prologueData = { book_id: "sir", paragraphs: ["..."] };
  h.setFetch(async () => ({ ok: true, json: async () => prologueData }));
  const result = await h.loadPrologue("sir");
  assert.equal(h.fetchCalls[0], "/data/bible/sir-prologue.json");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), prologueData);
});

test("loadPrologue: throws on !ok", async () => {
  const h = loadDataFetching();
  h.setFetch(async () => ({ ok: false, json: async () => null }));
  await assert.rejects(() => h.loadPrologue("sir"), /Failed to load sir-prologue\.json/);
});

// ── DIVISION ─────────────────────────────────────────────────────────────────

test("divisionLabels: canonical → 3 entries (구약/외경/신약)", () => {
  const h = loadDivision("canonical");
  const labels = h.divisionLabels();
  assert.equal(Object.keys(labels).length, 3);
  assert.equal(labels.old_testament, "구약");
  assert.equal(labels.deuterocanon, "외경");
  assert.equal(labels.new_testament, "신약");
});

test("divisionLabels: vulgate → 2 entries (no deuterocanon)", () => {
  const h = loadDivision("vulgate");
  const labels = h.divisionLabels();
  assert.equal(Object.keys(labels).length, 2);
  assert.equal(labels.old_testament, "구약");
  assert.equal(labels.new_testament, "신약");
  assert.equal(labels.deuterocanon, undefined);
});

test("divisionOrder: canonical → 3 items in canonical order", () => {
  const h = loadDivision("canonical");
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.divisionOrder())),
    ["old_testament", "deuterocanon", "new_testament"],
  );
});

test("divisionOrder: vulgate → 2 items, deuterocanon dropped", () => {
  const h = loadDivision("vulgate");
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.divisionOrder())),
    ["old_testament", "new_testament"],
  );
});

test("effectiveDivision: canonical mode keeps deuterocanon", () => {
  const h = loadDivision("canonical");
  assert.equal(h.effectiveDivision({ id: "tob", division: "deuterocanon" }), "deuterocanon");
});

test("effectiveDivision: vulgate mode folds deuterocanon into old_testament", () => {
  const h = loadDivision("vulgate");
  assert.equal(h.effectiveDivision({ id: "tob", division: "deuterocanon" }), "old_testament");
});

test("effectiveDivision: vulgate mode preserves non-deuterocanon divisions", () => {
  const h = loadDivision("vulgate");
  assert.equal(h.effectiveDivision({ id: "gen", division: "old_testament" }), "old_testament");
  assert.equal(h.effectiveDivision({ id: "matt", division: "new_testament" }), "new_testament");
});

// 「성서 목록으로」(헤더 집 단추 · 탭 바 홈)의 목적지. 전례시편 · 송가는 구분 탭 어디에도 없어 `/liturgical` 로 가면
// 「해당 성서를 찾을 수 없습니다」가 떴다 — 성서 목록 첫 화면으로 간다(PR #353 리뷰, 2026-10-17).
test("bookListPath: canonical — the book's own division tab", () => {
  const h = loadDivision("canonical");
  assert.equal(h.bookListPath({ id: "john", division: "new_testament" }), "/new_testament");
  assert.equal(h.bookListPath({ id: "tob", division: "deuterocanon" }), "/deuterocanon");
});

test("bookListPath: vulgate — deuterocanon folds into the old_testament tab", () => {
  const h = loadDivision("vulgate");
  assert.equal(h.bookListPath({ id: "tob", division: "deuterocanon" }), "/old_testament");
});

test("bookListPath: a book in no tab (전례시편 · 송가) → the list's first screen, not /liturgical", () => {
  for (const order of ["canonical", "vulgate"]) {
    const h = loadDivision(order);
    assert.equal(h.bookListPath({ id: "lps", division: "liturgical" }), "/", order);
    assert.equal(h.bookListPath({ id: "cant", division: "liturgical" }), "/", order);
  }
});

// (DIVISION_LABELS / DIVISION_ORDER constants are not exposed on globalThis
// — `const` at script top-level binds in script scope, not on the vm
// context object. The contents are exercised indirectly via the
// divisionLabels()/divisionOrder() canonical-mode tests above.)

// ── TITLE ────────────────────────────────────────────────────────────────────

test("setTitle: simple text — clears $title, appends text node, calls announce", () => {
  const h = loadTitle();
  h.setTitle("창세기 1장");
  // $title now has one child (a text node)
  assert.equal(h.$title.children.length, 1);
  assert.equal(h.$title.children[0].nodeType, 3);
  assert.equal(h.$title.children[0].data, "창세기 1장");
  // announce was called with the same text
  assert.deepEqual(h.announceCalls, ["창세기 1장"]);
});

test("setTitle: '공동번역성서' alone leaves document.title without suffix", () => {
  const h = loadTitle();
  h.setTitle("공동번역성서");
  assert.equal(h.document.title, "공동번역성서");
});

test("setTitle: any other text gets ' — 공동번역성서' suffix", () => {
  const h = loadTitle();
  h.setTitle("창세기");
  assert.equal(h.document.title, "창세기 — 공동번역성서");
});

test("setTitle: clears prior $title content before appending", () => {
  const h = loadTitle();
  h.setTitle("첫 호출");
  assert.equal(h.$title.children.length, 1);
  h.setTitle("두 번째 호출");
  // Should still be one child (cleared then re-appended), with the new text
  assert.equal(h.$title.children.length, 1);
  assert.equal(h.$title.children[0].data, "두 번째 호출");
});

// ── DIVISION_TABS ────────────────────────────────────────────────────────────

test("buildDivisionTabs: canonical → 3 tab anchors in order with labels", () => {
  const h = loadDivisionTabs();
  const nav = h.buildDivisionTabs("old_testament");
  assert.equal(nav.tagName, "NAV");
  assert.equal(nav.className, "division-tabs");
  assert.equal(nav.getAttribute("aria-label"), "구분");
  // First child is the sliding indicator; the rest are the tab anchors.
  const [indicator, ...tabs] = nav.children;
  assert.equal(indicator.className, "division-tab-indicator");
  assert.equal(tabs.length, 3);
  assert.deepEqual(tabs.map((a) => a.textContent), ["구약", "외경", "신약"]);
  assert.deepEqual(
    tabs.map((a) => a.getAttribute("href")),
    ["/old_testament", "/deuterocanon", "/new_testament"]
  );
  for (const a of tabs) assert.equal(a.tagName, "A");
});

test("buildDivisionTabs: vulgate → 2 tabs, 외경 dropped", () => {
  const h = loadDivisionTabs(["old_testament", "new_testament"]);
  const nav = h.buildDivisionTabs("old_testament");
  const tabs = nav.children.filter((c) => c.tagName === "A");
  assert.equal(tabs.length, 2);
  assert.deepEqual(tabs.map((a) => a.textContent), ["구약", "신약"]);
});

test("buildDivisionTabs: marks the active tab with class + aria-current", () => {
  const h = loadDivisionTabs();
  const nav = h.buildDivisionTabs("new_testament");
  const [ot, dc, nt] = nav.children.filter((c) => c.tagName === "A");
  assert.equal(ot.className, "division-tab");
  assert.equal(dc.className, "division-tab");
  assert.equal(nt.className, "division-tab active");
  assert.equal(nt.getAttribute("aria-current"), "page");
  assert.equal(ot.getAttribute("aria-current"), null);
});

test("buildDivisionTabs: each tab carries a focus key — route() clears the slot, the router puts focus back on the pressed tab", () => {
  const h = loadDivisionTabs();
  const tabs = h.buildDivisionTabs("old_testament").children.filter((c) => c.tagName === "A");
  assert.deepEqual(tabs.map((a) => a.getAttribute("data-focus-key")), ["div:old_testament", "div:deuterocanon", "div:new_testament"]);
});

test("buildSegmentTabs: an item's focusKey becomes the anchor's data-focus-key — the redrawing view puts focus back on it", () => {
  const h = loadDivisionTabs();
  const nav = h.buildSegmentTabs([
    { label: "본기도 1", href: "/lectionary/2026-04-05", active: true, focusKey: "collect:1" },
    { label: "본기도 2", href: "/lectionary/2026-04-05?collect=2", active: false, focusKey: "collect:2" },
    { label: "키 없음", href: "/x", active: false },
  ], { ariaLabel: "본기도 대체안" });
  const tabs = nav.children.filter((c) => c.tagName === "A");
  assert.deepEqual(tabs.map((a) => a.getAttribute("data-focus-key")), ["collect:1", "collect:2", null]);
});

// ── Richer DOM stub for POPOVER + COMPACT_HEADER ─────────────────────────────
// The popover/compact-header functions need a richer surface than the basic
// makeDom() above: addEventListener, hidden, classList, focus(), contains(),
// querySelector. Kept separate from makeDom() so the simpler TITLE/BREADCRUMB
// tests keep their lighter stub.

function makeRichDom() {
  let activeElement = null;
  const docListeners = new Map();
  let documentTitle = "";

  class RichElement {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this._textOverride = null;
      this._listeners = new Map();
      this._classNames = new Set();
      this._hidden = false;
      this.parentNode = null;
    }
    appendChild(c) {
      this.children.push(c);
      if (c) c.parentNode = this;
      return c;
    }
    insertBefore(c, ref) {
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx >= 0) this.children.splice(idx, 0, c);
      else this.children.push(c);
      if (c) c.parentNode = this;
      return c;
    }
    removeChild(c) {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
      if (c) c.parentNode = null;
      return c;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }
    removeAttribute(k) { delete this.attributes[k]; }
    set className(v) {
      const s = String(v);
      this.attributes.class = s;
      this._classNames = new Set(s.split(/\s+/).filter(Boolean));
    }
    get className() { return this.attributes.class || ""; }
    set textContent(v) {
      this.children = [];
      this._textOverride = String(v);
    }
    get textContent() {
      if (this._textOverride !== null) return this._textOverride;
      return this.children.map((c) => c?.textContent ?? c?.data ?? "").join("");
    }
    set hidden(v) { this._hidden = !!v; }
    get hidden() { return this._hidden; }
    get classList() {
      const set = this._classNames;
      const self = this;
      return {
        add: (c) => { set.add(c); self.attributes.class = [...set].join(" "); },
        remove: (c) => { set.delete(c); self.attributes.class = [...set].join(" "); },
        contains: (c) => set.has(c),
      };
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const arr = this._listeners.get(type);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    /** Test-only dispatch */
    _dispatch(type, evt) {
      const arr = this._listeners.get(type);
      if (!arr) return;
      for (const fn of [...arr]) fn(evt);
    }
    focus() { activeElement = this; }
    contains(node) {
      let n = node;
      while (n) {
        if (n === this) return true;
        n = n.parentNode;
      }
      return false;
    }
    closest(selector) {
      const classes = String(selector).trim().replace(/^\./, "").split(".");
      let n = this;
      while (n) {
        if (n._classNames && classes.every((c) => n._classNames.has(c))) return n;
        n = n.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const sel = String(selector).trim();
      const matches = (el) => {
        if (sel === "a[href]") return el.tagName === "A" && Object.prototype.hasOwnProperty.call(el.attributes, "href");
        // Class selector(s), e.g. ".popover-item.current" — element must carry all.
        if (sel.startsWith(".")) {
          return sel.slice(1).split(".").every((c) => el._classNames?.has(c));
        }
        return false;
      };
      const out = [];
      const walk = (node) => {
        if (!node || !node.children) return;
        for (const c of node.children) {
          if (c?.tagName) {
            if (matches(c)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  const document = {
    createElement: (tag) => new RichElement(tag),
    createTextNode: (text) => ({ nodeType: 3, data: String(text), textContent: String(text), parentNode: null }),
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => {
      docListeners.get(type)?.delete(fn);
    },
    _dispatch: (type, evt) => {
      const set = docListeners.get(type);
      if (set) for (const fn of [...set]) fn(evt);
    },
    get title() { return documentTitle; },
    set title(v) { documentTitle = v; },
  };

  return {
    document,
    RichElement,
    getActive: () => activeElement,
    setActive: (el) => { activeElement = el; },
  };
}

// ── POPOVER loader ───────────────────────────────────────────────────────────
// Provides shims for el / clearNode / chUnit / trapFocus + stubs for
// announce, divisionLabels/divisionOrder, buildHomeBtn /
// buildBookmarkHeaderBtn. Loads only the POPOVER block.

function loadPopover() {
  const dom = makeRichDom();
  const $title = new dom.RichElement("h1");
  $title.setAttribute("id", "page-title");
  const announceCalls = [];
  const trapFocusCalls = [];
  const trapFocusCleanups = [];

  // Markers for `t instanceof Node` / `t instanceof Element` checks inside
  // the production code. Using Symbol.hasInstance lets cross-realm
  // RichElement instances pass these checks based on duck-typed shape.
  const NodeMarker = function () {};
  Object.defineProperty(NodeMarker, Symbol.hasInstance, {
    value: (o) => !!o && typeof o.nodeType === "number",
  });
  const ElementMarker = function () {};
  Object.defineProperty(ElementMarker, Symbol.hasInstance, {
    value: (o) => !!o && typeof o.tagName === "string",
  });

  const ctx = {
    Object, Array, String, Number, Boolean, JSON, console, Error,
    Node: NodeMarker, Element: ElementMarker,
    document: dom.document, $title,
    announce: (msg) => { announceCalls.push(msg); },
    chUnit: (bookId) => bookId === "ps" ? "편" : "장",
    divisionLabels: () => ({
      old_testament: "구약",
      deuterocanon: "외경",
      new_testament: "신약",
    }),
    divisionOrder: () => ["old_testament", "deuterocanon", "new_testament"],
    trapFocus: (container) => {
      trapFocusCalls.push(container);
      const cleanup = () => { trapFocusCleanups.push(container); };
      return cleanup;
    },
    buildHomeBtn: (target, label) => {
      const a = new dom.RichElement("a");
      a.setAttribute("href", target);
      a.textContent = label;
      return a;
    },
    // 「성서 목록으로」 destination — the rule itself is the DIVISION block's (tested there); here only that the
    // home button takes it.
    bookListPath: (b) => `/list-for-${b.id}`,
    buildBookmarkHeaderBtn: (_bookId, _chapter) => {
      return new dom.RichElement("button");
    },
    // setTitleWithChapterPicker reads from this map to emit the mobile-shortened
    // span; tests don't care about the swap mechanics, so an empty map means
    // every book takes the plain-text branch.
    NT_MOBILE_NAME: {},
    // applyTitleCompactness measures rendered geometry; in this DOM stub
    // there's no real layout, so it's a no-op for popover tests.
    applyTitleCompactness: () => {},
    // The chapter popover drives the shared overlay controller (ADR-032); run
    // rAF synchronously so the controller's outside-click listener + initial
    // focus land within the synchronous _dispatch flow these tests use.
    requestAnimationFrame: (cb) => { cb(); return 0; },
  };
  vm.createContext(ctx);
  // Load the REAL overlay controller into this context so the popover tests
  // exercise the production open/close lifecycle. trapFocus is the recording
  // stub above (so existing call-count assertions still hold); setInert is a
  // no-op (the chapter popover passes no inertSelectors).
  ctx.window = ctx;
  ctx.appHelpers = { setInert: () => {}, trapFocus: ctx.trapFocus };
  vm.runInContext(OVERLAY_SOURCE, ctx, { filename: "overlay.js" });
  ctx.createOverlay = ctx.appOverlay.createOverlay;
  vm.runInContext(EL_SHIM + extractBlock("POPOVER"), ctx, {
    filename: "views-popover.js",
  });
  return {
    ctx, dom, $title,
    announceCalls, trapFocusCalls, trapFocusCleanups,
    setTitleWithChapterPicker: ctx.setTitleWithChapterPicker,
  };
}

// ── COMPACT_HEADER loader ────────────────────────────────────────────────────

function loadCompactHeader() {
  const dom = makeRichDom();
  const $header = new dom.RichElement("header");
  $header.setAttribute("id", "app-header");

  const scrollListeners = [];
  const windowStub = {
    scrollY: 0,
    addEventListener: (type, fn, opts) => {
      if (type === "scroll") scrollListeners.push({ fn, opts });
    },
  };

  const ctx = {
    Object, Array, String, Number, Boolean, JSON, console, Error,
    window: windowStub,
    _$: (id) => id === "app-header" ? $header : null,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("COMPACT_HEADER"), ctx, {
    filename: "views-compact-header.js",
  });
  return {
    ctx, dom, $header,
    windowStub,
    scrollListeners,
    initCompactHeader: ctx.initCompactHeader,
    /** Test-only: simulate a scroll event firing all registered listeners. */
    fireScroll: (y) => {
      windowStub.scrollY = y;
      for (const l of scrollListeners) l.fn({});
    },
  };
}

// ── POPOVER tests ────────────────────────────────────────────────────────────

test("setTitleWithChapterPicker: appends home btn + picker btn + popover + bookmark btn", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 50, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 3);
  // children: homeBtn, btn, popover, bookmarkBtn — 4 entries
  assert.equal(h.$title.children.length, 4);
  assert.equal(h.$title.children[0].tagName, "A");      // home btn (stub returns <a>)
  assert.equal(h.$title.children[0].getAttribute("href"), "/list-for-gen"); // → bookListPath(book)
  assert.equal(h.$title.children[1].tagName, "BUTTON"); // picker btn
  assert.equal(h.$title.children[2].tagName, "DIV");    // popover (chapter)
  assert.equal(h.$title.children[3].tagName, "BUTTON"); // bookmark btn
});

test("setTitleWithChapterPicker: psalms uses '편' unit", () => {
  const h = loadPopover();
  const book = { id: "ps", name_ko: "시편", chapter_count: 150, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 23);
  const btn = h.$title.children[1];
  assert.equal(btn.textContent, "시편 23편");
  assert.equal(h.dom.document.title, "시편 23편 — 공동번역성서");
});

test("setTitleWithChapterPicker: non-psalms uses '장' unit", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 50, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  assert.equal(btn.textContent, "창세기 1장");
});

test("setTitleWithChapterPicker: popover grid has chapter_count items", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 5, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 2);
  const popover = h.$title.children[2];
  const grid = popover.children[0];
  assert.equal(grid.children.length, 5);
  // Each is an <a>
  for (let i = 0; i < 5; i++) {
    assert.equal(grid.children[i].tagName, "A");
    assert.equal(grid.children[i].getAttribute("href"), `/gen/${i + 1}`);
  }
});

test("setTitleWithChapterPicker: marks current chapter with 'current' class", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 3, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 2);
  const grid = h.$title.children[2].children[0];
  assert.equal(grid.children[0].className, "popover-item");
  assert.equal(grid.children[1].className, "popover-item current");
  assert.equal(grid.children[2].className, "popover-item");
});

test("setTitleWithChapterPicker: prepends '머리말' link when has_prologue", () => {
  const h = loadPopover();
  const book = { id: "sir", name_ko: "집회서", chapter_count: 51, has_prologue: true, division: "deuterocanon" };
  h.setTitleWithChapterPicker(book, 1);
  const grid = h.$title.children[2].children[0];
  // prologue link first, then 51 chapter links = 52 total
  assert.equal(grid.children.length, 52);
  assert.equal(grid.children[0].textContent, "머리말");
  assert.equal(grid.children[0].getAttribute("href"), "/sir/prologue");
  assert.equal(grid.children[1].getAttribute("href"), "/sir/1");
});

test("setTitleWithChapterPicker: btn click opens popover + traps focus", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 5, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  const popover = h.$title.children[2];
  btn._dispatch("click", {});
  assert.equal(popover.hidden, false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(h.trapFocusCalls.length, 1);
});

test("setTitleWithChapterPicker: opening focuses + marks the current chapter", () => {
  const h = loadPopover();
  const book = { id: "ps", name_ko: "시편", chapter_count: 150, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 100);
  const btn = h.$title.children[1];
  btn._dispatch("click", {});
  const active = h.dom.getActive();
  assert.equal(active.className, "popover-item current");
  assert.equal(active.textContent, "100");
  assert.equal(active.getAttribute("aria-current"), "true");
});

test("setTitleWithChapterPicker: clicking a grid <a> closes popover", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 3, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  const popover = h.$title.children[2];
  btn._dispatch("click", {});
  const link = popover.children[0].children[1]; // chapter 2
  popover._dispatch("click", { target: link });
  assert.equal(popover.hidden, true);
  assert.equal(h.trapFocusCleanups.length, 1);
});

test("setTitleWithChapterPicker: clicking the mobile settings gear closes the chapter popover", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 5, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  const popover = h.$title.children[2];
  btn._dispatch("click", {});  // open chapter popover
  assert.equal(popover.hidden, false);
  // The mobile settings gear lives *inside* $title (appended per-view); a tap on
  // it must still close the chapter popover so the two never overlap.
  const gear = new h.dom.RichElement("button");
  gear.className = "title-settings-btn";
  h.$title.appendChild(gear);
  h.dom.document._dispatch("click", { target: gear });
  assert.equal(popover.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
});

// ── COMPACT_HEADER tests ─────────────────────────────────────────────────────

test("initCompactHeader: registers a passive scroll listener on window", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  assert.equal(h.scrollListeners.length, 1);
  assert.equal(h.scrollListeners[0].opts.passive, true);
});

test("initCompactHeader: scrollY > 60 adds 'compact' to header", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  h.fireScroll(70);
  assert.equal(h.$header.classList.contains("compact"), true);
});

test("initCompactHeader: scrollY < 10 removes 'compact'", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  h.fireScroll(70);
  h.fireScroll(5);
  assert.equal(h.$header.classList.contains("compact"), false);
});

test("initCompactHeader: hysteresis — between 10 and 60, no change", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  // From low: scrollY = 30 should NOT enter compact (only > 60 does)
  h.fireScroll(30);
  assert.equal(h.$header.classList.contains("compact"), false);
  // Now enter compact mode
  h.fireScroll(70);
  assert.equal(h.$header.classList.contains("compact"), true);
  // From high: scrollY = 30 should NOT exit compact (only < 10 does)
  h.fireScroll(30);
  assert.equal(h.$header.classList.contains("compact"), true);
});

test("initCompactHeader: scrollY exactly at threshold (60) does NOT toggle (strict >)", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  h.fireScroll(60);
  assert.equal(h.$header.classList.contains("compact"), false);
  h.fireScroll(61);
  assert.equal(h.$header.classList.contains("compact"), true);
});

test("initCompactHeader: scrollY exactly at threshold (10) does NOT toggle (strict <)", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  h.fireScroll(70);
  h.fireScroll(10);
  assert.equal(h.$header.classList.contains("compact"), true);
  h.fireScroll(9);
  assert.equal(h.$header.classList.contains("compact"), false);
});

test("initCompactHeader: repeated transitions toggle correctly", () => {
  const h = loadCompactHeader();
  h.initCompactHeader();
  for (let i = 0; i < 3; i++) {
    h.fireScroll(80);
    assert.equal(h.$header.classList.contains("compact"), true);
    h.fireScroll(0);
    assert.equal(h.$header.classList.contains("compact"), false);
  }
});

// ── VERSE_SELECTION ──────────────────────────────────────────────────────────

test("_verseSelectionUnit: single-span verse → [key] only", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3/3", false]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3/3"), ["3/3"]);
});

test("_verseSelectionUnit: pure-poetry multi-part → all parts (any entry key)", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3/3a", true], ["3/3b", true], ["3/3c", true]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3/3a"), ["3/3a", "3/3b", "3/3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3/3b"), ["3/3a", "3/3b", "3/3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3/3c"), ["3/3a", "3/3b", "3/3c"]);
});

test("_verseSelectionUnit: 산문 여러 줄 절도 절 전체 — 인용 칩 자리에서 나뉜 줄이다(사용자 결정 2026-10-22, 종전엔 누른 줄만)", () => {
  const h = loadVerseSelection();
  // 마태 10:35 — 산문 두 줄, 문장 중간에서 끊긴다.
  const article = makeArticleStub([["34/34", false], ["35/35a", false], ["35/35b", false], ["36/36", false]]);
  assert.deepEqual(h.verseSelectionUnit(article, "35/35a"), ["35/35a", "35/35b"]);
  assert.deepEqual(h.verseSelectionUnit(article, "35/35b"), ["35/35a", "35/35b"]);
});

test("_verseSelectionUnit: 운문과 산문이 섞인 절도 절 전체(사용자 결정 2026-10-22, 종전엔 누른 줄만)", () => {
  const h = loadVerseSelection();
  // 1고린 15:54 — 산문 줄 다음에 인용 구절(운문).
  const article = makeArticleStub([["54/54a", false], ["54/54b", true], ["55/55a", true]]);
  assert.deepEqual(h.verseSelectionUnit(article, "54/54a"), ["54/54a", "54/54b"]);
  assert.deepEqual(h.verseSelectionUnit(article, "54/54b"), ["54/54a", "54/54b"]);
});

test("_verseSelectionUnit: groups by verse, not contamination across neighboring verses", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([
    ["3/3a", true], ["3/3b", true], ["3/3c", true],
    ["4/4a", true], ["4/4b", true],
  ]);
  assert.deepEqual(h.verseSelectionUnit(article, "3/3a"), ["3/3a", "3/3b", "3/3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "4/4a"), ["4/4a", "4/4b"]);
});

test("_verseSelectionUnit: 번호가 같은 다른 절은 한 단위가 아니다 — 이사 40 의 41:6 · 다니 3 의 그리스어 (26)(known-issues §5)", () => {
  const h = loadVerseSelection();
  const isa = makeArticleStub([
    ["6/6a", true], ["6/6b", true], ["19/19a", true], ["6_c41/6a", true], ["6_c41/6b", true],
  ]);
  assert.deepEqual(h.verseSelectionUnit(isa, "6_c41/6a"), ["6_c41/6a", "6_c41/6b"]);
  assert.deepEqual(h.verseSelectionUnit(isa, "6/6b"), ["6/6a", "6/6b"]);
  // 그리스어 (26) 은 두 줄 운문, 히브리 26(93) 은 산문 한 줄 — 번호로 묶던 때는 둘이 한 단위였다.
  const dan = makeArticleStub([["26_lxx/26a", true], ["26_lxx/26b", true], ["26_93/26", false]]);
  assert.deepEqual(h.verseSelectionUnit(dan, "26_lxx/26b"), ["26_lxx/26a", "26_lxx/26b"]);
  assert.deepEqual(h.verseSelectionUnit(dan, "26_93/26"), ["26_93/26"]);
  // 원본 중복 마커(욥 32:9 등)의 두 절도 따로다.
  const job = makeArticleStub([["9/9a", true], ["9/9b", true], ["9~2/9a", true], ["9~2/9b", true]]);
  assert.deepEqual(h.verseSelectionUnit(job, "9~2/9a"), ["9~2/9a", "9~2/9b"]);
});

test("_verseSelectionUnit: 데이터의 반쪽 절은 따로 고른다(사용자 결정 2026-10-22, 종전엔 운문이면 두 반쪽을 함께) · ¶ 구절은 그 번호 절과 한 단위", () => {
  const h = loadVerseSelection();
  // 이사 7 — 8a · 9a · 8b · 9b 순서.
  const isa7 = makeArticleStub([
    ["8a/8aa", true], ["8a/8ab", true], ["9a/9aa", true], ["9a/9ab", true], ["8b/8ba", true], ["8b/8bb", true],
  ]);
  assert.deepEqual(h.verseSelectionUnit(isa7, "8b/8ba"), ["8b/8ba", "8b/8bb"]);
  assert.deepEqual(h.verseSelectionUnit(isa7, "8a/8ab"), ["8a/8aa", "8a/8ab"]);
  // 1사무 24 — 한 줄짜리 산문 반쪽 절.
  const sam = makeArticleStub([["4/4", false], ["5a/5a", false], ["7/7", false], ["8a/8a", false], ["5b/5b", false]]);
  assert.deepEqual(h.verseSelectionUnit(sam, "5a/5a"), ["5a/5a"]);
  // 전례시편 23 — 4절 다음 ¶ 구절.
  const lps = makeArticleStub([["4/4a", true], ["4/4b", true], ["4_v/4a", true], ["4_v/4b", true], ["5/5a", true]]);
  assert.deepEqual(h.verseSelectionUnit(lps, "4_v/4a"), ["4/4a", "4/4b", "4_v/4a", "4_v/4b"]);
});

test("_verseSelectionUnit: null article → defensive [key]", () => {
  const h = loadVerseSelection();
  assert.deepEqual(h.verseSelectionUnit(null, "3/3a"), ["3/3a"]);
});

test("_verseRangeKeys: forward range is inclusive of both endpoints", () => {
  const h = loadVerseSelection();
  const all = ["1", "2", "3", "4", "5"];
  assert.deepEqual(h.verseRangeKeys(all, "2", "4"), ["2", "3", "4"]);
});

test("_verseRangeKeys: backward range (anchor after target) yields same span", () => {
  const h = loadVerseSelection();
  const all = ["1", "2", "3", "4", "5"];
  assert.deepEqual(h.verseRangeKeys(all, "4", "2"), ["2", "3", "4"]);
});

test("_verseRangeKeys: same anchor and target → that single verse", () => {
  const h = loadVerseSelection();
  const all = ["1", "2", "3"];
  assert.deepEqual(h.verseRangeKeys(all, "2", "2"), ["2"]);
});

test("_verseRangeKeys: unknown endpoint → empty (defensive)", () => {
  const h = loadVerseSelection();
  const all = ["1", "2", "3"];
  assert.deepEqual(h.verseRangeKeys(all, "2", "9"), []);
  assert.deepEqual(h.verseRangeKeys(all, "x", "2"), []);
});

test("_verseRangeKeys: endpoint inside a poetry unit expands to the whole unit", () => {
  const h = loadVerseSelection();
  const all = ["1", "2a", "2b", "2c", "3", "4a", "4b"];
  // target "2b" pulls in 2a/2c; anchor "4a" pulls in 4b.
  const unit = (key) => {
    if (key.startsWith("2")) return ["2a", "2b", "2c"];
    if (key.startsWith("4")) return ["4a", "4b"];
    return [key];
  };
  assert.deepEqual(
    h.verseRangeKeys(all, "4a", "2b", unit),
    ["2a", "2b", "2c", "3", "4a", "4b"],
  );
});

test("_verseRangeKeys: without unitFn, no boundary expansion", () => {
  const h = loadVerseSelection();
  const all = ["1", "2a", "2b", "2c", "3"];
  assert.deepEqual(h.verseRangeKeys(all, "2b", "3"), ["2b", "2c", "3"]);
});

test("_verseRangeKeys: 나훔 1:1 → 2ㄱ — 범위가 9절 뒤의 2ㄴ 까지 늘어나지 않는다(사용자 결정 2026-10-22, 종전 1-9절)", () => {
  const h = loadVerseSelection();
  // 실제 화면의 키(2026-10-22 덤프, 10절까지). 1절만 산문, 7-8 은 일곱 줄인 병합 절이다.
  const poem = (instance, ref, letters) => [...letters].map((l) => [`${instance}/${ref}${l}`, true]);
  const rows = [["1/1", false], ...poem("2a", "2a", "ab"), ...poem("3", "3", "abcde"), ...poem("4", "4", "abcd"),
    ...poem("5", "5", "abcd"), ...poem("6", "6", "abcd"), ...poem("7", "7-8", "abcdefg"), ...poem("9", "9", "abc"),
    ...poem("2b", "2b", "ab"), ...poem("10", "10", "ab")];
  const article = makeArticleStub(rows);
  const all = rows.map(([k]) => k);
  const lines = (instance) => all.filter((k) => k.startsWith(`${instance}/`));
  const unit = (key) => h.verseSelectionUnit(article, key);
  assert.deepEqual(h.verseRangeKeys(all, "1/1", "2a/2ab", unit), ["1/1", ...lines("2a")]);
  assert.deepEqual(h.verseRangeKeys(all, "2b/2ba", "9/9b", unit), [...lines("9"), ...lines("2b")]);
  assert.deepEqual(h.verseRangeKeys(all, "3/3b", "1/1", unit), ["1/1", ...lines("2a"), ...lines("3")]);
  assert.deepEqual(h.verseRangeKeys(all, "6/6d", "7/7-8c", unit), [...lines("6"), ...lines("7")]);
});

test("_verseRangeKeys: 옮겨 실린 41:6 에서 시작한 범위는 그 자리에서 시작한다 — 번호로는 앞의 40:6 에서 시작했다", () => {
  const h = loadVerseSelection();
  const all = ["6/6a", "6/6b", "19/19a", "6_c41/6a", "6_c41/6b", "20/20a"];
  assert.deepEqual(h.verseRangeKeys(all, "6_c41/6a", "20/20a"), ["6_c41/6a", "6_c41/6b", "20/20a"]);
});

// ── VERSE_NUMBER ─────────────────────────────────────────────────────────────

test("formatVerseNumber: plain verse → bare number", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 24 }), "24");
});

test("formatVerseNumber: dual manuscript numbering [N_M] → N(M)", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 24, alt_ref: 91 }), "24(91)");
});

test("formatVerseNumber: LXX-only verse [_N] → (N) in parens", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 24, lxx_only: true }), "(24)");
});

test("formatVerseNumber: cross-chapter ref → chapter:number prefix", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 6, chapter_ref: 41 }), "41:6");
});

test("formatVerseNumber: verse range → start-end", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 17, range_end: 18 }), "17-18");
});

test("formatVerseNumber: 데이터의 반쪽 절은 인쇄본대로 「2ㄱ」 「2ㄴ」(사용자 결정 2026-10-22, 종전 「2a」)", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 2, part: "a" }), "2ㄱ");
  assert.equal(formatVerseNumber({ number: 2, part: "b" }), "2ㄴ");
});
