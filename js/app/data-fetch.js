"use strict";
// @ts-check

// Data fetching — extracted from views-routing.js (ADR-034 PR2, follow-up to
// ADR-018). Leaf module: fetch wrappers + module-level caches (booksCache /
// appVersion) that feed Views/Routing and external modules. No DOM, no
// app-module dependencies — the lowest layer of the views-routing split.

/** @typedef {import("../types").BooksData} BooksData */
/** @typedef {import("../types").BibleChapter} BibleChapter */
/** @typedef {import("../types").BiblePrologue} BiblePrologue */

const DATA_DIR = "/data";

// Module state. Views/Routing read the books through loadBooks()'s return
// value; external modules read the caches via window.getBooksCache() /
// window.appVersion.
/** @type {BooksData | null} */
let booksCache = null;
/** @type {string | null} */
let appVersion = null;

// ── BEGIN DATA_FETCHING ──
// Exercised by tests/unit/views-routing.test.js (marker slice + prelude stubs
// for DATA_DIR / booksCache / appVersion / window). The 4 functions are fetch
// wrappers with caching: loadBooks/loadVersion update module state
// (booksCache/appVersion); loadChapter/loadPrologue are pure pass-throughs.

/** @returns {Promise<BooksData>} */
async function loadBooks() {
  if (booksCache) return booksCache;
  // Use pre-fetched promise if available (js/pre-fetch.js sets window.booksPromise)
  const promise = window.booksPromise || fetch(`${DATA_DIR}/books.json`).then((res) => {
    if (!res.ok) throw new Error("Failed to load books.json");
    return res.json();
  });
  const data = await promise;
  booksCache = data;
  return data;
}

/** @returns {Promise<string>} */
async function loadVersion() {
  if (appVersion) return appVersion;
  try {
    const res = await fetch("/version.json");
    const data = await res.json();
    appVersion = data.version;
  } catch {
    appVersion = "";
  }
  // Mirror to window so settings-ui.js can read it for the version footer.
  window.appVersion = appVersion;
  return appVersion ?? "";
}

/**
 * @param {string} bookId
 * @param {number} chapter
 * @returns {Promise<BibleChapter>}
 */
async function loadChapter(bookId, chapter) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-${chapter}.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-${chapter}.json`);
  return res.json();
}

/** @param {string} bookId @returns {Promise<BiblePrologue>} */
async function loadPrologue(bookId) {
  const res = await fetch(`${DATA_DIR}/bible/${bookId}-prologue.json`);
  if (!res.ok) throw new Error(`Failed to load ${bookId}-prologue.json`);
  return res.json();
}
// ── END DATA_FETCHING ──

/** @returns {BooksData | null} */
function getBooksCache() { return booksCache; }

// ── Window facade ──
// External callers stay on window (out of ADR-034 PR2 scope, migrate when those
// modules are touched): search.js (loadBooks), app.js (loadVersion), bookmark.js
// (getBooksCache); settings-ui.js reads the window.appVersion that loadVersion
// mirrors. window.booksPromise is owned by js/pre-fetch.js and only read here.
window.loadBooks = loadBooks;
window.loadVersion = loadVersion;
window.loadChapter = loadChapter;
window.loadPrologue = loadPrologue;
window.getBooksCache = getBooksCache;

// In-module callers (views-routing.js route / renderChapter / renderPrologue)
// receive these as explicit ESM imports.
export { loadBooks, loadVersion, loadChapter, loadPrologue, getBooksCache };
