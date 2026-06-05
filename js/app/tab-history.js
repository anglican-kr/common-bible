// @ts-check
// ADR-031 — 탭 히스토리(탭별 위치 복원).
//
// 탭(홈·북마크·설정·검색)을 오가다 다시 같은 탭으로 돌아오면, 그 탭이 마지막으로
// 보던 라우트와 스크롤 위치로 복원한다(iOS 탭 관용구). 성서를 읽다 북마크·설정
// 탭으로 갔다가 홈으로 돌아오면 읽던 장·스크롤 지점으로 되돌아온다.
//
// 동작 두 축:
//  1. scrollMemory: 전체 경로(pathname+search) → scrollY. route() 가 떠나는 경로의
//     스크롤을 onRouteStart 에서 저장하고, 새 경로 렌더 직후 onRouteEnd 에서 복원.
//  2. lastPathForTab: 각 탭이 마지막으로 본 경로. 홈(읽기 스택)·검색(?q=)은 하위
//     경로가 가변이라 핵심. 북마크·설정은 단일 라우트라 정적 href 로 충분하지만,
//     스크롤 복원은 scrollMemory 가 경로 키로 자동 처리한다. 홈 탭 버튼은 정적
//     href="/" 라, tabbar.js 가 다른 탭에서 홈으로 올 때 클릭을 가로채 lastPath("home")
//     으로 보낸다(이미 홈이면 기존대로 루트="/" pop-to-root).
//
// 왜 history.scrollRestoration = "manual" 인가: 기본값 auto 면 popstate(뒤로/앞으로)
// 시 브라우저가 먼저 스크롤을 옮겨, onRouteStart 가 "떠나는 페이지"의 실제 scrollY 를
// 읽지 못한다(이미 대상 페이지 기준으로 이동). manual 로 끄고 우리가 직접 복원해야
// 떠나는 스크롤 저장과 도착 스크롤 복원이 모두 정확하다. SPA 커스텀 렌더의 표준.

window.tabHistory = (() => {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // ── BEGIN TABOF ── (tests/unit/tab-history.test.js 가 슬라이스해 검증)
  /**
   * 전체 경로(pathname[+search])가 어느 탭에 속하는지 분류한다. 첫 세그먼트만 본다
   * — /search·/bookmarks·/settings 는 각 탭, 그 외(/, /<division>, /<book>/<chapter>
   * …)는 모두 홈(읽기 스택).
   * @param {string} path
   * @returns {"home"|"search"|"bookmarks"|"settings"}
   */
  function tabOf(path) {
    const seg = path.replace(/^\//, "").split(/[/?#]/)[0];
    if (seg === "search") return "search";
    if (seg === "bookmarks") return "bookmarks";
    if (seg === "settings") return "settings";
    return "home";
  }
  // ── END TABOF ──

  /** @type {Map<string, number>} */
  const scrollMemory = new Map();
  /** @type {Record<"home"|"search"|"bookmarks"|"settings", string>} */
  const lastPathForTab = {
    home: "/",
    search: "/search",
    bookmarks: "/bookmarks",
    settings: "/settings",
  };
  // 가장 최근 완료된 라우트 경로(= 지금 화면). onRouteStart 가 이 경로의 스크롤을
  // 저장하므로, 떠나기 직전 위치를 정확히 잡는다.
  let currentPath = location.pathname + location.search;

  function fullPath() {
    return location.pathname + location.search;
  }

  // route() 시작 시 호출 — 떠나는 경로(currentPath)의 스크롤을 기억한다. DOM 이 아직
  // 옛 화면이고 manual 이라 window.scrollY 가 떠나는 페이지 기준이다.
  function onRouteStart() {
    scrollMemory.set(currentPath, window.scrollY || 0);
  }

  // route() 가 새 경로 렌더를 마친 직후 호출(중복/리다이렉트는 route 의 시퀀스 가드가
  // 거른다) — 새 경로를 해당 탭의 마지막 경로로 기록하고, 기억된 스크롤이 있으면 복원.
  function onRouteEnd() {
    const path = fullPath();
    currentPath = path;
    lastPathForTab[tabOf(path)] = path;
    const y = scrollMemory.get(path);
    if (y == null) return; // 기억 없음 → 뷰가 정한 스크롤(보통 최상단) 유지
    window.scrollTo(0, y);
    // 폰트·인용 등 비동기 레이아웃 이동으로 높이가 늦게 잡힐 수 있어 다음 프레임 한 번 더.
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  /**
   * 해당 탭이 마지막으로 본 경로. tabbar.js 의 홈/검색 진입이 정적 href 대신 이 값으로
   * 라우팅해 위치를 복원한다.
   * @param {"home"|"search"|"bookmarks"|"settings"} tab
   * @returns {string}
   */
  function lastPath(tab) {
    return lastPathForTab[tab];
  }

  return {
    tabOf,
    fullPath,
    onRouteStart,
    onRouteEnd,
    lastPath,
    // 테스트/디버그용 노출(런타임 의존 금지).
    _scrollMemory: scrollMemory,
    _lastPathForTab: lastPathForTab,
  };
})();

export {};
