# ADR-033: 검색 옵션 (책 picker · 결과 내 검색 · 진입 시 최근 검색)

- 일시: 2026-06-07
- 상태: 승인됨 — 구현 완료 (2026-06-07). 「결과 내 검색」은 2026-06-09에 없앴다
- 관련 ADR: ADR-005(검색 인덱싱과 `in:` 연산자), ADR-014(검색 히스토리), ADR-029/030(탭 바와 모핑 검색), ADR-031(탭 히스토리), ADR-032(오버레이 컨트롤러)

## 결정

검색 화면에 **검색 옵션**을 들인다. 옛 버전이 `in:` 연산자를 작은 모달 칩으로 보이던 것을 대신하고 넓혀, 다음을 준다.

1. **책 picker**: 책 선택 시트(분류별 묶음, 여러 권 선택)를 열고, 고른 책은 지울 수 있는 **칩**으로 보인다. 안에서는 워커의 책 제한 방식(`in:`/`restrictBooks`)을 다시 쓴다. 처음에는 「책 선택」 버튼을 별도 옵션 바에 두었고, 지금은 검색 필드 안의 깔때기 버튼과 칩이다(아래 「검색 필드 안 토큰」).
2. **결과 내 검색 (AND)**: 검색어가 있을 때만 보이는 「결과 내 검색」 입력이다. 더한 낱말은 기존 검색어와 **AND**로 묶여, 두 낱말이 모두 든 절만 남긴다. 더한 낱말도 지울 수 있는 칩으로 보인다. **2026-06-09에 없앴다**(아래 「검토한 대안」). 설계 기록(D1, D2, D3, 이 항목, 대안 B)은 남긴다. 뒤에 더 나은 방식으로 결과 내 검색을 다시 들일 때 이 ADR을 출발점으로 삼는다.
3. **들어올 때 최근 검색 목록**: 빈 쿼리로 `/search`에 들어오면 「최근 검색」 목록을 보인다. 행을 누르면 바로 검색하고, 행 끝의 **×**는 그 낱말만 지우고, 머리의 **「지우기」**는 모두 지운다(Apple Safari/App Store의 최근 항목 방식).

**뒤의 노트 검색**(검색 범위 = 성서/노트)에 대비해, 범위(scope)를 검색어와 따로 다룬다. 노트 기능이 더해지면 성서/노트 세그먼트를 책 picker와 같은 자리에 넣는다.

Apple HIG의 검색 방식(필터/범위 바, 토큰, 최근 항목 목록, 시트로 고르기)을 따른다.

### 검색 필드 안 토큰 (2026-06-08)

처음에는 별도 **필터 바**(`.search-filters`: 책 선택 버튼, 칩 줄, 「결과 내 검색」 입력)를 두었다. 그런데 하단 모핑 탭 바의 검색 pill과 함께 떠, **검색창이 둘**로 보였다(HIG의 「single, clearly identified location」에 어긋난다). 그래서 이 ADR의 **대안 A(검색어 필드 안의 토큰, iOS 16 search tokens)**로 바꿨다. 처음에는 「헤더, 페이지 안, 모핑의 입력 세 곳을 모두 구현해야 한다」는 비용 때문에 미뤘던 안이다.

비용을 낮춘 구현: `<input>`을 contenteditable로 바꾸지 않고, **칩을 input의 형제로 같은 flex 줄에 두는** 감싸개(`.token-zone`, `display:contents`)를 쓴다. 실제 `<input>`이 그대로라 `.value`·`focus({preventScroll})`·focus/blur·visualViewport 연결(ADR-030)이 모두 남는다. 세 필드(`#search-bar` 헤더, `#search-inpage-bar`, `#tab-search-dock` 모핑 pill)에 `mountSearchField`로 토큰 자리를 끼우고, `syncSearchFields()`가 route마다(routing.js)와 모핑을 열 때(tabbar.js) URL의 필터를 칩으로 다시 그린다.

- **책 범위**: 필드 왼쪽의 **깔때기 버튼**(`.token-funnel`, 책 선택 시트로 들어간다. 시트는 그대로다)과, 고른 책마다 지울 수 있는 **칩**(`.field-token`)이다.
- **Backspace**(커서가 0이고 필드가 비었을 때)로 마지막 토큰을 지우고, 칩의 ×를 눌러 하나씩 지운다.
- 모핑 pill의 토큰은 `body.tabbar-searching`일 때만 그린다(접힌 dock에는 칩이 없다).
- **`in:<별칭>`을 칩으로 옮긴다**: `commitTopSearch`가 커밋할 때 쿼리의 `in:` 연산자를 풀어 book id로 바꾸고 `filterBooks`(칩)로 옮긴 뒤, `q`에는 낱말만 남긴다(예제, 최근 검색, 직접 입력 모두 같다). 토큰 UI에서 연산자가 입력창에 그대로 보이지 않게 하려는 것이다. 풀지 못한 별칭은 `q`에 남아 워커가 그대로 처리한다(문제없이 넘어간다). 별칭 맵은 books의 `short_name_ko`/`name_ko`로 만들고 **부팅할 때 미리 불러 둔다**(`ensureAliasMap` 시작). 그래서 `commitTopSearch`는 **동기**로 둔다. async로 두면 await 경쟁 상태(낡은 값 적용, 플래그 남음)를 매번 routeSeq 검사로 막아야 해서, 그럴 자리 자체를 없앴다.
- **넘칠 때**: 토큰이 많으면 `.token-zone`(깔때기, 칩)이 **가로로 스크롤**되고, 메인 입력과 지우기 버튼은 zone 밖이라 늘 닿는다. 누를 자리(깔때기, 칩 ×)는 투명 `::after` 44px 덮개로 `--touch-target`을 확보한다(보이는 크기는 그대로). 책 칩 라벨은 `short_name_ko`(줄인 이름)다.

`buildSearchFilterBar`/`buildFilterChip`과 별도 필터 바는 지웠다. **워커와 URL(`in=`/`and=`) 스키마는 바꾸지 않았다.** 필터가 *어떻게 보이는지*만 바뀌었다. `css/style.css`의 옛 `.search-filters`/`.search-scope-*`/`.search-refine-*`/`.search-chip*` 규칙은 쓰는 곳이 없어져 뒤에 정리하기로 했고, 지금은 없다. 라우팅, 시트, 모핑의 DOM 동작은 e2e가 맡고(ADR-013), 순수 로직(URL, 쪽 넘김) 유닛은 회귀가 없었다(678 통과, tsc 0, 그때 수). **모바일 pill 레이아웃은 기기에서 눈으로 확인해야 한다.**

### 깔때기는 늘 보인다 (2026-06-09, 2026-06-11)

- **모핑 pill에서는 빈 검색에서도 깔때기를 보인다(2026-06-09).** 빈 상태와 입력 상태 모두 맨 앞 아이콘이 깔때기다. 돋보기(`#tab-search`)는 쉬고 있을 때 「검색으로 들어가는」 원형 버튼 역할만 한다. 유닛 678 통과, tsc 0, 모핑 pill의 빈 상태와 입력 상태를 눈으로 확인했다.
- **검색 입력에 포커스가 가면 어느 화면에서든 깔때기를 보인다(2026-06-11, 사용자 요청).** 전에는 검색 뷰에서만 보였다(`syncOneField`의 `searchView` 조건). 검색 화면에서는 이미 그랬지만 홈이나 읽기 같은 다른 화면의 헤더 검색에서는 보이지 않았다. `SearchField.focused` 표시를 두고 input의 focus/blur에서 바꾸며, 조건을 `active = allowPill && (searchView || field.focused)`로 넓혔다. 검색 뷰가 아니면 URL에 범위가 없어 칩은 비고 깔때기만 보인다.

### 책 선택 시트 — 데스크톱에서는 오른쪽 사이드 패널 (2026-06-11)

책 선택 시트(`#book-filter-sheet`)는 모바일에서 바텀 시트이고, 데스크톱에서는 **오른쪽에서 미끄러져 들어오는 사이드 패널**이다(사용자 요청). 북마크 드로어(`#bookmark-drawer`), 인용 시트(`#cite-sheet`)와 같은 데스크톱 방식(오른쪽에 붙고, `bm-drawer-in-right`/`out-right`로 미끄러지고, `--shadow-drawer`, 왼쪽 위와 왼쪽 아래만 둥근 모서리, 왼쪽 가장자리로 폭을 바꾸는 손잡이)으로 맞춰, 세 패널의 디자인을 같게 했다. 헤더에 닫기(×) 버튼(`.book-filter-close`)을 더하고, `createOverlay`에 `closeTransition`(`.book-filter-closing`)을 이어 닫힐 때도 미끄러지게 했다(모바일은 아래로, 데스크톱은 오른쪽으로). 전에는 바로 사라졌다. `attachSheetResize`로 왼쪽 손잡이를 이었다. 모바일 바텀 시트의 동작은 그대로다.

## 맥락

- ADR-005가 `in:<별칭>` 연산자를 들였고, ADR-030이 옛 검색 시트(`+ in:` 칩)를 지우면서 책 범위는 **타이핑으로만** 정할 수 있게 되었다. 책 이름과 별칭을 외워 넣는 것은 찾기 어렵다.
- ADR-014가 최근 검색을 들였지만 입력창의 ▾ 드롭다운에만 보여, 검색 화면에 들어올 때 바로 보이지 않았다.
- 같은 결과 안에서 더 좁히고 싶을 때(예: 「사랑」으로 찾은 뒤 「하느님」이 함께 있는 절만) 방법이 없었다.

## 검토한 대안

### A. 책 picker를 보이는 방식

- **검색어 필드 안의 토큰(iOS 16 search tokens)**: 가장 현대적이지만, 헤더 입력, 페이지 안 입력, 탭 바 모핑 입력 **세 곳 모두**에 토큰을 그려야 해 복잡하다. 처음에는 미뤘다가, 2026-06-08에 낮은 비용으로 구현하는 방법을 찾아 채택했다(위 「검색 필드 안 토큰」).
- **필터 영역과 책 선택 시트와 칩**: 옵션 바를 한 곳(검색 뷰)에 두고, 고르기는 시트(ADR-032 `createOverlay`/`attachSheetDrag` 다시 쓰기)로, 결과는 칩으로 보인다. 범위를 입력과 떼어 놓아 노트로 넓히기에도 좋다. 처음에 채택했다. 채택 안 함 2026-06-08 · 이유: 하단 모핑 탭 바의 검색 pill과 함께 떠 검색창이 둘로 보였다.
- **책 목록 전체를 여러 권 고르는 라우트**: 화면 전환이 무겁고, 결과로 돌아오는 흐름이 번거롭다.

### B. 「결과 내 검색」의 뜻

- **낱말을 더해 좁히기(AND)**: 워커에 여러 낱말 AND를 더한다. 기존의 단일 부분 문자열 훑기(ADR-005 C안)와 자연스럽게 합쳐진다. 처음에 채택했다. 채택 안 함 2026-06-09 · 이유(사용자 보고): ① 모바일에서 좁히기 화면이 검색 바 공간을 차지해 어색했다. ② 데스크톱에서 좁히기 토큰이 검색 입력과 겹쳤다. ③ 좁히기 입력을 연 뒤 ×(지우기)를 누르면 정해지지 않은 동작으로 그냥 검색 화면으로 돌아갔다. 재검토 조건: 더 나은 방식의 결과 내 검색을 다시 들일 때, 이 ADR의 설계 기록을 출발점으로 삼는다.
  - 없앤 범위(전부 지웠다): 워커의 `andTerms`와 `gatherResults` AND 매치, URL `and=`(`parsePath`·`buildSearchUrl`·`buildSearchPagination`·`currentSearchState`·`navigateSearch`), `mountSearchField`의 좁히기 토큰(`.token-refine-add`, `.token-refine-input`)과 Backspace AND 분기, `syncOneField`의 AND 칩 그리기, `renderSearchView`의 `and=` 떼기, `css/style.css`의 `.token-refine-*` 규칙, 관련 유닛 테스트. **책 picker(`in=`), 최근 검색, in:&lt;별칭&gt; 옮기기는 남긴다.** 옛 `and=`가 URL에 남아도 `parsePath`가 더는 읽지 않아 문제없이 무시된다. 유닛 683 통과, tsc 0, 브라우저 스모크(좁히기 UI 없음, 보통 검색과 `in:` 검색, 옛 `and=` 무시)를 확인했다.
  - 2026-06-08의 토큰 방식에서는 「결과 내 검색」(AND)을 지울 수 있는 칩과, 쿼리가 있을 때만 보이는 **「＋ 좁히기」 고스트 토큰**(`.token-refine-add`)으로 보였다. 누르면 칩 사이에 **작은 인라인 입력**(`.token-refine-input`)이 펼쳐져 Enter로 AND 토큰을 더했다(줄 전체 폭 입력이 아니라 토큰 크기라 「두 번째 검색창」으로 보이지 않게 했다). Backspace는 AND 토큰을 먼저, 그다음 책 토큰을 지웠다.
- 결과에 나온 책으로 범위 좁히기: 책 picker와 기능이 겹친다.
- 단순한 새 검색: 사용자가 기대하는 「결과 안에서」가 아니다.

### C. 필터 상태를 둘 곳

- **URL에 담기 (채택)**: `?q=…&in=<bookId>&page=…&and=<낱말>`(되풀이하는 파라미터). 히스토리, 뒤로/앞으로, 탭 복원(ADR-031), 쪽 넘김, 공유 링크가 모두 일관되게 동작한다. `and=`는 2026-06-09에 없앴다.
- 모듈 안의 상태: 히스토리 복원과 쪽 넘김에서 필터가 사라진다.

### 그 밖에 바뀐 것

- **빈 검색에서 모핑 pill의 맨 앞을 돋보기로 (2026-06-08부터 06-09까지)**: 모핑 검색 pill이 빈 검색(쿼리와 책 범위가 모두 없음)이면 왼쪽 맨 앞 아이콘을 **돋보기**로 두고 깔때기(책 선택)를 숨겼다(`#tab-dock.search-empty`, 「아직 검색 전」이라는 신호, 사용자 선택). 채택 안 함 2026-06-09 · 이유: 실제로 써 보니 빈 쿼리에서 책 범위를 정하는 길(깔때기)이 사라져 어색하다는 의견이 있었다. `#tab-dock.search-empty` 클래스와 그 토글(search.js syncOneField), 돋보기를 바꾸는 CSS 2줄을 지웠다.
- **데스크톱에서 책 선택 시트를 가운데 모달로 (2026-06-11까지)**: 처음 D3은 「모바일 바텀 시트 / **데스크톱 가운데 모달**」이었다. 채택 안 함 2026-06-11 · 이유: 북마크 드로어, 인용 시트와 같은 오른쪽 사이드 패널로 맞췄다(위 「책 선택 시트」).

## 결정 상세

### D1. URL 스키마 (`parsePath`)

```
/search?q=<키워드>&page=<n>&in=<bookId>&in=<bookId>&and=<낱말>&and=<낱말>
```

- `in`: 책 picker 범위. 책마다 **book id**(예: `john`, `1cor`)를 되풀이한다. 워커의 타이핑 `in:<별칭>` 토큰과 합집합(OR)으로 합친다.
- `and`: 결과 내 검색의 AND 낱말. 낱말마다 되풀이했다. 2026-06-09에 없앴다.
- `page` 1은 뺀다. 빈 상태는 `/search`다.
- `parsePath`가 `{ view:"search", query, page, filterBooks:string[], andTerms:string[] }`를 돌려줬다. 지금은 `andTerms`가 없다.

### D2. 워커 프로토콜 (`search-worker.js`)

- `search` 메시지에 `scopeBooks: string[]`(book id), `andTerms: string[]`를 더했다. `andTerms`는 2026-06-09에 없앴다.
- `scopeBooks`를 `parseQuery`가 만든 `restrictBooks`에 합친다(합집합).
- `gatherResults(q, chunks, restrictBooks, andTerms)`: 절 텍스트가 `q`를 담고 **모든** `andTerms`도 담을 때만 맞는 것으로 보았다(소문자 비교). 부분 문자열 선형 훑기(ADR-005)를 유지한다. 지금은 `andTerms` 인자가 없다.

### D3. UI / UX

- **옵션 바(`.search-filters`)**: 처음에는 빈 검색 뷰와 결과 뷰 위에 함께 그렸다(모바일과 데스크톱). 범위 줄(책 선택 버튼과 책 칩)과, 검색어가 있을 때의 결과 내 검색 줄(더한 낱말 칩과 입력)이었다. 2026-06-08에 검색 필드 안 토큰으로 바꿨다.
- **책 선택 시트(`#book-filter-sheet`)**: 모바일 바텀 시트 / 데스크톱 사이드 패널(2026-06-11, 처음에는 가운데 모달). 분류(구약, 외경, 신약, 외경 설정 반영)별 묶음, 행마다 여러 권 선택(체크), 「적용 (N)」이 한 번의 이동으로 URL 범위를 커밋하고, 「초기화」로 비운다. `createOverlay`(scrim, focus trap, inert, Esc, 바깥 누름)와 `attachSheetDrag`를 다시 쓴다. 다른 12개 오버레이와 같이 **`route()`에서 닫는다.** 처음에는 `window.closeBookFilterSheet`가 `closeIfOpen("book-filter-sheet", …)`를 호출했고, 지금은 `route()`가 오버레이 등록부를 돌며 모두 닫는다(`window.appOverlay.closeAllOverlays()`, `js/app/routing.js`). 시트를 연 채 떠나도 scrim이나 inert가 남지 않는다. `openBookFilterSheet`는 전에 드래그 리사이즈로 남은 인라인 높이를 매번 지운다(ADR-032 cite-sheet 방식).
- **데스크톱의 빈 `/search`**: 기본은 책 목록이다(기존 동작 유지). 다만 URL에 켜진 필터(`in=`, 그때는 `and=`도)가 있으면 검색 뷰(필터, 칩, 최근 검색)를 그려 범위가 **보이고 지울 수 있게** 한다. 그렇지 않으면 헤더 검색이 숨은 범위를 조용히 적용한다. 빈 뷰의 페이지 안 입력은 모바일 전용이다(데스크톱은 헤더 바). `renderSearchView`는 칩 이름이 id로 깜빡이지 않도록 `await ensureBookMap()` 뒤에 그린다.
- **칩**: 라벨과 ×. 책 칩을 지우면 그 책만 범위에서 빠진다. 더한 낱말 칩을 지우면 그 AND 낱말이 빠졌다(2026-06-09에 없앴다).
- **최근 검색**: 빈 쿼리 뷰에서 목록을 보인다(없으면 기존 안내와 검색 예시). 행을 누르면 `commitTopSearch`, ×는 `removeSearchHistory`, 「지우기」는 `clearSearchHistory`다. ADR-014의 저장 모델(`bible-search-history`, 로컬 전용)을 그대로 쓰고, 헤더 ▾ 드롭다운과 같은 저장소를 함께 써서 맞는다. 행마다 오른쪽에 **검색한 날짜(절대 표기 `YYYY. M. D.`, `formatSearchDate`)**를 보인다. 이를 위해 저장 모델에 `ts` 타임스탬프를 더했다(ADR-014, 2026-06-07. 상대 표기는 채택하지 않았고, 기간 만료도 없다). 최대 30개(LRU)와 기간 컷 없음은 그대로다.
- **상태를 지키는 규칙**: 새 검색어를 커밋하면(`commitTopSearch`) 책 범위는 **남기고**, 결과 내 검색과 쪽은 **처음으로 되돌렸다**(지금은 쪽만). 필터를 바꾸면 쪽을 1로 되돌리고 `searchAutoNavigate`를 세우지 않는다(절 참조로 저절로 가는 것은 Enter로 커밋할 때만).

### D4. 노트 검색 대비

처음에는 범위를 검색어 필드와 떼어 따로 된 바에 두기로 했다. 노트 기능을 들일 때 책 picker 위에 성서/노트 세그먼트를 끼우고, 워커에 노트 인덱스 청크를 더하는(ADR-005의 확장 지점) 방식으로 넓힌다. 2026-06-08에 옵션 바를 필드 안 토큰으로 바꿨으므로, 세그먼트를 어디에 둘지는 노트 검색을 시작할 때 다시 정한다.

## 영향 범위

이 ADR을 처음 구현할 때(2026-06-07) 바꾼 파일이다.

| 파일 | 변경 |
| --- | --- |
| `js/search-worker.js` | `search` 메시지 `scopeBooks`/`andTerms`, `gatherResults` AND 매치, `restrictBooks` 합치기 |
| `js/app/views-routing.js` | `parsePath` 검색 라우트에 `filterBooks`/`andTerms`, `route()`가 `renderSearchResults`/`renderSearchView`에 넘김 |
| `js/app/search.js` | `buildSearchUrl`, 필터를 아는 `buildSearchPagination`, `navigateSearch`/`currentSearchState`, `buildSearchFilterBar`와 칩, 책 선택 시트(`openBookFilterSheet`), 최근 검색 목록, `doSearch` opts, `commitTopSearch` 상태 지키기 |
| `css/style.css` | 옵션 바, 칩, 결과 내 검색 입력, 최근 검색 목록, 책 선택 시트 스타일 |
| `js/types.d.ts` | `renderSearchResults`/`renderSearchView` 시그니처 갱신 |
| `tests/unit/search.test.js` | `buildSearchUrl`와 필터를 아는 `buildSearchPagination` 회귀 |

라우팅, 시트, DOM 동작은 e2e가 맡는다(ADR-013). 순수 로직(URL 만들기, 쪽 넘김)은 유닛이 맡는다.

## 참고

- ADR-005 (검색 인덱싱과 `in:` 연산자), ADR-014 (검색 히스토리와 44px 터치 영역)
- ADR-032 (`createOverlay`/`attachSheetDrag` 다시 쓰기)
- Apple HIG — Searching (scope bar · recents · filtering)
