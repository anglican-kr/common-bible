---
date: 2026-06-10
pr: 271
branch: fix/bookmark-menu-landscape-scroll
title: "fix: 북마크 ⋯ 메뉴 가로 모드 스크롤 + 헤어라인 유지"
---

# fix: 북마크 ⋯ 메뉴 가로 모드 스크롤 + 헤어라인 유지

## 문제
모바일 기기를 가로로 돌리면 북마크 화면의 ⋯ 더 보기 메뉴(액션 + 정렬 9행)가 짧은 뷰포트 높이를 넘쳐, **아래쪽 항목을 선택할 수 없었다.**

## 수정
- `.title-action-menu` 에 `max-height` + `overflow-y: auto` + `overscroll-behavior: contain`. max-height 는 메뉴를 열 때 JS 가 트리거 버튼 top → 뷰포트 하단으로 정밀 계산(스케일-인 transform 영향을 피해 메뉴 대신 버튼을 측정). CSS `80dvh` 는 JS 이전 안전 상한.
- **iOS-26 형식 스크롤바** — iOS Safari 는 네이티브 오버레이 스크롤바(이미 그 형식)를 쓰고 커스텀 규칙을 무시하므로, 데스크탑 WebKit/Chromium·Firefox 만 얇은 반투명 pill(트랙 없음, 2px 인셋)로 맞춤.
- **부작용 수정** — 메뉴가 flex 컬럼 스크롤 컨테이너가 되며 flex 가 1px 헤어라인(`.title-action-menu-sep`)과 행을 압축하던 것을 `flex-shrink: 0` 으로 고정(헤어라인 1px·행 44px 유지).
- ADR-030 후속⁷ 노트 추가.

## 검증 (Playwright, 모바일 컨텍스트)
| | 가로 844×390 | 세로 390×844 |
|---|---|---|
| 메뉴 뷰포트 내 | bottom 370 ≤ 390 ✅ | bottom 420 ≤ 844 ✅ |
| 스크롤 | 켜짐(scrollH 412 > 363) | 꺼짐(내용 전부 표시) |
| 9행 도달성 | ALL reachable ✅ | — |
| 헤어라인 / 행 높이 | 1px / 44px 유지 ✅ | 유지 ✅ |

- 유닛 721건 통과 · tsc 0 errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Bookmark header menu layout and open-time max-height only; no auth, data, or routing changes.
> 
> **Overview**
> Fixes the bookmark **⋯** overflow menu clipping off-screen in **landscape** when ~9 action + sort rows exceed the short viewport height, so lower items (especially sort options) were unreachable.
> 
> **`.title-action-menu`** becomes a scrollable flex column: `max-height: 80dvh` (CSS safety cap), `overflow-y: auto`, `overscroll-behavior: contain`, and iOS-26-style thin scrollbars on desktop WebKit/Firefox. On open, **`openMenu()`** in `bookmark.js` sets `menu.style.maxHeight` from the trigger button’s top to the viewport bottom (16px gap), measuring the button—not the menu—to avoid scale-in transform skew.
> 
> **Side effect fix:** rows and the 1px separator get **`flex-shrink: 0`** so flex no longer compresses the hairline or rows below the 44px touch target when scrolling. **ADR-030** follow-up⁷ documents the behavior.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 00a934ec382a71ec4ea70e851bc9542a86cc7916. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
