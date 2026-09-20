---
date: 2026-06-03
pr: 181
branch: style/resume-banner-tab-color
title: "style: 이어읽기 배너 표면 카드화 + 배너·탭바·책목록 간격 8pt 통일"
---

# style: 이어읽기 배너 표면 카드화 + 배너·탭바·책목록 간격 8pt 통일

## 변경

책 목록 화면 상단(이어읽기 배너 → 구분 탭 → 책 목록)의 시각 정리.

### 1. 이어읽기 배너를 구분 탭과 같은 표면 카드로
솔리드 차콜(`--accent`) 배너를 바로 아래 구분 탭 스트립/칩과 같은 계열로 통일:
- 배경 `--accent` → `--bg-card`
- `--border` 테두리 + `--shadow-2`(다크 자동 보강) 추가 → "떠 있는 카드"
- 글자 크림 → 본문색 `--text`, 닫기(✕)는 보조색, 구분선·hover 도 테마 토큰화

### 2. 간격을 8pt 그리드 토큰으로 통일 (DESIGN.md §4)
배너↔탭바·탭바↔책목록·헤더↔탭바 간격이 제각각(0.8rem / 2rem)이던 것을 모두 **`--space-4`(16px)** 로 통일:
- `.resume-banner` margin-bottom: `0.8rem` → `--space-4`
- `.division-tabs` margin-top: `0.8rem` → `--space-4`
- 책 목록 뷰 `#app:has(.division-panel)` padding-top: `2rem` → `--space-4` (읽기 화면 padding 은 그대로)

세 간격이 정확히 동일해지고 8pt 그리드에 정렬됩니다. ad-hoc rem 값을 토큰으로 수렴 — ADR-028 "점진 치환" 방향과 일치.

## 검증
- CSS 전용, JS/DOM 무변경 → tsc·유닛 영향 없음
- dev 배포 확인 완료 (라이트/다크)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS-only presentation on the book-list header stack; no logic, routing, or data changes.
> 
> **Overview**
> The **이어읽기 (resume) banner** on the book-list screen is restyled from a solid `--accent` bar to the same **raised card** language as the 구분 (division) tabs: `--bg-card`, `--border`, and `--shadow-2`, with link/close colors moved to `--text` / `--text-secondary` and theme-token borders/hover instead of hard-coded white overlays.
> 
> **Vertical rhythm** on that screen is unified to **`--space-4` (16px)** for banner→tabs, header→tabs margin on `.division-tabs`, and book grid top spacing via new `#app:has(.division-panel) { padding-top: var(--space-4) }`, replacing mixed `0.8rem` / `2rem` values while leaving the reading view’s default `#app` top padding unchanged.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 309894a2a4f76f57fe89bb595456056f7ed67b59. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
