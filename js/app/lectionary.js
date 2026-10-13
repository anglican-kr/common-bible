// @ts-check
"use strict";

// Lectionary reading view (ADR-038 §3 — A3). Renders one day's eucharistic
// propers at /lectionary[/YYYY-MM-DD]: collect(s) → first reading → psalm →
// second reading → gospel, with the observance switcher (every candidate as a
// chip — `official` is only the initial pick), the alternative-set and track
// segments, and the side-by-side choice for optional transfers / transferred
// feasts / regional festivals. The engine decides what the day IS
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
//   미결25 고유 독서 없는 축일의 초기 독서 = 격자(그날의 주일 · 평일) 독서 — 책자대로. 헤더 제목은 승자, 색은 고른
//          본문의 색(headerColors — 격자면 그날 대표색), 본기도는 고른 칩의 것. (닫힘)
//   미결20 성 토요일: 헤더 색은 「고른 본문의 색」 — 부활밤 본문이면 백(승자여도), 성 토요일 칩이면 홍.
//          저녁 전례 표지(데이터 · 엔진)는 그대로 열려 있다.
//   미결38 대안 세트: 「또는」 대안은 「독서 1 · 독서 2」(완전한 세트를 통째로 바꾼다), 조건부는 「…로 지킬 때」가
//          라벨, 괄호 선택 구절 세트는 바탕 세트에 합쳐 긴 본문 + 〔 〕 표시. (닫힘)
//   미결42 칩 라벨은 괄호 설명을 뗀 이름 + (주기, 독서 N) — 길면 CSS 말줄임, 전체 이름은 title 속성. (닫힘)

/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").Candidate} Candidate */
/** @typedef {import("../types").ReadingGroup} ReadingGroup */
/** @typedef {import("../types").ReadingSlot} ReadingSlot */
/** @typedef {import("../types").CollectOption} CollectOption */
/** @typedef {import("../types").CandidateCollects} CandidateCollects */
/** @typedef {import("../types").BibleChapter} BibleChapter */

import { loadChapter } from "./data-fetch.js";
import { setTitle, appendVerses, buildSegmentTabs, bindCopyAttribution } from "./views.js";
import { specCoversVerse, verseInstanceKeys } from "./verse-spec.js";
import {
  parseDate, toKey, addDays, dayOfWeek, liturgicalYearOf, optionalDestOf,
  preloadCalendar, preloadLectionary, resolveDate, findReadings, findCollects, fastOf,
} from "./liturgical-engine.js";

const { _$, el, clearNode, emptyState } = window.appHelpers;
const { loadLectionaryTrack, saveLectionaryTrack } = window.appStorage;

const $app = _$("app");
const PAGE_TITLE = "전례독서";

/**
 * parsePath 가 /lectionary 에서 내는 서술자(routing.js PARSE_PATH). `date` 가 null 이면 오늘.
 * @typedef {{ view: "lectionary", date: string | null, obs: string | null, track: 1 | 2 | null, set: number | null, collect: number | null }} LectionaryRoute
 */
/** URL 쿼리에서 온 상태 — 넷 다 없을 수 있다. @typedef {{ obs: string | null, track: 1 | 2 | null, set: number | null, collect: number | null }} LectionaryQuery */
/** @typedef {{ label: string, note: string, official: boolean }} PairCardText */
/**
 * 두 독서 나란히(ADR-038 §3 — 선택 봉헌 · 옮겨진 축일 · 명절). `a` 가 왼쪽 카드다.
 * @typedef {{ kind: "optional-dest" | "arrival" | "festival" | "optional-origin", a: Candidate, b: Candidate, aText: PairCardText, bText: PairCardText }} LectionaryPair
 */
/** @typedef {{ candidate: Candidate, label: string, title: string, href: string, active: boolean, muted: boolean }} LectionaryChip */
/** 화면의 「독서」 선택지 하나 — `short` 는 괄호 선택 구절 세트에 합쳐진 짧은 바탕 세트(〔 〕 표시의 기준). @typedef {{ group: ReadingGroup, short: ReadingGroup | null, label: string }} ReadingOption */
/**
 * 뷰가 그리는 것 전부 — 순수 함수 `buildLectionaryModel` 의 반환. DOM 은 이것만 읽는다.
 * @typedef {{
 *   date: string, resolved: ResolvedDate, selected: Candidate, initial: Candidate,
 *   groups: ReadingGroup[], tracks: Array<1 | 2>, track: 1 | 2 | null,
 *   options: ReadingOption[], setIndex: number, group: ReadingGroup | null, shortGroup: ReadingGroup | null, slots: ReadingSlot[],
 *   chips: LectionaryChip[], pair: LectionaryPair | null,
 *   collects: CollectOption[], collectLabels: string[], collectIndex: number, ending: "A" | "B" | "C",
 *   colors: string[], colorAlt: string[], ownColor: boolean,
 *   fast: "major" | "minor" | null, cycle: string | null, empty: boolean,
 *   hrefs: { prev: string, next: string, today: string, tracks: Array<{ track: 1 | 2, href: string, active: boolean }>, options: string[], collects: string[], pair: { a: string, b: string } | null },
 * }} LectionaryModel
 */

// ── BEGIN LECTIONARY_MODEL ──
// Exercised by tests/unit/lectionary.test.js (vm slice — no DOM) and, against
// the real tables, by tests/unit/lectionary.data.test.js. Pure decisions only:
// which candidate to show first, which track / set / collect, what the chips
// and the side-by-side choice say, which colours the header wears, and how a
// state round-trips through the URL. The test loaders slice the engine's
// LITURGICAL_CORE + LITURGICAL_LOOKUP blocks and verse-spec's VERSE_SPEC block
// alongside, so parseDate / toKey / addDays / dayOfWeek / optionalDestOf /
// fastOf / specCoversVerse / verseInstanceKeys are the real functions here.

const SLOT_ORDER = ["first", "psalm", "second", "gospel"];
/** @type {Record<string, string>} */
const SLOT_LABEL = { first: "제1독서", psalm: "시편", second: "제2독서", gospel: "복음" };
// 한글 라벨은 데이터 `_vocab` 그대로 — lectionary.data.test.js 가 표와 대조한다(ADR-036 §4 단일 출처).
/** @type {Record<string, string>} */
const CYCLE_LABEL = { A: "가해", B: "나해", C: "다해", I: "홀수해", II: "짝수해" };
/** @type {Record<string, string>} */
const COLOR_LABEL = { white: "백색", red: "적색", green: "녹색", violet: "자색", rose: "장미색", blue: "청색" };
/** @type {Record<string, string>} */
const FAST_LABEL = { major: "대재일", minor: "소재일" };
const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const GRID_ID_PREFIX = "grid:";
/** 파서가 괄호 선택 확장(「9:35-10:8(9-23)」)으로 만든 세트의 표지(ADR-037 §1 「대안 세트 explode」). */
const BRACKET_NOTE = "괄호 선택 구절 포함";
/** 선택 봉헌의 네 목적지(설계서 R-6.2-destinations) — 엔진 OPTIONAL_TRANSFER_KINDS 와 같은 넷. */
const OPTIONAL_TRANSFER_KINDS = ["nearby_sunday", "sunday_0102_0108", "sunday_1030_1105", "easter7_sunday"];

// 송영 3종 — 고른 본기도(대체안은 세그먼트로 택1) 끝에 **1회**, 그 본기도의 `ending` 코드로(ADR-036 §3 ·
// ADR-038 §3 「구현」 — 다른 관측일의 본기도는 열거하지 않는다). 데이터 eucharist-collects.json
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

/** 격자 합성 관측일인가(설계서 §5.5 예약 접두사). URL 쿼리 → 상태는 routing.js `parsePath` 가 맡는다. */
function isGrid(/** @type {Candidate} */ c) {
  return c.observance.id.startsWith(GRID_ID_PREFIX);
}

/**
 * 칩 라벨용 짧은 이름(미결42 잠정) — 괄호 설명 전부를 뗀다: 「바실(주교, 379년)과 나지안조의
 * 그레고리(주교, 389년)」 → 「바실과 나지안조의 그레고리」. 떼고 나서 비면 원래 이름.
 * @param {string | null | undefined} name
 */
function shortName(name) {
  const full = String(name || "");
  const stripped = full.replace(/\s*\([^()]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  return stripped || full;
}

/**
 * 후보의 상태를 칩 꼬리말로 — 밀린 · 옮긴 · 선택 봉헌 · 기념 · 기념일. 승자(그날 지키는 고유 후보)는 꼬리가 없다.
 * @param {Candidate} c
 */
function statusSuffix(c) {
  if (c.observance.rank === "commemoration") return " · 기념일";
  switch (c.status) {
    case "transferred_in": return c.from ? ` · ${monthDayLabel(c.from)}에서 옮겨 옴` : " · 옮겨 옴";
    case "transferred_out": return c.to ? ` · → ${monthDayLabel(c.to)}` : " · 옮겨 감";
    case "optional": return c.from ? ` · ${monthDayLabel(c.from)}에서 옮겨 지킬 수 있음` : " · 옮겨 지킬 수 있음";
    case "commemorated": return " · 기념만";
    case "omitted": return " · 생략";
    default: return "";
  }
}

/** 승자 자격이 없거나 밀린 후보 — 칩을 흐리게 그린다. */
function isMutedCandidate(/** @type {Candidate} */ c) {
  return c.status === "omitted" || c.status === "transferred_out" || c.observance.rank === "commemoration";
}

/**
 * 관측일 스위처 칩 라벨(ADR-038 §3-1): 이름 (+ 주기 라벨) (+ 독서 N) + 상태 꼬리. 주기는 격자(그날의
 * 주일 · 평일) 후보에만 — 성인 축일은 주기로 갈리지 않는다. 트랙은 그 후보의 독서가 트랙을 가질 때만.
 * @param {Candidate} c @param {ResolvedDate} resolved @param {1 | 2 | null} track  이 후보에 적용되는 트랙
 */
function chipLabel(c, resolved, track) {
  const parts = [];
  if (isGrid(c) && resolved.coord.year && CYCLE_LABEL[resolved.coord.year]) parts.push(CYCLE_LABEL[resolved.coord.year]);
  if (track) parts.push(`독서 ${track}`);
  return shortName(c.observance.name) + (parts.length ? ` (${parts.join(", ")})` : "") + statusSuffix(c);
}

/** 고유 독서가 하나라도 있는가 — 공통(`common` 표지) 그룹만 있으면 거짓. */
function hasProperReadings(/** @type {ReadingGroup[]} */ groups) {
  return groups.some((g) => !g.common);
}

/**
 * 초기 선택(ADR-038 §3 — `official` 이 초기 선택). 단 하나의 예외가 미결25 의 잠정 답이다: 승자의 독서가
 * 공통뿐이면(고유 독서 없는 축일) 책자대로 그날의 격자 독서를 먼저 보인다 — 헤더 제목은 여전히 승자이고 색은 고른
 * 본문의 색(`headerColors` — 격자면 그날 대표색), 본기도는 고른 칩의 것이다.
 * @param {ResolvedDate} resolved @param {(c: Candidate) => ReadingGroup[]} groupsOf
 * @returns {Candidate | null}
 */
function initialCandidate(resolved, groupsOf) {
  const official = resolved.official || resolved.candidates[0] || null;
  if (!official) return null;
  if (hasProperReadings(groupsOf(official))) return official;
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
 * 트랙 선택 — URL 이 먼저, 다음은 전례년에 기억된 것, 그다음 첫 트랙. 트랙이 없는 날은 null.
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
 * 세트의 조건 문구 — 「…로 지킬 때」 꼴로 통일(사용자 결정 2026-10-12; 데이터는 「…로 지키는 경우」와 섞여 있다).
 * 조건이 아닌 파서 표지(「원본 세트 N」 · 괄호 선택 구절)는 null.
 */
function setCondition(/** @type {ReadingGroup} */ group) {
  const n = group.set_note;
  if (!n || /^원본 세트/.test(n) || n === BRACKET_NOTE) return null;
  return n.replace(/로 지키는 경우$/, "로 지킬 때");
}

/**
 * 괄호 선택 구절 세트의 바탕 — 앞선 선택지 가운데 슬롯 구성이 같고 **한 슬롯만** 라벨이 다른(짧은) 것, 가장 가까운 것.
 * 실데이터의 괄호 세트 34건이 전부 이 꼴이다(2026-10-12 실측). 없으면 -1.
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
 *   〔 〕 로 표시한다(`short` 가 그 바탕). 세그먼트에 오르지 않는다.
 * - 남는 선택지가 둘 이상이면 「또는」 대안이다 — 대안이 있는 슬롯만 바꾼 **완전한 세트**를 통째로 고른다(ADR-037
 *   §1): 「독서 1」「독서 2」. 조건부 세트는 조건(「…로 지킬 때」)이 라벨이고 그 바탕 세트는 관측일 이름이다.
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
  // 제목이 갈리면(한 날짜에 둘 — 5.1 사도 성 필립보와 성 야고보 ∧ 노동자의 날) 고른 관측일의 제목을 앞세운다 — 엔진은
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
 * 본기도 — **고른 관측일의 것만**(사용자 결정 2026-10-12, pitfalls §21 · ADR-038 §3 「구현」). 같은 날의 다른
 * 관측일 본기도는 그 칩을 골라야 보인다. 재조회 없이 `findCollects` 반환(관측일별 키잉)에서 고른 후보의 원소를
 * 찾는다 — 본기도가 없는 후보(기념일 · 이름 줄)는 빈 배열.
 * @param {CandidateCollects[]} entries @param {Candidate} selected
 * @returns {CollectOption[]}
 */
function collectsFor(entries, selected) {
  const sel = entries.find((e) => e.candidate === selected)
    || entries.find((e) => e.candidate.observance.id === selected.observance.id) || null;
  if (!sel) return [];
  // 같은 날짜에 정의된 다른 관측일의 본기도가 섞여 오면(5.1 노동자의 날 — 미결18 · 35) 고른 관측일 이름의 것을 앞세운다(안정 정렬)
  const name = selected.observance.name;
  return [...sel.collects].sort((a, b) => Number(!sameName(a.title, name)) - Number(!sameName(b.title, name)));
}

/** 괄호 설명을 뗀 이름이 같은가 — 세트 · 본기도의 제목과 관측일 이름 대조. */
function sameName(/** @type {string | null | undefined} */ a, /** @type {string | null | undefined} */ b) {
  return !!a && !!b && shortName(a) === shortName(b);
}

/**
 * `?collect=` 는 본기도 목록의 몇 번째인가(1부터 — `?set=` 과 같은 규칙). 종전에는 `collect_no` 였는데, 한 관측일에
 * 서로 다른 레코드 둘이 모두 `collect_no: 1` 인 날(사계재 금요일 성직후보자 · 수도자, 5.1)에 둘째에 닿을 수 없었다
 * (자체 리뷰 2026-10-13). 범위 밖이면 첫 대체안.
 */
function pickCollect(/** @type {CollectOption[]} */ options, /** @type {number | null} */ param) {
  if (!options.length) return -1;
  if (param && param >= 1 && param <= options.length) return param - 1;
  return 0;
}

/**
 * 본기도 세그먼트 라벨 — `collect_no` 가 서로 다르면 「본기도 N」, 겹치면 제목에서 낱말 단위로 공통 머리 · 꼬리를 뗀
 * 부분(「성직후보자」 · 「수도자」 — 「…의 성소를 위한 추계재 금요일」; 모두 소유격 「의」로 끝나면 그것도 뗀다), 그래도
 * 가를 수 없으면 제목 전체, 그것도 같으면 「본기도 N」(위치).
 * @param {CollectOption[]} options @returns {string[]}
 */
function collectLabels(options) {
  const nos = options.map((o) => o.collect_no);
  if (new Set(nos).size === nos.length) return nos.map((n) => `본기도 ${n}`);
  const titles = options.map((o) => shortName(o.title || ""));
  const words = titles.map((t) => t.split(/\s+/).filter(Boolean));
  const at = (/** @type {string[]} */ w, /** @type {number} */ i) => w[i];
  let pre = 0;
  while (words.every((w) => w.length > pre + 1 && at(w, pre) === at(words[0], pre))) pre++;
  let suf = 0;
  while (words.every((w) => w.length - suf - 1 > pre && at(w, w.length - 1 - suf) === at(words[0], words[0].length - 1 - suf))) suf++;
  let mids = words.map((w) => w.slice(pre, w.length - suf).join(" "));
  if (mids.every((x) => x.length > 1 && x.endsWith("의"))) mids = mids.map((x) => x.slice(0, -1));
  const distinct = mids.every((x) => x) && new Set(mids).size === mids.length;
  const full = titles.every((x) => x) && new Set(titles).size === titles.length;
  return options.map((_, i) => (distinct ? mids[i] : full ? titles[i] : `본기도 ${i + 1}`));
}

/** 고른 본기도의 송영 코드 — 코드가 없으면 A(ADR-036 §3 기본). @returns {"A" | "B" | "C"} */
function endingCodeOf(/** @type {CollectOption | null | undefined} */ last) {
  const e = last && last.ending;
  return e === "A" || e === "B" || e === "C" ? e : "A";
}

/**
 * 두 독서 나란히(ADR-038 §3 · 미결15). 하루에 하나만 — 목적지 주일의 선택 봉헌 → 옮겨 온 축일의 도착일 →
 * 명절 → 선택 봉헌의 당일 순으로 처음 맞는 꼴. 없으면 null. 어느 쪽이든 **독서가 없는** 후보는 카드로 내지 않는다 —
 * 성탄 8일의 도착일(12.27~29)과 공현 당일(1.6)의 격자는 본문이 비어 카드를 누르면 빈 화면이었다(자체 리뷰 2026-10-13).
 * @param {ResolvedDate} resolved @param {(c: Candidate) => ReadingGroup[]} [groupsOf] 없으면 본문 검사를 건너뛴다
 * @returns {LectionaryPair | null}
 */
function pairOf(resolved, groupsOf) {
  const cands = resolved.candidates;
  const grid = cands.find(isGrid) || null;
  const official = resolved.official;
  const gridName = grid ? shortName(grid.observance.name) : "";
  const read = (/** @type {Candidate} */ c) => !groupsOf || groupsOf(c).length > 0;
  // 격자 카드의 설명 — 명절이 주일이면(2027-02-07 설) 그날의 격자는 주일이다
  const gridKind = dayOfWeek(resolved.date) === 0 ? "주일" : "평일";

  const optional = cands.find((c) => c.status === "optional");
  if (optional && official && official !== optional && read(official) && read(optional)) {
    return {
      kind: "optional-dest", a: official, b: optional,
      aText: { label: `${shortName(official.observance.name)} 독서`, note: "이날의 공식 독서", official: true },
      bText: {
        label: `${shortName(optional.observance.name)} 독서`,
        note: optional.from ? `${monthDayLabel(optional.from)}에서 옮겨 지키는 경우` : "옮겨 지키는 경우",
        official: false,
      },
    };
  }
  const arrived = cands.find((c) => c.status === "transferred_in");
  if (arrived && grid && arrived !== grid && read(arrived) && read(grid)) {
    return {
      kind: "arrival", a: arrived, b: grid,
      aText: {
        label: `${shortName(arrived.observance.name)} 독서`,
        note: arrived.from ? `${monthDayLabel(arrived.from)}에서 옮겨 옴` : "옮겨 옴",
        official: arrived === official,
      },
      bText: { label: `${gridName} 독서`, note: `이날의 ${gridKind} 독서`, official: grid === official },
    };
  }
  if (official && official.observance.rank === "regional_festival" && grid && grid !== official && read(official) && read(grid)) {
    return {
      kind: "festival", a: official, b: grid,
      aText: { label: `${shortName(official.observance.name)} 독서`, note: "명절 — 이날의 공식 독서", official: true },
      bText: { label: `${gridName} 독서`, note: `이날의 ${gridKind} 독서`, official: false },
    };
  }
  const origin = cands.find((c) => c.status === "proper" && OPTIONAL_TRANSFER_KINDS.includes(String(c.observance.transfer_to)));
  if (origin && grid && origin !== grid && read(origin) && read(grid)) {
    const y = parseInt(resolved.date.slice(0, 4), 10);
    const dest = optionalDestOf(origin.observance.transfer_to, resolved.date, y);
    if (dest && dest !== resolved.date) {
      const when = dest > resolved.date ? "오는" : "지난";
      return {
        kind: "optional-origin", a: origin, b: grid,
        aText: { label: `${shortName(origin.observance.name)} 독서`, note: "이날 지키는 경우 — 이날의 공식 독서", official: origin === official },
        bText: {
          label: `${gridName} 독서`,
          note: `${when} 주일(${monthDayLabel(dest)})로 옮겨 지키는 경우 — 이날은 ${gridKind} 독서`,
          official: grid === official,
        },
      };
    }
  }
  return null;
}

/** `null | 코드 | 코드 배열` 3형 → 배열. */
function altList(/** @type {unknown} */ v) {
  if (v === null || v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string");
}

/**
 * 헤더 색(ADR-038 §3 · 설계서 R-6.4-color-order) — **고른 본문의 색을 따른다**(사용자 결정 2026-10-12,
 * pitfalls §21): 고른 칩이 자기 색을 가진 **비격자** 후보이고 그 색이 그날의 대표색과 다르면 그 색 하나
 * (사계재 자 · 성 토요일의 부활밤 백 — 승자여도 · 생략된 성인). 그 밖은 그날의 `colors`(병기) + `colorAlt`
 * 그대로 — 승자를 고르거나 색이 같은 후보를 고르면 사계재 날의 [자, 백] 병기가 남는다. 격자 후보는 자기
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
 * 상태 → URL. 기본값과 같은 키는 쓰지 않아 「/lectionary/2026-04-05」가 그날의 초기 화면이다 — 다만 **트랙은 트랙이 있는
 * 날이면 언제나 적는다**(`defaults.track` 은 null): 기본 트랙이 보는 사람의 기억(전례년별)에 달려 있어, 빼면 같은 주소가
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
 *   Dn 3:25, 34-43 · Dn 3:14-20, 91-92, 95 와 같다. 에스델의 `alt_ref`(추가 본문 하위 절 — 미결39)는 `lxx_only` 가
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
 * 뷰 모델 전부(순수). `groupsOf` 는 `findReadings(resolved, c)` 를 감싼 것 — 후보마다 한 번 부른다.
 * @param {ResolvedDate} resolved @param {LectionaryQuery} query
 * @param {(c: Candidate) => ReadingGroup[]} groupsOf @param {CandidateCollects[]} collectEntries
 * @param {1 | 2 | null} storedTrack  전례년에 기억된 트랙
 * @returns {LectionaryModel | null}  후보가 하나도 없으면 null(유효한 날짜에는 격자가 언제나 있어 생기지 않는다)
 */
function buildLectionaryModel(resolved, query, groupsOf, collectEntries, storedTrack) {
  const date = resolved.date;
  const initial = initialCandidate(resolved, groupsOf);
  const selected = selectCandidate(resolved, query.obs, groupsOf);
  if (!initial || !selected) return null;

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
  const collectIndex = pickCollect(collects, query.collect);
  const chosenCollect = collectIndex >= 0 ? collects[collectIndex] : null;

  const base = { obs: selected.observance.id, track, set: setIndex + 1, collect: chosenCollect ? collectIndex + 1 : null };
  const chips = resolved.candidates.map((c) => {
    const own = c === selected ? groups : groupsOf(c);
    const t = c === selected ? track : pickTrack(own, null, storedTrack);
    return {
      candidate: c,
      label: chipLabel(c, resolved, t),
      title: String(c.observance.name || "") + statusSuffix(c),
      href: hrefFor(date, { obs: c.observance.id, track: null, set: null, collect: null }, defaults),
      active: c === selected,
      muted: isMutedCandidate(c),
    };
  });
  const pair = pairOf(resolved, groupsOf);
  const { colors, colorAlt, ownColor } = headerColors(resolved, selected);
  const empty = !groups.length && !collects.length;

  return {
    date, resolved, selected, initial, groups, tracks, track, options, setIndex, group, shortGroup, slots,
    chips, pair, collects, collectLabels: collectLabels(collects), collectIndex, ending: endingCodeOf(chosenCollect),
    colors, colorAlt, ownColor, fast: fastOf(resolved),
    cycle: resolved.coord.year && CYCLE_LABEL[resolved.coord.year] ? CYCLE_LABEL[resolved.coord.year] : null,
    empty,
    hrefs: {
      prev: `/lectionary/${addDays(date, -1)}`,
      next: `/lectionary/${addDays(date, 1)}`,
      today: "/lectionary",
      // 본기도 선택(`collect`)은 독서와 독립된 축이라 트랙 · 세트를 바꿔도 유지한다(Copilot 리뷰 1회차).
      // 트랙이 바뀌면 세트는 그 트랙의 첫 세트로 돌아간다(세트는 트랙에 딸린 것).
      tracks: tracks.map((t) => ({ track: t, href: hrefFor(date, { ...base, track: t, set: null }, defaults), active: t === track })),
      options: options.map((_, i) => hrefFor(date, { ...base, set: i + 1 }, defaults)),
      collects: collects.map((_, i) => hrefFor(date, { ...base, collect: i + 1 }, defaults)),
      pair: pair ? {
        a: hrefFor(date, { obs: pair.a.observance.id, track: null, set: null, collect: null }, defaults),
        b: hrefFor(date, { obs: pair.b.observance.id, track: null, set: null, collect: null }, defaults),
      } : null,
    },
  };
}
// ── END LECTIONARY_MODEL ──

// ── Chapter JSON cache ──
// Chip / segment changes re-run route(), and most of them re-use the chapters
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

/** @param {string} msg @param {string} [subtitle] */
function commitError(msg, subtitle) {
  setTitle(PAGE_TITLE);
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  window.hideAudioBar?.();
  clearNode($app);
  const panel = el("div", { className: "lectionary" });
  panel.appendChild(emptyState({ icon: null, title: msg, subtitle: subtitle || "" }));
  $app.appendChild(panel);
}

/** 색 점 + 라벨 하나. */
function buildColorMark(/** @type {string} */ color, /** @type {boolean} */ alt) {
  const wrap = el("span", { className: alt ? "lect-color-item lect-color-item--alt" : "lect-color-item" });
  wrap.appendChild(el("span", { className: `lect-color lect-color--${color}`, "aria-hidden": "true" }));
  wrap.appendChild(document.createTextNode((alt ? "대체 " : "") + (COLOR_LABEL[color] || color)));
  return wrap;
}

/** @param {LectionaryModel} m */
function buildHeader(m) {
  const head = el("header", { className: "lect-head" });

  const nav = el("nav", { className: "lect-datenav", "aria-label": "날짜 이동" });
  nav.appendChild(el("a", { className: "lect-datenav-btn", href: m.hrefs.prev, "aria-label": "전날" }, "‹"));
  const mid = el("div", { className: "lect-date" });
  mid.appendChild(el("time", { datetime: m.date }, dateLabel(m.date)));
  mid.appendChild(el("a", { className: "lect-today", href: m.hrefs.today }, "오늘"));
  nav.appendChild(mid);
  nav.appendChild(el("a", { className: "lect-datenav-btn", href: m.hrefs.next, "aria-label": "다음날" }, "›"));
  head.appendChild(nav);

  const official = m.resolved.official;
  const dayName = official ? String(official.observance.name || "") : "";
  head.appendChild(el("h2", { className: "lect-day" }, dayName || "—"));
  if (official && official.status === "transferred_in" && official.from) {
    head.appendChild(el("p", { className: "lect-day-note" }, `${monthDayLabel(official.from)}에서 옮겨 지킵니다`));
  }

  const meta = el("p", { className: "lect-meta" });
  const colors = el("span", { className: m.ownColor ? "lect-colors lect-colors--own" : "lect-colors", "aria-label": "전례색" });
  for (const c of m.colors) colors.appendChild(buildColorMark(c, false));
  for (const c of m.colorAlt) colors.appendChild(buildColorMark(c, true));
  meta.appendChild(colors);
  if (m.cycle) meta.appendChild(el("span", { className: "lect-meta-item" }, m.cycle));
  if (m.fast) meta.appendChild(el("span", { className: "lect-meta-item lect-fast" }, FAST_LABEL[m.fast]));
  for (const p of m.resolved.periods || []) meta.appendChild(el("span", { className: "lect-meta-item lect-period" }, p.name));
  head.appendChild(meta);
  return head;
}

/** @param {LectionaryModel} m */
function buildChips(m) {
  const nav = el("nav", { className: "lect-chips", "aria-label": "관측일" });
  for (const chip of m.chips) {
    const a = el("a", {
      className: chip.muted ? "lect-chip lect-chip--muted" : "lect-chip",
      href: chip.href,
      title: chip.title,
    }, el("span", { className: "lect-chip-text" }, chip.label));
    if (chip.active) a.setAttribute("aria-current", "true");
    nav.appendChild(a);
  }
  return nav;
}

/** @param {LectionaryModel} m */
function buildPair(m) {
  const pair = /** @type {LectionaryPair} */ (m.pair);
  const hrefs = /** @type {{ a: string, b: string }} */ (m.hrefs.pair);
  const section = el("section", { className: "lect-pair", "aria-label": "두 독서 가운데 고르기" });
  section.appendChild(el("h3", { className: "lect-pair-title" }, "두 독서 가운데 고르기"));
  const row = el("div", { className: "lect-pair-row" });
  /** @type {Array<[Candidate, PairCardText, string]>} */
  const cards = [[pair.a, pair.aText, hrefs.a], [pair.b, pair.bText, hrefs.b]];
  for (const [cand, text, href] of cards) {
    const card = el("a", { className: "lect-pair-card", href });
    if (cand === m.selected) card.setAttribute("aria-current", "true");
    const label = el("span", { className: "lect-pair-label" }, text.label);
    if (text.official) label.appendChild(el("span", { className: "lect-badge" }, "공식"));
    card.appendChild(label);
    card.appendChild(el("span", { className: "lect-pair-note" }, text.note));
    row.appendChild(card);
  }
  section.appendChild(row);
  return section;
}

/** @param {LectionaryModel} m */
function buildControls(m) {
  const wrap = el("div", { className: "lect-controls" });
  if (m.tracks.length > 1) {
    const ctl = el("div", { className: "lect-control lect-track" });
    ctl.appendChild(el("span", { className: "lect-control-label" }, "독서"));
    const seg = buildSegmentTabs(
      m.hrefs.tracks.map((t) => ({ label: `독서 ${t.track}`, href: t.href, active: t.active })),
      { ariaLabel: "독서 트랙", className: "division-tabs--compact" },
    );
    // Remember the choice for the liturgical year (ADR-036 §2 독서 연속성) — the
    // global <a> interceptor navigates after this listener runs.
    const ly = liturgicalYearOf(m.date);
    seg.querySelectorAll("a").forEach((a, i) => {
      a.addEventListener("click", (e) => {
        // 라우터(routing.js)가 가로채는 기본 클릭일 때만 — Ctrl/Cmd · Shift · 가운데 버튼은 새 탭 · 창으로 가는
        // 표준 링크 동작이라 지금 탭의 URL 과 기억을 건드리지 않는다(Copilot 리뷰 3회차).
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
        // 지금 항목의 주소에는 렌더할 때 이미 트랙이 적혀 있어(renderLectionaryView — withTrack) 기억을 바꿔도 뒤로 가기가
        // 이 화면으로 돌아온다(Copilot 리뷰 1 · 5회차의 클릭 때 보정을 렌더 때로 옮겼다 — 자체 리뷰 2026-10-13).
        if (Number.isFinite(ly)) saveLectionaryTrack(ly, m.hrefs.tracks[i].track);
      });
    });
    ctl.appendChild(seg);
    wrap.appendChild(ctl);
  }
  if (m.options.length > 1) {
    // 「또는」 대안 · 조건부 세트 — 조건 · 종류가 라벨이다(사용자 결정 2026-10-12). 괄호 선택 구절 세트는
    // 바탕에 합쳐져 여기 오르지 않는다(본문의 〔 〕 가 맡는다).
    const ctl = el("div", { className: "lect-control lect-sets" });
    ctl.appendChild(el("span", { className: "lect-control-label" }, "대안 독서"));
    ctl.appendChild(buildSegmentTabs(
      m.options.map((o, i) => ({ label: o.label, href: m.hrefs.options[i], active: i === m.setIndex })),
      { ariaLabel: "대안 독서", className: "division-tabs--compact" },
    ));
    // 공통 독서는 세그먼트에도 분류 라벨을 병기한다(ADR-038 §3 — 성인의 고유로 오인하지 않게)
    const common = m.options.every((o) => o.group.common) ? m.options[0].group.title : null;
    if (common) ctl.appendChild(el("span", { className: "lect-caption" }, `${common} 공통 독서`));
    wrap.appendChild(ctl);
  }
  return wrap.childElementCount ? wrap : null;
}

/** @param {LectionaryModel} m */
function buildCollects(m) {
  if (!m.collects.length) return null;
  const section = el("section", { className: "lect-section lect-collects", "data-slot": "collect" });
  section.appendChild(el("h3", { className: "lect-slot" }, "본기도"));
  if (m.collects.length > 1) {
    section.appendChild(buildSegmentTabs(
      m.collects.map((_, i) => ({ label: m.collectLabels[i], href: m.hrefs.collects[i], active: i === m.collectIndex })),
      { ariaLabel: "본기도 대체안", className: "division-tabs--compact" },
    ));
  }
  const o = m.collects[Math.max(m.collectIndex, 0)];
  const art = el("article", { className: "lect-collect chapter-text", lang: "ko" });
  if (o.common) art.appendChild(el("p", { className: "lect-caption" }, `${o.title} 공통 본기도`));
  art.appendChild(el("p", { className: "lect-collect-text" }, o.text));
  section.appendChild(art);
  // 송영 — 고른 본기도 뒤에 1회(ADR-036 §3).
  section.appendChild(el("p", { className: "lect-ending chapter-text", lang: "ko" }, ENDINGS[m.ending]));
  return section;
}

/** 영광송 — 선창 ◯ 응답, 계응 시편과 같은 표지(`responsory-mark` · `verse-response`). */
function buildGloria() {
  const box = el("div", { className: "lect-gloria", lang: "ko", "aria-label": "영광송" });
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
 * 반절(상 → `a` · 하 → `b`, ADR-037 §1) — 그 절이 **정확히 두 줄**로 그려졌으면 고른 줄만 남긴다. 데이터의 두 줄 절
 * 22곳은 줄 경계가 곧 상/하 경계였다(¶ 문단 · 시행 · 계응 선창/응답 — 성령강림대축일 「시편 104:24-34, 35하」는
 * 「악인들아 …」를 빼고 「내 영혼아, 주님을 찬미하여라. 알렐루야!」만). 한 줄 절(산문 54곳)은 나눌 수 없어 절 전체,
 * 세 줄 이상(24곳)은 경계를 알 수 없어 절 전체를 그대로 둔다(2026-10-13 자체 리뷰).
 * 첫 줄을 버리면 절 번호(`sup.verse-num` · U+2060)와 id 를 남는 줄로 옮기고, 둘째 줄을 버리면 선창 끝 ◯ 도 뗀다.
 * @param {HTMLElement} article @param {string} verseSpec
 */
function trimHalfVerses(article, verseSpec) {
  for (const tok of String(verseSpec || "").split(",")) {
    const m = /^(\d+)([ab])$/.exec(tok.trim());
    if (!m) continue;
    const spans = /** @type {HTMLElement[]} */ ([...article.querySelectorAll(".verse[data-vref]")])
      .filter((s) => new RegExp(`^${m[1]}[a-z]$`).test(s.getAttribute("data-vref") || ""));
    if (spans.length !== 2) continue;
    const [first, second] = spans;
    const brk = second.previousElementSibling;
    if (brk && (brk.classList.contains("hemistich-break") || brk.classList.contains("paragraph-break"))) brk.remove();
    if (m[2] === "b") {
      // 절 번호 · id 를 둘째 줄로 — sup 뒤의 U+2060 도 함께
      const lead = [...first.childNodes].filter((n) => n instanceof HTMLElement
        ? n.classList.contains("verse-num") || n.classList.contains("versicle-mark")
        : n.nodeType === Node.TEXT_NODE && n.textContent === "\u2060");
      for (const n of lead.reverse()) second.insertBefore(n, second.firstChild);
      second.id = first.id;
      first.remove();
    } else {
      first.querySelectorAll(".responsory-mark").forEach((n) => n.remove());
      second.remove();
    }
  }
}

/**
 * @param {LectionaryModel} m @param {ReadingSlot} slot @param {Map<string, BibleChapter | null>} chapters
 */
function buildReading(m, slot, chapters) {
  const section = el("section", { className: "lect-section lect-reading", "data-slot": slot.slot });
  const head = el("div", { className: "lect-section-head" });
  head.appendChild(el("h3", { className: "lect-slot" }, SLOT_LABEL[slot.slot] || slot.slot));
  head.appendChild(el("span", { className: "lect-ref" }, slot.label || ""));
  const refs = slot.refs || [];
  const lastChapter = refs.length ? chapters.get(`${slot.bookId}:${refs[refs.length - 1].chapter}`) : null;
  if (slot.bookId === "cant") {
    const title = canticleTitleOf(lastChapter);
    if (title && !(slot.label || "").includes(title)) head.appendChild(el("span", { className: "lect-canticle" }, title));
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
      section.appendChild(el("p", { className: "lect-missing", role: "status" }, `본문을 불러오지 못했습니다 (${slot.bookId} ${run.chapter})`));
      continue;
    }
    if (!run.verses.length) continue;
    // `data-chapter-last` = 그 장의 실제 마지막 절(병합 절은 끝 번호) — 복사 참조가 장 경계에서 정말 이어지는지 가리는 기준
    const chapterLast = run.data.verses.reduce((mx, v) => Math.max(mx, Number(v.range_end) || v.number), 0);
    const article = el("article", { className: "chapter-text", lang: "ko", "data-chapter": String(run.chapter), "data-chapter-last": String(chapterLast), "data-book": run.data.book_name_ko || slot.bookId });
    // Clean 봉독 surface (ADR-035): cite chips off, no parallels, no note anchors. 한 화면에 슬롯 · 장이 여럿이라
    // 절 id 에 슬롯 · 책 · 장 접두를 붙여 문서 안에서 유일하게(Copilot 리뷰 7회차).
    appendVerses(article, run.verses, { hideCites: true, instanceKeys: run.keys, idPrefix: `${slot.slot}-${slot.bookId}-${run.chapter}-` });
    trimHalfVerses(article, run.spec);
    if (shortSlot) markOptionalVerses(article, run.chapter, isOptional);
    section.appendChild(article);
  }
  // 복사 출처 — 장 본문 · 북마크 복사 버튼과 같은 「— 책 장:절 (공동번역성서)」(Copilot 리뷰 6~9회차). 섹션에 한 번 묶어
  // 장을 넘는 독서(시편 42, 43 — article 둘)의 선택도 한 본문으로 직렬화한다. 참조는 verse-spec.js 가 만든 **실제로 고른
  // 절의 spec**(「1-2,11」 · 병합 절 「7-8,9」)이고, 장 경계에서는 앞 장의 **실제 마지막 절**(`data-chapter-last`)에서 끝나
  // 다음 장의 1절에서 이어질 때만 「42:11-43:1」로 합친다 — 창세 6:9-22, 7:24 처럼 발췌가 장 끝에서 끊긴 것처럼 보여도
  // 7:24 는 1절이 아니라 「6:22, 7:24」다. 송가(cant)는 장 번호가 성서의 장이 아니라 슬롯 라벨을 그대로 쓴다.
  bindCopyAttribution(section, (runs) => {
    const bookName = runs[0].article.getAttribute("data-book") || slot.bookId;
    if (slot.bookId === "cant") return String(slot.label || bookName);
    const chOf = (/** @type {{ article: HTMLElement }} */ r) => r.article.getAttribute("data-chapter") || "";
    const lastOf = (/** @type {{ article: HTMLElement }} */ r) => Number(r.article.getAttribute("data-chapter-last"));
    /** @type {string[]} */
    const parts = [];   // 장마다 「42:9-11」 — 정말 이어지면 「42:9-43:3」으로 합친다
    runs.forEach((r, i) => {
      const prev = runs[i - 1];
      const continues = !!prev && prev.atEnd && prev.lastNum === lastOf(prev) && r.atStart && r.firstNum === 1;
      if (!continues) { parts.push(`${chOf(r)}:${r.spec}`); return; }
      const pieces = parts[parts.length - 1].split(",");            // 「42:1-2,9-11」 → ["42:1-2", "9-11"]
      const head = String(pieces.pop()).split("-")[0];              // 「9-11」 → 「9」 (「42:9-11」 이면 「42:9」)
      const next = r.spec.split(",");                                // 「1-3,5」 → ["1-3", "5"]
      const tail = String(next.shift()).split("-").pop();            // 「1-3」 → 「3」
      pieces.push(`${head}-${chOf(r)}:${tail}`);
      parts[parts.length - 1] = [...pieces, ...next].join(",");
    });
    return `${bookName} ${parts.join(", ")}`;
  });
  if (wantsGloria(slot, lastChapter)) section.appendChild(buildGloria());
  return section;
}

/**
 * 쿼리에 `track` 을 적은 꼴 — `hrefFor` 와 같은 키 순서(obs → track → set → collect)를 지켜 같은 상태가 같은 주소가 되게.
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
 * Commit the whole view — synchronous, called only after every await resolved
 * and the route is still current.
 * @param {LectionaryModel} m @param {Map<string, BibleChapter | null>} chapters
 */
function commit(m, chapters) {
  setTitle(PAGE_TITLE);
  const $title = _$("page-title");
  // 캘린더 탭(A2)이 생기기 전까지는 성서 목록이 위 단계다 — A2 가 "/calendar" 로 바꾼다.
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  window.hideAudioBar?.();
  clearNode($app);

  const root = el("div", { className: "lectionary" });
  root.appendChild(buildHeader(m));
  root.appendChild(buildChips(m));
  if (m.pair) root.appendChild(buildPair(m));

  if (m.empty) {
    const isCommemoration = m.selected.observance.rank === "commemoration";
    root.appendChild(emptyState({
      icon: null,
      title: isCommemoration ? "기념일 — 본문 없음" : "고유 본문 없음",
      subtitle: isCommemoration
        ? "기념일은 고유 본기도와 독서를 두지 않습니다. 그날의 본문은 다른 관측일을 고르세요."
        : "이 관측일은 그날의 주일 · 평일 본문을 씁니다. 다른 관측일을 고르세요.",
    }));
    $app.appendChild(root);
    return;
  }

  const controls = buildControls(m);
  if (controls) root.appendChild(controls);
  const collects = buildCollects(m);
  if (collects) root.appendChild(collects);

  if (m.group) {
    const of = el("p", { className: "lect-reading-of" }, `${shortName(m.selected.observance.name)} 독서`);
    if (m.group.common) of.appendChild(el("span", { className: "lect-caption" }, ` — ${m.group.title} 공통 독서`));
    root.appendChild(of);
    for (const slot of m.slots) root.appendChild(buildReading(m, slot, chapters));
  } else {
    root.appendChild(emptyState({ icon: null, title: "독서 없음", subtitle: "이 관측일에는 독서가 없습니다 — 본기도만 있습니다." }));
  }
  $app.appendChild(root);
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
  if (!parseDate(date)) {
    commitError("잘못된 날짜입니다", "주소는 /lectionary/YYYY-MM-DD 꼴이어야 합니다.");
    return PAGE_TITLE;
  }
  await Promise.all([preloadCalendar(), preloadLectionary()]);
  if (isStale()) return PAGE_TITLE;

  const resolved = resolveDate(date);
  if (!resolved) {
    commitError("이 날짜는 교회력에 없습니다", "다른 날짜를 골라 주세요.");
    return PAGE_TITLE;
  }
  /** @type {Map<string, ReadingGroup[]>} */
  const groupsCache = new Map();
  const groupsOf = (/** @type {Candidate} */ c) => {
    const key = c.observance.id;
    let g = groupsCache.get(key);
    if (!g) { g = findReadings(resolved, c); groupsCache.set(key, g); }
    return g;
  };
  const ly = liturgicalYearOf(date);
  const stored = Number.isFinite(ly) ? loadLectionaryTrack(ly) : null;
  const model = buildLectionaryModel(resolved, parsed, groupsOf, findCollects(resolved), stored);
  if (!model) {
    commitError("이 날짜는 교회력에 없습니다", "다른 날짜를 골라 주세요.");
    return PAGE_TITLE;
  }

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
  const official = resolved.official;
  return official ? `${shortName(official.observance.name)} ${PAGE_TITLE}` : PAGE_TITLE;
}

export { renderLectionaryView, buildLectionaryModel };
