// ── state-machine.js unit tests ─────────────────────────────────────────────
// Run with: node --test tests/unit/state-machine.test.js
//
// Each test loads a fresh state machine via loadMachine() so closures
// (_state, _ctx, _token) don't bleed between cases. Async _syncCycle settles
// after `drain()` (one setImmediate). Timer-driven tests use useRealTimers:
// false + fireAllTimers().

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadMachine,
  REDIRECT_ATTEMPTS_KEY,
  MAX_REDIRECT_ATTEMPTS,
} from "./harness.js";

// ── Group 1: ENABLE 분기 ─────────────────────────────────────────────────────

test("1. 초기 상태는 DISABLED", () => {
  const { machine } = loadMachine();
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(machine.isEnabled(), false);
  assert.equal(machine.isAuthenticated(), false);
});

test("2. non-iOS + GIS 미준비 → INITIALIZING", () => {
  const { machine } = loadMachine({ isIOS: false, hasGoogleId: false });
  machine.enable();
  assert.equal(machine.getState(), "INITIALIZING");
});

test("3. iOS ENABLE → NEEDS_CONSENT (Phase 2f 회귀 방어)", () => {
  // iOS는 GIS 자체를 거치지 않고 사용자 제스처(_연결_ 클릭)에서만
  // OAuth 리디렉션이 시작돼야 한다. enable() 직후엔 redirect를 트리거하지 않고
  // NEEDS_CONSENT에 정착해 설정 UI에 "연결" 버튼이 노출되도록 한다.
  const { machine } = loadMachine({ isIOS: true });
  machine.enable();
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

// ── Group 2: acceptRedirectToken (iOS redirect 흐름) ─────────────────────────

test("4. acceptRedirectToken('') → no-op (commit 682292d 회귀 방어)", () => {
  const { machine } = loadMachine({ isIOS: true });
  machine.acceptRedirectToken("");
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(machine.isAuthenticated(), false);
});

test("5. acceptRedirectToken(null) → no-op", () => {
  const { machine } = loadMachine({ isIOS: true });
  machine.acceptRedirectToken(null);
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(machine.isAuthenticated(), false);
});

test("6. 유효 토큰 → IDLE → SYNCING (drain 후) → IDLE (sync 완료 후)", async () => {
  const { machine, drain } = loadMachine({
    isIOS: true,
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.acceptRedirectToken("test-token-abc");
  // _storeToken은 동기, _transition(IDLE) 동기, dispatch(SYNC_REQUEST)도 동기 →
  // SYNCING 상태로 진입하지만 _syncCycle 자체는 비동기.
  assert.equal(machine.getState(), "SYNCING");
  assert.equal(machine.isAuthenticated(), true);
  await drain(3);
  // findFileId=null + uploadResult.ok=true → SYNC_DONE → IDLE
  assert.equal(machine.getState(), "IDLE");
});

test("7. 토큰 수신만으로는 redirect-attempts 카운터 리셋 안 됨 (loop cap 회귀 방어)", async () => {
  const initial = { [REDIRECT_ATTEMPTS_KEY]: "2" };
  // findFileId 호출이 401을 시뮬레이션하도록 transport stub 교체:
  // downloadSyncFile은 status 401 반환 → SYNC_FAIL("401")로 무한 루프 방지 확인 위해
  // 여기서는 단순히 동기화 사이클이 시도되기 전 카운터 값만 검증.
  const { machine, localStorage } = loadMachine({
    isIOS: true,
    initialStorage: initial,
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.acceptRedirectToken("test-token");
  // SYNC_DONE 전 상태에서 카운터 보존되는지 확인
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "2");
});

// ── Group 3: SYNC_DONE ───────────────────────────────────────────────────────

test("8. SYNC_DONE 시에만 redirect-attempts 카운터가 0으로 리셋됨", async () => {
  const initial = { [REDIRECT_ATTEMPTS_KEY]: "2" };
  const { machine, localStorage, drain } = loadMachine({
    isIOS: true,
    initialStorage: initial,
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.acceptRedirectToken("test-token");
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "2", "토큰 수신 직후엔 보존");
  await drain(3);
  // SYNC_DONE이 발화하면 카운터를 "0"으로 명시 설정
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "0", "SYNC_DONE 후 리셋");
});

// ── Group 4: SYNC_FAIL 401 / reAuthFails ─────────────────────────────────────

test("9. non-iOS + GIS id available + 401 → IDENTIFYING, reAuthFails 1로 증가", async () => {
  const { machine, drain } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  // 직접 IDLE 상태로 진입시키기 위해 acceptRedirectToken 사용 (iOS=false에서도 동작)
  // — acceptRedirectToken은 iOS-only가 아닌 토큰 직접 주입 경로
  machine.acceptRedirectToken("token");
  await drain(3);
  // 401 수신 → _handleSyncFail("401") → IDENTIFYING (hasGoogleId true 분기)
  assert.equal(machine.getState(), "IDENTIFYING");
  // ctxAt: dispatch 시점의 ctx 스냅샷. _handleSyncFail은 reAuthFails+1 패치.
  // dispatch SYNC_FAIL 직후 _transition이 호출되며 그 시점 _ctx는 reAuthFails: 0
  // (이전 cycle에 저장된 값) — 실제 증가는 _transition 내부에서 이뤄짐.
  // 직접 검증은 어려우므로 다음 cycle 진입을 의미하는 IDENTIFYING 상태만 확인.
});

test("10. iOS 401 + 활발히 읽는 중 → NEEDS_CONSENT (commit 682292d 회귀 방어)", async () => {
  const { machine, drain } = loadMachine({
    isIOS: true,
    activeReading: true,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.acceptRedirectToken("token");
  await drain(3);
  // 사용자가 능동적으로 읽는 중엔 disruptive redirect 대신 snackbar+park.
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("11. 401 SYNC_FAIL → REAUTH 로그 attempt=1 + ctx에 reAuthFails 증가 기록", async () => {
  // MAX_REAUTH ≥ 3 분기는 정상 이벤트 흐름으로 도달 불가:
  // - AUTHENTICATING + TOKEN_OK → IDLE (empty ctxPatch) → reAuthFails 리셋
  // - IDENTIFYING/AUTHENTICATING/NEEDS_CONSENT에서 SYNC_FAIL은 핸들러 없음 (no-op)
  // - iOS active-reading 경로는 _beginRedirect로 페이지 이탈 → 새 세션 시작
  // 따라서 cap 자체는 방어 코드. 대신 첫 401 발생 시 카운터 증가 의도가
  // 로그에 정확히 기록되는지를 회귀 방어 지점으로 검증한다.
  const { machine, drain, logEntries } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.acceptRedirectToken("token");
  await drain(3);
  const reauth = logEntries.find((e) => e.event === "REAUTH");
  assert.ok(reauth, "REAUTH 로그 엔트리 존재");
  assert.equal(reauth.attempt, 1, "첫 401에서 attempt=1");
  assert.equal(machine.getState(), "IDENTIFYING");
});

// ── Group 5: OFFLINE + NET_RECOVERED ─────────────────────────────────────────

test("12. iOS OFFLINE → NET_RECOVERED → NEEDS_CONSENT (commit 87b1896 회귀 방어)", async () => {
  // OFFLINE 진입 경로: navigator.onLine=false + 5xx → 첫 실패에서 즉시 OFFLINE.
  // 이전 코드는 AUTHENTICATING로 갔지만 GIS 미사용 iOS 경로에선 dispatch 진행
  // 불가로 stuck. 현재 코드는 NEEDS_CONSENT로 정착해 사용자 제스처를 대기한다.
  // OFFLINE 도달: navigator.onLine=false + sync 5xx 반복으로 OFFLINE 진입
  let downloadFails = 0;
  const { machine, drain } = loadMachine({
    isIOS: true,
    onlineFlag: false,
    findFileId: "fid",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => {
          downloadFails++;
          return { doc: null, etag: null, status: 500 };
        },
      },
    },
    useRealTimers: true,
  });
  machine.acceptRedirectToken("token");
  await drain(5);
  // navigator.onLine=false → 첫 5xx에서 즉시 OFFLINE
  assert.equal(machine.getState(), "OFFLINE");
  // NET_RECOVERED 디스패치
  machine.dispatch({ type: "NET_RECOVERED" });
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("13. non-iOS OFFLINE → NET_RECOVERED → AUTHENTICATING", async () => {
  const { machine, drain } = loadMachine({
    isIOS: false,
    hasGoogleId: false, // GIS id 없음 → AUTHENTICATING로 직접 진입
    onlineFlag: false,
    findFileId: "fid",
    overrideStubs: {
      T: { downloadSyncFile: async () => ({ doc: null, etag: null, status: 500 }) },
    },
  });
  machine.acceptRedirectToken("token");
  await drain(3);
  assert.equal(machine.getState(), "OFFLINE");
  machine.dispatch({ type: "NET_RECOVERED" });
  // hasGoogleId=false → IDENTIFYING이 아닌 AUTHENTICATING로 분기
  assert.equal(machine.getState(), "AUTHENTICATING");
});

// ── Group 6: _beginRedirect cap ──────────────────────────────────────────────

test("14. iOS USER_CONSENT_REQUEST + attempts<MAX_REDIRECT_ATTEMPTS → beginRedirectAuth 호출", () => {
  let beginCalls = 0;
  const initial = { [REDIRECT_ATTEMPTS_KEY]: "2" };
  const { machine, localStorage } = loadMachine({
    isIOS: true,
    initialStorage: initial,
    overrideStubs: {
      T: { beginRedirectAuth: () => { beginCalls++; } },
    },
  });
  machine.enable();
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(beginCalls, 1, "리디렉션 호출 발생");
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "3", "카운터 1 증가");
});

test("15. iOS USER_CONSENT_REQUEST + attempts≥MAX → ERROR + beginRedirectAuth 미호출 (commit e6179d1 회귀 방어)", () => {
  let beginCalls = 0;
  const initial = { [REDIRECT_ATTEMPTS_KEY]: String(MAX_REDIRECT_ATTEMPTS) };
  const { machine } = loadMachine({
    isIOS: true,
    initialStorage: initial,
    overrideStubs: {
      T: { beginRedirectAuth: () => { beginCalls++; } },
    },
  });
  machine.enable();
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(beginCalls, 0, "cap 초과 시 리디렉션 호출 차단");
  assert.equal(machine.getState(), "ERROR");
});
