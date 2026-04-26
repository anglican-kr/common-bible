# ADR-011: 북마크 디바이스 간 동기화 (Phase 2)

- 일시: 2026-04-26
- 개정: 2026-04-26 (Google Drive 방향 확정)
- 상태: 검토 중 (Phase 2a 구현 예정, Phase 2b 설계 중)

## 결정

- **Phase 2a**: 내보내기/가져오기 (JSON 파일, 서버 불필요) — 즉시 착수
- **Phase 2b**: Google Drive `appdata` 폴더를 이용한 자동 동기화 — 설계 중

## 맥락

ADR-010에서 Phase 1 북마크는 `localStorage` 기반 클라이언트 전용으로 구현했다.
이후 iOS Safari의 **7일 비활성 자동 삭제 정책(ITP)** 이 확인되어 데이터 유실 위험이 존재한다.
홈 화면 PWA로 설치하면 ITP 적용이 제외되어 안전하지만, 미설치 사용자는 여전히 취약하다.

Phase 2의 목표:
1. 디바이스 간 동기화 (같은 계정, 다른 기기)
2. 브라우저 저장소 삭제로 인한 데이터 유실 방지

## 검토한 대안

### A. 자체 서버 API (계정 시스템)
- 단점: 서버 인프라, 계정 시스템(인증·가입·관리), 운영 비용, 개발 범위 대폭 확대

### B. 서드파티 BaaS (Firebase, Supabase 등)
- 단점: 외부 서비스 의존성, 데이터 주권, 비용 가변성

### C. 내보내기/가져오기 (JSON 파일) → **Phase 2a로 채택**
- 장점: 서버 불필요, 즉시 구현 가능, 데이터 주권 완전 보장
- 단점: 수동 조작 필요, 자동 동기화 불가

### D. Google Drive appdata 동기화 → **Phase 2b로 채택**
- 장점: 자체 서버 불필요, 사용자 Google 계정에 데이터 저장 (데이터 주권 보장),
  Drive 목록에 노출되지 않는 앱 전용 폴더(`appdata`) 사용, 운영 비용 없음
- 단점: Google OAuth 앱 등록 필요 (아래 참조)
- 결론: 서버 없이 자동 동기화를 달성할 수 있는 현실적인 최선안

## Phase 2a — 내보내기/가져오기 (서버 불필요)

구현 범위:
- 북마크 드로어 툴바에 내보내기(`download`) / 가져오기(`upload`) 버튼 추가
- 내보내기: `bible-bookmarks-{날짜}.json` 파일 다운로드
- 가져오기: JSON 파일 선택 → 현재 데이터와 병합 또는 덮어쓰기 선택
- 스키마 버전 필드(`_version`) 추가로 향후 마이그레이션 대비

## Phase 2b — Google Drive 동기화

### 구조

```
localStorage (1차, 오프라인 우선)
    ↕ 동기화
Google Drive appdata/bible-bookmarks.json (2차, Google 계정 연동 시)
```

### 사전 조건: Google 앱 등록

사용자가 자신의 Google 계정을 사용하더라도, **앱 자체**를 Google에 등록해야 한다.
Google이 "어떤 앱이 사용자의 Drive에 접근하는가"를 검증하기 위함이다.

1. Google Cloud Console에서 프로젝트 생성 (무료)
2. Google Drive API 활성화
3. OAuth 2.0 Client ID 발급 (Web application 타입)
4. 허가된 도메인 등록
5. 동의 화면(consent screen) 구성 + **Google 앱 심사(verification) 통과**

#### 앱 심사 요건

- 개인정보처리방침 URL 필요
- 앱 설명, 로고 등록
- 요청 scope 정당성 입증

심사 전: 테스트 사용자 100명으로 제한.
심사 후: 모든 Google 계정 사용자에게 개방.

#### 요청 권한 (최소 scope)

```
https://www.googleapis.com/auth/drive.appdata
```

Drive 전체가 아닌 앱 전용 폴더만 접근. 심사 난이도 낮음.

### 동기화 전략

- **오프라인 우선**: `localStorage`가 단일 진실 소스. Drive는 백업/동기화 수단
- **충돌 해소**: `updatedAt` 타임스탬프 기준 최신 데이터 우선 (last-write-wins)
  - 향후 필요 시 항목 단위 병합으로 고도화 가능
- **동기화 시점**: 드로어 열 때, 저장·삭제 후, 앱 포그라운드 복귀 시

### 기술 구현

- Google Identity Services (GIS) — 최신 OAuth 2.0 라이브러리
- Google Drive REST API v3 — `appDataFolder` 스코프
- 프레임워크 없이 Vanilla JS (기존 아키텍처 일관성 유지)

## 미결 사항

- Google Cloud Console 프로젝트 생성 및 Client ID 발급
- 개인정보처리방침 작성 (앱 심사 필수 조건)
- 충돌 해소 전략 고도화 여부 결정
- `localStorage` 스키마에 `_version` 필드 추가 시점
