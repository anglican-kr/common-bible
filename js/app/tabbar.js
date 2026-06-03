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

/** @type {Window & typeof globalThis & Record<string, any>} */
const W = /** @type {any} */ (window);

let searching = false;

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
  $searchInput.hidden = false;
  // /search 전체뷰로 진입(이미 검색 중이면 생략). route() → syncTabBarActive 가
  // active==='search' 를 보고 exitSearch 를 호출하지 않는다.
  if (W.parsePath?.().view !== "search") W.navigate("/search");
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
  if ($searchInput) {
    $searchInput.value = "";
    $searchInput.blur();
    $searchInput.hidden = true;
  }
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
  } else if (e.key === "Escape") {
    e.preventDefault();
    W.navigate("/");
  }
});

// views-routing 의 syncTabBarActive 가 라우트 변경 시 호출(검색 외 라우트면 복구).
W.exitTabSearch = exitSearch;

export {};
