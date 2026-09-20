---
date: 2026-05-06
pr: 43
branch: fix/ios-auto-resume-sync
title: "fix: iOS 앱 재실행 시 Drive 동기화 자동 재개 (Phase 2g)"
---

# fix: iOS 앱 재실행 시 Drive 동기화 자동 재개 (Phase 2g)

## Summary

- iOS PWA에서 한 번 연결한 뒤 앱 종료/재실행 시 동기화가 해제된 것처럼 보이는 문제 수정. ADR-011 Phase 2f 매트릭스의 "iOS PWA standalone 페이지 로드 동작: 풀페이지 리디렉션" 항목과 실제 구현 갭 정정.
- `bible-drive-sync-email`이 저장돼 있고 `bible-drive-silent-blocked` 플래그가 없으면 cold start 시 `prompt=none` silent OAuth 리디렉션을 자동 시도. silent 실패는 토스트 없이 플래그만 설정해 다음 오픈 시 자동 재시도 차단 — 사용자 "연결" 클릭(`signIn`)이나 `SYNC_DONE`에서 해제.
- README에 플랫폼별 동작 차이 섹션 추가, ADR-011에 Phase 2g 절 추가, 작업 일지/CLAUDE.md 갱신.

## 변경 파일

| 영역 | 파일 |
|------|------|
| 코드 | \`js/sync/state-machine.js\` (DISABLED+ENABLE iOS 분기 + SYNC_DONE 플래그 정리), \`js/sync/transport.js\` (\`silent\` 필드 stash/회수), \`js/drive-sync.js\` (IIFE silent 분기, signIn/signOut 플래그 정리), \`js/types.d.ts\` |
| 테스트 | \`tests/unit/state-machine.test.js\` (case 3 갱신 + 3a~3e 신규 5건), \`tests/unit/harness.js\` (상수 export) |
| 문서 | \`docs/decisions/011-bookmark-sync.md\` (Phase 2g), \`README.md\` (플랫폼별 동작 차이) |

## 동작 매트릭스 (Phase 2g 후 iOS)

| 상태 | localStorage | 페이지 로드 동작 |
|------|--------------|-----------------|
| 첫 방문 / signOut 직후 | \`bible-drive-sync=0\` | early return (비활성) |
| 한 번 연결, 정상 흐름 | enabled, email 저장, silent-blocked 없음 | **silent prompt=none 자동 리디렉션** (브리프 깜박임 → IDLE → 자동 sync) |
| silent 직전 실패 후 재오픈 | silent-blocked=1 | NEEDS_CONSENT (사용자 "연결" 클릭 대기) |
| 자동 시도 cap 도달 | redirect-attempts ≥ 3 | ERROR + snackbar |

## 알려진 한계

- 매 cold start에 accounts.google.com round-trip 1회 (느린 망에서 ≤ 3초 깜박임).
- iOS Safari 7일 ITP 후 PWA storage 정리 시 email도 함께 사라짐 → 첫 연결 흐름으로 안전 회귀.
- Implicit Flow 특성상 refresh token 부재 — Phase 2g는 그 한계 안에서 가능한 최선.

## Test plan

- [x] \`node --test tests/unit/state-machine.test.js\` 20/20 통과 (3a/3b/3c/3d/3e 신규 케이스 포함)
- [x] \`npx tsc -p tsconfig.json --noEmit\` 0 error
- [x] \`npx tsc -p tsconfig.worker.json --noEmit\` 0 error
- [ ] iOS 18+ 실기기 테스트 — 첫 연결 후 앱 종료/재실행 시 silent round-trip 깜박임 ≤ 3초, "해제" 버튼 노출 확인
- [ ] iOS 실기기 — Google 계정 외부 revoke 후 재실행 시 silent-blocked=1 + "연결" 버튼 (반복 깜박임 없음)
- [ ] iOS 실기기 — \`signOut\` 후 재실행 시 첫 연결 흐름(NEEDS_CONSENT) 정상 동작
- [ ] Android Chrome 회귀 — GIS+FedCM silent token 흐름 영향 없음 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches iOS-specific OAuth redirect and sync state transitions, so regressions could impact Drive connectivity or cause redirect loops; mitigated by explicit caps/flags and new unit test coverage.
> 
> **Overview**
> Fixes iOS PWA cold-start behavior so Drive sync **automatically resumes after app relaunch**: when a prior account email is saved, the sync state machine now triggers an iOS full-page OAuth redirect with `prompt=none` instead of parking in `NEEDS_CONSENT`.
> 
> Adds a **silent-failure guardrail** (`bible-drive-silent-blocked`) to prevent repeated app-open redirect flashes when Google requires interaction; the redirect callback now carries a `silent` flag end-to-end (`transport.consumeRedirectCallback` → `drive-sync` IIFE), and success/`SYNC_DONE` clears the block.
> 
> Introduces Node-built-in **unit tests for the sync state machine** (vm-based harness) and wires them into CI (`node --test` on Node 24). Also adds `tsconfig.json`/`tsconfig.worker.json` and expands `js/types.d.ts` to support stricter JSDoc-based type checking, with docs updated to reflect the new Phase 2g behavior and testing/typing additions.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 56c55ee915ee037c85265f3abf08d01c6ff3f487. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
