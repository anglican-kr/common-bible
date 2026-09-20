---
date: 2026-06-08
pr: 243
branch: chore/dead-facade-cleanup
title: "chore: 모듈 분할 후 죽은 facade·미사용 import 정리 (ADR-034 후속)"
---

# chore: 모듈 분할 후 죽은 facade·미사용 import 정리 (ADR-034 후속)

## 무엇을

모달 분리 시리즈(PR5a~5e) 동안 보존만 해두었던 **검증된 죽은 코드**를 일괄 제거. 사용자 발의(2026-06-08).

**제거 전 무참조 확증**(전 저장소 grep js/ + 인라인 HTML + 로드 검사) — blind 삭제 아님:

1. **`window.close{Confirm,ChapterDelete,NewFolder,Save,Merge,Import,Move}Modal` 7종** (bookmark-modals.js)
   - route() 가 `appOverlay.closeAllOverlays()`(ADR-034)로 대체 → 외부 호출 0건
2. **bookmark-core.js QUERY 헬퍼 7종 window facade** + types.d.ts Window·전역 function 선언
   - `_walkBookmarks`·`findExistingChapterBookmarks`·`_findItemInStore`·`_findParentFolderId`·`removeItemById`·`insertItem`·`collectFolderOptions` — ESM import 로만 사용, facade·bare-global 호출 0건 (PR3 에서 "숨은 깨짐 방지"로 보존했던 계약, 이제 안전 확인)
3. **bookmark.js 미사용 core import 2개**: `_deleteBtnLabel`(PR5a 잔재), `_findParentFolderId`(PR5c 잔재)

순삭제 **−82 / +12**(주석 breadcrumb).

## 검증
- ✅ tsc main·worker 0 · 유닛 678
- ✅ e2e 52건(confirm 삭제·QUERY 트리연산·move·import 등 facade 가 쓰이던 흐름)
- ✅ **로드 검사 pageerror 0** + 제거된 facade 가 런타임에서 `undefined` 확인(앱·core 정상 로드)

## 맥락
ADR-034 모달 분리 시리즈의 마무리 정리. modals.js export 는 이미 진입점과 일치해 손댈 것 없음.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Verified no callers of removed globals; pure deletion and type/doc updates with no logic changes.
> 
> **Overview**
> **ADR-034 follow-up cleanup** after bookmark modularization: drops legacy `window` facades that nothing calls anymore, and trims stale ESM imports.
> 
> **`bookmark-modals.js`** no longer assigns seven `window.close*Modal` hooks; routing already dismisses overlays via `appOverlay.closeAllOverlays()`.
> 
> **`bookmark-core.js`** stops exposing QUERY tree helpers (`_walkBookmarks`, `findExistingChapterBookmarks`, `_findItemInStore`, `_findParentFolderId`, `removeItemById`, `insertItem`, `collectFolderOptions`) on `window`; consumers use ESM imports only.
> 
> **`bookmark.js`** drops unused imports `_deleteBtnLabel` and `_findParentFolderId` (chapter-delete label still comes from core via `bookmark-modals.js`).
> 
> **`types.d.ts`** documents that QUERY helpers are ESM-only and removes them from `AppBookmark` and bare-global `function` declarations.
> 
> Behavior is unchanged for paths that already imported from `bookmark-core` / used the overlay stack.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 78034e9f94186d062cb6e457c5d62110a9b05ac8. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
