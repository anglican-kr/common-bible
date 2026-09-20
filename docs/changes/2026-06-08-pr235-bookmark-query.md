---
date: 2026-06-08
pr: 235
branch: refactor/bookmark-query
title: "refactor: 북마크 query/tree 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR3)"
---

# refactor: 북마크 query/tree 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR3)

## 무엇을

`bookmark.js`의 **`BOOKMARK_QUERY` 블록**(트리 walk/find/insert/remove/folder-options + `findExistingChapterBookmarks` + select-mode 라벨 헬퍼)을 `bookmark-core.js`로 이동.

- `bookmark.js` **3,243 → 3,064줄** · `bookmark-core.js` 147 → 339줄
- 누적 `bookmark.js` 3,578 → **3,064줄 (−14%)**

## 결합 처리
- bookmark이 쓰는 11개 함수 import. `loadBookmarks`(appStorage) 의존은 core가 직접 import.
- QUERY 트리 헬퍼 7개의 **`window` facade 계약**(types.d.ts 전역 선언)을 bookmark-core가 그대로 소유(실호출 모듈 없으나 은닉 런타임 깨짐 방지).
- **3곳(window facade·appBookmark aggregate·`export {}`) 모두 정리** — PR1에서 겪은 `export{정의안된이름}` ESM 인스턴스화 실패 재발 방지.

## 검증
- ✅ tsc main·worker 0 · 유닛 678 · e2e bookmark 21
- ✅ **playwright 로드 검사 pageerror 0** (표준 검사)

## 다음
PR4: `BOOKMARK_ACTIVE`(`_renderPathname` setter 배선) → bookmark-core.js. 이후 모달 묶음 → `bookmark-modals.js`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 동작 동일한 모듈 분리와 facade 소유권 이동이며, 기존 유닛/e2e 검증으로 회귀 위험이 낮습니다.
> 
> **Overview**
> ADR-034 후속으로 **`bookmark.js`의 `BOOKMARK_QUERY` 블록**을 DOM 없는 **`bookmark-core.js`**로 옮깁니다. 트리 walk/find/insert/remove, `findExistingChapterBookmarks`, 선택 모드용 라벨 헬퍼(`_selectAllState`, `_deleteBtnLabel`, `_bmSelectCountLabel`, `_descendantIds`)가 core로 합쳐지고, **`loadBookmarks`는 core가 `window.appStorage`에서 직접** 가져옵니다.
> 
> **`bookmark.js`**는 위 11개 심볼을 core에서 import만 하고, **`window` / `appBookmark` / `export`에서 QUERY 관련 항목을 제거**해 ESM export 불일치를 막습니다. **레거시 전역 계약**(`types.d.ts`)을 위해 QUERY 트리 헬퍼 7개의 **`window` facade는 `bookmark-core.js`가 소유**합니다.
> 
> **`tests/unit/bookmark.test.js`**는 `BOOKMARK_QUERY`·DRAG 연동 슬라이스를 **`bookmark-core.js` 소스**에서 추출하도록 바꿉니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit e4cc1b632ee475cecb6a3f0424128e5b77066402. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
