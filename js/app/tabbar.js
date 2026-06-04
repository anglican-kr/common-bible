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
  // 레이아웃 뷰포트와 비주얼 뷰포트(키보드로 줄어든) 하단 차이 = 키보드 높이.
  const overlap = Math.max(
    0,
    document.documentElement.clientHeight - (vv.height + vv.offsetTop)
  );
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

// 검색 원형 버튼 → 모핑 진입(P1 의 단순 navigate 대체).
$searchBtn?.addEventListener("click", (e) => {
  e.preventDefault();
  openSearch();
});

// 하단 입력: Enter → 기존 검색 커밋(verse ref auto-nav 포함), Esc → 복구+홈.
$searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    W.commitTopSearch?.($searchInput.value);
    // 검색 실행 → "이전 모드로 롤백": 키보드를 내려 dock 을 키보드 위 모핑(stage 2)에서
    // 접지(grounded) 상태로 복귀. 검색 세션·닫기(X)는 유지(결과 화면, screenshot 2).
    $searchInput.blur();
  } else if (e.key === "Escape") {
    e.preventDefault();
    // 홈으로 복귀 → route() 가 exitSearch 를 호출(입력 hidden). 포커스가 body 로
    // 흘러가지 않게 다시 펼쳐진 검색 버튼으로 되돌린다(키보드 접근성).
    W.navigate("/");
    $searchBtn?.focus();
  }
});

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
  W.navigate("/");
});

// views-routing 의 syncTabBarActive 가 라우트 변경 시 호출(검색 외 라우트면 복구).
W.exitTabSearch = exitSearch;

export {};
