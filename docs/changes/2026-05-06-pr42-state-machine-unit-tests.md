---
date: 2026-05-06
pr: 42
branch: chore/state-machine-unit-tests
title: "chore: state-machine 유닛 테스트 + CI 워크플로우"
---

# chore: state-machine 유닛 테스트 + CI 워크플로우

## Summary

`js/sync/state-machine.js` 상태 전이 로직에 유닛 테스트 도입. 브라우저 없이 Node.js 24 내장 `node:vm` + `node --test`로 실행, npm/package.json 불필요.

## 동기

state-machine.js는 fix 커밋이 반복돼 왔습니다:
- `reAuthFails` 카운터 누락 (commit 682292d)
- iOS redirect cap 미처리 (commit e6179d1)
- 빈 토큰 acceptRedirectToken no-op (commit 682292d)
- `OFFLINE → NET_RECOVERED` iOS 분기 누락 (commit 87b1896)
- ...

PR #39의 `// @ts-check` + JSDoc은 컴파일 타임 타입 안전성을 잡았지만, **런타임 상태 전이 자체**는 검증되지 않았습니다. 이 PR이 그 갭을 닫습니다.

## 변경 파일

| 파일 | 역할 |
|------|------|
| `tests/unit/harness.js` | `node:vm` 컨텍스트 셋업 + stub 팩토리. `loadMachine(opts)`로 매 테스트마다 독립 클로저 |
| `tests/unit/state-machine.test.js` | 15개 회귀 방어 테스트 |
| `.github/workflows/test.yml` | push/PR마다 `node --test` 자동 실행 |

## 테스트 시나리오 (15개)

### Group 1: ENABLE 분기
1. 초기 상태는 DISABLED
2. non-iOS + GIS 미준비 → INITIALIZING
3. **iOS ENABLE → NEEDS_CONSENT** (Phase 2f 회귀)

### Group 2: acceptRedirectToken
4. **`acceptRedirectToken('')` no-op** (commit 682292d)
5. `acceptRedirectToken(null)` no-op
6. 유효 토큰 → IDLE → SYNCING → IDLE
7. **토큰 수신만으로는 redirect-attempts 카운터 리셋 안 됨** (loop cap)

### Group 3: SYNC_DONE
8. **SYNC_DONE 시에만 redirect-attempts 0으로 리셋**

### Group 4: SYNC_FAIL 401
9. non-iOS 401 → IDENTIFYING
10. **iOS active-reading 401 → NEEDS_CONSENT** (commit 682292d)
11. 401 → REAUTH 로그 `attempt=1`

### Group 5: OFFLINE + NET_RECOVERED
12. **iOS OFFLINE → NET_RECOVERED → NEEDS_CONSENT** (commit 87b1896)
13. non-iOS OFFLINE → NET_RECOVERED → AUTHENTICATING

### Group 6: _beginRedirect cap
14. attempts<MAX → beginRedirectAuth 호출, 카운터 +1
15. **attempts≥MAX → ERROR + beginRedirectAuth 미호출** (commit e6179d1)

## CI 범위

플랜 원안에는 데이터 파이프라인 잡(Level 1-3)도 있었으나 GitHub Actions 환경에서 재현 불가 — `data/bible/*.json`은 `.gitignore`이고 `data/source/`는 private submodule. **유닛 테스트 잡만 포함**, 데이터 파이프라인 테스트는 로컬에서 별도 실행.

## 보안 검토

워크플로우 파일은 `${{ github.event.* }}` 신뢰할 수 없는 입력을 `run:` 명령에 인터폴레이션하지 않음. 단순 `node --test` 고정 경로 호출만.

## 검증

- ✅ `node --test tests/unit/state-machine.test.js` → 15/15 통과 (~70ms)
- ✅ 회귀 시나리오 매핑된 commit hash 함께 코멘트로 명시

## Test plan

- [ ] CI 잡 통과 확인 (Node 24 + Ubuntu)
- [ ] 로컬에서 `node --test tests/unit/state-machine.test.js` 재실행 정상

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Low Risk**
> Low risk: adds CI workflow and Node-based unit tests only, with no production code changes. Main risk is CI noise/flakiness due to timing assumptions (Node 24, async drains), but it doesn’t affect runtime behavior.
> 
> **Overview**
> Adds a GitHub Actions workflow (`.github/workflows/test.yml`) to run `node --test` on every push/PR using Node 24.
> 
> Introduces a Node `vm`-based harness (`tests/unit/harness.js`) that loads `js/sync/state-machine.js` with stubbed browser globals and injectable transport/store behaviors.
> 
> Adds a focused unit test suite (`tests/unit/state-machine.test.js`) with 15 regression tests covering key state transitions around iOS redirect auth, `acceptRedirectToken` no-ops, `SYNC_DONE` redirect-attempt reset, 401/reauth handling, `OFFLINE → NET_RECOVERED` branching, and redirect-attempt caps.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit b895bd107aa5574cde8177249df0003afb734713. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
