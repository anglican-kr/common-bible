# ADR-030: 모핑 탭 바 — 아이콘 전용 + 분리 검색 원형 + 검색/스크롤 모핑

- 일시: 2026-06-04
- 상태: 승인됨 — 구현 완료(모바일, main 머지와 dev 배포). P1(구조), P2(검색 모핑), P3(스크롤 축소와 오디오 미니)를 마쳤다(#188, #191, #200). 데스크톱 사이드바와 모션 다듬기(오디오 sticky→fixed 스냅)는 뒤의 일이다.
- 관련 ADR: **ADR-029(이 ADR이 바꾼다)** 모바일 하단 탭 바 1단계, ADR-028(디자인 시스템 §7 적응형 내비), ADR-025(헤더 elevation과 frosted glass 규칙), ADR-005(검색), ADR-010(절 선택 바), ADR-038(캘린더 탭)
- 권위 문서: 루트 [`DESIGN.md`](../../DESIGN.md) §7
- 관련 PR: 이 작업 브랜치와 #184(검색 모핑 완성, 옛 시트 제거), #185(모서리 통일), #186, #187(키보드 X)

## 맥락

ADR-029로 모바일 하단 탭 바(홈, 검색, 북마크, 설정의 4탭, 탭마다 전체 화면 라우트)가 섰다. 그 뒤 **Apple Music 앱의 하단 내비를 기준으로 삼아** 두 가지를 다시 정한다.

1. 검색을 일반 탭으로 두지 않고 **탭 바 오른쪽의 따로 떨어진 원형 버튼**으로 둔다. 누르면 그 원형이 검색 입력창으로 **모핑**한다(탭 바는 홈만 남기고 접힌다).
2. ADR-029가 「채택하지 않음」으로 둔 **스크롤 축소**를 채택한다. 본문을 읽어 내려가면 탭 바가 홈 원형으로 접히고, 오디오를 재생 중이면 오디오 플레이어가 홈과 검색 사이로 줄어들며 옮겨 간다.

모바일 전용이다(처음 기준은 ≤768px, 지금은 폭과 포인터를 함께 본다. ADR-029 §1). 데스크톱은 ADR-029 그대로다(탭 바를 보이지 않고, 헤더와 오버레이를 유지하고, 사이드바는 뒤의 일이다).

## 결정

### 1. 라벨 없는 아이콘 탭 바와 따로 떨어진 검색 원형 (ADR-029 §1을 바꿈)

- 탭 라벨(`.tab-label`)을 없애 **아이콘만** 둔다(접근성은 `aria-label`). 처음 탭 순서는 **홈, 북마크, 노트, 설정**의 넷이었다. `노트`는 뒤의 기능을 위한 **목업**(비활성 `<button aria-disabled>`, 노트패드 아이콘)으로 자리만 잡았다. 1.6.0(2026-06-09)부터 노트 탭은 숨겨 두었고, 지금 탭은 홈, 캘린더(ADR-038), 북마크, 설정이다(`index.html`).
- **검색은 탭에서 뺀다.** 탭 바 오른쪽의 따로 된 원형 버튼(`#tab-search`)이다. 검색 아이콘이 한가운데 있고, FAB와 비슷하다(ADR-029의 「검색=4탭 가운데 하나」를 바꿨다).
- 구조: `#tab-dock`(fixed, 투명) flex 컨테이너가 `#tab-bar`(pill)와 `#tab-search-dock`(검색 원형과 입력)을 묶는다. **탭 바는 오디오 바의 왼쪽 끝, 검색 원형은 오른쪽 끝**에 맞춘다(`#tab-dock` 좌우 `--space-4`와 `justify-content` / `margin-left:auto`로, 오디오 바 `margin:0 --space-4`와 좌우를 맞춘다). `#tab-dock`·`#tab-search-dock`은 보이는 효과가 없는 순수 레이아웃 층이다.

#### 간격과 슬롯 (2026-06-05)

- **탭 바와 검색 사이는 8px**(오디오와 탭 바 사이의 세로 간격과 같다)이다. 이 8px는 오디오 바(`bottom:--tabbar-reserve`)와 탭 dock(`bottom:--space-1`과 높이 60px) 사이의 **세로 간격(72−64=8px)과 같다.** 가로와 세로 여백을 맞춘다. 간격은 **`#tab-bar{margin-right:--space-2}`**로 준다(dock의 기본 gap은 0이고, 쉴 때는 `margin-left:auto`로 오른쪽에 붙인다). 모핑 중 입력과 닫기 사이 간격은 `#tab-dock.searching{gap}`이 맡고, `.searching/.collapsed #tab-bar{margin-right:0}`로 간격이 겹치지 않게 한다. 결과: 홈의 왼쪽 여백과 검색의 오른쪽 여백이 `--space-4`로 같고, 홈과 오디오, 오디오와 검색 사이가 `--space-2`로 같다(줄어든 오디오 바의 `left/right` calc와 같다).
- **탭마다 정사각 슬롯을 정해 둔다.** 각 `.tab-item`을 **명시한 정사각 슬롯**(`width: calc(--touch-target + --space-2*2)` = 바 높이, `flex:0 1 auto`, `min-width:0`)으로 고정하고, `#tab-bar{justify-content:space-between}`로 양 끝 탭을 캡 안쪽에 밀어 넣는다(가운데 탭들은 고르게 나눈다). 슬롯 한 변은 바 높이, 캡 반원의 지름, 검색 버튼의 지름과 같다(모두 60px). 좁은 화면은 flex-shrink와 `.tab-icon-wrap{max-width:100%}`로 이웃을 침범하지 않게 한다.
- **아이콘 크기를 설정 아이콘에 맞춘다.** 톱니(설정) 아이콘 glyph는 24 viewBox의 약 22를 채우는데, 홈, 북마크, 노트, 검색 glyph는 약 15-17만 채워 작아 보였다. 각 아이콘의 `viewBox`를 glyph 경계 상자의 가운데를 기준으로 같은 비율(22/24)로 좁히고, `stroke-width`를 비례해 고쳐(그려지는 폭과 획 굵기가 모두 설정 아이콘과 같다) 눈에 보이는 크기를 맞췄다. 설정 아이콘만 `0 0 24 24`·`stroke-width 1.8`을 그대로 둔다(기준). 원래 path는 그대로 다시 쓴다. 아이콘은 `1.9rem → 1.7rem`(검색 아이콘도 같다)으로 조금 줄였다.
- **dock 크기 토큰(2026-06-07).** 되풀이되던 60px 식(`calc(--touch-target + --space-2·2)`, 약 14곳)을 토큰 **`--dock-control`**(60px)로, 탭 아이콘 1.7rem을 **`--dock-icon`**으로 모았다. 모든 dock 아이콘은 원형 인디케이터(56px) 안에 드는 크기다.
- **모서리는 반원 끝만 쓴다(2026-06-07).** 캡슐은 모두 양 끝이 반원이다(`--radius-pill`). squircle(곡률이 큰 superellipse)은 쓰지 않는다(DESIGN.md §컨트롤).

#### 활성 표시 — 미끄러지는 56px 원형 인디케이터 (2026-06-05)

- **활성 탭과 검색은 56px 원형 인디케이터와 테마색 아이콘으로 보인다.** `.tab-icon-wrap` 지름은 **56px**(`calc(--touch-target + --space-2*2 − --space-1)` = 바 높이 60 − 위아래 2px 여백)이고, 좁은 화면에서 슬롯을 넘지 않게 `max-width:100%`를 둔다. 활성 탭과 검색에 `background: color-mix(--theme 14%, …)` 틴트를 준다(다크 검색은 18%). 아이콘 색은 `--theme`다. 양 끝 인디케이터는 60px 캡 안쪽에 2px 여백으로 자리 잡는다.
- **인디케이터 하나가 탭 사이를 미끄러진다.** HTML `#tab-bar`의 첫 자식이 `<span class="tab-indicator" aria-hidden>`이다. 공유 `.tab-indicator`(56px 원형, `--theme 14%` 틴트와 sheen/inset)가 탭마다의 배경을 대신한다. **구분 탭(division-tab)의 미끄러지는 방식을 따른다**(`positionTabIndicator()` ← `syncTabBarActive()`, 처음 `views-routing.js`에 두었고 지금 `js/app/tabbar.js`에 있다). 활성 탭을 실제로 재서(`offsetLeft/Width`. space-between의 60px 슬롯이라 일정하지 않다) `translateX`로 옮기고, **탭을 옮길 때만 미끄러진다**(`_prevTabIndic`). 처음 보일 때, 크기가 바뀔 때, `prefers-reduced-motion`일 때는 바로 맞춘다. `position:relative` 기준은 `#tab-bar`이고, 아이콘은 `.tab-item{z-index:1}`로 인디케이터(z:0) 위에 둔다.
- **모핑과 축소 중**: `.searching`/`.collapsed`로 탭 바가 홈 원형 캡슐이 되면, `#tab-dock.searching/.collapsed .tab-indicator{opacity:0}`(ID를 포함한 특이도가 인라인과 상관없이 `.is-shown`보다 앞선다)로 인디케이터를 숨긴다. 60px 캡슐 자체가 인디케이터라 원이 두 겹이 되는 것을 피한다. 홈 아이콘은 `--theme`(스킴을 따르는 테마색)로 틴트한다. 검색 라우트(`/search`)와 크기 변경은 JS가 숨기거나 다시 놓는다(`window.syncTabIndicator`).
- **`--theme` 쓰임을 넓힌다.** ADR-028은 테마색을 절 번호, 단락 기호, 모핑 홈(내비 시그니처)으로 한정했는데, 여기에 **내비의 활성 탭과 검색 아이콘**을 더한다(스킴을 따르는 활성 표시).

#### 절제된 리퀴드 글라스 (2026-06-05)

평평하던 하단 chrome에 **약한 글래스 깊이**를 입힌다. 톤은 **절제**(앞에 나서지 않는다)다. 가까이서 보거나 움직일 때만 은은히 드러난다.

- **공유 질감 토큰**: `:root`에 `--glass-sheen`(위에서 투명으로 가는 흰색 그러데이션, 라이트 16%/다크 7%)과 `--glass-inset`(위 하이라이트와 아래 음영 box-shadow)을 더했다. 다크에서는 알파가 저절로 바뀐다. **떠 있는 chrome에 모두 같이** 쓴다. `#tab-bar`·`#tab-search`(와 `.active`), 모핑 입력창(`#tab-dock.searching #tab-search-dock`), 키보드 닫기 버튼, `#audio-bar`, `.tab-indicator`다. 기존 `background`(글래스 틴트) 위에 `--glass-sheen`을 background-image로 겹치고, `box-shadow`에 `--glass-inset`을 덧붙인다(기존 값을 지우지 않는다).
- **글래스 값은 오디오 바와 같다.** 틴트는 `--bg 50%`(라이트와 다크가 같다), `backdrop-filter: blur(12px)`(saturate 없음)다. `#tab-bar`·`#tab-search`(와 `.active` 바탕)·`#tab-dock.searching #tab-search-dock`·`#tab-search-close`에 적용한다. `--glass-sheen`/`--glass-inset`, 테두리, 그림자와 `.active`의 `--theme` 틴트는 그대로다(바탕 틴트만 같게 했다). 다크 덮어쓰기도 `--bg 50%`로 모아 라이트와 같은 식이다.
- **움직이는 요소에는 `backdrop-filter`를 쓰지 않는다.** 글래스가 겹치면 Safari 합성이 불안정하고, 움직일 때 GPU 비용이 든다. 질감은 sheen/inset(정적)과 탭 바 자체의 backdrop blur로 내고, 인디케이터는 `transform`만 움직인다. 그래서 60fps를 지킨다.
- **대체**: `prefers-reduced-transparency` / `@supports not (backdrop-filter)`에서는 `:root{--glass-sheen:none}`(광택을 없앤다)과 기존 솔리드 `--bg-card`를 쓴다. `prefers-reduced-motion`에서는 `.tab-indicator{transition:none}`(미끄러지지 않고 바로 맞춘다). 헤더는 여전히 솔리드다(ADR-025, 상관없다). fixed 요소(`#tab-dock`)는 투명해서 홈 인디케이터 색과도 상관없다.
- **절제와의 관계**: 인디케이터를 잠시 없애 「앵커이지 시그니처가 아니다」로 가던 방향(아래 「검토한 대안」)과는 다르지만, **약하고 움직이지 않는 sheen과 빠짐없는 reduced-* 대체**로 절제의 범위 안에 둔다. 멀리서는 거의 평평하고, 가까이 보거나 움직일 때만 깊이가 드러난다.

#### 북마크 ⋯ 메뉴의 가로 모드 스크롤 (2026-06-10, 후속⁷)

글래스 언어를 쓰는 북마크 뷰의 `.title-action-menu`(⋯ 더 보기, 관리 4-5행, 정렬 5행)에 `max-height`가 없어, **가로 모드의 짧은 화면(예: 높이 390px)에서 9행이 화면 아래로 넘쳐 아래 항목(정렬)을 고를 수 없었다.**

- `overflow-y: auto`(가로는 `overflow-x: hidden`을 두어 모서리를 자른다), `overscroll-behavior: contain`(가장자리 스크롤이 본문으로 새지 않게), `max-height`를 둔다.
- 메뉴는 `position: absolute`로 흐름 안의 헤더(`#page-title`, sticky 아님)에 붙어 있어 실제 top이 방향과 레이아웃에 따라 다르다. 그래서 **열 때 JS가 트리거 버튼의 top에서 화면 아래까지를 정확히 잰다**(`window.innerHeight − 버튼 top − 16px`. 스케일인 transform에 흔들리지 않도록 메뉴가 아니라 버튼을 잰다). CSS `max-height: 80dvh`는 JS 전의 안전한 상한이다.
- **재계산(2026-06-10 추가)**: 열 때 한 번만 재면, 메뉴를 연 채 기기를 돌릴 때 앞 방향의 상한이 남는다. 가로에서 열고 세로로 돌리면 365px 그대로라 **스크롤바가 사라지지 않고**, 세로에서 열고 가로로 돌리면 819px 그대로라 **화면을 넘쳐 아래 항목에 닿지 않는다.** 그래서 계산을 `sizeMenu()`로 묶어 **열 때와, 메뉴가 열려 있는 동안 `resize`마다** 다시 잰다(돌리면 `innerHeight`와 앵커 top이 함께 바뀐다). 리스너는 `openMenu`에서 달고 `closeMenu`에서 뗀다. SPA 내비로 트리거가 떨어지면(`!isConnected`) `sizeMenu`가 스스로 뗀다(기존 문서 리스너의 스스로 정리하는 방식과 같다).
- **함께 생길 문제**: 메뉴가 flex 열이라 내용이 넘치면 flex가 항목을 눌러, 보호 없는 1px 구분선(`.title-action-menu-sep`)이 0으로 무너지고 행도 44px보다 작아질 수 있다. 그래서 구분선과 행 모두 `flex-shrink: 0`으로 고정한다.
- 스크롤바는 **iOS 26 모양**이다. iOS Safari는 네이티브 오버레이 스크롤바(이미 이 모양)를 쓰고 직접 만든 `::-webkit-scrollbar`를 무시하므로, 데스크톱 WebKit/Chromium과 Firefox만 얇은 반투명 pill(트랙 없음, 2px 여백으로 `--radius-xl` 모서리에 닿지 않게)로 맞춘다(`scrollbar-width: thin`과 `scrollbar-color`). 세로 모드는 상한이 넉넉해 스크롤 없이 모두 보인다(회귀 없음).

### 2. frosted glass를 요소에 직접 (ADR-029 §3을 바꿈)

ADR-029는 Safari 26의 홈 인디케이터 색 문제를 피하려고 글래스를 `::before` 층에 얹고 fixed 부모를 투명하게 두었다. ADR-030 구조에서는 **fixed 요소가 `#tab-dock`(투명) 하나뿐**이라 그 걱정이 없어진다. 그래서 **frosted glass(반투명 배경과 `backdrop-filter`)를 `#tab-bar`·`#tab-search` 요소에 직접** 적용한다(`::before` 우회는 지웠다).

- **떠 있는 모양 셋을 맞춘다.** 탭 바 pill, 검색 원형, 오디오 바 모두 `frosted glass + 1px 테두리(--text 8%) + --shadow-2`이고, 높이는 **60px**(`--touch-target 44 + --space-2 ×2`)이다. 테두리가 가장자리를 그어 같은 그림자도 또렷하게 떠 보인다.
- 좌우 모서리는 `--radius-pill`로 모핑할 때의 원형과 맞춘다(#185).
- 대체: `prefers-reduced-transparency` / `@supports not (backdrop-filter)`이면 불투명 표면(모핑 입력 pill, 검색 원형, 탭 바 모두). `prefers-reduced-motion`이면 모핑 트랜지션을 생략한다.
- **scrim 없이 글래스 캡슐만 본문 위에 띄운다(2026-06-06).** 절 선택 액션 바(`#verse-select-bar`, `background:none`)와 같은 방식이다. 본문이 그대로 비쳐 보이는 편이 시야가 가볍다는 사용자 의견과, 두 하단 dock(탭 바, 절 선택 바)의 방식을 맞추기 위해서다. 캡슐 자체의 글래스(blur와 틴트)와, 키보드가 뜰 때 `--kb-overlap`으로 dock이 따라 올라가는 것은 그대로다. 앞서 둔 장식 scrim(`#tabbar-scrim`)은 「검토한 대안」에 있다.

참고: 입력 placeholder와 글자는 본문 Serif를 물려받지 않도록 **Sans**(시스템과 Noto Sans KR)다. placeholder 문구는 페이지 안 검색 입력과 같다(「검색 (예: 사랑, 사랑 in:요한, 창세 1:3)」).

### 3. 검색 모핑 (신규) — `js/app/tabbar.js`

검색 원형을 누르면 `#tab-dock.searching`이 켜진다.

- 홈이 아닌 탭은 `max-width:0 + opacity:0`로 **접히고**, `#tab-bar`는 **60px 원형**(검색 원형과 같은 모양)이 된다. 검색 원형(`#tab-search-dock`)은 **남은 폭을 채우는 입력 pill**로 넓어진다(`flex:1 1 0`과 `min-width:0`. placeholder 길이와 상관없고, 오른쪽으로 넘치지 않는다). 양쪽 방향 모두 CSS 트랜지션이다.
- 입력 pill: 왼쪽 검색 아이콘, 입력, **검색어 지우기(⊗, 글자가 있을 때만, 44px 터치 영역)**, **닫기(X) 원형**이다. 닫기 X는 검색 세션 동안(결과 화면 포함) 남고, 누르면 검색 모드 전체를 되돌린다(`closeSearchToHome`). 쉴 때는 `aria-hidden + tabindex=-1`로 접근성 트리에서 뺀다.
- **하단 입력이 하나뿐인 검색 필드다.** Enter는 기존 `window.commitTopSearch`(절 참조로 저절로 가기 포함), `/search?q=`, `renderSearchResults` 순서로 이어진다. 모핑 중에는 `/search` 전체 뷰의 **위쪽 페이지 안 입력을 `body.tabbar-searching`으로 숨긴다.** Enter를 누르면 입력에서 포커스를 빼 키보드를 내리고 dock을 접는다(세션과 X는 남는다).
- **키보드 처리(visualViewport)**: 입력에 포커스가 있는 동안 `visualViewport` resize/scroll을 따라가며, 키보드 높이만큼 `#tab-dock`을 `translateY`로 올린다(키보드가 입력을 가리지 않게). blur하거나 돌아오면 제자리로 둔다.
- **상태 맞추기와 되돌리기**:
  - 기존 `/search?q=…`에서 모핑을 열면 지금 쿼리를 dock 입력으로 옮긴다.
  - popstate(뒤로/앞으로) 등으로 `/search?q=`가 바뀌면 `syncTabSearchQuery`가 dock 입력을 URL 쿼리에 맞춘다(입력에 포커스가 있으면 덮어쓰지 않는다).
  - **Esc**는 document capture 단계에서 가로채, 결과 링크나 body 어디에 포커스가 있어도 검색 모드 전체를 닫는다(app.js 전역 Esc보다 먼저).
  - 홈 탭 같은 검색 밖 라우트로 가면 `views-routing`의 `syncTabBarActive`가 `window.exitTabSearch`를 호출해 되돌린다.
- **빈 상태**: 결과 0건, 빈 검색어 뷰의 가운데에 빈 상태(돋보기, 제목, 부제)를 둔다.
- **빈 검색 뷰는 「검색 방법」 예시 안내다(2026-06-07).** 제목 「찾고 싶은 말씀을 검색해 보세요」, 한 줄 부제, `이렇게 검색해 보세요` 안내(`사랑`=낱말 / `사랑 in:요한`=책 범위 / `창세 1:3`=장과 절 펼치기)다. 세 형식을 한 문장에 몰지 않고 **예시마다 안내 카드**로 풀었다(북마크 빈 목록 BOOKMARK_ADD_HELP의 설명형 빈 상태를 참고했다). 카드를 누르면 그 예시로 바로 검색한다(`commitTopSearch`). `js/app/search.js` `SEARCH_EXAMPLES`/`buildSearchExamples`, `.search-examples*` CSS(중립 `--accent`. ADR-028의 테마색 범위를 지킨다). 결과 0건 화면의 부제도 다시 해 볼 것을 권하도록 보탰다. 처음에는 부제가 예시 문자열 한 줄(`예: 사랑, 사랑 in:요한, 창세 1:3`)뿐이라 무엇을 넣을 수 있는지 알기 어려웠다.

### 4. 옛 모바일 검색 시트 제거

검색이 탭 바 모핑 하나로 모이면서, **모바일 검색 바텀 시트(`openSearchSheet`/`closeSearchSheet`/`#search-sheet`와 드래그)를 모두 지웠다**(search.js가 크게 줄었다). 데스크톱의 인라인 검색 바와 `/search` 결과 경로는 그대로다. 검색 FAB는 ADR-029에서 이미 지웠다.

### 5. 스크롤 축소와 오디오 미니 모핑 (구현 완료)

**쓰는 조건:** 스크롤 축소는 (1) **오디오북 설정(`loadAudioShow()`)이 켜져 있고** (2) **읽기 화면(`view==="chapter"`·`"prologue"`)**일 때만 한다. 책 목록(`books`·`division`), 장 선택(`chapters`), 검색, 북마크, 설정 화면에서는 아래로 스크롤해도 탭 바를 그대로 둔다(축소와 미니 오디오는 오디오북이 켜져 있고 본문을 읽는 때만이다).

본문을 아래로 스크롤하면(읽어 나가면, 위 조건을 만족할 때):
- `#tab-dock.collapsed`(`.collapsed`): 홈이 아닌 탭을 접고 `#tab-bar`를 60px 홈 원형으로 만든다(검색 모핑과 홈 원형, 탭 접기 CSS를 함께 쓴다). 검색 원형은 오른쪽에 남아 홈과 검색이 양 끝에 선다.
- 오디오가 보이는 중이면(`body.tabbar-collapsed`) 떠 있는 `#audio-bar`가 `position:fixed`로 **홈과 검색 원형 사이의 dock 줄로 줄어들며 옮겨 간다**(60px, 재생 버튼과 진행 바만. `.audio-time`·`.audio-speed-btn`은 숨긴다). 좌우는 `space-4 + 60px + space-2`다.
- **되돌리기**: 맨 위(scrollY≈0)에 닿으면 저절로 되돌리고, 라우트가 바뀌어도 되돌린다. 중간에서 위로 스크롤할 때는 그대로 둔다(깜빡임을 막는다). 검색 모핑 중에는 줄이지 않는다.
- **줄어든 상태에서 홈 탭은 홈으로 가지 않고 「펼친다」.** 탭 바를 되살리고 오디오 미니를 원래 떠 있던 자리로 되돌리며, 읽던 위치를 지킨다(전역 `<a>` 이동을 `preventDefault`로 막는다). 펼친 뒤 다시 아래로 스크롤하면 다시 줄인다.

스크롤 감지는 throttle(rAF)한 scroll 리스너와 `nextScrollCollapsed` 순수 함수(기준 64px, 맨 위 4px)로 한다. 오디오가 `sticky→fixed`로 자리를 바꾸므로 지금 모션은 바로 맞춰지는 스냅이다(부드러운 전환은 뒤의 다듬기).

#### 가로 모드 — 탭 바를 모두 펴 두고 오디오는 dock 미니 (2026-06-10)

§5의 축소는 세로가 기준이다. 탭 바를 홈 원형으로 접고 오디오 미니를 홈과 검색 사이에 끼웠다. 가로는 화면이 넓어(아이폰 가로 ≥568px) 그렇게 접을 필요가 없다는 사용자 의견에 따라 **가로(`orientation: landscape`) 전용 동작을 나눈다**(순수 CSS. JS 스크롤 로직은 그대로이고, `.collapsed`/`body.tabbar-collapsed` 고리를 다르게 읽는다).

- **탭 바를 모두 펴 둔다.** 가로에서는 `.collapsed`(스크롤 축소)의 탭 바 홈 원형 모핑을 되돌려 탭을 모두 편다.
- **검색 모핑에서도 탭 바를 편다.** 처음에는 `.searching`은 입력 폭이 필요하다고 보아 가로에서도 홈 원형으로 두었으나, 가로는 폭이 넉넉하다는 사용자 의견에 따라 `.searching`에도 `.collapsed`와 같이 탭 바를 모두 펴는 되돌림을 적용한다. 검색 입력(`#tab-search-dock` flex:1)은 **탭 바 오른쪽에서 검색까지 남은 자리**(미니 오디오와 이어 읽기 pill이 쓰던 자리)만 채운다. 키보드가 떠도 가로에서는 탭 바를 둔다(세로의 `body.tabbar-keyboard #tab-bar{display:none}`을 가로에서 `display:flex`로 덮는다). 이어 읽기 pill은 검색 중에 `display:none`으로 빠지고 입력이 그 폭을 쓴다.
- **오디오는 dock 줄 미니이고, 컨트롤을 모두 보인다.** 세로 미니가 숨기던 시간과 속도를 가로에서는 보인다(`@media (orientation: portrait)`로 한정한다). 미니는 「펴 둔 탭 바」의 오른쪽에서 검색 사이에 둔다. 탭 바의 실제 폭은 `tabbar.js`가 보이는 탭 수를 세어 `:root --tab-bar-w = N × --dock-control`로 내놓는다. 노트 탭(지금 hidden, 1.7.0 예정)이 켜져 탭이 늘어도 저절로 맞는다(JS가 정하지 않았을 때의 대체는 4탭).
- **넓은 폭(≥641px)은 늘 dock에 둔다.** 미니에 컨트롤이 모두 들어가는 폭이면, 맨 위(줄이지 않은 상태)에서도 오디오가 떠 있는 풀바로 올라가지 않고 **늘 dock 줄**에 머문다(사용자 요청. 세로 높이를 아낀다). 검색 모핑 중(`body.tabbar-searching`)에는 입력창이 dock 줄을 차지하므로 그때만 떠 있는 바로 돌아간다.
- **좁은 폭에서는 차례로 숨긴다.** 폭이 모자라면(옛 작은 아이폰: 가로 568 등) **속도(≤640px), 재생 시간(≤580px) 순서로** 숨겨 진행 바의 최소 길이(`--audio-progress min-width: 6rem`)를 지킨다. 좁은 폭에서는 맨 위에서 떠 있는 풀바(컨트롤 모두)를 두고, 줄일 때만 미니다.
- 기준값(640/580px, 진행 바 6rem)은 진행 바 최소 길이와 컨트롤 폭으로 셈한 값이라, 실기기에서 확인한 뒤 고칠 수 있다. 권위 문서 `DESIGN.md` §7에 반영했다.

### 6. 되돌리기와 키보드 입력 — 정한 갈림길

- **줄어든 상태를 되돌리는 것은 맨 위에서 저절로, 그리고 홈 탭(펼치기)이다.** 처음 안은 「홈 탭으로만」이었는데, dev에서 확인한 뒤 바꿨다. 맨 위에 닿으면 저절로 되돌리는 것이 자연스럽고, 홈 탭은 홈 이동이 아니라 펼치기로 하나로 모았다. iOS Safari 식의 「위로 스크롤하면 바로 되돌리기」는 끝에서 깜빡일 수 있어, **맨 위에서만** 저절로 되돌리고 중간에서 위로 스크롤할 때는 그대로 두는 것으로 절충했다.
- **검색 입력은 하단 입력창에서 바로 검색하고, visualViewport로 키보드 위에 띄운다.** iOS가 포커스를 받은 입력을 키보드 위로 올리려고 페이지를 미는 문제는 **포커스를 줄 때(focus) `scrollTo(0,0)`과 `preventScroll`**로 상쇄하고, **X(키보드 내리기)를 보이고 홈을 숨기는 것은 입력의 focus/blur**에 묶어(visualViewport 높이 감지가 불안정한 것을 피한다) 안정시켰다.
- **검색 버튼을 누르면 키보드가 바로 뜬다(2026-06-07).** 검색 원형 버튼을 눌러 모핑에 들어갈 때 dock 입력의 `focus()`를 `requestAnimationFrame` 안에서 호출하고 있었다. 그런데 iOS Safari는 프로그램으로 호출한 `focus()`가 **사용자 동작(탭 핸들러)과 같은 동기 실행 턴** 안에서 호출될 때만 소프트 키보드를 띄운다. rAF로 미루면 동작의 연결이 끊겨, 입력에 포커스는 가도 키보드가 뜨지 않았다(검색 화면만 열리고, 키보드는 입력을 한 번 더 눌러야 나왔다). `openSearch()`는 `#tab-search` 클릭 핸들러에서 동기로 호출되고(그 안의 `navigate`도 동기), 입력은 `hidden=false` 뒤 같은 함수 안에서 다루므로, rAF를 지우고 **`$searchInput.focus({ preventScroll: true })`를 동기로** 호출해 같은 동작 턴에 머물게 했다. `renderSearchView`는 `body.tabbar-searching`(navigate 전에 켠다)일 때 페이지 안 입력의 autofocus를 끄므로 dock 포커스를 빼앗지 않는다. 이미 검색 중일 때 다시 들어오는 분기도 같은 동기 focus라 일관된다. 키보드 위치 보정(`liftForKeyboard`/`--kb-overlap`)과 X 표시 조건은 그대로다.

## 검토한 대안

- **검색을 4탭 가운데 하나로 두기(ADR-029 처음 안)**: Apple Music 방식(따로 떨어진 원형과 모핑)과 어긋나고, 입력을 넓히는 모션을 줄 자리가 없다. 따로 떨어진 원형을 채택했다.
- **글래스를 `::before`에 두기**: ADR-030 구조에서는 fixed 부모가 `#tab-dock`(투명)뿐이라 필요 없는 층이다. 요소에 직접 적용해 단순하게 했다.
- **검색 입력을 위쪽으로 넘기기**: 키보드에 가리지 않아 안전하지만, Apple Music에 충실함과 모핑의 일관성이 떨어진다. 하단 입력과 visualViewport를 채택했다. 모핑은 연출만 하고 입력은 `/search` 위쪽으로 넘기는 안이었다.
- **위로 스크롤하면 바로 되돌리기(전 구간에서 방향 감지)**: 끝에서 깜빡일 수 있어 채택하지 않았다. **맨 위에 닿을 때만** 저절로 되돌리고 중간에서 위로 스크롤할 때는 그대로 두는 것으로 절충했다.
- **활성 표시의 앞선 모양들 (2026-06-05, 같은 날 여러 번)**: 오늘의 「미끄러지는 56px 원형 인디케이터」(§1)에 이르기까지 같은 날 여러 번 바꿨다. 모두 채택 안 함 2026-06-05다.
  - 처음 인디케이터는 `.tab-icon-wrap`의 `3rem × 44px` stadium이었고, 활성 탭과 검색에 `--accent` 14% 배경 틴트를 주었다. 이것을 `44px × 44px` 정사각(+`--radius-pill`)으로 바꿔 **원형**으로 만들고, 검색 원형과 모핑 원의 모양 언어를 맞췄다. 같은 날(2026-06-05) 모핑할 때 홈 캡슐 안의 인디케이터를 지우고(`background:none`) 홈 아이콘을 `--theme`로 틴트했다. 그러나 `44px` 고정 인디케이터 안에서 아이콘이 비좁게 느껴졌다.
  - 그래서 **인디케이터를 바 높이까지 키웠다.** `#tab-bar` 위아래 패딩을 0으로 하고(높이 60px 명시), `.tab-icon-wrap`을 `height:100% + aspect-ratio:1`(+ 좁은 화면에서 이웃을 침범하지 않게 `max-width:100%`)로 바꿨다.
  - 이때 탭 배치는 「탭 바=왼쪽 끝 / 검색=오른쪽 끝(`margin-left:auto`)」이었는데, 짧은 4탭 pill과 오른쪽 검색 사이의 **빈 가운데가 너무 넓어** 보였다. 그래서 `#tab-bar`를 `flex:1`로 늘려 검색 원형 바로 앞까지 채우고, `#tab-dock`에 `gap:--space-2`(8px)만 남겼다. 아이콘은 `.tab-item{flex:1}`(고른 칸)으로 나누고, 넓은 화면에서 칸이 `max-width` 상한에 닿으면 `justify-content:space-between`이 펼쳤다(좁은 폰에서는 효과가 없다).
  - 그러자 `.tab-item{flex:1}`(고른 칸)이라 끝 아이콘이 칸 가운데에 놓여, 양 끝 인디케이터와 pill의 둥근 캡 사이에 **초승달 모양 틈**이 남았다. `.tab-item`을 `flex:0 1 auto`(인디케이터=바 높이 폭의 내용 탭)로 바꾸고 `#tab-bar{justify-content:space-between}`로 양 끝 탭을 캡 안에 밀어 넣었다. 또 `#tab-dock{gap:--space-2}`가 dock의 **마지막 자식 `#tab-search-close`**(키보드 전용, 쉴 때 `width:0`)와 `#tab-search-dock` 사이에도 끼어, 검색 원형이 8px 왼쪽으로 밀렸다(검색 오른쪽 여백 24px ≠ 홈 왼쪽 여백 16px). 그래서 dock의 기본 gap을 지우고 간격을 `#tab-bar{margin-right:--space-2}`로 옮겼다(§1 「간격과 슬롯」).
  - 다음으로 `.tab-item{flex:0 1 auto}`와 `.tab-icon-wrap{height:100% + aspect-ratio:1 + max-width:100%}` 조합이 flex 내용 크기 계산과 얽혀, 실제로는 **가로로 눌린 타원** 인디케이터와 불안정한 슬롯 폭이 되었다(오른쪽 검색 근처 레이아웃이 흐트러졌다). 그래서 슬롯을 명시한 정사각으로 고정하고(§1), `.tab-icon-wrap`은 `width:100% + aspect-ratio:1`로 슬롯 폭에서 높이를 끌어내 **늘 1:1 원**이 되게 했다(`height:100%`/`max-width:100%`에 기대지 않는다).
  - 그 뒤 **인디케이터를 아예 없애고** 활성을 **아이콘 색 = `--theme`**로만 보였다(더 가벼운 내비 언어). `.tab-item.active`/`[aria-current]`와 `#tab-search.active` 모두 배경 틴트를 지우고 `color: var(--theme)`을 주었다(`.tab-item` 60px 정사각 슬롯은 그대로 두고 배경만 지웠다. 죽은 `background:none` 규칙도 정리했다). 그러나 활성 탭의 눈에 띄는 기준점과 누를 자리의 단서가 약해, **56px 원형 인디케이터를 테마색 틴트로 되살렸다**(`.tab-icon-wrap` 지름을 슬롯 채움에서 56px로 줄이고, 아이콘 색은 그대로 `--theme`)(「앵커이지 시그니처가 아니다」, 반짝임을 피하는 방향이었다). 모핑 홈은 60px 캡슐 자체가 인디케이터라 `background:none`으로 원이 두 겹이 되는 것을 피했다.
  - 마지막으로 활성 인디케이터를 **탭마다의 배경**(`.tab-item.active .tab-icon-wrap{background}`)에서 **공유하는 미끄러지는 요소**로 바꿨다(§1).
- **하단 chrome의 처음 글래스 값 (2026-06-05까지)**: 탭 바, 검색, 모핑 입력창, 키보드 닫기 버튼은 오디오 바와 다른 글래스 값을 썼다(틴트 `--bg 62%`(라이트)/`--bg-card 72%`(다크)와 `backdrop-filter: blur(16px) saturate(180%)`). ADR-029의 「읽기 쉽도록 조금 더 불투명」이라는 뜻이었다. 채택 안 함 2026-06-05(후속⁶) · 이유: 같은 떠 있는 chrome끼리 투명도와 blur가 달라, 나란히 떴을 때 질감이 어긋났다. 오디오 바의 값으로 하나로 모았다(§1).
- **`corner-shape: superellipse(2)` (2026-06-07까지)**: 처음 §2는 「좌우 모서리는 `--radius-pill` + `corner-shape: superellipse`로 모핑할 때의 원형과 맞춘다」였고(#185), 모서리에 `corner-shape: superellipse(2)`를 9곳에 두었다. 채택 안 함 2026-06-07 · 이유: `superellipse(2)`는 **지수 2 = 정원(원호)**이라 squircle이 아니고 기본 `round`와 같다. 9곳을 모두 지우고 **`--radius-pill`/`border-radius`만으로 반원과 정원 끝**을 지켰다(보이는 변화는 없다). 지금은 `--radius-pill`만 쓴다(처음의 `--radius-pill` + `corner-shape: superellipse`). 이 ADR과 ADR-029의 `corner-shape`와 「squircle」 언급은 그때의 기록이다.
- **탭 dock 뒤의 장식 scrim (2026-06-04부터 06-06까지)**: 떠 있는 캡슐(`#tab-bar`·`#tab-search`·미니 오디오)이 투명한 `#tab-dock` 위에 떠 있어, 캡슐 **양옆 틈과 아래 틈**으로 스크롤되는 본문이 그대로 보여 지저분했다. 그래서 dock 바로 아래에 화면 폭 전체의 **옅어지는 그러데이션 scrim**(`#tabbar-scrim`, 순수 장식 `aria-hidden`)을 깔아 본문을 배경색으로 녹였다.
  - 처음에는 `--scrim-solid`(=캡슐 윗변)까지 솔리드 `--bg`로 캡슐을 **모두 가렸다.** 그러면 캡슐 뒤가 솔리드 `--bg`라 탭 바와 검색의 글래스 투명도(70→62% / 80→72%)가 (특히 라이트에서) 뜻이 없었다. 그래서(2026-06-05) 솔리드는 **캡슐 아래와 바닥 모서리(`--scrim-solid`)에만** 두고, 캡슐 자리에서는 옅어짐이 지나가게 했다.
  - 옅어짐이 끝나는 곳은 처음 `--scrim-fade-top`을 `--tabbar-reserve + 3rem`(캡슐 윗변보다 한참 위)에 두었다가, 캡슐 위가 휑해 **캡슐 윗변 위 ¼**로 정했다(`--scrim-fade-top = pill 밑변 + pill 높이 × 1.25`, 밑변 `--space-1`+safe, 높이 `--touch-target`+`--space-2`×2 = 60px). 옅어짐 기준은 오디오와 상관없이 늘 탭 바 캡슐 윗변이었다(`--scrim-fade-top` 기본 규칙). 오디오가 보일 때는 한때 오디오 바 기준(`--tabbar-reserve + 1.25 × 3.5rem`)으로 올렸으나, 오디오가 있고 없음에 따라 높이가 출렁여 늘 탭 바 캡슐 윗변 기준으로 고정했다.
  - 얇은 `backdrop-filter: blur(8px)`를 `::before`에 얹고 mask로 맨 위를 옅게 했다(`prefers-reduced-transparency: reduce`에서는 blur를 껐다). blur나 `backdrop-filter`를 지원하지 않는 브라우저에서는 그러데이션만으로 동작했다. `--bg` 토큰을 따라 다크와 라이트에 저절로 맞았다. z-index 9로 하단 chrome(오디오 바 z:10, `#tab-dock` z:`--nav-z` 30) **아래**, 스크롤 내용 위에 두었다. 쌓임은 content < `#tabbar-scrim`(9) < `#audio-bar`(10) < `#tab-dock`(30)였다. 키보드가 `--kb-overlap`(visualViewport)으로 dock을 올리면 scrim도 `bottom: var(--kb-overlap)`로 함께 올렸고, 이를 위해 `tabbar.js`가 `--kb-overlap`을 `#tab-dock` 인라인이 아니라 **`:root`(documentElement)**에 두었다.
  - 채택 안 함 2026-06-06 · 이유: 본문이 그대로 비쳐 보이는 편이 시야가 가볍다는 사용자 의견과, 절 선택 바와 방식을 맞추기 위해 scrim을 코드, DOM 요소, `--scrim-*` 토큰까지 모두 지웠다(§2). `--kb-overlap`을 `:root`에 두는 것은 그대로다(scrim이 없어져 이유 하나만 사라졌다).
- **빈 검색에서 모핑 pill 맨 앞을 돋보기로, 가로 검색 모핑에서 홈 원형으로**: 앞의 것은 ADR-033에 있다. 뒤의 것은 처음에 `.searching`이 입력 폭을 필요로 한다고 보아 가로에서도 홈 원형으로 두었다가, 2026-06-10 후속에서 탭 바를 펴 두게 바꿨다(§5 「가로 모드」).

## 구현 메모

- 새 모듈 `js/app/tabbar.js`(`// @ts-check`과 JSDoc, ESM). `window.exitTabSearch`·`syncTabSearchQuery`·`resetTabCollapse`를 내놓고, search.js가 `window.commitTopSearch`를 내놓는다. SW 미리 넣기(`sw.js` SHELL_FILES)에 tabbar/citations/parallels를 더했다.
- CSS는 `css/style.css`의 탭 바 블록과 `#tab-dock.searching`/`.collapsed` 모핑 규칙(홈 원형과 탭 접기를 함께 쓴다)이다. 모션 토큰 `--duration-base`/`--ease-standard`, reduced-motion 분기를 둔다.
- 키보드(`KEYBOARD` 블록: `keyboardOverlap`/`setKeyboardState`/`liftForKeyboard`)와 스크롤 축소(`SCROLL` 블록: `nextScrollCollapsed`)는 순수 함수로 잘라 유닛으로 검증한다(`tests/unit/tabbar.test.js` 12 케이스). 전체 유닛 578, tsc 0(그때 수).
- 라우팅과 DOM이 많은 내비와 모핑은 e2e가 맡는다(ADR-013). 옛 검색 시트 e2e는 지웠다.
- **dev와 로컬 테스트 편의**: dev와 localhost에서는 SW가 shell(JS/CSS/HTML)을 network-first로 내준다(버전이 고정되어 SHELL_CACHE가 바뀌지 않아 생기는 낡은 캐시를 피한다). PWA와 오프라인은 그대로이고, 운영은 cache-first 그대로다.

## 후속

- 오디오 미니 모핑의 모션 다듬기(`sticky→fixed` 자리 전환의 스냅을 부드러운 전환으로).
- 데스크톱 사이드바(약 1024px 이상)는 ADR-029 §6의 뒤의 일로 남는다.

## 적용 확장

- **절 선택 액션 바 형식 맞추기 (2026-06-06).** 절 선택 모드의 하단 바(`#verse-select-bar`)를 이 ADR의 탭 dock 형식(떠 있는 글래스 캡슐과 아이콘만)으로 바꿨다. 투명 flex dock에 `[아이콘 글래스 pill] + [취소 글래스 원형]`을 두고, 수는 캡슐 위에 뜬 칩이다. 글래스 값(`--glass-sheen`/`--bg 50%`/`blur(12px)`/`--shadow-2`/`--glass-inset`/`--radius-pill`)과 60px 치수를 그대로 함께 쓴다(처음에는 `superellipse(2)`도 함께 썼다). 북마크, 복사와 노트 자리(placeholder)가 있다. 결정과 구현의 세부는 **ADR-010 §절 선택 바 개정 (2026-06-06)**에 있다.
- **이어 읽기 배너를 가로에서 dock pill로 (2026-06-10).** 책 목록 뷰의 이어 읽기 배너(`.resume-banner`, sticky 그룹의 헤더 아래 가로 띠)를 **가로 모드에서만** 하단 dock 줄로 내린다. 가로에서는 헤더, 배너 띠, 탭이 세로로 쌓여 본문을 많이 가린다는 의견 때문이다.
  - `position: fixed`로 미니 오디오와 같은 자리(탭 바 오른쪽에서 검색 사이, `--tab-bar-w`를 다시 쓴다)에 `--radius-pill`과 60px(`--dock-control`) pill로 띄운다. 배너는 책 목록 뷰, 오디오는 chapter 뷰 전용이라 같은 dock 자리를 다른 뷰에서 함께 쓰며 부딪치지 않는다.
  - 테마색 솔리드 채움은 유지한다(주요 행동 CTA를 강조하고, 글래스 캡슐 사이에서 색 있는 pill로 도드라진다). 닫기 ×는 세로 구분선을 없애고 크기를 키우며(`--font-2xl`), 버튼 폭을 `--dock-control`(60px)로 두어 × 가운데를 오른쪽 반원 캡의 가운데(오른쪽 끝 −30px)에 맞춘다.
  - 순수 CSS(`@media (orientation: landscape)`와 mobile 조건)이고, 세로는 바뀌지 않는다.
  - **함정: `#tab-dock`이 클릭을 가로챈다.** 이어 읽기 pill은 DOM에서 `#tab-dock`보다 앞이고 z-index가 같아(`--nav-z`), 투명한 `#tab-dock`(폭 전체의 레이아웃 층)이 빈 가운데에서 pill(링크와 ×) 클릭을 먹어 **이어 읽기와 닫기가 모두 작동하지 않았다.** `#resume-banner-slot{z-index:10}`의 쌓임 맥락이 pill의 z를 가둬 z-index만으로는 벗어날 수 없다. 그래서 **`#tab-dock{pointer-events:none}`으로 두고 실제 컨트롤(`#tab-bar`·`#tab-search-dock`·`#tab-search-close`)만 `pointer-events:auto`**로 되살려, 빈 가운데 클릭이 아래 pill로 지나가게 한다(가로 한정). 미니 오디오는 DOM에서 `#tab-dock` 뒤라 우연히 영향이 없었다.
  - **검사(Bugbot 후속):** 지나가게 하는 것은 pill이 실제로 dock에 있을 때만 켠다. `body:has(#resume-banner-slot .resume-banner):not(.tabbar-searching)` 선택자로 그때만 적용한다. 배너 없는 책 목록이나 다른 가로 뷰에서는 dock이 빈 가운데 누름을 그대로 받는다(쓸데없이 지나가게 하지 않는다). 또 **검색 모핑(`.tabbar-searching`) 중에는** 검색 입력이 dock 줄을 채우므로 pill을 숨기고(`body.tabbar-searching .resume-banner{display:none}`), dock pill 적용도 `body:not(.tabbar-searching)`로 뺀다. 가로 오디오 바의 `body:not(.tabbar-searching)` 조건과 같은 뜻이다(입력과 pill이 부딪치지 않게).
