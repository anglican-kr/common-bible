---
date: 2026-06-11
pr: 277
branch: refactor/bookmark-select-split
title: "refactor: 북마크 선택 삭제 모드를 bookmark-select.js로 분리 (ADR-034 후속)"
---

# refactor: 북마크 선택 삭제 모드를 bookmark-select.js로 분리 (ADR-034 후속)

## 무엇을

bookmark.js 분할 다음 라운드. 선택 삭제 모드를 신규 모듈 `js/app/bookmark-select.js`(362줄)로 추출.

- **상태** — `_bmSelectMode` / `_bmSelected`
- **캐스케이드 수학** — `BOOKMARK_SELECT` 마커 블록(parent map·covered·marked count·effective targets, 유닛 테스트)
- **생명주기/토글/chrome** — enter·exit·toggle·selectAll·syncChrome
- **액션** — 삭제·공유·이동(`#bm-select-bar` dock + 리스너)

`bookmark.js` 1,952 → **1,652줄 (−15%)**.

## 설계 — ADR-034가 보류했던 결합 해소

이 라운드는 모달 분리 때 *"select 통째 분리는 트리렌더↔select 양방향 결합 탓에 보류"*라고 명시했던 항목이다. 그 양방향을 PR1(제스처)/모달과 같은 패턴으로 분해:

- **오케스트레이터 → select (명시 import):** bookmark.js가 `_bmSelectMode`(ESM **live binding** — 트리 빌더·keydown·헤더 refresh의 read 사이트) + 호출 핸들러(`_toggleBmSelect`·`enter/exitBookmarkSelectMode`·`_bmToggleSelectAll`·`_syncBmSelectChrome`)를 import.
- **select → 오케스트레이터 (의존성 주입):** 삭제/이동 후 재렌더 + 헤더 refresh를 `initBookmarkSelect({ rerenderTree, refreshHeaderBtn })`로 주입 → select는 bookmark.js를 import하지 않아 고리 차단.

`_bmSelectMode` 잔류(PR1)가 이 라운드에서 select로 이동, gestures의 `isSelectMode` 훅은 bookmark.js가 import한 live binding을 그대로 읽어 무변경. select의 chrome 조작(`_syncBmSelectChrome`/exit)은 전부 셀렉터 기반(`.bm-select-circle`·`#bookmarks-view-tree`)이라 DOM ref 주입 없이 자족.

## 정리

이동으로 무참조가 된 bookmark.js의 import 제거: bookmark-core 4종(`_descendantIds`·`_selectAllState`·`_bmSelectCountLabel`·`_buildSharePayload`) + gestures `_isDescendant`(#276에서 추가했으나 소비자 `_moveSelectedToFolder`가 select로 이동).

## 테스트

`BOOKMARK_SELECT` 마커가 새 파일로 이동 → `bookmark.test.js` 로더가 `BOOKMARK_SELECT_SOURCE`에서 슬라이스.

- ✅ tsc (main · worker)
- ✅ 유닛 728건
- ✅ Playwright 로드 스모크 (앱 부팅·select 파사드 연결·콘솔 에러 0)
- ✅ e2e 26건 (`test_bookmark_select_delete` 전체 — 삭제·공유·이동·전체선택 + `dnd` + `swipe`)
- ⚠️ 사전 실패 2건 `test_bookmark_folders.py` 폴더 토글(데스크탑 드로어, headless) — `release/1.6.4` base 동일, 회귀 아님. `docs/known-issues.md` §1c에 재현·수정후보 기록.

## 문서

- ADR-034에 `개정 (2026-06-11): bookmark-select.js 분할` 블록 + #276 회귀 후속 노트
- `known-issues.md` §2 bookmark 분할 진행 갱신 + §1c 폴더토글 사전 실패 추가

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 대규모 이동이지만 동작은 기존과 동일하고 DI·유닛/e2e로 검증됨. 제스처 라운드(#276)처럼 추출 후 잔여 참조·조건 분기 경로는 여전히 주의 대상.
> 
> **Overview**
> **ADR-034 후속:** 모바일 북마크 **선택 삭제 모드**를 `bookmark.js`에서 신규 `bookmark-select.js`로 분리해 오케스트레이터를 약 **15%** 줄인다(1,952 → 1,652줄).
> 
> 새 모듈이 `_bmSelectMode` / `_bmSelected`, `BOOKMARK_SELECT` 캐스케이드 수학, enter/exit·chrome 동기화, `#bm-select-bar`의 삭제·공유·이동을 담당한다. 트리 렌더와의 양방향 결합은 **오케스트레이터 → select**는 live binding·핸들러 **import**, **select → 오케스트레이터**는 `initBookmarkSelect({ rerenderTree, refreshHeaderBtn })` **주입**으로 끊는다(제스처·모달과 동일 패턴). 제스처의 `isSelectMode`는 `bookmark.js`가 import한 `_bmSelectMode`를 그대로 읽는다.
> 
> `bookmark.js`에서 select 전용 **bookmark-core** import 4종과 **gestures** `_isDescendant` import를 제거한다. 유닛 테스트는 `BOOKMARK_SELECT` 슬라이스를 `BOOKMARK_SELECT_SOURCE`로 옮긴다. ADR-034·`known-issues.md`에 분할 기록 및 데스크탑 폴더 토글 e2e 2건(베이스 동일, 회귀 아님)을 반영한다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 0b266607ea0062bb6547da5abc23ae9e8919035d. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
