---
date: 2026-05-06
pr: 40
branch: fix/sync-token-empty-response
title: "fix: GIS 토큰 콜백 빈 응답 시 AUTHENTICATING stuck 방지"
---

# fix: GIS 토큰 콜백 빈 응답 시 AUTHENTICATING stuck 방지

## Summary

PR #39 (TS 마이그레이션) 회귀 fix. Cursor Bugbot이 리포트한 잠재 stuck 시나리오 차단.

## 배경

`js/sync/state-machine.js` GIS 토큰 콜백 원본:

```js
(resp) => dispatch({ type: resp.error ? "TOKEN_FAIL" : "TOKEN_OK", ...resp, reason: resp.error })
```
삼항 연산자가 둘 중 하나를 무조건 발화.

PR #39에서 TS 디스크리미네이티드 유니온 narrowing 위해 if/else if로 분리:

```js
if (resp.error)             dispatch({ type: "TOKEN_FAIL", ... });
else if (resp.access_token) dispatch({ type: "TOKEN_OK", ... });
```
**둘 다 falsy면 어느 쪽도 발화 안 됨 → AUTHENTICATING 영구 stuck.** 타임아웃 복구 없음.

## Fix

명시적 else 분기로 \`TOKEN_FAIL { reason: "empty_response" }\` 발화. GIS가 계약상 둘 중 하나는 보장하지만 SDK 변경/전송 계층 손상에 대비.

## 검증

- ✅ \`tsc --noEmit\` 0 errors
- ✅ e2e 21/21 통과 (drive_sync + drive_sync_ios)

## Test plan

- [ ] CI 통과 확인
- [ ] 정상 OAuth 흐름 회귀 없는지 로컬 확인 (TOKEN_OK 분기 그대로 작동)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> <sup>[Cursor Bugbot](https://cursor.com/bugbot) is generating a summary for commit babfbb0017dbcd6ee2807662e32cc9b40fd4e63a. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
