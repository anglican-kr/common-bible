---
date: 2026-10-17
branch: fix/known-issues-8
title: "fix: PR #348 리뷰 후속 셋 — 고유명 평일은 엔진 표지 · 헤더 아이콘 SVG 하나 · 전례독서도 다시 그린 뒤 포커스 (known-issues §8)"
---

# fix: PR #348 리뷰 후속 셋 — 고유명 평일은 엔진 표지 · 헤더 아이콘 SVG 하나 · 전례독서도 다시 그린 뒤 포커스 (known-issues §8)

## 요약

#348(캘린더 탭 1단계)의 `/code-review` 가 넘긴 셋(`known-issues.md` §8)을 한 PR 로 고쳤다. 항목마다 커밋 하나(① → ② → ③)이고, 공통 준비로 `js/app/helpers.js` 를 타입 검사 안에 넣었다. 셋 다 해소되어 §8 의 본문을 지우고, 그 자리에 왜 지웠는지와 어느 원장을 보면 되는지를 적은 노트를 남겼다(사용자 요청 — 아래). §9 는 번호를 당기지 않는다 — 머지된 원장 · 메모가 번호로 가리킨다.

### ① 고유명 평일을 엔진 표지로

- **엔진** — `gridObservance` 가 고유명 평일 여섯 날(부활절 기준 −45 ~ −43 · −6 ~ −4 — 재의 수요일 후 목 ~ 토 · 성주간 월 ~ 수)의 격자 관측일에 `properWeekday: true` 를 단다. 그 밖의 날에는 키가 없다(`evening` 처럼 참일 때만). 이름표 `PROPER_WEEKDAY_NAMES` 를 읽는 자리는 새 `properWeekdayNameOf` 하나 — `gridName` 과 표지가 같은 판정을 쓴다.
- **뷰** — `calendar.js` 의 `isNamedWeekday`(좌표 (lent, week null, weekday) 판별)를 지우고 `cellCandidateOf` 가 표지를 읽는다. 엔진이 그 좌표를 바꾸면(주 번호를 매기면) 칸이 조용히 빈 이름이 되던 결합이 끊겼다.
- **타입** — `types.d.ts Observance.properWeekday?: true`.
- 판정은 바뀌지 않는다 — 엔진 덤프가 main 과 바이트까지 같다(아래 검증).

### ② 헤더 아이콘 SVG 생성 공용화

- **`helpers.js headerIcon(d)`** — path `d` 만 받아 헤더 아이콘 SVG(viewBox · `aria-hidden` · `title-back-icon` · 획 속성 여섯)를 돌려준다. `bookmark.js buildHomeBtn`(집 단추)과 `lectionary.js buildUpLink`(캘린더로 꺾쇠)가 쓰고, 단추 · 링크 요소와 동작은 호출 쪽에 남았다. JS 안에서 `title-back-icon` 문자열은 이 함수 한 곳이다. 크기는 CSS rem 규칙 그대로(width/height 없음), 속성 순서까지 같아 그려지는 DOM 이 main 과 같다.
- **`bookmark.js buildBackBtn` 삭제** — 호출처 0. 마지막 호출은 2026-05-29 `0873d19`(읽기 헤더를 집 단추로 바꾼 커밋)에서 사라졌고, 그 뒤로 정의 · `appBookmark` 멤버 · `window.buildBackBtn` · export · `types.d.ts` 전역 선언 · 주석만 남아 있었다. 다섯을 모두 지우고 `views.test.js` 주석(스텁 목록)을 실제 스텁 `buildHomeBtn` 으로 고쳤다.
- **공통 준비 — `helpers.js` 를 타입 검사 안으로** — 첫 두 줄을 `// @ts-check` → `"use strict";` 순서로. 드러난 오류 0, 일부러 넣은 오류가 잡혀 검사가 실제로 걸린다. `bookmark.js` 의 두 줄은 이 PR 에서 바꾸지 않았다(§7 묶음 PR 의 몫) — 새 코드는 helpers.js 에 있어 검사를 받는다.

### ③ 전례독서 화면 포커스 복원 (WCAG 2.4.3)

- **공용 도우미 `helpers.js createFocusMemory()`** — 캘린더가 #348 에 넣은 방식(`pendingFocusKey` · `rememberFocusKey` · `commitMonth` 의 복원과 「오늘」 대체)을 올렸다. 화면이 하나씩 만든다(캘린더 · 전례독서) — 한 화면이 기억한 자리가 다른 화면으로 새지 않게(탭 전환에 앞지른 누름). `remember`(화면 루트의 click — 전역 `<a>` 인터셉터보다 먼저 닿는다 · 새 탭 클릭은 `isModifiedClick` 으로 건너뛴다) → `take`(렌더 시작에서 한 번 — 낡은 · 실패한 렌더면 버린다) → `restore`(커밋 뒤 새 루트에서).
- **전례독서의 키** — `prev` · `next` · `today` · `obs:<관측일 id>`(칩) · `pair:a` · `pair:b`(두 독서 카드) · `track:<n>` · `set:<i>` · `collect:<i>`(세그먼트 — `views.js buildSegmentTabs` 의 항목에 `focusKey` 옵션을 더했다). 관측일 id 의 콜론 · 한글 때문에 키는 선택자 문자열이 아니라 `dataset` 값으로 찾는다.
- **화면 위치** — 다시 그린 뒤 스크롤이 어디로 가는지 먼저 쟀다(아래 「확정·근거」). 같은 장을 쓰는 다시 그리기(본기도 대체안)는 스크롤이 그대로였지만, 새 장을 받아야 하는 다시 그리기(세트 · 트랙 · 칩 · 카드 · 날짜)는 스켈레톤이 한 프레임 그려지며 스크롤이 맨 위로 눌려 누른 컨트롤이 아래로 밀렸다. 그래서 누른 때의 스크롤과 **화면 루트 안** 위치를 기억해, 새 화면의 같은 컨트롤을 누른 때와 같은 화면 위치에 다시 세운다(즉시 — 루트의 `scroll-behavior: smooth` 를 그 순간만 `auto`). 그래도 화면 밖이면 가운데로. 포커스는 `preventScroll: true`.
- **계산 범위 끝** — 1583-01-01 의 「전날」 · 9999-12-31 의 「다음날」은 단추가 자리만 남는다(캘린더의 이전 · 다음 달과 같은 꼴). 그 부품 `buildDateStep` 은 `calendar.js buildStep` 을 `lectionary.js` 로 옮겨 두 화면이 쓴다(날짜 이동 줄은 원래 전례독서의 부품 — 캘린더가 이름 · 날짜 · 색 함수처럼 import). 그전엔 「교회력을 계산할 수 없는 날짜」 화면으로 가는 링크였다 — 그 화면에는 같은 단추도 「오늘」도 없어 「같은 자리가 없으면 오늘로」가 성립하지 않았다.
- **캘린더** — 같은 도우미로 바꿨다. 리스너를 머리 줄(`nav`)에서 화면 루트로 옮겼다(루트 안 위치의 기준). 달 이동은 받을 것이 없어 스크롤이 그대로라 동작은 같다.

## 확정·근거

- **작업 지시(2026-10-17, 사용자)** — 범위(§8 셋) · 브랜치 하나 · 항목별 커밋 · 표지 이름 `properWeekday`(`named` 는 본문 색인 `ix.named` 와 겹쳐 피함) · 키 이름 · `helpers.js` 를 공용 자리로 · 「같은 자리가 없으면(계산 범위 끝 등) 「오늘」로」 · `bookmark.js` 두 줄은 §7 몫 · 화면은 바뀌지 않게.
- **판단 ① — 표지는 `Candidate` 가 아니라 격자의 `Observance` 에**(작업 지시대로). 설계서 §1.3 · §5.5 가 `Observance` 에 엔진의 합성 값을 얹지 않는 것은 **정의 표의 행**을 그대로 두려는 것이다. 격자 관측일은 표의 행이 아니라 엔진이 통째로 합성한 값이고, 표지는 「어디서 왔나」(`Candidate` 의 몫 — `from` · `to` · `displacedBy`)가 아니라 `name` 과 같은 「무엇인가」다. 표의 행에는 없다(유닛이 지킨다). 설계서 §5.5 에 적었다.
- **판단 ③-1 — 화면 위치까지 돌려준다.** 실측(2026-10-17, headless Chromium, 컨트롤을 화면 위 170px 에 두고 Enter): 고치기 전에는 12경우(데스크톱 1280 · 모바일 390 × 본기도 · 세트 · 트랙 · 카드 · 칩 · 다음날) 모두 포커스가 body 였고, 스크롤은 본기도 대체안만 그대로(275 → 275)이고 세트 · 트랙 · 카드 · 칩은 0 으로 눌렸다(데스크톱 166 → 0 · 모바일 253 → 0 — 컨트롤이 170px 에서 382 ~ 423px 로 밀림). 포커스만 돌려주면 이 경우들에 컨트롤이 밀리거나(누른 손가락 · 눈 위치에서 사라짐), 아래쪽 컨트롤이면 화면 밖에 포커스가 남는다(2.4.7). 화면 위치(viewport top)가 아니라 **루트 안 위치**로 재는 것은, 스크롤이 0 으로 눌린 사이 데스크톱 머리의 검색 줄(`#breadcrumb-row` — 최대 4rem, 스크롤 60px 에서 접힘)이 펼쳐졌다 다시 접히는 것이 화면 위치에 섞이기 때문이다. 즉시 스크롤은 `behavior: "instant"` 대신 루트 인라인 `scroll-behavior: auto` + 두 인자 `scrollTo` 로 했다(CSSOM 쓰기 — CSP 가 허용; 옵션 값별 브라우저 지원은 MDN 호환 표에 갈려 있지 않다).
- **판단 ③-2 — 범위 끝의 날짜 이동 단추를 없앴다.** 작업 지시의 「계산 범위 끝 등」 대체가 전례독서에서 성립하려면 그 단추가 없어야 한다(위 요약). 캘린더 · DESIGN.md §6 「날짜 이동 줄」과 같은 꼴이고, 주소로 직접 연 범위 밖 날짜는 여전히 「교회력을 계산할 수 없는 날짜」다.
- **정정 — known-issues §7 의 숫자** — 「앱 모듈 24개 · 오류 204건」(2026-10-15)은 bookmark 계열을 10개로 센 것이었다(파일은 9개). 2026-10-17 스크래치 사본에서 다시 쟀다: main 은 23개(helpers 포함) · 205건(routing 이 그 뒤 12 → 13), 이 PR 뒤 22개 · 203건(helpers 가 빠지고 — 그 파일은 0건 — `buildBackBtn` 의 타입 없는 매개변수 둘이 함께 사라져 bookmark 13 → 11). §7 · `architecture.md` §6 을 이 숫자로 고쳤다.
- **사용자 교정(2026-10-17, 구현 보고 뒤)** — 「§8이 있던 위치에 노트를 남겨놔. 왜 지웠는지.」 처음엔 §8 을 절째 지워 번호가 비어 있었다(§7 다음 §9). 제목에 「— 해소 (2026-10-17)」를 달고 본문 자리에 노트 한 단락(무엇을 왜 지웠나 · 고친 원장 · 넘길 때의 기록 · 번호를 당기지 않는 까닭)을 두었다 — 해소된 절을 남겨 둔 §1 · §4 와 같은 꼴. 절을 통째로 비울 때의 작업 방식으로 `coding-pitfalls.md` §26 · `index.md` 에 적었다.
- **범위 밖 관찰** — 로드 스모크의 콘솔 오류는 경로마다 둘씩, 모두 GA 의 `https://www.google.com/g/collect` 요청이 `index.html` CSP 의 `connect-src`(`www.google.com` 없음)에 막힌 것이었다 — main 도 같다. 이 PR 의 스모크에서는 걸렀다.

## 검증

- **기준선**(브랜치를 판 직후, main `7c744b2`) — 유닛 1220(1219 통과 · 1 skip — 미결13 대기 픽스처), `npm run typecheck` 0.
- **유닛** `node --test tests/unit/*.test.js` — **1233건, 1232 통과 · 1 skip**(+13: 엔진 2 · 캘린더 1(+기존 1 을 표지로 고침) · helpers 8 · views 1 · 전례독서 1). `npm run typecheck` 0.
- **새 테스트가 옛 코드에서 실패한다** — JS 를 main 판으로 바꿔 돌리면 새로 쓰거나 바꾼 유닛 14건(새 13 · 표지로 바꾼 기존 캘린더 1)이 모두 실패하고(고유명 평일 표지 2 · 칸 이름 2 · `headerIcon` 2 · `createFocusMemory` 6 · `focusKey` 1 · 범위 끝 링크 1), 새 e2e 2건도 실패한다(포커스 키 null — body). 변이: 복원 스크롤 한 줄만 빼면 위치 e2e 가 실패한다(누른 세그먼트 200px → 388px, 스크롤 188 → 0).
- **실데이터** `node --test tests/unit/*.data.test.js` — 165건, 164 통과 · 1 skip(위와 같은 픽스처). `engine-data.yml` 은 머지 뒤 main push 에서 돈다.
- **엔진 판정 불변(①)** — `tools/booklet/engine-dump.mjs 2025-01-01 2030-12-31`(2,191일)을 main 과 이 브랜치에서 떠 바이트까지 같다. 책자 대조 보고서(`compare.py`)는 이 덤프와 책자 JSON 만 읽으므로 main 과 같다(책자 PDF 는 저장소 밖이라 보고서 자체는 다시 돌리지 않았다).
- **화면 불변(②)** — 16개 경로(성서 목록 · 장 · 장 목록 · 검색 · 설정 · 북마크 · 캘린더 셋 · 전례독서 넷 …)에서 머리의 아이콘 단추 `outerHTML` 과 `#app` 길이가 main 과 같다(playwright). **`buildBackBtn` 죽은 코드 확증** — 저장소 전체 grep(`window.X` · 맨이름 · index.html · e2e) · 로드 스모크(16개 경로 pageerror 0, `window.buildBackBtn` · `appBookmark.buildBackBtn` 은 undefined, `buildHomeBtn` · `headerIcon` 은 함수) · 관련 e2e(`test_navigation` · `test_calendar_view` · `test_bookmark_read` 29건 통과).
- **포커스 · 위치(③)** — 같은 탐침을 고친 코드로: 12경우 모두 포커스가 같은 컨트롤(`collect:2` · `set:2` · `track:2` · `pair:b` · `obs:t-추계재` · `next`) · `:focus-visible` · 화면 위치 170 → 170(스크롤도 그대로). 320 × 568 폰에서도 6경우 같다.
- **e2e** — 새로 `test_lectionary_view.py` 2(① 날짜 이동 셋 · 칩 둘(한글 · 콜론 키) · 세트 · 트랙 · 본기도 · 카드 · 「오늘」 · 9999-12-31 의 「다음날」 없음 → 「오늘」 · 1583-01-01 의 「전날」 없음, 데스크톱 ② 새 장을 받는 다시 그리기에서 누른 세그먼트가 같은 화면 위치 · 모바일). 캘린더 · 전례독서 e2e 61건 통과(캘린더의 `test_month_nav_keeps_keyboard_focus_on_the_pressed_control` 포함). 전체 `pytest tests/e2e/` — **312건 모두 통과**(29파일, 한 번에 8분 8초 — `python3 scripts/serve.py 8080` 위에서).

## 갱신한 문서

- `docs/known-issues.md` — §8 본문 삭제(셋 해소) · 그 자리에 해소 노트(사용자 요청) · §7 에서 helpers 를 빼고 숫자 재실측(22개 · 203건, bookmark 계열 9).
- `docs/design/liturgical-engine.md` §5.5 — 격자 관측일의 표지 `properWeekday`(여섯 날 · 뷰가 읽는다 · `Observance` 에 두는 까닭).
- `docs/decisions/038-calendar-lectionary-ui.md` — §2 칸 이름 문장(엔진 표지) · §2 「구현」 달 이동 뒤 포커스(공용 도우미) · §3 「구현」 실패 · 범위(끝의 날짜 이동 단추)와 「다시 그린 뒤 포커스」 줄.
- `docs/architecture.md` — §4 helpers 행(`headerIcon` · `createFocusMemory`) · lectionary · calendar · 엔진 · bookmark 행(역할 · 줄 수) · §6 ts-check 구멍(22개 · 203건).
- `docs/coding-pitfalls.md` — §5 다시 그린 뒤 포커스 사례(전례독서도 같은 결함이었다 · 스켈레톤이 스크롤을 누르는 함정)와 규칙(화면 위치까지 · 화면마다 기억 하나 · 값으로 찾기) · §26 신설(알려진 이슈의 절을 통째로 비울 때 — 사용자 교정).
- `docs/index.md` — known-issues 줄(절이 비면 그 자리에 노트 · 번호를 당기지 않는다) · pitfalls 절 수(16 → 26).
- `docs/status.md` — 전례독서 뷰 줄에 다시 그린 뒤 포커스 · 범위 끝 단추.
- `DESIGN.md` — §6 날짜 이동 줄 행(`buildDateStep` 공유 · 범위 끝) · §10 접근성에 「다시 그린 뒤 포커스」.
- `CLAUDE.md` — 유닛 1233. `tests/README.md` — 유닛 1233 · 파일 행 다섯(엔진 · views · helpers · 전례독서 · 캘린더) · e2e 312 · `test_lectionary_view.py` 행 · 실측 줄.
