---
date: 2026-06-11
pr: 282
branch: refactor/isdescendant-to-core
title: "refactor: _isDescendant를 bookmark-core로 이전 (ADR-034 후속 정리)"
---

# refactor: _isDescendant를 bookmark-core로 이전 (ADR-034 후속 정리)

## 무엇을

순수 트리 술어 `_isDescendant`(폴더가 id를 하위에 품는지)를 `bookmark-gestures.js`의 DRAG_CORE 블록에서 본래 자리 `bookmark-core.js`의 BOOKMARK_QUERY 블록으로 이전. 분할 시리즈의 마지막 백로그 정리.

`_isDescendant`는 reorder 드래그(gestures `moveBookmarkItem`)와 선택-모드 이동(select `_moveSelectedToFolder`) **양쪽이 쓰는 공유 트리 헬퍼**라, DOM-free 로직 모듈인 core가 맞는 집이다. (#276에서 export 누락으로 한 번 깨졌던 그 함수 — 이제 제자리로.)

## 변경

- **core**: BOOKMARK_QUERY 블록에 `_isDescendant` 추가 + export.
- **gestures**: 정의 제거, core에서 import, export에서 제거.
- **select**: `_isDescendant` import를 gestures→core로 전환.
- **test**: QUERY 블록에 들어가므로 DRAG_CORE 로더(QUERY를 선이어붙임)가 `moveBookmarkItem`의 호출을 그대로 해결. `_isDescendant` 단위 테스트 4건은 의미에 맞게 QUERY 로더로 이관, DRAG_CORE 로더 반환에서 제거.

## 테스트

- ✅ tsc (main · worker)
- ✅ 유닛 728건 (`_isDescendant` QUERY 슬라이스 + `moveBookmarkItem` "폴더를 자기 하위로 드롭 거부"가 마커 슬라이싱 정상 동작 확인)
- ✅ 로드 스모크 (gestures·select가 core의 `_isDescendant` 런타임 해결)
- ✅ e2e 8건 (folder-move 회귀 + folder-exclude + dnd — `_isDescendant` 실행 경로)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Pure refactor with no logic changes; folder-into-descendant guards still run via the same predicate from a shared module.
> 
> **Overview**
> ADR-034 후속 정리로 순수 트리 술어 **`_isDescendant`**(폴더 하위에 id가 있는지)를 `bookmark-gestures.js` DRAG_CORE에서 **`bookmark-core.js` BOOKMARK_QUERY**로 옮깁니다. 드래그 재정렬(`moveBookmarkItem`)과 선택 모드 이동(`_moveSelectedToFolder`)이 같이 쓰는 DOM-free 헬퍼라 core가 맞는 위치입니다.
> 
> `bookmark-gestures`·`bookmark-select`는 core에서 import하고, gestures export에서는 제거합니다. 유닛 테스트는 `_isDescendant` 4건을 **QUERY 슬라이스 로더**로 옮기고, DRAG_CORE는 QUERY를 앞에 이어붙이는 기존 방식으로 `moveBookmarkItem` 검증은 그대로 둡니다. ADR-034에 후속 정리 절을 추가합니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7fe903ee44cf2a388b4eb343d6666d837a1d1873. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
