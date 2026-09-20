---
date: 2026-06-21
pr: 297
branch: test/unit-search-worker
title: "test: search-worker 순수 로직 유닛 23 케이스 + QA 보고서"
---

# test: search-worker 순수 로직 유닛 23 케이스 + QA 보고서

## 배경

유닛 테스트 app 레이어 확장 후속(2번째). routing.parsePath(#296)에 이어, 전 모듈 0-커버 순수 함수 스캔에서 다음 고가치 갭으로 **검색 워커(`js/search-worker.js`)의 순수 로직**을 확인 — 검색 정확성 핵심인데 테스트 0·마커 0이었다.

## 변경

- `search-worker.js`: 순수 4함수 둘레에 `SEARCH_PURE` BEGIN/END 마커 추가(슬라이스 단위). 동작 변경 0 — 주석만.
- `tests/unit/search-worker.test.js` 신설 (23 케이스):
  - `parseQuery` — `in:<책>` 연산자(공백 허용·앞쪽 위치·다중 OR·영문 대소문자·미해석 별칭·중복공백 정리)
  - `tryVerseRef` — `창세 1:3`·절 범위·전체 한글명 매칭·영문 대소문자·비주소 null·미지의 책 null
  - `gatherResults` — 부분일치(대소문자 무시)·`restrictBooks` 필터·미로드 청크 skip·행 필드 보존
  - `paginate` — 쪽 슬라이싱·`total` 보존·책 한글명 매핑·범위 밖 페이지
- 모듈 상태(`meta`/`loadedChunks`)는 prelude `let` 선언 + setter로 테스트마다 스왑. 워커 글로벌(`postMessage`/`onmessage`/`fetch`)은 슬라이스에 미포함. jsdom 미도입.
- `docs/archive/qa/2026-06-21-unit-search-worker.md` (비기술 보고서) + CLAUDE.md 케이스 수(758→781).

## 검증

- `node --test tests/unit/search-worker.test.js` → 23 pass
- 전체 회귀 → **781 pass / 0 fail** (758 → +23)
- `tsc --noEmit` → 0 errors
- 실앱 검색 스모크 → "사랑" 검색이 워커 전 파이프라인(parseQuery→gatherResults→paginate)을 거쳐 "총 709건 (1/102쪽)" + 실제 절 결과 렌더, JS 오류 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Test and documentation-only changes; production search logic is not modified beyond slice markers and comments.
> 
> **Overview**
> Adds automated coverage for the search worker’s **pure** path—`parseQuery` (`in:<book>`), `tryVerseRef`, `gatherResults`, and `paginate`—which previously had no unit tests.
> 
> `js/search-worker.js` wraps that block in **`SEARCH_PURE` BEGIN/END markers** so `tests/unit/search-worker.test.js` can load it in a `node:vm` context with stubbed `meta` / `loadedChunks` (ADR-013 pattern; no worker globals or new deps). **Runtime behavior is unchanged** (comments/markers only).
> 
> Also adds a QA archive note and updates **CLAUDE.md** unit test count **758 → 781** (+23).
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 60e0da8b3577f541526bbef0640367d549db2aa5. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
