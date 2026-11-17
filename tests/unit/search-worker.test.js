"use strict";

// Unit tests for js/search-worker.js. Most run the pure blocks alone: SEARCH_PURE (query parsing with the
// `in:<book>` operator, verse references, book names, substring gathering, pagination) and LECTIONARY_PURE (the
// lectionary search on a small index). They depend only on module state (meta / loadedChunks), which the loader
// declares in the prelude and lets each test swap via setters. The message section at the end runs the whole worker
// file with a fake fetch, clock and timers (startWorker). Harness mirrors tests/unit/views.test.js.

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

test("parseQuery: 객체가 물려받은 이름(`constructor`)은 책 별칭이 아니다", () => {
  const r = ctx.parseQuery("사랑 in:constructor");
  assert.deepStrictEqual([asArray(r.restrictBooks), asArray(r.unmatched)], [[], ["constructor"]]);
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

test("lookupBook: 구절 표기와 책 이름만 친 검색어가 같은 규칙으로 책을 찾는다", () => {
  ctx._setMeta(BOOK_META);
  try {
    assert.equal(ctx.tryVerseRef("요한  1서 3:16").bookId, "1john", "공백이 여럿이어도 띄어 쓴 책 이름");
    assert.equal(ctx.tryVerseRef("1JOHN 3:16").bookId, "1john");
    assert.equal(ctx.tryVerseRef("constructor 3:16"), null);
    const cases = [["창세기", "genesis"], ["요한", "john"], ["요한 1서", "1john"], ["요한의 복음서", "john"], ["1JOHN", "1john"]];
    for (const [name, id] of cases) {
      assert.equal(ctx.lookupBook(name), id, name);
      assert.equal(ctx.tryVerseRef(`${name} 1:1`).bookId, id, `${name} 1:1`);
      assert.equal(ctx.tryBookOnly(name).bookId, id, name);
    }
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
  // 이름과 별칭(`왕이신 그리스도`)이 모두 이름 안에 든 단계로 맞는다.
  assert.deepStrictEqual(plain(ctx.searchLectionaryNames(LECT, "그리스도").items).map((it) => [it.obs.name, it.tier, it.matched]),
    [["왕이신 그리스도 주일", 3, undefined]]);
  // 별칭이 먼저 맞고(검색어 그대로) 이름이 뒤에 같은 단계로 맞아도(비슷한 말로 바꾼 검색어) 이름을 적는다.
  const index = ctx.buildLectionarySearchIndex({
    ...LECT_RAW, obs: LECT_RAW.obs.map((o) => (o.name === "부활대축일" ? { ...o, aliases: ["주님 부활 대축일"] } : o)),
  });
  const [easter] = plain(ctx.searchLectionaryNames(index, "주님 부활 대축일").items);
  assert.deepStrictEqual([easter.obs.name, easter.tier, easter.matched], ["부활대축일", 1, undefined]);
});

test("searchLectionaryNames: 앱이 보낸 이름(성탄 평일의 화면 이름)을 별칭처럼 찾고 그 이름을 적는다(ADR-044 §3)", () => {
  // 독서 세트로 그 전례일을 찾는다. 모르는 세트는 버린다
  const extra = [["advent-1-mon-t1-s1", "성탄 1주 화요일"], ["nope-t1-s1", "성탄 1주 수요일"]];
  const items = plain(ctx.searchLectionaryNames(LECT, "성탄 1주 화요일", extra).items);
  assert.deepStrictEqual(items.map((it) => [it.obs.name, it.tier, it.matched]), [["대림1주 월요일", 1, "성탄 1주 화요일"]]);
  assert.deepStrictEqual(plain(ctx.searchLectionaryNames(LECT, "성탄 1주", extra).items).map((it) => [it.obs.name, it.tier]),
    [["대림1주 월요일", 2]]);
  assert.deepStrictEqual(plain(ctx.searchLectionaryNames(LECT, "성탄 1주 수요일", extra).items), []);
  // 색인의 이름으로 찾으면 앱이 보낸 이름을 적지 않는다
  const own = plain(ctx.searchLectionaryNames(LECT, "대림1주 월요일", extra).items);
  assert.deepStrictEqual(own.map((it) => [it.obs.name, it.matched]), [["대림1주 월요일", undefined]]);
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

test("parseLectYear: 이름의 앞이나 뒤에 붙인 연도와 범위를 읽는다(ADR-044 §4)", () => {
  const year = (q) => plain(ctx.parseLectYear(q));
  const nicola = (from, to = from, capped = false) => ({ name: "성 니콜라", from, to, capped, over: false, last: 2050 });
  assert.deepStrictEqual(year("2027년 성 니콜라"), nicola(2027));
  assert.deepStrictEqual(year("2027 성 니콜라"), nicola(2027), "「년」 없이 네 자리 숫자만");
  assert.deepStrictEqual(year("성 니콜라 2027년"), nicola(2027), "이름 뒤");
  assert.deepStrictEqual(year("  성 니콜라   2027  "), nicola(2027));
  assert.deepStrictEqual(year("2024-2026 성 니콜라"), nicola(2024, 2026));
  assert.deepStrictEqual(year("2024~2026 성 니콜라"), nicola(2024, 2026), "물결표");
  assert.deepStrictEqual(year("2024～2026 성 니콜라"), nicola(2024, 2026), "전각 물결표");
  assert.deepStrictEqual(year("2024년-2026년 성 니콜라"), nicola(2024, 2026));
  assert.deepStrictEqual(year("2024 - 2026 성 니콜라"), nicola(2024, 2026), "기호 앞뒤의 공백");
  assert.deepStrictEqual(year("성 니콜라 2026-2024"), nicola(2024, 2026), "거꾸로 쓴 범위는 작은 해부터");
});

test("parseLectYear: 범위는 앞의 10년까지이고, 찾는 해는 1583년부터 2050년까지다(ADR-044 §4)", () => {
  const nicola = (from, to, capped, over) => ({ name: "성 니콜라", from, to, capped, over, last: 2050 });
  assert.deepStrictEqual(plain(ctx.parseLectYear("2000-2050 성 니콜라")), nicola(2000, 2009, true, false));
  assert.deepStrictEqual(plain(ctx.parseLectYear("2000-2009 성 니콜라")), nicola(2000, 2009, false, false));
  assert.deepStrictEqual(plain(ctx.parseLectYear("1583 성 니콜라")), nicola(1583, 1583, false, false));
  // 2050년보다 늦은 해는 연도로 읽되 2050년에서 자른다. 처음부터 늦으면 찾을 해가 없다(from이 to보다 늦다)
  assert.deepStrictEqual(plain(ctx.parseLectYear("2045-2060 성 니콜라")), nicola(2045, 2050, false, true));
  assert.deepStrictEqual(plain(ctx.parseLectYear("2030-2060 성 니콜라")), nicola(2030, 2039, true, true), "2050년에서 자른 뒤 10년");
  assert.deepStrictEqual(plain(ctx.parseLectYear("2060 성 니콜라")), nicola(2060, 2050, false, true));
  // 성인 칭호의 해(「1556년」)는 받는 해 밖이라 이름의 일부로 찾는다
  assert.equal(ctx.parseLectYear("1556년 크랜머"), null);
  assert.equal(ctx.parseLectYear("1580-1590 성 니콜라"), null);
});

test("parseLectYear: 두 자리 연도, 여러 해를 늘어놓은 것, 날짜, 이름 없는 연도는 읽지 않는다", () => {
  for (const q of ["27년 성 니콜라", "2024, 2026 성 니콜라", "2026-12-25 성탄", "2027", "2027년", "2024 2026", "2024-2026",
    "연중 7주", "성 니콜라", "2027년성 니콜라"]) {
    assert.equal(ctx.parseLectYear(q), null, q);
  }
});

test("lectNameMatches: 이름 검색과 같게 검색어 전체나 낱말이 모두 든 이름이다", () => {
  assert.equal(ctx.lectNameMatches("성탄 1주 수요일", "성탄1주"), true);
  assert.equal(ctx.lectNameMatches("성탄 1주 수요일", "성탄 1주일"), true, "「1주일」도 「1주」로 맞춘다");
  assert.equal(ctx.lectNameMatches("성탄 1주 수요일", "수요일 성탄"), true, "낱말이 모두 들었다");
  assert.equal(ctx.lectNameMatches("성탄 1주 수요일", "성탄 11주"), false, "숫자는 통째로");
  assert.equal(ctx.lectNameMatches("성탄 1주 수요일", "성탄주간"), false);
});

// 성탄 평일 둘(색인의 이름은 「성탄주간」)을 더한 색인
const LECT_XMAS = ctx.buildLectionarySearchIndex({
  ...LECT_RAW,
  obs: [...LECT_RAW.obs,
    obs("d1229-성탄주간", "성탄주간", 40, { date: "12.29" }), // 12
    obs("d0102-성탄주간", "성탄주간", 41, { date: "01.02" })], // 13
  sets: [...LECT_RAW.sets, [12, "d1229-성탄주간-t1-s1", null, null, 1, "성탄주간"], [13, "d0102-성탄주간-t1-s1", null, null, 1, "성탄주간"]],
});

test("searchLectionaryYears: 연도를 뗀 이름으로 찾고 해를 함께 넘긴다(ADR-044 §4)", () => {
  const r = plain(ctx.searchLectionaryYears(LECT_XMAS, ctx.parseLectYear("2024-2026 대림1주일")));
  assert.deepStrictEqual(r.years, { from: 2024, to: 2026, capped: false, over: false, last: 2050 });
  assert.deepStrictEqual(r.items.map((it) => [it.obs.name, it.yearNames]), [["대림1주일", undefined], ["대림1주 월요일", undefined]]);
});

test("searchLectionaryYears: 성탄 평일은 그해에 받을 수 있는 이름으로 찾고, 그 이름들을 줄에 단다", () => {
  const r = plain(ctx.searchLectionaryYears(LECT_XMAS, ctx.parseLectYear("2027 성탄1주")));
  assert.deepStrictEqual(r.items.map((it) => it.obs.key), ["d1229-성탄주간", "d0102-성탄주간"]);
  assert.deepStrictEqual(r.items[0].yearNames, ["월", "화", "수", "목", "금", "토"].map((d) => `성탄 1주 ${d}요일`));
  assert.deepStrictEqual(plain(ctx.searchLectionaryYears(LECT_XMAS, ctx.parseLectYear("2027 성탄 2주 화요일"))).items
    .map((it) => it.yearNames), [["성탄 2주 화요일"], ["성탄 2주 화요일"]]);
  // 색인의 이름으로 찾았으면 해마다 둔다(이름을 달지 않는다)
  const own = plain(ctx.searchLectionaryYears(LECT_XMAS, ctx.parseLectYear("2027 성탄주간")));
  assert.deepStrictEqual(own.items.map((it) => [it.obs.key, it.yearNames]), [["d1229-성탄주간", undefined], ["d0102-성탄주간", undefined]]);
  // 성탄 평일의 이름이 될 수 없는 검색어는 성탄 평일을 더하지 않는다
  assert.deepStrictEqual(plain(ctx.searchLectionaryYears(LECT_XMAS, ctx.parseLectYear("2027 연중7주일"))).items.map((it) => it.obs.key),
    ["ordinary-7-sun", "ordinary-7-wed"]);
});

// 본당 표(지역 축일, ADR-044 §3)
const DED = (date, kind = "consecration") => ({ date, kind, color: "white", rank: kind === "consecration" ? "major_feast" : null });
const LOCAL_RAW = {
  province: { name: "대한성공회", founded: "09.29", founded_year: 1992 },
  dioceses: [{ name: "서울", founded: "05.27", founded_year: 1965 }, { name: "부산", founded: "06.01", founded_year: 1974 }],
  parishes: [
    { name: "용인성당", church_id: "yongin", diocese: "서울", dedication: DED("01.31") },
    { name: "오산세마대성당", church_id: "osan", diocese: "서울", dedication: DED("12.05") },
    { name: "세종성당", church_id: "sejong", diocese: "대전", dedication: DED("04.21", "blessing") },
    { name: "북.평양성당", church_id: "pyongyang", diocese: "서울", dedication: DED("05.01") },
    { name: "이름만성당", church_id: "", diocese: "서울", dedication: DED("05.02") },
    { name: "날짜틀림성당", church_id: "bad", diocese: "서울", dedication: DED("5.2") },
  ],
};
const LECT_LOCAL = Object.assign(ctx.buildLectionarySearchIndex(LECT_RAW), { local: ctx.buildLocalIndex(LOCAL_RAW) });
const local = (q, parish = "") => plain(ctx.searchLocal(LECT_LOCAL, q, parish));
const localRows = (q, parish = "") => local(q, parish).items.map((it) => [it.obs.name, it.tier]);

test("buildLocalIndex: 북한에 있던 성당과 식별자나 날짜가 없는 행은 빼고, 설립일을 읽는다", () => {
  const index = plain(LECT_LOCAL.local);
  assert.deepStrictEqual(index.parishes.map((p) => [p.name, p.base, p.kind]),
    [["용인성당", "용인", "consecration"], ["오산세마대성당", "오산세마대", "consecration"], ["세종성당", "세종", "blessing"]]);
  assert.deepStrictEqual(index.province, { name: "대한성공회", date: "09.29", year: 1992 });
  assert.deepStrictEqual(index.dioceses.map((d) => d.name), ["서울", "부산"]);
  assert.strictEqual(ctx.buildLocalIndex(null), null);
  assert.strictEqual(ctx.buildLocalIndex({ parishes: "x" }), null);
});

test("searchLocal: 소속교회의 축성일은 그 이름이나 본당 이름으로 찾는다. 끝의 「성당」과 「교회」는 같은 말이다(ADR-044 §3)", () => {
  assert.deepStrictEqual(localRows("용인", "yongin"), [["용인성당 축성일", 1]]);
  assert.deepStrictEqual(localRows("용인교회", "yongin"), [["용인성당 축성일", 1]]);
  assert.deepStrictEqual(localRows("용인 성당", "yongin"), [["용인성당 축성일", 1]]);
  assert.deepStrictEqual(localRows("용인성당 축성일", "yongin"), [["용인성당 축성일", 1]]);
  assert.deepStrictEqual(localRows("축성일", "yongin"), [["용인성당 축성일", 3]]);
  const row = local("용인", "yongin").items[0];
  assert.deepStrictEqual([row.obs.key, row.obs.kind, row.obs.date, row.obs.rank, row.local], ["local:dedication", "local", "01.31", "major_feast",
    { level: "dedication", color: "white", year: null }]);
  // 「성당」이나 「교회」만 친 검색어는 찾지 않는다. 소속교회가 아니면 이름으로 찾지 않는다
  assert.deepStrictEqual(local("성당", "yongin"), { items: [], notice: null });
  assert.deepStrictEqual(local("용인", ""), { items: [], notice: null });
  assert.deepStrictEqual(localRows("용인", "osan"), []);
});

test("searchLocal: 설정 목록의 이름(「용인교회」)에 「축성일」을 붙여도 찾는다", () => {
  assert.deepStrictEqual(localRows("용인교회 축성일", "yongin"), [["용인성당 축성일", 1]]);
  assert.deepStrictEqual(localRows("용인교회축성일", "yongin"), [["용인성당 축성일", 1]]);
});

test("searchLocal: 그 교구의 설립일과 관구 설립일은 이름으로 찾는다. 관구 설립일은 소속교회와 상관없다", () => {
  assert.deepStrictEqual(localRows("설립일", "yongin"), [["서울교구설립일", 3], ["관구설립일", 3]]);
  assert.deepStrictEqual(localRows("서울교구", "yongin"), [["서울교구설립일", 2]]);
  assert.deepStrictEqual(localRows("설립일", ""), [["관구설립일", 3]]);
  assert.deepStrictEqual(localRows("설립일", "sejong"), [["관구설립일", 3]], "표에 없는 교구(대전)의 설립일은 없다");
  assert.deepStrictEqual(local("관구설립일").items[0].local, { level: "province", color: null, year: 1992 });
  assert.strictEqual(local("관구설립일").items[0].obs.rank, null, "설립일 줄은 굵게 하지 않는다");
});

test("searchLocal: 소속교회의 축성일을 찾지 못하면 다른 본당, 소속교회 없음, 축복일을 알린다", () => {
  const N = (kind, name, date, churchId, mine = null) => ({ kind, name, date, churchId, mine });
  assert.deepStrictEqual(local("용인성당").notice, N("consecration", "용인성당", "01.31", "yongin"));
  assert.deepStrictEqual(local("오산교회").notice, N("consecration", "오산세마대성당", "12.05", "osan"), "이름이 시작하는 본당");
  // 소속교회가 있으면 그 교회의 종류를 함께 넘긴다(날짜만 알린다)
  assert.deepStrictEqual(local("오산성당", "yongin").notice, N("consecration", "오산세마대성당", "12.05", "osan", "consecration"), "다른 본당");
  assert.deepStrictEqual(local("용인성당", "sejong").notice, N("consecration", "용인성당", "01.31", "yongin", "blessing"));
  assert.deepStrictEqual(local("세종성당").notice, N("blessing", "세종성당", "04.21", "sejong"));
  assert.deepStrictEqual(local("축성일").notice, N("noParish", null, null, null));
  assert.deepStrictEqual(local("축성일", "sejong").notice, N("blessing", "세종성당", "04.21", "sejong", "blessing"));
  // 끝에 「성당」이나 「교회」를 붙이지 않은 본당 이름은 알리지 않는다(낱말과 겹치는 본당 이름이 있다). 북한에 있던 성당은 없다
  assert.strictEqual(local("오산").notice, null);
  assert.strictEqual(local("평양성당").notice, null);
  assert.strictEqual(local("용인성당", "yongin").notice, null, "소속교회의 줄이 있으면 알리지 않는다");
});

test("withLocalDays: 지역 축일은 찾은 단계와 날짜로 월별 축일 사이에 끼운다", () => {
  const OBS_INFO = (i) => ({ key: LECT_RAW.obs[i].key, name: LECT_RAW.obs[i].name, kind: LECT_RAW.obs[i].kind, date: LECT_RAW.obs[i].date,
    rank: null, common: null, order: LECT_RAW.obs[i].order });
  // 바울로의 회심(1월 25일, 30)과 성 요셉(3월 19일, 31) 사이에 1월 31일의 축성일
  const found = { kind: "name", items: [{ obs: OBS_INFO(7), sets: [], tier: 3 }, { obs: OBS_INFO(8), sets: [], tier: 3 }], synonyms: [] };
  const r = plain(ctx.withLocalDays(LECT_LOCAL, found, "축성일", "yongin"));
  assert.deepStrictEqual(r.items.map((it) => it.obs.name), ["사도 성 바울로의 회심", "용인성당 축성일", "성 요셉(성모 마리아의 남편)"]);
  assert.strictEqual(r.items[1].obs.order, 30.5);
  assert.strictEqual(r.localNotice, null);
  // 본당 표를 받지 못했으면 지역 축일도 안내도 없다
  const none = plain(ctx.withLocalDays(LECT, { kind: "name", items: [], synonyms: [] }, "축성일", "yongin"));
  assert.deepStrictEqual([none.items, none.localNotice], [[], null]);
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

test("searchLectionaryNames: 낱말마다 나눠 찾을 때도 비슷한 말을 바꿔 본다", () => {
  const r = plain(ctx.searchLectionaryNames(LECT, "주일 그리스도왕"));
  assert.deepEqual(r.items.map((it) => [it.obs.name, it.tier]), [["왕이신 그리스도 주일", 3]]);
  assert.deepEqual(r.synonyms, [{ from: "그리스도왕", to: "왕이신 그리스도" }]);
});

test("searchLectionaryNames: 비슷한 말로 바꿔도 찾은 것이 없으면 바꾼 말을 알리지 않는다", () => {
  // 검색어 전체로도, 낱말마다 나눠서도 바꿔 보지만 `수요일`이 든 이름에는 `왕이신 그리스도`가 없다.
  assert.deepStrictEqual(plain(ctx.searchLectionaryNames(LECT, "그리스도왕 수요일")), { kind: "name", items: [], synonyms: [] });
});

test("searchLectionaryNames: 겹친 낱말은 한 번 쓴 것과 같다", () => {
  assert.deepStrictEqual(names("7주 7주 연중 7주"), names("7주 연중"));
  assert.deepStrictEqual(names(Array(500).fill("주").join(" ")), names("주 주"));
});

test("searchLectionaryNames: 빈 검색어와 없는 이름은 결과가 없다", () => {
  assert.deepEqual(names("  "), []);
  assert.deepEqual(names("없는 이름"), []);
});

// 구절 검색은 `tryVerseRef`가 돌려주는 모양을 직접 만들어 넘긴다.
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

test("searchLectionaryPassage: 거꾸로 쓴 구간과 0절은 구절 바로가기 카드와 같게 읽는다", () => {
  const hit = (...parts) => passage(ref("john", ...parts)).map((it) => [it.obs.name, it.hits[0].full, it.hits[0].overlap]);
  assert.deepStrictEqual(hit([3, "21-14"]), hit([3, "14-21"]));
  assert.deepStrictEqual(hit([3, "21-14"]), [["연중7주일", true, 8]]);
  assert.deepStrictEqual(hit([3, "0"]), hit([3, "1-999"]), "0절만 있으면 장 전체");
  assert.deepStrictEqual(hit([3, "0,16"]), [["연중7주일", true, 1]], "0절은 뺀다");
});

test("searchLectionaryPassage: 모두 담은 독서가 먼저이고, 겹친 절의 수가 전례년 순서보다 앞선다", () => {
  // 전례년 순서로는 가, 나, 다이지만 다가 검색어의 절을 모두 담았고 나가 가보다 많이 겹친다.
  const index = ctx.buildLectionarySearchIndex({
    obs: [obs("a", "가", 0), obs("b", "나", 1), obs("c", "다", 2)],
    sets: [[0, "a-s1", null, null, 1, "가"], [1, "b-s1", null, null, 1, "나"], [2, "c-s1", null, null, 1, "다"]],
    books: ["isa"],
    cov: [[0, 0, 9, 1, 2, 0], [1, 0, 9, 1, 4, 0], [2, 0, 9, 1, 7, 0]],
    saints: [],
    synonyms: {},
  });
  const items = plain(ctx.searchLectionaryPassage(index, ref("isa", [9, "1-6"])).items);
  assert.deepStrictEqual(items.map((it) => [it.obs.name, it.hits[0].full, it.hits[0].overlap]),
    [["다", true, 6], ["나", false, 4], ["가", false, 2]]);
});

test("searchLectionaryPassage: 색인에 없는 책과 읽지 않는 장은 결과가 없다", () => {
  assert.deepEqual(passage(ref("genesis", [1, "1"])), []);
  assert.deepEqual(passage(ref("isa", [3, "1"])), []);
  assert.deepEqual(passage(ref("isa", [2, "6-9"])), []);
});

// ── 메시지 처리: 워커 파일 전체를 가짜 `fetch`와 시계로 실행한다 ──

const WORKER_FILES = {
  meta: { aliases: { "이사": "isa", "이사야": "isa" }, books: { isa: { ko: "이사야" } } },
  nt: { books: ["isa"], b: [[0, 2]], c: [2, 2], v: [1, 4], t: ["마지막 날에", "칼을 쳐서 보습을 만들고"] },
  lect: LECT_RAW,
};

/** 테스트가 정한 때에 끝나는 응답. */
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const OT_CHUNK = { books: ["isa"], b: [[0, 1]], c: [9], v: [1], t: ["어둠 속을 헤매는 백성이"] };

/**
 * The response for a body: a promise answers when the test settles it (with a body or "fail"), "fail" is a 500, and
 * "hang" never answers until the worker's signal aborts the request.
 * @param {object | Promise<object | "fail"> | "fail" | "hang"} body
 * @param {AbortSignal} [signal]
 */
function respond(body, signal) {
  if (body === "hang") {
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  }
  if (body && typeof body.then === "function") return body.then((b) => respond(b, signal));
  if (body === "fail" || !body) return Promise.resolve({ ok: false, status: 500 });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/**
 * Runs the whole worker file with a fake `fetch`, clock and timers — no real timer is left behind.
 * @param {{ [url: string]: object | Promise<object | "fail"> | "fail" | "hang" | (() => any) }} files  a function
 *   gives the body for each request in turn
 * @param {{ now: number }} [clock]  performance.now; `advance(ms)` moves it and runs the timers that are due
 */
function startWorker(files, clock = { now: 0 }) {
  const posted = [];
  const fetched = [];
  const warned = [];
  const timers = [];
  const ctx = {
    onmessage: null,
    console: { ...console, warn: (...args) => warned.push(args.map(String).join(" ")) },
    postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))),
    AbortController,
    performance: { now: () => clock.now },
    setTimeout: (fn, ms) => timers.push({ fn, at: clock.now + ms }),
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    fetch: (url, init = {}) => {
      fetched.push(url);
      const body = typeof files[url] === "function" ? files[url]() : files[url];
      return respond(body, init.signal);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(WORKER_SOURCE, ctx, { filename: "search-worker.js" });
  const send = (data) => ctx.onmessage({ data });
  const of = (type) => () => posted.filter((m) => m.type === type);
  const advance = (ms) => {
    clock.now += ms;
    for (const t of timers) {
      if (t.fn && t.at <= clock.now) {
        const fn = t.fn;
        t.fn = null;
        fn();
      }
    }
  };
  return { posted, fetched, warned, send, advance, results: of("results"), lects: of("lectionary"), partials: of("partial-results") };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const INIT = { type: "init", metaUrl: "meta", chunks: [{ name: "nt", url: "nt" }], lectionaryUrl: "lect" };
let searchNo = 0;
const search = (q, scopeBooks = []) => ({ type: "search", q, page: 1, pageSize: 10, searchId: ++searchNo, scopeBooks });
const lectNames = (m) => m.lectionary.items.map((it) => it.obs.name);

test("메시지: 색인을 받아 두었으면 구절과 이름으로 찾은 전례일을 결과에 바로 넣는다", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  assert.deepEqual(w.fetched.slice().sort(), ["lect", "meta", "nt"]);

  await w.send(search("이사 2:4"));
  const [byRef] = w.results();
  assert.equal(byRef.refMatch.bookId, "isa");
  assert.equal(byRef.bookOnly, null);
  assert.equal(byRef.lectionaryPending, false);
  assert.equal(byRef.lectionary.kind, "passage");
  assert.deepEqual(lectNames(byRef), ["대림1주일"]);

  await w.send(search("고난주일"));
  const byName = w.results()[1];
  assert.equal(byName.total, 0, "성서 본문에는 없다");
  assert.equal(byName.bookOnly, null);
  assert.deepEqual(byName.lectionary.items.map((it) => [it.obs.name, it.matched]), [["성지주일", "고난주일"]]);

  await w.send(search("이사야"));
  const byBook = w.results()[2];
  assert.deepEqual(byBook.bookOnly, { bookId: "isa", bookNameKo: "이사야" });
  assert.deepEqual(byBook.lectionary.items, []);
  assert.deepEqual(w.lects(), [], "따로 보낼 것이 없다");
});

test("메시지: 이름에 연도를 붙이면 연도를 뗀 이름으로 찾고 해를 넘긴다. 앱이 보낸 성탄 평일 이름은 쓰지 않는다(ADR-044 §4)", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  await w.send({ type: "lect-names", names: [["advent-1-mon-t1-s1", "성탄 1주 화요일"]] });
  await w.send(search("2027년 고난주일"));
  const [byYear] = w.results();
  assert.deepStrictEqual(plain(byYear.lectionary.years), { from: 2027, to: 2027, capped: false, over: false, last: 2050 });
  assert.deepStrictEqual(byYear.lectionary.items.map((it) => [it.obs.name, it.matched]), [["성지주일", "고난주일"]]);
  assert.equal(byYear.keyword, "2027년 고난주일", "성서 본문은 친 그대로 찾는다");
  // 오늘부터 한 해의 이름(lect-names)은 다른 해에는 맞지 않는다
  await w.send(search("2027 성탄 1주 화요일"));
  assert.deepStrictEqual(w.results()[1].lectionary.items, []);
  await w.send(search("고난주일"));
  assert.equal(w.results()[2].lectionary.years, undefined, "연도가 없으면 해를 넘기지 않는다");
  assert.equal(w.posted.filter((m) => m.type === "error").length, 0);
});

test("메시지: 본당 표를 색인과 함께 받고, 검색의 소속교회로 지역 축일과 안내를 찾는다(ADR-044 §3)", async () => {
  const w = startWorker({ ...WORKER_FILES, local: LOCAL_RAW });
  await w.send({ ...INIT, localUrl: "local" });
  await flush();
  assert.ok(w.fetched.includes("local"));
  await w.send({ ...search("용인"), parish: "yongin" });
  assert.deepStrictEqual(w.results()[0].lectionary.items.map((it) => [it.obs.name, it.local.level]), [["용인성당 축성일", "dedication"]]);
  await w.send({ ...search("2027 용인"), parish: "yongin" });
  assert.deepStrictEqual(w.results()[1].lectionary.items.map((it) => it.obs.key), ["local:dedication"], "연도를 붙여도 찾는다");
  await w.send(search("용인성당"));
  const notice = w.results()[2];
  assert.deepStrictEqual(notice.lectionary.items, []);
  assert.deepStrictEqual(notice.lectionary.localNotice, { kind: "consecration", name: "용인성당", date: "01.31", churchId: "yongin", mine: null });
  assert.equal(w.posted.filter((m) => m.type === "error").length, 0);
});

test("메시지: 본당 표를 받지 못해도 전례독서 색인은 쓴다. 지역 축일만 없다", async () => {
  const w = startWorker({ ...WORKER_FILES, local: "fail" });
  await w.send({ ...INIT, localUrl: "local" });
  await flush();
  await w.send({ ...search("고난주일"), parish: "yongin" });
  assert.deepStrictEqual(w.results()[0].lectionary.items.map((it) => it.obs.name), ["성지주일"]);
  await w.send(search("용인성당"));
  assert.strictEqual(w.results()[1].lectionary.localNotice, null);
});

test("메시지: `lect-names`로 받은 이름은 다음 검색부터 찾는다(ADR-044 §3)", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  await w.send(search("성탄 1주 화요일"));
  assert.deepEqual(w.results()[0].lectionary.items, [], "받기 전");
  await w.send({ type: "lect-names", names: [["advent-1-mon-t1-s1", "성탄 1주 화요일"]] });
  await w.send(search("성탄 1주 화요일"));
  assert.deepEqual(w.results()[1].lectionary.items.map((it) => [it.obs.name, it.matched]), [["대림1주 월요일", "성탄 1주 화요일"]]);
  // 새로 받으면 바꾼다
  await w.send({ type: "lect-names", names: [] });
  await w.send(search("성탄 1주 화요일"));
  assert.deepEqual(w.results()[2].lectionary.items, []);
  assert.equal(w.posted.filter((m) => m.type === "error").length, 0);
});

test("메시지: 색인 주소가 없으면 받지 않고 전례독서는 `null`이다(지금의 앱)", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send({ ...INIT, lectionaryUrl: undefined });
  await flush();
  await w.send(search("이사 2:4"));
  await w.send(search("보습"));
  await flush();
  assert.deepEqual(w.fetched.slice().sort(), ["meta", "nt"]);
  const [byRef, byWord] = w.results();
  assert.deepStrictEqual([byRef.lectionary, byRef.lectionaryPending], [null, false]);
  assert.deepStrictEqual([byWord.lectionary, byWord.lectionaryPending], [null, false]);
  assert.equal(byWord.total, 1);
  assert.deepEqual(w.lects(), []);
});

test("메시지: 색인을 받는 중이면 성서 결과를 기다리게 하지 않고, 색인이 오면 전례독서를 따로 보낸다", async () => {
  const lect = deferred();
  const w = startWorker({ ...WORKER_FILES, lect: lect.promise });
  await w.send(INIT);
  await flush();

  await w.send(search("이사 2:4"));
  const [byRef] = w.results();
  assert.equal(byRef.refMatch.bookId, "isa", "구절 바로가기는 바로 나간다");
  assert.deepStrictEqual([byRef.lectionary, byRef.lectionaryPending], [null, true]);

  lect.resolve(LECT_RAW);
  await flush();
  const [late] = w.lects();
  assert.equal(late.searchId, byRef.searchId);
  assert.equal(late.q, "이사 2:4");
  assert.deepEqual(lectNames(late), ["대림1주일"]);
  assert.equal(w.fetched.filter((u) => u === "lect").length, 1, "받는 중인 요청 하나를 같이 기다린다");
});

test("메시지: 색인이 오기 전에 새 검색이 시작되면 옛 검색의 전례독서는 보내지 않는다", async () => {
  const lect = deferred();
  const w = startWorker({ ...WORKER_FILES, lect: lect.promise });
  await w.send(INIT);
  await flush();
  await w.send(search("이사 2:4"));
  await w.send(search("고난주일"));
  const [, byName] = w.results();
  assert.equal(byName.lectionaryPending, true);

  lect.resolve(LECT_RAW);
  await flush();
  assert.deepEqual(w.lects().map((m) => [m.searchId, lectNames(m)]), [[byName.searchId, ["성지주일"]]]);
});

test("메시지: 색인을 받지 못하면 남기고 전례독서는 비우며, 정한 시간이 지나기 전에는 다시 받지 않는다", async () => {
  const clock = { now: 1000 };
  const w = startWorker({ ...WORKER_FILES, lect: "fail" }, clock);
  await w.send(INIT);
  await flush();
  assert.equal(w.warned.length, 1, "실패를 콘솔에 남긴다");

  await w.send(search("보습"));
  await flush();
  const [first] = w.results();
  assert.deepStrictEqual([first.lectionary, first.lectionaryPending, first.total], [null, false, 1]);
  assert.equal(w.fetched.filter((u) => u === "lect").length, 1, "검색마다 다시 받지 않는다");

  clock.now += 60000;
  await w.send(search("보습"));
  await flush();
  const second = w.results()[1];
  assert.equal(second.lectionaryPending, true, "시간이 지나면 다시 받아 본다");
  assert.equal(w.fetched.filter((u) => u === "lect").length, 2);
  assert.deepStrictEqual(w.lects().map((m) => [m.searchId, m.lectionary]), [[second.searchId, null]], "또 실패하면 비운 전례독서를 보낸다");
});

test("메시지: 색인 요청이 멈추면 정한 시간 뒤에 받지 못한 것으로 보고, 다시 받기까지 기다린다", async () => {
  const w = startWorker({ ...WORKER_FILES, lect: "hang" });
  await w.send(INIT);
  await flush();
  await w.send(search("보습"));
  await flush();
  assert.equal(w.results()[0].lectionaryPending, true);

  w.advance(29999);
  await flush();
  assert.deepStrictEqual(w.lects(), [], "정한 시간이 되기 전에는 기다린다");
  w.advance(1);
  await flush();
  assert.deepStrictEqual(w.lects().map((m) => m.lectionary), [null], "시간이 되면 비운 전례독서를 보낸다");
  assert.equal(w.warned.length, 1, "받지 못한 것을 콘솔에 남긴다");

  await w.send(search("보습"));
  assert.equal(w.results()[1].lectionaryPending, false, "곧바로 다시 받지 않는다");
  w.advance(60000);
  await w.send(search("보습"));
  assert.equal(w.results()[2].lectionaryPending, true, "다시 받을 시간이 지나면 받는다");
  assert.equal(w.fetched.filter((u) => u === "lect").length, 2);
});

test("메시지: 색인으로 찾다가 오류가 나도 성서 결과와 구절 바로가기는 보내고 전례독서만 비운다", async () => {
  // 옛 워커 파일이 새 형식의 색인을 읽는 경우: 없는 전례일(99)을 가리키는 성인과 독서 세트.
  const broken = { ...LECT_RAW, saints: [{ name: "보습", title: "보습의 성인", obs: [99] }], cov: [...LECT_RAW.cov, [99, 0, 2, 1, 5, 0]] };
  const w = startWorker({ ...WORKER_FILES, lect: broken });
  await w.send(INIT);
  await flush();
  await w.send(search("이사 2:4"));
  await w.send(search("보습"));
  await flush();
  assert.deepStrictEqual(w.posted.filter((m) => m.type === "error"), []);
  const [byRef, byWord] = w.results();
  assert.equal(byRef.refMatch.bookId, "isa");
  assert.equal(byWord.total, 1, "성서 결과는 그대로다");
  assert.deepStrictEqual([byRef.lectionary, byWord.lectionary], [null, null]);
  assert.equal(w.warned.length, 2, "오류를 콘솔에 남긴다");

  const lect = deferred();
  const later = startWorker({ ...WORKER_FILES, lect: lect.promise });
  await later.send(INIT);
  await flush();
  await later.send(search("이사 2:4"));
  lect.resolve(broken);
  await flush();
  assert.deepStrictEqual(later.lects().map((m) => m.lectionary), [null], "받는 중이었으면 비운 전례독서를 따로 보낸다");
});

test("메시지: 일찍 끝나는 결과에도 책 이름과 전례독서 칸이 있다", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  for (const q of ["", "사랑 in:없는책", "in:이사"]) await w.send(search(q));
  assert.deepStrictEqual(w.results().map((m) => [m.bookOnly, m.lectionary, m.lectionaryPending]),
    [[null, null, false], [null, null, false], [null, null, false]]);
});

test("메시지: 책을 골라 두었으면 전례일은 찾지 않고, 책 이름만 친 검색어는 알아본다(ADR-044 §1, §2)", async () => {
  const w = startWorker(WORKER_FILES);
  await w.send(INIT);
  await flush();
  await w.send(search("고난주일", ["isa"]));
  await w.send(search("이사야", ["isa"]));
  await w.send(search("고난주일 in:이사"));
  await w.send(search("이사 2:4", ["isa"]));
  await flush();
  const got = w.results().map((m) => [m.bookOnly && m.bookOnly.bookId, m.lectionary, m.lectionaryPending]);
  assert.deepStrictEqual(got, [[null, null, false], ["isa", null, false], [null, null, false], [null, null, false]]);
});

test("메시지: 성서 청크를 받는 중에도 중간 결과에 책 이름과 받아 둔 색인의 전례일을 넣는다", async () => {
  const ot = deferred();
  const w = startWorker({ ...WORKER_FILES, ot: ot.promise });
  await w.send({ ...INIT, chunks: [{ name: "nt", url: "nt" }, { name: "ot", url: "ot" }] });
  await flush();
  w.send(search("고난주일"));
  await flush();
  w.send(search("이사야", ["isa"]));
  await flush();
  const [byName, scoped] = w.partials();
  assert.deepStrictEqual([byName.bookOnly, byName.lectionary.items.map((it) => it.obs.name)], [null, ["성지주일"]]);
  assert.deepStrictEqual([scoped.bookOnly, scoped.lectionary], [{ bookId: "isa", bookNameKo: "이사야" }, null]);

  ot.resolve(OT_CHUNK);
  await flush();
  const [last] = w.results();
  assert.equal(last.searchId, scoped.searchId, "앞의 검색은 새 검색에 밀려 마지막 결과를 보내지 않는다");
  assert.deepStrictEqual([last.bookOnly, last.lectionary, last.lectionaryPending], [{ bookId: "isa", bookNameKo: "이사야" }, null, false]);
});

test("메시지: init을 다시 받아 색인 주소가 바뀌면 옛 색인을 버린다", async () => {
  const w = startWorker({ ...WORKER_FILES, lect2: { ...LECT_RAW, synonyms: {} } });
  await w.send(INIT);
  await flush();
  await w.send({ ...INIT, lectionaryUrl: undefined });
  await flush();
  await w.send(search("고난주일"));
  await flush();
  assert.deepStrictEqual([w.results()[0].lectionary, w.results()[0].lectionaryPending], [null, false], "주소가 없어지면 받아 둔 색인도 쓰지 않는다");

  await w.send({ ...INIT, lectionaryUrl: "lect2" });
  await flush();
  assert.equal(w.fetched.filter((u) => u === "lect2").length, 1);
  await w.send(search("주님 부활 대축일"));
  assert.deepEqual(w.results()[1].lectionary.synonyms, [], "새 색인(비슷한 말 표가 빈 것)으로 찾는다");
});

// 비슷한 말 표가 빈 색인: `주님 부활 대축일`로는 아무것도 찾지 못한다(LECT_RAW로는 `부활대축일`을 찾는다).
const LECT_NO_SYNONYMS = { ...LECT_RAW, synonyms: {} };

test("메시지: 색인을 받는 중에 init이 주소를 바꾸면, 기다리던 검색은 새 주소의 색인으로 찾아 보낸다", async () => {
  const old = deferred();
  const w = startWorker({ ...WORKER_FILES, lect: old.promise, lect2: LECT_NO_SYNONYMS });
  await w.send(INIT);
  await flush();
  await w.send(search("주님 부활 대축일"));
  assert.equal(w.results()[0].lectionaryPending, true);

  await w.send({ ...INIT, lectionaryUrl: "lect2" });
  await flush();
  old.resolve(LECT_RAW);
  await flush();
  assert.deepStrictEqual(w.lects().map((m) => lectNames(m)), [[]], "옛 색인의 결과도 빈 결과도 아니라 새 색인의 결과 하나");
});

test("메시지: 옛 주소의 요청이 늦게 실패해도 지금 받는 요청을 지우지 않는다", async () => {
  const first = deferred();
  const second = deferred();
  const answers = [first.promise, second.promise];
  const w = startWorker({ ...WORKER_FILES, lect: () => answers.shift() });
  await w.send(INIT);
  await w.send({ ...INIT, lectionaryUrl: undefined });
  await w.send(INIT);
  await flush();
  first.resolve("fail");
  await flush();
  await w.send(search("고난주일"));
  assert.equal(w.results()[0].lectionaryPending, true, "다시 받기를 미루지 않고 지금 요청을 기다린다");

  second.resolve(LECT_RAW);
  await flush();
  assert.deepStrictEqual(w.lects().map((m) => lectNames(m)), [["성지주일"]]);
  assert.equal(w.fetched.filter((u) => u === "lect").length, 2);
});

test("메시지: 검색 도중 init이 색인을 바꾸면 마지막 결과는 새 색인으로 다시 찾는다", async () => {
  const ot = deferred();
  const w = startWorker({ ...WORKER_FILES, ot: ot.promise, lect2: LECT_NO_SYNONYMS });
  const init = { ...INIT, chunks: [{ name: "nt", url: "nt" }, { name: "ot", url: "ot" }] };
  await w.send(init);
  await flush();
  w.send(search("주님 부활 대축일"));
  await flush();
  assert.deepStrictEqual(lectNames(w.partials()[0]), ["부활대축일"], "중간 결과는 받아 둔 색인으로 찾는다");

  await w.send({ ...init, lectionaryUrl: "lect2" });
  await flush();
  ot.resolve(OT_CHUNK);
  await flush();
  assert.deepStrictEqual(lectNames(w.results()[0]), [], "마지막 결과는 새 색인으로 찾는다");
});
