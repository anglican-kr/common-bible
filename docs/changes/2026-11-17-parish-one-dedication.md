---
date: 2026-11-17
branch: docs/parish-one-dedication
title: "docs: 한 교회 한 축성일에 맞춰 두 줄인 교회의 설명 정리"
---

## 요약

본당 표에 두 줄이던 교회(백석포성당, 파주성당)를 data#81이 한 줄로 고쳤고, 앱의 데이터 연결도 #581로 올라갔다. 그래서 「두 줄인 교회는 두 날짜에 모두 적용한다」, 「두 줄에 같은 식별자를 적는다」 같은 설명을 지금 동작에 맞춘다. 화면 동작은 바뀌지 않는다.

## 확정 · 근거

- 한 교회의 축성일은 하나이고, 날짜가 둘이면 하나는 잘못 적은 것이다(사용자 확정 2026-11-17). 백석포성당은 11.21 축성, 파주성당은 10.20 축복을 남겼다(사용자 결정 2026-11-17, data#81). 결정은 #580에서 ADR-041 §6에 적었고, 이 PR은 끝난 일을 지금 동작으로 옮긴다.
- 설정 목록을 만드는 함수(helpers.js `parishGroups`)는 교회 식별자로 묶는 코드를 그대로 둔다. 같은 식별자가 다시 나와도 한 항목이 되는 것은 표가 바뀌어도 맞는 동작이고, 표의 두 줄은 데이터 파서가 오류로 막는다. 주석과 시험 이름만 고친다.

## 검증

- 유닛 `tests/unit/helpers.test.js`와 문서 검사 `tests/unit/docs-*.test.js` 통과.
- e2e `tests/e2e/test_settings.py`의 소속교회 시험 통과(새 데이터, 작업 폴더 서버 8091).

## 갱신한 문서

- `docs/decisions/041-settings-structure-and-lectionary-preferences.md`: §6의 두 줄이던 교회와 식별자 문장
- `docs/topics/liturgical.md`: 「지금 동작」의 본당 표 한 줄, 「남은 일」에서 끝난 항목 지움
- `docs/design/liturgical-engine/09-open-items.md`: 미결36의 두 줄인 교회 문장
