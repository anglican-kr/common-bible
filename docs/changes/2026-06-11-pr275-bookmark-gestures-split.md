---
date: 2026-06-11
pr: 275
branch: refactor/bookmark-gestures-split
title: "refactor: 북마크 제스처 엔진을 bookmark-gestures.js로 분리 (ADR-034 후속)"
---

# refactor: 북마크 제스처 엔진을 bookmark-gestures.js로 분리 (ADR-034 후속)

## 무엇을

bookmark.js(2,432줄)의 첫 후속 분할 라운드. 제스처 엔진을 신규 leaf 모듈 `js/app/bookmark-gestures.js`(541줄)로 추출.

- **드래그 reorder** — `DRAG_CORE`(moveBookmarkItem·_isDescendant) + 드롭 인디케이터
- **모바일 스와이프 액션 상태** — `SWIPED_ROW`(열린 행 추적 + 4개 mutator)
- **스와이프 릴리스 수학** — `SWIPE_GESTURE`(축 분류·플릭 속도·릴리스 결정, 순수 함수)
- **통합 포인터 핸들러** — `_setupDragHandle`(터치를 drag/swipe/scroll로 분기)

`bookmark.js` 2,432 → **1,952줄 (−20%)**.

## 설계

- **역방향 의존 2개를 의존성 주입으로 차단.** 핸들러가 오케스트레이터에게 필요로 하는 (a) reorder 후 재렌더, (b) 선택 모드 활성 여부 — 둘 다 `initBookmarkGestures({ rerenderTree, isSelectMode })`로 시작 시 주입. bookmark.js가 `_setupDragHandle`을 import하므로 제스처가 되받아 import하면 순환이 되는데, 주입으로 leaf 유지(의존: appStorage·bookmark-core만). `initBookmarkModals` 선례 그대로.
- **선택 상태(`_bmSelectMode`/`_bmSelected`)는 bookmark.js에 잔류.** SWIPED_ROW 마커 안에 끼어 있었으나 실제론 선택 모드 상태(제스처는 읽기만). 다음 라운드 `bookmark-select.js`가 소유 예정이라 이번엔 오케스트레이터에 두고 게터로만 노출.

## 테스트

마커 3블록(DRAG_CORE/SWIPED_ROW/SWIPE_GESTURE)이 새 파일로 이동 → `bookmark.test.js`의 세 로더가 `BOOKMARK_GESTURES_SOURCE`에서 슬라이스하도록 갱신, DRAG_CORE prelude의 재렌더 stub을 주입 훅 이름(`_rerenderTree`)으로 교체.

- ✅ tsc (main · worker)
- ✅ 유닛 728건
- ✅ Playwright 로드 스모크 (앱 부팅·제스처 파사드 연결·콘솔 에러 0)
- ✅ e2e `test_bookmark_dnd` + `test_bookmark_swipe` 14건

## 문서

- ADR-034에 `개정 (2026-06-11)` 블록 추가
- `known-issues.md` §2 bookmark 분할 항목을 실제 진행 상황으로 갱신 (남은 라운드: select → verse-select → 트리/메뉴)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 사용자 대면 포인터·DND·스와이프 동작이 모듈 경계로 이동했고 DI 누락 시 런타임에서만 드러날 수 있으나, 동작은 대체로 이동 위주이고 기존 마커·e2e 검증이 있다.
> 
> **Overview**
> ADR-034 후속으로 북마크 트리의 **제스처 엔진**을 신규 `bookmark-gestures.js`로 분리한다. 드래그 reorder(`DRAG_CORE`), 모바일 스와이프 액션 상태(`SWIPED_ROW`), 스와이프 릴리스 수학(`SWIPE_GESTURE`), 통합 포인터 핸들러(`_setupDragHandle`)가 `bookmark.js`에서 옮겨지고, 본체는 해당 API를 import해 트리 빌더·드로어는 그대로 연결한다.
> 
> **순환 import 방지:** `initBookmarkGestures({ rerenderTree, isSelectMode })`로 reorder 후 재렌더와 다중 선택 모드 여부만 주입한다(`initBookmarkModals`와 동일). `_bmSelectMode` / `_bmSelected`는 다음 `bookmark-select.js` 라운드까지 **오케스트레이터에 유지**하고, 제스처는 `isSelectMode`로만 읽는다.
> 
> **테스트·문서:** `bookmark.test.js`의 DRAG/SWIPE 로더가 `BOOKMARK_GESTURES_SOURCE`에서 마커 슬라이스하도록 바꾸고, DRAG prelude stub은 `_rerenderTree`로 맞춘다. ADR-034 개정(2026-06-11)과 `known-issues.md` §2에 진행 상황을 반영한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 3713265f930bf0c03a770ffc0d4147540eebef44. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
