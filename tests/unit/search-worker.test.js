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
    bookId: "genesis", bookNameKo: "창세기", parts: [{ chapter: 1, verses: "3" }],
  });
});

// 장마다 [장, 절 목록]으로 줄여 비교한다.
const partsOf = (q) => {
  const r = ctx.tryVerseRef(q);
  return r && r.parts.map((p) => [p.chapter, p.verses]);
};

test("tryVerseRef: 절 범위(하이픈)", () => {
  assert.deepEqual(partsOf("창세 1:3-11"), [[1, "3-11"]]);
});

test("tryVerseRef: 쉼표로 이은 절 목록(공백은 빼고 넘긴다)", () => {
  assert.deepEqual(partsOf("요한 3:16, 18-19"), [[3, "16,18-19"]]);
  assert.deepEqual(partsOf("요한 3:16,18-19"), [[3, "16,18-19"]]);
  assert.deepEqual(partsOf("요한 3 : 16 , 18 – 19"), [[3, "16,18-19"]]);
  assert.deepEqual(partsOf("요한 3:1, 3, 5-7, 9"), [[3, "1,3,5-7,9"]]);
});

test("tryVerseRef: 순서는 친 그대로 넘긴다(주소 표기로 바꾸는 것은 앱의 verseRefTargets)", () => {
  assert.deepEqual(partsOf("요한 3:18-19, 16"), [[3, "18-19,16"]]);
});

test("tryVerseRef: 장만 적으면 그 장 전체", () => {
  assert.deepEqual(partsOf("요한 3"), [[3, "1-999"]]);
  assert.deepEqual(partsOf("요한3"), [[3, "1-999"]]);
  assert.deepEqual(partsOf("요한 42, 43"), [[42, "1-999"], [43, "1-999"]]);
});

test("tryVerseRef: 뒤에 장을 다시 적으면 장마다 나눈다", () => {
  assert.deepEqual(partsOf("창세 18:6-9, 19:1-7"), [[18, "6-9"], [19, "1-7"]]);
  assert.deepEqual(partsOf("창세 9:1-4, 17-19, 10:1"), [[9, "1-4,17-19"], [10, "1"]]);
  assert.deepEqual(partsOf("창세 6:5-8, 7:1-5, 10"), [[6, "5-8"], [7, "1-5,10"]]);
});

test("tryVerseRef: 같은 장을 나중에 다시 적으면 처음 적은 자리에 합친다", () => {
  assert.deepEqual(partsOf("창세 6:5, 7:1, 6:9"), [[6, "5,9"], [7, "1"]]);
});

test("tryVerseRef: 장을 넘는 범위는 앞 장은 끝까지, 사이의 장은 전체, 끝 장은 1절부터", () => {
  assert.deepEqual(partsOf("창세 61:10-62:3"), [[61, "10-999"], [62, "1-3"]]);
  assert.deepEqual(partsOf("창세 1:20-3:4"), [[1, "20-999"], [2, "1-999"], [3, "1-4"]]);
});

test("tryVerseRef: 장을 넘는 범위 뒤의 구간은 끝 장의 절이다", () => {
  assert.deepEqual(partsOf("창세 9:35-10:1, 5-8"), [[9, "35-999"], [10, "1-1,5-8"]]);
  assert.deepEqual(partsOf("창세 13:1-2, 25-14:1, 26-35"), [[13, "1-2,25-999"], [14, "1-1,26-35"]]);
});

test("tryVerseRef: 절의 반쪽 표시는 지운다", () => {
  assert.deepEqual(partsOf("요한 2:42-47상"), [[2, "42-47"]]);
  assert.deepEqual(partsOf("창세 45:6하-8, 18, 21하"), [[45, "6-8,18,21"]]);
  assert.deepEqual(partsOf("창세 7:8ㄱ"), [[7, "8"]]);
  assert.deepEqual(partsOf("창세 1:1–2:4a"), [[1, "1-999"], [2, "1-4"]]);
  assert.deepEqual(partsOf("창세 63:19하-64:8"), [[63, "19-999"], [64, "1-8"]]);
});

test("tryVerseRef: 빈 구간, 없는 장, 거꾸로 된 장은 구절로 읽지 않는다", () => {
  for (const q of ["요한 3:16,", "요한 3:16,,18", "요한 3:,16", "없는책 1:1, 3", "요한 0", "요한 0:5", "요한 5:1-3:2", "요한 3:1:2"]) {
    assert.equal(ctx.tryVerseRef(q), null, q);
  }
});

test("tryVerseRef: 번호는 세 자리까지다", () => {
  for (const q of ["요한 1000", "요한 3:1000", "요한 3:1-1000:1"]) {
    assert.equal(ctx.tryVerseRef(q), null, q);
  }
});

test("tryVerseRef: 낱말 검색의 쉼표는 본문 글자로 남는다", () => {
  for (const q of ["나의 목자, 아쉬울 것", "요한, 야고보", "요한 3, 사랑", "사랑 3:16"]) {
    assert.equal(ctx.tryVerseRef(q), null, q);
  }
});

test("tryVerseRef: 긴 입력에서도 바로 끝나고 카드 수에 상한이 있다", () => {
  const start = Date.now();
  assert.equal(ctx.tryVerseRef(`창세 1:${"1, ".repeat(50_000)}사랑`), null);
  assert.equal(ctx.tryVerseRef("1".repeat(100_000)), null);
  assert.equal(ctx.tryVerseRef(`창세 ${"1 ".repeat(50_000)}`), null);
  assert.equal(partsOf("창세 1:1-999:1").length, 999);
  assert.ok(Date.now() - start < 1000);
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

test("gatherResults: 따옴표를 무시하고 일치한다(ADR-005, 2026-11-06)", () => {
  ctx._setChunks({
    nt: { books: ["genesis"], bArr: [0, 0], cArr: [1, 1], vArr: [3, 4],
      tArr: ["하느님께서 “빛이 생겨라!” 하시자 빛이 생겨났다.", "그 빛이 하느님 보시기에 좋았다."] },
  });
  assert.deepEqual(ctx.gatherResults('"빛이 생겨라!"', ["nt"], null).map((r) => r.v), [3]);
  assert.deepEqual(ctx.gatherResults("생겨라! 하시자", ["nt"], null).map((r) => r.v), [3]);
});

test("gatherResults: 따옴표를 지워 공백이 겹치는 본문과 원문에 공백이 둘인 본문을 공백 한 칸의 검색어로 찾는다(ADR-005, 2026-11-06)", () => {
  ctx._setChunks({
    nt: { books: ["gal", "genesis"], bArr: [0, 0, 1], cArr: [3, 3, 1], vArr: [8, 9, 3],
      // 인덱스는 인용으로 나뉜 조각 사이에 공백 한 칸을 넣는다: `아브라함에게 “ 너로`.
      tArr: ["성서는 아브라함에게 “ 너로 말미암아 복을 받으리라. ”는 복음을 전했다.", "관계 없는 절", "하느님께서  빛이  생겨라 하시자"] },
  });
  assert.deepEqual(ctx.gatherResults("아브라함에게 너로", ["nt"], null).map((r) => r.v), [8]);
  assert.deepEqual(ctx.gatherResults("아브라함에게  “ 너로", ["nt"], null).map((r) => r.v), [8]);
  assert.deepEqual(ctx.gatherResults("빛이 생겨라 하시자", ["nt"], null).map((r) => r.v), [3]);
});

test("gatherResults: 따옴표만 친 검색어는 결과가 없다", () => {
  ctx._setChunks(CHUNKS);
  assert.deepEqual(ctx.gatherResults('"', ["ot"], null), []);
  assert.deepEqual(ctx.gatherResults("“ ’", ["ot"], null), []);
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
