---
pr: 351
date: 2026-10-17
branch: fix/known-issues-10-part1
title: "fix: 계산 범위의 정본을 엔진으로 — 범위 밖 resolveDate 는 null · shift 실패는 throw · 날짜 이동 줄 하나 · 인용 시트 꺾쇠도 headerIcon (known-issues §10 · §5)"
---

# fix: 계산 범위의 정본을 엔진으로 — 범위 밖 resolveDate 는 null · shift 실패는 throw · 날짜 이동 줄 하나 · 인용 시트 꺾쇠도 headerIcon (known-issues §10 · §5)

## 요약

#350 리뷰가 넘긴 `known-issues.md` §10 가운데 작은 셋과, 같은 뿌리인 §5 의 엔진 항목 하나를 고쳤다. 남은 §10 의 라우터 수준 포커스 복원(구분 탭 · 검색 페이지 · 캘린더 · 전례독서)과 §5 의 「본문 바로가기」는 다음 PR 이다(아래 「확정·근거」 — 사용자 결정).

### ① 계산 범위(1583~9999)의 정본을 엔진으로 · 범위 밖에서 엔진이 멈추던 것

- **엔진** — `LITURGICAL_CORE` 의 날짜 유틸 옆에 `MIN_YEAR` · `MAX_YEAR` · `isComputableYear(y)` · `isComputableDate(s)` 를 두고 내보낸다. 1583 은 그레고리력이 시작된 1582년의 이듬해(computus 가 그레고리력 산식), 9999 는 `parseDate` 가 받는 네 자리 연도다.
- **`resolveDate`** 는 범위 밖 날짜에 null 을 낸다 — 이동 패스(`transfersOf`)를 계산하기 전에 돌려보낸다. 그전엔 0100년대 날짜를 풀면 `parseDate` 가 0~99년을 거부해(JS `Date` 가 1900년대로 바꾼다) 내부 덧셈 `shift` 가 같은 날을 돌려주고, `computeTransfers` 의 날짜 루프가 끝나지 않아 탭이 멈췄다(§5). 뷰가 1583~9999 밖을 막고 있어 앱에서는 드러나지 않았다.
- **`shift`** 는 실패를 같은 날로 삼키지 않고 throw 한다 — 계산 범위 안에서는 실패하지 않는다(1583~9999 전 날짜 실측 — 아래 「검증」).
- **뷰** — 손으로 적던 범위 비교 다섯 곳(`lectionary.js` `stepHref` · `renderLectionaryView`, `calendar.js` `parseMonthParam` · `monthHref` · `buildMonthGrid`)이 엔진의 두 판정을 읽는다. 문구의 「1583년 ~ 9999년」도 엔진 상수다. `lectionary.js` 의 상수 · 그 export 는 지웠다(캘린더가 엔진에서 직접 import). 캘린더 표는 지금처럼 범위 밖 칸을 엔진에 묻지 않는다(`isComputableDate` 로 거른다).

### ② 날짜 이동 줄 하나 — `buildDateNav`

- `lectionary.js buildDateNav({ ariaLabel, title, todayHref, prev, next })` — ‹ · 가운데(제목 + 「오늘」) · › 줄 전체. 전례독서 `buildHeader` 와 캘린더 `buildMonthHead` 가 쓰고, 화면마다 다른 것은 가운데 제목 요소(`<time>` · `<h2>`)와 이름표뿐이다. 그전엔 단추(`buildDateStep`)만 공유하고 줄은 두 벌이었다 — ADR-038 2단계의 주간 화면이 셋째 벌을 만들기 전에 하나로. `buildDateStep` 은 이 줄 안의 부품으로 남는다(export 하지 않음). 그려지는 DOM 은 그대로다(아래 「검증」).

### ③ 인용 시트의 뒤로 꺾쇠도 머리 아이콘 규격 하나

- `index.html` 의 `#cite-sheet-back` 안에 손으로 들고 있던 SVG 사본을 지우고, `citations.js initCiteSheet` 가 `headerIcon(HEADER_ICON_PATHS.back)` 을 붙인다. 규격(획 · `title-back-icon`)을 바꾸면 그쪽만 옛 꼴로 남던 결합이 끊겼다.
- **`helpers.js HEADER_ICON_PATHS`**(`back` 왼쪽 꺾쇠 · `home` 집) — 같은 꺾쇠를 그리는 곳이 둘(전례독서 위 단계 · 인용 시트)이 되어, path 문자열이 다시 둘로 갈라지지 않게 글리프마다 path 하나를 둔다. `bookmark.js buildHomeBtn` · `lectionary.js buildUpLink` 도 이것을 넘긴다. `types.d.ts AppHelpers` 에 선언했다(#350 의 반환 타입 검사가 누락을 바로 잡았다).

## 확정·근거

- **작업 지시(2026-10-17, 사용자)** — 「머지 후 남은 이슈 처리하자」. 범위 · 검색 포커스 · PR 구성을 물어 셋 다 권장안으로 정했다:
  - **범위** — §10 가운데 코드로 풀 수 있는 다섯(라우터 수준 포커스 복원 · 네 걸음 묶기 · 범위 판정 하나로 · 날짜 이동 줄 · 인용 시트 꺾쇠) + 같은 뿌리인 §5 둘(엔진이 범위 밖에서 멈춤 · 「본문 바로가기」를 라우터가 가로챔). iOS 18.4 미만의 링은 기기 확인이 필요해 남기고, Safari 26 이하의 남은 경우는 Safari 27 보급으로 줄어드는 좁은 경우라 **고치지 않고 기록만** 둔다.
  - **검색 페이지 이동 뒤 포커스** — **누른 「다음 →」 그대로**(결과 목록 맨 위로 보내는 안 대신 — 전례독서의 「다음날」과 같은 규칙, Enter 를 거듭 눌러 넘길 수 있다; 마지막 페이지라 「다음 →」이 없으면 「← 이전」). 그 자리에서 `coding-pitfalls.md` §5 규칙에 적었다 — 구현은 다음 PR.
  - **PR 구성** — 둘로: 이 PR(작은 정리) → 머지 뒤 라우터 수준 포커스 복원.
- **판단 — 뷰는 엔진에 묻기 전에 거른다.** `resolveDate` 가 범위 밖에 null 을 내므로 뷰가 그 null 만 읽을 수도 있지만, 캘린더 표는 범위 밖 칸을 엔진에 묻지 않는다는 성질(`calendar.test.js` 가 지킨다)을 두고, 전례독서는 자료를 받기 전에 범위 밖을 알린다. 둘 다 엔진의 판정 하나(`isComputableDate`)를 읽으므로 범위가 바뀌어도 고칠 곳은 엔진뿐이다.
- **판단 — `shift` 를 throw 로 바꿔도 되는가.** 범위 끝의 해를 풀 때 앞뒤 해(1582 · 10000)의 앵커가 생기는데, 10000년 키(「10000-…」)는 `parseDate` 가 거부한다. 그래서 바꾸기 전에 `shift` 를 「실패를 기록하는 판」으로 바꿔 끼우고 1583-01-01 ~ 9999-12-31 의 모든 날(3,074,246일)을 실데이터로 풀었다 — **실패 0건**(142초). 범위 안에서는 `shift` 가 실패하지 않으므로 throw 는 범위 밖 호출(이제 `resolveDate` 가 막는다)과 앞으로의 결함만 크게 드러낸다.

## 검증

- **기준선**(브랜치를 판 직후, main `2e2fcae`) — 유닛 1238(1237 통과 · 1 skip — 미결13 대기 픽스처), `npm run typecheck` 0.
- **유닛** `node --test tests/unit/*.test.js` — **1242건, 1241 통과 · 1 skip**(+4: 엔진 3 — 범위 판정 · `shift` throw · `resolveDate` 범위 밖 null(이동 패스 캐시가 비어 있다) · helpers 1 — `HEADER_ICON_PATHS`). `npm run typecheck` 0.
- **실데이터** `node --test tests/unit/*.data.test.js` — 165건, 164 통과 · 1 skip(위와 같은 픽스처).
- **엔진 판정 불변** — 위 전수(1583~9999)에서 `shift` 가 한 번도 실패하지 않았으므로 성공한 덧셈의 값은 그대로다(바뀐 것은 실패 경로뿐). `resolveDate` 의 새 null 은 범위 밖에만 닿는다.
- **화면 불변(②③)** — playwright 로 main(같은 서버, `git stash`)과 이 브랜치를 비교: 캘린더 셋(2026-10 · 1583-01 · 9999-12)의 `.cal-head` 와 전례독서 셋(2026-04-05 · 1583-01-01 · 9999-12-31)의 `.lect-datenav` 의 `outerHTML` 이 같고 `#app` 길이도 같다, 페이지 오류 0. 인용 시트의 뒤로 단추는 SVG 하나 · 클래스 · viewBox · `aria-hidden` · path 속성 여섯이 같다(속성 순서만 다르다).
- **e2e** — 새로 `test_cite_sheet.py` 1(「› 더 보기」로 펼치면 뒤로 단추가 보이고 꺾쇠가 `HEADER_ICON_PATHS.back` 하나, 누르면 목록으로 돌아가 숨는다). 전체 `pytest tests/e2e/` — **315건 모두 통과**(29파일, 한 번에 8분 2초 — `python3 scripts/serve.py 8080` 위에서). 첫 실행에서는 새 테스트의 마지막 줄이 실패했다 — 뒤로 단추를 누르면 단추는 바로 숨지만 목록은 비동기로 다시 그려지는데 테스트가 그 렌더를 기다리지 않았다(테스트 쪽 경합 — 꺾쇠 검사는 통과). 목록을 기다리게 고친 뒤 그 파일 세 번 · 전체 한 번 통과.

## 갱신한 문서

- `docs/known-issues.md` — §5 의 엔진 항목 삭제(해소) · §10 에서 셋 삭제(범위 판정 · 날짜 이동 줄 · 인용 시트 꺾쇠)와 머리 노트, 남은 라우터 수준 항목에 사용자 결정(라우터 수준 · 검색은 누른 컨트롤 그대로 · 다음 PR 에서 「본문 바로가기」도), Safari 26 이하 항목에 「기록만」(사용자 결정).
- `docs/coding-pitfalls.md` §5 — 다시 그리는 화면의 포커스 규칙에 페이지 이동(검색 「다음 →」 · 「← 이전」)도 누른 컨트롤 그대로(사용자 결정).
- `docs/design/liturgical-engine.md` — §4.1 날짜 유틸 표에 계산 범위 행(정본은 엔진) · 내부 `shift` 의 throw, §5.5 `resolveDate` 계약 문장(범위 밖 null).
- `docs/decisions/038-calendar-lectionary-ui.md` §3 「구현」 — 「실패 · 범위」 줄(범위의 정본은 엔진 · `resolveDate` null · 범위 끝 단추는 `buildDateNav` 줄).
- `docs/architecture.md` §4 — helpers(`HEADER_ICON_PATHS`) · 엔진(계산 범위의 정본) · lectionary(`buildDateNav`) · calendar(범위 판정은 엔진에서) · citations(뒤로 꺾쇠) 행과 줄 수.
- `DESIGN.md` §6 — 날짜 이동 줄 행(줄째 공유 `buildDateNav` · 범위는 엔진이 판정).
- `CLAUDE.md` — 유닛 1242. `tests/README.md` — 유닛 1242 · 엔진 · helpers 행 · e2e 건수 · `test_cite_sheet.py` 행.
