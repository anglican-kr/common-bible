---
date: 2026-06-08
pr: 227
branch: refactor/adr-034-close-overlays
title: "refactor: route() 오버레이 teardown을 closeAllOverlays로 축약 (ADR-034 PR5b)"
---

# refactor: route() 오버레이 teardown을 closeAllOverlays로 축약 (ADR-034 PR5b)

## 무엇을

`route()` 가 내비게이션마다 14개 오버레이(12 `closeIfOpen` + settings/chapter popover)를 **id + 모듈별 close fn 으로 일일이 닫던 ~42줄 블록**을, 오버레이 컨트롤러의 `closeAllOverlays()` **한 호출**로 축약합니다.

- `js/app/overlay.js` — `createOverlay` 가 모든 인스턴스를 registry에 등록. `closeAllOverlays()` 는 **열린 것만** `controller.close()`(scrim·inert·focus trap·onClose·focus 복원 전체 unwind) + panel 강제 hidden. per-open 재생성 오버레이(chapter picker·settings popover)의 **detached panel 은 prune** 해 registry를 bounded 유지.
- `js/app/routing.js` — closeIfOpen 블록 → `window.appOverlay.closeAllOverlays()`.

## 왜 안전한가

route()가 부르던 close 함수들(closeBookmarkDrawer·closeSaveModal·closeCiteSheet 등)은 **전부 순수 `overlay.close()` 래퍼**이고, 추가 정리(예: cite-sheet `_sheetState` 리셋)는 `createOverlay` 의 `onClose` 콜백에 있어 `controller.close()` 가 자동 실행합니다 → **동작 동등**. 14개 오버레이가 모두 createOverlay 관리임을 확인했습니다.

## 결합 감소

routing.js(오케스트레이터)가 6개 모듈(citations·install·bookmark·search·settings·views-routing)의 close fn 14개를 하드코딩 참조하던 것을 제거. 오버레이 추가/제거 시 route()를 건드릴 필요 없음.

## 검증

- ✅ `tsc` main·worker — 0 error
- ✅ 유닛 `node --test` — **674/674**
- ✅ e2e `test_cite_sheet` + `test_navigation` + `test_search` + `test_bookmark`(+folders) — **45 통과** (오버레이 내비 dismiss·드로어·9개 모달·book-filter sheet 정상)

## ADR-034 진행

PR1·PR4·PR2·PR3·PR5a·**PR5b** 완료 → `views-routing.js` 2,389 → 1,354줄(−43%). 남은 **PR5c(registerView 역전)는 비용>효용으로 보류 권장**(상세 [`docs/known-issues.md`](docs/known-issues.md)) — 얕으면 marginal, 깊으면 high-risk, PR5a에서 import 사이클은 이미 없음.

🤖 Generated with [Claude Code](https://claude.com/claude-code)


<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Changes navigation-time overlay teardown for every modal, drawer, and sheet; behavior is intended to be equivalent but mid-animation dismiss and registry pruning are subtle UX paths now covered by new unit tests.
> 
> **Overview**
> **ADR-034 PR5b** replaces `route()`’s per-overlay teardown (~14 `closeIfOpen` calls plus settings/chapter popover handling) with a single **`window.appOverlay.closeAllOverlays()`** call.
> 
> `overlay.js` now keeps a **registry** of every `createOverlay` instance. On navigation, `closeAllOverlays()` runs full `controller.close()` for open overlays, **force-hides** panels still visible during animated dismiss (`closeTransition`), and **prunes** detached DOM nodes so rebuilt overlays (e.g. chapter picker) do not grow the list unbounded.
> 
> `routing.js` no longer hardcodes close functions from citations, install, bookmark, search, settings, or views modules. Types and **unit tests** cover multi-overlay close, mid-dismiss navigation, and detached-panel pruning. Docs mark PR5b complete and **defer PR5c (`registerView`)** as low value vs. risk.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit add06465b1378369d5f2acc7719c984011db2e73. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
