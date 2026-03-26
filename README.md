# 공동번역성서 PWA

대한성공회 서울교구를 위한 공동번역성서 프로그레시브 웹 앱(PWA).
장기적으로 기도서, 교회력, 성무일과까지 통합하는 전례 앱으로 확장 예정.

배포 URL: https://bible.anglican.kr

> 실제 공동번역성서 개정판의 저작권은 대한성서공회에 있으며, 이 프로젝트는 비상업적 용도로만 사용됩니다. 공동번역성서 원본 텍스트를 요구하지 말아주세요.

## 아키텍처

Python 스크립트로 원본 텍스트를 JSON으로 전처리하고, 브라우저가 JSON을 직접 읽어 렌더링하는 SPA 방식.

```
data/common-bible-kr.txt
  → (parser.py) → output/parsed_bible.json
  → (split_bible.py) → data/bible/{book_id}-{chapter}.json (1328개)
                      → data/bible/sir-prologue.json
                      → data/books.json
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
  books.json            ← 73권 목록 (메타데이터)
  bible/
    {book_id}-{chapter}.json  ← 장별 성경 데이터 (1328개)
    sir-prologue.json   ← 집회서 머리말
  audio/
    {book_slug}-{chapter}.mp3
src/
  parser.py             ← 원본 텍스트 → parsed_bible.json
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리
  config.py             ← 설정 관리
docs/
  decisions/            ← 아키텍처 결정 기록 (ADR)
  worklog.md            ← 작업 일지
```

## 데이터 구조

### 장별 JSON (`data/bible/{book_id}-{chapter}.json`)

```json
{
  "book_id": "gen",
  "book_name_ko": "창세기",
  "book_name_en": "Genesis",
  "chapter": 1,
  "verses": [
    { "number": 1, "text": "¶ 한처음에 하느님께서 하늘과 땅을 지어내셨다.", "has_paragraph": true },
    { "number": 2, "text": "땅은 아직 모양을 갖추지 않고...", "has_paragraph": false }
  ]
}
```

절 번호 재배치(학자 사본 반영)가 있는 경우 `chapter_ref` 필드로 원래 장 번호를 표기합니다 (ADR-003).

### books.json

```json
[
  { "id": "gen", "name_ko": "창세기", "name_en": "Genesis",
    "division": "old_testament", "chapter_count": 50, "has_prologue": false }
]
```

## 데이터 파이프라인 실행

원본 텍스트(`data/common-bible-kr.txt`)가 있는 로컬 환경에서만 실행:

```bash
# 1. 원본 텍스트 파싱
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json

# 2. 장별 JSON 분리
python src/split_bible.py
```

## 장기 로드맵

1. Phase 1: 성경 읽기 PWA (현재)
2. Phase 2: 기도서 콘텐츠 추가
3. Phase 3: 교회력 계산기
4. Phase 4: 성무일과 자동 생성

## 문서

- [아키텍처 결정 기록](docs/decisions/) — ADR-001~004
- [작업 일지](docs/worklog.md)
