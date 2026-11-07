// @ts-check
"use strict";

// Lectionary reading view (ADR-038 §3 — A3). Renders one day's eucharistic
// propers at /lectionary[/YYYY-MM-DD]: collect(s) → first reading → psalm →
// second reading → gospel, with the observance switcher (every candidate with
// text of its own as a link row under the title — `official` is only the initial pick) and the reading cards
// (every day with an 「또는」 alternative or a track — they fold into pills or numbers). The engine decides what the day IS
// (resolveDate · findReadings · findCollects — ADR-037 §6, design §5); this
// module only decides what to SHOW and draws it. Rendering follows
// bookmark-read.js (ADR-035): load every chapter JSON first → staleness check →
// synchronous DOM commit through views.js `appendVerses`.
//
// State rides in the URL (ADR-038 §3): `/lectionary/<date>?obs=&track=&set=&collect=`.
// Every control is a link, so the global <a> interceptor (routing.js) does the
// navigation and the back button / deep links / keyboard all work unchanged.
//
// 뷰가 처음 부딪힌 설계서 §9 미결 — 사용자가 하나씩 확정했다(2026-10-12, coding-pitfalls §21 · 원장
// docs/changes/2026-10-12-lectionary-view.md):
//   미결25 고유 독서 없는 축일의 초기 독서 = 격자(그날의 주일 · 평일) 독서 — 책자대로. 헤더 제목은 고른 전례일, 색은 고른
//          본문의 색(headerColors — 격자면 그날의 병기 colors + 대체색), 본기도는 고른 전례일의 것. (닫힘)
//   미결20 성 토요일 · 성탄 밤: 저녁 전례 — 엔진이 부활밤(성 토요일 저녁) · 성탄 밤(12.24 저녁)을 그날의 대표에서 빼고
//          후보 끝에 `evening` 으로 싣는다(사용자 결정 2026-10-15, 닫힘). 전례독서 목록의 상태 표시 「· 저녁」, 헤더 색은 「고른 본문의 색」
//          — 성 토요일(그날의 대표)은 홍, 부활밤을 누르면 백.
//   미결38 대안 세트: 「또는」 대안과 트랙은 달라지는 항목 수와 상관없이 독서 카드로 통째로 고른다(사용자 결정 2026-11-05), 조건부는
//          「…로 지킬 때」가 카드 이름, 괄호 선택 구절 세트는 바탕 세트에 합쳐 긴 본문 + 〔 〕 표시. (닫힘)
//   미결42 전례독서 목록의 이름은 괄호 설명을 뗀 이름이고, 전체 이름은 title 속성. 주기와 독서 N은 붙이지 않는다 — 제목 아래 줄과
//          독서 카드에 있다(2026-11-04). (닫힘)

/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").Candidate} Candidate */
/** @typedef {import("../types").ReadingGroup} ReadingGroup */
/** @typedef {import("../types").ReadingSlot} ReadingSlot */
/** @typedef {import("../types").CollectOption} CollectOption */
/** @typedef {import("../types").CandidateCollects} CandidateCollects */
/** @typedef {import("../types").BibleChapter} BibleChapter */

import { loadChapter } from "./data-fetch.js";
import {
  appendVerses, bindCopyAttribution, formatVerseRanges, absentVerseNumbers,
  LITURGICAL_VIEWS, THIS_MONTH_LABEL, commitLiturgicalTitle, renderLiturgicalFailure, renderLiturgicalLoadFailure,
} from "./views.js";
import { specCoversVerse, verseInstanceKeys, citationSource } from "./verse-spec.js";
import {
  parseDate, toKey, addDays, dayOfWeek, isComputableDate, joinNames, fillCommonName,
  preloadCalendar, preloadLectionary, resolveDate, findReadings, findCollects, findHalfVerse, findDedications, fastOf, isEmber,
  optionalDestOf,
} from "./liturgical-engine.js";

const { _$, el, clearNode, emptyState, isModifiedClick, headerIcon, HEADER_ICON_PATHS } = window.appHelpers;
const { loadLectionaryTrack, saveLectionaryTrack, loadLectionaryCardsFolded, saveLectionaryCardsFolded, loadLectionaryAltShow } = window.appStorage;

const $app = _$("app");
// 머리의 제목(<h1>) — 이 화면은 그 자리에 날짜 이동 줄을 그린다(commitTitleDateNav).
const $title = _$("page-title");
/** 마지막으로 그린 날짜 — 날짜가 바뀐 다시 그리기만 맨 위에서 시작한다(commit). @type {string | null} */
let committedDate = null;
// 이름은 views.js에 있다 — 이 모듈을 받지 못했을 때 라우터가 같은 제목으로 실패 화면을 그린다.
const PAGE_TITLE = LITURGICAL_VIEWS.lectionary.title;
// 이 화면의 링크(날짜 이동 · 전례독서 목록 · 독서 카드)는 #app을 통째로 다시 그린다 — 그 링크들은 `data-focus-key`만 달고, 라우터가
// 누른 자리를 재 두었다가 새 화면의 같은 컨트롤로 포커스를 돌려준다(WCAG 2.4.3 — routing.js, 캘린더 · 구분 탭 · 검색과 같다).

/** parsePath 가 /lectionary 에서 내는 서술자(routing.js PARSE_PATH — 정의는 types.d.ts `Route`). @typedef {import("../types").LectionaryRoute} LectionaryRoute */
/** URL 쿼리에서 온 상태 — 넷 다 없을 수 있다. @typedef {{ obs: string | null, track: 1 | 2 | null, set: number | null, collect: number | null }} LectionaryQuery */
/** 제목 아래 전례독서 목록의 줄 하나(후보 하나, 세트와 본기도가 짝지어진 후보는 세트 하나) — `name`은 괄호 설명을 뗀 이름, `suffix`는 상태 표시. @typedef {{ candidate: Candidate, name: string, suffix: string, title: string, href: string, active: boolean }} LectionaryChoice */
/** 화면의 「독서」 선택지 하나 — `short` 는 괄호 선택 구절 세트에 합쳐진 짧은 바탕 세트(〔 〕 표시의 기준). @typedef {{ group: ReadingGroup, short: ReadingGroup | null, label: string }} ReadingOption */
/**
 * 독서 카드 한 장 — 고를 수 있는 독서 한 벌(ADR-038 §3 「대안 세트·트랙 전환」). `refs`는 그 독서의 모든 항목이고, `differs`는 다른
 * 카드와 성구가 다른 항목이다. `focusKey`는 다시 그린 뒤 포커스를 돌려줄 자리(`track:N`, `set:N`)다. 트랙이 없는 날은 `track`이 null이다.
 * @typedef {{ name: string, refs: Array<{ label: string, differs: boolean }>, href: string, active: boolean, focusKey: string, track: 1 | 2 | null }} ReadingCard
 */
/**
 * 뷰가 그리는 것 전부 — 순수 함수 `buildLectionaryModel` 의 반환. DOM 은 이것만 읽는다.
 * @typedef {{
 *   date: string, resolved: ResolvedDate, selected: Candidate, initial: Candidate, dayName: string,
 *   groups: ReadingGroup[], tracks: Array<1 | 2>, track: 1 | 2 | null, cards: ReadingCard[] | null,
 *   options: ReadingOption[], setIndex: number, group: ReadingGroup | null, shortGroup: ReadingGroup | null, slots: ReadingSlot[],
 *   choices: LectionaryChoice[], selectedNote: string | null,
 *   collects: CollectOption[], collectLabels: string[], collectIndex: number, collectsLinked: boolean, ending: "A" | "B" | "C",
 *   memorialCollects: CollectOption[], memorialSaints: Candidate[], passiveDays: Candidate[], commemorations: Candidate[], textlessDays: Candidate[],
 *   dedicationLines: string[], transferNotes: string[],
 *   colors: string[], colorAlt: string[], ownColor: boolean, colorsOr: boolean,
 *   fast: "major" | "minor" | null, cycle: string | null, empty: boolean,
 *   hrefs: { prev: string | null, next: string | null, today: string, tracks: Array<{ track: 1 | 2, href: string, active: boolean }>, options: string[], collects: string[] },
 * }} LectionaryModel
 */

// ── BEGIN LECTIONARY_MODEL ──
// Exercised by tests/unit/lectionary.test.js (vm slice — no DOM) and, against
// the real tables, by tests/unit/lectionary.data.test.js. Pure decisions only:
// which candidate to show first, which track / set / collect, what the choice rows
// say, which colours the header wears, and how a
// state round-trips through the URL. The test loaders slice the engine's
// LITURGICAL_CORE + LITURGICAL_LOOKUP blocks and verse-spec's VERSE_SPEC block
// alongside, so parseDate / toKey / addDays / dayOfWeek /
// fastOf / specCoversVerse / verseInstanceKeys are the real functions here.

const SLOT_ORDER = ["first", "psalm", "second", "gospel"];
/** @type {Record<string, string>} */
const SLOT_LABEL = { first: "제1독서", psalm: "성시", second: "제2독서", gospel: "복음" };
// 한글 라벨은 데이터 `_vocab` 그대로 — lectionary.data.test.js 가 표와 대조한다(ADR-036 §4 단일 출처).
/** @type {Record<string, string>} */
const CYCLE_LABEL = { A: "가해", B: "나해", C: "다해", I: "홀수해", II: "짝수해" };
/** @type {Record<string, string>} */
const COLOR_LABEL = { white: "백색", red: "적색", green: "녹색", violet: "자색", rose: "장미색", blue: "청색" };
/** @type {Record<string, string>} */
const FAST_LABEL = { major: "대재일", minor: "소재일" };
// 축성일 줄의 꼬리 — 데이터 local-observances.json `_vocab.dedication_kind`(「축성」 · 「축복」)에 「일」을 붙인 것이다
// (lectionary.data.test.js가 대조한다). 키의 차례가 줄의 차례다 — 축성일(주요축일)이 축복일(기념일)보다 먼저.
/** @type {Record<"consecration" | "blessing", string>} */
const DEDICATION_LABEL = { consecration: "축성일", blessing: "축복일" };
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const GRID_ID_PREFIX = "grid:";
/** 파서가 괄호 선택 확장(「9:35-10:8(9-23)」)으로 만든 세트의 표지(ADR-037 §1 「대안 세트 explode」). */
const BRACKET_NOTE = "괄호 선택 구절 포함";
// 연중 주일 트랙의 이름 — 앞쪽은 구약 연속 독서, 뒤쪽은 복음 주제에 따른 독서다(2024 책자 일러두기, 기도서 471쪽, 사용자 결정 2026-11-05).
/** @type {Record<1 | 2, string>} */
const TRACK_NAME = { 1: "연속 독서", 2: "복음 주제" };

// 송영 3종 — 고른 본기도(대체안은 번호로 택1) 끝에 **1회**, 그 본기도의 `ending` 코드로(ADR-036 §3 ·
// ADR-038 §3 「구현」 — 다른 전례일의 본기도는 열거하지 않는다). 데이터 eucharist-collects.json
// `_meta.endings` 와 글자까지 같아야 한다(실데이터 테스트가 대조). A · B 의 선택 규정은 설계서
// 미결37 — 데이터가 B 를 배정하지 않으므로 레코드의 코드를 그대로 받고, 코드가 없으면 A 다.
/** @type {Record<"A" | "B" | "C", string>} */
const ENDINGS = {
  A: "성부와 성령과 함께 한 분 하느님이신 우리 주 예수 그리스도의 이름으로 기도하나이다. 아멘",
  B: "성부 하느님께서는 성령 안에서 성자 예수 그리스도를 통하여 이제와 영원토록 찬양받으시나이다. 아멘",
  C: "성자께서는 성부와 성령과 함께 영원히 사시며 다스리시나이다. 아멘",
};
// 영광송(Gloria Patri) — 시편 끝에 1회 붙이는 앱 상수(ADR-037 §3 · ADR-038 §3 — 본기도 끝의
// 송영과 별개 용어). 원문은 데이터 저장소 liturgical/psalter/TEMPLATE.md 의 참고 원문
// 「영광이 성부와 성자와 성령께 ◯ 처음과 같이 지금도 그리고 영원히, 아멘.」 — 계응(선창 ◯ 응답)으로
// 그린다. 문구는 사용자 확인 2026-10-12(coding-pitfalls §21).
const GLORIA = { versicle: "영광이 성부와 성자와 성령께", response: "처음과 같이 지금도 그리고 영원히, 아멘." };

/** 로컬 날짜의 "YYYY-MM-DD" — `toISOString` 은 UTC 라 KST 에서 하루 어긋난다(엔진 머리 주석). */
function todayKey(/** @type {Date} */ now) {
  return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** "2026-04-05" → "2026년 4월 5일 (일)". 날짜가 깨졌으면 그대로 돌려준다. */
function dateLabel(/** @type {string} */ dateStr) {
  const p = parseDate(dateStr);
  if (!p) return dateStr;
  return `${p.y}년 ${p.m}월 ${p.d}일 (${WEEKDAY_KO[dayOfWeek(dateStr)]})`;
}

/** "2026-08-09" → "8월 9일" — 문구 속 날짜. */
function monthDayLabel(/** @type {string} */ dateStr) {
  const p = parseDate(dateStr);
  return p ? `${p.m}월 ${p.d}일` : dateStr;
}

/** 격자 합성 전례일인가(설계서 §5.5 예약 접두사). URL 쿼리 → 상태는 routing.js `parsePath` 가 맡는다. */
function isGrid(/** @type {Candidate} */ c) {
  return c.observance.id.startsWith(GRID_ID_PREFIX);
}

/**
 * 전례독서 목록과 캘린더의 짧은 이름(미결42 닫힘 — 사용자 확정 2026-10-12) — 괄호 설명 전부를 뗀다: 「바실(주교, 379년)과 나지안조의
 * 그레고리(주교, 389년)」 → 「바실과 나지안조의 그레고리」. 떼고 나서 비면 원래 이름.
 * @param {string | null | undefined} name
 */
function shortName(name) {
  const full = String(name || "");
  const stripped = full.replace(/\s*\([^()]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return stripped || full;
}

/**
 * 후보의 상태를 이름 뒤 상태 표시로 — 옮긴 · 선택 봉헌 · 생략 · 기념일 · 저녁 전례. 지정 전례일(그날 지키는 고유 후보)과 기념만 하는 후보는 상태 표시가 없다(「· 기념만」 문구를 뺐다, 사용자 결정 2026-11-04).
 * @param {Candidate} c
 */
function statusSuffix(c) {
  // 저녁 전례(부활밤 — 성 토요일 저녁, 성탄 밤 — 12.24 저녁): 그날의 대표가 아니라 그날 저녁의 감사성찬례(설계서 R-6.1-evening)
  if (c.evening) return " · 저녁";
  if (c.observance.rank === "commemoration") return " · 기념일";
  switch (c.status) {
    case "transferred_in": return c.from ? ` · ${monthDayLabel(c.from)}에서 옮겨 옴` : " · 옮겨 옴";
    case "transferred_out": return c.to ? ` · → ${monthDayLabel(c.to)}` : " · 옮겨 감";   // 전례독서 목록에는 없다 — 캘린더 모델(`nameOfCandidate`)이 쓴다
    case "optional": return c.from ? ` · ${monthDayLabel(c.from)}에서 옮겨 지킬 수 있음` : " · 옮겨 지킬 수 있음";
    case "omitted": return " · 생략";
    default: return "";
  }
}

/**
 * 안내 속 축일 이름 — 짧은 이름 뒤에 「축일」을 붙인다(「성 니콜라 축일」). 이름이 「날」로 끝나면(성 십자가의 날, 모든 별세자의 날,
 * 모든 성인의 날) 「날 축일」이 되지 않게, 「축일」로 끝나면(승천대축일) 「대축일 축일」이 되지 않게, 재의 수요일(설과 겹친 2032-02-11)은
 * 축일이 아니므로 붙이지 않는다.
 * @param {string | null | undefined} name
 */
function feastPhraseOf(name) {
  const short = shortName(name);
  return short.endsWith("날") || short.endsWith("축일") || short === "재의 수요일" ? short : `${short} 축일`;
}

/**
 * 원래 날짜에서 옮겨 간 축일을 알리는 제목 아래 안내 — 「성 니콜라 축일을 12월 7일로 옮김」(사용자 결정 2026-11-04, 문구는 2026-11-06).
 * 이름은 모두 받침으로 끝나(「축일」, 「날」, 「수요일」) 「을」이다.
 * @param {string | null | undefined} name @param {string} to  옮겨 가는 날짜
 */
function transferOutNote(name, to) {
  return `${feastPhraseOf(name)}을 ${monthDayLabel(to)}로 옮김`;
}

/**
 * 기본 독서가 옮겨 지킬 수 있는 축일(공현, 주의 봉헌, 주의 변모, 모든 성인, 승천)이면 그 축일을 옮겨 지킬 수 있는 주일, 아니면 null.
 * 그 주일을 고르면 이날은 평일 독서를 읽는다(사용자 결정 2026-11-06, ADR-041 §4). 엔진이 그 주일에 `optional` 후보를 넣는 것과
 * 같은 계산(`optionalDestOf`)이다. 축일이 주일에 온 해는 옮길 곳이 없어 null이다. 설과 겹쳐 다음날로 옮겨 온 축일(2049-02-03
 * 주의 봉헌)은 원래 날짜로 구한다. 옮겨 지키기로 해서 주일에 온 축일(엔진 `activated`)은 그날이 곧 그 주일이라 null이다.
 * @param {Candidate} initial  그날의 기본 독서 후보 @param {string} date @returns {string | null}
 */
function optionalSundayOf(initial, date) {
  if (isGrid(initial) || (initial.status !== "proper" && initial.status !== "transferred_in")) return null;
  const origin = initial.status === "transferred_in" && initial.from ? initial.from : date;
  const p = parseDate(origin);
  const sunday = p ? optionalDestOf(initial.observance.transfer_to, origin, p.y) : null;
  return sunday && sunday !== origin && sunday !== date ? sunday : null;
}

/**
 * 옮겨 지킬 수 있는 축일의 원래 날짜에 그 축일 줄의 상태 표시 — 「· 1월 31일로 옮겨 지킬 수 있음」. 목적지 주일의 「· 2월 2일에서 옮겨 지킬 수 있음」과
 * 짝이다(사용자 결정 2026-11-06). 축일을 고르면 같은 말을 제목 아래에 보인다(`optionalOriginNote`).
 * @param {string} sunday  옮겨 지킬 수 있는 주일
 */
function optionalOriginSuffix(sunday) {
  return ` · ${monthDayLabel(sunday)}로 옮겨 지킬 수 있음`;
}

/**
 * 옮겨 지킬 수 있는 축일의 원래 날짜에 축일을 고르면 제목 아래에 보이는 안내 — 「1월 31일로 옮겨 지킬 수 있음」. 목적지 주일의 「2월 2일에서 옮겨 지킬 수 있음」과
 * 같은 형식이다(사용자 결정 2026-11-06).
 * @param {string} sunday
 */
function optionalOriginNote(sunday) {
  return `${monthDayLabel(sunday)}로 옮겨 지킬 수 있음`;
}

/**
 * 옮겨 지킬 수 있는 축일이 평일에 온 날의 평일 독서 — 「주의 봉헌 축일 대체 독서」. 전례독서 목록에서는 줄 이름 뒤의 상태 표시이고, 그 줄을 누르면
 * 이름이 제목으로 올라가므로 같은 말을 제목 아래에 보인다(`selectedNoteOf`와 같다, 사용자 결정 2026-11-06).
 * @param {string | null | undefined} name  축일 이름
 */
function alternateLabelOf(name) {
  return `${feastPhraseOf(name)} 대체 독서`;
}

/**
 * 제목의 전례일이 어떤 상태인지 알리는 제목 아래 안내(사용자 결정 2026-11-04). 전례독서 목록에서 이름 뒤에 있던 상태 표시(`statusSuffix`)는
 * 그 줄을 누르면 이름이 제목으로 올라가 자리가 없으므로 제목 아래로 옮긴다. 상태가 없으면 null.
 * 안내는 상태 표시와 같은 말을 마침표 없이 쓴다 — 「12월 6일에서 옮겨 옴」, 「8월 6일에서 옮겨 지킬 수 있음」. 상태 표시 「저녁」만은 홀로 짧아
 * 「저녁 전례」다(사용자 결정 2026-11-06: 원래 날짜와 옮겨 간 날의 안내를 같은 형식으로, 간결하게).
 * 기념만 하거나 생략하는 후보는 안내가 없다 — 대개 누를 수 없고(`buildLectionaryModel`의 `isPassive`), 예외인 지역 축일(삼일절, 광복절)도 안내를 달지 않는다.
 * @param {Candidate} c @returns {string | null}
 */
function selectedNoteOf(c) {
  if (c.evening) return "저녁 전례";
  switch (c.status) {
    case "transferred_in": return c.from ? `${monthDayLabel(c.from)}에서 옮겨 옴` : "옮겨 옴";
    case "optional": return c.from ? `${monthDayLabel(c.from)}에서 옮겨 지킬 수 있음` : "옮겨 지킬 수 있음";
    default: return null;
  }
}

/** 고유 독서가 하나라도 있는가 — 공통(`common` 표지) 그룹만 있으면 거짓. */
function hasProperReadings(/** @type {ReadingGroup[]} */ groups) {
  return groups.some((g) => !g.common);
}

/**
 * 성인 공통 독서를 당분간 보이지 않는다(사용자 결정 2026-11-03). 켜져 있으면 고유 독서 없이 공통 독서만 있는 후보는 전례독서
 * 목록에 없고, `?obs=`로 가리켜도 기본 독서를 보인다(`isHiddenCandidate`). 그 성인의 본기도는 기본 독서의 본기도 뒤에 이어진다
 * (`memorialOf`). 공통 독서가 그날의 기본 독서인 날(평일 독서가 없는 날 — `initialCandidate`)은 그대로 보인다.
 */
const HIDE_COMMON_READINGS = true;

/** 공통 독서만 있어 전례독서 목록에서 감추는 후보인가(`HIDE_COMMON_READINGS`). 기본 독서 후보는 감추지 않는다. */
function isHiddenCandidate(/** @type {Candidate} */ c, /** @type {Candidate} */ initial, /** @type {ReadingGroup[]} */ groups) {
  return HIDE_COMMON_READINGS && c !== initial && !isGrid(c) && groups.length > 0 && !hasProperReadings(groups);
}

/**
 * 후보가 그리는 본문의 열쇠 — 독서 그룹과 본기도의 id를 정렬해 잇는다. 열쇠가 같은 두 후보는 어느 쪽을 눌러도 같은 본문이 보인다
 * (`buildLectionaryModel`의 줄 감추기 — 대림1주일과 대림 1주일 격자).
 * @param {ReadingGroup[]} groups @param {CollectOption[]} collects
 */
function textKeyOf(groups, collects) {
  return groups.map((g) => g.id).sort().join(",") + "|" + collects.map((k) => String(k.id)).sort().join(",");
}

/**
 * 초기 선택(ADR-038 §3 — `official` 이 초기 선택). 단 하나의 예외가 미결25(사용자 확정 2026-10-12, 닫힘)다: 지정 전례일의 독서가
 * 공통뿐이면(고유 독서 없는 축일) 책자대로 그날의 격자 독서를 먼저 보인다 — 헤더 제목과 본기도는 고른 전례일의 것이고 색은 고른
 * 본문의 색(`headerColors` — 격자면 그날의 병기 `colors` + 대체색)이다. 고유 독서가 대체 독서인 축일(`alternate_readings` — 2.11 병자를
 * 위한 기도일, 사용자 결정 2026-11-07)도 격자를 먼저 보이고, 그 독서는 전례독서 목록의 줄로 고른다.
 * @param {ResolvedDate} resolved @param {(c: Candidate) => ReadingGroup[]} groupsOf
 * @returns {Candidate | null}
 */
function initialCandidate(resolved, groupsOf) {
  const official = resolved.official || resolved.candidates[0] || null;
  if (!official) return null;
  if (!official.observance.alternate_readings && hasProperReadings(groupsOf(official))) return official;
  const grid = resolved.candidates.find((c) => isGrid(c) && c.status === "proper" && groupsOf(c).length > 0);
  return grid || official;
}

/**
 * `?obs=` 가 가리키는 후보, 없거나 틀리면 초기 선택.
 * @param {ResolvedDate} resolved @param {string | null} obsParam @param {(c: Candidate) => ReadingGroup[]} groupsOf
 */
function selectCandidate(resolved, obsParam, groupsOf) {
  if (obsParam) {
    const hit = resolved.candidates.find((c) => c.observance.id === obsParam);
    if (hit) return hit;
  }
  return initialCandidate(resolved, groupsOf);
}

/** 그룹에 실린 트랙들 — 연중 주일만 [1, 2], 그 밖은 []. @returns {Array<1 | 2>} */
function tracksOf(/** @type {ReadingGroup[]} */ groups) {
  /** @type {Array<1 | 2>} */
  const out = [];
  for (const g of groups) {
    if ((g.reading_track === 1 || g.reading_track === 2) && !out.includes(g.reading_track)) out.push(g.reading_track);
  }
  return out.sort();
}

/**
 * 트랙 선택 — URL 이 먼저, 다음은 기억된 것(마지막으로 고른 트랙 — 사용자 결정 2026-10-13), 그다음 첫 트랙. 트랙이 없는 날은 null.
 * @param {ReadingGroup[]} groups @param {1 | 2 | null} param @param {1 | 2 | null} stored
 * @returns {1 | 2 | null}
 */
function pickTrack(groups, param, stored) {
  const ts = tracksOf(groups);
  if (!ts.length) return null;
  if (param && ts.includes(param)) return param;
  if (stored && ts.includes(stored)) return stored;
  return ts[0];
}

/** 고른 트랙의 세트들 — 엔진 순서(트랙 → 세트 번호 → id) 그대로. */
function setsOf(/** @type {ReadingGroup[]} */ groups, /** @type {1 | 2 | null} */ track) {
  return track === null ? groups : groups.filter((g) => g.reading_track === track);
}

/** `?set=` 은 보이는 선택지 가운데 몇 번째인가(1부터). 범위 밖이면 첫 선택지. */
function pickSet(/** @type {ReadingOption[]} */ options, /** @type {number | null} */ param) {
  if (!options.length) return -1;
  if (param && param >= 1 && param <= options.length) return param - 1;
  return 0;
}

/**
 * 세트의 조건 문구 — 「…로 지킬 때」라는 문구로 통일(사용자 결정 2026-10-12; 데이터는 「…로 지키는 경우」와 섞여 있다).
 * 조건이 아닌 파서 표지(「원본 세트 N」 · 괄호 선택 구절)는 null.
 */
function setCondition(/** @type {ReadingGroup} */ group) {
  const n = group.set_note;
  if (!n || /^원본 세트/.test(n) || n === BRACKET_NOTE) return null;
  return n.replace(/로 지키는 경우$/, "로 지킬 때");
}

/**
 * 괄호 선택 구절 세트의 바탕 — 앞선 선택지 가운데 슬롯 구성이 같고 **한 슬롯만** 라벨이 다른(짧은) 것, 가장 가까운 것.
 * 실데이터의 괄호 세트 34건이 전부 이 형식이다(2026-10-12 실측). 없으면 -1.
 * @param {ReadingOption[]} options @param {ReadingGroup} g
 */
function findBracketBase(options, g) {
  for (let i = options.length - 1; i >= 0; i--) {
    const base = options[i].group;
    if (base.readings.length !== g.readings.length) continue;
    let diff = 0;
    let ok = true;
    for (const r of g.readings) {
      const s = base.readings.find((x) => x && x.slot === r.slot);
      if (!s || s.bookId !== r.bookId) { ok = false; break; }
      if (s.label !== r.label) diff++;
    }
    if (ok && diff === 1) return i;
  }
  return -1;
}

/**
 * 고른 트랙의 세트들 → 화면의 「독서」 선택지(사용자 결정 2026-10-12 — ADR-038 §3 「구현」).
 * - 괄호 선택 구절 세트(`BRACKET_NOTE`)는 자기 바탕 세트에 **합친다** — 긴 본문을 그리고 짧은 본문과의 차이를
 *   〔 〕 로 표시한다(`short`가 그 바탕). 카드에 오르지 않는다.
 * - 남는 선택지가 둘 이상이면 「또는」 대안이다 — 대안이 있는 슬롯만 바꾼 **완전한 세트**를 통째로 고른다(ADR-037
 *   §1): 「독서 1」「독서 2」. 조건부 세트는 조건(「…로 지킬 때」)이 라벨이고 그 바탕 세트는 전례일 이름이다.
 * - 제목이 갈리는 세트들(미결12 — 좁히기에 실패해 남은 것 전부가 온 날)은 제목으로 가른다.
 * @param {ReadingGroup[]} sets @param {string} baseName
 * @returns {ReadingOption[]}
 */
function readingOptions(sets, baseName) {
  /** @type {ReadingOption[]} */
  const out = [];
  for (const g of sets) {
    if (g.set_note === BRACKET_NOTE) {
      const i = findBracketBase(out, g);
      if (i >= 0) { out[i] = { group: g, short: out[i].group, label: "" }; continue; }
    }
    out.push({ group: g, short: null, label: "" });
  }
  const titles = new Set(out.map((o) => o.group.title));
  // 제목이 갈리면(한 날짜에 둘 — 5.1 사도 성 필립보와 성 야고보 ∧ 노동자의 날) 고른 전례일의 제목을 앞세운다 — 엔진은
  // id 순이라 「노」가 먼저 와 사도 축일의 기본 독서가 노동자의 날 것이었다(자체 리뷰 2026-10-13). 안정 정렬.
  if (titles.size > 1) out.sort((a, b) => Number(!sameName(a.group.title, baseName)) - Number(!sameName(b.group.title, baseName)));
  const conditional = out.some((o) => setCondition(o.group) !== null);
  out.forEach((o, i) => {
    const cond = setCondition(o.group);
    if (titles.size > 1) {
      const dup = out.filter((x) => x.group.title === o.group.title).length > 1;
      o.label = dup ? `${o.group.title} 독서 ${o.group.set_no}` : o.group.title;
    } else if (cond) {
      o.label = cond;
    } else if (conditional) {
      o.label = baseName;
    } else {
      o.label = `독서 ${i + 1}`;
    }
  });
  return out;
}

/**
 * 괄호 선택 구절 판정 — 긴 본문(`slot`)에는 있고 짧은 바탕(`shortSlot`)에는 없는 절. 책자가 「(9-23)」 로
 * 적는 선택 구절을 〔 〕 로 표시하기 위한 것(사용자 결정 2026-10-12 — 긴 본문을 싣고 짧은 본문이 어디까지인지 표시).
 * @param {ReadingSlot} slot @param {ReadingSlot | null} shortSlot
 * @returns {(chapter: number, n: number) => boolean}
 */
function optionalVerseTest(slot, shortSlot) {
  if (!shortSlot) return () => false;
  const covers = (/** @type {ReadingSlot} */ s, /** @type {number} */ ch, /** @type {number} */ n) =>
    (s.refs || []).some((r) => r.chapter === ch && specCoversVerse(r.verseSpec, n));
  return (chapter, n) => covers(slot, chapter, n) && !covers(shortSlot, chapter, n);
}

/**
 * 독서 카드 — 「또는」이 있는 날은 달라지는 항목 수와 상관없이 모두 카드로 고른다(사용자 결정 2026-11-05, ADR-038 §3). 트랙이 있는 날은
 * 트랙마다, 그 밖에는 세트마다 한 장이다. 앞쪽끼리, 뒤쪽끼리 묶인 독서이므로 항목을 따로 고르지 않는다(사용자 확정 2026-11-05).
 * 세트와 본기도가 짝지어진 날(5.1, 사계재 금요일)은 전례일이 갈리는 날이라 카드가 아니라 전례독서 목록의 줄이다. 고를 것이 없으면 null.
 * @param {{ groups: ReadingGroup[], baseName: string, options: ReadingOption[], setIndex: number, linked: boolean,
 *   trackHrefs: Array<{ track: 1 | 2, href: string, active: boolean }>, optionHrefs: string[] }} a
 * @returns {ReadingCard[] | null}
 */
function readingCards({ groups, baseName, options, setIndex, linked, trackHrefs, optionHrefs }) {
  /** @type {Array<{ name: string, group: ReadingGroup, href: string, active: boolean, focusKey: string, track: 1 | 2 | null }>} */
  const picks = [];
  if (trackHrefs.length > 1) {
    for (const t of trackHrefs) {
      // 트랙마다 선택지는 하나다(괄호 선택 구절 세트는 바탕에 합쳐진다) — 실데이터 테스트가 지킨다(lectionary.data.test.js).
      const { group } = readingOptions(setsOf(groups, t.track), baseName)[0];
      picks.push({ name: TRACK_NAME[t.track], group, href: t.href, active: t.active, focusKey: `track:${t.track}`, track: t.track });
    }
  } else if (options.length > 1 && !linked) {
    options.forEach((o, i) => {
      picks.push({ name: o.label, group: o.group, href: optionHrefs[i], active: i === setIndex, focusKey: `set:${i + 1}`, track: null });
    });
  } else {
    return null;
  }
  const labelOf = (/** @type {ReadingGroup} */ g, /** @type {string} */ slot) => (slotsInOrder(g).find((s) => s.slot === slot) || { label: null }).label;
  return picks.map(({ group, ...card }) => ({
    ...card,
    refs: slotsInOrder(group).map((s) => ({ label: s.label || "", differs: picks.some((p) => labelOf(p.group, s.slot) !== s.label) })),
  }));
}

/**
 * 조건부 세트를 고르면 제목이 그 조건의 이름이다 — 사순 2주일에 「주의 변모 주일로 지킬 때」를 고르면 「주의 변모 주일」이다. 색과 본기도는
 * 고른 전례일 그대로다(사용자 결정 2026-11-05 — 2025, 2026 책자가 이날을 자색으로 적고 복음만 「또는」으로 싣는다). 조건이 없으면 null.
 * @param {ReadingGroup | null} group @returns {string | null}
 */
function conditionTitle(group) {
  const cond = group ? setCondition(group) : null;
  return cond ? cond.replace(/로 지킬 때$/, "") : null;
}

/** 슬롯을 **이름**으로 고른 순서 — 위치로 우기지 않는다(ADR-037 §1 「슬롯 배정」). 없는 슬롯은 건너뛴다. */
function slotsInOrder(/** @type {ReadingGroup | null} */ group) {
  if (!group) return [];
  /** @type {ReadingSlot[]} */
  const out = [];
  for (const s of SLOT_ORDER) {
    const slot = group.readings.find((r) => r && r.slot === s);
    if (slot) out.push(slot);
  }
  return out;
}

/**
 * 본기도 — **고른 전례일의 것만**(사용자 결정 2026-10-12, pitfalls §21 · ADR-038 §3 「구현」). 같은 날의 다른
 * 전례일 본기도는 그 전례일을 눌러야 보인다. 재조회 없이 `findCollects` 반환(전례일별 키잉)에서 고른 후보의 원소를
 * 찾는다 — 본기도가 없는 후보(기념일 · 이름 줄)는 빈 배열.
 * @param {CandidateCollects[]} entries @param {Candidate} selected
 * @returns {CollectOption[]}
 */
function collectsFor(entries, selected) {
  const sel = entries.find((e) => e.candidate === selected)
    || entries.find((e) => e.candidate.observance.id === selected.observance.id) || null;
  if (!sel) return [];
  // 같은 날짜에 정의된 다른 전례일의 본기도가 섞여 오면(5.1 노동자의 날 — 미결18 · 35) 고른 전례일 이름의 것을 앞세운다(안정 정렬)
  const name = selected.observance.name;
  return [...sel.collects].sort((a, b) => Number(!sameName(a.title, name)) - Number(!sameName(b.title, name)));
}

/**
 * 그날 축성되거나 축복된 교회(엔진 `findDedications`) → 제목 아래 줄(사용자 결정 2026-11-04). 종류마다 한 줄이고, 교회
 * 이름을 쉼표로 이은 뒤 「축성일」 · 「축복일」을 한 번만 붙인다(「일산성당, 초지성당, 행신성당 축성일」). 축성일 줄이
 * 먼저다(`DEDICATION_LABEL`의 차례). 「북.」으로 시작하는 성당(북한에 있던 성당)은 싣지 않고, 주보성인도 보이지 않는다(같은 결정).
 * @param {import("../types").ParishDedication[]} entries @returns {string[]}
 */
function dedicationLines(entries) {
  return /** @type {Array<keyof typeof DEDICATION_LABEL>} */ (Object.keys(DEDICATION_LABEL)).flatMap((kind) => {
    const names = entries.filter((e) => e.kind === kind && !e.name.startsWith("북.")).map((e) => e.name);
    return names.length ? [`${names.join(", ")} ${DEDICATION_LABEL[kind]}`] : [];
  });
}

/**
 * 기리는 성인의 본기도를 잇는 차례 — 공통 본기도의 유형을 정의한 차례(`commons.json`의 `classes`)와 같다: 순교자, 성직자,
 * 선교사, 신학자·교육자, 수도자, 성인 일반(사용자 결정 2026-11-03). 유형이 없는 성인은 그 뒤에 후보 차례로.
 * `lectionary.data.test.js`가 데이터의 차례와 대조한다.
 */
const MEMORIAL_CLASS_ORDER = ["martyr", "pastor", "missionary", "teacher", "monastic", "saint", "dedication", "anniversary"];

/**
 * 기리는 성인 — 그날의 기본 독서(`initial`)를 기준으로 정한다. 성인 축일은 머리 제목 아래에 이름을 한 줄씩
 * 보이며(`saints`, 사용자 결정 2026-11-03. 기념만 하는 성인은 고유 독서가 있어도 이 줄뿐이다, 2026-11-04), 기본 독서를 볼 때 그 본기도 뒤에 성인의 본기도를 잇고(`collects`), 송영은
 * 그 뒤에 한 번 단다(사용자 결정 2026-11-03). 잇는 성인은 성인 유형(`sanctoral_class`가 `MEMORIAL_CLASS_ORDER`의 하나)인
 * 월별 축일 후보다 — 3.1 사순 2주일에 함께 밀린 삼일절(`national`)은 잇지 않는다.
 * - 기본 독서가 평일(격자)이면 — 지정 전례일(성인 축일)에 고유 독서가 없어서다(설계서 미결25) — 그날 지키는 성인 축일
 *   (`proper`)을 모두 잇는다(11.6 레오나드, 2.14 발렌틴과 키릴과 메토디우스).
 * - 밀려서 그날 기념만 하는 축일(`commemorated` — 옮겨 온 축일과 겹친 12.29 토마스 베켓)은 기본 독서가 무엇이든 잇는다.
 * - 다만 주일에는 성인의 본기도를 잇지 않는다(사용자 확인 2026-11-04). 주일과 겹쳐 기념만 하는 성인(7.26 안나와 요아킴)은
 *   이름 줄에만 보인다. 책자도 그 주일에 이름만 적는다(설계서 미결47).
 * 유형이 같고 공통 본기도를 쓰는 성인은 그 본기도 하나에 이름을 모으고(「A와 B를」), 다르면 `MEMORIAL_CLASS_ORDER` 차례로
 * 잇는다. 이름도 같은 차례다. 대체안이 여럿이면 첫째를 쓴다.
 * `colors`는 그날 지키는 성인 축일(`proper`)들의 색을 같은 차례로 겹치지 않게 모은 것 — 둘 이상이면 머리가 「적색 또는
 * 백색」으로 보인다(buildLectionaryModel). 기념만 하는 축일은 그날의 색을 바꾸지 않아 넣지 않는다.
 * @param {ResolvedDate} resolved @param {Candidate} initial @param {CandidateCollects[]} entries
 * @returns {{ collects: CollectOption[], colors: string[], saints: Candidate[] }}
 */
function memorialOf(resolved, initial, entries) {
  /** @type {Array<{ cls: string, collect: CollectOption, names: string[] | null, at: number, colors: string[], kept: boolean, saints: Candidate[] }>} */
  const items = [];
  resolved.candidates.forEach((c, at) => {
    // 성인은 공통 본기도의 유형(MEMORIAL_CLASS_ORDER)이 있는 행이다 — 삼일절의 `national` 같은 유형은 성인이 아니다
    const cls = c.observance.sanctoral_class;
    if (c === initial || isGrid(c) || c.observance.kind !== "sanctoral" || typeof cls !== "string"
      || !MEMORIAL_CLASS_ORDER.includes(cls) || c.evening) return;
    const kept = c.status === "proper" && isGrid(initial);
    if (!kept && c.status !== "commemorated") return;
    const collect = collectsFor(entries, c)[0];
    if (!collect) return;
    const color = typeof c.observance.color === "string" ? [c.observance.color] : [];
    const same = collect.common && collect.template && collect.names
      ? items.find((x) => x.names && x.collect.common === collect.common) : null;
    if (same && same.names && collect.names) {
      same.names.push(...collect.names);
      same.saints.push(c);
      if (kept) { same.colors.push(...color); same.kept = true; }
    } else {
      items.push({ cls, collect, names: collect.common && collect.template && collect.names ? [...collect.names] : null, at,
        colors: kept ? color : [], kept, saints: [c] });
    }
  });
  const rank = (/** @type {string} */ cls) => {
    const i = MEMORIAL_CLASS_ORDER.indexOf(cls);
    return i < 0 ? MEMORIAL_CLASS_ORDER.length : i;
  };
  items.sort((a, b) => rank(a.cls) - rank(b.cls) || a.at - b.at);
  const collects = items.map((x) => (x.names && x.collect.names && x.names.length > x.collect.names.length && x.collect.template
    ? { ...x.collect, text: fillCommonName(x.collect.template, joinNames(x.names)), names: x.names }
    : x.collect));
  /** @type {string[]} */
  const colors = [];
  for (const x of items) for (const c of x.colors) if (!colors.includes(c)) colors.push(c);
  return { collects: dayOfWeek(resolved.date) === 0 ? [] : collects, colors, saints: items.flatMap((x) => x.saints) };
}

/** 괄호 설명을 뗀 이름이 같은가 — 세트 · 본기도의 제목과 전례일 이름 대조. */
function sameName(/** @type {string | null | undefined} */ a, /** @type {string | null | undefined} */ b) {
  return !!a && !!b && shortName(a) === shortName(b);
}

/**
 * `?collect=` 는 본기도 목록의 몇 번째인가(1부터 — `?set=` 과 같은 규칙). 종전에는 `collect_no` 였는데, 한 전례일에
 * 서로 다른 레코드 둘이 모두 `collect_no: 1` 인 날(사계재 금요일 성직후보자 · 수도자, 5.1)에 둘째에 닿을 수 없었다
 * (자체 리뷰 2026-10-13). 범위 밖이면 첫 대체안.
 */
function pickCollect(/** @type {CollectOption[]} */ options, /** @type {number | null} */ param) {
  if (!options.length) return -1;
  if (param && param >= 1 && param <= options.length) return param - 1;
  return 0;
}

/**
 * 본기도 대체안의 이름 — 「본기도 N」. 번호가 겹치면(데이터에 없는 경우다) 위치로 매긴다. 번호가 겹치던 5.1과 사계재 금요일은
 * 전례독서 목록의 줄로 고른다(2026-11-05, 줄에서 고르므로 번호를 그리지 않는다).
 * @param {CollectOption[]} options @returns {string[]}
 */
function collectLabels(options) {
  const nos = options.map((o) => o.collect_no);
  const distinct = new Set(nos).size === nos.length;
  return options.map((o, i) => `본기도 ${distinct ? o.collect_no : i + 1}`);
}

/**
 * 독서 세트와 본기도가 같은 제목으로 1:1 짝지어지는 날 — 세트마다 짝 본기도의 위치, 아니면 null. 그런 날은
 * 전례독서 목록의 한 줄로 둘을 함께 고른다 — 「대안 독서와 본기도가 교차해서 쓰이는 경우(대안 독서는 사도 축일, 본기도는 노동자의 날)는 없다」
 * (사용자 결정 2026-10-13). 실데이터에서는 5.1(사도 성 필립보와 성 야고보 ∧ 노동자의 날)과 사계재 금요일 넷(성직후보자 ∧
 * 수도자)뿐이다(2025~2028 전수 — lectionary.data.test.js). 「또는」 독서 1 · 2 와 본기도 1 · 2 · 3 처럼 제목으로 갈리지
 * 않는 대안은 짝이 아니라 따로 고른다(Copilot 리뷰 1회차 — 독립된 축).
 * @param {ReadingOption[]} options @param {CollectOption[]} collects @returns {number[] | null}
 */
function linkCollects(options, collects) {
  if (options.length < 2 || options.length !== collects.length) return null;
  if (new Set(options.map((o) => shortName(o.group.title || ""))).size !== options.length) return null;
  /** @type {number[]} */
  const out = [];
  for (const o of options) {
    const j = collects.findIndex((c, k) => !out.includes(k) && sameName(c.title, o.group.title));
    if (j < 0) return null;
    out.push(j);
  }
  return out;
}

/**
 * 제목과 전례독서 목록에 보이는 이름 — 사계재는 표의 이름(「동계재」)이 아니라 그날 본문의 제목이다(「수도자의 성소를 위한 동계재」).
 * 세트가 제목으로 갈리는 날(5.1)은 그 세트의 제목이다(사용자 결정 2026-11-05). 그 밖과 본문이 없는 때는 전례일 이름이다.
 * @param {Candidate} c @param {ReadingGroup | null} group @param {boolean} linked  세트와 본기도가 짝지어졌는가(`linkCollects`)
 */
function choiceNameOf(c, group, linked) {
  return (linked || isEmber(c.observance)) && group && group.title ? group.title : String(c.observance.name || "");
}

/** 고른 본기도의 송영 코드 — 코드가 없으면 A(ADR-036 §3 기본). @returns {"A" | "B" | "C"} */
function endingCodeOf(/** @type {CollectOption | null | undefined} */ last) {
  const e = last && last.ending;
  return e === "A" || e === "B" || e === "C" ? e : "A";
}

/** `null | 코드 | 코드 배열` 3형 → 배열. */
function altList(/** @type {unknown} */ v) {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string");
}

/**
 * 헤더 색(ADR-038 §3 · 설계서 R-6.4-color-order) — **고른 본문의 색을 따른다**(사용자 결정 2026-10-12,
 * pitfalls §21): 고른 후보가 자기 색을 가진 **비격자** 후보이고 그 색이 그날의 대표색과 다르면 그 색 하나
 * (사계재 자 · 성 토요일 저녁의 부활밤 백 · 생략된 성인). 그 밖은 그날의 `colors`(병기) + `colorAlt`
 * 그대로 — 지정 전례일이나 색이 같은 후보를 누르면 사계재 날의 [자, 백] 병기가 남는다. 격자 후보는 자기
 * 색이 아니라 절기 바탕색을 들고 있어 제외. 「재일 독서를 읽을 때만 자색, 어차피 선택 독서」(2026-09-17)의 일반화.
 * @param {ResolvedDate} resolved @param {Candidate | null} selected
 * @returns {{ colors: string[], colorAlt: string[], ownColor: boolean }}
 */
function headerColors(resolved, selected) {
  const obs = selected ? selected.observance : null;
  if (selected && obs && !isGrid(selected) && typeof obs.color === "string" && obs.color !== resolved.color) {
    return { colors: [obs.color], colorAlt: altList(obs.color_alt), ownColor: true };
  }
  const colors = Array.isArray(resolved.colors) && resolved.colors.length ? resolved.colors.slice()
    : (resolved.color ? [resolved.color] : []);
  return { colors, colorAlt: altList(resolved.colorAlt), ownColor: false };
}

/**
 * 전날 · 다음날 링크 — 교회력을 계산하는 날짜(엔진 `isComputableDate` — 1583~9999) 밖이면 null 이라 단추가 자리만 남는다
 * (캘린더의 이전 · 다음 달과 같다). 범위 끝에서 누르면 「계산할 수 없는 날짜」 화면이었고, 다시 그린 뒤 포커스를 돌려줄
 * 같은 단추도 「오늘」도 없었다.
 * @param {string} date @param {number} n @returns {string | null}
 */
function stepHref(date, n) {
  const d = addDays(date, n);
  return d && isComputableDate(d) ? `/lectionary/${d}` : null;
}

/**
 * 상태 → URL. 기본값과 같은 키는 쓰지 않아 「/lectionary/2026-04-05」가 그날의 초기 화면이다 — 다만 **트랙은 트랙이 있는
 * 날이면 언제나 적는다**(`defaults.track` 은 null): 기본 트랙이 보는 사람의 기억(마지막 선택)에 달려 있어, 빼면 같은 주소가
 * 사람마다 · 기억이 바뀐 뒤마다 다른 화면이 된다(공유 링크 · 뒤로 가기 — 자체 리뷰 2026-10-13). 기억에서 온 트랙은
 * 렌더할 때 지금 주소에 적어 둔다(`renderLectionaryView` — `withTrack`).
 * @param {string} date @param {LectionaryQuery} state @param {{ obs: string | null, track: 1 | 2 | null }} defaults
 */
function hrefFor(date, state, defaults) {
  const q = new URLSearchParams();
  if (state.obs && state.obs !== defaults.obs) q.set("obs", state.obs);
  if (state.track && state.track !== defaults.track) q.set("track", String(state.track));
  if (state.set && state.set !== 1) q.set("set", String(state.set));
  if (state.collect && state.collect !== 1) q.set("collect", String(state.collect));
  const s = q.toString();
  return `/lectionary/${date}${s ? "?" + s : ""}`;
}

/**
 * 장 JSON 에서 `verseSpec` 이 덮는 절만 — 병합 절(`range_end`)은 범위 안 어느 번호든 걸리면 포함.
 * 인스턴스 키는 **장 전체**에서 계산해 발췌에서도 같은 절이 같은 id 를 받게 한다(ADR-035 개정 2026-07-27).
 *
 * 번호만으로 고르면 안 되는 절 둘(2026-10-13 자체 리뷰):
 * - **다른 장에서 옮겨 실린 절**(`chapter_ref` — 이사 40 의 19절 뒤 41:6-7)은 이 장의 ref 가 아니다 — 뺀다.
 *   「이사 40:1-11」(대림 2주일 나해)이 11절 뒤에 41:6-7 을 달고 있었다.
 * - **번호 체계가 둘인 장**(다니 3 — 그리스어 추가 본문 `lxx_only` 24~90 ∧ 히브리 뒷부분 24~33 · `alt_ref` 91~100).
 *   spec 이 그리스어에만 있는 번호(히브리 최대 번호보다 큰 `lxx_only` 번호)를 덮으면 그리스어 체계 — `lxx_only` 는
 *   제 번호로, 히브리 절은 `alt_ref`(불가타 번호)로 고른다. 아니면 히브리 체계 — `lxx_only` 를 뺀다. 「다니 3:25, 34-43」
 *   (사순 3주 화)은 아자리야의 기도, 「다니 3:14-20, 24-25, 28」(사순 5주 수)은 히브리 본문이다 — 로마 성서정과의
 *   Dn 3:25, 34-43 · Dn 3:14-20, 91-92, 95 와 같고, RCL(NRSV 번호) 계열 독서표 — 잉글랜드 CW 「Song of the Three 2, 11-20」 ·
 *   「Dan 3.14-20, 24-25, 28」 — 와도 같은 본문이라 이 규칙으로 완결이다(사용자 결정 2026-10-13; 새 다니 3 참조는
 *   lectionary.data.test.js 가 막는다). 에스델의 `alt_ref`(추가 본문 하위 절 — 미결39)는 `lxx_only` 가
 *   없는 장이라 이 규칙에 걸리지 않는다.
 * @param {BibleChapter} chapter @param {string} verseSpec
 * @returns {{ verses: import("../types").BibleVerse[], keys: string[] }}
 */
function selectVerses(chapter, verseSpec) {
  const all = chapter.verses || [];
  const keys = verseInstanceKeys(all);
  const hasLxx = all.some((v) => v.lxx_only);
  const hebrewMax = hasLxx ? all.reduce((mx, v) => (v.lxx_only ? mx : Math.max(mx, v.range_end || v.number)), 0) : 0;
  const greek = hasLxx && all.some((v) => v.lxx_only && v.number > hebrewMax && specCoversVerse(verseSpec, v.number));
  /** @type {import("../types").BibleVerse[]} */
  const verses = [];
  /** @type {string[]} */
  const selKeys = [];
  all.forEach((v, i) => {
    if (v.chapter_ref != null) return;
    if (v.lxx_only && !greek) return;
    const start = greek && !v.lxx_only && v.alt_ref != null ? v.alt_ref : v.number;
    const end = start === v.number && v.range_end != null ? v.range_end : start;
    let inSpec = false;
    for (let x = start; x <= end && !inSpec; x++) if (specCoversVerse(verseSpec, x)) inSpec = true;
    if (!inSpec) return;
    verses.push(v);
    selKeys.push(keys[i]);
  });
  return { verses, keys: selKeys };
}

/**
 * 슬롯의 ref 들 → ref 마다 그릴 절. 같은 장의 ref 둘이 겹치면 한 번만 그리되, 중복 키는 **장 + 절 인스턴스**다 —
 * 인스턴스 키(`verseInstanceKeys`)는 장 안에서만 유일해서 「요나 1:1-2:2」처럼 장을 넘는 독서(실데이터 32건 —
 * 시편 42, 43 · 창세 6:9-22, 7:24, 8:14-19 …)에서 2장 1절이 1장 1절과 같은 키로 떨어져 조용히 빠졌다(Copilot
 * 리뷰 1회차). DOM id 는 그대로 인스턴스 키다(`appendVerses` 의 `instanceKeys`).
 * @param {ReadingSlot} slot @param {(chapter: number) => BibleChapter | null | undefined} chapterOf
 * @returns {Array<{ chapter: number, spec: string, data: BibleChapter | null, verses: import("../types").BibleVerse[], keys: string[] }>}
 */
function slotVerseRuns(slot, chapterOf) {
  /** @type {Set<string>} */
  const seen = new Set();
  return (slot.refs || []).map((ref) => {
    const data = chapterOf(ref.chapter) || null;
    if (!data) return { chapter: ref.chapter, spec: ref.verseSpec, data: null, verses: [], keys: [] };
    const picked = selectVerses(data, ref.verseSpec);
    /** @type {import("../types").BibleVerse[]} */
    const verses = [];
    /** @type {string[]} */
    const keys = [];
    picked.verses.forEach((v, i) => {
      const k = `${ref.chapter}:${picked.keys[i]}`;
      if (seen.has(k)) return;
      seen.add(k);
      verses.push(v);
      keys.push(picked.keys[i]);
    });
    return { chapter: ref.chapter, spec: ref.verseSpec, data, verses, keys };
  });
}

/**
 * 반절 경계 표 한 행(엔진 `findHalfVerse`) → 그 절의 줄 가운데 남길 줄(0부터, 양 끝 포함)과 줄 안에서 자를 줄.
 * 상은 처음부터 경계까지, 하는 경계부터 끝까지다(사용자 결정 2026-10-22 — 데이터 `liturgical/half-verses.md`).
 * 나누지 않으면 null이다. 표에 없거나 「전체」인 반절(로마 3:22하), 표의 줄이 그려진 줄 수를 넘는 절이 그렇다 —
 * 데이터가 어긋나면 반절 대신 절 전체를 그리는 편이 낫다.
 * @param {number} lineCount @param {import("../types").HalfVerse | null | undefined} entry
 * @returns {{ first: number, last: number, cut: number | null, text: string | null } | null}
 */
function halfVerseLines(lineCount, entry) {
  if (!entry || entry.whole || !entry.line || entry.line > lineCount) return null;
  const i = entry.line - 1;
  const text = entry.text || null;
  const [first, last] = entry.half === "a" ? [0, i] : [i, lineCount - 1];
  if (!text && first === 0 && last === lineCount - 1) return null;
  return { first, last, cut: text ? i : null, text };
}

/**
 * 복사 출처의 연속 구간을 반절에서 가른다. 하로 자른 절은 구간의 첫 절로만, 상으로 자른 절은 끝 절로만 이어진다 —
 * 「24-34, 35하」 · 「12하-20상」 · 「14상, 22-32」. 성령강림 「시편 104:24-34, 35하」를 복사하면 출처가
 * 「104:24-35」로 35절 전체를 가리켰다(2026-10-22 발견).
 * @param {Array<[number, number]>} ranges @param {ReadonlyMap<number, string>} halves 절 번호 → "a"(상) | "b"(하)
 * @returns {Array<{ a: number, b: number, aHalf: string, bHalf: string }>}
 */
function halfVerseRanges(ranges, halves) {
  const piece = (/** @type {number} */ a, /** @type {number} */ b) =>
    ({ a, b, aHalf: halves.get(a) === "b" ? "하" : "", bHalf: halves.get(b) === "a" ? "상" : "" });
  /** @type {Array<{ a: number, b: number, aHalf: string, bHalf: string }>} */
  const out = [];
  for (const [a, b] of ranges) {
    let start = a;
    for (const [n, h] of [...halves].sort((x, y) => x[0] - y[0])) {
      if (n < start || n > b) continue;
      if (h === "b" && n > start) { out.push(piece(start, n - 1)); start = n; }
      else if (h === "a" && n < b) { out.push(piece(start, n)); start = n + 1; }
    }
    out.push(piece(start, b));
  }
  return out;
}

/**
 * 시편 슬롯 끝에 영광송을 붙이나 — 전례시편(`lps`)은 장을 불러왔으면 언제나, 송가(`cant`)는 장 JSON 의 `gloria` 가
 * `false` 가 아닐 때(창조송가 · 참회송가 · 찬양송가는 붙이지 않는다). 시편 자리의 일반 성서 본문(다니엘 · 요나 ·
 * 토비트)은 없다. 마지막 장을 못 불러왔으면 어느 쪽도 붙이지 않는다 — 「본문을 불러오지 못했습니다」 뒤에 영광송만
 * 홀로 남지 않게(Copilot 리뷰 3회차).
 * @param {ReadingSlot} slot @param {BibleChapter | null | undefined} lastChapter  슬롯 마지막 ref 의 장
 */
function wantsGloria(slot, lastChapter) {
  if (slot.slot !== "psalm" || !lastChapter) return false;
  if (slot.bookId === "lps") return true;
  if (slot.bookId === "cant") return lastChapter.gloria !== false;
  return false;
}

/** 송가 장 제목의 한국어 부분 — 「즈가리야 송가 Benedictus Dominus Deus」 → 「즈가리야 송가」. */
function canticleTitleOf(/** @type {BibleChapter | null | undefined} */ chapter) {
  const t = chapter && typeof chapter.chapter_title === "string" ? chapter.chapter_title : "";
  const ko = t.replace(/\s*[A-Za-z,.;:' ]+$/, "").trim();
  return ko || t;
}

/**
 * 대체 독서인가 — 기본 독서가 대축일, 주요축일, 고유 독서가 있는 축일인 날에 그날의 평일, 주일 독서다. 설정 「대체 독서 표시」를 끄면 전례독서 목록에서
 * 숨긴다(사용자 결정 2026-11-05, 2026-11-06, ADR-041 §4). 격자만 드니 사계재, 옮겨 지킬 수 있는 축일, 저녁 전례, 추수감사주일처럼 이름 있는 줄은 늘 보이고,
 * 삼일절과 명절(설날, 추석)의 평일 줄도 남는다. 공통 독서만 있는 축일은 격자가 기본 독서라 여기 들지 않으므로(`initialCandidate`), 등급이 축일인 기본 독서는 고유 독서가 있다.
 * 옮겨 지킬 수 있는 축일이 평일에 온 날의 평일 줄은 대체 독서이지만 숨기지 않는다(`optionalSundayOf`, 사용자 결정 2026-11-06).
 * @param {Candidate} c @param {Candidate} initial  그날의 기본 독서 후보
 */
function isAlternateReading(c, initial) {
  if (!isGrid(c) || c === initial) return false;
  const { rank, sanctoral_class: cls } = initial.observance;
  return rank === "principal" || rank === "major_feast" || (rank === "minor_feast" && cls !== "national");
}

/**
 * 뷰 모델 전부(순수). `groupsOf` 는 `findReadings(resolved, c)` 를 감싼 것 — 후보마다 한 번 호출한다.
 * @param {ResolvedDate} resolved @param {LectionaryQuery} query
 * @param {(c: Candidate) => ReadingGroup[]} groupsOf @param {CandidateCollects[]} collectEntries
 * @param {1 | 2 | null} storedTrack  기억된 트랙 — 마지막으로 고른 것(해를 넘어 유지)
 * @param {import("../types").ParishDedication[] | undefined} dedications  그날 축성되거나 축복된 교회(엔진 `findDedications`)
 * @param {boolean} showAlternates  대체 독서의 줄을 전례독서 목록에 보이는가(설정 「대체 독서 표시」). 기본값을 두지 않는다 — 값은 설정에서 받는다
 * @returns {LectionaryModel | null}  후보가 하나도 없으면 null(유효한 날짜에는 격자가 언제나 있어 생기지 않는다)
 */
function buildLectionaryModel(resolved, query, groupsOf, collectEntries, storedTrack, dedications = [], showAlternates) {
  const date = resolved.date;
  const initial = initialCandidate(resolved, groupsOf);
  if (!initial) return null;
  // 기리는 성인은 전례독서 목록에 없다 — 이름 줄에 보이고, 주소로 가리켜도 기본 독서다(사용자 결정 2026-11-03, 11-04, memorialOf)
  const memorial = memorialOf(resolved, initial, collectEntries);
  // 기념일도 전례독서 목록이 아니라 이름 줄에 「… 기념일」로 보인다 — 고유 본기도와 독서가 없어 눌러도 본문 없는 화면뿐이었다(사용자
  // 결정 2026-11-03). 그날 지키는 기념일(`proper`)만 이름 줄에 들고, 성주간에 생략된 기념일은 어느 줄에도 없다.
  const isCommemoration = (/** @type {Candidate} */ c) => c !== initial && c.observance.rank === "commemoration";
  const commemorations = resolved.candidates.filter((c) => isCommemoration(c) && c.status === "proper" && !c.evening);
  // 공통 독서 감추기를 끄면(HIDE_COMMON_READINGS) 공통 독서만 있는 기리는 성인도 전례독서 목록으로 돌아와 그 독서를 고를 수 있다(PR #463 리뷰)
  // 독서도 본기도도 없는 후보는 전례독서 목록에 넣지 않는다 — 눌러도 빈 화면뿐이다(사용자 결정 2026-11-04). 본문이 이동 축일 쪽에만
  // 있는 격자(왕이신 그리스도 주일의 연중 34주일, 성지주일의 사순 주일, 부활대축일의 부활 1주일 …)와 본문 없는 날(가정주일,
  // 평화통일주일, 세계평화를 위한 기도일 — 제목 아래 이름 줄에 보인다, `textlessDays`)이 그렇다. 엔진은
  // 후보를 그대로 둔다(설계서 §5.5 「후보를 버리지 않는다」 — 옮김 계산이 격자를 쓴다). 기본 독서 후보는 감추지 않는다.
  const textless = (/** @type {Candidate} */ c) => c !== initial && !groupsOf(c).length && !collectsFor(collectEntries, c).length;
  // 기념만 하거나 생략하는 후보는 누를 수 없는 글이다 — 고유 독서가 있어도 그날 화면을 옮기지 않는다(사용자 결정 2026-11-04). 기리는
  // 성인은 이름 줄의 「이름 축일」이고, 그 밖(성 십자가 발견, 사도 성 베드로의 탈옥 …)은 이름 줄에 이름만 보인다(`passiveDays`). 지역 축일
  // (`national` — 기념만 하는 날이 있는 것은 삼일절, 광복절)은 예외로 전례독서 목록에 둔다 — 주일에 지키지 않더라도 그날 독서를 볼 수 있게 한다(같은 날 사용자 결정).
  // 대체 독서인 축일(2.11 병자를 위한 기도일)도 그렇다 — 2.11이면 어느 해든 읽을 수 있게 넣은 독서다(사용자 결정 2026-11-07).
  const isPassive = (/** @type {Candidate} */ c) => c !== initial && c.observance.sanctoral_class !== "national" && !c.observance.alternate_readings
    && (c.status === "commemorated" || c.status === "omitted");
  // 옮겨 간 축일도 전례독서 목록에 넣지 않는다 — 제목 아래 안내로 알리고(`transferNotes`), 그 독서는 옮겨 간 날에 있다(사용자 결정 2026-11-04)
  const hiddenOwn = (/** @type {Candidate} */ c) => c.status === "transferred_out" || isCommemoration(c) || textless(c) || isPassive(c)
    || (HIDE_COMMON_READINGS && memorial.saints.includes(c) && !hasProperReadings(groupsOf(c)))
    || isHiddenCandidate(c, initial, groupsOf(c));
  // 전례독서 목록에 있는 이름 있는 후보와 독서 · 본기도가 똑같은 격자도 넣지 않는다 — 눌러도 같은 화면이다(사용자 결정 2026-11-04).
  // 대림1주일이 그렇다: 그날 기본 독서가 그해(가해 · 나해 · 다해)의 대림 1주일 독서라 「대림 1주일 (나해)」 격자가 같은 본문이다.
  // 후보가 하나만 남으면 전례독서 목록이 없다(buildChoices). 견줄 짝은 그날 지키는 이름 있는 후보뿐이다 — 생략된 후보나
  // 옮겨 간 후보와 본문이 같다고 격자를 감추면 그날 지키는 쪽이 목록에서 사라진다(PR #467 리뷰).
  const textKey = (/** @type {Candidate} */ c) => textKeyOf(groupsOf(c), collectsFor(collectEntries, c));
  const namedKeys = new Set(resolved.candidates
    .filter((c) => !isGrid(c) && !hiddenOwn(c) && !c.evening).map(textKey));
  const hidden = (/** @type {Candidate} */ c) => hiddenOwn(c) || (isGrid(c) && c !== initial && namedKeys.has(textKey(c)));
  // 본문 없는 날 — 기념일 줄 아래에 이름만 한 줄씩(사용자 결정 2026-11-04). 그날 지키거나 기념만 하는 것만 싣는다.
  const textlessDays = resolved.candidates.filter((c) => !isGrid(c) && !c.evening && !isCommemoration(c) && textless(c)
    && (c.status === "proper" || c.status === "commemorated"));
  // 공통 독서만 있어 감춘 후보는 넣지 않는다 — 성주간 평일에 생략되는 성인(2035-03-21 토마스 크랜머 등)은 화면에 보인 적이 없다.
  const passiveDays = resolved.candidates.filter((c) => isPassive(c) && !isCommemoration(c) && !textless(c) && !memorial.saints.includes(c)
    && !isHiddenCandidate(c, initial, groupsOf(c)));
  const transferNotes = resolved.candidates.flatMap((c) => (c.status === "transferred_out" && c.to
    ? [transferOutNote(c.observance.name, c.to)] : []));
  const picked = selectCandidate(resolved, query.obs, groupsOf);
  const selected = picked && hidden(picked) ? initial : picked;
  if (!selected) return null;

  const groups = groupsOf(selected);
  const tracks = tracksOf(groups);
  const track = pickTrack(groups, query.track, storedTrack);
  const defaults = { obs: initial.observance.id, track: null };   // 트랙은 언제나 적는다(hrefFor)
  const options = readingOptions(setsOf(groups, track), shortName(selected.observance.name));
  const setIndex = pickSet(options, query.set);
  const option = setIndex >= 0 ? options[setIndex] : null;
  const group = option ? option.group : null;
  const shortGroup = option ? option.short : null;
  const slots = slotsInOrder(group);

  const collects = collectsFor(collectEntries, selected);
  // 세트와 본기도가 같은 제목으로 짝지어지는 날은 세트가 본기도까지 정한다 — `?collect=` 는 읽지도 쓰지도 않고(사용자 결정
  // 2026-10-13 — `linkCollects`), 세트마다 전례독서 목록의 한 줄이다(아래 `choices`, 사용자 결정 2026-11-05).
  const linked = linkCollects(options, collects);
  const collectIndex = linked && setIndex >= 0 ? linked[setIndex] : pickCollect(collects, query.collect);
  const chosenCollect = collectIndex >= 0 ? collects[collectIndex] : null;
  const memorialCollects = selected === initial ? memorial.collects : [];

  const base = { obs: selected.observance.id, track, set: setIndex + 1, collect: !linked && chosenCollect ? collectIndex + 1 : null };
  // 후보마다 그 화면의 트랙 — 고른 후보는 지금 트랙, 다른 후보는 기억(없으면 첫 트랙). 트랙은 주소에 언제나 적으므로(hrefFor),
  // 전례독서 목록의 링크도 이것을 적는다(머지 전 검토 2026-10-14).
  const trackOf = (/** @type {Candidate} */ c) => (c === selected ? track : pickTrack(groupsOf(c), null, storedTrack));
  // 본기도 선택(`collect`)은 독서와 독립된 축이라 트랙 · 세트를 바꿔도 유지한다(Copilot 리뷰 1회차) — 세트와 본기도가
  // 제목으로 짝지어진 날만 예외로, 세트가 본기도를 정한다(`linked`).
  // 트랙이 바뀌면 세트는 그 트랙의 첫 세트로 돌아간다(세트는 트랙에 딸린 것).
  const trackHrefs = tracks.map((t) => ({ track: t, href: hrefFor(date, { ...base, track: t, set: null }, defaults), active: t === track }));
  const optionHrefs = options.map((_, i) => hrefFor(date, { ...base, set: i + 1 }, defaults));
  // 목록의 줄은 후보마다 하나이고, 세트와 본기도가 짝지어진 후보(5.1, 사계재 금요일)는 세트마다 하나다 — 이름이 곧 그 세트의
  // 제목이고 누르면 제목으로 올라간다(사용자 결정 2026-11-05. 전에는 「독서 · 본기도」 단추였다).
  // 설정이 감추는 것은 줄뿐이다 — `hidden`과 달리 주소로 가리키면 그 독서를 보인다. 공유한 링크가 받는 사람의 설정에 따라 다른 본문이 되지 않게 한다.
  // 옮겨 지킬 수 있는 축일이 평일에 온 날은 평일 줄을 설정과 상관없이 보이고, 이름 뒤에 「· 주의 봉헌 축일 대체 독서」를 붙인다 — 그 축일을
  // 주일로 옮겨 지키면 이날 읽는 독서다. 축일 줄에는 「· 1월 31일로 옮겨 지킬 수 있음」을 붙인다(사용자 결정 2026-11-06, ADR-041 §4).
  const optionalSunday = optionalSundayOf(initial, date);
  const originSuffix = (/** @type {Candidate} */ c) => (optionalSunday && c === initial ? optionalOriginSuffix(optionalSunday) : "");
  // 대체 독서인 축일(2.11 병자를 위한 기도일)은 줄 이름이 곧 축일 이름이라 「대체 독서」만 붙인다(사용자 결정 2026-11-07, ADR-038 §3).
  const alternateNote = (/** @type {Candidate} */ c) => (c.observance.alternate_readings ? "대체 독서"
    : optionalSunday && isGrid(c) ? alternateLabelOf(initial.observance.name) : null);
  const alternateSuffix = (/** @type {Candidate} */ c) => { const note = alternateNote(c); return note ? ` · ${note}` : ""; };
  const choices = resolved.candidates.filter((c) => !hidden(c)
    && (showAlternates || optionalSunday || c === selected || !isAlternateReading(c, initial))).flatMap((c) => {
    const own = c === selected;
    const sets = own ? options : readingOptions(setsOf(groupsOf(c), trackOf(c)), shortName(c.observance.name));
    const pair = own ? !!linked : !!linkCollects(sets, collectsFor(collectEntries, c));
    const rows = pair ? sets.map((o) => o.group) : [sets.length ? sets[0].group : null];
    // 설과 겹쳐 옮겨 온 축일(2049-02-03)은 줄에 「· 2월 2일에서 옮겨 옴」만 둔다 — 둘을 이으면 41자라 폭 320px에서 두 줄을 넘는다. 제목 아래 안내는 둘 다 알린다.
    const suffix = (statusSuffix(c) || originSuffix(c)) + alternateSuffix(c);
    return rows.map((g, i) => {
      const name = choiceNameOf(c, g, pair);
      return {
        candidate: c,
        name: shortName(name),
        suffix,
        title: name + suffix,
        href: hrefFor(date, { obs: c.observance.id, track: trackOf(c), set: pair ? i + 1 : null, collect: null }, defaults),
        active: own && (!pair || i === setIndex),
      };
    });
  });
  // 성인 축일이 둘 이상이고 색이 다르면 본기도 차례대로 「적색 또는 백색」(사용자 결정 2026-11-03 — memorialOf)
  const colorsOr = selected === initial && memorial.colors.length > 1;
  const { colors, colorAlt, ownColor } = colorsOr
    ? { colors: memorial.colors, colorAlt: /** @type {string[]} */ ([]), ownColor: false }
    : headerColors(resolved, selected);
  const empty = !groups.length && !collects.length;

  return {
    date, resolved, selected, initial, dayName: conditionTitle(group) || choiceNameOf(selected, group, !!linked),
    groups, tracks, track, options, setIndex, group, shortGroup, slots,
    cards: readingCards({ groups, baseName: shortName(selected.observance.name), options, setIndex, linked: !!linked, trackHrefs, optionHrefs }),
    choices,
    // 설과 겹쳐 옮겨 온 해(2049-02-03)는 상태 표시처럼 이어 「2월 2일에서 옮겨 옴 · 1월 31일로 옮겨 지킬 수 있음」이다
    selectedNote: [
      selectedNoteOf(selected),
      originSuffix(selected) && optionalSunday ? optionalOriginNote(optionalSunday) : null,
      alternateNote(selected),
    ].filter(Boolean).join(" · ") || null,
    collects, collectLabels: collectLabels(collects), collectIndex, collectsLinked: !!linked,
    ending: endingCodeOf(memorialCollects[memorialCollects.length - 1] || chosenCollect), memorialCollects,
    memorialSaints: memorial.saints, passiveDays, commemorations, textlessDays, dedicationLines: dedicationLines(dedications), transferNotes,
    colors, colorAlt, ownColor, colorsOr, fast: fastOf(resolved),
    cycle: resolved.coord.year && CYCLE_LABEL[resolved.coord.year] ? CYCLE_LABEL[resolved.coord.year] : null,
    empty,
    hrefs: {
      prev: stepHref(date, -1),
      next: stepHref(date, 1),
      today: "/lectionary",
      tracks: trackHrefs,
      options: optionHrefs,
      collects: collects.map((_, j) => hrefFor(date, { ...base, collect: j + 1 }, defaults)),
    },
  };
}
// ── END LECTIONARY_MODEL ──

// ── Chapter JSON cache ──
// Choice-row / segment changes re-run route(), and most of them re-use the chapters
// the previous render already fetched (the psalm, a shared gospel). A small
// bounded map keeps those renders instant without re-hitting the SW cache.
const CHAPTER_CACHE_MAX = 64;
/** @type {Map<string, BibleChapter>} */
const chapterCache = new Map();

/** @param {string} bookId @param {number} chapter @returns {Promise<BibleChapter | null>} */
async function cachedChapter(bookId, chapter) {
  const key = `${bookId}:${chapter}`;
  const hit = chapterCache.get(key);
  if (hit) return hit;
  try {
    const data = await loadChapter(bookId, chapter);
    if (chapterCache.size >= CHAPTER_CACHE_MAX) {
      const oldest = chapterCache.keys().next().value;
      if (oldest !== undefined) chapterCache.delete(oldest);
    }
    chapterCache.set(key, data);
    return data;
  } catch {
    return null;   // missing chapter — the slot shows a notice, the view still renders
  }
}

/**
 * Load every chapter the shown slots reference (deduped, in parallel).
 * @param {ReadingSlot[]} slots
 * @returns {Promise<Map<string, BibleChapter | null>>}
 */
async function loadSlotChapters(slots) {
  /** @type {Map<string, { bookId: string, chapter: number }>} */
  const needed = new Map();
  for (const s of slots) for (const r of s.refs || []) needed.set(`${s.bookId}:${r.chapter}`, { bookId: s.bookId, chapter: r.chapter });
  /** @type {Map<string, BibleChapter | null>} */
  const out = new Map();
  await Promise.all([...needed.entries()].map(async ([key, { bookId, chapter }]) => {
    out.set(key, await cachedChapter(bookId, chapter));
  }));
  return out;
}

// ── DOM ──

/**
 * 날짜를 다시 골라야 하는 실패(깨진 · 범위 밖 날짜 · 교회력에 없는 날) — 전체 화면 실패(DESIGN.md §6, views.js)의 다음 행동은
 * 「이번 달 캘린더」다. 머리의 위 단계도 이번 달의 캘린더로 간다(깨진 날짜에는 그 달이 없다).
 * @param {string} message  안 된 것
 * @returns {string} 페이지 메타의 제목
 */
function pickAnotherDate(message) {
  return renderLiturgicalFailure("lectionary", {
    message, subtitle: `「${THIS_MONTH_LABEL}」를 눌러 다른 날짜를 골라 주세요.`, action: "this-month",
  });
}

/**
 * 날짜 이동 줄의 원형 단추 하나. 링크가 없으면(계산 범위 끝) 자리만 지켜 가운데가 흔들리지 않게 한다. 방향이 글리프(‹ ›)와
 * 다시 그린 뒤 포커스를 돌려줄 자리(`data-focus-key` — `prev` · `next`, 라우터가 돌려준다 — helpers.js focusSpotOf)를 정한다.
 * 범위 끝으로 가 새 화면에 같은 단추가 없으면 「오늘」이 넘겨받는다(`data-focus-fallback`).
 * @param {"prev" | "next"} dir @param {string | null} href @param {string} label
 */
function buildDateStep(dir, href, label) {
  if (!href) return el("span", { className: "lect-datenav-btn", "aria-hidden": "true" });
  return el("a", {
    className: "lect-datenav-btn", href, "aria-label": label, "data-focus-key": dir, "data-focus-fallback": "today",
  }, dir === "prev" ? "‹" : "›");
}

/**
 * 캘린더와 전례독서의 머리(DESIGN.md §6 「날짜 이동 줄」, 사용자 결정 2026-11-07). 왼쪽 칸은 「오늘」, 가운데 칸은 ‹ 글자 ›,
 * 오른쪽 칸은 보기 전환 단추다. 화면마다 다른 것은 가운데 글자(날짜 `<time>` · 달)와 라벨, 단추가 가는 곳뿐이다. 모두 문장 안
 * 요소(`<a>` · `<span>` · `<button>`)라 머리의 `<h1>` 안에 넣을 수 있다. 「오늘」의 `data-focus-key`는 `today` — 앞뒤 단추가 자리만
 * 남는 범위 끝에서 포커스가 돌아갈 대체 자리다. 집 단추는 탭 바가 없는 데스크톱의 성서 목록 입구이고, 모바일은 CSS가 숨긴다.
 * @param {{ title: HTMLElement, todayHref: string,
 *   prev: { href: string | null, label: string }, next: { href: string | null, label: string },
 *   view?: { href: string, label: string, icon: string } }} o
 */
function commitDateBar(o) {
  const start = el("span", { className: "lect-bar-start" });
  start.appendChild(window.buildHomeBtn("/", "성서 목록으로"));
  start.appendChild(el("a", { className: "lect-today", href: o.todayHref, "data-focus-key": "today" }, "오늘"));
  const mid = el("span", { className: "lect-bar-mid" });
  mid.appendChild(buildDateStep("prev", o.prev.href, o.prev.label));
  mid.appendChild(el("span", { className: "lect-date" }, o.title));
  mid.appendChild(buildDateStep("next", o.next.href, o.next.label));
  const end = el("span", { className: "lect-bar-end" });
  if (o.view) {
    end.appendChild(el("a", {
      className: "title-view-btn", href: o.view.href, "aria-label": o.view.label, title: o.view.label, "data-focus-key": "view",
    }, headerIcon(o.view.icon)));
  }
  clearNode($title);
  $title.appendChild(start);
  $title.appendChild(mid);
  $title.appendChild(end);
}

/**
 * 머리에 보이는 날짜 — "2026-12-28" → "26.12.28"(YY.MM.DD, 요일 없음, 사용자 결정 2026-11-05). 스크린 리더는 숨긴 전체 날짜를 읽는다.
 * @param {{ y: number, m: number, d: number }} p
 */
function titleDateText(p) {
  return [p.y % 100, p.m, p.d].map((n) => String(n).padStart(2, "0")).join(".");
}

/**
 * 전례독서의 머리 — 제목 자리에 날짜 이동 줄을 그린다(사용자 결정 2026-11-03: 스크롤해도 날짜와 「오늘」이 보이고 하루씩 옮길
 * 수 있게. 그전엔 본문 맨 위 줄이었고, 머리에는 「전례독서」가 있었다). 「전례독서」는 문서 제목(setTitle)에 남는다. 보이는 날짜는
 * 짧은 표기이고(`titleDateText`), 스크린 리더는 숨긴 전체 날짜를 읽는다. 오른쪽 단추는 그 날짜가 든 달로 간다(ADR-038 §2).
 * @param {LectionaryModel} m
 */
function commitTitleDateNav(m) {
  const p = /** @type {{ y: number, m: number, d: number }} */ (parseDate(m.date));
  const label = el("time", { className: "lect-date-label", datetime: m.date });
  label.appendChild(el("span", { className: "sr-only" }, dateLabel(m.date)));
  label.appendChild(el("span", { "aria-hidden": "true" }, titleDateText(p)));
  commitDateBar({
    title: label,
    todayHref: m.hrefs.today,
    prev: { href: m.hrefs.prev, label: "전날" },
    next: { href: m.hrefs.next, label: "다음날" },
    view: { href: `/calendar/${m.date.slice(0, 7)}`, label: "월간으로 보기", icon: HEADER_ICON_PATHS.viewMonth },
  });
}

/** 색 점 + 라벨 하나. */
function buildColorMark(/** @type {string} */ color, /** @type {boolean} */ alt) {
  const wrap = el("span", { className: alt ? "lect-color-item lect-color-item--alt" : "lect-color-item" });
  wrap.appendChild(el("span", { className: `lect-color lit-swatch lit-swatch--${color}`, "aria-hidden": "true" }));
  wrap.appendChild(document.createTextNode((alt ? "대체 " : "") + (COLOR_LABEL[color] || color)));
  return wrap;
}

/** @param {LectionaryModel} m */
function buildHeader(m) {
  const head = el("header", { className: "lect-head" });

  // 이름은 고른 전례일의 것이다(사용자 결정 2026-11-04 — 그전엔 다른 전례일을 골라도 기본 독서의 이름이라 제목과 본문이 어긋났다).
  // 처음에는 그날의 기본 독서(initialCandidate)를 고른 것이라, 고유 독서가 없는 축일의 날은 평일 이름이다(11.6 레오나드 날은
  // 「연중 31주 금요일」, 2026-11-03). 조건부 세트를 고르면 그 조건의 이름이다(conditionTitle). 색은 그대로 headerColors.
  head.appendChild(el("h2", { className: "lect-day" }, m.dayName || "—"));

  // 전례색과 해(가해 … , 짝수해 · 홀수해)는 제목 바로 아래, 회색 설명 줄들보다 먼저(사용자 결정 2026-11-03)
  const meta = el("p", { className: "lect-meta" });
  const colors = el("span", { className: m.ownColor ? "lect-colors lect-colors--own" : "lect-colors", role: "group", "aria-label": "전례색" });
  // 성인 축일이 둘 이상이고 색이 다르면 「적색 또는 백색」(colorsOr) — 그 밖에 둘이면 함께 적는 색(사계재 날 [자, 백])
  m.colors.forEach((c, i) => {
    if (i > 0 && m.colorsOr) colors.appendChild(el("span", { className: "lect-color-or" }, "또는"));
    colors.appendChild(buildColorMark(c, false));
  });
  for (const c of m.colorAlt) colors.appendChild(buildColorMark(c, true));
  meta.appendChild(colors);
  if (m.cycle) meta.appendChild(el("span", { className: "lect-meta-item" }, m.cycle));
  if (m.fast) meta.appendChild(el("span", { className: "lect-meta-item lect-fast" }, FAST_LABEL[m.fast]));
  for (const p of m.resolved.periods || []) meta.appendChild(el("span", { className: "lect-meta-item lect-period" }, p.name));
  head.appendChild(meta);

  // 제목의 전례일을 설명하므로 기리는 성인 줄보다 먼저(2026-11-03, selectedNoteOf)
  if (m.selectedNote) head.appendChild(el("p", { className: "lect-day-note" }, m.selectedNote));
  // 그날에서 옮겨 간 축일 — 같은 자리의 안내로(사용자 결정 2026-11-04, transferOutNote)
  for (const note of m.transferNotes) head.appendChild(el("p", { className: "lect-day-note" }, note));
  // 그날 기리는 성인과 기념일 — 제목 아래에 한 줄씩, 이름 뒤에 「축일」 · 「기념일」(사용자 결정 2026-11-03,
  // memorialOf). 다른 전례일을 눌러도 그대로다. 성인 줄 다음은 기념만 하거나 생략하는 그 밖의 후보다 — 「성 십자가 발견」(2026-11-04).
  // 그 아래에 본문 없는 날(가정주일, 세계평화를 위한 기도일 …)을 이름만
  // 한 줄씩 — 이름이 이미 「주일」 · 「기도일」로 끝나 꼬리를 붙이지 않는다(사용자 결정 2026-11-04). 맨 아래에 그날 축성되거나
  // 축복된 교회를 종류마다 한 줄씩(같은 날 사용자 결정 — dedicationLines).
  const lines = [
    ...m.memorialSaints.map((c) => `${c.observance.name || ""} 축일`),
    ...m.passiveDays.map((c) => shortName(c.observance.name) + statusSuffix(c)),
    ...m.commemorations.map((c) => `${c.observance.name || ""} 기념일`),
    ...m.textlessDays.map((c) => String(c.observance.name || "")),
    ...m.dedicationLines,
  ];
  if (lines.length) {
    const saints = el("p", { className: "lect-day-saints" });
    for (const line of lines) saints.appendChild(el("span", { className: "lect-day-saint" }, line));
    head.appendChild(saints);
  }
  const choices = buildChoices(m);
  if (choices) head.appendChild(choices);
  return head;
}

/**
 * 전례독서 목록 — 다른 후보를 제목 아래에 한 줄씩 링크로 그린다(사용자 결정 2026-11-04, ADR-038 §3 「전례일 스위처」).
 * 기념만 하거나 생략하는 후보는 링크가 아니라 이름 줄의 글이다. 고른 후보는 제목이라 줄이 없고, 후보가 하나뿐이면 고를 것이 없어 그리지 않는다. 이름은 밑줄 링크이고 뒤에 상태 표시(「· 저녁」)가 온다.
 * 누른 줄은 제목으로 올라가 사라지므로 포커스는 후보가 아니라 줄의 자리로 돌려준다(WCAG 2.4.3). 후보가 둘이면 Enter를 거듭 눌러 오갈 수 있다.
 * @param {LectionaryModel} m @returns {HTMLElement | null}
 */
function buildChoices(m) {
  const others = m.choices.filter((c) => !c.active);
  if (!others.length) return null;
  const nav = el("nav", { className: "lect-choices", "aria-label": "이날의 다른 전례" });
  others.forEach((c, i) => {
    nav.appendChild(el("a", { className: "lect-choice", href: c.href, title: c.title, "data-focus-key": `choice:${i}` },
      el("span", { className: "lect-choice-text" }, el("span", { className: "lect-choice-name" }, c.name), c.suffix)));
  });
  return nav;
}

/**
 * 트랙을 고르면 기억한다 — 연중 주일의 트랙만이다. 마지막 트랙이 날짜와 해를 가리지 않고 기본값이다(사용자 결정 2026-10-13, ADR-038 §3).
 * 부활주일 같은 날의 카드는 뜻이 달라 기억하지 않는다(사용자 결정 2026-11-05). 전역 <a> 가로채기는 이 리스너 뒤에 이동한다.
 * @param {HTMLElement} a @param {1 | 2 | null} track
 */
function rememberTrackOnClick(a, track) {
  if (!track) return;
  a.addEventListener("click", (e) => {
    // 라우터(routing.js)가 가로채는 기본 클릭일 때만 — Ctrl/Cmd · Shift · 가운데 버튼은 새 탭 · 창으로 가는
    // 표준 링크 동작이라 지금 탭의 URL과 기억을 건드리지 않는다(Copilot 리뷰 3회차; 조건은 라우터와 같은
    // helpers.js isModifiedClick 하나 — PR #348 리뷰).
    if (e.defaultPrevented || isModifiedClick(e)) return;
    // 지금 항목의 주소에는 렌더할 때 이미 트랙이 적혀 있어(renderLectionaryView — withTrack) 기억을 바꿔도 뒤로 가기가
    // 이 화면으로 돌아온다(Copilot 리뷰 1 · 5회차의 클릭 때 보정을 렌더 때로 옮겼다 — 자체 리뷰 2026-10-13).
    saveLectionaryTrack(track);
  });
}

/**
 * 독서 카드 — 고를 수 있는 독서마다 모든 항목의 성구를 적은 카드다. 두 독서를 누르지 않고 견주고, 주보의 성구로 찾을 수 있다. 접으면 카드 대신
 * 제목 옆에 이름 알약이나 번호가 남아 그 자리에서 바꿀 수 있다(사용자 결정 2026-11-05, ADR-038 §3). 접기는 화면 안의 동작이라 주소에 적지 않고
 * 다시 그리지 않는다. 포커스는 누른 단추에 그대로 있다.
 * @param {LectionaryModel} m @returns {HTMLElement | null}
 */
function buildReadingCards(m) {
  if (!m.cards) return null;
  const section = el("section", { className: "lect-section lect-cards" });
  const head = el("div", { className: "lect-section-head lect-collect-head" });
  head.appendChild(el("h3", { className: "lect-slot" }, "독서"));

  // 접은 모양 — 이름이 「독서 N」이면 본기도 번호와 같은 번호이고, 이름이 있으면 알약이다. 포커스 자리를 카드와 나눈다(같은 화면에 함께 있다).
  const numbered = m.cards.every((c) => /^독서 \d+$/.test(c.name));
  const pills = el("nav", { className: numbered ? "lect-collect-nums" : "lect-collect-nums lect-cards-pills", "aria-label": "독서 선택" });
  for (const c of m.cards) {
    const a = el("a", {
      className: c.active ? "lect-collect-num active" : "lect-collect-num",
      href: c.href,
      "aria-label": c.name,
      "data-focus-key": `folded:${c.focusKey}`,
    });
    if (c.active) a.setAttribute("aria-current", "page");
    a.appendChild(el("span", { className: "lect-collect-num-mark" }, numbered ? c.name.replace(/^독서 /, "") : c.name));
    rememberTrackOnClick(a, c.track);
    pills.appendChild(a);
  }
  head.appendChild(pills);

  const button = el("button", { type: "button", className: "lect-cards-fold", "aria-controls": "lect-cards-list" });
  const buttonText = el("span", {}, "접기");
  button.appendChild(buttonText);
  head.appendChild(button);
  section.appendChild(head);

  // 펼친 모양 — 카드 두 장을 나란히, 같은 항목끼리 줄을 맞춘다(한 장의 줄 수는 항목 수 + 이름 줄)
  const list = el("nav", { className: "lect-cards-list", id: "lect-cards-list", "aria-label": "독서 선택" });
  const rows = Math.max(...m.cards.map((c) => c.refs.length)) + 1;
  list.style.setProperty("--lect-card-rows", String(rows));
  for (const c of m.cards) {
    const a = el("a", { className: c.active ? "lect-card active" : "lect-card", href: c.href, "data-focus-key": c.focusKey });
    if (c.active) a.setAttribute("aria-current", "page");
    a.appendChild(el("span", { className: "lect-card-name" }, c.name));
    for (const r of c.refs) {
      a.appendChild(el("span", { className: r.differs ? "lect-card-ref lect-card-ref--differs" : "lect-card-ref" }, r.label));
    }
    rememberTrackOnClick(a, c.track);
    list.appendChild(a);
  }
  section.appendChild(list);

  const applyFolded = (/** @type {boolean} */ folded) => {
    pills.hidden = !folded;
    list.hidden = folded;
    buttonText.hidden = folded;
    button.setAttribute("aria-expanded", String(!folded));
    button.setAttribute("aria-label", folded ? "독서 목록 펼치기" : "독서 목록 접기");
  };
  applyFolded(loadLectionaryCardsFolded());
  button.addEventListener("click", () => {
    const folded = !list.hidden;
    applyFolded(folded);
    saveLectionaryCardsFolded(folded);
  });
  return section;
}

/**
 * 본기도 대체안 번호 — 제목 옆 같은 줄의 작은 번호(「본기도 ❶ 2」, 사용자 결정 2026-11-05). 세그먼트는 기도문 한 문단을 바꾸는
 * 선택에 한 줄을 통째로 썼다. 보이는 글자는 이름에서 「본기도 」를 뗀 것이고 접근 가능한 이름은 이름 전체라, 보이는 글자가
 * 이름 안에 있다(WCAG 2.5.3).
 * @param {LectionaryModel} m
 */
function buildCollectNumbers(m) {
  const nav = el("nav", { className: "lect-collect-nums", "aria-label": "본기도 대체안" });
  m.collects.forEach((_, i) => {
    const label = m.collectLabels[i];
    const active = i === m.collectIndex;
    const a = el("a", {
      className: active ? "lect-collect-num active" : "lect-collect-num",
      href: m.hrefs.collects[i],
      "aria-label": label,
      "data-focus-key": `collect:${i + 1}`,
    });
    if (active) a.setAttribute("aria-current", "page");
    a.appendChild(el("span", { className: "lect-collect-num-mark" }, label.replace(/^본기도 /, "")));
    nav.appendChild(a);
  });
  return nav;
}

/** @param {LectionaryModel} m */
function buildCollects(m) {
  if (!m.collects.length) return null;
  const section = el("section", { className: "lect-section lect-collects", "data-slot": "collect" });
  const head = el("div", { className: "lect-section-head lect-collect-head" });
  head.appendChild(el("h3", { className: "lect-slot" }, "본기도"));
  // 세트와 짝지어진 날은 전례독서 목록의 줄이 고른다 — 따로 번호를 두지 않는다(사용자 결정 2026-10-13, 2026-11-05).
  if (m.collects.length > 1 && !m.collectsLinked) head.appendChild(buildCollectNumbers(m));
  section.appendChild(head);
  const o = m.collects[Math.max(m.collectIndex, 0)];
  const art = el("article", { className: "lect-collect chapter-text", lang: "ko" });
  art.appendChild(el("p", { className: "lect-collect-text" }, o.text));
  // 기리는 성인의 본기도 — 기본 독서의 본기도 다음, 송영 앞(memorialOf).
  for (const mc of m.memorialCollects) art.appendChild(el("p", { className: "lect-collect-text" }, mc.text));
  section.appendChild(art);
  // 송영 — 고른 본기도(기리는 성인의 본기도가 있으면 마지막 것) 뒤에 1회(ADR-036 §3).
  section.appendChild(el("p", { className: "lect-ending chapter-text", lang: "ko" }, ENDINGS[m.ending]));
  return section;
}

/** 영광송 — 선창 ◯ 응답, 계응 시편과 같은 표지(`responsory-mark` · `verse-response`). */
/** 영광송 블록의 복사 글자 — 줄마다 한 줄, 선창 줄 끝에 「 ◯」(시편 본문 복사와 같은 방식). @param {Element} box @returns {string} */
function gloriaCopyText(box) {
  return [...box.querySelectorAll(".lect-gloria-line")]
    .map((line) => [...line.childNodes].map((c) => (c.textContent || "").trim()).filter(Boolean).join(" "))
    .join("\n");
}

function buildGloria() {
  const box = el("div", { className: "lect-gloria", lang: "ko", role: "group", "aria-label": "영광송" });
  const v = el("span", { className: "lect-gloria-line" }, GLORIA.versicle);
  v.appendChild(el("span", { className: "responsory-mark", "aria-hidden": "true" }, "◯"));
  box.appendChild(v);
  box.appendChild(el("span", { className: "lect-gloria-line verse-response" }, GLORIA.response));
  return box;
}

/**
 * 괄호 선택 구절 표시 — 선택 구절인 절 span 에 `lect-optional` 을 달고, 이어진 묶음의 앞뒤에 〔 〕 를 넣는다
 * (책자의 「(9-23)」 표기 — 사용자 결정 2026-10-12). `appendVerses` 가 그린 뒤에 돈다.
 * @param {HTMLElement} article @param {number} chapter @param {(chapter: number, n: number) => boolean} isOptional
 */
function markOptionalVerses(article, chapter, isOptional) {
  const spans = /** @type {HTMLElement[]} */ ([...article.querySelectorAll(".verse[data-vref]")]);
  const optAt = (/** @type {number} */ i) => {
    const n = parseInt(spans[i].getAttribute("data-vref") || "", 10);
    return Number.isFinite(n) && isOptional(chapter, n);
  };
  spans.forEach((span, i) => {
    if (!optAt(i)) return;
    span.classList.add("lect-optional");
    // 표시 전용 — aria-hidden · user-select: none 에 더해 복사 본문에서도 뺀다(`data-copy-omit`, verse-spec.js 직렬화 — Copilot 리뷰 10회차)
    if (i === 0 || !optAt(i - 1)) span.insertBefore(el("span", { className: "lect-bracket", "aria-hidden": "true", "data-copy-omit": "" }, "〔"), span.firstChild);
    if (i === spans.length - 1 || !optAt(i + 1)) span.appendChild(el("span", { className: "lect-bracket", "aria-hidden": "true", "data-copy-omit": "" }, "〕"));
  });
}

/**
 * 반절(상 → `a` · 하 → `b`, ADR-037 §1)을 경계 표대로 그린다(엔진 `findHalfVerse` — 데이터
 * `lectionary/half-verses.json`, 사용자 결정 2026-10-22). 표는 줄 경계를 주거나(상은 그 줄까지, 하는 그 줄부터) 줄
 * 안의 경계 문구를 준다(상은 문구까지, 하는 문구부터 — 한 줄 절도 나눈다). 표에 없거나 「전체」인 반절, 표와 줄이
 * 맞지 않는 절은 절 전체를 그대로 둔다(`halfVerseLines`).
 * 남은 첫 줄로 절 번호(`sup.verse-num` · U+2060)와 id 를 옮기고, 번호를 「35하」처럼 적는다(사용자 결정
 * 2026-10-22 — 독서 제목과 복사 출처, 게시글과 같게). 뒷줄을 버리면 선창 끝 ◯ 도 뗀다. 자른 절은 article 의
 * `data-halves`(「35b」)에 적어 복사 출처가 읽는다(`copyCitation`).
 * @param {HTMLElement} article @param {string} verseSpec @param {string} bookId @param {number} chapter
 */
function trimHalfVerses(article, verseSpec, bookId, chapter) {
  /** @type {string[]} */
  const trimmed = [];
  for (const tok of String(verseSpec || "").split(",")) {
    const m = /^(\d+)([ab])$/.exec(tok.trim());
    if (!m) continue;
    const half = m[2] === "a" ? "a" : "b";
    // 그 번호의 본절만 — 같은 번호의 ¶ 구절(「35_v」) · 그리스어 · 옮겨 실린 절은 인스턴스 키가 「35_」로 시작한다
    const spans = /** @type {HTMLElement[]} */ ([...article.querySelectorAll(`.verse[data-vkey^="${m[1]}/"]`)]);
    const keep = halfVerseLines(spans.length, findHalfVerse(bookId, chapter, Number(m[1]), half));
    if (!keep) continue;
    const first = spans[keep.first], last = spans[keep.last];
    if (keep.cut !== null && keep.text && !cutLineText(spans[keep.cut], keep.text, half === "b")) continue;
    if (first !== spans[0]) {
      // 절 번호 · id 를 남는 첫 줄로 — sup 뒤의 U+2060 도 함께
      const lead = [...spans[0].childNodes].filter((n) => n instanceof HTMLElement
        ? n.classList.contains("verse-num") || n.classList.contains("versicle-mark")
        : n.nodeType === Node.TEXT_NODE && n.textContent === "\u2060");
      for (const n of lead.reverse()) first.insertBefore(n, first.firstChild);
      first.id = spans[0].id;
      dropSiblings(spans[0], /** @type {Element} */ (first.previousElementSibling));
    }
    if (last !== spans[spans.length - 1]) {
      last.querySelectorAll(".responsory-mark").forEach((n) => n.remove());
      dropSiblings(/** @type {Element} */ (last.nextElementSibling), spans[spans.length - 1]);
    }
    const num = first.querySelector(".verse-num");
    if (num) num.setAttribute("data-v", `${num.getAttribute("data-v") || m[1]}${half === "a" ? "상" : "하"}`);
    trimmed.push(`${m[1]}${half}`);
  }
  if (trimmed.length) article.setAttribute("data-halves", trimmed.join(","));
}

/** 형제 요소 `from`부터 `to`까지(둘 다 포함, 문서 순서) 지운다 — 버리는 줄과 그 사이의 시행 · 단락 · 연 구분 표지. */
function dropSiblings(/** @type {Element} */ from, /** @type {Element} */ to) {
  for (let n = /** @type {Element | null} */ (from); n; ) {
    const next = n.nextElementSibling;
    n.remove();
    if (n === to) break;
    n = next;
  }
}

/**
 * 한 줄 span 안에서 경계 문구를 찾아 앞(하) 또는 뒤(상)를 지운다. 본문 글자만 센다 — 절 번호(CSS 로 그린다) ·
 * U+2060 · ¶ · ◯ 는 문구에 들지 않는다(표의 문구는 데이터의 본문 글자다). 문구가 그 줄에 꼭 한 번 나오지 않으면
 * false — 절 전체가 남는다. 상을 자르면 줄 끝 공백도 잘리므로 한 칸을 되돌려 다음 절과 띄운다(appendVerses 의 줄 끝 공백).
 * @param {HTMLElement} span @param {string} text @param {boolean} keepTail 하(문구부터 남긴다)
 */
function cutLineText(span, text, keepTail) {
  /** @type {Array<[Text, number]>} */
  const nodes = [];
  let joined = "";
  const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  for (let n = /** @type {Text | null} */ (walker.nextNode()); n; n = /** @type {Text | null} */ (walker.nextNode())) {
    if (n.textContent === "\u2060" || n.parentElement?.closest(".verse-num, .pilcrow, .versicle-mark, .responsory-mark")) continue;
    nodes.push([n, joined.length]);
    joined += n.textContent;
  }
  const at = joined.indexOf(text);
  if (at < 0 || joined.indexOf(text, at + 1) >= 0) return false;
  const pos = keepTail ? at : at + text.length;
  const hit = nodes.filter(([, s]) => s <= pos).pop();
  if (!hit) return false;
  const [node, offset] = hit;
  const range = document.createRange();
  if (keepTail) {
    // 절 번호 · U+2060 뒤부터 문구 앞까지 — 줄 머리의 ¶ 도 버리는 앞부분에 든다
    const lead = [...span.childNodes].filter((n) => n instanceof HTMLElement
      ? n.classList.contains("verse-num") || n.classList.contains("versicle-mark")
      : n.nodeType === Node.TEXT_NODE && n.textContent === "\u2060").pop();
    if (lead) range.setStartAfter(lead); else range.setStart(span, 0);
    range.setEnd(node, pos - offset);
  } else {
    range.setStart(node, pos - offset);
    range.setEndAfter(/** @type {Node} */ (span.lastChild));
  }
  range.deleteContents();
  if (!keepTail) span.appendChild(document.createTextNode(" "));
  return true;
}

/**
 * @param {LectionaryModel} m @param {ReadingSlot} slot @param {Map<string, BibleChapter | null>} chapters
 */
function buildReading(m, slot, chapters) {
  const section = el("section", { className: "lect-section lect-reading", "data-slot": slot.slot });
  // 복사 출처(copyCitation)가 읽는 표지 — 전례시편 · 송가는 기도서 번역이라 「(대한성공회 기도서)」로 적는다(ADR-037 §1 · §3 · 사용자 결정 2026-10-13)
  if (slot.bookId === "lps" || slot.bookId === "cant") section.setAttribute("data-liturgical", "");
  const head = el("div", { className: "lect-section-head" });
  head.appendChild(el("h3", { className: "lect-slot" }, SLOT_LABEL[slot.slot] || slot.slot));
  head.appendChild(el("span", { className: "lect-ref" }, slot.label || ""));
  const refs = slot.refs || [];
  const lastChapter = refs.length ? chapters.get(`${slot.bookId}:${refs[refs.length - 1].chapter}`) : null;
  if (slot.bookId === "cant") {
    const title = canticleTitleOf(lastChapter);
    if (title && !(slot.label || "").includes(title)) head.appendChild(el("span", { className: "lect-canticle" }, title));
    // 송가는 장 번호가 성서의 장이 아니다 — 출처는 송가 이름 + 고른 절(「즈가리야 송가 1-3」)
    if (title) section.setAttribute("data-canticle", title);
  }
  // 괄호 선택 구절 세트에 합쳐진 슬롯 — 긴 본문을 싣고 짧은 본문이 어디까지인지 적는다.
  const shortRaw = m.shortGroup ? m.shortGroup.readings.find((r) => r && r.slot === slot.slot) || null : null;
  const shortSlot = shortRaw && shortRaw.label !== slot.label ? shortRaw : null;
  if (shortSlot) head.appendChild(el("span", { className: "lect-caption lect-optional-note" }, `〔 〕 안은 선택 구절 — 짧게 읽으면 ${shortSlot.label}`));
  const isOptional = optionalVerseTest(slot, shortSlot);
  section.appendChild(head);

  // ref 마다 한 <article> — 같은 장의 ref 둘이 겹치면 한 번만(키는 장 + 절 인스턴스, `slotVerseRuns`).
  for (const run of slotVerseRuns(slot, (ch) => chapters.get(`${slot.bookId}:${ch}`))) {
    if (!run.data) {
      // 안쪽 책 id 대신 독서 라벨, 화면을 그릴 때 함께 나오는 정적 문구라 live region 이 아니다(자체 리뷰 2026-10-13)
      section.appendChild(el("p", { className: "lect-missing" }, `본문을 불러오지 못했습니다 — ${slot.label || ""}`));
      continue;
    }
    if (!run.verses.length) continue;
    // `data-chapter-last` = 그 장의 실제 마지막 절(병합 절은 끝 번호) — 복사 참조가 장 경계에서 정말 이어지는지 가리는 기준
    const chapterLast = run.data.verses.reduce((mx, v) => Math.max(mx, Number(v.range_end) || v.number), 0);
    const article = el("article", { className: "chapter-text", lang: "ko", "data-chapter": String(run.chapter), "data-chapter-last": String(chapterLast), "data-book": run.data.book_name_ko || slot.bookId });
    // 이 번역에 없는 절 번호(장 전체 기준 — 발췌가 건너뛴 절과 다르다) — 복사 출처가 그 자리에서 구간을 끊지 않게(사용자 결정 2026-10-14)
    const absent = absentVerseNumbers(run.data.verses);
    if (absent.length) article.setAttribute("data-absent", absent.join(","));
    // Clean 봉독 surface (ADR-035): cite chips off, no parallels, no note anchors. 한 화면에 슬롯 · 장이 여럿이라
    // 절 id 에 슬롯 · 책 · 장 접두를 붙여 문서 안에서 유일하게(Copilot 리뷰 7회차).
    appendVerses(article, run.verses, { hideCites: true, instanceKeys: run.keys, idPrefix: `${slot.slot}-${slot.bookId}-${run.chapter}-` });
    trimHalfVerses(article, run.spec, slot.bookId, run.chapter);
    if (shortSlot) markOptionalVerses(article, run.chapter, isOptional);
    section.appendChild(article);
  }
  if (wantsGloria(slot, lastChapter)) section.appendChild(buildGloria());
  return section;
}

/**
 * 독서 섹션 하나의 복사 출처(`bindCopyAttribution` 의 citeOf — `commit` 이 뷰 루트에 한 번 묶는다). 고른 절을 장마다
 * 연속 구간으로 적고, 앞 장이 **그 장의 실제 마지막 절**(`data-chapter-last`)에서 끝나 다음 장이 1절에서 이어질 때만
 * 「42:11-43:1」로 합친다 — 창세 6:9-22, 7:24 · 지혜 18:14-16, 19:1-6 처럼 발췌가 끊긴 것은 「18:16, 19:1」. 송가는
 * 「송가 이름 + 절」이다(자체 리뷰 2026-10-13). 반절로 그린 절은 「35하」 「21상」으로 적고 그 자리에서 구간을 가른다
 * (「24-34, 35하」 — `halfVerseRanges`, 2026-10-22). 번역 표기는 성서가 「(공동번역성서)」, 전례시편 · 송가가 「(대한성공회 기도서)」
 * (사용자 결정 2026-10-13 — `citationSource`).
 * @param {HTMLElement} unit @param {Array<{ article: HTMLElement, ranges: Array<[number, number]>, firstNum: number, lastNum: number, atStart: boolean, atEnd: boolean }>} runs
 */
function copyCitation(unit, runs) {
  const canticle = unit.getAttribute("data-canticle");
  const liturgical = unit.hasAttribute("data-liturgical");
  if (canticle) return `${canticle} ${formatVerseRanges(runs.flatMap((r) => r.ranges))} ${citationSource(true)}`;
  const book = runs[0].article.getAttribute("data-book") || "";
  /** @type {Array<{ ch: string, a: number, b: number, aHalf: string, bHalf: string, chEnd: string | null }>} */
  const pieces = [];
  runs.forEach((r, i) => {
    const ch = r.article.getAttribute("data-chapter") || "";
    const prevRun = runs[i - 1];
    // 반절로 그린 절(trimHalfVerses 의 `data-halves` — 「35b」)은 「35하」로 적고, 그 자리에서 구간을 가른다
    const halves = new Map((r.article.getAttribute("data-halves") || "").split(",").filter(Boolean)
      .map((t) => [parseInt(t, 10), t.slice(-1)]));
    halfVerseRanges(r.ranges, halves).forEach(({ a, b, aHalf, bHalf }, j) => {
      const prev = pieces[pieces.length - 1];
      const continues = !!prevRun && j === 0 && !!prev && prevRun.atEnd && r.atStart && a === 1 && !prev.bHalf && !aHalf
        && prev.b === Number(prevRun.article.getAttribute("data-chapter-last"));
      if (continues && prev) { prev.b = b; prev.bHalf = bHalf; prev.chEnd = ch; } else pieces.push({ ch, a, b, aHalf, bHalf, chEnd: null });
    });
  });
  let out = "";
  /** @type {string | null} */
  let lastCh = null;
  for (const p of pieces) {
    const [a, b] = [`${p.a}${p.aHalf}`, `${p.b}${p.bHalf}`];
    const body = p.chEnd ? `${a}-${p.chEnd}:${b}` : p.a === p.b ? `${p.a}${p.aHalf}${p.bHalf}` : `${a}-${b}`;
    out += (out ? ", " : "") + (p.ch !== lastCh ? `${p.ch}:` : "") + body;
    lastCh = p.chEnd || p.ch;
  }
  return `${book} ${out} ${citationSource(liturgical)}`;
}

/**
 * 쿼리에 `track`을 적은 문자열 — `hrefFor`와 같은 키 순서(obs → track → set → collect)를 지켜 같은 상태가 같은 주소가 되게.
 * @param {string} search `location.search` @param {1 | 2} track @returns {string}
 */
function withTrack(search, track) {
  const cur = new URLSearchParams(search);
  const q = new URLSearchParams();
  for (const k of ["obs", "track", "set", "collect"]) {
    const v = k === "track" ? String(track) : cur.get(k);
    if (v) q.set(k, v);
  }
  for (const [k, v] of cur) if (!q.has(k)) q.append(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * 화면 안에서 날짜 · 전례일이 바뀌면 고정 문구 「전례독서」(setTitle) 대신 그날을 읽힌다 — 장 이동이 「창세기 2장」을
 * 읽는 것과 같은 몫(자체 리뷰 2026-10-13).
 * @param {LectionaryModel} m
 */
function announceDay(m) {
  announce(`${dateLabel(m.date)} — ${shortName(m.dayName)} ${PAGE_TITLE}`);
}

/**
 * Commit the whole view — synchronous, called only after every await resolved
 * and the route is still current.
 * @param {LectionaryModel} m @param {Map<string, BibleChapter | null>} chapters
 */
function commit(m, chapters) {
  // 문서 제목 「전례독서」 · 오디오 바(views.js), 머리의 제목 자리에는 날짜 이동 줄(사용자 결정 2026-11-03).
  commitLiturgicalTitle("lectionary");
  commitTitleDateNav(m);
  clearNode($app);
  // 날짜가 바뀌면 새 날은 맨 위부터 — 날짜 이동은 스크롤해도 보이는 머리에 있어 읽던 자리에서 누른다. 자료가 이미 있으면
  // 스켈레톤이 그려지기 전에 이 화면이 들어와 스크롤이 그대로 남았다. 같은 날의 전례독서 목록 · 독서 카드는 누른 자리로 돌아오고(라우터),
  // 뒤로 가기는 이 뒤에 떠날 때의 스크롤을 되살린다(tab-history.js onRouteEnd).
  const newDay = m.date !== committedDate;
  committedDate = m.date;

  const root = el("div", { className: "lectionary" });
  // 붙이기 · 알리기 — 빈 전례일 화면도 같은 끝이다. 누른 컨트롤로 포커스를 돌려주는 것은 그 뒤 라우터의 몫이다(routing.js).
  const finish = () => {
    $app.appendChild(root);
    if (newDay && window.scrollY !== 0) window.scrollTo({ top: 0, behavior: "instant" });
    announceDay(m);
  };
  root.appendChild(buildHeader(m));

  if (m.empty) {
    const rank = m.selected.observance.rank;
    const isCommemoration = rank === "commemoration";
    root.appendChild(emptyState({
      icon: null,
      title: isCommemoration ? "기념일 — 본문 없음" : "고유 본문 없음",
      // 본문 없는 후보는 2026-11-04부터 전례독서 목록에 없고 주소로 가리켜도 기본 독서다. 그래서 이 화면은 기본 독서 후보 자신이 비었을
      // 때만 나온다(실데이터 2025-2027에는 없다 — lectionary.data.test.js). 본문 없는 축일(세계평화 — 기도서에
      // 본기도가 없다, 설계서 미결51)의 문구가 따로다. 화면 글에 「관측일」을 쓰지 않는다(사용자 결정 2026-10-24). 고를 후보가
      // 없으면(전례독서 목록이 없는 날) 「다른 독서를 선택하세요」를 붙이지 않는다 — 고를 것이 없다(PR #467 리뷰)
      subtitle: (isCommemoration
        ? "기념일은 고유 본기도와 독서를 두지 않습니다."
        : rank === "minor_feast"
          ? "독서 본문 없이 기념하는 축일입니다."
          : "따로 정한 독서가 없습니다.") + (m.choices.length > 1 ? " 다른 독서를 선택하세요." : ""),
    }));
    finish();
    return;
  }

  const collects = buildCollects(m);
  if (collects) root.appendChild(collects);
  // 독서 카드는 독서만 바꾸므로 본기도 아래, 제1독서 바로 위에 둔다(사용자 결정 2026-11-05)
  const cards = buildReadingCards(m);
  if (cards) root.appendChild(cards);

  if (m.group) {
    // 「모든 별세자의 날 독서」 같은 본문 제목은 두지 않는다 — 머리의 제목이 같은 이름이다(사용자 결정 2026-11-03).
    for (const slot of m.slots) root.appendChild(buildReading(m, slot, chapters));
    // 복사 — 루트에 한 번(섹션마다가 아니라): 여러 독서에 걸친 선택도 섹션마다 「본문 — 출처」로 다 싣는다. 본기도 · 전례독서 목록 ·
    // 헤더 글자까지 고르면 브라우저 기본 복사(고른 것을 빠뜨리지 않게 — 자체 리뷰 2026-10-13)
    // 시편 끝 영광송까지 고르면 그 시편 블록에 함께 싣는다 — 출처 줄 앞(머지 전 검토 2026-10-14; 전례 표기를 남기는 것과 같은
    // 이유 — 주보 등 전례 용도, 사용자 결정 2026-10-13).
    bindCopyAttribution(root, copyCitation, {
      unitSelector: ".lect-reading", bailoutSelector: ".lect-head, .lect-collects, .lect-cards", strictRoot: true,
      tail: { selector: ".lect-gloria", text: gloriaCopyText },
    });
  } else {
    root.appendChild(emptyState({ icon: null, title: "독서 없음", subtitle: "독서는 없고 본기도만 있습니다." }));
  }
  finish();
}

/**
 * Full-screen lectionary view for /lectionary[/<date>] (ADR-038 §3). Returns the
 * page title for the router's page meta. Data-first: nothing touches #app until
 * every load finished and the route is still the current one (ADR-031 guard).
 * @param {LectionaryRoute} parsed
 * @returns {Promise<string>}
 */
async function renderLectionaryView(parsed) {
  const routeSeq = window.routeSeq;   // 한 번 잡아 둔다 — 클로저 안에서도 타입이 좁혀지게
  const entrySeq = typeof routeSeq === "function" ? routeSeq() : null;
  const isStale = () => entrySeq !== null && typeof routeSeq === "function" && routeSeq() !== entrySeq;

  const date = parsed.date || todayKey(new Date());
  if (!parseDate(date)) return pickAnotherDate("잘못된 날짜입니다");
  // 교회력을 계산하는 연도(엔진 — 1583-9999) 밖이면 자료를 받기 전에 알린다. 엔진의 `resolveDate`도 범위 밖에 null을
  // 낸다(그전엔 0100년대에서 날짜 이동이 같은 날을 돌려줘 탭이 멈췄다 — 자체 리뷰 2026-10-13).
  if (!isComputableDate(date)) return pickAnotherDate("교회력을 계산할 수 없는 날짜입니다");
  try {
    await Promise.all([preloadCalendar(), preloadLectionary()]);
  } catch (err) {
    // 교회력 자료를 받지 못했다(오프라인 · 캐시 없음) — 이 뷰의 헤더 · 제목으로 실패 화면을 낸다. 낡은 요청이면 조용히
    // 끝낸다(route() 가 새 화면을 그리고 있다). 공용 renderError 로 넘기면 앞 화면의 헤더 · 제목이 남았다(자체 리뷰 2026-10-13).
    // 화면 모듈을 받지 못했을 때와 같은 실패 화면이다 — 「다시 불러오기」가 그날을 다시 연다.
    if (isStale()) return PAGE_TITLE;
    console.error(err);
    return renderLiturgicalLoadFailure("lectionary");
  }
  if (isStale()) return PAGE_TITLE;

  const resolved = resolveDate(date);
  if (!resolved) return pickAnotherDate("이 날짜는 교회력에 없습니다");
  /** @type {Map<string, ReadingGroup[]>} */
  const groupsCache = new Map();
  const groupsOf = (/** @type {Candidate} */ c) => {
    const key = c.observance.id;
    let g = groupsCache.get(key);
    if (!g) { g = findReadings(resolved, c); groupsCache.set(key, g); }
    return g;
  };
  const model = buildLectionaryModel(resolved, parsed, groupsOf, findCollects(resolved), loadLectionaryTrack(), findDedications(date), loadLectionaryAltShow());
  if (!model) return pickAnotherDate("이 날짜는 교회력에 없습니다");

  const chapters = await loadSlotChapters(model.slots);
  if (isStale()) return PAGE_TITLE;
  commit(model, chapters);
  // 트랙이 있는 날은 고른 트랙(URL > 기억 > 1)을 지금 history 항목에 적는다 — 이 항목의 화면이 나중에 기억이 바뀌어도
  // 그대로 돌아오고(뒤로 가기), 공유한 주소가 받는 사람의 기억과 무관하게 같은 화면이며, 스크롤 기억(ADR-031 — 경로
  // 키)도 이 주소로 잡힌다. route() 의 onRouteEnd 가 이 뒤에 지금 경로를 읽는다(자체 리뷰 2026-10-13).
  if (model.tracks.length > 1 && model.track) {
    const search = withTrack(location.search, model.track);
    if (search !== location.search) history.replaceState(history.state, "", location.pathname + search);
  }
  // 문서 제목도 머리처럼 고른 전례일의 이름이다(2026-11-04, buildHeader).
  return `${shortName(model.dayName)} ${PAGE_TITLE}`;
}

// 캘린더 탭(calendar.js — ADR-038 §2 A2)이 같은 이름 · 날짜 · 색 규칙을 쓴다(복제 금지 — 칸 · 줄의 이름이 전례독서 목록과 같아야 한다).
export {
  renderLectionaryView, buildLectionaryModel,
  shortName, statusSuffix, isGrid, todayKey, commitDateBar,
  CYCLE_LABEL, COLOR_LABEL, WEEKDAY_KO,
};
