# ADR-010: 즐겨찾기(북마크) 기능 설계

- 일시: 2026-04-25
- 개정: 2026-04-26 (UI 개선), 2026-05-03 (모바일 행 UX)
- 상태: 승인됨

## 결정

`localStorage` 기반 클라이언트 전용 북마크 저장소를 구현한다.
사용자는 현재 장 전체 또는 선택한 절(세그먼트 단위 포함)을 저장하고,
폴더로 분류·관리할 수 있다.
절 범위는 URL path에 spec 문자열(`/john/3/1-5,10-15`, `/ps/23/3a,5-7`)로 인코딩하고,
`renderChapter()`가 이를 해석하여 해당 span만 하이라이트한다.

## 맥락

Phase 1 완료 후 "어제 읽던 곳을 빠르게 찾는" 사용 패턴이 주요 요구사항으로 부상했다.
성경 앱에서 북마크는 필수 기능이지만, 서버 없이 PWA 오프라인 완전 지원을 유지해야 한다는
아키텍처 제약이 있었다. 또한 시편·욥기 등 운문에서 **헤미스티치(반행)** 단위로
절이 렌더링되므로, "3절 전체"뿐 아니라 "3절 첫 번째 행(3a)"만 저장하는 세밀한
선택이 필요했다.

## 검토한 대안

### 저장소

#### A. 서버 API (사용자 계정 연동)
- 장점: 디바이스 간 동기화
- 단점: 계정 시스템, 서버 인프라 필요. PWA 오프라인 원칙과 충돌. Phase 1 범위 초과

#### B. localStorage (채택)
- 장점: 서버 없음, 오프라인 완전 지원, 즉각 구현 가능
- 단점: 디바이스 간 동기화 불가, 브라우저 스토리지 삭제 시 소실
- 결론: Phase 1 제약(서버 없음)과 일치. 동기화는 별도 Phase에서 고려

#### C. IndexedDB
- 장점: 대용량, 트랜잭션 지원
- 단점: 북마크 데이터는 수십~수백 건 수준이므로 과도한 복잡도

### 절 범위 URL 인코딩

#### A. query string (`?v=1-5,10-15`)
- 단점: 기존 `?hl=` 검색 쿼리와 혼재. 공유 링크가 직관적이지 않음

#### B. path segment (채택): `/john/3/1-5,10-15`
- 장점: 기존 `parsePath()` 패턴과 일관성. 클린 URL. 공유·색인 친화적
- `highlightVerseSpec` 필드를 `parsePath()` 반환값에 추가하여 기존 단순 범위와 병행

#### C. hash fragment (`#v=1-5`)
- 단점: 서버에 전달되지 않음. ADR-009에서 해시 라우팅을 이미 포기한 방향과 역행

### 절 세그먼트 식별자

운문 절은 여러 span으로 분리 렌더링된다. `data-vref` 속성값이 식별자로,
단일 행 절은 `"3"`, 다중 행 절은 `"3a"`, `"3b"`, `"3c"` … 형식이다.

#### A. 정수 기반 (`_selectedVerseNums: Set<number>`)
- 기존 구현. `parseInt("3a", 10) === 3`으로 coerce되어 "3a"와 "3b"를 구분 불가

#### B. vref 문자열 기반 (`_selectedVerseRefs: Set<string>`) (채택)
- `data-vref` 원문을 그대로 추적. "3a"와 "3b"를 독립적으로 선택 가능
- URL spec: `"3a,3b"` 형식이지만, 해당 절의 모든 세그먼트가 선택된 경우
  `collapseFullVerseRefs()`가 DOM을 조회해 자동으로 `"3"` 으로 통합

### 드래그 앤 드롭

#### A. HTML5 Drag and Drop API
- 단점: 터치 이벤트 미지원. 별도 터치 폴리필 필요

#### B. Pointer Events API (채택)
- 장점: 마우스·터치 단일 코드. `document` 레벨 리스너로 포인터 이탈 추적
- Ghost 요소를 `fixed` 포지션으로 생성해 시각 피드백 제공
- 드롭 대상: 아이템 상단 25% → before, 하단 25% → after, 중앙 → into(폴더일 때)
- 순환 참조 방지: `_isDescendant()` 검사 후 드롭 거부
- **개정 (2026-04-26)**: 전용 6-dot 핸들 제거 → row 전체를 드래그 영역으로 사용.
  5px 이동 임계값(`Math.hypot`)으로 클릭과 드래그를 구분하며,
  `setPointerCapture`는 임계값 초과 후에만 호출.
  `<a>` 태그에 `draggable="false"` 추가로 브라우저 기본 링크 드래그 ghost 억제.
- **개정 (2026-04-26, 버그 수정)**: `pointermove`/`pointerup`/`pointercancel` 리스너를
  `row`에서 `document`로 이동. row 밖으로 포인터 이탈 시 이벤트를 놓쳐 ghost가 잔류하던
  문제 수정. `pointerId` 필터링으로 멀티터치 오작동 방지.

## 채택 이유

- PWA 오프라인 원칙 유지: 서버 의존성 없이 `localStorage`로 완결
- 기존 라우팅 패턴 확장: `parsePath()` 반환 구조에 `highlightVerseSpec` 필드 추가,
  `renderChapter()` 내부 루프에서 per-span 하이라이트로 확장 — 기존 코드 최소 변경
- 접근성 패턴 재사용: 기존 `openInstallModal()` 패턴(포커스 트랩, inert 배경, Escape 닫기)을
  드로어·모달 모두에 그대로 적용

## 변경 내용

### 데이터 스키마 (`localStorage` key: `"bible-bookmarks"`)

```js
type VerseSpec = string  // "all" | "3" | "1-17" | "1-5,10-15" | "3a" | "3a,3b,5-7"

type Bookmark = {
  type: "bookmark",
  id: string,           // generateId()
  bookId: string,
  chapter: number,
  verseSpec: VerseSpec,
  label: string,
  note: string,
  createdAt: number,
}

type Folder = {
  type: "folder",
  id: string,
  name: string,
  children: Array<Bookmark | Folder>,
  expanded: boolean,  // 저장은 하지만 렌더링 시 무시 — 아래 참조
}

type BookmarkStore = Array<Bookmark | Folder>
```

> **개정 (2026-04-26)**: `expanded` 필드는 localStorage에 계속 저장되지만,
> 드로어를 열 때 항상 `false`(접힌 상태)로 렌더링한다.
> 단, `_hasActiveDescendant(folder)`가 true이면 해당 폴더만 자동으로 펼친다.
> 스키마 하위 호환성을 위해 필드는 유지.

### URL 라우팅 확장 (`js/app.js`)

`parsePath()`의 다중 구간 정규식을 `^[\d,\-a-z]+$`로 확장,
알파 접미사 포함 spec(`"3a,3b,5-7"`)을 처리.

`parseVerseSpec()` 반환 항목에 `part` 필드 추가:
- `"3a"` → `{ start: 3, end: 3, part: "a" }`
- `"5-7"` → `{ start: 5, end: 7 }` (part 없음)

`renderChapter()` 내부 루프에서 `vref` 계산을 `classes` 결정 이전으로 이동하여
per-span 하이라이트 판정에 활용:

```js
const isHighlightedSpan = hlSegments
  ? hlSegments.some(s =>
      s.part ? vref === `${s.start}${s.part}` : (vn >= s.start && vn <= s.end))
  : (hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse));
```

### 주요 유틸리티 함수

| 함수 | 역할 |
|------|------|
| `parseVerseSpec(spec)` | spec 문자열 → `{start,end,part?}[]` |
| `selectedVersesToSpec(refs)` | `string[]` → spec 문자열. 정수 연속 구간만 범위 압축 |
| `_compareRefs(a, b)` | `"3" < "3a" < "3b" < "4"` 정렬 |
| `collapseFullVerseRefs(refs, article)` | DOM 조회로 전체 세그먼트 선택 시 `"3a,3b"` → `"3"` 통합 |
| `mergeVerseSpecs(specA, specB)` | 두 spec의 합집합 |
| `_findParentFolderId(store, id)` | 북마크가 속한 폴더 ID 반환 (root = null) |
| `generateId()` | `Date.now().toString(36) + random` |
| `_isActiveBookmark(bm)` | `window.location.pathname === _bookmarkHref(bm)` |
| `_hasActiveDescendant(folder)` | 재귀적으로 활성 북마크 포함 여부 확인 |
| `_buildFolderToggleIcon(open, size)` | Material Icons `folder`/`folder_open` SVG 반환 |
| `_buildBookmarkTypeIcon(active, size)` | outlined/filled `bookmark` SVG 반환 |

### UI 컴포넌트

**북마크 드로어** (`#bookmark-drawer`): 오른쪽 슬라이드인 패널.
ARIA tree widget(`role="tree"`, `role="treeitem"`, `role="group"`).

툴바 (개정 2026-04-26): 아이콘 전용 버튼, 우측 정렬.
순서: 새 폴더(`create_new_folder`) → 이 장 저장(`bookmark_add`) → 절 선택(`text_select_move_forward_character`).

폴더 행: ▶ 토글 아이콘을 제거하고 `_buildFolderToggleIcon(open)` — Material Icons
`folder` / `folder_open` SVG로 대체. 폴더 행 전체 클릭/터치로 펼치기·접기 동작.

북마크 행: `_buildBookmarkTypeIcon(active)` — 비활성 시 outlined `bookmark`,
활성 시 filled `bookmark` SVG. 활성 북마크(`_isActiveBookmark(bm)`)는
`.bm-active` 클래스로 배경 강조 + 아이콘·레이블에 accent 색상 적용.

**저장 모달** (`#bm-save-modal`): 제목·메모·저장 위치 입력.
저장 위치는 `_findParentFolderId()`로 현재 위치를 pre-select.
`overflow: visible`로 폴더 선택 콤보박스 드롭다운이 모달 밖으로 열림.

**병합 다이얼로그** (`#bm-merge-modal`): 동일 장에 북마크 이미 존재 시
"합치기 / 따로 저장 / 취소" 선택.

**절 선택 바** (`#verse-select-bar`): 하단 고정. 롱프레스 300ms 또는
드로어 "절 선택" 버튼으로 진입. 10px 이동 임계값으로 터치 드리프트 허용.

**헤더 북마크 아이콘** (`.title-bookmark-btn`): `buildBookmarkHeaderBtn()` 호출.
아이콘: Material Icons `bookmarks` SVG. 장 북마크 여부 표시 제거
(`.has-bookmark` 클래스 및 관련 CSS 삭제).

**검색 드로어** (`#search-sheet`): 개정 2026-04-26 — 닫기 버튼(`#search-sheet-close`) 추가.
WCAG 일관성 유지 (북마크 드로어와 동일 패턴).

### z-index 레이어

| 요소 | z-index |
|------|---------|
| `#verse-select-bar` | 35 |
| `#bookmark-scrim` | 70 |
| `#bookmark-drawer` | 71 |
| `#bm-save-scrim` | 72 |
| `#bm-save-modal` | 73 |
| `#bm-merge-scrim` | 74 |
| `#bm-merge-modal` | 75 |

## 결과

- 서버 없이 오프라인에서 북마크 완전 동작
- 운문(시편·욥기 등)에서 헤미스티치 단위 절 선택·저장 가능
- 비연속 절 범위가 URL에 인코딩되어 공유·색인 가능 (`/ps/23/3a,5-7`)
- 드래그 앤 드롭으로 마우스·터치 모두에서 순서 변경 및 폴더 이동 가능
- 기존 라우팅·렌더링·접근성 패턴 재사용으로 코드 증가 최소화

## 미결 사항

- ~~디바이스 간 동기화~~ → ADR-011에서 Google Drive 동기화로 해소
- Playwright e2e 테스트 (소스 데이터 접근 가능 시)


## 해소된 사항 (2026-04-26 개정에서 처리 / 추가)

- ~~전용 드래그 핸들 UX~~: row 전체 드래그 + 5px 임계값으로 대체
- ~~폴더 기본값이 열린 상태~~: 드로어 열 때 항상 접힌 상태로 초기화
- ~~툴바 텍스트 버튼 가독성~~: 아이콘 전용 버튼으로 교체
- ~~헤더 장 북마크 표시 불일치~~: 표시 기능 제거, `bookmarks` 아이콘으로 단순화
- ~~검색 드로어 닫기 버튼 누락~~: `#search-sheet-close` 추가
- ~~키보드 트리 탐색~~: WAI-ARIA Tree Pattern 키보드 스펙 구현
  (`↑↓` 포커스 이동, `→←` 폴더 열기/닫기·부모 이동, `Enter`/`Space` 활성화,
  `Home`/`End` 처음·끝. 버튼·링크에서는 트리 키 무시. roving tabindex 적용)


## 개정 (2026-05-03): 모바일 북마크 행 UX

### 맥락

`.bm-item-actions`(수정/삭제 버튼)는 데스크톱에서 `:hover`/`:focus-within`으로
노출되도록 설계되었다. iOS Safari가 첫 탭을 hover로 처리하기 때문에 모바일에서
북마크 항목으로 이동하려면 **두 번 탭**이 필요한 문제가 발생했다.
첫 탭은 액션 버튼을 노출만 시키고, 두 번째 탭에서야 링크로 이동.

### 결정

**모바일(`max-width: 768px`) 한정**으로 행 UX를 다음과 같이 변경:

1. **단일 탭** = 즉시 이동 (또는 폴더 펼치기)
2. **좌측 스와이프** = 행 콘텐츠 슬라이드 → 우측에 수정/삭제 액션 노출
3. **롱프레스 (500ms)** = 동일 액션 노출 (Android 친화 + 발견성 보강)
4. **수직 드래그** = 기존 reorder 동작 유지 (방향 우선 결정으로 분기)

데스크톱은 변경 없음 (hover-reveal 그대로 유지).

### 검토한 대안

#### A. 케밥(⋯) 버튼 행마다 추가
- 장점: 발견성 최고
- 단점: 시각적 노이즈 큼, 모바일/데스크톱 패턴 분리 필요

#### B. 스와이프-투-리빌만 (롱프레스 없음)
- 장점: iOS 표준, 단순
- 단점: Android는 보통 롱프레스 → 다중 선택 모드. 발견성 낮음

#### C. 스와이프 + 롱프레스 (채택)
- iOS·Android 양 플랫폼 사용자가 자기 OS 습관대로 발견·사용
- 두 제스처가 같은 결과(액션 노출)를 만들어 모델이 단순

### DOM 구조

행 내부에 swipe wrapper 추가:

```
li.bm-bookmark
  div.bm-bookmark-row              ← position: relative; overflow: hidden (모바일)
    div.bm-row-content             ← translateX로 슬라이드, 기존 flex 레이아웃 보유
      span.bm-bookmark-type-icon
      a.bm-bookmark-link
      div.bm-item-actions           ← 데스크톱 hover-reveal (모바일 display:none)
    div.bm-row-actions-mobile      ← position: absolute; right: 0 (데스크톱 display:none)
      button.bm-mobile-edit-btn
      button.bm-mobile-delete-btn
```

폴더 행도 동일 구조 (`.bm-folder-row` > `.bm-row-content` + `.bm-row-actions-mobile`).

### 제스처 분기 로직 (`_setupDragHandle`)

기존 drag-to-reorder 핸들러를 확장하여 세 모드를 단일 핸들러로 처리:

| 조건 | 모드 |
|------|------|
| 모바일 + 5px 미만 + 500ms 유지 | `longpress` → 액션 노출 |
| 모바일 + `|Δx| > |Δy|` (5px 이상) | `swipe` → 실시간 transform |
| 그 외 (데스크톱 또는 수직 우세) | `drag` → 기존 reorder |
| 5px 미만에서 pointerup | 분류되지 않음 → 링크/토글 click 정상 처리 |

스와이프 종료 임계값: `-SWIPE_REVEAL_PX / 2`(70px) 이상 좌측 이동 시 reveal 고정,
미만이면 0으로 스냅 백.

### 자동 닫기

- 다른 행 스와이프/롱프레스 시 이전 행 close (`_swipedRow` 단일 추적)
- 드로어 빈 영역 탭 시 close (`$bookmarkDrawerBody` pointerdown listener)
- 드로어 닫힘, `renderBookmarkTree()` 재실행 시 close
- 스와이프된 행의 link/folder 영역 탭 = 이동/펼치기 대신 close (iOS 메일과 동일)

### 시각·접근성

- 액션 버튼 최소 44×44 (WCAG AA 터치 타겟)
- 수정 버튼: `var(--accent)`, 삭제 버튼: `#c0392b` (기존 `.bm-delete-btn:hover` 색상과 일관)
- `prefers-reduced-motion`에서 transition 제거
- 햅틱 피드백: 롱프레스 reveal 시 `navigator.vibrate(10)` (지원 시)
- 모바일 액션 패널은 `aria-hidden="true"` (데스크톱 hover-reveal 액션이 SR-친화 경로)

### 변경 파일

- `js/app.js`:
  - 신규: `closeSwipedRow()`, `_openSwipedRow()`, `_isMobileViewport()`,
    상수 `SWIPE_REVEAL_PX = 140`, `LONG_PRESS_MS = 500`
  - `_setupDragHandle()`: 3-mode 분기 (swipe/longpress/drag)
  - `_buildBookmarkItem()`, `_buildFolderItem()`: `.bm-row-content` 래퍼 + `.bm-row-actions-mobile` 추가
  - `closeBookmarkDrawer()`, `renderBookmarkTree()`: `closeSwipedRow(null)`/ref 초기화
  - `$bookmarkDrawerBody` pointerdown: 빈 영역 탭 시 swipe close
- `css/style.css`:
  - 모바일 미디어 쿼리에서 `.bm-item-actions { display:none }`, swipe 슬라이드 스타일,
    모바일 액션 버튼 스타일 추가
  - `prefers-reduced-motion`에 `.bm-row-content { transition: none }` 추가
