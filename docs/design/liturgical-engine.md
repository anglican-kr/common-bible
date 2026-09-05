# 교회력 계산 엔진 설계 — ADR-037 A1 · B1

> 이 문서는 구현을 진행하면서 갱신한다.
> 시점 고정 결정 기록은 ADR-036(데이터 모델·우선순위·전례색) · ADR-037(독서 데이터·엔진 명세) · ADR-038(캘린더·독서 뷰 UI).

- 작성: 2026-08-08
- 상태: **설계 — 구현 대기**
- 구현 대상: `js/app/liturgical-engine.js`(신규 leaf) · `tests/unit/liturgical-engine.test.js`(신규)
- 관련 ADR: ADR-036(교회력 데이터 모델 — 좌표·품계·이동·전례색의 권위 출처), ADR-037 §6(엔진 명세 — 본 설계의 상위 문서), ADR-038(엔진을 소비하는 UI), ADR-039(전례시편 `lps`), ADR-013(유닛 테스트 하네스), ADR-012(JSDoc 타입), ADR-018·019·034(모듈 계층·ESM), ADR-021(캐시 무효화), ADR-035(절 부분집합 렌더)
- 기도서 원문 전사: [`docs/reference/liturgical-calendar-rules.md`](../reference/liturgical-calendar-rules.md)

---

## 1. 개요

### 1.1 목적

날짜 하나를 받아 **그날이 교회력에서 무슨 날인지**를 계산하고, 그 좌표로 **감사성찬례 독서와 본기도를 조회**하는 순수 로직 모듈을 만든다. ADR-037 이 D1(전례시편) · D2(독서 데이터) · D3(연중 구간표)로, ADR-036 이 D4(교회력 정의 표) · D5(품계·전례색 분류)로 데이터를 모두 갖춰 두었고, 그 데이터를 읽는 쪽이 비어 있다. 이 엔진이 그 자리다.

지금 상태를 한 줄로: **데이터는 앱에 배포되고 있지만 아무도 열어보지 않는다.**

### 1.2 범위

| 단계 | 내용 | 본 문서 |
|---|---|---|
| **A1-a 계산 계층** | 부활절 computus, 파생 이동일, 대림 앵커, 절기 스팬, 연중 주차, 주일·평일 주기, 음력 조회 | §4 |
| **A1-b 조회 계층** | 데이터 로드·캐시, 좌표 폴백 매칭, `resolveDate` 후보 집합, `findReadings`·`findCollects` | §5 |
| **B1 품계·이동** | precedence 충돌 해소, 이동 목적지 평가, 전례색 덮어쓰기, 특수 판정 | §6 |

**비범위** — UI 일체(ADR-038 A2~A4), 성무일과, 전례시편 렌더(ADR-038 A2 로 완료), `scope` 오버레이(ADR-036 B2 — 본당·교구별 등급 격상은 별도 단계).

### 1.3 상위 명세와의 관계

ADR-037 §6 이 이 모듈의 계약을 이미 정해 두었다. 본 설계가 §6 에서 **벗어나거나 더 정하는 것**은 다섯 가지이고, 각각 근거를 아래에 적었다.

1. 마커 블록을 하나(`LITURGICAL_CORE`)가 아니라 둘로 나눈다 → §3.3
2. `resolveDate` 를 async 가 아니라 **동기 함수**로 두고 프리로드를 분리한다 → §3.4
3. 데이터 파일을 **캘린더용 소형 묶음 · 독서용 대형 묶음**으로 갈라 따로 싣는다 → §3.5
4. 조회 API 의 입력이 좌표가 아니다 — `findReadings(resolved, observance)` · `findCollects(resolved)` → §5.6. 둘이 갈리는 이유도 그 절에 적었다. §6 은 `findReadings(coord)` 로 적었으나 `LiturgicalCoord` 는 절기 축만 담아 이름일·고정일·음력일로 색인된 본문에 닿지 못한다(2026-08-29 실측). ADR-037 §6 의 계약도 함께 개정했다.
5. `candidates` 의 원소가 `Observance` 가 아니라 **`Candidate` 래퍼**다 — `{observance, status, from?, to?, displacedBy?}` → §5.5 · §6.5. 옮겨온 축일을 목적지 날짜에서 내려면 「어디서 왔나」와 「왜 왔나」를 함께 실어야 하는데, `Observance` 는 정의 표의 행을 그대로 담는 공유 타입이라 엔진이 합성한 값을 거기 얹지 않는다(§5.6 이 `occurrence` 를 거절한 것과 같은 이유). ADR-037 §6 의 계약도 함께 개정했다(2026-09-05, 미결9 해소).

---

## 2. 엔진이 마주하는 데이터 현실

설계에 앞서 **데이터가 아직 못 주는 것**을 못박아 둔다. 엔진은 이것들을 예외가 아니라 정상 경로로 견뎌야 한다.

| 결손 | 실측 | 엔진의 대응 |
|---|---|---|
| ~~사계재일 4건이 날짜에 배치되지 않는다~~ **해소 (2026-08-09)** | 규칙 열을 로마 관행 준용으로 채웠다(data `05b0fc1`) — 춘계재 `easter-42` · 하계재 `easter+49` · 추계재 `09.14` · 동계재 `12.13` 를 앵커로 하는 `ember_wfs` | 엔진이 `ember_wfs` 를 **반드시 구현해야 한다**(§4.3). 규칙 하나가 날짜 셋을 낳는 유일한 종류다. 다른 이유로 `rule: null` 인 레코드가 생기면 여전히 건너뛴다 |
| ~~**교회력 격자 빈 칸 6개**~~ **해소 (2026-08-29)** | 여섯 자리(사순5주 나해 · 연중5·8주 나해 · 연중9주 가·다해 · 연중10주 다해)를 재수집 2 + 기도서 손입력 4 로 채웠다 — 독서는 2026-07-26 까지, 본기도 4건은 data `91ee123`(ADR-037 미결5). 격자 빈 칸 0칸 | **계약은 그대로 유지한다** — 지금 격자가 찼다고 `findReadings` 가 항상 결과를 준다고 가정하면 안 된다. 좌표가 없는 날(기념일·표에 없는 날)과 앞으로 생길 결손을 위해 **빈 배열 반환**을 지키고, throw 하지 않는다. 빈 배열과 "아직 안 불러옴"을 뷰가 구별할 수 있어야 한다 |
| **음력 표는 2025–2050** | `kasi-lunar.json` 26년치(2026-08-03 완료) | 범위 밖 연도는 설·추석 후보를 **생성하지 않는다**. 조용히 건너뛰되 `null` 이 아니라 빈 결과로 |
| **품계 미해소 3건 · 전례색 미해소 1건** | 맥추감사·여성선교 등급 빔, 노동자의 날은 표에 행 없음(ADR-036 미결10). 넷째였던 거룩한 이름 예수 전야는 2026-09-01 에 빠졌다 — 감사성찬례가 아니라 저녁기도라 데이터에서 제외됐다(data PR#23) | `precedence` 가 `null` 인 후보는 **정렬 최하위**로 두고 승자로 뽑지 않는다. 표에 행이 없는 날은 애초에 후보로 오르지 않는다 |
| **사계재 계절을 가리키는 기계 필드가 없다** | temporal 4행·본문 레코드 양쪽 다 `coord_name: null` · `season: null` — 계절이 한국어 `name` 안에만 있다(ADR-036 미결13 절반 해소) | 오늘의 조인은 **이름 부분문자열 + `weekday`**(§5.4). 동작은 하나 표기가 바뀌면 조용히 끊어진다 — 명시적 기계 키가 데이터 쪽 후속 과제 |
| ~~**`vigil`(전야) 개념이 모델에 없다**~~ **해소 (2026-09-01)** | 근거였던 12.31 거룩한 이름 예수 전야가 **감사성찬례가 아니었다** — 거룩한 이름 예수 축일(1.1) 전날의 **저녁기도**이고(사용자 확인), 독서 구성이 구약·시편·신약으로 **복음이 없는** 것이 그 증거였다. 성무일과로 판정해 감사성찬례 데이터에서 제외했다(data PR#23) | **엔진이 만들 것이 없다.** 전야는 모델의 빈틈이 아니라 잘못 실린 레코드였다. 성무일과는 애초에 이 데이터의 범위가 아니다 — ADR-037 이 다루는 것은 **감사성찬례** 독서·본기도다 |
| **`precedence: 7` 이 두 품계를 공유한다** | `minor_feast`(96) 와 `commemoration`(16) 이 같은 7 | 동률 tie-break 이 규정에 없다. §5.3 의 안정 정렬로 결정성만 확보하고, 실제 겹침이 나오면 규정 확인 대상(§9 미결) |
| **재의 수요일이 `transferable: false` 다** | ADR-036 §7 규칙 2 는 「재의 수요일 ∧ 설 → 재의 수요일을 뒤로」라 정했고 temporal 행의 `note` 도 그렇게 적혀 있는데, 규칙 열은 `transferable: false` · `transfer_to: null` 이다. **2032-02-11 에 실제로 겹친다**(KASI 표 범위 2025~2050 안 유일 — 2026·2029·2035·2043·2046 은 하루 차이로 비켜 간다) | 엔진은 데이터가 말하는 대로만 옮긴다 — 이 행을 코드에서 특례로 옮기지 않는다. `transferable: true` · `transfer_to: "next_day"` 로 고치는 것이 데이터 쪽 과제(§9 미결13). 고치기 전까지 2032년 재의 수요일은 설에 밀린 채 `status: "proper"` 로 남고 옮겨지지 않는다 |
| **`precedence: 3` 동률이 실제로 생긴다** | 그리스도의 성체일(temporal, easter+60)이 성모 방문(5.31)과 **2029·2040**, 성 세례 요한 탄생(6.24)과 **2038** 에 겹친다. 셋 다 주요축일 A · prec 3 · `next_day` 라 「낮은 쪽 이동」이 결정되지 않는다 | §6.2 의 잠정 tie-break(규칙일 유지 · 고정일 이동)로 결정성을 확보한다. 사제 확인 대상(§9 미결14) |
| **기념일에는 본기도·독서가 아예 없다** | `commemoration` 16건 — 전부 `sanctoral_class: null` · `has_proper: false` · `color: null` | 결손이 아니라 **설계다**(ADR-036 §6: 기념일은 근현대 인물·사건이라 본기도·독서를 두지 않는다). 엔진은 공통 폴백을 시도하지 말고 빈 결과를 반환한다 — 분류가 없으니 조회할 공통도 없다 |

**설계 원칙**: 데이터 결손은 전부 **빈 결과 + 계속 진행**으로 흡수한다. 엔진이 throw 하는 경우는 오직 ① 필수 데이터 파일 자체를 못 받았을 때 ② 프리로드 전에 동기 API 를 불렀을 때뿐이다.

---

## 3. 배치와 계층

### 3.1 모듈 위치

`js/app/liturgical-engine.js` — **leaf**. ADR-034 의 leaf 정의는 "밖으로 나가는 의존 0"이고, `data-fetch.js`·`verse-spec.js` 가 그 자리에 있다.

```
leaf     : verse-spec.js · data-fetch.js · overlay.js · [liturgical-engine.js]
view     : views.js · bookmark-read.js · [lectionary.js] · [calendar.js]
orch     : routing.js · bookmark.js
```

- **허용 의존**: 없음(계산·조회 모두 자기 완결). 독서 본문을 그리는 것은 뷰의 몫이므로 `loadChapter`·`parseVerseSpec` 도 엔진이 아니라 `lectionary.js` 가 부른다.
- **금지**: `views.js`·`routing.js`·`lectionary.js`·`calendar.js` 를 import 하면 순환이다. 뷰가 필요로 하는 훅은 역import 대신 주입한다(ADR-034 의 `initBookmarkGestures` 선례).
- **window facade 를 붙이지 않는다.** 신규 모듈은 순수 ESM(`bookmark-core.js` 선례 — window 한 줄도 없음). 레거시 호출자가 생기기 전까지 `export {}` 만.

### 3.2 파일 골격

```js
"use strict";
// @ts-check

// Liturgical calendar engine (ADR-037 §6). Leaf module: no imports, no DOM.
// Two-phase API — callers await preloadCalendar()/preloadLectionary() once,
// then the resolve/find functions are synchronous and pure over the loaded
// tables. See docs/design/liturgical-engine.md §3.4 for why.

/** @typedef {import("../types").LiturgicalCoord} LiturgicalCoord */
/** @typedef {import("../types").Observance} Observance */
/** @typedef {import("../types").ResolvedDate} ResolvedDate */

const DATA_DIR = "/data";                      // data-fetch.js does not export it

/** @type {CalendarTables | null} */
let calendarTables = null;
/** @type {Promise<CalendarTables> | null} */
let calendarPromise = null;
// … lectionary 쪽 동일 2쌍

// ── BEGIN LITURGICAL_CORE ──
// ── END LITURGICAL_CORE ──

// ── BEGIN LITURGICAL_LOOKUP ──
// ── END LITURGICAL_LOOKUP ──

// fetch 래퍼 · 프리로드 · 공개 래퍼 (블록 밖)

export { … };
```

공유 타입(`LiturgicalCoord`·`Observance`·`Candidate`·`ResolvedDate`)은 뷰·검색과 함께 쓰므로 `js/types.d.ts` 에 둔다(`BibleChapter` 선례). 엔진 내부 계산용 shape(`YearAnchors`·`TransferPass`)은 파일 안 `@typedef`.

### 3.3 마커 블록을 둘로 나눈다 (§6 에서 벗어나는 점 ①)

ADR-037 §6 은 `LITURGICAL_CORE` 블록 하나를 지정했다. 둘로 나눈다:

- **`LITURGICAL_CORE`** — 날짜 산술, computus, 오프셋 전개, 절기 스팬, 연중 주차, 주기 산정. 외부 입력이 `ordinal-weeks`·`kasi-lunar` 두 표뿐이라 prelude 스텁이 가볍다.
- **`LITURGICAL_LOOKUP`** — 좌표 폴백 매칭, 후보 집합 조립·정렬, 품계·이동·색 판정. 여기는 다섯 표를 전부 인자로 받는다.

**근거**: 한 블록에 다 넣으면 700줄짜리 슬라이스가 되고, 계산만 검증하고 싶은 테스트도 조회용 표 스텁을 전부 만들어야 한다. `verse-spec.js` 가 이미 `VERSE_SPEC` + `VERSE_SERIALIZE` 두 블록으로 같은 일을 한다. 두 블록은 같은 vm 컨텍스트에 차례로 실행할 수 있어(`bookmark-read.test.js` 가 `VERSE_SPEC` 을 먼저 실행하는 선례) 조회 테스트에서 계산 함수를 진짜로 쓸 수 있다.

블록 안 제약(ADR-013 하네스): `import`/`export` 금지, 함수는 반드시 `function` 선언(arrow `const` 는 vm 컨텍스트에서 못 꺼낸다), `document`·`window` 접근 금지, 모듈 상태 `let` 은 블록 밖에 두고 테스트가 prelude 로 재선언.

### 3.4 두 단계 API — 프리로드 후 동기 조회 (§6 에서 벗어나는 점 ②)

ADR-037 §6 은 `resolveDate(dateStr)` 만 적었다. 이를 **async 로 두지 않는다.**

```js
await preloadCalendar();          // 소형 표 5종
const day = resolveDate("2026-04-05");   // 동기 · 순수
```

**근거 셋**:

1. **캘린더 월간 뷰가 한 화면에 42칸을 그린다.** `resolveDate` 가 async 면 42개의 promise 를 조율해야 하고, ADR-038 §2 가 순수 함수로 규정한 `buildMonthGrid`·`buildWeekStrip`·`buildAgendaList` 가 async 로 오염된다.
2. **중복 fetch 가 구조적으로 사라진다.** `data-fetch.js` 의 캐시는 값 캐시라 같은 tick 에 여러 번 부르면 fetch 가 여러 번 나간다(현 코드의 알려진 한계). 42칸이 각자 로드를 시도하는 상황에서 이 한계가 그대로 드러난다. 프리로드를 분리하면 진입점이 한 곳이라 문제 자체가 성립하지 않는다.
3. **테스트가 쉬워진다.** 순수 동기 함수는 표를 인자로 넘겨 바로 검증할 수 있다.

프리로드 전에 동기 API 를 부르면 **명확한 오류를 던진다** — `throw new Error("preloadCalendar() must be awaited before resolveDate()")`. 조용히 빈 값을 주면 뷰가 "그날은 아무 날도 아님"으로 잘못 그린다.

내부적으로 프리로드는 **promise 를 캐시**한다(값이 아니라). 뷰 두 곳이 동시에 진입해도 fetch 는 한 번이다.

**실패한 promise 는 캐시하지 않는다.** `??=` 만 쓰면 일시적인 네트워크 오류로 한 번
reject 된 promise 가 영구히 남아, 사용자가 화면에 다시 들어와도 fetch 를 재시도하지
않고 같은 오류만 즉시 되던진다 — 오프라인에서 한 번 열면 온라인이 되어도 달력이 계속
깨진 채로 있는다는 뜻이다. 거부되면 캐시를 비워 다음 진입이 다시 시도하게 한다.

```js
function preloadCalendar() {
  return (calendarPromise ??= Promise.all([...])
    .then((t) => (calendarTables = t))
    .catch((e) => { calendarPromise = null; throw e; }));   // 재시도 가능하게
}
```

독서 묶음 프리로드(§3.5)도 같은 처리를 한다 — 캐시 대상이 둘이라 한쪽만 고치면
증상이 절반만 사라진다.

### 3.5 데이터를 두 묶음으로 가른다 (§6 에서 벗어나는 점 ③)

`/data/lectionary/` 전체는 약 2MB 다. 캘린더 한 달을 그리는 데 그 전부가 필요하지는 않다.

| 묶음 | 파일 | 크기 | 언제 |
|---|---|---|---|
| **캘린더** | `sanctoral` · `temporal-feasts` · `periods` · `ordinal-weeks` · `kasi-lunar` | 약 105KB | 캘린더 탭 진입 · `resolveDate` |
| **독서** | `eucharist-readings` · `eucharist-collects` · `commons` · `canticles` | 약 1.6MB | 독서 뷰 진입 · `findReadings`/`findCollects` |
| **지역** | `local-observances` | 약 91KB | ADR-036 B2 `scope` 오버레이 (이번 범위 밖) |

**근거**: 캘린더는 "그날이 무슨 날인가 + 무슨 색인가"만 필요하고 그건 정의 표에서 나온다. 1.2MB 짜리 독서 파일을 달력 열 때마다 받게 하면 첫 진입이 느려지고, 오프라인 캐시 예열도 필요 이상으로 커진다. 독서 뷰로 들어가는 순간에만 큰 묶음을 싣는다.

`local-observances.json` 은 B2 전까지 아예 싣지 않는다 — 본당·교구 오버레이가 없으면 쓸 데가 없다.

### 3.6 등록 세 곳 (빠뜨리면 런타임에서 깨진다)

1. **`index.html`** — `<script type="module" src="/js/app/liturgical-engine.js">` 를 **의존 순서대로 수동 나열**하는 목록에 추가. `views.js` 앞, `data-fetch.js` 부근(같은 leaf 계층).
2. **`sw.js` 셸 캐시 목록** — 새 JS 파일을 프리캐시 대상에 추가. 빠뜨리면 `tests/unit/sw.test.js` 가 잡는다 — `<script>` 태그 패리티에 더해 ESM `import` 닫힘까지 대조한다(#319).
3. **`sw.js` `cacheNameFor()`** — ~~현재 `/data/lectionary/` 라우팅이 없다.~~ **PR0 로 완료 (2026-09-01, #319).** ADR-037 §7 과 ADR-038 §5 가 요구하는 `/data/lectionary/` → `DATA_CACHE` 한 줄이 빠져 있어 전례 JSON 11건이 `SHELL_CACHE` 에 앉아 콘텐츠 해시 무효화를 못 받고 있었다. 이제 라우팅이 있고, `sw.test.js` 가 「매니페스트가 추적하는 접두사는 전부 `DATA_CACHE` 로 간다」를 대조하므로 새 데이터 디렉터리를 매니페스트에 넣고 라우팅을 빠뜨리면 테스트가 잡는다. **엔진 PR 이 여기서 할 일은 없다.**

---

## 4. A1-a 계산 계층

모든 날짜는 로컬 `new Date(y, m - 1, d)` 와 `"YYYY-MM-DD"` 문자열로 다룬다. **`toISOString()` 으로 날짜 문자열을 만들지 않는다** — UTC 오프셋 때문에 KST 에서 하루 어긋난다(ADR-037 §6 이 명시적으로 지시). 포맷은 `padStart(2, "0")` 수동 조립(`bookmark-menu.js` 선례).

### 4.1 날짜 유틸

저장소에 날짜 유틸 공용 모듈이 없다. 엔진이 첫 소유자가 된다 — 전부 `LITURGICAL_CORE` 안의 순수 함수로.

| 함수 | 역할 |
|---|---|
| `parseDate(s)` | `"YYYY-MM-DD"` → `{y, m, d}`. 형식이 틀리면 `null`(throw 아님 — `search.js:199` 선례) |
| `toKey(y, m, d)` | → `"YYYY-MM-DD"` |
| `addDays(s, n)` | 날짜 문자열 덧셈 |
| `dayOfWeek(s)` | 0(일)~6(토) |
| `dayOfYear(s)` | 1~366. **윤년의 2/29 를 센다** — 연중 주차 `doy` 앵커가 이 정의를 전제 |
| `nearestSunday(s)` · `firstSundayAfter(s)` · `lastSundayBefore(s)` · `nthSunday(y, m, n)` | 이동 규칙 평가용 |

### 4.2 부활절 computus

**Anonymous Gregorian algorithm(Meeus/Jones/Butcher)**, 정수 연산 15줄(ADR-036 §11 채택). 서방 그레고리력 — 정교회 율리우스력 computus 가 아니다.

교회력 부활절은 **천문값이 아니다**. 교회력 춘분을 3월 21일로 고정하고 교회 보름표(epact)를 쓰므로 천문 계산과 어긋나는 해가 있다. 닫힌 산식이라 재구현이 안전하고 외부 데이터가 0 이다.

`easterDate(y)` → `"YYYY-MM-DD"`. 연도별 캐시(§4.9).

### 4.3 부활절 기준 오프셋

데이터의 `rule` 이 이미 `{kind: "easter_offset", days: -46}` 형태로 풀려 있다(ADR-036 개정①이 "빌드 시 1회 구조화"로 정한 결과, `temporal-feasts.json` 실측 확인). **엔진은 문법을 다시 파싱하지 않고 `rule.kind` 로만 분기한다.**

`easter_offset` 레코드는 실측 **12건**이다.

| 날 | 오프셋 |
|---|---|
| 주의 변모 주일 | E − 49 |
| 재의 수요일 | E − 46 |
| 성지(고난)주일 | E − 7 |
| 성 목요일 · 성 금요일 | E − 3 · E − 2 |
| 성 토요일 · **부활밤** | **둘 다 E − 1** |
| 부활대축일 | E + 0 |
| 승천 | E + 39 (목요일) |
| 성령강림 | E + 49 |
| 성삼위일체 | E + 56 |
| 그리스도의 성체 | E + 60 |

두 가지를 구별해 둘 것:

- **성 토요일과 부활밤이 같은 오프셋(E−1)을 갖는다.** `easter_offset → 레코드` 인덱스도 1:N 이어야 한다.
- **사순 1주일(E−42)은 이 표에 없다.** ADR-036 §11 이 오프셋으로 서술했지만 데이터에서는 이름 있는 이동 축일이 아니라 **격자 좌표**(`season: lent, week: 1, type: sunday`)다. 사순 스팬이 확정되면 주차로 나오므로 규칙이 필요 없다. 격자로 나오는 날을 규칙 표에 중복 등록하면 후보가 두 번 오른다.

**나머지 규칙 종류**(실측 `_meta.rule_kinds` **7종** — 2026-08-09 에 `ember_wfs` 가 더해졌다):

| `rule.kind` | 건수 | 부속 필드 | 예 |
|---|---|---|---|
| `easter_offset` | 12 | `days` | 위 표 |
| `nth_sunday` | 4 | `month`, `nth` | 가정주일 5월 2번째 · 추수감사 11월 3번째 |
| `first_sunday_after` | 1 | `month`, `day` | 주님의 세례 = 1.6 **이후** 첫 주일(엄격히 이후) |
| `nearest_sunday` | 1 | `month`, `day` | 대림 1주일 = 11.30 최근접 |
| `advent1_offset` | 1 | `days` | 왕이신 그리스도 = 대림1 − 7 |
| `last_sunday_before` | 1 | `month`, `day` | 평화통일주일 = 8.15 직전 주일 |
| **`ember_wfs`** | **4** | `anchor` (`easter_offset` 또는 `date`) | 사계재 — 2026-08-09 입력 |
| `date` | 0 | — | `_vocab` 에만 있고 미사용 |

`rule` 자체가 `null` 이면 **건너뛴다**(현재 해당 레코드 없음).

#### `ember_wfs` — 규칙 하나가 날짜 셋을 낳는다

다른 규칙은 전부 `규칙 1개 → 날짜 1개`인데 사계재만 다르다. **앵커 다음의 수·금·토 사흘**을 만든다.

```
춘계재  anchor = easter − 42 (사순 1주일)      → 그 주의 수·금·토
하계재  anchor = easter + 49 (성령강림)        → 그 주의 수·금·토
추계재  anchor = 09.14 (성 십자가)             → 다음 수·금·토
동계재  anchor = 12.13 (성 루시아)             → 다음 수·금·토
```

기준은 **로마 관행 준용**(사용자 확인 2026-08-09) — 표의 비고에 적혀 있던 통례와 같다.

구현 주의 둘:

1. **"다음"은 엄격히 이후다.** 앵커가 이미 수요일이면 그날이 아니라 **다음 주 수요일**부터 센다. `first_sunday_after` 가 "엄격히 이후"인 것과 같은 규약이다.
2. **한 레코드가 후보 셋을 낳으므로 요일로 갈라야 한다.** 독서·본기도는 사계재를 **지향(志向)별**로 나눠 두었고(「성직자의 성소를 위한 …계재」 등, 계절이 아니라 지향이 축이다) 계절은 본문을 가르지 않는다 — 지향 4종이 곧 본문 4종이다.

   **2026-08-29(data PR#17)로 요일 배정이 닫혔다.** 정본이 `calendar/ember.md` 한 곳으로 모이고 파서가 계절 × 요일로 펴면서 **16건 전부 `weekday` 를 갖는다**(종전 6건). 배정은 네 계절 공통 — **수=성직자 · 금=성직후보자·수도자(2본) · 토=모든 신자**.

   **다만 계절을 가리키는 기계 필드는 아직 없다.** 실측: 본문 레코드는 `season: null`(춘계재만 `lent`/`week 1` 인데 이건 *전례* 절기지 사계재 계절이 아니다) · `coord_name` 필드 자체가 없고, temporal 쪽 4행도 `coord_name: null` 이다. 사계재 계절은 **한국어 `name` 안에만 있다** — temporal `"하계재"`, 본문 `"성직자의 성소를 위한 하계재 수요일"`.

   → **오늘 가능한 조인은 이름 부분문자열뿐이다**: temporal 행의 `name` 이 본문 레코드의 `name` 에 포함되는가 + `weekday` 일치. 네 계절 이름이 서로의 부분문자열이 아니므로 동작은 하지만, 이름 표기가 바뀌면 조용히 끊어진다. **명시적 기계 키(양쪽에 `ember_season` 같은 필드)가 후속 과제다** — §9 미결5.

   금요일은 **후보가 둘**(성직후보자·수도자)이므로 하나를 고르지 말고 둘 다 낸다.

### 4.4 대림 앵커

**대림 1주일 = 11월 30일에 가장 가까운 주일** = 성탄일 전 네 번째 주일(ADR-036 §11). 세 표현은 동치다.

`advent1Date(y)` → 그해 **전례년 시작**. 왕이신 그리스도 주일 = `advent1 − 7`(연중 34주일).

**전례년 경계 주의**: 경계는 **달이 아니라 `advent1Date(y)` 그 날**이다. 대림1주일은 **11.27~12.03** 사이에 온다(1900~2100 실측: 각 날짜가 28~29회씩 고르게). 「12월부터 새 전례년」으로 잡으면 12월 1~2일을 **어떤 해에만 틀리게** 넣는다 — 2023-12-01 은 아직 전년 전례년(그해 대림1주일이 12.03)이고 2024-12-01 은 새 전례년이다. 매년 틀리면 금방 드러나는데 이건 해마다 갈려서 오래 숨는다. 반드시 `date >= advent1Date(y)` 로 비교할 것. 1월 1일의 전례년은 **전년도** 대림에 시작한 것이다. `liturgicalYearOf(dateStr)` 를 따로 두고 주일 주기 산정이 이 함수만 보게 한다.

### 4.5 절기 스팬 — 먼저 확정하고, 남는 자리가 연중

`season` 도메인은 **다섯**이다: `advent` · `christmas` · `ordinary` · `lent` · `easter`. **`epiphany` 는 없다**(ADR-036 §4 개정 2026-07-17에서 제거). 공현일(1.6)은 성탄절기 안의 sanctoral 대축일일 뿐이다.

| 절기 | 스팬 |
|---|---|
| `advent` | 대림 1주일 ~ 12.24 |
| `christmas` | 12.25 ~ **주의 세례 주일(공현 후 첫 주일) 포함** |
| `lent` | 재의 수요일 ~ 부활 전날 (마지막 한 주간이 성주간) |
| `easter` | 부활주일 ~ 성령강림주일 (50일) |
| `ordinary` | 나머지 전부 — ① 주의 세례 다음날 ~ 재의 수요일 전, ② 성령강림 다음 주간 ~ 대림 1주일 전 |

**주의 세례 주일의 이중 좌표**: `season: "christmas"` 이면서 동시에 **연중 1주일**이다(ADR-036 §2 "'주님의 세례 / 연중1주'는 별칭이 아니라 좌표"). 연중 주차 표의 공현 후 구간이 "세례주일을 1주로 두고 앞으로 센다"를 전제하므로, 이 날은 두 축에 모두 등록해야 한다.

판정 순서: **절기 스팬을 먼저 확정**하고, 어느 스팬에도 안 들면 `ordinary` + 구간표 조회. 연중 스팬 밖에서는 표를 보지 않는다.

### 4.6 연중 주차 — `anchor` 와 윤년 함정

`ordinal-weeks.json` 은 `{_meta, weeks}` 이고 `weeks[]` 원소가 `{week, windows: [{from, to, anchor}]}` 다. 34주 · 구간 38개. 실측 분포: **6~9주만 구간이 둘**(`doy` + `date`), 1~5주는 `doy` 하나, 10~34주는 `date` 하나. 구간 폭은 전부 7일이고 **9주의 `doy` 구간만 4일**(`03-04`~`03-07`)이다 — 사순이 시작되며 잘리는 자리다.

구간의 의미는 "**그 주간의 주일이 떨어지는 범위**"다. 평일은 자기 날짜로 찾지 않고 **그 주의 주일로 조회**한다.

| 구간 | `anchor` | 조회 |
|---|---|---|
| 공현 후 (1~9주) | `doy` | **연중 일수**로 맞춘다(2/29를 셈) |
| 성령강림 후 (6~34주) | `date` | **월/일 그대로** 맞춘다 |

**왜 갈리는가 (ADR-037 §4 개정 2026-07-13)**: 표의 구간은 1/7부터 7일씩 끊은 블록이라 **2월이 28일일 때만** 맞아떨어진다. 윤년에는 2/29 가 3월을 하루 밀어 8주 구간(2/25–3/3)이 8일이 되고, **2052년(부활절 4/21)에는 2/25 와 3/3 이 둘 다 그 구간에 든다**. 정답은 3/3 = **9주**(세례주일부터 세면 아홉 번째 주일)이고, 9주 구간(3/4–3/7)은 그해 빈 채로 남는다. 뒤 구간은 7일 날짜 블록이 항상 주일을 정확히 하나 품으므로 날짜 조회만으로 윤년에 안전하다.

**이 두 줄이 엔진에서 가장 틀리기 쉬운 자리다.** 2052년을 회귀 테스트로 못박는다(§7).

산정 방식이 **표 조회**임에 주의 — ADR-036 §11 의 "왕이신 그리스도(34주)에서 역산"은 ADR-037 이 B안으로 **기각**했다("기도서 표와 어긋날 위험을 코드가 지게 됨"). 구현자는 ADR-037 을 따른다.

### 4.7 주기 산정

- **주일 A/B/C** — **대림 시작 기준 3년 주기**. 달력년이 아니라 전례년(§4.4)에 걸린다.

  **기준 연도: 2026년 = 가해(A)**(사용자 확정 2026-08-29). 여기서 전체 주기가 결정된다 —
  전례년을 **그 해가 끝나는 달력년** `N` 으로 부르면 `N % 3` 이 **1 → A · 2 → B · 0 → C** 다.
  (2025 다해 · 2026 가해 · 2027 나해 · 2028 다해 …)

  경계는 1월 1일이 아니라 **대림1주일**이다. 실제 날짜로:

  | 날짜 | 주기 |
  |---|---|
  | 2025-11-29 (토) | 다해(2025) 마지막 |
  | 2025-11-30 (일, 대림1주일) | **가해(2026) 시작** |
  | 2026-11-28 (토) | 가해(2026) 마지막 |
  | 2026-11-29 (일, 대림1주일) | **나해(2027) 시작** |

  이 네 날은 회귀 테스트에 그대로 넣는다 — 오프셋이 하나 틀려도 예외 없이 다른 해 본문이
  나오므로, 경계에서 값이 바뀌는지를 직접 못 박아야 한다.
- **평일 I/II** — **홀·짝 달력년** 2년 주기.

두 축의 기준이 서로 다르다(ADR-037 §6 원문 그대로). 12월 대림 이후 날짜에서 주일 주기는 이미 넘어갔는데 평일 주기는 아직 안 넘어간 구간이 생긴다 — 의도된 동작이다.

연중 평일만 `I/II` 를 갖고, 그 밖 절기 평일·축일·재일은 대체로 `null`.

### 4.8 음력

`kasi-lunar.json` 은 `{_meta, years}` 이고 `years` 는 **문자열 연도 키 → `{"1-1": "MM-DD", "8-15": "MM-DD"}`** 2키 고정 맵이다(`_meta.range: [2025, 2050]`, `complete: true`, 결측 0). 성인력 레코드는 `date: null` + `lunar: "1-1"`(설) / `"8-15"`(추석)이고, 엔진이 `lunar` 를 보면 표에서 그해 양력 날짜를 끌어온다. `lunar` 값이 `years` 의 내부 키와 **문자 그대로 일치**하므로 변환 없이 조인된다 — 다만 표의 값은 `MM-DD` 하이픈이라 `MM.DD` 계열과 비교하려면 정규화가 필요하다(§5.2).

천문 계산을 내장하지 않는다. 한국 음력은 중국 농력과 기준 자오선이 달라(KST 135°E vs 베이징 120°E) 드물게 하루 어긋나므로 **반드시 KASI 표**여야 한다(ADR-036 §9).

### 4.9 연도 캐시

한 해의 부활절·대림 앵커·이동 축일 날짜는 **연도당 한 번만** 계산한다.

```js
/** @type {Map<number, YearAnchors>} */
const yearCache = new Map();
// { easter, advent1, movable: Map<"MM-DD", Observance[]>, transfers: TransferPass }
// TransferPass = {
//   arrivals:   Map<"YYYY-MM-DD", Candidate[]>,   // transferred_in — 옮겨 와서 이 날 지키는 것
//   departures: Map<"YYYY-MM-DD", Candidate[]>,   // transferred_out — 이 날을 떠난 것 (고유였든 도착했든)
//   optionals:  Map<"YYYY-MM-DD", Candidate[]>,   // optional — 선택 봉헌 목적지 주일 (§6.2)
//   defects:    string[],                          // 연쇄 상한을 넘긴 축일 (§6.5) — 개발 빌드 표시용
// }
```

캘린더 월간 뷰가 42칸을 그리며 `resolveDate` 를 42번 불러도 computus 는 최대 두 번(달 경계에서 두 해가 걸릴 때) 돈다. 캐시는 순수 파생값이라 무효화가 필요 없다.

`transfers` 는 §6.5 이동 패스의 결과다 — 그해 안에서 옮겨간 축일이 **어디에 도착했고 어디서 떠났는지**의 색인. PR 2 까지는 빈 패스이고 PR 3 이 채운다(§8). **캐시 항목은 언제나 완전한 패스**다 — `Y` 의 항목은 `Y−1` 12월에서 넘어온 spill 을 seed 로 받아 만든다(§6.5 연도 경계). 그 seed 를 얻기 위한 `Y−1` 의 **seed 없는 임시 패스는 캐시에 넣지 않는다** — `Y−1` 항목이 따로 필요해지면 그때 `Y−2` spill 로 완전하게 만든다. 임시 패스는 `Y−1` 의 앵커(computus)만 쓰므로 그 앵커는 캐시에 남고, 두 패스의 12월 결과는 같다(spill 은 1월 초에만 닿는다).

---

## 5. A1-b 조회 계층

### 5.1 좌표

좌표를 이루는 축과 도메인(ADR-036 §1·§4):

| 축 | 도메인 |
|---|---|
| `season` | `advent` `christmas` `ordinary` `lent` `easter` |
| `week` | 정수 또는 `null` (**문자열 `"1주"` 금지** — 사전순 정렬·범위 질의 함정) |
| `type` | `sunday` `weekday` `feast` `fast` |
| `weekday` | `null`(그 주 평일 공통) · 단일 코드 · 코드 배열. 코드는 `mon`~`sat`(**일요일 코드 없음** — 주일은 `type: sunday`) |
| `year` | `null`(전 주기 공통) · 단일 코드 · 코드 배열. `A/B/C`(주일) · `I/II`(연중 평일) |

### 5.2 실측 스키마 — 엔진이 방어해야 할 표기 불일치

<!-- 아래 `facts` 블록은 tests/unit/docs-data-consistency.test.js 가 data/lectionary/ 와
     기계적으로 대조한다. **숫자를 손으로 맞추지 말 것** — 데이터가 바뀌면 테스트가 먼저
     알려주고, 그때 이 블록만 고치면 된다. 본문 산문이 같은 수치를 되풀이할 때는 여기를
     정답으로 삼는다(수치가 여러 곳에 흩어져 서로 어긋나던 것이 2026-08-29 정합성 점검의
     주된 원인이었다). 날짜가 박힌 로그 항목의 옛 수치는 대상이 아니다 — 그건 그때의 기록이다. -->

```facts
collects.total                 = 327
collects.id.max                = 327
collects.ending.A              = 317
collects.ending.B              = 0
collects.ending.C              = 10
collects.review                = 0
collects.note                  = 1
collects.rank_null             = 3
collects.color_null            = 1
collects.collect_total_gt1     = 34
readings.total                 = 922
readings.set_no.1              = 840
readings.set_no.2              = 81
readings.set_no.3              = 1
readings.set_total_gt1         = 163
readings.slot.first            = 922
readings.slot.psalm            = 922
readings.slot.second           = 383
readings.slot.gospel           = 922
readings.reading_track_nonnull = 175
readings.weekday_null          = 392
sanctoral.total                = 149
sanctoral.has_proper           = 52
sanctoral.commemoration        = 16
sanctoral.minor_feast          = 96
temporal.total                 = 24
temporal.rule_kinds            = 7
temporal.easter_offset         = 12
temporal.ember_wfs             = 4
temporal.rule_null             = 0
commons.classes                = 8
commons.reading_sets           = 22
ordinal_weeks.weeks            = 34
ordinal_weeks.windows          = 38
```


ADR 이 정한 모델과 실제 JSON 사이에 **엔진이 흡수해야 하는 차이**가 있다. 아래는 2026-08-08 전수 집계로 확인한 것이다.

**모든 파일이 객체 래퍼를 쓴다.** 배열 최상위는 하나도 없다.

| 파일 | 래퍼 |
|---|---|
| sanctoral · temporal-feasts · eucharist-readings · eucharist-collects | `{_meta, _vocab, entries}` |
| periods | `{_meta, entries}` |
| ordinal-weeks | `{_meta, weeks}` |
| kasi-lunar | `{_meta, years}` |
| commons | `{_meta, _vocab, classes}` (배열이 아니라 **맵**) |
| local-observances | `{_meta, _vocab, dioceses, parishes}` |
| canticles | `_meta` 조차 없는 순수 **id→객체 맵** |

**날짜 표기가 세 가지 섞여 있다.** 이것이 이 계층에서 가장 조용히 깨지는 자리다.

| 표기 | 쓰는 곳 |
|---|---|
| `MM.DD` (점) | `sanctoral.date` · `periods.from`/`to` · `readings`/`collects` 의 `date` |
| `MM-DD` (하이픈) | `ordinal-weeks` 의 `from`/`to` · `kasi-lunar` 의 값 |
| `M-D` (하이픈, 0 채움 없음) | `lunar` 필드의 값과 `kasi-lunar.years[y]` 의 키 |

→ **내부 표준을 하나 정하고 로드 시점에 정규화한다.** 비교 함수마다 표기를 분기하면 반드시 한 곳을 빠뜨린다.

그 밖에 못박아 둘 실측:

- **`id` 타입이 파일마다 다르다** — readings 는 문자열(`ordinary-9-sun-A-t1-s1`), collects 는 **정수**(1~327). 동점 정렬 키로 쓸 때 숫자·문자 비교를 섞지 않는다.
- **readings 의 `id` 접미 `-t1-` 을 트랙으로 읽으면 안 된다** — `reading_track: null` 인 745건에도 관례적으로 `t1` 이 붙어 있다. 트랙은 반드시 필드로 판정한다.
- **같은 `date` 에 여러 성인이 있다** — 13개 날짜가 2~3건씩(12.25 는 3건). `easter_offset: -1` 도 성 토요일·부활밤 2건이다. 날짜 인덱스는 **1:N Map** 이어야 한다.
- **`weekday`·`year`·`color_alt` 는 `null | 스칼라 | 배열` 3형이고 배열은 collects 에만 있다.** 원소가 하나인 배열(`["mon"]`)도 실제로 존재하므로 `typeof === "string"` 분기만으로는 틀린다 — `Array.isArray` → `includes`, `null` → 무조건 매치, 스칼라 → 등호 세 갈래가 모두 필요하다.
- **`penitential: true` 는 사계재 4건에만 있고 다른 레코드에는 키 자체가 없다.** 소재일 판정에서 `record.penitential === true` 로 읽어야 한다.
- **`ending` 은 A 317 · C 10 · B 0**(2026-09-01) — ADR-037 미결1(송영 A/B 구분 규정)이 데이터로도 미해결임이 확인된다.
- **`_review` 는 이제 0 건이다**(2026-08-29, data PR#17) — 21건을 전수 판별해 10건은 교정하고 나머지는 규칙으로 판정했다. 대신 **`_note` 가 1건**에 붙는다(부활6주 금·토: 승천대축일 본기도를 쓴다는 표시). 둘 다 사람이 읽는 메모라 엔진은 무시하고 통과시키되, `_review` 가 다시 나타나면 그 본문은 기도서 대조 전이라는 뜻이다.

### 5.3 폴백 매칭 — 구체성 점수

ADR-036 §4 의 규칙: `weekday`·`year` 두 필드가 **`null | 코드 | 코드 배열`** 로 동형이고, **더 구체적인 레코드가 우선**한다.

이를 점수로 구현한다. 각 축마다:

| 레코드 값 | 요청과의 관계 | 점수 |
|---|---|---|
| 단일 코드, 일치 | 가장 구체적 | 2 |
| 배열, 포함 | 중간 | 1 |
| `null` | 공통 | 0 |
| 그 밖 | 불일치 | **탈락** |

`season`·`week`·`type` 은 정확히 일치해야 한다(폴백 없음).

**총점이 높은 레코드가 이기되, 이기는 것은 「한 건」이 아니라 「한 층」이다.** 최고점 레코드를 **전부** 남기고 그 다음에 그룹으로 묶는다 — 같은 좌표에 **의도적으로 공존하는** 레코드가 있기 때문이다: 자유선택 대체 본기도(`collect_no`, 실측 34 엔트리)와 독서의 `set_no`·`reading_track` 세트(실측 `set_total > 1` 163건). 이들은 `weekday`·`year` 가 동일해 점수도 같으므로, 최고점에서 하나만 골라내면 §5.6 과 ADR-036 §2 의 반환 계약이 깨진다 — 뷰가 택1 탭으로 보여야 할 두 본기도 중 하나가 사라진다.

즉 순서는 **① 불일치 탈락 → ② 최고점 층만 남김 → ③ `collect_no` / (`reading_track`, `set_no`) 로 그룹화 → ④ 그룹 안에서 안정 정렬**이다.

```js
function matchScore(record, coord) { … }   // -1 = 불일치
```

**동점 처리를 반드시 결정해 둔다.** 위 ②에서 남은 동점은 **대부분 정상**이다(대체안·세트). 그룹이 갈린 뒤에도 같은 그룹 안에 동점이 남으면 그때가 데이터 결함 의심이다. 어느 경우든 배열 순서에 기대지 않고 **레코드 `id` 순**으로 안정 정렬한다(문자열은 사전순, 정수는 수치순 — §5.2 의 타입 차이). 정렬이 입력 순서에 의존하면 데이터 저장소가 재빌드할 때마다 결과가 흔들린다.

**왜 이런 폴백이 필요한가**: 한 주의 평일 본기도는 대개 하나이므로, 이름 없는 격자 평일은 `(season, week)` 단위로 모아 요일·주기를 가로질러 병합해 두었다(ADR-036 §2 개정). 실측으로 확인된 병합 사례:

- `사순3주` — 가·다해가 같고 나해만 달라 `year: ["A","C"]` 레코드 하나와 `year: "B"` 레코드 하나. **`year` 배열은 전 데이터에 이 1건뿐이다.**
- `부활6주` — `weekday: ["mon","tue","wed","thu"]` 와 `weekday: ["fri","sat"]` 로 갈린다. 이 경계가 **승천일**이다(승천 후 성령강림 전까지는 승천 본기도를 쓴다). ADR-036 §2 가 든 근거 사례가 데이터에 그대로 있다.
- `연중12주`·`연중21주` — 요일 구간이 갈리고 한쪽만 `year` 를 가진다.

같은 `(season, week)` 안에 **`weekday: null` 레코드와 배열 레코드가 공존**한다(연중3주: `weekday: null, year: null` 과 `weekday: ["mon"], year: "II"`). 구체성 우선 규칙이 없으면 그날 본기도가 뒤바뀐다 — 이 규칙은 선택이 아니다.

**중요한 예외 — `weekday: null` 이 항상 "그 주 평일 공통"을 뜻하지는 않는다.** 앞서 이 문서는 "독서 쪽에서 `null` 이 나올 일은 없다"고 적었으나 **실측이 이를 반증했다**: readings 의 `weekday` 는 **393건**이 `null` 이다(2026-08-29 실측). 다만 그 `null` 들은 폴백이 아니라 **고유명 날짜**다.

```
temporal-lent-성-토요일-t1-s1   name="성 토요일"    weekday=null  week=null
d1217-성탄-8일-전-t1-s1          name="성탄 8일 전"  weekday=null  date="12.17"
d1230-성탄주간-t1-s1             name="성탄주간"     weekday=null  date="12.30"
```

→ **판정 규칙**: `name` 또는 `date` 가 채워진 레코드는 폴백 해석을 하지 않고 **이름·날짜 조인 경로**로 보낸다(§5.4). `weekday: null` 을 무조건 "그 주 전체 공통"으로 읽으면 성 토요일 독서가 성주간 평일 전체에 퍼진다.

참고로 `성탄주간` 은 같은 `name` 에 **다른 `date`** 로 11개 날짜(12.30·12.31·1.3~1.5·1.7~1.12)에 복제돼 있다. 이름은 키가 아니고 날짜가 키다.

### 5.4 조인 전략 — 좌표가 정본, 이름은 보조

**본기도는 필드 참조가 아니라 좌표 조인이다** — readings 레코드에 collect 참조 필드가 없다. 같은 좌표로 `eucharist-collects` 를 §5.3 규칙으로 따로 조회한다(ADR-037 §1). 두 파일의 `id` 는 서로 무관하고(문자열 vs 정수) `reading_track` 은 collects 가 전부 `null` 이므로 **트랙 축은 readings 에서만 결정된다.**

정의 표(sanctoral·temporal-feasts)와 본문 표(readings·collects)를 잇는 키는 실측으로 갈렸다.

| 방향 | 키 | 근거 |
|---|---|---|
| **sanctoral ↔ readings/collects** | **`date`(`MM.DD`) + `lunar`** | 고유 본기도 52건 중 날짜 조인은 **본기도 52/52 · 독서 51/52 성공**(`date` 50 + `lunar` 2), 이름 조인은 35건만 성공. 독서에서 빠지는 하나는 프란시스 사베리오(12.03) — **고유 본기도 + 공통 독서**라 고유 독서가 없는 게 맞다(articles-supplement 의 `readings: null` 케이스). **다만 그것만으로는 이 날 독서를 못 찾는다** — `commons.json` 은 분류별 독서를 갖고 있는데(7분류 22세트, 사베리오의 `missionary` 는 3세트) §5.6 이 `findCollects` 폴백만 정의하고 `sanctoral_class` 기반 **`findReadings` 폴백을 정의하지 않았다**. 데이터는 있고 조회 규칙이 없는 자리다 → §9 미결11. `lunar` 를 빼고 `date` 만으로 맞추면 설날·추석이 떨어져 나간다 |
| **temporal-feasts ↔ readings/collects** | **`coord_name` ↔ `name`**(`aliases` 도 키) | 정의 표가 조인용 이름 필드를 따로 들고 있다. 24건 중 `coord_name: null` 7건(대림1주일·가정주일·평화통일주일·사계재 4)은 이름 조인 대상이 아니다 — 대림1주일은 격자 좌표(`advent-1-sun-*`)로만 조회된다 |
| local-observances → commons | `dedication.common` / `observance.common` → `classes[키]` | 문자열 직접 참조 |
| local-observances → sanctoral | `patron_refs[].sanctoral_id` | 51건 전부 유효한 id 참조 |
| readings → canticles | `readings[].canticle` → `canticles[키]` | 5종(`magnificat` `benedictus` `ecce-deus` `benedicite` `te-deum`) |

**이름 조인이 왜 못 미더운가** — 같은 날인데 표기가 다르다.

| `sanctoral.name` | `collects.name` |
|---|---|
| `바실(주교, 379년)과 나지안조의 그레고리(주교, 389년)` | `바실과 나지안조의 그레고리` |
| `주의 봉헌` | `주의 봉헌 축일` |
| `성 세례 요한 탄생` | `성 세례요한 탄생 축일` |
| `성 미카엘과 모든 천사들` · `대한성공회 설립 기념일` (별개 2건) | `성 미카엘과 모든 천사들 / 대한성공회 설립 기념일` (슬래시로 합친 1건) |

**날짜 조인은 outer join 이어야 한다.** readings·collects 의 `date` 중 16개(12.17~12.24·12.30·1.3~1.12 일부)는 sanctoral 에 대응 행이 없다 — `성탄 8일 전`·`성탄주간` 처럼 **본문 표만 아는 날짜 좌표**다. 즉 그 `date` 는 "성인력 참조"가 아니라 **자기 좌표**이며, 성인력에 없다고 버리면 성탄 후 열이틀의 독서가 사라진다.

**그런데 날짜 인덱스는 1:N 이고, 그 N 을 좁히는 규칙이 아직 없다.** `findReadings(resolved, observance)` 는 **고른 관측일 하나**의 본문을 내야 하는데 `date` 만으로는 그 날의 본문 전부가 나온다. 성인력에 두 행 이상인 날짜가 **13개**이고(2026-09-01 실측), 12.25 는 세 행(성탄 낮·밤·새벽) × 본문 6레코드다 — 낮을 물었는데 밤이 섞여 나오면 그건 결손이 아니라 **오답**이다. `name`·`aliases` 로 좁히는 것이 자연스러우나 그 이름 조인이 못 미더운 것은 바로 위 표가 말한 그대로다. 규칙과 잔여를 §9 미결12 에 못박았다.

**권장 인덱스** (프리로드 시 1회 구축):

1. `sanctoral`: `date → Entry[]`, `lunar → Entry[]` (둘 다 1:N)
2. `temporal-feasts`: `rule.kind → Entry[]`, `coord_name → Entry`
3. `readings`/`collects`: `date → Entry[]`, `(season, week, type) → Entry[]`, `name → Entry[]`
4. `ordinal-weeks`: **`doy` 인덱스와 `date` 인덱스를 분리** 구축(anchor 별로 비교 방식이 다르므로)

### 5.5 `resolveDate` — 후보 집합을 전부 보존한다

```js
/** @returns {ResolvedDate} */
function resolveDate(dateStr) → {
  date, coord,                 // 격자 좌표 (temporal)
  candidates: Candidate[],     // 그날 지킬 수 있는 관측일 전부 — 옮겨온 것 포함
  official: Candidate | null,  // 승자 (B1 — PR 3 전에는 null)
  periods: Period[],           // 겹쳐 얹히는 기간 (배너용)
  color, colorAlt,             // 승자 반영 최종 전례색 (B1)
}

/** @typedef {{
 *   observance: Observance,
 *   status: "proper" | "transferred_in" | "transferred_out" | "optional",
 *   from?: string,          // transferred_in — 원래 날짜 "YYYY-MM-DD"
 *   to?: string,            // transferred_out — 도착 날짜 "YYYY-MM-DD"
 *   displacedBy?: string,   // 밀어낸 관측일의 id (Observance.id — in·out 양쪽)
 * }} Candidate */
```

**`Candidate` 는 래퍼다(§1.3 ⑤, 2026-09-05).** 종전에는 `candidates: Observance[]` 였다. 그러면 옮겨온 축일을 목적지에서 낼 때 「12.28 에서 옮겨 왔다」를 실을 자리가 없고, 원래 날짜에서는 「12.29 로 갔다」를 실을 자리가 없다. `Observance` 에 필드를 더하는 것은 §5.6 이 `occurrence` 를 거절한 것과 같은 이유로 하지 않는다 — 정의 표의 행과 엔진이 합성한 값이 한 타입에 섞인다. 상태의 뜻:

| `status` | 뜻 | 누가 만드나 |
|---|---|---|
| `proper` | 그 날짜의 고유 후보(아래 ①~④). 밀렸어도 옮겨지지 않았으면 그대로 `proper` 다 — 「밀린 독서 보존」(ADR-036 §7)이 이 상태로 실현된다 | PR 2 |
| `transferred_in` | 다른 날짜에서 옮겨 와 **이 날 지키는** 축일. `from`·`displacedBy` 를 가진다. ADR-037 §6 표시 순서의 ② 「이동 축일」이 정확히 이 집합이다 | PR 3 (§6.5) |
| `transferred_out` | 이 날짜의 고유 후보였으나 밀려서 **다른 날로 간** 축일. `to`·`displacedBy` 를 가진다. 승자가 될 수 없고 뷰는 「→ 12.29」로 안내한다. 도착한 축일은 다시 밀리지 않으므로(§6.2 ②) 옮겨 온 것이 이 상태가 되는 일은 없다 | PR 3 (§6.5) |
| `optional` | 「옮겨 지킬 수 있다」는 선택 주일 봉헌(§6.2)의 목적지 주일에 얹히는 후보. 설정이 켜기 전에는 승자 판정에 참여하지 않는다. 별도 색인 `optionals` 에서 온다 — 도착·출발 색인과 섞지 않는다 | PR 3 (§6.2) |

B1 이 `commemorate_only`·prec 7 생략을 구현하면 `"commemorated"`·`"omitted"` 가 여기 더해진다(§6.2 절차 ④·⑤). 열거형을 닫아 두지 않는 이유다.

**핵심 계약(ADR-036 §7)**: `precedence` 는 그날의 **공식 축일 하나**를 정하지만, 엔진은 **밀려난 축일 · 기념만 하는 축일 · 연중 평일 독서를 버리지 않는다.** 공식 1건만 쓰는 것은 뷰의 선택이다. 목적은 사용자가 "축일에 밀린 기본 독서"를 놓치지 않게 하는 것 — 뷰 설정의 기본은 교회력에 맞는 독서만, 고급은 그날 읽을 수 있는 모든 독서다.

후보를 모으는 곳 다섯: ① 격자 좌표(temporal) ② `date` 매치(sanctoral) ③ `lunar` 매치(KASI) ④ 규칙 파생(temporal-feasts 의 `rule` 평가) ⑤ **도착 이동** — `transfers.arrivals.get(date)`(§6.5). ①~④ 가 그 날짜의 **고유** 후보(`status: "proper"`)이고 ⑤ 만 다른 날짜에서 온다. 같은 패스의 `departures.get(date)` 에 있는 고유 후보는 `status: "transferred_out"` 으로 바꿔 낸다(같은 축일이 한 날짜의 `arrivals`·`departures` 양쪽에 있을 수는 없다 — §6.5). 그리고 `transfers.optionals.get(date)` 를 `status: "optional"` 로 덧붙인다.

**⑤ 가 없으면 옮겨온 축일은 어디에서도 조회되지 않는다**(종전 §9 미결9). §6 이 「밀린 축일이 다음 빈 날로 간다」는 절차만 적고, 목적지 날짜를 열었을 때 그 축일을 후보에 올리는 경로를 정하지 않았기 때문이다. 이동은 **한 날짜를 보고는 알 수 없다** — 12.29 가 스테파노를 받는지는 12.26 이 주일인지에 달렸다. 그래서 색인은 연도 단위로 한 번 만들어 캐시에 두고(§4.9), `resolveDate` 는 그것을 읽기만 한다.

**§5.4 의 「성인력 행이 없는 날짜 본문 16건」은 여기서 다루지 않는다.** 실측하면 그 16 개가 전부 `12.17~12.24`(성탄 전 8일)·`12.30`·`1.3~1.12` — **성인일이 아니라 절기 평일**이다. 그날의 **관측일은 ① 격자에서 이미 나온다**(성탄절기 평일). 성인력에 줄이 없는 게 결손이 아니라 맞는 것이고(ADR-036 §6), 빠지는 것은 관측일이 아니라 **본문 조회 키**다 — 그 본문은 `date` 로 색인돼 있는데 **격자 관측일에는 `date` 가 없다**(절기 좌표에서 나온 것이라). 그러니 관측일만 넘겨서는 닿지 않고, 물어본 날짜가 남아 있는 `ResolvedDate` 를 함께 받아야 한다 — `findReadings(resolved, observance)`(§5.6 시그니처). 후보 출처를 늘리는 건 잘못된 처방이다 — 관측일은 멀쩡히 있고 본문만 못 찾는 상황이라, 본문 인덱스를 후보로 올리면 「12월 19일」이라는 이름 없는 관측일이 하나 더 생긴다.

**후보 표시 순서(ADR-037 §6)**: ① 교회력에 따른 축일/재일 → ② 이동 축일 → ③ 나머지(연중 평일·연속). 대축일·주요축일·사계재에 연중 주간 독서가 전례상 쓰이지 않더라도 **후보는 모두 제공한다** — 목적에 맞는 선택은 독서자 몫.

### 5.6 `findReadings` · `findCollects`

- **두 조회 함수는 좌표를 받지 않는다** — `findReadings(resolved, observance)` · `findCollects(resolved)`. `LiturgicalCoord` 는 절기 축(`season`·`week`·`weekday`·`year`)만 담아서, 이름일(`name`)·고정일(`date`)·음력일(`lunar`)로 색인된 본문에 좌표만으로는 닿지 않는다. 관측일에는 그 세 키가 들어 있으므로 승자 관측일을 그대로 넘긴다 — 좌표만 넘기면 호출부가 같은 판정을 다시 하게 된다.
- **둘 다 `ResolvedDate` 를 받지만 이유가 다르다.** `findCollects` 는 **여러 관측일**이 필요해서고(`resolved.candidates` — 아래), `findReadings` 는 **그날의 실제 날짜**가 필요해서다. §5.4 의 성탄절기 16건은 `date` 로만 갈리는데 그 `date` 는 **본문 레코드 자신의 좌표**이지 격자 관측일이 들고 있는 값이 아니다 — 격자 관측일은 절기 좌표에서 나오므로 `date` 가 없고, 열여섯이 전부 `type: weekday` · `week: null` · `weekday: null` 이라 좌표로는 성탄주간 아홉이 한 덩어리로 뭉개진다(2026-09-01 실측). 물어본 날짜는 `resolved.date` 에만 있으니 거기서 `MM.DD` 를 떼어 §5.4 의 `date` 인덱스를 친다.

  **관측일에 날짜를 심어 인자 하나로 두는 안은 버렸다.** `Observance.date` 는 「이 관측일은 해마다 `MM.DD` 에 온다」는 뜻이고 §5.4 권장 인덱스 3 이 그 뜻으로 키를 잡는다. 격자 관측일에 「마침 물어본 날」을 같은 필드로 넣으면 한 필드가 두 뜻을 갖는다. 별도 필드(`occurrence`)를 두면 충돌은 피하지만, `Observance` 는 뷰·검색과 함께 쓰는 `types.d.ts` 공유 타입이라(§3.2) 엔진이 합성한 값을 거기 얹지 않는다.
- `findReadings(resolved, observance)` → `reading_track` · `set_no` 별 **그룹**. `set_no` 정렬은 결정적이어야 하며(기사 배열 순서 금지) **옛 연도판을 뒤로**, 인쇄된 세트 번호 순, 본 독서가 대안보다 앞(ADR-037 §1 개정). 실측 분포(2026-08-29): `set_no` 는 1(841) · 2(81) · 3(1), `set_total > 1` 인 레코드가 163건.
- `reading_track` 은 **연중 주일에만** 있다 — 실측으로 비-null 175건이 전부 `(season: ordinary, type: sunday)` 였다(ADR-037 §1 개정 ③ 확인). 재의 수요일·성 금요일·부활대축일의 `2` 는 트랙이 아니라 **대안 세트**다. 엔진이 이를 "독서 2"로 이름 붙이면 안 된다.
- **독서 슬롯은 네 개지만 다 있지는 않다.** 실측(2026-09-01): `first` 922 · `psalm` 922 · `gospel` 922 · `second` 383. `second` 가 없는 539건은 대개 평일(526)이라 정상이다. **`gospel` 은 이제 빠짐없이 있다** — 종전에 복음이 없던 **단 하나**(12.31 거룩한 이름 예수 전야)는 뷰가 견뎌야 할 예외가 아니라 **잘못 실린 레코드**였고, 저녁기도로 판정돼 빠졌다(data PR#23). 그래도 뷰는 **위치가 아니라 `slot` 이름으로 읽어야 한다**(ADR-037 §1 개정 ②) — 마지막 칸이 늘 복음인 것은 지금 데이터가 그럴 뿐이다. 데이터 쪽 검증도 개수를 세지 않고 「남은 레코드에는 전부 복음이 있다」를 직접 단언한다(data `tests/test_lectionary.py`) — 복음 없는 레코드가 다시 들어오면 성무일과가 새어 든 것이거나 원료가 깨진 것이다.
- 시편 슬롯의 `bookId` 는 전례시편 `lps`, 송가일 때는 `cant` + `canticle` 키가 붙는다.
- `findCollects(resolved)` → **`ResolvedDate` 를 받는다**(관측일 하나가 아니라). 두 축을 **구분해서** 반환하기 때문이다(ADR-038 §3): ① 같은 관측일의 자유선택 대체안(`collect_no` — 뷰가 택1 탭) ② 서로 다른 관측일이 겹쳐 따라오는 본기도(뷰가 순서대로 열거). **②는 정의상 여러 관측일에 걸친 축**이라 승자 하나만 넘기면 만들 수 없다 — `resolved.candidates` 가 있어야 한다. `findReadings` 가 승자 관측일을 따로 받는 것도 이 때문이지 실수가 아니다: 독서는 승자 하루의 세트를 내면 끝이라 후보 전부가 필요 없다. 대신 그날의 날짜가 필요해 `resolved` 를 같이 받는다(위).
- **송영은 본문에 없다** — 레코드의 `ending` 이 앱 상수 3종 중 하나를 가리키고, 열거 **마지막 1회만** 부착한다(ADR-036 §3 개정). 엔진은 코드만 넘긴다. 실측(2026-09-01)은 A 317 · C 10 · **B 0** — 합 327.
- **성인 공통 본기도 폴백** — `has_proper: false` 인 성인은 `sanctoral_class` 로 `commons.json` 의 분류별 공통을 참조하고, 본문의 `{name}` 자리에 성인 이름을 넣는다. 이름이 **배열**이므로 `A와 B` 로 연결한다(안나와 요아킴).

  **폴백은 빈틈 없이 닫힌다** (2026-08-09 전수 확인). 성인 149건의 내역:

  | 갈래 | 건수 | 처리 |
  |---|---|---|
  | 고유 **본기도** 보유(`has_proper: true`) | 52 | 본기도 공통은 필요 없다. `apostle`(14) · `evangelist`(3) · `lord`(12) 는 **전원**이 여기 속한다. **독서까지 보유한다는 뜻은 아니다** — 52건 중 프란시스 사베리오(12.03)는 고유 독서가 없어 공통 독서를 타야 한다(§5.4 · §9 미결11). `has_proper` 는 본기도 축의 플래그다 |
  | 공통으로 폴백 | 81 | `martyr` 33 · `pastor` 24 · `monastic` 9 · `teacher` 6 · `saint` 6 · `missionary` 3 — **여섯 분류 모두 `commons.classes` 에 있다** |
  | 기념일(`commemoration`) | 16 | 본기도·독서가 애초에 없다(§2) |

  `commons.classes` 가 8개(위 여섯 + `dedication` · `anniversary`)뿐이어서 `apostle`·`evangelist`·`lord`·`national` 이 빠진 것처럼 보이지만, **그 분류의 성인은 전원 고유 본기도를 가지므로 공통을 탈 일이 없다.** 뒤의 둘은 성인이 아니라 본당 축성일·교구 설립일용이다.

---

## 6. B1 품계 · 이동 · 전례색

A1 이 끝난 뒤 별도 PR. 데이터가 `rank` · `precedence` · `priority_group` · `transferable` · `transfer_to` · `outranks_sunday` · `color` · `color_alt` 를 준다.

### 6.1 품계 사다리

`precedence` 는 **정수, 낮을수록 우선**.

| prec | rank | 해당 |
|---|---|---|
| 0 | `regional_festival` | 설·추석 |
| 1 | `principal` | 대축일 7 + **성 목요일**(2026-08-29 확정 — 성삼일 첫날이라 prec 1 이지만 재일은 아니다) + 대재일 2(재의 수요일·성 금요일) |
| — | (A 특례) | 거룩한 이름 예수·주의 봉헌·주의 변모 — `outranks_sunday: true`, **1과 2 사이** |
| 2 | `privileged_sunday` | 절기 주일 |
| 3 | `major_feast` A | 연중 주일보다 선순위 |
| 4 | `major_feast` C | 연중 주일보다 선순위, 어려우면 기념만 |
| 5 | `sunday` | 연중 주일 |
| 6 | `major_feast` B | 어느 주일과 겹쳐도 다음날 이동 |
| 7 | `minor_feast` · `commemoration` | 겹치면 **생략**(이동 없음) |
| 8 | `feria` | 절기 평일 · 소재일 |

주의할 점 셋:
- **재일은 한 등급이 아니다** — 대재일은 prec 1, 소재일은 prec 8. `type: "fast"` 가 같아도 `rank` 가 갈린다.
- **"모든 주일이 축일보다 우선"을 단일 규칙으로 두지 않는다** — 절기 주일과 연중 주일이 갈린다.
- **A > C > B 순서는 기도서가 직접 명시하지 않는다.** 주일과의 관계에서 도출한 잠정 순서이고 실제 겹침 사례가 나오면 재확인 대상이다(ADR-036 §6 개정).

**`rank` 로 우선순위를 비교하면 안 된다.** 실측에서 `major_feast` 가 precedence 3 · 4 · 6 세 값으로 갈린다(A · C · B 그룹). 비교는 반드시 `precedence` 로 하고 `rank` 는 표시·분류에만 쓴다. `minor_feast` 와 `commemoration` 은 둘 다 7 로 **동률**이다.

`precedence` 가 `null` 인 후보(collects 3건 — 맥추감사주일·여성선교주일·노동자의 날. 성 목요일은 2026-08-29 에 대축일로 확정돼, 거룩한 이름 예수 전야는 2026-09-01 에 성무일과로 판정돼 빠졌다)는 **정렬 최하위**, 승자로 뽑지 않는다. **`outranks_sunday` 가 `null` 인 집합도 정확히 이 셋**이라 따로 갈라 다룰 필요가 없다(2026-09-01 실측).

### 6.2 이동 목적지 — 충돌 이동과 선택 봉헌은 다른 것이다

`transfer_to` 여섯 값은 **두 종류**를 한 열에 담고 있다(2026-09-05 구분). 실측: sanctoral 32건 중 `next_day` 29 · 주일 종류 3, temporal 3건 중 `next_day` 1 · `easter7_sunday` 1 · `commemorate_only` 1.

| `transfer_to` | 종류 | 언제 | 목적지 |
|---|---|---|---|
| `next_day` | **충돌 이동** | 그날의 승자가 아닐 때(§6.5) | 다음날. **그날도 차 있으면 다음 빈 날로** — 엔진이 루프 |
| `nearby_sunday` | **선택 봉헌** | 충돌과 무관하게 언제나 | 가까운 주일(주의 봉헌 2.2). 그날이 수요일 이전이면 **직전** 주일, 목요일 이후면 **다음** 주일. 그날이 주일이면 목적지 없음 |
| `sunday_0102_0108` | 선택 봉헌 | 언제나 | 1.2~1.8 사이의 주일(공현). 1.6 이 주일이면 없음(2030·2036·2041·2047) |
| `sunday_1030_1105` | 선택 봉헌 | 언제나 | 10.30~11.5 사이의 주일(모든 성인). 11.1 이 주일이면 없음(2026·2037·2043·2048) |
| `easter7_sunday` | 선택 봉헌 | 언제나 | easter+42(승천). 승천이 늘 목요일이라 **매년** 생긴다 |
| `commemorate_only` | 이동 없음 | 밀렸을 때 | 옮기지 않고 기념만(추수감사주일 — 주일로 정의된 C 그룹) |

**충돌 이동**은 결정적이다 — 그날 더 높은 관측일이 있으면 옮긴다. **선택 봉헌**은 기도서가 「옮겨 지킬 수 있다」고 적은 목회적 선택이라 엔진이 판단할 수 없다. 그래서 목적지 주일에 `status: "optional"` 후보를 **항상** 얹고, 원래 날짜의 고유 후보는 그대로 둔다 — 승천은 목요일에도 있고 부활7주일에도 `optional` 로 있다. `optional` 은 설정이 켜기 전에는 승자 판정에 참여하지 않는다. 어느 설정이 켜는가는 ADR-038 의 몫이다(§9 미결15). 이렇게 두 곳에 다 내는 것이 「조용히 하나를 고르지 않는다」는 이 문서의 태도와 맞고, 뷰의 기본은 승자만 보이므로 사용자에게 두 날이 다 축일로 보이는 일은 없다.

**선택 봉헌 종류의 축일도 충돌로 밀릴 수 있다.** 2049-02-02 는 설이고 주의 봉헌이다 — 명절(prec 0)이 이기고, 봉헌의 `transfer_to` 는 `nearby_sunday` 라 「다음날」을 말하지 않는다. 규정은 ADR-036 §7 ④ 가 준다 — 진 축일의 목적지는 **다음날, 가·나·다 공통**. 따라서 **충돌 이동의 목적지는 `transfer_to` 값과 무관하게 언제나 다음 빈 날**이고, `transfer_to` 는 그 위에 선택 봉헌 목적지를 **더** 정하는 열이다. 충돌 이동에 참여하는 조건은 `transferable: true` ∧ `precedence !== null` ∧ `transfer_to !== "commemorate_only"` 이 셋이다.

**주일로 정의된 날 특례**: 「11월 셋째 주일」·「공현 후 첫 주일」처럼 주일로 정의된 날은 월요일로 옮기면 정의가 깨진다. C 그룹이면 `commemorate_only`, 그 밖은 제자리(ADR-036 개정③). 데이터가 이미 그렇게 적혀 있으므로 엔진이 `rule.kind` 를 보고 다시 판정하지 않는다.

**충돌 해소 절차(ADR-036 §7)**: ① 명절 ∧ 주요축일 → 명절 우선 ② 재의 수요일 ∧ 설 → 재의 수요일을 뒤로(**데이터가 아직 `transferable: false`** — §2 · §9 미결13) ③ 주요축일끼리는 prec 순, 낮은 쪽 이동 ④ 진 축일은 다음 빈 날로, C 는 어려우면 기념만 ⑤ prec 7 은 이동이 아니라 생략.

**동률 tie-break(절차 ③ 이 정하지 않은 것).** 비교 키는 `precedence` 에 A 특례를 반영한 유효값이다 — `outranks_sunday: true` 는 1 과 2 사이(§6.1)이므로 정렬 키로는 1.5 를 쓴다. 같은 값이 남으면:

1. **도착 우선 — 연쇄 밀림.** 옮겨 온 후보(`transferred_in`)가 그 날짜의 같은 값 고유 후보(`proper`)를 **밀어낸다**. 그러면 밀린 고유 후보가 다시 다음날로 가고, 그 날의 같은 값 축일이 또 밀린다. 12.26 이 주일인 해(2027): 스테파노 → 12.27, 요한 → 12.28, 죄 없는 어린이들 → 12.29 — 셋이 **순서를 지키며 하루씩** 밀리고, 12.29 의 토마스 베켓(prec 7)은 생략된다. 12.27 이 주일인 해(2026)는 스테파노 제자리, 요한 → 12.28, 어린이들 → 12.29.

   **근거**: 기도서 문언이 「**다음날**로 옮겨 지킨다」다(`docs/reference/liturgical-calendar-rules.md` 주요축일 나-1 · 가-3 · 다-1). 연쇄 모델은 밀린 축일 **각각**이 문자 그대로 자기 다음날에 앉는다. 반대 모델(재위 우선 — 밀린 축일이 빈 날까지 건너뜀, 스테파노가 사흘 뒤 12.29 로)은 영국 성공회 Common Worship 규정(「스테파노·요한·어린이들이 주일에 들면 12월 29일로」)과 같은 결과를 내지만 「다음날」 문언과 어긋난다. 실제 관행의 증거는 미국 성공회 달력이다 — lectionarypage.net 2025~2027 이 정확히 연쇄로 표기한다(2027-12-27 스테파노(transferred) · 12-28 요한(transferred) · 12-29 어린이들(transferred); 2026-12-28 요한 · 12-29 어린이들; 2025-12-29 어린이들). 같은 페이지의 다른 이동(2025 안드레아 → 12.1, 2025 마르코 → 4.28, 2026 성모 방문 → 6.1, 2027 수태고지 → 4.5)도 §7 케이스와 전부 일치한다. 대한성공회의 실제 표기는 스크랩 원료에 실제 연도 날짜가 없어 확인하지 못했다 — **사제 확인 대상**(§9 미결17). 두 모델의 차이는 이 규칙 한 줄이라 뒤집기는 쉽다.
2. **도착한 축일은 품계와 무관하게 자리를 지킨다 — 선착순.** 이미 옮겨 와 앉은 축일이 있는 날은 뒤에 밀려온 축일에게는 **비어 있지 않다**, 그쪽 품계가 더 높아도. 밀린 축일들은 **기원 날짜 순**으로 줄을 선다(패스가 날짜 순으로 돌기 때문에 「먼저 처리된 쪽」과 같다). 기원 날짜까지 같으면 `id` 사전순. **근거는 미국 성공회 달력 2008년이다** — 요셉(3.19 성주간 수, prec 6)이 부활2주 월요일 3.31 에, 수태고지(3.25 부활 화, prec 3)가 **그 다음날 4.1** 에 "(transferred)" 로 놓였다. 품계가 높은 수태고지가 먼저 온 요셉을 밀어내지 않았다. 2011년도 같다 — 마르코(4.25 부활 월) → 5.2, 필립보·야고보(5.1 부활2주일) → 5.3. 이 규칙의 결과로 **재이동은 일어나지 않는다** — 도착은 그날의 고유 후보보다 높은 자리에만 앉고(`isFree` ①), 뒤의 도착에는 밀리지 않으므로(②), 한 축일은 많아야 한 번 옮긴다. `isFree` ② 가 이 규칙의 구현이다(§6.5).
3. **규칙일 유지 · 고정일 이동** — 고유 후보끼리 같은 값이면 temporal(부활절 기준 규칙일)이 남고 sanctoral(고정 날짜)이 옮긴다. 실제 사례는 성체일 ∧ 성모 방문(2029·2040) · 성체일 ∧ 성 세례 요한 탄생(2038) 셋이고, 로마 교회력 우선순위표가 주님의 대축일을 성모·성인 대축일 위에 두는 것과 같은 결과다. **잠정 규칙 — 사제 확인 대상**(§9 미결14). 확인 전까지 코드는 이 규칙을 쓰되 유닛 케이스에 「잠정」이라 표시한다.
4. 그래도 같으면 `id` 사전순(§5.3 과 같은 안정 정렬).

### 6.3 좌표만으로 안 되는 판정 넷 (ADR-037 §6 개정)

1. **금요일 소재일** — 요일 축 병합 때문에 레코드 하나가 소재일과 비소재일을 함께 덮는다. 소재일은 **사순 주간 + 사계재일 + 성탄절기를 제외한 모든 금요일**이므로, "성탄절기 안의 금요일은 소재일이 아니다"를 엔진이 날짜로 판정해야 한다.
2. **성주간·부활 1주간 보호** — prec 7 은 여기서 생략된다. ~~주요축일 B 는 애초에 겹칠 수 없다(겹치면 데이터 오류)~~ **정정(2026-09-05)**: 겹친다. 성 요셉 3.19 는 2035·2046 에, 성 마르코 4.25 는 2025·2030·2038·2041·2049 에, 필립보·야고보 5.1 은 2038 에 성주간 또는 부활 1주간에 떨어지고, 수태고지 3.25(A) 는 2027·2032·2035·2040·2043·2046 에 그렇다 — 2035·2046 은 **부활대축일 당일**이다. 데이터 오류가 아니라 이동 사례고, 기도서가 「대축일이나 성주간, 부활주간 8일과 겹치지 않는다」(주요축일 나-2)고 적은 대로 보호 기간을 「비어 있지 않은 날」로 다뤄 그 뒤로 보낸다(§6.5 `isFree` — 성지주일 ~ 부활2주일). 성주간 월~수와 부활 1주간 월~토는 격자에서 `feria`(prec 8), 성 토요일은 `rank: null` 로 나오므로 precedence 만 보면 빈 날로 오판한다 — 보호 기간이 별도 규칙이어야 하는 이유다.
3. **승자 색 덮어쓰기의 기간 가드** — §6.4.
4. **이동 목적지 평가** — 목적지가 비었는지 확인하는 루프.

### 6.4 전례색

결정 순서: **절기 기본색을 깔고 → 승자 관측일의 색이 덮고 → 기간 규정이 있는 날은 덮이지 않게 가드**한다(ADR-036 §8 개정).

- `color` = 정식 전례색 `white` `red` `green` `violet`. `color_alt` = 선택 대체색 `rose` `blue`(대림 3주일·사순 4주일의 장미색, 성모·대림의 청색). UI 는 정식 색을 기본으로 그린다.
- **품계와 전례색은 독립 축**이다 — 등급 칸이 비어도 색 칸은 채워질 수 있다. (오래 실제 사례였던 성 목요일은 2026-08-29 에 대축일로 확정돼 더는 예가 아니다. 원칙은 그대로다 — 표의 두 칸은 서로를 함의하지 않는다.)
- 가드 대상: 성주간 전체 홍색, 부활 1주간 — 개별 성인 축일 색이 이 기간을 덮으면 안 된다.
- **사계재일 자색은 기도서 문면과 긴장 관계다**(ADR-036 미결11). §8 은 전통 관행으로 자색을 확정했으나 기도서는 사계재일 색을 규정하지 않고 「연중시기, 특별히 성령강림 주일 후 주간」을 녹색으로 지명한다. 하계재·추계재가 정확히 그 구간이다. **사제 확인 전까지 엔진은 데이터의 자색을 그대로 쓴다** — 코드에 임의 판단을 넣지 않는다.

### 6.5 이동 패스 — 연도 단위로 한 번, 날짜 순으로 (§9 미결9 해소, 2026-09-05)

옮겨온 축일을 목적지 날짜에서 찾으려면 그해의 이동을 **전부 먼저** 계산해 둬야 한다. 12.29 가 스테파노를 받는지는 12.26 이 주일인지에, 그리고 12.27·12.28 이 이미 차 있는지에 달렸다 — 한 날짜만 보고는 답이 없다. 그래서 이동은 `resolveDate` 안에서 판정하지 않고, **연도 캐시를 채울 때 한 번** 돌리는 패스로 만든다(§4.9 `transfers`). `resolveDate` 는 색인을 읽기만 한다.

```js
/** @returns {TransferPass} */
const MAX_SHIFT = 30;   // 이동 상한(날). 실측 최장 15 — 2029·2040 수태고지 3.25(성지주일) → 4.9

function computeTransfers(year, seed /* Y−1 에서 넘어온 arrivals */) {
  const arrivals   = new Map(seed);        // "YYYY-MM-DD" → Candidate[] (status transferred_in)
  const departures = new Map();            // "YYYY-MM-DD" → Candidate[] (status transferred_out)
  const optionals  = new Map();            // "YYYY-MM-DD" → Candidate[] (status optional) — §6.2
  const defects    = [];
  for (const d of daysOf(year)) {          // 1.1 → 12.31, 날짜 순 — 순서가 결과를 정한다
    const proper  = properCandidates(d);   // §5.5 ①~④, 이동 없음
    const arrived = arrivals.get(d) ?? [];
    const ranked  = rankByPrecedence([...proper, ...arrived, ...guard(d)]);  // §6.1 + §6.2 tie-break
    for (const c of ranked.slice(1)) {     // 승자를 뺀 나머지 (guard 는 movesOnConflict 가 거른다)
      if (!movesOnConflict(c)) continue;   // transferable ∧ precedence≠null ∧ ≠commemorate_only
      if (!ranked.some((w) => outranks(w, c) && variesByYear(w))) continue;  // 고정일끼리는 충돌이 아니다 (아래)
      let dest = nextDay(d);
      while (daysBetween(d, dest) <= MAX_SHIFT && !isFree(dest, c, arrivals)) dest = nextDay(dest);
      if (daysBetween(d, dest) > MAX_SHIFT) { defects.push(c.observance.id); continue; }  // 상한 — 옮기지 않고 그 자리에 남긴다
      const by = ranked[0].observance.id;  // Candidate 는 래퍼 — id 는 observance 아래에 있다
      push(arrivals,   dest, { ...c, status: "transferred_in",  from: d,  displacedBy: by });
      push(departures, d,    { ...c, status: "transferred_out", to: dest, displacedBy: by });
    }
    for (const o of optionalObservances(d)) push(optionals, o.dest, { observance: o.observance, status: "optional", from: d });
  }
  return { arrivals, departures, optionals, defects };
}
```

**고정일끼리는 충돌이 아니다 — 동시 봉헌.** `c` 가 옮겨지는 조건은 「승자가 아니다」가 아니라 **「해마다 달라지는 자리에 밀렸다」**다. `variesByYear(w)` 는 격자 주일 · temporal 규칙일 · 음력 명절 · 도착 · `guard` 에 참이고, sanctoral 의 고정 `date` 행에는 거짓이다. 이 조건이 없으면 **9.29 대한성공회 설립 기념일(prec 4)이 성 미카엘과 모든 천사들(prec 3)에 밀려 매년 9.30 으로 옮겨진다** — 시뮬레이션(2025~2050)으로 드러난 결함. 두 행은 정의상 매년 같은 날이고 본기도 데이터도 한 레코드(`성 미카엘과 모든 천사들 / 대한성공회 설립 기념일`, §5.4)로 합쳐 두었다 — 함께 지키는 날이지 밀린 것이 아니다. 같은 이치로 8.15 광복절 ∧ 성모안식, 9.14 성가수도회 ∧ 성 십자가, 11.1 고요한 주교 ∧ 모든 성인, 1.1 세계평화 기도일 ∧ 거룩한 이름 예수도 이동 대상이 아니다(어차피 낮은 쪽이 `transferable: false` 지만, 규칙은 데이터 우연에 기대지 않는다). 이 다섯 쌍의 `official` 을 무엇으로 두고 낮은 쪽을 `proper` 로 남길지 「생략」할지는 B1 절차 ⑤ 의 몫이다(§9 미결18).

**`guard(d)`** — 보호 기간의 가상 점유자. **성지주일부터 부활2주일까지**(easter−7 ~ +7, 기도서 「성주간, 부활주간 8일」 — 주요축일 나-2) 안의 날에는 유효 precedence 1 · `transferable: false` 인 합성 후보 하나를 낸다. 그 밖의 날에는 빈 배열. 이 점유자는 **기원 날짜의 순위**에도, 아래 **목적지 검사**에도 같은 함수로 들어간다 — 한쪽에만 두면 반쪽이다. 목적지에만 두면 성주간 평일에 **처음 놓인** B 축일이 그날의 `feria`(prec 8)를 이겨 `ranked[0]` 이 되고 아예 옮겨지지 않는다(2035-03-19 성 요셉 · 2025-04-25 성 마르코가 그렇다). 성 토요일이 `rank: null` 인 것도 이 점유자가 덮는다. 뷰에는 내지 않는다 — `resolveDate` 의 후보 출처 ①~⑤ 에 없다.

**`isFree(dest, c)`** — `c` 가 그 날짜에서 **이길 수 있으면** 빈 날이다. 구체적으로 ① 고유 후보와 `guard(dest)` 중 `c` 보다 **높은**(유효값이 작은) 것이 없고 — 같은 값의 고유 후보는 도착 우선(§6.2 ①)으로 `c` 가 밀어내므로 막지 않는다 — ② **이미 도착해 있는 후보가 하나도 없다** — 품계를 보지 않는다(§6.2 ② 선착순. 2008 미국 성공회: 요셉이 3.31 을 지키고 수태고지가 4.1). 같은 날 기원의 둘은 `id` 순으로 먼저 처리된 쪽이 먼저 도착한다. `precedence: null` 후보와 `optional` 은 막지 않는다. `guard` 가 없으면 2027년 수태고지가 성 토요일에, 2035년에는 부활 월요일에 앉는다. 도착한 축일이 그 날짜의 prec 7 후보를 생략시키는 것(절차 ⑤)은 B1 의 `official` 판정에서 다룬다 — 패스는 좌석만 정한다.

**재이동은 없다.** `isFree` ① 로 도착은 그날의 어떤 고유 후보보다 높은 자리에만 앉고, ② 로 뒤의 도착에는 밀리지 않는다. 따라서 한 축일은 많아야 한 번 옮기고, 어떤 축일도 같은 패스의 `arrivals` 와 `departures` 양쪽에 실리지 않는다(§7 ⑧ 불변식). 2035·2046 의 요셉(3.19 성주간 월)은 4.2 에 앉아 **그대로 있고**, 뒤에 밀려온 수태고지(3.25 = 부활대축일)가 4.3 으로 간다 — 2008 의 미국 성공회 배치(요셉 3.31 · 수태고지 4.1)와 같은 모양이다. 종전 초안은 높은 도착이 낮은 도착을 다시 밀게 해 「도착·재출발」 상태와 누적 상한이 필요했는데, 실제 관행이 그렇지 않아 둘 다 뺐다.

**패스가 결정적인 이유 셋.** ① 날짜를 오름차순으로 훑고, `next_day` 는 언제나 **앞으로만** 가므로 어떤 날짜 `d` 에 이르렀을 때 `arrivals.get(d)` 는 완성돼 있다 — 그 뒤에 도착할 것이 없다. ② 연쇄는 이 루프 자체다 — 도착이 그 날짜의 같은 값·낮은 값 **고유** 후보를 밀어내고(§6.2 ①), 밀린 것이 `transferable` 이면 루프가 `d` 에 이르렀을 때 `ranked` 에서 승자가 아니므로 다음날로 간다. 성탄 3축일이 하루씩 밀리는 것이 정확히 이 경로다(어린이들의 `from` 은 12.28, `displacedBy` 는 요한). 밀리는 것은 언제나 고유 후보다 — 도착은 밀리지 않는다(§6.2 ②). 같은 날을 노리는 도착 둘(2038 마르코·필립보와 야고보가 부활 8일을 건너 5.3 에 함께 닿으려는 경우)은 **기원이 이른 쪽**(마르코 4.25)이 5.3, 다음(필립보·야고보 5.1)이 5.4 다(2011 미국 성공회와 같은 배치). ③ 순서는 §6.2 tie-break 로 완전히 정해지고 배열 순서에 기대는 곳이 없다.

**연도 경계.** `next_day` 는 해를 넘길 수 있다 — 12월 말에 밀린 축일이 1월 초에 닿는 경우. 현재 데이터로는 일어나지 않지만(12.26~28 은 늦어도 12.29 에 앉고, 12.31 실베스터·위클리프는 prec 7 이라 옮기지 않는다), 표가 바뀌면 조용히 깨질 자리라 규칙을 못박는다. 캐시에 넣는 `Y` 의 패스는 `computeTransfers(Y, spill(Y−1))` 이고, `spill(Y−1)` 은 **`computeTransfers(Y−1, ∅)` 의 arrivals 중 날짜가 `Y` 인 것**이다. 이 seed 없는 `Y−1` 패스는 **임시**다 — 12월 결과만 쓰고 버리며 캐시에 넣지 않는다(§4.9). `Y−1` 자체를 조회하게 되면 그때 `spill(Y−2)` 로 완전한 패스를 따로 만든다.

`Y−2` 없이 계산한 `Y−1` 의 12월이 완전한 패스의 12월과 같아야 재귀가 깊이 1 에서 끊긴다. **이것은 상한만으로 증명되지 않는다** — `MAX_SHIFT` 는 한 축일의 이동을 막지만, seed 가 밀어낸 고유 축일은 새 이동을 시작하고 그것이 또 다른 축일을 밀 수 있어 원리상 전파에 상한이 없다. 실제로는 전파가 **이동 가능한 축일이 연달아 놓인 날들**을 타고서만 이어지고, 도착이 아무것도 밀어내지 않는 첫 날(고유 후보가 `feria` 뿐인 날)에서 끊긴다 — 성인력에서 이동 가능 축일은 32건이 1년에 흩어져 있어 그런 사슬은 며칠을 넘지 못한다. 그래서 「깊이 1」은 **데이터에 대해 검증하는 불변식**으로 둔다: §7 ⑧ 이 1900~2100 전 연도에서 `computeTransfers(Y, spill(Y−1))` 과 `computeTransfers(Y, ∅)` 가 **2월 1일부터는 완전히 같다**를 단언한다. 표가 바뀌어 이 단언이 깨지면 그때 깊이를 늘리거나 완전한 전년도 패스를 재귀로 만드는 것이 답이고, 지금 코드는 검증된 가정 위에 서 있다. 이 단언이 성립하는 한 캐시 항목의 내용은 어느 해를 먼저 열었는지에 의존하지 않는다. 이 규칙은 **선택 봉헌 목적지에는 적용하지 않는다** — 그것들은 원래 날짜의 ±7일 안이고 해를 넘기는 날짜(1.6·2.2·11.1·승천)가 없다.

**이동 상한.** 한 번의 이동이 `MAX_SHIFT`(30일)를 넘으면 그 축일은 **옮기지 않고 `proper` 로 남기며** `defects` 에 id 를 적는다 — throw 하지 않는다. §2 의 설계 원칙(엔진이 throw 하는 경우는 데이터 파일 부재·프리로드 누락 둘뿐, 결손은 빈 결과 + 계속 진행)을 지키는 것이고, 이론상 무한 루프는 없지만(연중 평일은 언제나 비어 있다) 상한이 없으면 표 결함이 조용히 먼 날짜로 번지기 때문에 둔다. `defects` 는 §9 미결1 이 말한 「개발 빌드에서 드러낼 데이터 결함 신호」의 첫 사례다 — 앱에서 어떻게 알릴지는 그 미결에 얹는다. 실측(2025~2050)으로 가장 긴 이동은 **수태고지 2029·2040 의 15일**(3.25 성지주일 → 4.9 — 2018 미국 성공회와 같다), 그다음 요셉 2035·2046 의 14일(3.19 성주간 월 → 4.2), 수태고지 2043 의 12일이다. 성탄 3축일은 각각 하루다. 한 축일은 한 번만 옮기므로(§6.2 ②) 누적 상한은 필요 없다. 유닛이 1900~2100 전 연도에서 이동 ≤ 15 를 단언한다(§7 ⑧).

**선택 봉헌**(§6.2)은 같은 루프에서 **별도 색인 `optionals`** 에 얹는다 — 원래 날짜의 고유 후보를 옮기지 않고 목적지 주일에 `status: "optional"` 을 **더한다**. `arrivals` 에 섞지 않는 이유: 도착·출발 색인은 「출발 수 = 도착 수」·「도착은 그 날의 승자」 불변식(§7 ⑧)을 지는데, 선택 봉헌은 출발이 없고 승자도 아니라 섞이면 그 불변식이 매년(승천) 깨진다. `isFree` 는 `optionals` 를 보지 않는다(설정이 켜기 전에는 좌석을 차지하지 않는다).

**패스가 B1 소속인 이유와 PR 2 의 몫.** 패스는 `rankByPrecedence` 를 쓰므로 품계 비교(§6.1)가 있어야 돌아간다 — PR 3 이다. 그러나 `resolveDate` 의 반환 형태(`Candidate[]`·`official`)와 ⑤ 조회 경로는 PR 2 가 만든다. PR 2 의 `transfers` 는 빈 패스(`arrivals`·`departures` 모두 빈 Map)이고 모든 후보가 `proper` 다. 이렇게 갈라야 PR 2 의 뷰·테스트가 PR 3 에서 형태 변경 없이 그대로 산다.

---

## 7. 테스트 계획

`tests/unit/liturgical-engine.test.js`. ADR-013 하네스 — 각 테스트 파일이 `extractBlock` 을 자기 안에 복사해 갖고, `vm.createContext` 에 최소 전역만 넣는다. **`Date` 를 컨텍스트에 반드시 주입**해야 한다(기본 세트에 없다). realm 경계 때문에 반환값 비교는 `JSON.parse(JSON.stringify(v))` 로 정규화한다.

| 영역 | 케이스 |
|---|---|
| computus | 권위 있는 서방 부활절 날짜표와 대조(ADR-036 §11 이 지정한 검증 방식). 세기 경계 포함 |
| 파생 오프셋 | 재의 수요일이 항상 수요일, 승천이 항상 목요일, 성령강림이 항상 주일 — 1900~2100 전 연도 불변식 |
| 대림 앵커 | 대림 1주일이 항상 주일이고 11.27~12.03 안에 든다. 전례년 경계(12.31 vs 1.1) |
| 절기 스팬 | 스팬이 겹치지 않고 빈틈이 없다 — 한 해 365/366일이 정확히 한 절기에 배정된다 |
| **연중 주차** | **2052년 3/3 = 9주**(윤년 회귀). 모든 주일이 정확히 한 주간에 속함, 공현 후 1주부터 연속, 성령강림 후 34주로 끝 |
| 주기 | 주일 주기가 대림에 넘어가고 평일 주기가 1/1 에 넘어간다 — 12월 구간의 어긋남이 의도대로인지 |
| **사계재(`ember_wfs`)** | **규칙 하나가 날짜 셋을 낳는 유일한 종류**라 별도 케이스가 필요하다(§4.3). ① **앵커 당일이 수요일이어도 다음 주** — 고정 앵커 9.14·12.13 은 1900~2100 에 각 28회 수요일에 떨어진다. 「엄격히 이후」가 깨지면 그 해만 조용히 한 주 당겨진다. ② **네 계절 × 수·금·토 = 겹치지 않는 12일**, 그리고 춘계재가 사순1주 좌표에·하계재 토요일이 성삼위일체 전날에 떨어질 것. ③ **조인** — 만든 세 날짜가 지향별 레코드와 맞물리고 **금요일 본기도 두 건(성직후보자·수도자)이 보존될 것**. 이 셋이 없으면 사계재가 다시 조회 불가로 돌아가도 테스트가 초록이다 |
| 음력 | 2025–2050 조회, **범위 밖 연도는 빈 결과**(throw 아님) |
| 폴백 매칭 | 단일 > 배열 > null 구체성 순, 동점 시 `id` 사전순 안정 정렬, 불일치 탈락 |
| **날짜 전용 본문** | **성탄절기 16건은 `date` 로만 갈린다** — 12.17~12.24·12.30·1.3~1.12 중 성인력에 행이 없는 열여섯(§5.4). 전부 `type: weekday` · `week: null` · `weekday: null` 이라 **좌표로 찾으면 성탄주간 아홉이 한 덩어리로 나온다.** 셋 다 이름이 `성탄주간` 인데 독서는 **1요한·요한 1장을 이어 읽는 연속 봉독**이라 실제로 다르다(1.3 = 1요한 2:29-3:6 · 요한 1:29-34 / 1.4 = 3:7-10 · 1:35-42 / 1.5 = 3:11-21 · 1:43-51). 이 셋이 서로 다른 독서를 내는지 직접 단언한다 — `findReadings` 가 `resolved` 를 잃으면 빈 결과가 아니라 **이웃 날의 그럴듯한 오답**이 나와서 결손 내성 케이스로는 안 걸린다 |
| 결손 내성 | `rule: null` 건너뛰기, 조회 결과 없는 좌표에서 빈 배열(격자 빈 칸은 2026-08-29 에 메워졌으므로 **기념일·표에 없는 날**로 케이스를 잡는다), `precedence: null` 최하위 |
| 프리로드 가드 | 프리로드 전 동기 호출 시 명확한 throw |
| B1 | 명절 > 대재일, A > C > B, `commemorate_only`, 성주간 색 가드, 성탄절기 금요일이 소재일 아님 |
| **이동 패스(§6.5)** | 전부 **실제 연도**로 잡는다 — 합성 표는 연도 경계 한 건만. **① 도착 경로**: `resolveDate("2025-12-01")` 에 안드레아가 `transferred_in`·`from: "2025-11-30"`·`displacedBy: 대림1주일` 로 있고, `resolveDate("2025-11-30")` 에는 `transferred_out`·`to: "2025-12-01"` 로 있다 — **이 한 쌍이 종전 미결9 의 회귀 케이스**다. **② 성탄 3축일(연쇄)**: 2025-12-28 어린이들 → 12.29; 2026-12-27 요한 → 12.28 **그리고 밀린 어린이들 → 12.29**(`from: 12-28`, `displacedBy: 요한`); 2027-12-26 스테파노 → 12.27, 요한 → 12.28, 어린이들 → 12.29. 세 해 모두 12.29 의 토마스 베켓은 승자가 아니다. 기대값은 lectionarypage.net 2025~2027 표기와 같다(§6.2 ①). **③ 이하의 부활 절기 케이스는 같은 부활절 날짜의 과거 연도로 대조했다** — 2008(=2035·2046 패턴) · 2011(=2038) · 2013 · 2014(=2025) · 2016 · 2018(=2029·2040) · 2019(=2030), 전부 일치. **반대 모델 회귀**: 2027 스테파노가 12.29 에 있으면 안 된다 — 사제 확인으로 모델이 뒤집히면 이 케이스만 반전시킨다. **③ 부활 절기**: 2026-05-14 마티아 → 05.15(승천), 2026-05-31 성모 방문 → 06.01(삼위일체), 2025-04-25 마르코(부활 1주 금) → 04.28(부활 8일 보호), 2027-03-25 수태고지 = 성 목요일 → 04.05(성 토요일 `rank: null` 을 `guard` 가 막는다), 2038-04-25 마르코 = 부활대축일 → 05.03 과 05.01 필립보·야고보 → 05.04(도착끼리 순서 유지). **기원이 보호 기간 안 + 선착순**: 2035-03-19 성 요셉(성주간 월 — 그날의 후보는 `feria` 뿐이라 `guard` 없이는 승자가 되어 안 옮겨진다) → 04.02(14일)에 앉아 **그대로 있고**, 품계가 높은 수태고지(3.25 = 부활대축일)가 **04.03** 으로 간다 — 2008 미국 성공회(요셉 3.31 · 수태고지 4.1)와 같은 모양. 2046 도 같은 배치(부활 3.25). **2029·2040-03-25 수태고지 = 성지주일 → 04.09**(15일 — 최장, 2018 미국 성공회와 같다). **동시 봉헌 무이동**: 1900~2100 어느 해에도 9.29 설립 기념일이 옮겨지지 않는다(2050 은 9.30 이 주일이라 규칙이 없으면 10.1 로 이틀 밀린다) — `departures` 에 그 id 가 한 번도 없다. **④ 명절**: 2040 추석 9.21 마태오 → 9.22; **2049-02-02 설 = 주의 봉헌 → 02.03**(선택 봉헌 종류인데 충돌 이동 — §6.2). 2032-02-11 설 = 재의 수요일은 **데이터 수정 후** 02.12 로 가는 케이스로 적어 두고 그때까지 skip 표시(미결13). **⑤ 동률(잠정)**: 2029-05-31 성체일 ∧ 성모 방문 → 방문이 06.01(규칙일 유지); 2038-06-24 성체일 ∧ 세례 요한 → 요한이 06.25. **⑥ 연도 경계**: 합성 sanctoral 표(12.31 `next_day` 주요축일 + 그날을 차지하는 prec 1)로 `resolveDate("Y+1-01-01")` 에 `from: "Y-12-31"` 도착이 보일 것, 그리고 `Y+1` 캐시만 먼저 만들어도 같은 결과일 것(seed 경로). **⑦ 선택 봉헌**: 2026-05-17(부활7주일)에 승천이 `optional` 로 있고 05.14 의 승천은 `proper` 그대로; 1.6 이 주일인 2030 에 `optional` 공현이 없음; 2.2 가 수요일인 2028 은 직전 주일(1.30), 목요일인 2034 는 다음 주일(2.5). **⑧ 불변식(1900~2100 전 연도, `arrivals`·`departures` 만 — `optionals` 는 제외)**: 출발 수 = 도착 수 − seed 도착 수(seed 의 출발은 전년도 패스에 있다 — 합성 ⑥ 에서 `Y+1` 은 도착 1·출발 0 이 맞다; 도착했다가 떠난 항목은 양쪽에 한 번씩), 그 날짜를 떠나지 않은 도착은 그 날짜의 승자다(`official`), 도착 날짜가 성지주일~부활2주일 안에 없다, `defects` 가 비어 있다, 이동 ≤ 15(수태고지 2029·2040), **어떤 축일도 같은 패스의 `arrivals`·`departures` 양쪽에 없다**(재이동 없음 — §6.2 ②), **seed 있는 패스와 없는 패스가 2월 1일부터 완전히 같다**(깊이 1 가정 — §6.5 연도 경계), `Y` 캐시를 만든 뒤 `Y−1` 을 만들어도·그 반대로 해도 두 항목의 내용이 같다. **⑨ 상한(합성 표)**: 12.1 부터 31일 연속으로 prec 1 고유 축일을 깐 표에서 11.30 에 밀린 `next_day` 축일은 — 탐색이 12.31(30일)에서 **멈추고** — 도착·출발을 만들지 않으며 `proper` 로 남고 `defects` 에 그 id 가 있다 |

e2e 는 A1 단독으로는 붙일 화면이 없다 — ADR-038 A3 독서 뷰 PR 에서 함께 낸다.

---

## 8. 구현 단계

메모리의 작업 방식대로 **작게 나눠 순서대로** 낸다.

| PR | 내용 | 크기 |
|---|---|---|
| ~~**0**~~ | ~~`sw.js` `cacheNameFor` 에 `/data/lectionary/` → `DATA_CACHE` 한 줄 (ADR-037 §7 미이행분)~~ **완료 — #319 (2026-09-01)** | 아주 작음 |
| **1** | A1-a 계산 계층 + `LITURGICAL_CORE` 블록 + 유닛 | 중 |
| **2** | A1-b 조회 계층 + `LITURGICAL_LOOKUP` 블록 + 프리로드·캐시 + 유닛. `js/types.d.ts` 공유 타입 신설(`Candidate` 포함), `index.html`·`sw.js` 등록. `resolveDate` 는 `Candidate[]`·`official: null`·**빈 `transfers`** 로 낸다(§6.5 마지막 단락) | 중 |
| **3** | B1 품계·전례색 + **이동 패스(§6.5)** + 선택 봉헌 `optional` + 유닛 §7 「이동 패스」행 | 중 |
| 이후 | ADR-038 A3 독서 뷰 → A2 캘린더 탭 → A4 검색 이원화 | — |

각 PR 에서 `npm run typecheck` 와 `node --test tests/unit/*.test.js` 를 돌리고, 머지 시 ADR-037 상태 · `docs/status.md` · `docs/architecture.md` §4 모듈 표를 함께 갱신한다.

---

## 9. 미결

1. **동점 정렬 키를 `id` 사전순으로 둔 것이 맞는가** — 동점 자체가 데이터 결함 신호이므로, 조용히 하나를 고르는 대신 개발 빌드에서 드러내는 편이 나을 수 있다. 리포트 경로가 데이터 저장소에만 있어 앱에서 어떻게 알릴지 미정.
2. **`local-observances.json` 을 언제 싣는가** — B2 `scope` 오버레이 전까지 안 싣기로 했으나, 본당 지정이 설정에 생기면 캘린더 묶음으로 옮겨야 한다.
3. **전례년 경계의 사용자 표시** — 12월 말에 "가해"에서 "나해"로 넘어가는 것을 UI 가 어떻게 알릴지는 ADR-038 몫이지만, 엔진이 `liturgicalYearOf` 를 공개 API 로 낼지 정해야 한다.
4. ~~**`vigil`(전야) 모델**~~ **해소 2026-09-01** — 근거였던 12.31 거룩한 이름 예수 전야가 **감사성찬례가 아니었다**. 거룩한 이름 예수 축일(1.1) 전날의 **저녁기도**이고(사용자 확인), 그 레코드에만 복음이 없던 것이 그 증거였다 — 종전 923건 중 유일. 성무일과로 판정해 데이터에서 제외했다(data PR#23). **엔진이 만들 모델이 없다** — 전야는 모델의 빈틈이 아니라 잘못 실린 레코드였다. ADR-036 미결10 의 이 갈래도 함께 닫힌다.
5. ◐ **사계재 조인 — 절반 닫혔다**(2026-08-29, data PR#17 · ADR-036 미결13). **요일 배정은 확정**됐다(수=성직자·금=성직후보자·수도자·토=모든 신자, 네 계절 공통, 기도서 확인) 그리고 16건 전부 `weekday` 를 갖는다. **남은 것은 계절 식별자다** — 사계재 계절이 양쪽 모두 한국어 `name` 안에만 있어(temporal `coord_name: null`, 본문 `season: null`) 오늘의 조인은 이름 부분문자열에 기댄다(§5.4). 표기가 바뀌면 조용히 끊어지므로 **양쪽에 명시적 기계 키를 넣는 것이 데이터 쪽 후속 과제**다. 그때까지 엔진은 부분문자열 조인을 쓰되 그 취약함을 알고 써야 한다.
6. **`precedence: 7` 동률의 tie-break** — `minor_feast`(96)와 `commemoration`(16)이 같은 값이다. 규정에 순서가 없어 §5.3 의 안정 정렬로 결정성만 확보했다. 실제로 두 날이 겹치는 사례가 있는지부터 확인해야 한다(없으면 문제도 없다).
7. ~~**`national` 4건의 본문 조인이 어긋난다**~~ **해소 2026-08-29** — 실측하니 **4건 모두 조인된다**(삼일절 03.01 · 광복절 08.15 는 `date`, 설날 · 추석은 `lunar` 1-1 · 8-15). 「2건만 나온다」는 `date` 만으로 맞춰 본 결과였다 — 음력 두 건이 떨어져 나갔던 것이다. §5.4 가 이미 키를 `date` + `lunar` 로 적고 있으니 규정은 그대로고, 집계가 틀렸다. **엔진 함의**: 날짜 인덱스를 만들 때 `lunar` 를 같은 인덱스에 넣지 않으면 이 네 날이 조용히 빈다.
8. ~~**주일 주기(A/B/C)의 기준 연도가 저장소 어디에도 없다**~~ **해소 2026-08-29** — **2026년 = 가해(A)**(사용자 확정). §4.7 에 기준 연도와 유도 규칙(`N % 3` → 1 A · 2 B · 0 C), 그리고 대림 경계 네 날(2025-11-29/30 · 2026-11-28/29)을 회귀 케이스로 적었다. 데이터에는 날짜와 주기를 함께 가진 레코드가 없어(고정일 「모든 성인의 날」 4건뿐) 실측 교차 검증은 못 했다 — **A1 구현 시 실제 연도의 주일 독서를 교구 달력과 대조해 확증할 것.**
9. ~~🔴 **옮겨온 축일을 목적지 날짜에서 찾는 경로가 없다**~~ **해소 2026-09-05** — §6.5 이동 패스를 신설했다. 연도 캐시에 `transfers`(도착·출발 색인)를 두고(§4.9), `resolveDate` 의 후보 출처에 ⑤ 도착 이동을 더하고(§5.5), 후보를 `Candidate` 래퍼(`status`·`from`·`to`·`displacedBy`)로 바꿨다(§1.3 ⑤). 패스는 날짜 순 단일 루프로 결정적이고, 해를 넘기는 이동은 `Y−1` 의 spill 을 seed 로 받아 깊이 1 재귀로 닫는다. 설계 과정에서 드러난 것 셋을 새 미결로 갈랐다 — 데이터의 재의 수요일 `transferable: false`(미결13), prec 3 동률(미결14), 선택 봉헌을 켜는 설정(미결15), 연쇄 모델의 사제 확인(미결17). §6.3 ② 의 「B 는 성주간에 겹칠 수 없다」도 실측으로 틀린 것이 드러나 정정했다. ADR-037 §6 의 `candidates` 계약을 함께 개정했다.
10. 🔴 **주님의 세례가 좌표를 둘 요구한다** — 이 날은 성탄 절기 안이라 연중 주차 조회를 건너뛰는데, 동시에 **연중1주일** 좌표도 내야 한다(정본 전사: 「성탄절기: 성탄일부터 주의 세례 주일(연중1주일)까지」). `resolveDate` 는 `coord` **하나**로 규정돼 있어 문서대로 따르면 둘 중 하나가 빠지고 그날의 후보·독서 경로가 통째로 사라진다. **다중 좌표 표현을 정하고 이 날을 조회·테스트에서 명시적 특례로 둘 것.**
11. 🔴 **`findReadings` 에 성인 공통 폴백이 없다** — `findCollects` 는 `has_proper: false` 인 성인을 `sanctoral_class` 로 `commons.json` 에 넘기는 폴백이 §5.6 에 있는데, 독서 쪽에는 같은 규칙이 없다. `commons.json` 은 **분류별 독서를 이미 갖고 있다**(7분류 22세트 — `anniversary` 만 0, 그건 「고정 전례독서 없음」이 맞다). 규칙이 없어서 못 쓰는 것뿐이다. 고유 본기도를 가지면서 고유 독서가 없는 날(프란시스 사베리오 12.03)도 이 폴백이 있어야 독서가 나온다. **`findReadings` 폴백을 §5.6 에 정의할 것** — 대안 세트가 여럿이면 `set_no` 그룹으로 낸다는 점까지.
12. 🔴 **날짜 인덱스가 1:N 인데 좁히는 규칙이 없다** — §5.4 의 `date → Entry[]` 는 그 날의 본문을 **전부** 준다. `findReadings(resolved, observance)` 는 고른 관측일 **하나**의 본문을 내야 하므로 좁히는 규칙이 필요한데, 정해 두지 않았다. 실측(2026-09-01)으로 확인한 충돌은 다음과 같다.

    | 날짜 | 성인력 행 | 본문 레코드 | 무엇이 문제인가 |
    |---|---|---|---|
    | 12.25 | 3 (성탄 낮·밤·새벽) | 6 | 셋이 **다 본문을 가진다**. 낮을 물었는데 밤이 섞이면 결손이 아니라 **오답**이다 |
    | 08.15 | 2 (광복절·성모안식) | 3 | 마찬가지로 둘 다 본문을 가진다 |
    | 09.29 | 2 (대한성공회 설립 기념일·성 미카엘과 모든 천사들) | 1 | 그 한 레코드의 이름이 **`성 미카엘과 모든 천사들 / 대한성공회 설립 기념일`** — 슬래시로 합쳐져 **양쪽 다 이름 조인에 실패한다** |
    | 12.31 | 2 (실베스터·위클리프) | 1 | 그 레코드는 `성탄주간` 이라 **둘 중 누구의 것도 아니다.** 날짜만으로 집으면 엉뚱한 본문이 붙는다 |
    | 01.01 · 03.01 · 05.03 · 09.14 · 11.01 | 각 2 | 1~4 | 한쪽만 본문을 가진다 — 본문 없는 쪽을 물어도 있는 쪽 것이 나온다 |
    | 02.14 · 06.09 · 08.05 · 09.04 | 각 2 | 0 | 오늘은 무해하다(본문이 없다). 생기면 위 갈래로 옮겨간다 |

    **방향**: `date`(+`lunar`)로 뽑은 뒤 관측일의 `name`·`aliases` 로 좁힌다. 다만 그것으로 닫히지 않는 잔여가 위 표의 09.29·12.31 이다 — 전자는 **데이터의 이름이 두 관측일을 하나로 합쳐** 놓았고, 후자는 **날짜만 같은 남의 본문**이다. 이름 조인의 불안정성은 §5.4 가 이미 표로 적어 두었다. **본문 레코드에 안정적인 `sanctoral_id` 참조를 넣는 것이 근본 해법**이고 데이터 쪽 과제다(ADR-036 §10 「잠정 순번 id 를 키로 쓰지 말 것」과 같은 계열 — `local-observances` 는 이미 `patron_refs[].sanctoral_id` 로 그렇게 하고 있다). 그때까지 엔진은 이름 조인을 쓰되 **좁히기에 실패하면 빈 결과가 아니라 후보 전부를 내고 뷰가 고르게 할지**를 정해야 한다 — 조용히 하나를 고르는 것만은 하지 않는다. 규칙이 정해지면 §7 에 12.25 세 갈래와 09.29 를 회귀 케이스로 넣을 것.
13. 🔴 **재의 수요일이 `transferable: false` 다(데이터)** — ADR-036 §7 규칙 2 와 temporal 행의 `note` 는 「설과 겹치면 다음날로」라 적었는데 규칙 열이 비어 있다. **2032-02-11 에 실제로 겹친다**(KASI 범위 안 유일). 엔진은 데이터가 말하는 대로만 옮기므로(§6.2) 그해 재의 수요일은 설에 밀린 채 옮겨지지 않는다. `transferable: true` · `transfer_to: "next_day"` 로 고치는 것이 데이터 저장소 과제 — `calendar/` 표에서 고치고 파서를 다시 돌리면 된다. 고치면 §7 ④ 의 skip 케이스를 켠다.
14. **`precedence: 3` 동률의 tie-break 확인** — 성체일 ∧ 성모 방문(2029·2040) · 성체일 ∧ 성 세례 요한 탄생(2038). §6.2 는 「규칙일(temporal) 유지 · 고정일(sanctoral) 이동」을 잠정 규칙으로 두었다 — 로마 우선순위표가 주님의 대축일을 성모·성인 위에 두는 것과 같은 결과다. **사제 확인 대상.** 미결6(prec 7 동률)과 같은 계열이지만 이쪽은 실제 연도가 있어 먼저 확인해야 한다.
15. **선택 봉헌을 켜는 설정** — 공현(1.2~1.8 주일)·모든 성인(10.30~11.5 주일)·승천(부활7주일)·주의 봉헌(가까운 주일)의 「옮겨 지킬 수 있다」는 엔진이 `optional` 후보로 목적지 주일에 얹기만 한다(§6.2). 어느 설정이 그것을 승자로 올리는가(본당 단위 일괄인지, 축일별인지, ADR-036 B2 `scope` 와 묶이는지)는 ADR-038 의 몫이다. 설정이 생기기 전까지 뷰는 `optional` 을 「이 주일에 옮겨 지킬 수 있음」 안내로만 쓴다.
16. **2026년 이동 결과의 교구 달력 대조** — 미결8 이 주기(A/B/C)에 대해 요구한 것과 같은 확증이 이동에도 필요하다. 2026년에 실제로 옮겨지는 두 건 — 마티아 5.14 → 5.15(승천), 성모 방문 5.31 → 6.1(삼위일체) — 이 서울교구 달력과 일치하는지 A1 구현 시 확인할 것. 데이터에는 날짜와 이동 결과를 함께 가진 레코드가 없어 데이터만으로는 못 확인한다.
17. **동률 이동의 모델 — 연쇄(도착 우선) vs 건너뜀(재위 우선) 사제 확인** — §6.2 ① 은 기도서 「다음날」 문언과 미국 성공회 달력 표기(lectionarypage.net 2025~2027)를 근거로 **연쇄**를 택했다: 2027 년 스테파노 → 12.27, 요한 → 12.28, 어린이들 → 12.29. 영국 성공회 Common Worship 은 밀린 하나만 12.29 로 보낸다(스테파노 12.29, 요한·어린이들 제자리). 대한성공회 실제 표기는 스크랩 원료에 실제 연도 날짜가 없어 확인 못 했다 — 2027년 12월 교구 달력(또는 2021년 12월, 같은 요일 배치) 하나면 판정된다. 뒤집히면 §6.2 ① 한 줄과 §7 ② 한 케이스만 바뀐다.
18. **같은 고정 날짜에 정의된 두 관측일의 `official`** — §6.5 는 고정일끼리를 충돌로 보지 않아 옮기지 않는다(9.29 미카엘 ∧ 설립 기념일 등 다섯 쌍). 그러면 그날의 승자는 prec 로 미카엘이 되고 설립 기념일은 `proper` 로 남는데, 본기도 데이터는 둘을 **한 레코드**로 합쳐 두었다(§5.4 · 미결12 의 09.29 항). 뷰가 「미카엘 (설립 기념일 함께)」로 내야 하는지, B1 절차 ⑤ 대로 낮은 쪽을 생략해야 하는지, 데이터에 동시 봉헌 표지(`co_observed_with`)를 넣어야 하는지 정해야 한다. 8.15 광복절(prec 7) ∧ 성모안식(3) 처럼 한쪽이 prec 7 인 네 쌍은 규정상 「생략」이지만 국가일·기념일을 축일 그늘에서 지우는 것이 맞는지 확인 대상. 미결12(1:N 좁히기)와 함께 풀어야 한다 — 같은 날짜, 같은 두 행이다.
