// ── Unit tests for js/app/search.js ──────────────────────────────────────────
// Run with: node --test tests/unit/search.test.js
//
// search.js is heavily DOM- and Worker-bound at module top level
// (createSearchHistoryController calls + sheet event listeners), so loading
// the whole file in vm requires extensive Element/anchor stubs. We instead
// extract testable blocks via BEGIN/END markers (mirrors storage.test.js's
// slice approach for js/app/storage.js) and run them in vm contexts with
// the minimal stubs each block needs.
//
// Coverage:
//   - WORKER block (ensureSearchWorker/doSearch + state) — Worker stub
//   - PURE HELPERS block (appendTextWithHighlight/highlightTextNodes/buildSnippet/
//     buildSearchPagination) — minimal Element + el shim
//   - IS_MOBILE block — isSmallLayout stub
//   - PAGE_SIZE block (searchPageSize) — window and barBottom stubs
//   - AUTO_NAVIGATE block (consumeSearchAutoNavigate) — pure state
//   - HISTORY_CONTROLLER block (createSearchHistoryController) — extended
//     StubElement with querySelectorAll/contains/closest/focus/dispatch and
//     stubs for loadSearchHistory/removeSearchHistory/clearSearchHistory.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEARCH_PATH = path.resolve(__dirname, "../../js/app/search.js");
const SEARCH_SOURCE = fs.readFileSync(SEARCH_PATH, "utf8");
const VERSE_SPEC_SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/verse-spec.js"), "utf8");

function extractBlock(name, source = SEARCH_SOURCE) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found`);
  }
  return source.slice(startIdx, endIdx + end.length);
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
    /** Text.replaceWith: swap this node for `nodes` in its parent (highlightTextNodes). */
    replaceWith(...nodes) {
      const parent = this.parentNode;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1, ...nodes);
      for (const n of nodes) n.parentNode = parent;
      this.parentNode = null;
    }
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
    /** Reflected to/from the `id` attribute. */
    get id() { return this.attributes.id || ""; }
    set id(v) { this.attributes.id = String(v); }
    /** HISTORY_CONTROLLER tests: ancestor walk for outside-click detection. */
    contains(node) {
      let n = node;
      while (n) {
        if (n === this) return true;
        n = n.parentNode;
      }
      return false;
    }
    /** Selector matcher for `.class` only (sufficient for history panel). */
    _matchesSelector(selector) {
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        return (this.attributes.class || "").split(/\s+/).includes(cls);
      }
      return false;
    }
    /** HISTORY_CONTROLLER: walk up ancestors finding the first match. */
    closest(selector) {
      let node = this;
      while (node) {
        if (node._matchesSelector && node._matchesSelector(selector)) return node;
        node = node.parentNode;
      }
      return null;
    }
    /** HISTORY_CONTROLLER: descend collecting all matches. */
    querySelectorAll(selector) {
      /** @type {Array<any>} */
      const out = [];
      const walk = (n) => {
        if (!n.children) return;
        for (const child of n.children) {
          if (child._matchesSelector && child._matchesSelector(selector)) out.push(child);
          if (child.children) walk(child);
        }
      };
      walk(this);
      return out;
    }
    /** HISTORY_CONTROLLER: no-op recorders so production calls don't throw. */
    focus(_opts) { this._focusCalls = (this._focusCalls || 0) + 1; }
    scrollIntoView(_opts) { this._scrollCalls = (this._scrollCalls || 0) + 1; }
    /** Test-only: synchronously fire all listeners for a given event type. */
    _dispatch(type, evt) {
      const list = this.eventListeners[type];
      if (!list) return;
      for (const fn of [...list]) fn(evt);
    }
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
    Object, Array, String, Math, JSON, console, Error, Set, Number,
    encodeURIComponent, Date, isNaN,
    // SCOPE_HELPERS의 bookName(책의 짧은 이름) — 전례일 줄의 숫자 표기가 쓴다
    bookName: (id) => ({ john: "요한", ps: "시편", luke: "루가" })[id] || id,
  };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(EL_SHIM + extractBlock("PURE HELPERS"), ctx, { filename: "search-pure-helpers.js" });
  return {
    ctx,
    document,
    verseRefTargets: ctx.verseRefTargets,
    isWellFormedSpec: ctx.isWellFormedSpec,
    appendTextWithHighlight: ctx.appendTextWithHighlight,
    splitPiecesByMatches: ctx.splitPiecesByMatches,
    highlightTextNodes: ctx.highlightTextNodes,
    buildSnippet: ctx.buildSnippet,
    buildSearchPagination: ctx.buildSearchPagination,
    buildSearchUrl: ctx.buildSearchUrl,
    formatSearchDate: ctx.formatSearchDate,
    hasBatchim: ctx.hasBatchim,
    synonymNote: ctx.synonymNote,
    unknownBookNote: ctx.unknownBookNote,
    fixedDateText: ctx.fixedDateText,
    lectCyclesText: ctx.lectCyclesText,
    lectSlugHref: ctx.lectSlugHref,
    lectRowOf: ctx.lectRowOf,
    yearRowsOf: ctx.yearRowsOf,
    nextMonthDay: ctx.nextMonthDay,
    monthDayIn: ctx.monthDayIn,
    monthDaysBetween: ctx.monthDaysBetween,
    localNoticeOf: ctx.localNoticeOf,
    buildLocalNotice: ctx.buildLocalNotice,
    pickedParishNote: ctx.pickedParishNote,
    looksLikeYearQuery: ctx.looksLikeYearQuery,
    lectNotation: ctx.lectNotation,
    buildLectRow: ctx.buildLectRow,
    fillLectRow: ctx.fillLectRow,
    lectDayText: ctx.lectDayText,
    buildSearchPills: ctx.buildSearchPills,
    buildScopePills: ctx.buildScopePills,
    partialAnnouncement: ctx.partialAnnouncement,
    SEARCHED_GROUPS: vm.runInContext("SEARCHED_GROUPS", ctx),
  };
}

// 줄이 여는 날과 다른 날을 계산하는 함수(LECT_DAYS). 엔진은 가짜를 넘긴다. 성탄 평일의 이름 상태는 비워 둔다.
function loadLectDays() {
  const { document } = makeDom();
  const ctx = { document, Object, Array, String, Math, JSON, console, Error, Set, Number, Map, Promise, encodeURIComponent, Date, isNaN, bookName: (id) => id };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(`${EL_SHIM}${extractBlock("PURE HELPERS")}\n${extractBlock("LECT_DAYS")}\nthis.lectDaysOf = lectDaysOf;\nthis.localYearDayOf = localYearDayOf;`, ctx, {
    filename: "search-lect-days.js",
  });
  return ctx;
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
    Worker: StubWorker, setTimeout, clearTimeout,
    // 책 목록(books.json) — 송가 이름을 검색마다 싣는다(ADR-047 §5). `ctx.__books`로 바꾼다
    window: { getBooksCache: () => ctx.__books ?? null },
  };
  vm.createContext(ctx);
  // Prelude: DATA_DIR mirrors search.js's module-level constant. Declared
  // outside the marker (it's shared with the rest of the module), so the
  // test loader provides it.
  // loadParish comes from window.appStorage at module top: a stub reading `ctx.__parish` (ADR-041 §6).
  const prelude = `const DATA_DIR = "/data";\nconst loadParish = () => globalThis.__parish ?? "";\n`;
  vm.runInContext(prelude + extractBlock("WORKER WIRE-UP"), ctx, { filename: "search-worker-block.js" });
  return {
    ctx,
    workerInstances,
    ensureSearchWorker: ctx.ensureSearchWorker,
    doSearch: ctx.doSearch,
    nextLectionary: ctx.nextLectionary,
  };
}

// ── IS_MOBILE loader ─────────────────────────────────────────────────────────

function loadIsMobile(mobile) {
  const ctx = {
    isSmallLayout: () => !!mobile,
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

// ── verseRefTargets: 구절 바로가기의 주소와 표시 ─────────────────────────────

const target1 = (helpers, verses, chapter = 3) =>
  helpers.verseRefTargets({ bookId: "john", parts: [{ chapter, verses }] })[0];

test("verseRefTargets: 쉼표 목록은 여러 구간 주소와 표시가 된다", () => {
  const r = target1(loadPureHelpers(), "16,18-19");
  assert.strictEqual(r.path, "/john/3/16,18-19");
  assert.strictEqual(r.verses, "16, 18-19절");
  assert.strictEqual(r.chapter, 3);
});

test("verseRefTargets: 절 하나와 범위 하나는 예전 주소 그대로다", () => {
  const h = loadPureHelpers();
  assert.strictEqual(target1(h, "3").path, "/john/3/3");
  assert.strictEqual(target1(h, "3-11").path, "/john/3/3-11");
  assert.strictEqual(target1(h, "3-11").verses, "3-11절");
});

test("verseRefTargets: 친 순서가 뒤섞이고 겹쳐도 주소 검사를 통과하는 표기로 쓴다", () => {
  const h = loadPureHelpers();
  for (const [typed, spec] of [
    ["18-19,16", "16,18-19"],
    ["16-18,17-20", "16-20"],
    ["16,16", "16"],
    ["16,17", "16-17"],
    ["19-18,16", "16,18-19"],
    ["25-999,1-2", "1-2,25-999"],
    ["1-1,5-8", "1,5-8"],
  ]) {
    assert.strictEqual(target1(h, typed).path, `/john/3/${spec}`, typed);
    assert.ok(h.isWellFormedSpec(spec), spec);
  }
});

test("verseRefTargets: 장의 끝까지 가는 구간은 「부터」로 적는다", () => {
  const h = loadPureHelpers();
  assert.strictEqual(target1(h, "10-999").path, "/john/3/10-999");
  assert.strictEqual(target1(h, "10-999").verses, "10절부터");
  assert.strictEqual(target1(h, "1-2,25-999").verses, "1-2, 25절부터");
});

test("verseRefTargets: 장 전체와 0절은 절 없이 장으로 간다", () => {
  const h = loadPureHelpers();
  for (const verses of ["1-999", "0"]) {
    const r = target1(h, verses);
    assert.strictEqual(r.path, "/john/3", verses);
    assert.strictEqual(r.verses, "", verses);
  }
});

test("verseRefTargets: 장마다 하나씩 적은 차례대로 돌려준다", () => {
  const { verseRefTargets } = loadPureHelpers();
  const r = verseRefTargets({
    bookId: "1sam",
    parts: [{ chapter: 18, verses: "6-9" }, { chapter: 19, verses: "1-7" }],
  });
  assert.deepEqual(Array.from(r, (t) => t.path), ["/1sam/18/6-9", "/1sam/19/1-7"]);
  assert.deepEqual(Array.from(r, (t) => t.verses), ["6-9절", "1-7절"]);
});

// ── buildSearchUrl (ADR-033) ─────────────────────────────────────────────────

test("buildSearchUrl: query only", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({ q: "사랑" }), "/search?q=%EC%82%AC%EB%9E%91");
});

test("buildSearchUrl: page 1 is omitted, page >1 included", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({ q: "x", page: 1 }), "/search?q=x");
  assert.strictEqual(h.buildSearchUrl({ q: "x", page: 3 }), "/search?q=x&page=3");
});

test("buildSearchUrl: book filter (in=) repeated per book", () => {
  const h = loadPureHelpers();
  assert.strictEqual(
    h.buildSearchUrl({ q: "사랑", filterBooks: ["john", "rom"] }),
    "/search?q=%EC%82%AC%EB%9E%91&in=john&in=rom",
  );
});

test("buildSearchUrl: group writes 성시 and 전례일, not 성서 본문 (ADR-044 §1, ADR-046 §3)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({ q: "x", group: "psalter" }), "/search?q=x&group=psalter");
  assert.strictEqual(h.buildSearchUrl({ q: "x", page: 2, group: "lectionary" }), "/search?q=x&page=2&group=lectionary");
  assert.strictEqual(h.buildSearchUrl({ q: "x", group: "bible" }), "/search?q=x");
});

test("buildSearchUrl: 고른 책 알약(book=)은 범위와 묶음 뒤에 적는다(ADR-049 §2)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({ q: "x", page: 2, filterBooks: ["luke", "john"], book: "john" }), "/search?q=x&page=2&in=luke&in=john&book=john");
  assert.strictEqual(h.buildSearchUrl({ q: "x", filterBooks: ["luke"], book: null }), "/search?q=x&in=luke");
});

test("buildSearchUrl: empty state → bare /search", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({}), "/search");
  assert.strictEqual(h.buildSearchUrl({ q: "" }), "/search");
});

// ── formatSearchDate (ADR-014 개정 / ADR-033) ─────────────────────────────────

test("formatSearchDate: absolute YYYY. M. D. for a timestamp", () => {
  const h = loadPureHelpers();
  // Local-time constructor avoids timezone drift in the assertion.
  const ts = new Date(2026, 5, 5).getTime(); // 2026-06-05 (month is 0-based)
  assert.strictEqual(h.formatSearchDate(ts), "2026. 6. 5.");
});

test("formatSearchDate: null/undefined → empty string (legacy entry)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.formatSearchDate(null), "");
  assert.strictEqual(h.formatSearchDate(undefined), "");
});

test("formatSearchDate: NaN/invalid timestamp → empty string", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.formatSearchDate(NaN), "");
});

// ── buildSearchPagination ────────────────────────────────────────────────────

test("buildSearchPagination: middle page → prev link, page-info, next link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "사랑" }, 2, 5);
  assert.strictEqual(nav.tagName, "NAV");
  assert.strictEqual(nav.className, "search-pagination");
  assert.strictEqual(nav.children.length, 3);
  // prev <a> — page 1 is omitted from the URL
  assert.strictEqual(nav.children[0].tagName, "A");
  assert.strictEqual(nav.children[0].getAttribute("href"), "/search?q=%EC%82%AC%EB%9E%91");
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

test("buildSearchPagination: page links carry focus keys — the router puts focus back on the pressed one, the other takes over on the first / last page", () => {
  // 사용자 결정 2026-10-17: 새 페이지에서도 누른 링크 그대로(결과 목록 맨 위로 보내는 안 대신) — routing.js restoreFocusSpot
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "사랑" }, 2, 5);
  const [prev, , next] = nav.children;
  assert.deepStrictEqual([prev.getAttribute("data-focus-key"), prev.getAttribute("data-focus-fallback")], ["page:prev", "page:next"]);
  assert.deepStrictEqual([next.getAttribute("data-focus-key"), next.getAttribute("data-focus-fallback")], ["page:next", "page:prev"]);
  assert.strictEqual(nav.children[1].getAttribute("data-focus-key"), null, "쪽 번호는 컨트롤이 아니다");
});

test("buildSearchPagination: carries book filter into page links", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "사랑", filterBooks: ["john"] }, 2, 5);
  assert.strictEqual(
    nav.children[2].getAttribute("href"),
    "/search?q=%EC%82%AC%EB%9E%91&page=3&in=john",
  );
});

test("buildSearchPagination: 성시의 쪽 링크는 성시에 머문다(ADR-046 §3)", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "x", group: "psalter" }, 2, 5);
  assert.strictEqual(nav.children[0].getAttribute("href"), "/search?q=x&group=psalter");
  assert.strictEqual(nav.children[2].getAttribute("href"), "/search?q=x&page=3&group=psalter");
});

test("buildSearchPagination: first page → placeholder span instead of prev link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "q" }, 1, 3);
  assert.strictEqual(nav.children.length, 3);
  assert.strictEqual(nav.children[0].tagName, "SPAN");
  assert.strictEqual(nav.children[0].className, "placeholder");
  assert.strictEqual(nav.children[2].tagName, "A");
});

test("buildSearchPagination: last page → placeholder span instead of next link", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "q" }, 5, 5);
  assert.strictEqual(nav.children.length, 3);
  assert.strictEqual(nav.children[0].tagName, "A");
  assert.strictEqual(nav.children[2].tagName, "SPAN");
  assert.strictEqual(nav.children[2].className, "placeholder");
});

test("buildSearchPagination: encodeURIComponent applied to query", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "a b/c" }, 2, 3);
  // " " → "%20", "/" → "%2F"; prev is page 1 (omitted)
  assert.strictEqual(nav.children[0].getAttribute("href"), "/search?q=a%20b%2Fc");
  assert.strictEqual(nav.children[2].getAttribute("href"), "/search?q=a%20b%2Fc&page=3");
});

test("buildSearchPagination: nav has aria-label", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPagination({ q: "q" }, 1, 1);
  assert.strictEqual(nav.getAttribute("aria-label"), "검색 결과 페이지");
});

// ── isMobile ─────────────────────────────────────────────────────────────────

test("isMobile: the mobile layout's condition holds → true", () => {
  const isMobile = loadIsMobile(true);
  assert.strictEqual(isMobile(), true);
});

test("isMobile: the mobile layout's condition doesn't hold → false", () => {
  const isMobile = loadIsMobile(false);
  assert.strictEqual(isMobile(), false);
});

test("isMobile: reads the one shared layout condition, not a copy of it (#612 review, ADR-050 §2)", () => {
  // helpers.js LARGE_LAYOUT_QUERY is the condition CSS hides the header search field with, so the page always shows
  // exactly one search field. A copy of the query here could drift from it.
  const block = extractBlock("IS_MOBILE");
  assert.ok(!block.includes("matchMedia"), "isMobile has no query of its own");
  assert.match(block, /return isSmallLayout\(\);/);
  const helpers = fs.readFileSync(path.resolve(__dirname, "../../js/app/helpers.js"), "utf8");
  assert.match(helpers, /const LARGE_LAYOUT_QUERY = "\(min-width: 700px\) and \(min-height: 600px\)";/);
});

// ── searchPageSize ───────────────────────────────────────────────────────────

function loadPageSize(win, bar) {
  const ctx = { window: win, barBottom: () => bar, JSON, Math, Object, console };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("PAGE_SIZE"), ctx, { filename: "search-page-size.js" });
  return ctx;
}

test("searchPageSize: the height below the top bar over 80px a result, at least 5", () => {
  assert.strictEqual(loadPageSize({ innerHeight: 900 }, 100).searchPageSize("사랑", []), 9); // (900 - 100 - 40) / 80
  assert.strictEqual(loadPageSize({ innerHeight: 300 }, 100).searchPageSize("사랑", []), 5);
});

test("searchPageSize: kept for the same search after the window changes size (#618 review)", () => {
  // Page 2 starts at the size × 1: a size estimated again after a resize skipped or repeated results.
  const win = { innerHeight: 900 };
  const ctx = loadPageSize(win, 100);
  assert.strictEqual(ctx.searchPageSize("사랑", ["mat"]), 9);
  win.innerHeight = 600;
  assert.strictEqual(ctx.searchPageSize("사랑", ["mat"]), 9, "same words and books: same size");
  assert.strictEqual(ctx.searchPageSize("사랑", ["mrk"]), 5, "other books: a new search, estimated again");
  assert.strictEqual(ctx.searchPageSize("믿음", ["mrk"]), 5);
  win.innerHeight = 900;
  assert.strictEqual(ctx.searchPageSize("목자", []), 9, "other words: estimated again");
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

test("ensureSearchWorker: posts init message with metaUrl + 4 chunks (nt/dc/ot, then 성시 lit)", () => {
  const m = loadWorkerBlock();
  m.ensureSearchWorker();
  const w = m.workerInstances[0];
  assert.strictEqual(w.posts.length, 1);
  const init = w.posts[0];
  assert.strictEqual(init.type, "init");
  assert.strictEqual(init.metaUrl, "/data/search-meta.json");
  assert.strictEqual(init.chunks.length, 4);
  // Order: nt → dc → ot (NT first to prioritise; matches search.js), then the 성시 chunk (ADR-046), which the worker
  // counts apart from the Bible by this name (js/search-worker.js PSALTER_CHUNKS).
  // Rehydrate via JSON so the cross-realm Array prototype doesn't trip
  // deepStrictEqual.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(init.chunks.map((c) => c.name))), ["nt", "dc", "ot", "lit"]);
  assert.strictEqual(init.chunks[0].url, "/data/search-nt.json");
  assert.strictEqual(init.chunks[1].url, "/data/search-dc.json");
  assert.strictEqual(init.chunks[2].url, "/data/search-ot.json");
  assert.strictEqual(init.chunks[3].url, "/data/search-lit.json");
  const worker = fs.readFileSync(path.resolve(__dirname, "../../js/search-worker.js"), "utf8");
  assert.match(worker, /const PSALTER_CHUNKS = new Set\(\["lit"\]\);/);
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

test("doSearch: 검색마다 소속교회를 싣고, init은 본당 표의 주소를 넘긴다(ADR-044 §3)", async () => {
  const m = loadWorkerBlock();
  m.ctx.__parish = "jqdnsv";
  const p = m.doSearch("용인", 1, 20, null);
  const w = m.workerInstances[0];
  assert.strictEqual(w.posts[0].localUrl, "/data/lectionary/local-observances.json");
  assert.strictEqual(w.posts[1].parish, "jqdnsv");
  m.ctx.__parish = "";
  m.doSearch("용인", 1, 20, null);
  assert.strictEqual(w.posts[2].parish, "", "설정을 바꾸면 다음 검색부터 새 교회다");
  w._emit({ type: "results", searchId: 2, total: 0, results: [] });
  void p;
});

test("doSearch: 책 목록을 받았으면 송가 이름을 검색마다 싣고, 받기 전에는 싣지 않으며, init은 책 목록 주소를 넘기지 않는다(ADR-047 §5)", () => {
  const m = loadWorkerBlock();
  m.ctx.__books = null;
  m.doSearch("찬미", 1, 20, null);
  const w = m.workerInstances[0];
  assert.strictEqual(w.posts[0].booksUrl, undefined);
  assert.strictEqual(w.posts[1].titles, undefined, "책 목록을 받기 전");
  m.ctx.__books = [
    { id: "gen", name_ko: "창세기" },
    { id: "cant", name_ko: "성무일과 송가", titles: { "11": "즈가리야 송가" } },
  ];
  m.doSearch("찬미", 1, 20, null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(w.posts[2].titles)), { cant: { "11": "즈가리야 송가" } });
  m.ctx.__books = null;
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

// ── HISTORY_CONTROLLER loader ────────────────────────────────────────────────
// Loads the createSearchHistoryController IIFE block in a vm context. The
// loader owns the history backing store (so removeSearchHistory /
// clearSearchHistory mutate test-visible state) and provides DOM stubs
// for the elements the controller wires events to.

function loadHistoryController(initialHistory = []) {
  const dom = makeDom();
  let history = [...initialHistory];
  /** @type {Map<string, Set<Function>>} */
  const docListeners = new Map();

  const documentStub = {
    ...dom.document,
    addEventListener: (type, fn) => {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener: (type, fn) => docListeners.get(type)?.delete(fn),
  };

  const ctx = {
    Object, Array, Set, Map, Math, String, Number, Boolean, JSON, console, Error,
    document: documentStub,
    SEARCH_HISTORY_MAX: 30,
    SEARCH_HISTORY_VISIBLE: 10,
    loadSearchHistory: () => [...history],
    removeSearchHistory: (q) => { history = history.filter((x) => x !== q); return [...history]; },
    clearSearchHistory: () => { history = []; return []; },
    el: undefined,  // populated via EL_SHIM below
    clearNode: undefined,  // populated via EL_SHIM below
  };
  vm.createContext(ctx);
  const CLEAR_NODE_SHIM = `
    function clearNode(node) { node.children = []; }
  `;
  vm.runInContext(EL_SHIM + CLEAR_NODE_SHIM + extractBlock("HISTORY_CONTROLLER"), ctx, {
    filename: "search-history-controller.js",
  });

  // Build the standard input/toggle/panel/wrap/clearBtn quartet.
  // Panel mirrors index.html's <div id="search-history" hidden> initial
  // state — the controller assumes panel.hidden === true before open() runs.
  function makeFixture() {
    const wrap = new dom.StubElement("div");
    const input = new dom.StubElement("input");
    const toggle = new dom.StubElement("button");
    const panel = new dom.StubElement("div");
    panel.id = "search-history";
    panel.hidden = true;
    const clearBtn = new dom.StubElement("button");
    clearBtn.hidden = true;
    return { wrap, input, toggle, panel, clearBtn };
  }

  function create(overrides = {}) {
    const fx = { ...makeFixture(), ...overrides };
    const onSelectCalls = [];
    const syncClearCalls = [];
    const controller = ctx.createSearchHistoryController({
      wrap: fx.wrap,
      input: fx.input,
      toggle: fx.toggle,
      panel: fx.panel,
      clearBtn: fx.clearBtn,
      onSelect: (q) => onSelectCalls.push(q),
      syncClearHidden: (hidden) => syncClearCalls.push(hidden),
    });
    return { ...fx, controller, onSelectCalls, syncClearCalls };
  }

  return {
    create,
    setHistory: (h) => { history = [...h]; },
    getHistory: () => [...history],
    fireDocumentPointerdown: (evt) => {
      const set = docListeners.get("pointerdown");
      if (set) for (const fn of [...set]) fn(evt);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY_CONTROLLER tests
// ─────────────────────────────────────────────────────────────────────────────

// ── Lifecycle ───────────────────────────────────────────────────────────────

test("history controller: empty history → open() is a no-op", () => {
  const h = loadHistoryController([]);
  const c = h.create();
  c.controller.open();
  // Panel stays hidden (open returned early) and aria-expanded never set.
  assert.equal(c.panel.hidden, true);
  assert.equal(c.toggle.getAttribute("aria-expanded"), null);
});

test("history controller: open() with history sets hidden=false + aria-expanded=true", () => {
  const h = loadHistoryController(["사랑", "은혜"]);
  const c = h.create();
  c.controller.open();
  assert.equal(c.panel.hidden, false);
  assert.equal(c.toggle.getAttribute("aria-expanded"), "true");
  assert.equal(c.input.getAttribute("aria-expanded"), "true");
});

test("history controller: open() renders one row per history entry", () => {
  const h = loadHistoryController(["a", "b", "c"]);
  const c = h.create();
  c.controller.open();
  // Each row has a select + remove button
  assert.equal(c.panel.children.length, 4);  // 3 rows + 1 "모두 지우기" (>=3 items)
  const selectBtns = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(selectBtns.length, 3);
});

test("history controller: close() hides panel + resets aria + activedescendant", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  c.input.setAttribute("aria-activedescendant", "some-id");
  c.controller.close();
  assert.equal(c.panel.hidden, true);
  assert.equal(c.toggle.getAttribute("aria-expanded"), "false");
  assert.equal(c.input.getAttribute("aria-expanded"), "false");
  assert.equal(c.input.getAttribute("aria-activedescendant"), null);
});

test("history controller: close({restoreFocus:true}) calls input.focus", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  c.input._focusCalls = 0;
  c.controller.close({ restoreFocus: true });
  assert.equal(c.input._focusCalls, 1);
});

test("history controller: syncToggleVisibility — empty history hides toggle", () => {
  const h = loadHistoryController([]);
  const c = h.create();
  c.controller.syncToggleVisibility();
  assert.equal(c.toggle.hidden, true);
  assert.equal(c.wrap.dataset.historyHidden, "true");
});

test("history controller: syncToggleVisibility — non-empty shows toggle", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.syncToggleVisibility();
  assert.equal(c.toggle.hidden, false);
  assert.equal(c.wrap.dataset.historyHidden, "false");
});

// ── Rendering ───────────────────────────────────────────────────────────────

test("history controller: caps visible items at SEARCH_HISTORY_VISIBLE (10)", () => {
  const big = Array.from({ length: 25 }, (_, i) => `q${i}`);
  const h = loadHistoryController(big);
  const c = h.create();
  c.controller.open();
  const selectBtns = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(selectBtns.length, 10);
});

test("history controller: '더 보기' button appears when hidden > 0", () => {
  const big = Array.from({ length: 15 }, (_, i) => `q${i}`);
  const h = loadHistoryController(big);
  const c = h.create();
  c.controller.open();
  const more = c.panel.querySelectorAll(".search-history-more");
  assert.equal(more.length, 1);
  assert.match(more[0].textContent, /5개/);
});

test("history controller: '더 보기' missing when all items already visible", () => {
  const h = loadHistoryController(["a", "b"]);
  const c = h.create();
  c.controller.open();
  assert.equal(c.panel.querySelectorAll(".search-history-more").length, 0);
});

test("history controller: '모두 지우기' appears when history.length >= 3", () => {
  const h = loadHistoryController(["a", "b", "c"]);
  const c = h.create();
  c.controller.open();
  assert.equal(c.panel.querySelectorAll(".search-history-clear").length, 1);
});

test("history controller: '모두 지우기' missing with only 2 items", () => {
  const h = loadHistoryController(["a", "b"]);
  const c = h.create();
  c.controller.open();
  assert.equal(c.panel.querySelectorAll(".search-history-clear").length, 0);
});

// ── Toggle button ───────────────────────────────────────────────────────────

test("history controller: toggle click opens panel when closed", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.toggle._dispatch("click", {});
  assert.equal(c.panel.hidden, false);
});

test("history controller: toggle click closes + focuses input when open", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  c.input._focusCalls = 0;
  c.toggle._dispatch("click", {});
  assert.equal(c.panel.hidden, true);
  assert.equal(c.input._focusCalls, 1);
});

// ── Keyboard navigation (input keydown) ──────────────────────────────────────

function keyEvent(key) {
  return {
    key,
    _prevented: false,
    _stopped: false,
    preventDefault() { this._prevented = true; },
    stopPropagation() { this._stopped = true; },
  };
}

test("history controller: ArrowDown with empty history does not open", () => {
  const h = loadHistoryController([]);
  const c = h.create();
  const e = keyEvent("ArrowDown");
  c.input._dispatch("keydown", e);
  assert.equal(c.panel.hidden, true);
  assert.equal(e._prevented, false);
});

test("history controller: ArrowDown when closed (with history) opens + activates first", () => {
  const h = loadHistoryController(["a", "b"]);
  const c = h.create();
  const e = keyEvent("ArrowDown");
  c.input._dispatch("keydown", e);
  assert.equal(c.panel.hidden, false);
  assert.equal(e._prevented, true);
  // First option is aria-selected=true
  const opts = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(opts[0].getAttribute("aria-selected"), "true");
});

test("history controller: ArrowDown when open moves activeIndex forward", () => {
  const h = loadHistoryController(["a", "b", "c"]);
  const c = h.create();
  c.controller.open();
  c.input._dispatch("keydown", keyEvent("ArrowDown"));
  c.input._dispatch("keydown", keyEvent("ArrowDown"));
  const opts = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(opts[1].getAttribute("aria-selected"), "true");
});

test("history controller: ArrowUp when closed → no-op", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  const e = keyEvent("ArrowUp");
  c.input._dispatch("keydown", e);
  assert.equal(e._prevented, false);
});

test("history controller: ArrowUp from first wraps to last", () => {
  const h = loadHistoryController(["a", "b", "c"]);
  const c = h.create();
  c.controller.open();
  c.input._dispatch("keydown", keyEvent("ArrowDown"));  // active = 0
  c.input._dispatch("keydown", keyEvent("ArrowUp"));    // wraps to last (2)
  const opts = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(opts[2].getAttribute("aria-selected"), "true");
});

test("history controller: Escape when open closes panel", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  const e = keyEvent("Escape");
  c.input._dispatch("keydown", e);
  assert.equal(c.panel.hidden, true);
  assert.equal(e._prevented, true);
  assert.equal(e._stopped, true);
});

test("history controller: ArrowDown past visible auto-expands", () => {
  const big = Array.from({ length: 12 }, (_, i) => `q${i}`);
  const h = loadHistoryController(big);
  const c = h.create();
  c.controller.open();
  // Move active forward 10 times to reach the visible boundary, then 1 more.
  for (let i = 0; i < 11; i++) c.input._dispatch("keydown", keyEvent("ArrowDown"));
  // Panel should now show more than 10 (expanded — up to MAX 30 or list length)
  const opts = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(opts.length, 12);
});

// ── Panel clicks ────────────────────────────────────────────────────────────

test("history controller: click select button → input.value, onSelect, close", () => {
  const h = loadHistoryController(["사랑"]);
  const c = h.create();
  c.controller.open();
  const select = c.panel.querySelectorAll(".search-history-item-select")[0];
  c.panel._dispatch("click", {
    target: select,
    preventDefault() {}, stopPropagation() {},
  });
  assert.equal(c.input.value, "사랑");
  assert.deepEqual(c.onSelectCalls, ["사랑"]);
  assert.equal(c.panel.hidden, true);
  assert.equal(c.clearBtn.hidden, false);
  assert.deepEqual(c.syncClearCalls, [false]);
});

test("history controller: click remove → removeSearchHistory + refresh", () => {
  const h = loadHistoryController(["a", "b"]);
  const c = h.create();
  c.controller.open();
  const remove = c.panel.querySelectorAll(".search-history-item-remove")[0];
  c.panel._dispatch("click", {
    target: remove,
    preventDefault() {}, stopPropagation() {},
  });
  assert.deepEqual(h.getHistory(), ["b"]);
  // After refresh, only one row remains
  const selects = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(selects.length, 1);
});

test("history controller: removing last item closes panel (refresh detects empty)", () => {
  const h = loadHistoryController(["only"]);
  const c = h.create();
  c.controller.open();
  const remove = c.panel.querySelectorAll(".search-history-item-remove")[0];
  c.panel._dispatch("click", {
    target: remove,
    preventDefault() {}, stopPropagation() {},
  });
  assert.equal(c.panel.hidden, true);
});

test("history controller: click '더 보기' expands visible count", () => {
  const big = Array.from({ length: 15 }, (_, i) => `q${i}`);
  const h = loadHistoryController(big);
  const c = h.create();
  c.controller.open();
  const more = c.panel.querySelectorAll(".search-history-more")[0];
  c.panel._dispatch("click", {
    target: more,
    preventDefault() {}, stopPropagation() {},
  });
  const opts = c.panel.querySelectorAll(".search-history-item-select");
  assert.equal(opts.length, 15);
});

test("history controller: click '모두 지우기' clears history + refreshes", () => {
  const h = loadHistoryController(["a", "b", "c"]);
  const c = h.create();
  c.controller.open();
  const clearAll = c.panel.querySelectorAll(".search-history-clear")[0];
  c.panel._dispatch("click", {
    target: clearAll,
    preventDefault() {}, stopPropagation() {},
  });
  assert.deepEqual(h.getHistory(), []);
});

// ── Outside-click & refresh ─────────────────────────────────────────────────

test("history controller: document pointerdown outside closes panel", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  const outside = new (Object.getPrototypeOf(c.input).constructor)("div");
  h.fireDocumentPointerdown({ target: outside });
  assert.equal(c.panel.hidden, true);
});

test("history controller: document pointerdown inside panel keeps it open", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  // A child node inside the panel
  const select = c.panel.querySelectorAll(".search-history-item-select")[0];
  h.fireDocumentPointerdown({ target: select });
  assert.equal(c.panel.hidden, false);
});

test("history controller: document pointerdown inside toggle keeps panel open", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  h.fireDocumentPointerdown({ target: c.toggle });
  assert.equal(c.panel.hidden, false);
});

test("history controller: refresh after external history change re-renders", () => {
  const h = loadHistoryController(["a", "b"]);
  const c = h.create();
  c.controller.open();
  assert.equal(c.panel.querySelectorAll(".search-history-item-select").length, 2);
  // External mutation (e.g., another input cleared one)
  h.setHistory(["a"]);
  c.controller.refresh();
  assert.equal(c.panel.querySelectorAll(".search-history-item-select").length, 1);
});

// ── consumeEnter ────────────────────────────────────────────────────────────

test("history controller: consumeEnter returns false when closed", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  const e = keyEvent("Enter");
  assert.equal(c.controller.consumeEnter(e), false);
});

test("history controller: consumeEnter returns false when open but no active", () => {
  const h = loadHistoryController(["a"]);
  const c = h.create();
  c.controller.open();
  const e = keyEvent("Enter");
  assert.equal(c.controller.consumeEnter(e), false);
});

test("history controller: consumeEnter with active picks query + returns true", () => {
  const h = loadHistoryController(["사랑", "은혜"]);
  const c = h.create();
  c.controller.open();
  c.input._dispatch("keydown", keyEvent("ArrowDown"));  // active = 0
  const e = keyEvent("Enter");
  const result = c.controller.consumeEnter(e);
  assert.equal(result, true);
  assert.equal(c.input.value, "사랑");
  assert.deepEqual(c.onSelectCalls, ["사랑"]);
});

// ── SCOPE_HELPERS block — extractInScope / bookName ──────────────────────────
// Pure helpers: extractInScope pulls `in:<alias>` operators out of a raw query
// against an injected aliasMap (Map); bookName looks an id up in _bookMap with
// id-fallback. The block declares IN_TOKEN_RE + both functions; the loader
// supplies a settable _bookMap via prelude.

function loadScopeHelpers() {
  const ctx = { Object, Array, Set, Map, String, RegExp, console };
  vm.createContext(ctx);
  const prelude = `
    let _bookMap = null;
    function _setBookMap(m) { _bookMap = m; }
  `;
  vm.runInContext(prelude + extractBlock("SCOPE_HELPERS"), ctx, {
    filename: "search-scope-helpers.js",
  });
  return ctx;
}

const scope = loadScopeHelpers();
// 다른 realm의 배열을 이 realm의 값으로 바꿔 deepEqual로 비교한다
const plainScope = (r) => ({ q: r.q, filterBooks: Array.from(r.filterBooks) });
const ALIASES = new Map([["요한", "john"], ["창세", "genesis"], ["gen", "genesis"]]);

test("extractInScope: 연산자 없으면 키워드 그대로, ids 빈 배열", () => {
  assert.deepEqual(scope.extractInScope("사랑", ALIASES), { keyword: "사랑", ids: [] });
});

test("extractInScope: in:<별칭>을 ids로 빼고 키워드에서 제거", () => {
  assert.deepEqual(scope.extractInScope("사랑 in:요한", ALIASES),
    { keyword: "사랑", ids: ["john"] });
});

test("extractInScope: in:이 앞에 와도 동작", () => {
  assert.deepEqual(scope.extractInScope("in:gen 사랑", ALIASES),
    { keyword: "사랑", ids: ["genesis"] });
});

test("extractInScope: in: 뒤 공백 허용", () => {
  assert.deepEqual(scope.extractInScope("사랑 in: 요한", ALIASES),
    { keyword: "사랑", ids: ["john"] });
});

test("extractInScope: 여러 in:은 누적", () => {
  const r = scope.extractInScope("사랑 in:요한 in:gen", ALIASES);
  assert.equal(r.keyword, "사랑");
  assert.deepEqual(r.ids, ["john", "genesis"]);
});

test("extractInScope: 별칭은 대소문자 무시(소문자 정규화)", () => {
  assert.deepEqual(scope.extractInScope("사랑 in:GEN", ALIASES),
    { keyword: "사랑", ids: ["genesis"] });
});

test("extractInScope: 해석 안 되는 별칭은 키워드에 그대로 남김(워커가 처리)", () => {
  assert.deepEqual(scope.extractInScope("사랑 in:없는책", ALIASES),
    { keyword: "사랑 in:없는책", ids: [] });
});

test("extractInScope: 중복 공백 정리", () => {
  assert.equal(scope.extractInScope("  사랑   은혜  ", ALIASES).keyword, "사랑 은혜");
});

test("bookName: _bookMap에 있으면 한글 이름", () => {
  scope._setBookMap({ john: "요한복음", genesis: "창세기" });
  assert.equal(scope.bookName("john"), "요한복음");
});

test("bookName: 없는 id는 id 그대로 폴백", () => {
  scope._setBookMap({ john: "요한복음" });
  assert.equal(scope.bookName("unknown"), "unknown");
});

test("bookName: _bookMap이 null이어도 id 폴백(안전)", () => {
  scope._setBookMap(null);
  assert.equal(scope.bookName("john"), "john");
});

test("withoutAllScopeBooks: 고른 책을 모두 빼고, 입력 칸에 친 `in:`도 검색어에서 뺀다(ADR-049 §3 「모두 지우기」)", () => {
  assert.deepEqual(plainScope(scope.withoutAllScopeBooks("사랑", ALIASES)), { q: "사랑", filterBooks: [] });
  assert.deepEqual(plainScope(scope.withoutAllScopeBooks("사랑 in:요한 in:창세", ALIASES)), { q: "사랑", filterBooks: [] });
  assert.deepEqual(plainScope(scope.withoutAllScopeBooks("in:요한 in:창세", ALIASES)), { q: "", filterBooks: [] });
  // 모르는 책의 `in:`은 남긴다(워커가 모르는 책이라고 알린다)
  assert.deepEqual(plainScope(scope.withoutAllScopeBooks("사랑 in:요한 in:없는책", ALIASES)), { q: "사랑 in:없는책", filterBooks: [] });
  // 별칭을 받기 전에는 검색어를 그대로 둔다
  assert.deepEqual(plainScope(scope.withoutAllScopeBooks("사랑 in:요한", null)), { q: "사랑 in:요한", filterBooks: [] });
});

test("withoutScopeBook: 고른 책에서 빼고, 입력 칸에 친 `in:`의 그 책도 검색어에서 뺀다(ADR-049 §3)", () => {
  assert.deepEqual(plainScope(scope.withoutScopeBook("사랑", ["john", "genesis"], "john", ALIASES)), { q: "사랑", filterBooks: ["genesis"] });
  assert.deepEqual(plainScope(scope.withoutScopeBook("사랑 in:요한 in:창세", [], "john", ALIASES)), { q: "사랑 in:창세", filterBooks: [] });
  assert.deepEqual(plainScope(scope.withoutScopeBook("in:요한", [], "john", ALIASES)), { q: "", filterBooks: [] });
  // 별칭 표를 아직 받지 못했으면 검색어는 그대로다
  assert.deepEqual(plainScope(scope.withoutScopeBook("사랑 in:요한", ["john"], "john", null)), { q: "사랑 in:요한", filterBooks: [] });
});

test("canonOrder: 책 id를 성경의 차례로, 겹친 것은 하나로, 모르는 id는 끝에 둔다(ADR-049 §1)", () => {
  assert.deepEqual(Array.from(scope.canonOrder(["lps", "john", "x", "luke", "john"], ["gen", "luke", "john", "lps"])), ["luke", "john", "lps", "x"]);
});

// 최근 검색의 글은 찾은 낱말 뒤에 그때의 책 범위를 `in:<짧은 이름>`으로 붙인다(ADR-014 D1). 깔때기로 마르코를 고르고 「세리」를
// 찾은 기록이 「세리」로만 남아, 칩을 지운 뒤 누르면 성경 전체에서 찾던 때가 있었다(사용자 보고 2026-11-18).
const ALIAS_BY_ID = new Map([["genesis", "창세"], ["matt", "마태"], ["mark", "마르"], ["john", "요한"]]);

test("historyLabel: 범위가 없으면 낱말만", () => {
  assert.equal(scope.historyLabel("세리", [], ALIAS_BY_ID), "세리");
});

test("historyLabel: 고른 책을 in:<짧은 이름>으로 붙인다", () => {
  assert.equal(scope.historyLabel("세리", ["mark"], ALIAS_BY_ID), "세리 in:마르");
});

test("historyLabel: 고른 차례와 상관없이 성경의 차례로, 겹친 책은 한 번", () => {
  assert.equal(scope.historyLabel("사랑", ["john", "matt", "john"], ALIAS_BY_ID), "사랑 in:마태 in:요한");
});

test("historyLabel: 책 목록을 아직 못 받았거나 모르는 책은 id 그대로 뒤에", () => {
  assert.equal(scope.historyLabel("사랑", ["mark"], null), "사랑 in:mark");
  assert.equal(scope.historyLabel("사랑", ["xyz", "mark"], ALIAS_BY_ID), "사랑 in:마르 in:xyz");
});

test("historyLabel: extractInScope가 같은 낱말과 범위로 되읽는다", () => {
  const aliasMap = new Map(Array.from(ALIAS_BY_ID, ([id, alias]) => [alias, id]));
  const label = scope.historyLabel("세리와 죄인", ["mark", "matt"], ALIAS_BY_ID);
  assert.deepEqual(scope.extractInScope(label, aliasMap), { keyword: "세리와 죄인", ids: ["matt", "mark"] });
});

// ── 전례일 줄의 값 — 전례독서 화면과 엔진에서 옮겨 둔 값 ─────────────────────

test("전례일 줄의 해, 색 이름, 요일, 성탄 평일 식별자는 전례독서 화면과 엔진의 값과 같다(코드 리뷰 2026-11-16)", () => {
  // 검색 화면은 줄을 엔진을 받기 전에도 그리고, 시험이 코드 구역을 잘라 읽어 다른 모듈의 값을 받아 쓰지 않는다. 그래서 값을 옮겨 두고
  // 여기서 같은지 본다. 한쪽만 고치면 이 시험이 실패한다
  const read = (rel) => fs.readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
  const lectionary = read("js/app/lectionary.js");
  const engine = read("js/app/liturgical-engine.js");
  /** 한 줄짜리 `const NAME = 값;`의 값. 다른 상수를 쓰면 `scope`에 넣어 준다 */
  const valueOf = (source, name, scope = {}) => {
    const m = source.match(new RegExp(`^const ${name} = (.+);$`, "m"));
    assert.ok(m, name);
    return JSON.parse(JSON.stringify(vm.runInNewContext(`(${m[1]})`, scope)));
  };
  assert.deepStrictEqual(valueOf(SEARCH_SOURCE, "LECT_CYCLE_LABEL"), valueOf(lectionary, "CYCLE_LABEL"));
  assert.deepStrictEqual(valueOf(SEARCH_SOURCE, "LECT_COLOR_LABEL"), valueOf(lectionary, "COLOR_LABEL"));
  assert.deepStrictEqual(valueOf(SEARCH_SOURCE, "LECT_WEEKDAY"), valueOf(lectionary, "WEEKDAY_KO"));
  const GRID_PREFIX = valueOf(engine, "GRID_PREFIX");
  assert.strictEqual(valueOf(SEARCH_SOURCE, "LECT_CHRISTMAS_WEEKDAY"), valueOf(engine, "CHRISTMAS_WEEKDAY_PREFIX", { GRID_PREFIX }));
});

// ── QUOTE_MATCH — 따옴표를 무시하는 일치(ADR-005, 2026-11-06) ────────────────

function loadQuoteMatch() {
  const ctx = { String, Array };
  vm.createContext(ctx);
  vm.runInContext(extractBlock("QUOTE_MATCH"), ctx, { filename: "search-quote-match.js" });
  return ctx;
}

test("QUOTE_MATCH: 검색 워커와 화면 코드의 두 사본이 같다", () => {
  const workerSource = fs.readFileSync(path.resolve(__dirname, "../../js/search-worker.js"), "utf8");
  const begin = "// ── BEGIN QUOTE_MATCH ──";
  const end = "// ── END QUOTE_MATCH ──";
  const inWorker = workerSource.slice(workerSource.indexOf(begin), workerSource.indexOf(end) + end.length);
  assert.ok(workerSource.includes(begin) && workerSource.includes(end), "worker block markers");
  assert.strictEqual(extractBlock("QUOTE_MATCH"), inWorker);
});

test("MAX_SCOPE_BOOKS: 책 선택 시트와 검색 워커가 같은 한도를 쓴다(ADR-033 「책은 5권까지」)", () => {
  const workerSource = fs.readFileSync(path.resolve(__dirname, "../../js/search-worker.js"), "utf8");
  const limitOf = (src) => (src.match(/^const MAX_SCOPE_BOOKS = (\d+);$/m) || [])[1];
  assert.strictEqual(limitOf(SEARCH_SOURCE), "5");
  assert.strictEqual(limitOf(workerSource), "5");
});

test("normalizeForMatch: 따옴표 여섯 가지를 지우고 소문자로 바꾼다", () => {
  const q = loadQuoteMatch();
  assert.strictEqual(q.normalizeForMatch(`"빛이" '생겨라' “Amen” ‘x’`), "빛이 생겨라 amen x");
});

test("findMatchRanges: 곧은 따옴표 검색어가 곱슬 따옴표 본문을 찾는다", () => {
  const q = loadQuoteMatch();
  const text = "하느님께서 “빛이 생겨라!” 하시자";
  // Edge quotes of the query drop out, so the range covers 빛…! only.
  assert.deepEqual(Array.from(q.findMatchRanges(text, `"빛이 생겨라!"`), (r) => Array.from(r)), [[7, 14]]);
  assert.strictEqual(text.slice(7, 14), "빛이 생겨라!");
});

test("findMatchRanges: 따옴표 없는 검색어가 따옴표를 사이에 둔 본문을 찾고, 가운데 따옴표는 범위에 든다", () => {
  const q = loadQuoteMatch();
  const text = "하느님께서 “빛이 생겨라!” 하시자";
  const ranges = Array.from(q.findMatchRanges(text, "빛이 생겨라! 하시자"), (r) => Array.from(r));
  assert.deepEqual(ranges, [[7, text.length]]);
  assert.strictEqual(text.slice(...ranges[0]), "빛이 생겨라!” 하시자");
});

test("findMatchRanges: 겹치지 않는 여러 범위, 대소문자 무시", () => {
  const q = loadQuoteMatch();
  assert.deepEqual(Array.from(q.findMatchRanges("Aa ‘aa’ AA", "aa"), (r) => Array.from(r)), [[0, 2], [4, 6], [8, 10]]);
});

test("findMatchRanges: 따옴표만 친 검색어는 범위가 없다", () => {
  const q = loadQuoteMatch();
  assert.deepEqual(Array.from(q.findMatchRanges("“빛이 생겨라!”", `" '`)), []);
  assert.deepEqual(Array.from(q.findMatchRanges("“빛이 생겨라!”", `"`)), []);
});

test("appendTextWithHighlight: 따옴표를 사이에 둔 일치를 원래 본문 위치로 감싼다", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "하느님께서 “빛이 생겨라!” 하시자 빛이 생겨났다.", "빛이 생겨라! 하시자");
  assert.strictEqual(target.children.length, 3);
  assert.strictEqual(target.children[0].data, "하느님께서 “");
  assert.strictEqual(target.children[1].tagName, "MARK");
  assert.strictEqual(recursiveText(target.children[1]), "빛이 생겨라!” 하시자");
  assert.strictEqual(target.children[2].data, " 빛이 생겨났다.");
});

test("appendTextWithHighlight: 따옴표만 친 검색어는 강조하지 않는다", () => {
  const h = loadPureHelpers();
  const target = h.document.createElement("p");
  h.appendTextWithHighlight(target, "“빛이 생겨라!”", `"`);
  assert.strictEqual(target.children.length, 1);
  assert.strictEqual(target.children[0].nodeType, 3);
});

// 장 화면은 한 절을 조각으로 나눠 그린다(인용 앞뒤, 시의 줄마다). 조각 끝의 간격용 공백까지 그대로 넣는다.
test("splitPiecesByMatches: 인용을 사이에 둔 일치를 조각마다 나눠 준다 (갈라 3:8)", () => {
  const h = loadPureHelpers();
  // 화면이 그리는 모양: 여는 따옴표로 끝난 조각과 칩이 뒤따르는 조각에는 끝 공백이 없다.
  const parts = h.splitPiecesByMatches(
    ["성서는 아브라함에게 “", "너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "],
    "아브라함에게 너로",
  );
  assert.deepEqual(parts, [
    [{ text: "성서는 ", mark: false }, { text: "아브라함에게 “", mark: true }],
    [{ text: "너로", mark: true }, { text: " 말미암아 복을 받으리라.", mark: false }],
    [{ text: "”는 복음을 전했다. ", mark: false }],
  ]);
});

test("splitPiecesByMatches: 새 색인처럼 조각을 붙여 이은 글에서 찾는다(화면에 보이는 대로 이어 친 문구)", () => {
  const h = loadPureHelpers();
  // 칩이 뒤따르는 조각 끝에는 공백이 없다: 화면 글은 `받으리라.”는 복음`.
  assert.deepEqual(h.splitPiecesByMatches(["너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "], "받으리라.”는 복음"), [
    [{ text: "너로 말미암아 복을 ", mark: false }, { text: "받으리라.", mark: true }],
    [{ text: "”는 복음", mark: true }, { text: "을 전했다. ", mark: false }],
  ]);
});

test("splitPiecesByMatches: 옛 색인처럼 조각 사이에 공백 한 칸을 둔 문구도 찾는다", () => {
  const h = loadPureHelpers();
  // 옛 색인은 조각 사이에 공백을 넣어 `받으리라. ”는 복음`이다. 두 저장소가 따로 배포되므로 둘 다 맞아야 한다.
  assert.deepEqual(h.splitPiecesByMatches(["너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "], "받으리라. 는 복음"), [
    [{ text: "너로 말미암아 복을 ", mark: false }, { text: "받으리라.", mark: true }],
    [{ text: "”는 복음", mark: true }, { text: "을 전했다. ", mark: false }],
  ]);
  // 둘 다 맞지 않는 문구는 강조가 없다.
  const none = h.splitPiecesByMatches(["너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "], "받으리라 복음");
  assert.ok(none.every((parts) => parts.every((p) => !p.mark)));
});

test("splitPiecesByMatches: 붙여 이은 글에서 찾으면 공백 한 칸으로 이은 글은 보지 않는다", () => {
  const h = loadPureHelpers();
  // `가나`가 두 조각에 걸쳐 있으면 붙여 이은 글의 범위를 쓴다: 공백 한 칸으로 이은 글에는 이 범위가 없다.
  assert.deepEqual(h.splitPiecesByMatches(["가", "나다"], "가나"), [
    [{ text: "가", mark: true }], [{ text: "나", mark: true }, { text: "다", mark: false }],
  ]);
});

test("splitPiecesByMatches: 시의 줄 사이에 걸친 일치", () => {
  const h = loadPureHelpers();
  assert.deepEqual(
    h.splitPiecesByMatches(["야훼는 나의 목자, ", "아쉬울 것 없어라. ", "푸른 풀밭에 누워 "], "목자, 아쉬울 것"),
    [
      [{ text: "야훼는 나의 ", mark: false }, { text: "목자, ", mark: true }],
      [{ text: "아쉬울 것", mark: true }, { text: " 없어라. ", mark: false }],
      [{ text: "푸른 풀밭에 누워 ", mark: false }],
    ],
  );
});

test("splitPiecesByMatches: 일치가 여러 조각에 흩어져도 조각마다 제 몫만 받고 빈 부분이 없다", () => {
  const h = loadPureHelpers();
  assert.deepEqual(h.splitPiecesByMatches(["사랑 ", "은 ", "사랑"], "사랑"), [
    [{ text: "사랑", mark: true }, { text: " ", mark: false }],
    [{ text: "은 ", mark: false }],
    [{ text: "사랑", mark: true }],
  ]);
});

test("splitPiecesByMatches: 조각을 이으면 본문 그대로이고 빈 부분이 없다", () => {
  const h = loadPureHelpers();
  const cases = [
    [["성서는 아브라함에게 “ ", "너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "], "아브라함에게 너로"],
    [["사랑 ", "사랑 ", "사랑"], "사랑 사랑"],
    [["가나다 ", "라마바"], "다 라"],
    [["가", "나", "다", "라"], "나 다"],
    [["abc ", "DEF "], "c d"],
    [["하나 ", "", "둘"], "하나 둘"],
    [["“", "빛이 생겨라!” ", "하시자"], "생겨라! 하시자"],
  ];
  for (const [pieces, query] of cases) {
    const parts = h.splitPiecesByMatches(pieces, query);
    assert.strictEqual(parts.length, pieces.length);
    parts.forEach((ps, i) => {
      assert.strictEqual(ps.map((p) => p.text).join(""), pieces[i], `${query}: 조각 ${i}`);
      assert.ok(ps.every((p) => p.text !== ""), `${query}: 조각 ${i}에 빈 부분`);
    });
  }
});

test("splitPiecesByMatches: 일치가 없거나 검색어가 비면 조각마다 표시 없는 한 부분이고, 빈 조각은 부분이 없다", () => {
  const h = loadPureHelpers();
  assert.deepEqual(h.splitPiecesByMatches(["사랑은 ", "오래 참고"], "축복"), [
    [{ text: "사랑은 ", mark: false }], [{ text: "오래 참고", mark: false }],
  ]);
  assert.deepEqual(h.splitPiecesByMatches(["가", "나"], null), [[{ text: "가", mark: false }], [{ text: "나", mark: false }]]);
  assert.deepEqual(h.splitPiecesByMatches(["가", "", "나"], `"`), [[{ text: "가", mark: false }], [], [{ text: "나", mark: false }]]);
});

// ── highlightTextNodes — 장 화면이 한 절의 글 노드를 한꺼번에 강조 ─────────────

function verseWithPieces(h, pieces) {
  const verse = h.document.createElement("span");
  verse.appendChild(h.document.createElement("sup"));
  const nodes = pieces.map((t) => verse.appendChild(h.document.createTextNode(t)));
  return { verse, nodes };
}

test("highlightTextNodes: 조각을 넘는 일치를 감싸고 본문은 한 글자도 바뀌지 않는다", () => {
  const h = loadPureHelpers();
  const { verse, nodes } = verseWithPieces(h, ["성서는 아브라함에게 “", "너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "]);
  const before = verse.textContent;
  h.highlightTextNodes(nodes, "아브라함에게 너로");
  assert.strictEqual(verse.textContent, before);
  const kinds = verse.children.map((c) => (c.tagName === "MARK" ? `mark:${c.textContent}` : c.tagName || `text:${c.data}`));
  assert.deepEqual(kinds, ["SUP", "text:성서는 ", "mark:아브라함에게 “", "mark:너로", "text: 말미암아 복을 받으리라.", "text:”는 복음을 전했다. "]);
  // 일치가 없는 조각은 같은 노드로 남고, 바뀐 조각의 옛 노드는 빠진다.
  assert.ok(verse.children.includes(nodes[2]));
  assert.ok(!verse.children.includes(nodes[0]) && !verse.children.includes(nodes[1]));
  assert.ok(verse.children.filter((c) => c.tagName === "MARK").every((m) => m.attributes.class === "search-highlight" && m.attributes.role === "presentation"));
});

test("highlightTextNodes: 닫는 따옴표를 사이에 둔 문구를 화면에 보이는 대로 쳐도, 옛 색인의 모양으로 쳐도 강조한다", () => {
  const h = loadPureHelpers();
  for (const query of ["받으리라.”는 복음", "받으리라. 는 복음"]) {
    const { verse, nodes } = verseWithPieces(h, ["성서는 아브라함에게 “", "너로 말미암아 복을 받으리라.", "”는 복음을 전했다. "]);
    const before = verse.textContent;
    h.highlightTextNodes(nodes, query);
    assert.strictEqual(verse.textContent, before, query);
    const marks = verse.children.filter((c) => c.tagName === "MARK").map((m) => m.textContent);
    assert.deepEqual(marks, ["받으리라.", "”는 복음"], query);
  }
});

test("highlightTextNodes: 검색어가 비었거나 일치가 없으면 노드를 건드리지 않는다", () => {
  const h = loadPureHelpers();
  for (const query of [null, "", `"`, "없는말"]) {
    const { verse, nodes } = verseWithPieces(h, ["사랑은 ", "오래 참고"]);
    h.highlightTextNodes(nodes, query);
    assert.deepEqual(verse.children.slice(1), nodes, `검색어 ${JSON.stringify(query)}`);
  }
});

test("normalizeForMatch: 이어진 공백(줄바꿈과 탭 포함)을 한 칸으로 접는다", () => {
  const q = loadQuoteMatch();
  assert.strictEqual(q.normalizeForMatch("아브라함에게 “ 너로"), "아브라함에게 너로");
  assert.strictEqual(q.normalizeForMatch("가  나\t\n다"), "가 나 다");
  assert.strictEqual(q.normalizeForMatch(" 가 "), " 가 ");
});

test("findMatchRanges: 이어진 공백도 공백 한 칸의 검색어와 맞고, 범위는 원래 본문의 위치다", () => {
  const q = loadQuoteMatch();
  assert.deepEqual(Array.from(q.findMatchRanges("아브라함에게 “ 너로 말미암아", "아브라함에게 너로")[0]), [0, 11]);
  assert.deepEqual(Array.from(q.findMatchRanges("빛이  생겨라", "빛이 생겨라")[0]), [0, 7]);
});

test("findMatchRanges: 일치 여부가 normalizeForMatch로 비교한 결과와 같다", () => {
  const q = loadQuoteMatch();
  const texts = ["아브라함에게 “ 너로 말미암아", "빛이  생겨라", "A\tB\nC", "“ ‘ 가 ’ ”", "   ", "가나다", "하느님께서 “빛이 생겨라!” 하시자"];
  const queries = ["아브라함에게 너로", "빛이 생겨라", "a b c", "가", "나다", "생겨라! 하시자", "생겨라!” 하시자", "없는말"];
  for (const t of texts) {
    for (const query of queries) {
      const found = q.findMatchRanges(t, query).length > 0;
      const expected = q.normalizeQuery(query) !== "" && q.normalizeForMatch(t).includes(q.normalizeQuery(query));
      assert.strictEqual(found, expected, `${JSON.stringify(t)} / ${JSON.stringify(query)}`);
    }
  }
});

test("normalizeQuery: 따옴표를 지운 뒤 앞뒤 공백도 지운다", () => {
  const q = loadQuoteMatch();
  assert.strictEqual(q.normalizeQuery(`" '`), "");
  assert.strictEqual(q.normalizeQuery(`" 빛이 생겨라 "`), "빛이 생겨라");
});

test("normalizeQuery: 가운데에 홀로 있는 따옴표를 지운 뒤 공백을 한 칸으로 접는다", () => {
  const q = loadQuoteMatch();
  assert.strictEqual(q.normalizeQuery(`빛이 " 생겨라`), "빛이 생겨라");
  assert.deepEqual(
    Array.from(q.findMatchRanges("하느님께서 “빛이 생겨라!”", `빛이 " 생겨라`), (r) => Array.from(r)),
    [[7, 13]],
  );
});

test("buildSnippet: 따옴표를 사이에 둔 늦은 일치에서 일치 앞을 잘라 보이고 강조한다", () => {
  const h = loadPureHelpers();
  // The match starts at 61 (> 40), so the snippet is clipped 30 chars before it.
  const text = "ㄱ".repeat(60) + " “빛이 생겨라!” 하시자 " + "ㄴ".repeat(120);
  const frag = h.buildSnippet(text, "빛이 생겨라! 하시자");
  const span = frag.children[0];
  const out = recursiveText(span);
  assert.ok(out.startsWith("…"), `expected leading ellipsis, got: ${out.slice(0, 5)}`);
  assert.ok(out.endsWith("…"), `expected trailing ellipsis, got tail: ${out.slice(-5)}`);
  const mark = span.children.find((c) => c.tagName === "MARK");
  assert.ok(mark, "expected a <mark>");
  assert.strictEqual(recursiveText(mark), "빛이 생겨라!” 하시자");
});


// ── 전례독서 검색 결과(ADR-044 §1) ───────────────────────────────────────────

test("ensureSearchWorker: init에 전례독서 색인 주소를 넘긴다(ADR-044)", () => {
  const m = loadWorkerBlock();
  m.ensureSearchWorker();
  assert.strictEqual(m.workerInstances[0].posts[0].lectionaryUrl, "/data/lectionary/search-lectionary.json");
});

test("nextLectionary: 늦게 온 전례일 메시지를 기다린다", async () => {
  const m = loadWorkerBlock();
  m.doSearch("요한 3:16", 1, 10, null);
  const w = m.workerInstances[0];
  const waiting = m.nextLectionary(1, 1000);
  w._emit({ type: "lectionary", searchId: 1, lectionary: { kind: "passage", items: [] } });
  const msg = await waiting;
  assert.strictEqual(msg.searchId, 1);
  assert.strictEqual(msg.lectionary.kind, "passage");
});

test("nextLectionary: 이미 온 메시지는 바로 돌려준다", async () => {
  const m = loadWorkerBlock();
  m.doSearch("요한 3:16", 1, 10, null);
  m.workerInstances[0]._emit({ type: "lectionary", searchId: 1, lectionary: null });
  const msg = await m.nextLectionary(1, 1000);
  assert.strictEqual(msg.searchId, 1);
  assert.strictEqual(msg.lectionary, null);
});

test("nextLectionary: 시간이 지나면 null이다", async () => {
  const m = loadWorkerBlock();
  m.doSearch("요한 3:16", 1, 10, null);
  assert.strictEqual(await m.nextLectionary(1, 5), null);
  // 시간이 지난 뒤에 온 메시지는 다음 기다림이 받는다(늦게 온 전례일을 결과에 더한다)
  const later = m.nextLectionary(1, Infinity);
  m.workerInstances[0]._emit({ type: "lectionary", searchId: 1, lectionary: null });
  assert.strictEqual((await later).searchId, 1);
});

test("nextLectionary: 새 검색이 시작되면 기다리던 것은 null이고 옛 검색의 메시지는 버린다", async () => {
  const m = loadWorkerBlock();
  m.doSearch("요한 3:16", 1, 10, null);
  const waiting = m.nextLectionary(1, Infinity);
  m.doSearch("베드로", 1, 10, null);
  assert.strictEqual(await waiting, null);
  m.workerInstances[0]._emit({ type: "lectionary", searchId: 1, lectionary: null });
  assert.strictEqual(await m.nextLectionary(2, 5), null);
  assert.strictEqual(await m.nextLectionary(1, 5), null, "끝난 검색은 기다리지 않는다");
});

test("nextLectionary: 옛 검색의 늦은 메시지는 새 검색의 기다림을 깨우지 않는다", async () => {
  const m = loadWorkerBlock();
  m.doSearch("요한 3:16", 1, 10, null);
  m.doSearch("베드로", 1, 10, null);
  const waiting = m.nextLectionary(2, 30);
  m.workerInstances[0]._emit({ type: "lectionary", searchId: 1, lectionary: { kind: "passage", items: [] } });
  assert.strictEqual(await waiting, null);
});

test("buildSearchUrl: 전례일 알약만 주소에 적는다", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.buildSearchUrl({ q: "베드로", group: "lectionary" }), "/search?q=%EB%B2%A0%EB%93%9C%EB%A1%9C&group=lectionary");
  assert.strictEqual(h.buildSearchUrl({ q: "베드로", group: "bible" }), "/search?q=%EB%B2%A0%EB%93%9C%EB%A1%9C");
  assert.strictEqual(h.buildSearchUrl({ q: "베드로" }), "/search?q=%EB%B2%A0%EB%93%9C%EB%A1%9C");
});

test("synonymNote: 받침에 따라 을과 를, 으로와 로를 고른다(ㄹ 받침은 로)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.synonymNote([{ from: "주님 부활 대축일", to: "부활대축일" }]), "‘주님 부활 대축일’을 ‘부활대축일’로 찾았습니다.");
  assert.strictEqual(h.synonymNote([{ from: "종려주일", to: "성지주일" }]), "‘종려주일’을 ‘성지주일’로 찾았습니다.");
  assert.strictEqual(h.synonymNote([{ from: "바오로", to: "바울로" }]), "‘바오로’를 ‘바울로’로 찾았습니다.");
  assert.strictEqual(h.synonymNote([{ from: "주현절", to: "공현" }]), "‘주현절’을 ‘공현’으로 찾았습니다.");
  assert.strictEqual(h.synonymNote([{ from: "가", to: "나" }, { from: "다", to: "라" }]), "‘가’를 ‘나’로, ‘다’를 ‘라’로 찾았습니다.");
});

// 검색이 모르는 책 이름을 in: 뒤에 쳤을 때의 설명(ADR-005 「검색 연산자 `in:`」). 결과 위의 한 줄 「in:없는책 — 알 수 없는 책
// 별칭입니다」가 고치는 방법을 알려 주지 않던 때가 있었다(사용자 결정 2026-11-18).
test("unknownBookNote: 받침에 따라 이라는과 라는을 고르고, 여러 이름은 쉼표로 잇는다", () => {
  const h = loadPureHelpers();
  const tail = " 책을 찾지 못했어요. in: 뒤에는 마르, 마르코처럼 책 이름을 적어 주세요.";
  assert.strictEqual(h.unknownBookNote(["없는책"]), `‘없는책’이라는${tail}`);
  assert.strictEqual(h.unknownBookNote(["마가"]), `‘마가’라는${tail}`);
  assert.strictEqual(h.unknownBookNote(["foo"]), `‘foo’라는${tail}`);
  assert.strictEqual(h.unknownBookNote(["없는책", "마가"]), `‘없는책’, ‘마가’라는${tail}`);
});

test("fixedDateText: 색인의 「MM.DD」를 「M월 D일」로", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.fixedDateText("12.29"), "12월 29일");
  assert.strictEqual(h.fixedDateText("01.02"), "1월 2일");
  assert.strictEqual(h.fixedDateText(null), null);
  assert.strictEqual(h.fixedDateText("1229"), null);
});

test("lectCyclesText: 주기는 쉼표로, 트랙은 「와」로 잇는다(ADR-038 §3-1)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.lectCyclesText([{ year: "A", track: null }]), "가해");
  assert.strictEqual(h.lectCyclesText([{ year: "A", track: null }, { year: "C", track: null }]), "가해, 다해");
  assert.strictEqual(h.lectCyclesText([{ year: "A", track: 2 }, { year: "A", track: 1 }]), "가해, 연속 독서와 복음 주제");
  assert.strictEqual(h.lectCyclesText([{ year: null, track: null }]), "");
});

const SET = (id, year = null, track = null) => ({ id, year, track, setNo: 1, label: "" });

test("lectSlugHref: 구절은 찾은 독서의 세트들, 이름은 그 전례일의 세트들, 세트가 없으면 전례일 키(ADR-044 §1)", () => {
  const h = loadPureHelpers();
  const passage = {
    obs: { key: "advent-1-mon" }, sets: [SET("advent-1-mon-A-t1-s1"), SET("advent-1-mon-B-t1-s1"), SET("advent-1-mon-C-t1-s1")],
    hits: [{ slot: 0, sets: [SET("advent-1-mon-B-t1-s1"), SET("advent-1-mon-C-t1-s1")] }, { slot: 3, sets: [SET("advent-1-mon-B-t1-s1")] }],
  };
  assert.strictEqual(h.lectSlugHref(passage), "/lectionary/d/advent-1-mon-B-t1-s1,advent-1-mon-C-t1-s1");
  const name = { obs: { key: "t-성령강림대축일" }, sets: [SET("pentecost-A-t1-s1"), SET("pentecost-B-t1-s1")] };
  assert.strictEqual(h.lectSlugHref(name), "/lectionary/d/pentecost-A-t1-s1,pentecost-B-t1-s1");
  assert.strictEqual(h.lectSlugHref({ obs: { key: "d0523-학교" }, sets: [] }), `/lectionary/d/${encodeURIComponent("d0523-학교")}`);
});

const OBS = (o) => ({ key: "k", name: "이름", kind: "temporal", date: null, rank: null, common: null, order: 0, ...o });

test("lectRowOf: 구절 결과는 찾은 독서의 자리와 독서 데이터의 표기, 주기를 적는다", () => {
  const h = loadPureHelpers();
  const item = {
    obs: OBS({ key: "lent-2-sun", name: "사순2주일" }), sets: [SET("lent-2-sun-A-t1-s1", "A")],
    hits: [{ slot: 3, rows: [["john", 3, 1, 17]], sets: [SET("lent-2-sun-A-t1-s1", "A")] }],
  };
  const row = h.lectRowOf(item, (id, slot) => (id === "lent-2-sun-A-t1-s1" && slot === "gospel" ? "요한 3:1-17" : null));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(row)), {
    title: "사순2주일", href: "/lectionary/d/lent-2-sun-A-t1-s1", bold: true,
    found: { slot: "복음", text: "요한 3:1-17" }, colors: [], meta: ["가해"], lines: [], label: "사순2주일, 복음 요한 3:1-17, 가해",
    nexts: [],
  });
});

test("lectRowOf: 독서 데이터의 표기가 없으면 색인의 숫자로 만든다(송가 행은 뺀다)", () => {
  const h = loadPureHelpers();
  const item = {
    obs: OBS({ key: "advent-2-sun", name: "대림2주일" }), sets: [],
    hits: [{ slot: 1, rows: [["cant", 3, 1, 12], ["luke", 1, 68, 79]], sets: [SET("advent-2-sun-C-t1-s1", "C")] }],
  };
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.lectRowOf(item, () => null).found)), { slot: "성시", text: "루가 1:68-79" });
  assert.strictEqual(h.lectNotation([["john", 3, 14, 21], ["john", 3, 25, 25], ["john", 4, 1, 2]]), "요한 3:14-21, 25, 4:1-2");
});

test("lectRowOf: 이름 결과는 정해진 날짜를 적고, 고유 독서가 없으면 등급을 적는다(공통 독서만 있는 성인도)", () => {
  const h = loadPureHelpers();
  const same = h.lectRowOf({ obs: OBS({ key: "d1229-성탄주간", name: "성탄주간", date: "12.29" }), sets: [SET("d1229-성탄주간-t1-s1")] }, () => null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(same.meta)), ["12월 29일"]);
  assert.strictEqual(same.label, "성탄주간, 12월 29일");
  assert.strictEqual(same.bold, false);
  const common = h.lectRowOf({ obs: OBS({ kind: "sanctoral", name: "성 아무개", date: "03.01", rank: "minor_feast", common: "martyr" }), sets: [] }, () => null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([common.meta, common.lines])), [["3월 1일"], ["축일"]]);
  const school = h.lectRowOf({ obs: OBS({ kind: "sanctoral", name: "학교 개교", date: "05.23", rank: "commemoration" }), sets: [] }, () => null);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(school.lines)), ["기념일"]);
});

test("lectRowOf: 축일 이상과 주일만 굵게 한다(캘린더 목록과 같다)", () => {
  const h = loadPureHelpers();
  const bold = (o) => h.lectRowOf({ obs: OBS(o), sets: [] }, () => null).bold;
  assert.strictEqual(bold({ rank: "minor_feast", kind: "sanctoral" }), true);
  assert.strictEqual(bold({ rank: "principal" }), true);
  assert.strictEqual(bold({ key: "ordinary-7-sun", name: "연중7주일" }), true);
  assert.strictEqual(bold({ key: "christmas-1-sun", name: "성탄1주일" }), true);
  assert.strictEqual(bold({ key: "t-가정주일", name: "가정주일" }), true);
  assert.strictEqual(bold({ rank: "commemoration", kind: "sanctoral", name: "어느 주일 기념" }), false, "월별 축일의 이름은 보지 않는다");
  assert.strictEqual(bold({ key: "ordinary-7-mon", name: "연중7주 월요일" }), false);
});

test("buildLectRow: 줄 전체가 링크 하나이고 이름은 aria-label에 모은다", () => {
  const h = loadPureHelpers();
  const li = h.buildLectRow({
    title: "사순2주일", href: "/lectionary/d/x", bold: true, found: { slot: "복음", text: "요한 3:1-17" }, colors: [], meta: ["가해"], lines: [],
    label: "L", nexts: [],
  });
  assert.strictEqual(li.children.length, 1);
  const a = li.children[0];
  assert.strictEqual(a.tagName, "A");
  assert.strictEqual(a.className, "cal-row cal-row--major");
  assert.strictEqual(a.getAttribute("href"), "/lectionary/d/x");
  assert.strictEqual(a.getAttribute("aria-label"), "L");
  assert.strictEqual(recursiveText(a), "사순2주일복음요한 3:1-17가해");
});

// 엔진의 날짜 계산 가운데 `lectDaysOf`가 묻는 것: 날 더하기와 전례년(대림 1주일은 12월 3일이나 그 앞의 주일부터 다음 대림 1주일 전날까지)
const addDaysUtc = (date, n) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10);
const advent1Utc = (y) => {
  const t = new Date(Date.UTC(y, 11, 3));
  return addDaysUtc(t.toISOString().slice(0, 10), -t.getUTCDay());
};
const LY_ENGINE = {
  addDays: addDaysUtc,
  liturgicalYearSpan(date) {
    const y = Number(date.slice(0, 4));
    const from = date >= advent1Utc(y) ? advent1Utc(y) : advent1Utc(y - 1);
    return { from, to: addDaysUtc(advent1Utc(Number(from.slice(0, 4)) + 1), -1) };
  },
};
const DAY = (date, o = {}) => ({ date, obs: "grid:lent-2-sunday", setId: "lent-2-sun-A-t1-s1", track: null, name: "사순 2주일", colors: ["violet"], ...o });

test("lectDayText: 지난날은 날짜만, 앞날은 「다음」, 오늘은 「오늘」이고 해를 늘 적는다(ADR-044 §1, 2026-11-19)", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.lectDayText("2026-03-01", "2026-11-16"), "2026년 3월 1일 (일)");
  assert.strictEqual(h.lectDayText("2029-02-25", "2026-11-16"), "다음 2029년 2월 25일 (일)");
  assert.strictEqual(h.lectDayText("2026-11-16", "2026-11-16"), "오늘");
  assert.strictEqual(h.lectDayText("2026-12-30", "2026-11-16", true), "다음 2026년 12월 30일 수요일");
});

test("lectRowOf: 날짜를 계산했으면 열리는 날의 색과 날짜를 적고, 지난날이면 다음에 읽는 날의 링크를 둔다(ADR-044 §1)", () => {
  const h = loadPureHelpers();
  const item = {
    obs: OBS({ key: "lent-2-sun", name: "사순2주일" }), sets: ["A", "B", "C"].map((y) => SET(`lent-2-sun-${y}-t1-s1`, y)),
    hits: [{ slot: 3, rows: [["john", 3, 1, 17]], sets: [SET("lent-2-sun-A-t1-s1", "A")] }],
  };
  const days = { open: DAY("2026-03-01"), next: DAY("2029-02-25"), nextIds: ["lent-2-sun-A-t1-s1"], year: null, cycles: [] };
  const row = JSON.parse(JSON.stringify(h.lectRowOf(item, () => "요한 3:1-17", days, "2026-11-16")));
  assert.deepStrictEqual(row.colors, [{ code: "violet", name: "자색" }]);
  assert.deepStrictEqual(row.meta, ["가해", "2026년 3월 1일 (일)"]);
  assert.strictEqual(row.label, "사순2주일, 복음 요한 3:1-17, 자색, 가해, 2026년 3월 1일 일요일");
  assert.strictEqual(row.href, "/lectionary/d/lent-2-sun-A-t1-s1");
  assert.deepStrictEqual(row.nexts, [{
    href: "/lectionary/d/lent-2-sun-A-t1-s1?from=2029-02-25", label: "사순2주일, 다음 2029년 2월 25일 일요일",
    prefix: "다음", date: "2029년 2월 25일 (일)",
  }]);
  // 앞날이나 오늘을 열면 다음 링크가 없다
  const ahead = h.lectRowOf(item, () => null, { open: DAY("2027-03-07"), next: null, nextIds: [], year: null, cycles: [] }, "2026-11-16");
  assert.strictEqual(ahead.nexts.length, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(ahead.meta)), ["가해", "다음 2027년 3월 7일 (일)"]);
});

test("lectRowOf: 날짜가 정해진 줄은 계산한 날짜가 그 날짜를 대신하고, 성탄 평일은 열리는 날의 이름이 제목이다(ADR-044 §3)", () => {
  const h = loadPureHelpers();
  const item = { obs: OBS({ key: "d1230-성탄주간", name: "성탄주간", date: "12.30" }), sets: [SET("d1230-성탄주간-t1-s1")] };
  const open = DAY("2025-12-30", { obs: "grid:christmas-x-weekday-tue", setId: "d1230-성탄주간-t1-s1", name: "성탄 1주 화요일", colors: ["white"] });
  const next = DAY("2026-12-30", { obs: "grid:christmas-x-weekday-wed", setId: "d1230-성탄주간-t1-s1", name: "성탄 1주 수요일", colors: ["white"] });
  const row = h.lectRowOf(item, () => null, { open, next, nextIds: ["d1230-성탄주간-t1-s1"], year: null, cycles: [] }, "2026-11-16");
  assert.strictEqual(row.title, "성탄 1주 화요일");
  // 해마다 같은 날짜의 같은 독서라 다음 링크도 다음 해의 날도 없다(ADR-044 §1)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(row.meta)), ["2025년 12월 30일 (화)"]);
  assert.strictEqual(row.nexts.length, 0);
  // 아직 계산하지 못했으면 색인의 이름과 정해진 날짜다
  const before = h.lectRowOf(item, () => null, null, "");
  assert.strictEqual(before.title, "성탄주간");
  assert.deepStrictEqual(JSON.parse(JSON.stringify([before.meta, before.colors, before.nexts])), [["12월 30일"], [], []]);
  // 성탄 평일이 아닌 줄은 열리는 날의 이름이 달라도(「사순 2주일」) 색인의 이름이다
  const lent = { obs: OBS({ key: "lent-2-sun", name: "사순2주일" }), sets: [SET("lent-2-sun-A-t1-s1", "A")] };
  assert.strictEqual(h.lectRowOf(lent, () => null, { open: DAY("2026-03-01"), next: null, nextIds: [], year: null, cycles: [] }, "2026-11-16").title, "사순2주일");
});

// 연도를 붙인 이름 검색이 찾은 그해의 날(엔진 YearDay)
const YDAY = (date, o = {}) => ({ kind: "kept", date, obs: "x", setId: null, track: null, name: "", colors: ["white"], from: null, by: null, ...o });

test("lectRowOf: 연도를 붙여 찾은 줄은 그해의 날을 열고, 해에 따라 다른 독서는 그해의 해를 적고, 다른 날 링크는 없다(ADR-044 §4)", () => {
  const h = loadPureHelpers();
  const sets = [SET("advent-1-sun-A-t1-s1", "A"), SET("advent-1-sun-B-t1-s1", "B"), SET("advent-1-sun-C-t1-s1", "C")];
  const item = { obs: OBS({ key: "t-대림1주일", name: "대림1주일", rank: "privileged_sunday" }), sets,
    yearDay: YDAY("2027-11-28", { obs: "t-대림1주일", setId: "advent-1-sun-C-t1-s1", colors: ["violet"] }) };
  const row = JSON.parse(JSON.stringify(h.lectRowOf(item, () => null, null, "2026-11-17")));
  assert.deepStrictEqual(row, {
    title: "대림1주일", bold: true, found: null,
    href: "/lectionary/d/advent-1-sun-A-t1-s1,advent-1-sun-B-t1-s1,advent-1-sun-C-t1-s1?from=2027-11-28",
    colors: [{ code: "violet", name: "자색" }], meta: ["다해", "다음 2027년 11월 28일 (일)"], lines: [],
    label: "대림1주일, 자색, 다해, 다음 2027년 11월 28일 일요일", nexts: [],
  });
});

test("lectRowOf: 연도를 붙여 찾은 줄은 옮겨 온 날과 겹친 날의 사정을 적고, 겹친 날은 그날의 기본 화면을 연다", () => {
  const h = loadPureHelpers();
  const nicola = { obs: OBS({ key: "d1206-성-니콜라", name: "성 니콜라", kind: "sanctoral", date: "12.06", rank: "major_feast" }),
    sets: [SET("d1206-성-니콜라-t1-s1")], yearDay: YDAY("2026-12-07", { kind: "moved", from: "2026-12-06", setId: "d1206-성-니콜라-t1-s1" }) };
  const moved = h.lectRowOf(nicola, () => null, null, "2026-11-17");
  assert.deepStrictEqual(JSON.parse(JSON.stringify([moved.meta, moved.lines])), [["다음 2026년 12월 7일 (월)"], ["12월 6일에서 옮겨 옴"]]);
  assert.strictEqual(moved.href, `/lectionary/d/${encodeURIComponent("d1206-성-니콜라-t1-s1")}?from=2026-12-07`);
  assert.strictEqual(moved.label, "성 니콜라, 백색, 다음 2026년 12월 7일 월요일, 12월 6일에서 옮겨 옴");
  // 고유 독서가 없는 성인: 등급 줄 아래에 겹침
  const cranmer = { obs: OBS({ key: "d0321-토마스-크랜머", name: "토마스 크랜머", kind: "sanctoral", date: "03.21", rank: "minor_feast" }),
    sets: [], yearDay: YDAY("2027-03-21", { kind: "overlap", by: "성지주일", colors: ["red"] }) };
  const overlap = h.lectRowOf(cranmer, () => null, null, "2026-11-17");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(overlap.lines)), ["축일", "성지주일과 겹침"]);
  assert.strictEqual(overlap.href, "/lectionary/2027-03-21");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(overlap.colors)), [{ code: "red", name: "적색" }]);
  const by = (name) => h.lectRowOf({ ...cranmer, yearDay: YDAY("2027-03-21", { kind: "overlap", by: name }) }, () => null, null, "2026-11-17").lines[1];
  assert.strictEqual(by("성모 마리아"), "성모 마리아와 겹침", "받침 없는 이름 뒤는 「와」");
  assert.strictEqual(by(null), "다른 전례일과 겹침");
  // 성인 축일은 괄호 안의 설명을 떼고 이름 뒤에 「축일」을 붙인다. 「날」로 끝나면 붙이지 않는다. 주일과 국가 명절은 이름 그대로다
  const saint = (name, bySaint) => h.lectRowOf({ ...cranmer, yearDay: YDAY("2027-03-21", { kind: "overlap", by: name, bySaint }) },
    () => null, null, "2026-11-17").lines[1];
  assert.strictEqual(saint("성 니콜라(대한성공회 수호성인, 미라의 주교, 326년)", true), "성 니콜라 축일과 겹침");
  assert.strictEqual(saint("사도 성 장 야고보", true), "사도 성 장 야고보 축일과 겹침");
  assert.strictEqual(saint("성 십자가의 날", true), "성 십자가의 날과 겹침");
  assert.strictEqual(saint("추석 명절", false), "추석 명절과 겹침");
  assert.strictEqual(saint("연중 20주일", false), "연중 20주일과 겹침");
});

test("lectRowOf: 연도를 붙여 찾은 성탄 평일은 그해의 이름이 제목이다", () => {
  const h = loadPureHelpers();
  const item = { obs: OBS({ key: "d0102-성탄주간", name: "성탄주간", date: "01.02" }), sets: [SET("d0102-성탄주간-t1-s1")],
    yearDay: YDAY("2027-01-02", { obs: "grid:christmas-x-weekday-sat", setId: "d0102-성탄주간-t1-s1", name: "성탄 1주 토요일" }) };
  assert.strictEqual(h.lectRowOf(item, () => null, null, "2026-11-17").title, "성탄 1주 토요일");
});

test("yearRowsOf: 줄은 날짜 차례라 해의 차례로 묶이고, 그해에 지키지 않는 전례일은 빼고, 같은 날은 이름 결과의 차례다(ADR-044 §4)", () => {
  const h = loadPureHelpers();
  const a = { obs: OBS({ key: "a", name: "가" }), sets: [] };
  const b = { obs: OBS({ key: "b", name: "나" }), sets: [] };
  const c = { obs: OBS({ key: "c", name: "다" }), sets: [] };
  const perYear = [
    { year: 2026, days: [YDAY("2026-12-01"), YDAY("2026-01-05"), null], lunar: true },
    { year: 2027, days: [YDAY("2027-03-01"), YDAY("2027-03-01"), YDAY("2027-02-01")], lunar: true },
  ];
  const { items, notes } = h.yearRowsOf([a, b, c], perYear, { from: 2026, to: 2027, capped: false });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(items.map((it) => [it.obs.key, it.yearDay.date]))),
    [["b", "2026-01-05"], ["a", "2026-12-01"], ["c", "2027-02-01"], ["a", "2027-03-01"], ["b", "2027-03-01"]]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(notes)), []);
});

test("yearRowsOf: 2050년보다 늦은 해도 자르지 않고 그해의 날을 보인다(ADR-044 §4, 2026-11-18)", () => {
  const h = loadPureHelpers();
  const nicola = { obs: OBS({ key: "d1206", name: "성 니콜라" }), sets: [] };
  const rows = (perYear, years) => JSON.parse(JSON.stringify(h.yearRowsOf([nicola], perYear, years, { from: 2025, to: 2050 })));
  const years = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ year: from + i, days: [YDAY(`${from + i}-12-06`)], lunar: from + i <= 2050 }));
  const late = rows(years(2058, 2062), { from: 2058, to: 2062, capped: false });
  assert.deepStrictEqual(late.items.map((it) => it.yearDay.date), ["2058-12-06", "2059-12-06", "2060-12-06", "2061-12-06", "2062-12-06"]);
  assert.deepStrictEqual(late.notes, [], "음력으로 지키는 전례일이 아니면 음력 자료를 알리지 않는다");
  assert.deepStrictEqual(rows(years(2045, 2054), { from: 2045, to: 2054, capped: true }).notes,
    ["연도 범위는 10년까지 찾습니다. 2045~2054년의 날을 보입니다."]);
});

test("yearRowsOf: 찾은 전례일이 없으면 줄도 알림도 없다(범위를 잘랐어도, 코드 리뷰 2026-11-17)", () => {
  const h = loadPureHelpers();
  const empty = h.yearRowsOf([], [{ year: 2000, days: [], lunar: false }], { from: 2000, to: 2009, capped: true });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(empty)), { items: [], notes: [] });
});

test("looksLikeYearQuery: 연도를 붙인 검색어는 성탄 평일 이름을 기다리지 않는다(코드 리뷰 2026-11-17)", () => {
  const h = loadPureHelpers();
  for (const q of ["2027 성탄1주", "2027년 성탄 1주 수요일", "성탄 1주 2027년", "2024-2026 성탄", "2024~2026 성탄주간"]) {
    assert.strictEqual(h.looksLikeYearQuery(q), true, q);
  }
  for (const q of ["성탄 1주 화요일", "성탄주간", "2026-12-25 성탄", "성탄 2027-01-02"]) assert.strictEqual(h.looksLikeYearQuery(q), false, q);
});

test("yearRowsOf: 그해의 이름으로만 찾은 성탄 평일은 그해의 이름이 맞는 날만 둔다", () => {
  const h = loadPureHelpers();
  const xmas = { obs: OBS({ key: "d0102-성탄주간", name: "성탄주간" }), sets: [], yearNames: ["성탄 1주 토요일"] };
  const perYear = [
    { year: 2027, days: [YDAY("2027-01-02", { name: "성탄 1주 토요일" })], lunar: true },
    { year: 2028, days: [YDAY("2028-01-02", { name: "성탄 2주 일요일" })], lunar: true },
  ];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.yearRowsOf([xmas], perYear, { from: 2027, to: 2028, capped: false }).items.map((it) => it.yearDay.date))), ["2027-01-02"]);
});

test("yearRowsOf: 범위를 자른 것, 음력 날짜 자료가 없는 해, 줄이 하나도 없는 해를 적는다", () => {
  const h = loadPureHelpers();
  const notes = (found, perYear, years, span = null) => JSON.parse(JSON.stringify(h.yearRowsOf(found, perYear, years, span).notes));
  const plainObs = { obs: OBS({ key: "ordinary-6-sun", name: "연중6주일" }), sets: [] };
  assert.deepStrictEqual(notes([plainObs], [{ year: 2027, days: [null], lunar: true }], { from: 2027, to: 2027, capped: false }),
    ["2027년에는 검색하신 전례일을 지키지 않습니다."]);
  assert.deepStrictEqual(notes([plainObs], [2026, 2027].map((year) => ({ year, days: [null], lunar: true })), { from: 2026, to: 2027, capped: false }),
    ["2026~2027년에는 검색하신 전례일을 지키지 않습니다."], "이어진 해는 물결표로 잇는다");
  // 줄이 있는 해가 섞여 있어도 줄이 없는 해를 적는다. 떨어진 해는 쉼표로 잇는다
  const mixed = [2024, 2025, 2026, 2027, 2028].map((year) => ({ year, days: [[2025, 2027].includes(year) ? YDAY(`${year}-02-15`) : null], lunar: true }));
  assert.deepStrictEqual(notes([plainObs], mixed, { from: 2024, to: 2028, capped: false }),
    ["2024, 2026, 2028년에는 검색하신 전례일을 지키지 않습니다."]);
  const runs = [2024, 2025, 2026, 2027, 2028, 2029].map((year) => ({ year, days: [year === 2025 ? YDAY("2025-02-15") : null], lunar: true }));
  assert.deepStrictEqual(notes([plainObs], runs, { from: 2024, to: 2029, capped: false }),
    ["2024, 2026~2029년에는 검색하신 전례일을 지키지 않습니다."]);
  const nicola = { obs: OBS({ key: "d1206", name: "성 니콜라" }), sets: [] };
  const ten = [];
  for (let year = 2000; year <= 2009; year++) ten.push({ year, days: [YDAY(`${year}-12-06`)], lunar: false });
  assert.deepStrictEqual(notes([nicola], ten, { from: 2000, to: 2009, capped: true }),
    ["연도 범위는 10년까지 찾습니다. 2000~2009년의 날을 보입니다."], "음력으로 지키는 전례일이 없으면 음력 자료를 알리지 않는다");
  const seol = { obs: OBS({ key: "lunar11-설날", name: "설날" }), sets: [] };
  const chuseok = { obs: OBS({ key: "lunar815-추석-명절", name: "추석 명절" }), sets: [] };
  // 음력 자료가 없는 해를 찾았으면 자료가 있는 해를 알린다. 어느 하나만 찾았어도 둘을 함께 적는다(사용자 결정 2026-11-18)
  const span = { from: 2025, to: 2050 };
  assert.deepStrictEqual(notes([seol, chuseok], [2050, 2051, 2052].map((year) => ({ year, days: [year === 2050 ? YDAY("2050-01-23") : null, null], lunar: year === 2050 })),
    { from: 2050, to: 2052, capped: false }, span), ["설날과 추석은 2025-2050년만 찾습니다."]);
  assert.deepStrictEqual(notes([seol], [{ year: 2060, days: [null], lunar: false }], { from: 2060, to: 2060, capped: false }, span),
    ["설날과 추석은 2025-2050년만 찾습니다."], "음력 자료가 없어 없는 것이면 「지키지 않습니다」를 적지 않는다");
  assert.deepStrictEqual(notes([chuseok], [{ year: 2020, days: [null], lunar: false }], { from: 2020, to: 2020, capped: false }, span),
    ["설날과 추석은 2025-2050년만 찾습니다."], "2025년보다 이른 해도 같다");
  // 음력이 아닌 전례일도 함께 찾았으면 줄이 없는 해는 지키지 않는 해로 적는다
  assert.deepStrictEqual(notes([seol, plainObs], [{ year: 2060, days: [null, null], lunar: false }], { from: 2060, to: 2060, capped: false }, span),
    ["설날과 추석은 2025-2050년만 찾습니다.", "2060년에는 검색하신 전례일을 지키지 않습니다."]);
  // 음력 자료가 하나도 없으면(엔진이 범위를 내지 못하면) 그해의 날짜가 없다고 적는다
  assert.deepStrictEqual(notes([seol], [{ year: 2060, days: [null], lunar: false }], { from: 2060, to: 2060, capped: false }),
    ["2060년의 설날 날짜는 아직 앱에 없습니다."]);
});

// 지역 축일(ADR-044 §3): 워커가 넘기는 줄
const LOCAL_ITEM = (level, o = {}) => ({
  obs: OBS({ key: `local:${level}`, kind: "local", name: level === "dedication" ? "용인성당 축성일" : level === "diocese" ? "서울교구설립일" : "관구설립일",
    date: level === "dedication" ? "01.31" : level === "diocese" ? "05.27" : "09.29", rank: level === "dedication" ? "major_feast" : null }),
  sets: [], tier: 1, local: { level, color: level === "dedication" ? "white" : null, year: level === "dedication" ? null : level === "diocese" ? 1965 : 1992 }, ...o,
});

test("nextMonthDay, monthDayIn: 해마다 같은 날짜의 다음 그날(오늘이면 오늘), 그해에 없는 날은 null", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.nextMonthDay("01.31", "2026-11-17"), "2027-01-31");
  assert.strictEqual(h.nextMonthDay("11.17", "2026-11-17"), "2026-11-17");
  assert.strictEqual(h.nextMonthDay("12.05", "2026-11-17"), "2026-12-05");
  assert.strictEqual(h.nextMonthDay("02.29", "2026-11-17"), "2028-02-29", "평년은 건너뛴다");
  assert.strictEqual(h.monthDayIn(2027, 2, 29), null);
  assert.strictEqual(h.monthDayIn(2028, 2, 29), "2028-02-29");
});

test("monthDaysBetween: 한 전례년 안의 그 날짜는 없거나 하나거나 둘이다", () => {
  const h = loadPureHelpers();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepStrictEqual(plain(h.monthDaysBetween("01.31", "2025-11-30", "2026-11-28")), ["2026-01-31"]);
  // 53주인 전례년(2027-11-28부터 2028-12-02까지)의 처음과 끝
  assert.deepStrictEqual(plain(h.monthDaysBetween("11.30", "2027-11-28", "2028-12-02")), ["2027-11-30", "2028-11-30"]);
  assert.deepStrictEqual(plain(h.monthDaysBetween("02.29", "2025-11-30", "2026-11-28")), []);
  assert.deepStrictEqual(plain(h.monthDaysBetween("11.29", "2025-11-30", "2026-11-28")), [], "전례년의 끝(11월 28일) 뒤다");
});

test("localNoticeOf, buildLocalNotice: 소속교회가 없으면 카드에서 고르고, 있으면 날짜만 알린다. 축복일에는 고를 것이 없다(ADR-044 §3)", () => {
  const h = loadPureHelpers();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const N = (kind, name, date, churchId, mine = null) => ({ kind, name, date, churchId, mine });
  // helpers.js `churchName`의 대신: 단추의 이름은 설정 목록의 이름이다
  const nameOf = (name) => name.replace(/성당$/, "교회");
  const notice = (n) => h.localNoticeOf(n, nameOf);
  // 소속교회 없음: 찾은 본당을 고르는 단추
  assert.deepStrictEqual(plain(notice(N("consecration", "용인성당", "01.31", "yongin"))), {
    text: "용인성당의 축성일(1월 31일)은 소속교회로 등록하면 축성 독서와 함께 볼 수 있습니다.", pick: { churchId: "yongin", name: "용인교회" }, list: false });
  // 소속교회가 있으면 날짜만. 축성 독서는 모든 본당이 같다. 소속교회에 축복일만 있으면 뒷문장이 없다
  assert.deepStrictEqual(plain(notice(N("consecration", "용인성당", "01.31", "yongin", "consecration"))), {
    text: "용인성당의 축성일은 1월 31일입니다. 축성 독서는 소속교회의 축성일과 같습니다.", pick: null, list: false });
  assert.strictEqual(notice(N("consecration", "용인성당", "01.31", "yongin", "blessing")).text, "용인성당의 축성일은 1월 31일입니다.");
  assert.deepStrictEqual(plain(notice(N("blessing", "세종성당", "04.21", "sejong"))),
    { text: "세종성당의 축복일(4월 21일)에는 따로 읽는 독서가 없습니다.", pick: null, list: false });
  assert.deepStrictEqual(plain(notice(N("noParish", null, null, null))),
    { text: "소속교회의 축성일은 소속교회를 등록하면 축성 독서와 함께 볼 수 있습니다.", pick: null, list: true });
  // 카드: 단추, 목록, 아무것도 없음
  const pick = h.buildLocalNotice(notice(N("consecration", "용인성당", "01.31", "yongin")));
  assert.strictEqual(pick.className, "search-alert search-local-note");
  assert.strictEqual(pick.children[1].tagName, "BUTTON");
  assert.strictEqual(pick.children[1].textContent, "용인교회를 소속교회로 선택");
  assert.strictEqual(pick.children[1].getAttribute("data-church"), "yongin");
  const list = h.buildLocalNotice(notice(N("noParish", null, null, null)));
  const row = list.children[1];
  assert.strictEqual(row.className, "search-local-pick");
  assert.strictEqual(row.children[0].getAttribute("for"), "search-local-church");
  const select = row.children[1].children[0];
  assert.deepStrictEqual([select.tagName, select.id, select.getAttribute("disabled")], ["SELECT", "search-local-church", ""], "받는 동안은 고를 수 없다");
  assert.strictEqual(list.children[2].textContent, "소속교회로 선택");
  assert.strictEqual(h.buildLocalNotice(notice(N("blessing", "세종성당", "04.21", "sejong"))).children.length, 1);
  assert.strictEqual(h.pickedParishNote("용인교회"), "용인교회를 소속교회로 등록했습니다. 설정에서 바꿀 수 있습니다.");
  assert.strictEqual(h.pickedParishNote("서울주교좌성당"), "서울주교좌성당을 소속교회로 등록했습니다. 설정에서 바꿀 수 있습니다.");
});

test("lectRowOf: 축성일 줄은 축성일을 고른 화면을 열고 굵게, 설립일 줄은 그날을 열고 설립 연도를 적는다. 등급 줄은 없다(ADR-044 §3)", () => {
  const h = loadPureHelpers();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  // 이번 전례년의 그날을 열고 다음 전례년의 그날을 글로 적는다(ADR-044 §1)
  const ded = h.lectRowOf(LOCAL_ITEM("dedication"), () => null,
    { open: DAY("2026-01-31", { obs: "local:dedication", setId: null, name: "용인성당 축성일", colors: ["white"] }), next: null, nextIds: [], year: null, cycles: [],
      nextYear: { date: "2027-01-31" } },
    "2026-11-17");
  assert.deepStrictEqual(plain([ded.href, ded.bold, ded.meta, ded.lines, ded.nexts, ded.label]), [
    "/lectionary/2026-01-31?obs=my-dedication", true, ["2026년 1월 31일 (토)"], ["다음 전례년 2027년 1월 31일 (일)"], [],
    "용인성당 축성일, 백색, 2026년 1월 31일 토요일, 다음 전례년 2027년 1월 31일 일요일"]);
  const dio = h.lectRowOf(LOCAL_ITEM("diocese"), () => null,
    { open: DAY("2026-05-27", { obs: "local:diocese", setId: null, name: "서울교구설립일", colors: ["white"] }), next: null, nextIds: [], year: null, cycles: [],
      nextYear: { date: "2027-05-27" } },
    "2026-11-17");
  assert.deepStrictEqual(plain([dio.href, dio.bold, dio.meta, dio.lines]),
    ["/lectionary/2026-05-27", false, ["1965년 설립", "2026년 5월 27일 (수)"], ["다음 전례년 2027년 5월 27일 (목)"]]);
  // 날짜를 계산하기 전에도 다음 그날의 주소다(엔진 없이 셀 수 있다)
  assert.strictEqual(h.lectRowOf(LOCAL_ITEM("province"), () => null, null, "2026-11-17").href, "/lectionary/2027-09-29");
  // 연도를 붙여 찾은 줄은 그해의 날이다
  const year = h.lectRowOf({ ...LOCAL_ITEM("dedication"), yearDay: { kind: "kept", ...DAY("2028-01-31", { obs: "local:dedication", setId: null, colors: ["white"] }),
    from: null, by: null, bySaint: false } }, () => null, null, "2026-11-17");
  assert.strictEqual(year.href, "/lectionary/2028-01-31?obs=my-dedication");
});

test("lectDaysOf, localYearDayOf: 지역 축일은 엔진의 표 없이 이번 전례년의 그날을 연다. 축성일은 본당 표의 색, 설립일은 그날의 색이다", async () => {
  const ctx = loadLectDays();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const mod = {
    ...LY_ENGINE,
    async findReadingDay() { throw new Error("지역 축일은 표에 묻지 않는다"); },
    resolveDate: (date) => ({ date }),
    headerColors: (resolved) => ({ colors: resolved.date === "2026-05-27" ? ["white"] : ["green"] }),
  };
  const ded = plain(await ctx.lectDaysOf(mod, LOCAL_ITEM("dedication"), "2026-11-17"));
  assert.deepStrictEqual([ded.open.date, ded.open.obs, ded.open.colors, ded.next, ded.cycles, ded.nextYear],
    ["2026-01-31", "local:dedication", ["white"], null, [], { date: "2027-01-31" }]);
  const dio = plain(await ctx.lectDaysOf(mod, LOCAL_ITEM("diocese"), "2026-11-17"));
  assert.deepStrictEqual([dio.open.date, dio.open.colors, dio.nextYear], ["2026-05-27", ["white"], { date: "2027-05-27" }]);
  // 한 전례년(2027-11-28부터 2028-12-02까지)에 11월 30일이 두 번 있으면 오늘이나 그 뒤의 날, 둘 다 지났으면 앞의 날이다
  const andrew = LOCAL_ITEM("dedication", { obs: OBS({ key: "local:dedication", kind: "local", name: "용인성당 축성일", date: "11.30" }) });
  const on = async (today) => plain(await ctx.lectDaysOf(mod, andrew, today));
  assert.deepStrictEqual([(await on("2028-06-01")).open.date, (await on("2028-06-01")).nextYear], ["2028-11-30", { date: "2029-11-30" }]);
  assert.strictEqual((await on("2027-11-29")).open.date, "2027-11-30");
  assert.strictEqual((await on("2028-12-01")).open.date, "2027-11-30");
  // 이번 전례년에 없는 날(평년의 2월 29일)은 다음 그날을 열고 다음 전례년의 날을 적지 않는다
  const leap = LOCAL_ITEM("dedication", { obs: OBS({ key: "local:dedication", kind: "local", name: "윤일 축성일", date: "02.29" }) });
  const l = plain(await ctx.lectDaysOf(mod, leap, "2026-11-17"));
  assert.deepStrictEqual([l.open.date, l.nextYear], ["2028-02-29", null]);
  // 이번 전례년(2028)에는 있고 다음 전례년에 없으면 date가 null이다
  assert.deepStrictEqual(plain(await ctx.lectDaysOf(mod, leap, "2028-06-01")).nextYear, { date: null });
  // 그해의 날: 설립 연도보다 이른 해는 없다
  assert.deepStrictEqual(plain(ctx.localYearDayOf(mod, LOCAL_ITEM("province"), 2024)).date, "2024-09-29");
  assert.strictEqual(ctx.localYearDayOf(mod, LOCAL_ITEM("province"), 1991), null);
  assert.strictEqual(plain(ctx.localYearDayOf(mod, LOCAL_ITEM("dedication"), 1700)).date, "1700-01-31", "축성일은 해를 모른다");
});

test("lectRowOf: 해마다 같은 독서는 이번 전례년의 날을 열고, 링크 없이 다음 전례년의 날을 글로 적는다(ADR-044 §1)", () => {
  const h = loadPureHelpers();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const hit = (id) => [{ slot: 3, rows: [["john", 3, 16, 21]], sets: [SET(id)] }];
  const days = (open, nextYear, o = {}) => ({ open: DAY(open, o), next: null, nextIds: ["x"], year: null, cycles: [], nextYear });
  // 부활2주 수요일: 해 구분이 없고 날짜가 해마다 바뀐다
  const moving = { obs: OBS({ key: "easter-2-wed", name: "부활2주 수요일" }), sets: [SET("easter-2-wed-t1-s1")], hits: hit("easter-2-wed-t1-s1") };
  const row = h.lectRowOf(moving, () => null, days("2026-04-15", { date: "2027-04-07" }, { colors: ["white"] }), "2026-11-17");
  assert.deepStrictEqual(plain([row.href, row.nexts, row.meta, row.lines]),
    ["/lectionary/d/easter-2-wed-t1-s1", [], ["2026년 4월 15일 (수)"], ["다음 전례년 2027년 4월 7일 (수)"]]);
  assert.strictEqual(row.label, "부활2주 수요일, 복음 요한 3:16-21, 백색, 2026년 4월 15일 수요일, 다음 전례년 2027년 4월 7일 수요일");
  // 성 십자가의 날: 날짜가 정해져 있다. 열리는 날이 앞날이어도 다음 전례년의 날을 적는다
  const fixed = { obs: OBS({ key: "d0914-cross", name: "성 십자가의 날", kind: "sanctoral", date: "09.14", rank: "major_feast" }), sets: [SET("d0914-cross-t1-s1")], hits: hit("d0914-cross-t1-s1") };
  const fixedRow = h.lectRowOf(fixed, () => null, days("2026-09-14", { date: "2027-09-14" }, { colors: ["white"] }), "2026-02-01");
  assert.deepStrictEqual(plain([fixedRow.nexts, fixedRow.meta, fixedRow.lines]), [[], ["다음 2026년 9월 14일 (월)"], ["다음 전례년 2027년 9월 14일 (화)"]]);
  // 고유 독서가 없는 성인(공통 독서)은 등급 줄 아래에 적는다. 다음 전례년에 지키지 않으면 그렇다고 적는다
  const saint = { obs: OBS({ key: "d0117-안토니오", name: "안토니오", kind: "sanctoral", date: "01.17", rank: "commemoration", common: "religious" }), sets: [] };
  const saintRow = h.lectRowOf(saint, () => null, days("2026-01-17", { date: null }, { colors: ["white"] }), "2026-11-17");
  assert.deepStrictEqual(plain([saintRow.nexts, saintRow.meta, saintRow.lines]), [[], ["2026년 1월 17일 (토)"], ["기념일", "다음 전례년에는 지키지 않음"]]);
  assert.ok(saintRow.label.endsWith("2026년 1월 17일 토요일, 기념일, 다음 전례년에는 지키지 않음"));
  // 이번 전례년에 오지 않아 다음에 읽는 날을 열면 적지 않는다
  const later = h.lectRowOf(saint, () => null, days("2028-01-17", null, { colors: ["white"] }), "2026-11-17");
  assert.deepStrictEqual(plain([later.meta, later.lines]), [["다음 2028년 1월 17일 (월)"], ["기념일"]]);
});

test("lectRowOf, lectDaysOf: 사계재의 날은 계절 이름 뒤에 요일을 붙이고, 이번 전례년의 그 요일을 열어 주소에 날짜를 붙인다(ADR-044 §3)", async () => {
  const h = loadPureHelpers();
  const ctx = loadLectDays();
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const spring = (ember) => ({ obs: OBS({ key: "t-춘계재", name: "춘계재", rank: "feria" }), sets: [], tier: 1, ember });
  const E = (date) => DAY(date, { obs: "t-춘계재", setId: null, name: "춘계재" });
  // 2026 전례년의 춘계재는 2월 25, 27, 28일, 2027 전례년은 2월 17, 19, 20일이다
  const kept = ["2026-02-25", "2026-02-27", "2026-02-28", "2027-02-17", "2027-02-19", "2027-02-20"].map(E);
  const calls = [];
  const mod = {
    ...LY_ENGINE,
    async findKeptDays(ids, today, from, to) {
      calls.push([Array.from(ids), from, to]);
      return kept.filter((d) => d.date >= from && d.date <= to);
    },
    async findReadingDay() { throw new Error("사계재의 날은 요일로 찾는다"); },
  };
  const fri = plain(await ctx.lectDaysOf(mod, spring("fri"), "2026-11-16"));
  assert.deepStrictEqual([fri.open.date, fri.nextYear, fri.next, fri.cycles], ["2026-02-27", { date: "2027-02-19" }, null, []]);
  assert.deepStrictEqual(plain(calls[0]), [["t-춘계재"], "2025-11-30", "2027-11-27"]);
  const row = h.lectRowOf(spring("fri"), () => null, fri, "2026-11-16");
  assert.deepStrictEqual(plain([row.title, row.href, row.meta, row.lines, row.nexts]),
    ["춘계재 금요일", "/lectionary/d/t-%EC%B6%98%EA%B3%84%EC%9E%AC?from=2026-02-27", ["2026년 2월 27일 (금)"], ["다음 전례년 2027년 2월 19일 (금)"], []]);
  // 날짜를 계산하기 전에도 제목에 요일이 있다
  assert.strictEqual(h.lectRowOf(spring("sat"), () => null, null, "").title, "춘계재 토요일");
  // 이번 전례년에 그 요일을 지키지 않으면 다음 전례년의 그 요일을 열고 다음 전례년의 날을 적지 않는다
  const sparse = { ...mod, findKeptDays: async (ids, today, from, to) => kept.slice(3).filter((d) => d.date >= from && d.date <= to) };
  const wed = plain(await ctx.lectDaysOf(sparse, spring("wed"), "2026-11-16"));
  assert.deepStrictEqual([wed.open.date, wed.nextYear], ["2027-02-17", null]);
  // 두 전례년 모두 없으면 날짜가 없다
  assert.strictEqual(await ctx.lectDaysOf({ ...mod, findKeptDays: async () => [] }, spring("wed"), "2026-11-16"), null);
});

test("lectRowOf: 이름으로 찾은 줄이 해에 따라 다른 독서를 읽으면 열리는 날의 해를 적고, 다른 해의 날마다 링크를 둔다(ADR-044 §1)", () => {
  const h = loadPureHelpers();
  const sets = ["A", "B", "C"].map((y) => SET(`pentecost-${y}-t1-s1`, y));
  const item = { obs: OBS({ key: "t-성령강림주일", name: "성령강림주일", rank: "principal" }), sets };
  const ids = sets.map((s) => s.id);
  const D = (date, y) => DAY(date, { obs: "grid:pentecost", setId: `pentecost-${y}-t1-s1`, name: "성령강림주일", colors: ["red"] });
  const days = { open: D("2026-05-24", "A"), next: null, nextIds: ids, year: "A", cycles: [D("2027-05-16", "B"), D("2028-06-04", "C")] };
  const row = JSON.parse(JSON.stringify(h.lectRowOf(item, () => null, days, "2026-11-16")));
  assert.deepStrictEqual(row.meta, ["가해", "2026년 5월 24일 (일)"]);
  assert.strictEqual(row.label, "성령강림주일, 적색, 가해, 2026년 5월 24일 일요일");
  const slug = ids.join(",");
  assert.deepStrictEqual(row.nexts, [
    { href: `/lectionary/d/${slug}?from=2027-05-16`, label: "성령강림주일, 나해 2027년 5월 16일 일요일", prefix: "나해", date: "2027년 5월 16일 (일)" },
    { href: `/lectionary/d/${slug}?from=2028-06-04`, label: "성령강림주일, 다해 2028년 6월 4일 일요일", prefix: "다해", date: "2028년 6월 4일 (일)" },
  ]);
  // 열리는 날이 앞날이어도 링크를 둔다
  const ahead = JSON.parse(JSON.stringify(h.lectRowOf(item, () => null, { ...days, open: D("2026-05-24", "A") }, "2026-01-10")));
  assert.deepStrictEqual([ahead.meta, ahead.nexts.map((n) => n.prefix)], [["가해", "다음 2026년 5월 24일 (일)"], ["나해", "다해"]]);
  // 두 해 주기는 링크가 하나다
  const weekday = { obs: OBS({ key: "ord-1-mon", name: "연중1주 월요일" }), sets: [SET("ord-1-mon-I", "I"), SET("ord-1-mon-II", "II")] };
  const W = (date, y) => DAY(date, { obs: "grid:ord-1-mon", setId: `ord-1-mon-${y}`, name: "연중 1주 월요일", colors: ["green"] });
  const wrow = JSON.parse(JSON.stringify(h.lectRowOf(weekday, () => null, { open: W("2026-01-12", "II"), next: null, nextIds: ["x"], year: "II", cycles: [W("2027-01-11", "I")] }, "2026-11-16")));
  assert.deepStrictEqual([wrow.meta, wrow.nexts.map((n) => `${n.prefix} ${n.date}`)], [["짝수해", "2026년 1월 12일 (월)"], ["홀수해 2027년 1월 11일 (월)"]]);
});

test("lectRowOf: 구절로 찾은 독서가 그 전례일의 모든 해의 세트에 있으면 해마다 같은 독서라, 링크 없이 다음 전례년의 날을 적는다(ADR-044 §1)", () => {
  const h = loadPureHelpers();
  const sets = [SET("ord-1-mon-I", "I"), SET("ord-1-mon-II", "II")];
  const W = (date, y) => DAY(date, { obs: "grid:ord-1-mon", setId: `ord-1-mon-${y}`, name: "연중 1주 월요일", colors: ["green"] });
  // 복음 마르 1:14-20은 홀수해와 짝수해에 같다. 엔진이 이름으로 찾은 줄과 같이 이번 전례년의 날을 열어 주소에 날짜를 붙이지 않는다
  const both = { obs: OBS({ key: "ord-1-mon", name: "연중1주 월요일" }), sets, hits: [{ slot: 3, rows: [["mark", 1, 14, 20]], sets }] };
  const yearly = { open: W("2026-01-12", "II"), next: null, nextIds: ["x"], year: null, cycles: [], nextYear: { date: "2027-01-11" } };
  const row = JSON.parse(JSON.stringify(h.lectRowOf(both, () => null, yearly, "2026-11-16")));
  assert.strictEqual(row.href, "/lectionary/d/ord-1-mon-I,ord-1-mon-II");
  assert.deepStrictEqual([row.nexts, row.meta, row.lines], [[], ["홀수해, 짝수해", "2026년 1월 12일 (월)"], ["다음 전례년 2027년 1월 11일 (월)"]]);
  // 한 해의 세트에만 있는 독서는 해에 따라 다른 독서다. 지난날이면 다음 링크가 있고 주소는 그대로다
  const one = { ...both, hits: [{ slot: 0, rows: [["heb", 1, 1, 6]], sets: [sets[0]] }] };
  const days = { open: W("2025-01-13", "I"), next: W("2027-01-11", "I"), nextIds: ["ord-1-mon-I"], year: null, cycles: [], nextYear: null };
  const oneRow = JSON.parse(JSON.stringify(h.lectRowOf(one, () => null, days, "2026-11-16")));
  assert.deepStrictEqual([oneRow.href, oneRow.nexts.length, oneRow.lines], ["/lectionary/d/ord-1-mon-I", 1, []]);
  // 날짜를 계산하기 전에도 보조 주소 그대로다
  assert.strictEqual(h.lectRowOf(both, () => null, null, "").href, "/lectionary/d/ord-1-mon-I,ord-1-mon-II");
});

test("lectDaysOf: 이름으로 찾은 줄은 열리는 날 뒤에 다른 해의 첫날을 해마다 하나씩 날짜 차례로, 구절로 찾은 줄은 지났을 때 다음 날 하나(ADR-044 §1)", async () => {
  const ctx = loadLectDays();
  // 엔진의 가짜: `from`이 없으면 그 독서를 읽는 첫날(여는 날), 있으면 그날부터 처음 읽는 날
  const table = [["2026-05-24", "A-1"], ["2027-05-16", "B-2"], ["2028-06-04", "C-1"], ["2029-05-20", "A-1"]]
    .map(([date, setId]) => DAY(date, { setId }));
  /** @type {any[]} */
  const calls = [];
  const stale = () => false;
  const mod = {
    ...LY_ENGINE,
    async findReadingDay(ids, today, from = null, isStale = null) {
      assert.strictEqual(isStale, stale, "화면을 떠났는지 엔진에 알린다(코드 리뷰 2026-11-17)");
      calls.push([Array.from(ids), from]);
      return table.find((d) => ids.includes(d.setId) && (!from || d.date >= from)) || null;
    },
    async findKeptDays(ids, today, from, to, isStale = null) {
      assert.strictEqual(isStale, stale, "화면을 떠났는지 엔진에 알린다(코드 리뷰 2026-11-17)");
      calls.push([Array.from(ids), from, to]);
      return table.filter((d) => ids.includes(d.setId) && d.date >= from && d.date <= to);
    },
  };
  // 세트 차례를 일부러 다해부터 둔다. 트랙이 다른 세트는 한 해로 묶는다
  const sets = [SET("C-1", "C", 1), SET("C-2", "C", 2), SET("A-1", "A", 1), SET("A-2", "A", 2), SET("B-1", "B", 1), SET("B-2", "B", 2)];
  const item = { obs: OBS({ name: "성령강림주일" }), sets };
  const plain = (v) => JSON.parse(JSON.stringify(v));
  const got = plain(await ctx.lectDaysOf(mod, item, "2026-11-16", stale));
  assert.deepStrictEqual([got.open.date, got.year, got.next, got.cycles.map((d) => d.date)], ["2026-05-24", "A", null, ["2027-05-16", "2028-06-04"]]);
  assert.deepStrictEqual(Array.from(got.nextIds), ["C-1", "C-2", "A-1", "A-2", "B-1", "B-2"]);
  assert.deepStrictEqual(plain(calls.slice(1)), [[["C-1", "C-2"], "2026-05-24"], [["B-1", "B-2"], "2026-05-24"]]);
  // 열리는 날이 앞날이어도 같다
  const ahead = plain(await ctx.lectDaysOf(mod, item, "2026-01-10", stale));
  assert.deepStrictEqual(ahead.cycles.map((d) => d.date), ["2027-05-16", "2028-06-04"]);
  // 구절로 찾은 줄은 해를 적지 않고, 지난날이면 다음에 읽는 날 하나다
  const passage = { obs: item.obs, sets, hits: [{ slot: 3, rows: [], sets: [SET("A-1", "A", 1)] }] };
  const p = plain(await ctx.lectDaysOf(mod, passage, "2026-11-16", stale));
  assert.deepStrictEqual([p.year, p.cycles.length, p.next.date], [null, 0, "2029-05-20"]);
  assert.strictEqual(p.nextYear, null);
  // 구절로 찾은 독서가 모든 해의 세트에 있으면 해마다 같은 독서다. 이름으로 찾은 줄과 같이 이번 전례년의 날을 열고, 링크 대신 다음
  // 전례년(2026-11-29부터 2027-11-27까지) 안에서 그날을 찾는다
  calls.length = 0;
  const yearly = { obs: item.obs, sets, hits: [{ slot: 3, rows: [], sets }] };
  const y = plain(await ctx.lectDaysOf(mod, yearly, "2026-11-16", stale));
  assert.deepStrictEqual(plain(calls), [[["C-1", "C-2", "A-1", "A-2", "B-1", "B-2"], null], [["C-1", "C-2", "A-1", "A-2", "B-1", "B-2"], "2026-11-29", "2027-11-27"]]);
  assert.deepStrictEqual([y.open.date, y.next, y.cycles, y.nextYear], ["2026-05-24", null, [], { date: "2027-05-16" }]);
  // 다음 전례년 안에 없으면 다음 전례년에는 지키지 않는다
  const sparse = { ...mod, findReadingDay: async () => DAY("2026-05-24"), findKeptDays: async () => [] };
  assert.deepStrictEqual(plain(await ctx.lectDaysOf(sparse, yearly, "2026-11-16")).nextYear, { date: null });
  // 이번 전례년에 오지 않아 다음에 읽는 날을 열면 다음 전례년의 날을 찾지 않는다
  const absent = { ...mod, findReadingDay: async (ids, today, from) => (from ? assert.fail("묻지 않는다") : DAY("2027-05-16")),
    findKeptDays: async () => assert.fail("묻지 않는다") };
  assert.strictEqual(plain(await ctx.lectDaysOf(absent, yearly, "2026-11-16")).nextYear, null);
});

test("fillLectRow: 링크를 한 줄에 하나씩 더하고 빼며, 있던 링크는 그대로 두고 글만 바꾼다(포커스가 남는다)", () => {
  const h = loadPureHelpers();
  const row = (nexts) => ({
    title: "성령강림주일", href: "/lectionary/d/x", bold: true, found: null, colors: [{ code: "red", name: "적색" }], meta: ["가해", "2026년 5월 24일 (일)"],
    lines: [], label: "L", nexts,
  });
  const B = { href: "/lectionary/d/x?from=2027-05-16", label: "N1", prefix: "나해", date: "2027년 5월 16일 (일)" };
  const C = { href: "/lectionary/d/x?from=2028-06-04", label: "N2", prefix: "다해", date: "2028년 6월 4일 (일)" };
  const li = h.buildLectRow(row([]));
  const a = li.children[0];
  assert.strictEqual(recursiveText(a), "성령강림주일적색가해2026년 5월 24일 (일)");
  assert.strictEqual(li.className, "");
  h.fillLectRow(li, row([B, C]));
  assert.strictEqual(li.children[0], a, "같은 링크");
  assert.strictEqual(li.className, "lect-row-pair");
  const [first, second] = li.children.slice(1);
  assert.deepStrictEqual(li.children.slice(1).map((n) => [n.className, n.getAttribute("href"), n.getAttribute("aria-label")]), [
    ["lect-row-next", "/lectionary/d/x?from=2027-05-16", "N1"], ["lect-row-next", "/lectionary/d/x?from=2028-06-04", "N2"],
  ]);
  assert.deepStrictEqual(li.children.slice(1).map((n) => recursiveText(n)), ["나해 2027년 5월 16일 (일)›", "다해 2028년 6월 4일 (일)›"]);
  // 링크가 하나로 줄면 뒤의 것을 빼고 앞의 것은 그대로 쓴다
  h.fillLectRow(li, row([{ ...B, prefix: "다음" }]));
  assert.deepStrictEqual([li.children.length, li.children[1] === first], [2, true]);
  assert.strictEqual(recursiveText(first), "다음 2027년 5월 16일 (일)›");
  assert.ok(second);
  h.fillLectRow(li, row([]));
  assert.strictEqual(li.children.length, 1);
  assert.strictEqual(li.className, "");
});

test("partialAnnouncement: 검색 중 알림은 묶음마다 알약의 이름과 차례로 읽고, 성시는 결과가 있을 때만 읽는다", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.partialAnnouncement("사랑", { total: 12, psalter: { total: 3 } }), "\"사랑\" 검색 중… 현재 성서 본문 12건, 성시 3건");
  // 성시에만 결과가 있어도 「현재 0건」으로 끝나지 않는다
  assert.strictEqual(h.partialAnnouncement("목자", { total: 0, psalter: { total: 4 } }), "\"목자\" 검색 중… 현재 성서 본문 0건, 성시 4건");
  assert.strictEqual(h.partialAnnouncement("사랑", { total: 12, psalter: { total: 0 } }), "\"사랑\" 검색 중… 현재 성서 본문 12건");
  // 옛 워커나 성시 색인을 아직 받지 못한 결과에는 `psalter`가 없다
  assert.strictEqual(h.partialAnnouncement("사랑", { total: 12 }), "\"사랑\" 검색 중… 현재 성서 본문 12건");
  // 책을 고른 검색은 고른 책을 한 목록에 센다(ADR-049 §2)
  assert.strictEqual(h.partialAnnouncement("사랑", { total: 7, psalter: { total: 0 }, books: [["luke", 7]] }), "\"사랑\" 검색 중… 현재 7건");
});

test("SEARCHED_GROUPS: 결과 없음과 책 이름만 친 안내는 알약의 세 묶음을 그 차례로 적는다", () => {
  const h = loadPureHelpers();
  assert.strictEqual(h.SEARCHED_GROUPS, "성서 본문, 성시, 전례일");
});

// ── 고른 책의 알약 줄(ADR-049) ──
const SCOPE_BOOKS = [{ id: "luke", name: "루가" }, { id: "john", name: "요한" }, { id: "lps", name: "전례시편" }];
/** @param {any} h @param {any} opts */
function scopePills(h, opts) {
  const removed = [];
  const cleared = [];
  const row = h.buildScopePills(opts.books || SCOPE_BOOKS, {
    counts: opts.counts ?? null, shown: opts.shown ?? null,
    hrefOf: (id) => h.buildSearchUrl({ q: "사랑", filterBooks: ["luke", "john", "lps"], book: id }),
    onRemove: (id) => removed.push(id),
    onClear: (e) => cleared.push(e),
  });
  const all = row.children[0].children;
  // 스텁의 classList는 className을 읽지 않아 class 속성으로 가린다
  const isClear = (li) => li.getAttribute("class") === "scope-clear";
  const items = all.filter((li) => !isClear(li));
  const clear = all.find(isClear) || null;
  return { row, items, removed, clear, cleared, all };
}

test("buildScopePills: 수를 모르면 이름과 ×만 두고, 이름은 링크가 아니다(ADR-049 §5)", () => {
  const h = loadPureHelpers();
  const { row, items, removed } = scopePills(h, {});
  assert.strictEqual(row.getAttribute("role"), "group");
  assert.strictEqual(row.getAttribute("aria-label"), "검색할 책");
  assert.deepStrictEqual(items.map((li) => li.children[0].tagName), ["SPAN", "SPAN", "SPAN"]);
  assert.deepStrictEqual(items.map((li) => recursiveText(li.children[0])), ["루가", "요한", "전례시편"]);
  const xs = items.map((li) => li.children[1]);
  assert.deepStrictEqual(xs.map((x) => x.getAttribute("aria-label")), ["검색할 책에서 루가 빼기", "검색할 책에서 요한 빼기", "검색할 책에서 전례시편 빼기"]);
  xs[1].eventListeners.click[0]({ detail: 1 });
  assert.deepStrictEqual(removed, ["john"]);
});

test("buildScopePills: 두 권 이상이면 맨 앞에 「전체」, 알약마다 수와 그 책의 주소, 결과가 없는 책은 흐린 글(ADR-049 §2, §4)", () => {
  const h = loadPureHelpers();
  const { items } = scopePills(h, { counts: [["luke", 23], ["john", 48], ["lps", 0]], shown: "john" });
  assert.strictEqual(items.length, 4);
  const mains = items.map((li) => li.children[0]);
  assert.deepStrictEqual(mains.map((n) => recursiveText(n)), ["전체 71건", "루가 23건", "요한 48건", "전례시편 0건"]);
  assert.deepStrictEqual(mains.map((n) => n.tagName), ["A", "A", "A", "SPAN"]);
  assert.deepStrictEqual(mains.slice(0, 3).map((a) => a.getAttribute("href")), [
    "/search?q=%EC%82%AC%EB%9E%91&in=luke&in=john&in=lps",
    "/search?q=%EC%82%AC%EB%9E%91&in=luke&in=john&in=lps&book=luke",
    "/search?q=%EC%82%AC%EB%9E%91&in=luke&in=john&in=lps&book=john",
  ]);
  assert.deepStrictEqual(mains.slice(0, 3).map((a) => a.getAttribute("data-focus-key")), ["book:all", "book:luke", "book:john"]);
  assert.deepStrictEqual(mains.map((n) => n.getAttribute("aria-current")), [null, null, "true", null]);
  assert.deepStrictEqual(items.map((li) => li.classList.contains("scope-pill-current")), [false, false, true, false]);
  assert.ok(items[3].classList.contains("scope-pill-empty"));
  // 「전체」에는 ×가 없고, 결과가 없는 책도 뺄 수 있다
  assert.strictEqual(items[0].children.length, 1);
  assert.strictEqual(items[3].children[1].getAttribute("data-remove-book"), "lps");
});

test("buildScopePills: 「전체」를 고르면 「전체」가 고른 알약이다", () => {
  const h = loadPureHelpers();
  const { items } = scopePills(h, { counts: [["luke", 23], ["john", 48], ["lps", 0]], shown: null });
  assert.deepStrictEqual(items.map((li) => li.children[0].getAttribute("aria-current")), ["true", null, null, null]);
});

test("buildScopePills: 두 권 이상이면 마지막 알약 뒤에 「모두 지우기」가 있다(ADR-049 §3)", () => {
  const h = loadPureHelpers();
  for (const counts of [null, [["luke", 23], ["john", 48], ["lps", 0]]]) {
    const { all, clear, cleared } = scopePills(h, { counts });
    assert.strictEqual(all[all.length - 1], clear, "줄의 맨 끝");
    const btn = clear.children[0];
    assert.strictEqual(btn.tagName, "BUTTON");
    assert.strictEqual(btn.getAttribute("type"), "button");
    assert.strictEqual(recursiveText(btn), "모두 지우기");
    // 스크린 리더의 이름은 보이는 글자를 담는다(WCAG 2.5.3)
    assert.strictEqual(btn.getAttribute("aria-label"), "고른 책 모두 지우기");
    assert.strictEqual(btn.getAttribute("data-focus-key"), "book:clear");
    btn.eventListeners.click[0]({ detail: 1 });
    assert.strictEqual(cleared.length, 1);
  }
  const two = scopePills(h, { books: SCOPE_BOOKS.slice(0, 2) });
  assert.ok(two.clear);
});

test("buildScopePills: 한 권이면 「전체」 없이 그 책이 늘 고른 알약이고 주소에 책을 적지 않는다(ADR-049 §2)", () => {
  const h = loadPureHelpers();
  const { items, clear } = scopePills(h, { books: [{ id: "mark", name: "마르" }], counts: [["mark", 6]] });
  assert.strictEqual(items.length, 1);
  // 한 권이면 그 알약의 ×가 같은 일을 하므로 「모두 지우기」가 없다(§3)
  assert.strictEqual(clear, null);
  assert.strictEqual(scopePills(h, { books: [{ id: "mark", name: "마르" }] }).clear, null);
  const a = items[0].children[0];
  assert.deepStrictEqual([recursiveText(a), a.getAttribute("aria-current"), a.getAttribute("href")],
    ["마르 6건", "true", "/search?q=%EC%82%AC%EB%9E%91&in=luke&in=john&in=lps"]);
});

test("buildSearchPills: 고른 알약에 aria-current, 알약마다 주소와 포커스 키, 스크린 리더에는 「건」", () => {
  const h = loadPureHelpers();
  const nav = h.buildSearchPills("lectionary", { bible: 198, lectionary: 3 }, (g) => h.buildSearchUrl({ q: "x", group: g }));
  assert.strictEqual(nav.getAttribute("aria-label"), "검색 결과 묶음");
  const links = nav.children[0].children.map((li) => li.children[0]);
  assert.deepStrictEqual(links.map((a) => a.getAttribute("href")), ["/search?q=x", "/search?q=x&group=lectionary"]);
  assert.deepStrictEqual(links.map((a) => a.getAttribute("aria-current")), [null, "true"]);
  assert.deepStrictEqual(links.map((a) => a.getAttribute("data-focus-key")), ["group:bible", "group:lectionary"]);
  assert.deepStrictEqual(links.map((a) => recursiveText(a)), ["성서 본문 198건", "전례일 3건"]);
});

test("buildSearchPills: 결과가 있는 묶음만 「성서 본문, 성시, 전례일」의 차례로 둔다(ADR-046 §3)", () => {
  const h = loadPureHelpers();
  const href = (g) => h.buildSearchUrl({ q: "x", group: g });
  const all = h.buildSearchPills("psalter", { lectionary: 3, psalter: 12, bible: 198 }, href);
  const links = all.children[0].children.map((li) => li.children[0]);
  assert.deepStrictEqual(links.map((a) => recursiveText(a)), ["성서 본문 198건", "성시 12건", "전례일 3건"]);
  assert.deepStrictEqual(links.map((a) => a.getAttribute("aria-current")), [null, "true", null]);
  assert.deepStrictEqual(links.map((a) => a.getAttribute("href")), ["/search?q=x", "/search?q=x&group=psalter", "/search?q=x&group=lectionary"]);
  const two = h.buildSearchPills("psalter", { psalter: 12, lectionary: 3 }, href);
  assert.deepStrictEqual(two.children[0].children.map((li) => recursiveText(li.children[0])), ["성시 12건", "전례일 3건"]);
});
