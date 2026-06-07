"use strict";
// @ts-check

// Search engine wire-up + UI controllers (desktop top-bar + mobile full-screen
// /search view + history panel). Owns the Worker lifetime (`searchWorker`), all
// `$search*` DOM anchors, and the search-internal module state
// (`searchAutoNavigate`). The mobile bottom sheet was removed with the search
// FAB (ADR-030) — mobile search is the tab-bar morph → /search route.
//
// Phase 5 of the app.js modularization (ADR-018). ESM-pattern (ADR-019):
// named exports + window facade for legacy app.js callers (route handler at
// `/search?q=`).

/** @typedef {import("../types").SearchHistoryList} SearchHistoryList */

const { _$, el, clearNode, chUnit, emptyState } = window.appHelpers;
const {
  SEARCH_HISTORY_MAX,
  loadSearchHistory, pushSearchHistory, removeSearchHistory, clearSearchHistory,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;

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

function ensureSearchWorker() {
  if (searchWorker) return searchWorker;
  searchWorker = new Worker("/js/search-worker.js");
  searchWorker.addEventListener("message", (ev) => {
    const msg = ev.data;
    if (msg.type === "partial-results" && msg.searchId === activeSearchId) {
      if (partialResultsCb) partialResultsCb(msg);
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
    ],
  });
  return searchWorker;
}

/**
 * @param {string} query
 * @param {number} page
 * @param {number} pageSize
 * @param {((partial: any) => void) | null} [onPartial]
 * @param {{ scopeBooks?: string[], andTerms?: string[] }} [opts]
 *   scopeBooks — book-picker filter (book ids); andTerms — "결과 내 검색"
 *   AND keywords. Both forwarded to the worker (ADR-033).
 */
function doSearch(query, page, pageSize, onPartial, opts) {
  return new Promise((resolve) => {
    const worker = ensureSearchWorker();
    activeSearchId += 1;
    pendingSearchCb = resolve;
    partialResultsCb = onPartial || null;
    worker.postMessage({
      type: "search", q: query, page, pageSize, searchId: activeSearchId,
      scopeBooks: (opts && opts.scopeBooks) || [],
      andTerms: (opts && opts.andTerms) || [],
    });
  });
}
// ── END WORKER WIRE-UP ──

// ── BEGIN PURE HELPERS ──
// Exercised by tests/unit/search.test.js. Each function takes its DOM
// target via parameters and creates new nodes via `el` / createTextNode /
// createDocumentFragment — no reliance on the module-level $X anchors.
// Test loader extracts this block with a minimal Element stub + el shim.
// Text highlight helper: splits text on query matches and wraps in <mark>
/**
 * @param {Node} target
 * @param {string} text
 * @param {string} query
 */
function appendTextWithHighlight(target, text, query) {
  if (!query) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(qLower, pos);
  if (idx === -1) {
    target.appendChild(document.createTextNode(text));
    return;
  }
  while (idx !== -1) {
    if (idx > pos) target.appendChild(document.createTextNode(text.substring(pos, idx)));
    target.appendChild(el("mark", { className: "search-highlight", role: "presentation" }, text.substring(idx, idx + query.length)));
    pos = idx + query.length;
    idx = lower.indexOf(qLower, pos);
  }
  if (pos < text.length) target.appendChild(document.createTextNode(text.substring(pos)));
}

// Build snippet with highlighted query for search results
/**
 * @param {string} text
 * @param {string} query
 */
function buildSnippet(text, query) {
  const frag = document.createDocumentFragment();
  const span = el("span", { className: "search-result-text" });

  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const matchIdx = lower.indexOf(qLower);

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
 * Build a /search URL from structured state (ADR-033). Pure — uses only
 * encodeURIComponent — so the book-picker scope (`in=`) and "결과 내 검색" AND
 * keywords (`and=`) round-trip through the URL (mirrors parsePath). `page` is
 * dropped when 1; empty params are omitted.
 * @param {{ q?: string, page?: number, filterBooks?: string[], andTerms?: string[] }} state
 * @returns {string}
 */
function buildSearchUrl(state) {
  const parts = [];
  if (state.q) parts.push("q=" + encodeURIComponent(state.q));
  if (state.page && state.page > 1) parts.push("page=" + state.page);
  for (const b of state.filterBooks || []) parts.push("in=" + encodeURIComponent(b));
  for (const t of state.andTerms || []) parts.push("and=" + encodeURIComponent(t));
  return "/search" + (parts.length ? "?" + parts.join("&") : "");
}

/**
 * @param {{ q?: string, filterBooks?: string[], andTerms?: string[] }} state
 * @param {number} currentPage
 * @param {number} totalPages
 */
function buildSearchPagination(state, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  /** @param {number} p */
  const pageUrl = (p) => buildSearchUrl({
    q: state.q, page: p, filterBooks: state.filterBooks, andTerms: state.andTerms,
  });

  if (currentPage > 1) {
    nav.appendChild(el("a", { href: pageUrl(currentPage - 1) }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", { href: pageUrl(currentPage + 1) }, "다음 →"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  return nav;
}
// ── END PURE HELPERS ──

// Render search result list into a container node (used by both page and sheet views)
/**
 * @param {HTMLElement} container
 * @param {any} result
 * @param {string} query
 * @param {number} page
 * @param {number} pageSize
 * @param {((q: string, p: number, t: number) => HTMLElement) | null} paginationBuilder
 */
function renderSearchResultList(container, result, query, page, pageSize, paginationBuilder) {
  clearNode(container);

  const hasRef = !!result.refMatch;
  const hasResults = result.results && result.results.length > 0;
  // The worker strips `in:<alias>` tokens; use the resulting keyword for
  // snippet highlighting and `?hl=` so users opening a result see their
  // search term highlighted (the raw query would never match the verse text).
  const highlightTerm = result.keyword || query;

  // Unrecognized in:<alias> notice. Worker blocks search in this case
  // (results = 0) so the notice replaces what would otherwise be a silent
  // empty state.
  if (result.unmatchedScopes && result.unmatchedScopes.length > 0) {
    const aliasList = result.unmatchedScopes.map((/** @type {string} */ a) => `in:${a}`).join(", ");
    container.appendChild(el("p", { className: "search-notice" }, `${aliasList} — 알 수 없는 책 별칭입니다`));
  }

  if (!hasRef && result.total === 0) {
    if (!result.unmatchedScopes || result.unmatchedScopes.length === 0) {
      container.appendChild(
        buildSearchEmptyState("검색 결과가 없습니다", `‘${query}’에 해당하는 구절을 찾지 못했어요. 다른 낱말로 검색하거나 띄어쓰기를 바꿔 보세요.`)
      );
    }
    return;
  }

  const list = el("ul", { className: "search-results", role: "list" });

  // 1. Display Reference Match Card if exists
  if (hasRef) {
    const ref = result.refMatch;
    const unit = chUnit(ref.bookId);
    let label = `${ref.bookNameKo} ${ref.chapter}${unit}`;
    if (ref.verse) label += ` ${ref.verse}절`;
    if (ref.verseEnd) label += `-${ref.verseEnd}절`;

    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }

    const li = el("li", { className: "search-result-item ref-match-item" });
    const link = el("a", { href: path, className: "search-result-ref-card" });
    link.appendChild(el("span", { className: "search-result-ref-label" }, "구절 바로가기"));
    link.appendChild(el("span", { className: "search-result-ref-title" }, label));
    li.appendChild(link);
    list.appendChild(li);
  }

  // 2. Display existing Search Results
  const totalPages = Math.ceil(result.total / pageSize);
  const isPending = result.pendingChunks && result.pendingChunks.length > 0;

  if (hasResults || isPending) {
    const countLabel = isPending
      ? `"${query}" 검색 중… (현재 ${result.total}건)`
      : `총 ${result.total}건 (${page}/${totalPages}쪽)`;
    container.appendChild(el("p", { className: "search-count" }, countLabel));

    for (const r of result.results) {
      const li = el("li", { className: "search-result-item" });
      const link = el("a", { href: `/${r.b}/${r.c}/${r.v}?hl=${encodeURIComponent(highlightTerm)}` });
      link.appendChild(el("span", { className: "search-result-ref" }, `${r.bookNameKo} ${r.c}:${r.v}`));
      link.appendChild(buildSnippet(r.t, highlightTerm));
      li.appendChild(link);
      list.appendChild(li);
    }
  }

  container.appendChild(list);

  if (!isPending && totalPages > 1 && paginationBuilder) {
    container.appendChild(paginationBuilder(query, page, totalPages));
  }
}

// ── In-page search input (mobile full-screen view, ADR-029 / P2) ──
// The mobile tab bar routes /search to a full-screen in-page view instead of
// the bottom sheet. This builds a minimal search input bar (mirroring the
// header #search-bar markup) wired to commit via the URL (/search?q=...), so it
// reuses the same routing + history path as the desktop top bar. Returns the
// wrapper element; `autofocus` opens the keyboard when entering with no query.
/**
 * @param {string} query
 * @param {boolean} [autofocus]
 * @returns {HTMLElement}
 */
function buildInPageSearchInput(query, autofocus = false) {
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
  clear.hidden = !query;

  input.addEventListener("input", () => { clear.hidden = !input.value.trim(); });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitTopSearch(input.value);
  });
  clear.addEventListener("click", () => {
    input.value = "";
    clear.hidden = true;
    input.focus();
    // Drop the query (back to the recents/empty view) but keep the book-picker
    // scope so a cleared field doesn't silently reset the filter (ADR-033).
    if (window.parsePath().view === "search") navigateSearch({ q: "", andTerms: [] });
  });

  wrap.appendChild(input);
  wrap.appendChild(clear);
  if (autofocus) requestAnimationFrame(() => input.focus());
  return wrap;
}

// ── Search options: book-picker scope + "결과 내 검색" + recents (ADR-033) ──
// Filter state is URL-encoded (parsePath → { filterBooks, andTerms }) so it
// survives history/back-forward and tab restore (ADR-031). currentSearchState
// reads the live URL; navigateSearch patches it and routes. A filter change
// resets pagination to page 1 (unless the patch sets page) and never sets
// searchAutoNavigate — only an explicit query commit (commitTopSearch) may
// auto-jump to a verse reference.

/** @returns {{ q: string, page: number, filterBooks: string[], andTerms: string[] }} */
function currentSearchState() {
  const p = window.parsePath();
  return {
    q: p.query || "",
    page: p.page || 1,
    filterBooks: (p.filterBooks || []).slice(),
    andTerms: (p.andTerms || []).slice(),
  };
}

/** @param {{ q?: string, page?: number, filterBooks?: string[], andTerms?: string[] }} patch */
function navigateSearch(patch) {
  const next = Object.assign(currentSearchState(), patch);
  if (!("page" in patch)) next.page = 1;
  const url = buildSearchUrl(next);
  if (location.pathname + location.search === url) window.route();
  else window.navigate(url);
}

// Lazy book-id → 한국어 이름 map, used for filter chip labels. Resolved on
// demand (renderSearchResults awaits it before building the filter bar) rather
// than at module load — search.js loads before views-routing.js, so
// window.loadBooks isn't defined yet at init. On failure the cache stays null so
// a later render retries; chips fall back to the raw id until names arrive.
/** @type {{ [id: string]: string } | null} */
let _bookMap = null;
async function ensureBookMap() {
  if (_bookMap) return _bookMap;
  try {
    if (typeof window.loadBooks !== "function") return {};
    const books = await window.loadBooks();
    /** @type {{ [id: string]: string }} */
    const map = {};
    for (const b of books) map[b.id] = b.name_ko;
    _bookMap = map;
    return _bookMap;
  } catch {
    return {}; // leave _bookMap null so a later render retries
  }
}
/** @param {string} id */
function bookName(id) {
  return (_bookMap && _bookMap[id]) || id;
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

// A removable filter pill (book scope chip / 결과 내 검색어 chip).
/**
 * @param {string} label
 * @param {string} removeAria
 * @param {() => void} onRemove
 */
function buildFilterChip(label, removeAria, onRemove) {
  const chip = el("span", { className: "search-chip" });
  chip.appendChild(el("span", { className: "search-chip-label" }, label));
  const x = el("button", { type: "button", className: "search-chip-remove", "aria-label": removeAria });
  x.appendChild(el("span", { "aria-hidden": "true" }, "×"));
  x.addEventListener("click", onRemove);
  chip.appendChild(x);
  return chip;
}

// The search-options bar shown above the empty view and results. Row 1 is the
// scope: a "책 선택" button (opens the book-filter sheet) + a removable chip per
// selected book. Row 2 is "결과 내 검색" — shown only when there's a primary
// query (it narrows an existing result set, ADR-033): a chip per AND term + an
// input to add another. The scope row is the future home of a 성서/노트 segment
// (the request notes notes-search is coming); the bar already isolates that
// concern from the query field.
/**
 * @param {{ q?: string, filterBooks?: string[], andTerms?: string[] }} state
 */
function buildSearchFilterBar(state) {
  const filterBooks = state.filterBooks || [];
  const andTerms = state.andTerms || [];
  const bar = el("div", { className: "search-filters" });

  const scopeRow = el("div", { className: "search-scope-row" });
  const scopeBtn = el("button", {
    type: "button",
    className: filterBooks.length ? "search-scope-btn active" : "search-scope-btn",
    "aria-haspopup": "dialog",
  });
  scopeBtn.appendChild(svgIcon("search-scope-icon", ["M3 5h18l-7 8v6l-4 2v-8z"]));
  scopeBtn.appendChild(el("span", {}, filterBooks.length ? `책 ${filterBooks.length}권` : "책 선택"));
  scopeBtn.addEventListener("click", () => openBookFilterSheet(scopeBtn));
  scopeRow.appendChild(scopeBtn);

  for (const id of filterBooks) {
    const name = bookName(id);
    scopeRow.appendChild(buildFilterChip(name, `책 범위에서 ${name} 제거`, () => {
      navigateSearch({ filterBooks: currentSearchState().filterBooks.filter((b) => b !== id) });
    }));
  }
  bar.appendChild(scopeRow);

  if (state.q) {
    const refineRow = el("div", { className: "search-refine-row" });
    for (const term of andTerms) {
      refineRow.appendChild(buildFilterChip(term, `결과 내 검색어 ${term} 제거`, () => {
        navigateSearch({ andTerms: currentSearchState().andTerms.filter((t) => t !== term) });
      }));
    }
    const refineInput = /** @type {HTMLInputElement} */ (el("input", {
      type: "search",
      className: "search-refine-input",
      inputmode: "search",
      enterkeyhint: "search",
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      autocomplete: "off",
      placeholder: "결과 내 검색",
      "aria-label": "결과 내 검색",
    }));
    refineInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const term = refineInput.value.trim();
      if (!term) return;
      const cur = currentSearchState();
      if (cur.andTerms.includes(term)) { refineInput.value = ""; return; }
      navigateSearch({ andTerms: cur.andTerms.concat(term) });
    });
    refineRow.appendChild(refineInput);
    bar.appendChild(refineRow);
  }

  return bar;
}

// ── Book-filter sheet (book picker) ──
// Bottom sheet (mobile) / centered dialog (desktop, CSS) listing every book
// grouped by division (respecting the 외경 book-order setting). Multi-select
// toggles a working Set; "적용" commits it to the URL scope in one navigation,
// "초기화" clears it. Built lazily as a body-level singleton (sibling of #app),
// driven by the shared overlay controller (ADR-032).

const BOOK_FILTER_INERT_SELECTORS =
  "#sticky-group, main#app, #app-header, #audio-bar, #launch-screen, #tab-dock, #verse-select-bar";

/** @type {{ overlay: any, body: HTMLElement, working: Set<string>, updateApplyLabel: () => void } | null} */
let _bookSheet = null;

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

  const handle = el("div", { className: "book-filter-handle", "aria-hidden": "true" });
  const head = el("div", { className: "book-filter-head" });
  head.appendChild(el("h2", { id: "book-filter-title", className: "book-filter-title" }, "책 선택"));
  const resetBtn = el("button", { type: "button", className: "book-filter-reset" }, "초기화");
  head.appendChild(resetBtn);

  const body = el("div", { className: "book-filter-body" });
  const foot = el("div", { className: "book-filter-foot" });
  const applyBtn = el("button", { type: "button", className: "book-filter-apply" }, "적용");
  foot.appendChild(applyBtn);

  panel.appendChild(handle);
  panel.appendChild(head);
  panel.appendChild(body);
  panel.appendChild(foot);
  document.body.appendChild(scrim);
  document.body.appendChild(panel);

  /** @type {Set<string>} */
  const working = new Set();
  function updateApplyLabel() {
    applyBtn.textContent = working.size ? `적용 (${working.size})` : "적용";
  }

  const overlay = window.appOverlay.createOverlay({
    panel,
    scrim,
    closeOnEsc: true,
    closeOnOutside: true,
    inertSelectors: BOOK_FILTER_INERT_SELECTORS,
    initialFocus: () => applyBtn,
  });
  window.appOverlay.attachSheetDrag(handle, panel, { onClose: () => overlay.close() });

  resetBtn.addEventListener("click", () => {
    working.clear();
    body.querySelectorAll(".book-filter-option").forEach((o) => o.setAttribute("aria-selected", "false"));
    updateApplyLabel();
  });
  applyBtn.addEventListener("click", () => {
    navigateSearch({ filterBooks: Array.from(working) });
    overlay.close();
  });
  body.addEventListener("click", (e) => {
    const t = /** @type {Element} */ (e.target);
    const row = t.closest(".book-filter-option");
    if (!row) return;
    const id = /** @type {HTMLElement} */ (row).dataset.bookId || "";
    if (working.has(id)) { working.delete(id); row.setAttribute("aria-selected", "false"); }
    else { working.add(id); row.setAttribute("aria-selected", "true"); }
    updateApplyLabel();
  });

  _bookSheet = { overlay, body, working, updateApplyLabel };
  return _bookSheet;
}

/**
 * @param {HTMLElement} body
 * @param {any[]} books  BooksData entries ({ id, name_ko, division, … }).
 * @param {Set<string>} working
 */
function renderBookFilterList(body, books, working) {
  clearNode(body);
  const order = window.divisionOrder();
  const labels = window.divisionLabels();
  for (const div of order) {
    const inDiv = books.filter((b) => window.effectiveDivision(b) === div);
    if (!inDiv.length) continue;
    const section = el("section", { className: "book-filter-section" });
    section.appendChild(el("h3", { className: "book-filter-section-title" }, labels[div]));
    const ul = el("ul", {
      className: "book-filter-list",
      role: "listbox",
      "aria-multiselectable": "true",
      "aria-label": labels[div],
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
      opt.appendChild(el("span", { className: "book-filter-name" }, b.name_ko));
      opt.appendChild(svgIcon("book-filter-check", ["M5 13l4 4L19 7"]));
      li.appendChild(opt);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    body.appendChild(section);
  }
}

/** @param {HTMLElement} [returnFocusEl] */
async function openBookFilterSheet(returnFocusEl) {
  const sheet = ensureBookSheet();
  await ensureBookMap();
  const books = await window.loadBooks().catch(() => []);
  sheet.working.clear();
  for (const id of currentSearchState().filterBooks) sheet.working.add(id);
  renderBookFilterList(sheet.body, books, sheet.working);
  sheet.updateApplyLabel();
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
  const list = loadSearchHistory();
  if (!list.length) return null;
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
  for (const q of list) {
    const li = el("li", { className: "search-recent-item" });
    const select = el("button", { type: "button", className: "search-recent-select" });
    select.appendChild(svgIcon("search-recent-icon", ["M12 7v5l3 2"], [[12, 12, 8]]));
    select.appendChild(el("span", { className: "search-recent-text" }, q));
    select.addEventListener("click", () => commitTopSearch(q));
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
    host.appendChild(buildSearchEmptyState("찾고 싶은 말씀을 검색해 보세요", SEARCH_INTRO_HELP));
    host.appendChild(buildSearchExamples());
  }
}

// Friendly guidance for the empty-query /search view — mirrors the bookmark
// list's explanatory empty state (BOOKMARK_ADD_HELP), but instead of cramming
// every search form into one run-on sentence it lays them out as a small
// "검색 방법" guide (example query + what it does) that's easier to scan.
const SEARCH_INTRO_HELP = "낱말, 책 이름, 장·절로 찾을 수 있습니다.";

// Each row of the 검색 방법 guide: the example query the user can type + a short
// plain-language description of what that form does. Mirrors the in-field
// placeholder examples (예: 사랑, 사랑 in:요한, 창세 1:3).
const SEARCH_EXAMPLES = [
  { q: "사랑", desc: "성경 전체에서 낱말 찾기" },
  { q: "사랑 in:요한", desc: "특정 책 안에서만 찾기" },
  { q: "창세 1:3", desc: "장·절로 그 구절 바로 펼치기" },
];

// Build the 검색 방법 guide as a definition-style list (example → description).
// Tapping a row fills + commits that example so users can try it without typing.
function buildSearchExamples() {
  const wrap = el("div", { className: "search-examples" });
  wrap.appendChild(el("p", { className: "search-examples-heading" }, "이렇게 검색해 보세요"));
  const list = el("ul", { className: "search-examples-list", role: "list" });
  for (const { q, desc } of SEARCH_EXAMPLES) {
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
function renderSearchView(state) {
  const filterBooks = (state && state.filterBooks) || [];
  ensureBookMap(); // warm names for the next render (safe — all modules loaded)
  window.setTitle("검색");
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);
  const view = el("div", { className: "search-view" });
  // During the tab-bar morph the bottom dock input owns focus; don't let the
  // (hidden) in-page input grab it back via autofocus.
  const morphing = document.body.classList.contains("tabbar-searching");
  view.appendChild(buildInPageSearchInput("", !morphing));
  view.appendChild(buildSearchFilterBar({ q: "", filterBooks, andTerms: [] }));
  const dyn = el("div", { className: "search-empty-dynamic" });
  view.appendChild(dyn);
  $app.appendChild(view);
  _emptyDynHost = dyn;
  renderEmptyDynamic(dyn);
}

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 * @param {{ filterBooks?: string[], andTerms?: string[] }} [opts]
 *   filterBooks — book-picker scope (book ids); andTerms — "결과 내 검색" AND
 *   keywords. Both come from the URL via parsePath (ADR-033).
 */
async function renderSearchResults(query, page, autoNavigate = false, opts = {}) {
  const filterBooks = opts.filterBooks || [];
  const andTerms = opts.andTerms || [];
  const state = { q: query, page, filterBooks, andTerms };
  window.setTitle(`"${query}" 검색`);
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  // Like every other main-header view, plant the mobile settings trigger so the
  // gear stays reachable if the window is resized down to the mobile breakpoint
  // while on this page (where #breadcrumb-row + #settings-anchor are hidden).
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);

  // Resolve book names before building the filter bar so deep-linked/restored
  // `in=` scope chips render with names rather than raw ids (ADR-033).
  await ensureBookMap();

  // Both layouts share the .search-view wrapper: the search-options bar (book
  // picker + 결과 내 검색) sits above results, which render into their own box so
  // re-rendering them never wipes the bar/input. Mobile also keeps an in-page
  // input pinned above (desktop uses the header bar).
  const view = el("div", { className: "search-view" });
  if (isMobile()) view.appendChild(buildInPageSearchInput(query, false));
  view.appendChild(buildSearchFilterBar(state));
  const resultsTarget = el("div", { className: "search-view-results" });
  view.appendChild(resultsTarget);
  $app.appendChild(view);

  resultsTarget.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  // Estimate page size from available viewport height
  const headerH = document.getElementById("app-header")?.offsetHeight || 80;
  const availH = window.innerHeight - headerH - 40;
  const itemH = 80;
  const pageSize = Math.max(5, Math.floor(availH / itemH));

  // Pagination links must carry the active book/AND filters (ADR-033); the
  // closure binds the current state so renderSearchResultList stays filter-agnostic.
  const paginationBuilder = (/** @type {string} */ _q, /** @type {number} */ p, /** @type {number} */ t) =>
    buildSearchPagination(state, p, t);

  /** @param {any} partial */
  function onPartial(partial) {
    renderSearchResultList(resultsTarget, partial, query, page, pageSize, paginationBuilder);
    window.announce(`"${query}" 검색 중… 현재 ${partial.total}건`);
  }

  const result = await doSearch(query, page, pageSize, onPartial, { scopeBooks: filterBooks, andTerms });

  if (!result) {
    window.renderError("검색에 실패했습니다.");
    return;
  }

  // Verse reference match — navigate only when explicitly confirmed (Enter key).
  // On debounce, show a clickable card so partial input (e.g. "요한 3:1" while
  // typing "요한 3:16") doesn't cause premature navigation.
  if (result.refMatch) {
    const ref = result.refMatch;
    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      dismissLaunchScreen();
      history.replaceState(null, "", path);
      window.route();
    } else {
      // Show the refMatch as a clickable result, and ensure UI is visible
      renderSearchResultList(resultsTarget, result, query, page, pageSize, paginationBuilder);
      dismissLaunchScreen();
    }
    return;
  }

  renderSearchResultList(resultsTarget, result, query, page, pageSize, paginationBuilder);
  dismissLaunchScreen();

  window.announce(`"${query}" 검색 결과 ${result.total}건`);
  window.scrollTo(0, 0);
}

// ── Search input event handlers (Desktop inline) ──

// Search is Enter-triggered only — live (debounced) search interfered with
// multi-token queries like `사랑 in:요한`, where each intermediate keystroke
// fired a useless substring search. searchAutoNavigate stays as a flag so
// renderSearchResults can distinguish Enter-confirmed searches (auto-navigate
// to verse references) from URL-triggered ones (show clickable card).
let searchAutoNavigate = false;

/** @param {string} rawQuery */
function commitTopSearch(rawQuery) {
  const q = (rawQuery || "").trim();
  if (!q) return;
  pushSearchHistory(q);
  if (topSearchHistory) topSearchHistory.refresh();
  searchAutoNavigate = true;
  // Keep the book-picker scope across a fresh query, but reset 결과 내 검색 (it
  // refines a specific result set) and pagination (ADR-033).
  const cur = currentSearchState();
  const newPath = buildSearchUrl({ q, page: 1, filterBooks: cur.filterBooks, andTerms: [] });
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
  if (window.parsePath().view === "search") window.navigate("/");
});

// ── BEGIN IS_MOBILE ──
function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
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
function createSearchHistoryController({ wrap, input, toggle, panel, clearBtn, onSelect, syncClearHidden }) {
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
    const remove = e.target.closest(".search-history-item-remove");
    if (remove) {
      e.preventDefault();
      e.stopPropagation();
      removeSearchHistory(remove.dataset.removeQuery);
      refresh();
      return;
    }
    const more = e.target.closest(".search-history-more");
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      expandMore();
      return;
    }
    const clearAllBtn = e.target.closest(".search-history-clear");
    if (clearAllBtn) {
      e.preventDefault();
      e.stopPropagation();
      clearSearchHistory();
      refresh();
      input.focus({ preventScroll: true });
      return;
    }
    const select = e.target.closest(".search-history-item-select");
    if (select) {
      e.preventDefault();
      e.stopPropagation();
      pickQuery(select.dataset.query);
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!isOpen()) return;
    if (panel.contains(e.target) || toggle.contains(e.target) || input.contains(e.target)) return;
    close();
  });

  return {
    open,
    close,
    isOpen,
    refresh,
    syncToggleVisibility,
    consumeEnter(e) {
      if (!isOpen() || activeIndex < 0) return false;
      const opts = panel.querySelectorAll(".search-history-item-select");
      const target = opts[activeIndex];
      if (!target) return false;
      e.preventDefault();
      e.stopPropagation();
      pickQuery(target.dataset.query);
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
  onSelect: (q) => commitTopSearch(q),
});
topSearchHistory.syncToggleVisibility();


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
// chapter renderer reuses appendTextWithHighlight for ?hl= snippet highlighting).
// ADR-030: 탭 바 하단 모핑 입력이 검색을 커밋할 때 재사용.
window.commitTopSearch = commitTopSearch;
window.renderSearchResults = renderSearchResults;
window.renderSearchView = renderSearchView;
window.isMobile = isMobile;
window.appendTextWithHighlight = appendTextWithHighlight;
window.consumeSearchAutoNavigate = consumeSearchAutoNavigate;
window.appSearch = {
  renderSearchResults, renderSearchView,
  isMobile, appendTextWithHighlight, consumeSearchAutoNavigate,
};

export {
  renderSearchResults, renderSearchView,
  isMobile, appendTextWithHighlight, consumeSearchAutoNavigate,
};
