---
date: 2026-05-11
pr: 111
branch: chore/ci-dedup-triggers
title: "chore(ci): 같은 테스트 두 번 도는 문제 정리"
---

# chore(ci): 같은 테스트 두 번 도는 문제 정리

## Summary

`push`와 `pull_request` 트리거가 둘 다 \`["**"]\`였어서, PR이 열린 브랜치에 커밋을 푸시하면 같은 유닛 테스트 워크플로가 두 번 도는 문제. CI 분이 정확히 2배.

## 변경

\`push\` 트리거는 \`main\` 한정으로 좁힘 (머지 후 사후 검증용). 그 외 브랜치는 \`pull_request\` 트리거로만 처리.

## 결과

- \`main\` 푸시 → 1회 (push)
- 다른 브랜치 + 열린 PR → 1회 (pull_request)
- PR 없는 feature 브랜치 → CI 미실행 (PR 열어야 트리거)

## Test plan

- [x] 워크플로 변경 외 코드 변경 0
- [x] 본 PR이 머지된 후, 다음 feature PR 푸시에서 \`Tests / Unit tests\` 체크가 1회만 도는지 확인 (현재 PR 자체는 머지 전이므로 여전히 2회 가능)
