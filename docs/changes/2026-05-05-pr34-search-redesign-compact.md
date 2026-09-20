---
date: 2026-05-05
pr: 34
branch: claude/search-redesign-compact-modal
title: "feat: 검색 UI 재설계 — 컴팩트 모달 → 결과 시트 + in: 연산자"
---

# feat: 검색 UI 재설계 — 컴팩트 모달 → 결과 시트 + in: 연산자

## 요약

검색 진입을 두 단계로 분리: **컴팩트 모달**(입력 + 칩 행만 키보드 위에 떠 있음) → Enter → **확장 결과 시트**. 라이브 검색은 모바일·데스크톱 모두 폐기, Enter로만 트리거. 책 범위 한정 연산자 `in:` 도입 (`사랑 in:요한` → 요한복음만 검색).

## 주요 변경

### 상태 모델 (`#search-sheet[data-state]`)
- `compact`: 6.4rem 고정 높이, 키보드 위에 떠 있는 카드(사방 0.75rem 마진, 16px 둥근 모서리, 카드형 그림자). 결과/핸들 숨김.
- `expanded`: 55vh, 결과 표시. 동일한 카드 스타일.
- 트리거: FAB/헤더 검색바 → compact, Enter → expanded, 결과 표시 중 입력 재포커스 → compact 복귀.
- 트랜지션: `height/bottom/left/right/box-shadow` 220ms `cubic-bezier(0.4, 0, 0.2, 1)`. `_suspendKeyboardAdjust` 플래그로 visualViewport.resize의 `transition: none` 스냅 방지.

### `in:` 연산자
- `parseQuery(raw)`: `IN_RE = /(?:^|\s)in:\s*(\S+)/g`로 토큰 추출. 콜론 뒤 공백 관용 (`in: 요한`도 동작).
- `gatherResults`에 `restrictBooks: Set<bookId>` 인자 추가, 다중 = OR(합집합).
- worker가 `keyword`(stripped) 필드를 페이로드에 포함 → 결과 클릭 시 `?hl=`에 stripped 키워드만 전달돼 장 보기 하이라이트가 정상 동작.
- 매칭 실패 별칭은 검색 차단 + `.search-notice` 요소로 inline 안내 (데스크톱/모바일 통합).

### 칩 UI
- `+ in:` 칩 (`#search-sheet-chips` 툴바). 탭 시 입력창 끝에 ` in:` 삽입, 커서 `:` 뒤 위치, 입력 포커스 유지.
- `pointerdown.preventDefault`로 IME 깜박임 방지.
- `data-chip` 속성 — 향후 칩 추가 시 마크업만 늘리고 JS는 switch 분기.

### 라이브 검색 제거 (모바일·데스크톱 모두)
- `사랑 in:요한` 같은 다중 토큰 입력에서 중간 키 입력마다 의미 없는 부분 문자열 검색이 발화하던 문제.
- 죽은 `searchDebounceTimer`/`sheetDebounceTimer`/`searchAutoNavTimer`/`sheetAutoNavTimer` 제거.

### 모바일 헤더 검색바 위임
- `$searchInput`에 pointerdown.preventDefault + 폴백 focus 핸들러 → `openSearchSheet("")`.

### 스크림 + 스크롤 잠금 강화
- `#search-scrim` 불투명도 0.45 + `backdrop-filter: blur(8px)` + `touch-action: none` (iOS rubber-band 차단).
- `#search-sheet-results`에 `overscroll-behavior: contain`.
- 기존 `body.position = fixed` 잠금 + `_searchSheetAppliedScrollLock` 가드 그대로 유지.

### 기타
- iOS sliver `#search-sheet::after` 제거 (사방 마진 카드로 form-accessory bar 가림이 불필요).
- 검색 입력 플레이스홀더에 `사랑 in:요한` 예시 추가.
- 데스크톱 헤더 검색바 너비 확대 (16rem 기본 / 22rem 포커스).

## 문서

- ADR-005에 "검색 연산자 `in:` 도입" 섹션 추가 (문법, 매칭 정책, 구현 위치, 공백 관용).
- `docs/worklog.md`에 작업 일지 추가.
- `CLAUDE.md` "현재 상태"에 항목 추가.

## 캐시 무효화

검색 워커 변경이 기존 사용자에게 도달하도록 1.4.1 릴리스 + `sw.js` CACHE_NAME `rev-44 → rev-45` bump.

## 테스트 계획

자동화된 e2e 테스트 16건 (`tests/e2e/test_search.py`, 모두 통과):

- [x] 키워드 검색 결과 표시 / 절 참조 자동 이동 / 워커 에러 UI / 직접 URL 진입 / 결과 클릭 / 참조 카드 클릭 / `?hl=` 파라미터 (회귀 7건)
- [x] `in:` 연산자 단일 책 제한
- [x] `in:` 콜론 뒤 공백 관용
- [x] `in:` 다중 별칭 OR(합집합)
- [x] `in:` unmatched 별칭 검색 차단 + notice 메시지
- [x] `?hl=` 파라미터에 stripped 키워드만 (in:/별칭 미포함)
- [x] 모바일 FAB → 컴팩트 시트 진입
- [x] 모바일 Enter → 확장 + 결과 표시
- [x] 모바일 칩 클릭 → ` in:` 삽입 + 커서 끝 + 포커스 유지
- [x] 모바일 결과 표시 중 입력 포커스 → 컴팩트 복귀

수동 검증 (실기기/iOS Safari):
- [x] FAB 탭 → 컴팩트 시트가 키보드 위에 카드 형태로 떠오름
- [x] "사랑" 입력 → 라이브 검색 안 뜸, Enter → 키보드 닫히고 시트 부드럽게 확장
- [x] "사랑 in:요한" Enter → 요한복음 결과만, 결과 클릭 시 "사랑"만 하이라이트
- [x] 결과 표시 중 입력창 탭 → compact 복귀, 키보드 다시 뜨고 결과 사라짐
- [x] 컴팩트 모달 떠 있을 때 배경 세로 스크롤 시도해도 본문 안 움직임
- [x] 시트 닫기/재진입 5회 반복 → 본문 스크롤 위치 정확히 복원

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Medium risk: changes core search triggering, worker query parsing/filtering, and mobile sheet keyboard/transition behavior, which can affect search results and navigation UX across devices.
> 
> **Overview**
> **Search UX is reworked to a two-step flow**: mobile search now opens a *compact* sheet (input + chips) and only expands to the results sheet on Enter, with updated transitions, scrim behavior, and stronger scroll/overscroll locking.
> 
> **Search execution is now Enter-triggered only** (debounced live search removed), and a new `in:<book-alias>` operator is parsed in `search-worker.js` to restrict results to one or more books (OR); unknown aliases block the search and surface an inline `.search-notice`, while result highlighting/`?hl=` uses the stripped keyword.
> 
> Updates markup/CSS for chips and sheet states, expands desktop header search width and placeholders, bumps `sw.js` cache/version for rollout, and adds e2e coverage for `in:` and mobile compact/expanded transitions.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 302231f9950abb1d5df1ce18bc6ea2bec0f07993. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
