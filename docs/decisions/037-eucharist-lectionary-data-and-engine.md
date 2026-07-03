# ADR-037: 감사성찬례 전례독서 데이터 모델 · 교회력 계산 엔진

- 일시: 2026-07-04
- 상태: **승인됨 — 구현 대기** (구현 PR 시리즈 D1~D3 · A1)
- 관련: ADR-036(교회력 데이터 모델·본기도 — 좌표 체계·computus 기준의 권위 출처), ADR-035(절 부분집합·연속 병합 렌더 — 독서 본문 렌더 기반), ADR-010(북마크 verseSpec 문법), ADR-021(콘텐츠 해시 매니페스트·SW 캐시), ADR-013(유닛 테스트 하네스), ADR-038(캘린더·독서 뷰·검색 UI), 데이터 저장소 ADR(전례시편 DSL — D1에서 신설)

## 배경 — 이 ADR이 다루는 범위

주일/주간·축일·재일 **감사성찬례 독서**(제1독서·시편·제2독서·복음)와 본기도를 날짜별로 조회·봉독하는 기능의 **데이터 모델과 계산 엔진**을 정한다. UI(캘린더·독서 뷰·검색)는 ADR-038.

원료는 서울교구 블로그 스크랩(`common-bible-data/liturgical/` — 838 기사, `articles.json`의 `readings[]` + html 캐시의 독서 전문). ADR-036이 본기도 데이터 모델을 정했고, 그 §2에서 "독서(lectionary) 축은 별도 `eucharist-readings.json` + 교회력 엔진 소관"으로 미룬 부분을 본 ADR이 채운다.

렌더 기반은 이미 있다 — ADR-035의 `appendVerses`(절 부분집합 렌더)와 인접 연속 병합은 로드맵 메모에 "교회력 계산 결과를 입력으로 바꾸면 같은 렌더 경로를 재사용"이라고 명시해 두었다. 본 ADR은 그 입력(데이터·엔진)을 정의한다.

## 결정

### 1. `eucharist-readings.json` — 좌표 스키마 평면 배열 (데이터 저장소 `lectionary/`)

**한 레코드 = (교회력일 × 독서 트랙 × 대안 세트).** ADR-036 §1과 같은 평면 배열·자기 좌표 원칙. 본기도와 달리 **요일·주기 축 병합을 하지 않는다** — 독서는 해마다·요일마다 실제로 다르다.

```json
{
  "_meta": { "source": "seoul.anglican.kr 감사성찬례-전례독서 태그", "articles": 838 },
  "_vocab": { "…": "ADR-036 §4와 동일 + slot" },
  "entries": [
    {
      "id": "ordinary-10-sun-A-t1-s1",
      "kind": "temporal", "season": "ordinary", "week": 10,
      "type": "sunday", "weekday": null, "year": "A",
      "date": null, "lunar": null, "name": null, "aliases": null,
      "title": "연중10주",
      "reading_track": 1,
      "set_no": 1, "set_total": 1, "set_note": null,
      "readings": [
        { "slot": "first",  "bookId": "gen",  "refs": [{ "chapter": 12, "verseSpec": "1-9" }], "label": "창세 12:1-9" },
        { "slot": "psalm",  "bookId": "lps",  "refs": [{ "chapter": 33, "verseSpec": "1-12" }], "label": "시편 33:1-12" },
        { "slot": "second", "bookId": "rom",  "refs": [{ "chapter": 4, "verseSpec": "13-25" }], "label": "로마 4:13-25" },
        { "slot": "gospel", "bookId": "matt", "refs": [{ "chapter": 9, "verseSpec": "9-13,18-26" }], "label": "마태 9:9-13, 18-26" }
      ],
      "_sources": [{ "id": "26662" }]
    }
  ]
}
```

- **`id` = 좌표 기반 안정 슬러그**(재생성해도 동일). ADR-036 §10의 "잠정 순번 id를 키로 쓰지 말 것"의 해법 — 검색 결과·URL(`/lectionary/d/<slug>`)이 이 id에 착지한다.
- **`refs` 배열이 장 경계를 표현한다.** `1고린 3:18-4:5` → `[{chapter:3, verseSpec:"18-23"}, {chapter:4, verseSpec:"1-5"}]`. 열린 끝은 빌드 시 실제 장 JSON의 최대 절로 닫는다(검증 겸용). 장 경계 병합 렌더는 ADR-035 그대로.
- **`verseSpec` 문법은 북마크(ADR-010)와 완전 동일** — `"all" | "3" | "1-17" | "1-5,10-15" | "3a"`. 반절 표기 `상→a`, `하→b`. 범위 안 반절은 분해: `"46하-55"` → `"46b,47-55"`, 끝이 `"2:4상"`이면 그 장 refs가 `"1-3,4a"`.
- **대안 세트 explode**: `(또는 …)`·`또는` 인라인 대안·괄호 선택 확장(`9:35-10:8(9-23)`)이 있으면 **완전한 세트를 통째로 복제**(원본 세트 + 대안 적용 세트, `set_no`/`set_total`). 조건부 대안(`(주의 변모 주일로 지키는 경우, …)`)은 별도 세트 + `set_note`에 조건 원문. 뷰는 항상 "완전한 세트 하나"를 그리고 세트 전환은 UI 몫(ADR-038).
- **시편 슬롯**: 기본 `bookId:"lps"`(전례시편 책, §3). 송가 대체는 `canticle` id(`magnificat` 등) + lps 부록 장 참조 + `scripture_ref`(출처 성구) 병기 — 표기 시 시편 장/절 옆에 송가 명칭을 함께 쓴다(ADR-038). 시편 슬롯의 비시편 본문(다니엘·요나·토비트)은 `slot:"psalm"` 유지 + 일반 성서 bookId.
- **본기도 연결은 필드가 아니라 좌표 조인.** 같은 좌표로 `eucharist-collects` 를 ADR-036 §2·§4 폴백 규칙(weekday/year `null`=공통, 배열=포함 매치)으로 조회. 맺음구는 ADR-036 §3 개정(2026-07-04)대로 분리 저장·앱 상수 3종.
- **파일 배치: 단일 파일** `lectionary/eucharist-readings.json` (~300–400KB 예상 — `search-dc.json`보다 작고, 캘린더·독서 뷰가 전체를 쓰므로 분할 이득 없음).

### 2. 독서 문자열 파서 — `liturgical/parse_readings.py` (신규)

- ADR-036 정규화기(`normalize.py`)의 **제목→좌표 파싱을 `liturgical/coords.py`로 추출**해 본기도·독서 파서가 공유(단일 출처).
- 책 이름 → bookId 는 `book_mappings.json`의 한글 별칭 표 사용. 미커버 별칭(`사무상/하`·`열왕상/하`·`역대하`·`마카상/하` 등)은 **`aliases_ko`에 보강** — 성서 검색 `in:` 토큰도 함께 개선되는 부수 효과.
- **저녁기도·아침기도 기사는 제외**하고 별도 버킷으로 리포트(감사성찬례 아님 — Phase 4 성무일과 원료).
- 산출물: `lectionary/eucharist-readings.json` + `lectionary/search-lectionary.json`(§5) + 검증 리포트(`readings-report.txt` — 미해석 문자열 0건 목표, 모든 ref가 실존 절 범위인지 대사).

### 3. 전례시편 — 별도 책 `lps` (계응 구조, 새 마크다운 DSL)

감사성찬례용 시편은 공동번역 시편(`ps`)과 **다른 번역본**이고 **계응(선창◯/응답) 구조**를 가진다. 몇 년 전 개정본이 나왔고 스크랩본은 개정 전 본문이라, **손편집 가능한 마크다운이 정본**이어야 한다.

- 마크다운 DSL·파서(`src/liturgical_psalter.py`)·산출 스키마의 권위 출처는 **데이터 저장소 ADR**(D1에서 신설). 요점만: `liturgical/psalter/{n}.md` 편당 1파일, `[N]` 절 / 반행 = 한 줄 / `◯` 선창 끝 / `[¶]` 무번호 후속 구절 / 빈 줄 = 연. **표시용 줄바꿈은 저장하지 않는다**(의미 구조만 — 앱이 화면 폭에 맞게 자연 줄바꿈).
- 산출 `bible/lps-{n}.json`은 **기존 장 JSON 스키마와 동형** + additive 확장(`response: true` 세그먼트 = 응답 반행, `versicle: true` 절 = 무번호 구절) → `appendVerses`가 그대로 소화.
- **영광송은 파일에 저장하지 않고 앱 상수로 부착**(150회 반복 제거·단일 출처).
- `books.json`에 `{"id":"lps", "division":"liturgical", …}` append — **division 필터만으로 숨김이 성립**(책 목록 탭·검색 인덱서 모두 division 기반, 확인됨). 송가는 lps 부록 장(151+).
- 최초 생성은 1회성 `liturgical/extract_psalter.py`(html 캐시에서 추출·중복 대사, 스크랩에 없는 편은 갭 리포트). 이후 md 손편집이 정본.

### 4. 표 데이터 — 연중 주간 구간표 · 음력

- **`ordinal-weeks`**: 연중 주일·주간이 어느 날짜 사이에 오는지는 성공회 기도서의 구간표를 따른다(ADR-036 §11의 "끝에서 역산" 난점을 표 조회로 대체). **원본은 사용자가 타이핑하는 간단한 텍스트** `liturgical/ordinal-weeks.txt`(`6주: 2/11-2/17, 5/24-5/30` — 구간 2개는 쉼표), 파싱 스크립트가 `lectionary/ordinal-weeks.json`(`{week, windows:[{from,to},…]}`)으로 변환. **한 주간이 구간을 최대 2개** 가질 수 있다(공현 후 연중 / 성령강림 후 연중). 엔진은 날짜가 연중 절기 스팬 안일 때만 구간을 조회한다.
- **`kasi-lunar.json`**: 설(음 1/1)·추석(음 8/15)의 양력 날짜 lookup, 2025–2050, KASI 기준(ADR-036 §9).

### 5. 전례독서 검색 인덱스 — `lectionary/search-lectionary.json`

`parse_readings.py`가 함께 산출. 워커가 400KB 전체 readings를 파싱하는 대신 **~80KB 수치 인덱스**로 순수 비교만 한다:

```json
{ "names": [ { "id": "advent-3-sun-A", "title": "대림3주", "aliases": [], "year": "A", "label": "대림3주 (가해)" } ],
  "cov":   [ [entryIdx, bookIdx, chapter, vStart, vEnd] ],
  "books": ["gen", "…"] }
```

- 장절 질의("창세 1:3") → `cov` 스캔으로 포함하는 교회력일 목록. 이름 질의("부활") → `names` 매치(별칭 포함 — ADR-036 §2 `aliases`).

### 6. 교회력 계산 엔진 — `js/app/liturgical-engine.js` (신규, leaf)

순수 로직은 `// ── BEGIN LITURGICAL_CORE ──` 블록(ADR-013 vm 하네스 유닛 대상). DOM 없음.

- **계산 계층**: `easterDate(y)` = Anonymous Gregorian computus(Meeus/Jones/Butcher — ADR-036 §11 채택안), 파생 이동일 오프셋표(`E−46` 재의 수요일 … `E+56` 삼위일체), 대림1주일 = 12.25 직전 4번째 주일, 주일 주기 A/B/C(대림 시작 기준 3년) · 평일 I/II(홀·짝 달력년), 연중 주차 = ordinal-weeks 구간 조회(절기 우선 — 절기 스팬이 먼저 확정되고 연중 스팬에서만 표 사용), 설·추석 = kasi-lunar lookup. 날짜 연산은 로컬 `new Date(y,m,d)` + `"YYYY-MM-DD"` 문자열(UTC 오프셋 함정 회피).
- **조회 계층**: `resolveDate(dateStr)` → `{coord, candidates:[관측일…]}`. temporal 좌표 + sanctoral `date` 매치 + `lunar` 매치 + 고유명 특수일(성주간·재의 수요일 후 X요일 등 앵커 파생). **후보 관측일 집합 전체 보존**(ADR-036 §7 밀린 독서 보존) — 공식 1건 선택은 뷰의 몫.
- **후보 표시 순서**: ① 교회력에 따른 축일/재일 독서 → ② 이동 축일 독서 → ③ 나머지(연중 평일/연속) 독서. 대축일·주요축일·사계재(춘계재/하계재/추계재/동계재)에 연중 주간 독서가 전례상 사용되지 않더라도 **후보는 모두 제공**한다 — 독서자의 목적에 맞는 선택은 사용자 몫.
- `findReadings(coord)`/`findCollects(coord)` — ADR-036 §2·§4 폴백(weekday/year `null`=공통·배열=포함, 더 구체적인 레코드 우선). readings는 `reading_track`·`set_no` 별 그룹 반환.
- 데이터 로드: `/data/lectionary/*.json` lazy fetch + 모듈 캐시(`data-fetch.js` 패턴).
- **품계·이동(transfer) 엔진은 이번 범위에서 제외** — 분류 필드(rank·precedence·color)가 ADR-036 2차 보류(전부 null)라 입력이 없다. 입력 없이 규칙만 구현하면 죽은 코드 + 검증 불가. 분류 필드 2차 채움과 함께 후속 PR(ADR-036 미결9와 동기).

### 7. 파이프라인·캐시 편입

- data 저장소 `build.yml` paths·빌드 스텝에 psalter 파서·독서 파서 추가. 산출 경로는 paths 밖(자가 트리거 루프 없음 — 기존 설계 유지).
- `gen_manifests.py`가 `lectionary/*.json`을 bible-manifest 대상에 추가(lps는 `bible/*.json` glob 자동) → ADR-021 무효화 자동 편승. 앱 `sw.js cacheNameFor`에 `/data/lectionary/` → DATA_CACHE 라우팅 추가.
- pytest: `tests/test_psalter.py`(md↔JSON 라운드트립·150편 갭 allowlist), `tests/test_lectionary.py`(스키마·모든 ref 실존 절 검증·난제 스냅샷·기사↔레코드 대사).

## 검토한 대안

### 독서 데이터 정본 형태
- **A. 전용 좌표 스키마 (채택)** — 교회력 좌표·시편 대체본·본기도 조인·검색 축을 한 스키마에서 해결. 렌더는 verseSpec 재사용으로 ADR-035 경로 공유.
- **B. 북마크 export 파일 형식** — 기존 import·읽기 뷰를 그대로 쓸 수 있으나 교회력 좌표가 폴더명 문자열에 실려 검색·캘린더 링크·엔진 조회가 전부 문자열 파싱에 의존. 기각.

### 전례시편 저장
- **A. 별도 책 lps + 새 DSL (채택)** — 독서가 일반 성구처럼 `{bookId, chapter, verseSpec}`로 참조, 마크다운 손편집 = 개정본 교체 경로. 계응 구조는 기존 ADR-006 운문 형식과 달라(절 안 선창/응답 쌍 + 무번호 구절) 별도 파서가 안전(기존 parser.py 불변, 회귀 위험 0).
- **B. 독서 세트에 인라인 본문** — 같은 시편이 여러 교회력일에 중복 수록, 개정 시 전체 재생성. 기각.

### 연중 주차 산정
- **A. 기도서 구간표 조회 (채택)** — 권위 출처(기도서)와 1:1, 데이터로 검증 가능.
- **B. 왕이신 그리스도(연중34주)에서 역산** — ADR-036 §11 초안. 구현 가능하나 기도서 표와 어긋날 위험을 코드가 지게 됨. 표가 있으므로 기각.

### 검색 인덱스
- **A. 수치 cov 역인덱스 + names (채택)** — 워커에 verseSpec 파서 복제 불필요, 소용량.
- **B. 워커가 readings 전체 로드** — 파싱 로직 중복·용량 5배. 기각.

## 미결 사항

1. **맺음구 상수 3종의 선택 원칙** — 본기도의 초점(성부/성자/성령)별 배정 규칙을 성공회 기도서에서 확인 후 `ending` 코드 배정(그 전까지 기본값 1). — ADR-036 §3 개정 참조.
2. **ordinal-weeks 표 입력** — 사용자가 기도서 보고 타이핑(D3).
3. **조건부 세트 3건**(주의 변모 주일로 지키는 경우)의 캡션 표현 검토(ADR-038 `set_note`).
4. 스크랩에 없는 시편 편(갭 리포트 결과에 따라) — 사용자 타이핑 보충 여부.

## 후속 (구현 시)

- 구현 PR: D1(전례시편) → D2(독서 데이터) → D3(연중표) → A1(엔진). UI는 ADR-038 (A2~A4).
- 품계·이동 엔진 + 분류 필드 2차 + 전례색 정식(ADR-036 §6–8) — 별도 후속.
- 저녁·아침기도 기사 버킷 → Phase 4 성무일과 원료.
