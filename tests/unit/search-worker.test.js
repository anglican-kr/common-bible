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
    Object, Array, Set, Map, JSON, console, Error, Math, Number, parseInt, RegExp, String,
  };
  vm.createContext(ctx);
  const prelude = `
    let meta = null;
    let loadedChunks = {};
    function _setMeta(m) { meta = m; }
    function _setChunks(c) { loadedChunks = c; }
  `;
  // LECTIONARY_PURE uses REF_CHAPTER_END from SEARCH_PURE, so both run as one script.
  vm.runInContext(
    prelude + extractBlock("SEARCH_PURE", WORKER_SOURCE, "search-worker.js") + "\n"
      + extractBlock("LECTIONARY_PURE", WORKER_SOURCE, "search-worker.js"),
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

test("tryVerseRef: 범위의 한쪽 끝이 0이면 구절로 읽지 않는다", () => {
  // 「요한 3:16,18-0」을 읽으면 주소가 「0-18」이 되어 따로 적은 16절까지 강조되지 않았다.
  for (const q of ["요한 3:16,18-0", "요한 3:5-0", "요한 3:0-5", "창세 61:10-62:0", "창세 61:0-62:3"]) {
    assert.equal(ctx.tryVerseRef(q), null, q);
  }
});

test("tryVerseRef: 0절 하나는 그 장을 여는 표기로 남는다", () => {
  assert.deepEqual(partsOf("창세 1:0"), [[1, "0"]]);
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

test("tryVerseRef: 긴 입력에서도 바로 끝난다", () => {
  const start = Date.now();
  assert.equal(ctx.tryVerseRef(`창세 1:${"1, ".repeat(50_000)}사랑`), null);
  assert.equal(ctx.tryVerseRef("1".repeat(100_000)), null);
  assert.equal(ctx.tryVerseRef(`창세 ${"1 ".repeat(50_000)}`), null);
  assert.ok(Date.now() - start < 1000);
});

test("tryVerseRef: 구간은 200개까지다", () => {
  const verses = (n) => Array.from({ length: n }, (_, i) => `${i + 1}:1`).join(", ");
  assert.equal(partsOf(`창세 ${verses(200)}`).length, 200);
  assert.equal(ctx.tryVerseRef(`창세 ${verses(201)}`), null);
  const chapters = (n) => Array.from({ length: n }, (_, i) => i + 1).join(", ");
  assert.equal(partsOf(`창세 ${chapters(200)}`).length, 200);
  assert.equal(ctx.tryVerseRef(`창세 ${chapters(201)}`), null);
  // 가장 긴 책 한 권을 모두 적는 범위는 읽고, 그보다 훨씬 긴 범위는 읽지 않는다.
  assert.equal(partsOf("창세 1:1-150:6").length, 150);
  assert.equal(ctx.tryVerseRef("창세 1:1-999:1"), null);
});

test("tryVerseRef: 큰 범위를 되풀이한 검색어는 펼치다가 바로 멈춘다", () => {
  const start = Date.now();
  assert.equal(ctx.tryVerseRef(`창세 ${Array(1000).fill("1:1-999:1").join(", ")}`), null);
  assert.ok(Date.now() - start < 100);
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

// ── tryBookOnly: 책 이름만 친 검색어(ADR-044 §2) ──

const BOOK_META = {
  aliases: { "창세기": "genesis", "창세": "genesis", "창": "genesis", "요한": "john", "요한 1서": "1john", "1john": "1john" },
  books: { genesis: { ko: "창세기" }, john: { ko: "요한의 복음서" }, "1john": { ko: "요한의 첫째 편지" } },
};

test("tryBookOnly: 책 이름이나 약칭 하나면 그 책이다", () => {
  ctx._setMeta(BOOK_META);
  try {
    assert.deepEqual(ctx.tryBookOnly("창세기"), { bookId: "genesis", bookNameKo: "창세기" });
    assert.deepEqual(ctx.tryBookOnly("요한"), { bookId: "john", bookNameKo: "요한의 복음서" });
    assert.deepEqual(ctx.tryBookOnly("요한의 복음서"), { bookId: "john", bookNameKo: "요한의 복음서" });
    assert.deepEqual(ctx.tryBookOnly("1JOHN"), { bookId: "1john", bookNameKo: "요한의 첫째 편지" });
  } finally {
    ctx._setMeta(META);
  }
});

test("tryBookOnly: 띄어 쓴 책 이름은 공백을 한 칸으로 맞춰 통째로 찾는다(「요한」이 먼저 맞지 않는다)", () => {
  ctx._setMeta(BOOK_META);
  try {
    assert.equal(ctx.tryBookOnly("요한 1서").bookId, "1john");
    assert.equal(ctx.tryBookOnly("  요한   1서 ").bookId, "1john");
  } finally {
    ctx._setMeta(META);
  }
});

test("tryBookOnly: 한 글자 약칭, 낱말, 객체의 내장 이름은 책이 아니다", () => {
  ctx._setMeta(BOOK_META);
  try {
    assert.equal(ctx.tryBookOnly("창"), null);
    assert.equal(ctx.tryBookOnly("사랑"), null);
    assert.equal(ctx.tryBookOnly("요한 3:16"), null);
    assert.equal(ctx.tryBookOnly("constructor"), null);
    assert.equal(ctx.tryBookOnly("toString"), null);
  } finally {
    ctx._setMeta(META);
  }
});

// ── 전례독서 색인(ADR-037 §5): 작은 색인으로 이름 검색과 구절 검색을 본다 ──

const plain = (x) => JSON.parse(JSON.stringify(x));

const obs = (key, name, order, extra = {}) => ({
  key, name, aliases: [], kind: "temporal", date: null, rank: null, order, common: null, ...extra,
});
const LECT_RAW = {
  obs: [
    obs("t-대림1주일", "대림1주일", 0),                                                  // 0
    obs("advent-1-mon", "대림1주 월요일", 1),                                             // 1
    obs("ordinary-7-sun", "연중7주일", 10),                                               // 2
    obs("ordinary-17-sun", "연중17주일", 20),                                             // 3
    obs("ordinary-7-wed", "연중7주 수요일", 11),                                          // 4
    obs("t-성지주일", "성지주일", 5, { aliases: ["고난주일"] }),                           // 5
    obs("t-부활대축일", "부활대축일", 6),                                                  // 6
    obs("s-바울로회심", "사도 성 바울로의 회심", 30, { kind: "sanctoral", date: "01.25" }),  // 7
    obs("s-요셉", "성 요셉(성모 마리아의 남편)", 31,
      { kind: "sanctoral", date: "03.19", aliases: ["성 요셉"] }),                         // 8
    obs("s-어거스틴", "어거스틴(히포의 주교, 430년)", 32,
      { kind: "sanctoral", date: "08.28", common: "teacher" }),                            // 9
    obs("s-공현", "공현대축일", 2, { kind: "sanctoral", date: "01.06" }),                    // 10
    obs("t-왕", "왕이신 그리스도 주일", 25, { aliases: ["왕이신 그리스도"] }),              // 11
  ],
  sets: [
    [0, "advent-1-sun-A-t1-s1", "A", null, 1, "대림1주일 (가해)"],   // 0
    [0, "advent-1-sun-B-t1-s1", "B", null, 1, "대림1주일 (나해)"],   // 1
    [1, "advent-1-mon-t1-s1", null, null, 1, "대림1주 월요일"],      // 2
    [2, "ordinary-7-sun-A-t1-s1", "A", null, 1, "연중7주일 (가해)"], // 3
    [6, "easter-day-t1-s1", null, null, 1, "부활대축일"],            // 4
    [10, "epiphany-t1-s1", null, null, 1, "공현대축일"],             // 5
    [5, "palm-t1-s1", null, null, 1, "성지주일"],                    // 6
  ],
  books: ["isa", "lps", "matt", "john", "cant", "luke"],
  cov: [
    [0, 0, 2, 1, 5, 0], [0, 1, 122, 1, 9, 1], [0, 2, 24, 36, 44, 3],
    [1, 0, 2, 1, 5, 0], [1, 1, 122, 1, 9, 1], [1, 2, 24, 37, 44, 3],
    [2, 0, 2, 1, 3, 0], [2, 1, 122, 1, 9, 1], [2, 2, 8, 5, 11, 3],
    [3, 1, 23, 1, 6, 1], [3, 3, 3, 14, 21, 3],
    [4, 3, 20, 1, 18, 3],
    [5, 0, 60, 1, 6, 0], [5, 4, 11, 1, 11, 1], [5, 5, 1, 68, 79, 1],
    [6, 0, 50, 4, 9, 0], [6, 2, 26, 14, 75, 3], [6, 2, 27, 1, 66, 3],
  ],
  saints: [{ name: "어거스틴", title: "히포의 어거스틴(주교, 430년)", obs: [9] }],
  synonyms: {
    "주님 부활 대축일": "부활대축일",
    "그리스도왕": "왕이신 그리스도",
    "그리스도왕 대축일": "왕이신 그리스도 주일",
  },
};
const LECT = ctx.buildLectionarySearchIndex(LECT_RAW);

const names = (q) => plain(ctx.searchLectionaryNames(LECT, q).items.map((it) => [it.obs.name, it.tier]));

test("normalizeLectName: 띄어쓰기, 가운뎃점, 따옴표를 빼고 주의 번호를 「N주」로 맞춘다", () => {
  assert.equal(ctx.normalizeLectName("대림 1주일"), "대림1주");
  assert.equal(ctx.normalizeLectName("연중 제34주간 토요일"), "연중34주토요일");
  assert.equal(ctx.normalizeLectName("연중 7주간"), "연중7주");
  assert.equal(ctx.normalizeLectName("제7주"), "7주");
  assert.equal(ctx.normalizeLectName("성 바울로·바나바 ‘사도’"), "성바울로바나바사도");
  assert.equal(ctx.normalizeLectName("성지주일"), "성지주일", "번호 없는 「주일」은 그대로");
});

test("findWhole: 숫자는 통째로만 찾는다", () => {
  assert.equal(ctx.findWhole("연중17주", "연중7주"), -1);
  assert.equal(ctx.findWhole("연중17주", "7주"), -1);
  assert.equal(ctx.findWhole("연중10주", "연중1"), -1);
  assert.equal(ctx.findWhole("연중7주수요일", "연중7주"), 0);
  assert.equal(ctx.findWhole("연중17주와연중7주", "7주"), 8);
});

test("searchLectionaryNames: 이름 전체가 같은 것, 이름이 검색어로 시작하는 것의 차례", () => {
  assert.deepEqual(names("대림1주일"), [["대림1주일", 1], ["대림1주 월요일", 2]]);
  assert.deepEqual(names("대림 1주일"), [["대림1주일", 1], ["대림1주 월요일", 2]]);
  assert.deepEqual(names("대림1주"), [["대림1주일", 1], ["대림1주 월요일", 2]]);
});

test("searchLectionaryNames: 같은 단계 안에서는 전례년 순서다", () => {
  assert.deepEqual(names("대림"), [["대림1주일", 2], ["대림1주 월요일", 2]]);
  // 색인의 차례(부활대축일 6번, 공현대축일 10번)가 아니라 전례년 순서(order 6, 2)다.
  assert.deepEqual(names("축일"), [["공현대축일", 3], ["부활대축일", 3]]);
});

test("searchLectionaryNames: 「연중 7주」로 「연중17주일」은 찾지 않는다", () => {
  assert.deepEqual(names("연중 7주"), [["연중7주일", 1], ["연중7주 수요일", 2]]);
  assert.deepEqual(names("연중 제7주간"), [["연중7주일", 1], ["연중7주 수요일", 2]]);
});

test("searchLectionaryNames: 별칭으로 찾으면 그 별칭을 적는다", () => {
  const [hit] = plain(ctx.searchLectionaryNames(LECT, "고난주일").items);
  assert.equal(hit.obs.name, "성지주일");
  assert.equal(hit.tier, 1);
  assert.equal(hit.matched, "고난주일");
  assert.deepEqual(hit.sets.map((s) => s.id), ["palm-t1-s1"]);
});

test("searchLectionaryNames: 이름이 같은 단계로 맞으면 별칭은 적지 않는다", () => {
  const [hit] = plain(ctx.searchLectionaryNames(LECT, "성지주일").items);
  assert.equal(hit.tier, 1);
  assert.equal(hit.matched, undefined);
});

test("searchLectionaryNames: 성인의 이름과 칭호로 그 성인의 축일을 찾는다", () => {
  const [hit] = plain(ctx.searchLectionaryNames(LECT, "어거스틴").items);
  assert.equal(hit.obs.key, "s-어거스틴");
  assert.equal(hit.tier, 1, "성인 이름 전체가 같다");
  assert.equal(hit.matched, "히포의 어거스틴(주교, 430년)");
  assert.deepEqual(hit.sets, [], "독서 세트가 없는 날도 찾는다");
  assert.equal(hit.obs.common, "teacher");
  assert.deepEqual(names("히포의 어거스틴"), [["어거스틴(히포의 주교, 430년)", 2]]);
});

test("searchLectionaryNames: 독서가 없는 월별 축일도 별칭으로 찾는다", () => {
  const items = plain(ctx.searchLectionaryNames(LECT, "성 요셉").items);
  assert.deepEqual(items.map((it) => [it.obs.date, it.tier, it.matched]), [["03.19", 1, "성 요셉"]]);
});

test("searchLectionaryNames: 비슷한 말로 바꿔 찾으면 바꾼 말을 알린다", () => {
  const r = plain(ctx.searchLectionaryNames(LECT, "주님 부활 대축일"));
  assert.deepEqual(r.items.map((it) => it.obs.name), ["부활대축일"]);
  assert.deepEqual(r.synonyms, [{ from: "주님 부활 대축일", to: "부활대축일" }]);
  assert.deepEqual(plain(ctx.searchLectionaryNames(LECT, "부활대축일").synonyms), [], "바꾸지 않았으면 비운다");
});

test("searchLectionaryNames: 비슷한 말은 긴 낱말부터 바꾼다", () => {
  const r = plain(ctx.searchLectionaryNames(LECT, "그리스도왕 대축일"));
  assert.deepEqual(r.items.map((it) => [it.obs.name, it.tier]), [["왕이신 그리스도 주일", 1]]);
  assert.deepEqual(r.synonyms, [{ from: "그리스도왕 대축일", to: "왕이신 그리스도 주일" }]);
});

test("swapSynonyms: 바꾼 말을 다시 바꾸지 않는다", () => {
  const index = ctx.buildLectionarySearchIndex({ ...LECT_RAW, synonyms: { "가": "나", "나": "다" } });
  assert.deepEqual(plain(ctx.swapSynonyms(index, "가나")), {
    swapped: "나다", used: [{ from: "가", to: "나" }, { from: "나", to: "다" }],
  });
});

test("searchLectionaryNames: 검색어 전체로 없으면 낱말이 모두 든 이름을 찾는다", () => {
  assert.deepEqual(names("바울로 회심"), [["사도 성 바울로의 회심", 3]]);
  assert.deepEqual(names("7주 연중"), [["연중7주일", 3], ["연중7주 수요일", 3]], "숫자는 통째로");
  assert.deepEqual(names("바울로회심"), [], "낱말을 나누지 않은 검색어는 그대로 찾는다");
});

test("searchLectionaryNames: 빈 검색어와 없는 이름은 결과가 없다", () => {
  assert.deepEqual(names("  "), []);
  assert.deepEqual(names("없는 이름"), []);
});

// 구절 검색은 tryVerseRef가 돌려주는 모양을 직접 만들어 넘긴다.
const ref = (bookId, ...parts) => ({ bookId, bookNameKo: bookId, parts: parts.map(([chapter, verses]) => ({ chapter, verses })) });
const passage = (r) => plain(ctx.searchLectionaryPassage(LECT, r).items);

test("searchLectionaryPassage: 검색어의 절을 모두 담은 독서가 먼저, 다음은 겹친 절이 많은 독서", () => {
  const items = passage(ref("isa", [2, "1-5"]));
  assert.deepEqual(items.map((it) => [it.obs.name, it.hits[0].full, it.hits[0].overlap]), [
    ["대림1주일", true, 5], ["대림1주 월요일", false, 3],
  ]);
});

test("searchLectionaryPassage: 같은 전례일에서 같은 독서를 읽는 주기는 한 독서로 묶는다", () => {
  const [day] = passage(ref("isa", [2, "4"]));
  assert.equal(day.hits.length, 1);
  assert.deepEqual(day.hits[0], {
    slot: 0, rows: [["isa", 2, 1, 5]], full: true, overlap: 1,
    sets: [
      { id: "advent-1-sun-A-t1-s1", year: "A", track: null, setNo: 1, label: "대림1주일 (가해)" },
      { id: "advent-1-sun-B-t1-s1", year: "B", track: null, setNo: 1, label: "대림1주일 (나해)" },
    ],
  });
  assert.deepEqual(day.sets.map((s) => s.id), ["advent-1-sun-A-t1-s1", "advent-1-sun-B-t1-s1"]);
});

test("searchLectionaryPassage: 다른 독서는 따로 두고, 주기마다 다르면 나눈다", () => {
  const [day] = passage(ref("matt", [24, "37"]));
  assert.deepEqual(day.hits.map((h) => [h.rows, h.sets.map((s) => s.year)]), [
    [[["matt", 24, 36, 44]], ["A"]], [[["matt", 24, 37, 44]], ["B"]],
  ]);
});

test("searchLectionaryPassage: 시편은 전례시편에서 찾고, 장만 친 검색어는 「모두 담은」 단계를 쓰지 않는다", () => {
  const items = passage(ref("ps", [122, "1-999"]));
  assert.deepEqual(items.map((it) => [it.obs.name, it.hits[0].slot, it.hits[0].full, it.hits[0].overlap]), [
    ["대림1주일", 1, false, 9], ["대림1주 월요일", 1, false, 9],
  ]);
});

test("searchLectionaryPassage: 송가는 성구로 찾고, 독서 자리는 시편이다", () => {
  const [day] = passage(ref("luke", [1, "68"]));
  assert.equal(day.obs.name, "공현대축일");
  assert.deepEqual([day.hits[0].slot, day.hits[0].rows], [1, [["cant", 11, 1, 11], ["luke", 1, 68, 79]]]);
});

test("searchLectionaryPassage: 장을 넘는 검색어와 독서", () => {
  const [day] = passage(ref("matt", [26, "14-999"], [27, "1-66"]));
  assert.equal(day.obs.name, "성지주일");
  assert.deepEqual(day.hits.map((h) => [h.slot, h.rows, h.full, h.overlap]), [
    [3, [["matt", 26, 14, 75], ["matt", 27, 1, 66]], false, 128],
  ]);
  const [one] = passage(ref("matt", [27, "1-3"]));
  assert.deepEqual([one.hits[0].full, one.hits[0].overlap], [true, 3], "독서의 한 장만 친 검색어");
});

test("searchLectionaryPassage: 절 목록은 겹친 절만 센다", () => {
  const [day] = passage(ref("john", [3, "16,20-23,16"]));
  assert.deepEqual([day.obs.name, day.hits[0].full, day.hits[0].overlap], ["연중7주일", false, 3]);
});

test("searchLectionaryPassage: 색인에 없는 책과 읽지 않는 장은 결과가 없다", () => {
  assert.deepEqual(passage(ref("genesis", [1, "1"])), []);
  assert.deepEqual(passage(ref("isa", [3, "1"])), []);
  assert.deepEqual(passage(ref("isa", [2, "6-9"])), []);
});

// ── 메시지 처리: 워커 파일 전체를 가짜 `fetch`와 타이머로 실행한다 ──

const WORKER_FILES = {
  meta: { aliases: { "이사": "isa", "이사야": "isa" }, books: { isa: { ko: "이사야" } } },
  nt: { books: ["isa"], b: [[0, 2]], c: [2, 2], v: [1, 4], t: ["마지막 날에", "칼을 쳐서 보습을 만들고"] },
  lect: LECT_RAW,
};

/**
 * @param {{ [url: string]: object | "fail" | "hang" }} files
 */
function startWorker(files) {
  const posted = [];
  const fetched = [];
  const timers = [];
  const ctx = {
    onmessage: null,
    console,
    postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))),
    setTimeout: (fn) => timers.push(fn),
    fetch: (url) => {
      fetched.push(url);
      const body = files[url];
      if (body === "hang") return new Promise(() => {});
      if (body === "fail" || !body) return Promise.resolve({ ok: false, status: 500 });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
  };
  vm.createContext(ctx);
  vm.runInContext(WORKER_SOURCE, ctx, { filename: "search-worker.js" });
  const send = (data) => ctx.onmessage({ data });
  const results = () => posted.filter((m) => m.type === "results");
  return { posted, fetched, timers, send, results };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const INIT = { type: "init", metaUrl: "meta", chunks: [{ name: "nt", url: "nt" }], lectionaryUrl: "lect" };
let searchNo = 0;
const search = (q) => ({ type: "search", q, page: 1, pageSize: 10, searchId: ++searchNo, scopeBooks: [] });

test("메시지: 색인 주소를 받으면 구절과 이름으로 전례일을 찾아 결과에 넣는다", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  assert.deepEqual(w.fetched.slice().sort(), ["lect", "meta", "nt"]);

  await w.send(search("이사 2:4"));
  const [byRef] = w.results();
  assert.equal(byRef.refMatch.bookId, "isa");
  assert.equal(byRef.bookOnly, null);
  assert.equal(byRef.lectionary.kind, "passage");
  assert.deepEqual(byRef.lectionary.items.map((it) => it.obs.name), ["대림1주일"]);

  await w.send(search("고난주일"));
  const byName = w.results()[1];
  assert.equal(byName.total, 0, "성서 본문에는 없다");
  assert.equal(byName.bookOnly, null);
  assert.deepEqual(byName.lectionary.items.map((it) => [it.obs.name, it.matched]), [["성지주일", "고난주일"]]);

  await w.send(search("이사야"));
  const byBook = w.results()[2];
  assert.deepEqual(byBook.bookOnly, { bookId: "isa", bookNameKo: "이사야" });
  assert.deepEqual(byBook.lectionary.items, []);
});

test("메시지: 색인 주소가 없으면 받지 않고 전례독서는 `null`이다(지금의 앱)", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send({ ...INIT, lectionaryUrl: undefined });
  await flush();
  await w.send(search("이사 2:4"));
  await w.send(search("보습"));
  assert.deepEqual(w.fetched.slice().sort(), ["meta", "nt"]);
  const [byRef, byWord] = w.results();
  assert.equal(byRef.lectionary, null);
  assert.equal(byWord.lectionary, null);
  assert.equal(byWord.total, 1);
});

test("메시지: 색인을 받지 못하면 전례독서 없이 답하고, 다음 검색에서 다시 받아 본다", async () => {
  const w = startWorker({ ...WORKER_FILES, lect: "fail" });
  await w.send(INIT);
  await flush();
  await w.send(search("보습"));
  await flush();
  w.timers.splice(0).forEach((fn) => fn());
  await flush();
  const [first] = w.results();
  assert.equal(first.lectionary, null);
  assert.equal(first.total, 1, "성서 결과는 그대로다");
  assert.equal(w.fetched.filter((u) => u === "lect").length, 2, "`init` 때 한 번, 다음 검색에서 한 번 더");
});

test("메시지: 색인을 받는 요청이 멈춰도 정한 시간이 지나면 성서 결과를 낸다", async () => {
  const w = startWorker({ ...WORKER_FILES, lect: "hang" });
  await w.send(INIT);
  await flush();
  w.send(search("보습"));
  await flush();
  assert.deepEqual(w.results(), [], "아직 기다린다");
  assert.equal(w.timers.length, 1);
  w.timers[0]();
  await flush();
  const [res] = w.results();
  assert.equal(res.total, 1);
  assert.equal(res.lectionary, null);
});
