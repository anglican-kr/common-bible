# ADR-013: 클라이언트 JS 유닛 테스트 전략

- 일시: 2026-05-06
- 상태: 승인됨 (1차 — `js/sync/state-machine.js` 적용)

## 결정

브라우저 클래식 스크립트로 로드되는 `js/sync/state-machine.js`를 **Node 자체 테스트 러너 (`node --test`)** 위에서 검증한다. 테스트 러너 의존성(jest, mocha, vitest 등)을 추가하지 않고, 자체 하네스가 `node:vm`으로 모듈을 격리 컨텍스트에 로드한 뒤 브라우저 글로벌(`window`, `localStorage`, `navigator`, `document`, `setTimeout`)을 스텁한다.

## 맥락

ADR-004는 **데이터 파이프라인** 테스트 전략을 다루며, 그 외 클라이언트 JS는 e2e 테스트(Playwright, 로컬 전용)로만 검증돼 왔다. e2e는 통합 동작은 잘 잡지만 다음과 같은 회귀에 취약하다.

- 상태 머신의 분기 회귀 (예: iOS ENABLE 시 자동 리디렉션 트리거 — 사용자 제스처 밖에서 OAuth 시작)
- 카운터·캡 회귀 (예: redirect attempts cap 초과 시 NEEDS_CONSENT → ERROR 이중 전이)
- 부분 응답 처리 (GIS Token Client 빈 응답 → IDENTITY_FAIL 흡수)

이런 회귀는 e2e에선 외부 네트워크/UI를 거쳐야 재현되는데 비결정적이고 느리다. 동시에 ADR-011의 동기화 코드는 검수 후 함부로 손대기 어려워 회귀 비용이 매우 높다.

## 검토한 대안

| 방식 | 추가 의존성 | 격리 | 채택 |
| --- | --- | --- | --- |
| Jest + jsdom | jest, jsdom (대형) | jsdom 글로벌 | ❌ — Vanilla 원칙 위반 |
| Vitest | vitest, esbuild | vm 기반 | ❌ — 빌드 의존성 추가 |
| Playwright unit 모드 | playwright (이미 e2e용 존재) | 실제 브라우저 | ❌ — 단위 테스트로 너무 무거움 |
| **Node `--test` + 자체 vm 하네스** | 없음 (Node 24 내장) | `node:vm` per-test 컨텍스트 | ✅ |

Node 22부터 `node --test`는 안정 기능이며 `--watch` / `--test-name-pattern` / `--test-only` 등을 모두 지원한다. CI는 이미 `actions/setup-node@v4 node-version: 24`를 쓴다.

## 적용 방식

### 모듈 로딩 전략

`js/sync/state-machine.js`는 브라우저에서 클래식 `<script>` 로드를 가정해 `window.syncTransport` 등 글로벌에 의존하고, 자기 자신은 `window.createSyncMachine`에 팩토리를 export한다. ESM이 아니므로 `import` 불가.

`tests/unit/harness.js`가 이 패턴을 그대로 재현한다.

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

테스트마다 `loadMachine(opts)`로 **새 컨텍스트**를 만들어 클로저(`_state`, `_ctx`, `_token`)가 케이스 간에 새지 않도록 한다.

### 시간 제어

- `setTimeout`/`clearTimeout`을 큐에 적재
- `fireAllTimers()` 헬퍼로 명시적 발화
- `drain()` (1× `setImmediate`) 으로 `_syncCycle` 마이크로태스크 settle

월-clock 의존이 없어 결정적이다.

### 1차 검증 시나리오 (PR #42, 30+ 케이스)

다음 그룹으로 묶여 있다:

1. **ENABLE 분기**: non-iOS GIS 미준비 → INITIALIZING / iOS ENABLE → NEEDS_CONSENT (자동 리디렉션 금지)
2. **Identity / Token 흐름**: silent fail → NEEDS_CONSENT, consent click → AUTHENTICATING, TOKEN_OK → IDLE
3. **SYNC_FAIL reasons**: `"401"` re-identify, `"412"` ETag 재시도(max 3), `"no_token"`/`"exception"` deterministic ERROR, 기타 backoff(1/2/4/8/16s) → 5회 초과 OFFLINE
4. **NET_RECOVERED**: OFFLINE 복구, iOS 분기에서는 자동 토큰 재요청 회피
5. **redirect attempts**: localStorage 키 단일화, cap 초과 시 단일 ERROR 전이
6. **GIS 빈 응답**: error / access_token 모두 미존재 → IDENTITY_FAIL 흡수
7. **컨텍스트 리셋 계약**: `_transition` 기본 동작이 모든 카운터를 리셋, 명시적 ctxPatch만 보존

### CI 통합

`.github/workflows/test.yml`:

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

PR/push 모두에서 실행. `node --test`는 TAP 출력을 GitHub Actions가 자동 인식.

## 채택 이유 요약

- **0 의존성**: Node 내장 — `package.json` `dependencies`/`devDependencies` 빈 채로 유지(현재 저장소에 `package.json` 자체가 없음)
- **결정적**: vm 컨텍스트 + 가짜 타이머로 wall-clock·DOM·네트워크 모두 격리
- **빠름**: PR #42 30+ 케이스가 200ms 미만에 완료
- **타입 검사와 시너지**: ADR-012의 JSDoc 타입이 그대로 import 가능 (`@typedef {import("../../js/types")...}`) — 테스트가 도메인 타입을 first-class로 다룸
- **리팩터링 안전망**: 앞으로 동기화 레이어를 만질 때 회귀 시나리오를 재현 가능한 형태로 누적 가능

## 결과

- Phase 2f Bugbot 6차 리뷰의 핵심 회귀 시나리오가 결정적 테스트로 고정됨 (ADR-011 Phase 2f 후속 정제 절 참고)
- e2e (`tests/e2e/`)는 그대로 유지 — 통합 흐름·UI·접근성 검증 책임. 유닛은 분기·계약을 책임.
- 다음 단계: `js/sync/store-v2.js` (mergeDocs, sweepTombstones), `js/sync/transport.js` (consumeRedirectCallback nonce 검증) 적용

> **개정 (2026-05-09): 명명 컨벤션**
>
> 테스트 파일 이름이 비일관적으로 누적되어 모듈-테스트 매핑이 헷갈리는 상황이 발생했다 — `search-history.test.js`가 `js/app/storage.js`의 일부를 가리키고 `search.test.js`가 `js/app/search.js` 전체를 가리키며, `transport-pkce.test.js`가 `js/sync/transport.js`의 PKCE 영역을 강조해 모듈명이 보이지 않는다. 다음 컨벤션을 도입한다.
>
> **규칙 1 (기본)**: `tests/unit/<source-basename>.test.js` 형식. 소스 파일 이름과 1:1 매핑. 한 모듈 = 한 테스트 파일.
>
> **규칙 2 (영역 구분)**: 모듈 내부의 영역(예: PKCE primitives vs Drive REST, search history vs settings storage)은 테스트 파일 안에서 `// ── <영역> ──` 코멘트 섹션으로 분리한다. `search.test.js`가 이 패턴을 이미 사용 중.
>
> **규칙 3 (모듈이 너무 커질 때)**: `tests/unit/<basename>/<concern>.test.js` 디렉토리 분할로 처리한다 — 현재 해당 사례 없음.
>
> 적용:
>
> - `search-history.test.js` → `storage.test.js` (storage.js의 다른 부분도 차후 같은 파일에 합류 예정)
> - `transport-pkce.test.js` → `transport.test.js`
>
> CI 워크플로(`tests/unit/*.test.js` glob)는 자동으로 새 파일명을 픽업 — workflow YAML 변경 0.

## 관련 ADR

- ADR-004: 데이터 파이프라인 테스트 전략 — Level 1-3 (Python). 본 ADR은 클라이언트 JS 영역.
- ADR-011: 북마크 동기화 — 본 테스트의 주요 검증 대상
- ADR-012: TypeScript 점진 도입 — 같은 사이클에 도입, JSDoc 타입을 테스트가 공유
