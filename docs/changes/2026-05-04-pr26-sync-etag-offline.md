---
date: 2026-05-04
pr: 26
branch: feat/sync-etag-offline
title: "feat: ETag 낙관적 동시성 + backoff + OFFLINE 상태 (PR 3/4)"
---

# feat: ETag 낙관적 동시성 + backoff + OFFLINE 상태 (PR 3/4)

## Summary

PR 2의 per-record LWW 위에 **동시성 보호 + 네트워크 복원력**을 추가합니다.

### 변경 내용

| 파일 | 내용 |
|------|------|
| `js/sync/transport.js` | `uploadSyncFile`에 `ifMatch` 파라미터 — PATCH 시 `If-Match` 헤더 전송 |
| `js/sync/state-machine.js` | OFFLINE 상태, 412/5xx/network 처리, backoff retry, NET_RECOVERED |
| `js/drive-sync.js` | `window.addEventListener('online')` → dispatch NET_RECOVERED |
| `sw.js` | rev-42 캐시 버전 bump |

### ETag / If-Match

- 다운로드 시 `ETag` 저장 → 업로드 시 `If-Match` 첨부
- Drive가 ETag 불일치(다른 기기 동시 업로드) 감지 시 **412** 반환
- 412 수신 → 재다운로드 → 재머지 → 재업로드 (최대 3회)

### Exponential Backoff

- 5xx / 네트워크 오류 → 1s / 2s / 4s / 8s / 16s + ±250ms jitter
- 5회 연속 실패 또는 `navigator.onLine=false` → **OFFLINE** 상태 전환

### OFFLINE 상태

- OFFLINE 진입 시 재시도 타이머 중지
- `window 'online'` 이벤트 수신 → **NET_RECOVERED** → silent re-auth → 재동기화

## Test plan

- [ ] 두 기기에서 동시 업로드 → 412 후 재머지, 두 변경 모두 보존
- [ ] DevTools Network throttle "Offline" → `[sync] RETRY_SCHEDULED` 로그, OFFLINE 상태
- [ ] Offline 복귀 → `[sync] NET_RECOVERED` → 자동 재동기화
- [ ] backoff 로그: `delayMs` 값이 1000→2000→4000 순서로 증가
- [ ] SYNC_DONE 후 `_netFailCount` 리셋 확인 (다음 실패가 1s부터 시작)

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Changes sync error-handling and retry behavior (ETag `If-Match`, 412 conflict retries, exponential backoff, new `OFFLINE` state), which can affect data freshness and user-visible sync reliability if edge cases are missed.
> 
> **Overview**
> Adds **optimistic concurrency control** to Drive sync by passing downloaded `ETag` via `If-Match` on uploads and handling `412` conflicts with limited automatic re-sync retries.
> 
> Improves **network resilience** by classifying 0/5xx/network failures, adding exponential backoff retries, and introducing an `OFFLINE` state that recovers on the browser `online` event via a `NET_RECOVERED` dispatch and silent re-auth. Also bumps the service worker cache version to `rev-42`.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 0601bd083e29b2af56e896e2412639a9f9240ee2. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
