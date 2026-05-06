# ADR-011: 북마크 디바이스 간 동기화

- 일시: 2026-04-26
- 개정: 2026-04-28 (Google Drive 동기화 기술 결정 확정)
- 개정: 2026-04-30 (Phase 2a 구현 완료)
- 개정: 2026-05-02 (Phase 2b 구현 완료, 보안 감사 완료)
- 개정: 2026-05-04 (Phase 2c 구현 완료)
- 개정: 2026-05-05 (Phase 2d — iOS FedCM/One Tap 적용)
- 개정: 2026-05-05 (Phase 2e — FedCM-mandatory deprecation 마이그레이션)
- 개정: 2026-05-05 (Phase 2f — iOS OAuth 풀페이지 리디렉션)
- 개정: 2026-05-06 (Phase 2f 머지 — Cursor Bugbot 6차 리뷰 정제 + GIS 토큰 빈 응답 stuck fix)
- 개정: 2026-05-06 (Phase 2g — iOS 앱 재실행 시 silent prompt=none 자동 리디렉션)
- 상태: 승인됨 (Phase 2a~2g 완료)

## 결정

- **Phase 2a**: 내보내기/가져오기 (JSON 파일, 서버 불필요) — 즉시 착수
- **Phase 2b**: Google Drive `appdata` 폴더를 이용한 자동 동기화
  - 인증: Authorization Code Flow + PKCE
  - 플랫폼별 로그인 UX: Android(GIS 무음), iOS 17+(FedCM), iOS 16↓(One Tap)
  - 동기화: Opt-in, 변경 즉시 업로드

## 맥락

ADR-010에서 Phase 1 북마크는 `localStorage` 기반 클라이언트 전용으로 구현했다.
이후 iOS Safari의 **7일 비활성 자동 삭제 정책(ITP)** 이 확인되어 데이터 유실 위험이 존재한다.
홈 화면 PWA로 설치하면 ITP 적용이 제외되어 안전하지만, 미설치 사용자는 여전히 취약하다.

ADR-001 제약 조건: 백엔드 없는 SPA 아키텍처 유지 필수 — 서버 인프라 추가 불가.

Phase 2의 목표:

1. 디바이스 간 동기화 (같은 계정, 다른 기기)
2. 브라우저 저장소 삭제로 인한 데이터 유실 방지

## 검토한 대안

### 동기화 방식

| 방식                                  | 특징                                         | 결정        |
| ------------------------------------- | -------------------------------------------- | ----------- |
| 자체 서버 API (계정 시스템)           | 서버 인프라, 인증·가입·관리, 운영 비용 필요  | ❌          |
| 서드파티 BaaS (Firebase, Supabase 등) | 외부 서비스 의존성, 데이터 주권, 비용 가변   | ❌          |
| 내보내기/가져오기 (JSON 파일)         | 서버 불필요, 즉시 구현 가능, 수동 조작 필요  | ✅ Phase 2a |
| Google Drive appdata 동기화           | 서버 불필요, 자동 동기화, OAuth 앱 등록 필요 | ✅ Phase 2b |

### OAuth Flow (Phase 2b)

| 방식                      | 특징                                     | 결정    |
| ------------------------- | ---------------------------------------- | ------- |
| Authorization Code + PKCE | Client Secret 불필요, SPA 표준(RFC 7636) | ✅ 채택 |
| Implicit Flow             | Deprecated(RFC 9700)                     | ❌      |
| Client Secret 포함        | 프론트엔드 코드에 비밀 노출              | ❌      |

### Drive Scope (Phase 2b)

| Scope           | 접근 범위                         | 결정    |
| --------------- | --------------------------------- | ------- |
| `drive.appdata` | 앱 전용 숨김 폴더만               | ✅ 채택 |
| `drive.file`    | 앱 생성 파일, 사용자 Drive에 노출 | ❌      |
| `drive`         | Drive 전체 읽기·쓰기              | ❌      |

### 플랫폼별 인증 UX (Phase 2b)

| 방식                    | 플랫폼           | 결정       |
| ----------------------- | ---------------- | ---------- |
| GIS 기기 계정 무음 획득 | Android          | ✅ 채택    |
| FedCM                   | iOS 17+          | ✅ 채택    |
| Google One Tap          | iOS 16 이하 폴백 | ✅ 채택    |
| 매번 팝업               | 전체             | ❌ UX 불량 |

Android는 OS 수준에서 Google 계정이 연결되어 있어 Chrome 세션이 거의 항상 유효.
iOS는 Safari WebKit 세션 기반이지만 FedCM이 브라우저 신원 저장소를 사용해 세션 만료 빈도를 줄임.

### 토큰 저장 (Phase 2b)

| 방식           | XSS 위험       | 재시작 후 재로그인       | 결정    |
| -------------- | -------------- | ------------------------ | ------- |
| 메모리(변수)   | 없음           | GIS 무음 갱신으로 불필요 | ✅ 채택 |
| localStorage   | 토큰 탈취 위험 | 불필요                   | ❌      |
| sessionStorage | 토큰 탈취 위험 | 필요                     | ❌      |

Access Token 수명은 1시간. 만료 시 GIS가 브라우저 세션을 이용해 무음 재발급.
localStorage 저장 시 XSS 공격으로 Google 계정 접근권 탈취 가능 — 북마크 유출보다 피해 범위가 크므로 채택 불가.

### 동기화 트리거 (Phase 2b)

| 방식                   | 설명                            | 결정                                 |
| ---------------------- | ------------------------------- | ------------------------------------ |
| 변경 즉시              | 북마크·설정 변경 시 바로 업로드 | ✅ 채택                              |
| 앱 포커스 진입/이탈 시 | 호출 횟수 최소화                | ❌ 같은 기기 탭 여러 개 시 충돌 가능 |
| 주기적(30초~1분)       | 구현 복잡도 중간                | ❌ 변경 후 최대 1분 지연             |

북마크·설정 데이터는 수 KB 수준이므로 즉시 업로드 네트워크 부담 미미.

### 충돌 해결 (Phase 2b)

| 방식               | 설명                            | 결정    |
| ------------------ | ------------------------------- | ------- |
| Last-write-wins    | 단순, 동시 편집 시 데이터 손실  | ❌      |
| Merge-by-timestamp | `updatedAt` 기준 최신 버전 채택 | ✅ 채택 |
| 사용자 선택 UI     | 충돌마다 팝업, 인지 부하 과다   | ❌      |

---

## Phase 2a — 내보내기/가져오기 (서버 불필요)

구현 범위 (완료 2026-04-30):

- 북마크 드로어 툴바에 내보내기(`download`) / 가져오기(`upload`) 버튼 추가
- 내보내기: `bible-bookmarks-{날짜}.json` 파일 다운로드 (`_version`, `exportedAt`, `bookmarks` 필드)
- 가져오기: JSON 파일 선택 → `_validateImportData()` 검증 → 병합 또는 덮어쓰기 선택
- 병합: `id` 기준 중복 제거 — 동일 ID 항목은 기존 유지, 새 항목만 추가 (폴더 `children` 재귀 처리)
- 스키마 버전 필드(`_version: 1`) 추가로 향후 마이그레이션 대비

---

## Phase 2b — Google Drive 자동 동기화 (구현 완료 2026-05-02)

> **개정 (2026-05-02):** Phase 2b 구현 완료. 주요 구현 사항:
>
> - **`js/drive-sync.js` 신규**: GIS Implicit Token Flow 기반 인증, 업로드/다운로드/머지 구현
> - **토큰 전략**: `_accessToken` 메모리 전용, GIS `prompt:""` 백그라운드 재발급
> - **레이스 컨디션 방지**: `_isRefreshing` 플래그로 동시 401 응답 시 중복 `_silentSignIn()` 차단
> - **파싱 방어**: `res.json()` try-catch로 HTML 유지보수 페이지 등 예상치 못한 응답 처리
> - **충돌 해결 스낵바**: "다른 기기에서 변경된 데이터를 불러왔습니다." 알림 구현
> - **보안 감사**: `docs/audit/2026-05-02-171111.md` — Critical·High 0건, Medium 2건 수정, Info 2건 수용

### 앱 사용자 관점 흐름

#### 첫 기기 — 초기 설정

1. 설정 → "Google Drive 동기화" 토글 ON
2. Google 로그인 팝업 (최초 1회)
3. 권한 동의 — Drive 앱 폴더 접근
4. 현재 로컬 데이터 → Drive 업로드

#### 두 번째 기기 — 첫 접속

1. 앱 열기 → GIS 백그라운드 로그인 (재로그인 불필요)
2. Drive에서 `sync.json` 자동 pull
3. 북마크·설정·읽기 위치 자동 적용

#### 일상 사용

- 북마크 저장·삭제, 설정 변경 → 즉시 Drive 업로드
- 앱 열기 → Drive 최신 데이터 자동 pull → 로컬과 merge

#### 연결 해제

1. 설정 → "연결 해제"
2. Drive 파일 삭제 여부 선택
3. 로컬 데이터 유지, 이후 localStorage 전용으로 복귀

### 데이터 구조

```
localStorage (1차, 오프라인 우선)
    ↕ 동기화
Google Drive appdata/sync.json (2차, Google 계정 연동 시)
```

동기화는 Opt-in이며 기본값은 기존 localStorage 전용 동작 유지.

### 동기화 데이터 스키마 (`sync.json`)

```js
{
  version: 1,
  updatedAt: number,         // Unix ms — 충돌 해결 기준
  bookmarks: BookmarkStore,  // ADR-010 스키마 그대로
  settings: {
    fontSize: number,
    colorScheme: string,
    theme: string,
    bookOrder: string,
    startupBehavior: string,
  },
  lastRead: { bookId: string, chapter: number, verse: number },
}
```

### 충돌 해결 로직

Drive `sync.json`의 `updatedAt`과 로컬 `updatedAt` 비교:

- Drive가 더 최신 → Drive 데이터로 로컬 덮어쓰기
- 로컬이 더 최신 → Drive에 업로드
- 동일 → 무작동

### 기술 구현

- Google Identity Services (GIS) — 최신 OAuth 2.0 라이브러리
- Google Drive REST API v3 — `appDataFolder` 스코프
- Vanilla JS (기존 아키텍처 일관성 유지)

#### 인증 초기화 (`js/app.js`)

```js
// 앱 시작 시 무음 로그인 시도 (FedCM / 기기 계정)
google.accounts.id.initialize({
  client_id: CLIENT_ID,
  use_fedcm_for_prompt: true,
  callback: handleIdToken,
});
google.accounts.id.prompt(); // 실패 시 토큰 없이 진행, 로그인 버튼 표시

// 수동 로그인 버튼 클릭 시 (최초 또는 세션 만료)
const tokenClient = google.accounts.oauth2.initCodeClient({
  client_id: CLIENT_ID,
  scope: "https://www.googleapis.com/auth/drive.appdata",
  ux_mode: "popup",
  callback: handleAuthCode,
});
```

#### 서비스 워커 캐시 제외 (`sw.js`)

```js
// OAuth/Drive API 요청은 캐시 우회
if (
  url.hostname.endsWith("googleapis.com") ||
  url.hostname.endsWith("accounts.google.com")
) {
  return;
}
```

#### CSP 추가 (`index.html`)

```
script-src: 현재 + https://accounts.google.com
connect-src: 현재 + https://oauth2.googleapis.com
                   https://www.googleapis.com
                   https://content.googleapis.com
```

### Google 앱 등록 사전 조건

사용자가 자신의 Google 계정을 사용하더라도, **앱 자체**를 Google에 등록해야 한다.

1. Google Cloud Console에서 프로젝트 생성 (무료)
2. Google Drive API 활성화
3. OAuth 2.0 Client ID 발급 (Web application 타입, Client Secret 미사용)
4. 승인된 JavaScript 원본: 운영 도메인 + `http://localhost:8080`
5. 동의 화면(consent screen) 구성 + **Google 앱 심사(verification) 통과**

#### 앱 심사 요건

- 개인정보처리방침 URL 필요
- 앱 설명, 로고 등록
- 요청 scope 정당성 입증

심사 전: 테스트 사용자 100명으로 제한.
심사 후: 모든 Google 계정 사용자에게 개방.

`drive.appdata`는 제한된 스코프이나 민감 스코프에 해당하지 않아 심사 난이도 낮음.

---

## 채택 이유 요약

- **Phase 2a 즉시 착수**: 서버 없이 백업·이전 수단 제공, 사용자 데이터 주권 완전 보장
- **PKCE**: Client Secret 없이 SPA 표준 OAuth 구현, 프론트엔드 코드에 비밀 없음
- **`drive.appdata`**: 사용자 Drive 비노출, 최소 권한 원칙 준수
- **토큰 메모리 저장 + GIS 무음 갱신**: XSS 안전성과 "재로그인 없음" UX 동시 확보
- **FedCM/기기 계정**: 플랫폼 네이티브 수준 UX, 코드 분기는 GIS 라이브러리가 내부 처리
- **변경 즉시 동기화**: 데이터 크기 대비 지연 없는 동기화 체감

## 결과

- Phase 2a: 수동 백업/복원으로 데이터 유실 위험 즉시 해소
- Phase 2b: 디바이스 간 북마크·설정·읽기 위치 자동 동기화
- 재로그인 불필요 (Android: 항상, iOS 17+: FedCM, iOS 16↓: 세션 만료 시 One Tap 1회)
- XSS 시 토큰 탈취 불가 (메모리 전용)
- 기존 localStorage 동작 유지 (동기화 비활성 사용자 영향 없음)

## Phase 2c — 동기화 엔진 재설계 (구현 완료 2026-05-04)

> **개정 (2026-05-04):** Phase 2b 이후 버그봇 연속 발견(PR #20 18건, PR #26 6건)의 근본 원인을 해소하기 위해 동기화 엔진을 전면 재설계.
>
> - **데이터 모델 v2** (`js/sync/store-v2.js`): 문서 단위 LWW → 항목 단위 per-record mtime(`_u`) + tombstone. flat-map 북마크 + `mergeDocs()`.
> - **인증 FSM** (`js/sync/state-machine.js`): 6개 클로저 변수 → `_ctx = { netFails, conflictFails, reAuthFails, backoffTimer }` 명시적 컨텍스트. `_transition(nextState, ctxPatch)` 단일 진입점으로 "리셋 누락" 구조적 차단.
> - **ETag 낙관적 동시성** (`js/sync/transport.js`): `If-Match` 헤더로 동시 업로드 충돌 감지. 412 수신 시 최대 3회 재머지 재시도.
> - **Exponential backoff + OFFLINE**: 네트워크 오류 1s/2s/4s/8s/16s 재시도, 5회 초과 시 OFFLINE 상태. `online` 이벤트로 자동 복구.
> - **디버그 로그** (`js/sync/debug-log.js`): 메모리 ring buffer(recent 200, errors 20), 마스킹, `localhost` 전용 `console.debug`. 설정 팝오버에 "진단 정보 복사" 버튼.
> - **e2e 테스트** (`tests/e2e/test_drive_sync.py`): FakeDrive + GIS 스텁으로 5가지 시나리오 자동 검증.
> - **tombstone GC** (`sweepTombstones(ageDays=30)`): 앱 시작 시 30일 이상 경과한 tombstone 자동 제거.

## Phase 2d — iOS FedCM/One Tap 적용 (구현 완료 2026-05-05)

> **개정 (2026-05-05):** iOS Safari에서 앱을 열 때마다 "이 사이트에서 팝업 윈도우를 열려고 시도 중입니다." 차단 안내가 뜨는 문제 해결. Phase 2b는 GIS Token Client 단일 경로로, 페이지 로드 시 자동 `requestAccessToken({prompt:""})` 호출이 사용자 제스처 밖에서 `window.open()`을 트리거해 iOS가 팝업으로 인식했다. ADR-011 원안의 "iOS 17+ FedCM, iOS 16↓ One Tap" 인증 분기를 실제로 구현해 정합화.
>
> - **Identity Client 추가** (`js/sync/transport.js`): `initIdentityClient`/`promptIdentity`/`parseIdToken` 함수 신규. `google.accounts.id.initialize({use_fedcm_for_prompt: true, auto_select: true, itp_support: true})` + `prompt()` 사용. iOS 17+은 FedCM (브라우저 mediated UI), iOS 16↓은 One Tap (인라인 UI)으로 자동 폴백 — 둘 다 `window.open()` 미사용이라 iOS 팝업 차단 안내가 발생하지 않음.
> - **상태 머신 분리** (`js/sync/state-machine.js`): `AUTHENTICATING` 단일 상태를 `IDENTIFYING` → `AUTHENTICATING` 두 단계로 나눔. 페이지 로드 자동 흐름은 ID Client만 사용하므로 popup-blocker 다이얼로그가 발생하지 않음. `NEEDS_CONSENT` 상태 신설 — silent identity 실패 시 ERROR 대신 부드러운 상태에 머물고, 사용자가 "연결" 버튼을 클릭하면 그 사용자 제스처 안에서 `requestAccessToken({prompt:"consent"})`을 호출해 iOS가 팝업을 정상 허용.
> - **이벤트 추가**: `IDENTITY_OK { email, credential }` / `IDENTITY_FAIL { reason }` / `USER_CONSENT_REQUEST`. 401 재인증도 IDENTIFYING 단계를 거쳐 silent FedCM 갱신을 먼저 시도.
> - **email hint 자동 시드**: ID 토큰에서 추출한 email을 즉시 `bible-drive-sync-email`에 저장 → 후속 `requestAccessToken({prompt:"", hint:email})` 성공률 향상.
> - **테스트 스텁 확장** (`tests/e2e/test_drive_sync.py`): GIS 스텁이 `accounts.id.initialize`/`prompt`도 시뮬레이션하도록 확장. `__gisForceIdentityFail` 토글로 FedCM 미지원 환경 회귀 시나리오 시뮬레이션 가능.

### Phase 2d 동작 매트릭스

| 환경 | 페이지 로드 시 동작 | iOS 팝업 차단 안내 |
| --- | --- | --- |
| Android Chrome | FedCM/세션 쿠키로 silent identity → silent token | 발생 안 함 |
| iOS 17+ Safari | FedCM mediated UI로 silent identity → silent token | 발생 안 함 |
| iOS 16↓ Safari (사전 동의 있음) | One Tap UI로 identity → silent token | 발생 안 함 |
| iOS 16↓ Safari (사전 동의 없음) | identity 실패 → NEEDS_CONSENT, 사용자 "연결" 클릭 대기 | 발생 안 함 (사용자 제스처 안에서만 popup) |

## Phase 2e — FedCM-mandatory deprecation 마이그레이션 (구현 완료 2026-05-05)

> **개정 (2026-05-05):** 클린 환경에서 콘솔에 반복 출력되던 GSI deprecation 경고 (`Your client application uses one of the Google One Tap prompt UI status methods that may stop functioning when FedCM becomes mandatory`)와 `[GSI_LOGGER]: FedCM get() rejects with AbortError` 로그 제거. Phase 2d는 `prompt()` 콜백에서 `isNotDisplayed`/`isSkippedMoment`/`isDismissedMoment` 트리오로 prompt 결과를 분기했는데, FedCM 마이그레이션 가이드는 앞 두 메서드를 deprecated로 표시한다. 추가로 검증해보니 **`prompt()`에 콜백을 등록한다는 사실 자체**가 deprecation 경고의 트리거였다 (`isDismissedMoment`만 호출해도 경고 유지).
>
> 핵심 변경:
> - **`prompt()` 콜백 제거** (`js/sync/transport.js`): `promptIdentity()`가 `google.accounts.id.prompt()`를 인자 없이 호출. 성공은 `initIdentityClient`의 credential 콜백에서 수신하고, 실패(dismiss/suppression)는 사용자가 명시적으로 "연결" 버튼을 다시 누를 때까지 대기.
> - **wall-clock timeout 폴백 도입 후 폐기**: 처음엔 `IDENTITY_TIMEOUT_MS = 10000` 안전망을 추가했으나, 다계정 사용자가 FedCM 다이얼로그에서 결정하는 동안(>10s) `cancelIdentityPrompt()`가 발화돼 다이얼로그가 강제 종료되는 회귀가 발생. Google FedCM 가이드는 *앱이 FedCM UI 수명을 통제하지 말 것*을 권고하므로 timeout 자체를 제거하고 사용자 escape hatch(설정의 항시 노출되는 "연결" 버튼)에 의존하도록 변경.
> - **deprecated notification 메서드 호출 0건**: `isNotDisplayed`/`isSkippedMoment`/`isDismissedMoment`/`getNotDisplayedReason`/`getSkippedReason`/`getDismissedReason`/`getMomentType` 모두 코드에서 제거.
> - **테스트 스텁 정리** (`tests/e2e/test_drive_sync.py`): GIS_STUB의 `prompt`가 새 무인자 시그니처에 맞춰지고, dead-code였던 `__gisForceIdentityFail` 경로(deprecated 메서드를 시뮬레이션)를 삭제. 8개 e2e 시나리오 모두 정상 통과.

### Phase 2e 후 동작 매트릭스

| 시나리오 | 동작 |
|---------|------|
| FedCM 다이얼로그 표시 → 사용자 즉시 선택 | credential 콜백 → IDENTITY_OK → 정상 동기화 |
| FedCM 다이얼로그 표시 → 사용자 천천히 선택 (>10s) | 다이얼로그 유지, credential 콜백 → 정상 동기화 (Phase 2d 회귀 해결) |
| FedCM 다이얼로그 → 사용자 X로 닫음 | 무반응. 사용자가 설정 → "연결" 재클릭 시 OAuth consent 팝업으로 진행 |
| FedCM 미표시 (ITP/세션 없음) | 무반응. 위와 동일 escape hatch |
| auto re-authn 10분 rate limit (Google 정책) | 두 번째 새로고침에서 다이얼로그 표시. 첫 번째는 자동 |

### 알려진 무해한 부산물

- `https://accounts.google.com/gsi/status` 엔드포인트의 **403 Forbidden**: GIS 라이브러리 내부의 FedCM 사전 탐지 폴링. localhost가 OAuth 클라이언트의 정식 등록 origin이 아닌 환경에서 일관되게 발생. 인증 실제 동작과 무관하며 GIS가 graceful fallback 처리하므로 코드 변경 불요.

## Phase 2f — iOS OAuth 풀페이지 리디렉션 (구현 완료 2026-05-05)

> **개정 (2026-05-05):** Phase 2d/2e 적용 후에도 iPhone(iOS 26.X)에서 "팝업 윈도우를 열려고 시도" 안내가 재발 보고됨. 추가 조사 결과 Phase 2d 전제가 두 가지 점에서 잘못됐음이 확인됨.
>
> 1. **Safari는 FedCM을 영구 미지원**. Apple은 passkey에 집중하기로 결정했고 WebKit standards-positions에서 FedCM을 부정적으로 평가. `use_fedcm_for_prompt: true`는 iOS Safari에서 no-op이며, ID Client는 Phase 2d에서 가정한 "iOS 17+은 FedCM"으로 결코 동작하지 않음.
> 2. **GIS Token Client `requestAccessToken`은 popup-only**. Google 공식 token 모델 가이드: "Due to security concerns, only the popup UX is supported." 사용자 제스처 안에서 호출해도 iOS PWA standalone 모드에서는 popup 자체가 차단됨. iOS 26부터 홈 화면 추가 사이트가 기본 PWA 모드로 열리면서 영향 사용자 급증.
>
> 결론: GIS Token Client 경로로는 iOS 팝업 차단을 우회할 수 없음. iOS 한정으로 OAuth 2.0 Implicit Flow의 풀페이지 리디렉션을 수동 구현해야 함.

### 핵심 변경

- **iOS 감지 + 리디렉션 헬퍼** (`js/sync/transport.js`):
  - `isIOS()` — UA 기반 (`iPhone|iPod|iPad` + iPadOS 13+ 데스크톱 모드 위장 처리: `MacIntel + maxTouchPoints>1`)
  - `beginRedirectAuth(clientId, scope, {prompt})` — 32바이트 nonce + returnTo + ts를 `sessionStorage`에 저장 후 `location.href = "https://accounts.google.com/o/oauth2/v2/auth?..."`. `response_type=token`, `include_granted_scopes=true`, `login_hint`(저장된 email) 포함. `location.replace`는 사용 금지(뒤로가기로 앱 복귀 보존).
  - `consumeRedirectCallback()` — 부팅 시 동기적으로 호출. hash 파싱 → sessionStorage state nonce 일치 검증 → 10분 만료 검사 → 토큰/expiresIn/returnTo 반환. CSRF 방어 핵심.

- **상태 머신 분기** (`js/sync/state-machine.js`):
  - `acceptRedirectToken(access_token)` 신규 — 부팅 단계에서 직접 IDLE로 진입 (GIS 의존 없음).
  - 4개 진입점에 iOS 분기: `S.IDENTIFYING + USER_CONSENT_REQUEST`, `S.NEEDS_CONSENT + USER_CONSENT_REQUEST`, `S.ERROR + (ENABLE|USER_CONSENT_REQUEST)`, `_handleSyncFail` 401 분기.
  - **하이브리드 401 처리**: `_isUserActivelyReading()` (visibility=visible + hasFocus=true + 5초 이내 인터랙션) 휴리스틱으로 사용자가 활발히 읽는 중이면 snackbar+`NEEDS_CONSENT` 보류, 유휴 상태면 자동 풀페이지 리디렉션.
  - **무한 리디렉션 차단**: `_ctx.reAuthFails`는 페이지 전환 시 휘발되므로 `localStorage["bible-drive-redirect-attempts"]` 별도 카운터(상한 3회) 도입.

- **부팅 흐름** (`js/drive-sync.js`):
  - **top-level IIFE**가 라우팅보다 먼저 `consumeRedirectCallback()` 호출 → `history.replaceState`로 hash 즉시 정리(토큰 노출 시간 < 100ms) → `window.__pendingRedirectToken`에 stash.
  - `initDriveSync()`가 pending 토큰을 흡수해 `_machine.acceptRedirectToken()` 호출.
  - 글로벌 인터랙션 리스너(`pointerdown`/`keydown`/`scroll`/`touchstart`)로 `_lastInteractionTs` 갱신, `window.__driveSyncInteractionTs` 노출.
  - `signIn()`이 iOS 환경에서 GIS 폴링 없이 즉시 `T.beginRedirectAuth(prompt:"consent")`. 안내 토스트 "Google 인증 페이지로 이동합니다. 인증 후 자동으로 돌아옵니다."

### Phase 2f 후 동작 매트릭스

| 환경 | 페이지 로드 동작 | "연결" 클릭 동작 | iOS 팝업 안내 |
|------|----------------|-----------------|--------------|
| Android Chrome | FedCM/세션 → silent token | popup consent | 해당 없음 |
| 데스크톱 Chrome/Firefox | FedCM(지원 시) → silent token | popup consent | 해당 없음 |
| iOS 17+ Safari (탭) | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |
| iOS PWA standalone | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |
| iOS 16↓ Safari | 풀페이지 리디렉션 | 풀페이지 리디렉션 | **발생 안 함** |

Phase 2d/2e의 FedCM/One Tap 코드는 비-iOS 환경에서 그대로 활성화되며, iOS 분기는 `window.google.accounts.*` 호출을 모두 건너뜀.

### OAuth Flow 재평가

Phase 2b의 결정 표는 비-iOS 환경에 한해 유효함을 명시. iOS는 별도 경로:

| 환경 | OAuth Flow | 이유 |
|------|----------|-----|
| Android, 데스크톱 (FedCM 가능) | Authorization Code via GIS (Phase 2b/2d) | popup 없는 무중단 인증 |
| iOS Safari (모든 모드/버전) | **Implicit Flow + 풀페이지 리디렉션** (Phase 2f) | popup-only GIS Token Client 우회 |

Implicit Flow 일반 단점에 대한 우리 환경 평가:
- *Refresh token 부재* → `drive.appdata + email` scope 한정이라 무관 (1시간 만료 후 hybrid 자동 재인증)
- *access_token이 hash 노출* → IIFE가 `replaceState`로 즉시 정리, 외부 노출 시간 < 100ms
- *OAuth 2.1 deprecated* → Google이 2026-04 시점 명시적 지원 유지, scope 단위 검수에 영향 없음

### 외부 의존 변경

Google Cloud Console OAuth 2.0 Client(dev/prod 양쪽)의 **Authorized redirect URIs**에 다음 추가 필요:
- dev: `http://localhost:8080/`
- prod: `https://bible.anglican.kr/`
- trailing slash 정확히 일치해야 함 (`https://bible.anglican.kr`는 다른 URI로 취급)

Authorized JavaScript origins / scope 설정 변경 없음 → OAuth 검수 재제출 불요.

### 알려진 트레이드오프

- **첫 연결 UX**: iOS 사용자에게 앱이 닫혔다 다시 열린 듯한 깜박임 발생. 안내 토스트로 완화.
- **state nonce 만료**: 10분 — 사용자가 OAuth 페이지에 30분 머물면 callback 검증 실패. snackbar로 안내.
- **외부 핸드오프 엣지 케이스**: Universal Link 설정에 따라 OAuth가 외부 Safari로 핸드오프 가능. PWA sessionStorage 격리 → nonce 검증 실패 → "브라우저에서 다시 시도해 주세요" 안내.
- **자동 리디렉션 cap**: localStorage 카운터 3회 초과 시 ERROR 강제 전이로 무한 루프 차단.

## Phase 2f 후속 정제 (2026-05-06)

> **개정 (2026-05-06):** PR #37 머지 직전·직후 Cursor Bugbot 6차 리뷰와 PR #40 추가 리뷰가 누적되며 Phase 2f의 보안·견고성 면을 후속 정제했다. 새로운 결정 사항은 없으나 동작 계약(contract)을 명시화한다.

### 보안 강화 (CSRF·재시도 통제)

- **state nonce CSRF 검증 강화**: `consumeRedirectCallback()`에 untrusted 에러(`error_uri` 도메인 불일치 등) 분기 추가. nonce 검증 실패 시 사용자가 상상 불가능한 외부 페이지로 부터의 redirect를 흡수하는 일이 없도록 returnTo를 `/`로 강제 이탈시키지 않고 ERROR 상태에서 사용자 안내로 전환.
- **redirect counter 무한 루프 방어**: localStorage `bible-drive-redirect-attempts` 카운터의 키가 두 곳에 하드코딩돼 있어 한 곳 갱신 누락 시 카운트가 무력화되는 결함 발견. 단일 상수로 통일.
- **cap 초과 시 단일 종착 상태**: `MAX_REDIRECT_ATTEMPTS` 초과 시 `NEEDS_CONSENT → ERROR` 이중 전환 + `_refreshUI` 이중 호출이 발생하던 경로 차단. `_transition` 한 번으로 ERROR 진입.
- **iOS 401 분기**: `_handleSyncFail` 401 핸들러가 GIS-only 흐름을 가정해 reAuthFails 카운터를 증가시키지 않던 누락 수정. iOS는 401 수신 즉시 `NEEDS_CONSENT`로 전환 후 `_isUserActivelyReading()` 휴리스틱이 false면 자동 리디렉션, true면 snackbar 안내.

### GIS Token Client 빈 응답 stuck 방지 (PR #40)

- **증상**: 비-iOS 환경에서 GIS Token Client 콜백이 `error: undefined` + `access_token: undefined` 빈 응답을 던지는 케이스(쿠키 정책·세션 만료·third-party iframe 차단 등) 관찰됨. 기존 코드는 `response.error`만 분기 처리해 빈 응답에서 `AUTHENTICATING` 상태로 무한 대기.
- **해결** (`js/sync/transport.js` + `js/sync/state-machine.js`): 콜백이 호출됐는데 `access_token`도 `error`도 없는 경우 `IDENTITY_FAIL { reason: "empty_response" }` 발화. 상태 머신은 이를 NEEDS_CONSENT로 흡수해 사용자 escape hatch(설정의 "연결" 버튼)에 의존.

### iOS 유휴 감지 정교화

- **OFFLINE → NET_RECOVERED**: 네트워크 복구 핸들러가 비-iOS만 가정하고 GIS `requestAccessToken({prompt:""})`을 시도 — iOS에서는 popup 차단 회귀. iOS 분기를 추가해 NET_RECOVERED 시 즉시 자동 리디렉션 대신 IDLE 상태에서 다음 사용자 액션을 기다리도록 변경.
- **OAuth scope 중복**: `transport.js`가 scope 문자열을 `"drive.appdata email"` + `parseIdToken` email 추출용 별도 scope로 두 번 적용해 Google에서 중복 scope 경고 발생. 단일 scope 상수로 통일.
- **iOS GIS 폴링 폐기**: iOS 분기에서는 GIS 라이브러리가 로드되더라도 `_pollGoogleId` 인터벌이 무의미하므로 즉시 단락(short-circuit).
- **expiresIn dead data 제거**: `acceptRedirectToken`이 expiresIn을 받았으나 어디에도 활용되지 않아 dead-code. 시그니처에서 제거.

### 접근성

- 설정의 Drive 정보 버튼 `aria-label`을 "Google Drive 동기화 정보"로 명시화 (이전: 빈 값).

### 회귀 방어 — 유닛 테스트

ADR-013 (클라이언트 JS 유닛 테스트 전략) 참고. 위 6차 리뷰 정제 항목 중 다음을 재현 가능한 시나리오로 고정:

- iOS ENABLE + email 없음 시 NEEDS_CONSENT 정착 (첫 연결 흐름)
- 401 재인증 시 reAuthFails 카운터 단조 증가
- redirect attempts cap 초과 시 단일 ERROR 전이
- 빈 GIS 토큰 응답 → IDENTITY_FAIL 흡수

> Phase 2g(아래)에서 `iOS ENABLE + 저장된 email` 케이스의 동작이 자동 silent 리디렉션으로 변경됨. 회귀 방어 항목도 함께 갱신됨 — 자세한 시나리오는 Phase 2g § 회귀 테스트 참고.

## Phase 2g — iOS 앱 재실행 시 silent prompt=none 자동 리디렉션 (구현 완료 2026-05-06)

> **개정 (2026-05-06):** Phase 2f 배포 후 사용자 보고 — iOS PWA에서 한 번 연결한 뒤 앱을 종료하고 다시 열면 동기화가 해제된 것처럼 보인다(설정 화면에 "연결" 버튼 다시 노출). Phase 2f 구현은 부팅 시 hash callback이 없으면 `DISABLED → ENABLE` 분기에서 무조건 `NEEDS_CONSENT`로 파킹해, 매 앱 오픈마다 사용자가 "연결" 버튼을 다시 눌러야 했음. ADR-011 Phase 2f 동작 매트릭스의 "iOS PWA standalone | 페이지 로드 동작: 풀페이지 리디렉션" 항목과 실제 구현이 어긋나 있었음.

### 핵심 변경

- **silent 자동 리디렉션 진입** (`js/sync/state-machine.js`):
  - `DISABLED + ENABLE` iOS 분기에서 `bible-drive-sync-email`이 저장돼 있으면 `_beginRedirect("none")`을 호출. Implicit Flow는 refresh token이 없어 in-memory 토큰이 앱 종료와 함께 사라지지만, Google 측 세션이 유효하면 `prompt=none`이 즉시 토큰을 재발급한다. 페이지 깜박임 ≤ 1초.
  - 진입 가드 두 단계: (1) 저장된 email이 없으면 NEEDS_CONSENT (첫 연결 흐름), (2) `bible-drive-silent-blocked` 플래그가 1이면 NEEDS_CONSENT (이전 silent 시도 실패).

- **silent-blocked 플래그** (`localStorage["bible-drive-silent-blocked"]`):
  - silent 리디렉션이 `interaction_required` / `consent_required` / `login_required`로 실패하면 IIFE가 1로 설정. 다음 앱 오픈에 의미 없는 깜박임 반복을 차단.
  - 다음 시점에 제거: (1) `signIn()` (사용자 제스처로 명시적 재연결), (2) `signOut()`, (3) `SYNC_DONE` (defense in depth — silent 경로가 다시 작동한다는 증거), (4) silent 재인증 callback 성공.

- **redirect callback의 silent 분기** (`js/sync/transport.js` + `js/drive-sync.js`):
  - `beginRedirectAuth`가 sessionStorage state에 `silent: prompt === "none"` 저장.
  - `consumeRedirectCallback`이 모든 반환 경로(success/error/expired/state_mismatch)에 `silent` 필드 포함.
  - IIFE가 silent 실패는 user-facing 토스트 없이 silent-blocked 플래그만 설정 (자동 background 시도의 정상적 실패 경로).

- **types.d.ts**: `RedirectCallbackResult`에 `silent: boolean` 필수 필드 추가, `Window._syncSilentBlockedKey?: string` 추가.

### Phase 2g 후 iOS 앱 오픈 매트릭스

| 상태 | localStorage | 페이지 로드 동작 |
|------|--------------|-----------------|
| 첫 방문 / signOut 직후 | `bible-drive-sync=0` | `initDriveSync()` early return — 동기화 비활성 |
| 한 번 연결, 정상 흐름 | `bible-drive-sync=1`, email 저장, silent-blocked 없음 | **silent prompt=none 자동 리디렉션** (브리프 깜박임 → IDLE → 자동 sync) |
| silent 직전 실패 후 재오픈 | silent-blocked=1 | NEEDS_CONSENT (사용자 "연결" 클릭 대기) |
| 자동 시도 cap 도달 | redirect-attempts ≥ 3 | ERROR + snackbar (사용자 "연결" 클릭으로 cap + silent-blocked 모두 리셋) |

### 회귀 테스트

`tests/unit/state-machine.test.js`:
- `3.` (갱신): iOS ENABLE + email 없음 → NEEDS_CONSENT
- `3a.` (신규): iOS ENABLE + email → `prompt=none` 리디렉션 + 카운터 1 증가
- `3b.` (신규): iOS ENABLE + email + silent-blocked=1 → NEEDS_CONSENT, beginRedirectAuth 미호출
- `3c.` (신규): iOS ENABLE + email + cap 도달 → ERROR
- `3d.` (신규): iOS ENABLE + email = `""` (빈 문자열) → NEEDS_CONSENT
- `3e.` (신규): SYNC_DONE 시 silent-blocked 제거

### 알려진 트레이드오프

- **앱 오픈 깜박임**: 매 cold start마다 accounts.google.com으로의 짧은 round-trip 발생. 빠른 망에서 < 1초, 느린 모바일 망에서 1~3초. `prompt=none`은 UI를 표시하지 않으므로 도메인 플래시만 보임.
- **Google 자체 세션 만료**: Google OAuth 세션은 서버 측에서 일정 기간(약 2주) 비활성 시 만료된다. 이 경우 silent 시도는 `login_required`를 반환 → silent-blocked=1로 떨어져 사용자가 "연결"을 다시 눌러야 한다. 첫 실패는 묵묵히 NEEDS_CONSENT, 이후 자동 시도 없음. (※ iOS Safari 탭 7일 ITP storage cap은 **홈 화면 PWA에는 적용되지 않으므로** 설치 사용자에겐 무관 — ADR-011 §맥락 참고.)
- **외부 revoke 감지**: 사용자가 Google 계정 설정에서 권한을 끊으면 silent 시도는 `consent_required`를 반환 → silent-blocked=1. 이는 의도된 동작 — 다음 사용자 제스처 시점에 명시적 consent로 복구.

### Bugbot 1차 리뷰 정제 (PR #43)

- **Consent 거부 후 자동 silent 재시도 차단**: `signIn()`은 명시적 재연결 진입에서 silent-blocked 플래그를 비우는데, Google에서 사용자가 consent를 거부하고 돌아오면 (`__pendingRedirectError`) `initDriveSync()`이 토스트만 띄우고 `_machine.enable()`을 호출 → DISABLED+ENABLE iOS 분기가 (email 있음 + silent-blocked 없음) prompt=none을 즉시 발사 → 토스트 파괴 + 무용한 round-trip. iOS 분기에서 `__pendingRedirectError` 처리 시 silent-blocked=1을 설정해 `enable()`이 NEEDS_CONSENT에 정착하도록 정정.
- **silent-blocked 키 단일화**: `signIn()`은 `window._syncSilentBlockedKey` 상수를 사용했지만 IIFE 2곳과 `signOut()`은 리터럴 `"bible-drive-silent-blocked"`을 하드코딩 → Phase 2f에서 `REDIRECT_ATTEMPTS_KEY`로 잡았던 것과 동일한 패턴. 모두 상수 참조로 통일.

## 미결 사항

- [x] Google Cloud Console 프로젝트 생성 및 Client ID 발급
- [x] 개인정보처리방침 작성
- [x] Drive API 호출 실패 재시도 전략 — exponential backoff (PR #26, Phase 2c)
- [x] 동기화 충돌 결과 사용자 알림 UX
- [ ] Google OAuth 앱 검수 통과 (2026-05-02 제출 완료, 심사 결과 대기 중)
- [ ] **Google Cloud Console redirect URI 등록** (dev `http://localhost:8080/`, prod `https://bible.anglican.kr/`) — Phase 2f 배포 전 필수
- [x] iOS Safari 팝업 차단 안내 제거 (Phase 2d, 2026-05-05) — FedCM/One Tap + 사용자 제스처 격리
- [x] iOS Safari 팝업 차단 안내 완전 제거 (Phase 2f, 2026-05-05) — Implicit Flow 풀페이지 리디렉션 (Phase 2d 가정 오류 정정)
- [x] FedCM-mandatory deprecation 경고 제거 (Phase 2e, 2026-05-05) — `prompt()` 콜백 + timeout 폴백 폐기
- [x] 항목 단위 병합 — per-record LWW + tombstone (Phase 2c, `js/sync/store-v2.js`)
- [x] 내보내기/가져오기 JSON 스키마 `_version: 1` 추가
- [x] tombstone GC (`sweepTombstones`, 30일 기준, 앱 시작 시 실행)
