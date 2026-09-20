---
date: 2026-05-02
pr: 15
branch: claude/fix-verse-numbers-bookmark-rAxay
title: "fix: 절 선택 모드에서 시편 절 번호가 사라지는 문제 수정"
---

# fix: 절 선택 모드에서 시편 절 번호가 사라지는 문제 수정

시편 등 poetry 본문은 .verse.verse-poetry의 padding-left:2rem과
.verse-num의 margin-left:-2rem로 만든 좌측 거터에 절 번호를 표시한다.
북마크/선택 모드의 body.verse-select-active .verse[data-vref] 규칙이
shorthand padding으로 padding-left를 0.15em으로 덮어써 거터가 사라지고
절 번호가 화면 밖으로 밀려나는 버그가 있었다.

poetry 절에 대해 padding-left:2rem을 명시적으로 복원해 거터를 유지한다.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk, CSS-only change scoped to verse selection mode styling; main risk is minor layout regression limited to poetry verse padding.
> 
> **Overview**
> Fixes a layout bug in verse selection mode where the generic `.verse[data-vref]` padding override collapsed the 2rem left gutter used by poetry verses and pushed verse numbers off-screen.
> 
> Adds a targeted rule for `.verse.verse-poetry[data-vref]` under `body.verse-select-active` to explicitly restore `padding-left: 2rem` (with an explanatory comment).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 0d1b1214b4a13801e6fe88d12691553ee3daa1c7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
