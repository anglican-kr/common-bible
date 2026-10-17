---
date: 2026-10-17
branch: fix/typecheck-batch-1
title: "fix: 타입 검사 밖이던 앱 모듈 16개를 검사 안으로 — 지시문 순서와 드러난 44건 (known-issues §7 묶음 ①)"
---

# fix: 타입 검사 밖이던 앱 모듈 16개를 검사 안으로 — 지시문 순서와 드러난 44건 (known-issues §7 묶음 ①)

## 요약

`known-issues.md` §7 — 첫 줄이 `"use strict";` 이고 둘째 줄이 `// @ts-check` 인 앱 모듈 22개는 tsc 가 지시문을 읽지 못해 검사 밖이었다(`tsconfig.json` 은 `checkJs: false` — 파일별 opt-in). 세 묶음으로 나눠 편입하는 첫 PR 이다(순서는 아래 「확정·근거」). 묶음 ① 16개 — `js/app.js` · `routing` · `citations` · `verse-spec` · `bookmark-verse-select` · `settings-ui` · `bookmark-core` · `audio-player` · `bookmark-select` · `bookmark-menu`, 그리고 오류가 없던 `bookmark-gestures` · `data-fetch` · `install` · `overlay` · `parallels` · `reading-context` — 의 두 줄을 맞바꾸고, 드러난 44건을 실제 타입으로 고쳤다. **실행 결함은 없었다** — 틀린 것은 모두 선언이었다. 화면 · 동작은 바뀌지 않는다.

### ① 드러난 44건 — 선언이 틀리거나 빠졌다

- **데이터와 어긋난 타입 둘** — `BookEntry.division` 에 데이터의 `"liturgical"`(전례시편 `lps` · 송가 `cant` — ADR-039)이 없었다(`bookmark-verse-select.js` 의 기도서 출처 판정이 「겹치는 값이 없는 비교」로 걸렸다). `BibleVerse.chapter_ref` 는 `string` 이라 적혔지만 파이프라인(`data/src/parser.py` — `Optional[int]`)과 데이터(11곳)는 정수다 — 옮겨 실린 절을 찾는 비교(`citations.js _findRelocated` 의 `=== ch`)는 숫자끼리라 맞게 돌았다. `verse-spec.js verseInstanceKey` 의 매개변수 타입도 함께 고쳤다.
- **`parsePath()` 의 반환을 판별 유니온 `Route` 로** — 전역 선언은 `any` 였고 추론된 반환은 `view: string` 이라, 캘린더 · 전례독서 렌더러에 넘기는 곳(2건)과 검색 갈래의 `filterBooks`(1건)가 걸렸다. `js/types.d.ts` 에 `Route`(뷰마다 하나) · `CalendarRoute` · `LectionaryRoute` 를 두고, calendar.js · lectionary.js 의 같은 typedef 는 그것을 가져온다. `route()` 는 `view` 만 구조 분해하고 갈래마다 `parsed` 에서 읽는다(구조 분해한 `view` 를 비교해도 `parsed` 가 좁혀진다 — TS 5.9, 스크래치에서 확인). 같은 반환을 받는 tabbar.js 홈 탭은 `"bookId" in p` 로 좁힌다 — 검사 안에 있던 파일인데 `parsePath` 가 `any` 라 보이지 않던 곳이다.
- **선언 누락** — `AppStorage` 의 `loadCiteShow` · `saveCiteShow`, Window 의 `serializeVerseRange` · `verseInstanceKeys` · `exitBookmarkSelectMode` · `syncSearchFields` · `renderBookmarkReadView`. 다섯 모두 정의는 있다(대입하는 모듈을 `grep` 으로 확인). routing.js 가 문자열로 찾는 `DIVISION_LABELS`(views.js — 묶음 ②)에는 `Record<string, string>` 타입 한 줄.
- **매개변수 · 변수 타입** — 서비스 워커 갱신(`ServiceWorker` · `ServiceWorkerRegistration`), 오디오(`HTMLAudioElement | null`), 스크롤 추적, 정렬 방향(`"asc" | "desc"`), 인용 칩 묶음 배열 등.
- **JSDoc 두 꼴** — citations.js `wrapNoteAnchorsInArticle` 의 JSDoc 이 `const VARIANT_MARKER` 를 사이에 두고 함수에서 떨어져 매개변수 타입이 붙지 않았다(const 를 JSDoc 위로 옮겼다). settings-ui.js 의 `@param {T} [opts.getCaption] — …` 는 TS 가 「Invalid character」(TS1127)로 읽는다 — 대괄호 이름 바로 뒤의 줄표만 그렇다(괄호 없는 이름 · 한글 설명은 괜찮다 — 스크래치에서 갈라 확인).

### ② 지시문이 아예 없던 둘

`js/gtag-init.js` · `js/pre-fetch.js` 에는 `// @ts-check` 줄 자체가 없었다(architecture §6 이 「예외 2개」로 적어 둔 것). 넣으면 오류 0건 — 클래식 스크립트인 pre-fetch.js 도 같다.

### ③ 창 객체 꾸러미의 반환 타입

`appStorage` · `appSettings` · `appCitations` · `appParallels` · `appOverlay` 의 IIFE 에 `@returns {AppX}` 를 달았다 — helpers.js(`AppHelpers`, #350 리뷰)와 같은 방법. `AppStorage` 의 두 멤버 누락이 바로 이 꼴이었다 — 받는 쪽(app.js · settings-ui.js)이 검사 밖이라 보이지 않았다. 이제 인터페이스에 없는 멤버는 정의한 자리에서 걸린다.

## 확정·근거

- **작업 지시(2026-10-17, 사용자)** — 「1, 2, 3, 덤 모두 처리하자」(§7 타입 검사 · §6 전례 모듈 지연 로드 · §5 북마크 복사 · 본문 영역 이름). 새 세션에서 이전 작업 요약과 PR 계획을 보고하고 두 가지를 물었고, 「시작하자」로 두 권장안을 승인했다.
  - **순서 — §5(북마크 복사)를 맨 뒤로**: 타입 묶음 ① → §6 지연 로드 + 덤 → 묶음 ② → 묶음 ③ → §5. §5 의 수정이 `views.js`(절 선택 강조 — `data-vref` 번호로 묶는다; 다니엘 3장은 24~33절이 그리스어 · 히브리 본문에 같은 번호로 둘씩 있다) · `bookmark-modals.js`(저장)까지 닿는데, 두 파일이 묶음 ② · ③ 이라 지시문 순서(§5 가 세 번째)대로면 그 수정이 검사 밖에서 이뤄진다.
  - **검사 밖 파일 셋** — gtag-init · pre-fetch 는 이 PR 에, `sw.js` 는 known-issues §7 에 새 항목으로 남겨 따로 처리.
- **판단 — 꾸러미 반환 타입(③)은 같은 PR 에.** 지시문의 묶음 계획에 적힌 방법이고, 이 PR 이 찾은 `AppStorage` 누락이 그 방법이 막는 꼴이다. 다섯 모두 지금 인터페이스와 꼭 맞아 오류 0건이다.
- **판단 — `Route` 는 types.d.ts 에.** parsePath 의 반환을 받는 곳이 routing.js 밖에도 다섯(audio-player · search · tabbar · calendar · lectionary)이라 한 곳에 둔다. 묶음 ② 의 search.js 는 `parsePath` 가 `any` 가 아니게 되어 2건이 늘었다(`window.parsePath?.() || {}` 꼴 — 그 PR 에서 고친다).
- **실측 — 남은 6개 155건**(이 브랜치 위, 2026-10-17): bookmark-modals 50 · views 44 · search 24 · bookmark-read 15 · bookmark-tree 11 · bookmark 11. main 에서 22개를 함께 뒤집어 잰 값(201건)과 비교하면 views −3 · bookmark-read −1(이 PR 이 더한 선언의 몫) · search +2(위). 묶음 ②(views · search) 68건 · ③(bookmark 넷) 87건 — 그 묶음만 뒤집어 잰 값.
- **실측 — `sw.js` 40건**(스크래치에서 WebWorker lib · `include: ["sw.js"]` 설정으로) — 이벤트가 `Event` 로 잡히는 것 23 · `self` 가 `WorkerGlobalScope` 로 잡히는 것 6 · 매개변수 11.
- **실측 — 지시문 위치**(스크래치 파일 셋): 앞에 주석만 있으면 검사된다, 문(`"use strict";`)이 먼저 오면 오류 없이 빠진다 → ADR-012 「파일 헤더」 · pitfalls §27.

## 검증

- **기준선**(main `b08c16e`) — 유닛 1244(1243 통과 · 1 skip — 미결13 대기 픽스처), `npm run typecheck` 0.
- **검사 안에 들어왔다** — 18개 파일(묶음 ① 16 + gtag-init · pre-fetch)마다 타입 오류를 일부러 하나 넣어 `npm run typecheck` 가 그 파일에서 잡는 것을 확인했다(18/18). 꾸러미 다섯은 반환 객체에 남는 멤버를 넣으면 다섯 다 TS2353 으로 잡는다.
- `npm run typecheck` — 0.
- **유닛** `node --test tests/unit/*.test.js` — 1244건, 1243 통과 · 1 skip. 타입 표기와 선언이 대부분이고 실행 코드는 `route()` 의 구조 분해 위치 · tabbar.js 의 `bookId` 꺼내기 두 곳만 바뀌어(값은 같다) 새 테스트는 없다. **실데이터** `node --test tests/unit/*.data.test.js` — 165건, 164 통과 · 1 skip.
- **로드 스모크**(playwright — 16개 경로 × 데스크톱 1280 · 모바일 390: 성서 목록 · 구분 `/new_testament` · 장 `/john/3` · 장 목록 `/john` · 머리말 `/sir/prologue` · 검색 · 설정 · 북마크 · 모아 읽기 `/read` · 캘린더 셋 · 전례독서 넷) — 32번 모두 `pageerror` · 콘솔 오류 0, `#app` 이 그려지고 제목이 맞았다.
- **e2e** 전체 `pytest tests/e2e/` — 318건 중 **317 통과 · 1 실패**(29파일, 한 번에 8분 8초 — `python3 scripts/serve.py 8080` 위에서). 실패한 `test_drive_sync.py::test_sign_out_clears_sync`(로그아웃 뒤 북마크가 올라감)는 이 변경과 무관한 기존 경합이다 — 로그아웃 때 진행 중이던 동기화가 대기 뒤 상태를 다시 보지 않고 `Bearer null` 로 업로드하고, 가짜 Drive 는 토큰을 검사하지 않는다(실제 Drive 는 401 — 자료는 올라가지 않는다). 그 테스트만 5회 · 그 파일 13건을 3회 다시 돌려 모두 통과했다. 원인과 고치는 법은 known-issues §11.

## 갱신한 문서

- `docs/known-issues.md` §7 — 남은 6개 · 155건 · 다음 묶음, `sw.js` 새 항목. §11 신설 — 로그아웃 직후 진행 중이던 동기화의 업로드(e2e 가끔 실패의 원인).
- `docs/status.md` — 타입 검사 줄을 사실대로(남은 6개 · `sw.js`).
- `docs/architecture.md` §6 — 적용 파일(pre-fetch · gtag-init 편입 — 「예외 2개」 삭제) · 지시문 위치 · 남은 구멍, §4 손댄 모듈의 줄 수.
- `docs/decisions/012-typescript-incremental-adoption.md` — 상태 줄 · 「파일 헤더」(지시문은 어떤 문보다 앞 · 일부러 넣은 오류로 확인 · 꾸러미 반환 타입).
- `docs/coding-pitfalls.md` §27 신설 — 지시문이 문 뒤에 있으면 검사가 조용히 빠진다(사례 · 규칙).
- `docs/index.md` — 유닛 테스트 · 타입 행에 ADR-012 「파일 헤더」 · pitfalls §27, 「반복된 실수 패턴 27절」.
