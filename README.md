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

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
sw.js                   ← 서비스 워커 (오프라인)
manifest.webmanifest    ← PWA 매니페스트
version.json            ← 앱 버전
js/
  app.js                ← 라우팅, 렌더링, 검색 UI, 오디오 플레이어
  search-worker.js      ← Web Worker 기반 전역 검색 엔진
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
css/
  style.css             ← 메인 스타일
assets/
  icons/                ← PWA 아이콘 (192·512·maskable)
  install-guide/        ← iOS 설치 안내 SVG 이미지
  splash/               ← iOS 런치 스크린 (13 디바이스)
data/
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  book_mappings.json    ← 책 ID·이름·별칭·구분 매핑
  search-meta.json      ← 검색용 별칭·책 메타데이터
  search-ot.json        ← 구약 절 검색 인덱스
  search-nt.json        ← 신약 절 검색 인덱스
  search-dc.json        ← 외경 절 검색 인덱스
  bible/                ← 장별 성경 JSON (gitignore, 파서 출력물)
  audio/
    {book_slug}-{chapter}.mp3
  source/               ← 비공개 서브모듈 (73권 마크다운 원본)
src/
  parser.py             ← .md 소스 → parsed_bible.json (segments 기반)
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리
  search_indexer.py     ← 검색 인덱스 생성 (구약/신약/외경 분리)
  generate_splash.py    ← iOS 스플래시 PNG 생성
scripts/
  build-deploy.sh       ← 배포 zip 생성
  release.py            ← version.json + sw.js CACHE_NAME 동시 bump
tests/
  test_completeness.py  ← Level 1 완전성 검증
  test_ordering.py      ← Level 2 절 순서 검증
  test_snapshots.py     ← Level 3 특수 케이스 스냅샷
  e2e/                  ← 브라우저 E2E 테스트 (로컬 전용)
.github/
  workflows/
    test.yml            ← CI: Level 1-3 자동 실행
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR-001~008)
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
# 데이터 파이프라인 검증 (원본 텍스트 불필요, CI 자동 실행)
pytest tests/test_completeness.py tests/test_ordering.py tests/test_snapshots.py -v

# E2E 테스트 (로컬, 서버 실행 필요)
python3 -m http.server 8080
pytest tests/e2e/ -v
```

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## 문서

- [아키텍처 결정 기록](docs/decisions/) — ADR-001~008
- [제품 요구사항](docs/prd.md)
- [작업 일지](docs/worklog.md)
