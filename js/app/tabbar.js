// @ts-check
// ADR-030 — 모바일 탭 바(아이콘 전용 탭과 따로 떨어진 검색 원형), 스크롤 축소. 검색 입력은 ADR-048.
//
// 검색 원형은 입력창으로 바뀌지 않는다(ADR-048 §1, ADR-030 §3의 하단 입력 모핑을 대체). 휴대폰의 검색 입력창은 검색 화면
// 위쪽의 입력창 하나(search.js `buildInPageSearchInput`)다. 검색 원형은 검색 화면이 아닌 곳에서는 검색 화면으로 가고,
// 검색 화면에서는 그 입력창으로 포커스를 옮긴다(ADR-048 §2).

const $dock = document.getElementById("tab-dock");
const $searchBtn = document.getElementById("tab-search");
const $home = document.querySelector('#tab-bar [data-tab="home"]');

/** @type {Window & typeof globalThis & Record<string, any>} */
const W = /** @type {any} */ (window);
const { isModifiedClick } = window.appHelpers;

let collapsed = false; // ADR-030 P3: 스크롤 축소(탭 바 홈 원형) 상태

// ── BEGIN SCROLL ── (tests/unit/tabbar.test.js 가 슬라이스해 검증)
// 스크롤 축소: 아래로 스크롤하면 탭 바를 홈 원형으로 접고, 맨 위로 올라오면 복구한다.
// 읽는 중간에 위로 스크롤해도 유지(깜빡임 방지) — 최상단(또는 홈 탭)에서만 복구.
const SCROLL_COLLAPSE_AT = 64; // 이만큼 아래로 내려가야 접힘(헤더 높이 근처)
const SCROLL_TOP_EPS = 4; // 최상단 판정 여유
/**
 * @param {number} y 현재 scrollY
 * @param {number} lastY 직전 scrollY
 * @param {boolean} collapsed 현재 접힘 여부
 * @returns {boolean} 다음 접힘 여부
 */
function nextScrollCollapsed(y, lastY, collapsed) {
  if (y <= SCROLL_TOP_EPS) return false; // 최상단 → 복구
  if (y > lastY && y > SCROLL_COLLAPSE_AT) return true; // 아래로 + 임계 초과 → 접힘
  return collapsed; // 그 외(중간에서 위로 등) 유지
}
// ── END SCROLL ──

// 검색 원형(ADR-048 §2): 검색 화면이 아닌 곳에서는 검색 화면으로 가기만 한다. 마지막 검색(검색어, 결과, 스크롤 위치)이
// 있으면 그 화면이다(ADR-031). 입력창에 포커스를 주지 않아 키보드가 뜨지 않는다. 검색 화면에서는 위쪽 입력창으로 포커스를
// 옮긴다. iOS는 누른 동작과 같은 실행 흐름에서 포커스를 줄 때만 키보드를 띄우므로(ADR-030 §6) 바로 준다. 결과를 내려 보던
// 중이면 맨 위로 올린 뒤 옮긴다(입력창은 검색 화면 맨 위에 있다).
$searchBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  if (W.parsePath?.().view === "search") {
    // Already on the search tab: never navigate again (that would push a duplicate history entry). While the view
    // is still drawing, the bar is not there yet and the press does nothing.
    const input = document.getElementById("search-inpage-input");
    if (input instanceof HTMLInputElement) {
      // `instant`: html sets scroll-behavior: smooth, so a plain scrollTo would still be animating when focus and the
      // keyboard arrive (as lectionary.js, calendar.js and search.js scroll to the top).
      window.scrollTo({ top: 0, behavior: "instant" });
      input.focus({ preventScroll: true });
    }
    return;
  }
  W.tabHistory?.requestRestore(); // 탭 전환 → 마지막 검색 결과 스크롤 복원
  W.navigate(W.tabHistory?.lastPath("search") || "/search");
});

// ADR-030 P4: 스크롤 축소 상태에서 홈 탭 = 홈 이동이 아니라 "펼치기" — 탭바 복원 +
// 오디오 미니를 원래 floating 위치로 되돌린다(읽던 위치 유지). preventDefault 로
// 전역 <a> 인터셉터(defaultPrevented 면 네비 안 함)를 막는다. 펼친 뒤 다시 아래로
// 스크롤하면 정상적으로 재축소. 축소 상태가 아니면 평소대로 홈으로 이동.
$home?.addEventListener("click", (e) => {
  // 수정 키 클릭(새 탭 · 새 창)은 이 화면에서 펼치지도 옮기지도 않는다 — 전역 <a> 인터셉터와 같은 조건(helpers.js).
  if (isModifiedClick(e)) return;
  if (collapsed) {
    e.preventDefault();
    applyCollapsed(false);
    return;
  }
  enterHomeTab(e);
});
// 데스크톱 상단 바의 「성서」 탭(#header-home, ADR-043 §3)도 같은 곳으로 간다. 탭 바가 없어 펼칠 것은 없다.
document.getElementById("header-home")?.addEventListener("click", (e) => {
  if (isModifiedClick(e)) return;
  enterHomeTab(e);
});

/**
 * 홈 탭과 데스크톱 「성서」 탭이 가는 곳. 가로챌 일이 없으면 그대로 두어 전역 <a> 인터셉터가 href="/"로 간다.
 * @param {Event} e
 */
function enterHomeTab(e) {
  // ADR-031: 다른 탭(북마크·설정·검색)에서 홈으로 올 땐 마지막 읽던 위치로 복원.
  // 복원 대상이 루트뿐이면(아직 읽은 적 없음) 가로채지 않고 기본 href 진행.
  const th = W.tabHistory;
  if (th && th.tabOf(th.fullPath()) !== "home") {
    const dest = th.lastPath("home");
    if (dest && dest !== "/") {
      e.preventDefault();
      th.requestRestore(); // 탭 전환(POP 의미론) → 읽던 스크롤 복원
      W.navigate(dest);
    }
    return;
  }
  // ADR-031 개정: 이미 홈 스택이면 성서 목록으로 — iOS pop-to-root. 읽던 화면(장·
  // 머리말·장 목록)에서 눌렀다면 그 책의 구분 탭으로 가서 읽던 책 카드에 포커스를
  // 맞춘다(키보드/스크린 리더 사용자가 맥락에
  // 착지). 구분 탭이 없는 책(전례시편 · 송가)은 성서 목록 첫 화면으로(views.js bookListPath).
  // 목록·구분 화면(bookId 없음)에선 기본 href="/" 로 진행해 최상단.
  const p = W.parsePath?.();
  const bookId = p && "bookId" in p ? p.bookId : null;
  const book = bookId && W.getBooksCache?.()?.find((b) => b.id === bookId);
  if (book) {
    e.preventDefault();
    W.setPendingBookFocus?.(book.id);
    W.navigate(W.bookListPath(book));
  }
}

// ADR-038 §1: 캘린더 탭. 다른 탭에서 오면 마지막으로 보던 캘린더 화면(전례독서 /lectionary/… 포함)으로,
// 전례독서에서 누르면 마지막 캘린더 보기로 간다(사용자 결정 2026-11-07, 갈 곳은 tab-history.js calendarTabDest).
// 캘린더 보기에서 누르면 가로채지 않아 정적 href="/calendar"(이번 달)로 간다.
// 데스크톱 상단 바의 「캘린더」 탭(#header-calendar — 탭 바가 없는 넓은 화면의 입구, ADR-043)도 이 처리기를 단다 —
// 탭과 같은 곳으로 간다(사용자 결정 2026-10-15 · PR #348 리뷰; 그전엔 정적 href 뿐이라 늘 이번 달이었다).
// 가로 모드의 스크롤 축소(.collapsed)에서는 탭이 다 보여 이 탭도 눌린다 — 같은 동작이고, 라우트가
// 바뀌면 축소가 풀린다(syncTabBarActive → resetTabCollapse).
/** @param {Event} e */
function enterCalendarTab(e) {
  // 수정 키 클릭은 이 화면을 옮기지 않으므로 복원도 요청하지 않는다 — 요청이 남으면 다음 링크
  // 이동(PUSH)이 뷰가 정한 스크롤 대신 옛 위치로 튄다(전역 <a> 인터셉터와 같은 조건, helpers.js).
  if (isModifiedClick(e)) return;
  const th = W.tabHistory;
  const dest = th?.calendarTabDest();
  if (!th || !dest) return;
  e.preventDefault();
  const here = th.fullPath();
  th.requestRestore();   // 탭 전환은 뒤로 가기처럼 그 화면의 스크롤을 복원한다(POP 의미론). 목록은 스크롤 값을 저장하지 않아 주소의 날짜 줄로 간다.
  // 이미 그 주소면 다시 그리기만 한다 — 같은 주소가 방문 기록에 쌓이면 뒤로 가기가 같은 화면을 되풀이한다(routing.js의 링크 처리와 같다).
  if (dest === here) W.route?.();
  else W.navigate(dest);
}
document.querySelector('#tab-bar [data-tab="calendar"]')?.addEventListener("click", enterCalendarTab);
document.getElementById("header-calendar")?.addEventListener("click", enterCalendarTab);

// ADR-031: 북마크·설정 탭은 정적 href 로 충분하지만(단일 라우트), 다른 탭에서 전환해
// 들어올 땐 스크롤 복원을 요청한다. 같은 탭 재탭(=pop-to-root)이면 요청하지 않아 최상단.
// preventDefault 안 함 — 전역 <a> 인터셉터가 href 로 navigate, requestRestore 는 플래그만.
// 수정 키 클릭은 인터셉터가 가로채지 않아(새 탭) 이 화면은 그대로다 — 요청하지 않는다.
/** @param {Event} e @param {"bookmarks"|"settings"} targetTab */
function restoreOnTabSwitch(e, targetTab) {
  if (isModifiedClick(e)) return;
  const th = W.tabHistory;
  if (th && th.tabOf(th.fullPath()) !== targetTab) th.requestRestore();
}
document
  .querySelector('#tab-bar [data-tab="bookmarks"]')
  ?.addEventListener("click", (e) => restoreOnTabSwitch(e, "bookmarks"));
document
  .querySelector('#tab-bar [data-tab="settings"]')
  ?.addEventListener("click", (e) => restoreOnTabSwitch(e, "settings"));

// ── 스크롤 축소 적용 ──
/** @param {boolean} v */
function applyCollapsed(v) {
  if (v === collapsed) return;
  collapsed = v;
  $dock?.classList.toggle("collapsed", collapsed);
  // body 클래스 — 오디오 바(별도 요소)가 축소 시 dock 행으로 들어오는 CSS 트리거.
  document.body.classList.toggle("tabbar-collapsed", collapsed);
  // 축소 진입·해제로 .tab-item 폭이 바뀌면 슬라이딩 인디케이터 위치가 달라진다.
  // 라우트 변경이 없어 syncTabBarActive 가 호출되지 않고, reduced-motion 에선 max-width
  // transitionend 도 안 떠(트랜지션 없음) 인디케이터가 stale 위치에 남는다 → 명시적
  // 재배치(축소 중엔 CSS 가 인디케이터를 숨기므로 해제 프레임의 재배치가 실효).
  W.syncTabIndicator?.();
}
// 스크롤 축소는 (1) 오디오 북 설정이 켜져 있고(미니 오디오 전제) (2) 읽기 화면
// (본문 chapter·프롤로그)일 때만. 책 목록·장 선택·검색·북마크·설정 화면에선 축소 안 함.
function collapseEnabled() {
  if (!W.appStorage?.loadAudioShow?.()) return false;
  const view = W.parsePath?.().view;
  return view === "chapter" || view === "prologue";
}
let lastScrollY = 0;
let scrollRAF = 0;
function onScroll() {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => {
    scrollRAF = 0;
    const y = window.scrollY || 0;
    // 축소 비대상 화면이면 항상 펼친 상태 유지.
    applyCollapsed(collapseEnabled() && nextScrollCollapsed(y, lastScrollY, collapsed));
    lastScrollY = y;
  });
}
window.addEventListener("scroll", onScroll, { passive: true });
// 라우트 변경 시 호출(syncTabBarActive). 무조건 0 으로 리셋하면 뒤로가기의 스크롤
// 복원(중간 위치)에서 lastScrollY 가 어긋나 방향을 오판하거나 읽던 중 펼쳐진 채 남는다.
// → rAF 로 브라우저 스크롤 복원 뒤 실제 scrollY 기준으로 재동기화(방향 오판 방지) +
// 복원 위치가 임계 초과면 그대로 축소 유지. 새 뷰(최상단)면 자연히 펼침.
W.resetTabCollapse = () => {
  requestAnimationFrame(() => {
    const y = window.scrollY || 0;
    lastScrollY = y;
    applyCollapsed(collapseEnabled() && y > SCROLL_COLLAPSE_AT);
  });
};


// Moved from views.js (ADR-034 PR3) to consolidate all tab-bar logic
// here. route() calls syncTabBarActive on every navigation via the
// W.syncTabBarActive facade — kept a facade because tabbar <-> views is
// a dependency cycle (this module already calls W.route / W.navigate / W.parsePath).
const $tabBar = document.getElementById("tab-bar");

// ── Tab bar active state (ADR-029, ADR-030) ──
// The global <a> click interceptor (further below) already SPA-navigates the
// tab links; this only reflects the current route in the bar's active highlight.
// Reading routes (/, /<division>, /<book>/<chapter>, …) all map to the home tab.
// ADR-030: 검색은 탭에서 분리된 #tab-search 버튼 — seg==="search" 일 때 별도로 활성.
// ADR-038 §1 · §3: /calendar·/lectionary 는 캘린더 탭 소속 — 홈 다음 두 번째 탭(A2).
// ── BEGIN HEADER_NAV ── (tests/unit/tabbar.test.js 가 슬라이스해 검증)
/**
 * 데스크톱 상단 바의 목적지 탭에 지금 있는 곳을 표시한다(ADR-043 §3). 캘린더와 전례독서는 「캘린더」, 그 밖의 화면은 「성서」다.
 * 검색 결과, 그리고 데스크톱에서 성서 목록 위에 패널이나 팝오버로 여는 /bookmarks 와 /settings 도 「성서」다.
 * @param {string} active  syncTabBarActive 가 정한 탭 바의 탭
 */
function syncHeaderNav(active) {
  const current = active === "calendar" ? "calendar" : "home";
  for (const a of document.querySelectorAll("#header-nav [data-nav]")) {
    if (a.getAttribute("data-nav") === current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}
// ── END HEADER_NAV ──

function syncTabBarActive() {
  if (!$tabBar) return;
  const seg = location.pathname.replace(/^\//, "").split("/")[0];
  const active = seg === "search" ? "search"
    : seg === "bookmarks" ? "bookmarks"
    : seg === "settings" ? "settings"
    : seg === "calendar" || seg === "lectionary" ? "calendar"
    : "home";
  for (const a of $tabBar.querySelectorAll(".tab-item")) {
    const on = a.getAttribute("data-tab") === active;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  syncHeaderNav(active);
  if ($searchBtn) {
    const on = active === "search";
    $searchBtn.classList.toggle("active", on);
    if (on) $searchBtn.setAttribute("aria-current", "page");
    else $searchBtn.removeAttribute("aria-current");
  }
  // ADR-030 P3: 라우트 변경 시 스크롤 축소 복구(새 뷰는 최상단에서 시작).
  window.resetTabCollapse?.();
  // ADR-030 후속⁵: 공유 슬라이딩 인디케이터를 활성 탭으로 이동(없으면 숨김).
  _curTabActive = active;
  positionTabIndicator(active);
}

// ── ADR-030 후속⁵: 슬라이딩 인디케이터 ──
// division-tab 슬라이드(buildDivisionTabs)와 동일 패턴 — 단일 absolute 요소를 활성
// 탭의 실측 위치(offsetLeft/Width; space-between 60px 슬롯이라 비선형)로 translateX.
// 탭 사이 이동일 때만 슬라이드(CSS transition), 처음 표시/리사이즈/감속선호는 스냅.
// 축소(.collapsed) 중 숨김은 CSS(특이도)가 담당.
/** @type {string | null} */
let _prevTabIndic = null;   // 인디케이터가 현재 떠 있는 탭(없으면 null) — 슬라이드 판정
let _curTabActive = "home"; // 리사이즈 재배치용 현재 활성 탭
const _tabIndicMQL = typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

// 인디케이터 지름 = 탭 슬롯의 활성 원(.tab-icon-wrap — 56px, 좁은 폭에서 슬롯이 줄면 그만큼 작다 — DESIGN.md §7).
// 탭 바가 쉬고 있을 때만 잰다: 축소와 그 복귀 중엔 슬롯이 애니메이트되어, 그 폭을 따라가면 펼칠 때
// 작은 원이 커지며 나타난다(CSS 가 「탭 바 폭 / 탭 수」를 따라가던 때 — PR #348 리뷰). 그래서 라우트마다 호출하는
// `syncTabBarActive`는 재지 않고, 처음 로드와 `reposition`(리사이즈, 회전, 축소가 풀릴 때의 max-width `transitionend`, `load`)만 잰다.
function sizeTabIndicator() {
  if (!$tabBar || !$dock) return;
  if ($dock.classList.contains("collapsed")) return;
  const ind = $tabBar.querySelector(".tab-indicator");
  const wrap = $tabBar.querySelector(".tab-item:not([hidden]) .tab-icon-wrap");
  if (!(ind instanceof HTMLElement) || !(wrap instanceof HTMLElement)) return;
  if (!tabIndicatorStyled(ind)) return;
  const d = wrap.offsetWidth;
  if (d > 0) ind.style.width = `${d}px`;   // 0 = 숨은 dock(데스크톱) — CSS 기본 56px 그대로
}

// `style.css`가 적용됐는지 본다(`.tab-indicator`는 `style.css`가 적용돼야 `position:absolute`다).
// Safari(WebKit)는 `defer` 스크립트와 모듈 스크립트를 스타일시트가 오기 전에도 실행한다(Chromium은 기다린다). CSS가
// 없으면 아이콘 SVG가 줄 너비만큼 커져 활성 원을 재면 화면 너비가 나오고, 그 값을 쓰면 화면만 한 원이 리사이즈 전까지
// 탭 바 뒤에 남았다(2026-11-02, pitfalls §41). 그동안은 크기를 재지도 위치를 정하지도 않고, 아래 `load` 이벤트에서 다시 한다.
/** @param {HTMLElement} ind */
function tabIndicatorStyled(ind) {
  return getComputedStyle(ind).position === "absolute";
}

/** @param {string} active */
function positionTabIndicator(active) {
  if (!$tabBar) return;
  const ind = $tabBar.querySelector(".tab-indicator");
  if (!(ind instanceof HTMLElement)) return;
  const activeEl = active && active !== "search"
    ? $tabBar.querySelector(`.tab-item[data-tab="${active}"]:not([aria-disabled="true"])`)
    : null;
  if (!(activeEl instanceof HTMLElement)) {
    ind.classList.remove("is-shown");
    _prevTabIndic = null; // 다음 표시는 스냅(검색 등에서 돌아올 때 stale 위치서 미끄러짐 방지)
    return;
  }
  const apply = () => {
    if (!tabIndicatorStyled(ind)) return;   // CSS 전의 배치로 위치를 정하지 않는다. `load` 이벤트에서 다시 정한다.
    const left = activeEl.offsetLeft + (activeEl.offsetWidth - ind.offsetWidth) / 2;
    const slide = _prevTabIndic !== null && _prevTabIndic !== active && !(_tabIndicMQL && _tabIndicMQL.matches);
    if (slide) {
      ind.style.transform = `translate(${left}px, -50%)`;
    } else {
      // 스냅: transition 잠시 끄고 위치 → reflow 커밋 → 복원(미끄러짐 없이 fade-in).
      const prev = ind.style.transition;
      ind.style.transition = "none";
      ind.style.transform = `translate(${left}px, -50%)`;
      void ind.offsetWidth;
      ind.style.transition = prev;
    }
    ind.classList.add("is-shown");
    _prevTabIndic = active;
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  else apply();
}

// space-between 슬롯 위치는 폭 의존 → 리사이즈/회전 시 재배치(스냅, 디바운스).
// 라우트 변경이 아니므로 syncTabBarActive 가 호출되지 않는다.
if (typeof window !== "undefined" && window.addEventListener) {
  /** @type {ReturnType<typeof setTimeout> | null} */
  let _tabIndicTimer = null;
  const reposition = () => {
    _prevTabIndic = _curTabActive; // 같은 탭 → 슬라이드 없이 스냅
    sizeTabIndicator();
    positionTabIndicator(_curTabActive);
  };
  window.addEventListener("resize", () => {
    if (_tabIndicTimer) clearTimeout(_tabIndicTimer);
    _tabIndicTimer = setTimeout(reposition, 120);
  });
  window.addEventListener("orientationchange", reposition);
  // 스타일시트가 오기 전에 건너뛴 처음 로드의 측정과 배치를 페이지를 다 받은 뒤 다시 한다(`tabIndicatorStyled`).
  // `load` 이벤트는 문서의 스타일시트를 모두 받은 뒤에 일어난다.
  if (document.readyState !== "complete") window.addEventListener("load", reposition, { once: true });
  // 축소 복귀 시 .tab-item max-width가 ~0.25s 동안 애니메이트되므로,
  // syncTabBarActive 의 즉시 rAF 측정은 중간값(좁은 폭)을 읽어 인디케이터가 어긋난다.
  // → max-width transitionend 에서 활성 탭 실측으로 재배치(같은 탭이라 스냅). 한 번의
  // 축소 복귀가 여러 탭의 transitionend를 내지만 모두 같은 활성 탭 스냅이라 무해(저비용).
  if ($tabBar) {
    $tabBar.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "max-width") return;
      const t = e.target;
      if (!(t instanceof HTMLElement) || !t.classList.contains("tab-item")) return;
      reposition();
    });
  }
  // tabbar.js 가 스크롤 축소 해제 후 재배치를 요청할 수 있도록 노출(필요 시).
  window.syncTabIndicator = reposition;
}

// ── ADR-030 개정(가로 dock 오디오): 탭바 실폭을 CSS 변수로 노출 ──
// 가로 모드에서 미니 오디오는 '전체 탭바' 우측에 붙는다(css `#audio-bar` left calc).
// 탭 슬롯은 --dock-control(60px) px 고정이라 폭은 '보이는 탭 수'에만 의존 — 노트 탭이
// hidden 이라 현재 4개(홈·캘린더·북마크·설정 — 캘린더는 ADR-038 A2). 개수를 세어 :root 에
// --tab-bar-w 를 심으면 노트가 켜져 5개가 돼도(다음 로드) 자동으로 left 가 맞는다. 측정이 아니라 개수 기반이라
// 축소(.collapsed로 탭바가 60px로 줄어드는) 상태와 무관하게 항상 풀폭.
function publishTabBarWidth() {
  if (!$tabBar || typeof document === "undefined") return;
  const n = $tabBar.querySelectorAll(".tab-item:not([hidden])").length;
  document.documentElement.style.setProperty(
    "--tab-bar-w",
    `calc(${n} * var(--dock-control))`
  );
}
publishTabBarWidth();
sizeTabIndicator();

// ── 하단 알림의 자리(2026-11-21) ──
// 업데이트 토스트와 스낵바는 #notice-stack 한 열에 쌓인다(app.js, drive-sync.js). 그 열을 화면 아래의 막대(탭 dock,
// 오디오 바, 절 선택과 북마크 선택 바와 그 카운트 칩, 가로의 이어 읽기 알약) 가운데 가장 위의 것보다 위에 둔다. 예전에는
// 토스트가 화면 아래 1rem에 떠 탭 바를 가렸다. 막대의 자리는 화면 방향, 스크롤 축소, 오디오 재생, 선택 모드에 따라
// 여러 가지라, 그 경우를 CSS로 모두 적지 않고 보이는 막대를 잰다.
// ── BEGIN NOTICE ──
const NOTICE_GAP = 8; // --space-2
/**
 * Distance from the viewport bottom to put the notice stack at: just above the highest bottom bar. Boxes in the
 * upper half are not bottom bars (in portrait the resume banner sticks under the header) and empty boxes are hidden.
 * @param {{ top: number, bottom: number, height: number }[]} rects
 * @param {number} viewportH
 * @returns {number | null} px, or null when no bar is down there (CSS keeps its 1rem default)
 */
function noticeBottom(rects, viewportH) {
  let top = Infinity;
  for (const r of rects) {
    if (r.height <= 0 || r.bottom <= viewportH / 2) continue;
    top = Math.min(top, r.top);
  }
  return top === Infinity ? null : Math.round(viewportH - top) + NOTICE_GAP;
}
// ── END NOTICE ──

const $notices = document.getElementById("notice-stack");
const BOTTOM_BARS = "#tab-dock, #audio-bar, #verse-select-bar, #verse-select-count, #bm-select-bar, #bm-select-count, .resume-banner";
let _noticeFrame = 0;
function placeNotices() {
  if (!$notices || _noticeFrame) return;
  _noticeFrame = requestAnimationFrame(() => {
    _noticeFrame = 0;
    if (!$notices.childElementCount) return;
    const rects = [...document.querySelectorAll(BOTTOM_BARS)].map((e) => e.getBoundingClientRect());
    const px = noticeBottom(rects, window.innerHeight);
    if (px === null) $notices.style.removeProperty("--notice-bottom");
    else $notices.style.setProperty("--notice-bottom", `${px}px`);
  });
}
if ($notices) {
  // The bars move when the body's mode classes (tabbar-collapsed, verse-select-active, bm-select-active) or a bar's
  // `hidden` change, and slide there by transition or animation, so measure again when one ends. Only while a notice
  // is up.
  const barWatch = new MutationObserver(placeNotices);
  const onMove = () => placeNotices();
  const watch = () => {
    if ($notices.childElementCount) {
      placeNotices();
      barWatch.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });
      window.addEventListener("resize", onMove);
      document.addEventListener("transitionend", onMove);
      document.addEventListener("animationend", onMove);
    } else {
      barWatch.disconnect();
      window.removeEventListener("resize", onMove);
      document.removeEventListener("transitionend", onMove);
      document.removeEventListener("animationend", onMove);
    }
  };
  new MutationObserver(watch).observe($notices, { childList: true });
  watch(); // a snackbar drive-sync.js showed before this module ran
}

// route() (views) calls this on each navigation (facade, see cycle note).
W.syncTabBarActive = syncTabBarActive;
export {};
