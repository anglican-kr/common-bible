// ── Unit tests for js/app/lectionary.js — LECTIONARY_MODEL block ─────────────
// Run with: node --test tests/unit/lectionary.test.js
//
// Same vm + BEGIN/END marker slice approach as bookmark-read.test.js. Only the
// pure LECTIONARY_MODEL block is covered — which candidate the view opens on,
// which track / set / collect, what the chips and the side-by-side choice say,
// which colours the header wears, how state round-trips through the URL, and
// how a verse spec selects verses. The DOM renderer (renderLectionaryView) needs
// the engine preload + chapter fetches + appendVerses and is e2e's job
// (tests/e2e/test_lectionary_view.py, ADR-013 dual-track). Real-table cases
// live in lectionary.data.test.js (설계서 §7 — 공개 CI 는 data/ 가 없다).
//
// The engine's LITURGICAL_CORE + LITURGICAL_LOOKUP blocks and verse-spec's
// VERSE_SPEC block are sliced in first, so parseDate / addDays / optionalDestOf /
// fastOf / specCoversVerse / verseInstanceKeys are the real functions — the
// "오는/지난 주일" wording is computed, not stubbed.

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

function load() {
  const ctx = {
    Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
    parseInt, isNaN, Date, NaN, URLSearchParams,
  };
  vm.createContext(ctx);
  // 엔진 모듈 상태는 블록 밖에 있어 prelude 로 재선언한다(설계서 §3.3).
  vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();",
    ctx, { filename: "prelude" });
  vm.runInContext(extractBlock("LITURGICAL_CORE", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js" });
  vm.runInContext(extractBlock("LITURGICAL_LOOKUP", ENGINE_SOURCE), ctx, { filename: "liturgical-engine.js#lookup" });
  vm.runInContext(extractBlock("VERSE_SPEC", VERSE_SPEC_SOURCE), ctx, { filename: "verse-spec.js" });
  vm.runInContext(extractBlock("LECTIONARY_MODEL", LECTIONARY_SOURCE), ctx, { filename: "lectionary.js" });
  return ctx;
}

const ctx = load();
// vm objects carry the sandbox realm's prototypes — normalize before deepStrictEqual.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// vm 이 만든 배열 · 객체는 realm 이 달라 deepStrictEqual 이 프로토타입에서 틀린다 — 양쪽을 정규화한다.
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);
// `const` 상수는 스크립트 스코프라 ctx 프로퍼티가 아니다 — 이름으로 평가해 꺼낸다(함수 선언은 ctx 에 붙는다).
const K = (name) => vm.runInContext(name, ctx);

// ── 합성 재료 ─────────────────────────────────────────────────────────────────

/** 정의 표의 행 형식으로 만든 전례일. `extra`로 rank · color · transfer_to 등을 얹는다. */
const obs = (id, name, extra = {}) => ({
  id, kind: id.startsWith("t-") || id.startsWith("grid:") ? "temporal" : "sanctoral", name,
  rank: null, precedence: null, color: null, color_alt: null, transferable: false, transfer_to: null, ...extra,
});
const cand = (observance, status = "proper", extra = {}) => ({ observance, status, ...extra });
const slot = (s, bookId, chapter, verseSpec, label) => ({ slot: s, bookId, refs: [{ chapter, verseSpec }], label });
const group = (id, readings, extra = {}) => ({
  id, title: "", reading_track: null, set_no: 1, set_total: 1, set_note: null, readings, common: null, ...extra,
});
const collect = (id, text, extra = {}) => ({ id, title: "", collect_no: 1, collect_total: 1, text, ending: "A", common: null, ...extra });
const FOUR = [slot("first", "gen", 12, "1-9", "창세 12:1-9"), slot("psalm", "lps", 33, "1-12", "시편 33:1-12"),
  slot("second", "rom", 4, "13-25", "로마 4:13-25"), slot("gospel", "matt", 9, "9-13,18-26", "마태 9:9-13, 18-26")];
/** `ResolvedDate` 형식 — 연중 평일(짝수해)이 기본 좌표. */
const resolvedOf = (date, candidates, official, extra = {}) => ({
  date, coord: { season: "ordinary", week: 18, type: "weekday", weekday: "thu", year: "II" },
  candidates, official, periods: [], color: "green", colors: ["green"], colorAlt: null, ...extra,
});
/** 후보 id → 그룹 표에서 `groupsOf` 를 만든다. */
const groupsOfFrom = (table) => (c) => table[c.observance.id] || [];

// ── 라벨 ──────────────────────────────────────────────────────────────────────

test("shortName: 괄호 설명을 전부 뗀다 — 안쪽 괄호 둘도", () => {
  assert.strictEqual(ctx.shortName("토마스 크랜머(캔터베리 대주교, 전례개혁자, 순교자, 1556년)"), "토마스 크랜머");
  assert.strictEqual(ctx.shortName("바실(주교, 379년)과 나지안조의 그레고리(주교, 389년)"), "바실과 나지안조의 그레고리");
  assert.strictEqual(ctx.shortName("주의 변모"), "주의 변모");
  assert.strictEqual(ctx.shortName("(괄호뿐)"), "(괄호뿐)");   // 떼고 나서 비면 원래 이름
  assert.strictEqual(ctx.shortName(null), "");
});

test("dateLabel · monthDayLabel: 요일 포함 · 깨진 날짜는 그대로", () => {
  assert.strictEqual(ctx.dateLabel("2026-04-05"), "2026년 4월 5일 (일)");
  assert.strictEqual(ctx.dateLabel("2026-13-99"), "2026-13-99");
  assert.strictEqual(ctx.monthDayLabel("2026-08-09"), "8월 9일");
});

test("chipLabel: 격자 후보에만 주기를 붙이고, 트랙은 그 후보가 트랙을 가질 때만", () => {
  const sunday = cand(obs("grid:ordinary-19-sunday", "연중 19주일"));
  const r = resolvedOf("2026-08-09", [sunday], sunday, { coord: { season: "ordinary", week: 19, type: "sunday", weekday: null, year: "A" } });
  assert.strictEqual(ctx.chipLabel(sunday, r, 2), "연중 19주일 (가해, 독서 2)");
  assert.strictEqual(ctx.chipLabel(sunday, r, null), "연중 19주일 (가해)");
  const saint = cand(obs("d0806-주의-변모", "주의 변모"));
  assert.strictEqual(ctx.chipLabel(saint, r, null), "주의 변모");   // 성인 축일은 주기로 갈리지 않는다
});

test("chipLabel · statusSuffix: 밀림 · 옮김 · 선택 봉헌 · 기념 · 기념일 · 저녁 꼬리", () => {
  const r = resolvedOf("2026-12-07", [], null);
  assert.strictEqual(ctx.chipLabel(cand(obs("d1206-성-니콜라", "성 니콜라(미라의 주교)"), "transferred_in", { from: "2026-12-06" }), r, null),
    "성 니콜라 · 12월 6일에서 옮겨 옴");
  assert.strictEqual(ctx.chipLabel(cand(obs("d1018-루가", "성 루가"), "transferred_out", { to: "2026-10-19" }), r, null), "성 루가 · → 10월 19일");
  assert.strictEqual(ctx.chipLabel(cand(obs("d0806-주의-변모", "주의 변모"), "optional", { from: "2026-08-06" }), r, null),
    "주의 변모 · 8월 6일에서 옮겨 지킬 수 있음");
  assert.strictEqual(ctx.chipLabel(cand(obs("d1207-암브로스", "암브로스(주교)"), "omitted"), r, null), "암브로스 · 생략");
  assert.strictEqual(ctx.chipLabel(cand(obs("t-추수감사주일", "추수감사주일"), "commemorated"), r, null), "추수감사주일 · 기념만");
  assert.strictEqual(ctx.chipLabel(cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration" })), r, null),
    "세계평화를 위한 기도일 · 기념일");
  // 저녁 전례(설계서 R-6.1-evening) — 「· 저녁」. 필수 CI 가 이 꼬리를 지키는 유일한 자리다(실데이터 테스트는 data 워크플로에서만
  // 돈다 — PR #349 리뷰)
  assert.strictEqual(ctx.chipLabel(cand(obs("t-부활밤", "부활밤", { color: "white" }), "proper", { evening: true }), r, null), "부활밤 · 저녁");
});

test("isMutedCandidate: 생략 · 떠남 · 기념일만 흐리다", () => {
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "omitted")), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "transferred_out")), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a", { rank: "commemoration" }))), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "commemorated")), false);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "optional")), false);
});

// ── 초기 선택 ─────────────────────────────────────────────────────────────────

test("initialCandidate: 지정 전례일에 고유 독서가 있으면 지정 전례일", () => {
  const feast = cand(obs("d0806-주의-변모", "주의 변모", { rank: "major_feast", precedence: 3, color: "white" }));
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-08-06", [feast, grid], feast);
  const groupsOf = groupsOfFrom({ "d0806-주의-변모": [group("f", FOUR)], "grid:ordinary-18-weekday-thu": [group("g", FOUR)] });
  assert.strictEqual(ctx.initialCandidate(r, groupsOf), feast);
});

test("initialCandidate: 지정 전례일의 독서가 공통뿐이면 격자(미결25 — 책자대로 평일 독서)", () => {
  const saint = cand(obs("d0916-니니안", "니니안(주교)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "missionary" }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, grid], saint);
  const groupsOf = groupsOfFrom({
    "d0916-니니안": [group("common:missionary-s1", FOUR, { common: "missionary", title: "선교사" })],
    "grid:ordinary-24-weekday-wed": [group("g", FOUR)],
  });
  assert.strictEqual(ctx.initialCandidate(r, groupsOf), grid);
});

test("initialCandidate: 격자에 독서가 없으면 지정 전례일을 그대로 — 공통만 있어도", () => {
  const saint = cand(obs("d0916-니니안", "니니안", { rank: "minor_feast", precedence: 7 }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { rank: "feria", precedence: 8 }));
  const r = resolvedOf("2026-09-16", [saint, grid], saint);
  const groupsOf = groupsOfFrom({ "d0916-니니안": [group("c", FOUR, { common: "missionary" })] });
  assert.strictEqual(ctx.initialCandidate(r, groupsOf), saint);
});

test("selectCandidate: ?obs 가 후보에 있으면 그것, 없으면 초기 선택", () => {
  const feast = cand(obs("d0806-주의-변모", "주의 변모"));
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일"));
  const r = resolvedOf("2026-08-06", [feast, grid], feast);
  const groupsOf = groupsOfFrom({ "d0806-주의-변모": [group("f", FOUR)], "grid:ordinary-18-weekday-thu": [group("g", FOUR)] });
  assert.strictEqual(ctx.selectCandidate(r, "grid:ordinary-18-weekday-thu", groupsOf), grid);
  assert.strictEqual(ctx.selectCandidate(r, "no-such-id", groupsOf), feast);
  assert.strictEqual(ctx.selectCandidate(r, null, groupsOf), feast);
});

// ── 트랙 · 세트 ──────────────────────────────────────────────────────────────

// 괄호 선택 구절 세트 — 복음만 더 길다(마태 9:9-13, 18-26 → 18-31). 실데이터의 괄호 세트 34건이 다 이 형식(한 슬롯만).
const FOUR_LONG = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "matt", 9, "9-13,18-31", "마태 9:9-13, 18-31")];
const TRACKED = [
  group("t1s1", FOUR, { reading_track: 1, set_no: 1, set_total: 2 }),
  group("t1s2", FOUR_LONG, { reading_track: 1, set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" }),
  group("t2s1", FOUR, { reading_track: 2, set_no: 1, set_total: 2 }),
  group("t2s2", FOUR_LONG, { reading_track: 2, set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" }),
];

test("tracksOf · pickTrack: URL > 기억(마지막 선택) > 첫 트랙 — 트랙 없는 날은 null", () => {
  same(plain(ctx.tracksOf(TRACKED)), [1, 2]);
  same(plain(ctx.tracksOf([group("x", FOUR)])), []);
  assert.strictEqual(ctx.pickTrack(TRACKED, 2, 1), 2);
  assert.strictEqual(ctx.pickTrack(TRACKED, null, 2), 2);
  assert.strictEqual(ctx.pickTrack(TRACKED, null, null), 1);
  assert.strictEqual(ctx.pickTrack([group("x", FOUR)], 2, 2), null);
});

test("setsOf · readingOptions · pickSet: 고른 트랙의 세트만 — 괄호 세트는 바탕에 합쳐져 선택지 하나, 범위 밖 ?set 은 첫 선택지", () => {
  const sets = ctx.setsOf(TRACKED, 2);
  same(sets.map((g) => g.id), ["t2s1", "t2s2"]);
  const opts = ctx.readingOptions(sets, "연중 11주일");
  assert.strictEqual(opts.length, 1);
  assert.strictEqual(opts[0].group.id, "t2s2");    // 긴 본문을 싣는다
  assert.strictEqual(opts[0].short.id, "t2s1");    // 짧은 바탕은 〔 〕 표시의 기준
  assert.strictEqual(ctx.pickSet(opts, 2), 0);
  assert.strictEqual(ctx.pickSet(opts, null), 0);
  assert.strictEqual(ctx.pickSet([], 1), -1);
  assert.strictEqual(ctx.setsOf(TRACKED, null).length, 4);   // 트랙 없이 부르면 전부
});

test("readingOptions: 「또는」 대안(완전한 세트 둘)은 「독서 1」「독서 2」 — 원본 세트 표지든 표지 없음이든", () => {
  const alt = [FOUR[0], FOUR[1], slot("second", "rom", 5, "1-11", "로마 5:1-11"), FOUR[3]];
  const plainPair = [group("a", FOUR, { set_no: 1, set_total: 2 }), group("b", alt, { set_no: 2, set_total: 2 })];
  same(ctx.readingOptions(plainPair, "연중 10주일").map((o) => [o.label, o.group.id, o.short]), [["독서 1", "a", null], ["독서 2", "b", null]]);
  const source = [group("e1", FOUR, { set_no: 1, set_total: 2, set_note: "원본 세트 1" }), group("e2", alt, { set_no: 2, set_total: 2, set_note: "원본 세트 2" })];
  same(ctx.readingOptions(source, "부활대축일").map((o) => o.label), ["독서 1", "독서 2"]);
});

test("readingOptions: 조건부 세트는 조건이 라벨, 바탕 세트는 전례일 이름 — 「…로 지키는 경우」도 「…로 지킬 때」로", () => {
  const transfig = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "matt", 17, "1-9", "마태 17:1-9")];
  const sets = [group("l1", FOUR, { set_no: 1, set_total: 2 }), group("l2", transfig, { set_no: 2, set_total: 2, set_note: "주의 변모 주일로 지키는 경우" })];
  same(ctx.readingOptions(sets, "사순 2주일").map((o) => o.label), ["사순 2주일", "주의 변모 주일로 지킬 때"]);
});

test("readingOptions: 괄호 선택 구절 세트는 바탕(한 슬롯만 짧은 앞 세트)에 합친다 — 성지주일 나해 같은 경우(긴 수난 · 짧은 수난 · 짧은 수난 + 괄호)", () => {
  const long = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "mark", 14, "all", "마르 14:1-15:47")];
  const short = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "mark", 15, "1-39", "마르 15:1-39")];
  const shortPlus = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "mark", 15, "1-47", "마르 15:1-39, 40-47")];
  const sets = [group("p1", long, { set_no: 1, set_total: 3 }), group("p2", short, { set_no: 2, set_total: 3 }), group("p3", shortPlus, { set_no: 3, set_total: 3, set_note: "괄호 선택 구절 포함" })];
  const opts = ctx.readingOptions(sets, "성지주일");
  same(opts.map((o) => [o.label, o.group.id, o.short && o.short.id]), [["독서 1", "p1", null], ["독서 2", "p3", "p2"]]);
});

test("readingOptions: 바탕이 없는 괄호 세트(두 슬롯이 다름)는 그대로 선택지 — 제목이 갈리면 제목으로", () => {
  const twoDiff = [slot("first", "isa", 1, "1-9", "이사 1:1-9"), FOUR[1], FOUR[2], slot("gospel", "matt", 9, "9-13,18-31", "마태 9:9-13, 18-31")];
  const sets = [group("a", FOUR, { set_no: 1, set_total: 2 }), group("b", twoDiff, { set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" })];
  same(ctx.readingOptions(sets, "x").map((o) => [o.label, o.short]), [["독서 1", null], ["독서 2", null]]);
  const mixed = [group("a", FOUR, { title: "성탄 밤", set_no: 1 }), group("b", FOUR, { title: "성탄 낮", set_no: 1 }), group("c", FOUR, { title: "성탄 낮", set_no: 2 })];
  same(ctx.readingOptions(mixed, "성탄").map((o) => o.label), ["성탄 밤", "성탄 낮 독서 1", "성탄 낮 독서 2"]);
});

test("setCondition: 「…로 지키는 경우」→「…로 지킬 때」, 파서 표지(원본 세트 · 괄호)는 null", () => {
  assert.strictEqual(ctx.setCondition(group("a", FOUR, { set_note: "원본 세트 1" })), null);
  assert.strictEqual(ctx.setCondition(group("a", FOUR, { set_note: "괄호 선택 구절 포함" })), null);
  assert.strictEqual(ctx.setCondition(group("a", FOUR, { set_note: "주의 변모 주일로 지키는 경우" })), "주의 변모 주일로 지킬 때");
  assert.strictEqual(ctx.setCondition(group("a", FOUR, { set_note: "주의 변모 주일로 지킬 때" })), "주의 변모 주일로 지킬 때");
  assert.strictEqual(ctx.setCondition(group("a", FOUR)), null);
});

test("optionalVerseTest: 긴 본문에는 있고 짧은 바탕에는 없는 절만 — 장이 다르면 아니다, 바탕이 없으면 언제나 거짓", () => {
  const isOpt = ctx.optionalVerseTest(FOUR_LONG[3], FOUR[3]);
  assert.strictEqual(isOpt(9, 26), false);
  assert.strictEqual(isOpt(9, 27), true);
  assert.strictEqual(isOpt(9, 31), true);
  assert.strictEqual(isOpt(9, 14), false);   // 둘 다 없음
  assert.strictEqual(isOpt(10, 27), false);
  assert.strictEqual(ctx.optionalVerseTest(FOUR_LONG[3], null)(9, 27), false);
});

test("slotsInOrder: 이름으로 first → psalm → second → gospel, 위치는 무시, 없는 슬롯은 건너뛴다", () => {
  const shuffled = [FOUR[3], FOUR[1], FOUR[0]];   // gospel · psalm · first — second 없음
  same(ctx.slotsInOrder(group("g", shuffled)).map((s) => s.slot), ["first", "psalm", "gospel"]);
  same(ctx.slotsInOrder(null), []);
});

// ── 본기도 ────────────────────────────────────────────────────────────────────

test("collectsFor: 고른 전례일의 본기도만 — 다른 전례일 것은 열거하지 않는다(사용자 결정 2026-10-12)", () => {
  const feast = cand(obs("d1206-성-니콜라", "성 니콜라"), "transferred_in", { from: "2026-12-06" });
  const grid = cand(obs("grid:advent-2-weekday-mon", "대림 2주 월요일"));
  const omitted = cand(obs("d1207-암브로스", "암브로스"), "omitted");
  const entries = [feast, grid, omitted].map((c) => ({ candidate: c, collects: [collect(c.observance.id, "…")] }));
  same(ctx.collectsFor(entries, grid).map((o) => o.id), ["grid:advent-2-weekday-mon"]);
  same(ctx.collectsFor(entries, feast).map((o) => o.id), ["d1206-성-니콜라"]);
  same(ctx.collectsFor(entries, omitted).map((o) => o.id), ["d1207-암브로스"]);   // 생략된 축일도 고르면 그 본기도
});

test("collectsFor: 같은 id 의 다른 객체로도 찾고, 본기도 없는 후보(기념일)는 빈 배열", () => {
  const memo = cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration" }));
  const feast = cand(obs("d0101-거룩한-이름-예수", "거룩한 이름 예수"));
  const entries = [{ candidate: feast, collects: [collect(1, "…")] }, { candidate: memo, collects: [] }];
  same(ctx.collectsFor(entries, memo), []);
  same(ctx.collectsFor(entries, cand(obs("d0101-거룩한-이름-예수", "거룩한 이름 예수"))).map((o) => o.id), [1]);
  same(ctx.collectsFor(entries, cand(obs("none", "없음"))), []);
});

test("pickCollect · endingCodeOf: ?collect= 는 목록 위치로 고르고 범위 밖이면 첫 대체안, 코드가 없으면 송영 A", () => {
  const opts = [collect(1, "a", { collect_no: 1, collect_total: 3 }), collect(2, "b", { collect_no: 2, collect_total: 3, ending: "C" }), collect(3, "c", { collect_no: 3, collect_total: 3 })];
  assert.strictEqual(ctx.pickCollect(opts, 2), 1);
  assert.strictEqual(ctx.pickCollect(opts, 7), 0);
  assert.strictEqual(ctx.pickCollect([], 1), -1);
  assert.strictEqual(ctx.endingCodeOf(opts[1]), "C");
  assert.strictEqual(ctx.endingCodeOf(collect(9, "x", { ending: null })), "A");
  assert.strictEqual(ctx.endingCodeOf(null), "A");
});

// ── 두 독서 나란히 ────────────────────────────────────────────────────────────

const transfig = (status = "proper", extra = {}) => cand(obs("d0806-주의-변모", "주의 변모", {
  rank: "major_feast", precedence: 3, color: "white", transferable: true, transfer_to: "nearby_sunday",
}), status, extra);

test("pairOf: 선택 봉헌 당일(목요일) — 격자 카드에 「오는 주일(8월 9일)」", () => {
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일", { rank: "feria", precedence: 8 }));
  const feast = transfig();
  const p = ctx.pairOf(resolvedOf("2026-08-06", [feast, grid], feast));
  assert.ok(p);
  assert.strictEqual(p.kind, "optional-origin");
  assert.strictEqual(p.a, feast);
  assert.strictEqual(p.b, grid);
  assert.strictEqual(p.aText.official, true);
  assert.strictEqual(p.bText.note, "오는 주일(8월 9일)로 옮겨 지키는 경우 — 이날은 평일 독서");
});

test("pairOf: 선택 봉헌 당일(화요일) — 「지난 주일(8월 4일)」", () => {
  const grid = cand(obs("grid:ordinary-18-weekday-tue", "연중 18주 화요일"));
  const feast = transfig();
  const p = ctx.pairOf(resolvedOf("2024-08-06", [feast, grid], feast, { coord: { season: "ordinary", week: 18, type: "weekday", weekday: "tue", year: "II" } }));
  assert.ok(p);
  assert.strictEqual(p.bText.note, "지난 주일(8월 4일)로 옮겨 지키는 경우 — 이날은 평일 독서");
});

test("pairOf: 당일이 주일이면(2028-08-06) 목적지가 그날 자신이라 나란히 낼 것이 없다", () => {
  const grid = cand(obs("grid:ordinary-19-sunday", "연중 19주일"));
  const feast = transfig();
  assert.strictEqual(ctx.pairOf(resolvedOf("2028-08-06", [feast, grid], feast)), null);
});

test("pairOf: 독서가 없는 쪽이 있으면 카드를 내지 않는다 — 성탄 8일 도착일의 빈 격자(자체 리뷰 2026-10-13)", () => {
  const john = cand(obs("d1227-사도-성-요한", "사도 성 요한"), "transferred_in", { from: "2026-12-27", displacedBy: "grid:christmas-1-sunday" });
  const grid = cand(obs("grid:christmas-x-weekday-mon", "성탄 월요일"));
  const r = resolvedOf("2026-12-28", [john, grid], john);
  assert.ok(ctx.pairOf(r));   // groupsOf 없이는 예전대로
  assert.strictEqual(ctx.pairOf(r, groupsOfFrom({ "d1227-사도-성-요한": [group(1, FOUR)] })), null);
  assert.ok(ctx.pairOf(r, groupsOfFrom({ "d1227-사도-성-요한": [group(1, FOUR)], "grid:christmas-x-weekday-mon": [group(2, FOUR)] })));
});

test("pairOf: 명절이 주일이면 격자 카드는 「이날의 주일 독서」(2027-02-07 설 — 자체 리뷰 2026-10-13)", () => {
  const seollal = cand(obs("lunar11-설날", "설날", { rank: "regional_festival", precedence: 0 }));
  const grid = cand(obs("grid:ordinary-5-sunday", "연중 5주일"));
  const p = ctx.pairOf(resolvedOf("2027-02-07", [seollal, grid], seollal));
  assert.strictEqual(p.kind, "festival");
  assert.strictEqual(p.bText.note, "이날의 주일 독서");
  assert.strictEqual(ctx.pairOf(resolvedOf("2026-02-17", [seollal, grid], seollal)).bText.note, "이날의 평일 독서");
});

test("pairOf: 목적지 주일 — 지정 전례일(격자 주일)과 optional 후보", () => {
  const grid = cand(obs("grid:ordinary-19-sunday", "연중 19주일", { rank: "sunday", precedence: 5 }));
  const opt = transfig("optional", { from: "2026-08-06" });
  const p = ctx.pairOf(resolvedOf("2026-08-09", [opt, grid], grid));
  assert.ok(p);
  assert.strictEqual(p.kind, "optional-dest");
  assert.strictEqual(p.a, grid);
  assert.strictEqual(p.b, opt);
  assert.strictEqual(p.bText.note, "8월 6일에서 옮겨 지키는 경우");
  assert.strictEqual(p.aText.official, true);
});

test("pairOf: 옮겨 온 축일의 도착일 — 도착 축일과 격자", () => {
  const nic = cand(obs("d1206-성-니콜라", "성 니콜라"), "transferred_in", { from: "2026-12-06", displacedBy: "grid:advent-2-sunday" });
  const grid = cand(obs("grid:advent-2-weekday-mon", "대림 2주 월요일"));
  const omitted = cand(obs("d1207-암브로스", "암브로스"), "omitted");
  const p = ctx.pairOf(resolvedOf("2026-12-07", [omitted, nic, grid], nic));
  assert.ok(p);
  assert.strictEqual(p.kind, "arrival");
  same([p.a, p.b], [nic, grid]);
  assert.strictEqual(p.aText.note, "12월 6일에서 옮겨 옴");
  assert.strictEqual(p.bText.note, "이날의 평일 독서");
});

test("pairOf: 명절 — 명절과 격자 평일", () => {
  const seol = cand(obs("lunar11-설날", "설날", { rank: "regional_festival", precedence: 0 }));
  const grid = cand(obs("grid:ordinary-3-weekday-wed", "연중 3주 수요일"));
  const p = ctx.pairOf(resolvedOf("2025-01-29", [seol, grid], seol));
  assert.ok(p);
  assert.strictEqual(p.kind, "festival");
  assert.strictEqual(p.aText.note, "명절 — 이날의 공식 독서");
});

test("pairOf: 보통 평일 · 보통 축일은 null", () => {
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일"));
  assert.strictEqual(ctx.pairOf(resolvedOf("2026-08-13", [grid], grid)), null);
  const saint = cand(obs("d0916-니니안", "니니안", { rank: "minor_feast" }));
  assert.strictEqual(ctx.pairOf(resolvedOf("2026-09-16", [saint, grid], saint)), null);
});

// ── 색 ────────────────────────────────────────────────────────────────────────

test("headerColors: 기본은 그날의 colors(병기) + colorAlt(3형 → 배열)", () => {
  const grid = cand(obs("grid:advent-3-sunday", "대림 3주일"));
  const r = resolvedOf("2026-12-13", [grid], grid, { color: "violet", colors: ["violet"], colorAlt: ["rose", "blue"] });
  same(plain(ctx.headerColors(r, grid)), { colors: ["violet"], colorAlt: ["rose", "blue"], ownColor: false });
  const r2 = resolvedOf("2026-12-08", [grid], grid, { color: "violet", colors: ["violet"], colorAlt: "blue" });
  same(plain(ctx.headerColors(r2, grid).colorAlt), ["blue"]);
  same(plain(ctx.headerColors(resolvedOf("2026-08-13", [grid], grid, { colors: [], color: "green" }), null).colors), ["green"]);
});

test("headerColors: 고른 본문의 색 — 그날 대표색과 다른 비격자 후보면 그 색 하나(사계재 자 · 부활밤 백), 같으면 그날 병기 그대로", () => {
  const saint = cand(obs("d0916-니니안", "니니안", { color: "white" }));
  const ember = cand(obs("t-추계재", "추계재", { color: "violet", penitential: true }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, ember, grid], saint, { color: "white", colors: ["violet", "white"] });
  same(plain(ctx.headerColors(r, ember)), { colors: ["violet"], colorAlt: [], ownColor: true });
  // 격자를 골라도 그날 색 그대로(격자는 절기 바탕색을 들고 있을 뿐이다) — 미결25 의 초기 선택이 색을 바꾸지 않는다.
  same(plain(ctx.headerColors(r, grid).colors), ["violet", "white"]);
  // 지정 전례일(색이 그날 대표색과 같다)을 고르면 그날 색(병기 포함).
  same(plain(ctx.headerColors(r, saint)), { colors: ["violet", "white"], colorAlt: [], ownColor: false });
  // 성 토요일(사용자 결정 2026-10-12 · 10-15): 대표는 성 토요일 행(홍)이고 부활밤은 후보 끝의 저녁 전례(R-6.1-evening) —
  // 부활밤 칩을 고르면 백, 성 토요일 후보면 그날 색 홍.
  const vigil = cand(obs("t-부활밤", "부활밤", { color: "white", precedence: 1 }), "proper", { evening: true });
  const holySat = cand(obs("t-성-토요일", "성 토요일", { color: "red", precedence: 1 }));
  const holyGrid = cand(obs("grid:lent-x-weekday-sat", "성주간 토요일", { color: "red" }));
  const hs = resolvedOf("2026-04-04", [holySat, holyGrid, vigil], holySat, { color: "red", colors: ["red"] });
  same(plain(ctx.headerColors(hs, vigil)), { colors: ["white"], colorAlt: [], ownColor: true });
  same(plain(ctx.headerColors(hs, holySat)), { colors: ["red"], colorAlt: [], ownColor: false });
});

// ── URL ───────────────────────────────────────────────────────────────────────

test("hrefFor: 기본값과 같은 키는 쓰지 않고, 다른 것만 쿼리로", () => {
  const d = { obs: "grid:ordinary-19-sunday", track: 1 };
  assert.strictEqual(ctx.hrefFor("2026-08-09", { obs: "grid:ordinary-19-sunday", track: 1, set: 1, collect: 1 }, d), "/lectionary/2026-08-09");
  assert.strictEqual(ctx.hrefFor("2026-08-09", { obs: "d0806-주의-변모", track: null, set: null, collect: null }, d),
    "/lectionary/2026-08-09?obs=d0806-%EC%A3%BC%EC%9D%98-%EB%B3%80%EB%AA%A8");
  assert.strictEqual(ctx.hrefFor("2026-08-09", { obs: "grid:ordinary-19-sunday", track: 2, set: 2, collect: 3 }, d),
    "/lectionary/2026-08-09?track=2&set=2&collect=3");
});

// ── 절 발췌 · 영광송 ──────────────────────────────────────────────────────────

const CHAPTER = {
  book_id: "lps", chapter: 23, verses: [
    { number: 1, text: "a" }, { number: 2, text: "b" }, { number: 3, text: "c" },
    { number: 4, text: "d" }, { number: 4, versicle: true, text: "d¶" }, { number: 5, range_end: 6, text: "e" }, { number: 7, text: "f" },
  ],
};

test("selectVerses: spec 범위 + 병합 절(range_end) + 전체 장 기준 인스턴스 키", () => {
  const r = ctx.selectVerses(CHAPTER, "2-4,6");
  same(r.verses.map((v) => v.text), ["b", "c", "d", "d¶", "e"]);   // 5-6 병합 절은 6 으로 걸린다
  same(plain(r.keys), ["2", "3", "4", "4_v", "5"]);
  assert.strictEqual(ctx.selectVerses(CHAPTER, "all").verses.length, 7);
  assert.strictEqual(ctx.selectVerses({ verses: [] }, "1-3").verses.length, 0);
});

test("collectLabels · pickCollect: 번호가 겹치면 제목의 다른 부분으로 가르고, ?collect= 는 위치다(자체 리뷰 2026-10-13)", () => {
  same(ctx.collectLabels([collect(1, "a", { collect_no: 1 }), collect(2, "b", { collect_no: 2 })]), ["본기도 1", "본기도 2"]);
  const ember = [collect(234, "a", { title: "성직후보자의 성소를 위한 추계재 금요일" }), collect(237, "b", { title: "수도자의 성소를 위한 추계재 금요일" })];
  same(ctx.collectLabels(ember), ["성직후보자", "수도자"]);
  same(ctx.collectLabels([collect(293, "a", { title: "노동자의 날" }), collect(294, "b", { title: "사도 성 필립보와 성 야고보" })]), ["노동자의 날", "사도 성 필립보와 성 야고보"]);
  same(ctx.collectLabels([collect(1, "a", { title: "같다" }), collect(2, "b", { title: "같다" })]), ["본기도 1", "본기도 2"]);
  assert.strictEqual(ctx.pickCollect(ember, 2), 1);
  assert.strictEqual(ctx.pickCollect(ember, 3), 0);
  assert.strictEqual(ctx.pickCollect(ember, null), 0);
});

test("collectsFor · readingOptions: 한 날짜에 섞여 온 다른 전례일의 것보다 고른 전례일 이름의 것을 앞세운다(5.1 — 자체 리뷰 2026-10-13)", () => {
  const apostles = cand(obs("d0501-사도-성-필립보와-성-야고보", "사도 성 필립보와 성 야고보"));
  const entries = [{ candidate: apostles, collects: [collect(293, "노동", { title: "노동자의 날" }), collect(294, "사도", { title: "사도 성 필립보와 성 야고보" })] }];
  same(ctx.collectsFor(entries, apostles).map((o) => o.id), [294, 293]);
  const opts = ctx.readingOptions([group(1, FOUR, { title: "노동자의 날" }), group(2, FOUR, { title: "사도 성 필립보와 성 야고보" })], "사도 성 필립보와 성 야고보");
  same(opts.map((o) => o.label), ["사도 성 필립보와 성 야고보", "노동자의 날"]);
});

test("linkCollects: 세트와 본기도가 같은 제목으로 1:1 이면 세트마다 짝 본기도의 위치, 아니면 null(사용자 결정 2026-10-13)", () => {
  const opts = ctx.readingOptions([group(1, FOUR, { title: "사도 성 필립보와 성 야고보" }), group(2, FOUR, { title: "노동자의 날" })], "사도 성 필립보와 성 야고보");
  const cols = [collect(293, "노동", { title: "노동자의 날" }), collect(294, "사도", { title: "사도 성 필립보와 성 야고보" })];
  same(ctx.linkCollects(opts, cols), [1, 0]);   // 순서가 달라도 제목으로 짝짓는다
  assert.strictEqual(ctx.linkCollects(opts, cols.slice(0, 1)), null);   // 수가 다르면 따로
  assert.strictEqual(ctx.linkCollects(opts, [collect(1, "a", { title: "다른 것" }), cols[0]]), null);   // 짝이 없는 세트가 있으면 따로
  // 제목으로 갈리지 않는 「또는」 대안 · 본기도 1 · 2 는 독립된 축 — 짝이 아니다(Copilot 리뷰 1회차)
  const easter = ctx.readingOptions([group("e1", FOUR, { set_no: 1, set_total: 2 }), group("e2", FOUR, { set_no: 2, set_total: 2 })], "부활대축일");
  assert.strictEqual(ctx.linkCollects(easter, [collect(1, "a", { collect_no: 1 }), collect(2, "b", { collect_no: 2 })]), null);
  assert.strictEqual(ctx.linkCollects([], []), null);
});

test("buildLectionaryModel: 세트와 본기도가 짝지어진 날 — ?set= 이 본기도까지 정하고, ?collect= 는 읽지도 쓰지도 않으며, 라벨은 제목을 가르는 짧은 이름(사용자 결정 2026-10-13)", () => {
  const ember = cand(obs("t-추계재", "추계재", { rank: "commemoration", color: "violet" }));
  const r = resolvedOf("2026-09-18", [ember], ember, { coord: { season: "ordinary", week: 24, type: "weekday", weekday: "fri", year: "II" }, color: "green", colors: ["green"] });
  const groupsOf = groupsOfFrom({ "t-추계재": [
    group("s1", FOUR, { title: "성직후보자의 성소를 위한 추계재 금요일" }), group("s2", FOUR, { title: "수도자의 성소를 위한 추계재 금요일" })] });
  const entries = [{ candidate: ember, collects: [
    collect(234, "a", { title: "성직후보자의 성소를 위한 추계재 금요일", collect_no: 1 }), collect(237, "b", { title: "수도자의 성소를 위한 추계재 금요일", collect_no: 1, ending: "C" })] }];
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: 2, collect: 1 }, groupsOf, entries, null);
  assert.strictEqual(m.collectsLinked, true);
  same(m.options.map((o) => o.label), ["성직후보자", "수도자"]);
  assert.strictEqual(m.group.id, "s2");
  assert.strictEqual(m.collects[m.collectIndex].id, 237);   // ?collect=1 은 무시 — 세트 2 의 짝
  assert.strictEqual(m.ending, "C");
  same(plain(m.hrefs.options), ["/lectionary/2026-09-18", "/lectionary/2026-09-18?set=2"]);   // collect 를 쓰지 않는다
  same(plain(m.hrefs.collects), ["/lectionary/2026-09-18", "/lectionary/2026-09-18?set=2"]);   // 본기도 링크도 짝 세트로
  const first = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: 2 }, groupsOf, entries, null);
  assert.strictEqual(first.collects[first.collectIndex].id, 234);   // 세트 1(기본)의 짝 — 교차 조합은 없다
});

test("selectVerses: 다른 장에서 옮겨 실린 절(chapter_ref)은 번호가 걸려도 뺀다 — 이사 40 의 41:6-7(자체 리뷰 2026-10-13)", () => {
  const ch = { verses: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ number: n, text: `40:${n}` }))
    .concat([{ number: 6, chapter_ref: 41, text: "41:6" }, { number: 7, chapter_ref: 41, text: "41:7" }, { number: 8, text: "40:8" }]) };
  same(ctx.selectVerses(ch, "1-8").verses.map((v) => v.text), ["40:1", "40:2", "40:3", "40:4", "40:5", "40:6", "40:7", "40:8"]);
});

test("selectVerses: 번호 체계가 둘인 장(다니 3) — 그리스어에만 있는 번호를 덮으면 그리스어, 아니면 히브리(자체 리뷰 2026-10-13)", () => {
  const plainV = Array.from({ length: 23 }, (_, i) => ({ number: i + 1, text: `h${i + 1}` }));
  const lxx = Array.from({ length: 67 }, (_, i) => ({ number: 24 + i, lxx_only: true, text: `g${24 + i}` }));
  const hebTail = Array.from({ length: 10 }, (_, i) => ({ number: 24 + i, alt_ref: 91 + i, text: `h${24 + i}` }));
  const dan3 = { verses: [...plainV, ...lxx, ...hebTail] };
  // 사순 3주 화 「다니 3:25, 34-43」 — 아자리야의 기도(그리스어 (25) · (34)~(43)), 히브리 25(92)는 없다
  same(ctx.selectVerses(dan3, "25,34-43").verses.map((v) => v.text), ["g25", "g34", "g35", "g36", "g37", "g38", "g39", "g40", "g41", "g42", "g43"]);
  // 사순 5주 수 「다니 3:14-20, 24-25, 28」 — 히브리 본문(로마 Dn 3:14-20, 91-92, 95), 그리스어 (24)(25)(28) 은 없다
  same(ctx.selectVerses(dan3, "14-20,24-25,28").verses.map((v) => v.text), ["h14", "h15", "h16", "h17", "h18", "h19", "h20", "h24", "h25", "h28"]);
  // 그리스어 체계에서 히브리 뒷부분은 불가타 번호(alt_ref)로 걸린다
  same(ctx.selectVerses(dan3, "50,91-92").verses.map((v) => v.text), ["g50", "h24", "h25"]);
});

test("slotVerseRuns: 장을 넘는 ref 는 장마다 그린다 — 2장 1절이 1장 1절과 키가 같아도 빠지지 않는다(Copilot 1회차)", () => {
  const ch = (n, count) => ({ book_id: "jon", chapter: n, verses: Array.from({ length: count }, (_, i) => ({ number: i + 1, text: `${n}:${i + 1}` })) });
  const chapters = { 1: ch(1, 17), 2: ch(2, 11) };
  const jonah = { slot: "first", bookId: "jon", refs: [{ chapter: 1, verseSpec: "1-17" }, { chapter: 2, verseSpec: "1-2,11" }], label: "요나 1:1-2:2, 11" };
  const runs = ctx.slotVerseRuns(jonah, (n) => chapters[n]);
  same(runs.map((r) => [r.chapter, r.verses.length]), [[1, 17], [2, 3]]);
  same(runs[1].verses.map((v) => v.text), ["2:1", "2:2", "2:11"]);
  same(runs[1].keys, ["1", "2", "11"]);   // DOM id 는 장 안의 인스턴스 키 그대로
});

test("slotVerseRuns: 같은 장의 ref 둘이 겹치면 한 번만, 없는 장은 data null 로 남긴다", () => {
  const ch = { book_id: "gen", chapter: 1, verses: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, text: String(i + 1) })) };
  const slot = { slot: "first", bookId: "gen", refs: [{ chapter: 1, verseSpec: "1-3" }, { chapter: 1, verseSpec: "2-5" }, { chapter: 9, verseSpec: "all" }], label: "" };
  const runs = ctx.slotVerseRuns(slot, (n) => (n === 1 ? ch : null));
  same(runs.map((r) => [r.chapter, r.data ? "ok" : null, r.verses.map((v) => v.text)]), [[1, "ok", ["1", "2", "3"]], [1, "ok", ["4", "5"]], [9, null, []]]);
});

test("wantsGloria: 전례시편은 장을 불러왔으면 언제나, 송가는 gloria:false 가 아닐 때, 다른 슬롯 · 일반 성서 · 불러오지 못한 장은 아니다", () => {
  const psalm = slot("psalm", "lps", 23, "all", "시편 23");
  assert.strictEqual(ctx.wantsGloria(psalm, CHAPTER), true);
  const cant = slot("psalm", "cant", 11, "all", "루가 1:68-79(즈가리야 송가)");
  assert.strictEqual(ctx.wantsGloria(cant, { book_id: "cant", chapter: 11, verses: [] }), true);
  assert.strictEqual(ctx.wantsGloria(cant, { book_id: "cant", chapter: 3, gloria: false, verses: [] }), false);
  assert.strictEqual(ctx.wantsGloria(cant, null), false);   // 장을 못 불러오면 붙이지 않는다
  assert.strictEqual(ctx.wantsGloria(psalm, null), false);  // 전례시편도 — 「불러오지 못했습니다」 뒤에 영광송만 남지 않게(Copilot 3회차)
  assert.strictEqual(ctx.wantsGloria(slot("psalm", "dan", 3, "all", "다니 3"), CHAPTER), false);
  assert.strictEqual(ctx.wantsGloria(slot("first", "lps", 23, "all", "시편 23"), CHAPTER), false);
});

test("canticleTitleOf: 장 제목의 한국어 부분만", () => {
  assert.strictEqual(ctx.canticleTitleOf({ chapter_title: "즈가리야 송가 Benedictus Dominus Deus" }), "즈가리야 송가");
  assert.strictEqual(ctx.canticleTitleOf({ chapter_title: "창조송가 Benedicite, omnia opera Domini" }), "창조송가");
  assert.strictEqual(ctx.canticleTitleOf(null), "");
});

// ── buildLectionaryModel ──────────────────────────────────────────────────────

/** 사계재 날(2026-09-16 같은 날) — 지정 전례일인 성인(공통만) · 사계재(세트 둘) · 격자(그 평일의 독서). */
function emberDay() {
  const saint = cand(obs("d0916-니니안", "니니안(갈로웨이의 주교)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "missionary", has_proper: false }));
  const ember = cand(obs("t-추계재", "추계재", { rank: "feria", precedence: 8, color: "violet", penitential: true, type: "fast" }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, ember, grid], saint, {
    coord: { season: "ordinary", week: 24, type: "weekday", weekday: "wed", year: "II" }, color: "white", colors: ["violet", "white"],
  });
  const groupsOf = groupsOfFrom({
    "d0916-니니안": [1, 2, 3].map((n) => group(`common:missionary-s${n}`, FOUR, { common: "missionary", title: "선교사", set_no: n, set_total: 3 })),
    "t-추계재": [group("ember-s1", FOUR, { set_no: 1, set_total: 2 }), group("ember-s2", FOUR, { set_no: 2, set_total: 2 })],
    "grid:ordinary-24-weekday-wed": [group("grid-s1", FOUR)],
  });
  const entries = [
    { candidate: saint, collects: [collect("common:missionary-c1", "선교사 공통", { common: "missionary" })] },
    { candidate: ember, collects: [collect(231, "성직자의 성소", { ending: "C" })] },
    { candidate: grid, collects: [collect(114, "연중 24주간")] },
  ];
  return { r, groupsOf, entries, saint, ember, grid };
}

test("buildLectionaryModel: 사계재 날 — 초기 선택은 격자, 색은 병기, 칩 셋, 본기도는 고른 격자의 것만", () => {
  const { r, groupsOf, entries, grid } = emberDay();
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, grid);
  assert.strictEqual(m.initial, grid);
  same(plain(m.colors), ["violet", "white"]);
  assert.strictEqual(m.ownColor, false);
  same(m.chips.map((c) => [c.label, c.active]),
    [["니니안", false], ["추계재", false], ["연중 24주 수요일 (짝수해)", true]]);
  same(m.collects.map((o) => o.id), [114]);   // 고른 전례일(격자)의 본기도만
  assert.strictEqual(m.ending, "A");
  assert.strictEqual(m.options.length, 1);
  assert.strictEqual(m.group.id, "grid-s1");
  same(m.slots.map((s) => s.slot), ["first", "psalm", "second", "gospel"]);
  assert.strictEqual(m.pair, null);
  assert.strictEqual(m.fast, "minor");   // 사계재일 — 소재일
  assert.strictEqual(m.cycle, "짝수해");
  assert.strictEqual(m.hrefs.prev, "/lectionary/2026-09-15");
  assert.strictEqual(m.hrefs.next, "/lectionary/2026-09-17");
  // 초기 선택(격자)의 href 는 쿼리가 없고, 성인 칩은 obs 를 싣는다.
  assert.strictEqual(m.chips[2].href, "/lectionary/2026-09-16");
  assert.strictEqual(m.chips[0].href, "/lectionary/2026-09-16?obs=d0916-%EB%8B%88%EB%8B%88%EC%95%88");
});

test("buildLectionaryModel: 전날 · 다음날 링크는 교회력을 계산하는 연도(1583~9999) 안에서만 — 끝에서는 null(단추가 자리만 남는다)", () => {
  // 범위 끝에서 누르면 「계산할 수 없는 날짜」 화면이었다 — 캘린더의 이전 · 다음 달처럼 단추를 두지 않으면, 다시 그린 뒤
  // 포커스가 「오늘」로 간다(같은 자리가 없을 때의 대체 — 단추의 data-focus-fallback, 라우터가 돌려준다)
  const day = (date) => {
    const g = cand(obs("grid:christmas-x-weekday-mon", "성탄 월요일"));
    return ctx.buildLectionaryModel(resolvedOf(date, [g], g), { obs: null, track: null, set: null, collect: null },
      groupsOfFrom({ [g.observance.id]: [group("g1", FOUR)] }), [], null);
  };
  const first = day("1583-01-01");
  assert.strictEqual(first.hrefs.prev, null);
  assert.strictEqual(first.hrefs.next, "/lectionary/1583-01-02");
  const last = day("9999-12-31");
  assert.strictEqual(last.hrefs.prev, "/lectionary/9999-12-30");
  assert.strictEqual(last.hrefs.next, null);
  assert.strictEqual(day("2026-12-31").hrefs.next, "/lectionary/2027-01-01");   // 해 넘김은 그대로
});

test("buildLectionaryModel: 추계재를 고르면 색은 자 하나, 「독서 1 · 2」 선택지, 본기도는 추계재 것만, 송영은 그 본기도의 코드", () => {
  const { r, groupsOf, entries, ember } = emberDay();
  const m = ctx.buildLectionaryModel(r, { obs: "t-추계재", track: null, set: 2, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, ember);
  same(plain(m.colors), ["violet"]);
  assert.strictEqual(m.ownColor, true);
  same(m.options.map((o) => o.label), ["독서 1", "독서 2"]);
  assert.strictEqual(m.setIndex, 1);
  assert.strictEqual(m.group.id, "ember-s2");
  assert.strictEqual(m.shortGroup, null);
  same(m.collects.map((o) => o.id), [231]);   // 추계재(성직자의 성소) 본기도만
  assert.strictEqual(m.ending, "C");   // 그 본기도의 송영 코드
  same(plain(m.hrefs.options), ["/lectionary/2026-09-16?obs=t-%EC%B6%94%EA%B3%84%EC%9E%AC", "/lectionary/2026-09-16?obs=t-%EC%B6%94%EA%B3%84%EC%9E%AC&set=2"]);
});

test("buildLectionaryModel: 본기도 없는 전례일을 고르면 collects 가 비고 송영은 A(기본) — 독서가 있으면 empty 는 아니다", () => {
  const { r, groupsOf, ember } = emberDay();
  const entries = [{ candidate: ember, collects: [] }];
  const m = ctx.buildLectionaryModel(r, { obs: "t-추계재", track: null, set: null, collect: null }, groupsOf, entries, null);
  same(m.collects, []);
  assert.strictEqual(m.ending, "A");
  assert.strictEqual(m.empty, false);
});

test("buildLectionaryModel: 기념일 칩을 고르면 empty — 본문도 본기도도 없다", () => {
  const feast = cand(obs("d0101-거룩한-이름-예수", "거룩한 이름 예수", { rank: "major_feast", precedence: 3, color: "white" }));
  const memo = cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration", precedence: 7 }));
  const grid = cand(obs("grid:christmas-x-weekday-thu", "성탄 목요일", { color: "white" }));
  const r = resolvedOf("2026-01-01", [feast, memo, grid], feast, { coord: { season: "christmas", week: null, type: "weekday", weekday: "thu", year: "A" }, color: "white", colors: ["white"] });
  const groupsOf = groupsOfFrom({ "d0101-거룩한-이름-예수": [group("f", FOUR)] });
  const entries = [{ candidate: feast, collects: [collect(285, "…")] }, { candidate: memo, collects: [] }, { candidate: grid, collects: [] }];
  const m = ctx.buildLectionaryModel(r, { obs: "d0101-세계평화", track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, memo);
  assert.strictEqual(m.empty, true);
  assert.strictEqual(m.group, null);
  same(m.chips.map((c) => c.muted), [false, true, false]);
  const m0 = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m0.empty, false);
  assert.strictEqual(m0.selected, feast);
});

test("buildLectionaryModel: 트랙 — 기억(마지막 선택)이 기본, URL 이 앞서고, href 는 칩 · 카드까지 트랙을 언제나 적는다(기억과 무관한 주소 — 자체 리뷰 2026-10-13 · 머지 전 검토 2026-10-14)", () => {
  const sunday = cand(obs("grid:ordinary-11-sunday", "연중 11주일", { rank: "sunday", precedence: 5, color: "green" }));
  const r = resolvedOf("2026-06-14", [sunday], sunday, { coord: { season: "ordinary", week: 11, type: "sunday", weekday: null, year: "A" } });
  const groupsOf = groupsOfFrom({ "grid:ordinary-11-sunday": TRACKED });
  const entries = [{ candidate: sunday, collects: [collect(59, "…")] }];
  const remembered = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, 2);
  assert.strictEqual(remembered.track, 2);
  // 괄호 세트가 바탕에 합쳐져 선택지는 하나 — 긴 본문(t2s2)을 싣고 짧은 바탕(t2s1)은 〔 〕 기준.
  assert.strictEqual(remembered.options.length, 1);
  assert.strictEqual(remembered.group.id, "t2s2");
  assert.strictEqual(remembered.shortGroup.id, "t2s1");
  assert.strictEqual(remembered.chips[0].label, "연중 11주일 (가해, 독서 2)");
  assert.strictEqual(remembered.chips[0].href, "/lectionary/2026-06-14?track=2");   // 칩도 그 트랙을 적는다
  same(plain(remembered.hrefs.tracks), [
    { track: 1, href: "/lectionary/2026-06-14?track=1", active: false },
    { track: 2, href: "/lectionary/2026-06-14?track=2", active: true },
  ]);
  // 트랙을 바꿔도 본기도 선택(collect=2)은 남고, 세트는 그 트랙의 첫 세트로 돌아간다(Copilot 1회차).
  const withCollect = ctx.buildLectionaryModel(r, { obs: null, track: 2, set: null, collect: 2 }, groupsOf, [{ candidate: sunday, collects: [collect(59, "…", { collect_no: 1, collect_total: 2 }), collect(60, "…", { collect_no: 2, collect_total: 2 })] }], 2);
  same(plain(withCollect.hrefs.tracks.map((t) => t.href)), ["/lectionary/2026-06-14?track=1&collect=2", "/lectionary/2026-06-14?track=2&collect=2"]);
  const overridden = ctx.buildLectionaryModel(r, { obs: null, track: 1, set: 2, collect: null }, groupsOf, entries, 2);
  assert.strictEqual(overridden.track, 1);
  assert.strictEqual(overridden.options.length, 1);   // ?set=2 는 범위 밖 → 첫(유일한) 선택지
  assert.strictEqual(overridden.group.id, "t1s2");
  assert.strictEqual(overridden.shortGroup.id, "t1s1");
  same(plain(overridden.hrefs.options), ["/lectionary/2026-06-14?track=1"]);
  assert.strictEqual(overridden.tracks.length, 2);
  // 공유받은 「독서 1」 주소(기억은 2)에서 지금 칩을 눌러도 독서 1 — 칩 링크가 기억이 아니라 화면의 트랙을 적는다.
  assert.strictEqual(overridden.chips[0].href, "/lectionary/2026-06-14?track=1");
});

test("buildLectionaryModel: 본기도 대체안 — ?collect 는 목록 위치, href 와 송영이 따라간다", () => {
  const easter = cand(obs("t-부활대축일", "부활대축일", { rank: "principal", precedence: 1, color: "white" }));
  const r = resolvedOf("2026-04-05", [easter], easter, { coord: { season: "easter", week: 1, type: "sunday", weekday: null, year: "A" }, color: "white", colors: ["white"] });
  const groupsOf = groupsOfFrom({ "t-부활대축일": [group("e1", FOUR, { set_no: 1, set_total: 2, set_note: "원본 세트 1" }), group("e2", FOUR, { set_no: 2, set_total: 2, set_note: "원본 세트 2" })] });
  const entries = [{ candidate: easter, collects: [collect(222, "a", { collect_no: 1, collect_total: 3 }), collect(223, "b", { collect_no: 2, collect_total: 3 }), collect(224, "c", { collect_no: 3, collect_total: 3, ending: "C" })] }];
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: 3 }, groupsOf, entries, null);
  assert.strictEqual(m.collectIndex, 2);
  assert.strictEqual(m.ending, "C");
  same(m.options.map((o) => o.label), ["독서 1", "독서 2"]);   // 원본 세트 둘 — 완전한 세트를 통째로 고른다
  // 본기도 선택은 독립 축 — 세트를 바꿔도 collect=3 이 남는다(Copilot 1회차).
  same(plain(m.hrefs.options), ["/lectionary/2026-04-05?collect=3", "/lectionary/2026-04-05?set=2&collect=3"]);
  same(plain(m.hrefs.collects), ["/lectionary/2026-04-05", "/lectionary/2026-04-05?collect=2", "/lectionary/2026-04-05?collect=3"]);
  assert.strictEqual(m.fast, null);
});

test("buildLectionaryModel: 후보가 없으면 null", () => {
  const r = resolvedOf("2026-08-13", [], null);
  assert.strictEqual(ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, () => [], [], null), null);
});

test("칩: 라벨은 괄호를 뗀 짧은 이름, title 은 전체 이름 + 상태 꼬리(ADR-038 §3-1 — 사용자 확정 2026-10-12)", () => {
  const saint = cand(obs("d0321-토마스-크랜머", "토마스 크랜머(캔터베리 대주교, 전례개혁자, 순교자, 1556년)", { rank: "minor_feast", precedence: 7 }));
  const grid = cand(obs("grid:lent-4-weekday-sat", "사순 4주 토요일"));
  const r = resolvedOf("2026-03-21", [saint, grid], saint, { coord: { season: "lent", week: 4, type: "weekday", weekday: "sat", year: "II" } });
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOfFrom({ "d0321-토마스-크랜머": [group(1, FOUR)] }), [], null);
  const chip = m.chips.find((c) => c.candidate === saint);
  assert.ok(chip.label.startsWith("토마스 크랜머") && !chip.label.includes("("), chip.label);
  assert.strictEqual(chip.title, "토마스 크랜머(캔터베리 대주교, 전례개혁자, 순교자, 1556년)");
});

test("상수: 송영 셋 · 영광송 계응 둘 · 슬롯 순서 넷 · 선택 봉헌 목적지 넷(엔진 OPTIONAL_KINDS 와 같다) · 괄호 세트 표지", () => {
  const endings = K("ENDINGS");
  same(Object.keys(plain(endings)), ["A", "B", "C"]);
  assert.ok(endings.A.endsWith("아멘") && endings.C.startsWith("성자께서는"));
  same(plain(K("GLORIA")), { versicle: "영광이 성부와 성자와 성령께", response: "처음과 같이 지금도 그리고 영원히, 아멘." });
  same(plain(K("SLOT_ORDER")), ["first", "psalm", "second", "gospel"]);
  same(plain(K("OPTIONAL_TRANSFER_KINDS")).sort(), [...K("OPTIONAL_KINDS")].sort());   // 엔진의 넷과 같다 — 한쪽만 바뀌면 깨진다
  assert.strictEqual(K("BRACKET_NOTE"), "괄호 선택 구절 포함");
});

// ── 반절(상 · 하) — 경계 표의 행을 그 절의 줄에 적용한다(사용자 결정 2026-10-22, 데이터 liturgical/half-verses.md) ──

test("halfVerseLines: 줄 경계 — 상은 처음부터 그 줄까지, 하는 그 줄부터 끝까지", () => {
  // 집회 51:20상 — 네 줄 가운데 앞의 두 줄(게시글 20007)
  same(plain(ctx.halfVerseLines(4, { half: "a", line: 2, text: null })), { first: 0, last: 1, cut: null, text: null });
  // 토비 13:6하 — 열다섯 줄 가운데 다섯째 줄부터
  same(plain(ctx.halfVerseLines(15, { half: "b", line: 5, text: null })), { first: 4, last: 14, cut: null, text: null });
});

test("halfVerseLines: 줄 안의 경계 — 한 줄 절도 문구에서 나눈다", () => {
  same(plain(ctx.halfVerseLines(1, { half: "a", line: 1, text: "길을 떠났다." })), { first: 0, last: 0, cut: 0, text: "길을 떠났다." });
  same(plain(ctx.halfVerseLines(1, { half: "b", line: 1, text: "하느님과 화해하십시오." })), { first: 0, last: 0, cut: 0, text: "하느님과 화해하십시오." });
  same(plain(ctx.halfVerseLines(3, { half: "b", line: 2, text: "그러나" })), { first: 1, last: 2, cut: 1, text: "그러나" });
});

test("halfVerseLines: 나누지 않는 경우는 null — 절 전체를 그린다", () => {
  assert.strictEqual(ctx.halfVerseLines(2, null), null);                                   // 표에 없다
  assert.strictEqual(ctx.halfVerseLines(1, { half: "b", whole: true }), null);             // 「전체」(로마 3:22하)
  assert.strictEqual(ctx.halfVerseLines(2, { half: "a", line: 3, text: null }), null);     // 그려진 줄보다 많다 — 데이터 어긋남
  assert.strictEqual(ctx.halfVerseLines(2, { half: "a", line: 2, text: null }), null);     // 상이 끝 줄까지 — 절 전체
  assert.strictEqual(ctx.halfVerseLines(2, { half: "b", line: 1, text: null }), null);     // 하가 첫 줄부터 — 절 전체
});

test("halfVerseRanges: 하로 자른 절은 구간을 열고, 상으로 자른 절은 구간을 닫는다", () => {
  const H = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  // 성령강림 「시편 104:24-34, 35하」 — 종전 출처는 「24-35」로 35절 전체를 가리켰다
  same(plain(ctx.halfVerseRanges([[24, 35]], H({ 35: "b" }))), [
    { a: 24, b: 34, aHalf: "", bHalf: "" }, { a: 35, b: 35, aHalf: "하", bHalf: "" }]);
  // 「집회 51:12하-20상」 — 한 구간 그대로, 양 끝에 하 · 상
  same(plain(ctx.halfVerseRanges([[12, 20]], H({ 12: "b", 20: "a" }))), [{ a: 12, b: 20, aHalf: "하", bHalf: "상" }]);
  // 「사도 2:14상, 22-32」 · 「여호 24:1-3상, 14-18」
  same(plain(ctx.halfVerseRanges([[14, 14], [22, 32]], H({ 14: "a" }))), [
    { a: 14, b: 14, aHalf: "", bHalf: "상" }, { a: 22, b: 32, aHalf: "", bHalf: "" }]);
  same(plain(ctx.halfVerseRanges([[1, 3], [14, 18]], H({ 3: "a" }))), [
    { a: 1, b: 3, aHalf: "", bHalf: "상" }, { a: 14, b: 18, aHalf: "", bHalf: "" }]);
  // 구간 가운데의 반절 — 상은 그 자리에서 닫고 다음 절부터 새 구간, 하는 앞을 닫고 그 절부터
  same(plain(ctx.halfVerseRanges([[10, 20]], H({ 14: "a" }))), [
    { a: 10, b: 14, aHalf: "", bHalf: "상" }, { a: 15, b: 20, aHalf: "", bHalf: "" }]);
  same(plain(ctx.halfVerseRanges([[10, 20]], H({ 14: "b" }))), [
    { a: 10, b: 13, aHalf: "", bHalf: "" }, { a: 14, b: 20, aHalf: "하", bHalf: "" }]);
  same(plain(ctx.halfVerseRanges([[1, 9]], H({}))), [{ a: 1, b: 9, aHalf: "", bHalf: "" }]);
});
