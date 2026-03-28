"use strict";

/*
 * Global search Web Worker
 *
 * Protocol:
 *   Main → Worker:
 *     { type: "init", indexUrl: "data/search-index.json" }
 *     { type: "search", q: "keyword", page: 1, pageSize: 50 }
 *
 *   Worker → Main:
 *     { type: "ready" }
 *     { type: "results", q, refMatch, results, total, page, pageSize }
 *     { type: "error", message }
 */

let indexUrl = null;
let meta = null;   // { aliases, books }
let verses = null; // [{ b, c, v, t }]
let loading = false;

function post(type, payload) {
  postMessage(Object.assign({ type }, payload));
}

async function loadIndex() {
  if (verses) return;
  if (loading) {
    // Wait for in-flight load
    await new Promise((resolve) => {
      const id = setInterval(() => {
        if (verses) { clearInterval(id); resolve(); }
      }, 50);
    });
    return;
  }
  loading = true;
  const res = await fetch(indexUrl);
  if (!res.ok) throw new Error("인덱스 로드 실패: " + res.status);
  const data = await res.json();
  meta = data.meta;
  verses = data.verses;
  loading = false;
}

// Verse reference pattern: "창세 1:3" or "창세 1:3-11"
const REF_RE = /^([가-힣a-zA-Z0-9\s]+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[-–]\s*(\d+))?\s*$/;

function tryVerseRef(query) {
  const m = query.match(REF_RE);
  if (!m) return null;

  const bookQuery = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const verse = parseInt(m[3], 10);
  const verseEnd = m[4] ? parseInt(m[4], 10) : null;

  // Look up alias
  let bookId = meta.aliases[bookQuery];

  // Fallback: try matching full book name from meta.books
  if (!bookId) {
    for (const [id, info] of Object.entries(meta.books)) {
      if (info.ko === bookQuery) { bookId = id; break; }
    }
  }

  if (!bookId || !meta.books[bookId]) return null;

  return {
    bookId,
    chapter,
    verse,
    verseEnd,
    bookNameKo: meta.books[bookId].ko,
  };
}

function search(query, page, pageSize) {
  const q = query.toLowerCase();
  const matched = [];

  for (let i = 0; i < verses.length; i++) {
    if (verses[i].t.toLowerCase().includes(q)) {
      matched.push(verses[i]);
    }
  }

  // Already sorted by book order/chapter/verse from index build
  const total = matched.length;
  const start = (page - 1) * pageSize;
  const end = Math.min(total, start + pageSize);
  const results = [];

  for (let i = start; i < end; i++) {
    const e = matched[i];
    results.push({
      b: e.b,
      c: e.c,
      v: e.v,
      t: e.t,
      bookNameKo: meta.books[e.b].ko,
    });
  }

  return { results, total };
}

onmessage = async (ev) => {
  const msg = ev.data;

  if (msg.type === "init") {
    indexUrl = msg.indexUrl;
    try {
      await loadIndex();
      post("ready", {});
    } catch (err) {
      post("error", { message: err.message });
    }
    return;
  }

  if (msg.type === "search") {
    try {
      await loadIndex();
      const q = (msg.q || "").trim();
      const page = msg.page || 1;
      const pageSize = msg.pageSize || 50;

      if (!q) {
        post("results", { q, refMatch: null, results: [], total: 0, page, pageSize });
        return;
      }

      // Try verse reference first
      const refMatch = tryVerseRef(q);
      if (refMatch) {
        post("results", { q, refMatch, results: [], total: 0, page, pageSize });
        return;
      }

      // Full-text search
      const { results, total } = search(q, page, pageSize);
      post("results", { q, refMatch: null, results, total, page, pageSize });
    } catch (err) {
      post("error", { message: err.message });
    }
    return;
  }
};
