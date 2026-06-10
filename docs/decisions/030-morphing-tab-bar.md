# ADR-030: 모핑 탭 바 — 아이콘 전용 + 분리 검색 원형 + 검색/스크롤 모핑

- 일시: 2026-06-04
- 상태: 승인됨 — 구현 완료(모바일, main 머지·dev 배포). P1(구조)·P2(검색 모핑)·P3(스크롤 축소 + 오디오 미니) 완료(#188·#191·#200). 데스크탑 사이드바·모션 미세 다듬기(오디오 sticky→fixed 스냅)는 후속.
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

> **개정 (2026-06-05, 후속): 끝 인디케이터 캡 정렬 + 하단 chrome 간격 대칭.**
> - **양 끝 인디케이터를 pill 캡에 정렬(초승달 제거).** 직전 개정에서 `.tab-item{flex:1}`(균등 컬럼)이라 끝 아이콘이 컬럼 중앙에 놓여, 양 끝 인디케이터(정원)와 pill 둥근 캡 사이에 **초승달 모양 sliver** 가 남았다. → `.tab-item` 을 `flex:0 1 auto`(인디케이터=바 높이 폭의 콘텐츠 탭)로 바꾸고 `#tab-bar{justify-content:space-between}` 로 양 끝 탭을 캡 안쪽에 밀어넣어, 끝 인디케이터가 캡 내부 정원과 동심으로 겹치게 한다(중간 두 탭은 균등 분배). 좁은 화면은 flex-shrink + `.tab-icon-wrap{max-width:100%}` 로 이웃 침범 방지.
> - **하단 chrome(홈·미니 오디오·검색) 간격 대칭.** 직전 개정에서 넣은 `#tab-dock{gap:--space-2}` 가 dock 의 **마지막 자식 `#tab-search-close`**(키보드 전용, idle `width:0`)와 `#tab-search-dock` 사이에도 끼어, 검색 원형이 8px 왼쪽으로 밀렸다 → 검색 우측 여백(24px) ≠ 홈 좌측 여백(16px), 그리고 홈↔오디오↔검색 간격이 불균등. → base dock gap 을 제거하고(원래 설계대로 idle 은 `margin-left:auto` 우측 정렬, gap 0) 탭 바↔검색 8px 간격은 **`#tab-bar{margin-right:--space-2}`** 로 옮긴다(width:0 닫기 버튼 앞에 gap 이 안 낌). 모핑 중 입력↔닫기 간격은 기존 `#tab-dock.searching{gap}` 이 그대로 담당하고, `.searching/.collapsed #tab-bar{margin-right:0}` 으로 이중 간격을 막는다. 결과: 홈 좌측 여백 = 검색 우측 여백 = `--space-4`, 홈↔오디오 = 오디오↔검색 = `--space-2`(축소 오디오 바 `left/right` calc 와 일치).

> **개정 (2026-06-05, 후속²): 인디케이터를 확정적 정원(정사각 슬롯)으로.** 위 "끝 인디케이터 캡 정렬" 에서 쓴 `.tab-item{flex:0 1 auto}` + `.tab-icon-wrap{height:100% + aspect-ratio:1 + max-width:100%}` 조합이 flex 콘텐츠 사이징과 얽혀, 실제 렌더는 **가로로 찌그러진 타원** 인디케이터 + 슬롯 폭 불안정이 됐다(우측 검색 근처 레이아웃 흐트러짐). → 각 `.tab-item` 을 **명시 정사각 슬롯**(`width: calc(--touch-target + --space-2*2)` = 바 높이, `flex:0 1 auto`, `min-width:0`)으로 고정하고, `.tab-icon-wrap` 은 `width:100% + aspect-ratio:1` 로 슬롯을 채워 **슬롯 폭에서 높이를 파생** → 좁은 화면에서 슬롯이 축소돼도 **항상 1:1 정원**. 슬롯 한 변 = 바 높이 = 캡 반원 지름 = 검색 버튼 지름으로 통일(모두 60px), 아이콘은 flex 중앙 정렬로 인디케이터 정중앙. `height:100%`/`max-width:100%` 의존 제거(확정적 사이징).

> **개정 (2026-06-05, 후속³): 활성 인디케이터(배경 pill) 제거 → 활성 아이콘 테마색.** 위에서 다듬은 정원 인디케이터(활성 탭/검색의 `--accent` 14% 배경 틴트)를 **아예 없애고**, 활성 표시를 **아이콘 색상 = `--theme`** 로 단순화한다(더 가벼운 내비 언어). `.tab-item.active`/`[aria-current]` 와 `#tab-search.active` 모두 배경 틴트 제거 + `color: var(--theme)`. 모핑 홈 `--theme` 강조(후속 없던 `background:none` 죽은 규칙 정리)와 동일 언어로 통일. **`--theme` 사용 범위 확장**: ADR-028 은 테마색을 절 번호·단락 기호 + 모핑 홈(내비 시그니처)로 한정했는데, 여기에 **내비 활성 탭/검색 아이콘**을 추가한다(스킴 추종 활성 표시). 슬롯(`.tab-item` 60px 정사각)·`.tab-icon-wrap` 구조는 그대로(탭 영역·간격·press scale 유지), 배경만 제거.

> **개정 (2026-06-05, 후속⁴): 활성 인디케이터 복원(56px 정원, 테마색 틴트).** 후속³ 에서 인디케이터를 없앴더니 활성 탭의 시각적 앵커/히트영역 단서가 약했다 → **56px 정원 인디케이터를 다시 넣되 테마색 언어로**. `.tab-icon-wrap` 지름을 슬롯 채움(≈60px)에서 **56px**(`calc(--touch-target + --space-2*2 − --space-1)` = 바 높이 60 − 상하 2px 인셋)로 줄이고(`max-width:100%` 로 좁은 화면 슬롯 초과 방지), 활성 탭/검색에 `background: color-mix(--theme 14%, …)` 틴트(다크 검색은 18%). 아이콘 색은 후속³ 그대로 `--theme`. 양 끝 인디케이터는 60px 캡 안쪽에 2px 여백으로 안착, 모핑 홈은 60px 캡슐 자체가 인디케이터라 `background:none` 으로 이중 원 회피(재추가). 결과: 활성 = 56px 테마 틴트 정원 + 테마색 아이콘.

> **개정 (2026-06-05, 후속⁵): 절제된 리퀴드 글라스 — 입체 질감 + 슬라이딩 인디케이터.** 전체적으로 평평하던 하단 chrome 에 **저강도 글래스 깊이**를 입히고, 활성 인디케이터를 **per-tab 배경에서 공유 슬라이딩 요소**로 바꿔 탭 사이를 흐르게 한다. 톤은 **절제**(deference 유지) — 가까이서/움직일 때만 은은히.
> - **공유 질감 토큰**: `:root` 에 `--glass-sheen`(상단→투명 흰색 그래디언트, 라이트 16%/다크 7%)과 `--glass-inset`(상단 하이라이트 + 하단 음영 box-shadow)을 추가. 다크에서 알파 자동 조정. **모든 floating chrome 통일** 적용 — `#tab-bar`·`#tab-search`(+`.active`)·모핑 입력창(`#tab-dock.searching #tab-search-dock`)·키보드 닫기 버튼·`#audio-bar`·`.tab-indicator`. 기존 `background`(glass 틴트)는 그대로 두고 그 위에 `--glass-sheen` 을 background-image 로 합성, `box-shadow` 에 `--glass-inset` append(비파괴).
> - **moving 요소에 `backdrop-filter` 미사용** — 글래스 중첩은 Safari 합성 불안정 + 이동 시 GPU 비용. 질감은 sheen/inset(정적) + 탭 바 자체 backdrop blur 로 내고, 인디케이터는 `transform` 만 애니메이트 → 60fps.
> - **슬라이딩 인디케이터**: HTML `#tab-bar` 첫 자식 `<span class="tab-indicator" aria-hidden>`. `.tab-item.active .tab-icon-wrap{background}` 제거 → 공유 `.tab-indicator`(56px 정원, `--theme 14%` 틴트 + sheen/inset)가 대체. **division-tab 슬라이드 패턴 미러링**(`views-routing.js` `positionTabIndicator()` ← `syncTabBarActive()`): 활성 탭 실측(`offsetLeft/Width`; space-between 60px 슬롯이라 비선형)으로 `translateX`, **탭 이동일 때만 슬라이드**(`_prevTabIndic`), 첫 표시·리사이즈·`prefers-reduced-motion` 은 스냅. `position:relative` 컨텍스트는 `#tab-bar`, 아이콘은 `.tab-item{z-index:1}` 로 인디케이터(z:0) 위.
> - **공존**: 모핑(`.searching`)·축소(`.collapsed`) 중 `#tab-dock.searching/.collapsed .tab-indicator{opacity:0}`(ID 포함 특이도가 인라인 무관하게 `.is-shown` 이김) — 60px 캡슐 자체가 인디케이터라 이중 원 회피, 모핑 홈 `--theme` 아이콘 유지. 검색 라우트(`/search`)·리사이즈는 JS 가 숨김/재배치(`window.syncTabIndicator`).
> - **폴백**: `prefers-reduced-transparency` / `@supports not (backdrop-filter)` 에서 `:root{--glass-sheen:none}`(광택 제거) + 기존 solid `--bg-card` 유지. `prefers-reduced-motion` 에서 `.tab-indicator{transition:none}`(슬라이드 스냅). 헤더는 여전히 solid(ADR-025) — 무관. fixed 요소(`#tab-dock`)는 투명 유지라 home-indicator 틴팅 무관.
> - **deference 와의 관계**: 후속³/⁴ 의 "anchor not signature"·specular 회피와 방향이 다르나, **저강도·정적 sheen + 완전한 reduced-* 폴백**으로 절제 범위 내. 멀리서는 평면에 가깝고 가까이/이동 시에만 깊이가 드러난다.

> **개정 (2026-06-05, 후속⁶): 글래스 레시피를 오디오 바로 통일.** 후속⁵ 까지 탭 바·검색·모핑 입력창·키보드 닫기 버튼은 오디오 바와 다른 글래스 값을 썼다(틴트 `--bg 62%`(라이트)/`--bg-card 72%`(다크) + `backdrop-filter: blur(16px) saturate(180%)`). ADR-029 의 "가독성 위해 약간 더 불투명" 의도였으나, 같은 floating chrome 끼리 투명도·blur 가 달라 나란히 떴을 때 질감이 어긋났다. → **오디오 바 레시피로 단일화** — 틴트 `--bg 50%`(라이트·다크 동일), `backdrop-filter: blur(12px)`(saturate 제거). `#tab-bar`·`#tab-search`(+`.active` 베이스)·`#tab-dock.searching #tab-search-dock`·`#tab-search-close` 적용. `--glass-sheen`/`--glass-inset`/테두리/그림자(후속⁵)와 `.active` 의 `--theme` 틴트는 그대로(베이스 틴트만 교체). 다크 오버라이드도 `--bg 50%` 로 수렴해 라이트와 동일 공식.

> **개정 (2026-06-07): `corner-shape: superellipse(2)` 선언 전량 제거 + dock 크기 토큰.** (1) `superellipse(2)` 는 **지수 2 = 정원(원호)** 이라 squircle 이 아니고 기본 `round` 와 동일하다 — 코드 9곳의 `corner-shape: superellipse(2)` 를 모두 삭제하고 **`--radius-pill`/`border-radius` 만으로 반원/정원 끝**을 유지(시각 변화 0). 본 ADR·ADR-029 본문의 `corner-shape`·"squircle" 언급은 당시 기록이며, **squircle(곡률 큰 superellipse)은 미사용**이 최종(DESIGN.md §컨트롤). 캡슐은 모두 양 끝 반원(`--radius-pill`). (2) 반복되던 60px 표현식(`calc(--touch-target + --space-2·2)`, ~14곳)을 토큰 **`--dock-control`**(60px)로, 아이콘 1.7rem(탭 아이콘)을 **`--dock-icon`** 으로 수렴 — 모든 dock 아이콘은 원형 인디케이터(56px) 안에 드는 크기. 60행 "`--radius-pill` + `corner-shape: superellipse`" 는 이제 `--radius-pill` 단독.

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

> **개정 (2026-06-06): scrim 전면 제거 — 절 선택 바와 패턴 통일.** 위 데코레이션 scrim(`#tabbar-scrim`)을 코드·DOM 요소·`--scrim-*` 토큰까지 **전량 제거**했다. floating 캡슐 양옆·아래로 비치는 본문을 페이드 그래디언트 + 얇은 blur 로 녹이는 대신, **절 선택 액션 바(`#verse-select-bar`, `background:none`)와 동일하게 scrim 없이 글래스 캡슐만 본문 위에 떠 있는 패턴**으로 통일한다 — 본문이 그대로 비치는 편이 시야가 가볍다는 사용자 피드백 + 두 하단 dock(탭 바·절 선택 바)의 디자인 패턴 일치. 캡슐 자체의 글래스(blur+틴트)와 키보드 시 `--kb-overlap` dock 추종은 그대로 유지(scrim 이 사라져 `:root` 상속 사유만 없어짐). 위 06-04·06-05 scrim 튜닝 기록은 이 결정으로 **무효**(역사 보존용).

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

> **개정 (2026-06-07): 빈 검색 뷰 안내를 "검색 방법" 예시 가이드로.** 빈 검색어 뷰의 부제는 본래 예시 문자열(`예: 사랑, 사랑 in:요한, 창세 1:3`) 한 줄뿐이라 무엇을 입력할 수 있는지 불친절했다. 북마크 빈 목록(BOOKMARK_ADD_HELP)의 설명형 빈 상태를 참고하되, 세 검색 형식을 한 문장에 몰아넣는 대신 **예시별 안내 카드 목록**으로 풀었다 — 제목 "찾고 싶은 말씀을 검색해 보세요" + 한 줄 부제 + `이렇게 검색해 보세요` 가이드(`사랑`=낱말 / `사랑 in:요한`=책 범위 / `창세 1:3`=장·절 펼치기). 각 카드는 탭하면 그 예시로 바로 검색(`commitTopSearch`). `js/app/search.js` `SEARCH_EXAMPLES`/`buildSearchExamples`, `.search-examples*` CSS(중립 `--accent` 사용 — ADR-028 테마색 범위 유지). 결과 0건 부제도 다시 시도 제안으로 보완.

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

> **개정 (2026-06-07): 검색 버튼 탭 → 키보드 즉시 표시.** 검색 원형 버튼을 눌러 모핑 진입할 때 dock 입력 `focus()` 를 `requestAnimationFrame` 안에서 호출하고 있었는데, iOS Safari 는 프로그래밍 `focus()` 가 **사용자 제스처(탭 핸들러)와 같은 동기 실행 턴** 안에서 불릴 때만 소프트 키보드를 띄운다 — rAF 로 미루면 제스처 체인이 끊겨 입력엔 포커스가 가도 키보드가 안 떴다(검색 화면만 열리고 키보드는 한 번 더 입력을 탭해야 등장). `openSearch()` 는 `#tab-search` 클릭 핸들러에서 동기로 불리고(그 안 `navigate` 도 동기), 입력은 `hidden=false` 후 같은 함수 안에서 다루므로, rAF 를 제거하고 **`$searchInput.focus({ preventScroll: true })` 를 동기 호출**해 같은 제스처 턴에 머물게 했다. `renderSearchView` 는 `body.tabbar-searching`(navigate 전 설정) 일 때 in-page 입력 autofocus 를 끄므로 dock 포커스를 가로채지 않고, 이미 검색 중 재진입 분기(127–132)도 동일하게 동기 focus 라 일관. 키보드 위치 보정(`liftForKeyboard`/`--kb-overlap`)·X 게이팅은 그대로.

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

## 적용 확장

- **절 선택 액션 바 형식 통일 (2026-06-06).** 절 선택 모드의 하단 바(`#verse-select-bar`)를
  본 ADR 의 탭 dock 형식(floating glass 캡슐 + 아이콘 전용)으로 개편 — 투명 flex dock =
  `[아이콘 글래스 pill] + [취소 글래스 원형]`, 카운트는 캡슐 위 부유 칩. 글래스 레시피
  (`--glass-sheen`/`--bg 50%`/`blur(12px)`/`--shadow-2`/`--glass-inset`/`--radius-pill` +
  `superellipse(2)`)와 60px 치수를 그대로 공유. 북마크·복사 + 노트 슬롯(placeholder).
  결정·구현 상세는 **ADR-010 §절 선택 바 개정 (2026-06-06)**.
