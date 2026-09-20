---
date: 2026-05-11
pr: 105
branch: docs/adr-013-jsdom-dual-track
title: "docs: ADR-013 jsdom dual-track 허용 (개정)"
---

# docs: ADR-013 jsdom dual-track 허용 (개정)

## Summary

- ADR-018 모듈 분할 종료(2026-05-10) 이후 app 레이어 미커버 영역으로 유닛 테스트를 확장하면서 발견된 한계 정리
- layout(`getBoundingClientRect`) / Canvas(`settings-ui` icon recoloring) / touch gesture(`Pull-to-refresh`)에 한해 jsdom 또는 happy-dom 도입 허용
- "0 의존성"을 "Node 외 0 의존성"으로 완화. 첫 jsdom 사용 PR이 `package.json`·`.gitignore`·CI를 동반
- 기본 패턴은 `node:vm` + 수동 스텁 그대로 유지

## Test plan

- [x] 코드 변경 없음 → 회귀 가능성 0
- [x] 문서 단독 변경 (CI 자동 실행됨)
