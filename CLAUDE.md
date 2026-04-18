# 공동번역성서 PWA

## 프로젝트 개요

대한성공회를 위한 공동번역성서 PWA.
장기적으로 성공회 교회력, 성무일과, 기도서까지 통합하는 전례 앱으로 확장 예정.

## 아키텍처 결정

- **SPA 방식** (프론트엔드 중심) — ADR: `docs/decisions/001-spa-architecture.md`
- Python은 데이터 전처리(JSON 분리)에만 사용
- 프레임워크 없이 Vanilla JS
- 브라우저가 JSON을 직접 읽어 렌더링

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript
- Data: JSON (장별 분리)
- Offline: Service Worker
- Data preprocessing: Python (일회성 스크립트)

## 프로젝트 구조

```
index.html              ← SPA 진입점 (단일 HTML)
sw.js                   ← 서비스 워커 (오프라인, 루트 필수)
manifest.webmanifest    ← PWA 매니페스트
favicon.ico             ← 파비콘 (루트 필수)
robots.txt / sitemap.xml
version.json            ← 앱 버전 (release.py로 관리)
requirements.txt        ← Python 의존성
js/
  app.js                ← 라우팅, 렌더링, 검색 UI, 오디오 플레이어
  search-worker.js      ← Web Worker 기반 전역 검색 엔진 (ADR-005)
  pre-fetch.js          ← books.json 선패치 (초기 로딩 성능)
  gtag-init.js          ← Google Analytics 초기화
css/
  style.css             ← 메인 스타일
assets/
  icons/
    icon-192.png        ← PWA 홈 화면 아이콘
    icon-512.png        ← PWA 홈 화면 아이콘 (고해상도)
    icon-512-maskable.png ← PWA maskable 아이콘
    skh-cross.svg       ← 성공회 십자가 SVG (스플래시 생성용 소스)
  install-guide/
    ios-iphone-share.svg ← iOS iPhone 설치 안내 이미지 (ADR-008)
    ios-ipad-share.svg   ← iOS iPad 설치 안내 이미지 (ADR-008)
  splash/
    dark-{device}.png   ← iOS apple-touch-startup-image (13 디바이스, ADR-007)
data/
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  book_mappings.json    ← 책 ID·이름·별칭·구분 매핑
  search-meta.json      ← 검색용 별칭·책 메타데이터 (~9 KB)
  search-ot.json        ← 구약 절 검색 인덱스 (~3.8 MB)
  search-nt.json        ← 신약 절 검색 인덱스 (~1.3 MB)
  search-dc.json        ← 외경 절 검색 인덱스 (~700 KB)
  bible/
    {book_id}-{chapter}.json  ← 장별 성경 데이터
    sir-prologue.json   ← 집회서 머리말 (ADR-002)
  audio/
    {book_slug}-{chapter}.mp3 ← 장별 오디오
  source/
    {book_id}.md        ← 73권 마크다운 소스 (서브모듈)
src/
  parser.py             ← .md 소스 → parsed_bible.json (segments 기반)
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리 스크립트
  search_indexer.py     ← 장별 JSON → data/search-{meta,ot,nt,dc}.json
  generate_splash.py    ← iOS 스플래시 PNG 생성 (cairosvg + Pillow, ADR-007)
  convert_txt_to_md.py  ← .txt → .md 일괄 변환 (일회성, 완료됨)
scripts/
  build-deploy.sh       ← 배포 zip 생성
  release.py            ← version.json + sw.js CACHE_NAME 동시 bump
tests/
  test_completeness.py  ← Level 1 완전성 검증 (ADR-004)
  test_ordering.py      ← Level 2 절 순서 검증 (ADR-004)
  test_snapshots.py     ← Level 3 특수 케이스 스냅샷 (ADR-004)
  fixtures/
    verse_sequence.json ← 1328장 절 순서 스냅샷 (generate_fixtures.py로 생성)
  generate_fixtures.py  ← 픽스처 재생성 스크립트 (로컬 전용, 원본 텍스트 필요)
  e2e/
    test_search.py      ← 검색 파이프라인 + 새로고침 회귀
    test_navigation.py  ← URL 라우팅 8케이스
    test_copy.py        ← 클립보드 복사 경계 확장
    test_install_guide.py ← 플랫폼별 설치 안내 모달
    test_features.py    ← 이어읽기 배너, 모바일 FAB
.github/
  workflows/
    test.yml            ← CI: Level 1-3 자동 실행
docs/
  decisions/            ← ADR (아키텍처 결정 기록, ADR-001~008)
  prd.md                ← 제품 요구사항 문서
  worklog.md            ← 작업 일지
```

## 데이터 파이프라인

```
data/source/*.md  (73권 마크다운 소스)
  → (parser.py) → output/parsed_bible.json
  → (split_bible.py) → data/bible/{book_id}-{chapter}.json
                      → data/bible/sir-prologue.json (집회서 머리말, 원본 텍스트에서 직접 추출)
                      → data/books.json
  → (search_indexer.py) → data/search-meta.json (별칭·책 메타데이터)
                         → data/search-ot.json   (구약)
                         → data/search-nt.json   (신약)
                         → data/search-dc.json   (외경)
```

### 전체 재생성 (소스 변경 시)

```bash
# 프로젝트 루트에서 실행
python src/parser.py data/source/ --save-json output/parsed_bible.json
python src/split_bible.py
python src/search_indexer.py
```

### 특정 책만 교체 (부분 작업 시)

```python
from src.parser import BibleParser
from dataclasses import asdict
import json

parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_md_file('data/source/ps.md')

for ch in chapters:
    data = asdict(ch)
    del data['book_abbr'], data['division_ko'], data['division_en']
    data['chapter'] = data.pop('chapter_number')
    with open(f'data/bible/{ch.book_id}-{ch.chapter_number}.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
```

### split_bible.py 출력 상세

| 출력 파일 | 설명 |
|-----------|------|
| `data/bible/{book_id}-{chapter}.json` | 장별 성경 데이터. `null` 필드 생략, `stanza_break`는 `true`일 때만 포함 |
| `data/bible/sir-prologue.json` | 집회서 머리말. 원본 텍스트에서 직접 추출 (ADR-002) |
| `data/books.json` | 73권 메타데이터. 책 순서, 장 수, `has_prologue` 플래그 포함 |

## 테스트

### 데이터 파이프라인 테스트 (Level 1-3)

원본 텍스트 없이 실행 가능. CI에서 자동 실행됨.

```bash
# 전체 실행
pytest tests/test_completeness.py tests/test_ordering.py tests/test_snapshots.py -v

# Level별 개별 실행
pytest tests/test_completeness.py   # Level 1: 파일 수, 구조 완전성
pytest tests/test_ordering.py       # Level 2: 1328장 절 순서 = 픽스처 일치
pytest tests/test_snapshots.py      # Level 3: cross-chapter·재배치 고정값
```

### 픽스처 갱신 (parser.py 또는 split_bible.py 변경 시)

```bash
python tests/generate_fixtures.py   # data/bible/ 읽어 verse_sequence.json 재생성
# 결과 파일을 커밋에 포함
```

### E2E 테스트 (브라우저, 로컬 전용)

```bash
# 1. 의존성 설치 (최초 1회)
pip install pytest-playwright
playwright install chromium

# 2. 개발 서버 실행 (별도 터미널)
python3 -m http.server 8080

# 3. 테스트 실행
pytest tests/e2e/ -v
```

e2e 테스트는 서버가 `http://localhost:8080`에 실행 중이어야 합니다.
CI에서는 실행하지 않으며 로컬에서 기능 개발 후 수동으로 확인합니다.

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## 컨벤션

- 문서: 한국어 기본
- 코드 주석: 영어
- 접근성: WCAG 2.1 AA 준수

## 커밋 메시지 규칙

타입은 영어, 내용은 한국어. 예: `feat: 장 내비게이션 드롭다운 구현`

| 타입       | 언제                               |
| ---------- | ---------------------------------- |
| `feat`     | 새 기능 추가                       |
| `fix`      | 버그 수정                          |
| `docs`     | 문서만 변경 (PRD, worklog, ADR 등) |
| `chore`    | 빌드, 설정, 파일 정리 등           |
| `data`     | 성경 데이터, JSON 파일 관련 변경   |
| `style`    | CSS, UI 스타일만 변경              |
| `refactor` | 기능 변경 없이 코드 구조 개선      |

## 현재 상태

- Phase 1 완료: 성경 읽기 PWA (73권, 오프라인, 검색, 오디오, 접근성)
- 진행 중: 운문 본문 재구성 (data/source/*.md 편집 후 파이프라인 재실행)
- 완료: 테스트 체계 (ADR-004 Level 1-3 + e2e)
