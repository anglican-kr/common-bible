---
date: 2026-06-11
pr: 281
branch: refactor/bookmark-tree-split
title: "refactor: 북마크 트리 렌더링을 bookmark-tree.js로 분리 (ADR-034 후속·분할 완료)"
---

# refactor: 북마크 트리 렌더링을 bookmark-tree.js로 분리 (ADR-034 후속·분할 완료)

## 무엇을

bookmark.js 마지막 라운드(2/2). 트리 렌더링 일체를 신규 모듈 `js/app/bookmark-tree.js`(628줄)로 추출 — **분할 완료**.

- per-row 빌더 (bookmark/folder item · swipe action · drag handle · select circle · folder read btn · empty state)
- `renderBookmarkTree` (드로어 body OR #bookmarks-view-tree 풀뷰)
- `_rerenderActiveBookmarkTree` (재렌더 허브)
- `renderBookmarksView` (풀스크린 탭 뷰)
- 드로어 body 키보드 내비 (roving tabindex · arrow/Home/End/Enter) + swipe-outside pointerdown

`bookmark.js` 1,145 → **590줄**. **전체 분할 누계: 2,432 → 590줄 (−76%)** — 드로어/헤더 오케스트레이터로 수렴.

## 설계 — 역방향 3개만 주입

트리 렌더러가 오케스트레이터에서 필요로 하는 건 단 3개: `closeBookmarkDrawer`(링크/폴더읽기 탭 시 드로어 닫기) · `refreshBookmarkHeaderBtn`(읽기 헤더 갱신) · `_setBookmarkBtnIcon`(빈 상태 glyph, 헤더 버튼과 공유) → `initBookmarkTree()`로 주입. **주입 훅을 빌더가 부르는 원래 이름 그대로 `let`으로 선언**해 추출 본문은 한 줄도 안 고쳤다. `$bookmarkDrawerBody`(렌더 타깃+내비 루트)는 트리 전용이라 tree가 소유. 나머지는 전부 하향 import.

`_rerenderActiveBookmarkTree`가 tree로 이동하며 gesture/select/menu의 `rerenderTree` 주입은 bookmark.js가 import해 그대로 전달(여전히 순환이라 주입 유지).

**정리.** 무참조가 된 import 대거 제거: bookmark-core 13종→`findExistingChapterBookmarks` 1종 + select 2종 + menu `buildBmViewActions` + appHelpers 3종.

## ⚠️ 검증에서 배운 점 (정직 보고)

처음 작성한 tree.js에서 **import 8종을 통째로 누락**(`setRenderPathname`·`saveBookmarks`·`openSaveModal`·`openConfirmModal`·core 4종)했는데 **tsc·worker tsc 모두 통과**했다 — checkJs가 미선언 식별자를 전역으로 묵인하는 사각지대. **로드 스모크가 렌더 경로(`setRenderPathname`)를, 상호작용 e2e가 모달 경로를** 잡아 전수 보강. 교훈을 `known-issues`/ADR/메모리에 기록.

## 테스트

마커 블록 없어 `bookmark.test.js` 무변경.

- ✅ tsc (main · worker) — 단, missing-import은 못 잡음(위 참조)
- ✅ 유닛 728건
- ✅ Playwright 로드 스모크 (드로어 + 풀뷰 트리 렌더 · facade · 콘솔 에러 0)
- ✅ e2e 78건 (bookmark · edit · swipe · dnd · select-delete · add-help · export-import · copy + folders)
- ⚠️ 사전 실패 2건 `test_bookmark_folders.py` 폴더 토글 — base 동일, known-issues §1c

## 문서

- ADR-034 상태 = **분할 완료** + `개정 (2026-06-11): bookmark-tree.js 분할 (마지막 라운드 2/2)`
- `known-issues.md` §2 — 분할 완료 기록

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Large behavioral surface (drawer + full view tree, DnD/swipe/select/modals) moved with no intended UX change; risk is wiring/import gaps (tsc may not catch missing imports) rather than new product logic.
> 
> **Overview**
> Completes **ADR-034 bookmark modularization** by moving all tree UI out of `bookmark.js` into new **`bookmark-tree.js`** (~628 lines). `bookmark.js` drops from ~1,145 to **~590 lines** and stays the drawer/header orchestrator (overlay lifecycle, toolbar, `init*` wiring, window facade).
> 
> **`bookmark-tree.js`** now owns per-row builders (bookmark/folder, swipe, drag handle, select circle, folder read, empty state), `renderBookmarkTree` / `_rerenderActiveBookmarkTree`, full-tab `renderBookmarksView`, drawer-body keyboard nav, and `#bookmark-drawer-body`. It imports downward from core, gestures, select, menu, and modals; **`initBookmarkTree()`** injects only three callbacks from the orchestrator (`closeBookmarkDrawer`, `refreshBookmarkHeaderBtn`, `_setBookmarkBtnIcon`) so the tree never imports `bookmark.js`. Gesture/select/menu still get `_rerenderActiveBookmarkTree` via `bookmark.js` re-exports.
> 
> **`bookmark.js`** adds `initBookmarkTree`, imports the tree APIs, removes the large inline tree block and trims imports (e.g. bookmark-core down to `findExistingChapterBookmarks`). Docs mark the split **done** (ADR-034, `known-issues.md`) and note the **checkJs/tsc blind spot** for missing imports on extract—load smoke + e2e caught gaps tsc missed.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6f31cf089373c44978094f6dd68eacee603755d0. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
