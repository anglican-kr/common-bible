// ── Unit tests for js/app/search.js ──────────────────────────────────────────
// Run with: node --test tests/unit/search.test.js
//
// search.js is heavily DOM- and Worker-bound at module top level
// (createSearchHistoryController calls + sheet event listeners), so loading
// the whole file in vm requires extensive Element/anchor stubs. We instead
// extract testable blocks via BEGIN/END markers (mirrors the
// search-history.test.js pattern for js/app/storage.js) and run them in
// vm contexts with the minimal stubs each block needs.
//
// Coverage:
//   - WORKER block (ensureSearchWorker/doSearch + state) — Worker stub
//   - PURE HELPERS block (appendTextWithHighlight/buildSnippet/
//     buildSearchPagination) — minimal Element + el shim
//   - IS_MOBILE block — window.matchMedia stub
//   - AUTO_NAVIGATE block (consumeSearchAutoNavigate) — pure state

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_PATH = path.resolve(__dirname, "../../js/app/search.js");
const SEARCH_SOURCE = fs.readFileSync(SEARCH_PATH, "utf8");

function extractBlock(name) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = SEARCH_SOURCE.indexOf(begin);
  const endIdx = SEARCH_SOURCE.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in js/app/search.js`);
  }
  return SEARCH_SOURCE.slice(startIdx, endIdx + end.length);
}

// ── Minimal DOM stub ─────────────────────────────────────────────────────────
// Just enough surface for `el` (helpers.js implementation): createElement,
// setAttribute, appendChild, createTextNode, createDocumentFragment, plus
// textContent / className / hidden / dataset / style / classList / id /
// firstChild for assertions and downstream code.

function makeDom() {
  function makeClassList(node) {
    const set = new Set();
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, force) => {
        const want = typeof force === "boolean" ? force : !set.has(c);
        if (want) set.add(c); else set.delete(c);
        return want;
      },
      contains: (c) => set.has(c),
      _set: set,
    };
  }

  class StubText {
    constructor(text) {
      this.nodeType = 3;
      this.data = String(text);
      this.parentNode = null;
    }
    get textContent() { return this.data; }
  }

  class StubElement {
    constructor(tag) {
      this.nodeType = 1;
      this.tagName = String(tag).toUpperCase();
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.dataset = {};
      this.classList = makeClassList(this);
      this.eventListeners = {};
      this.parentNode = null;
      this._hidden = false;
      this._textOverride = null;
    }
    appendChild(c) {
      this.children.push(c);
      if (c) c.parentNode = this;
      return c;
    }
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      if (c) c.parentNode = null;
      return c;
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(name, fn) { (this.eventListeners[name] = this.eventListeners[name] || []).push(fn); }
    removeEventListener(name, fn) {
      const list = this.eventListeners[name];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    set className(v) { this.attributes.class = String(v); }
    get className() { return this.attributes.class || ""; }
    set hidden(v) { this._hidden = !!v; }
    get hidden() { return this._hidden; }
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
    get firstChild() { return this.children[0] || null; }
  }

  class StubFragment {
    constructor() {
      this.nodeType = 11;
      this.children = [];
    }
    appendChild(c) {
      this.children.push(c);
      if (c) c.parentNode = this;
      return c;
    }
    get firstChild() { return this.children[0] || null; }
    get textContent() {
      return this.children
        .map((c) => (c && typeof c.textContent === "string" ? c.textContent : ""))
        .join("");
    }
  }

  const document = {
    createElement: (tag) => new StubElement(tag),
    createTextNode: (text) => new StubText(text),
    createDocumentFragment: () => new StubFragment(),
  };

  return { document, StubElement, StubText, StubFragment };
}

// `el` shim — copy of js/app/helpers.js's el(). Exposed via prelude in vm
// contexts. Uses the StubElement's setAttribute path for everything except
// className / textContent (mirrors the production helper).
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
`;

// ── Recursive textContent helper for assertions ──────────────────────────────
// vm-context Stub instances cross realms; we rely on the duck-typed
// `textContent` getter we exposed on each stub.

function recursiveText(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.data;
  if (typeof node.textContent === "string") return node.textContent;
  return "";
}

// ── PURE HELPERS loader ──────────────────────────────────────────────────────

function loadPureHelpers() {
  const { document } = makeDom();
  const ctx = {
    document,
    Object, Array, String, Math, JSON, console, Error,
    encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(EL_SHIM + extractBlock("PURE HELPERS"), ctx, { filename: "search-pure-helpers.js" });
  return {
    ctx,
    document,
    appendTextWithHighlight: ctx.appendTextWithHighlight,
    buildSnippet: ctx.buildSnippet,
    buildSearchPagination: ctx.buildSearchPagination,
  };
}

// ── WORKER loader ────────────────────────────────────────────────────────────
// Worker stub captures postMessage calls and lets tests fire `message` events
// to drive the listener path. Each loaded module gets a fresh instance so
// state (searchWorker, activeSearchId, pendingSearchCb) starts clean.

function loadWorkerBlock() {
  const workerInstances = [];

  class StubWorker {
    constructor(url) {
      this.url = url;
      this.posts = [];
      this.listeners = { message: [] };
      workerInstances.push(this);
    }
    postMessage(msg) { this.posts.push(msg); }
    addEventListener(name, fn) {
      (this.listeners[name] = this.listeners[name] || []).push(fn);
    }
    /** Fire a `message` event with the given data. */
    _emit(data) {
      const ev = { data };
      for (const fn of this.listeners.message) fn(ev);
    }
  }

  const ctx = {
    Promise, Object, Array, String, Number, JSON, console, Error,
    Worker: StubWorker,
  };
  vm.createContext(ctx);
  // Prelude: DATA_DIR mirrors search.js's module-level constant. Declared
  // outside the marker (it's shared with the rest of the module), so the
  // test loader provides it.
  const prelude = `const DATA_DIR = "/data";\n`;
  vm.runInContext(prelude + extractBlock("WORKER WIRE-UP"), ctx, { filename: "search-worker-block.js" });
  return {
    ctx,
    workerInstances,
    ensureSearchWorker: ctx.ensureSearchWorker,
    doSearch: ctx.doSearch,
  };
}

// ── IS_MOBILE loader ─────────────────────────────────────────────────────────

function loadIsMobile(matches) {
  const ctx = {
    window: {
      matchMedia: (q) => ({ media: q, matches: !!matches }),
    },
    Object, console,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("IS_MOBILE"), ctx, { filename: "search-is-mobile.js" });
  return ctx.isMobile;
}

// ── AUTO_NAVIGATE loader ─────────────────────────────────────────────────────
// The flag itself lives in the surrounding module scope (search.js
// declares `let searchAutoNavigate = false;` outside the marker block).
// Test prelude redeclares the flag so consumeSearchAutoNavigate can read +
// reset it; a small `_setAutoNav` setter is also exposed for arrange.

function loadAutoNavigate(initial = false) {
  const ctx = { Object, console };
  vm.createContext(ctx);
  const prelude = `
    let searchAutoNavigate = ${initial ? "true" : "false"};
    function _setAutoNav(v) { searchAutoNavigate = !!v; }
    function _peekAutoNav() { return searchAutoNavigate; }
  `;
  vm.runInContext(prelude + extractBlock("AUTO_NAVIGATE"), ctx, { filename: "search-auto-navigate.js" });
  return {
    consumeSearchAutoNavigate: ctx.consumeSearchAutoNavigate,
    setAutoNav: ctx._setAutoNav,
    peekAutoNav: ctx._peekAutoNav,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

// ── appendTextWithHighlight ──────────────────────────────────────────────────

test("appendTextWithHighlight: empty query → single text node, no <mark>", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑은 모든 것을 덮어 줍니다", "");
  assert.strictEqual(target.children.length, 1);
  assert.strictEqual(target.children[0].nodeType, 3);
  assert.strictEqual(recursiveText(target), "사랑은 모든 것을 덮어 줍니다");
});

test("appendTextWithHighlight: no match → single text node, no <mark>", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑은 오래 참고", "축복");
  assert.strictEqual(target.children.length, 1);
  assert.strictEqual(target.children[0].nodeType, 3);
});

test("appendTextWithHighlight: single match → 3 nodes (text · mark · text)", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑은 오래 참고", "오래");
  assert.strictEqual(target.children.length, 3);
  assert.strictEqual(target.children[0].nodeType, 3);
  assert.strictEqual(target.children[0].data, "사랑은 ");
  assert.strictEqual(target.children[1].tagName, "MARK");
  assert.strictEqual(recursiveText(target.children[1]), "오래");
  assert.strictEqual(target.children[2].nodeType, 3);
  assert.strictEqual(target.children[2].data, " 참고");
});

test("appendTextWithHighlight: match at start → no leading text node", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑은 오래", "사랑");
  // [<mark>사랑</mark>, "은 오래"]
  assert.strictEqual(target.children.length, 2);
  assert.strictEqual(target.children[0].tagName, "MARK");
  assert.strictEqual(recursiveText(target.children[0]), "사랑");
  assert.strictEqual(target.children[1].data, "은 오래");
});

test("appendTextWithHighlight: match at end → no trailing text node", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑은 오래", "오래");
  // ["사랑은 ", <mark>오래</mark>]
  assert.strictEqual(target.children.length, 2);
  assert.strictEqual(target.children[0].data, "사랑은 ");
  assert.strictEqual(target.children[1].tagName, "MARK");
});

test("appendTextWithHighlight: multiple matches → multiple <mark>", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "사랑 사랑 사랑", "사랑");
  // [<mark>, " ", <mark>, " ", <mark>]
  assert.strictEqual(target.children.length, 5);
  const marks = target.children.filter((c) => c.tagName === "MARK");
  assert.strictEqual(marks.length, 3);
});

test("appendTextWithHighlight: case-insensitive match", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "Hello WORLD", "world");
  assert.strictEqual(target.children.length, 2);
  // Mark uses original casing from text, not query
  assert.strictEqual(recursiveText(target.children[1]), "WORLD");
});

test("appendTextWithHighlight: <mark> has search-highlight className + presentation role", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "abc", "b");
  const mark = target.children.find((c) => c.tagName === "MARK");
  assert.strictEqual(mark.className, "search-highlight");
  assert.strictEqual(mark.getAttribute("role"), "presentation");
});

// ── buildSnippet ─────────────────────────────────────────────────────────────

test("buildSnippet: short text fits whole, no ellipsis", () => {
  const h = loadPureHelpers();
  const frag = h.buildSnippet("짧은 본문", "본문");
  // Fragment > <span> > [text "짧은 ", <mark>본문</mark>]
  assert.strictEqual(frag.nodeType, 11);
  assert.strictEqual(frag.children.length, 1);
  const span = frag.children[0];
  assert.strictEqual(span.tagName, "SPAN");
  assert.strictEqual(span.className, "search-result-text");
  assert.ok(recursiveText(span).includes("본문"));
  assert.ok(!recursiveText(span).startsWith("…"));
  assert.ok(!recursiveText(span).endsWith("…"));
});

test("buildSnippet: long text with early match → no prefix ellipsis, suffix ellipsis", () => {
  const h = loadPureHelpers();
  const text = "본문이 시작되고 " + "ㄱ".repeat(120);
  const frag = h.buildSnippet(text, "본문");
  const span = frag.children[0];
  const textOut = recursiveText(span);
  // matchIdx (0) <= 40 → no prefix; resulting displayText.length > 100 → suffix
  assert.ok(!textOut.startsWith("…"), `expected no leading ellipsis, got: ${textOut.slice(0, 5)}`);
  assert.ok(textOut.endsWith("…"), `expected trailing ellipsis, got tail: ${textOut.slice(-5)}`);
});

test("buildSnippet: long text with late match → prefix ellipsis, suffix ellipsis", () => {
  const h = loadPureHelpers();
  // matchIdx ≈ 61 (>40 → prefix), displayText length = text.length - 31 ≈ 157
  // (>100 → suffix). Suffix requires both substring-after-prefix-clip AND
  // resulting length still >100, so the trailing run needs to be long enough.
  const text = "ㄱ".repeat(60) + " 본문이 등장 " + "ㄴ".repeat(120);
  const frag = h.buildSnippet(text, "본문");
  const span = frag.children[0];
  const textOut = recursiveText(span);
  assert.ok(textOut.startsWith("…"));
  assert.ok(textOut.endsWith("…"));
});

test("buildSnippet: returns DocumentFragment containing one span", () => {
  const h = loadPureHelpers();
  const frag = h.buildSnippet("aa bb cc", "bb");
  assert.strictEqual(frag.nodeType, 11);
  assert.strictEqual(frag.children.length, 1);
  assert.strictEqual(frag.children[0].tagName, "SPAN");
});

// ── buildSearchPagination ────────────────────────────────────────────────────

test("buildSearchPagination: middle page → prev link, page-info, next link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination("사랑", 2, 5);
  assert.strictEqual(nav.tagName, "NAV");
  assert.strictEqual(nav.className, "search-pagination");
  assert.strictEqual(nav.children.length, 3);
  // prev <a>
  assert.strictEqual(nav.children[0].tagName, "A");
  assert.strictEqual(nav.children[0].getAttribute("href"), "/search?q=%EC%82%AC%EB%9E%91&page=1");
  assert.strictEqual(recursiveText(nav.children[0]), "← 이전");
  // page-info <span>
  assert.strictEqual(nav.children[1].tagName, "SPAN");
  assert.strictEqual(nav.children[1].className, "search-page-info");
  assert.strictEqual(recursiveText(nav.children[1]), "2 / 5");
  // next <a>
  assert.strictEqual(nav.children[2].tagName, "A");
  assert.strictEqual(nav.children[2].getAttribute("href"), "/search?q=%EC%82%AC%EB%9E%91&page=3");
  assert.strictEqual(recursiveText(nav.children[2]), "다음 →");
});

test("buildSearchPagination: first page → placeholder span instead of prev link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination("q", 1, 3);
  assert.strictEqual(nav.children.length, 3);
  assert.strictEqual(nav.children[0].tagName, "SPAN");
  assert.strictEqual(nav.children[0].className, "placeholder");
  assert.strictEqual(nav.children[2].tagName, "A");
});

test("buildSearchPagination: last page → placeholder span instead of next link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination("q", 5, 5);
  assert.strictEqual(nav.children.length, 3);
  assert.strictEqual(nav.children[0].tagName, "A");
  assert.strictEqual(nav.children[2].tagName, "SPAN");
  assert.strictEqual(nav.children[2].className, "placeholder");
});

test("buildSearchPagination: encodeURIComponent applied to query", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination("a b/c", 2, 3);
  // " " → "%20", "/" → "%2F"
  assert.strictEqual(nav.children[0].getAttribute("href"), "/search?q=a%20b%2Fc&page=1");
  assert.strictEqual(nav.children[2].getAttribute("href"), "/search?q=a%20b%2Fc&page=3");
});

test("buildSearchPagination: nav has aria-label", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination("q", 1, 1);
  assert.strictEqual(nav.getAttribute("aria-label"), "검색 결과 페이지");
});

// ── isMobile ─────────────────────────────────────────────────────────────────

test("isMobile: matchMedia.matches=true → true", () => {
  const isMobile = loadIsMobile(true);
  assert.strictEqual(isMobile(), true);
});

test("isMobile: matchMedia.matches=false → false", () => {
  const isMobile = loadIsMobile(false);
  assert.strictEqual(isMobile(), false);
});

test("isMobile: queries the (max-width: 768px) media query", () => {
  let lastQuery = null;
  const ctx = {
    window: { matchMedia: (q) => { lastQuery = q; return { matches: false }; } },
    Object, console,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("IS_MOBILE"), ctx, { filename: "search-is-mobile-q.js" });
  ctx.isMobile();
  assert.strictEqual(lastQuery, "(max-width: 768px)");
});

// ── consumeSearchAutoNavigate ────────────────────────────────────────────────

test("consumeSearchAutoNavigate: initial false → returns false", () => {
  const m = loadAutoNavigate(false);
  assert.strictEqual(m.consumeSearchAutoNavigate(), false);
});

test("consumeSearchAutoNavigate: true → returns true and resets to false", () => {
  const m = loadAutoNavigate(true);
  assert.strictEqual(m.consumeSearchAutoNavigate(), true);
  assert.strictEqual(m.peekAutoNav(), false);
});

test("consumeSearchAutoNavigate: second consume returns false (single-shot)", () => {
  const m = loadAutoNavigate(true);
  m.consumeSearchAutoNavigate();
  assert.strictEqual(m.consumeSearchAutoNavigate(), false);
});

test("consumeSearchAutoNavigate: re-set after consume → consumes again", () => {
  const m = loadAutoNavigate(true);
  m.consumeSearchAutoNavigate();
  m.setAutoNav(true);
  assert.strictEqual(m.consumeSearchAutoNavigate(), true);
  assert.strictEqual(m.peekAutoNav(), false);
});

// ── ensureSearchWorker ───────────────────────────────────────────────────────

test("ensureSearchWorker: first call creates Worker at /js/search-worker.js", () => {
  const m = loadWorkerBlock();
  const w = m.ensureSearchWorker();
  assert.strictEqual(m.workerInstances.length, 1);
  assert.strictEqual(m.workerInstances[0].url, "/js/search-worker.js");
  assert.strictEqual(w, m.workerInstances[0]);
});

test("ensureSearchWorker: posts init message with metaUrl + 3 chunks (nt/dc/ot)", () => {
  const m = loadWorkerBlock();
  m.ensureSearchWorker();
  const w = m.workerInstances[0];
  assert.strictEqual(w.posts.length, 1);
  const init = w.posts[0];
  assert.strictEqual(init.type, "init");
  assert.strictEqual(init.metaUrl, "/data/search-meta.json");
  assert.strictEqual(init.chunks.length, 3);
  // Order: nt → dc → ot (NT first to prioritise; matches search.js).
  // Rehydrate via JSON so the cross-realm Array prototype doesn't trip
  // deepStrictEqual.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(init.chunks.map((c) => c.name))), ["nt", "dc", "ot"]);
  assert.strictEqual(init.chunks[0].url, "/data/search-nt.json");
  assert.strictEqual(init.chunks[1].url, "/data/search-dc.json");
  assert.strictEqual(init.chunks[2].url, "/data/search-ot.json");
});

test("ensureSearchWorker: second call returns cached instance, does not re-init", () => {
  const m = loadWorkerBlock();
  const w1 = m.ensureSearchWorker();
  const w2 = m.ensureSearchWorker();
  assert.strictEqual(w1, w2);
  assert.strictEqual(m.workerInstances.length, 1);
  // Still only the init message, no second init
  assert.strictEqual(m.workerInstances[0].posts.length, 1);
});

test("ensureSearchWorker: registers a single message listener", () => {
  const m = loadWorkerBlock();
  m.ensureSearchWorker();
  assert.strictEqual(m.workerInstances[0].listeners.message.length, 1);
});

// ── doSearch ─────────────────────────────────────────────────────────────────

test("doSearch: posts search payload with type/q/page/pageSize/searchId=1", async () => {
  const m = loadWorkerBlock();
  const p = m.doSearch("사랑", 2, 20, null);
  // ensureSearchWorker created it; first post is init, second is search
  const w = m.workerInstances[0];
  assert.strictEqual(w.posts.length, 2);
  const search = w.posts[1];
  assert.strictEqual(search.type, "search");
  assert.strictEqual(search.q, "사랑");
  assert.strictEqual(search.page, 2);
  assert.strictEqual(search.pageSize, 20);
  assert.strictEqual(search.searchId, 1);
  // Resolve by emitting results
  w._emit({ type: "results", searchId: 1, total: 0, results: [] });
  const result = await p;
  assert.strictEqual(result.type, "results");
});

test("doSearch: increments searchId across calls", async () => {
  const m = loadWorkerBlock();
  m.doSearch("q1", 1, 10, null);
  m.doSearch("q2", 1, 10, null);
  const w = m.workerInstances[0];
  // Posts: [init, search#1, search#2]
  assert.strictEqual(w.posts[1].searchId, 1);
  assert.strictEqual(w.posts[2].searchId, 2);
});

test("doSearch: resolves with the message when type=results matches searchId", async () => {
  const m = loadWorkerBlock();
  const p = m.doSearch("q", 1, 10, null);
  const w = m.workerInstances[0];
  const payload = { type: "results", searchId: 1, total: 5, results: [{ b: "gen", c: 1, v: 1, t: "x" }] };
  w._emit(payload);
  const r = await p;
  assert.strictEqual(r.total, 5);
  assert.strictEqual(r.results.length, 1);
});

test("doSearch: resolves with null on terminal error", async () => {
  const m = loadWorkerBlock();
  const p = m.doSearch("q", 1, 10, null);
  const w = m.workerInstances[0];
  w._emit({ type: "error", searchId: 1, message: "boom" });
  const r = await p;
  assert.strictEqual(r, null);
});

test("doSearch: error without searchId still resolves the pending search", async () => {
  // Worker init failures may emit error without searchId in some browsers.
  // doSearch must treat that as terminal so the UI doesn't hang.
  const m = loadWorkerBlock();
  const p = m.doSearch("q", 1, 10, null);
  const w = m.workerInstances[0];
  w._emit({ type: "error", message: "init failed" });
  const r = await p;
  assert.strictEqual(r, null);
});

test("doSearch: stale partial-results (older searchId) are ignored", async () => {
  const m = loadWorkerBlock();
  let partials = 0;
  const onPartial = () => { partials += 1; };
  // First search
  const p1 = m.doSearch("q1", 1, 10, onPartial);
  // Second search starts before first one finishes — bumps activeSearchId to 2
  const p2 = m.doSearch("q2", 1, 10, null);
  const w = m.workerInstances[0];
  // Stale partial for searchId=1 should be ignored (active is 2)
  w._emit({ type: "partial-results", searchId: 1, total: 3, results: [] });
  assert.strictEqual(partials, 0);
  // Resolve both with their final results so the test doesn't dangle
  w._emit({ type: "results", searchId: 2, total: 0, results: [] });
  await p2;
  // p1 stays unresolved — pendingSearchCb was overwritten by p2's resolve. We
  // cannot await p1 (would hang); just confirm partials count.
  // (Documenting the side effect rather than asserting on it: search.js's
  // contract is that each new doSearch supersedes the previous.)
  void p1;
});

test("doSearch: partial-results forwarded to onPartial for the active search", async () => {
  const m = loadWorkerBlock();
  let received = null;
  const onPartial = (p) => { received = p; };
  const p = m.doSearch("q", 1, 10, onPartial);
  const w = m.workerInstances[0];
  w._emit({ type: "partial-results", searchId: 1, total: 2, results: [{ b: "gen", c: 1, v: 1, t: "x" }] });
  assert.ok(received);
  assert.strictEqual(received.total, 2);
  // Resolve so the promise doesn't dangle
  w._emit({ type: "results", searchId: 1, total: 2, results: [] });
  await p;
});

test("doSearch: results with mismatched searchId are ignored", async () => {
  const m = loadWorkerBlock();
  const p = m.doSearch("q", 1, 10, null);
  const w = m.workerInstances[0];
  // Stale results with old searchId — should not resolve
  w._emit({ type: "results", searchId: 99, total: 0, results: [] });
  // Resolve with the right searchId
  w._emit({ type: "results", searchId: 1, total: 7, results: [] });
  const r = await p;
  assert.strictEqual(r.total, 7);
});
