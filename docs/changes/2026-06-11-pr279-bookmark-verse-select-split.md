---
date: 2026-06-11
pr: 279
branch: refactor/bookmark-verse-select-split
title: "refactor: 북마크 절 선택 모드를 bookmark-verse-select.js로 분리 (ADR-034 후속)"
---

# refactor: 북마크 절 선택 모드를 bookmark-verse-select.js로 분리 (ADR-034 후속)

## 무엇을

bookmark.js 분할 다음 라운드. 읽기 화면의 절 선택 모드를 신규 모듈 `js/app/bookmark-verse-select.js`(144줄)로 추출.

- enter/exit (`#verse-select-bar` dock 토글 + body 클래스)
- spec 표시·북마크·복사 dock + 리스너
- 인접 선택 코너 병합 (`updateVerseSelectionBoundaries`)
- 인용 포함 클립보드 복사 (`copySelectedVerses`)

`bookmark.js` 1,652 → **1,546줄 (−6%)**.

## 설계 — near-leaf라 DI 불필요

앞 두 라운드(제스처·선택삭제)는 오케스트레이터로의 역방향 호출을 의존성 주입으로 끊어야 했지만, **절 선택 모드는 bookmark 트리/오케스트레이터를 전혀 되부르지 않는다**(읽기 화면 DOM + `readingContext`만 다룸). 의존이 전부 하향이라 주입 훅 없이 **export만으로 충분**:

- import: verse-spec(`collapseFullVerseRefs`·`selectedVersesToSpec`·`serializeVerseRange`) · bookmark-modals(`openSaveModal("verses")`)
- window 전역: `readingContext` · `getBooksCache` · `_showSyncSnackbar` · `announce`

bookmark.js는 enter/exit + bar/boundary updater 4개를 import해 드로어 "절 선택" 버튼 · keydown(Escape) · 모달 주입(`initBookmarkModals({ exitVerseSelectMode })`) · window 파사드에 연결.

## 테스트

마커 블록이 없어(절 선택은 DOM 바운드라 유닛 슬라이스 대상이 아니었음) **`bookmark.test.js` 무변경**.

- ✅ tsc (main · worker)
- ✅ 유닛 728건
- ✅ Playwright 로드 스모크 (절 선택 파사드 4종 연결·콘솔 에러 0)
- ✅ e2e 23건 (`test_copy` 절 선택 복사 + `test_features` + `test_a11y_keyboard` + `test_bookmark`)

## 문서

- ADR-034에 `개정 (2026-06-11): bookmark-verse-select.js 분할` 블록
- `known-issues.md` §2 bookmark 분할 진행 갱신 (남은 라운드: 트리 렌더링·⋯ 메뉴)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Behavior-preserving module split with unchanged window facades and no new circular imports; user-facing flows stay in bookmark orchestration and e2e-covered paths.
> 
> **Overview**
> **ADR-034 후속:** 읽기 화면 절 선택 모드를 `bookmark-verse-select.js`(144줄)로 추출하고 `bookmark.js`는 해당 모듈을 import해 드로어·Escape·`initBookmarkModals`·`window` 파사드만 연결한다.
> 
> 새 모듈은 `#verse-select-bar` dock(enter/exit, spec 표시, 북마크·복사·취소 리스너), 인접 절 하이라이트 병합, 인용 포함 클립보드 복사를 담당한다. 제스처/선택 모드와 달리 북마크 트리로 되돌아가지 않는 **near-leaf**라 `init*` DI 없이 `verse-spec`·`bookmark-modals`·`readingContext`만 하향 의존한다.
> 
> `bookmark.js`는 약 1,652→1,546줄(−6%). ADR-034·`known-issues.md` §2에 이번 라운드 완료를 반영했고, 남은 분할은 트리 렌더링·⋯ 메뉴이다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 781778d2e26b5c0337ddbb237064f09938eb3879. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
