"use strict";

// Unit tests for js/search-worker.js — the pure SEARCH_PURE block: query
// parsing (parseQuery, the `in:<book>` operator), verse-reference detection
// (tryVerseRef), substring gathering (gatherResults), and pagination
// (paginate). These depend only on module state (meta / loadedChunks), which
// the loader declares in the prelude and lets each test swap via setters — no
// worker globals (postMessage / onmessage / fetch) are pulled in. Harness
// mirrors tests/unit/views.test.js.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const WORKER_PATH = path.resolve(__dirname, "../../js/search-worker.js");
const WORKER_SOURCE = fs.readFileSync(WORKER_PATH, "utf8");

function extractBlock(name, source, file) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) {
    throw new Error(`marker block ${name} not found in ${file}`);
  }
  return source.slice(startIdx, endIdx + end.length);
}

// ── SEARCH_PURE loader ───────────────────────────────────────────────────────
// meta.aliases maps a search alias → bookId; meta.books maps bookId → { ko }.
// loadedChunks maps a chunk name → column arrays (b index, c, v, t).

function loadSearchPure() {
  const ctx = {
    Object, Array, Set, Map, JSON, console, Error, Math, parseInt, RegExp, String,
  };
  vm.createContext(ctx);
  const prelude = `
    let meta = null;
    let loadedChunks = {};
    function _setMeta(m) { meta = m; }
    function _setChunks(c) { loadedChunks = c; }
  `;
  vm.runInContext(
    prelude + extractBlock("SEARCH_PURE", WORKER_SOURCE, "search-worker.js"),
    ctx,
    { filename: "search-worker.js" },
  );
  return ctx;
}

const ctx = loadSearchPure();

const META = {
  aliases: { "요한": "john", "창세": "genesis", "gen": "genesis" },
  books: {
    john: { ko: "요한복음" },
    genesis: { ko: "창세기" },
  },
};
ctx._setMeta(META);

// Helper to rehydrate a Set returned across the vm boundary (instanceof differs).
const asArray = (s) => Array.from(s);

// ── parseQuery — keyword + in:<book> operator ──

test("parseQuery: 연산자 없는 평범한 검색어", () => {
  const r = ctx.parseQuery("사랑");
  assert.equal(r.keyword, "사랑");
  assert.deepEqual(asArray(r.restrictBooks), []);
  assert.deepEqual(r.unmatched, []);
});

test("parseQuery: in:<별칭>이 책 범위로 추출되고 키워드에서 제거됨", () => {
  const r = ctx.parseQuery("사랑 in:요한");
  assert.equal(r.keyword, "사랑");
  assert.deepEqual(asArray(r.restrictBooks), ["john"]);
  assert.deepEqual(r.unmatched, []);
});

test("parseQuery: in: 뒤 공백 허용", () => {
  const r = ctx.parseQuery("사랑 in: 요한");
  assert.equal(r.keyword, "사랑");
  assert.deepEqual(asArray(r.restrictBooks), ["john"]);
});

test("parseQuery: in:이 키워드 앞에 와도 동작", () => {
  const r = ctx.parseQuery("in:gen 사랑");
  assert.equal(r.keyword, "사랑");
  assert.deepEqual(asArray(r.restrictBooks), ["genesis"]);
});

test("parseQuery: 여러 in:은 OR로 누적", () => {
  const r = ctx.parseQuery("사랑 in:요한 in:gen");
  assert.deepEqual(asArray(r.restrictBooks).sort(), ["genesis", "john"]);
});

test("parseQuery: 영문 별칭은 대소문자 무시", () => {
  const r = ctx.parseQuery("사랑 in:GEN");
  assert.deepEqual(asArray(r.restrictBooks), ["genesis"]);
});

test("parseQuery: 알 수 없는 별칭은 unmatched로, 범위는 비움", () => {
  const r = ctx.parseQuery("사랑 in:없는책");
  assert.deepEqual(asArray(r.restrictBooks), []);
  assert.deepEqual(r.unmatched, ["없는책"]);
});

test("parseQuery: 중복 공백은 단일 공백으로 정리", () => {
  assert.equal(ctx.parseQuery("  사랑   은혜  ").keyword, "사랑 은혜");
});

// ── tryVerseRef — "<책> <장>:<절>" 감지 ──

test("tryVerseRef: 별칭 + 단일 절", () => {
  assert.deepEqual(ctx.tryVerseRef("창세 1:3"), {
    bookId: "genesis", chapter: 1, verse: 3, verseEnd: null, bookNameKo: "창세기",
  });
});

test("tryVerseRef: 절 범위(하이픈)", () => {
  const r = ctx.tryVerseRef("창세 1:3-11");
  assert.equal(r.verse, 3);
  assert.equal(r.verseEnd, 11);
});

test("tryVerseRef: 전체 한글 책 이름(meta.books.ko)으로도 매칭", () => {
  const r = ctx.tryVerseRef("요한복음 3:16");
  assert.equal(r.bookId, "john");
  assert.equal(r.bookNameKo, "요한복음");
});

test("tryVerseRef: 영문 id 대소문자 무시", () => {
  assert.equal(ctx.tryVerseRef("Gen 1:1").bookId, "genesis");
});

test("tryVerseRef: 절 패턴이 아니면 null", () => {
  assert.equal(ctx.tryVerseRef("사랑"), null);
});

test("tryVerseRef: 알 수 없는 책이면 null", () => {
  assert.equal(ctx.tryVerseRef("없는책 1:1"), null);
});

// ── gatherResults — 부분 문자열 매칭 + 책 범위 필터 ──

const CHUNKS = {
  ot: {
    books: ["genesis", "john"],
    bArr: [0, 0, 1],
    cArr: [1, 1, 3],
    vArr: [1, 3, 16],
    tArr: ["한처음에 하느님께서", "하느님께서 사랑하시어", "하느님이 세상을 사랑하사"],
  },
};

test("gatherResults: 부분 문자열로 매칭(대소문자 무시)", () => {
  ctx._setChunks(CHUNKS);
  const rows = ctx.gatherResults("사랑", ["ot"], null);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.b).sort(), ["genesis", "john"]);
});

test("gatherResults: restrictBooks로 책 범위 제한", () => {
  ctx._setChunks(CHUNKS);
  const rows = ctx.gatherResults("사랑", ["ot"], new Set(["john"]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].b, "john");
  assert.equal(rows[0].v, 16);
});

test("gatherResults: 매칭 없으면 빈 배열", () => {
  ctx._setChunks(CHUNKS);
  assert.deepEqual(ctx.gatherResults("없는단어", ["ot"], null), []);
});

test("gatherResults: 로드되지 않은 청크는 건너뜀", () => {
  ctx._setChunks(CHUNKS);
  assert.deepEqual(ctx.gatherResults("사랑", ["missing"], null), []);
});

test("gatherResults: 행에 책/장/절/본문이 그대로 담김", () => {
  ctx._setChunks(CHUNKS);
  const rows = ctx.gatherResults("한처음", ["ot"], null);
  assert.deepEqual(rows[0], { b: "genesis", c: 1, v: 1, t: "한처음에 하느님께서" });
});

// ── paginate — 페이지 슬라이싱 + 책 한글명 매핑 ──

const MATCHED = Array.from({ length: 25 }, (_, i) => ({
  b: "genesis", c: 1, v: i + 1, t: `절 ${i + 1}`,
}));

test("paginate: 첫 페이지는 pageSize만큼, total은 전체", () => {
  ctx._setMeta(META);
  const r = ctx.paginate(MATCHED, 1, 10);
  assert.equal(r.results.length, 10);
  assert.equal(r.total, 25);
  assert.equal(r.results[0].v, 1);
  assert.equal(r.results[0].bookNameKo, "창세기");
});

test("paginate: 둘째 페이지는 다음 구간", () => {
  const r = ctx.paginate(MATCHED, 2, 10);
  assert.equal(r.results.length, 10);
  assert.equal(r.results[0].v, 11);
});

test("paginate: 마지막 페이지는 남은 만큼만", () => {
  const r = ctx.paginate(MATCHED, 3, 10);
  assert.equal(r.results.length, 5);
  assert.equal(r.results[4].v, 25);
});

test("paginate: 범위 밖 페이지는 빈 결과(total은 유지)", () => {
  const r = ctx.paginate(MATCHED, 99, 10);
  assert.deepEqual(r.results, []);
  assert.equal(r.total, 25);
});
