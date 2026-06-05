# ADR-031: 탭 히스토리 — 탭별 위치 복원

- 일시: 2026-06-05
- 상태: 승인됨 — 구현 완료(2026-06-05)
- 관련 ADR: ADR-029(모바일 탭 바 — 각 탭 = 전체화면 라우트 뷰), ADR-030(모핑 탭 바 — 분리 검색 원형·스크롤 축소), ADR-015(스토리지 전략), ADR-014(검색 히스토리)

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

### 1. 스크롤 메모리 — 경로 단위, route() 가 저장·복원

`scrollMemory: Map<전체경로(pathname+search), scrollY>`.

- **저장**: `route()` 시작 시 `onRouteStart()` 가 *떠나는* 경로(`currentPath`)의
  `window.scrollY` 를 기록한다. DOM 이 아직 옛 화면이고(렌더 전), 스크롤 복원이
  manual(아래)이라 scrollY 가 떠나는 페이지 기준이라 정확하다.
- **복원**: `route()` 가 새 경로 렌더를 마친 직후(`finally`) `onRouteEnd()` 가 그 경로의
  기억된 scrollY 로 복원한다(없으면 뷰가 정한 스크롤=보통 최상단 유지). 폰트·인용 등
  비동기 레이아웃 이동 대비 다음 프레임에 한 번 더 `scrollTo`.

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
- **검색**(분리된 돋보기 버튼)은 `/search?q=…&page=…` 로 쿼리가 가변 — `openSearch()`
  진입을 `lastPath("search")` 로 라우팅해 **이전 검색어·결과를 그대로 복원**한다(입력
  pill 도 URL `?q=` 로 프리필). 검색을 '일회성 액션'이 아니라 '돌아올 수 있는 장소'로
  취급(제품 결정 2026-06-05). 없으면 빈 `/search`.
- **북마크·설정**은 단일 라우트라 마지막 경로가 곧 `/bookmarks`·`/settings` — 정적
  href 로 충분하고, 스크롤은 §1 의 경로 키 메모리가 자동 복원한다(별도 가로채기 불필요).

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

## 구현

- `js/app/tab-history.js`(신규, `window.tabHistory`): `tabOf`·`onRouteStart`·`onRouteEnd`·
  `lastPath` + `scrollMemory`/`lastPathForTab`. 모듈 로드 시 `scrollRestoration="manual"`.
- `js/app/views-routing.js`: `route()` 상단 `onRouteStart()` + `_routeSeq` 발급, `finally`
  에서 시퀀스 일치 시 `onRouteEnd()`.
- `js/app/tabbar.js`: 홈 탭 클릭 가로채기(축소 펼치기 → 다른 탭에서 복원 → 아니면 루트),
  `openSearch()` 가 `lastPath("search")` 로 진입.
- `index.html`·`sw.js`: 모듈 스크립트 등록 + SHELL 프리캐시 추가.
- 테스트: `tests/unit/tab-history.test.js`(`tabOf` 분류 11 케이스, BEGIN/END TABOF 슬라이스).
  스크롤 저장·복원과 홈·검색 복원 와이어링은 DOM/라우팅이라 e2e 책임(ADR-013).

## 검토한 대안

- **연속 스크롤 리스너로 매 프레임 저장**: 비용·과저장. 전환 시점 저장이 의미·비용 모두 우월.
- **localStorage 영속화**: 콜드 스타트 복원은 이미 `bible-last-read` resume 이 담당. 탭
  히스토리는 세션 내 인메모리로 충분(앱 재시작 시 resume 설정이 이어받음). 단순성 우선.
- **홈 탭을 항상 마지막 읽기로**: 성서 목록 진입로가 사라진다. iOS pop-to-root(이미 홈이면
  루트)로 두 동작을 한 버튼에 자연스럽게 공존.
- **검색은 항상 새로 시작**: 다른 탭과 일관성이 깨지고, 검색 도중 탭을 잠깐 떠나면 결과를
  잃는다. 마지막 검색 복원으로 통일(입력은 즉시 수정 가능하므로 새 검색도 한 번에).
