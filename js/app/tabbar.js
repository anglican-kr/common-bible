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

// ── BEGIN KEYBOARD ── (tests/unit/tabbar.test.js 가 이 블록을 슬라이스해 검증)

// 키보드 높이(키보드가 가린 px) = 레이아웃 뷰포트 − 비주얼 뷰포트 높이. search.js
// 의 시트 보정과 동일하게 vv.offsetTop 은 의도적으로 무시 — offsetTop 은 핀치줌
// 팬 등 in-page 스크롤 양이라 position:fixed 요소(레이아웃 뷰포트 기준)를 잘못 민다.
function keyboardOverlap(innerHeight, vvHeight) {
  return Math.max(0, innerHeight - vvHeight);
}

// 키보드가 떠 있는 동안에만 닫기(X) 버튼을 노출 + body 상태 클래스 토글.
// X 는 홈 버튼과 동작이 겹치므로(둘 다 탭바 복구→홈) 키보드가 없을 땐 숨긴다.
function setKeyboardState(up) {
  document.body.classList.toggle("tabbar-keyboard", up);
  if (!$searchClose) return;
  // 키보드 없을 땐 a11y 트리에서도 제외(시각적으로도 collapse).
  if (up) {
    $searchClose.removeAttribute("aria-hidden");
    $searchClose.removeAttribute("tabindex");
  } else {
    $searchClose.setAttribute("aria-hidden", "true");
    $searchClose.setAttribute("tabindex", "-1");
  }
}

// ── visualViewport: 키보드가 가리지 않게 dock 을 키보드 높이만큼 위로 ──
function liftForKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !$dock) return;
  const overlap = keyboardOverlap(window.innerHeight, vv.height);
  // 1px 미만은 반올림 오차 — 키보드 없음으로 본다.
  const up = overlap > 1;
  // transform 대신 실제 레이아웃 위치(bottom)로 올린다. transform 은 레이아웃
  // 사각형을 그대로 두므로 iOS 가 포커스 입력이 키보드에 가려졌다고 보고 페이지
  // 전체를 위로 팬(헤더·빈 상태가 화면 밖으로 밀림)한다. 입력의 실제 사각형을
  // 키보드 위로 올리면 iOS 가 팬할 이유가 없어져 sticky 헤더·본문이 제자리에 남는다.
  $dock.style.setProperty("--kb-overlap", up ? `${overlap}px` : "0px");
  setKeyboardState(up);
}
// ── END KEYBOARD ──
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
  if ($dock) $dock.style.setProperty("--kb-overlap", "0px");
  setKeyboardState(false);
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
  // 닫기(X) 버튼 노출은 키보드 등장에 묶는다(setKeyboardState). 키보드가 없는
  // 동안엔 홈 버튼과 동작이 겹쳐 중복이므로 숨겨 둔다.
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
    // 검색 실행 → 키보드를 내려 dock 을 키보드 위 모핑(stage 2)에서 접지(grounded)
    // 상태로 복귀. 검색 세션은 유지(결과 화면). 키보드가 내려가므로 닫기(X)는 접힌다
    // (X 는 키보드 표시 중에만 노출 — 결과 화면에선 홈 버튼으로 종료).
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

// 닫기(X) — 키보드가 떠 있을 때만 보이며(setKeyboardState), 키보드만 내린다.
// 검색 세션·입력값·결과는 유지(grounded dock) → 결과를 스크롤해 둘러볼 수 있다.
// blur 로 키보드가 내려가면 visualViewport resize → setKeyboardState(false) 가
// X 를 접고 body.tabbar-keyboard 를 푼다. 다시 입력을 탭하면 키보드·X 가 복귀.
// 검색 종료(→홈)는 홈 버튼 담당(X 와 역할 분리).
$searchClose?.addEventListener("click", () => {
  $searchInput?.blur();
});

// views-routing 의 syncTabBarActive 가 라우트 변경 시 호출(검색 외 라우트면 복구).
W.exitTabSearch = exitSearch;
// 검색 라우트가 바뀌면(뒤로/앞으로 등) dock 입력을 URL 쿼리에 동기화 — 모핑 중일
// 때만(searching) 의미. route() 의 syncTabBarActive 가 매 라우트마다 호출.
W.syncTabSearchQuery = () => { if (searching) syncInputFromUrl(); };

export {};
