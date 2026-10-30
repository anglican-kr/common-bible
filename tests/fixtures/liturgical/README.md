# tests/fixtures/liturgical: 교회력 엔진 기대값 픽스처

**실제 연도의 기대값(날짜, 전례일 id, 상태, 지정 전례일, 전례색)은 여기가 기준이다**(설계서 §1.4 기준 지도). 설계서 §7과 검토 문서 §5는 케이스를 **id로 가리키기만** 하고 값을 되풀이하지 않는다. 규칙(왜 그렇게 되는가)은 설계서 §4와 §6의 `R-` 기준 문장이 맡고, 각 케이스는 `canon`으로 그 문장을 가리킨다.

검토 문서 부록 B의 제안 스키마(LiturgicalCalendarAPI `LitCalTest.json` 계열)를 채택하고 `kind`, `group`, `canon`, `checks`, `source`, `status`를 더했다. 2026-09-20에 설계서 §7의 옮김 계산 행 ①-⑩, B1 행, 사계재 행 ④와 §9의 미결16, 26, 29, 30, 31, 그리고 검토 문서 §5.11-5.13에서 옮겨 적었다(원장 `docs/changes/2026-09-20-engine-canon-1.md`에 대응표).

## 파일

| 파일 | `kind` | 내용 |
|---|---|---|
| `transfers.cases.json` | `transfer` | 밀려 옮김(실제 연도): 옮겨 온 축일, 옮겨 간 축일, 연쇄, 보호 기간, 명절, 같은 순위 |
| `optionals.cases.json` | `optional`과 `activation` | 선택 봉헌 `optional` 후보와 활성화 계약(옮겨 지키기로 한 축일을 엔진이 옮긴다는 약속, `activated`) |
| `winners.cases.json` | `winner` | 지정 전례일(`official`), 전례색, 지정 자격(사계재, 기념일), 생략(`omitted`) |
| `transfers-1900-2100.golden.txt` | — | **기준 결과 파일**(검토 문서 부록 A, I-10). 1900-2100에 옮기는 축일 전부를 한 줄씩 적는다(`activated = ∅`). 손으로 쓰는 기대값이 아니라 엔진이 만든 회귀 기준이다. `UPDATE_GOLDEN=1 node --test tests/unit/liturgical-engine.data.test.js`로 다시 만들고 변경 내용을 PR에서 읽는다. 머리줄의 데이터 해시(sha)는 기록용이라 비교하지 않는다. 기대값의 기준은 위 세 파일이다 |

합성 표 케이스(연도 경계, 해를 넘긴 선착순, 옮길 날 수의 상한, 목적지 충돌, 옮겨 간 후순위 후보 제외, 옮겨 지키기로 한 선택 봉헌이 비운 원래 날, 옮겨 온 축일을 다시 옮기지 않음)와 1900-2100 불변식(검토 문서 `I-n`)은 **케이스로 넣지 않는다**. 합성 표는 코드가 만들므로 설계서 §7 본문과 `liturgical-engine.test.js`에, 불변식은 `liturgical-engine.data.test.js`에 둔다. 이 디렉터리에 두는 것은 I-10의 기준 결과 파일(위 표)뿐이다.

## id 규칙

id는 `<접두>-<YYYY-MM-DD>-<ascii-slug>` 형식이다. 접두는 `T`(transfer), `O`(optional), `A`(activation), `W`(winner)다. 날짜는 **첫 확인 항목의 날짜**고, `<ascii-slug>`는 영문 소문자, 숫자, 하이픈이다. 한글은 `expect`의 id 값에만 쓴다(문서를 grep으로 찾거나 정규식으로 다룰 때 안전하다). 발급하면 바꾸지 않는다. 케이스가 뒤집히면 `status`와 `expect`를 고치고 id는 남긴다. 예: `T-2026-07-27-anna-joachim`, `O-2026-08-09-transfiguration`, `A-2030-02-03-presentation-vs-seollal`, `W-2026-05-27-ember-ordination`.

문서에서 인용할 때는 id를 그대로 쓴다. 예는 설계서 §7 「`transfers.cases.json` ①: T-2025-12-01-andrew · …」, 검토 문서 C 항목 「픽스처 T-…」, §9 미결 「근거 T-2026-12-07-nicholas」이다.

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
| `kind` | ✓ | `transfer`, `optional`, `activation`, `winner` 중 하나이며 id 접두와 일치한다 |
| `group` | | 리팩터링 전 설계서 §7 행의 묶음 표시(①-⑩, B1, 사계재 ④ …). **참조 대상이 아니다.** 대응표에 쓴다 |
| `title` | ✓ | 한 줄 요약 |
| `status` | ✓ | `confirmed`(외부 근거나 사용자 확정), `provisional`(잠정. `issue`가 필수이고, 뒤집히면 `expect`가 바뀐다), `skip`(데이터나 책자를 기다림. `skip` 이유가 필수이고, 테스트는 건너뛴다) |
| `issue` | `provisional`이나 `skip`이면 ✓ | 관련 미결 번호(설계서 §9). 닫힌 미결을 근거로 적어도 된다 |
| `skip` | `skip`이면 ✓ | 무엇을 기다리는가 |
| `activated` | `activation`이면 ✓ | `computeTransfers(year, seed, activated)`에 넘길 전례일 id 집합 |
| `canon` | ✓ | 규칙의 기준. `R-<§>-<slug>` 마커(설계서 §4, §6) 또는 `설계서 §x.y`를 적는다. 존재를 테스트가 검사한다 |
| `checks` | | 검토 문서 §5의 `C-`, `X-`, `I-` id. 존재를 테스트가 검사한다 |
| `source` | ✓ | 외부 근거(책자 쪽, 달력 면, lectionarypage, 사용자 확정 날짜) |
| `alsoYears` | | 같은 모양이 되풀이되는 다른 연도. 테스트가 날짜 확인 항목의 **연도만 바꿔** 되풀이해도 된다. 그러려면 같은 월일이 그 해에도 같은 요일이어야 한다(테스트가 검사한다). 주님의 세례처럼 날짜가 해마다 다른 전례일은 해마다 확인 항목을 따로 적는다 |
| `ifIssueFlips` | | 잠정 케이스에서 미결이 반대로 닫히면 대신 기대할 값 |
| `note` | | 이유와 경위 요약. 규칙 본문은 여기 적지 않고 `canon`으로 가리킨다 |
| `assertions` | ✓ | 아래 |

## 확인 항목(`assertions[]`)

`{ "date": "YYYY-MM-DD", "expect": {…} }` 또는 연도 범위 `{ "years": [from, to], "expect": {…} }`. `expect`는 **부분집합 비교**다. 적은 키만 검사하고 적지 않은 키는 보지 않는다. 한 날짜에 여러 확인 항목을 둬도 된다(후보별로 하나씩). 확인 항목에 `note`(문자열)를 달 수 있고, 이 `note`는 **`expect` 밖**에 있어 비교하지 않는다. 엔진이 맞힐 수 없는 산문(「두 세트는 성직후보자·수도자」)은 전부 여기에 적는다. `expect` 안에는 엔진 결과와 실제로 맞춰 볼 수 있는 값만 적는다.

| `expect` 키 | 뜻 |
|---|---|
| `id` | 이 확인 항목이 보는 후보의 `observance.id`. 정확한 id(`d0325-성모수태고지`, `t-대림1주일`, `lunar11-설날`, `grid:advent-2-weekday-mon`, `guard:holy-week`)를 쓰며 **생략부호는 금지**다 |
| `status` | `proper`, `transferred_in`, `transferred_out`, `optional`, `commemorated`, `omitted`(설계서 §5.5) |
| `from`, `to` | `transferred_in`/`optional`의 기원 날짜, `transferred_out`의 목적지 날짜 |
| `displacedBy` | 밀어낸 것의 정확한 id. **`null`이면 「필드가 없어야 한다」**(활성화된 선택 봉헌은 밀린 것이 아니라 택한 것이다) |
| `absent: true` | `id`(`status`도 함께)에 맞는 후보가 **없어야** 한다(반대 모델 회귀, 「optional 없음」) |
| `notInDepartures: true` | `departures.get(date)`에 `id`가 없다(옮겨 온 축일을 다시 옮기지 않음, 절차 ⑤에 따라 옮기지 않음, 동시 봉헌) |
| `neverDeparts` | 연도 범위 확인 항목. 그 id가 어느 해에도 `departures`에 나타나지 않는다 |
| `official` | 그날 `official`의 id. `"grid:*"`는 「격자 합성 후보이면 된다」(주간 번호를 문서가 적지 않은 경우) |
| `color`, `colors` | `ResolvedDate.color`(정식 전례색 `white`, `red`, `green`, `violet`)와 `ResolvedDate.colors`(함께 적는 목록. 사계재 날 축일이 지정 전례일이면 [자, 축일 색], 그 밖은 `[color]`. R-6.4-ember-color를 본다) |
| `observanceColor` | 그 후보의 `observance.color`(뷰가 칩을 선택할 때 쓰는 색. 사계재는 `violet`) |
| `penitential`, `fast` | 후보의 `penitential`과 그날의 소재일 여부(엔진 `fastOf(resolved) === "minor"`. 대재일은 `"major"`라 `fast`가 아니다) |
| `coord` | `ResolvedDate.coord`의 부분집합 `{season, week, type}` |
| `grid` | 그날 격자 합성 후보의 `{status}` |
| `readings` | 그 후보로 `findReadings`를 호출한 결과: `origin`(색인 날짜 `MM.DD`), `record`(본문 레코드 id), `common`(공통 분류), `sets`(세트 수), `slots`(4슬롯 성구, 인쇄 순), `empty: true` |
| `officialReadings` | `official` 후보의 독서. 위와 같은 키에 `cycle`(A/B/C)을 더한다 |
| `collects` | `findCollects`의 결과: `origin`, `count` |

## 소비 방법

- **지금(PR 2 전)**: `tests/unit/liturgical-fixtures.test.js`가 공개 CI에서 다음을 검사한다. 스키마가 맞는지, id가 유일하고 형식이 맞는지, 날짜가 유효한지, 전례일 id(`id`, `displacedBy`, `official`, `neverDeparts`)에 생략부호가 없는지, `status`와 `kind`의 값이 허용 범위인지(`provisional`과 `skip`은 `issue` 필수), `ifIssueFlips.expect`도 같은 검사를 통과하는지, `expect`가 비어 있지 않은지, `alsoYears`의 요일이 같은지, `canon`, `checks`, `issue`가 문서에 존재하는지다. **전례일 id가 실데이터에 있는지**는 `tests/unit/liturgical-fixtures.data.test.js`가 `data/` 서브모듈이 있는 `engine-data.yml`(픽스처가 바뀔 때도 실행된다)과 `sync-data.yml`에서 검사한다. 이 검사는 옮겨 적기 오류를 잡는 유일한 기계 검사라서, 공개 CI에서 건너뛴 결과(skip)만 믿지 않는다.
- **PR 3**: `tests/unit/liturgical-engine.data.test.js`가 세 파일을 읽어 `status !== "skip"`인 케이스마다 `resolveDate(date)` 결과에 `expect`를 부분집합 비교한다. 케이스 하나가 테스트 하나다. `provisional`은 「잠정」 표시를 붙여 실행하되, 실패하면 실패다. 뒤집힌 미결은 픽스처를 고쳐 닫는다. `expect`의 모르는 키는 실패로 다룬다(조용히 무시하면 그 확인 항목이 아무것도 지키지 못한다). `activation` 케이스는 그 케이스의 `activated`로 옮김 계산 캐시를 새로 만들고(엔진 `setActivatedOptionals`. 집합이 바뀌면 캐시를 비운다) 끝나면 빈 집합으로 되돌린다. `alsoYears`는 날짜 확인 항목의 연도만 바꿔(`from`, `to` 같은 날짜 값도 함께) 되풀이한다. 연도 범위 확인 항목은 `neverDeparts` 하나만 받는다. PR 3은 둘로 나눠 냈다. 첫째(#341)가 `winners.cases.json`을 실행 대상에 넣었고, 둘째(#343)가 옮김 계산과 함께 `transfers`, `optionals`, 연도 범위 확인 항목, `activated`, 첫째가 건너뛴 둘(W-2026-05-15-matthias-color, W-2025-12-29-holy-innocents-color)을 실행 대상에 넣었다.
- **미결이 닫히면**: 그 PR에서 `status`를 `confirmed`로 바꾸고 `source`에 근거를 더한다. `ifIssueFlips`대로 닫혔으면 `expect`를 그 값으로 바꾸고 `ifIssueFlips`를 지운다. id는 그대로 둔다.
- **사실 변경 0 증명**: `python3 scripts/docs_facts_snapshot.py --diff main HEAD`가 문서와 픽스처(JSON 문자열 값)를 합쳐 토큰을 세므로, 문서에서 값을 지우고 픽스처로 옮겨도 「사라진 토큰」에 나타나지 않는다.
