---
date: 2026-06-11
pr: 280
branch: refactor/bookmark-menu-split
title: "refactor: 북마크 ⋯ 메뉴를 bookmark-menu.js로 분리 (ADR-034 후속)"
---

# refactor: 북마크 ⋯ 메뉴를 bookmark-menu.js로 분리 (ADR-034 후속)

## 무엇을

bookmark.js 마지막 덩어리(트리 렌더링 + ⋯ 메뉴, ~930줄)를 **2개 PR로 분리**하는 첫 PR. 자족적인 ⋯ 메뉴를 먼저 신규 모듈 `js/app/bookmark-menu.js`(442줄)로 추출.

- ⋯ 더 보기 메뉴 (새 폴더·내보내기·가져오기·선택)
- 정렬 필드 + 오름/내림 순서 radio 그룹
- 🛈 북마크 추가 안내 팝오버
- 전체 선택 토글
- `exportBookmarks` (plain JSON 다운로드)

`bookmark.js` 1,546 → **1,145줄 (−26%)**.

## 설계 — 주입 훅 1개

메뉴가 오케스트레이터에서 필요로 하는 건 정렬 변경/새 폴더 후 트리 재렌더뿐 → `initBookmarkMenu({ rerenderTree })` 하나만 주입. 나머지는 전부 하향 import: bookmark-core(정렬 prefs) · bookmark-modals(새 폴더·가져오기) · bookmark-select(선택 진입·전체 선택). `renderBookmarksView`(아직 bookmark.js)가 `buildBmViewActions()`를 import해 title-row에 마운트.

**`exportBookmarks` → menu로 이동.** 메뉴 내보내기 + 드로어 `#bm-export-btn` 양쪽이 쓰는 leaf 유틸(orchestrator 의존 0). menu가 소유, bookmark.js가 `#bm-export-btn` 리스너용으로 역import(단방향, 무순환).

**`BOOKMARK_ADD_HELP` → bookmark-core로 이동.** 빈 상태 placeholder(트리)와 메뉴 🛈 팝오버가 공유하는 DOM-free 문자열 상수 → 중립 leaf core가 소유, 양쪽 import(다음 트리 라운드와도 호환).

**정리.** 무참조가 된 core import 3종(`setBookmarkSort`·`getBookmarkSortDir`·`setBookmarkSortDir`) + select `_bmToggleSelectAll` 제거.

## 테스트

마커 블록 없어 `bookmark.test.js` 무변경.

- ✅ tsc (main · worker)
- ✅ 유닛 728건
- ✅ Playwright 로드 스모크 (/bookmarks ⋯·🛈 버튼 렌더·콘솔 에러 0)
- ✅ e2e: select-delete(⋯ 메뉴 진입) + add-help(🛈) + **export-import(이동한 exportBookmarks 검증)** + bookmark + folders(정렬)
- ⚠️ 사전 실패 2건 `test_bookmark_folders.py` 폴더 토글 — base 동일, known-issues §1c

## 문서

- ADR-034에 `개정 (2026-06-11): bookmark-menu.js 분할 (마지막 라운드 1/2)` 블록
- `known-issues.md` §2 갱신 (남은 라운드: 트리 렌더링 `bookmark-tree.js`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 구조 리팩터링으로 동작은 이동·와이어링만 바뀌며, DI 패턴은 기존 gesture/select와 동일하고 e2e로 export·메뉴 경로가 검증된다.
> 
> **Overview**
> ADR-034 후속으로 북마크 탭 뷰 **⋯ 메뉴·title-row 액션**을 `bookmark.js`에서 신규 **`bookmark-menu.js`**(~442줄)로 분리해 본체를 **1,546 → 1,145줄**로 줄였다.
> 
> **`bookmark-menu.js`**는 `buildBmViewActions()`(⋯ 더 보기·정렬/순서 radio·🛈 안내·전체 선택)와 **`exportBookmarks`** JSON 다운로드를 담당한다. 정렬·새 폴더 후 트리 갱신만 필요하므로 **`initBookmarkMenu({ rerenderTree })`** 한 가지 DI로 `bookmark.js` 순환 import를 피한다.
> 
> **`BOOKMARK_ADD_HELP`**는 빈 목록·팝오버가 공유하는 문자열이라 **`bookmark-core.js`**로 옮겼고, 드로어 `#bm-export-btn`은 menu의 `exportBookmarks`를 역import한다. `bookmark.js`에서는 sort setter/dir import와 select의 `_bmToggleSelectAll` import를 정리했다.
> 
> 문서는 ADR-034·`known-issues.md` §2에 이번 라운드와 남은 **`bookmark-tree.js`** 분할을 반영했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ff2cf16f5b999d3b456fd0dbcc40bbc76bbf9971. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
