## 7. 테스트 계획

**파일을 둘로 가른다. 공개 CI가 서브모듈을 받지 못하기 때문이다**(14차 리뷰). `.github/workflows/test.yml`의 필수 `Unit tests` 잡은 `actions/checkout@v4`를 **서브모듈 없이** 돌리므로 `data/`가 없다. 그래서 `docs-data-consistency.test.js`, `sw.test.js`는 `sync-data.yml`에서 돈다. 서브모듈을 받는 자리는 그것과 엔진 전용 `engine-data.yml`(머지 직후 main push, §9 미결22) 둘이다. 엔진 테스트도 같은 규칙을 따른다.

| 파일 | 입력 | 어디서 도나 |
|---|---|---|
| `tests/unit/liturgical-engine.test.js` | **합성 표**와 순수 계산만 | 필수 `Unit tests`(모든 PR) |
| `tests/unit/liturgical-engine.data.test.js` | `data/lectionary/` 실측 | `engine-data.yml`(머지 직후)과 `sync-data.yml`의 데이터 잡에 **명시적으로 추가** |

- 가르지 않으면 실데이터 케이스가 공개 CI에서 조용히 깨지거나(서브모듈 없음) 통째로 건너뛰어, 체크에 `- [x]`를 달아도 아무것도 지키지 못한다. 체크리스트의 「유닛(실데이터)」 표시가 곧 **아래 파일 행**을 뜻한다.
- 계산 계층(§4)은 데이터가 필요 없어 모두 위 파일이다. 조회와 옮김(§5, §6)은 합성 표로 잡을 수 있는 것을 위로 올리고, 실측 대조만 아래로 내린다.

**하네스.** `tests/unit/liturgical-engine.test.js`는 ADR-013 하네스를 쓴다. 각 테스트 파일이 `extractBlock`을 자기 안에 복사해 갖고, `vm.createContext`에 최소 전역만 넣는다. **`Date`를 컨텍스트에 반드시 넣어야 한다**(기본 세트에 없다). realm 경계 때문에 반환값 비교는 `JSON.parse(JSON.stringify(v))`로 정규화한다.

**실제 연도의 기대값은 픽스처가 기준이다**(§1.4).

- [`tests/fixtures/liturgical/`](../../../tests/fixtures/liturgical/README.md)의 `transfers.cases.json`(밀려 옮김), `optionals.cases.json`(선택 봉헌, 활성화), `winners.cases.json`(지정 전례일, 색, 지정 자격)이다. 스키마, id 규칙, 소비 방법은 그 README가 기준이고, `tests/unit/liturgical-fixtures.test.js`가 형식과 문서 참조를 검사한다.
- 아래 목록의 실제 연도 항목은 **케이스 id로 가리키기만** 하고 날짜, id, 색을 되풀이하지 않는다. 합성 표 케이스와 1900-2100 불변식은 값이 아니라 검증 방법이라 목록에 그대로 둔다.
- 케이스가 처음 §7의 어느 묶음에서 왔는지는 각 케이스의 `group` 필드에 있다(표시일 뿐 참조 대상이 아니다, §1.4).

**픽스처별 케이스.**

- `transfers.cases.json`
  - **도착 경로**: T-2025-12-01-andrew, T-2026-01-26-paul-conversion.
  - **도착과 prec 7 고유 축일**: T-2026-12-07-nicholas.
  - **성탄 3축일 연쇄**: T-2025-12-29-holy-innocents, T-2026-12-28-john-chain, T-2027-12-27-christmas-triad.
  - **부활 절기**: T-2026-05-15-matthias, T-2026-06-01-visitation, T-2026-07-27-anna-joachim, T-2026-10-19-luke.
  - **보호 기간**(→ R-6.3-holy-week-guard): T-2024-04-08-annunciation-holy-monday, T-2025-04-28-mark, T-2035-04-02-joseph-first-come, T-2043-04-06-annunciation, T-2038-05-03-mark-easter-day, T-2029-04-09-annunciation-palm-sunday, T-2027-04-05-annunciation-maundy-thursday, T-2062-03-27-annunciation-holy-saturday.
  - **도착에 밀린 축일의 기념**(→ R-6.1-prec7-omit): T-2027-07-26-anna-joachim-commemorated.
  - **우선순위가 같은 경우(잠정)**: T-2029-06-01-visitation-vs-corpus-christi, T-2038-06-25-john-baptist-vs-corpus-christi.
  - **동시 봉헌**: T-2050-09-29-founding-day-co-observed.
  - **명절**: T-2040-09-22-matthew-chuseok, T-2049-02-03-presentation-seollal, T-2032-02-12-ash-wednesday-seollal(skip).
  - **2024, 2025 책자**: T-2025-06-30-peter-paul, T-2025-08-25-bartholomew, T-2025-09-15-holy-cross, T-2025-09-22-matthew, T-2024-09-09-nativity-of-mary, T-2024-12-09-immaculate-conception, T-2025-11-03-all-souls, T-2033-09-09-nativity-of-mary-chuseok.
- `optionals.cases.json`
  - **승천**: O-2026-05-17-ascension, O-2024-05-12-ascension, O-2025-06-01-ascension.
  - **공현**: O-2030-01-06-epiphany-on-sunday, O-2024-01-07-epiphany, O-2026-01-04-epiphany.
  - **모든 성인**: O-2026-11-01-all-saints-on-sunday, O-2024-11-03-all-saints, O-2025-11-02-all-saints.
  - **주의 봉헌**: O-2026-02-01-presentation, O-2024-02-04-presentation, O-2028-01-30-presentation, O-2034-02-05-presentation, O-2031-02-02-presentation-on-sunday, O-2049-01-31-presentation.
  - **주의 변모**: O-2026-08-09-transfiguration, O-2024-08-04-transfiguration, O-2025-08-03-transfiguration, O-2028-08-06-transfiguration-on-sunday.
  - **활성화**: A-2028-01-30-presentation-activated, A-2049-01-31-presentation-activated, A-2030-02-03-presentation-vs-seollal(잠정), A-2026-05-17-ascension-activated, A-2026-08-09-transfiguration-activated.
  - **주일과 도착에 함께 밀린 축일**(→ R-6.2-chain-model): A-2025-11-03-all-souls-all-saints-activated, A-2071-06-01-visitation-ascension-activated.
- `winners.cases.json`
  - **주님의 세례**: W-2026-01-11-baptism-of-the-lord.
  - **사계재와 기념일의 자격**: W-2026-05-27-ember-ordination, W-2024-12-21-ember-ordination-kim, W-2024-12-20-ember-friday-two-sets, W-2026-01-01-peace-day-commemoration, W-2026-09-06-womens-mission-commemoration.
  - **사계재 색**: W-2026-05-27-ember-color, W-2026-09-18-ember-color, W-2026-02-25-ember-color, W-2025-12-17-ember-color, W-2026-09-16-ninian-ember, W-2026-09-19-theodore-ember.
  - **지정 전례일**: W-2025-02-02-presentation-over-sunday, W-2024-09-29-michael-over-sunday, W-2025-03-25-annunciation-lent-tuesday, W-2027-08-15-assumption-on-sunday, W-2027-09-26-korean-martyrs-on-sunday(주일에 밀려 옮김. 잠정, 미결48).
  - **밀린 축일의 기념**: W-2026-12-13-lucia-on-sunday, W-2026-09-13-chrysostom-on-sunday, W-2026-05-03-finding-of-cross-on-sunday, W-2023-12-03-xavier-on-advent-1.
  - **부활 8일 평일의 축일**(→ R-6.3-holy-week-guard): W-2025-04-23-george-easter-octave.
  - **기념일 이름 줄**: W-2025-07-06-thomas-more-on-sunday.
  - **명절**: W-2025-01-29-seollal, W-2025-10-06-chuseok, W-2026-09-25-chuseok-not-in-booklet.
  - **색(미결30)**: W-2026-05-15-matthias-color, W-2025-12-29-holy-innocents-color(잠정), W-2026-06-05-boniface-color.

**영역별 케이스.**

- **computus**: 권위 있는 서방 부활절 날짜표와 대조한다(ADR-036 §11이 지정한 검증 방식). 세기 경계를 포함한다. **범위 불변식**: 1900-2100에 부활은 3.23-4.25 안에 든다(규정 범위는 3.22-4.25).
- **파생 오프셋**: 재의 수요일은 늘 수요일, 승천은 늘 목요일, 성령강림은 늘 주일이다(1900-2100 모든 해 불변식). **범위**: 재의 수요일은 2.5-3.10, 대림1주일은 11.27-12.03 사이다.
- **대림 앵커**: 대림 1주일이 늘 주일이고 11.27-12.03 안에 든다. 전례년 경계(12.31과 1.1).
- **절기 스팬**: 스팬이 겹치지 않고 빈틈이 없다. 한 해 365일이나 366일이 정확히 한 절기에 배정된다.
- **연중 주차**: **2052년 3.3은 9주다**(윤년 회귀). 모든 주일이 정확히 한 주간에 속하고, 공현 후 1주부터 이어지며, 성령강림 후 34주로 끝난다.
- **주기**: 주일 주기는 대림에 넘어가고 평일 주기는 1.1에 넘어간다. 12월 구간의 어긋남이 의도대로인지 본다.
- **사계재(`ember_wfs`)**: **규칙 하나가 날짜 셋을 낳는 유일한 종류**라 따로 케이스가 필요하다(§4.3).
  - ① **앵커 당일이 수요일이어도 다음 주다.** 고정 앵커 9.14와 12.13은 1900-2100에 각 28회 수요일에 떨어진다. 「엄격히 이후」가 깨지면 그해만 조용히 한 주 당겨진다.
  - ② **네 계절 × 수, 금, 토 = 겹치지 않는 12일.** 춘계재는 사순1주 절기 위치에, 하계재 토요일은 성삼위일체 전날에 떨어진다.
  - ③ **조인.** 만든 세 날짜가 지향별 레코드와 맞물리고 **금요일 본기도 두 건(성직후보자, 수도자)이 보존된다.** 이 셋이 없으면 사계재가 다시 조회 불가로 돌아가도 테스트가 초록이다.
  - ④ **지정 전례일이 아니다**(지향, 2026-09-17, → R-6.1-ineligible). 픽스처 W-2026-05-27-ember-ordination(이천환 서품일과 하계재. `official`은 격자, 사계재 후보의 독서, 본기도, 소재일), W-2025-12-17-ember-color(동계재. `official`은 격자, 본문은 날짜 전용 레코드), W-2026-09-16-ninian-ember(축일이 지정 전례일인 사계재 날), W-2024-12-20-ember-friday-two-sets(금요일 두 세트, X-7). 그날의 `color`는 자다(→ R-6.4-ember-color). W-2026-05-27-ember-color 등 「사계재 색」 케이스가 지킨다.
- **기간 축(§4.10)**: `spansOf`는 앵커만으로 계산한다(데이터가 필요 없다). `transferGuard`는 정확히 E−7부터 E+7까지, 색 가드는 `holyWeek` ∪ `easterOctave`, 소재일 제외는 12.25부터 주님의 세례 전날까지, `ascensionToPentecost`는 **E+40**부터 E+48까지다(승천일 E+39는 뺀다. 그날은 자기 고유 본기도를 쓴다). **세 소비자(§6.3, §6.4, §6.5)가 같은 함수를 본다**는 것이 케이스의 요지다.
- **음력**: 2025-2050을 조회하고, **범위 밖 연도는 빈 결과**다(예외를 던지지 않는다).
- **폴백 매칭**: 구체성은 코드 하나, 배열, null 순이다. 점수가 같으면 `id` 사전순으로 안정 정렬하고, 맞지 않는 레코드는 뺀다.
- **공현 후 평일**: 성탄주간 날짜 레코드(1.7-1.12)는 **주님의 세례 뒤에는 쓰이지 않는다**(§5.4 좁히기 규칙 ①). 세례가 **1.7인 해**에는 공현 후 평일이 0일이라 1.8이 곧장 `ordinary-1` 평일이어야 하고, **1.13인 해**에는 1.7-1.12 엿새가 모두 성탄주간이어야 한다. 두 극단을 함께 잡는다. 한쪽만 보면 경계가 하루 어긋나도 통과한다. `01.13`에 성탄주간 레코드가 없다는 것도 함께 확인한다.
- **주님의 세례 = 연중1주일**: `first_sunday_after 1.6`(엄격히 이후)이 1900-2100 모든 해에서 연중1주 창(01-07부터 01-13까지) 안에 든다. 그날 `coord`는 `ordinary`, 1, `sunday`이고 **성탄절기가 그 전날 끝난다.** `official`은 `t-주님의-세례`(prec 3)이지 격자 주일이 아니다. 격자를 `christmas`로 합성하면 절기 주일(2)이 앞서 뒤집힌다(§4.5, → R-4.5-baptism-ordinary-1). 픽스처 W-2026-01-11-baptism-of-the-lord.
- **날짜 전용 본문**: **성탄절기 16건은 `date`로만 갈린다.** 12.17-12.24, 12.30, 1.3-1.12 가운데 월별 축일(sanctoral) 표에 행이 없는 열여섯이다(§5.4). 모두 `type: weekday`, `week: null`, `weekday: null`이라 **절기 위치로 찾으면 성탄주간 아홉이 한 덩어리로 나온다.** 그 가운데 1.3-1.5 셋은 이름이 모두 `성탄주간`인데 독서는 **1요한과 요한 1장을 이어 읽는 연속 봉독**이라 실제로 다르다(1.3은 1요한 2:29-3:6과 요한 1:29-34, 1.4는 3:7-10과 1:35-42, 1.5는 3:11-21과 1:43-51). 이 셋이 서로 다른 독서를 내는지 직접 확인한다. `findReadings`가 `resolved`를 잃으면 빈 결과가 아니라 **이웃 날의 그럴듯한 오답**이 나와서, 결손 내성 케이스로는 걸리지 않는다.
- **성인 공통 독서 폴백(§5.6)**: **양성.** 사베리오(12.03, `has_proper: true`, 독서 0)가 `missionary` 3세트를 `set_no` 1-3, `set_total` 3, `common: "missionary"`, `reading_track: null`, id `common:missionary-s1..3`으로 낸다. 루시안(01.08), 실베스터, 위클리프(12.31)가 자기 날짜의 `성탄주간`을 받지 않고 `martyr`, `pastor`, `teacher` 공통을 탄다. 데이빗(03.01)이 `삼일절`을 받지 않고 `pastor` 공통을 탄다. **이 넷이 없으면 「날짜 인덱스가 비면 폴백」 구현이 초록이다.**.
  - **음성.** 성 세례 요한 탄생(06.24)은 이름 조인이 띄어쓰기로 빠져도 고유 독서를 내고 `saint` 공통을 타지 않는다(행이 하나뿐인 날짜는 이름을 묻지 않는다). 스테파노(12.26, `martyr`)는 고유다. 본문 없는 축일(세계평화 기도일 01.01, 같은 날짜에 거룩한 이름 예수 독서 2건이 있다)은 빈 배열이다. `anniversary`는 빈 배열이다.
  - **배타.** 고유가 있으면 `common` 그룹이 섞이지 않는다.
  - **상태와 무관(합성).** `martyr`, `has_proper: false`, 고유 독서 없는 성인을 `transferred_in`으로 만든 후보가 공통을 탄다. 실데이터로는 잡을 수 없다. 옮길 수 있는 공통 분류 성인 8건이 모두 고유 독서를 가지고(2026-10-24 다시 확인), 안드레아(2025-12-01)는 `apostle`이라 폴백 경로에 들지 않아, 폴백이 `transferred_in`을 거부해도 초록이다.
  - **불변식(실데이터).** 폴백을 타는 월별 축일 행 79, 공통 분류인데 고유를 가진 행 13, 기념일 빈 결과 17. 합성 표 케이스는 위 파일, 실측 대조는 아래 파일이다.
- **결손 내성**: `rule: null`은 건너뛰고, 조회 결과가 없는 날에는 빈 배열이다(격자 빈 칸은 2026-08-29에 메워졌으므로 **기념일이나 표에 없는 날**로 케이스를 잡는다). `precedence: null`은 정렬 맨 뒤다.
- **프리로드 가드**: 프리로드 전에 동기로 호출하면 분명한 예외를 던진다.
- **B1**: 합성 표로 명절 > 대재일, A > C > B, `commemorate_only`, 성주간 색 가드, 성탄절기 금요일이 소재일이 아님을 본다.
  - **사계재와 기념일은 지정 전례일이 아니다**(→ R-6.1-ineligible): 픽스처 W-2026-05-27-ember-ordination, W-2024-12-21-ember-ordination-kim, W-2025-07-06-thomas-more-on-sunday, W-2026-09-06-womens-mission-commemoration(이동 축일 표의 기념일, 실데이터). W-2026-01-01-peace-day-commemoration은 세계평화 기도일이 2026-10-24에 축일이 되어 동시 봉헌(§6.5)의 사례다.
  - **합성: 이동 축일(temporal) 표의 기념일과 평일 격자.** 합성 이동 축일 표에 평일에 떨어지는 `rank: commemoration`, `precedence: 7` 행을 두고, 그날 `official`이 격자 평일(prec 8)이고 기념일은 `proper`인지 본다. 지정 자격 판별을 `kind`(월별 축일 행)로 좁힌 구현은 7이 8보다 앞서 실패한다. 실데이터의 이동 축일 표의 기념일(여성선교주일)은 언제나 주일이라, 7로도 5보다 뒤라 이 결함을 가르지 못한다.
  - 지정 전례일, 생략, 명절, 색의 실제 연도 케이스는 `winners.cases.json`의 나머지다(위 목록).
- **옮김 계산(§6.5)**: **실제 연도**가 기본이다. 합성 표는 실제 연도로 만들 수 없는 경로(연도 경계, 선착순, 도착끼리 기원 순, 해를 넘긴 선착순, 상한, 좌석 경합, 떠난 후순위 후보, 켜진 출발, 경계와 활성화, 도착을 다시 옮기지 않음, 보호 기간이 옮김 계산에 끼어들지 않음)에만 쓴다. 실제 연도 기대값은 픽스처(위 목록)가 기준이고, 여기는 **검증 방법과 합성 케이스**만 적는다.
  - **① 도착 경로.** T-2025-12-01-andrew(처음 미결9의 회귀 케이스. 기원과 목적지 한 쌍), T-2026-01-26-paul-conversion(격자 합성 id가 `displacedBy`).
    - **메타데이터에서 끝내지 않는다**(10차 리뷰). 도착 후보로 `findReadings`, `findCollects`를 호출해 **기원 날짜에 색인된 본문**이 나오는지까지 확인한다. 목적지로 인덱스를 치는 구현은 빈 결과를 내므로, 이 확인이 없으면 미결9가 후보 경로에서만 닫힌다(§5.6 날짜 선택 순서).
  - **①b 도착이 prec 7 고유 축일을 만나는 날.** T-2026-12-07-nicholas(첫 외부 확증. 서울교구 2026 달력 12월 면, 미결16).
  - **② 성탄 3축일(연쇄, → R-6.2-chain-model).** T-2025-12-29-holy-innocents, T-2026-12-28-john-chain, T-2027-12-27-christmas-triad(**반대 모델 회귀** 포함. 2027 책자가 연쇄로 확정해(미결17 닫힘, 2026-10-13) 그대로 둔다. X-3 건너뜀 iCal과 일부러 다른 회귀 정답지다).
    - **도착에 밀린 옮길 수 있는 축일은 연쇄한다**(→ R-6.2-chain-model. 연쇄 범위 R-6.2-chain-scope는 2026-10-24 폐기). 성인 분류와 무관하다(합성 C-6.5-20). 주일과 함께 밀린 경우는 A-2025-11-03-all-souls-all-saints-activated, A-2071-06-01-visitation-ascension-activated, 합성 C-6.5-21 케이스다. 안나와 요아킴은 축일이라 그날 기념한다(T-2027-07-26-anna-joachim-commemorated, → R-6.1-prec7-omit).
  - **③ 부활 절기.** T-2026-05-15-matthias, T-2026-06-01-visitation, T-2026-07-27-anna-joachim(축일이라 옮기지 않고 기념. 잠정, 미결27), T-2026-10-19-luke, 동시 봉헌이라 옮기지 않는 T-2050-09-29-founding-day-co-observed.
    - **보호 기간의 주요축일은 그날 지킨다**(→ R-6.3-holy-week-guard. 옛 목적지에는 `absent`를 확인한다): T-2024-04-08-annunciation-holy-monday(2024 책자), T-2025-04-28-mark(2025 책자), T-2035-04-02-joseph-first-come, T-2043-04-06-annunciation, T-2038-05-03-mark-easter-day(필립보와 야고보는 그날, 마르코는 부활대축일에 밀린다).
    - **그날의 대축일이나 주일에 밀리면 보호 기간 뒤 첫 빈 날로 간다**(→ R-6.3-guard-destination): T-2029-04-09-annunciation-palm-sunday(15일), T-2027-04-05-annunciation-maundy-thursday(2027 책자), T-2062-03-27-annunciation-holy-saturday(성 토요일이 민다. 함께 밀린 요셉과 서열 순, → R-6.3-guard-order. 요셉은 16일).
    - **합성: 보호 기간이 옮김 계산에 끼어들지 않음.** 성주간 월요일과 부활 1주 목요일의 B는 그날 `official`이고 축일 색이다. 성 목요일의 A는 보호 기간을 건너 부활 2주 월요일로, 성 토요일의 B는 성 토요일 행에 밀려 역시 부활 2주 월요일로 간다. 옮길 수 있는 prec 7은 `guard`에 밀려 `omitted`다. 성지주일 전날 밀린 X는 보호 기간에 막히지 않고 성주간 월요일에 앉아 그날 축일 색이고, 그날의 옮길 수 있는 prec 7은 도착에 밀리면 보호 기간 뒤로 간다(C-6.5-23).
    - **합성: 보호 기간에서 밀린 둘은 서열 순**(→ R-6.3-guard-order). 먼저 밀린 낮은 쪽보다 뒤에 밀린 높은 쪽이 부활 2주 월요일에 먼저 앉고, 같은 서열이면 원래 날짜 순이다(C-6.5-22, C-6.5-19).
    - **합성: 선착순과 기원 순**(그 밖의 도착). 이틀 연속 가변 대축일에 밀린 둘이 같은 날을 노리면 먼저 밀린 쪽이 앉는다(우선순위가 높아도, `id` 순이 아니다. C-6.5-7, C-6.5-9). 1900-2100 실데이터에서 서열 순과 갈리는 사례는 보호 기간의 6해뿐이고, 그것은 R-6.3-guard-order가 맡는다.
    - 보호 기간 케이스는 같은 부활절 날짜의 과거 연도(미국 성공회 2008, 2011, 2013, 2014, 2016, 2018, 2019)와 대조해 일치했었다. 보호 기간 뒤로 옮기던 때의 대조라 지금 결론(책자대로)과는 일부러 다르다(검토 문서 X-2).
  - **④ 명절.** T-2040-09-22-matthew-chuseok, T-2049-02-03-presentation-seollal(선택 봉헌 종류인데 밀려 옮김, §6.2), T-2032-02-12-ash-wednesday-seollal(skip. 미결13, 데이터를 고친 뒤 켠다).
  - **⑤ 우선순위가 같은 경우(잠정, 미결14).** T-2029-06-01-visitation-vs-corpus-christi, T-2038-06-25-john-baptist-vs-corpus-christi.
  - **⑥ 연도 경계.** 합성 표(12.31 `next_day` 주요축일과, 그날을 차지하는 **가변** 상위 후보. 고정일끼리는 동시 봉헌이라 옮기지 않는다. 유닛은 12.31이 성탄 1주일인 2028)로 `resolveDate("Y+1-01-01")`에 `from: "Y-12-31"` 도착이 보이는지, 그리고 `Y+1` 캐시만 먼저 만들어도 같은 결과인지(seed 경로) 본다.
    - **해를 넘긴 선착순.** 12월 축일 둘이 같은 1월 날을 노리면 먼저 밀린 쪽이 앉고 다음은 그다음 날이다(`isFree`가 해를 넘긴 날짜에서 이 계산의 도착과 다음 해 좌석을 함께 보는지).
  - **⑦ 선택 봉헌.** `optionals.cases.json`의 O- 케이스 전부(승천, 공현, 모든 성인, 주의 봉헌 `nearby_sunday` 경계, 주의 변모. 미결28, → R-6.2-nearby-sunday).
    - **활성화(`activated`).** A- 케이스 전부(0단계 선색인, 밀려 옮김 없음, 목적지가 명절인 해(미결19), 도착을 다시 옮기지 않음. §6.2 활성화 계약). 이 케이스만 I-2(검토 문서)의 「떠나지 않은 도착은 지정 전례일」에서 빠진다. `activated`를 바꾸면 `transferCache`가 비워져 같은 연도의 `resolveDate` 결과가 바뀐다(캐시를 재사용하면 실패).
    - **합성: 좌석 경합.** 켜진 선택 봉헌의 목적지 주일 전날(토요일)에 가변 후보(명절)가 A 축일을 밀도록 꾸민 표에서, 그 주일의 `official`은 선택 봉헌이고 A는 월요일 `transferred_in`이다(0단계 선착, §6.2 활성화 계약).
    - **합성: 떠난 후순위 후보 제외.** 고정일 W(prec 3), 가변 V(prec 5, transferable), 고정일 C(prec 6, transferable)를 같은 날에 둔 표에서 V만 옮겨지고 C는 `proper`로 남는다(떠난 V를 세면 C도 옮겨진다).
    - **켜진 출발이 비운 자리.** 승천을 켠 해에 그 목요일로 옮겨 가려는 다른 축일(합성)이 목요일에 앉는다. `isFree`가 활성화 출발을 고유 후보에서 빼지 않으면 금요일로 밀린다.
    - **합성: 도착을 다시 옮기지 않음.** 켜진 선택 봉헌이 목적지에서 후순위가 되어도(명절) 그날 옮길 고유 축일이 함께 있는 표에서, 봉헌은 `transferred_in`으로 남고 고유 축일만 옮겨진다. 실데이터 A-2030-02-03-presentation-vs-seollal은 그날 옮길 고유 축일이 없어 옮김 계산이 그날을 건너뛰므로 명시 분기를 가르지 못한다.
  - **⑧ 불변식**(1900-2100 모든 해, `arrivals`와 `departures`만. `optionals`는 뺀다).
    - 출발 수 = 도착 수 − seed 도착 수다(seed의 출발은 전년도 계산에 있다. 합성 ⑥에서 `Y+1`은 도착 1, 출발 0이 맞다).
    - 그 날짜를 떠나지 않은 도착은 그 날짜의 지정 전례일이다(`official`).
    - 도착 날짜가 주일이 아니고, 그날 유효 precedence ≤ 2인 고유 후보가 없으며, 옮김 계산의 `displacedBy`에 `guard:`가 없다(I-11. 처음의 「도착 날짜 ∉ 성지주일~부활2주일」 I-3 불변식은 폐기).
    - `defects`가 비어 있다. 옮긴 날 수는 16일 이하다(부활 3.26인 해 성지주일의 요셉, → R-6.3-guard-order).
    - **어느 날짜에서도 `arrivals.get(D)`의 축일이 `departures.get(D)`에 없다**(다시 옮기지 않음, → R-6.2-first-come. 기원 출발과 목적지 도착 한 쌍은 정상이다).
    - **임시 `Y−1` 계산(seed 없음)과 `spill(Y−2)`를 받은 완전한 `Y−1` 계산이 내는 `Y` 행 spill이 같다**(깊이 1의 직접 근거, §6.5 연도 경계).
    - **그와 별개로 seed 있는 `Y` 계산과 없는 `Y` 계산이 2월 1일부터 완전히 같다**(seed 영향 범위. 이 둘은 다른 성질이라 **둘 다** 확인한다. 1월 안에서 다시 합류하면 뒤엣것만으로는 1월 결과가 틀려도 통과한다).
    - `Y` 캐시를 만든 뒤 `Y−1`을 만들어도, 그 반대로 해도 두 항목의 내용이 같다.
    - 결과 전체는 골든 덤프(검토 문서 부록 A. `tests/fixtures/liturgical/transfers-1900-2100.golden.txt`, `UPDATE_GOLDEN=1`로 다시 만든다)가 문자열로 지킨다.
  - **⑨ 상한(합성 표).** 12.1-12.30을 prec 1 고유 축일로 막고 12.31은 비운 표에서, 11.30에 밀린 `next_day` 축일은 12.30(30일)까지 `isFree`를 검사하고 12.31(31일)에서 **멈추어** 도착과 출발을 만들지 않으며, `proper`로 남고 `defects`에 그 id가 있다. 12.30까지 비우면(29일만 막으면) 30일째에 앉는다. 상한이 30보다 작은 구현도, 큰 구현도 둘 가운데 하나에서 틀린다.
  - **⑩ 2024, 2025 책자 실제 연도 대조**(2026-09-19, 보관 문서 「대조 ④ · ⑤」. 주간 번호는 `ordinalWeekOf`로 확인했고 책자 표기와 같다).
    - 도착: T-2025-06-30-peter-paul, T-2025-08-25-bartholomew, T-2025-09-15-holy-cross(키프리안 `commemorated`. ①b와 같은 모양), T-2025-09-22-matthew, T-2025-12-01-andrew(①).
    - 지정 전례일: W-2025-02-02-presentation-over-sunday, W-2024-09-29-michael-over-sunday, W-2025-03-25-annunciation-lent-tuesday.
    - 선택: O-2024-01-07-epiphany(`sunday_0102_0108`은 세례 주일을 빼지 않는다), O-2024-02-04-presentation, O-2024-05-12-ascension, O-2024-11-03-all-saints, O-2025-11-02-all-saints.
    - **미결28, 31 확정(2026-09-19)으로 더해진 기대값**: T-2024-09-09-nativity-of-mary, T-2024-12-09-immaculate-conception(절기 주일에서도 옮긴다), T-2025-11-03-all-souls(격자 월요일은 `proper`로 남는다), O-2024-08-04-transfiguration, **주일 밖 충돌** T-2033-09-09-nativity-of-mary-chuseok(`transferable`은 원인을 가리지 않는다).
    - 미결33이 정해지면 2023-12-13 동계재를 사계재 ④에 더한다.

**e2e.** A1만으로는 붙일 화면이 없었다. ADR-038 A3 독서 화면 PR(#346)이 냈다(`tests/e2e/test_lectionary_view.py`).
