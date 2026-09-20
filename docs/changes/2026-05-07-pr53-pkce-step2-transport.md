---
date: 2026-05-07
pr: 53
branch: feat/pkce-step2-transport
title: "feat: transport.js에 PKCE 유틸 + token 교환 함수 추가 (Phase 2h 단계 2)"
---

# feat: transport.js에 PKCE 유틸 + token 교환 함수 추가 (Phase 2h 단계 2)

## Summary

PKCE 마이그레이션(Phase 2h) 단계 2 — `transport.js`에 OAuth 2.0 Authorization Code Flow + PKCE 인프라 신설. 기존 implicit flow 함수들은 그대로 두고 옆에 추가만 했으므로 호출자 변화 없음 → **사용자 영향 0**.

## 추가된 함수

| 함수 | 역할 |
|---|---|
| `generatePKCEPair()` | 32바이트 랜덤 → verifier(43자 base64url) + SHA-256 challenge |
| `beginRedirectAuthPKCE(clientId, scope, {prompt})` | `response_type=code` + S256 challenge로 OAuth 시작. 별도 sessionStorage 키 `bible-drive-redirect-state-pkce` 사용해 구 implicit과 격리 |
| `consumeRedirectCallbackPKCE()` | query string 파싱, `flow="pkce-v1"` 검증, state nonce + 만료 검사. 다른 flow의 state를 만나면 `null` 반환 (구 implicit과 안전 분리) |
| `exchangeCodeForToken(code, verifier, clientId)` | POST `/token`, `grant_type=authorization_code`. 절대 throw 안 함 |
| `refreshAccessToken(refreshToken, clientId)` | POST `/token`, `grant_type=refresh_token`. **rotation** 시 새 `refresh_token`을 surface, 없으면 `null`로 반환해 호출자가 기존 값 보존 |

## 단계 2의 안전성

- 신규 함수만 추가, 기존 함수(`beginRedirectAuth`, `consumeRedirectCallback`, GIS wrappers 등) 변경 없음
- 어떤 호출자도 새 함수 사용 안 함 → state machine과 drive-sync 흐름 그대로
- sessionStorage 키 분리로 구 implicit / 신규 PKCE callback이 절대 교차 처리되지 않음
- 단계 4에서 GIS 제거 + PKCE 일원화 시 이름 받아쓰기로 클린업 예정

## 보안 메모

- **PKCE S256 challenge**: RFC 7636 §4.2 부록 B 테스트 벡터로 정확성 검증 (`dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` → `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`)
- **State nonce**: 32바이트 hex CSRF 방어, 10분 만료 (구 implicit과 동일 정책)
- **Single-use**: 정상 callback 소비 시 sessionStorage state 즉시 제거. nonce 불일치 시는 보존 (진짜 callback이 늦게 도착할 수 있어서)

## Test plan

- [x] `node --test tests/unit/transport-pkce.test.js` — **23/23 통과**
  - PKCE primitives 3건 (verifier 형식, 매번 달라짐, RFC 7636 부록 B 벡터)
  - `beginRedirectAuthPKCE` 4건 (URL 파라미터, prompt=none, login_hint, challenge↔verifier 정합성)
  - `consumeRedirectCallbackPKCE` 7건 (정상, state_mismatch 보존, 다른 flow null, state_expired, error param, no_state, callback 없음)
  - `exchangeCodeForToken` 4건 (성공, HTTP 400, 네트워크, JSON 파싱 실패)
  - `refreshAccessToken` 5건 (rotation 없음→null, rotation 있음, invalid_grant, 네트워크, 빈 문자열 정규화)
- [x] `node --test tests/unit/*.test.js` — 56/56 회귀 없음 (state-machine 20 + refresh-store 13 + transport-pkce 23)
- [x] `tsc -p tsconfig.json --noEmit` / `tsc -p tsconfig.worker.json --noEmit` — 0 error

## 다음 단계

[계획 파일](https://github.com/anglican-kr/common-bible/blob/main/docs/decisions/011-bookmark-sync.md)의 Phase 2h 단계 3: state-machine.js에 silent refresh + redirect-PKCE 결합. 단계 3까지는 여전히 사용자 영향 0 (구 GIS 흐름 살아있음, 단계 4에서 일원화).
