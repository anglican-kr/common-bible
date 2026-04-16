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
  → (search_indexer.py) → data/search-index.json
```

## 기술 스택

- Frontend: HTML, CSS, Vanilla JavaScript (프레임워크 없음)
- Data: JSON (장별 분리, OSIS 소문자 book_id)
- Offline: Service Worker
- Data preprocessing: Python (일회성 스크립트)

## 프로젝트 구조

```
index.html              ← SPA 진입점
app.js                  ← 라우팅, 렌더링
style.css               ← 스타일
sw.js                   ← 서비스 워커 (오프라인)
manifest.webmanifest    ← PWA 매니페스트
data/
  source/               ← 비공개 서브모듈 (73권 마크다운 원본)
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  bible/                ← 장별 성경 JSON (gitignore, 파서 출력물)
  audio/
    {book_slug}-{chapter}.mp3
src/
  parser.py             ← .md 소스 → parsed_bible.json (segments 기반)
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리
  search_indexer.py     ← 검색 인덱스 생성
  config.py             ← 설정 관리
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR)
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

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## 문서

- [아키텍처 결정 기록](docs/decisions/) — ADR-001~006
- [작업 일지](docs/worklog.md)
