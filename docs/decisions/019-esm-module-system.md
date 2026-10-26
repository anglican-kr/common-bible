# ADR-019: ESM 모듈 시스템 채택

- 일시: 2026-05-09
- 상태: 승인됨 — 일괄 전환 완료 (2026-05-09부터 05-10까지)
- 관련 ADR: ADR-001(SPA), ADR-012(TS), ADR-018(app.js 모듈 분할)

## 결정

모든 클라이언트 JS 파일을 **ES module**(`<script type="module">`, 파일마다 module scope)로 한꺼번에 옮긴다. ADR-018이 처음 채택한 「multi-script + `defer` + `window.X` 전역 namespace」 방식은 **차츰 없앤다**. 다만 **빌드 단계는 더하지 않는다**. 브라우저가 원본 `.js` 파일을 그대로 ESM으로 불러온다.

옮기는 범위는 다음과 같다.

- sync 레이어 5개: `debug-log.js`, `refresh-store.js`, `transport.js`, `state-machine.js`, `drive-sync.js`
  (이미 ESM인 `store-v2.js`는 빼고)
- app 레이어: `helpers.js`(그때 IIFE) + `storage.js`(이미 ESM, 그대로) + `settings-ui.js` + `app.js`, 그리고 뒤에 나눌 `install.js`/`search.js`/`bookmark.js`/`views-routing.js`/`state.js`/`app-main.js`
- 그 밖: `pre-fetch.js`, `audio-cache.js`, `gtag-init.js`
- `index.html`: 모든 `<script>`를 `type="module"`로

1차 sync 레이어의 회귀를 막으려고 `window.X` facade는 남긴다. 새로 쓰는 코드는 되도록 `import`/`export`로 모듈 사이의 의존을 드러낸다(차츰 바꿔 간다).

**결과(2026-05-10).** 일괄 전환을 마쳤다. sync 5개, drive-sync, gtag-init, app 9개, app.js가 모두 `<script type="module">`이다. `audio-cache.js`와 `pre-fetch.js`는 아래 「예외」대로 classic으로 남겼다. ADR-018의 분할에서 `state.js`는 `reading-context.js`가 됐고, `app-main.js`는 만들지 않았다(ADR-018 「결정」).

## 맥락

ADR-018(2026-05-09)을 기록할 때는 ADR-001의 SPA 단순성을 절대 가치로 두고 multi-script + 전역 namespace를 채택했다. Phase 2(`storage.js`)에서 `saveBookmarks`/`loadBookmarks` 전역 함수 이름이 `js/sync/store-v2.js`와 충돌했다. 그래서 두 파일만 ESM으로 옮기고, ADR-018에 §"module-vs-script 예외"를 더했다.

그 뒤 사용자가 검토에서 SPA 단순성에 큰 무게를 두지 않는다고 밝혔다(2026-05-09). ADR-001은 출발점이지 절대 가치가 아니고, 모듈성, 의존 그래프의 명시, 방식의 일관성 같은 다른 가치와 함께 따진다는 뜻이다. 이것이 ESM 전환의 근거다.

또 ADR-018 §"module-vs-script 예외"는 결국 *충돌이 생긴 모듈마다 ESM을 고르는* 정책이다. 뒤의 모듈도 비슷한 충돌을 겪을 가능성이 높으므로, 하나씩 옮기기보다 한꺼번에 옮기는 편이 깔끔하다.

## 검토한 대안

| 방식 | 빌드 변화 | 방식의 일관성 | 채택 여부 |
| --- | --- | --- | --- |
| **ESM 일괄 전환, 빌드 0** | 없음 | 모든 파일이 module scope로 같다 | **채택** |
| 일부만 ESM으로 옮기기 (ADR-018 §예외) | 없음 | script와 module이 섞인다 | 채택 안 함 — phase마다 정해야 하는 부담 |
| 그대로 두기 (multi-script) | 없음 | script만이라 같다 | 채택 안 함 — 함수 이름 충돌이 쌓인다 |
| ESM + 번들러 도입 (esbuild/vite) | 크다 | 같다 | 채택 안 함 — ADR-001의 「빌드 단계 0」은 유지한다(lazy load나 tree-shaking이 꼭 필요해지면 별도 ADR로 다시 검토) |
| `.ts` 파일 + tsc 컴파일 | 크다 | 같고 타입도 정확하다 | 채택 안 함 — 빌드 단계를 들이는 부담이 더 크다 |

## 채택 방식

### 파일별 변환

각 .js 파일 끝에 `export {};` 한 줄을 더한다. 실제로 내놓는 것이 없어도 module 표시로 충분하다. `<script>` 태그는 `type="module"`로 바꾼다.

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

### 전역 facade는 남긴다

기존 `window.driveSync`, `window.syncTransport`, `window.appHelpers` 같은 facade는 그대로 둔다. ESM 전환의 목적은 *TypeScript가 파일을 모듈로 인식하게 하고 이름을 서로 가리는 것*이다. facade는 차츰 없앤다. 모듈 사이의 새 호출은 `import`/`export`로 쓰기를 권한다.

```js
// 새 호출 (권장)
import { saveReadingPosition } from "./storage.js";

// 기존 호출 (그대로 작동)
window.appStorage.saveReadingPosition(...);
```

그 뒤 ADR-034가 서로 순환하지 않는 facade를 명시적 import로 바꿨다.

### TypeScript 인식

`@typedef`가 module scope가 되어, 파일 사이에서 전역 alias가 충돌하던 문제가 없어진다. PR-3에서 시도했던 우회(*한 파일에만 typedef를 두고 다른 파일은 전역으로 참조*)는 필요 없다. 각 모듈이 필요한 typedef를 `import("../types").Foo`로 직접 가져온다.

### `window.X`에 명시적으로 내놓기

ESM 모듈의 `const` 바인딩은 `window`에 저절로 등록되지 않는다. sync 레이어가 `typeof window.applyFontSize === "function"` 같은 검사로 호출하는 함수는 `window.X = X;` 줄을 따로 넣어 내놓는다(Phase 3 PR #90에서 이미 쓴 방식).

### 예외 (script 모드 유지)

다음 두 파일은 바깥 제약 때문에 ESM으로 옮기지 않는다.

| 파일 | 이유 |
| --- | --- |
| `js/audio-cache.js` | `sw.js`가 `importScripts("/js/audio-cache.js")`로도 불러온다. `importScripts`는 classic script만 받으므로 `export {};`가 있으면 `SyntaxError`로 실패한다. 메인 페이지에서는 `<script defer>`로 불러와 동작이 같게 유지된다 |
| `js/pre-fetch.js` | `<head>`에서 `<script src="...">`(defer 없음)로 바로 실행해 `data/books.json` 받기를 되도록 일찍 시작한다. `type="module"`은 저절로 deferred가 되어 받기 시작이 늦어지는 회귀가 생긴다 |

이 두 파일에는 `export {};`를 붙이지 않고, `<script>`나 `<script defer>`를 그대로 쓴다. 그 뒤 ADR-021이 더한 `js/manifest-sync.js`도 classic(`<script defer>`)이다. 이 파일은 `sw.js`가 불러오지 않는다(`docs/architecture.md` §4).

### 테스트 하네스 호환

`tests/unit/harness.js`는 sync 파일들(`state-machine.js`/`refresh-store.js`/`transport.js`)을 `vm.runInContext`로 실행해 유닛 테스트를 돌린다. 이것은 classic script로 평가하므로 `export {};`가 `SyntaxError`를 낸다. 그래서 하네스가 source를 `readFileSync`한 바로 뒤 ESM 표시만 지우는 한 줄 정규식(`stripEsmMarker`)을 둔다. 테스트에만 쓰는 맞춤이라 운영 실행에는 영향이 없다.

## 검증

- 단계별 PR마다 `tsc -p tsconfig.app.json/json/worker.json --noEmit`이 모두 0 error였다.
- 회귀: `node --test tests/unit/*.test.js` 111건 통과(그때 건수).
- 브라우저 동작 확인: PR마다 머지하기 전에 사용자가 직접 확인했다(SW 캐시를 무효화하고 콘솔 오류 0).
- 특히 Drive 동기화를 봤다. 1차 sync 레이어는 ESM으로 바꾼 뒤에도 `window.driveSync` 등으로 호출돼야 정상이다.

## 채택 이유 요약

- **Phase 4-8의 모듈 분할이 깔끔해진다.** phase마다 「이 모듈 이름이 전역에서 충돌하나?」를 점검하지 않아도 된다.
- **ADR-018의 module-vs-script 예외가 저절로 사라진다.** 두 방식이 섞여 생기는 이해 부담이 없어진다.
- **typedef와 함수 이름이 서로 가려진다.** ADR-012 1차 때부터 쌓인 TypeScript 전역 alias 충돌이 끝난다.
- **빌드 단계 0을 유지한다.** ADR-001의 「백엔드 없이 정적 호스팅」이라는 핵심 가치를 지킨다. lazy load와 tree-shaking은 *별도 의제*로 미룬다.
- **`window.X` facade를 차츰 없앨 수 있다.** 회귀 위험이 가장 작다.

## 결과

- ADR-018의 결정 표가 바뀌었다(Multi-script에서 ESM으로).
- ADR-001에 단순성의 범위를 다시 정한 내용을 더했다. 처음에는 개정 블록이었고, 지금은 ADR-001 「단순성의 범위」 절이다.
- 뒤의 PR들은 ESM 방식으로 썼다.

## 관련 ADR

- ADR-001: SPA 아키텍처. 빌드 단계 0이라는 가치를 지키고, namespace 방식은 바뀌었다.
- ADR-012: TypeScript 점진 도입. ESM이 typedef 격리를 자연스럽게 해결한다.
- ADR-018: app.js 모듈 분할. 이 ADR이 그 모듈 시스템 결정을 바꿨다.

## 후속 의제 (별도 ADR 후보)

- 번들러(esbuild/vite) 도입: lazy load, tree-shaking, minify가 꼭 필요해질 때.
- `.ts` 파일을 직접 쓰기: 빌드 단계 도입과 함께 검토한다.
