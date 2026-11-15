---
date: 2026-11-16
branch: docs/lectionary-index-adr
title: "docs: 전례독서 검색 색인의 새 구조를 ADR-037에"
---

## 요약

전례독서 검색 색인 `lectionary/search-lectionary.json`의 새 구조를 ADR-037 §5에 확정했다. 데이터 저장소가 색인을 고치기 전에 결정을 먼저 적는다는 규칙(CLAUDE.md 「ADR 워크플로우」)에 따른 것이다. 색인은 독서 세트의 이름 목록(`names`)에서 전례일 목록(`obs`), 독서 세트(`sets`), 독서 자리를 단 구간(`cov`), 성인(`saints`), 비슷한 말 표(`synonyms`)로 바뀐다. 구현은 데이터 저장소 PR이 한다.

## 확정 · 근거

- 설계서 `docs/design/lectionary-search.md` §8은 필드 이름을 데이터 PR에서 정하기로 했다. 이 PR이 정했다. 전례일 목록은 `obs`(키, 이름, 별칭, 종류, 날짜, 등급, 전례년 순서, 공통 분류)이고, `cov`의 첫 칸은 독서 세트 번호, 마지막 칸은 독서 자리다.
- 전례일 목록에는 독서가 없는 날도 넣는다. ADR-044 §3이 이름 검색의 대상을 독서 세트가 아니라 전례일로 정했기 때문이다. 표에 없지만 독서가 있는 날(절기 격자의 날, 성주간 평일, 사계재의 날, 12월 17-24일)도 넣고, 이동 축일 표의 날과 격자의 날이 같으면(대림1주일) 하나로 합친다. 데이터를 세어 확인한 사실이다.
- 색인을 만드는 일은 독서 파서(`parse_readings.py`)에서 떼어 새 스크립트 `liturgical/build_lectionary_search.py`로 옮긴다. 월별 축일과 이동 축일 표를 읽어야 해서 그 파서들보다 뒤에 실행해야 한다.
- 비슷한 말 표는 데이터 저장소의 손으로 쓰는 표 `liturgical/search-synonyms.md`로 두고 줄마다 출처를 적는다.
- 처음 구조(`names`)는 ADR-037 「검토한 대안」에 남겼다.
- ADR-044 §2가 천주교 책 이름의 예로 든 `갈라티아`, `필리피`를 `갈라티아서`, `필리피서`로 고쳤다. 데이터 저장소 PR이 주교회의 성경과 굿뉴스 매일미사에서 책 이름을 모으다 보니, 두 이름은 그 모양으로 쓰이지 않았다.
- 앱은 아직 이 색인을 읽지 않는다. 그래서 구조를 바꿔도 지금 앱은 그대로다.

## 검증

- `node --test tests/unit/docs-*.test.js`: 통과
- 앱의 유닛 1,746개를 데이터 저장소 PR의 브랜치(`64b921a`)로 돌려 모두 통과했다. 건너뛴 시험은 없다. 이 PR 자체는 문서만 바꾼다.

## 갱신한 문서

- `docs/decisions/037-eucharist-lectionary-data-and-engine.md`: 요약 5, §2의 산출물, §5 본문, 「검토한 대안」의 검색 인덱스
- `docs/design/lectionary-search.md`: 머리말, §8의 구조와 파일 이름, §10
- `docs/design/liturgical-engine/05-lookup-layer.md`: 파일 표의 색인 필드
- `docs/topics/search.md`: 「남은 일」의 전례독서 검색 항목
- `docs/decisions/044-lectionary-search-single-box.md`: §2의 천주교 책 이름 예
