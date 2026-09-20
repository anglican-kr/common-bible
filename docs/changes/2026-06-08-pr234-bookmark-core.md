---
date: 2026-06-08
pr: 234
branch: refactor/bookmark-core
title: "refactor: 북마크 href/공유·정렬 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR2)"
---

# refactor: 북마크 href/공유·정렬 헬퍼를 bookmark-core.js로 분리 (ADR-034 후속 PR2)

## 무엇을

`bookmark.js`의 **`BOOKMARK_HREF` + `BOOKMARK_SORT` 블록**(href/share 빌더 + per-device 정렬·최근열람 헬퍼, localStorage 기반)을 `js/app/bookmark-core.js`(leaf)로 분리.

- `bookmark.js` **3,364 → 3,235줄**

## 왜 깔끔한가
이 함수들은 **전부 bookmark 내부 전용** — 외부 모듈 호출 0, `window` facade·`appBookmark` aggregate·`export {}` 등장 0. 그래서 단순 import-only 이동이고, 지난 PR1에서 겪은 "export {정의안된이름}" 버그 위험이 없음.
- export: bookmark이 쓰는 7개(`_bookmarkHref`·`_buildSharePayload`·`getBookmarkSort`·`setBookmarkSort`·`markBookmarkViewed`·`_forgetViewed`·`sortBookmarkNodes`)
- core 내부 유지: `_loadViewedMap`·`_nodeTitle`·`_bookmarkComparator`·`SITE_BASE`

## 테스트
`bookmark.test.js`의 `BOOKMARK_HREF`/`SORT` 슬라이스를 bookmark-core.js로(ACTIVE 로더는 core의 HREF + bookmark의 ACTIVE 연결 — ACTIVE는 다음 단계).

## 검증
- ✅ tsc 0 · 유닛 678 · e2e bookmark 17
- ✅ **playwright 로드 검사 pageerror 0** (PR1의 export 버그 재발 방지 표준 검사)

## 다음
PR3: `BOOKMARK_QUERY`, PR4: `BOOKMARK_ACTIVE`(`_renderPathname` setter 배선) → bookmark-core.js로.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mechanical move with imports and test loader updates only; bookmark behavior and external APIs are unchanged.
> 
> **Overview**
> **ADR-034 follow-up (PR2):** Pure bookmark **href/share** and **sort / last-viewed** logic moves out of `bookmark.js` into a new leaf module `js/app/bookmark-core.js` (`BOOKMARK_HREF` + `BOOKMARK_SORT` marker blocks unchanged in behavior).
> 
> `bookmark.js` **imports** those seven symbols and drops ~130 lines of inlined code; there is **no** new `window` facade or public API surface—still bookmark-internal only.
> 
> **Load order / offline:** `index.html` loads `bookmark-core.js` **before** `bookmark.js`; `sw.js` precaches the new file so the PWA shell stays consistent.
> 
> **Tests:** `tests/unit/bookmark.test.js` slices `BOOKMARK_HREF` / `BOOKMARK_SORT` from `bookmark-core.js` (ACTIVE loader still concatenates core HREF + bookmark ACTIVE).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 1d9f128e6a73bb0908e93a5cfb610d335839a86e. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
