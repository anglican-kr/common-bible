# ADR-019: ESM 모듈 시스템 채택

- 일시: 2026-05-09
- 개정: 2026-05-10 (일괄 전환 완료 — sync 5개 + drive-sync + gtag-init + app 9개 + app.js 모두 `<script type="module">`. `audio-cache.js`·`pre-fetch.js`는 §"예외"대로 classic 유지)
- 상태: 승인됨 — 일괄 전환 완료 (2026-05-09~10)
- 관련 ADR: ADR-001(SPA), ADR-012(TS), ADR-018(app.js 모듈 분할)

## 결정

모든 클라이언트 JS 파일을 **ES module**(`<script type="module">` + 파일별 module scope)로 일괄 전환한다. ADR-018이 채택했던 "multi-script + `defer` + `window.X` 글로벌 namespace" 패턴은 **점진 폐기**한다. 단, **빌드 단계는 추가하지 않는다** — 브라우저가 원본 `.js` 파일을 그대로 ESM으로 로드.

전환 범위:

- sync 레이어 5개: `debug-log.js`, `refresh-store.js`, `transport.js`, `state-machine.js`, `drive-sync.js`
  (이미 ESM인 `store-v2.js` 외)
- app 레이어: `helpers.js`(이미 IIFE) + `storage.js`(이미 ESM, 그대로) + `settings-ui.js` + `app.js` + 후속 `install.js`/`search.js`/`bookmark.js`/`views-routing.js`/`state.js`/`app-main.js`
- 기타: `pre-fetch.js`, `audio-cache.js`, `gtag-init.js`
- `index.html`: 모든 `<script>`가 `type="module"`로

`window.X` facade는 1차 sync 레이어 회귀 방지를 위해 유지하되, 새 작성하는 코드는 가능하면 `import`/`export`로 cross-module 의존을 명시한다 (점진 진화).

## 맥락

ADR-018(2026-05-09)을 기록할 때는 ADR-001 SPA 단순성을 절대 가치로 두고 multi-script + 글로벌 namespace를 채택했다. Phase 2(`storage.js`) 시점에 `saveBookmarks`/`loadBookmarks` 글로벌 함수 이름이 `js/sync/store-v2.js`와 충돌해 두 파일만 ESM 옵트인했고, ADR-018에 §"module-vs-script 예외"를 추가했다.

이후 사용자 review에서 *SPA 단순성을 그리 무게 두지 않는다* 가 명시됐다. 의미: ADR-001은 출발점이지 절대 가치가 아니며, 모듈성·의존 그래프 명시·패턴 일관성 같은 다른 가치와 함께 평가한다. 이는 ESM 전환의 정당화 사유.

또한 ADR-018 §"module-vs-script 예외"는 본질적으로 *충돌이 발견되는 모듈마다 ESM을 선택*하는 정책인데, 결국 후속 모듈들도 비슷한 충돌을 겪을 가능성이 높다 — 점진 옵트인보다 일괄 전환이 깔끔.

## 검토한 대안

| 방식 | 빌드 변화 | 패턴 일관성 | 채택 |
| --- | --- | --- | --- |
| **ESM 일괄 전환, 빌드 0** | 없음 | 모든 파일이 module scope, 일관 | ✅ |
| 부분 ESM 옵트인 (ADR-018 §예외) | 없음 | 혼합 (script + module 혼재) | ❌ — 매 phase마다 결정 부담 |
| 그대로 유지 (multi-script) | 없음 | 일관 (script만) | ❌ — 함수 이름 충돌 누적 |
| ESM + 번들러 도입 (esbuild/vite) | 큼 | 일관 | ❌ — ADR-001의 "빌드 단계 0"은 유지 (lazy load/tree-shaking이 절실해지면 별도 ADR로 재검토) |
| `.ts` 파일 + tsc 컴파일 | 큼 | 일관 + 타입 정확 | ❌ — 빌드 단계 도입이 더 큼 |

## 채택 방식

### 파일별 변환

각 .js 파일 끝에 `export {};` 한 줄 추가 (실제 export 없어도 module marker로 충분). `<script>` 태그를 `type="module"`로 변경.

```js
// js/sync/state-machine.js (예)
"use strict";
// @ts-check
// ... 기존 코드 ...
window.createSyncMachine = function (...) { ... };
export {};
```

```html
<script type="module" src="/js/sync/state-machine.js"></script>
```

### 글로벌 facade 패턴 유지

기존 `window.driveSync`, `window.syncTransport`, `window.appHelpers` 등 facade는 그대로. ESM 전환은 *typescript 인식 + 명명 격리*가 목적이지 facade 폐기는 점진. 새 cross-module 호출은 `import`/`export`로 작성 권장:

```js
// 새 호출 (선호)
import { saveReadingPosition } from "./storage.js";

// 기존 호출 (그대로 작동)
window.appStorage.saveReadingPosition(...);
```

### typescript 인식

`@typedef`가 module scope가 되어 cross-file 글로벌 alias 충돌 사라짐. PR-3에서 시도했던 *"한 파일에만 typedef + 다른 파일은 글로벌 참조"* 같은 우회는 불필요. 각 모듈이 필요한 typedef를 `import("../types").Foo`로 직접 import.

### `window.X` 명시 노출

`const` 바인딩은 ESM module에서 자동으로 `window`에 등록되지 않으므로, sync layer가 `typeof window.applyFontSize === "function"` 같은 가드로 호출하는 함수는 명시적으로 `window.X = X;` 라인을 넣는다 (현재 Phase 3 PR #90에서 이미 적용된 패턴).

### 예외 (script 모드 유지)

다음 두 파일은 ESM 옵트인하지 않는다 — 외부 제약 때문:

| 파일 | 사유 |
| --- | --- |
| `js/audio-cache.js` | `sw.js`가 `importScripts("/js/audio-cache.js")`로도 로드. `importScripts`는 classic script만 허용하며 `export {};`가 있으면 `SyntaxError`로 실패. 메인 페이지에서는 `<script defer>`로 로드해 동작이 일관되게 유지됨 |
| `js/pre-fetch.js` | `<head>`에 `<script src="...">`(non-defer)로 즉시 실행되어 `data/books.json` 다운로드를 가능한 한 일찍 시작. `type="module"`은 자동 deferred라 fetch 시작이 늦어지는 회귀 |

이 두 파일은 `export {};` 추가 안 함 + `<script>` 또는 `<script defer>` 그대로.

### 테스트 하네스 호환

`tests/unit/harness.js`는 sync 파일들(`state-machine.js`/`refresh-store.js`/`transport.js`)을 `vm.runInContext`로 로드해 unit test를 돌린다. 이는 classic script 평가라 `export {};`가 `SyntaxError`. 해결: 하네스가 source를 `readFileSync`한 직후 ESM marker만 제거하는 한 줄 정규식 (`stripEsmMarker`). production runtime에는 영향 없는 test-only adaptation.

## 검증

- 단계별 PR마다: `tsc -p tsconfig.app.json/json/worker.json --noEmit` 모두 0 error
- 회귀: `node --test tests/unit/*.test.js` 111건 통과
- 브라우저 동작 확인: 매 PR 머지 전 사용자 수동 (SW 캐시 무효화 + 콘솔 0 오류)
- 특히 Drive 동기화 — 1차 sync 레이어가 ESM 변환 후에도 `window.driveSync` 등으로 호출되어야 정상

## 채택 이유 요약

- **Phase 4-8의 모듈 분할이 더 깨끗** — 매 phase에서 "이 모듈 이름이 글로벌 충돌하나?" 점검 부담 사라짐
- **ADR-018의 module-vs-script 예외 자연 흡수** — 두 모드 혼재의 인지 부담 제거
- **typedef + 함수 이름 격리** — 1차 ADR-012 시점부터 누적된 typescript 글로벌 alias 충돌 패턴 종결
- **빌드 단계 0 유지** — ADR-001의 "백엔드 없이 정적 호스팅" 핵심 가치 보존. lazy load/tree-shaking은 *별도 의제*로 보류
- **`window.X` facade 점진 폐기 가능** — 회귀 위험 최소

## 결과

- ADR-018의 결정 표가 갱신됨 (Multi-script → ESM)
- ADR-001에 amend 블록 추가 (단순성 가치 재정의)
- 후속 PR들은 ESM 패턴으로 작성

## 관련 ADR

- ADR-001: SPA 아키텍처 — 빌드 단계 0 가치 보존, namespace 패턴은 진화
- ADR-012: TypeScript 점진 도입 — ESM이 typedef 격리를 자연스럽게 해결
- ADR-018: app.js 모듈 분할 — 본 ADR이 모듈 시스템 결정을 갱신

## 후속 의제 (별도 ADR 후보)

- 번들러(esbuild/vite) 도입 — lazy load/tree-shaking/minify가 절실해질 때
- `.ts` 파일 직접 사용 — 빌드 단계 도입과 함께 검토
