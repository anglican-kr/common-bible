# ADR-010: 즐겨찾기(북마크) 기능 설계

- 일시: 2026-04-25
- 상태: 승인됨 — 구현 완료 (2026-04-25 · 모바일 행 제스처는 2026-05-03부터 06-11까지 다듬었다 · 절 선택 막대 2026-06-06 · 범위 선택 2026-06-13 · 주소의 절 범위 검사 2026-10-21 — ADR-040 · 절 선택을 줄 키로 2026-10-21)
- 관련: ADR-011(기기 사이 동기화 · 내보내기 · 가져오기), ADR-022(인용 — 산문 절의 분절), ADR-029(하단 탭 바 · 북마크 탭 · 선택 모드), ADR-030(모핑 탭 바 · 글래스), ADR-032(오버레이 컨트롤러), ADR-034(모듈 분할), ADR-035(모아 읽기), ADR-040(가져오기 항목 검사 · 절 범위 검사)

## 결정

`localStorage` 기반 클라이언트 전용 북마크 저장소를 구현한다. 사용자는 현재 장 전체 또는 선택한 절(세그먼트 단위 포함)을 저장하고, 폴더로 분류 · 관리할 수 있다.

- **절 범위는 URL path에 spec 문자열로 인코딩한다**(`/john/3/1-5,10-15`, `/ps/23/3a,5-7`). 장 화면이 이를 해석해 해당 span만 하이라이트한다. 여러 구간은 앱이 쓰는 표기일 때만 강조한다(검사는 ADR-040 — 아래 「절 범위와 주소」).
- **세그먼트는 `data-vref` 문자열로 적는다** — 단일 행 절은 `"3"`, 다중 행 절은 `"3a"` · `"3b"` · `"3c"` …. 북마크를 저장할 때는 인용으로 분절된 산문 절을 절 전체로 올린다. **절 선택은 줄마다 다른 `data-vkey`로 한다** — 한 장에 번호가 같은 다른 절이 있어(다니 3 의 그리스어 (24) 와 히브리 24, 이사 40 에 옮겨 실린 41:6, 에스 4:17 의 추가 본문) `data-vref`로는 줄이 갈리지 않는다. 저장되는 spec은 그대로 번호 단위다.
- **모바일 행** — 탭은 이동, 왼쪽으로 밀면 삭제, 오른쪽으로 밀면 수정(iOS 관례), 끝까지 밀면 바로 실행한다. 재정렬은 직접 정렬일 때 보이는 ≡ 핸들에서만 시작한다.
- **헤더 북마크** — 모바일(탭 바가 있는 판)은 「이 장 추가」만, 데스크톱은 상태 표시와 북마크 드로어 진입점이다. 관리는 북마크 탭(ADR-029)이 맡는다.
- **절 선택 모드** — 읽기 화면을 길게 눌러(500ms) 들어가고, 앵커 방식으로 범위를 고른다. 하단 글래스 막대에 북마크 · 복사가 있다.
- 목록은 옛 키(`bible-bookmarks`)와 동기화 저장소(`bible-bookmarks-v2` — ADR-011)에 두 벌로 저장된다.

## 맥락

Phase 1 완료 후 "어제 읽던 곳을 빠르게 찾는" 사용 패턴이 주요 요구사항으로 부상했다.
성경 앱에서 북마크는 필수 기능이지만, 서버 없이 PWA 오프라인 완전 지원을 유지해야 한다는
아키텍처 제약이 있었다. 또한 시편·욥기 등 운문에서 **헤미스티치(반행)** 단위로
절이 렌더링되므로, "3절 전체"뿐 아니라 "3절 첫 번째 행(3a)"만 저장하는 세밀한
선택이 필요했다.

## 구현

### 데이터 스키마

옛 키 `"bible-bookmarks"`에 아래 트리를 그대로 두고, 동기화 저장소 `"bible-bookmarks-v2"`가 같은 목록을 항목마다 부모 id · 순서 · 시각을 붙여 평탄화해 함께 둔다(`storage.js saveBookmarks` — ADR-011). 가져오기가 받는 형식도 이 스키마다(ADR-040).

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
  updatedAt?: number,   // 고치거나 옮길 때
}

type Folder = {
  type: "folder",
  id: string,
  name: string,
  children: Array<Bookmark | Folder>,
  expanded: boolean,    // 저장은 하지만 렌더링 시 무시 — 아래 「북마크 드로어」
  createdAt?: number,
  updatedAt?: number,   // 이름을 바꾸거나 옮길 때
}

type BookmarkStore = Array<Bookmark | Folder>
```

정렬 기준 · 방향과 「최근에 본」 시각은 이 트리 밖, 기기마다의 `localStorage`에 둔다 — `bible-bookmark-sort` · `bible-bookmark-sort-dir` · `bible-bookmark-viewed`(아래 「정렬」).

### 절 범위와 주소 (`js/app/routing.js` · `js/app/views.js`)

`parsePath()`가 장 주소의 셋째 조각을 절 범위로 읽고, 반환값의 `highlightVerse` · `highlightVerseEnd`(구간 하나) 또는 `highlightVerseSpec`(여러 구간)으로 넘긴다.

- **구간 하나**(`/john/3/16` · `/john/3/16-20`)는 펼치지 않는다. 거꾸로 된 범위는 바로 세운다(`20-16` → 16-20). 장을 넘는 끝은 `renderChapter`가 그 장의 마지막 절로 자르고, 바로 세운 범위로 주소를 고친다(`16-200` → `16-36`, `40-10` → `10-36`). 시작이 장을 넘으면 강조 없이 장만 연다.
- **여러 구간**(`/john/3/1-5,10-15` · `/ps/23/3a,5-7`)은 앞뒤 쉼표를 걷은 뒤, 앱이 쓰는 표기인지 `isWellFormedSpec`(`js/app/verse-spec.js`)으로 본다. 기준은 ADR-040 「절 범위」다 — 오름차순 · 겹침 없음 · 숫자 1-999 · 부분 글자 a-p · 1,000구간까지. 통과하면 `parseVerseSpec()`으로 읽어 정규형(`selectedVersesToSpec`)으로 넘기고, 통과하지 못하면 강조 없이 장만 연다. 이 갈래는 구간을 절 하나하나로 펼치므로, 검사 없이는 큰 범위가 시작 화면을 멈추고 탭을 죽였다(known-issues §15).

`parseVerseSpec()` 반환 항목에는 `part` 필드가 있다:
- `"3a"` → `{ start: 3, end: 3, part: "a" }`
- `"5-7"` → `{ start: 5, end: 7 }` (part 없음)

장 본문을 그리는 `views.js appendVerses`(`renderChapter`가 부른다)가 span마다 강조를 판정한다 — `vref`를 `classes`보다 먼저 계산해 쓴다:

```js
const isHighlightedSpan = hlSegments
  ? hlSegments.some(s =>
      s.part ? vref === `${s.start}${s.part}` : (vn >= s.start && vn <= s.end))
  : (hlVerse && vn >= hlVerse && vn <= (hlVerseEnd || hlVerse));
```

### 세그먼트와 저장 표기

운문 절은 여러 span으로 분리 렌더링된다. 선택은 span마다 다른 `data-vkey`를 모은다(`readingContext.selectedVerses: Set<string>` — 「3a」와 「3b」를 따로 고를 수 있다). `data-vkey`는 `<절 인스턴스 키>/<data-vref>`다(`views.js appendVerses` — 인스턴스 키는 DOM id와 같은 `verse-spec.js verseInstanceKeys`, ADR-038 A2). 번호만으로는 절이 갈리지 않는다 — 옮겨 실린 절(`chapter_ref`) · 그리스어 추가 본문(`lxx_only`) · 에스델 추가 본문(`alt_ref`) · 전례시편의 ¶ 구절(`versicle`)이 이 장의 다른 절과 번호를 함께 쓴다. `data-vref`로 고르던 때(2026-10-20까지)는 그런 절 하나를 누르면 같은 `data-vref`의 줄이 모두 칠해졌다 — 이사 40 의 41:6 을 누르면 40:6 도, 에스 4:17 의 추가 본문 하나에 25 절이.

- **운문 단위** — 운문으로만 된 다중 행 절은 한 줄을 눌러도 절 전체를 고른다(`_verseSelectionUnit`). 「절」은 인스턴스 키에서 반절 글자와 ¶ 표지를 뗀 것이다 — 데이터의 반쪽 절(이사 7 의 8a · 8b — 9a 를 사이에 두고 나뉘어 실림)과 ¶ 구절은 그 번호 절과 한 단위다(번호로 고르던 때와 같다). 그 밖의 인스턴스는 번호가 같아도 따로다.
- **선택 막대 · 복사** — `selectionCitation(selected, article)`가 고른 줄의 `data-vref`로 출처를 만든다. 한 번호의 줄을 다 고르면 `"3a,3b"`를 `"3"`으로 통합하고, 일부만 고르면 span 단위 그대로다. 번호는 장 본문 복사의 출처(`views.js bindCopyAttribution` — ADR-038 §3 「구현」)와 같은 규칙을 따른다: 옮겨 실린 절(`verse-cross-ref`)과 그리스어 추가 본문(`verse-lxx`)은 그것만 골랐을 때만 그 번호를 쓰고, 다른 절과 함께면 뺀다(이사 40:19 → 20 은 사이의 41:6-7 을 함께 골라도 「40:19-20」). 옮겨 실린 절만이면 제 장으로 적는다 — 출처 「이사야 41:6-7」, 막대 「41:6-7절 선택됨」(사용자 결정 2026-10-21 — 버린 안은 ADR-038 「검토한 대안」). 남은 절 가운데 한 번호를 여러 절이 함께 쓰면(에스 4:17 과 추가 본문, ¶ 구절과 그 절) 줄 글자가 어느 절의 줄인지 말하지 못하므로 그 번호의 어느 줄을 골라도 번호로 적는다(「4:17」).
- **북마크 저장** — `collapseSegmentedVerses(selectedSpanVrefs(selected, article), article)` — 고른 줄의 `data-vref`를 모아 종전대로 번호 단위로 접는다. 인용(`<cite>`)이 박힌 산문 절은 인용 위치에서 a/b/c 라인-스팬으로 분절되는데(ADR-022), 개념상 한 절이므로 일부만 선택해도(예: 23a만, 또는 23a · 23c) 저장되는 spec은 `23`이다 — 다중-스팬 절이면 `allSelected` 조건 없이 정수 절번호로 통합한다. 운문 다중-스팬 절은 이미 한 덩어리로 선택되므로 영향이 없다.

### 주요 유틸리티 함수

| 함수 | 모듈 | 역할 |
|------|------|------|
| `parseVerseSpec(spec)` | `verse-spec.js` | spec 문자열 → `{start,end,part?}[]` |
| `isWellFormedSpec(spec)` | `verse-spec.js` | 앱이 쓰는 표기인가 — 가져오기와 주소가 함께 쓴다(ADR-040) |
| `selectedVersesToSpec(refs)` | `verse-spec.js` | `string[]` → spec 문자열. 정수 연속 구간만 범위 압축 |
| `_compareRefs(a, b)` | `verse-spec.js` | `"3" < "3a" < "3b" < "4"` 정렬 |
| `selectionCitation(selected, article)` | `verse-spec.js` | 고른 줄(`data-vkey`)의 출처 `{ chapter, refs }` — 다 고른 번호는 `"3a,3b"` → `"3"`, 옮겨 실린 절 · 그리스어 절은 그것만일 때만(옮겨 실린 절은 `chapter`가 제 장) (선택 막대 · 복사 경로) |
| `selectedSpanVrefs(selected, article)` | `verse-spec.js` | 고른 줄의 `data-vref`, 문서 순서 (북마크 저장 경로) |
| `collapseSegmentedVerses(refs, article)` | `verse-spec.js` | 북마크 저장 전용. 다중-스팬 절은 부분 선택이어도 절 전체로 승격 (`"23a,23c"` → `"23"`) |
| `mergeVerseSpecs(specA, specB)` | `verse-spec.js` | 두 spec의 합집합(합치기) |
| `_findParentFolderId(store, id)` | `bookmark-core.js` | 북마크가 속한 폴더 ID 반환 (root = null) |
| `_isActiveBookmark(bm)` | `bookmark-core.js` | `window.location.pathname === _bookmarkHref(bm)` |
| `_hasActiveDescendant(folder)` | `bookmark-core.js` | 재귀적으로 활성 북마크 포함 여부 확인 |
| `generateId()` | `storage.js` | `Date.now().toString(36) + random` |
| `_buildFolderToggleIcon(open, size)` | `bookmark-tree.js` | Material Icons `folder`/`folder_open` SVG 반환 |
| `_buildBookmarkTypeIcon(active, size)` | `bookmark-tree.js` | outlined/filled `bookmark` SVG 반환 |

### 북마크 드로어 (`#bookmark-drawer`)

데스크톱에서 헤더 북마크로 여는 패널이다. 모바일의 북마크 탭(ADR-029)도 같은 트리 빌더(`bookmark-tree.js`)로 그린다. ARIA tree widget(`role="tree"`, `role="treeitem"`, `role="group"`).

- **툴바** — 아이콘 전용 버튼, 우측 정렬. 순서: 새 폴더(`create_new_folder`) → 이 장 저장(`bookmark_add`) → 절 선택(`text_select_move_forward_character`) → 더 보기(⋯ — 내보내기 · 가져오기, ADR-011).
- **폴더 행** — `_buildFolderToggleIcon(open)`의 `folder` / `folder_open` SVG가 열림을 보이고, 폴더 행 전체 클릭/터치로 펼치기 · 접기.
- **북마크 행** — `_buildBookmarkTypeIcon(active)`: 비활성 시 outlined `bookmark`, 활성 시 filled `bookmark`. 활성 북마크(`_isActiveBookmark(bm)`)는 `.bm-active` 클래스로 배경 강조 + 아이콘 · 레이블에 accent 색상을 적용한다.
- **열 때 폴더는 접혀 있다** — `expanded` 필드는 localStorage에 계속 저장되지만, 드로어를 열 때 항상 `false`(접힌 상태)로 렌더링한다. `_hasActiveDescendant(folder)`가 true인 폴더만 자동으로 펼친다. 스키마 하위 호환성을 위해 필드는 유지한다.
- **키보드** — WAI-ARIA Tree Pattern(`↑↓` 포커스 이동, `→←` 폴더 열기/닫기 · 부모 이동, `Enter`/`Space` 활성화, `Home`/`End` 처음 · 끝). 버튼 · 링크에서는 트리 키를 무시한다. roving tabindex.

### 저장 · 병합 · 확인 모달

- **저장 모달**(`#bm-save-modal`, `openSaveModal`) — 제목 · 메모 · 저장 위치 입력. 저장 위치는 `_findParentFolderId()`로 현재 위치를 pre-select한다. `overflow: visible`로 폴더 선택 콤보박스(최상위 · 폴더 목록 · 새 폴더) 드롭다운이 모달 밖으로 열린다.
- **병합 다이얼로그**(`#bm-merge-modal`) — 동일 장에 북마크가 이미 있으면 「합치기 / 따로 저장 / 취소」. 합치기는 `mergeVerseSpecs`.
- **확인 모달**(`#bm-confirm-modal`, `openConfirmModal()`) — 파괴적 동작(행 스와이프 삭제 · 폴더 삭제 · 선택 모드 삭제)이 함께 쓴다. 확인 버튼은 파괴색 `#c0392b`, 기본 포커스는 안전한 「취소」. 테마와 포커스 트랩이 적용된다.
- **폴더 삭제는 폴더 + 내용물 cascade다**(스와이프 · 행 · 드로어 · 선택 모드 모두 동일). 확인창이 개수(「…폴더와 안의 항목 N개를 모두 삭제할까요?」)를 명시해 범위를 분명히 한다. 그룹만 풀고 싶으면 항목을 먼저 밖으로 드래그한다.

모달 · 드로어는 공용 오버레이 컨트롤러(`overlay.js createOverlay` — ADR-032)로 포커스 트랩 · inert 배경 · Escape 닫기를 얻는다.

### 헤더 북마크 (`.title-bookmark-btn`)

`buildBookmarkHeaderBtn()`(`bookmark.js`) — 아이콘은 Material Icons `bookmarks`. **책 읽기 화면(장 · 머리말) 헤더에서만** 노출한다. 성서 목록 화면(`renderBookList`) 헤더에는 없다 — 장 맥락이 없어 「이 장 저장」이 의미가 없고, 북마크 전체 관리는 하단 탭 바의 북마크 탭(ADR-029)이 담당한다.

탭 바에 북마크 탭이 있으니 **네비 · 관리는 탭 바로 통일**하고, 헤더는 탭 바가 못 하는 **맥락 동작(「지금 이 장 추가」)**만 맡는다.

- **모바일 · 터치 — 탭 바가 있는 판(`(max-width: 768px), (pointer: coarse)`)**
  - 저장되지 않은 장 → 헤더에 「추가」(아웃라인 + `+`) 아이콘. 탭하면 **폴더 위치를 고르는 저장 모달**(`openSaveModal("chapter")`)을 연다.
  - 이미 북마크된 장, 그리고 책 장-목록 화면(추가할 장 맥락 없음 — `.is-list`, chapter == null) → 헤더 북마크를 **숨긴다**. 관리 · 해제는 탭 바 → 북마크 탭(행 스와이프 · 선택 모드)이 담당한다.
- **데스크톱(`(min-width: 769px) and (pointer: fine)`)** — 헤더 북마크가 **유일한 진입점**이라 상태(채워짐/빈 — `.has-bookmark`)를 표시하고, 탭하면 북마크 드로어를 연다.
- **구현** — 보임/숨김은 JS 일회성 체크가 아니라 **CSS 미디어 쿼리**다(`.title-bookmark-btn.has-bookmark, .title-bookmark-btn.is-list { display: none }`). 클릭 분기만 `_isMobileViewport()`(같은 쿼리)로 판정한다(저장 모달 vs 드로어). 미디어 쿼리라 판이 바뀌면 JS resize 리스너 없이 따라간다. 폭만이 아니라 포인터로도 가르므로, 가로로 든 폰 · 태블릿도 탭 바와 「추가」를 유지한다(ADR-029).

### 절 선택 모드 (`#verse-select-bar`)

- **진입** — 읽기 화면 롱프레스 500ms(`ENTER_SELECT_MS`) 또는 드로어 「절 선택」 버튼. 10px 넘게 움직이면 취소한다(터치 드리프트 허용). 진입은 「정지한 손가락」과 「의도적 누름」을 지속 시간으로만 구분하므로 임계 시간이 유일한 레버이고, iOS · Android 표준 롱프레스에 맞췄다.
- **막대** — 탭 dock 형식의 floating glass + 아이콘 전용(ADR-030 형식 통일). 구조는 탭 dock 미러: 투명 flex dock = `[아이콘 글래스 pill] + [취소 글래스 원형]`. 선택 카운트는 캡슐 위 중앙에 부유하는 글래스 칩(`#verse-select-count`, `aria-live`)이다. pill(`.verse-action-pill`) 안에 **북마크 · 복사 + 노트 슬롯** 3개 아이콘(stroke, round cap/join — 탭 아이콘 언어).
  - 북마크 · 복사는 선택 0일 때 `disabled`(흐림). **노트는 후속 기능 placeholder**라 `aria-disabled`이고, 탭하면 「준비 중」을 announce한다(탭 dock 노트 탭과 동일 패턴).
  - 글래스 레시피는 탭 dock과 동일 토큰을 공유한다 — `--glass-sheen` + `--bg 50%` 틴트 + `blur(12px)` + 1px 테두리 + `--shadow-2` + `--glass-inset`, `--radius-pill`(캡슐 양 끝 반원), 60px 높이(`--dock-control`). CSS는 `#tab-dock` · `#tab-bar` · `.tab-item` · `#tab-search` 패턴을 미러한다. 등장 시 페이드/슬라이드 인(reduced-motion이면 스냅).
  - 다중 절 선택 모델이라 팝오버 대신 영속 하단 액션 바를 둔다(iOS 26 다중 선택 컨텍스트 툴바 idiom — 선택 시 등장, 해제 시 사라짐, 아이콘 contained 버튼).
  - 기존 ID(`#verse-select-bar` · `#verse-select-{count,bookmark-btn,copy-btn,cancel-btn}`)는 e2e · inert 셀렉터 호환을 위해 모두 보존하고, pill 래퍼(`.verse-action-pill`)와 노트 버튼(`#verse-select-note-btn`)만 따로 있다.
  - 절 선택 막대가 하단 chrome을 대체하므로 모드 동안 탭 dock(홈 · 검색) · 미니 오디오 바 · tabbar scrim을 모두 숨기고, 끝나면 되돌린다(`body.verse-select-active`). 미니 오디오는 스크롤 축소 규칙(`body.tabbar-collapsed #audio-bar:not([hidden])`, 특이도 1,2,1)이 절 선택 숨김(1,1,1)을 이겨, 축소 중에 들어가면 액션 바 뒤로 비쳤다 — `display: none !important`로 숨긴다.
- **범위 선택 — 기억된 앵커 기반**
  - **상태:** `readingContext.selectAnchor`(`string | null`) — 마지막으로 개별 토글된 절의 `data-vkey`. 일반 탭/클릭은 그 절을 토글하고 앵커를 그리로 옮긴다(해제면 null). 반복 탭으로 **비연속 절**을 모은다.
  - **범위 확장(앵커 → 타깃, additive):** 앵커가 기억돼 있어 두 끝점이 한 화면에 같이 보일 필요가 없다 — 시작 절을 탭하고 임의 거리만큼 스크롤한 뒤 끝 절을 지정한다.
    - **데스크톱:** 끝 절을 **Shift+클릭**. `pointerdown`의 `e.shiftKey` 분기에서 즉시 확장한다.
    - **모바일:** 끝 절을 **롱프레스**(300ms — `RANGE_EXTEND_MS`, 모바일의 「Shift」 역할). 선택 모드 안에서는 `pointerdown`이 per-pointer 타이머를 걸고, 10px 넘는 드리프트(스크롤)나 빠른 lift(= 탭)면 타이머를 취소한다(`_activePointers` 맵). 손가락을 끝까지 물고 있을 필요가 없어 스크롤 경합이 없다. 이미 모드에 들어와 의도적으로 조작 중인 사용자의 제스처라 진입(500ms)보다 짧게 둔다.
  - 두 경로 모두 순수 헬퍼 `_verseRangeKeys(allKeys, anchor, target, unitFn)`(`views.js` `VERSE_SELECTION` 블록 — 양방향, 운문 다중부분 경계 확장)로 범위를 계산한다. 키가 줄마다 달라 옮겨 실린 41:6 에서 시작한 범위가 그 자리에서 시작한다(번호로는 앞의 40:6 에서 시작했다).
  - 선택 모드에서는 `pointerdown`에 `preventDefault`를 걸지 않아 자유 스크롤이 된다(텍스트 선택은 `body.verse-select-active { user-select: none }`으로 차단).
  - **수명 가드:** 포인터는 `setPointerCapture`로 잡아, 손가락이 article 밖에서 떼지거나 드리프트해도 pointermove/up/cancel이 article로 retarget되어 타이머 · `_activePointers`가 확실히 정리된다(캡처는 스크롤을 막지 않는다 — 팬이 시작되면 브라우저가 `pointercancel`로 캡처를 해제하고, 핸들러는 이를 abort로 처리한다). 롱프레스 타이머 콜백과 pointerup 토글 모두 `readingContext.verseSelectMode`(타이머는 `article.isConnected`도)를 확인해, 모드 종료 · 네비게이션 뒤 늦게 도는 것이 상태를 되살리지 않게 한다.
  - 선택 모드 진입(읽기 화면 롱프레스 / 드로어 「절 선택」 버튼) 시 앵커를 초기화하고, 롱프레스 진입 절을 첫 앵커로 둔다.
  - 유닛 `tests/unit/views.test.js` — `_verseRangeKeys` 7케이스 · `_verseSelectionUnit` 8케이스, `tests/unit/verse-spec.test.js` — `selectionCitation` · `selectedSpanVrefs`(세 장의 실제 키). e2e `tests/e2e/test_copy.py` 「번호가 같은 다른 절」 다섯.

### 모바일 행 — 스와이프 (`js/app/bookmark-gestures.js` · `js/app/bookmark-tree.js`)

모바일 · 터치 판에서만이다(`_isMobileViewport()` — 위 헤더 북마크와 같은 쿼리). 데스크톱은 `:hover` / `:focus-within`으로 노출되는 `.bm-item-actions`(수정/삭제 버튼)를 그대로 쓴다. iOS Safari는 첫 탭을 hover로 처리하기 때문에, 그 방식으로는 모바일에서 북마크 항목으로 이동하려면 **두 번 탭**이 필요했다(첫 탭은 액션 버튼을 노출만 시키고, 두 번째 탭에서야 이동). 그래서 모바일 행은 아래 제스처로 나눈다.

- **단일 탭** = 즉시 이동(또는 폴더 펼치기).
- **왼쪽으로 스와이프** → 콘텐츠가 왼쪽으로 → 우측(trailing) 가장자리 **삭제**(`.bm-swipe-delete`, 빨강). **오른쪽으로 스와이프** → 좌측(leading) 가장자리 **수정**(`.bm-swipe-edit`, accent). 파괴적 액션을 trailing에 두는 iOS 관례(Mail · 메시지 · 메모의 「왼쪽으로 밀어 삭제」)다.
- **full-swipe** — 제스처 자체의 Δx가 commitPx(행폭 × 0.45, 최소 reveal + 40)를 넘고, 절대 오프셋이 reveal을 지났으면(반대 패널에서 중앙만 갓 넘긴 긴 당김의 오발 방지) 그 액션을 즉시 실행한다. 실행은 노출된 버튼의 `.click()` 위임이라 확인 다이얼로그 · 핸들러를 재사용한다. 열림 상태와 무관하게 같은 손동작 거리를 요구한다.
- **놓을 때** — 절대 오프셋이 `SWIPE_REVEAL_PX / 2` 이상이면 버튼을 고정(reveal)하고, 미만이면 닫는다. 빠른 플릭도 먹도록 release 시 최근 100ms(`SWIPE_VELOCITY_WINDOW_MS`) 표본으로 속도를 구해 **80ms 투영**(`SWIPE_FLICK_PROJECTION_MS`)한 위치에 그 임계를 적용한다. 단 **플릭은 커밋(full-swipe 실행)으로 승격되지 않는다** — 삭제 실행은 거리 게이트를 유지한다(트위치로 삭제 방지). 드래그 끝에 멈췄다 놓으면 표본 창이 비어 v ≈ 0, 순수 위치 스냅이다.
- **분류** — 8px(`SWIPE_SLOP_PX`, `Math.hypot`) 미만의 움직임은 미분류다. 수평이 수직의 1.2배(`SWIPE_ANGLE_BIAS`)를 넘어야 스와이프, 수직 우세면 즉시 스크롤에 양보, **애매한 대각 콘 안이면 미분류로 다음 샘플을 기다린다**. 좌/우 방향별 임계 차등은 두지 않는다 — 비대칭 체감의 실체는 재그랩 베이스 오프셋이었다(「검토한 대안」).
- 순수 판정 로직은 `SWIPE_GESTURE` 마커 블록(`_classifySwipeAxis` · `_swipeReleaseVelocity` · `_resolveSwipeRelease`)이고, 유닛 `tests/unit/bookmark.test.js`의 `SWIPE_GESTURE` 섹션 13케이스가 직접 구동한다(ADR-013 패턴). 제스처 통합은 e2e(`tests/e2e/test_bookmark_swipe.py`).
- **상태** — `bm-swiped`(열림) + 방향 클래스 `bm-swiped-edit` / `bm-swiped-delete`, 드래그 중 `bm-swiping-delete` / `bm-swiping-edit`. `_openSwipedRow(row, dir)` · `_resetRowSwipe(row)`, 열린 행 하나를 `_swipedRow`가 추적한다(`SWIPED_ROW` 블록 — 유닛).
- **자동 닫기** — 다른 행 스와이프 시 이전 행이 닫힌다. 드로어 빈 영역 탭(`#bookmark-drawer-body` pointerdown), 드로어 닫힘(`closeBookmarkDrawer`), `renderBookmarkTree()` 재실행 시 닫힌다. 스와이프된 행의 link/folder 영역 탭 = 이동/펼치기 대신 닫기(iOS 메일과 동일).
- **삭제를 탭하면 행부터 닫는다** — 행 액션 `deleteAction`(북마크 · 폴더 공통)이 `closeSwipedRow(null)`을 `openConfirmModal` *앞*에서 부른다. 확인은 실제 삭제만 담당해, 확인을 취소해도 행이 제자리로 돌아온다(수정 `editAction`도 탭 즉시 닫는다). e2e `test_bookmark_swipe.py::test_cancel_delete_confirm_closes_swipe`.

DOM:

```
li.bm-bookmark                       (role="treeitem", data-id)
  div.bm-bookmark-row
    button.bm-swipe-action.bm-swipe-delete   ← 우측 가장자리 「삭제」 (aria-label 「<제목> 삭제」)
    button.bm-swipe-action.bm-swipe-edit     ← 좌측 가장자리 「수정」 (aria-label 「<제목> 수정」)
    div.bm-row-content                       ← 불투명 슬라이더(z-index: 1) — translateX
      span.bm-bookmark-type-icon
      a.bm-bookmark-link                     (draggable="false")
      div.bm-item-actions                    ← 데스크톱 hover-reveal (모바일 display:none)
      .bm-drag-handle                        ← ≡ (직접 정렬일 때만)
    선택 원                                   ← 선택 모드(ADR-029)
```

폴더 행도 동일 구조다(`.bm-folder-row` > 스와이프 액션 + `.bm-row-content`).

- **모양** — 액션을 **full-bleed**(좌우 0)로 깔고, 방향 클래스로 해당 방향만 `opacity:1` 노출한다 — 평상시(닫힘) 액션이 안 보이고, 노출 시 **컬러가 화면 가장자리 끝까지** 채워진다(양방향). **콘텐츠 카드**에만 `border-radius`(스와이프/열림 시)를 줘 카드 모서리만 둥글고 액션은 가장자리에 직각으로 닿는다. 라벨은 `--swipe-reveal` 폭 고정 span을 가장자리에 핀(`flex-start`/`flex-end`)해, **full-swipe로 액션이 넓어져도 글자가 중앙으로 밀리지 않는다**. 토큰 `--swipe-reveal: 88px`이 JS `SWIPE_REVEAL_PX`(88 — 단일 버튼 폭)와 동기화돼 있다.
- **탭 판정** — 두 액션이 `position:absolute; inset:0`으로 겹쳐 깔리므로, `pointer-events`는 기본 `none`이고 노출된 방향만 `auto`다. DOM 상 뒤에 추가된 버튼이 위에 올라가 다른 방향의 탭을 가로채지 않게 한다(full-swipe의 프로그램적 `.click()`은 무관). e2e는 노출 스트립 좌표를 실제로 클릭한다(실 hit-test).
- **행 높이** — 표준 토큰 `--list-row-h`(3.5rem ≈ 63px). 세로 패딩을 `--space-1`로 줄여 토큰(min-height)이 곧 행 높이가 되고(폴더 1줄 · 북마크 2줄 동일 높이), rem 스케일이다. 북마크 전용 하드코딩(데스크톱 4rem / 모바일 콘텐츠 4.4rem ≈ 79px)은 2줄 콘텐츠(≈52px) 대비 과하게 떠 보여 이 토큰으로 바꿨다(79px → 63px, -20%). 노트 · 캘린더 같은 후속 목록 · 혼합 항목도 같은 토큰을 쓴다.
- **행 채우기** — `.bm-row-content`에 `line-height: --leading-snug` + 공유 `min-height` + `align-self: stretch` — 본문 1.8 leading 상속으로 2줄 북마크가 1줄 폴더보다 커지지 않게 하고, 콘텐츠가 행을 꽉 채워 짧은 폴더 뒤로 액션이 비치지 않게 한다.
- **중첩 행 full-bleed** — 모바일에서 **들여쓰기를 UL 패딩 → 콘텐츠 패딩으로** 준다 — `.bm-folder-children { padding-left: 0 }`(행 full-bleed) + `.bm-row-content` `padding-left: calc(var(--space-4) + var(--bm-indent))`, 깊이별 `--bm-indent`(= `--space-8 × depth`)를 아이템 빌더(`_buildBookmarkItem` · `_buildFolderItem` — `bookmark-tree.js`)가 콘텐츠에 인라인으로 설정한다. 본문 위치는 같고(루트 16px, depth1 48px…) 행은 가장자리까지 차 액션 컬러가 화면 끝에 닿는다. 데스크톱은 스와이프가 없어 UL 패딩을 쓴다.
- **행 아이콘** — 토큰 **`--bm-row-icon`(1.6rem)** — 슬롯과 SVG가 같은 토큰을 써 아이콘이 슬롯을 꽉 채우고(고정 20px SVG → 약 29px) 본문 폰트와 함께 rem 스케일한다(Dynamic Type).
- **시각 · 접근성** — 액션 버튼 최소 44×44(WCAG AA 터치 타깃). 스와이프 액션은 제목을 담은 `aria-label`의 버튼이다. 수정 `var(--accent)`, 삭제 `#c0392b`(데스크톱 `.bm-delete-btn:hover` 색상과 일관). `prefers-reduced-motion`에서는 `.bm-row-content { transition: none }`.

### 재정렬 — ≡ 핸들 (`js/app/bookmark-gestures.js`)

- **진입은 ≡ 핸들 한 곳** — 각 행 trailing에 ≡ 핸들(`_buildDragHandle`, 가로줄 3개)을 두되, **정렬이 `manual`(직접 정렬)일 때만 노출**한다 — `renderBookmarkTree`가 트리에 `bm-sortable`을 토글하고, CSS `.bm-drag-handle { display:none } .bm-sortable .bm-drag-handle { … }`. 자동 정렬에선 드롭이 다시 정렬돼 무의미하므로 핸들도 숨는다 → 핸들이 「재정렬 가능 + 현재 직접 정렬 모드」를 함께 신호한다(iOS 편집모드의 재정렬 컨트롤 ≡). 핸들에서 시작한 포인터는 **8px(`SWIPE_SLOP_PX`)을 넘으면 스와이프 분류를 건너뛰고 즉시 드래그**한다(`onHandle` 분기, 터치 · 마우스 공통). 핸들 밖에서 시작한 포인터는 스와이프 분류를 제외하면 모두 스크롤/클릭으로 양보한다(`abort`). 핸들은 `aria-hidden`(포인터 전용, 키보드 재정렬 미지원).
- **Pointer Events API** — 마우스 · 터치 단일 코드. `pointermove`/`pointerup`/`pointercancel` 리스너를 `document`에 걸어 포인터가 row 밖으로 나가도 ghost가 남지 않게 하고, `pointerId` 필터링으로 멀티터치 오작동을 막는다. 드래그가 시작되면 `setPointerCapture`. Ghost 요소(`.bm-drag-ghost`)는 `fixed` 포지션 · `pointer-events:none`이라 `elementFromPoint`가 아래 행을 맞춘다. `<a>` 태그에는 `draggable="false"`를 달아 브라우저 기본 링크 드래그 ghost를 억제한다.
- **드롭 대상** — 폴더 행이면 높이의 가운데 30-70% → into, 그 밖은 위쪽 절반 → before · 아래쪽 절반 → after(`_updateDragIndicators`). 순환 참조는 `_isDescendant()` 검사 후 드롭 거부, 이동은 `moveBookmarkItem`.
- **드롭 위치 지시자** — `_updateDragIndicators`가 대상 `<li>`에 `.drag-over-*`을 붙이고, 표시는 **보이는 콘텐츠 층**에 그린다: before/after = `.bm-row-content::after`의 **3px accent 삽입선**(대상 행 상/하단, = 드롭 갭), into = 콘텐츠에 accent 14% 틴트 + 2px outline. `.bm-row-content`에 `position: relative`(::after 기준). 행(`.bm-…-row`)의 `inset box-shadow`로 그리면 모바일의 불투명 `.bm-row-content`(z-index 1)가 덮어 가렸다. e2e `test_bookmark_dnd.py::test_drop_indicator_renders_on_content`(클래스를 직접 적용해 ::after · outline 검증 — 실제 포인터 드래그는 타이밍이 불안정하다).
- e2e `test_bookmark_swipe.py` — `test_longpress_does_not_start_drag`(롱프레스가 드래그를 시작하지 않음) · `test_handle_drag_starts_reorder`(핸들에서 즉시 드래그 진입). dnd e2e는 `moveBookmarkItem` 직접 호출이다.

### 정렬 (`js/app/bookmark-core.js` · `js/app/bookmark-menu.js`)

⋯ 더 보기 메뉴에 정렬 기준 그룹(제목 · 직접 정렬 · 추가된 날짜 · 최근에 본 날짜 · 수정한 날짜)이 있고, 그 **아래에 「오름차순/내림차순」 두 번째 라디오 그룹**이 있다(Apple Music 패턴).

- 방향은 활성 기준에 적용되고 **기준별로 방향을 따로 기억**한다. `직접 정렬(manual)`은 방향 개념이 없어 두 행을 **비활성(흐리게)** 처리한다.
- 기준과 방향은 기기마다의 보기 설정이다 — `localStorage`의 `bible-bookmark-sort` · `bible-bookmark-sort-dir`(`{mode: "asc"|"desc"}` 맵)이고 Drive로 동기화하지 않는다(ADR-011 범위 밖). 「최근에 본」 시각은 `bible-bookmark-viewed`(id → 시각)에 둔다.
- 기준별 **자연 기본값**(제목 `asc`, created/modified/viewed `desc`)을 둬, 방향을 한 번도 안 건드린 사용자는 방향 선택이 생기기 전과 같은 순서를 본다.
- **구현:** **오름차순 기준 비교자** `_bookmarkAscComparator`, `sortBookmarkNodes`가 `desc`일 때 부호를 뒤집는다(폴더-우선 클러스터링은 그대로). `getBookmarkSortDir`/`setBookmarkSortDir`(manual · 잘못된 값 거부). 메뉴는 `오름/내림` 라디오 2행 + 구분선(가로 모드에서 11행이 되지만 ADR-030 후속⁷ 스크롤로 모두 도달).
- **기준별 설명 문구(혼동 방지):** 「오름/내림」은 추상적이고 그 뜻이 기준마다 뒤집힌다(제목 오름 = 가나다, 추가된 날짜 오름 = 오래된 순). 그래서 각 방향 행에 **활성 기준에 맞는 설명을 라벨 뒤에 muted로** 단다(제목 `가나다순`/`ㅎ→ㄱ`, 날짜류 `오래된 순`/`최신·최근 순`, 최근에 본 `오래전 본 순`/`최근 본 순`). `syncDirChecks`가 메뉴를 열 때 갱신한다 — 정적 문구가 아니라 기준 따라 바뀐다. 괄호는 **CSS-only**(`::before`/`::after`)라 스크린리더는 단어만 읽고, 직접 정렬일 땐 설명이 없어 `:empty`로 괄호째 숨긴다. HIG: 선행 체크열 + 라벨 형태 유지.
- 유닛 `tests/unit/bookmark.test.js` 정렬 방향 7케이스(기본값 · per-mode 영속 · 부호 반전), UI 상태는 e2e.

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

## 채택 이유

- PWA 오프라인 원칙 유지: 서버 의존성 없이 `localStorage`로 완결
- 기존 라우팅 패턴 확장: `parsePath()` 반환 구조에 `highlightVerseSpec` 필드를 더하고, 장 본문 렌더 루프에서 per-span 하이라이트로 확장 — 기존 코드 최소 변경
- 접근성 패턴 재사용: 처음에는 `openInstallModal()` 패턴(포커스 트랩, inert 배경, Escape 닫기)을 드로어 · 모달 모두에 그대로 적용했고, 지금은 공용 오버레이 컨트롤러(ADR-032)가 같은 일을 한다

## 결과

- 서버 없이 오프라인에서 북마크 완전 동작
- 운문(시편·욥기 등)에서 헤미스티치 단위 절 선택·저장 가능
- 비연속 절 범위가 URL에 인코딩되어 공유·색인 가능 (`/ps/23/3a,5-7`)
- ≡ 핸들 드래그 앤 드롭(직접 정렬일 때)으로 마우스·터치 모두에서 순서 변경 및 폴더 이동 가능
- 기존 라우팅·렌더링·접근성 패턴 재사용으로 코드 증가 최소화
- 기기 사이 동기화는 ADR-011(Google Drive)이 맡고, e2e는 `tests/e2e/test_bookmark_*.py`가 다룬다

## 검토한 대안

### 저장소

#### A. 서버 API (사용자 계정 연동)
- 장점: 디바이스 간 동기화
- 단점: 계정 시스템, 서버 인프라 필요. PWA 오프라인 원칙과 충돌. Phase 1 범위 초과
- 기각 2026-04-25 · 재검토: 없음 — 기기 사이 동기화는 자체 계정 시스템 없이 사용자 자신의 Google Drive로 한다(ADR-011)

#### B. localStorage (채택)
- 장점: 서버 없음, 오프라인 완전 지원, 즉각 구현 가능
- 단점: 디바이스 간 동기화 불가, 브라우저 스토리지 삭제 시 소실
- 결론: Phase 1 제약(서버 없음)과 일치. 동기화는 별도 Phase에서 고려 — ADR-011

#### C. IndexedDB
- 장점: 대용량, 트랜잭션 지원
- 단점: 북마크 데이터는 수십에서 수백 건 수준이므로 과도한 복잡도
- 기각 2026-04-25 · 재검토: 북마크 수가 `localStorage` 한도에 닿을 때 — 가져오기 한도가 이미 크롬이 담는 양의 절반이다(known-issues §15)

### 절 범위 URL 인코딩

#### A. query string (`?v=1-5,10-15`)
- 단점: 기존 `?hl=` 검색 쿼리와 혼재. 공유 링크가 직관적이지 않음
- 기각 2026-04-25 · 재검토: 없음

#### B. path segment (채택): `/john/3/1-5,10-15`
- 장점: 기존 `parsePath()` 패턴과 일관성. 클린 URL. 공유·색인 친화적
- `highlightVerseSpec` 필드를 `parsePath()` 반환값에 추가하여 기존 단순 범위와 병행

#### C. hash fragment (`#v=1-5`)
- 단점: 서버에 전달되지 않음. ADR-009에서 해시 라우팅을 이미 포기한 방향과 역행
- 기각 2026-04-25 · 재검토: 없음

#### 여러 구간은 문자 집합만 본다 — `parsePath()`의 다중 구간 정규식 `^[\d,\-a-z]+$`
- 2026-04-25부터 2026-10-21까지 쓴 방식. 알파 접미사 포함 spec(`"3a,3b,5-7"`)을 받았지만, 그 갈래는 구간을 절 하나하나로 펼쳐 정렬했다. 그래서 큰 범위(`1-4294967296,5`)는 예외로 시작 화면을 멈췄고, 같은 구간을 되풀이한 주소는 탭 바가 스크롤 프레임마다 다시 펼쳤다(known-issues §15).
- 기각 2026-10-21 · 이유: 가져오기와 같은 표기 검사(`isWellFormedSpec` — ADR-040)로 바꿨다. 순서가 뒤섞인 주소도 정렬해 받는 안은 ADR-040 「검토한 대안」에 있다 · 재검토: 없음

### 절 세그먼트 식별자

#### A. 정수 기반 (`_selectedVerseNums: Set<number>`)
- 기존 구현. `parseInt("3a", 10) === 3`으로 coerce되어 "3a"와 "3b"를 구분 불가
- 기각 2026-04-25 · 재검토: 없음

#### B. vref 문자열 기반 (`_selectedVerseRefs: Set<string>`)
- `data-vref` 원문을 그대로 추적. "3a"와 "3b"를 독립적으로 선택 가능
- 기각 2026-10-21 · 이유: 번호가 같은 다른 절이 `data-vref`도 같아, 하나를 누르면 같은 값의 줄이 모두 칠해지고 출처가 그 번호를 섞었다(이사 40:19-20 이 「40:6a,6b,7,19-20」, 에스 4:17 의 추가 본문 하나에 25 절 — known-issues §5, 2026-04-25부터) · 재검토: 없음

#### C. 줄 키 기반 (`data-vkey` — `<절 인스턴스 키>/<data-vref>`) (채택)
- 2026-10-21. 선택 상태는 `readingContext.selectedVerses`(모듈 분할 — ADR-018 · 034)에 둔다. 저장 · 주소 · 출처는 계속 `data-vref`로 적는다 — 키는 화면 안의 선택에만 쓴다

#### 절 인스턴스를 저장 · 주소 문법에도 넣기(`17_12-16` 같은 하위 절 표기)
- 보류 2026-10-21 · 이유: 저장 데이터 · 공유 주소 · `routing.js` 주소 검사가 함께 바뀌는 일이라 절 선택 수리와 가른다 — 옮겨 실린 절 · 그리스어 절 · 에스델 추가 본문을 북마크하면 여전히 그 번호로 저장된다 · 재검토: 전례독서의 하위 절 인용(ADR-037 「에스델 하위 절」 · 설계서 미결39)을 다룰 때

#### 분절된 산문 절을 span 단위로 저장(`"23a,23c"`)
- 기각 2026-06-06 · 이유: 인용(`<cite>`) 위치에서 나뉜 줄은 개념상 한 절이다 — 저장할 때만 절 전체로 올리고, 선택 막대 라벨과 복사 직렬화는 per-span 단위를 유지한다 · 재검토: 없음

### 드래그 앤 드롭

#### A. HTML5 Drag and Drop API
- 단점: 터치 이벤트 미지원. 별도 터치 폴리필 필요
- 기각 2026-04-25 · 재검토: 없음

#### B. Pointer Events API (채택)
- 장점: 마우스·터치 단일 코드. `document` 레벨 리스너로 포인터 이탈 추적

#### 전용 6-dot 핸들
- 2026-04-25 첫 구현. 기각 2026-04-26 · 이유: 전용 드래그 핸들의 UX — row 전체를 드래그 영역으로 쓰고, 5px 이동 임계값(`Math.hypot`)으로 클릭과 드래그를 구분하는 것으로 대체했다(`setPointerCapture`는 임계값 초과 후에만) · 재검토: 2026-06-07에 ≡ 핸들을 직접 정렬 모드 한정으로 다시 들였다(아래)

#### 행 본문 드래그(터치 롱프레스 · 마우스 즉시 드래그)
- 2026-04-26부터 2026-06-11까지. 모바일은 처음에 롱프레스를 액션 노출에 썼다가(아래 「모바일 행 UX」), 2026-05-08부터 롱프레스(500ms — `LONG_PRESS_MS`, 햅틱 `navigator.vibrate(10)`)가 드래그 진입이었다. 2026-06-07에 ≡ 핸들을 들이면서도 이 진입을 **나란히** 남겨, 행 어디를 잡아도 재정렬이 시작됐다.
- 기각 2026-06-11 · 이유: (1) 스크롤하려고 길게 누르면 의도치 않게 드래그가 걸리고, (2) 핸들이라는 명시적 어포던스가 있는데도 본문 드래그가 공존해 「여기를 잡으면 이동」이라는 신호가 흐려졌다. 롱프레스-드래그는 상시 어포던스가 없어 「재정렬 가능」이 보이지 않았다(HIG의 두 패턴 중 발견성이 낮은 쪽). `_setupDragHandle`에서 롱프레스 타이머와 마우스 본문 즉시 드래그 분기를 지웠다 · 재검토: 없음

#### 리스너를 row에 걸기
- 기각 2026-04-26(버그 수정) · 이유: row 밖으로 포인터가 나가면 `pointermove`/`pointerup`/`pointercancel`을 놓쳐 ghost가 남았다 — `document`로 옮겼다 · 재검토: 없음

### 모바일 행 UX (2026-05-03)

#### A. 케밥(⋯) 버튼 행마다 추가
- 장점: 발견성 최고
- 단점: 시각적 노이즈 큼, 모바일/데스크톱 패턴 분리 필요
- 기각 2026-05-03 · 재검토: 없음 — 여러 항목을 다루는 일은 북마크 탭의 ⋯ 「선택」 모드(ADR-029)가 한다

#### B. 스와이프-투-리빌만 (롱프레스 없음)
- 장점: iOS 표준, 단순
- 단점: Android는 보통 롱프레스 → 다중 선택 모드. 발견성 낮음
- 2026-05-03에는 기각했지만, 2026-05-08 롱프레스를 드래그 진입으로 돌리면서 액션 노출은 가로 스와이프 전용으로 일원화됐다 — 지금 동작이다. 다중 선택은 ⋯ 「선택」 모드(ADR-029)가 맡는다

#### C. 스와이프 + 롱프레스 (2026-05-03 채택)
- iOS·Android 양 플랫폼 사용자가 자기 OS 습관대로 발견·사용. 두 제스처가 같은 결과(액션 노출)를 만들어 모델이 단순했다 — 롱프레스 500ms(`LONG_PRESS_MS = 500`), 햅틱 `navigator.vibrate(10)`
- 기각 2026-05-08 · 이유: 모바일 드래그-재정렬을 되살리려고 롱프레스를 「드래그 모드 시작」으로 돌렸다(그 롱프레스도 2026-06-11에 지웠다 — 위) · 재검토: 없음

#### 콘텐츠를 밀어 오른쪽 2버튼 패널(수정 · 삭제) 노출 — `.bm-row-actions-mobile`
- 2026-05-03. 스와이프 종료 임계값은 `-SWIPE_REVEAL_PX / 2`(70px — `SWIPE_REVEAL_PX = 140`)였다.
- 2026-05-06 행 텍스트가 좌측으로 밀려 사라져, 콘텐츠를 고정하고 패널이 우측에서 `translateX(100% → 0)`으로 슬라이드 인해 행의 우측을 **오버레이**(z-index:1)하게 바꿨다. 그때 `.bm-row-content`에 `min-height: 44px`를 줘 폴더 · 북마크 행 높이를 맞췄다(지금은 `--list-row-h`), 모바일 액션 패널은 `aria-hidden="true"`였다.
- 기각 2026-06-06 · 이유: 패널 오버레이는 긴 제목을 가렸고 한 방향에 버튼 둘이었다 — iOS Files/Mail을 벤치마크해 **양방향 edge-flush 스와이프 액션 + full-swipe**로 재구성했다. 불투명한 `.bm-row-content`(z-index:1)가 슬라이더가 되어 행 양 끝에 깔린 단일 액션(`.bm-swipe-action`)을 노출한다. `SWIPE_REVEAL_PX`는 140 → **88**(단일 버튼 폭) · 재검토: 없음

#### 스와이프 방향 — 왼쪽 = 수정, 오른쪽 = 삭제
- 2026-06-06 양방향 모델의 첫 방향. 기각 2026-06-07 · 이유: iOS 관례(Mail · 메시지 · 메모의 「왼쪽으로 밀어 삭제」)와 정반대였다 — 파괴적 액션을 trailing, 비파괴(수정)를 leading으로 바꿨다(JS `onMove` 토글 · `finish` full/partial · re-grab `baseOffset`, CSS 엣지 앵커 `justify` · 스냅 `translateX` 부호를 일괄 swap) · 재검토: 없음

#### 스와이프 판정 — 첫 5px 단판 분류 · 거리만 · 절대 오프셋 커밋
- 2026-06-10까지. 첫 5px 이동에서 `|Δx| > |Δy|` 단판 분류라, 1px 차이로 모드가 영구 확정돼 엄지 접촉 노이즈가 스크롤을 스와이프로 가로채거나(과민) 첫 5px이 살짝 수직이면 이후 수평 100px도 무시됐다(둔감). 커밋 · 스냅이 거리만 봐서 빠른 플릭이 안 먹혔다. full-swipe 커밋을 절대 오프셋(`baseOffset + Δx`)으로 판정해, 이미 열린 행(±88px)을 재그랩하면 같은 방향 약 40px에 삭제가 실행되고(과민) 반대 방향은 132px이 필요했다(둔감).
- 기각 2026-06-10 · 이유: 슬롭 5 → 8px과 각도 편향 ×1.2 · 애매한 대각은 다음 샘플로, 플릭 속도 투영, 제스처 자체 Δx로 커밋 판정으로 바꿨다(위 「모바일 행」) · 재검토: 없음

#### 좌/우 방향별 임계 차등
- 기각 2026-06-10 · 이유: 비대칭 체감의 실체는 재그랩 베이스 오프셋이었다 — 커밋을 제스처 Δx로 보면서 사라졌다 · 재검토: 없음

### 헤더 북마크

#### 헤더 아이콘에서 장 북마크 여부를 빼기(`.has-bookmark` 클래스 및 관련 CSS 삭제)
- 2026-04-26 — 헤더 장 북마크 표시가 실제와 어긋나 표시 기능을 빼고 `bookmarks` 아이콘으로 단순화했다. 상태 표시(`.has-bookmark`)는 곧 다시 쓰였고(2026-04-30 상태 미갱신 버그 수정), 지금은 데스크톱이 상태(채워짐/빈)를 보이고 모바일은 저장된 장에서 헤더 북마크를 숨긴다

#### 성서 목록 화면에도 헤더 북마크
- 기각 2026-06-05 · 이유: 장 맥락이 없어 「이 장 저장」이 의미가 없고, 북마크 전체 관리는 하단 탭 바의 북마크 탭(ADR-029)이 담당해 목록 헤더의 북마크 진입점은 중복이었다 · 재검토: 없음

#### 모바일 헤더 북마크 = 토글(저장 / 삭제)
- 2026-06-06 — 장이 북마크돼 있지 않으면 「이 장 저장」 모달, 이미 북마크된 장이면 삭제 확인 모달(`#bm-confirm-modal`)로 그 장의 북마크를 모두 지웠다(채워진 아이콘은 장 단위 토글 — 한 장에 장 전체 + 절 범위처럼 여럿이면 함께 삭제). 클릭 핸들러는 렌더 시점 상태가 아니라 `findExistingChapterBookmarks()`로 클릭 시점에 재확인했고, 확인 메시지 문안은 순수 함수 `_chapterDeleteMessage()`였다.
- 기각 2026-06-09 · 이유: 탭 바에 북마크 탭이 있으니 네비 · 관리는 탭 바로 통일하고, 헤더는 탭 바가 못 하는 맥락 동작(「지금 이 장 추가」)만 맡는다 · 재검토: 없음

#### 장 북마크 선택 삭제 picker(`#bm-chapter-delete-modal`)
- 2026-06-06 — 헤더 토글-오프의 단일 「이 장 전부 삭제」 확인을, 장 안의 북마크를 체크박스 목록(라벨 + 참조 `창세 1:1-3`)으로 골라 지우는 모달로 바꿨다. 「전체 선택」(`#bm-chapter-delete-all`)은 tri-state 토글(순수 함수 `_selectAllState(sel, total)`), 기본은 미선택, 삭제 버튼은 선택 0이면 `disabled` · 선택 시 `삭제 (N)`(순수 함수 `_deleteBtnLabel(count)`) — 목록 선택이 곧 확인이라 중첩 확인 없음(iOS 다중 선택 삭제 idiom). `openChapterDeleteModal(candidates)` / `closeChapterDeleteModal()` — 삭제색 `#c0392b` 확인 버튼 · 체크박스 `accent-color`, 기본 포커스는 안전한 「취소」, `trapFocus` + Escape + scrim 탭 닫기 + `route()`가 네비 시 dismiss(`window.closeChapterDeleteModal`). 모바일 전용이었고, 구 `confirmRemoveChapterBookmarks()` · `_chapterDeleteMessage()`를 대체했다. e2e는 토글-삭제(전체 선택) · 취소 · 선택 삭제 3종.
- 기각 2026-06-10(제거) · 이유: 2026-06-09 헤더 토글이 폐지되며 진입점을 잃었다 — 모달 DOM(index.html) · CSS · `open/closeChapterDeleteModal` · `_deleteBtnLabel` · 관련 유닛/e2e를 일괄 삭제했다. tri-state 헬퍼 `_selectAllState`는 벌크 선택 모드(ADR-029)가 계속 써 보존 · 재검토: 없음

#### 네이티브 `window.confirm()`
- 기각 2026-06-06 · 이유: 테마 · 포커스 트랩이 없다 — 공용 확인 모달(`openConfirmModal()`)로 통일했다(스와이프 행 북마크 삭제 · 폴더 삭제도 같은 모달) · 재검토: 없음

#### 모바일 판정을 폭만으로(`@media (max-width:768px)`)
- 2026-06-09 헤더 「추가」 전용을 들일 때의 쿼리 — 그때는 폰을 가로로 돌려 탭 바가 사라지면 헤더 북마크가 다시 나타났다. 같은 날 ADR-029가 판정을 포인터를 함께 보는 쿼리(`(max-width: 768px), (pointer: coarse)`)로 바꿔, 가로 폰 · 태블릿도 탭 바를 유지한다 · 재검토: ADR-029를 따른다

### 절 선택

#### 진입 롱프레스 300ms(`LONG_PRESS_MS=300` 하나)
- 기각 2026-06-13 · 이유: 읽기 중 손가락을 텍스트 위에 잠깐 얹거나 스크롤 직전 멈칫하는 0.3초가 의도치 않게 절 선택 모드로 진입했다 — 진입을 500ms로 올리고, `views.js`의 단일 상수를 두 경로로 나눴다: `ENTER_SELECT_MS=500`(진입) · `RANGE_EXTEND_MS=300`(범위 확장) · 재검토: 없음

#### 텍스트 라벨 버튼 막대
- 기각 2026-06-06 · 이유: 탭 dock(ADR-030)과 형식을 맞춰 floating glass + 아이콘 전용으로 개편했다 · 재검토: 없음

#### 팝오버
- 기각 2026-06-06 · 이유: 다중 절 선택 모델이라 영속 하단 액션 바가 맞다(iOS 26 다중 선택 컨텍스트 툴바) · 재검토: 없음

#### 한 손가락 슬라이드 범위 선택
- 한 절을 누른 채 손가락을 끌면(`pointermove` + `document.elementFromPoint`) 시작 절부터 현재 절까지 실시간으로 칠해지는 **슬라이드 드래그**(`VerseSelectDrag` 타입).
- 기각 2026-06-13 · 이유: 모바일에서 패닝하는 손가락이 페이지 스크롤과 경합해 사실상 동작하지 않았다(끌면 화면만 스크롤) — 기억된 앵커 기반으로 바꾸고 슬라이드 드래그 코드와 타입을 제거했다 · 재검토: 없음

#### pill · 원형 버튼의 squircle(`corner-shape: superellipse(2)`)
- 2026-06-06. 기각 2026-06-08 · 이유: 캡슐 양 끝 반원으로 통일했다(`--radius-pill`) · 재검토: 없음

### 정렬

#### 기준마다 방향을 고정(제목 = 가나다순, 날짜 3종 = 최신순 — `_bookmarkComparator`)
- 기각 2026-06-10 · 이유: 방향을 고를 수 없었다 — 기준별로 방향을 기억하는 두 번째 라디오 그룹을 들이고, 비교자를 오름차순 기준(`_bookmarkAscComparator`)으로 바꿔 `desc`면 부호를 뒤집는다. 자연 기본값으로, 방향을 건드리지 않은 사용자는 순서가 그대로다 · 재검토: 없음

### 드로어 · 표현

#### 툴바 텍스트 버튼
- 기각 2026-04-26 · 이유: 가독성 — 아이콘 전용 버튼으로 교체 · 재검토: 없음

#### 폴더 ▶ 토글 아이콘
- 기각 2026-04-26 · 이유: Material Icons `folder` / `folder_open` SVG로 대체하고 행 전체 클릭으로 펼친다 · 재검토: 없음

#### 폴더 기본값이 열린 상태 · 저장된 `expanded`로 복원
- 기각 2026-04-26 · 이유: 드로어를 열 때 항상 접힌 상태로 초기화하고 활성 북마크를 품은 폴더만 펼친다(필드는 하위 호환으로 유지) · 재검토: 없음

#### 행 아이콘을 고정 20px SVG로
- 기각 2026-06-07 · 이유: 1.6rem 슬롯 안에서 작아 보이고 Dynamic Type도 따르지 않았다 — `--bm-row-icon` · 재검토: 없음

#### 검색 드로어(`#search-sheet`)와 그 닫기 버튼(`#search-sheet-close`)
- 2026-04-26 북마크 드로어와 같은 패턴(WCAG 일관성)으로 닫기 버튼을 더했다. 2026-06-05 모핑 탭 바(ADR-030)가 검색을 탭 dock으로 옮기며 검색 시트가 없어졌다

### 폴더 삭제 = 그룹만 해제(내용 보존)
- 기각 2026-06-07(검토 후 현행 유지) · 이유: 「삭제는 곧 삭제」라는 보편 기대 + 진입점 간 일관성(선택-삭제 모드의 폴더 cascade — ADR-029). 확인창이 개수를 명시해 범위를 분명히 한다 · 재검토: 없음

## 미결 사항

없음. 기기 사이 동기화는 ADR-011(Google Drive 동기화)이, Playwright e2e는 `tests/e2e/test_bookmark_*.py`가 다룬다.
