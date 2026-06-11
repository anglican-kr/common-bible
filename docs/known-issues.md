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

### 1c. `test_bookmark_folders.py` — 폴더 토글 2건 (2026-06-11 확인)

- `test_folder_toggle_expand_collapse` / `test_folder_expanded_state_persists`: **데스크탑 드로어**에서 `.bm-folder-row` 클릭 후 `aria-expanded` 가 `false` 에 머묾(펼침 토글이 안 일어남) → `assert ... == "true"` 실패.
- **회귀 아님 확인**: bookmark-select 분리(ADR-034 후속) 작업 중 발견했으나, 변경분을 stash 하고 `release/1.6.4` base 로 돌려도 동일하게 2건 실패. 같은 헤더의 모바일 select e2e(`test_bookmark_select_delete.py` 26건)는 전부 통과.
- **추정 원인**: headless chromium 에서 `.bm-folder-row` 의 click 이 폴더 토글로 이어지지 않음 — `_setupDragHandle` 의 pointerdown 리스너와 합성 click 의 간섭, 또는 클릭 타깃이 토글 분기를 안 타는 문제로 추정.
- **대응 후보**: (1) 실제 브라우저에서 데스크탑 드로어 폴더 펼침이 정상인지 먼저 확인 → 정상이면 테스트의 click 방식(좌표/대상 엘리먼트) 보강, 비정상이면 토글 핸들러(`_buildFolderItem` click → `_toggleFolder`) 결함 수정. (2) headless 포인터 간섭이면 `dispatch_event('click')` 등으로 우회.

> 참고: 통과하는 e2e(내비·오디오·검색·북마크·설치 안내·a11y 등 다수)는 정상. 위 세 묶음만 환경 의존으로 실패.

---

## 2. ADR-034 남은 작업

상세는 [`docs/decisions/034-views-routing-second-split.md`](decisions/034-views-routing-second-split.md).

- **PR5b `closeAllOverlays` ✅ 완료** — `route()` 의 14개 오버레이 teardown(12 `closeIfOpen` + settings/chapter popover)을 `overlay.js` 의 `closeAllOverlays()` 하나로 축약. createOverlay가 모든 인스턴스를 registry에 등록, closeAllOverlays가 열린 것만 close + detached panel prune. routing→6개 모듈 close fn 하드코딩 의존 제거.
- **PR5c `registerView` dispatch 역전 (보류 — 상세 §2.1)** — 단독 PR로는 보류, Phase 2 라우트 추가 또는 설정 화면 재구성에 얹어서.
- ~~audio `applyAudioShow` → `window.parsePath` facade edge~~ **조사 완료 → 현 설계 유지 (§2.2)** — 없애려던 항목이나 검토 결과 facade가 정답(명시 import는 사이클, readingContext는 stale, state-machine 호출자는 컨텍스트 못 줌). 조치 없음.
- **`bookmark.js` 분할 (진행 중)** — 3,578줄에서 모듈별로 점진 분리. 완료: 순수 로직 `bookmark-core.js`(query/href/sort/active) · 절 스펙 `verse-spec.js` · 모달 `bookmark-modals.js` · 폴더 모아 읽기 `bookmark-read.js` · 제스처 엔진 `bookmark-gestures.js`(드래그 reorder + 스와이프 액션 + 포인터 핸들러) · 선택 삭제 모드 `bookmark-select.js`(상태 + 캐스케이드 수학 + 삭제·공유·이동 액션 + #bm-select-bar dock — 트리렌더↔select 양방향은 import(상태/핸들러)+주입(재렌더/헤더)으로 차단) · **절 선택 모드 `bookmark-verse-select.js`(in-reading 절 선택 → 북마크/복사 + #verse-select-bar dock, ADR-034 후속, 이번 라운드 — near-leaf라 DI 불필요)**. 남은 라운드: 트리 렌더링·⋯ 메뉴. 본체는 분리 후 드로어 오케스트레이터로 수렴.

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

### 2.2 audio `applyAudioShow` → `window.parsePath` (2026-06-08 검토 → 현 설계 유지)

`applyAudioShow`(오디오 설정 라이브 토글)가 현재 라우트를 알려고 `window.parsePath()`를 facade로 호출하는 부분. PR1 이후 "audio→routing 임시 edge"로 적어뒀으나, 검토 결과 **그대로 두는 게 맞다.** 억지로 없애면 셋 중 하나를 감수해야 함:

1. **명시 import → import 사이클.** 의존이 `routing → views-routing → audio-player` 인데, audio-player가 `import { parsePath } from "./routing.js"` 하면 `routing → views-routing → audio-player → routing` 3-모듈 순환. 현 `window.parsePath` facade가 바로 이 사이클을 피하는 장치.
2. **`readingContext`는 stale.** `readingContext.bookId/chapter`는 `renderChapter`에서만 set되고 non-chapter 뷰에서 null 리셋이 없음("마지막 본 장" ≠ "현재 장"). 뷰 무관하게 불리는 `applyAudioShow`가 홈에서 stale 장으로 오작동. 쓰려면 모든 non-chapter 리셋 + prologue=0 set 추가 → bookmark `!readingContext.chapter` 등 다운스트림 리스크.
3. **호출자가 컨텍스트를 못 준다.** `state-machine.js`가 synced `audioShow` 값을 적용할 때(동기화 레이어) 라우트 컨텍스트가 없어 인자로 못 넘김 → 내부에서 현재 뷰를 다시 알아내야 함(=parsePath).

`parsePath`는 route()/navigate() 같은 오케스트레이션이 아니라 **순수 URL 파싱 유틸**이라, audio가 facade로 읽는 건 양성(benign) 의존. **조치 없음.**
