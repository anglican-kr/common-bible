---
date: 2026-06-08
pr: 241
branch: refactor/bookmark-move-import
title: "refactor: 북마크 import 흐름을 bookmark-modals.js로 분리 (ADR-034 후속 PR5d)"
---

# refactor: 북마크 import 흐름을 bookmark-modals.js로 분리 (ADR-034 후속 PR5d)

## 무엇을

모달 분리 **마지막 단계(PR5d)**. import 전체 흐름 + IMPORT_EXPORT 순수 헬퍼를 `bookmark-modals.js`로 이동.

- 숨은 파일 입력 + 읽기/검증 + 병합/덮어쓰기 확인 모달 + `_validateImportData`/`_mergeBookmarkStores`/`_countBookmarks`
- ⋯ 메뉴 가져오기는 노출된 `openImportFilePicker()` 호출
- `bookmark.js` **2,393 → 2,260줄** · `bookmark-modals.js` 778 → 930줄
- 누적 `bookmark.js` 3,578 → **2,260줄 (−37%)**

## Escape 스택 완성
import 가 `closeTopmostModal` 에 합류 → 모듈이 모달 6종(new-folder·confirm·chapter-delete·merge·save·import)의 Escape 스택을 소유. bookmark.js 라우터는 `closeTopmostModal` 위임 + move(잔류) + drawer/select 만.

## 의도적으로 남긴 것 (branch 명과 달리 move 는 잔류)
- **move 모달** — `_bmSelected`·`_bmAncestorSelected` 등 select-mode 상태를 직접 읽는 select UI. 범용 modals 에 넣으면 select 내부를 DI 로 줄줄이 넘겨야 함 → bookmark.js 잔류. 후속 `bookmark-select.js` 분리 후보.
- **exportBookmarks** — 다이얼로그 없는 다운로드 액션이라 잔류.

## 검증
- ✅ tsc main·worker 0 · 유닛 678(IMPORT_EXPORT 테스트는 modals.js 소스에서 추출하도록 갱신) · **e2e 북마크 75건**(export/import 포함)
- ✅ **playwright 로드 검사 pageerror 0**

## 다음
모달 분리 시리즈 완료. 다음은 약속한 **죽은 facade 정리 PR**(잔재 window.close*Modal 등).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly a file move with the same merge/overwrite and storage behavior; risk is limited to wiring (Escape stack, DI rerender) rather than new import semantics.
> 
> **Overview**
> Completes **ADR-034 PR5d** by moving the bookmark **import** path out of `bookmark.js` into `bookmark-modals.js`, alongside the other modal flows.
> 
> The **IMPORT_EXPORT** helpers (`_validateImportData`, `_mergeBookmarkStores`, `_countBookmarks`), hidden file input, JSON read/validate, merge/overwrite confirmation overlay, and related listeners now live in modals. **`bookmark.js`** only calls exported **`openImportFilePicker()`** from the ⋯ **가져오기** menu; **`exportBookmarks`** stays in `bookmark.js` (download only). Import joins **`closeTopmostModal`**; document Escape handling checks **move** first, then delegates to modals (import no longer closed separately in `bookmark.js`). **`window.closeImportModal`** is registered from modals.
> 
> Unit tests load the **IMPORT_EXPORT** block from **`bookmark-modals.js`** instead of **`bookmark.js`**.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 75d800dcc6a2680b9d04f81e983292ef3f285706. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
