---
date: 2026-05-31
pr: 166
branch: fix/mobile-reading-header
title: "style: 읽기 헤더·책 목록 헤더 모바일 UI 폴리시"
---

# style: 읽기 헤더·책 목록 헤더 모바일 UI 폴리시

## Summary

읽기 헤더 + 책 목록 헤더의 작은 시각 정돈 3건.

- **읽기 헤더 북마크 아이콘 테마색 적용** — `.title-bookmark-btn` 기본색이 `--text-secondary`(회색)이라 옆의 홈/뒤로·설정 아이콘(`--accent`)과 어울리지 않았다. 기본색을 `--accent` 로 통일하고, "북마크 있음" 상태 구분은 색 대비 → 윤곽선 ↔ 채움 SVG path 교체로 옮겼다.
- **모바일 읽기 헤더에서 복음서 축약형 항상 표시** — 제목 swap이 JS 측정 기반 `.compact` 에만 의존했는데 "요한의 복음서 1장"은 모바일 너비에도 들어맞아 풀 네임이 그대로 노출됐다. `.book-list` 와 같은 `@media (hover: none) and (pointer: coarse)` 규칙을 추가해 터치 기기에서는 항상 모바일 축약형(마태오/마르코/루가/요한)을 보이게 한다. 데스크탑 좁은 뷰포트 / 큰 글꼴은 기존 측정 폴백이 처리.
- **책 목록 헤더 그림자 제거 + 여백 확장** — ADR-025 스크롤 elevation 그림자가 책 목록 페이지에서는 탭 띠와 겹쳐 잡음으로 보였다. 기존 `#sticky-group:has(#division-tabs-slot:not(:empty))` 패턴(hairline 숨김에 사용 중)으로 책 목록에서만 그림자를 끄고, 같은 페이지 한정으로 `#app-header` padding-bottom · 이어읽기 배너 · 구분 탭 여백을 살짝 키워 숨막힘 완화. 읽기·머리말 화면 elevation 신호는 그대로.

## Test plan

- [ ] 모바일(iOS Safari)에서 4복음서 chapter 진입 시 헤더 제목이 "○○ N장" (마태오/마르코/루가/요한)으로 보이는지
- [ ] 모바일에서 다른 NT 책(로마서 등) 진입 시에도 기존 NT_MOBILE_NAME 축약형으로 보이는지
- [ ] 데스크탑에서 큰 글꼴/좁은 창으로 줄여도 측정 폴백이 동작해 풀 네임 ↔ 축약형이 swap 되는지
- [ ] 읽기 화면 헤더 북마크 아이콘이 다른 헤더 아이콘과 같은 accent 색인지, 북마크 있는 장에서 채움 ribbon 으로 바뀌는지
- [ ] 책 목록 페이지를 스크롤해도 헤더 아래 그림자가 안 생기는지 (라이트/다크 모두)
- [ ] 읽기/머리말 화면은 스크롤 시 그림자 elevation 그대로 들어오는지 (ADR-025 회귀 없음)
- [ ] 책 목록 페이지에서 검색바·제목 행 → 이어읽기 배너 → 구분 탭 사이 여백이 너무 붙지 않는지

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> CSS and header bookmark SVG path swaps only; no auth, data, or routing logic changes.
> 
> **Overview**
> **Reading header:** The chapter bookmark control now uses **`--accent`** like other header icons; bookmarked vs empty is shown by switching between **outlined and filled** Material Symbols paths in `bookmark.js`, not by toggling gray vs accent in CSS.
> 
> **Touch devices:** Gospel/NT chapter titles always use the **mobile short form** (e.g. 마태오/요한 + chapter) via `@media (hover: none) and (pointer: coarse)`, matching the book list—so full names like “요한의 복음서 1장” no longer appear when they technically fit without overflow measurement.
> 
> **Book list sticky chrome:** When division tabs are present, **scroll elevation shadow is disabled** on `#sticky-group` (same `:has(#division-tabs-slot:not(:empty))` pattern as the hidden hairline). **Spacing** under the header, resume banner, and tab strip is slightly increased.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 862bbfc86124dc6b4bc5013625e2db74e477b71c. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
