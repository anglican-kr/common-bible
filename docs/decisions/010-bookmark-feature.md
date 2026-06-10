# ADR-010: 즐겨찾기(북마크) 기능 설계

- 일시: 2026-04-25
- 개정: 2026-04-26 (UI 개선), 2026-05-03 (모바일 행 UX), 2026-06-06 (양방향 스와이프 + full-swipe), 2026-06-06 (분절 산문 절 북마크 통합), 2026-06-06 (장 북마크 선택 삭제), 2026-06-07 (삭제 확인 취소 시 행 닫힘 수정), 2026-06-07 (드롭 위치 지시자 가시화 + 행 아이콘 크기 표준화)
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

> **개정 (2026-06-06):** 인용(`<cite>`)이 박힌 산문 절은 인용 위치에서 a/b/c
> 라인-스팬으로 분절되는데(ADR-022), 이는 개념상 한 절이므로 **북마크 저장 시에는
> 분절을 무시하고 절 전체로 승격**한다. 절 일부만 선택해도(예: 23a 만, 또는 23a·23c)
> 저장되는 spec 은 `23` 이 된다 — 신규 `collapseSegmentedVerses(refs, article)`
> (다중-스팬 절이면 `allSelected` 조건 없이 정수 절번호로 통합). 선택 바 라벨과
> 복사 직렬화는 종전대로 per-span 단위를 유지하고, **저장된 북마크만** 통합한다
> (운문 다중-스팬 절은 이미 atomic 선택이라 영향 없음).

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
| `collapseFullVerseRefs(refs, article)` | DOM 조회로 전체 세그먼트 선택 시 `"3a,3b"` → `"3"` 통합 (선택 바·복사 경로) |
| `collapseSegmentedVerses(refs, article)` | 북마크 저장 전용. 다중-스팬 절은 부분 선택이어도 절 전체로 승격 (`"23a,23c"` → `"23"`) |
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

> **개정 (2026-06-06):** 절 선택 바를 **텍스트 라벨 버튼 → 탭 dock 형식의
> floating glass + 아이콘 전용**으로 개편(ADR-030 형식 통일). 구조는 탭 dock 미러 —
> 투명 flex dock = `[아이콘 글래스 pill] + [취소 글래스 원형]`, 선택 카운트는 캡슐 위
> 중앙에 부유하는 글래스 칩(`#verse-select-count`, `aria-live`). pill 안에 **북마크·복사 +
> 노트 슬롯** 3개 아이콘(stroke, round cap/join — 탭 아이콘 언어). 북마크·복사는 선택 0
> 일 때 `disabled`(흐림), **노트는 후속 기능 placeholder** 라 `aria-disabled`(탭 dock 노트
> 탭과 동일 패턴, 탭 시 "준비 중" announce). 글래스 레시피는 탭 dock 과 동일 토큰 공유
> (`--glass-sheen` + `--bg 50%` 틴트 + `blur(12px)` + 1px 테두리 + `--shadow-2` +
> `--glass-inset`, `--radius-pill` + `corner-shape: superellipse(2)`, 60px 높이).
> 다중 절 선택 모델이라 팝오버 대신 영속 하단 액션 바를 유지(iOS 26 다중 선택 컨텍스트
> 툴바 idiom — 선택 시 등장, 해제 시 사라짐, 아이콘 contained 버튼). 기존 ID
> (`#verse-select-bar`·`#verse-select-{count,bookmark-btn,copy-btn,cancel-btn}`)는 e2e·
> inert 셀렉터 호환을 위해 모두 보존, pill 래퍼(`.verse-action-pill`)와 노트
> 버튼(`#verse-select-note-btn`)만 신설. CSS 는 `#tab-dock`/`#tab-bar`/`.tab-item`/
> `#tab-search` 패턴 미러. 등장 시 페이드/슬라이드 인(reduced-motion 스냅).
> 절 선택 바가 하단 chrome 을 대체하므로 진입 시 탭 dock(홈·검색)·미니 오디오 바·
> tabbar scrim 을 모두 숨기고 종료 시 복원(`body.verse-select-active`). 미니 오디오는
> 스크롤 축소 규칙(`body.tabbar-collapsed #audio-bar:not([hidden])`, 특이도 1,2,1)이
> 절 선택 숨김(1,1,1)을 이겨 축소 중 진입 시 액션 바 뒤로 비쳤던 버그를
> `display: none !important` 로 해소.

**헤더 북마크 아이콘** (`.title-bookmark-btn`): `buildBookmarkHeaderBtn()` 호출.
아이콘: Material Icons `bookmarks` SVG. 장 북마크 여부 표시 제거
(`.has-bookmark` 클래스 및 관련 CSS 삭제).

> **개정 (2026-06-05):** 헤더 북마크 아이콘은 **책 읽기 화면(장·머리말)
> 헤더에서만** 노출한다. 성서 목록 화면(`renderBookList`) 헤더에서는 제거 —
> 장 맥락이 없어 '이 장 저장'이 의미가 없고, 북마크 전체 관리는 하단 탭 바의
> 북마크 탭(ADR-029)이 담당하므로 목록 헤더의 북마크 진입점은 중복이었다.

> **개정 (2026-06-06):** 모바일 읽기 화면에서 헤더 북마크 아이콘이 **토글**로
> 동작한다 — 장이 북마크돼 있지 않으면 기존대로 '이 장 저장' 모달, **이미
> 북마크된 장이면 삭제 확인 모달**(`#bm-confirm-modal`)을 띄워 해당 장의
> 북마크를 제거한다(채워진/빈 아이콘 토글과 동작 일치). 한 장에 북마크가
> 여러 개면(예: 장 전체 + 절 범위) 모두 함께 삭제한다 — 채워진 아이콘은
> 장 단위 토글이기 때문. 클릭 핸들러는 렌더 시점 상태가 아니라
> `findExistingChapterBookmarks()`로 **클릭 시점에 재확인**한다.
> 동시에 파괴적 삭제 확인을 네이티브 `window.confirm()` → 테마/포커스 트랩이
> 적용된 공용 확인 모달(`openConfirmModal()`)로 통일했다 — 스와이프 행 북마크
> 삭제·폴더 삭제도 같은 모달을 사용한다(확인 버튼 `#c0392b` 파괴색,
> 기본 포커스는 안전한 '취소'). 확인 메시지 문안은 순수 함수
> `_chapterDeleteMessage()`로 분리해 유닛 테스트.

> **개정 (2026-06-06 후속): 장 북마크 선택 삭제 picker.** *(→ 2026-06-10 제거됨 — 아래 참조. 헤더 토글이 폐지되며 진입점을 잃어 모달 DOM·CSS·`openChapterDeleteModal`·e2e 일괄 삭제. `_selectAllState`는 벌크 선택이 계속 사용해 보존.)*
> 헤더 토글-오프의 단일 "이 장 전부 삭제" 확인 모달(`#bm-confirm-modal`)을
> **장 안의 북마크를 골라 지우는 선택 모달**(`#bm-chapter-delete-modal`)로
> 개편했다. 한 장에 장 전체·여러 절 범위 북마크가 섞여 있을 때 "전부 삭제"는
> 너무 거칠어서, 이 장의 각 북마크를 **체크박스 목록**(라벨 + 참조 `창세 1:1-3`)
> 으로 보여주고 사용자가 지울 항목만 고른다.
> - **"전체 선택"**(`#bm-chapter-delete-all`)은 tri-state 토글 — 없음=빈,
>   일부=indeterminate, 전부=체크. 순수 함수 `_selectAllState(sel, total)`로
>   상태 계산.
> - **기본은 미선택**(전체 선택이 일괄 선택 어포던스이므로). 삭제 버튼은 선택 0
>   이면 `disabled`, 선택 시 `삭제 (N)` 카운트 표기 — 순수 함수
>   `_deleteBtnLabel(count)`. 목록 선택 자체가 곧 확인이라 중첩 확인은 없다
>   (단일 스텝, iOS 다중 선택 삭제 idiom).
> - `openChapterDeleteModal(candidates)` / `closeChapterDeleteModal()` 신규.
>   삭제색 `#c0392b` 확인 버튼·체크박스 `accent-color`, 기본 포커스는 안전한
>   '취소', `trapFocus` + Escape + scrim 탭 닫기 + `route()`가 네비 시 dismiss
>   (`window.closeChapterDeleteModal`). 모바일 전용(데스크탑은 종전대로 드로어).
> - 구 `confirmRemoveChapterBookmarks()`·`_chapterDeleteMessage()` 제거,
>   해당 유닛 테스트는 `_selectAllState`·`_deleteBtnLabel`로 대체. e2e는
>   토글-삭제(전체 선택)·취소·**선택 삭제(고른 것만 지우고 나머지 유지)** 3종.

> **개정 (2026-06-09): 헤더 북마크 = 모바일은 '이 장 추가' 전용, 데스크탑은 진입점 유지.**
> 모바일 읽기 화면의 헤더 북마크를 **토글**(위 2026-06-06 개정)에서 떼어내,
> 탭 바(ADR-029)와 역할을 나눴다. 근거: 탭 바에 북마크 탭이 있으니 **네비·관리는
> 탭 바로 통일**하고, 헤더는 탭 바가 못 하는 **맥락 동작('지금 이 장 추가')**만 맡는다.
> - **모바일(탭 바 존재, ≤768px):**
>   - 미저장 장 → 헤더에 '추가'(아웃라인 + `+`) 아이콘. 탭하면 **폴더 위치를 고르는
>     저장 모달**(`openSaveModal("chapter")` — 최상위·폴더 목록·새 폴더 콤보박스)을 연다.
>   - 이미 북마크된 장, 그리고 책 장-목록 화면(추가할 장 맥락 없음) → 헤더 북마크 **숨김**.
>     관리·해제는 탭 바 → 북마크 탭(행 스와이프·선택 모드)이 담당.
> - **데스크탑·가로 폰처럼 탭 바가 없는 >768px:** 헤더 북마크가 **유일한 진입점**이라
>   종전대로 유지 — 상태(채워짐/빈) 표시 + 탭하면 북마크 시트(드로어).
> - **구현:** 보임/숨김을 JS 일회성 체크가 아니라 **CSS 미디어 쿼리**로 처리
>   (`@media (max-width:768px){ .title-bookmark-btn.has-bookmark, .is-list{display:none} }`).
>   클릭 분기만 `_isMobileViewport()`로 판정(저장 모달 vs 드로어). 미디어 쿼리라
>   **폰을 가로로 돌려 탭 바가 사라지는 순간 헤더 북마크가 자동으로 다시 나타나** 회전에
>   강건하다(JS resize 리스너 불필요). `.is-list`는 장 맥락 없는 헤더(chapter==null) 표식.
> - **부수:** 헤더에서 더는 삭제하지 않으므로 장-삭제 선택 picker(`#bm-chapter-delete-modal`,
>   `openChapterDeleteModal`)는 진입점을 잃어 미사용이 됐다 → **2026-06-10 제거 완료**:
>   모달 DOM(index.html)·CSS·`open/closeChapterDeleteModal`·`_deleteBtnLabel`(picker 전용
>   헬퍼)·관련 유닛/e2e 일괄 삭제. tri-state 헬퍼 `_selectAllState` 는 벌크 선택 모드
>   (ADR-029)가 계속 쓰므로 보존. 삭제는 시트 안의 행 스와이프·선택 모드가 담당.

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

> **개정 (2026-05-06):** 모바일 스와이프 시 행 텍스트가 좌측으로 밀려 사라지는 문제 수정.
> 이제 `.bm-row-content`는 고정되어 있고, `.bm-row-actions-mobile` 패널이 우측에서
> `translateX(100% → 0)`으로 슬라이드 인하여 행의 우측 부분을 **오버레이**한다 (z-index:1).
> 텍스트가 길면 액션 버튼이 텍스트 위를 가리는 동작은 의도된 것이다.
> 또한 `.bm-row-content`에 `min-height: 44px`를 적용해 폴더와 북마크 행 높이를 일치시키고
> 터치 타겟을 WCAG 기준에 맞춤. `prefers-reduced-motion` 처리 대상도
> `.bm-row-content` → `.bm-row-actions-mobile`로 이동.

> **개정 (2026-06-06): 양방향 스와이프 + full-swipe (iOS Files/Mail 벤치마크).**
> 단방향(좌측 스와이프 → 우측 수정/삭제 2버튼 패널) 모델을 **양방향 edge-flush 스와이프 액션**으로 재구성.
> 모델을 "패널 오버레이"에서 **"콘텐츠 슬라이드"**로 전환 — 불투명한 `.bm-row-content`(z-index:1)가
> 슬라이더가 되어 행 양 끝에 깔린 단일 액션(`.bm-swipe-action`)을 노출한다.
> - **왼쪽으로 스와이프** → 콘텐츠 좌측 이동 → 우측 가장자리 **수정**(`.bm-swipe-edit`, 중립 accent).
> - **오른쪽으로 스와이프** → 콘텐츠 우측 이동 → 좌측 가장자리 **삭제**(`.bm-swipe-delete`, 빨강).
> - **full-swipe**: 행 너비 ×0.45(최소 reveal+40px) 이상 밀고 놓으면 해당 액션 즉시 실행
>   (armed 상태에서 액션 배경이 행 전체로 확장 — iOS 시각 큐). 절반 미만이면 닫힘,
>   `SWIPE_REVEAL_PX/2` 이상이면 버튼 고정(reveal). `SWIPE_REVEAL_PX` 140→**88**(단일 버튼 폭),
>   토큰 `--swipe-reveal: 88px`로 JS·CSS 동기화.
> 상태는 `bm-swiped`(열림) + 방향 클래스 `bm-swiped-edit`/`bm-swiped-delete`로 추적,
> `_openSwipedRow(row, dir)`·`_resetRowSwipe(row)`. full-swipe 실행은 노출된 버튼의 `.click()` 위임
> (확인 다이얼로그·핸들러 재사용). 텍스트 오버레이 가림 이슈는 콘텐츠가 함께 미끄러지므로 자연 해소.
> `prefers-reduced-motion`은 `.bm-row-content { transition: none }`. 순수 상태 로직은 유닛
> (`SWIPED_ROW` 블록), 제스처·full-swipe는 e2e.
>
> **시각 다듬기 (2026-06-06 후속):** 액션을 **full-bleed**(좌우 0)로 깔고 방향 클래스
> (`bm-swiping-delete/edit` 드래그 중, `bm-swiped-delete/edit` 고정)로 해당 방향만 `opacity:1` 노출 —
> 평상시(닫힘) 액션이 안 보이고, 노출 시 **컬러가 화면 가장자리 끝까지** 채워진다(양방향). **콘텐츠 카드**에만
> `border-radius`(스와이프/열림 시)를 줘 카드 모서리만 둥글고 액션은 가장자리 직각으로 닿는다. 라벨은
> `--swipe-reveal` 폭 고정 span 을 가장자리에 핀(`flex-start`/`flex-end`)해 **full-swipe 로 액션이 넓어져도
> 글자가 중앙으로 밀리지 않는다**. 행 높이: 본문 1.8 leading 상속으로 2줄 북마크가 1줄 폴더보다 커서 짧은
> 폴더 뒤 액션이 비치던 문제 → `.bm-row-content` 에 `line-height: --leading-snug` + 공유 `min-height` +
> `align-self: stretch` 로 폴더·북마크 **동일 높이** + 콘텐츠가 행을 꽉 채워 피킹 제거.
>
> **중첩 행 full-bleed (2026-06-06 후속²):** 폴더 안 북마크는 `.bm-folder-children`
> `padding-left`(들여쓰기) 때문에 행이 안쪽으로 밀려 스와이프 액션 컬러가 화면 끝에
> 닿지 못하고 여백이 생겼다. 모바일에서 **들여쓰기를 UL 패딩 → 콘텐츠 패딩으로 이전** —
> `.bm-folder-children { padding-left: 0 }`(행 full-bleed) + `.bm-row-content`
> `padding-left: calc(var(--space-4) + var(--bm-indent))`, 깊이별 `--bm-indent`(= `--space-8 × depth`)
> 를 아이템 빌더가 콘텐츠에 인라인 설정. 본문 위치는 동일(루트 16px, depth1 48px…)하되 행은
> 가장자리까지 차 액션 컬러가 화면 끝에 닿는다. 데스크탑은 스와이프가 없어 기존 UL 패딩 유지.

> **개정 (2026-06-07): 스와이프 방향을 iOS 관례로 교체 + 탭 hit-test 버그 수정.**
> 위 2026-06-06 모델은 **왼쪽=수정 / 오른쪽=삭제**였는데, 이는 iOS 관례(Mail·메시지·메모의
> "왼쪽으로 밀어 삭제")와 정반대였다. 파괴적 액션을 **trailing(오른쪽 가장자리, 왼쪽 스와이프)**,
> 비파괴(수정)를 **leading(왼쪽 가장자리, 오른쪽 스와이프)**로 교체:
> - **왼쪽으로 스와이프** → 우측 가장자리 **삭제**(`.bm-swipe-delete`, 빨강).
> - **오른쪽으로 스와이프** → 좌측 가장자리 **수정**(`.bm-swipe-edit`).
>
> JS(`onMove` 토글·`finish` full/partial·re-grab `baseOffset`)와 CSS(엣지 앵커 `justify`,
> 스냅 `translateX` 부호)를 일괄 swap. **버그 수정:** 두 액션이 `position:absolute; inset:0`로
> 겹쳐 깔려, DOM 상 뒤에 추가된 수정 버튼이 위에 올라가 **삭제가 노출돼도 탭이 수정으로 가던**
> 문제를 `pointer-events`로 차단 — 기본 `none`, 노출된 방향만 `auto`(full-swipe 의 프로그램적
> `.click()`은 무관). e2e `test_bookmark_swipe.py` 를 새 방향 + 노출 스트립 좌표 클릭(실 hit-test)으로 갱신.

> **개정 (2026-06-07): 재정렬 ≡ 핸들 (직접 정렬 모드 한정, ADR-029 연계).**
> 롱프레스-드래그는 상시 어포던스가 없어 "재정렬 가능"이 안 보였다(HIG의 두 패턴 중 발견성이
> 낮은 쪽). iOS 편집모드의 재정렬 컨트롤(≡)을 본떠 각 행 trailing 에 ≡ 핸들(`_buildDragHandle`,
> 가로줄 3개)을 추가하되, **정렬이 `manual`(직접 정렬)일 때만 노출** — `renderBookmarkTree` 가
> 트리에 `bm-sortable` 토글, CSS `.bm-drag-handle { display:none } .bm-sortable .bm-drag-handle { … }`.
> 자동 정렬에선 드롭이 재정렬돼 무의미하므로 핸들도 숨김 → 핸들이 "재정렬 가능 + 현재 직접정렬
> 모드"를 함께 신호. 핸들에서 시작한 포인터는 **롱프레스/스와이프 분류를 건너뛰고 즉시 드래그**
> (`onHandle` 분기, 터치·마우스 공통) — iOS 핸들처럼. `aria-hidden`(포인터 전용, 키보드 재정렬 미지원).

> **개정 (2026-06-07): 삭제 확인 취소 시 행이 제자리로 닫히도록 수정.**
> 행 액션 `deleteAction`(북마크·폴더 공통)이 `closeSwipedRow` 를 `onConfirm` *안*에서만 호출해,
> 삭제를 탭해 확인창을 띄운 뒤 **취소하면 행이 스와이프 열린 채(삭제 액션 노출) 남는** 버그가
> 있었다(수정 `editAction` 은 탭 즉시 닫아 정상). `closeSwipedRow(null)` 을 `openConfirmModal`
> *앞*으로 옮겨, 삭제 탭 즉시 행을 닫고 확인은 실제 삭제만 담당하게 했다 — 확인을 취소해도 행이
> 제자리로 돌아온다. e2e `test_bookmark_swipe.py::test_cancel_delete_confirm_closes_swipe`.
>
> **폴더 삭제 의미(검토 후 현행 유지):** "폴더 삭제 = 그룹만 해제(내용 보존)" 대안을 검토했으나,
> **"삭제는 곧 삭제" 라는 보편 기대 + 진입점 간 일관성**(선택-삭제 모드의 폴더 cascade, ADR-029)을
> 위해 **폴더 삭제는 폴더+내용물 cascade 로 유지**한다(스와이프·행·드로어·선택 모드 모두 동일).
> 확인창이 개수("…폴더와 안의 항목 N개를 모두 삭제할까요?")를 명시해 범위를 분명히 한다. 그룹만
> 풀고 싶으면 항목을 먼저 밖으로 드래그한다.

> **개정 (2026-06-07): 드롭 위치 지시자 가시화 + 행 아이콘 크기 표준화.**
> (1) **드롭 지시자** — 드래그-재정렬의 before/after/into 표시(`_updateDragIndicators` 가 대상
> `<li>` 에 `.drag-over-*` 부여; 로직은 그대로)가 **모바일에서 안 보이던 버그** 수정. 표시 CSS 가
> 행(`.bm-…-row`)에 `inset box-shadow` 였는데, 모바일은 불투명 `.bm-row-content`(z-index 1)가 행을
> 덮어 가려졌다. → 표시를 **보이는 콘텐츠 층으로 이동**: before/after = `.bm-row-content::after` 의
> **3px accent 삽입선**(대상 행 상/하단, = 드롭 갭), into = 콘텐츠에 accent 14% 틴트 + 2px outline.
> `.bm-row-content` 에 `position: relative` 추가(::after 기준). 고스트는 이미 `pointer-events:none`
> 라 `elementFromPoint` 가 행을 맞춘다(클래스 부여는 정상이었음 — 문제는 표시뿐). e2e
> `test_bookmark_dnd.py::test_drop_indicator_renders_on_content`(클래스 직접 적용해 ::after·outline
> 검증 — 실제 포인터 드래그는 타이밍 불안정).
> (2) **행 아이콘 크기** — 책갈피·폴더 선행 아이콘이 1.6rem 슬롯 안에 **고정 20px SVG** 라 작아
> 보이고 Dynamic Type 도 안 따랐다. 토큰 **`--bm-row-icon`(1.6rem)** 신설 — 슬롯과 SVG 가 같은
> 토큰을 써 아이콘이 슬롯을 꽉 채우고(20px→~29px) 본문 폰트와 함께 rem 스케일.
> (3) **행 높이** — 행 높이가 북마크 전용 하드코딩(데스크탑 4rem / 모바일 콘텐츠 4.4rem≈79px)이라
> 2줄 콘텐츠(≈52px) 대비 과하게 떠 보였다. 후속 목록(노트·캘린더 등)·혼합 항목까지 공유할
> **표준 토큰 `--list-row-h`(3.5rem≈63px)** 신설 — 세로 패딩을 `--space-1` 로 줄여 토큰(min-height)이
> 곧 행 높이가 되게 하고(폴더 1줄·북마크 2줄 동일 높이 유지), rem 스케일. 79px→63px(-20%).
