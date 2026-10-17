---
pr: 353
date: 2026-10-17
branch: fix/typecheck-batch-1
title: "fix: 타입 검사 밖이던 앱 모듈 16개를 검사 안으로(드러난 44건) · 검사를 기본으로 켜고 CI 에서 (known-issues §7 묶음 ①)"
---

# fix: 타입 검사 밖이던 앱 모듈 16개를 검사 안으로(드러난 44건) · 검사를 기본으로 켜고 CI 에서 (known-issues §7 묶음 ①)

## 요약

`known-issues.md` §7 — 첫 줄이 `"use strict";` 이고 둘째 줄이 `// @ts-check` 인 앱 모듈 22개는 tsc 가 지시문을 읽지 못해 검사 밖이었다(당시 `tsconfig.json` 은 `checkJs: false` — 파일별로 켜는 방식). 세 묶음으로 나눠 편입하는 첫 PR 이다(순서는 아래 「확정·근거」). 묶음 ① 16개 — `js/app.js` · `routing` · `citations` · `verse-spec` · `bookmark-verse-select` · `settings-ui` · `bookmark-core` · `audio-player` · `bookmark-select` · `bookmark-menu`, 그리고 오류가 없던 `bookmark-gestures` · `data-fetch` · `install` · `overlay` · `parallels` · `reading-context` — 의 두 줄을 맞바꾸고, 드러난 44건을 실제 타입으로 고쳤다. 44건은 모두 선언이 틀리거나 빠진 것이었다(그 자체로 실행 결함은 아니었다).

머지 전 리뷰(`/code-review`)를 반영해 두 가지가 더해졌다(아래 「리뷰 반영」) — **검사를 기본으로 켜고 CI 에서 돌린다**(④), 그리고 **손댄 코드에서 main 부터 있던 실행 결함 다섯을 고쳤다**(⑤). 그 다섯 말고는 화면 · 동작이 바뀌지 않는다.

### ① 드러난 44건 — 선언이 틀리거나 빠졌다

- **데이터와 어긋난 타입 둘** — `BookEntry.division` 에 데이터의 `"liturgical"`(전례시편 `lps` · 송가 `cant` — ADR-039)이 없었다(`bookmark-verse-select.js` 의 기도서 출처 판정이 「겹치는 값이 없는 비교」로 걸렸다). 리뷰가 그 값으로 경로를 만드는 곳의 결함을 찾았다(⑤ 의 1). `BibleVerse.chapter_ref` 는 `string` 이라 적혔지만 파이프라인(`data/src/parser.py` — `Optional[int]`)과 데이터(11곳)는 정수다 — 옮겨 실린 절을 찾는 비교(`citations.js _findRelocated` 의 `=== ch`)는 숫자끼리라 맞게 돌았다. `verse-spec.js verseInstanceKey` 의 매개변수 타입도 함께 고쳤다.
- **`parsePath()` 의 반환을 판별 유니온 `Route` 로** — 전역 선언은 `any` 였고 추론된 반환은 `view: string` 이라, 캘린더 · 전례독서 렌더러에 넘기는 곳(2건)과 검색 갈래의 `filterBooks`(1건)가 걸렸다. `js/types.d.ts` 에 `Route`(뷰마다 하나) · `CalendarRoute` · `LectionaryRoute` 를 두고, calendar.js · lectionary.js 의 같은 typedef 는 그것을 가져온다. `route()` 는 `view` 만 구조 분해하고 갈래마다 `parsed` 에서 읽는다(구조 분해한 `view` 를 비교해도 `parsed` 가 좁혀진다 — TS 5.9, 스크래치에서 확인). 같은 반환을 받는 tabbar.js 홈 탭은 `"bookId" in p` 로 좁힌다 — 검사 안에 있던 파일인데 `parsePath` 가 `any` 라 보이지 않던 곳이다(리뷰 8번이 이것을 틀렸다고 했지만 확인해 보니 맞다 — 「리뷰 반영」 8).
- **선언 누락** — `AppStorage` 의 `loadCiteShow` · `saveCiteShow`, Window 의 `serializeVerseRange` · `verseInstanceKeys` · `exitBookmarkSelectMode` · `syncSearchFields` · `renderBookmarkReadView`. 다섯 모두 정의는 있다(대입하는 모듈을 `grep` 으로 확인). routing.js 가 문자열로 찾는 `DIVISION_LABELS`(views.js — 묶음 ②)에는 타입 한 줄 — 리뷰 반영 뒤 `Readonly<Partial<Record<string, string>>>`(없을 수 있는 색인 — ⑤ 의 3).
- **매개변수 · 변수 타입** — 서비스 워커 갱신(`ServiceWorker` · `ServiceWorkerRegistration`), 오디오(`HTMLAudioElement | null`), 스크롤 추적, 정렬 방향(`"asc" | "desc"`), 인용 칩 묶음 배열 등.
- **JSDoc 두 꼴** — citations.js `wrapNoteAnchorsInArticle` 의 JSDoc 이 `const VARIANT_MARKER` 를 사이에 두고 함수에서 떨어져 매개변수 타입이 붙지 않았다(const 를 JSDoc 위로 옮겼다). settings-ui.js 의 `@param {T} [opts.getCaption] — …` 는 TS 가 「Invalid character」(TS1127)로 읽는다 — 대괄호 이름 바로 뒤의 줄표만 그렇다(괄호 없는 이름 · 한글 설명은 괜찮다 — 스크래치에서 갈라 확인).

### ② 지시문이 아예 없던 둘

`js/gtag-init.js` · `js/pre-fetch.js` 에는 `// @ts-check` 줄 자체가 없었다(architecture §6 이 「예외 2개」로 적어 둔 것). 넣으면 오류 0건 — 클래식 스크립트인 pre-fetch.js 도 같다.

### ③ 창 객체 꾸러미의 반환 타입

`appStorage` · `appSettings` · `appCitations` · `appParallels` · `appOverlay` 의 IIFE 에 `@returns {AppX}` 를 달았다 — helpers.js(`AppHelpers`, #350 리뷰)와 같은 방법. `AppStorage` 의 두 멤버 누락이 바로 이 꼴이었다 — 받는 쪽(app.js · settings-ui.js)이 검사 밖이라 보이지 않았다. 이제 인터페이스에 없는 멤버는 정의한 자리에서 걸린다.

### ④ 검사를 기본으로 켜고 CI 에서 돌린다 (리뷰 반영)

파일마다 켜는 방식은 지시문이 문 뒤로 밀리면 조용히 꺼졌고, CI 는 타입 검사를 돌리지 않았다. 두 tsconfig 를 `checkJs: true` 로 바꿔 `js/` 전체를 지시문 없이 검사하고, 남은 6개(묶음 ② views · search, ③ bookmark 넷)는 첫 줄 `// @ts-nocheck` 로 **명시해** 뺐다(고치는 PR 이 그 줄을 지운다). 그 줄을 잘못 두면 파일이 검사돼 오류로 드러난다. 필수 검사 「Unit tests」 잡에 `npm run typecheck` 단계를 더했다 — 이제 타입 오류가 머지를 막는다. ADR-012 를 이 결론으로 다시 썼다.

### ⑤ 리뷰가 찾은 실행 결함 다섯 (main 부터)

1. 전례시편 · 송가(`/lps/23` · `/cant`)에서 헤더 집 단추 · 탭 바 홈이 없는 `/liturgical` 로 가 「해당 성서를 찾을 수 없습니다.」 → 성서 목록 첫 화면으로.
2. 숫자가 아닌 장(`/john/` · `/john/abc`)이 `john-NaN.json` 을 요청해 「데이터를 불러올 수 없습니다.」 → 「해당 장을 찾을 수 없습니다.」.
3. `/constructor` · `/toString` 이 구분 뷰가 되어 탭 제목이 「function Object() { [native code] } — 공동번역성서」 → 「해당 성서를 찾을 수 없습니다.」.
4. 업데이트 토스트가 둘 붙을 수 있었다(버전을 기다리는 사이 「업데이트 지금 확인」) → 하나.
5. 인용 시트가 없는 절을 찾느라 책의 모든 장을 받았다(시편이면 149번) → 앞뒤 3장에서 멈춘다.

## 확정·근거

- **작업 지시(2026-10-17, 사용자)** — 「1, 2, 3, 덤 모두 처리하자」(§7 타입 검사 · §6 전례 모듈 지연 로드 · §5 북마크 복사 · 본문 영역 이름). 새 세션에서 이전 작업 요약과 PR 계획을 보고하고 두 가지를 물었고, 「시작하자」로 두 권장안을 승인했다.
  - **순서 — §5(북마크 복사)를 맨 뒤로**: 타입 묶음 ① → §6 지연 로드 + 덤 → 묶음 ② → 묶음 ③ → §5. §5 의 수정이 `views.js`(절 선택 강조 — `data-vref` 번호로 묶는다; 다니엘 3장은 24~33절이 그리스어 · 히브리 본문에 같은 번호로 둘씩 있다) · `bookmark-modals.js`(저장)까지 닿는데, 두 파일이 묶음 ② · ③ 이라 지시문 순서(§5 가 세 번째)대로면 그 수정이 검사 밖에서 이뤄진다.
  - **검사 밖 파일 셋** — gtag-init · pre-fetch 는 이 PR 에, `sw.js` 는 known-issues §7 에 새 항목으로 남겨 따로 처리.
- **리뷰 지적 처리(2026-10-17, 사용자)** — `/code-review` 9건에 「발견된 사항도 수정해줘」. 건마다 「지금 / 고친 뒤 / 테스트」를 보고했고 「좋아. 품질을 엄격하게 유지할 수 있다면 OK」로 승인했다. 결정이 필요했던 5번(재발 방지)은 권장안 — 기본 검사(`checkJs: true`) + CI 타입 검사. 실행 결함 다섯은 작아서 PR 을 나누지 않고 이 PR 에 커밋을 나눠 넣었다.
- **판단 — 꾸러미 반환 타입(③)은 같은 PR 에.** 지시문의 묶음 계획에 적힌 방법이고, 이 PR 이 찾은 `AppStorage` 누락이 그 방법이 막는 꼴이다. 다섯 모두 지금 인터페이스와 꼭 맞아 오류 0건이다.
- **판단 — `Route` 는 types.d.ts 에.** parsePath 의 반환을 받는 곳이 routing.js 밖에도 다섯(audio-player · search · tabbar · calendar · lectionary)이라 한 곳에 둔다. 묶음 ② 의 search.js 는 `parsePath` 가 `any` 가 아니게 되어 2건이 늘었다(`window.parsePath?.() || {}` 꼴 — 그 PR 에서 고친다).
- **실측 — 남은 6개 155건**(이 브랜치 위, 2026-10-17 — 리뷰 반영 뒤 `// @ts-nocheck` 를 떼고 다시 재도 같다): bookmark-modals 50 · views 44 · search 24 · bookmark-read 15 · bookmark-tree 11 · bookmark 11. main 에서 22개를 함께 뒤집어 잰 값(201건)과 비교하면 views −3 · bookmark-read −1(이 PR 이 더한 선언의 몫) · search +2(위). 묶음 ②(views · search) 68건 · ③(bookmark 넷) 87건 — 그 묶음만 뒤집어 잰 값.
- **실측 — `sw.js` 40건**(스크래치에서 WebWorker lib · `include: ["sw.js"]` 설정으로) — 이벤트가 `Event` 로 잡히는 것 23 · `self` 가 `WorkerGlobalScope` 로 잡히는 것 6 · 매개변수 11.
- **실측 — 지시문 위치**(스크래치): `checkJs: false` 에서 앞에 주석만 있으면 검사되고, 문(`"use strict";`)이 먼저 오면 오류 없이 빠진다. `checkJs: true` 에서는 `// @ts-nocheck` 를 문 뒤에 두면 무시돼 그 파일이 검사되고(bookmark.js 11건), 지시문 없는 새 파일도 검사된다 → ADR-012 「파일 헤더」 · pitfalls §27.
- **실측 — 인용 405개 · 옮겨 실린 절 네 곳**(데이터 전수, 2026-10-17): 데이터의 인용(본문 `cite` · `parallels` 의 서로 다른 참조 405개)은 지금 코드의 해석으로 모두 절을 찾는다(옮겨 실린 절이 필요한 것은 호세 13:14 하나). `chapter_ref` 로 옮겨 실린 절은 네 곳 — 이사 40 ← 41:6-7 · 잠언 5 ← 6:22 · 호세 14 ← 13:14 · 욥기 27 ← 24:18-24(가장 먼 것, 3장). ADR-003 · ADR-022 의 여섯 곳 목록과 다르다 → known-issues §11.
- **확인 — `Object.hasOwn` 지원**(MDN 호환표 `javascript.builtins.Object.hasOwn` · `css.selectors.has`): Safari · iOS 15.4, Chrome 93, Firefox 92 — 앱이 이미 기대는 `:has()`(ADR-014 — Safari 15.4, Chrome 105, Firefox 121)보다 늦지 않다.

## 검증

- **기준선**(main `b08c16e`) — 유닛 1244(1243 통과 · 1 skip — 미결13 대기 픽스처), `npm run typecheck` 0.
- **검사 안에 들어왔다** — 18개 파일(묶음 ① 16 + gtag-init · pre-fetch)마다 타입 오류를 일부러 하나 넣어 `npm run typecheck` 가 그 파일에서 잡는 것을 확인했다(18/18). 꾸러미 다섯은 반환 객체에 남는 멤버를 넣으면 다섯 다 TS2353 으로 잡는다.
- `npm run typecheck` — 0(`checkJs: true` · 남은 6개 `// @ts-nocheck`).
- **유닛** `node --test tests/unit/*.test.js` — **1252건, 1251 통과 · 1 skip**(리뷰 반영으로 +8 — views 3 · routing 1 · citations 3 · citations.data 1). **실데이터** `node --test tests/unit/*.data.test.js` — 166건, 165 통과 · 1 skip.
- **공개 CI 흉내**(`git checkout-index` 사본 — `data/` · `node_modules` 없이): `npm ci --ignore-scripts` → `npm run typecheck` 0 → 유닛 1252건 실패 0(실데이터 테스트 167 skip).
- **새 테스트가 옛 코드에서 실패한다**(변이 검사): 집 단추 · 홈 탭을 옛 `/${effectiveDivision(book)}` 로 되돌리면 e2e 3 실패 · `bookListPath` 가 탭 밖의 책도 `/${division}` 이면 유닛 1 실패, 장의 `Number.isInteger` 를 빼면 e2e 2 실패, `Object.hasOwn` 을 그냥 색인으로 되돌리면 유닛 1 실패, 토스트의 두 번째 확인을 빼면 e2e 1 실패, `_findRelocated` 를 끝까지 훑게 되돌리면 유닛 2 실패 · 거리를 2 로 줄이면 실데이터 1 실패(욥기 24:18).
- **로드 스모크**(playwright — 20개 경로 × 데스크톱 1280 · 모바일 390: 성서 목록 · 구분 `/new_testament` · 장 `/john/3` · 장 목록 `/john` · 머리말 `/sir/prologue` · 검색 · 설정 · 북마크 · 모아 읽기 `/read` · 캘린더 셋 · 전례독서 넷, 그리고 리뷰가 닿은 `/lps/23` · `/cant` · `/john/abc` · `/constructor`) — 40번 모두 `pageerror` 0 · 앱의 콘솔 오류 0, `#app` 이 그려지고 제목이 맞았다 — `/lps/23` · `/cant` 는 본문 · 장 목록, `/john/abc` 는 「해당 장을 찾을 수 없습니다.」, `/constructor` 는 「해당 성서를 찾을 수 없습니다.」(탭 제목 「공동번역성서」). 분석 스크립트가 가끔 내는 CSP 차단 메시지(`www.google.com/g/collect`)는 이 PR 과 무관해 셈에서 뺐다. `js/app.js` 머리 주석을 고친 뒤에 돌렸다.
- **e2e** 전체 `pytest tests/e2e/` — **324건 모두 통과**(29파일, 한 번에 8분 2초 — `python3 scripts/serve.py 8080` 위에서, 리뷰 반영 코드 위; 그 뒤 바뀐 것은 `js/app.js` 머리 주석 한 줄뿐이다). 리뷰 반영 전 첫 실행은 318건 중 317 통과 · 1 실패였다 — 실패한 `test_drive_sync.py::test_sign_out_clears_sync`(로그아웃 뒤 북마크가 올라감)는 이 변경과 무관한 기존 경합이다: 로그아웃 때 진행 중이던 동기화가 대기 뒤 상태를 다시 보지 않고 `Bearer null` 로 업로드하고, 가짜 Drive 는 토큰을 검사하지 않는다(실제 Drive 는 401 — 자료는 올라가지 않는다). 그때 그 테스트만 5회 · 그 파일 13건을 3회 다시 돌려 모두 통과했다. 원인과 고치는 법은 known-issues §11, 고치는 PR 은 따로(`fix/sync-signout-inflight`).

## 갱신한 문서

- `docs/decisions/012-typescript-incremental-adoption.md` — 옛 개정 블록 둘과 머리의 「개정:」 줄을 본문에 녹여 현재 결론으로 다시 썼다: 결정(`js/` 전체 기본 검사 · 빼는 파일은 첫 줄 `// @ts-nocheck` · CI 필수) · 맥락 · 「검토한 대안」(파일별로 켜기 · 첫 줄 검사 유닛 테스트 · 로컬 훅만 · 임시 `tsconfig.app.json`) · 「파일 헤더」 · 도메인 타입 · 검증.
- `docs/known-issues.md` §7 — 남은 6개 · 155건(이제 `// @ts-nocheck` 로 명시) · 고치는 법, `sw.js` 새 항목. §11 신설 — 로그아웃 직후 진행 중이던 동기화의 업로드(e2e 가끔 실패의 원인), 「다른 장에 옮겨 실린 절」 목록이 ADR-003 · ADR-022 와 데이터에서 다르다.
- `docs/coding-pitfalls.md` §27 신설 — 타입 검사가 조용히 꺼져 있었다(사례 · 규칙 — 빼는 쪽을 명시 · 필수 CI · 타입을 넓혔으면 쓰는 곳도). §4 — URL 에서 온 값(`NaN` · 물려받은 이름) 사례와 규칙. §11 — 업데이트 토스트 사례.
- `docs/status.md` — 타입 검사 줄을 사실대로(기본 검사 · CI · 남은 6개 · `sw.js`).
- `docs/architecture.md` §6 — 대상(`js/` 전체 · `checkJs`) · 빼는 파일 · 그전 방식의 구멍 · CI, §7 — CI 가 타입 검사도, §4 손댄 모듈의 줄 수, 부록 A 의 ADR-012 행.
- `tests/README.md` — 타입 검사 행(CI 자동) · 유닛 34파일 · 1252건 · e2e 29파일 · 324건, 파일 행(views · routing · citations · citations.data · test_navigation · test_tabbar · test_update_toast), §2 타입 검사 설명(워커 설정을 「서비스 워커」로 잘못 적었던 줄 포함) · §3 e2e 실측 줄.
- `CLAUDE.md` — CI 줄(타입 검사) · 유닛 건수.
- `docs/index.md` — 유닛 테스트 · 타입 행(ADR-012 「파일 헤더」 · pitfalls §27).
- `docs/design/liturgical-engine.md` §3.2 — 파일 골격 주석(지시문은 관례 — 기본 검사).

## 리뷰 반영 (2026-10-17, 머지 전 `/code-review` 9건)

다섯 건(1 · 2 · 3 · 6 · 7)은 이 PR 이 만든 것이 아니라 main 부터 있던 실행 결함이다 — 이 PR 이 그 줄에 타입을 달면서 리뷰에 걸렸다. 모두 브라우저에서 재현한 뒤 고쳤고, 새 테스트가 옛 코드에서 실패하는 것을 확인했다(위 「검증」).

1. **구분 탭 밖의 책에서 「성서 목록으로」가 오류 화면**(`c013321`) — 헤더 집 단추 셋(장 · 장 목록 · 머리말)과 이미 홈 스택에서 누른 탭 바 홈이 `/${effectiveDivision(book)}` 로 갔다. `views.js bookListPath(book)` — 구분 탭이 지금 탭 순서에 있으면 그 탭, 없으면 `/`. 유닛 3(`views.test.js`) · e2e 3(`test_navigation.py` 2 · `test_tabbar.py` 1).
2. **숫자가 아닌 장 번호**(`c94d401`) — `Number.isInteger` 를 범위 검사에 더했다. e2e 2(안내 문구 · `NaN` 요청 없음).
3. **객체가 물려받은 이름**(`4ad7c7b` · `a7c555c`) — `parsePath` 가 `Object.hasOwn` 으로 구분 표의 자기 키만 본다. 리뷰는 「빈 패널」이라 했지만 실제로는 첫 탭(구약) 목록이 그려지고 탭 제목만 깨졌다. `DIVISION_LABELS` 와 `divisionLabels()` 전역 선언을 `Readonly<Partial<Record<string, string>>>` 로 — 검사 밖인 views.js 의 오류 수(44)가 늘지 않게 선언과 새 함수의 JSDoc 까지 맞췄다(스크래치에서 `checkJs` 를 켜고 확인). 유닛 1.
4. **ADR-012 의 옛 개정 블록**(문서 커밋) — 위 「갱신한 문서」. 옛 블록은 「모든 파일 검사됨 · 0 error」, 이 PR 의 본문은 「22개는 검사 밖」이라 한 문서 안에서 어긋났다.
5. **같은 구멍이 다시 생겨도 CI 가 모름**(`287aa48`) — 요약 ④. 리뷰의 둘째 안(첫 줄을 보는 유닛 테스트)은 지시문 위치만 지키고 타입 오류는 여전히 CI 밖이라 택하지 않았다(ADR-012 「검토한 대안」). `js/app.js` 머리 주석의 「checkJs: false + 모듈별 opt-in」도 지금 설정대로 고쳤다.
6. **업데이트 토스트 둘**(`5d7a4c5`) — `showUpdateToast` 가 버전을 기다린 뒤에도 이미 떴는지 본다(pitfalls §11 — await 뒤마다 다시 검사). e2e 1 — 가짜 대기 SW 가 버전에 답하지 않는 1.5초 동안 `checkForUpdates()` 를 불러도 토스트 · 단추 하나(세 번 되풀이 통과).
7. **인용 시트가 없는 절에 책 전체를 받음**(`25ddc72`) — `시편 75:99` 칩이 요청 150번이었다. `RELOCATION_MAX_DISTANCE = 3` 에서 멈춘다(지금은 7번 — 제 장 하나 + 앞뒤 여섯). 3 은 데이터에서 잰 값이고, 실데이터 테스트(`citations.data.test.js` — `engine-data.yml` · `sync-data.yml` 에 등록)가 옮겨 실린 절을 모두 그 안에서 찾는지 지킨다. 지금 데이터의 인용 405개는 모두 찾아져 실제로는 일어나지 않던 결함이다. 시트를 닫아도 훑기가 멈추지 않던 점은 이제 많아야 여섯 장이라 따로 다루지 않았다. 코드 주석의 「여섯 곳」 목록(1역대 9:33 · 욥 26:5 — 지금 데이터에 없다)은 지우고 그 테스트를 가리킨다. 유닛 3 · 실데이터 1.
8. **「tabbar.js 의 좁히기가 검사되지 않는다」 — 사실이 아니어서 고치지 않았다.** `W` 의 타입은 `Window & typeof globalThis & Record<string, any>` 이고, `declare global` 로 선언된 속성(`parsePath`)은 색인 서명(`any`)이 아니라 선언 타입(`() => Route`)으로 읽힌다. 확인(스크래치): `"bookId" in p ? p.bookId : null` 을 `p.bookId` 로 바꾸면 이 PR 의 판에서 TS2339(「Property 'bookId' does not exist on type 'Route'」), `W.parsePath?.()` 를 `number` 로 캐스트하면 TS2352(「Conversion of type 'Route'」). 요약 ① 의 문장은 그대로 맞다.
9. **`route()` 의 죽은 가드 셋**(`c94d401`) — `division ?? ""` · 머리말의 `if (!bookId) return;` · 장의 `!bookId || typeof chapter !== "number"`(book 을 찾은 뒤라 `bookId` 는 늘 있고 `chapter` 는 number). 두 return 은 `renderLoading()` 뒤라 걸렸다면 스켈레톤만 남았을 자리다. 장 갈래는 2번의 검사가 대신한다.

범위 밖으로 남긴 것: §11 브랜치(`fix/sync-signout-inflight` — 로그아웃 직후 업로드)가 손대는 ADR-011 에도 옛 개정 블록이 24개 있다 — 그 PR 에서 같은 규칙으로 본다. ADR-003 · ADR-022 의 옮겨 실린 절 목록은 known-issues §11(1역대 9:33 의 인쇄본 대조가 먼저).
