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

let meta = null;          // { aliases, books }
let metaPromise = null;
let metaUrl = null;

let loadedChunks = {};    // { name: { books, bArr, cArr, vArr, tArr } }
let loadingPromises = {}; // { name: Promise }
let chunkConfig = [];     // [{ name, url }, ...]

let currentSearchId = 0;

function post(type, payload) {
  postMessage(Object.assign({ type }, payload));
}

// ── Meta loading ──

async function loadMeta() {
  if (meta) return;
  if (metaPromise) return metaPromise;
  metaPromise = fetch(metaUrl)
    .then((r) => {
      if (!r.ok) throw new Error("meta 로드 실패: " + r.status);
      return r.json();
    })
    .then((data) => { meta = data; });
  return metaPromise;
}

// ── Chunk loading ──

function loadChunk(name, url) {
  if (loadedChunks[name]) return Promise.resolve();
  if (loadingPromises[name]) return loadingPromises[name];

  loadingPromises[name] = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`${name} 청크 로드 실패: ${r.status}`);
      return r.json();
    })
    .then((data) => {
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

function tryVerseRef(query) {
  const m = query.match(REF_RE);
  if (!m) return null;

  const bookQuery = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const verse = parseInt(m[3], 10);
  const verseEnd = m[4] ? parseInt(m[4], 10) : null;

  // Case-insensitive lookup for English ids (e.g. "Gen", "GEN" → "gen").
  // toLowerCase() is a no-op on Hangul, so Korean aliases remain unaffected.
  let bookId = meta.aliases[bookQuery] || meta.aliases[bookQuery.toLowerCase()];
  if (!bookId) {
    for (const [id, info] of Object.entries(meta.books)) {
      if (info.ko === bookQuery) { bookId = id; break; }
    }
  }
  if (!bookId || !meta.books[bookId]) return null;

  return { bookId, chapter, verse, verseEnd, bookNameKo: meta.books[bookId].ko };
}

function gatherResults(q, chunkNames) {
  const qLower = q.toLowerCase();
  const allMatched = [];
  for (const name of chunkNames) {
    const chunk = loadedChunks[name];
    if (!chunk) continue;
    const { books, bArr, cArr, vArr, tArr } = chunk;
    const n = tArr.length;
    for (let i = 0; i < n; i++) {
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

function paginate(allMatched, page, pageSize) {
  const total = allMatched.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const results = allMatched.slice(start, end).map((e) => ({
    b: e.b,
    c: e.c,
    v: e.v,
    t: e.t,
    bookNameKo: meta.books[e.b].ko,
  }));
  return { results, total };
}

// ── Message handler ──

onmessage = async (ev) => {
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
      // Include searchId so the main thread can resolve the correct pending Promise.
      post("error", { searchId, message: err.message });
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
        const partial = gatherResults(trimmed, loadedNames);
        const { results, total } = paginate(partial, page, pageSize);
        post("partial-results", {
          searchId, q: trimmed, results, total, page, pageSize,
          loadedChunks: loadedNames, pendingChunks: pendingNames,
        });

        // Wait for remaining chunks
        await Promise.all(pendingNames.map((n) => loadingPromises[n]));
        if (searchId !== currentSearchId) return;
      }

      // Full search across all chunks
      const allMatched = gatherResults(trimmed, chunkConfig.map((c) => c.name));
      const { results, total } = paginate(allMatched, page, pageSize);
      post("results", { searchId, q: trimmed, refMatch: null, results, total, page, pageSize });

    } catch (err) {
      post("error", { message: err.message });
    }
    return;
  }
};
