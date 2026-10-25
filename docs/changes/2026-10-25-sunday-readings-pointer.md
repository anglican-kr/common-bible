---
date: 2026-10-25
branch: data/sunday-readings-pointer
title: "data: 서브모듈 포인터와 설계서 데이터 수치 갱신"
---

## 요약

데이터 서브모듈 포인터를 data#40, data#41, data#42가 머지된 커밋(`448e93b`)으로 올리고, 설계서 §5.2의 데이터 수치 블록(`facts`)을 그에 맞췄다. data#42가 독서 레코드를 하나 더해, 수치가 낡은 채로는 `sync-data.yml`이 포인터 PR을 열지 않고 멈추기 때문이다(#346과 같은 방식).

## 확정 · 근거

- **데이터에서 바뀐 것**(사용자 결정, 2026-10-25. 근거는 기도서 472-473쪽 「주일 감사성찬례 전례독서」).
  - data#40: 주의 변모 주일 나해 둘째 독서를 「1고린 4:3-6」에서 「2고린 4:3-6」으로 고쳤다.
  - data#41: 기도서 472-473쪽을 데이터 저장소 `liturgical/prayer-book/sunday-readings/`에 옮겨 적고 데이터와 대조했다.
  - data#42: 대림 4주일 나해는 성모송가(루가 1:46하-55)를 첫 세트로, 시편 89를 둘째 세트로 고쳤다. 사순 5주일 나해에는 시편 119:9-16 대안 세트를 더했다. 그래서 2026-12-20(대림 4주일 나해)에 처음 보이는 시편 자리가 성모송가가 된다.
- **수치 블록에서 바뀐 여덟 값**: `readings.total` 928에서 929, `readings.set_no.2` 81에서 82, `readings.set_total_gt1` 163에서 165, `readings.slot.first`, `readings.slot.psalm`, `readings.slot.gospel` 928에서 929, `readings.slot.second` 383에서 384, `readings.weekday_null` 393에서 394.

## 검증

- `node --test tests/unit/docs-data-consistency.test.js` 외 `sync-data.yml`이 돌리는 실데이터 테스트 여섯 파일: 179개 통과, 1개 건너뜀.
- 문서 검사(`tests/unit/docs-*.test.js`, `liturgical-fixtures.test.js`) 31개 통과.
- `python3 scripts/build_sitemap.py`로 sitemap을 다시 만들었다.
- 앱 코드와 테스트를 바꾸지 않아 유닛 전체와 e2e는 돌리지 않았다.

## 갱신한 문서

- `docs/design/liturgical-engine/05-lookup-layer.md`: §5.2 facts 블록의 여덟 값.
