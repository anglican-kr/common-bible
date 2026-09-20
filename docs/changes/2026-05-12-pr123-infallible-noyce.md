---
date: 2026-05-12
pr: 123
branch: claude/infallible-noyce-78557a
title: "test: e2e 깨진 테스트 17건 수선 + 검색 combobox role 정정"
---

# test: e2e 깨진 테스트 17건 수선 + 검색 combobox role 정정

## Summary

- 모듈 분할(ADR-018)·기능 추가 누적으로 깨진 e2e 17건 일괄 수선 — 173건 전수 통과
- 검색 입력 `role="combobox"` 누락(ADR-014 도입 시 빠짐) 보완 — axe-core critical 회귀 정정
- 비기술 독자용 회귀 보고서 1편 ([docs/qa/2026-05-12-e2e-regression.md](https://github.com/anglican-kr/common-bible/blob/claude/infallible-noyce-78557a/docs/qa/2026-05-12-e2e-regression.md))

## 카테고리별 수선

| 분류 | 건수 | 골자 |
|------|-----|------|
| 모듈 분할로 사라진 전역 | 8 | `openSaveModal` / `exportBookmarks` / `_currentBookId` → 버튼 클릭 + `window.readingContext` |
| PKCE 콜백 race | 4 | URL 정리가 아니라 상태머신 `NEEDS_CONSENT` 정착을 폴링 |
| 오디오 컨트롤 race | 6 | 빈 바디 응답이 fire 한 `error` 이벤트가 컨트롤을 떼어 냈음 — init script 로 리스너 차단 |
| 검색 증분 렌더링 race | 1 | 로딩 종료 + a11y announce 발화까지 대기 |
| 실제 a11y 회귀 (앱 코드) | 3 | `<input type="search">` 에 `role="combobox"` 추가 |

## Test plan
- [x] `pytest tests/e2e/` 173/173 통과 (약 6분 33초)
- [x] axe-core critical 위반 0건 복귀 (홈/본문/검색 결과)
- [x] 카테고리별 격리 재실행 시 모두 안정 — 오디오 race 도 `_open` 공통화 후 일관 통과
- [ ] 모바일(iOS 17 Safari)에서 검색 입력 combobox role 추가 후 VoiceOver 발화 수동 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Mostly updates E2E tests to use user-facing triggers and add more robust waits; only production change is adding `role="combobox"` to search inputs for ARIA validity, so runtime risk is minimal.
> 
> **Overview**
> Restores the E2E suite to green after recent module/UI changes by replacing calls to removed globals (e.g. `openSaveModal`, `exportBookmarks`, `_currentBookId`) with real UI interactions (`#bm-save-chapter-btn`, bookmark overflow export) and `window.readingContext`.
> 
> Hardens flaky flows by polling for terminal states (`driveSync` PKCE failures waiting for `NEEDS_CONSENT`), suppressing early audio `error` handlers during audio-control interaction tests, and waiting for mobile search rendering/announcements before asserting focus/cleanup.
> 
> Fixes an axe-core *critical* accessibility regression by adding `role="combobox"` to `#search-input` and `#search-sheet-input` to match the existing `aria-autocomplete`/`aria-controls` attributes, and adds a Korean E2E regression report under `docs/qa/2026-05-12-e2e-regression.md`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 69fdfd51896861b925ff9194f5a2aca12f246aed. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
