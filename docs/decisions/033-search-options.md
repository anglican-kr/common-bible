# ADR-033: 검색 옵션 (책 picker · 결과 내 검색 · 진입 시 최근 검색)

- 일시: 2026-06-07
- 상태: 승인됨 — 구현 완료 (2026-06-07)
- 관련 ADR: ADR-005(검색 인덱싱·`in:` 연산자), ADR-014(검색 히스토리), ADR-029/030(탭 바·모핑 검색), ADR-031(탭 히스토리), ADR-032(오버레이 컨트롤러)

## 결정

검색 화면에 **검색 옵션 바**를 도입한다. 옛 버전이 `in:` 연산자를 컴팩트 모달 칩으로 노출했던 것을 대체·확장해 다음을 제공한다.

1. **책 picker** — "책 선택" 버튼이 책 선택 시트(분류별 그룹·다중 선택)를 열고, 선택한 책은 입력창 아래 제거 가능한 **칩**으로 표시. 내부적으로는 워커의 책 제한 메커니즘(`in:`/`restrictBooks`)을 재사용한다.
2. **결과 내 검색 (AND)** — 검색어가 있을 때만 노출되는 "결과 내 검색" 입력. 추가한 낱말은 기존 검색어와 **AND** 결합되어 두 낱말이 모두 들어간 절만 남긴다. 추가어도 제거 가능한 칩으로 표시.
3. **진입 시 최근 검색 목록** — 빈 쿼리로 `/search`에 들어오면 "최근 검색" 목록을 보여준다. 행 탭 → 즉시 검색, 행 끝 **×** → 개별 키워드 삭제, 머리글 **"지우기"** → 전체 삭제(Apple Safari/App Store recents 패턴).

**향후 노트 검색**(검색 범위 = 성서/노트)을 대비해, 범위(scope)를 검색어 필드에서 분리한 별도 옵션 바로 격리한다. 노트 기능이 추가되면 책 picker 위에 성서/노트 세그먼트를 같은 바에 끼워 넣는다.

Apple HIG의 검색 패턴(필터/스코프 바 · 토큰 대신 칩 · recents 목록 · 시트 선택)을 따른다.

> **개정 (2026-06-08) — 필터를 검색 필드 안 토큰으로 (대안 A 채택):** 별도 **필터 바**
> (`.search-filters`: 책 선택 버튼 + 칩 줄 + "결과 내 검색" 입력)가 하단 모핑 탭바의 검색
> pill 과 함께 떠 **검색창이 두 개**로 보이는 어색함이 있었다(HIG "single, clearly
> identified location" 위배). 이를 본 ADR 의 **대안 A(검색어 필드 안 토큰, iOS 16 search
> tokens)** 로 전환한다 — 당시 "헤더·in-page·모핑 3개 입력 지점 모두 구현" 비용 때문에
> 보류했던 안.
>
> 비용을 낮춘 구현 방식: `<input>` 을 contenteditable 로 바꾸지 않고 **칩을 input 의 형제로
> 같은 flex 행에 두는** wrapper(`.token-zone`, `display:contents`)를 쓴다. 실제 `<input>`
> 이 그대로라 `.value`·`focus({preventScroll})`·focus/blur·visualViewport 배선(ADR-030)이
> 전부 보존된다. 세 필드(`#search-bar` 헤더 · `#search-inpage-bar` · `#tab-search-dock`
> 모핑 pill)에 `mountSearchField` 로 토큰 존을 끼우고, `syncSearchFields()` 가 매 route
> (routing.js) + 모핑 open(tabbar.js)에서 URL 필터를 칩으로 다시 그린다.
>
> - **책 스코프** = 필드 좌측 **깔때기 버튼**(`.token-funnel`, 책 선택 시트 진입 — 시트는 유지)
>   + 선택된 책마다 제거 가능한 **칩**(`.field-token`).
> - **"결과 내 검색"(AND)** = 제거 가능한 칩 + 쿼리가 있을 때만 보이는 **"＋ 좁히기" 고스트
>   토큰**(`.token-refine-add`); 탭하면 칩들 사이에서 **작은 인라인 입력**(`.token-refine-input`)
>   이 펼쳐져 Enter 로 AND 토큰 추가. (전 줄 전체 폭 입력이 아니라 토큰 크기라 "두 번째
>   검색창" 으로 안 보임.)
> - **Backspace**(caret 0·빈 필드)로 마지막 토큰 제거(AND → 책 순), 칩 × 클릭으로 개별 제거.
> - 모핑 pill 의 토큰은 `body.tabbar-searching` 일 때만 렌더(접힌 dock 엔 칩 없음).
> - **`in:<별칭>` 흡수**: `commitTopSearch` 가 커밋 시 쿼리의 `in:` 연산자를 풀어 book id 로
>   바꿔 `filterBooks`(칩)로 옮기고 `q` 에는 낱말만 남긴다(예제·최근검색·직접 입력 공통) — 토큰 UI 에서
>   연산자가 입력창에 그대로 노출되지 않도록. 못 푼 별칭은 `q` 에 남아 워커가 그대로 처리(graceful).
>   별칭 맵은 books 의 `short_name_ko`/`name_ko` 로 구성하며 **부팅 시 미리 로드**(`ensureAliasMap`
>   kick)해 `commitTopSearch` 는 **동기**로 유지 — async 로 두면 await 경합(stale 적용·flag 잔존)을
>   매번 routeSeq 가드로 막아야 해, 표면 자체를 없앴다.
> - **오버플로**: 토큰이 많으면 `.token-zone`(funnel+칩+좁히기)이 **가로 스크롤**되고, 메인 입력·
>   clear 는 zone 밖이라 항상 닿는다. 탭타깃(funnel·칩 ×·좁히기)은 투명 `::after` 44px 오버레이로
>   `--touch-target` 확보(시각 크기 유지). 책 칩 라벨은 `short_name_ko`(축약명).
>
> `buildSearchFilterBar`/`buildFilterChip` 및 별도 필터 바 제거. **워커·URL(`in=`/`and=`)
> 스키마 무변경** — 필터가 *어떻게 보이는지*만 바뀜. `css/style.css` 의 옛 `.search-filters`
> /`.search-scope-*`/`.search-refine-*`/`.search-chip*` 규칙은 사용처가 사라져 dead(후속 정리).
> 라우팅·시트·모핑 DOM 상호작용은 e2e 책임(ADR-013), 순수 로직(URL·페이지네이션) 유닛
> 회귀 없음(678 통과·tsc 0). **모바일 pill 레이아웃은 디바이스 시각 검증 필요.**

## 맥락

- ADR-005가 `in:<별칭>` 연산자를 도입했고, ADR-030이 옛 검색 시트(`+ in:` 칩)를 제거하면서 책 범위 지정을 **타이핑으로만** 할 수 있게 됐다. 책 이름·별칭을 외워 입력하는 것은 발견성이 낮다.
- ADR-014가 최근 검색을 도입했지만 입력창 ▾ 드롭다운에만 노출돼, 검색 화면 진입 시 바로 보이지 않았다.
- 같은 결과 안에서 더 좁히고 싶을 때(예: "사랑"으로 검색 후 "하느님"이 같이 있는 절만) 방법이 없었다.

## 검토한 대안

### A. 책 picker 노출 방식

- **검색어 필드 안 토큰 (iOS 16 search tokens)**: 가장 모던하지만 헤더 입력·in-page 입력·탭바 모핑 입력 **3곳 모두**에 토큰 렌더를 구현해야 해 복잡도가 큼.
- **필터 영역 + 책 선택 시트 + 칩 (채택)**: 옵션 바를 한 곳(검색 뷰)에 두고, 선택은 시트(ADR-032 `createOverlay`/`attachSheetDrag` 재사용), 결과는 칩으로. 범위 개념을 입력에서 분리해 노트 확장에도 유리.
- **전체 책 목록 멀티셀렉트 라우트**: 화면 전환이 무겁고 결과로 돌아오는 흐름이 번거로움.

### B. "결과 내 검색" 의미

- **키워드 추가로 좁히기 (AND) (채택)**: 워커에 다중 키워드 AND를 추가. 기존 단일 부분문자열 스캔(ADR-005 C안)과 자연스럽게 합쳐짐.
- 결과에 나온 책으로 범위 좁히기: 책 picker와 기능이 겹침.
- 단순 새 검색: 사용자가 기대하는 "결과 안에서"가 아님.

### C. 필터 상태 저장 위치

- **URL 인코딩 (채택)**: `?q=…&in=<bookId>&page=…&and=<낱말>` (반복 파라미터). 히스토리·뒤로/앞으로·탭 복원(ADR-031)·페이지네이션·공유 링크가 모두 일관되게 동작.
- 모듈 내부 상태: 히스토리 복원·페이지네이션에서 필터가 사라짐.

## 결정 상세

### D1. URL 스키마 (`parsePath`)

```
/search?q=<키워드>&page=<n>&in=<bookId>&in=<bookId>&and=<낱말>&and=<낱말>
```

- `in` — 책 picker 범위. **book id**(예: `john`, `1cor`)를 책마다 반복. 워커의 타이핑 `in:<별칭>` 토큰과 합집합(OR)으로 병합.
- `and` — 결과 내 검색 AND 키워드. 낱말마다 반복.
- `page` 1은 생략. 빈 상태는 `/search`.
- `parsePath`가 `{ view:"search", query, page, filterBooks:string[], andTerms:string[] }`를 반환.

### D2. 워커 프로토콜 (`search-worker.js`)

- `search` 메시지에 `scopeBooks: string[]`(book id), `andTerms: string[]` 추가.
- `scopeBooks`를 `parseQuery`가 만든 `restrictBooks`에 병합(합집합).
- `gatherResults(q, chunks, restrictBooks, andTerms)` — 절 텍스트가 `q`를 포함하고 **모든** `andTerms`도 포함할 때만 매치(소문자 비교). 부분문자열 선형 스캔(ADR-005)을 유지.

### D3. UI / UX

- **옵션 바(`.search-filters`)** — 빈 검색 뷰와 결과 뷰 위에 공통 렌더(모바일·데스크탑). 스코프 행(책 선택 버튼 + 책 칩) + (검색어가 있을 때) 결과 내 검색 행(추가어 칩 + 입력).
- **책 선택 시트(`#book-filter-sheet`)** — 모바일 바텀 시트 / 데스크탑 중앙 모달. 분류(구약·외경·신약, 외경 설정 반영)별 그룹, 행 다중 선택(체크), "적용 (N)"이 한 번의 내비게이션으로 URL 범위 커밋, "초기화"로 비움. `createOverlay`(scrim·focus trap·inert·Esc·외부 탭) + `attachSheetDrag` 재사용. 다른 12개 오버레이와 동일하게 **`route()`에서 닫는다**(`window.closeBookFilterSheet` ← `closeIfOpen("book-filter-sheet", …)`) — 시트를 연 채 이탈해도 scrim/inert가 남지 않음. `openBookFilterSheet`는 직전 드래그-리사이즈로 남은 인라인 높이를 매번 초기화(ADR-032 cite-sheet 패턴).
- **데스크탑 빈 `/search`** — 기본은 책 목록(기존 동작 유지). 단, URL에 활성 필터(`in=`/`and=`)가 있으면 검색 뷰(필터 바 + 칩 + 최근 검색)를 렌더해 범위가 **보이고 제거 가능**하도록 한다 — 안 그러면 헤더 검색이 숨은 범위를 조용히 적용. 빈 뷰 in-page 입력은 모바일 전용(데스크탑은 헤더 바). `renderSearchView`는 칩 이름이 id로 깜빡이지 않도록 `await ensureBookMap()` 후 렌더.
- **칩** — 라벨 + ×. 책 칩 제거 → 해당 책만 범위에서 제외, 추가어 칩 제거 → 해당 AND 낱말 제외.
- **최근 검색** — 빈 쿼리 뷰에서 목록 노출(없으면 기존 안내 + 검색 예시). 행 탭 → `commitTopSearch`, × → `removeSearchHistory`, "지우기" → `clearSearchHistory`. ADR-014 저장 모델(`bible-search-history`, 로컬 전용)을 그대로 사용하며 헤더 ▾ 드롭다운과 같은 저장소를 공유해 동기화. 각 행 우측에 **검색한 날짜(절대 표기 `YYYY. M. D.`, `formatSearchDate`)** 를 표시 — 이를 위해 저장 모델에 `ts` 타임스탬프를 추가했다(ADR-014 개정 2026-06-07; 상대 표기 미채택, 기간 만료 없음). 최대 30개(LRU)·기간 컷 없음은 유지.
- **상태 보존 규칙** — 새 검색어 커밋(`commitTopSearch`)은 책 범위는 **유지**, 결과 내 검색·페이지는 **리셋**. 필터 변경은 페이지를 1로 리셋하고 `searchAutoNavigate`를 설정하지 않음(절 참조 자동 점프는 Enter 커밋에서만).

### D4. 노트 검색 대비

스코프를 검색어 필드에서 분리한 별도 바로 둔다. 노트 기능 도입 시 책 picker 위에 성서/노트 세그먼트를 끼우고, 워커에 노트 인덱스 청크를 추가(ADR-005 확장 지점)하는 형태로 확장한다.

## 영향 범위

| 파일 | 변경 |
| --- | --- |
| `js/search-worker.js` | `search` 메시지 `scopeBooks`/`andTerms`, `gatherResults` AND 매치, `restrictBooks` 병합 |
| `js/app/views-routing.js` | `parsePath` 검색 라우트에 `filterBooks`/`andTerms`, `route()`가 `renderSearchResults`/`renderSearchView`에 전달 |
| `js/app/search.js` | `buildSearchUrl`, 필터 인지 `buildSearchPagination`, `navigateSearch`/`currentSearchState`, `buildSearchFilterBar`·칩, 책 선택 시트(`openBookFilterSheet`), 최근 검색 목록, `doSearch` opts, `commitTopSearch` 상태 보존 |
| `css/style.css` | 옵션 바·칩·결과 내 검색 입력·최근 검색 목록·책 선택 시트 스타일 |
| `js/types.d.ts` | `renderSearchResults`/`renderSearchView` 시그니처 갱신 |
| `tests/unit/search.test.js` | `buildSearchUrl` + 필터 인지 `buildSearchPagination` 회귀 |

라우팅·시트·DOM 상호작용은 e2e 책임(ADR-013). 순수 로직(URL 빌드·페이지네이션)은 유닛.

## 참고

- ADR-005 (검색 인덱싱·`in:` 연산자), ADR-014 (검색 히스토리·44px 터치타깃)
- ADR-032 (`createOverlay`/`attachSheetDrag` 재사용)
- Apple HIG — Searching (scope bar · recents · filtering)
