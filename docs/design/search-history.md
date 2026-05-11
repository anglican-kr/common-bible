# 검색 히스토리 설계

> 이 문서는 구현을 진행하면서 갱신한다.
> 시점 고정 결정 기록은 ADR-014.

- 작성: 2026-05-07
- 상태: **완료** — `js/app/search.js`의 `createSearchHistoryController` 운영 중. 저장 한도 30개·기본 표시 10개·"더 보기" 점진 펼침·키보드 자동 펼침 모두 적용
- 유닛 테스트: 검색 이력 33 케이스(PR #106, `tests/unit/storage.test.js`의 search-history 영역) + HISTORY_CONTROLLER 33 케이스(PR #113, `tests/unit/search.test.js`)
- 관련 ADR: ADR-001(SPA), ADR-005(검색 인덱싱), ADR-014(검색 히스토리 + 터치 타깃 — '제안됨' → '승인·적용 완료'로 갱신됨)

---

## 1. 개요

### 1.1 목적

검색 입력창에 최근 검색어 최대 10개를 보여주는 드롭다운 패널을 추가한다. 같은/유사 쿼리(`사랑 in:요한`, `예수께서 말씀하시기를` 같은 다단어 / 연산자 조합)를 매번 다시 타이핑하는 비용을 제거한다. 더불어 입력창의 모든 보조 버튼을 WCAG 2.5.5 AAA(44 × 44 CSS px) 이상으로 키워 시각·운동 보조가 필요한 사용자의 탭 정확도를 확보한다.

### 1.2 대상 범위

- `index.html` — 두 입력창 (상단 헤더 + 모바일 시트) 마크업
- `css/style.css` — 보조 버튼 hit area, 히스토리 패널 스타일, 시트 `:has()` 확장 룰
- `js/app.js` — 저장 헬퍼 5개, 컨트롤러 팩토리, Enter/입력/클리어 핸들러 갱신
- `tests/unit/storage.test.js` — vm 슬라이스 하네스 + 회귀 케이스 (ADR-013 2026-05-09 명명 컨벤션 적용 후. 그 전엔 `search-history.test.js`)

### 1.3 비대상

- 검색 인덱싱 알고리즘 변경 — ADR-005 채택 그대로 (선형 스캔 + `String.includes`)
- 검색 결과 UI 변경 — `runSheetSearch`/`renderSearchResultList` 그대로
- Drive 동기화 — 저장은 `localStorage` 전용
- 자동완성/제안 — 단순 히스토리만, 별칭 자동완성·인기 검색어는 비대상

---

## 2. 현재 상태 (출발점)

### 2.1 검색 UI 흐름

```
                ┌─ 데스크탑(>768px) ─ #search-bar (헤더 안)
   사용자 입력 ─┤
                └─ 모바일(≤768px) ─ #search-fab → #search-sheet (compact ↔ expanded)
```

- 데스크탑: `#search-input`에서 직접 라이브 검색. Enter → `/search?q=...`로 navigate
- 모바일: FAB 또는 헤더 바 탭 → 시트 컴팩트 상태(입력창 + `+ in:` 칩만). Enter → 시트 expanded로 전환 + `runSheetSearch`

### 2.2 현재 보조 버튼 측정값

| 버튼 | 기존 CSS | 실측 hit area |
| --- | --- | --- |
| `#search-clear` | `padding: 0.15em 0.25em` | ~16–20 px |
| `#search-sheet-clear` | `padding: 0.2em 0.3em` | ~18–22 px |
| `#search-sheet-close` | `2rem × 2rem` | 32 × 32 px |
| `#search-input` 자체 높이 | font 0.78 + padding 0.35 × 2 ≈ 1.4rem | ~26 px |
| `#search-sheet-input` 자체 높이 | font 0.95 + padding 0.55 × 2 ≈ 2.05rem | ~39 px |

모두 44 × 44 미달.

### 2.3 기존 저장 키 컨벤션

`js/app.js` 상단:

```js
const STORAGE_KEY = "bible-last-read";
const FONT_SIZE_KEY = "bible-font-size";
const THEME_KEY = "bible-theme";
const BOOK_ORDER_KEY = "bible-book-order";
const COLOR_SCHEME_KEY = "bible-color-scheme";
const STARTUP_BEHAVIOR_KEY = "bible-startup";
const AUDIO_POS_KEY = "bible-audio-pos";
const BOOKMARK_KEY = "bible-bookmarks";
const INSTALL_NUDGE_KEY = "bible-install-nudge";
```

신규 키는 `bible-search-history`로 컨벤션 준수.

---

## 3. 데이터 모델

### 3.1 저장 형식

```js
const SEARCH_HISTORY_KEY = "bible-search-history";
const SEARCH_HISTORY_MAX = 30;       // 저장 한도 (LRU)
const SEARCH_HISTORY_VISIBLE = 10;   // 패널 기본 표시 한도

// localStorage["bible-search-history"] 값:
JSON.stringify(["사랑 in:요한", "은혜", "빌라도", ...])  // 최대 30개, 인덱스 0이 최신
```

저장과 표시를 분리한 이유: 성경 공부 패턴은 며칠~몇 주 주기로 같은 쿼리를 재방문하므로 30개 정도의 깊은 이력이 가치를 준다. 그러나 모바일 패널에서 30개를 처음부터 노출하면 시각 탐색 비용이 크다 — 패널은 기본 10개만 보여주고 나머지는 "더 보기"로 점진 펼친다.

### 3.2 정규화 규칙

`pushSearchHistory`/`removeSearchHistory`는 입력값을 정규화 후 비교한다.

```js
function normalizeSearchQuery(q) {
  return String(q || "").trim().replace(/\s+/g, " ");
}
```

- `"  사랑   in:요한  "` → `"사랑 in:요한"`
- `null`, `undefined`, `42` → `""`

이로써 `"사랑 in:요한"`과 `"사랑  in:요한"` (공백 두 개)을 동일 쿼리로 dedupe.

### 3.3 LRU 동작

```js
function pushSearchHistory(q) {
  const norm = normalizeSearchQuery(q);
  if (!norm) return loadSearchHistory();
  const list = loadSearchHistory().filter((s) => s !== norm);  // 기존 항목 제거
  list.unshift(norm);                                          // 맨 앞에 push
  const trimmed = list.slice(0, SEARCH_HISTORY_MAX);            // 한도
  saveSearchHistory(trimmed);
  return trimmed;
}
```

예시:
1. 빈 상태 → `push("사랑")` → `["사랑"]`
2. `push("은혜")` → `["은혜", "사랑"]`
3. `push("진리")` → `["진리", "은혜", "사랑"]`
4. `push("사랑")` → `["사랑", "진리", "은혜"]` (재방문 시 최신으로 이동)
5. 30개를 채운 뒤 31번째 push → 가장 오래된 항목 1개 폐기, 새 항목 인덱스 0

### 3.4 방어적 로딩

```js
function loadSearchHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY));
    if (!Array.isArray(raw)) return [];
    return raw.filter((s) => typeof s === "string" && s.length > 0)
              .slice(0, SEARCH_HISTORY_MAX);   // 저장 한도 (30)
  } catch (_) {
    return [];
  }
}
```

- 사용자가 DevTools로 손댄 malformed JSON → `[]`
- 키가 객체/숫자 등 비배열 → `[]`
- 항목 중 비문자열·빈 문자열 → 필터링

### 3.5 Drive 비동기화

```js
// fontSize 같은 설정 저장:
localStorage.setItem(FONT_SIZE_KEY, value);
window.syncStoreV2?.saveSetting("fontSize", value);   // ← Drive 동기화
if (window.driveSync) window.driveSync.scheduleUpload();

// 검색 히스토리 저장 (의도적 차이):
localStorage.setItem(SEARCH_HISTORY_KEY, value);
// syncStoreV2 호출 없음 — 행동 데이터, 프라이버시 비대상 (ADR-014 §C)
```

코드에 주석으로 명시해 향후 누군가가 "왜 이것만 안 동기화?" 의문 시 ADR-014 참조.

---

## 4. UI 설계

### 4.1 마크업 구조

#### 상단 헤더 (`#search-bar`)

```html
<div id="search-bar">
  <input id="search-input" type="search" placeholder="검색 (...)"
         aria-label="성경 검색"
         aria-autocomplete="list"
         aria-controls="search-history"
         aria-expanded="false">
  <button id="search-history-toggle" type="button"
          aria-label="최근 검색어 열기"
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-controls="search-history" hidden>
    <svg width="14" height="14" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M2 4l4 4 4-4z"/>
    </svg>
  </button>
  <button id="search-clear" type="button" aria-label="검색어 지우기" hidden>&times;</button>
  <div id="search-history" role="listbox" aria-label="최근 검색어" hidden></div>
</div>
```

#### 모바일 시트 (`#search-sheet-bar` 내부)

```html
<div id="search-sheet-bar">
  <div id="search-sheet-input-wrap">
    <input id="search-sheet-input" ...
           aria-autocomplete="list"
           aria-controls="search-sheet-history"
           aria-expanded="false">
    <button id="search-sheet-history-toggle" ...>▾</button>
    <button id="search-sheet-clear" ...>×</button>
  </div>
  <button id="search-sheet-close" ...>×</button>
</div>
<div id="search-sheet-history" role="listbox" aria-label="최근 검색어" hidden></div>
```

### 4.2 패널 항목 구조

```html
<div id="search-history" role="listbox" aria-label="최근 검색어">
  <div class="search-history-item">
    <button id="search-history-opt-0" role="option"
            class="search-history-item-select"
            aria-selected="false" tabindex="-1"
            data-query="사랑 in:요한">사랑 in:요한</button>
    <button class="search-history-item-remove"
            aria-label='최근 검색어 "사랑 in:요한" 삭제'
            tabindex="-1" data-remove-query="사랑 in:요한">
      <span aria-hidden="true">×</span>
    </button>
  </div>
  <!-- … 기본 10개. 더 보기 토글 후 최대 30개 -->
  <button class="search-history-more" tabindex="-1" data-show-more="true">
    더 보기 (20개)
  </button>  <!-- 저장 항목 > 10건일 때만, 펼치면 사라짐 -->
  <button class="search-history-clear" tabindex="-1" data-clear-all="true">
    모두 지우기
  </button>  <!-- 3건 이상일 때만 -->
</div>
```

옵션 본문(`.search-history-item-select`)이 `role="option"`을 가지고, 삭제 버튼은 listbox 내 일반 버튼이다. 엄격 ARIA 사양에 따르면 listbox 자식은 option/group이어야 하지만, 실 사용 SR(VoiceOver/TalkBack/NVDA)에서 합리적으로 announce된다. 더 엄격히 가려면 옵션 div 안에 삭제 버튼을 자식으로 두는 패턴을 검토한다.

### 4.3 키보드 패턴 (combobox + listbox)

| 키 | 동작 |
| --- | --- |
| `↓` | 패널 닫혀 있으면 열고, 첫 항목 활성. 열려 있으면 다음 항목. 마지막 가시 항목에서 누르면 자동 펼침(있다면) + 다음 항목으로 이동 |
| `↑` | 이전 항목. 첫 항목에서 누르면 마지막 가시 항목으로 wrap |
| `Enter` | 활성 항목 있으면 선택 + 검색 실행 / 활성 항목 없으면 기존 Enter 핸들러 (input 텍스트로 검색) |
| `Esc` | 패널 닫힘, 입력창 포커스 유지 |
| `Tab` | 패널은 `aria-activedescendant` 모델이라 Tab은 입력창 → 토글 → 클리어 → 다음 헤더 요소로 자연 이동 |

"더 보기"·"모두 지우기" 버튼은 listbox 내부 활성 영역이 아니다(`tabindex="-1"`, role=button). 키보드 사용자는 화살표가 마지막 항목에 닿으면 자동 펼침으로 11번째 항목으로 이어진다 — "더 보기" 자체를 활성화할 필요가 없다. 마우스/터치 사용자만 명시적으로 탭한다.

활성 표시는 `aria-activedescendant`(input 위) + `aria-selected="true"`(option 위) 동기화. 옵션 자체는 `tabindex="-1"`로 두어 input이 포커스를 잃지 않게 한다.

### 4.4 토글 가시성

```js
function syncToggleVisibility() {
  const has = loadSearchHistory().length > 0;
  toggle.hidden = !has;
  wrap.dataset.historyHidden = String(!has);
}
```

- 첫 진입(히스토리 0건) → ▾ 자체 숨김. UI 노이즈 제거
- 첫 검색 후 → ▾ 노출
- "모두 지우기" 후 → ▾ 다시 숨김

CSS `data-history-hidden` 플래그로 input padding-right을 동적으로 줄여 시각 정렬 유지.

### 4.5 모바일 시트의 `:has()` 확장

```css
#search-sheet[data-state="compact"] {
  height: calc(6.4rem + env(safe-area-inset-bottom));
}

#search-sheet[data-state="compact"]:has(#search-sheet-history:not([hidden])) {
  height: auto;
  max-height: min(70vh, 28rem);
}
```

- 컴팩트 시트는 기본 6.4rem (입력 + 칩만)
- 히스토리 패널 열림 시 시트가 자동 확장 (최대 28rem)
- 패널 닫힘 시 자동 복귀 (height 트랜지션 220ms로 부드럽게)

---

## 5. 터치 타깃 설계

### 5.1 입력창 자체

```css
#search-input,
#search-sheet-input {
  min-height: 44px;
  box-sizing: border-box;
  padding: 0.6rem 5.5rem 0.6rem 0.75rem;  /* right 5.5rem = 토글 44 + 클리어 44 + 여유 */
  font-size: 0.85rem;       /* 상단은 기존 0.78 → 0.85로 가독성 향상 */
}
```

상단 검색바는 기존 ~26 px → 44 px로 커지므로 헤더 높이가 ~18 px 늘어난다. 데스크탑 헤더가 살짝 두꺼워지는 트레이드오프 있음.

### 5.2 보조 버튼 공통 (44 × 44)

```css
#search-clear, #search-history-toggle,
#search-sheet-clear, #search-sheet-history-toggle {
  position: absolute;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;            /* 시각적으로는 원형 hover */
  border: none;
  background: none;
  color: var(--text);            /* 기존 --text-secondary보다 대비 ↑ */
}

#search-clear { right: 0.1rem; }
#search-history-toggle { right: 2.6rem; }

/* 클리어 hidden일 때 토글이 그 자리로 이동 */
#search-bar[data-clear-hidden="true"] #search-history-toggle {
  right: 0.1rem;
}
```

`data-clear-hidden`은 입력 핸들러에서 `String(!input.value.trim())`로 동기화.

### 5.3 시트 닫기 버튼

```css
#search-sheet-close {
  width: 44px;     /* 기존 32 → 44 */
  height: 44px;
  border-radius: 50%;
  color: var(--text);
}
```

### 5.4 패널 항목·삭제 버튼

```css
.search-history-item { min-height: 44px; }
.search-history-item-select { padding: 0 0.85rem; min-height: 44px; }
.search-history-item-remove { width: 44px; height: 44px; }
.search-history-clear { min-height: 44px; }
```

손가락이 인접 항목 / 삭제 버튼을 잘못 누르지 않도록 ≥ 44 px 간격 보장.

### 5.5 포커스 인디케이터

```css
button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent);
}
```

WCAG 1.4.11 (Non-text Contrast) 3:1 이상 확보. 다크/라이트 + 4가지 컬러 스킴 전부에서 검증한다.

---

## 6. 컨트롤러 구조

상단·시트 두 인스턴스가 동일 로직을 공유하도록 팩토리 패턴 사용.

```js
function createSearchHistoryController({
  wrap,           // <div> (data-clear-hidden / data-history-hidden 플래그용)
  input,          // <input>
  toggle,         // <button> ▾
  panel,          // <div role="listbox">
  clearBtn,       // <button> × (입력 클리어)
  syncClearHidden,// (hidden: boolean) => void  — wrap dataset 동기화
  onSelect,       // (q: string) => void  — 항목 선택 시 검색 실행
}) {
  let activeIndex = -1;
  let _expanded = false;  // 더 보기 펼침 상태. close() 시 false로 리셋

  function visibleCount() {
    return _expanded ? SEARCH_HISTORY_MAX : SEARCH_HISTORY_VISIBLE;
  }

  function moveActive(delta) {
    const list = loadSearchHistory();
    if (!list.length) return;
    const limit = visibleCount();
    const visible = Math.min(list.length, limit);
    const next = activeIndex + delta;
    // 마지막 가시 항목에서 ↓ → 자동 펼침 + 다음 항목으로
    if (next >= visible && list.length > visible && !_expanded) {
      _expanded = true;
      render();
      activeIndex = next;  // 펼친 직후 11번째
      updateActive();
      return;
    }
    activeIndex = (next + visible + (_expanded ? 0 : 0)) % visible;
    updateActive();
  }

  // open / close / render / refresh
  // pickQuery(q) — 항목 선택 시 input 채우고 onSelect
  // consumeEnter(e) — input의 Enter 핸들러가 활성 항목 있을 때 위임
  // expandMore() — _expanded = true; render(); 활성 인덱스 유지

  return { open, close, isOpen, refresh, syncToggleVisibility, consumeEnter };
}
```

두 인스턴스:

```js
const topSearchHistory = createSearchHistoryController({
  wrap: $searchBar,
  input: $searchInput,
  toggle: $searchHistoryToggle,
  panel: $searchHistoryPanel,
  clearBtn: $searchClear,
  syncClearHidden: (hidden) => { $searchBar.dataset.clearHidden = String(hidden); },
  onSelect: (q) => commitTopSearch(q),
});

const sheetSearchHistory = createSearchHistoryController({
  wrap: $searchSheetInputWrap,
  input: $searchSheetInput,
  toggle: $searchSheetHistoryToggle,
  panel: $searchSheetHistoryPanel,
  clearBtn: $searchSheetClear,
  syncClearHidden: (hidden) => { $searchSheetInputWrap.dataset.clearHidden = String(hidden); },
  onSelect: (q) => commitSheetSearch(q),
});
```

### 6.1 진입점 헬퍼

```js
function commitTopSearch(rawQuery) {
  const q = (rawQuery || "").trim();
  if (!q) return;
  pushSearchHistory(q);
  topSearchHistory && topSearchHistory.refresh();
  searchAutoNavigate = true;
  const newPath = `/search?q=${encodeURIComponent(q)}`;
  if (location.pathname + location.search === newPath) route();
  else navigate(newPath);
}

function commitSheetSearch(rawQuery) {
  const q = (rawQuery || "").trim();
  if (!q) return;
  pushSearchHistory(q);
  sheetSearchHistory && sheetSearchHistory.refresh();
  $searchSheetInput.blur();   // IME 닫고 시트 확장 트랜지션
  _suspendKeyboardAdjust = true;
  requestAnimationFrame(() => {
    $searchSheet.style.transition = "";
    $searchSheet.style.bottom = "";
    $searchSheet.style.height = "";
    $searchSheet.style.maxHeight = "";
    $searchSheet.dataset.state = "expanded";
    runSheetSearch(q, 1, true);
    setTimeout(() => { _suspendKeyboardAdjust = false; }, 260);
  });
}
```

기존 Enter 핸들러는 한 줄로 단순화:

```js
$searchInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (topSearchHistory && topSearchHistory.consumeEnter(e)) return;
  e.preventDefault();
  commitTopSearch($searchInput.value);
});
```

---

## 7. 상호작용 시퀀스

### 7.1 첫 검색 (히스토리 0건)

```
1. 사용자: 헤더 입력창에 "사랑" 타이핑 + Enter
2. keydown(Enter) →
   a. consumeEnter() → false (패널 닫힘)
   b. e.preventDefault(); commitTopSearch("사랑")
3. commitTopSearch:
   a. pushSearchHistory("사랑") → ["사랑"]
   b. topSearchHistory.refresh() → 토글 가시성 갱신 → ▾ 노출
   c. navigate("/search?q=사랑")
4. UI: 검색 결과 페이지 + 입력창 옆에 ▾ 새로 보임
```

### 7.2 ▾ 탭 → 항목 선택

```
1. 사용자: ▾ 탭
2. toggle.click → topSearchHistory.open()
   a. activeIndex = -1
   b. render() → DOM에 항목 10개 + (3건↑이면) "모두 지우기"
   c. panel.hidden = false
   d. toggle aria-expanded="true"
3. 사용자: "사랑 in:요한" 항목 탭
4. panel.click → pickQuery("사랑 in:요한")
   a. input.value = "사랑 in:요한"
   b. clear 버튼 노출 + data-clear-hidden="false"
   c. close() → panel.hidden = true
   d. onSelect("사랑 in:요한") → commitTopSearch
5. commitTopSearch → push (LRU로 맨 앞 이동) → navigate
```

### 7.3 키보드 내비

```
1. 사용자: input 포커스 상태에서 ↓
2. keydown("ArrowDown") →
   a. !isOpen() && history.length > 0 → open()
   b. moveActive(+1) → activeIndex=0, aria-activedescendant 동기화
3. 사용자: ↓↓ → activeIndex=2
4. 사용자: Enter
5. keydown("Enter") →
   a. consumeEnter(e) → activeIndex>=0 → pickQuery(opts[2].dataset.query) → return true
   b. 외부 핸들러는 return (commitTopSearch는 onSelect 안에서 이미 호출됨)
```

### 7.4 더 보기 (마우스/터치)

```
1. 사용자: ▾ 탭 → 패널 열림, 항목 10개 + "더 보기 (5개)" + "모두 지우기" 표시
2. 사용자: "더 보기" 탭
3. panel.click → expandMore()
   a. _expanded = true
   b. render() → 항목 15개 표시, "더 보기" 버튼 사라짐, "모두 지우기"는 유지
4. 사용자: ESC → close() → _expanded = false (다음 open 시 다시 컴팩트)
```

### 7.5 더 보기 (키보드 자동 펼침)

```
1. 사용자: input ↓ 10번 → activeIndex = 9 (마지막 가시 항목)
2. 사용자: ↓ 한 번 더
3. moveActive(+1):
   a. next = 10, visible = 10, list.length = 15 → 자동 펼침 분기
   b. _expanded = true; render(); activeIndex = 10
   c. 새로 표시된 11번째 항목이 활성
```

### 7.6 항목 삭제

```
1. 사용자: "은혜" 옆 × 탭
2. panel.click → remove 분기
   a. removeSearchHistory("은혜")
   b. refresh() → render() 재호출, 항목 0건이면 close()
3. UI: "은혜" 사라짐, 나머지 유지
```

### 7.7 외부 탭 → 닫힘

```
1. 패널 열린 상태에서 사용자: 패널/토글/입력 외부 탭
2. document.pointerdown → contains 체크 모두 false → close()
```

---

## 8. 회귀 테스트

### 8.1 유닛 (`tests/unit/storage.test.js`)

`js/app.js`의 `// ── BEGIN/END SEARCH HISTORY HELPERS ──` 블록을 vm으로 슬라이스해 격리 평가. 케이스 18개:

- `normalizeSearchQuery`: 공백 정규화, null/undefined 방어
- `loadSearchHistory`: malformed JSON → `[]`, 비배열 → `[]`, 비문자열 필터, 30건 cap
- `pushSearchHistory`: 빈 쿼리 no-op, prepend, LRU dedupe, 정규화 dedupe, 30건 한도, 반환값
- `removeSearchHistory`: 단일 제거, 정규화 매칭, 미존재 시 변화 없음
- `clearSearchHistory`: 전체 비움
- 영구성: 저장 후 fresh load 시 동일 순서

### 8.2 e2e (수동, `tests/e2e/test_search.py` 확장 후보)

- 입력 → Enter → 페이지 이동 → 뒤로가기 → ▾ 탭 → 첫 항목 = 직전 쿼리
- ▾ 탭 → 첫 항목의 × 탭 → 그 항목만 사라짐
- 31번째 검색 시 가장 오래된 항목 폐기
- 11~30번째 항목은 "더 보기" 탭 후 노출
- 키보드 ↓로 마지막 가시 항목에서 누르면 자동 펼침
- 모바일 시트: 컴팩트 상태에서 ▾ 탭 시 시트 자동 확장

### 8.3 접근성 수동 확인

- iOS VoiceOver: ▾ 누르면 "최근 검색어, 펼침"으로 announce
- Android TalkBack: 항목 활성 시 "옵션 N개 중 1번"
- macOS VoiceOver: ↑↓ 키로 항목 순회 시 announce
- 터치 타깃 실측: Chrome DevTools Inspect → `getBoundingClientRect()` ≥ 44 × 44

---

## 9. 마이그레이션 / 호환성

- 기존 사용자 → `bible-search-history` 키 없음 → `loadSearchHistory()` `[]` 반환 → 정상 동작
- 사용자가 손댄 malformed 값 → `[]`로 fallback (3.4 참조)
- 기존 e2e 테스트(`#search-input`, `#search-sheet-input` selector) 영향 없음 — 마크업은 추가만 됨, 기존 ID 유지

---

## 10. 미해결 / 후속 과제

| 항목 | 상태 | 메모 |
| --- | --- | --- |
| 옵션 안에 삭제 버튼 중첩 (엄격 ARIA) | open | 실 SR에서 announce 자연스러움. 사용자 피드백에 따라 재구조화 |
| 자동완성(별칭 제안) | out of scope | "in:요" 입력 시 책 별칭 제안 — 별도 기능, ADR 새로 작성 필요 |
| 인기 검색어/추천 | out of scope | 클라이언트만으론 의미 없음. 향후 빌드 시 정적 시드 가능성 |
| 시트 ↔ 헤더 히스토리 공유 | 결정됨 | 같은 localStorage 키 사용 → 자연 공유 |

---

## 11. 변경 이력

- 2026-05-07 — 초안 작성, ADR-014 제안과 동기화
- 2026-05-07 — 저장 30 / 표시 10 + "더 보기" 점진 펼침 도입 (키보드 자동 펼침 포함)
- 2026-05-09 — ADR-018 Phase 5(`js/app/search.js` 추출) 동행으로 `createSearchHistoryController` 팩토리화. `topSearchHistory` + `sheetSearchHistory` 두 인스턴스가 같은 컨트롤러 공유
- 2026-05-11 — 유닛 테스트 추가: 검색 이력 영역 33 케이스(`tests/unit/storage.test.js`, PR #106) + HISTORY_CONTROLLER 33 케이스(`tests/unit/search.test.js`, PR #113). ADR-014 status를 '제안됨' → '승인·적용 완료'로 갱신(PR #117)
