---
date: 2026-06-22
pr: 298
branch: test/unit-search-scope-helpers
title: "test: search 범위 헬퍼(extractInScope·bookName) 유닛 11 케이스 + QA"
---

# test: search 범위 헬퍼(extractInScope·bookName) 유닛 11 케이스 + QA

## 배경

유닛 테스트 app 레이어 확장 후속(3번째). routing.parsePath(#296)·search-worker(#297)에 이어, search.js의 순수 범위 헬퍼를 추가 커버.

## 변경

- `search.js`: `extractInScope` + `bookName` 둘레에 `SCOPE_HELPERS` 마커 추가(슬라이스 단위). 동작 변경 0 — 주석만.
- `tests/unit/search.test.js` +11 케이스 (77→88):
  - `extractInScope` — `in:<책>` 추출(앞쪽 위치·다중 누적·`in:` 뒤 공백·대소문자 무시·미해석 별칭은 키워드에 보존·중복공백 정리). aliasMap을 인자(Map)로 주입한 순수 함수.
  - `bookName` — id→한글명, 미지의 id 폴백, `_bookMap` null 폴백.
- `extractInScope`는 워커 `parseQuery`(#297)와 같은 `in:` 의미를 화면 쪽에서 미리 처리하는 짝.
- `docs/archive/qa/2026-06-22-unit-search-scope-helpers.md` + CLAUDE.md 케이스 수(781→792).

## 검증

- `node --test tests/unit/search.test.js` → 88 pass
- 전체 회귀 → **792 pass / 0 fail** (781 → +11)
- `tsc --noEmit` → 0 errors
- 실앱 스모크 → `사랑 in:요한` 검색이 "총 39건", 결과 전부 요한의 복음서로 정확히 제한, JS 오류 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> 테스트·주석·문서만 추가된 변경으로 프로덕션 검색 로직은 그대로다.
> 
> **Overview**
> **검색 `in:책` 범위 처리**를 화면 쪽에서 담당하는 `extractInScope`와 책 id→한글명 `bookName`에 대한 **자동 유닛 테스트 11건**을 추가했다. ADR-013 패턴으로 `search.js`에 `SCOPE_HELPERS` BEGIN/END 마커만 두어 vm 슬라이스 대상으로 삼고, **런타임 동작은 바꾸지 않았다.**
> 
> `tests/unit/search.test.js`에서 `in:` 위치·다중 누적·공백·대소문자·미해석 별칭 보존·`bookName` 폴백 등을 검증한다. QA 보고서(`docs/archive/qa/2026-06-22-unit-search-scope-helpers.md`)와 `CLAUDE.md`의 전체 케이스 수를 **781 → 792**로 갱신했다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 777751b196810fa374596fa17f3d4f5a2e345f8a. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
