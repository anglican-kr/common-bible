---
date: 2026-06-08
pr: 236
branch: refactor/bookmark-active
title: "refactor: 북마크 active-route 강조 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR4)"
---

# refactor: 북마크 active-route 강조 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR4)

## 무엇을

`bookmark.js`의 **`BOOKMARK_ACTIVE` 블록**(현재 URL과 일치하는 북마크/폴더 자기 강조 술어)을 `bookmark-core.js`로 이동.

- `_renderPathname` 모듈 상태 + `_isActiveBookmark` + `_hasActiveDescendant`
- `bookmark.js` 3,064 → **3,044줄** · `bookmark-core.js` 339 → 370줄
- 누적 `bookmark.js` 3,578 → **3,044줄 (−15%)**

## setter 배선 (이번 단계의 핵심)
`_renderPathname` 은 UI(`renderBookmarkTree`)가 `window.location.pathname` 으로 set 하던 모듈 상태다. ESM import 는 읽기 전용 바인딩이라 UI에서 core 상태를 직접 대입할 수 없으므로:

- core 가 `_renderPathname` 을 소유 + **`setRenderPathname()` setter export**
- `renderBookmarkTree()` 가 `_renderPathname = …` → `setRenderPathname(…)` 로 호출
- 두 술어의 기본 인자(`= _renderPathname`)는 core 모듈 스코프에서 평가되므로 setter 가 갱신한 값을 그대로 읽음

## facade 정책
두 술어는 **기존부터 window facade 없는 순수 내부 함수**(types.d.ts 전역 선언 없음, 외부 호출 모듈 없음)였으므로 core 에서도 ESM export 만 두고 facade 는 두지 않음 — PR3 의 QUERY(전역 계약 보유)와 의도적으로 다름.

## 검증
- ✅ tsc main·worker 0 · 유닛 678 · e2e bookmark+folders 17
- ✅ **playwright 로드 검사 pageerror 0** (앱 렌더 #app 2102, 두 모듈 로드)

## 다음
이후 모달 묶음(save·merge·confirm·move·import/export, ~900줄) → `bookmark-modals.js`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Structural refactor with behavior preserved; highlight still depends on renderBookmarkTree calling setRenderPathname on each render.
> 
> **Overview**
> Continues **ADR-034** by moving the **`BOOKMARK_ACTIVE`** block out of `bookmark.js` into DOM-free **`bookmark-core.js`**: `_renderPathname`, `_isActiveBookmark`, `_hasActiveDescendant`, plus a new **`setRenderPathname()`** export so the UI can update core state (ESM imports are read-only).
> 
> `renderBookmarkTree()` now calls **`setRenderPathname(window.location.pathname)`** instead of assigning `_renderPathname` locally. Active helpers stay **ESM-only** (no new `window` facade). Unit tests load **`BOOKMARK_ACTIVE`** from `bookmark-core.js` (still after **`BOOKMARK_HREF`** in the vm slice).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 5e1359eda3c9de005568d6a81fd5c6dd492bdc4e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
