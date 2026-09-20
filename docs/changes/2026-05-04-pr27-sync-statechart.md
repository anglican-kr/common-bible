---
date: 2026-05-04
pr: 27
branch: feat/sync-statechart
title: "refactor: Drive sync statechart 패턴 재작성 + e2e 테스트 (PR 5/5)"
---

# refactor: Drive sync statechart 패턴 재작성 + e2e 테스트 (PR 5/5)

## Summary

PR 3에서 버그봇이 6건을 연속 발견한 근본 원인을 해소합니다.

### 문제

`_netFailCount`, `_conflictCount`, `_reAuthCount`, `_backoffTimer` 4개 변수가 FSM 상태 전이 표 밖에서 클로저 변수로 분산 관리됨. "어떤 전이에서 어떤 카운터/타이머를 리셋해야 하는가"가 명시되지 않아 버그가 반복 발생.

### 해결: `_transition(nextState, ctxPatch, event)`

모든 상태 + 컨텍스트 변경이 단일 함수를 통해서만 발생:

```js
// 기본: 모든 카운터 0, 타이머 clear
_transition(S.IDLE, {}, event);

// 유지가 필요한 값만 명시적 opt-in
_transition(S.IDLE, { netFails: _ctx.netFails + 1, backoffTimer: timer }, event);
_transition(S.AUTHENTICATING, { reAuthFails: _ctx.reAuthFails + 1 }, event);
```

`_emptyCtx()` 가 기본값이므로 **"리셋 누락"이 구조적으로 불가능**. 명시한 것만 살아남습니다.

### e2e 테스트 (`tests/e2e/test_drive_sync.py`)

| 시나리오 | 검증 |
|----------|------|
| A 업로드 → B 다운로드 | 기본 동기화 흐름 |
| A·B 동시 추가 | per-record LWW — 양쪽 북마크 모두 보존 |
| 412 발생 | 재머지 후 IDLE 복귀, ERROR/OFFLINE 아님 |
| 로그아웃 후 변경 | Drive에 업로드되지 않음 |
| v0 레거시 마이그레이션 | 북마크 보존 + Drive 업로드 |

**FakeDrive**: `page.route`로 가로채는 인메모리 Drive 서버 (ETag, 412 시뮬레이션 포함)
**GIS 스텁**: 실제 OAuth 없이 즉시 토큰 부여

## Test plan

```bash
python3 scripts/serve.py 8080
pytest tests/e2e/test_drive_sync.py -v
```

- [ ] 5개 시나리오 모두 PASS
- [ ] 기존 e2e 테스트 회귀 없음 (`pytest tests/e2e/ -v`)
- [ ] Hard refresh 후 Drive 연결 → 동기화 정상

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Refactors core Drive sync/auth retry logic (state transitions, backoff, conflict handling), which can affect reliability and user sessions; added e2e tests reduce regression risk but behavior changes are non-trivial.
> 
> **Overview**
> Refactors `js/sync/state-machine.js` into a stricter *statechart* pattern by introducing a single `_transition(next, ctxPatch, event)` that **owns all state changes and retry/backoff counters**, clearing timers/counters by default and requiring explicit opt-in to carry them across transitions.
> 
> Extracts token handling and `SYNC_FAIL` branching into helpers (`_storeToken`, `_reqSilentToken`, `_handleSyncFail`), tightening behavior for **401 re-auth retries**, **412 conflict re-merge retries**, deterministic failures (`no_token`/`exception`) to `ERROR`, and network/5xx exponential backoff to `OFFLINE`.
> 
> Adds `tests/e2e/test_drive_sync.py` Playwright tests with an in-memory `FakeDrive` (ETag/412 support) and GIS stub to cover upload→download across devices, concurrent merges, 412 recovery, sign-out behavior, and legacy localStorage migration.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 7985354cb510e808d454cab11f8e459be2a90d05. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
