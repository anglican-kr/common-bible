---
date: 2026-05-07
pr: 54
branch: feat/pkce-step3-state-machine
title: "feat: state-machine + drive-sync에 PKCE silent refresh 결합 (Phase 2h 단계 3)"
---

# feat: state-machine + drive-sync에 PKCE silent refresh 결합 (Phase 2h 단계 3)

## 요약

PKCE 마이그레이션 단계 3 — state-machine과 drive-sync facade에 silent refresh + redirect-PKCE 흐름을 결합. **기존 GIS / Implicit 흐름은 그대로 살아있어 사용자 영향 0** (IDB에 refresh token 없으면 기존 경로로 폴백).

## state-machine.js

- **`_attemptSilentRefresh(ctxPatch?)`**: IDB의 refresh token으로 access 갱신. 4가지 결말 — 토큰 없음(`false` 반환, 폴백) / 성공(IDLE) / invalid_grant(IDB clear + NEEDS_CONSENT, 스낵바 없음) / 5xx·네트워크(OFFLINE)
- **race 가드**: 결과 적용 시점에 `IDLE` 또는 `ERROR`면 폐기 — legacy 경로가 먼저 settled한 상태를 silent 결과로 뒤집지 않음
- **`acceptRedirectCode(code, verifier)`**: PKCE 콜백 code를 access+refresh token 쌍으로 교환 → IDB 저장 → IDLE
- **`enable()`**: 동기 dispatch 유지 + silent refresh fire-and-forget (설계서 §6.2 결정 — 기존 테스트 호환성)
- **`_handleSyncFail("401")`**: MAX_REAUTH cap 체크를 silent refresh 진입 전에 수행. **만성 401 무한 루프 방지** (refresh가 매번 성공해도 Drive가 계속 401하면 cap에 걸려 ERROR). reAuthFails는 IDLE 전이 시 carry forward해 successful SYNC_DONE 전까지 누적

## drive-sync.js

- IIFE에 PKCE 콜백 흡수 분기 추가. 별도 sessionStorage 키 `bible-drive-redirect-state-pkce` 사용해 구 implicit과 절대 교차 처리되지 않음
- `initDriveSync`에 `__pendingRedirectCode` 분기 추가, `_machine.acceptRedirectCode` 호출

## 단계 3의 안전성

| 사용자 시나리오 | 단계 3 후 동작 |
|---|---|
| 기존 사용자 (IDB 빔) | silent refresh 즉시 false → 기존 INITIALIZING / IDENTIFYING / iOS redirect 흐름 그대로 |
| 단계 4 머지 전 신규 연결 | signIn() 시 GIS Token Client 또는 iOS implicit → access만 받음 → IDB 빈 채 유지 |
| 단계 4 머지 시점 | 모든 사용자 cold start 1회 NEEDS_CONSENT 통과 후 PKCE 흐름 진입 (별도 PR) |

## 새 설계 문서

`docs/design/pkce-migration.md` — Phase 2h 전체 살아있는 설계 문서 신규 추가:
- 1. 개요 / 2. 현재 코드베이스 출발점 / 3. 목표 설계 (인증 흐름 5종, 상태 머신, 저장소 스키마)
- 4. 보안 모델 (위협 모델, 방어 레이어, 받아들인 트레이드오프)
- 5. 마이그레이션 전략 (단계별 변경/롤백 매트릭스, 기존 사용자 전환)
- **6. 단계 3 상세 설계** (함수 계약, race 분석, 동기 vs 비동기 결정, 테스트 매트릭스)
- 7. 후속 단계 미리보기 / 8. 외부 의존 / 9. 부록 (RFC 7636, AES-GCM 규약)

ADR-011 Phase 2h 섹션 + CLAUDE.md 현재 상태도 동반 갱신.

## Test plan

- [x] `node --test tests/unit/*.test.js` — **70/70 통과** (state-machine 33 + refresh-store 13 + transport-pkce 23 + 1)
  - Group 7 (silent refresh) 7건: enable() 시점 IDB 토큰 있음/없음, rotation/no-rotation, invalid_grant, 5xx, race lost
  - Group 8 (401 → refresh) 4건: silent 회복, IDB 빔 폴백, invalid → NEEDS_CONSENT, **만성 401 cap 회귀 (23a)**
  - Group 9 (acceptRedirectCode) 3건: 정상, 빈 인자, 교환 실패
- [x] `tsc -p tsconfig.json --noEmit` / `tsc -p tsconfig.worker.json --noEmit` — 0 error
- [x] 기존 20건 회귀 없음

## 다음 단계

[설계 문서 §7](docs/design/pkce-migration.md) 단계 4: GIS 제거 + 흐름 일원화 (signIn → PKCE redirect, INITIALIZING/IDENTIFYING 상태 제거, GIS 스크립트 제거). 사용자 가시 변경 — 모든 기존 사용자가 cold start 1회 NEEDS_CONSENT 통과.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

<!-- CURSOR_SUMMARY -->
---

> [!NOTE]
> **Medium Risk**
> Touches OAuth/token handling and re-auth flows (including redirect callback parsing and refresh-token usage), so regressions could break Drive sync login/reauth despite extensive unit coverage and legacy fallback paths.
> 
> **Overview**
> **Phase 2h 단계 3:** Drive 동기화 인증에 *PKCE 기반 code 콜백 흡수 + refresh token silent refresh* 경로를 기존 GIS/Implicit 흐름 옆에 추가했습니다.
> 
> `drive-sync.js`는 부팅 IIFE에서 PKCE 콜백을 먼저 처리해 `__pendingRedirectCode`로 stash하고(실패 fallback 시 query string을 제거해 code가 URL/히스토리에 남지 않게 수정), `initDriveSync()`에서 이를 `acceptRedirectCode()`로 위임합니다.
> 
> `state-machine.js`는 `enable()` 및 401 재인증 시 `refreshStore`의 refresh token으로 `_attemptSilentRefresh()`를 비동기로 우선 시도하고(성공/invalid/네트워크 분기, rotation 저장, DISABLED·IDLE·SYNCING 레이스 가드, MAX_REAUTH 만성 401 루프 차단), PKCE code→token 교환을 처리하는 `acceptRedirectCode()`를 추가했습니다.
> 
> 테스트 하네스가 PKCE/refresh 스텁을 지원하도록 확장되고, `state-machine.test.js`에 silent refresh·401→refresh·code 교환 및 레이스/회귀 케이스가 대거 추가됐으며, 타입(`js/types.d.ts`)과 문서(ADR-011, `docs/design/pkce-migration.md`, `CLAUDE.md`)가 단계 진행 상황에 맞게 갱신됐습니다.
> 
> <sup>Reviewed by [Cursor Bugbot](https://cursor.com/bugbot) for commit ae83cbd171b6607734f9464b90447611fa9375e2. Bugbot is set up for automated code reviews on this repo. Configure [here](https://www.cursor.com/dashboard/bugbot).</sup>
<!-- /CURSOR_SUMMARY -->
