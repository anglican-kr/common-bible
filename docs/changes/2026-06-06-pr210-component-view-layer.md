---
date: 2026-06-06
pr: 210
branch: refactor/component-view-layer
title: "refactor: 컴포넌트·뷰 층 모듈화 — 오버레이 생명주기 단일화 (ADR-032)"
---

# refactor: 컴포넌트·뷰 층 모듈화 — 오버레이 생명주기 단일화 (ADR-032)

## 요약

흩어져 있던 **오버레이 생명주기 코드의 복제**를 `el()` 위 얇은 무의존성 컴포넌트 층으로 단일화한다(ADR-032). 프레임워크 도입 없이 ADR-018(IIFE+window)·ADR-019(ESM)·ADR-012(`@ts-check`) 패턴 유지.

## 무엇이 바뀌나

- **단일 오버레이 컨트롤러** `js/app/overlay.js`(`window.appOverlay.createOverlay`) — 열기/닫기·scrim·`trapFocus`·Escape·`setInert`·포커스 복원을 한곳에 가둠. **모달 9종·드로어·인용 시트·팝오버 2종 = 12곳 전부** 손으로 짠 배관에서 이 컨트롤러로 이행.
- **중앙 Escape 일원화** — 팝오버는 app.js 코디네이터가 `window.close{Settings,ChapterPopover}`로 위임(직접 `hidden` 금지), 모달은 모듈별 스택 라우터가 컨트롤러 close 호출.
- **시트 팩토리** `attachSheetDrag`/`attachSheetResize` — 드로어·인용 시트가 공유하던 드래그/리사이즈 pointer 배관 통합(중복 ~105줄 제거).
- **비동기(애니메이션) dismiss** `closeTransition(panel, finalizeHide)` + 재열기 시퀀스 가드 — 드로어(슬라이드 out)·인용 시트(슬라이드 in/out)를 한 메커니즘으로. 부드러운 전환을 공용화(노트·캘린더 후속 시트 재사용 가능).
- **빈 상태 통일** `appHelpers.emptyState` + 단일 `.empty-state` 컴포넌트 — 북마크·검색 빈 상태를 같은 형식(Apple-Music 식 히어로)으로(DESIGN.md §6).
- **표현 빌더 일부 보류** — button/iconButton/리스트 행은 글리프·클래스·동작이 제각각이라 실질 중복이 없어 과추상화로 판단, 보류(ADR §3에 평가 결과 명문화).

## 버그 수정 (이행 중 발견·해결)

- 드로어 위 "새 폴더" 입력에서 Escape 가 드로어까지 닫던 누수(stopPropagation / 스택 라우터 편입).
- `route()` 내비게이션 시 새로 이행한 오버레이(install·drive-disconnect·새폴더·가져오기·병합·저장)가 안 닫혀 scrim/스크롤잠금이 새 화면에 남던 누락 → 전 오버레이 `closeIfOpen` 로 일반화.
- 인용 시트 렌더 경합 — 느린 fetch 도중 다른 칩을 열면 옛 렌더가 끼어들던 race 를 `_sheetRenderSeq` 토큰 + 분리 렌더 후 원자적 교체로 해결.

## 테스트

- 유닛 **644 통과**(신규 `overlay.test.js` 컨트롤러·시트·closeTransition 23 + `helpers.test.js` emptyState 3 등), `tsc` 0 error(양 설정).
- e2e: 오버레이·시트·팝오버·빈 상태·Escape 흐름 통과. 신규 `tests/e2e/test_cite_sheet.py`(인용 시트 e2e 공백 메움).
- 기존 무관 실패(swipe-delete, install nudge 타이밍, settings book-order/cache-clear)는 변경 전에도 동일함을 stash 로 확인 — dev 서버 환경 이슈.

## 참고

- **드로어는 사실상 데스크탑 전용** — 모바일은 헤더 모달 + `/bookmarks` 전체뷰. 바텀 시트 폼은 "데스크탑→창 축소" 폴백으로만 도달.
- 상세 결정·구현 내역·검토한 대안: `docs/decisions/032-component-view-layer.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Wide touch on modals, focus traps, Escape stacking, and navigation teardown; mitigated by unit/e2e coverage and controller-level sequencing for animated dismiss.
> 
> **Overview**
> Introduces **`js/app/overlay.js`** (`window.appOverlay.createOverlay`) and migrates **12 overlay surfaces** (bookmark modals/drawer, install modal, cite sheet, settings/chapter popovers, drive disconnect) off duplicated open/close, scrim, `trapFocus`, `setInert`, and focus-restore code.
> 
> **Escape and routing:** `app.js` closes popovers via `window.closeSettings` / `window.closeChapterPopover` instead of toggling `hidden`; bookmark modals keep a stacked Escape router with `closeOnEsc` off where needed. **`route()`** dismisses overlays through their controllers and **forces `panel.hidden`** when an animated `closeTransition` would otherwise leave a sheet visible over the next view.
> 
> **Sheets:** Shared **`attachSheetDrag` / `attachSheetResize`** for bookmark drawer and cite sheet; **`closeTransition`** drives slide in/out (`.cite-sheet-closing`, drawer `drawer-closing`). Cite sheet adds **`_sheetRenderSeq`** so slow fetches cannot overwrite a newer open.
> 
> **UI consistency:** **`appHelpers.emptyState`** plus a single **`.empty-state`** component replaces separate bookmark/search empty markup and CSS; **DESIGN.md** §6 and **ADR-032** document the decision. Types, SW shell precache, and unit/e2e tests (`overlay.test.js`, `test_cite_sheet.py`) accompany the change.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 21ecd07886250ff0c2cb1c2361fea2d5c7ea0402. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
