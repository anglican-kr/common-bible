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

const { _$, el, clearNode, chUnit } = window.appHelpers;
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
 */
function doSearch(query, page, pageSize, onPartial) {
  return new Promise((resolve) => {
    const worker = ensureSearchWorker();
    activeSearchId += 1;
    pendingSearchCb = resolve;
    partialResultsCb = onPartial || null;
    worker.postMessage({ type: "search", q: query, page, pageSize, searchId: activeSearchId });
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
 * @param {string} query
 * @param {number} currentPage
 * @param {number} totalPages
 */
function buildSearchPagination(query, currentPage, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  const encoded = encodeURIComponent(query);

  if (currentPage > 1) {
    nav.appendChild(el("a", { href: `/search?q=${encoded}&page=${currentPage - 1}` }, "← 이전"));
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }

  nav.appendChild(el("span", { className: "search-page-info" }, `${currentPage} / ${totalPages}`));

  if (currentPage < totalPages) {
    nav.appendChild(el("a", { href: `/search?q=${encoded}&page=${currentPage + 1}` }, "다음 →"));
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
        buildSearchEmptyState("검색 결과 없음", `"${query}"에 대한 결과가 없습니다.`)
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
    if (window.parsePath().view === "search") window.navigate("/search");
  });

  wrap.appendChild(input);
  wrap.appendChild(clear);
  if (autofocus) requestAnimationFrame(() => input.focus());
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
  const box = el("div", { className: "search-empty-state" });
  const icon = el("div", { className: "search-empty-icon", "aria-hidden": "true" });
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6.4"/><path d="m20 20-3.7-3.7"/></svg>';
  box.appendChild(icon);
  box.appendChild(el("p", { className: "search-empty-title" }, title));
  box.appendChild(el("p", { className: "search-empty-subtitle" }, subtitle));
  return box;
}

// Empty-query mobile /search: render the in-page input plus an Apple-Music-style
// empty-state prompt. Shares the main-header chrome with renderSearchResults.
function renderSearchView() {
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
  view.appendChild(
    buildSearchEmptyState("검색", "예: 사랑, 사랑 in:요한, 창세 1:3")
  );
  $app.appendChild(view);
}

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 */
async function renderSearchResults(query, page, autoNavigate = false) {
  window.setTitle(`"${query}" 검색`);
  const $title = _$("page-title");
  $title.insertBefore(window.buildHomeBtn("/", "성서 목록으로"), $title.firstChild);
  // Like every other main-header view, plant the mobile settings trigger so the
  // gear stays reachable if the window is resized down to the mobile breakpoint
  // while on this page (where #breadcrumb-row + #settings-anchor are hidden).
  $title.appendChild(window.buildSettingsTrigger());
  window.hideAudioBar();
  clearNode($app);

  // Mobile full-screen view: keep an in-page search input pinned above the
  // results so the query stays editable (desktop uses the header bar instead).
  // Results render into their own container so re-rendering them never wipes
  // the input. On desktop the results render straight into #app as before.
  let resultsTarget = $app;
  if (isMobile()) {
    const view = el("div", { className: "search-view" });
    view.appendChild(buildInPageSearchInput(query, false));
    const resultsBox = el("div", { className: "search-view-results" });
    view.appendChild(resultsBox);
    $app.appendChild(view);
    resultsTarget = resultsBox;
  }

  resultsTarget.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  // Estimate page size from available viewport height
  const headerH = document.getElementById("app-header")?.offsetHeight || 80;
  const availH = window.innerHeight - headerH - 40;
  const itemH = 80;
  const pageSize = Math.max(5, Math.floor(availH / itemH));

  /** @param {any} partial */
  function onPartial(partial) {
    renderSearchResultList(resultsTarget, partial, query, page, pageSize, buildSearchPagination);
    window.announce(`"${query}" 검색 중… 현재 ${partial.total}건`);
  }

  const result = await doSearch(query, page, pageSize, onPartial);

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
      renderSearchResultList(resultsTarget, result, query, page, pageSize, buildSearchPagination);
      dismissLaunchScreen();
    }
    return;
  }

  renderSearchResultList(resultsTarget, result, query, page, pageSize, buildSearchPagination);
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
  const newPath = `/search?q=${encodeURIComponent(q)}`;
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
