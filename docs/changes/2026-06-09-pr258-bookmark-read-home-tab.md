---
date: 2026-06-09
pr: 258
branch: feat/bookmark-read-home-tab
title: "feat: 북마크 읽기 진입·헤더 북마크 동선 정리"
---

# feat: 북마크 읽기 진입·헤더 북마크 동선 정리

## 요약

북마크 읽기 진입과 읽기 화면 헤더 북마크 동선을 정리하고, 장 picker 팝오버의 글꼴 회귀를 고칩니다.

## 변경 내용

### 1. 북마크 폴더 '읽기' → 홈 탭 (ADR-035 개정)
- 라우트를 `/bookmarks/read/<id>` → **`/read/<id>`** 로 변경. 탭 분류는 경로 첫 세그먼트로 결정되므로 `read`는 **홈 탭**으로 잡혀, 폴더에서 읽기를 누르면 탭 바가 `홈`으로 전환됩니다.
- 읽기 아이콘 `menu_book` → **`auto_stories`**(펼친 책 + 넘기는 페이지).
- 뒤로가기는 그대로 `/bookmarks` 복귀(데스크탑 표시, 모바일은 하단 탭 바가 담당).

### 2. 읽기/장-목록 헤더 북마크 재정의 (ADR-010 개정)
탭 바에 북마크 탭이 있으니 **네비·관리는 탭 바로 통일**하고, 헤더는 탭 바가 못 하는 **'지금 이 장 추가'** 맥락 동작만 맡습니다.

| | 세로 폰 | 가로 폰 | 데스크탑 |
|---|---|---|---|
| 미저장 장 | 추가 아이콘 → 폴더 위치 선택 저장 모달 | 유지 | 유지 |
| 북마크된 장 | **숨김** | 유지 | 유지 |
| 장-목록 화면 | **숨김** | 유지 | 유지 |

- 보임/숨김을 **CSS 미디어 쿼리**(`@media (max-width:768px)`)로 처리 → 폰을 가로로 돌려 탭 바가 사라지는 순간 헤더 북마크가 자동 복귀(회전에 강건, JS resize 리스너 불필요).
- 데스크탑·가로 폰(>768px)은 탭 바가 없어 헤더가 **유일한 북마크 진입점**이라 종전대로 유지.
- 부수: 헤더에서 더는 삭제하지 않아 장-삭제 picker(`#bm-chapter-delete-modal`)가 미사용이 됩니다 — 죽은 코드 일괄 정리는 별도 백로그.

### 3. 장 picker 팝오버 굵은 글꼴 제거
- `#page-title { font-weight: 700 }`을 상속하던 팝오버 장 번호에 `font-weight: 400` 리셋 추가(카드 격자 통일 리팩터에서 빠졌던 회귀).

### 4. 검색 빈 화면 문구 축약
- "찾고 싶은 말씀을 검색해 보세요" → "검색해 보세요"

## 검증
- `node --test tests/unit/*.test.js` — **708/708 통과**, `tsc --noEmit` 0 에러
- Playwright(세로/가로/데스크탑 × {북마크된 장·미저장 장·장-목록} 9케이스 + 회전 + 추가-탭 저장 모달·폴더 선택): 모두 예상대로 동작
- e2e: 데이터 서브모듈 필요한 본문 렌더는 로컬 수동 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> 라우트·탭 분류·헤더 북마크 클릭 경로가 바뀌어 북마크/딥링크 동선 회귀 가능성이 있으나, 범위는 북마크 UX에 한정됩니다.
> 
> **Overview**
> 북마크 **모아 읽기** 진입과 읽기 화면 **헤더 북마크** 동선을 정리하고, 장 picker·검색 빈 화면 등 소규모 UI를 고칩니다.
> 
> **북마크 읽기 → 홈 탭:** 폴더 `읽기` 링크를 `/bookmarks/read/<id>`에서 **`/read/<id>`** 로 바꿔 탭 분류가 **홈**이 되게 했습니다. 아이콘은 `menu_book` → **`auto_stories`**. `routing.js`·`bookmark-read.js`·문서(ADR-035)를 맞춰 두었습니다.
> 
> **모바일 헤더 북마크 (ADR-010):** ≤768px에서는 헤더가 **미저장 장 추가**만 담당합니다. 이미 저장된 장(`.has-bookmark`)·장 목록(`.is-list`)은 **CSS 미디어 쿼리**로 숨기고, 탭 시 항상 `openSaveModal`만 엽니다(헤더에서 삭제·`openChapterDeleteModal` 제거). >768px·가로 폰은 기존처럼 드로어 진입점을 유지합니다.
> 
> **기타:** `.popover-item`에 `font-weight: 400`으로 `#page-title` 굵기 상속 회귀 수정. 검색 빈 상태 문구를 **「검색해 보세요」**로 축약.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit c4b3838c0ab0e603bb18b0dd56b1c7b63337d540. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
