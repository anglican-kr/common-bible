// ── Unit tests for js/app/liturgical-engine.js — A1-a 계산 계층 ────────────────
// Run with: node --test tests/unit/liturgical-engine.test.js
//
// 설계서 §7 「테스트 계획」 · 검토 문서 §5.1~5.6(PR 1) 의 체크 항목을 잡는다.
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
vm.runInContext("const anchorCache = new Map(); const spansCache = new Map();", ctx, { filename: "prelude" });
vm.runInContext(extractBlock("LITURGICAL_CORE", SOURCE), ctx, { filename: "liturgical-engine.js" });

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
  // PR 2(§5.4 권장 인덱스)의 몫이라 여기서 잡을 수 없다 — 항목을 다시 열어 두었다.
  // PR 1 이 주는 것은 「서로 다른 레코드의 rule 이 같은 날짜를 낸다」까지다.
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

test("C-4.5-1 한 해가 정확히 한 절기씩 — 겹침 0 · 빈틈 0 (1900~2100)", () => {
  const DOMAIN = ["advent", "christmas", "ordinary", "lent", "easter"];
  for (const y of YEARS) {
    let d = ctx.toKey(y, 1, 1);
    let n = 0;
    while (d.slice(0, 4) === String(y)) {
      const s = ctx.seasonOf(d);
      assert.ok(DOMAIN.includes(s), `${d} → ${s}`);
      n++;
      d = ctx.addDays(d, 1);
    }
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    assert.strictEqual(n, leap ? 366 : 365, `${y} 일수`);
  }
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
