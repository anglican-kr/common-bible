# ADR-004: 데이터 파이프라인 테스트 전략

- 일시: 2026-03-26
- 상태: 승인됨

## 결정

원본 성경 텍스트 없이도 CI에서 데이터 파이프라인을 검증할 수 있도록,
원본에서 저작권과 무관한 구조적 메타데이터만 추출한 픽스처 파일을 저장소에 커밋한다.
테스트는 3단계로 구성하며, 모든 단계를 CI에서 실행할 수 있도록 한다.

## 맥락

공동번역성서 원본 텍스트(`data/common-bible-kr.txt`)는 저작권 합의에 따라 저장소에 포함할 수 없다.
그러나 오늘 작성한 `parser.py`와 `split_bible.py`는 원본 텍스트를 입력으로 받아
절의 물리적 순서를 JSON으로 변환하는 파이프라인이고(ADR-003),
이 순서가 보존되었는지 자동으로 검증할 수단이 없는 상태다.

parser.py나 split_bible.py를 수정했을 때 절 순서가 깨지더라도
현재는 육안 확인 외에 감지 방법이 없다.

## 제약

- 원본 텍스트: 저장소에 포함 불가 (저작권)
- 픽스처 파일: 절 번호 시퀀스만 포함 (본문 없음) → 저작권 무관, 커밋 가능
- CI 환경: 원본 텍스트 없이 실행

## 테스트 구성

### Level 1 — 완전성 (Completeness)

원본 없이 실행 가능. `data/` 디렉터리와 `books.json`만으로 검증.

| 항목 | 기준 |
|------|------|
| 책 수 | `books.json`에 73권 존재 |
| 장 파일 수 | `data/bible/`에 1328개 + `sir-prologue.json` |
| books.json 정합성 | `chapter_count`가 실제 파일 수와 일치 |
| has_prologue 플래그 | 집회서(sir)만 `true` |
| sir-prologue.json | 존재, `paragraphs` 2개, `type == "prologue"` |
| OSIS book_id | 73권 모두 OSIS 소문자 기준과 일치 |

### Level 2 — 순서 보존 (Ordering)

픽스처 파일(`tests/fixtures/verse_sequence.json`)을 사용. CI에서 실행 가능.

픽스처 형식:
```json
{
  "gen-1": [1, 2, 3, ...],
  "amos-5": [1, 2, 3, 4, 5, 6, 9, 8, 7, 10, 11, ...],
  "isa-40": [1, 2, ..., 19, {"n": 6, "chapter_ref": 41}, 7, 20, ...]
}
```

검증 내용:
- 각 장 JSON의 절 번호 시퀀스가 픽스처와 완전히 일치

픽스처 생성은 원본 텍스트가 있는 로컬 환경에서만 실행:
```
python tests/generate_fixtures.py
```

### Level 3 — 특수 케이스 스냅샷 (Snapshot)

원본 없이 실행 가능. 알려진 케이스를 고정값으로 검증.

| 항목 | 기준 |
|------|------|
| cross-chapter 6곳 | 위치(장 파일)와 `chapter_ref` 값이 정확한지 고정값 검증 |
| 아모스 5·6장 절 순서 | 재배치 구간 절 번호 시퀀스 고정 |
| 이사야 40·41장 절 순서 | 동일 |
| 호세아 13·14장 절 순서 | 동일 |

## 파일 구조

```
tests/
  fixtures/
    verse_sequence.json   ← 로컬에서 생성, 저장소에 커밋
  generate_fixtures.py    ← 원본 텍스트 필요 (로컬 전용)
  test_completeness.py    ← Level 1
  test_ordering.py        ← Level 2 (fixture 사용)
  test_snapshots.py       ← Level 3
```

## 픽스처 갱신 워크플로우

```
원본 텍스트 또는 파서 로직 변경 시 (로컬)
  ↓
python tests/generate_fixtures.py  # 원본 텍스트 필요
  ↓
tests/fixtures/verse_sequence.json 갱신
  ↓
커밋 & 푸시
  ↓
CI: tests/ 전체 실행 (원본 없이)
```

픽스처는 원본 텍스트나 파싱 로직(`parser.py`)이 바뀔 때만 재생성한다.
`split_bible.py`만 수정하는 경우 픽스처는 그대로 유지하고 테스트만 재실행한다.

## 관련 ADR

- ADR-003: 물리적 장 처리 방식 — Level 2·3 테스트가 검증하는 대상
- ADR-002: 집회서 머리말 처리 — Level 1의 `sir-prologue.json` 검증이 대응
