---
date: 2026-06-10
pr: 262
branch: refactor/remove-chapter-delete-picker
title: "refactor: 미사용 장-삭제 picker 제거 (ADR-010)"
---

# refactor: 미사용 장-삭제 picker 제거 (ADR-010)

## 요약

#258 에서 읽기/장-목록 헤더 북마크가 재정의되며(모바일은 '이 장 추가' 전용, 데스크탑은 드로어) **장-삭제 선택 picker(`#bm-chapter-delete-modal`)가 진입점을 잃어 미사용**이 됐습니다. 관련 죽은 코드를 일괄 제거합니다. **동작 변화 없음** — 북마크 삭제는 시트 안의 행 스와이프·선택 모드가 담당합니다.

## 제거 내용
- **index.html** 모달 DOM, **css** 스타일 블록(~160줄)
- **bookmark-modals.js** — DOM refs · `chapterDeleteOverlay` · `open/closeChapterDeleteModal` · Escape 스택 분기 · scrim 리스너 · export · import (~110줄)
- picker 전용 헬퍼 **`_deleteBtnLabel`**(bookmark-core.js) + 유닛 2개
- **types.d.ts** 선언, 관련 주석, **스테일 e2e 3종**(`test_bookmark.py` toggle-delete/cancel/selective)
- ADR-010 "미사용 → 제거됨(2026-06-10)" 갱신

## 보존 (통째 삭제 안 함)
- tri-state 헬퍼 **`_selectAllState`** 는 벌크 선택 모드(ADR-029, `bookmark.js`)가 계속 사용 → 유지 + 유닛 유지

## 검증
- `openChapterDeleteModal` 호출처 **0** 확인 (진짜 미사용)
- 코드 전역 잔여 참조 **0**, `tsc` **0**, 유닛 **706/706**
- Playwright 스모크: 앱 정상 로드, 저장 모달·**Escape 스택 작동**, picker DOM 제거 확인, 콘솔 에러 0

순변경: **+18 / −422**.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Deletion-only refactor with no new runtime paths; remaining bookmark delete flows (swipe, bulk select, confirm modal) are untouched.
> 
> **Overview**
> **Dead-code cleanup** after mobile header bookmarks became add-only: the chapter bookmark **selective delete picker** (`#bm-chapter-delete-modal`) had no entry point, so this PR removes it end-to-end with **no user-facing behavior change** (deletion stays on bookmark sheet swipe and bulk select).
> 
> Removes modal markup from **index.html**, ~160 lines of **CSS**, and **bookmark-modals.js** logic (`open/closeChapterDeleteModal`, overlay, Escape stack step, exports). Drops picker-only **`_deleteBtnLabel`** from **bookmark-core.js** and its unit tests; keeps **`_selectAllState`** for ADR-029 bulk select. Updates **types.d.ts**, **overlay.js** comments, **ADR-010** (marked removed 2026-06-10), and deletes three stale **Playwright** mobile header toggle-delete tests.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 1b379744051b69e872940b8e5a12cdde20beab0d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
