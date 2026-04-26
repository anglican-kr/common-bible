# ADR-011: 북마크 디바이스 간 동기화

- 일시: 2026-04-26
- 개정: 2026-04-28 (Google Drive 동기화 기술 결정 확정)
- 상태: 승인됨 (Phase 2a 구현 예정, Phase 2b 설계 확정)

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

구현 범위:

- 북마크 드로어 툴바에 내보내기(`download`) / 가져오기(`upload`) 버튼 추가
- 내보내기: `bible-bookmarks-{날짜}.json` 파일 다운로드
- 가져오기: JSON 파일 선택 → 현재 데이터와 병합 또는 덮어쓰기 선택
- 스키마 버전 필드(`_version`) 추가로 향후 마이그레이션 대비

---

## Phase 2b — Google Drive 자동 동기화

### 앱 사용자 관점 흐름

#### 첫 기기 — 초기 설정

1. 설정 → "Google Drive 동기화" 토글 ON
2. Google 로그인 팝업 (최초 1회)
3. 권한 동의 — Drive 앱 폴더 접근
4. 현재 로컬 데이터 → Drive 업로드

#### 두 번째 기기 — 첫 접속

1. 앱 열기 → GIS 무음 로그인 (재로그인 불필요)
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

## 미결 사항

- [ ] Google Cloud Console 프로젝트 생성 및 Client ID 발급
- [ ] 개인정보처리방침 작성 (앱 심사 필수 조건)
- [ ] Drive API 호출 실패(네트워크 오류) 시 재시도 전략 (exponential backoff 등)
- [ ] 동기화 충돌 결과 사용자 알림 UX (예: "다른 기기에서 변경된 데이터를 불러왔습니다" 스낵바)
- [ ] Google OAuth 앱 검수 제출 시점 및 서류 준비
- [ ] 충돌 해소 전략 고도화 여부 결정 (현재: 문서 단위 last-write-wins → 향후: 항목 단위 병합)
- [ ] `localStorage` 스키마에 `_version` 필드 추가 시점
