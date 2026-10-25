---
date: 2026-10-25
branch: docs/term-movable-monthly
title: "docs: temporal, sanctoral, 성인력을 「이동 축일」과 「월별 축일」로 바꿈"
---

## 요약

낱말 정리의 앱 PR 셋 가운데 셋째다. 한국어 문장에 쓴 temporal을 「이동 축일」로, sanctoral과 「성인력」을 「월별 축일」(기도서 31-37쪽의 이름)로 바꿨다. 문서마다(설계서는 장마다) 처음 나오는 곳에 「이동 축일(temporal)」, 「월별 축일(sanctoral)」로 영어 이름을 한 번 달았다. 데이터 저장소 쪽은 data#43에서 바꿨다.

## 확정 · 근거

- **낱말**(사용자 결정, 2026-10-25. `docs/writing.md` 「용어」에 #420에서 적었다).
- **바꾼 방식**: 문서, 주석, 테스트 이름, 픽스처 문구의 한국어 문장에서 229곳을 하나씩 보고 바꿨다.
  - 「temporal 기념일」은 「이동 축일 표의 기념일」로, 「성인력 기념일」은 「월별 축일 표의 기념일」로 썼다. 「이동 축일인 기념일」이라 하면 등급 이름(축일, 기념일)이 서로 부딪친다.
  - 「temporal 규칙일」과 「sanctoral 고정일」은 같은 뜻을 겹쳐 쓴 말이라 「이동 축일」, 「월별 축일」로 줄였다. 범주 사다리(R-6.2-tie-ladder)에만 풀이를 남겨 「도착 > 이동 축일(규칙일) > 월별 축일(고정일) > 격자 > 합성 guard」로 썼다(설계서 06장, 엔진 주석, 테스트 이름).
  - 「temporal 지정 전례일」은 「이동 축일인 지정 전례일」로 썼다.
  - 「성인력에 행이 없다」처럼 표를 가리키는 곳은 「월별 축일 표에」로 썼다.
  - 격자를 가리키던 「격자의 절기 위치(temporal)」에서는 괄호를 뺐다(설계서 §5.5의 후보 출처 ①과 그 코드 블록 주석, ADR-037 §6). 이동 축일 행은 따로 ④ 규칙 파생 후보다.
- **바꾼 제목**: ADR-036 §5(「구분자 `kind`: `temporal`(이동 축일) / `sanctoral`(월별 축일)」), ADR-036의 「성인력 보완 영역」(「월별 축일 보완 영역」. 이 제목을 인용한 다섯 곳도 바꿨다), 「미결 사항」 9의 「성인력 보완」. 이 제목들로 가는 앵커 링크는 없다.
- **데이터와 맞춘 것**: ADR-036 §4의 `_vocab.kind` 예시를 데이터(`liturgical/coords.py`, data#43)와 같게 「이동 축일」, 「월별 축일」로 고쳤다.
- **바꾸지 않은 것**
  - 코드 이름과 값: `kind: "temporal"`, `temporal-feasts.json`, `sanctoral.json`, `sanctoral_class`, facts 키(`sanctoral.commemoration`), 백틱 안의 파서 이름
  - 표 파일을 이름으로 부른 곳: 설계서 §5.4의 조인 목록(「sanctoral ↔ readings/collects」 등), 「정의 표(sanctoral, temporal-feasts)」(설계서 §5.4, `js/types.d.ts`)
  - 영어로 쓴 주석의 temporal, sanctoral
  - 테스트가 만드는 합성 레코드의 이름 값 「합성 temporal 기념일」. 데이터 값이다.
  - `docs/writing.md` 「용어」의 줄, 머지된 원장(`docs/changes/`), 보관 문서(`docs/archive/`), 「성인 공통」
- **함께 고친 것**: `docs/architecture.md` ADR 목록에서 ADR-036 줄의 「temporal/sanctoral」을 「이동 축일과 월별 축일(sanctoral)을 가르는 `kind`」로 풀었다.

## 검증

- 유닛 전체: 1365개 통과, 1개 건너뜀. `npm run typecheck` 통과.
- 문서 검사 31개 통과. 한정어 없는 참조 경고는 8건 그대로다.
- 교회력 사실 토큰 비교(`--strict-counts`): 사라진 토큰, 줄어든 토큰, 새 토큰 모두 0이다.
- 일반 토큰 비교(`--kinds general --strict-counts`): 사라진 다섯은 모두 우리 문서의 문구를 인용한 「」나 코드 표기다(범주 사다리 표기, 「temporal > sanctoral」, 「성인력 보완 영역」, 「성인력 참조」, 「성인력 행이 없는 날짜 본문 16건」). 줄어든 하나(「temporal > 격자」)는 보관 문서에 남은 것이다.
- 남은 「성인력」은 `docs/writing.md` 「용어」의 줄 하나다(원장과 보관 문서 제외).
- e2e는 돌리지 않았다. 코드는 주석, 테스트 이름, 픽스처 문구만 바꿨다.

## 갱신한 문서

- `docs/design/liturgical-engine/` 장 파일 여섯(02, 04, 05, 06, 07, 09장): 낱말과 첫 표기.
- `docs/design/liturgical-engine-review.md`: 낱말.
- `docs/decisions/036-liturgical-calendar-data-model.md`, `037-eucharist-lectionary-data-and-engine.md`, `038-calendar-lectionary-ui.md`: 낱말과 제목, `_vocab` 예시.
- `docs/topics/liturgical.md`, `docs/architecture.md`, `tests/README.md`: 낱말.
