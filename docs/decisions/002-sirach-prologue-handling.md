# ADR-002: 집회서 머리말 처리 방식

- 일시: 2026-03-26
- 상태: 승인됨

## 결정

집회서 머리말을 별도 파일 `data/bible/sir-prologue.json`으로 분리한다. `data/books.json`의 집회서 항목에 `has_prologue: true` 플래그를 추가한다. 머리말은 장/절 검색에서 제외하되, 본문 검색에는 포함한다.

## 맥락

집회서(Sirach)는 성경 본문 외에 번역자의 서문(머리말)을 포함한다. 원본 텍스트의 형식:

```
집회 머리말  율법서와 예언서와... ◎ 내가 유에르게테스 왕...
집회 1:1  모든 지혜는 주님께로부터...
```

머리말은 절 번호가 없는 산문이며, `◎`로 구분되는 두 단락으로 구성된다. 현재 `parser.py`의 regex 패턴(`책이름 장:절`)은 이 형식을 인식하지 못해 `parsed_bible.json`에서 누락된 상태다.

## 검토한 대안

### A. 0장으로 처리 (`sir-0.json`)

- 장점: 라우팅 일관성 유지
- 단점: "0장"은 성경 개념에 없어 어색함

### B. 별도 파일 `sir-prologue.json` (채택)

- 장점: 의미상 정확, 장별 구조에 영향 없음, 필요 시에만 로드
- 단점: 프론트엔드에서 `has_prologue` 플래그를 보고 별도 처리 필요

### C. 1장 JSON에 `prologue` 필드 추가

- 장점: 파일 수 증가 없음
- 단점: 1장 본문과 머리말의 개념 혼재

### D. `books.json`에 머리말 텍스트 직접 포함

- 장점: 별도 fetch 불필요
- 단점: 목차 로드 시 불필요한 텍스트(\~2KB)를 항상 다운로드, books.json에 이질적인 콘텐츠 혼재

### E. 생략

- 단점: 전례·전문 독자를 위한 콘텐츠 손실

## 채택 이유

- 머리말은 번역자 서문으로, 성경 본문(장/절)과 성격이 다름
- 장별 JSON 구조를 그대로 유지하면서 특수 케이스를 격리할 수 있음
- `books.json`의 `has_prologue` 플래그로 프론트엔드가 선택적으로 처리 가능
- 집회서 목차를 열 때만 로드되므로 불필요한 다운로드 없음

## 결과

### 파일 구조

```
data/
  books.json                  ← 집회서 항목에 has_prologue: true 추가
  bible/
    sir-prologue.json         ← 머리말 전용 파일 (신규)
    sir-1.json ~ sir-51.json  ← 기존과 동일
```

### sir-prologue.json 스키마

```json
{
  "book_id": "sir",
  "book_name_ko": "집회서",
  "book_name_en": "Sirach",
  "type": "prologue",
  "paragraphs": [
    "율법서와 예언서와...",
    "내가 유에르게테스 왕..."
  ]
}
```

단락 구분: 원본의 `◎` 기호를 기준으로 분리.

### books.json 집회서 항목

```json
{
  "id": "sir",
  "name_ko": "집회서",
  "name_en": "Sirach",
  "division": "deuterocanon",
  "chapter_count": 51,
  "has_prologue": true
}
```

### 검색 동작

머리말(`sir-prologue.json`)은 검색 범위에서 제외한다. 성경 본문 검색은 `sir-1.json` \~ `sir-51.json`만 대상으로 한다.