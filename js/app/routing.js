"use strict";
// @ts-check

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

import { loadBooks, loadChapter, loadPrologue } from "./data-fetch.js";
import {
  renderBookList, renderChapterList, renderChapter, renderPrologue,
  renderLoading, renderError, divisionOrder, DIVISION_LABELS,
} from "./views.js";

const { _$, clearNode, chUnit } = window.appHelpers;
const {
  loadStartupBehavior, loadReadingPosition, saveReadingPosition, loadBookOrder,
} = window.appStorage;
const { dismissLaunchScreen } = window.appSettings;
const { readingContext } = window;

// DOM anchors. Redeclared locally so routing.js is self-contained.
const $resumeBannerSlot = _$("resume-banner-slot");
const $divisionTabsSlot = _$("division-tabs-slot");
const $searchInput = /** @type {HTMLInputElement} */ (_$("search-input"));
const $searchClear = _$("search-clear");
const $searchBar = _$("search-bar");

// ── Reading-position scroll tracker + route state ──
let _scrollTrackCleanup = null;
let _isInitialLoad = true;
// ADR-031: route() 호출마다 증가. 리다이렉트(books→resume 등)로 route 가 재진입하면
// 바깥 호출의 finally(onRouteEnd 스크롤 복원)가 이미 낡았음을 알도록 시퀀스로 가드한다.
let _routeSeq = 0;
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

function parsePath() {
  const pathname = location.pathname.replace(/^\//, "");
  if (!pathname) return { view: "books" };

  const query = new URLSearchParams(location.search || "");

  // Search route: /search?q=...&page=...&in=<bookId>&and=<keyword> (ADR-033).
  // `in` (book-picker scope, repeatable) and `and` ("결과 내 검색" AND keywords,
  // repeatable) live in the URL so they survive history/back-forward and tab
  // restore (ADR-031), and so paginated/filtered links stay shareable.
  if (pathname === "search") {
    return {
      view: "search",
      query: query.get("q") || "",
      page: parseInt(query.get("page") ?? "", 10) || 1,
      filterBooks: query.getAll("in").filter(Boolean),
      andTerms: query.getAll("and").filter(Boolean),
    };
  }

  // Tab-bar destinations (ADR-029 / P2). On mobile these render full-screen
  // views; on desktop route() falls back to the existing overlays.
  if (pathname === "bookmarks") return { view: "bookmarks" };
  if (pathname === "settings") return { view: "settings" };

  const parts = pathname.split("/");
  if (parts.length === 1) {
    if (DIVISION_LABELS[parts[0]]) return { view: "division", division: parts[0] };
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
    const spec = parts[2];
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
    } else if (/^[\d,\-a-z]+$/.test(spec)) {
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

async function route() {
  const isInitialLoad = _isInitialLoad;
  _isInitialLoad = false;
  // ADR-031: 떠나는 경로의 스크롤을 기억(DOM 변경 전) + 재진입 가드 시퀀스 발급.
  const routeSeq = ++_routeSeq;
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
  const { view, bookId, chapter, division } = parsed;

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
          andTerms: parsed.andTerms,
        });
        // If renderSearchResults auto-navigated to a chapter, the inner route() call
        // already handles meta and analytics for that view — don't overwrite.
        if (parsePath().view !== "search") return;
        updatePageMeta({
          title: `"${parsed.query}" 검색`,
          description: `공동번역성서에서 "${parsed.query}" 검색 결과`,
        });
      } else if (isMobile() || parsed.filterBooks.length || parsed.andTerms.length) {
        // Empty-query /search: recent searches + the book-filter bar (ADR-033).
        // Mobile always shows this full-screen view. Desktop normally falls back
        // to the book list, but when the URL carries an active filter (in=/and=)
        // we render the search view so the scope is visible/removable instead of
        // silently applied by a later header search (ADR-033, Bugbot).
        await renderSearchView({ filterBooks: parsed.filterBooks });
        // renderSearchView 가 ensureBookMap await 중 routeSeq 변경으로 일찍 빠져나갔으면
        // 이미 다른 뷰가 떠 있으니, "검색" 제목·분석을 덮어쓰지 않는다 (ADR-033, Bugbot).
        if (parsePath().view !== "search") return;
        dismissLaunchScreen();
        updatePageMeta({ title: "검색", description: "공동번역성서 검색" });
      } else {
        const books = await loadBooks();
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
        window.renderBookmarksView();
        dismissLaunchScreen();
        updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
        trackPageView();
        return;
      }
      // Desktop fallback: show the book list, then open the bookmark drawer
      // (the established desktop affordance) over it.
      const books = await loadBooks();
      renderBookList(books, divisionOrder()[0]);
      dismissLaunchScreen();
      updatePageMeta({ title: "북마크", description: "공동번역성서 북마크 목록" });
      openBookmarkDrawer(null, null);
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
      // In vulgate mode, deuterocanon has no separate tab — redirect to old_testament
      if (division === "deuterocanon" && loadBookOrder() === "vulgate") {
        navigate("/old_testament");
        return;
      }
      dismissLaunchScreen(); // Start fade-out immediately
      renderBookList(books, division);
      const divLabel = DIVISION_LABELS[division ?? ""] ?? division;
      updatePageMeta({
        title: divLabel,
        description: `공동번역성서 ${divLabel} 목록`,
      });
      trackPageView();
      return;
    }

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
      if (!bookId) return;
      const data = await loadPrologue(bookId);
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
      if (!bookId || typeof chapter !== "number") return;
      if (chapter < 1 || chapter > book.chapter_count) {
        renderError("해당 장을 찾을 수 없습니다.");
        return;
      }
      const data = await loadChapter(bookId, chapter);
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
    renderError("데이터를 불러올 수 없습니다.");
    console.error(err);
  } finally {
    dismissLaunchScreen(); // safety fallback (already a no-op if called above)
    // ADR-031: 이 호출이 여전히 최신 라우트일 때만 새 경로 기록 + 스크롤 복원.
    // 내부 navigate()(리다이렉트)가 _routeSeq 를 올렸으면 낡은 바깥 호출이라 건너뛴다.
    if (routeSeq === _routeSeq) window.tabHistory?.onRouteEnd();
  }
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
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  const path = url.pathname + url.search;
  if (path === location.pathname + location.search) {
    route();
  } else {
    navigate(path);
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
