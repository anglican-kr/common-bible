---
date: 2026-06-06
pr: 206
branch: feat/bookmark-chapter-delete-select
title: "feat: 장 북마크 헤더 토글-오프를 선택 삭제 picker로 개편"
---

# feat: 장 북마크 헤더 토글-오프를 선택 삭제 picker로 개편

## 무엇을

읽기 화면 헤더의 책갈피 아이콘으로 **이미 저장된 장**을 끌 때, 예전의 "이 장 북마크를 전부 삭제할까요?" 단일 확인 모달을 **장 안의 북마크를 골라 지우는 선택 모달**로 바꿨다.

한 장에 장 전체·여러 절 범위 북마크가 섞여 있으면 "전부 삭제"가 너무 거칠었다. 이제 이 장의 각 북마크를 체크박스 목록(라벨 + 참조)으로 보여주고 지울 항목만 고른다.

- **"전체 선택"** tri-state 토글(없음/일부=중간상태/전부)로 일괄 선택·해제
- **기본은 미선택** — 삭제 버튼은 선택 0이면 비활성, 선택 시 `삭제 (N)` 카운트 표기 (몇 개 지우는지 누르기 전에 노출)
- 목록 선택 자체가 곧 확인이라 중첩 확인 없음(단일 스텝, iOS 다중 선택 삭제 idiom)
- 데스크탑은 변경 없음(헤더 책갈피 = 북마크 서랍). **모바일 전용**

## 화면

| 미선택(삭제 비활성) | 일부 선택(중간상태·삭제 N) | 다크 |
|---|---|---|
| 체크박스 목록 + 비활성 삭제 | indeterminate 전체 선택 + `삭제 (1)` | 정상 대비 |

(라이트/다크 양쪽 dev 확인 완료)

## 어떻게

- 신규 모달 `#bm-chapter-delete-modal` + `openChapterDeleteModal()` / `closeChapterDeleteModal()`. `trapFocus` + Escape + scrim 탭 닫기, `route()`가 네비 시 `window.closeChapterDeleteModal` 로 dismiss
- 순수 함수 `_selectAllState`·`_deleteBtnLabel` 로 분리(BOOKMARK_QUERY 마커 영역) → 유닛 테스트. 구 `confirmRemoveChapterBookmarks()`·`_chapterDeleteMessage()` 제거
- 삭제색 `#c0392b` 확인 버튼·체크박스 accent, 기본 포커스는 안전한 '취소'

## 테스트

- **유닛**: `_selectAllState`(4) + `_deleteBtnLabel`(2) 신규, 구 `_chapterDeleteMessage`(2) 대체 — `bookmark.test.js` 133 통과, 전체 회귀 618 통과
- **e2e**: `test_bookmark.py` 9 통과 — 토글-삭제(전체 선택)·취소·**선택 삭제(고른 것만 지우고 나머지 유지)** 3종. 모바일 토글 테스트가 iOS 설치 안내 scrim 레이스로 (이번 변경 전부터) 불안정하던 것을 nudge 억제로 안정화
- `npx tsc` 0 error

## 문서

ADR-010 개정(2026-06-06 후속), CLAUDE.md "현재 상태", `docs/qa/2026-06-06-unit-chapter-delete-picker.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 북마크 삭제 UX·데이터 변경 경로가 바뀌지만 모바일에 한정되고 테스트·라우팅 dismiss로 회귀를 줄였습니다.
> 
> **Overview**
> 모바일 읽기 헤더에서 **이미 북마크된 장**의 책갈피를 끌 때, 한 번에 “장 전체 삭제” 확인 대신 **`#bm-chapter-delete-modal` 선택 삭제 picker**로 바꿉니다. 장 안 북마크를 체크박스 목록(라벨·참조)으로 보여주고, tri-state **전체 선택**, 기본 미선택, **`삭제 (N)`**·선택 0일 때 비활성 삭제로 범위를 명확히 합니다.
> 
> `bookmark.js`는 `openChapterDeleteModal` / `closeChapterDeleteModal`과 순수 헬퍼 `_selectAllState`·`_deleteBtnLabel`을 추가하고 구 `confirmRemoveChapterBookmarks`·`_chapterDeleteMessage`를 제거합니다. `route()`·PTR·Escape·scrim으로 네비 시 모달을 닫습니다.
> 
> 디자인 측면에서는 **`--danger` / `--danger-strong`** 토큰을 도입해 삭제·캐시 비우기 등 파괴 UI의 `#c0392b` 리터럴을 통일하고, ADR-010·`DESIGN.md`·`CLAUDE.md`를 갱신합니다. 유닛·e2e(전체 선택·취소·부분 삭제)와 iOS 설치 안내 nudge 억제로 모바일 e2e 안정화가 포함됩니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6d8111a0a0798587569049f263abed2c9744294b. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
