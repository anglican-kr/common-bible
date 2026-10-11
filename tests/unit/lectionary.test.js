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

/** 정의 표의 행 꼴 관측일. `extra` 로 rank · color · transfer_to 등을 얹는다. */
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
/** `ResolvedDate` 꼴 — 연중 평일(짝수해)이 기본 좌표. */
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

test("chipLabel · statusSuffix: 밀림 · 옮김 · 선택 봉헌 · 기념 · 기념일 꼬리", () => {
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
});

test("isMutedCandidate: 생략 · 떠남 · 기념일만 흐리다", () => {
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "omitted")), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "transferred_out")), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a", { rank: "commemoration" }))), true);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "commemorated")), false);
  assert.strictEqual(ctx.isMutedCandidate(cand(obs("a", "a"), "optional")), false);
});

// ── 초기 선택 ─────────────────────────────────────────────────────────────────

test("initialCandidate: 승자에 고유 독서가 있으면 승자", () => {
  const feast = cand(obs("d0806-주의-변모", "주의 변모", { rank: "major_feast", precedence: 3, color: "white" }));
  const grid = cand(obs("grid:ordinary-18-weekday-thu", "연중 18주 목요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-08-06", [feast, grid], feast);
  const groupsOf = groupsOfFrom({ "d0806-주의-변모": [group("f", FOUR)], "grid:ordinary-18-weekday-thu": [group("g", FOUR)] });
  assert.strictEqual(ctx.initialCandidate(r, groupsOf), feast);
});

test("initialCandidate: 승자의 독서가 공통뿐이면 격자(미결25 — 책자대로 평일 독서)", () => {
  const saint = cand(obs("d0916-니니안", "니니안(주교)", { rank: "minor_feast", precedence: 7, color: "white", sanctoral_class: "missionary" }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { rank: "feria", precedence: 8, color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, grid], saint);
  const groupsOf = groupsOfFrom({
    "d0916-니니안": [group("common:missionary-s1", FOUR, { common: "missionary", title: "선교사" })],
    "grid:ordinary-24-weekday-wed": [group("g", FOUR)],
  });
  assert.strictEqual(ctx.initialCandidate(r, groupsOf), grid);
});

test("initialCandidate: 격자에 독서가 없으면 승자 그대로 — 공통만 있어도", () => {
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

const TRACKED = [
  group("t1s1", FOUR, { reading_track: 1, set_no: 1, set_total: 2 }),
  group("t1s2", FOUR, { reading_track: 1, set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" }),
  group("t2s1", FOUR, { reading_track: 2, set_no: 1, set_total: 2 }),
  group("t2s2", FOUR, { reading_track: 2, set_no: 2, set_total: 2, set_note: "괄호 선택 구절 포함" }),
];

test("tracksOf · pickTrack: URL > 전례년 기억 > 첫 트랙 — 트랙 없는 날은 null", () => {
  same(plain(ctx.tracksOf(TRACKED)), [1, 2]);
  same(plain(ctx.tracksOf([group("x", FOUR)])), []);
  assert.strictEqual(ctx.pickTrack(TRACKED, 2, 1), 2);
  assert.strictEqual(ctx.pickTrack(TRACKED, null, 2), 2);
  assert.strictEqual(ctx.pickTrack(TRACKED, null, null), 1);
  assert.strictEqual(ctx.pickTrack([group("x", FOUR)], 2, 2), null);
});

test("setsOf · pickSet: 고른 트랙의 세트만, 범위 밖 ?set 은 첫 세트", () => {
  const sets = ctx.setsOf(TRACKED, 2);
  same(sets.map((g) => g.id), ["t2s1", "t2s2"]);
  assert.strictEqual(ctx.pickSet(sets, 2), 1);
  assert.strictEqual(ctx.pickSet(sets, 9), 0);
  assert.strictEqual(ctx.pickSet(sets, null), 0);
  assert.strictEqual(ctx.pickSet([], 1), -1);
  assert.strictEqual(ctx.setsOf(TRACKED, null).length, 4);   // 트랙 없이 부르면 전부
});

test("setLabel: 「1안」「2안」 — 제목이 갈리는 세트(미결12 좁히기 실패)는 제목으로", () => {
  const sets = ctx.setsOf(TRACKED, 1);
  assert.strictEqual(ctx.setLabel(sets, 0), "1안");
  assert.strictEqual(ctx.setLabel(sets, 1), "2안");
  const mixed = [group("a", FOUR, { title: "성탄 밤", set_no: 1 }), group("b", FOUR, { title: "성탄 낮", set_no: 1 })];
  assert.strictEqual(ctx.setLabel(mixed, 0), "성탄 밤");
  const dup = [...mixed, group("c", FOUR, { title: "성탄 낮", set_no: 2 })];
  assert.strictEqual(ctx.setLabel(dup, 1), "성탄 낮 1안");
});

test("setCaption: 파서 내부 표지 「원본 세트 N」은 숨기고 조건 원문은 그대로(미결38)", () => {
  assert.strictEqual(ctx.setCaption(group("a", FOUR, { set_note: "원본 세트 1" })), null);
  assert.strictEqual(ctx.setCaption(group("a", FOUR, { set_note: "주의 변모 주일로 지키는 경우" })), "주의 변모 주일로 지키는 경우");
  assert.strictEqual(ctx.setCaption(group("a", FOUR, { set_note: "괄호 선택 구절 포함" })), "괄호 선택 구절 포함");
  assert.strictEqual(ctx.setCaption(group("a", FOUR)), null);
});

test("slotsInOrder: 이름으로 first → psalm → second → gospel, 위치는 무시, 없는 슬롯은 건너뛴다", () => {
  const shuffled = [FOUR[3], FOUR[1], FOUR[0]];   // gospel · psalm · first — second 없음
  same(ctx.slotsInOrder(group("g", shuffled)).map((s) => s.slot), ["first", "psalm", "gospel"]);
  same(ctx.slotsInOrder(null), []);
});

// ── 본기도 ────────────────────────────────────────────────────────────────────

test("collectsOrder: 고른 관측일이 앞 — proper · transferred_in · commemorated 만 따라오고 omitted · transferred_out · optional · 사계재는 뺀다", () => {
  const feast = cand(obs("d1206-성-니콜라", "성 니콜라"), "transferred_in", { from: "2026-12-06" });
  const grid = cand(obs("grid:advent-2-weekday-mon", "대림 2주 월요일"));
  const omitted = cand(obs("d1207-암브로스", "암브로스"), "omitted");
  const gone = cand(obs("d1210-x", "떠난 축일"), "transferred_out", { to: "2026-12-11" });
  const optional = cand(obs("d0806-주의-변모", "주의 변모"), "optional", { from: "2026-08-06" });
  const ember = cand(obs("t-동계재", "동계재", { penitential: true }));
  const thanks = cand(obs("t-추수감사주일", "추수감사주일"), "commemorated");
  const entries = [feast, grid, omitted, gone, optional, ember, thanks].map((c) => ({ candidate: c, collects: [collect(c.observance.id, "…")] }));
  const order = ctx.collectsOrder(entries, grid);
  same(order.map((b) => [b.candidate.observance.id, b.selected]),
    [["grid:advent-2-weekday-mon", true], ["d1206-성-니콜라", false], ["t-추수감사주일", false]]);
});

test("collectsOrder: 고른 관측일이 사계재면 그 본기도가 앞에 온다(고를 때만 보인다)", () => {
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일"));
  const ember = cand(obs("t-추계재", "추계재", { penitential: true }));
  const entries = [grid, ember].map((c) => ({ candidate: c, collects: [collect(c.observance.id, "…")] }));
  same(ctx.collectsOrder(entries, ember).map((b) => b.candidate.observance.id), ["t-추계재", "grid:ordinary-24-weekday-wed"]);
});

test("collectsOrder: 빈 본기도(기념일)는 열거에 오르지 않는다 — 고른 것이라도", () => {
  const memo = cand(obs("d0101-세계평화", "세계평화를 위한 기도일", { rank: "commemoration" }));
  const feast = cand(obs("d0101-거룩한-이름-예수", "거룩한 이름 예수"));
  const entries = [{ candidate: feast, collects: [collect(1, "…")] }, { candidate: memo, collects: [] }];
  same(ctx.collectsOrder(entries, memo).map((b) => [b.candidate.observance.id, b.selected]), [["d0101-거룩한-이름-예수", false]]);
});

test("pickCollect · endingCodeOf: collect_no 로 고르고 없으면 첫 대체안, 코드가 없으면 송영 A", () => {
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

test("pairOf: 목적지 주일 — 승자(격자 주일)와 optional 후보", () => {
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

test("headerColors: 승자가 아닌 비격자 후보를 고르면 그 후보의 색 하나 — 사계재 자 · 성 토요일 홍", () => {
  const saint = cand(obs("d0916-니니안", "니니안", { color: "white" }));
  const ember = cand(obs("t-추계재", "추계재", { color: "violet", penitential: true }));
  const grid = cand(obs("grid:ordinary-24-weekday-wed", "연중 24주 수요일", { color: "green" }));
  const r = resolvedOf("2026-09-16", [saint, ember, grid], saint, { color: "white", colors: ["violet", "white"] });
  same(plain(ctx.headerColors(r, ember)), { colors: ["violet"], colorAlt: [], ownColor: true });
  // 격자를 골라도 그날 색 그대로(격자는 절기 바탕색을 들고 있을 뿐이다) — 미결25 의 초기 선택이 색을 바꾸지 않는다.
  same(plain(ctx.headerColors(r, grid).colors), ["violet", "white"]);
  // 승자를 고르면 그날 색(병기 포함).
  same(plain(ctx.headerColors(r, saint).colors), ["violet", "white"]);
  // 성 토요일: 승자 부활밤은 그날 색(홍 — 미결20 잠정), 성 토요일 후보를 고르면 그 행의 홍.
  const vigil = cand(obs("t-부활밤", "부활밤", { color: "white", precedence: 1 }));
  const holySat = cand(obs("t-성-토요일", "성 토요일", { color: "red" }));
  const hs = resolvedOf("2026-04-04", [vigil, holySat], vigil, { color: "red", colors: ["red"] });
  same(plain(ctx.headerColors(hs, vigil).colors), ["red"]);
  same(plain(ctx.headerColors(hs, holySat)), { colors: ["red"], colorAlt: [], ownColor: true });
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

test("wantsGloria: 전례시편은 언제나, 송가는 gloria:false 가 아닐 때, 다른 슬롯 · 일반 성서는 아니다", () => {
  const psalm = slot("psalm", "lps", 23, "all", "시편 23");
  assert.strictEqual(ctx.wantsGloria(psalm, CHAPTER), true);
  const cant = slot("psalm", "cant", 11, "all", "루가 1:68-79(즈가리야 송가)");
  assert.strictEqual(ctx.wantsGloria(cant, { book_id: "cant", chapter: 11, verses: [] }), true);
  assert.strictEqual(ctx.wantsGloria(cant, { book_id: "cant", chapter: 3, gloria: false, verses: [] }), false);
  assert.strictEqual(ctx.wantsGloria(cant, null), false);   // 장을 못 불러오면 붙이지 않는다
  assert.strictEqual(ctx.wantsGloria(slot("psalm", "dan", 3, "all", "다니 3"), CHAPTER), false);
  assert.strictEqual(ctx.wantsGloria(slot("first", "lps", 23, "all", "시편 23"), CHAPTER), false);
});

test("canticleTitleOf: 장 제목의 한국어 부분만", () => {
  assert.strictEqual(ctx.canticleTitleOf({ chapter_title: "즈가리야 송가 Benedictus Dominus Deus" }), "즈가리야 송가");
  assert.strictEqual(ctx.canticleTitleOf({ chapter_title: "창조송가 Benedicite, omnia opera Domini" }), "창조송가");
  assert.strictEqual(ctx.canticleTitleOf(null), "");
});

// ── buildLectionaryModel ──────────────────────────────────────────────────────

/** 사계재 날(2026-09-16 꼴) — 승자 성인(공통만) · 사계재(세트 둘) · 격자(지정 독서). */
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

test("buildLectionaryModel: 사계재 날 — 초기 선택은 격자, 색은 병기, 칩 셋, 본기도는 격자 → 성인 순", () => {
  const { r, groupsOf, entries, grid } = emberDay();
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, grid);
  assert.strictEqual(m.initial, grid);
  same(plain(m.colors), ["violet", "white"]);
  assert.strictEqual(m.ownColor, false);
  same(m.chips.map((c) => [c.label, c.active]),
    [["니니안", false], ["추계재", false], ["연중 24주 수요일 (짝수해)", true]]);
  same(m.collects.map((b) => [b.candidate.observance.id, b.selected]),
    [["grid:ordinary-24-weekday-wed", true], ["d0916-니니안", false]]);   // 사계재는 고를 때만
  assert.strictEqual(m.ending, "A");
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

test("buildLectionaryModel: 추계재를 고르면 색은 자 하나, 세트 둘, 본기도는 추계재 → 격자 → 성인, 송영은 마지막 본기도의 코드", () => {
  const { r, groupsOf, entries, ember } = emberDay();
  const m = ctx.buildLectionaryModel(r, { obs: "t-추계재", track: null, set: 2, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.selected, ember);
  same(plain(m.colors), ["violet"]);
  assert.strictEqual(m.ownColor, true);
  assert.strictEqual(m.sets.length, 2);
  assert.strictEqual(m.setIndex, 1);
  assert.strictEqual(m.group.id, "ember-s2");
  // 고른 것이 앞, 나머지는 candidates 순(성인 → 격자) — 재배열만 하고 재조회하지 않는다.
  same(m.collects.map((b) => b.candidate.observance.id), ["t-추계재", "d0916-니니안", "grid:ordinary-24-weekday-wed"]);
  assert.strictEqual(m.ending, "A");   // 마지막은 격자 평일(A)
  same(plain(m.hrefs.sets), ["/lectionary/2026-09-16?obs=t-%EC%B6%94%EA%B3%84%EC%9E%AC", "/lectionary/2026-09-16?obs=t-%EC%B6%94%EA%B3%84%EC%9E%AC&set=2"]);
});

test("buildLectionaryModel: 사계재 혼자 고른 날의 송영은 그 본기도의 코드(C)", () => {
  const { r, groupsOf, ember } = emberDay();
  const entries = [{ candidate: ember, collects: [collect(231, "성직자의 성소", { ending: "C" })] }];
  const m = ctx.buildLectionaryModel(r, { obs: "t-추계재", track: null, set: null, collect: null }, groupsOf, entries, null);
  assert.strictEqual(m.ending, "C");
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

test("buildLectionaryModel: 트랙 — 전례년 기억이 기본, URL 이 이기고, href 는 기본값을 생략한다", () => {
  const sunday = cand(obs("grid:ordinary-11-sunday", "연중 11주일", { rank: "sunday", precedence: 5, color: "green" }));
  const r = resolvedOf("2026-06-14", [sunday], sunday, { coord: { season: "ordinary", week: 11, type: "sunday", weekday: null, year: "A" } });
  const groupsOf = groupsOfFrom({ "grid:ordinary-11-sunday": TRACKED });
  const entries = [{ candidate: sunday, collects: [collect(59, "…")] }];
  const remembered = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, groupsOf, entries, 2);
  assert.strictEqual(remembered.track, 2);
  assert.strictEqual(remembered.group.id, "t2s1");
  assert.strictEqual(remembered.chips[0].label, "연중 11주일 (가해, 독서 2)");
  same(plain(remembered.hrefs.tracks), [
    { track: 1, href: "/lectionary/2026-06-14?track=1", active: false },
    { track: 2, href: "/lectionary/2026-06-14", active: true },
  ]);
  const overridden = ctx.buildLectionaryModel(r, { obs: null, track: 1, set: 2, collect: null }, groupsOf, entries, 2);
  assert.strictEqual(overridden.track, 1);
  assert.strictEqual(overridden.group.id, "t1s2");
  same(plain(overridden.hrefs.sets), ["/lectionary/2026-06-14?track=1", "/lectionary/2026-06-14?track=1&set=2"]);
  assert.strictEqual(overridden.tracks.length, 2);
});

test("buildLectionaryModel: 본기도 대체안 — ?collect 는 collect_no, href 와 송영이 따라간다", () => {
  const easter = cand(obs("t-부활대축일", "부활대축일", { rank: "principal", precedence: 1, color: "white" }));
  const r = resolvedOf("2026-04-05", [easter], easter, { coord: { season: "easter", week: 1, type: "sunday", weekday: null, year: "A" }, color: "white", colors: ["white"] });
  const groupsOf = groupsOfFrom({ "t-부활대축일": [group("e1", FOUR, { set_no: 1, set_total: 2, set_note: "원본 세트 1" }), group("e2", FOUR, { set_no: 2, set_total: 2, set_note: "원본 세트 2" })] });
  const entries = [{ candidate: easter, collects: [collect(222, "a", { collect_no: 1, collect_total: 3 }), collect(223, "b", { collect_no: 2, collect_total: 3 }), collect(224, "c", { collect_no: 3, collect_total: 3, ending: "C" })] }];
  const m = ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: 3 }, groupsOf, entries, null);
  assert.strictEqual(m.collectIndex, 2);
  assert.strictEqual(m.ending, "C");
  same(plain(m.hrefs.collects), ["/lectionary/2026-04-05", "/lectionary/2026-04-05?collect=2", "/lectionary/2026-04-05?collect=3"]);
  assert.strictEqual(m.fast, null);
});

test("buildLectionaryModel: 후보가 없으면 null", () => {
  const r = resolvedOf("2026-08-13", [], null);
  assert.strictEqual(ctx.buildLectionaryModel(r, { obs: null, track: null, set: null, collect: null }, () => [], [], null), null);
});

test("상수: 송영 셋 · 영광송 계응 둘 · 슬롯 라벨 넷", () => {
  const endings = K("ENDINGS");
  same(Object.keys(plain(endings)), ["A", "B", "C"]);
  assert.ok(endings.A.endsWith("아멘") && endings.C.startsWith("성자께서는"));
  same(plain(K("GLORIA")), { versicle: "영광이 성부와 성자와 성령께", response: "처음과 같이 지금도 그리고 영원히, 아멘." });
  same(plain(K("SLOT_ORDER")), ["first", "psalm", "second", "gospel"]);
  same(plain(K("OPTIONAL_TRANSFER_KINDS")), ["nearby_sunday", "sunday_0102_0108", "sunday_1030_1105", "easter7_sunday"]);
});
