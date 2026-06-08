# 보안 감사 — PKCE Authorization Code + Refresh Token 마이그레이션 (Phase 2h)

- **감사 대상**: `js/sync/state-machine.js`, `js/sync/transport.js`, `js/sync/refresh-store.js`, `js/drive-sync.js`, `index.html` (CSP)
- **마이그레이션 범위**: Phase 2h 단계 1~4 누적 변경 (PR #52, #53, #54, #57)
- **감사 시각**: 2026-05-07
- **이전 감사**: `2026-05-02-171111.md`, `2026-05-04-drive-sync-security.md` — Implicit Flow 시점

---

## 1. 요약

Phase 2b~2g의 GIS Token Client + Implicit Flow를 Authorization Code + PKCE + AES-GCM 암호화 IndexedDB 기반 refresh token으로 전면 교체했다. **Critical / High 0건, Medium 0건 (모두 마이그레이션 진행 중 정정)**, 추후 모니터링 권고 1건.

핵심 보안 변화:

1. **공급망 표면 소거**: `accounts.google.com/gsi/client` `<script>` 제거 → Google CDN 변조 위협 표면 자체 소거.
2. **CSP 축소**: `script-src` / `style-src` / `frame-src` / `connect-src`에서 `accounts.google.com` 제거. `frame-src` 디렉티브 자체 삭제.
3. **Refresh Token 도입의 트레이드오프**: 메모리 전용 access token 정책이 깨짐. 대신 비추출 AES-GCM 키로 IndexedDB 암호화 → XSS 방어는 strict CSP가, storage-level 도용 방어는 암호화가 담당하는 다층 모델로 전환.
4. **인증 경로 단일화**: 데스크탑·Android·iOS가 동일한 PKCE redirect 경로. 플랫폼별 분기 코드 사라져 보안 review 표면 축소.
5. **Race 가드 모델 정착**: state-based + localStorage flag-based + 매 await 직후 재검사 — Bugbot이 3차에 걸쳐 race window를 발견해 정정.

---

## 2. 항목별 점검

### 2.1 OAuth 토큰 라이프사이클

| 토큰 | 저장 위치 | 보호 | TTL | 회수 |
|---|---|---|---|---|
| Access token (`_token`) | 메모리 only (state machine 클로저) | XSS 외 노출 표면 없음 | 1시간 (Google 표준) | 만료 시 refresh로 무음 갱신 |
| Refresh token | IndexedDB `bible-drive-sync.tokens.refresh` | AES-GCM 256-bit, IV 매 저장마다 새로, 키 `extractable: false` | Testing 7일 / Production 영구 | `signOut()` 시 `clearRefreshToken()` + Google `/revoke` 호출 |

**점검 결과**: ✅

- Access token은 `_storeToken(token)`만 통해 클로저 내부에 저장. `getToken()`이 read-only 노출. `localStorage` / `IndexedDB` / `sessionStorage` 어디에도 직접 쓰이지 않음 (`grep` 검증).
- Refresh token round-trip: `refresh-store.test.js`의 13건이 비추출성 / IV 유일성 / 복호화 실패 자가 정리 / 키 영속성 회귀 방어.
- Rotation: Google이 새 refresh token을 surface하면 `_attemptSilentRefresh`가 즉시 `saveRefreshToken(new)` 호출. rotation 미발생 시 기존 값 보존 (덮어쓰기 가드).
- Sentinel detection: 같은 refresh token이 두 클라이언트에서 동시 사용되면 Google이 서버 측 자동 무효화 → 다음 cold start에서 `invalid_grant` → IDB clear + NEEDS_CONSENT.

### 2.2 PKCE 구현 (RFC 7636 정합성)

| 항목 | 검증 |
|---|---|
| Verifier 길이 | 43자 base64url (32-byte 랜덤). RFC §4.1 범위 43-128 준수 |
| Challenge 알고리즘 | `S256` (`code_challenge_method=S256`) — `plain` 거부 |
| Verifier alphabet | `[A-Za-z0-9_-]` (base64url-no-padding) |
| Challenge 파생 | `base64url(SHA-256(verifier))` — RFC §4.2 부록 B 테스트 벡터 회귀 방어 (`transport-pkce.test.js` #3) |
| Verifier 단일 사용 | `consumeRedirectCallback`이 sessionStorage에서 verifier를 빼서 반환 후 즉시 삭제 |
| State nonce | 32-byte hex (256-bit 엔트로피), `crypto.getRandomValues`로 생성 |

**점검 결과**: ✅ RFC 7636 정합성 100%.

### 2.3 redirect callback 보안

**State nonce 검증 순서** (RFC 6749 §10.12):

1. URL에 `code` 또는 `error` 있는지 확인 (없으면 `null` 반환, IIFE 종료)
2. sessionStorage state 로드 (없으면 `no_state` 실패)
3. JSON 파싱 (실패 시 storage 폐기, `bad_state` 실패)
4. `flow === "pkce-v1"` 확인 (다른 flow면 `null` — forward-compat)
5. **state nonce 일치 확인 (sessionStorage 폐기 전)** → 불일치 시 storage 보존 + `state_mismatch` (실제 callback이 늦게 도착할 수 있음)
6. 일치 시 storage 단일 사용 폐기
7. ts 만료 검사 (10분 윈도우)
8. error/code 분기

**점검 결과**: ✅. 검증 순서가 RFC 6749 §10.12 권고와 일치. attacker-crafted error URL이 legitimate in-flight state를 clobbering하는 시나리오 회귀 방어 (`test_drive_sync_ios.py::test_ios_state_mismatch_preserves_session_storage`).

**URL leak 방어** (Bugbot PR #54-2):

- 성공: `history.replaceState(null, "", returnTo)` — query string 제거
- 검증된 에러 (state 일치): `history.replaceState(null, "", returnTo)` — query string 제거
- 검증 실패 (no_state / bad_state / state_mismatch): `history.replaceState(null, "", location.pathname)` — search 통째로 폐기

**점검 결과**: ✅. PKCE callback이 query string에 오므로 search를 보존하면 auth code가 URL bar / 히스토리 / 로그 / referrer에 leak. 이를 막기 위해 unrouted 상황에서 search를 통째로 폐기. (앱이 query 기반 라우팅을 안 쓰는 점이 이 공격적 폐기를 가능하게 한다.)

### 2.4 race window 방어

비동기 흐름이 진행 중일 때 사용자 의도(`signOut()`/`disable()`) 또는 다른 흐름의 결과가 우리 후속 `_transition`을 무효화하는 시나리오. Phase 2h 진행 중 Bugbot이 4차례 race window를 발견 → 모두 정정:

| 위치 | 시나리오 | 방어 |
|---|---|---|
| `_attemptSilentRefresh` 진입 시점 | cold start race — 다른 흐름이 먼저 IDLE/SYNCING 도달 | state 가드 (IDLE / SYNCING (non-reauth) / ERROR) + `localStorage[SYNC_ENABLED_KEY] === "0"` |
| `_attemptSilentRefresh` `await refreshAccessToken` 직후 | 사용자가 refresh round-trip 중 disconnect | 상동 race 가드 |
| `_attemptSilentRefresh` `await refreshStore.saveRefreshToken` 직후 (rotation) | 사용자가 IDB write 중 disconnect | `localStorage[SYNC_ENABLED_KEY] === "0"` 재검사 (PR #57) |
| `_attemptSilentRefresh` `await refreshStore.clearRefreshToken` 직후 (invalid_grant) | 사용자가 IDB clear 중 disconnect | 상동 (PR #57) |
| `acceptRedirectCode` `await exchangeCodeForToken` 직후 | 사용자가 token 교환 중 disconnect | `localStorage[SYNC_ENABLED_KEY] === "0"` (PR #54) |
| `acceptRedirectCode` `await refreshStore.saveRefreshToken` 직후 | 사용자가 IDB write 중 disconnect | `localStorage[SYNC_ENABLED_KEY] === "0"` 재검사 (PR #57) |
| `_kickoff401Reauth` `await loadRefreshToken` 직후 (silent 경로 false 반환) | 사용자가 IDB load 중 disconnect → legacy 경로 진입 시 race | `localStorage[SYNC_ENABLED_KEY] === "0"` (PR #54-3, 단계 4에서 legacy 경로 자체 사라짐) |

**점검 결과**: ✅. 회귀 방어 단위 테스트 7건 (`tests/unit/state-machine.test.js` 4, 17, 23, 25, 26a, 26b, 26c).

`disable()` 자체도 _transition 외부에서 `localStorage[SYNC_ENABLED_KEY] = "0"`을 defensively 설정 → DISABLED→DISABLED no-op 분기에서도 flag 갱신 보장.

### 2.5 redirect 무한 루프 방어

| 보호 | 동작 | cap |
|---|---|---|
| `bible-drive-redirect-attempts` | `_beginRedirect` 진입 시 +1, `SYNC_DONE`에서만 0으로 리셋 | 3 (이상 시 ERROR + snackbar) |
| `MAX_REAUTH` | 401 reauth 카운터 — IDLE 전이 시 carry forward, SYNC_DONE에서 reset | 3 |

**점검 결과**: ✅. token 발급 직후 401이 반복되는 시나리오 (Drive가 새 token도 거절)에서 cap이 작동해 ERROR 정착 (`tests/unit/state-machine.test.js::14`).

### 2.6 CSP 축소 효과

**Before (Phase 2g)**:
```
script-src 'self' ... https://www.googletagmanager.com https://accounts.google.com
style-src 'self' ... https://fonts.googleapis.com https://accounts.google.com
frame-src https://accounts.google.com
connect-src 'self' ... https://accounts.google.com https://oauth2.googleapis.com ...
```

**After (Phase 2h 단계 4)**:
```
script-src 'self' ... https://www.googletagmanager.com
style-src 'self' ... https://fonts.googleapis.com
[frame-src 디렉티브 삭제]
connect-src 'self' ... https://oauth2.googleapis.com ...
```

**점검 결과**: ✅

- `accounts.google.com` 도메인이 모든 CSP 디렉티브에서 제거됨 → Google Identity Services 공급망 변조 시나리오 표면 소거.
- OAuth `/auth` 엔드포인트는 full-page navigation으로 호출되므로 `connect-src`/`frame-src` 불요. token 교환은 `oauth2.googleapis.com/token`으로 이미 등록된 도메인.
- `frame-src` 디렉티브 삭제는 GIS One Tap iframe 배제와 동치 — XSS via iframe 표면 0.

### 2.7 IndexedDB 암호화 (refresh-store.js)

| 항목 | 검증 |
|---|---|
| 키 알고리즘 | AES-GCM 256-bit (`subtle.generateKey({ name: "AES-GCM", length: 256 })`) |
| 키 비추출 | `extractable: false`. `subtle.exportKey()` 호출 거부 (회귀 테스트 `refresh-store.test.js`) |
| IV | 매 저장마다 새 12-byte 랜덤 (`crypto.getRandomValues(new Uint8Array(12))`). nonce 재사용 방지 |
| 인증 태그 | AES-GCM 표준 16-byte. ciphertext 변조 시 `decrypt` 실패 |
| 복호화 실패 | 손상 레코드 자동 삭제 → 재시도 루프 방지, 자가 복구 가능 |
| Storage 미가용 | Safari private mode 등에서 `null` 반환 → 호출자가 NEEDS_CONSENT 폴백 |

**위협 모델**:

- **XSS**: in-browser JS는 `subtle.encrypt`/`decrypt`를 동일 origin에서 호출 가능 → IDB 암호화는 XSS 자체를 막지 못함. **strict CSP가 1차 방어**, 암호화는 storage-level 도용에 대한 깊이 방어층.
- **악성 브라우저 확장 / OS 멀웨어**: IDB raw 덤프 시도 → ciphertext만 노출, 키는 메모리에서만 사용 가능 (`extractable: false`). raw 키 추출 경로 없음.
- **CryptoKey 자체 추출**: indexedDB에 `CryptoKey` 객체를 그대로 저장. structured-clone 가능하나 export는 차단. 같은 origin JS만 사용 가능 — **XSS 시 사용은 가능하나 추출은 불가**.

**점검 결과**: ✅. ADR-001 제약 (백엔드 없는 SPA) 하에서 가능한 최선. 검토한 대안 표는 ADR-011 §"Refresh Token 저장 전략"에 기록.

### 2.8 `signOut()` 정리 경로

- `revokeToken(token)` — `oauth2.googleapis.com/revoke?token=...` POST. Google 측에서 access token + 같은 refresh token 모두 무효화. best-effort (network 실패해도 throw 없음).
- `clearRefreshToken()` — IDB에서 refresh token 레코드 삭제.
- `localStorage.removeItem("bible-drive-sync-email")`, `removeItem("bible-drive-sync-updated")`.
- `localStorage.setItem("bible-drive-sync", "0")` — 다음 cold start initDriveSync가 early return.
- `_machine.disable()` → state machine DISABLED 전이 + 메모리 `_token` clear.

**점검 결과**: ✅. 모든 자격 증명 흔적이 제거됨.

### 2.9 외부 의존성 전수

| 도메인 | 용도 | 트랜잭션 |
|---|---|---|
| `accounts.google.com/o/oauth2/v2/auth` | OAuth consent | full-page navigation (CSP 무관) |
| `oauth2.googleapis.com/token` | code → token 교환, refresh → access 갱신 | POST (CSP `connect-src`) |
| `oauth2.googleapis.com/revoke` | token 무효화 | POST (CSP `connect-src`) |
| `www.googleapis.com/drive/v3/*` | Drive REST | GET/PATCH/POST/DELETE (CSP `connect-src`) |
| `www.googleapis.com/oauth2/v3/userinfo` | email 조회 | GET (CSP `connect-src`) |
| `www.googleapis.com/upload/drive/v3/*` | Drive 업로드 | POST/PATCH (CSP `connect-src`) |

**점검 결과**: ✅. 외부 도메인 5종, 모두 Google 소유. CSP `connect-src`에 정확히 화이트리스트 등록.

### 2.10 Service Worker 캐시 우회

`DRIVE_HOSTNAMES` 상수가 sw.js의 캐시 결정에 사용. PKCE 도입 후:

```js
const DRIVE_HOSTNAMES = [
  "www.googleapis.com",
  "content.googleapis.com",
  "oauth2.googleapis.com",
];
```

`accounts.google.com` 제거됨 (full-page navigation이라 SW intercept 불필요).

**점검 결과**: ✅. token, refresh token, Drive 콘텐츠 모두 SW 캐시 우회.

---

## 3. 위협 모델 매트릭스

| 벡터 | 영향 | 방어 | 평가 |
|---|---|---|---|
| XSS via app code | access token + refresh token 도용 (decrypt 가능) | strict CSP (`'self'` + 인라인 hash + 외부 화이트리스트) + 코드 리뷰 | ✅ |
| XSS via 외부 스크립트 (Google CDN 변조) | 상동 | **단계 4에서 GIS 제거 → 표면 0** | ✅ |
| 악성 브라우저 확장 / OS 멀웨어 (IDB 덤프) | refresh token ciphertext만 노출 | AES-GCM + 비추출 키 | ✅ |
| MITM / DNS 탈취 | access token + refresh token 도용 | HTTPS, HSTS | ✅ |
| Token 도용 (서버 측) | refresh token으로 장기 접근 | Google rotation + sentinel detection + scope 제한 (`drive.appdata`) | ✅ |
| Replay 공격 (auth code) | 두 번째 사용 시 Google이 거절 | code 단일 사용 + verifier 검증 | ✅ |
| CSRF (state nonce 조작) | attacker가 자신의 token을 사용자 세션에 주입 | 256-bit state nonce + 검증 | ✅ |
| URL leak (auth code in browser history) | code가 후속 요청 referrer에 노출 | `history.replaceState`로 즉시 strip + search 통째 폐기 fallback | ✅ |
| 무한 redirect 루프 | 사용자 세션 hijack / DoS | redirect attempts cap (3) + reauth cap (3) | ✅ |
| Race window (사용자 disconnect 무시) | UX 무결성 / 권한 잔존 | state + flag 가드 + 매 await 후 재검사 | ✅ |

---

## 4. 알려진 트레이드오프 (변경 없음)

다음 항목은 ADR-011에서 의식적으로 채택된 트레이드오프이며 본 감사가 변경하지 않음:

- **OAuth 검수 진행 중 → refresh token 7일 만료**: 앱 "Testing" 상태 동안에 한정. 검수 통과 후 영구. 코드 변경 0.
- **Safari private mode IndexedDB 제한**: 매번 PKCE redirect 폴백. 일반 사용 모드 영향 없음.
- **마이그레이션 호환성**: 기존 사용자 cold start 1회 NEEDS_CONSENT 통과 → sync 데이터 손실 없음 (별도 store).

---

## 5. 추후 모니터링 권고

1. **e2e 테스트의 정기 로컬 실행**: CI에 Playwright가 없어 e2e가 회귀 방어망에 없음. 배포 직전마다 로컬 `pytest tests/e2e/test_drive_sync*.py` 실행 권고.
2. **Cloud Console redirect URI 등록 검증**: dev `http://localhost:8080/`, prod `https://bible.anglican.kr/` — trailing slash 정확히 일치. 배포 전 매번 확인.
3. **OAuth 검수 통과 모니터링**: 통과 시 refresh token TTL이 7일 → 영구로 전환. 사용자 보고 없으므로 Google Cloud Console 알림 / 정기 점검 필요.
4. **silent-blocked localStorage cleanup 코드**: `js/drive-sync.js`의 `localStorage.removeItem("bible-drive-silent-blocked")` 호출은 몇 릴리스 후 (≥ 6주, 대다수 활성 사용자가 한 번씩 앱을 열었을 시점) 제거 가능. 안전하게 두어도 무해.

---

## 6. 결론

**Critical / High / Medium 0건**. Phase 2h 마이그레이션은 ADR-011이 처음부터 지시했던 PKCE 흐름으로 회귀하면서 GIS 공급망 의존을 소거하고, refresh token 도입의 보안 부채(IDB 영속화)를 비추출 AES-GCM으로 상쇄했다. Race 가드는 4차에 걸친 Bugbot 검토를 통해 state-based + flag-based + 매 await 후 재검사 모델로 안정화됐다.

검토자가 보고할 추가 조치 없음. 단계 5는 정리 단계로, 보안 모델에 영향을 주는 신규 변경 없음.
