# ADR-029: 적응형 내비게이션 Phase 1 — 모바일 하단 탭 바

- 일시: 2026-06-03
- 상태: 승인됨 — 구현 완료(모바일, 2026-06-03). 데스크탑 사이드바는 후속.
- 관련 ADR: ADR-028(디자인 시스템 §7 적응형 내비 — 본 ADR 이 그 구현), ADR-024(헤더 내비), ADR-025(헤더 elevation·frosted glass 규칙), ADR-011(북마크), ADR-005(검색)
- 권위 문서: 루트 [`DESIGN.md`](../../DESIGN.md) §7

> **개정 (2026-06-04, [ADR-030](030-morphing-tab-bar.md)):** Apple Music 벤치마크로 §1(검색=4탭 중 하나)을 **분리된 검색 원형 버튼 → 입력 모핑**으로, §3(frosted glass 를 `::before` 레이어에)을 **요소에 직접**으로 개정. 스크롤 축소(미채택)도 ADR-030 에서 채택(후속 구현). 모바일 검색 바텀 시트는 ADR-030 에서 제거.

## 맥락

내비게이션 진입점이 제각기 다르게 구현돼 있었다 — 홈(헤더 `buildHomeBtn` 라우트), 검색(모바일 `#search-fab`→시트 / 데스크탑 인라인 바+`/search`), 북마크(`.title-bookmark-btn`→드로어), 설정(`.title-settings-btn`→팝오버). ADR-028 §7 은 이를 HIG 적응형 내비(모바일 하단 탭 바 / 데스크탑 사이드바)로 통합하기로 "결정 — 구현 대기"였다. 본 ADR 이 그 **모바일 1단계**를 구현한다.

## 결정

### 1. 모바일(≤768px) 하단 탭 바 — 4탭, 노트 후속

좌→우 **홈·검색·북마크·설정** 4탭. `노트`(신규 기능)는 후속 슬롯으로 레이아웃만 예약(flex 균등 분배라 5번째 자동 수용). 데스크탑(≥769px)은 탭 바 미표시 — 기존 헤더/오버레이 유지. 데스크탑 사이드바는 별도 단계(아래 §6).

### 2. 모델 — 각 탭 = 전체화면 라우트 뷰

오버레이 트리거가 아니라 **각 탭이 전체화면 뷰**다(진짜 iOS 탭바 의미론 + 앱의 History API 라우팅과 정합). 흩어진 구현을 성격대로 재배치:

- **홈** → `/`·`/<division>` 책 목록(기존 `renderBookList`).
- **검색** → 모바일 `/search` 전체화면(인페이지 입력 + `renderSearchResults`). 시트는 모바일 탭 경로에서 은퇴(헤더 입력 포커스 경로로는 잔존).
- **북마크** → 신규 `/bookmarks` 전체화면(`renderBookmarksView`). `renderBookmarkTree(target)` 인자화로 드로어 트리 빌더를 #app 에 재사용. **읽기-문맥 액션(이 장 저장·절 선택)은 가져오지 않음** — 읽기 화면(드로어)에 남긴다. 전역 관리(새 폴더·내보내기·가져오기)만 탭 뷰 헤더 우상단에 배치.
  > **개정 (2026-06-05):** 헤더 어포던스를 Apple Music 패턴으로 단일화 — 별도 "+" 버튼을 없애고 **"⋯"(더 보기) 한 개**로 통일, 전역 관리 3종(새 폴더·내보내기·가져오기)을 모두 그 팝업 메뉴 안에 넣었다(`buildBmViewActions`). 메뉴는 **iOS 26 풍 큰 곡률**(`--radius-xl` 16px + `corner-shape: superellipse(2)` squircle)·full-bleed 행·**그룹 사이 hairline 1줄만**(항목 사이 가로선 제거)·행마다 **선행 라벨 + 후행 SF 스타일 글리프**(folder.badge.plus / square.and.arrow.up·down)·리퀴드 글라스 sheen/inset 질감(ADR-030 후속⁵ 공유)·`--shadow-4` elevation·`reduced-transparency`/`reduced-motion` 폴백을 갖춘 HIG 메뉴. 각 행 `min-height: --touch-target`(44px). 함께 **북마크 목록 행 여백 확대**(데스크탑 `padding --space-3/--space-4`·`min-height 4rem`, 모바일 콘텐츠 `min-height 3.5rem`, 라벨 `--font-sm→--font-md`·참조 `--font-2xs→--font-xs`·아이콘 1.4→1.6rem)로 스캔·탭 여유 확보.
  > **개정 (2026-06-06) — 북마크 정렬:** ⋯ 메뉴에 **정렬 그룹**(`role="group"`)을 추가 — **제목·직접 정렬(수동)·추가된 날짜·최근에 본 날짜·수정한 날짜** 5개 `menuitemradio`(현재 선택에 선행 체크 글리프, Apple Music 정렬 그룹 패턴). 메뉴 순서는 **액션 그룹(새 폴더·내보내기·가져오기) → hairline 1줄 → 정렬 그룹**(위에서 아래). 정렬은 **표시 전용**(`sortBookmarkNodes` 가 store 를 건드리지 않고 셸로 카피 반환) — `renderBookmarkTree`·`_buildFolderItem` 가 렌더 직전 적용. **`manual` 은 저장 순서(드래그) 보존, 나머지는 폴더 먼저·각 그룹을 키로 정렬**(제목=ko 로케일, 날짜=최신순). **정렬 설정은 기기별 `localStorage`(`bible-bookmark-sort`)** — Drive 동기화 제외(ADR-011 은 북마크 객체만 동기화). **"최근에 본 날짜"도 기기별 `localStorage` 맵(`bible-bookmark-viewed`)** — 동기화 객체에 두면 "열기만 해도" 재동기화·수정시각 오염되므로 분리(북마크 링크 클릭 시 `markBookmarkViewed`, 삭제 시 `_forgetViewed`). **"수정한 날짜"는 동기화 객체에 `updatedAt`**(북마크/폴더 편집·이름변경 시 기록, 없으면 `createdAt` 폴백; 폴더 생성에 `createdAt` 추가). 자동 정렬 모드에서는 드롭이 재정렬돼 무의미하므로 **드래그 핸들 비활성**(`manual` 일 때만 `_setupDragHandle`). 순수 정렬 로직은 유닛(`BOOKMARK_SORT` 블록, `bookmark.test.js` 14 케이스), 메뉴 상호작용·재렌더는 e2e 책임.
  > **개정 (2026-06-06) — 추가 아이콘 + 빈 상태:** 읽기 헤더 북마크 버튼은 **미저장 장에서 아웃라인 책갈피 + 가운데 "+" 배지**(2-path 합성 `BOOKMARK_ICON_ADD_PLUS`)로 '이 장 추가' 어포던스를 명확히 하고, **이미 북마크된 장은 기존 채워진 아이콘 유지**(`_setBookmarkBtnIcon` 가 상태별 path 재구성, build/refresh 공용). 북마크 목록 **빈 상태**는 단순 "없습니다" 한 줄에서 **아이콘 + 제목 + 추가 방법 안내**(`_buildEmptyState`, 드로어·전체뷰 공용)로 교체.
  > **개정 (2026-06-06) — ⋯ 메뉴 아이콘 열 통일 + 스와이프 회복:** 위 2026-06-05 개정의 "선행 라벨 + 후행 글리프"를 폐기하고, 액션 행을 **선행 글리프 + 후행 라벨**로 뒤집되 글리프를 **정렬 그룹 체크마크와 동일한 맨 왼쪽 열**에 놓는다 — 두 그룹이 하나의 아이콘 열·라벨 열을 공유해 한 리듬으로 정렬된다(`title-action-menu-icon`/`title-action-menu-check` 가 `--menu-lead` 폭 공유, `--action` 추가 들여쓰기 제거). **의도적 HIG 이탈** — Apple Files 메뉴가 체크마크 열과 아이콘 열을 분리하는 이유는 **한 행에 아이콘과 체크마크가 동시에** 올 수 있어 두 슬롯이 공존해야 하기 때문이다. 본 앱의 ⋯ 메뉴에는 그런 행이 없다(액션 행엔 아이콘만, 정렬 행엔 체크마크만). 두 슬롯이 한 행에서 겹칠 일이 없으므로 열을 합쳐도 모호함이 없고, 합치면 시각 일관성이 올라간다. 또한 28행의 "`manual` 일 때만 `_setupDragHandle`" 은 폐기 — `_setupDragHandle` 이 모바일 **스와이프-투-리빌(수정/삭제)** 제스처도 소유하므로 자동 정렬에서도 항상 연결하고, **드래그 재정렬만** 핸들러 내부 `canDrag`(=`manual`)로 게이트한다(자동 정렬 시 스와이프 수정/삭제가 막히던 회귀 수정).
- **설정** → 신규 `/settings` 전체화면(`renderSettingsView`). `buildSettingsSections(target,{rerender,dismiss})` 추출로 팝오버(데스크탑)·전체뷰(모바일)가 동일 섹션 공유.

데스크탑 딥링크 폴백: `/bookmarks`·`/settings` 는 책 목록 + 기존 드로어/팝오버.

SPA 전환은 기존 전역 `<a>` 클릭 인터셉터(`views-routing.js`)가 처리하므로 탭 링크가 자동으로 `navigate()` 된다. 활성 탭은 `route()` 마다 `syncTabBarActive()` 가 현재 라우트로 동기화(읽기 라우트는 홈 탭).

### 3. iOS 2026 Liquid Glass 외형

- 플로팅 캡슐: `position:fixed`, 좌우 `--space-4`(16px) 전폭, 하단 `calc(--space-1 + safe-area*0.75)`(홈 인디케이터 위 여백 축소). 둥근 사각 `border-radius:26px` + `corner-shape:squircle`.
- **frosted glass 는 `::before`(absolute) 레이어에**, fixed 부모는 투명 — Safari 26 이 하단 fixed 요소를 home-indicator 틴팅에 샘플링하는 것을 회피. `-webkit-backdrop-filter` 는 리터럴 값(Safari 가 var() 미지원). 가독성 위해 약간 더 불투명(iOS 26.1 'Tinted' 방향).
- 아이콘은 **iOS/SF Symbols idiom** stroke SVG 직접 제작(Material 아님). 활성 탭 = 아이콘 색 `--theme` + **56px 정원 인디케이터**(테마색 14% 틴트, 스킴 추종 — ADR-030 후속⁴ 2026-06-05; 초기 `--accent` 캡슐 pill → 후속³ 인디케이터 제거(아이콘색만) → 후속⁴ 56px 정원 인디케이터를 테마색 틴트로 복원).
- 폴백: `prefers-reduced-transparency`/`@supports not (backdrop-filter)` → 불투명 표면. `prefers-reduced-motion` → pill 애니메이션 생략.

### 4. 헤더 정리 + FAB 제거(모바일)

탭 바가 진입점을 통합하므로 모바일에서 헤더 **홈(`.title-home-btn`)·설정(`.title-settings-btn`) 버튼 숨김**, **검색 FAB 전면 제거**(요소·CSS·`views-routing` fab-lift 옵저버 시스템 일체). 읽기 화면 **뒤로·챕터 북마크 추가** 버튼은 보존. 데스크탑은 탭 바가 없어 헤더 그대로.

### 5. 하단 공존

- **오디오 미니플레이어 = 탭 바 위 스택**(iOS Music 식). 탭 바와 동일한 플로팅 둥근 글래스 바로 통일(좌우 여백·squircle·테두리·그림자). 재생 버튼 HIG 44px 고정, 내부 여백 12px 통일. *잠정 — dev 확인 후 조정.*
- **절 선택 모드 = 탭 바 숨김**(전용 하단 바가 차지).
- `--tabbar-reserve` 토큰으로 모든 뷰 `#app` 하단 패딩을 줘 콘텐츠가 탭 바에 가리지 않게. 오디오 표시 중엔 오디오 바 높이만큼 추가.

### 6. 브레이크포인트 근거

탭 바는 앱의 기존 분기 `≤768 / ≥769`(검색 바↔FAB 전환 등 15곳)를 재사용. **데스크탑 사이드바는 다른 분기가 필요** — 콘텐츠 `--max-width:720px` + `--sidebar-w:260px` 공존에 ≥~1024px 필요(769px 에선 사이드바가 본문을 밀어냄). 그래서 사이드바는 ≥~1024px 신설 + 콘텐츠 시프트로 별도 단계.

## 스크롤 축소를 하지 않는 이유 (2026 현행 iOS)

iOS 26 출시본의 "스크롤 시 코너 아이콘으로 접힘 + 검색 별도 버튼"은 가독성·사용성 불만으로 iOS 26.1(Clear/Tinted 토글)→**iOS 27 에서 상시 풀 탭바 복원 + 검색 재통합**으로 되돌려졌다. 따라서 **상시 표시 풀 탭바 + 검색=일반 탭**이 2026 현행이며, 스크롤 축소는 구현하지 않는다.

## 검토한 대안

- **오버레이 트리거 모델**(탭이 기존 시트/드로어/팝오버를 엶) — 변경 최소이나 "각 탭=화면" iOS 의미론과 어긋남. 사용자가 전체화면 뷰를 선택.
- **진짜 squircle(clip-path/SVG, Safari 포함)** — `corner-shape` 가 Safari 미지원이라 iPhone 에서 squircle 을 강제하려면 clip-path 뿐인데, 플로팅 드롭섀도가 잘리고 glass 테두리가 깨져 보류. `corner-shape` 점진 향상 + `border-radius` 폴백 채택.
- **스크롤 축소(iOS 26 출시본)** — 위 사유로 보류.

## 영향

- `index.html`(탭 바 `<nav>`), `css/style.css`(탭 바·플로팅 오디오·하단 패딩), `js/app/views-routing.js`(라우트·활성 동기화·FAB 제거), `js/app/bookmark.js`/`search.js`/`settings-ui.js`(전체화면 뷰 + 빌더 재사용), `js/app/install.js`(inert 목록).
- 유닛 영향 없음(566 통과, 라우팅/내비는 e2e 책임 — ADR-013). tsc 0.
- DESIGN.md §7 갱신, ADR-028 §7 상태 갱신, CLAUDE.md·architecture.md 인덱스 갱신.

## 후속

데스크탑 사이드바(≥~1024px), `노트` 기능 본체, 북마크 뷰 "+"·"⋯" 배열 다듬기, 오디오 스택 위치 최종 튜닝, 인앱 reduce-transparency 토글, 데스크탑 오버레이의 전체화면 전환 여부.
