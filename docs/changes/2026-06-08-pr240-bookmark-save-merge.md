---
date: 2026-06-08
pr: 240
branch: refactor/bookmark-save-merge
title: "refactor: 북마크 save·merge 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5c)"
---

# refactor: 북마크 save·merge 모달을 bookmark-modals.js로 분리 (ADR-034 후속 PR5c)

## 무엇을

모달 분리 **3단계(PR5c)**. save/edit 모달 + merge 다이얼로그를 `bookmark-modals.js`로 이동.

- `openSaveModal`·`_showSaveModal`·`commitSaveBookmark` + `openMergeDialog`
- `bookmark.js` **2,659 → 2,393줄** · `bookmark-modals.js` 498 → 778줄
- 누적 `bookmark.js` 3,578 → **2,393줄 (−33%)**

## 함께 옮긴 이유 (상호 결합)
save↔merge 는 양방향 결합(`openSaveModal → openMergeDialog`, `merge "아니오" → _showSaveModal`)이라 분리하면 순환 import가 된다. 그래서 한 PR로 함께 이동. 콤보박스(PR5b)가 이미 모듈에 있어 save 의 폴더 picker 호출은 모듈 내부 호출.

## DI·Escape
- DI 에 `exitVerseSelectMode` 추가 — 절 저장·합치기 후 선택 모드 종료
- Escape 스택에 merge·save 를 `closeTopmostModal` 로 흡수. move/import 만 bookmark.js 잔류(PR5d). new-folder 외 모달은 상호 배타라 경계 너머 순서 무관(주석 명시)

## 곁다리 정리
이동으로 미사용이 된 import 제거: `collapseSegmentedVerses`·`mergeVerseSpecs`(verse-spec), `closeConfirmModal`·`closeChapterDeleteModal`(modals, PR5a 잔재). modals.js export 를 실제 호출 진입점으로 축소.

## 검증
- ✅ tsc main·worker 0 · 유닛 678 · **e2e 북마크 전체 75건**(save·merge·edit·folders·select·swipe·dnd·export/import·add-help)
- ✅ **playwright 로드 검사 pageerror 0**

## 다음
PR5d: move + import 모달 → 모달 분리 시리즈 완료. 이후 죽은 facade 정리 PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Large refactor of bookmark save/merge/persistence paths with no intended behavior change; regressions would affect bookmark storage and merge logic rather than security.
> 
> **Overview**
> **ADR-034 PR5c** moves the **save/edit bookmark modal** and **chapter merge dialog** out of `bookmark.js` into `bookmark-modals.js`, keeping them in one module because save and merge call each other (`openSaveModal` → merge, merge “no” → `_showSaveModal`).
> 
> `bookmark.js` now only imports `openSaveModal` and wires **`exitVerseSelectMode`** through `initBookmarkModals` so verse save/merge still exits selection mode. Save/merge DOM refs, overlays, scrim listeners, and **`commitSaveBookmark`** live in the modals module; tree/header refresh still goes through injected `_deps`.
> 
> **Escape** handling for merge and save is folded into **`closeTopmostModal`** (merge before save); `bookmark.js` no longer checks those modals on Escape. **`window.closeSaveModal` / `closeMergeModal`** remain on the modals side for routing cleanup.
> 
> Exports from `bookmark-modals.js` are narrowed to entry points (`openSaveModal` among them); unused imports are dropped from `bookmark.js` (`collapseSegmentedVerses`, `mergeVerseSpecs`). **Move/import modals** stay in `bookmark.js` for a follow-up PR.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit aecd2e58eac77255477de50ec8aceeb4647d6e61. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
