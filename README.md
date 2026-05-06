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

OAuth 흐름이 플랫폼별로 다르다. iOS Safari는 FedCM을 영구 미지원하고 PWA standalone 모드에서 사용자 제스처 안에서도 popup이 차단되어, GIS Token Client 우회가 필요하기 때문 ([ADR-011 Phase 2f](docs/decisions/011-bookmark-sync.md)).

| 플랫폼 | 첫 연결 흐름 | 앱 재실행 시 |
|--------|------------|-------------|
| Android Chrome | GIS Token Client popup + FedCM Identity Client → silent token | FedCM/세션 쿠키로 silent token 즉시 발급 |
| Desktop Chrome / Edge / Firefox (FedCM 지원) | 동일 | 동일 |
| Desktop Firefox (FedCM 미지원) | GIS popup consent → token | GIS Token Client로 silent token |
| **iOS 16 이하 Safari** | OAuth 2.0 Implicit Flow + 풀페이지 리디렉션 | Phase 2g — 저장된 email이 있으면 `prompt=none` 자동 silent 리디렉션 |
| **iOS 17/18 Safari (탭/PWA standalone)** | 동일 (풀페이지 리디렉션) | 동일 (PWA-격리 Google 세션 쿠키 사용) |
| iOS 26+ PWA standalone | 동일 | 동일 |

iOS 한정 추가 동작:
- **재인증(401) 휴리스틱**: 사용자가 활발히 읽는 중이면(`visibilityState="visible"` + `hasFocus()` + 5초 이내 인터랙션) 풀페이지 리디렉션을 보류하고 snackbar 안내, 유휴 상태면 자동 리디렉션 ([ADR-011 Phase 2f](docs/decisions/011-bookmark-sync.md)).
- **silent 자동 시도 차단**: `prompt=none`이 `interaction_required` 등으로 실패하면 `bible-drive-silent-blocked=1` 플래그 설정 → 다음 앱 오픈에 자동 재시도 안 함 (사용자 "연결" 클릭으로 해제).
- **무한 리디렉션 cap**: localStorage 카운터(상한 3회) 초과 시 ERROR 강제 전이.

### 알려진 한계

- **iOS Safari 7일 ITP**: PWA를 7일 이상 미사용 시 storage(쿠키 + localStorage 포함) 정리 → 동기화 재연결 필요.
- **iOS 모든 버전 Implicit Flow**: refresh token 미발급. 토큰은 1시간 만료 + 메모리 전용 → 매 cold start에 silent 재인증 round-trip 발생 (브리프 깜박임 < 1초).
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
  release.py            ← version.json + sw.js CACHE_NAME 동시 bump
  serve.py              ← SPA-aware 로컬 개발 서버
tests/
  test_completeness.py  ← Level 1 완전성 검증
  test_ordering.py      ← Level 2 절 순서 검증
  test_snapshots.py     ← Level 3 특수 케이스 스냅샷
  fixtures/
    verse_sequence.json ← 1328장 절 순서 스냅샷
  generate_fixtures.py  ← 픽스처 재생성 스크립트 (로컬 전용)
  unit/                 ← 클라이언트 JS 유닛 테스트 (Node --test)
  e2e/                  ← 브라우저 E2E 테스트 (로컬 전용)
.github/
  workflows/
    test.yml            ← CI: 유닛 테스트 자동 실행
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR-001~011)
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
# 클라이언트 JS 유닛 테스트 (Node 22+ 내장, CI 자동 실행)
node --test tests/unit/state-machine.test.js

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

- [아키텍처 결정 기록](docs/decisions/) — ADR-001~013
- [제품 요구사항](docs/prd.md)
- [작업 일지](docs/worklog.md)
