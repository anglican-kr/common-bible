---
date: 2026-11-11
branch: docs/bible-names
title: "docs: 성서 인물 이름은 공동번역 표기로"
---

## 요약

성서에 나오는 인물의 이름을 공동번역 본문의 표기로 쓰기로 했다(ADR-036 §5). 기도서와 교구 게시글의 「스테파노」는 「스데파노」로, 「미카엘」은 「미가엘」로 쓴다. 데이터는 anglican-kr/common-bible-data#76에서 바꾸고, 이 PR은 결정을 ADR과 주제 문서에 적고 앱의 시험과 문서를 새 이름에 맞춘다. 사용자에게 보이는 변화는 data#76이 머지되어 데이터 포인터가 올라갈 때 생긴다. 12월 26일과 9월 29일의 축일 이름, 세례명 목록, 12월 26일 본기도 문장의 이름이 바뀐다.

## 확정 · 근거

- **사용자 결정(2026-11-11)**: 성무일과 데이터의 554쪽 「성 스테반」을 고치다가, 공동번역 사도행전은 18곳 모두 「스데파노」인데 교회력 이름은 「스테파노」라는 것을 사용자가 짚었다. 성서에 있는 이름을 그대로 쓰기로 했다. 범위는 성서 인물 모두(공동번역 본문에 없는 표기는 「스테파노」와 「미카엘」 둘), 본기도 문장 안의 이름도 포함, 축일 식별자도 새 이름(`d1226-성-스데파노`, `d0929-성-미가엘과-모든-천사들`)으로 정했다.
- **원문은 인쇄된 대로 둔다.** 기도서를 옮겨 적은 원문과 내려받은 게시글은 그대로 두고, 데이터 저장소의 파서가 전례일 키를 만들 때 바꾼다. 손으로 적는 교회력 표는 새 표기로 적는다.
- **식별자가 바뀐 영향**: 전례독서 주소의 `?obs=` 값으로 옛 식별자를 가진 주소는 그날의 기본 독서를 보인다. 두 날 모두 이 축일이 기본이라 사용자가 겪는 차이는 거의 없다. 세례명 설정은 성인마다 정한 식별자를 저장해 끊기지 않는다(ADR-041 §5).
- **머지 순서**: 이 PR을 먼저 머지하고 data#76을 머지한다. 이 PR의 실데이터 시험은 새 이름을 기대하므로, data#76이 머지되어 포인터가 올라가기 전까지 원래 폴더에서 실데이터 시험을 돌리면 이름 시험 8개가 실패한다. CI는 데이터 없이 돌아 영향이 없다. 거꾸로 머지하면 데이터 빌드가 실행하는 앱 동기화(`sync-data.yml`)가 이 시험에서 실패한다.
- **고치지 않은 것**: 머지된 원장(`docs/changes/`), 보관 문서(`docs/archive/`), 기도서 규정을 옮겨 적은 참고 문서(`docs/reference/`), 기도서 92쪽 머리를 인용한 설계서 한 줄(`09-open-items.md` 미결49).

## 검증

- data#76의 산출물(`lectionary/*.json`)을 데이터 서브모듈에 잠시 넣고 돌렸다(커밋하지 않고 되돌림).
  - `node --test tests/unit/*.test.js`: 1,712개 통과. 이름을 바꾸기 전 시험은 8개가 실패했다.
  - 옮김 기준 결과 파일(`tests/fixtures/liturgical/transfers-1900-2100.golden.txt`)은 `UPDATE_GOLDEN=1`로 다시 만들었다. 이름이 든 58줄과 머리줄의 데이터 커밋 표시만 바뀌었다.
  - e2e `tests/e2e/test_calendar_view.py`: 95개 통과(작업 폴더 서버 8093).
- `npm run typecheck` 통과, 문서 검사 23개 통과.

## 갱신한 문서

- `docs/decisions/036-liturgical-calendar-data-model.md`: §5에 월별 축일 이름의 규칙(성서 인물은 공동번역 표기)을 더하고, 본문의 두 이름을 바꿨다.
- `docs/topics/liturgical.md`: 「확정 사실」에 결정을 더하고, 「본기도 본문은 기도서를 따른다」에 예외를 적었다. 본문의 두 이름을 바꿨다.
- `docs/decisions/038-calendar-lectionary-ui.md`, `041-settings-structure-and-lectionary-preferences.md`, `042-office-lectionary-data.md`, `docs/design/liturgical-engine-review.md`, `docs/design/liturgical-engine/05-lookup-layer.md`, `06-rank-transfer-color.md`, `07-test-plan.md`, `09-open-items.md`, `tests/README.md`: 본문의 두 이름을 바꿨다.
