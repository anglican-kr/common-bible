---
date: 2026-06-11
pr: 276
branch: fix/bookmark-isdescendant-export
title: "fix: 선택 모드 폴더 이동 ReferenceError 수정 (_isDescendant export 누락)"
---

# fix: 선택 모드 폴더 이동 ReferenceError 수정 (_isDescendant export 누락)

## 무엇이 문제였나

제스처 모듈 분리(#275, ADR-034 후속)에서 `_isDescendant`를 `bookmark-gestures.js`로 옮기면서 **export를 누락**했다. `bookmark.js`의 `_moveSelectedToFolder`가 이 함수를 bare로 참조하므로, ESM 모듈에서 미해결 바인딩 → **런타임 `ReferenceError`**.

**증상**: 선택 모드에서 **폴더(또는 폴더를 포함한 항목)를 다른 폴더로 이동**하면 이동이 중단된다(select bar가 사라지지 않음). 북마크만 이동하는 경우는 폴더 분기를 안 밟아 정상.

**왜 #275 검증을 통과했나**: `_isDescendant`는 `found.item.type === "folder"`일 때만 호출된다.
- tsc — checkJs가 모듈 미선언 식별자를 하드 에러로 안 잡음
- 유닛 — 이 통합 경로 미커버
- 로드 스모크 — 이동을 트리거하지 않음
- 기존 move e2e(`test_move_into_folder` 등) — **북마크만** 이동, 폴더 분기 미진입

## 수정

- `bookmark-gestures.js`가 `_isDescendant` export, `bookmark.js`가 import (이미 같은 모듈에서 import 중인 목록에 추가).

## 회귀 가드

- e2e `test_move_folder_into_folder` 추가: 폴더를 선택해 다른 폴더로 **이동 완료** + `pageerror == 0` 검증.
- 픽스를 #275 상태로 되돌려 새 테스트가 실패(select bar 잔존)하는 것을 확인 → 버그 실재 증명.

## 검증

- ✅ tsc (main · worker)
- ✅ 유닛 728건
- ✅ e2e 26건 (`test_bookmark_select_delete` 신규 회귀 포함 + `dnd` + `swipe`)

> 후속(비긴급): `_isDescendant`는 드래그(gestures)와 이동(select) 양쪽이 쓰는 순수 트리 헬퍼이므로, 본래 자리인 `bookmark-core.js`로 옮기는 정리를 다음 라운드(bookmark-select 분리)에서 함께 검토.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Minimal wiring fix plus a regression test; behavior is restoring an intended guard path, not new logic.
> 
> **Overview**
> Fixes a **runtime `ReferenceError`** when moving a **folder** (not just bookmarks) in bookmark select mode: after the gesture module split, `_isDescendant` lived in `bookmark-gestures.js` but was not exported, while `bookmark.js`’s `_moveSelectedToFolder` still called it for circular-drop checks.
> 
> **`_isDescendant`** is now exported from `bookmark-gestures.js` and imported in `bookmark.js` alongside the other gesture helpers.
> 
> Adds e2e **`test_move_folder_into_folder`**: select a folder, move it into another folder, assert the tree updates and **`pageerror` is empty**—covering the folder branch that bookmark-only move tests missed.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 2b84494fa8f3a8c077275de21ddbeb134ce93acf. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
