---
date: 2026-05-09
pr: 96
branch: chore/test-naming-convention
title: "chore: 유닛 테스트 파일 명명 컨벤션 도입 (ADR-013 개정)"
---

# chore: 유닛 테스트 파일 명명 컨벤션 도입 (ADR-013 개정)

## Summary
- ADR-013 개정 블록 추가 — \`tests/unit/<source-basename>.test.js\` 컨벤션 명시
- 테스트 파일 2건 리네임:
  - \`tests/unit/search-history.test.js\` → \`tests/unit/storage.test.js\` (\`js/app/storage.js\`의 일부분이라 모듈명 명시)
  - \`tests/unit/transport-pkce.test.js\` → \`tests/unit/transport.test.js\` (PKCE 영역만 강조하던 이름을 모듈명으로 정리)
- 두 리네임 파일의 자체 헤더 코멘트(\"Run with: ...\") 갱신
- 활성 참조 갱신: \`js/app.js\`·\`js/app/storage.js\` 코멘트, ADR-011/014/017, design 문서(\`search-history.md\`, \`pkce-migration.md\`), CLAUDE.md 파일 트리·테스트 절
- 과거 진행 일지·worklog·audit은 시점 기록이라 보존 (그 시점 사실이 맞음)
- CI 워크플로(\`tests/unit/*.test.js\` glob)는 자동으로 새 이름 픽업 — workflow YAML 변경 0

## 동기
지난 세션에서 사용자가 \`search-history.test.js\` vs \`search.test.js\` 이름이 비슷해 혼동된다고 지적. 한 모듈 = 한 테스트 파일 원칙을 명시해 향후 테스트 추가 시에도 일관성 유지.

## Test plan
- [x] \`node --test tests/unit/*.test.js\` 147/147 통과 (sync 111 + storage 33 + search 36 — wait, count check)
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [ ] CI 자동 실행 결과 green

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk because this PR is primarily test file renames and documentation/comment updates; behavior and production code are unchanged aside from reference strings.
> 
> **Overview**
> Introduces a clarified ADR-013 unit-test naming convention: `tests/unit/<source-basename>.test.js`, with intra-module concerns split via `// ── <영역> ──` sections.
> 
> Renames the two existing unit tests to match their source modules (`search-history.test.js` → `storage.test.js`, `transport-pkce.test.js` → `transport.test.js`) and updates in-code comments/docs/ADRs/design notes to reference the new filenames, without changing CI globs or test logic.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ac511bd62b77174f558d59c1bc4f4003be82a532. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
