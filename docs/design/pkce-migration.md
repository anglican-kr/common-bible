# PKCE 인증 설계 — Phase 2h 마이그레이션

> 이 문서는 각 단계별로 구현을 진행하면서 갱신한다.
> 시점 고정 결정 기록은 ADR-011 §Phase 2h 참조.

- 작성: 2026-05-07
- 상태: 단계 5 PR open — 단계 1·2·3·4 모두 머지 완료, 5는 정리 단계
- 관련 ADR: ADR-001(SPA), ADR-011(북마크 동기화), ADR-012(TS), ADR-013(유닛 테스트)
- 보안 감사: `docs/audit/2026-05-07-pkce-refresh-token.md`

---

## 1. 개요

### 1.1 목적

Drive 동기화 OAuth 인증을 **Implicit Flow + GIS Token Client**에서 **Authorization Code + PKCE Flow + refresh token**으로 전환. 모든 플랫폼(데스크탑/Android/iOS)이 단일 redirect 기반 경로로 통일되며, refresh token이 IndexedDB에 영속 저장되어 cold start마다 백그라운드 fetch 한 번으로 access token을 갱신 → 팝업·리디렉션·깜박임 없음.

### 1.2 대상 범위

- `js/sync/state-machine.js` — 상태 머신
- `js/sync/transport.js` — OAuth + Drive REST 호출
- `js/sync/refresh-store.js` — refresh token IDB 저장 (Phase 2h 단계 1 신설)
- `js/drive-sync.js` — facade, 콜백 흡수
- `js/types.d.ts` — 타입 정의
- `index.html` — 스크립트 로드 + CSP
- `tests/unit/*` — 유닛 테스트

### 1.3 비대상

- Drive REST 데이터 동기화 로직 (`store-v2.js`, `_syncCycle`) — 변경 없음, 토큰만 새 출처로 공급
- 검색 인증, 음성 인증 등 — 우리 앱은 OAuth가 Drive 동기화에만 사용됨

---

## 2. 현재 코드베이스 (출발점)

### 2.1 Phase 2b~2g 흐름 요약

```
[사용자 토글 ON / 앱 cold start]
        │
        ▼
   GIS 라이브러리 로드 (gsi/client)
        │
        ▼
   IDENTIFYING (FedCM/One Tap UI 카드)
        │ identity OK
        ▼
   AUTHENTICATING (requestAccessToken — 별도 OAuth 팝업창)
        │ token OK
        ▼
   IDLE → SYNCING → IDLE …

iOS 분기 (Phase 2f):
   GIS 우회, OAuth Implicit Flow 풀페이지 리디렉션
   sessionStorage에 nonce 저장, callback에서 access_token 추출
```

### 2.2 핵심 한계

1. **Implicit Flow에 refresh token 없음**
   - Access token TTL 1시간, in-memory 전용
   - Cold start마다 새 토큰 요청 필요 → GIS 팝업창 또는 풀페이지 리디렉션
2. **데스크탑 Chrome 팝업창** (2026-05-06 사용자 보고)
   - `requestAccessToken()`은 popup-only API. 세션 valid + consent 있어도 별도 창이 열렸다 닫힘
3. **iOS 깜박임** (Phase 2g)
   - `prompt=none` silent 리디렉션이 < 1초 페이지 깜박임 발생

### 2.3 ADR-구현 정합성 누수

ADR-011 line 51에 "Authorization Code + PKCE 채택, Implicit Flow는 deprecated"로 명시됐으나 Phase 2b 실제 구현은 GIS Token Client 기반 Implicit Flow로 진행. Phase 2h는 ADR이 처음부터 지시했던 흐름으로 회귀.

### 2.4 사용 중인 핵심 파일 라인 (단계 0 시점)

| 파일                       | 핵심 로직                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `js/sync/transport.js`     | GIS wrapper 7종, `beginRedirectAuth`/`consumeRedirectCallback` (implicit), `_REDIRECT_STATE_KEY`                                  |
| `js/sync/state-machine.js` | DISABLED→INITIALIZING→IDENTIFYING→AUTHENTICATING→IDLE state, `acceptRedirectToken(token)` 진입점, `_handleSyncFail("401")` reauth |
| `js/drive-sync.js`         | `_consumeRedirectIfPresent` IIFE (implicit hash 처리), `signIn` 분기 (iOS vs non-iOS), `_pollGis`                                 |
| `index.html`               | line 267 `accounts.google.com/gsi/client` 스크립트, line 5 strict CSP                                                             |

---

## 3. 목표 설계 (Phase 2h 완료 시)

### 3.1 컴포넌트 책임

```
┌──────────────────┐
│   drive-sync.js  │  facade — 콜백 흡수, init, signIn/signOut
└─────────┬────────┘
          │
          ▼
┌──────────────────┐    ┌──────────────────┐
│ state-machine.js │───►│   transport.js   │  PKCE/REST 호출
│  상태·전이·정책   │    │  pure functions  │
└─────────┬────────┘    └──────────────────┘
          │
          ▼
┌──────────────────┐
│ refresh-store.js │  IDB AES-GCM
└──────────────────┘
```

### 3.2 인증 흐름

**토큰 수명 (background)**

| 토큰          | TTL                                | 저장 위치                | 만료 후 재발급                     |
| ------------- | ---------------------------------- | ------------------------ | ---------------------------------- |
| Access token  | **1시간** (Google 표준, flow 무관) | 메모리 only (`_token`)   | refresh token으로 백그라운드 fetch |
| Refresh token | **Testing 7일 / Production 영구**  | IndexedDB AES-GCM 암호화 | 사용자 명시 재연결 (`signIn`)      |

Access token TTL은 PKCE/Implicit 동일 — flow가 수명을 바꾸지 않음. PKCE 도입 효과는 **refresh token 추가**로 만료 후 재발급이 UI 없이 가능해진다는 점.

만료 감지는 능동적 타이머가 아니라 **반응형(reactive)**: Drive REST 호출 시 401을 받으면 그때 refresh 트리거 (아래 D 시퀀스 참조). 이로써 access token이 실제로 사용되기 전엔 갱신 비용 없음.

---

#### A. Cold start with refresh token (가장 흔한 케이스)

```
앱 로드 → drive-sync.js IIFE → callback 없음
       → initDriveSync() → _machine.enable()
       → state-machine: _attemptSilentRefresh()
       → refresh-store.loadRefreshToken() → "rt-xxx" 반환
       → transport.refreshAccessToken("rt-xxx", clientId)
       → 200 { access_token, expires_in, [refresh_token] }
       → _storeToken(access)
       → rotation 있으면 refresh-store.saveRefreshToken(new)
       → _transition(IDLE)
       → dispatch(SYNC_REQUEST) → SYNCING → IDLE
```

UI: 아무 변화 없음. 백그라운드 fetch 한 번 (50~500ms).

#### B. Cold start without refresh token (첫 사용자 / signOut 직후)

```
앱 로드 → IIFE callback 없음
       → initDriveSync()
         → enabled flag 체크: 0이면 early return (동기화 미사용)
         → 1이면 _machine.enable()
       → _attemptSilentRefresh() → IDB 비어있음 → false 반환
       → state-machine: NEEDS_CONSENT (사용자 "연결" 클릭 대기)
       → 설정 화면에 "연결" 버튼 노출
```

UI: 설정 화면에 "연결" 안내 — 기존 Phase 2g UX와 동일.

#### C. 첫 연결 (signIn 클릭)

```
사용자 클릭 → drive-sync.signIn()
         → transport.generatePKCEPair() → {verifier, challenge}
         → transport.beginRedirectAuthPKCE(clientId, scope)
         → sessionStorage에 {verifier, nonce, returnTo, flow:"pkce-v1"} 저장
         → location.href = accounts.google.com/o/oauth2/v2/auth?response_type=code&code_challenge=…
[페이지 떠남]

[Google OAuth 페이지 — 사용자 동의]

[redirect back]

앱 로드 → drive-sync.js IIFE
       → transport.consumeRedirectCallbackPKCE() → {ok, code, verifier, returnTo}
       → window.__pendingRedirectCode = {code, verifier}
       → history.replaceState(returnTo)
       → initDriveSync() → __pendingRedirectCode 감지
       → _machine.acceptRedirectCode(code, verifier)
       → transport.exchangeCodeForToken(code, verifier, clientId)
       → 200 { access_token, refresh_token, expires_in, scope }
       → _storeToken(access)
       → refresh-store.saveRefreshToken(refresh)  ← 핵심: refresh token 영속화
       → _transition(IDLE)
       → SYNC_REQUEST
```

#### D. 401 during sync (access token 만료)

```
SYNCING 중 _syncCycle이 401 받음
       → dispatch(SYNC_FAIL, reason:"401")
       → _handleSyncFail("401")
       → _kickoff401Reauth(event)  [async fire-and-forget]
         → _attemptSilentRefresh() → IDB에서 refresh token 사용
         → 갱신 성공 → IDLE + SYNC_REQUEST

실패 분기:
   • invalid_grant → IDB clear + NEEDS_CONSENT (스낵바 없음)
   • 5xx/network → OFFLINE
   • IDB 비어있음 → _legacyReauthAfter401(event) 폴백
```

#### E. 네트워크 실패 중 refresh

```
_attemptSilentRefresh → fetch 5xx 또는 throw
       → OFFLINE 전이 (refresh token IDB 보존)
       → navigator.online → NET_RECOVERED 이벤트
       → state-machine OFFLINE 분기 → 다시 _attemptSilentRefresh
```

### 3.3 상태 머신 변경

#### 3.3.1 단계 4 구현 후 최종 상태 집합

```
DISABLED
   │ enable() / sync flag = 1
   ▼
[silent refresh 시도]
   ├── 성공 → IDLE
   ├── invalid → NEEDS_CONSENT
   ├── 네트워크 → OFFLINE
   └── 토큰 없음 → NEEDS_CONSENT  (단계 4부터: 더 이상 GIS fallback 없음)

NEEDS_CONSENT
   │ 사용자 "연결" 클릭
   ▼
[redirect to Google] → callback → AUTHENTICATING-equivalent (code→token 교환 중)
   │ 성공
   ▼
IDLE → SYNCING → IDLE …

OFFLINE
   │ NET_RECOVERED
   ▼
[silent refresh 재시도]
```

단계 4 시점에 `INITIALIZING`, `IDENTIFYING` 상태는 **제거**됨 (GIS 의존 사라지므로).

#### 3.3.2 단계 3 시점 (코드 공존 단계) 상태 집합

```
DISABLED, INITIALIZING, IDENTIFYING, AUTHENTICATING, IDLE, SYNCING, OFFLINE, NEEDS_CONSENT, ERROR
```

(현재와 동일 — 단계 4까지 GIS 흐름 살아있음)

#### 3.3.3 신규 비공식 이벤트 (transition 로깅용)

```
SILENT_REFRESH_OK         _attemptSilentRefresh 성공 시 _transition(IDLE)
SILENT_REFRESH_INVALID    invalid_grant 시 _transition(NEEDS_CONSENT)
SILENT_REFRESH_NET_FAIL   네트워크 실패 시 _transition(OFFLINE)
REDIRECT_CODE_RECEIVED    acceptRedirectCode 진입 시
REDIRECT_CODE_ACCEPTED    code 교환 성공 후 _transition(IDLE)
CODE_EXCHANGE_FAIL        code 교환 실패 시 _transition(NEEDS_CONSENT)
```

### 3.4 저장소 스키마

#### 3.4.1 IndexedDB

```
DB: "bible-drive-sync" (v1)
  ├── store "keys"
  │     └── "aes" → CryptoKey (AES-GCM 256, extractable: false)
  └── store "tokens"
        └── "refresh" → { iv: Uint8Array(12), ciphertext: ArrayBuffer }
```

#### 3.4.2 sessionStorage (PKCE 진행 중에만)

```
"bible-drive-redirect-state-pkce":
  JSON.stringify({
    nonce: "32-byte hex",        // CSRF 검증용
    verifier: "43-char base64url",  // PKCE — code 교환 시 사용
    returnTo: "/gen/3",          // 사용자 원래 위치
    ts: 1715000000000,           // 만료 검사 (10분)
    flow: "pkce-v1",             // 콜백 라우팅 디스크리미네이터
    silent: false,               // prompt=none 여부
  })
```

#### 3.4.3 localStorage (기존 키 유지)

| 키                              | 용도                           | 단계 4 후               |
| ------------------------------- | ------------------------------ | ----------------------- |
| `bible-drive-sync`              | 동기화 활성 토글 ("0" / "1")   | 유지                    |
| `bible-drive-sync-email`        | 마지막 연결 이메일 (UI 표시용) | 유지                    |
| `bible-drive-sync-updated`      | 마지막 업데이트 시각 표시      | 유지                    |
| `bible-drive-redirect-attempts` | 무한 redirect 방어 cap         | 유지                    |
| `bible-drive-silent-blocked`    | Phase 2g iOS 플래그            | 의미 없음 → 단계 5 정리 |

---

## 4. 보안 모델

### 4.1 위협 모델

| 벡터                  | 영향                                               | 가능 방어                                                |
| --------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| XSS (스크립트 주입)   | 모든 in-browser 자격증명 도난 (refresh token 포함) | strict CSP + SRI + 코드 리뷰                             |
| 악성 브라우저 확장    | localStorage / IDB raw read 가능                   | scope 제한, IDB 암호화 (제한적 효과)                     |
| 기기 분실 / OS 멀웨어 | 브라우저 스토리지 직접 덤프                        | 우리 통제 밖                                             |
| DNS 탈취 / MITM       | 공격자 JS 주입                                     | HTTPS, HSTS                                              |
| Google CDN 변조       | 외부 스크립트 변조                                 | 단계 4에서 GIS 제거 → 공급망 표면 자체 소거              |
| Token 도용            | refresh token으로 장기 접근                        | rotation + sentinel detection (Google) + 짧은 access TTL |

### 4.2 방어 레이어

**1차 — strict CSP (이미 적용, index.html line 5)**

- `script-src 'self' + 인라인 hash + accounts.google.com (단계 4에서 제거)`
- `default-src 'self'`, `frame-src` 제한
- 인라인 스크립트 차단 → XSS 진입 장벽 매우 높음

**2차 — IDB 암호화 (Phase 2h 단계 1 도입)**

- AES-GCM 256-bit 비추출 키
- `subtle.exportKey()` 거부 → raw 키 바이트 추출 불가
- IV 매 저장마다 새로 생성 (nonce 재사용 방지)
- 효과: 악성 확장이 raw IDB 덤프로 토큰 가져가는 시나리오 차단. XSS는 여전히 우리 decrypt API 호출 가능 → CSP가 막아야 함.

**3차 — scope 제한**

- `drive.appdata` 전용 → 도난 시에도 사용자 일반 Drive 파일 접근 불가
- 피해 범위: 우리 앱이 만든 sync.json만

**4차 — Refresh token rotation**

- Google이 refresh 응답에 새 token 포함 시 즉시 IDB 갱신
- Sentinel detection: 같은 refresh token이 두 클라이언트에서 동시 사용되면 Google이 자동 무효화

**5차 — 명시적 revoke**

- `signOut`/`disable` 시 IDB clear + Google `/revoke` 호출
- 사용자가 권한 회수 가능

### 4.3 받아들인 트레이드오프

- **XSS = 보안 모델 무너짐**: in-browser 자격증명은 동일 origin JS 공격에 본질적으로 취약. SPA + 백엔드 없음 환경의 한계. ADR-001 제약 하 BFF 도입 불가 → strict CSP가 사실상 단일 방어선
- **검수 전 refresh token 7일 만료**: Google "Testing" 상태 동안 refresh token TTL 7일. 검수 통과 후 영구. 코드 변경 0
- **Safari private mode IDB 거부**: 매번 redirect 폴백. 일반 사용 모드 영향 없음

---

## 5. 마이그레이션 전략

### 5.1 단계 분할 원칙

- **사용자 영향 0 단계** (1, 2, 3): 신규 코드를 기존 흐름과 공존시켜 머지. 어떤 기존 사용자도 동작 변화 없음. 각 단계 단독 revert 가능.
- **가시 변경 단계** (4): 한 번에 GIS 제거 + PKCE 일원화. 모든 기존 사용자가 cold start 1회 NEEDS_CONSENT 통과 후 신규 흐름 진입 (sync 데이터 손실 없음).
- **정리 단계** (5): 무용해진 키, 죽은 코드, 문서 정리.

### 5.2 단계별 변경 매트릭스

| 단계 | 변경 파일                                                                                         | 신규 vs 변경                                                  | 사용자 영향                                                | 머지 조건                                                |
| ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| 0    | (없음)                                                                                            | Cloud Console redirect URI 등록 검증                          | 0                                                          | URI 등록 확인                                            |
| 1    | `refresh-store.js`, `harness.js`, `types.d.ts`, `index.html`, 신규 테스트                         | 신규 모듈                                                     | 0 (호출자 없음)                                            | 단위 테스트 + tsc                                        |
| 2    | `transport.js`, `harness.js`, `types.d.ts`, 신규 테스트                                           | 신규 함수 (기존 함수 옆에)                                    | 0 (호출자 없음)                                            | 단위 테스트 + tsc                                        |
| 3    | `state-machine.js`, `drive-sync.js`, `harness.js`, `types.d.ts`, 신규 테스트                      | 신규 함수 + 기존 enable()·401 분기에 silent refresh 우선 추가 | 0 (refresh token 보유자 → IDLE 직행, 미보유자 → 기존 흐름) | 단위 테스트 + tsc + e2e 회귀 없음                        |
| 4    | `state-machine.js`, `drive-sync.js`, `transport.js`, `index.html`, `types.d.ts`, 모든 테스트 갱신 | GIS 제거 + 흐름 일원화                                        | **모든 기존 사용자 cold start 1회 NEEDS_CONSENT**          | Cloud Console URI 확정 + e2e 전면 통과 + 수동 prod smoke |
| 5    | `state-machine.js`, `coding-pitfalls.md`, ADR                                                     | cleanup                                                       | 0                                                          | —                                                        |

### 5.3 기존 사용자 전환 시나리오

**단계 4 머지 직후 cold start:**

```
기존 사용자 상태:
  localStorage["bible-drive-sync"] = "1"
  localStorage["bible-drive-sync-email"] = "user@..."
  IDB refresh-store: 비어있음 (단계 1~3 머지 시점엔 새 코드가 호출 안 됨)

단계 4 코드 동작:
  initDriveSync() → enable()
  → _attemptSilentRefresh() → IDB 비어있음 → false
  → 단계 4: 더 이상 GIS fallback 없음 → NEEDS_CONSENT 직행
  → 사용자에게 "연결" 버튼 노출

사용자 액션:
  "연결" 클릭 → signIn() → PKCE redirect → Google 동의 → callback
  → acceptRedirectCode → IDB에 refresh token 저장
  → IDLE

이후 cold start:
  refresh token 발견 → 백그라운드 갱신 → IDLE
```

**데이터 손실 없음**: sync 데이터는 별도 store(`localStorage["bible-bookmarks-v2"]`, store-v2)에 있음. 인증 정보만 다시 받아오는 흐름.

### 5.4 단계별 롤백 전략

| 단계 | 머지 후 회귀 발견 시                                                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 단순 revert. 다른 코드 영향 없음                                                                                                                               |
| 2    | 단순 revert. 호출자 없음                                                                                                                                       |
| 3    | 단순 revert. 기존 흐름이 다시 1차 경로가 됨 — IDB에 저장된 refresh token은 무시됨 (구 코드는 IDB 안 봄)                                                        |
| 4    | **PR 전체 revert만 가능** (부분 revert는 GIS 제거 + state machine GIS 가정 모순). IDB 토큰은 무해. 사용자는 다시 GIS 흐름 사용. **단계 4 PR은 원자 머지 필수** |
| 5    | 단순 revert                                                                                                                                                    |

---

## 6. 단계 3 상세 설계

### 6.1 신규 함수 계약

#### `_attemptSilentRefresh(): Promise<boolean>`

**책임**: IDB에 refresh token이 있으면 그것으로 새 access token을 받고 상태를 전이시킴.

**반환값 의미**:

- `true` → 함수가 상태 전이를 완료함 (IDLE / NEEDS_CONSENT / OFFLINE 중 하나). 호출자는 추가 작업 금지.
- `false` → IDB에 refresh token이 없음 (또는 IDB 자체 사용 불가). 호출자가 폴백 결정.

**불변식**:

- `false` 반환 시 상태는 변경되지 않음
- `true` 반환 시 상태가 정확히 1번 전이됨
- IDB 작업 실패는 모두 catch — 절대 throw하지 않음

**전이 매트릭스**:
| 시나리오 | 전이 | 추가 동작 |
|---|---|---|
| IDB 비어있음 / 로드 실패 | (없음) | `false` 반환 |
| `refreshAccessToken` 200 OK | → IDLE | `_storeToken`, rotation 시 IDB 갱신, `dispatch(SYNC_REQUEST)` |
| `refreshAccessToken` 4xx | → NEEDS_CONSENT | `clearRefreshToken()`, 스낵바 없음 |
| `refreshAccessToken` 5xx / network | → OFFLINE | refresh token 보존 |

#### `acceptRedirectCode(code, verifier): Promise<void>`

**책임**: PKCE redirect 콜백 후 code를 access+refresh token으로 교환, 영속 저장, IDLE 진입.

**불변식**:

- 빈 인자 시 no-op
- 교환 실패 시 NEEDS_CONSENT + 스낵바 (사용자가 직접 시도한 흐름이므로 알림 OK)
- IDB 저장 실패 시 진입은 IDLE이지만 스낵바로 사용자에게 다음 cold start 재연결 가능성 안내

### 6.2 `enable()` 분기 설계

**핵심 결정**: `enable()`은 **동기 dispatch**를 유지하고, silent refresh는 **fire-and-forget async**로 시작 → 충돌 방지 위해 가드 플래그 사용.

**이유**:

- 기존 테스트가 `machine.enable()` 호출 직후 동기 상태 검사 가정
- `enable()`을 async로 만들면 모든 호출자 await 필요 → 폭발적 변경
- Async 동작은 dispatch 흐름과 별도 트랙으로 흘려보내고, 결과는 async 전이로 합류

**동작**:

```
enable():
  if state !== DISABLED: return
  fire-and-forget _attemptSilentRefresh():
    if 토큰 있음 → 비동기로 IDLE/NEEDS_CONSENT/OFFLINE 전이
    if 토큰 없음 → 아무 일도 안 함 (false 반환만)
  dispatch(ENABLE) → 기존 분기로 진입 (INITIALIZING / GIS poll …)
```

**충돌 시나리오**:

- silent refresh가 토큰 있음 → IDLE 전이
- 그 사이 기존 dispatch가 INITIALIZING → IDENTIFYING으로 전이
- 두 개가 경쟁 → 동기 dispatch가 먼저 실행됨

**해결**: silent refresh 결과를 적용할 때 `_state`를 다시 확인. DISABLED나 INITIALIZING 등 "전이가 아직 진행 중"인 상태면 적용. 이미 IDLE / NEEDS_CONSENT 등 종착점에 도달했으면 무시.

```js
async function _attemptSilentRefresh() {
  const rt = await window.refreshStore.loadRefreshToken();
  if (!rt) return false;

  const resp = await T.refreshAccessToken(rt, clientId);

  // 가드: 이 사이에 다른 흐름이 이미 IDLE/SYNCING으로 갔다면 우리는 후순위
  if (
    _state !== S.DISABLED &&
    _state !== S.INITIALIZING &&
    _state !== S.IDENTIFYING &&
    _state !== S.AUTHENTICATING &&
    _state !== S.OFFLINE &&
    _state !== S.NEEDS_CONSENT
  ) {
    // 이미 다른 흐름이 끝낸 상태 (IDLE/SYNCING/ERROR 등) — silent refresh 결과 폐기
    L.log({
      kind: "ACTION",
      event: "SILENT_REFRESH_RACE_LOST",
      finalState: _state,
    });
    return true;
  }
  // ... 전이 로직
}
```

**대안**: `_silentRefreshInFlight` 플래그를 둬서 동기 dispatch가 silent 진행 중이면 conditional 진입. 더 명시적이지만 분기 복잡도 ↑.

→ **상태 검사 방식 채택** (간단함).

### 6.3 401 reauth 분기 설계

**`_handleSyncFail("401")` 흐름**:

```
401 도달 (state = SYNCING)
  → _token = null
  → _kickoff401Reauth(event)  [async fire-and-forget, 즉시 return]

_kickoff401Reauth(event):
  if await _attemptSilentRefresh():
    return  ← 상태 전이 완료

  _legacyReauthAfter401(event)  ← 기존 GIS/iOS 흐름
```

**중요**: `_handleSyncFail("401")`이 `_kickoff401Reauth`를 await하지 **않음**. 동기 dispatch 흐름 그대로 종료. 비동기 결과가 나중에 상태 전이 발사.

**상태 시각화**:

- 401 받은 직후: SYNCING → (전이 안 함, 잠시 SYNCING 유지)
- 비동기 silent refresh 진행 중: 여전히 SYNCING (race window)
- silent 결과 도착: IDLE / NEEDS_CONSENT / OFFLINE 중 하나로 전이

**race window 동안 SYNCING 유지의 의미**:

- 사용자 UI: "동기화 중…" 표시 — 자연스러움 (실제로 백그라운드에서 토큰 갱신 중)
- 다른 SYNC_REQUEST: SYNCING은 SYNC_REQUEST 처리 안 함 (이미 진행 중)
- `_syncCycle`은 이미 종료 (401 응답으로 SYNC_FAIL 디스패치 후) — SYNCING 상태에 있어도 추가 동작 없음

**reAuthFails 카운터**:

- silent refresh가 (B) 성공 → IDLE 전이 시 ctxPatch 비움 → 카운터 리셋 (성공이므로 정상)
- silent refresh가 (C) invalid → NEEDS_CONSENT — 사용자 명시 액션 대기, 카운터 리셋 OK
- silent refresh가 (D) network → OFFLINE — 카운터 리셋 OK (NET_RECOVERED가 별도 트랙)
- silent refresh가 (A) 토큰 없음 → `_legacyReauthAfter401(event)`에서 기존 카운터 ++ 로직

### 6.4 `drive-sync.js` 변경

**`_consumeRedirectIfPresent` IIFE 확장**:

```
PKCE callback 우선 시도:
  T.consumeRedirectCallbackPKCE() → result
  if result !== null:
    if result.ok:
      window.__pendingRedirectCode = {code, verifier}
      localStorage.setItem("bible-drive-sync", "1")
      [success path]
    else if result.silent:
      [silent block 처리 — Phase 2g 패턴 동일]
    else:
      window.__pendingRedirectError = result.reason
    history.replaceState(returnTo)
    return  ← implicit 흐름 검사 안 함

implicit callback (Phase 2f용 fallback, 단계 4에서 제거):
  T.consumeRedirectCallback() → 기존 로직 그대로
```

**키 분리로 충돌 방지**: PKCE flow는 `bible-drive-redirect-state-pkce`, implicit는 `bible-drive-redirect-state` — 절대 교차 처리되지 않음.

**`initDriveSync()` 분기**:

```
if window.__pendingRedirectCode:
  const {code, verifier} = window.__pendingRedirectCode
  delete window.__pendingRedirectCode
  _machine.acceptRedirectCode(code, verifier)
  return

if window.__pendingRedirectToken:
  [기존 implicit 처리]

if window.__pendingRedirectError:
  [기존 에러 처리]

_machine.enable()
if (!T.isIOS()) _startPollingGis()
```

### 6.5 테스트 매트릭스

#### 6.5.1 `tests/unit/state-machine.test.js` 신규

**Group 7 — silent refresh 진입**:

```
7.1 enable() + IDB에 refresh token 있음 → IDLE 직행
7.2 enable() + IDB 비어있음 → 기존 INITIALIZING 흐름 (회귀 방어)
7.3 silent refresh 성공 + rotation 토큰 → IDB 갱신 검증
7.4 silent refresh 성공 + rotation 없음 → 기존 IDB 값 보존
7.5 silent refresh invalid_grant → IDB clear + NEEDS_CONSENT (스낵바 미호출)
7.6 silent refresh 5xx → OFFLINE + IDB 보존
7.7 silent refresh 네트워크 throw → OFFLINE + IDB 보존
7.8 race: enable() 호출 직후 다른 흐름이 먼저 IDLE 도달 → silent 결과 폐기
```

**Group 8 — 401 → silent refresh**:

```
8.1 SYNCING 중 401 + IDB 토큰 있음 → silent refresh → SYNCING 재진입
8.2 SYNCING 중 401 + IDB 토큰 없음 → 기존 reauth 폴백 (IDENTIFYING / iOS redirect)
8.3 SYNCING 중 401 + silent refresh invalid → NEEDS_CONSENT (스낵바 없음)
```

**Group 9 — acceptRedirectCode**:

```
9.1 정상 code → 교환 성공 → IDLE + IDB 저장
9.2 빈 code/verifier → no-op
9.3 교환 실패 → NEEDS_CONSENT + 스낵바
9.4 교환 성공이지만 IDB 저장 실패 → IDLE 진입 + 안내 스낵바
```

#### 6.5.2 harness.js 확장

- `loadMachine` ctx에 `refreshStore` stub 추가
- `T` stub에 `exchangeCodeForToken`, `refreshAccessToken`, `consumeRedirectCallbackPKCE`, `beginRedirectAuthPKCE`, `generatePKCEPair` 추가 (no-op 기본, 테스트별 override)

#### 6.5.3 e2e (단계 4부터 PKCE callback 시뮬레이션 추가)

단계 3는 e2e 변화 없음 (기존 흐름 살아있음). 단계 4 PR에서 `test_drive_sync.py`/`test_drive_sync_ios.py`의 GIS_STUB을 PKCE redirect로 전면 교체.

---

## 7. 단계 4 결과 (코드 완성 시점, PR open)

### 7.0 머지 가능 조건

- [x] `node --test tests/unit/*.test.js` 62/62 통과
- [x] `npx tsc -p tsconfig.json --noEmit` 0 error (`--ignoreDeprecations 6.0` 옵션은
  로컬 TypeScript 6.x 호환용으로만 필요, 실제 코드 의존 없음)
- [x] `npx tsc -p tsconfig.worker.json --noEmit` 0 error
- [ ] `pytest tests/e2e/test_drive_sync.py tests/e2e/test_drive_sync_ios.py -v` —
  로컬 검증 필요 (CI 미실행, Playwright 환경)
- [ ] Cloud Console redirect URI 등록 확인 (배포 직전)

### 7.1 핵심 변경 정리

ADR-011 §Phase 2h 단계 4 결과 섹션 참조. 이 문서에서는 설계 의도와 실제 구현이
어긋난 지점만 추가로 기록한다.

#### 7.1.1 `enable()` 동기 dispatch 폐기

설계 §6.2는 "enable()은 동기 dispatch 유지하고 silent refresh를 fire-and-forget로
시작 → 충돌 방지 위해 가드 플래그 사용"이라고 명시했고, 이는 단계 3까지의 흐름이었다.

단계 4에서는 더 이상 동기 dispatch할 곳이 없다 (INITIALIZING → GIS poll 분기가
사라졌으므로). 그래서 `enable()`은 silent refresh fire-and-forget만 하고,
silent refresh가 false 반환(IDB 비어있음)하면 _state가 여전히 DISABLED일 때만
NEEDS_CONSENT로 비동기 전이한다.

설계가 우려한 race ("silent refresh가 토큰 있음 → IDLE 전이 / 그 사이 기존
dispatch가 INITIALIZING → IDENTIFYING으로 전이 → 충돌")는 단계 4에서 자연
소거됐다. legacy dispatch가 사라졌으므로 충돌 자체가 없다.

부수 효과: 테스트가 `machine.enable()` 직후 동기적으로 NEEDS_CONSENT를 검사할 수
없어졌다. 모든 테스트가 `await drain(N)` 패턴으로 silent refresh 결과를 기다린다.

#### 7.1.2 `signIn()`은 머신 dispatch 안 거침

설계 §6.2는 USER_CONSENT_REQUEST를 머신 dispatch로 보내 머신 안에서
`_beginRedirect`을 호출하는 구조를 가정했다.

단계 4 구현은 `signIn()`이 머신을 거치지 않고 `T.beginRedirectAuth`를 직접
호출한다. 이유: DISABLED 상태에서 `signIn()`이 호출됐을 때 USER_CONSENT_REQUEST
dispatch는 DISABLED 분기에서 무시된다 (signIn 도중 enable()을 같이 호출해도
silent refresh fire-and-forget 후 DISABLED를 유지하는 race window 존재).

대안으로 dispatch() top-level에서 USER_CONSENT_REQUEST를 가로채 _beginRedirect
호출하는 패턴도 추가했다 — NEEDS_CONSENT/ERROR/OFFLINE 등에서 사용자가 다시
연결을 시도할 때 동작한다.

#### 7.1.3 sessionStorage 키 값 보존

설계 §5.2는 "rename: `_REDIRECT_STATE_PKCE_KEY` → `_REDIRECT_STATE_KEY` (값 변경 —
마이그레이션 시점 in-flight callback 보호)"라고 명시했다.

실제 구현에서 변수명만 canonical로 인계하고 **값은 `"bible-drive-redirect-state-pkce"`
그대로 유지**했다. 이유:
- 단계 3까지 실 사용자가 진행 중이던 PKCE callback의 sessionStorage 키가
  `bible-drive-redirect-state-pkce`였다. 단계 4 배포 후 그 callback이 떨어지면
  새 코드도 같은 키를 읽어야 한다.
- 구 Implicit `bible-drive-redirect-state` 키는 단계 4 코드에서 누구도 읽지 않으므로
  자연 만료된다 (sessionStorage는 탭 닫으면 사라짐).

#### 7.1.4 `silent` 필드 제거

설계 §3.4.2는 sessionStorage state schema에 `silent: boolean`을 포함했다. 이는
prompt=none silent re-auth용이었으나, 단계 4에서 prompt=none을 호출하는 코드 경로가
모두 사라졌다 (refresh token이 모든 silent 갱신을 담당). 따라서 schema에서 제거.

부수 효과: `RedirectCallbackResult`의 `silent` 필드도 제거됐다. 단계 1~3 코드와
호환성이 깨지지만, 단계 4 PR이 원자 머지이므로 영향 없음.

#### 7.1.5 active-reading defer 로직 제거

iOS 401 reauth 시 사용자가 능동적으로 읽는 중이면 disruptive redirect를 미루는
하이브리드 정책(`_isUserActivelyReading`, `__driveSyncInteractionTs`)은 단계 4에서
완전히 무용해졌다 — refresh token 기반 silent 갱신은 UI를 방해하지 않으므로
미룰 이유가 없다. IDB에 토큰이 없으면 NEEDS_CONSENT로 정착하므로 페이지 이탈도
일어나지 않는다.

### 7.2 단계 5 결과 (PR open)

마이그레이션을 마무리하는 정리 단계. 코드 기능 변경 없음.

#### 7.2.1 `bible-drive-silent-blocked` localStorage cleanup

`js/drive-sync.js` 모듈 로드 시 `localStorage.removeItem("bible-drive-silent-blocked")` 한 줄 추가. 이유:

- 단계 4에서 키를 read/write하는 코드는 모두 사라졌음 (`grep`으로 확인 — js/, tests/unit/ 어디에도 참조 없음).
- 그러나 Phase 2g~3 시점 사용자 디바이스의 localStorage에 stale value가 남아있을 수 있음.
- `removeItem`은 missing key에 대해 no-op이므로 안전. 매 cold start마다 실행해도 부담 0.
- 몇 릴리스 후(≥6주, 대다수 활성 사용자가 한 번씩 앱을 연 시점) cleanup 호출 자체도 제거 가능.

설계 §5.2 매트릭스의 "단계 4 후: 의미 없음 → 단계 5 정리" 항목 종결.

#### 7.2.2 `docs/coding-pitfalls.md` 신규 섹션

Phase 2h 진행 중 Bugbot이 발견한 4건의 race / leak / 마이그레이션 패턴을 추출해 살아있는 문서에 기록:

- §11 비동기 race 가드 — 단일 체크포인트의 함정 (PR #54 1차, PR #57)
- §12 콜백 URL 데이터 leak — flow별 transport 격차 (PR #54 2차)
- §13 마이그레이션 시점의 sessionStorage / localStorage 키 격리 (단계 2~4 키 분리·인계 패턴)

#### 7.2.3 `docs/audit/2026-05-07-pkce-refresh-token.md` 보안 감사

이전 감사(`2026-05-02-171111.md`, `2026-05-04-drive-sync-security.md`)가 Implicit Flow 시점 기준이었으므로, PKCE + refresh token 도입 후의 위협 모델을 다시 정리. **Critical/High/Medium 0건**.

핵심 변화:

- 공급망 표면 소거 (GIS 스크립트 제거)
- CSP 축소 (`accounts.google.com` 제거)
- Refresh Token 도입의 트레이드오프 (메모리 전용 → 비추출 AES-GCM IDB)
- 인증 경로 단일화 (플랫폼별 분기 코드 사라짐)
- Race 가드 모델 정착 (state-based + flag-based + 매 await 후 재검사)

모니터링 권고 4건: e2e 정기 실행, Cloud Console URI 검증, OAuth 검수 모니터링, silent-blocked cleanup 코드 제거 시점.

#### 7.2.4 README.md 갱신

Phase 2g 시점의 GIS/Implicit/silent-blocked 표·설명을 Phase 2h 단일 PKCE 경로 표로 교체. 알려진 한계 섹션도 PKCE 기준으로 갱신 (refresh token 7일 만료, 외부 권한 회수 동작 등).

## 8. 후속 단계 미리보기

### 8.1 단계 4 — GIS 제거 + 일원화 (Historical: 위 §7 참조)

**삭제**:

- `transport.js`: GIS wrapper 7종, `beginRedirectAuth` (implicit), `consumeRedirectCallback` (implicit)
- `state-machine.js`: `INITIALIZING`/`IDENTIFYING` 상태, `_promptIdentity`, `_reqSilentToken`, `_tokenClient`, GIS_READY/IDENTITY_OK/IDENTITY_FAIL 이벤트
- `drive-sync.js`: `_pollGis`, `_startPollingGis`, `__pendingRedirectToken` 처리, `signIn()` iOS/non-iOS 분기 통합
- `index.html`: GIS 스크립트 태그, CSP에서 `accounts.google.com` 제거
- `types.d.ts`: 위 항목 모두

**rename**:

- `beginRedirectAuthPKCE` → `beginRedirectAuth` (이름 인계)
- `consumeRedirectCallbackPKCE` → `consumeRedirectCallback`
- `_REDIRECT_STATE_PKCE_KEY` → `_REDIRECT_STATE_KEY` (값 변경 — 마이그레이션 시점 in-flight callback 보호)

**`enable()` 단순화**: `_attemptSilentRefresh` → 실패 시 NEEDS_CONSENT (이전엔 dispatch ENABLE으로 폴백).

**테스트 대규모 갱신**: iOS-only 분기 시나리오, FedCM 시나리오, silent-blocked 시나리오 모두 단일 경로로 통합.

### 7.2 단계 5 — 정리

- `bible-drive-silent-blocked` cleanup 코드도 제거
- `coding-pitfalls.md`에 PKCE 함정 노트 추가
- 보안 감사 문서 마무리 (`docs/audit/2026-05-XX-pkce-refresh-token.md`)

---

## 9. 외부 의존

### 9.1 Google Cloud Console

- dev/prod OAuth 클라이언트 두 개 모두 **Authorized redirect URIs** 등록 필요:
  - dev: `https://dev.anglican.kr/`
  - prod: `https://bible.anglican.kr/`
  - trailing slash 정확히 일치
- 클라이언트 type: "Web application" — 이 타입은 `/token` 요청에 `client_secret`을 강제 (RFC 7636 일탈). [§10 BFF 도입](#10-최종-상태-2026-05-08) 참조
- **`http://localhost:8080`은 의도적으로 제외** — 사용자 PC 악성 프록시 공격 표면 차단 (Phase 2h 단계 6)

### 9.2 nginx /oauth/token BFF (단계 6)

- 두 vhost 모두 `location = /oauth/token` 블록 적용
- `proxy_set_body "$request_body&client_secret=..."`로 server-side secret 주입 → `https://oauth2.googleapis.com/token`
- secret은 `/etc/nginx/sites-available/{bible,dev}`에만 존재. 브라우저·git·CDN 어디에도 노출 없음
- 예시 설정: `nginx/oauth-proxy.example.conf`. 자세한 결정은 [ADR-017](../decisions/017-oauth-bff-proxy.md)

### 9.3 검수 상태 영향

- 현재 OAuth 앱 "Testing" 상태 (2026-05-02 검수 신청, 심사 대기)
- "Testing" 동안 refresh token 7일 만료
- 검수 통과 시 자동으로 무제한 — 코드 변경 0
- scope (`drive.appdata`) 변경 없음 → 검수 재제출 불필요

---

## 10. 최종 상태 (2026-05-08)

Phase 2h 마이그레이션 종료. 5단계 + 1단계(인프라) 완료.

### 10.1 완료 단계

| 단계 | PR | 핵심 변경 |
|-----|-----|----------|
| 1 | #52 | `js/sync/refresh-store.js` AES-GCM 암호화 IDB |
| 2 | #53 | `transport.js` PKCE 유틸 + `/token` 교환 함수 |
| 3 | #54 | `state-machine.js` `_attemptSilentRefresh` + `acceptRedirectCode` (GIS·Implicit과 공존) |
| 4 | #57 | GIS / Implicit / FedCM 의존 모두 제거. 상태 6개로 축소. PKCE 단일 경로 |
| 5 | #61 | localStorage cleanup, `coding-pitfalls.md` §11~13, 보안 감사 (0건), README PKCE 단일 경로 |
| 6 | #64 | dev 환경 분리 (`dev.anglican.kr`) + nginx BFF + visibility 자동 sync + 부수 UI 회귀 |

### 10.2 시운전 결과 (2026-05-08, dev 환경)

`dev.anglican.kr`에서 cold start silent refresh + Drive 동기화 1라운드 + 자동 머지·업로드 모두 정상. 진단 로그 0 errors. 멀티디바이스 시나리오에서 visibility-trigger sync로 다른 디바이스 변경분 자동 pull 확인.

### 10.3 BFF detour의 발견 (단계 6 도중)

원래 가정: "PKCE 사용 시 `client_secret` 불요 (RFC 7636)". 시운전에서 `400 invalid_request: "client_secret is missing."` 응답으로 가정 오류 확인. Google "Web application" 클라이언트 타입은 RFC를 따르지 않고 `/token`에 `client_secret`을 강제함 (다수 라이브러리 issue tracker에서 같은 문제 확인).

대안 검토:
- **A. SPA에 secret 임베드** — 거부 사유: GitHub secret scanner가 `GOCSPX-` 패턴 감지 시 Google이 secret 자동 무효화 → 운영 동기화 즉시 중단. git 이력 영구 잔존도 부담
- **B. Desktop app 클라이언트 타입 전환** — 거부 사유: redirect URI가 `http://127.0.0.1:port` 형태만 허용, HTTPS 도메인 불가. SPA에 부적합
- **C. nginx BFF 프록시** ✅ 채택 — same-origin `/oauth/token` 요청에 nginx가 secret 주입 후 Google로 forward. secret은 nginx 설정 파일에만 존재

자세한 결정 기록: [ADR-017](../decisions/017-oauth-bff-proxy.md).

### 10.4 ADR-011·CLAUDE.md·README 동기화

- `docs/decisions/011-bookmark-sync.md`에 BFF 결정 개정 블록(2026-05-08) + 미결 사항 갱신
- `CLAUDE.md` "현재 상태" Phase 2h 완료 표시 + 단계 6 추가
- `README.md` Drive 동기화 표에 `/oauth/token` BFF + visibility-trigger 행 추가
- `docs/architecture.md` §1·§4.3·§9 다이어그램 + 보안 모델 갱신, ADR 인덱스에 014~017 추가

---

## 11. 부록

### A. RFC 7636 PKCE 요약

- **verifier**: 클라이언트 비밀 — 43-128 문자 base64url alphabet (`[A-Z][a-z][0-9]-._~`)
- **challenge**: `base64url(SHA-256(verifier))` — 인증 요청에 노출 OK (해시이므로)
- **검증**: 서버가 token 교환 시 `SHA-256(verifier) == challenge` 검증 → 인증 코드 가로채도 verifier 없으면 토큰 못 받음

테스트 벡터 (RFC 7636 §4.2 부록 B):

```
verifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
```

이 벡터는 `transport-pkce.test.js` test #3에서 회귀 방어.

### B. AES-GCM 사용 규약

- **키 길이**: 256-bit
- **IV 길이**: 12 byte (표준)
- **IV 재사용 금지**: 같은 키로 IV 재사용 시 보안 무너짐 → 매 저장마다 `crypto.getRandomValues(new Uint8Array(12))`
- **인증 태그**: AES-GCM은 자동으로 인증 태그 부여 → ciphertext 변조 시 decrypt 실패
- **`extractable: false`**: `subtle.exportKey()` 호출 거부됨. 키는 `subtle.encrypt`/`decrypt`로만 사용 가능.

### C. 참고 자료

- [RFC 7636 — Proof Key for Code Exchange](https://datatracker.ietf.org/doc/html/rfc7636)
- [OAuth 2.1 Browser-Based Apps BCP](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps)
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- ADR-001 (SPA architecture)
- ADR-011 (북마크 동기화 — Phase 2h 섹션)
- ADR-012 (TypeScript 점진 도입)
