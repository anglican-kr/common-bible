---
date: 2026-06-08
pr: 244
branch: docs/adr034-bookmark-split
title: "docs: ADR-034에 bookmark.js 분할 완료 반영 (개정 + 모듈 지도 + status)"
---

# docs: ADR-034에 bookmark.js 분할 완료 반영 (개정 + 모듈 지도 + status)

## 무엇을

ADR-034 모달 분리 시리즈(PR5a~5e + 정리, #237·#239·#240·#241·#242·#243) 완료에 맞춰 문서 3종 갱신.

- **ADR-034 개정 블록 추가** — 원래 "순수 로직/UI 2층" 스케치를 실제 결과로: 4모듈 분할, **모달↔렌더 순환을 의존성 주입으로 차단**(3 후보 중 채택 근거), move를 select-state DI 대신 **파라미터화**, `closeTopmostModal` 단일 Escape 스택, 정리 PR. 상태 줄도 갱신.
- **architecture.md §4 모듈 지도** — `bookmark-modals.js`·`bookmark-core.js`·`verse-spec.js` 행 추가 + `bookmark.js` 갱신(~2,200줄). brittle한 "9개" 카운트 제거.
- **status.md** — ADR-034 항목에 bookmark.js 분할 완료(3,578→2,198, −38%) 한 줄.

## 비고
architecture.md 표는 ADR-034 views-routing 산출물(audio-player·tabbar·overlay)이 아직 누락 — 이번 범위(bookmark) 밖이라 주석으로 후속 표시.

docs 전용(코드 변경 0).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation-only; no application code, auth, or deployment behavior changes.
> 
> **Overview**
> **Docs-only** — aligns architecture, ADR-034, and implementation status with the completed **bookmark.js** modularization (no runtime code in this PR).
> 
> **ADR-034** status now records views-routing PR1–5b done (PR5c deferred) and **bookmark split PR5a–5e + dead-code cleanup** done. A new **개정** section documents the real outcome: **four modules** (`bookmark.js`, `bookmark-modals.js`, `bookmark-core.js`, `verse-spec.js`), **DI** via `initBookmarkModals({ … })` to break modal↔render cycles, **`closeTopmostModal`** for Escape, **`openMoveModal({ excludeFolder, onPick })`** instead of select-state DI, and removal of unused `window.close*Modal` / QUERY facades.
> 
> **`architecture.md` §4** drops the brittle “9 modules” count, reframes `js/app/` as ADR-034 2차 분할, adds the three new bookmark modules, and narrows `bookmark.js` to UI-only (~2,200 lines). A comment notes **views-routing** spin-offs (`audio-player`, `tabbar`, `overlay`) are still missing from the table — follow-up.
> 
> **`status.md`** extends the ADR-034 bullet with bookmark **3,578 → 2,198 lines (−38%)** and a pointer to the ADR revision.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 09d51bb1c338d4344cb3fab9ae652a4d1d8a4ac7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
