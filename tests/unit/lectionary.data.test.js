// ── lectionary 뷰 모델 ↔ 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ───────────
// Run with: node --test tests/unit/lectionary.data.test.js
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다**(설계서 §7 — 서브모듈이 없다).
// liturgical-engine.data.test.js 와 같은 자리 — engine-data.yml · sync-data.yml 양쪽에 등록돼
// 돈다. 합성 표로 잡을 수 있는 것은 lectionary.test.js 에 둔다. 여기서는 실제 표 위에서
// 엔진이 낸 `ResolvedDate` · 독서 · 본기도를 뷰 모델(`buildLectionaryModel`)에 넣어 ADR-038 §3
// 의 규칙이 실제 날짜에서 성립하는지, 그리고 뷰 상수가 데이터의 `_meta` · `_vocab` 과
// 어긋나지 않는지 본다.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LECTIONARY_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/lectionary.js"), "utf8");
const ENGINE_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/liturgical-engine.js"), "utf8");
const VERSE_SPEC_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/verse-spec.js"), "utf8");

function extractBlock(name, source) {
  const begin = `// ── BEGIN ${name} ──`;
  const end = `// ── END ${name} ──`;
  const startIdx = source.indexOf(begin);
  const endIdx = source.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`marker block ${name} not found`);
  return source.slice(startIdx, endIdx + end.length);
}

const ctx = {
  Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
  parseInt, isNaN, Date, NaN, URLSearchParams,
};
vm.createContext(ctx);
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();",
  ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js" });
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js#lookup" });
vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
vm.runInContext(extractBlock("LECTIONARY_MODEL", LECTIONARY_SOURCE), ctx, { filename: "lectionary.js" });

const LECTIONARY = path.join(ROOT, "data", "lectionary");
// 체크아웃 여부만 본다(liturgical-engine.data.test.js 와 같은 이유).
const haveData = fs.existsSync(LECTIONARY);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";
const read = (p) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, p), "utf8"));
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// vm 이 만든 배열 · 객체는 realm 이 달라 deepStrictEqual 이 프로토타입에서 틀린다 — 양쪽을 정규화한다.
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
// `const` 상수는 스크립트 스코프라 ctx 프로퍼티가 아니다 — 이름으로 평가해 꺼낸다.
const K = (name) => vm.runInContext(name, ctx);

let built = null;
function ix() {
  if (built) return built;
  const cal = ctx.buildCalendarIndex({
    sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"),
    ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json"),
  });
  const lec = ctx.buildLectionaryIndex({
    readings: read("eucharist-readings.json"), collects: read("eucharist-collects.json"),
    commons: read("commons.json"), canticles: read("canticles.json"),
  });
  return (built = { cal, lec });
}
const resolve = (d) => ctx.resolveDateIn(ix().cal, d, ctx.transfersOf(ix().cal, Number(d.slice(0, 4))));
const NONE = { obs: null, track: null, set: null, collect: null };
/** 실제 표 위의 뷰 모델 — 공개 래퍼가 하는 것과 같은 조합. */
function model(d, query = NONE, stored = null) {
  const r = resolve(d);
  assert.ok(r, `${d} 를 풀 수 없다`);
  const cache = new Map();
  const groupsOf = (c) => {
    if (!cache.has(c.observance.id)) cache.set(c.observance.id, ctx.findReadingsIn(ix().lec, ix().cal, r, c));
    return cache.get(c.observance.id);
  };
  const m = ctx.buildLectionaryModel(r, { ...NONE, ...query }, groupsOf, ctx.findCollectsIn(ix().lec, ix().cal, r), stored);
  assert.ok(m, `${d} 모델이 null`);
  return m;
}
const id = (c) => c.observance.id;

// ── 상수 ↔ 데이터 ──

test("A3 송영 상수 셋이 eucharist-collects.json _meta.endings 와 글자까지 같다", { skip: SKIP }, () => {
  const endings = read("eucharist-collects.json")._meta.endings;
  same(plain(K("ENDINGS")), endings);
});

test("A3 주기 · 색 라벨이 데이터 _vocab 과 같다(ADR-036 §4 단일 출처)", { skip: SKIP }, () => {
  const vocab = read("eucharist-collects.json")._vocab;
  same(plain(K("CYCLE_LABEL")), vocab.year);
  const colorLabel = K("COLOR_LABEL");
  for (const [k, v] of Object.entries(vocab.color)) assert.strictEqual(colorLabel[k], v, `color ${k}`);
  // 선택 대체색 둘(장미색 · 청색)은 본기도 표의 _vocab 에 없을 수 있어 독서 표 쪽도 본다.
  const vocab2 = read("eucharist-readings.json")._vocab;
  for (const [k, v] of Object.entries(vocab2.color || {})) assert.strictEqual(colorLabel[k], v, `readings color ${k}`);
});

// ── 실제 날짜 — ADR-038 §3 규칙 ──

test("A3 2026-04-05 부활대축일 — 본기도 대체안 셋이 세그먼트, 세트 둘(원본 세트 표지는 숨김), 슬롯 넷, 기념일은 흐린 칩", { skip: SKIP }, () => {
  const m = model("2026-04-05");
  assert.strictEqual(id(m.selected), "t-부활대축일");
  assert.strictEqual(m.collects.length, 3);   // 부활대축일의 자유선택 대체안 셋 — 고른 전례일의 것만
  assert.strictEqual(m.collectIndex, 0);
  same(m.options.map((o) => [o.label, o.short]), [["독서 1", null], ["독서 2", null]]);   // 원본 세트 둘 = 「또는」 대안
  same(m.slots.map((s) => s.slot), ["first", "psalm", "second", "gospel"]);
  same(m.chips.map((c) => [c.label, c.muted]),
    [["부활대축일", false], ["마틴 루터 킹 · 기념일", true], ["부활 1주일 (가해)", false]]);
  same(plain(m.colors), ["white"]);
  assert.strictEqual(m.pair, null);
  const third = model("2026-04-05", { collect: 3 });
  assert.strictEqual(third.collectIndex, 2);
});

test("A3 2026-09-16 니니안 ∧ 추계재 — 초기 독서는 격자(미결25), 색 [자, 백], 추계재를 고르면 [자]와 세트 둘", { skip: SKIP }, () => {
  const m = model("2026-09-16");
  assert.strictEqual(id(m.resolved.official), "d0916-니니안");
  assert.strictEqual(id(m.selected), "grid:ordinary-24-weekday-wed");
  same(plain(m.colors), ["violet", "white"]);
  assert.strictEqual(m.group.common, null);
  assert.strictEqual(m.collects.length, 1);   // 격자(연중 24주간) 본기도만 — 니니안 공통은 그 칩에서
  const ember = model("2026-09-16", { obs: "t-추계재" });
  same(plain(ember.colors), ["violet"]);
  assert.strictEqual(ember.ownColor, true);
  same(ember.options.map((o) => o.label), ["독서 1", "독서 2"]);
  assert.strictEqual(ember.fast, "minor");
  const saint = model("2026-09-16", { obs: "d0916-니니안" });
  assert.strictEqual(saint.group.common, "missionary");
  assert.strictEqual(saint.group.title, "선교사");   // 캡션 라벨 = commons.classes[분류].label
  same(plain(saint.colors), ["violet", "white"]);   // 지정 전례일을 고르면 그날 색 그대로
});

test("A3 2026-08-06 주의 변모(목) — 당일 카드 둘, 격자 카드는 「오는 주일(8월 9일)」", { skip: SKIP }, () => {
  const m = model("2026-08-06");
  assert.ok(m.pair);
  assert.strictEqual(m.pair.kind, "optional-origin");
  assert.strictEqual(id(m.pair.a), "d0806-주의-변모");
  assert.strictEqual(id(m.pair.b), "grid:ordinary-18-weekday-thu");
  assert.strictEqual(m.pair.bText.note, "오는 주일(8월 9일)로 옮겨 지키는 경우 — 이날은 평일 독서");
  assert.strictEqual(m.pair.aText.official, true);
  assert.strictEqual(model("2024-08-06").pair.bText.note, "지난 주일(8월 4일)로 옮겨 지키는 경우 — 이날은 평일 독서");
  assert.strictEqual(model("2025-08-06").pair.bText.note, "지난 주일(8월 3일)로 옮겨 지키는 경우 — 이날은 평일 독서");
});

test("A3 2026-08-09 연중 19주일 — 목적지 카드 둘(주일 · 변모 optional), 트랙 토글, 평화통일주일은 본문 없는 칩", { skip: SKIP }, () => {
  const m = model("2026-08-09");
  assert.ok(m.pair);
  assert.strictEqual(m.pair.kind, "optional-dest");
  assert.strictEqual(id(m.pair.a), "grid:ordinary-19-sunday");
  assert.strictEqual(id(m.pair.b), "d0806-주의-변모");
  assert.strictEqual(m.pair.bText.note, "8월 6일에서 옮겨 지키는 경우");
  same(plain(m.tracks), [1, 2]);
  assert.strictEqual(m.track, 1);
  assert.strictEqual(m.chips.find((c) => id(c.candidate) === "grid:ordinary-19-sunday").label, "연중 19주일 (가해, 독서 1)");
  const peace = model("2026-08-09", { obs: "t-평화통일주일" });
  assert.strictEqual(peace.empty, true);
  const moved = model("2026-08-09", { obs: "d0806-주의-변모" });
  assert.strictEqual(moved.empty, false);
  assert.strictEqual(moved.slots.length, 4);
  same(plain(moved.colors), ["white"]);   // 변모를 고르면 그 축일의 백
});

test("A3 5.1 · 사계재 금요일 — 독서 세트와 본기도가 같은 제목으로 짝지어져 단추 하나(?set=)로 함께 바뀌고, 고른 전례일의 것이 먼저다(사용자 결정 2026-10-13)", { skip: SKIP }, () => {
  const m = model("2026-05-01");
  assert.strictEqual(m.collectsLinked, true);
  same(m.options.map((o) => o.label), ["사도 성 필립보와 성 야고보", "노동자의 날"]);
  assert.strictEqual(m.collects[m.collectIndex].title, "사도 성 필립보와 성 야고보");
  same(plain(m.hrefs.options), ["/lectionary/2026-05-01", "/lectionary/2026-05-01?set=2"]);
  const labour = model("2026-05-01", { set: 2 });
  assert.strictEqual(labour.group.title, "노동자의 날");
  assert.strictEqual(labour.collects[labour.collectIndex].title, "노동자의 날");
  const crossed = model("2026-05-01", { collect: 2 });   // 교차 조합은 없다 — ?collect= 는 읽지 않는다
  assert.strictEqual(crossed.collects[crossed.collectIndex].title, "사도 성 필립보와 성 야고보");
  const ember = model("2026-09-18", { obs: "t-추계재" });
  assert.strictEqual(ember.collectsLinked, true);
  same(ember.options.map((o) => o.label), ["성직후보자", "수도자"]);
  const second = model("2026-09-18", { obs: "t-추계재", set: 2 });
  assert.strictEqual(second.collects[second.collectIndex].id, 237);
});

test("A3 데이터 전수 — 독서 세트가 제목으로 갈리는 날은 본기도도 같은 제목으로 짝지어진다(5.1 · 사계재 금요일 넷뿐 — 사용자 결정 2026-10-13의 지킴이)", { skip: SKIP }, () => {
  const bad = [];
  const seen = new Set();
  for (const y of [2025, 2026, 2027]) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      for (const chip of model(d).chips) {
        const m = model(d, { obs: chip.candidate.observance.id });
        if (new Set(m.options.map((o) => o.group.title)).size > 1 && !m.collectsLinked) bad.push(`${d} ${id(chip.candidate)}`);
        if (m.collectsLinked) seen.add(id(chip.candidate));
      }
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
  same([...seen].sort(), ["d0501-사도-성-필립보와-성-야고보", "t-동계재", "t-추계재", "t-춘계재", "t-하계재"].sort());
});

test("A3 두 독서 카드 — 본문 없는 격자로는 내지 않고(12.28 · 1.6), 명절이 주일이면 「이날의 주일 독서」(자체 리뷰 2026-10-13)", { skip: SKIP }, () => {
  assert.strictEqual(model("2026-12-28").pair, null);
  assert.strictEqual(model("2026-01-06").pair, null);
  assert.strictEqual(model("2026-12-07").pair.kind, "arrival");   // 본문이 있는 도착일은 그대로
  assert.strictEqual(model("2027-02-07").pair.bText.note, "이날의 주일 독서");
});

test("A3 절 발췌 — 옮겨 실린 절(이사 40 의 41:6-7)과 다니 3 의 이중 번호를 번호만으로 고르지 않는다(자체 리뷰 2026-10-13)", { skip: SKIP }, () => {
  const bible = (b, c) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `${b}-${c}.json`), "utf8"));
  const keysOf = (b, c, spec) => plain(ctx.selectVerses(bible(b, c), spec).keys);
  const isa = keysOf("isa", 40, "1-11");
  assert.ok(!isa.some((k) => k.includes("_c41")), `이사 40:1-11 에 41:6-7 이 끼었다: ${isa}`);
  assert.strictEqual(isa.length, 11);
  same(keysOf("dan", 3, "25,34-43"), ["25_lxx", "34_lxx", "35_lxx", "36_lxx", "37_lxx", "38_lxx", "39_lxx", "40_lxx", "41_lxx", "42_lxx", "43_lxx"]);
  same(keysOf("dan", 3, "14-20,24-25,28"), ["14", "15", "16", "17", "18", "19", "20", "24_91", "25_92", "28_95"]);
});

test("A3 데이터의 다니 3 참조는 RCL(NRSV) 계열 독서표와 같은 본문을 고르고, 새 참조가 생기면 멈춘다(사용자 결정 2026-10-13 — 「RCL 과 일치하면 완결」)", { skip: SKIP }, () => {
  // RCL 은 NRSV 번호를 쓴다(CCT RCL 서문 §10) — 다니 3 은 히브리 번호, 그리스어 추가 본문은 따로 「Song of the Three」(1~68,
  // 그리스어 3:24~51 = NRSV 1~28). 잉글랜드 CW 평일 성찬 독서표가 같은 두 날을 이렇게 적는다:
  //   사순 3주 화 「다니 3:25, 34-43」 = Song of the Three 2, 11-20 — 그리스어 (25) · (34)~(43)
  //   사순 5주 수 「다니 3:14-20, 24-25, 28」 = Dan 3.14-20, 24-25, 28 — 히브리 번호(불가타 91 · 92 · 95)
  const RCL_EQUIVALENT = {
    "25,34-43": ["25_lxx", "34_lxx", "35_lxx", "36_lxx", "37_lxx", "38_lxx", "39_lxx", "40_lxx", "41_lxx", "42_lxx", "43_lxx"],
    "14-20,24-25,28": ["14", "15", "16", "17", "18", "19", "20", "24_91", "25_92", "28_95"],
  };
  const found = new Set();
  const walk = (/** @type {any} */ x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    if (x.bookId === "dan" && Array.isArray(x.refs)) for (const ref of x.refs) if (ref.chapter === 3) found.add(ref.verseSpec);
    Object.values(x).forEach(walk);
  };
  for (const f of ["eucharist-readings.json", "commons.json"]) walk(read(f));
  same([...found].sort(), Object.keys(RCL_EQUIVALENT).sort(), "새 다니 3 참조 — RCL(NRSV) 기준과 대조해 RCL_EQUIVALENT 에 더할 것");
  const dan3 = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", "dan-3.json"), "utf8"));
  for (const [spec, keys] of Object.entries(RCL_EQUIVALENT)) same(plain(ctx.selectVerses(dan3, spec).keys), keys, spec);
});

test("A3 2026-12-07 성 니콜라 도착 — 도착 카드 둘, 칩에 「12월 6일에서 옮겨 옴」, 본기도는 고른 칩(니콜라)의 것만", { skip: SKIP }, () => {
  const m = model("2026-12-07");
  assert.ok(m.pair);
  assert.strictEqual(m.pair.kind, "arrival");
  assert.strictEqual(id(m.pair.a), "d1206-성-니콜라");
  assert.strictEqual(m.pair.aText.note, "12월 6일에서 옮겨 옴");
  assert.ok(m.chips.some((c) => c.label === "성 니콜라 · 12월 6일에서 옮겨 옴" && c.active));
  assert.strictEqual(m.collects.length, 1);   // 니콜라 본기도만(기원 날짜에 색인된 것 — §5.6)
  assert.strictEqual(m.slots.length, 4);   // 기원 날짜에 색인된 독서가 도착일에서 나온다(§5.6)
});

test("A3 2025-01-29 설날 — 명절 카드 둘", { skip: SKIP }, () => {
  const m = model("2025-01-29");
  assert.ok(m.pair);
  assert.strictEqual(m.pair.kind, "festival");
  assert.strictEqual(id(m.pair.a), "lunar11-설날");
  assert.strictEqual(id(m.pair.b), "grid:ordinary-3-weekday-wed");
});

test("A3 2026-01-01 세계평화 기도일 칩 — 본문 없는 축일은 empty, 거룩한 이름 예수는 세트 둘", { skip: SKIP }, () => {
  const m = model("2026-01-01", { obs: "d0101-세계평화를-위한-기도일" });
  assert.strictEqual(m.empty, true);   // 기도서에 본기도와 독서가 없다(미결51)
  assert.strictEqual(m.chips.find((c) => c.active).label, "세계평화를 위한 기도일");
  const feast = model("2026-01-01");
  assert.strictEqual(id(feast.selected), "d0101-거룩한-이름-예수");
  assert.strictEqual(feast.options.length, 2);
});

test("A3 2026-04-04 성 토요일 — 그날의 대표 · 초기 선택은 성 토요일(홍), 부활밤은 「· 저녁」 칩으로 고르면 백(R-6.1-evening)", { skip: SKIP }, () => {
  const m = model("2026-04-04");
  assert.strictEqual(id(m.selected), "t-성-토요일");
  same(plain(m.colors), ["red"]);
  assert.strictEqual(m.ownColor, false);
  assert.strictEqual(m.resolved.color, "red");
  // 칩 셋 — 그날 낮(성 토요일 · 격자) 다음 저녁 전례(부활밤)
  same(m.chips.map((c) => c.label), ["성 토요일", "성주간 토요일 (가해)", "부활밤 · 저녁"]);
  same(m.options.map((o) => o.label), ["독서 1", "독서 2"]);   // 성 토요일 원본 세트 둘(욥기/마태 · 애가/요한)
  const vigil = model("2026-04-04", { obs: "t-부활밤" });
  same(plain(vigil.colors), ["white"]);   // 고른 본문의 색(사용자 결정 2026-10-12)
  assert.strictEqual(vigil.ownColor, true);
  same(plain(model("2026-04-04", { obs: "grid:lent-x-weekday-sat" }).colors), ["red"]);
});

test("A3 2026-12-25 · 12-24 — 12.25 는 성탄 낮(초기 · 미결12) · 새벽 칩, 성탄 밤은 12.24 의 「· 저녁」 칩(R-6.1-evening)", { skip: SKIP }, () => {
  const m = model("2026-12-25");
  assert.strictEqual(id(m.selected), "d1225-성탄-낮");
  same(m.chips.map((c) => c.label), ["성탄 낮", "성탄 새벽", "성탄 금요일 (나해)"]);
  assert.strictEqual(m.collects.length, 1);   // 성탄 낮 본기도만 — 새벽은 그 칩에서
  const eve = model("2026-12-24");
  assert.strictEqual(id(eve.selected), "grid:advent-4-weekday-thu");   // 그날의 대표 · 초기 선택은 대림 평일(자)
  same(plain(eve.colors), ["violet"]);
  same(eve.chips.map((c) => c.label), ["대림 4주 목요일 (나해)", "성탄 밤 · 저녁"]);
  const night = model("2026-12-24", { obs: "d1225-성탄-밤" });
  same(plain(night.colors), ["white"]);
  // 성탄 밤의 본문 · 본기도 — 12.24 에서 12.25 키로 좁힌다. 새벽(이사 62 · 루가 2:1-7, 8-20 · 본기도 276)과 가르는 값으로 고정한다
  // (「루가 2:1」 로 시작하는지만 보면 새벽 본문도 통과했다 — PR #349 리뷰)
  assert.strictEqual(night.group.title, "성탄 밤");
  same(night.slots.map((sl) => sl.label), ["이사 9:1-6", "시편 96", "디도 2:11-14", "루가 2:1-14, 15-20"]);
  same(night.collects.map((c) => c.id), [275]);
});

test("A3 2026-06-14 연중 11주일 — 트랙 기억이 기본, URL 이 앞서고, 괄호 선택 구절 세트는 바탕에 합쳐져 긴 본문 + 선택 구절", { skip: SKIP }, () => {
  const remembered = model("2026-06-14", NONE, 2);
  assert.strictEqual(remembered.track, 2);
  assert.strictEqual(remembered.group.reading_track, 2);
  const url = model("2026-06-14", { track: 1, set: 2 }, 2);
  assert.strictEqual(url.track, 1);
  assert.strictEqual(url.options.length, 1);   // 괄호 세트가 합쳐져 선택지 하나 — ?set=2 는 범위 밖
  assert.strictEqual(url.group.set_no, 2);      // 긴 본문
  assert.strictEqual(url.shortGroup.set_no, 1); // 짧은 바탕
  // 바탕과 다른 슬롯 하나에서만 선택 구절이 나온다.
  const diff = url.slots.filter((s) => { const t = url.shortGroup.readings.find((r) => r.slot === s.slot); return t && t.label !== s.label; });
  assert.strictEqual(diff.length, 1);
  const isOpt = ctx.optionalVerseTest(diff[0], url.shortGroup.readings.find((r) => r.slot === diff[0].slot));
  const marked = [];
  for (const ref of diff[0].refs) for (let n = 1; n <= 60; n++) if (isOpt(ref.chapter, n)) marked.push(`${ref.chapter}:${n}`);
  assert.ok(marked.length > 0 && marked.length < 60, marked.join(","));
});

test("A3 2024-03-24 성지주일 나해 — 긴 수난 · 짧은 수난 「독서 1 · 2」, 짧은 쪽에 괄호 세트(40-47)가 합쳐진다", { skip: SKIP }, () => {
  const m = model("2024-03-24");
  same(m.options.map((o) => [o.label, o.group.set_no, o.short && o.short.set_no]), [["독서 1", 1, null], ["독서 2", 3, 2]]);
  const second = model("2024-03-24", { set: 2 });
  const gospel = second.slots.find((s) => s.slot === "gospel");
  const shortGospel = second.shortGroup.readings.find((r) => r.slot === "gospel");
  const isOpt = ctx.optionalVerseTest(gospel, shortGospel);
  assert.strictEqual(isOpt(15, 39), false);
  assert.strictEqual(isOpt(15, 40), true);
  assert.strictEqual(isOpt(15, 47), true);
});

test("A3 2026-11-22 왕이신 그리스도 가해 — 표지 없는 「또는」 대안(시편 100 / 95)도 「독서 1 · 2」", { skip: SKIP }, () => {
  const m = model("2026-11-22");
  same(m.options.map((o) => o.label), ["독서 1", "독서 2"]);
  const psalms = m.options.map((o) => o.group.readings.find((r) => r.slot === "psalm").label);
  assert.notStrictEqual(psalms[0], psalms[1]);
});

test("A3 2024-12-24 성탄 1일 전 — 날짜 전용 본문, 본기도 대체안 둘, 대체 청색", { skip: SKIP }, () => {
  const m = model("2024-12-24");
  assert.strictEqual(m.group.title, "성탄 1일 전");
  assert.strictEqual(m.collects.length, 2);   // 대체안 둘(1/2 · 2/2)
  same(plain(m.colorAlt), ["blue"]);
});

test("A3 2026-03-01 사순 2주일 — 조건부 세트는 조건이 라벨 「주의 변모 주일로 지킬 때」, 바탕은 전례일 이름(미결38)", { skip: SKIP }, () => {
  const m = model("2026-03-01", { set: 2 });
  same(m.options.map((o) => o.label), ["사순 2주일", "주의 변모 주일로 지킬 때"]);   // 「…로 지키는 경우」 → 「…로 지킬 때」
  assert.strictEqual(m.group.set_no, 2);
  same(m.chips.map((c) => c.muted), [false, false, false]);   // 삼일절 · 데이빗은 주일에 밀려 「· 기념만」(사용자 결정 2026-10-24)
});

test("A3 송가 — 즈가리야 송가는 영광송을 붙이고 창조송가(gloria:false)는 붙이지 않는다(실제 cant 장 JSON)", { skip: SKIP }, () => {
  const cant = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `cant-${n}.json`), "utf8"));
  const slot = (n) => ({ slot: "psalm", bookId: "cant", refs: [{ chapter: n, verseSpec: "all" }], label: "" });
  assert.strictEqual(ctx.wantsGloria(slot(11), cant(11)), true);
  assert.strictEqual(ctx.wantsGloria(slot(12), cant(12)), true);
  assert.strictEqual(ctx.wantsGloria(slot(3), cant(3)), false);
  assert.strictEqual(ctx.canticleTitleOf(cant(11)), "즈가리야 송가");
});

// ── 전수 — 2025~2027 모든 날 ──

// 2026-10-12 처음 돌렸을 때 격자 평일 세 칸(사순 2주 화 · 수 · 부활 4주 토)에 독서 레코드가 없었다 —
// 원료 기사의 수집 태그 누락(pitfalls §18 의 재의 수요일 후 금요일과 같은 종류). data#30 이 채웠고 이 전수
// 검사가 그것을 지킨다 — 다시 빈 칸이 생기면 「독서 없음」으로 멈춘다.
// 격자(그날의 주일 · 평일) 후보의 독서 결손 — 초기 선택만 보면 공통 독서가 초기인 날(2026-06-27 키릴)의 빈 격자를 놓친다
// (자체 리뷰 2026-10-13 — 그렇게 찾은 연중 12주 토요일 짝수해는 사용자가 기사를 찾아 주어 data#31 이 채웠다). 성탄절기 평일은
// 날짜 본문(12.29~1.5)이 따로이고, 이동 축일(재의 수요일 · 성주간 · 부활 · 성령강림 · 왕이신 그리스도 …)이 있는 날은 그 temporal
// 후보가 독서를 들고 있어 격자가 비는 것이 정상이다. 알려진 결손 표는 두지 않는다 — 빈 칸이 생기면 곧바로 멈춘다.
test("A3 2025~2027 모든 날 — 모델이 서고, 초기 선택에 복음까지 있는 독서가 있고, 칩 href 가 그 칩의 상태로 돌아오며, 격자 독서가 비지 않는다", { skip: SKIP }, () => {
  const bad = [];
  for (const y of [2025, 2026, 2027]) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      const m = model(d);
      if (!m.group) bad.push(`${d} 독서 없음`);
      else if (!m.slots.some((s) => s.slot === "gospel")) bad.push(`${d} 복음 없음`);
      for (const c of m.chips) {   // 칩 href → 그 날짜 · 그 후보(초기 선택이면 obs 없음)
        const u = new URL(c.href, "http://x");
        const obsParam = u.searchParams.get("obs");
        if (u.pathname !== `/lectionary/${d}` || (obsParam ? obsParam !== c.candidate.observance.id : c.candidate !== m.initial)) bad.push(`${d} 칩 href ${c.href}`);
      }
      if (!m.chips.length) bad.push(`${d} 칩 없음`);
      const grid = m.resolved.candidates.find((c) => c.observance.id.startsWith("grid:"));
      const co = m.resolved.coord;
      if (grid && co && co.season !== "christmas") {
        const key = `${co.season}-${co.week}-${co.weekday || co.type}-${co.year}`;
        const readsOf = (/** @type {any} */ c) => ctx.findReadingsIn(ix().lec, ix().cal, m.resolved, c).length > 0;
        const temporalOwns = m.resolved.candidates.some((c) => c !== grid && c.observance.kind === "temporal" && readsOf(c));
        if (!temporalOwns && !readsOf(grid)) bad.push(`${d} 격자 독서 없음(${key})`);
      }
      if (!m.chips.some((c) => c.active)) bad.push(`${d} 활성 칩 없음`);
      if (!m.colors.length) bad.push(`${d} 색 없음`);
      if (m.empty) bad.push(`${d} empty`);   // 본기도까지 없는 날은 없다
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
});

test("A3 데이터 전수 — 괄호 선택 구절 세트는 모두 바탕에 합쳐지고, 「또는」 대안과 트랙이 한 전례일 키에 겹치지 않는다(pitfalls §21 실측의 지킴이 — 자체 리뷰 2026-10-13)", { skip: SKIP }, () => {
  const COORD = ["kind", "season", "week", "type", "weekday", "year", "date", "lunar", "name", "title"];
  /** @type {Map<string, any[]>} */
  const byCoord = new Map();
  for (const e of read("eucharist-readings.json").entries) {
    const k = JSON.stringify(COORD.map((f) => e[f] ?? null));
    if (!byCoord.has(k)) byCoord.set(k, []);
    byCoord.get(k).push(e);
  }
  const bad = [];
  let merged = 0;
  for (const [k, es] of byCoord) {
    const tracks = [...new Set(es.map((e) => e.reading_track ?? null))];
    for (const t of tracks) {
      const sets = es.filter((e) => (e.reading_track ?? null) === t).sort((a, b) => a.set_no - b.set_no);
      const opts = ctx.readingOptions(sets, "x");
      merged += opts.filter((o) => o.short).length;
      if (opts.some((o) => o.group.set_note === K("BRACKET_NOTE") && !o.short)) bad.push(`${k} 괄호 세트가 바탕을 못 찾음`);
      if (tracks.length > 1 && opts.length > 1) bad.push(`${k} 트랙 ${t} 에 「또는」 대안 ${opts.length}`);
    }
  }
  same(bad, []);
  assert.strictEqual(merged, 34);   // pitfalls §21 실측(2026-10-12) — 데이터가 바뀌면 여기서 다시 센다
});

// ── 반절 경계 표 ↔ 앱이 그리는 줄(사용자 결정 2026-10-22, 데이터 liturgical/half-verses.md) ──

test("반절 경계 표 — 전례독서 · 성인 공통의 반절 참조마다 행이 있고, 앱이 그리는 줄에서 그 절을 나눈다", { skip: SKIP }, () => {
  const table = read("half-verses.json").entries;
  const byKey = new Map(table.map((e) => [`${e.bookId}:${e.chapter}:${e.verse}${e.half}`, e]));
  /** @type {Set<string>} */
  const refs = new Set();
  const walk = (/** @type {any} */ x) => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== "object") return;
    if (typeof x.bookId === "string" && Array.isArray(x.refs)) {
      for (const ref of x.refs) for (const tok of String(ref.verseSpec).split(",")) {
        const m = /^(\d+)([ab])$/.exec(tok.trim());
        if (m) refs.add(`${x.bookId}:${ref.chapter}:${m[1]}${m[2]}`);
      }
    }
    Object.values(x).forEach(walk);
  };
  for (const f of ["eucharist-readings.json", "commons.json"]) walk(read(f));
  same([...refs].filter((k) => !byKey.has(k)), [], "표에 없는 반절 참조 — 데이터 저장소 liturgical/half-verses.md 에 더한다");
  assert.strictEqual(refs.size, table.length, "쓰이지 않는 행");
  for (const e of table) {
    const k = `${e.bookId} ${e.chapter}:${e.verse}${e.half === "a" ? "상" : "하"}`;
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "bible", `${e.bookId}-${e.chapter}.json`), "utf8"));
    const v = data.verses.find((x) => x.number === e.verse && !x.part && !x.lxx_only && x.chapter_ref == null && x.alt_ref == null && !x.versicle);
    assert.ok(v, k);
    // appendVerses 의 줄 — segments 를 줄바꿈으로 나누고 빈 줄(연 구분)은 빼며, 줄 머리의 ¶ 는 표지로 떼어 그린다
    const lines = (v.segments || [{ text: v.text || "" }]).flatMap((/** @type {any} */ s) => s.text.split("\n"))
      .filter((/** @type {string} */ l) => l !== "").map((/** @type {string} */ l) => l.replace(/^¶\s*/, ""));
    const keep = ctx.halfVerseLines(lines.length, e);
    if (e.whole) { assert.strictEqual(keep, null, k); continue; }
    assert.ok(keep, `${k} — 경계가 절을 나누지 않는다`);
    if (keep.text) assert.strictEqual(lines[keep.cut].split(keep.text).length, 2, `${k} — 「${keep.text}」가 ${keep.cut + 1}줄에 한 번 나와야 한다`);
  }
});
