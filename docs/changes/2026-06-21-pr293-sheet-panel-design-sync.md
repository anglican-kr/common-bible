---
date: 2026-06-21
pr: 293
branch: docs/sheet-panel-design-sync
title: "docs: 시트·사이드 패널 디자인을 코드 구현과 정합"
---

# docs: 시트·사이드 패널 디자인을 코드 구현과 정합

## 배경

DESIGN.md 와 ADR-022·025 의 시트/드로어 서술이 현행 코드 구현과 어긋나 있어 정합시킨다. (ADR-036 전례력 작업과 무관한 문서 정리라 별도 브랜치로 분리)

## 변경 내용

- **DESIGN.md §5·§6** — 인용 시트(`#cite-sheet`)·북마크 드로어(`#bookmark-drawer`)·검색 책 범위 picker(`.book-filter-sheet`) 세 표면이 같은 패턴 공유함을 명시. 모바일·터치는 바텀 시트, **`pointer: fine` + ≥769px 에서만** 우측 사이드 패널로 전환 — 전환 기준은 폭 단독이 아니라 폭 + 포인터 종류.
- **ADR-022** — "데스크탑은 동일 시트가 적당한 폭으로 표시" 서술을 현행 우측 사이드 패널 구현으로 개정 (코드 정합 블록).
- **ADR-025** — 작성 시점 "검색 시트·북마크 드로어·인용 시트 = frosted glass" 서술 개정. 현재 세 시트는 솔리드 `var(--bg)`, frosted glass 는 플로팅 dock·검색 스크림에만 적용. 본 ADR 의 헤더 솔리드 + 스크롤 elevation 결정 자체는 유효.
- **CLAUDE.md** — 저장소 토폴로지 표 정렬 정리(내용 변경 없음).

## 테스트

문서 전용 변경 — 코드·테스트 영향 없음.

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Markdown and ADR text only; no runtime, test, or deployment impact.
> 
> **Overview**
> Documentation-only PR that **updates** `DESIGN.md`, **ADR-022**, and **ADR-025** so they match current UI behavior—no application code changes.
> 
> **`DESIGN.md` §5–§6** now documents that `#cite-sheet`, `#bookmark-drawer`, and `.book-filter-sheet` share one pattern: bottom sheets on mobile/touch, and a **right slide-in panel** only when **`pointer: fine` and ≥769px** (coarse pointer at wide widths keeps the bottom sheet). Elevation copy ties `--shadow-sheet` / `--shadow-drawer` to those three surfaces.
> 
> **ADR-022** replaces the outdated “desktop centered sheet” wording with the right side panel, shared animations, and pointers to ADR-032/033.
> 
> **ADR-025** adds a revision noting cite/bookmark/book-filter panels are **solid `var(--bg)`**, not frosted glass; glass remains on floating docks and the search scrim. Header scroll elevation decision is unchanged.
> 
> **`CLAUDE.md`** only reformats the repo topology table (no semantic change).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit cd79e80775f7912a54e3669c06ebea9a6d54a2cd. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
