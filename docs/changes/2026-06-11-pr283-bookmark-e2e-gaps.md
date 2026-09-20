---
date: 2026-06-11
pr: 283
branch: test/bookmark-e2e-gaps
title: "test: 북마크 e2e 커버리지 빈틈 보강 + tests/README.md 신설"
---

# test: 북마크 e2e 커버리지 빈틈 보강 + tests/README.md 신설

## 배경

ADR-034 북마크 분할 완료 후 **e2e 커버리지 감사**에서, tsc가 못 잡는(미선언 식별자를 전역으로 묵인) **모듈 간 import·주입 콜백 경로** 중 e2e가 없던 곳을 발견했다. 이번 분할에서 그 배선이 깨졌어도 어떤 e2e도 못 잡았을 위험 지점들이다.

## 1. e2e 빈틈 4종 보강

| 경로 | 모듈 간 결합 | 신규 테스트 |
|---|---|---|
| 드로어 북마크 링크 클릭 → 내비+드로어 닫힘 | tree → **주입 `closeBookmarkDrawer`** + `navigate`·`markBookmarkViewed`·`_bookmarkHref` | `test_bookmark.py::test_drawer_bookmark_link_navigates_and_closes_drawer` |
| 트리 키보드 내비(ArrowRight 펼침·ArrowDown 포커스) | tree.js keydown(roving tabindex) | `test_bookmark.py::test_drawer_tree_keyboard_navigation` |
| ⋯ 메뉴 정렬(제목·내림차순) → 재렌더 | menu → core `setBookmarkSort`/`setBookmarkSortDir` + **주입 rerender** | `test_bookmark_sort.py` (2건) |
| 폴더 "모아 읽기" → `/read` 화면 | tree → navigate → bookmark-read(ADR-035) | `test_bookmark_read.py` (1건) |

신규 파일 2개 + `test_bookmark.py` 2건. 서버 8080 기준 **5건 전부 통과**, test_bookmark.py 전체 8건 회귀 없음.

## 2. `tests/README.md` 신설

비개발자도 코드 없이 "무엇이 어디서 검증되는가"를 파악하도록:
- 네 겹(유닛 `node --test` · 타입검사 `tsc` · E2E Playwright · 데이터 파이프라인)의 **역할 차이·실행법·CI 여부**
- 유닛 19파일 · e2e 26파일 각각의 **검증 대상 일람**
- **tsc가 import 누락을 못 잡는 사각지대** 명시 — E2E가 안전망인 이유

## 검증

- ✅ 신규 e2e 5건 (sort 2 · read 1 · 링크내비 1 · 키보드 1)
- ✅ `test_bookmark.py` 8건 (기존 6 + 신규 2)
- 유닛/소스 무변경 → tsc·유닛 영향 없음

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Documentation and local-only E2E additions; no runtime or CI unit/tsc behavior changes.
> 
> **Overview**
> Adds **`tests/README.md`** so reviewers can see how unit, `tsc`, E2E, and submodule data tests differ, how to run them, and why E2E is the safety net for missing imports/injected callbacks that `tsc` can miss.
> 
> **E2E bookmark coverage** grows by five Playwright cases (no app/source changes): in `test_bookmark.py`, drawer bookmark link click → navigate + drawer close, and tree keyboard nav (ArrowRight expand, ArrowDown roving focus); new `test_bookmark_sort.py` (mobile ⋯ menu title sort + descending reorder + `localStorage` persistence); new `test_bookmark_read.py` (folder “모아 읽기” → `/read/<id>` with scripture rendered and drawer closed). The README tables are updated to reflect the new files and case counts.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 957a0e47708bbf1ed004c1c1fb04f2e30be0df26. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
