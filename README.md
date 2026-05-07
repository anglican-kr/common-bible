# 공동번역성서 PWA

대한성공회를 위한 공동번역성서 프로그레시브 웹 앱(PWA).
장기적으로 기도서, 교회력, 성무일과까지 통합하는 전례 앱으로 확장 예정.

배포 URL: https://bible.anglican.kr

> 실제 공동번역성서 개정판의 저작권은 대한성서공회에 있으며, 이 프로젝트는 비상업적 용도로만 사용됩니다. 성경 원본 텍스트는 비공개 서브모듈로 관리되며, 접근 권한이 있는 사용자만 이용할 수 있습니다.

## 아키텍처

Python 스크립트로 마크다운 소스를 JSON으로 전처리하고, 브라우저가 JSON을 직접 읽어 렌더링하는 SPA 방식.

```
data/source/*.md  (비공개 서브모듈, 73권 마크다운 소스)
  → (parser.py) → output/parsed_bible.json
  → (split_bible.py) → data/bible/{book_id}-{chapter}.json (1328개)
                      → data/bible/sir-prologue.json
                      → data/books.json
  → (search_indexer.py) → data/search-meta.json (별칭·책 메타데이터)
                         → data/search-ot.json   (구약)
                         → data/search-nt.json   (신약)
                         → data/search-dc.json   (외경)
```

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript (프레임워크 없음)
- Data: JSON (장별 분리, OSIS 소문자 book_id)
- Offline: Service Worker
- Data preprocessing: Python (일회성 스크립트)

## 플랫폼별 동작 차이

웹 표준이 플랫폼마다 다르게 구현되어 있어 두 가지 영역에서 코드 분기가 발생한다 — 앱 설치, Google Drive 동기화. 다른 모든 기능(읽기·검색·북마크·오디오)은 플랫폼 무관하게 동일하게 동작한다.

### 앱 설치 (홈 화면 추가)

| 플랫폼 | 설치 방식 | 비고 |
|--------|----------|------|
| Android Chrome / Edge / Samsung Internet | `beforeinstallprompt` 자동 캡처 → "설치" 버튼 → 네이티브 프롬프트 | 1-탭 설치 |
| Desktop Chrome / Edge | 동일 (`beforeinstallprompt`) | macOS Safari·Firefox는 미지원 |
| **iOS Safari** | 수동 3단계 안내 모달 (공유 → 홈 화면에 추가) | `beforeinstallprompt` 미지원 (WebKit 정책) |
| iOS Chrome / Firefox / Edge | "Safari에서 열어 설치" 안내 | iOS 모든 브라우저는 WebKit 래퍼지만 설치는 Safari만 가능 |

자세한 안내 화면 설계는 [ADR-008](docs/decisions/008-pwa-install-guide.md), iOS 디바이스별 스플래시(13종 `apple-touch-startup-image`)는 [ADR-007](docs/decisions/007-launch-screen-optimization.md) 참고.

### Google Drive 동기화 (북마크·설정·읽기 위치)

데스크탑·Android·iOS가 동일하게 OAuth 2.0 Authorization Code + PKCE + refresh token 단일 경로 ([ADR-011 Phase 2h](docs/decisions/011-bookmark-sync.md), [`docs/design/pkce-migration.md`](docs/design/pkce-migration.md)).

| 시나리오 | 동작 |
|---------|-----|
| 첫 연결 ("연결" 클릭) | `accounts.google.com`로 풀페이지 리디렉션 → consent → callback `?code=…` → `/token` POST → access + refresh token 수신 → IDLE |
| 앱 재실행 (refresh token 보유) | IndexedDB의 AES-GCM 암호화 refresh token으로 백그라운드 `/token` POST → access token 갱신 → IDLE. UI 변화 없음, 팝업·리디렉션·깜박임 없음. |
| 앱 재실행 (refresh token 없음) | NEEDS_CONSENT에 정착, 설정 화면에 "연결" 버튼 노출 |
| 401 (access token 만료) | refresh token으로 백그라운드 갱신 → 동기화 재개. refresh token도 invalid면 NEEDS_CONSENT로 폴백 |
| `signOut()` | Google `/revoke` 호출 + IDB clear + email/state localStorage 정리 |

운영 가드:
- **무한 리디렉션 cap**: localStorage 카운터(상한 3회) 초과 시 ERROR 강제 전이. SYNC_DONE으로만 리셋.
- **만성 401 cap (`MAX_REAUTH=3`)**: 새 access token도 Drive가 거절하면 4번째 401에서 ERROR + snackbar.
- **race 가드**: state-based + `localStorage["bible-drive-sync"]` flag-based + 매 async await 직후 재검사 — 사용자가 silent refresh / code 교환 진행 중 disconnect 시 의도 보존.

보안 모델 자세히: [`docs/audit/2026-05-07-pkce-refresh-token.md`](docs/audit/2026-05-07-pkce-refresh-token.md).

### 알려진 한계

- **iOS Safari 탭 사용 시 7일 ITP**: 홈 화면에 설치하지 않고 Safari 탭에서 직접 여는 경우, 7일 미사용 시 ITP가 storage(쿠키 + localStorage + IndexedDB 포함)를 정리 → 동기화 재연결 필요. **홈 화면 설치 PWA(iOS 17+ HSWA)는 storage가 영속되어 ITP 적용 대상 아님** — ADR-011 §맥락 참고.
- **OAuth 검수 진행 중 → refresh token 7일 만료**: Google OAuth 앱이 "Testing" 상태인 동안엔 refresh token TTL 7일. 검수 통과 후 영구 — 코드 변경 0.
- **외부 권한 회수**: 사용자가 Google 계정 설정에서 권한을 끊으면 다음 silent refresh가 `invalid_grant`로 실패 → IDB clear + NEEDS_CONSENT 폴백.
- **iOS Chrome/Firefox 등 WebKit 래퍼 브라우저**: 설치 불가 + Drive 동기화 시 PWA-격리 컨텍스트 미보장.

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
privacy.html            ← 개인정보처리방침
sw.js                   ← 서비스 워커 (오프라인, 루트 필수)
manifest.webmanifest    ← PWA 매니페스트
favicon.ico             ← 파비콘 (루트 필수)
robots.txt / sitemap.xml
version.json            ← 앱 버전 (release.py로 관리)
requirements.txt        ← Python 의존성
tsconfig.json           ← TypeScript 설정 (--noEmit, JSDoc 검사용)
tsconfig.worker.json    ← Web Worker 전용 tsconfig
js/
  app.js                ← 라우팅, 렌더링, 검색 UI, 오디오 플레이어
  drive-sync.js         ← Google Drive 동기화 모듈
  search-worker.js      ← Web Worker 기반 전역 검색 엔진
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
  types.d.ts            ← 동기화·검색 도메인 타입 단일 출처
  sync/                 ← 동기화 상태 머신·전송·저장 (ADR-011)
                          state-machine·transport·store-v2·debug-log·refresh-store(Phase 2h)
css/
  style.css             ← 메인 스타일
assets/
  icons/
    icon-192.png        ← PWA 홈 화면 아이콘
    icon-512.png        ← PWA 홈 화면 아이콘 (고해상도)
    icon-512-maskable.png ← PWA maskable 아이콘
    skh-cross.svg       ← 성공회 십자가 SVG (스플래시 생성용 소스)
  install-guide/        ← iOS 설치 안내 스크린샷 (webp, 3단계)
  splash/               ← iOS apple-touch-startup-image (13 디바이스)
data/
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  book_mappings.json    ← 책 ID·이름·별칭·구분 매핑
  search-meta.json      ← 검색용 별칭·책 메타데이터 (~9 KB)
  search-ot.json        ← 구약 절 검색 인덱스 (~3.8 MB)
  search-nt.json        ← 신약 절 검색 인덱스 (~1.3 MB)
  search-dc.json        ← 외경 절 검색 인덱스 (~700 KB)
  bible/                ← 장별 성경 JSON (gitignore, 파서 출력물)
  audio/
    {book_slug}-{chapter}.mp3
  source/               ← 비공개 서브모듈 (73권 마크다운 원본)
src/
  parser.py             ← .md 소스 → parsed_bible.json (segments 기반)
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리
  search_indexer.py     ← 검색 인덱스 생성 (구약/신약/외경 분리)
  generate_splash.py    ← iOS 스플래시 PNG 생성 (cairosvg + Pillow)
scripts/
  build-deploy.sh       ← 배포 zip 생성
  release.py            ← version.json + sw.js 캐시 식별자 bump (shell/data/audio 독립)
  serve.py              ← SPA-aware 로컬 개발 서버
tests/
  test_completeness.py  ← Level 1 완전성 검증
  test_ordering.py      ← Level 2 절 순서 검증
  test_snapshots.py     ← Level 3 특수 케이스 스냅샷
  fixtures/
    verse_sequence.json ← 1328장 절 순서 스냅샷
  generate_fixtures.py  ← 픽스처 재생성 스크립트 (로컬 전용)
  unit/                 ← 클라이언트 JS 유닛 테스트 (Node --test, ADR-013)
                          state-machine·refresh-store·transport-pkce
  e2e/                  ← 브라우저 E2E 테스트 (로컬 전용)
.github/
  workflows/
    test.yml            ← CI: 유닛 테스트 자동 실행
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR-001~013)
  design/               ← 살아있는 설계 문서 (pkce-migration 등)
  audit/                ← 보안 감사 보고서
  qa/                   ← e2e 회귀 테스트 결과 보고서
  prd.md                ← 제품 요구사항 문서
  worklog.md            ← 작업 일지
```

## 데이터 파이프라인 실행

`data/source/` 서브모듈 접근 권한이 있는 환경에서만 실행:

```bash
# 서브모듈 초기화 (최초 1회)
git submodule update --init

# 1. 마크다운 소스 파싱
python src/parser.py data/source/ --save-json output/parsed_bible.json

# 2. 장별 JSON 분리
python src/split_bible.py

# 3. 검색 인덱스 생성
python src/search_indexer.py
```

## 테스트

```bash
# 클라이언트 JS 유닛 테스트 (Node 24+, CI 자동 실행)
node --test tests/unit/*.test.js

# 데이터 파이프라인 검증 (원본 텍스트 불필요)
pytest tests/test_completeness.py tests/test_ordering.py tests/test_snapshots.py -v

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
- [아키텍처 결정 기록](docs/decisions/) — ADR-001~013
- [제품 요구사항](docs/prd.md)
- [작업 일지](docs/worklog.md)
