---
date: 2026-05-06
pr: 37
branch: feat/ios-oauth-redirect
title: "feat: iOS OAuth 풀페이지 리디렉션 (Phase 2f) — 1.4.2"
---

# feat: iOS OAuth 풀페이지 리디렉션 (Phase 2f) — 1.4.2

## Summary

- iOS Safari/PWA에서 Google Drive 연결 시 발생하던 "팝업 윈도우를 열려고 시도" 차단 안내를 제거. iOS는 GIS Token Client(popup-only)를 우회하고 OAuth 2.0 Implicit Flow의 풀페이지 리디렉션을 사용하도록 변경.
- Phase 2d/2e의 잘못된 가정 정정 — Safari는 FedCM을 영구 미지원이며, GIS Token Client는 popup-only라서 사용자 제스처 안에서도 iOS PWA standalone 모드는 popup을 차단함.
- Drive 동기화를 "실험" 단계로 라벨링, 스낵바 가독성/폰트 개선, 1.4.2 릴리스.

## 핵심 변경

- **`js/sync/transport.js`** — `isIOS()`, `beginRedirectAuth()`, `consumeRedirectCallback()` 신규. state nonce(32바이트) + return URL을 sessionStorage에 저장하고 OAuth 엔드포인트로 풀페이지 리디렉션 후 hash 검증.
- **`js/sync/state-machine.js`** — 4개 진입점에 iOS 분기, `acceptRedirectToken` 신규, **하이브리드 401**: 사용자가 활발히 읽는 중이면 snackbar+`NEEDS_CONSENT` 보류, 유휴 시 자동 풀페이지 리디렉션. `localStorage` 기반 redirect 카운터(상한 3회)로 무한 루프 차단.
- **`js/drive-sync.js`** — top-level IIFE로 라우팅 전 hash 흡수+`replaceState`(토큰 노출 < 100ms), 글로벌 인터랙션 추적, `signIn()` iOS 즉시 리디렉션. 스낵바 컬러 토큰 반전(`bg=--text`, `fg=--bg`)으로 라이트 모드 가독성 회복, sans 폰트 명시.
- **`js/app.js`** — 설정 라벨 "백업 & 동기화 (실험)" + 실험 단계 안내 문구.
- **`docs/decisions/011-bookmark-sync.md`** — Phase 2f 섹션 추가, OAuth Flow 표를 비-iOS/iOS로 분리, 동작 매트릭스 갱신.
- **`tests/e2e/test_drive_sync_ios.py`** — 신규 8개 시나리오 (UA 감지, 라운드트립, state 검증, error 처리, 카운터 리셋, returnTo 보존, 활발한 읽기 보류, 유휴 자동 리디렉션). 비-iOS 기존 8개 회귀 없음.
- **버전 + SW 캐시 bump** — 1.4.1 → 1.4.2, rev-45 → rev-46.

## 외부 의존 (배포 전 필수)

Google Cloud Console OAuth 클라이언트(dev/prod 양쪽)의 **Authorized redirect URIs**에 등록되어 있어야 함:이미 등록 완료

## Test plan

- [x] `pytest tests/e2e/test_drive_sync.py tests/e2e/test_drive_sync_ios.py` — 16/16 통과
- [ ] iPhone Safari 일반 탭에서 bible.anglican.kr → 설정 → 연결 → 깜박임 후 IDLE, 팝업 안내 미발생
- [ ] iPhone PWA(홈 화면 추가, iOS 26 기본) → 동일 시나리오, standalone 윈도우 안에서 라운드트립
- [ ] 토큰 만료 시뮬레이션 → 백그라운드 재진입 시 자동 리디렉션, 활발한 읽기 중에는 snackbar만
- [ ] state 변조 시나리오 → 토큰 무시 + 진단 로그에 `state_mismatch`
- [ ] Android Chrome / 데스크톱 Chrome → 기존 GIS popup 흐름 회귀 없음

🤖 Generated with [Claude Code](https://claude.com/claude-code)



<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **High Risk**
> High risk because it changes authentication/reauthentication behavior and introduces an iOS-only OAuth implicit redirect flow with new state/nonce handling and redirect-loop controls, which can impact login reliability and token security.
> 
> **Overview**
> Implements **iOS-only Google Drive sync authentication via full-page OAuth redirect (Implicit Flow)** to avoid Safari/PWA popup blocking, including UA-based iOS detection, redirect initiation, and synchronous callback consumption with nonce validation + hash cleanup.
> 
> Updates the sync state machine to **bypass GIS on iOS**, accept injected redirect tokens, handle 401 reauth with an *active-reading vs idle* policy, and cap automatic redirect retries via `localStorage` to prevent loops; `drive-sync.js` now absorbs redirect callbacks before routing, tracks user interaction timestamps, and changes `signIn()` to redirect immediately on iOS.
> 
> Adds Playwright e2e coverage for the iOS redirect flow (success, error/state-tamper, returnTo preservation, 401 behaviors, loop cap), relabels the feature as experimental in settings, bumps SW cache + app version, and documents Phase 2f decisions/required redirect URI configuration in the ADR.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit 6995d179781c3ced0eb5f59d44b3e205ce1acc00. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
