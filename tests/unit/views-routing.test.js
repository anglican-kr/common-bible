// ── Unit tests for js/app/views-routing.js ──────────────────────────────────
// Run with: node --test tests/unit/views-routing.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark.test.js. Four
// marker pairs cover the testable surface; setTitleWithDivisionPicker /
// setTitleWithChapterPicker / Pull-to-refresh / initCompactHeader are
// excluded — heavy DOM popovers + listener setup not worth jsdom yet.
//
// Coverage:
//   - DATA_FETCHING block — loadBooks / loadVersion / loadChapter /
//     loadPrologue. fetch + window stubs.
//   - TITLE block — setTitle. $title + clearNode + el + announce stubs.
//   - BREADCRUMB block — setBreadcrumb + buildDivisionBreadcrumb.
//     $breadcrumb + el stubs.
//   - DIVISION block — divisionLabels / divisionOrder / effectiveDivision +
//     constants. loadBookOrder stub.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_PATH = path.resolve(__dirname, "../../js/app/views-routing.js");
const VIEWS_SOURCE = fs.readFileSync(VIEWS_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = VIEWS_SOURCE.indexOf(begin);
  const endIdx = VIEWS_SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/views-routing.js`);
  }
  return VIEWS_SOURCE.slice(startIdx, endIdx + end.length);
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
  vm.runInContext(prelude + extractBlock("DATA_FETCHING"), ctx, {
    filename: "views-routing-data-fetching.js",
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
    filename: "views-routing-division.js",
  });
  return {
    ctx,
    setBookOrder: (v) => { bookOrder = v; },
    divisionLabels: ctx.divisionLabels,
    divisionOrder: ctx.divisionOrder,
    effectiveDivision: ctx.effectiveDivision,
    DIVISION_LABELS: ctx.DIVISION_LABELS,
    DIVISION_ORDER: ctx.DIVISION_ORDER,
  };
}

// ── Minimal DOM stub (shared by TITLE + BREADCRUMB) ──────────────────────────
// Same shape as search.test.js / bookmark.test.js Element stubs but pared to
// what setTitle / setBreadcrumb / buildDivisionBreadcrumb actually use.

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
    }
    appendChild(c) { this.children.push(c); return c; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }
    set className(v) { this.attributes.class = String(v); }
    get className() { return this.attributes.class || ""; }
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
    filename: "views-routing-title.js",
  });
  return {
    ctx, document, $title, announceCalls,
    setTitle: ctx.setTitle,
  };
}

// ── BREADCRUMB loader ────────────────────────────────────────────────────────

function loadBreadcrumb() {
  const { document, StubElement } = makeDom();
  const $breadcrumb = new StubElement("nav");
  $breadcrumb.id = "breadcrumb";
  const ctx = {
    Object, Array, String, Number, Boolean, JSON, console, Error,
    document, $breadcrumb,
  };
  vm.createContext(ctx);
  vm.runInContext(EL_SHIM + extractBlock("BREADCRUMB"), ctx, {
    filename: "views-routing-breadcrumb.js",
  });
  return {
    ctx, $breadcrumb,
    setBreadcrumb: ctx.setBreadcrumb,
    buildDivisionBreadcrumb: ctx.buildDivisionBreadcrumb,
  };
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

// ── BREADCRUMB ───────────────────────────────────────────────────────────────

test("setBreadcrumb: empty crumbs → empty $breadcrumb", () => {
  const h = loadBreadcrumb();
  h.setBreadcrumb([]);
  assert.equal(h.$breadcrumb.children.length, 0);
});

test("setBreadcrumb: single crumb with href → one <a>", () => {
  const h = loadBreadcrumb();
  h.setBreadcrumb([{ label: "목록", href: "/" }]);
  assert.equal(h.$breadcrumb.children.length, 1);
  const a = h.$breadcrumb.children[0];
  assert.equal(a.tagName, "A");
  assert.equal(a.getAttribute("href"), "/");
  assert.equal(a.textContent, "목록");
});

test("setBreadcrumb: single crumb without href → <span>", () => {
  const h = loadBreadcrumb();
  h.setBreadcrumb([{ label: "현재" }]);
  assert.equal(h.$breadcrumb.children.length, 1);
  const span = h.$breadcrumb.children[0];
  assert.equal(span.tagName, "SPAN");
  assert.equal(span.textContent, "현재");
});

test("setBreadcrumb: multiple crumbs interleaved with separator spans", () => {
  const h = loadBreadcrumb();
  h.setBreadcrumb([
    { label: "목록", href: "/" },
    { label: "구약", href: "/old_testament" },
    { label: "창세기" },
  ]);
  // 3 crumbs + 2 separators = 5 children
  assert.equal(h.$breadcrumb.children.length, 5);
  assert.equal(h.$breadcrumb.children[0].tagName, "A");
  assert.equal(h.$breadcrumb.children[1].tagName, "SPAN");
  assert.equal(h.$breadcrumb.children[1].className, "sep");
  assert.equal(h.$breadcrumb.children[1].getAttribute("aria-hidden"), "true");
  assert.equal(h.$breadcrumb.children[2].tagName, "A");
  assert.equal(h.$breadcrumb.children[3].tagName, "SPAN");
  assert.equal(h.$breadcrumb.children[3].className, "sep");
  assert.equal(h.$breadcrumb.children[4].tagName, "SPAN");
});

test("setBreadcrumb: divisionPicker crumb → buildDivisionBreadcrumb output", () => {
  const h = loadBreadcrumb();
  h.setBreadcrumb([{ label: "구약", divisionPicker: true, activeDivision: "old_testament" }]);
  assert.equal(h.$breadcrumb.children.length, 1);
  const a = h.$breadcrumb.children[0];
  assert.equal(a.tagName, "A");
  assert.equal(a.getAttribute("href"), "/old_testament");
  assert.equal(a.textContent, "구약");
});

test("buildDivisionBreadcrumb: returns <a href='/${activeDivision}'>label</a>", () => {
  const h = loadBreadcrumb();
  const a = h.buildDivisionBreadcrumb("신약", "new_testament");
  assert.equal(a.tagName, "A");
  assert.equal(a.getAttribute("href"), "/new_testament");
  assert.equal(a.textContent, "신약");
});
