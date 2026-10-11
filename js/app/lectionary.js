"use strict";
// @ts-check

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
// 뷰가 처음 부딪힌 설계서 §9 미결의 잠정 답(2026-10-12 — 근거는 원장 docs/changes/2026-10-12-lectionary-view.md):
//   미결25 고유 독서 없는 축일의 초기 독서 = 격자(그날의 주일 · 평일) 독서 — 책자대로. 제목 · 색은 승자.
//   미결20 성 토요일: 부활밤 칩을 고르면 헤더 색이 부활밤의 백 — 사계재 규칙(ADR-038 §3)을 「자기 색을
//          가진 비격자 후보」로 일반화했다. 저녁 전례 표지는 두지 않았다.
//   미결38 `set_note` 는 캡션 그대로, 단 파서 내부 표지 「원본 세트 N」은 숨긴다.
//   미결42 칩 라벨은 괄호 설명을 뗀 이름 + (주기, 독서 N) — 전체 이름은 title 속성.

/** @typedef {import("../types").ResolvedDate} ResolvedDate */
/** @typedef {import("../types").Candidate} Candidate */
/** @typedef {import("../types").ReadingGroup} ReadingGroup */
/** @typedef {import("../types").ReadingSlot} ReadingSlot */
/** @typedef {import("../types").CollectOption} CollectOption */
/** @typedef {import("../types").CandidateCollects} CandidateCollects */
/** @typedef {import("../types").BibleChapter} BibleChapter */

import { loadChapter } from "./data-fetch.js";
import { setTitle, appendVerses, buildSegmentTabs } from "./views.js";
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
/** @typedef {{ candidate: Candidate, collects: CollectOption[], selected: boolean }} CollectBlock */
/**
 * 뷰가 그리는 것 전부 — 순수 함수 `buildLectionaryModel` 의 반환. DOM 은 이것만 읽는다.
 * @typedef {{
 *   date: string, resolved: ResolvedDate, selected: Candidate, initial: Candidate,
 *   groups: ReadingGroup[], tracks: Array<1 | 2>, track: 1 | 2 | null,
 *   sets: ReadingGroup[], setIndex: number, group: ReadingGroup | null, slots: ReadingSlot[],
 *   chips: LectionaryChip[], pair: LectionaryPair | null,
 *   collects: CollectBlock[], collectIndex: number, ending: "A" | "B" | "C",
 *   colors: string[], colorAlt: string[], ownColor: boolean,
 *   fast: "major" | "minor" | null, cycle: string | null, empty: boolean,
 *   hrefs: { prev: string, next: string, today: string, tracks: Array<{ track: 1 | 2, href: string, active: boolean }>, sets: string[], collects: string[], pair: { a: string, b: string } | null },
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
/** 선택 봉헌의 네 목적지(설계서 R-6.2-destinations) — 엔진 OPTIONAL_TRANSFER_KINDS 와 같은 넷. */
const OPTIONAL_TRANSFER_KINDS = ["nearby_sunday", "sunday_0102_0108", "sunday_1030_1105", "easter7_sunday"];

// 송영 3종 — 본기도 열거 **마지막에 1회**(ADR-036 §3 · ADR-038 §3). 데이터 eucharist-collects.json
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
// 그린다. 기도서 문구와의 대조는 사용자 확인 대기(원장 2026-10-12).
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
 * 공통뿐이면(고유 독서 없는 축일) 책자대로 그날의 격자 독서를 먼저 보인다 — 제목 · 색은 여전히 승자다.
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

/** `?set=` 은 보이는 세트 가운데 몇 번째인가(1부터) — 실데이터의 `set_no` 와 같다. 범위 밖이면 첫 세트. */
function pickSet(/** @type {ReadingGroup[]} */ sets, /** @type {number | null} */ param) {
  if (!sets.length) return -1;
  if (param && param >= 1 && param <= sets.length) return param - 1;
  return 0;
}

/**
 * 세트 세그먼트 라벨 — 「1안」「2안」. 제목이 갈리는 세트들(미결12 — 좁히기에 실패해 남은 것 전부가 온 날)은
 * 제목으로 가른다.
 * @param {ReadingGroup[]} sets @param {number} i
 */
function setLabel(sets, i) {
  const titles = new Set(sets.map((g) => g.title));
  if (titles.size > 1) {
    const dup = sets.filter((g) => g.title === sets[i].title).length > 1;
    return dup ? `${sets[i].title} ${sets[i].set_no}안` : sets[i].title;
  }
  return `${i + 1}안`;
}

/** 조건부 세트 캡션(미결38 잠정) — `set_note` 그대로, 파서 내부 표지 「원본 세트 N」은 숨긴다. */
function setCaption(/** @type {ReadingGroup} */ group) {
  const n = group.set_note;
  if (!n || /^원본 세트/.test(n)) return null;
  return n;
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
 * 본기도 열거 순서(ADR-038 §3): 고른 관측일의 것이 앞, 그다음 같은 날을 함께 지키는 관측일(`proper` ·
 * `transferred_in` · `commemorated` — 기념만 하는 축일은 본기도만 따라온다)의 것이 `candidates` 순으로 따라온다.
 * 밀린 것(`omitted`) · 떠난 것(`transferred_out`) · 켜지 않은 선택 봉헌(`optional`) · 사계재(지향 — 고를 때만)는
 * 열거하지 않는다. 재조회 없이 `findCollects` 반환을 재배열만 한다.
 * @param {CandidateCollects[]} entries @param {Candidate} selected
 * @returns {CollectBlock[]}
 */
function collectsOrder(entries, selected) {
  const sel = entries.find((e) => e.candidate === selected)
    || entries.find((e) => e.candidate.observance.id === selected.observance.id) || null;
  /** @type {CollectBlock[]} */
  const out = [];
  if (sel && sel.collects.length) out.push({ candidate: sel.candidate, collects: sel.collects, selected: true });
  for (const e of entries) {
    if (e === sel || !e.collects.length) continue;
    const c = e.candidate;
    if (c.status !== "proper" && c.status !== "transferred_in" && c.status !== "commemorated") continue;
    if (c.observance.penitential === true) continue;
    out.push({ candidate: c, collects: e.collects, selected: false });
  }
  return out;
}

/** `?collect=` 는 `collect_no` 다. 없거나 틀리면 첫 대체안. */
function pickCollect(/** @type {CollectOption[]} */ options, /** @type {number | null} */ param) {
  if (!options.length) return -1;
  if (param) {
    const i = options.findIndex((o) => o.collect_no === param);
    if (i >= 0) return i;
  }
  return 0;
}

/** 열거 마지막 본기도의 송영 코드 — 코드가 없으면 A(ADR-036 §3 기본). @returns {"A" | "B" | "C"} */
function endingCodeOf(/** @type {CollectOption | null | undefined} */ last) {
  const e = last && last.ending;
  return e === "A" || e === "B" || e === "C" ? e : "A";
}

/**
 * 두 독서 나란히(ADR-038 §3 · 미결15). 하루에 하나만 — 목적지 주일의 선택 봉헌 → 옮겨 온 축일의 도착일 →
 * 명절 → 선택 봉헌의 당일 순으로 처음 맞는 꼴. 없으면 null.
 * @param {ResolvedDate} resolved
 * @returns {LectionaryPair | null}
 */
function pairOf(resolved) {
  const cands = resolved.candidates;
  const grid = cands.find(isGrid) || null;
  const official = resolved.official;
  const gridName = grid ? shortName(grid.observance.name) : "";

  const optional = cands.find((c) => c.status === "optional");
  if (optional && official && official !== optional) {
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
  if (arrived && grid && arrived !== grid) {
    return {
      kind: "arrival", a: arrived, b: grid,
      aText: {
        label: `${shortName(arrived.observance.name)} 독서`,
        note: arrived.from ? `${monthDayLabel(arrived.from)}에서 옮겨 옴` : "옮겨 옴",
        official: arrived === official,
      },
      bText: { label: `${gridName} 독서`, note: "이날의 평일 독서", official: grid === official },
    };
  }
  if (official && official.observance.rank === "regional_festival" && grid && grid !== official) {
    return {
      kind: "festival", a: official, b: grid,
      aText: { label: `${shortName(official.observance.name)} 독서`, note: "명절 — 이날의 공식 독서", official: true },
      bText: { label: `${gridName} 독서`, note: "이날의 평일 독서", official: false },
    };
  }
  const origin = cands.find((c) => c.status === "proper" && OPTIONAL_TRANSFER_KINDS.includes(String(c.observance.transfer_to)));
  if (origin && grid && origin !== grid) {
    const y = parseInt(resolved.date.slice(0, 4), 10);
    const dest = optionalDestOf(origin.observance.transfer_to, resolved.date, y);
    if (dest && dest !== resolved.date) {
      const when = dest > resolved.date ? "오는" : "지난";
      return {
        kind: "optional-origin", a: origin, b: grid,
        aText: { label: `${shortName(origin.observance.name)} 독서`, note: "이날 지키는 경우 — 이날의 공식 독서", official: origin === official },
        bText: {
          label: `${gridName} 독서`,
          note: `${when} 주일(${monthDayLabel(dest)})로 옮겨 지키는 경우 — 이날은 평일 독서`,
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
 * 헤더 색(ADR-038 §3 · 설계서 R-6.4-color-order): 그날의 `colors`(병기) + `colorAlt`. 고른 칩이 승자가 아니고
 * 자기 색을 가진 **비격자** 후보면(사계재 자 · 부활밤 백 · 생략된 성인) 그 색 하나 — 「재일 독서를 읽을 때만
 * 자색, 어차피 선택 독서」(2026-09-17)의 일반화. 격자 후보는 자기 색이 아니라 절기 바탕색을 들고 있어 제외.
 * @param {ResolvedDate} resolved @param {Candidate | null} selected
 * @returns {{ colors: string[], colorAlt: string[], ownColor: boolean }}
 */
function headerColors(resolved, selected) {
  const obs = selected ? selected.observance : null;
  if (selected && obs && selected !== resolved.official && !isGrid(selected) && typeof obs.color === "string") {
    return { colors: [obs.color], colorAlt: altList(obs.color_alt), ownColor: true };
  }
  const colors = Array.isArray(resolved.colors) && resolved.colors.length ? resolved.colors.slice()
    : (resolved.color ? [resolved.color] : []);
  return { colors, colorAlt: altList(resolved.colorAlt), ownColor: false };
}

/**
 * 상태 → URL. 기본값과 같은 키는 쓰지 않아 「/lectionary/2026-04-05」가 언제나 그날의 초기 화면이다.
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
 * @param {BibleChapter} chapter @param {string} verseSpec
 * @returns {{ verses: import("../types").BibleVerse[], keys: string[] }}
 */
function selectVerses(chapter, verseSpec) {
  const all = chapter.verses || [];
  const keys = verseInstanceKeys(all);
  /** @type {import("../types").BibleVerse[]} */
  const verses = [];
  /** @type {string[]} */
  const selKeys = [];
  all.forEach((v, i) => {
    const end = v.range_end != null ? v.range_end : v.number;
    let inSpec = false;
    for (let x = v.number; x <= end && !inSpec; x++) if (specCoversVerse(verseSpec, x)) inSpec = true;
    if (!inSpec) return;
    verses.push(v);
    selKeys.push(keys[i]);
  });
  return { verses, keys: selKeys };
}

/**
 * 시편 슬롯 끝에 영광송을 붙이나 — 전례시편(`lps`)은 언제나, 송가(`cant`)는 장 JSON 의 `gloria` 가 `false` 가
 * 아닐 때(창조송가 · 참회송가 · 찬양송가는 붙이지 않는다). 시편 자리의 일반 성서 본문(다니엘 · 요나 · 토비트)은 없다.
 * @param {ReadingSlot} slot @param {BibleChapter | null | undefined} lastChapter  슬롯 마지막 ref 의 장
 */
function wantsGloria(slot, lastChapter) {
  if (slot.slot !== "psalm") return false;
  if (slot.bookId === "lps") return true;
  if (slot.bookId === "cant") return !!lastChapter && lastChapter.gloria !== false;
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
  const defaults = { obs: initial.observance.id, track: pickTrack(groups, null, storedTrack) };
  const sets = setsOf(groups, track);
  const setIndex = pickSet(sets, query.set);
  const group = setIndex >= 0 ? sets[setIndex] : null;
  const slots = slotsInOrder(group);

  const collects = collectsOrder(collectEntries, selected);
  const first = collects.length && collects[0].selected ? collects[0] : null;
  const collectIndex = first ? pickCollect(first.collects, query.collect) : -1;
  // 열거 마지막 본기도의 송영 — 고른 관측일 혼자면 그 대체안의 것.
  const lastBlock = collects.length ? collects[collects.length - 1] : null;
  const lastCollect = lastBlock
    ? (lastBlock.selected ? lastBlock.collects[Math.max(collectIndex, 0)] : lastBlock.collects[lastBlock.collects.length - 1])
    : null;

  const base = { obs: selected.observance.id, track, set: setIndex + 1, collect: first ? first.collects[Math.max(collectIndex, 0)].collect_no : null };
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
  const pair = pairOf(resolved);
  const { colors, colorAlt, ownColor } = headerColors(resolved, selected);
  const empty = !groups.length && !collects.some((b) => b.selected);

  return {
    date, resolved, selected, initial, groups, tracks, track, sets, setIndex, group, slots,
    chips, pair, collects, collectIndex, ending: endingCodeOf(lastCollect),
    colors, colorAlt, ownColor, fast: fastOf(resolved),
    cycle: resolved.coord.year && CYCLE_LABEL[resolved.coord.year] ? CYCLE_LABEL[resolved.coord.year] : null,
    empty,
    hrefs: {
      prev: `/lectionary/${addDays(date, -1)}`,
      next: `/lectionary/${addDays(date, 1)}`,
      today: "/lectionary",
      tracks: tracks.map((t) => ({ track: t, href: hrefFor(date, { ...base, track: t, set: null, collect: null }, defaults), active: t === track })),
      sets: sets.map((_, i) => hrefFor(date, { ...base, set: i + 1, collect: null }, defaults)),
      collects: first ? first.collects.map((o) => hrefFor(date, { ...base, collect: o.collect_no }, defaults)) : [],
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
    }, chip.label);
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
  for (const [cand, text, href] of [[pair.a, pair.aText, hrefs.a], [pair.b, pair.bText, hrefs.b]]) {
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
      a.addEventListener("click", () => { if (Number.isFinite(ly)) saveLectionaryTrack(ly, m.hrefs.tracks[i].track); });
    });
    ctl.appendChild(seg);
    wrap.appendChild(ctl);
  }
  if (m.sets.length > 1) {
    const ctl = el("div", { className: "lect-control lect-sets" });
    ctl.appendChild(el("span", { className: "lect-control-label" }, "대안 독서"));
    ctl.appendChild(buildSegmentTabs(
      m.sets.map((g, i) => ({ label: setLabel(m.sets, i), href: m.hrefs.sets[i], active: i === m.setIndex, title: setCaption(g) || undefined })),
      { ariaLabel: "대안 독서", className: "division-tabs--compact" },
    ));
    const caption = m.group ? setCaption(m.group) : null;
    if (caption) ctl.appendChild(el("p", { className: "lect-caption" }, caption));
    wrap.appendChild(ctl);
  }
  return wrap.childElementCount ? wrap : null;
}

/** @param {LectionaryModel} m */
function buildCollects(m) {
  if (!m.collects.length) return null;
  const section = el("section", { className: "lect-section lect-collects", "data-slot": "collect" });
  section.appendChild(el("h3", { className: "lect-slot" }, "본기도"));
  for (const block of m.collects) {
    const name = shortName(block.candidate.observance.name);
    if (block.selected) {
      if (block.collects.length > 1) {
        section.appendChild(buildSegmentTabs(
          block.collects.map((o, i) => ({ label: `${o.collect_no}안`, href: m.hrefs.collects[i], active: i === m.collectIndex })),
          { ariaLabel: "본기도 대체안", className: "division-tabs--compact" },
        ));
      }
      const o = block.collects[Math.max(m.collectIndex, 0)];
      const art = el("article", { className: "lect-collect chapter-text", lang: "ko" });
      if (o.common) art.appendChild(el("p", { className: "lect-caption" }, `${o.title} 공통 본기도`));
      art.appendChild(el("p", { className: "lect-collect-text" }, o.text));
      section.appendChild(art);
    } else {
      const art = el("article", { className: "lect-collect lect-collect--also chapter-text", lang: "ko" });
      art.appendChild(el("h4", { className: "lect-collect-who" }, `${name} 본기도${block.collects[0].common ? " (공통)" : ""}`));
      for (const o of block.collects) {
        if (block.collects.length > 1) art.appendChild(el("p", { className: "lect-caption" }, `${o.collect_no}안`));
        art.appendChild(el("p", { className: "lect-collect-text" }, o.text));
      }
      section.appendChild(art);
    }
  }
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
  section.appendChild(head);

  // Verse instances already drawn in this slot — two refs of one chapter must
  // not print the same verse twice (same key discipline as bookmark-read.js).
  const seen = new Set();
  for (const ref of refs) {
    const data = chapters.get(`${slot.bookId}:${ref.chapter}`);
    if (!data) {
      section.appendChild(el("p", { className: "lect-missing", role: "status" }, `본문을 불러오지 못했습니다 (${slot.bookId} ${ref.chapter})`));
      continue;
    }
    const picked = selectVerses(data, ref.verseSpec);
    const verses = [];
    const keys = [];
    picked.verses.forEach((v, i) => {
      if (seen.has(picked.keys[i])) return;
      seen.add(picked.keys[i]);
      verses.push(v);
      keys.push(picked.keys[i]);
    });
    if (!verses.length) continue;
    const article = el("article", { className: "chapter-text", lang: "ko" });
    // Clean 봉독 surface (ADR-035): cite chips off, no parallels, no note anchors.
    appendVerses(article, verses, { hideCites: true, instanceKeys: keys });
    section.appendChild(article);
  }
  if (wantsGloria(slot, lastChapter)) section.appendChild(buildGloria());
  return section;
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
  const entrySeq = typeof window.routeSeq === "function" ? window.routeSeq() : null;
  const isStale = () => entrySeq !== null && window.routeSeq() !== entrySeq;

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
  const official = resolved.official;
  return official ? `${shortName(official.observance.name)} ${PAGE_TITLE}` : PAGE_TITLE;
}

export { renderLectionaryView, buildLectionaryModel };
