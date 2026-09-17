// @ts-check
"use strict";

// Liturgical calendar engine (ADR-037 §6). Leaf module: no imports, no DOM.
// Two-phase API — callers await preloadCalendar()/preloadLectionary() once,
// then the resolve/find functions are synchronous and pure over the loaded
// tables. See docs/design/liturgical-engine.md §3.4 for why.
//
// PR 1 (A1-a) implements the LITURGICAL_CORE block only — date arithmetic,
// computus, rule evaluation, season spans, ordinal weeks, cycles, lunar lookup
// and the period axis. The lookup layer (LITURGICAL_LOOKUP) lands in PR 2.
//
// 모든 날짜는 로컬 `new Date(y, m - 1, d)` 와 "YYYY-MM-DD" 문자열로 다룬다.
// **`toISOString()` 으로 날짜 문자열을 만들지 않는다** — UTC 오프셋 때문에 KST 에서
// 하루 어긋난다(설계서 §4, ADR-037 §6 이 명시적으로 지시).

/**
 * @typedef {{
 *   year: number, easter: string, advent1: string, baptism: string,
 *   ash: string, pentecost: string
 * }} YearAnchors
 */

/** @typedef {{from: string, to: string}} Span */

// 연도 캐시(§4.9) — 순수 파생값이라 무효화가 필요 없다. 블록 밖에 두어 테스트가
// prelude 로 재선언한다(ADR-013 하네스 제약, 설계서 §3.3).
/** @type {Map<number, YearAnchors>} */
const anchorCache = new Map();
/** @type {Map<number, Record<string, Span[]>>} */
const spansCache = new Map();

// ── BEGIN LITURGICAL_CORE ──
// 날짜 산술 · computus · 오프셋 전개 · 절기 스팬 · 연중 주차 · 주기 산정 · 기간 축.
// 외부 입력은 `ordinal-weeks` · `kasi-lunar` 두 표뿐이고 둘 다 인자로 받는다 — 그래서
// 계산만 검증하는 테스트가 조회용 표 스텁을 만들 필요가 없다(설계서 §3.3).

// ── §4.1 날짜 유틸 ──

/**
 * "YYYY-MM-DD" → {y, m, d}. 형식이 틀리면 null (throw 아님 — search.js:199 선례).
 * @param {string} s
 * @returns {{y: number, m: number, d: number} | null}
 */
function parseDate(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 2월 30일 같은 값은 Date 가 넘겨 버리므로 되읽어 대조한다.
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return { y, m: mo, d };
}

/**
 * @param {number} y @param {number} m @param {number} d
 * @returns {string} "YYYY-MM-DD"
 */
function toKey(y, m, d) {
  return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

/**
 * 날짜 문자열 덧셈. 입력이 틀리면 null.
 * @param {string} s @param {number} n
 * @returns {string | null}
 */
function addDays(s, n) {
  const p = parseDate(s);
  if (!p) return null;
  const dt = new Date(p.y, p.m - 1, p.d + n);
  return toKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/**
 * 0(일)~6(토). 입력이 틀리면 -1.
 * @param {string} s
 * @returns {number}
 */
function dayOfWeek(s) {
  const p = parseDate(s);
  if (!p) return -1;
  return new Date(p.y, p.m - 1, p.d).getDay();
}

/**
 * 1~366. **윤년의 2/29 를 센다** — 연중 주차 `doy` 앵커가 이 정의를 전제한다(§4.6).
 * @param {string} s
 * @returns {number}
 */
function dayOfYear(s) {
  const p = parseDate(s);
  if (!p) return -1;
  const start = new Date(p.y, 0, 1);
  const here = new Date(p.y, p.m - 1, p.d);
  return Math.round((here.getTime() - start.getTime()) / 86400000) + 1;
}

/**
 * 가장 가까운 주일. 정확히 3.5일 떨어지는 경우는 없으므로 동률이 없다.
 * @param {string} s
 * @returns {string | null}
 */
function nearestSunday(s) {
  const w = dayOfWeek(s);
  if (w < 0) return null;
  return addDays(s, w <= 3 ? -w : 7 - w);
}

/**
 * **엄격히 이후**의 첫 주일 — 그날이 주일이어도 다음 주일을 낸다.
 * @param {string} s
 * @returns {string | null}
 */
function firstSundayAfter(s) {
  const w = dayOfWeek(s);
  if (w < 0) return null;
  return addDays(s, 7 - w);
}

/**
 * **엄격히 이전**의 마지막 주일 — 그날이 주일이어도 전 주일을 낸다.
 * @param {string} s
 * @returns {string | null}
 */
function lastSundayBefore(s) {
  const w = dayOfWeek(s);
  if (w < 0) return null;
  return addDays(s, w === 0 ? -7 : -w);
}

/**
 * 그 달의 n 번째 주일. 달을 넘기면 null.
 * @param {number} y @param {number} m @param {number} n
 * @returns {string | null}
 */
function nthSunday(y, m, n) {
  if (!(n >= 1)) return null;
  const first = toKey(y, m, 1);
  const w = dayOfWeek(first);
  if (w < 0) return null;
  const day = 1 + ((7 - w) % 7) + (n - 1) * 7;
  const probe = new Date(y, m - 1, day);
  if (probe.getMonth() !== m - 1) return null;
  return toKey(y, m, day);
}

/**
 * 그 날이 속한 주의 주일(그날이 주일이면 그날). 주간은 주일에 시작한다.
 * @param {string} s
 * @returns {string | null}
 */
function sundayOfWeek(s) {
  const w = dayOfWeek(s);
  if (w < 0) return null;
  return w === 0 ? s : addDays(s, -w);
}

/**
 * 내부 전용 날짜 덧셈. **입력이 언제나 유효한 자리에서만** 쓴다(앵커 · toKey 산출물).
 * `addDays` 는 공개 계약이 `string | null` 이라 그대로 쓰면 호출부마다 캐스트가 생기고,
 * 캐스트는 `@ts-check` 가 검증하지 않는다 — 그래서 좁히기를 한 곳에 모은다.
 * @param {string} dateStr @param {number} nn
 * @returns {string}
 */
function shift(dateStr, nn) {
  const v = addDays(dateStr, nn);
  return v === null ? dateStr : v;   // 도달 불가: 유효한 키만 넘긴다
}

// ── §4.2 부활절 computus ──

/**
 * Anonymous Gregorian algorithm (Meeus/Jones/Butcher) — ADR-036 §11 채택.
 * 서방 그레고리력이다(정교회 율리우스력 computus 가 아니다). 교회력 부활절은
 * 천문값이 아니라 교회 춘분 3/21 + 교회 보름표(epact)라 닫힌 산식으로 재구현이 안전하다.
 * @param {number} y
 * @returns {string}
 */
function easterDate(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toKey(y, month, day);
}

// ── §4.4 대림 앵커 · 전례년 ──

/**
 * 대림 1주일 = 11월 30일에 가장 가까운 주일 = 성탄일 전 네 번째 주일. 11.27~12.03.
 * @param {number} y
 * @returns {string}
 */
function advent1Date(/** @type {number} */ y) {
  const s = nearestSunday(toKey(y, 11, 30));
  // nearestSunday 는 유효한 입력에 언제나 값을 낸다.
  return s === null ? toKey(y, 11, 30) : s;
}

/** 주의 세례 주일 = 1.6 **이후** 첫 주일(엄격히 이후 — 1.6 이 주일이면 다음 주일). */
function baptismDate(/** @type {number} */ y) {
  const s = firstSundayAfter(toKey(y, 1, 6));
  return s === null ? toKey(y, 1, 7) : s;
}

/**
 * 전례년 — 그 해가 **끝나는** 달력년으로 부른다. 경계는 달이 아니라 `advent1Date(y)`
 * 그 날이다. 「12월부터 새 전례년」으로 잡으면 12월 1~2일을 **어떤 해에만** 틀리게
 * 넣는다(2023-12-01 은 아직 전년, 2024-12-01 은 새 전례년 — §4.4).
 * @param {string} dateStr
 * @returns {number}
 */
function liturgicalYearOf(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return NaN;
  return dateStr >= yearAnchors(p.y).advent1 ? p.y + 1 : p.y;
}

// ── §4.9 연도 앵커 캐시 ──

/**
 * 한 해의 부활절·대림·세례주일·재의 수요일·성령강림을 **연도당 한 번만** 계산한다.
 * @param {number} y
 * @returns {YearAnchors}
 */
function yearAnchors(y) {
  const hit = anchorCache.get(y);
  if (hit) return hit;
  const easter = easterDate(y);
  /** @type {YearAnchors} */
  const a = {
    year: y,
    easter,
    advent1: advent1Date(y),
    baptism: baptismDate(y),
    ash: shift(easter, -46),
    pentecost: shift(easter, 49),
  };
  anchorCache.set(y, a);
  return a;
}

// ── §4.5 절기 스팬 ──

/**
 * 절기 스팬을 **먼저 확정**하고 남는 자리가 연중이다. 도메인 다섯 — `epiphany` 는
 * 없다(ADR-036 §4 개정). 주의 세례 주일은 **연중시기의 첫날**이라 성탄절기는 그
 * 전날 끝난다(§4.5 · 미결10 해소 2026-09-01).
 * @param {string} dateStr
 * @returns {"advent"|"christmas"|"ordinary"|"lent"|"easter"|null}
 */
function seasonOf(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return null;
  const a = yearAnchors(p.y);
  // 전년 12.25 에 시작한 성탄절기 — 세례 **전날**까지.
  if (dateStr < a.baptism) return "christmas";
  if (dateStr >= a.ash && dateStr < a.easter) return "lent";
  if (dateStr >= a.easter && dateStr <= a.pentecost) return "easter";
  if (dateStr >= a.advent1 && dateStr <= toKey(p.y, 12, 24)) return "advent";
  if (dateStr >= toKey(p.y, 12, 25)) return "christmas";
  return "ordinary";
}

// ── §4.7 주기 산정 ──

/**
 * 주일 A/B/C — 대림 시작 기준 3년 주기. 2026 = 가해(사용자 확정 2026-08-29)에서
 * 전체가 결정된다: 전례년 `N % 3` 이 1 → A · 2 → B · 0 → C.
 * @param {string} dateStr
 * @returns {"A"|"B"|"C"|null}
 */
function sundayCycle(dateStr) {
  const n = liturgicalYearOf(dateStr);
  if (!Number.isFinite(n)) return null;
  const r = n % 3;
  return r === 1 ? "A" : r === 2 ? "B" : "C";
}

/**
 * 평일 I/II — **홀·짝 달력년** 2년 주기(ADR-036 §2: 홀수해 I · 짝수해 II). 주일 주기와
 * 기준이 달라 12월 대림 이후 구간에서 어긋나는데 그것이 의도된 동작이다(§4.7).
 * 연중 평일에만 값이 있고 그 밖은 null.
 * @param {string} dateStr
 * @returns {"I"|"II"|null}
 */
function weekdayCycle(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return null;
  if (seasonOf(dateStr) !== "ordinary") return null;
  if (dayOfWeek(dateStr) === 0) return null;   // 주일은 A/B/C 축이다
  return p.y % 2 === 1 ? "I" : "II";
}

// ── §4.3 규칙 평가 ──

/** 사계재 앵커 다음의 수·금·토 사흘. 「다음」은 **엄격히 이후**다(§4.3). */
function emberDaysAfter(/** @type {string} */ anchorKey) {
  const w = dayOfWeek(anchorKey);
  if (w < 0) return [];
  const toWed = ((3 - w + 6) % 7) + 1;         // 앵커가 수요일이면 다음 주 수요일
  const wed = addDays(anchorKey, toWed);
  if (wed === null) return [];
  return [wed, addDays(wed, 2), addDays(wed, 3)].filter((d) => d !== null);
}

/**
 * 데이터의 `rule` 은 빌드 시 이미 구조화돼 있다(ADR-036 개정①) — 엔진은 문법을 다시
 * 파싱하지 않고 `rule.kind` 로만 분기한다. `rule` 이 null 이거나 모르는 kind 면
 * **건너뛴다**(빈 배열, throw 아님 — §2 설계 원칙).
 * @param {{kind?: string, days?: number, month?: number, day?: number, nth?: number, anchor?: any} | null | undefined} rule
 * @param {number} y
 * @returns {string[]} 그 해의 날짜들. 규칙 하나가 날짜 셋을 낳는 것은 `ember_wfs` 뿐이다.
 */
function evalRule(rule, y) {
  if (!rule || typeof rule.kind !== "string") return [];
  const a = yearAnchors(y);
  const one = (/** @type {string | null} */ v) => (v === null || v === undefined ? [] : [v]);
  switch (rule.kind) {
    case "easter_offset":
      return typeof rule.days === "number" ? one(addDays(a.easter, rule.days)) : [];
    case "advent1_offset":
      return typeof rule.days === "number" ? one(addDays(a.advent1, rule.days)) : [];
    case "nth_sunday":
      return typeof rule.month === "number" && typeof rule.nth === "number"
        ? one(nthSunday(y, rule.month, rule.nth)) : [];
    case "first_sunday_after":
      return typeof rule.month === "number" && typeof rule.day === "number"
        ? one(firstSundayAfter(toKey(y, rule.month, rule.day))) : [];
    case "nearest_sunday":
      return typeof rule.month === "number" && typeof rule.day === "number"
        ? one(nearestSunday(toKey(y, rule.month, rule.day))) : [];
    case "last_sunday_before":
      return typeof rule.month === "number" && typeof rule.day === "number"
        ? one(lastSundayBefore(toKey(y, rule.month, rule.day))) : [];
    case "ember_wfs": {
      const anc = rule.anchor;
      if (!anc || typeof anc !== "object") return [];
      if (anc.kind === "easter_offset" && typeof anc.days === "number") {
        const k = addDays(a.easter, anc.days);
        return k === null ? [] : emberDaysAfter(k);
      }
      if (anc.kind === "date" && typeof anc.month === "number" && typeof anc.day === "number") {
        return emberDaysAfter(toKey(y, anc.month, anc.day));
      }
      return [];
    }
    default:
      return [];   // 모르는 kind 는 조용히 건너뛴다
  }
}

// ── §4.6 연중 주차 ──

/** "MM-DD" → **비윤년 기준** 연중 일수. 표의 구간은 2월이 28일일 때 맞아떨어진다. */
function nonLeapDoy(/** @type {string} */ mmdd) {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const m = parseInt(mmdd.slice(0, 2), 10);
  const d = parseInt(mmdd.slice(3, 5), 10);
  if (!(m >= 1 && m <= 12) || !(d >= 1)) return -1;
  return cum[m - 1] + d;
}

/**
 * `ordinal-weeks.json` 의 `weeks[]` 를 **`doy` 인덱스와 `date` 인덱스로 분리** 구축한다
 * (앵커별로 비교 방식이 다르다 — §5.4 권장 인덱스 4).
 * @param {{weeks?: Array<{week: number, windows?: Array<{from: string, to: string, anchor: string}>}>} | null} table
 * @returns {{doy: Array<{week: number, from: number, to: number}>, date: Array<{week: number, from: string, to: string}>}}
 */
function buildOrdinalIndex(table) {
  /** @type {{doy: Array<{week: number, from: number, to: number}>, date: Array<{week: number, from: string, to: string}>}} */
  const idx = { doy: [], date: [] };
  const weeks = table && Array.isArray(table.weeks) ? table.weeks : [];
  for (const w of weeks) {
    if (typeof w.week !== "number") continue;               // 주차 없는 행은 건너뛴다 — 없으면
    for (const win of (w.windows || [])) {                  // ordinalWeekOf 가 undefined 를 낸다
      if (typeof win.from !== "string" || typeof win.to !== "string") continue;
      if (win.anchor === "doy") {
        const from = nonLeapDoy(win.from), to = nonLeapDoy(win.to);
        if (from < 0 || to < 0) continue;
        idx.doy.push({ week: w.week, from, to });
      } else if (win.anchor === "date") {
        idx.date.push({ week: w.week, from: win.from, to: win.to });
      }
    }
  }
  return idx;
}

/**
 * 연중 주차. **평일은 자기 날짜로 찾지 않고 그 주의 주일로 조회**한다(§4.6).
 * 공현 후(재의 수요일 전)는 `doy` 앵커 — 날짜는 2/29 를 세고 표는 세지 않으므로
 * 윤년에 3월이 한 칸 밀린다(2052-03-03 = 9주). 성령강림 후는 `date` 앵커.
 * **연중 스팬 밖에서는 표를 보지 않는다.**
 * @param {string} dateStr
 * @param {ReturnType<typeof buildOrdinalIndex>} index
 * @returns {number | null}
 */
function ordinalWeekOf(dateStr, index) {
  if (!index || !Array.isArray(index.doy) || !Array.isArray(index.date)) return null;  // 원시 표를 받으면
  if (seasonOf(dateStr) !== "ordinary") return null;
  const sunday = sundayOfWeek(dateStr);
  if (sunday === null) return null;
  // **어느 인덱스를 볼지는 창 자신의 `anchor` 가 정한다** — 계절 앵커로 다시 유도하면
  // 같은 사실의 출처가 둘이 되고, 표가 재의 수요일 뒤에 `doy` 창을 갖게 되는 순간 그
  // 창이 영영 안 잡힌다. 실측으로 두 묶음은 겹치지 않는다(doy 01-07~03-07 · date
  // 05-08~11-26) — 그래서 둘 다 보고 **하나만** 맞을 때 그 주차를 낸다.
  const doy = dayOfYear(sunday);
  const mmdd = sunday.slice(5);
  /** @type {number[]} */
  const hits = [];
  for (const w of index.doy) if (doy >= w.from && doy <= w.to) hits.push(w.week);
  for (const w of index.date) if (mmdd >= w.from && mmdd <= w.to) hits.push(w.week);
  if (hits.length !== 1) return null;   // 0 = 표에 없는 자리 · 2 이상 = 표 결함(§2 — 조용히 고르지 않는다)
  return hits[0];
}

// ── §4.8 음력 ──

/**
 * KASI 표 조회. 천문 계산을 내장하지 않는다 — 한국 음력은 기준 자오선이 달라
 * 드물게 하루 어긋난다(ADR-036 §9). **범위 밖 연도는 빈 객체**(throw 아님).
 * 표의 값은 `MM-DD` 하이픈이라 `MM.DD` 계열과 비교하려면 정규화가 필요하다(§5.2).
 * @param {{years?: Record<string, Record<string, string>>} | null} table
 * @param {number} y
 * @returns {Record<string, string>} 예 {"1-1": "2026-02-17", "8-15": "2026-09-25"}
 */
function lunarDatesOf(table, y) {
  const years = table && table.years ? table.years : null;
  const row = years ? years[String(y)] : null;
  if (!row) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of Object.keys(row)) {
    const raw = row[key];
    if (typeof raw !== "string") continue;                  // 못 읽는 행은 건너뛴다(§2)
    const m = raw.replace(".", "-").match(/^(\d{2})-(\d{2})$/);
    if (!m) continue;                                       // "2-17" · "2026-02-17" 같은 표기 이탈
    const key2 = toKey(y, parseInt(m[1], 10), parseInt(m[2], 10));
    if (parseDate(key2) === null) continue;                 // 02-30 같은 값
    out[key] = key2;
  }
  return out;
}

// ── §4.10 기간 축 ──

/**
 * 절기(§4.5)와 **독립된 축**. 앵커만으로 순수 계산하고 데이터가 필요 없다.
 * 스팬마다 **그 달력년으로 자른** `[from, to]` 구간의 배열을 낸다 — 부활절 기준
 * 스팬은 한 해 안에 들지만 **성탄 기간 둘은 해를 넘어** 한 해에 두 조각이 된다.
 * @param {number} y
 * @returns {Record<string, Span[]>}
 */
function spansOf(y) {
  const hit = spansCache.get(y);
  if (hit) return hit;
  const a = yearAnchors(y);
  const off = (/** @type {number} */ nn) => shift(a.easter, nn);
  const dec25 = toKey(y, 12, 25);
  const dec31 = toKey(y, 12, 31);
  const jan1 = toKey(y, 1, 1);
  /** @type {Record<string, Span[]>} */
  const table = {
    holyWeek: [{ from: off(-7), to: off(-1) }],
    easterOctave: [{ from: off(0), to: off(7) }],
    transferGuard: [{ from: off(-7), to: off(7) }],
    // 승천일(E+39)은 **제외** — 전사 「승천일 이후 성령강림주일 전까지」(§4.10).
    ascensionToPentecost: [{ from: off(40), to: off(48) }],
    dec17to24: [{ from: toKey(y, 12, 17), to: toKey(y, 12, 24) }],
    // 조각 ① 은 전년 12.25 에 시작한 기간의 올해 몫, ② 는 올해 시작분.
    christmasToBaptism: [{ from: jan1, to: shift(a.baptism, -1) }, { from: dec25, to: dec31 }],
    christmasOctave: [{ from: jan1, to: jan1 }, { from: dec25, to: dec31 }],
  };
  spansCache.set(y, table);
  return table;
}

/**
 * 구간 중 하나에 들면 참. 소비자는 범위를 직접 비교하지 않고 이것으로 묻는다 —
 * 성주간·부활 8일 보호를 §6.3 ① · §6.4 · §6.5 셋이 각자 비교하던 것을 없앤다.
 *
 * **표를 인자로 받지 않는다.** 스팬은 달력년으로 잘려 있으므로(§4.10) 어느 해의 표인지가
 * 답을 바꾼다 — 호출부가 루프 밖에서 `spansOf(Y)` 를 뽑아 들고 다니면 이웃 해의 날짜에
 * 조용히 틀린 답이 나온다(성탄 기간의 1월 조각이 통째로 거짓이 된다). 연도는 **날짜가**
 * 정하고, 반복 비용은 `spansCache` 가 흡수한다.
 *
 * **모르는 이름은 throw 한다.** 스팬 이름은 데이터가 아니라 **코드**라 오타는 결손이
 * 아니라 결함이다 — §2 의 「빈 결과 + 계속 진행」은 데이터 결손에 대한 규칙이고, 여기서
 * 조용히 `false` 를 내면 가드가 꺼진 채로 돈다(§4.10 이 없애려던 바로 그 어긋남이다).
 * @param {string} dateStr @param {string} name
 * @returns {boolean}
 */
function inSpan(dateStr, name) {
  const p = parseDate(dateStr);
  if (!p) return false;
  const table = spansOf(p.y);
  if (!Object.prototype.hasOwnProperty.call(table, name)) {
    throw new Error(`inSpan: unknown span "${name}" — §4.10 의 이름 목록을 확인할 것`);
  }
  for (const sp of table[name]) if (dateStr >= sp.from && dateStr <= sp.to) return true;
  return false;
}
// ── END LITURGICAL_CORE ──

export {
  parseDate, toKey, addDays, dayOfWeek, dayOfYear,
  nearestSunday, firstSundayAfter, lastSundayBefore, nthSunday, sundayOfWeek,
  easterDate, advent1Date, baptismDate, liturgicalYearOf, yearAnchors,
  seasonOf, sundayCycle, weekdayCycle, evalRule,
  buildOrdinalIndex, ordinalWeekOf, lunarDatesOf, spansOf, inSpan,
};
