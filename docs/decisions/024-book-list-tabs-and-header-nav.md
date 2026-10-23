# ADR-024: 성서 목록 탭 통합 + 읽기 헤더 내비게이션 재설계

- 일시: 2026-05-29
- 상태: 승인됨 — 구현 완료
- 관련 ADR: ADR-009(History API 라우팅과 구분 URL 색인), ADR-018(`js/app/views-routing.js`·`settings-ui.js` 모듈 위치), ADR-023(설정 토글), ADR-029(모바일 하단 탭 바), ADR-034(`views-routing.js` 2차 분할)

## 맥락

성서 목록은 네 화면에 흩어져 있었다.

- `/`: 첫 페이지. 구약, 외경, 신약의 세 구분을 `<details>`로 한꺼번에 펼쳐 보여 주었다.
- `/old_testament` · `/deuterocanon` · `/new_testament`: 구분별 페이지. 헤더 제목에 구분을 고르는 팝오버(`setTitleWithDivisionPicker`)가 있었다.

네 화면은 사실상 같은 책 목록을 보여 주는데, 들어가는 경로와 그리는 코드가 갈라져 있어 유지보수가 번거롭고 화면 전환도 매끄럽지 않았다. 모바일 OS 앱의 관행대로 **탭으로 바꾸는 한 페이지**로 합친다.

또 본문(장), 머리말, 장 목록 헤더의 왼쪽 버튼은 브라우저의 *뒤로 가기*(히스토리 기반)였고, 화면 위쪽에 따로 브레드크럼(`목록 › 구약`)이 있었다. 목록을 한 페이지로 합치면 브레드크럼은 겹치는 정보가 된다. 왼쪽 버튼도 「한 단계 뒤」보다 **책 목록으로 가는 홈 버튼**이 더 자연스럽다.

## 결정

### 1. 탭 한 페이지 — `renderBookList(books, activeDivision)`

`/`와 세 구분 라우트를 모두 이 함수 하나로 그린다. 다른 것은 활성 탭뿐이다. 함수는 지금 `js/app/views.js`에 있다(ADR-034).

- 탭은 구분이다. 어떤 탭이 있는지는 **외경(book-order) 설정**을 따른다(`divisionOrder()`).
  - canonical: `구약 | 외경 | 신약` (3탭)
  - vulgate: `구약 | 신약` (2탭. 외경은 구약 탭에 들어간다, `effectiveDivision()`)
- 탭은 구분 라우트(`/old_testament` 등)로 가는 `<a>`다. 그래서 딥링크, 검색 엔진 색인(SEO, ADR-009), `sitemap.xml`, 읽기 헤더 홈 버튼의 목적지가 그대로 유효하다.
- `/`로 들어오면 첫 탭(구약)을 활성화한다. vulgate 모드의 `/deuterocanon`은 전처럼 `/old_testament`로 보낸다(리다이렉트).
- 탭 줄은 `display:flex`에 각 탭 `flex:1 1 0`로 **가로 폭을 꽉 채운다**.
- **탭은 화면 위에 고정한다(sticky).** 구분 탭을 `#app` 본문에서 떼어 `#sticky-group` 안(이어 읽기 배너 슬롯 아래)의 **새 슬롯 `#division-tabs-slot`**으로 옮겼다. 헤더, 배너와 한 sticky 블록이 되어, 스크롤해도 헤더 아래에 고정되고 배너가 있으면 그 아래에 붙는다. `renderBookList`가 슬롯에 탭을 넣고, `route()`가 이동할 때마다 `#division-tabs-slot` · `#resume-banner-slot`을 비운다. sticky 블록의 슬롯 좌우 여백으로 본문이 비쳐 보이지 않도록 `#sticky-group { background: var(--bg) }`를 더했다.
- **활성 탭은 미끄러지는 표시(인디케이터)로 보인다.** 탭 하나 폭의 칩(`.division-tab-indicator`)을 깔고 `translateX`로 탭 사이를 미끄러지게 한다(`transition: transform`). `buildDivisionTabs`가 직전 활성 탭 번호(`_prevDivisionIdx`)를 기억해 **이전 탭에서 새 탭으로** 움직인다(double rAF, `prefers-reduced-motion`을 따른다). 인디케이터의 시작 위치와 `--tab-count`는 **CSSOM(`.style`)**으로 정한다. 앱 CSP `style-src`에 `'unsafe-inline'`이 없어 `style` 속성은 막히지만, 프로그램으로 `.style`을 고치는 것은 허용되기 때문이다. 인디케이터는 `nav`의 첫 자식이므로, `DIVISION_TABS` 유닛 테스트는 앵커만 골라 확인한다.
- **인디케이터는 트랙 위에 떠 있는 칩이다(2026-05-30).** `.division-tab-indicator`는 `background: var(--bg-card)`(트랙과 같은 색)에 `border: 1px solid var(--border)`(테마색이 아닌 중립 윤곽)를 두고, 그림자로 트랙 위에 떠 있는 입체감을 준다(iOS 세그먼트 컨트롤의 느낌). 그림자는 처음에 `box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.08)`로 적었고, 지금은 `--shadow-1` 토큰을 쓴다. 다크 테마는 그림자가 묻히므로 칩 배경을 트랙보다 조금 밝게(`color-mix(... #fff 8%)`) 하고, 그림자는 토큰이 다크에서 짙어진다. 윤곽선을 처음의 `border: 2px solid var(--accent)`에서 중립색으로 바꿨을 뿐, 미끄러지는 transform과 `_prevDivisionIdx` 애니메이션은 그대로다.
- 활성 탭과 마우스를 올린 탭의 글자색은 `var(--accent)`가 아니라 색조 없는 중립 회색(라이트 `#222222` / 다크 `#e6e6e6`)이다. 떠 있는 칩이 선택을 보여 주므로 글자에는 테마색을 쓰지 않는다. 남색 기가 도는 `var(--text)` 대신 색조 없는 회색(hueless grey)을 직접 정한다. 비활성 탭은 `var(--text-secondary)`다.
- **구약도 소분류 없이 한 목록으로 그린다(2026-05-29).** 구약을 오경, 역사서, 시서와 지혜서, 예언서로 묶던 `OT_SUBCATEGORY{,_ORDER,_LABELS}`와 `.ot-subcategory{,-title}` CSS를 지우고, 세 탭 모두 같은 `.book-list` 그리드 하나로 그린다. 탭 사이의 레이아웃을 같게 하기 위해서다.

`renderDivisionList` · `setTitleWithDivisionPicker` · 헤더 브레드크럼(`setBreadcrumb` / `buildDivisionBreadcrumb`)은 지웠다. 새 순수 빌더 `buildDivisionTabs(activeDivision)`는 `DIVISION_TABS` 마커 블록으로 유닛 테스트한다.

### 2. 읽기 헤더 홈 버튼 — `buildHomeBtn(target, ariaLabel)`

장, 머리말, 장 목록 헤더의 왼쪽 버튼을 *뒤로 가기* 대신 **홈 버튼**으로 바꾼다. `history.back()`이 아니라 늘 `navigate(target)`로 이동한다. 목적지는 **그 책이 속한 구분 탭**(`/${effectiveDivision(book)}`)이다. 방금 보던 책과 같은 구분의 책 목록이 바로 보여 맥락이 이어진다. 검색 결과 헤더의 홈 버튼만 첫 페이지(`/`)로 간다.

**도착한 책 목록에서는 방금 읽던 책에 포커스를 둔다(2026-06-07).** 홈 버튼(`buildHomeBtn`)을 눌러 그 책의 구분 탭(`/${division}`)으로 올라갔을 때의 일이다. 긴 목록의 맨 위가 아니라 읽던 자리에 키보드 포커스를 두어, 다음 탐색이 자연스럽게 이어지게 한다(접근성). 구현은 다음과 같다.

- `buildHomeBtn(target, ariaLabel, focusBookId)`의 세 번째 인자로 책 id를 받는다. 누르면 `setPendingBookFocus(id)`로 한 번만 쓰는 대기 값을 세운 뒤 `navigate(target)`로 이동한다.
- `renderBookList`가 그린 직후 `focusPendingBook()`으로 그 값을 쓴다. `.book-list a[data-book-id="…"]` 항목에 `focus({preventScroll:true})`를 하고, sticky 헤더에 가리지 않게 `scrollIntoView({block:"center"})`로 가운데에 둔다.
- 대기 값은 쓰자마자 비운다. 그래야 보통의 탭 이동이나 뒤로 가기가 낡은 포커스를 물려받지 않는다.
- 홈 버튼 이동은 PUSH라 ADR-031의 스크롤 복원(POP과 탭 전환만)과 상관없다. 그래서 `scrollIntoView`가 그대로 남는다.
- 책 목록 앵커에 `data-book-id` 식별자를 더했다. 라우팅과 포커스는 e2e가 확인한다(`test_navigation.py` `test_home_btn_focuses_book_just_read`).

모바일(폭 768px 이하이거나 터치 포인터)에서는 ADR-029의 하단 탭 바가 성서 목록으로 가는 길을 맡으므로, 헤더의 홈 버튼(`.title-home-btn`)을 숨긴다(2026-06-04부터).

### 3. 위쪽 브레드크럼 제거

`<nav id="breadcrumb">`와 모든 `setBreadcrumb(...)` 호출, 관련 CSS(`#breadcrumb`, `.bc-division-*`)를 지웠다. 위쪽 행(`#breadcrumb-row`)에는 이제 검색바와 설정만 있다.

### 4. 설정(⚙) 버튼 — 화면 폭에 따른 배치

`#breadcrumb-row`는 스크롤하면(헤더 compact) 접혀 사라진다. 데스크톱과 모바일에서 필요한 것이 달라 다음처럼 나눴다.

- **데스크톱(≥769px)**: 설정은 전처럼 위쪽 행(`#settings-anchor`)에 검색바와 나란히 둔다. 스크롤하면 검색바와 함께 접히는 지금 동작을 유지한다.
- **모바일(≤768px)**: 처음에는 위쪽 행을 통째로 숨기고(검색은 FAB), 설정을 **늘 보이는 제목 헤더(`#page-title`)**로 옮겨 읽는 중에도 열 수 있게 했다. 제목 행은 라우트마다 다시 그려지므로, 각 뷰가 `buildSettingsTrigger()`로 새 트리거를 넣는다. 팝오버 하나를 여러 트리거가 함께 쓴다(`wireTrigger`). 2026-06-04부터는 ADR-029의 하단 탭 바가 모바일 설정을 맡아, 제목 헤더의 설정 버튼(`.title-settings-btn`)도 숨긴다. 그래서 지금은 어느 화면 폭에서도 제목 헤더의 설정 버튼이 보이지 않는다(known-issues §27).

CSS 미디어 쿼리로 둘 가운데 하나만 보이게 했다(`.title-settings-btn` ↔ `#settings-anchor`).

**북마크 버튼은 제목 행의 오른쪽 끝에 둔다.** 데스크톱에서는 설정 기어가 위쪽 행에 있어 제목 행 기어(`.title-settings-btn`)가 숨으므로, 북마크 버튼(`.title-bookmark-btn`)을 `@media (min-width: 769px)`에서 `right: 0`(맨 오른쪽)으로 보냈다. 모바일은 처음에 `right: 2.4rem`(설정 버튼 왼쪽)이었고, 설정 기어가 탭 바로 옮겨 간 뒤 2026-06-05부터 모바일도 `right: 0`이다(ADR-029, ADR-030 후속).

### 5. 모바일 헤더 고정 — 오버스크롤

iOS Safari는 페이지 끝에서 고무줄처럼 늘어나는 오버스크롤 때 문서 전체를 움직여(translate), `position: sticky` 헤더도 함께 끌려 움직인다. `html, body { overscroll-behavior-y: none }`로 튕김을 없애 헤더를 앱 셸처럼 고정한다(데스크톱에는 영향 없음).

## 대안

- **탭을 URL 변경 없이 화면에서만 바꾸기**: 구분 딥링크, SEO, 읽기 헤더 홈 목적지가 깨진다. 채택 안 함.
- **홈 버튼을 늘 `/`(첫 탭)로**: 신약 책을 읽다 나오면 구약 탭으로 떨어진다. 책의 구분 탭으로 보내는 편이 맥락을 잇는 데 낫다(사용자 선택).
- **모든 화면 폭에서 설정을 제목 헤더로**: 데스크톱은 위쪽 행에 여유가 있고, 지금의 스크롤 접힘 동작을 유지하고 싶다는 요구로 채택 안 함.
- **활성 탭을 accent 배경으로 칠하기 (2026-05-29, 같은 날까지)**: 처음 결정은 활성 탭에 accent 배경을 칠하는 것이었다(`.division-tabs` / `.division-tab.active`). 채택 안 함 2026-05-29 · 이유: 승인한 날 UI를 다듬으며, 탭 사이를 미끄러지는 인디케이터로 바꿨다(위 1).
- **테마색 윤곽선 인디케이터 (2026-05-29부터 05-30까지)**: 인디케이터를 테마색 윤곽선 상자(`border: 2px solid var(--accent)`에 옅은 accent 틴트 배경)로 그렸다. 채택 안 함 2026-05-30 · 이유: 트랙과 같은 표면색의 떠 있는 칩으로 바꿨다(iOS 세그먼트 컨트롤의 느낌, 위 1). 칩이 선택을 보여 주므로 글자색에서도 테마색을 뺐다.
- **구약 소분류 유지 (2026-05-29, 같은 날까지)**: 처음 결정은 구약 탭에서 기존 소분류(오경, 역사서, 시서와 지혜서, 예언서)를 유지하는 것이었다. 채택 안 함 2026-05-29 · 이유: 세 탭의 레이아웃을 같게 하려고 소분류를 지웠다(위 1).

## 영향

- 변경: `js/app/views-routing.js`(탭 그리기, 홈 버튼, 브레드크럼 제거), `js/app/bookmark.js`(`buildHomeBtn`), `js/app/settings-ui.js`(여러 트리거가 함께 쓰는 팝오버 + `buildSettingsTrigger`), `js/app/search.js`(브레드크럼 제거, 홈 버튼), `index.html`(브레드크럼 노드 제거), `css/style.css`, `js/types.d.ts`. `views-routing.js`의 화면 코드는 지금 `js/app/views.js`에 있다(ADR-034).
- 유닛 테스트: `BREADCRUMB` 블록을 `DIVISION_TABS` 블록으로 바꾸고, `setTitleWithDivisionPicker` 테스트를 지우고, 장 picker 홈 버튼 확인으로 고쳤다.
- 데이터, 서비스 워커, 라우트 경로 자체는 바뀌지 않는다. 기존 구분 URL 그대로다.
