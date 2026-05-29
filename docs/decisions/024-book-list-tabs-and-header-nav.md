# ADR-024: 성서 목록 탭 통합 + 읽기 헤더 내비게이션 재설계

- 일시: 2026-05-29
- 상태: 승인됨 — 구현 완료
- 관련 ADR: ADR-009(History API 라우팅 · 구분 URL 색인), ADR-018(`js/app/views-routing.js`·`settings-ui.js` 모듈 위치), ADR-023(설정 토글)

## 맥락

성서 목록은 네 개의 화면으로 흩어져 있었다.

- `/` — 첫 페이지. 구약·외경·신약 세 구분을 `<details>` 로 한 번에 펼쳐 보여줌
- `/old_testament` · `/deuterocanon` · `/new_testament` — 구분별 페이지. 헤더
  제목에 구분 선택 팝오버(`setTitleWithDivisionPicker`)

이 네 화면은 사실상 같은 책 목록을 보여주는데, 진입 경로와 렌더가 갈라져 있어
유지보수가 번거롭고 화면 전환도 매끄럽지 않았다. 모바일 OS 앱 관행대로 **탭
스위처 한 페이지**로 통합한다.

아울러 본문(장)·머리말·장 목록 헤더의 좌측 버튼은 브라우저 *뒤로가기*(히스토리
기반)였고, 화면 상단에 별도 브레드크럼(`목록 › 구약`)이 있었다. 목록이 한
페이지로 통합되면서 브레드크럼은 중복이고, 좌측 버튼은 "한 단계 뒤"가 아니라
**책 목록으로 가는 홈 버튼**이 더 자연스럽다.

## 결정

### 1. 단일 탭 페이지 — `renderBookList(books, activeDivision)`

`/` 와 세 구분 라우트가 모두 이 함수 하나로 렌더된다. 차이는 활성 탭뿐이다.

- 탭 = 구분. 탭 집합은 **제2경전(book-order) 설정**을 따른다(`divisionOrder()`).
  - canonical: `구약 | 외경 | 신약` (3탭)
  - vulgate: `구약 | 신약` (2탭, 외경은 구약 탭에 편입 — `effectiveDivision()`)
- 탭은 구분 라우트(`/old_testament` 등)로 가는 `<a>` 다. 따라서 딥링크·SEO 색인
  (ADR-009)·`sitemap.xml`·읽기 헤더 홈 버튼 타깃이 그대로 유효하다.
- `/` 진입 시 첫 탭(구약)을 활성화한다. vulgate 모드의 `/deuterocanon` 은
  기존대로 `/old_testament` 로 리다이렉트.
- 탭 스트립은 `display:flex` + 각 탭 `flex:1 1 0` 로 **가로 폭을 꽉 채운다**.
  활성 탭은 accent 배경. (`.division-tabs` / `.division-tab.active`)
- 구약 탭은 기존 소분류(오경·역사서·시서와 지혜서·예언서)를 유지한다.

`renderDivisionList` · `setTitleWithDivisionPicker` · 헤더 브레드크럼
(`setBreadcrumb` / `buildDivisionBreadcrumb`)은 제거했다. 새 순수 빌더
`buildDivisionTabs(activeDivision)` 가 `DIVISION_TABS` 마커 블록으로 유닛 테스트된다.

### 2. 읽기 헤더 홈 버튼 — `buildHomeBtn(target, ariaLabel)`

장·머리말·장 목록 헤더 좌측 버튼을 *뒤로가기* 대신 **홈 버튼**으로 교체한다.
`history.back()` 이 아니라 항상 `navigate(target)` 한다. 타깃은 **그 책이 속한
구분 탭**(`/${effectiveDivision(book)}`) — 방금 보던 책의 형제 책 목록이 바로
보여 맥락이 유지된다. 검색 결과 헤더의 홈 버튼만 첫 페이지(`/`)로 간다.

### 3. 상단 브레드크럼 제거

`<nav id="breadcrumb">` 와 모든 `setBreadcrumb(...)` 호출, 관련 CSS
(`#breadcrumb`, `.bc-division-*`)를 제거. 상단 행(`#breadcrumb-row`)은 이제
검색바 + 설정만 담는다.

### 4. 설정(⚙) 버튼 — 반응형 배치

`#breadcrumb-row` 는 스크롤 시(헤더 compact) 접혀 사라진다. 데스크탑과 모바일의
요구가 갈려 다음과 같이 분기한다.

- **데스크탑(≥769px)**: 설정은 기존대로 상단 행(`#settings-anchor`)에서 검색바와
  나란히 — 스크롤하면 검색바와 함께 접히는 현재 동작 유지.
- **모바일(≤768px)**: 상단 행은 통째로 숨긴다(검색은 FAB, 설정은 이동). 설정은
  **항상 보이는 제목 헤더(`#page-title`)**로 옮겨 읽는 중에도 접근 가능. 제목 행은
  매 라우트마다 다시 그려지므로, 각 뷰가 `buildSettingsTrigger()` 로 새 트리거를
  심는다. 단일 팝오버를 여러 트리거가 공유한다(`wireTrigger`).

CSS 미디어 쿼리로 둘 중 하나만 노출(`.title-settings-btn` ↔ `#settings-anchor`).

## 대안

- **탭을 URL 변경 없이 클라이언트 전환만**: 구분 딥링크·SEO·읽기 헤더 홈 타깃이
  깨진다. 기각.
- **홈 버튼을 항상 `/`(첫 탭)로**: 사용자가 신약 책을 읽다 나오면 구약 탭으로
  떨어진다. 책의 구분 탭으로 보내는 편이 맥락 유지에 낫다(사용자 선택).
- **설정을 모든 해상도에서 제목 헤더로**: 데스크탑은 상단 행에 여유가 있고 기존
  스크롤 접힘 동작을 유지하고 싶다는 요구로 기각.

## 영향

- 변경: `js/app/views-routing.js`(탭 렌더·홈 버튼·브레드크럼 제거),
  `js/app/bookmark.js`(`buildHomeBtn`), `js/app/settings-ui.js`(다중 트리거 팝오버
  + `buildSettingsTrigger`), `js/app/search.js`(브레드크럼 제거·홈 버튼),
  `index.html`(브레드크럼 노드 제거), `css/style.css`, `js/types.d.ts`.
- 유닛 테스트: `BREADCRUMB` 블록 → `DIVISION_TABS` 블록으로 교체,
  `setTitleWithDivisionPicker` 테스트 제거, 장 picker 홈 버튼 검증으로 갱신.
- 데이터·서비스워커·라우트 경로 자체는 불변 — 기존 구분 URL 그대로.
