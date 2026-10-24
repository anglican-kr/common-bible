# ADR-031: 탭 히스토리 — 탭별 위치 복원

- 일시: 2026-06-05
- 상태: 승인됨 — 구현 완료(2026-06-05, §5는 2026-10-17)
- 관련 ADR: ADR-029(모바일 탭 바. 탭마다 전체 화면 라우트 뷰), ADR-030(모핑 탭 바. 따로 떨어진 검색 원형 버튼과 스크롤 축소), ADR-015(스토리지 전략), ADR-014(검색 히스토리), ADR-038(캘린더와 전례독서. §5의 포커스를 처음 쓴 화면)

## 맥락

ADR-029/030으로 모바일 하단 탭(홈, 북마크, 설정과 따로 떨어진 검색 원형 버튼)이 자리 잡았지만, 각 탭은 **상태를 기억하지 않는 단순한 라우트**였다. 특히 홈 탭 버튼은 고정된 `href="/"`라서, 성서를 읽다가(`/john/3`) 북마크나 설정 탭으로 갔다가 홈으로 돌아오면 **읽던 장과 위치를 잃고 성서 목록(루트)으로** 떨어졌다. 네이티브 탭 앱(iOS)의 「탭을 다시 누르면 그 탭이 보던 곳으로 돌아간다」는 관례가 없어, 탭을 바꾸면 곧 맥락을 잃었다.

읽기 위치 자체는 `bible-last-read`(권, 장, 절, ADR-015)에 이미 저장된다. 그러나 이것은 **앱을 처음 열 때 이어 읽기**(설정 「이어 읽기」)를 위한 것이지, 같은 세션 안에서 탭을 바꿨다 돌아올 때의 복원과는 성격이 다르다.

## 결정

각 탭이 **마지막으로 본 라우트와 스크롤 위치**를 세션 동안 기억하고, 그 탭으로 다시 들어오면 되살린다(iOS 탭 관례). 새 모듈 `js/app/tab-history.js`(`window.tabHistory`)가 두 축으로 처리한다.

### 1. 스크롤 기억 — 경로 단위로, POP과 탭 전환에서만 되살린다

`scrollMemory: Map<전체경로(pathname+search), scrollY>`.

- **저장**: `route()`가 시작할 때 `onRouteStart()`가 *떠나는* 경로(`currentPath`)의 `window.scrollY`를 적는다(라우트마다). DOM이 아직 옛 화면이고(그리기 전), 스크롤 복원이 manual(§3)이라 scrollY가 떠나는 페이지 기준이어서 정확하다.
- **복원**: `route()`가 새 경로를 다 그린 직후(`finally`) `onRouteEnd()`가, **복원을 요청한 경우에만** 그 경로의 기억된 scrollY로 되돌린다(기억이 없으면 뷰가 정한 스크롤을 그대로 둔다). 글꼴, 인용 같은 비동기 레이아웃 이동에 대비해 다음 프레임에 `scrollTo`를 한 번 더 한다.

**PUSH와 POP — 복원을 거르는 기준.** 브라우저 표준 라우터처럼 복원은 **POP의 의미**일 때만 한다. (a) 뒤로/앞으로(`popstate`), (b) 탭 전환(다른 탭에서 홈, 검색, 북마크, 설정으로 들어올 때)이다. 이때 `requestRestore()`가 한 번만 쓰는 표시를 세우고, `onRouteEnd`가 그것을 쓴다. **보통의 링크 이동(PUSH)**, 곧 다음/이전 장, 절 딥링크(`/john/3/16` 강조), `?resume=1` 등은 복원을 요청하지 않는다. 그래서 같은 세션에서 같은 장 URL을 다시 열어도 옛 위치로 튀지 않고, 뷰가 정한 스크롤(`renderChapter`의 맨 위 / `scrollIntoView` 강조와 이어 읽기)이 그대로 남는다. 이렇게 거르지 않으면 onRouteEnd가 뷰의 스크롤을 덮어쓰는 회귀가 생긴다(Bugbot 지적 반영).

계속 도는 스크롤 리스너가 아니라 **전환할 때만** 저장하므로 비용이 없고, 「떠날 때의 위치」라는 뜻과도 정확히 맞는다.

### 2. 탭별 마지막 경로 — 홈과 검색으로 들어오는 길을 가로채 되살린다

`lastPathForTab: { home, search, bookmarks, settings }`. 캘린더 탭(ADR-038)을 더해 지금은 `calendar`도 있다. `onRouteEnd`가 새 경로를 그 경로가 속한 탭(`tabOf`)에 적는다.

- **홈**은 읽기 스택(`/`, `/<division>`, `/<book>/<chapter>` …)이라 아래 경로가 늘 바뀐다. 고정된 `href="/"`만으로는 되살릴 수 없다. 그래서 `tabbar.js`가 **홈 탭 클릭을 가로채**, 지금 탭이 홈이 아니면(북마크, 설정, 검색에서 들어올 때) `lastPath("home")`로 이동한다(`navigate`). 이미 홈 스택이면 가로채지 않고 전처럼 루트(「/」, 성서 목록)로 간다. **iOS의 pop-to-root**다. 그래서 「읽다가 홈 탭」의 기존 동작(목록으로)은 회귀 없이 남고, **「다른 탭에서 홈으로 돌아오기」**만 새로 되살아난다. 되살릴 곳이 루트뿐이면(아직 읽은 적이 없으면) 기본 href대로 간다.
  - **pop-to-root에서는 읽던 책 카드에 포커스를 둔다(2026-06-10).** 이미 홈 스택에서 하단 홈 탭을 누르면 목록으로 돌아가는데, 읽던 화면(장, 머리말, 장 목록, 곧 `parsePath().bookId`가 있는 화면)이었다면 그 책의 **구분 탭**(`/<division>`)으로 가서 읽던 책 카드에 포커스를 두고 가운데로 스크롤한다(`setPendingBookFocus`에서 `renderBookList`의 `focusPendingBook`으로). 헤더 홈 버튼(`buildHomeBtn`)이 이미 하던 동작(ADR-024)을 하단 탭에도 맞춘 것이다. 키보드와 화면 낭독기 사용자가 목록 맨 위가 아니라 읽던 맥락에 내린다. 기본 `href="/"`는 첫 구분(보통 구약)만 그리므로, 신약 책을 읽다 누르면 그 책이 목록에 없어 포커스가 잡히지 않았다. 책 자신의 구분으로 보내 해결했다. 목록이나 구분 화면(bookId 없음)에서는 그대로 `/`로 간다. 이 경로는 `requestRestore()`를 부르지 않으므로(스크롤 복원이 아니다), `focusPendingBook`의 `scrollIntoView({block:"center"})`가 위치를 정한다.
  - **읽던 책 카드를 눈에 띄게 한다.** 프로그램으로 부른 `.focus()`에는 브라우저가 `:focus-visible`(키보드와 보조 기술 포커스에만 켜는 규칙)을 켜지 않아, 카드가 DOM 포커스만 받고 색이 바뀌지 않는다. 그래서 `focusPendingBook`이 `.is-last-read` 표시 클래스를 한 번 붙인다(CSS가 `:focus-visible`과 같은 accent 강조를 준다). 사용자의 첫 입력(pointer/key)에서 떼고(이때부터 키보드는 `:focus-visible`이 맡는다), 다음 렌더에서도 저절로 사라진다. 또 `.focus()`가 부르는 iOS Safari의 기본 포커스 윤곽선이 첫 행에서 위의 sticky 탭에 위쪽이 잘려 보이므로, `.book-list a:focus { outline:none }`로 끈다. book-list는 원래 윤곽선이 아니라 accent 배경 채움으로 포커스를 보이므로(키보드는 `:focus-visible`로 같은 채움) 잃는 것이 없다.
- **검색**(따로 떨어진 돋보기 버튼)은 `/search?q=…&page=…`로 쿼리가 늘 바뀐다. `openSearch()`로 들어오는 길을 `lastPath("search")`로 보내 **이전 검색어와 결과를 그대로 되살린다**(입력 칸도 URL `?q=`로 미리 채운다). 검색을 「한 번 하고 마는 동작」이 아니라 「돌아올 수 있는 장소」로 다룬다(제품 결정 2026-06-05). 기억이 없으면 빈 `/search`로 간다.
  - **절 참조 검색**(`창세 1:3`)은 `renderSearchResults`가 그 장으로 저절로 이동하면서(auto-nav) route가 다시 들어오므로, 바깥 `onRouteEnd`가 `_routeSeq` 가드에 걸려 건너뛴다. 그래서 search 분기에서 `recordPath()`로 `/search?q=…`를 **미리 적어** 마지막 검색을 잃지 않는다. 되살릴 때(openSearch에서 navigate)는 Enter가 아니라 `autoNavigate=false`라서, 절 참조가 맞아도(refMatch) 저절로 이동하지 않고 **누를 수 있는 카드로 그린다**(되튀김이 없다).
- **북마크와 설정**은 라우트가 하나뿐이라 마지막 경로가 곧 `/bookmarks`, `/settings`다. 고정 href로 충분하다. 다만 §1의 거르는 기준 때문에, 전환할 때 스크롤을 되살리려면 복원 요청이 필요하다. 그래서 `tabbar.js`가 두 탭 클릭에 **가로채지 않는** 핸들러를 달아(다른 탭에서 들어올 때만) `requestRestore()`만 부른다(navigate는 전역 `<a>` 인터셉터가 한다).

### 3. `history.scrollRestoration = "manual"`

기본값 `auto`이면 popstate(뒤로/앞으로) 때 브라우저가 먼저 스크롤을 옮겨, `onRouteStart`가 *떠나는* 페이지의 실제 scrollY를 읽지 못한다(이미 도착할 페이지 기준으로 옮겨졌다). manual로 끄고 우리가 직접 되살려야 저장과 복원이 모두 정확하다. 직접 그리는 SPA의 표준 방식이고, 뒤로/앞으로의 스크롤 복원도 같은 기억으로 일관되게 처리된다(덤으로 얻는 이점).

### 4. 다시 들어오는 호출 막기 — `_routeSeq`

`route()`는 안에서 다른 곳으로 보낼 때(`books`+`resume`, 외경 vulgate, 검색의 절 참조 auto-nav) `navigate()`/`route()`를 다시 부른다. `route()`는 부를 때마다 `_routeSeq`를 올리고 자기 번호를 들고 있다가, `finally`에서 **여전히 최신일 때만** `onRouteEnd`(경로 기록과 스크롤 복원)를 부른다. 지금은 아래처럼 모든 await 뒤에서도 번호(`_routeSeq`)를 확인한다. 오래된 바깥 호출이 중간 경로로 잘못 되살리는 것을 막는다.

- 처음에는 `finally`의 `onRouteEnd`(경로 기록과 스크롤 복원)만 막았다.
- **모든 await 뒤로 넓혔다(2026-06-08).** `route()` 안의 다른 await들(`loadBooks`/`loadChapter`/`loadPrologue` fetch, `renderSearchResults`/`renderSearchView`)도 늦게 끝나면, 그 사이 사용자가 이동해 이미 떠 있는 새 뷰 위에 늦은 렌더, `updatePageMeta`, `trackPageView`, 이어 읽기 위치 저장을 덮어쓸 수 있었다. 그래서 `route()` 머리에 `const isStale = () => routeSeq !== _routeSeq` 도우미를 두고, **모든 await 바로 뒤**에 `if (isStale()) return;`으로 맞췄다. 전에는 검색 두 분기만 `parsePath().view !== "search"`로 막혀 있었다(읽기, 북마크, 설정, 일반 목록은 막지 않았다). auto-nav의 안쪽 `route()`가 `_routeSeq`를 동기적으로 올리므로 그 확인과 같은 효과이고, 「진행 중에 다른 검색어로 이동」 같은 경우까지 더 넓게 잡는다. `route()`는 ADR-034 PR5a에서 `views-routing.js`에서 `js/app/routing.js`로 옮겨 갔다.

### 5. 같은 화면을 다시 그리는 링크의 포커스 — 라우터가 돌려준다 (2026-10-17)

같은 뷰를 다시 그리는 링크가 있다. 전례독서의 날짜 이동, 전례일 칩, 두 독서 카드, 세그먼트, 캘린더의 달 이동, 성서 목록의 구분 탭, 검색의 「← 이전」과 「다음 →」이다. 이런 링크를 누르면 `route()`가 옛 화면을 비우면서 누른 링크도 사라져, 포커스가 body로 빠진다. 키보드와 화면 낭독기 사용자는 누를 때마다 건너뛰기 링크, 머리, 탭부터 다시 지나와야 한다(WCAG 2.4.3). 그래서 라우터가 그 자리를 돌려준다.

- **링크는 표지만 단다.** `data-focus-key`를 단다. 값으로 찾는 키라서 전례일 id처럼 콜론이나 한글이 들어가도 된다. 새 화면에 같은 컨트롤이 없을 수 있으면, 대신 포커스를 받을 컨트롤을 `data-focus-fallback`으로 적는다. 계산 범위 끝의 앞뒤 단추는 「오늘」로, 첫 쪽과 마지막 쪽의 「← 이전」과 「다음 →」은 서로 상대 단추로 넘긴다.
- **재기, 꺼내기, 돌려주기는 라우터 한 곳에서 한다.** 전역 `<a>` 인터셉터가 이동 바로 전에 누른 자리를 잰다(`helpers.js focusSpotOf`). 키, 화면 위치, `#app` 안 위치, 누른 방식이다. `route()`는 시작하자마자 그 자리를 꺼내 비우고, 새 화면이 커밋된 뒤 `finally`에서 그 route가 여전히 최신이면(§4) `onRouteEnd` 다음에 돌려준다(`restoreFocusSpot`). 자리는 그것을 남긴 누름의 route에만 쓰인다. 뒤로 가기, 탭 전환, 리다이렉트는 자리 없이 시작한다.
- **누른 때의 화면 위치로 되돌린다.** 새 장을 받는 다시 그리기는 스켈레톤이 스크롤을 맨 위로 밀어 올린다. 그래서 같은 컨트롤을 누른 때의 화면 위치에 다시 세운다. 스크롤 고정(scroll anchoring)이 있는 브라우저는 화면 위치로, 없으면 `#app` 안 위치로 맞추고, 누를 때 이미 화면 밖이었으면 가운데로 둔다. 머리의 구분 탭(`#app` 밖, sticky)은 제자리라 스크롤하지 않는다. 그래서 커밋 뒤 스크롤을 움직이는 뷰는 즉시 스크롤로 한다(검색 결과의 맨 위. 부드러운 스크롤이 이어지면 되돌린 위치를 밀어낸다). 이것은 §1의 PUSH 의미와 같은 쪽이다. 뷰가 정한 스크롤을 덮지 않고, 누른 컨트롤 하나만 제자리에 둔다.
- **포커스를 잃었을 때만 돌려준다.** 포커스가 body일 때만 돌려준다. 다시 그리는 사이 독자가 다른 곳(머리의 검색 칸, 팝오버, 탭 바)으로 옮겼거나, 뷰가 스스로 포커스를 둔 경우는 그대로 둔다. 마우스나 탭으로 누른 때는 링 없이 돌려준다(`focus({ focusVisible: false })`).
- **페이지 이동도 같다.** 검색의 「다음 →」은 새 페이지에서도 누른 링크 그대로다(사용자 결정 2026-10-17). 몇 쪽인지는 라이브 영역이 한 번 알린다(「전체 N쪽 중 M쪽」. 「2/5」는 분수로 읽힐 수 있다). 결과 건수 줄은 제목(`h2`)이라, 포커스를 둔 채 제목 이동(VoiceOver 로터, TalkBack)으로 새 결과 첫머리에 갈 수 있다.

같은 인터셉터가 **페이지 안 링크**(「본문 바로가기」 `#app`)를 먼저 가려낸다. 라우트가 아니므로 `route()`를 부르지 않고 대상으로 포커스만 옮긴다(대화형이 아닌 `<main>`이라 처음 쓸 때 `tabindex="-1"`을 단다). 전에는 `route()`로 같은 화면을 다시 그리기만 하고 포커스는 본문으로 가지 않았다. 브라우저에 맡기지 않는 것은, 주소에 「#app」이 붙어 기록 항목이 하나 더 생기기 때문이다.

## 구현

- `js/app/tab-history.js`(신규, `window.tabHistory`): `tabOf`·`onRouteStart`·`onRouteEnd`·`requestRestore`·`lastPath`·`recordPath`와 `scrollMemory`/`lastPathForTab`/`restoreNext`. 모듈을 불러올 때 `scrollRestoration="manual"`로 둔다.
- `js/app/views-routing.js`: `route()` 머리에서 `onRouteStart()`와 `_routeSeq` 발급, `finally`에서 번호가 같으면 `onRouteEnd()`. `popstate` 핸들러가 `requestRestore()` 뒤에 `route()`를 부른다. search 분기는 `renderSearchResults` 전에 `recordPath(현재 /search URL)`(auto-nav로 낡지 않게). `route()`는 지금 `js/app/routing.js`에 있다(§4).
- `js/app/tabbar.js`: 홈 탭 클릭 가로채기(축소를 펼치고, 다른 탭에서 왔으면 되살리고 `requestRestore`, 아니면 루트), 북마크와 설정 탭으로 바꿀 때 `requestRestore`(가로채지 않는다), `openSearch()`가 `requestRestore` 뒤에 `lastPath("search")`로 들어간다.
- `index.html`·`sw.js`: 모듈 스크립트 등록과 SHELL 미리 넣기 목록에 추가.
- 테스트: `tests/unit/tab-history.test.js`(`tabOf` 분류 11 케이스, BEGIN/END TABOF 슬라이스. 캘린더 탭을 더해 지금은 12개). 스크롤 저장과 복원, 홈과 검색 복원의 연결은 DOM과 라우팅이라 e2e가 맡는다(ADR-013).
- §5(2026-10-17): `js/app/routing.js`의 `_pendingFocusSpot`. 클릭 인터셉터가 `focusSpotOf`로 재고, `route()`가 시작할 때 꺼내 `finally`에서 `restoreFocusSpot`을 부른다. 인터셉터는 페이지 안 링크(`inPageTargetId`, `IN_PAGE_LINK` 블록)를 먼저 가려 `focusInPageTarget`으로 보낸다. `js/app/helpers.js`의 두 함수가 위치, 대체, 「body일 때만」, 링을 맡는다. 뷰는 키만 단다.
  - `lectionary.js`: 날짜 이동, 칩, 카드, 세그먼트. 앞뒤 단추의 대체는 「오늘」.
  - `calendar.js`: 달 이동(같은 `buildDateNav`).
  - `views.js buildDivisionTabs`: `div:<division>`.
  - `search.js buildSearchPagination`: `page:prev|next`(서로 대체).
  - 테스트: `helpers.test.js`(재기와 돌려주기), `routing.test.js`(`inPageTargetId`), e2e `test_a11y_keyboard.py`(구분 탭, 검색 페이지, 「본문 바로가기」), `test_lectionary_view.py`, `test_calendar_view.py`.

## 검토한 대안

- **계속 도는 스크롤 리스너로 프레임마다 저장**: 비용이 들고 지나치게 자주 저장한다. 전환할 때 저장하는 쪽이 뜻과 비용 모두 낫다.
- **localStorage에 오래 저장**: 앱을 처음 열 때의 복원은 이미 `bible-last-read` 이어 읽기가 맡는다. 탭 히스토리는 세션 안의 메모리로 충분하다(앱을 다시 시작하면 이어 읽기 설정이 이어받는다). 단순함을 먼저 본다.
- **홈 탭을 늘 마지막으로 읽던 곳으로**: 성서 목록으로 가는 길이 없어진다. iOS pop-to-root(이미 홈이면 루트로)로 두 동작을 한 버튼에 자연스럽게 함께 둔다.
- **검색은 늘 새로 시작**: 다른 탭과 일관성이 깨지고, 검색하다 잠깐 다른 탭에 다녀오면 결과를 잃는다. 마지막 검색을 되살리는 쪽으로 맞춘다(입력은 바로 고칠 수 있으므로 새 검색도 한 번이면 된다).
- **화면마다 포커스 기억 (2026-10-15부터 10-17까지)**: §5의 앞선 방식(`helpers.js createFocusMemory`)이다. 캘린더와 전례독서가 화면마다 하나씩 만들어(#348, #350), 커밋마다 루트에 `remember`, 렌더 시작에 `take`, 커밋 뒤 `restore`를 이었다. 채택 안 함 2026-10-17 · 이유: 뷰 루트 밖의 컨트롤(구분 탭. `route()`가 슬롯을 비운다)과 `await` 뒤에 그려지는 목록(`take`가 클릭 처리가 끝난 뒤에 돈다)을 덮지 못했다. 또 네 걸음을 손으로 이어야 해서, 하나를 빠뜨려도 오류 없이 포커스만 잃었다. 재검토 조건: 라우터를 거치지 않고 화면을 다시 그리는 뷰가 생기면(`route()` 없이 목록을 바꾸는 필터 등), 그 뷰 안에서 같은 두 함수(`focusSpotOf`, `restoreFocusSpot`)를 직접 부른다.
- **검색 페이지를 넘긴 뒤 결과 목록 맨 위로 포커스**: 새 페이지를 위에서부터 읽는 흐름이라 화면 낭독기에는 자연스럽다. 그러나 Enter를 거듭 눌러 넘길 수 없고, 전례독서의 「다음날」과 규칙이 갈린다. 누른 링크 그대로 두기로 했다(사용자 결정 2026-10-17). iOS VoiceOver 평가 기준의 「새로 고칠 때 읽던 위치가 처음으로 돌아가면 안 된다」, Material의 「포커스가 있던 요소로」와 같은 쪽이다. 대신 쪽 안내와 결과 건수 제목으로 보완했다. 재검토 조건: 화면 낭독기 사용자에게서 결과 맨 위가 낫다는 요청이 오면.
