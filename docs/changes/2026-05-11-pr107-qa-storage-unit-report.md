---
date: 2026-05-11
pr: 107
branch: docs/qa-storage-unit-report
title: "docs: storage 유닛 테스트 QA 보고서 + QA 폴더 컨벤션 확장"
---

# docs: storage 유닛 테스트 QA 보고서 + QA 폴더 컨벤션 확장

## Summary

머지된 PR #106에 QA 보고서 첨부가 늦어서 별도 PR로 분리. main 기준으로 보면 같은 의제의 후속 문서.

- `docs/qa/2026-05-11-unit-storage.md` — 저장 영역(읽던 위치·오디오·외관·북마크·설치 안내) 자동 검증 범위 확장에 대한 비기술 독자용 보고서
- `docs/qa/README.md` — 컨벤션을 e2e 전용에서 유닛 테스트도 포함하도록 확장 (`YYYY-MM-DD-unit-{topic}.md`). 기존 e2e 파일명은 그대로

## Test plan

- [x] 코드 변경 0 — 회귀 가능성 0
- [x] 문서 단독 변경
