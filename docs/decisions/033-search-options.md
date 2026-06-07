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
- **책 선택 시트(`#book-filter-sheet`)** — 모바일 바텀 시트 / 데스크탑 중앙 모달. 분류(구약·외경·신약, 외경 설정 반영)별 그룹, 행 다중 선택(체크), "적용 (N)"이 한 번의 내비게이션으로 URL 범위 커밋, "초기화"로 비움. `createOverlay`(scrim·focus trap·inert·Esc·외부 탭) + `attachSheetDrag` 재사용.
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
