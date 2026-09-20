---
date: 2026-06-08
pr: 229
branch: docs/audio-edge-resolution
title: "docs: audio→parsePath edge 조사 결론 — 현 설계 유지 (known-issues)"
---

# docs: audio→parsePath edge 조사 결론 — 현 설계 유지 (known-issues)

`docs/known-issues.md` 의 audio `applyAudioShow → window.parsePath` 항목을 조사 후 "현 설계 유지"로 격하(§2.2 근거 추가).

없애려던 edge였으나 검토 결과 **facade가 정답**:
1. 명시 import → `routing → views-routing → audio-player → routing` **import 사이클**
2. `readingContext` 는 non-chapter 뷰에서 리셋 안 돼 **stale**(현재 장 ≠ 마지막 장)
3. `state-machine` 호출자(동기화 레이어)는 **라우트 컨텍스트를 못 줌**

`parsePath` 는 route()/navigate() 같은 오케스트레이션이 아니라 순수 URL 파싱 유틸 → audio가 facade로 읽는 건 양성 의존. **조치 없음.**

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only update to known-issues; no runtime or routing/audio code touched.
> 
> **Overview**
> **`docs/known-issues.md` only** — records the outcome of reviewing the audio `applyAudioShow` → `window.parsePath` facade (ADR-034 follow-up).
> 
> The open “임시 edge” item is **closed as “keep current design”**: strikethrough + status line in §2, with new **§2.2** documenting why removing the facade is rejected (import cycle via `routing → views-routing → audio-player`, stale `readingContext` on non-chapter views, `state-machine` callers lacking route context). **No code changes**; runtime behavior unchanged.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b2a803115074432f829a26ea07639dacb382ff46. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
