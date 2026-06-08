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

- **PR5b `closeAllOverlays` ✅ 완료** — `route()` 의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `overlay.js` 의 `closeAllOverlays()` 하나로 축약. createOverlay가 모든 인스턴스를 registry에 등록, closeAllOverlays가 열린 것만 close + detached panel prune. routing→6개 모듈 close fn 하드코딩 의존 제거.
- **PR5c `registerView` dispatch 역전 (보류 — 상세 §2.1)** — 단독 PR로는 보류, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서.
- **audio `applyAudioShow` → `window.parsePath` facade edge** — PR1에서 들어온 임시 facade가 PR5a 이후에도 잔존. `parsePath` 가 division 로직·books 에 얽혀 "하위 모듈로 내리기"가 깔끔하지 않음. 더 나은 해법: `applyAudioShow` 가 현재 라우트 컨텍스트(view/bookId/chapter)를 **인자로 받게** 바꿔 audio→routing 의존 자체를 제거(호출측 settings-ui·state-machine 동반).
- **`bookmark.js` (3,578줄) 분할** — 순수 로직(`bookmark-core.js`) / UI(`bookmark-ui.js`) 두 층으로 분리하는 후속 라운드.

### 2.1 PR5c — `registerView` dispatch 역전 트레이드오프 (2026-06-08 검토)

결론: **단독 투기성 PR로는 하지 말고, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서 진행.**

**전제 (실측)**
- PR5a 이후 routing.js는 search/bookmark/settings를 ESM import하지 않고 `window` facade로 호출 → **구조적 import 사이클은 이미 없다.** registerView가 고칠 구조적 문제(순환 import·로드 순서·tsc 에러)는 없고, 남은 건 전역 네임스페이스 경유의 *논리적* 결합뿐.
- routing→타모듈 호출 9개 = 뷰 렌더러 3~4(`renderSearchResults`·`renderSearchView`·`renderBookmarksView`·`renderSettingsView`) + 오케스트레이션 헬퍼 5(`consumeSearchAutoNavigate`·`isMobile`·`openBookmarkDrawer`·`exitVerseSelectMode`·`exitBookmarkSelectMode`). registry는 렌더러만 대상; 헬퍼·분기 로직은 잔존.
- 역방향: **search→routing 21회**, bookmark 5, settings 3 — 결과 클릭→`navigate()`, 재렌더→`route()`, 가드→`parsePath`/`routeSeq`처럼 본질적.

**핵심 반론 — registerView는 사이클을 못 끊는다.** routing→search 한 방향만 뒤집을 뿐, search→routing 21회는 검색의 본질(결과가 라우팅을 일으킴)이라 잔존. "순환 끊기" 명분이 성립 안 함.

**두 변형**
- **얕은** (`window.renderXView()` → `registry[view]()` 치환): 비용 낮음 / 효용 거의 0 (facade→registry lookup뿐; 헬퍼·분기·역방향 그대로). → **하지 말 것.**
- **깊은** (각 뷰 모듈이 route 핸들러 전체 등록, route는 `await registry[view](parsed, ctx)`): 비용 큼 — 검색 분기(query/빈쿼리/autoNav/filter/desktop·mobile + `_routeSeq` 가드 + recordPath) 이관 + 공유 `context` 객체 설계 + bible 코어 뷰 처리 + meta/launch/analytics 분산. 위험 높음(중앙 오케스트레이션 분산 → 일관성·검색 auto-nav 흐름 취약). 효용 = **로드맵 확장성**(Phase 2~4 새 라우트가 self-register → route() 불변), 단 미래 뷰가 단순 핸들러일 때만 큼. 현재 뷰는 안 단순 → 지금 3표본으로 추상화 확정은 YAGNI.

**권고 (언제·어떻게)**
1. 얕은 registry 금지(효용 없음).
2. 깊은 registry 단독 PR 보류(현 3뷰엔 premature, 위험>효용).
3. **트리거에 묶기**: (a) **Phase 2(기도서) 라우트 추가 시** — 4번째 뷰가 추상화를 정당화하는 자연 트리거; (b) **설정 화면 재구성 시** — settings 분기가 어차피 바뀌니 그 PR에서 settings를 registry 핸들러로 점진 도입.
4. **0-위험 사전 작업(지금 가능, registerView와 무관)**: route() 각 분기의 `dismissLaunchScreen()`·`updatePageMeta()`·`trackPageView()` 보일러플레이트를 route() 내부 finalize 헬퍼로 추출(각 분기는 `{title, description}`만 반환). 모듈 경계 불변 = 0 위험, 깊은 registry의 context 설계 토대.
