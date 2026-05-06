// @ts-check
"use strict";

/*
 * Global search Web Worker — chunked index edition
 *
 * Protocol:
 *   Main → Worker:
 *     { type: "init", metaUrl: "data/search-meta.json",
 *       chunks: [{ name, url }, ...] }
 *     { type: "search", q: "keyword", page: 1, pageSize: 50, searchId: N }
 *
 *   Worker → Main:
 *     { type: "ready" }
 *     { type: "partial-results", searchId, q, results, total, page, pageSize,
 *       loadedChunks: [...names], pendingChunks: [...names] }
 *     { type: "results", searchId, q, refMatch, results, total, page, pageSize }
 *     { type: "error", message }
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
 * @typedef VerseRef
 * @property {string} bookId
 * @property {number} chapter
 * @property {number} verse
 * @property {number | null} verseEnd
 * @property {string} bookNameKo
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
 * @property {Array<MatchedRow & { bookNameKo: string }>} results
 * @property {number} total
 *
 * @typedef InitMessage
 * @property {"init"} type
 * @property {string} metaUrl
 * @property {ChunkConfig[]} chunks
 *
 * @typedef SearchMessage
 * @property {"search"} type
 * @property {string} q
 * @property {number} page
 * @property {number} pageSize
 * @property {number} searchId
 *
 * @typedef {InitMessage | SearchMessage} IncomingMessage
 */

/** @type {SearchMeta | null} */
let meta = null;
/** @type {Promise<void> | null} */
let metaPromise = null;
/** @type {string | null} */
let metaUrl = null;

/** @type {{ [name: string]: LoadedChunk }} */
let loadedChunks = {};
/** @type {{ [name: string]: Promise<void> }} */
let loadingPromises = {};
/** @type {ChunkConfig[]} */
let chunkConfig = [];

let currentSearchId = 0;

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
  metaPromise = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error("meta 로드 실패: " + r.status);
      return r.json();
    })
    .then((data) => { meta = /** @type {SearchMeta} */ (data); });
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
  return loadingPromises[name];
}

// ── Search helpers ──

// Verse reference pattern: "창세 1:3" or "창세 1:3-11"
const REF_RE = /^([가-힣a-zA-Z0-9\s]+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/;

// Operator: in:<book-alias>  (one or more, OR'd). Greedy on alias to allow
// hangul/letters/digits without spaces. Whitespace between `in:` and the
// alias is ignored (`사랑 in: 요한` works the same as `사랑 in:요한`).
const IN_RE = /(?:^|\s)in:\s*(\S+)/g;

/**
 * @param {string} raw
 * @returns {ParsedQuery}
 */
function parseQuery(raw) {
  /** @type {Set<string>} */
  const restrictBooks = new Set();
  /** @type {string[]} */
  const unmatched = [];
  // parseQuery is only called after loadMeta() resolves, so meta is non-null.
  const m = /** @type {SearchMeta} */ (meta);
  const stripped = raw.replace(IN_RE, (_, alias) => {
    const id = m.aliases[alias] || m.aliases[alias.toLowerCase()];
    if (id) restrictBooks.add(id);
    else unmatched.push(alias);
    return " ";
  }).replace(/\s+/g, " ").trim();
  return { keyword: stripped, restrictBooks, unmatched };
}

/**
 * @param {string} query
 * @returns {VerseRef | null}
 */
function tryVerseRef(query) {
  const match = query.match(REF_RE);
  if (!match) return null;

  const bookQuery = match[1].trim();
  const chapter = parseInt(match[2], 10);
  const verse = parseInt(match[3], 10);
  const verseEnd = match[4] ? parseInt(match[4], 10) : null;

  const m = /** @type {SearchMeta} */ (meta);

  // Case-insensitive lookup for English ids (e.g. "Gen", "GEN" → "gen").
  // toLowerCase() is a no-op on Hangul, so Korean aliases remain unaffected.
  let bookId = m.aliases[bookQuery] || m.aliases[bookQuery.toLowerCase()];
  if (!bookId) {
    for (const [id, info] of Object.entries(m.books)) {
      if (info.ko === bookQuery) { bookId = id; break; }
    }
  }
  if (!bookId || !m.books[bookId]) return null;

  return { bookId, chapter, verse, verseEnd, bookNameKo: m.books[bookId].ko };
}

/**
 * @param {string} q
 * @param {string[]} chunkNames
 * @param {Set<string> | null | undefined} restrictBooks
 * @returns {MatchedRow[]}
 */
function gatherResults(q, chunkNames, restrictBooks) {
  const qLower = q.toLowerCase();
  const hasRestrict = !!(restrictBooks && restrictBooks.size > 0);
  /** @type {MatchedRow[]} */
  const allMatched = [];
  for (const name of chunkNames) {
    const chunk = loadedChunks[name];
    if (!chunk) continue;
    const { books, bArr, cArr, vArr, tArr } = chunk;
    const n = tArr.length;
    for (let i = 0; i < n; i++) {
      if (hasRestrict && !(/** @type {Set<string>} */ (restrictBooks)).has(books[bArr[i]])) continue;
      if (tArr[i].toLowerCase().includes(qLower)) {
        allMatched.push({
          b: books[bArr[i]],
          c: cArr[i],
          v: vArr[i],
          t: tArr[i],
        });
      }
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
  const results = allMatched.slice(start, end).map((e) => ({
    b: e.b,
    c: e.c,
    v: e.v,
    t: e.t,
    bookNameKo: m.books[e.b].ko,
  }));
  return { results, total };
}

// ── Message handler ──

onmessage = /** @param {MessageEvent<IncomingMessage>} ev */ async (ev) => {
  const msg = ev.data;

  if (msg.type === "init") {
    metaUrl = msg.metaUrl;
    chunkConfig = msg.chunks;

    try {
      await loadMeta();
      // Start loading all chunks in parallel (priority order: NT, DC, OT)
      for (const { name, url } of chunkConfig) {
        loadChunk(name, url);
      }
      post("ready", {});
    } catch (err) {
      // The init path has no searchId — drop it from the error payload.
      post("error", { message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  if (msg.type === "search") {
    const { q, page, pageSize, searchId } = msg;
    currentSearchId = searchId;

    try {
      const trimmed = (q || "").trim();

      if (!trimmed) {
        post("results", { searchId, q: trimmed, refMatch: null,
          results: [], total: 0, page, pageSize });
        return;
      }

      await loadMeta();

      const refMatch = tryVerseRef(trimmed);
      if (refMatch) {
        post("results", { searchId, q: trimmed, refMatch,
          results: [], total: 0, page, pageSize });
        return;
      }

      const { keyword, restrictBooks, unmatched } = parseQuery(trimmed);

      // Block search when any in: alias is unrecognized — the user gets the
      // notice instead of misleading "all-books" results that ignore their filter.
      if (unmatched.length > 0) {
        post("results", { searchId, q: trimmed, refMatch: null,
          results: [], total: 0, page, pageSize, unmatchedScopes: unmatched });
        return;
      }

      // No keyword left after stripping in: tokens — nothing to search.
      if (!keyword) {
        post("results", { searchId, q: trimmed, refMatch: null,
          results: [], total: 0, page, pageSize, unmatchedScopes: [] });
        return;
      }

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
        const partial = gatherResults(keyword, loadedNames, restrictBooks);
        const { results, total } = paginate(partial, page, pageSize);
        post("partial-results", {
          searchId, q: trimmed, keyword, results, total, page, pageSize,
          loadedChunks: loadedNames, pendingChunks: pendingNames,
          unmatchedScopes: unmatched,
        });

        // Wait for remaining chunks
        await Promise.all(pendingNames.map((n) => loadingPromises[n]));
        if (searchId !== currentSearchId) return;
      }

      // Full search across all chunks
      const allMatched = gatherResults(keyword, chunkConfig.map((c) => c.name), restrictBooks);
      const { results, total } = paginate(allMatched, page, pageSize);
      // `keyword` is the query stripped of in:<alias> tokens — used by the UI
      // for snippet highlighting and the ?hl= chapter-view param.
      post("results", { searchId, q: trimmed, keyword, refMatch: null,
        results, total, page, pageSize, unmatchedScopes: unmatched });

    } catch (err) {
      post("error", { message: err instanceof Error ? err.message : String(err) });
    }
    return;
  }
};
