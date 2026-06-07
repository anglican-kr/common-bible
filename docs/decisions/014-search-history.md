# ADR-014: 검색 히스토리 + 검색 입력창 터치 타깃

- 일시: 2026-05-07
- 상태: 승인됨 — 적용 완료 (`js/app/search.js`의 `createSearchHistoryController`)
- 관련 ADR: ADR-005(검색 인덱싱), ADR-001(SPA), ADR-033(검색 옵션 — 진입 시 최근 검색 목록·타임스탬프)

> **개정 (2026-06-07): 검색어에 타임스탬프 추가 + 절대 날짜 표기.**
> ADR-033이 빈 쿼리 `/search` 진입 시 최근 검색 **목록**을 노출하면서, 각 행에
> "언제 검색했는지"를 보여줄 수 있도록 저장 모델을 확장했다.
>
> - **저장 형식**: `string[]` → `SearchHistoryEntry[]` (`{ q: string, ts: number | null }`).
>   `ts`는 검색 시각(ms). **하위 호환**: 기존 `string[]`는 읽을 때 `{ q, ts: null }`로
>   자동 마이그레이션(소리 없이, `loadSearchHistoryEntries`). 잘못된 항목(빈 q·q 없음·
>   문자열/객체 아님)은 폐기. LRU·dedupe·30개 한도·로컬 전용은 그대로.
> - **API**: `loadSearchHistory()`는 **여전히 `string[]`**(쿼리만) 반환 — 헤더 ▾
>   드롭다운·기존 호출부 무변경. 신규 `loadSearchHistoryEntries()`가 `{ q, ts }`를
>   반환해 날짜를 그릴 수 있게 한다. `pushSearchHistory`가 `ts: Date.now()`를 기록.
> - **표기**: 상대("n일 전") 미채택, **절대 표기로 통일** — `formatSearchDate(ts)`가
>   `YYYY. M. D.` 한 형식으로 출력(`ts`가 null이면 빈 문자열 → 날짜 생략). 진입 화면
>   목록 행에만 표시(드롭다운은 기존대로 날짜 없음).
> - **기간 만료 없음**: 타임스탬프는 표기용. 보존은 여전히 개수(30) LRU 한도만.
> - 유닛: `storage.test.js`(마이그레이션·타임스탬프 회귀 +5), `search.test.js`(`formatSearchDate` +3).

## 결정

검색 입력창에 최근 검색어 드롭다운 패널을 추가한다 — **기본 10개 표시**(`SEARCH_HISTORY_VISIBLE`), 그 이상은 "더 보기"로 펼쳐 **저장 한도 30개**(`SEARCH_HISTORY_MAX`)까지. 입력창의 보조 버튼들(클리어 ×, 히스토리 ▾, 시트 닫기 ×)을 모두 **WCAG 2.5.5 AAA 권장치인 44 × 44 CSS px 이상**으로 키운다.

검색어 저장은 `localStorage["bible-search-history"]`에 **로컬 전용**(Drive 미동기화)으로 유지한다.

## 맥락

ADR-005가 검색 인덱싱 전략을 다룬 이후, 실제 사용자 행동에서 두 가지 마찰이 누적됐다.

### 1. 같은/유사 검색을 반복할 때의 입력 비용

검색 쿼리는 단일 키워드보다 다단어·연산자 조합이 많다.

- `사랑 in:요한` 같은 `in:` 연산자 (ADR-005 2026-05-05 개정)
- `예수께서 말씀하시기를` 같은 긴 인용
- 한국어 IME 특성상 오타·재타이핑 비용이 높음

같은 쿼리를 다시 칠 때마다 처음부터 IME로 입력해야 했다.

### 2. 보조 버튼이 누르기 어려움

현재 검색 UI 보조 버튼의 실측 크기:

| 버튼 | 위치 | 크기 (CSS px) |
| --- | --- | --- |
| `#search-clear` (상단 ×) | `padding: 0.15em 0.25em` 만 | ~16–20 |
| `#search-sheet-clear` (시트 ×) | `padding: 0.2em 0.3em` 만 | ~18–22 |
| `#search-sheet-close` (시트 닫기) | `2rem × 2rem` | 32 × 32 |

Apple HIG는 44 × 44 pt, Material은 48 × 48 dp, WCAG 2.5.5 AAA는 44 × 44 CSS px를 권장하는데, 셋 다 미달이다. 시각·운동 보조가 필요한 사용자가 클리어 버튼을 탭할 때 인접 영역(input 텍스트, 닫기 버튼)을 잘못 누르는 사례가 있다.

또한 검색 히스토리 드롭다운을 추가하면 ▾ 토글이 하나 더 늘어나는데, 이를 동일 기준으로 설계해 두지 않으면 회귀가 반복된다.

## 검토한 대안

### A. UI: 운영체제 기본 picker (`<select>` 또는 `<datalist>`)

- 장점: 구현 0에 가까움, 키보드/스크린리더 자연 지원
- 단점:
  - iOS Safari `<select>`는 휠 피커를 띄움 — 히스토리 탐색 용도로 부적합
  - 항목별 삭제 같은 부가 동작 불가
  - 시각적 일관성: 기존 검색 시트는 커스텀 UI(`+ in:` 칩, `role="dialog"`)인데 picker만 OS 룩이 됨

### B. UI: 커스텀 드롭다운 패널 (채택)

- 장점:
  - iOS·Android·데스크탑 모두 동일 UX
  - 항목별 × 삭제, "모두 지우기" 푸터 가능
  - 기존 검색 시트와 시각·접근성 토큰(색상, focus ring, ARIA) 공유
- 단점:
  - 키보드 내비(↑↓/Enter/Esc)와 ARIA combobox 패턴을 손수 구현해야 함

### C. 저장 모델: Drive 동기화 포함 vs 로컬 전용 (로컬 전용 채택)

- Drive 동기화 포함: 디바이스 간 검색어 공유. 단, 검색어는 행동 데이터라 클라우드에 남기는 것이 프라이버시 측면에서 부담.
- 로컬 전용: `localStorage`에만 저장. 디바이스마다 별도. 프라이버시 안전.

설정(`fontSize`, `colorScheme`, `theme`, `bookOrder`, `startupBehavior`)은 `syncStoreV2.saveSetting`으로 Drive에 동기화하지만, **검색어는 설정이 아니라 휘발성 행동 데이터**라는 성격 차이가 있다. 또한 한 번 저장하면 OAuth scope가 늘지 않더라도 사용자는 "내가 무엇을 검색했는지가 다른 디바이스에 보인다"는 사실에 거부감을 가질 수 있다.

### D. 터치 타깃: 데스크탑/모바일 분리 vs 동일 기준 (동일 기준 채택)

- 분리(데스크탑 32 × 32, 모바일 44 × 44): 데스크탑 헤더 공간 절약
- 동일(양쪽 44 × 44): 시각·운동 보조가 필요한 데스크탑 사용자(스크린 매그니파이어, 떨림이 있는 마우스 사용)에게도 일관 혜택. 또한 코드·CSS 분기 단순화

## 결정 상세

### D1. 저장 모델

- **키**: `SEARCH_HISTORY_KEY = "bible-search-history"` (`bible-*` 컨벤션 일치)
- **형식**: `string[]` — 인덱스 0이 최신
- **정규화**: `String(q).trim().replace(/\s+/g, " ")` 후 비교
- **LRU**: 동일(정규화된) 쿼리가 이미 있으면 제거 후 맨 앞에 다시 push
- **저장 한도**: `SEARCH_HISTORY_MAX = 30`. 초과분은 가장 오래된 항목부터 폐기
- **기본 표시 한도**: `SEARCH_HISTORY_VISIBLE = 10`. 11번째 이상은 "더 보기" 토글로 펼침
- **저장 시점**: 키워드 검색이 실제로 시작되는 단일 진입점에서. 절 참조 매칭(`refMatch`)이나 빈 쿼리는 미저장
- **Drive 비동기화**: `syncStoreV2.saveSetting` 호출 안 함. 다른 설정 저장 경로와의 명시적 차이를 코드 주석으로 명기

### D2. UI / UX

- **트리거**: 입력창 우측 ▾ 토글 버튼 (`#search-history-toggle`, `#search-sheet-history-toggle`)
- **가시성**: 히스토리 0건이면 토글 자체를 `hidden`. 첫 검색 후 자동 노출
- **패널**: `role="listbox"`, 입력창 바로 아래 (상단 헤더에선 absolute, 시트에선 in-flow)
- **항목 구조**: 본문 영역(`role="option"`) + 개별 삭제 버튼(`×`). 3건 이상일 때 푸터에 "모두 지우기"
- **점진 펼침**: 저장된 항목이 `SEARCH_HISTORY_VISIBLE`(=10) 초과 시 패널 하단에 `더 보기 (N개)` 토글. 탭하면 30개까지 펼쳐지고, 패널 닫혔다가 다시 열리면 다시 컴팩트(10개)로 시작
- **상호작용**:
  - 항목 본문 탭/Enter → 입력창에 채우고 즉시 검색 실행
  - 항목 × 탭 → 그 항목만 삭제, 패널은 유지
  - 외부 탭, ESC, 토글 재탭 → 패널 닫힘
- **키보드**: ↑/↓로 이동, Enter로 선택, ESC로 닫기. `aria-activedescendant`로 input 포커스 유지

### D3. 터치 타깃

- 입력창 보조 버튼 모두 `width/height: 44px`, hit area에 padding/border-radius 적용
  - `#search-clear`, `#search-history-toggle` (상단 헤더)
  - `#search-sheet-clear`, `#search-sheet-history-toggle`, `#search-sheet-close` (시트)
- 입력창 자체 `min-height: 44px`로 안쪽 absolute 버튼이 input 경계를 넘지 않도록
- 히스토리 패널 항목과 항목 삭제 버튼도 모두 44 × 44 이상
- `:focus-visible` 시 `box-shadow`로 3:1 이상 대비 확보

### D4. 모바일 시트 통합

검색 시트(`#search-sheet`)는 컴팩트 상태에서 `height: calc(6.4rem + env(safe-area-inset-bottom))`로 고정돼 있어 히스토리 패널을 그대로 띄우면 잘린다. CSS `:has()`로 패널 열림 시 시트 높이를 자동 확장한다.

```css
#search-sheet[data-state="compact"]:has(#search-sheet-history:not([hidden])) {
  height: auto;
  max-height: min(70vh, 28rem);
}
```

## 근거

1. **로컬 전용 저장**: 검색어는 설정이 아닌 행동 데이터. 프라이버시 비용 > 디바이스 간 공유 가치.
2. **커스텀 드롭다운**: iOS `<select>` 휠 피커는 히스토리 UX와 맞지 않고, 항목별 삭제 같은 필수 기능을 제공할 수 없다.
3. **저장 30 / 표시 10 분리**: 성경 공부 패턴은 며칠~몇 주 주기로 같은 쿼리를 재방문한다. 저장 한도가 너무 작으면 그 가치가 사라진다. 그러나 모바일 패널에서 30개 항목을 처음부터 노출하면 시각 탐색 비용이 크다 — 점진 펼침으로 최근 10개 우선, 나머지는 명시적 요청 시.
4. **44 × 44 일괄 적용**: 데스크탑/모바일 분리하면 코드 분기와 CSS 분기가 늘어 회귀 비용 증가. 데스크탑 시각 보조 사용자도 혜택.
5. **`:has()` 의존**: 안드로이드/iOS WebView, Chrome 105+, Safari 15.4+에서 지원. PWA 타깃 환경 충족.

## 영향 범위

| 파일 | 변경 |
| --- | --- |
| `js/app.js` | 헬퍼 5개(`normalizeSearchQuery`/`load`/`push`/`remove`/`clearSearchHistory`), 컨트롤러 팩토리 1개, Enter/입력/클리어 핸들러 갱신, `commitTopSearch`/`commitSheetSearch` 진입점 분리 |
| `index.html` | 두 입력창에 ▾ 토글 + listbox 패널 마크업, 입력창 ARIA 속성 갱신 |
| `css/style.css` | 입력창 `min-height ≥ 44px`, 보조 버튼 `44×44`, 히스토리 패널 스타일, `:has()` 시트 확장 룰 |
| `tests/unit/storage.test.js` | 정규화·LRU·dedupe·한도·영구 저장 회귀 (vm 슬라이스 하네스). 본 ADR 시점엔 `search-history.test.js` 이름이었으나 ADR-013 2026-05-09 명명 컨벤션으로 `storage.test.js`로 통합 |
| `docs/design/search-history.md` | 살아있는 설계 문서 (별도) |

## 참고

- ADR-005 검색 인덱싱 전략 (특히 2026-05-05 개정의 `in:` 연산자)
- WCAG 2.5.5 (Target Size, AAA)
- Apple HIG — Hit Targets: ≥ 44 pt
- Material Design — Touch Targets: ≥ 48 dp
- 살아있는 설계 문서: `docs/design/search-history.md`
