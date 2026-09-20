---
date: 2026-06-08
pr: 237
branch: refactor/bookmark-modals
title: "refactor: 북마크 confirm·chapter-delete 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5a)"
---

# refactor: 북마크 confirm·chapter-delete 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5a)

## 무엇을

모달 다이얼로그를 `bookmark-modals.js`로 빼는 **1단계(PR5a)**. `confirm`(범용 삭제 확인) + `chapter-delete`(장 북마크 토글-오프 피커)를 신규 모듈로 이동.

- `bookmark.js` **3,044 → 2,916줄** · `bookmark-modals.js` 신규 209줄
- 각 모달의 overlay·DOM ref·정적 리스너·Escape 우선순위를 모듈이 소유

## 의존성 주입 (이 시리즈의 핵심)
모달→렌더 양방향 고리를 **주입으로 차단**:
- bookmark.js 가 시작 시 `initBookmarkModals({ rerenderActiveBookmarkTree, refreshBookmarkHeaderBtn })` 로 콜백 주입
- 모달은 bookmark.js 를 import 하지 않음 → **순환 import 없음** → tsc 가 못 잡는 평가시점 깨짐(PR1 부류) **구조적 차단**

## Escape 스택
7개 모달이 우선순위 최상단 연속 블록이라, 모듈의 `closeTopmostModal()` 하나로 묶고 bookmark.js 라우터가 위임(`if (closeTopmostModal()) return;`). 단계마다 이 함수가 커지고 bookmark.js 로컬 체크가 줄어듦.

## 죽은 facade 발견
`route()` 가 쓰던 `window.close{Confirm,ChapterDelete}Modal` 은 `appOverlay.closeAllOverlays()`(ADR-034)로 **이미 대체된 잔재**(외부 호출 0건). 이번 PR은 행동 변화 0을 위해 보존하되 주석으로 명시 → **PR5 시리즈 후 dead-code 정리 PR**에서 일괄 제거 예정.

## 검증
- ✅ tsc main·worker 0 · 유닛 678 · e2e bookmark+folders+edit 21
- ✅ **playwright 로드 검사 pageerror 0** (모달 facade·rerender·bookmark 모두 로드)

## 다음
PR5b: save + newFolder + `_buildFolderCombobox`(폴더 피커 클러스터). PR5c: merge + move + import.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Structural refactor with dependency injection; bookmark delete paths unchanged and covered by existing tests. Load order and SW precache updated for the new module.
> 
> **Overview**
> **ADR-034 PR5a** pulls the generic **confirm** dialog and **chapter-delete** picker out of `bookmark.js` into new **`bookmark-modals.js`**, shrinking the main bookmark UI module while keeping behavior the same.
> 
> The new module owns overlay wiring (`createOverlay`), DOM refs, scrim/cancel listeners, and **`closeTopmostModal()`** for Escape (confirm before chapter-delete). **`bookmark.js`** still opens those flows but calls **`initBookmarkModals({ rerenderActiveBookmarkTree, refreshBookmarkHeaderBtn })`** once so post-delete UI refresh does not require importing `bookmark.js` back (avoids circular imports). The document Escape handler now delegates the top of the stack via **`closeTopmostModal()`** instead of inline checks.
> 
> **`index.html`** loads `bookmark-modals.js` before `bookmark.js`; **`sw.js`** precaches the new file. **`window.closeConfirmModal` / `closeChapterDeleteModal`** remain on the new module for compatibility (noted as likely dead after `closeAllOverlays`); further modals are planned in PR5b/c.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit c333867c7df322afc76af25cfc390f5a920b6464. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
