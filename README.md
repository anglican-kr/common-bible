# 공동번역성서 PWA

대한성공회를 위한 공동번역성서 프로그레시브 웹 앱(PWA).
장기적으로 기도서, 교회력, 성무일과까지 통합하는 전례 앱으로 확장 예정.

배포 URL: https://bible.anglican.kr

> 실제 공동번역성서 개정판의 저작권은 대한성서공회에 있으며, 이 프로젝트는 비상업적 용도로만 사용됩니다. 성경 원본 텍스트·음원은 비공개 서브모듈로 관리되며, 접근 권한이 있는 사용자만 이용할 수 있습니다.

## 아키텍처

Python 스크립트로 마크다운 소스를 JSON으로 전처리하고, 브라우저가 JSON을 직접 읽어 렌더링하는 SPA 방식.

```
source/*.md  (data 저장소 안, 73권 마크다운)
  → parser.py → output/parsed_bible.json
  → split_bible.py → bible/{book_id}-{chapter}.json (1328) + books.json
  → search_indexer.py → search-{meta,ot,nt,dc}.json
```

본문 데이터·Python 파이프라인은 `common-bible-data` 비공개 저장소(`data/` 서브모듈), 오디오는 `common-bible-audio` LFS 저장소(`data/audio/` nested 서브모듈).

## 저장소 토폴로지 (ADR-020)

| 저장소 | 가시성 | 역할 |
|---|---|---|
| `anglican-kr/common-bible` (본 저장소) | 공개 | PWA 프론트엔드 · sw.js · JS 유닛/e2e · 릴리스 스크립트 |
| `anglican-kr/common-bible-data` | 비공개 | 마크다운 원본 + Python 파이프라인 + 빌드 출력 + 데이터 검증 테스트 |
| `anglican-kr/common-bible-audio` | 비공개 (LFS) | 장별 mp3 |
| `anglican-kr/common-bible-server` | 비공개 | nginx 설정(BFF·보안 헤더) + 배포 스크립트 |

clone 시 nested 서브모듈까지 함께:

```bash
git clone --recurse-submodules git@github.com:anglican-kr/common-bible.git
# 또는
git submodule update --init --recursive
```

## git 서브모듈 운영

본 저장소는 두 단계 nested 서브모듈을 가진다 (앱 → data → audio). 일상 작업에서 자주 만나는 명령어 모음.

### data 변경 반영 (마크다운·파이프라인·빌드 산출물)

```bash
# 1. common-bible-data 저장소에서 작업 후 push
cd data
# ... 마크다운 수정 → 파이프라인 재실행 → 산출물 ...
git commit -am "data: ..."
git push

# 2. 앱 저장소에서 서브모듈 포인터 bump
cd ..
git submodule update --remote data
git commit -am "data: 서브모듈 포인터 bump"
git push
```

### audio 변경 반영 (이중 hop)

audio는 data 안의 nested 서브모듈이라 audio → data → 앱 두 단계로 포인터를 올려야 한다.

```bash
# 1. common-bible-audio에 새 mp3 push (LFS)
cd data/audio
# ... mp3 추가/교체 ...
git commit -am "..."
git push

# 2. data 저장소에서 audio 서브모듈 포인터 bump
cd ..
git submodule update --remote audio
git commit -am "chore: audio 서브모듈 포인터 bump"
git push

# 3. 앱 저장소에서 data 서브모듈 포인터 bump
cd ..
git submodule update --remote data
git commit -am "data: 서브모듈 포인터 bump (audio 갱신)"
git push
```

### 브랜치 switch 시 서브모듈 충돌 해소

분할(ADR-020) 이전 브랜치(`data/`가 일반 디렉토리에 트래킹 파일들)와 이후 브랜치(`data/`가 서브모듈) 사이에 switch 시 `untracked working tree files would be overwritten` 에러가 난다 — working tree의 같은 경로가 서브모듈 안 파일과 부모 트래킹 파일에 동시 매핑되기 때문.

```bash
# 권장: 옛 브랜치를 분할 후로 fast-forward (working tree 안 건드림)
git fetch origin
git update-ref refs/heads/<branch> origin/<branch>
git switch <branch>

# 대안: 서브모듈 통째 비우고 switch (audio 6.3 GB 재 pull 비용)
git submodule deinit -f data
rm -rf data
git switch <branch>
git submodule update --init --recursive
```

### 작업 디렉토리 구분

`cd data` 시 git 컨텍스트가 data 서브모듈로 바뀐다 — 앱 저장소 commit과 헷갈리지 않도록 작업 후 `git status`로 어느 저장소에서 작업 중인지 확인. 부모(앱 저장소)에서는 서브모듈 포인터(SHA) 외에 서브모듈 내부 파일을 직접 `git add`할 수 없다.

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript (프레임워크 없음)
- Data: JSON (장별 분리, OSIS 소문자 book_id) — data 서브모듈에서 제공
- Audio: mp3 (Git LFS) — audio nested 서브모듈에서 제공
- Offline: Service Worker

## 플랫폼별 동작 차이

앱 설치는 웹 표준이 플랫폼마다 다르게 구현되어 있어 코드 분기가 필요하다. 다른 모든 기능(읽기·검색·북마크·오디오·동기화)은 플랫폼 무관하게 동일한 코드 경로로 동작한다.

### 앱 설치 (홈 화면 추가)

| 플랫폼 | 설치 방식 | 비고 |
|--------|----------|------|
| Android Chrome / Edge / Samsung Internet | `beforeinstallprompt` 자동 캡처 → "설치" 버튼 → 네이티브 프롬프트 | 1-탭 설치 |
| Desktop Chrome / Edge | 동일 (`beforeinstallprompt`) | macOS Safari·Firefox는 미지원 |
| **iOS Safari** | 수동 3단계 안내 모달 (공유 → 홈 화면에 추가) | `beforeinstallprompt` 미지원 (WebKit 정책) |
| iOS Chrome / Firefox / Edge | "Safari에서 열어 설치" 안내 | iOS 모든 브라우저는 WebKit 래퍼지만 설치는 Safari만 가능 |

자세한 안내 화면 설계는 [ADR-008](docs/decisions/008-pwa-install-guide.md), iOS 디바이스별 스플래시(13종 `apple-touch-startup-image`)는 [ADR-007](docs/decisions/007-launch-screen-optimization.md) 참고.

### iOS 고유 제약

- **iOS Safari 탭 사용 시 7일 ITP**: 홈 화면에 설치하지 않고 Safari 탭에서 직접 여는 경우, 7일 미사용 시 ITP가 storage(쿠키 + localStorage + IndexedDB 포함)를 정리 → 모든 로컬 상태(북마크·설정·동기화 인증) 재구성 필요. **홈 화면 설치 PWA(iOS 17+ HSWA)는 storage가 영속되어 ITP 적용 대상 아님** — ADR-011 §맥락 참고.
- **iOS Chrome / Firefox / Edge (WebKit 래퍼)**: 설치 불가 + Drive 동기화 시 PWA-격리 컨텍스트 미보장. "Safari에서 열기" 안내로 끝.

## Google Drive 동기화 (북마크·설정·읽기 위치)

데스크탑·Android·iOS가 모두 동일하게 OAuth 2.0 Authorization Code + PKCE + refresh token 단일 경로 ([ADR-011 Phase 2h](docs/decisions/011-bookmark-sync.md), [`docs/archive/design/pkce-migration.md`](docs/archive/design/pkce-migration.md)). Phase 2h 이전에 있던 GIS Token Client / Implicit Flow / FedCM 분기는 모두 제거됨.

| 시나리오 | 동작 |
|---------|-----|
| 첫 연결 ("연결" 클릭) | `accounts.google.com`로 풀페이지 리디렉션 → consent → callback `?code=…` → same-origin `/oauth/token` POST → access + refresh token 수신 → IDLE |
| 앱 재실행 (refresh token 보유) | IndexedDB의 AES-GCM 암호화 refresh token으로 백그라운드 `/oauth/token` POST → access token 갱신 → IDLE. UI 변화 없음, 팝업·리디렉션·깜박임 없음. |
| 앱 재실행 (refresh token 없음) | NEEDS_CONSENT에 정착, 설정 화면에 "연결" 버튼 노출 |
| 탭 활성화 | visibilitychange로 `requestSync()` 한 번 — 다른 디바이스의 변경분을 새로고침 없이 자동 pull (IDLE 상태일 때만) |
| 401 (access token 만료) | refresh token으로 백그라운드 갱신 → 동기화 재개. refresh token도 invalid면 NEEDS_CONSENT로 폴백 |
| `signOut()` | Google `/revoke` 호출 + IDB clear + email/state localStorage 정리 |

**OAuth /token BFF**: `/oauth/token`은 nginx가 같은 origin에서 받은 요청에 `client_secret`을 server-side로 주입한 뒤 `oauth2.googleapis.com/token`으로 forward한다. Google "Web application" 클라이언트 타입의 RFC 7636 일탈(PKCE에서도 secret 강제) + GitHub secret scanner 자동 무효화 위험을 회피하기 위함이다 ([ADR-017](docs/decisions/017-oauth-bff-proxy.md), `common-bible-server/nginx/oauth-proxy.example.conf`).

운영 가드:
- **무한 리디렉션 cap**: localStorage 카운터(상한 3회) 초과 시 ERROR 강제 전이. SYNC_DONE으로만 리셋.
- **만성 401 cap (`MAX_REAUTH=3`)**: 새 access token도 Drive가 거절하면 4번째 401에서 ERROR + snackbar.
- **race 가드**: state-based + `localStorage["bible-drive-sync"]` flag-based + 매 async await 직후 재검사 — 사용자가 조용한 refresh / code 교환 진행 중 disconnect 시 의도 보존.

### 알려진 한계

- **OAuth 검수 진행 중 → refresh token 7일 만료**: Google OAuth 앱이 "Testing" 상태인 동안엔 refresh token TTL 7일. 검수 통과 후 영구 — 코드 변경 0.
- **외부 권한 회수**: 사용자가 Google 계정 설정에서 권한을 끊으면 다음 조용한 refresh가 `invalid_grant`로 실패 → IDB clear + NEEDS_CONSENT 폴백.

iOS Safari ITP로 인한 storage 정리는 동기화 외 다른 로컬 상태에도 영향을 주므로 [iOS 고유 제약](#ios-고유-제약) 절에 둠.

보안 모델 자세히: [`docs/archive/audit/2026-05-07-pkce-refresh-token.md`](docs/archive/audit/2026-05-07-pkce-refresh-token.md).

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
privacy.html            ← 개인정보처리방침
sw.js                   ← 서비스 워커 (오프라인, 루트 필수)
manifest.webmanifest    ← PWA 매니페스트
favicon.ico             ← 파비콘 (루트 필수)
robots.txt / sitemap.xml
version.json            ← 앱 버전 (release.py로 관리)
tsconfig.json           ← TypeScript 설정 (--noEmit, JSDoc 검사용)
tsconfig.worker.json    ← Web Worker 전용 tsconfig
js/
  app.js                ← 라우팅, 렌더링, 검색 UI, 오디오 플레이어
  drive-sync.js         ← Google Drive 동기화 모듈
  search-worker.js      ← Web Worker 기반 전역 검색 엔진
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
  types.d.ts            ← 동기화·검색 도메인 타입 단일 출처
  app/                  ← 9개 도메인 모듈 (ADR-018)
  sync/                 ← 동기화 상태 머신·전송·저장 (ADR-011)
                          state-machine·transport·store-v2·debug-log·refresh-store
css/
  style.css             ← 메인 스타일
assets/
  icons/
    icon-192.png · icon-512.png · icon-512-maskable.png
    skh-cross.svg       ← 성공회 십자가 SVG (스플래시 생성용 소스)
  install-guide/        ← iOS 설치 안내 스크린샷 (webp, 3단계)
  splash/               ← iOS apple-touch-startup-image (13 디바이스)
data/                   ← 서브모듈: common-bible-data
  source/               ← 73권 마크다운 원본
  src/                  ← parser·split_bible·search_indexer
  tests/                ← Level 1-3 데이터 검증 (ADR-004)
  bible/                ← 빌드 산출: 장별 JSON
  audio/                ← nested 서브모듈: common-bible-audio (mp3, LFS)
  books.json · book_mappings.json
  search-{meta,ot,nt,dc}.json
scripts/
  release.py            ← version.json + sw.js 캐시 식별자 bump (shell/data/audio 독립)
  serve.py              ← SPA-aware 로컬 개발 서버
  generate_splash.py    ← iOS 스플래시 PNG 생성 (cairosvg + Pillow)
tests/
  unit/                 ← 클라이언트 JS 유닛 테스트 (Node --test, ADR-013)
  e2e/                  ← 브라우저 E2E 테스트 (로컬 전용)
.github/
  workflows/
    test.yml            ← CI: JS 유닛 자동 실행
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR)
  status.md             ← 구현 현황 ("지금 무엇이 동작하는가")
  known-issues.md       ← 미해결 이슈·후속 백로그
  archive/              ← 완료·점-시점 기록 (design 설계 변천 · audit 보안 감사 · qa e2e 회귀 보고서)
  prd.md                ← 제품 요구사항 문서
  worklog.md            ← 작업 일지
```

배포 설정(nginx·deploy.sh)은 `common-bible-server` 저장소로 분리(ADR-020).

## 데이터 파이프라인 실행

`common-bible-data` 서브모듈 접근 권한이 있는 환경에서만 실행:

```bash
# 서브모듈 초기화 (최초 1회, recursive로 audio까지)
git submodule update --init --recursive

# data 디렉토리(서브모듈 루트)에서:
cd data
python src/parser.py source/ --save-json output/parsed_bible.json
python src/split_bible.py
python src/search_indexer.py
```

자세한 빌드·검증 절차는 `data/README.md` 참조.

## 테스트

```bash
# 클라이언트 JS 유닛 테스트 (Node 24+, CI 자동 실행)
node --test tests/unit/*.test.js

# 데이터 파이프라인 검증 (data 서브모듈 내부)
cd data && pytest tests/

# E2E 테스트 (로컬, SPA-aware 서버 실행 필요)
python3 scripts/serve.py 8080
pytest tests/e2e/ -v
```

## 정적 타입 검사 (선택)

`// @ts-check` + JSDoc 기반. 빌드 산출물 없음.

```bash
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.worker.json --noEmit
```

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## 문서

- [아키텍처 개요](docs/architecture.md) — 전체 구조 한눈에
- [아키텍처 결정 기록](docs/decisions/) — ADR-001~020
- [제품 요구사항](docs/prd.md)
- [작업 일지](docs/worklog.md)
