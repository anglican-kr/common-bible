## 3. 배치와 계층

### 3.1 모듈 위치

엔진은 `js/app/liturgical-engine.js` 한 파일이고, **다른 모듈에 의존하지 않는다**(ADR-034의 leaf. 그 정의는 「밖으로 나가는 의존 0」이다). `data-fetch.js`, `verse-spec.js`도 그렇다. ADR-034는 앱의 모듈을 셋으로 나눈다. 혼자 도는 모듈은 다른 모듈에 의존하지 않고, 화면 모듈은 한 화면을 그리며, 조정 모듈은 화면 사이를 오가며 여러 모듈을 호출한다.

```
혼자 도는 모듈 : verse-spec.js · data-fetch.js · overlay.js · [liturgical-engine.js]
화면 모듈      : views.js · bookmark-read.js · [lectionary.js] · [calendar.js]
조정 모듈      : routing.js · bookmark.js
```

- **허용하는 의존**: 없다. 계산과 조회 모두 엔진 안에서 끝난다. 독서 본문을 그리는 것은 화면의 일이므로, 장을 받는 `loadChapter`와 절 범위를 다루는 `verse-spec.js`의 함수도 엔진이 아니라 `lectionary.js`가 호출한다.
- **금지**: `views.js`, `routing.js`, `lectionary.js`, `calendar.js`를 가져오면(import) 순환 의존이 생긴다. 화면이 필요로 하는 훅은 거꾸로 가져오지 않고 주입한다(ADR-034의 `initBookmarkGestures` 선례).
- **`window`에 아무것도 붙이지 않는다.** 새 모듈은 순수 ESM이라 `export`로만 내보낸다(`bookmark-core.js` 선례. 이 모듈도 `window`에 붙이는 것이 없다). 엔진 파일에는 `window`가 한 번도 나오지 않는다.

### 3.2 파일 골격

```js
// @ts-check   ← 관례일 뿐 — js/ 는 지시문 없이도 검사된다(checkJs, ADR-012). 검사에서 뺄 때만 첫 줄을 // @ts-nocheck 로
"use strict";

// Liturgical calendar engine (ADR-037 §6). Leaf module: no imports, no DOM.
// Two-phase API — callers await preloadCalendar()/preloadLectionary() once,
// then the resolve/find functions are synchronous and pure over the loaded
// tables. See docs/design/liturgical-engine.md §3.4 for why.

/** @typedef {import("../types").LiturgicalCoord} LiturgicalCoord */
/** @typedef {import("../types").Observance} Observance */
/** @typedef {import("../types").Candidate} Candidate */
/** @typedef {import("../types").ResolvedDate} ResolvedDate */

// 모듈 상태 — 블록 밖에 두고 테스트가 prelude 로 재선언한다
const anchorCache = new Map();                 // §4.9
const spansCache = new Map();                  // §4.10
const transferCache = new Map();               // §4.9 · §6.5
const activatedOptionals = new Set();          // §6.2 활성화 계약 — 바뀌면 transferCache 를 비운다
const DATA_DIR = "/data";                      // data-fetch.js does not export it
/** @type {CalendarIndex | null} */
let calendarIndex = null;
/** @type {Promise<CalendarIndex> | null} */
let calendarPromise = null;
// … lectionary 쪽 같은 2쌍, 반절 경계 표의 재시도 상태 2개(§3.5)

// ── BEGIN LITURGICAL_CORE ──          A1-a 계산(§4)
// ── END LITURGICAL_CORE ──

// ── BEGIN LITURGICAL_LOOKUP ──        A1-b 조회(§5) · B1 판정(§6) — 인덱스를 인자로 받는 순수 함수
// ── END LITURGICAL_LOOKUP ──

// ── BEGIN LITURGICAL_PRELOAD ──       fetch · 프리로드 · 공개 래퍼 — 모듈 상태를 읽는다
// ── END LITURGICAL_PRELOAD ──

export { … };
```

화면과 검색이 함께 쓰는 공유 타입은 `js/types.d.ts`에 둔다(`BibleChapter` 선례). `LiturgicalCoord`, `Observance`, `Candidate`, `ResolvedDate`와, 본문 조회가 돌려주는 `ReadingGroup`, `CollectOption`, `CandidateCollects`, `HalfVerse`가 여기에 있다. 엔진 안에서만 쓰는 구조(`YearAnchors`, `TransferPass`, `CalendarIndex`, `LectionaryIndex`, 본문 레코드)는 파일 안의 `@typedef`로 둔다.

### 3.3 마커 블록을 셋으로 나눈다 (§6에서 벗어나는 점 ①)

마커 블록은 `// ── BEGIN 이름 ──`과 `// ── END 이름 ──` 사이의 코드다. 유닛 테스트가 이 구간만 잘라 vm에서 실행한다(ADR-013). ADR-037 §6은 `LITURGICAL_CORE` 블록 하나를 정했는데, 이 설계는 셋으로 나눈다.

- **`LITURGICAL_CORE`**(A1-a 계산): 날짜 산술, 부활절 계산, 규칙 평가와 오프셋 전개, 절기 구간, 연중 주차, 주기 산정, 음력 조회, 기간 축(§4.10). 밖에서 받는 표가 `ordinal-weeks`, `kasi-lunar` 둘뿐이라 테스트의 prelude 스텁이 가볍다.
- **`LITURGICAL_LOOKUP`**(A1-b 조회와 B1 판정): 표 인덱스 만들기, 격자 좌표, 후보 집합 조립과 정렬, 좌표 폴백 매칭, 독서와 본기도 찾기, 우선순위와 옮김과 색 판정, 재일, 연도 단위 옮김 계산(§6.5). 함수마다 읽을 인덱스를 인자로 받는다. 이 블록이 건드리는 모듈 상태는 옮김 계산 캐시(`transferCache`)와 선택 봉헌 활성화 집합(`activatedOptionals`) 둘뿐이다.
- **`LITURGICAL_PRELOAD`**: fetch, 두 묶음 프리로드(§3.4, §3.5), 공개 래퍼(`resolveDate`, `findReadings`, `findCollects`, `findHalfVerse`). 모듈 상태(프리로드 promise, 인덱스)를 읽는 코드라 위 두 블록에 섞지 않는다. 그래도 블록으로 감싸는 이유는 C-3.4-1, C-3.4-2(프리로드 전 예외, 실패한 promise 비우기, 동시 진입에도 fetch 1회)를 vm 하네스로 검증하려면 잘라 낼 구간이 있어야 하기 때문이다. `data-fetch.js`의 `DATA_FETCHING` 블록(fetch 래퍼, 블록 밖 상태, 테스트 prelude)이 선례다.

**근거**: 한 블록에 다 넣으면, 계산만 검증하려는 테스트도 조회용 표 스텁을 모두 만들어야 한다. 지금 두 블록을 합치면 약 1,900줄이다. `verse-spec.js`가 이미 `VERSE_SPEC`과 `VERSE_SERIALIZE` 두 블록으로 같은 일을 한다. 블록 둘은 같은 vm 컨텍스트에서 차례로 실행할 수 있다(`bookmark-read.test.js`가 `VERSE_SPEC`을 먼저 실행하는 선례). 그래서 조회 테스트에서 계산 함수를 진짜로 쓸 수 있다.

블록 안의 제약(ADR-013 하네스)은 다음과 같다.

- `import`와 `export`를 쓰지 않는다.
- 함수는 반드시 `function` 선언으로 쓴다. 화살표 함수를 담은 `const`는 vm 컨텍스트에서 꺼낼 수 없다.
- `document`, `window`에 접근하지 않는다.
- 모듈 상태 `let`은 블록 밖에 두고, 테스트가 prelude로 다시 선언한다.

### 3.4 두 단계 API — 프리로드 후 동기 조회 (§6에서 벗어나는 점 ②)

ADR-037 §6은 `resolveDate(dateStr)`만 적었다. 이 설계는 이 함수를 **async로 두지 않는다.**

```js
await preloadCalendar();          // 작은 표 다섯
const day = resolveDate("2026-04-05");   // 동기 · 순수
```

**근거는 셋이다.**

1. **캘린더 월간 화면은 한 번에 42칸을 그린다.** `resolveDate`가 async면 promise 42개를 맞춰야 하고, ADR-038 §2가 순수 함수로 정한 `buildMonthGrid`, `buildWeekStrip`, `buildAgendaList`도 async가 되어 버린다. 지금 있는 것은 월간 화면의 `buildMonthGrid`(`js/app/calendar.js`)이고, 나머지 둘은 캘린더 2단계(주간, 목록)의 것이다.
2. **같은 파일을 여러 번 받는 일이 구조적으로 사라진다.** `data-fetch.js`의 캐시는 값을 담는 캐시라, 같은 순간에 여러 번 호출하면 fetch가 여러 번 나간다(지금 코드의 알려진 한계). 42칸이 저마다 로드를 시도하면 이 한계가 그대로 드러난다. 프리로드를 따로 두면 들어오는 곳이 한 곳이라 이 문제가 생기지 않는다.
3. **테스트가 쉬워진다.** 순수 동기 함수는 표를 인자로 넘겨 바로 검증할 수 있다.

프리로드 전에 동기 API를 호출하면 **분명한 오류를 던진다**: `throw new Error("preloadCalendar() must be awaited before resolveDate()")`. 조용히 빈 값을 주면 화면이 "그날은 아무 날도 아님"으로 잘못 그린다.

프리로드는 안에서 **값이 아니라 promise를 캐시한다.** 화면 두 곳이 동시에 들어와도 fetch는 한 번이다.

**실패한 promise는 캐시하지 않는다.** `??=`만 쓰면 일시적인 네트워크 오류로 한 번 거부된(reject) promise가 영영 남는다. 그러면 사용자가 화면에 다시 들어와도 fetch를 다시 시도하지 않고 같은 오류만 바로 다시 던진다. 오프라인에서 한 번 열면 온라인이 되어도 달력이 계속 깨진 채로 남는다는 뜻이다. 그래서 거부되면 캐시를 비워 다음 진입이 다시 시도하게 한다.

```js
function preloadCalendar() {
  return (calendarPromise ??= Promise.all(CALENDAR_FILES.map(fetchLectionaryJson))
    .then(([sanctoral, temporal, periods, ordinalWeeks, kasi]) => {
      transferCache.clear();
      return (calendarIndex = buildCalendarIndex({ sanctoral, temporal, periods, ordinalWeeks, kasi }));
    })
    .catch((e) => { calendarPromise = null; throw e; }));   // 재시도 가능하게
}
```

인덱스가 새로 서면 옮김 계산 캐시도 비운다(§4.9). 독서 묶음 프리로드(§3.5)도 같은 처리를 한다. 캐시 대상이 둘이라 한쪽만 고치면 증상이 절반만 사라진다.

### 3.5 데이터를 두 묶음으로 나눈다 (§6에서 벗어나는 점 ③)

`/data/lectionary/` 전체는 약 2MB다. 캘린더 한 달을 그리는 데 그 전부가 필요하지는 않다. 크기는 2026-10-23에 다시 쟀다.

| 묶음 | 파일 | 크기 | 언제 |
|---|---|---|---|
| **캘린더** | `sanctoral`, `temporal-feasts`, `periods`, `ordinal-weeks`, `kasi-lunar` | 약 108KB | 캘린더 탭에 들어갈 때, `resolveDate` 전에 |
| **독서** | `eucharist-readings`, `eucharist-collects`, `commons`, `canticles`, `half-verses` | 약 1.6MB | 독서 화면에 들어갈 때, `findReadings`, `findCollects`, `findHalfVerse` 전에 |
| **지역** | `local-observances` | 약 88KB | ADR-036 B2 `scope` 오버레이(이번 범위 밖) |

**근거**: 캘린더는 "그날이 어떤 전례일인가 + 무슨 색인가"만 알면 되고, 그것은 정의 표에서 나온다. 1.2MB짜리 독서 파일을 달력을 열 때마다 받게 하면 첫 진입이 느려지고, 오프라인 캐시에 미리 받아 둘 양도 필요 이상으로 커진다. 큰 묶음은 독서 화면으로 들어가는 순간에만 싣는다.

`local-observances.json`은 B2 전까지 아예 싣지 않는다. 본당과 교구 오버레이가 없으면 쓸 데가 없다.

`half-verses`(반절 경계 표, 2026-10-22)는 독서 묶음과 함께 받지만, 받지 못해도 묶음을 막지 않는다. 그때는 인덱스를 빈 표로 세워 반절 대신 절 전체를 그린다. 묶음 promise는 그대로 캐시하고, 다음 진입마다 이 표만 뒤에서 다시 받는다. 받으면 그다음 그리기부터 반절을 그린다. 큰 표 넷을 다시 받지 않으므로, 다시 그릴 때 「불러오는 중…」이 비치지 않는다. §3.4의 「조용히 빈 값을 주지 않는다」에서 벗어나는 표는 이것 하나다. 업데이트 뒤 처음 오프라인으로 열면 데이터 캐시에 이 표만 없을 수 있기 때문이다(PR #365 리뷰).

### 3.6 등록 세 곳 (빠뜨리면 실행 중에 깨진다)

1. **`routing.js`의 한꺼번에 받는 묶음. `index.html`에는 태그를 달지 않는다**(2026-10-17부터, ADR-038 §2 「구현」). 교회력 모듈은 `routing.js`가 그 화면에 처음 갈 때 `import()`로 불러온다. 새 화면 모듈을 만들면 `loadCalendarView`, `loadLectionaryView` 같은 묶음을 하나 더 둔다. 엔진처럼 화면 모듈이 가져오는 모듈은 그 화면들의 묶음에 더한다. `tests/unit/sw.test.js`가 「묶음 = 그 화면 모듈의 정적 import − 부팅 그래프」와 「import() 대상은 부팅 그래프 밖」을 대조한다. 태그를 달거나 부팅 모듈에서 정적으로 가져오면 테스트가 실패한다. 그렇게 하면 첫 방문의 부팅이 세 모듈을 다시 받기 때문이다(느린 4G 첫 화면 +390ms, 원장 `docs/changes/2026-10-17-lazy-liturgical-modules.md`).
2. **`sw.js` 셸 캐시 목록**: 새 JS 파일을 미리 받아 둘(프리캐시) 목록에 더한다. 빠뜨리면 `tests/unit/sw.test.js`가 잡는다. `<script>` 태그와 목록이 맞는지에 더해, ESM `import`로 닿는 모듈이 모두 목록에 있는지까지 대조한다(#319).
3. **`sw.js` `cacheNameFor()`**: `/data/lectionary/`를 `DATA_CACHE`로 보내는 라우팅(ADR-037 §7, ADR-038 §5의 요구)은 PR 0(#319, 2026-09-01)이 갖췄다. 그전에는 이 한 줄이 빠져 전례 JSON 11건이 `SHELL_CACHE`에 들어가, 콘텐츠 해시로 무효화되지 못했다. 지금은 라우팅이 있고, `sw.test.js`가 「매니페스트가 추적하는 접두사는 전부 `DATA_CACHE` 로 간다」를 대조한다. 그래서 새 데이터 디렉터리를 매니페스트에 넣고 라우팅을 빠뜨리면 테스트가 잡는다. **엔진 PR이 여기서 할 일은 없다.**
