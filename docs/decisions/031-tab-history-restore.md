# ADR-031: 탭 히스토리 — 탭별 위치 복원

- 일시: 2026-06-05
- 상태: 승인됨 — 구현 완료(2026-06-05 · §5 2026-10-17)
- 관련 ADR: ADR-029(모바일 탭 바 — 각 탭 = 전체화면 라우트 뷰), ADR-030(모핑 탭 바 — 분리 검색 원형·스크롤 축소), ADR-015(스토리지 전략), ADR-014(검색 히스토리), ADR-038(캘린더 · 전례독서 — §5 포커스를 처음 쓴 화면)

## 맥락

ADR-029/030 으로 모바일 하단 탭(홈·북마크·설정 + 분리된 검색 원형)이 자리잡았지만,
각 탭은 **상태를 기억하지 않는 단순 라우트**였다. 특히 홈 탭 버튼은 정적 `href="/"`라,
성서를 읽다(`/john/3`) 북마크·설정 탭으로 갔다 홈으로 돌아오면 **읽던 장·위치를 잃고
성서 목록(루트)으로** 떨어졌다. 네이티브 탭 앱(iOS)의 "탭을 다시 누르면 그 탭이
보던 곳으로 복귀"하는 관용구가 없어, 탭 전환이 곧 컨텍스트 상실이었다.

읽기 위치 자체는 `bible-last-read`(권/장/절, ADR-015)로 이미 저장되지만, 이는
**앱 콜드 스타트 resume**(설정 "이어 읽기")용이지 세션 내 탭 전환 복원과는 결이 다르다.

## 결정

각 탭이 **마지막으로 본 라우트 + 스크롤 위치**를 세션 동안 기억하고, 그 탭으로
다시 들어오면 복원한다(iOS 탭 관용구). 신규 모듈 `js/app/tab-history.js`
(`window.tabHistory`)가 두 축으로 처리한다.

### 1. 스크롤 메모리 — 경로 단위, POP/탭 전환에서만 복원

`scrollMemory: Map<전체경로(pathname+search), scrollY>`.

- **저장**: `route()` 시작 시 `onRouteStart()` 가 *떠나는* 경로(`currentPath`)의
  `window.scrollY` 를 기록한다(매 라우트). DOM 이 아직 옛 화면이고(렌더 전), 스크롤
  복원이 manual(§3)이라 scrollY 가 떠나는 페이지 기준이라 정확하다.
- **복원**: `route()` 가 새 경로 렌더를 마친 직후(`finally`) `onRouteEnd()` 가, **복원이
  요청된 경우에만** 그 경로의 기억된 scrollY 로 복원한다(없으면 뷰가 정한 스크롤 유지).
  폰트·인용 등 비동기 레이아웃 이동 대비 다음 프레임에 한 번 더 `scrollTo`.

**PUSH vs POP — 복원 게이팅.** 브라우저 표준 라우터처럼 복원은 **POP 의미론**에서만 한다:
(a) 뒤로/앞으로(`popstate`), (b) 탭 전환(다른 탭에서 홈·검색·북마크·설정으로 진입). 이
경우 `requestRestore()` 가 1회성 플래그를 세우고 `onRouteEnd` 가 소비한다. **일반 링크
이동(PUSH)** — 다음/이전 장, 절 딥링크(`/john/3/16` 하이라이트), `?resume=1` 등 — 은
요청하지 않으므로, 같은 세션에서 같은 장 URL 을 다시 열어도 옛 픽셀로 튀지 않고 뷰가
정한 스크롤(`renderChapter` 의 최상단 / `scrollIntoView` 하이라이트·resume)이 그대로
유지된다. (게이팅이 없으면 onRouteEnd 가 뷰 스크롤을 덮어쓰는 회귀 — Bugbot 지적 반영.)

연속 스크롤 리스너가 아니라 **전환 시점에만** 저장하므로 비용이 없고, "떠날 때의
위치"라는 의미와도 정확히 맞는다.

### 2. 탭별 마지막 경로 — 홈·검색 진입을 가로채 복원

`lastPathForTab: { home, search, bookmarks, settings }`. `onRouteEnd` 가 새 경로를 그
경로의 탭(`tabOf`)에 기록한다.

- **홈**은 읽기 스택(`/`·`/<division>`·`/<book>/<chapter>` …)이라 하위 경로가 가변 —
  정적 `href="/"` 만으로는 복원 불가. `tabbar.js` 가 **홈 탭 클릭을 가로채**, 지금 탭이
  홈이 아니면(북마크·설정·검색에서 진입) `lastPath("home")` 로 `navigate` 한다.
  이미 홈 스택이면 가로채지 않고 기존대로 루트("/", 성서 목록)로 — **iOS pop-to-root**.
  따라서 "읽다가 홈 탭" 의 기존 동작(목록으로)은 회귀 없이 유지되고, **"다른 탭→홈
  복귀"** 케이스만 새로 복원된다. 복원 대상이 루트뿐이면(아직 읽은 적 없음) 기본 href 진행.

  > **개정 (2026-06-10) — pop-to-root 시 읽던 책 카드에 포커스:**
  > 이미 홈 스택(읽는 중)에서 하단 홈 탭을 누르면 목록으로 돌아가되, 읽던 화면
  > (장·머리말·장 목록 = `parsePath().bookId` 존재)이면 그 책의 **구분 탭으로**
  > 가서(`/<division>`) 읽던 책 카드에 포커스·중앙 스크롤한다(`setPendingBookFocus`
  > → `renderBookList` 의 `focusPendingBook`). 헤더 홈 버튼(`buildHomeBtn`)이 이미
  > 하던 동작을 하단 탭에도 맞춘 것 — 키보드·스크린리더 사용자가 목록 최상단이
  > 아니라 읽던 맥락에 착지한다. 기본 `href="/"` 는 첫 구분(보통 구약)만 렌더하므로,
  > 신약 책을 읽다 눌러도 그 책이 렌더된 목록에 없어 포커스가 안 잡히는 문제를
  > 책 자신의 구분으로 라우팅해 해소. 목록·구분 화면(bookId 없음)에선 그대로 `/`.
  > 이 경로는 `requestRestore()` 를 호출하지 않아(스크롤 복원 아님) `focusPendingBook`
  > 의 `scrollIntoView({block:"center"})` 가 위치를 정한다.
  >
  > 시각 강조: 프로그래밍 `.focus()` 는 브라우저가 `:focus-visible`(키보드·AT 포커스
  > 전용 휴리스틱)을 켜지 않아, 카드가 DOM 포커스만 받고 색이 안 바뀐다. `focusPendingBook`
  > 이 `.is-last-read` 마커 클래스를 1회성으로 붙여(CSS 가 `:focus-visible` 과 같은 accent
  > 강조) 읽던 책 카드를 확실히 표시한다. 첫 사용자 입력(pointer/key)에 제거되고(이때부터
  > 키보드는 `:focus-visible` 로 인계) 다음 렌더에서도 자연히 사라진다. 더불어 `.focus()`
  > 가 부르는 iOS Safari UA 포커스 아웃라인이 첫 행에서 위 sticky 탭에 상단이 잘려
  > 보이므로 `.book-list a:focus { outline:none }` 로 끈다 — book-list 는 원래 아웃라인이
  > 아니라 accent 배경 채움을 포커스 표시로 쓰므로(키보드는 `:focus-visible` 로 동일 채움)
  > 어포던스 손실이 없다.
- **검색**(분리된 돋보기 버튼)은 `/search?q=…&page=…` 로 쿼리가 가변 — `openSearch()`
  진입을 `lastPath("search")` 로 라우팅해 **이전 검색어·결과를 그대로 복원**한다(입력
  pill 도 URL `?q=` 로 프리필). 검색을 '일회성 액션'이 아니라 '돌아올 수 있는 장소'로
  취급(제품 결정 2026-06-05). 없으면 빈 `/search`. **verse-ref 검색**(`창세 1:3`)은
  `renderSearchResults` 가 챕터로 auto-nav 하며 route 가 재진입해 바깥 `onRouteEnd` 가
  `_routeSeq` 가드로 스킵되므로, search 분기에서 `recordPath()` 로 `/search?q=…` 를 **미리
  기록**해 마지막 검색을 잃지 않는다. 복원(openSearch→navigate)은 Enter 가 아니라
  `autoNavigate=false` 라 refMatch 가 자동 이동 없이 **클릭 카드로 렌더**(바운스 없음).
- **북마크·설정**은 단일 라우트라 마지막 경로가 곧 `/bookmarks`·`/settings` — 정적
  href 로 충분하다. 다만 §1 게이팅 때문에 전환 시 스크롤을 복원하려면 복원 요청이
  필요하므로, `tabbar.js` 가 두 탭 클릭에 **가로채지 않는** 핸들러를 달아(다른 탭에서
  진입할 때만) `requestRestore()` 만 호출한다(navigate 는 전역 `<a>` 인터셉터가 처리).

### 3. `history.scrollRestoration = "manual"`

기본값 `auto` 면 popstate(뒤로/앞으로) 시 브라우저가 먼저 스크롤을 옮겨, `onRouteStart`
가 *떠나는* 페이지의 실제 scrollY 를 못 읽는다(이미 대상 기준으로 이동). manual 로 끄고
우리가 직접 복원해야 저장·복원이 모두 정확하다. SPA 커스텀 렌더의 표준이며, 뒤로/앞으로
스크롤 복원도 같은 메모리로 일관되게 처리된다(부수 이득).

### 4. 재진입 가드 — `_routeSeq`

`route()` 는 내부 리다이렉트(`books`+`resume`, 외경 vulgate, 검색 verse-ref auto-nav)
에서 `navigate()`/`route()` 를 재진입 호출한다. 매 `route()` 가 `_routeSeq` 를 올리고
지역 사본을 들고 있다가, `finally` 에서 **여전히 최신일 때만** `onRouteEnd`(경로 기록 +
스크롤 복원)를 실행한다. 낡은 바깥 호출이 중간 경로로 잘못 복원하는 것을 막는다.

> **개정 (2026-06-08) — 가드를 모든 await continuation 으로 확장:**
> 원래 `_routeSeq` 는 `finally` 의 `onRouteEnd`(경로 기록·스크롤 복원)만 가드했다. 그러나
> `route()` 안의 다른 await 들(`loadBooks`/`loadChapter`/`loadPrologue` fetch, `renderSearchResults`/
> `renderSearchView`)도 완료가 늦으면, 그 사이 사용자가 이동해 이미 떠 있는 새 뷰 위에 늦게
> 렌더·`updatePageMeta`·`trackPageView`·이어읽기 위치 저장을 덮어쓸 수 있었다. 막기 위해
> `route()` 상단에 `const isStale = () => routeSeq !== _routeSeq` 헬퍼를 두고 **모든 await
> 직후** `if (isStale()) return;` 으로 통일했다. 이전에는 검색 두 분기만 `parsePath().view !==
> "search"` 로 막혀 있었고(읽기·북마크·설정·일반 목록은 미가드), auto-nav 의 inner `route()` 가
> `_routeSeq` 를 동기적으로 올리므로 그 체크와 동치이면서 "진행 중 다른 검색어로 이동" 같은
> 경우까지 더 넓게 잡는다. (route() 는 ADR-034 PR5a 에서 `views-routing.js` →
> `js/app/routing.js` 로 이전됨.)

### 5. 같은 화면을 다시 그리는 링크의 포커스 — 라우터가 돌려준다 (2026-10-17)

같은 뷰를 다시 그리는 링크 — 전례독서의 날짜 이동 · 관측일 칩 · 두 독서 카드 · 세그먼트, 캘린더의 달 이동, 성서 목록의
구분 탭, 검색의 「← 이전 · 다음 →」 — 를 누르면 `route()` 가 옛 화면을 비우며 누른 링크도 사라져 포커스가 body 로
빠진다. 키보드 · 스크린리더 사용자는 누를 때마다 건너뛰기 링크 · 머리 · 탭부터 다시 지나와야 한다(WCAG 2.4.3). 라우터가
그 자리를 돌려준다.

- **링크는 표지만 단다** — `data-focus-key`(값으로 찾는 키라 관측일 id 처럼 콜론 · 한글이 들어도 된다)와, 새 화면에 같은
  컨트롤이 없을 수 있으면 넘겨받을 컨트롤의 `data-focus-fallback`(계산 범위 끝의 앞뒤 단추 → 「오늘」, 첫 · 마지막 쪽의
  「← 이전」 · 「다음 →」 → 다른 쪽).
- **재기 · 꺼내기 · 돌려주기는 라우터 한 곳** — 전역 `<a>` 인터셉터가 이동 직전에 누른 자리(키 · 화면 위치 · `#app` 안
  위치 · 누른 방식)를 재고(`helpers.js focusSpotOf`), `route()` 가 시작하자마자 꺼내 비우며, 새 화면이 커밋된 뒤
  `finally` 에서 그 route 가 여전히 최신이면(§4) `onRouteEnd` 다음에 돌려준다(`restoreFocusSpot`). 자리는 그것을 남긴
  누름의 route 에만 쓰인다 — 뒤로 가기 · 탭 전환 · 리다이렉트는 자리 없이 시작한다.
- **누른 때의 화면 위치로** — 새 장을 받는 다시 그리기는 스켈레톤이 스크롤을 맨 위로 누른다. 같은 컨트롤을 누른 때의
  화면 위치에 다시 세우고(스크롤 고정이 있는 브라우저는 화면 위치, 없으면 `#app` 안 위치), 누를 때 이미 화면 밖이었으면
  가운데로. 머리의 구분 탭(`#app` 밖 · sticky)은 제자리라 스크롤하지 않는다. 그래서 커밋 뒤 스크롤을 움직이는 뷰는 즉시
  스크롤로 한다(검색 결과의 맨 위 — 부드러운 스크롤이 이어지면 복원한 위치를 민다). 이것은 §1 의 PUSH 의미론과 같은
  쪽이다 — 뷰가 정한 스크롤을 덮지 않고, 누른 컨트롤 하나를 제자리에 둘 뿐이다.
- **포커스를 잃었을 때만** — 포커스가 body 일 때만 돌려준다. 다시 그리는 사이 독자가 다른 데(머리의 검색 칸 · 팝오버 ·
  탭 바)로 옮겼거나 뷰가 스스로 포커스를 둔 경우는 그대로 둔다. 마우스 · 탭으로 누른 때는 링 없이
  (`focus({ focusVisible: false })`).
- **페이지 이동도 같다** — 검색의 「다음 →」은 새 페이지에서도 누른 링크 그대로다(사용자 결정 2026-10-17). 몇 쪽인지는
  라이브 영역이 한 번 알리고(「전체 N쪽 중 M쪽」 — 「2/5」는 분수로 읽힐 수 있다), 결과 건수 줄은 제목(`h2`)이라 포커스를
  둔 채 제목 이동(VoiceOver 로터 · TalkBack)으로 새 결과 첫머리에 간다.

같은 인터셉터가 **페이지 안 링크**(「본문 바로가기」 `#app`)를 먼저 가른다 — 라우트가 아니므로 `route()` 를 부르지 않고
대상으로 포커스만 옮긴다(대화형이 아닌 `<main>` 이라 처음 쓸 때 `tabindex="-1"` 을 단다). 그전엔 `route()` 로 같은 화면을
다시 그리기만 하고 포커스는 본문으로 가지 않았다. 브라우저에 맡기지 않는 것은 주소에 「#app」이 붙어 기록 항목이 하나 더
생기기 때문이다.

## 구현

- `js/app/tab-history.js`(신규, `window.tabHistory`): `tabOf`·`onRouteStart`·`onRouteEnd`·
  `requestRestore`·`lastPath`·`recordPath` + `scrollMemory`/`lastPathForTab`/`restoreNext`.
  모듈 로드 시 `scrollRestoration="manual"`.
- `js/app/views-routing.js`: `route()` 상단 `onRouteStart()` + `_routeSeq` 발급, `finally`
  에서 시퀀스 일치 시 `onRouteEnd()`. `popstate` 핸들러가 `requestRestore()` 후 `route()`.
  search 분기는 `renderSearchResults` 전에 `recordPath(현재 /search URL)`(auto-nav staleness 방지).
- `js/app/tabbar.js`: 홈 탭 클릭 가로채기(축소 펼치기 → 다른 탭에서 복원+`requestRestore`
  → 아니면 루트), 북마크·설정 탭 전환 시 `requestRestore`(가로채기 없음), `openSearch()`
  가 `requestRestore` 후 `lastPath("search")` 로 진입.
- `index.html`·`sw.js`: 모듈 스크립트 등록 + SHELL 프리캐시 추가.
- 테스트: `tests/unit/tab-history.test.js`(`tabOf` 분류 11 케이스, BEGIN/END TABOF 슬라이스).
  스크롤 저장·복원과 홈·검색 복원 와이어링은 DOM/라우팅이라 e2e 책임(ADR-013).
- §5(2026-10-17): `js/app/routing.js` 의 `_pendingFocusSpot` — 클릭 인터셉터가 `focusSpotOf` 로 재고 `route()` 가
  시작에서 꺼내 `finally` 에서 `restoreFocusSpot`. 인터셉터는 페이지 안 링크(`inPageTargetId` — `IN_PAGE_LINK` 블록)를
  먼저 갈라 `focusInPageTarget` 으로. `js/app/helpers.js` 의 두 함수가 위치 · 대체 · 「body 일 때만」 · 링을 맡는다. 뷰는
  키만 단다 — `lectionary.js`(날짜 이동 · 칩 · 카드 · 세그먼트, 앞뒤 단추의 대체 「오늘」) · `calendar.js`(달 이동 — 같은
  `buildDateNav`) · `views.js buildDivisionTabs`(`div:<division>`) · `search.js buildSearchPagination`(`page:prev|next`, 서로
  대체). 테스트: `helpers.test.js`(재기 · 돌려주기) · `routing.test.js`(`inPageTargetId`) · e2e `test_a11y_keyboard.py`(구분
  탭 · 검색 페이지 · 「본문 바로가기」) · `test_lectionary_view.py` · `test_calendar_view.py`.

## 검토한 대안

- **연속 스크롤 리스너로 매 프레임 저장**: 비용·과저장. 전환 시점 저장이 의미·비용 모두 우월.
- **localStorage 영속화**: 콜드 스타트 복원은 이미 `bible-last-read` resume 이 담당. 탭
  히스토리는 세션 내 인메모리로 충분(앱 재시작 시 resume 설정이 이어받음). 단순성 우선.
- **홈 탭을 항상 마지막 읽기로**: 성서 목록 진입로가 사라진다. iOS pop-to-root(이미 홈이면
  루트)로 두 동작을 한 버튼에 자연스럽게 공존.
- **검색은 항상 새로 시작**: 다른 탭과 일관성이 깨지고, 검색 도중 탭을 잠깐 떠나면 결과를
  잃는다. 마지막 검색 복원으로 통일(입력은 즉시 수정 가능하므로 새 검색도 한 번에).
- **화면마다 포커스 기억(§5의 앞선 방식 — `helpers.js createFocusMemory`)**: 2026-10-15부터 10-17까지(#348 · #350) 캘린더 ·
  전례독서가 화면마다 하나씩 만들어 커밋마다 루트에 `remember` · 렌더 시작에 `take` · 커밋 뒤 `restore` 를 이었다. 버린
  이유(2026-10-17): 뷰 루트 밖 컨트롤(구분 탭 — `route()` 가 슬롯을 비운다)과 `await` 뒤에 그려지는 목록(`take` 가 클릭
  디스패치가 끝난 뒤에 돈다)을 덮지 못했고, 네 걸음을 손으로 이어 하나를 빠뜨려도 오류 없이 포커스만 잃었다. 재검토
  조건: 라우터를 거치지 않고 화면을 다시 그리는 뷰가 생기면(`route()` 없이 목록을 바꾸는 필터 등) 그 뷰 안에서 같은 두
  함수(`focusSpotOf` · `restoreFocusSpot`)를 직접 부른다.
- **검색 페이지 이동 뒤 결과 목록 맨 위로 포커스**: 새 페이지를 위에서부터 읽는 흐름이라 스크린리더에 자연스럽지만,
  Enter 를 거듭 눌러 넘길 수 없고 전례독서의 「다음날」과 규칙이 갈린다 — 누른 링크 그대로 두기로 했다(사용자 결정
  2026-10-17; iOS VoiceOver 평가 기준의 「새로 고칠 때 읽던 위치가 처음으로 돌아가면 안 된다」 · Material 의 「포커스가
  있던 요소로」와 같은 쪽). 대신 쪽 안내와 결과 건수 제목으로 보완했다. 재검토 조건: 스크린리더 사용자에게서 결과 맨
  위가 낫다는 요청이 오면.
