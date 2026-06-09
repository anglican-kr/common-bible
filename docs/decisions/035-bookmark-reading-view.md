# ADR-035: 북마크 모아 읽기(reading view)

- 일시: 2026-06-09
- 상태: 승인됨 — 구현 중
- 관련: ADR-010(북마크 기능), ADR-011(북마크 동기화), ADR-029(모바일 탭 바), ADR-022(인용·주석 렌더링), ADR-034(뷰·라우팅 분할), ADR-013(유닛 테스트 하네스)

## 결정

저장된 북마크의 **본문 전체를 하나의 연속 읽기 화면**으로 모아 보여주는 뷰를 추가한다.

- 진입점: 북마크 탭 뷰(`renderBookmarksView`) 헤더의 `⋯`(더 보기) 버튼 **왼편**에 `읽기` 아이콘 버튼.
- 라우트: `/bookmarks/read` (`view: "bookmark-read"`). 뒤로 가기로 `/bookmarks` 복귀.
- 본문 순서: **북마크 목록에 보이는 순서 그대로**(현재 정렬 모드 적용), **폴더 이름은 섹션 소제목**으로 렌더.
- 이어 붙이기: 목록에서 **바로 인접한** 두 북마크가 같은 책의 **연속된 절/장**이면 끊김 없이 이어 붙이고 **하나의 합쳐진 참조 제목**(예: `창세 1:1–2:4a`)으로 묶는다. 그 외에는 각자 제목으로 구분한다.
- 본문 렌더는 `renderChapter`에서 추출한 `appendVerses(article, verses, opts)`로 **북마크된 절만 골라** 그린다(절 부분집합 렌더).

## 맥락 — 왜 필요한가

ADR-010 이후 북마크는 "어제 읽던 곳을 빠르게 찾는" 단건 점프 용도였다. 그런데 실사용에서 사용자는 **한 전례(예: 성령강림대축일 가해)의 제1독서·제2독서·복음서·시편을 폴더로 묶어** 둔다(스크린샷). 이때 각 독서를 한 건씩 눌러 들어갔다 나오는 동선은 "한 자리에서 차례로 봉독"이라는 실제 사용과 어긋난다.

특히 한 독서가 **장 경계를 넘는 연속 본문**(창세 1장 전체 + 창세 2:1-4a)일 때, 두 북마크로 나뉘어 저장되더라도 읽을 때는 **창세 1:1에서 2:4a까지 끊김 없이** 이어져야 자연스럽다.

> **로드맵 메모:** 이 "절 부분집합 + 연속 병합 렌더"는 Phase 2~4(기도서·교회력·성무일과)의 **감사성찬례 전례독서 페이지 자동 생성**의 기반 기술이다. 전례독서는 본질적으로 "여러 성구 범위를 정해진 순서로 모아 한 페이지에 봉독용으로 배치"하는 것이므로, 북마크라는 사용자 데이터 대신 교회력 계산 결과를 입력으로 바꾸면 같은 렌더 경로를 재사용할 수 있다. 그래서 렌더러를 북마크에 종속시키지 않고 `appendVerses`(절 배열 → DOM)로 분리한다.

## 검토한 대안

### 진입점

#### A. 헤더 `읽기` 버튼 (채택)
- 사용자 요청과 일치. `⋯` 메뉴 왼편의 1급 액션으로 발견성이 높다.
- 북마크가 0건이면 `disabled`(읽을 본문이 없음).

#### B. `⋯` 메뉴 안의 항목
- 묻혀서 발견성이 낮고, 봉독은 빈도 높은 1급 동작이라 부적합.

### 본문 순서

#### A. 목록 순서 + 폴더 소제목 (채택)
- 전례 독서 흐름(독서 순서)을 그대로 보존. 폴더 = 전례 단위라 소제목으로 자연스럽게 매핑.
- 현재 정렬 모드(`getBookmarkSort`)를 그대로 따른다 — 목록에서 본 순서 = 읽기 순서(WYSIWYG).

#### B. 정경 순서 자동 정렬
- 통독에는 맞지만 전례 독서(같은 책이 제1독서·복음서로 흩어짐)의 의도된 순서를 깨뜨린다.

### 이어 붙이기 범위

#### A. 인접 + 연속일 때만 병합 (채택)
- "바로 옆에 있고(목록 인접) + 텍스트가 이어짐(같은 책의 연속 절/장)"인 경우에만 한 블록으로.
- 인접 판정: 같은 `bookId` 이고
  - `다음.시작장 == 이전.끝장` 이고 `다음.시작절 == 이전.끝절 + 1`, 또는
  - `다음.시작장 == 이전.끝장 + 1` 이고 `다음.시작절 == 1` 이며 `이전`이 그 장의 마지막 절까지 포함.
- 폴더 경계(소제목)는 런을 끊는다 — 서로 다른 전례 단위는 병합하지 않는다.

#### B. 같은 책이면 무조건 병합
- 목록상 떨어져 있어도 모아 버려 사용자가 의도한 순서·구획을 뭉갠다.

### 본문 렌더 경로

#### A. `renderChapter` 루프 추출 → `appendVerses` 공유 (채택)
- 시(운문)·산문·인용 칩·절 번호·단락/연 구분 등 복잡한 절 렌더 로직(약 180줄)을 **단일 출처**로 유지.
- `renderChapter`는 `appendVerses(article, data.verses, {…})` 한 줄로 위임 — 동작 동일(683 유닛 전부 통과).
- 주석 앵커(`wrapNoteAnchorsInArticle`)는 **정수 절번호로 매칭**하므로 장이 섞이면 충돌한다 → 읽기 뷰에서도 **한 장 = 한 `<article>`** 로 스코프를 분리하고 각 article에 대해 호출.

#### B. 읽기 뷰에 절 렌더 로직 복제
- 180줄 중복 → 운문/인용 규칙이 갈라져 유지보수 붕괴.

## 변경 내용

### `js/app/views.js`
- `appendVerses(article, verses, opts)` 신규(=`renderChapter` 절 루프 추출). `opts`: `hlQuery/hlVerse/hlVerseEnd/hlSegments`(하이라이트), `parallels/chapter`(ADR-027 병행구절 앵커). 첫 절은 선행 break 없음(블록 시작). cite 표시 위치(`_computeCiteShowPositions`)는 **넘겨받은 verses 기준**으로 계산해 부분집합에서도 일관.
- `renderChapter`는 위 함수에 위임. ESM `export`에 `appendVerses` 추가.

### `js/app/bookmark-read.js` (신규 모듈)
- 순수 로직(유닛 대상, `// ── BEGIN/END ──` 블록):
  - `_bmRange(bm, maxVerse)` — 북마크 → `{startCh,startV,endCh,endV,endDisplay,coversChapterEnd}`.
  - `_isContinuous(prev, cur)` — 인접 연속 판정(위 규칙).
  - `_combinedRef(book, group)` — 합쳐진 참조 문자열(`창세 1:1–2:4a`, 단일 전장은 `창세 1장`).
  - `_specCoversVerse(spec, n)` — 절이 spec에 포함되는지(부분 `4a`는 절 4 전체로 승격해 읽기 — ADR-010 산문 통합과 동일 정신).
  - `buildReadingSequence(nodes)` — 트리 → `{type:'folder',name,depth}` / `{type:'bookmark',bm,depth}` 평탄화(`sortBookmarkNodes` 적용).
- UI: `renderBookmarkReadView()` — 헤더(뒤로 버튼 + 제목 "북마크 읽기"), 필요한 장 JSON 로드(중복 제거 캐시), 폴더 소제목 + 병합 그룹별 제목 + 장별 `<article>`(`appendVerses` → `wrapNoteAnchorsInArticle`) 렌더. 빈 상태 placeholder.
- `window.renderBookmarkReadView` 등록(라우터가 facade로 호출).

### `js/app/routing.js`
- `parsePath`: `if (pathname === "bookmarks/read") return { view: "bookmark-read" }`.
- `route()`: `view === "bookmark-read"` 분기 — `loadBooks()` 후 `await window.renderBookmarkReadView()`, `updatePageMeta({title:"북마크 읽기"})`, `isStale` 가드.

### `js/app/bookmark.js`
- `buildBmViewActions`: `⋯` 왼편에 `읽기` 아이콘 버튼 추가(`navigate("/bookmarks/read")`). 북마크 0건이면 `disabled`(메뉴 열 때 `refreshSelectEnabled`와 함께 상태 동기화는 불필요 — 렌더 시 1회 판정, 빈 상태에서는 애초에 목록이 비어 진입 의미 없음).

### `css/style.css`
- 읽기 뷰 스타일: `.bookmark-read`(컨테이너), `.reading-folder`(섹션 소제목), `.reading-heading`(라벨 + 참조), `.reading-passage`(장별 article 간 간격). 기존 `.chapter-text` 인라인 절 스타일 재사용.

### 테스트
- `tests/unit/bookmark-read.test.js` — 순수 로직(`_isContinuous`·`_combinedRef`·`_specCoversVerse`·`buildReadingSequence`) vm 추출 테스트.
- e2e: 읽기 진입·폴더 소제목·연속 병합(창세 1+2)·비연속 분리는 로컬 수동(데이터 서브모듈 필요).

## 공유 가능성

이 화면은 `localStorage` 북마크에서 **클라이언트에서 생성**된다. `/bookmarks/read` URL을 복사해 보내도 받는 사람 기기의 북마크(또는 빈 목록)가 렌더되므로 **사실상 공유 불가**다(의도된 성질 — 단건 북마크는 ADR-010대로 `/john/3/1-5` 형태의 본문 deep-link로 따로 공유). 정규 URL/sitemap에 넣지 않는다.

## 미결 사항

- 데스크톱 진입점: 현재 `읽기` 버튼은 모바일 북마크 탭 뷰 헤더에 둔다(`/bookmarks`가 데스크톱에선 드로어로 폴백 — ADR-029). 데스크톱 드로어 툴바 진입점은 후속.
- 비연속 절 범위(예: `마태 9:9-13,18-26`) 사이의 생략 표시(…)는 현재 단락 구분만 — 생략 마커는 후속 검토.
- 봉독 모드(글자 크기 확대·스크롤 위치 등) 및 전례독서 자동 생성(교회력 입력)으로의 확장은 Phase 2~4.
