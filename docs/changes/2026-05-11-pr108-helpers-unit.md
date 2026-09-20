---
date: 2026-05-11
pr: 108
branch: test/helpers-unit
title: "test: helpers.js 유닛 테스트 신설 + QA 보고서"
---

# test: helpers.js 유닛 테스트 신설 + QA 보고서

## Summary

- app 레이어 유닛 테스트 확장 두 번째 단계 ([project_unit_test_expansion 의제](../decisions/013-client-js-unit-tests.md))
- `tests/unit/helpers.test.js` 신설: 309 → 340 케이스 (+31)
- 커버: `_$` / `chUnit` / `el` / `clearNode` / `setInert` / `trapFocus`
- `trapFocus`의 키보드 Tab 사이클 동작 계약을 결정적으로 검증 — 마지막→첫번째 wrap, 첫번째→마지막 wrap, 모달 진입 시점 Shift+Tab, disabled·tabindex=-1 제외, cleanup 함수의 listener 해제까지
- DOM 의존은 hand-written `makeDom()` 스텁으로 처리 (ADR-013 dual-track 기조 유지 — jsdom 미도입)
- `docs/qa/2026-05-11-unit-helpers.md` 동반 (비기술 독자 톤)

## Test plan

- [x] `node --test tests/unit/helpers.test.js` — 31 통과 / 82ms
- [x] `node --test tests/unit/*.test.js` — 340 통과 (회귀 0)
- [x] CI green
