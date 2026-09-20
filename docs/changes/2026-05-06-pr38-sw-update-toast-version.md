---
date: 2026-05-06
pr: 38
branch: fix/sw-update-toast-version
title: "fix: SW 업데이트 토스트가 새 버전 대신 현재 버전을 표시하던 문제 수정"
---

# fix: SW 업데이트 토스트가 새 버전 대신 현재 버전을 표시하던 문제 수정

## Summary
- 토스트 \"새 버전이 있습니다: …\"가 active SW가 서빙하는 `version.json`(=실행 중인 구 버전)을 보여주던 문제 수정
- waiting SW가 자신의 `CACHE_NAME` 안에 fresh로 캐시한 `version.json`을 `GET_VERSION` 메시지 + `MessageChannel`로 응답하도록 변경 — 곧 설치될 버전이 노출되며 오프라인에서도 동작
- e2e 회귀 가드 3건 추가 (응답 케이스 라벨 검증, 메시지 전송 검증, 무응답 시 1.5s 타임아웃 → \"최신 버전\" 폴백)

## 변경 파일
- [sw.js](sw.js): `message` 핸들러에 `GET_VERSION` 분기 추가 — `caches.open(CACHE_NAME)` → `match('/version.json')` → `port.postMessage({ version })`
- [js/app.js](js/app.js): `showUpdateToast`가 `loadVersion()`(active SW 경유, 메모리 캐시) 대신 `fetchWaitingVersion(waitingSW)` 호출. 1.5s 타임아웃·예외 시 빈 문자열 → 기존 \"최신 버전\" 폴백 유지
- [tests/e2e/test_update_toast.py](tests/e2e/test_update_toast.py): GET_VERSION 라운드트립 stub 헬퍼 + 신규 테스트 3건

## Test plan
- [x] `pytest tests/test_completeness.py tests/test_ordering.py tests/test_snapshots.py` (선행 `isa-2` 실패는 main 기준 동일, 본 변경과 무관)
- [x] `pytest tests/e2e/` 163건 전부 통과 (update-toast 6건 포함)
- [ ] 다음 릴리스 (`scripts/release.py patch`)에서 실제 SW 업데이트 흐름으로 토스트가 새 버전 문자열을 표시하는지 수동 확인

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches service worker messaging and cache reads; a mistake could break update prompts or SW lifecycle behavior across browsers, though the change is narrowly scoped and has E2E coverage.
> 
> **Overview**
> Fixes the SW update toast so it displays the *incoming* (waiting) service worker’s version instead of the currently active app version.
> 
> `js/app.js` now queries the waiting SW via `MessageChannel` (`GET_VERSION`) with a 1.5s timeout/empty-string fallback, and `sw.js` handles `GET_VERSION` by reading `/version.json` from the waiting SW’s own `CACHE_NAME` and replying with `{ version }`.
> 
> Adds E2E coverage to assert the `GET_VERSION` roundtrip (label uses the waiting SW’s version), that the message is sent, and that the UI falls back to “최신 버전” when the SW doesn’t respond.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ed7f4d4393ac706a496ac449f1b29391f4099c45. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
