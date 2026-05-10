// ── Unit tests for js/app/views-routing.js ──────────────────────────────────
// Run with: node --test tests/unit/views-routing.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark.test.js. Six marker
// pairs cover the testable surface; Pull-to-refresh / startScrollTracking /
// Audio Player remain out of scope — those need touch gestures or
// `getBoundingClientRect` and are deferred until jsdom adoption (ADR-013
// dual-track, 2026-05-11).
//
// Coverage:
//   - DATA_FETCHING block — loadBooks / loadVersion / loadChapter /
//     loadPrologue. fetch + window stubs.
//   - TITLE block — setTitle. $title + clearNode + el + announce stubs.
//   - BREADCRUMB block — setBreadcrumb + buildDivisionBreadcrumb.
//     $breadcrumb + el stubs.
//   - DIVISION block — divisionLabels / divisionOrder / effectiveDivision +
//     constants. loadBookOrder stub.
//   - POPOVER block — setTitleWithDivisionPicker / setTitleWithChapterPicker.
//     Open/close contract + focus trap + click-outside-to-close +
//     click-on-link-to-close. Richer DOM stub with addEventListener +
//     classList + hidden + querySelector + contains.
//   - COMPACT_HEADER block — initCompactHeader. Hysteretic 60px / 10px
//     scroll-based class toggle. Window scroll listener stub.

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
    querySelectorAll(selector) {
      const sel = String(selector).trim();
      const matches = (el) => {
        if (sel === "a[href]") return el.tagName === "A" && Object.prototype.hasOwnProperty.call(el.attributes, "href");
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
// announce, divisionLabels/divisionOrder, buildBackBtn /
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
    buildBackBtn: (label, href) => {
      const a = new dom.RichElement("a");
      a.setAttribute("href", href);
      a.textContent = label;
      return a;
    },
    buildBookmarkHeaderBtn: (_bookId, _chapter) => {
      return new dom.RichElement("button");
    },
  };
  vm.createContext(ctx);
  vm.runInContext(EL_SHIM + extractBlock("POPOVER"), ctx, {
    filename: "views-routing-popover.js",
  });
  return {
    ctx, dom, $title,
    announceCalls, trapFocusCalls, trapFocusCleanups,
    setTitleWithDivisionPicker: ctx.setTitleWithDivisionPicker,
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
    filename: "views-routing-compact-header.js",
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

test("setTitleWithDivisionPicker: appends btn + popover to $title", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  assert.equal(h.$title.children.length, 2);
  const [btn, popover] = h.$title.children;
  assert.equal(btn.tagName, "BUTTON");
  assert.equal(popover.tagName, "UL");
});

test("setTitleWithDivisionPicker: btn label = active division label", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("new_testament");
  const btn = h.$title.children[0];
  assert.equal(btn.textContent, "신약");
});

test("setTitleWithDivisionPicker: starts with popover hidden + aria-expanded=false", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  assert.equal(popover.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
});

test("setTitleWithDivisionPicker: popover lists all divisions in order", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const popover = h.$title.children[1];
  // popover > li > a structure
  assert.equal(popover.children.length, 3, "3 divisions in canonical order");
  const labels = popover.children.map((li) => li.children[0].textContent);
  assert.deepEqual(labels, ["구약", "외경", "신약"]);
});

test("setTitleWithDivisionPicker: marks active division with 'active' class", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("deuterocanon");
  const popover = h.$title.children[1];
  const anchors = popover.children.map((li) => li.children[0]);
  const classes = anchors.map((a) => a.className);
  assert.equal(classes[0], "bc-division-item");
  assert.equal(classes[1], "bc-division-item active");
  assert.equal(classes[2], "bc-division-item");
});

test("setTitleWithDivisionPicker: calls announce + sets document.title", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  assert.deepEqual(h.announceCalls, ["구약"]);
  assert.equal(h.dom.document.title, "구약 — 공동번역성서");
});

test("setTitleWithDivisionPicker: btn click opens popover + traps focus + focuses first link", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  btn._dispatch("click", {});
  assert.equal(popover.hidden, false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(h.trapFocusCalls.length, 1);
  assert.equal(h.trapFocusCalls[0], popover);
  // First <a> focused
  const firstLink = popover.children[0].children[0];
  assert.equal(h.dom.getActive(), firstLink);
});

test("setTitleWithDivisionPicker: btn click again closes popover + cleans up trap", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  btn._dispatch("click", {});  // open
  btn._dispatch("click", {});  // close
  assert.equal(popover.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(h.trapFocusCleanups.length, 1);
});

test("setTitleWithDivisionPicker: document click outside $title closes popover", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  btn._dispatch("click", {});  // open
  // outside element
  const outside = new h.dom.RichElement("div");
  h.dom.document._dispatch("click", { target: outside });
  assert.equal(popover.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(h.trapFocusCleanups.length, 1);
});

test("setTitleWithDivisionPicker: document click inside $title does NOT close popover", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  btn._dispatch("click", {});  // open
  // click on btn itself (which is inside $title)
  h.dom.document._dispatch("click", { target: btn });
  assert.equal(popover.hidden, false, "popover stays open");
});

test("setTitleWithDivisionPicker: clicking a popover <a> closes the popover", () => {
  const h = loadPopover();
  h.setTitleWithDivisionPicker("old_testament");
  const [btn, popover] = h.$title.children;
  btn._dispatch("click", {});  // open
  const link = popover.children[0].children[0];
  popover._dispatch("click", { target: link });
  assert.equal(popover.hidden, true);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(h.trapFocusCleanups.length, 1);
});

test("setTitleWithChapterPicker: appends back btn + picker btn + popover + bookmark btn", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 50, has_prologue: false };
  h.setTitleWithChapterPicker(book, 3);
  // children: backBtn, btn, popover, bookmarkBtn — 4 entries
  assert.equal(h.$title.children.length, 4);
  assert.equal(h.$title.children[0].tagName, "A");      // back btn (stub returns <a>)
  assert.equal(h.$title.children[1].tagName, "BUTTON"); // picker btn
  assert.equal(h.$title.children[2].tagName, "DIV");    // popover (chapter)
  assert.equal(h.$title.children[3].tagName, "BUTTON"); // bookmark btn
});

test("setTitleWithChapterPicker: psalms uses '편' unit", () => {
  const h = loadPopover();
  const book = { id: "ps", name_ko: "시편", chapter_count: 150, has_prologue: false };
  h.setTitleWithChapterPicker(book, 23);
  const btn = h.$title.children[1];
  assert.equal(btn.textContent, "시편 23편");
  assert.equal(h.dom.document.title, "시편 23편 — 공동번역성서");
});

test("setTitleWithChapterPicker: non-psalms uses '장' unit", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 50, has_prologue: false };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  assert.equal(btn.textContent, "창세기 1장");
});

test("setTitleWithChapterPicker: popover grid has chapter_count items", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 5, has_prologue: false };
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
  const book = { id: "gen", name_ko: "창세기", chapter_count: 3, has_prologue: false };
  h.setTitleWithChapterPicker(book, 2);
  const grid = h.$title.children[2].children[0];
  assert.equal(grid.children[0].className, "popover-item");
  assert.equal(grid.children[1].className, "popover-item current");
  assert.equal(grid.children[2].className, "popover-item");
});

test("setTitleWithChapterPicker: prepends '머리말' link when has_prologue", () => {
  const h = loadPopover();
  const book = { id: "sir", name_ko: "집회서", chapter_count: 51, has_prologue: true };
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
  const book = { id: "gen", name_ko: "창세기", chapter_count: 5, has_prologue: false };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  const popover = h.$title.children[2];
  btn._dispatch("click", {});
  assert.equal(popover.hidden, false);
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(h.trapFocusCalls.length, 1);
});

test("setTitleWithChapterPicker: clicking a grid <a> closes popover", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 3, has_prologue: false };
  h.setTitleWithChapterPicker(book, 1);
  const btn = h.$title.children[1];
  const popover = h.$title.children[2];
  btn._dispatch("click", {});
  const link = popover.children[0].children[1]; // chapter 2
  popover._dispatch("click", { target: link });
  assert.equal(popover.hidden, true);
  assert.equal(h.trapFocusCleanups.length, 1);
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
