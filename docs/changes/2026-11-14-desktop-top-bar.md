---
pr: 564
date: 2026-11-14
branch: feat/desktop-top-bar
title: "feat: 데스크톱 헤더를 한 줄 상단 바로 개편"
---

## 요약

데스크톱 헤더를 늘 보이는 한 줄 상단 바로 바꿨다(ADR-043, 새 ADR). 왼쪽에 목적지 탭 「성서」, 「캘린더」, 「북마크」, 가운데에 제목, 오른쪽에 검색창과 설정 단추가 있고 스크롤해도 접히지 않는다. ADR-043 「구현 단계」의 1단계이고, 탭 셋을 이 단계에서 모두 넣었다. 모바일은 바뀌지 않는다.

## 확정 · 근거

- 데스크톱 화면을 Chromium으로 띄워(폭 900, 1440, 2560px) 헤더의 문제 여덟 가지를 확인했다(ADR-043 「맥락」). 윗줄이 접힌 뒤에는 장 끝에서 300px을 올려도 접힌 채였다.
- 사용자가 시안 두 가지(한 줄 상단 바, 왼쪽 사이드바)를 여섯 화면씩 견주어 한 줄 상단 바를 골랐다(2026-11-14). 낱개 수정안은 시안을 그리기 전에 채택하지 않기로 했다.
- 같은 날 사용자가 정한 것: 북마크는 본문 옆 패널, 설정도 북마크와 같은 패널, 헤더는 화면 전체 폭, 장 제목 양옆의 이전과 다음 단추, 데스크톱 전례독서의 「월간으로 보기」 빼기, 키보드 단축키, 아이콘 단추의 이름. 시안을 본 뒤에는 캘린더와 전례독서의 「오늘」을 다음 단추의 오른쪽에 두기로 했다(데스크톱만, 모바일은 ADR-038 §1 그대로). 구현 중에는 탭 셋을 1단계에서 다 갖추기로 했다.
- 이 PR에 넣지 않은 것: 뒤 화면을 덮지 않는 패널, 설정 패널, 장 제목 옆 북마크 단추의 정리(2단계), 이전과 다음 장 단추, 「월간으로 보기」 빼기(3단계), 단추 이름과 단축키(4단계). 단축키로 쓸 키와 패널이 화면을 가리는 방식은 정해지지 않았다(ADR-043 「미결 사항」).
- 구현하며 정한 것(사용자가 고르지 않았다).
  - 「성서」 탭은 모바일 탭 바의 홈 탭과 같은 처리기를 쓴다. 캘린더에서 누르면 마지막에 읽던 성서 화면으로, 성서 화면에서 누르면 성서 목록으로 간다. 집 단추는 늘 성서 목록으로 갔다.
  - 검색창은 포커스를 받아도 넓어지지 않는다. 양옆 칸이 남는 폭을 똑같이 나누므로 검색창이 넓어지면 가운데 제목이 밀린다.
  - 폭 900px 아래에서는 탭의 글자를 숨기고 아이콘만 남긴다.
  - 「북마크」 탭으로 연 패널의 「이 장 저장」과 「절 선택」은 지금 화면이 그려진 장일 때만 켠다. 읽던 장의 기록(`readingContext`)이 화면을 떠나도 남아 있어, 그것만 보면 캘린더에서 연 패널이 읽던 장을 저장한다.
  - 북마크 모아 읽기(`/read`)의 「북마크로 돌아가기」 단추는 남겼다. 2단계에서 다시 본다.
- 제목 줄의 「성서 목록으로」 집 단추는 모바일에서 이미 숨겨져 있었다. 데스크톱에서도 쓰지 않게 되어, 숨기지 않고 만드는 코드를 지웠다.
- 윗줄 접힘(`initCompactHeader`)을 지우면서, 읽던 절로 돌아갈 때 접힘을 기다렸다가 한 번 더 맞추던 코드(`scrollUnderBar`)도 줄였다. 다음 프레임에 한 번 더 맞추는 것은 남겼고, 그사이 독자가 스크롤을 시작하면 맞추지 않는다. 처음에는 이 조건을 함께 지웠다가 e2e(`test_resume_on_desktop_leaves_the_scroll_alone_once_the_reader_scrolls`)가 독자의 스크롤이 되돌려지는 것을 찾아 되살렸다.
- known-issues §10.2(Safari 26 이하에서 접혔다 펼쳐지는 윗줄 때문에 위치가 어긋남)는 원인이 없어져 닫았다. Safari 26 이하에서 직접 확인하지는 않았다.
- ADR-029, 030, 041의 데스크톱 서술은 고치지 않았다. 드로어, 팝오버, 사이드바 계획을 적은 곳이라 2단계에서 고친다(ADR-043 「후속」).

## 검증

- `node --test tests/unit/*.test.js`: 1750개 통과. `initCompactHeader` 테스트 7개를 지우고, `syncHeaderNav` 3개와 `scrollUnderBar` 1개를 더했다.
- `npm run typecheck`: 통과.
- `node --test tests/unit/docs-*.test.js`: 23개 통과.
- e2e 전체(`pytest tests/e2e`, 작업 폴더를 8094번 포트에 띄워 사본으로 실행): 「북마크」 탭을 넣기 전에 667개 가운데 642개 통과, 25개 실패. 실패는 모두 `test_install_guide.py`였고 원인은 테스트의 선택자였다. 헤더의 순서를 바꾸면서 숨겨진 제목 줄 설정 단추(known-issues §27)가 문서에서 먼저 오게 되어 `.settings-btn`이 그 단추를 짚었다. 선택자를 `#settings-anchor .settings-btn`으로 고쳤다.
- 「북마크」 탭을 넣은 뒤: `test_top_bar.py`(새 파일, 그때 21개)와 `test_install_guide.py`(30개) 통과. 패널 코드를 건드려 북마크(`test_bookmark.py`, `test_bookmark_folders.py`, `test_bookmark_export_import.py`, `test_bookmark_read.py`), 접근성(`test_a11y_axe.py`, `test_a11y_keyboard.py`), 설정, 검색, 탭 바 파일을 다시 돌려 188개가 통과했다. 탭을 넣은 뒤 전체 e2e를 다시 돌리지는 않았다.
- 그전에 집 단추와 윗줄 접힘에 기대던 e2e 17개를 새 동작에 맞게 고쳤다(`test_navigation.py`, `test_calendar_view.py`, `test_lectionary_view.py`, `test_features.py`, `test_note_tooltip.py`).
- 화면 확인: Chromium으로 폭 1440, 1000, 820, 780, 390px에서 헤더를 찍어 보았다. 제목의 가운데가 창의 가운데와 1px 안에서 같았다(폭 780px의 캘린더는 30px 왼쪽으로 치우친다. 날짜 이동 줄과 「오늘」, 보기 전환 단추가 가운데 칸보다 넓기 때문이다).
- 확인하지 않은 것: Safari와 Firefox, 실제 기기, 다크 테마의 탭 표시 대비, 글자 크기 설정을 키웠을 때의 모양.

## 갱신한 문서

- `docs/decisions/043-desktop-top-bar.md`: 새 ADR. 상태는 「승인됨, 구현 중」.
- `docs/architecture.md` 부록 A: ADR-043 한 줄.
- `docs/decisions/024-book-list-tabs-and-header-nav.md` §4: 데스크톱의 설정 단추 자리와 접힘.
- `docs/decisions/038-calendar-lectionary-ui.md` §1, §2: 데스크톱 캘린더 단추, 집 단추, 「오늘」의 자리.
- `DESIGN.md` §4(상단 바 높이), §6(날짜 이동 줄), §7(데스크탑 절).
- `docs/topics/routing.md`: 「지금 동작」에 한 줄 상단 바, 「결정」, 「남은 일」(남은 단계, §10.2를 뺌).
- `docs/topics/design-system.md`, `docs/topics/liturgical.md`: 데스크톱 헤더를 적은 줄.
- `docs/known-issues.md`: §10.2 해소.
- `tests/README.md`: `test_top_bar.py` 줄, 바뀐 설명.

## 리뷰 반영

1회차(`/code-review medium 564`, 2026-11-14). 열 건을 모두 고쳤다.

1. 창을 넓혀도 짧은 제목이 남던 것: 폭 변화를 제목 칸이 아니라 상단 바(`#app-header`)에서 본다. 제목 칸의 폭은 글자 폭이라 창 폭이 바뀌어도 그대로였다.
2. 북마크 모아 읽기의 「북마크로 돌아가기」 단추가 제목 글자를 덮던 것: 데스크톱에서 제목 줄의 단추를 모두 글자 옆에 세운다.
3. 「북마크」 탭으로 연 패널을 닫으면 포커스가 탭으로 돌아오도록, 돌아올 요소를 넘긴다. 누른 단추에 포커스를 주지 않는 브라우저(macOS Safari)를 위한 것이고 Safari에서 직접 확인하지는 않았다. e2e는 포커스 없이 클릭 이벤트만 보내 흉내 낸다.
4. 실행되지 않던 「열려 있으면 닫는다」 분기를 지웠다. 탭을 다시 눌러 닫는 것은 패널이 뒤 화면을 덮지 않게 되는 2단계의 일이라고 ADR-043 §4에 적었다.
5. 창 폭이 경계를 넘으면 「오늘」을 그 배치의 칸으로 옮긴다(`lectionary.js`의 `placeToday`). 두 칸에 하나씩 두는 방법은 포커스를 돌려줄 자리(`data-focus-key`)가 둘이 되어 쓰지 않았다.
6. 좁은 창에서 글자 크기를 키우면 제목이 가운데에서 벗어나던 것: 검색창의 좁은 쪽 기준을 11rem에서 140px로 바꿨다. 폭 780px, 글자 24px에서 78px이던 치우침이 19px이 됐다. 이 조건에서는 세 칸이 한 줄에 다 들어가지 않아 0이 되지는 않는다.
7. `aria-expanded`를 손으로 고치던 두 줄을 `createOverlay`의 `ariaExpanded` 옵션으로 바꿨다.
8. 쓰이지 않게 된 것을 지웠다: `buildHomeBtn`의 `focusBookId` 인자, `.lect-bar-start > .title-back-btn` 규칙. 접힘을 말하던 CSS 주석과 e2e 설명도 고쳤다.
9. 데스크톱 판정을 `helpers.js`의 `isDesktopLayout`과 `DESKTOP_LAYOUT_QUERY`로 모았다. `lectionary.js`와 `tabbar.js`가 쓴다. `overlay.js`, `search.js`, `bookmark-gestures.js`는 이 PR에서 건드리지 않은 파일이라 그대로 두었다.
10. `DESIGN.md`의 새 소제목에서 줄표를 빼고, 이 PR이 쓴 줄의 「데스크탑」을 「데스크톱」으로 맞췄다. 그 문서의 다른 줄은 그대로다.

검증: 유닛 1750개와 타입 검사 통과. e2e는 `test_top_bar.py`(25개, 리뷰 건마다 하나씩 4개를 더함), `test_note_tooltip.py`, `test_bookmark_read.py`, `test_bookmark.py`, `test_a11y_keyboard.py`, `test_calendar_view.py`를 돌려 통과했다. 1, 2, 5, 6번은 Chromium으로 다시 재어 확인했다.
