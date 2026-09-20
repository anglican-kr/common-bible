---
date: 2026-05-02
pr: 17
branch: claude/hide-player-bookmark-mode-6WM3J
title: "style: 절 선택 모드에서 오디오 플레이어 숨기기"
---

# style: 절 선택 모드에서 오디오 플레이어 숨기기

<!-- CURSOR_SUMMARY -->
> [!NOTE]
> **Low Risk**
> CSS-only change that conditionally hides `#audio-bar` and tweaks `#search-fab` positioning; low risk aside from potential layout regressions on small screens.
> 
> **Overview**
> When `body.verse-select-active` is enabled, the sticky `#audio-bar` is now hidden to reduce UI clutter during verse selection.
> 
> To avoid leaving the mobile search FAB unnecessarily elevated, the `#audio-bar ~ #search-fab` bottom offset is overridden in verse-select mode to use the normal lifted-by-nav positioning.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 431511ec5e424bab3d11f991f26a73ba4b8989f6. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
