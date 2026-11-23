"use strict";

// Search engine wire-up + UI controllers (desktop top-bar + mobile full-screen
// /search view + history panel). Owns the Worker lifetime (`searchWorker`), all
// `$search*` DOM anchors, and the search-internal module state
// (`searchAutoNavigate`). The mobile bottom sheet was removed with the search
// FAB (ADR-030) — mobile search is the /search route with its in-page input at
// the top (ADR-048).
//
// Phase 5 of the app.js modularization (ADR-018). ESM-pattern (ADR-019):
// named exports + window facade for legacy app.js callers (route handler at
// `/search?q=`).

/** @typedef {import("../types.js").SearchHistoryList} SearchHistoryList */
/** @typedef {import("../types.js").BooksData} BooksData */
/** @typedef {import("./liturgical-engine.js").KeptDay} KeptDay */
/** @typedef {typeof import("./liturgical-engine.js")} Engine */

import { verseNumberSpec } from "./verse-spec.js";

const {
  _$, el, clearNode, chUnit, missingChapterText, emptyState, barBottom, churchName, SHEET_INERT_SELECTORS, isSmallLayout,
  LARGE_LAYOUT_QUERY,
} = window.appHelpers;
const {
  SEARCH_HISTORY_MAX,
  loadSearchHistory, loadSearchHistoryEntries,
  pushSearchHistory, removeSearchHistory, clearSearchHistory, loadParish, saveParish,
} = window.appStorage;
const { dismissLaunchScreen, loadParishOptions, fillSelect } = window.appSettings;

// Visible-by-default count for the history panel; the rest are revealed
// behind a "더 보기" button. Local to this module — only the panel
// controller consumes it.
const SEARCH_HISTORY_VISIBLE = 10;

// Mirrors app.js's DATA_DIR — keep in sync if the bible data path changes.
const DATA_DIR = "/data";

// DOM anchors. Redeclared locally so search.js is self-contained; same DOM
// nodes as app.js's existing references, just module-scoped variables.
const $app = _$("app");
const $searchBar = _$("search-bar");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchHistoryToggle = _$("search-history-toggle");
const $searchHistoryPanel = _$("search-history");

// ── Search core ──

// ── BEGIN WORKER WIRE-UP ──
// Exercised by tests/unit/search.test.js. Self-contained: only depends on
// the standard `Worker` constructor + the module-private state declared
// here. Test loader extracts this block and runs it with a Worker stub.
/** @type {Worker | null} */
let searchWorker = null;
/** @type {((res: any) => void) | null} */
let pendingSearchCb = null;
let activeSearchId = 0;
// Called when partial results arrive before all chunks are loaded.
// Overwritten by renderSearchResults for each search.
/** @type {((partial: any) => void) | null} */
let partialResultsCb = null;
// The late `lectionary` message of the active search (the worker sends it once the lectionary index arrives, ADR-044
// §1) and the callers waiting for it (`nextLectionary`). A new search drops both and wakes the waiters with null.
/** @type {any} */
let lateLectionary = null;
/** @type {Array<(msg: any) => void>} */
let lectionaryWaiters = [];

function ensureSearchWorker() {
  if (searchWorker) return searchWorker;
  searchWorker = new Worker("/js/search-worker.js");
  searchWorker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg.type === "partial-results" && msg.searchId === activeSearchId) {
      if (partialResultsCb) partialResultsCb(msg);
    }
    if (msg.type === "lectionary" && msg.searchId === activeSearchId) {
      lateLectionary = msg;
      const waiters = lectionaryWaiters;
      lectionaryWaiters = [];
      for (const wake of waiters) wake(msg);
    }
    if (msg.type === "results" || msg.type === "error") {
      // Worker init/load failures may emit error without searchId in some browsers.
      // Treat those as terminal for the current pending search to avoid stuck UI.
      const isCurrentSearch =
        msg.searchId == null ? msg.type === "error" : msg.searchId === activeSearchId;
      if (pendingSearchCb && isCurrentSearch) {
        const cb = pendingSearchCb;
        pendingSearchCb = null;
        cb(msg.type === "error" ? null : msg);
      }
    }
  });
  searchWorker.postMessage({
    type: "init",
    metaUrl: `${DATA_DIR}/search-meta.json`,
    chunks: [
      { name: "nt", url: `${DATA_DIR}/search-nt.json` },
      { name: "dc", url: `${DATA_DIR}/search-dc.json` },
      { name: "ot", url: `${DATA_DIR}/search-ot.json` },
      // 성시(전례시편과 송가, ADR-046). 워커가 이 이름으로 성서 본문과 따로 센다
      { name: "lit", url: `${DATA_DIR}/search-lit.json` },
    ],
    lectionaryUrl: `${DATA_DIR}/lectionary/search-lectionary.json`,
    // 지역 축일(ADR-044 §3)을 찾는 본당 표. 전례독서 색인과 함께 받는다
    localUrl: `${DATA_DIR}/lectionary/local-observances.json`,
  });
  return searchWorker;
}

/**
 * The late `lectionary` message of search `searchId` (ADR-044 §1): at once if it already came, null once `ms` passed
 * (`Infinity`: no limit) or a newer search started.
 * @param {number} searchId
 * @param {number} ms
 * @returns {Promise<any>}
 */
function nextLectionary(searchId, ms) {
  return new Promise((resolve) => {
    if (searchId !== activeSearchId) return resolve(null);
    if (lateLectionary && lateLectionary.searchId === searchId) return resolve(lateLectionary);
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    /** @param {any} msg */
    const wake = (msg) => {
      if (timer !== null) clearTimeout(timer);
      resolve(msg);
    };
    lectionaryWaiters.push(wake);
    if (Number.isFinite(ms)) {
      timer = setTimeout(() => {
        lectionaryWaiters = lectionaryWaiters.filter((w) => w !== wake);
        resolve(null);
      }, ms);
    }
  });
}

/**
 * 송가 이름(「모세송가」), 책 id마다 — 앱이 받아 둔 책 목록(books.json)의 `titles`다(ADR-047 §5). 검색마다 워커에 실어 보낸다. 워커가
 * 같은 파일을 다시 받지 않게 하려는 것이다. 책 목록을 받지 못했으면 싣지 않는다. 검색 화면이 다음 검색 전에 목록을 다시 받으므로
 * (`ensureBookMap`) 그다음 검색부터 실린다.
 * @returns {{ [bookId: string]: { [chapter: string]: string } } | undefined}
 */
function canticleTitles() {
  const books = window.getBooksCache?.();
  if (!books) return undefined;
  return Object.fromEntries(
    books.filter((b) => b.titles).map((b) => [b.id, /** @type {{ [chapter: string]: string }} */ (b.titles)]));
}

/**
 * @param {string} query
 * @param {number} page
 * @param {number} pageSize
 * @param {((partial: any) => void) | null} [onPartial]
 * @param {{ scopeBooks?: string[], showBook?: string | null }} [opts]
 *   scopeBooks — book-picker filter (book ids), forwarded to the worker (ADR-033).
 *   showBook — the book pill shown within that scope (ADR-049 §2); 「전체」 when absent.
 */
function doSearch(query, page, pageSize, onPartial, opts) {
  return new Promise((resolve) => {
    const worker = ensureSearchWorker();
    activeSearchId += 1;
    pendingSearchCb = resolve;
    partialResultsCb = onPartial || null;
    lateLectionary = null;
    const waiters = lectionaryWaiters;
    lectionaryWaiters = [];
    for (const wake of waiters) wake(null);
    worker.postMessage({
      type: "search", q: query, page, pageSize, searchId: activeSearchId,
      scopeBooks: (opts && opts.scopeBooks) || [],
      // 책을 고른 검색에서 보이는 책 알약(ADR-049 §2). 없으면 「전체」다
      showBook: (opts && opts.showBook) || "",
      // 소속교회(ADR-041 §6). 검색마다 실어, 설정을 바꾼 뒤의 검색이 곧 새 교회로 찾는다
      parish: loadParish(),
      titles: canticleTitles(),
    });
  });
}
// ── END WORKER WIRE-UP ──

// ── BEGIN PURE HELPERS ──
// Exercised by tests/unit/search.test.js. Each function takes its DOM
// target via parameters and creates new nodes via `el` / createTextNode /
// createDocumentFragment — no reliance on the module-level $X anchors.
// Test loader extracts this block with a minimal Element stub + el shim.
// ── BEGIN QUOTE_MATCH ──
// Two identical copies: js/search-worker.js (a classic worker script, which
// cannot import a module) and js/app/search.js. tests/unit/search.test.js
// checks that they stay the same.
// 검색은 따옴표 여섯 가지를 무시하고, 이어진 공백을 한 칸으로 본다(ADR-005 「따옴표를
// 무시하는 일치」, 사용자 결정 2026-11-06). 성서 본문에는 아포스트로피가 없어 홑따옴표까지
// 지워도 잃는 일치가 없다. 공백도 접는 까닭: 인덱스는 인용으로 나뉜 조각 사이에 공백 한 칸을
// 넣어, 따옴표를 지우면 `아브라함에게 “ 너로`가 공백 둘이 된다.
const QUOTE_CHARS_RE = /["'“”‘’]/g;
const WHITESPACE_CHAR_RE = /\s/;

/**
 * Lowercase, drop quote characters and fold each run of whitespace to one
 * space — the form both query and verse text are compared in.
 * @param {string} s
 * @returns {string}
 */
function normalizeForMatch(s) {
  return s.toLowerCase().replace(QUOTE_CHARS_RE, "").replace(/\s+/g, " ");
}

/**
 * The query side of normalizeForMatch, trimmed: dropping a quote can leave a
 * lone space (`" '` → " ") that would match nearly every verse.
 * "" means there is nothing to search for.
 * @param {string} q
 * @returns {string}
 */
function normalizeQuery(q) {
  return normalizeForMatch(q).trim();
}

/**
 * Non-overlapping [start, end) ranges of `query` in `text`, compared the way
 * normalizeForMatch does (quotes ignored, whitespace runs as one space) and
 * mapped back to offsets in the original `text`. Quotes at either edge of a
 * match fall outside its range; quotes inside it stay in.
 * Returns [] when the query is empty once quotes (and edge spaces) are dropped.
 * @param {string} text
 * @param {string} query
 * @returns {Array<[number, number]>}
 */
function findMatchRanges(text, query) {
  const q = normalizeQuery(query);
  if (!q) return [];
  const lower = text.toLowerCase();
  // `kept` is normalizeForMatch(text); pos[k] = offset in `text` of its k-th
  // character (a whitespace run is represented by its first character). Assumes
  // toLowerCase keeps length, as the substring highlight did before.
  /** @type {number[]} */
  const pos = [];
  let kept = "";
  let afterSpace = false;
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i];
    if (ch === '"' || ch === "'" || ch === "“" || ch === "”" || ch === "‘" || ch === "’") continue;
    const space = WHITESPACE_CHAR_RE.test(ch);
    if (space && afterSpace) continue;
    afterSpace = space;
    pos.push(i);
    kept += space ? " " : ch;
  }
  /** @type {Array<[number, number]>} */
  const ranges = [];
  let from = 0;
  let idx = kept.indexOf(q, from);
  while (idx !== -1) {
    ranges.push([pos[idx], pos[idx + q.length - 1] + 1]);
    from = idx + q.length;
    idx = kept.indexOf(q, from);
  }
  return ranges;
}
// ── END QUOTE_MATCH ──

/**
 * Split text pieces into parts, marking what matches `query`. The pieces are
 * adjacent text of one verse (the chapter view draws a verse as several pieces:
 * around a `<cite>`, one per line of a poem), so a match can run across pieces.
 * They are joined as they are drawn and searched once with findMatchRanges — the
 * text the search index holds, since the indexer (common-bible-data
 * `segments_text`) glues the pieces the view draws tight. When that finds
 * nothing they are joined with one space, the text of the index before that
 * change: the two repositories ship separately, so either index can be in use.
 * Each piece then gets only the part of every range that overlaps it. A piece
 * with no overlap comes back as one unmarked part, an empty piece as no part.
 * @param {ReadonlyArray<string>} texts
 * @param {string | null} query
 * @returns {Array<Array<{ text: string, mark: boolean }>>} parts per piece, in order
 */
function splitPiecesByMatches(texts, query) {
  let ranges = query ? findMatchRanges(texts.join(""), query) : [];
  let gap = 0; // what joins two pieces: nothing, or one space
  if (query && ranges.length === 0 && texts.length > 1) {
    ranges = findMatchRanges(texts.join(" "), query);
    gap = 1;
  }
  let base = 0;
  return texts.map((text) => {
    const end = base + text.length;
    /** @type {Array<{ text: string, mark: boolean }>} */
    const parts = [];
    let pos = 0;
    for (const [s, e] of ranges) {
      const a = Math.max(s, base) - base;
      const b = Math.min(e, end) - base;
      if (a >= b) continue;
      if (a > pos) parts.push({ text: text.substring(pos, a), mark: false });
      parts.push({ text: text.substring(a, b), mark: true });
      pos = b;
    }
    if (pos < text.length) parts.push({ text: text.substring(pos), mark: false });
    base = end + gap; // the joining space, if any, belongs to no piece
    return parts;
  });
}

/**
 * The nodes for one piece's parts: a text node, or a <mark> for a matched part.
 * @param {ReadonlyArray<{ text: string, mark: boolean }>} parts
 * @returns {Node[]}
 */
function partsToNodes(parts) {
  return parts.map((part) => (part.mark
    ? el("mark", { className: "search-highlight", role: "presentation" }, part.text)
    : document.createTextNode(part.text)));
}

// Text highlight helper: splits text on query matches and wraps in <mark>
/**
 * @param {Node} target
 * @param {string} text
 * @param {string | null} query  empty or null → plain text
 */
function appendTextWithHighlight(target, text, query) {
  if (!query || !text) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  for (const node of partsToNodes(splitPiecesByMatches([text], query)[0])) target.appendChild(node);
}

/**
 * Highlight `query` in the text nodes of one verse, in reading order (the chapter
 * view's ?hl=). A match may run across nodes: each node is replaced by its text
 * and <mark> parts, and a node without a match stays as it is.
 * @param {ReadonlyArray<Text>} nodes
 * @param {string | null} query  empty or null → nothing to highlight
 */
function highlightTextNodes(nodes, query) {
  if (!query) return;
  const partsPerNode = splitPiecesByMatches(nodes.map((node) => node.data), query);
  nodes.forEach((node, i) => {
    const parts = partsPerNode[i];
    if (parts.length === 1 && !parts[0].mark) return;
    node.replaceWith(...partsToNodes(parts));
  });
}

// Build snippet with highlighted query for search results
/**
 * @param {string} text
 * @param {string} query
 */
function buildSnippet(text, query) {
  const frag = document.createDocumentFragment();
  const span = el("span", { className: "search-result-text" });

  const first = findMatchRanges(text, query)[0];
  const matchIdx = first ? first[0] : -1;

  // Show ~40 chars before/after match
  let displayText = text;
  let prefix = "";
  let suffix = "";
  if (text.length > 100 && matchIdx > 40) {
    displayText = text.substring(matchIdx - 30);
    prefix = "…";
  }
  if (displayText.length > 100) {
    displayText = displayText.substring(0, 100);
    suffix = "…";
  }

  if (prefix) span.appendChild(document.createTextNode(prefix));
  appendTextWithHighlight(span, displayText, query);
  if (suffix) span.appendChild(document.createTextNode(suffix));
  frag.appendChild(span);
  return frag;
}

/**
 * Where each chapter of a verse reference from the worker leads, and its verses as the card shows them (ADR-005
 * 「구절 표기와 구절 바로가기」). The typed numbers go into the address's form (ascending, no overlap — "18-19,16" →
 * "16,18-19"): parsePath opens any other list without a highlight (ADR-040). An end of 999 is the end of the chapter
 * (js/search-worker.js REF_CHAPTER_END) — the chapter view clips it. The whole chapter, or a reference that names no
 * verse (`창세 1:0`), opens the chapter.
 * @param {{ bookId: string, parts: ReadonlyArray<{ chapter: number, verses: string }> }} ref
 * @returns {Array<{ chapter: number, path: string, verses: string }>}
 */
function verseRefTargets(ref) {
  return ref.parts.map(({ chapter, verses }) => {
    const chapterPath = `/${ref.bookId}/${chapter}`;
    const spec = verseNumberSpec(verses.split(","));
    if (spec === "all" || spec === "1-999") return { chapter, path: chapterPath, verses: "" };
    const shown = spec.replace(/,/g, ", ");
    return {
      chapter,
      path: `${chapterPath}/${spec}`,
      verses: shown.endsWith("-999") ? `${shown.slice(0, -"-999".length)}절부터` : `${shown}절`,
    };
  });
}

/**
 * Build a /search URL from structured state (ADR-033). Pure — uses only
 * encodeURIComponent — so the book-picker scope (`in=`) round-trips through the
 * URL (mirrors parsePath). `page` is dropped when 1; empty params are omitted.
 * `group` is the result pill (ADR-044 §1, ADR-046 §3): 성시 and 전례일 are written, 성서 본문 is the default.
 * `book` is the book pill shown with a book scope (ADR-049 §2); 「전체」 is the default. The worker shows 「전체」 for a
 * book outside the scope or with no results.
 * @param {{ q?: string, page?: number, filterBooks?: string[], group?: string | null, book?: string | null }} state
 * @returns {string}
 */
function buildSearchUrl(state) {
  const parts = [];
  if (state.q) parts.push("q=" + encodeURIComponent(state.q));
  if (state.page && state.page > 1) parts.push("page=" + state.page);
  for (const b of state.filterBooks || []) parts.push("in=" + encodeURIComponent(b));
  if (state.group === "psalter" || state.group === "lectionary") parts.push("group=" + state.group);
  if (state.book) parts.push("book=" + encodeURIComponent(state.book));
  return "/search" + (parts.length ? "?" + parts.join("&") : "");
}

// ── Lectionary results (ADR-044 §1) ──
// 전례일 줄은 캘린더 목록의 줄(.cal-row)에서 날짜 칸을 뺀 모양이다. 줄에는 누르면 열리는 날(이번 전례년의 날)과 그날의 색을 적고, 해에
// 따라 다른 독서를 읽는 줄에는 다른 날로 가는 링크를 따로 두며, 해마다 같은 독서를 읽는 줄에는 다음 전례년의 날을 글로 적는다(ADR-044 §1). 날짜는 교회력 엔진으로 계산한다
// (`lectDaysOf`). 아직 계산하지 못했으면 날짜가 정해진 전례일만 그 날짜(「12월 29일」)를 적어 같은 이름을 구별한다.

const LECT_SLOT_LABEL = ["제1독서", "성시", "제2독서", "복음"];
const LECT_SLOT_KEY = ["first", "psalm", "second", "gospel"];
/** @type {Record<string, string>} */
const LECT_CYCLE_LABEL = { A: "가해", B: "나해", C: "다해", I: "홀수해", II: "짝수해" };
/** @type {Record<string, string>} */
const LECT_TRACK_LABEL = { 1: "연속 독서", 2: "복음 주제" };
/** @type {Record<string, string>} */
const LECT_RANK_LABEL = { principal: "대축일", major_feast: "주요축일", minor_feast: "축일", commemoration: "기념일" };
// 캘린더 목록과 같이 축일 이상과 주일의 제목은 한 단계 굵은 500이다(DESIGN.md §3). 캘린더 목록의 규칙은 calendar.js `rowLevelOf`에
// 있다. 그쪽은 그날의 계산 결과를, 이쪽은 색인을 읽어 함수를 함께 쓰지 못하므로, 한쪽을 고치면 다른 쪽도 고친다.
const LECT_BOLD_RANKS = new Set(["principal", "privileged_sunday", "major_feast", "minor_feast", "regional_festival"]);
// 해(`LECT_CYCLE_LABEL`), 전례색의 이름, 요일은 전례독서 화면(lectionary.js `CYCLE_LABEL`, `COLOR_LABEL`, `WEEKDAY_KO`)과 같고, 성탄
// 평일의 식별자는 엔진의 값과 같다. 검색 화면은 교회력 자료를 내려받기 전에도 줄을 그리고 그 모듈들을 불러오지 않아 따로 둔다. 같은지는
// search.test.js가 본다(코드 리뷰 2026-11-16).
/** @type {Record<string, string>} */
const LECT_COLOR_LABEL = { white: "백색", red: "적색", green: "녹색", violet: "자색", rose: "장미색", blue: "청색" };
const LECT_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// 성탄 평일의 격자 전례일(엔진 `CHRISTMAS_WEEKDAY_PREFIX`). 독서는 날짜로 정해져 있고 이름은 주일을 기준으로 해마다 바뀌어, 줄 제목에는
// 열리는 날의 이름(「성탄 1주 수요일」)을 적는다(ADR-044 §3).
const LECT_CHRISTMAS_WEEKDAY = "grid:christmas-x-weekday-";
/**
 * 줄이 여는 날(`open`, 이번 전례년의 날)과, 해에 따라 다른 독서를 읽는 줄이 그날이 지났을 때 다음에 읽는 날(`next`). `nextIds`는
 * 다음 링크의 슬러그다(엔진 `findReadingDay`). 이름으로 찾은 줄이 해에 따라 다른 독서를 읽으면 `year`는 열리는 날의 해(`A`, `I` 등)이고,
 * `cycles`는 그 뒤에 다른 해의 독서를 읽는 첫날을 해마다 하나씩 날짜 차례로 담는다(ADR-044 §1). 그 밖의 줄은 `year`가 null, `cycles`가
 * 비었다. `nextYear`는 해마다 같은 독서를 읽는 줄이 이번 전례년의 날을 열 때 다음 전례년에 그 전례일을 지키는 날이고, 다음 전례년에
 * 지키지 않으면 `date`가 null이다. 그 밖의 줄은 null이다.
 * @typedef {{ open: KeptDay, next: KeptDay | null, nextIds: string[], year: string | null, cycles: KeptDay[],
 *   nextYear: { date: string | null } | null }} LectDays
 */
/**
 * 줄 아래의 링크 하나. `prefix`는 날짜 앞의 글(「다음」, 「나해」)이다.
 * @typedef {{ href: string, label: string, prefix: string, date: string }} LectNext
 */

/**
 * 끝 글자에 받침이 있는가. 한글 음절이 아니면 없다고 본다. 엔진(liturgical-engine.js)에도 같은 계산이 있지만, 엔진은 검색 화면이
 * 처음에 받지 않는 모듈이고 시험이 코드 구역을 잘라 읽어 공용 함수(helpers.js)를 쓰지 않는다.
 * @param {string} word
 */
function hasBatchim(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
}

/** 「으로」와 「로」 — ㄹ 받침 뒤는 「로」다. @param {string} word */
function roOf(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return hasBatchim(word) && code % 28 !== 8 ? "으로" : "로";
}

/**
 * 비슷한 말로 바꿔 찾았다는 한 줄(ADR-044 §3): 「‘주님 부활 대축일’을 ‘부활대축일’로 찾았습니다.」
 * @param {Array<{ from: string, to: string }>} synonyms
 * @returns {string}
 */
function synonymNote(synonyms) {
  const parts = synonyms.map(({ from, to }) => `‘${from}’${hasBatchim(from) ? "을" : "를"} ‘${to}’${roOf(to)}`);
  return `${parts.join(", ")} 찾았습니다.`;
}

/**
 * 검색이 모르는 책 이름을 `in:` 뒤에 쳤을 때의 설명(ADR-005 「검색 연산자 `in:`」, 사용자 결정 2026-11-18):
 * 「‘없는책’이라는 책을 찾지 못했어요. in: 뒤에는 마르, 마르코처럼 책 이름을 적어 주세요.」 조사는 마지막 이름의 받침으로 고른다.
 * @param {string[]} names
 * @returns {string}
 */
function unknownBookNote(names) {
  const last = names[names.length - 1] || "";
  const listed = names.map((n) => `‘${n}’`).join(", ");
  return `${listed}${hasBatchim(last) ? "이라는" : "라는"} 책을 찾지 못했어요. in: 뒤에는 마르, 마르코처럼 책 이름을 적어 주세요.`;
}

/** 「12.29」를 「12월 29일」로. @param {string | null} date */
function fixedDateText(date) {
  const m = /^(\d\d)\.(\d\d)$/.exec(date || "");
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : null;
}

/** 「2026-12-06」을 「12월 6일」로(`fixedDateText`). 형식이 다르면 받은 그대로다. @param {string} date */
function monthDayText(date) {
  return fixedDateText(date.slice(5).replace("-", ".")) || date;
}

/**
 * 해의 목록(오름차순)을 「2027년」, 「2027, 2032년」, 「2024, 2026~2027년」으로 적는다. 이어진 해는 물결표로 잇는다(ADR-044 §4).
 * @param {number[]} years
 */
function yearsText(years) {
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < years.length; ) {
    let j = i;
    while (j + 1 < years.length && years[j + 1] === years[j] + 1) j++;
    parts.push(j > i ? `${years[i]}~${years[j]}` : `${years[i]}`);
    i = j + 1;
  }
  return `${parts.join(", ")}년`;
}

/**
 * 「…과 겹침」에 적는 전례일 이름(ADR-044 §4). 괄호 안의 설명은 떼고, 성인 축일이면 이름 뒤에 「축일」을 붙인다(「성 니콜라 축일」).
 * 이름이 「날」이나 「축일」로 끝나면 붙이지 않는다(「성 십자가의 날」). 전례독서 화면이 옮긴 축일을 알리는 말(lectionary.js
 * `shortName`, `feastPhraseOf`)과 같은 규칙이다. 한쪽을 고치면 다른 쪽도 고친다. 그쪽의 「재의 수요일」 예외는 여기에 필요 없다.
 * 이동 축일이라 성인 축일(`saint`)이 아니기 때문이다. 검색 화면은 lectionary.js를 받지 않고, 시험이 코드 구역을 잘라 읽어 함께 쓰지
 * 않는다. 주일과 국가 명절(설날, 추석)은 이름 그대로다.
 * @param {string} name @param {boolean} saint
 */
function overlapName(name, saint) {
  const short = name.replace(/\s*\([^()]*\)/g, "").replace(/\s{2,}/g, " ").trim() || name;
  return saint && !short.endsWith("날") && !short.endsWith("축일") ? `${short} 축일` : short;
}

const LECT_YEAR_RE = /(?:^|\s)\d{4}년?(?:\s*[-~～–]\s*\d{4}년?)?(?:\s|$)/;

/**
 * 연도를 붙인 이름 검색어(ADR-044 §4)로 보이는가. 워커(`parseLectYear`)는 받는 해와 이름까지 보고 정하지만, 여기서는 찾기 전에 성탄 평일의
 * 이름을 보내고 기다릴지만 가른다. 연도를 붙인 검색은 그 이름(이번 전례년의 이름)을 쓰지 않는다(코드 리뷰 2026-11-17).
 * @param {string} query @returns {boolean}
 */
function looksLikeYearQuery(query) {
  return LECT_YEAR_RE.test(query);
}

/**
 * 「MM.DD」 날짜를 지키는 다음 날(`today`와 같거나 늦은 첫 그날). `today`가 비었으면 기기의 오늘이다. 없는 날(평년의 2월 29일)은 그날이 있는
 * 해까지 넘긴다. 지역 축일(축성일, 설립일)은 해마다 같은 날짜이고 옮겨 지키지 않는다(ADR-044 §3).
 * @param {string} md 「MM.DD」 @param {string} [today] "YYYY-MM-DD" @returns {string}
 */
function nextMonthDay(md, today = "") {
  const now = today || (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const [m, d] = md.split(".").map(Number);
  for (let y = Number(now.slice(0, 4)); y < Number(now.slice(0, 4)) + 8; y++) {
    const date = monthDayIn(y, m, d);
    if (date && date >= now) return date;
  }
  return `${now.slice(0, 4)}-${md.replace(".", "-")}`;
}

/**
 * `y`년의 그 월일(「YYYY-MM-DD」). 그해에 없는 날(평년의 2월 29일)이면 null.
 * @param {number} y @param {number} m @param {number} d @returns {string | null}
 */
function monthDayIn(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 「MM.DD」 날짜가 `from`부터 `to`까지(둘 다 포함) 있는 날들(날짜 차례). 한 전례년(52주나 53주)에는 없거나 하나거나 둘이다.
 * @param {string} md 「MM.DD」 @param {string} from @param {string} to  "YYYY-MM-DD" @returns {string[]}
 */
function monthDaysBetween(md, from, to) {
  const [m, d] = md.split(".").map(Number);
  /** @type {string[]} */
  const dates = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const date = monthDayIn(y, m, d);
    if (date && date >= from && date <= to) dates.push(date);
  }
  return dates;
}

/**
 * 지역 축일 줄(ADR-044 §3)이 여는 주소. 소속교회의 축성일은 그날 축성일을 고른 화면(`?obs=my-dedication`, lectionary.js `MY_DEDICATION_ID`),
 * 설립일은 그날이다. 설립일은 그날의 전례일이 아니라 본기도만 덧붙는 날이다.
 * @param {any} item  LectItem with `local` @param {string} date
 */
function localHref(item, date) {
  return item.local.level === "dedication" ? `/lectionary/${date}?obs=my-dedication` : `/lectionary/${date}`;
}

/**
 * 지역 축일을 찾지 못했을 때 결과 위에 두는 안내(ADR-044 §3). `pick`이 있으면 그 본당을 소속교회로 등록하는 단추를, `list`면 교회 목록을 카드
 * 안에 둔다. 소속교회를 등록하지 않은 사람만 등록하게 한다. 소속교회가 있는 사람이 다른 본당을 찾았으면 날짜만 알린다. 축성 독서는 모든 본당이
 * 같은 공통 독서(「성당 축성일」)라 바꿀 것이 없다. 소속교회에 축복일만 있으면 축성 독서가 없어 뒷문장을 뺀다. 축복일에는 축성 독서가 없다.
 * 등록하는 단추의 이름은 설정의 교회 목록에 적는 이름이다(「용인교회」, `nameOf`는 helpers.js `churchName`). 등록한 뒤의 알림과 같다. 축성한 것은
 * 성당이므로 카드의 문장은 본당 표의 이름 그대로다(ADR-041 §6).
 * @param {{ kind: string, name: string | null, date: string | null, churchId?: string | null, mine?: string | null }} notice  워커의 LocalNotice
 * @param {(name: string) => string} nameOf  본당 표의 이름을 설정 목록의 이름으로
 * @returns {{ text: string, pick: { churchId: string, name: string } | null, list: boolean }}
 */
function localNoticeOf(notice, nameOf) {
  const date = notice.date ? fixedDateText(notice.date) : "";
  if (notice.kind === "blessing") return { text: `${notice.name}의 축복일(${date})에는 따로 읽는 독서가 없습니다.`, pick: null, list: false };
  if (notice.kind === "consecration") {
    if (notice.mine) {
      const same = notice.mine === "consecration" ? " 축성 독서는 소속교회의 축성일과 같습니다." : "";
      return { text: `${notice.name}의 축성일은 ${date}입니다.${same}`, pick: null, list: false };
    }
    return { text: `${notice.name}의 축성일(${date})은 소속교회로 등록하면 축성 독서와 함께 볼 수 있습니다.`,
      pick: notice.churchId && notice.name ? { churchId: notice.churchId, name: nameOf(notice.name) } : null, list: false };
  }
  return { text: "소속교회의 축성일은 소속교회를 등록하면 축성 독서와 함께 볼 수 있습니다.", pick: null, list: true };
}

/** 카드 안 교회 목록의 선택 상자 id. 한 화면에 카드는 하나다. */
const LOCAL_PICK_SELECT_ID = "search-local-church";

/**
 * 지역 축일 안내 카드(없는 장의 알림 카드와 같은 모양). 등록하는 단추와 교회 목록은 그리기만 하고, 동작은 화면이 단다(`wireLocalNotice`).
 * 교회 목록은 받는 동안 「불러오는 중」 하나뿐이고 고를 수 없다.
 * @param {{ text: string, pick: { churchId: string, name: string } | null, list: boolean }} notice
 * @returns {HTMLElement}
 */
function buildLocalNotice(notice) {
  const card = el("div", { className: "search-alert search-local-note" });
  card.appendChild(el("p", { className: "search-alert-title" }, notice.text));
  if (notice.pick) {
    const { churchId, name } = notice.pick;
    card.appendChild(el("button", { type: "button", className: "search-local-pick-btn", "data-church": churchId, "data-name": name },
      `${name}${hasBatchim(name) ? "을" : "를"} 소속교회로 선택`));
  } else if (notice.list) {
    const row = el("div", { className: "search-local-pick" });
    row.appendChild(el("label", { for: LOCAL_PICK_SELECT_ID }, "소속교회"));
    const wrap = el("span", { className: "settings-select-wrap" });
    const select = el("select", { className: "settings-select", id: LOCAL_PICK_SELECT_ID, disabled: "" });
    select.appendChild(el("option", { value: "" }, "불러오는 중"));
    wrap.appendChild(select);
    row.appendChild(wrap);
    card.appendChild(row);
    card.appendChild(el("button", { type: "button", className: "search-local-pick-btn", disabled: "" }, "소속교회로 선택"));
  }
  return card;
}

/**
 * 카드에서 소속교회를 등록한 뒤 다시 그린 결과 위의 한 줄. 이름은 설정의 교회 목록에 적는 이름이다(helpers.js `churchName`).
 * @param {string} name @returns {string}
 */
function pickedParishNote(name) {
  return `${name}${hasBatchim(name) ? "을" : "를"} 소속교회로 등록했습니다. 설정에서 바꿀 수 있습니다.`;
}

/** 음력 날짜로 지키는 전례일(설날, 추석)의 키. 음력 날짜 자료(`kasi-lunar.json`)가 없는 해에는 계산하지 못한다. */
const LECT_LUNAR_PREFIX = "lunar";

/**
 * 연도를 붙인 이름 검색의 줄(ADR-044 §4). `found`는 워커가 찾은 전례일이고, `perYear`는 해마다 그 전례일들의 날(엔진 `findYearDays`,
 * `found`와 같은 차례)과 그해의 음력 날짜 자료가 있는지다. 줄은 전례일마다, 해마다 하나이고 날짜 차례다. 해가 날짜의 앞자리라 해의
 * 차례로 묶이고, 같은 날이면 사계재의 줄을 아래에 두고(`lectEmberLast`) 그 밖에는 이름 결과의 차례를 지킨다(`Array.prototype.sort`는
 * 안정 정렬이다). 그해에 지키지 않는 전례일은 줄을
 * 두지 않는다. 성탄 평일을 그해의 이름으로만 찾았으면(`yearNames`) 그해의 이름이 맞는 날만 둔다. `notes`는 결과 위나 결과 없음 화면에
 * 적는 문장이다: 10년으로 자른 것, 음력 날짜 자료가 없는 해(「설날과 추석은 2025-2050년만 찾습니다.」, 사용자 결정 2026-11-18), 줄이 하나도
 * 없는 해(「2027, 2032년에는 검색하신 전례일을 지키지 않습니다.」).
 * @param {any[]} found  LectItem[]
 * @param {Array<{ year: number, days: Array<any | null>, lunar: boolean }>} perYear  YearDay | null. 찾을 해가 없으면 비었다
 * @param {{ from: number, to: number, capped: boolean }} years  워커의 LectYears
 * @param {{ from: number, to: number } | null} [lunarSpan]  음력 날짜 자료가 있는 해(엔진 `lunarYearSpan`)
 * @returns {{ items: any[], notes: string[] }}
 */
function yearRowsOf(found, perYear, years, lunarSpan = null) {
  // 찾은 전례일이 없으면 알릴 것도 없다. 결과 없음 화면은 「찾지 못했어요」다(코드 리뷰 2026-11-17)
  if (!found.length) return { items: [], notes: [] };
  /** @type {any[]} */
  const items = [];
  /** 줄이 하나도 없는 해 @type {number[]} */
  const empty = [];
  for (const { year, days } of perYear) {
    const before = items.length;
    found.forEach((item, i) => {
      const day = days[i];
      if (day && (!item.yearNames || item.yearNames.includes(day.name))) items.push({ ...item, yearDay: day });
    });
    if (items.length === before) empty.push(year);
  }
  items.sort((a, b) => (a.yearDay.date < b.yearDay.date ? -1 : a.yearDay.date > b.yearDay.date ? 1 : lectEmberLast(a.yearDay, b.yearDay)));
  /** @type {string[]} */
  const notes = [];
  /** 자른 것을 알리는 문장 @type {string[]} */
  const cut = [];
  if (years.capped) cut.push(`연도 범위는 ${years.to - years.from + 1}년까지 찾습니다.`);
  if (cut.length && perYear.length) cut.push(`${yearsText(perYear.map((x) => x.year))}의 날을 보입니다.`);
  if (cut.length) notes.push(cut.join(" "));
  const lunar = found.filter((item) => item.obs.key.startsWith(LECT_LUNAR_PREFIX));
  const lunarNames = [...new Set(lunar.map((item) => item.obs.name))];
  const noLunar = lunarNames.length ? perYear.filter((x) => !x.lunar).map((x) => x.year) : [];
  if (noLunar.length && lunarSpan) {
    // 어느 하나만 찾았어도 둘을 함께 알린다. 둘 다 같은 음력 자료로 계산하기 때문이다(사용자 결정 2026-11-18)
    notes.push(`설날과 추석은 ${lunarSpan.from}-${lunarSpan.to}년만 찾습니다.`);
  } else if (noLunar.length) {
    const names = lunarNames.reduce((acc, name) => (acc ? `${acc}${hasBatchim(acc) ? "과" : "와"} ${name}` : name), "");
    notes.push(`${yearsText(noLunar)}의 ${names} 날짜는 아직 앱에 없습니다.`);
  }
  // 음력으로 지키는 전례일만 찾았으면 음력 자료가 없는 해는 위에서 알렸다. 지키지 않는 것이 아니라 모르는 것이다
  const unkept = lunar.length === found.length ? empty.filter((y) => !noLunar.includes(y)) : empty;
  if (unkept.length) notes.push(`${yearsText(unkept)}에는 검색하신 전례일을 지키지 않습니다.`);
  return { items, notes };
}

/**
 * 찾은 단계: 이름 결과는 이름이 검색어와 같은 것, 시작하는 것, 든 것(`tier`, 지역 축일도 있다)이고, 구절 결과는 검색어의 구절을 모두 담은
 * 독서, 그다음 겹친 절이 많은 독서다. 워커가 이 차례로 보낸다(search-worker.js `searchLectionaryNames`, `searchLectionaryPassage`의 `better`).
 * @param {any} a  LectItem @param {any} b  LectItem @returns {number}
 */
function lectStepOrder(a, b) {
  if (a.hits?.length && b.hits?.length) {
    const [x, y] = [a.hits[0], b.hits[0]];
    return Number(y.full) - Number(x.full) || y.overlap - x.overlap;
  }
  return (a.tier ?? 3) - (b.tier ?? 3);
}

/**
 * 전례일 줄의 차례(ADR-044 §1, 사용자 결정 2026-11-23): 찾은 단계 안에서 줄이 여는 날의 날짜 차례다. 그래야 같은 날 읽을 수 있는 줄이
 * 이웃한다(`대림`의 동계재 지향별 줄이 목록 끝이 아니라 같은 날의 대림 평일 곁에 온다). 날이 같으면 사계재의 줄을 아래에 두고
 * (`lectEmberLast`), 그 밖에는 워커가 보낸 전례년 순서다. 날짜를 계산하지 못한 줄(`days`에 없거나 null)은 그 단계의 끝에 그 순서로 둔다.
 * 연도를 붙인 검색의 줄은 이미 그해의 날짜 차례라(`yearRowsOf`) 그대로 둔다.
 * @param {any} lect  LectResult
 * @param {Map<any, LectDays | null> | null | undefined} days  줄마다 여는 날(`withLectDays`)
 * @returns {any[]}  LectItem[], 새 배열
 */
function lectItemsByDay(lect, days) {
  if (lect.years || !days) return lect.items.slice();
  return lect.items
    .map((/** @type {any} */ item, /** @type {number} */ i) => ({ item, i, day: days.get(item)?.open ?? null }))
    .sort((/** @type {any} */ a, /** @type {any} */ b) => lectStepOrder(a.item, b.item)
      || (a.day === b.day ? 0 : a.day === null ? 1 : b.day === null ? -1 : a.day.date < b.day.date ? -1 : a.day.date > b.day.date ? 1
        : lectEmberLast(a.day, b.day))
      || a.i - b.i)
    .map((/** @type {any} */ x) => x.item);
}

/**
 * 같은 날의 두 줄: 사계재의 줄을 아래에 둔다(사용자 결정 2026-11-23, ADR-044 §1). 전례독서 화면이 그날의 평일을 제목으로 두고 사계재를 목록의
 * 줄로 두는 것과 같다. 사계재인지는 엔진이 규칙 종류로 판별해 넘긴다(`KeptDay`, `YearDay`의 `ember`). 색인의 전례년 순서로는 춘계재와 하계재가
 * 평일 위에, 동계재와 추계재가 평일 아래에 왔다.
 * @param {{ ember?: boolean }} a @param {{ ember?: boolean }} b @returns {number}
 */
function lectEmberLast(a, b) {
  return Number(!!a.ember) - Number(!!b.ember);
}

/**
 * 「2027-03-07」을 「2027년 3월 7일 (일)」로. `full`이면 요일을 「일요일」로 쓴다(스크린 리더가 읽는 링크 이름).
 * @param {string} date @param {boolean} [full]
 */
function lectDateText(date, full = false) {
  const [y, m, d] = date.split("-").map(Number);
  const wd = LECT_WEEKDAY[lectWeekdayOf(date)];
  return `${y}년 ${m}월 ${d}일 ${full ? `${wd}요일` : `(${wd})`}`;
}

/** 그날의 요일 번호(0이 일요일). @param {string} date "YYYY-MM-DD" */
function lectWeekdayOf(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * 줄에 적는 날짜(ADR-044 §1): 지난날은 날짜만(「2026년 3월 1일 (일)」), 앞날은 「다음 2027년 3월 7일 (일)」, 오늘은 「오늘」이다.
 * 지난날에 붙이던 「지난」은 2026-11-19에 뗐다(사용자 결정, 화면에서 어색했다).
 * 「올해」라고 적지 않는다. 이번 전례년은 대림 무렵에 달력의 해와 어긋난다.
 * @param {string} date @param {string} today @param {boolean} [full]
 */
function lectDayText(date, today, full = false) {
  if (date === today) return "오늘";
  return date < today ? lectDateText(date, full) : `다음 ${lectDateText(date, full)}`;
}

/**
 * 찾은 독서의 주기와 트랙: 「가해, 나해」, 「가해, 연속 독서와 복음 주제」(ADR-038 §3-1).
 * @param {Array<{ year: string | null, track: number | null }>} sets
 */
function lectCyclesText(sets) {
  const years = [...new Set(sets.map((s) => s.year).filter((y) => y && LECT_CYCLE_LABEL[y]))]
    .map((y) => LECT_CYCLE_LABEL[/** @type {string} */ (y)]);
  const tracks = [...new Set(sets.map((s) => s.track).filter((t) => t && LECT_TRACK_LABEL[t]))].sort()
    .map((t) => LECT_TRACK_LABEL[/** @type {number} */ (t)]);
  return [years.join(", "), tracks.join("와 ")].filter(Boolean).join(", ");
}

/**
 * 줄의 보조 주소가 가리키는 것(ADR-044 §1). 구절로 찾았으면 찾은 독서가 든 세트들, 이름으로 찾았으면 그 전례일의 세트들이다.
 * 고유 독서가 없는 전례일만 전례일 키를 적는다. 엔진은 평일과 사계재를 색인과 다른 식별자로 내서 전례일 키로는 그날을
 * 찾지 못하고, 세트가 없는 전례일은 모두 엔진이 같은 식별자로 내는 표의 전례일이다(search-worker.data.test.js).
 * @param {any} item  LectItem (search-worker.js)
 * @returns {string[]}
 */
function lectSlugIds(item) {
  const sets = lectSetsOf(item);
  return sets.length ? [...new Set(sets.map((s) => String(s.id)))] : [item.obs.key];
}

/**
 * 줄이 가리키는 독서 세트: 구절로 찾았으면 찾은 독서가 든 세트들, 이름으로 찾았으면 그 전례일의 세트들이다.
 * @param {any} item  LectItem
 * @returns {Array<{ id: string, year: string | null }>}
 */
function lectSetsOf(item) {
  return item.hits ? item.hits.flatMap((/** @type {any} */ h) => h.sets) : item.sets;
}

/**
 * 해에 따라 다른 독서를 읽는 줄인가(ADR-044 §1). 줄의 세트에 해(가해, 홀수해 등)가 있으면 그렇다. 다만 구절로 찾은 줄은 찾은 독서가
 * 그 전례일의 모든 해의 세트에 있으면 해마다 같은 독서다(평일 복음은 홀수해와 짝수해에 같은 경우가 많다, 사용자 결정 2026-11-17).
 * @param {any} item
 */
function lectCyclic(item) {
  const yearsOf = (/** @type {Array<{ year: string | null }>} */ sets) => new Set(sets.map((x) => x.year).filter(Boolean));
  const found = yearsOf(lectSetsOf(item));
  if (!found.size) return false;
  return !item.hits || [...yearsOf(item.sets || [])].some((y) => !found.has(y));
}

/**
 * 그날 읽는 독서 세트의 해(`A`, `I` 등). 줄의 세트에 없거나 해가 없으면 빈 문자열.
 * @param {any} item @param {KeptDay} day
 */
function lectYearOf(item, day) {
  const set = lectSetsOf(item).find((s) => String(s.id) === day.setId);
  return set && set.year ? String(set.year) : "";
}

/**
 * 보조 주소. `from`이 있으면 그날부터 처음 지키는 날을 연다(다른 날로 가는 링크).
 * @param {string[]} ids @param {string | null} [from]
 */
function lectHrefOf(ids, from = null) {
  return `/lectionary/d/${ids.map(encodeURIComponent).join(",")}${from ? `?from=${from}` : ""}`;
}

/** 줄을 누르면 가는 보조 주소. @param {any} item  LectItem */
function lectSlugHref(item) {
  return lectHrefOf(lectSlugIds(item));
}

/**
 * 전례일 줄 하나의 글(그리기 전의 모양). `labelOf`는 독서 데이터의 표기(「요한 3:14-21」)를 돌려주고, 모르면 null이다. `days`는 줄이
 * 여는 날이고, 아직 모르면 null이다.
 * @param {any} item  LectItem
 * @param {(setId: string, slot: string) => string | null} labelOf
 * @param {LectDays | null} [days]
 * @param {string} [today]  "YYYY-MM-DD"
 * @returns {{ title: string, href: string, bold: boolean, found: { slot: string, text: string } | null,
 *   colors: Array<{ code: string, name: string }>, meta: string[], lines: string[], label: string,
 *   nexts: LectNext[] }}
 */
function lectRowOf(item, labelOf, days = null, today = "") {
  const { obs } = item;
  // 주일은 등급이 비어 있어 이름으로 안다. 이동 축일의 이름만 본다(월별 축일에는 「주일」로 끝나는 이름이 없다)
  const bold = LECT_BOLD_RANKS.has(obs.rank) || (obs.kind === "temporal" && /주일$/.test(obs.name));
  // 연도를 붙여 찾은 줄은 그해의 날을 연다(ADR-044 §4, `yearRowsOf`)
  const yearDay = item.yearDay || null;
  /** @type {KeptDay | null} */
  const open = yearDay || (days ? days.open : null);
  const title = open && open.obs.startsWith(LECT_CHRISTMAS_WEEKDAY) ? open.name : obs.name;
  /** @type {{ slot: string, text: string } | null} */
  let found = null;
  /** @type {string[]} */
  const meta = [];
  /** @type {string[]} */
  const lines = [];
  if (item.hits && item.hits.length) {
    const hit = item.hits[0];
    const text = labelOf(hit.sets[0].id, LECT_SLOT_KEY[hit.slot]) || lectNotation(hit.rows);
    found = { slot: LECT_SLOT_LABEL[hit.slot], text };
    const cycles = lectCyclesText(hit.sets);
    if (cycles) meta.push(cycles);
  } else if (!item.sets.length && !item.local && LECT_RANK_LABEL[obs.rank]) {
    // 고유 독서가 없으면 등급을 적는다. 공통 독서만 있는 성인도 그렇다. 전례독서 화면이 공통 독서만 있는 후보를 아직 보이지
    // 않아(ADR-038 §3), 누르면 그날의 평일 독서와 성인의 이름 줄이 열리기 때문이다(사용자 결정 2026-11-16, ADR-044 §1).
    lines.push(LECT_RANK_LABEL[obs.rank]);
  }
  // 색 점은 줄을 누르면 열리는 화면의 머리 색이다(ADR-044 §1)
  const colors = open ? open.colors.map((code) => ({ code, name: LECT_COLOR_LABEL[code] || code })) : [];
  /** 링크 이름에 싣는 meta. 날짜는 요일을 다 쓴다 @type {string[]} */
  const said = [...meta];
  // 이름으로 찾은 줄이 해에 따라 다른 독서를 읽으면 열리는 날의 해를 날짜 앞에 적는다. 링크마다 해를 적으므로 줄에도 있어야 견주어 본다.
  // 연도를 붙여 찾은 줄은 그해에 읽는 독서의 해다
  const cyclic = lectCyclic(item);
  const cycle = yearDay ? (cyclic ? lectYearOf(item, yearDay) : "") : days && days.year ? days.year : "";
  const year = cycle ? LECT_CYCLE_LABEL[cycle] || "" : "";
  if (year) {
    meta.push(year);
    said.push(year);
  }
  // 설립일 줄에는 설립 연도를 적는다(ADR-044 §3)
  if (item.local && item.local.level !== "dedication" && item.local.year) {
    meta.push(`${item.local.year}년 설립`);
    said.push(`${item.local.year}년 설립`);
  }
  if (open) {
    meta.push(lectDayText(open.date, today));
    said.push(lectDayText(open.date, today, true));
  } else {
    const date = fixedDateText(obs.date);
    if (date) {
      meta.push(date);
      said.push(date);
    }
  }
  // 연도를 붙여 찾은 줄은 그해의 사정을 적는다: 다른 날에서 옮겨 온 날, 다른 전례일과 겹쳐 기념만 하는 날(ADR-044 §4)
  if (yearDay && yearDay.kind === "moved" && yearDay.from) lines.push(`${monthDayText(yearDay.from)}에서 옮겨 옴`);
  if (yearDay && yearDay.kind === "overlap") {
    const by = yearDay.by ? overlapName(yearDay.by, !!yearDay.bySaint) : "";
    lines.push(by ? `${by}${hasBatchim(by) ? "과" : "와"} 겹침` : "다른 전례일과 겹침");
  }
  // 다른 날로 가는 링크: 해에 따라 다른 독서(가해, 나해, 다해, 홀수해, 짝수해)를 읽는 줄만 둔다. 이름으로 찾은 줄은 다른 해의 날을
  // 해마다 하나씩(세 해 주기는 둘), 구절로 찾은 줄은 지났을 때 다음에 읽는 날 하나다. 해마다 같은 독서는 다음 해에 가도 같은 내용이라
  // 링크 없이 다음 전례년의 날만 글로 적는다(ADR-044 §1)
  /** @type {LectNext[]} */
  const nexts = [];
  if (days && days.cycles.length) {
    for (const day of days.cycles) {
      const cycle = LECT_CYCLE_LABEL[lectYearOf(item, day)] || "다음";
      nexts.push({
        href: lectHrefOf(days.nextIds, day.date),
        label: `${title}, ${cycle} ${lectDateText(day.date, true)}`,
        prefix: cycle,
        date: lectDateText(day.date),
      });
    }
  } else if (days && days.next && cyclic) {
    const later = days.next;
    nexts.push({
      href: lectHrefOf(days.nextIds, later.date),
      label: `${title}, ${lectDayText(later.date, today, true)}`,
      prefix: later.date > today ? "다음" : "",
      date: later.date > today ? lectDateText(later.date) : lectDayText(later.date, today),
    });
  }
  const saidLines = [...lines];
  if (days && days.nextYear) {
    const { date } = days.nextYear;
    lines.push(date ? `다음 전례년 ${lectDateText(date)}` : "다음 전례년에는 지키지 않음");
    saidLines.push(date ? `다음 전례년 ${lectDateText(date, true)}` : "다음 전례년에는 지키지 않음");
  }
  const label = [title, found ? `${found.slot} ${found.text}` : null, ...colors.map((c) => c.name), ...said, ...saidLines]
    .filter(Boolean).join(", ");
  // 연도를 붙여 찾은 줄: 지키는 날은 그날부터 처음 지키는 날(곧 그날)을 고른 화면, 겹친 날은 그날의 기본 화면이다. 지역 축일은 날짜를
  // 계산하기 전이면 다음 그날이다(엔진 없이 셀 수 있다)
  const href = item.local ? localHref(item, open ? open.date : nextMonthDay(obs.date, today))
    : yearDay ? (yearDay.kind === "overlap" ? `/lectionary/${yearDay.date}` : lectHrefOf(lectSlugIds(item), yearDay.date))
    : lectSlugHref(item);
  return { title, href, bold, found, colors, meta, lines, label, nexts };
}

/**
 * 독서 데이터를 받지 못했을 때 색인의 숫자로 만든 표기. 같은 장은 쉼표로 잇는다(「요한 3:14-21」).
 * @param {Array<[string, number, number, number]>} rows
 */
function lectNotation(rows) {
  const real = rows.filter(([book]) => book !== "cant");
  if (!real.length) return "";
  /** @type {string[]} */
  const parts = [];
  /** @type {number | null} */
  let lastChapter = null;
  for (const [, chapter, a, b] of real) {
    const verses = a === b ? `${a}` : `${a}-${b}`;
    parts.push(chapter === lastChapter ? verses : `${chapter}:${verses}`);
    lastChapter = chapter;
  }
  return `${bookName(real[0][0] === "lps" ? "ps" : real[0][0])} ${parts.join(", ")}`;
}

/** @param {ReturnType<typeof lectRowOf>} row */
function buildLectRow(row) {
  const li = el("li", {});
  fillLectRow(li, row);
  return li;
}

/**
 * 줄 하나를 그리거나, 날짜를 나중에 넣을 때 다시 그린다(ADR-044 §1). 이미 있는 링크는 그대로 두고 안의 글만 바꾸므로, 그 링크에 있던
 * 키보드 포커스가 남는다(WCAG 2.4.3). 지난날을 여는 줄은 아래에 다음에 읽는 날의 링크를 따로 둔다. 이 줄만 링크가 둘이다.
 * @param {HTMLElement} li
 * @param {ReturnType<typeof lectRowOf>} row
 */
function fillLectRow(li, row) {
  let a = /** @type {HTMLElement | undefined} */ (li.children[0]);
  if (!a) {
    a = el("a", {});
    li.appendChild(a);
  }
  while (a.firstChild) a.removeChild(a.firstChild);
  a.className = row.bold ? "cal-row cal-row--major" : "cal-row";
  a.setAttribute("href", row.href);
  a.setAttribute("aria-label", row.label);
  const body = el("span", { className: "cal-row-body" });
  body.appendChild(el("span", { className: "cal-row-title" }, row.title));
  if (row.found) {
    const line = el("span", { className: "cal-row-line lect-row-found" });
    line.appendChild(el("span", { className: "lect-row-slot" }, row.found.slot));
    line.appendChild(document.createTextNode(row.found.text));
    body.appendChild(line);
  }
  if (row.colors.length || row.meta.length) {
    const meta = el("span", { className: "cal-row-meta" });
    for (const color of row.colors) {
      const item = el("span", { className: "cal-row-color" });
      item.appendChild(el("span", { className: `cal-row-dot lit-swatch lit-swatch--${color.code}`, "aria-hidden": "true" }));
      item.appendChild(document.createTextNode(color.name));
      meta.appendChild(item);
    }
    for (const text of row.meta) meta.appendChild(el("span", {}, text));
    body.appendChild(meta);
  }
  for (const text of row.lines) body.appendChild(el("span", { className: "cal-row-line" }, text));
  a.appendChild(body);

  // 링크는 한 줄에 하나다(ADR-044 §1). 날짜를 나중에 넣을 때도 있던 링크를 그대로 쓰고 글만 바꿔, 링크에 있던 초점을 지킨다
  while (li.children.length > row.nexts.length + 1) li.removeChild(li.children[li.children.length - 1]);
  row.nexts.forEach((link, i) => {
    let next = /** @type {HTMLElement | undefined} */ (li.children[i + 1]);
    if (!next) {
      next = el("a", { className: "lect-row-next" });
      li.appendChild(next);
    }
    while (next.firstChild) next.removeChild(next.firstChild);
    next.setAttribute("href", link.href);
    next.setAttribute("aria-label", link.label);
    const text = el("span", {});
    if (link.prefix) text.appendChild(document.createTextNode(`${link.prefix} `));
    text.appendChild(el("span", { className: "lect-row-next-date" }, link.date));
    next.appendChild(text);
    next.appendChild(el("span", { className: "lect-row-next-arrow", "aria-hidden": "true" }, "›"));
  });
  li.className = row.nexts.length ? "lect-row-pair" : "";
}

/** @typedef {"bible" | "psalter" | "lectionary"} SearchGroup */

/** 결과 묶음의 차례와 알약의 이름(ADR-044 §1, ADR-046 §3). 본문을 찾는 묶음 둘 다음에 날을 찾는 묶음이다. */
const SEARCH_GROUPS = /** @type {const} */ ([["bible", "성서 본문"], ["psalter", "성시"], ["lectionary", "전례일"]]);
/** 책을 고르지 않은 검색이 찾는 묶음(「성서 본문, 성시, 전례일」). 결과 없음과 책 이름만 친 검색의 안내에 쓴다(사용자 결정 2026-11-19). */
const SEARCHED_GROUPS = SEARCH_GROUPS.map(([, name]) => name).join(", ");

/**
 * A pill's name and its result count (「루가 23」), the count read as 「23건」. Shared by the result-group pills and the
 * book pills (ADR-049 §2).
 * @param {HTMLElement} node @param {string} label @param {number} count
 * @returns {HTMLElement} node
 */
function appendPillLabel(node, label, count) {
  node.appendChild(document.createTextNode(`${label} `));
  node.appendChild(el("span", { className: "search-pill-count" }, String(count)));
  node.appendChild(el("span", { className: "sr-only" }, "건"));
  return node;
}

/**
 * 결과 묶음의 알약(「성서 본문」, 「성시」, 「전례일」, ADR-044 §1, ADR-046 §3). 결과가 있는 묶음만 `counts`에 둔다. 고른
 * 알약에 `aria-current`를 달고, 누른 뒤 다시 그려도 포커스가 그 알약에 남는다(`data-focus-key`, routing.js).
 * @param {SearchGroup} group
 * @param {Partial<Record<SearchGroup, number>>} counts
 * @param {(g: SearchGroup) => string} hrefOf
 */
function buildSearchPills(group, counts, hrefOf) {
  const nav = el("nav", { "aria-label": "검색 결과 묶음" });
  const list = el("ul", { className: "search-pills", role: "list" });
  for (const [g, name] of SEARCH_GROUPS) {
    const count = counts[g];
    if (count === undefined) continue;
    const a = el("a", { className: "search-pill", href: hrefOf(g), "data-focus-key": `group:${g}` });
    if (g === group) a.setAttribute("aria-current", "true");
    appendPillLabel(a, name, count);
    const li = el("li", {});
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);
  return nav;
}

/**
 * 고른 책의 알약 줄(ADR-049). 검색창 바로 아래에 둔다. 결과 수(`counts`, 워커의 `books`)를 알면 알약마다 수를 적고 그 책의
 * 결과로 가는 링크로 둔다. 두 권 이상이면 맨 앞에 「전체」를 둔다(§2). 결과가 없는 책은 흐린 글이다(§4). 수를 모르면 이름만
 * 적는다(§5). 알약마다 ×(그 책 빼기, §3)가 있고, 누르면 `onRemove`가 그 책 id를 받는다. 두 권 이상이면 마지막 알약 뒤에
 * 「모두 지우기」(`onClear`, §3)를 둔다. 한 권이면 그 알약의 ×가 같은 일을 한다. 링크는 누른 뒤 다시 그려도 포커스가 그 알약에
 * 남는다(`data-focus-key`, routing.js). 「모두 지우기」의 `data-focus-key`는 검색이 끝나 줄을 다시 그릴 때만 포커스를 지킨다
 * (`drawScopeRow`). 누르면 줄이 사라지고 포커스는 깔때기로 간다.
 * @param {Array<{ id: string, name: string }>} books  in pill order
 * @param {{ counts: Array<[string, number]> | null, shown: string | null, hrefOf: (id: string | null) => string,
 *   onRemove: (id: string, e: MouseEvent) => void, onClear: (e: MouseEvent) => void }} opts
 *   shown: the book pill shown, null for 「전체」
 * @returns {HTMLElement}
 */
function buildScopePills(books, opts) {
  const wrap = el("div", { className: "scope-pills", role: "group", "aria-label": "검색할 책" });
  const list = el("ul", { className: "scope-pill-list", role: "list" });
  const counts = opts.counts;
  const countById = new Map(counts || []);
  /** @param {string} id */
  const countOf = (id) => countById.get(id) ?? 0;
  /**
   * @param {string} label @param {number} count @param {string} href @param {string} key @param {boolean} current
   * @returns {HTMLElement}
   */
  const link = (label, count, href, key, current) => {
    const a = el("a", { className: "scope-pill-main", href, "data-focus-key": key });
    if (current) a.setAttribute("aria-current", "true");
    return appendPillLabel(a, label, count);
  };
  if (counts && books.length > 1) {
    const all = el("li", { className: "scope-pill scope-pill-all" });
    const total = books.reduce((sum, b) => sum + countOf(b.id), 0);
    if (opts.shown === null) all.classList.add("scope-pill-current");
    all.appendChild(link("전체", total, opts.hrefOf(null), "book:all", opts.shown === null));
    list.appendChild(all);
  }
  for (const b of books) {
    const li = el("li", { className: "scope-pill" });
    if (!counts) {
      li.appendChild(el("span", { className: "scope-pill-main" }, b.name));
    } else if (countOf(b.id) === 0) {
      // 결과가 없는 책: 흐리게 두고 누를 수 없다(§4)
      li.classList.add("scope-pill-empty");
      li.appendChild(appendPillLabel(el("span", { className: "scope-pill-main" }), b.name, 0));
    } else {
      // 한 권이면 「전체」와 같은 목록이라 그 주소로 가고 늘 고른 알약이다(§2)
      const one = books.length === 1;
      const current = one || opts.shown === b.id;
      if (current) li.classList.add("scope-pill-current");
      li.appendChild(link(b.name, countOf(b.id), opts.hrefOf(one ? null : b.id), `book:${b.id}`, current));
    }
    const x = el("button", {
      type: "button", className: "scope-pill-remove", "aria-label": `검색할 책에서 ${b.name} 빼기`, "data-remove-book": b.id,
    });
    x.appendChild(el("span", { "aria-hidden": "true" }, "×"));
    x.addEventListener("click", (e) => opts.onRemove(b.id, /** @type {MouseEvent} */ (e)));
    li.appendChild(x);
    list.appendChild(li);
  }
  if (books.length > 1) {
    // 알약이 아니라 글자 단추다. 알약 모양이면 결과를 거르는 단추로 읽힌다(§3). 스크린 리더의 이름은 보이는 글자를 담는다(WCAG 2.5.3).
    const clear = el("button", {
      type: "button", className: "scope-clear-btn", "aria-label": "고른 책 모두 지우기", "data-focus-key": "book:clear",
    }, "모두 지우기");
    clear.addEventListener("click", (e) => opts.onClear(/** @type {MouseEvent} */ (e)));
    const li = el("li", { className: "scope-clear" });
    li.appendChild(clear);
    list.appendChild(li);
  }
  wrap.appendChild(list);
  return wrap;
}

// Absolute date label for a recent-search entry (ADR-014 개정 / ADR-033). One
// consistent absolute format ("YYYY. M. D.") — no relative "n일 전". Returns ""
// for entries with no timestamp (migrated from the legacy string[] format) or
// an unparseable ts, so the caller can omit the date.
/** @param {number | null | undefined} ts @returns {string} */
function formatSearchDate(ts) {
  if (ts == null) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/**
 * The page links redraw this view, so each carries `data-focus-key`: the router
 * puts focus back on the pressed link of the new page (routing.js — WCAG 2.4.3;
 * user decision 2026-10-17: the pressed link, not the top of the results). On
 * the first / last page that link is gone and the other one takes over
 * (`data-focus-fallback`).
 * The links stay in the group shown (`group`, ADR-046 §3) and the book pill shown (`book`, ADR-049 §2): its pages,
 * not the other's.
 * @param {{ q?: string, filterBooks?: string[], group?: string | null, book?: string | null }} state
 * @param {number} currentPage
 * @param {number} totalPages
 */
function buildSearchPagination(state, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  /** @param {number} p */
  const pageUrl = (p) => buildSearchUrl({
    q: state.q, page: p, filterBooks: state.filterBooks, group: state.group, book: state.book,
  });

  if (currentPage > 1) {
    nav.appendChild(el("a", {
      href: pageUrl(currentPage - 1), "data-focus-key": "page:prev", "data-focus-fallback": "page:next",
    }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", {
      href: pageUrl(currentPage + 1), "data-focus-key": "page:next", "data-focus-fallback": "page:prev",
    }, "다음 →"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}

/**
 * 성서 색인을 받는 동안 라이브 영역이 읽는 문장(사용자 결정 2026-11-19). 묶음마다 결과 수를 알약의 이름과 차례로 읽는다.
 * 성시는 결과가 있을 때만 읽는다. 그전에는 성서 본문의 수만 읽어, 성시에만 결과가 있으면 「현재 0건」이었다.
 * 책을 고른 검색은 고른 책을 한 목록에 세므로(ADR-049 §2) 묶음 이름 없이 「현재 12건」이다.
 * @param {string} query
 * @param {{ total: number, psalter?: { total: number } | null, books?: unknown }} partial
 * @returns {string}
 */
function partialAnnouncement(query, partial) {
  if (Array.isArray(partial.books)) return `"${query}" 검색 중… 현재 ${partial.total}건`;
  const psalter = partial.psalter && partial.psalter.total > 0 ? `, 성시 ${partial.psalter.total}건` : "";
  return `"${query}" 검색 중… 현재 성서 본문 ${partial.total}건${psalter}`;
}
// ── END PURE HELPERS ──

// Render search result list into a container node (used by both page and sheet views)
/**
 * What the results screen needs beyond the worker's result (ADR-044 §1).
 * @typedef SearchScreen
 * @property {SearchGroup} group  the chosen pill
 * @property {(g: SearchGroup) => string} groupHref
 * @property {(bookId: string) => number | null} chapterCount  from books.json; null when unknown
 * @property {(setId: string, slot: string) => string | null} readingLabel  the reading's notation in eucharist-readings.json
 * @property {boolean} scoped  a book scope is set: no lectionary days, so no lectionary example either
 * @property {Map<any, LectDays | null> | null} days  the day each lectionary row opens, once the engine computed it
 * @property {string} today  "YYYY-MM-DD", the day `days` counts from
 * @property {string | null} [picked]  the parish just chosen in the local-day card (its listed name), told above the results
 */

/** @type {SearchScreen} */
const PLAIN_SCREEN = {
  group: "bible", groupHref: () => "", chapterCount: () => null, readingLabel: () => null, scoped: false, days: null, today: "",
};

/**
 * The answer card at the top (ADR-044 §1, §2): a verse reference card per chapter, the no-chapter notice in place of a
 * chapter the book does not have, or the first-chapter card of a book name typed alone.
 * @param {any} result
 * @param {SearchScreen} screen
 * @returns {{ node: HTMLElement | null, text: string | null, missing: number, firstChapter: string | null }}
 */
function buildAnswer(result, screen) {
  if (result.refMatch) {
    const ref = result.refMatch;
    const unit = chUnit(ref.bookId);
    const count = screen.chapterCount(ref.bookId);
    const targets = verseRefTargets(ref);
    const wrap = el("div", { className: "search-answer" });
    const list = el("ul", { className: "search-results", role: "list" });
    // In the order typed, on screen and in the status message alike
    /** @type {string[]} */
    const said = [];
    let missing = 0;
    for (const [i, { chapter, path, verses }] of targets.entries()) {
      // 송가는 장 번호 대신 송가 이름이다(「즈가리야 송가 1-3절」, ADR-046 §4)
      const title = ref.parts[i].title;
      let label = title || `${ref.bookNameKo} ${chapter}${unit}`;
      if (verses) label += ` ${verses}`;
      if (count !== null && chapter > count) {
        // 장 화면이 없는 장에서 보이는 문장과 같다(views.js, 송가는 「…14번 송가가 없습니다」, ADR-047 §3). 다른 장이나 절로 가는
        // 링크는 두지 않는다(ADR-044 §2).
        const message = missingChapterText(ref.bookId, ref.bookNameKo, chapter);
        const li = el("li", { className: "search-alert-item" });
        const alert = el("div", { className: "search-alert" });
        alert.appendChild(el("p", { className: "search-alert-title" }, `${message}.`));
        li.appendChild(alert);
        list.appendChild(li);
        said.push(message);
        missing++;
        continue;
      }
      const li = el("li", { className: "search-result-item ref-match-item" });
      const link = el("a", { href: path, className: "search-result-ref-card" });
      link.appendChild(el("span", { className: "search-result-ref-label" }, "구절 바로가기"));
      link.appendChild(el("span", { className: "search-result-ref-title" }, label));
      li.appendChild(link);
      list.appendChild(li);
      said.push(`${label} 바로가기`);
    }
    wrap.appendChild(list);
    // Every chapter there: the card count, as before this screen told lectionary days
    return { node: wrap, text: missing ? said.join(", ") : `구절 바로가기 ${targets.length}개`, missing, firstChapter: null };
  }
  if (result.bookOnly) {
    const { bookId, bookNameKo } = result.bookOnly;
    // 송가는 첫 송가의 이름이다(「모세송가」, ADR-046 §4)
    const title = result.bookOnly.title || `${bookNameKo} 1${chUnit(bookId)}`;
    const wrap = el("div", { className: "search-answer" });
    const list = el("ul", { className: "search-results", role: "list" });
    const li = el("li", { className: "search-result-item ref-match-item" });
    const link = el("a", { href: `/${bookId}/1`, className: "search-result-ref-card" });
    link.appendChild(el("span", { className: "search-result-ref-label" }, "책 바로가기"));
    link.appendChild(el("span", { className: "search-result-ref-title" }, title));
    li.appendChild(link);
    list.appendChild(li);
    wrap.appendChild(list);
    return { node: wrap, text: `${title} 바로가기`, missing: 0, firstChapter: title };
  }
  return { node: null, text: null, missing: 0, firstChapter: null };
}

/**
 * The lectionary result to show: none when a book scope hides it (the worker leaves it null) or it found nothing.
 * @param {any} result
 * @returns {any}
 */
function shownLectionary(result) {
  const lect = result.lectionary;
  // 연도를 붙인 검색은 그해의 날을 계산한 뒤에 줄이 정해진다(`withYearRows`)
  if (lect && lect.years && !lect.yearRows) return null;
  return lect && lect.items && lect.items.length ? lect : null;
}

/** 전례일 묶음이나 결과 없음 화면에 적는 문장(연도를 붙인 검색, `yearRowsOf`). @param {any} result @returns {string[]} */
function lectNotes(result) {
  return (result.lectionary && result.lectionary.notes) || [];
}

/** 전례일 묶음의 이름: 구절로 찾았으면 「이 구절을 읽는 날」(ADR-044 §1). @param {any} lect */
function lectGroupName(lect) {
  return lect.kind === "passage" ? "이 구절을 읽는 날" : "전례일";
}

/**
 * 전례일 묶음: 제목, 비슷한 말의 안내, 줄 목록.
 * @param {HTMLElement} container
 * @param {any} lect
 * @param {SearchScreen} screen
 */
function appendLectGroup(container, lect, screen) {
  // A heading, so a screen-reader user reaches the results in one move (design §9, WCAG H42).
  container.appendChild(el("h2", { className: "search-count" }, `${lectGroupName(lect)} ${lect.items.length}건`));
  if (lect.kind === "name" && lect.synonyms && lect.synonyms.length) {
    container.appendChild(el("p", { className: "search-note" }, synonymNote(lect.synonyms)));
  }
  for (const note of lect.notes || []) container.appendChild(el("p", { className: "search-note" }, note));
  // 날짜를 계산했으면 날짜 차례로 그린다. 아직이면 워커의 차례 그대로이고, 날짜가 오면 `patchLectDays`가 다시 늘어놓는다. 그린 줄과
  // `lect.items`의 차례가 같아야 `patchLectDays`가 줄마다 제 날짜를 넣는다
  lect.items = lectItemsByDay(lect, screen.days);
  const rows = el("ul", { className: "lect-rows", role: "list" });
  // 3초가 지나 날짜가 오면 그린 뒤 사용자가 화면을 건드렸는지 본다(`patchLectDays`)
  watchUserInput();
  _lectDrawnAt.set(rows, performance.now());
  for (const item of lect.items) rows.appendChild(buildLectRow(lectRowOf(item, screen.readingLabel, screen.days?.get(item) ?? null, screen.today)));
  container.appendChild(rows);
}

/**
 * 결과 화면에 무엇을 그리는가(ADR-044 §1, ADR-046 §3). `lect`는 그릴 수 있는 전례일 결과, `psalter`는 성시의 결과이고,
 * `groups`는 결과가 있는 묶음을 알약의 차례로 둔 것이고, `counts`는 그 묶음마다 알약에 적는 결과 수다. `group`은 목록으로
 * 보이는 묶음으로, 고른 알약의 묶음에 결과가 없으면 결과가 있는 첫 묶음이다.
 * @param {any} result
 * @param {SearchScreen} screen
 * @returns {{ isPending: boolean, lect: any, psalter: { results: any[], total: number } | null, hasBible: boolean,
 *   groups: SearchGroup[], counts: Partial<Record<SearchGroup, number>>, group: SearchGroup }}
 */
function resultGroups(result, screen) {
  const isPending = !!(result.pendingChunks && result.pendingChunks.length > 0);
  // While the bible chunks load with nothing found yet, the other groups wait for the whole result: bible results
  // still to come would take the screen back to 성서 본문, the first pill (ADR-044 §1). 「검색 중…」 shows meanwhile.
  const held = isPending && result.total === 0;
  const lect = held ? null : shownLectionary(result);
  const psalter = held ? null : shownPsalter(result);
  // By the whole count, not this page: a page past the end (a link made on a taller screen) still has results.
  const hasBible = result.total > 0 || isPending;
  /** @type {SearchGroup[]} */
  const groups = [];
  if (hasBible) groups.push("bible");
  if (psalter) groups.push("psalter");
  if (lect) groups.push("lectionary");
  const counts = { bible: hasBible ? result.total : undefined, psalter: psalter?.total, lectionary: lect?.items.length };
  const group = groups.includes(screen.group) ? screen.group : groups[0] || "bible";
  return { isPending, lect, psalter, hasBible, groups, counts, group };
}

/**
 * 성시(전례시편과 송가)의 결과(ADR-046 §3). 찾은 것이 없거나 옛 워커의 결과라 `psalter`가 없으면 null이다.
 * @param {any} result
 * @returns {{ results: any[], total: number } | null}
 */
function shownPsalter(result) {
  const psalter = result.psalter;
  return psalter && psalter.total > 0 ? psalter : null;
}

/**
 * 결과 줄의 위치(ADR-046 §4). 송가는 송가 이름과 절(「모세송가 1」)이고, 다른 책은 「전례시편 23:1」처럼 장과 절이다.
 * @param {{ bookNameKo: string, c: number, v: number, title?: string }} r
 */
function resultRefLabel(r) {
  return r.title ? `${r.title} ${r.v}` : `${r.bookNameKo} ${r.c}:${r.v}`;
}

/**
 * @param {HTMLElement} container
 * @param {any} result
 * @param {string} query
 * @param {number} page
 * @param {number} pageSize
 * @param {((q: string, p: number, t: number, group: SearchGroup, book: string | null) => HTMLElement) | null} paginationBuilder
 * @param {SearchScreen} [screen]
 * @returns {string}  the status message for the live region (design §9): the answer card, then the counts in screen order
 */
function renderSearchResultList(container, result, query, page, pageSize, paginationBuilder, screen = PLAIN_SCREEN) {
  clearNode(container);

  // The worker strips `in:<alias>` tokens; use the resulting keyword for
  // snippet highlighting and `?hl=` so users opening a result see their
  // search term highlighted (the raw query would never match the verse text).
  const highlightTerm = result.keyword || query;

  // A book name after `in:` the search does not know: the worker searched
  // nothing, so this is the zero-result screen with what to fix (ADR-005
  // 「검색 연산자 `in:`」). Unlike the other zero-result screens it keeps the
  // book-scope example, which shows how to write the scope.
  if (result.unmatchedScopes && result.unmatchedScopes.length > 0) {
    const note = unknownBookNote(result.unmatchedScopes);
    container.appendChild(buildSearchEmptyState("검색 결과가 없습니다", note));
    container.appendChild(buildSearchExamples(false, screen.scoped));
    return `"${query}" 검색 결과 0건. ${note}`;
  }
  // More books than one search takes (ADR-033 「책은 5권까지」): the worker searched none. The book pills stay under
  // the field so the user picks which to remove (ADR-049 §5). No examples: they search within the same books and would hit
  // this again.
  if (result.tooManyBooks) {
    container.appendChild(buildSearchEmptyState("검색 결과가 없습니다", SCOPE_LIMIT_NOTE));
    return `"${query}" 검색 결과 0건. ${SCOPE_LIMIT_NOTE}`;
  }

  const { isPending, lect, psalter, hasBible, groups, counts, group } = resultGroups(result, screen);
  const answer = buildAnswer(result, screen);
  // 책을 고른 검색: 고른 책마다의 수와 보이는 책 알약(ADR-049 §2). 워커가 세므로 입력 칸에 친 `in:`의 책도 든다
  /** @type {Array<[string, number]> | null} */
  const books = Array.isArray(result.books) ? result.books : null;
  const scoped = screen.scoped || !!books;

  // 연도를 붙여 찾았는데 줄이 없으면 그 사정(ADR-044 §4)
  const notes = lect ? [] : lectNotes(result);
  // 지역 축일을 찾지 못한 안내는 결과 위에 둔다(ADR-044 §3). 다른 결과가 없으면 이 안내만 보인다
  const notice = !screen.scoped && result.lectionary && result.lectionary.localNotice ? localNoticeOf(result.lectionary.localNotice, churchName) : null;
  // 카드에서 소속교회를 등록한 뒤 다시 찾았으면 등록한 것을 맨 위에 알린다
  const picked = screen.picked ? pickedParishNote(screen.picked) : null;
  if (picked) container.appendChild(el("p", { className: "search-note" }, picked));
  if (notice) container.appendChild(buildLocalNotice(notice));
  if (notice && !answer.node && !groups.length) return `"${query}" ${[picked, notice.text].filter(Boolean).join(" ")}`;
  if (!answer.node && !groups.length) {
    container.appendChild(
      // 책을 골라 두었으면 전례일은 찾지 않았다(ADR-044 §1). 고르지 않았으면 알약의 세 묶음을 모두 찾았다(사용자 결정 2026-11-19)
      buildSearchEmptyState("검색 결과가 없습니다", notes.length ? notes.join(" ")
        : `‘${query}’에 해당하는 ${scoped ? "구절을" : `${SEARCHED_GROUPS}을`} 찾지 못했어요.`)
    );
    container.appendChild(buildSearchExamples(true, scoped));
    return `"${query}" 검색 결과 0건${notes.length ? `. ${notes.join(" ")}` : ""}`;
  }

  // 알림은 앞의 문장(등록한 소속교회, 지역 축일 안내)을 그대로 잇고, 그 뒤에 답 카드와 결과 수를 쉼표로 잇는다
  const lead = [picked, notice ? notice.text : null].filter(Boolean).join(" ");
  /** @type {string[]} */
  const said = [];
  if (answer.node) {
    container.appendChild(answer.node);
    if (answer.text) said.push(answer.text);
  }
  // 책 이름만 쳤고 찾은 것이 없으면 Enter로 첫 장을 연다고 알린다(ADR-044 §2). Enter를 쳤으면 이미 그 장이 열렸다.
  if (answer.firstChapter && !groups.length) {
    const first = answer.firstChapter;
    container.appendChild(el("p", { className: "search-note" },
      `‘${query}’${hasBatchim(query) ? "이" : "가"} 들어간 ${SEARCHED_GROUPS}은 없습니다. 검색창에서 Enter를 누르면 ${first}${hasBatchim(first) ? "을" : "를"} 바로 엽니다.`));
  }

  // The verse list shown — 성서 본문 or 성시 (ADR-046 §3) — and its pages. 「2/5」 may be read as a fraction — say it in words.
  const verses = group === "psalter" && psalter ? psalter : group === "bible" && hasBible ? result : null;
  const totalPages = verses ? Math.ceil(verses.total / pageSize) : 0;
  const paged = !!verses && !isPending && totalPages > 1 && !!paginationBuilder;
  const pageWords = paged ? `, 전체 ${totalPages}쪽 중 ${page}쪽` : "";
  if (groups.length > 1) {
    container.appendChild(buildSearchPills(group, counts, screen.groupHref));
  }
  // 책을 골랐으면 보이는 알약의 이름(「전체」, 책의 온전한 이름)과 수, 그 뒤에 책마다의 수다(ADR-049 §2)
  const scopeLabel = books ? (result.shownBook ? bookTitle(result.shownBook) : books.length === 1 ? bookTitle(books[0][0]) : "전체") : null;
  if (scopeLabel && books) {
    said.push(isPending ? `검색 중… 현재 ${result.total}건` : `${scopeLabel} ${result.total}건${pageWords}`);
    if (!isPending && books.length > 1) for (const [id, n] of books) said.push(`${bookName(id)} ${n}건`);
  } else if (hasBible) said.push(isPending ? `검색 중… 현재 성서 본문 ${result.total}건` : `성서 본문 ${result.total}건${group === "bible" ? pageWords : ""}`);
  if (psalter) said.push(`성시 ${psalter.total}건${group === "psalter" ? pageWords : ""}`);
  if (lect) said.push(`${lectGroupName(lect)} ${lect.items.length}건`);

  if (group === "lectionary" && lect) {
    appendLectGroup(container, lect, screen);
    return `"${query}" ${lead ? `${lead} ` : ""}${said.join(", ")}`;
  }

  if (verses) {
    for (const note of notes) container.appendChild(el("p", { className: "search-note" }, note));
    const countLabel = group === "bible" && isPending
      ? `"${query}" 검색 중… (현재 ${result.total}건)`
      : `${scopeLabel || (group === "psalter" ? "성시" : "성서 본문")} ${verses.total}건 (${page}/${totalPages}쪽)`;
    // A heading, so a screen-reader user whose focus stayed on the pressed page link (routing.js) reaches the new
    // page's results in one move — VoiceOver rotor / TalkBack headings. Looks the same as the old <p> (style.css).
    container.appendChild(el("h2", { className: "search-count" }, countLabel));

    const list = el("ul", { className: "search-results", role: "list" });
    for (const r of verses.results) {
      const li = el("li", { className: "search-result-item" });
      const link = el("a", { href: `/${r.b}/${r.c}/${r.v}?hl=${encodeURIComponent(highlightTerm)}` });
      link.appendChild(el("span", { className: "search-result-ref" }, resultRefLabel(r)));
      link.appendChild(buildSnippet(r.t, highlightTerm));
      li.appendChild(link);
      list.appendChild(li);
    }
    container.appendChild(list);

    if (paged && paginationBuilder) container.appendChild(paginationBuilder(query, page, totalPages, group, result.shownBook || null));
  }
  return `"${query}" ${lead ? `${lead} ` : ""}${said.join(", ")}`;
}

// ── In-page search input (mobile full-screen view, ADR-029 / P2) ──
// The mobile tab bar routes /search to a full-screen in-page view instead of
// the bottom sheet. This builds a minimal search input bar (mirroring the
// header #search-bar markup) wired to commit via the URL (/search?q=...), so it
// reuses the same routing + history path as the desktop top bar. Returns the
// wrapper element. It never takes focus by itself (ADR-048 §2).
/**
 * @param {string} query
 * @returns {HTMLElement}
 */
function buildInPageSearchInput(query) {
  const wrap = el("div", { id: "search-inpage-bar", role: "search" });
  const input = /** @type {HTMLInputElement} */ (el("input", {
    id: "search-inpage-input",
    type: "search",
    inputmode: "search",
    enterkeyhint: "search",
    autocorrect: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: "예: 사랑, 사랑 in:요한, 창세 1:3",
    "aria-label": "검색",
    autocomplete: "off",
  }));
  input.value = query || "";
  const clear = el("button", { id: "search-inpage-clear", type: "button", "aria-label": "검색어 지우기" }, "×");
  clear.hidden = !query.trim();

  input.addEventListener("input", () => { clear.hidden = !input.value.trim(); });
  input.addEventListener("keydown", (e) => {
    // Esc lowers the keyboard and leaves the query, the results and the chosen books as they are (ADR-048 §5): focus
    // moves to this bar's funnel. Its default would empty a search input (Chrome) while the results stay, and the
    // document's Escape handler (app.js) must not reset some other control. Mid-composition the key is the IME's
    // (Safari can report it with isComposing false but keyCode 229).
    if (e.key === "Escape") {
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopPropagation();
      focusFunnelOrHome(wrap.querySelector(".token-funnel"), { preventScroll: true });
      // Neither took focus (both hidden): still lower the keyboard, as ⊗ does.
      if (document.activeElement === input) input.blur();
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitTopSearch(input.value);
  });
  // ⊗ clears the query and lowers the keyboard, even mid-typing: clearing means leaving the search (ADR-048 §4). The
  // button hides, so focus moves to this bar's funnel (where the book sheet's 「적용」 returns it, ADR-033 D3) and, after
  // the recents view redraws the bar, to the new bar's funnel; to the home tab when a funnel can't take it. A tap or
  // click draws no focus ring there: the input always matches :focus-visible, so the browser would otherwise ring the
  // control focus moved to (`focusVisible: false`, as in helpers.js). With a keyboard press the ring shows where focus
  // went. pointerdown's default is prevented so the input keeps focus until click moves it in one step (as on the
  // funnel).
  clear.addEventListener("pointerdown", (e) => e.preventDefault());
  clear.addEventListener("click", (e) => {
    input.value = "";
    clear.hidden = true;
    /** @type {FocusOptions & { focusVisible?: boolean }} */
    const options = e.detail > 0 ? { preventScroll: true, focusVisible: false } : { preventScroll: true };
    const funnel = wrap.querySelector(".token-funnel");
    const focused = focusFunnelOrHome(funnel, options);
    if (document.activeElement === input) input.blur();
    // Drop the query (back to the recents/empty view) but keep the book-picker
    // scope so a cleared field doesn't silently reset the filter (ADR-033).
    if (window.parsePath().view === "search") {
      navigateSearch({ q: "" });
      // The home tab only stands in until the redraw: the new bar's funnel takes focus back from it.
      const standIn = focused && focused !== funnel ? focused : null;
      _inpageFocusAfterRender = { seq: window.routeSeq?.() ?? 0, target: "funnel", options, standIn };
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(clear);
  // Mount in-field tokens (book scope) so the in-page bar is the
  // single search surface on mobile — no separate filter bar (ADR-033 개정 B).
  mountSearchField(wrap, input);
  return wrap;
}

// ── Search options: book-picker scope + recents (ADR-033) ──
// Filter state is URL-encoded (parsePath → { filterBooks }) so it
// survives history/back-forward and tab restore (ADR-031). currentSearchState
// reads the live URL; navigateSearch patches it and routes. A filter change
// resets pagination to page 1 (unless the patch sets page) and never sets
// searchAutoNavigate — only an explicit query commit (commitTopSearch) may
// auto-jump to a verse reference.

/** @returns {{ q: string, page: number, filterBooks: string[] }} */
function currentSearchState() {
  const p = window.parsePath();
  // Off /search (the header field commits from any view) there is no search state yet.
  if (p.view !== "search") return { q: "", page: 1, filterBooks: [] };
  return {
    q: p.query || "",
    page: p.page || 1,
    filterBooks: (p.filterBooks || []).slice(),
  };
}

/** @param {{ q?: string, page?: number, filterBooks?: string[] }} patch */
function navigateSearch(patch) {
  const next = Object.assign(currentSearchState(), patch);
  if (!("page" in patch)) next.page = 1;
  const url = buildSearchUrl(next);
  if (location.pathname + location.search === url) window.route();
  else window.navigate(url);
}

// Lazy book-id → 한국어 이름 map, used for the book pill labels (ADR-049). Resolved on
// demand (renderSearchResults awaits it before building the filter bar) rather
// than at module load — search.js loads before views.js, so
// window.loadBooks isn't defined yet at init. On failure the cache stays null so
// a later render retries; pills fall back to the raw id until names arrive.
/** @type {{ [id: string]: string } | null} */
let _bookMap = null;
// The books' full names (books.json `name_ko`, 「루가의 복음서」) for the heading above a book's results, and their canon
// order for the book pills (ADR-049). Filled with _bookMap.
/** @type {Map<string, string>} */
const _bookTitles = new Map();
/** @type {string[]} */
let _bookOrder = [];
// Chapters per book (books.json `chapter_count`): the results screen tells a chapter the book does not have (ADR-044 §2).
/** @type {Map<string, number>} */
const _chapterCounts = new Map();
async function ensureBookMap() {
  if (_bookMap) return _bookMap;
  try {
    if (typeof window.loadBooks !== "function") return {};
    const books = await window.loadBooks();
    /** @type {{ [id: string]: string }} */
    const map = {};
    // Book pills use the Korean short name (창세, 요한) — five full names (창세기,
    // 요한의 복음서) would not fit the row. Fall back to name_ko.
    for (const b of books) {
      map[b.id] = b.short_name_ko || b.name_ko;
      if (b.name_ko) _bookTitles.set(b.id, b.name_ko);
      if (typeof b.chapter_count === "number") _chapterCounts.set(b.id, b.chapter_count);
    }
    _bookOrder = books.map((b) => b.id);
    _bookMap = map;
    return _bookMap;
  } catch {
    return {}; // leave _bookMap null so a later render retries
  }
}

// ── 교회력 엔진: 줄이 여는 날, 독서 표기, 성탄 평일의 이름(ADR-044 §1, §3) ──
// 엔진(liturgical-engine.js)을 불러오고 교회력 자료(교회력 표와 독서 표 등)를 내려받는 일은 전례일 결과가 처음 나올 때 한다. 독서 표기도
// 엔진이 읽은 독서 표에서 꺼내므로 독서 데이터를 따로 받지 않는다. 내려받지 못하면 다음 검색에서 다시 받고, 그동안 줄은 날짜 없이,
// 독서는 색인의 숫자 표기(`lectNotation`)로 그린다.
/** @type {Promise<Engine | null> | null} */
let _engine = null;
/** The loaded engine, so a later search uses it without waiting. @type {Engine | null} */
let _engineMod = null;
/** @returns {Promise<Engine | null>} */
function ensureEngine() {
  return (_engine ??= import("./liturgical-engine.js")
    .then(async (mod) => {
      await Promise.all([mod.preloadCalendar(), mod.preloadLectionary()]);
      return (_engineMod = mod);
    })
    .catch((err) => {
      console.warn("교회력 자료를 내려받지 못했습니다", err);
      _engine = null;
      return null;
    }));
}

/**
 * `promise`를 `ms`까지만 기다린다. 넘으면 null이다(`promise`는 그대로 이어진다).
 * @template T
 * @param {Promise<T>} promise @param {number} ms
 * @returns {Promise<T | null>}
 */
function withinMs(promise, ms) {
  if (ms <= 0) return Promise.resolve(null);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return Promise.race([promise, new Promise((resolve) => { timer = setTimeout(() => resolve(null), ms); })])
    .finally(() => clearTimeout(timer));
}

/** 기기의 오늘 「YYYY-MM-DD」. @param {Engine} mod */
function todayOf(mod) {
  const now = new Date();
  return mod.toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 워커에 보낸 성탄 평일의 화면 이름을 계산한 날(ADR-044 §3). 보낸 적이 없으면 null. @type {string | null} */
let _christmasNamesDay = null;
/** 찾기 전에 이름을 기다렸다가 받지 못했다(3초 안에 다 받지 못한 것도 든다). 그 뒤로는 기다리지 않는다(받기는 뒤에서 이어 가고, 이름은 교회력 자료를 다 받는 대로 보낸다). */
let _christmasNamesFailed = false;

/** 워커가 오늘 계산한 성탄 평일 이름을 알고 있는가. 교회력 자료를 받기 전에는 보낸 적이 있는지만 본다. */
function christmasNamesFresh() {
  if (!_christmasNamesDay) return false;
  return !_engineMod || _christmasNamesDay === todayOf(_engineMod);
}

/**
 * 이번 전례년의 성탄 평일의 화면 이름(「성탄 1주 수요일」)을 워커에 보낸다. 해마다 바뀌어 색인에 없으므로 엔진으로 계산한다.
 * 전례년이 바뀌면 이름도 바뀌므로 날마다 한 번 보내고, 워커는 다음 검색부터 별칭처럼 찾는다.
 * @param {Engine} mod @param {string} today
 */
async function sendChristmasNames(mod, today) {
  if (_christmasNamesDay === today) return;
  const names = await mod.findChristmasNames(today);
  // 날이 바뀌는 무렵에 어제의 계산이 늦게 끝나면 오늘 보낸 이름을 덮지 않는다
  if (_christmasNamesDay && _christmasNamesDay > today) return;
  ensureSearchWorker().postMessage({ type: "lect-names", names: [...names] });
  _christmasNamesDay = today;
}

// ── BEGIN LECT_DAYS ──
/**
 * 줄 하나가 여는 날과 다른 날(ADR-044 §1). 모든 줄이 이번 전례년의 날을 연다(엔진 `findReadingDay`). 이름으로 찾은 줄이 해에 따라 다른
 * 독서를 읽으면 다른 해의 날을 해마다 하나씩 찾고, 구절로 찾은 줄이 해에 따라 다른 독서를 읽으면 여는 날이 지났을 때만 다음에 읽는 날을
 * 찾는다. 해마다 같은 독서를 읽는 줄은 이번 전례년의 날을 열면 다음 전례년에 그 전례일을 지키는 날을 찾는다(`nextYear`). 화면의 이름으로
 * 찾은 성탄 평일(§3)도 그 줄의 세트로 찾는다. 그 이름은 이번 전례년의 이름이라(엔진 `findChristmasNames`) 여는 날이 그 이름의 날이다.
 * 지역 축일은 해마다 같은 날짜라 엔진의 표 없이 센다. `isStale`이 참이면(화면을 떠났으면) 엔진이 표를 더 세지 않는다(코드 리뷰 2026-11-17).
 * @param {Engine} mod @param {any} item @param {string} today @param {() => boolean} [isStale]
 * @returns {Promise<LectDays | null>}
 */
async function lectDaysOf(mod, item, today, isStale = () => false) {
  const ly = mod.liturgicalYearSpan(today);
  const nextLy = mod.liturgicalYearSpan(/** @type {string} */ (mod.addDays(ly.to, 1)));
  if (item.local) {
    // 한 전례년에 같은 날짜가 두 번 있으면(11월 말과 12월 초) 오늘이나 그 뒤의 날, 둘 다 지났으면 앞의 날이다. 없으면(평년의 2월 29일)
    // 다음 그날이다. 설립 연도보다 이른 날은 세지 않는다(`localYearDayOf`와 같다)
    const since = item.local.level !== "dedication" && item.local.year ? Number(item.local.year) : 0;
    const datesIn = (/** @type {{ from: string, to: string }} */ span) =>
      monthDaysBetween(item.obs.date, span.from, span.to).filter((d) => Number(d.slice(0, 4)) >= since);
    const here = datesIn(ly);
    const date = here.find((d) => d >= today) || here[0] || nextMonthDay(item.obs.date, today);
    const nextYear = here.length ? { date: datesIn(nextLy)[0] || null } : null;
    return { open: localDayOf(mod, item, date), next: null, nextIds: [], year: null, cycles: [], nextYear };
  }
  const ids = lectSlugIds(item);
  const open = await mod.findReadingDay(ids, today, null, isStale);
  if (!open) return null;
  const year = item.hits ? "" : lectYearOf(item, open);
  if (year) {
    // 이름으로 찾은 줄이 해에 따라 다른 독서를 읽으면, 열리는 날 뒤에 다른 해의 독서를 읽는 첫날을 해마다 찾는다. 열리는 날은 그
    // 해의 독서라 그날부터 찾아도 그날은 나오지 않는다. 엔진의 표를 한 번에 하나씩 늘리도록 차례로 묻는다
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const set of item.sets) {
      if (set.year && set.year !== year) groups.set(set.year, [...(groups.get(set.year) || []), String(set.id)]);
    }
    /** @type {KeptDay[]} */
    const cycles = [];
    for (const group of groups.values()) {
      const day = await mod.findReadingDay(group, today, open.date, isStale);
      if (day) cycles.push(day);
    }
    cycles.sort((a, b) => (a.date < b.date ? -1 : 1));
    return { open, next: null, nextIds: ids, year, cycles, nextYear: null };
  }
  if (!lectCyclic(item)) {
    // 해마다 같은 독서는 링크 없이 다음 전례년의 날을 적는다. 이번 전례년에 오지 않아 다음에 읽는 날을 열었으면 적지 않는다. 다음
    // 전례년 안에서만 찾는다. 그 뒤의 날은 적지 않으므로, 다음 전례년에 지키지 않는 줄 때문에 표를 몇 해 더 세지 않는다
    /** @type {{ date: string | null } | null} */
    let nextYear = null;
    if (open.date <= ly.to) {
      const [day] = await mod.findKeptDays(ids, today, nextLy.from, nextLy.to, isStale);
      // 화면을 떠나 그친 빈 배열을 「다음 전례년에는 지키지 않음」으로 적지 않는다
      if (isStale()) return null;
      nextYear = { date: day ? day.date : null };
    }
    return { open, next: null, nextIds: ids, year: null, cycles: [], nextYear };
  }
  const next = open.date < today ? await mod.findReadingDay(ids, today, today, isStale) : null;
  return { open, next: next && next.date !== open.date ? next : null, nextIds: ids, year: null, cycles: [], nextYear: null };
}

/**
 * 지역 축일 줄이 그날 여는 날(ADR-044 §3). 색 점은 줄을 누르면 열리는 화면 머리의 색이다. 소속교회의 축성일은 축성일을 고른 화면이라 본당 표의
 * 색이고(화면이 만든 후보는 자기 색 하나다, 엔진 `headerColors`), 설립일은 그날의 화면이라 그날의 색이다.
 * @param {Engine} mod @param {any} item  LectItem with `local` @param {string} date
 * @returns {KeptDay}
 */
function localDayOf(mod, item, date) {
  let colors = item.local.color ? [item.local.color] : [];
  if (item.local.level !== "dedication") {
    const resolved = mod.resolveDate(date);
    colors = resolved ? mod.headerColors(resolved, null).colors : [];
  }
  return { date, obs: item.obs.key, setId: null, track: null, name: item.obs.name, colors, ember: false };
}

/**
 * 연도를 붙여 찾은 지역 축일의 그해 날(ADR-044 §3, §4). 설립 연도보다 이른 해와 그해에 없는 날(평년의 2월 29일)에는 없다.
 * @param {Engine} mod @param {any} item @param {number} y @returns {any}  YearDay | null
 */
function localYearDayOf(mod, item, y) {
  const [m, d] = item.obs.date.split(".").map(Number);
  const date = monthDayIn(y, m, d);
  if (!date || (item.local.level !== "dedication" && item.local.year && y < item.local.year)) return null;
  return { kind: "kept", ...localDayOf(mod, item, date), from: null, by: null, bySaint: false };
}
// ── END LECT_DAYS ──

/**
 * 전례일 줄마다 여는 날을 계산해 `screen.days`에 둔다(ADR-044 §1). `deadline`까지만 기다린다(전례일을 기다리는 같은 3초). 그 안에 끝나지
 * 않으면 계속 계산하는 약속을 `{ later }`에 싸서 돌려주고(그대로 돌려주면 이 함수의 약속이 그것을 기다린다), 부른 쪽이 그린 뒤에 줄의
 * 글만 바꿔 날짜를 넣는다(`patchLectDays`). 끝났거나 계산할 줄이 없으면 null. 화면을 떠났으면(`isStale`) 계산을 그친다.
 * @param {any} result @param {SearchScreen} screen @param {number} deadline  Date.now() 기준 @param {() => boolean} isStale
 * @returns {Promise<{ later: Promise<void> } | null>}
 */
async function withLectDays(result, screen, deadline, isStale) {
  const lect = shownLectionary(result);
  // 연도를 붙여 찾은 줄은 그해의 날을 이미 담았다(`withYearRows`)
  if (!lect || lect.years) return null;
  const days = new Map();
  screen.days = days;
  const work = (async () => {
    const mod = await ensureEngine();
    if (!mod) return;
    const today = todayOf(mod);
    // 화면의 이름으로 찾을 수 있게, 교회력 자료를 처음 받은 뒤 이번 전례년의 성탄 평일의 이름을 보내 둔다
    sendChristmasNames(mod, today).catch(() => {});
    // `appendLectGroup` may replace `lect.items` with a reordered array while this awaits, so pair `found` with the
    // array it was computed from, not whatever `lect.items` is afterwards
    const items = lect.items;
    const found = await Promise.all(items.map((/** @type {any} */ item) => lectDaysOf(mod, item, today, isStale).catch(() => null)));
    if (screen.days !== days) return;
    screen.today = today;
    items.forEach((/** @type {any} */ item, /** @type {number} */ i) => days.set(item, found[i]));
  })();
  let done = false;
  const finished = work.then(() => { done = true; });
  await withinMs(finished, deadline - Date.now());
  return done ? null : { later: finished };
}

/**
 * 사용자가 마지막으로 화면을 건드린 때(누르기, 스크롤, 키 입력, `performance.now()`)와 전례일 줄 목록을 그린 때. 3초가 지나 온 날짜로 줄을
 * 다시 늘어놓을지 정한다(`patchLectDays`). `scroll` 이벤트는 보지 않는다. 화면 전환과 스크롤 기억도 그 이벤트를 낸다.
 */
let _lastUserInput = 0;
let _userInputWatched = false;
/** @type {WeakMap<Element, number>} */
const _lectDrawnAt = new WeakMap();
// 늦게 온 날짜로 줄을 다시 늘어놓았을 때 화면 읽기 프로그램에 한 번 읽어 주는 글(사용자 결정 2026-11-23). VoiceOver로 쓸어 넘기는 동작은
// 앱이 알 수 없어(`watchUserInput`이 보는 이벤트가 나지 않는다), 듣던 차례가 바뀐 것을 이 글로 알린다
const LECT_RESORTED_NOTE = "전례일을 날짜순으로 다시 정렬했습니다.";

/** Note the user's own input from now on, once: pointer, touch, wheel and key events. */
function watchUserInput() {
  if (_userInputWatched) return;
  _userInputWatched = true;
  const note = () => { _lastUserInput = performance.now(); };
  for (const type of ["pointerdown", "touchstart", "wheel", "keydown"]) {
    document.addEventListener(type, note, { capture: true, passive: true });
  }
}

/**
 * 3초가 지나 계산이 끝난 날짜를 그린 줄에 넣는다(ADR-044 §1). 줄의 글만 바꾸고 줄을 새로 만들지 않아 포커스가 남는다. 그린 뒤 사용자가
 * 화면을 건드리지 않았고 포커스가 목록 밖이면 줄을 날짜 차례로 다시 늘어놓고(`lectItemsByDay`), 건드렸으면 차례를 그대로 둔다. 누르려던
 * 줄이 손가락 아래에서 다른 날로 바뀌거나 화면 읽기 프로그램으로 듣던 차례가 바뀌지 않게 하려는 것이다(사용자 결정 2026-11-23, 코드 리뷰).
 * 다시 늘어놓으면 화면 읽기 프로그램에 알린다(`LECT_RESORTED_NOTE`). 독서 표기는 처음 그린 것(`labelOf`)을 그대로 쓴다. 나중에 받아도 다시 그리지 않기로 했다(ADR-044 §1).
 * @param {HTMLElement} target @param {any} lect @param {SearchScreen} screen
 * @param {(setId: string, slot: string) => string | null} labelOf
 */
function patchLectDays(target, lect, screen, labelOf) {
  const list = target.querySelector("ul.lect-rows");
  if (!list) return;
  // `lect.items` is in the order the rows were drawn (`appendLectGroup`)
  const rows = /** @type {HTMLElement[]} */ (Array.from(list.children));
  /** @type {Map<any, HTMLElement>} */
  const rowOf = new Map();
  lect.items.forEach((/** @type {any} */ item, /** @type {number} */ i) => {
    const li = rows[i];
    if (!li) return;
    fillLectRow(li, lectRowOf(item, labelOf, screen.days?.get(item) ?? null, screen.today));
    rowOf.set(item, li);
  });
  const sorted = lectItemsByDay(lect, screen.days);
  if (rows.length !== lect.items.length || sorted.every((item, i) => item === lect.items[i])) return;
  // A list with no drawing time counts as touched: it stays as drawn
  const touched = (_lectDrawnAt.get(list) ?? -Infinity) <= _lastUserInput || list.contains(document.activeElement);
  if (touched) return;
  lect.items = sorted;
  for (const item of sorted) list.appendChild(/** @type {HTMLElement} */ (rowOf.get(item)));
  window.announce(LECT_RESORTED_NOTE);
}

/**
 * 연도를 붙인 이름 검색(ADR-044 §4): 찾은 전례일마다 그해의 날을 엔진으로 계산해 줄로 바꾼다(`yearRowsOf`). 줄이 계산에 달려 있어 3초를
 * 기다리지 않고 끝까지 기다린다. 그동안 결과 자리에는 「검색 중…」이 보인다. 한 해씩 세고 해 사이마다 차례를 넘긴다. 교회력 자료를
 * 내려받지 못했으면 줄 없이 그렇다고 적는다. 화면을 떠났으면(`isStale`) 그친다.
 * @param {any} result @param {SearchScreen} screen @param {() => boolean} isStale
 */
async function withYearRows(result, screen, isStale) {
  const lect = result.lectionary;
  if (!lect || !lect.years || lect.yearRows) return;
  // 이름으로 찾은 전례일이 없으면(`사랑 2000`, 코드 리뷰 2026-11-17) 교회력 자료를 받지도, 해를 세지도 않는다
  if (!lect.items.length) {
    const { items, notes } = yearRowsOf(lect.items, [], lect.years);
    lect.items = items;
    lect.notes = notes;
    lect.yearRows = true;
    return;
  }
  const mod = await ensureEngine();
  if (isStale()) return;
  if (!mod) {
    lect.items = [];
    lect.notes = ["교회력 자료를 내려받지 못해 그해의 날짜를 계산하지 못했습니다."];
    lect.yearRows = true;
    return;
  }
  const found = lect.items;
  // 지역 축일은 해마다 같은 날짜라 엔진의 해마다의 표에 묻지 않는다(`localYearDayOf`)
  const engineItems = found.filter((/** @type {any} */ item) => !item.local);
  const asks = engineItems.map((/** @type {any} */ item) => ({ ids: lectSlugIds(item), key: item.obs.key }));
  /** @type {Array<{ year: number, days: Array<any | null>, lunar: boolean }>} */
  const perYear = [];
  for (let y = lect.years.from; y <= lect.years.to; y++) {
    if (y > lect.years.from) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isStale()) return;
    }
    try {
      const engineDays = asks.length ? mod.findYearDays(asks, y) : [];
      let k = 0;
      const days = found.map((/** @type {any} */ item) => (item.local ? localYearDayOf(mod, item, y) : engineDays[k++]));
      perYear.push({ year: y, days, lunar: mod.hasLunarYear(y) });
    } catch (err) {
      // 엔진이 그해를 계산하지 못해도 성서 본문 결과는 그린다(`withLectDays`가 줄마다 오류를 삼키는 것과 같다)
      console.warn("그해의 날짜를 계산하지 못했습니다", err);
      lect.items = [];
      lect.notes = ["그해의 날짜를 계산하지 못했습니다."];
      lect.yearRows = true;
      return;
    }
  }
  const { items, notes } = yearRowsOf(found, perYear, lect.years, mod.lunarYearSpan());
  lect.items = items;
  lect.notes = notes;
  lect.yearRows = true;
  screen.today = todayOf(mod);
}

/** 카드에서 방금 등록한 소속교회(설정 목록의 이름)와 그때의 검색어. 다시 그린 같은 검색이 한 번 알린다. @type {{ name: string, q: string } | null} */
let _pickedParish = null;

/**
 * 지역 축일 안내 카드에서 소속교회를 등록한다(ADR-044 §3): 설정에 저장하고 같은 검색을 다시 그린다. 다시 그린 결과는 등록한 것을 맨 위에 알리고
 * 소속교회의 축성일 줄에, 그 줄이 없으면(축복일만 있는 교회) 그 알림에 포커스를 둔다(누른 단추가 사라지므로, WCAG 2.4.3). 설정을 다른 기기와 맞추는 일은 `saveParish`가 한다.
 * @param {string} churchId @param {string} name  설정 목록의 이름 @param {string} query
 */
function pickParish(churchId, name, query) {
  saveParish(churchId);
  _pickedParish = { name, q: query };
  window.route();
}

/**
 * 그린 안내 카드에 동작을 단다(`buildLocalNotice`). 그 본당을 등록하는 단추는 누르면 등록하고, 교회 목록은 받은 뒤 선택할 수 있게 한다. 목록을
 * 받지 못하면 「목록 없음」으로 둔다. 「소속교회로 선택」을 눌렀는데 선택한 교회가 없으면 선택 상자로 포커스를 옮긴다.
 * @param {HTMLElement} target @param {string} query
 */
function wireLocalNotice(target, query) {
  const card = /** @type {HTMLElement | null} */ (target.querySelector(".search-local-note"));
  if (!card || card.dataset.wired) return;
  card.dataset.wired = "1";
  const pick = /** @type {HTMLButtonElement | null} */ (card.querySelector("button[data-church]"));
  if (pick) {
    // 단추의 이름은 이미 설정 목록의 이름이다(`localNoticeOf`)
    pick.addEventListener("click", () => pickParish(pick.dataset.church || "", pick.dataset.name || "", query));
  }
  const select = /** @type {HTMLSelectElement | null} */ (card.querySelector(`#${LOCAL_PICK_SELECT_ID}`));
  const go = /** @type {HTMLButtonElement | null} */ (card.querySelector(".search-local-pick-btn:not([data-church])"));
  if (!select || !go) return;
  // 설정 화면과 같은 목록이다. 받는 데 시간 제한이 있고, 옛 표(식별자가 없음)면 오류로 끝난다
  loadParishOptions().then((options) => {
    if (!select.isConnected) return;
    fillSelect(select, [["", "선택 안 함"], ...options], "");
    select.disabled = false;
    go.disabled = false;
  }, () => {
    if (!select.isConnected) return;
    fillSelect(select, [["", "목록 없음"]], "");
  });
  go.addEventListener("click", () => {
    const option = select.selectedOptions[0];
    if (!select.value || !option) {
      select.focus();
      return;
    }
    pickParish(select.value, option.textContent || "", query);
  });
}

// alias(소문자) → book id, for absorbing typed/example `in:<alias>` operators
// into the chosen books (the book pills) at commit time. Built from the worker's alias table
// (search-meta.json: 막, 마가복음, …) plus each book's id, short and full Korean
// name, so every `in:` the search reads becomes a chosen book (ADR-033). Until the map
// loads, or for an alias neither knows, the token stays as text in `q` and the
// worker reports or resolves it.
/** @type {Map<string, string> | null} */
let _aliasMap = null;
// book id → short name (the book pill label), in canon order: the `in:` aliases a
// recent-search label is written with (`historyLabel`, ADR-014 D1). Built with
// _aliasMap, so the labels replay through it.
/** @type {Map<string, string> | null} */
let _aliasById = null;
async function ensureAliasMap() {
  if (_aliasMap) return _aliasMap;
  /** @type {Map<string, string>} */
  const map = new Map();
  /** @type {Map<string, string>} */
  const byId = new Map();
  // Fetched alongside the books; it is precached with the app shell (sw.js).
  // Without it the books' own names and ids still work.
  /** @type {Promise<{ aliases?: Record<string, unknown>, books?: Record<string, unknown> } | null>} */
  const metaPromise = fetch(`${DATA_DIR}/search-meta.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((meta) => (meta && meta.aliases && meta.books ? meta : null))
    .catch(() => null);
  try {
    // window.loadBooks (data-fetch.js) is defined by a module that loads AFTER
    // search.js in index.html, so the boot-time preload kick can fire before it
    // exists. Wait briefly for it instead of bailing once: a permanent bail left
    // _aliasMap null with no retry, which silently killed in:<alias> absorb in
    // commitTopSearch (regression from the #246 synchronous-absorb refactor).
    for (let i = 0; typeof window.loadBooks !== "function" && i < 60; i++) {
      await new Promise((r) => setTimeout(r, 25));
    }
    if (typeof window.loadBooks !== "function") return map;
    const books = await window.loadBooks();
    const meta = await metaPromise;
    // With the worker's table, only the books it searches become chosen books: a book
    // outside its index would search nothing. 전례시편 and 송가 are in it, in the
    // 성시 chunk (ADR-046 §2).
    const ids = new Set(books.map((b) => b.id).filter((id) => !meta || Object.hasOwn(meta.books || {}, id)));
    for (const [alias, id] of Object.entries((meta && meta.aliases) || {})) {
      if (typeof id === "string" && ids.has(id)) map.set(alias.toLowerCase(), id);
    }
    for (const b of books) {
      if (!ids.has(b.id)) continue;
      map.set(b.id.toLowerCase(), b.id);
      if (b.short_name_ko) map.set(b.short_name_ko.toLowerCase(), b.id);
      if (b.name_ko) map.set(b.name_ko.toLowerCase(), b.id);
      const alias = b.short_name_ko || b.name_ko;
      if (alias) byId.set(b.id, alias);
    }
    _aliasMap = map;
    _aliasById = byId;
  } catch { /* leave _aliasMap null so a later call retries */ }
  return _aliasMap || map;
}

// ── BEGIN SCOPE_HELPERS ──
// 한 번에 고를 수 있는 책의 수(ADR-033 「책은 5권까지」). 책 칩과 `in:`을 합쳐 센다. 검색 워커(js/search-worker.js)에도
// 같은 값이 있고, tests/unit/search.test.js가 둘이 같은지 본다.
const MAX_SCOPE_BOOKS = 5;
const SCOPE_LIMIT_NOTE = `책은 ${MAX_SCOPE_BOOKS}권까지 고를 수 있습니다.`;

// Pure query-scope helpers — `in:<book>` extraction (client-side mirror of the
// worker's parseQuery) + book-name lookup. Sliced + unit-tested in
// tests/unit/search.test.js with a stubbed aliasMap / _bookMap.

// Mirrors the worker's IN_RE (search-worker.js): one or more `in:<alias>`,
// whitespace after `in:` ignored, alias greedy on non-space.
const IN_TOKEN_RE = /(?:^|\s)in:\s*(\S+)/g;
/**
 * Pull resolvable `in:<alias>` operators out of a raw query → book ids + the
 * remaining keyword. Unresolved aliases are left in place (worker handles them).
 * @param {string} raw
 * @param {Map<string, string>} aliasMap
 * @returns {{ keyword: string, ids: string[] }}
 */
function extractInScope(raw, aliasMap) {
  /** @type {string[]} */
  const ids = [];
  const keyword = raw.replace(IN_TOKEN_RE, (whole, alias) => {
    const id = aliasMap.get(String(alias).toLowerCase());
    if (id) { ids.push(id); return " "; }
    return whole;
  }).replace(/\s+/g, " ").trim();
  return { keyword, ids };
}

/**
 * The recent-search label of a committed search (ADR-014 D1): the keyword, then
 * `in:<short name>` for each book of the scope in canon order. extractInScope
 * reads the label back into the same keyword and books, so a recent search
 * replays its own scope, and one scope is one label whether its books were
 * picked in another order or typed as `in:`.
 * @param {string} keyword
 * @param {string[]} ids  book ids of the scope
 * @param {Map<string, string> | null} aliasById  book id → short name in canon
 *   order; null before the books load, when ids are written as they are
 * @returns {string}
 */
function historyLabel(keyword, ids, aliasById) {
  /** @type {Map<string, number>} */
  const order = new Map(Array.from(aliasById ? aliasById.keys() : [], (id, i) => [id, i]));
  /** @param {string} id */
  const rank = (id) => order.get(id) ?? order.size;
  const books = Array.from(new Set(ids)).sort((a, b) => rank(a) - rank(b));
  const scope = books.map((id) => "in:" + ((aliasById && aliasById.get(id)) || id));
  return [keyword, ...scope].filter(Boolean).join(" ");
}

/**
 * The search with book `id` taken out of its scope (the × on a book pill, ADR-049 §3): out of the chosen books and,
 * when it was typed as `in:<alias>` and never moved to the URL's books, out of the query too.
 * @param {string} q @param {string[]} filterBooks @param {string} id
 * @param {Map<string, string> | null} aliasMap
 * @returns {{ q: string, filterBooks: string[] }}
 */
function withoutScopeBook(q, filterBooks, id, aliasMap) {
  const books = filterBooks.filter((b) => b !== id);
  if (!aliasMap || !/(?:^|\s)in:/.test(q)) return { q, filterBooks: books };
  const keyword = q.replace(IN_TOKEN_RE, (whole, alias) => (aliasMap.get(String(alias).toLowerCase()) === id ? " " : whole))
    .replace(/\s+/g, " ").trim();
  return { q: keyword, filterBooks: books };
}

/**
 * The search with every chosen book taken out (「모두 지우기」 on the book pills, ADR-049 §3): no URL books, and the
 * `in:<alias>` the query names a book with taken out of it. An `in:` no book answers to stays (the worker tells it).
 * @param {string} q @param {Map<string, string> | null} aliasMap
 * @returns {{ q: string, filterBooks: string[] }}
 */
function withoutAllScopeBooks(q, aliasMap) {
  if (!aliasMap || !/(?:^|\s)in:/.test(q)) return { q, filterBooks: [] };
  return { q: extractInScope(q, aliasMap).keyword, filterBooks: [] };
}

/**
 * Book ids in canon order (the book pills, ADR-049 §1), duplicates dropped; ids `order` does not know go last.
 * @param {string[]} ids @param {string[]} order  every book id in canon order
 * @returns {string[]}
 */
function canonOrder(ids, order) {
  /** @param {string} id */
  const rank = (id) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return Array.from(new Set(ids)).sort((a, b) => rank(a) - rank(b));
}

/** @param {string} id */
function bookName(id) {
  return (_bookMap && _bookMap[id]) || id;
}
// ── END SCOPE_HELPERS ──

/** A book's full name (「루가의 복음서」), its short name until the books load. @param {string} id */
function bookTitle(id) {
  return _bookTitles.get(id) || bookName(id);
}

// CSP-safe inline SVG icon (no markup string — see buildSearchEmptyState).
/**
 * @param {string} className
 * @param {string[]} paths  `d` attributes
 * @param {Array<[number, number, number]>} [circles]  [cx, cy, r]
 */
function svgIcon(className, paths, circles) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  for (const [cx, cy, r] of circles || []) {
    const c = document.createElementNS(NS, "circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(r));
    svg.appendChild(c);
  }
  for (const d of paths) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

// ── Search field: the book-picker funnel (ADR-033, ADR-049 §1) ──────────────
// The funnel sits inside each search field (header #search-bar, mobile in-page #search-inpage-bar) and opens the book
// picker. The chosen books are no longer chips in the field: they show as pills right under it (ADR-049, the scope
// row below). The funnel turns the accent color while books are chosen; syncSearchFields() refreshes it from the URL
// on every route.

/** @typedef {{ container: HTMLElement, input: HTMLInputElement, zone: HTMLElement, funnel: HTMLElement, focused?: boolean }} SearchField */
/** @type {SearchField[]} */
const _searchFields = [];

// Insert the token zone (the funnel button) just before `input` inside `container` and register the field for
// syncSearchFields(). The header field mounts once at load; the in-page bar mounts each time it's rebuilt (stale ones
// are pruned).
/**
 * @param {HTMLElement} container
 * @param {HTMLInputElement} input
 */
function mountSearchField(container, input) {
  const zone = el("div", { className: "token-zone" });

  // Funnel → book-picker sheet (replaces the old "책 선택" bar button).
  const funnel = el("button", {
    type: "button",
    className: "token-funnel",
    "aria-haspopup": "dialog",
    "aria-label": "책 선택",
  });
  funnel.appendChild(svgIcon("token-funnel-icon", ["M3 5h18l-7 8v6l-4 2v-8z"]));
  funnel.addEventListener("pointerdown", (e) => e.preventDefault());
  funnel.addEventListener("click", (e) => { e.preventDefault(); openBookFilterSheet(funnel); });

  zone.appendChild(funnel);
  container.insertBefore(zone, input);

  /** @type {SearchField} */
  const field = { container, input, zone, funnel, focused: false };
  // Reveal the funnel on any screen while focus is anywhere in the search chrome.
  // Track focus at the *container* level (it holds both input and funnel), not on
  // the input alone: keying off input blur would hide the whole token-zone the
  // moment focus moves input → funnel (Tab) — making the funnel vanish before it
  // can be used (Bugbot). focusout only clears when focus truly leaves the chrome.
  container.addEventListener("focusin", () => { field.focused = true; syncOneField(field); });
  container.addEventListener("focusout", (e) => {
    const rt = /** @type {Node|null} */ (e.relatedTarget);
    if (container.contains(rt)) return;
    // The funnel opens the book-filter picker (a body-level sibling, not inside
    // the container). Keep the zone up while focus is in that picker — otherwise
    // it hides the zone, and on close the overlay tries to restore focus to a
    // funnel that's now display:none (unfocusable), so it never reappears.
    if (rt instanceof Element && rt.closest("#book-filter-sheet")) return;
    field.focused = false;
    syncOneField(field);
  });
  _searchFields.push(field);
  syncOneField(field);
}

// Refresh one field's funnel (shown, accent while books are chosen) from the live URL.
/** @param {SearchField} field */
function syncOneField(field) {
  const { zone, funnel } = field;
  const p = window.parsePath?.() || {};
  // Desktop bare /search (no query/scope) renders the book list, not the search
  // view — don't surface the header token zone there (mirrors routing.js's
  // render condition; the old filter bar lived in the view so it never showed on
  // the book-list fallback). Mobile always renders the search view for /search.
  const searchView = p.view === "search" && (isMobile()
    || !!p.query || (p.filterBooks && p.filterBooks.length));
  // Reveal the funnel on the search view, OR whenever the field itself is focused — so the book-filter funnel is
  // reachable from the search box on any screen, not only the search results view (user request).
  const active = searchView || field.focused === true;
  zone.hidden = !active;
  if (active) funnel.classList.toggle("active", currentSearchState().filterBooks.length > 0);
}

// Refresh every mounted field (called from route() and the search view renders). Prune
// detached in-page containers first so the list doesn't grow per render.
function syncSearchFields() {
  for (let i = _searchFields.length - 1; i >= 0; i--) {
    if (!_searchFields[i].container.isConnected) _searchFields.splice(i, 1);
  }
  for (const f of _searchFields) syncOneField(f);
}

// ── Book-filter sheet (book picker) ──
// Bottom sheet (mobile) / right side panel (desktop, CSS) with one tab per
// division (respecting the 외경 book-order setting) plus 성시 last, each tab
// holding that division's books as chips (ADR-033 「책 선택 시트의 구분 탭」).
// Multi-select toggles a working Set across all tabs; "적용" commits it to the
// URL scope in one navigation, "초기화" clears it. Built lazily as a body-level
// singleton (sibling of #app), driven by the shared overlay controller (ADR-032).

/**
 * One division tab of the sheet: its tab button, the count shown after the
 * label, and the panel of chips it shows.
 * @typedef {{ tab: HTMLElement, count: HTMLElement, panel: HTMLElement }} BookFilterTab
 */

/**
 * @typedef {object} BookSheet
 * @property {any} overlay
 * @property {HTMLElement} tabbar  Holds the tab row, rebuilt on every open.
 * @property {HTMLElement} body  Scrolls the shown tab's chips.
 * @property {Set<string>} working  Book ids chosen so far, across every tab.
 * @property {BookFilterTab[]} tabs  In tab order; refilled on every open.
 * @property {() => void} syncSelection
 * @property {(idx: number) => void} showTab
 */

/** @type {BookSheet | null} */
let _bookSheet = null;
// The field whose funnel opened the sheet — "적용" focuses its query input so the
// user can type the term right away (keyboard up) instead of focus returning to
// the funnel (user request). Set in openBookFilterSheet.
/** @type {SearchField | null} */
let _bookSheetReturnField = null;
// Fallback timer for the animated close (cleared on animationend / reopen).
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookSheetCloseTimer = null;
// What the next render of the search view must focus in the rebuilt mobile in-page bar. The redraw drops the old bar,
// so focus handed to its funnel or input fell to <body> (WCAG 2.4.3). Set by the book sheet's 「적용」 (ADR-033 D3: its
// funnel after a search, its input when the query was empty) and the bar's ⊗ (its funnel, ADR-048 §4). Matched against
// the route sequence, so a route that never drew the view (the user moved on) leaves nothing behind for a later screen.
// Read as `window.routeSeq?.() ?? 0` here and in the renders alike, or a booking made before routing.js loads never matches.
// `standIn` is where ⊗ put focus because the old funnel couldn't take it (the home tab): the new funnel takes it back.
/**
 * @type {{
 *   seq: number, target: "funnel" | "input", options: FocusOptions & { focusVisible?: boolean },
 *   standIn?: Element | null,
 * } | null}
 */
let _inpageFocusAfterRender = null;

/**
 * Focus the rebuilt in-page bar's funnel or input when this render is the one `_inpageFocusAfterRender` waits for and
 * the focus fell to <body> with the old bar, or still sits where ⊗ put it in the old funnel's stead (a focus the user put
 * elsewhere meanwhile is left alone).
 * @param {HTMLElement} view @param {number} seq
 */
function focusRebuiltInpageBar(view, seq) {
  const want = _inpageFocusAfterRender;
  if (!want || want.seq !== seq) return;
  _inpageFocusAfterRender = null;
  const at = document.activeElement;
  if (at && at !== document.body && at.isConnected && at !== want.standIn) return;
  if (want.target === "funnel") { focusFunnelOrHome(view.querySelector("#search-inpage-bar .token-funnel"), want.options); return; }
  const input = view.querySelector("#search-inpage-input");
  if (input instanceof HTMLElement) input.focus(want.options);
}

/**
 * Focus the mobile in-page bar's funnel, or the tab bar's home tab when the funnel can't take focus (missing, hidden),
 * so focus doesn't fall to <body> (ADR-048 §4, WCAG 2.4.3). Best effort: if the home tab can't take it either, focus
 * stays where it was.
 * @param {Element | null} funnel @param {FocusOptions & { focusVisible?: boolean }} options
 * @returns {HTMLElement | null} the funnel or the home tab, whichever took focus
 */
function focusFunnelOrHome(funnel, options) {
  if (funnel instanceof HTMLElement) {
    funnel.focus(options);
    if (document.activeElement === funnel) return funnel;
  }
  const home = document.querySelector('#tab-bar [data-tab="home"]');
  if (!(home instanceof HTMLElement)) return null;
  home.focus(options);
  return document.activeElement === home ? home : null;
}

// ── Book pills under the search field (ADR-049) ──
// The chosen books show as a row of pills right under the search field: under the mobile in-page bar, at the top of
// the search view on desktop (the header field is the input there). The row is drawn with the view, names only, and
// drawn again with each book's count once the search ends (`drawScopeRow`). The × on a pill takes that book out and
// searches again; focus then goes to the next pill's ×, the one before, or the funnel (§3). With two books or more,
// 「모두 지우기」 after the last pill takes them all out; focus then goes to the funnel.

// What the next render of the search view must focus after a pill's × took its book out: the × of the first of `ids`
// still there (the next book, then the one before), else the funnel. Matched against the route sequence like
// `_inpageFocusAfterRender`.
/** @type {{ seq: number, ids: string[], options: FocusOptions & { focusVisible?: boolean } } | null} */
let _scopeFocusAfterRender = null;

/**
 * Draw the book pill row for `query` within `filterBooks` into `row`. `result` is the search's final result: with its
 * `books` the pills carry each book's count (ADR-049 §2), without (no search yet, a verse reference, still loading)
 * they show the names only (§5). Hidden when no book is chosen. Focus inside the row stays on the same control.
 * @param {HTMLElement} row
 * @param {string} query
 * @param {string[]} filterBooks
 * @param {any} [result]
 */
function drawScopeRow(row, query, filterBooks, result) {
  /** @type {Array<[string, number]> | null} */
  const counts = result && Array.isArray(result.books) ? result.books : null;
  // Without counts, the books typed as `in:` in the query too (the worker counts them), so the row keeps its pills and
  // a removed pill's neighbour (`focusRebuiltScopeRow`) when the counts arrive. Not past the limit: those `in:` stay
  // text in the query and search nothing (ADR-033 「책은 5권까지」).
  const typed = !counts && _aliasMap && query ? extractInScope(query, _aliasMap).ids : [];
  const named = canonOrder(filterBooks.concat(typed), _bookOrder);
  const ids = counts ? counts.map(([id]) => id) : named.length > MAX_SCOPE_BOOKS ? canonOrder(filterBooks, _bookOrder) : named;
  const at = document.activeElement;
  const focusKey = at instanceof HTMLElement && row.contains(at)
    ? at.dataset.removeBook ? `x:${at.dataset.removeBook}` : at.dataset.focusKey || null
    : null;
  clearNode(row);
  row.hidden = ids.length === 0;
  if (!ids.length) return;
  row.appendChild(buildScopePills(ids.map((id) => ({ id, name: bookName(id) })), {
    counts,
    shown: counts ? result.shownBook || null : null,
    hrefOf: (id) => buildSearchUrl({ q: query, filterBooks, book: id }),
    onRemove: (id, e) => removeScopeBook(ids, id, e),
    onClear: (e) => clearScopeBooks(e),
  }));
  if (focusKey) {
    const same = Array.from(row.querySelectorAll("[data-remove-book], [data-focus-key]")).find((n) => n instanceof HTMLElement
      && (n.dataset.removeBook ? `x:${n.dataset.removeBook}` : n.dataset.focusKey) === focusKey);
    if (same instanceof HTMLElement) same.focus({ preventScroll: true });
  }
}

/**
 * The × on book pill `id`: search again without that book (ADR-049 §3), from page 1 and 「전체」. Focus goes to the
 * next pill's × once the view redraws, else the one before, else the funnel. Waits for the alias map when it has not
 * loaded, and does nothing if the view moved on meanwhile.
 * @param {string[]} ids  the pills' books, in order
 * @param {string} id
 * @param {MouseEvent} e
 */
async function removeScopeBook(ids, id, e) {
  const i = ids.indexOf(id);
  /** @type {FocusOptions & { focusVisible?: boolean }} */
  const options = e.detail > 0 ? { preventScroll: true, focusVisible: false } : { preventScroll: true };
  // A pill can stand for an `in:` book the worker counted before the alias map loaded: wait for the map so that `in:`
  // leaves the query too, as in `clearScopeBooks`.
  const before = location.pathname + location.search;
  const aliasMap = _aliasMap || await ensureAliasMap();
  if (location.pathname + location.search !== before) return;
  const cur = currentSearchState();
  navigateSearch(withoutScopeBook(cur.q, cur.filterBooks, id, aliasMap));
  _scopeFocusAfterRender = { seq: window.routeSeq?.() ?? 0, ids: [ids[i + 1], ids[i - 1]].filter(Boolean), options };
}

/**
 * 「모두 지우기」 on the book pills: search again in every book (ADR-049 §3), from page 1. Focus goes to the funnel once
 * the view redraws, as after the last pill's ×.
 * @param {MouseEvent} e
 */
async function clearScopeBooks(e) {
  /** @type {FocusOptions & { focusVisible?: boolean }} */
  const options = e.detail > 0 ? { preventScroll: true, focusVisible: false } : { preventScroll: true };
  // The pills can show `in:` books the worker counted before the alias map loaded; without the map they would stay in
  // the query and come back as pills. Wait for it, and give up if the view moved on meanwhile.
  const before = location.pathname + location.search;
  const aliasMap = _aliasMap || await ensureAliasMap();
  if (location.pathname + location.search !== before) return;
  const cur = currentSearchState();
  navigateSearch(withoutAllScopeBooks(cur.q, aliasMap));
  _scopeFocusAfterRender = { seq: window.routeSeq?.() ?? 0, ids: [], options };
}

/**
 * Focus the × named by `_scopeFocusAfterRender` when this render is the one it waits for and focus fell to <body> with
 * the pressed ×. No such pill left: the funnel of the field above the row.
 * @param {HTMLElement} view @param {number} seq
 */
function focusRebuiltScopeRow(view, seq) {
  const want = _scopeFocusAfterRender;
  if (!want || want.seq !== seq) return;
  _scopeFocusAfterRender = null;
  const at = document.activeElement;
  if (at && at !== document.body && at.isConnected) return;
  const xs = Array.from(view.querySelectorAll(".scope-pill-remove"));
  const next = want.ids.map((id) => xs.find((x) => x instanceof HTMLElement && x.dataset.removeBook === id)).find(Boolean);
  const funnel = Array.from(document.querySelectorAll("#search-inpage-bar .token-funnel, #search-bar .token-funnel"))
    .find((n) => n.getClientRects().length > 0);
  const target = next || funnel;
  if (target instanceof HTMLElement) target.focus(want.options);
}

function ensureBookSheet() {
  if (_bookSheet) return _bookSheet;

  const scrim = el("div", { className: "book-filter-scrim" });
  scrim.hidden = true;
  const panel = el("div", {
    id: "book-filter-sheet",
    className: "book-filter-sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "book-filter-title",
  });
  panel.hidden = true;

  // Left-edge width-resize grip (desktop side-panel only, hidden on mobile via
  // CSS) — mirrors #cite-sheet-resize / #bookmark-drawer-resize.
  const resize = el("div", { className: "book-filter-resize", "aria-hidden": "true" });
  const handle = el("div", { className: "book-filter-handle", "aria-hidden": "true" });
  const head = el("div", { className: "book-filter-head" });
  head.appendChild(el("h2", { id: "book-filter-title", className: "book-filter-title" }, "책 선택"));
  const headActions = el("div", { className: "book-filter-head-actions" });
  const resetBtn = el("button", { type: "button", className: "book-filter-reset" }, "초기화");
  // 「닫기」 글자 단추. 인용 시트, 북마크 패널과 같은 모양이고(.sheet-close, DESIGN.md 「시트 vs 모달」) 휴대폰의 손잡이 옆에도 늘 둔다.
  // 뒤 가림과 Esc로도 닫힌다.
  const closeBtn = el("button", { type: "button", className: "book-filter-close sheet-close" }, "닫기");
  headActions.appendChild(resetBtn);
  headActions.appendChild(closeBtn);
  head.appendChild(headActions);

  // 구분 탭 줄. 머리 아래에 늘 있고 칩만 스크롤된다(ADR-033 「책 선택 시트의 구분 탭」)
  const tabbar = el("div", { className: "book-filter-tabbar" });
  const body = el("div", { className: "book-filter-body" });
  const foot = el("div", { className: "book-filter-foot" });
  // 다섯 권을 고르면 보이는 안내(ADR-033 「책은 5권까지」). 대화 상자 안의 상태 줄이라 스크린 리더가 읽는다. 늘 두고 글만 바꾼다:
  // 숨겼다가 보이면 읽지 않는 스크린 리더가 있다.
  const limitNote = el("p", { className: "book-filter-limit", role: "status" });
  const applyBtn = el("button", { type: "button", className: "book-filter-apply" }, "적용");
  foot.appendChild(limitNote);
  foot.appendChild(applyBtn);

  panel.appendChild(resize);
  panel.appendChild(handle);
  panel.appendChild(head);
  panel.appendChild(tabbar);
  panel.appendChild(body);
  panel.appendChild(foot);
  document.body.appendChild(scrim);
  document.body.appendChild(panel);

  /** @type {Set<string>} */
  const working = new Set();
  /** @type {BookFilterTab[]} */
  const tabs = [];
  // The apply label, each tab's count of chosen books, and at the limit the
  // notice plus every unchosen book dimmed and unpressable (`aria-disabled`
  // keeps it focusable and read).
  function syncSelection() {
    applyBtn.textContent = working.size ? `적용 (${working.size})` : "적용";
    // 고른 책이 있는 탭은 이름 뒤에 그 탭의 권수를 보이고, 스크린 리더는 「신약 2권 선택」으로 읽는다(사용자 결정 2026-11-19).
    // 앞의 공백이 있어야 접근 이름이 「신약2권」으로 붙지 않는다.
    for (const t of tabs) {
      const n = t.panel.querySelectorAll('.book-filter-option[aria-selected="true"]').length;
      clearNode(t.count);
      if (n) {
        t.count.appendChild(document.createTextNode(` ${n}`));
        t.count.appendChild(el("span", { className: "sr-only" }, "권 선택"));
      }
    }
    const full = working.size >= MAX_SCOPE_BOOKS;
    limitNote.textContent = full ? SCOPE_LIMIT_NOTE : "";
    // More than the limit (an old or hand-made address): no applying until some are taken out (ADR-033).
    if (working.size > MAX_SCOPE_BOOKS) applyBtn.setAttribute("aria-disabled", "true");
    else applyBtn.removeAttribute("aria-disabled");
    body.querySelectorAll(".book-filter-option").forEach((o) => {
      if (full && o.getAttribute("aria-selected") !== "true") o.setAttribute("aria-disabled", "true");
      else o.removeAttribute("aria-disabled");
    });
  }

  // Show tab `idx`: only it is selected and in the Tab order (roving tabindex,
  // WAI-ARIA tabs), only its panel is shown, the indicator slides under it, and
  // its chips start from the top.
  /** @param {number} idx */
  function showTab(idx) {
    tabs.forEach((t, i) => {
      const on = i === idx;
      t.tab.setAttribute("aria-selected", on ? "true" : "false");
      t.tab.setAttribute("tabindex", on ? "0" : "-1");
      t.tab.classList.toggle("active", on);
      t.panel.hidden = !on;
    });
    const indicator = /** @type {HTMLElement | null} */ (tabbar.querySelector(".division-tab-indicator"));
    if (indicator) indicator.style.transform = `translateX(${idx * 100}%)`;
    body.scrollTop = 0;
  }
  tabbar.addEventListener("click", (e) => {
    const tab = /** @type {Element} */ (e.target).closest(".book-filter-tab");
    const idx = tabs.findIndex((t) => t.tab === tab);
    if (idx < 0) return;
    showTab(idx);
    // Safari does not focus a button on click; focus it so the arrow keys work from the tab just pressed.
    tabs[idx].tab.focus();
  });
  // Arrow keys move to the next / previous tab (wrapping) and show it at once;
  // Home / End go to the first / last tab (WAI-ARIA tabs, automatic activation).
  tabbar.addEventListener("keydown", (e) => {
    const cur = tabs.findIndex((t) => t.tab === document.activeElement);
    if (cur < 0) return;
    let next;
    if (e.key === "ArrowRight") next = (cur + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (cur - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    showTab(next);
    tabs[next].tab.focus();
  });

  const overlay = window.appOverlay.createOverlay({
    panel,
    scrim,
    closeOnEsc: true,
    closeOnOutside: true,
    inertSelectors: SHEET_INERT_SELECTORS,
    initialFocus: () => applyBtn,
    onOpen: () => {
      if (_bookSheetCloseTimer) { clearTimeout(_bookSheetCloseTimer); _bookSheetCloseTimer = null; }
      panel.classList.remove("book-filter-closing"); // cancel any in-flight close anim
    },
    // Animated slide-out (down on mobile, right on the desktop side panel),
    // matching the cite-sheet / drawer pattern. Cleanup is immediate; the panel
    // hides after `.book-filter-closing` plays (350ms fallback), then any
    // drag-resized inline size resets so the next open starts from the default.
    closeTransition: (p, finalizeHide) => {
      p.classList.add("book-filter-closing");
      const done = () => {
        if (_bookSheetCloseTimer) { clearTimeout(_bookSheetCloseTimer); _bookSheetCloseTimer = null; }
        finalizeHide(); // no-op if reopened (seq guard)
        p.classList.remove("book-filter-closing");
        p.style.height = "";
        p.style.width = "";
      };
      p.addEventListener("animationend", done, { once: true });
      _bookSheetCloseTimer = setTimeout(done, 350);
    },
  });
  // 끌어내려도 칩 두 줄이 보이는 높이에서 멈춘다(사용자 결정 2026-11-19, ADR-033 「책 선택 시트의 구분 탭」). 구분 탭 줄이 생겨
  // 화면 높이의 30%로는 칩이 하나도 보이지 않았다. 높이는 놓을 때마다 잰다: 글자 크기를 바꾸면 칩과 머리의 높이가 바뀐다.
  // The fixed rows are summed one by one, not taken as panel minus body: a sheet dragged below them squeezes
  // the body to 0 and the difference would come out short.
  function twoRowsHeight() {
    const opt = /** @type {HTMLElement | null} */ (body.querySelector(".book-filter-panel:not([hidden]) .book-filter-option"));
    if (!opt) return 0;
    const list = /** @type {HTMLElement} */ (opt.closest(".book-filter-list"));
    const rowGap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const bodyStyle = getComputedStyle(body);
    const pad = (parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0);
    let fixed = parseFloat(getComputedStyle(panel).paddingBottom) || 0; // the home-indicator inset
    for (const part of [handle, head, tabbar, foot]) fixed += part.offsetHeight;
    return fixed + pad + 2 * opt.offsetHeight + rowGap;
  }
  window.appOverlay.attachSheetDrag(handle, panel, { onClose: () => overlay.close(), minHeight: twoRowsHeight });
  window.appOverlay.attachSheetResize(resize, panel);
  closeBtn.addEventListener("click", () => overlay.close());

  resetBtn.addEventListener("click", () => {
    working.clear();
    body.querySelectorAll(".book-filter-option").forEach((o) => o.setAttribute("aria-selected", "false"));
    syncSelection();
  });
  applyBtn.addEventListener("click", () => {
    if (applyBtn.getAttribute("aria-disabled") === "true") return;
    const filterBooks = Array.from(working);
    // 「적용」은 시트를 연 입력 칸에 보이는 검색어를 고른 책 안에서 찾는다(ADR-033 D3, 사용자 보고 2026-11-18). Enter를 누르지 않고
    // 친 검색어는 주소에 없으므로 칸에서 읽는다. 읽기는 이동보다 먼저다: route()가 시트를 닫기 전에 칸을 주소의 검색어로 다시 채운다
    // (routing.js의 상단 바 칸).
    // The window may have crossed the mobile layout while the sheet was open (onLayoutTierChange): the field it opened
    // from is then gone (the in-page bar taken out) or hidden (the header field on mobile), and the typed text moved to
    // the field the layout shows now. Read from that one and hand focus back to it.
    const opened = _bookSheetReturnField;
    const field = opened && !isShownSearchField(opened) ? shownSearchField() : opened;
    const typed = field && field.input.isConnected ? field.input.value.trim() : null;
    // `searched`: a keyword reached the URL. A typed `in:<alias>` alone is absorbed into
    // chips and lands on the empty-query view, so it counts as no query for focus.
    // A typed query is committed even when it is the URL's: the search with the
    // new scope goes into the recents with that scope (ADR-014 D1).
    let searched = !!typed;
    if (typed) {
      searched = !!commitTopSearch(typed, { filterBooks, autoNavigate: false });
    } else {
      navigateSearch(typed === "" ? { q: "", filterBooks } : { filterBooks });
    }
    overlay.close();
    // With no query, focus the originating field's input so the user can type
    // the term immediately. The header field survives the re-render, so focus it
    // synchronously within this click. With a query, the input is left unfocused
    // so the keyboard doesn't cover the results — like Enter, which blurs it. The
    // overlay hands focus back to the funnel; the header keeps it, but the mobile
    // in-page bar is rebuilt by the render and its old funnel and input go with it,
    // so that render focuses the new bar's funnel or input (`_inpageFocusAfterRender`).
    // The overlay handed focus back to the funnel that opened the sheet. After a layout change that funnel is gone or
    // hidden and focus stayed in the closing sheet: give it to the shown field's funnel (the render then moves it on).
    if (field && field !== opened) field.funnel.focus();
    if (field && field.container.id === "search-inpage-bar") {
      _inpageFocusAfterRender = { seq: window.routeSeq?.() ?? 0, target: searched ? "funnel" : "input", options: {} };
    } else if (!searched && field && field.input.isConnected) {
      field.input.focus();
    }
  });
  body.addEventListener("click", (e) => {
    const t = /** @type {Element} */ (e.target);
    const row = t.closest(".book-filter-option");
    if (!row) return;
    const id = /** @type {HTMLElement} */ (row).dataset.bookId || "";
    if (working.has(id)) { working.delete(id); row.setAttribute("aria-selected", "false"); }
    else if (working.size >= MAX_SCOPE_BOOKS) return;
    else { working.add(id); row.setAttribute("aria-selected", "true"); }
    syncSelection();
  });

  _bookSheet = { overlay, tabbar, body, working, tabs, syncSelection, showTab };
  return _bookSheet;
}

/** 성시의 책(전례시편과 송가)이 `books.json`에서 가진 구분. 성서 목록의 구분 탭에는 없다(ADR-037 §3). */
const PSALTER_DIVISION = "liturgical";

/**
 * Draw the sheet's tabs and their chip panels for `books`, then show the first
 * tab holding a chosen book, or the first tab when none is chosen (사용자 결정
 * 2026-11-19). Rebuilt on every open: the division set follows the 외경
 * book-order setting, which can change between opens.
 * @param {BookSheet} sheet
 * @param {BooksData} books
 */
function renderBookFilterList(sheet, books) {
  const { tabbar, body, working, tabs } = sheet;
  clearNode(tabbar);
  clearNode(body);
  tabs.length = 0;
  // 성서 목록의 구분 탭 다음, 외경 차례 설정과 상관없이 맨 끝에 성시(전례시편과 송가)다(ADR-046 §2)
  const order = [...window.divisionOrder(), PSALTER_DIVISION];
  /** @type {Record<string, string>} */
  const labels = { ...window.divisionLabels(), [PSALTER_DIVISION]: "성시" };
  // 성서 목록의 구분 탭과 같은 모양(.division-tabs와 미끄러지는 표시)이되, 주소를 바꾸지 않고 시트 안에서 바꾸는 단추다
  const tablist = el("div", { className: "division-tabs book-filter-tabs", role: "tablist", "aria-label": "구분" });
  tablist.appendChild(el("div", { className: "division-tab-indicator", "aria-hidden": "true" }));
  tabbar.appendChild(tablist);
  for (const div of order) {
    const inDiv = books.filter((b) => window.effectiveDivision(b) === div);
    if (!inDiv.length) continue;
    const label = labels[div] ?? div;
    const tabId = `book-filter-tab-${div}`;
    const panelId = `book-filter-panel-${div}`;
    const count = el("span", { className: "book-filter-tab-count" });
    const tab = el("button", {
      type: "button",
      className: "division-tab book-filter-tab",
      role: "tab",
      id: tabId,
      "aria-controls": panelId,
    }, label, count);
    tablist.appendChild(tab);
    const tabPanel = el("div", {
      className: "book-filter-panel",
      role: "tabpanel",
      id: panelId,
      "aria-labelledby": tabId,
    });
    tabs.push({ tab, count, panel: tabPanel });
    const ul = el("ul", {
      className: "book-filter-list",
      role: "listbox",
      "aria-multiselectable": "true",
      "aria-label": label,
    });
    for (const b of inDiv) {
      const li = el("li", { role: "presentation" });
      const opt = el("button", {
        type: "button",
        className: "book-filter-option",
        role: "option",
        "aria-selected": working.has(b.id) ? "true" : "false",
      });
      opt.dataset.bookId = b.id;
      // Chip grid (multi-select): the short name keeps chips compact so a whole
      // division fits in a few wrapped rows instead of a long one-per-row scroll.
      // Selection shows as a filled chip (aria-selected) — no inline check icon.
      opt.appendChild(el("span", { className: "book-filter-name" }, b.short_name_ko || b.name_ko));
      li.appendChild(opt);
      ul.appendChild(li);
    }
    tabPanel.appendChild(ul);
    body.appendChild(tabPanel);
  }
  tablist.style.setProperty("--tab-count", String(tabs.length));
  // No tab row when the book list failed to load: an empty track would be all that shows.
  tabbar.hidden = !tabs.length;
  const firstChosen = tabs.findIndex((t) => t.panel.querySelector('.book-filter-option[aria-selected="true"]'));
  sheet.showTab(Math.max(0, firstChosen));
}

/**
 * Whether `field` is the search field the current layout shows: the mobile in-page bar, or the desktop header field
 * (CSS hides it on mobile).
 * @param {SearchField} field
 */
function isShownSearchField(field) {
  return field.container.isConnected && (field.container.id === "search-inpage-bar") === isMobile();
}

/** The search field the current layout shows, if it is drawn. @returns {SearchField | null} */
function shownSearchField() {
  return _searchFields.find(isShownSearchField) || null;
}

/** @param {HTMLElement} [returnFocusEl] */
async function openBookFilterSheet(returnFocusEl) {
  const sheet = ensureBookSheet();
  // Remember which field's funnel opened this so "적용" can focus its query input.
  _bookSheetReturnField = _searchFields.find((f) => f.funnel === returnFocusEl) || null;
  // Capture the route sequence; if navigation happens during the awaits below,
  // bail before opening so the sheet (scrim + inert) never appears over a newer
  // view — route() can't close a sheet that wasn't open yet (ADR-033, Bugbot).
  const seq = window.routeSeq?.() ?? 0;
  await ensureBookMap();
  const books = await window.loadBooks().catch(() => []);
  if ((window.routeSeq?.() ?? 0) !== seq) return;
  // Reset any inline height left by a prior mobile drag-resize / snap-min so each
  // open starts from the CSS default (ADR-032 cite-sheet reset pattern).
  const panel = document.getElementById("book-filter-sheet");
  if (panel) { panel.style.height = ""; panel.style.width = ""; }
  sheet.working.clear();
  // Only books the sheet shows: an id with no option (a stale or hand-made `?in=`) would count toward the limit
  // with nothing to unselect. When the book list failed to load, keep the scope as it is.
  const shown = new Set(books.map((b) => b.id));
  for (const id of currentSearchState().filterBooks) if (!books.length || shown.has(id)) sheet.working.add(id);
  renderBookFilterList(sheet, books);
  sheet.syncSelection();
  sheet.overlay.open(returnFocusEl || undefined);
}

// ── Recent searches (empty-query /search view) ──
// Apple Safari/App-Store "recents" pattern: a "최근 검색" section with a "지우기"
// (clear-all) action and one row per query (tap to run, trailing × to delete a
// single keyword). Reads the same store as the header dropdown controller; both
// stay in sync via refreshRecents + topSearchHistory.refresh (ADR-014/033).

/** @type {HTMLElement | null} */
let _emptyDynHost = null;

function refreshRecents() {
  if (_emptyDynHost && _emptyDynHost.isConnected) renderEmptyDynamic(_emptyDynHost);
}

/** @returns {HTMLElement | null} */
function buildRecentSearches() {
  const entries = loadSearchHistoryEntries();
  if (!entries.length) return null;
  const wrap = el("section", { className: "search-recents", "aria-label": "최근 검색" });

  const head = el("div", { className: "search-recents-head" });
  head.appendChild(el("h2", { className: "search-recents-title" }, "최근 검색"));
  const clearAll = el("button", { type: "button", className: "search-recents-clear" }, "지우기");
  clearAll.addEventListener("click", () => {
    clearSearchHistory();
    if (topSearchHistory) topSearchHistory.refresh();
    refreshRecents();
  });
  head.appendChild(clearAll);
  wrap.appendChild(head);

  const ul = el("ul", { className: "search-recents-list", role: "list" });
  for (const { q, ts } of entries) {
    const li = el("li", { className: "search-recent-item" });
    const select = el("button", { type: "button", className: "search-recent-select" });
    select.appendChild(svgIcon("search-recent-icon", ["M12 7v5l3 2"], [[12, 12, 8]]));
    select.appendChild(el("span", { className: "search-recent-text" }, q));
    const dateLabel = formatSearchDate(ts);
    if (dateLabel) select.appendChild(el("span", { className: "search-recent-date" }, dateLabel));
    select.addEventListener("click", () => commitTopSearch(q, { fromHistory: true }));
    const remove = el("button", {
      type: "button",
      className: "search-recent-remove",
      "aria-label": `최근 검색어 "${q}" 삭제`,
    });
    remove.appendChild(el("span", { "aria-hidden": "true" }, "×"));
    remove.addEventListener("click", () => {
      removeSearchHistory(q);
      if (topSearchHistory) topSearchHistory.refresh();
      refreshRecents();
    });
    li.appendChild(select);
    li.appendChild(remove);
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  return wrap;
}

// Empty-query body: recent searches if any, else the centered prompt + 검색 방법
// examples. Lives in its own host so recents edits re-render in place without
// rebuilding the input/filter bar (and losing focus).
/** @param {HTMLElement} host */
function renderEmptyDynamic(host) {
  clearNode(host);
  const recents = buildRecentSearches();
  if (recents) {
    host.appendChild(recents);
  } else {
    host.appendChild(buildSearchEmptyState("검색해 보세요", SEARCH_INTRO_HELP));
    host.appendChild(buildSearchExamples(false, currentSearchState().filterBooks.length > 0));
  }
}

// Friendly guidance for the empty-query /search view — mirrors the bookmark
// list's explanatory empty state (BOOKMARK_ADD_HELP), but instead of cramming
// every search form into one run-on sentence it lays them out as a small
// "검색 방법" guide (example query + what it does) that's easier to scan.
const SEARCH_INTRO_HELP = "낱말, 책 이름, 장·절, 전례일 이름으로 찾을 수 있습니다.";

// Each row of the 검색 방법 guide: the example query the user can type + a short
// plain-language description of what that form does. Mirrors the in-field
// placeholder examples (예: 사랑, 사랑 in:요한, 창세 1:3). `창세 1:3` is read on three
// lectionary days, so Enter shows them instead of opening the chapter (ADR-044 §1). The
// zero-result screen leaves out the book scope example (`sansScope`). With a book scope set
// there are no lectionary days, so the lectionary example goes too (`scoped`, ADR-044 §1).
const SEARCH_EXAMPLES = [
  { q: "사랑", desc: "성경 전체에서 낱말 찾기" },
  { q: "사랑 in:요한", desc: "특정 책 안에서만 찾기", scope: true },
  { q: "창세 1:3", desc: "장·절로 구절과 그 구절을 읽는 날 찾기" },
  { q: "성령강림", desc: "전례일 이름으로 찾기", lect: true },
];

// Build the 검색 방법 guide as a definition-style list (example → description).
// Tapping a row fills + commits that example so users can try it without typing.
function buildSearchExamples(sansScope = false, scoped = false) {
  const wrap = el("div", { className: "search-examples" });
  wrap.appendChild(el("p", { className: "search-examples-heading" }, "이렇게 검색해 보세요"));
  const list = el("ul", { className: "search-examples-list", role: "list" });
  for (const { q, desc, scope, lect } of SEARCH_EXAMPLES) {
    if ((sansScope && scope) || (scoped && lect)) continue;
    const item = el("li", { className: "search-example" });
    const btn = el("button", { type: "button", className: "search-example-btn" });
    btn.appendChild(el("code", { className: "search-example-q" }, q));
    btn.appendChild(el("span", { className: "search-example-desc" }, desc));
    btn.addEventListener("click", () => commitTopSearch(q));
    item.appendChild(btn);
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}

// Apple-Music-style centered empty state (ADR-030 P3): large magnifier glyph +
// title + subtitle. Used for the empty-query /search view and zero-result lists.
/**
 * @param {string} title
 * @param {string} subtitle
 * @returns {HTMLElement}
 */
function buildSearchEmptyState(title, subtitle) {
  // Shared empty-state component (ADR-032 / DESIGN.md §6). The magnifier glyph
  // is built as an SVG node (no markup string) so the shared builder stays
  // XSS-free.
  const NS = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(NS, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "1.8");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  const circle = document.createElementNS(NS, "circle");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "6.4");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", "m20 20-3.7-3.7");
  icon.appendChild(circle);
  icon.appendChild(path);
  return emptyState({ icon, title, subtitle });
}

// Empty-query mobile /search: in-page input + search-options bar (book picker)
// + recent searches (or the Apple-Music-style prompt when there's no history).
// Shares the main-header chrome with renderSearchResults. `state.filterBooks`
// keeps a pre-set book scope visible while the query field is empty (ADR-033).
/** @param {{ filterBooks?: string[] }} [state] */
async function renderSearchView(state) {
  const filterBooks = (state && state.filterBooks) || [];
  // Searched with books but no word (ADR-033 「책은 5권까지」): say what is missing above the recents. Taken
  // before the await and only for the address it was asked for, so a view that bails or a later visit never shows it.
  const askKeyword = _askKeywordPath === location.pathname + location.search;
  _askKeywordPath = null;
  // Resolve book names before building the filter bar so pre-set/deep-linked
  // book pills render with names rather than raw ids (ADR-049). Capture the
  // route sequence first and bail if navigation happened during the await, so a
  // late completion never mutates #app over a newer view (ADR-033, Bugbot).
  const seq = window.routeSeq?.() ?? 0;
  await ensureBookMap();
  if ((window.routeSeq?.() ?? 0) !== seq) return;
  window.setTitle("검색");
  const $title = _$("page-title");
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);
  const view = el("div", { className: "search-view" });
  // In-page input on mobile only — desktop uses the header search bar (mirrors
  // renderSearchResults). It never takes focus by itself: the keyboard shows only
  // when the user moves focus there (the bar, or the tab bar's search circle on
  // this screen, ADR-048 §2).
  if (isMobile()) view.appendChild(buildInPageSearchInput(""));
  // The chosen books, names only: nothing searched yet (ADR-049 §5)
  const scopeRow = el("div", { className: "scope-row" });
  view.appendChild(scopeRow);
  drawScopeRow(scopeRow, "", filterBooks);
  if (askKeyword) view.appendChild(el("p", { className: "search-note search-keyword-note" }, KEYWORD_NOTE));
  const dyn = el("div", { className: "search-empty-dynamic" });
  view.appendChild(dyn);
  $app.appendChild(view);
  if (askKeyword) window.announce(KEYWORD_NOTE);
  // Filters surface as in-field tokens now (ADR-033 개정 B) — the book scope is
  // visible/removable in the mobile in-page bar or the desktop header field.
  // Sync after the view is connected so a deep-linked scope resolves names.
  syncSearchFields();
  // The bar's ⊗ or the book sheet's 「적용」 drew this view: focus the new bar's funnel or input (after the sync above shows
  // the token zone). A pill's × drew it: focus the next pill's × (ADR-049 §3).
  focusRebuiltInpageBar(view, seq);
  focusRebuiltScopeRow(view, seq);
  _emptyDynHost = dyn;
  renderEmptyDynamic(dyn);
}

// How long the results wait for the lectionary days while the worker still loads the lectionary index (ADR-044 §1).
// A cached index arrives at once; three seconds only run out on a first download or a slow network.
const LECTIONARY_WAIT_MS = 3000;

// ── BEGIN PAGE_SIZE ──
// Exercised by tests/unit/search.test.js (barBottom and window stubbed).
// The page size of the search on screen. Estimated from the viewport height below the top bar (helpers.js barBottom:
// #app-header alone left out the status-bar inset, which is padding on #sticky-group), then kept while the user pages
// through the same search (its words and books): a page starts at (page - 1) × size, so a size estimated again for page 2
// after the window changed size skipped or repeated results (#618 review). A new search estimates it again.
/** @type {{ key: string, size: number } | null} */
let _searchPageSize = null;

/** @param {string} query @param {string[]} filterBooks @returns {number} */
function searchPageSize(query, filterBooks) {
  const key = JSON.stringify([query, filterBooks]);
  if (_searchPageSize && _searchPageSize.key === key) return _searchPageSize.size;
  const availH = window.innerHeight - barBottom() - 40;
  const itemH = 80;
  const size = Math.max(5, Math.floor(availH / itemH));
  _searchPageSize = { key, size };
  return size;
}
// ── END PAGE_SIZE ──

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 * @param {{ filterBooks?: string[], group?: "psalter" | "lectionary" | null, book?: string | null }} [opts]
 *   filterBooks — book-picker scope (book ids), from the URL via parsePath (ADR-033).
 *   group — the chosen result pill (ADR-044 §1, ADR-046 §3); 성서 본문 when absent.
 *   book — the chosen book pill within the scope (ADR-049 §2); 「전체」 when absent.
 */
async function renderSearchResults(query, page, autoNavigate = false, opts = {}) {
  const filterBooks = opts.filterBooks || [];
  const state = { q: query, page, filterBooks };

  // Resolve book names before any DOM mutation so deep-linked/restored `in=`
  // book pills render with names rather than raw ids (ADR-049). Capture the
  // route sequence and bail if navigation happened during the await, so a late
  // completion never clears/builds over a newer view (ADR-033, Bugbot).
  const seq = window.routeSeq?.() ?? 0;
  const isStale = () => (window.routeSeq?.() ?? 0) !== seq;
  await ensureBookMap();
  if (isStale()) return;

  window.setTitle(`"${query}" 검색`);
  const $title = _$("page-title");
  // Like every other main-header view, plant the mobile settings trigger so the
  // gear stays reachable if the window is resized down to the mobile breakpoint
  // while on this page (where #header-actions with #settings-anchor is hidden).
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);

  // Both layouts share the .search-view wrapper. Filters (book scope) live as
  // in-field tokens in the search field itself (ADR-033 개정 B):
  // the mobile in-page bar / desktop header field. Results
  // render into their own box so re-rendering them never touches the field.
  const view = el("div", { className: "search-view" });
  if (isMobile()) view.appendChild(buildInPageSearchInput(query));
  // The chosen books under the field (ADR-049 §1): names now, each book's count once the search ends
  const scopeRow = el("div", { className: "scope-row" });
  view.appendChild(scopeRow);
  drawScopeRow(scopeRow, query, filterBooks);
  const resultsTarget = el("div", { className: "search-view-results" });
  view.appendChild(resultsTarget);
  $app.appendChild(view);
  // Sync the header/in-page fields' funnel for this scope (after view is connected).
  syncSearchFields();
  // The book sheet's 「적용」 searched from this bar: focus its new funnel (after the sync above shows the token zone).
  // A pill's × searched again: focus the next pill's × (ADR-049 §3).
  focusRebuiltInpageBar(view, seq);
  focusRebuiltScopeRow(view, seq);

  resultsTarget.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  const pageSize = searchPageSize(query, filterBooks);

  // Pagination links must carry the active book filters (ADR-033) and stay in the group shown (ADR-046 §3); the
  // closure binds the current state so renderSearchResultList stays filter-agnostic.
  const paginationBuilder = (/** @type {string} */ _q, /** @type {number} */ p, /** @type {number} */ t,
    /** @type {SearchGroup} */ group, /** @type {string | null} */ book) => buildSearchPagination({ ...state, group, book }, p, t);

  /** @type {SearchScreen} */
  const screen = {
    group: opts.group === "psalter" || opts.group === "lectionary" ? opts.group : "bible",
    groupHref: (g) => buildSearchUrl({ q: query, filterBooks, group: g }),
    chapterCount: (id) => _chapterCounts.get(id) ?? null,
    readingLabel: () => null,
    scoped: filterBooks.length > 0,
    days: null,
    today: "",
    // 카드에서 소속교회를 등록한 뒤 다시 그린 같은 검색이면 한 번 알린다
    picked: _pickedParish && _pickedParish.q === query ? _pickedParish.name : null,
  };
  _pickedParish = null;
  /** @param {any} res */
  const draw = (res) => renderSearchResultList(resultsTarget, res, query, page, pageSize, paginationBuilder, screen);

  /** @param {any} partial */
  function onPartial(partial) {
    // Drop in-flight partials once the user navigated away — resultsTarget is
    // detached and announcing a stale query would mislead AT (ADR-033, Bugbot).
    if (isStale() || !resultsTarget.isConnected) return;
    draw(partial);
    // 성서 묶음을 받는 동안에도 안내 카드의 단추가 동작하게 한다
    wireLocalNotice(resultsTarget, query);
    window.announce(partialAnnouncement(query, partial));
  }

  // 성탄 평일의 화면 이름(「성탄 1주 수요일」)은 해마다 바뀌어 색인에 없다. 이런 검색어를 받았는데 워커가 오늘 계산한 이름을 모르면
  // 엔진으로 계산해 보낸 뒤 찾는다(ADR-044 §3). 전례일을 기다리는 같은 3초 안에서 기다리고(여기서 쓴 시간을 그 3초에서 뺀다), 교회력
  // 자료를 내려받지 못했거나 3초 안에 다 받지 못했으면 그 뒤로는 기다리지 않는다. 기다리지 않을 때도 받기는 다시 시작하거나 이어 가,
  // 다 받으면 다음 검색부터 그 이름으로 찾는다(코드 리뷰 2026-11-16, 11-17). 내려받지 못한 교회력 자료는 다음 호출에 다시 받는다
  // (`ensureEngine`, 엔진 `preloadCalendar`).
  let namesWaited = 0;
  if (!filterBooks.length && query.includes("성탄") && !looksLikeYearQuery(query) && !christmasNamesFresh()) {
    const sending = ensureEngine()
      .then(async (mod) => {
        if (!mod) return false;
        await sendChristmasNames(mod, todayOf(mod));
        return true;
      })
      .catch((err) => {
        console.warn("성탄 평일의 이름을 계산하지 못했습니다", err);
        return false;
      });
    if (!_christmasNamesFailed) {
      const start = Date.now();
      const sent = await withinMs(sending, LECTIONARY_WAIT_MS);
      if (sent !== true) _christmasNamesFailed = true;
      namesWaited = Date.now() - start;
      if (isStale()) return;
    }
  }

  const result = await doSearch(query, page, pageSize, onPartial, { scopeBooks: filterBooks, showBook: opts.book || null });

  // A book after `in:` the worker does not know, or more books than one search
  // takes, only gets a notice (ADR-005, ADR-033), so the line the commit kept for
  // this search goes again (ADR-014 D1). The worker decides, so this holds before
  // the app's alias map loads and without search-meta.json too. Before the stale
  // check: it is about the search run.
  const committed = takeCommittedSearch(query, filterBooks);
  const searchedNothing = !!result && ((result.unmatchedScopes && result.unmatchedScopes.length > 0) || !!result.tooManyBooks);
  if (committed && searchedNothing) {
    removeSearchHistory(committed);
    if (topSearchHistory) topSearchHistory.refresh();
  }

  // Bail if the user navigated away while the search was running — the captured
  // resultsTarget is stale and #app belongs to a newer view now (ADR-033, Bugbot).
  if (isStale()) return;

  if (!result) {
    window.renderError("검색에 실패했습니다.");
    return;
  }

  // The worker is still loading the lectionary index: wait for its days, the reading notations and the day each row
  // opens, up to LECTIONARY_WAIT_MS in all and draw once (ADR-044 §1). Past that, draw what came: passage rows fall back
  // to the index's numbers, rows get their day later (`patchLectDays`), and days that come later are added to the
  // drawn results (`addLateLectionary`).
  const deadline = Date.now() + LECTIONARY_WAIT_MS - namesWaited;
  // The liturgical engine holds the reading notations. Alongside the index, not after it, for a passage. Not when no
  // lectionary days can come (a book scope, no index): the engine's data is about 1.5 MB.
  if (result.refMatch && (result.lectionaryPending || shownLectionary(result))) ensureEngine();
  const waitedOut = result.lectionaryPending ? !(await takeLateLectionary(result, Math.max(0, deadline - Date.now()))) : false;
  if (isStale()) return;
  await withReadingLabels(result, screen, deadline - Date.now());
  if (isStale()) return;
  await withYearRows(result, screen, isStale);
  if (isStale()) return;

  // Enter opens the chapter at once only when there is nothing to choose from (ADR-044 §1, §2): a verse reference read
  // on no lectionary day, or a book name alone with no results at all. A reference across chapters never navigates:
  // the app can't tell which chapter to open first (ADR-005). A chapter the book does not have is told on this screen.
  if (autoNavigate) {
    const target = autoNavigateTarget(result, screen);
    if (target) {
      dismissLaunchScreen();
      history.replaceState(null, "", target);
      window.route();
      return;
    }
  }

  // 전례일 줄을 그릴 때만 날짜를 기다린다. 「성서 본문」 묶음만 보이면 기다리지 않고 계산만 시작해, 「전례일」 알약을 누르면 곧 나온다
  const lateDays = await withLectDays(result, screen, resultGroups(result, screen).group === "lectionary" ? deadline : Date.now(), isStale);
  if (isStale()) return;

  // Each chosen book's count on its pill (ADR-049 §2)
  drawScopeRow(scopeRow, query, filterBooks, result);
  window.announce(draw(result));
  wireLocalNotice(resultsTarget, query);
  // 카드에서 등록한 뒤면 누른 단추가 사라졌으므로, 새로 생긴 소속교회의 축성일 줄로 포커스를 옮긴다
  // 축성일 줄이 없거나(축복일만 있는 교회) 성서 본문 묶음이 보이면 맨 위의 「소속교회로 등록했습니다」 줄로 옮긴다
  if (screen.picked) {
    const row = /** @type {HTMLElement | null} */ (resultsTarget.querySelector('.lect-rows a.cal-row[href*="obs=my-dedication"]'));
    const note = /** @type {HTMLElement | null} */ (resultsTarget.querySelector(".search-note"));
    if (row) row.focus();
    else if (note) {
      note.tabIndex = -1;
      note.focus();
    }
  }
  dismissLaunchScreen();
  // Instant, not the root's smooth scroll: when a page link led here, the router then keeps that link where it was
  // on screen (routing.js restoreFocusSpot), and a smooth scroll still running would carry it off afterwards.
  window.scrollTo({ top: 0, behavior: "instant" });

  // Not awaited: route() (routing.js) awaits this function, and its ending (page meta, page view, tab history, focus)
  // must not wait for the late days or a late index.
  if (lateDays) {
    const labelOf = screen.readingLabel;
    lateDays.later.then(() => {
      const lect = shownLectionary(result);
      if (lect && !isStale() && resultsTarget.isConnected) patchLectDays(resultsTarget, lect, screen, labelOf);
    }).catch((err) => console.warn("전례일 줄에 날짜를 넣지 못했습니다", err));
  }
  if (waitedOut) addLateLectionary(result, query, screen, resultsTarget, isStale, draw);
}

/**
 * 3초가 지나 온 전례일을 결과에 더하고, 찾은 것이 있을 때만 알린다(ADR-044 §1). 이미 그린 결과는 지우지 않는다. 결과를 옮겨 다니던
 * 키보드 포커스와 읽던 자리를 지키려는 것이다(WCAG 2.4.3). 성서 본문이나 성시의 목록이 있으면 그 위의 알약만 바꾸고(보던 묶음을 고른
 * 채다, ADR-046 §3), 답 카드만 있으면 그 아래에 전례일 묶음을 단다. 결과 없음 화면이었으면 다시 그린다.
 * @param {any} result
 * @param {string} query
 * @param {SearchScreen} screen
 * @param {HTMLElement} target
 * @param {() => boolean} isStale
 * @param {(res: any) => string} draw
 */
async function addLateLectionary(result, query, screen, target, isStale, draw) {
  if (!(await takeLateLectionary(result, Infinity)) || isStale() || !target.isConnected) return;
  await withYearRows(result, screen, () => isStale() || !target.isConnected);
  if (isStale() || !target.isConnected) return;
  const lect = shownLectionary(result);
  const late = result.lectionary && result.lectionary.localNotice ? localNoticeOf(result.lectionary.localNotice, churchName) : null;
  if (!lect) {
    // 연도를 붙여 찾은 전례일을 그해에 지키지 않으면 결과 없음 화면에 그 사정을, 지역 축일을 찾지 못했으면 그 안내를 적는다(ADR-044 §3, §4)
    // 성서 본문이나 성시의 목록이 있으면 다시 그리지 않는다. 다시 그리면 목록에 있던 포커스를 잃는다(WCAG 2.4.3)
    if ((lectNotes(result).length || late) && !result.total && !shownPsalter(result) && !target.querySelector(".search-answer")) {
      window.announce(draw(result));
    } else if (late) {
      target.prepend(buildLocalNotice(late));
      window.announce(`"${query}" ${late.text}`);
    }
    wireLocalNotice(target, query);
    return;
  }
  // 이미 그린 결과 위에 지역 축일 안내를 더한다(그리면 결과의 맨 위다)
  if (late) {
    target.prepend(buildLocalNotice(late));
    wireLocalNotice(target, query);
  }
  await withReadingLabels(result, screen, 0);
  if (isStale() || !target.isConnected) return;
  // 전례일 줄을 그릴 때(성서 본문이나 성시의 목록이 없을 때)는 날짜를 3초까지 기다려 날짜 차례로 그린다(ADR-044 §1). 그린 뒤 날짜가 와서
  // 다시 늘어놓으면 정렬 알림(`LECT_RESORTED_NOTE`)이 바로 앞의 「더 찾았습니다」 알림을 덮는다. 알약만 더할 때는 기다리지 않는다
  const drawsRows = !target.querySelector("h2.search-count");
  const lateDays = await withLectDays(result, screen, Date.now() + (drawsRows ? LECTIONARY_WAIT_MS : 0),
    () => isStale() || !target.isConnected);
  if (isStale() || !target.isConnected) return;
  const labelOf = screen.readingLabel;
  lateDays?.later.then(() => {
    if (!isStale() && target.isConnected) patchLectDays(target, lect, screen, labelOf);
  }).catch((err) => console.warn("전례일 줄에 날짜를 넣지 못했습니다", err));
  const heading = target.querySelector("h2.search-count");
  if (heading) {
    const { groups, counts, group } = resultGroups(result, screen);
    // 그려 둔 목록의 묶음. 주소가 전례일을 골랐으면 전례일이 오기 전에는 결과가 있는 첫 묶음을 그렸다
    const shown = group === "lectionary" ? groups[0] : group;
    const pills = buildSearchPills(shown, counts, screen.groupHref);
    // 성서 본문과 성시의 알약이 이미 있으면 그 끝에 전례일 알약만 더한다. 알약에 있던 포커스가 남는다
    const drawn = target.querySelector(".search-pills");
    const lectPill = pills.querySelector(".search-pills")?.lastElementChild;
    if (drawn && lectPill) drawn.appendChild(lectPill);
    else heading.before(pills);
  } else if (target.querySelector(".search-answer")) {
    // 책 이름만 친 검색어의 「…성서 본문, 성시, 전례일은 없습니다」는 이제 사실이 아니다
    for (const note of target.querySelectorAll(".search-note")) note.remove();
    appendLectGroup(target, lect, screen);
  } else {
    draw(result);
    // 다시 그리면 위에서 동작을 단 카드가 새 카드로 바뀐다
    wireLocalNotice(target, query);
  }
  window.announce(`"${query}" ${lectGroupName(lect)} ${lect.items.length}건을 더 찾았습니다`);
}

/**
 * Put the late `lectionary` message of `result`'s search into it. Resolves false when none came within `ms`.
 * @param {any} result
 * @param {number} ms
 * @returns {Promise<boolean>}
 */
async function takeLateLectionary(result, ms) {
  const msg = await nextLectionary(result.searchId, ms);
  if (!msg) return false;
  result.lectionary = msg.lectionary;
  result.lectionaryPending = false;
  return true;
}

/**
 * Passage rows show each reading's notation from the reading data, which the liturgical engine holds (ADR-044 §1). Waits
 * for the engine at most `ms` (0: only if already loaded); without it the rows use the index's numbers, and nothing
 * redraws when it comes later.
 * @param {any} result
 * @param {SearchScreen} screen
 * @param {number} ms
 */
async function withReadingLabels(result, screen, ms) {
  const lect = shownLectionary(result);
  if (!lect || lect.kind !== "passage") return;
  const mod = _engineMod || (await withinMs(ensureEngine(), ms));
  if (mod) screen.readingLabel = (setId, slot) => mod.readingLabel(setId, slot);
}

/**
 * Where Enter goes without showing the results (ADR-044 §1, §2), or null to show them.
 * @param {any} result
 * @param {SearchScreen} screen
 * @returns {string | null}
 */
function autoNavigateTarget(result, screen) {
  if (shownLectionary(result)) return null;
  if (result.refMatch) {
    const targets = verseRefTargets(result.refMatch);
    if (targets.length !== 1) return null;
    const count = screen.chapterCount(result.refMatch.bookId);
    return count !== null && targets[0].chapter > count ? null : targets[0].path;
  }
  if (result.bookOnly && result.total === 0 && !shownPsalter(result)) return `/${result.bookOnly.bookId}/1`;
  return null;
}

// ── Search input event handlers (Desktop inline) ──

// Search is Enter-triggered only — live (debounced) search interfered with
// multi-token queries like `사랑 in:요한`, where each intermediate keystroke
// fired a useless substring search. searchAutoNavigate stays as a flag so
// renderSearchResults can distinguish Enter-confirmed searches (auto-navigate
// to verse references) from URL-triggered ones (show clickable card).
let searchAutoNavigate = false;

// The address whose empty search view asks for a word to search: a search with
// books but none (`goSearch`). Taken once by renderSearchView.
/** @type {string | null} */
let _askKeywordPath = null;
const KEYWORD_NOTE = "검색어를 입력해주세요.";

// The recent-search line the last commit kept, with the search it ran
// (`commitTopSearch`). The results of that search take it once.
/** @type {{ q: string, books: string, label: string } | null} */
let _committedSearch = null;

/**
 * The recent-search line kept for this search by the commit that ran it, or
 * null (a search from the URL, back navigation, a later commit). Taken once.
 * @param {string} query @param {string[]} filterBooks
 * @returns {string | null}
 */
function takeCommittedSearch(query, filterBooks) {
  const c = _committedSearch;
  if (!c || c.q !== query || c.books !== filterBooks.join(" ")) return null;
  _committedSearch = null;
  return c.label;
}

/**
 * @param {string} rawQuery
 * @param {{ filterBooks?: string[], autoNavigate?: boolean, fromHistory?: boolean }} [opts]
 *   filterBooks — the book scope to search in, in place of the URL's (the book sheet's 「적용」, ADR-033 D3).
 *   autoNavigate — false keeps a verse reference on the results (only Enter may jump to the chapter, ADR-033 D3).
 *   fromHistory — `rawQuery` is a recent-search label: search its own `in:` scope in place of the chosen books (ADR-014 D2).
 * @returns {string} the committed keyword (empty when nothing was committed or only `in:` scope remained)
 */
function commitTopSearch(rawQuery, opts = {}) {
  const raw = (rawQuery || "").trim();
  // A fresh query keeps the book-picker scope (union in: tokens) but resets
  // pagination (ADR-033). A recent search carries its own scope: its in: tokens
  // replace the chosen books, and one without any searches the whole Bible (ADR-014 D2).
  /** @type {string[]} */
  const scope = opts.fromHistory ? [] : (opts.filterBooks || currentSearchState().filterBooks);
  if (!raw) {
    // Enter on an empty field with books chosen: ask for a word (ADR-033 「책은 5권까지」).
    if (scope.length) goSearch("", scope, true);
    return "";
  }
  // Absorb typed/example `in:<alias>` operators into the chosen books (pills) so the
  // operator doesn't linger as raw text in the field (token UI). The alias map
  // is preloaded at boot (ensureAliasMap kick at module init), so this stays
  // SYNCHRONOUS — no await, hence no stale/race surface to guard (the async
  // version needed routeSeq guards for each edge). If the map isn't ready yet
  // (cold start) or an alias is unknown, the in: token simply stays in `q` and
  // the worker still scopes the results from it (graceful, ADR-033 개정 B).
  let keyword = raw;
  /** @type {string[]} */
  let ids = [];
  if (_aliasMap && /(?:^|\s)in:/.test(raw)) {
    ({ keyword, ids } = extractInScope(raw, _aliasMap));
  }
  let filterBooks = ids.length ? Array.from(new Set(scope.concat(ids))) : scope;
  // No sixth book from a typed `in:` (ADR-033 「책은 5권까지」): past the limit the
  // tokens stay text in the query, the worker counts them with the chosen books,
  // searches nothing and says so. Known here, so the search is not kept (ADR-014 D1).
  const tooManyBooks = filterBooks.length > MAX_SCOPE_BOOKS;
  if (tooManyBooks && ids.length) {
    keyword = raw;
    filterBooks = scope;
  }
  // The recent-search label holds the scope searched, chosen books included (ADR-014
  // D1). A scope-only commit has nothing to search and is not kept. A replayed
  // label written another way (an older `in:요한복음`) gives way to the new one.
  // The worker may still answer that a book after `in:` is unknown: the results
  // then drop this line again (`takeCommittedSearch`, ADR-014 D1).
  if (keyword) {
    if (opts.fromHistory) removeSearchHistory(raw);
    if (!tooManyBooks) {
      const label = historyLabel(keyword, filterBooks, _aliasById);
      pushSearchHistory(label);
      _committedSearch = { q: keyword, books: filterBooks.join(" "), label };
    }
    if (topSearchHistory) topSearchHistory.refresh();
  }
  // Arm verse-ref auto-navigate only when there's a keyword to search; a
  // scope-only commit (in: absorbed → empty keyword) lands on the empty-query
  // view, which never consumes the flag (would leave it stale — Bugbot).
  searchAutoNavigate = opts.autoNavigate !== false && !!keyword;
  // Books but no word to search (`in:마르` alone): ask for one (ADR-033 「책은 5권까지」).
  goSearch(keyword, filterBooks, !keyword && filterBooks.length > 0);
  return keyword;
}

/**
 * Go to the search for `q` within `filterBooks`, page 1. `askKeyword`: the empty
 * view says 「검색어를 입력해주세요.」 (renderSearchView takes it once).
 * @param {string} q @param {string[]} filterBooks @param {boolean} askKeyword
 */
function goSearch(q, filterBooks, askKeyword) {
  const newPath = buildSearchUrl({ q, page: 1, filterBooks });
  _askKeywordPath = askKeyword ? newPath : null;
  // If path is unchanged, popstate won't fire — call route() directly.
  if (location.pathname + location.search === newPath) {
    window.route();
  } else {
    window.navigate(newPath);
  }
}

$searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Defer to active history option if the panel is open with one selected.
  if (topSearchHistory && topSearchHistory.consumeEnter(e)) return;
  e.preventDefault();
  commitTopSearch($searchInput.value);
});

$searchInput.addEventListener("input", () => {
  const has = !!$searchInput.value.trim();
  $searchClear.hidden = !has;
  $searchBar.dataset.clearHidden = String(!has);
});

$searchClear.addEventListener("click", () => {
  $searchInput.value = "";
  $searchClear.hidden = true;
  $searchBar.dataset.clearHidden = "true";
  $searchInput.focus();
  // Mirror the in-page clear: on /search, drop the query (back to the empty/
  // recents view) but keep the book-picker scope so clearing the field doesn't
  // silently reset the filter or exit search to "/" (ADR-033, Bugbot).
  if (window.parsePath().view === "search") navigateSearch({ q: "" });
});

// ── BEGIN IS_MOBILE ──
function isMobile() {
  // The small layout (ADR-050 §2): the app's area narrower than 700px or lower than 600px, whatever the device. It is
  // the exact complement of helpers.js LARGE_LAYOUT_QUERY, the condition CSS hides the header search field with, so
  // the page always shows exactly one search field.
  return isSmallLayout();
}
// ── END IS_MOBILE ──

// ── Search history panel controller ──
// One instance per anchor (top header + sheet). Exposes `refresh()` for
// callers that mutate history, `consumeEnter(e)` so the input's existing
// Enter handler can defer to an active history option when the panel is
// open with one selected, and `syncToggleVisibility()` so callers can
// re-evaluate the ▾ button's hidden state after external changes.
// ── BEGIN HISTORY_CONTROLLER ──
// Exercised by tests/unit/search.test.js. Self-contained controller factory
// that wires DOM elements (toggle/panel/input/wrap/clearBtn) to the history
// state stored via window.appStorage's loadSearchHistory / removeSearchHistory
// / clearSearchHistory. Returns an object with open/close/refresh/isOpen/
// syncToggleVisibility/consumeEnter. Test loader provides a richer DOM
// stub (querySelectorAll/contains/closest/focus) than the rest of search.js.
/**
 * @typedef {object} SearchHistoryControllerOptions
 * @property {HTMLElement} wrap  the field's wrapper — carries `data-history-hidden`
 * @property {HTMLInputElement} input
 * @property {HTMLElement} toggle  the ▾ button
 * @property {HTMLElement} panel  the listbox the history renders into
 * @property {HTMLElement | null} [clearBtn]
 * @property {(q: string) => void} onSelect
 * @property {(hidden: boolean) => void} syncClearHidden
 * @property {() => void} [onChange]  after a delete / clear-all, so the on-page recents list follows
 */
/** @param {SearchHistoryControllerOptions} options */
function createSearchHistoryController({ wrap, input, toggle, panel, clearBtn, onSelect, syncClearHidden, onChange }) {
  let activeIndex = -1;
  let _expanded = false;  // "더 보기" pressed in this session — reset on close

  function visibleCount() {
    return _expanded ? SEARCH_HISTORY_MAX : SEARCH_HISTORY_VISIBLE;
  }

  function syncToggleVisibility() {
    const has = loadSearchHistory().length > 0;
    toggle.hidden = !has;
    wrap.dataset.historyHidden = String(!has);
  }

  function isOpen() { return !panel.hidden; }

  function updateActive() {
    const opts = panel.querySelectorAll(".search-history-item-select");
    opts.forEach((o, i) => o.setAttribute("aria-selected", i === activeIndex ? "true" : "false"));
    if (activeIndex < 0 || activeIndex >= opts.length) {
      input.removeAttribute("aria-activedescendant");
    } else {
      input.setAttribute("aria-activedescendant", opts[activeIndex].id);
      opts[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function render() {
    const list = loadSearchHistory();
    const limit = visibleCount();
    const visible = list.slice(0, limit);
    const hidden = list.length - visible.length;
    clearNode(panel);
    visible.forEach((q, i) => {
      const optId = `${panel.id}-opt-${i}`;
      const row = el("div", { className: "search-history-item" });
      const select = el("button", {
        type: "button",
        id: optId,
        role: "option",
        className: "search-history-item-select",
        "aria-selected": "false",
        tabindex: "-1",
      }, q);
      select.dataset.query = q;
      const remove = el("button", {
        type: "button",
        className: "search-history-item-remove",
        "aria-label": `최근 검색어 "${q}" 삭제`,
        tabindex: "-1",
      });
      remove.dataset.removeQuery = q;
      remove.appendChild(el("span", { "aria-hidden": "true" }, "×"));
      row.appendChild(select);
      row.appendChild(remove);
      panel.appendChild(row);
    });
    if (hidden > 0) {
      const more = el("button", {
        type: "button",
        className: "search-history-more",
        tabindex: "-1",
      }, `더 보기 (${hidden}개)`);
      more.dataset.showMore = "true";
      panel.appendChild(more);
    }
    if (list.length >= 3) {
      const clearAll = el("button", {
        type: "button",
        className: "search-history-clear",
        tabindex: "-1",
      }, "모두 지우기");
      clearAll.dataset.clearAll = "true";
      panel.appendChild(clearAll);
    }
    if (activeIndex >= visible.length) activeIndex = visible.length - 1;
    updateActive();
  }

  function open() {
    if (!loadSearchHistory().length) return;
    activeIndex = -1;
    render();
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-expanded", "true");
  }

  /** @param {{ restoreFocus?: boolean }} [opts] */
  function close(opts = {}) {
    const { restoreFocus } = opts;
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-expanded", "false");
    activeIndex = -1;
    _expanded = false;
    input.removeAttribute("aria-activedescendant");
    if (restoreFocus) input.focus({ preventScroll: true });
  }

  function refresh() {
    syncToggleVisibility();
    if (isOpen()) {
      if (!loadSearchHistory().length) close();
      else render();
    }
  }

  function expandMore() {
    _expanded = true;
    render();
  }

  /** @param {number} delta */
  function moveActive(delta) {
    const list = loadSearchHistory();
    if (!list.length) return;
    const limit = visibleCount();
    const visible = Math.min(list.length, limit);
    if (activeIndex < 0) {
      activeIndex = delta > 0 ? 0 : visible - 1;
      updateActive();
      return;
    }
    const next = activeIndex + delta;
    // Auto-expand when ↓ would walk past the last visible item.
    if (next >= visible && list.length > visible && !_expanded) {
      expandMore();
      activeIndex = next;
      updateActive();
      return;
    }
    activeIndex = (next + visible) % visible;
    updateActive();
  }

  /** @param {string} q */
  function pickQuery(q) {
    input.value = q;
    if (clearBtn) clearBtn.hidden = false;
    syncClearHidden(false);
    close();
    onSelect(q);
  }

  toggle.addEventListener("pointerdown", (e) => {
    // Keep input focused so the on-screen keyboard doesn't flicker.
    e.preventDefault();
  });
  toggle.addEventListener("click", () => {
    if (isOpen()) close({ restoreFocus: true });
    else { open(); input.focus({ preventScroll: true }); }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      if (!isOpen()) {
        if (!loadSearchHistory().length) return;
        open();
      }
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      if (!isOpen()) return;
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  panel.addEventListener("pointerdown", (e) => {
    // Don't let the input lose focus when tapping inside the panel.
    e.preventDefault();
  });
  panel.addEventListener("click", (e) => {
    // A click inside the panel always targets an element. Cast, not `instanceof`: the unit harness
    // (search.test.js) dispatches stub elements that are no `Element`.
    const t = /** @type {Element} */ (e.target);
    const remove = /** @type {HTMLElement | null} */ (t.closest(".search-history-item-remove"));
    if (remove) {
      e.preventDefault();
      e.stopPropagation();
      removeSearchHistory(remove.dataset.removeQuery ?? "");
      refresh();
      // Keep the on-page /search recents list (if shown) in sync with a delete
      // made from this dropdown (ADR-033, Bugbot).
      if (onChange) onChange();
      return;
    }
    const more = t.closest(".search-history-more");
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      expandMore();
      return;
    }
    const clearAllBtn = t.closest(".search-history-clear");
    if (clearAllBtn) {
      e.preventDefault();
      e.stopPropagation();
      clearSearchHistory();
      refresh();
      if (onChange) onChange();
      input.focus({ preventScroll: true });
      return;
    }
    const select = /** @type {HTMLElement | null} */ (t.closest(".search-history-item-select"));
    if (select) {
      e.preventDefault();
      e.stopPropagation();
      pickQuery(select.dataset.query ?? "");
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!isOpen()) return;
    const t = /** @type {Node | null} */ (e.target);  // same harness reason as the panel click above
    if (panel.contains(t) || toggle.contains(t) || input.contains(t)) return;
    close();
  });

  return {
    open,
    close,
    isOpen,
    refresh,
    syncToggleVisibility,
    /** @param {KeyboardEvent} e */
    consumeEnter(e) {
      if (!isOpen() || activeIndex < 0) return false;
      const opts = /** @type {NodeListOf<HTMLElement>} */ (panel.querySelectorAll(".search-history-item-select"));
      const target = opts[activeIndex];
      if (!target) return false;
      e.preventDefault();
      e.stopPropagation();
      pickQuery(target.dataset.query ?? "");
      return true;
    },
  };
}
// ── END HISTORY_CONTROLLER ──

const topSearchHistory = createSearchHistoryController({
  wrap: $searchBar,
  input: $searchInput,
  toggle: $searchHistoryToggle,
  panel: $searchHistoryPanel,
  clearBtn: $searchClear,
  syncClearHidden: (hidden) => { $searchBar.dataset.clearHidden = String(hidden); },
  onSelect: (q) => commitTopSearch(q, { fromHistory: true }),
  // Header-dropdown deletes/clear should also refresh the on-page /search
  // recents list when it's mounted (ADR-033, Bugbot).
  onChange: () => refreshRecents(),
});
topSearchHistory.syncToggleVisibility();

// Mount in-field tokens on the persistent search fields (ADR-033 개정 B). The
// mobile in-page bar mounts on build (buildInPageSearchInput).
mountSearchField($searchBar, $searchInput);
// Preload the in:<alias> map (from prefetched books) so commitTopSearch can
// absorb operators synchronously — keeps commit free of an async race surface.
ensureAliasMap();

// ── Crossing the layout condition on the search view ──
// The search view is drawn for one layout: the mobile in-page bar at its top, or the desktop header field and no bar
// (ADR-048 §1). When the app's area crosses LARGE_LAYOUT_QUERY (ADR-050 §2; `isMobile` reads its complement and CSS
// hides the header field with it), put the bar in or take it out instead of drawing the view
// again, so the results, the scroll position and text typed but not searched yet all stay. The typed text, and focus
// if it was in the old field, move to the field the new layout shows. A bare /search is the recents view on mobile but
// the book list on desktop (routing.js), so there the view is drawn again and the typed text carried over.

/** Show `typed` in the desktop header field, with its clear button when there is text (as route() sets it). */
function setHeaderField(/** @type {string} */ typed) {
  $searchInput.value = typed;
  const hidden = !typed.trim();
  $searchClear.hidden = hidden;
  $searchBar.dataset.clearHidden = String(hidden);
}

// The search field that lost focus because the new layout hid it. The browser drops focus from a field that stops
// being rendered, before the media query's change event runs (Chrome: focusout with no related target, then resize,
// then change), so the handler can't see that focus was there. A field the user leaves is still rendered at focusout.
/** @type {Element | null} */
let _fieldHiddenWithFocus = null;
document.addEventListener("focusin", () => { _fieldHiddenWithFocus = null; });
document.addEventListener("focusout", (e) => {
  _fieldHiddenWithFocus = null;
  const t = e.target;
  if (e.relatedTarget !== null || !(t instanceof Element)) return;
  const field = t.closest("#search-bar, #search-inpage-bar");
  if (field && t.getClientRects().length === 0) _fieldHiddenWithFocus = field;
});

async function onLayoutTierChange() {
  const hiddenWithFocus = _fieldHiddenWithFocus;
  _fieldHiddenWithFocus = null;
  const p = window.parsePath();
  if (p.view !== "search") return;
  const mobile = isMobile();
  const bar = document.getElementById("search-inpage-bar");
  const barInput = document.getElementById("search-inpage-input");
  // The field the old layout showed: the header field before going mobile, the in-page bar before going desktop.
  const oldField = mobile ? $searchBar : bar;
  const typed = mobile ? $searchInput.value : (barInput instanceof HTMLInputElement ? barInput.value : "");
  const at = document.activeElement;
  const hadFocus = !!oldField && (oldField.contains(at) || ((!at || at === document.body) && hiddenWithFocus === oldField));
  if (mobile && topSearchHistory.isOpen()) topSearchHistory.close();
  const view = $app.querySelector(":scope > .search-view");
  if (view && (p.query || p.filterBooks.length)) {
    if (mobile && !bar) view.insertBefore(buildInPageSearchInput(typed), view.firstChild);
    if (!mobile) bar?.remove();
    setHeaderField(mobile ? "" : typed);
    syncSearchFields();
  } else {
    await window.route();
    if (window.parsePath().view !== "search" || isMobile() !== mobile) return;
    if (mobile) {
      const input = document.getElementById("search-inpage-input");
      const clear = document.getElementById("search-inpage-clear");
      if (input instanceof HTMLInputElement) input.value = typed;
      if (clear) clear.hidden = !typed.trim();
    } else {
      setHeaderField(typed);
    }
  }
  if (!hadFocus) return;
  const input = mobile ? document.getElementById("search-inpage-input") : $searchInput;
  if (input instanceof HTMLElement) input.focus({ preventScroll: true });
}
if (typeof window.matchMedia === "function") {
  window.matchMedia(LARGE_LAYOUT_QUERY).addEventListener("change", () => { void onLayoutTierChange(); });
}


// ── BEGIN AUTO_NAVIGATE ──
// Read-and-reset helper for app.js's route() handler. `searchAutoNavigate`
// is set in commitTopSearch before the URL change; route() then consumes
// it to decide whether a verse-reference match should auto-navigate. The
// flag is search-internal state, so app.js drives the consume via this
// helper instead of touching the variable directly.
//
// Exercised by tests/unit/search.test.js with a prelude that declares
// `let searchAutoNavigate;` and a tiny setter for arrange-stage flips.
function consumeSearchAutoNavigate() {
  const v = searchAutoNavigate;
  searchAutoNavigate = false;
  return v;
}
// ── END AUTO_NAVIGATE ──

// Window facade for legacy app.js callers (route handler invokes
// renderSearchResults / renderSearchView / isMobile / consumeSearchAutoNavigate,
// chapter renderer calls highlightTextNodes for ?hl= highlighting).
// 검색 입력 칸이 검색을 커밋할 때 쓴다(상단 바, 휴대폰의 위쪽 입력창).
window.commitTopSearch = commitTopSearch;
window.renderSearchResults = renderSearchResults;
window.renderSearchView = renderSearchView;
// Refresh in-field search tokens (book scope) from the URL —
// called by route() (ADR-033 개정 B).
window.syncSearchFields = syncSearchFields;
// Patch the search URL preserving the rest of the state — the in-page bar's
// clear and the book sheet use it to drop the query while KEEPING the book
// scope (ADR-033 개정 B, Bugbot).
window.navigateSearch = navigateSearch;
window.isMobile = isMobile;
window.highlightTextNodes = highlightTextNodes;
window.consumeSearchAutoNavigate = consumeSearchAutoNavigate;

export {
  renderSearchResults, renderSearchView,
  isMobile, highlightTextNodes, consumeSearchAutoNavigate,
};
