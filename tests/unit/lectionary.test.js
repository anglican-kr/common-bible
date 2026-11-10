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
import { loadAppHelpers } from "./harness.js";
// 화면 모델이 쓰는 공용 도우미. 손으로 옮긴 사본 대신 진짜 helpers.js의 것을 한 번만 받는다.
const { isFormerNorthChurch } = loadAppHelpers();

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
    isFormerNorthChurch,
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

/** 정의 표의 행 형식으로 만든 전례일. `extra`로 rank · color · transfer_to 등을 더한다. */
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
/** `ResolvedDate` 형식 — 연중 평일(짝수해)이 기본 절기 위치. */
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

test("statusSuffix: 옮김 · 선택 봉헌 · 생략 · 기념일 · 저녁 상태 표시, 기념만 하는 후보는 없음", () => {
  assert.strictEqual(ctx.statusSuffix(cand(obs("d1206-성-니콜라", "성 니콜라(미라의 주교)"), "transferred_in", { from: "2026-12-06" })), " · 12월 6일에서 옮겨 옴");
  // 옮겨 간 후보는 전례독서 목록에 없고(2026-11-04) 이 상태 표시는 캘린더 모델이 쓴다
  assert.strictEqual(ctx.statusSuffix(cand(obs("d1018-루가", "성 루가"), "transferred_out", { to: "2026-10-19" })), " · → 10월 19일");
  assert.strictEqual(ctx.statusSuffix(cand(obs("d0806-주의-변모", "주의 변모"), "optional", { from: "2026-08-06" })), " · 8월 6일에서 옮겨 지킬 수 있음");
  assert.strictEqual(ctx.statusSuffix(cand(obs("d1207-암브로스", "암브로스(주교)"), "omitted")), " · 생략");
  assert.strictEqual(ctx.statusSuffix(cand(obs("d1213-루시아", "루시아(시라쿠스의 순교자, 304년)"), "commemorated")), "");   // 「· 기념만」 문구를 뺐다(사용자 결정 2026-11-04)
  assert.strictEqual(ctx.statusSuffix(cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration" }))), " · 기념일");
  // 저녁 전례(설계서 R-6.1-evening) — 「· 저녁」. 필수 CI 가 이 상태 표시를 지키는 유일한 자리다(실데이터 테스트는 data 워크플로에서만
  // 돈다 — PR #349 리뷰)
  assert.strictEqual(ctx.statusSuffix(cand(obs("t-부활밤", "부활밤", { color: "white" }), "proper", { evening: true })), " · 저녁");
});

test("selectedNoteOf: 고른 전례일의 상태 문장 — 상태 표시가 있는 후보만 문장이 있다(사용자 결정 2026-11-04)", () => {
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("t-부활밤", "부활밤"), "proper", { evening: true })), "저녁 전례");
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("d1206-성-니콜라", "성 니콜라"), "transferred_in", { from: "2026-12-06" })), "12월 6일에서 옮겨 옴");
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("d0806-주의-변모", "주의 변모"), "optional", { from: "2026-08-06" })), "8월 6일에서 옮겨 지킬 수 있음");
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("d0806-주의-변모", "주의 변모"))), null);
  // 기념만 하거나 생략하는 후보는 누를 수 없어 문장이 없다
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("d1213-루시아", "루시아"), "commemorated")), null);
  assert.strictEqual(ctx.selectedNoteOf(cand(obs("d1207-암브로스", "암브로스"), "omitted")), null);
});

test("buildLectionaryModel: 기념만 하거나 생략하는 후보는 전례독서 목록에 없고 이름 줄의 글이다 — 고유 독서가 있어도, 주소로 가리켜도 기본 독서. 지역 축일만 예외로 링크다(사용자 결정 2026-11-04)", () => {
  const NONE = { obs: null, track: null, set: null, collect: null };
  const grid = cand(obs("grid:ordinary-17-sunday", "연중 17주일"));
  const saint = cand(obs("d0726-안나와-요아킴", "안나와 요아킴(성모 마리아의 양친)", { kind: "sanctoral", sanctoral_class: "saint" }), "commemorated");
  const national = cand(obs("d0301-삼일절", "삼일절", { kind: "sanctoral", sanctoral_class: "national" }), "commemorated");
  const lord = cand(obs("d0503-성-십자가-발견", "성 십자가 발견", { kind: "sanctoral", sanctoral_class: "lord" }), "commemorated");
  const dropped = cand(obs("d1207-암브로스", "암브로스(주교)", { kind: "sanctoral", sanctoral_class: "pastor" }), "omitted");
  const kept = cand(obs("d0806-주의-변모", "주의 변모"), "optional", { from: "2026-08-06" });
  const candidates = [saint, national, lord, dropped, kept, grid];
  const table = Object.fromEntries(candidates.map((c) => [c.observance.id, [group(`g-${c.observance.id}`, FOUR)]]));
  const entries = candidates.map((c) => ({ candidate: c, collects: [collect(c.observance.id, "…")] }));
  const r = resolvedOf("2026-07-26", candidates, grid);
  const m = ctx.buildLectionaryModel(r, NONE, groupsOfFrom(table), entries, null);
  // 지역 축일과 옮겨 지킬 수 있는 후보는 링크다
  same(m.choices.map((c) => c.candidate.observance.id), ["d0301-삼일절", "d0806-주의-변모", "grid:ordinary-17-sunday"]);
  same(m.choices.map((c) => c.suffix), ["", " · 8월 6일에서 옮겨 지킬 수 있음", ""]);   // 삼일절에 「· 기념만」을 달지 않는다
  same(m.memorialSaints.map((c) => c.observance.id), ["d0726-안나와-요아킴"]);   // 기리는 성인은 이름 줄의 「이름 축일」
  same(m.passiveDays.map((c) => c.observance.id), ["d0503-성-십자가-발견", "d1207-암브로스"]);   // 그 밖은 이름 줄의 글 — 「성 십자가 발견」, 「암브로스 · 생략」
  for (const c of [saint, lord, dropped]) {
    const pointed = ctx.buildLectionaryModel(r, { ...NONE, obs: c.observance.id }, groupsOfFrom(table), entries, null);
    assert.strictEqual(pointed.selected, grid, c.observance.id);
  }
  const pressed = ctx.buildLectionaryModel(r, { ...NONE, obs: national.observance.id }, groupsOfFrom(table), entries, null);
  assert.strictEqual(pressed.selected, national);
  assert.strictEqual(pressed.selectedNote, null);   // 문장도 달지 않는다
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

test("selectCandidate: `?obs`가 가리키는 후보가 있으면 그것, 없으면 그날 처음 여는 후보", () => {
  const feast = cand(obs("d0806-주의-변모", "주의 변모"));
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일"));
  assert.strictEqual(ctx.selectCandidate([feast, grid], "grid:ordinary-18-weekday-thu", feast), grid);
  assert.strictEqual(ctx.selectCandidate([feast, grid], "no-such-id", feast), feast);
  assert.strictEqual(ctx.selectCandidate([feast, grid], null, feast), feast);
  // 소속교회의 축성일 주소를 그 교회가 없는 사람이 열면 처음 여는 후보다(ADR-041 §6)
  assert.strictEqual(ctx.selectCandidate([feast, grid], "my-dedication", feast), feast);
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
  assert.strictEqual(ctx.setsOf(TRACKED, null).length, 4);   // 트랙 없이 호출하면 전부
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

test("buildLectionaryModel: 대체 독서 표시를 끄면 대축일, 주요축일, 고유 독서가 있는 축일의 평일 줄을 숨긴다(사용자 결정 2026-11-06, ADR-041 §4)", () => {
  const Q = { obs: null, track: null, set: null, collect: null };
  const gridId = "grid:ordinary-13-weekday-mon";
  const rowsOf = (feast, others = []) => {
    const grid = cand(obs(gridId, "연중 13주 월요일", { rank: "feria", precedence: 8, color: "green" }));
    const cs = [feast, ...others, grid];
    const groupsOf = (c) => [group(c.observance.id, FOUR)];
    const r = resolvedOf("2026-06-29", cs, feast);
    const entries = cs.map((c) => ({ candidate: c, collects: [collect(c.observance.id, c.observance.id)] }));
    return (show, query = Q) => ctx.buildLectionaryModel(r, query, groupsOf, entries, null, [], show);
  };
  const names = (m) => m.choices.filter((c) => !c.active).map((c) => c.name);
  const major = cand(obs("d0629-베드로", "사도 성 베드로와 바울로", { rank: "major_feast", precedence: 3, color: "red" }));

  // 제 날짜의 주요축일 — 끄면 평일 줄이 없고, 켜면 있다. 인자를 빠뜨려도 앱의 기본값처럼 숨긴다.
  same(names(rowsOf(major)(false)), []);
  same(names(rowsOf(major)(true)), ["연중 13주 월요일"]);
  same(names(rowsOf(major)()), []);
  // 대축일도 같다
  same(names(rowsOf(cand(obs("t-승천", "승천대축일", { rank: "principal", precedence: 1, color: "white" })))(false)), []);
  // 옮겨 온 날이든 제 날짜든 같다
  same(names(rowsOf(cand(obs("d1102-별세자", "모든 별세자의 날", { rank: "minor_feast", precedence: 7, color: "white" }), "transferred_in", { from: "2026-06-28" }))(false)), []);
  // 고유 독서가 있는 축일도 숨긴다
  same(names(rowsOf(cand(obs("d1208-성모시태", "성모시태", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "lord" })))(false)), []);
  same(names(rowsOf(cand(obs("d0729-마리아", "성 마리아와 마르타", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "saint" })))(false)), []);
  // 삼일절과 명절은 평일 줄이 남는다
  same(names(rowsOf(cand(obs("d0301-삼일절", "삼일절", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "national" })))(false)), ["연중 13주 월요일"]);
  same(names(rowsOf(cand(obs("t-설날", "설날", { rank: "regional_festival", precedence: 7, color: "white" })))(false)), ["연중 13주 월요일"]);
  // 격자가 아닌 줄은 늘 남는다 — 사계재, 옮겨 지킬 수 있는 축일, 저녁 전례
  const ember = cand(obs("t-하계재", "하계재", { rank: "feria", precedence: 8, color: "purple", is_ember: true }));
  const optional = cand(obs("d0806-변모", "주의 변모", { rank: "major_feast", precedence: 3, color: "white" }), "optional", { from: "2026-08-06" });
  const evening = cand(obs("t-부활밤", "부활밤", { rank: "principal", precedence: 1, color: "white" }), "proper", { evening: true });
  same(names(rowsOf(major, [ember, optional, evening])(false)), ["하계재", "주의 변모", "부활밤"]);
  // 설정은 줄만 감춘다 — 주소로 가리키면 그 독서를 보이고, 기본 독서로 돌아가지 않는다(공유한 링크의 본문이 받는 사람의 설정에 따라 바뀌지 않게)
  const byUrl = rowsOf(major)(false, { ...Q, obs: gridId });
  assert.strictEqual(byUrl.selected.observance.id, gridId);
  same(names(byUrl), ["사도 성 베드로와 바울로"]);
});

test("feastPhraseOf · optionalSundayOf: 문장 속 축일 이름과, 옮겨 지킬 수 있는 축일의 주일(사용자 결정 2026-11-06, ADR-041 §4)", () => {
  assert.strictEqual(ctx.feastPhraseOf("주의 봉헌"), "주의 봉헌 축일");
  assert.strictEqual(ctx.feastPhraseOf("성 니콜라(미라의 주교)"), "성 니콜라 축일");
  assert.strictEqual(ctx.feastPhraseOf("승천대축일"), "승천대축일");          // 「대축일 축일」이 되지 않는다
  assert.strictEqual(ctx.feastPhraseOf("모든 성인의 날"), "모든 성인의 날");  // 「날 축일」이 되지 않는다
  assert.strictEqual(ctx.feastPhraseOf("재의 수요일"), "재의 수요일");
  assert.strictEqual(ctx.transferOutNote("모든 별세자의 날", "2025-11-03"), "모든 별세자의 날을 11월 3일로 옮김");

  const presentation = obs("d0202-주의-봉헌", "주의 봉헌", { rank: "major_feast", precedence: 3, transfer_to: "nearby_sunday" });
  // 2027-02-02(화)의 가까운 주일은 1.31이다 — 앞 주일이 더 가깝다
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation), "2027-02-02"), "2027-01-31");
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation), "2026-02-02"), "2026-02-01");   // 월요일은 앞 주일
  // 주일에 온 해는 옮길 주일이 없다
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation), "2025-02-02"), null);
  // 설과 겹쳐 다음날로 옮겨 온 해는 원래 날짜로 구한다(2049-02-02 설날 → 2.3)
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation, "transferred_in", { from: "2049-02-02" }), "2049-02-03"), "2049-01-31");
  // 옮겨 지키기로 해서 주일에 온 축일은 그날이 곧 그 주일이다
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation, "transferred_in", { from: "2027-02-02" }), "2027-01-31"), null);
  // 승천은 부활 7주일, 모든 성인의 날은 10.30-11.5의 주일
  const ascension = obs("t-승천대축일", "승천대축일", { rank: "principal", precedence: 1, transfer_to: "easter7_sunday" });
  assert.strictEqual(ctx.optionalSundayOf(cand(ascension), "2026-05-14"), "2026-05-17");
  const allSaints = obs("d1101-모든-성인의-날", "모든 성인의 날", { rank: "principal", precedence: 1, transfer_to: "sunday_1030_1105" });
  assert.strictEqual(ctx.optionalSundayOf(cand(allSaints), "2027-11-01"), "2027-10-31");
  // 밀려 옮김만 하는 축일, 격자, 그 주일의 「옮겨 지킬 수 있음」 후보는 없다
  assert.strictEqual(ctx.optionalSundayOf(cand(obs("d0629-베드로", "사도 성 베드로와 바울로", { transfer_to: "next_free_day" })), "2026-06-29"), null);
  assert.strictEqual(ctx.optionalSundayOf(cand(obs("grid:ordinary-4-weekday-tue", "연중 4주 화요일", { transfer_to: "nearby_sunday" })), "2027-02-02"), null);
  assert.strictEqual(ctx.optionalSundayOf(cand(presentation, "optional", { from: "2027-02-02" }), "2027-01-31"), null);
});

test("buildLectionaryModel: 옮겨 지킬 수 있는 축일이 평일에 온 날은 대체 독서 표시를 꺼도 평일 줄이 보이고, 줄과 문장이 옮겨 지킬 수 있는 주일을 알린다(사용자 결정 2026-11-06, ADR-041 §4)", () => {
  const Q = { obs: null, track: null, set: null, collect: null };
  const gridId = "grid:ordinary-4-weekday-tue";
  const modelOf = (feast, date, show, query = Q) => {
    const grid = cand(obs(gridId, "연중 4주 화요일", { rank: "feria", precedence: 8, color: "green" }));
    const cs = [feast, grid];
    const groupsOf = (c) => [group(c.observance.id, FOUR)];
    const entries = cs.map((c) => ({ candidate: c, collects: [collect(c.observance.id, c.observance.id)] }));
    return ctx.buildLectionaryModel(resolvedOf(date, cs, feast), query, groupsOf, entries, null, [], show);
  };
  const rows = (m) => m.choices.filter((c) => !c.active).map((c) => c.name + c.suffix);
  const presentation = cand(obs("d0202-주의-봉헌", "주의 봉헌", { rank: "major_feast", precedence: 3, color: "white", transfer_to: "nearby_sunday" }));

  // 끄든 켜든 평일 줄이 보이고 이름 뒤에 「· 주의 봉헌 축일 대체 독서」
  same(rows(modelOf(presentation, "2027-02-02", false)), ["연중 4주 화요일 · 주의 봉헌 축일 대체 독서"]);
  same(rows(modelOf(presentation, "2027-02-02", true)), ["연중 4주 화요일 · 주의 봉헌 축일 대체 독서"]);
  assert.strictEqual(modelOf(presentation, "2027-02-02", false).choices.find((c) => !c.active).title, "연중 4주 화요일 · 주의 봉헌 축일 대체 독서");
  // 축일(기본 독서)의 제목 아래에는 옮겨 지킬 수 있는 주일을 알린다 — 목적지 주일의 「2월 2일에서 옮겨 지킬 수 있음」과 같은 형식이다
  assert.strictEqual(modelOf(presentation, "2027-02-02", false).selectedNote, "1월 31일로 옮겨 지킬 수 있음");
  // 평일 줄을 누르면 제목 아래에 그 독서를 읽는 때를 알리고, 목록의 축일 줄에 상태 표시가 붙는다
  const pressed = modelOf(presentation, "2027-02-02", false, { ...Q, obs: gridId });
  assert.strictEqual(pressed.selected.observance.id, gridId);
  assert.strictEqual(pressed.selectedNote, "주의 봉헌 축일 대체 독서");
  same(rows(pressed), ["주의 봉헌 · 1월 31일로 옮겨 지킬 수 있음"]);
  // 설과 겹쳐 옮겨 온 해는 두 상태를 함께 알린다
  const moved = cand(presentation.observance, "transferred_in", { from: "2049-02-02" });
  assert.strictEqual(modelOf(moved, "2049-02-03", false).selectedNote, "2월 2일에서 옮겨 옴 · 1월 31일로 옮겨 지킬 수 있음");
  same(rows(modelOf(moved, "2049-02-03", false, { ...Q, obs: gridId })), ["주의 봉헌 · 2월 2일에서 옮겨 옴"]);   // 줄에는 하나만(폭 320px에서 두 줄 안)
  // 「대축일」로 끝나는 이름에는 「축일」을 덧붙이지 않는다
  const ascension = cand(obs("t-승천대축일", "승천대축일", { rank: "principal", precedence: 1, color: "white", transfer_to: "easter7_sunday" }));
  same(rows(modelOf(ascension, "2026-05-14", false)), ["연중 4주 화요일 · 승천대축일 대체 독서"]);
  assert.strictEqual(modelOf(ascension, "2026-05-14", false, { ...Q, obs: gridId }).selectedNote, "승천대축일 대체 독서");
  // 주일에 온 해는 옮길 주일이 없어 종전대로 끄면 숨기고, 켜도 꼬리가 없으며 문장도 없다
  same(rows(modelOf(presentation, "2025-02-02", false)), []);
  same(rows(modelOf(presentation, "2025-02-02", true)), ["연중 4주 화요일"]);
  assert.strictEqual(modelOf(presentation, "2025-02-02", true).selectedNote, null);
  same(rows(modelOf(presentation, "2025-02-02", true, { ...Q, obs: gridId })), ["주의 봉헌"]);
});

test("buildLectionaryModel: 기리는 성인의 본기도 — 기본 독서가 평일이면 평일 본기도 다음에 성인 본기도, 송영은 성인 것(사용자 결정 2026-11-03)", () => {
  const saint = cand(obs("d1106-레오나드", "레오나드(은수자, 6세기)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "saint" }));
  const grid = cand(obs("grid:ordinary-31-weekday-fri", "연중 31주 금요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-11-06", [saint, grid], saint);
  const groupsOf = groupsOfFrom({
    "d1106-레오나드": [group("common:saint-s1", FOUR, { common: "saint", title: "성인" })],
    "grid:ordinary-31-weekday-fri": [group("g", FOUR)],
  });
  const entries = [
    { candidate: saint, collects: [collect("common:saint-c1", "주님의 종 레오나드를", { ending: "B" })] },
    { candidate: grid, collects: [collect("g-c", "평일 본기도")] },
  ];
  const q = { obs: null, track: null, set: null, collect: null };
  const m = ctx.buildLectionaryModel(r, q, groupsOf, entries, null);
  assert.strictEqual(m.selected, grid);
  same(m.collects.map((o) => o.id), ["g-c"]);
  same(m.memorialCollects.map((o) => o.id), ["common:saint-c1"]);
  assert.strictEqual(m.ending, "B");   // 송영은 마지막에 오는 성인 본기도의 것
  // 격자 전례독서 목록을 눌러 와도(같은 후보) 같다
  same(ctx.buildLectionaryModel(r, { ...q, obs: grid.observance.id }, groupsOf, entries, null).memorialCollects.map((o) => o.id), ["common:saint-c1"]);
  // 기리는 성인은 전례독서 목록에 없고 머리 제목 아래 이름 줄에 보인다. 주소로 가리켜도 기본 독서다(2026-11-03)
  same(m.choices.map((c) => c.candidate.observance.id), [grid.observance.id]);
  same(m.memorialSaints.map((c) => c.observance.id), ["d1106-레오나드"]);
  const s = ctx.buildLectionaryModel(r, { ...q, obs: saint.observance.id }, groupsOf, entries, null);
  assert.strictEqual(s.selected, grid);
  same(s.memorialCollects.map((o) => o.id), ["common:saint-c1"]);
  // 지정 전례일에 고유 독서가 있으면(기본 독서가 축일) 덧붙이지 않는다
  const proper = groupsOfFrom({ "d1106-레오나드": [group("p", FOUR)], "grid:ordinary-31-weekday-fri": [group("g", FOUR)] });
  same(ctx.buildLectionaryModel(r, q, proper, entries, null).memorialCollects, []);
});

test("buildLectionaryModel: 성인 축일이 둘 이상 — 유형이 다르면 commons.json 의 유형 차례로 잇고 색은 「또는」, 같으면 공통 본기도 하나에 이름을 모은다(사용자 결정 2026-11-03)", () => {
  const saintOf = (id, name, cls, color = "white") => cand(obs(id, name, { rank: "minor_feast", precedence: 7, color, sanctoral_class: cls }));
  const grid = cand(obs("grid:christmas-weekday", "성탄 주간 목요일", { rank: "feria", precedence: 8, color: "white" }));
  const common = (cls, label, names, ending = "A") => ({ id: `common:${cls}-c1`, title: label, collect_no: 1, collect_total: 1,
    text: `${names.join("와 ")}의 본기도`, ending, common: cls, template: `주님의 종 {name}을(를) 기억하며`, names });
  const q = { obs: null, track: null, set: null, collect: null };
  const run = (saints, collectsBy) => {
    const r = resolvedOf("2026-12-31", [...saints, grid], saints[0]);
    const table = { [grid.observance.id]: [group("g", FOUR)] };
    for (const c of saints) table[c.observance.id] = [group(`common:${c.observance.sanctoral_class}-s1`, FOUR, { common: c.observance.sanctoral_class })];
    const entries = [...saints.map((c, i) => ({ candidate: c, collects: [collectsBy[i]] })), { candidate: grid, collects: [collect("g-c", "평일")] }];
    return ctx.buildLectionaryModel(r, q, groupsOfFrom(table), entries, null);
  };
  // 12.31 위클리프(신학자) ∧ 실베스터(성직자, 지정 전례일 아님) — 유형이 다르다: 성직자가 먼저(commons.json 차례). 색이 같아 「또는」은 없다
  const sylv = saintOf("d1231-실베스터", "실베스터(로마의 주교)", "pastor");
  const wyc = saintOf("d1231-위클리프", "위클리프(종교개혁자)", "teacher");
  const m1 = run([wyc, sylv], [common("teacher", "신학자", ["위클리프"], "C"), common("pastor", "성직자", ["실베스터"], "B")]);
  same(m1.memorialCollects.map((o) => o.id), ["common:pastor-c1", "common:teacher-c1"]);
  same(m1.memorialSaints.map((c) => c.observance.id), ["d1231-실베스터", "d1231-위클리프"]);   // 이름 줄도 같은 차례
  same(m1.choices.map((c) => c.candidate.observance.id), [grid.observance.id]);
  assert.strictEqual(m1.ending, "C");   // 송영은 마지막(신학자) 본기도의 것
  assert.strictEqual(m1.colorsOr, false);
  // 2.14 순교자(적색)는 맨 앞 — 선교사(백색)는 그 뒤, 색은 같은 차례로 「적색 또는 백색」
  const val = saintOf("d0214-발렌틴", "발렌틴", "martyr", "red");
  const cyr = saintOf("d0214-키릴과-메토디우스", "키릴과 메토디우스", "missionary");
  const m2 = run([cyr, val], [common("missionary", "선교사", ["키릴", "메토디우스"]), common("martyr", "순교자", ["발렌틴"])]);
  same(m2.memorialCollects.map((o) => o.id), ["common:martyr-c1", "common:missionary-c1"]);
  same(m2.colors, ["red", "white"]);
  assert.strictEqual(m2.colorsOr, true);
  same(m2.colorAlt, []);
  // 감춘 성인(공통 독서만)을 주소로 가리켜도 기본 독서 — 색도 「또는」 그대로
  const r2 = resolvedOf("2026-02-14", [cyr, val, grid], cyr, { color: "white", colors: ["white"] });
  const groups2 = groupsOfFrom({ [grid.observance.id]: [group("g", FOUR)], [cyr.observance.id]: [group("c", FOUR, { common: "missionary" })],
    [val.observance.id]: [group("v", FOUR, { common: "martyr" })] });
  const entries2 = [{ candidate: cyr, collects: [common("missionary", "선교사", ["키릴", "메토디우스"])] },
    { candidate: val, collects: [common("martyr", "순교자", ["발렌틴"])] }, { candidate: grid, collects: [collect("g-c", "평일")] }];
  const pick = ctx.buildLectionaryModel(r2, { ...q, obs: val.observance.id }, groups2, entries2, null);
  assert.strictEqual(pick.selected, grid);
  assert.strictEqual(pick.colorsOr, true);
  same(pick.colors, ["red", "white"]);
  // 같은 유형(순교자 둘) — 공통 본기도 하나에 이름을 모으고 조사는 마지막 이름의 받침으로
  const a = saintOf("d0101-가", "가브리엘", "martyr");
  const b = saintOf("d0101-나", "바실", "martyr");
  const m3 = run([a, b], [common("martyr", "순교자", ["가브리엘"]), common("martyr", "순교자", ["바실"])]);
  assert.strictEqual(m3.memorialCollects.length, 1);
  assert.strictEqual(m3.memorialCollects[0].text, "주님의 종 가브리엘과 바실을 기억하며");
  same(m3.memorialSaints.map((c) => c.observance.id), ["d0101-가", "d0101-나"]);   // 본기도는 하나여도 이름은 한 줄씩
});

test("buildLectionaryModel: 주일에 밀려서 기념만 하는 축일 — 이름 줄에만 보이고 성인 본기도는 잇지 않으며, 색은 주일 그대로(사용자 결정 2026-11-03, 본기도는 사용자 확인 2026-11-04)", () => {
  const sunday = cand(obs("grid:ordinary-17-sunday", "연중 17주일", { rank: "sunday", precedence: 6, color: "green" }));
  const anna = cand(obs("d0726-안나와-요아킴", "안나와 요아킴", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "saint" }), "commemorated");
  const samil = cand(obs("d0301-삼일절", "삼일절", { rank: "minor_feast", precedence: 7, color: "red", sanctoral_class: "national" }), "commemorated");   // 성인이 아니다
  const r = resolvedOf("2026-07-26", [sunday, anna, samil], sunday, { color: "green", colors: ["green"] });
  const groupsOf = groupsOfFrom({ [sunday.observance.id]: [group("s", FOUR)] });
  const entries = [{ candidate: sunday, collects: [collect("s-c", "주일")] },
    { candidate: anna, collects: [collect("common:saint-c1", "안나와 요아킴의 모범을", { common: "saint", ending: "B" })] },
    { candidate: samil, collects: [collect("samil-c", "삼일절", { ending: "C" })] }];
  const q = { obs: null, track: null, set: null, collect: null };
  const m = ctx.buildLectionaryModel(r, q, groupsOf, entries, null);
  assert.strictEqual(m.selected, sunday);
  same(m.memorialCollects, []);   // 주일에는 성인 본기도를 잇지 않는다(삼일절은 성인이 아니라 어느 날이든 잇지 않는다)
  same(m.memorialSaints.map((c) => c.observance.id), ["d0726-안나와-요아킴"]);
  same(m.choices.map((c) => c.candidate.observance.id), ["grid:ordinary-17-sunday", "d0301-삼일절"]);   // 기념만 하는 성인은 목록에 없고, 지역 축일은 있다(2026-11-04)
  same(m.passiveDays, []);
  // 삼일절을 눌러도 이름 줄은 그대로, 성인 본기도는 기본 독서에서만
  const other = ctx.buildLectionaryModel(r, { ...q, obs: samil.observance.id }, groupsOf, entries, null);
  assert.strictEqual(other.selected, samil);
  same(other.memorialSaints.map((c) => c.observance.id), ["d0726-안나와-요아킴"]);
  same(other.memorialCollects, []);
  // 고유 독서가 있어도 기념만 하는 성인은 이름 줄뿐이다(사용자 결정 2026-11-04 — 그전엔 그 독서를 고르게 칩을 남겼다)
  const withProper = groupsOfFrom({ [sunday.observance.id]: [group("s", FOUR)], [anna.observance.id]: [group("a", FOUR)] });
  const kept = ctx.buildLectionaryModel(r, q, withProper, entries, null);
  same(kept.choices.map((c) => c.candidate.observance.id), ["grid:ordinary-17-sunday", "d0301-삼일절"]);
  same(kept.memorialSaints.map((c) => c.observance.id), ["d0726-안나와-요아킴"]);
  const annaPointed = ctx.buildLectionaryModel(r, { ...q, obs: anna.observance.id }, withProper, entries, null);
  assert.strictEqual(annaPointed.selected, sunday);
  assert.strictEqual(m.ending, "A");   // 송영은 주일 본기도의 것
  same(m.colors, ["green"]);
  assert.strictEqual(m.colorsOr, false);
});

test("buildLectionaryModel: 평일에 밀려서 기념만 하는 축일 — 기본 독서의 본기도 뒤에 성인 본기도를 잇는다. 주일만 잇지 않는다(사용자 확인 2026-11-04)", () => {
  // 12.28 이 주일이라 죄 없는 어린이들이 12.29(화)로 옮겨 오고, 그날의 토마스 베켓은 기념만 한다
  const innocents = cand(obs("d1228-죄-없는-어린이들", "죄 없는 어린이들의 순교", { rank: "feast", precedence: 6, color: "red" }), "transferred_in", { from: "2026-12-28" });
  const becket = cand(obs("d1229-토마스-베켓", "토마스 베켓", { rank: "minor_feast", precedence: 7, color: "red", sanctoral_class: "martyr" }), "commemorated");
  const grid = cand(obs("grid:christmas-x-weekday-tue", "성탄 8일 화요일", { rank: "feria", precedence: 8, color: "white" }));
  const coord = { season: "christmas", week: null, type: "weekday", weekday: "tue", year: "A" };
  const groupsOf = groupsOfFrom({ [innocents.observance.id]: [group("i", FOUR)], [grid.observance.id]: [group("g", FOUR)] });
  const entries = [{ candidate: innocents, collects: [collect("i-c", "죄 없는 어린이들")] },
    { candidate: becket, collects: [collect("common:martyr-c1", "토마스 베켓을", { common: "martyr", ending: "B" })] },
    { candidate: grid, collects: [collect("g-c", "평일")] }];
  const q = { obs: null, track: null, set: null, collect: null };
  const on = (date) => ctx.buildLectionaryModel(resolvedOf(date, [innocents, becket, grid], innocents, { coord, color: "red", colors: ["red"] }), q, groupsOf, entries, null);
  const tue = on("2026-12-29");
  same(tue.memorialCollects.map((o) => o.id), ["common:martyr-c1"]);
  assert.strictEqual(tue.ending, "B");   // 송영은 마지막에 오는 성인 본기도의 것
  // 같은 후보가 주일에 오면 잇지 않는다 — 이름 줄은 그대로
  const sun = on("2025-12-28");
  same(sun.memorialCollects, []);
  same(sun.memorialSaints.map((c) => c.observance.id), ["d1229-토마스-베켓"]);
  assert.strictEqual(sun.ending, "A");
});

test("buildLectionaryModel: 세례명 성인의 축일 — 공통 독서만 있어 감추던 성인의 이름 줄이 그 사람에게만 누를 수 있는 목록의 줄(`?obs=my-saint`)로 옮겨 간다(ADR-041 §5, §8, 사용자 결정 2026-11-10)", () => {
  const saint = cand(obs("d1106-레오나드", "레오나드(은수자, 6세기)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "monastic" }));
  const grid = cand(obs("grid:ordinary-31-weekday-fri", "연중 31주 금요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-11-06", [saint, grid], saint);
  const groupsOf = groupsOfFrom({
    "d1106-레오나드": [group("common:monastic-s1", FOUR, { common: "monastic" })],
    "grid:ordinary-31-weekday-fri": [group("g", FOUR)],
  });
  const entries = [
    { candidate: saint, collects: [collect("common:monastic-c1", "주님의 종 레오나드를", { common: "monastic", ending: "B" })] },
    { candidate: grid, collects: [collect("g-c", "평일 본기도")] },
  ];
  const q = { obs: null, track: null, set: null, collect: null };
  const build = (query, feasts) => ctx.buildLectionaryModel(r, query, groupsOf, entries, null, [], false, [], null, feasts);
  const mine = new Set(["d1106-레오나드"]);

  // 고르지 않은 사람은 전과 같다 — 목록에 없고 이름 줄에 있다
  const none = build(q, new Set());
  same(none.choices.map((c) => c.candidate.observance.id), [grid.observance.id]);
  same(none.memorialSaints.map((c) => c.observance.id), ["d1106-레오나드"]);
  assert.strictEqual(none.mySaint, null);
  // 고른 사람에게는 이름 줄과 같은 글(「레오나드(은수자, 6세기) 축일」)이 목록의 줄이 되고 주소는 고정된 값이다. 긴 이름이 링크이고 「축일」은 꼬리 글이다.
  // 이름 줄에서는 빠지고, 평일 본기도 뒤에 잇는 성인 본기도는 그대로다
  const m = build(q, mine);
  assert.strictEqual(m.selected, grid);
  assert.strictEqual(m.mySaint, saint);
  same(m.choices.map((c) => c.candidate.observance.id), [saint.observance.id, grid.observance.id]);
  const row = m.choices.find((c) => c.candidate === saint);
  same([row.name, row.suffix], ["레오나드(은수자, 6세기)", " 축일"]);
  same(ctx.headLinesOf(m).others, ctx.headLinesOf(none).names.filter((l) => l.startsWith("레오나드")));   // 다른 사람이 보는 글과 같다
  assert.match(row.href, /[?&]obs=my-saint(&|$)/);
  assert.doesNotMatch(row.href, /레오나드/);
  same(m.memorialSaints, []);
  same(m.memorialCollects.map((o) => o.id), ["common:monastic-c1"]);
  // 그 줄을 누르면 성인의 공통 독서와 본기도다. 기리는 성인의 본기도는 잇지 않고, 이 화면의 주소들도 고정된 값을 쓴다
  const s = build({ ...q, obs: "my-saint" }, mine);
  assert.strictEqual(s.selected, saint);
  assert.strictEqual(s.dayName, "레오나드(은수자, 6세기)");
  same(s.collects.map((o) => o.id), ["common:monastic-c1"]);
  same(s.memorialCollects, []);
  same(s.memorialSaints, []);
  assert.ok(s.hrefs.collects.every((h) => /[?&]obs=my-saint(&|$)/.test(h)), s.hrefs.collects.join());
  assert.doesNotMatch(s.choices.find((c) => c.candidate === grid).href, /obs=/);   // 기본 독서는 날짜뿐이다
  // 성인의 전례일 id로 가리키면 다른 사람에게처럼 기본 독서다. 같은 주소가 받는 사람의 설정에 따라 다른 본문이 되지 않는다(PR #545 리뷰)
  assert.strictEqual(build({ ...q, obs: saint.observance.id }, mine).selected, grid);
  // 세례명 줄의 화면만 문서 제목에서 이름을 감춘다(ADR-041 §8)
  same([m.privateSelection, s.privateSelection], [false, true]);
  // 세례명이 다른 사람이나 고르지 않은 사람이 이 주소를 열면 기본 독서다
  assert.strictEqual(build({ ...q, obs: "my-saint" }, new Set(["d0101-다른-성인"])).selected, grid);
  assert.strictEqual(build({ ...q, obs: "my-saint" }, new Set()).selected, grid);
});

test("buildLectionaryModel: 세례명 성인이 주일과 겹쳐 기념만 하는 날에도 줄이 있고, 누구에게나 보이거나 생략된 축일은 그대로다(ADR-041 §5)", () => {
  const q = { obs: null, track: null, set: null, collect: null };
  const anna = (status) => cand(obs("d0726-안나와-요아킴", "안나와 요아킴(성모 마리아의 양친)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "saint" }), status);
  const groupsOf = groupsOfFrom({ "grid:ordinary-17-sunday": [group("s", FOUR)], "grid:ordinary-17-weekday-sat": [group("w", FOUR)], "d0726-안나와-요아킴": [group("a", FOUR)] });
  const mine = new Set(["d0726-안나와-요아킴"]);
  const entriesOf = (a, day) => [{ candidate: day, collects: [collect("d-c", "그날")] },
    { candidate: a, collects: [collect("a-c", "안나와 요아킴의 모범을", { ending: "B" })] }];

  // 주일(2026-07-26): 고유 독서가 있어도 기념만 하는 성인은 이름 줄뿐이었다. 고른 사람에게는 줄이 생기고 이름 줄에서 빠진다
  const sunday = cand(obs("grid:ordinary-17-sunday", "연중 17주일", { rank: "sunday", precedence: 6, color: "green" }));
  const a1 = anna("commemorated");
  const r1 = resolvedOf("2026-07-26", [sunday, a1], sunday);
  const m1 = ctx.buildLectionaryModel(r1, q, groupsOf, entriesOf(a1, sunday), null, [], false, [], null, mine);
  same(m1.choices.map((c) => c.candidate.observance.id), ["grid:ordinary-17-sunday", "d0726-안나와-요아킴"]);
  same(ctx.headLinesOf(m1).others, ["안나와 요아킴(성모 마리아의 양친) 축일"]);
  same(m1.memorialSaints, []);
  const s1 = ctx.buildLectionaryModel(r1, { ...q, obs: "my-saint" }, groupsOf, entriesOf(a1, sunday), null, [], false, [], null, mine);
  assert.strictEqual(s1.selected, a1);
  same(s1.groups.map((g) => g.id), ["a"]);

  // 평일(2025-07-26 토): 고유 독서가 있는 축일은 처음부터 제목이다. 세례명 줄을 따로 만들지 않는다
  const sat = cand(obs("grid:ordinary-17-weekday-sat", "연중 16주 토요일", { rank: "feria", precedence: 8, color: "green" }));
  const a2 = anna("proper");
  const r2 = resolvedOf("2025-07-26", [a2, sat], a2);
  const m2 = ctx.buildLectionaryModel(r2, q, groupsOf, entriesOf(a2, sat), null, [], false, [], null, mine);
  assert.strictEqual(m2.selected, a2);
  assert.strictEqual(m2.mySaint, null);

  // 고유 독서가 있는 사도 축일이 주일에 기념만 하는 날은 이름 줄에 이름만 보이므로, 세례명 줄도 이름뿐이다. 지금 성인 표에는 이런 축일이
  // 없어(사건 축일은 세례명 축일이 아니다, data#71) 2027-08-01 사도 성 베드로의 탈옥으로 만든 가상의 경우다
  const peter = cand(obs("d0801-사도-성-베드로의-탈옥", "사도 성 베드로의 탈옥", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "apostle" }), "commemorated");
  const groupsP = groupsOfFrom({ "grid:ordinary-17-sunday": [group("s", FOUR)], "d0801-사도-성-베드로의-탈옥": [group("p", FOUR)] });
  const entriesP = [{ candidate: sunday, collects: [collect("d-c", "그날")] }, { candidate: peter, collects: [collect("p-c", "사도 베드로를")] }];
  const rP = resolvedOf("2027-08-01", [sunday, peter], sunday);
  const noneP = ctx.buildLectionaryModel(rP, q, groupsP, entriesP, null, [], false, [], null, new Set());
  const mP = ctx.buildLectionaryModel(rP, q, groupsP, entriesP, null, [], false, [], null, new Set(["d0801-사도-성-베드로의-탈옥"]));
  same(ctx.headLinesOf(noneP).names, ["사도 성 베드로의 탈옥"]);
  same([ctx.headLinesOf(mP).names, ctx.headLinesOf(mP).others], [[], ["사도 성 베드로의 탈옥"]]);

  // 성주간에 생략되는 날은 줄이 없다
  const a3 = anna("omitted");
  const m3 = ctx.buildLectionaryModel(resolvedOf("2026-07-26", [sunday, a3], sunday), q, groupsOf, entriesOf(a3, sunday), null, [], false, [], null, mine);
  assert.strictEqual(m3.mySaint, null);
  same(m3.choices.map((c) => c.candidate.observance.id), ["grid:ordinary-17-sunday"]);
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
  // 부활밤 전례독서 목록을 고르면 백, 성 토요일 후보면 그날 색 홍.
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

test("collectLabels · pickCollect: 이름은 「본기도 N」이고 번호가 겹치면 위치로 매기며, ?collect= 는 위치다(자체 리뷰 2026-10-13, 2026-11-05)", () => {
  same(ctx.collectLabels([collect(1, "a", { collect_no: 1 }), collect(2, "b", { collect_no: 2 })]), ["본기도 1", "본기도 2"]);
  const ember = [collect(234, "a", { title: "성직후보자의 성소를 위한 추계재" }), collect(237, "b", { title: "수도자의 성소를 위한 추계재" })];
  same(ctx.collectLabels(ember), ["본기도 1", "본기도 2"]);
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

test("buildLectionaryModel: 세트와 본기도가 짝지어진 날 — 세트마다 전례독서 목록의 한 줄이고, ?set= 이 본기도와 제목까지 정하며, ?collect= 는 읽지도 쓰지도 않는다(사용자 결정 2026-10-13, 2026-11-05)", () => {
  const ember = cand(obs("t-추계재", "추계재", { rank: "feria", color: "violet", rule: { kind: "ember_wfs" } }));
  const r = resolvedOf("2026-09-18", [ember], ember, { coord: { season: "ordinary", week: 24, type: "weekday", weekday: "fri", year: "II" }, color: "green", colors: ["green"] });
  const groupsOf = groupsOfFrom({ "t-추계재": [
    group("s1", FOUR, { title: "성직후보자의 성소를 위한 추계재" }), group("s2", FOUR, { title: "수도자의 성소를 위한 추계재" })] });
  const entries = [{ candidate: ember, collects: [
    collect(234, "a", { title: "성직후보자의 성소를 위한 추계재", collect_no: 1 }), collect(237, "b", { title: "수도자의 성소를 위한 추계재", collect_no: 1, ending: "C" })] }];
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: 2, collect: 1 }, groupsOf, entries, null);
  assert.strictEqual(m.collectsLinked, true);
  same(m.choices.map((c) => [c.name, c.active, c.href]), [
    ["성직후보자의 성소를 위한 추계재", false, "/lectionary/2026-09-18"],
    ["수도자의 성소를 위한 추계재", true, "/lectionary/2026-09-18?set=2"],   // collect 를 쓰지 않는다
  ]);
  assert.strictEqual(m.dayName, "수도자의 성소를 위한 추계재");
  assert.strictEqual(m.group.id, "s2");
  assert.strictEqual(m.collects[m.collectIndex].id, 237);   // ?collect=1 은 무시 — 세트 2 의 짝
  assert.strictEqual(m.ending, "C");
  const first = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: 2 }, groupsOf, entries, null);
  assert.strictEqual(first.dayName, "성직후보자의 성소를 위한 추계재");
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
  const cant = slot("psalm", "cant", 11, "all", "루가 1:68-79 (즈가리야 송가)");
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
  const ember = cand(obs("t-추계재", "추계재", { rank: "feria", precedence: 8, color: "violet", penitential: true, type: "fast", rule: { kind: "ember_wfs" } }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, ember, grid], saint, {
    coord: { season: "ordinary", week: 24, type: "weekday", weekday: "wed", year: "II" }, color: "white", colors: ["violet", "white"],
  });
  const groupsOf = groupsOfFrom({
    "d0916-니니안": [1, 2, 3].map((n) => group(`common:missionary-s${n}`, FOUR, { common: "missionary", title: "선교사", set_no: n, set_total: 3 })),
    "t-추계재": [1, 2].map((n) => group(`ember-s${n}`, FOUR, { title: "성직자의 성소를 위한 추계재", set_no: n, set_total: 2 })),
    "grid:ordinary-24-weekday-wed": [group("grid-s1", FOUR)],
  });
  const entries = [
    { candidate: saint, collects: [collect("common:missionary-c1", "선교사 공통", { common: "missionary" })] },
    { candidate: ember, collects: [collect(231, "성직자의 성소", { ending: "C" })] },
    { candidate: grid, collects: [collect(114, "연중 24주간")] },
  ];
  return { r, groupsOf, entries, saint, ember, grid };
}

test("buildLectionaryModel: 사계재 날 — 초기 선택은 격자, 색은 병기, 전례독서 목록 둘(공통 독서만 있는 성인은 감춤), 본기도는 격자 다음에 성인", () => {
  const { r, groupsOf, entries, grid } = emberDay();
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, grid);
  assert.strictEqual(m.initial, grid);
  same(plain(m.colors), ["violet", "white"]);
  assert.strictEqual(m.ownColor, false);
  // 니니안은 공통 독서만 있어 당분간 전례독서 목록을 감춘다(HIDE_COMMON_READINGS, 사용자 결정 2026-11-03)
  same(m.choices.map((c) => [c.name, c.active]), [["성직자의 성소를 위한 추계재", false], ["연중 24주 수요일", true]]);   // 표의 이름이 아니라 본문의 제목(사용자 결정 2026-11-05)
  same(m.collects.map((o) => o.id), [114]);   // 고른 전례일(격자)의 본기도
  // 그 뒤에 기리는 성인(니니안)의 본기도가 이어진다(memorialOf) — 송영은 그 성인 본기도의 것
  assert.strictEqual(m.memorialCollects.length, entries.find((e) => e.candidate.observance.id === "d0916-니니안").collects.length ? 1 : 0);
  assert.strictEqual(m.options.length, 1);
  assert.strictEqual(m.group.id, "grid-s1");
  same(m.slots.map((s) => s.slot), ["first", "psalm", "second", "gospel"]);
  assert.strictEqual(m.fast, "minor");   // 사계재일 — 소재일
  assert.strictEqual(m.cycle, "짝수해");
  assert.strictEqual(m.hrefs.prev, "/lectionary/2026-09-15");
  assert.strictEqual(m.hrefs.next, "/lectionary/2026-09-17");
  // 초기 선택(격자)의 href는 쿼리가 없고, 다른 후보는 obs를 싣는다.
  assert.strictEqual(m.choices[1].href, "/lectionary/2026-09-16");
  assert.ok(m.choices[0].href.startsWith("/lectionary/2026-09-16?obs="));
  // 감춘 성인을 주소로 가리켜도 기본 독서(격자)
  assert.strictEqual(ctx.buildLectionaryModel(r, { obs: "d0916-니니안", track: null, set: null, collect: null }, groupsOf, entries, null).selected, grid);
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
  assert.strictEqual(m.dayName, "성직자의 성소를 위한 추계재");
  same(m.choices.map((c) => [c.name, c.active]), [["성직자의 성소를 위한 추계재", true], ["연중 24주 수요일", false]]);   // 세트 둘이어도 제목이 같아 한 줄
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

test("choiceNameOf: 사계재와 세트가 제목으로 갈리는 날은 본문의 제목, 그 밖과 본문이 없는 때는 전례일 이름(사용자 결정 2026-11-05)", () => {
  const { ember, grid } = emberDay();
  const g = group("x", FOUR, { title: "본문의 제목" });
  assert.strictEqual(ctx.choiceNameOf(ember, g, false), "본문의 제목");
  assert.strictEqual(ctx.choiceNameOf(ember, null, false), "추계재");
  assert.strictEqual(ctx.choiceNameOf(grid, g, false), "연중 24주 수요일");   // 평일 본문의 제목(「연중24주 수요일」)은 쓰지 않는다
  assert.strictEqual(ctx.choiceNameOf(grid, g, true), "본문의 제목");
});

test("buildLectionaryModel: 기념일은 전례독서 목록이 아니라 이름 줄(commemorations) — 주소로 가리켜도 기본 독서다(사용자 결정 2026-11-03)", () => {
  const feast = cand(obs("d0101-거룩한-이름-예수", "거룩한 이름 예수", { rank: "major_feast", precedence: 3, color: "white" }));
  const memo = cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration", precedence: 7 }));
  const grid = cand(obs("grid:christmas-x-weekday-thu", "성탄 목요일", { color: "white" }));
  const r = resolvedOf("2026-01-01", [feast, memo, grid], feast, { coord: { season: "christmas", week: null, type: "weekday", weekday: "thu", year: "A" }, color: "white", colors: ["white"] });
  // 격자에도 독서를 준다 — 본문 없는 격자는 따로 감춘다(아래 케이스)
  const groupsOf = groupsOfFrom({ "d0101-거룩한-이름-예수": [group("f", FOUR)], "grid:christmas-x-weekday-thu": [group("g", FOUR)] });
  const entries = [{ candidate: feast, collects: [collect(285, "…")] }, { candidate: memo, collects: [] }, { candidate: grid, collects: [] }];
  const m = ctx.buildLectionaryModel(r, { obs: "d0101-세계평화", track: null, set: null, collect: null }, groupsOf, entries, null, [], true);
  assert.strictEqual(m.selected, feast);   // 기념일을 가리켜도 기본 독서 — 본문 없는 화면이 아니다
  assert.strictEqual(m.empty, false);
  same(m.choices.map((c) => c.candidate.observance.id), ["d0101-거룩한-이름-예수", "grid:christmas-x-weekday-thu"]);
  same(m.commemorations.map((c) => c.observance.id), ["d0101-세계평화"]);
  const m0 = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m0.empty, false);
  assert.strictEqual(m0.selected, feast);
  same(m0.commemorations.map((c) => c.observance.id), ["d0101-세계평화"]);
});

test("buildLectionaryModel: 독서도 본기도도 없는 후보는 전례독서 목록에 없다 — 빈 격자는 감추고 본문 없는 날은 이름 줄(textlessDays), 주소로 가리켜도 기본 독서다(사용자 결정 2026-11-04)", () => {
  const king = cand(obs("t-왕이신-그리스도-주일", "왕이신 그리스도 주일", { rank: "major_feast", precedence: 3, color: "white" }));
  const saint = cand(obs("d1122-세실리아", "세실리아(로마의 순교자, 230년경)", { rank: "minor_feast", precedence: 7, color: "red" }));
  const family = cand(obs("t-가정주일", "가정주일"));
  const gone = cand(obs("t-본문없음-옮겨감", "옮겨 간 본문 없는 날"), "transferred_out", { to: "2026-11-23" });
  const grid = cand(obs("grid:ordinary-34-sunday", "연중 34주일", { rank: "sunday", precedence: 5, color: "green" }));
  const r = resolvedOf("2026-11-22", [king, saint, family, gone, grid], king, { coord: { season: "ordinary", week: 34, type: "sunday", weekday: null, year: "A" }, color: "white", colors: ["white"] });
  const groupsOf = groupsOfFrom({ "t-왕이신-그리스도-주일": [group("k", FOUR)], "d1122-세실리아": [group("s", FOUR)] });
  const entries = [king, saint, family, gone, grid].map((c) => ({ candidate: c, collects: c === king || c === saint ? [collect(c === king ? 1 : 2, "…")] : [] }));
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  same(m.choices.map((c) => c.candidate.observance.id), ["t-왕이신-그리스도-주일", "d1122-세실리아"]);
  same(m.textlessDays.map((c) => c.observance.id), ["t-가정주일"]);   // 옮겨 간 날은 그날 지키지 않아 이름 줄에 없고, 문장으로 알린다
  for (const obsId of ["grid:ordinary-34-sunday", "t-가정주일"]) {
    const pointed = ctx.buildLectionaryModel(r, { obs: obsId, track: null, set: null, collect: null }, groupsOf, entries, null);
    assert.strictEqual(pointed.selected, king, obsId);   // 빈 화면이 아니라 기본 독서
    assert.strictEqual(pointed.empty, false, obsId);
  }
  // 본기도만 있는 격자는 전례독서 목록으로 남는다 — 「독서 없음」 화면이라도 고를 본문이 있다
  const withCollect = entries.map((e) => (e.candidate === grid ? { candidate: grid, collects: [collect(3, "…")] } : e));
  assert.ok(ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, withCollect, null, [], true)
    .choices.some((c) => c.candidate === grid));
  // 기본 독서 후보는 비어도 감추지 않는다 — 전례독서 목록은 후보가 하나라 그리지 않지만 모델에는 남는다
  const lone = resolvedOf("2026-11-22", [grid, family], grid, { coord: { season: "ordinary", week: 34, type: "sunday", weekday: null, year: "A" } });
  const bare = ctx.buildLectionaryModel(lone, { obs: null, track: null, set: null, collect: null }, groupsOfFrom({}), [grid, family].map((c) => ({ candidate: c, collects: [] })), null);
  same(bare.choices.map((c) => c.candidate.observance.id), ["grid:ordinary-34-sunday"]);
  assert.strictEqual(bare.empty, true);
  same(bare.textlessDays.map((c) => c.observance.id), ["t-가정주일"]);
});

test("buildLectionaryModel: 그날 축성 · 축복된 교회는 종류마다 한 줄, 이름을 쉼표로 잇고 꼬리는 한 번 — 「북.」 성당은 뺀다(사용자 결정 2026-11-04)", () => {
  const grid = cand(obs("grid:easter-4-weekday-tue", "부활 4주 화요일", { rank: "feria", precedence: 8, color: "white" }));
  const r = resolvedOf("2026-04-21", [grid], grid);
  const groupsOf = groupsOfFrom({ "grid:easter-4-weekday-tue": [group("g", FOUR)] });
  const entries = [{ candidate: grid, collects: [collect("g-c", "…")] }];
  const q = { obs: null, track: null, set: null, collect: null };
  const lines = (dedications) => plain(ctx.buildLectionaryModel(r, q, groupsOf, entries, null, dedications).dedicationLines);
  // 표의 차례가 축복 먼저여도 축성일 줄이 먼저다
  same(lines([
    { name: "세종성당", kind: "blessing" }, { name: "강릉성당", kind: "consecration" },
    { name: "북.장림성당", kind: "consecration" }, { name: "청주산남성당", kind: "blessing" },
  ]), ["강릉성당 축성일", "세종성당, 청주산남성당 축복일"]);
  same(lines([{ name: "일산성당", kind: "consecration" }, { name: "초지성당", kind: "consecration" }, { name: "행신성당", kind: "consecration" }]),
    ["일산성당, 초지성당, 행신성당 축성일"]);
  // 북한 성당뿐인 날, 교회가 없는 날, 인자를 넘기지 않은 호출(테스트의 옛 호출)은 줄이 없다
  same(lines([{ name: "북.버드내성당", kind: "consecration" }, { name: "북.장림성당", kind: "consecration" }]), []);
  same(lines([]), []);
  same(plain(ctx.buildLectionaryModel(r, q, groupsOf, entries, null).dedicationLines), []);
});

// ── 소속교회의 축성일(ADR-041 §6, §8) ─────────────────────────────────────────

const MINE = "k7m3qx";
/** 본당 표의 축성일 분류(엔진 `findDedications`가 싣는 값). 축성은 주요축일 C, 축복은 기념일이다. */
const CONSECRATION = { rank: "major_feast", precedence: 4, priority_group: "C", color: "white", common: "dedication", transferable: false, transfer_to: null };
const BLESSING = { rank: "commemoration", precedence: 7, priority_group: null, color: "white", common: "dedication", transferable: false, transfer_to: null };
const DEDICATIONS = [
  { name: "강릉성당", kind: "consecration", church_id: MINE, ...CONSECRATION },
  { name: "원주성당", kind: "consecration", church_id: "w2h9cd", ...CONSECRATION },
  { name: "세종성당", kind: "blessing", church_id: "n4p8rt", ...BLESSING },
];
/** 공통 「성당 축성일」의 독서 2세트와 본기도. 엔진이 `sanctoral_class: "dedication"`인 후보에 내는 것과 같은 모양이다. */
const DEDICATION_GROUPS = [1, 2].map((n) => group(`common:dedication-s${n}`, FOUR, { common: "dedication", title: "성당 축성일", set_no: n, set_total: 2 }));
const DEDICATION_COLLECT = collect("common:dedication-c1", "이 성전을 봉헌한 날을 기념하며", { common: "dedication", title: "성당 축성일" });
/** 그날의 후보와 축성일 본기도를 담은 화면 모델. 공개 래퍼처럼 축성일 후보를 한 번 만들어 본기도 원소와 화면 모델에 같은 후보를 넘긴다. */
const dedicationModelOf = (r, table, parish, query = {}, show = false, dedications = DEDICATIONS) => {
  const mine = ctx.myDedicationOf(dedications, parish);
  const entries = [...(mine ? [{ candidate: mine.candidate, collects: [DEDICATION_COLLECT] }] : []),
    ...r.candidates.map((c) => ({ candidate: c, collects: [collect(`${c.observance.id}-c`, "…")] }))];
  const groupsOf = groupsOfFrom({ ...table, "my-dedication": DEDICATION_GROUPS });
  return ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null, ...query }, groupsOf, entries, null, dedications, show, [], mine);
};
/** 전례독서 목록에서 고른 줄(제목)을 뺀 줄의 이름과 주소. */
const others = (m) => m.choices.filter((c) => !c.active).map((c) => [c.name, c.href]);

test("myDedicationOf: 소속교회가 그날 축성일이면 주요축일 C인 「○○성당 축성일」 후보와 그 교회 식별자 — 축복일, 다른 교회, 고르지 않음은 null(ADR-041 §6)", () => {
  const mine = ctx.myDedicationOf(DEDICATIONS, MINE);
  same(mine, {
    candidate: {
      observance: {
        id: "my-dedication", kind: "sanctoral", name: "강릉성당 축성일", aliases: null, sanctoral_class: "dedication", has_proper: false,
        rank: "major_feast", precedence: 4, priority_group: "C", transferable: false, transfer_to: null, color: "white", color_alt: null,
      },
      status: "proper",
    },
    churchId: MINE,
  });
  assert.strictEqual(ctx.myDedicationOf(DEDICATIONS, "n4p8rt"), null);   // 세종성당은 그날 축복일이다
  assert.strictEqual(ctx.myDedicationOf(DEDICATIONS, "zzzzzz"), null);
  assert.strictEqual(ctx.myDedicationOf(DEDICATIONS, ""), null);
  assert.strictEqual(ctx.myDedicationOf([{ name: "옛성당", kind: "consecration", church_id: null, ...CONSECRATION }], ""), null);   // 식별자 없는 옛 표
  // 공통 분류가 없으면 독서와 본기도를 찾을 수 없어 축성일 화면을 열지 않는다
  assert.strictEqual(ctx.myDedicationOf([{ ...DEDICATIONS[0], common: null }], MINE), null);
  // 분류는 본당 표의 값을 그대로 쓴다
  same(ctx.myDedicationOf([{ ...DEDICATIONS[0], color: "red", rank: "principal", precedence: 1 }], MINE).candidate.observance.color, "red");
});

test("dedicationFirst: 기본 독서가 주일, 대축일, 주요축일, 명절이면 축성일은 줄이고, 그 밖의 평일에는 축성일이 먼저다(ADR-041 §6, 사용자 결정 2026-11-09)", () => {
  const of = (rank) => cand(obs("x", "x", { rank }));
  same(["feria", "minor_feast", null].map((rank) => ctx.dedicationFirst(of(rank), "2026-04-21")), [true, true, true]);
  same(["principal", "major_feast", "regional_festival"].map((rank) => ctx.dedicationFirst(of(rank), "2026-04-21")), [false, false, false]);
  assert.strictEqual(ctx.dedicationFirst(of("sunday"), "2026-04-26"), false);   // 일요일
});

test("buildLectionaryModel: 평일의 소속교회 축성일 — 축성일이 먼저 열리고, 평일은 목록의 줄, 성인 본기도는 잇지 않으며, 제목의 교회는 축성일 줄에서 뺀다(사용자 결정 2026-11-05, 11-09)", () => {
  const saint = cand(obs("d0421-안셀름", "안셀름(켄터베리 대주교, 1109년)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "teacher" }));
  const grid = cand(obs("grid:easter-4-weekday-tue", "부활 4주 화요일", { rank: "feria", precedence: 8, color: "white" }));
  const r = resolvedOf("2026-04-21", [saint, grid], saint);   // 그날 색(녹색)과 달라 머리는 축성일의 백색이다
  const table = { "d0421-안셀름": [group("common:teacher-s1", FOUR, { common: "teacher" })], "grid:easter-4-weekday-tue": [group("g", FOUR)] };
  const m = dedicationModelOf(r, table, MINE);
  same([m.selected.observance.id, m.initial.observance.id, m.dayName], ["my-dedication", "my-dedication", "강릉성당 축성일"]);
  same([m.options.length, m.collects.map((c) => c.id), m.memorialCollects, m.ending], [2, ["common:dedication-c1"], [], "A"]);
  same([m.colors, m.ownColor], [["white"], true]);
  // 성인의 이름 줄은 그대로이고, 제목의 교회만 축성일 줄에서 빠진다
  same([m.memorialSaints.map((c) => c.observance.id), m.dedicationLines], [["d0421-안셀름"], ["원주성당 축성일", "세종성당 축복일"]]);
  // 평일 줄은 대체 독서 표시를 꺼도 보이고, 그 주소에는 평일의 식별자가 붙는다. 축성일이 기본이라 축성일 주소에는 `?obs=`가 없다
  same(others(m), [["부활 4주 화요일", "/lectionary/2026-04-21?obs=grid%3Aeaster-4-weekday-tue"]]);
  // 평일 줄을 고르면 지금처럼 성인 본기도를 잇고, 축성일 줄에 그 교회가 다시 보이며, 축성일 줄의 주소는 날짜뿐이다
  const w = dedicationModelOf(r, table, MINE, { obs: grid.observance.id });
  // 축성일이 전례독서 목록의 줄이어도 축성일 줄에서 그 교회를 뺀다(같은 글이 두 번 보이지 않게)
  same([w.selected, w.memorialCollects.map((c) => c.id), w.dedicationLines], [grid, ["d0421-안셀름-c"], ["원주성당 축성일", "세종성당 축복일"]]);
  same(others(w), [["강릉성당 축성일", "/lectionary/2026-04-21"]]);
  // 소속교회를 고르지 않은 사람이 축성일 주소를 열면 그날의 기본 독서다
  const other = dedicationModelOf(r, table, "", { obs: "my-dedication" });
  same([other.selected, others(other), other.dedicationLines[0]], [grid, [], "강릉성당, 원주성당 축성일"]);
});

test("buildLectionaryModel: 주일, 주요축일, 평일의 명절에 온 소속교회 축성일은 목록의 맨 앞 줄이고 주소는 `?obs=my-dedication`이다(ADR-041 §6, §8)", () => {
  const sunday = cand(obs("grid:easter-5-sunday", "부활 5주일", { rank: "sunday", precedence: 5, color: "white" }));
  const rs = resolvedOf("2026-04-26", [sunday], sunday, { coord: { season: "easter", week: 5, type: "sunday", weekday: "sun", year: "A" } });
  const s = dedicationModelOf(rs, { "grid:easter-5-sunday": [group("s", FOUR)] }, MINE);
  assert.strictEqual(s.selected, sunday);
  same(others(s), [["강릉성당 축성일", "/lectionary/2026-04-26?obs=my-dedication"]]);
  same(s.dedicationLines[0], "원주성당 축성일");   // 줄로 있는 교회는 축성일 줄에서 뺀다
  // 그 줄을 고르면 축성일 화면이고, 제목의 교회를 축성일 줄에서 뺀다
  const picked = dedicationModelOf(rs, { "grid:easter-5-sunday": [group("s", FOUR)] }, MINE, { obs: "my-dedication" });
  same([picked.dayName, picked.dedicationLines[0], others(picked)], ["강릉성당 축성일", "원주성당 축성일", [["부활 5주일", "/lectionary/2026-04-26"]]]);   // 기본 독서인 주일의 주소는 날짜뿐이다

  for (const [id, name, rank] of [["d0425-마르코", "성 마르코(복음사가)", "major_feast"], ["lunar815-추석-명절", "추석 명절", "regional_festival"]]) {
    const feast = cand(obs(id, name, { rank, precedence: rank === "major_feast" ? 6 : 0, color: "white" }));
    const grid = cand(obs("grid:easter-4-weekday-tue", "부활 4주 화요일", { rank: "feria", precedence: 8, color: "white" }));
    const r = resolvedOf("2026-04-21", [feast, grid], feast);
    const m = dedicationModelOf(r, { [id]: [group(`p-${id}`, FOUR)], "grid:easter-4-weekday-tue": [group("g", FOUR)] }, MINE, {}, true);
    assert.strictEqual(m.selected, feast, rank);
    same(others(m)[0], ["강릉성당 축성일", "/lectionary/2026-04-21?obs=my-dedication"], rank);
  }
});

test("buildLectionaryModel: 본문(독서와 본기도)이 없는 축성일은 열지 않는다 — 본당 표의 공통 분류가 공통 자료에 없을 때(PR #542 리뷰)", () => {
  const grid = cand(obs("grid:easter-4-weekday-tue", "부활 4주 화요일", { rank: "feria", precedence: 8, color: "white" }));
  const r = resolvedOf("2026-04-21", [grid], grid);
  const mine = ctx.myDedicationOf(DEDICATIONS, MINE);
  const entries = [{ candidate: mine.candidate, collects: [] }, { candidate: grid, collects: [collect("g-c", "…")] }];
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOfFrom({ "grid:easter-4-weekday-tue": [group("g", FOUR)] }),
    entries, null, DEDICATIONS, false, [], mine);
  same([m.selected, m.choices.map((c) => c.candidate.observance.id), m.dedicationLines[0]], [grid, ["grid:easter-4-weekday-tue"], "강릉성당, 원주성당 축성일"]);
});

test("buildLectionaryModel: 축성일 화면의 머리 색은 축성일의 백색 하나이고, 그날 함께 적는 색(사계재의 자색)과 대체색(청색)을 받지 않는다(PR #542 리뷰)", () => {
  const grid = cand(obs("grid:ordinary-24-weekday-fri", "연중 24주 금요일", { rank: "feria", precedence: 8, color: "green" }));
  // 그날 대표색이 백색이고 사계재의 자색을 함께 적으며 청색 대체색이 있는 날(2025-09-19 추계재 금요일과 같은 경우)
  const r = resolvedOf("2025-09-19", [grid], grid, { color: "white", colors: ["violet", "white"], colorAlt: "blue" });
  const m = dedicationModelOf(r, { "grid:ordinary-24-weekday-fri": [group("g", FOUR)] }, MINE);
  same([m.dayName, m.colors, m.colorAlt, m.ownColor], ["강릉성당 축성일", ["white"], [], true]);
  // 평일 줄을 고르면 그날 색 그대로다
  const w = dedicationModelOf(r, { "grid:ordinary-24-weekday-fri": [group("g", FOUR)] }, MINE, { obs: grid.observance.id });
  same([w.colors, w.ownColor], [["violet", "white"], false]);
});

test("buildLectionaryModel: 축성일이 먼저 열려도 그날의 기본 독서는 감추지 않는다 — 공통 독서뿐인 지정 전례일이 기본 독서인 날(PR #542 리뷰)", () => {
  // 평일 격자에 독서가 없어 공통 독서뿐인 성인 축일이 그날의 기본 독서다. 소속교회와 무관하면 목록에 감추는 후보가 아니다
  const saint = cand(obs("d0421-안셀름", "안셀름(켄터베리 대주교, 1109년)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "teacher" }));
  const grid = cand(obs("grid:easter-4-weekday-tue", "부활 4주 화요일", { rank: "feria", precedence: 8, color: "white" }));
  const r = resolvedOf("2026-04-21", [saint, grid], saint);
  const table = { "d0421-안셀름": [group("common:teacher-s1", FOUR, { common: "teacher" })] };
  const m = dedicationModelOf(r, table, MINE);
  same([m.publicInitial, m.selected.observance.id], [saint, "my-dedication"]);
  same(others(m).map(([name]) => name), ["안셀름"]);
  // 그 줄의 주소로 열면 그 축일이다
  assert.strictEqual(dedicationModelOf(r, table, MINE, { obs: saint.observance.id }).selected, saint);
});

test("buildLectionaryModel: 본기도 없이 그날 지키는 다른 전례일의 독서를 그대로 받는 후보는 이름 줄 — 빌려 준 쪽이 옮겨 갔거나 본기도가 없으면 목록에 남는다(사용자 결정 2026-11-07, PR #510 리뷰)", () => {
  const q = { obs: null, track: null, set: null, collect: null };
  const ids = (cs) => cs.map((c) => c.observance.id);
  const mich = cand(obs("d0929-mich", "성 미카엘과 모든 천사들", { rank: "major_feast", precedence: 3, color: "white" }));
  const mission = cand(obs("d0929-mission", "대한성공회 선교 기념일", { rank: "major_feast", precedence: 4, color: "white" }));
  const grid = cand(obs("grid:ordinary-26-weekday-wed", "연중 26주 수요일", { rank: "feria", precedence: 8, color: "green" }));
  const shared = [group("joint", FOUR)];
  const groupsOf = groupsOfFrom({ "d0929-mich": shared, "d0929-mission": shared, "grid:ordinary-26-weekday-wed": [group("g", FOUR)] });
  const entries = (lender) => [{ candidate: lender, collects: [collect("m-c", "미카엘")] }, { candidate: mission, collects: [] },
    { candidate: grid, collects: [collect("g-c", "연중")] }];
  // 9.29 — 빌려 준 성 미카엘이 그날의 기본 독서이고 본기도가 있다 → 이름 줄
  const m = ctx.buildLectionaryModel(resolvedOf("2027-09-29", [mich, mission, grid], mich), q, groupsOf, entries(mich), null, [], true);
  same(ids(m.textlessDays), ["d0929-mission"]);
  assert.ok(!m.choices.some((c) => c.candidate === mission));
  // 빌려 준 쪽이 옮겨 갔으면 그 독서를 고를 곳이 없어지므로 목록에 남는다
  const away = cand(mich.observance, "transferred_out", { to: "2027-09-30" });
  const m2 = ctx.buildLectionaryModel(resolvedOf("2027-09-29", [grid, away, mission], grid), q, groupsOf, entries(away), null, [], true);
  same(ids(m2.textlessDays), []);
  assert.ok(m2.choices.some((c) => c.candidate === mission));
  // 본기도 없는 두 후보가 같은 독서를 받으면 서로를 근거로 감추지 않는다
  const twin = cand(obs("d0929-twin", "다른 기념", { rank: "major_feast", precedence: 4, color: "white" }));
  const groupsOf3 = groupsOfFrom({ "d0929-mission": shared, "d0929-twin": shared, "grid:ordinary-26-weekday-wed": [group("g", FOUR)] });
  const entries3 = [{ candidate: grid, collects: [collect("g-c", "연중")] }, { candidate: mission, collects: [] }, { candidate: twin, collects: [] }];
  const m3 = ctx.buildLectionaryModel(resolvedOf("2027-09-29", [grid, mission, twin], grid), q, groupsOf3, entries3, null, [], true);
  same(ids(m3.textlessDays), []);
  same(ids(m3.choices.map((c) => c.candidate)).filter((x) => x.startsWith("d0929")), ["d0929-mission", "d0929-twin"]);
});

test("buildLectionaryModel: 관구 설립일에는 「1992년 9월 29일 관구설립일」 줄을 두고, 그 본기도를 고른 전례일의 본기도 뒤에 잇는다 — 주일에도, 다른 전례일을 골라도(사용자 결정 2026-11-05, 2026-11-07)", () => {
  const mich = cand(obs("d0929-mich", "성 미카엘과 모든 천사들", { rank: "major_feast", precedence: 3, color: "white" }));
  const grid = cand(obs("grid:ordinary-26-sunday", "연중 26주일", { rank: "sunday", precedence: 5, color: "green" }));
  const r = resolvedOf("2030-09-29", [mich, grid], mich);
  const groupsOf = groupsOfFrom({ "d0929-mich": [group("m", FOUR)], "grid:ordinary-26-sunday": [group("g", FOUR)] });
  const entries = [{ candidate: mich, collects: [collect("m-c", "미카엘")] }, { candidate: grid, collects: [collect("g-c", "연중")] }];
  const province = { level: "province", name: "대한성공회", label: "관구", date: "09.29", year: 1992,
    collect: { id: "common:anniversary-province-대한성공회", title: "설립일", collect_no: 1, collect_total: 1, text: "관구", ending: "C", common: "anniversary" } };
  const q = { obs: null, track: null, set: null, collect: null };
  const m = ctx.buildLectionaryModel(r, q, groupsOf, entries, null, [], false, [province]);
  same(plain(m.foundingLines), ["1992년 9월 29일 관구설립일"]);
  same(m.memorialCollects.map((c) => c.text), ["관구"]);
  assert.strictEqual(m.ending, "C");   // 송영은 이은 본기도 뒤에 한 번
  // 다른 전례일을 골라도 그 전례일의 본기도 뒤에 잇는다. 줄도 그대로다
  const other = ctx.buildLectionaryModel(r, { ...q, obs: "grid:ordinary-26-sunday" }, groupsOf, entries, null, [], true, [province]);
  same(other.collects.map((c) => c.text), ["연중"]);
  same(other.memorialCollects.map((c) => c.text), ["관구"]);
  same(plain(other.foundingLines), ["1992년 9월 29일 관구설립일"]);
  // 설립연도가 없으면 월일만, 관구 설립일이 아니면(인자를 넘기지 않은 옛 호출 포함) 줄이 없다
  same(plain(ctx.buildLectionaryModel(r, q, groupsOf, entries, null, [], false, [{ ...province, year: null }]).foundingLines), ["9월 29일 관구설립일"]);
  same(plain(ctx.buildLectionaryModel(r, q, groupsOf, entries, null, [], false).foundingLines), []);
});

test("buildLectionaryModel: 소속교회의 교구 설립일에는 「1965년 5월 27일 서울교구설립일」 줄을 두고, 그 본기도를 고른 전례일의 본기도 뒤에 잇는다. 주일에도, 다른 전례일을 골라도 잇는다(ADR-041 §6, 사용자 결정 2026-11-09)", () => {
  const sunday = cand(obs("grid:easter-7-sunday", "부활 7주일", { rank: "sunday", precedence: 5, color: "white" }));
  const weekday = cand(obs("d0527-x", "합성 축일", { rank: "minor_feast", precedence: 7, color: "red" }));
  const r = resolvedOf("2029-05-27", [weekday, sunday], sunday, { coord: { season: "easter", week: 7, type: "sunday", weekday: "sun", year: "B" } });
  const groupsOf = groupsOfFrom({ "grid:easter-7-sunday": [group("s", FOUR)], "d0527-x": [group("x", FOUR)] });
  const entries = [{ candidate: sunday, collects: [collect("s-c", "주일")] }, { candidate: weekday, collects: [collect("x-c", "축일")] }];
  const seoul = { level: "diocese", name: "서울", label: "서울교구", date: "05.27", year: 1965,
    collect: { id: "common:anniversary-diocese-서울", title: "설립일", collect_no: 1, collect_total: 1, text: "서울교구", ending: "A", common: "anniversary" } };
  const q = { obs: null, track: null, set: null, collect: null };
  const m = ctx.buildLectionaryModel(r, q, groupsOf, entries, null, [], false, [seoul]);
  same([plain(m.foundingLines), m.memorialCollects.map((c) => c.text)], [["1965년 5월 27일 서울교구설립일"], ["서울교구"]]);
  const other = ctx.buildLectionaryModel(r, { ...q, obs: "d0527-x" }, groupsOf, entries, null, [], false, [seoul]);
  same([other.collects.map((c) => c.text), other.memorialCollects.map((c) => c.text)], [["축일"], ["서울교구"]]);
  // 제목과 독서는 그대로다(교구 설립일은 전례독서 목록의 줄이 아니다)
  same([m.dayName, m.choices.map((c) => c.candidate.observance.id)], ["부활 7주일", ["d0527-x", "grid:easter-7-sunday"]]);
});

test("buildLectionaryModel: 이름 있는 후보와 독서 · 본기도가 똑같은 격자는 전례독서 목록에 없다 — 대림1주일(사용자 결정 2026-11-04)", () => {
  const advent = cand(obs("t-대림1주일", "대림1주일", { rank: "privileged_sunday", precedence: 2, color: "violet" }));
  const grid = cand(obs("grid:advent-1-sunday", "대림 1주일", { rank: "privileged_sunday", precedence: 2, color: "violet" }));
  const andrew = cand(obs("d1130-안드레아", "사도 성 안드레아", { rank: "feast", precedence: 6, color: "red" }), "transferred_out", { to: "2025-12-01" });
  const coord = { season: "advent", week: 1, type: "sunday", weekday: null, year: "C" };
  const same1 = { "t-대림1주일": [group("a1", FOUR)], "grid:advent-1-sunday": [group("a1", FOUR)], "d1130-안드레아": [group("an", FOUR)] };
  const entriesOf = (cs, gridCollect = 7) => cs.map((c) => ({ candidate: c, collects: [collect(c === grid ? gridCollect : c === advent ? 7 : 8, "…")] }));
  const r = resolvedOf("2026-11-29", [advent, grid], advent, { coord, color: "violet", colors: ["violet"] });
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOfFrom(same1), entriesOf([advent, grid]), null);
  same(m.choices.map((c) => c.candidate.observance.id), ["t-대림1주일"]);   // 하나뿐이라 전례독서 목록을 그리지 않는다
  const pointed = ctx.buildLectionaryModel(r, { obs: "grid:advent-1-sunday", track: null, set: null, collect: null }, groupsOfFrom(same1), entriesOf([advent, grid]), null);
  assert.strictEqual(pointed.selected, advent);   // 주소로 가리켜도 같은 화면 — 기본 독서
  // 옮겨 간 축일이 있는 해(2025-11-30)도 후보는 하나다 — 그 축일은 전례독서 목록이 아니라 문장이다(사용자 결정 2026-11-04)
  const r2 = resolvedOf("2025-11-30", [advent, andrew, grid], advent, { coord, color: "violet", colors: ["violet"] });
  same(ctx.buildLectionaryModel(r2, { obs: null, track: null, set: null, collect: null }, groupsOfFrom(same1), entriesOf([advent, andrew, grid]), null)
    .choices.map((c) => c.candidate.observance.id), ["t-대림1주일"]);
  // 본기도가 다르면 다른 화면이라 격자가 전례독서 목록에 남는다
  same(ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOfFrom(same1), entriesOf([advent, grid], 9), null)
    .choices.map((c) => c.candidate.observance.id), ["t-대림1주일", "grid:advent-1-sunday"]);
  // 옮겨 간 축일이나 생략된 축일과는 견주지 않는다 — 본문이 같아도 그날 지키는 격자의 줄이 남는다(PR #467 리뷰)
  // (기본 독서는 본문이 다른 대림1주일 — 격자가 기본 독서면 이 규칙을 거치지 않는다)
  const goneSame = { "t-대림1주일": [group("a2", FOUR)], "d1130-안드레아": [group("a1", FOUR)], "grid:advent-1-sunday": [group("a1", FOUR)] };
  const choicesWith = (/** @type {any} */ away) => {
    const r3 = resolvedOf("2025-11-30", [advent, away, grid], advent, { coord, color: "violet", colors: ["violet"] });
    const e3 = [{ candidate: advent, collects: [collect(6, "…")] }, { candidate: away, collects: [collect(7, "…")] }, { candidate: grid, collects: [collect(7, "…")] }];
    return ctx.buildLectionaryModel(r3, { obs: null, track: null, set: null, collect: null }, groupsOfFrom(goneSame), e3, null)
      .choices.map((c) => c.candidate.observance.id);
  };
  same(choicesWith(cand(andrew.observance, "transferred_out", { to: "2025-12-01" })), ["t-대림1주일", "grid:advent-1-sunday"]);
  same(choicesWith(cand(andrew.observance, "omitted")), ["t-대림1주일", "grid:advent-1-sunday"]);   // 생략하는 후보는 누를 수 없는 글이다(2026-11-04)
});

test("buildLectionaryModel: 옮겨 간 축일은 전례독서 목록에 없고 제목 아래 문장이다 — 주소로 가리켜도 기본 독서(사용자 결정 2026-11-04)", () => {
  const sunday = cand(obs("grid:advent-2-sunday", "대림 2주일", { rank: "privileged_sunday", precedence: 2, color: "violet" }));
  const nicholas = cand(obs("d1206-성-니콜라", "성 니콜라(대한성공회 수호성인, 미라의 주교, 326년)", { rank: "major_feast", precedence: 6, color: "white" }), "transferred_out", { to: "2026-12-07" });
  const souls = cand(obs("d1206-별세자", "모든 별세자의 날", { rank: "minor_feast", precedence: 7, color: "violet" }), "transferred_out", { to: "2027-01-02" });
  const r = resolvedOf("2026-12-06", [nicholas, souls, sunday], sunday, { coord: { season: "advent", week: 2, type: "sunday", weekday: null, year: "B" }, color: "violet", colors: ["violet"] });
  const groupsOf = groupsOfFrom({ "grid:advent-2-sunday": [group("a", FOUR)], "d1206-성-니콜라": [group("n", FOUR)], "d1206-별세자": [group("s", FOUR)] });
  const entries = [nicholas, souls, sunday].map((c, i) => ({ candidate: c, collects: [collect(i + 1, "…")] }));
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  same(m.choices.map((c) => c.candidate.observance.id), ["grid:advent-2-sunday"]);   // 하나뿐이라 전례독서 목록을 그리지 않는다
  // 이름은 괄호 설명을 뗀 것이고, 「날」로 끝나는 이름은 「축일」을 붙이지 않는다. 해를 넘어도 월일만 적는다
  same(plain(m.transferNotes), ["성 니콜라 축일을 12월 7일로 옮김", "모든 별세자의 날을 1월 2일로 옮김"]);
  assert.strictEqual(ctx.transferOutNote("재의 수요일", "2032-02-12"), "재의 수요일을 2월 12일로 옮김");
  const pointed = ctx.buildLectionaryModel(r, { obs: "d1206-성-니콜라", track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(pointed.selected, sunday);
  // 옮겨 온 쪽(transferred_in)과 옮겨 지킬 수 있는 쪽(optional)은 전례독서 목록 그대로다 — 그 독서를 고르는 자리다
  const arrived = cand(nicholas.observance, "transferred_in", { from: "2026-12-06" });
  const weekday = cand(obs("grid:advent-2-weekday-mon", "대림 2주 월요일", { rank: "feria", precedence: 8, color: "violet" }));
  const r2 = resolvedOf("2026-12-07", [arrived, weekday], arrived, { coord: { season: "advent", week: 2, type: "weekday", weekday: "mon", year: null } });
  const m2 = ctx.buildLectionaryModel(r2, { obs: null, track: null, set: null, collect: null },
    groupsOfFrom({ "d1206-성-니콜라": [group("n", FOUR)], "grid:advent-2-weekday-mon": [group("w", FOUR)] }),
    [arrived, weekday].map((c, i) => ({ candidate: c, collects: [collect(i + 1, "…")] })), null, [], true);
  same(m2.choices.map((c) => c.candidate.observance.id), ["d1206-성-니콜라", "grid:advent-2-weekday-mon"]);
  same(plain(m2.transferNotes), []);
});

test("buildLectionaryModel: 트랙 — 기억(마지막 선택)이 기본, URL 이 앞서고, href 는 전례독서 목록 · 카드까지 트랙을 언제나 적는다(기억과 무관한 주소 — 자체 리뷰 2026-10-13 · 머지 전 검토 2026-10-14)", () => {
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
  assert.strictEqual(remembered.choices[0].name, "연중 11주일");   // 주기와 독서 N은 이름에 붙이지 않는다 — 제목 아래 줄과 세그먼트에 있다(2026-11-04)
  assert.strictEqual(remembered.choices[0].href, "/lectionary/2026-06-14?track=2");   // 목록의 링크도 그 트랙을 적는다
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
  // 공유받은 「독서 1」 주소(기억은 2)에서 고른 후보의 링크도 독서 1 — 줄의 링크가 기억이 아니라 화면의 트랙을 적는다.
  assert.strictEqual(overridden.choices[0].href, "/lectionary/2026-06-14?track=1");
});

// ── 독서 카드(사용자 결정 2026-11-05, ADR-038 §3 「대안 세트·트랙 전환」) ──

const ALT_TRACK = [slot("first", "hos", 6, "1-6", "호세 6:1-6"), slot("psalm", "lps", 50, "7-15", "시편 50:7-15"), FOUR[2], FOUR[3]];
const NO_QUERY = { obs: null, track: null, set: null, collect: null };
/** 후보 하나인 날의 모델 — 독서 그룹만 바꿔 카드를 본다. */
function cardsModel(groups, { query = NO_QUERY, stored = null, name = "연중 11주일", collects = [collect(59, "…")] } = {}) {
  const sunday = cand(obs("grid:ordinary-11-sunday", name, { rank: "sunday", precedence: 5, color: "green" }));
  const r = resolvedOf("2026-06-14", [sunday], sunday, { coord: { season: "ordinary", week: 11, type: "sunday", weekday: null, year: "A" } });
  return ctx.buildLectionaryModel(r, query, groupsOfFrom({ "grid:ordinary-11-sunday": groups }), [{ candidate: sunday, collects }], stored);
}

test("독서 카드: 트랙마다 한 장 — 이름은 연속 독서와 복음 주제, 모든 항목을 적고 다른 항목을 표시하며, 고른 트랙이 활성", () => {
  const groups = [group("t1", FOUR, { reading_track: 1 }), group("t2", ALT_TRACK, { reading_track: 2 })];
  const m = cardsModel(groups, { stored: 2 });
  same(m.cards.map((c) => [c.name, c.active, c.focusKey, c.track, c.href]), [
    ["연속 독서", false, "track:1", 1, "/lectionary/2026-06-14?track=1"],
    ["복음 주제", true, "track:2", 2, "/lectionary/2026-06-14?track=2"],
  ]);
  same(m.cards[0].refs, [
    { label: "창세 12:1-9", differs: true }, { label: "시편 33:1-12", differs: true },
    { label: "로마 4:13-25", differs: false }, { label: "마태 9:9-13, 18-26", differs: false },
  ]);
  same(m.cards[1].refs.map((r) => r.label), ["호세 6:1-6", "시편 50:7-15", "로마 4:13-25", "마태 9:9-13, 18-26"]);
});

test("독서 카드: 괄호 선택 구절 세트는 바탕에 합쳐 트랙마다 한 장이고, 긴 본문의 성구를 적는다", () => {
  const m = cardsModel(TRACKED);
  same(m.cards.map((c) => c.name), ["연속 독서", "복음 주제"]);
  same(m.cards[0].refs.map((r) => r.label), ["창세 12:1-9", "시편 33:1-12", "로마 4:13-25", "마태 9:9-13, 18-31"]);
  // 두 트랙의 항목이 모두 같으면 표시할 것이 없다
  assert.ok(m.cards.every((c) => c.refs.every((r) => !r.differs)));
});

test("독서 카드: 항목 하나만 다른 「또는」 대안도 카드다 — 세트마다 한 장, 트랙이 없어 기억하지 않는다", () => {
  const psalmAlt = [FOUR[0], slot("psalm", "lps", 95, "1-7", "시편 95:1-7"), FOUR[2], FOUR[3]];
  const m = cardsModel([group("a", FOUR, { set_no: 1, set_total: 2 }), group("b", psalmAlt, { set_no: 2, set_total: 2 })], { query: { ...NO_QUERY, set: 2 } });
  same(m.cards.map((c) => [c.name, c.active, c.focusKey, c.track, c.href]), [
    ["독서 1", false, "set:1", null, "/lectionary/2026-06-14"],
    ["독서 2", true, "set:2", null, "/lectionary/2026-06-14?set=2"],
  ]);
  same(m.cards[1].refs.map((r) => r.differs), [false, true, false, false]);
});

test("독서 카드: 고를 것이 없으면 없다 — 세트 하나, 괄호 선택 구절뿐인 날", () => {
  assert.strictEqual(cardsModel([group("a", FOUR)]).cards, null);
  const bracketOnly = [group("a", FOUR, { set_no: 1, set_total: 2 }), group("b", FOUR_LONG, { set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" })];
  assert.strictEqual(cardsModel(bracketOnly).cards, null);
});

test("독서 카드: 세트와 본기도가 제목으로 짝지어진 날은 카드가 아니라 전례독서 목록의 줄이다(사용자 결정 2026-11-05)", () => {
  const groups = [group("a", FOUR, { title: "성직후보자의 성소를 위한 추계재" }), group("b", ALT_TRACK, { title: "수도자의 성소를 위한 추계재" })];
  const collects = [collect(1, "x", { title: "성직후보자의 성소를 위한 추계재" }), collect(2, "y", { title: "수도자의 성소를 위한 추계재" })];
  const m = cardsModel(groups, { collects });
  assert.strictEqual(m.collectsLinked, true);
  assert.strictEqual(m.cards, null);
  same(m.choices.map((c) => c.name), ["성직후보자의 성소를 위한 추계재", "수도자의 성소를 위한 추계재"]);
});

test("조건부 세트: 조건이 카드 이름이고, 고르면 제목이 그 조건의 이름이다 — 고른 전례일과 본기도는 그대로(사용자 결정 2026-11-05)", () => {
  const transfig = [FOUR[0], FOUR[1], FOUR[2], slot("gospel", "mark", 9, "2-9", "마르 9:2-9")];
  const groups = [group("l1", FOUR, { set_no: 1, set_total: 2 }), group("l2", transfig, { set_no: 2, set_total: 2, set_note: "주의 변모 주일로 지키는 경우" })];
  const base = cardsModel(groups, { name: "사순 2주일" });
  same(base.cards.map((c) => c.name), ["사순 2주일", "주의 변모 주일로 지킬 때"]);
  assert.strictEqual(base.dayName, "사순 2주일");
  const m = cardsModel(groups, { name: "사순 2주일", query: { ...NO_QUERY, set: 2 } });
  assert.strictEqual(m.dayName, "주의 변모 주일");
  assert.strictEqual(m.selected.observance.name, "사순 2주일");
  same(m.colors, ["green"]);
  assert.strictEqual(m.collects[0].id, 59);
  assert.strictEqual(ctx.conditionTitle(null), null);
  assert.strictEqual(ctx.conditionTitle(group("a", FOUR, { set_note: "원본 세트 1" })), null);
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

test("전례독서 목록: 이름은 괄호를 뗀 짧은 이름, title 은 전체 이름 + 상태 표시(ADR-038 §3-1 — 사용자 확정 2026-10-12)", () => {
  const saint = cand(obs("d0321-토마스-크랜머", "토마스 크랜머(캔터베리 대주교, 전례개혁자, 순교자, 1556년)", { rank: "minor_feast", precedence: 7 }));
  const grid = cand(obs("grid:lent-4-weekday-sat", "사순 4주 토요일"));
  const r = resolvedOf("2026-03-21", [saint, grid], saint, { coord: { season: "lent", week: 4, type: "weekday", weekday: "sat", year: "II" } });
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOfFrom({ "d0321-토마스-크랜머": [group(1, FOUR)] }), [], null);
  const choice = m.choices.find((c) => c.candidate === saint);
  assert.ok(choice.name.startsWith("토마스 크랜머") && !choice.name.includes("("), choice.name);
  assert.strictEqual(choice.title, "토마스 크랜머(캔터베리 대주교, 전례개혁자, 순교자, 1556년)");
});

test("상수: 송영 셋 · 영광송 계응 둘 · 슬롯 순서 넷 · 선택 봉헌 목적지 넷(엔진 OPTIONAL_KINDS 와 같다) · 괄호 세트 표지", () => {
  const endings = K("ENDINGS");
  same(Object.keys(plain(endings)), ["A", "B", "C"]);
  assert.ok(endings.A.endsWith("아멘") && endings.C.startsWith("성자께서는"));
  same(plain(K("GLORIA")), { versicle: "영광이 성부와 성자와 성령께", response: "처음과 같이 지금도 그리고 영원히, 아멘." });
  same(plain(K("SLOT_ORDER")), ["first", "psalm", "second", "gospel"]);
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

test("halfVerseRanges: 데이터의 반쪽 절 구간(「8ㄱ」)은 part 를 달고 그대로 둔다 — 이사 7:1-9 에서 7절과 8ㄱ(사용자 결정 2026-11-07)", () => {
  const H = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  same(plain(ctx.halfVerseRanges([[7, 7], [8, 8, "a"]], H({}))), [
    { a: 7, b: 7, aHalf: "", bHalf: "" }, { a: 8, b: 8, aHalf: "", bHalf: "", part: "a" }]);
  // 전례독서의 상 · 하는 다른 절에만 붙는다 — 「사무상 24:2-23상」을 5ㄴ부터 끝까지 고르면(5ㄴ 6 8ㄴ 9 … 순서) 「5ㄴ, 6, 8ㄴ, 9-23상」
  same(plain(ctx.halfVerseRanges([[5, 5, "b"], [6, 6], [8, 8, "b"], [9, 23]], H({ 23: "a" }))), [
    { a: 5, b: 5, aHalf: "", bHalf: "", part: "b" }, { a: 6, b: 6, aHalf: "", bHalf: "" },
    { a: 8, b: 8, aHalf: "", bHalf: "", part: "b" }, { a: 9, b: 23, aHalf: "", bHalf: "상" }]);
});

// ── 제목 영역의 글(캘린더 목록 줄과 같이 쓴다, ADR-038 §2) ──

test("headLinesOf: 제목, 해와 대재일과 기도 주간, 안내, 이름 줄, 다른 전례일의 차례", () => {
  const out = ctx.headLinesOf({
    dayName: "연중 2주 수요일",
    cycle: "홀수해", fast: "minor", resolved: { periods: [{ name: "그리스도인 일치를 위한 기도 주간" }] },
    selectedNote: "1월 17일에서 옮겨 옴", transferNotes: ["누군가 축일을 1월 21일로 옮김"],
    memorialSaints: [cand(obs("s", "파비안(순교자)"))],
    passiveDays: [cand(obs("p", "성 십자가 발견(설명)"), "commemorated")],
    foundingLines: ["1992년 9월 29일 관구설립일"],
    commemorations: [cand(obs("c", "존 웨슬리(복음전도자)"))],
    textlessDays: [cand(obs("t", "가정주일"))],
    dedicationLines: ["강릉성당 축성일"],
    choices: [{ name: "가", suffix: " · 저녁", active: false }, { name: "나", suffix: "", active: true }],
  });
  assert.strictEqual(out.title, "연중 2주 수요일");
  same(out.meta, [{ text: "홀수해", kind: "cycle" }, { text: "소재일", kind: "fast" }, { text: "그리스도인 일치를 위한 기도 주간", kind: "period" }]);
  same(out.notes, ["1월 17일에서 옮겨 옴", "누군가 축일을 1월 21일로 옮김"]);
  same(out.names, ["파비안(순교자) 축일", "성 십자가 발견", "1992년 9월 29일 관구설립일", "존 웨슬리(복음전도자) 기념일", "가정주일", "강릉성당 축성일"]);
  same(out.others, ["가 · 저녁"]);
});

test("headLinesOf: 빈 칸은 빠진다 — 이름이 없으면 줄표", () => {
  const out = ctx.headLinesOf({
    dayName: "", cycle: null, fast: null, resolved: {}, selectedNote: null, transferNotes: [],
    memorialSaints: [], passiveDays: [], foundingLines: [], commemorations: [], textlessDays: [], dedicationLines: [], choices: [],
  });
  same(out, { title: "—", meta: [], notes: [], names: [], others: [] });
});
