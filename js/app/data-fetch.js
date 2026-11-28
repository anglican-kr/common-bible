// @ts-check
"use strict";

// Data fetching — extracted from views.js (ADR-034 PR2, follow-up to
// ADR-018). Leaf module: fetch wrappers + module-level caches (booksCache /
// appVersion) that feed Views/Routing and external modules. No DOM, no
// app-module dependencies — the lowest layer of the views split.

/** @typedef {import("../types.js").BooksData} BooksData */
/** @typedef {import("../types.js").BibleChapter} BibleChapter */
/** @typedef {import("../types.js").BiblePrologue} BiblePrologue */

const DATA_DIR = "/data";

// Module state. Views/Routing read the books through loadBooks()'s return
// value; external modules read the caches via window.getBooksCache() /
// window.appVersion.
/** @type {BooksData | null} */
let booksCache = null;
/** @type {string | null} */
let appVersion = null;

// ── BEGIN DATA_FETCHING ──
// Exercised by tests/unit/views.test.js (marker slice + prelude stubs
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
  let data;
  try {
    data = await promise;
  } catch (err) {
    // A failed pre-fetch must not stay cached — the next call fetches again (the 송가 names of the lectionary view
    // depend on this list, ADR-047 §5).
    if (promise === window.booksPromise) window.booksPromise = undefined;
    throw err;
  }
  booksCache = data;
  return data;
}

/** @type {Promise<string> | null} */
let versionPromise = null;

/** @returns {Promise<string>} */
async function loadVersion() {
  if (appVersion) return appVersion;
  // The settings view (drawn before boot's idle call) and app.js can both ask while the first fetch is in flight:
  // share it, so a late failure of a second fetch cannot overwrite the first one's result.
  if (!versionPromise) versionPromise = fetchVersion().finally(() => { versionPromise = null; });
  return versionPromise;
}

/** @returns {Promise<string>} */
async function fetchVersion() {
  try {
    const [res, dataCommit] = await Promise.all([fetch("/version.json"), fetchDataCommit()]);
    const data = await res.json();
    appVersion = data.version;
    // Build ids (ADR-052): only the copy zipped by the server repo's build-deploy.sh has them.
    // 데이터는 앱과 따로 배포한다(ADR-061 §6). 데이터 커밋은 데이터 빌드의 data-version.json이 알려 주고,
    // 그 파일이 없는 사이트(전환 전)에서는 앱 빌드의 version.json에 적힌 값을 쓴다.
    window.appBuild = {
      app: typeof data.app_commit === "string" ? data.app_commit : "",
      data: dataCommit ?? (typeof data.data_commit === "string" ? data.data_commit : ""),
    };
  } catch {
    appVersion = "";
    window.appBuild = null;
  }
  // Mirror to window so settings-ui.js can read it for the version footer.
  window.appVersion = appVersion;
  return appVersion ?? "";
}

/**
 * The data build's commit from /data/data-version.json (ADR-061 §2), or null when the site has no such file
 * (before the split, or a local server: the repo's copy carries the format only) or it cannot be read.
 * @returns {Promise<string | null>}
 */
async function fetchDataCommit() {
  try {
    const res = await fetch(`${DATA_DIR}/data-version.json`);
    if (!res.ok) return null;
    const info = await res.json();
    return info && typeof info.commit === "string" ? info.commit : null;
  } catch {
    return null;
  }
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

// In-module callers (views.js route / renderChapter / renderPrologue)
// receive these as explicit ESM imports.
export { loadBooks, loadVersion, loadChapter, loadPrologue, getBooksCache };
