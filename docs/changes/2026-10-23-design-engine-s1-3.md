---
pr: 399
date: 2026-10-23
branch: docs/design-engine-s1-3
title: "docs: 교회력 설계서 §1-§3 고쳐 쓰기와 내용 검증"
---

## 요약

교회력 설계서 `docs/design/liturgical-engine.md`를 절마다 고쳐 쓰며 내용을 검증하는 작업(known-issues §24)의 첫 PR이다. 머리와 §1(개요), §2(데이터 현실), §3(배치와 계층)을 다뤘다. 절 번호와 C-, I-, 미결 번호는 그대로 두었다.

- 사실을 하나씩 뽑아 엔진 코드(`js/app/liturgical-engine.js`), 데이터(`data/lectionary/*.json`), 테스트, 원장과 대조했다. 낡은 설명은 코드에 맞춰 고쳤다. 아래 「확정 · 근거」에 고친 것을 적었다.
- 문장을 `docs/writing.md`에 맞게 고쳐 썼다. 가운뎃점으로 이은 명사를 문장이나 목록으로 풀었고, 영어 술어(throw하다, import하면)를 한국어로 바꿨다. 학술 문체 낱말(재진술, 승계, 소급, 준용)도 바꿨다.
- 길게 이어 쓴 문단을 목록으로 나눴다. 머리의 상태 줄, 관련 ADR, §1.2의 범위 밖, §1.4의 규칙 마커 21개, 기준 지도를 적용한 PR 넷, §2의 설계 원칙, §3.3의 블록 제약이다.

## 확정 · 근거

어긋난 것은 모두 문서가 구현을 설명하다 낡은 경우였다. 사용자 결정이나 기도서 규칙과 코드가 어긋난 곳은 없었다.

- **마커 블록은 셋이다.** §1.3은 셋이라 했는데 §3.3은 제목과 본문 첫 줄이 「둘로 나눈다」였다. 코드에는 `LITURGICAL_CORE`, `LITURGICAL_LOOKUP`, `LITURGICAL_PRELOAD` 셋이 있다. §3.3 제목을 「셋으로 나눈다」로 고쳤다.
- **`LITURGICAL_LOOKUP`은 B1 판정도 담고, 모듈 상태 둘을 건드린다.** 품계, 이동, 색, 재일, 연도 단위 이동 패스가 이 블록에 있다. 이동 패스 캐시(`transferCache`)와 선택 봉헌 활성화 집합(`activatedOptionals`)을 건드린다는 것을 코드 머리 주석대로 적었다. 파일 골격(§3.2)에도 `activatedOptionals`와 반절 표 재시도 상태를 더했다.
- **엔진은 이름을 붙여 내보낸다.** §3.1의 「레거시 호출자가 생기기 전까지 `export {}` 만」을 지웠다. `bookmark-core.js`는 `window.appStorage` 등을 읽으므로 「window 한 줄도 없음」이 맞지 않는다. 그래서 「`window`에 붙이는 것이 없다」로 고쳤다. 엔진 파일에는 `window`가 나오지 않는다.
- **`lectionary.js`는 `parseVerseSpec`을 부르지 않는다.** `verse-spec.js`의 다른 함수(`specCoversVerse`, `verseInstanceKeys`, `citationSource`)를 쓴다. 「절 범위를 다루는 `verse-spec.js`의 함수」로 고쳤다.
- **`Candidate`에 `evening?`이 있다**(`js/types.d.ts`, R-6.1-evening). §1.3의 래퍼 필드 목록에 더했다.
- **사계재 본문 레코드의 실제 형식.** 본문 레코드에는 `coord_name` 칸이 없다. 하계재, 추계재, 동계재 본문은 `season: null`이지만, 춘계재 본문(독서 5건, 본기도 4건)은 사순 1주 좌표(`season: lent`)에 있다. §2의 「양쪽 다 `coord_name: null` · `season: null`」을 이대로 고쳤다.
- **화면의 진행 상태.** §1.1의 「데이터는 앱에 배포되고 있지만 아무도 열어보지 않는다」는 엔진을 만들기 전의 이야기라 과거로 고쳤다. 머리의 「남은 것은 엔진을 소비하는 UI」는 ADR-038 상태에 맞춰, 독서 화면과 캘린더 월간 화면이 나왔고 주간과 목록 화면, 검색 이원화가 남았다고 고쳤다. §3.4의 `buildWeekStrip`, `buildAgendaList`는 아직 없고 `buildMonthGrid`만 있다는 것도 적었다.
- **§3.4의 예시 코드**를 실제 `preloadCalendar`로 바꿨다. 예전 예시는 코드에 없는 `calendarTables`에 값을 넣었다. 실제 코드는 인덱스를 세우고 이동 패스 캐시를 비운다.
- **§3.3의 「700줄짜리 슬라이스」**는 설계 때의 어림이었다. 지금 두 블록을 합치면 약 1,900줄이다.
- **§3.5의 크기를 다시 쟀다**(2026-10-23). 캘린더 묶음은 약 105KB에서 약 108KB로, 지역 묶음은 약 91KB에서 약 88KB로 고쳤다. 독서 묶음 약 1.6MB와 전체 약 2MB는 맞다.
- **ADR-039는 data 저장소에 있다.** 머리의 관련 ADR에 적었다.
- **§1.4 마지막 문단.** ADR 001-035의 옛 개정 블록은 손댈 때 정리하기로 했는데, ADR 문체 정리(#382-#396)에서 남은 것을 모두 본문에 반영했다. `docs/decisions/`에 개정 블록이 남지 않은 것을 확인했다.
- §3.6의 「+390ms」에 측정이 적힌 원장(`docs/changes/2026-10-17-lazy-liturgical-modules.md`)을 붙였다.

확인했고 맞았던 것:

- 머리의 PR 번호(#325, #338, #341, #343, #345)와 §1.4의 #333, #347, #349, §3.5의 #365, §3.6의 #319를 커밋 제목과 대조했다.
- §1.4 규칙 마커 목록 21개가 문서의 정의 21개와 같다.
- §2 데이터 표는 데이터 파일과 맞았다.
  - prec 7이 겹치는 날 7건과 그 가운데 축일끼리 5건
  - 성인력 기념일 16건이 모두 `sanctoral_class: null`, `has_proper: false`, `color: null`
  - 맥추감사주일의 `rank: null`, 노동자의 날 행 없음
  - 음력 표 2025-2050(26년)
  - 12.31 전야 레코드 없음, 부활밤 가해, 나해, 다해 복음(마태, 마르, 루가)
  - 여성선교주일 본문 0건
- 엔진을 직접 돌려 §2의 두 행을 확인했다. 2032-02-11에는 설이 그날의 대표가 되고 재의 수요일은 `proper`로 남아 옮겨지지 않는다. 2029-05-31과 2038-06-24에는 성체일이 남고 성모 방문과 성 세례 요한 탄생이 다음 날로 옮겨진다. 성체일과 겹치는 해는 2026년부터 2100년까지 2029, 2038, 2040뿐이다.
- 프리로드 전 오류 문구, promise 캐시와 실패 시 비우기, 블록을 같은 vm 컨텍스트에서 차례로 실행하는 테스트, `sw.js` `cacheNameFor()`의 `/data/lectionary/` 라우팅, `sw.test.js`의 묶음 검사가 문서대로다.

## 검증

- 교회력 사실 토큰 비교 `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --strict-counts --allow-new '^2026-10-23$' --allow-new '^#(382|396)$'`에서 사라진 토큰과 줄어든 토큰이 0이다. 새 토큰 셋(2026-10-23, #382, #396)은 위에서 더한 사실이다.
- `python3 scripts/docs_facts_snapshot.py --diff main WORKTREE --docs 'docs/design/liturgical-engine.md' --kinds general --strict-counts`에서 줄어든 토큰은 0이다. 사라진 코드 토큰 셋(`export {}`, `parseVerseSpec`, `{observance, status, from?, to?, displacedBy?}`)은 위에서 고친 낡은 설명이다.
- `node --test tests/unit/docs-*.test.js tests/unit/liturgical-fixtures.test.js`는 31개가 모두 통과했다.

## 갱신한 문서

- `docs/design/liturgical-engine.md`: 머리와 §1-§3을 고쳐 쓰고 낡은 내용을 고쳤다.
