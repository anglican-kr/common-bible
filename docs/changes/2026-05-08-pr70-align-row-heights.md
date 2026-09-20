---
date: 2026-05-08
pr: 70
branch: claude/align-row-heights-5pRwH
title: "fix: 북마크 시트 행 높이 정렬 + 모바일 드래그-재정렬 복원"
---

# fix: 북마크 시트 행 높이 정렬 + 모바일 드래그-재정렬 복원

## Summary

북마크 시트의 시각적 정렬과 모바일 제스처를 함께 정리.

### 1. 행 높이 정렬
- 폴더 행은 폴더명 한 줄, 북마크 행은 라벨 + 참조 두 줄이라 높이가 어긋나 모바일 스와이프 시 액션 패널 높이도 행마다 달라 보였다.
- `.bm-folder-row, .bm-bookmark-row`에 `min-height: 3.58rem`을 추가해 북마크 행의 자연 높이(label 0.88rem + ref 0.72rem, line-height 1.8, gap 0.1rem, padding 0.6rem)에 맞춤. 기준은 북마크 행이므로 북마크 행 자체는 그대로 유지되고 폴더 행만 같은 높이로 늘어남.

### 2. 모바일 드래그-재정렬 복원
iOS Safari가 `<a class="bm-bookmark-link">`에 대해 네이티브 롱프레스 컨텍스트 메뉴 / 링크 드래그를 먼저 발동시켜, 사용자가 북마크를 들어 폴더로 옮기거나 순서를 바꾸려는 의도가 가로채였다. 게다가 앱 자체의 롱프레스도 "수정/삭제 패널 열기"에 매핑되어 있어 드래그 진입 경로가 막혀 있었다.

**CSS (`css/style.css`)**
- `.bm-folder-row, .bm-bookmark-row`: `touch-action: pan-y` + `user-select: none` — 드로어 본문 세로 스크롤은 유지하면서 가로 스와이프와 롱프레스는 JS가 소유.
- 행 내부 `<a>`/`<button>`: `-webkit-touch-callout: none` + `-webkit-user-drag: none` — iOS 링크 미리보기 / 네이티브 링크 드래그 차단.

**JS (`js/app.js` `_setupDragHandle`)**
- 터치 디바이스 롱프레스(500ms 정지) → 드래그 모드 시작(햅틱 피드백). 기존의 "롱프레스로 액션 패널 열기" 의미는 폐기.
- 액션 패널(수정/삭제) 노출은 가로 스와이프 전용으로 일원화.
- 터치에서 세로 우세 이동 → 본문 스크롤로 양보 (`mode = "abort"`).
- 마우스는 종전대로 즉시 드래그.
- `pointerup` 직후의 동기 click이 링크 navigate / 폴더 토글을 일으키지 않도록, `dragStarted` 시 다음 click을 capture-phase에서 stop+prevent.

**테스트**
- `tests/e2e/test_bookmark_swipe.py`의 롱프레스 케이스 두 개를 새 의미("롱프레스 → 드래그 시작")에 맞게 갱신.

## Test plan
- [ ] 모바일에서 북마크 행을 길게 누르면 햅틱과 함께 드래그 고스트가 떠오르고, 그대로 위/아래로 옮겨 순서 바꾸기 / 폴더 안으로 넣기가 가능한지
- [ ] 모바일에서 행을 가로로 스와이프하면 수정/삭제 패널이 그대로 열리는지
- [ ] 짧은 탭은 종전대로 해당 절로 이동하는지
- [ ] iOS Safari에서 링크 미리보기 / 링크 드래그 시트가 더 이상 뜨지 않는지
- [ ] 폴더 행과 북마크 행이 동일한 높이로 보이고, 스와이프 시 액션 패널이 행 전체 높이를 채우는지
- [ ] 데스크톱에서 마우스 드래그로 북마크/폴더 재정렬이 종전대로 동작하는지

https://claude.ai/code/session_015SsUE6PAi1Wj85EGg6wHaL
