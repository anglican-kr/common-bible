---
date: 2026-05-01
pr: 10
branch: claude/fix-font-loading-issue-i1iDW
title: "fix: 폰트 display=optional → swap, 캐시 미적중 시 시스템 폰트 락인 해결"
---

# fix: 폰트 display=optional → swap, 캐시 미적중 시 시스템 폰트 락인 해결

display=optional은 폰트 다운로드가 100ms 내 완료되지 않으면 현재 세션
동안 시스템 폰트로 락인되어, 앱 업데이트(CACHE_NAME 변경) 또는 사이트
데이터 초기화 직후 첫 실행 시 지정 폰트가 적용되지 않고 종료·재실행해야
보이는 회귀를 일으킴. launch-screen 오버레이가 이미 폰트 다운로드 구간을
가리므로 swap 사용 시 FOUT 노출 없이 도착 즉시 본문에 적용됨.

ADR-007 § 렌더 블로킹 리소스 비동기화에 트레이드오프 명시.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Changes font loading strategy and the timing of `dismissLaunchScreen()`, which can affect first paint/transition behavior on slow networks and across browsers (Font Loading API availability).
> 
> **Overview**
> Switches Google Fonts from `display=optional` to `display=swap` (keeping the existing `preload` + stylesheet pattern) to prevent cold-cache sessions from locking into system fonts.
> 
> Updates `dismissLaunchScreen()` to wait for `document.fonts.ready` (with a 1500ms timeout) before starting the launch-screen fade-out, reducing the chance of a visible late font swap after the overlay disappears, and documents these tradeoffs/decisions in ADR-007.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 44955dc31d521ef65b2523f5ca6702fda3bd0b34. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
