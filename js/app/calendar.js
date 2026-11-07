// @ts-check
"use strict";

// Calendar tab (ADR-038 §1 · §2 — A2). The church calendar a month at a time at
// /calendar[/YYYY-MM], or as a list without ends at /calendar/list[/YYYY-MM-DD]:
// every day is a link to its lectionary page
// (/lectionary/YYYY-MM-DD — the A3 view), showing the day's representative name
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

/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").Candidate} Candidate */

import {
  parseDate, toKey, addDays, dayOfWeek, liturgicalYearOf, preloadCalendar, preloadLectionary, resolveDate,
  MIN_YEAR, MAX_YEAR, isComputableYear, isComputableDate,
} from "./liturgical-engine.js";
import {
  LITURGICAL_VIEWS, THIS_MONTH_LABEL, commitLiturgicalTitle, renderLiturgicalFailure, renderLiturgicalLoadFailure,
} from "./views.js";
import {
  shortName, statusSuffix, isGrid, todayKey, commitDateBar, headLinesOf, lectionaryModelOf,
  CYCLE_LABEL, COLOR_LABEL, WEEKDAY_KO,
} from "./lectionary.js";

const { _$, el, clearNode, HEADER_ICON_PATHS, SCROLL_ANCHORING, focusSpotOf, restoreFocusSpot } = window.appHelpers;

const $app = _$("app");
// 이름은 views.js에 있다 — 이 모듈을 받지 못했을 때 라우터가 같은 제목으로 실패 화면을 그린다.
const PAGE_TITLE = LITURGICAL_VIEWS.calendar.title;

/** parsePath 가 /calendar 에서 내는 서술자(routing.js PARSE_PATH — 정의는 types.d.ts `Route`). @typedef {import("../types").CalendarRoute} CalendarRoute */
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
/**
 * 목록 줄 하나 — 순수 함수 `listRowOf` 의 반환.
 * @typedef {{
 *   date: string, day: number, weekday: string, href: string, isToday: boolean, level: "major" | "minor" | "",
 *   title: string, colors: { code: string, name: string, or: boolean }[], meta: string[], mark: string | null, lines: string[], label: string,
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
 * @typedef {{
 *   root: HTMLElement, above: HTMLElement, below: HTMLElement, first: string, last: string, month: string, today: string,
 *   rowOf: (date: string) => ListRow | null,
 * }} ListView
 */
/** 전례독서 모델. @typedef {import("./lectionary.js").LectionaryModel} LectionaryModel */

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

/** "/calendar/YYYY-MM" — 계산 범위 밖이면 null(이전/다음 단추가 사라진다). @param {number} y @param {number} m */
function monthHref(y, m) {
  const yy = m < 1 ? y - 1 : m > 12 ? y + 1 : y;
  const mm = m < 1 ? 12 : m > 12 ? 1 : m;
  if (!isComputableYear(yy)) return null;
  return `/calendar/${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
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
  const colors = Array.isArray(resolved.colors) && resolved.colors.length ? resolved.colors.slice()
    : (resolved.color ? [resolved.color] : []);
  const coord = resolved.coord;
  const cycleCode = coord && coord.type === "sunday" ? coord.year : null;
  const cycle = cycleCode && CYCLE_LABEL[cycleCode] ? CYCLE_LABEL[cycleCode] : null;
  // 전례년은 대림 1주일 — 주일 — 에 바뀌므로 주기가 있는 날(주일)만 앞날과 견준다. 42칸마다 두 번씩 셈하지 않게.
  const prev = cycle ? addDays(date, -1) : null;
  const yearStart = prev !== null && liturgicalYearOf(prev) !== liturgicalYearOf(date) ? `${cycle} 시작` : null;
  return {
    date, day, weekday,
    href: `/lectionary/${date}`,
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
 * 월간 표(ADR-038 §2): 그달 1일이 든 주의 일요일부터 6주 42칸. 앞뒤 달의 칸도 같은 링크다(흐리게 · 이름 없이 —
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
      row.push({ ...d, inMonth: !!p && p.y === y && p.m === m, isToday, label: dayAriaLabel(d, isToday) });
    }
    weeks.push(row);
  }
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  return {
    year: y, month: m, title: `${y}년 ${m}월`, shortTitle: `${y}.${String(m).padStart(2, "0")}`, weeks,
    hrefs: {
      prev: monthHref(y, m - 1), next: monthHref(y, m + 1), today: "/calendar",
      // 보던 달을 유지한다. 이번 달은 오늘 줄이고 다른 달은 그 달 1일의 줄이다(ADR-038 §2).
      view: today.slice(0, 7) === key ? "/calendar/list" : `/calendar/list/${key}-01`,
    },
  };
}

/** 그 달 1일의 목록 주소 — 계산 범위 밖이면 null(이전/다음 단추가 사라진다). @param {number} y @param {number} m */
function listHref(y, m) {
  const month = monthHref(y, m);
  return month && `${month.replace("/calendar/", "/calendar/list/")}-01`;
}

/**
 * 목록 줄의 굵기 — 주일과 대축일, 주요축일이 가장 굵고 축일이 그다음이며 평일은 보통 굵기다. 모든 날을 보이므로 주일과 축일을 찾기 쉽게 한다.
 * 글꼴이 400, 500, 700을 받으므로 이 셋만 쓴다(DESIGN.md §3).
 * @param {LectionaryModel} m
 * @returns {"major" | "minor" | ""}
 */
function rowLevelOf(m) {
  const rank = m.selected.observance.rank;
  if (m.resolved.coord.type === "sunday" || rank === "principal" || rank === "privileged_sunday" || rank === "major_feast" || rank === "sunday") return "major";
  return rank === "minor_feast" || rank === "regional_festival" ? "minor" : "";
}

/**
 * 목록 줄 하나(ADR-038 §2 「목록 보기」, 사용자 결정 2026-11-07). 글은 전례독서 제목 영역과 같고(`headLinesOf`), 다른 전례일은 줄 전체가
 * 링크라 누를 수 없는 글이다. 선택 대체색은 싣지 않는다(DESIGN.md §2). 전례년 첫날은 해 대신 「나해 시작」을 단다.
 * @param {LectionaryModel} m
 * @param {string} today  "YYYY-MM-DD"
 * @returns {ListRow}
 */
function listRowOf(m, today) {
  const { date } = m;
  const head = headLinesOf(m);
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(date));
  const weekday = dayOfWeek(date);
  const mark = calendarDay(date, m.resolved).yearStart;
  const meta = head.meta.filter((item) => !(mark && item.kind === "cycle")).map((item) => item.text);
  const lines = [...head.notes, ...head.names, ...head.others];
  const isToday = date === today;
  const colorNamesText = m.colors.map((c) => COLOR_LABEL[c] || c).join(m.colorsOr ? " 또는 " : " · ");
  return {
    date, day: p.d, weekday: WEEKDAY_KO[weekday], href: `/lectionary/${date}`, isToday,
    level: rowLevelOf(m),
    title: head.title,
    colors: m.colors.map((c, i) => ({ code: c, name: COLOR_LABEL[c] || c, or: m.colorsOr && i > 0 })),
    meta, mark, lines,
    // 보이는 글을 모두 싣는다(WCAG 2.5.3). 색은 점뿐이 아니라 이름으로도 읽힌다.
    label: [isToday ? "오늘" : null, `${p.m}월 ${p.d}일 ${CAL_WEEKDAY_FULL[weekday]}`, head.title, colorNamesText, ...meta, mark, ...lines]
      .filter(Boolean).join(", "),
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
  const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
  return {
    year: y, month: m, title: `${y}년 ${m}월`, shortTitle: `${y}.${String(m).padStart(2, "0")}`,
    hrefs: {
      prev: listHref(y, m - 1), next: listHref(y, m + 1), today: "/calendar/list",
      view: today.slice(0, 7) === key ? "/calendar" : `/calendar/${key}`,
    },
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
 * 상단 바의 제목 자리에 달 이동 줄을 그린다 — 전례독서와 같은 줄이다(사용자 결정 2026-11-07).
 * @param {CalendarMonth | ListMonth} model
 * @param {string} icon  오른쪽 단추의 아이콘 — 누르면 갈 보기
 */
function commitMonthBar(model, icon) {
  // 폭이 모자라면 CSS가 짧은 표기를 보인다(사용자 결정 2026-11-05). 스크린 리더는 언제나 전체 이름을 읽는다.
  const month = el("span", { className: "cal-month" });
  month.appendChild(el("span", { className: "cal-month-full" }, model.title));
  month.appendChild(el("span", { className: "cal-month-short", "aria-hidden": "true" }, model.shortTitle));
  // 이전 · 다음 달은 계산 범위 밖이면 자리만 지킨다
  commitDateBar({
    title: month,
    todayHref: model.hrefs.today,
    prev: { href: model.hrefs.prev, label: "이전 달" },
    next: { href: model.hrefs.next, label: "다음 달" },
    view: icon === HEADER_ICON_PATHS.viewList
      ? { href: model.hrefs.view, label: "목록으로 보기", icon }
      : { href: model.hrefs.view, label: "월간으로 보기", icon },
  });
}

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
  commitMonthBar(model, HEADER_ICON_PATHS.viewList);
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

/** 색 점과 이름. @param {ListRow} row */
function buildRowMeta(row) {
  const meta = el("span", { className: "cal-row-meta" });
  for (const color of row.colors) {
    if (color.or) meta.appendChild(el("span", {}, "또는"));
    const item = el("span", { className: "cal-row-color" });
    item.appendChild(el("span", { className: `cal-row-dot lit-swatch lit-swatch--${color.code}`, "aria-hidden": "true" }));
    item.appendChild(document.createTextNode(color.name));
    meta.appendChild(item);
  }
  for (const text of row.meta) meta.appendChild(el("span", {}, text));
  if (row.mark) meta.appendChild(el("span", { className: "cal-mark" }, row.mark));
  return meta;
}

/** 줄 전체가 그날 전례독서로 가는 링크다. @param {ListRow} row */
function buildRow(row) {
  const cls = ["cal-row"];
  if (row.level) cls.push(`cal-row--${row.level}`);
  if (row.isToday) cls.push("cal-row--today");
  const a = el("a", { className: cls.join(" "), href: row.href, "aria-label": row.label });
  if (row.isToday) a.setAttribute("aria-current", "date");
  const date = el("span", { className: "cal-row-date" });
  date.appendChild(el("span", { className: "cal-row-day" }, String(row.day)));
  date.appendChild(el("span", { className: "cal-row-weekday" }, row.weekday));
  a.appendChild(date);
  const body = el("span", { className: "cal-row-body" });
  body.appendChild(el("span", { className: "cal-row-title" }, row.title));
  body.appendChild(buildRowMeta(row));
  for (const line of row.lines) body.appendChild(el("span", { className: "cal-row-line" }, line));
  a.appendChild(body);
  const li = el("li", { "data-date": row.date });
  li.appendChild(a);
  return li;
}

/** 목록을 연 뒤 상단 바가 접히기를 기다리는 시간. 전환 0.25초에 스크롤 감지를 늦게 시작하는 시간(views.js initCompactHeader)을 더했다. */
const BAR_COLLAPSE_WAIT_MS = 1000;

/** 상단 바의 아래쪽 — 화면 위에서 잰 값이다. 데스크톱은 스크롤하면 윗줄이 접혀 값이 바뀐다(views.js initCompactHeader). */
function barBottom() {
  return document.getElementById("sticky-group")?.getBoundingClientRect().bottom ?? 0;
}

/**
 * 그 날짜의 줄이 상단 바 바로 아래에 오게 스크롤한다. 달의 첫 줄이면 달 이름이 함께 보이게 달 이름부터 둔다. 데스크톱은 스크롤하면 상단 바가 접히므로
 * 접힌 뒤에 다시 맞춘다. 스크롤 고정이 있는 브라우저는 접히는 동안 줄을 화면의 그 자리에 두어 상단 바와 줄 사이가 벌어진다. 그사이 독자가 스크롤을
 * 시작하면 맞추지 않는다.
 * @param {string} date
 */
function scrollToRow(date) {
  const row = $app.querySelector(`li[data-date="${date}"]`);
  if (!row) return;
  const target = row.previousElementSibling ? row : row.closest("section") ?? row;
  const place = () => {
    if (!target.isConnected) return;
    window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - barBottom(), behavior: "instant" });
  };
  place();
  requestAnimationFrame(place);
  const waiting = new AbortController();
  const { signal } = waiting;
  const stop = () => waiting.abort();
  const collapsing = document.getElementById("breadcrumb-row");
  collapsing?.addEventListener("transitionend", (e) => {
    if (e.target !== collapsing) return;   // 안의 검색창이 낸 전환은 보지 않는다
    stop();
    place();
  }, { signal });
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(type, stop, { passive: true, signal });
  }
  setTimeout(stop, BAR_COLLAPSE_WAIT_MS);
}

/** 달 하나의 묶음 — 달 이름과 줄 목록. @param {string} ym  "YYYY-MM" @param {string} title */
function buildListSection(ym, title) {
  const section = el("section", { "aria-label": title, "data-month": ym });
  section.appendChild(el("h2", { className: "cal-list-month" }, title));
  section.appendChild(el("ul", { className: "cal-rows", role: "list" }));
  return section;
}

/**
 * 줄을 맨 앞이나 맨 뒤에 더한다. 달이 바뀌면 달 묶음을 새로 만든다.
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
    const rows = /** @type {HTMLElement} */ (section.querySelector("ul"));
    if (atStart) rows.prepend(buildRow(row));
    else rows.append(buildRow(row));
  }
  if (!dates.length) return;
  if (atStart) list.first = dates[0];
  else list.last = dates[dates.length - 1];
}

/** 상단 바 바로 아래의 달 묶음. 소수점 값이 어긋나도 이전 달이 잡히지 않게 1px을 둔다. @param {HTMLElement} root */
function sectionUnderBar(root) {
  const bottom = barBottom() + 1;
  for (const section of root.querySelectorAll("section")) {
    if (section.getBoundingClientRect().bottom > bottom) return section;
  }
  return null;
}

/** 상단 바 바로 아래의 줄. @param {HTMLElement} root */
function rowUnderBar(root) {
  const bottom = barBottom() + 1;
  for (const li of sectionUnderBar(root)?.querySelectorAll("li") ?? []) {
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
    for (const section of list.root.querySelectorAll("section")) {
      if (!section.querySelector("li")) section.remove();
    }
  });
  list.first = rows[above].dataset.date ?? list.first;
  list.last = rows[rows.length - 1 - below].dataset.date ?? list.last;
  return above + below > 0;
}

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
    commitMonthBar(model, HEADER_ICON_PATHS.viewMonth);
    restoreFocusSpot(spot, null);
    return;
  }
  const full = bar.querySelector(".cal-month-full");
  const short = bar.querySelector(".cal-month-short");
  if (full) full.textContent = model.title;
  if (short) short.textContent = model.shortTitle;
  if (model.hrefs.prev) prev?.setAttribute("href", model.hrefs.prev);
  if (model.hrefs.next) next?.setAttribute("href", model.hrefs.next);
  bar.querySelector(".title-view-btn")?.setAttribute("href", model.hrefs.view);
}

/** 상단 바의 달을 맨 위 줄의 달로 맞춘다(ADR-038 §2). @param {ListView} list */
function followTopMonth(list) {
  const ym = sectionUnderBar(list.root)?.dataset.month;
  if (!ym || ym === list.month) return;
  list.month = ym;
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(`${ym}-01`));
  updateMonthBar(listMonthOf(p.y, p.m, list.today));
}

/** 경계가 화면에서 이만큼(줄 25개쯤) 가까워지면 줄을 더한다. */
const LIST_EDGE_MARGIN_PX = 2000;
/** 스크롤 이벤트가 이만큼 없으면 멈춘 것으로 본다. `scrollend`는 Safari 26.2부터라 쓰지 않는다. Safari 27 전의 iOS는 관성의 끝자락에 고쳐도 관성이 끊기므로 넉넉히 둔다. */
const LIST_SETTLE_MS = 200;

/** 지금 목록의 이어 붙이기를 멈춘다 — 목록을 다시 그리거나 월간으로 갈 때. @type {(() => void) | null} */
let stopList = null;

/**
 * 위아래로 이어 붙이기 시작한다(ADR-038 §2). 아래쪽은 스크롤 중에도 더한다. 위쪽은 스크롤 고정이 있는 브라우저에서만 스크롤 중에 더하고, 없으면 스크롤이
 * 멈추고 손을 뗀 뒤에 더한다. Safari 27 전의 iOS는 관성 스크롤 중에 스크롤 값을 바꾸면 관성이 끊기기 때문이다(WebKit 버그 187449). 먼 줄 내리기는
 * 어느 브라우저에서나 멈춘 뒤에 한다.
 * @param {ListView} list
 */
function startListScroll(list) {
  const { root, above, below } = list;
  const listeners = new AbortController();
  let wantAbove = false;
  let touching = false;
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
  const settled = () => {
    if (!root.isConnected) {
      stop();
      return;
    }
    if (touching) return;   // 손을 떼면 다시 잰다
    if (wantAbove) {
      wantAbove = false;
      growAbove();
    }
    if (trimList(list)) {
      // 범위 끝에서 관찰을 멈췄을 수 있다. 이미 관찰 중이면 아무 일도 없다.
      observer.observe(above);
      observer.observe(below);
    }
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
      } else if (SCROLL_ANCHORING) {
        growAbove();
      } else {
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
    armSettle();
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (root.isConnected) followTopMonth(list);
    });
  }, { passive: true, signal });
  /** 손가락 하나를 떼도 이벤트가 나온다. 남은 손가락이 있으면 계속 기다린다. @param {TouchEvent} e */
  const release = (e) => {
    touching = e.touches.length > 0;
    if (!touching) armSettle();
  };
  window.addEventListener("touchstart", () => { touching = true; }, { passive: true, signal });
  window.addEventListener("touchend", release, { passive: true, signal });
  window.addEventListener("touchcancel", release, { passive: true, signal });
  observer.observe(above);
  observer.observe(below);
  stopList = stop;
}

/**
 * Commit the list view — synchronous, called only after both bundles are loaded and the route is still current.
 * @param {ListMonth} month  주소의 날짜가 든 달
 * @param {string} anchor  "YYYY-MM-DD" — 상단 바 바로 아래에 둘 줄
 * @param {string} today  "YYYY-MM-DD"
 * @param {(date: string) => ListRow | null} rowOf
 */
function commitList(month, anchor, today, rowOf) {
  stopList?.();
  commitLiturgicalTitle("calendar");   // 문서 제목(views.js)
  commitMonthBar(month, HEADER_ICON_PATHS.viewMonth);
  clearNode($app);
  const root = el("div", { className: "calendar cal-list" });
  const above = el("div", { "aria-hidden": "true" });
  const below = el("div", { "aria-hidden": "true" });
  root.append(above, below);
  $app.appendChild(root);
  const dates = [...listDatesBefore(anchor, LIST_DAYS_BEFORE), anchor, ...listDatesAfter(anchor, LIST_DAYS_AFTER)];
  /** @type {ListView} */
  const list = { root, above, below, first: dates[0], last: anchor, month: anchor.slice(0, 7), today, rowOf };
  addListRows(list, dates, false);
  committedMonth = null;   // 월간으로 돌아가면 맨 위부터다
  scrollToRow(anchor);
  startListScroll(list);
  announce(`${month.title} ${PAGE_TITLE} 목록`);
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
    return m ? listRowOf(m, today) : null;
  });
  window.tabHistory?.rememberCalendarView();
  return `${month.title} ${PAGE_TITLE} 목록`;
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
  const model = buildMonthGrid(target.y, target.m, today, resolveDate);
  commitMonth(model);
  window.tabHistory?.rememberCalendarView();   // 제대로 그린 보기만 기억한다 — 위의 실패 화면은 남지 않는다(ADR-038 §1)
  return `${model.title} ${PAGE_TITLE}`;
}

export { renderCalendarView, buildMonthGrid, calendarDay };
