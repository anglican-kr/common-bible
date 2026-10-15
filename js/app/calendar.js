// @ts-check
"use strict";

// Calendar tab (ADR-038 §1 · §2 — A2). The church calendar a month at a time at
// /calendar[/YYYY-MM]: every day is a link to its lectionary page
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
//   다른 후보, 주일 · 고유명 평일(성주간 월~수 · 재의 수요일 후 목~토)은 격자 이름. 나머지 후보는 주간 · 목록 줄과
//   전례독서 화면의 칩에서 본다.
//   선택 봉헌(「옮겨 지킬 수 있음」)은 월간 칸에 보이지 않는다 — 주간 · 목록 줄의 보조 이름으로.
//   전례년이 바뀌는 날(대림 1주일)에 「나해 시작」 꼴 표지(설계서 미결3 — 엔진의 liturgicalYearOf 로 가른다).
//   독서 성구는 달력에 싣지 않는다(설계서 미결41) — 독서 묶음(1.6MB)을 달력에서 받지 않으려고.
//   탭 이름 · 화면 제목은 「캘린더」(사용자 「"교회력"은 "캘린더"로」 2026-10-15) — 교회력 자체를 말하는 문구는 그대로.

/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").Candidate} Candidate */

import { parseDate, toKey, addDays, dayOfWeek, liturgicalYearOf, preloadCalendar, resolveDate } from "./liturgical-engine.js";
import { setTitle } from "./views.js";
import {
  shortName, statusSuffix, isGrid, todayKey,
  CYCLE_LABEL, COLOR_LABEL, WEEKDAY_KO, MIN_YEAR, MAX_YEAR,
} from "./lectionary.js";

const { _$, el, clearNode, emptyState, isModifiedClick } = window.appHelpers;

const $app = _$("app");
const PAGE_TITLE = "캘린더";

/**
 * parsePath 가 /calendar 에서 내는 서술자(routing.js PARSE_PATH). `month` 가 null 이면 이번 달.
 * @typedef {{ view: "calendar", mode: "month", month: string | null }} CalendarRoute
 */
/**
 * 이름 하나 — 줄(주간 · 목록)의 이름 줄 원소. `away` 는 그날 지키지 않는 후보(옮겨 감 · 생략)라 흐리게 그린다.
 * @typedef {{ name: string, title: string, suffix: string, away: boolean }} CalendarName
 */
/**
 * 교회력 하루 — 월간 칸 · 주간 줄 · 목록 줄이 같이 쓰는 표시 단위(`calendarDay` 의 반환).
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
 *   year: number, month: number, title: string, weeks: CalendarCell[][],
 *   hrefs: { prev: string | null, next: string | null, today: string },
 * }} CalendarMonth
 */

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
 * "YYYY-MM" → {y, m}. 형식이 틀리거나 교회력을 계산하는 연도(1583~9999) 밖이면 null.
 * @param {string | null | undefined} s
 * @returns {{ y: number, m: number } | null}
 */
function parseMonthParam(s) {
  if (typeof s !== "string") return null;
  const mt = s.match(/^(\d{4})-(\d{2})$/);
  if (!mt) return null;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  if (m < 1 || m > 12 || y < MIN_YEAR || y > MAX_YEAR) return null;
  return { y, m };
}

/** "/calendar/YYYY-MM" — 계산 범위 밖이면 null(이전/다음 단추가 사라진다). @param {number} y @param {number} m */
function monthHref(y, m) {
  const yy = m < 1 ? y - 1 : m > 12 ? y + 1 : y;
  const mm = m < 1 ? 12 : m > 12 ? 1 : m;
  if (yy < MIN_YEAR || yy > MAX_YEAR) return null;
  return `/calendar/${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

/**
 * 고유명 평일인가 — 성주간 월 · 화 · 수 · 재의 수요일 후 목 · 금 · 토(설계서 §5.5 — 좌표가 (lent, null, weekday)
 * 로 같아 격자 관측일의 이름이 그 이름이다). 성 목 · 금 · 토도 같은 좌표지만 그날은 temporal 행이 대표다.
 * @param {ResolvedDate} resolved
 */
function isNamedWeekday(resolved) {
  const c = resolved.coord;
  return !!c && c.type === "weekday" && c.season === "lent" && c.week === null;
}

/** 그날 지키지 않는 후보 — 다른 날로 옮겨 감 · 생략. 줄에서 흐리게 그린다(이름은 남긴다 — 「후보 전부 노출」). */
function isAwayCandidate(/** @type {Candidate} */ c) {
  return c.status === "transferred_out" || c.status === "omitted";
}

/**
 * 월간 칸에 이름을 다는 후보(사용자 결정 2026-10-15): 대표가 격자가 아니면 대표. 격자면 주일 · 고유명 평일은
 * 그 격자(「연중 29주일」 · 「성주간 월요일」), 그 밖의 평일은 그날 지키는 이름 있는 후보(사계재 · 기념일) — 없으면
 * 이름 없는 평일이라 null(칸에는 날짜와 색 점만).
 * @param {ResolvedDate} resolved
 * @returns {Candidate | null}
 */
function cellCandidateOf(resolved) {
  const official = resolved.official || null;
  if (!official) return null;
  if (!isGrid(official)) return official;
  if (resolved.coord && resolved.coord.type === "sunday") return official;
  if (isNamedWeekday(resolved)) return official;
  return resolved.candidates.find((c) => !isGrid(c) && !isAwayCandidate(c) && c.status !== "optional") || null;
}

/**
 * 월간 칸에 쓰는 짧은 이름 — `shortName` 에 더해 번호 붙은 주일은 「대림1주」 꼴로 줄인다(ADR-038 §2 「격자 좌표는 주일만
 * `대림1주` 표기」): 「연중 32주일」 → 「연중32주」 · 「대림1주일」 → 「대림1주」. 폰의 칸 폭(약 4글자)에 한 줄로 들어간다.
 * 번호 없는 주일(성지주일 · 삼위일체 주일)과 평일 이름은 그대로. 줄(주간 · 목록)과 링크 이름은 줄이지 않은 이름이다.
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
 * - 칸 이름: `cellCandidateOf` 하나 — 괄호 설명을 뗀 이름(칩과 같은 `shortName`), 전체 이름은 `cellTitle`, 그 후보의
 *   상태 꼬리(「· 10월 18일에서 옮겨 옴」 · 「· 기념일」)는 `cellSuffix` — 칸에는 보이지 않고 링크 이름에 붙는다.
 * - 줄: 첫 이름은 그날의 대표(격자 평일도 이름이 있다 — 「연중 28주 금요일」), 그 밖의 이름 있는 후보(격자 제외)를
 *   후보 순서대로 — 상태 꼬리(「· 10월 18일에서 옮겨 옴」 · 「· 기념만」 · 「· 옮겨 지킬 수 있음」)를 칩과 같은 말로.
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
 * 사계재 날 「추계재」) — 보이는 글자가 접근 가능한 이름 안에 있어야 음성 제어가 그 글자로 누르고 스크린리더도 보이는 이름을
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
 * DOM 이 가린다). 계산 범위(1583~9999) 밖의 칸은 날짜만 있고 링크가 없다 — 그 날짜는 `resolve` 를 부르지 않는다.
 * `resolve` 는 엔진 `resolveDate`(프리로드 뒤 동기)다 — 연도 캐시가 있어 42번 불러도 부활절 계산은 해마다 한 번이다
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
      const inRange = !!p && p.y >= MIN_YEAR && p.y <= MAX_YEAR;
      const d = calendarDay(date, inRange ? resolve(date) : null);
      const isToday = date === today;
      row.push({ ...d, inMonth: !!p && p.y === y && p.m === m, isToday, label: dayAriaLabel(d, isToday) });
    }
    weeks.push(row);
  }
  return {
    year: y, month: m, title: `${y}년 ${m}월`, weeks,
    hrefs: { prev: monthHref(y, m - 1), next: monthHref(y, m + 1), today: "/calendar" },
  };
}
// ── END CALENDAR_MODEL ──

// ── DOM ──

// 달 이동(이전 · 다음 · 오늘)은 #app 을 통째로 다시 그린다(route() 가 스켈레톤으로 먼저 비운다). 누른 링크가 사라져 포커스가
// body 로 빠지면 키보드 · 스크린리더 사용자는 달을 넘길 때마다 건너뛰기 링크 · 헤더 · 탭부터 다시 지나와야 한다(WCAG 2.4.3 —
// PR #348 리뷰). 누른 컨트롤의 자리(data-focus-key)를 기억했다가 새 머리 줄의 같은 자리로 포커스를 돌려준다(views.js 의
// focusPendingBook 과 같은 꼴 — 다시 그리기 전에 자리만 남긴다).
/** @type {string | null} */
let pendingFocusKey = null;

/** 달 이동 줄의 클릭 — 새 탭으로 여는 클릭은 이 화면을 다시 그리지 않으므로 기억하지 않는다. @param {MouseEvent} e */
function rememberFocusKey(e) {
  if (isModifiedClick(e)) return;
  const a = e.target instanceof Element ? e.target.closest("a[data-focus-key]") : null;
  pendingFocusKey = a instanceof HTMLElement ? a.dataset.focusKey || null : null;
}

/** 같은 화면 안에서 달이 바뀌면 고정 문구(setTitle) 대신 그 달을 읽힌다 — 전례독서의 announceDay 와 같은 몫. */
function announceMonth(/** @type {CalendarMonth} */ model) {
  announce(`${model.title} ${PAGE_TITLE}`);
}

/** 머리 줄 — 제목 + 성서 목록 집 단추(데스크톱 — 모바일은 탭 바가 대신해 CSS 가 숨긴다; 설정 · 북마크 탭 화면과 같다). */
function commitTitle() {
  setTitle(PAGE_TITLE);
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  window.hideAudioBar?.();
}

/** @param {string} msg @param {string} [subtitle] */
function commitError(msg, subtitle) {
  commitTitle();
  clearNode($app);
  const panel = el("div", { className: "calendar" });
  panel.appendChild(emptyState({ icon: null, title: msg, subtitle: subtitle || "" }));
  panel.appendChild(el("p", { className: "cal-error-link" }, el("a", { className: "lect-today", href: "/calendar" }, "이번 달 캘린더")));
  $app.appendChild(panel);
}

/**
 * 이전 · 다음 달 원형 링크 — 계산 범위 밖이면 자리만 지킨다(가운데가 흔들리지 않게).
 * @param {string | null} href @param {string} label @param {string} glyph @param {string} focusKey
 */
function buildStep(href, label, glyph, focusKey) {
  if (!href) return el("span", { className: "lect-datenav-btn", "aria-hidden": "true" });
  return el("a", { className: "lect-datenav-btn", href, "aria-label": label, "data-focus-key": focusKey }, glyph);
}

/** @param {CalendarMonth} model */
function buildMonthHead(model) {
  const head = el("header", { className: "cal-head" });
  const nav = el("nav", { className: "lect-datenav", "aria-label": "달 이동" });
  nav.appendChild(buildStep(model.hrefs.prev, "이전 달", "‹", "prev"));
  const mid = el("div", { className: "lect-date" });
  mid.appendChild(el("h2", { className: "cal-month" }, model.title));
  mid.appendChild(el("a", { className: "lect-today", href: model.hrefs.today, "data-focus-key": "today" }, "오늘"));
  nav.appendChild(mid);
  nav.appendChild(buildStep(model.hrefs.next, "다음 달", "›", "next"));
  // 이 줄의 클릭이 전역 <a> 인터셉터(document)보다 먼저 닿는다 — 이동이 시작되기 전에 자리를 남긴다.
  nav.addEventListener("click", rememberFocusKey);
  head.appendChild(nav);
  return head;
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
  // 전례년 첫날 표지는 칸 폭에 맞게 주기만(「나해」) — 「나해 시작」 전체는 title · 링크 이름 · 주간 · 목록 줄에.
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
 * @param {string | null} focusKey  the month-nav control that led here (rememberFocusKey) — focus goes back to its twin
 */
function commitMonth(model, focusKey) {
  commitTitle();
  clearNode($app);
  const root = el("div", { className: "calendar" });
  root.appendChild(buildMonthHead(model));
  root.appendChild(buildMonthTable(model));
  $app.appendChild(root);
  announceMonth(model);
  if (focusKey) {
    // 계산 범위 끝(1583년 1월의 이전 · 9999년 12월의 다음)에서는 그 단추가 자리만 남으므로 「오늘」로.
    const target = root.querySelector(`[data-focus-key="${focusKey}"]`) || root.querySelector('[data-focus-key="today"]');
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
  }
}

/**
 * Full-screen calendar view for /calendar[/YYYY-MM] (ADR-038 §2). Returns the page title for the router's page meta.
 * Data-first: nothing touches #app until the calendar bundle is loaded and the route is still the current one (ADR-031 guard).
 * @param {CalendarRoute} parsed
 * @returns {Promise<string>}
 */
async function renderCalendarView(parsed) {
  const routeSeq = window.routeSeq;   // 한 번 잡아 둔다 — 클로저 안에서도 타입이 좁혀지게
  const entrySeq = typeof routeSeq === "function" ? routeSeq() : null;
  const isStale = () => entrySeq !== null && typeof routeSeq === "function" && routeSeq() !== entrySeq;
  // 달 이동 줄에서 왔으면 그 컨트롤의 자리 — 한 번만 쓴다(오류 화면 · 낡은 요청이면 버린다).
  const focusKey = pendingFocusKey;
  pendingFocusKey = null;

  const today = todayKey(new Date());
  const target = parsed.month === null ? parseMonthParam(today.slice(0, 7)) : parseMonthParam(parsed.month);
  if (!target) {
    commitError("잘못된 날짜입니다", `주소는 /calendar/YYYY-MM 꼴이어야 합니다(${MIN_YEAR}년 ~ ${MAX_YEAR}년).`);
    return PAGE_TITLE;
  }
  try {
    await preloadCalendar();
  } catch (err) {
    // 교회력 자료를 받지 못했다(오프라인 · 캐시 없음) — 낡은 요청이면 조용히 끝낸다(route() 가 새 화면을 그리고 있다).
    if (isStale()) return PAGE_TITLE;
    console.error(err);
    commitError("교회력 자료를 불러오지 못했습니다", "네트워크 연결을 확인한 뒤 다시 열어 주세요.");
    return PAGE_TITLE;
  }
  if (isStale()) return PAGE_TITLE;
  const model = buildMonthGrid(target.y, target.m, today, resolveDate);
  commitMonth(model, focusKey);
  return `${model.title} ${PAGE_TITLE}`;
}

export { renderCalendarView, buildMonthGrid, calendarDay };
