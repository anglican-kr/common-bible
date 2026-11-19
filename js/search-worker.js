// @ts-check
"use strict";

/*
 * Global search Web Worker — chunked index edition
 *
 * Protocol:
 *   Main → Worker:
 *     { type: "init", metaUrl: "data/search-meta.json", booksUrl: "data/books.json",
 *       chunks: [{ name, url }, ...],
 *       lectionaryUrl: "data/lectionary/search-lectionary.json",
 *       localUrl: "data/lectionary/local-observances.json" }
 *       — booksUrl: the book list, read for the 송가 names only (`titles`, ADR-047 §5). Optional: without it, or
 *         when it fails, 송가 results carry no name.
 *       — lectionaryUrl is optional: without it the worker never loads the
 *         lectionary index and `lectionary` stays null (ADR-044).
 *       — localUrl is optional: the parish table, loaded with the lectionary index.
 *         Without it (or when it fails) there are no local days (ADR-044 §3).
 *     { type: "search", q: "keyword", page: 1, pageSize: 50, searchId: N,
 *       scopeBooks: ["john", ...], parish: "jqdnsv" }
 *       — scopeBooks: structured book filter (book ids) from the book picker,
 *         merged with any typed `in:<alias>` tokens (ADR-033).
 *       — parish: the church id of the user's parish, "" when none (ADR-041 §6).
 *         The name search adds its local days (ADR-044 §3).
 *     { type: "lect-names", names: [[setId, name], ...] }
 *       — this liturgical year's names of the Christmas weekdays (「성탄 1주 수요일」),
 *         which change every year and so are not in the index. The name search finds
 *         them like aliases from the next search on (ADR-044 §3).
 *
 *   Worker → Main:
 *     { type: "ready" }
 *     { type: "partial-results", searchId, q, results, total, psalter, page, pageSize,
 *       loadedChunks: [...names], pendingChunks: [...names],
 *       bookOnly, lectionary }
 *     { type: "results", searchId, q, refMatch, results, total, psalter, page, pageSize,
 *       bookOnly, lectionary, lectionaryPending }
 *     { type: "lectionary", searchId, q, lectionary }
 *     { type: "error", message }
 *       — bookOnly: the query is a book name alone ({ bookId, bookNameKo }) or null,
 *         book scope or not. A verse reference comes first: `요1` alone is John 1,
 *         not 1 John (ADR-044 §2).
 *       — results / total: the Bible's verses. psalter: { results, total }, the verses of
 *         the 성시 chunk (전례시편, 송가), cut to the same page — the page is the one of the
 *         group the app shows (ADR-046 §3). The 성시 chunk is optional: when it fails to
 *         load the Bible is searched alone and the next search fetches it again.
 *       — lectionary: the lectionary days found (LectResult) or null — no index, a
 *         book scope is set (ADR-044 §1), nothing to search for, or searching the
 *         index failed. A search never waits for the index: while it is still
 *         loading, "results" carries lectionaryPending: true and a "lectionary"
 *         message with the same searchId follows once it arrives (lectionary null
 *         if loading failed or timed out). A newer search drops it.
 */

/**
 * @typedef BookMeta
 * @property {string} ko
 *
 * @typedef SearchMeta
 * @property {{ [alias: string]: string }} aliases
 * @property {{ [bookId: string]: BookMeta }} books
 *
 * @typedef LoadedChunk
 * @property {string[]} books
 * @property {Uint16Array} bArr
 * @property {Uint16Array} cArr
 * @property {Uint16Array} vArr
 * @property {string[]} tArr
 * @property {string[]} [nArr]  tArr normalized for matching (normalizeForMatch), built on first search
 *
 * @typedef RawChunkPayload
 * @property {string[]} books
 * @property {Array<[number, number]>} b
 * @property {number[]} c
 * @property {number[]} v
 * @property {string[]} t
 *
 * @typedef ChunkConfig
 * @property {string} name
 * @property {string} url
 *
 * @typedef VerseRefPart
 * @property {number} chapter
 * @property {string} verses  as typed, spaces and half-verse marks dropped: "16", "18-19,16".
 *   An end of 999 runs to the end of the chapter: "10-999", the whole chapter "1-999".
 * @property {string} [title]  the chapter's own name — a 송가 (「즈가리야 송가」, ADR-046 §4)
 *
 * @typedef VerseRef
 * @property {string} bookId
 * @property {string} bookNameKo
 * @property {VerseRefPart[]} parts  one per chapter, in the order first named
 *
 * @typedef ParsedQuery
 * @property {string} keyword
 * @property {Set<string>} restrictBooks
 * @property {string[]} unmatched
 *
 * @typedef MatchedRow
 * @property {string} b
 * @property {number} c
 * @property {number} v
 * @property {string} t
 *
 * @typedef PaginatedResult
 * @property {Array<MatchedRow & { bookNameKo: string, title?: string }>} results  title: the chapter's own name (송가)
 * @property {number} total
 *
 * @typedef InitMessage
 * @property {"init"} type
 * @property {string} metaUrl
 * @property {string} [booksUrl]
 * @property {ChunkConfig[]} chunks
 * @property {string} [lectionaryUrl]
 * @property {string} [localUrl]
 *
 * @typedef SearchMessage
 * @property {"search"} type
 * @property {string} q
 * @property {number} page
 * @property {number} pageSize
 * @property {number} searchId
 * @property {string[]} [scopeBooks]
 * @property {string} [parish]
 *
 * @typedef LectNamesMessage  오늘부터 한 해 안에 오는 성탄 평일의 화면 이름(ADR-044 §3). 해마다 바뀌어 색인에 없으므로 앱이 교회력 엔진으로 계산해 보낸다.
 * @property {"lect-names"} type
 * @property {Array<[string, string]>} names  [독서 세트 id, 이름(「성탄 1주 수요일」)]
 *
 * @typedef {InitMessage | SearchMessage | LectNamesMessage} IncomingMessage
 */

/**
 * 전례독서 검색 색인 `lectionary/search-lectionary.json`(ADR-037 §5). 데이터 저장소의
 * `liturgical/build_lectionary_search.py`가 만든다.
 *
 * @typedef LectObsRaw  전례일 하나
 * @property {string} key
 * @property {string} name
 * @property {string[]} aliases
 * @property {string} kind  "temporal" | "sanctoral"
 * @property {string | null} date  월별 축일의 날짜("01.25")
 * @property {string | null} rank
 * @property {number} order  전례년 순서
 * @property {string | null} common  고유 독서 없이 쓰는 공통 독서의 분류
 *
 * @typedef {[number, string, string | null, number | null, number, string]} LectSetRaw
 *   [obs, set id, year, track, set no, label]
 * @typedef {[number, number, number, number, number, number]} LectCovRaw
 *   [set, book, chapter, first verse, last verse, slot] — slot 0 first reading, 1 psalm, 2 second reading, 3 gospel
 *
 * @typedef LectSaintRaw
 * @property {string} name
 * @property {string} title
 * @property {number[]} obs
 *
 * @typedef LectionaryRaw
 * @property {LectObsRaw[]} obs
 * @property {LectSetRaw[]} sets
 * @property {LectCovRaw[]} cov
 * @property {string[]} books
 * @property {LectSaintRaw[]} saints
 * @property {{ [other: string]: string }} synonyms  키는 다른 교회의 이름, 값은 앱의 이름
 *
 * @typedef LectSynonym
 * @property {string} from
 * @property {string} to
 * @property {string} fromKey  normalizeLectName(from)
 * @property {string} toKey  normalizeLectName(to)
 *
 * @typedef LectionaryIndex  the raw index regrouped for searching (buildLectionarySearchIndex)
 * @property {LectObsRaw[]} obs
 * @property {LectSetRaw[]} sets
 * @property {LectCovRaw[]} cov
 * @property {string[]} books
 * @property {string[][]} obsKeys  per obs: its name, then its aliases, normalized
 * @property {Array<{ title: string, keys: string[], obs: number[] }>} saints  keys: name and title, normalized
 * @property {LectSynonym[]} synonyms  longest `fromKey` first
 * @property {number[][]} setsOfObs
 * @property {Map<string, number>} obsOfSet  set id → obs
 * @property {Map<string, number[]>} covOfBook  book id → cov rows
 * @property {Map<number, number[]>} covOfReading  set * 4 + slot → cov rows
 * @property {LocalIndex | null} local  the parish table for local days (ADR-044 §3), null when it was not loaded
 *
 * @typedef LocalParish  본당 표(`local-observances.json`)의 교회 하나
 * @property {string} name
 * @property {string} base  normalizeLectName(name) without a final 「성당」 or 「교회」
 * @property {string} churchId
 * @property {"consecration" | "blessing"} kind
 * @property {string} date  「MM.DD」
 * @property {string | null} diocese
 * @property {string | null} color
 * @property {string | null} rank
 *
 * @typedef LocalFounding  설립일 하나(관구, 교구)
 * @property {string} name
 * @property {string} date  「MM.DD」
 * @property {number | null} year
 *
 * @typedef LocalIndex
 * @property {LocalParish[]} parishes  in table order, former northern churches (「북.」) left out
 * @property {LocalFounding[]} dioceses
 * @property {LocalFounding | null} province
 *
 * @typedef LocalNotice  지역 축일을 찾지 못했을 때 결과 위에 두는 안내(ADR-044 §3)
 * @property {"consecration" | "blessing" | "noParish"} kind  다른 본당의 축성일, 축복일만 있는 본당, 소속교회를 등록하지 않음
 * @property {string | null} name
 * @property {string | null} date  「MM.DD」
 * @property {string | null} churchId  그 본당의 교회 식별자. 소속교회로 등록하는 단추가 쓴다
 * @property {"consecration" | "blessing" | null} mine  소속교회가 있으면 그 교회의 종류(축성일이 있는가), 없으면 null
 *
 * @typedef LectSetInfo
 * @property {string} id
 * @property {string | null} year  "A" | "B" | "C" (주일 주기), "I" | "II" (평일 주기), null
 * @property {number | null} track
 * @property {number} setNo
 * @property {string} label
 *
 * @typedef LectObsInfo
 * @property {string} key
 * @property {string} name
 * @property {string} kind
 * @property {string | null} date
 * @property {string | null} rank
 * @property {string | null} common
 * @property {number} order
 *
 * @typedef LectReadingHit  찾은 독서 하나. 같은 독서를 읽는 주기와 트랙은 `sets`에 함께 둔다(설계 §5.3).
 * @property {number} slot  0 first reading, 1 psalm, 2 second reading, 3 gospel
 * @property {Array<[string, number, number, number]>} rows  the whole reading: [book id, chapter, first verse, last verse]
 * @property {LectSetInfo[]} sets
 * @property {boolean} full  the reading holds every verse of the query
 * @property {number} overlap  how many verses of the query it holds
 *
 * @typedef LectItem  결과 행 하나는 전례일 하나다(설계 §4.2).
 * @property {LectObsInfo} obs
 * @property {LectSetInfo[]} sets  all its reading sets; none when it has no readings of its own
 * @property {LectReadingHit[]} [hits]  passage search: the readings that matched, best first
 * @property {number} [tier]  name search: 1 the whole name, 2 its start, 3 inside it (설계 §4.3)
 * @property {string} [matched]  name search: the alias or saint title that matched, when the name itself did not
 * @property {{ level: "dedication" | "diocese" | "province", color: string | null, year: number | null }} [local]
 *   a local day (ADR-044 §3): the user's parish dedication or a founding day. Its obs key is `local:<level>`
 * @property {string[]} [yearNames]  year search: a Christmas weekday found only by the names it may take (「성탄 1주 수요일」).
 *   The app keeps a year's row only when that year's name of the day is one of them (ADR-044 §4)
 *
 * @typedef LectResult
 * @property {"name" | "passage"} kind
 * @property {LectItem[]} items
 * @property {Array<{ from: string, to: string }>} synonyms  name search: the replacements that found something
 * @property {LectYears} [years]  name search with a year (`2027년 성 니콜라`): the years to show (ADR-044 §4)
 * @property {LocalNotice | null} [localNotice]  name search: the notice above the results when no local day was found
 *
 * @typedef LectYears  연도를 붙인 이름 검색의 해(양력, ADR-044 §4)
 * @property {number} from
 * @property {number} to
 * @property {boolean} capped  the range was longer than LECT_YEAR_SPAN and was cut to its first years
 */

/** @type {SearchMeta | null} */
let meta = null;
/** @type {Promise<void> | null} */
let metaPromise = null;
/** @type {string | null} */
let metaUrl = null;
/** @type {string | null} */
let booksUrl = null;
// 송가 이름(「모세송가」) — books.json 송가 항목의 `titles`, 책 id마다. 앱은 송가 이름을 이 파일에서만 읽는다(ADR-047 §5).
/** @type {{ [bookId: string]: { [chapter: string]: string } }} */
let chapterTitles = {};

/** @type {{ [name: string]: LoadedChunk }} */
let loadedChunks = {};
/** @type {{ [name: string]: Promise<void> }} */
let loadingPromises = {};
/** @type {ChunkConfig[]} */
let chunkConfig = [];

let currentSearchId = 0;

/** @type {string | null} */
let lectionaryUrl = null;

/** 본당 표(지역 축일, ADR-044 §3)의 주소. 전례독서 색인과 함께 받는다. @type {string | null} */
let localUrl = null;

/** Bumped by each `init` that changes lectionaryUrl, so a request for an older address leaves the state alone. */
let lectionaryGen = 0;

/** @type {Promise<LectionaryIndex | null> | null} */
let lectionaryPromise = null;

/** @type {LectionaryIndex | null} */
let lectionary = null;

/** 오늘부터 한 해 안에 오는 성탄 평일의 화면 이름(`lect-names` 메시지). 이름 검색이 별칭처럼 함께 찾는다(ADR-044 §3). @type {Array<[string, string]>} */
let lectExtraNames = [];

/** performance.now() before which a failed lectionary index is not fetched again: elapsed time, so changing the
 * device clock does not stretch the wait. */
let lectionaryRetryAt = 0;

/** 전례독서 색인을 받지 못했을 때 다시 받아 보기까지의 시간. 검색마다 다시 받지 않게 하려는 것이다. */
const LECTIONARY_RETRY_MS = 60000;

/** 전례독서 색인을 기다리는 가장 긴 시간. 요청이 끝나지 않고 멈추면 이 시간 뒤에 받지 못한 것으로 본다. */
const LECTIONARY_TIMEOUT_MS = 30000;

/**
 * @param {string} type
 * @param {Record<string, unknown>} payload
 */
function post(type, payload) {
  postMessage(Object.assign({ type }, payload));
}

// ── Meta loading ──

/** @returns {Promise<void>} */
async function loadMeta() {
  if (meta) return;
  if (metaPromise) return metaPromise;
  // metaUrl is set by the "init" message before loadMeta() ever runs.
  const url = /** @type {string} */ (metaUrl);
  const metaFetch = fetch(url).then((r) => {
    if (!r.ok) throw new Error("meta 로드 실패: " + r.status);
    return r.json();
  });
  // 송가 이름은 books.json에서 읽는다(ADR-047 §5). 받지 못해도 검색은 하고, 송가 결과에 이름만 없다.
  const titlesFetch = booksUrl
    ? fetch(booksUrl)
      .then((r) => (r.ok ? r.json() : []))
      .then((/** @type {Array<{ id: string, titles?: { [chapter: string]: string } }>} */ books) =>
        Object.fromEntries(books.filter((b) => b.titles).map((b) => [b.id, /** @type {{ [chapter: string]: string }} */ (b.titles)])))
      .catch(() => ({}))
    : Promise.resolve({});
  metaPromise = Promise.all([metaFetch, titlesFetch]).then(([data, titles]) => {
    chapterTitles = titles;
    meta = /** @type {SearchMeta} */ (data);
  });
  return metaPromise;
}

// ── Chunk loading ──

/**
 * @param {string} name
 * @param {string} url
 * @returns {Promise<void>}
 */
function loadChunk(name, url) {
  if (name in loadedChunks) return Promise.resolve();
  if (name in loadingPromises) return loadingPromises[name];

  loadingPromises[name] = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${name} 청크 로드 실패: ${r.status}`);
      return r.json();
    })
    .then((/** @type {RawChunkPayload} */ data) => {
      const n = data.t.length;
      // Expand RLE [[bookIdx, count], ...] into a flat Uint16Array
      const bArr = new Uint16Array(n);
      let pos = 0;
      for (const [idx, cnt] of data.b) {
        bArr.fill(idx, pos, pos + cnt);
        pos += cnt;
      }
      loadedChunks[name] = {
        books: data.books,
        bArr,
        cArr: new Uint16Array(data.c),
        vArr: new Uint16Array(data.v),
        tArr: data.t,
      };
    });
  // 성시 색인(ADR-046)은 받지 못해도 성서 검색을 막지 않는다. 앱을 고친 뒤 처음 하는 오프라인 검색에는 이 색인이
  // 아직 기기에 없다. 다음 검색이 다시 받는다(`ensureChunks`).
  if (PSALTER_CHUNKS.has(name)) {
    loadingPromises[name] = loadingPromises[name].catch((err) => {
      console.warn("성시 색인을 받지 못했습니다", err);
      delete loadingPromises[name];
    });
  }
  return loadingPromises[name];
}

/** Starts loading every chunk not loaded or loading — the first time, and again for an optional chunk that failed. */
function ensureChunks() {
  for (const { name, url } of chunkConfig) loadChunk(name, url);
}

// ── Lectionary index loading ──

/**
 * 전례독서 색인을 받는다(ADR-044). 받지 못하면 `null`이다. 그때는 성서 검색만 하고 전례독서 결과는 비운다
 * (설계 `docs/design/lectionary-search.md` §3). 실패와 `LECTIONARY_TIMEOUT_MS` 안에 끝나지 않은 요청은 콘솔에
 * 남기고, `LECTIONARY_RETRY_MS`가 지난 뒤의 검색에서 다시 받아 본다. 받는 사이에 `init`이 주소를 바꿨으면 옛 요청은
 * 지금 상태를 고치지 않는다(`lectionaryGen`).
 * @returns {Promise<LectionaryIndex | null>}
 */
function loadLectionary() {
  if (lectionary) return Promise.resolve(lectionary);
  if (lectionaryPromise) return lectionaryPromise;
  if (!lectionaryUrl || performance.now() < lectionaryRetryAt) return Promise.resolve(null);
  const gen = lectionaryGen;
  // The signal also stops a body that stalls after the headers came.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LECTIONARY_TIMEOUT_MS);
  // 본당 표는 함께 받되 받지 못해도 색인은 쓴다. 그때는 지역 축일이 없다
  const local = localUrl
    ? fetch(localUrl, { signal: controller.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    : Promise.resolve(null);
  lectionaryPromise = Promise.all([fetch(lectionaryUrl, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`전례독서 색인 로드 실패: ${r.status}`);
      return r.json();
    }), local])
    .then(([/** @type {LectionaryRaw} */ raw, localRaw]) => {
      const index = buildLectionarySearchIndex(raw);
      index.local = buildLocalIndex(localRaw);
      if (gen === lectionaryGen) {
        lectionary = index;
        lectionaryPromise = null;
      }
      return index;
    })
    .catch((err) => {
      console.warn("전례독서 색인을 받지 못했습니다", err);
      if (gen === lectionaryGen) {
        lectionaryRetryAt = performance.now() + LECTIONARY_RETRY_MS;
        lectionaryPromise = null;
      }
      return null;
    })
    .finally(() => clearTimeout(timer));
  return lectionaryPromise;
}

/**
 * 전례독서를 찾지 않는 결과의 칸. 책을 골라 두었거나(책 칩은 성서 본문을 찾을 범위다, ADR-044 §1) 찾을 검색어가
 * 없을 때다.
 */
const NO_LECTIONARY = { lectionary: null, lectionaryPending: false };

/**
 * 찾다가 오류가 나면 전례독서만 비우고 콘솔에 남긴다. 성서 결과와 구절 바로가기는 그대로 보낸다. 배포 직후에는 옛
 * 워커 파일이 새 형식의 색인을 읽을 수 있다. 서비스 워커가 워커 파일과 데이터를 다른 캐시에 두기 때문이다.
 * @param {(index: LectionaryIndex) => LectResult} find
 * @param {LectionaryIndex} index
 * @returns {LectResult | null}
 */
function findLectionary(find, index) {
  try {
    return find(index);
  } catch (err) {
    console.warn("전례독서 색인으로 찾지 못했습니다", err);
    return null;
  }
}

/**
 * 결과 메시지의 전례독서 칸. 검색은 색인을 기다리지 않는다. 색인이 있으면 바로 찾는다. 받는 중이면 비워 둔 채
 * `lectionaryPending`을 달고, 색인이 오면 전례독서를 따로 보낸다(`sendLectionaryLater`). 그래서 성서 결과와 구절
 * 바로가기가 색인 때문에 늦지 않는다.
 * @param {number} searchId
 * @param {string} q
 * @param {(index: LectionaryIndex) => LectResult} find
 * @returns {{ lectionary: LectResult | null, lectionaryPending: boolean }}
 */
function lectionaryFields(searchId, q, find) {
  if (lectionary) return { lectionary: findLectionary(find, lectionary), lectionaryPending: false };
  if (!lectionaryUrl || performance.now() < lectionaryRetryAt) return NO_LECTIONARY;
  sendLectionaryLater(searchId, q, find);
  return { lectionary: null, lectionaryPending: true };
}

/**
 * 색인이 오면 그 검색의 전례독서를 같은 `searchId`의 `lectionary` 메시지로 보낸다. 그사이 새 검색이 시작됐으면
 * 보내지 않는다. 그사이 `init`이 색인 주소를 바꿨으면 새 주소의 색인을 기다린다.
 * @param {number} searchId
 * @param {string} q
 * @param {(index: LectionaryIndex) => LectResult} find
 */
function sendLectionaryLater(searchId, q, find) {
  const gen = lectionaryGen;
  loadLectionary().then((index) => {
    if (searchId !== currentSearchId) return;
    if (gen !== lectionaryGen) {
      sendLectionaryLater(searchId, q, find);
      return;
    }
    post("lectionary", { searchId, q, lectionary: index && findLectionary(find, index) });
  });
}

// ── Search helpers ──

// ── BEGIN SEARCH_PURE ──
// Pure search logic — query parsing (in:<book> operator), verse-ref detection,
// substring matching, pagination. Depend only on module state (meta /
// loadedChunks), no worker globals — sliced + unit-tested in
// tests/unit/search-worker.test.js with stubbed meta/loadedChunks.

// Verse reference: a book, then chapters ("시편 116", "시편 42, 43") or chapters and verses ("창세 1:3-11",
// "요한 3:16, 18-19", "사무상 18:6-9, 19:1-7", "이사 61:10-62:3").
// 쉼표는 검색어 전체가 이 형식일 때만 구분자다. 낱말 검색에서는 본문 글자로 남는다. 절 뒤의 「상」 「하」 「ㄱ」 「ㄴ」과
// 로마자는 절의 반쪽 표시라 지우고 절 전체를 연다(ADR-005 「구절 표기와 구절 바로가기」, 사용자 결정 2026-11-07).
// Numbers stop at three digits, like the address check (ADR-040): that bounds the chapters a range can span, and keeps
// this linear on a long run of digits.
const REF_NUM = "\\d{1,3}";
const REF_DASH = "\\s*[-–]\\s*";
const REF_VERSE = `${REF_NUM}[상하ㄱㄴa-z]?`;
const REF_POINT = `(?:${REF_NUM}\\s*:\\s*)?${REF_VERSE}`;
const REF_RANGE = `${REF_POINT}(?:${REF_DASH}${REF_POINT})?`;
const REF_VERSES = `${REF_NUM}\\s*:\\s*${REF_VERSE}(?:${REF_DASH}${REF_POINT})?(?:\\s*,\\s*${REF_RANGE})*`;
const REF_CHAPTERS = `${REF_NUM}(?:\\s*,\\s*${REF_NUM})*`;
const REF_RE = new RegExp(`^([가-힣a-zA-Z0-9\\s]+?)\\s*(${REF_VERSES}|${REF_CHAPTERS})\\s*$`);
// The end of a range that runs to the end of its chapter: the largest number an address takes (the highest verse
// number is 176). The chapter view clips it to the chapter's last verse. js/app/search.js verseRefTargets reads it too.
const REF_CHAPTER_END = 999;
// More segments than a reference can mean: the longest book has 150 chapters, and a lectionary label has at most 5
// segments. A long enough list otherwise builds a million segments that the app sorts on the main thread.
const REF_MAX_SEGMENTS = 200;

// Operator: in:<book-alias>  (one or more, OR'd). Greedy on alias to allow
// hangul/letters/digits without spaces. Whitespace between `in:` and the
// alias is ignored (`사랑 in: 요한` works the same as `사랑 in:요한`).
const IN_RE = /(?:^|\s)in:\s*(\S+)/g;

// 한 번에 고를 수 있는 책의 수(ADR-033 「책은 5권까지」). 책 칩과 `in:`을 합쳐 센다. js/app/search.js에도
// 같은 값이 있고(책 선택 시트), tests/unit/search.test.js가 둘이 같은지 본다.
const MAX_SCOPE_BOOKS = 5;

// 성시(전례시편과 송가)의 색인. 그 결과는 성서 본문과 따로 센다(ADR-046 §3). js/app/search.js가 `init` 메시지에
// 이 이름으로 보낸다.
const PSALTER_CHUNKS = new Set(["lit"]);

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
 * @param {string} raw
 * @returns {ParsedQuery}
 */
function parseQuery(raw) {
  /** @type {Set<string>} */
  const restrictBooks = new Set();
  /** @type {string[]} */
  const unmatched = [];
  // parseQuery is only called after loadMeta() resolves, so meta is non-null. lookupBook reads own keys only:
  // `in:constructor` is an unknown alias, not a book.
  const stripped = raw.replace(IN_RE, (_, alias) => {
    const id = lookupBook(alias);
    if (id) restrictBooks.add(id);
    else unmatched.push(alias);
    return " ";
  }).replace(/\s+/g, " ").trim();
  return { keyword: stripped, restrictBooks, unmatched };
}

/**
 * One end of a range: "18", "19:1상".
 * @param {string} text
 * @returns {{ chapter: number | null, verse: number }}
 */
function refPoint(text) {
  const m = /** @type {RegExpExecArray} */ (/(?:(\d+)\s*:\s*)?(\d+)/.exec(text));
  return { chapter: m[1] ? parseInt(m[1], 10) : null, verse: parseInt(m[2], 10) };
}

/**
 * The chapters and verses REF_RE matched, one part per chapter. A range or verse with no chapter of its own belongs to
 * the chapter the one before it ended in ("9:35-10:1, 5-8" → 10:5-8). null when it names no real span: chapter 0, a
 * range with an end of verse 0 (a lone verse 0 still opens the chapter), a range that ends in an earlier chapter, or
 * more than REF_MAX_SEGMENTS segments.
 * @param {string} body
 * @returns {VerseRefPart[] | null}
 */
function refParts(body) {
  /** @type {Map<number, string[]>} */
  const byChapter = new Map();
  let segmentCount = 0;
  /** @param {number} chapter @param {string} segment */
  const add = (chapter, segment) => {
    segmentCount++;
    const segments = byChapter.get(chapter);
    if (segments) segments.push(segment);
    else byChapter.set(chapter, [segment]);
  };
  if (body.includes(":")) {
    let chapter = 0;
    for (const item of body.split(",")) {
      const [from, to] = item.split(/[-–]/).map(refPoint);
      chapter = from.chapter ?? chapter;
      const endChapter = to ? to.chapter ?? chapter : chapter;
      if (!to) {
        add(chapter, `${from.verse}`);
      } else if (endChapter < chapter || from.verse === 0 || to.verse === 0) {
        return null;
      } else if (endChapter === chapter) {
        add(chapter, `${from.verse}-${to.verse}`);
      } else {
        add(chapter, `${from.verse}-${REF_CHAPTER_END}`);
        for (let c = chapter + 1; c < endChapter; c++) add(c, `1-${REF_CHAPTER_END}`);
        add(endChapter, `1-${to.verse}`);
        chapter = endChapter;
      }
      if (segmentCount > REF_MAX_SEGMENTS) return null;
    }
  } else {
    for (const item of body.split(",")) add(parseInt(item, 10), `1-${REF_CHAPTER_END}`);
  }
  if (byChapter.has(0) || segmentCount > REF_MAX_SEGMENTS) return null;
  return [...byChapter].map(([chapter, segments]) => ({ chapter, verses: segments.join(",") }));
}

/**
 * @param {string} query
 * @returns {VerseRef | null}
 */
function tryVerseRef(query) {
  const match = query.match(REF_RE);
  if (!match) return null;

  const bookId = lookupBook(match[1]);
  if (!bookId) return null;

  const parts = refParts(match[2]);
  const m = /** @type {SearchMeta} */ (meta);
  return parts && { bookId, bookNameKo: m.books[bookId].ko, parts: parts.map((p) => withChapterTitle(bookId, p)) };
}

/**
 * The chapter's own name, for a book whose chapters are named rather than numbered — 송가 (「즈가리야 송가」, ADR-046
 * §4; books.json `titles`, ADR-047 §5). null for every other book.
 * @param {string} bookId
 * @param {number} chapter
 * @returns {string | null}
 */
function chapterTitle(bookId, chapter) {
  const titles = chapterTitles[bookId];
  return titles && Object.hasOwn(titles, String(chapter)) ? titles[String(chapter)] : null;
}

/**
 * @template {{ chapter: number }} T
 * @param {string} bookId
 * @param {T} part
 * @returns {T & { title?: string }}
 */
function withChapterTitle(bookId, part) {
  const title = chapterTitle(bookId, part.chapter);
  return title ? { ...part, title } : part;
}

/**
 * The book id a name stands for: an alias, the alias lowercased (English ids, "GEN" → "gen" — a no-op on Hangul), or
 * a full Korean name. Runs of spaces count as one (`요한  1서`). Own keys only, so `constructor` is not a book.
 * 구절 표기(`tryVerseRef`), 책 이름만 친 검색어(`tryBookOnly`), `in:` 별칭(`parseQuery`)이 같은 규칙으로 책을 찾는다.
 * @param {string} name
 * @returns {string | null}
 */
function lookupBook(name) {
  const key = name.trim().replace(/\s+/g, " ");
  const m = /** @type {SearchMeta} */ (meta);
  /** @param {string} k */
  const alias = (k) => (Object.hasOwn(m.aliases, k) ? m.aliases[k] : undefined);
  let bookId = alias(key) || alias(key.toLowerCase());
  if (!bookId) {
    for (const [id, info] of Object.entries(m.books)) {
      if (info.ko === key) { bookId = id; break; }
    }
  }
  return bookId && Object.hasOwn(m.books, bookId) ? bookId : null;
}

/**
 * 검색어 전체가 책 이름 하나인가(`창세기`, `요한`, `요한 1서`). 앱은 결과 맨 위에 그 책의 첫 장 바로가기를 둔다
 * (ADR-044 §2). 한 글자 약칭(`말`, `신`, `나`)은 책 이름으로 읽지 않는다. 낱말로 더 자주 쓰이기 때문이다. 워커는
 * 구절 표기를 먼저 판별하므로, 숫자로 끝나는 약칭(`요1`)을 혼자 치면 여기까지 오지 않고 요한 복음 1장이 된다.
 * 송가는 첫 송가의 이름(`title`)을 함께 넘긴다(ADR-046 §4).
 * @param {string} query  the keyword, `in:<alias>` tokens already stripped
 * @returns {{ bookId: string, bookNameKo: string, title?: string } | null}
 */
function tryBookOnly(query) {
  if (Array.from(query.trim().replace(/\s+/g, " ")).length < 2) return null;
  const bookId = lookupBook(query);
  const m = /** @type {SearchMeta} */ (meta);
  if (!bookId) return null;
  const title = chapterTitle(bookId, 1);
  return title ? { bookId, bookNameKo: m.books[bookId].ko, title } : { bookId, bookNameKo: m.books[bookId].ko };
}

/**
 * @param {string} q
 * @param {string[]} chunkNames
 * @param {Set<string> | null | undefined} restrictBooks
 * @returns {MatchedRow[]}
 */
function gatherResults(q, chunkNames, restrictBooks) {
  const qNorm = normalizeQuery(q);
  // A query of quotes alone normalizes to "" — which every verse contains.
  if (!qNorm) return [];
  const hasRestrict = !!(restrictBooks && restrictBooks.size > 0);
  /** @type {MatchedRow[]} */
  const allMatched = [];
  for (const name of chunkNames) {
    const chunk = loadedChunks[name];
    if (!chunk) continue;
    const { books, bArr, cArr, vArr, tArr } = chunk;
    // Normalize each chunk once (on its first search), not per query.
    if (!chunk.nArr) chunk.nArr = tArr.map(normalizeForMatch);
    const nArr = chunk.nArr;
    const n = tArr.length;
    for (let i = 0; i < n; i++) {
      if (hasRestrict && !(/** @type {Set<string>} */ (restrictBooks)).has(books[bArr[i]])) continue;
      if (!nArr[i].includes(qNorm)) continue;
      allMatched.push({
        b: books[bArr[i]],
        c: cArr[i],
        v: vArr[i],
        t: tArr[i],
      });
    }
  }
  return allMatched;
}

/**
 * @param {MatchedRow[]} allMatched
 * @param {number} page
 * @param {number} pageSize
 * @returns {PaginatedResult}
 */
function paginate(allMatched, page, pageSize) {
  const total = allMatched.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const m = /** @type {SearchMeta} */ (meta);
  const results = allMatched.slice(start, end).map((e) => {
    const row = { b: e.b, c: e.c, v: e.v, t: e.t, bookNameKo: m.books[e.b].ko };
    const title = chapterTitle(e.b, e.c);
    return title ? { ...row, title } : row;
  });
  return { results, total };
}

/**
 * 성서 본문과 성시의 결과를 따로 모아 같은 쪽으로 자른다(ADR-046 §3). 쪽은 앱이 보이는 묶음의 쪽이라, 다른 묶음은
 * 결과 수만 쓴다. `results`와 `total`은 지금처럼 성서 본문이다.
 * @param {string} q
 * @param {string[]} chunkNames  the chunks to search: all of them, or those loaded so far
 * @param {Set<string>} restrictBooks
 * @param {number} page
 * @param {number} pageSize
 * @returns {PaginatedResult & { psalter: PaginatedResult }}
 */
function groupedResults(q, chunkNames, restrictBooks, page, pageSize) {
  const bible = paginate(gatherResults(q, chunkNames.filter((n) => !PSALTER_CHUNKS.has(n)), restrictBooks), page, pageSize);
  const psalter = paginate(gatherResults(q, chunkNames.filter((n) => PSALTER_CHUNKS.has(n)), restrictBooks), page, pageSize);
  return { results: bible.results, total: bible.total, psalter };
}
// ── END SEARCH_PURE ──

// ── BEGIN LECTIONARY_PURE ──
// 전례독서 검색(ADR-044, 설계 docs/design/lectionary-search.md §4와 §5). Pure: every function takes the built
// index (and, for a passage, the VerseRef from tryVerseRef), so tests/unit/search-worker.test.js runs this block
// with SEARCH_PURE on a small index and search-worker.data.test.js on the real one.

// 이름은 띄어쓰기, 가운뎃점, 따옴표를 빼고 비교한다. 주의 번호는 `7주일`, `제7주`, `제7주간`, `7주간`을 모두 `7주`로
// 맞춘다(설계 §4.1). 데이터의 이름은 그대로 두고 비교할 때만 바꾼다. `제N주간`은 천주교가 평일 이름에 쓰는 표기다.
// 따옴표는 성서 검색과 같은 목록(`QUOTE_CHARS_RE`)을 쓴다.
const LECT_IGNORED_RE = new RegExp(`${QUOTE_CHARS_RE.source}|[·ㆍ・\\s]`, "g");
const LECT_WEEK_RE = /제?(\d+)주(?:일|간)?/g;
const LECT_DIGIT_RE = /\d/;

/**
 * @param {string} s
 * @returns {string}
 */
function normalizeLectName(s) {
  return s.toLowerCase().replace(LECT_IGNORED_RE, "").replace(LECT_WEEK_RE, "$1주");
}

/**
 * Where `needle` occurs in `hay` with its numbers whole: a needle that starts (ends) with a digit is not found where
 * a digit comes just before (after) it. 그래서 `연중7주`는 `연중17주` 안에 없고, `연중1`은 `연중10주` 안에 없다.
 * @param {string} hay
 * @param {string} needle
 * @returns {number}  the index of the first such occurrence, or -1
 */
function findWhole(hay, needle) {
  const head = LECT_DIGIT_RE.test(needle[0]);
  const tail = LECT_DIGIT_RE.test(needle[needle.length - 1]);
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    if (head && at > 0 && LECT_DIGIT_RE.test(hay[at - 1])) continue;
    if (tail && at + needle.length < hay.length && LECT_DIGIT_RE.test(hay[at + needle.length])) continue;
    return at;
  }
  return -1;
}

/**
 * 1 the whole name, 2 its start, 3 inside it, 0 not found (설계 §4.3).
 * @param {string} key  a normalized name
 * @param {string} q  a normalized query
 * @returns {number}
 */
function lectTier(key, q) {
  const at = findWhole(key, q);
  if (at === -1) return 0;
  if (at > 0) return 3;
  return key.length === q.length ? 1 : 2;
}

/**
 * @template K
 * @param {Map<K, number[]>} map
 * @param {K} key
 * @param {number} value
 */
function pushIndex(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * @param {LectionaryRaw} raw
 * @returns {LectionaryIndex}
 */
function buildLectionarySearchIndex(raw) {
  /** @type {number[][]} */
  const setsOfObs = raw.obs.map(() => []);
  raw.sets.forEach((s, i) => setsOfObs[s[0]].push(i));
  /** @type {Map<string, number[]>} */
  const covOfBook = new Map();
  /** @type {Map<number, number[]>} */
  const covOfReading = new Map();
  raw.cov.forEach((row, i) => {
    pushIndex(covOfBook, raw.books[row[1]], i);
    pushIndex(covOfReading, row[0] * 4 + row[5], i);
  });
  return {
    obs: raw.obs,
    sets: raw.sets,
    cov: raw.cov,
    books: raw.books,
    obsKeys: raw.obs.map((o) => [o.name, ...(o.aliases || [])].map(normalizeLectName)),
    saints: (raw.saints || []).map((s) => ({ title: s.title, keys: [s.name, s.title].map(normalizeLectName), obs: s.obs })),
    synonyms: Object.entries(raw.synonyms || {})
      .map(([from, to]) => ({ from, to, fromKey: normalizeLectName(from), toKey: normalizeLectName(to) }))
      .filter((s) => s.fromKey)
      .sort((a, b) => b.fromKey.length - a.fromKey.length),
    setsOfObs,
    obsOfSet: new Map(raw.sets.map((s) => [s[1], s[0]])),
    covOfBook,
    covOfReading,
    local: null,
  };
}

/**
 * @param {LectionaryIndex} index
 * @param {number} i
 * @returns {LectObsInfo}
 */
function lectObsInfo(index, i) {
  const { key, name, kind, date, rank, common, order } = index.obs[i];
  return { key, name, kind, date, rank, common, order };
}

/**
 * @param {LectionaryIndex} index
 * @param {number} i
 * @returns {LectSetInfo}
 */
function lectSetInfo(index, i) {
  const [, id, year, track, setNo, label] = index.sets[i];
  return { id, year, track, setNo, label };
}

/**
 * 비슷한 말 표의 낱말을 앱의 이름으로 바꾼다(설계 §4.1 2). 왼쪽부터 한 번만 훑으며 자리마다 긴 낱말부터 맞춘다.
 * 그래서 짧은 낱말이 긴 낱말의 일부여도 긴 낱말이 통째로 바뀌고, 바꾼 말을 다시 바꾸지 않는다.
 * @param {LectionaryIndex} index
 * @param {string} typed  a normalized query
 * @returns {{ swapped: string, used: Array<{ from: string, to: string }> }}
 */
function swapSynonyms(index, typed) {
  let swapped = "";
  /** @type {Array<{ from: string, to: string }>} */
  const used = [];
  for (let at = 0; at < typed.length; ) {
    const s = index.synonyms.find((x) => typed.startsWith(x.fromKey, at));
    if (!s) {
      swapped += typed[at];
      at += 1;
      continue;
    }
    swapped += s.toKey;
    at += s.fromKey.length;
    if (!used.some((u) => u.from === s.from)) used.push({ from: s.from, to: s.to });
  }
  return { swapped, used };
}

/**
 * 이름으로 전례일을 찾는다(설계 §4, ADR-044 §3). 전례일의 이름과 별칭, 성인의 이름과 칭호에서 찾는다.
 * 검색어 전체가 든 이름을 찾고, 비슷한 말 표의 낱말이 있으면 앱의 이름으로 바꾼 검색어로도 찾는다. 그래도 없고
 * 검색어에 낱말이 여럿이면 낱말이 모두 든 이름을 찾는다. 결과는 이름 전체가 같은 것, 이름이 검색어로 시작하는 것,
 * 이름 안에 든 것의 차례이고, 같은 단계 안에서는 전례년 순서다. `extra`는 해마다 바뀌어 색인에 없는 이름(오늘부터 한 해 안에 오는 성탄
 * 평일의 화면 이름, ADR-044 §3)이고, 그 독서 세트의 전례일을 별칭처럼 찾는다.
 * @param {LectionaryIndex} index
 * @param {string} query
 * @param {Array<[string, string]>} [extra]  [독서 세트 id, 이름]
 * @returns {LectResult}
 */
function searchLectionaryNames(index, query, extra = []) {
  /** @type {LectResult} */
  const result = { kind: "name", items: [], synonyms: [] };
  const typed = normalizeLectName(query);
  if (!typed) return result;
  const extraKeys = extra.flatMap(([setId, name]) => {
    const i = index.obsOfSet.get(setId);
    return i === undefined ? [] : [{ i, name, key: normalizeLectName(name) }];
  });

  /** @type {Map<number, { tier: number, matched: string }>} */
  const best = new Map();
  /**
   * Keep each lectionary day's best match. On a tie its own name wins over an alias or a saint.
   * @param {(key: string) => number} tierOf
   * @returns {boolean}  whether it found anything
   */
  const scan = (tierOf) => {
    let found = false;
    /** @param {number} i @param {number} tier @param {string} matched */
    const keep = (i, tier, matched) => {
      found = true;
      const cur = best.get(i);
      if (!cur || tier < cur.tier || (tier === cur.tier && cur.matched && !matched)) best.set(i, { tier, matched });
    };
    index.obsKeys.forEach((keys, i) => {
      keys.forEach((key, k) => {
        const tier = tierOf(key);
        if (tier) keep(i, tier, k === 0 ? "" : index.obs[i].aliases[k - 1]);
      });
    });
    for (const saint of index.saints) {
      const tiers = saint.keys.map(tierOf).filter((t) => t > 0);
      if (tiers.length) for (const i of saint.obs) keep(i, Math.min(...tiers), saint.title);
    }
    for (const { i, name, key } of extraKeys) {
      const tier = tierOf(key);
      if (tier) keep(i, tier, name);
    }
    return found;
  };

  scan((key) => lectTier(key, typed));
  const { swapped, used } = swapSynonyms(index, typed);
  if (swapped !== typed && scan((key) => lectTier(key, swapped))) result.synonyms = used;
  if (best.size === 0) {
    const words = query.trim().split(/\s+/).map(normalizeLectName).filter(Boolean);
    if (words.length > 1) {
      // 같은 낱말은 한 번만 비교한다. 같은 낱말을 길게 되풀이한 검색어(공유 링크)로 워커가 멈추지 않게 하려는 것이다.
      const unique = [...new Set(words)];
      // 낱말마다 비슷한 말로 바꾼 것도 받는다(`바오로 사도`의 `바오로`). 낱말 여럿에 걸친 비슷한 말은 위에서 검색어
      // 전체로 이미 바꿔 보았다.
      const swaps = unique.map((w) => swapSynonyms(index, w));
      const found = scan((key) => (unique.every((w, i) =>
        findWhole(key, w) !== -1 || (swaps[i].swapped !== w && findWhole(key, swaps[i].swapped) !== -1)) ? 3 : 0));
      if (found) {
        for (const u of swaps.flatMap((s) => s.used)) {
          if (!result.synonyms.some((x) => x.from === u.from)) result.synonyms.push(u);
        }
      }
    }
  }

  result.items = [...best]
    .sort(([a, x], [b, y]) => x.tier - y.tier || index.obs[a].order - index.obs[b].order)
    .map(([i, { tier, matched }]) => {
      /** @type {LectItem} */
      const item = { obs: lectObsInfo(index, i), sets: index.setsOfObs[i].map((s) => lectSetInfo(index, s)), tier };
      if (matched) item.matched = matched;
      return item;
    });
  return result;
}

// 연도를 붙인 이름 검색(ADR-044 §4). 연도는 「년」을 붙이거나 네 자리 숫자만 쓰고, 이름의 앞이나 뒤에 둔다. 범위는 하이픈이나
// 물결표로 잇는다. 찾는 해는 캘린더와 같은 1583-9999년이다(교회력 엔진 `MIN_YEAR`, `MAX_YEAR`. 워커는 엔진을 읽지 않는다. 네 자리
// 숫자라 9999년을 넘는 해는 읽지 않는다). 2050년에서 자르던 것은 2026-11-18에 풀었다(사용자 결정). 설날과 추석은 음력 날짜 자료가 있는
// 해만 찾고, 앱이 그렇다고 알린다. 범위는 앞의 `LECT_YEAR_SPAN`해까지 찾는다. 앱이 그해의 모든 날을 엔진으로 계산하기 때문이다.
const LECT_YEAR_MIN = 1583;
const LECT_YEAR_SPAN = 10;
const LECT_YEARS_SRC = "(\\d{4})년?(?:\\s*[-~～–]\\s*(\\d{4})년?)?";
const LECT_YEAR_LEAD_RE = new RegExp(`^${LECT_YEARS_SRC}\\s+(.+)$`);
const LECT_YEAR_TAIL_RE = new RegExp(`^(.+?)\\s+${LECT_YEARS_SRC}$`);
/** 이름이 될 수 없는 나머지: 숫자와 연도 표기뿐이다(`2024 2026`). */
const LECT_YEAR_ONLY_RE = /^[\d\s년~～–,-]*$/;

/**
 * 검색어의 앞이나 뒤에 붙은 연도와 그 나머지(전례일 이름). 연도가 없거나, 첫 해(1583년)보다 이르거나, 나머지가 이름이 아니면 null.
 * 거꾸로 쓴 범위(`2026-2024`)는 작은 해부터로 고친다. 날짜(`2026-12-25`)와 여러 해를 늘어놓은 것(`2024, 2026`)은 읽지 않는다.
 * @param {string} keyword
 * @returns {{ name: string, from: number, to: number, capped: boolean } | null}
 */
function parseLectYear(keyword) {
  const s = keyword.trim();
  /** @type {string | undefined} */
  let a;
  /** @type {string | undefined} */
  let b;
  /** @type {string | undefined} */
  let name;
  const lead = LECT_YEAR_LEAD_RE.exec(s);
  if (lead) [, a, b, name] = lead;
  else {
    const tail = LECT_YEAR_TAIL_RE.exec(s);
    if (!tail) return null;
    [, name, a, b] = tail;
  }
  name = (name || "").trim();
  if (!name || LECT_YEAR_ONLY_RE.test(name)) return null;
  let from = Number(a);
  let to = b ? Number(b) : from;
  if (from > to) [from, to] = [to, from];
  if (from < LECT_YEAR_MIN) return null;
  const capped = to - from + 1 > LECT_YEAR_SPAN;
  if (capped) to = from + LECT_YEAR_SPAN - 1;
  return { name, from, to, capped };
}

// 날짜로 독서가 정해진 성탄 평일(색인의 이름은 13개 모두 「성탄주간」)이 해마다 받는 이름. 교회력 엔진 `christmasWeekdayName`이
// 만드는 이름의 모두다: 그 주의 주일이 성탄 1주일이나 2주일이면 「성탄 N주 X요일」, 주일이 오기 전이면 「성탄 후 X요일」.
const LECT_CHRISTMAS_NAME = "성탄주간";
const LECT_CHRISTMAS_WEEKDAY_NAMES = ["성탄 1주", "성탄 2주", "성탄 후"].flatMap((head) =>
  ["월", "화", "수", "목", "금", "토"].map((d) => `${head} ${d}요일`));

/**
 * 이름 하나(`name`)가 검색어로 찾아지는가. 이름 검색(`searchLectionaryNames`)과 같게, 검색어 전체가 들어 있거나 낱말이 모두 들어 있다.
 * @param {string} name @param {string} query @returns {boolean}
 */
function lectNameMatches(name, query) {
  const key = normalizeLectName(name);
  const typed = normalizeLectName(query);
  if (typed && lectTier(key, typed)) return true;
  const words = query.trim().split(/\s+/).map(normalizeLectName).filter(Boolean);
  return words.length > 1 && words.every((w) => findWhole(key, w) !== -1);
}

/**
 * 연도를 붙인 이름 검색(ADR-044 §4). 연도를 뗀 이름으로 찾고, 앱이 찾은 전례일마다 그해의 날을 계산하도록 해를 함께 넘긴다.
 * 성탄 평일의 이름은 해마다 바뀌어(§3) 오늘부터 한 해의 이름(`lect-names`)으로 찾지 않는다. 그 이름이 될 수 있는 것 가운데 검색어로
 * 찾아지는 것을 줄(`yearNames`)에 달아 넘기고, 앱이 그해의 이름으로 거른다(`2027 성탄1주`).
 * @param {LectionaryIndex} index
 * @param {{ name: string, from: number, to: number, capped: boolean }} yq  parseLectYear
 * @returns {LectResult}
 */
function searchLectionaryYears(index, yq) {
  const result = searchLectionaryNames(index, yq.name);
  result.years = { from: yq.from, to: yq.to, capped: yq.capped };
  const yearNames = LECT_CHRISTMAS_WEEKDAY_NAMES.filter((n) => lectNameMatches(n, yq.name));
  if (yearNames.length) {
    const have = new Set(result.items.map((item) => item.obs.key));
    index.obs.forEach((o, i) => {
      if (o.name !== LECT_CHRISTMAS_NAME || have.has(o.key)) return;
      result.items.push({ obs: lectObsInfo(index, i), sets: index.setsOfObs[i].map((x) => lectSetInfo(index, x)), tier: 3, yearNames });
    });
  }
  return result;
}

// 지역 축일(ADR-044 §3): 소속교회의 축성일, 그 교구의 설립일, 관구 설립일. 사람마다 소속교회가 달라 색인에 넣지 않고, 본당 표와 검색 메시지의
// 소속교회로 검색할 때 더한다(설계 §4.2). 본당 이름은 띄어쓰기를 무시하고 끝의 「성당」과 「교회」를 같은 말로 보고 떼어 비교한다.
const LOCAL_SUFFIX_RE = /(성당|교회)$/;
/** 북한에 있던 성당. 본당 표에는 있지만 화면에 보이지 않는다(lectionary.js `isFormerNorthChurch`). */
const LOCAL_FORMER_NORTH = "북.";

/**
 * 본당 이름을 비교하는 값: 띄어쓰기 등을 지우고(`normalizeLectName`) 끝의 「성당」이나 「교회」를 뗀다.
 * @param {string} name @returns {string}
 */
function localBase(name) {
  return normalizeLectName(name).replace(LOCAL_SUFFIX_RE, "");
}

/**
 * 설립일 행 하나(관구, 교구). 형식이 깨졌으면 null.
 * @param {any} row @returns {LocalFounding | null}
 */
function localFoundingOf(row) {
  if (!row || typeof row.name !== "string" || typeof row.founded !== "string" || !/^\d{2}\.\d{2}$/.test(row.founded)) return null;
  return { name: row.name, date: row.founded, year: Number.isInteger(row.founded_year) ? row.founded_year : null };
}

/**
 * 본당 표 → 지역 축일을 찾는 색인. 표가 없거나 형식이 깨졌으면 null. 형식이 깨진 행과 북한에 있던 성당은 뺀다.
 * @param {any} raw @returns {LocalIndex | null}
 */
function buildLocalIndex(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.parishes)) return null;
  /** @type {LocalParish[]} */
  const parishes = [];
  for (const p of raw.parishes) {
    const d = p && p.dedication;
    if (!d || typeof p.name !== "string" || p.name.startsWith(LOCAL_FORMER_NORTH) || typeof p.church_id !== "string" || !p.church_id) continue;
    if ((d.kind !== "consecration" && d.kind !== "blessing") || typeof d.date !== "string" || !/^\d{2}\.\d{2}$/.test(d.date)) continue;
    parishes.push({ name: p.name, base: localBase(p.name), churchId: p.church_id, kind: d.kind, date: d.date,
      diocese: typeof p.diocese === "string" && p.diocese ? p.diocese : null,
      color: typeof d.color === "string" ? d.color : null, rank: typeof d.rank === "string" ? d.rank : null });
  }
  /** @type {LocalFounding[]} */
  const dioceses = [];
  for (const row of Array.isArray(raw.dioceses) ? raw.dioceses : []) {
    const f = localFoundingOf(row);
    if (f) dioceses.push(f);
  }
  return { parishes, dioceses, province: localFoundingOf(raw.province) };
}

/**
 * 지역 축일의 전례년 순서. 날짜가 정해진 월별 축일 사이에 날짜로 끼운다(설계 §4.3. 월별 축일은 날짜순이다).
 * @param {LectionaryIndex} index @param {string} date 「MM.DD」 @returns {number}
 */
function localOrder(index, date) {
  let before = -Infinity;
  let first = Infinity;
  for (const o of index.obs) {
    if (o.kind !== "sanctoral" || !o.date) continue;
    if (o.order < first) first = o.order;
    if (o.date <= date && o.order > before) before = o.order;
  }
  if (before !== -Infinity) return before + 0.5;
  return first !== Infinity ? first - 0.5 : 0;
}

/**
 * 지역 축일(ADR-044 §3). 소속교회(`parish`, 교회 식별자)의 축성일은 그 이름(「용인성당 축성일」)이나 본당 이름(`용인`, `용인교회`, 이름이 같은
 * 것, 시작하는 것, 든 것의 차례)으로 찾는다. 그 교구의 설립일(「서울교구설립일」)과 관구 설립일(「관구설립일」, 소속교회와 상관없다)은 이름으로
 * 찾는다. 이름 규칙은 다른 전례일과 같다. 소속교회의 축성일을 찾지 못했으면 안내를 낸다. 검색어 끝에 「성당」이나 「교회」를 붙였으면
 * 그 이름의 본당이고(`오산교회`로 `오산세마대성당`), 아니면 `축성일`로 찾았는데 소속교회를 등록하지 않았거나 소속교회에 축복일만 있는 사정이다.
 * 「성당」이나 「교회」만 친 검색어는 찾지 않는다.
 * @param {LectionaryIndex} index
 * @param {string} query
 * @param {string} parish  빈 문자열은 선택 안 함
 * @returns {{ items: LectItem[], notice: LocalNotice | null }}
 */
function searchLocal(index, query, parish) {
  /** @type {{ items: LectItem[], notice: LocalNotice | null }} */
  const out = { items: [], notice: null };
  const local = index.local;
  if (!local) return out;
  const typed = normalizeLectName(query);
  const stripped = typed.replace(LOCAL_SUFFIX_RE, "");
  if (!stripped) return out;
  /** @param {string} name */
  const nameTier = (name) => lectTier(normalizeLectName(name), typed) || (lectNameMatches(name, query) ? 3 : 0);
  /**
   * @param {"dedication" | "diocese" | "province"} level @param {string} name @param {string} date @param {number} tier
   * @param {{ rank?: string | null, color?: string | null, year?: number | null }} extra
   */
  const add = (level, name, date, tier, extra) => {
    out.items.push({
      obs: { key: `local:${level}`, name, kind: "local", date, rank: extra.rank ?? null, common: null, order: localOrder(index, date) },
      sets: [], tier, local: { level, color: extra.color ?? null, year: extra.year ?? null },
    });
  };
  const mine = parish ? local.parishes.find((p) => p.churchId === parish) || null : null;
  if (mine && mine.kind === "consecration") {
    const name = `${mine.name} 축성일`;
    // 설정의 교회 목록은 「용인성당」을 「용인교회」로 적는다(helpers.js `churchName`). 그 이름에 「축성일」을 붙여도 찾는다
    const tiers = [nameTier(name), nameTier(`${mine.base}교회 축성일`), lectTier(mine.base, stripped)].filter((t) => t > 0);
    if (tiers.length) add("dedication", name, mine.date, Math.min(...tiers), { rank: mine.rank, color: mine.color });
  }
  const diocese = mine && mine.diocese ? local.dioceses.find((d) => d.name === mine.diocese) : undefined;
  if (diocese) {
    const name = `${diocese.name}교구설립일`;
    const tier = nameTier(name);
    if (tier) add("diocese", name, diocese.date, tier, { year: diocese.year });
  }
  if (local.province) {
    const name = "관구설립일";
    const tier = nameTier(name);
    if (tier) add("province", name, local.province.date, tier, { year: local.province.year });
  }
  if (out.items.some((item) => item.local && item.local.level === "dedication")) return out;
  if (typed !== stripped) {
    // 이름이 같은 것, 시작하는 것, 든 것의 차례이고, 같은 단계면 표의 차례다
    /** @type {LocalParish | null} */
    let best = null;
    let bestTier = 0;
    for (const p of local.parishes) {
      const tier = lectTier(p.base, stripped);
      if (tier && (!bestTier || tier < bestTier)) {
        best = p;
        bestTier = tier;
      }
    }
    if (best) out.notice = { kind: best.kind, name: best.name, date: best.date, churchId: best.churchId, mine: mine ? mine.kind : null };
  }
  if (!out.notice && typed.includes("축성")) {
    if (!mine) out.notice = { kind: "noParish", name: null, date: null, churchId: null, mine: null };
    else if (mine.kind === "blessing") out.notice = { kind: "blessing", name: mine.name, date: mine.date, churchId: mine.churchId, mine: "blessing" };
  }
  return out;
}

/**
 * 이름 검색의 결과에 지역 축일을 더한다(`searchLocal`). 찾은 단계, 전례년 순서로 다시 늘어놓고, 안내는 `localNotice`에 둔다.
 * @param {LectionaryIndex} index @param {LectResult} result @param {string} query @param {string} parish
 * @returns {LectResult}
 */
function withLocalDays(index, result, query, parish) {
  const { items, notice } = searchLocal(index, query, parish);
  result.localNotice = notice;
  if (!items.length) return result;
  result.items = [...result.items, ...items]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.tier ?? 3) - (b.item.tier ?? 3) || a.item.obs.order - b.item.obs.order || a.i - b.i)
    .map(({ item }) => item);
  return result;
}

/**
 * Merge overlapping or touching [from, to] verse ranges.
 * @param {Array<[number, number]>} ranges
 * @returns {Array<[number, number]>}
 */
function mergeRanges(ranges) {
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const [from, to] of ranges.slice().sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * 검색어의 한 장에 든 절 구간. 구절 바로가기 카드(`js/app/verse-spec.js`의 `verseNumberSpec`)와 같게 읽는다. 거꾸로
 * 쓴 구간(`21-14`)은 작은 절부터로 고치고, 0절은 빼고, 남는 절이 없으면 장 전체다(`요한 3:0`).
 * @param {string} verses  VerseRefPart.verses
 * @returns {Array<[number, number]>}
 */
function passageRanges(verses) {
  /** @type {Array<[number, number]>} */
  const ranges = [];
  for (const segment of verses.split(",")) {
    const [from, to = from] = segment.split("-").map(Number);
    if (from > 0) ranges.push([Math.min(from, to), Math.max(from, to)]);
  }
  return ranges.length ? mergeRanges(ranges) : [[1, REF_CHAPTER_END]];
}

/**
 * 구절로 그 구절을 읽는 전례일을 찾는다(설계 §5). 한 절이라도 겹치는 독서를 찾는다. 검색어의 절을 모두 담은 독서를
 * 먼저 두고, 다음은 겹친 절이 많은 독서, 그다음은 전례년 순서다. 장 끝까지 이어지는 구간(장만 친 검색어 등)이 있으면
 * 장의 마지막 절을 몰라 「모두 담은」 단계를 쓰지 않는다. 시편은 전례시편(`lps`)에서 찾고, 송가는 색인이 성구로 둔
 * 행(`루가 1:68-79`)으로 찾아진다. 공통 독서는 색인에 없다(ADR-044 §2).
 * @param {LectionaryIndex} index
 * @param {VerseRef} ref
 * @returns {LectResult}
 */
function searchLectionaryPassage(index, ref) {
  /** @type {LectResult} */
  const result = { kind: "passage", items: [], synonyms: [] };
  const rows = index.covOfBook.get(ref.bookId === "ps" ? "lps" : ref.bookId);
  if (!rows) return result;

  /** @type {Map<number, Array<[number, number]>>} the query's verses per chapter */
  const wanted = new Map();
  let size = 0;
  let open = false;
  for (const { chapter, verses } of ref.parts) {
    const ranges = passageRanges(verses);
    wanted.set(chapter, ranges);
    for (const [from, to] of ranges) {
      if (to >= REF_CHAPTER_END) open = true;
      size += to - from + 1;
    }
  }

  /** @type {Map<number, Map<number, Array<[number, number]>>>} the query's verses each reading holds: set * 4 + slot → chapter → ranges */
  const held = new Map();
  for (const r of rows) {
    const [set, , chapter, first, last, slot] = index.cov[r];
    const ranges = wanted.get(chapter);
    if (!ranges) continue;
    for (const [from, to] of ranges) {
      const lo = Math.max(from, first);
      const hi = Math.min(to, last);
      if (lo > hi) continue;
      const reading = set * 4 + slot;
      let chapters = held.get(reading);
      if (!chapters) held.set(reading, (chapters = new Map()));
      const list = chapters.get(chapter);
      if (list) list.push([lo, hi]);
      else chapters.set(chapter, [[lo, hi]]);
    }
  }

  /** @type {Map<number, Map<string, { hit: LectReadingHit, sets: number[] }>>} per lectionary day, per distinct reading */
  const days = new Map();
  for (const [reading, chapters] of held) {
    let overlap = 0;
    for (const list of chapters.values()) for (const [from, to] of mergeRanges(list)) overlap += to - from + 1;
    const set = Math.floor(reading / 4);
    const slot = reading % 4;
    const readingRows = (index.covOfReading.get(reading) || []).map((i) => {
      const [, book, chapter, first, last] = index.cov[i];
      return /** @type {[string, number, number, number]} */ ([index.books[book], chapter, first, last]);
    });
    const obs = index.sets[set][0];
    let readings = days.get(obs);
    if (!readings) days.set(obs, (readings = new Map()));
    const sig = `${slot}:${readingRows.join(";")}`;
    const same = readings.get(sig);
    if (same) same.sets.push(set);
    else readings.set(sig, { hit: { slot, rows: readingRows, sets: [], full: !open && overlap === size, overlap }, sets: [set] });
  }

  /** @param {LectReadingHit} a @param {LectReadingHit} b */
  const better = (a, b) => Number(b.full) - Number(a.full) || b.overlap - a.overlap;
  result.items = [...days]
    .map(([obs, readings]) => {
      const hits = [...readings.values()]
        .map(({ hit, sets }) => {
          hit.sets = sets.sort((a, b) => a - b).map((s) => lectSetInfo(index, s));
          return hit;
        })
        .sort((a, b) => better(a, b) || a.slot - b.slot);
      return { obs: lectObsInfo(index, obs), sets: index.setsOfObs[obs].map((s) => lectSetInfo(index, s)), hits };
    })
    .sort((a, b) => better(a.hits[0], b.hits[0]) || a.obs.order - b.obs.order);
  return result;
}
// ── END LECTIONARY_PURE ──

// ── Message handler ──

onmessage = /** @param {MessageEvent<IncomingMessage>} ev */ async (ev) => {
  const msg = ev.data;

  if (msg.type === "init") {
    metaUrl = msg.metaUrl;
    booksUrl = msg.booksUrl || null;
    chunkConfig = msg.chunks;
    // A new lectionary address drops what the old one loaded or was loading.
    const nextLectionaryUrl = msg.lectionaryUrl || null;
    const nextLocalUrl = msg.localUrl || null;
    if (nextLectionaryUrl !== lectionaryUrl || nextLocalUrl !== localUrl) {
      localUrl = nextLocalUrl;
      lectionaryGen++;
      lectionaryUrl = nextLectionaryUrl;
      lectionary = null;
      lectionaryPromise = null;
      lectionaryRetryAt = 0;
    }

    try {
      await loadMeta();
      // Start loading all chunks in parallel (priority order: NT, DC, OT, then 성시)
      ensureChunks();
      // The lectionary index after the bible chunks; a failure only leaves `lectionary` null.
      loadLectionary();
      post("ready", {});
    } catch (err) {
      // The init path has no searchId — drop it from the error payload.
      post("error", { message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === "lect-names") {
    lectExtraNames = msg.names || [];
    return;
  }

  if (msg.type === "search") {
    const { q, page, pageSize, searchId } = msg;
    const scopeBooks = msg.scopeBooks || [];
    const parish = msg.parish || "";
    currentSearchId = searchId;

    try {
      const trimmed = (q || "").trim();

      if (!trimmed) {
        post("results", { searchId, q: trimmed, refMatch: null, bookOnly: null, ...NO_LECTIONARY,
          results: [], total: 0, page, pageSize });
        return;
      }

      await loadMeta();

      const refMatch = tryVerseRef(trimmed);
      if (refMatch) {
        // 그 구절을 읽는 전례일(ADR-044 §1). 색인이 없으면 `null`이라, 앱은 지금처럼 장을 연다.
        const lect = scopeBooks.length > 0 ? NO_LECTIONARY
          : lectionaryFields(searchId, trimmed, (index) => searchLectionaryPassage(index, refMatch));
        post("results", { searchId, q: trimmed, refMatch, bookOnly: null, ...lect,
          results: [], total: 0, page, pageSize });
        return;
      }

      const { keyword, restrictBooks, unmatched } = parseQuery(trimmed);

      // Merge the structured book-picker scope (book ids) with any typed
      // in:<alias> tokens — both restrict to the union of books (ADR-033).
      for (const id of scopeBooks) restrictBooks.add(id);

      // Block search when any in: alias is unrecognized — the user gets the
      // notice instead of misleading "all-books" results that ignore their filter.
      if (unmatched.length > 0) {
        post("results", { searchId, q: trimmed, refMatch: null, bookOnly: null, ...NO_LECTIONARY,
          results: [], total: 0, page, pageSize, unmatchedScopes: unmatched });
        return;
      }

      // More books than one search may take: search none and say so, rather than drop some the user chose (ADR-033).
      if (restrictBooks.size > MAX_SCOPE_BOOKS) {
        post("results", { searchId, q: trimmed, refMatch: null, bookOnly: null, ...NO_LECTIONARY,
          results: [], total: 0, page, pageSize, unmatchedScopes: [], tooManyBooks: true });
        return;
      }

      // No keyword left after stripping in: tokens — nothing to search.
      if (!keyword) {
        post("results", { searchId, q: trimmed, refMatch: null, bookOnly: null, ...NO_LECTIONARY,
          results: [], total: 0, page, pageSize, unmatchedScopes: [] });
        return;
      }

      // 책 이름만 친 검색어(ADR-044 §2)는 책을 골라 두었어도 알아본다. 구절 바로가기와 같다. 이름으로 찾는
      // 전례일(§3)은 책을 골라 두었으면 찾지 않는다(§1).
      const scoped = restrictBooks.size > 0;
      const bookOnly = tryBookOnly(keyword);
      // 이름에 붙인 연도(ADR-044 §4). 성서 본문은 친 그대로 찾는다
      const yearQuery = parseLectYear(keyword);
      // The name search depends on the keyword and the index only: computed once per index and shared by the partial
      // results, the results and a later "lectionary" message. A new index (`init`) computes it again.
      /** @type {LectionaryIndex | null} */
      let namesIndex = null;
      /** @type {LectResult | null} */
      let names = null;
      /** @param {LectionaryIndex} index @returns {LectResult} */
      const findNames = (index) => {
        if (index !== namesIndex || !names) {
          namesIndex = index;
          const found = yearQuery ? searchLectionaryYears(index, yearQuery) : searchLectionaryNames(index, keyword, lectExtraNames);
          names = withLocalDays(index, found, yearQuery ? yearQuery.name : keyword, parish);
        }
        return names;
      };

      // A 성시 chunk that failed to load is fetched again (loadChunk).
      ensureChunks();
      // Wait for first chunk (NT) if nothing is loaded yet
      const firstChunk = chunkConfig[0];
      if (!loadedChunks[firstChunk.name]) {
        await loadingPromises[firstChunk.name];
      }

      // Abort if a newer search has started
      if (searchId !== currentSearchId) return;

      const loadedNames = chunkConfig.map((c) => c.name).filter((n) => loadedChunks[n]);
      const pendingNames = chunkConfig.map((c) => c.name).filter((n) => !loadedChunks[n]);

      // Send partial results if some chunks are still loading
      if (pendingNames.length > 0) {
        const { results, total, psalter } = groupedResults(keyword, loadedNames, restrictBooks, page, pageSize);
        post("partial-results", {
          searchId, q: trimmed, keyword, results, total, psalter, page, pageSize,
          loadedChunks: loadedNames, pendingChunks: pendingNames,
          unmatchedScopes: unmatched,
          // Only what is loaded already — a partial result never waits for the lectionary index.
          bookOnly, lectionary: !scoped && lectionary ? findLectionary(findNames, lectionary) : null,
        });

        // Wait for remaining chunks. A 성시 chunk that fails resolves without loading (loadChunk).
        await Promise.all(pendingNames.map((n) => loadingPromises[n]));
        if (searchId !== currentSearchId) return;
      }

      // Full search across all chunks
      const { results, total, psalter } = groupedResults(keyword, chunkConfig.map((c) => c.name), restrictBooks, page, pageSize);
      // `keyword` is the query stripped of in:<alias> tokens — used by the UI
      // for snippet highlighting and the ?hl= chapter-view param.
      post("results", { searchId, q: trimmed, keyword, refMatch: null,
        results, total, psalter, page, pageSize, unmatchedScopes: unmatched,
        bookOnly, ...(scoped ? NO_LECTIONARY : lectionaryFields(searchId, trimmed, findNames)) });

    } catch (err) {
      post("error", { message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
};
