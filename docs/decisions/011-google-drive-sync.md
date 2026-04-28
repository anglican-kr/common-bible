# ADR-011: Google Drive 동기화 설계

- 일시: 2026-04-28
- 상태: 승인됨

## 결정

Google Drive `drive.appdata` 스코프를 이용해 북마크·설정·읽기 위치를
클라우드 동기화한다. 인증은 Authorization Code Flow + PKCE로 하며,
플랫폼별 최적 로그인 UX를 제공한다:

- **Android**: GIS 기기 계정 (`prompt: ''` 무음 획득)
- **iOS 17+**: FedCM (`use_fedcm_for_prompt: true`)
- **iOS 16 이하**: Google One Tap 폴백

동기화는 Opt-in이며 기본값은 기존 localStorage 전용 동작 유지.
동기화 트리거는 **변경 즉시** (북마크 저장·삭제, 설정 변경 시 Drive 업로드).

## 맥락

ADR-010 미결 사항("디바이스 간 동기화 Phase 2 이후 검토")을 해소.

- 백엔드 없는 SPA 아키텍처(ADR-001) 유지 필수 — 서버 인프라 추가 불가
- localStorage는 디바이스 간 공유 불가, 브라우저 데이터 초기화 시 소실
- Google Drive `appdata` 폴더는 사용자 Drive에 보이지 않아 프라이버시 친화적
- iOS·Android 모두 앱 재시작 시 재로그인 없이 동작해야 함 (UX 요건)

## 앱 사용자 관점 흐름

### 첫 기기 — 초기 설정

1. 설정 → "Google Drive 동기화" 토글 ON
2. Google 로그인 팝업 (최초 1회)
3. 권한 동의 — Drive 앱 폴더 접근
4. 현재 로컬 데이터 → Drive 업로드

### 두 번째 기기 — 첫 접속

1. 앱 열기 → GIS 무음 로그인 (재로그인 불필요)
2. Drive에서 `sync.json` 자동 pull
3. 북마크·설정·읽기 위치 자동 적용

### 일상 사용

- 북마크 저장·삭제, 설정 변경 → 즉시 Drive 업로드
- 앱 열기 → Drive 최신 데이터 자동 pull → 로컬과 merge

### 연결 해제

1. 설정 → "연결 해제"
2. Drive 파일 삭제 여부 선택
3. 로컬 데이터 유지, 이후 localStorage 전용으로 복귀

## 검토한 대안

### OAuth Flow

| 방식 | 특징 | 결정 |
|------|------|------|
| Authorization Code + PKCE | Client Secret 불필요, SPA 표준(RFC 7636) | ✅ 채택 |
| Implicit Flow | Deprecated(RFC 9700) | ❌ |
| Client Secret 포함 | 프론트엔드 코드에 비밀 노출 | ❌ |

### Drive Scope

| Scope | 접근 범위 | 결정 |
|-------|-----------|------|
| `drive.appdata` | 앱 전용 숨김 폴더만 | ✅ 채택 |
| `drive.file` | 앱 생성 파일, 사용자 Drive에 노출 | ❌ |
| `drive` | Drive 전체 읽기·쓰기 | ❌ |

### 플랫폼별 인증 UX

| 방식 | 플랫폼 | 결정 |
|------|--------|------|
| GIS 기기 계정 무음 획득 | Android | ✅ 채택 |
| FedCM | iOS 17+ (2023-09 출시, 현시점 주요 버전) | ✅ 채택 |
| Google One Tap | iOS 16 이하 폴백 | ✅ 채택 |
| 매번 팝업 | 전체 | ❌ UX 불량 |

Android는 OS 수준에서 Google 계정이 연결되어 있어 Chrome 세션이 거의 항상 유효.
iOS는 Safari WebKit 세션 기반이지만 FedCM이 브라우저 신원 저장소를 사용해 세션 만료 빈도를 줄임.

### 토큰 저장

| 방식 | XSS 위험 | 재시작 후 재로그인 | 결정 |
|------|----------|-------------------|------|
| 메모리(변수) | 없음 | GIS 무음 갱신으로 불필요 | ✅ 채택 |
| localStorage | 토큰 탈취 위험 | 불필요 | ❌ |
| sessionStorage | 토큰 탈취 위험 | 필요 | ❌ |

Access Token 수명은 1시간. 만료 시 GIS가 브라우저 세션을 이용해 무음 재발급.
localStorage에 저장 시 XSS 공격으로 Google 계정 접근권 탈취 가능 — 기존 북마크 유출보다 피해 범위가 훨씬 크므로 채택 불가.

### 동기화 트리거

| 방식 | 설명 | 결정 |
|------|------|------|
| 변경 즉시 | 북마크·설정 변경 시 바로 업로드 | ✅ 채택 |
| 앱 포커스 진입/이탈 시 | pull/push 호출 횟수 최소화 | ❌ 같은 기기 탭 여러 개 시 충돌 가능 |
| 주기적(30초~1분) | 구현 복잡도 중간 | ❌ 변경 후 최대 1분 지연 |

북마크·설정 데이터는 수 KB 수준이므로 즉시 업로드 네트워크 부담 미미.

### 충돌 해결

| 방식 | 설명 | 결정 |
|------|------|------|
| Last-write-wins | 단순, 동시 편집 시 데이터 손실 | ❌ |
| Merge-by-timestamp | `updatedAt` 기준 최신 버전 채택 | ✅ 채택 |
| 사용자 선택 UI | 충돌마다 팝업, 인지 부하 과다 | ❌ |

## 채택 이유

- **PKCE**: Client Secret 없이 SPA 표준 OAuth 구현. 프론트엔드 코드에 비밀 없음
- **`drive.appdata`**: 사용자 Drive 비노출, 최소 권한 원칙 준수
- **토큰 메모리 저장 + GIS 무음 갱신**: XSS 안전성과 "재로그인 없음" UX 동시 확보
- **FedCM/기기 계정**: 플랫폼 네이티브 수준 UX, 코드 분기는 GIS 라이브러리가 내부 처리
- **변경 즉시 동기화**: 데이터 크기 대비 지연 없는 동기화 체감

## 변경 내용

### 동기화 데이터 스키마 (Drive appdata 파일: `sync.json`)

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

### 인증 초기화 (`js/app.js`)

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
  scope: 'https://www.googleapis.com/auth/drive.appdata',
  ux_mode: 'popup',
  callback: handleAuthCode,
});
```

### 서비스 워커 캐시 제외 (`sw.js`)

```js
// OAuth/Drive API 요청은 캐시 우회
if (url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('accounts.google.com')) {
  return;
}
```

### CSP 추가 (`index.html`)

```
script-src: 현재 + https://accounts.google.com
connect-src: 현재 + https://oauth2.googleapis.com
                   https://www.googleapis.com
                   https://content.googleapis.com
```

### 충돌 해결 로직

Drive `sync.json`의 `updatedAt`과 로컬 `updatedAt` 비교:

- Drive가 더 최신 → Drive 데이터로 로컬 덮어쓰기
- 로컬이 더 최신 → Drive에 업로드
- 동일 → 무작동

### Google Cloud Console 사전 설정

- OAuth 클라이언트 ID: 웹 애플리케이션 유형, Client Secret 미사용
- 승인된 JavaScript 원본: 운영 도메인 + `http://localhost:8080`
- Drive API 활성화
- `drive.appdata`는 제한된 스코프 — 배포 전 Google OAuth 앱 검수 필요 (수 주 소요)

## 결과

- 디바이스 간 북마크·설정·읽기 위치 동기화
- 재로그인 불필요 (Android: 항상, iOS 17+: FedCM, iOS 16↓: 세션 만료 시 One Tap 1회)
- XSS 시 토큰 탈취 불가 (메모리 전용)
- 기존 localStorage 동작 유지 (동기화 비활성 사용자 영향 없음)

## 미결 사항

- Drive API 호출 실패(네트워크 오류) 시 재시도 전략 (exponential backoff 등)
- 동기화 충돌 결과 사용자 알림 UX (예: "다른 기기에서 변경된 데이터를 불러왔습니다" 스낵바)
- Google OAuth 앱 검수 제출 시점 및 서류 준비
