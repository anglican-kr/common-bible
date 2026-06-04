// @ts-check
// ADR-030 P2 — 탭 바 검색 모핑 + 하단 입력 검색 + visualViewport 키보드 처리.
//
// 검색 원형 버튼을 누르면: 비-홈 탭이 접히고(홈만 남음) 검색 dock 이 입력창으로
// 확장된다. 입력은 하단에서 직접 검색하며, 모바일 키보드 위로 dock 을 띄운다
// (visualViewport). 홈 탭을 누르면 default 로 복구(라우트 변경 → exitSearch).
//
// 검색 결과 렌더링은 기존 검색 파이프라인 재사용: Enter → window.commitTopSearch
// → /search?q= → renderSearchResults. /search 전체뷰의 상단 입력은 모핑 중
// body.tabbar-searching 으로 숨긴다(하단 입력이 단일 검색 필드).

const $dock = document.getElementById("tab-dock");
const $searchBtn = document.getElementById("tab-search");
const $searchInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById("tab-search-input")
);
const $searchClear = document.getElementById("tab-search-clear");
const $searchClose = document.getElementById("tab-search-close");

/** @type {Window & typeof globalThis & Record<string, any>} */
const W = /** @type {any} */ (window);

let searching = false;

// 입력 pill 안 검색어 지우기(⊗)는 텍스트가 있을 때만.
function syncClearBtn() {
  if ($searchClear) $searchClear.hidden = !$searchInput?.value.trim();
}

// ── visualViewport: 키보드가 가리지 않게 dock 을 키보드 높이만큼 위로 ──
function liftForKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !$dock) return;
  // 키보드 높이 = 레이아웃 뷰포트 − 비주얼 뷰포트 높이. search.js 의 시트 보정과
  // 동일하게 vv.offsetTop 은 의도적으로 무시 — offsetTop 은 핀치줌 팬 등 in-page
  // 스크롤 양이라 position:fixed 요소(레이아웃 뷰포트 기준)를 잘못 밀 수 있다.
  const overlap = Math.max(0, window.innerHeight - vv.height);
  $dock.style.transform = overlap > 1 ? `translateY(${-overlap}px)` : "";
}
function attachKeyboardTracking() {
  const vv = window.visualViewport;
  if (!vv) return;
  vv.addEventListener("resize", liftForKeyboard);
  vv.addEventListener("scroll", liftForKeyboard);
  liftForKeyboard();
}
function detachKeyboardTracking() {
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener("resize", liftForKeyboard);
    vv.removeEventListener("scroll", liftForKeyboard);
  }
  if ($dock) $dock.style.transform = "";
}

// dock 입력을 현재 URL 의 ?q= 로 맞춘다(in-page bar 가 숨겨져 dock 입력이 단일
// 필드이므로). 사용자가 입력 중(포커스)일 땐 덮어쓰지 않는다.
function syncInputFromUrl() {
  if (!$searchInput || document.activeElement === $searchInput) return;
  $searchInput.value = new URLSearchParams(location.search).get("q") || "";
  syncClearBtn();
}

// ── 진입/복구 ──
function openSearch() {
  if (!$dock || !$searchInput) return;
  if (searching) {
    $searchInput.focus();
    return;
  }
  searching = true;
  $dock.classList.add("searching");
  document.body.classList.add("tabbar-searching");
  $searchBtn?.setAttribute("aria-expanded", "true");
  // 닫기(X) 버튼은 검색 중에만 접근 가능(idle 엔 collapsed → a11y 트리 제외).
  $searchClose?.removeAttribute("aria-hidden");
  $searchClose?.removeAttribute("tabindex");
  $searchInput.hidden = false;
  // /search 전체뷰로 진입(이미 검색 중이면 생략). route() → syncTabBarActive 가
  // active==='search' 를 보고 exitSearch 를 호출하지 않는다.
  if (W.parsePath?.().view !== "search") W.navigate("/search");
  // 모핑을 열면 in-page bar 가 숨겨지므로 그 입력값을 dock 입력으로 옮긴다. in-page
  // 입력은 URL ?q= 로 초기화되고 사용자가 미제출(Enter 안 누름)로 고친 draft 까지
  // 담으므로 우선 사용 — 없으면 URL ?q= 로 폴백(draft 가 사라지지 않게).
  const $inpage = document.getElementById("search-inpage-input");
  $searchInput.value = $inpage instanceof HTMLInputElement
    ? $inpage.value
    : (new URLSearchParams(location.search).get("q") || "");
  syncClearBtn();
  requestAnimationFrame(() => $searchInput?.focus());
  attachKeyboardTracking();
}

// 라우트가 검색에서 벗어나면(홈 탭 등) 호출 — 모핑 복구. navigate 는 하지 않는다
// (라우트 변경이 이미 일어난 뒤 호출되므로).
function exitSearch() {
  if (!$dock || !searching) return;
  searching = false;
  $dock.classList.remove("searching");
  document.body.classList.remove("tabbar-searching");
  $searchBtn?.setAttribute("aria-expanded", "false");
  $searchClose?.setAttribute("aria-hidden", "true");
  $searchClose?.setAttribute("tabindex", "-1");
  if ($searchInput) {
    $searchInput.value = "";
    $searchInput.blur();
    $searchInput.hidden = true;
  }
  syncClearBtn();
  detachKeyboardTracking();
}

// 뷰포트가 데스크탑(≥769px)으로 넘어가면 dock 이 CSS 로 숨겨지므로, 모핑 상태
// (searching·body.tabbar-searching·키보드 추적)를 정리한다. /search 뷰는 모바일
// 레이아웃(search-view + in-page 입력)으로 그려져 있으므로 route() 를 다시 태워
// 데스크탑 레이아웃(헤더 검색바 + #app 직접 결과)으로 재렌더한다.
window.matchMedia("(min-width: 769px)").addEventListener("change", (e) => {
  if (!e.matches || !searching) return;
  exitSearch();
  if (W.parsePath?.().view === "search") W.route?.();
});

// 검색 모드 전체 닫기 → 홈으로 복귀(route() 가 exitSearch 호출). 포커스가 body 로
// 흘러가지 않게 다시 펼쳐진 검색 버튼으로 되돌린다(키보드 접근성).
function closeSearchToHome() {
  W.navigate("/");
  $searchBtn?.focus();
}

// 검색 원형 버튼 → 모핑 진입(P1 의 단순 navigate 대체).
$searchBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  openSearch();
});

// 하단 입력: Enter → 기존 검색 커밋(verse ref auto-nav 포함).
$searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    W.commitTopSearch?.($searchInput.value);
    // 검색 실행 → "이전 모드로 롤백": 키보드를 내려 dock 을 키보드 위 모핑(stage 2)에서
    // 접지(grounded) 상태로 복귀. 검색 세션·닫기(X)는 유지(결과 화면, screenshot 2).
    $searchInput.blur();
  }
});

// Esc 처리는 app.js 전역 핸들러가 우선순위(검색 시트 > 팝오버 > 탭 검색)대로 호출.
// 검색 중이면 닫고 true, 아니면 false 를 돌려 app.js 가 다음 레이어로 넘어가게 한다.
// (capture+stopPropagation 으로 가로채던 방식은 레이어링·aria 충돌을 일으켜 폐기.)
W.closeTabSearch = () => {
  if (!searching) return false;
  closeSearchToHome();
  return true;
};

// 입력 변화 → ⊗ 지우기 버튼 표시 토글.
$searchInput?.addEventListener("input", syncClearBtn);

// ⊗ 지우기 — 검색어만 비우고 입력 유지(포커스·키보드 유지). 결과 화면이면 빈
// 검색 뷰로 되돌려 기본 안내(빈 상태)를 보인다.
$searchClear?.addEventListener("click", () => {
  if (!$searchInput) return;
  $searchInput.value = "";
  syncClearBtn();
  if (W.parsePath?.().view === "search") W.navigate("/search");
  $searchInput.focus();
});

// 검색 닫기(X) — 검색 세션 전체 롤백 → 기본 탭 바. navigate 가 route →
// syncTabBarActive → exitTabSearch 를 태운다.
$searchClose?.addEventListener("click", () => {
  closeSearchToHome();
});

// views-routing 의 syncTabBarActive 가 라우트 변경 시 호출(검색 외 라우트면 복구).
W.exitTabSearch = exitSearch;
// 검색 라우트가 바뀌면(뒤로/앞으로 등) dock 입력을 URL 쿼리에 동기화 — 모핑 중일
// 때만(searching) 의미. route() 의 syncTabBarActive 가 매 라우트마다 호출.
W.syncTabSearchQuery = () => { if (searching) syncInputFromUrl(); };

export {};
