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

test("A3 2026-04-05 부활대축일 — 본기도 대체안 셋이 세그먼트, 세트 둘(원본 세트 표지는 숨김), 슬롯 넷, 생략된 성인은 흐린 칩", { skip: SKIP }, () => {
  const m = model("2026-04-05");
  assert.strictEqual(id(m.selected), "t-부활대축일");
  assert.strictEqual(m.collects.length, 3);   // 부활대축일의 자유선택 대체안 셋 — 고른 관측일의 것만
  assert.strictEqual(m.collectIndex, 0);
  same(m.options.map((o) => [o.label, o.short]), [["독서 1", null], ["독서 2", null]]);   // 원본 세트 둘 = 「또는」 대안
  same(m.slots.map((s) => s.slot), ["first", "psalm", "second", "gospel"]);
  same(m.chips.map((c) => [c.label, c.muted]),
    [["부활대축일", false], ["마틴 루터 킹 · 생략", true], ["부활 1주일 (가해)", false]]);
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
  same(plain(saint.colors), ["violet", "white"]);   // 승자를 고르면 그날 색 그대로
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

test("A3 2026-12-07 성 니콜라 도착 — 도착 카드 둘, 칩에 「12월 6일에서 옮겨 옴」, 본기도는 니콜라 → 대림 2주간", { skip: SKIP }, () => {
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

test("A3 2026-01-01 세계평화 기도일 칩 — 기념일은 empty, 거룩한 이름 예수는 세트 둘", { skip: SKIP }, () => {
  const m = model("2026-01-01", { obs: "d0101-세계평화를-위한-기도일" });
  assert.strictEqual(m.empty, true);
  assert.ok(m.chips.find((c) => c.active).label.endsWith("· 기념일"));
  const feast = model("2026-01-01");
  assert.strictEqual(id(feast.selected), "d0101-거룩한-이름-예수");
  assert.strictEqual(feast.options.length, 2);
});

test("A3 2026-04-04 성 토요일 — 고른 본문의 색: 승자 부활밤 본문은 백, 성 토요일 후보는 홍, 격자는 그날 색 홍, 칩 셋", { skip: SKIP }, () => {
  const m = model("2026-04-04");
  assert.strictEqual(id(m.selected), "t-부활밤");
  same(plain(m.colors), ["white"]);
  assert.strictEqual(m.ownColor, true);
  assert.strictEqual(m.resolved.color, "red");   // 엔진의 그날 색은 그대로 홍(미결20 — 저녁 표지는 열려 있다)
  assert.strictEqual(m.chips.length, 3);
  const sat = model("2026-04-04", { obs: "t-성-토요일" });
  same(plain(sat.colors), ["red"]);
  assert.strictEqual(sat.ownColor, false);
  same(plain(model("2026-04-04", { obs: "grid:lent-x-weekday-sat" }).colors), ["red"]);
  same(sat.options.map((o) => o.label), ["독서 1", "독서 2"]);   // 성 토요일 원본 세트 둘(욥기/마태 · 애가/요한)
});

test("A3 2026-12-25 — 초기 선택은 승자 성탄 낮(미결12), 밤 · 새벽은 칩", { skip: SKIP }, () => {
  const m = model("2026-12-25");
  assert.strictEqual(id(m.selected), "d1225-성탄-낮");
  same(m.chips.map((c) => c.label), ["성탄 낮", "성탄 밤", "성탄 새벽", "성탄 금요일 (나해)"]);
  assert.strictEqual(m.collects.length, 1);   // 성탄 낮 본기도만 — 밤 · 새벽은 그 칩에서
});

test("A3 2026-06-14 연중 11주일 — 트랙 기억이 기본, URL 이 이기고, 괄호 선택 구절 세트는 바탕에 합쳐져 긴 본문 + 선택 구절", { skip: SKIP }, () => {
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

test("A3 2026-03-01 사순 2주일 — 조건부 세트는 조건이 라벨 「주의 변모 주일로 지킬 때」, 바탕은 관측일 이름(미결38)", { skip: SKIP }, () => {
  const m = model("2026-03-01", { set: 2 });
  same(m.options.map((o) => o.label), ["사순 2주일", "주의 변모 주일로 지킬 때"]);   // 「…로 지키는 경우」 → 「…로 지킬 때」
  assert.strictEqual(m.group.set_no, 2);
  same(m.chips.map((c) => c.muted), [true, true, false]);   // 삼일절 · 데이빗 생략
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
test("A3 2025~2027 모든 날 — 모델이 서고, 초기 선택에 복음까지 있는 독서가 있고, 칩 href 가 /lectionary/ 로 시작한다", { skip: SKIP }, () => {
  const bad = [];
  for (const y of [2025, 2026, 2027]) {
    let d = ctx.toKey(y, 1, 1);
    while (d.slice(0, 4) === String(y)) {
      const m = model(d);
      if (!m.group) bad.push(`${d} 독서 없음`);
      else if (!m.slots.some((s) => s.slot === "gospel")) bad.push(`${d} 복음 없음`);
      if (!m.chips.length || m.chips.some((c) => !c.href.startsWith("/lectionary/"))) bad.push(`${d} 칩`);
      if (!m.chips.some((c) => c.active)) bad.push(`${d} 활성 칩 없음`);
      if (!m.colors.length) bad.push(`${d} 색 없음`);
      if (m.empty) bad.push(`${d} empty`);   // 본기도까지 없는 날은 없다
      d = ctx.addDays(d, 1);
    }
  }
  same(bad, []);
});
