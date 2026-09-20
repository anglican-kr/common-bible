---
date: 2026-06-21
pr: 296
branch: test/unit-routing-parsepath
title: "test: routing.js parsePath 유닛 24 케이스 + QA 보고서"
---

# test: routing.js parsePath 유닛 24 케이스 + QA 보고서

## 배경

유닛 테스트 app 레이어 확장 백로그 후속 → [[project_unit_test_expansion]]. **재검증 결과**: 분할(ADR-034)로 새로 생긴 모듈 다수는 공유 테스트 파일(bookmark.test.js가 6개 소스 로드, views.test.js가 data-fetch 로드)에서 이미 커버됨. 전 모듈 함수×테스트 참조 전수 스캔으로 진짜 미커버 순수 함수를 가려낸 결과, 가장 고가치 갭이 **`routing.parsePath`** (라우팅 핵심, 순수 URL 파서, 0 커버리지)였다.

## 변경

- `routing.js`: `parsePath` 둘레에 `PARSE_PATH` BEGIN/END 마커 추가(슬라이스 단위, ADR-013 하네스 컨벤션). 동작 변경 0 — 주석만.
- `tests/unit/routing.test.js` 신설 (24 케이스): books·search(쿼리/페이지/in 범위·폴백·빈값 필터)·`/read`·`/read/<folderId>`(디코드)·bookmarks·settings·division vs book·prologue·chapter 절 딥링크(단일·범위·역순 정규화·동일범위 축약·다중 세그먼트 스펙·부분절 3a,3b)·`hl`·`resume`.
- 다중 세그먼트 절 갈래는 **실제 `verse-spec.js`의 VERSE_SPEC 블록**을 vm에 함께 주입해 스텁 아닌 실구현으로 검증. `location`은 테스트마다 경로/쿼리 바꾸는 스텁. jsdom 미도입(0 의존성 원칙).
- `docs/archive/qa/2026-06-21-unit-routing-parsepath.md` (비기술 독자용 보고서).
- CLAUDE.md 유닛 케이스 수 갱신 (537→758).

## 검증

- `node --test tests/unit/routing.test.js` → 24 pass
- 전체 회귀 → **758 pass / 0 fail** (734 → +24)
- `tsc --noEmit` → 0 errors
- 실앱 로드 스모크 → 주요 라우트(`/genesis/1`·`/search`·`/bookmarks`·`/settings`·`/genesis/1/3-5`)에서 parsePath 정상 동작, JS pageerror 0

## 후속

`routing.js`의 navigate·route·페이지 메타·스크롤 추적은 히스토리·DOM 결합이라 e2e 경계. 다른 순수 미커버(`audio-player.formatTime` 등)는 소규모 후속 후보.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Test and documentation only; no production routing logic changes beyond comment/marker boundaries.
> 
> **Overview**
> Adds **automated coverage** for SPA URL parsing in `parsePath`—the logic that maps paths like `/search`, `/read/<folder>`, and chapter verse deep-links to view descriptors. **Runtime behavior is unchanged**; `routing.js` only gains `PARSE_PATH` BEGIN/END markers (ADR-013 slice boundaries) and clarifying comments.
> 
> **`tests/unit/routing.test.js`** (24 cases) loads the sliced `parsePath` block in a `node:vm` harness with a mutable `location` stub, plus the real `VERSE_SPEC` block from `verse-spec.js` so multi-segment verse URLs are tested against production parsing—not stubs. Cases cover root/tabs, search query/page/`in` filters and fallbacks, bookmark-read routes, division vs book, prologue, chapter highlights (ranges, reversal, canonical specs, `hl`/`resume`).
> 
> **Docs:** non-technical QA archive note and **CLAUDE.md** unit count **537 → 758** (+24).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 27d0782ee166270744a00c3af1e0222dc9b19bd7. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
