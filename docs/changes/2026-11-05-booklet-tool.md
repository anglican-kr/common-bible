---
pr: 474
date: 2026-11-05
branch: fix/booklet-tool
title: "fix: 책자 대조 도구를 전례독서 목록 모델에 맞춤"
---

## 요약

전례독서와 책자를 대조하는 도구(`tools/booklet/engine-dump.mjs`)가 오류로 멈춰 있어 고칩니다. #473에서 전례일 칩을 전례독서 목록으로 바꾸며 화면 모델의 `chips` 값이 사라졌는데, 도구가 아직 그 값을 읽고 있었습니다. 앱 화면에는 영향이 없었습니다.

## 확정 · 근거

- **`chips` 대신 `choices`를 덤프한다.** 그날의 전례독서 목록을 후보 id, 이름, 상태 표시, 활성 여부로 적습니다. 이미 없어진 `pair`도 뺐습니다. `compare.py`가 읽는 것은 `view.initial`, `groups`, `candidates`로 그대로입니다.
- **시험을 하나 더했다.** 도구는 뷰 모델을 이름으로 읽는 별도 스크립트라, 모델의 값을 지워도 다른 시험이 알아채지 못합니다. `lectionary.data.test.js`가 저녁 전례가 있는 12.24와 세트가 셋인 12.25를 실제로 실행합니다. `engine-data.yml`의 경로 조건에 도구도 넣었습니다.

## 검증

- 유닛 `node --test tests/unit/*.test.js`: 1,487건 중 실패 0, 건너뜀 1(미결13 픽스처).
- 타입 검사 `tsc -p tsconfig.json --noEmit`: 통과. 작업 폴더에 `tsc`가 없어 원래 폴더의 것으로 실행했습니다. 타입 검사 범위(`js/`)의 파일은 바꾸지 않았습니다.
- 새 시험은 고치기 전의 도구로 돌리면 `m.chips.map`에서 실패함을 확인했습니다.
- 2027 책자 전체 대조(`extract.py`, `parse_booklet_2027.py`, `engine-dump.mjs`, `compare.py`)가 398일을 끝까지 돕니다. 독서 같음 338일, 표기만 다름 25일, 불일치 21일, 다른 후보의 독서 8일, 대안 수 차이 3일, 감사성찬례 없음 1일입니다. 다른 후보의 독서가 README의 6일에서 8일로 는 것은 2027-09-26과 09-27로, 모든 한국의 순교자들을 다음 날로 옮기기로 한 결정(2026-10-24) 때문입니다.
- 앱 코드를 바꾸지 않아 e2e는 실행하지 않았습니다.

## 갱신한 문서

- `tools/booklet/README.md`: `view.choices`와 새 시험.
- `tests/README.md`: `lectionary.data.test.js`의 설명과 케이스 수.
