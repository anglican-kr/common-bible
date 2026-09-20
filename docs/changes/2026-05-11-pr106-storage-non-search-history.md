---
date: 2026-05-11
pr: 106
branch: test/storage-non-search-history
title: "test: storage.js 비-search-history 영역 유닛 테스트 추가"
---

# test: storage.js 비-search-history 영역 유닛 테스트 추가

## Summary

- ADR-018 모듈 분할 종료 후 [project_unit_test_expansion 의제](../../docs/decisions/013-client-js-unit-tests.md) 첫 단계
- `tests/unit/storage.test.js` 확장: 19 → 83 케이스 (+64), 전체 245 → 309
- slice 추출 로더(BEGIN/END 마커) → IIFE 전체 로드로 통일. `window.appStorage` 공개 API를 그대로 호출 — 실제 런타임 계약 검증
- `syncStoreV2` / `driveSync` / `syncDebugLog` 스파이로 사이드이펙트 호출 횟수 확인

## 새로 커버

- **reading position**: save/load/clear + sync 통지 + SecurityError 흡수
- **audio time**: bookId·chapter mismatch / time<=0 / 미저장 / 파싱 실패
- **startup behavior, font size** (FONT_SIZES whitelist + DEFAULT fallback), **color scheme, theme, book order** — 모두 unknown 값 fallback + sync 통지
- **generateId**: base36 형식 + 100회 unique
- **bookmarks**: syncStoreV2 우선 / localStorage 폴백 / parse 오류
- **_maybeRequestPersist**: granted/denied/rejected/no-storage/no-method 분기 + one-shot 가드 + saveBookmarks 트리거

## Test plan

- [x] `node --test tests/unit/storage.test.js` — 83 통과
- [x] `node --test tests/unit/*.test.js` — 309 통과 (회귀 0)
- [x] CI green
