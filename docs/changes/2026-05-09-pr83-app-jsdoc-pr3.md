---
date: 2026-05-09
pr: 83
branch: feat/app-jsdoc-pr3
title: "chore: app.js JSDoc 도입 PR-3 — 절 스펙·북마크·드래그·렌더링·Views (ADR-012 2차)"
---

# chore: app.js JSDoc 도입 PR-3 — 절 스펙·북마크·드래그·렌더링·Views (ADR-012 2차)

## Summary

ADR-012 2차 적용 7단계 분할의 **3번째 PR**. PR-2([#82](https://github.com/anglican-kr/common-bible/pull/82)) 머지 후 라인 기준 **L1280-L2630** — 절 스펙 유틸, 북마크 쿼리, 드래그앤드롭, 데이터 페칭, 렌더링 헬퍼, Views.

가장 큰 단일 PR (~1,330줄). PR-2가 `el()` generic narrow로 노출했던 PR-3 영역 22건 잠재 결함 모두 해소.

- `js/types.d.ts` 확장
  - 5종 추가: `BookEntry`, `BooksData`, `BibleChapter`, `BibleVerse`, `BiblePrologue`
  - `window.booksPromise` 글로벌 선언 (pre-fetch.js와 app.js 간 핸드오프 타입화)
  - `ReadingPosition.chapter` 를 `number \| \"prologue\"` 로 narrow (Sirach 머리말 케이스, ADR-002)
- `js/app.js` JSDoc + 타입 가드
  - **e.target 가드 패턴**: article click/pointerdown, popover document/popover click 핸들러에 `e.target instanceof Element/Node` 가드 (5곳)
  - **HTMLElement cast**: `closest(\"[data-id]\")` 두 곳, `popover.querySelector('a[href]')` 두 곳
  - **null 가드**: copy 핸들러의 `lastVerse`/`e.clipboardData`, `parseInt(getAttribute(...) ?? \"\", 10)` 두 곳, `work.textContent ?? \"\"`
  - **시그니처 JSDoc**: Verse spec utilities 5개, Bookmark query helpers 7개, Data fetching 4개, 일부 Rendering helpers
  - `_findItemInStore`/`moveBookmarkItem`에서 `BookmarkTreeFolder.children` narrow (`it.type === \"folder\"` 변수 narrow)
- `tsconfig.app.json` include 확장
  - `BookmarkTreeNode` 글로벌 typedef는 store-v2.js에 이미 있고 TS는 type alias 머지가 없음(`Duplicate identifier`). app.js에서 같은 이름을 다시 typedef하지 않고, store-v2의 글로벌 alias를 그대로 참조하도록 `include`를 `js/**/*.js`로 확장. 사용자 의견대로 이름을 통일(=`BookmarkTreeNode` 그대로) — alias 두 개 운영(`BmNode`)은 회피
  - `noImplicitAny: false`는 PR-7까지 유지

## 알려진 부작용 (의도된 노출)

새 시그니처 narrow 효과로 PR-4+ 영역에 잠재 결함 ~8건 추가 노출. 후속 PR에서 자연스럽게 흡수.

## Test plan

- [x] \`npx tsc -p tsconfig.app.json --noEmit\` — baseline 294 → 잔여 280 (PR-3 영역 L1280-L2630 **0 error**)
- [x] \`npx tsc -p tsconfig.json --noEmit\` — 0 error (회귀 없음, BookmarkTreeNode 글로벌 단일화 후)
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` — 0 error
- [x] \`node --test tests/unit/*.test.js\` — 111/111 pass
- [ ] e2e 회귀는 PR-7 머지 후 일괄 (CLAUDE.md 표준 — 코드 동작 변경 없음)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Primarily adds JSDoc typing and defensive null/instance guards; functional impact should be limited to safer no-op behavior in a few edge cases (e.g., missing `dataset.id`/`clipboardData`).
> 
> **Overview**
> Continues the staged `app.js` TypeScript migration (PR-3 scope) by adding new domain types (`BookEntry`/`BooksData`/`BibleChapter`/`BibleVerse`/`BiblePrologue`), typing `window.booksPromise`, and widening `ReadingPosition.chapter` to `number | "prologue"`.
> 
> Updates `app.js` with JSDoc signatures plus stricter null/instance narrowing around DOM/event handling (e.g., `e.target` guards, `closest()`/`querySelector()` casts, `getAttribute()`/`textContent` fallbacks), and tightens bookmark drag/drop mutations to only treat targets as folders when `type === "folder"`.
> 
> Adjusts `tsconfig.app.json` `include` to `js/**/*.js` so `app.js` can reuse the existing file-global `BookmarkTreeNode` typedef from `js/sync/store-v2.js` during temporary `checkJs` validation.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit f9ec88fd286f50f766eb511f0c708d220d39bc2a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
