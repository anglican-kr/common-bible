// @ts-check
"use strict";

// Routing — extracted from views.js (ADR-034 PR5a). Owns URL parsing
// (parsePath), SPA navigation (navigate), the route() orchestrator + page meta
// / analytics, the reading-position scroll tracker (startScrollTracking), and
// the global link-click + popstate listeners.
//
// route() dispatches to view renderers IMPORTED from views.js — the
// dependency is one-directional (views never call route/navigate/parsePath,
// verified). Search / bookmark / settings / citations view + overlay functions
// are reached through the window facade because those modules call route /
// navigate / parsePath back; that cycle stays on the facade per ADR-034
// (registry inversion is a later step, PR5b).

/** @typedef {import("../types").BooksData} BooksData */
/** @typedef {import("../types").BookEntry} BookEntry */
/** @typedef {import("../types").Route} Route */

import { loadBooks, loadChapter, loadPrologue } from "./data-fetch.js";
import { isWellFormedSpec } from "./verse-spec.js";
import {
  renderBookList, renderChapterList, renderChapter, renderPrologue,
  renderLoading, renderError, divisionOrder, DIVISION_LABELS, renderLiturgicalLoadFailure,
} from "./views.js";
// The calendar tab and the lectionary view (ADR-038 §1-§3) are not imported
// here: route() loads them with import() the first time one of their routes
// opens (openLazyView), so a session that only reads the Bible never loads the
// liturgical engine, the lectionary view or the calendar (about 210KB of
// source, 70KB gzipped). The measured gain is the cold first visit's boot path
// (Slow 4G DOMContentLoaded −390 ms, 2026-10-17); a warm start was within noise
// either way, since the browser compiles function bodies lazily. A deep link
// to either view also loads them only once route() runs — a cold first visit
// draws the view later than when they were boot tags (Slow 4G +160-198 ms,
// accepted 2026-10-18: a modulepreload from <head> closed that gap, but WebKit
// kept a failed preload for the tab, so 「다시 불러오기」 could not recover —
// ADR-038 「검토한 대안 — 모듈 로드」 E). The seam stays one-directional —
// neither calls route / navigate / parsePath, their controls are plain links
// (ADR-034 principle 1), and the shell they share with this module (title,
// header control, failure screen) lives in views.js. sw.js still precaches all
// three for offline, and tests/unit/sw.test.js follows these import() calls.

const { _$, clearNode, chUnit, isModifiedClick, focusSpotOf, restoreFocusSpot } = window.appHelpers;
const {
  loadStartupBehavior, loadReadingPosition, saveReadingPosition, loadBookOrder,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;
const { readingContext } = window;

// DOM anchors. Redeclared locally so routing.js is self-contained.
const $app = _$("app");
const $resumeBannerSlot = _$("resume-banner-slot");
const $divisionTabsSlot = _$("division-tabs-slot");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchBar = _$("search-bar");

// ── Reading-position scroll tracker + route state ──
/** @type {(() => void) | null} */
let _scrollTrackCleanup = null;
let _isInitialLoad = true;
// ADR-031: route() 호출마다 증가. 리다이렉트(books→resume 등)로 route 가 재진입하면
// 바깥 호출의 finally(onRouteEnd 스크롤 복원)가 이미 낡았음을 알도록 시퀀스로 가드한다.
let _routeSeq = 0;
// 같은 화면을 다시 그리는 링크(`data-focus-key` — 전례독서의 날짜 이동 · 칩 · 카드 · 세그먼트, 캘린더의 달 이동, 구분 탭,
// 검색의 페이지 이동)를 누른 자리(WCAG 2.4.3, ADR-031 §5). 아래 클릭 인터셉터가 이동 직전에 재고(helpers.js focusSpotOf),
// route() 가 시작하자마자 꺼내 비운다 — 그래서 자리는 그것을 남긴 누름의 route() 에만 쓰인다(뒤로 가기 · 탭 전환 ·
// 리다이렉트는 자리 없이 시작한다). 새 화면이 커밋된 뒤 finally 에서 그 route 가 여전히 최신이면 돌려준다.
/** @type {import("../types").FocusSpot | null} */
let _pendingFocusSpot = null;
/** @param {string} bookId @param {number} chapter */
function startScrollTracking(bookId, chapter) {
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const handler = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      const verses = document.querySelectorAll(".verse[data-vref]");
      /** @type {number | null} */
      let currentVerse = null;
      for (const v of verses) {
        const n = parseInt(v.getAttribute("data-vref") ?? "", 10);
        if (!Number.isFinite(n)) continue;
        const top = v.getBoundingClientRect().top;
        if (top <= 80) {
          currentVerse = n;
        } else {
          break;
        }
      }
      if (currentVerse !== null) saveReadingPosition(bookId, chapter, currentVerse);
    }, 500);
  };
  window.addEventListener("scroll", handler, { passive: true });
  _scrollTrackCleanup = () => {
    if (timer !== null) clearTimeout(timer);
    window.removeEventListener("scroll", handler);
    _scrollTrackCleanup = null;
  };
}


// ── Routing ──

// ── BEGIN PARSE_PATH ──
// Pure URL → route descriptor. Reads location.pathname/search and the
// DIVISION_LABELS / parseVerseSpec / selectedVersesToSpec / isWellFormedSpec deps;
// no DOM, no history side effects — sliced + unit-tested in tests/unit/routing.test.js.
/** @returns {Route} */
function parsePath() {
  const pathname = location.pathname.replace(/^\//, "");
  if (!pathname) return { view: "books" };

  const query = new URLSearchParams(location.search || "");

  // 깨진 퍼센트 이스케이프(`%E0%A4%A`)는 decodeURIComponent 가 throw 한다 — parsePath 는 route() 의 try 밖에서
  // 돌므로 원문을 그대로 넘겨 뷰가 거부하게 한다: 교회력 · 전례독서는 「잘못된 날짜」, 북마크 읽기는 없는 폴더라
  // 「읽을 북마크가 없습니다」(Copilot 리뷰 3회차; /read 갈래는 PR #348 리뷰 — 이 정의보다 위에 있어 맨
  // decodeURIComponent 로 남아 있었다).
  /** @param {string} s */
  const decodeOrRaw = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

  // Search route: /search?q=...&page=...&in=<bookId> (ADR-033).
  // `in` (book-picker scope, repeatable) lives in the URL so it survives
  // history/back-forward and tab restore (ADR-031), and so paginated/filtered
  // links stay shareable.
  if (pathname === "search") {
    return {
      view: "search",
      query: query.get("q") || "",
      page: parseInt(query.get("page") ?? "", 10) || 1,
      filterBooks: query.getAll("in").filter(Boolean),
    };
  }

  // Tab-bar destinations (ADR-029 / P2). On mobile these render full-screen
  // views; on desktop route() falls back to the existing overlays.
  // Bookmark reading view (ADR-035): a folder's passages in one continuous
  // screen (/read/<folderId>), or all bookmarks (/read). Lives under the home
  // (reading) tab — not /bookmarks — so launching it from a folder switches the
  // tab bar to 홈, matching its "sit and read" nature (ADR-035 개정 2026-06-09).
  // Resolved here, ahead of the generic single-segment book/division split, so
  // "read" is never mistaken for a book id.
  if (pathname === "read") return { view: "bookmark-read", folderId: null };
  if (pathname.startsWith("read/")) {
    return { view: "bookmark-read", folderId: decodeOrRaw(pathname.slice("read/".length)) };
  }
  if (pathname === "bookmarks") return { view: "bookmarks" };
  if (pathname === "settings") return { view: "settings" };

  // Calendar tab (ADR-038 §1 · §2 A2): /calendar (this month) · /calendar/YYYY-MM.
  // Resolved ahead of the generic single-segment split so "calendar" is never
  // read as a book id. The month itself is validated by the view (like the
  // lectionary's date) — anything else under /calendar/ reaches it as `month`
  // and gets the view's invalid-date notice.
  if (pathname === "calendar" || pathname.startsWith("calendar/")) {
    const rest = pathname === "calendar" ? "" : pathname.slice("calendar/".length);
    return { view: "calendar", mode: "month", month: rest ? decodeOrRaw(rest) : null };
  }

  // Lectionary reading view (ADR-038 §3): /lectionary (today) · /lectionary/YYYY-MM-DD.
  // View state rides in the query (?obs=<observance id>&track=1|2&set=N&collect=N) so
  // a shared link, the back button and tab restore (ADR-031) all land on the same
  // screen; out-of-range values read as absent so a mangled link never throws.
  // Resolved ahead of the generic single-segment split so "lectionary" is never
  // read as a book id. The date itself is validated by the view (engine
  // parseDate) — anything else under /lectionary/ (including the /lectionary/d/<slug>
  // landing that A4 search will add) gets the view's invalid-date notice for now.
  if (pathname === "lectionary" || pathname.startsWith("lectionary/")) {
    const rest = pathname === "lectionary" ? "" : pathname.slice("lectionary/".length);
    // 값 전체가 양의 정수일 때만 — parseInt 는 「2junk」 「1.5」 같은 머리만 숫자인 값도 받아 라우트 계약
    // (범위 밖 · 깨진 값은 null)을 어긴다(Copilot 리뷰 3회차).
    /** @param {string} k */
    const positive = (k) => {
      const v = query.get(k) ?? "";
      if (!/^[1-9]\d*$/.test(v)) return null;
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : null;   // 자릿수가 넘쳐 Infinity · 근사값이 되는 것도 계약 밖(Copilot 리뷰 10회차)
    };
    const track = positive("track");
    return {
      view: "lectionary",
      date: rest ? decodeOrRaw(rest) : null,
      obs: query.get("obs") || null,
      track: track === 1 || track === 2 ? track : null,
      set: positive("set"),
      collect: positive("collect"),
    };
  }

  const parts = pathname.split("/");
  if (parts.length === 1) {
    // Own keys only: a plain object also answers its inherited names (`/constructor` · `/toString` · `/__proto__`),
    // which rendered the first tab under a page title like 「function Object() { [native code] }」(PR #353 리뷰).
    if (Object.hasOwn(DIVISION_LABELS, parts[0])) return { view: "division", division: parts[0] };
    return { view: "chapters", bookId: parts[0] };
  }
  if (parts[1] === "prologue") return { view: "prologue", bookId: parts[0] };

  // Chapter view with optional verse deep-link: /john/3/16 or /john/3/16-20.
  // Multi-segment: /john/3/1-5,10-15  ?hl=... carries search-term highlight.
  const highlightQuery = query.get("hl") || null;
  let highlightVerse = null;
  let highlightVerseEnd = null;
  let highlightVerseSpec = null;

  if (parts[2]) {
    // 앞뒤 쉼표는 걷고 본다 — 링크 바로 뒤에 친 쉼표를 메신저가 링크에 넣을 수 있다(main은 parseVerseSpec이 빈 구간을
    // 건너뛰어 그런 링크도 강조했다). 주소에서만 걷고, 가져오기 검사는 그대로 엄격하다(사용자 결정 2026-10-21, PR #362 리뷰).
    // Trimmed with a loop, not /^,+|,+$/ — that regex backtracks quadratically on a long run of commas followed by
    // another character (40,000 commas took about a second), and this runs on every scroll frame.
    const raw = parts[2];
    let from = 0;
    let to = raw.length;
    while (from < to && raw[from] === ",") from++;
    while (to > from && raw[to - 1] === ",") to--;
    const spec = raw.slice(from, to);
    // A single verse or range never expands — renderChapter clips its end to the chapter. The multi-segment form
    // expands verse by verse below, so it takes only the forms the app writes (isWellFormedSpec — the bookmark import's
    // check, ADR-040): a huge range (`1-4294967296,5`) threw before the first screen, and a flood of segments stalled
    // every scroll frame, which re-reads the address (tabbar.js `collapseEnabled`) — known-issues §15. Any other spec
    // opens the chapter without a highlight.
    const simpleMatch = spec.match(/^(\d+)(?:-(\d+))?$/);
    if (simpleMatch) {
      const v1 = parseInt(simpleMatch[1], 10);
      const v2 = simpleMatch[2] ? parseInt(simpleMatch[2], 10) : null;
      if (v1 > 0) {
        if (v2 && v2 > 0 && v2 !== v1) {
          highlightVerse = Math.min(v1, v2);
          highlightVerseEnd = Math.max(v1, v2);
        } else {
          highlightVerse = v1;
        }
      }
    } else if (isWellFormedSpec(spec)) {
      const segs = parseVerseSpec(spec);
      if (segs.length > 0) {
        // Sort ascending (by start, then part letter) and re-serialize for canonical URLs.
        segs.sort((a, b) => a.start !== b.start ? a.start - b.start : (a.part || "").localeCompare(b.part || ""));
        highlightVerseSpec = selectedVersesToSpec(
          segs.flatMap(s => s.part ? [`${s.start}${s.part}`] : Array.from({ length: s.end - s.start + 1 }, (_, i) => `${s.start + i}`))
        );
        highlightVerse = segs[0].start;
        highlightVerseEnd = segs[segs.length - 1].end;
      }
    }
  }

  return {
    view: "chapter",
    bookId: parts[0],
    chapter: parseInt(parts[1], 10),
    highlightQuery,
    highlightVerse,
    highlightVerseEnd,
    highlightVerseSpec,
    resume: query.has("resume"),
  };
}
// ── END PARSE_PATH ──

/** @param {string} path */
function navigate(path) {
  history.pushState(null, "", path);
  route();
}

/** @param {{ title?: string, description?: string }} [opts] */
function updatePageMeta(opts = {}) {
  const { title, description } = opts;
  const fullTitle = title ? `${title} — 공동번역성서` : "공동번역성서";
  document.title = fullTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:title"]')?.setAttribute("content", fullTitle);
  document.querySelector('meta[property="og:description"]')?.setAttribute("content", description ?? "대한성공회 공동번역성서. 구약·신약 73권 전문을 오프라인에서도 읽을 수 있는 웹 앱.");
  document.querySelector('meta[property="og:url"]')?.setAttribute("content", `https://bible.anglican.kr${location.pathname}`);
  document.querySelector('link[rel="canonical"]')?.setAttribute("href", `https://bible.anglican.kr${location.pathname}`);
}

function trackPageView() {
  if (typeof gtag !== "function") return;
  const idle = window.requestIdleCallback ?? ((cb) => setTimeout(cb, 200));
  idle(() => {
    gtag("event", "page_view", {
      page_title: document.title,
      page_location: location.href,
      page_path: location.pathname + location.search,
    });
  });
}

// ── Views loaded on first visit (ADR-038 §2 「구현」) ──

/**
 * Loads a view module the first time its route opens. Resolves null when the module can't be fetched or linked
 * (offline with nothing cached, or a deploy that landed between the page load and this import and broke a link) —
 * the view's own failure screen lives inside the module that just failed, so the caller draws views.js
 * `renderLiturgicalLoadFailure` instead.
 * @template T
 * @param {() => Promise<T>} load
 * @returns {Promise<T | null>}
 */
async function loadViewModule(load) {
  try {
    return await load();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// What the calendar tab and the lectionary view load on their first visit: the view module and everything it
// imports, requested at once. Awaiting calendar.js before the browser discovers its own imports costs one more round
// trip on a cold first visit (measured 2026-10-17 in Chromium, Slow 4G: tab → grid +676 ms sequential, +527 ms at
// once). Chromium's module map then fetches each URL once; WebKit fetches the dependencies a second time when
// calendar.js's own imports resolve (5 requests instead of 3 — PR #355 2nd review, known-issues §13), so there the
// group saves nothing. tests/unit/sw.test.js reads these lists — each must be exactly the first module's static
// imports minus the boot graph, and every specifier a string literal (it follows them to check the offline precache).
const loadCalendarView = () => Promise.all([
  import("./calendar.js"), import("./lectionary.js"), import("./liturgical-engine.js"),
]).then(([mod]) => mod.renderCalendarView);
const loadLectionaryView = () => Promise.all([
  import("./lectionary.js"), import("./liturgical-engine.js"),
]).then(([mod]) => mod.renderLectionaryView);

/** @type {Record<"calendar" | "lectionary", string>} */
const LAZY_VIEW_DESCRIPTIONS = {
  calendar: "대한성공회 교회력 — 날마다의 전례일 · 전례색, 날짜를 누르면 그날의 전례독서",
  lectionary: "대한성공회 감사성찬례 전례독서 — 본기도 · 제1독서 · 시편 · 제2독서 · 복음",
};

// The render function of each view module already loaded, kept so a redraw (the calendar's month steps, the
// lectionary's chips · segments · date steps) renders without awaiting import() again. Even for a module already in
// the module map, import() settles a task later, so the renderLoading() skeleton painted for a frame on every redraw
// (PR #355 review: 40 of 40 month steps in Chromium, main 0). Only a success is kept — a failure is tried again on the
// next visit.
/** @type {Map<string, unknown>} */
const loadedViews = new Map();

/**
 * Opens the calendar tab or the lectionary view: loads its module on the first visit, then renders. A view that
 * throws while rendering — a bug, or a deploy that landed between the page load and the import and linked a new module
 * to an old helper it calls — gets the same failure screen as a module that couldn't load: its own title · header and
 * 「다시 불러오기」, not the shared one-line error that kept the previous screen's header (review 2026-10-18).
 * @template P
 * @param {"calendar" | "lectionary"} view
 * @param {() => Promise<(parsed: P) => Promise<string>>} load
 * @param {P} parsed
 * @param {() => boolean} isStale  route()'s guard — true once a newer route took over
 * @returns {Promise<string | null>} the page title, or null when a newer route took over
 */
async function openLazyView(view, load, parsed, isStale) {
  let render = /** @type {((parsed: P) => Promise<string>) | undefined} */ (loadedViews.get(view));
  if (!render) {
    const loaded = await loadViewModule(load);
    if (loaded) loadedViews.set(view, loaded);
    if (isStale()) return null;
    if (!loaded) return renderLiturgicalLoadFailure(view);
    render = loaded;
  }
  try {
    const title = await render(parsed);
    return isStale() ? null : title;
  } catch (err) {
    console.error(err);
    return isStale() ? null : renderLiturgicalLoadFailure(view);
  }
}

async function route() {
  const isInitialLoad = _isInitialLoad;
  _isInitialLoad = false;
  // 이 route 를 시작한 누름의 자리(위 `_pendingFocusSpot`) — await 앞에서 꺼내 비운다.
  const focusSpot = _pendingFocusSpot;
  _pendingFocusSpot = null;
  // ADR-031: 떠나는 경로의 스크롤을 기억(DOM 변경 전) + 재진입 가드 시퀀스 발급.
  const routeSeq = ++_routeSeq;
  // route() 는 재진입형 async 함수다. 아래의 모든 await 뒤 continuation 은 공유 상태
  // (#app 렌더 · updatePageMeta · trackPageView · 오버레이 · 이어읽기 위치)를 만지기
  // 전에 이 가드로 자신이 여전히 최신 route() 호출인지 확인한다. 리다이렉트(navigate)나
  // 사용자의 다른 네비게이션이 그 사이 _routeSeq 를 올렸으면, 늦게 끝난 fetch 가 이미
  // 떠 있는 새 뷰를 덮어쓰지 않도록 곧장 빠져나간다. (검색 분기는 예전엔 parsePath().view
  // 로 확인했으나 같은 축이라 이 가드로 통일했다 — auto-nav 의 inner route() 가 _routeSeq
  // 를 동기적으로 올리므로 동치이고, 진행 중 다른 검색어로 이동한 경우까지 더 넓게 잡는다.)
  const isStale = () => routeSeq !== _routeSeq;
  window.tabHistory?.onRouteStart();
  // Tab-bar active state + sliding indicator moved to tabbar.js (ADR-034 PR3).
  // Facade call: tabbar ↔ views is a cycle, so this stays on window.
  window.syncTabBarActive?.();
  if (_scrollTrackCleanup) _scrollTrackCleanup();
  clearNode($resumeBannerSlot);
  clearNode($divisionTabsSlot);
  if (readingContext.verseSelectMode) exitVerseSelectMode();
  // Leaving the bookmarks view mid-select must drop the select bar too (self-
  // guards when not in select mode).
  window.exitBookmarkSelectMode?.();
  // Route changes dismiss every open overlay through its controller (ADR-034
  // PR5b / ADR-032): scrims, focus traps, body scroll locks and focus
  // restoration all unwind consistently, and animated-dismiss panels (cite
  // sheet / drawer) are force-hidden so they don't linger over the incoming
  // view. The overlay controller owns the registry, so the router no longer
  // hardcodes each overlay's id + close fn (was 12 closeIfOpen calls + the
  // settings / chapter popovers). Closing the chapter picker / settings popover
  // on nav also makes the /settings desktop fallback's gear.click() always OPEN.
  window.appOverlay.closeAllOverlays();
  const parsed = parsePath();
  // Narrowing on the destructured `view` narrows `parsed` too — each branch reads its own fields off it.
  const { view } = parsed;

  // Sync the desktop header search input with the current route. On mobile the
  // header bar is hidden and /search renders its own in-page input, so skip it.
  if (view === "search" && !isMobile()) {
    $searchInput.value = parsed.query ?? "";
    $searchClear.hidden = !parsed.query;
    $searchBar.dataset.clearHidden = String(!parsed.query);
  } else {
    $searchInput.value = "";
    $searchClear.hidden = true;
    $searchBar.dataset.clearHidden = "true";
  }
  // Refresh in-field search tokens (book scope) for the new route
  // (ADR-033 개정 B) — keeps the persistent header/pill fields in sync with the
  // URL filters across back/forward, pagination and tab restore.
  window.syncSearchFields?.();

  try {
    if (view === "search") {
      if (parsed.query) {
        const autoNav = consumeSearchAutoNavigate();
        // ADR-031: search 탭의 마지막 경로를 미리 기록한다. verse-ref 검색이면
        // renderSearchResults 가 챕터로 auto-nav(replaceState+route 재진입)하며 바깥
        // onRouteEnd 가 _routeSeq 가드로 스킵돼, 안 하면 lastPathForTab.search 가
        // 이전 검색에 머문다. 복원 시엔 autoNavigate=false 라 refMatch 가 클릭 카드로
        // 떠 바운스 없이 마지막 검색이 그대로 복원된다.
        window.tabHistory?.recordPath(location.pathname + location.search);
        await renderSearchResults(parsed.query, parsed.page, autoNav, {
          filterBooks: parsed.filterBooks,
        });
        // renderSearchResults 가 verse-ref auto-nav 으로 inner route() 를 호출했으면
        // _routeSeq 가 올라가 이 가드가 잡는다 — inner route() 가 챕터의 meta·분석을 이미
        // 처리했으니 여기서 덮어쓰지 않는다. (예전 parsePath().view 체크와 동치.)
        if (isStale()) return;
        updatePageMeta({
          title: `"${parsed.query}" 검색`,
          description: `공동번역성서에서 "${parsed.query}" 검색 결과`,
        });
      } else if (isMobile() || parsed.filterBooks.length) {
        // Empty-query /search: recent searches + the book-filter bar (ADR-033).
        // Mobile always shows this full-screen view. Desktop normally falls back
        // to the book list, but when the URL carries an active filter (in=)
        // we render the search view so the scope is visible/removable instead of
        // silently applied by a later header search (ADR-033, Bugbot).
        await renderSearchView({ filterBooks: parsed.filterBooks });
        // renderSearchView 가 ensureBookMap await 중 _routeSeq 변경으로 일찍 빠져나갔거나
        // 그 사이 다른 뷰로 이동했으면 "검색" 제목·분석을 덮어쓰지 않는다 (ADR-033, Bugbot).
        if (isStale()) return;
        dismissLaunchScreen();
        updatePageMeta({ title: "검색", description: "공동번역성서 검색" });
      } else {
        const books = await loadBooks();
        if (isStale()) return;
        renderBookList(books, divisionOrder()[0]);
        dismissLaunchScreen();
        updatePageMeta();
      }
      trackPageView();
      return;
    }

    // Tab-bar destinations (ADR-029 / P2). On mobile, render full-screen views
    // into #app. On desktop (no tab bar yet — these routes are mobile-driven)
    // fall back to the least-surprising behavior: open the existing overlay
    // over the book list so a deep-link / resize-down never dead-ends.
    if (view === "bookmarks") {
      if (isMobile()) {
        // Ensure the books cache is populated so bookmark refs resolve to the
        // Korean short name (창세) instead of falling back to the raw id (gen).
        await loadBooks();
        if (isStale()) return;
        window.renderBookmarksView();
        dismissLaunchScreen();
        updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
        trackPageView();
        return;
      }
      // Desktop fallback: show the book list, then open the bookmark drawer
      // (the established desktop affordance) over it.
      const books = await loadBooks();
      if (isStale()) return;
      renderBookList(books, divisionOrder()[0]);
      dismissLaunchScreen();
      updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
      openBookmarkDrawer(null, null);
      trackPageView();
      return;
    }

    // Bookmark reading view (ADR-035). Renders on both mobile and desktop — it
    // is just a reading page built from localStorage bookmarks (its entry point
    // is the per-folder 읽기 button, but a deep link must still land). Classified
    // as a home-tab route (/read), so the tab bar reads 홈 while reading. Needs
    // the books cache so refs resolve to the Korean short name.
    if (view === "bookmark-read") {
      await loadBooks();
      if (isStale()) return;
      // Show the loading skeleton before awaiting chapter loads so #app reflects
      // the new route immediately (the renderer is data-first and won't touch
      // #app until its loads finish — without this the prior view would linger
      // while the URL already reads /read). Mirrors the chapter branch.
      renderLoading();
      dismissLaunchScreen();
      const readTitle = await window.renderBookmarkReadView(parsed.folderId);
      if (isStale()) return;
      updatePageMeta({ title: readTitle || "북마크 읽기", description: "북마크한 본문 모아 읽기" });
      trackPageView();
      return;
    }

    // Calendar tab (ADR-038 §1 · §2 A2) and lectionary view (§3 A3). Full pages on mobile and desktop alike (ADR-035
    // /read precedent — no drawer fallback); the lectionary view is classified under the calendar tab (tab-history
    // tabOf). Each view preloads its engine bundle(s) itself and commits the DOM data-first, so show the skeleton here
    // so #app reflects the new route immediately (mirrors the bookmark-read branch above) — a redraw whose data is
    // cached commits before it paints (loadedViews). Their modules load on the first visit (see the note at the imports).
    if (view === "calendar" || view === "lectionary") {
      renderLoading();
      dismissLaunchScreen();
      const title = view === "calendar"
        ? await openLazyView("calendar", loadCalendarView, parsed, isStale)
        : await openLazyView("lectionary", loadLectionaryView, parsed, isStale);
      if (title === null) return;
      updatePageMeta({ title, description: LAZY_VIEW_DESCRIPTIONS[view] });
      trackPageView();
      return;
    }

    if (view === "settings") {
      if (isMobile()) {
        window.renderSettingsView();
        dismissLaunchScreen();
        updatePageMeta({ title: "설정", description: "공동번역성서 설정" });
        trackPageView();
        return;
      }
      // Desktop fallback: settings is a popover anchored to the header gear, not
      // a routable page. Show the book list and click the desktop trigger to
      // open the popover so a deep-link / resize-down still lands somewhere.
      const books = await loadBooks();
      if (isStale()) return;
      renderBookList(books, divisionOrder()[0]);
      dismissLaunchScreen();
      updatePageMeta({ title: "설정", description: "공동번역성서 설정" });
      /** @type {HTMLElement | null} */
      const gear = document.querySelector("#settings-anchor .settings-btn");
      if (gear) gear.click();
      trackPageView();
      return;
    }

    const books = await loadBooks();
    if (isStale()) return;

    if (view === "books") {
      if (isInitialLoad && loadStartupBehavior() === "resume") {
        const savedPos = loadReadingPosition();
        if (savedPos && savedPos.bookId) {
          navigate(`/${savedPos.bookId}/${savedPos.chapter}?resume=1`);
          return;
        }
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books, divisionOrder()[0]);
      updatePageMeta();
      trackPageView();
      return;
    }

    if (view === "division") {
      const { division } = parsed;
      // In vulgate mode, deuterocanon has no separate tab — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        navigate("/old_testament");
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books, division);
      const divLabel = DIVISION_LABELS[division] ?? division;
      updatePageMeta({
        title: divLabel,
        description: `공동번역성서 ${divLabel} 목록`,
      });
      trackPageView();
      return;
    }

    const { bookId } = parsed;
    const book = books.find((b) => b.id === bookId);
    if (!book) {
      renderError("해당 성서를 찾을 수 없습니다.");
      dismissLaunchScreen();
      return;
    }

    if (view === "chapters") {
      dismissLaunchScreen(); // Start fade-out immediately
      renderChapterList(book, books);
      updatePageMeta({
        title: book.name_ko,
        description: `${book.name_ko} — 공동번역성서 전문 읽기`,
      });
      trackPageView();
      return;
    }

    // For chapter/prologue: dismiss as soon as the loading placeholder appears,
    // so the user sees the skeleton instead of the launch screen while data loads.
    renderLoading();
    dismissLaunchScreen();

    if (view === "prologue") {
      const data = await loadPrologue(bookId);
      if (isStale()) return;
      renderPrologue(data, book);
      saveReadingPosition(bookId, "prologue");
      updatePageMeta({
        title: `${book.name_ko} 머리말`,
        description: `${book.name_ko} 머리말 — 공동번역성서`,
      });
      trackPageView();
      return;
    }

    if (view === "chapter") {
      const { chapter } = parsed;
      // parsePath's parseInt gives NaN for a segment that isn't a number (`/john/` · `/john/abc`), and NaN fails
      // both range comparisons — without the integer check it would fetch `john-NaN.json` and show the load
      // failure instead of this notice (PR #353 리뷰, 2026-10-17).
      if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
      if (isStale()) return;
      const savedPos = loadReadingPosition();
      const autoRestore = isInitialLoad
        && loadStartupBehavior() === "resume"
        && savedPos
        && savedPos.bookId === bookId
        && savedPos.chapter === chapter
        && savedPos.verse;
      const resumeVerse = (parsed.resume || autoRestore) && savedPos && savedPos.verse
        ? savedPos.verse
        : null;
      renderChapter(data, book, {
        highlightQuery: parsed.highlightQuery,
        highlightVerse: parsed.highlightVerse,
        highlightVerseEnd: parsed.highlightVerseEnd,
        highlightVerseSpec: parsed.highlightVerseSpec,
        resumeVerse,
      });
      saveReadingPosition(bookId, chapter, resumeVerse);
      startScrollTracking(bookId, chapter);
      updatePageMeta({
        title: `${book.name_ko} ${chapter}${chUnit(book.id)}`,
        description: `${book.name_ko} ${chapter}${chUnit(book.id)} — 공동번역성서`,
      });
      trackPageView();
    }
  } catch (err) {
    console.error(err);
    // A route a newer one already replaced fails quietly — its late rejection (a chapter fetch that failed after the
    // user moved on to the calendar) must not paint the shared error over the screen now showing. Same guard as after
    // every await above (review 2026-10-18 — main had the gap too).
    if (isStale()) return;
    renderError("데이터를 불러올 수 없습니다.");
  } finally {
    dismissLaunchScreen(); // safety fallback (already a no-op if called above)
    // ADR-031: 이 호출이 여전히 최신 라우트일 때만 새 경로 기록 + 스크롤 복원.
    // 내부 navigate()(리다이렉트)가 _routeSeq 를 올렸으면 낡은 바깥 호출이라 건너뛴다.
    if (routeSeq === _routeSeq) {
      window.tabHistory?.onRouteEnd();
      // 누른 링크가 옛 화면과 함께 사라져 body 로 빠진 포커스를 새 화면의 같은 컨트롤로(ADR-031 §5). 오류 화면 ·
      // 다른 뷰에는 같은 키가 없어 아무것도 하지 않는다.
      restoreFocusSpot(focusSpot, $app);
    }
  }
}

// ── BEGIN IN_PAGE_LINK ──
/**
 * 링크가 이 페이지 안에서 가리키는 요소의 id — 「본문 바로가기」(`#app`) — 를, 다른 경로 · 쿼리로 가거나 조각(#)이 없으면
 * null 을 낸다. 순수 함수 — 두 인자만 읽는다.
 * @param {{ pathname: string, search: string, hash: string }} url  링크의 href 를 푼 것
 * @param {{ pathname: string, search: string }} loc  지금 주소
 * @returns {string | null}
 */
function inPageTargetId(url, loc) {
  if (!url.hash || url.hash === "#") return null;
  if (url.pathname !== loc.pathname || url.search !== loc.search) return null;
  const raw = url.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;   // 깨진 퍼센트 이스케이프 — 원문 그대로 id 로 찾는다(parsePath 의 decodeOrRaw 와 같은 처리)
  }
}
// ── END IN_PAGE_LINK ──

/**
 * 페이지 안 링크의 대상으로 포커스를 옮긴다. 대화형이 아닌 대상(`<main>` 랜드마크)은 `tabindex="-1"` 이 있어야 포커스를
 * 받으므로 처음 쓸 때 단다. 화면 밖이면 브라우저가 보이게 스크롤한다(focus 의 기본 동작).
 * @param {string} id
 */
function focusInPageTarget(id) {
  const target = document.getElementById(id);
  if (!(target instanceof HTMLElement)) return;
  if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  const a = /** @type {HTMLAnchorElement | null} */ (t.closest("a[href]"));
  if (!a) return;
  if (e.defaultPrevented) return;
  if (a.href.startsWith("blob:")) return;
  const url = new URL(a.href, location.origin);
  if (url.origin !== location.origin) return;
  if (a.target === "_blank") return;
  if (isModifiedClick(e)) return;   // 새 탭 · 새 창 — 브라우저에 맡긴다(helpers.js)
  e.preventDefault();
  // 페이지 안 링크는 라우트가 아니다 — 대상으로 포커스를 옮긴다(known-issues §5). 그전엔 여기서 route() 를 호출해 같은 화면을
  // 다시 그리기만 하고 포커스는 본문으로 가지 않았다. 브라우저에 맡기면 주소에 「#app」이 붙어 기록 항목이 하나 더 생긴다.
  const targetId = inPageTargetId(url, location);
  if (targetId !== null) {
    focusInPageTarget(targetId);
    return;
  }
  const path = url.pathname + url.search;
  // 같은 화면을 다시 그리는 링크면 그 자리 — route() 가 시작하자마자 꺼내 간다(위 `_pendingFocusSpot`).
  _pendingFocusSpot = focusSpotOf(a, e, $app);
  try {
    if (path === location.pathname + location.search) {
      route();
    } else {
      navigate(path);
    }
  } finally {
    _pendingFocusSpot = null;   // route() 앞에서 던졌으면(pushState) 다음 route — 뒤로 가기 · 탭 전환 — 로 새지 않게
  }
});

// popstate stays here (route is module-local). The DOMContentLoaded
// bootstrap handler stayed in app.js (Phase 8 territory) — it kicks off
// route() and the deferred init chain (initCompactHeader /
// initBookmarkSheetDrag / registerServiceWorker / maybeShowInstallNudge /
// driveSync.initDriveSync), several of which still live in app.js.
// ADR-031: 뒤로/앞으로(POP)는 떠날 때의 스크롤로 복원(scrollRestoration=manual 이라
// 브라우저가 안 하므로 직접). 일반 링크 이동(PUSH)은 요청하지 않아 복원하지 않는다.
window.addEventListener("popstate", () => {
  window.tabHistory?.requestRestore();
  route();
});

// ── Window facade ──
// route / navigate / parsePath are called as bare globals by app.js bootstrap,
// search.js, bookmark.js, settings-ui.js, and audio-player.js (parsePath).
window.parsePath = parsePath;
window.route = route;
window.navigate = navigate;
// Monotonic route counter (ADR-031): async view renderers (search.js) read this
// before awaiting and bail if it changed, so a late completion never overwrites
// a newer view (ADR-033).
window.routeSeq = () => _routeSeq;

export {};
