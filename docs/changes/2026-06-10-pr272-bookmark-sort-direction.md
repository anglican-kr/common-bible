---
date: 2026-06-10
pr: 272
branch: feat/bookmark-sort-direction
title: "feat: 북마크 정렬 방향(오름/내림) 선택"
---

# feat: 북마크 정렬 방향(오름/내림) 선택

## 무엇을
북마크 ⋯ 더 보기 메뉴의 **정렬 기준 아래에 "오름차순 / 내림차순" 라디오 그룹**을 추가했다(Apple Music 패턴). 예전엔 기준마다 방향이 고정(제목=가나다순, 날짜 3종=최신순)이라 거꾸로 볼 수 없었다.

## 동작
- 방향은 **활성 기준에 적용**되고 **기준별로 따로 기억**된다(제목을 내림으로 봤다 날짜로 바꿔도 서로 안 섞임).
- **현행 동작 보존** — 기준별 자연 기본값(제목 `asc`, created/modified/viewed `desc`)이라, 방향을 한 번도 안 건드린 사용자는 기존과 동일한 순서를 본다.
- **직접 정렬(manual)** 은 방향 개념이 없어 두 행을 **비활성(흐리게)** 처리.
- 방향은 정렬 기준과 같이 **per-device localStorage**(`bible-bookmark-sort-dir`), Drive 미동기(보기 설정, ADR-011 범위 밖).

## 구현
- `js/app/bookmark-core.js` — `getBookmarkSortDir`/`setBookmarkSortDir`(manual·잘못된 값 거부). `_bookmarkComparator` → 오름차순 기준 `_bookmarkAscComparator` 로 단순화하고 `sortBookmarkNodes` 가 `desc` 시 부호 반전(폴더-우선 클러스터링 유지).
- `js/app/bookmark.js` — 오름/내림 `menuitemradio` 2행 + 구분선, 열 때 `syncDirChecks()` 로 체크·비활성 갱신.
- `css/style.css` — 일반 `.title-action-menu-item:disabled` 스타일(danger 전용 → 일반화).

## 검증
- 유닛 **728건** 통과(정렬 방향 신규 7건: 기본값·per-mode 영속·잘못된 값 거부·부호 반전) · tsc 0 errors
- Playwright(모바일): 직접 정렬 시 방향 행 비활성 / "추가된 날짜" 선택 시 내림차순 기본 체크 / 오름차순 클릭 → `{"created":"asc"}` 저장 + 재오픈 체크 이동 / **페이지 오류 0** / 가로 모드 11행 메뉴 스크롤로 전부 도달(ADR-030 후속⁷)
- ADR-010 개정 · docs/status.md · QA 보고서(`docs/archive/qa/2026-06-10-unit-bookmark-sort-direction.md`)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> <sup>[Cursor Bugbot](https://cursor.com/bugbot) is generating a summary for commit 7d7414d4c31375c9bb2020949ecea7c0e645399f. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
