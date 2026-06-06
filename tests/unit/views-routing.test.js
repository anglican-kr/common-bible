// ── Unit tests for js/app/views-routing.js ──────────────────────────────────
// Run with: node --test tests/unit/views-routing.test.js
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
//   - DIVISION block — divisionLabels / divisionOrder / effectiveDivision +
//     constants. loadBookOrder stub.
//   - DIVISION_TABS block — buildDivisionTabs. Tab anchors per book-order
//     setting + active-tab marking. el + divisionLabels/divisionOrder stubs.
//   - POPOVER block — setTitleWithChapterPicker. Open/close contract + focus
//     trap + click-outside-to-close + click-on-link-to-close. Richer DOM stub
//     with addEventListener + classList + hidden + querySelector + contains.
//   - COMPACT_HEADER block — initCompactHeader. Hysteretic 60px / 10px
//     scroll-based class toggle. Window scroll listener stub.
//   - VERSE_SELECTION block — _verseSelectionUnit. Pure-poetry multi-part
//     grouping vs per-line selection control.
//   - VERSE_NUMBER block — formatVerseNumber. Verse-number display string:
//     plain / dual [N_M] / LXX-only [_N] / cross-ref / range / part.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_PATH = path.resolve(__dirname, "../../js/app/views-routing.js");
const VIEWS_SOURCE = fs.readFileSync(VIEWS_PATH, "utf8");
// The chapter popover drives the shared overlay controller (ADR-032). The
// POPOVER loader injects the REAL overlay.js so its open/close lifecycle runs
// against the test DOM stub. Strip the trailing `export {};` ESM marker.
const OVERLAY_PATH = path.resolve(__dirname, "../../js/app/overlay.js");
const OVERLAY_SOURCE = fs.readFileSync(OVERLAY_PATH, "utf8")
  .replace(/\nexport\s*\{\s*\}\s*;?\s*$/, "");

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
    filename: "views-routing-title.js",
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
    filename: "views-routing-division-tabs.js",
  });
  return {
    ctx,
    buildDivisionTabs: ctx.buildDivisionTabs,
  };
}

// ── VERSE_SELECTION loader ───────────────────────────────────────────────────
// DOM-pure helper that reads classList + data-vref off a passed article node.
// Mini article stub returns the supplied verse spans for querySelectorAll
// (".verse[data-vref]"); per-span classList.contains is a one-class check.

function loadVerseSelection() {
  const ctx = { Object, Array, String, Number, Boolean, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SELECTION"), ctx, {
    filename: "views-routing-verse-selection.js",
  });
  return { ctx, verseSelectionUnit: ctx._verseSelectionUnit };
}

/** @param {Array<[string, boolean]>} verses [vref, isPoetry] tuples */
function makeArticleStub(verses) {
  const elements = verses.map(([vref, isPoetry]) => ({
    getAttribute: (k) => (k === "data-vref" ? vref : null),
    classList: { contains: (cls) => isPoetry && cls === "verse-poetry" },
  }));
  return {
    querySelectorAll: (sel) => (sel === ".verse[data-vref]" ? elements : []),
  };
}

// ── VERSE_NUMBER loader ──────────────────────────────────────────────────────
// Pure verse-number formatting. No DOM, no globals.

function loadVerseNumber() {
  const ctx = { Object, Array, String, Number, Boolean, console, Error };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_NUMBER"), ctx, {
    filename: "views-routing-verse-number.js",
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
    buildHomeBtn: (target, label) => {
      const a = new dom.RichElement("a");
      a.setAttribute("href", target);
      a.textContent = label;
      return a;
    },
    effectiveDivision: (b) => b.division,
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
    filename: "views-routing-popover.js",
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

test("setTitleWithChapterPicker: appends home btn + picker btn + popover + bookmark btn", () => {
  const h = loadPopover();
  const book = { id: "gen", name_ko: "창세기", chapter_count: 50, has_prologue: false, division: "old_testament" };
  h.setTitleWithChapterPicker(book, 3);
  // children: homeBtn, btn, popover, bookmarkBtn — 4 entries
  assert.equal(h.$title.children.length, 4);
  assert.equal(h.$title.children[0].tagName, "A");      // home btn (stub returns <a>)
  assert.equal(h.$title.children[0].getAttribute("href"), "/old_testament"); // → book's division tab
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

test("_verseSelectionUnit: single-span verse → [vref] only", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3", false]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3"), ["3"]);
});

test("_verseSelectionUnit: pure-poetry multi-part → all parts (any entry vref)", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3a", true], ["3b", true], ["3c", true]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3a"), ["3a", "3b", "3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3b"), ["3a", "3b", "3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3c"), ["3a", "3b", "3c"]);
});

test("_verseSelectionUnit: pure-prose multi-part → just [vref]", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3a", false], ["3b", false]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3a"), ["3a"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3b"), ["3b"]);
});

test("_verseSelectionUnit: mixed poetry+prose multi-part → just [vref]", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([["3a", true], ["3b", false]]);
  assert.deepEqual(h.verseSelectionUnit(article, "3a"), ["3a"]);
  assert.deepEqual(h.verseSelectionUnit(article, "3b"), ["3b"]);
});

test("_verseSelectionUnit: groups by integer prefix, not contamination across neighboring verses", () => {
  const h = loadVerseSelection();
  const article = makeArticleStub([
    ["3a", true], ["3b", true], ["3c", true],
    ["4a", true], ["4b", true],
  ]);
  assert.deepEqual(h.verseSelectionUnit(article, "3a"), ["3a", "3b", "3c"]);
  assert.deepEqual(h.verseSelectionUnit(article, "4a"), ["4a", "4b"]);
});

test("_verseSelectionUnit: null article → defensive [vref]", () => {
  const h = loadVerseSelection();
  assert.deepEqual(h.verseSelectionUnit(null, "3a"), ["3a"]);
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

test("formatVerseNumber: split-verse part → number + part letter", () => {
  const { formatVerseNumber } = loadVerseNumber();
  assert.equal(formatVerseNumber({ number: 2, part: "a" }), "2a");
});
