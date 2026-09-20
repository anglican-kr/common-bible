---
date: 2026-05-10
pr: 100
branch: feat/app-modular-phase6b
title: "refactor: app.js 모듈 분할 Phase 6b — bookmark UI 전체 추출"
---

# refactor: app.js 모듈 분할 Phase 6b — bookmark UI 전체 추출

## Summary
Phase 6a에서 자리잡은 \`js/app/bookmark.js\`에 UI 전체를 합류:
- 드로어(\`openBookmarkDrawer\`/\`closeBookmarkDrawer\`)
- 트리 렌더(\`renderBookmarkTree\` + \`_buildBookmarkItem\`/\`_buildFolderItem\`/\`_buildFolderCombobox\`/\`_focusTreeItem\`/\`_getVisibleTreeItems\` 등)
- 모달: Save bookmark, Merge dialog, Drive disconnect, Import, New folder
- Verse selection mode(\`enterVerseSelectMode\`/\`exitVerseSelectMode\`/\`updateVerseSelectionBoundaries\`/\`updateVerseSelectBar\`)
- 드로어 toolbar event handlers
- 모달 trap 상태 6개 + drawer close seq/timer
- \`BOOKMARK_INERT_SELECTORS\` + \`setBookmarkBackgroundInert\` (이전 Phase 4 시점 잠시 app.js에 머물던 부분)

## Cross-module 처리
- **window facade 11건 추가**: app.js Phase 7 territory(Views/Routing/chapter rendering/initBookmarkSheetDrag)와 sync layer가 호출하는 함수 노출
- **booksCache 게터**: \`booksCache\`는 \`loadBooks\` 동행이라 app.js Phase 7 territory에 잔류. bookmark.js의 트리 렌더가 \`book.short_name_ko\` 라벨을 위해 읽으므로 \`window.getBooksCache = () => booksCache\` 게터 신설(Phase 7에서 동행 이전 예정)
- **moveBookmarkItem 직접 호출 전환**: Phase 6a에서 \`window.renderBookmarkTree()\` indirection을 두었던 부분, 이제 같은 모듈이라 직접 호출. \`bookmark.test.js\`의 \`loadDragCore\` prelude에 \`renderBookmarkTree\` stub 추가
- **\`openDriveDisconnectModal\` 위치 이전**: app.js facade 블록에서 제거(bookmark.js가 직접 \`window.openDriveDisconnectModal\` 노출)

## 라인 변동
- app.js: **3,460 → 2,126줄 (−1,334)**
- bookmark.js: 643 → 2,026줄 (+1,383)
- 모듈 분할 7단계(Phase 1~6b) 누적: app.js 6,082 → 2,126줄 (−3,956, 65% 감소)

## Test plan
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.app.json --noEmit\` 신규 0 error (잔여 5건은 기존 gtag/dataLayer ESM 외부)
- [x] \`node --test tests/unit/*.test.js\` 217/217 (bookmark 70건 회귀 없음)
- [ ] 브라우저: SW 캐시 무효화 후 콘솔 0 오류
- [ ] 북마크 드로어 열기/닫기, 트리 렌더, Save/Merge/Import 모달
- [ ] Drive 연결 해제 모달 (settings popover에서 진입)
- [ ] 절 선택 모드 진입/종료/멀티 선택/사양 변환
- [ ] 드래그&드롭으로 북마크 재정렬 (드래그 후 트리 재렌더 동작)
- [ ] 모바일 swipe-to-reveal 액션 패널
- [ ] 페이지 헤더의 뒤로가기 버튼 + 북마크 아이콘 버튼 (\`buildBackBtn\`/\`buildBookmarkHeaderBtn\`)

## 후속 (Phase 7)
- views-routing.js 추출 (~1,400줄): Views / Routing / Audio Player / Pull-to-refresh / Compact Header / Rendering helpers / Data fetching. \`booksCache\`/\`loadBooks\` 동행 이동 → \`window.getBooksCache\` 게터 제거 가능.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Large refactor that moves all bookmark drawer/tree/modal logic into `js/app/bookmark.js` and changes cross-module/global access patterns, so regressions are possible in bookmark interactions and ESM global facades. Functional intent is mostly unchanged, but it touches many DOM event handlers and focus/inert behavior.
> 
> **Overview**
> **Bookmark UI extraction (Phase 6b)**: migrates bookmark drawer, tree rendering, save/merge/import/new-folder modals, drive-disconnect modal, verse-selection mode, and related event handlers/state from `js/app.js` into `js/app/bookmark.js`.
> 
> Updates cross-module wiring for the ESM setup by expanding `bookmark.js`’s `window` facade (new globals like `openBookmarkDrawer`, `renderBookmarkTree`, `enterVerseSelectMode`, `openDriveDisconnectModal`, etc.), removing `openDriveDisconnectModal`/bookmark UI code from `app.js`, and adding `window.getBooksCache()` so bookmark rendering can read book labels while `booksCache` remains owned by `app.js`.
> 
> Adjusts drag-and-drop to call `renderBookmarkTree()` directly (no `window.` indirection), updates `js/types.d.ts` global declarations accordingly, bumps `sw.js` `SHELL_CACHE` to `shell-60`, and updates the bookmark unit test harness to stub `renderBookmarkTree()`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 8e1983f39966e0567c09e55ad39eaeb9d54953e4. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
