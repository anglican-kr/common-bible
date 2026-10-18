---
date: 2026-10-18
branch: fix/typecheck-batch-2
title: "fix: views · search를 타입 검사 안으로"
---

# fix: views · search를 타입 검사 안으로

## 요약

`known-issues.md` §7의 묶음 ② — 타입 검사에서 빠져 있던 `js/app/views.js` · `js/app/search.js`의 첫 줄 `// @ts-nocheck`를 지우고, 드러난 68건(views 44 · search 24)을 실제 타입으로 고쳤다(ADR-012). 이제 검사 밖의 앱 모듈은 bookmark 계열 넷(87건 — 묶음 ③)만 남는다. 화면 · 동작은 바뀌지 않는다 — 실행 코드가 달라진 다섯 곳도 지금 들어오는 값에서는 결과가 같다(아래 「실행 코드가 달라진 곳」, main과 화면을 맞대 본 결과는 「검증」).

같은 PR에 문서 커밋이 하나 더 있다 — known-issues §9(배포 목록에 교회력 묶음이 없던 것)를 지웠다. 사용자가 dev에서 확인했다(「확정·근거」).

### 드러난 68건

- **매개변수 타입이 없다 — 50건**(TS7006 42 · TS7031 8). 렌더 함수(`renderBookList` · `renderChapterList` · `renderChapter` · `renderPrologue` · `buildChapterNav` · `renderError` 등), 절 번호 표시(`formatVerseLabel` · `formatVerseNumber`), 절 선택 제스처(`selectRange` · `toggleVerse` · `cancelLongPress`), 검색 기록 컨트롤러의 옵션(typedef `SearchHistoryControllerOptions`를 새로 두었다).
- **문자열 색인 — 7건**(TS7053). `NT_MOBILE_NAME`(신약 짧은 이름)과 `VULGATE_DIVISION_LABELS`를 `DIVISION_LABELS`처럼 `Readonly<Partial<Record<string, string>>>`로 적었다 — 아무 책 id로 찾고, 항목은 신약에만 있다. `divisionLabels()`의 반환도 같은 타입이다.
- **이름을 찾지 못한 타입 — 2건**(TS2304). `appendVerses`의 JSDoc이 `BibleVerse` · `ChapterParallel`을 가져오지 않고 썼다. typedef 둘을 더했다.
- **경로 객체를 좁히지 않고 읽었다 — 3건**(TS2339). `currentSearchState`가 `parsePath()`의 결과에서 `query` · `page` · `filterBooks`를 바로 읽었다. 이제 검색 화면이 아니면 빈 상태를 먼저 돌려준다.
- **선언 누락 — 1건**(TS2339). 탭 바 검색 입력의 지우기가 부르는 `window.navigateSearch`가 Window에 없었다.
- **선언이 실제와 다르다 — 2건**(TS2345). `appendTextWithHighlight`의 검색어는 `string`이라 적혔지만, 장 화면은 강조할 말이 없으면 null을 넘기고 함수는 빈 값이나 null이면 강조 없이 그대로 쓴다 — 검색어를 `string | null`로 적었다(JSDoc · 전역 선언). `renderBookFilterList`의 `any[]`는 `BooksData`(읽기 전용 배열)로.
- **타입을 정할 수 없는 변수 — 2건**(TS7034 · TS7005). null로 시작해 숫자가 되는 `_prevDivisionIdx`를 `number | null`로.
- **null과 undefined가 어긋났다 — 1건**(TS2345). `appendVerses`는 옵션 `chapter`를 null 기본값으로 받아 `findParallelsStartingAt(parallels, v.number, chapter)`에 넘겼다. 받는 쪽(`parallels.js`)은 `currentChapter`가 `undefined`일 때만 장 비교를 건너뛰므로, null이 오면 모든 범위가 「다른 장」으로 걸러져 ※(평행 본문) 표시가 하나도 그려지지 않는다. 평행 본문을 넘기는 호출부는 장 화면 하나이고 늘 `data.chapter`를 함께 넘겨 아직 밟지 않았다(전례독서 · 모아 읽기는 평행 본문을 넘기지 않는다). null 기본값을 없애고 옵션 타입을 `number`로 적었다 — 다시 null을 넘기면 타입 검사가 막는다(pitfalls §27).

### 실행 코드가 달라진 곳 — 지금 들어오는 값에서는 결과가 같다

1. `appendVerses`의 `chapter` — 기본값이 null에서 `undefined`로. 호출부 셋 가운데 평행 본문을 넘기는 장 화면은 늘 장 번호를 함께 넘기고, 나머지 둘은 평행 본문이 없어 그 분기를 타지 않는다.
2. `currentSearchState` — 검색 화면이 아니면 `{ q: "", page: 1, filterBooks: [] }`를 먼저 돌려준다. 전에는 없는 필드를 읽어 같은 값으로 떨어졌다.
3. 구분 탭 이름 — `labels[div] ?? div`. 탭 순서의 구분은 모두 이름이 있어 대체값은 쓰이지 않는다(묶음 ①이 routing.js에 쓴 `DIVISION_LABELS[division] ?? division`과 같은 꼴).
4. 장 화면에서 범위 밖 절을 주소에서 지우는 검사 — 앞에 `hlVerse != null &&`를 더했다. null · undefined는 전에도 `>` 비교에서 거짓이었다.
5. 검색 기록 패널의 `dataset` 읽기 — `?? ""`. 패널을 그리는 `render`가 그 속성을 늘 단다.

### 캐스트 — 검색 기록 패널에서만

패널 클릭과 문서 `pointerdown`의 `e.target`을 `Element` · `Node`로, `closest()` · `querySelectorAll()`의 결과를 `HTMLElement`로 적었다(다섯 곳). `instanceof`로 좁히지 않은 까닭은 유닛 하네스(`tests/unit/search.test.js`)가 가짜 요소(`StubElement`)를 대상으로 이벤트를 보내기 때문이다 — `instanceof Element`로 바꾸면 그 테스트들이 갈래를 타지 않는다. 브라우저에서 클릭 · `pointerdown`의 대상은 늘 요소다. 묶음 ①의 `bookmark-menu.js`에도 같은 꼴이 있다.

## 확정·근거

- **순서(2026-10-18, 사용자)** — 「시리즈 뒤로 미룬 일부터 해야 하나? 아니면 PR3?」에 PR3을 먼저 하자고 권했다. 미룬 일에 급한 것이 없고, 그 가운데 성서 화면의 잘못된 주소 처리(known-issues §13)가 `views.js`를 고치므로 이 파일을 먼저 검사 안에 넣는 편이 안전하며, 미룬 일은 대부분 사용자 손(실기기 확인 · 문구 결정 · 디자인 검토)이 필요해 이 PR과 함께 갈 수 있다. 시리즈 순서는 2026-10-17에 승인됐다(원장 `docs/changes/2026-10-17-typecheck-batch-1.md`).
- **known-issues §9(2026-10-18, 사용자)** — 「known-issues §9 정리 dev에서 확인했고, 이상 없네」. 서버 저장소 `2b28813`(배포 목록에 `data/lectionary/`, 배포 뒤 검증에 묶음마다 한 파일)이 dev 배포 `bible-1.6.4-64f132f`에서 검증 9종을 통과했다. 절이 통째로 비어 노트만 두고 번호는 당기지 않았다(pitfalls §26).
- **실측** — 묶음 ②는 68건(views 44 · search 24 — main `64f132f` 위, 2026-10-17 실측과 같다). 이 PR 위에서 남은 넷을 다시 재도 87건(bookmark-modals 50 · bookmark-read 15 · bookmark-tree 11 · bookmark 11)이다 — 이 PR이 바꾼 선언(`appendVerses`의 옵션 · `appendTextWithHighlight` · `Window.navigateSearch`)으로 늘거나 줄지 않았다.
- **판단 — `chapter`는 넘기는 쪽에서 고쳤다.** 받는 쪽(`parallels.js`)을 `!= null`로 바꾸는 길도 있지만, 그 함수의 타입(`[currentChapter]`)은 이미 실제와 맞고 이 묶음 밖의 파일이다. 테스트는 더하지 않았다 — 지금 호출부로는 재현되지 않고, 다시 null을 넘기면 필수 CI의 타입 검사가 막는다.
- **판단 — `appendTextWithHighlight`는 선언을 넓혔다.** 넓힌 값을 받는 곳(pitfalls §27 규칙)은 그 함수 하나다 — 첫 줄 `if (!query)`가 null을 받고, 그 아래에서 `query`는 문자열로 좁혀진다. 호출부 둘(장 화면 · 검색 결과 조각)은 그대로다.

## 검증

- **기준선**(main `64f132f`) — 유닛 1289(1288 통과 · 1 skip — 미결13 대기 픽스처), 실데이터 166(165 통과 · 1 skip), `npm run typecheck` 0.
- `npm run typecheck` — 0. **두 파일이 검사 안에 들어왔다** — 스크래치 사본에서 각 파일 끝에 타입 오류를 일부러 하나 넣으면 둘 다 TS2352로 잡힌다. `// @ts-nocheck`가 남은 파일은 bookmark 넷이다.
- **유닛** — 1289(1288 통과 · 1 skip), **실데이터** — 166(165 통과 · 1 skip). 기준선과 같다(테스트를 더하지 않았다).
- **e2e** 전체 `pytest tests/e2e/` — **341건 모두 통과**(8분 53초, `python3 scripts/serve.py 8080` 위 — 코드를 마친 뒤 돌렸고, 그 뒤로는 문서만 고쳤다).
- **검색 기록 패널**(헤더 검색창의 ▾ 목록 — 캐스트를 넣은 곳) — e2e에는 이 패널의 테스트가 없다. 유닛(`search.test.js`의 `HISTORY_CONTROLLER` — 가짜 요소)과 별도로, 실제 브라우저(playwright · 데스크톱 1280)에서 main 사본(8081)과 이 브랜치(8080)에 같은 조작을 했다 — 기록 12개를 넣고 열기 · 「더 보기」 · × 삭제 · ↓ 두 번 · 바깥 누르기 · 항목 누르기 · ↓ 뒤 Enter · 「모두 지우기」. 관찰값 18개(보이는 항목 · `aria-activedescendant` · 저장된 기록 · 이동한 주소 · 패널 · 단추 상태)가 둘에서 모두 같았고 `pageerror`는 0이었다.
- **로드 스모크**(playwright — 16개 경로: 성서 목록 · 구분 · 장 · 장 목록 · 머리말 · 검색 · 설정 · 북마크 · 모아 읽기 · 캘린더 셋 · 전례독서 넷) — 모두 `pageerror` 0, `#app`이 그려지고 제목이 맞았다.
- **main과 화면 대조**(playwright) — main 사본(`64f132f`)을 8081에, 이 브랜치를 8080에 띄우고 같은 경로를 새 창으로 연 뒤 제목 · 최종 주소 · 머리(`#page-title`) · `#app` · 구분 탭 칸 · 이어읽기 칸 · 오디오 바 상태를 글자 그대로 비교했다. 49개 경로 × 데스크톱 1280 · 모바일 390 = 98번 모두 같았고 `pageerror`는 0이었다. 경로는 성서 목록 · 구분 · 장 목록 · 머리말, 장(강조 `?hl=` · 절 범위 · 범위 밖 절을 주소에서 지우는 `/gen/1/1-100` · `/gen/1/99` · 여러 구간 · 반절, 번호가 겹치거나 다른 장에서 옮겨 실린 절이 있는 다니 3 · 에스 4 · 이사 40 · 욥기 27 · 호세 14, 시편 · 전례시편 · 송가), 잘못된 주소 넷, 검색 다섯(빈 검색 · 낱말 · 책 범위 · 둘째 쪽 · 절 주소), 설정 · 북마크 · 모아 읽기 · 캘린더 · 전례독서다. ※(평행 본문) 자료가 있는 장은 데이터 전체에서 사무엘하 5장 하나뿐이라 따로 열었다 — 두 화면 크기 모두 ※ 셋이 그려지고 `#app`이 같았다.

## 갱신한 문서

- `docs/known-issues.md` §7 — 남은 4개 · 87건 · 묶음 ② 기록. §9 — 해소 노트(별도 커밋).
- `docs/status.md` — 타입 검사 줄(남은 4개 · 묶음 ② 편입).
- `docs/architecture.md` §6 — 남은 4개 · 87건. §4 — 모듈 표의 줄 수(`views.js` 약 1,840 · `search.js` 약 1,595).
- `docs/decisions/012-typescript-incremental-adoption.md` — 상태 줄 · 「결정」 · 「결과」의 남은 수(6 → 4), 「파일 헤더」의 예시를 묶음 ③으로.
- `docs/coding-pitfalls.md` §27 — 묶음 ② 사례(null · undefined 어긋남)와 규칙 한 줄(선택 매개변수는 `undefined`만 「없음」으로 받는다).
- `tests/README.md` · `CLAUDE.md` — 고치지 않았다(유닛 건수가 그대로다).
