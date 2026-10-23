# ADR-018: app.js 모듈 분할 (modularization)

- 일시: 2026-05-09
- 상태: 승인됨 — 완료 (Phase 1-8 종료, 2026-05-10)
- 관련 설계 문서: `docs/archive/design/app-modularization.md`

## 결정

`js/app.js`(그때 6,082줄)를 도메인별 모듈로 나눈다. 각 모듈은 `js/app/<name>.js` 파일에 둔다. 모듈 시스템은 ESM(`<script type="module">`)이다(ADR-019, 2026-05-09). 여러 스크립트를 불러와 전역 `window.X`로 내놓던 처음 방식은 아래 「검토한 대안」에 있다. 모듈마다 `// @ts-check`를 계속 켜 두고, 함수 매개변수에 JSDoc을 달고, ADR-012 1라운드의 도메인 타입 가드를 유지한다.

목표는 ADR-012 1라운드를 마칠 때 미뤄 둔 일을 모듈 단위로 하나씩 들이면서 자연스럽게 이루는 것이다. 미뤄 둔 일은 `// @ts-check`를 계속 켜 두는 것과 `tsconfig.app.json`을 지우는 것이다.

**결과(2026-05-10).** Phase 1-8의 PR 여덟 개로 `js/app.js`를 6,082줄에서 283줄로 줄이고, 9개 도메인 모듈로 나눴다. `js/app/`의 여덟 모듈(`helpers.js`, `storage.js`, `settings-ui.js`, `install.js`, `search.js`, `reading-context.js`, `bookmark.js`, `views-routing.js`)과 남은 `js/app.js`다. `js/app.js`에는 부트스트랩, 접근성 키 처리, 오디오 캐시 정리(ADR-016), 서비스 워커 등록만 남았다. ESM 일괄 전환(ADR-019)도 함께 마쳤다. 그 뒤 ADR-034가 다시 너무 커진 모듈(`views-routing.js`, `bookmark.js`)을 하는 일별로 나눴다.

계획한 분할 단계(PR 8개)는 다음과 같다. 실제와 달라진 것은 항목 끝에 적었다.

1. `helpers.js` (약 70줄): `el`, `clearNode`, `_$`, `announce`, `trapFocus`, `chUnit`. 뒤의 모든 모듈이 이 모듈에 의존한다.
2. `storage.js` (약 250줄): localStorage 헬퍼 묶음.
3. `settings-ui.js` (약 600줄): 설정 팝오버와 외관 적용.
4. `install.js` (약 430줄): PWA 감지와 설치 안내 모달.
5. `search.js` (약 990줄): 검색 전체(sheet와 기록 패널 포함).
6. `bookmark.js` (약 1,800줄) + `state.js`: 북마크 전체를 옮기고, 여러 모듈이 함께 쓰는 상태(`_currentBookId`/`_currentChapter`/`_verseSelectMode`/`_selectedVerseRefs`)를 따로 뺀다. 실제로는 공유 상태 모듈의 이름을 `js/app/reading-context.js`로 했다(아래 「공유 상태」).
7. `views-routing.js` (약 1,400줄): 라우팅, Views, 오디오, 당겨서 새로 고침(PTR), Compact header.
8. `app-main.js` 부트스트랩 + `tsconfig.app.json` 최종 삭제 (Phase 8). 실제로는 `app-main.js`를 따로 만들지 않고 부트스트랩을 `js/app.js`에 남겼다. `tsconfig.app.json`은 계획대로 지웠다.

## 맥락

ADR-012 1라운드(PR-1-7, 2026-05-09 머지)에서 `js/app.js`에 JSDoc과 null 가드, 도메인 타입 가드를 들였다. 그때 메인 `tsconfig.json` 검사 환경에서 `// @ts-check`를 붙여 보니 **implicit any가 약 262건** 나왔다(함수 매개변수 약 150, 모듈 상태 약 30, index access 약 17 등). PR 하나로 정리하기에는 변경이 너무 크다. 5,800줄 단일 파일에 엄격한 타입을 입히는 일은 모듈 분할과 함께 하는 편이 자연스럽다.

이 작업은 앞으로 할 저장소 분할(monorepo split)의 기반이기도 했다. 그때는 일정을 정하지 않았고, 계획은 다음과 같았다.

- **앱 저장소**(root): `index.html`, `js/**`, `css/**`, `sw.js`, 빌드와 배포 스크립트
  - **데이터(성서) 서브모듈**: `data/source/`(그때 이미 `anglican-kr/common-bible-text` private submodule), parser 출력 JSON 포함
  - **데이터(오디오) 서브모듈**: `data/audio/` MP3, 수백 MB
- **서버(nginx) 저장소**(별도): 운영 nginx 설정, BFF `/oauth/token` location 블록. 운영 인프라라 코드와 수명 주기가 다르다.

데이터 두 저장소는 git submodule로 앱에 들어가므로 저장소를 내려받을 때(clone) `git submodule update --init`만 하면 함께 보인다. 그래서 앱 저장소가 혼자 서려면 내부 모듈 경계가 분명해야 하고, 이 모듈화가 그 앞선 작업이다. 실제 분할은 ADR-020(2026-05-11)이 정했다.

## 검토한 대안

| 방식 | 빌드 변화 | 시작 비용 | 채택 여부 |
| --- | --- | --- | --- |
| PR 하나로 한꺼번에 (`// @ts-check` + implicit any 약 262건 일괄 정리) | 없음 | 매우 크고 리뷰가 어렵다 | 채택 안 함 |
| Multi-script + `defer`로 모듈 분할 | 없음 | 단계별로 나눌 수 있다 | Phase 1-3에서 썼다. 2026-05-09에 ADR-019로 ESM으로 바꿨다(아래) |
| **ESM (`<script type="module">`)** | 없음 | module scope가 typedef와 함수를 서로 가리고, 빌드 단계 0을 유지한다 | **채택** (Phase 4부터, ADR-019) |
| `.ts` + tsc 빌드 | 크다 | ADR-001의 SPA 단순성과 어긋난다 | 채택 안 함 |
| 그대로 둔다 (`// @ts-check`를 계속 켜 두는 일을 미룬다) | 없음 | 0 | 채택 안 함 — 1라운드의 검증이 임시 인프라(`tsconfig.app.json`)에 계속 의존하게 된다 |

### IIFE + `<script defer>` + `window.appXxx`와 module-vs-script 예외 (2026-05-09까지)

- 처음에는 각 모듈을 IIFE로 감싸 한 객체(`window.app<X>`)로 내놓았다. 1차로 적용한 sync 레이어(`window.driveSync`, `window.syncTransport` 등)와 같은 방식이다. `index.html`에는 `<script defer>` 태그를 의존 순서대로 넣었다.

  ```js
  // js/app/helpers.js (Phase 1)
  "use strict";
  // @ts-check
  window.appHelpers = (() => {
    function _$(id) { /* ... */ }
    // ...
    return { _$, chUnit, el, clearNode, trapFocus };
  })();
  ```

  부르는 쪽은 `window.appHelpers._$()`로 부르거나, IIFE 바로 뒤에 `const { _$ } = window.appHelpers;`로 받았다.
- Phase 2(`storage.js`)에서 전역 함수 이름이 `js/sync/store-v2.js`와 겹쳐, 충돌한 모듈만 ESM으로 옮기는 예외(module-vs-script 예외)를 두었다.
- 채택 안 함 2026-05-09 · 이유: Phase 2와 Phase 3의 사용자 검토 결과, 모든 모듈을 ESM으로 한꺼번에 옮기기로 했다. 충돌이 날 때마다 모듈별로 정하면 두 방식이 섞이고, 뒤의 모듈도 비슷한 충돌을 겪을 가능성이 높다. 근거는 ADR-019 본문과 ADR-001 「단순성의 범위」(2026-05-09)에 있다. Phase 1-3에서 머지한 PR(#88·#89·#90)은 multi-script + `defer` 방식이었지만, 뒤의 일괄 전환 PR에서 ESM으로 맞췄다.

## 채택 방식

### 모듈 방식 (ESM, ADR-019)

Phase 4부터 이 ADR의 모듈 방식은 ESM이다. `<script type="module">`과 `export {};`를 쓰고, 필요하면 `import/export`를 쓴다. 1차 sync 레이어의 회귀를 막으려고 `window.X` facade(예: `window.driveSync`, `window.appHelpers`)는 남겨 두되, 모듈 사이의 새 호출은 `import`/`export`로 쓰기를 권한다. 그 뒤 ADR-034가 서로 순환하지 않는 facade를 명시적 import로 바꿨다.

### 공유 상태 (Phase 6)

`_currentBookId` / `_currentChapter` / `_verseSelectMode` / `_selectedVerseRefs`는 4-6개 섹션이 읽고 쓴다. 이 상태를 별도 모듈이 맡고 getter/setter를 내놓기로 했다(설계 문서 §5.1 Option A, 모듈 이름 `js/app/state.js`).

실제로는 2026-05-10에 `js/app/reading-context.js`로 나눴다. 사용자 검토에서 `state.js`라는 이름이 너무 추상적이라는 지적이 있었다. 함수로 된 getter/setter 대신 `readingContext` 객체 하나를 내놓고, 부르는 쪽이 필드를 직접 고친다(`readingContext.bookId = "gen"`). 스크롤을 따라 장마다 `chapter`를 쓰는 등 자주 도는 경로라, 객체 속성에 바로 접근하는 편이 가장 단순하다.

### 임시 인프라 처리

- `tsconfig.app.json`은 Phase 1-7 동안 두었다(`checkJs: true`, `noImplicitAny: false`).
- 모듈에 `// @ts-check`를 붙이는 때부터 그 모듈에는 엄격한 검사(메인 `tsconfig.json`의 `noImplicitAny: true`)를 적용했다.
- Phase 8에서 `tsconfig.app.json`을 지웠다.

### `index.html` / `sw.js` 영향

`index.html`에 모듈마다 `<script defer>` 태그를 더했다. Phase 4부터는 `<script type="module">`이다(ADR-019). 그때는 `sw.js`의 셸 캐시 목록에 새 모듈 파일을 더하고 `CACHE_NAME`을 올렸다. 지금은 셸 캐시 이름을 앱 버전에서 만든다(ADR-021).

## 검증

- 단계별 PR마다 `tsc -p tsconfig.app.json --noEmit`과 `tsc -p tsconfig.json --noEmit`이 모두 0 error여야 했다.
- 회귀: `tsc -p tsconfig.worker.json --noEmit`과 `node --test tests/unit/*.test.js`.
- **브라우저 동작 확인**: 단계마다 PR에서 로컬 SPA 서버로 콘솔 오류가 0인지 확인했다. 1라운드와 다른 점이다. 분할은 코드 위치를 옮기는 일이라, 불러오는 순서가 하나라도 빠지면 바로 실행이 깨진다.
- Phase 8 머지 뒤 e2e(`tests/e2e/*.py`)를 한꺼번에 돌렸다.

## 채택 이유 요약

- **나눈 단위로 implicit any를 정리한다.** PR 하나에 몰지 않고, 약 262건을 PR 여덟 개로 나눈다.
- **빌드 단계 0을 유지한다.** 브라우저가 원본 `.js`를 그대로 불러온다(ADR-019 채택 뒤에도 같다).
- **sync 레이어와 같은 방식을 쓴다.** Phase 1-3은 IIFE와 `window.appXxx`로 내놓았다. Phase 4부터는 ESM 모듈에 `window.X` facade를 남겼다(ADR-019).
- **앞으로의 저장소 분할에 대비한다.** 앱 저장소가 혼자 서려면 내부 모듈 경계를 먼저 분명히 해야 한다.
- **부수 효과**: 셸 캐시를 더 잘게 다룰 수 있고(모듈 하나가 바뀌면 그 파일만 다시 받는다), 읽는 부담이 줄고, 유닛 테스트를 들일 기회가 생긴다(설계 문서 §10).

## 결과

- Phase 8 머지로 ADR-012의 2차 적용 2라운드를 마쳤다. 그때 ADR-012에 `> 개정` 블록으로 적었고, 지금은 ADR-012 본문에 있다.
- `tsconfig.app.json`을 지워 메인 `tsconfig.json` 하나만 남았다.
- 앞으로 lazy load나 tree-shaking 같은 최적화를 할 길이 열렸다(별도 의제).

## 관련 ADR

- ADR-001: SPA 아키텍처. 빌드 단계를 피하는 출발점이다. 2026-05-09에 namespace 방식은 ESM으로 바뀌었다(ADR-001 「단순성의 범위」).
- ADR-012: TypeScript 점진 도입. 1라운드를 마쳤고, 이 ADR이 2라운드의 시작점이다.
- ADR-013: 클라이언트 JS 유닛 테스트 전략. 분할 뒤 유닛 테스트를 더할 기회가 생긴다(storage, verse spec, search worker 연결 같은 순수 로직).
- ADR-016: 오디오 캐시 LRU. `views-routing.js`의 오디오 플레이어를 나눌 때 오디오 캐시와의 의존이 맞게 유지돼야 한다.
- **ADR-019**: ESM 모듈 시스템 채택. Phase 4부터 모든 모듈을 ESM으로 옮겼다(위 「IIFE + `<script defer>` + `window.appXxx`와 module-vs-script 예외」의 근거).
