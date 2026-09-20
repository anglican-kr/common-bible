---
date: 2026-06-08
pr: 238
branch: worktree-route-guard
title: "fix: route() 모든 await continuation 에 _routeSeq 가드 적용 (ADR-031 후속)"
---

# fix: route() 모든 await continuation 에 _routeSeq 가드 적용 (ADR-031 후속)

## 배경

`route()`(js/app/routing.js)는 재진입형 async 함수다. 여러 `await` 뒤 continuation 이 `_routeSeq` 를 재확인하지 않고 공유 상태(`#app` 렌더 · `updatePageMeta` · `trackPageView` · 이어읽기 위치)를 변경하고 있었다 — 늦게 끝난 fetch 가 그 사이 사용자가 이동한 새 뷰를 덮어쓸 수 있는 경쟁 상태.

기존엔 검색 두 분기만 `parsePath().view !== "search"` 로 막혀 있었고, 읽기·북마크·설정·일반 목록 분기는 미가드였다. (Bugbot 이 PR #215 에서 검색 await 만 연달아 지적한 건 diff 만 검토하기 때문 — 같은 결함이 기존 분기에도 있었으나 diff 밖이라 미검출.)

## 변경

- `route()` 상단에 헬퍼 추가: `const isStale = () => routeSeq !== _routeSeq;`
- **모든 await 직후** `if (isStale()) return;` 적용:
  - 미가드였던 7곳: 검색 데스크탑 폴백 · 북마크 모바일/데스크탑 · 설정 데스크탑 · 공통 `loadBooks` · prologue · chapter
  - 검색 2곳: 기존 `parsePath().view` 체크를 `isStale()` 로 통일 (auto-nav 의 inner `route()` 가 `_routeSeq` 를 동기적으로 올리므로 동치이고, "진행 중 다른 검색어로 이동" 까지 더 넓게 잡음)
- `docs/decisions/031-tab-history-restore.md` §4 에 가드 확장 개정 노트 추가

## 검증

- `tsc --noEmit` 통과
- 유닛 테스트 678/678 통과 (`node --test tests/unit/*.test.js`)
- `node --check js/app/routing.js` 구문 OK
- 브라우저 e2e 는 미실시 — 가드의 본질이 경쟁 상태 방지라 결정적 재현이 어렵고, 동작 경로(정상 네비게이션)는 유닛+tsc 로 커버됨

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches the central SPA router and every major view path; the change is defensive early-returns with low regression risk if `isStale()` is placed correctly after each await.
> 
> **Overview**
> **ADR-031 follow-up:** stale-route protection now covers every `await` in `route()`, not just `finally` → `onRouteEnd`.
> 
> Adds `isStale()` (`routeSeq !== _routeSeq`) at the top of `route()` and **`if (isStale()) return;` immediately after each async step** — search (`renderSearchResults` / `renderSearchView`), book list loads, bookmarks, settings desktop fallback, shared `loadBooks`, prologue, and chapter fetches. That blocks late continuations from overwriting `#app`, `updatePageMeta`, `trackPageView`, overlays, and reading-position saves when the user navigates away or an inner `route()` (e.g. verse-ref auto-nav) bumps `_routeSeq`.
> 
> Search paths that used **`parsePath().view !== "search"`** now use **`isStale()`** for the same auto-nav case and for mid-search navigation to another query.
> 
> **`docs/decisions/031-tab-history-restore.md` §4** documents the expanded guard (2026-06-08 revision note).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 642442aec7df2d6cb42d71fb65535ada23de664c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
