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
  books.json            ← 73권 목록 (메타데이터)
  bible/
    {book_id}-{chapter}.json  ← 장별 성경 데이터
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
```

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
