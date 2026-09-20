---
date: 2026-06-08
pr: 224
branch: refactor/adr-034-tab-indicator
title: "refactor: 탭 인디케이터를 tabbar.js로 병합 (ADR-034 PR3)"
---

# refactor: 탭 인디케이터를 tabbar.js로 병합 (ADR-034 PR3)

## 무엇을

ADR-034 PR3. 탭 바 로직을 한 모듈로 일원화합니다 — `views-routing.js`에 흩어져 있던 탭 활성 상태 + 슬라이딩 인디케이터를 `js/app/tabbar.js`로 이동.

- 이동: `syncTabBarActive`(활성 탭 하이라이트·aria-current) + `positionTabIndicator`(슬라이딩 인디케이터) + 상태(`_prevTabIndic`/`_curTabActive`/`_tabIndicMQL`) + 리사이즈·orientationchange·transitionend 리스너
- `views-routing.js` **1,942 → 1,831줄**

## 왜 facade인가 (결합 처리)

`route()`(views-routing)가 매 내비마다 `syncTabBarActive`를 호출하는데, **tabbar.js는 이미 `W.route`/`W.navigate`/`W.parsePath`로 views-routing을 역호출**합니다 — 즉 tabbar ↔ views-routing은 의존 **순환**입니다. ADR-034 원칙대로 순환 seam은 명시 import로 강제하지 않고 **`window.syncTabBarActive?.()` facade를 유지**합니다(2-way import 사이클 회피). 이 registry/이벤트 역전은 PR5(라우팅)에서 다룹니다.

- tabbar.js의 기존 `$searchBtn`(=`#tab-search`)·`exitSearch` 재사용, `$tabBar`만 신규
- `applyCollapsed`의 `W.syncTabIndicator` 호출은 이제 모듈 내부로 들어옴(reposition이 블록 스코프라 facade 유지)
- `types.d.ts`에 `syncTabBarActive` 선언 추가(+ 중복 `syncTabSearchQuery` 정리)

## 검증

- ✅ `tsc` main·worker — 0 error
- ✅ 유닛 `node --test` — **674/674**
- ✅ e2e `test_navigation` — 전체 통과 (route()→`window.syncTabBarActive` 매 내비 정상 실행)
- ⚠️ `test_tabbar` 7건 실패 — **사전 존재하던 `#search-input` 모핑 타임아웃**(baseline 8건의 부분집합, 동일 원인). 본 PR 미변경 영역, 새 회귀 0.

## ADR-034 진행

PR1·PR4·PR2·**PR3** 완료. 남은: **PR5(라우팅)** — `parsePath` 하향·registry 역전·`closeAllOverlays` 축약. + bookmark.js 후속.

> 1Password 서명 불가로 커밋 미서명(브랜치 보호는 서명 미요구).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Behavior-preserving module move with the same route()-time sync path; risk is mainly stale indicator layout if resize/transition hooks regress, not auth or data handling.
> 
> **Overview**
> **ADR-034 PR3** consolidates mobile tab-bar behavior in `js/app/tabbar.js` by moving tab active highlighting and the sliding indicator out of `views-routing.js`.
> 
> `syncTabBarActive`, `positionTabIndicator`, indicator state (`_prevTabIndic` / `_curTabActive`), and resize / orientation / `transitionend` listeners now live next to existing search morphing and scroll-collapse logic. **`views-routing.js` shrinks by ~111 lines** (~1,942 → ~1,831); `route()` still updates the bar on every navigation via **`window.syncTabBarActive?.()`** because `tabbar.js` already calls `route` / `navigate` / `parsePath` (facade avoids a direct import cycle per ADR-034).
> 
> Search tab highlighting reuses tabbar’s `$searchBtn` instead of a separate `$tabSearch` reference. **`js/types.d.ts`** documents `syncTabBarActive` on `Window` and drops a duplicate `syncTabSearchQuery` entry. **CLAUDE.md**, **architecture.md**, and **ADR-034** mark PR3 complete; no unit test file changes (no marker tests for this slice).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 35015dc3997150016de80e6fc8aae6c861e44f79. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
