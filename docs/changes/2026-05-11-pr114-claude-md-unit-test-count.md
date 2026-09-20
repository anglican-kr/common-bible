---
date: 2026-05-11
pr: 114
branch: docs/claude-md-unit-test-count
title: "docs: CLAUDE.md 유닛 테스트 케이스 수 갱신 (309 → 473)"
---

# docs: CLAUDE.md 유닛 테스트 케이스 수 갱신 (309 → 473)

## Summary

app 레이어 no-jsdom 유닛 테스트 확장 1차 의제 완료 결과를 CLAUDE.md에 반영.

- 케이스 수: 309 → **473** (+164, **93% 증가**)
- 6 PR 묶음: #106(storage) + #108(helpers) + #109(views-routing) + #110(install) + #112(bookmark) + #113(search)
- 부수 결정 기록: ADR-013 dual-track 개정(#105) + CI 트리거 dedup(#111)

## Test plan

- [x] 코드 변경 0
- [x] 문서 단독 변경
