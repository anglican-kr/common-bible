# tests/fixtures/liturgical — 교회력 엔진 기대값 픽스처

**실제 연도의 기대값(날짜 · 관측일 id · 상태 · 승자 · 전례색)은 여기가 정본이다**(설계서 §1.4 정본 지도). 설계서 §7 · 검토 문서 §5 는 케이스를 **id 로 가리키기만** 하고 값을 되풀이하지 않는다. 규칙(왜 그렇게 되는가)은 설계서 §4·§6 의 `R-` 정본 문장이 맡고, 각 케이스는 `canon` 으로 그 문장을 가리킨다.

검토 문서 부록 B 의 제안 스키마(LiturgicalCalendarAPI `LitCalTest.json` 계열)를 채택하고 `kind` · `group` · `canon` · `checks` · `source` · `status` 를 더했다. 2026-09-20 에 설계서 §7 이동 패스 행 ①~⑩ · B1 행 · 사계재 행 ④ · §9 미결16·26·29·30·31 · 검토 문서 §5.11~5.13 에서 전사했다(원장 `docs/changes/2026-09-20-engine-canon-1.md` 에 대응표).

## 파일

| 파일 | `kind` | 내용 |
|---|---|---|
| `transfers.cases.json` | `transfer` | 충돌 이동(실제 연도) — 도착·출발·연쇄·보호 기간·명절·동률 |
| `optionals.cases.json` | `optional` · `activation` | 선택 봉헌 `optional` 후보와 활성화(`activated`) 계약 |
| `winners.cases.json` | `winner` | 승자(`official`)·전례색·승자 자격(사계재·기념일)·생략(`omitted`) |

합성 표 케이스(연도 경계 · 이동 상한 · 좌석 경합 · 떠난 패자 제외 · 켜진 출발이 비운 자리)와 1900~2100 불변식(검토 문서 `I-n`)은 **여기 넣지 않는다** — 표를 코드가 만들므로 설계서 §7 본문과 `liturgical-engine.test.js` 에 둔다.

## id 규칙

`<접두>-<YYYY-MM-DD>-<ascii-slug>` — 접두는 `T`(transfer) · `O`(optional) · `A`(activation) · `W`(winner), 날짜는 **첫 단언의 날짜**, slug 는 ascii 소문자·숫자·하이픈. 한글은 `expect` 의 id 값에만 쓴다(문서 grep · 정규식 안전). 발급하면 바꾸지 않는다 — 케이스가 뒤집히면 `status` · `expect` 를 고치고 id 는 남긴다. 예: `T-2026-07-27-anna-joachim` · `O-2026-08-09-transfiguration` · `A-2030-02-03-presentation-vs-seollal` · `W-2026-05-27-ember-ordination`.

문서에서 인용할 때는 id 그대로 — 설계서 §7 「`transfers.cases.json` ①: T-2025-12-01-andrew · …」, 검토 문서 C 항목 「픽스처 T-…」, §9 미결 「근거 T-2026-12-07-nicholas」.

## 케이스 스키마

```json
{
  "id": "T-2025-12-01-andrew",
  "kind": "transfer",
  "group": "①",
  "title": "안드레아 11.30 → 12.1 — …",
  "status": "confirmed",
  "issue": "미결17",
  "skip": null,
  "activated": ["d0202-주의-봉헌"],
  "canon": ["R-6.2-tie-ladder", "설계서 §5.6"],
  "checks": ["C-6.5-1", "X-10"],
  "source": ["lectionarypage 2025", "2026 책자 — …"],
  "alsoYears": [2032, 2038, 2049],
  "ifIssueFlips": { "issue": "미결26", "expect": { "color": "violet" } },
  "note": "…",
  "assertions": [
    { "date": "2025-12-01", "note": "…", "expect": { "id": "d1130-사도-성-안드레아", "status": "transferred_in", "from": "2025-11-30", "displacedBy": "t-대림1주일" } },
    { "years": [1900, 2100], "expect": { "neverDeparts": "d0929-대한성공회-설립-기념일" } }
  ]
}
```

| 필드 | 필수 | 뜻 |
|---|---|---|
| `id` | ✓ | 위 규칙. 세 파일에 걸쳐 유일 |
| `kind` | ✓ | `transfer` · `optional` · `activation` · `winner` — id 접두와 일치 |
| `group` | | 리팩터링 전 설계서 §7 행의 묶음 표시(①~⑩ · B1 · 사계재 ④ …). **참조 대상이 아니다** — 대응표용 |
| `title` | ✓ | 한 줄 요약 |
| `status` | ✓ | `confirmed`(외부 근거·사용자 확정) · `provisional`(잠정 — `issue` 필수, 뒤집히면 `expect` 가 바뀐다) · `skip`(데이터·책자 대기 — `skip` 이유 필수, 소비자는 건너뛴다) |
| `issue` | provisional·skip 이면 ✓ | 관련 미결 번호(설계서 §9). 닫힌 미결을 근거로 적어도 된다 |
| `skip` | skip 이면 ✓ | 무엇을 기다리는가 |
| `activated` | activation 이면 ✓ | `computeTransfers(year, seed, activated)` 에 넘길 관측일 id 집합 |
| `canon` | ✓ | 규칙의 정본 — `R-<§>-<slug>` 마커(설계서 §4·§6) 또는 `설계서 §x.y`. 존재를 테스트가 검사한다 |
| `checks` | | 검토 문서 §5 의 `C-`/`X-`/`I-` id. 존재를 테스트가 검사한다 |
| `source` | ✓ | 외부 근거(책자 쪽 · 달력 면 · lectionarypage · 사용자 확정 날짜) |
| `alsoYears` | | 같은 모양이 되풀이되는 다른 연도 — 소비자가 날짜 단언의 **연도만 바꿔** 되풀이해도 된다. 그러려면 같은 월·일이 그 해에도 같은 요일이어야 한다(테스트가 검사) — 주님의 세례처럼 날짜가 해마다 다른 관측일은 해마다 단언을 따로 적는다 |
| `ifIssueFlips` | | 잠정 케이스에서 미결이 반대로 닫히면 대신 기대할 값 |
| `note` | | 이유·경위 요약 — 규칙 본문은 여기 적지 않고 `canon` 으로 가리킨다 |
| `assertions` | ✓ | 아래 |

## 단언(`assertions[]`)

`{ "date": "YYYY-MM-DD", "expect": {…} }` 또는 연도 범위 `{ "years": [from, to], "expect": {…} }`. `expect` 는 **부분집합 비교**다 — 적은 키만 검사하고 적지 않은 키는 보지 않는다. 한 날짜에 여러 단언을 둬도 된다(후보별로 하나씩). 단언에 `note`(문자열)를 달 수 있는데 **`expect` 밖**이며 비교하지 않는다 — 엔진이 맞힐 수 없는 산문(「두 세트는 성직후보자·수도자」)은 전부 여기로 간다. `expect` 안에는 엔진 결과와 실제로 맞춰 볼 수 있는 값만 적는다.

| `expect` 키 | 뜻 |
|---|---|
| `id` | 이 단언이 보는 후보의 `observance.id`. 정확한 id(`d0325-성모수태고지` · `t-대림1주일` · `lunar11-설날` · `grid:advent-2-weekday-mon` · `guard:easter-octave`) — **생략부호 금지** |
| `status` | `proper` · `transferred_in` · `transferred_out` · `optional` · `commemorated` · `omitted`(설계서 §5.5) |
| `from` · `to` | `transferred_in`/`optional` 의 기원 날짜 · `transferred_out` 의 목적지 날짜 |
| `displacedBy` | 밀어낸 것의 정확한 id. **`null` 이면 「필드가 없어야 한다」**(활성화된 선택 봉헌 — 밀린 것이 아니라 택한 것) |
| `absent: true` | `id`(+ `status`)에 맞는 후보가 **없어야** 한다(반대 모델 회귀 · 「optional 없음」) |
| `notInDepartures: true` | `departures.get(date)` 에 `id` 가 없다(도착 재이동 금지 · 절차 ⑤ 무이동 · 동시 봉헌) |
| `neverDeparts` | 연도 범위 단언 — 그 id 가 어느 해에도 `departures` 에 나타나지 않는다 |
| `official` | 그날 `official` 의 id. `"grid:*"` 는 「격자 합성 후보이면 된다」(주간 번호를 문서가 적지 않은 경우) |
| `color` · `colors` | `ResolvedDate.color`(정식 전례색 `white` `red` `green` `violet`). `colors` 는 병기 모델(미결26)에서만 |
| `observanceColor` | 그 후보 `observance.color`(뷰가 칩 선택 시 쓰는 색 — 사계재 `violet`) |
| `penitential` · `fast` | 후보의 `penitential` / 그날의 소재일 여부 |
| `coord` | `ResolvedDate.coord` 부분집합 `{season, week, type}` |
| `grid` | 그날 격자 합성 후보의 `{status}` |
| `readings` | 그 후보로 `findReadings` 를 부른 결과 — `origin`(색인 날짜 `MM.DD`) · `record`(본문 레코드 id) · `common`(공통 분류) · `sets`(세트 수) · `slots`(4슬롯 성구 — 인쇄 순) · `empty: true` |
| `officialReadings` | `official` 후보의 독서 — 위와 같은 키 + `cycle`(A/B/C) |
| `collects` | `findCollects` 결과 — `origin` · `count` |

## 소비 방법

- **지금(PR 2 전)**: `tests/unit/liturgical-fixtures.test.js` 가 스키마 · id 유일성·형식 · 날짜 유효성 · 관측일 id(`id`·`displacedBy`·`official`·`neverDeparts`) 생략부호 금지 · `status`/`kind` 도메인(provisional·skip 은 `issue` 필수) · `ifIssueFlips.expect` 도 같은 검사 · 빈 `expect` 금지 · `alsoYears` 요일 동일 · `canon`·`checks`·`issue` 가 문서에 존재하는지를 검사한다(공개 CI). **관측일 id 가 실데이터에 실재하는지**는 `tests/unit/liturgical-fixtures.data.test.js` 가 `data/` 서브모듈이 있는 `engine-data.yml`(픽스처 변경도 트리거)·`sync-data.yml` 에서 검사한다 — 전사 오류를 잡는 유일한 기계 검사라 공개 CI 의 skip 만 믿지 않는다.
- **PR 3**: `tests/unit/liturgical-engine.data.test.js` 가 세 파일을 읽어 `status !== "skip"` 인 케이스마다 `resolveDate(date)`(activation 은 `activated` 를 넘긴 캐시로) 결과에 `expect` 를 부분집합 비교한다. `provisional` 은 「잠정」 표시로 돌리되 실패하면 실패다 — 뒤집힌 미결은 픽스처를 고쳐 닫는다.
- **미결이 닫히면**: 그 PR 에서 `status` 를 `confirmed` 로 바꾸고 `source` 에 근거를 더한다. `ifIssueFlips` 대로 닫혔으면 `expect` 를 그 값으로 바꾸고 `ifIssueFlips` 를 지운다. id 는 그대로.
- **사실 변경 0 증명**: `python3 scripts/docs_facts_snapshot.py --diff main HEAD` 가 문서와 픽스처(JSON 문자열 값)를 합쳐 토큰을 세므로, 문서에서 값을 지우고 픽스처로 옮겨도 「사라진 토큰」에 잡히지 않는다.
