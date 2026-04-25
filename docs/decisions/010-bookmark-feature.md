# ADR-010: 즐겨찾기(북마크) 기능 설계

- 일시: 2026-04-25
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
- 장점: 마우스·터치 단일 코드. `setPointerCapture`로 포인터 이탈 추적 가능
- Ghost 요소를 `fixed` 포지션으로 생성해 시각 피드백 제공
- 드롭 대상: 아이템 상단 25% → before, 하단 25% → after, 중앙 → into(폴더일 때)
- 순환 참조 방지: `_isDescendant()` 검사 후 드롭 거부

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
  expanded: boolean,
}

type BookmarkStore = Array<Bookmark | Folder>
```

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

### UI 컴포넌트

**북마크 드로어** (`#bookmark-drawer`): 오른쪽 슬라이드인 패널.
ARIA tree widget(`role="tree"`, `role="treeitem"`, `role="group"`).
툴바: "이 장 저장" / "절 선택" / "새 폴더".

**저장 모달** (`#bm-save-modal`): 제목·메모·저장 위치 입력.
저장 위치는 `_findParentFolderId()`로 현재 위치를 pre-select.

**병합 다이얼로그** (`#bm-merge-modal`): 동일 장에 북마크 이미 존재 시
"합치기 / 따로 저장 / 취소" 선택.

**절 선택 바** (`#verse-select-bar`): 하단 고정. 롱프레스 300ms 또는
드로어 "절 선택" 버튼으로 진입. 10px 이동 임계값으로 터치 드리프트 허용.

**헤더 북마크 아이콘** (`.title-bookmark-btn`): `setTitleWithChapterPicker()` 내부에서
`buildBookmarkHeaderBtn()` 호출. 해당 장에 북마크 존재 시 `.has-bookmark` 클래스
추가(SVG 채움).

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

- 디바이스 간 동기화 (Phase 2 이후 서버 연동 시 검토)
- 키보드 트리 탐색 (↑↓←→ 완성)
- Playwright e2e 테스트 (소스 데이터 접근 가능 시)
