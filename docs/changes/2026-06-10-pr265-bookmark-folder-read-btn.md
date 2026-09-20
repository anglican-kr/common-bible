---
date: 2026-06-10
pr: 265
branch: feat/bookmark-folder-read-btn
title: "feat: 북마크 폴더 읽기 버튼 아이콘·정렬 다듬기 (ADR-035)"
---

# feat: 북마크 폴더 읽기 버튼 아이콘·정렬 다듬기 (ADR-035)

## 무엇을

북마크 전체 뷰의 폴더 행 **읽기 버튼**을 두 가지 다듬었습니다.

1. **아이콘 교체** — Material Symbols `auto_stories`(펼친 책) → **`play_lesson`**(책 + 재생 삼각형). 폴더 = 하나의 봉독 묶음이므로 "이 과(課)를 차례로 봉독한다"는 능동적 의미가 더 맞습니다.
2. **🛈 컬럼 정렬** — 폴더 행 트레일링에는 읽기 버튼 + `≡` 재정렬 핸들이 함께 놓이는데, 핸들은 이미 헤더 `⋯` 컬럼과 정렬돼 있었습니다. 읽기↔핸들 간격을 행 기본값(`--space-3`)에서 헤더 아이콘 간격(`--space-1`)으로 좁혀 **읽기 버튼 중심을 헤더 🛈 컬럼 아래로** 맞췄습니다. 결과적으로 행의 두 아이콘(읽기·`≡`)이 헤더의 두 아이콘(`🛈`·`⋯`)과 두 컬럼으로 나란히 정렬됩니다.

## 정렬 측정 (iPhone 390px, 글리프 중심 x)

| | 헤더 | 폴더 행 (변경 전 → 후) |
|---|---|---|
| 안쪽 컬럼 | 🛈 = 304 | 읽기 296 → **304** |
| 바깥 컬럼 | ⋯ = 352 | ≡ 핸들 = 352 (불변) |

## 검증

- 유닛 테스트 721/721 통과
- e2e 북마크 12건 통과 — 폴더 토글 2건은 변경 전에도 동일하게 실패하는 기존 헤드리스 flake(드러어 쪽, `.bookmarks-view` 스코프 변경과 무관)
- 변경은 `.bookmarks-view` 스코프 + 아이콘 path 교체로 한정 → 드러어/데스크톱 동선 영향 없음

## 문서

ADR-035 에 2026-06-10 개정 노트 추가.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> `.bookmarks-view` 스코프의 아이콘 path·마진 조정과 ADR 문서만 변경되어 동작·데이터 경로에는 영향이 거의 없습니다.
> 
> **Overview**
> **폴더 행 읽기 버튼** UI를 북마크 전체 뷰(`renderBookmarksView`) 기준으로 다듬었습니다.
> 
> **아이콘** — `_buildFolderReadBtn`의 Material Symbols 글리프를 `auto_stories`에서 **`play_lesson`**(책 + 재생)으로 바꿔, 폴더 단위 “봉독 묶음을 재생한다”는 의미를 더 분명히 했습니다.
> 
> **정렬** — `.bookmarks-view .bm-folder-read-btn`에 `margin-right: calc(var(--space-1) - var(--space-3))`를 넣어 읽기 버튼과 `≡` 핸들 사이 간격을 헤더의 🛈·⋯ 간격(`--space-1`)에 맞췄습니다. 읽기 아이콘 중심이 헤더 🛈 아래로 오고, 행의 읽기·`≡`가 헤더의 🛈·⋯와 두 컬럼으로 맞춰집니다. 스코프는 `.bookmarks-view`만이라 드로어 등 다른 표면은 그대로입니다.
> 
> **문서** — ADR-035에 2026-06-10 개정(아이콘·정렬)을 반영했습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 06f131f76c280b41e1b5b28251565ae4b5f388f3. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
