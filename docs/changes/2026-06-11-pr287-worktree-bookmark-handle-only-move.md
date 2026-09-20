---
date: 2026-06-11
pr: 287
branch: worktree-bookmark-handle-only-move
title: "feat: 북마크 재정렬을 ≡ 핸들 전용으로 제한"
---

# feat: 북마크 재정렬을 ≡ 핸들 전용으로 제한

## 무엇을

북마크 화면에서 항목 재정렬(드래그) 진입을 **≡ 핸들 한 곳으로 통일**합니다. 이전엔 `직접 정렬(manual)`일 때 행 어디서나 재정렬이 시작됐습니다 — 터치 롱프레스(500ms), 데스크탑 마우스 즉시 드래그, 그리고 2026-06-07에 추가된 ≡ 핸들이 **나란히 공존**했습니다.

## 왜

- 스크롤하려고 길게 누르면 의도치 않게 드래그가 걸렸습니다.
- 명시적 어포던스(≡ 핸들)가 있는데도 본문 드래그가 공존해 "여기를 잡으면 이동"이라는 신호가 흐려졌습니다.
- Apple HIG의 **편집모드 재정렬 컨트롤(≡)** 패턴은 본래 핸들 전용입니다. 이번 변경이 그 패턴으로 정렬을 통일합니다. (이전 상태가 두 패턴을 섞은 비표준 혼합이었음)

## 변경

- `js/app/bookmark-gestures.js` — `_setupDragHandle`에서 롱프레스 타이머(`LONG_PRESS_MS`)·마우스 본문 즉시 드래그 분기 제거. 핸들 밖 포인터는 스와이프 분류를 제외하면 모두 스크롤/클릭에 양보(`abort`). 핸들 분기(`onHandle`)는 그대로 — 터치·마우스 공통 즉시 드래그. `moveBookmarkItem`·드롭 지시자·스와이프 로직은 불변.
- `tests/e2e/test_bookmark_swipe.py` — `test_longpress_starts_drag` → `test_longpress_does_not_start_drag`(롱프레스가 드래그 시작 안 함)로 교체, `test_handle_drag_starts_reorder`(핸들에서 즉시 드래그 진입) 신설.
- `docs/decisions/010-bookmark-feature.md` — 개정(2026-06-11) 블록 추가.

## 검증

- `tsc` 통과
- 유닛 **728 전건 통과**
- swipe e2e **9건 통과**(교체·신설 포함), dnd·folders·bookmark e2e 동반 통과
- 실 포인터 스모크: 행 본문 드래그 → 재정렬 **안 됨**, ≡ 핸들 드래그 → 재정렬 **됨**, 콘솔 오류 0

> CSS의 `.bm-drag-handle`는 이미 44px 터치 타깃·`touch-action:none`으로 준비돼 있어 손대지 않았습니다.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 제스처 분기 변경으로 모바일 스크롤·재정렬 UX가 바뀌지만, 드롭·스와이프·저장 로직은 유지되고 e2e로 핸들/롱프레스를 검증합니다.
> 
> **Overview**
> **북마크 재정렬 진입을 ≡ 핸들로만 제한**합니다. `직접 정렬(manual)`일 때 행 본문에서 시작하던 **500ms 롱프레스 드래그**와 **데스크탑 마우스 본문 즉시 드래그**를 `_setupDragHandle`에서 제거해, 스크롤·탭 시 의도치 않은 재정렬을 막습니다.
> 
> **≡ 핸들**에서 시작한 포인터만 기존처럼 이동 즉시 드래그하고, 그 외 행 본문은 스와이프 분류 후 스크롤/클릭에 양보(`abort`)합니다. `moveBookmarkItem`, 드롭 지시자, 스와이프 로직은 그대로입니다.
> 
> `docs/decisions/010-bookmark-feature.md`에 ADR-010 개정(2026-06-11)을 추가했고, e2e는 롱프레스가 드래그를 시작하지 않음을 검증하도록 바꾸고 핸들 드래그 재정렬 테스트를 추가했습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6ac615ea7bd33ac8a5aaa34d959427a05d369ac1. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
