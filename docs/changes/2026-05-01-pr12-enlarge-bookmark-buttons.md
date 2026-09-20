---
date: 2026-05-01
pr: 12
branch: claude/enlarge-bookmark-buttons-1gDJe
title: "style: 북마크 드로어 툴바 버튼 크기 확대 및 행 높이 정렬"
---

# style: 북마크 드로어 툴바 버튼 크기 확대 및 행 높이 정렬

오디오 플레이어 행과 동일한 높이가 되도록 툴바 패딩을 조정하고,
버튼은 2.2rem → 2.4rem, 아이콘은 22 → 24로 키워 가독성 개선.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Pure UI/CSS tweaks to bookmark drawer toolbar sizing (padding/button/icon dimensions) with no logic changes; low risk aside from minor layout regressions on small screens/safe-area devices.
> 
> **Overview**
> Adjusts the bookmark drawer toolbar sizing to better align with the audio bar row height by updating `#bookmark-drawer-toolbar` padding (including safe-area bottom inset).
> 
> Increases bookmark toolbar button hit-targets (`.bm-toolbar-btn` 2.2rem → 2.4rem) and updates the toolbar SVG icon sizes in `index.html` from 22px to 24px for improved legibility.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit bfae26102f60b9b8e6df0572f87206b122e5af1c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
