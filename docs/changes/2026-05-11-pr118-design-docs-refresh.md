---
date: 2026-05-11
pr: 118
branch: docs/design-docs-refresh
title: "docs: docs/design/ 4개 살아있는 설계 문서 status 현행화"
---

# docs: docs/design/ 4개 살아있는 설계 문서 status 현행화

## Summary

\`docs/design/\`의 4개 살아있는 설계 문서가 옛 진행 상태로 멈춰 있어 stale. ADR-117에서 ADR status 8건 정정한 것과 같은 정신으로 헤더 + 마무리 일지만 surgical 정정. 본문 변천 기록은 보존(역사적 가치).

## 정정 4건

| 문서 | 이전 status | 정정 |
| --- | --- | --- |
| **app-modularization.md** | 결정 확정 — Phase 1 진행 예정 | **완료** (Phase 1~8 머지, 2026-05-10): \`js/app.js\` 6,082 → 283줄, 9개 도메인 모듈, ESM 일괄 |
| **app-typescript-migration.md** | 1라운드 종료 + 결합 별도 의제로 보류 | **완료** — 1라운드(PR-1~7) + 2라운드(ADR-018 동행, 2026-05-10). 모든 클라이언트 JS 영구 \`// @ts-check\`, \`tsconfig.app.json\` 삭제 |
| **pkce-migration.md** | 단계 5 PR open | **완료** (단계 1~6 머지, 2026-05-08). 후속 Phase 2i까지 종료. 보안 감사 2건 참조 |
| **search-history.md** | 설계 단계 (구현 전) | **완료** — \`createSearchHistoryController\` 운영. 유닛 테스트 66 케이스 |

## 패턴

- 헤더 status 라인 + "종료:" 라인 추가
- 진행 일지(있는 경우) 마지막에 종료 행 한 줄
- 변경 이력(있는 경우) 두세 줄 추가
- 본문 변천 기록은 무수정

## Test plan

- [x] 코드 변경 0, 문서 단독
- [x] 본문 변천 기록 무수정 (역사 보존)
