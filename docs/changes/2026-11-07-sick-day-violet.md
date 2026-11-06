---
date: 2026-11-07
branch: feat/sick-day-violet
title: "feat: 병자를 위한 기도일을 고를 때만 자색으로 표시"
---

## 요약

2.11 병자를 위한 기도일을 전례독서 목록에서 고르면 기도서대로 자색을 보인다. 처음 화면과 캘린더 칸은 전처럼 그날의 전례일 색이다. 함께 `git submodule update data`의 쓰임을 작업 중 함정에 적었다. ADR-038 §3 「병자를 위한 기도일의 대체 독서」, 설계서 R-6.4-color-order, 미결30. 데이터는 data#63이 고치고, 이 PR은 포인터를 올리고 엔진과 시험, 문서를 맞춘다.

## 확정 · 근거

- **기도일을 고를 때만 자색이다(사용자 결정 2026-11-07).** 기도서는 83쪽과 103쪽에 자색으로 적었다. 기도일을 지킬 때의 색으로 읽어, 평일 독서를 읽는 날의 색은 건드리지 않는다.
- **엔진에 예외를 하나 더했다.** 표에 색만 적으면 지정 전례일의 색이 그날 색을 덮어 평일 화면과 캘린더 칸까지 자색이 된다. 대체 독서 표시(`alternate_readings`)가 있는 축일은 덮지 않게 했다(`dayColorsOf`). 고른 뒤의 색은 고른 후보의 색을 쓰는 기존 코드(`headerColors`)가 보인다.
- **`git submodule update data`의 쓰임을 적었다.** 작업 폴더에서 데이터 서브모듈이 머지 전 커밋으로 되돌아간 일(2026-11-07, #505 원장)은 사용자가 이 명령을 실행해서 생긴 것으로 본다. 사용자가 언제 실행하는지 물어, 원래 폴더와 작업 폴더를 나눠 적었다.

## 검증

- 유닛 `node --test tests/unit/*.test.js`: 1,558건 통과, 건너뜀 0건, 실패 0건. 타입 검사 통과.
- 데이터 `pytest tests/`: 3,287건 통과. `gen_manifests.py --check` 통과. 산출물에서 바뀐 값은 02.11의 색과 2.11 본기도의 색이고, 「전례색 미해소」 보고가 한 줄 줄었다.
- e2e `test_lectionary_view.py::test_sick_day_is_an_alternate_reading` 1건 통과(작업 폴더 사본, 포트 8091, 데이터 작업 폴더의 산출물을 복사해서). 색이 달라지는 날이 2.11뿐이라 이 한 건만 돌렸다. 처음 화면 녹색, 고른 뒤 자색, 캘린더 칸의 `aria-label` 녹색을 본다. 26해의 색은 실데이터 유닛이 본다.
- 돌리지 않은 것: 나머지 e2e, 아이폰 실물.

## 갱신한 문서

- `docs/topics/liturgical.md`: 지금 동작의 2.11 항목.
- `docs/decisions/038-calendar-lectionary-ui.md`: 「병자를 위한 기도일의 대체 독서」의 색, 검토한 대안.
- `docs/decisions/036-liturgical-calendar-data-model.md`: 그날의 색을 덮지 않는 예외.
- `docs/design/liturgical-engine/06-rank-transfer-color.md`: R-6.4-color-order.
- `docs/design/liturgical-engine/02-data-reality.md`, `05-lookup-layer.md`, `09-open-items.md`, `docs/design/liturgical-engine-review.md`: 색 값, facts 블록, 미결30과 미결51.
- `docs/workflow.md`: 작업 중 함정의 `git submodule update data`.
