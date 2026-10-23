# ADR-013: 클라이언트 JS 유닛 테스트 전략

- 일시: 2026-05-06
- 상태: 승인됨 — 구현 완료. 2026-05-11에 473 케이스 통과(sync 92 + app 381)로 앱 레이어에서 jsdom 없이 시험할 수 있는 영역의 1차를 마쳤다. 지금의 건수는 `tests/README.md`에 있다.

## 결정

브라우저의 클래식 스크립트로 불러오는 `js/sync/state-machine.js`를 **Node 자체 테스트 러너(`node --test`)** 위에서 검증한다. 테스트 러너 의존성(jest, mocha, vitest 등)을 더하지 않는다. 자체 하네스가 `node:vm`으로 모듈을 격리된 컨텍스트에 불러온 뒤, 브라우저 전역(`window`, `localStorage`, `navigator`, `document`, `setTimeout`)을 스텁으로 바꿔 둔다.

이 방식을 모든 클라이언트 JS 유닛 테스트에 쓴다(2026-05-11).

- 유닛 테스트는 `node:vm`과 손으로 만든 스텁만 쓴다. 새 의존성을 더하려면 이 ADR을 고친다.
- 실제 브라우저가 있어야 하는 동작(레이아웃 계산, Canvas, 터치 제스처)은 유닛이 아니라 e2e(`tests/e2e/`)가 맡는다(2026-05-11). 그런 영역은 `settings-ui.js` 전체, `views-routing.js`의 Pull-to-refresh, Audio Player, startScrollTracking, `install.js`의 모달 열기와 닫기, 슬라이더, buildInstallBody, `bookmark.js`의 drawer, save modal, tree render, drag handle, sheet drag, `search.js`의 시트 드래그와 결과 렌더였다. e2e 시나리오를 더하는 일(`tests/e2e/test_*.py` 신설)은 따로 다룬다. 이 ADR은 유닛 테스트의 범위만 다룬다.

### 테스트 파일 이름 (2026-05-09)

테스트 파일 이름이 들쭉날쭉 쌓여 모듈과 테스트를 짝짓기 헷갈렸다. `search-history.test.js`는 `js/app/storage.js`의 일부를, `search.test.js`는 `js/app/search.js` 전체를 가리켰다. `transport-pkce.test.js`는 `js/sync/transport.js`의 PKCE 영역을 앞세워 모듈 이름이 보이지 않았다. 그래서 다음 규칙을 정했다.

- **규칙 1(기본)**: `tests/unit/<source-basename>.test.js` 형식이다. 소스 파일 이름과 1:1로 짝짓는다. 한 모듈에 테스트 파일 하나다.
- **규칙 2(영역 구분)**: 모듈 안의 영역(예: PKCE primitives와 Drive REST, search history와 settings storage)은 테스트 파일 안에서 `// ── <영역> ──` 주석 구역으로 나눈다. `search.test.js`가 이미 이 방식을 쓰고 있었다.
- **규칙 3(모듈이 너무 커질 때)**: `tests/unit/<basename>/<concern>.test.js`처럼 디렉터리로 나눈다. 지금은 그런 경우가 없다.
- 적용: `search-history.test.js` → `storage.test.js`(storage.js의 다른 부분도 나중에 같은 파일에 합친다), `transport-pkce.test.js` → `transport.test.js`.
- CI 워크플로(`tests/unit/*.test.js` glob)가 새 파일 이름을 저절로 집어, workflow YAML을 바꾸지 않았다.
- 실데이터에 기대는 테스트와 문서 검사의 예외 둘은 `tests/README.md` §1에 있다.

## 맥락

ADR-004는 **데이터 파이프라인**의 테스트 전략을 다루고, 그 밖의 클라이언트 JS는 e2e 테스트(Playwright, 로컬 전용)로만 검증해 왔다. e2e는 통합 동작은 잘 잡지만 다음과 같은 회귀에는 약하다.

- 상태 머신의 분기 회귀(예: iOS ENABLE에서 자동 리디렉션이 트리거된다. 사용자 제스처 밖에서 OAuth가 시작된다.)
- 카운터와 상한의 회귀(예: redirect attempts 상한을 넘으면 NEEDS_CONSENT → ERROR로 두 번 전이한다.)
- 일부만 온 응답 처리(GIS Token Client의 빈 응답을 IDENTITY_FAIL로 받아 넘긴다.)

이런 회귀는 e2e에서는 외부 네트워크와 UI를 거쳐야 재현되는데, 결과가 그때그때 다르고 느리다. 또 ADR-011의 동기화 코드는 검수를 받은 뒤 함부로 손대기 어려워 회귀 비용이 매우 높다.

## 검토한 대안

| 방식 | 추가 의존성 | 격리 | 채택 |
| --- | --- | --- | --- |
| Jest + jsdom | jest, jsdom (대형) | jsdom 글로벌 | ❌ — Vanilla 원칙 위반 |
| Vitest | vitest, esbuild | vm 기반 | ❌ — 빌드 의존성 추가 |
| Playwright unit 모드 | playwright (이미 e2e용 존재) | 실제 브라우저 | ❌ — 단위 테스트로 너무 무거움 |
| **Node `--test` + 자체 vm 하네스** | 없음 (Node 24 내장) | `node:vm` per-test 컨텍스트 | ✅ |

Node 22부터 `node --test`는 안정 기능이고, `--watch`, `--test-name-pattern`, `--test-only` 등을 모두 지원한다. CI는 이미 `actions/setup-node@v4 node-version: 24`를 쓴다.

### jsdom이나 happy-dom을 함께 쓰기 (2026-05-11에 허용했다가 같은 날 채택하지 않음)

- ADR-018 모듈 분할을 마친(2026-05-10) 뒤 앱 레이어의 다루지 않던 영역으로 유닛 테스트를 넓히다가, vm과 손으로 만든 스텁만으로는 모든 영역에 맞지 않는다는 것이 드러났다. 살펴보니(Claude 메모 `project_unit_test_expansion.md`의 계기에 닿은 때) `js/app/`의 다루지 않던 영역 가운데 약 70%(1500줄+)는 기존 방식으로 다룰 수 있었다. 나머지는 jsdom 정도가 필요해 보였다.
  - `js/app/views-routing.js`의 `startScrollTracking`: `Element.getBoundingClientRect()`로 레이아웃을 계산한다.
  - `js/app/views-routing.js`의 Pull-to-refresh: `touchstart`/`touchmove`/`touchend` 시퀀스와 `transform`/`opacity` 트랜지션.
  - `js/app/settings-ui.js`의 아이콘 색 바꾸기: Canvas 2D context(`getImageData`/`putImageData`)와 Font Loading API(`document.fonts.ready`).
- 그래서 `node:vm`과 손으로 만든 스텁을 기본으로 두되, 이 영역에 한해 `jsdom`(가벼운 쪽이 낫다면 `happy-dom`)을 devDependency로 들이도록 허용했다. 「0 의존성」 원칙을 「Node 말고는 0 의존성」으로 완화하고, 첫 jsdom PR이 저장소 루트의 `package.json` 신설(`devDependencies`만, `dependencies`는 빈 채로), `package-lock.json` 커밋, `.gitignore`에 `node_modules/` 추가, `.github/workflows/test.yml`의 `unit` job에 `npm ci` 단계 삽입을 함께 하기로 했다. 기본은 `harness.js`의 vm과 손으로 만든 스텁이고, jsdom은 레이아웃, Canvas, 터치 제스처가 본질인 함수에만 쓰며, jsdom을 쓰는 테스트 파일은 머리 주석에 이유를 적기로 했다.
- 채택하지 않음 2026-05-11 · 이유: 앱 레이어에서 jsdom 없이 할 수 있는 유닛 테스트 확장 1차(PR #106·#108·#109·#110·#112·#113)를 마치고 실제로 도입할지 다시 검토하다가, 결정적인 사실을 찾았다. **jsdom과 happy-dom 모두 진짜 레이아웃 계산을 하지 않는다.** `Element.getBoundingClientRect()`는 `{x:0, y:0, width:0, height:0}`을 돌려준다. CSS 엔진을 구현하지 않았기 때문이다. Canvas 2D context는 jsdom에서는 별도의 `canvas` npm 패키지(네이티브 C++ 컴파일)를 설치해야 하고, happy-dom은 지원하지 않는다.
  - `startScrollTracking`의 `getBoundingClientRect`: jsdom도 0을 돌려주므로 **해결할 수 없다**.
  - Pull-to-refresh의 터치 제스처와 transform 트랜지션: 흉내는 낼 수 있지만, 레이아웃에 기대는 부분이 약하다.
  - settings-ui의 Canvas 아이콘 색칠: 별도 네이티브 패키지와 Font API 처리가 따로 필요해 도입 비용이 크다.
  - 이 영역들은 **본질적으로 실제 브라우저가 있어야 하는 통합 동작**이다. e2e(Playwright)가 더 정확하고 알맞은 책임 경계다. 그래서 jsdom과 happy-dom은 들이지 않고, 원래의 「0 의존성」(Node 내장만) 원칙으로 돌아갔다(위 「결정」).
  - 재검토: 유닛 테스트에 새 의존성이 필요해지면 이 ADR을 다시 고친다.

## 적용 방식

### 모듈 로딩 전략

`js/sync/state-machine.js`는 브라우저에서 클래식 `<script>`로 불러오는 것을 전제로 `window.syncTransport` 같은 전역에 기대고, 자신은 `window.createSyncMachine`에 팩토리를 내놓는다. ESM이 아니므로 `import`할 수 없다.

`tests/unit/harness.js`가 이 방식을 그대로 재현한다.

```js
import vm from "node:vm";
const SOURCE = fs.readFileSync(STATE_MACHINE_PATH, "utf8");
const sandbox = {
  window: {
    syncTransport: makeTransportStub(opts),
    syncStoreV2: makeStoreV2Stub(),
    syncDebugLog: makeDebugLogStub(),
  },
  localStorage: makeLocalStorage(),
  navigator: { onLine: true },
  document: stubDocument(),
  setTimeout: scheduledTimer,
  clearTimeout: cancelTimer,
  // ...
};
vm.createContext(sandbox);
vm.runInContext(SOURCE, sandbox);
const machine = sandbox.window.createSyncMachine();
```

테스트마다 `loadMachine(opts)`로 **새 컨텍스트**를 만들어, 클로저(`_state`, `_ctx`, `_token`)가 케이스 사이에 새지 않게 한다.

### 시간 제어

- `setTimeout`/`clearTimeout`을 큐에 쌓는다.
- `fireAllTimers()` 도우미로 쌓인 타이머를 명시적으로 실행한다.
- `drain()`(1× `setImmediate`)으로 `_syncCycle`의 마이크로태스크가 끝나기를 기다린다.

실제 시계(wall-clock)에 기대지 않아 결과가 늘 같다.

### 1차 검증 시나리오 (PR #42, 30+ 케이스)

다음 묶음으로 나뉜다.

1. **ENABLE 분기**: iOS가 아니고 GIS가 준비되지 않았으면 INITIALIZING / iOS ENABLE이면 NEEDS_CONSENT(자동 리디렉션 금지)
2. **Identity와 Token 흐름**: silent fail → NEEDS_CONSENT, consent click → AUTHENTICATING, TOKEN_OK → IDLE
3. **SYNC_FAIL의 이유**: `"401"`은 다시 identify, `"412"`는 ETag 재시도(최대 3), `"no_token"`/`"exception"`은 확정 ERROR, 나머지는 backoff(1/2/4/8/16s)를 하고, 5회 넘게 실패하면 OFFLINE
4. **NET_RECOVERED**: OFFLINE에서 복구한다. iOS 분기에서는 자동 토큰 재요청을 피한다.
5. **redirect attempts**: localStorage 키를 하나로 모았고, 상한을 넘으면 ERROR로 한 번만 전이한다.
6. **GIS 빈 응답**: error와 access_token이 모두 없으면 IDENTITY_FAIL로 받는다.
7. **컨텍스트 리셋 계약**: `_transition`은 기본으로 모든 카운터를 리셋하고, 명시한 ctxPatch만 남긴다.

### CI 통합

처음(PR #42) `.github/workflows/test.yml`은 아래와 같았다. 지금은 `node --test tests/unit/*.test.js` 전체와 `npm run typecheck`를 돌린다(ADR-012).

```yaml
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: node --test tests/unit/state-machine.test.js
```

처음에는 PR과 push 모두에서 돌았다. `node --test`의 TAP 출력은 GitHub Actions가 저절로 알아본다.

## 채택 이유 요약

- **0 의존성**: Node에 들어 있는 것만 쓴다. 2026-05-06 당시에는 `package.json` 자체가 없었다(`dependencies`/`devDependencies`를 빈 채로 두는 원칙). 지금 `package.json`의 `devDependencies`에는 타입 검사용 `typescript` 하나뿐이고(ADR-012), 유닛 테스트가 쓰는 패키지는 없다.
- **결과가 늘 같다**: vm 컨텍스트와 가짜 타이머로 실제 시계(wall-clock), DOM, 네트워크를 모두 떼어 낸다.
- **빠르다**: PR #42의 30+ 케이스가 200ms 안에 끝났다.
- **타입 검사와 함께 쓰기 좋다**: ADR-012의 JSDoc 타입을 그대로 가져올 수 있다(`@typedef {import("../../js/types")...}`). 테스트가 도메인 타입을 그대로 쓴다.
- **리팩터링 안전망**: 앞으로 동기화 레이어를 고칠 때, 회귀 시나리오를 재현할 수 있는 형태로 쌓아 갈 수 있다.

## 결과

- Phase 2f Bugbot 6차 리뷰의 핵심 회귀 시나리오를, 결과가 늘 같은 테스트로 고정했다(ADR-011 Phase 2f 후속 정제 절 참고).
- e2e(`tests/e2e/`)는 그대로 둔다. 통합 흐름, UI, 접근성 검증은 e2e가 맡고, 유닛은 분기와 계약을 맡는다.
- 다음 단계였던 `js/sync/store-v2.js`(mergeDocs, sweepTombstones)와 `js/sync/transport.js`(consumeRedirectCallback nonce 검증)에도 그 뒤 적용했다.

## 관련 ADR

- ADR-004: 데이터 파이프라인 테스트 전략. Level 1-3(Python)이다. 이 ADR은 클라이언트 JS를 다룬다.
- ADR-011: 북마크 동기화. 이 테스트가 가장 많이 검증하는 대상이다.
- ADR-012: TypeScript 점진 도입. 같은 시기에 도입했고, JSDoc 타입을 테스트와 함께 쓴다.
