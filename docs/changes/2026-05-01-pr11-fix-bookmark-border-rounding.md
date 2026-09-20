---
date: 2026-05-01
pr: 11
branch: claude/fix-bookmark-border-rounding-InRzR
title: "style: 연속 절 강조·선택은 바깥쪽 모서리만 라운드 처리"
---

# style: 연속 절 강조·선택은 바깥쪽 모서리만 라운드 처리

## 요약

연속된 절을 북마크용으로 선택하거나, 검색·딥링크로 강조 표시할 때 절마다 `border-radius: 5px`이 적용돼 사이마다 둥근 모서리가 보이던 문제를 수정. 런(run)의 시작/끝 바깥쪽 모서리만 라운드를 유지하고, 안쪽 경계는 평평하게 이어 보이게 한다.

## 변경

- **북마크 절 선택 (`.verse-selected`)**
  - `verse-selected-join-prev` / `verse-selected-join-next` 클래스 추가 (`css/style.css`)
  - `updateVerseSelectionBoundaries()` 헬퍼 추가, 선택 토글 3개 지점(롱프레스 진입, 드래그 이동, 단순 탭)에서 호출 (`js/app.js`)
  - `exitVerseSelectMode()`에서 join 보조 클래스도 함께 정리

- **검색·딥링크 강조 (`.verse-highlight`)**
  - 동일한 join 클래스 쌍 추가
  - 강조는 동적 토글이 아니라 렌더 시점 1회 결정이므로, 렌더 루프 종료 직후 정적 패스로 `[data-vref]` 순회하며 join 클래스 부여

## 동작

- 단일 절 선택/강조: 변화 없음 (4모서리 라운드 유지)
- 비연속 구간(예: `1-3,5`): 각 런이 독립적으로 라운드 유지
- 연속 구간(예: `24-25`, `1-5`): 양 끝 바깥쪽 모서리만 라운드, 인접 경계는 평평

## 테스트

- [ ] 절 선택 모드에서 24, 25를 연속 선택해 안쪽 경계가 이어지는지 확인
- [ ] 단일 절만 선택했을 때 4모서리가 모두 라운드인지 확인
- [ ] 검색 결과에서 `…/john/5/24-25` 같은 다중 절 딥링크 진입 시 한 덩어리로 보이는지 확인
- [ ] `…/john/5/1-3,5` 같은 비연속 구간이 두 덩어리로 분리돼 보이는지 확인

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk visual/UI-only change: adds a few CSS classes and lightweight DOM class toggling to adjust border radii for adjacent verses; main risk is minor styling regressions in verse rendering/selection states.
> 
> **Overview**
> Consecutive verse *highlights* (from search/deep links) and *selections* (bookmark verse-select mode) now visually render as a single continuous block by flattening the inner border-radius between adjacent verses.
> 
> This introduces `*-join-prev`/`*-join-next` helper classes for both `.verse-highlight` and `.verse-selected` (with special handling for `.verse-poetry` vertical stacking), adds a post-render pass to mark adjacent highlighted verses, and adds `updateVerseSelectionBoundaries()` to keep selection join classes in sync during long-press, drag-select, and tap toggles (and cleans them up on exit).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b030aa6136acc03e939d257aa742a78e44f747cd. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
