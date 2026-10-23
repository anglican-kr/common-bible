# ADR-014: 검색 히스토리 + 검색 입력창 터치 타깃

- 일시: 2026-05-07
- 상태: 승인됨 — 적용 완료 (`js/app/search.js`의 `createSearchHistoryController`)
- 관련 ADR: ADR-005(검색 인덱싱), ADR-001(SPA), ADR-033(검색 옵션 — 진입 시 최근 검색 목록·타임스탬프)

## 결정

검색 입력창에 최근 검색어 드롭다운 패널을 더한다. **기본 10개를 보이고**(`SEARCH_HISTORY_VISIBLE`), 그보다 많으면 「더 보기」로 펼쳐 **저장 한도 30개**(`SEARCH_HISTORY_MAX`)까지 보인다. 입력창의 보조 버튼(지우기 ×, 히스토리 ▾, 시트 닫기 ×)은 모두 **WCAG 2.5.5 AAA 권장치인 44 × 44 CSS px 이상**으로 키운다.

검색어는 `localStorage["bible-search-history"]`에 **로컬 전용**으로 저장한다(Drive로 동기화하지 않는다). 2026-06-07부터는 검색어마다 검색한 시각도 저장하고, 검색 화면의 최근 검색 목록에 날짜를 보인다(아래 D1, D2).

## 맥락

ADR-005가 검색 인덱싱 전략을 다룬 뒤, 실제 사용에서 두 가지 불편이 쌓였다.

### 1. 같거나 비슷한 검색을 되풀이할 때의 입력 비용

검색 쿼리는 낱말 하나보다 여러 낱말이나 연산자를 섞은 것이 많다.

- `사랑 in:요한` 같은 `in:` 연산자(ADR-005 「검색 연산자 `in:`」, 2026-05-05)
- `예수께서 말씀하시기를` 같은 긴 인용
- 한국어 IME의 특성상 오타와 다시 치는 비용이 크다.

같은 쿼리를 다시 칠 때마다 처음부터 IME로 입력해야 했다.

### 2. 보조 버튼을 누르기 어렵다

당시 검색 UI 보조 버튼의 실측 크기:

| 버튼 | 위치 | 크기 (CSS px) |
| --- | --- | --- |
| `#search-clear` (상단 ×) | `padding: 0.15em 0.25em` 만 | ~16–20 |
| `#search-sheet-clear` (시트 ×) | `padding: 0.2em 0.3em` 만 | ~18–22 |
| `#search-sheet-close` (시트 닫기) | `2rem × 2rem` | 32 × 32 |

Apple HIG는 44 × 44 pt, Material은 48 × 48 dp, WCAG 2.5.5 AAA는 44 × 44 CSS px를 권하는데, 셋 다 모자랐다. 시각이나 운동에 도움이 필요한 사용자가 지우기 버튼을 누를 때, 옆 영역(input 텍스트, 닫기 버튼)을 잘못 누르는 일이 있었다.

또 검색 히스토리 드롭다운을 더하면 ▾ 토글이 하나 늘어나는데, 이것을 같은 기준으로 설계해 두지 않으면 같은 회귀가 되풀이된다.

## 검토한 대안

### A. UI: 운영체제 기본 picker (`<select>` 또는 `<datalist>`)

- 장점: 구현이 거의 필요 없고, 키보드와 화면 낭독기를 자연스럽게 지원한다.
- 단점:
  - iOS Safari의 `<select>`는 휠 피커를 띄워, 히스토리를 훑어보는 데 맞지 않는다.
  - 항목별 삭제 같은 부가 동작을 넣을 수 없다.
  - 시각적 일관성: 기존 검색 시트는 커스텀 UI(`+ in:` 칩, `role="dialog"`)인데, picker만 OS 모양이 된다.

### B. UI: 커스텀 드롭다운 패널 (채택)

- 장점:
  - iOS, Android, 데스크톱 모두 같은 UX다.
  - 항목별 × 삭제와 「모두 지우기」 푸터를 둘 수 있다.
  - 기존 검색 시트와 시각, 접근성 토큰(색상, focus ring, ARIA)을 함께 쓴다.
- 단점:
  - 키보드 이동(↑↓/Enter/Esc)과 ARIA combobox 패턴을 직접 구현해야 한다.

### C. 저장 모델: Drive 동기화 포함과 로컬 전용 (로컬 전용 채택)

- Drive 동기화 포함: 기기끼리 검색어를 함께 쓴다. 다만 검색어는 행동 데이터라, 클라우드에 남기는 것이 개인 정보 측면에서 부담이다.
- 로컬 전용: `localStorage`에만 저장한다. 기기마다 따로 쌓인다. 개인 정보 면에서 안전하다.

설정(`fontSize`, `colorScheme`, `theme`, `bookOrder`, `startupBehavior`)은 `syncStoreV2.saveSetting`으로 Drive에 동기화한다. 하지만 **검색어는 설정이 아니라 휘발성 행동 데이터**라 성격이 다르다. 또 OAuth scope가 늘지 않더라도, 사용자는 「내가 무엇을 검색했는지가 다른 기기에 보인다」는 데 거부감을 가질 수 있다.

### D. 터치 타깃: 데스크톱과 모바일을 나누기, 같은 기준 쓰기 (같은 기준 채택)

- 나누기(데스크톱 32 × 32, 모바일 44 × 44): 데스크톱 헤더 공간을 아낀다.
- 같은 기준(양쪽 44 × 44): 시각이나 운동에 도움이 필요한 데스크톱 사용자(화면 확대기, 손이 떨려 마우스를 쓰기 어려운 사용자)에게도 같은 도움이 된다. 코드와 CSS 분기도 단순해진다.

### E. 날짜 없는 `string[]` 저장 (2026-06-07까지)

- 처음에는 검색어 문자열만 `string[]`로 저장했다.
- 채택하지 않음 2026-06-07 · 이유: ADR-033이 빈 쿼리로 `/search`에 들어오면 최근 검색 **목록**을 보이게 하면서, 행마다 「언제 검색했는지」를 보일 수 있게 저장 모델을 넓혔다(아래 D1).

### F. 상대 날짜 표기(「n일 전」) (2026-06-07)

- 검색한 날짜를 「n일 전」처럼 보이는 안.
- 채택하지 않음 2026-06-07 · 이유: **절대 표기 하나로 통일**했다(`YYYY. M. D.`, 아래 D2).

## 결정 상세

### D1. 저장 모델

- **키**: `SEARCH_HISTORY_KEY = "bible-search-history"`(`bible-*` 컨벤션과 같다)
- **형식**: `SearchHistoryEntry[]`(`{ q: string, ts: number | null }`, 2026-06-07부터). 인덱스 0이 가장 최신이다. `ts`는 검색한 시각(ms)이고, `pushSearchHistory`가 `ts: Date.now()`를 적는다. 처음 형식은 `string[]`였다(「검토한 대안」 E).
- **하위 호환**: 기존 `string[]`는 읽을 때 `{ q, ts: null }`로 조용히 자동 마이그레이션한다(`loadSearchHistoryEntries`). 잘못된 항목(빈 q, q 없음, 문자열이나 객체가 아님)은 버린다.
- **API**: `loadSearchHistory()`는 **여전히 `string[]`**(쿼리만)를 돌려준다. 그래서 헤더 ▾ 드롭다운과 기존 호출부는 바뀌지 않는다. 새로 둔 `loadSearchHistoryEntries()`가 `{ q, ts }`를 돌려줘 날짜를 그릴 수 있다.
- **정규화**: `String(q).trim().replace(/\s+/g, " ")`를 한 뒤 비교한다.
- **LRU**: 같은(정규화한) 쿼리가 이미 있으면 지우고 맨 앞에 다시 넣는다.
- **저장 한도**: `SEARCH_HISTORY_MAX = 30`. 넘치면 가장 오래된 항목부터 버린다.
- **기본 표시 한도**: `SEARCH_HISTORY_VISIBLE = 10`. 11번째부터는 「더 보기」 토글로 펼친다.
- **기간 만료 없음**: 타임스탬프는 보여 주기 위한 것이다. 보존은 여전히 개수(30) LRU 한도만 따른다.
- **저장 시점**: 키워드 검색이 실제로 시작되는 단 하나의 진입점에서 저장한다. 절 참조 매칭(`refMatch`)이나 빈 쿼리는 저장하지 않는다.
- **Drive 비동기화**: `syncStoreV2.saveSetting`을 부르지 않는다. 다른 설정 저장 경로와 다르다는 점을 코드 주석으로 적는다.
- **유닛**(2026-06-07): `storage.test.js`(마이그레이션과 타임스탬프 회귀 +5), `search.test.js`(`formatSearchDate` +3).

### D2. UI / UX

- **트리거**: 입력창 오른쪽의 ▾ 토글 버튼(`#search-history-toggle`, `#search-sheet-history-toggle`)
- **보이기**: 히스토리가 0건이면 토글 자체를 `hidden`으로 둔다. 첫 검색 뒤에 저절로 보인다.
- **패널**: `role="listbox"`. 입력창 바로 아래에 둔다(상단 헤더에서는 absolute, 시트에서는 in-flow).
- **항목 구조**: 본문 영역(`role="option"`)과 개별 삭제 버튼(`×`). 3건 이상이면 푸터에 「모두 지우기」를 둔다.
- **조금씩 펼치기**: 저장된 항목이 `SEARCH_HISTORY_VISIBLE`(=10)을 넘으면 패널 아래에 `더 보기 (N개)` 토글을 둔다. 누르면 30개까지 펼치고, 패널을 닫았다가 다시 열면 다시 10개로 시작한다.
- **상호작용**:
  - 항목 본문을 누르거나 Enter → 입력창에 채우고 바로 검색한다.
  - 항목의 ×를 누르면 → 그 항목만 지우고 패널은 그대로 둔다.
  - 바깥을 누르거나 ESC, 토글을 다시 누르면 → 패널을 닫는다.
- **키보드**: ↑/↓로 이동하고 Enter로 고르며 ESC로 닫는다. `aria-activedescendant`로 input의 포커스를 지킨다.
- **날짜 표기**(2026-06-07): `formatSearchDate(ts)`가 `YYYY. M. D.` 한 형식으로 적는다(`ts`가 null이면 빈 문자열이라 날짜를 생략한다). 날짜는 검색 화면(`/search`)의 최근 검색 목록 행에만 보인다. 드롭다운은 전처럼 날짜 없이 보인다.

### D3. 터치 타깃

- 입력창의 보조 버튼은 모두 `width/height: 44px`이고, 누르는 영역에 padding과 border-radius를 적용한다.
  - `#search-clear`, `#search-history-toggle`(상단 헤더)
  - `#search-sheet-clear`, `#search-sheet-history-toggle`, `#search-sheet-close`(시트)
- 입력창 자체는 `min-height: 44px`로 두어, 안쪽의 absolute 버튼이 input 경계를 넘지 않게 한다.
- 히스토리 패널의 항목과 항목 삭제 버튼도 모두 44 × 44 이상이다.
- `:focus-visible`이면 `box-shadow`로 3:1 이상의 대비를 확보한다.

### D4. 모바일 시트 통합

검색 시트(`#search-sheet`)는 컴팩트 상태에서 `height: calc(6.4rem + env(safe-area-inset-bottom))`로 고정돼 있어, 히스토리 패널을 그대로 띄우면 잘린다. CSS `:has()`로 패널이 열리면 시트 높이를 저절로 늘린다.

```css
#search-sheet[data-state="compact"]:has(#search-sheet-history:not([hidden])) {
  height: auto;
  max-height: min(70vh, 28rem);
}
```

## 근거

1. **로컬 전용 저장**: 검색어는 설정이 아니라 행동 데이터다. 개인 정보의 비용이 기기끼리 함께 쓰는 가치보다 크다.
2. **커스텀 드롭다운**: iOS `<select>`의 휠 피커는 히스토리 UX와 맞지 않고, 항목별 삭제 같은 꼭 필요한 기능을 넣을 수 없다.
3. **저장 30과 표시 10을 나눈다**: 성경 공부에서는 며칠이나 몇 주 간격으로 같은 쿼리를 다시 찾는다. 저장 한도가 너무 작으면 그 가치가 사라진다. 그러나 모바일 패널에서 30개를 처음부터 보이면 훑어보는 비용이 크다. 그래서 최근 10개를 먼저 보이고, 나머지는 사용자가 요청할 때 펼친다.
4. **44 × 44를 한꺼번에 적용**: 데스크톱과 모바일을 나누면 코드와 CSS의 분기가 늘어 회귀 비용이 커진다. 시각 보조가 필요한 데스크톱 사용자도 도움을 받는다.
5. **`:has()`에 기댄다**: 안드로이드와 iOS WebView, Chrome 105+, Safari 15.4+가 지원한다. PWA가 대상으로 하는 환경을 만족한다.

## 영향 범위

| 파일 | 변경 |
| --- | --- |
| `js/app.js` | 헬퍼 5개(`normalizeSearchQuery`/`load`/`push`/`remove`/`clearSearchHistory`), 컨트롤러 팩토리 1개, Enter/입력/클리어 핸들러 갱신, `commitTopSearch`/`commitSheetSearch` 진입점 분리 |
| `index.html` | 두 입력창에 ▾ 토글 + listbox 패널 마크업, 입력창 ARIA 속성 갱신 |
| `css/style.css` | 입력창 `min-height ≥ 44px`, 보조 버튼 `44×44`, 히스토리 패널 스타일, `:has()` 시트 확장 룰 |
| `tests/unit/storage.test.js` | 정규화·LRU·dedupe·한도·영구 저장 회귀 (vm 슬라이스 하네스). 이 ADR을 쓸 때는 `search-history.test.js`였으나, ADR-013 「테스트 파일 이름」(2026-05-09)에 따라 `storage.test.js`로 합쳤다 |
| `docs/archive/design/search-history.md` | 그때의 설계 문서 (보관) |

## 참고

- ADR-005 검색 인덱싱 전략(특히 2026-05-05의 「검색 연산자 `in:`」)
- WCAG 2.5.5 (Target Size, AAA)
- Apple HIG — Hit Targets: ≥ 44 pt
- Material Design — Touch Targets: ≥ 48 dp
- 그때의 설계 문서: `docs/archive/design/search-history.md`
