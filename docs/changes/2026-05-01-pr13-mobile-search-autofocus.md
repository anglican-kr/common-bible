---
date: 2026-05-01
pr: 13
branch: claude/mobile-search-autofocus-wonhf
title: "fix: 모바일 검색 드로어 열릴 때 입력창 자동 포커스 및 키보드 노출"
---

# fix: 모바일 검색 드로어 열릴 때 입력창 자동 포커스 및 키보드 노출

iOS Safari는 사용자 제스처 컨텍스트 안에서 동기적으로 호출된 .focus()만
on-screen 키보드를 띄운다. requestAnimationFrame으로 감싸면 제스처
컨텍스트가 끊겨 키보드가 올라오지 않는 문제를 해결.

https://claude.ai/code/session_01QM2sQY1e2VFYEnpPMA8jr9

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: isolated to mobile search bottom-sheet focus/viewport handling, with minimal impact outside the overlay; main risk is device/browser-specific behavior differences around `visualViewport` events.
> 
> **Overview**
> Fixes mobile search bottom-sheet behavior so the on-screen keyboard reliably appears on iOS Safari by focusing the sheet input synchronously (instead of via `requestAnimationFrame`).
> 
> Adds `visualViewport`-based repositioning (`adjustSheetForKeyboard`) to lift the fixed-position sheet above the keyboard on resize/scroll, and cleans up the added styles and event listeners when the sheet closes.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6a3c94722a4223ab1bd5ad0876e0a6377296928c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
