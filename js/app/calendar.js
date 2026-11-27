// @ts-check
"use strict";

// Calendar tab (ADR-038 §1 · §2 — A2). The church calendar a month at a time at
// /calendar[/YYYY-MM], or as a list without ends at /calendar/list[/YYYY-MM-DD]:
// a month cell links to the day's row in the list, a list row to the day's
// lectionary page (/lectionary/YYYY-MM-DD — the A3 view). The small layout has
// the list only (ADR-058 §1). Each day shows its representative name
// and its liturgical colour dots. The engine decides what each day IS
// (resolveDate — ADR-037 §6, design §5.5); this module only decides what a cell
// SHOWS. Only the small calendar bundle is preloaded (design §3.5 — ~105KB of
// definition tables); the ~1.6MB lectionary bundle stays with the reading view.
//
// State rides in the URL and every control is a link, so the global <a>
// interceptor (routing.js) navigates and the back button / shared links /
// keyboard work unchanged — the same contract as the lectionary view.
//
// 사용자 결정(2026-10-15 — A2 계획의 잠정안 일괄 승인, coding-pitfalls §24):
//   칸 이름은 하나 — 그날의 대표(엔진의 official). 대표가 이름 없는 평일(격자)이면 사계재 · 기념일처럼 이름 있는
//   다른 후보, 주일 · 고유명 평일(성주간 월~수 · 재의 수요일 후 목~토)은 격자 이름. 나머지 후보는 목록 줄과
//   전례독서 목록에서 본다.
//   선택 봉헌(「옮겨 지킬 수 있음」)은 월간 칸에 보이지 않는다 — 목록 줄의 보조 이름으로.
//   전례년이 바뀌는 날(대림 1주일)에 「나해 시작」 같은 표지(설계서 미결3 — 엔진의 liturgicalYearOf로 가른다).
//   독서 성구는 달력에 싣지 않는다(설계서 미결41) — 독서 묶음(1.6MB)을 달력에서 받지 않으려고.
//   탭 이름 · 화면 제목은 「캘린더」(사용자 「"교회력"은 "캘린더"로」 2026-10-15) — 교회력 자체를 말하는 문구는 그대로.

/** @typedef {import("../types.js").ResolvedDate} ResolvedDate */
/** @typedef {import("../types.js").Candidate} Candidate */

import {
  parseDate, toKey, addDays, dayOfWeek, liturgicalYearOf, preloadCalendar, preloadLectionary, resolveDate,
  MIN_YEAR, MAX_YEAR, isComputableYear, isComputableDate,
} from "./liturgical-engine.js";
import {
  LITURGICAL_VIEWS, THIS_MONTH_LABEL, commitLiturgicalTitle, renderLiturgicalFailure, renderLiturgicalLoadFailure,
} from "./views.js";
import {
  shortName, statusSuffix, isGrid, todayKey, commitDateBar, headLinesOf, lectionaryModelOf,
  CYCLE_LABEL, COLOR_LABEL, WEEKDAY_KO, TRACK_NAME,
} from "./lectionary.js";

// barBottom: 상단 바의 아래쪽(화면 위에서 잰 값).
const {
  _$, el, clearNode, HEADER_ICON_PATHS, SCROLL_ANCHORING, focusSpotOf, restoreFocusSpot, barBottom, scrollUnderBar, headerIcon,
  isModifiedClick, isSmallLayout, LARGE_LAYOUT_QUERY, SHEET_INERT_SELECTORS, DATE_PICKER_FOCUS_KEY, datePickerTrigger, calendarDropTrigger,
} = window.appHelpers;

const $app = _$("app");
// 이름은 views.js에 있다 — 이 모듈을 받지 못했을 때 라우터가 같은 제목으로 실패 화면을 그린다.
const PAGE_TITLE = LITURGICAL_VIEWS.calendar.title;

/** parsePath가 /calendar에서 내는 서술자(routing.js PARSE_PATH — 정의는 types.d.ts `Route`). @typedef {import("../types.js").CalendarRoute} CalendarRoute */
/**
 * 이름 하나 — 목록 줄의 이름 줄 원소. `away` 는 그날 지키지 않는 후보(옮겨 감 · 생략)라 흐리게 그린다.
 * @typedef {{ name: string, title: string, suffix: string, away: boolean }} CalendarName
 */
/**
 * 교회력 하루 — 월간 칸과 목록 줄이 같이 쓰는 표시 단위(`calendarDay` 의 반환).
 * @typedef {{
 *   date: string, day: number, weekday: number, href: string | null,
 *   cellName: string, cellTitle: string, cellSuffix: string,
 *   primary: CalendarName | null, others: CalendarName[],
 *   colors: string[], cycle: string | null, yearStart: string | null,
 * }} CalendarDay
 */
/** 월간 표의 칸 하나. @typedef {CalendarDay & { inMonth: boolean, isToday: boolean, label: string }} CalendarCell */
/**
 * 월간 화면이 그리는 것 전부 — 순수 함수 `buildMonthGrid` 의 반환. DOM 은 이것만 읽는다.
 * @typedef {{
 *   year: number, month: number, title: string, shortTitle: string, weeks: CalendarCell[][],
 *   hrefs: { prev: string | null, next: string | null, today: string, view: string },
 * }} CalendarMonth
 */
/** 목록 줄의 장절 한 줄 — 「감사성찬례」와 트랙 이름, 장절들(ADR-060 §2). @typedef {{ name: string, note: string | null, refs: string[] }} ListReading */
/**
 * 목록 줄 하나 — 순수 함수 `listRowOf` 의 반환.
 * @typedef {{
 *   date: string, day: number, weekday: string, isSunday: boolean, week: string, href: string, isToday: boolean, level: "major" | "minor" | "",
 *   title: string, colors: { code: string, name: string, or: boolean }[], meta: string[], lines: string[], readings: ListReading[], label: string,
 * }} ListRow
 */
/**
 * 목록의 상단 바가 보이는 달 — 순수 함수 `listMonthOf` 의 반환.
 * @typedef {{
 *   year: number, month: number, title: string, shortTitle: string,
 *   hrefs: { prev: string | null, next: string | null, today: string, view: string },
 * }} ListMonth
 */
/**
 * 그려 둔 목록. `first`와 `last`는 그려 둔 첫날과 끝날이고, `above`와 `below`는 줄 앞뒤의 경계 요소다. 경계가 화면에 가까워지면 줄을 더한다.
 * `top`은 주소에 남긴 맨 위 줄의 날짜이고, `isStale`은 이 목록을 그린 라우트가 낡았는지 본다.
 * @typedef {{
 *   root: HTMLElement, above: HTMLElement, below: HTMLElement, first: string, last: string, month: string, today: string, top: string,
 *   rowOf: (date: string) => ListRow | null, isStale: () => boolean,
 * }} ListView
 */
/** 전례독서 모델. @typedef {import("./lectionary.js").LectionaryModel} LectionaryModel */
/**
 * 날짜 고르기의 날 판 칸 하나 — `pickerDays`의 반환. `weekday`는 일요일이 0이다.
 * @typedef {{ date: string, day: number, weekday: number, colors: string[], isToday: boolean, isCurrent: boolean }} PickerDay
 */
/** 날 판 — 칸은 일요일부터 7칸씩이고 다른 달의 날은 null이다. 앞뒤 달이 계산 범위 밖이면 null. @typedef {{ y: number, m: number, title: string, cells: (PickerDay | null)[], prev: { y: number, m: number } | null, next: { y: number, m: number } | null }} PickerDays */
/** 달 판과 해 판의 칸 하나(해 판은 `m`이 0). @typedef {{ y: number, m: number, label: string, isToday: boolean, isCurrent: boolean }} PickerCell */
/** 달 판 — 앞뒤 해가 계산 범위 밖이면 null. @typedef {{ title: string, cells: PickerCell[], prev: number | null, next: number | null }} PickerMonths */
/** 해 판 — `prev`와 `next`는 앞뒤 쪽의 첫 해. @typedef {{ title: string, cells: PickerCell[], prev: number | null, next: number | null }} PickerYears */

// ── BEGIN CALENDAR_MODEL ──
// Exercised by tests/unit/calendar.test.js (vm slice — no DOM) and, against
// the real tables, by tests/unit/calendar.data.test.js. Pure decisions only:
// which name a cell shows, which names a row lists, which colours the dots
// wear, where the liturgical year turns, and how a month lays out on the
// 6 × 7 grid. The test loaders slice the engine's LITURGICAL_CORE (+ LOOKUP)
// block and lectionary's LECTIONARY_MODEL block alongside, so parseDate /
// addDays / liturgicalYearOf / shortName / statusSuffix are the real functions.
// Names here must not collide with those blocks — they share one vm context.

/** 월간 표 — 6주 × 7일. 달마다 줄 수가 바뀌지 않아 이전/다음 달로 넘겨도 표가 뛰지 않는다(설계서 §4.9 의 42칸). */
const CAL_WEEKS = 6;
const CAL_WEEKDAY_FULL = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

/**
 * "YYYY-MM" → {y, m}. 형식이 틀리거나 교회력을 계산하는 연도(엔진 `isComputableYear` — 1583-9999) 밖이면 null.
 * @param {string | null | undefined} s
 * @returns {{ y: number, m: number } | null}
 */
function parseMonthParam(s) {
  if (typeof s !== "string") return null;
  const mt = s.match(/^(\d{4})-(\d{2})$/);
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  if (m < 1 || m > 12 || !isComputableYear(y)) return null;
  return { y, m };
}

/**
 * `delta`달 옮긴 달. 해를 넘고, 계산 범위 밖이면 null이다(‹ › 단추가 사라지거나 누를 수 없다).
 * @param {number} y @param {number} m @param {number} delta
 * @returns {{ y: number, m: number } | null}
 */
function monthStep(y, m, delta) {
  const index = y * 12 + (m - 1) + delta;
  const ny = Math.floor(index / 12);
  return isComputableYear(ny) ? { y: ny, m: index - ny * 12 + 1 } : null;
}

/** 그날 지키지 않는 후보 — 다른 날로 옮겨 감 · 생략. 줄에서 흐리게 그린다(이름은 남긴다 — 「후보 전부 노출」). */
function isAwayCandidate(/** @type {Candidate} */ c) {
  return c.status === "transferred_out" || c.status === "omitted";
}

/**
 * 월간 칸에 이름을 다는 후보(사용자 결정 2026-10-15): 대표가 격자가 아니면 대표. 격자면 주일 · 고유명 평일은
 * 그 격자(「연중 29주일」 · 「성주간 월요일」), 그 밖의 평일은 그날 지키는 이름 있는 후보(사계재 · 기념일) — 없으면
 * 이름 없는 평일이라 null(칸에는 날짜와 색 점만). 고유명 평일은 엔진이 격자 전례일에 단 표지(`properWeekday`)로
 * 가린다 — 절기 위치 (lent, null, weekday) 는 성 목 · 금 · 토의 격자와 같아 절기 위치로는 가를 수 없고,
 * 그 의미는 엔진의 몫이다
 * (설계서 §5.5 — 절기 위치로 가리던 때는 엔진이 주 번호를 매기면 칸이 조용히 빈 이름이 됐다 — PR #348 리뷰).
 * @param {ResolvedDate} resolved
 * @returns {Candidate | null}
 */
function cellCandidateOf(resolved) {
  const official = resolved.official || null;
  if (!official) return null;
  if (!isGrid(official)) return official;
  if (resolved.coord && resolved.coord.type === "sunday") return official;
  if (official.observance.properWeekday === true) return official;
  // 저녁 전례(성탄 밤 — 12.24 저녁)는 그날의 이름이 아니다(→ 설계서 R-6.1-evening — 그날 낮의 대표 · 색에 참여하지 않는다) —
  // 칸에 실으면 「성탄 밤」 이름에 그날 색(자) 점이 붙는다(PR #349 리뷰). 목록 줄에는 「· 저녁」 상태 표시로 남는다.
  return resolved.candidates.find((c) => !isGrid(c) && !isAwayCandidate(c) && c.status !== "optional" && !c.evening) || null;
}

/**
 * 월간 칸에 쓰는 짧은 이름 — `shortName`에 더해 번호 붙은 주일은 「대림1주」처럼 줄인다(ADR-038 §2):
 * 「연중 32주일」 → 「연중32주」 · 「대림1주일」 → 「대림1주」. 폰의 칸 폭(약 4글자)에 한 줄로 들어간다.
 * 번호 없는 주일(성지주일 · 삼위일체 주일)과 평일 이름은 그대로. 목록 줄과 링크 이름은 줄이지 않은 이름이다.
 * @param {string | null | undefined} name
 */
function cellLabel(name) {
  return shortName(name).replace(/^(\S+?)\s*(\d+)주일$/, "$1$2주");
}

/**
 * 그날의 정식 색. 사계재 날의 축일이면 자색과 백색을 함께 싣는다. `colors`가 없으면 `color` 하나다. 선택 대체색(장미, 청)은 싣지 않는다(DESIGN.md §2).
 * 월간 칸의 점(`calendarDay`)과 날짜 고르기 판의 점(`pickerColorsOf`)이 같이 쓴다. 엔진이 못 푼 날(null)은 색이 없다.
 * @param {ResolvedDate | null} resolved
 * @returns {string[]}
 */
function calendarColorsOf(resolved) {
  if (!resolved) return [];
  return Array.isArray(resolved.colors) && resolved.colors.length ? resolved.colors.slice() : (resolved.color ? [resolved.color] : []);
}

/** 후보 → 줄의 이름 원소. @param {Candidate} c @returns {CalendarName} */
function nameOfCandidate(c) {
  const full = String(c.observance.name || "");
  return { name: shortName(full), title: full, suffix: statusSuffix(c), away: isAwayCandidate(c) };
}

/**
 * 하루의 표시 단위(순수). `resolved` 가 null 이면(계산 범위 밖 · 잘못된 날짜) 날짜만 있는 빈 하루 — 링크도 없다.
 * - 칸 이름: `cellCandidateOf` 하나 — 괄호 설명을 뗀 이름(전례독서 목록과 같은 `shortName`), 전체 이름은 `cellTitle`, 그 후보의
 *   상태 표시(「· 10월 18일에서 옮겨 옴」 · 「· 기념일」)는 `cellSuffix` — 칸에는 보이지 않고 링크 이름에 붙는다.
 * - 줄: 첫 이름은 그날의 대표(격자 평일도 이름이 있다 — 「연중 28주 금요일」), 그 밖의 이름 있는 후보(격자 제외)를
 *   후보 순서대로 — 상태 표시(「· 10월 18일에서 옮겨 옴」 · 「· 옮겨 지킬 수 있음」)를 전례독서 목록과 같은 말로.
 * - 색: 그날의 정식 색(`colors` — 사계재 날 축일이면 [자, 백] 병기). 선택 대체색(장미 · 청)은 싣지 않는다(DESIGN.md §2).
 * - 주기: 주일만(「가해」) — 평일 주기(홀수해 · 짝수해)는 싣지 않는다.
 * - 전례년 첫날: 대림 1주일 — 그날부터 새 주기(「나해 시작」, 미결3).
 * @param {string} date  "YYYY-MM-DD"
 * @param {ResolvedDate | null} resolved
 * @returns {CalendarDay}
 */
function calendarDay(date, resolved) {
  const p = parseDate(date);
  const day = p ? p.d : Number(date.slice(-2)) || 0;
  const weekday = p ? dayOfWeek(date) : -1;
  if (!p || !resolved) {
    return { date, day, weekday, href: null, cellName: "", cellTitle: "", cellSuffix: "", primary: null, others: [], colors: [], cycle: null, yearStart: null };
  }
  const cell = cellCandidateOf(resolved);
  const official = resolved.official || null;
  const others = resolved.candidates
    .filter((c) => !isGrid(c) && c !== official)
    .map(nameOfCandidate);
  const colors = calendarColorsOf(resolved);
  const coord = resolved.coord;
  const cycleCode = coord && coord.type === "sunday" ? coord.year : null;
  const cycle = cycleCode && CYCLE_LABEL[cycleCode] ? CYCLE_LABEL[cycleCode] : null;
  // 전례년은 대림 1주일 — 주일 — 에 바뀌므로 주기가 있는 날(주일)만 앞날과 견준다. 42칸마다 두 번씩 셈하지 않게.
  const prev = cycle ? addDays(date, -1) : null;
  const yearStart = prev !== null && liturgicalYearOf(prev) !== liturgicalYearOf(date) ? `${cycle} 시작` : null;
  return {
    date, day, weekday,
    href: `/calendar/list/${date}`,
    cellName: cell ? cellLabel(cell.observance.name) : "",
    cellTitle: cell ? String(cell.observance.name || "") : "",
    cellSuffix: cell ? statusSuffix(cell) : "",
    primary: official ? nameOfCandidate(official) : null,
    others,
    colors,
    cycle,
    yearStart,
  };
}

/** 색 코드 목록 → 「자색 · 백색」. @param {string[]} colors */
function colorNames(colors) {
  return colors.map((c) => COLOR_LABEL[c] || c).join(" · ");
}

/**
 * 칸 링크의 접근 가능한 이름 — 「오늘, 10월 15일 목요일, 아빌라의 데레사, 백색」. 이름은 칸에 보이는 그대로다(주일 「연중24주」 ·
 * 사계재 날 「추계재」) — 보이는 글자가 접근 가능한 이름 안에 있어야 음성 제어가 그 글자로 누르고 스크린 리더도 보이는 이름을
 * 읽는다(WCAG 2.5.3 Label in Name; 대표 이름을 싣던 때는 격자 평일 · 주일 칸이 어긋났다 — PR #348 리뷰). 이름 없는 평일 칸은
 * 대표(격자) 이름을 싣고, 색은 점뿐이라(DESIGN.md §2 — 색만으로 정보를 전하지 않는다) 전례년 표지 · 색 이름도 글자로 싣는다.
 * @param {CalendarDay} d @param {boolean} isToday
 */
function dayAriaLabel(d, isToday) {
  const p = parseDate(d.date);
  const parts = [];
  if (isToday) parts.push("오늘");
  parts.push(p ? `${p.m}월 ${p.d}일 ${CAL_WEEKDAY_FULL[d.weekday] || ""}`.trim() : d.date);
  if (d.cellName) parts.push(d.cellName + d.cellSuffix);
  else if (d.primary) parts.push(d.primary.name + d.primary.suffix);
  if (d.yearStart) parts.push(d.yearStart);
  if (d.colors.length) parts.push(colorNames(d.colors));
  return parts.join(", ");
}

/**
 * 표 칸의 날짜. 엔진의 날짜 덧셈은 계산 범위 끝 달의 앞뒤 칸(1583년 1월 표의 1582-12-26 · 9999년 12월 표의 10000-01-08)까지
 * 낸다 — 그래도 null 이면 틀린 표를 그리지 말고 멈춘다(같은 날짜로 메우면 같은 링크가 여러 칸에 생긴다 — PR #348 리뷰).
 * @param {string} from @param {number} n
 */
function gridDate(from, n) {
  const d = addDays(from, n);
  if (d === null) throw new Error(`calendar grid: addDays(${from}, ${n}) failed`);
  return d;
}

/**
 * 월간 표(ADR-038 §2): 그달 1일이 있는 주의 일요일부터 6주 42칸. 앞뒤 달의 칸도 같은 링크다(흐리게 · 이름 없이 —
 * DOM 이 가린다). 계산 범위(1583-9999) 밖의 칸은 날짜만 있고 링크가 없다 — 그 날짜는 `resolve` 를 호출하지 않는다.
 * `resolve` 는 엔진 `resolveDate`(프리로드 뒤 동기)다 — 연도 캐시가 있어 42번 호출해도 부활절 계산은 해마다 한 번이다
 * (설계서 §4.9 「computus 최대 세 번」).
 * @param {number} y @param {number} m  1~12
 * @param {string} today  "YYYY-MM-DD" — 오늘 칸 표시
 * @param {(date: string) => ResolvedDate | null} resolve
 * @returns {CalendarMonth}
 */
function buildMonthGrid(y, m, today, resolve) {
  const first = toKey(y, m, 1);
  const start = gridDate(first, -dayOfWeek(first));
  /** @type {CalendarCell[][]} */
  const weeks = [];
  for (let w = 0; w < CAL_WEEKS; w++) {
    /** @type {CalendarCell[]} */
    const row = [];
    for (let i = 0; i < 7; i++) {
      const date = gridDate(start, w * 7 + i);
      const p = parseDate(date);
      const d = calendarDay(date, isComputableDate(date) ? resolve(date) : null);
      const isToday = date === today;
      // 칸은 목록의 그날 줄로 간다(ADR-058 §1). 오늘 줄의 주소에는 날짜를 적지 않는다(listPathOf)
      row.push({ ...d, href: d.href && listPathOf(date, today), inMonth: !!p && p.y === y && p.m === m, isToday, label: dayAriaLabel(d, isToday) });
    }
    weeks.push(row);
  }
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  return {
    year: y, month: m, title: `${y}년 ${m}월`, shortTitle: `${y}.${String(m).padStart(2, "0")}`, weeks,
    hrefs: {
      prev: monthStepPath(y, m, -1, today), next: monthStepPath(y, m, 1, today), today: "/calendar",
      // 보던 달을 유지한다. 이번 달은 오늘 줄이고 다른 달은 그 달 1일의 줄이다(ADR-038 §2).
      view: today.slice(0, 7) === key ? "/calendar/list" : `/calendar/list/${key}-01`,
    },
  };
}

/**
 * 그 줄을 맨 위에 두는 목록 주소(ADR-038 §2). 오늘 줄에는 날짜를 적지 않아, 다음 날 다시 열면 그날의 오늘 줄이다(사용자 결정 2026-11-07).
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} today  "YYYY-MM-DD"
 */
function listPathOf(date, today) {
  return date === today ? "/calendar/list" : `/calendar/list/${date}`;
}

/**
 * 그날의 전례독서 주소. 오늘은 날짜 없이 `/lectionary`라 다음 날 다시 열면 그날의 독서다(`listPathOf`와 같은 규칙). 전례독서 화면의 날짜
 * 고르기가 쓴다(ADR-038 §2 「날짜 고르기」, 사용자 결정 2026-11-18). 고른 전례일과 독서 세트(`?obs=` 등)는 붙이지 않아 그날의 기본 독서다.
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} today  "YYYY-MM-DD"
 */
function lectionaryPathOf(date, today) {
  return date === today ? "/lectionary" : `/lectionary/${date}`;
}

/**
 * 그 달의 월간 주소. 이번 달에는 날짜를 적지 않아, 다음 달에 다시 열면 그달이다(`listPathOf`와 같은 규칙). 목록의 월간 단추와 날짜 고르기 판의
 * 달이 쓴다.
 * @param {number} y @param {number} m  1-12
 * @param {string} today  "YYYY-MM-DD"
 */
function monthPathOf(y, m, today) {
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  return today.slice(0, 7) === key ? "/calendar" : `/calendar/${key}`;
}

/**
 * 월간 ‹ ›의 주소. 이번 달이면 날짜 없이 `/calendar`다(`monthPathOf`). 계산 범위 밖이면 null이라 단추가 사라진다.
 * @param {number} y @param {number} m @param {-1 | 1} delta
 * @param {string} today  "YYYY-MM-DD"
 */
function monthStepPath(y, m, delta, today) {
  const to = monthStep(y, m, delta);
  return to && monthPathOf(to.y, to.m, today);
}

/**
 * 목록 ‹ ›의 주소. 앞뒤 달 1일의 줄이고, 그날이 오늘(매달 1일)이면 날짜 없이 `/calendar/list`다(`listPathOf`). 계산 범위 밖이면 null이라 단추가 사라진다.
 * @param {number} y @param {number} m @param {-1 | 1} delta
 * @param {string} today  "YYYY-MM-DD"
 */
function listStepPath(y, m, delta, today) {
  const to = monthStep(y, m, delta);
  return to && listPathOf(toKey(to.y, to.m, 1), today);
}

/**
 * 목록 줄의 등급 — 주일과 대축일, 주요축일은 `major`, 축일은 `minor`, 평일은 빈 값이다. 모든 날을 보이므로 주일과 축일을 찾기 쉽게
 * 한다. 굵기는 두 단계라 `major`와 `minor`의 제목이 모두 500, 평일이 400이다(DESIGN.md §3, 사용자 결정 2026-11-16). 검색 결과의 전례일 줄도
 * 같은 규칙을 색인으로 따로 계산한다(search.js `LECT_BOLD_RANKS`, `lectRowOf`). 한쪽을 고치면 다른 쪽도 고친다.
 * @param {LectionaryModel} m
 * @returns {"major" | "minor" | ""}
 */
function rowLevelOf(m) {
  // 소속교회와 무관한 그날의 기본 독서로 정한다. 소속교회 축성일의 줄도 월간 칸처럼 그날의 강조를 따른다(ADR-041 §6, PR #542 리뷰)
  const rank = m.publicInitial.observance.rank;
  if (m.resolved.coord.type === "sunday" || rank === "principal" || rank === "privileged_sunday" || rank === "major_feast" || rank === "sunday") return "major";
  return rank === "minor_feast" || rank === "regional_festival" ? "minor" : "";
}

/**
 * 줄의 글에서 요일을 뺀다(ADR-058 §2). 왼쪽 날짜 칸이 요일을 보이므로, 절기와 주 번호로 만든 평일 이름의 끝 요일만 뺀다. 「연중 34주 화요일」은
 * 「연중 34주」다. 요일이 이름의 일부인 날(성주간 월요일, 재의 수요일)과 주 번호가 없는 이름(「성탄 후 화요일」)은 그대로다. 뒤의 상태
 * 표시(「 · 저녁」)는 남긴다.
 * @param {string} text
 */
function rowTextOf(text) {
  return text.replace(/^(.+ \d+주) [월화수목금토]요일(?=$| ·)/, "$1");
}

/**
 * 주 번호가 없고 주일과 절기가 다른 날의 주간 라벨(ADR-060 §2). 주 중간에 바뀐 절기다. 성탄일부터 다음 주일 전까지는 「성탄 후 주간」, 재의 수요일부터
 * 토요일까지는 「사순 시작」이다(사용자 결정 2026-11-27). 나머지 셋은 계산 범위 끝에서 주일을 풀지 못할 때만 쓴다.
 */
const SEASON_HEAD = { advent: "대림", christmas: "성탄 후 주간", lent: "사순 시작", easter: "부활", ordinary: "연중" };
/**
 * 주 번호가 없고 그 주 평일에도 주 번호가 없는 주일의 주간 라벨. 성지주일은 「성주간」, 성탄일이 주일이면 「성탄 후 주간」이다(ADR-060 §2, 사용자 결정 2026-11-27).
 */
const UNNUMBERED_SUNDAY_HEAD = { lent: "성주간", christmas: "성탄 후 주간" };

/**
 * 그날 격자의 이름에서 읽는 주 이름 — 「연중 34주일」과 「연중 34주 화요일」은 「연중 34주」다. 주 번호가 없으면(「성령강림대축일」,
 * 「성탄 8일 전」, 「재의 수요일 후 목요일」, 「성주간 월요일」) null이다.
 * @param {ResolvedDate | null} resolved
 * @returns {string | null}
 */
function ownWeekOf(resolved) {
  const grid = resolved?.candidates.find(isGrid);
  const name = grid ? String(grid.observance.name || "") : "";
  const numbered = name.match(/^(.+ \d+주)(?:일| [월화수목금토]요일)$/);
  return numbered ? numbered[1] : null;
}

/**
 * 주일의 주간 라벨. 주일이 주 번호 없는 대축일이면 그 주 평일 독서가 속한 주를 따른다(사용자 결정 2026-11-27). 성령강림대축일의 평일은
 * 연중 주간이라(기도서 연중 주일 구간표) 「연중 7주」 같은 이름이다. 평일에도 주 번호가 없으면 `UNNUMBERED_SUNDAY_HEAD`다.
 * @param {ResolvedDate} sunday
 * @param {ResolvedDate | null} monday  그다음 월요일. 계산 범위 밖이면 null
 * @returns {string | null}
 */
function sundayWeekOf(sunday, monday) {
  const season = sunday.coord.season || "";
  return ownWeekOf(sunday) ?? ownWeekOf(monday) ?? /** @type {Record<string, string>} */ (UNNUMBERED_SUNDAY_HEAD)[season] ?? null;
}

/**
 * 그날이 속한 주의 이름 — 목록의 주간 라벨(ADR-060 §2). 주 번호가 있으면 그것이고, 주일은 `sundayWeekOf`, 주 번호가 없는 평일은 그 주
 * 주일의 주간 라벨를 잇는다. 주 중간에 절기가 바뀌어 주일과 절기가 다르면 `SEASON_HEAD`다(대림 4주 안의 성탄일은 「성탄 후 주간」, 재의
 * 수요일은 「사순 시작」).
 * @param {ResolvedDate} resolved
 * @param {ResolvedDate | null} sunday  그 주의 주일(그날이 주일이면 그날). 계산 범위 밖이면 null
 * @param {ResolvedDate | null} monday  그 주의 월요일. 계산 범위 밖이면 null
 * @returns {string}
 */
function weekLabelOf(resolved, sunday, monday) {
  const own = ownWeekOf(resolved);
  if (own) return own;
  const season = resolved.coord.season || "";
  if (sunday && (sunday === resolved || sunday.coord.season === season)) {
    const head = sundayWeekOf(sunday, monday);
    if (head) return head;
  }
  return /** @type {Record<string, string>} */ (SEASON_HEAD)[season] ?? "";
}

/**
 * 줄의 제목과 그 아래 줄(ADR-060 §2). 주간 라벨과 같은 평일 이름(「연중 34주」)은 적지 않고, 그 자리에 그날 기리는 성인이나 기념일을 올린다.
 * 올린 이름의 괄호 설명은 제목 아래 한 줄로 내린다(「클레멘트(로마의 주교, 순교자, 100년경) 축일」은 「클레멘트 축일」과 「로마의 주교, 순교자,
 * 100년경」). 대표가 아닌 이름 줄(교회 축성일, 옮겨 온 축일의 안내)은 그대로다.
 * @param {string} title  요일을 뺀 제목
 * @param {string[]} lines  제목 아래의 줄
 * @param {string} week  주간 라벨
 * @returns {{ title: string, lines: string[], raised: boolean }}
 */
function rowTitleOf(title, lines, week) {
  if (title !== week) return { title, lines, raised: false };
  // 세례명의 성인은 이름 줄이 아니라 다른 전례일의 줄에 있으므로(ADR-041 §5) 차례와 상관없이 첫 축일, 기념일 줄을 올린다
  const at = lines.findIndex((line) => / (?:축일|기념일)$/.test(line));
  if (at < 0) return { title: "", lines, raised: false };
  const rest = lines.filter((_, i) => i !== at);
  const paren = lines[at].match(/^(.+?)\((.+)\) (축일|기념일)$/);
  return paren
    ? { title: `${paren[1]} ${paren[3]}`, lines: [paren[2], ...rest], raised: true }
    : { title: lines[at], lines: rest, raised: true };
}

/**
 * 목록 줄 하나(ADR-060 §2, ADR-038 §2 「목록 보기」). 글은 전례독서 제목 영역과 같고(`headLinesOf`), 주간 라벨과 같은 평일 이름은 적지 않는다(`rowTitleOf`).
 * 해(「짝수해」, 「나해 시작」)와 색 이름은 줄에 적지 않는다. 색은 날짜 칸의 막대이고, 색 이름은 링크 이름에 싣는다. 선택 대체색은 싣지 않는다
 * (DESIGN.md §2). 장절은 전례독서 화면이 처음 보이는 독서(기본 전례일, 첫째 세트, 기억한 트랙)다.
 * @param {LectionaryModel} m
 * @param {string} today  "YYYY-MM-DD"
 * @param {string} week  그날이 속한 주의 이름(`weekLabelOf`)
 * @returns {ListRow}
 */
function listRowOf(m, today, week) {
  const { date } = m;
  const head = headLinesOf(m);
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(date));
  const weekday = dayOfWeek(date);
  const meta = head.meta.filter((item) => item.kind !== "cycle").map((item) => item.text);
  const shown = rowTitleOf(rowTextOf(head.title), [...head.notes, ...head.names, ...head.others.map(rowTextOf)], week);
  const { title, lines } = shown;
  const isToday = date === today;
  const colorNamesText = m.colors.map((c) => COLOR_LABEL[c] || c).join(m.colorsOr ? " 또는 " : " · ");
  const slots = m.slots || [];
  /** @type {ListReading[]} */
  const readings = slots.length
    ? [{ name: "감사성찬례", note: m.track ? TRACK_NAME[m.track] : null, refs: slots.map((s) => s.label).filter(Boolean) }]
    : [];
  const level = rowLevelOf(m) || (shown.raised ? "minor" : "");
  return {
    date, day: p.d, weekday: WEEKDAY_KO[weekday], isSunday: weekday === 0, week, href: `/lectionary/${date}`, isToday,
    level,
    title,
    colors: m.colors.map((c, i) => ({ code: c, name: COLOR_LABEL[c] || c, or: m.colorsOr && i > 0 })),
    meta, lines, readings,
    // 보이는 글을 모두 싣는다(WCAG 2.5.3). 색은 막대뿐이라 이름으로 싣는다.
    label: [
      isToday ? "오늘" : null, `${p.m}월 ${p.d}일 ${CAL_WEEKDAY_FULL[weekday]}`, title, colorNamesText, ...meta, ...lines,
      ...readings.map((r) => [r.name, r.note, r.refs.join(", ")].filter(Boolean).join(" ")),
    ].filter(Boolean).join(", "),
  };
}

/** 한 번에 더하고 내리는 줄 수(한 주, ADR-038 §2). */
const LIST_STEP_DAYS = 7;
/** 처음에 그리는 줄 — 주소의 날짜 앞 2주와 뒤 4주. */
const LIST_DAYS_BEFORE = 14;
const LIST_DAYS_AFTER = 28;
/** 화면에 두는 줄 수(약 200일, ADR-038 §2). */
const LIST_MAX_ROWS = 196;

/**
 * 그 날짜 바로 앞의 n일을 날짜 차례로. 계산 범위(1583-9999) 밖은 뺀다 — 범위 끝이면 빈 배열이다.
 * @param {string} date @param {number} n
 * @returns {string[]}
 */
function listDatesBefore(date, n) {
  /** @type {string[]} */
  const dates = [];
  for (let i = n; i >= 1; i--) {
    const d = addDays(date, -i);
    if (d !== null && isComputableDate(d)) dates.push(d);
  }
  return dates;
}

/**
 * 그 날짜 바로 뒤의 n일을 날짜 차례로. 계산 범위 밖은 뺀다.
 * @param {string} date @param {number} n
 * @returns {string[]}
 */
function listDatesAfter(date, n) {
  /** @type {string[]} */
  const dates = [];
  for (let i = 1; i <= n; i++) {
    const d = addDays(date, i);
    if (d !== null && isComputableDate(d)) dates.push(d);
  }
  return dates;
}

/**
 * 목록의 상단 바가 보이는 달(ADR-038 §2). ‹ ›는 앞뒤 달 1일의 줄, 오른쪽 단추는 그 달의 월간이다.
 * @param {number} y @param {number} m  1~12
 * @param {string} today  "YYYY-MM-DD"
 * @returns {ListMonth}
 */
function listMonthOf(y, m, today) {
  return {
    year: y, month: m, title: `${y}년 ${m}월`, shortTitle: `${y}.${String(m).padStart(2, "0")}`,
    hrefs: { prev: listStepPath(y, m, -1, today), next: listStepPath(y, m, 1, today), today: "/calendar/list", view: monthPathOf(y, m, today) },
  };
}

/**
 * 줄이 너무 많으면 보던 줄에서 먼 쪽부터 한 주씩 내린다(ADR-038 §2). 내릴 줄 수를 낸다.
 * @param {number} total  그려 둔 줄 수
 * @param {number} topIndex  상단 바 바로 아래 줄의 차례
 * @returns {{ above: number, below: number }}
 */
function listTrimOf(total, topIndex) {
  let above = topIndex;
  let below = total - topIndex - 1;
  const cut = { above: 0, below: 0 };
  while (above + below + 1 > LIST_MAX_ROWS) {
    if (above >= below) {
      const n = Math.min(LIST_STEP_DAYS, above);
      above -= n;
      cut.above += n;
    } else {
      const n = Math.min(LIST_STEP_DAYS, below);
      below -= n;
      cut.below += n;
    }
  }
  return cut;
}

// 날짜 고르기(ADR-038 §2 「날짜 고르기」): 상단 바의 달 제목이 여는 판의 세 단계. 날 판은 목록이 날까지 고를 때, 달 판은 월간이 처음 열 때와 날 판의
// 머리를 눌렀을 때, 해 판은 달 판의 머리를 눌렀을 때다. 캘린더의 계산 범위(1583-9999년) 밖으로는 옮기지 않는다.

/** 해 판 한 쪽의 해 수 — 네 칸씩 세 줄. */
const PICKER_YEAR_PAGE = 12;

/** 그달의 날 수. 그 날짜가 있는지는 엔진의 `parseDate`가 가린다(2월 29일은 윤년에만 있다). @param {number} y @param {number} m  1-12 */
function daysInMonth(y, m) {
  let d = 28;
  while (d < 31 && parseDate(toKey(y, m, d + 1))) d++;
  return d;
}

/**
 * 날 판: 그달의 날을 일요일부터 칸에 넣는다. 다른 달의 날은 비운다(null). 날마다 그날의 색(월간 칸의 점과 같다), 오늘인지, 지금 보는 날(목록의
 * 맨 위 줄)인지를 싣는다.
 * @param {number} y @param {number} m
 * @param {string} today  "YYYY-MM-DD"
 * @param {string | null} current  지금 보는 날
 * @param {(date: string) => string[]} colorsOf  그날의 색 코드
 * @returns {PickerDays}
 */
function pickerDays(y, m, today, current, colorsOf) {
  const lead = dayOfWeek(toKey(y, m, 1));
  /** @type {(PickerDay | null)[]} */
  const cells = Array.from({ length: lead }, () => null);
  const last = daysInMonth(y, m);
  for (let d = 1; d <= last; d++) {
    const date = toKey(y, m, d);
    cells.push({ date, day: d, weekday: (lead + d - 1) % 7, colors: colorsOf(date), isToday: date === today, isCurrent: date === current });
  }
  while (cells.length % 7) cells.push(null);
  return { y, m, title: `${y}년 ${m}월`, cells, prev: monthStep(y, m, -1), next: monthStep(y, m, 1) };
}

/**
 * 달 판: 그해의 열두 달. 지금 보는 달(월간은 그 달, 목록은 맨 위 줄의 달)과 오늘이 있는 달을 표시한다.
 * @param {number} y
 * @param {string} today  "YYYY-MM-DD"
 * @param {{ y: number, m: number } | null} current
 * @returns {PickerMonths}
 */
function pickerMonths(y, today, current) {
  const t = parseDate(today);
  /** @type {PickerCell[]} */
  const cells = [];
  for (let m = 1; m <= 12; m++) {
    cells.push({ y, m, label: `${m}월`, isToday: !!t && t.y === y && t.m === m, isCurrent: !!current && current.y === y && current.m === m });
  }
  return { title: `${y}년`, cells, prev: isComputableYear(y - 1) ? y - 1 : null, next: isComputableYear(y + 1) ? y + 1 : null };
}

/**
 * 해 판 한 쪽의 첫 해. 고른 해가 둘째 줄의 첫 칸에 오게 넷 앞에서 시작한다. 지난 몇 해보다 앞으로 올 해를 더 많이 보이려는 것이다.
 * 계산 범위의 끝에서는 범위 안으로 당긴다.
 * @param {number} y
 */
function pickerYearStart(y) {
  return Math.min(Math.max(y - 4, MIN_YEAR), MAX_YEAR - PICKER_YEAR_PAGE + 1);
}

/**
 * 해 판: `start`부터 열두 해. ‹ ›는 열두 해씩 옮기고, 계산 범위의 끝에서는 범위 안의 마지막 쪽에서 멈춘다.
 * @param {number} start  `pickerYearStart`의 값이나 앞뒤 쪽의 첫 해
 * @param {string} today  "YYYY-MM-DD"
 * @param {number | null} current  지금 보는 해
 * @returns {PickerYears}
 */
function pickerYears(start, today, current) {
  const t = parseDate(today);
  const last = start + PICKER_YEAR_PAGE - 1;
  /** @type {PickerCell[]} */
  const cells = [];
  for (let y = start; y <= last; y++) cells.push({ y, m: 0, label: String(y), isToday: !!t && t.y === y, isCurrent: y === current });
  return { title: `${start}-${last}년`, cells, prev: pickerYearStep(start, -1), next: pickerYearStep(start, 1) };
}

/**
 * 해 판에서 한 쪽 옮긴 첫 해. 열두 해씩 옮기되 계산 범위의 끝에서는 범위 안의 마지막 쪽에서 멈추고, 더 옮길 쪽이 없으면 null이다.
 * @param {number} start  지금 쪽의 첫 해 @param {-1 | 1} dir
 * @returns {number | null}
 */
function pickerYearStep(start, dir) {
  if (dir < 0) return start > MIN_YEAR ? Math.max(start - PICKER_YEAR_PAGE, MIN_YEAR) : null;
  return start + PICKER_YEAR_PAGE - 1 < MAX_YEAR ? Math.min(start + PICKER_YEAR_PAGE, MAX_YEAR - PICKER_YEAR_PAGE + 1) : null;
}
// ── END CALENDAR_MODEL ──

// ── DOM ──

// 달 이동(이전 · 다음 · 오늘)은 #app 을 통째로 다시 그린다(route() 가 스켈레톤으로 먼저 비운다). 누른 링크가 사라져 포커스가
// body로 빠지면 키보드 · 스크린 리더 사용자는 달을 넘길 때마다 건너뛰기 링크 · 헤더 · 탭부터 다시 지나와야 한다(WCAG 2.4.3 —
// PR #348 리뷰). 그 링크들은 `data-focus-key`(범위 끝에서 자리만 남는 앞뒤 단추는 `data-focus-fallback` 「오늘」도)만 달고,
// 라우터가 누른 자리를 재 두었다가 새 화면의 같은 컨트롤로 포커스를 돌려준다(routing.js — 전례독서 · 구분 탭 · 검색과 같다).

/** 지금 그려 둔 달 — 달이 바뀌었는지 `commitMonth`가 본다. @type {string | null} */
let committedMonth = null;

/** 같은 화면 안에서 달이 바뀌면 고정 문구(setTitle) 대신 그 달을 읽힌다 — 전례독서의 announceDay 와 같은 몫. */
function announceMonth(/** @type {CalendarMonth} */ model) {
  announce(`${model.title} ${PAGE_TITLE}`);
}

/**
 * 상단 바의 제목 자리에 달 이동 줄을 그린다 — 전례독서와 같은 줄이다(사용자 결정 2026-11-07). 달 제목은 날짜를 고르는 판을 여는 단추다
 * (ADR-038 §2 「날짜 고르기」).
 * @param {CalendarMonth | ListMonth} model
 * @param {"month" | "list"} view  지금 보기. 오른쪽 단추는 다른 보기로 간다
 */
function commitMonthBar(model, view) {
  // 폭이 모자라면 CSS가 짧은 표기를 보인다(사용자 결정 2026-11-05). 스크린 리더는 단추의 이름(전체 이름)을 읽는다.
  const month = el("span", { className: "cal-month" });
  month.appendChild(el("span", { className: "cal-month-full" }, model.title));
  month.appendChild(el("span", { className: "cal-month-short", "aria-hidden": "true" }, model.shortTitle));
  // 작은 화면의 달 제목은 글자이고, 오른쪽 단추가 월간 달력을 내린다(ADR-058 §3). 큰 화면은 달 제목이 판을 여는 단추다
  const small = isSmallLayout();
  const trigger = small ? calendarDropTrigger("") : datePickerTrigger(month);
  setPickerTrigger(trigger, model, view);
  trigger.addEventListener("click", (e) => openCalendarPicker(trigger, view, e.detail > 0));
  // 판이 열린 채 바를 다시 그리면(데스크톱 목록에서 팝오버 아래로 스크롤해 계산 범위 끝에 이른 때) 새 제목 단추를 판의 제목 단추로 삼는다.
  // 그러지 않으면 닫을 때 포커스를 돌려줄 곳과 팝오버의 자리를 잴 곳이 문서에서 빠진 단추다
  if (pickerState && picker?.overlay.isOpen && pickerState.view === view) {
    pickerState.trigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
  }
  // 이전 · 다음 달은 계산 범위 밖이면 자리만 지킨다
  commitDateBar({
    title: small ? month : trigger,
    todayHref: model.hrefs.today,
    prev: { href: model.hrefs.prev, label: "이전 달" },
    next: { href: model.hrefs.next, label: "다음 달" },
    view: small ? { trigger } : view === "month"
      ? { href: model.hrefs.view, label: "목록으로 보기", icon: HEADER_ICON_PATHS.viewList }
      : { href: model.hrefs.view, label: "월간으로 보기", icon: HEADER_ICON_PATHS.viewMonth },
  });
  if (pickerState?.trigger === trigger) placePicker();
}

// ── 날짜 고르기(ADR-038 §2 「날짜 고르기」, ADR-058 §3, DESIGN.md §6) ──
// 큰 화면에서는 상단 바의 달 제목이 여는 팝오버이고, 작은 화면에서는 오른쪽 단추가 상단 바 아래로 내리는 월간 달력이다. 같은 요소를 CSS가 바꾼다.
// 전례독서 화면도 같은 판을 연다(lectionary.js `openDatePicker`가 이 모듈의 `openCalendarPicker`를 부른다, 2026-11-18). 판은 한 번에 한 단계만
// 보인다. 날과 월간의 달은 링크라 고르면 라우터가 그 화면을 그리고(route()가 열린 판을 닫는다), 해와 목록, 전례독서의 달은 단추라 판 안에서 한 단계
// 아래로 내려간다. 판은 body 끝에 한 번 만들어 두고 다시 쓴다. 제목 칸(#page-title)은 `container-type`이 있어, 그 안에 두면 고정 위치(position: fixed)가
// 화면이 아니라 그 칸을 기준으로 잡힌다.

/** 팝오버와 제목 사이, 팝오버와 화면 가장자리 사이(px). */
const PICKER_POPOVER_GAP = 8;
/** 판 머리의 그림: 펼침 표시와 ‹ ›. */
const PICKER_ICON = { down: "m6 9 6 6 6-6", prev: "m15 18-6-6 6-6", next: "m9 18 6-6-6-6" };

/**
 * 판의 상태. `view`는 판을 연 화면(월간, 목록, 전례독서), `mode`는 지금 단계다. `y`와 `m`은 날 판과 달 판이 보이는 해와 달이고, `yearStart`는 해 판의 첫 해다.
 * `current`는 지금 보는 날(목록의 맨 위 줄, 전례독서의 그날)이라 월간은 null이고, `currentMonth`는 지금 보는 달이다. `pointer`는 마지막 입력이 손가락이나 마우스였는지다. 열 때 정하고, 판이 열린 동안
 * 누르거나 키를 칠 때마다 바꾼다(`ensurePicker`). 그래서 탭으로 열고 Esc로 닫으면 제목 단추에 포커스 테두리를 그린다.
 * @typedef {{
 *   view: PickerView, mode: "day" | "month" | "year", y: number, m: number, yearStart: number,
 *   current: string | null, currentMonth: { y: number, m: number }, today: string, trigger: HTMLElement, pointer: boolean,
 * }} PickerState
 */
/** 판을 연 화면. 월간은 해와 달까지, 목록과 전례독서는 날까지 고른다(ADR-038 §2 「날짜 고르기」). @typedef {"month" | "list" | "lectionary"} PickerView */
/** @type {PickerState | null} */
let pickerState = null;
/**
 * 한 번 만들어 두는 판의 요소와 오버레이 제어기(ADR-032).
 * @type {{
 *   panel: HTMLElement, scrim: HTMLElement, title: HTMLButtonElement, heading: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement, body: HTMLElement,
 *   overlay: { open: (returnFocusEl?: HTMLElement | null) => void, close: () => void, readonly isOpen: boolean },
 * } | null}
 */
let picker = null;
/** 작은 화면과 큰 화면의 경계를 넘어 판을 닫는 중이다. 달력과 팝오버는 자리가 다르므로 움직임 없이 닫는다. */
let layoutSwitching = false;

/**
 * 제목 단추가 여는 판의 달과 단추의 이름. 목록은 스크롤하면 맨 위 줄의 달로 바뀐다(`updateMonthBar`).
 * @param {HTMLElement} trigger @param {CalendarMonth | ListMonth} model @param {"month" | "list"} view
 */
function setPickerTrigger(trigger, model, view) {
  trigger.dataset.ym = `${String(model.year).padStart(4, "0")}-${String(model.month).padStart(2, "0")}`;
  trigger.setAttribute("aria-label", `${model.title}, ${view === "month" ? "해와 달 고르기" : "날짜 고르기"}`);
}

/** 그날의 색 코드. 월간 칸의 점과 같은 함수로 정한다(`calendarColorsOf`). 교회력 자료는 캘린더 화면이 이미 받아 두었다. @param {string} date */
function pickerColorsOf(date) {
  if (!isComputableDate(date)) return [];
  try {
    return calendarColorsOf(resolveDate(date));
  } catch (err) {
    console.warn("날짜 고르기: 그날의 색을 계산하지 못했습니다", err);
    return [];
  }
}

/** 판이 포커스를 둘 칸 — 지금 보는 것, 없으면 첫 칸. */
function pickerFocusTarget() {
  const body = picker?.body;
  if (!body) return null;
  return /** @type {HTMLElement | null} */ (body.querySelector('[aria-current="true"]') || body.querySelector("a[href], button"));
}

/**
 * 포커스를 옮긴다. 스크롤하지 않는다. 목록 화면은 스크롤 고정 때문에 상단 바 높이만큼 위쪽 여백(scroll-padding-top)을 두는데, 스크립트가 상단 바
 * 안의 제목 단추로 포커스를 옮기면 브라우저가 그 단추를 여백에 가려진 것으로 보고 페이지를 스크롤한다(known-issues §56). 마지막 입력이 손가락이나
 * 마우스였으면 포커스 테두리를 그리지 않는다. WebKit(iOS)은 탭한 뒤 스크립트가 옮긴 포커스에 테두리를 그린다(helpers.js `restoreFocusSpot`과 같다).
 * 판의 칸은 화면이 낮으면 판 안에서 스크롤하므로, 칸 안의 대상이 가려져 있으면 판의 칸만 스크롤해 보인다.
 * @param {HTMLElement | null | undefined} target
 */
function focusInPicker(target) {
  if (!target) return;
  target.focus(pickerState?.pointer ? { preventScroll: true, focusVisible: false } : { preventScroll: true });
  const body = picker?.body;
  if (!body || !body.contains(target)) return;
  const b = body.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  if (r.bottom > b.bottom) body.scrollTop += r.bottom - b.bottom;
  else if (r.top < b.top) body.scrollTop -= b.top - r.top;
}

/** 판의 머리 글을 알린다 — 단계를 바꾸거나 ‹ ›로 옮겼을 때. */
function announcePicker() {
  if (!picker) return;
  announce(picker.title.hidden ? picker.heading.textContent || "" : picker.title.textContent || "");
}

/**
 * 날 판의 날 하나. 목록에서 열었으면 그날의 줄을 맨 위에 두는 목록으로, 전례독서에서 열었으면 그날의 전례독서로 가는 링크다. 이름은 월간 칸처럼
 * 오늘, 날짜와 요일, 색이다.
 * @param {PickerDay} c @param {number} m @param {string} today  "YYYY-MM-DD" @param {PickerView} view
 */
function buildPickerDay(c, m, today, view) {
  const cls = ["cal-picker-day"];
  if (c.isCurrent) cls.push("is-selected");
  if (c.isToday) cls.push("is-today");
  const label = [c.isToday ? "오늘" : null, `${m}월 ${c.day}일 ${CAL_WEEKDAY_FULL[c.weekday]}`, c.colors.length ? colorNames(c.colors) : null]
    .filter(Boolean).join(", ");
  const a = el("a", { className: cls.join(" "), href: view === "lectionary" ? lectionaryPathOf(c.date, today) : listPathOf(c.date, today), "aria-label": label, "data-focus-key": DATE_PICKER_FOCUS_KEY });
  if (c.isCurrent) a.setAttribute("aria-current", "true");
  a.appendChild(el("span", { className: "cal-picker-num" }, String(c.day)));
  const dots = el("span", { className: "cal-picker-dots", "aria-hidden": "true" });
  for (const color of c.colors) dots.appendChild(el("span", { className: `cal-picker-dot lit-swatch lit-swatch--${color}` }));
  a.appendChild(dots);
  return a;
}

/** 날 판: 요일 머리가 있는 표. 다른 달의 날은 빈 칸이다. @param {PickerDays} days @param {string} today  "YYYY-MM-DD" @param {PickerView} view */
function buildPickerDays(days, today, view) {
  const table = el("table", { className: "cal-picker-days" });
  table.appendChild(el("caption", { className: "sr-only" }, days.title));
  const head = el("tr");
  for (const full of CAL_WEEKDAY_FULL) head.appendChild(el("th", { scope: "col", abbr: full }, full.slice(0, 1)));
  table.appendChild(el("thead", null, head));
  const rows = el("tbody");
  for (let i = 0; i < days.cells.length; i += 7) {
    const tr = el("tr");
    for (const c of days.cells.slice(i, i + 7)) tr.appendChild(el("td", null, c ? buildPickerDay(c, days.m, today, view) : null));
    rows.appendChild(tr);
  }
  table.appendChild(rows);
  return table;
}

/**
 * 달 판과 해 판의 칸 열둘. 월간의 달은 그 달로 가는 링크(`link`)이고, 이번 달은 날짜 없이 `/calendar`다(`monthPathOf`). 목록의 달(`month`)과
 * 해(`year`)는 판 안에서 한 단계 아래로 가는 단추다.
 * @param {PickerMonths | PickerYears} page @param {"link" | "month" | "year"} kind @param {string} today  "YYYY-MM-DD"
 */
function buildPickerCells(page, kind, today) {
  const grid = el("div", { className: "cal-picker-grid", role: "group", "aria-label": page.title });
  for (const c of page.cells) {
    const cls = ["cal-picker-cell"];
    if (c.isCurrent) cls.push("is-selected");
    if (c.isToday) cls.push("is-today");
    const label = kind === "year" ? `${c.y}년${c.isToday ? ", 올해" : ""}` : `${c.y}년 ${c.m}월${c.isToday ? ", 이번 달" : ""}`;
    /** @type {HTMLElement} */
    let node;
    if (kind === "link") {
      node = el("a", { className: cls.join(" "), href: monthPathOf(c.y, c.m, today), "aria-label": label, "data-focus-key": DATE_PICKER_FOCUS_KEY }, c.label);
    } else {
      node = el("button", { type: "button", className: cls.join(" "), "aria-label": label }, c.label);
      node.dataset[kind] = String(kind === "year" ? c.y : c.m);
    }
    if (c.isCurrent) node.setAttribute("aria-current", "true");
    grid.appendChild(node);
  }
  return grid;
}

/** 판을 지금 단계로 다시 그린다. 머리의 단추 요소는 그대로 두어, 그 단추를 누른 포커스가 사라지지 않는다. */
function renderPicker() {
  const s = pickerState;
  const p = picker;
  if (!s || !p) return;
  clearNode(p.body);
  p.body.scrollTop = 0;
  /** @type {PickerDays | PickerMonths | PickerYears} */
  let page;
  /** @type {[string, string]} */
  let stepLabels;
  if (s.mode === "day") {
    page = pickerDays(s.y, s.m, s.today, s.current, pickerColorsOf);
    stepLabels = ["이전 달", "다음 달"];
    p.body.appendChild(buildPickerDays(page, s.today, s.view));
    p.title.setAttribute("aria-label", `${page.title}, 달 고르기`);
  } else if (s.mode === "month") {
    page = pickerMonths(s.y, s.today, s.currentMonth);
    stepLabels = ["이전 해", "다음 해"];
    p.body.appendChild(buildPickerCells(page, s.view === "month" ? "link" : "month", s.today));
    p.title.setAttribute("aria-label", `${page.title}, 해 고르기`);
  } else {
    page = pickerYears(s.yearStart, s.today, s.currentMonth.y);
    stepLabels = ["이전 열두 해", "다음 열두 해"];
    p.body.appendChild(buildPickerCells(page, "year", s.today));
  }
  // 해 판의 머리는 더 올라갈 단계가 없어 글자만 둔다
  p.title.hidden = s.mode === "year";
  p.heading.hidden = s.mode !== "year";
  if (s.mode === "year") p.heading.textContent = page.title;
  else {
    clearNode(p.title);
    p.title.append(page.title, headerIcon(PICKER_ICON.down));
  }
  p.prev.disabled = page.prev === null;
  p.next.disabled = page.next === null;
  p.prev.setAttribute("aria-label", stepLabels[0]);
  p.next.setAttribute("aria-label", stepLabels[1]);
}

/** ‹ ›: 날 판은 한 달, 달 판은 한 해, 해 판은 열두 해씩 옮긴다. @param {-1 | 1} dir */
function stepPicker(dir) {
  const s = pickerState;
  const p = picker;
  if (!s || !p) return;
  if (s.mode === "day") {
    const to = monthStep(s.y, s.m, dir);
    if (!to) return;
    s.y = to.y;
    s.m = to.m;
  } else if (s.mode === "month") {
    if (!isComputableYear(s.y + dir)) return;
    s.y += dir;
  } else {
    const to = pickerYearStep(s.yearStart, dir);
    if (to === null) return;
    s.yearStart = to;
  }
  renderPicker();
  // 범위 끝이라 누른 단추를 더 누를 수 없게 되면 포커스가 사라지지 않게 맞은편 단추로 옮긴다
  if ((dir < 0 ? p.prev : p.next).disabled) focusInPicker(dir < 0 ? p.next : p.prev);
  announcePicker();
}

/**
 * 판의 자리. 큰 화면의 팝오버는 제목 아래 가운데에 두고 화면 밖으로 나가지 않게 당긴다. 작은 화면의 달력과 그 뒤 가림은 상단 바의 아래 끝에서
 * 시작한다. 화면이 낮으면 판을 화면 안에 두고 판의 칸만 스크롤한다(CSS `.cal-picker-body`).
 */
function placePicker() {
  const s = pickerState;
  const p = picker;
  if (!s || !p) return;
  if (!window.matchMedia(LARGE_LAYOUT_QUERY).matches) {
    const top = Math.max(Math.round(barBottom()), 0);
    p.panel.style.left = "";
    p.panel.style.top = p.scrim.style.top = `${top}px`;
    // 화면이 낮으면 판이 화면 아래까지 온다. 홈 표시줄의 자리는 비운다
    p.panel.style.maxHeight = `calc(${Math.max(window.innerHeight - top - PICKER_POPOVER_GAP, 0)}px - env(safe-area-inset-bottom, 0px))`;
    return;
  }
  p.scrim.style.top = "";
  const r = s.trigger.getBoundingClientRect();
  const half = p.panel.offsetWidth / 2;
  const center = Math.min(Math.max(r.left + r.width / 2, half + PICKER_POPOVER_GAP), window.innerWidth - half - PICKER_POPOVER_GAP);
  const top = Math.round(r.bottom + PICKER_POPOVER_GAP);
  p.panel.style.top = `${top}px`;
  p.panel.style.left = `${Math.round(center)}px`;
  p.panel.style.maxHeight = `${Math.max(window.innerHeight - top - PICKER_POPOVER_GAP, 0)}px`;
}

/** 자리와 높이 제한을 지운다. 다음에 열 때 다시 잰다. @param {HTMLElement} panel */
function clearPickerPlace(panel) {
  panel.style.top = "";
  panel.style.left = "";
  panel.style.maxHeight = "";
}

/** 판의 요소와 오버레이 제어기를 처음 쓸 때 만든다. */
function ensurePicker() {
  if (picker) return picker;
  const scrim = el("div", { className: "cal-picker-scrim", "aria-hidden": "true" });
  scrim.hidden = true;
  const panel = el("div", { className: "cal-picker", role: "dialog", "aria-modal": "true", "aria-label": "날짜 고르기" });
  panel.hidden = true;
  // 「닫기」는 화면에 보이지 않고 포커스를 받으면 나타난다. 달력 아이콘은 판이 열린 동안 막혀 있어(inert) 스크린 리더로는 다시 누를 수 없다.
  // 팝오버에서는 CSS가 숨긴다
  const close = el("button", { type: "button", className: "cal-picker-close sheet-close" }, "닫기");
  const title = /** @type {HTMLButtonElement} */ (el("button", { type: "button", className: "cal-picker-title" }));
  const heading = el("span", { className: "cal-picker-title" });
  heading.hidden = true;
  const prev = /** @type {HTMLButtonElement} */ (el("button", { type: "button", className: "cal-picker-step" }, headerIcon(PICKER_ICON.prev)));
  const next = /** @type {HTMLButtonElement} */ (el("button", { type: "button", className: "cal-picker-step" }, headerIcon(PICKER_ICON.next)));
  const head = el("div", { className: "cal-picker-head" }, title, heading, el("span", { className: "cal-picker-steps" }, prev, next));
  const body = el("div", { className: "cal-picker-body" });
  panel.append(head, body, close);
  document.body.append(scrim, panel);

  // 큰 화면 레이아웃이면 팝오버다. 다른 시트가 오른쪽 패널로 바뀌는 조건과 같다(helpers.js, ADR-050 §2, DESIGN.md §6)
  const large = window.matchMedia(LARGE_LAYOUT_QUERY);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let closeTimer;
  /** 시트가 닫히는 움직임이 끝나면 숨기는 처리. 움직임 중에 다시 열면 지운다. @type {(() => void) | null} */
  let closeDone = null;
  const cancelClosing = () => {
    clearTimeout(closeTimer);
    if (closeDone) panel.removeEventListener("animationend", closeDone);
    closeDone = null;
    panel.classList.remove("cal-picker-closing");
  };
  const overlay = window.appOverlay.createOverlay({
    panel,
    scrim,
    // 판이 열린 동안 상단 바도 막혀(inert) 제목 단추를 다시 누를 수 없다. 그 자리를 누르면 시트는 뒤 가림이, 팝오버는 바깥 누르기 처리가 판을 닫는다
    closeOnOutside: true,
    // 판이 열린 동안 막아 두는 뒤 화면. 책 고르기 시트와 같은 범위다(helpers.js `SHEET_INERT_SELECTORS`)
    inertSelectors: SHEET_INERT_SELECTORS,
    ariaExpanded: ".cal-picker-trigger",
    // 처음 포커스와 닫은 뒤의 포커스는 여기서 옮긴다. 제어기의 기본(`focus()`)은 스크롤하고 탭한 뒤에도 테두리를 그린다(`focusInPicker`)
    onOpen: () => {
      cancelClosing();
      placePicker();
      requestAnimationFrame(() => {
        if (overlay.isOpen) focusInPicker(pickerFocusTarget());
      });
    },
    onClose: () => {
      const trigger = pickerState?.trigger;
      if (trigger?.isConnected) focusInPicker(trigger);
    },
    // 작은 화면의 달력은 위로 미끄러져 닫힌다. 팝오버, 움직임을 줄인 설정, 작은 화면과 큰 화면의 경계를 넘을 때는 바로 닫는다
    closeTransition: (p, finalizeHide) => {
      if (layoutSwitching || large.matches || reduceMotion.matches) {
        finalizeHide();
        clearPickerPlace(p);
        return;
      }
      p.classList.add("cal-picker-closing");
      const done = () => {
        cancelClosing();
        finalizeHide();
      };
      closeDone = done;
      p.addEventListener("animationend", done);
      closeTimer = setTimeout(done, 350);
    },
  });

  close.addEventListener("click", () => overlay.close());
  // 마지막 입력을 적어 둔다. 닫은 뒤 제목 단추의 포커스 테두리는 연 입력이 아니라 이것으로 정한다(`focusInPicker`)
  document.addEventListener("pointerdown", () => { if (overlay.isOpen && pickerState) pickerState.pointer = true; }, true);
  document.addEventListener("keydown", () => { if (overlay.isOpen && pickerState) pickerState.pointer = false; }, true);
  title.addEventListener("click", () => {
    const s = pickerState;
    if (!s) return;
    if (s.mode === "day") s.mode = "month";
    else if (s.mode === "month") {
      s.mode = "year";
      s.yearStart = pickerYearStart(s.y);
    }
    renderPicker();
    focusInPicker(pickerFocusTarget());
    announcePicker();
  });
  prev.addEventListener("click", () => stepPicker(-1));
  next.addEventListener("click", () => stepPicker(1));
  // 해를 고르면 그해의 달 판, 목록에서 달을 고르면 그달의 날 판으로 내려간다
  body.addEventListener("click", (e) => {
    const s = pickerState;
    const cell = e.target instanceof Element ? e.target.closest("button[data-year], button[data-month]") : null;
    if (!s || !(cell instanceof HTMLElement)) return;
    // 다시 그리면 누른 칸이 판에서 빠지지만, 오버레이의 「바깥을 누르면 닫기」는 누른 때의 경로로 판 안을 가린다(overlay.js)
    if (cell.dataset.year) {
      s.y = Number(cell.dataset.year);
      s.mode = "month";
    } else {
      s.m = Number(cell.dataset.month);
      s.mode = "day";
    }
    renderPicker();
    focusInPicker(pickerFocusTarget());
    announcePicker();
  });
  // 날과 월간의 달은 링크다. 라우터가 그 화면으로 가기 전에 판을 닫아 포커스를 제목 단추로 돌려 둔다. 수정 키를 누른 클릭은 새 탭에서 열리고
  // 라우터가 이 화면을 바꾸지 않으므로 판을 그대로 둔다(라우터와 같은 조건, helpers.js `isModifiedClick`)
  panel.addEventListener("click", (e) => {
    if (isModifiedClick(e)) return;
    if (e.target instanceof Element && e.target.closest("a[href]")) overlay.close();
  });
  // 큰 화면에서 창 크기가 바뀌면 자리를 다시 잡는다. 레이아웃의 경계를 넘으면 아래의 change 처리가 판을 닫는다
  window.addEventListener("resize", () => {
    if (overlay.isOpen) placePicker();
  });
  picker = { panel, scrim, title, heading, prev, next, body, overlay };
  return picker;
}

/**
 * 제목 단추를 누르면 판을 연다. 월간은 달 판, 목록과 전례독서는 날 판으로 연다. 목록에서 지금 보는 날은 상단 바 바로 아래 줄이고,
 * 전례독서에서는 그 화면의 날(제목 단추의 `data-date`)이다. 전례독서 화면은 이 함수를 모듈을 불러온 뒤 부른다(lectionary.js `openDatePicker`).
 * @param {HTMLElement} trigger @param {PickerView} view
 * @param {boolean} pointer  손가락이나 마우스로 눌렀다(키보드면 false)
 */
function openCalendarPicker(trigger, view, pointer) {
  const p = ensurePicker();
  // 전례독서 화면은 판을 불러오는 사이 날짜를 두 번 누를 수 있다. 열린 판의 상태와 칸을 다시 만들지 않는다(코드 리뷰 2026-11-18)
  if (p.overlay.isOpen) return;
  const listRoot = view === "list" ? $app.querySelector(".cal-list") : null;
  const current = view === "lectionary" ? trigger.dataset.date || null
    : listRoot instanceof HTMLElement ? rowUnderBar(listRoot)?.dataset.date ?? null : null;
  const cp = current ? parseDate(current) : null;
  // 목록은 판의 달과 지금 보는 날을 같은 줄(맨 위 줄)에서 정한다. 상단 바의 달은 스크롤 뒤 다음 화면을 그릴 때 그 줄을 따라가므로(`followTopMonth`),
  // 그 사이에 누르면 앞의 달일 수 있다
  const [ty, tm] = (trigger.dataset.ym || "").split("-").map(Number);
  const y = cp ? cp.y : ty;
  const m = cp ? cp.m : tm;
  if (!y || !m) return;
  pickerState = {
    view, mode: view === "month" ? "month" : "day", y, m, yearStart: pickerYearStart(y),
    current, currentMonth: { y, m }, today: todayKey(new Date()), trigger, pointer,
  };
  // 판의 이름은 제목 단추가 알리는 일과 같게 한다. 월간은 해와 달까지만 고른다
  p.panel.setAttribute("aria-label", view === "month" ? "해와 달 고르기" : "날짜 고르기");
  renderPicker();
  p.overlay.open(null);
}

// 앱 전체의 Esc 처리(app.js)가 열린 판을 먼저 닫는다. 닫았으면 true다. 판이 없거나 닫히는 움직임 중이면 이미 닫혔으므로 false라 Esc가 다음 단계로 간다
window.closeCalendarPicker = () => {
  if (!picker?.overlay.isOpen) return false;
  picker.overlay.close();
  return true;
};

/** 색 점 줄 — 장식(aria-hidden). 색 이름은 링크 이름이 싣는다. @param {string[]} colors */
function buildDots(colors) {
  const dots = el("span", { className: "cal-dots", "aria-hidden": "true" });
  for (const c of colors) dots.appendChild(el("span", { className: `cal-dot lit-swatch lit-swatch--${c}` }));
  return dots;
}

/** @param {CalendarCell} cell */
function buildCell(cell) {
  const td = el("td", {});
  const cls = ["cal-cell"];
  if (!cell.inMonth) cls.push("cal-cell--out");
  if (cell.isToday) cls.push("cal-cell--today");
  const inner = cell.href
    ? el("a", { className: cls.join(" "), href: cell.href, "aria-label": cell.label })
    : el("span", { className: cls.join(" ") });
  if (cell.href && cell.isToday) inner.setAttribute("aria-current", "date");
  inner.appendChild(el("span", { className: "cal-date" }, String(cell.day)));
  if (cell.colors.length) inner.appendChild(buildDots(cell.colors));
  // 앞뒤 달의 칸은 이름을 싣지 않는다 — 그 달 화면에서 본다(링크 이름에는 남는다).
  // 전례년 첫날 표지는 칸 폭에 맞게 주기만(「나해」) — 「나해 시작」 전체는 title · 링크 이름 · 목록 줄에.
  if (cell.inMonth && cell.yearStart) inner.appendChild(el("span", { className: "cal-mark", title: cell.yearStart }, cell.cycle || cell.yearStart));
  if (cell.inMonth && cell.cellName) {
    const name = el("span", { className: "cal-name" }, cell.cellName);
    if (cell.cellTitle && cell.cellTitle !== cell.cellName) name.setAttribute("title", cell.cellTitle);
    inner.appendChild(name);
  }
  td.appendChild(inner);
  return td;
}

/** @param {CalendarMonth} model */
function buildMonthTable(model) {
  const table = el("table", { className: "cal-grid" });
  table.appendChild(el("caption", { className: "sr-only" }, `${model.title} ${PAGE_TITLE}`));
  const thead = el("thead", {});
  const hr = el("tr", {});
  WEEKDAY_KO.forEach((w, i) => hr.appendChild(el("th", { scope: "col", abbr: CAL_WEEKDAY_FULL[i] }, w)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el("tbody", {});
  for (const week of model.weeks) {
    const tr = el("tr", {});
    for (const cell of week) tr.appendChild(buildCell(cell));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/**
 * Commit the month view — synchronous, called only after the preload resolved and the route is still current.
 * @param {CalendarMonth} model
 */
function commitMonth(model) {
  stopList?.();
  commitLiturgicalTitle("calendar");   // 문서 제목(views.js)
  commitMonthBar(model, "month");
  clearNode($app);
  const root = el("div", { className: "calendar" });
  root.appendChild(buildMonthTable(model));
  $app.appendChild(root);
  // 달이 바뀌면 새 달은 맨 위부터 — 달 이동은 스크롤해도 보이는 머리에 있어 읽던 자리에서 누른다(전례독서의 날짜 이동과 같다).
  // 뒤로 가기와 탭 전환은 이 뒤에 떠날 때의 스크롤을 되살린다(tab-history.js onRouteEnd).
  const monthKey = `${model.year}-${model.month}`;
  if (monthKey !== committedMonth && window.scrollY !== 0) window.scrollTo({ top: 0, behavior: "instant" });
  committedMonth = monthKey;
  announceMonth(model);
}

/** 대재일, 소재일, 기도 주간. 없으면 null. @param {ListRow} row */
function buildRowMeta(row) {
  if (!row.meta.length) return null;
  const meta = el("span", { className: "cal-row-meta" });
  for (const text of row.meta) meta.appendChild(el("span", {}, text));
  return meta;
}

/**
 * 장절(ADR-060 §2) — 「감사성찬례」를 왼쪽에, 장절을 오른쪽에 둔다. 장절 하나는 중간에서 줄을 바꾸지 않는다. 링크 안이라 목록 요소(`dl`)를
 * 쓰지 않고 글자로 둔다. 읽는 차례는 링크 이름(`row.label`)이 맡는다.
 * @param {ListReading[]} readings
 */
function buildRowReadings(readings) {
  const box = el("span", { className: "cal-row-readings" });
  for (const r of readings) {
    const name = el("span", { className: "cal-row-office" }, r.name);
    if (r.note) name.appendChild(el("span", { className: "cal-row-track" }, r.note));
    const refs = el("span", { className: "cal-row-refs" });
    // 가운뎃점은 앞 장절에 붙여 줄 머리에 오지 않게 하고, 그 뒤의 빈칸에서 줄을 바꾼다
    r.refs.forEach((ref, i) => {
      const item = el("span", { className: "cal-row-ref" }, ref);
      if (i < r.refs.length - 1) {
        item.appendChild(el("span", { className: "cal-row-sep", "aria-hidden": "true" }, " ·"));
        refs.append(item, " ");
      } else refs.appendChild(item);
    });
    box.append(name, refs);
  }
  return box;
}

/** 줄 전체가 그날 전례독서로 가는 링크다(ADR-060 §2). @param {ListRow} row */
function buildRow(row) {
  const cls = ["cal-row"];
  if (row.level) cls.push(`cal-row--${row.level}`);
  if (row.isToday) cls.push("cal-row--today");
  const a = el("a", { className: cls.join(" "), href: row.href, "aria-label": row.label });
  if (row.isToday) a.setAttribute("aria-current", "date");
  const date = el("span", { className: "cal-row-date" });
  date.appendChild(el("span", { className: "cal-row-day" }, String(row.day)));
  const colors = el("span", { className: "cal-row-colors", "aria-hidden": "true" });
  for (const color of row.colors) colors.appendChild(el("span", { className: `cal-row-bar lit-swatch lit-swatch--${color.code}` }));
  date.appendChild(colors);
  date.appendChild(el("span", { className: "cal-row-weekday" }, row.weekday));
  a.appendChild(date);
  const body = el("span", { className: "cal-row-body" });
  if (row.title) body.appendChild(el("span", { className: "cal-row-title" }, row.title));
  const meta = buildRowMeta(row);
  if (meta) body.appendChild(meta);
  for (const line of row.lines) body.appendChild(el("span", { className: "cal-row-line" }, line));
  if (row.readings.length) body.appendChild(buildRowReadings(row.readings));
  a.appendChild(body);
  const li = el("li", { "data-date": row.date, "data-week": row.week });
  if (row.isSunday) li.dataset.sunday = "";
  li.appendChild(a);
  return li;
}

/**
 * 주 하나의 묶음 — 주간 라벨과 그 주의 줄 목록(ADR-060 §2). 라벨은 스크롤하면 상단 바 아래에 고정되고(CSS `position: sticky`), 묶음의
 * 마지막 줄이 지나가면 다음 묶음의 주간 라벨에 밀려 사라진다. 고정은 묶음 안에서만 되므로 주마다 묶음을 따로 둔다.
 * @param {string} week
 */
function buildWeekGroup(week) {
  const group = el("div", { className: "cal-week-group", "data-week": week });
  group.appendChild(el("h3", { className: "cal-week" }, week));
  group.appendChild(el("ul", { className: "cal-rows", role: "list" }));
  return group;
}

/**
 * 그 줄이 이 묶음에 이어지는가. 새 묶음(새 라벨)은 주일, 주 이름이 바뀐 줄, 달 묶음의 첫 줄에서 시작한다(ADR-060 §2).
 * @param {HTMLElement | null} group
 * @param {HTMLElement} li  더할 줄
 * @param {HTMLElement | null} after  그 묶음에서 더할 줄 바로 뒤에 오는 줄. 맨 뒤에 더하면 null
 */
function joinsGroup(group, li, after) {
  if (!group || group.dataset.week !== li.dataset.week) return false;
  return after ? !("sunday" in after.dataset) : !("sunday" in li.dataset);
}

/**
 * 그 날짜의 줄이 고정된 주간 라벨 바로 아래에 오게 스크롤한다. 달의 첫 줄이면 달 이름이 함께 보이게 달 이름부터 둔다. 데스크톱은 스크롤하면 상단 바가
 * 접히므로 접힌 뒤에 다시 맞추고, 그사이 독자가 스크롤을 시작하면 맞추지 않는다(helpers.js `scrollUnderBar`, 이어 읽기와 같다).
 * @param {string} date
 */
function scrollToRow(date) {
  const row = $app.querySelector(`li[data-date="${date}"]`);
  if (!row) return;
  const section = row.closest("section");
  if (section && section.querySelector("li[data-date]") === row) scrollUnderBar(section);
  else scrollUnderBar(row, weekHeadHeight(row.closest(".cal-list") ?? $app));
}

/** 달 하나의 묶음 — 달 이름과 주 묶음들. @param {string} ym  "YYYY-MM" @param {string} title */
function buildListSection(ym, title) {
  const section = el("section", { "aria-label": title, "data-month": ym });
  section.appendChild(el("h2", { className: "cal-list-month" }, title));
  return section;
}

/**
 * 줄을 맨 앞이나 맨 뒤에 더한다. 달이 바뀌면 달 묶음을, 주가 바뀌면 주 묶음을 새로 만든다.
 * @param {ListView} list
 * @param {string[]} dates  날짜 차례
 * @param {boolean} atStart
 */
function addListRows(list, dates, atStart) {
  for (const date of atStart ? [...dates].reverse() : dates) {
    const row = list.rowOf(date);
    if (!row) continue;
    const ym = date.slice(0, 7);
    let section = list.root.querySelector(`section[data-month="${ym}"]`);
    if (!section) {
      const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(date));
      section = buildListSection(ym, listMonthOf(p.y, p.m, list.today).title);
      if (atStart) list.above.after(section);
      else list.below.before(section);
    }
    const li = buildRow(row);
    const groups = section.querySelectorAll(":scope > .cal-week-group");
    let group = /** @type {HTMLElement | null} */ (atStart ? groups[0] ?? null : groups[groups.length - 1] ?? null);
    const after = atStart ? /** @type {HTMLElement | null} */ (group?.querySelector("li[data-date]") ?? null) : null;
    if (!joinsGroup(group, li, after)) {
      group = buildWeekGroup(row.week);
      const title = section.querySelector(":scope > .cal-list-month");
      if (atStart && title) title.after(group);
      else if (atStart) section.prepend(group);
      else section.append(group);
    }
    const rows = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (group).querySelector("ul"));
    if (atStart) rows.prepend(li);
    else rows.append(li);
  }
  if (!dates.length) return;
  if (atStart) list.first = dates[0];
  else list.last = dates[dates.length - 1];
}

/**
 * 고정된 주간 라벨의 높이. 라벨이 고정된 동안 그 아래가 보이는 자리의 시작이다(ADR-060 §2). 라벨은 모두 높이가 같다(CSS `--cal-week-h`).
 * @param {Element} root
 */
function weekHeadHeight(root) {
  return root.querySelector(".cal-week")?.getBoundingClientRect().height ?? 0;
}

/**
 * 상단 바 밑으로 이만큼만 보이는 줄은 보던 줄이 아니다. 줄을 상단 바 바로 아래에 두어도 소수점 값이 어긋나고, 웹 글꼴을 늦게 받으면 스크롤 고정이 지켜도
 * 약 2px 밀린다(2026-11-07 측정). 그 앞줄을 맨 위 줄로 치면 스크롤하지 않았는데 주소가 하루 앞날로 밀리고 달 이름이 앞달이 된다.
 */
const ROW_PEEK_PX = 8;

/** 상단 바와 고정된 주간 라벨 바로 아래의 달 묶음. @param {HTMLElement} root */
function sectionUnderBar(root) {
  const bottom = barBottom() + weekHeadHeight(root) + ROW_PEEK_PX;
  for (const section of root.querySelectorAll("section")) {
    if (section.getBoundingClientRect().bottom > bottom) return section;
  }
  return null;
}

/** 상단 바와 고정된 주간 라벨 바로 아래의 줄 — 「맨 위 줄」(ADR-038 §2, ADR-060 §2). @param {HTMLElement} root */
function rowUnderBar(root) {
  const bottom = barBottom() + weekHeadHeight(root) + ROW_PEEK_PX;
  for (const li of /** @type {NodeListOf<HTMLElement>} */ (sectionUnderBar(root)?.querySelectorAll("li[data-date]") ?? [])) {
    if (li.getBoundingClientRect().bottom > bottom) return li;
  }
  return null;
}

/**
 * 위쪽 줄을 바꾸는 동안 보던 줄을 그 자리에 둔다(ADR-038 §2). 스크롤 고정이 있는 브라우저는 스스로 지키므로 줄이 움직이지 않아 아무것도 고치지 않는다.
 * 다만 스크롤 값이 0이면 브라우저도 고치지 않아 여기서 고친다. 이 함수는 스크롤 중에도 실행되므로 같은 태스크 안에서만 잰다. 다음 프레임까지 기다리면
 * 그사이 독자가 움직인 만큼을 되돌린다.
 * @param {HTMLElement} root
 * @param {() => void} change
 */
function keepRowInPlace(root, change) {
  const row = rowUnderBar(root);
  const before = row?.getBoundingClientRect().top ?? 0;
  change();
  if (!row?.isConnected) return;
  const moved = row.getBoundingClientRect().top - before;
  if (moved) window.scrollBy({ top: moved, behavior: "instant" });
}

/**
 * 먼 줄을 내린다. 포커스가 있는 줄은 지킨다.
 * @param {ListView} list
 * @returns {boolean}  내렸으면 true
 */
function trimList(list) {
  const rows = /** @type {HTMLElement[]} */ (Array.from(list.root.querySelectorAll("li[data-date]")));
  const top = rows.indexOf(/** @type {HTMLElement} */ (rowUnderBar(list.root)));
  if (top < 0) return false;
  const cut = listTrimOf(rows.length, top);
  if (!cut.above && !cut.below) return false;
  const focused = rows.findIndex((li) => li.contains(document.activeElement));
  const above = focused >= 0 && focused < top ? Math.min(cut.above, focused) : cut.above;
  const below = focused > top ? Math.min(cut.below, rows.length - 1 - focused) : cut.below;
  keepRowInPlace(list.root, () => {
    for (const li of rows.slice(0, above)) li.remove();
    for (const li of rows.slice(rows.length - below)) li.remove();
    // 줄이 빈 주 묶음과 달 묶음을 지운다. 남은 묶음은 라벨을 지킨다. 위쪽을 내리면 남은 첫 줄의 묶음이 달 묶음의 첫 줄이 된다
    for (const group of list.root.querySelectorAll(".cal-week-group")) if (!group.querySelector("li[data-date]")) group.remove();
    for (const section of list.root.querySelectorAll("section")) if (!section.querySelector("li[data-date]")) section.remove();
  });
  list.first = rows[above].dataset.date ?? list.first;
  list.last = rows[rows.length - 1 - below].dataset.date ?? list.last;
  return above + below > 0;
}

/** 지금 그려 둔 목록. 다른 화면으로 가면 문서에서 빠진다. @type {ListView | null} */
let activeList = null;

/**
 * 스크롤을 따라 상단 바를 고친다. 다시 그리지 않고 글자와 주소만 바꿔, 누르던 단추와 포커스를 잃지 않는다. 계산 범위 끝에서는 단추가 자리만 남으므로
 * 통째로 다시 그린다. 라우터를 거치지 않으므로 포커스는 여기서 돌려준다. 사라진 단추에 있었으면 「오늘」로 간다(WCAG 2.4.3).
 * @param {ListMonth} model
 */
function updateMonthBar(model) {
  const bar = _$("page-title");
  const prev = bar.querySelector('a[data-focus-key="prev"]');
  const next = bar.querySelector('a[data-focus-key="next"]');
  if (!prev !== !model.hrefs.prev || !next !== !model.hrefs.next) {
    const active = document.activeElement;
    const spot = active && focusSpotOf(active, new Event("scroll"), null);
    commitMonthBar(model, "list");
    restoreFocusSpot(spot, null);
    return;
  }
  const full = bar.querySelector(".cal-month-full");
  const short = bar.querySelector(".cal-month-short");
  if (full) full.textContent = model.title;
  if (short) short.textContent = model.shortTitle;
  const trigger = bar.querySelector(".cal-picker-trigger");
  if (trigger instanceof HTMLElement) setPickerTrigger(trigger, model, "list");
  if (model.hrefs.prev) prev?.setAttribute("href", model.hrefs.prev);
  if (model.hrefs.next) next?.setAttribute("href", model.hrefs.next);
  bar.querySelector("a.title-view-btn")?.setAttribute("href", model.hrefs.view);
}

/** 목록의 문서 제목. @param {ListMonth} model */
function listTitleOf(model) {
  return `${model.title} ${PAGE_TITLE} 목록`;
}

/** 상단 바의 달과 문서 제목을 맨 위 줄의 달로 맞춘다(ADR-038 §2). @param {ListView} list */
function followTopMonth(list) {
  const ym = sectionUnderBar(list.root)?.dataset.month;
  if (!ym || ym === list.month) return;
  list.month = ym;
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(`${ym}-01`));
  const model = listMonthOf(p.y, p.m, list.today);
  updateMonthBar(model);
  document.title = `${listTitleOf(model)} — 공동번역성서`;
}

/**
 * 방문 기록 항목을 늘리지 않고 목록의 주소를 바꾼다. 탭과 앱 다시 열기도 이 주소로 돌아오게 함께 기억한다(ADR-038 §1). 주소를 바꿔도
 * 방문 통계는 늘지 않는다. 앱은 화면을 그릴 때만 방문을 보내고(`routing.js`의 `trackPageView`), 주소가 바뀌면 저절로 보내는 애널리틱스
 * 설정은 꺼 두었다(사용자 결정 2026-11-23, ADR-038 §2, pitfalls §43).
 * @param {string} path
 */
function replaceListAddress(path) {
  history.replaceState(history.state, "", path);
  window.tabHistory?.recordPath(path);
  window.tabHistory?.rememberCalendarView();
}

/**
 * 맨 위 줄이 바뀌었으면 주소에 남긴다(ADR-038 §2). 바뀌지 않았으면 주소를 건드리지 않아, 오늘을 보다 닫으면 다음 날 그날의 오늘 줄이 열린다. 앱을 켜 둔 채
 * 날이 바뀔 수 있으므로 오늘은 목록을 그린 때가 아니라 지금으로 잰다.
 * @param {ListView} list
 */
function saveTopRow(list) {
  const date = rowUnderBar(list.root)?.dataset.date;
  if (!date || date === list.top) return;
  list.top = date;
  replaceListAddress(listPathOf(date, todayKey(new Date())));
}

/** 경계가 화면에서 이만큼(줄 25개쯤) 가까워지면 줄을 더한다. */
const LIST_EDGE_MARGIN_PX = 2000;
/** 스크롤 이벤트가 이만큼 없으면 멈춘 것으로 본다. Safari 27 전의 iOS는 관성의 끝자락에 고쳐도 관성이 끊기므로 넉넉히 둔다. */
const LIST_SETTLE_MS = 200;
/** 스크롤이 끝났다는 이벤트(`scrollend`, Safari 26.2부터). 있으면 멈춤 판단에 함께 쓴다(`startListScroll`). */
const HAS_SCROLLEND = "onscrollend" in window;
/** `scrollend`가 오지 않아도 스크롤 이벤트가 이만큼 없으면 멈춘 것으로 본다. */
const LIST_MOVING_LIMIT_MS = 1000;

/** 지금 목록의 이어 붙이기를 멈춘다 — 목록을 다시 그리거나 월간으로 갈 때. @type {(() => void) | null} */
let stopList = null;

/**
 * 위아래로 이어 붙이기 시작한다(ADR-038 §2). 아래쪽은 스크롤 중에도 더한다. 위쪽은 스크롤 고정이 있는 브라우저에서 스크롤 값이 0보다 클 때만 스크롤 중에 더하고, 그 밖에는 스크롤이
 * 멈추고 손을 뗀 뒤에 더한다. Safari 27 전의 iOS는 관성 스크롤 중에 스크롤 값을 바꾸면 관성이 끊기기 때문이다(WebKit 버그 187449). 먼 줄 내리기는
 * 어느 브라우저에서나 멈춘 뒤에 한다. 멈춘 뒤에는 맨 위 줄을 주소에 남긴다. 데스크톱에서 상단 바가 접히는 동안에는 맨 위 줄이 달라 보이지만, 스크롤 고정이
 * 프레임마다 스크롤 값을 고쳐 스크롤 이벤트가 이어지므로 멈춤 판단은 접힌 뒤 줄을 다시 맞춘 다음에 실행된다(`scrollToRow`).
 * @param {ListView} list
 */
function startListScroll(list) {
  const { root, above, below } = list;
  const listeners = new AbortController();
  let wantAbove = false;
  let touching = false;
  let moving = false;
  let lastScrollAt = 0;
  let timer = 0;
  let frame = 0;

  /** 콜백은 한 번 나온 뒤 경계가 계속 가까워도 다시 나오지 않으므로, 다시 관찰해 다음 프레임의 콜백을 받는다. @param {HTMLElement} edge */
  const observeAgain = (edge) => {
    observer.unobserve(edge);
    observer.observe(edge);
  };
  const growBelow = () => {
    const dates = listDatesAfter(list.last, LIST_STEP_DAYS);
    if (!dates.length) {
      observer.unobserve(below);
      return;
    }
    addListRows(list, dates, false);
    observeAgain(below);
  };
  const growAbove = () => {
    const dates = listDatesBefore(list.first, LIST_STEP_DAYS);
    if (!dates.length) {
      observer.unobserve(above);
      return;
    }
    keepRowInPlace(root, () => addListRows(list, dates, true));
    observeAgain(above);
  };
  const stop = () => {
    listeners.abort();
    observer.disconnect();
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    if (stopList === stop) stopList = null;
  };
  // 낡은 라우트가 남기면 새 화면의 주소를 덮어쓴다. 다른 화면으로 가는 동안에는 이 목록이 아직 문서에 남아 있을 수 있다.
  const savePosition = () => {
    if (!root.isConnected) {
      stop();
      return;
    }
    if (!list.isStale()) saveTopRow(list);
  };
  const settled = () => {
    if (!root.isConnected) {
      stop();
      return;
    }
    if (touching) return;   // 손을 떼면 다시 잰다
    // 관성 스크롤의 끝자락은 스크롤 이벤트가 띄엄띄엄 와서 타이머만으로는 멈춘 것으로 잘못 볼 수 있다. `scrollend`가 있으면 그것을 기다린다.
    // 오지 않는 경우에 대비해, 스크롤 이벤트가 LIST_MOVING_LIMIT_MS 동안 없으면 멈춘 것으로 본다.
    if (moving && performance.now() - lastScrollAt < LIST_MOVING_LIMIT_MS) {
      armSettle();
      return;
    }
    moving = false;
    if (wantAbove) {
      wantAbove = false;
      growAbove();
    }
    if (trimList(list)) {
      // 범위 끝에서 관찰을 멈췄을 수 있다. 이미 관찰 중이면 아무 일도 없다.
      observer.observe(above);
      observer.observe(below);
    }
    savePosition();
  };
  const armSettle = () => {
    clearTimeout(timer);
    timer = window.setTimeout(settled, LIST_SETTLE_MS);
  };
  const observer = new IntersectionObserver((entries) => {
    // 다른 화면으로 가면 경계가 문서에서 빠져 콜백이 나온다. 여기서 정리한다.
    if (!root.isConnected) {
      stop();
      return;
    }
    for (const entry of entries) {
      if (entry.target === below) {
        if (entry.isIntersecting) growBelow();
      } else if (!entry.isIntersecting) {
        wantAbove = false;
      } else if (SCROLL_ANCHORING && window.scrollY > 0) {
        growAbove();
      } else {
        // 스크롤 값이 0 이하(맨 위, iOS에서 맨 위를 지나 튕기는 중)면 브라우저가 줄을 지키지 않아 코드가 스크롤 값을 고친다. 움직이는 중에 고치면
        // iOS가 고정 위치의 상단 바와 탭 바를 화면에서 떼어 내용과 함께 움직이므로(iOS 27.2, 2026-11-26) 멈춘 뒤로 미룬다
        wantAbove = true;
        armSettle();
      }
    }
  }, { rootMargin: `${LIST_EDGE_MARGIN_PX}px 0px` });

  const { signal } = listeners;
  window.addEventListener("scroll", () => {
    if (!root.isConnected) {
      stop();
      return;
    }
    if (HAS_SCROLLEND) moving = true;
    lastScrollAt = performance.now();
    armSettle();
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (root.isConnected) followTopMonth(list);
    });
  }, { passive: true, signal });
  window.addEventListener("scrollend", () => {
    moving = false;
    armSettle();
  }, { passive: true, signal });
  /** 손가락 하나를 떼도 이벤트가 나온다. 남은 손가락이 있으면 계속 기다린다. @param {TouchEvent} e */
  const release = (e) => {
    touching = e.touches.length > 0;
    if (!touching) armSettle();
  };
  window.addEventListener("touchstart", () => { touching = true; }, { passive: true, signal });
  window.addEventListener("touchend", release, { passive: true, signal });
  window.addEventListener("touchcancel", release, { passive: true, signal });
  // 스크롤이 멈추기 전에 누르거나, 화면을 떠나거나, 동기화로 받은 설정이 다시 그려도 남긴다. 캡처 단계라 링크가 주소를 옮기기 전에 지금 항목에 적는다.
  window.addEventListener("click", savePosition, { capture: true, signal });
  window.addEventListener("pagehide", savePosition, { signal });
  document.addEventListener("visibilitychange", savePosition, { signal });
  window.addEventListener("route:before-redraw", savePosition, { signal });
  observer.observe(above);
  observer.observe(below);
  stopList = stop;
}

/**
 * Commit the list view — synchronous, called only after both bundles are loaded and the route is still current.
 * @param {ListMonth} month  주소의 날짜가 있는 달
 * @param {string} anchor  "YYYY-MM-DD" — 상단 바 바로 아래에 둘 줄
 * @param {string} today  "YYYY-MM-DD"
 * @param {(date: string) => ListRow | null} rowOf
 * @param {() => boolean} isStale
 */
function commitList(month, anchor, today, rowOf, isStale) {
  stopList?.();
  commitLiturgicalTitle("calendar");   // 문서 제목(views.js)
  commitMonthBar(month, "list");
  clearNode($app);
  const root = el("div", { className: "calendar cal-list" });
  const above = el("div", { "aria-hidden": "true" });
  const below = el("div", { "aria-hidden": "true" });
  root.append(above, below);
  $app.appendChild(root);
  const dates = [...listDatesBefore(anchor, LIST_DAYS_BEFORE), anchor, ...listDatesAfter(anchor, LIST_DAYS_AFTER)];
  /** @type {ListView} */
  const list = { root, above, below, first: dates[0], last: anchor, month: anchor.slice(0, 7), today, top: anchor, rowOf, isStale };
  addListRows(list, dates, false);
  activeList = list;
  committedMonth = null;   // 월간으로 돌아가면 맨 위부터다
  scrollToRow(anchor);
  startListScroll(list);
  announce(listTitleOf(month));
  // 전례독서의 오른쪽 단추나 공유한 주소로 오늘 날짜의 줄을 열어도 오늘 줄의 주소로 맞춘다(ADR-038 §2)
  const path = listPathOf(anchor, today);
  if (location.pathname !== path) replaceListAddress(path);
}

/**
 * /calendar/list[/YYYY-MM-DD](ADR-038 §2 「목록 보기」). 줄의 글이 전례독서와 같아야 해서 독서 묶음도 받는다 — 월간은 받지 않는다.
 * @param {string | null} param  주소의 날짜 — null 이면 오늘
 * @param {string} today  "YYYY-MM-DD"
 * @param {() => boolean} isStale
 * @returns {Promise<string>}
 */
async function renderListView(param, today, isStale) {
  const anchor = param ?? today;
  const target = parseDate(anchor);
  if (!target || !isComputableDate(anchor)) {
    return renderLiturgicalFailure("calendar", {
      message: "잘못된 날짜입니다",
      subtitle: `주소는 /calendar/list/YYYY-MM-DD 형식이어야 합니다(${MIN_YEAR}년 ~ ${MAX_YEAR}년). 「${THIS_MONTH_LABEL}」를 눌러 주세요.`,
      action: "this-month",
    });
  }
  try {
    await Promise.all([preloadCalendar(), preloadLectionary()]);
  } catch (err) {
    if (isStale()) return PAGE_TITLE;
    console.error(err);
    return renderLiturgicalLoadFailure("calendar");
  }
  if (isStale()) return PAGE_TITLE;
  const month = listMonthOf(target.y, target.m, today);
  commitList(month, anchor, today, (date) => {
    const resolved = resolveDate(date);
    const m = resolved && lectionaryModelOf(resolved, { obs: null, track: null, set: null, collect: null });
    if (!m) return null;
    const sundayDate = addDays(date, -dayOfWeek(date));
    const resolveIn = (/** @type {string | null} */ d) => (d === date ? resolved : (d !== null && isComputableDate(d) ? resolveDate(d) : null));
    const sunday = resolveIn(sundayDate);
    const monday = resolveIn(sundayDate !== null ? addDays(sundayDate, 1) : null);
    return listRowOf(m, today, weekLabelOf(resolved, sunday, monday));
  }, isStale);
  window.tabHistory?.rememberCalendarView();
  return listTitleOf(month);
}

/**
 * Full-screen calendar view for /calendar[/YYYY-MM] and /calendar/list[/YYYY-MM-DD] (ADR-038 §2). Returns the page title for the router's page meta.
 * Data-first: nothing touches #app until the calendar bundle is loaded and the route is still the current one (ADR-031 guard).
 * @param {CalendarRoute} parsed
 * @returns {Promise<string>}
 */
async function renderCalendarView(parsed) {
  const routeSeq = window.routeSeq;   // 한 번 잡아 둔다 — 클로저 안에서도 타입이 좁혀지게
  const entrySeq = typeof routeSeq === "function" ? routeSeq() : null;
  const isStale = () => entrySeq !== null && typeof routeSeq === "function" && routeSeq() !== entrySeq;

  const today = todayKey(new Date());
  if (parsed.mode === "list") return renderListView(parsed.date, today, isStale);
  const target = parsed.month === null ? parseMonthParam(today.slice(0, 7)) : parseMonthParam(parsed.month);
  // 작은 화면의 캘린더는 목록 하나다(ADR-058 §1). `/calendar`는 오늘 줄, `/calendar/YYYY-MM`은 그 달 1일의 줄이고, 주소는 그 줄의 목록 주소가 된다
  if (target && isSmallLayout()) return renderListView(parsed.month === null ? null : toKey(target.y, target.m, 1), today, isStale);
  if (!target) {
    // 전체 화면 실패(DESIGN.md §6) — 다음 행동은 「이번 달 캘린더」(다른 화면으로 가므로 링크)
    return renderLiturgicalFailure("calendar", {
      message: "잘못된 날짜입니다",
      subtitle: `주소는 /calendar/YYYY-MM 형식이어야 합니다(${MIN_YEAR}년 ~ ${MAX_YEAR}년). 「${THIS_MONTH_LABEL}」를 눌러 주세요.`,
      action: "this-month",
    });
  }
  try {
    await preloadCalendar();
  } catch (err) {
    // 교회력 자료를 받지 못했다(오프라인 · 캐시 없음) — 낡은 요청이면 조용히 끝낸다(route() 가 새 화면을 그리고 있다).
    // 화면 모듈을 받지 못했을 때와 같은 실패 화면이다 — 「다시 불러오기」가 실패한 그 달을 다시 연다.
    if (isStale()) return PAGE_TITLE;
    console.error(err);
    return renderLiturgicalLoadFailure("calendar");
  }
  if (isStale()) return PAGE_TITLE;
  // 자료를 받는 사이 창이 작은 화면이 되었을 수 있다
  if (isSmallLayout()) return renderListView(parsed.month === null ? null : toKey(target.y, target.m, 1), today, isStale);
  const model = buildMonthGrid(target.y, target.m, today, resolveDate);
  commitMonth(model);
  window.tabHistory?.rememberCalendarView();   // 제대로 그린 보기만 기억한다 — 위의 실패 화면은 남지 않는다(ADR-038 §1)
  return `${model.title} ${PAGE_TITLE}`;
}

/**
 * 앱 화면이 작은 화면과 큰 화면의 경계를 넘으면(iPad에서 창을 나눌 때) 열린 판을 닫고 그 레이아웃의 캘린더로 바꾼다(ADR-058 §1). 목록은 두 레이아웃에
 * 있으므로 상단 바의 줄만 다시 그려 보던 줄이 그대로다. 월간은 작은 화면에 없으므로 라우터가 목록으로 다시 그린다. 포커스는 같은 단추로
 * 돌려주고, 그 레이아웃에 없는 단추였으면 날짜 고르기 단추로 간다(WCAG 2.4.3). 판을 먼저 닫는 것은 route()가 닫으면 닫는 움직임이 시작되기 때문이다.
 * 설정처럼 다른 창이 열려 있으면 route()가 그 창을 닫으므로, 창이 닫힌 뒤에 다시 그린다.
 */
function onLayoutChange() {
  const wasOpen = !!picker?.overlay.isOpen;
  layoutSwitching = true;
  picker?.overlay.close();
  layoutSwitching = false;
  // 전례독서의 줄은 lectionary.js가 먼저 다시 그려, 판을 연 단추가 이미 문서에 없다. 새 단추로 포커스를 돌려준다
  if (wasOpen && !pickerState?.trigger.isConnected) {
    focusInPicker(/** @type {HTMLElement | null} */ (_$("page-title").querySelector(".cal-picker-trigger")));
  }
  const here = window.parsePath?.();
  if (here?.view !== "calendar") return;
  if (!activeList?.root.isConnected || here.mode !== "list") {
    window.appOverlay.whenNoOverlayOpen(() => { void redrawForLayout(); });
    return;
  }
  const spot = layoutFocusSpot();
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(`${activeList.month}-01`));
  commitMonthBar(listMonthOf(p.y, p.m, activeList.today), "list");
  restoreFocusSpot(spot, null);
}

/**
 * 레이아웃이 바뀌기 전의 포커스 자리. 작은 화면에는 보기 전환 단추가 없다. 월간 칸처럼 돌려줄 자리(`data-focus-key`)가 없는 요소에 있었으면
 * 다시 그린 뒤 날짜 고르기 단추로 간다(WCAG 2.4.3).
 */
function layoutFocusSpot() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return null;
  // 새 단추는 전의 단추에 포커스 테두리가 있었을 때만 그린다. 누르거나 탭하면 테두리가 없고, 창 크기가 바뀐 것은 입력이 아니다
  const pointer = !active.matches(":focus-visible");
  const spot = focusSpotOf(active, new Event("resize"), null);
  if (spot) return { ...spot, fallback: spot.fallback ?? DATE_PICKER_FOCUS_KEY, pointer };
  if (!$app.contains(active) && !_$("page-title").contains(active)) return null;
  return { key: DATE_PICKER_FOCUS_KEY, fallback: null, y: window.scrollY, top: 0, offset: null, pointer };
}

/**
 * 지금 레이아웃의 캘린더로 다시 그린다. 다른 창이 닫히기를 기다리는 동안 다른 화면으로 갔으면 그리지 않는다. 읽는 분이 화면을 연 것이
 * 아니므로 방문은 보내지 않는다(ADR-038 §2).
 */
async function redrawForLayout() {
  if (window.parsePath?.().view !== "calendar") return;
  const spot = layoutFocusSpot();
  await window.route?.({ pageView: false });
  restoreFocusSpot(spot, null);
}
if (typeof window.matchMedia === "function") {
  window.matchMedia(LARGE_LAYOUT_QUERY).addEventListener("change", onLayoutChange);
}

// 전례독서 화면은 이 모듈을 부팅 때 받지 않고 날짜를 누를 때 불러와 판을 연다(lectionary.js `openDatePicker`, 보기 "lectionary")
export { renderCalendarView, buildMonthGrid, calendarDay, openCalendarPicker };
