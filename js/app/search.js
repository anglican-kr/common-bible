"use strict";
// @ts-check

// Search engine wire-up + UI controllers (desktop top-bar + mobile bottom
// sheet + history panel + drag handle init). Owns the Worker lifetime
// (`searchWorker`), all `$search*` DOM anchors, and the search-internal
// module state (`searchAutoNavigate`, sheet keyboard adjustments).
//
// Phase 5 of the app.js modularization (ADR-018). ESM-pattern (ADR-019):
// named exports + window facade for legacy app.js callers (route handler at
// `/search?q=`, Escape keydown, bootstrap `initSheetDrag()`).

/** @typedef {import("../types").SearchHistoryList} SearchHistoryList */

const { _$, el, clearNode, chUnit, dragReleaseAction } = window.appHelpers;
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
const $searchFab = _$("search-fab");
const $searchScrim = _$("search-scrim");
const $searchSheet = _$("search-sheet");
const $searchSheetInputWrap = _$("search-sheet-input-wrap");
const $searchSheetInput = /** @type {HTMLInputElement} */ (_$("search-sheet-input"));
const $searchSheetClear = _$("search-sheet-clear");
const $searchSheetHistoryToggle = _$("search-sheet-history-toggle");
const $searchSheetHistoryPanel = _$("search-sheet-history");
const $searchSheetClose = _$("search-sheet-close");
const $searchSheetChips = _$("search-sheet-chips");
const $searchSheetResults = _$("search-sheet-results");

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
// Overwritten by renderSearchResults / runSheetSearch for each search.
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
      container.appendChild(el("p", { className: "search-empty" }, `"${query}"에 대한 검색 결과가 없습니다.`));
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

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 */
async function renderSearchResults(query, page, autoNavigate = false) {
  window.setTitle(`"${query}" 검색`);
  window.setBreadcrumb([{ label: "목록", href: "/" }]);
  window.hideAudioBar();
  clearNode($app);

  $app.appendChild(el("div", { className: "loading", "aria-live": "polite" }, "검색 중…"));

  // Estimate page size from available viewport height
  const headerH = document.getElementById("app-header")?.offsetHeight || 80;
  const availH = window.innerHeight - headerH - 40;
  const itemH = 80;
  const pageSize = Math.max(5, Math.floor(availH / itemH));

  /** @param {any} partial */
  function onPartial(partial) {
    renderSearchResultList($app, partial, query, page, pageSize, buildSearchPagination);
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
      renderSearchResultList($app, result, query, page, pageSize, buildSearchPagination);
      dismissLaunchScreen();
    }
    return;
  }

  renderSearchResultList($app, result, query, page, pageSize, buildSearchPagination);
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

// Mobile delegation: tapping the header search bar opens the compact sheet
// instead of focusing the inline input. Desktop (>768px) keeps live search.
// pointerdown.preventDefault stops the input from gaining focus first, which
// would otherwise pop the keyboard once for the header input and again when
// the sheet input takes focus.
$searchInput.addEventListener("pointerdown", (e) => {
  if (!isMobile()) return;
  e.preventDefault();
  openSearchSheet("");
});
// Fallback for keyboard/tab navigation focus.
$searchInput.addEventListener("focus", () => {
  if (!isMobile() || !$searchSheet.hidden) return;
  $searchInput.blur();
  openSearchSheet("");
});

// ── Search bottom sheet (Mobile FAB) ──

// ── BEGIN IS_MOBILE ──
function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}
// ── END IS_MOBILE ──

// Lift the sheet above the on-screen keyboard. Default Android viewport
// behavior (`resizes-visual`) leaves position:fixed elements anchored to the
// layout viewport, so the bottom of the sheet would sit behind the keyboard.
let _suspendKeyboardAdjust = false;
function adjustSheetForKeyboard() {
  if (_suspendKeyboardAdjust) return;
  if (!window.visualViewport || $searchSheet.hidden) return;
  const vv = window.visualViewport;
  // For position:fixed elements anchored to the layout viewport, ignore
  // vv.offsetTop — it represents in-page scroll within the visual viewport
  // (e.g. pinch-zoom pan) and would incorrectly shift the sheet.
  const keyboardOffset = Math.max(0, window.innerHeight - vv.height);
  const prevOffset = parseFloat($searchSheet.style.bottom) || 0;
  if (keyboardOffset > 0 && Math.abs(keyboardOffset - prevOffset) < 1) return;
  // Suppress the CSS height transition so viewport adjustments snap instantly
  // rather than lagging 200ms behind rapid visualViewport resize/scroll events.
  $searchSheet.style.transition = "none";
  // Compact: only the input bar + chips are visible. Don't override height —
  // CSS keeps it at the compact value; just lift the sheet above the keyboard
  // and add a small bottom margin so it visually floats above the keyboard.
  if ($searchSheet.dataset.state === "compact") {
    const COMPACT_BOTTOM_MARGIN_PX = 12; // matches CSS 0.75rem on left/right
    $searchSheet.style.bottom = `${keyboardOffset + COMPACT_BOTTOM_MARGIN_PX}px`;
    $searchSheet.style.height = "";
    $searchSheet.style.maxHeight = "";
    return;
  }
  if (keyboardOffset > 0) {
    // Expanded with keyboard up — fill the visible viewport so the page body
    // cannot peek through the gap between the sheet and the on-screen keyboard.
    $searchSheet.style.bottom = `${keyboardOffset}px`;
    $searchSheet.style.height = `${vv.height}px`;
    $searchSheet.style.maxHeight = `${vv.height}px`;
  } else {
    $searchSheet.style.transition = "";
    $searchSheet.style.bottom = "";
    $searchSheet.style.height = "";
    $searchSheet.style.maxHeight = "";
  }
}

let _searchSheetAppliedScrollLock = false;

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

const sheetSearchHistory = createSearchHistoryController({
  wrap: $searchSheetInputWrap,
  input: $searchSheetInput,
  toggle: $searchSheetHistoryToggle,
  panel: $searchSheetHistoryPanel,
  clearBtn: $searchSheetClear,
  syncClearHidden: (hidden) => { $searchSheetInputWrap.dataset.clearHidden = String(hidden); },
  onSelect: (q) => commitSheetSearch(q),
});
sheetSearchHistory.syncToggleVisibility();

/** @param {string} [query] */
function openSearchSheet(query) {
  // Set state BEFORE unhiding so the first paint already reflects compact
  // dimensions — otherwise the 55vh expanded layout flashes for one frame.
  $searchSheet.dataset.state = query ? "expanded" : "compact";
  $searchScrim.hidden = false;
  $searchSheet.hidden = false;
  // Lock background scroll. Without this, iOS Safari's URL-bar collapse on
  // page scroll fires visualViewport resize/scroll while the sheet is open,
  // causing the sheet's computed dimensions to thrash.
  // Guard: if the lock is already active (e.g. re-entered via popstate),
  // window.scrollY would be 0 and overwrite the real saved position.
  if (document.body.style.position !== "fixed") {
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.dataset.scrollY = String(scrollY);
    _searchSheetAppliedScrollLock = true;
  }
  $searchSheetInput.value = query || "";
  $searchSheetClear.hidden = !query;
  $searchSheetInputWrap.dataset.clearHidden = String(!query);
  if (sheetSearchHistory) sheetSearchHistory.syncToggleVisibility();
  $searchFab.hidden = true;
  // Compact entry focuses synchronously so iOS Safari opens the on-screen
  // keyboard inside the user-gesture context (rAF would defer past it).
  // Expanded entry (query-prefilled URL) skips focus — the user wants results,
  // not the keyboard.
  if (!query) $searchSheetInput.focus({ preventScroll: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", adjustSheetForKeyboard);
    window.visualViewport.addEventListener("scroll", adjustSheetForKeyboard);
  }
  if (query) runSheetSearch(query, 1);
}

function closeSearchSheet() {
  _suspendKeyboardAdjust = false;
  if (sheetSearchHistory) sheetSearchHistory.close();
  $searchScrim.hidden = true;
  $searchSheet.hidden = true;
  $searchSheet.dataset.state = "";
  $searchSheet.style.transition = "";
  $searchSheet.style.height = "";
  $searchSheet.style.bottom = "";
  $searchSheet.style.maxHeight = "";
  $searchFab.hidden = false;
  clearNode($searchSheetResults);
  // Restore background scroll only if this sheet applied the lock.
  if (_searchSheetAppliedScrollLock) {
    const scrollY = parseInt(document.body.dataset.scrollY || "0", 10);
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
    delete document.body.dataset.scrollY;
    window.scrollTo(0, scrollY);
    _searchSheetAppliedScrollLock = false;
  }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener("resize", adjustSheetForKeyboard);
    window.visualViewport.removeEventListener("scroll", adjustSheetForKeyboard);
  }
}

function getSheetPageSize() {
  // Estimate how many results fit in the visible sheet area
  const resultsH = $searchSheetResults.clientHeight || (window.innerHeight * 0.55 - 90);
  const itemH = 80; // approx height per result item
  return Math.max(5, Math.floor(resultsH / itemH));
}

/**
 * @param {string} query
 * @param {number} page
 * @param {number} totalPages
 */
function buildSheetPagination(query, page, totalPages) {
  const nav = el("nav", { className: "search-pagination", "aria-label": "검색 결과 페이지" });
  if (page > 1) {
    const prev = el("a", { href: "#", "aria-label": "이전 페이지" }, "← 이전");
    prev.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page - 1); $searchSheetResults.scrollTop = 0; });
    nav.appendChild(prev);
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }
  nav.appendChild(el("span", { className: "search-page-info" }, `${page} / ${totalPages}`));
  if (page < totalPages) {
    const next = el("a", { href: "#", "aria-label": "다음 페이지" }, "다음 →");
    next.addEventListener("click", (e) => { e.preventDefault(); runSheetSearch(query, page + 1); $searchSheetResults.scrollTop = 0; });
    nav.appendChild(next);
  } else {
    nav.appendChild(el("span", { className: "placeholder" }));
  }
  return nav;
}

/**
 * @param {string} query
 * @param {number} page
 * @param {boolean} [autoNavigate]
 */
async function runSheetSearch(query, page, autoNavigate = false) {
  clearNode($searchSheetResults);
  if (!query) return;

  $searchSheetResults.appendChild(el("div", { className: "loading" }, "검색 중…"));

  const pageSize = getSheetPageSize();

  /** @param {any} partial */
  function onPartial(partial) {
    // Add click-to-close to each result link for sheet view
    const frag = document.createDocumentFragment();
    const tempDiv = el("div");
    renderSearchResultList(tempDiv, partial, query, page, pageSize, null);
    // Attach closeSearchSheet to all links
    tempDiv.querySelectorAll("a[href]").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));
    while (tempDiv.firstChild) frag.appendChild(tempDiv.firstChild);
    clearNode($searchSheetResults);
    $searchSheetResults.appendChild(frag);
  }

  const result = await doSearch(query, page, pageSize, onPartial);
  clearNode($searchSheetResults);

  if (!result) {
    $searchSheetResults.appendChild(el("div", { className: "error" }, "검색에 실패했습니다."));
    return;
  }

  // Verse reference — navigate only when explicitly confirmed (Enter key).
  if (result.refMatch) {
    const ref = result.refMatch;
    let path = `/${ref.bookId}/${ref.chapter}`;
    if (ref.verse) {
      path += `/${ref.verse}`;
      if (ref.verseEnd) path += `-${ref.verseEnd}`;
    }
    if (autoNavigate) {
      closeSearchSheet();
      window.navigate(path);
    } else {
      // Show the refMatch as a clickable result in the sheet
      renderSearchResultList($searchSheetResults, result, query, page, pageSize, null);
      // Attach closeSearchSheet to the reference link
      $searchSheetResults.querySelectorAll("a[href^='/']").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));
    }
    return;
  }

  renderSearchResultList($searchSheetResults, result, query, page, pageSize, buildSheetPagination);
  // Attach closeSearchSheet to all result links
  $searchSheetResults.querySelectorAll("a[href^='/']").forEach((a) => a.addEventListener("click", () => closeSearchSheet()));

  window.announce(`"${query}" 검색 결과 ${result.total}건`);
}

$searchFab.addEventListener("click", () => openSearchSheet(""));

$searchScrim.addEventListener("click", closeSearchSheet);
$searchSheetClose.addEventListener("click", closeSearchSheet);

// Chip row: pointerdown.preventDefault keeps the input focused — without it
// the IME closes briefly and reopens, which flickers on Android.
$searchSheetChips.addEventListener("pointerdown", (e) => {
  const t = e.target;
  if (t instanceof Element && t.closest(".search-chip")) e.preventDefault();
});
$searchSheetChips.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const btn = /** @type {HTMLElement | null} */ (t.closest(".search-chip"));
  if (!btn) return;
  if (btn.dataset.chip === "in") insertSearchOperator("in:");
});

/** @param {string} op */
function insertSearchOperator(op) {
  const cur = $searchSheetInput.value;
  const needsSpace = cur.length > 0 && !cur.endsWith(" ");
  const insertion = (needsSpace ? " " : "") + op;
  $searchSheetInput.value = cur + insertion;
  const has = !!$searchSheetInput.value.trim();
  $searchSheetClear.hidden = !has;
  $searchSheetInputWrap.dataset.clearHidden = String(!has);
  // Cursor right after the colon so the user types the alias next.
  const pos = $searchSheetInput.value.length;
  $searchSheetInput.focus({ preventScroll: true });
  $searchSheetInput.setSelectionRange(pos, pos);
}

/** @param {string} rawQuery */
function commitSheetSearch(rawQuery) {
  const q = (rawQuery || "").trim();
  if (!q) return;
  pushSearchHistory(q);
  if (sheetSearchHistory) sheetSearchHistory.refresh();
  // Dismiss IME first so the keyboard slide-down can run alongside the
  // sheet's CSS height/bottom transition. We suspend adjustSheetForKeyboard
  // briefly so visualViewport.resize during keyboard dismiss doesn't
  // re-impose `transition: none` and snap the animation.
  $searchSheetInput.blur();
  _suspendKeyboardAdjust = true;
  requestAnimationFrame(() => {
    $searchSheet.style.transition = "";
    $searchSheet.style.bottom = "";
    $searchSheet.style.height = "";
    $searchSheet.style.maxHeight = "";
    $searchSheet.dataset.state = "expanded";
    runSheetSearch(q, 1, true);
    setTimeout(() => { _suspendKeyboardAdjust = false; }, 260);
  });
}

$searchSheetInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (sheetSearchHistory && sheetSearchHistory.consumeEnter(e)) return;
  e.preventDefault();
  commitSheetSearch($searchSheetInput.value);
});

$searchSheetInput.addEventListener("input", () => {
  const has = !!$searchSheetInput.value.trim();
  $searchSheetClear.hidden = !has;
  $searchSheetInputWrap.dataset.clearHidden = String(!has);
});

// Tapping the input while results are showing reverts to compact mode so the
// keyboard reappears with breathing room and the previous results clear out.
// We seed `bottom` with an estimated keyboard offset so height/bottom/left/
// right all transition together in a single 220ms animation. After the
// transition we issue a soft catch-up to the keyboard's real position —
// transitioned (not snapped) so any estimate mismatch glides into place.
// adjustSheetForKeyboard is suspended throughout so its `transition: none`
// snap doesn't interrupt the choreography; tracking resumes afterwards.
// Set true around programmatic .focus() calls (e.g. after clear button) so
// the focus-driven expanded→compact transition only fires for real user taps,
// not for code that just refocuses the input as a courtesy.
let _suppressFocusCompactTransition = false;

$searchSheetInput.addEventListener("focus", () => {
  if (_suppressFocusCompactTransition) return;
  if ($searchSheet.dataset.state !== "expanded") return;
  _suspendKeyboardAdjust = true;
  $searchSheet.style.transition = "";
  const COMPACT_BOTTOM_MARGIN_PX = 12;
  // Typical mobile soft-keyboard heights: iPhone ~291–334, Android ~250–320.
  // 280 is a reasonable midpoint; the catch-up below corrects any mismatch.
  const ESTIMATED_KEYBOARD_PX = 280;
  const vv = window.visualViewport;
  const currentOffset = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
  const targetOffset = currentOffset > 0 ? currentOffset : ESTIMATED_KEYBOARD_PX;
  $searchSheet.style.bottom = `${targetOffset + COMPACT_BOTTOM_MARGIN_PX}px`;
  $searchSheet.dataset.state = "compact";
  clearNode($searchSheetResults);
  setTimeout(() => {
    // Soft catch-up: read the real keyboard offset and let CSS transition
    // glide the small correction. Don't call adjustSheetForKeyboard here —
    // it would set `transition: none` and snap.
    const vv2 = window.visualViewport;
    const offset2 = vv2 ? Math.max(0, window.innerHeight - vv2.height) : 0;
    $searchSheet.style.transition = "";
    $searchSheet.style.bottom = `${offset2 + COMPACT_BOTTOM_MARGIN_PX}px`;
    setTimeout(() => { _suspendKeyboardAdjust = false; }, 240);
  }, 260);
});

$searchSheetClear.addEventListener("click", () => {
  $searchSheetInput.value = "";
  $searchSheetClear.hidden = true;
  $searchSheetInputWrap.dataset.clearHidden = "true";
  // Refocus so the keyboard stays up, but do not collapse the sheet to compact
  // — the user wants to keep seeing previous results while typing a refinement.
  _suppressFocusCompactTransition = true;
  $searchSheetInput.focus();
  _suppressFocusCompactTransition = false;
});

// Drag-handle initializer — registered later in app.js's deferred startup
// hook. Operates on the (initially hidden) search sheet, so deferring keeps
// the listener attachment off the launch critical path.
function initSheetDrag() {
  const handle = _$("search-sheet-handle");
  let startY = 0;
  let startH = 0;

  /** @param {number} clientY */
  function onMove(clientY) {
    const delta = startY - clientY;
    // Lower bound is 0 (not 30vh) so the user can drag the sheet visually
    // below its rest min — that's the affordance for the snap-close gesture.
    // A hard 30vh clamp here would make dragReleaseAction's close branch
    // unreachable (Cursor Bugbot caught this exact regression in cite-sheet).
    const newH = Math.min(Math.max(startH + delta, 0), window.innerHeight * 0.9);
    $searchSheet.style.height = `${newH}px`;
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    startY = e.clientY;
    startH = $searchSheet.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp, { once: true });
  });

  /** @param {PointerEvent} e */
  function onPointerMove(e) { onMove(e.clientY); }
  function onPointerUp() {
    handle.removeEventListener("pointermove", onPointerMove);
    const action = dragReleaseAction($searchSheet.offsetHeight, window.innerHeight);
    if (action === "close") {
      closeSearchSheet();
      $searchSheet.style.height = "";
    } else if (action === "snap-min") {
      $searchSheet.style.height = `${window.innerHeight * 0.3}px`;
    }
  }
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
// renderSearchResults / openSearchSheet / isMobile / consumeSearchAutoNavigate,
// chapter renderer reuses appendTextWithHighlight for ?hl= snippet
// highlighting, Escape keydown calls closeSearchSheet, bootstrap calls
// initSheetDrag).
window.openSearchSheet = openSearchSheet;
window.closeSearchSheet = closeSearchSheet;
window.renderSearchResults = renderSearchResults;
window.initSheetDrag = initSheetDrag;
window.isMobile = isMobile;
window.appendTextWithHighlight = appendTextWithHighlight;
window.consumeSearchAutoNavigate = consumeSearchAutoNavigate;
window.appSearch = {
  openSearchSheet, closeSearchSheet, renderSearchResults, initSheetDrag,
  isMobile, appendTextWithHighlight, consumeSearchAutoNavigate,
};

export {
  openSearchSheet, closeSearchSheet, renderSearchResults, initSheetDrag,
  isMobile, appendTextWithHighlight, consumeSearchAutoNavigate,
};
