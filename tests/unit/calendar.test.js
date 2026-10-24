// ── Unit tests for js/app/calendar.js — CALENDAR_MODEL block ─────────────────
// Run with: node --test tests/unit/calendar.test.js
//
// Same vm + BEGIN/END marker slice approach as lectionary.test.js. Only the pure
// CALENDAR_MODEL block is covered — which name a month cell shows, which names a
// row lists, which colours the dots wear, where the liturgical year turns, and
// how a month lays out on the 6 × 7 grid. The DOM renderer (renderCalendarView)
// needs the engine preload and is e2e's job (tests/e2e/test_calendar_view.py,
// ADR-013 dual-track). Real-table cases live in calendar.data.test.js
// (설계서 §7 — 공개 CI 는 data/ 가 없다).
//
// The engine's LITURGICAL_CORE + LITURGICAL_LOOKUP blocks and lectionary's
// LECTIONARY_MODEL block (+ verse-spec's VERSE_SPEC, which it references) are
// sliced in first, so parseDate / addDays / liturgicalYearOf / shortName /
// statusSuffix are the real functions. `resolve` is injected — the cases hand
// the grid synthetic `ResolvedDate` objects.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const CALENDAR_SOURCE = fs.readFileSync(path.join(ROOT, "js/app/calendar.js"), "utf8");
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

const BLOCKS = [
  ["LITURGICAL_CORE", ENGINE_SOURCE],
  ["LITURGICAL_LOOKUP", ENGINE_SOURCE],
  ["VERSE_SPEC", VERSE_SPEC_SOURCE],
  ["LECTIONARY_MODEL", LECTIONARY_SOURCE],
  ["CALENDAR_MODEL", CALENDAR_SOURCE],
];

function load() {
  const ctx = {
    Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
    parseInt, isNaN, Date, NaN, URLSearchParams,
  };
  vm.createContext(ctx);
  // 엔진 모듈 상태는 블록 밖에 있어 prelude 로 재선언한다(설계서 §3.3).
  vm.runInContext("const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map(); const activatedOptionals = new Set();",
    ctx, { filename: "prelude" });
  for (const [name, source] of BLOCKS) vm.runInContext(extractBlock(name, source), ctx, { filename: name });
  return ctx;
}

const ctx = load();
// vm 이 만든 배열 · 객체는 realm 이 달라 deepStrictEqual 이 프로토타입에서 틀린다 — 양쪽을 정규화한다.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

// ── 합성 재료 ─────────────────────────────────────────────────────────────────

const obs = (id, name, extra = {}) => ({
  id, kind: id.startsWith("t-") || id.startsWith("grid:") ? "temporal" : "sanctoral", name,
  rank: null, precedence: null, color: null, color_alt: null, transferable: false, transfer_to: null, ...extra,
});
const cand = (observance, status = "proper", extra = {}) => ({ observance, status, ...extra });
const WEEKDAY = { season: "ordinary", week: 28, type: "weekday", weekday: "thu", year: "II" };
const SUNDAY = (week, year = "A", season = "ordinary") => ({ season, week, type: "sunday", weekday: null, year });
/** `ResolvedDate` 형식 — 연중 평일(짝수해)이 기본 좌표, 대표는 첫 후보. */
const resolvedOf = (date, candidates, extra = {}) => ({
  date, coord: WEEKDAY, candidates, official: candidates[0] || null, periods: [],
  color: "green", colors: ["green"], colorAlt: null, ...extra,
});
const grid = (id, name) => cand(obs(`grid:${id}`, name));
/** 그날의 평범한 평일 — 이름 없는 격자 하나. */
const plainDay = (date) => resolvedOf(date, [grid("ordinary-28-weekday-thu", "연중 28주 목요일")]);

// ── 블록 이름이 겹치지 않는다 ─────────────────────────────────────────────────

test("CALENDAR_MODEL 의 최상위 이름이 엔진 · 전례독서 · verse-spec 블록과 겹치지 않는다 — 한 vm 에서 함수가 조용히 덮이지 않게", () => {
  const names = (src) => new Set([...src.matchAll(/^(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]));
  const mine = names(extractBlock("CALENDAR_MODEL", CALENDAR_SOURCE));
  assert.ok(mine.has("buildMonthGrid") && mine.has("calendarDay"), "이름 추출이 동작한다");
  for (const [name, source] of BLOCKS.slice(0, -1)) {
    const clash = [...names(extractBlock(name, source))].filter((n) => mine.has(n));
    same(clash, [], `${name} 와 겹치는 이름`);
  }
});

// ── 달 주소 ───────────────────────────────────────────────────────────────────

test("parseMonthParam: YYYY-MM 만 · 달 1~12 · 교회력을 계산하는 연도(1583~9999) 안", () => {
  same(ctx.parseMonthParam("2026-10"), { y: 2026, m: 10 });
  same(ctx.parseMonthParam("9999-12"), { y: 9999, m: 12 });
  same(ctx.parseMonthParam("1583-01"), { y: 1583, m: 1 });
  for (const bad of ["2026-13", "2026-00", "2026-1", "26-10", "2026-10-15", "abcd-10", "1582-12", "10000-01", "", null, undefined]) {
    assert.strictEqual(ctx.parseMonthParam(bad), null, String(bad));
  }
});

test("monthHref: 해를 넘는 앞뒤 달 · 계산 범위 밖은 null(이전/다음 단추가 사라진다)", () => {
  assert.strictEqual(ctx.monthHref(2026, 0), "/calendar/2025-12");
  assert.strictEqual(ctx.monthHref(2026, 13), "/calendar/2027-01");
  assert.strictEqual(ctx.monthHref(2026, 7), "/calendar/2026-07");
  assert.strictEqual(ctx.monthHref(1583, 0), null);
  assert.strictEqual(ctx.monthHref(9999, 13), null);
});

// ── 월간 표의 배치 ────────────────────────────────────────────────────────────

test("buildMonthGrid: 2026년 10월 — 1일(목)이 든 주의 일요일 9.27 부터 6주 42칸, 앞뒤 달 · 오늘 표시", () => {
  const calls = [];
  const m = ctx.buildMonthGrid(2026, 10, "2026-10-15", (d) => { calls.push(d); return plainDay(d); });
  assert.strictEqual(m.title, "2026년 10월");
  assert.strictEqual(m.weeks.length, 6);
  for (const w of m.weeks) assert.strictEqual(w.length, 7);
  const cells = m.weeks.flat();
  assert.strictEqual(cells[0].date, "2026-09-27");
  assert.strictEqual(cells[41].date, "2026-11-07");
  assert.strictEqual(cells.filter((c) => c.inMonth).length, 31);
  assert.strictEqual(cells[4].date, "2026-10-01");
  assert.ok(!cells[3].inMonth && cells[4].inMonth && cells[34].inMonth && !cells[35].inMonth);
  same(cells.filter((c) => c.isToday).map((c) => c.date), ["2026-10-15"]);
  for (let i = 0; i < 42; i++) assert.strictEqual(cells[i].weekday, i % 7, cells[i].date);   // 일요일 시작
  assert.strictEqual(calls.length, 42);   // 칸마다 한 번 — 앞뒤 달 칸도 엔진에 묻는다
  same(m.hrefs, { prev: "/calendar/2026-09", next: "/calendar/2026-11", today: "/calendar" });
  assert.strictEqual(cells[0].href, "/lectionary/2026-09-27");
});

test("buildMonthGrid: 1일이 일요일인 달(2026년 2월 — 4주로 끝나는 달)도 6주 — 줄 수가 달마다 바뀌지 않는다", () => {
  const cells = ctx.buildMonthGrid(2026, 2, "2026-10-15", plainDay).weeks.flat();
  assert.strictEqual(cells.length, 42);
  assert.strictEqual(cells[0].date, "2026-02-01");
  assert.strictEqual(cells[27].date, "2026-02-28");
  assert.ok(cells[27].inMonth && !cells[28].inMonth);
  assert.strictEqual(cells[41].date, "2026-03-14");
});

test("buildMonthGrid: 윤년 2월(2028)은 29일까지 · 12월은 다음 해 1월로 넘어간다", () => {
  const feb = ctx.buildMonthGrid(2028, 2, "2026-10-15", plainDay).weeks.flat();
  assert.strictEqual(feb[0].date, "2028-01-30");
  assert.ok(feb.some((c) => c.date === "2028-02-29" && c.inMonth));
  const dec = ctx.buildMonthGrid(2026, 12, "2026-10-15", plainDay);
  const cells = dec.weeks.flat();
  assert.strictEqual(cells[0].date, "2026-11-29");
  assert.strictEqual(cells[41].date, "2027-01-09");
  assert.ok(cells.some((c) => c.date === "2027-01-01" && !c.inMonth));
  same(dec.hrefs, { prev: "/calendar/2026-11", next: "/calendar/2027-01", today: "/calendar" });
});

test("buildMonthGrid: 계산 범위 끝(1583년 1월 · 9999년 12월) — 범위 밖 칸은 엔진에 묻지 않고 링크가 없다", () => {
  const asked = [];
  const jan = ctx.buildMonthGrid(1583, 1, "2026-10-15", (d) => { asked.push(d); return plainDay(d); });
  const first = jan.weeks.flat();
  assert.strictEqual(first[0].date.slice(0, 4), "1582");
  assert.strictEqual(first[0].href, null);
  same(first[0].colors, []);
  assert.ok(asked.every((d) => d >= "1583-01-01"), asked[0]);
  assert.strictEqual(jan.hrefs.prev, null);
  assert.strictEqual(jan.hrefs.next, "/calendar/1583-02");

  const dec = ctx.buildMonthGrid(9999, 12, "2026-10-15", plainDay);
  const last = dec.weeks.flat();
  const beyond = last.filter((c) => c.href === null);
  assert.ok(beyond.length > 0 && beyond.every((c) => !c.inMonth));
  assert.ok(beyond.every((c) => c.day >= 1 && c.day <= 31), "범위 밖 칸도 날 번호는 있다");
  assert.strictEqual(dec.hrefs.next, null);
});

// ── 칸의 이름 하나(사용자 결정 2026-10-15) ────────────────────────────────────

test("calendarDay: 대표가 성인 축일이면 그 이름 — 괄호 설명은 떼고 전체 이름은 title", () => {
  const teresa = cand(obs("d1015-아빌라의-데레사", "아빌라의 데레사(1592년)", { rank: "minor_feast", color: "white" }));
  const d = ctx.calendarDay("2026-10-15", resolvedOf("2026-10-15", [teresa, grid("ordinary-28-weekday-thu", "연중 28주 목요일")],
    { color: "white", colors: ["white"] }));
  assert.strictEqual(d.cellName, "아빌라의 데레사");
  assert.strictEqual(d.cellTitle, "아빌라의 데레사(1592년)");
  same(d.primary, { name: "아빌라의 데레사", title: "아빌라의 데레사(1592년)", suffix: "", away: false });
  same(d.others, []);   // 격자 후보(연중 28주 목요일)는 줄에도 싣지 않는다 — 독서 화면의 칩이 맡는다
  same(d.colors, ["white"]);
  assert.strictEqual(d.cycle, null);   // 평일은 주기를 싣지 않는다
  assert.strictEqual(d.href, "/lectionary/2026-10-15");
});

test("calendarDay: 주일은 격자 이름을 「연중29주」처럼 줄인다(ADR-038 §2) — 줄과 링크 이름은 그대로", () => {
  const sunday = grid("ordinary-29-sunday", "연중 29주일");
  const d = ctx.calendarDay("2026-10-18", resolvedOf("2026-10-18", [sunday], { coord: SUNDAY(29) }));
  assert.strictEqual(d.cellName, "연중29주");
  assert.strictEqual(d.primary.name, "연중 29주일");
  assert.strictEqual(d.cycle, "가해");
  assert.strictEqual(ctx.cellLabel("대림1주일"), "대림1주");
  assert.strictEqual(ctx.cellLabel("부활 7주일"), "부활7주");
  assert.strictEqual(ctx.cellLabel("성탄 1주일"), "성탄1주");
  assert.strictEqual(ctx.cellLabel("성지주일"), "성지주일");   // 번호 없는 주일은 그대로
  assert.strictEqual(ctx.cellLabel("삼위일체 주일"), "삼위일체 주일");
  assert.strictEqual(ctx.cellLabel("연중 28주 목요일"), "연중 28주 목요일");
});

test("calendarDay: 대표가 이름 없는 평일이면 그날 지키는 이름 있는 후보 — 사계재 · 기념일, 없으면 빈 이름", () => {
  const friday = grid("ordinary-24-weekday-fri", "연중 24주 금요일");
  const ember = cand(obs("t-추계재", "추계재", { rank: "feria", precedence: 8, color: "violet" }));
  const d = ctx.calendarDay("2026-09-18", resolvedOf("2026-09-18", [friday, ember], { color: "violet", colors: ["violet"] }));
  assert.strictEqual(d.cellName, "추계재");
  assert.strictEqual(d.primary.name, "연중 24주 금요일");   // 줄의 첫 이름은 그날의 대표
  same(d.others.map((o) => o.name), ["추계재"]);
  same(d.colors, ["violet"]);

  const plain = ctx.calendarDay("2026-10-16", plainDay("2026-10-16"));
  assert.strictEqual(plain.cellName, "");
  assert.strictEqual(plain.primary.name, "연중 28주 목요일");
});

test("calendarDay: 저녁 전례(evening)는 칸 이름이 되지 않는다 — 12.24 평일 칸은 이름 없이, 성탄 밤은 줄에 「· 저녁」(PR #349 리뷰)", () => {
  // 12.24 의 대표는 대림 평일(격자)이고 성탄 밤은 그날 저녁 후보다(설계서 R-6.1-evening) — 칸에 실으면 「성탄 밤」 이름에 그날 색(자)
  // 점이 붙는다. 주일인 12.24 와 성 토요일(대표가 temporal 행)은 원래 저녁 후보를 고를 일이 없었다
  const weekday = grid("advent-4-weekday-thu", "대림 4주 목요일");
  const night = cand(obs("d1225-성탄-밤", "성탄 밤", { rank: "principal", precedence: 1, color: "white" }), "proper", { evening: true });
  const d = ctx.calendarDay("2026-12-24", resolvedOf("2026-12-24", [weekday, night],
    { coord: { season: "advent", week: 4, type: "weekday", weekday: "thu", year: "II" }, color: "violet", colors: ["violet"] }));
  assert.strictEqual(d.cellName, "");
  assert.strictEqual(ctx.dayAriaLabel(d, false), "12월 24일 목요일, 대림 4주 목요일, 자색");
  same(d.others.map((o) => o.name + o.suffix), ["성탄 밤 · 저녁"]);   // 줄(2단계)에는 남는다
});

test("calendarDay: 고유명 평일(성주간 월~수 · 재의 수요일 후 목~토)은 격자여도 이름을 단다 — 엔진 표지 properWeekday 로 가린다", () => {
  // 좌표를 일부러 번호 있는 형식으로 둔다 — 엔진이 주 번호를 매겨도 표지만 있으면 칸 이름은 그대로다(PR #348 리뷰가 짚은 드리프트)
  const holyMon = cand(obs("grid:lent-6-weekday-mon", "성주간 월요일", { properWeekday: true }));
  const d = ctx.calendarDay("2026-03-30", resolvedOf("2026-03-30", [holyMon],
    { coord: { season: "lent", week: 6, type: "weekday", weekday: "mon", year: "A" }, color: "red", colors: ["red"] }));
  assert.strictEqual(d.cellName, "성주간 월요일");
  const lentTue = grid("lent-2-weekday-tue", "사순 2주 화요일");
  const plain = ctx.calendarDay("2026-03-03", resolvedOf("2026-03-03", [lentTue],
    { coord: { season: "lent", week: 2, type: "weekday", weekday: "tue", year: "A" }, color: "violet", colors: ["violet"] }));
  assert.strictEqual(plain.cellName, "");   // 번호 있는 사순 평일은 이름 없는 평일
});

test("calendarDay: 좌표가 고유명 평일과 같아도(lent, null, weekday) 표지가 없는 격자는 이름 없는 평일 — 뷰는 좌표를 읽지 않는다", () => {
  // 성 목 · 금 · 토의 격자(「성주간 X요일」)가 이 좌표다 — 그날의 대표는 temporal 행이지만, 격자가 대표로 와도 칸은 비어야 한다
  const holyThu = grid("lent-x-weekday-thu", "성주간 목요일");
  const d = ctx.calendarDay("2026-04-02", resolvedOf("2026-04-02", [holyThu],
    { coord: { season: "lent", week: null, type: "weekday", weekday: "thu", year: "A" }, color: "red", colors: ["red"] }));
  assert.strictEqual(d.cellName, "");
  assert.strictEqual(ctx.dayAriaLabel(d, false), "4월 2일 목요일, 성주간 목요일, 적색");   // 이름 없는 평일 칸 — 링크 이름은 대표 이름
});

test("calendarDay: 옮겨 간 · 생략된 후보는 칸 이름이 되지 않고 줄에서 흐리게(away) — 꼬리말은 칩과 같은 말", () => {
  const sunday = grid("ordinary-29-sunday", "연중 29주일");
  const luke = cand(obs("d1018-성-루가", "성 루가(복음사가)", { rank: "major_feast", color: "red" }), "transferred_out",
    { to: "2026-10-19", displacedBy: sunday.observance.id });
  const d = ctx.calendarDay("2026-10-18", resolvedOf("2026-10-18", [sunday, luke], { coord: SUNDAY(29) }));
  assert.strictEqual(d.cellName, "연중29주");
  same(d.others, [{ name: "성 루가", title: "성 루가(복음사가)", suffix: " · → 10월 19일", away: true }]);

  const weekday = grid("ordinary-29-weekday-tue", "연중 29주 화요일");
  const omitted = cand(obs("d1020-x", "어떤 성인(주교)", { rank: "minor_feast" }), "omitted", { displacedBy: "guard:holy-week" });
  const e = ctx.calendarDay("2026-10-20", resolvedOf("2026-10-20", [weekday, omitted]));
  assert.strictEqual(e.cellName, "");   // 생략된 축일은 그날의 이름이 아니다
  same(e.others.map((o) => [o.name, o.suffix, o.away]), [["어떤 성인", " · 생략", true]]);
});

test("calendarDay: 선택 봉헌(「옮겨 지킬 수 있음」)은 월간 칸에 없고 줄의 보조 이름 — 흐리지 않는다", () => {
  const sunday = grid("easter-7-sunday", "부활 7주일");
  const ascension = cand(obs("t-승천대축일", "승천대축일", { rank: "principal", precedence: 1, color: "white" }), "optional", { from: "2026-05-14" });
  const d = ctx.calendarDay("2026-05-17", resolvedOf("2026-05-17", [ascension, sunday],
    { official: sunday, coord: SUNDAY(7, "A", "easter"), color: "white", colors: ["white"] }));
  assert.strictEqual(d.cellName, "부활7주");
  same(d.others, [{ name: "승천대축일", title: "승천대축일", suffix: " · 5월 14일에서 옮겨 지킬 수 있음", away: false }]);
});

test("calendarDay: 옮겨 온 대표는 줄에서 「… 에서 옮겨 옴」, 기념만 하는 후보는 「기념만」", () => {
  const james = cand(obs("d0725-사도-성-장-야고보", "사도 성 장 야고보", { rank: "major_feast", color: "red" }), "transferred_in",
    { from: "2027-07-25", displacedBy: "grid:ordinary-17-sunday" });
  const anne = cand(obs("d0726-안나와-요아킴", "안나와 요아킴(성모 마리아의 양친)", { rank: "major_feast", color: "white" }), "commemorated",
    { displacedBy: james.observance.id });
  const d = ctx.calendarDay("2027-07-26", resolvedOf("2027-07-26", [anne, james, grid("ordinary-17-weekday-mon", "연중 17주 월요일")],
    { official: james, color: "red", colors: ["red"] }));
  assert.strictEqual(d.cellName, "사도 성 장 야고보");
  same(d.primary, { name: "사도 성 장 야고보", title: "사도 성 장 야고보", suffix: " · 7월 25일에서 옮겨 옴", away: false });
  same(d.others, [{ name: "안나와 요아킴", title: "안나와 요아킴(성모 마리아의 양친)", suffix: " · 기념만", away: false }]);
});

test("calendarDay: 색은 그날의 정식 색(병기 포함) — 선택 대체색(장미 · 청)은 싣지 않는다 · colors 가 없으면 color 하나", () => {
  const ninian = cand(obs("d0916-니니안", "니니안(갈로웨이의 주교)", { color: "white" }));
  const ember = cand(obs("t-추계재", "추계재", { color: "violet" }));
  const d = ctx.calendarDay("2026-09-16", resolvedOf("2026-09-16", [ninian, ember], { color: "white", colors: ["violet", "white"] }));
  same(d.colors, ["violet", "white"]);
  const gaudete = ctx.calendarDay("2026-12-13", resolvedOf("2026-12-13", [grid("advent-3-sunday", "대림 3주일")],
    { coord: SUNDAY(3, "B", "advent"), color: "violet", colors: ["violet"], colorAlt: ["rose", "blue"] }));
  same(gaudete.colors, ["violet"]);
  const legacy = ctx.calendarDay("2026-10-16", resolvedOf("2026-10-16", [grid("ordinary-28-weekday-fri", "연중 28주 금요일")],
    { color: "green", colors: [] }));
  same(legacy.colors, ["green"]);
});

test("calendarDay: 전례년 첫날(대림 1주일 — 엔진 liturgicalYearOf 가 바뀌는 날)에 「나해 시작」, 그 전날 · 다음 주일엔 없다", () => {
  const advent1 = cand(obs("t-대림1주일", "대림1주일", { rank: "privileged_sunday", color: "violet" }));
  const d = ctx.calendarDay("2026-11-29", resolvedOf("2026-11-29", [advent1], { coord: SUNDAY(1, "B", "advent"), color: "violet", colors: ["violet"] }));
  assert.strictEqual(d.yearStart, "나해 시작");
  assert.strictEqual(d.cycle, "나해");
  assert.strictEqual(d.cellName, "대림1주");
  const eve = ctx.calendarDay("2026-11-28", plainDay("2026-11-28"));
  assert.strictEqual(eve.yearStart, null);
  const advent2 = ctx.calendarDay("2026-12-06", resolvedOf("2026-12-06", [grid("advent-2-sunday", "대림 2주일")],
    { coord: SUNDAY(2, "B", "advent"), color: "violet", colors: ["violet"] }));
  assert.strictEqual(advent2.yearStart, null);
  assert.strictEqual(advent2.cycle, "나해");
});

test("calendarDay: 엔진이 못 푼 날(null)은 날짜만 — 링크 · 이름 · 색 없음", () => {
  same(ctx.calendarDay("1582-12-31", null), {
    date: "1582-12-31", day: 31, weekday: 5, href: null, cellName: "", cellTitle: "", cellSuffix: "",
    primary: null, others: [], colors: [], cycle: null, yearStart: null,
  });
});

// ── 링크 이름(접근성) ─────────────────────────────────────────────────────────

test("dayAriaLabel: 「오늘, 10월 15일 목요일, 아빌라의 데레사, 백색」 — 색 이름은 글자로(색만으로 전하지 않는다)", () => {
  const teresa = cand(obs("d1015-아빌라의-데레사", "아빌라의 데레사(1592년)", { color: "white" }));
  const d = ctx.calendarDay("2026-10-15", resolvedOf("2026-10-15", [teresa], { color: "white", colors: ["white"] }));
  assert.strictEqual(ctx.dayAriaLabel(d, true), "오늘, 10월 15일 목요일, 아빌라의 데레사, 백색");
  assert.strictEqual(ctx.dayAriaLabel(d, false), "10월 15일 목요일, 아빌라의 데레사, 백색");
  // 이름 없는 평일도 링크 이름에는 그날의 이름이 있다 · 병기 색은 둘 다
  const ember = ctx.calendarDay("2026-09-16", resolvedOf("2026-09-16",
    [cand(obs("d0916-니니안", "니니안(주교)", { color: "white" })), cand(obs("t-추계재", "추계재", { color: "violet" }))],
    { color: "white", colors: ["violet", "white"] }));
  assert.strictEqual(ctx.dayAriaLabel(ember, false), "9월 16일 수요일, 니니안, 자색 · 백색");
  const advent1 = ctx.calendarDay("2026-11-29", resolvedOf("2026-11-29", [cand(obs("t-대림1주일", "대림1주일"))],
    { coord: SUNDAY(1, "B", "advent"), color: "violet", colors: ["violet"] }));
  assert.strictEqual(ctx.dayAriaLabel(advent1, false), "11월 29일 일요일, 대림1주, 나해 시작, 자색");
  const blank = ctx.calendarDay("1582-12-31", null);
  assert.strictEqual(ctx.dayAriaLabel(blank, false), "12월 31일 금요일");
});

test("dayAriaLabel: 이름은 칸에 보이는 그대로(WCAG 2.5.3) — 사계재 칸 「추계재」 · 주일 「연중29주」 · 꼬리말은 붙고, 이름 없는 평일만 대표 이름", () => {
  // 대표가 격자 평일인 사계재 날 — 칸은 「추계재」를 보이므로 링크 이름도 「추계재」(대표 「연중 24주 금요일」이 아니라 — PR #348 리뷰)
  const ember = ctx.calendarDay("2026-09-18", resolvedOf("2026-09-18",
    [grid("ordinary-24-weekday-fri", "연중 24주 금요일"), cand(obs("t-추계재", "추계재", { rank: "feria", color: "violet" }))],
    { color: "violet", colors: ["violet"] }));
  assert.strictEqual(ember.cellName, "추계재");
  assert.strictEqual(ctx.dayAriaLabel(ember, false), "9월 18일 금요일, 추계재, 자색");
  // 주일 — 보이는 「연중29주」 그대로(앞의 「일요일」이 「주일」을 대신 말한다)
  const sunday = ctx.calendarDay("2026-10-18", resolvedOf("2026-10-18", [grid("ordinary-29-sunday", "연중 29주일")], { coord: SUNDAY(29) }));
  assert.strictEqual(ctx.dayAriaLabel(sunday, false), "10월 18일 일요일, 연중29주, 녹색");
  // 격자 평일 칸의 기념일 — 칸 이름 + 칩과 같은 꼬리 「· 기념일」
  const wesley = ctx.calendarDay("2025-05-24", resolvedOf("2025-05-24",
    [grid("easter-5-weekday-sat", "부활 5주 토요일"), cand(obs("d0524-존-웨슬리", "존 웨슬리(사제)", { rank: "commemoration" }))],
    { color: "white", colors: ["white"] }));
  assert.strictEqual(wesley.cellName, "존 웨슬리");
  assert.strictEqual(wesley.cellSuffix, " · 기념일");
  assert.strictEqual(ctx.dayAriaLabel(wesley, false), "5월 24일 토요일, 존 웨슬리 · 기념일, 백색");
  // 옮겨 온 대표 — 꼬리 「· 7월 25일에서 옮겨 옴」은 칸에 안 보이고 링크 이름에 붙는다
  const james = cand(obs("d0725-사도-성-장-야고보", "사도 성 장 야고보", { rank: "major_feast", color: "red" }), "transferred_in", { from: "2027-07-25" });
  const moved = ctx.calendarDay("2027-07-26", resolvedOf("2027-07-26", [james], { color: "red", colors: ["red"] }));
  assert.strictEqual(ctx.dayAriaLabel(moved, false), "7월 26일 월요일, 사도 성 장 야고보 · 7월 25일에서 옮겨 옴, 적색");
  // 이름 없는 평일 — 칸에는 날짜뿐이라 대표(격자) 이름이 링크 이름의 이름
  const plain = ctx.calendarDay("2026-10-16", plainDay("2026-10-16"));
  assert.strictEqual(plain.cellName, "");
  assert.strictEqual(ctx.dayAriaLabel(plain, false), "10월 16일 금요일, 연중 28주 목요일, 녹색");
});

test("buildMonthGrid: 칸에 보이는 이름은 늘 그 칸의 링크 이름 안에 있다(WCAG 2.5.3)", () => {
  // 주일은 주일 좌표, 18일은 사계재(격자 평일이 대표), 나머지는 이름 없는 평일
  const resolve = (d) => {
    if (ctx.dayOfWeek(d) === 0) return resolvedOf(d, [grid("ordinary-x-sunday", "연중 24주일")], { coord: SUNDAY(24) });
    if (d.endsWith("-18")) {
      return resolvedOf(d, [grid("ordinary-x-weekday", "연중 24주 금요일"), cand(obs("t-추계재", "추계재", { rank: "feria" }))]);
    }
    return plainDay(d);
  };
  const cells = ctx.buildMonthGrid(2026, 9, "2026-10-15", resolve).weeks.flat();
  const named = cells.filter((c) => c.cellName);
  assert.ok(named.length >= 7, "주일 · 사계재 칸이 이름을 단다");
  for (const c of named) assert.ok(c.label.includes(c.cellName), `${c.date}: 「${c.cellName}」 ⊄ 「${c.label}」`);
});

test("calendarDay: 전례년 경계는 주일에만 견준다 — 평일 칸은 liturgicalYearOf 를 호출하지 않는다(PR #348 리뷰 — 42칸마다 두 번씩 셈하던 것)", () => {
  const original = ctx.liturgicalYearOf;
  let calls = 0;
  ctx.liturgicalYearOf = (d) => { calls++; return original(d); };
  try {
    const resolve = (d) => (ctx.dayOfWeek(d) === 0
      ? resolvedOf(d, [grid("ordinary-x-sunday", "연중 29주일")], { coord: SUNDAY(29) })
      : plainDay(d));
    ctx.buildMonthGrid(2026, 10, "2026-10-15", resolve);
    assert.strictEqual(calls, 6 * 2, "주일 여섯 칸 × (그날 · 앞날)");
  } finally {
    ctx.liturgicalYearOf = original;
  }
});

test("buildMonthGrid: 엔진 날짜 덧셈이 실패하면 틀린 표를 그리지 않고 멈춘다 — 같은 날짜로 메우지 않는다(PR #348 리뷰)", () => {
  assert.throws(() => ctx.gridDate("2026-13-01", 1), /calendar grid/);
  assert.throws(() => ctx.buildMonthGrid(2026, 13, "2026-10-15", plainDay), /calendar grid/);
  assert.strictEqual(ctx.gridDate("9999-12-31", 8), "10000-01-08");   // 계산 범위 끝 표의 뒤 칸까지는 낸다
});

test("buildMonthGrid: 칸의 label 이 dayAriaLabel 과 같고, 오늘 칸만 「오늘」로 시작한다", () => {
  const cells = ctx.buildMonthGrid(2026, 10, "2026-10-15", plainDay).weeks.flat();
  for (const c of cells) assert.strictEqual(c.label, ctx.dayAriaLabel(c, c.isToday), c.date);
  same(cells.filter((c) => c.label.startsWith("오늘")).map((c) => c.date), ["2026-10-15"]);
});
