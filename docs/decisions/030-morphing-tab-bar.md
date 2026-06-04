# ADR-030: 모핑 탭 바 — 아이콘 전용 + 분리 검색 원형 + 검색/스크롤 모핑

- 일시: 2026-06-04
- 상태: 승인됨 — 구현 진행 중. 검색 모핑(P1·P2) 완료·dev 배포, 스크롤 축소 + 오디오 미니 모핑(P3)·문서/테스트/머지(P4) 대기.
- 관련 ADR: **ADR-029(개정 대상)** — 모바일 하단 탭 바 1단계, ADR-028(디자인 시스템 §7 적응형 내비), ADR-025(헤더 elevation·frosted glass 규칙), ADR-005(검색)
- 권위 문서: 루트 [`DESIGN.md`](../../DESIGN.md) §7
- 관련 PR: 이 작업 브랜치 + #184(검색 모핑 완성·옛 시트 제거)·#185(모서리 통일)

## 맥락

ADR-029 로 모바일 하단 탭 바(홈·검색·북마크·설정 4탭, 각 탭=전체화면 라우트)가 섰다. 이후 **Apple Music 앱의 하단 내비를 벤치마크**하면서 두 가지를 다시 결정한다:

1. 검색을 일반 탭으로 두지 않고 **탭 바 우측의 분리된 원형 버튼**으로 — 탭하면 그 원형이 검색 입력창으로 **모핑**(탭 바는 홈만 남기고 접힘).
2. ADR-029 가 "미채택"으로 둔 **스크롤 축소**를 채택 — 본문을 읽어 내려갈 때 탭 바가 홈 원형으로 접히고, 오디오 재생 중이면 오디오 플레이어가 홈·검색 사이로 축소·이동.

모바일(≤768px) 전용. 데스크탑(≥769px)은 ADR-029 그대로(탭 바 미표시, 헤더/오버레이 유지, 사이드바는 후속).

## 결정

### 1. 라벨 없는 아이콘 탭 바 + 분리된 검색 원형 (ADR-029 §1 개정)

- 탭 라벨(`.tab-label`) 제거 — **아이콘 전용**(접근성은 `aria-label`). 탭 순서 **홈·북마크·노트·설정** 4개. `노트`는 후속 기능 **목업**(비활성 `<button aria-disabled>`, 노트패드 아이콘)으로 자리만 확보.
- **검색은 탭에서 분리** — 탭 바 우측의 별도 원형 버튼(`#tab-search`). 검색 아이콘 정중앙, FAB 유사. (ADR-029 의 "검색=4탭 중 하나"를 개정.)
- 구조: `#tab-dock`(fixed, 투명) flex 컨테이너가 `#tab-bar`(pill) + `#tab-search-dock`(검색 원형 + 입력)을 묶는다. **탭 바는 오디오 바 왼쪽 끝, 검색 원형은 오른쪽 끝**에 정렬(`#tab-dock` 좌우 `--space-4` + `justify-content` / `margin-left:auto` 기반 — 오디오 바 `margin:0 --space-4` 와 좌우 일치). `#tab-dock`·`#tab-search-dock` 은 시각효과 0의 순수 레이아웃 레이어.

### 2. frosted glass 를 요소에 직접 (ADR-029 §3 개정)

ADR-029 는 Safari 26 home-indicator 틴팅 회피를 위해 glass 를 `::before` 레이어에 얹고 fixed 부모를 투명하게 뒀다. ADR-030 구조에서는 **fixed 요소가 `#tab-dock`(투명) 하나뿐**이라 그 우려가 해소된다 → **frosted glass(반투명 배경 + `backdrop-filter`)를 `#tab-bar`·`#tab-search` 요소에 직접** 적용(`::before` 우회 제거).

- **floating 스타일 3종 통일** — 탭 바 pill · 검색 원형 · 오디오 바 모두 `frosted glass + 1px 테두리(--text 8%) + --shadow-2`, 높이 **60px**(`--touch-target 44 + --space-2 ×2`). 테두리가 가장자리를 정의해 같은 그림자도 또렷하게 떠 보인다.
- 좌우 모서리는 `--radius-pill` + `corner-shape: superellipse` 로 모핑 시 원형과 통일(#185).
- 폴백: `prefers-reduced-transparency` / `@supports not (backdrop-filter)` → 불투명 표면(모핑 입력 pill·검색 원형·탭 바 모두). `prefers-reduced-motion` → 모핑 트랜지션 생략.

> **참고:** 입력 placeholder·텍스트는 본문 Serif 상속을 피해 **Sans**(시스템 + Noto Sans KR). placeholder 문구는 인-페이지 검색 입력과 통일("검색 (예: 사랑, 사랑 in:요한, 창세 1:3)").

### 3. 검색 모핑 (신규) — `js/app/tabbar.js`

검색 원형 탭 → `#tab-dock.searching` 토글:

- 비-홈 탭은 `max-width:0 + opacity:0`로 **접힘**, `#tab-bar`는 **60px 원형**(검색 원형과 동일 형태)으로. 검색 원형(`#tab-search-dock`)은 **남은 폭을 채우는 입력 pill**로 확장(`flex:1 1 0` + `min-width:0` — placeholder 길이와 무관, 우측 넘침 방지). 양방향 CSS 트랜지션.
- 입력 pill 구성: 왼쪽 검색 아이콘 + 입력 + **검색어 지우기(⊗, 텍스트 있을 때만, 44px 터치타깃)** + **닫기(X) 원형**. 닫기 X 는 검색 세션 동안(결과 화면 포함) 유지; 탭하면 검색 모드 전체 롤백(`closeSearchToHome`). idle 에선 `aria-hidden + tabindex=-1`로 a11y 트리 제외.
- **하단 입력이 단일 검색 필드** — Enter → 기존 `window.commitTopSearch`(verse ref auto-nav 포함) → `/search?q=` → `renderSearchResults`. 모핑 중 `/search` 전체뷰 **상단 인-페이지 입력은 `body.tabbar-searching`으로 숨김**. Enter 시 입력 blur → 키보드 내려 dock 접힘(세션·X 유지).
- **키보드 처리(visualViewport)** — 입력 포커스 중 `visualViewport` resize/scroll 을 추적해 키보드 높이만큼 `#tab-dock`을 `translateY`로 들어 올린다(키보드가 입력을 가리지 않게). blur·복구 시 원위치.
- **상태 동기화·복구**:
  - 기존 `/search?q=…` 위에서 모핑을 열면 현재 쿼리를 dock 입력으로 복사.
  - popstate(뒤로/앞으로) 등으로 `/search?q=`가 바뀌면 `syncTabSearchQuery`가 dock 입력을 URL 쿼리에 동기화(입력 포커스 중엔 미덮어쓰기).
  - **Esc**는 document capture 단계에서 가로채 결과 링크·body 어디에 포커스가 있어도 검색 모드 전체를 닫는다(app.js 전역 Esc 보다 우선).
  - 홈 탭 등 검색 외 라우트로 가면 `views-routing` 의 `syncTabBarActive`가 `window.exitTabSearch`를 호출해 복구.
- **빈 상태** — 결과 0건 / 빈 검색어 뷰에 중앙 빈 상태(돋보기 + 제목 + 부제).

### 4. 옛 모바일 검색 시트 제거

검색이 탭바 모핑 단일 경로가 되면서 **모바일 검색 바텀 시트(`openSearchSheet`/`closeSearchSheet`/`#search-sheet`·드래그)를 전면 제거**(search.js 대폭 감소). 데스크탑 인라인 검색 바 + `/search` 결과 경로는 유지. 검색 FAB 는 ADR-029 에서 이미 제거.

### 5. 스크롤 축소 + 오디오 미니 모핑 — **대기(P3)**

본문을 아래로 읽어 내려갈 때:
- 탭 바를 홈 원형으로 접고(검색 모핑과 동일 collapsed 형태) — 홈 탭으로만 복구(스크롤 되돌림 자동 복구 없음).
- 오디오 재생 중이면 플로팅 `#audio-bar`가 **축소되어 홈·검색 사이 dock 행으로 이동**(재생/일시정지 + 진행바만). `#tab-dock` flex 컨테이너가 이 삽입의 토대.

스크롤 방향 감지는 `initScrollElevation`(IntersectionObserver) 패턴을 참고하되 throttle scroll 리스너로. (미구현 — 후속.)

### 6. 복구·키보드 입력 — 결정한 갈림길

- **축소 상태 복구 = 홈 탭으로만**(스크롤 되돌림 자동 복구 미채택). Apple Music 은 스크롤 업 자동 복구지만, 본 앱은 명시적 홈 탭으로 일원화.
- **검색 입력 = 하단 입력창 직접 검색 + visualViewport 키보드 위 띄움**(대안: 모핑은 연출만 하고 입력은 `/search` 상단으로 핸드오프 — 미채택. iOS Safari visualViewport 처리 리스크는 dev 실측으로 수용).

## 검토한 대안

- **검색을 4탭 중 하나로 유지(ADR-029 원안)** — Apple Music idiom(분리 원형 + 모핑)과 어긋나고, 입력 확장 모션을 줄 자리가 없음. → 분리 원형 채택.
- **glass 를 `::before` 유지** — ADR-030 구조에선 fixed 부모가 `#tab-dock`(투명)뿐이라 불필요한 레이어. → 요소 직접 적용으로 단순화.
- **검색 입력을 상단 핸드오프** — 키보드 가림은 안전하나 Apple Music 충실도/모핑 일관성 저하. → 하단 입력 + visualViewport 채택.
- **스크롤 업 자동 복구** — 구현 복잡(방향 히스테리시스) + 의도치 않은 복구. → 홈 탭 단일 복구.

## 구현 메모

- 신규 모듈 `js/app/tabbar.js`(`// @ts-check` + JSDoc, ESM). `window.exitTabSearch` 노출; search.js 가 `window.commitTopSearch` 노출.
- CSS 는 `css/style.css` 탭 바 블록 + `#tab-dock.searching` 모핑 규칙. 모션 토큰 `--duration-base`/`--ease-standard`, reduced-motion 분기.
- 테스트: 라우팅·DOM-heavy 내비는 e2e 책임(ADR-013). 옛 검색 시트 e2e 는 제거. 유닛 566 통과·tsc 0(P2 시점).

## 후속

- P3: 스크롤 축소 + 오디오 미니 모핑(§5).
- P4: 본 ADR 상태 갱신 + DESIGN.md §7 + `docs/architecture.md` 인덱스 + CLAUDE.md "현재 상태" + e2e(test_tabbar) + main 머지.
- 데스크탑 사이드바(≥~1024px)는 ADR-029 §6 후속 유지.
