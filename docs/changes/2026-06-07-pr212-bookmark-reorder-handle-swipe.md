---
date: 2026-06-07
pr: 212
branch: feat/bookmark-reorder-handle-swipe
title: "feat: 북마크 행 스와이프 iOS 방향 + 재정렬 ≡ 핸들 + 탭 hit-test 버그 수정"
---

# feat: 북마크 행 스와이프 iOS 방향 + 재정렬 ≡ 핸들 + 탭 hit-test 버그 수정

## 요약

북마크 행 상호작용을 iOS/HIG 관례에 맞춰 다듬고, 발견된 탭 버그를 고친다. (#211 위 후속)

## 변경

- **fix — 스와이프 '삭제' 탭이 수정 동작을 부르던 버그**: 두 스와이프 액션(수정·삭제)이 `position:absolute; inset:0`로 겹쳐 깔려, DOM 상 뒤에 추가된 수정 버튼이 위에 올라가 삭제가 노출돼도 탭이 수정으로 갔다. 숨은 액션을 `pointer-events:none`, 노출된 방향만 `auto`로 차단(full-swipe 의 프로그램적 `.click()`은 무관).
- **feat — 스와이프 방향 iOS 관례로 교체**: 기존 ← 수정 / → 삭제는 iOS("왼쪽으로 밀어 삭제", Mail·메시지)와 반대였다. **← 삭제(trailing·빨강) / → 수정(leading)**으로 swap (JS 매핑 + CSS 엣지 앵커·슬라이드 방향).
- **feat — 재정렬 ≡ 핸들**: 롱프레스-드래그는 상시 어포던스가 없어 재정렬 가능함이 안 보였다. iOS 편집모드 재정렬 컨트롤(≡)을 본떠 각 행 trailing 에 핸들 추가 — **직접 정렬(manual) 모드일 때만 노출**(`bm-sortable` 토글), 핸들에서 **즉시 드래그**(롱프레스/스와이프 분류 생략, 터치·마우스 공통). 자동 정렬에선 숨김(재정렬도 비활성).

## HIG 근거

- 스와이프: trailing=파괴(삭제), leading=비파괴(수정)가 iOS 표준. full-swipe-left=삭제.
- 재정렬: 롱프레스-lift는 발견성이 낮음 → 편집모드 ≡ 핸들이 명시적 어포던스. manual 한정으로 "재정렬 가능 + 현재 직접정렬 모드"를 함께 신호.
- 상세는 ADR-010 개정 2026-06-07.

## 테스트

- `node --test` **650 pass**, `tsc --noEmit` **0 error**
- e2e **16 pass**: add_help(4) + bulk_delete(5) + swipe(7, 새 방향·노출 스트립 실 hit-test·설치 nudge 핀으로 견고화)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches mobile bookmark gesture logic and destructive delete via swipe; regression risk is mitigated by updated e2e hit-testing but behavior change affects all mobile list users.
> 
> **Overview**
> Mobile bookmark rows now follow **iOS swipe conventions**: swipe left reveals **delete** on the trailing edge, swipe right reveals **edit** on the leading edge. `bookmark.js` remaps gesture offsets, snap states, and full-swipe actions; mobile CSS aligns edge anchoring and slide directions.
> 
> **Fix:** Overlapping full-bleed swipe buttons no longer send taps to the wrong action—hidden overlays use `pointer-events: none`, and only the revealed action gets `pointer-events: auto`.
> 
> **Feat:** In **manual sort** mode, each row shows a trailing **≡** handle (`bm-sortable` on the tree, `_buildDragHandle`); drags from the handle start reorder immediately without long-press or swipe classification.
> 
> Docs (`ADR-010`, `ADR-029`, `CLAUDE.md`), `BOOKMARK_ADD_HELP` copy, and e2e swipe/add-help tests are updated (including install-nudge pinning for iPhone runs).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit c82a293f3b298fe21a179fd7e9daf7975525e24f. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
