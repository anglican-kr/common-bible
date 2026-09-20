---
date: 2026-06-08
pr: 228
branch: docs/pr5c-tradeoff
title: "docs: PR5c registerView 역전 트레이드오프 상세 (known-issues)"
---

# docs: PR5c registerView 역전 트레이드오프 상세 (known-issues)

`docs/known-issues.md` 의 PR5c 항목을 한 줄 → 상세 트레이드오프 분석(§2.1)으로 확장.

**핵심**: 구조적 import 사이클은 PR5a에서 이미 해소(window facade). registerView는 `search→routing` 21회 역방향이 본질적이라 **사이클을 못 끊음**. 얕은 registry=효용 0, 깊은 registry=검색 분기·중앙 오케스트레이션(meta/launch/`_routeSeq` 가드) 분산으로 high-risk. 효용은 로드맵 확장성뿐 → **Phase 2 라우트 추가 또는 설정 재구성에 얹어 진행** 권고 + 0-위험 사전 작업(route finalize 헬퍼 추출) 명시.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only change to known-issues; no runtime or routing code modified.
> 
> **Overview**
> **`docs/known-issues.md`** expands the ADR-034 **PR5c** line from a short “defer” note into **§2.1**, a structured tradeoff review dated 2026-06-08.
> 
> The doc now states that **structural import cycles are already gone** after PR5a (`window` facade), so `registerView` only addresses *logical* coupling—not cycles—and **cannot remove** the heavy **search→routing** reverse calls. It contrasts **shallow** registry (facade swap, ~no benefit) vs **deep** registry (full handler dispatch, high risk for search/meta/`_routeSeq`), and **defers** a standalone deep refactor as **YAGNI** for three complex views.
> 
> **Recommendations added:** do not do shallow registry; bundle deep registry with **Phase 2 prayer-book routes** or **settings UI rework**; and optionally extract a **zero-risk** `route()` finalize helper for `dismissLaunchScreen` / `updatePageMeta` / `trackPageView` before any registry work.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit a3e7811ef88797da9d6adc1b764cbc6d56d9dfca. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
