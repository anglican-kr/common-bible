// ── calendar 뷰 모델 ↔ 실데이터 대조 — data/ 서브모듈이 있어야 돈다 ───────────
// Run with: node --test tests/unit/calendar.data.test.js
//
// **공개 저장소의 필수 `Unit tests` 잡에서는 돌지 않는다**(설계서 §7 — 서브모듈이 없다).
// lectionary.data.test.js 와 같은 자리 — engine-data.yml · sync-data.yml 양쪽에 등록돼 돈다.
// 합성 재료로 잡을 수 있는 것은 calendar.test.js 에 둔다. 여기서는 실제 정의 표 위에서 엔진이 낸
// `ResolvedDate` 를 월간 표 모델(`buildMonthGrid` · `calendarDay`)에 넣어 A2 계획의 날짜 예(사용자 결정
// 2026-10-15 — coding-pitfalls §24)가 실제 날짜에서 그렇게 보이는지, 그리고 42칸 월간 표가 엔진의 연도
// 캐시를 지키는지(설계서 §4.9 「computus 최대 세 번」 — 검토 문서 C-4.9-1) 본다. 캘린더 묶음(정의 표 5종)만
// 쓴다 — 달력은 독서 묶음을 받지 않는다(설계서 §3.5).

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
vm.runInContext(extractBlock("CALENDAR_MODEL", CALENDAR_SOURCE), ctx, { filename: "calendar.js" });

const LECTIONARY = path.join(ROOT, "data", "lectionary");
// 체크아웃 여부만 본다(liturgical-engine.data.test.js 와 같은 이유).
const haveData = fs.existsSync(LECTIONARY);
const SKIP = haveData ? false : "data/ 서브모듈 미체크아웃 — 로컬과 engine-data.yml·sync-data.yml 에서 돈다";
const read = (p) => JSON.parse(fs.readFileSync(path.join(LECTIONARY, p), "utf8"));
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
// vm 이 만든 배열 · 객체는 realm 이 달라 deepStrictEqual 이 프로토타입에서 틀린다 — 양쪽을 정규화한다.
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const TABLES = () => ({
  sanctoral: read("sanctoral.json"), temporal: read("temporal-feasts.json"), periods: read("periods.json"),
  ordinalWeeks: read("ordinal-weeks.json"), kasi: read("kasi-lunar.json"),
});
let cal = null;
const index = () => (cal ??= ctx.buildCalendarIndex(TABLES()));
/** 브라우저의 엔진 `resolveDate` 와 같은 조합(liturgical-engine.js `resolveDate`). */
const resolve = (d) => ctx.resolveDateIn(index(), d, ctx.transfersOf(index(), Number(d.slice(0, 4))));
const day = (d) => ctx.calendarDay(d, resolve(d));
const others = (d) => d.others.map((o) => o.name + o.suffix + (o.away ? " [away]" : ""));

// ── A2 계획의 날짜 예(사용자 결정 2026-10-15) ────────────────────────────────

test("2026-09-29 — 칸은 대표 하나(성 미카엘과 모든 천사들), 줄에는 동시 봉헌하는 설립 기념일도", { skip: SKIP }, () => {
  const d = day("2026-09-29");
  assert.strictEqual(d.cellName, "성 미카엘과 모든 천사들");
  same(others(d), ["대한성공회 설립 기념일"]);
  same(d.colors, ["white"]);
});

test("사계재 — 2026-09-18 금(격자가 대표)은 칸 「추계재」 자색, 09-16 니니안(축일이 대표)은 자 · 백 병기", { skip: SKIP }, () => {
  const fri = day("2026-09-18");
  assert.strictEqual(fri.cellName, "추계재");
  assert.strictEqual(fri.primary.name, "연중 24주 금요일");
  same(fri.colors, ["violet"]);
  const wed = day("2026-09-16");
  assert.strictEqual(wed.cellName, "니니안");
  same(others(wed), ["추계재"]);
  same(wed.colors, ["violet", "white"]);
});

test("2027-07-26 — 옮겨 온 야고보가 칸 이름, 줄에 「7월 25일에서 옮겨 옴」 · 안나와 요아킴 「기념만」", { skip: SKIP }, () => {
  const d = day("2027-07-26");
  assert.strictEqual(d.cellName, "사도 성 장 야고보");
  assert.strictEqual(d.primary.suffix, " · 7월 25일에서 옮겨 옴");
  same(others(d), ["안나와 요아킴 · 기념만"]);
  same(d.colors, ["red"]);
});

test("선택 봉헌 — 2026-05-17 칸은 「부활7주」, 줄에 「승천대축일 · 5월 14일에서 옮겨 지킬 수 있음」; 08-09 평화통일주일 · 주의 변모", { skip: SKIP }, () => {
  const d = day("2026-05-17");
  assert.strictEqual(d.cellName, "부활7주");
  same(others(d), ["승천대축일 · 5월 14일에서 옮겨 지킬 수 있음"]);
  const aug = day("2026-08-09");
  assert.strictEqual(aug.cellName, "연중19주");
  same(others(aug), ["평화통일주일", "주의 변모 · 8월 6일에서 옮겨 지킬 수 있음"]);
});

test("옮겨 간 축일 — 2026-10-18 칸 「연중29주」, 루가는 줄에서 흐리게 「→ 10월 19일」; 10-19 칸은 루가", { skip: SKIP }, () => {
  const d = day("2026-10-18");
  assert.strictEqual(d.cellName, "연중29주");
  same(others(d), ["성 루가 · → 10월 19일 [away]"]);
  const mon = day("2026-10-19");
  assert.strictEqual(mon.cellName, "성 루가");
  assert.strictEqual(mon.primary.suffix, " · 10월 18일에서 옮겨 옴");
});

test("전례년 경계(미결3) — 2026-11-29 대림 1주일에 「나해 시작」, 칸 「대림1주」; 11-28 · 12-06 에는 없다", { skip: SKIP }, () => {
  const d = day("2026-11-29");
  assert.strictEqual(d.yearStart, "나해 시작");
  assert.strictEqual(d.cellName, "대림1주");
  assert.strictEqual(day("2026-11-28").yearStart, null);
  assert.strictEqual(day("2026-12-06").yearStart, null);
  // 해마다 대림 1주일 하루만 — 2025 ~ 2030
  for (let y = 2025; y <= 2030; y++) {
    const starts = [];
    for (let d2 = `${y}-01-01`; d2 <= `${y}-12-31`; d2 = ctx.addDays(d2, 1)) if (day(d2).yearStart) starts.push(d2);
    same(starts, [ctx.advent1Date(y)], String(y));
  }
});

test("고유명 평일 — 2026-03-30 성주간 월요일 · 2026-02-19 재의 수요일 후 목요일은 격자여도 칸 이름이 있다", { skip: SKIP }, () => {
  assert.strictEqual(day("2026-03-30").cellName, "성주간 월요일");
  assert.strictEqual(day("2026-02-19").cellName, "재의 수요일 후 목요일");
  assert.strictEqual(day("2026-03-03").cellName, "");   // 번호 있는 사순 평일
});

test("기념일 — 2026-01-01 은 거룩한 이름 예수가 칸, 세계평화를 위한 기도일은 줄에 「· 기념일」", { skip: SKIP }, () => {
  const d = day("2026-01-01");
  assert.strictEqual(d.cellName, "거룩한 이름 예수");
  same(others(d), ["세계평화를 위한 기도일 · 기념일"]);
});

// ── 전수: 2025 ~ 2027 의 모든 달 ─────────────────────────────────────────────

test("2025 ~ 2027 의 모든 월간 표 — 그달 칸은 링크 · 색이 있고, 주일 칸에는 이름이 있다, 칸 이름은 두 줄 폭을 크게 넘지 않는다", { skip: SKIP }, () => {
  let longest = "";
  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const cells = ctx.buildMonthGrid(y, m, "2026-10-15", resolve).weeks.flat();
      assert.strictEqual(cells.length, 42);
      for (const c of cells.filter((x) => x.inMonth)) {
        assert.strictEqual(c.href, `/lectionary/${c.date}`, c.date);
        assert.ok(c.colors.length >= 1 && c.colors.every((k) => ["white", "red", "green", "violet"].includes(k)), `${c.date} ${c.colors}`);
        if (c.weekday === 0) assert.ok(c.cellName, `${c.date} 주일 칸 이름이 비었다`);
        assert.ok(c.primary, `${c.date} 대표 없음`);
        if (c.cellName.length > longest.length) longest = c.cellName;
      }
    }
  }
  // 칸은 폰에서 한 줄 약 4글자 · 두 줄 — 그보다 긴 이름은 말줄임된다(전체 이름은 title · 링크 이름). 극단값만 지킨다.
  assert.ok(longest.length <= 40, longest);
});

test("42칸 월간 표가 엔진 연도 캐시를 지킨다 — 해를 걸친 2026년 12월은 앵커 세 해(2025 · 2026 · 2027), 6월은 두 해(설계서 §4.9 · C-4.9-1)", { skip: SKIP }, () => {
  // 규칙 파생 메모(`movableOf`)가 인덱스에 붙어 있어 새 인덱스로 센다 — 프리로드 직후와 같은 처지
  const fresh = ctx.buildCalendarIndex(TABLES());
  const resolveFresh = (d) => ctx.resolveDateIn(fresh, d, ctx.transfersOf(fresh, Number(d.slice(0, 4))));
  vm.runInContext("anchorCache.clear(); spansCache.clear(); transferCache.clear();", ctx);
  ctx.buildMonthGrid(2026, 12, "2026-10-15", resolveFresh);
  same([...vm.runInContext("anchorCache", ctx).keys()].sort(), [2025, 2026, 2027]);
  const june = ctx.buildCalendarIndex(TABLES());
  vm.runInContext("anchorCache.clear(); spansCache.clear(); transferCache.clear();", ctx);
  ctx.buildMonthGrid(2026, 6, "2026-10-15", (d) => ctx.resolveDateIn(june, d, ctx.transfersOf(june, Number(d.slice(0, 4)))));
  same([...vm.runInContext("anchorCache", ctx).keys()].sort(), [2025, 2026]);
  // 연도 키 캐시는 인덱스 하나용이다 — 뒤의 조회가 남의 인덱스로 만든 패스를 읽지 않게
  vm.runInContext("transferCache.clear();", ctx);
});
