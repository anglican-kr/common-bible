# app.js 분할 리팩터링 — 설계 문서

> 이 문서는 `js/app.js`(현재 6,082줄)를 모듈 단위로 분할하는 다단계 작업의 진행 상황을 함께 추적한다. 각 단계 머지 후 갱신한다.
> 시점 고정 결정 기록은 ADR-018 + 본 문서의 진행 일지 참조.

- 작성: 2026-05-09
- 종료: 2026-05-10 (Phase 1~8 머지 완료)
- 상태: **완료** — `js/app.js` 6,082 → 283줄 (95% 감소), 9개 도메인 모듈 분할 + ESM 일괄 전환(ADR-019) + ADR-012 2차 라운드 종료
- 관련 ADR: ADR-001(SPA), ADR-012(TS 점진 도입, 1·2차 완료), ADR-013(유닛 테스트), ADR-016(오디오 캐시), ADR-018(본 의제), ADR-019(ESM)
- 1라운드 문서: `docs/design/app-typescript-migration.md`

---

## 1. 개요

### 1.1 목적

ADR-012 2차 적용의 **2라운드**. 1라운드에서는 `js/app.js`에 JSDoc + null/도메인 타입 가드를 도입했지만 `// @ts-check` 영구 활성화는 보류했다 — 5,800줄 단일 파일에 `noImplicitAny: true`를 일거에 적용하면 ~262 implicit any가 발생해 단일 PR로 정리하기 어려웠기 때문. 본 라운드는 그 보류 사유를 풀기 위한 작업으로, **모듈 분할(modularization)을 거치며 각 모듈에 `// @ts-check`를 옵트인**한다. 결과적으로:

- `js/app.js` → `js/app/<module>.js` 다수로 분할
- 각 모듈에 `// @ts-check` + JSDoc 시그니처 (함수 매개변수 implicit any 정리)
- 임시 `tsconfig.app.json` **삭제**, 메인 `tsconfig.json`만으로 검증 통일

### 1.2 대상 범위

- `js/app.js` (단일 파일) → `js/app/*.js` (다중 파일)로 점진 추출
- `js/types.d.ts` — 분할 시 모듈 간 공유되는 새 도메인 타입 추가 가능
- `index.html` — `<script>` 태그 갱신 (modular 패턴은 §5 참조)
- `sw.js` — 신규 모듈 파일을 셸 캐시에 추가, `CACHE_NAME` 증분
- `tsconfig.json` — 변경 없음 (이미 `js/**/*.js` include + `checkJs: false` opt-in)
- `tsconfig.app.json` — **마지막 단계에서 삭제**

### 1.3 비대상

- 빌드 단계 추가 (번들러/트랜스파일러 도입) — ADR-001 SPA 단순성 유지
- 동작 변경 — 본 작업은 코드 형태 갱신만, 런타임 동작 무변동
- sync 레이어 (`js/sync/*`, `js/drive-sync.js`, `js/search-worker.js`) — 1차 적용 완료, 변경 없음

---

## 2. 1라운드 종료 시점 출발점

- `js/app.js` 6,082줄, 41개 섹션
- 모듈 헤드 자산:
  - `// @typedef` 라인 12개 (L4-L18) — `js/types.d.ts`에서 import한 도메인 타입 alias
  - `_$` 헬퍼 (L37) — 모든 모듈 anchor의 `getElementById` cast
  - 모듈 수준 anchor ~60개 (L6-L60대)
  - 상수 (`COLOR_SCHEMES`, `FONT_SIZES`, storage key, division map 등)
  - `let` 모듈 상태 변수 ~30개 (1라운드에서 narrow 됨)
- 임시 검증 인프라: `tsconfig.app.json` (`checkJs: true`, `noImplicitAny: false`)
- 잔여 implicit any: 2라운드 시작 시 main `tsconfig.json`에 `// @ts-check` 추가하면 ~262건 발생

---

## 3. 의존 그래프 (Explore 조사 결과)

### 3.1 41 섹션 cross-section 호출 매트릭스 (top 15)

| 호출 수 | 호출처 → 정의처                               | 의미                  |
| ------- | --------------------------------------------- | --------------------- |
| 55      | Settings popover → Helpers                    | `el`/`clearNode` 호출 |
| 54      | Views → Helpers                               | 렌더링 재사용         |
| 39      | Bookmark tree rendering → Helpers             |                       |
| 22      | Install guide modal → Helpers                 |                       |
| 22      | Search → Helpers                              |                       |
| 22      | Views → Rendering helpers                     | `setTitle*` 등        |
| 21      | Search history panel controller → Helpers     |                       |
| 16      | Rendering helpers → Helpers (재귀)            |                       |
| 12      | Save bookmark modal → Helpers                 |                       |
| 11      | Audio Player → Helpers                        |                       |
| 11      | Drag & drop → Search history panel            | UI 동기화             |
| 10      | Bookmark tree → Bookmark storage helpers      |                       |
| 10      | Routing → Views                               | 페이지 전환           |
| 9       | Bookmark tree → Drag & drop                   | 위치 계산             |
| 9       | Search history panel → Search history helpers |                       |

**핵심 관찰**:

- **`Helpers` 섹션(34줄)이 병목** — `el`/`clearNode`/`_$`/`announce`/`trapFocus`/`chUnit` 때문에 거의 모든 모듈이 의존. 이 섹션을 *공통 모듈*로 별도 추출하면 모든 후속 분할이 단순해진다.
- **순환 의존 없음** — DAG. 분할 순서를 결합도 낮은 쪽부터 잡으면 자연스러움.
- **결합 high spot**: Bookmark tree(S35) ↔ Drag & drop(S20) ↔ Bookmark storage(S17) 영역. 한 모듈로 묶어야 할 후보.

### 3.2 모듈 상태 변수 공유

| 변수                                                  | 접근 섹션 수                     | 결정                                          |
| ----------------------------------------------------- | -------------------------------- | --------------------------------------------- |
| `_currentBookId`                                      | 6 (S23, S34, S36, S37, S39, S40) | 공용 state 모듈 또는 events                   |
| `_currentChapter`                                     | 6 (동일)                         | 동일                                          |
| `_verseSelectMode`                                    | 4 (S23, S24, S39, S40)           | 동일                                          |
| `_selectedVerseRefs`                                  | 3 (S23, S36, S39)                | 동일                                          |
| `_dragState`                                          | 1 (S20만)                        | bookmark 모듈 내부로                          |
| `currentAudio`, `_audioController`, `_audioSaveTimer` | Audio Player 내부                | audio 모듈 내부                               |
| `_swipedRow`                                          | 1 (S20)                          | bookmark 모듈 내부                            |
| anchor 상수 (~60개)                                   | 모듈별 분산                      | 각 모듈이 자기 anchor를 import 또는 자체 정의 |

`_currentBookId`/`_currentChapter` 등 광범위 공유 상태는 별도 `state.js` 모듈에 두거나 `app-main.js`에 남기는 게 낫다 — 분할 작업의 리스크가 가장 큰 부분.

### 3.3 자연 분할 후보 (Explore 권장)

| 모듈                 | 영역                                                                                                                                                         | 줄 수  | 결합도                                   | 단계 후보 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------- | --------- |
| **A. helpers**       | `el`, `clearNode`, `_$`, `announce`, `trapFocus`, `chUnit`                                                                                                   | ~70    | 의존 없음 (가장 먼저)                    | Phase 1   |
| **B. storage**       | Reading pos, Audio time, Search history, Font, Theme, Color, Book order, Bookmark storage, Install nudge                                                     | ~250   | 매우 낮음 (localStorage만)               | Phase 2   |
| **C. settings-ui**   | Settings popover, Icon recoloring, Color scheme apply, Theme apply, Book order apply, Launch screen                                                          | ~600   | 중간 (helpers + storage 의존)            | Phase 3   |
| **D. install**       | PWA detection, Install guide modal, Install nudge auto-show                                                                                                  | ~430   | 낮음 (자기 완결)                         | Phase 4   |
| **E. search**        | Search, Search input handlers, Search bottom sheet, Search history panel controller, search worker wire-up                                                   | ~990   | 중간                                     | Phase 5   |
| **F. bookmark**      | Verse spec, Bookmark query, Drag & drop, Bookmark UI, Bookmark tree rendering, Save modal, Merge dialog, Export/Import, Verse selection mode, Drawer toolbar | ~1,800 | **가장 높음** (내부 응집 + Views와 상호) | Phase 6   |
| **G. views-routing** | Views, Routing, Audio Player, Pull-to-refresh, Compact header, Verse spec utilities (일부), Rendering helpers, Data fetching                                 | ~1,400 | **가장 높음** (라우팅 허브)              | Phase 7   |
| **H. app-main**      | 모듈 헤드 typedef, anchor 정의, 공유 state 변수, 부트스트랩, SW 등록                                                                                         | ~250   | —                                        | (잔류)    |

총 ~5,790줄을 8개 파일로 분할. 잔여 ~290줄은 `js/app.js` 또는 `js/app/main.js`에 남는 부트스트랩 + 공유 state.

---

## 4. 모듈 시스템 결정 (검토)

### 4.1 옵션 비교

| 옵션                               | 빌드 변화 | 동기 초기화 보장                    | CSP 영향       | 글로벌 노출          | 비고                        |
| ---------------------------------- | --------- | ----------------------------------- | -------------- | -------------------- | --------------------------- |
| **Multi-script + `defer`**         | 없음      | 가능 (`defer` + `<script>` 순서)    | 각 파일 추가   | `window.X` 패턴 유지 | 현재 sync layer 패턴과 호환 |
| **ESM (`<script type="module">`)** | 없음      | 모듈 로드 순서가 import에 의해 결정 | entry script만 | import/export        | 의존 그래프 명확            |
| `.ts` + tsc 빌드                   | 큼        | —                                   | —              | —                    | ❌ ADR-001 위배             |

### 4.2 채택 (2026-05-09 갱신) — **ESM 일괄 채택** (Phase 4부터)

> Phase 1~3은 multi-script + `defer` + `window.X` 패턴으로 진행됐다. Phase 2 시점에 `storage.js`/`store-v2.js`가 ESM 옵트인했고, 사용자 review에서 ADR-001 단순성 가치를 절대화하지 않기로 합의 → **Phase 4부터 ESM 일괄 채택**. 자세한 결정 사유는 **ADR-019** + ADR-001 (2026-05-09) 개정 블록 참조.

원래 채택했던 Multi-script + `defer` 사유 (Phase 1~3 적용):

이유:

- ADR-001 SPA 단순성 유지 (빌드 단계 0)
- 현재 sync 레이어가 동일 패턴 (`window.driveSync`, `window.syncTransport` 등) — 일관성
- `defer` 속성으로 DOM 파싱 후 순서 보장 — 모듈 헤드의 anchor 캡처와 호환
- iOS Safari + 구형 브라우저 호환성 추가 보강 불필요

ESM은 매력적이지만 두 가지 부담:

1. 모든 모듈 헤드 anchor를 `_$` 호출로 즉시 캡처하는 현 패턴이 import 순서 + side effect 의존 → 디버깅 어려움
2. `index.html`의 ` <script defer src="/js/gtag-init.js">` + Google Analytics global 등 외부 스크립트와 `type="module"` 혼재 시 추가 정합 필요

### 4.3 모듈 namespacing 제안

각 모듈은 IIFE로 감싸 `window.appXxx` 한 객체에 export:

```js
// js/app/storage.js
"use strict";
// @ts-check
window.appStorage = (() => {
  /** @returns {ReadingPosition | null} */
  function loadReadingPosition() { ... }
  // ...
  return { loadReadingPosition, saveReadingPosition, ... };
})();
```

호출 측은 `window.appStorage.loadReadingPosition()` 또는 IIFE 직후 `const { loadReadingPosition } = window.appStorage;`로 받음. 이는 `js/sync/*`의 1차 적용 패턴과 동일.

대안: `helpers`만 글로벌, 나머지는 `<script>` 순서로 함수 정의 hoist만 의존하는 방식 (현재 app.js 패턴 그대로). 이 경우 namespace 오염은 늘지만 import/export 오버헤드 0. 단계마다 결정 가능.

---

## 5. 단계 계획 (8개 PR)

각 단계는 한 모듈씩 추출 + 그 모듈에 `// @ts-check` 영구 활성화 + 모듈 내부 implicit any 정리. 기본 흐름:

1. 추출할 영역의 함수/변수 식별
2. `js/app/<name>.js` 신규 파일에 코드 이전 (anchor + state + 함수)
3. 호출 측을 `window.appXxx.fn()`으로 갱신 또는 export 패턴 결정
4. `// @ts-check` 추가 + 함수 매개변수 JSDoc 추가
5. `index.html`에 `<script defer>` 추가
6. `sw.js` 캐시 매니페스트에 추가, `CACHE_NAME` 증분
7. `tsconfig.app.json` + 메인 `tsconfig.json` 모두 0 error 확인

### 진행 매트릭스 (예정)

| 단계    | 모듈               | 영역                                                                                                          | 라인 추정 | 핵심 위험                                                                                                 |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------- |
| Phase 1 | `helpers.js`       | `el`, `clearNode`, `_$`, `announce`, `trapFocus`, `chUnit`                                                    | ~70       | 모든 모듈이 의존 — 인터페이스 변경 시 광범위 영향. 가장 먼저 해서 후속 단계가 깨끗                        |
| Phase 2 | `storage.js`       | localStorage 헬퍼 묶음                                                                                        | ~250      | 거의 없음 (순수 함수)                                                                                     |
| Phase 3 | `settings-ui.js`   | Settings popover + 외관 (Color/Theme/Book order/Icon/Launch screen)                                           | ~600      | DOM 의존, 호출 측 갱신                                                                                    |
| Phase 4 | `install.js`       | PWA + 설치 안내 모달 + nudge                                                                                  | ~430      | 자기 완결                                                                                                 |
| Phase 5 | `search.js`        | 검색 + 시트 + 히스토리 패널 + 워커 wire-up                                                                    | ~990      | 워커 메시지 정합 (이미 1라운드에서 정리)                                                                  |
| Phase 6 | `bookmark.js`      | 북마크 전체 (UI + 트리 + 모달 + 드래그 + 절 선택)                                                             | ~1,800    | 가장 큰 단일 모듈. 공유 상태 (`_currentBookId` 등)가 Views와 얽힘 — 별도 `state.js` 또는 events 도입 검토 |
| Phase 7 | `views-routing.js` | Views + Routing + Audio Player + PTR + Compact header + Rendering helpers + Data fetching                     | ~1,400    | 라우팅 허브, 라우팅 변경 시 회귀 위험 가장 큼                                                             |
| Phase 8 | 최종 통합          | `app-main.js` 부트스트랩 + 공유 state + SW 등록. `tsconfig.app.json` 삭제. main `tsconfig.json` 0 error 확정. | ~250      | `tsconfig.app.json` 제거 검증                                                                             |

각 단계는 하나의 PR. 1라운드와 동일한 분할 정밀도.

### 5.1 공유 상태 처리 옵션 (Phase 6 핵심 결정)

`_currentBookId`/`_currentChapter`/`_verseSelectMode`/`_selectedVerseRefs`는 4~6개 섹션이 접근. 분할 시 두 옵션:

**Option A — 공유 state 모듈 `js/app/state.js`**

- 단일 module이 변수를 owns + getter/setter export
- 호출 측 `appState.getCurrentBookId()` / `appState.setCurrentBookId(x)`
- 장점: 명시적, 추적 가능
- 단점: 추가 boilerplate

**Option B — `app-main.js`에 잔류 + 글로벌 export**

- 현재 패턴 유지 (`window._currentBookId` 등)
- 장점: 변경 폭 작음
- 단점: namespace 오염

**Option C — 이벤트 기반**

- `_currentBookId` 변경을 `CustomEvent('chapter-change', { detail: { bookId, chapter } })`로 발행
- bookmark 모듈은 listener로 받음
- 장점: 모듈 결합도 낮음
- 단점: 제어 흐름 추적 어려움, runtime overhead

권장: **Option A**. Phase 6 시점에 결정.

---

## 6. service worker / index.html 영향

### 6.1 sw.js

현재 `sw.js`의 셸 캐시 매니페스트에 `/js/app.js` 명시. 분할 후 신규 모듈 파일들을 모두 추가하고 `CACHE_NAME`을 증분해 기존 사용자 캐시 무효화. 각 단계 PR에서:

```js
// sw.js (단계마다 갱신)
const CACHE_NAME = "common-bible-shell-vX.Y.Z+app-modulN"; // 단계 식별자 추가
const SHELL_URLS = [
  "/index.html",
  "/css/style.css",
  "/js/app/helpers.js", // Phase 1 추가
  "/js/app/storage.js", // Phase 2 추가
  // ...
  "/js/app.js", // Phase 8까지 점진 축소, 마지막에 제거
];
```

### 6.2 index.html

각 단계마다 `<script defer src="/js/app/<name>.js"></script>`를 추가. 의존 순서대로:

```html
<!-- 1라운드 -->
<script defer src="/js/sync/debug-log.js"></script>
<script defer src="/js/sync/refresh-store.js"></script>
<script defer src="/js/sync/transport.js"></script>
<script defer src="/js/sync/store-v2.js"></script>
<script defer src="/js/sync/state-machine.js"></script>
<script defer src="/js/drive-sync.js"></script>
<script defer src="/js/pre-fetch.js"></script>
<script defer src="/js/gtag-init.js"></script>

<!-- 2라운드: 의존 순서대로 추가 -->
<script defer src="/js/app/helpers.js"></script>
<!-- Phase 1 -->
<script defer src="/js/app/storage.js"></script>
<!-- Phase 2 -->
<script defer src="/js/app/settings-ui.js"></script>
<!-- Phase 3 -->
<script defer src="/js/app/install.js"></script>
<!-- Phase 4 -->
<script defer src="/js/app/search.js"></script>
<!-- Phase 5 -->
<script defer src="/js/app/bookmark.js"></script>
<!-- Phase 6 -->
<script defer src="/js/app/views-routing.js"></script>
<!-- Phase 7 -->

<script defer src="/js/app.js"></script>
<!-- Phase 8까지: 점진 축소, 마지막에 app-main.js로 변경 -->
```

`defer` 속성은 DOM 파싱 후 등장 순서대로 실행. 각 모듈 헤드의 anchor 캡처는 DOM 준비 후 OK.

---

## 7. 검증 절차

### 7.1 각 PR

```bash
npx tsc -p tsconfig.app.json --noEmit       # 단계별 검증 (1라운드와 동일)
npx tsc -p tsconfig.json --noEmit           # 그 모듈만 // @ts-check 켜진 상태에서 main 검증
npx tsc -p tsconfig.worker.json --noEmit    # 회귀
node --test tests/unit/*.test.js            # 회귀 (영향 없음 예상)
python3 scripts/serve.py 8080 &              # 로컬 SPA 서버
# 브라우저에서 / 접속 → 콘솔 오류 0 확인
```

브라우저 동작 확인이 PR마다 필수 (1라운드와 다름) — 분할은 코드 위치 이동이라 import/export 누락이 런타임 깨짐으로 나타남.

### 7.2 Phase 8 머지 후 (전체 회귀)

CLAUDE.md `tests/e2e/` 절차를 따라 사용자 수동 실행:

- `test_search.py`, `test_navigation.py`, `test_copy.py`, `test_install_guide.py`, `test_features.py`, `test_drive_sync.py`, `test_drive_sync_ios.py`

---

## 8. ADR 갱신 정책

- **Phase 8 머지 시** ADR-012에 `> **개정 (날짜): 2차 적용 2라운드 완료**` 블록 추가 — `// @ts-check` 영구 활성화 + `tsconfig.app.json` 삭제 명시.
- **ADR-018 신설 완료** (2026-05-09): `docs/decisions/018-app-modularization.md` — 모듈 분할 결정·맥락·검토한 대안·채택 방식.
- 메모리 `project_inflight_work.md` "추후 점진 확장 후보"의 `js/app.js` 2라운드 항목을 "진행 중" → 단계마다 갱신.

---

## 9. 결정 사항 (2026-05-09 확정)

| #   | 결정                                       | 비고                                                        |
| --- | ------------------------------------------ | ----------------------------------------------------------- |
| 1   | **모듈 시스템**: Multi-script + `defer`    | sync 레이어 패턴과 일관, ADR-001 SPA 단순성 유지            |
| 2   | **공유 state** (Phase 6): Option A `state.js` 모듈 | 사용자 명시                                                 |
| 3   | **모듈 namespacing**: IIFE + `window.appXxx` | sync 레이어와 동일 패턴                                     |
| 4   | **신규 ADR**: ADR-018 작성                   | `docs/decisions/018-app-modularization.md` 신설            |
| 5   | **단계 분할 입자**: 8개 PR                   | helpers / storage / settings-ui / install / search / bookmark / views-routing / final |
| 6   | **시작 시점**: 즉시 Phase 1                 | 사용자 명시                                                 |

---

## 10. 모듈화의 부수 효과 (성능)

본 작업의 일차 동기는 ADR-012 2차 적용 2라운드 완료(`// @ts-check` 영구화)이지만, 분할은 다음 부수 효과를 가져온다.

### 10.1 즉각 이점 (단계 머지 시점부터)

- **셸 캐시 입자 개선** — 현재 6,082줄 단일 파일은 한 줄만 변경해도 사용자 브라우저가 전체를 재다운로드. 분할 후엔 변경된 모듈만 재다운(SW 셸 캐시 + HTTP 캐시 양쪽). 평균 변경 크기가 ~1/8로 감소
- **HTTP/2 다중 스트림** — `defer`된 작은 파일들이 병렬 다운로드. 첫 콜드 캐시 로드도 약간 빨라질 가능성
- **인지적 부담 감소** — 6,000줄 단일 파일의 mental model 비용 ↓. 모듈별 ~1,000줄 미만 단위로 reasoning
- **단위 테스트 도입 기회** — 1라운드까지 app.js는 unit test 부재(DOM 의존도 높음). 분할 후 순수 로직 모듈(예: `storage.js`, verse spec utilities, search worker wire-up)에는 ADR-013 패턴(Node `--test` + vm 하네스)으로 unit test 추가 가능

### 10.2 미래 옵션

- **Lazy load** — `install.js`처럼 사용자가 메뉴를 누를 때만 필요한 모듈을 동적으로 로드해 첫 로드 무게 감소 (별도 의제)
- **Tree-shaking** — 미래에 번들러 도입 시(ADR-001 재검토 필요) 사용 안 하는 export 자동 제거. 본 라운드는 빌드 단계 안 추가하므로 즉각 이점 없음
- **모듈별 독립 deprecation** — 한 영역(예: install nudge)을 통째로 제거할 때 한 파일만 삭제 + index.html / sw.js에서 항목 제거

### 10.3 비용 (정직)

- 첫 로드 시 작은 파일 N개 만큼 HTTP request 추가. HTTP/2 멀티플렉싱으로 완화되지만 0은 아님
- `<script>` 태그 N개로 index.html이 길어짐 (~10줄 증가)
- 모듈 간 인터페이스를 `window.appXxx`로 노출하므로 **글로벌 namespace 오염**이 N개 추가

부수 효과로서 가치 있으나 본 작업의 정당화 사유는 아님. 정당화는 ADR-012 2차 라운드 완료 + 미래 저장소 분할 기반(§11).

---

## 11. 미래 저장소 분할 컨텍스트

본 작업은 미래 monorepo split의 **앱 코드 저장소** 자기 완결성 기반.

### 11.1 분할 계획 (별도 의제, 일정 미정)

```
앱 (root 저장소)
├─ index.html, js/**, css/**, sw.js, manifest.webmanifest, 빌드/배포 스크립트
├─ data/source/         ← 서브모듈: 데이터(성서) — 마크다운 원본 + parser 출력 JSON
└─ data/audio/          ← 서브모듈: 데이터(오디오) — MP3 ~수백 MB

서버(nginx)             ← 별도 저장소: prod nginx config, BFF location 블록
```

**핵심**: 데이터(성서)·데이터(오디오)는 **앱의 git submodule**로 포함된다. 즉 앱 저장소를 clone하면 `git submodule update --init` 한 번으로 데이터까지 함께 보임. 현재 `data/source/`가 이미 private submodule(`anglican-kr/common-bible-text`)인 패턴의 확장.

서버(nginx)만 별도 저장소 — 운영 인프라라 코드 라이프사이클이 다름.

### 11.2 본 모듈화와의 관계

**앱 저장소가 자기 완결적이려면**:

- 데이터 서브모듈과는 **fetch (`/data/...` URL) 인터페이스**만 — 본 모듈화는 fetch 호출을 `storage.js`/`data-fetching` 영역에 집중시켜 의존 경계를 명확히 함
- nginx 저장소와는 **`/oauth/token` BFF endpoint 계약**만 — sync 레이어가 이미 격리 (1차 ADR-012 적용 시)
- 앱 코드 모듈 경계가 명확하면 future split 시 코드 이동·서브모듈 정합이 단순해짐

따라서 본 모듈화는 monorepo split의 직접적 선행 작업.

---

## 12. 진행 일지

| 일자       | 단계           | 내용                                                                                                                                                                                                                                                                                                                                  |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-09 | 설계 초안 작성 | Explore agent로 41 섹션 cross-reference 매트릭스 + 모듈 상태 공유 분석 + 자연 분할 후보 도출. 본 문서 §1-§9 작성                                                                                                                                                                                                                       |
| 2026-05-09 | 결정 확정      | 사용자 review 완료 (Phase 6 Option A 명시 + ADR-018 작성 명시 + 즉시 시작 + 데이터는 앱의 서브모듈로 future split 예정). 미언급 항목은 권장 채택. §9 결정 사항으로 갱신, §10 성능 부수 효과 + §11 미래 저장소 분할 컨텍스트 추가, §12 진행 일지로 번호 이동. ADR-018(`docs/decisions/018-app-modularization.md`) 신설 |
| 2026-05-09 | Phase 1 머지 (#88) | `js/app/helpers.js` 추출 (5개 헬퍼: `_$`, `chUnit`, `el`, `clearNode`, `trapFocus`). IIFE + `window.appHelpers`. types.d.ts에 `AppHelpers` 인터페이스. app.js 6,082 → 6,053줄 |
| 2026-05-09 | Phase 2 작성 완료 | `js/app/storage.js` 추출 (28개 함수 + 3개 상수: `FONT_SIZES`, `DEFAULT_FONT_SIZE`, `COLOR_SCHEMES`, `SEARCH_HISTORY_MAX`). Reading position / Audio time / Search history / Settings / Bookmarks / Install nudge / `_maybeRequestPersist` 통합. `js/sync/store-v2.js`의 `saveBookmarks`/`loadBookmarks`와 글로벌 함수 이름 충돌 → storage.js + store-v2.js 둘 다 ES module 옵트인 (`export {};` + `<script type="module">`). 다른 sync 파일은 `window.syncStoreV2` facade만 사용해 caller 변경 0. `tests/unit/search-history.test.js` `APP_PATH` 갱신. app.js 6,053 → 5,835줄 (-218). main + worker tsc 0 error, 유닛 111건 통과 |
| 2026-05-09 | Phase 2 머지 (#89) | CI Unit tests + Cursor Bugbot 모두 green, main 통합 (rebase) |
| 2026-05-09 | Phase 3 작성 완료 | `js/app/settings-ui.js` 추출 (~570줄): Settings popover (`initSettings`), Icon recoloring (`hexToRgb`/`loadOrigIcon`/`updateAppIcons` + `_iconGeneration`/`ICON_BG_LUM`), Color scheme apply (`applyColorScheme` + `DEFAULT_FAVICON_HREF`/`DEFAULT_APPLE_ICON_HREF`), Theme apply (`applyTheme`/`updateThemeMetaColor` + `_systemThemeListener`/`_darkMQ`), Launch screen (`dismissLaunchScreen` + `_launchScreenDismissed`/`_fontReadyPromise`/`FONT_READY_TIMEOUT_MS`), `applyFontSize`. multi-script + defer (충돌 없음, ESM 옵트인 불필요). `types.d.ts`에 `AppSettings` 인터페이스 + 임시 글로벌 declare(announce/openInstall*/openDriveDisconnect*/clearAllCaches/parsePath/route) + Window에 `install`/`appVersion` 추가. app.js의 `const install = ...` → `window.install = install` 노출, `loadVersion`에서 `window.appVersion = appVersion` 미러. app.js 5,835 → 5,273줄 (-562). main + worker tsc 0 error, 유닛 111건 통과 |
| 2026-05-09 | Phase 3 머지 (#90) | Bugbot fix 2건(`window.applyXxx` 노출 누락 — High + `updateThemeMetaColor` dead code — Low) 적용 후 모든 체크 green, main 통합 (rebase). app.js 5,286줄 |
| 2026-05-09 | 모듈 시스템 결정 변경 | 사용자 review에서 ADR-001 단순성 가치를 절대화하지 않기로 합의. 옵션 B(ESM 일괄 전환, 빌드 단계 0 유지) 채택. **ADR-019** 신설(`docs/decisions/019-esm-module-system.md`), ADR-001에 개정(2026-05-09) 블록 추가, ADR-018의 §"module-vs-script 예외" → ESM 일괄로 갱신. 본 문서 §4.2 갱신. 다음 PR(별도 docs PR + 후속 ESM 일괄 전환 PR)에서 적용. Phase 4부터 ESM 패턴으로 진행 |
| 2026-05-09 | ADR-019 docs PR 머지 (#91) | 코드 변경 0의 docs PR. ADR-019 + ADR-001 amend + ADR-018 §대안표·예외 갱신·관련 ADR + 본 문서 §4.2/§12 |
| 2026-05-09 | ESM 일괄 전환 작성 완료 | 10개 파일에 `export {};` marker 추가 (sync 4개 — debug-log/refresh-store/transport/state-machine, app 3개 — drive-sync/gtag-init/helpers/settings-ui/app.js). storage.js·store-v2.js는 이미 ESM. **예외 2건**: `audio-cache.js`(sw.js의 `importScripts` 호환), `pre-fetch.js`(head non-defer로 즉시 fetch 시작). `index.html`의 9개 script 태그를 `<script type="module">`로 변경. `tests/unit/harness.js`에 `stripEsmMarker` 정규식 추가 — vm.runInContext의 classic 평가 호환. ADR-019 §예외 + §"테스트 하네스 호환" 추가. SHELL_CACHE shell-54 → shell-55. main + worker tsc 0 error, app.config 2 (gtag 외부, ADR-012 미적용), 유닛 111 통과 |
| 2026-05-09 | ESM 일괄 전환 머지 (#92) | 코드 변경 그대로 main 통합 (rebase). app.js 5,290줄 |
| 2026-05-09 | Phase 4 작성 완료 | `js/app/install.js` 추출 (~432줄): `install` IIFE (PWA detection: `isStandalone`/`detectPlatform`/`subscribe`/`triggerPrompt` + `beforeinstallprompt`/`appinstalled` 리스너), Install guide modal (`buildInstallBody`/`openInstallModal`/`closeInstallModal`/`_buildNeverShowRow` + 모달 anchor 4개 + `installModalTrap`/`installModalLastFocus` + `INSTALL_INERT_SELECTORS`/`setBackgroundInert` + scrim/close/Escape 리스너), Install nudge auto-show (`maybeShowInstallNudge`). **ESM 패턴 첫 적용**(ADR-019): named exports + `window.install`/`window.openInstallModal`/`window.maybeShowInstallNudge`/`window.appInstall` facade(legacy caller 호환). `setInert`을 helpers.js로 승격(install + bookmark drawer 공용) — `AppHelpers` 인터페이스에 추가. `BOOKMARK_INERT_SELECTORS` + `setBookmarkBackgroundInert`은 app.js에 유지(Phase 6에서 bookmark.js로 이동 예정). `types.d.ts`에 `InstallObject`/`InstallSubscriptionState`/`AppInstall` 인터페이스 + `Window`에 `appInstall`/`openInstallModal`/`maybeShowInstallNudge` 추가, 글로벌 `function maybeShowInstallNudge()` 선언. app.js에서 `_loadNudgeState`/`_saveNudgeState` destructure 제거(install.js로 이동). app.js 5,290 → 4,878줄 (−412). main + worker tsc 0 error, app.config 5 (gtag/dataLayer 외부, ADR-012 미적용 — 기존), 유닛 111 통과 |
| 2026-05-09 | Phase 4 머지 (#93) | Bugbot/CI 모두 green, main 통합 (rebase). app.js 4,878줄 |
| 2026-05-09 | ESM cross-module 회귀 hotfix (#94) | PR #92 ESM 일괄 전환에서 `function X()`이 module-scoped가 되며 settings-ui.js의 bare `announce`/`parsePath`/`route`/`openDriveDisconnectModal`/`clearAllCaches` 호출이 globalThis 조회로 떨어져 ReferenceError 잠재. app.js 상단 facade 블록에 5건 명시 노출 (`window.X = X`). SHELL_CACHE shell-56 → shell-57. 머지 후 phase 5 재개 |
| 2026-05-09 | Phase 5 작성 완료 | `js/app/search.js` 추출 (~1,065줄): Search 코어 (`searchWorker` 전역 상태 + `ensureSearchWorker`/`doSearch`), 결과 렌더 (`appendTextWithHighlight`/`buildSnippet`/`buildSearchPagination`/`renderSearchResultList`/`renderSearchResults`), 데스크톱 입력 핸들러 (`commitTopSearch` + `$searchInput`/`$searchClear` 리스너), 모바일 sheet (`isMobile`/`adjustSheetForKeyboard`/`openSearchSheet`/`closeSearchSheet`/`getSheetPageSize`/`buildSheetPagination`/`runSheetSearch`/`insertSearchOperator`/`commitSheetSearch` + `_suspendKeyboardAdjust`/`_searchSheetAppliedScrollLock`/`_suppressFocusCompactTransition` 모듈 상태), 히스토리 패널 컨트롤러 (`createSearchHistoryController` 팩토리 + `topSearchHistory`/`sheetSearchHistory` 인스턴스 + `SEARCH_HISTORY_VISIBLE` 상수), sheet drag init (`initSheetDrag`). **ESM 패턴**(ADR-019): named exports + `window.openSearchSheet`/`closeSearchSheet`/`renderSearchResults`/`initSheetDrag`/`isMobile`/`appendTextWithHighlight`/`consumeSearchAutoNavigate`/`appSearch` facade. `searchAutoNavigate` 모듈 상태는 search.js owns + `consumeSearchAutoNavigate()` 헬퍼로 app.js의 route()가 read-and-reset. app.js facade 블록 확장: 추가 5건(`navigate`/`setTitle`/`setBreadcrumb`/`hideAudioBar`/`renderError`) 노출. app.js header에서 search-only anchor 11개 제거(`$searchHistoryToggle`/`$searchHistoryPanel`/`$searchScrim`/`$searchSheetInputWrap`/`$searchSheetInput`/`$searchSheetClear`/`$searchSheetHistoryToggle`/`$searchSheetHistoryPanel`/`$searchSheetClose`/`$searchSheetChips`/`$searchSheetResults`), 5개 유지(`$searchBar`/`$searchInput`/`$searchClear`/`$searchSheet`/`$searchFab` — Escape/route/audio bar 호출). `types.d.ts`에 `AppSearch` 인터페이스 + 글로벌 declare 8건 추가. SHELL_CACHE shell-57 → shell-58. app.js 4,878 → 3,969줄 (−909). main + worker tsc 0 error, app.config 5 (기존 gtag/dataLayer), 유닛 111 통과 |
| 2026-05-09 | Phase 5 머지 (#95) + 명명 컨벤션 (#96) | search 유닛 36건 추가(`tests/unit/search.test.js`, BEGIN/END 마커 4종) + ADR-013 개정 — 한 모듈 = 한 테스트 파일. `search-history.test.js` → `storage.test.js`, `transport-pkce.test.js` → `transport.test.js` 리네임. CI workflow 이름 'Unit tests (sync layer)' → 'Unit tests'. 모두 main 통합 |
| 2026-05-10 | Phase 6a 작성 완료 | **Option A 채택**(§5.1): 공유 상태를 `js/app/reading-context.js`로 분리(~37줄) — `bookId`/`chapter`/`verseSelectMode`/`selectedVerses`/`verseSelectDrag` 단일 mutable 객체. caller가 `readingContext.bookId = "gen"` 형태로 직접 변경 (함수 기반 getter/setter는 보일러플레이트 부담 회피). 사용자 review에서 `state.js` 추상도 지적 → `reading-context.js`로 결정. `js/app/bookmark.js` 추출(~616줄): Verse spec 5함수(`parseVerseSpec`/`collapseFullVerseRefs`/`_compareRefs`/`selectedVersesToSpec`/`mergeVerseSpecs`), Bookmark query 7함수(`_walkBookmarks`/`findExistingChapterBookmarks`/`_findItemInStore`/`_findParentFolderId`/`removeItemById`/`insertItem`/`collectFolderOptions`), Drag&drop(`moveBookmarkItem`/`_clearDragIndicators`/`_updateDragIndicators`/`closeSwipedRow`/`_openSwipedRow`/`_setupDragHandle` + `_dragState`/`_swipedRow`/`SWIPE_REVEAL_PX`/`LONG_PRESS_MS` + `_isDescendant`/`_isMobileViewport`). app.js Phase 6b 영역의 두 callsite 처리: `_swipedRow = null` → `resetSwipedRow()`, 외부 탭 감지 직접 검사 → `closeSwipedRowIfOutside(e.target)`. **ESM 패턴**: `window.appBookmark` aggregate + 16개 bare global facade(Phase 6b territory가 직접 호출). `types.d.ts`에 `ReadingContext`/`AppBookmark` 인터페이스 + 글로벌 declare 16건 + `Window.readingContext`/`appBookmark` 추가. `VerseSelectDrag.snapshot?` 옵션 필드 명시. CLAUDE.md 파일 트리에 app/* 7개 모듈 행 추가. SHELL_CACHE shell-58 → shell-59. app.js 3,969 → 3,460줄 (−509). main + worker tsc 0 error, app.config 5 (기존 gtag/dataLayer), 유닛 147 통과 |
| 2026-05-10 | Phase 6a 머지 (#97) | Bugbot fix(`window.renderBookmarkTree` 노출 누락 — drag-after move 시 트리 재렌더 조용히 실패) + bookmark.test.js 70건 추가(VERSE_SPEC/BOOKMARK_QUERY/DRAG_CORE/SWIPED_ROW 마커 4개). main 통합 |
| 2026-05-10 | Phase 6b 작성 완료 | bookmark UI 전체를 `js/app/bookmark.js`로 합류(`Phase 6a 643 → 2,026줄`, +1,383줄). 영역: `BOOKMARK_INERT_SELECTORS`/`setBookmarkBackgroundInert`(setInert을 helpers.js에서 destructure), 모달/드로어 anchor 30+개, 모달 trap 상태 6개(`_bookmarkDrawerTrap`/`_bookmarkDrawerLastFocus`/`_bmSaveModalTrap`/`_bmMergeModalTrap`/`_bmNewFolderTrap`/`_bmNewFolderCallback`/`_bookmarkDrawerCloseSeq`/`_bookmarkDrawerCloseTimer`), Drive disconnect modal(`openDriveDisconnectModal`/`closeDriveDisconnectModal`), 페이지 헤더 SVG(`buildBackBtn`/`buildBookmarkHeaderBtn`/`refreshBookmarkHeaderBtn`), 드로어(`openBookmarkDrawer`/`closeBookmarkDrawer`), 트리 렌더(`renderBookmarkTree`/`_buildBookmarkItem`/`_buildBookmarkTypeIcon`/`_buildMaterialFolderIcon`/`_buildFolderToggleIcon`/`_buildFolderItem`/`_buildFolderCombobox`/`_isActiveBookmark`/`_hasActiveDescendant`/`_renderPathname`/`_focusTreeItem`/`_getVisibleTreeItems`/`_toggleFolder`), Save bookmark modal(`openSaveModal`/`closeSaveModal`/`_showSaveModal`/`commitSaveBookmark`/`openNewFolderModal`/`closeNewFolderModal`/`_commitNewFolder`), Merge dialog(`openMergeDialog`), Export/Import(`exportBookmarks`/`openImportModal`/`_validateImportData`/`_mergeBookmarkStores`/`_countBookmarks`), Verse selection mode(`enterVerseSelectMode`/`exitVerseSelectMode`/`updateVerseSelectionBoundaries`/`updateVerseSelectBar`), Drawer toolbar event handlers. **window facade 11개 추가**: `buildBackBtn`/`buildBookmarkHeaderBtn`/`openBookmarkDrawer`/`closeBookmarkDrawer`/`renderBookmarkTree`/`enterVerseSelectMode`/`exitVerseSelectMode`/`updateVerseSelectionBoundaries`/`updateVerseSelectBar`/`openDriveDisconnectModal` (+ `appBookmark` aggregate 갱신). app.js에서 `booksCache` 읽기를 위한 `window.getBooksCache = () => booksCache` 게터 추가(Phase 7에서 `loadBooks` 동행 이전). Phase 6a의 `moveBookmarkItem` 내 `window.renderBookmarkTree()` indirection 제거 → 직접 호출(같은 모듈, 호이스팅 활용). bookmark.test.js의 `loadDragCore` prelude에 `function renderBookmarkTree()` stub 추가. types.d.ts에 글로벌 declare 9건 + `Window.getBooksCache` 추가. SHELL_CACHE shell-59 → shell-60. app.js 3,460 → 2,126줄 (−1,334). main + worker tsc 0 error, app.config 5 (기존 gtag/dataLayer), 유닛 217 통과 |
| 2026-05-10 | Phase 6b 머지 (#100) | Bugbot fix(`loadAudioTime`/`clearAudioTime`/`clearReadingPosition` 미사용 destructure 제거) 적용 후 main 통합. app.js 2,126줄 |
| 2026-05-10 | Phase 7a 작성 완료 | `js/app/views-routing.js` 신설(~540줄). 영역: Data fetching(`loadBooks`/`loadVersion`/`loadChapter`/`loadPrologue` + `booksCache`/`appVersion` 모듈 상태), Rendering helpers(`setTitle`/`setBreadcrumb`/`setTitleWithDivisionPicker`/`setTitleWithChapterPicker`/`buildDivisionBreadcrumb`/`divisionLabels`/`divisionOrder`/`effectiveDivision` + 분류 상수), Pull-to-refresh IIFE, `initCompactHeader`. window facade 13건 + 임시 노출 4개 const(`DIVISION_LABELS`/`OT_SUBCATEGORY`/`OT_SUBCATEGORY_ORDER`/`OT_SUBCATEGORY_LABELS`). app.js facade에서 `window.setTitle`/`setBreadcrumb`/`getBooksCache` 이전. types.d.ts 글로벌 11건 + `Window.appViewsRouting` 추가. SHELL_CACHE shell-60 → shell-61. app.js 2,126 → 1,661줄 (−465). main + worker tsc 0 error, app.config 5(기존 gtag/dataLayer), 유닛 217 통과 |
| 2026-05-10 | Phase 7a 머지 (#101) | views-routing.js 540줄 + 테스트 28건(DATA_FETCHING 11 / DIVISION 7 / TITLE 4 / BREADCRUMB 6) 함께 main 통합. app.js 1,661줄 |
| 2026-05-10 | Phase 7b 작성 완료 | Views + Routing + Audio Player 전체를 views-routing.js에 합류(540 → 1,783줄, +1,243). Phase 7a 시점에 임시 노출했던 4개 const facade는 같은 모듈 안 caller로 흡수돼 자연 해소(잔존 노출). 추가 이전: Audio Player 상태 3개(`currentAudio`/`_audioController`/`_audioSaveTimer`), Routing 상태 2개(`_scrollTrackCleanup`/`_isInitialLoad`), `startScrollTracking`(Reading position section에 잔류했던 routing-internal 함수). popstate listener도 동행. **DOMContentLoaded 부트스트랩은 app.js 잔류**(app-main 책임): `route`/`loadVersion`/`initCompactHeader`/`maybeShowInstallNudge`는 window facade로 호출, `initSheetDrag`(search.js)·`initBookmarkSheetDrag`/`initBookmarkDrawerResize`(app.js Phase 8 잔류)·`registerServiceWorker`(app.js)는 module-local. `currentAudio` 접근을 위한 `window.getCurrentAudio` 게터 신설(app.js 접근성 spacebar handler용). gtag-init.js의 `function gtag()` module-scoped 잔재 회귀 정리: `window.gtag = gtag` 노출 + dataLayer ?? 가드. types.d.ts에 `Window.getCurrentAudio`/`gtag`/`dataLayer`/`appVersion` + 글로벌 `function gtag` + `const dataLayer` 추가. CLAUDE.md 트리에 app.js 역할 갱신(부트스트랩 + 접근성 + Audio cache LRU + SW 등록 잔류 ~460줄). SHELL_CACHE shell-61 → shell-62. app.js 1,650 → 464줄 (−1,186). 누적 6,082 → 464줄 (−5,618, **92% 감소**). main + worker tsc 0 error, **app.config 0 error**(gtag/dataLayer 잔재 동시 해소!), 유닛 245 통과 |
| 2026-05-10 | Phase 7b 머지 (#103) | Bugbot 3차(stale facade 5건 + 중복 appVersion + 미사용 import + stale anchor + 4개 const stale facade) 모두 fix 적용 후 main 통합. app.js 464줄 |
| 2026-05-10 | Phase 8 작성 완료 — **모듈 분할 종료** | 잔류 정리: app.js의 `initBookmarkSheetDrag`/`initBookmarkDrawerResize` → bookmark.js (drawer geometry init은 bookmark 모듈 책임) + bookmark.js facade에 `appBookmark.initBookmarkSheetDrag`/`initBookmarkDrawerResize` 추가, types.d.ts AppBookmark + 글로벌 declare 갱신. app.js 헤드 슬림화: 미사용 typedef 14개 + 미사용 destructure(storage 25개 중 22개, helpers 6개 중 4개) 제거, 마이그레이션 경위 코멘트 정리, dead 섹션 마커(`Reading position` / `Font size` / `Book order` / `Helpers`) 정리. **`// @ts-check` 영구 활성화** + `tsconfig.app.json` 삭제. ADR-012 2차 라운드 종료 마킹 + ADR-018 본 의제 종료. CLAUDE.md "현재 상태" 섹션의 모듈 분할 항목 갱신, `project_inflight_work.md` 메모리 종료. SHELL_CACHE shell-62 → shell-63. app.js 464 → 283줄 (−181). 누적 6,082 → 283줄 (**95% 감소**). main + worker tsc 0 error, 유닛 245 통과 |
| 2026-05-10 | Phase 8 머지 — **의제 종료** | Phase 1~8 8 PR이 모두 main 통합. 최종 결과: `js/app.js` 283줄(부트스트랩 + 접근성 keydown + Audio cache LRU 소프트캡 + SW 등록만 잔류), `js/app/` 9개 도메인 모듈(helpers·storage·settings-ui·install·search·reading-context·bookmark·views-routing 8개 + 잔류 app.js), ESM 일괄 채택, ADR-012 2차 라운드 종료, 유닛 테스트 baseline 111 → 245 케이스. 후속 의제는 `project_inflight_work.md` / `project_unit_test_expansion.md` 메모리 참조 |
