---
date: 2026-05-11
pr: 112
branch: test/bookmark-helpers-unit
title: "test: bookmark.js HREF / ACTIVE / IMPORT_EXPORT 유닛 테스트"
---

# test: bookmark.js HREF / ACTIVE / IMPORT_EXPORT 유닛 테스트

## Summary

- app 레이어 유닛 테스트 확장 다섯 번째 단계
- \`tests/unit/bookmark.test.js\` 확장: 70 → 104 (+34). 전체 406 → 440
- \`js/app/bookmark.js\`에 BEGIN/END 마커 3영역 신설:
  - **BOOKMARK_HREF** (4 케이스): \`_bookmarkHref\` 순수 URL 빌더
  - **BOOKMARK_ACTIVE** (11 케이스): \`_renderPathname\` 상태 + \`_isActiveBookmark\` + \`_hasActiveDescendant\`
  - **IMPORT_EXPORT** (19 케이스): \`_validateImportData\` + \`_mergeBookmarkStores\` + \`_countBookmarks\`

## 작은 리팩토링

\`_isActiveBookmark(bm, pathname = _renderPathname)\` / \`_hasActiveDescendant(folder, pathname = _renderPathname)\` — 옵셔널 두 번째 인자 추가. 호출 측은 인자 없이 호출하므로 default(\`_renderPathname\`)를 그대로 사용 → **동작 변경 0**. 테스트는 명시적 pathname을 넘겨 module-state 변경 없이 검증.

## HREF 검증

- \`verseSpec='all'\` → \`/:bookId/:chapter\` (절 세그먼트 생략)
- 절 범위·콤마 리스트 verbatim 보존
- 경계값(chapter=0) 가드 없음 — 의도 확인

## ACTIVE 검증

- 장 전체·절 범위 매칭, 다른 자원 mismatch
- default pathname=빈 문자열 → 절대 매칭 안 됨 (renderBookmarkTree 호출 전 상태)
- \`folder.children\` 빈/누락 안전
- 3단계 중첩 폴더 활성 자손 탐지
- 빈 중첩 폴더에서도 false

## IMPORT_EXPORT 검증

- \`_validateImportData\`: null/undefined/primitive 거절, \`bookmarks\` 없음/배열 아님 거절, 빈 배열도 유효 허용 (4 케이스)
- \`_mergeBookmarkStores\`: 빈/비대칭, **중복 ID 기존 우선**, union, 폴더 자식 ID 필터, **폴더 ID 중복 시 폴더 전체 스킵 (자식 통째)**, 3단계 깊이 필터, children 누락 안전 (9 케이스)
- \`_countBookmarks\`: 빈/평탄/폴더 자체 제외/중첩 합산/3단계 깊이/children 누락 안전 (6 케이스)

## 의도적 스킵

DOM 헤비 영역(drawer/save modal/new folder modal/merge dialog/tree render/drag handle/sheet drag)은 ADR-013 dual-track 기조에 따라 e2e 또는 jsdom 도입 후 검토.

## Test plan

- [x] \`node --test tests/unit/bookmark.test.js\` — 104 통과 / 169ms
- [x] \`node --test tests/unit/*.test.js\` — 440 통과 (회귀 0)
- [x] CI green
