// ── Unit tests for js/app/liturgical-engine.js — A1-a 계산 · A1-b 조회 계층 ─────
// Run with: node --test tests/unit/liturgical-engine.test.js
//
// 설계서 §7 「테스트 계획」 · 검토 문서 §5.1~5.6(PR 1) · §5.7~5.9(PR 2) 의 체크 항목을 잡는다.
// **이 파일은 합성 표와 순수 계산만 쓴다** — 공개 저장소의 필수 `Unit tests` 잡은
// actions/checkout 을 서브모듈 없이 돌려 `data/` 가 없다(설계서 §7). 실측 대조가
// 필요한 케이스는 `liturgical-engine.data.test.js` 로 갈라 engine-data.yml·sync-data.yml 에서 돈다.
//
// ADR-013 하네스 — 각 테스트가 extractBlock 을 자기 안에 복사해 갖고 vm.createContext
// 에 최소 전역만 넣는다. **`Date` 를 반드시 주입**해야 한다(기본 세트에 없다).

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/app/liturgical-engine.js"), "utf8");

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
  parseInt, isNaN, Date, NaN,
};
vm.createContext(ctx);
// 모듈 상태는 블록 밖에 있으므로 prelude 로 재선언한다(설계서 §3.3).
const STATE_PRELUDE = "const anchorCache = new Map(); const spansCache = new Map(); const transferCache = new Map();";
vm.runInContext(STATE_PRELUDE, ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", SOURCE), ctx, { filename: "liturgical-engine.js" });
// 조회 블록은 계산 블록 위에서 돈다 — 같은 컨텍스트에 차례로 실행한다(설계서 §3.3, bookmark-read.test.js 선례).
vm.runInContext(extractBlock("LITURGICAL_LOOKUP", SOURCE), ctx, { filename: "liturgical-engine.js#lookup" });

// vm 값은 샌드박스 realm 의 프로토타입을 달고 나와 deepStrictEqual 이 구조가 같아도
// 틀린다(verse-spec.test.js 선례). 구조 비교 전에 평범한 데이터로 정규화한다.
const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const YEARS = [];
for (let y = 1900; y <= 2100; y++) YEARS.push(y);

// ── 5.1 부활절 computus · 파생일 (§4.2 · §4.3) ──

// 1900~2100 서방 부활절 **권위 표**. 미국 인구조사국 X-13ARIMA-SEATS `genhol` 부속 표
// (census.gov/data/software/x13as/genhol/easter-dates.html, 1900~2099)를 그대로 옮기고 2100 은
// 검토 문서 C-4.2-1 의 표본이다. Gauss 산식(엔진의 Meeus/Jones/Butcher 와 독립)으로 201년을
// 재계산해 표와 전부 합치함을 확인했다. 한 행이 한 십년, 열이 연도 끝자리(0~9).
// 표본 6개만 대조하던 종전 테스트는 나머지 195년을 주일·범위 불변식으로만 지켰다 — 범위
// 안의 엉뚱한 주일을 내는 computus 도 통과했다(3차 리뷰).
const EASTER = {
  1900: "04-15 04-07 03-30 04-12 04-03 04-23 04-15 03-31 04-19 04-11",
  1910: "03-27 04-16 04-07 03-23 04-12 04-04 04-23 04-08 03-31 04-20",
  1920: "04-04 03-27 04-16 04-01 04-20 04-12 04-04 04-17 04-08 03-31",
  1930: "04-20 04-05 03-27 04-16 04-01 04-21 04-12 03-28 04-17 04-09",
  1940: "03-24 04-13 04-05 04-25 04-09 04-01 04-21 04-06 03-28 04-17",
  1950: "04-09 03-25 04-13 04-05 04-18 04-10 04-01 04-21 04-06 03-29",
  1960: "04-17 04-02 04-22 04-14 03-29 04-18 04-10 03-26 04-14 04-06",
  1970: "03-29 04-11 04-02 04-22 04-14 03-30 04-18 04-10 03-26 04-15",
  1980: "04-06 04-19 04-11 04-03 04-22 04-07 03-30 04-19 04-03 03-26",
  1990: "04-15 03-31 04-19 04-11 04-03 04-16 04-07 03-30 04-12 04-04",
  2000: "04-23 04-15 03-31 04-20 04-11 03-27 04-16 04-08 03-23 04-12",
  2010: "04-04 04-24 04-08 03-31 04-20 04-05 03-27 04-16 04-01 04-21",
  2020: "04-12 04-04 04-17 04-09 03-31 04-20 04-05 03-28 04-16 04-01",
  2030: "04-21 04-13 03-28 04-17 04-09 03-25 04-13 04-05 04-25 04-10",
  2040: "04-01 04-21 04-06 03-29 04-17 04-09 03-25 04-14 04-05 04-18",
  2050: "04-10 04-02 04-21 04-06 03-29 04-18 04-02 04-22 04-14 03-30",
  2060: "04-18 04-10 03-26 04-15 04-06 03-29 04-11 04-03 04-22 04-14",
  2070: "03-30 04-19 04-10 03-26 04-15 04-07 04-19 04-11 04-03 04-23",
  2080: "04-07 03-30 04-19 04-04 03-26 04-15 03-31 04-20 04-11 04-03",
  2090: "04-16 04-08 03-30 04-12 04-04 04-24 04-15 03-31 04-20 04-12",
  2100: "03-28",
};

test("C-4.2-1 1900~2100 전 연도가 권위 표와 일치", () => {
  const bad = [];
  let n = 0;
  for (const [decade, row] of Object.entries(EASTER)) {
    row.split(" ").forEach((mmdd, i) => {
      const y = Number(decade) + i;
      n++;
      if (ctx.easterDate(y) !== `${y}-${mmdd}`) bad.push(`${y} ${ctx.easterDate(y)} ≠ ${mmdd}`);
    });
  }
  assert.deepStrictEqual(bad, []);
  assert.strictEqual(n, 201);
  // 검토 문서 C-4.2-1 이 따로 적어 둔 표본 — 표를 옮기다 행이 밀리면 여기서 잡힌다.
  for (const [y, exp] of [[1900, "04-15"], [1913, "03-23"], [2000, "04-23"], [2008, "03-23"], [2038, "04-25"], [2100, "03-28"]]) {
    assert.strictEqual(EASTER[Math.floor(y / 10) * 10].split(" ")[y % 10], exp, `표본 ${y}`);
  }
});

test("C-4.2-1 부활절은 언제나 주일 (1900~2100)", () => {
  const bad = YEARS.filter((y) => ctx.dayOfWeek(ctx.easterDate(y)) !== 0);
  assert.deepStrictEqual(bad, []);
});

test("C-4.2-2 부활절 범위 — 규정 3.22~4.25, 실측 3.23~4.25", () => {
  const mmdd = YEARS.map((y) => ctx.easterDate(y).slice(5));
  const min = mmdd.reduce((a, b) => (a < b ? a : b));
  const max = mmdd.reduce((a, b) => (a > b ? a : b));
  assert.ok(min >= "03-22" && max <= "04-25", `${min}~${max}`);
  assert.strictEqual(min, "03-23");
  assert.strictEqual(max, "04-25");
});

test("C-4.3-1 재의 수요일 = E−46 은 항상 수요일 · 2.4~3.10 · 2032 = 02-11", () => {
  const days = YEARS.map((y) => ctx.addDays(ctx.easterDate(y), -46));
  assert.deepStrictEqual(days.filter((d) => ctx.dayOfWeek(d) !== 3), []);
  const mmdd = days.map((d) => d.slice(5));
  const min = mmdd.reduce((a, b) => (a < b ? a : b));
  const max = mmdd.reduce((a, b) => (a > b ? a : b));
  assert.ok(min >= "02-04" && max <= "03-10", `${min}~${max}`);
  assert.strictEqual(min, "02-05");   // 실측
  assert.strictEqual(ctx.addDays(ctx.easterDate(2032), -46), "2032-02-11");
});

test("C-4.3-2 승천 목요일 · 성령강림 주일 · 삼위일체 주일 · 성체 목요일", () => {
  for (const y of YEARS) {
    const E = ctx.easterDate(y);
    assert.strictEqual(ctx.dayOfWeek(ctx.addDays(E, 39)), 4, `승천 ${y}`);
    assert.strictEqual(ctx.dayOfWeek(ctx.addDays(E, 49)), 0, `성령강림 ${y}`);
    assert.strictEqual(ctx.dayOfWeek(ctx.addDays(E, 56)), 0, `삼위일체 ${y}`);
    assert.strictEqual(ctx.dayOfWeek(ctx.addDays(E, 60)), 4, `성체 ${y}`);
  }
});

test("§4.3 easter_offset −1 은 성 토요일·부활밤이 공유하는 날짜다", () => {
  // 종전 이 테스트는 같은 인자로 evalRule 을 두 번 불러 결과가 같다고 단언했다 —
  // 순수 함수라 어떤 구현에서도 통과하는 **동어반복**이었다. 체크리스트 C-4.3-3 이
  // 요구하는 「인덱스가 1:N」은 레코드 **둘**이 한 날짜로 모이는 것이고, 그 인덱스는
  // §5.4 권장 인덱스의 몫이라 계산 계층에서는 잡히지 않는다 — 아래 조회 계층의 C-4.3-3 이 잡는다.
  // 여기서 보는 것은 「서로 다른 레코드의 rule 이 같은 날짜를 낸다」까지다.
  const holySaturday = { kind: "easter_offset", days: -1 };
  const vigil = { kind: "easter_offset", days: -1 };   // 다른 레코드, 같은 규칙
  assert.deepStrictEqual(plain(ctx.evalRule(holySaturday, 2026)), ["2026-04-04"]);
  assert.deepStrictEqual(plain(ctx.evalRule(vigil, 2026)), ["2026-04-04"]);
  assert.strictEqual(ctx.addDays(ctx.easterDate(2026), -1), "2026-04-04");
});

test("C-4.3-5 rule: null · 모르는 kind 는 건너뛴다 (throw 아님)", () => {
  assert.deepStrictEqual(plain(ctx.evalRule(null, 2026)), []);
  assert.deepStrictEqual(plain(ctx.evalRule(undefined, 2026)), []);
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "made_up" }, 2026)), []);
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "easter_offset" }, 2026)), []);   // days 없음
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "ember_wfs", anchor: null }, 2026)), []);
});

test("§4.1 · §4.3 정수가 아닌 델타·서수·월일은 null / 빈 결과 — JSON 숫자는 NaN·소수일 수 있다 (§2)", () => {
  // 종전: 0.5 는 Date 가 잘라 같은 날, NaN·Infinity 는 "0NaN-NaN-NaN", 문자열 "3" 은 연결돼 5월 23일
  for (const bad of [0.5, -0.5, NaN, Infinity, -Infinity, "3", null, undefined, true]) {
    assert.strictEqual(ctx.addDays("2026-04-05", bad), null, `addDays ${String(bad)}`);
  }
  assert.strictEqual(ctx.addDays("2026-04-05", 7), "2026-04-12");
  assert.strictEqual(ctx.addDays("2026-04-05", -0), "2026-04-05");     // -0 도 정수다
  // 종전: nthSunday(2026, 11, 1.5) → "2026-11-4.5"
  for (const [y, m, n] of [[2026, 11, 1.5], [2026, 11, NaN], [2026, 11, "1"], [2026, 2.5, 1], [2026.5, 11, 1], [2026, 0, 1], [2026, 13, 1]]) {
    assert.strictEqual(ctx.nthSunday(y, m, n), null, `nthSunday ${y} ${m} ${n}`);
  }
  assert.strictEqual(ctx.nthSunday(2026, 11, 1), "2026-11-01");
  // 규칙 평가로 흘러들던 자리 — 종전엔 days: 0.5 가 부활절 당일을 냈다
  const r = (rule) => plain(ctx.evalRule(rule, 2026));
  assert.deepStrictEqual(r({ kind: "easter_offset", days: 0.5 }), []);
  assert.deepStrictEqual(r({ kind: "easter_offset", days: NaN }), []);
  assert.deepStrictEqual(r({ kind: "advent1_offset", days: "-7" }), []);
  assert.deepStrictEqual(r({ kind: "nth_sunday", month: 11, nth: 1.5 }), []);
  assert.deepStrictEqual(r({ kind: "first_sunday_after", month: 1.5, day: 6 }), []);
  assert.deepStrictEqual(r({ kind: "nearest_sunday", month: 11, day: 30.5 }), []);
  assert.deepStrictEqual(r({ kind: "last_sunday_before", month: NaN, day: 15 }), []);
  assert.deepStrictEqual(r({ kind: "ember_wfs", anchor: { kind: "easter_offset", days: 0.5 } }), []);
  assert.deepStrictEqual(r({ kind: "ember_wfs", anchor: { kind: "date", month: 9, day: 14.5 } }), []);
  // 정수면 그대로 — 검사가 정상 규칙을 깎지 않는다
  assert.deepStrictEqual(r({ kind: "easter_offset", days: -46 }), ["2026-02-18"]);
});

test("C-4.3-6 나머지 규칙 종류", () => {
  const r = (rule, y) => plain(ctx.evalRule(rule, y));
  assert.deepStrictEqual(r({ kind: "nth_sunday", month: 11, nth: 3 }, 2026), ["2026-11-15"]);
  assert.deepStrictEqual(r({ kind: "first_sunday_after", month: 1, day: 6 }, 2027), ["2027-01-10"]);
  // 1.6 이 주일인 해는 **엄격히 이후**라 다음 주일이다
  assert.strictEqual(ctx.dayOfWeek("2030-01-06"), 0);
  assert.deepStrictEqual(r({ kind: "first_sunday_after", month: 1, day: 6 }, 2030), ["2030-01-13"]);
  assert.deepStrictEqual(r({ kind: "nearest_sunday", month: 11, day: 30 }, 2025), ["2025-11-30"]);
  assert.deepStrictEqual(r({ kind: "advent1_offset", days: -7 }, 2026), ["2026-11-22"]);
  assert.deepStrictEqual(r({ kind: "last_sunday_before", month: 8, day: 15 }, 2026), ["2026-08-09"]);
  // 8.15 가 주일인 해는 **엄격히 이전**이라 한 주 앞이다(데이터 note)
  assert.strictEqual(ctx.dayOfWeek("2027-08-15"), 0);
  assert.deepStrictEqual(r({ kind: "last_sunday_before", month: 8, day: 15 }, 2027), ["2027-08-08"]);
});

test("C-4.3-7 ember_wfs — 네 계절 × 수·금·토 = 겹치지 않는 12일", () => {
  const RULES = [
    { kind: "ember_wfs", anchor: { kind: "easter_offset", days: -42 } },   // 춘계재
    { kind: "ember_wfs", anchor: { kind: "easter_offset", days: 49 } },    // 하계재
    { kind: "ember_wfs", anchor: { kind: "date", month: 9, day: 14 } },    // 추계재
    { kind: "ember_wfs", anchor: { kind: "date", month: 12, day: 13 } },   // 동계재
  ];
  for (const y of [2026, 2027, 2030, 2052]) {
    const all = RULES.flatMap((r) => ctx.evalRule(r, y));
    assert.strictEqual(all.length, 12, `${y} 날짜 수`);
    assert.strictEqual(new Set(all).size, 12, `${y} 겹침`);
    for (const d of all) assert.ok([3, 5, 6].includes(ctx.dayOfWeek(d)), `${d} 요일`);
  }
  // 춘계재 = 사순1주(E−42) 의 수·금·토
  const E26 = ctx.easterDate(2026);
  assert.deepStrictEqual(plain(ctx.evalRule(RULES[0], 2026)),
    [ctx.addDays(E26, -39), ctx.addDays(E26, -37), ctx.addDays(E26, -36)]);
  // 하계재 토요일 = 삼위일체(E+56) 전날
  const summer = plain(ctx.evalRule(RULES[1], 2026));
  assert.strictEqual(summer[2], ctx.addDays(E26, 55));
});

test("C-4.3-8 앵커 당일이 수요일이면 다음 주 — 각 28회 (1900~2100)", () => {
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "ember_wfs", anchor: { kind: "date", month: 9, day: 14 } }, 2022)),
    ["2022-09-21", "2022-09-23", "2022-09-24"]);
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "ember_wfs", anchor: { kind: "date", month: 12, day: 13 } }, 2023)),
    ["2023-12-20", "2023-12-22", "2023-12-23"]);
  const wedCount = (m, d) => YEARS.filter((y) => ctx.dayOfWeek(ctx.toKey(y, m, d)) === 3).length;
  assert.strictEqual(wedCount(9, 14), 28);
  assert.strictEqual(wedCount(12, 13), 28);
});

test("C-4.3-9 2026 하계재 5.27/29/30 · 추계재 9.16/18/19", () => {
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "ember_wfs", anchor: { kind: "easter_offset", days: 49 } }, 2026)),
    ["2026-05-27", "2026-05-29", "2026-05-30"]);
  assert.deepStrictEqual(plain(ctx.evalRule({ kind: "ember_wfs", anchor: { kind: "date", month: 9, day: 14 } }, 2026)),
    ["2026-09-16", "2026-09-18", "2026-09-19"]);
});

// ── 5.2 대림 앵커 · 전례년 · 주기 (§4.4 · §4.7) ──

test("C-4.4-1 대림1주일 — 다섯 해 · 항상 주일 · 11.27~12.03", () => {
  for (const [y, exp] of [[2023, "2023-12-03"], [2024, "2024-12-01"], [2025, "2025-11-30"],
                          [2026, "2026-11-29"], [2027, "2027-11-28"]]) {
    assert.strictEqual(ctx.advent1Date(y), exp, `${y}`);
  }
  const all = YEARS.map((y) => ctx.advent1Date(y));
  assert.deepStrictEqual(all.filter((d) => ctx.dayOfWeek(d) !== 0), []);
  const mmdd = all.map((d) => d.slice(5));
  assert.ok(mmdd.every((v) => v >= "11-27" && v <= "12-03"));
});

test("C-4.4-2 liturgicalYearOf — 경계는 달이 아니라 대림1 당일", () => {
  assert.strictEqual(ctx.liturgicalYearOf("2023-12-01"), 2023);   // 그해 대림1 은 12.03
  assert.strictEqual(ctx.liturgicalYearOf("2024-12-01"), 2025);   // 그해 대림1 이 12.01
  assert.strictEqual(ctx.liturgicalYearOf("2026-12-31"), 2027);
  assert.strictEqual(ctx.liturgicalYearOf("2027-01-01"), 2027);   // 12.31 과 1.1 은 같은 전례년
});

test("C-4.7-1 주일 주기 — 경계 네 날 · N % 3", () => {
  assert.strictEqual(ctx.sundayCycle("2025-11-29"), "C");
  assert.strictEqual(ctx.sundayCycle("2025-11-30"), "A");
  assert.strictEqual(ctx.sundayCycle("2026-11-28"), "A");
  assert.strictEqual(ctx.sundayCycle("2026-11-29"), "B");
  assert.strictEqual(ctx.sundayCycle("2026-06-07"), "A");
  assert.strictEqual(ctx.sundayCycle("2027-06-06"), "B");
  assert.strictEqual(ctx.sundayCycle("2028-06-04"), "C");
});

test("C-4.7-2 두 주기의 기준이 다르다 — 12월 어긋남은 의도", () => {
  // 주일 축은 **전례년**(대림에 넘어감), 평일 축은 **달력년**(1/1 에 넘어감)이다.
  // 2026-12-31 은 주일 주기로 이미 나해(전례년 2027)인데 평일 축의 기준은 아직 2026 이다.
  assert.strictEqual(ctx.liturgicalYearOf("2026-12-31"), 2027);
  assert.strictEqual(ctx.sundayCycle("2026-12-31"), "B");
  // 그날은 성탄절기라 평일 주기 자체가 없다(§4.7 — 연중 평일에만 I/II).
  assert.strictEqual(ctx.weekdayCycle("2026-12-31"), null);
  // 평일 축이 실제로 값을 갖는 연중 평일에서 홀·짝 전환을 잡는다.
  assert.strictEqual(ctx.weekdayCycle("2026-06-10"), "II");   // 짝수해
  assert.strictEqual(ctx.weekdayCycle("2027-06-09"), "I");    // 홀수해
  assert.strictEqual(ctx.weekdayCycle("2028-06-07"), "II");
});

test("C-4.7-3 I/II 는 연중 평일에만 — 절기 평일·주일은 null", () => {
  assert.strictEqual(ctx.weekdayCycle("2026-03-04"), null);   // 사순 평일
  assert.strictEqual(ctx.weekdayCycle("2026-12-22"), null);   // 대림 평일
  assert.strictEqual(ctx.weekdayCycle("2026-01-02"), null);   // 성탄절기 평일
  assert.strictEqual(ctx.weekdayCycle("2026-06-07"), null);   // 연중 주일은 A/B/C 축
});

// ── 5.3 절기 스팬 (§4.5) ──

test("C-4.5-1 한 해가 정확히 한 절기씩 — 앵커로 독립 구성한 분할과 매일 일치 · 경계 전이 (1900~2100)", () => {
  // seasonOf 는 스칼라 하나를 내므로 「도메인 안의 값 + 일수」만 보면 모든 날이 ordinary 여도
  // 통과한다(4차 리뷰). 그래서 앵커에서 **분할을 따로 구성**해 매일 대조하고 경계마다 양쪽을 본다.
  const bad = [];
  for (const y of YEARS) {
    const E = ctx.easterDate(y);
    const b = ctx.baptismDate(y), ash = ctx.addDays(E, -46), pent = ctx.addDays(E, 49), adv = ctx.advent1Date(y);
    // 절기 순서대로 [이름, 시작, 끝] — 성탄절기는 해를 넘겨 앞뒤 두 조각이다
    const runs = [
      ["christmas", ctx.toKey(y, 1, 1), ctx.addDays(b, -1)],
      ["ordinary", b, ctx.addDays(ash, -1)],
      ["lent", ash, ctx.addDays(E, -1)],
      ["easter", E, pent],
      ["ordinary", ctx.addDays(pent, 1), ctx.addDays(adv, -1)],
      ["advent", adv, ctx.toKey(y, 12, 24)],
      ["christmas", ctx.toKey(y, 12, 25), ctx.toKey(y, 12, 31)],
    ];
    // 분할 자체가 빈틈·겹침 없이 이어진다 — 다음 조각의 시작은 앞 조각 끝의 다음날
    for (let i = 1; i < runs.length; i++) {
      if (runs[i][1] !== ctx.addDays(runs[i - 1][2], 1)) bad.push(`${y} ${runs[i - 1][0]}→${runs[i][0]} 이음새`);
    }
    // 경계 여섯 — 앞 조각의 마지막 날과 뒤 조각의 첫날이 각자의 절기다(전이가 실제로 일어난다)
    for (let i = 1; i < runs.length; i++) {
      const [prev, , last] = runs[i - 1], [next, first] = runs[i];
      if (ctx.seasonOf(last) !== prev || ctx.seasonOf(first) !== next) {
        bad.push(`${y} ${last}|${first} → ${ctx.seasonOf(last)}|${ctx.seasonOf(first)} (기대 ${prev}|${next})`);
      }
    }
    // 매일 대조 — 한 해 전부가 기대한 조각에 든다
    let n = 0;
    for (const [season, from, to] of runs) {
      for (let d = from; d <= to; d = ctx.addDays(d, 1)) {
        n++;
        if (ctx.seasonOf(d) !== season) bad.push(`${d} ${ctx.seasonOf(d)} ≠ ${season}`);
      }
    }
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (n !== (leap ? 366 : 365)) bad.push(`${y} 일수 ${n}`);
  }
  assert.deepStrictEqual(bad, []);
});

test("C-4.5-2 경계 여섯 쌍", () => {
  const y = 2026, E = ctx.easterDate(y);                 // 2026-04-05
  const baptism = ctx.baptismDate(y);                    // 2026-01-11
  assert.strictEqual(ctx.seasonOf("2025-12-24"), "advent");
  assert.strictEqual(ctx.seasonOf("2025-12-25"), "christmas");
  assert.strictEqual(ctx.seasonOf(ctx.addDays(baptism, -1)), "christmas");
  assert.strictEqual(ctx.seasonOf(baptism), "ordinary");          // 세례주일이 연중 첫날
  assert.strictEqual(ctx.seasonOf(ctx.addDays(E, -47)), "ordinary");
  assert.strictEqual(ctx.seasonOf(ctx.addDays(E, -46)), "lent");  // 재의 수요일
  assert.strictEqual(ctx.seasonOf(ctx.addDays(E, -1)), "lent");   // 성 토요일
  assert.strictEqual(ctx.seasonOf(E), "easter");
  assert.strictEqual(ctx.seasonOf(ctx.addDays(E, 49)), "easter"); // 성령강림
  assert.strictEqual(ctx.seasonOf(ctx.addDays(E, 50)), "ordinary");
  assert.strictEqual(ctx.seasonOf(ctx.addDays(ctx.advent1Date(y), -1)), "ordinary");
  assert.strictEqual(ctx.seasonOf(ctx.advent1Date(y)), "advent");
});

test("C-4.5-3 epiphany 절기는 없다 — 1.6 은 christmas", () => {
  for (const y of [2026, 2027, 2030]) assert.strictEqual(ctx.seasonOf(ctx.toKey(y, 1, 6)), "christmas");
});

test("C-4.5-4 세례주일은 연중 첫날 · 성탄절기는 전날 끝난다 (미결10)", () => {
  for (const y of [2026, 2027, 2030, 2052]) {
    const b = ctx.baptismDate(y);
    assert.strictEqual(ctx.seasonOf(b), "ordinary", `${y} 세례주일`);
    assert.strictEqual(ctx.seasonOf(ctx.addDays(b, -1)), "christmas", `${y} 세례 전날`);
    assert.strictEqual(ctx.dayOfWeek(b), 0, `${y} 주일`);
  }
  assert.strictEqual(ctx.baptismDate(2030), "2030-01-13");   // 1.6 이 주일
});

test("C-4.5-5 연중1주 창 — 세례주일이 1900~2100 전부 01-07~01-13", () => {
  const out = YEARS.map((y) => ctx.baptismDate(y).slice(5)).filter((v) => v < "01-07" || v > "01-13");
  assert.deepStrictEqual(out, []);
});

// ── 5.4 연중 주차 (§4.6) ──

// 합성 표 — 실제 ordinal-weeks.json 과 같은 모양이되 이 테스트가 필요한 행만 둔다.
const WEEKS = {
  weeks: [
    { week: 1, windows: [{ from: "01-07", to: "01-13", anchor: "doy" }] },
    { week: 8, windows: [{ from: "02-25", to: "03-03", anchor: "doy" }, { from: "07-15", to: "07-21", anchor: "date" }] },
    { week: 9, windows: [{ from: "03-04", to: "03-07", anchor: "doy" }, { from: "07-22", to: "07-28", anchor: "date" }] },
    { week: 10, windows: [{ from: "06-05", to: "06-11", anchor: "date" }] },
    { week: 34, windows: [{ from: "11-20", to: "11-26", anchor: "date" }] },
  ],
};
const IDX = () => ctx.buildOrdinalIndex(WEEKS);

test("C-4.6-1 2052-03-03 → 9주 (윤년 회귀) — 8주 아님", () => {
  assert.strictEqual(ctx.dayOfWeek("2052-03-03"), 0);
  assert.strictEqual(ctx.dayOfYear("2052-03-03"), 63);   // 2/29 를 센다
  assert.strictEqual(ctx.ordinalWeekOf("2052-03-03", IDX()), 9);
  // 비윤년 같은 자리는 8주다 — 표가 2월 28일을 전제하기 때문
  assert.strictEqual(ctx.dayOfYear("2051-03-03"), 62);
});

test("C-4.6-3 평일은 그 주의 주일로 조회 — 2026-06-10 → 10주", () => {
  assert.strictEqual(ctx.sundayOfWeek("2026-06-10"), "2026-06-07");
  assert.strictEqual(ctx.ordinalWeekOf("2026-06-10", IDX()), 10);
  assert.strictEqual(ctx.ordinalWeekOf("2026-06-07", IDX()), 10);
});

test("C-4.6-4 doy · date 인덱스 분리 · 연중 밖에서는 표를 보지 않는다", () => {
  const idx = IDX();
  assert.strictEqual(idx.doy.length, 3);    // 1 · 8 · 9 주
  assert.strictEqual(idx.date.length, 4);   // 8 · 9 · 10 · 34 주
  assert.strictEqual(ctx.ordinalWeekOf("2026-04-05", idx), null);   // 부활대축일
  assert.strictEqual(ctx.ordinalWeekOf("2026-03-10", idx), null);   // 사순
  assert.strictEqual(ctx.ordinalWeekOf("2026-12-20", idx), null);   // 대림
  assert.strictEqual(ctx.ordinalWeekOf("2026-01-02", idx), null);   // 성탄절기
});

test("C-4.6-5 연중 34주 = advent1 − 7 매년 (1900~2100)", () => {
  const idx = IDX();
  for (const y of YEARS) {
    const kingship = ctx.addDays(ctx.advent1Date(y), -7);
    assert.strictEqual(ctx.seasonOf(kingship), "ordinary", `${y}`);
    assert.strictEqual(ctx.ordinalWeekOf(kingship, idx), 34, `${y}`);
  }
});

// ── 5.5 음력 (§4.8) ──

const KASI = {
  years: {
    "2026": { "1-1": "02-17", "8-15": "09-25" },
    "2032": { "1-1": "02-11", "8-15": "09-19" },
    "2040": { "1-1": "02-12", "8-15": "09-21" },
    "2049": { "1-1": "02-02", "8-15": "09-11" },
    "2050": { "1-1": "01-23", "8-15": "09-30" },
  },
};

test("C-4.8-1 표 조회", () => {
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2026)["1-1"], "2026-02-17");
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2026)["8-15"], "2026-09-25");
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2049)["1-1"], "2049-02-02");
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2032)["1-1"], "2032-02-11");
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2040)["8-15"], "2040-09-21");
  assert.strictEqual(ctx.lunarDatesOf(KASI, 2050)["8-15"], "2050-09-30");
});

test("C-4.8-2 범위 밖 연도는 빈 결과 (throw 아님)", () => {
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(KASI, 2024)), {});
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(KASI, 2051)), {});
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(null, 2026)), {});
  assert.deepStrictEqual(plain(ctx.lunarDatesOf({}, 2026)), {});
});

test("C-4.8-3 lunar 키는 문자 그대로 · MM.DD 도 정규화한다", () => {
  const out = ctx.lunarDatesOf(KASI, 2026);
  assert.deepStrictEqual(plain(Object.keys(out).sort()), ["1-1", "8-15"]);
  const dotted = { years: { "2026": { "1-1": "02.17" } } };
  assert.strictEqual(ctx.lunarDatesOf(dotted, 2026)["1-1"], "2026-02-17");
});

// ── 5.6 기간 축 (§4.10) ──

test("C-P-1 앵커만으로 계산 · 스팬마다 구간 배열", () => {
  const s = ctx.spansOf(2026);
  assert.strictEqual(s.holyWeek.length, 1);
  assert.strictEqual(s.christmasToBaptism.length, 2);
  assert.strictEqual(s.christmasOctave.length, 2);
  for (const name of Object.keys(s)) {
    for (const seg of s[name]) assert.ok(seg.from <= seg.to, `${name} ${seg.from}..${seg.to}`);
  }
});

test("C-P-2 transferGuard = E−7..E+7", () => {
  const E = ctx.easterDate(2026);
  const g = ctx.spansOf(2026).transferGuard[0];
  assert.strictEqual(g.from, ctx.addDays(E, -7));
  assert.strictEqual(g.to, ctx.addDays(E, 7));
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, -8), "transferGuard"), false);
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, -7), "transferGuard"), true);
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, 7), "transferGuard"), true);
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, 8), "transferGuard"), false);
});

test("C-P-3 색 가드 = holyWeek ∪ easterOctave · 승천 기간은 E+40 시작", () => {
  const E = ctx.easterDate(2026);
  const s = ctx.spansOf(2026);
  assert.strictEqual(s.holyWeek[0].to, ctx.addDays(E, -1));      // 성 토요일까지
  assert.strictEqual(s.easterOctave[0].from, E);
  assert.strictEqual(s.ascensionToPentecost[0].from, ctx.addDays(E, 40));
  assert.strictEqual(s.ascensionToPentecost[0].to, ctx.addDays(E, 48));
  // 승천일(E+39) 자체는 **제외**된다 — 그날은 자기 고유 본기도를 쓴다
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, 39), "ascensionToPentecost"), false);
  assert.strictEqual(ctx.inSpan(ctx.addDays(E, 40), "ascensionToPentecost"), true);
});

test("C-P-4 성탄 기간의 연도 경계 — 조각 둘, 양쪽 끝이 참", () => {
  const s = ctx.spansOf(2026);
  assert.deepStrictEqual(plain(s.christmasToBaptism),
    [{ from: "2026-01-01", to: "2026-01-10" }, { from: "2026-12-25", to: "2026-12-31" }]);
  assert.strictEqual(ctx.inSpan("2026-01-09", "christmasToBaptism"), true);   // 금 · 비소재일
  assert.strictEqual(ctx.inSpan("2026-12-25", "christmasToBaptism"), true);
  assert.strictEqual(ctx.inSpan("2026-01-16", "christmasToBaptism"), false);
  assert.deepStrictEqual(plain(s.christmasOctave),
    [{ from: "2026-01-01", to: "2026-01-01" }, { from: "2026-12-25", to: "2026-12-31" }]);
});

test("§4.10 inSpan 은 연도를 날짜에서 정한다 — 표를 인자로 받지 않는다", () => {
  // 스팬은 달력년으로 잘려 있어 어느 해의 표인지가 답을 바꾼다. 호출부가 표를 들고
  // 다닐 수 없게 인자를 없앴다 — 이웃 해 날짜에 조용히 틀린 답이 나오던 자리다.
  assert.strictEqual(ctx.inSpan("2027-01-02", "christmasToBaptism"), true);
  assert.strictEqual(ctx.inSpan("2026-01-02", "christmasToBaptism"), true);
  assert.strictEqual(ctx.inSpan.length, 2);   // (dateStr, name)
});

test("§4.10 모르는 스팬 이름은 throw — 이름은 데이터가 아니라 코드다", () => {
  assert.throws(() => ctx.inSpan("2026-04-01", "transferguard"), /unknown span/);
  assert.throws(() => ctx.inSpan("2026-04-01", "toString"), /unknown span/);
  assert.strictEqual(ctx.inSpan("bad-date", "transferGuard"), false);   // 날짜 결손은 false
});

test("§4.10 spansOf 는 연도 캐시를 쓴다", () => {
  assert.strictEqual(ctx.spansOf(2026), ctx.spansOf(2026));
  assert.notStrictEqual(ctx.spansOf(2026), ctx.spansOf(2027));
});

test("§4.6 표 결손은 건너뛴다 — throw 아님 (§2)", () => {
  // from/to 가 없는 창, week 이 없는 행, 원시 표를 그대로 넘긴 경우
  assert.deepStrictEqual(plain(ctx.buildOrdinalIndex({ weeks: [{ week: 3, windows: [{ anchor: "doy", to: "01-20" }] }] })),
    { doy: [], date: [] });
  const noWeek = ctx.buildOrdinalIndex({ weeks: [{ windows: [{ anchor: "doy", from: "01-07", to: "01-13" }] }] });
  assert.strictEqual(ctx.ordinalWeekOf("2026-01-11", noWeek), null);   // undefined 가 아니다
  assert.strictEqual(ctx.ordinalWeekOf("2026-06-10", { weeks: [] }), null);
  assert.deepStrictEqual(plain(ctx.buildOrdinalIndex(null)), { doy: [], date: [] });
});

test("§4.6 표 형태 이탈은 건너뛴다 — 창이 배열이 아니거나 없는 날 (§2)", () => {
  const build = (weeks) => plain(ctx.buildOrdinalIndex({ weeks }));
  const EMPTY = { doy: [], date: [] };
  // windows 가 배열이 아닌 행 — 종전엔 for…of 가 throw 했다
  for (const windows of [5, "x", {}, true, null]) {
    assert.deepStrictEqual(build([{ week: 3, windows }]), EMPTY, String(windows));
  }
  assert.deepStrictEqual(build([null, 7, "row"]), EMPTY);                    // 행이 객체가 아님
  assert.deepStrictEqual(build([{ week: 3, windows: [null, 1] }]), EMPTY);   // 창이 객체가 아님
  // 없는 날 — 종전엔 `01-32` 를 32 로 읽어 2026-02-01(주일)이 4주라는 그럴듯한 오답을 냈다
  const bogus = { weeks: [{ week: 4, windows: [{ from: "01-26", to: "01-32", anchor: "doy" }] }] };
  assert.deepStrictEqual(plain(ctx.buildOrdinalIndex(bogus)), EMPTY);
  assert.strictEqual(ctx.dayOfWeek("2026-02-01"), 0);
  assert.strictEqual(ctx.ordinalWeekOf("2026-02-01", ctx.buildOrdinalIndex(bogus)), null);
  for (const bad of ["2-17", "02-29", "13-01", "00-10", "01-00", "2026-01-07", "01/07", 7, null]) {
    assert.deepStrictEqual(build([{ week: 4, windows: [{ from: bad, to: "02-03", anchor: "doy" }] }]), EMPTY, String(bad));
    assert.deepStrictEqual(build([{ week: 4, windows: [{ from: "01-28", to: bad, anchor: "doy" }] }]), EMPTY, String(bad));
  }
  // date 앵커도 같은 검사 — 다만 2/29 는 실재하는 날이라 허용한다
  assert.deepStrictEqual(build([{ week: 6, windows: [{ from: "05-08", to: "05-32", anchor: "date" }] }]), EMPTY);
  assert.strictEqual(build([{ week: 6, windows: [{ from: "02-23", to: "02-29", anchor: "date" }] }]).date.length, 1);
  // 뒤집힌 창(from > to)은 어디에도 맞지 않는 결함이라 넣지 않는다
  assert.deepStrictEqual(build([{ week: 6, windows: [
    { from: "05-14", to: "05-08", anchor: "date" }, { from: "02-17", to: "02-11", anchor: "doy" }] }]), EMPTY);
  // 주차는 1~34 정수다 — 종전엔 0 · 2.5 · 35 · NaN 이 인덱스에 들어가 그대로 반환됐다
  for (const week of [0, 2.5, 35, -1, NaN, Infinity, "3"]) {
    const t = { weeks: [{ week, windows: [{ from: "06-05", to: "06-11", anchor: "date" }] }] };
    assert.deepStrictEqual(plain(ctx.buildOrdinalIndex(t)), EMPTY, String(week));
    assert.strictEqual(ctx.ordinalWeekOf("2026-06-07", ctx.buildOrdinalIndex(t)), null, String(week));
  }
  for (const week of [1, 34]) {
    const t = { weeks: [{ week, windows: [{ from: "06-05", to: "06-11", anchor: "date" }] }] };
    assert.strictEqual(ctx.ordinalWeekOf("2026-06-07", ctx.buildOrdinalIndex(t)), week);
  }
  // 온전한 창은 그대로 — 검사가 정상 표를 깎지 않는다
  assert.strictEqual(build(WEEKS.weeks).doy.length + build(WEEKS.weeks).date.length, 7);
});

test("§4.8 음력 표기 이탈은 건너뛴다 — 그럴듯한 오답을 내지 않는다 (§2)", () => {
  const one = (v) => ({ years: { "2026": { "1-1": v } } });
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(one("2-17"), 2026)), {});        // 단자리 월
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(one("2026-02-17"), 2026)), {});  // 전체 날짜
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(one(null), 2026)), {});
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(one("02-30"), 2026)), {});       // 없는 날
  assert.deepStrictEqual(plain(ctx.lunarDatesOf(one("02.17"), 2026)), { "1-1": "2026-02-17" });
});

// ── 날짜 유틸 결손 내성 (§4.1 · §2) ──

test("§4.1 잘못된 입력은 null — throw 아님", () => {
  for (const bad of ["", "2026-1-1", "26-01-01", "2026/01/01", "2026-02-30", "2026-13-01", null, 42]) {
    assert.strictEqual(ctx.parseDate(bad), null, String(bad));
    assert.strictEqual(ctx.addDays(bad, 1), null, String(bad));
    assert.strictEqual(ctx.dayOfWeek(bad), -1, String(bad));
  }
  assert.deepStrictEqual(plain(ctx.parseDate("2024-02-29")), { y: 2024, m: 2, d: 29 });   // 윤년은 유효
});

test("§4.1 toISOString 함정 회피 — 로컬 날짜가 그대로 돈다", () => {
  assert.strictEqual(ctx.addDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(ctx.addDays("2027-01-01", -1), "2026-12-31");
  assert.strictEqual(ctx.addDays("2024-02-28", 1), "2024-02-29");
  assert.strictEqual(ctx.addDays("2023-02-28", 1), "2023-03-01");
});

// ════════════════════════════════════════════════════════════════════════════
// A1-b 조회 계층 — 합성 표 (설계서 §5 · 검토 문서 §5.7~§5.9 · PR 2)
// ════════════════════════════════════════════════════════════════════════════
// 실제 표와의 대조는 liturgical-engine.data.test.js 에 있다. 여기 표는 **규칙 하나씩을 가르도록**
// 꾸민 것이라 실제 데이터의 모양(래퍼 · 표기 · 필드)을 따르되 값은 지어냈다.

// vm 이 만든 배열 · 객체는 realm 이 달라 구조가 같아도 deepStrictEqual 이 틀린다 — 양쪽을 정규화한다.
const same = (a, b, msg) => assert.deepStrictEqual(plain(a), plain(b), msg);

const slot = (s, tag) => ({ slot: s, bookId: "x", refs: [{ chapter: 1, verseSpec: "1" }], label: `${tag}:${s}` });
const SAN = (id, date, name, extra = {}) => ({
  id, kind: "sanctoral", date, lunar: null, name, aliases: null, sanctoral_class: null, common_names: null,
  has_proper: true, rank: "minor_feast", precedence: 7, priority_group: null, transferable: false,
  transfer_to: null, outranks_sunday: false, color: "white", color_alt: null, ...extra,
});
const TMP = (id, name, rule, extra = {}) => ({
  id, kind: "temporal", name, aliases: null, coord_name: name, season: null, week: null, type: null, rule,
  rank: "principal", precedence: 1, priority_group: null, transferable: false, transfer_to: null,
  outranks_sunday: false, color: "white", color_alt: null, ...extra,
});
const REC = (id, fields = {}) => ({
  id, kind: "temporal", season: null, week: null, type: null, weekday: null, year: null, date: null, lunar: null,
  name: null, aliases: null, title: id, reading_track: null, set_no: 1, set_total: 1, set_note: null,
  readings: [slot("first", id), slot("psalm", id), slot("gospel", id)], ...fields,
});
const COL = (id, fields = {}) => ({
  id, kind: "temporal", season: null, week: null, type: null, weekday: null, year: null, date: null, lunar: null,
  name: null, aliases: null, title: `본기도 ${id}`, collect_no: 1, collect_total: 1, text: `본기도 ${id}`, ending: "A", ...fields,
});
const feastRec = (id, date, name, extra = {}) => REC(id, { kind: "sanctoral", type: "feast", date, name, ...extra });

const CAL_TABLES = {
  sanctoral: { _meta: {}, entries: [
    SAN("d0125-paul", "01.25", "사도 성 바울로의 회심", { rank: "major_feast", precedence: 6, sanctoral_class: "apostle" }),
    SAN("d0217-feast", "02.17", "합성 축일"),
    SAN("d0301-samil", "03.01", "삼일절", { sanctoral_class: "national" }),
    SAN("d0301-david", "03.01", "데이빗(주교, 601년경)", { sanctoral_class: "pastor", common_names: ["데이빗"], has_proper: false }),
    SAN("d1225-day", "12.25", "성탄 낮", { rank: "principal", precedence: 1 }),
    SAN("d1225-night", "12.25", "성탄 밤", { rank: "principal", precedence: 1 }),
    SAN("d1225-dawn", "12.25", "성탄 새벽", { rank: "principal", precedence: 1 }),
    SAN("d0929-founding", "09.29", "대한성공회 설립 기념일", { rank: "major_feast", precedence: 4 }),
    SAN("d0929-michael", "09.29", "성 미카엘과 모든 천사들", { rank: "major_feast", precedence: 3 }),
    SAN("d1231-sylvester", "12.31", "실베스터(로마의 주교, 335년)", { sanctoral_class: "pastor", common_names: ["실베스터"], has_proper: false }),
    SAN("d1231-wycliffe", "12.31", "위클리프(종교개혁자, 1384년)", { sanctoral_class: "teacher", has_proper: false }),
    SAN("d0101-name", "01.01", "거룩한 이름 예수", { rank: "major_feast", precedence: 3, sanctoral_class: "lord" }),
    SAN("d0101-peace", "01.01", "세계평화를 위한 기도일", { rank: "commemoration", has_proper: false, color: null }),
    SAN("d0624-baptist", "06.24", "성 세례 요한 탄생", { rank: "major_feast", precedence: 3, sanctoral_class: "saint" }),
    SAN("d1203-xavier", "12.03", "프란시스 사베리오", { sanctoral_class: "missionary" }),
    SAN("d0108-lucian", "01.08", "안티오키아의 루시안", { sanctoral_class: "martyr", common_names: ["루시안"], has_proper: false }),
    SAN("d0726-anna", "07.26", "안나와 요아킴", { sanctoral_class: "saint", common_names: ["안나", "요아킴"], has_proper: false }),
    SAN("d0214-cyril", "2-14", "키릴과 메토디우스", { sanctoral_class: "missionary", common_names: ["키릴", "메토디우스"], has_proper: false }),
    SAN("d1130-andrew", "11.30", "성 안드레아", { rank: "major_feast", precedence: 6, sanctoral_class: "apostle" }),
    SAN("d0503-memorial", "05.03", "합성 기념일", { rank: "commemoration", sanctoral_class: "martyr", has_proper: false, color: null }),
    SAN("d0607-anniv", "06.07", "합성 기념 행사", { sanctoral_class: "anniversary", has_proper: false }),
    SAN("d0611-martyr", "06.11", "합성 순교자", { sanctoral_class: "martyr", has_proper: false, common_names: ["합성"] }),
    SAN("lunar11-seol", null, "설날", { lunar: "1-1", rank: "regional_festival", precedence: 0, sanctoral_class: "national" }),
    "깨진 행", { id: 7, date: "03.03", name: "id 가 문자열이 아님" }, SAN("d0230-bad", "02.30", "없는 날"),
  ] },
  temporal: { _meta: {}, entries: [
    TMP("t-shrove", "합성 참회 화요일", { kind: "easter_offset", days: -47 }, { coord_name: null }),
    TMP("t-holy-sat", "성 토요일", { kind: "easter_offset", days: -1 }, { rank: null, precedence: null, season: "lent", type: "weekday", color: "red" }),
    TMP("t-vigil", "부활밤", { kind: "easter_offset", days: -1 }, { season: "easter", type: "feast" }),
    TMP("t-ember-summer", "하계재", { kind: "ember_wfs", anchor: { kind: "easter_offset", days: 49 } },
      { coord_name: null, type: "fast", rank: "feria", precedence: 8, color: "violet", penitential: true }),
    TMP("t-advent1", "대림1주일", { kind: "nearest_sunday", month: 11, day: 30 },
      { coord_name: null, season: "advent", week: 1, type: "sunday", rank: "privileged_sunday", precedence: 2, color: "violet" }),
    TMP("t-palm", "성지주일", { kind: "easter_offset", days: -7 },
      { aliases: ["고난주일"], season: "lent", type: "sunday", rank: "privileged_sunday", precedence: 2, color: "red" }),
    TMP("t-baptism", "주님의 세례", { kind: "first_sunday_after", month: 1, day: 6 },
      { season: "ordinary", week: 1, type: "sunday", rank: "major_feast", precedence: 3 }),
    TMP("t-norule", "규칙 없음", null),
  ] },
  // 표기 셋이 섞여 있다(§5.2) — 정규화가 받는지 본다. 둘째 행은 해를 넘긴다.
  periods: { _meta: {}, entries: [
    { id: "p-unity", from: "01.18", to: "01.25", name: "일치 기도 주간" },
    { id: "p-wrap", from: "12-30", to: "1.2", name: "해 넘김 기간" },
  ] },
  ordinalWeeks: { _meta: {}, weeks: [
    { week: 1, windows: [{ from: "01-07", to: "01-13", anchor: "doy" }] },
    { week: 2, windows: [{ from: "01-14", to: "01-20", anchor: "doy" }] },
    { week: 3, windows: [{ from: "01-21", to: "01-27", anchor: "doy" }] },
    { week: 26, windows: [{ from: "09-24", to: "09-30", anchor: "date" }] },
  ] },
  kasi: { _meta: {}, years: { "2026": { "1-1": "02-17", "8-15": "09-25" } } },
};

const LEC_TABLES = {
  readings: { _meta: {}, entries: [
    // 격자 — 트랙 둘, 주기 둘
    REC("ordinary-3-sun-A-t1", { season: "ordinary", week: 3, type: "sunday", year: "A", reading_track: 1 }),
    REC("ordinary-3-sun-A-t2", { season: "ordinary", week: 3, type: "sunday", year: "A", reading_track: 2 }),
    REC("ordinary-3-mon-II", { season: "ordinary", week: 3, type: "weekday", weekday: "mon", year: "II" }),
    REC("ordinary-3-mon-I", { season: "ordinary", week: 3, type: "weekday", weekday: "mon", year: "I" }),
    REC("ordinary-1-mon-II", { season: "ordinary", week: 1, type: "weekday", weekday: "mon", year: "II" }),
    REC("ordinary-1-tue-II", { season: "ordinary", week: 1, type: "weekday", weekday: "tue", year: "II" }),
    REC("advent-1-sun-A", { season: "advent", week: 1, type: "sunday", year: "A" }),
    REC("advent-1-sun-B", { season: "advent", week: 1, type: "sunday", year: "B" }),
    REC("advent-4-sun-B", { season: "advent", week: 4, type: "sunday", year: "B" }),
    REC("lent-2-tue", { season: "lent", week: 2, type: "weekday", weekday: "tue" }),
    // 고유명 평일 · 이름일 — 좌표 폴백을 타지 않는다(§5.3 판정 규칙)
    REC("holy-sat-s1", { season: "lent", type: "weekday", name: "성 토요일", set_no: 1, set_total: 2 }),
    REC("holy-sat-s2", { season: "lent", type: "weekday", name: "성 토요일", set_no: 2, set_total: 2 }),
    REC("holy-mon", { season: "lent", type: "weekday", weekday: "mon", name: "성주간 월요일" }),
    REC("ash-thu", { season: "lent", type: "weekday", weekday: "thu", name: "재의 수요일 후 목요일" }),
    REC("vigil-A", { season: "easter", type: "feast", name: "부활밤", year: "A" }),
    REC("vigil-B", { season: "easter", type: "feast", name: "부활밤", year: "B" }),
    REC("palm-A", { season: "lent", type: "sunday", name: "고난주일", year: "A" }),
    REC("baptism-A", { season: "ordinary", week: 1, type: "sunday", name: "주님의 세례", year: "A" }),
    // 사계재 — 계절이 이름 안에만 있다(§5.4 · 미결5)
    REC("ember-summer-wed", { type: "fast", weekday: "wed", name: "성직자의 성소를 위한 하계재 수요일" }),
    REC("ember-summer-fri-1", { type: "fast", weekday: "fri", name: "성직후보자의 성소를 위한 하계재 금요일" }),
    REC("ember-summer-fri-2", { type: "fast", weekday: "fri", name: "수도자의 성소를 위한 하계재 금요일" }),
    REC("ember-autumn-wed", { type: "fast", weekday: "wed", name: "성직자의 성소를 위한 추계재 수요일" }),
    // 날짜 전용 본문 — 격자 후보의 것(§5.4)
    REC("d0108-xmas-week", { kind: "sanctoral", season: "christmas", type: "weekday", date: "01.08", name: "성탄주간" }),
    REC("d1231-xmas-week", { kind: "sanctoral", season: "christmas", type: "weekday", date: "12.31", name: "성탄주간" }),
    REC("d1219-o", { kind: "sanctoral", season: "advent", type: "weekday", date: "12.19", name: "성탄 6일 전" }),
    REC("d1220-o", { kind: "sanctoral", season: "advent", type: "weekday", date: "12.20", name: "성탄 5일 전" }),
    // 성인력 — 날짜(+음력)로 닿는다
    feastRec("d0125-paul-s1", "01.25", "사도 성 바울로의 회심", { set_no: 1, set_total: 2 }),
    feastRec("d0125-paul-s2", "01.25", "사도 성 바울로의 회심", { set_no: 2, set_total: 2 }),
    feastRec("d0217-feast", "02.17", "합성 축일"),
    feastRec("d0301-samil", "03.01", "삼일절"),
    feastRec("d1225-day", "12.25", "성탄 낮"),
    feastRec("d1225-night", "12.25", "성탄 밤"),
    feastRec("d1225-dawn", "12.25", "성탄 새벽"),
    feastRec("d0929-joint", "09.29", "성 미카엘과 모든 천사들 / 대한성공회 설립 기념일"),
    feastRec("d0101-name", "01.01", "거룩한 이름 예수"),
    feastRec("d0624-baptist", "06.24", "성 세례요한 탄생 축일"),     // 띄어쓰기 하나로 이름 조인이 빠진다
    feastRec("d1130-andrew", "11.30", "성 안드레아"),
    feastRec("d0503-other", "05.03", "남의 축일"),
    REC("lunar-seol", { kind: "sanctoral", type: "feast", lunar: "1-1", name: "설날" }),
    REC("bad-date", { kind: "sanctoral", type: "feast", date: "13.40", name: "깨진 날짜" }),
  ] },
  collects: { _meta: {}, entries: [
    COL(1, { season: "ordinary", week: 3, type: "sunday", year: "A" }),
    COL(2, { season: "lent", week: 3, type: "sunday", year: ["A", "C"] }),
    COL(3, { season: "lent", week: 3, type: "sunday", year: "B" }),
    COL(4, { season: "ordinary", week: 3, type: "weekday" }),
    COL(5, { season: "ordinary", week: 3, type: "weekday", weekday: ["mon"], year: "II" }),
    COL(10, { kind: "sanctoral", season: "christmas", type: "weekday", date: "01.08", name: "성탄주간", collect_no: 2, collect_total: 2 }),
    COL(9, { kind: "sanctoral", season: "christmas", type: "weekday", date: "01.08", name: "성탄주간", collect_no: 1, collect_total: 2 }),
    COL(20, { kind: "sanctoral", type: "feast", date: "03.01", name: "삼일절", ending: "C" }),
    COL(21, { kind: "sanctoral", type: "feast", date: "01.01", name: "거룩한 이름 예수" }),
    COL(22, { type: "fast", weekday: "fri", name: "성직후보자의 성소를 위한 하계재 금요일" }),
    COL(23, { type: "fast", weekday: "fri", name: "수도자의 성소를 위한 하계재 금요일" }),
    COL(24, { kind: "sanctoral", type: "feast", date: "12.03", name: "프란시스 사베리오" }),
  ] },
  commons: { _meta: {}, classes: {
    martyr: { label: "순교자", collect: { text: "{name}의 순교를 기억하며", ending: "A" },
      readings: [{ set: 2, slots: [slot("first", "m2")] }, { set: 1, slots: [slot("first", "m1")] }] },
    pastor: { label: "성직자", collect: { text: "주님의 종 {name}에게", ending: "A" }, readings: [{ set: 1, slots: [slot("first", "p1")] }] },
    teacher: { label: "신학자", collect: { text: "{name}을(를) 통해", ending: "A" }, readings: [{ set: 1, slots: [slot("first", "t1")] }] },
    missionary: { label: "선교사", collect: { text: "{name}을(를) 세우시어", ending: "A" },
      readings: [1, 2, 3].map((n) => ({ set: n, slots: [slot("first", `mi${n}`)] })) },
    saint: { label: "성인", collect: { text: "{name}의 모범을", ending: "A" }, readings: [{ set: 1, slots: [slot("first", "s1")] }] },
    anniversary: { label: "설립일", collect: { text: "{name}", ending: "A" }, readings: [] },
  } },
  canticles: { magnificat: { name: "성모송가" } },
};

const CAL = ctx.buildCalendarIndex(CAL_TABLES);
const LEC = ctx.buildLectionaryIndex(LEC_TABLES);
/** PR 2 의 공개 래퍼와 같은 길 — 연도 캐시의 패스를 넘긴다. */
const resolve = (d) => ctx.resolveDateIn(CAL, d, ctx.transfersOf(Number(d.slice(0, 4))));
const cand = (r, id) => r.candidates.find((c) => c.observance.id === id);
const gridOf = (r) => r.candidates.find((c) => c.observance.id.startsWith("grid:"));
const readingIds = (r, c) => ctx.findReadingsIn(LEC, CAL, r, c).map((g) => g.id);
const collectsFor = (r, id) => ctx.findCollectsIn(LEC, CAL, r).find((e) => e.candidate.observance.id === id).collects;

// ── 5.9 resolveDate 후보 (§5.5) ──

test("C-5.5-1 후보 출처 다섯 — 격자 · 날짜 · 음력 · 규칙 파생, PR 2 는 전부 proper · official null · 빈 패스", () => {
  const r = resolve("2026-02-17");   // 합성 참회 화요일(E−47) ∧ 합성 축일(02.17) ∧ 설(KASI 2026 1-1)
  same(r.candidates.map((c) => c.observance.id),
    ["t-shrove", "d0217-feast", "lunar11-seol", "grid:ordinary-x-weekday-tue"]);
  assert.ok(r.candidates.every((c) => c.status === "proper"));
  assert.ok(r.candidates.every((c) => !("from" in c) && !("to" in c) && !("displacedBy" in c)));
  assert.strictEqual(r.official, null);
  assert.strictEqual(r.color, null);
  assert.strictEqual(r.colorAlt, null);
  same(plain(r.colors), []);
  // 빈 패스는 **네 필드 전부** — §5.5 가 optionals 까지 읽는다
  const pass = ctx.EMPTY_PASS();
  same(Object.keys(pass).sort(), ["arrivals", "defects", "departures", "optionals"]);
  assert.ok(pass.arrivals instanceof Map && pass.departures instanceof Map && pass.optionals instanceof Map);
  assert.ok(Array.isArray(pass.defects) && pass.defects.length === 0);
  assert.notStrictEqual(ctx.EMPTY_PASS().arrivals, pass.arrivals);   // 호출마다 새 패스
});

test("C-5.5-1 · C-5.5-5 ⑤ 도착 · 출발 · 선택 봉헌 경로와 표시 순서 — 패스를 채우면 형태 변경 없이 읽힌다", () => {
  // PR 3 의 패스를 흉내 낸다: 01.25 바울로가 다음 날로 떠나고, 11.30 안드레아가 도착하고, 선택 봉헌이 하나 얹힌다
  const paul = CAL.sanctoralByDate.get("01.25")[0];
  const andrew = CAL.sanctoralByDate.get("11.30")[0];
  const pass = ctx.EMPTY_PASS();
  pass.departures.set("2026-01-25", [{ observance: paul, status: "transferred_out", to: "2026-01-26", displacedBy: "grid:ordinary-3-sunday" }]);
  pass.arrivals.set("2026-01-25", [{ observance: andrew, status: "transferred_in", from: "2025-11-30", displacedBy: "t-x" }]);
  pass.optionals.set("2026-01-25", [{ observance: andrew, status: "optional", from: "2026-11-30" }]);
  const r = ctx.resolveDateIn(CAL, "2026-01-25", pass);
  same(r.candidates.map((c) => `${c.observance.id}:${c.status}`), [
    "d0125-paul:transferred_out",        // ① 교회력에 따른 축일 — 떠난 것도 자기 자리에 남아 안내된다
    "d1130-andrew:transferred_in",       // ② 이동 축일
    "d1130-andrew:optional",
    "grid:ordinary-3-sunday:proper",     // ③ 나머지
  ]);
  assert.strictEqual(r.candidates[0].to, "2026-01-26");
  assert.strictEqual(r.candidates[1].from, "2025-11-30");
});

test("C-5.5-5 표시 순서 — 축일 · 재일 → 격자, 출처 안에서는 id 순(배열 순서에 기대지 않는다)", () => {
  const r = resolve("2026-12-25");
  same(r.candidates.map((c) => c.observance.id),
    ["d1225-dawn", "d1225-day", "d1225-night", "grid:christmas-x-weekday-fri"]);
  const reversed = ctx.buildCalendarIndex({ ...CAL_TABLES, sanctoral: { entries: [...CAL_TABLES.sanctoral.entries].reverse() } });
  same(ctx.resolveDateIn(reversed, "2026-12-25", ctx.EMPTY_PASS()).candidates.map((c) => c.observance.id),
    r.candidates.map((c) => c.observance.id));
});

test("C-4.3-3 easter_offset −1 인덱스가 1:N — 성 토요일과 부활밤이 둘 다 후보", () => {
  const r = resolve("2026-04-04");
  same(r.candidates.map((c) => c.observance.id), ["t-holy-sat", "t-vigil", "grid:lent-x-weekday-sat"]);
});

test("C-5.5-3 ◐ 격자 ∧ temporal 행은 공존한다 — 대체가 아니다 (승자는 PR 3)", () => {
  const advent1 = resolve("2026-11-29");
  same(advent1.candidates.map((c) => c.observance.id), ["t-advent1", "grid:advent-1-sunday"]);
  // 대림1주일 행은 조인 이름이 없다 — 자기 좌표로 격자 레코드에 닿는다(§5.4). 2026-11-29 는 나해
  same(readingIds(advent1, cand(advent1, "t-advent1")), ["advent-1-sun-B"]);
  same(readingIds(advent1, gridOf(advent1)), ["advent-1-sun-B"]);
  const palm = resolve("2026-03-29");
  same(palm.candidates.map((c) => c.observance.id), ["t-palm", "grid:lent-x-sunday"]);
  same(readingIds(palm, cand(palm, "t-palm")), ["palm-A"]);   // 별칭(고난주일)도 조인 키
});

test("C-5.5-4 periods 는 배너용 — 2026-01-20 일치 기도 주간, 후보에는 없다 · 해를 넘기는 기간", () => {
  const r = resolve("2026-01-20");
  same(r.periods.map((p) => p.id), ["p-unity"]);
  assert.ok(!r.candidates.some((c) => c.observance.id.startsWith("p-")));
  same(resolve("2026-12-31").periods.map((p) => p.id), ["p-wrap"]);
  same(resolve("2027-01-02").periods.map((p) => p.id), ["p-wrap"]);
  same(resolve("2027-01-03").periods.map((p) => p.id), []);
});

test("C-5.5-2 Candidate 래퍼 · status 여섯 값 · 색 필드 셋이 js/types.d.ts 에 선언돼 있다", () => {
  const types = fs.readFileSync(path.resolve(__dirname, "../../js/types.d.ts"), "utf8");
  const union = types.match(/export type CandidateStatus =([^;]+);/);
  assert.ok(union, "CandidateStatus");
  same([...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort(),
    ["commemorated", "omitted", "optional", "proper", "transferred_in", "transferred_out"]);
  const resolved = types.match(/export interface ResolvedDate \{([^}]+)\}/);
  assert.ok(resolved, "ResolvedDate");
  for (const f of ["candidates: Candidate[]", "official: Candidate | null", "color: LiturgicalColor | null",
    "colorAlt: LiturgicalColorAlt | null", "colors: LiturgicalColor[]"]) assert.ok(resolved[1].includes(f), f);
  assert.match(types, /export interface Candidate \{[^}]*observance: Observance;[^}]*status: CandidateStatus;/);
});

// ── 격자 좌표 · 격자 관측일 (§5.1 · §5.5) ──

test("§5.5 격자 관측일 id · 이름 · precedence — 좌표에서 합성한다", () => {
  const cases = [
    ["2026-01-25", "grid:ordinary-3-sunday", "연중 3주일", 5],
    ["2026-01-26", "grid:ordinary-3-weekday-mon", "연중 3주 월요일", 8],
    ["2026-03-03", "grid:lent-2-weekday-tue", "사순 2주 화요일", 8],          // 설계서 §5.5 의 예
    ["2026-02-22", "grid:lent-1-sunday", "사순 1주일", 2],
    ["2026-03-30", "grid:lent-x-weekday-mon", "성주간 월요일", 8],             // 고유명 평일
    ["2026-02-19", "grid:lent-x-weekday-thu", "재의 수요일 후 목요일", 8],
    ["2026-04-02", "grid:lent-x-weekday-thu", "성주간 목요일", 8],             // temporal 행의 이름을 빌리지 않는다
    ["2026-04-06", "grid:easter-1-weekday-mon", "부활 1주 월요일", 8],
    ["2026-04-12", "grid:easter-2-sunday", "부활 2주일", 2],
    ["2026-05-24", "grid:easter-x-sunday", "부활 주일", 2],                    // 성령강림은 주차가 없다
    ["2026-12-19", "grid:advent-3-weekday-sat", "대림 3주 토요일", 8],
    ["2027-12-26", "grid:christmas-1-sunday", "성탄 1주일", 2],                // 검토 문서 부록 B 의 예
    ["2027-01-03", "grid:christmas-2-sunday", "성탄 2주일", 2],
    ["2022-12-25", "grid:christmas-x-sunday", "성탄 주일", 2],
    ["2026-12-30", "grid:christmas-x-weekday-wed", "성탄 수요일", 8],
  ];
  for (const [d, id, name, prec] of cases) {
    const g = gridOf(resolve(d)).observance;
    same([g.id, g.name, g.precedence], [id, name, prec], d);
  }
  assert.strictEqual(gridOf(resolve("2026-01-25")).observance.rank, "sunday");
  assert.strictEqual(gridOf(resolve("2026-02-22")).observance.rank, "privileged_sunday");
  assert.strictEqual(gridOf(resolve("2026-01-26")).observance.rank, "feria");
  assert.strictEqual(gridOf(resolve("2026-01-26")).observance.color, null);   // 절기 기본색은 B1(PR 3)
});

test("§5.1 좌표의 year — 연중 평일은 I/II, 그 밖은 A/B/C · 주일은 weekday null", () => {
  same(plain(resolve("2026-01-26").coord), { season: "ordinary", week: 3, type: "weekday", weekday: "mon", year: "II" });
  same(plain(resolve("2026-01-25").coord), { season: "ordinary", week: 3, type: "sunday", weekday: null, year: "A" });
  assert.strictEqual(resolve("2026-03-03").coord.year, "A");     // 절기 평일 — 주일 주기
  assert.strictEqual(resolve("2026-11-29").coord.year, "B");     // 대림 전환
  assert.strictEqual(resolve("bad"), null);
  assert.strictEqual(resolve("2026-02-30"), null);
});

// ── 5.8 폴백 · 조인 · 본문 (§5.3 · §5.4 · §5.6) ──

test("C-5.3-1 구체성 점수 — 단일 2 > 배열 1 > null 0 · 불일치 탈락 · 한 원소 배열 · season/week/type 정확 일치", () => {
  const req = { weekday: "mon", abc: "A", i2: "II" };
  const s = (rec, rq = req) => ctx.matchScore(rec, rq);
  assert.strictEqual(s({ weekday: "mon", year: "II" }), 4);
  assert.strictEqual(s({ weekday: ["mon"], year: null }), 1);            // 한 원소 배열은 배열이다(문자열 분기로 읽지 않는다)
  assert.strictEqual(s({ weekday: ["mon", "tue"], year: "II" }), 3);
  assert.strictEqual(s({ weekday: null, year: null }), 0);
  assert.strictEqual(s({ weekday: "tue", year: null }), -1);
  assert.strictEqual(s({ weekday: ["tue", "wed"], year: null }), -1);
  assert.strictEqual(s({ weekday: null, year: "I" }), -1);
  // A/B/C 와 I/II 는 다른 축이다 — 연중 평일에도 A/B/C 레코드는 주일 주기로 갈린다
  assert.strictEqual(s({ weekday: null, year: "A" }), 2);
  assert.strictEqual(s({ weekday: null, year: ["A", "C"] }), 1);
  assert.strictEqual(s({ weekday: null, year: "B" }), -1);
  assert.strictEqual(s({ year: "I" }, { weekday: null, abc: "C", i2: null }), -1);   // 절기 평일엔 I/II 가 없다
  const axes = { season: "ordinary", week: 3, type: "weekday" };
  assert.strictEqual(s({ season: "ordinary", week: 3, type: "weekday", weekday: null }, { ...req, axes }), 0);
  assert.strictEqual(s({ season: "ordinary", week: 4, type: "weekday", weekday: null }, { ...req, axes }), -1);
  assert.strictEqual(s({ season: "lent", week: 3, type: "weekday", weekday: null }, { ...req, axes }), -1);
  assert.strictEqual(s({ season: "ordinary", week: 3, type: "sunday", weekday: null }, { ...req, axes }), -1);
  // 실제 조회: 연중 3주 월요일 — 짝수해는 ["mon"]·II(점수 3)가 null(0)을 이기고, 홀수해 · 화요일은 null 이 남는다
  same(collectsFor(resolve("2026-01-26"), "grid:ordinary-3-weekday-mon").map((c) => c.id), [5]);
  same(collectsFor(resolve("2027-01-25"), "grid:ordinary-3-weekday-mon").map((c) => c.id), [4]);
  same(collectsFor(resolve("2026-01-27"), "grid:ordinary-3-weekday-tue").map((c) => c.id), [4]);
  // 사순3주 year ["A","C"] vs "B"
  same(collectsFor(resolve("2026-03-08"), "grid:lent-3-sunday").map((c) => c.id), [2]);
  same(collectsFor(resolve("2027-02-28"), "grid:lent-3-sunday").map((c) => c.id), [3]);
});

test("C-5.3-2 최고점 층 전체 보존 · collect_no / (트랙, 세트) 그룹 · id 정렬은 타입별(수 vs 사전)", () => {
  // 대체 본기도 두 건(collect_no 2 → 1 순으로 표에 있다)이 함께 남고 collect_no 순이다
  const r = resolve("2030-01-08");
  same(collectsFor(r, gridOf(r).observance.id).map((c) => [c.id, c.collect_no]), [[9, 1], [10, 2]]);
  // 트랙 1 · 2 가 다 남고 트랙 순이다
  same(readingIds(resolve("2026-01-25"), gridOf(resolve("2026-01-25"))), ["ordinary-3-sun-A-t1", "ordinary-3-sun-A-t2"]);
  // 세트 1 · 2 — 표 순서를 뒤집어도 같다
  const rev = ctx.buildLectionaryIndex({ ...LEC_TABLES, readings: { entries: [...LEC_TABLES.readings.entries].reverse() } });
  const paulDay = resolve("2026-01-26");
  const paulAt = { observance: CAL.sanctoralByDate.get("01.25")[0], status: "proper" };
  const rp = resolve("2026-01-25");
  same(ctx.findReadingsIn(rev, CAL, rp, paulAt).map((g) => g.id), ["d0125-paul-s1", "d0125-paul-s2"]);
  assert.ok(paulDay);
  // 정수 id 는 수치순(2 < 10), 문자열 id 는 사전순("a-10" < "a-2") — 섞지 않는다
  same([10, 2, 1].sort(ctx.compareIds), [1, 2, 10]);
  same(["a-2", "a-10", "a-1"].sort(ctx.compareIds), ["a-1", "a-10", "a-2"]);
});

test("C-5.3-4 이름 · 날짜가 있는 레코드는 폴백 해석 없음 — 성 토요일 독서가 성주간 평일에 퍼지지 않는다", () => {
  const holyMon = resolve("2026-03-30");
  same(readingIds(holyMon, gridOf(holyMon)), ["holy-mon"]);     // 고유명 평일은 이름으로
  for (const d of ["2026-03-31", "2026-04-01", "2026-02-20", "2026-02-18"]) {     // 성주간 화 · 수, 재의 수요일 후 금, 재의 수요일
    const r = resolve(d);
    same(readingIds(r, gridOf(r)), [], d);
  }
  const ashThu = resolve("2026-02-19");
  same(readingIds(ashThu, gridOf(ashThu)), ["ash-thu"]);
  // 성 토요일 본문은 자기 temporal 행으로만 — 세트 둘
  const holySat = resolve("2026-04-04");
  same(readingIds(holySat, cand(holySat, "t-holy-sat")), ["holy-sat-s1", "holy-sat-s2"]);
  same(readingIds(holySat, gridOf(holySat)), []);
  // 부활밤은 주기로 갈린다(2026 = 가해)
  same(readingIds(holySat, cand(holySat, "t-vigil")), ["vigil-A"]);
});

test("C-5.4-1 date + lunar 1:N 인덱스 — 음력 관측일은 음력 키로, 한 날짜의 두 행은 둘 다 후보", () => {
  const r = resolve("2026-02-17");
  same(readingIds(r, cand(r, "lunar11-seol")), ["lunar-seol"]);
  same(readingIds(r, cand(r, "d0217-feast")), ["d0217-feast"]);
  const samil = resolve("2026-03-01");
  same(samil.candidates.map((c) => c.observance.id), ["d0301-david", "d0301-samil", "grid:lent-2-sunday"]);
  // 표기 정규화(§5.2) — "2-14" 도 02.14 로 오른다, 없는 날 · 깨진 행은 건너뛴다
  assert.ok(cand(resolve("2026-02-14"), "d0214-cyril"));
  assert.ok(!CAL.sanctoralByDate.has("02.30"));
  assert.strictEqual(ctx.normMonthDay("2-14"), "02.14");
  assert.strictEqual(ctx.normMonthDay("02-29"), "02.29");
  assert.strictEqual(ctx.normMonthDay("13.01"), null);
  assert.strictEqual(ctx.normMonthDay("2026-02-14"), null);
  assert.ok(!LEC.readings.byDate.has("13.40") && !LEC.readings.named.some((r) => r.id === "bad-date"));
});

test("C-5.4-3 사계재 — 이름 부분문자열 + 요일 조인 · 금요일 두 건 보존 · 다른 계절과 섞이지 않는다", () => {
  const wed = resolve("2026-05-27");
  same(readingIds(wed, cand(wed, "t-ember-summer")), ["ember-summer-wed"]);
  const fri = resolve("2026-05-29");
  same(readingIds(fri, cand(fri, "t-ember-summer")), ["ember-summer-fri-1", "ember-summer-fri-2"]);
  same(collectsFor(fri, "t-ember-summer").map((c) => c.id), [22, 23]);
  const sat = resolve("2026-05-30");
  same(readingIds(sat, cand(sat, "t-ember-summer")), []);   // 합성 표에 토요일 레코드가 없다
});

test("C-5.4-4 좁히기 규칙 ① — 날짜 전용 본문은 그날 절기와 맞을 때만 · 주일은 날짜 전용 평일 본문을 받지 않는다", () => {
  // 세례 1/7(2024) — 1/8 은 곧장 연중 1주 평일, 성탄주간 레코드를 버린다
  const after = resolve("2024-01-08");
  assert.strictEqual(after.coord.season, "ordinary");
  same(readingIds(after, gridOf(after)), ["ordinary-1-mon-II"]);
  // 세례 1/13(2030) — 1/8 은 성탄절기라 날짜 전용 본문
  const before = resolve("2030-01-08");
  assert.strictEqual(before.coord.season, "christmas");
  same(readingIds(before, gridOf(before)), ["d0108-xmas-week"]);
  // 2026-12-20 대림 4주일 — 「성탄 5일 전」(평일)이 아니라 주일 격자
  const adv4 = resolve("2026-12-20");
  same(readingIds(adv4, gridOf(adv4)), ["advent-4-sun-B"]);
});

test("C-5.6-6 날짜 선택 순서 — grid: 는 resolved.date, 그 밖은 관측일 자신의 date (키의 존재가 아니라 출처)", () => {
  // 격자 관측일도 표시용 name 을 가진다 — 그래도 날짜 전용 본문을 resolved.date 로 찾는다
  const r = resolve("2026-12-19");
  const g = gridOf(r);
  assert.strictEqual(g.observance.id, "grid:advent-3-weekday-sat");
  assert.ok(g.observance.name);
  same(readingIds(r, g), ["d1219-o"]);
  // 옮겨 온 축일(transferred_in)은 **기원** 날짜로 — 목적지 12.01 에는 안드레아 본문이 없다
  const dest = resolve("2025-12-01");
  const andrew = { observance: CAL.sanctoralByDate.get("11.30")[0], status: "transferred_in", from: "2025-11-30", displacedBy: "t-advent1" };
  same(readingIds(dest, andrew), ["d1130-andrew"]);
  assert.ok(!LEC.readings.byDate.has("12.01"));
});

test("C-5.6-1 트랙과 세트는 다르다 — 트랙 순(없음 → 1 → 2) · 세트 순, 「2」를 트랙으로 읽지 않는다", () => {
  const holySat = resolve("2026-04-04");
  const groups = ctx.findReadingsIn(LEC, CAL, holySat, cand(holySat, "t-holy-sat"));
  same(groups.map((x) => [x.reading_track, x.set_no, x.set_total]), [[null, 1, 2], [null, 2, 2]]);
  const sun = ctx.findReadingsIn(LEC, CAL, resolve("2026-01-25"), gridOf(resolve("2026-01-25")));
  same(sun.map((x) => [x.reading_track, x.set_no]), [[1, 1], [2, 1]]);
  assert.ok(sun.every((x) => x.common === null));
});

test("C-5.6-2 슬롯은 이름으로 — 엔진은 슬롯 객체를 위치로 다시 매기지 않고 그대로 넘긴다", () => {
  const odd = REC("odd", { kind: "sanctoral", type: "feast", date: "06.24", name: "성 세례요한 탄생 축일",
    readings: [slot("gospel", "o"), slot("first", "o")] });   // 순서가 뒤집히고 둘째 독서 · 시편이 없다
  const lix = ctx.buildLectionaryIndex({ ...LEC_TABLES, readings: { entries: [odd] } });
  const r = resolve("2026-06-24");
  const [grp] = ctx.findReadingsIn(lix, CAL, r, cand(r, "d0624-baptist"));
  assert.strictEqual(grp.readings, odd.readings);
  same(grp.readings.map((s) => s.slot), ["gospel", "first"]);
});

test("C-5.6-4 성인 공통 독서 폴백 — 트리거는 「좁힌 고유 독서 0건」, 날짜 인덱스가 비었는가가 아니다", () => {
  // 양성: 사베리오(has_proper 참 · 독서 0) — 세 세트 전부, 인쇄 순, 그룹 형태 동형
  const xav = resolve("2026-12-03");
  const groups = ctx.findReadingsIn(LEC, CAL, xav, cand(xav, "d1203-xavier"));
  same(groups.map((x) => x.id), ["common:missionary-s1", "common:missionary-s2", "common:missionary-s3"]);
  same(plain(groups[0]), {
    id: "common:missionary-s1", title: "선교사", reading_track: null, set_no: 1, set_total: 3, set_note: null,
    readings: plain(LEC_TABLES.commons.classes.missionary.readings[0].slots), common: "missionary",
  });
  // 양성: 날짜에 **남의 본문**이 있어도 — 루시안(01.08 성탄주간) · 실베스터 · 위클리프(12.31 성탄주간) · 데이빗(03.01 삼일절)
  const at = (d, id) => { const r = resolve(d); return readingIds(r, cand(r, id)); };
  same(at("2030-01-08", "d0108-lucian"), ["common:martyr-s1", "common:martyr-s2"]);   // 세트 순(표는 2, 1)
  same(at("2026-12-31", "d1231-sylvester"), ["common:pastor-s1"]);
  same(at("2026-12-31", "d1231-wycliffe"), ["common:teacher-s1"]);
  same(at("2026-03-01", "d0301-david"), ["common:pastor-s1"]);
  // 음성: 행이 하나뿐인 날짜는 이름을 묻지 않는다 — 06.24 띄어쓰기 드리프트가 공통으로 새지 않는다
  same(at("2026-06-24", "d0624-baptist"), ["d0624-baptist"]);
  // 음성: 기념일은 빈 배열(분류가 있어도) · anniversary 는 세트가 0 이라 빈 배열 · 공통이 없는 분류(apostle)도 빈 배열
  same(at("2026-05-03", "d0503-memorial"), []);
  same(at("2026-06-07", "d0607-anniv"), []);
  const noCommon = { observance: SAN("x-apostle", "06.08", "합성 사도", { sanctoral_class: "apostle" }), status: "proper" };
  same(ctx.findReadingsIn(LEC, CAL, resolve("2026-06-08"), noCommon), []);
  // 배타: 고유가 하나라도 있으면 공통을 섞지 않는다 — 세례 요한은 공통(saint)이 있는 분류다
  const bap = resolve("2026-06-24");
  assert.ok(LEC_TABLES.commons.classes.saint.readings.length > 0);
  assert.ok(ctx.findReadingsIn(LEC, CAL, bap, cand(bap, "d0624-baptist")).every((x) => x.common === null));
  // status 무관: 고유 독서 없는 순교자를 옮겨 온 후보도 공통을 탄다
  const moved = { observance: CAL.sanctoralByDate.get("06.11")[0], status: "transferred_in", from: "2026-06-11", displacedBy: "x" };
  same(ctx.findReadingsIn(LEC, CAL, resolve("2026-06-12"), moved).map((x) => x.common), ["martyr", "martyr"]);
  // 프로토타입 키를 분류로 읽지 않는다
  const proto = { observance: SAN("x-proto", "06.13", "합성", { sanctoral_class: "constructor" }), status: "proper" };
  same(ctx.findReadingsIn(LEC, CAL, resolve("2026-06-13"), proto), []);
});

test("C-5.6-3 findCollects — 관측일별 원소 · candidates 순 · 대체안은 collect_no 순 · 기념일은 빈 collects · 송영 코드", () => {
  const r = resolve("2026-01-01");
  const out = ctx.findCollectsIn(LEC, CAL, r);
  // 원소마다 candidate 연결 — 평면 배열이 아니다
  same(out.map((e) => e.candidate), r.candidates);
  same(out.map((e) => e.collects.map((c) => c.id)), [[21], [], []]);   // 거룩한 이름 · 세계평화(기념일) · 격자
  assert.strictEqual(collectsFor(resolve("2026-03-01"), "d0301-samil")[0].ending, "C");
  // 공통 본기도 — {name} 치환, 이름 배열은 「A와 B」(받침이면 「과」), common_names 가 없으면 괄호 설명을 뗀다
  const name = (d, id) => collectsFor(resolve(d), id)[0];
  same(plain(name("2026-07-26", "d0726-anna")),
    { id: "common:saint-c1", title: "성인", collect_no: 1, collect_total: 1, text: "안나와 요아킴의 모범을", ending: "A", common: "saint" });
  assert.strictEqual(name("2026-02-14", "d0214-cyril").text, "키릴과 메토디우스을(를) 세우시어");
  assert.strictEqual(name("2026-12-31", "d1231-wycliffe").text, "위클리프을(를) 통해");
  assert.strictEqual(name("2026-12-31", "d1231-sylvester").text, "주님의 종 실베스터에게");
  // 본기도 트리거는 has_proper — 사베리오(참)는 고유 본기도, 독서만 공통
  same(collectsFor(resolve("2026-12-03"), "d1203-xavier").map((c) => [c.id, c.common]), [[24, null]]);
  assert.strictEqual(ctx.displayNameOf({ name: "가", common_names: ["가", "나", "다"] }), "가, 나와 다");
});

test("미결12 잠정 — 1:N 좁히기: 12.25 세 갈래 · 09.29 합성 레코드는 둘 다 · 12.31 성탄주간은 성인 것이 아니다", () => {
  // C-5.6-5(🔴)는 미결12 가 닫힐 때까지 열려 있다 — 이 테스트는 잠정 구현이 그 단언을 지키는지 본다
  const xmas = resolve("2026-12-25");
  for (const id of ["d1225-day", "d1225-night", "d1225-dawn"]) same(readingIds(xmas, cand(xmas, id)), [id]);
  const mich = resolve("2026-09-29");
  same(readingIds(mich, cand(mich, "d0929-michael")), ["d0929-joint"]);   // 좁히기 실패 → 남은 것 전부
  same(readingIds(mich, cand(mich, "d0929-founding")), ["d0929-joint"]);
  const eve = resolve("2026-12-31");
  same(readingIds(eve, gridOf(eve)), ["d1231-xmas-week"]);              // 성탄주간은 격자 후보의 것
  // 01.01 — 기념일(세계평화)은 같은 날짜의 거룩한 이름 예수 본문을 받지 않는다
  const ny = resolve("2026-01-01");
  same(readingIds(ny, cand(ny, "d0101-name")), ["d0101-name"]);
  same(readingIds(ny, cand(ny, "d0101-peace")), []);
});

test("C-2-1 ◐ 기념일은 독서 · 본기도 빈 결과 — 날짜에 남의 본문이 있어도, 분류가 있어도 공통을 타지 않는다", () => {
  const r = resolve("2026-05-03");   // 합성 기념일(martyr 분류) 하나뿐인 날짜에 「남의 축일」 본문이 있다
  const c = cand(r, "d0503-memorial");
  same(ctx.findReadingsIn(LEC, CAL, r, c), []);
  same(collectsFor(r, "d0503-memorial"), []);
});

test("§2 표 결손은 흡수한다 — 래퍼 · 배열 · 행 모양이 틀려도 throw 하지 않는다", () => {
  for (const bad of [null, {}, { entries: 5 }, { entries: [null, 3, "x"] }]) {
    const cal = ctx.buildCalendarIndex({ sanctoral: bad, temporal: bad, periods: bad, ordinalWeeks: bad, kasi: bad });
    const r = ctx.resolveDateIn(cal, "2026-06-10", ctx.EMPTY_PASS());
    same(r.candidates.map((x) => x.observance.id), ["grid:ordinary-x-weekday-wed"], JSON.stringify(bad));
    const lix = ctx.buildLectionaryIndex({ readings: bad, collects: bad, commons: bad, canticles: bad });
    same(ctx.findReadingsIn(lix, cal, r, r.candidates[0]), []);
    same(plain(ctx.findCollectsIn(lix, cal, r)).map((e) => e.collects), [[]]);
  }
  same(ctx.buildCalendarIndex(null).temporal, []);
  same(ctx.findReadingsIn(LEC, CAL, resolve("2026-06-10"), null), []);
  same(ctx.findCollectsIn(LEC, CAL, null), []);
  // rule: null 인 temporal 행은 후보에 오르지 않는다(C-4.3-5 와 같은 규칙)
  assert.ok(!CAL.temporal.every((t) => t.rule) && [...ctx.movableOf(CAL, 2026).values()].flat().every((t) => t.rule));
});

// ── 5.7 프리로드 · 캐시 · 결손 (§3.4 · §4.9) ──

test("C-4.9-1 ◐ anchorCache / transferCache 분리 · 42칸 월간 뷰의 computus ≤ 3 (PR 2 는 빈 패스)", () => {
  vm.runInContext("anchorCache.clear(); spansCache.clear(); transferCache.clear();", ctx);
  // 2026년 12월 월간 뷰 — 2026-11-29(주일)부터 42칸, 2027-01-09 까지
  for (let i = 0, d = "2026-11-29"; i < 42; i++, d = ctx.addDays(d, 1)) resolve(d);
  const anchors = [...vm.runInContext("anchorCache", ctx).keys()].sort();
  assert.ok(anchors.length <= 3, anchors.join(","));
  same(anchors, [2026, 2027]);   // 한 해 걸치면 Y · Y+1 — Y−1 seed 는 PR 3 의 패스가 요구한다
  const passes = vm.runInContext("transferCache", ctx);
  same([...passes.keys()].sort(), [2026, 2027]);
  for (const p of passes.values()) same(Object.keys(p).sort(), ["arrivals", "defects", "departures", "optionals"]);
  assert.strictEqual(ctx.transfersOf(2026), passes.get(2026));   // 같은 해는 같은 패스
  assert.ok(!passes.has(2025));                                  // 앵커가 있어도 패스는 따로 — 반쪽 항목이 없다
});

/** 공개 래퍼까지 실은 새 엔진 — 모듈 상태가 테스트마다 새로 선다. */
function loadEngine(fetchImpl) {
  const c = {
    Object, Array, Set, Map, String, Number, Boolean, Math, JSON, console, Error,
    parseInt, isNaN, Date, NaN, Promise, fetch: fetchImpl,
  };
  vm.createContext(c);
  vm.runInContext(STATE_PRELUDE + ' const DATA_DIR = "/data"; let calendarIndex = null; let calendarPromise = null;'
    + " let lectionaryIndex = null; let lectionaryPromise = null;", c, { filename: "prelude" });
  for (const b of ["LITURGICAL_CORE", "LITURGICAL_LOOKUP", "LITURGICAL_PRELOAD"]) {
    vm.runInContext(extractBlock(b, SOURCE), c, { filename: `liturgical-engine.js#${b}` });
  }
  return c;
}
const FILES = {
  sanctoral: CAL_TABLES.sanctoral, "temporal-feasts": CAL_TABLES.temporal, periods: CAL_TABLES.periods,
  "ordinal-weeks": CAL_TABLES.ordinalWeeks, "kasi-lunar": CAL_TABLES.kasi,
  "eucharist-readings": LEC_TABLES.readings, "eucharist-collects": LEC_TABLES.collects,
  commons: LEC_TABLES.commons, canticles: LEC_TABLES.canticles,
};
/** fetch 가짜 — 부른 URL 을 적고, `fail` 에 든 파일은 500 으로 답한다. */
function fakeFetch(calls, fail = new Set()) {
  return (url) => {
    calls.push(url);
    const name = url.replace(/^\/data\/lectionary\//, "").replace(/\.json$/, "");
    return Promise.resolve({ ok: !fail.has(name) && name in FILES, json: () => Promise.resolve(FILES[name]) });
  };
}

test("C-3.4-1 프리로드 전 동기 API 는 명확한 메시지로 throw", () => {
  const e = loadEngine(fakeFetch([]));
  assert.throws(() => e.resolveDate("2026-01-25"), /preloadCalendar\(\) must be awaited before resolveDate\(\)/);
  assert.throws(() => e.findReadings({}, {}), /preloadLectionary\(\) must be awaited before findReadings\(\)/);
  assert.throws(() => e.findCollects({}), /preloadLectionary\(\) must be awaited before findCollects\(\)/);
});

test("C-3.4-2 동시 프리로드는 파일당 fetch 1회 · 실패한 프리로드는 캐시되지 않고 재시도가 다시 fetch", async () => {
  const calls = [];
  const fail = new Set(["kasi-lunar", "commons"]);
  const e = loadEngine(fakeFetch(calls, fail));
  // 실패 — 두 묶음 다 거부되고 promise 가 비워진다
  await assert.rejects(e.preloadCalendar(), /lectionary\/kasi-lunar\.json/);
  await assert.rejects(e.preloadLectionary(), /lectionary\/commons\.json/);
  assert.strictEqual(vm.runInContext("calendarPromise", e), null);
  assert.strictEqual(vm.runInContext("lectionaryPromise", e), null);
  assert.throws(() => e.resolveDate("2026-01-25"), /preloadCalendar/);
  // 재시도 — 네트워크가 돌아오면 다시 fetch 한다(종전 promise 를 되던지지 않는다)
  fail.clear();
  calls.length = 0;
  const [a, b] = [e.preloadCalendar(), e.preloadCalendar()];
  assert.strictEqual(a, b);                                   // 동시 진입은 같은 promise
  const [c, d] = [e.preloadLectionary(), e.preloadLectionary()];
  assert.strictEqual(c, d);
  await Promise.all([a, c]);
  same(calls.slice().sort(), Object.keys(FILES).map((f) => `/data/lectionary/${f}.json`).sort());
  // 그 뒤의 호출은 fetch 를 더 내지 않는다
  await e.preloadCalendar();
  await e.preloadLectionary();
  assert.strictEqual(calls.length, Object.keys(FILES).length);
  assert.strictEqual(e.resolveDate("2026-01-25").candidates[0].observance.id, "d0125-paul");
});

test("C-2-2 「빈 결과」와 「아직 안 불러옴」을 뷰가 구별할 수 있다", async () => {
  const e = loadEngine(fakeFetch([]));
  await e.preloadCalendar();
  const r = e.resolveDate("2026-06-10");   // 합성 표에 아무 본문도 없는 연중 평일
  assert.throws(() => e.findReadings(r, r.candidates[0]), /preloadLectionary/);   // 안 불러옴 — throw
  await e.preloadLectionary();
  const empty = e.findReadings(r, r.candidates[0]);                              // 불러왔지만 없음 — 빈 배열
  assert.ok(Array.isArray(empty) && empty.length === 0);
  same(plain(e.findCollects(r)).map((x) => x.collects), [[]]);
  assert.strictEqual(e.resolveDate("2026-13-01"), null);                         // 잘못된 날짜는 null(throw 아님)
});

test("§4.9 캘린더 인덱스가 새로 서면 이동 패스 캐시를 비운다", async () => {
  const e = loadEngine(fakeFetch([]));
  vm.runInContext("transferCache.set(1999, null)", e);
  await e.preloadCalendar();
  assert.strictEqual(vm.runInContext("transferCache.has(1999)", e), false);
});
