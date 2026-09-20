---
date: 2026-06-11
pr: 284
branch: feat/desktop-search-filter-panel
title: "feat: 데스크탑 책 필터 사이드 패널화 + 검색 포커스 시 깔때기 노출 + 북마크 버튼 순서"
---

# feat: 데스크탑 책 필터 사이드 패널화 + 검색 포커스 시 깔때기 노출 + 북마크 버튼 순서

데스크탑 검색·북마크 패널의 일관성·접근성을 다듬는 세 가지 UI 변경. (베이스: `release/1.6.4`)

## 변경 내용

### 1. 데스크탑 책 필터 → 우측 사이드 패널 (ADR-033 개정)
- 책 선택 시트(`#book-filter-sheet`)의 **데스크탑 표현을 중앙 모달 → 우측 슬라이드-인 사이드 패널**로 변경.
- 북마크 드로어(`#bookmark-drawer`)·인용 시트(`#cite-sheet`)와 **동일한 데스크탑 패턴**으로 통일: 우측 정착, `bm-drawer-in-right/out-right` 슬라이드, `--shadow-drawer`, 좌측만 둥근 모서리, 좌측 가장자리 폭-리사이즈 그립.
- 헤더에 닫기(×) 버튼 추가, `closeTransition`(`.book-filter-closing`)으로 닫힘 슬라이드(모바일 down·데스크탑 right) 부여 — 직전엔 즉시 사라졌음. 모바일 바텀 시트는 그대로.

### 2. 검색 필드 포커스 시 깔때기(책 필터) 노출 (ADR-033 개정)
- funnel(책 선택 진입점)이 검색 뷰에서만 보이던 것을, **검색 입력에 포커스가 가면 어느 화면에서든** 좌측에 노출.
- `SearchField.focused` 플래그 + focus/blur 토글, `syncOneField` 활성 게이트를 `searchView || focused`로 확장. 검색 뷰가 아니면 URL 스코프가 없어 funnel만 보임.

### 3. 데스크탑 북마크 드로어 폴더 버튼 순서 (ADR-035 개정)
- 폴더 행 트레일링 버튼을 **읽기 → 수정 → 삭제** 에서 **수정 → 삭제 → 읽기** 로.
- DOM 변경 대신 flex `order`로 시각 순서만 조정, `#bookmark-drawer-body`에만 스코프 → 전체 `/bookmarks` 뷰의 기존 컬럼 정렬은 유지.

## 검증
- `tsc` 0, 유닛 728 통과, e2e 28 통과(search·bookmark·folders)
- 데스크탑 Playwright 스모크로 셋 다 시각 확인 (폴더 행 `수정 삭제 ▶ ≡` 순서, 홈에서 포커스 시 funnel 노출, 책 필터 우측 패널 width 420·우측 정착·닫기·리사이즈)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Presentation and search-field visibility only; URL/search worker schema unchanged. Focus handling adds edge cases (picker open, tab between funnel and input) but no security or data-path changes.
> 
> **Overview**
> Three related UI polish changes for search and bookmark panels.
> 
> **Desktop book picker (`#book-filter-sheet`)** moves from a centered modal to a **right slide-in side panel**, matching `#cite-sheet` and `#bookmark-drawer` (slide animations, drawer shadow, left-edge resize, header **×**). Closing now uses `closeTransition` with `.book-filter-closing` instead of disappearing instantly; mobile bottom sheet is unchanged.
> 
> **Search funnel (book filter entry)** is no longer limited to the search results view: when any mounted search field gains focus (header, in-page, tab pill), the token zone shows the funnel on **home, reading, etc.** (`SearchField.focused` + container `focusin`/`focusout`, with focus kept while the picker is open). Off-search views show the funnel only—no scope chips until you’re on search.
> 
> **Desktop bookmark drawer** folder rows reorder trailing actions to **edit → delete → read** via scoped flex `order` on `#bookmark-drawer-body` only; the full `/bookmarks` view layout is untouched.
> 
> ADR-033 and ADR-035 record the revisions.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7f7f7258e3e6bf17effb4615b1853e424ef067ec. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
