# ADR-004: 데이터 파이프라인 테스트 전략

- 일시: 2026-03-26
- 상태: 승인됨

## 결정

원본 성경 텍스트 없이도 CI에서 데이터 파이프라인을 검증할 수 있게, 원본에서 저작권과 무관한 구조 메타데이터만 뽑은 픽스처 파일을 저장소에 커밋한다. 테스트는 3단계로 짜고, 모든 단계를 CI에서 돌릴 수 있게 한다.

2026-05-11부터 Level 1-3 검증 테스트는 `common-bible-data` 저장소에 있다(ADR-020 분할). 그 저장소의 `.github/workflows/validate.yml`이 push마다 자동으로 돌리고, 앱 저장소 CI는 JS 유닛만 맡는다.

## 맥락

공동번역성서 원본 텍스트(`data/common-bible-kr.txt`)는 저작권 합의에 따라, 누구나 볼 수 있는 공개 저장소에는 넣을 수 없다. 그런데 이날 작성한 `parser.py`와 `split_bible.py`는 원본 텍스트를 입력으로 받아 절의 물리적 순서를 JSON으로 바꾸는 파이프라인이고(ADR-003), 이 순서가 지켜졌는지 자동으로 확인할 수단이 없었다.

parser.py나 split_bible.py를 고쳤을 때 절 순서가 깨져도, 눈으로 확인하는 것 말고는 알아챌 방법이 없었다.

## 제약

- 원본 텍스트: 공개 저장소에 넣을 수 없다(저작권). 2026-05-11부터는 비공개인 `common-bible-data` 저장소에 있다(ADR-020).
- 픽스처 파일: 절 번호 시퀀스만 담는다(본문 없음). 저작권과 무관해 커밋할 수 있다.
- CI 환경: 원본 텍스트 없이 돈다.

## 테스트 구성

### Level 1: 완전성 (Completeness)

원본 없이 돌릴 수 있다. `data/` 디렉터리와 `books.json`만으로 검증한다.

| 항목 | 기준 |
|------|------|
| 책 수 | `books.json`에 73권이 있다 |
| 장 파일 수 | `data/bible/`에 1328개와 `sir-prologue.json` |
| books.json 일관성 | `chapter_count`가 실제 파일 수와 같다 |
| has_prologue 플래그 | 집회서(sir)만 `true` |
| sir-prologue.json | 있고, `paragraphs`가 2개이며, `type == "prologue"` |
| OSIS book_id | 73권 모두 OSIS 소문자 기준과 같다 |

### Level 2: 순서 보존 (Ordering)

픽스처 파일(`tests/fixtures/verse_sequence.json`)을 쓴다. CI에서 돌릴 수 있다.

픽스처 형식:
```json
{
  "gen-1": [1, 2, 3, ...],
  "amos-5": [1, 2, 3, 4, 5, 6, 9, 8, 7, 10, 11, ...],
  "isa-40": [1, 2, ..., 19, {"n": 6, "chapter_ref": 41}, 7, 20, ...]
}
```

검증 내용:
- 각 장 JSON의 절 번호 시퀀스가 픽스처와 완전히 같다.

픽스처는 원본 텍스트가 있는 로컬 환경에서만 만든다.
```
python tests/generate_fixtures.py
```

### Level 3: 특수 케이스 스냅샷 (Snapshot)

원본 없이 돌릴 수 있다. 알려진 경우를 고정값으로 검증한다.

| 항목 | 기준 |
|------|------|
| 다른 장으로 옮겨 실린 절 6곳 | 위치(장 파일)와 `chapter_ref` 값이 정확한지 고정값으로 검증 |
| 아모스 5장과 6장의 절 순서 | 재배치 구간의 절 번호 시퀀스 고정 |
| 이사야 40장과 41장의 절 순서 | 위와 같다 |
| 호세아 13장과 14장의 절 순서 | 위와 같다 |

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

픽스처는 원본 텍스트나 파싱 로직(`parser.py`)이 바뀔 때만 다시 만든다. `split_bible.py`만 고치는 경우에는 픽스처를 그대로 두고 테스트만 다시 돌린다.

## 관련 ADR

- ADR-003: 물리적 장 처리 방식. Level 2와 3 테스트가 검증하는 대상이다.
- ADR-002: 집회서 머리말 처리. Level 1의 `sir-prologue.json` 검증이 여기에 대응한다.
