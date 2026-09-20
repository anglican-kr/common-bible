---
date: 2026-06-08
pr: 242
branch: refactor/bookmark-move-modal
title: "refactor: 북마크 move 모달을 파라미터화해 bookmark-modals.js로 분리 (ADR-034 후속 PR5e)"
---

# refactor: 북마크 move 모달을 파라미터화해 bookmark-modals.js로 분리 (ADR-034 후속 PR5e)

## 무엇을

move 다이얼로그를 **select-mode 상태 없는 범용 폴더 picker**로 일반화해 `bookmark-modals.js`로 이동.

```js
openMoveModal({ excludeFolder, onPick })
// 호출자가 제외 술어 + 이동 콜백을 넘김
// 행 클릭 → self-close 후 onPick(folderId)
// 새 폴더 → openNewFolderModal(newId=>onPick(newId), …, { folderFilter })  ← 모듈 내부
```

- `bookmark.js` **2,260 → 2,198줄** · `bookmark-modals.js` 930 → 1,024줄
- 누적 `bookmark.js` 3,578 → **2,198줄 (−38%)**

## 왜 "파라미터화" (지속 DI 아님)
move 는 `_bmSelected`·`_bmAncestorSelected` 같은 select 상태를 읽어, 그대로 modals 로 옮기면 select 내부를 `_deps` 에 줄줄이 주입해야 함(계약 오염). 대신 **호출 시 인자**로 `excludeFolder`(제외 술어)와 `onPick`(이동 콜백)만 넘김 → select 로직(`_moveSelectedToFolder`·`_bmEffectiveTargets` 등)은 bookmark.js 의 `_openMoveSelection` 에 남고, picker 는 순수 UI.

## Escape 분할 해소 (#241 Bugbot 근본 수정)
이로써 **모든 모달이 `closeTopmostModal` 로 모임**. bookmark.js Escape 라우터는 전적으로 위임(`if (closeTopmostModal(e)) return;`). #241 의 임시 move-순서 수정을 구조적으로 흡수하고, 스택을 z-순서(new-folder>move>import>…)로 재배열.

## 검증
- ✅ tsc main·worker 0 · 유닛 678
- ✅ **e2e `test_move_into_folder` + `test_move_new_folder_with_parent` 통과**(파라미터화한 picker·onPick·새 폴더 경로 실동작) + bookmark/folders/select 28건
- ✅ playwright 로드 검사 pageerror 0

## 다음
모달 분리 시리즈 **완료**(7개 모달 전부 bookmark-modals.js). 다음은 **죽은 코드 정리 PR** — 잔재 `window.close*Modal` facade + 누적 미사용 core import(_deleteBtnLabel 등).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches multi-select move UX and modal Escape stacking; behavior is intended to match prior flows but overlay order changes are user-visible if wrong.
> 
> **Overview**
> Moves the bookmark **move destination** dialog from `bookmark.js` into `bookmark-modals.js` as a reusable folder picker: **`openMoveModal({ excludeFolder, onPick })`**. Select-mode rules stay in `bookmark.js` (`_openMoveSelection` passes an exclude predicate and `_moveSelectedToFolder`); the modal only builds the list (root + folders + **새 폴더** via `openNewFolderModal` with the same filter), closes itself, then calls `onPick`.
> 
> **Escape** handling is consolidated: `closeTopmostModal` now includes move (and reorders move before import to match z-index), so `bookmark.js` no longer special-cases move on Escape. `window.closeMoveModal` moves with the modal module.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6c5c80a93e42358e3648019200439a00d49d036d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
