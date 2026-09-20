---
date: 2026-05-10
pr: 97
branch: feat/app-modular-phase6a
title: "refactor: app.js 모듈 분할 Phase 6a — reading-context.js + bookmark.js 추출"
---

# refactor: app.js 모듈 분할 Phase 6a — reading-context.js + bookmark.js 추출

## Summary
- **공유 상태 분리** (§5.1 Option A): \`js/app/reading-context.js\` 신규 — \`bookId\`/\`chapter\`/\`verseSelectMode\`/\`selectedVerses\`/\`verseSelectDrag\` 단일 mutable 객체. caller가 \`readingContext.bookId = "gen"\` 형태로 직접 변경
- 사용자 review에서 \`state.js\` 이름이 추상적이라는 지적 → \`reading-context.js\`로 결정 (현재 읽고 있는 컨텍스트라는 도메인 의미)
- **bookmark 헬퍼 분리**: \`js/app/bookmark.js\` 신규 (~616줄)
  - Verse spec utilities 5함수: \`parseVerseSpec\`/\`collapseFullVerseRefs\`/\`_compareRefs\`/\`selectedVersesToSpec\`/\`mergeVerseSpecs\`
  - Bookmark query 7함수: \`_walkBookmarks\`/\`findExistingChapterBookmarks\`/\`_findItemInStore\`/\`_findParentFolderId\`/\`removeItemById\`/\`insertItem\`/\`collectFolderOptions\`
  - Drag & drop: \`moveBookmarkItem\`/\`_clearDragIndicators\`/\`_updateDragIndicators\`/\`closeSwipedRow\`/\`_openSwipedRow\`/\`_setupDragHandle\` + 모듈 상태(\`_dragState\`/\`_swipedRow\`) + 상수(\`SWIPE_REVEAL_PX\`/\`LONG_PRESS_MS\`)
- **UI는 Phase 6b 예정** — 트리 렌더, 드로어, 모달, 셀렉션 모드, 드로어 툴바는 분리하지 않음
- **Cross-module 상태 접근** 두 callsite 처리:
  - \`_swipedRow = null\` (renderBookmarkTree에서) → \`resetSwipedRow()\` 헬퍼 호출
  - 외부 탭 감지 (drawer pointerdown) → \`closeSwipedRowIfOutside(e.target)\` 헬퍼 호출
  - 모듈 private 상태를 직접 만지지 않고 캡슐화된 헬퍼로
- **ESM 패턴**: \`window.appBookmark\` aggregate + 16개 bare global facade(Phase 6b territory에서 직접 호출)
- \`types.d.ts\`: \`ReadingContext\`/\`AppBookmark\` 인터페이스 + 글로벌 declare 16건 + \`Window.readingContext\`/\`appBookmark\` 추가. \`VerseSelectDrag.snapshot?\` 필드 명시
- CLAUDE.md 파일 트리에 app/* 7개 모듈 행 추가
- SHELL_CACHE shell-58 → shell-59. app.js 3,969 → 3,460줄 (−509)

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` 신규 0 error (잔여 5건은 기존 gtag/dataLayer ESM 외부)
- [x] \`node --test tests/unit/*.test.js\` 147/147
- [ ] 브라우저: SW 캐시 무효화 후 콘솔 0 오류
- [ ] 북마크 추가/삭제/폴더 이동 (드래그&드롭)
- [ ] 모바일 swipe-to-reveal 동작 (장시간 누름 → 드래그 모드, 가로 스와이프 → 액션 패널)
- [ ] 절 선택 모드 진입/종료 + 다중 선택 + 사양 문자열 변환

## 후속 (Phase 6b)
- bookmark UI 전체 추출 (Bookmark UI / 트리 렌더 / Save modal / Merge dialog / Export-Import / 절 선택 모드 / Drawer toolbar) — 약 ~1,300줄

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Medium risk because it refactors cross-module state and bookmark drag/swipe behavior and relies on `window` facades + ESM script loading order; regressions would show up as broken selection/bookmark interactions or missing globals.
> 
> **Overview**
> Continues `app.js` modularization by introducing `js/app/reading-context.js` (shared mutable `readingContext` for current book/chapter + verse selection state) and `js/app/bookmark.js` (verse-spec utilities, bookmark tree queries, and drag/swipe handlers), with `app.js` updated to consume that shared state and to call new bookmark accessors (`resetSwipedRow`, `closeSwipedRowIfOutside`).
> 
> Adds ESM/window facades for bookmark helpers (including exposing `renderBookmarkTree` for the new drag logic), loads the new modules from `index.html`, extends the SW shell cache list and bumps `SHELL_CACHE` to `shell-59`, and updates `js/types.d.ts` with `ReadingContext`/`AppBookmark` plus a new optional `VerseSelectDrag.snapshot` field.
> 
> Introduces `tests/unit/bookmark.test.js`, using marker-sliced vm evaluation to unit test the extracted bookmark blocks.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit e1a4813c4a3290944f2560822d35ffc8806f731e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
