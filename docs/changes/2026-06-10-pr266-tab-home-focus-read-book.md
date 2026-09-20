---
date: 2026-06-10
pr: 266
branch: feat/tab-home-focus-read-book
title: "feat: 홈 탭 pop-to-root 시 읽던 책 카드 포커스·강조 (ADR-031)"
---

# feat: 홈 탭 pop-to-root 시 읽던 책 카드 포커스·강조 (ADR-031)

## 배경

읽는 중 **하단 홈 탭을 한 번 누르면**(iOS pop-to-root) 성서 목록으로 돌아가지만, 두 가지가 빠져 있었다.

1. 정적 `href="/"` 로만 떨어져 **읽던 책 카드에 포커스가 안 잡혔고**, `/` 는 첫 구분(구약)만 렌더하므로 신약 책을 읽다 눌렀다면 그 책이 목록에 아예 없었다. (헤더 홈 버튼 `buildHomeBtn` 은 이미 책의 구분 탭으로 가서 포커스 — 하단 탭만 빠짐)
2. 포커스를 맞춰도 색이 안 바뀌었다 — 프로그래밍 `.focus()` 는 `:focus-visible` 을 트리거하지 않는데 CSS 가 그 의사클래스로만 강조했기 때문.
3. 명시 강조를 넣자 iOS Safari 가 `.focus()` 에 그리는 **UA 포커스 아웃라인**이 첫 행에서 위 sticky 탭에 상단이 잘려 보였다.

## 변경

- **tabbar.js** — 이미 홈 스택이면 pop-to-root 시 `parsePath().bookId` 가 있는 경우 그 책의 구분(`/<division>`)으로 `navigate` + `setPendingBookFocus`. 목록·구분 화면(bookId 없음)은 그대로 `/`.
- **views.js** — `focusPendingBook` 이 `.is-last-read` 마커 클래스를 1회성 부여(첫 사용자 입력에 제거, 다음 렌더에서도 자연 소멸).
- **style.css** — `.is-last-read` accent 배경 채움(hover/`:focus-visible` 와 동일) + `.book-list a:focus { outline:none }` 로 잘린 UA 아웃라인 제거. book-list 는 원래 배경 채움을 포커스 표시로 쓰므로 어포던스 손실 없음(키보드는 `:focus-visible` 로 동일 채움, WCAG 충족).
- **e2e** — 신약(matt) 하단 탭 → 카드 포커스 + `.is-last-read` 마커 검증.
- **docs** — ADR-031 개정 블록 + status.md 갱신.

## 검증

- 유닛 721건 통과, tsc 클린.
- e2e: 신약 하단 탭 포커스/마커, 헤더 홈 버튼 포커스 통과.
- 기존 `test_home_tab_returns_to_root` 실패는 clean 트리에서도 동일한 headless 사전 실패(`wait_app_ready` 가 모바일에서 숨겨진 `#search-input` 대기)로 본 변경과 무관함을 stash 로 확인.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 모바일 홈 탭·목록 포커스/a11y UX 개선으로 라우팅·인증·데이터 경로는 건드리지 않으며, 기존 다른 탭→홈 복원 분기는 early return으로 유지된다.
> 
> **Overview**
> **ADR-031 개정:** 읽는 중 모바일 **하단 홈 탭**을 눌러 pop-to-root 할 때, 헤더 홈 버튼(`buildHomeBtn`)과 같이 **읽던 책이 있는 구분 탭**(`/<division>`)으로 이동하고 해당 **책 카드에 포커스·중앙 스크롤**한다. 신약 등 `/`만 열면 목록에 없던 책도 구분 라우팅으로 해결한다.
> 
> `tabbar.js`는 홈 스택이고 `bookId`가 있을 때 `setPendingBookFocus` + `navigate`로 가로채고, `views.js`의 `focusPendingBook`은 프로그래밍 `focus()`에 `:focus-visible`이 안 붙는 문제를 **`.is-last-read` 일회성 클래스**로 보완한다. `style.css`는 그 클래스에 accent 강조를 주고, iOS에서 잘리는 UA 포커스 아웃라인은 `.book-list a:focus { outline: none }`으로 제거한다(키보드는 `:focus-visible`로 동일 채움 유지).
> 
> e2e로 matt 읽기 중 홈 탭 → 포커스·마커를 검증하고, ADR-031·`status.md`를 갱신한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit df00c8c7edbb018a97ad94440a00f1b1b40b02b6. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
