# 공동번역성서 PWA

## 프로젝트 개요

대한성공회 서울교구를 위한 공동번역성서 PWA.
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
app.js                  ← 라우팅, 렌더링
style.css               ← 스타일
sw.js                   ← 서비스 워커 (오프라인)
manifest.webmanifest    ← PWA 매니페스트
data/
  books.json            ← 73권 목록 (메타데이터, has_prologue 플래그 포함)
  bible/
    {book_id}-{chapter}.json  ← 장별 성경 데이터
    sir-prologue.json   ← 집회서 머리말 (ADR-002)
  audio/
    {book_slug}-{chapter}.mp3 ← 장별 오디오
src/
  split_bible.py        ← parsed_bible.json → 장별 JSON 분리 스크립트
  parser.py             ← 원본 텍스트 → parsed_bible.json (완성됨)
  config.py             ← 설정 관리 (완성됨)
docs/
  decisions/            ← ADR (아키텍처 결정 기록)
  worklog.md            ← 작업 일지
```

## 데이터 파이프라인

```
data/common-bible-kr.txt
  → (parser.py) → output/parsed_bible.json
  → (split_bible.py) → data/bible/{book_id}-{chapter}.json
                      → data/bible/sir-prologue.json (집회서 머리말, 원본 텍스트에서 직접 추출)
                      → data/books.json
```

### 전체 재생성 (원본 텍스트 변경 시)

```bash
# 프로젝트 루트에서 실행
python src/parser.py data/common-bible-kr.txt --save-json output/parsed_bible.json
python src/split_bible.py
```

### 특정 책만 교체 (부분 작업 시)

`split_bible.py`를 거치지 않고 파서로 직접 해당 책의 장별 JSON을 덮어쓴다.

```python
from src.parser import BibleParser
import json, os

parser = BibleParser('data/book_mappings.json')
chapters = parser.parse_file('data/common-bible-psalm.txt')  # 작업 파일

for ch in chapters:
    verses = []
    for v in ch.verses:
        verse = {'number': v.number, 'text': v.text, 'has_paragraph': v.has_paragraph}
        if v.stanza_break:
            verse['stanza_break'] = True
        for field, val in [('chapter_ref', v.chapter_ref), ('range_end', v.range_end),
                           ('part', v.part), ('alt_ref', v.alt_ref)]:
            if val is not None:
                verse[field] = val
        verses.append(verse)
    data = {'book_id': ch.book_id, 'book_name_ko': ch.book_name_ko,
            'book_name_en': ch.book_name_en, 'chapter': ch.chapter_number, 'verses': verses}
    with open(f'data/bible/{ch.book_id}-{ch.chapter_number}.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)
```

### split_bible.py 출력 상세

| 출력 파일 | 설명 |
|-----------|------|
| `data/bible/{book_id}-{chapter}.json` | 장별 성경 데이터. `null` 필드 생략, `stanza_break`는 `true`일 때만 포함 |
| `data/bible/sir-prologue.json` | 집회서 머리말. 원본 텍스트에서 직접 추출 (ADR-002) |
| `data/books.json` | 73권 메타데이터. 책 순서, 장 수, `has_prologue` 플래그 포함 |

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

- Phase 1 시작 단계
- 프로젝트 문서화 구조 수립 완료
- 다음 작업: parsed_bible.json → 장별 JSON 분리, SPA 뼈대 구현
