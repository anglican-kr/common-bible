---
date: 2026-05-02
pr: 16
branch: claude/fix-keyboard-background-visibility-357Sn
title: "fix: 검색 시트가 키보드 위 가시 영역을 가득 채우도록 수정"
---

# fix: 검색 시트가 키보드 위 가시 영역을 가득 채우도록 수정

iOS Safari에서 검색 바텀 시트를 열면 시트 하단과 키보드 사이로 본문이
비치는 문제가 있었음. visualViewport 기준으로 sheet의 height를 강제 지정해
가시 뷰포트를 가득 채우도록 변경.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk UI-only change affecting mobile `visualViewport` resize/scroll handling; potential minor regressions in sheet sizing/animation on edge browsers.
> 
> **Overview**
> Fixes mobile search bottom-sheet positioning when the on-screen keyboard is open by **forcing the sheet to fill the `visualViewport` height** (preventing body content from showing through the gap).
> 
> Also **disables the sheet’s height transition during `visualViewport` resize/scroll updates** to avoid a delayed/laggy animation, and ensures the transition/style overrides are reset on close.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 814ea15c11616055d275764f63505075abecce1c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
