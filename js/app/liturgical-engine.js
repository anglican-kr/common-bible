// @ts-check
"use strict";

// Liturgical calendar engine (ADR-037 §6). Leaf module: no imports, no DOM.
// Two-phase API — callers await preloadCalendar()/preloadLectionary() once,
// then the resolve/find functions are synchronous and pure over the loaded
// tables. See docs/design/liturgical-engine.md §3.4 for why.
//
// Three marker blocks, each sliced by the vm test harness (design §3.3):
//   LITURGICAL_CORE    — A1-a: date arithmetic, computus, rule evaluation, season
//                        spans, ordinal weeks, cycles, lunar lookup, period axis.
//   LITURGICAL_LOOKUP  — A1-b: table indexes, grid coordinate, candidate assembly,
//                        fallback matching, readings/collects lookup. B1: precedence
//                        ladder, official + reclassification, colour, fast days. Pure —
//                        every function takes the index it reads as an argument.
//   LITURGICAL_PRELOAD — fetch + promise-cached preload and the public wrappers
//                        that read module state. The transfer pass (design §6.5) is
//                        the second half of PR 3 — until then the pass stays empty.
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

/** @typedef {import("../types").LiturgicalCoord} LiturgicalCoord */
/** @typedef {import("../types").LiturgicalSeason} LiturgicalSeason */
/** @typedef {import("../types").LiturgicalColor} LiturgicalColor */
/** @typedef {import("../types").LiturgicalColorAlt} LiturgicalColorAlt */
/** @typedef {import("../types").LiturgicalFast} LiturgicalFast */
/** @typedef {import("../types").WeekdayCode} WeekdayCode */
/** @typedef {import("../types").Observance} Observance */
/** @typedef {import("../types").Candidate} Candidate */
/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").LiturgicalPeriod} LiturgicalPeriod */
/** @typedef {import("../types").ReadingSlot} ReadingSlot */
/** @typedef {import("../types").ReadingGroup} ReadingGroup */
/** @typedef {import("../types").CollectOption} CollectOption */
/** @typedef {import("../types").CandidateCollects} CandidateCollects */

/**
 * 본문 레코드 — eucharist-readings · eucharist-collects 가 공유하는 좌표 필드와 각자의 본문 필드.
 * `weekday` · `year` 는 `null | 코드 | 코드 배열` 3형이다(설계서 §5.2).
 * @typedef {{
 *   id: string | number, kind?: string, season?: string | null, week?: number | null,
 *   type?: string | null, weekday?: string | string[] | null, year?: string | string[] | null,
 *   date?: string | null, lunar?: string | null, name?: string | null, aliases?: string[] | null,
 *   title?: string, reading_track?: number | null, set_no?: number, set_total?: number,
 *   set_note?: string | null, readings?: ReadingSlot[],
 *   collect_no?: number, collect_total?: number, text?: string, ending?: string | null,
 * }} TextRecord
 */

/**
 * 본문 표 하나의 인덱스(설계서 §5.4 권장 인덱스 3). `byCoord` 에는 이름 · 날짜 · 음력이 모두 없는
 * 격자 레코드만, `named` 에는 이름은 있고 날짜 · 음력이 없는 레코드만 오른다.
 * @typedef {{
 *   byDate: Map<string, TextRecord[]>, byLunar: Map<string, TextRecord[]>,
 *   byName: Map<string, TextRecord[]>, byCoord: Map<string, TextRecord[]>, named: TextRecord[],
 * }} TextIndex
 */

/**
 * `commons.json` 의 분류 하나 — 본기도 하나(`{name}` 자리표시)와 독서 세트 N 개.
 * @typedef {{
 *   label?: string, color?: string | null,
 *   collect?: {text?: string, ending?: string | null} | null,
 *   readings?: Array<{set: number, slots: ReadingSlot[]}>,
 * }} CommonClass
 */

/**
 * @typedef {{
 *   readings: TextIndex, collects: TextIndex,
 *   commons: Record<string, CommonClass>, canticles: Record<string, unknown>,
 * }} LectionaryIndex
 */

/**
 * 캘린더 묶음의 인덱스(설계서 §5.4 권장 인덱스 1 · 2 · 4). `movable` 은 규칙 파생 관측일의
 * 연도 메모다 — 표에 의존하므로 `anchorCache` 처럼 순수 파생값이 아니라 인덱스에 붙는다.
 * @typedef {{
 *   sanctoralByDate: Map<string, Observance[]>, sanctoralByLunar: Map<string, Observance[]>,
 *   temporal: Observance[], periods: Array<{period: LiturgicalPeriod, from: string, to: string}>,
 *   ordinal: ReturnType<typeof buildOrdinalIndex>,
 *   kasi: {years?: Record<string, Record<string, string>>} | null,
 *   movable: Map<number, Map<string, Observance[]>>,
 * }} CalendarIndex
 */

/**
 * 이동 패스(설계서 §6.5) — 한 해의 도착 · 출발 · 선택 봉헌 색인. 네 필드를 **모두** 갖는다.
 * @typedef {{
 *   arrivals: Map<string, Candidate[]>, departures: Map<string, Candidate[]>,
 *   optionals: Map<string, Candidate[]>, defects: string[],
 * }} TransferPass
 */

// 연도 캐시(§4.9) — 순수 파생값이라 무효화가 필요 없다. 블록 밖에 두어 테스트가
// prelude 로 재선언한다(ADR-013 하네스 제약, 설계서 §3.3).
/** @type {Map<number, YearAnchors>} */
const anchorCache = new Map();
/** @type {Map<number, Record<string, Span[]>>} */
const spansCache = new Map();
// 이동 패스 캐시(§4.9) — **완전한 패스만** 들어간다. PR 2 의 완전한 패스는 빈 패스다(§6.5).
/** @type {Map<number, TransferPass>} */
const transferCache = new Map();

// 프리로드 상태(§3.4) — 값과 **promise** 를 따로 둔다. promise 를 캐시하므로 동시 진입이
// fetch 를 한 번만 내고, 실패한 promise 는 비워 다음 진입이 다시 시도한다.
const DATA_DIR = "/data";   // data-fetch.js does not export it
/** @type {CalendarIndex | null} */
let calendarIndex = null;
/** @type {Promise<CalendarIndex> | null} */
let calendarPromise = null;
/** @type {LectionaryIndex | null} */
let lectionaryIndex = null;
/** @type {Promise<LectionaryIndex> | null} */
let lectionaryPromise = null;

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
 * 날짜 문자열 덧셈. 입력이 틀리면 null — **델타가 정수가 아니어도** null 이다. `Date` 는
 * 0.5 를 잘라 같은 날을 내고 NaN 은 `0NaN-NaN-NaN` 을, 문자열 "3" 은 연결돼 엉뚱한 날을
 * 낸다. 규칙 오프셋이 JSON 에서 이리로 흐르므로 여기서 막아야 §2 의 「빈 결과」가 된다.
 * @param {string} s @param {number} n
 * @returns {string | null}
 */
function addDays(s, n) {
  const p = parseDate(s);
  if (!p || !Number.isInteger(n)) return null;
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
  // 서수 1.5 는 `2026-11-4.5` 같은 깨진 키를 만든다 — 연·월·서수 모두 정수여야 한다.
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return null;
  if (!Number.isInteger(n) || n < 1) return null;
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
 * 없다(ADR-036 §4). 주의 세례 주일은 **연중시기의 첫날**이라 성탄절기는 그
 * 전날 끝난다(§4.5).
 * @param {string} dateStr
 * @returns {"advent"|"christmas"|"ordinary"|"lent"|"easter"|null}
 */
function seasonOf(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return null;
  const a = yearAnchors(p.y);
  // 전년 12.25 에 시작한 성탄절기 — 세례 **전날**까지(→ R-4.5-baptism-ordinary-1).
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
 * 데이터의 `rule` 은 빌드 시 이미 구조화돼 있다(ADR-036 §5) — 엔진은 문법을 다시
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
  // JSON 의 숫자는 NaN·소수일 수 있다 — `days: 0.5` 는 Date 가 잘라 부활절 당일을, NaN 은
  // `0NaN-NaN-NaN` 을 냈다. §2 의 결손은 빈 결과지 그럴듯한 오답이 아니다: 정수만 받는다.
  /** @type {(v: unknown) => v is number} */
  const int = (v) => Number.isInteger(v);
  switch (rule.kind) {
    case "easter_offset":
      return int(rule.days) ? one(addDays(a.easter, rule.days)) : [];
    case "advent1_offset":
      return int(rule.days) ? one(addDays(a.advent1, rule.days)) : [];
    case "nth_sunday":
      return int(rule.month) && int(rule.nth)
        ? one(nthSunday(y, rule.month, rule.nth)) : [];
    case "first_sunday_after":
      return int(rule.month) && int(rule.day)
        ? one(firstSundayAfter(toKey(y, rule.month, rule.day))) : [];
    case "nearest_sunday":
      return int(rule.month) && int(rule.day)
        ? one(nearestSunday(toKey(y, rule.month, rule.day))) : [];
    case "last_sunday_before":
      return int(rule.month) && int(rule.day)
        ? one(lastSundayBefore(toKey(y, rule.month, rule.day))) : [];
    case "ember_wfs": {
      const anc = rule.anchor;
      if (!anc || typeof anc !== "object") return [];
      if (anc.kind === "easter_offset" && int(anc.days)) {
        const k = addDays(a.easter, anc.days);
        return k === null ? [] : emberDaysAfter(k);
      }
      if (anc.kind === "date" && int(anc.month) && int(anc.day)) {
        return emberDaysAfter(toKey(y, anc.month, anc.day));
      }
      return [];
    }
    default:
      return [];   // 모르는 kind 는 조용히 건너뛴다
  }
}

// ── §4.6 연중 주차 ──

/** 달 길이(비윤년). 표의 `MM-DD` 가 실재하는 날인지 검사할 때 쓴다. */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * 연중 주차의 계약 범위 1~34(§4.6 「34주 · 구간 38개」 · ADR-036 §11 왕이신 그리스도 = 연중34주).
 * 표의 `_meta.weeks` 와 같은 값이지만 계약은 코드가 정한다 — 표가 0 · 2.5 · 35 를 실으면
 * 결함이지 주차가 아니다.
 */
const ORDINAL_WEEKS = 34;

/**
 * 표의 "MM-DD" → {m, d}. 형식이 틀리거나 없는 날이면 null. `01-32` 를 32 로 읽으면 2월
 * 1일 주일이 **그럴듯한 오답**을 낸다 — §2 는 결손을 「빈 결과」로 흡수하라는 것이지
 * 오답으로 흡수하라는 것이 아니다. 2/29 는 `date` 앵커에서만 실재한다(`doy` 표는
 * 비윤년을 전제하므로 거기서는 없는 날이다).
 * @param {unknown} s @param {boolean} leapOk
 * @returns {{m: number, d: number} | null}
 */
function parseMmdd(s, leapOk) {
  const m = typeof s === "string" ? s.match(/^(\d{2})-(\d{2})$/) : null;
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const d = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const max = MONTH_DAYS[mo - 1] + (leapOk && mo === 2 ? 1 : 0);
  return d >= 1 && d <= max ? { m: mo, d } : null;
}

/** "MM-DD" → **비윤년 기준** 연중 일수. 표의 구간은 2월이 28일일 때 맞아떨어진다. 없는 날은 -1. */
function nonLeapDoy(/** @type {string} */ mmdd) {
  const p = parseMmdd(mmdd, false);
  if (!p) return -1;
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return cum[p.m - 1] + p.d;
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
  // 행·창의 **모양**부터 검사한다 — `windows: 5` 같은 값은 `for…of` 가 throw 하고, 주차
  // 없는 행은 ordinalWeekOf 가 undefined 를 낸다. 결손은 건너뛴다(§2) — 오답을 내지 않는다.
  for (const w of weeks) {
    if (!w || typeof w !== "object") continue;
    if (!Number.isInteger(w.week) || w.week < 1 || w.week > ORDINAL_WEEKS) continue;   // 0 · 2.5 · 35 · NaN
    if (!Array.isArray(w.windows)) continue;
    for (const win of w.windows) {
      if (!win || typeof win !== "object") continue;
      if (win.anchor === "doy") {
        const from = nonLeapDoy(win.from), to = nonLeapDoy(win.to);
        if (from < 0 || to < 0 || from > to) continue;       // 없는 날 · 뒤집힌 창
        idx.doy.push({ week: w.week, from, to });
      } else if (win.anchor === "date") {
        if (!parseMmdd(win.from, true) || !parseMmdd(win.to, true) || win.from > win.to) continue;
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
 * @returns {number | null} 1~34
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

// ── BEGIN LITURGICAL_LOOKUP ──
// 표 인덱스 · 격자 좌표 · 후보 조립 · 폴백 매칭 · 독서/본기도 조회. **순수하다** — 읽는 인덱스를
// 전부 인자로 받는다(설계서 §3.3). 모듈 상태는 `transferCache` 하나만 읽고, 그것도 블록 밖에 둬
// 테스트가 prelude 로 재선언한다. LITURGICAL_CORE 를 먼저 실행한 컨텍스트에서 돈다.

/** 예약 접두사 — 정의 표 · 본문 표 id 에 나타나지 않는다(§5.5 · §5.6 · §6.5). */
const GRID_PREFIX = "grid:";
const GUARD_PREFIX = "guard:";
const COMMON_PREFIX = "common:";

/** 요일 번호(0 = 일) → 코드. 일요일 코드는 없다 — 주일은 `type: "sunday"` 다(§5.1). */
/** @type {Array<WeekdayCode | null>} */
const WEEKDAY_CODES = [null, "mon", "tue", "wed", "thu", "fri", "sat"];

/** 격자 관측일의 표시명 재료. 표시는 뷰의 몫이고 이 이름은 기본값이다. */
const SEASON_LABEL = { advent: "대림", christmas: "성탄", ordinary: "연중", lent: "사순", easter: "부활" };
const WEEKDAY_LABEL = { mon: "월요일", tue: "화요일", wed: "수요일", thu: "목요일", fri: "금요일", sat: "토요일" };

/**
 * **고유명 평일** — 데이터가 좌표가 아니라 이름으로만 가르는 앵커 파생 평일(ADR-036 §2 「고유명
 * 평일은 제외」). 재의 수요일 주간과 성주간은 좌표가 똑같이 `(lent, null, weekday, 요일)` 이라
 * 좌표로는 「재의 수요일 후 토요일」과 「성 토요일」을 가를 수 없다 — 그래서 그날의 격자 관측일이
 * 이 이름을 달고, 본문은 그 이름으로 찾는다(§5.6 격자 경로 ②). 키는 부활절 기준 오프셋.
 */
/** @type {Record<string, string>} */
const PROPER_WEEKDAY_NAMES = {
  "-45": "재의 수요일 후 목요일", "-44": "재의 수요일 후 금요일", "-43": "재의 수요일 후 토요일",
  "-6": "성주간 월요일", "-5": "성주간 화요일", "-4": "성주간 수요일",
};

// ── §5.2 표기 정규화 · 공용 ──

/**
 * 월·일 표기 → 내부 표준 `"MM.DD"`. 점 · 하이픈과 0 채움 유무를 다 받는다(§5.2 — 데이터에 세 표기가
 * 섞여 있다). 형식 이탈 · 없는 날(`02.30`)은 null — 그 레코드는 날짜 인덱스에 오르지 않는다(§2).
 * 02.29 는 실재하는 날로 받는다(윤년에만 오는 날짜 키).
 * @param {unknown} s
 * @returns {string | null}
 */
function normMonthDay(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2})[.-](\d{1,2})$/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const d = parseInt(m[2], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > MONTH_DAYS[mo - 1] + (mo === 2 ? 1 : 0)) return null;
  return String(mo).padStart(2, "0") + "." + String(d).padStart(2, "0");
}

/** "YYYY-MM-DD" → "MM.DD". 유효한 키에만 쓴다. */
function monthDayOf(/** @type {string} */ dateStr) {
  return dateStr.slice(5, 7) + "." + dateStr.slice(8, 10);
}

/** 두 유효한 날짜 키 사이의 일수(to − from). */
function dayDiff(/** @type {string} */ from, /** @type {string} */ to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return NaN;
  return Math.round((new Date(b.y, b.m - 1, b.d).getTime() - new Date(a.y, a.m - 1, a.d).getTime()) / 86400000);
}

/**
 * 래퍼 객체에서 행 배열을 꺼낸다(§5.2 — 모든 파일이 객체 래퍼다). 래퍼나 배열이 없으면 빈 배열,
 * 객체가 아닌 행은 건너뛴다 — 모양 이탈은 결손이다(§2).
 * @param {any} table @param {string} key
 * @returns {any[]}
 */
function rowsOf(table, key) {
  const v = table && typeof table === "object" ? table[key] : null;
  return Array.isArray(v) ? v.filter((r) => r && typeof r === "object") : [];
}

/**
 * @template T
 * @param {Map<string, T[]>} map @param {string} key @param {T} value
 */
function pushTo(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

/**
 * 정렬 키 비교 — **문자열은 사전순, 정수는 수치순**이고 둘을 섞지 않는다(§5.2 — readings id 는
 * 문자열, collects id 는 정수). 섞이면 수가 앞이다(결정성만 지킨다).
 * @param {string | number} a @param {string | number} b
 */
function compareIds(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 이름 · 별칭 목록. */
function namesOfRow(/** @type {{name?: string | null, aliases?: string[] | null}} */ row) {
  /** @type {string[]} */
  const out = [];
  if (typeof row.name === "string" && row.name !== "") out.push(row.name);
  if (Array.isArray(row.aliases)) for (const a of row.aliases) if (typeof a === "string" && a !== "") out.push(a);
  return out;
}

/** 두 행의 이름 · 별칭이 **정확히** 하나라도 겹치는가(미결12 잠정 — 느슨한 일치는 쓰지 않는다). */
function namesMeet(/** @type {any} */ a, /** @type {any} */ b) {
  const bs = namesOfRow(b);
  return namesOfRow(a).some((n) => bs.includes(n));
}

// ── §5.4 캘린더 인덱스 ──

/**
 * 캘린더 묶음 다섯 표 → 조회 인덱스(§5.4 권장 인덱스 1 · 2 · 4). 프리로드 때 한 번 만든다.
 * 표의 행은 **복사하지 않고 그대로** 관측일로 쓴다 — `Observance` 는 정의 표의 행이다(§1.3).
 * 날짜 · 음력 인덱스는 **1:N** 이다(같은 날짜에 성인이 둘 이상 — §5.2).
 * @param {{sanctoral?: any, temporal?: any, periods?: any, ordinalWeeks?: any, kasi?: any} | null} tables
 * @returns {CalendarIndex}
 */
function buildCalendarIndex(tables) {
  const t = tables || {};
  /** @type {Map<string, Observance[]>} */
  const sanctoralByDate = new Map();
  /** @type {Map<string, Observance[]>} */
  const sanctoralByLunar = new Map();
  for (const row of rowsOf(t.sanctoral, "entries")) {
    if (typeof row.id !== "string") continue;
    const md = normMonthDay(row.date);
    if (md) pushTo(sanctoralByDate, md, row);
    if (typeof row.lunar === "string" && row.lunar !== "") pushTo(sanctoralByLunar, row.lunar, row);
  }
  /** @type {Array<{period: LiturgicalPeriod, from: string, to: string}>} */
  const periods = [];
  for (const row of rowsOf(t.periods, "entries")) {
    const from = normMonthDay(row.from);
    const to = normMonthDay(row.to);
    if (typeof row.id === "string" && from && to) periods.push({ period: row, from, to });
  }
  periods.sort((a, b) => compareIds(a.period.id, b.period.id));
  return {
    sanctoralByDate,
    sanctoralByLunar,
    temporal: rowsOf(t.temporal, "entries").filter((r) => typeof r.id === "string"),
    periods,
    ordinal: buildOrdinalIndex(t.ordinalWeeks || null),
    kasi: t.kasi && typeof t.kasi === "object" ? t.kasi : null,
    movable: new Map(),
  };
}

/**
 * 규칙 파생 관측일(§5.5 출처 ④) — 그해 temporal 규칙을 **한 번** 평가해 날짜 → 행 색인으로 둔다.
 * 규칙 일곱 종류는 전부 자기 달력년 안에 떨어진다(사계재 12.13 앵커 → 늦어도 12.23, 1.6 이후 첫
 * 주일 → 늦어도 1.13) — 해를 넘기는 결과는 그 해의 날짜 조회가 닿지 않으므로 실데이터 테스트가
 * 1900~2100 에서 단언한다. 같은 날짜에 두 행(성 토요일 · 부활밤 — easter −1)이면 둘 다 오른다(1:N).
 * @param {CalendarIndex} index @param {number} y
 * @returns {Map<string, Observance[]>}
 */
function movableOf(index, y) {
  const hit = index.movable.get(y);
  if (hit) return hit;
  /** @type {Map<string, Observance[]>} */
  const out = new Map();
  for (const row of index.temporal) {
    for (const d of new Set(evalRule(row.rule, y))) pushTo(out, d, row);
  }
  index.movable.set(y, out);
  return out;
}

// ── §5.1 · §5.5 격자 좌표와 격자 관측일 ──

/**
 * 절기 주차 — 데이터의 격자 레코드가 쓰는 번호와 같다. 연중은 표(§4.6), 절기는 앵커에서 센다:
 * 대림 1~4 · 사순 1~5(재의 수요일 주간과 성지주일 ~ 성 토요일은 null — 데이터가 이름으로 가르는
 * 날들이다) · 부활 1~7(부활 8일의 평일이 1주, 부활 2주일 = E+7; 성령강림은 null) · 성탄 주일
 * 1 · 2(12.26 ~ 1.1 이 1, 1.2 이후가 2 — 12.25 가 주일이면 null) · 성탄 평일은 null.
 * @param {string} dateStr @param {LiturgicalSeason} season
 * @param {ReturnType<typeof buildOrdinalIndex>} ordinal
 * @returns {number | null}
 */
function seasonWeekOf(dateStr, season, ordinal) {
  if (season === "ordinary") return ordinalWeekOf(dateStr, ordinal);
  const a = yearAnchors(parseInt(dateStr.slice(0, 4), 10));
  const sunday = sundayOfWeek(dateStr);
  if (sunday === null) return null;
  if (season === "advent") return Math.floor(dayDiff(a.advent1, sunday) / 7) + 1;
  if (season === "lent") {
    const first = shift(a.easter, -42);
    if (dateStr >= shift(a.easter, -7) || sunday < first) return null;
    return Math.floor(dayDiff(first, sunday) / 7) + 1;
  }
  if (season === "easter") {
    const n = Math.floor(dayDiff(a.easter, dateStr) / 7) + 1;
    return n <= 7 ? n : null;
  }
  // christmas
  if (dayOfWeek(dateStr) !== 0) return null;
  const md = monthDayOf(dateStr);
  if (md === "12.25") return null;
  return md >= "12.26" || md === "01.01" ? 1 : 2;
}

/**
 * 그 날의 격자 좌표(§5.1). 잘못된 날짜면 null. `year` 는 연중 평일이면 I/II, 그 밖은 A/B/C 다 —
 * 본문을 고를 때는 레코드 코드가 어느 축인지 보고 두 주기를 따로 대조한다(`matchScore`).
 * @param {string} dateStr @param {ReturnType<typeof buildOrdinalIndex>} ordinal
 * @returns {LiturgicalCoord | null}
 */
function coordOf(dateStr, ordinal) {
  if (!parseDate(dateStr)) return null;
  const season = seasonOf(dateStr);
  if (season === null) return null;
  const dow = dayOfWeek(dateStr);
  return {
    season,
    week: seasonWeekOf(dateStr, season, ordinal),
    type: dow === 0 ? "sunday" : "weekday",
    weekday: WEEKDAY_CODES[dow] || null,
    year: weekdayCycle(dateStr) || sundayCycle(dateStr),
  };
}

/**
 * 격자 관측일의 표시명. 고유명 평일(위 표)은 그 이름을 쓰고, 그 밖은 좌표에서 만든다(「연중 3주일」 ·
 * 「사순 2주 화요일」). 성 목 · 금 · 토는 temporal 행이 따로 있으므로 격자는 「성주간 X요일」이다 —
 * temporal 행의 이름을 빌리면 같은 본문이 후보 둘에 붙는다.
 * @param {string} dateStr @param {LiturgicalCoord} coord
 * @returns {string}
 */
function gridName(dateStr, coord) {
  const s = SEASON_LABEL[coord.season];
  if (coord.type === "sunday") return coord.week === null ? s + " 주일" : s + " " + coord.week + "주일";
  const w = coord.weekday ? WEEKDAY_LABEL[coord.weekday] : "";
  const proper = PROPER_WEEKDAY_NAMES[String(dayDiff(yearAnchors(parseInt(dateStr.slice(0, 4), 10)).easter, dateStr))];
  if (proper) return proper;
  if (coord.week === null && inSpan(dateStr, "holyWeek")) return "성주간 " + w;
  return coord.week === null ? s + " " + w : s + " " + coord.week + "주 " + w;
}

/**
 * 절기 기본색(ADR-036 §8). 성주간은 절기(사순)와 달리 전체가 홍이라 기간 축으로 따로 본다.
 * @type {Record<LiturgicalSeason, LiturgicalColor>}
 */
const SEASON_COLOR = { advent: "violet", christmas: "white", ordinary: "green", lent: "violet", easter: "white" };

/**
 * 그 날의 **절기 기본색**과 선택 대체색(§6.4 결정 순서의 첫 단계 — 승자가 덮기 전의 바탕). 성주간
 * (성지주일 ~ 성 토요일)은 전체 홍이다 — 경계는 `spansOf` 의 `holyWeek` 이고 날짜를 따로 비교하지
 * 않는다(§4.10). 대체색은 데이터 `color_alt` 와 같은 뜻 · 같은 3형이다: 대림은 청(대림 3주일은 장미 ·
 * 청 둘 다), 사순 4주일은 장미. 성령강림 · 삼위일체 · 왕이신 그리스도의 색은 그 날의 temporal 행이
 * 승자로 덮는다 — 바탕은 절기만 안다.
 * @param {string} dateStr @param {LiturgicalCoord} coord
 * @returns {{color: LiturgicalColor, alt: import("../types").CodeField<LiturgicalColorAlt>}}
 */
function seasonColorOf(dateStr, coord) {
  if (inSpan(dateStr, "holyWeek")) return { color: "red", alt: null };
  const color = SEASON_COLOR[coord.season];
  if (coord.season === "advent") {
    return { color, alt: coord.type === "sunday" && coord.week === 3 ? ["rose", "blue"] : "blue" };
  }
  if (coord.season === "lent" && coord.type === "sunday" && coord.week === 4) return { color, alt: "rose" };
  return { color, alt: null };
}

/**
 * ① 격자 관측일 — 정의 표에 행이 없어 좌표에서 **합성**한다(§5.5). id 는
 * `grid:<season>-<week|x>-<type>[-<weekday>]`, precedence 는 §6.1 사다리(절기 주일 2 · 연중 주일 5 ·
 * 평일 8). 색은 절기 기본색이다(§6.4 — ADR-036 §8 「격자일 레코드의 color 는 좌표에서 파생한 절기
 * 기본색」). 그날의 색은 이 바탕 위에 승자가 덮는다(`dayColorsOf`).
 * @param {string} dateStr @param {LiturgicalCoord} coord
 * @returns {Observance}
 */
function gridObservance(dateStr, coord) {
  const week = coord.week === null ? "x" : String(coord.week);
  const ordinarySunday = coord.type === "sunday" && coord.season === "ordinary";
  const base = seasonColorOf(dateStr, coord);
  return {
    id: GRID_PREFIX + coord.season + "-" + week + "-" + coord.type + (coord.weekday ? "-" + coord.weekday : ""),
    kind: "temporal",
    name: gridName(dateStr, coord),
    aliases: null,
    season: coord.season,
    week: coord.week,
    type: coord.type,
    rank: coord.type === "weekday" ? "feria" : ordinarySunday ? "sunday" : "privileged_sunday",
    precedence: coord.type === "weekday" ? 8 : ordinarySunday ? 5 : 2,
    color: base.color,
    color_alt: base.alt,
  };
}

// ── §4.9 · §6.5 이동 패스 ──

/**
 * 빈 이동 패스 — 네 필드를 **모두** 갖는다. §5.5 가 `optionals` 까지 읽으므로 둘만 있으면
 * `undefined` 접근이다(§6.5 마지막 단락).
 * @returns {TransferPass}
 */
function EMPTY_PASS() {
  return { arrivals: new Map(), departures: new Map(), optionals: new Map(), defects: [] };
}

/**
 * 연도 `y` 의 이동 패스(§4.9 `transferCache`). 패스는 품계 비교(§6.1 — 아래 `compareCandidates`)를
 * 쓰고, PR 3 의 둘째 GitHub PR 이 채운다 — 그때까지는 언제나 빈 패스이고, 빈 패스가 지금의
 * **완전한** 패스다. 캐시에는 완전한 패스만 들어간다.
 * @param {number} y
 * @returns {TransferPass}
 */
function transfersOf(y) {
  const hit = transferCache.get(y);
  if (hit) return hit;
  const pass = EMPTY_PASS();
  transferCache.set(y, pass);
  return pass;
}

// ── §5.5 resolveDate — 후보 집합 ──

/**
 * 그 날짜에 걸린 `periods` 행(배너용 겹침 표시) — 품계에 참여하지 않으므로 후보가 아니다.
 * 해를 넘기는 기간(`12.25 ~ 01.05` 꼴)도 받는다.
 * @param {CalendarIndex} index @param {string} md "MM.DD"
 * @returns {LiturgicalPeriod[]}
 */
function periodsOn(index, md) {
  /** @type {LiturgicalPeriod[]} */
  const out = [];
  for (const p of index.periods) {
    const inside = p.from <= p.to ? md >= p.from && md <= p.to : md >= p.from || md <= p.to;
    if (inside) out.push(p.period);
  }
  return out;
}

/**
 * 그 날짜의 **고유** 관측일 — §5.5 출처 ② 날짜(성인력) · ③ 음력 · ④ 규칙 파생(① 격자는 따로 합성한다).
 * 같은 행이 두 출처에서 오면 한 번만 낸다. 순서는 뜻이 없다 — 표시 · 승자 순서는 품계가 정한다
 * (`compareCandidates`). 음력 표 범위 밖 연도는 ③ 이 빈다(§2).
 * @param {CalendarIndex} index @param {string} dateStr
 * @returns {Observance[]}
 */
function ownObservancesOn(index, dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10);
  const rows = [
    ...(movableOf(index, y).get(dateStr) || []),
    ...(index.sanctoralByDate.get(monthDayOf(dateStr)) || []),
  ];
  const lunar = lunarDatesOf(index.kasi, y);
  for (const key of Object.keys(lunar)) {
    if (lunar[key] === dateStr) rows.push(...(index.sanctoralByLunar.get(key) || []));
  }
  /** @type {Observance[]} */
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// ── §6.1 · §6.2 품계 사다리 · 승자 · 재분류 (B1) ──

/** 보호 기간의 합성 점유자 id(§6.5 `guard`) — 표에 없고 후보로 내지 않는다. */
const GUARD_ID = GUARD_PREFIX + "easter-octave";

/**
 * 보호 기간(성지주일 ~ 부활 2주일 — `spansOf().transferGuard`, §4.10)의 가상 점유자. 그 안의 날에는
 * 유효 precedence 1 · `transferable: false` 인 합성 후보 하나, 밖의 날에는 빈 배열이다. 순위에만 들어가고
 * 그날의 후보(§5.5 출처 ①~⑤)로는 내지 않는다 — 뷰에 보이지 않는다(→ R-6.3-holy-week-guard).
 * @param {string} dateStr
 * @returns {Candidate[]}
 */
function guardCandidates(dateStr) {
  if (!inSpan(dateStr, "transferGuard")) return [];
  return [{
    observance: {
      id: GUARD_ID, kind: "temporal", name: "성주간·부활 8일", aliases: null,
      rank: null, precedence: 1, transferable: false, transfer_to: null, color: null, color_alt: null,
    },
    status: "proper",
  }];
}

/**
 * 승자 자격이 없는 지향 · 이름 줄 — 사계재(규칙 종류)와 기념일(`rank`). 이름이 아니라 구조 필드로
 * 판별하고, 표(`kind`)를 보지 않는다 — 기념일은 성인력과 temporal 양쪽에 있다(→ R-6.1-ineligible).
 * @param {Observance} obs
 */
function isIneligible(obs) {
  return obs.rank === "commemoration" || !!(obs.rule && obs.rule.kind === "ember_wfs");
}

/**
 * 승자 판정의 **유효 precedence**(→ R-6.1-ladder) — 낮을수록 우선. `precedence: null` 은 정렬 최하위
 * (등급이 없다), 지향 · 이름 줄은 9(등급은 있지만 그날의 독서를 정하지 않는다 — → R-6.1-ineligible),
 * A 특례(`outranks_sunday`)는 1 과 2 사이라 1.5, 그 밖은 데이터 값 그대로다. **`rank` 로 비교하지
 * 않는다** — `major_feast` 가 3 · 4 · 6 으로 갈린다.
 * @param {Observance} obs
 * @returns {number}
 */
function effectivePrecedence(obs) {
  const p = obs.precedence;
  if (typeof p !== "number" || !Number.isFinite(p)) return Number.POSITIVE_INFINITY;
  if (isIneligible(obs)) return 9;
  if (obs.outranks_sunday === true) return 1.5;
  return p;
}

/** 범주 사다리의 칸(→ R-6.2-tie-ladder) — 도착 0 > temporal 규칙일 1 > sanctoral 고정일 2 > 격자 3 > 합성 guard 4. */
function ladderOf(/** @type {Candidate} */ c) {
  const id = c.observance.id;
  if (id.startsWith(GUARD_PREFIX)) return 4;
  if (c.status === "transferred_in") return 0;
  if (id.startsWith(GRID_PREFIX)) return 3;
  return c.observance.kind === "temporal" ? 1 : 2;
}

/**
 * 순위 비교 — 키는 `(유효 precedence, 범주 사다리, 고유 본기도, id)` 이고 앞이 이긴다(→ R-6.2-tie-ladder).
 * 고유 본기도(`has_proper`)가 있는 쪽이 먼저인 키는 같은 범주 안의 동률을 가른다 — prec 7 축일 다섯
 * 쌍 가운데 한쪽만 고유 본기도를 가진 것은 3.01 뿐이라 삼일절이 데이빗 앞에 선다(→ R-6.1-prec7-tie-pairs).
 * 마지막 `id` 사전순은 결정성만 지키는 안전망이다(§5.3 과 같은 안정 정렬).
 * @param {Candidate} a @param {Candidate} b
 * @returns {number}
 */
function compareCandidates(a, b) {
  const pa = effectivePrecedence(a.observance);
  const pb = effectivePrecedence(b.observance);
  if (pa !== pb) return pa < pb ? -1 : 1;   // 뺄셈은 ∞ − ∞ 가 NaN 이다
  const la = ladderOf(a);
  const lb = ladderOf(b);
  if (la !== lb) return la - lb;
  const ha = a.observance.has_proper === true ? 0 : 1;
  const hb = b.observance.has_proper === true ? 0 : 1;
  if (ha !== hb) return ha - hb;
  return compareIds(a.observance.id, b.observance.id);
}

/** 순위대로 정렬한 새 배열 — 입력 순서에 기대지 않는다. */
function rankCandidates(/** @type {Candidate[]} */ cands) {
  return [...cands].sort(compareCandidates);
}

/**
 * 겹침이 해마다 달라지는가(§6.5 「고정일끼리는 충돌이 아니다」) — 격자 · temporal 규칙일 · 음력 명절 ·
 * 도착 · guard 는 참(격자 · guard 도 `kind: "temporal"` 이다), sanctoral 의 고정 `date` 행은 거짓이다.
 * @param {Candidate} c
 */
function variesByYear(c) {
  if (c.status === "transferred_in") return true;
  const o = c.observance;
  if (o.kind === "temporal") return true;
  return typeof o.lunar === "string" && o.lunar !== "";
}

/**
 * `c` 를 **밀어낸 것** — 순위에서 `c` 보다 앞서고, 둘 중 어느 한쪽이라도 겹침이 해마다 달라지는 후보
 * 가운데 **실제 후보를 우선**한 최상위, 실제 후보가 없을 때만 guard 다(§6.5 `displacer`). 앞선 것이 전부
 * 고정일이면 null — 매년 같은 날에 함께 오는 **동시 봉헌**이라 진 쪽도 밀린 것이 아니다(9.29 설립
 * 기념일 · 8.15 광복절 — §6.5 · 미결18). 같은 값의 도착이 고유 후보를 앞서는 것(→ R-6.2-chain-model)과
 * 규칙일이 고정일을 앞서는 것(→ R-6.2-rule-day-stays)은 순위가 이미 담고 있다.
 * @param {Candidate[]} ranked @param {Candidate} c
 * @returns {Candidate | null}
 */
function displacerOf(ranked, c) {
  const i = ranked.indexOf(c);
  const above = ranked.slice(0, Math.max(i, 0)).filter((w) => variesByYear(w) || variesByYear(c));
  return above.find((w) => !w.observance.id.startsWith(GUARD_PREFIX))
    || above.find((w) => w.observance.id.startsWith(GUARD_PREFIX))
    || null;
}

/**
 * 승자와 재분류(§5.5 status 표 · R-6.2-conflict-steps). 그날 남아 있는 후보(`proper` · `transferred_in` —
 * 떠난 것과 선택 봉헌은 순위에 들지 않는다)와 보호 기간의 guard 를 순위대로 세우고, 밀린(`displacerOf`)
 * 고유 후보 가운데
 *  - prec 7 **축일**(`minor_feast` · `transferable` 아님)은 `omitted`(→ R-6.1-prec7-omit — guard 도 밀어낸다:
 *    성주간 · 부활 8일의 prec 7 은 생략, → R-6.3-holy-week-guard),
 *  - `commemorate_only`(추수감사주일)는 `commemorated` — 둘 다 `displacedBy` 를 싣는다.
 * 나머지는 그대로다 — 격자, 지향 · 이름 줄, `precedence: null`, `transferable: false` 인 상위 축일, 동시
 * 봉헌에서 진 쪽, 그리고 옮겨질 축일(좌석은 이동 패스가 정한다 — §6.5).
 *
 * `official` 은 순위에서 처음 오는 **실제** 후보 가운데 승자 자격이 있고(유효 precedence ≤ 8) 재분류 뒤에도
 * `proper` · `transferred_in` 인 것이다 — guard 는 후보가 아니라 승자가 되지 않는다(성주간 평일의 승자는
 * 격자다). 격자가 언제나 있으므로 유효한 날짜에는 승자가 있다.
 * @param {string} dateStr @param {Candidate[]} cands 그날의 후보 전부(출발 · 선택 봉헌 포함)
 * @returns {{candidates: Candidate[], official: Candidate | null}} candidates 는 입력과 같은 순서 — 재분류된 것만 새 객체
 */
function settle(dateStr, cands) {
  const staying = cands.filter((c) => c.status === "proper" || c.status === "transferred_in");
  const ranked = rankCandidates([...staying, ...guardCandidates(dateStr)]);
  /** @type {Map<Candidate, Candidate>} */
  const reclassified = new Map();
  for (const c of staying) {
    if (c.status !== "proper") continue;   // 도착은 다시 밀리지 않는다(→ R-6.2-first-come)
    const o = c.observance;
    const omit = o.rank === "minor_feast" && o.transferable !== true;
    const commemorate = o.transfer_to === "commemorate_only";
    if (!omit && !commemorate) continue;
    const by = displacerOf(ranked, c);
    if (by) reclassified.set(c, { observance: o, status: omit ? "omitted" : "commemorated", displacedBy: by.observance.id });
  }
  const after = (/** @type {Candidate} */ c) => reclassified.get(c) || c;
  const official = ranked.map(after).find((c) =>
    !c.observance.id.startsWith(GUARD_PREFIX)
    && (c.status === "proper" || c.status === "transferred_in")
    && effectivePrecedence(c.observance) <= 8) || null;
  return { candidates: cands.map(after), official };
}

// ── §6.4 전례색 · §6.3 재일 (B1) ──

/** 사계재 후보인가 — 규칙 종류로 판별한다(이름 아님, → R-6.1-ineligible). */
function isEmber(/** @type {Observance} */ obs) {
  return !!(obs.rule && obs.rule.kind === "ember_wfs");
}

/**
 * 그날의 색(→ R-6.4-color-order): 절기 기본색(격자 관측일의 색)을 깔고 → 승자 관측일의 색이 덮고 →
 * 성주간 · 부활 8일(`holyWeek` ∪ `easterOctave`, §4.10)에는 승자가 덮지 못한다(E−1 은 승자가 부활밤이어도
 * 홍 — 미결20). 승자의 색이 비었으면(추수감사주일) 바탕이 남는다. 사계재 날은 **자**다(→ R-6.4-ember-color):
 * 바탕이 남으면(승자가 격자) 그날 색이 자이고, 축일이 덮으면 그 색이 대표로 남고 `colors` 에 자를 앞세워
 * 병기한다(책자의 [자/백] 순). `colors` 는 병기 목록이라 병기가 없는 날은 `[color]` 다. `omitted` ·
 * `commemorated` 후보와 기념일은 색에 기여하지 않는다.
 * @param {string} dateStr @param {Candidate} grid @param {Candidate | null} official @param {Candidate[]} cands
 * @returns {{color: LiturgicalColor | null, colorAlt: import("../types").CodeField<LiturgicalColorAlt>, colors: LiturgicalColor[]}}
 */
function dayColorsOf(dateStr, grid, official, cands) {
  const guarded = inSpan(dateStr, "holyWeek") || inSpan(dateStr, "easterOctave");
  const top = official && official.observance.color && !guarded ? official.observance : grid.observance;
  const color = top.color;
  const colorAlt = top.color_alt ?? null;
  if (!color) return { color: null, colorAlt, colors: [] };
  const ember = cands.find((c) => c.status === "proper" && isEmber(c.observance) && c.observance.color);
  const violet = ember ? ember.observance.color : null;
  if (!violet) return { color, colorAlt, colors: [color] };
  if (top === grid.observance) return { color: violet, colorAlt, colors: [violet] };
  return { color, colorAlt, colors: color === violet ? [violet] : [violet, color] };
}

/**
 * 그날이 재일인가(§6.3 · 전사 「재일」) — `"major"` 대재일(재의 수요일 · 성 금요일), `"minor"` 소재일(사순
 * 절기 중 주간 40일 · 사계재일 · 성탄절기를 제외한 모든 금요일), 아니면 null. **승자와 무관하다** — 그날
 * 남아 있는 후보(`proper` · `transferred_in`)와 날짜로 판정한다: 사계재가 지향이어도 그날은 소재일이다.
 * 금요일의 성탄절기는 `spansOf().christmasToBaptism`(§4.10)으로 보고 날짜를 따로 비교하지 않는다
 * (→ R-6.3-friday-fast). 성 목요일은 대축일이고 재일이 아니다(ADR-036 §6) — 사순절기의 대축일 행이 그날
 * 있으면 소재일에서 뺀다. `ResolvedDate` 의 형태를 바꾸지 않으려고 따로 둔 함수다(§6.5 마지막 단락).
 * @param {ResolvedDate} resolved
 * @returns {LiturgicalFast | null}
 */
function fastOf(resolved) {
  if (!resolved || !resolved.coord || !Array.isArray(resolved.candidates)) return null;
  const here = resolved.candidates
    .filter((c) => c.status === "proper" || c.status === "transferred_in")
    .map((c) => c.observance);
  if (here.some((o) => o.rank === "principal" && o.type === "fast")) return "major";
  if (here.some((o) => o.penitential === true)) return "minor";
  const { season, type, weekday } = resolved.coord;
  if (season === "lent" && type === "weekday") {
    return here.some((o) => o.rank === "principal" && o.type === "feast" && o.season === "lent") ? null : "minor";
  }
  return weekday === "fri" && !inSpan(resolved.date, "christmasToBaptism") ? "minor" : null;
}

// ── §5.5 resolveDate ──

/**
 * 그 날의 후보 **전부**(§5.5) — 출처 다섯: ① 격자 ② 날짜(성인력) ③ 음력 ④ 규칙 파생 ⑤ 도착.
 * ①~④ 가 그 날짜의 고유 후보(`proper`)이고 ⑤ 만 다른 날짜에서 온다. 패스의 출발 색인에 있는 고유
 * 후보는 `transferred_out` 으로, 선택 봉헌은 `optional` 로 덧붙는다. 그 위에서 B1 이 승자를 정하고
 * 밀린 고유 후보를 재분류하며(`settle`) 그날의 색을 낸다(`dayColorsOf`). 후보는 하나도 버리지 않는다
 * (ADR-036 §7 「밀린 독서 보존」).
 *
 * 표시 순서(ADR-037 §6): ① 교회력에 따른 축일 · 재일(품계 순 — `compareCandidates`) → ② 이동 축일
 * (도착 → 선택 봉헌, 패스의 순서) → ③ 나머지(격자).
 * @param {CalendarIndex} index @param {string} dateStr @param {TransferPass} pass
 * @returns {ResolvedDate | null} 잘못된 날짜면 null
 */
function resolveDateIn(index, dateStr, pass) {
  const coord = coordOf(dateStr, index.ordinal);
  if (!coord) return null;

  /** @type {Map<string, Candidate>} */
  const departed = new Map();
  for (const c of pass.departures.get(dateStr) || []) departed.set(c.observance.id, c);
  /** @type {Candidate[]} */
  const feasts = ownObservancesOn(index, dateStr).map((o) => departed.get(o.id) || { observance: o, status: "proper" });
  /** @type {Candidate[]} */
  const moved = [...(pass.arrivals.get(dateStr) || []), ...(pass.optionals.get(dateStr) || [])];
  /** @type {Candidate} */
  const grid = { observance: gridObservance(dateStr, coord), status: "proper" };

  const { candidates, official } = settle(dateStr, [...feasts, ...moved, grid]);
  const own = candidates.slice(0, feasts.length).sort(compareCandidates);
  return {
    date: dateStr,
    coord,
    candidates: [...own, ...candidates.slice(feasts.length)],
    official,
    periods: periodsOn(index, monthDayOf(dateStr)),
    ...dayColorsOf(dateStr, grid, official, candidates),
  };
}

// ── §5.3 폴백 매칭 — 구체성 점수 ──

/**
 * @typedef {{
 *   weekday: WeekdayCode | null, abc: "A" | "B" | "C" | null, i2: "I" | "II" | null,
 *   axes?: {season: string, week: number | null, type: string},
 * }} MatchRequest
 */

/** 축 하나의 점수 — 단일 코드 일치 2 · 배열 포함 1 · null 0 · 불일치 -1(§5.3). */
function codeScore(/** @type {unknown} */ v, /** @type {(c: string) => boolean} */ ok) {
  if (v === null || v === undefined) return 0;
  if (Array.isArray(v)) return v.some((c) => typeof c === "string" && ok(c)) ? 1 : -1;
  return typeof v === "string" && ok(v) ? 2 : -1;
}

/**
 * 주기 코드가 그 날과 맞는가. A/B/C 는 주일 주기와, I/II 는 연중 평일 주기와 **따로** 대조한다 —
 * 두 도메인이 겹치지 않으므로 레코드의 코드가 어느 축인지 말해 준다(11.01 모든 성인의 날 A/B/C
 * 가 연중 평일에 와도 주일 주기로 갈린다).
 * @param {string} code @param {MatchRequest} req
 */
function cycleMatches(code, req) {
  if (code === "A" || code === "B" || code === "C") return code === req.abc;
  if (code === "I" || code === "II") return code === req.i2;
  return false;
}

/**
 * 구체성 점수(§5.3) — `weekday` · `year` 두 축의 합, 어느 축이든 불일치면 -1. `axes` 를 주면
 * `season` · `week` · `type` 은 **정확히** 맞아야 한다(폴백 없음 — 좌표 경로). 이름 · 날짜 경로는
 * 그 셋을 보지 않는다(레코드가 자기 이름 · 날짜로 이미 정해져 있다).
 * @param {TextRecord} record @param {MatchRequest} req
 * @returns {number}
 */
function matchScore(record, req) {
  if (req.axes) {
    const ax = req.axes;
    if (record.season !== ax.season || (record.week ?? null) !== ax.week || record.type !== ax.type) return -1;
  }
  const w = codeScore(record.weekday, (c) => c === req.weekday);
  if (w < 0) return -1;
  const y = codeScore(record.year, (c) => cycleMatches(c, req));
  if (y < 0) return -1;
  return w + y;
}

/**
 * 최고점 **층** 전부(§5.3) — 한 건이 아니라 한 층이 이긴다. 같은 좌표에 의도적으로 공존하는 대체
 * 본기도(`collect_no`) · 독서 세트(`set_no` · `reading_track`)는 점수가 같아 함께 남는다.
 * @param {TextRecord[]} records @param {MatchRequest} req
 * @returns {TextRecord[]}
 */
function topLayer(records, req) {
  let best = -1;
  /** @type {TextRecord[]} */
  const out = [];
  for (const r of new Set(records)) {
    const s = matchScore(r, req);
    if (s < 0 || s < best) continue;
    if (s > best) { best = s; out.length = 0; }
    out.push(r);
  }
  return out;
}

/** 그 날의 매칭 요청 — 요일과 두 주기. 주기는 **지키는 날**(`resolved.date`)의 것이다. */
function requestOf(/** @type {ResolvedDate} */ resolved) {
  return {
    weekday: resolved.coord.weekday,
    abc: sundayCycle(resolved.date),
    i2: weekdayCycle(resolved.date),
  };
}

// ── §5.4 · §5.6 본문 조회 ──

/**
 * 본문 표 하나 → 인덱스(§5.4 권장 인덱스 3). 레코드는 복사하지 않는다. 날짜 · 음력이 있는 레코드는
 * 그 키로만 닿고, 이름만 있는 레코드는 `byName` · `named` 로, 셋 다 없는 격자 레코드만 `byCoord`
 * 로 간다 — **이름 · 날짜가 있는 레코드는 폴백 해석을 하지 않는다**(§5.3 판정 규칙 — 성 토요일
 * 독서가 성주간 평일 전체에 퍼지지 않게). 날짜 표기가 깨진 레코드는 어느 경로에도 오르지 않는다(§2).
 * @param {any} table
 * @returns {TextIndex}
 */
function buildTextIndex(table) {
  /** @type {TextIndex} */
  const ix = { byDate: new Map(), byLunar: new Map(), byName: new Map(), byCoord: new Map(), named: [] };
  for (const r of rowsOf(table, "entries")) {
    if (typeof r.id !== "string" && typeof r.id !== "number") continue;
    const md = normMonthDay(r.date);
    if (r.date != null && md === null) continue;
    const lunar = typeof r.lunar === "string" && r.lunar !== "" ? r.lunar : null;
    if (md) pushTo(ix.byDate, md, r);
    if (lunar) pushTo(ix.byLunar, lunar, r);
    if (md || lunar) continue;
    const names = namesOfRow(r);
    if (names.length) {
      ix.named.push(r);
      for (const n of new Set(names)) pushTo(ix.byName, n, r);
    } else {
      pushTo(ix.byCoord, coordKey(r.season, r.week, r.type), r);
    }
  }
  return ix;
}

/** 좌표 인덱스 키. `week: null` 은 `x`. */
function coordKey(/** @type {unknown} */ season, /** @type {unknown} */ week, /** @type {unknown} */ type) {
  return String(season) + "|" + (week === null || week === undefined ? "x" : String(week)) + "|" + String(type);
}

/**
 * 독서 묶음 네 표 → 인덱스. `commons.classes` 는 배열이 아니라 **맵**이고, `canticles` 는 래퍼조차
 * 없는 id → 객체 맵이다(§5.2).
 * @param {{readings?: any, collects?: any, commons?: any, canticles?: any} | null} tables
 * @returns {LectionaryIndex}
 */
function buildLectionaryIndex(tables) {
  const t = tables || {};
  const classes = t.commons && typeof t.commons === "object" ? t.commons.classes : null;
  return {
    readings: buildTextIndex(t.readings),
    collects: buildTextIndex(t.collects),
    commons: classes && typeof classes === "object" && !Array.isArray(classes) ? classes : {},
    canticles: t.canticles && typeof t.canticles === "object" ? t.canticles : {},
  };
}

/**
 * 한 관측일의 **고유** 본문 레코드(독서 또는 본기도 표) — 최고점 층(§5.3), 정렬 전.
 *
 * **어느 키로 인덱스를 치는가는 관측일의 출처가 정한다**(§5.6 — 키의 존재 여부가 아니라 id 접두사):
 *
 * - **격자**(`grid:`) — ① 물어본 날짜(`resolved.date`)의 **날짜 전용 본문**: 그날 좌표와 `type` ·
 *   `season` 이 같은 것만(좁히기 규칙 ① — 주의 세례 뒤의 성탄주간 레코드는 버린다. 성인의 축일
 *   레코드는 `type: feast` 라 여기 오지 않는다) ② **고유명 평일**의 이름(성주간 월 ~ 수 · 재의
 *   수요일 후 목 ~ 토) ③ 좌표 폴백(§5.3 — 이름 · 날짜 없는 레코드만). 앞 단계의 **최고점 층**이
 *   비어야 다음 단계로 간다 — 행이 있는지가 아니라 요일 · 주기 점수를 매긴 결과로 가른다.
 * - **규칙 행**(temporal) — `coord_name` · 별칭으로 이름 조인 / 사계재는 이름 부분문자열 + 요일
 *   (§5.4 · 미결5) / 조인 이름이 없고 좌표가 있는 행(대림1주일)은 그 좌표로.
 * - **성인력 · 음력 행** — 관측일 **자신의** `date` · `lunar`(옮겨 온 축일도 기원 날짜에 색인돼
 *   있다). 날짜 인덱스는 1:N 이라 좁힌다(미결12 잠정): 날짜 전용 평일 본문(`type: weekday` — 격자
 *   후보의 것)은 언제나 걷어내고, 그 날짜에 성인력 행이 둘 이상이면 같은 날짜의 **다른** 관측일
 *   이름에 정확히 맞는 본문을 걷어낸 뒤 이 관측일의 이름 · 별칭에 정확히 맞는 것으로 좁힌다 —
 *   좁히기가 실패하면 조용히 하나를 고르지 않고 **남은 것 전부**를 낸다. 행이 하나뿐인 날짜는
 *   이름을 묻지 않는다(06.24 의 띄어쓰기 드리프트가 「고유 없음」으로 새지 않게).
 * @param {TextIndex} tix @param {CalendarIndex} cal @param {ResolvedDate} resolved @param {Observance} obs
 * @returns {TextRecord[]}
 */
function properRecords(tix, cal, resolved, obs) {
  const req = requestOf(resolved);
  const coord = resolved.coord;
  if (obs.id.startsWith(GRID_PREFIX)) {
    // 단계마다 **점수를 매긴 뒤** 비었는지 본다 — 행이 있어도 요일 · 주기가 맞지 않아 최고점 층이
    // 비면 다음 단계로 간다. 주기 한정 날짜 본문이 다른 해의 좌표 본문을 막으면 안 된다(2026-10-10 리뷰).
    const same = (/** @type {TextRecord} */ r) => r.type === coord.type && r.season === coord.season;
    const dated = topLayer((tix.byDate.get(monthDayOf(resolved.date)) || []).filter(same), req);
    if (dated.length) return dated;
    const named = topLayer((tix.byName.get(obs.name) || []).filter(same), req);
    if (named.length) return named;
    const axes = { season: coord.season, week: coord.week, type: coord.type };
    return topLayer(tix.byCoord.get(coordKey(coord.season, coord.week, coord.type)) || [], { ...req, axes });
  }

  const md = normMonthDay(obs.date);
  const lunar = typeof obs.lunar === "string" && obs.lunar !== "" ? obs.lunar : null;
  if (md || lunar) {
    const pool = (md ? tix.byDate.get(md) : lunar ? tix.byLunar.get(lunar) : null) || [];
    const rows = (md ? cal.sanctoralByDate.get(md) : lunar ? cal.sanctoralByLunar.get(lunar) : null) || [];
    const others = rows.filter((o) => o.id !== obs.id);
    let mine = pool.filter((r) => r.type !== "weekday");
    if (others.length) {
      mine = mine.filter((r) => !others.some((o) => namesMeet(r, o)));
      const exact = mine.filter((r) => namesMeet(r, obs));
      if (exact.length) mine = exact;
    }
    return topLayer(mine, req);
  }

  if (obs.kind !== "temporal" || obs.id.includes(":")) return [];   // guard: 등 다른 합성 관측일
  if (typeof obs.coord_name === "string" && obs.coord_name !== "") {
    const keys = [obs.coord_name, ...(Array.isArray(obs.aliases) ? obs.aliases : [])];
    return topLayer(keys.flatMap((k) => tix.byName.get(k) || []), req);
  }
  if (obs.rule && obs.rule.kind === "ember_wfs" && obs.name) {
    return topLayer(tix.named.filter((r) => typeof r.name === "string" && r.name.includes(obs.name)), req);
  }
  if (obs.season && obs.type) {
    const axes = { season: obs.season, week: obs.week ?? null, type: obs.type };
    return topLayer(tix.byCoord.get(coordKey(axes.season, axes.week, axes.type)) || [], { ...req, axes });
  }
  return [];
}

/** 레코드 → 독서 그룹(세트 하나가 그룹 하나 — §5.6). 슬롯은 복사하지 않는다. */
function readingGroupOf(/** @type {TextRecord} */ r) {
  /** @type {ReadingGroup} */
  const g = {
    id: String(r.id),
    title: typeof r.title === "string" ? r.title : "",
    reading_track: r.reading_track === 1 || r.reading_track === 2 ? r.reading_track : null,
    set_no: Number.isInteger(r.set_no) ? /** @type {number} */ (r.set_no) : 1,
    set_total: Number.isInteger(r.set_total) ? /** @type {number} */ (r.set_total) : 1,
    set_note: typeof r.set_note === "string" ? r.set_note : null,
    readings: Array.isArray(r.readings) ? r.readings : [],
    common: null,
  };
  return g;
}

/**
 * 그룹 순서 — 트랙(없음 → 1 → 2) · 세트 번호 · id. 세트 번호는 데이터가 이미 결정적으로 매겼다
 * (옛 연도판은 뒤로, 인쇄 순, 본 독서가 대안보다 앞 — ADR-037 §1 「세트 번호」). 배열 순서에 기대지 않는다.
 * @param {ReadingGroup} a @param {ReadingGroup} b
 */
function compareGroups(a, b) {
  return (a.reading_track ?? 0) - (b.reading_track ?? 0) || a.set_no - b.set_no || compareIds(a.id, b.id);
}

/** 공통 분류 — 프로토타입 키(`constructor` 등)를 분류로 읽지 않는다. */
function commonClassOf(/** @type {LectionaryIndex} */ lix, /** @type {unknown} */ cls) {
  if (typeof cls !== "string" || !Object.prototype.hasOwnProperty.call(lix.commons, cls)) return null;
  const c = lix.commons[cls];
  return c && typeof c === "object" ? c : null;
}

/**
 * **성인 공통 독서 폴백**(§5.6 · 미결11). 호출자가 「좁힌 고유 독서 0건」을 확인한 뒤 부른다 —
 * 트리거는 날짜 인덱스가 비었는가가 아니다. 자격: 분류가 공통에 있고 · 기념일이 아니고 · 세트가
 * 있다. 후보의 `status` 는 보지 않는다(관측일로 판정). 반환은 고유와 같은 그룹 형태 + `common`
 * 표지 + id `common:<class>-s<set>` — 세트를 전부 낸다(기도서가 「다음 중 하나」로 인쇄한 것).
 * @param {LectionaryIndex} lix @param {Observance} obs
 * @returns {ReadingGroup[]}
 */
function commonReadings(lix, obs) {
  if (obs.rank === "commemoration") return [];
  const cls = obs.sanctoral_class;
  const entry = commonClassOf(lix, cls);
  if (!entry || typeof cls !== "string") return [];
  const sets = (Array.isArray(entry.readings) ? entry.readings : [])
    .filter((s) => s && Number.isInteger(s.set) && Array.isArray(s.slots))
    .sort((a, b) => a.set - b.set);
  return sets.map((s) => ({
    id: COMMON_PREFIX + cls + "-s" + s.set,
    title: typeof entry.label === "string" ? entry.label : cls,
    reading_track: null,
    set_no: s.set,
    set_total: sets.length,
    set_note: null,
    readings: s.slots,
    common: cls,
  }));
}

/**
 * 고른 후보 **하나**의 독서(§5.6) — `reading_track` · `set_no` 별 그룹. 고유가 하나라도 있으면
 * 공통을 내지 않는다(배타). 기념일은 설계상 본문이 없다(§2) — 날짜에 남의 본문이 있어도 받지 않는다.
 * 결과가 없으면 빈 배열이다(throw 아님 — 격자 빈 칸 · 표에 없는 날도 정상 경로).
 * @param {LectionaryIndex} lix @param {CalendarIndex} cal
 * @param {ResolvedDate} resolved @param {Candidate} candidate
 * @returns {ReadingGroup[]}
 */
function findReadingsIn(lix, cal, resolved, candidate) {
  const obs = candidate && candidate.observance;
  if (!obs || typeof obs.id !== "string" || !resolved || !resolved.coord) return [];
  if (obs.rank === "commemoration") return [];
  const own = properRecords(lix.readings, cal, resolved, obs);
  if (own.length) return own.map(readingGroupOf).sort(compareGroups);
  return commonReadings(lix, obs);
}

/** 한국어 접속 조사 — 끝 글자에 받침이 있으면 「과」, 없으면 「와」(안나와 요아킴 · 키릴과 메토디우스). */
function withParticle(/** @type {string} */ word) {
  const code = word.charCodeAt(word.length - 1);
  const hangul = code >= 0xac00 && code <= 0xd7a3;
  return word + (hangul && (code - 0xac00) % 28 !== 0 ? "과" : "와");
}

/**
 * 공통 본기도의 `{name}` 자리에 넣을 이름. `common_names` 가 있으면 그것을(배열이면 「A와 B」),
 * 없으면 표의 이름에서 끝의 괄호 설명(「(종교개혁자, 1384년)」)을 뗀 것.
 * @param {Observance} obs
 */
function displayNameOf(obs) {
  const names = Array.isArray(obs.common_names) ? obs.common_names.filter((n) => typeof n === "string" && n !== "") : [];
  if (!names.length) names.push(String(obs.name || "").replace(/\s*\([^()]*\)\s*$/, ""));
  if (names.length === 1) return names[0];
  return names.slice(0, -2).map((n) => n + ", ").join("") + withParticle(names[names.length - 2]) + " " + names[names.length - 1];
}

/** 레코드 → 본기도 하나. */
function collectOptionOf(/** @type {TextRecord} */ r) {
  /** @type {CollectOption} */
  const c = {
    id: r.id,
    title: typeof r.title === "string" ? r.title : "",
    collect_no: Number.isInteger(r.collect_no) ? /** @type {number} */ (r.collect_no) : 1,
    collect_total: Number.isInteger(r.collect_total) ? /** @type {number} */ (r.collect_total) : 1,
    text: typeof r.text === "string" ? r.text : "",
    ending: r.ending === "A" || r.ending === "B" || r.ending === "C" ? r.ending : null,
    common: null,
  };
  return c;
}

/**
 * 한 관측일의 본기도 — 같은 관측일의 자유선택 대체안(`collect_no`)이 여럿일 수 있다. 트리거가
 * 독서와 다르다: **`has_proper: false` 이면 공통**이다(본기도 축의 사실 — 파서가 실매칭으로 정한다,
 * §5.6). 공통은 `{name}` 을 성인 이름으로 채운 하나이고 id 는 `common:<class>-c1`.
 * @param {LectionaryIndex} lix @param {CalendarIndex} cal @param {ResolvedDate} resolved @param {Observance} obs
 * @returns {CollectOption[]}
 */
function collectsOf(lix, cal, resolved, obs) {
  if (!obs || typeof obs.id !== "string" || obs.rank === "commemoration") return [];
  if (obs.has_proper !== false) {
    return properRecords(lix.collects, cal, resolved, obs)
      .map(collectOptionOf)
      .sort((a, b) => a.collect_no - b.collect_no || compareIds(a.id, b.id));
  }
  const cls = obs.sanctoral_class;
  const entry = commonClassOf(lix, cls);
  const tmpl = entry && entry.collect && typeof entry.collect.text === "string" ? entry.collect : null;
  if (!entry || !tmpl || typeof cls !== "string") return [];
  const e = tmpl.ending;
  return [{
    id: COMMON_PREFIX + cls + "-c1",
    title: typeof entry.label === "string" ? entry.label : cls,
    collect_no: 1,
    collect_total: 1,
    text: String(tmpl.text).split("{name}").join(displayNameOf(obs)),
    ending: e === "A" || e === "B" || e === "C" ? e : null,
    common: cls,
  }];
}

/**
 * 그날의 본기도(§5.6 · ADR-038 §3) — **두 축을 구분한다**: 원소 하나가 관측일 하나(`{candidate,
 * collects}`, 순서는 `candidates` 순)이고 그 안의 `collects` 가 같은 관측일의 대체안이다. 뷰는
 * 고른 후보의 것을 앞에 두고 나머지를 열거한다 — 재배열만 하고 재조회하지 않는다. 기념일 후보의
 * 원소는 빈 `collects` 다.
 * @param {LectionaryIndex} lix @param {CalendarIndex} cal @param {ResolvedDate} resolved
 * @returns {CandidateCollects[]}
 */
function findCollectsIn(lix, cal, resolved) {
  if (!resolved || !Array.isArray(resolved.candidates)) return [];
  return resolved.candidates.map((candidate) => ({
    candidate,
    collects: collectsOf(lix, cal, resolved, candidate.observance),
  }));
}
// ── END LITURGICAL_LOOKUP ──

// ── BEGIN LITURGICAL_PRELOAD ──
// 프리로드와 공개 래퍼(§3.4). 모듈 상태(`calendarIndex` 등)는 블록 밖에 있고 테스트가 prelude 로
// 재선언한다 — `fetch` 도 테스트가 주입한다(data-fetch.js DATA_FETCHING 블록 선례).

/** 캘린더 묶음(§3.5) — 소형 표 다섯, 캘린더 진입 · `resolveDate` 전에. */
const CALENDAR_FILES = ["sanctoral", "temporal-feasts", "periods", "ordinal-weeks", "kasi-lunar"];
/** 독서 묶음(§3.5) — 대형 표 넷, 독서 뷰 진입 · `findReadings`/`findCollects` 전에. */
const LECTIONARY_FILES = ["eucharist-readings", "eucharist-collects", "commons", "canticles"];

/** @param {string} name @returns {Promise<any>} */
function fetchLectionaryJson(name) {
  return fetch(`${DATA_DIR}/lectionary/${name}.json`).then((res) => {
    if (!res.ok) throw new Error(`Failed to load lectionary/${name}.json`);
    return res.json();
  });
}

/**
 * 캘린더 묶음을 싣는다. **promise 를 캐시**하므로 동시에 불러도 fetch 는 파일당 한 번이고, 거부된
 * promise 는 비워 다음 호출이 다시 시도한다 — 오프라인에서 한 번 실패해도 달력이 영영 깨지지 않게(§3.4).
 * 인덱스가 새로 서면 이동 패스 캐시를 비운다(패스는 표에 의존한다 — §4.9).
 * @returns {Promise<CalendarIndex>}
 */
function preloadCalendar() {
  return (calendarPromise ??= Promise.all(CALENDAR_FILES.map(fetchLectionaryJson))
    .then(([sanctoral, temporal, periods, ordinalWeeks, kasi]) => {
      transferCache.clear();
      return (calendarIndex = buildCalendarIndex({ sanctoral, temporal, periods, ordinalWeeks, kasi }));
    })
    .catch((e) => { calendarPromise = null; throw e; }));
}

/**
 * 독서 묶음을 싣는다 — 캐시 규칙은 `preloadCalendar` 와 같다(한쪽만 고치면 증상이 절반만 사라진다).
 * @returns {Promise<LectionaryIndex>}
 */
function preloadLectionary() {
  return (lectionaryPromise ??= Promise.all(LECTIONARY_FILES.map(fetchLectionaryJson))
    .then(([readings, collects, commons, canticles]) =>
      (lectionaryIndex = buildLectionaryIndex({ readings, collects, commons, canticles })))
    .catch((e) => { lectionaryPromise = null; throw e; }));
}

/**
 * 그 날이 교회력에서 무슨 날인가(§5.5) — **동기 · 순수**. 프리로드 전에 부르면 throw 한다: 조용히
 * 빈 값을 주면 뷰가 「아무 날도 아님」으로 잘못 그린다(§3.4). 잘못된 날짜 문자열은 null.
 * @param {string} dateStr "YYYY-MM-DD"
 * @returns {ResolvedDate | null}
 */
function resolveDate(dateStr) {
  if (!calendarIndex) throw new Error("preloadCalendar() must be awaited before resolveDate()");
  const p = parseDate(dateStr);
  if (!p) return null;
  return resolveDateIn(calendarIndex, dateStr, transfersOf(p.y));
}

/**
 * 고른 후보 하나의 독서 그룹(§5.6). 프리로드 전이면 throw — 「아직 안 불러옴」과 「빈 결과」(`[]`)를
 * 뷰가 구별할 수 있게(§2). 1:N 좁히기가 같은 날짜의 성인력 행을 보므로 캘린더 묶음도 필요하다.
 * @param {ResolvedDate} resolved @param {Candidate} candidate
 * @returns {ReadingGroup[]}
 */
function findReadings(resolved, candidate) {
  if (!lectionaryIndex) throw new Error("preloadLectionary() must be awaited before findReadings()");
  if (!calendarIndex) throw new Error("preloadCalendar() must be awaited before findReadings()");
  return findReadingsIn(lectionaryIndex, calendarIndex, resolved, candidate);
}

/**
 * 그날의 본기도 — 관측일별 원소(§5.6). 프리로드 규칙은 `findReadings` 와 같다.
 * @param {ResolvedDate} resolved
 * @returns {CandidateCollects[]}
 */
function findCollects(resolved) {
  if (!lectionaryIndex) throw new Error("preloadLectionary() must be awaited before findCollects()");
  if (!calendarIndex) throw new Error("preloadCalendar() must be awaited before findCollects()");
  return findCollectsIn(lectionaryIndex, calendarIndex, resolved);
}
// ── END LITURGICAL_PRELOAD ──

export {
  parseDate, toKey, addDays, dayOfWeek, dayOfYear,
  nearestSunday, firstSundayAfter, lastSundayBefore, nthSunday, sundayOfWeek,
  easterDate, advent1Date, baptismDate, liturgicalYearOf, yearAnchors,
  seasonOf, sundayCycle, weekdayCycle, evalRule,
  buildOrdinalIndex, ordinalWeekOf, lunarDatesOf, spansOf, inSpan,
  preloadCalendar, preloadLectionary, resolveDate, findReadings, findCollects, fastOf,
};
