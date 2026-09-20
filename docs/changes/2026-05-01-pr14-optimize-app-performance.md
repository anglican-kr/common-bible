---
date: 2026-05-01
pr: 14
branch: claude/optimize-app-performance-LyZQT
title: "perf: 앱 시작 시 임계 작업 축소 및 메모리 사용 절감"
---

# perf: 앱 시작 시 임계 작업 축소 및 메모리 사용 절감

- 기본(navy) 색상 테마에서는 favicon/apple-touch-icon 캔버스 재채색을
  건너뜀. 매 실행마다 발생하던 ~1MB ImageData 할당 + base64 인코딩 제거.
- 비기본 테마에서도 재채색을 requestIdleCallback로 지연시키고,
  decoded ImageData 캐시(_origIconData)를 제거해 유휴 메모리 절감.
- search-sheet/bookmark-drawer 드래그 핸들 IIFE를 deferred 초기화로
  전환. 첫 페인트 시점에 사용자가 접근할 수 없는 표면이라 안전.
- service worker 등록과 install nudge를 DOMContentLoaded 이후의
  idle 콜백으로 이동해 첫 페인트 경로에서 분리.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Mostly performance-focused changes, but it alters startup ordering and service worker registration timing, which could affect update/install prompts and icon/theme state if regressions occur.
> 
> **Overview**
> **Improves startup performance and memory use** by skipping the favicon/apple-touch-icon canvas recolor path for the default `navy` scheme (restoring shipped icon URLs instead), and by dropping decoded icon `ImageData` caching.
> 
> For non-default schemes, icon recoloring is now deferred via `requestIdleCallback` and guarded with a generation counter to cancel stale async updates when users switch schemes quickly.
> 
> Moves additional work off the launch critical path by deferring sheet/drawer drag-handle listener setup, `registerServiceWorker()` execution, and `maybeShowInstallNudge()` until after the initial `route()` completes and the browser is idle.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 21540a01c262cbe38aa8e181dbb37b062cbe897f. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
