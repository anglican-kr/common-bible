# 알려진 이슈 / 후속 과제

ADR-034(뷰·라우팅 2차 분할) 작업 중 발견·확인한 항목 모음. "나중에 대응" 대상.
최초 작성 2026-06-08.

---

## 1. 사전 존재 e2e 실패 (headless · main에도 동일 — 회귀 아님)

ADR-034 분할 PR 검증 중 baseline(main) 비교로 **분할 이전에도 동일하게 실패**함을 확인했다. 코드 회귀가 아니라 헤드리스 환경/테스트 견고성 문제로 추정. e2e는 CI 미실행(로컬 전용)이라 그동안 드러나지 않았다.

### 1a. `test_tabbar.py` — 모핑 검색 (~7–8건)

- **증상**: `#search-input` 이 `aria-expanded="false"` hidden 상태로 남아 `wait_for_selector(visible)` 30s 타임아웃(65× 폴링).
- **영향 케이스**: `test_tab_bar_present_and_search_separated`, `test_home_tab_active_on_root`, `test_bookmarks_tab_navigates_and_renders_view`, `test_settings_tab_navigates_and_renders_view`, `test_search_button_morphs_to_input`, `test_home_tab_returns_to_root`, `test_book_list_does_not_collapse_on_scroll` (± `test_scroll_collapse_and_home_expands_without_nav` — 실행마다 통과/실패 갈리는 플래키).
- **추정 원인**: ADR-030 검색 원형 버튼 → 입력 pill 모핑이 headless chromium에서 펼쳐지지 않음(CSS transition/focus 타이밍 또는 visualViewport 처리).
- **대응 후보**: 테스트가 모핑 완료(클래스/속성 변화)를 명시적으로 기다리도록 보강, 또는 실기기/헤드풀로 실제 모핑 동작 확인 후 테스트 갱신.

### 1b. `test_settings.py` — 3건

- `test_book_order_vulgate` / `test_book_order_canonical`: `.settings-popover` 의 "외경" switch `is_checked` 30s 타임아웃 — 설정 팝오버 토글 렌더/표시 타이밍.
- `test_cache_clear_removes_caches`: `clearAllCaches()` → `location.reload()` 후 `expect_navigation('load')` 타임아웃 — reload navigation 미완료.
- **대응 후보**: 팝오버 가시화·리로드 완료 대기 조건 보강, 또는 실제 동작 확인.

> 참고: 통과하는 e2e(내비·오디오·검색·북마크·설치 안내·a11y 등 다수)는 정상. 위 두 묶음만 환경 의존으로 실패.

---

## 2. ADR-034 남은 작업

상세는 [`docs/decisions/034-views-routing-second-split.md`](decisions/034-views-routing-second-split.md).

- **PR5b (미착수, high-risk)** — `route()` → 외부 뷰 dispatch(search/bookmark/settings 렌더러)를 `registerView` registry로 **역전**해 순환을 끊고, `route()` 의 12개 `closeX` 모달 클로저 호출을 ADR-032 오버레이의 `closeAllOverlays()` 하나로 축약. search/bookmark/settings 동반 수정이라 위험도 높음.
- **audio `applyAudioShow` → `window.parsePath` facade edge** — PR1에서 들어온 임시 facade가 PR5a 이후에도 잔존. `parsePath` 가 division 로직·books 에 얽혀 "하위 모듈로 내리기"가 깔끔하지 않음. 더 나은 해법: `applyAudioShow` 가 현재 라우트 컨텍스트(view/bookId/chapter)를 **인자로 받게** 바꿔 audio→routing 의존 자체를 제거(호출측 settings-ui·state-machine 동반).
- **`bookmark.js` (3,578줄) 분할** — 순수 로직(`bookmark-core.js`) / UI(`bookmark-ui.js`) 두 층으로 분리하는 후속 라운드.

---

## 3. 환경 / 도구

- **git commit 서명** — 이 저장소는 1Password SSH 서명을 쓰는데 headless 세션에서 잠금 해제가 안 돼 `error: 1Password: failed to fill whole buffer` 로 실패. ADR-034 PR(#221·#222·#223·#224·#225)은 `--no-gpg-sign` **미서명 커밋**. 필요 시 머지 전 재서명. 현재 브랜치 보호는 서명 미요구라 머지엔 지장 없음.
- **`conftest.py` base_url 하드코딩** — `tests/e2e/conftest.py` 의 `base_url` fixture가 `http://localhost:8080` 고정이라 pytest `--base-url` 플래그가 무시됨. 다른 포트로 e2e 돌리려면 conftest 수정 필요. (serve.py 는 repo 루트를 no-cache 라이브 서빙.)
