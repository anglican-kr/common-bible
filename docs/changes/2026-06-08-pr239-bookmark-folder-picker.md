---
date: 2026-06-08
pr: 239
branch: refactor/bookmark-folder-picker
title: "refactor: 폴더 콤보박스·새 폴더 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5b)"
---

# refactor: 폴더 콤보박스·새 폴더 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5b)

## 무엇을

모달 분리 **2단계(PR5b)**. 폴더 선택 콤보박스 + 새 폴더 생성 모달을 `bookmark-modals.js`로 이동.

- `_buildFolderCombobox`(커스텀 listbox 폴더 picker, 154줄) + 전용 아이콘 `_buildMaterialFolderIcon`
- 새 폴더 모달(overlay·open/close/`_commitNewFolder` + 부모 picker 상태 `_bmNewFolderCallback`/`_bmNewFolderParentCombo`)
- `bookmark.js` **2,916 → 2,659줄** · `bookmark-modals.js` 209 → 498줄
- 누적 `bookmark.js` 3,578 → **2,659줄 (−26%)**

## 순환 회피 (이번 단계의 핵심)
콤보박스는 **save 모달과 새 폴더 모달이 공유**한다. 콤보박스를 *먼저* 옮겨 `bookmark.js → modals` 단방향 import 로만 두면, 아직 bookmark.js 에 남은 save 가 콤보박스를 import 만 하면 돼 순환이 안 생긴다(save 본체는 PR5c). 콤보박스의 "+ 새 폴더" → `openNewFolderModal` 은 이제 모듈 내부 호출.

## DI·Escape
- 새 폴더 commit 의 트리 갱신은 PR5a 가 주입한 콜백(`rerenderActiveBookmarkTree`) 재사용 → **DI 표면 불변**
- Escape 스택에 new-folder(최우선)를 `closeTopmostModal(e)` 로 흡수, bookmark.js 라우터는 위임만 (`if (closeTopmostModal(e)) return;`)
- `window.closeNewFolderModal` 잔재 facade 이동·보존(주석 명시) → 후속 정리

## 검증
- ✅ tsc main·worker 0 · 유닛 678 · e2e bookmark+folders+edit 21
- ✅ **playwright 로드 검사 pageerror 0**
- 최신 main(라우트 가드 #238 포함)으로 리베이스 후 재검증 — disjoint, 충돌 없음

## 다음
PR5c: save + merge(상호결합, exitVerseSelectMode DI 추가). PR5d: move + import.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches bookmark tree persistence and modal/Escape stacking, but the change is largely a move with the same commit and DI paths; save/move still depend on the exported combobox API staying stable until PR5c.
> 
> **Overview**
> **PR5b** continues splitting bookmark dialogs out of `bookmark.js` by moving the **folder listbox combobox** (`_buildFolderCombobox`, folder icon helper) and the **새 폴더** modal (overlay, open/close/commit, DOM refs, and continuation state) into `bookmark-modals.js`.
> 
> `bookmark.js` now **imports** `openNewFolderModal` and `_buildFolderCombobox` for save/move/menu flows while dropping the duplicated implementation (~250 lines). Folder creation still persists via `insertItem` / `saveBookmarks` and refreshes the tree through the existing **`initBookmarkModals` DI** (`rerenderActiveBookmarkTree`).
> 
> **Escape handling** is centralized: `closeTopmostModal` takes the keyboard event, closes **new-folder first** (with `preventDefault` / `stopPropagation` to match prior behavior), and `bookmark.js` delegates instead of checking the new-folder modal locally. `window.closeNewFolderModal` is re-exported from the modals module.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 08cba8cd765fd89e39ea42e131e634080f195b30. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
