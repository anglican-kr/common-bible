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
  loadSearchHistory, loadSearchHistoryEntries,
  pushSearchHistory, removeSearchHistory, clearSearchHistory,
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
 * @param {{ scopeBooks?: string[] }} [opts]
 *   scopeBooks — book-picker filter (book ids), forwarded to the worker (ADR-033).
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
 * encodeURIComponent — so the book-picker scope (`in=`) round-trips through the
 * URL (mirrors parsePath). `page` is dropped when 1; empty params are omitted.
 * @param {{ q?: string, page?: number, filterBooks?: string[] }} state
 * @returns {string}
 */
function buildSearchUrl(state) {
  const parts = [];
  if (state.q) parts.push("q=" + encodeURIComponent(state.q));
  if (state.page && state.page > 1) parts.push("page=" + state.page);
  for (const b of state.filterBooks || []) parts.push("in=" + encodeURIComponent(b));
  return "/search" + (parts.length ? "?" + parts.join("&") : "");
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
 * @param {{ q?: string, filterBooks?: string[] }} state
 * @param {number} currentPage
 * @param {number} totalPages
 */
function buildSearchPagination(state, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  /** @param {number} p */
  const pageUrl = (p) => buildSearchUrl({
    q: state.q, page: p, filterBooks: state.filterBooks,
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
    if (window.parsePath().view === "search") navigateSearch({ q: "" });
  });

  wrap.appendChild(input);
  wrap.appendChild(clear);
  // Mount in-field tokens (book scope) so the in-page bar is the
  // single search surface on mobile — no separate filter bar (ADR-033 개정 B).
  mountSearchField(wrap, input);
  if (autofocus) requestAnimationFrame(() => input.focus());
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

// Lazy book-id → 한국어 이름 map, used for filter chip labels. Resolved on
// demand (renderSearchResults awaits it before building the filter bar) rather
// than at module load — search.js loads before views.js, so
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
    // Token chips use the Korean short name (창세, 요한) — the full name (창세기,
    // 요한의 복음서) overflows the compact in-field chip. Fall back to name_ko.
    for (const b of books) map[b.id] = b.short_name_ko || b.name_ko;
    _bookMap = map;
    return _bookMap;
  } catch {
    return {}; // leave _bookMap null so a later render retries
  }
}
// alias(소문자) → book id, for absorbing typed/example `in:<alias>` operators
// into book-scope chips at commit time. Built from book short + full Korean
// names (covers the common cases); the worker still resolves any alias we miss
// from search-meta, so an unresolved token simply stays as text in `q`.
/** @type {Map<string, string> | null} */
let _aliasMap = null;
async function ensureAliasMap() {
  if (_aliasMap) return _aliasMap;
  /** @type {Map<string, string>} */
  const map = new Map();
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
    for (const b of books) {
      if (b.short_name_ko) map.set(b.short_name_ko.toLowerCase(), b.id);
      if (b.name_ko) map.set(b.name_ko.toLowerCase(), b.id);
    }
    _aliasMap = map;
  } catch { /* leave _aliasMap null so a later call retries */ }
  return _aliasMap || map;
}

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

// ── In-field search tokens (ADR-033 개정 2026-06-08 — option B) ──────────────
// Book-scope filters render as removable chips INSIDE the search field itself
// (HIG search tokens), so there is a single search surface — no separate filter
// bar. Mounted on each field container (header #search-bar, mobile in-page
// #search-inpage-bar, bottom morphing pill #tab-search-dock) and refreshed from
// the URL on every route via syncSearchFields(). The worker/URL schema (in=) is
// unchanged — only how the filters surface.

/** @typedef {{ container: HTMLElement, input: HTMLInputElement, zone: HTMLElement, funnel: HTMLElement, focused?: boolean }} SearchField */
/** @type {SearchField[]} */
const _searchFields = [];

// One removable in-field token (a book scope or an AND term). Smaller than the
// old filter-bar chip — it sits inline with the typed query.
/**
 * @param {string} label
 * @param {string} removeAria
 * @param {() => void} onRemove
 */
function buildFieldToken(label, removeAria, onRemove) {
  const chip = el("span", { className: "field-token" });
  chip.appendChild(el("span", { className: "field-token-label" }, label));
  const x = el("button", {
    type: "button",
    className: "field-token-remove",
    "aria-label": removeAria,
    tabindex: "-1",
  });
  x.appendChild(el("span", { "aria-hidden": "true" }, "×"));
  // pointerdown preventDefault keeps the field input focused (no keyboard flicker
  // on the mobile pill); click does the removal.
  x.addEventListener("pointerdown", (e) => e.preventDefault());
  x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onRemove(); });
  chip.appendChild(x);
  return chip;
}

// Insert the token zone (funnel button + chip slot) just before `input` inside
// `container`, wire the field-level interactions (Backspace-to-remove) and
// register the field for
// syncSearchFields(). The zone uses display:contents so its children flex inline
// within the existing pill/bar row. Persistent fields (header, pill) mount once
// at load; the in-page bar mounts each time it's rebuilt (stale ones are pruned).
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

  zone.appendChild(funnel); // chips get appended after the funnel
  container.insertBefore(zone, input);

  // Backspace at caret 0 (empty selection) removes the last book-scope token
  // (mirrors iOS token fields).
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace") return;
    // Only fall through to token removal on an empty field with the caret at the
    // start — otherwise Backspace at caret 0 with text would eat a token instead
    // of doing normal in-field editing (Bugbot).
    if (input.value !== "" || input.selectionStart !== 0 || input.selectionEnd !== 0) return;
    const cur = currentSearchState();
    if (cur.filterBooks.length) {
      e.preventDefault();
      navigateSearch({ filterBooks: cur.filterBooks.slice(0, -1) });
    }
  });

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

// Refresh one field's chips + funnel state from the live URL. The pill is
// only usable while the tab-bar morph is open, so it stays empty otherwise.
/** @param {SearchField} field */
function syncOneField(field) {
  const { container, zone, funnel } = field;
  const p = window.parsePath?.() || {};
  const isPill = container.id === "tab-search-dock";
  // Desktop bare /search (no query/scope) renders the book list, not the search
  // view — don't surface the header token zone there (mirrors routing.js's
  // render condition; the old filter bar lived in the view so it never showed on
  // the book-list fallback). Mobile always renders the search view for /search.
  const searchView = p.view === "search" && (isMobile()
    || !!p.query || (p.filterBooks && p.filterBooks.length));
  // Reveal the token zone (funnel + any active chips) on the search view, OR
  // whenever the field itself is focused — so the book-filter funnel is reachable
  // from the search box on any screen, not only the search results view (user
  // request). Off the search view there's no URL scope, so the chip loop below is
  // empty and only the funnel shows. The pill (#tab-search-dock) is only live
  // during the tab-bar search morph, so keep that guard.
  const allowPill = !isPill || document.body.classList.contains("tabbar-searching");
  const active = allowPill && (searchView || field.focused === true);

  zone.querySelectorAll(".field-token").forEach((n) => n.remove());

  if (!active) {
    zone.hidden = true;
    return;
  }
  zone.hidden = false;

  const state = currentSearchState();
  const frag = document.createDocumentFragment();
  for (const id of state.filterBooks) {
    const name = bookName(id);
    frag.appendChild(buildFieldToken(name, `책 범위에서 ${name} 제거`, () => {
      navigateSearch({ filterBooks: currentSearchState().filterBooks.filter((b) => b !== id) });
    }));
  }
  zone.appendChild(frag);

  funnel.classList.toggle("active", state.filterBooks.length > 0);
}

// Refresh every mounted field (called from route() and the tab-bar morph). Prune
// detached in-page containers first so the list doesn't grow per render.
function syncSearchFields() {
  for (let i = _searchFields.length - 1; i >= 0; i--) {
    if (!_searchFields[i].container.isConnected) _searchFields.splice(i, 1);
  }
  for (const f of _searchFields) syncOneField(f);
  // route() can sync before a search view finishes ensureBookMap(); if a book
  // scope is active while names aren't loaded yet, book tokens would show raw
  // ids. Resolve the map and re-sync once so they flip to Korean names (Bugbot).
  if (!_bookMap && currentSearchState().filterBooks.length) {
    ensureBookMap().then((map) => {
      if (Object.keys(map).length) for (const f of _searchFields) syncOneField(f);
    });
  }
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
// The field whose funnel opened the sheet — "적용" focuses its query input so the
// user can type the term right away (keyboard up) instead of focus returning to
// the funnel (user request). Set in openBookFilterSheet.
/** @type {SearchField | null} */
let _bookSheetReturnField = null;
// Fallback timer for the animated close (cleared on animationend / reopen).
/** @type {ReturnType<typeof setTimeout> | null} */
let _bookSheetCloseTimer = null;

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
  // Close (×) for the desktop side-panel, matching the bookmark/cite panels; the
  // scrim and Esc still close too. Always present (cite-sheet shows × on mobile
  // too); harmless beside the mobile drag handle.
  const closeBtn = el("button", { type: "button", className: "book-filter-close", "aria-label": "닫기" }, "×");
  headActions.appendChild(resetBtn);
  headActions.appendChild(closeBtn);
  head.appendChild(headActions);

  const body = el("div", { className: "book-filter-body" });
  const foot = el("div", { className: "book-filter-foot" });
  const applyBtn = el("button", { type: "button", className: "book-filter-apply" }, "적용");
  foot.appendChild(applyBtn);

  panel.appendChild(resize);
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
  window.appOverlay.attachSheetDrag(handle, panel, { onClose: () => overlay.close() });
  window.appOverlay.attachSheetResize(resize, panel);
  closeBtn.addEventListener("click", () => overlay.close());

  resetBtn.addEventListener("click", () => {
    working.clear();
    body.querySelectorAll(".book-filter-option").forEach((o) => o.setAttribute("aria-selected", "false"));
    updateApplyLabel();
  });
  applyBtn.addEventListener("click", () => {
    navigateSearch({ filterBooks: Array.from(working) });
    overlay.close();
    // Focus the originating field's query input so the user can type the term
    // immediately (keyboard up on mobile). Persistent fields (header/pill)
    // survive the re-render, so focus synchronously within this click gesture
    // (iOS needs that for the soft keyboard). The rebuilt in-page bar autofocuses
    // itself on render, so skip it here.
    const field = _bookSheetReturnField;
    if (field && field.container.id !== "search-inpage-bar" && field.input.isConnected) {
      field.input.focus();
    }
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
      // Chip grid (multi-select): the short name keeps chips compact so a whole
      // division fits in a few wrapped rows instead of a long one-per-row scroll.
      // Selection shows as a filled chip (aria-selected) — no inline check icon.
      opt.appendChild(el("span", { className: "book-filter-name" }, b.short_name_ko || b.name_ko));
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
    host.appendChild(buildSearchEmptyState("검색해 보세요", SEARCH_INTRO_HELP));
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
async function renderSearchView(state) {
  const filterBooks = (state && state.filterBooks) || [];
  // Resolve book names before building the filter bar so pre-set/deep-linked
  // scope chips render with names rather than raw ids (ADR-033). Capture the
  // route sequence first and bail if navigation happened during the await, so a
  // late completion never mutates #app over a newer view (ADR-033, Bugbot).
  const seq = window.routeSeq?.() ?? 0;
  await ensureBookMap();
  if ((window.routeSeq?.() ?? 0) !== seq) return;
  window.setTitle("검색");
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);
  const view = el("div", { className: "search-view" });
  // In-page input on mobile only — desktop uses the header search bar (mirrors
  // renderSearchResults). During the tab-bar morph the bottom dock input owns
  // focus; don't let the (hidden) in-page input grab it back via autofocus.
  if (isMobile()) {
    const morphing = document.body.classList.contains("tabbar-searching");
    view.appendChild(buildInPageSearchInput("", !morphing));
  }
  const dyn = el("div", { className: "search-empty-dynamic" });
  view.appendChild(dyn);
  $app.appendChild(view);
  // Filters surface as in-field tokens now (ADR-033 개정 B) — the book scope is
  // visible/removable in the mobile in-page bar or the desktop header field.
  // Sync after the view is connected so a deep-linked scope resolves names.
  syncSearchFields();
  _emptyDynHost = dyn;
  renderEmptyDynamic(dyn);
}

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 * @param {{ filterBooks?: string[] }} [opts]
 *   filterBooks — book-picker scope (book ids), from the URL via parsePath (ADR-033).
 */
async function renderSearchResults(query, page, autoNavigate = false, opts = {}) {
  const filterBooks = opts.filterBooks || [];
  const state = { q: query, page, filterBooks };

  // Resolve book names before any DOM mutation so deep-linked/restored `in=`
  // scope chips render with names rather than raw ids (ADR-033). Capture the
  // route sequence and bail if navigation happened during the await, so a late
  // completion never clears/builds over a newer view (ADR-033, Bugbot).
  const seq = window.routeSeq?.() ?? 0;
  await ensureBookMap();
  if ((window.routeSeq?.() ?? 0) !== seq) return;

  window.setTitle(`"${query}" 검색`);
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  // Like every other main-header view, plant the mobile settings trigger so the
  // gear stays reachable if the window is resized down to the mobile breakpoint
  // while on this page (where #breadcrumb-row + #settings-anchor are hidden).
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);

  // Both layouts share the .search-view wrapper. Filters (book scope) live as
  // in-field tokens in the search field itself (ADR-033 개정 B):
  // the mobile in-page bar / desktop header field / bottom morphing pill. Results
  // render into their own box so re-rendering them never touches the field.
  const view = el("div", { className: "search-view" });
  if (isMobile()) view.appendChild(buildInPageSearchInput(query, false));
  const resultsTarget = el("div", { className: "search-view-results" });
  view.appendChild(resultsTarget);
  $app.appendChild(view);
  // Book/AND filters surface as in-field tokens (ADR-033 개정 B); sync the
  // header/pill/in-page fields for this query + scope (after view is connected).
  syncSearchFields();

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
    // Drop in-flight partials once the user navigated away — resultsTarget is
    // detached and announcing a stale query would mislead AT (ADR-033, Bugbot).
    if ((window.routeSeq?.() ?? 0) !== seq || !resultsTarget.isConnected) return;
    renderSearchResultList(resultsTarget, partial, query, page, pageSize, paginationBuilder);
    window.announce(`"${query}" 검색 중… 현재 ${partial.total}건`);
  }

  const result = await doSearch(query, page, pageSize, onPartial, { scopeBooks: filterBooks });

  // Bail if the user navigated away while the search was running — the captured
  // resultsTarget is stale and #app belongs to a newer view now (ADR-033, Bugbot).
  if ((window.routeSeq?.() ?? 0) !== seq) return;

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
  const raw = (rawQuery || "").trim();
  if (!raw) return;
  // Absorb typed/example `in:<alias>` operators into book-scope chips so the
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
  // Recents keep the raw typed form (incl. in:<alias>) as the history label.
  pushSearchHistory(raw);
  if (topSearchHistory) topSearchHistory.refresh();
  // Keep the book-picker scope across a fresh query (union in: tokens), but
  // reset pagination (ADR-033).
  const cur = currentSearchState();
  const filterBooks = ids.length ? Array.from(new Set(cur.filterBooks.concat(ids))) : cur.filterBooks;
  // Arm verse-ref auto-navigate only when there's a keyword to search; a
  // scope-only commit (in: absorbed → empty keyword) lands on the empty-query
  // view, which never consumes the flag (would leave it stale — Bugbot).
  searchAutoNavigate = !!keyword;
  const newPath = buildSearchUrl({ q: keyword, page: 1, filterBooks });
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
  // Mobile/touch tier = narrow window OR a touch device (phones in any
  // orientation, tablets). Pointer-aware so landscape phones/tablets keep the
  // app layout instead of flipping to the desktop overlay (ADR-029 개정).
  return window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;
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
      // Keep the on-page /search recents list (if shown) in sync with a delete
      // made from this dropdown (ADR-033, Bugbot).
      if (onChange) onChange();
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
      if (onChange) onChange();
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
  // Header-dropdown deletes/clear should also refresh the on-page /search
  // recents list when it's mounted (ADR-033, Bugbot).
  onChange: () => refreshRecents(),
});
topSearchHistory.syncToggleVisibility();

// Mount in-field tokens on the persistent search fields (ADR-033 개정 B). The
// mobile in-page bar mounts on build (buildInPageSearchInput).
mountSearchField($searchBar, $searchInput);
{
  const $tabDock = document.getElementById("tab-search-dock");
  const $tabInput = document.getElementById("tab-search-input");
  if ($tabDock && $tabInput instanceof HTMLInputElement) {
    mountSearchField($tabDock, $tabInput);
  }
}
// Preload the in:<alias> map (from prefetched books) so commitTopSearch can
// absorb operators synchronously — keeps commit free of an async race surface.
ensureAliasMap();


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
// Refresh in-field search tokens (book scope) from the URL —
// called by route() and the tab-bar morph (ADR-033 개정 B).
window.syncSearchFields = syncSearchFields;
// Patch the search URL preserving the rest of the state — the morphing pill's
// clear (tabbar.js) uses it to drop the query while KEEPING the book scope,
// matching the header/in-page clears (ADR-033 개정 B, Bugbot).
window.navigateSearch = navigateSearch;
window.isMobile = isMobile;
window.appendTextWithHighlight = appendTextWithHighlight;
window.consumeSearchAutoNavigate = consumeSearchAutoNavigate;

export {
  renderSearchResults, renderSearchView,
  isMobile, appendTextWithHighlight, consumeSearchAutoNavigate,
};
