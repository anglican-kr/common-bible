# ADR-030: 모핑 탭 바 — 아이콘 전용 + 분리 검색 원형 + 검색/스크롤 모핑

- 일시: 2026-06-04
- 상태: 승인됨 — 구현 완료(모바일, dev 배포). P1(구조)·P2(검색 모핑)·P3(스크롤 축소 + 오디오 미니) 완료, main 머지 대기. 데스크탑 사이드바·모션 미세 다듬기(오디오 sticky→fixed 스냅)는 후속.
- 관련 ADR: **ADR-029(개정 대상)** — 모바일 하단 탭 바 1단계, ADR-028(디자인 시스템 §7 적응형 내비), ADR-025(헤더 elevation·frosted glass 규칙), ADR-005(검색)
- 권위 문서: 루트 [`DESIGN.md`](../../DESIGN.md) §7
- 관련 PR: 이 작업 브랜치 + #184(검색 모핑 완성·옛 시트 제거)·#185(모서리 통일)·#186·#187(키보드 X)

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

> **개정 (2026-06-05): 활성 인디케이터 원형 + 아이콘 광학 크기 정규화 + 모핑 홈 강조.**
> - **활성 인디케이터 원형화** — `.tab-icon-wrap` 을 `3rem × 44px` stadium 에서 `44px × 44px` 정사각(+`--radius-pill`)으로 바꿔 활성 탭 배경을 **정원**으로. 검색 원형·모핑 원과 형태 언어 통일.
> - **아이콘 크기 일치(설정 아이콘 기준)** — 톱니(설정) 아이콘 glyph 가 24 viewBox 의 ~22 를 채우는 반면 홈·북마크·노트·검색 glyph 는 ~15–17 만 채워 작게 보였다. 각 아이콘의 `viewBox` 를 glyph 바운딩박스 중심으로 동일 비율(22/24)로 좁히고 `stroke-width` 를 비례 보정해(렌더 폭·획 굵기 모두 설정 아이콘과 동일) 광학 크기를 일치. 설정 아이콘만 `0 0 24 24`·`stroke-width 1.8` 유지(기준). 원본 path 는 그대로 재사용.
> - **모핑 시 홈 강조** — `.searching`/`.collapsed` 로 탭 바가 홈 원형 캡슐이 되면 안쪽 활성 인디케이터(이중 원)를 제거(`background:none`)하고 홈 아이콘을 `--theme`(스킴 추종 테마색)로 틴트.

> **개정 (2026-06-05): 탭 바↔검색 간격 정리 + 인디케이터를 바 높이까지 확대.**
> - **탭 바↔검색 간격 = 8px(오디오↔탭 바 수직 간격과 동일).** §1 의 "탭 바=좌측 끝 / 검색=우측 끝(`margin-left:auto`)" 배치는 짧은 4탭 pill 과 우측 검색 사이에 **빈 가운데가 너무 넓게** 보였다. → `#tab-bar` 를 `flex:1` 로 늘려 검색 원형 바로 앞까지 채우고, `#tab-dock` 에 `gap:--space-2`(8px)만 남긴다. 이 8px 는 오디오 바(`bottom:--tabbar-reserve`)와 탭 dock(`bottom:--space-1`+높이 60px) 사이 **수직 간격(72−64=8px)과 동일** — 가로·세로 여백 통일. 아이콘 분배는 `.tab-item{flex:1}`(균등 컬럼), 넓은 화면에서 컬럼이 `max-width` 상한에 닿으면 `justify-content:space-between` 이 펼친다(좁은 폰에선 무효).
> - **활성 인디케이터 = 바 높이(정원).** §1 의 `44px` 고정 인디케이터 안에서 아이콘이 비좁게 느껴졌다. → `#tab-bar` 상하 패딩을 0 으로(높이 60px 명시), `.tab-icon-wrap` 을 `height:100% + aspect-ratio:1`(+ `max-width:100%` 로 좁은 화면 이웃 침범 방지)로 바꿔 인디케이터가 **바 안쪽 높이를 그대로 채우는 정원**이 되게 한다. 아이콘은 `1.9rem → 1.7rem`(검색 아이콘도 동일)으로 약간 줄여 커진 인디케이터 안에서 여백 확보.

### 2. frosted glass 를 요소에 직접 (ADR-029 §3 개정)

ADR-029 는 Safari 26 home-indicator 틴팅 회피를 위해 glass 를 `::before` 레이어에 얹고 fixed 부모를 투명하게 뒀다. ADR-030 구조에서는 **fixed 요소가 `#tab-dock`(투명) 하나뿐**이라 그 우려가 해소된다 → **frosted glass(반투명 배경 + `backdrop-filter`)를 `#tab-bar`·`#tab-search` 요소에 직접** 적용(`::before` 우회 제거).

- **floating 스타일 3종 통일** — 탭 바 pill · 검색 원형 · 오디오 바 모두 `frosted glass + 1px 테두리(--text 8%) + --shadow-2`, 높이 **60px**(`--touch-target 44 + --space-2 ×2`). 테두리가 가장자리를 정의해 같은 그림자도 또렷하게 떠 보인다.
- 좌우 모서리는 `--radius-pill` + `corner-shape: superellipse` 로 모핑 시 원형과 통일(#185).
- 폴백: `prefers-reduced-transparency` / `@supports not (backdrop-filter)` → 불투명 표면(모핑 입력 pill·검색 원형·탭 바 모두). `prefers-reduced-motion` → 모핑 트랜지션 생략.

> **참고:** 입력 placeholder·텍스트는 본문 Serif 상속을 피해 **Sans**(시스템 + Noto Sans KR). placeholder 문구는 인-페이지 검색 입력과 통일("검색 (예: 사랑, 사랑 in:요한, 창세 1:3)").

> **개정 (2026-06-04, 2026-06-05 재개정): 탭 dock 뒤 콘텐츠 데코레이션 scrim.** floating 캡슐(`#tab-bar`·`#tab-search`·미니 오디오)은 투명 `#tab-dock` 위에 떠 있어 캡슐 **양옆 틈·아래 sliver**로 스크롤되는 본문이 그대로 노출돼 지저분했다. dock 바로 아래에 화면 폭 전체 **페이드 그래디언트 scrim**(`#tabbar-scrim`, 순수 장식 `aria-hidden`)을 깔아 본문을 배경색으로 녹인다.
> - **글래스-through 모델 (06-05 재개정).** 초안은 `--scrim-solid`(=캡슐 윗변)까지 솔리드 `--bg`로 캡슐을 **완전히 가렸으나**, 그러면 캡슐 뒤가 솔리드 `--bg`가 돼 탭 바·검색의 글래스 투명도(70→62% / 80→72%)가 (특히 라이트에서) 무의미해졌다. → 솔리드는 **캡슐 아래·바닥 모서리(`--scrim-solid`)에만**, 캡슐 영역은 페이드가 통과하게 둬 더 투명해진 글래스 너머로 **'이미 옅게 사라지는 중인' 본문이 부드럽게 비쳐** liquid-glass 깊이감을 준다(선명한 노출은 없음). 절대 길이 stop 으로 경계를 캡슐 기하에 고정.
> - **페이드 도달점 = 캡슐(pill) 윗변 위 ¼ (06-05 추가 튜닝, 06-05 재튜닝).** 처음엔 `--scrim-fade-top`을 `--tabbar-reserve + 3rem`(캡슐 윗변보다 한참 위)에 둬 본문이 캡슐 한참 전에 사라졌는데, 그러면 **캡슐 위에 빈 마진이 생겨 탭 바 주변이 휑했다**. 반대로 윗변 25% **아래**(pill 높이 ×0.75)에서 끊으니 캡슐 바로 위가 답답했다. → 기준을 **캡슐 윗변 위 ¼** 으로 잡아 `--scrim-fade-top = pill 밑변 + pill 높이 × 1.25`(밑변 `--space-1`+safe, 높이 `--touch-target`+`--space-2`×2 = 60px) 로 둔다. 페이드가 캡슐 전체를 지나고 윗변 위로 pill 높이의 ¼ 만큼 더 올라가 투명에 닿아, 캡슐 상단·바로 위 본문에 숨 쉴 여백을 준다(휑하지도, 답답하지도 않게). **페이드 기준은 오디오 유무와 무관하게 항상 탭 바 캡슐 윗변으로 통일**(06-05 재튜닝) — 한때 오디오 표시 중엔 오디오 바 기준(`--tabbar-reserve + 1.25 × 3.5rem`)으로 올렸으나, 오디오 유무에 따라 페이드 높이가 출렁여 일관성이 떨어졌다. 오디오 바는 탭 바 위에 스택돼 그 위로 본문이 옅게 비칠 수 있으나 이를 감수하고 탭 바 기준으로 고정.
> - 얇은 `backdrop-filter: blur(8px)`를 `::before`에 얹고 mask 로 최상단 fade-out — 페이드 구간의 옅은 본문에 '유리 밑' 질감 보강. **`prefers-reduced-transparency: reduce` 에선 탭 chrome 과 동일하게 blur 끔**(그래디언트는 유지). blur/`backdrop-filter` 미지원 브라우저는 그래디언트만으로 동작.
> - **z-index 9** — 하단 chrome(오디오 바 z:10 → `#tab-dock` z:`--nav-z` 30) **아래**, 스크롤 콘텐츠 위. chrome 보다 위면 scrim 솔리드/blur 가 컨트롤을 덮어 가린다(특히 오디오 표시 시 페이드 영역이 오디오 바까지 올라옴). 쌓임: content < `#tabbar-scrim`(9) < `#audio-bar`(10) < `#tab-dock`(30).
> - **키보드 추종** — 검색 키보드가 `--kb-overlap`(visualViewport)로 dock 을 올리면 scrim 도 `bottom: var(--kb-overlap)`로 함께 올라가 올라간 캡슐 뒤를 계속 받친다(안 그러면 올라간 캡슐 옆으로 본문 재노출). 이를 위해 `tabbar.js` 가 `--kb-overlap` 을 `#tab-dock` 인라인이 아니라 **`:root`(documentElement)** 에 설정 → dock·scrim 이 함께 상속.
> - 페이드 기준은 오디오 유무와 무관하게 항상 탭 바 캡슐 윗변(`--scrim-fade-top` base 규칙). 절 선택 모드는 dock 이 숨으므로 scrim 도 숨김. `--bg` 토큰 추종이라 다크/라이트 자동 대응. 모바일(≤768px) 전용. dev 스크린샷 검증(라이트·다크 × 오디오 유무).

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

### 5. 스크롤 축소 + 오디오 미니 모핑 (구현 완료)

**적용 조건(게이트):** 스크롤 축소는 (1) **오디오 북 설정(`loadAudioShow()`)이 켜져 있고** (2) **읽기 화면(`view==="chapter"`·`"prologue"`)** 일 때만. 책 목록(`books`·`division`)·장 선택(`chapters`)·검색·북마크·설정 화면에선 아래로 스크롤해도 탭 바를 그대로 유지(축소·미니 오디오는 오디오 북 활성 + 본문 읽기 맥락 전용).

본문을 아래로 스크롤하면(읽기 진행, 위 게이트 충족 시):
- `#tab-dock.collapsed`: 비-홈 탭 접고 `#tab-bar`를 60px 홈 원형으로(검색 모핑과 홈 원형·탭 접힘 CSS 공유). 검색 원형은 우측 유지 → 홈·검색이 양 끝.
- 오디오 표시 중이면(`body.tabbar-collapsed`) 플로팅 `#audio-bar`가 `position:fixed`로 **홈·검색 원형 사이 dock 행에 축소·이동**(60px, 재생 버튼 + 진행바만 — `.audio-time`·`.audio-speed-btn` 숨김). 좌우 = `space-4 + 60px + space-2`.
- **복구**: 최상단(scrollY≈0) 자동 복구 + 라우트 변경 시 복구. 중간 구간에서 위로 스크롤은 유지(깜빡임 방지). 검색 모핑 중엔 축소 안 함.
- **축소 상태에서 홈 탭 = 홈 이동이 아니라 "펼치기"** — 탭바 복원 + 오디오 미니를 원래 floating 위치로 되돌리고 읽던 위치 유지(전역 `<a>` 네비를 `preventDefault`로 차단). 펼친 뒤 다시 아래로 스크롤하면 재축소.

스크롤 감지는 throttle(rAF) scroll 리스너 + `nextScrollCollapsed` 순수 함수(임계 64px, 최상단 4px). 오디오 `sticky→fixed` 위치 전환이라 현재 모션은 스냅(부드러운 전환은 후속 다듬기).

### 6. 복구·키보드 입력 — 결정한 갈림길

- **축소 상태 복구 = 최상단 자동 복구 + 홈 탭(펼치기)**. (초안 "홈 탭으로만"에서 dev 검증 후 개정 — 최상단 도달 시 자동 복구가 자연스럽고, 홈 탭은 홈 이동이 아니라 펼치기로 일원화.) iOS Safari 식 "위로 스크롤 즉시 복구"는 끝에서 깜빡일 수 있어, **최상단에서만** 자동 복구 + 중간 위로 스크롤은 유지로 절충.
- **검색 입력 = 하단 입력창 직접 검색 + visualViewport 키보드 위 띄움**(대안: 모핑은 연출만 하고 입력은 `/search` 상단으로 핸드오프 — 미채택). iOS 가 포커스 입력을 키보드 위로 올리려 페이지를 미는 문제는 **focus 시 `scrollTo(0,0)` + `preventScroll`**로 상쇄, **X(키보드 내리기) 노출·홈 숨김은 입력 focus/blur**에 묶어(visualViewport 높이 감지 불안정 회피) 안정화.

## 검토한 대안

- **검색을 4탭 중 하나로 유지(ADR-029 원안)** — Apple Music idiom(분리 원형 + 모핑)과 어긋나고, 입력 확장 모션을 줄 자리가 없음. → 분리 원형 채택.
- **glass 를 `::before` 유지** — ADR-030 구조에선 fixed 부모가 `#tab-dock`(투명)뿐이라 불필요한 레이어. → 요소 직접 적용으로 단순화.
- **검색 입력을 상단 핸드오프** — 키보드 가림은 안전하나 Apple Music 충실도/모핑 일관성 저하. → 하단 입력 + visualViewport 채택.
- **스크롤 업 즉시 자동 복구(전 구간 방향 감지)** — 끝에서 깜빡일 수 있어 미채택. **최상단 도달 시에만** 자동 복구 + 중간 위로 스크롤 유지로 절충.

## 구현 메모

- 신규 모듈 `js/app/tabbar.js`(`// @ts-check` + JSDoc, ESM). `window.exitTabSearch`·`syncTabSearchQuery`·`resetTabCollapse` 노출; search.js 가 `window.commitTopSearch` 노출. SW 프리캐시(`sw.js` SHELL_FILES)에 tabbar/citations/parallels 추가.
- CSS 는 `css/style.css` 탭 바 블록 + `#tab-dock.searching`/`.collapsed` 모핑 규칙(홈 원형·탭 접힘 공유). 모션 토큰 `--duration-base`/`--ease-standard`, reduced-motion 분기.
- 키보드(`KEYBOARD` 블록: `keyboardOverlap`/`setKeyboardState`/`liftForKeyboard`)·스크롤 축소(`SCROLL` 블록: `nextScrollCollapsed`)는 순수 함수로 슬라이스해 유닛 검증(`tests/unit/tabbar.test.js` 12 케이스). 전체 유닛 578·tsc 0.
- 라우팅·DOM-heavy 내비/모핑은 e2e 책임(ADR-013). 옛 검색 시트 e2e 는 제거.
- **dev/로컬 테스트 편의**: dev·localhost 에선 SW 가 shell(JS/CSS/HTML)을 network-first 로 서빙(version 고정 → SHELL_CACHE 불변으로 인한 stale 회피). PWA·오프라인은 유지, 프로덕션은 cache-first 그대로.

## 후속

- 오디오 미니 모핑 모션 다듬기(`sticky→fixed` 위치 전환 스냅 → 부드러운 전환).
- 데스크탑 사이드바(≥~1024px)는 ADR-029 §6 후속 유지.
