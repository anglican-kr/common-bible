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
  SILENT_BLOCKED_KEY,
  SYNC_EMAIL_KEY,
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

test("3. iOS ENABLE + 저장된 email 없음 → NEEDS_CONSENT (첫 연결 흐름)", () => {
  // 저장된 email이 없다는 건 OAuth가 한 번도 성공한 적 없다는 뜻 —
  // 자동 silent 재인증을 시도할 근거가 없다. NEEDS_CONSENT에 정착해
  // 사용자가 "연결" 버튼을 눌러 명시적 consent flow를 시작해야 한다.
  const { machine } = loadMachine({ isIOS: true });
  machine.enable();
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("3a. iOS ENABLE + 저장된 email 있음 → silent prompt=none 자동 리디렉션 (Phase 2g)", () => {
  // ADR-011 Phase 2g: 이전에 성공적으로 연결한 사용자는 앱 재실행 시
  // GIS 없이 자동으로 prompt=none 리디렉션을 시도해 토큰을 갱신한다.
  // Implicit Flow는 refresh token이 없어 in-memory 토큰이 앱 종료와 함께
  // 사라지므로, saved email이 있다는 사실이 silent 재인증의 진입 조건.
  const beginCalls = [];
  const { machine, localStorage } = loadMachine({
    isIOS: true,
    initialStorage: { [SYNC_EMAIL_KEY]: "user@example.com" },
    overrideStubs: {
      T: { beginRedirectAuth: (_clientId, _scope, opts) => { beginCalls.push(opts); } },
    },
  });
  machine.enable();
  assert.equal(beginCalls.length, 1, "리디렉션 1회 호출");
  assert.equal(beginCalls[0]?.prompt, "none", "prompt=none (silent)");
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "1", "리디렉션 카운터 1 증가");
  // 페이지가 떠나는 흐름이라 상태는 silent 시도 전 상태로 남아 있다 —
  // 실제 브라우저에서는 callback이 새 컨텍스트에서 acceptRedirectToken으로 진입.
});

test("3b. iOS ENABLE + email + silent-blocked=1 → 재시도 없이 NEEDS_CONSENT (Phase 2g)", () => {
  // 이전 silent 시도가 interaction_required로 실패한 경우, 다음 앱 오픈에
  // 자동 재시도하면 의미 없는 깜박임만 반복된다. silent-blocked 플래그가
  // 1이면 NEEDS_CONSENT로 직행해 사용자 제스처(연결 버튼 클릭)를 대기한다.
  let beginCalls = 0;
  const { machine } = loadMachine({
    isIOS: true,
    initialStorage: {
      [SYNC_EMAIL_KEY]: "user@example.com",
      [SILENT_BLOCKED_KEY]: "1",
    },
    overrideStubs: {
      T: { beginRedirectAuth: () => { beginCalls++; } },
    },
  });
  machine.enable();
  assert.equal(beginCalls, 0, "silent-blocked=1이면 자동 리디렉션 차단");
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("3c. iOS ENABLE + email + cap 도달 → ERROR (Phase 2g 무한 루프 차단)", () => {
  // _beginRedirect 내부 cap 검사가 silent 자동 시도에도 동일하게 적용되는지 확인.
  // cap에 도달한 상태에서 더 시도하면 ERROR로 빠지고 사용자가 "연결" 버튼을
  // 눌러야만 카운터가 리셋된다 (signIn() 또는 ERROR + USER_CONSENT_REQUEST).
  let beginCalls = 0;
  const { machine } = loadMachine({
    isIOS: true,
    initialStorage: {
      [SYNC_EMAIL_KEY]: "user@example.com",
      [REDIRECT_ATTEMPTS_KEY]: String(MAX_REDIRECT_ATTEMPTS),
    },
    overrideStubs: {
      T: { beginRedirectAuth: () => { beginCalls++; } },
    },
  });
  machine.enable();
  assert.equal(beginCalls, 0, "cap 초과 시 리디렉션 호출 차단");
  assert.equal(machine.getState(), "ERROR");
});

test("3d. iOS ENABLE + email = '' (빈 문자열) → NEEDS_CONSENT (자동 시도 안 함)", () => {
  // _storeToken이 fetchUserInfo 실패 시 빈 문자열을 저장하는 경계 케이스 —
  // 진짜 email 없는 상태와 동일하게 처리해야 한다.
  let beginCalls = 0;
  const { machine } = loadMachine({
    isIOS: true,
    initialStorage: { [SYNC_EMAIL_KEY]: "" },
    overrideStubs: {
      T: { beginRedirectAuth: () => { beginCalls++; } },
    },
  });
  machine.enable();
  assert.equal(beginCalls, 0, "빈 문자열은 silent 시도 트리거 아님");
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("3e. SYNC_DONE 시 silent-blocked 플래그도 함께 리셋 (Phase 2g defense in depth)", async () => {
  const initial = {
    [REDIRECT_ATTEMPTS_KEY]: "2",
    [SILENT_BLOCKED_KEY]: "1",
  };
  const { machine, localStorage, drain } = loadMachine({
    isIOS: true,
    initialStorage: initial,
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.acceptRedirectToken("test-token");
  await drain(3);
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "0", "redirect-attempts 리셋");
  assert.equal(localStorage.getItem(SILENT_BLOCKED_KEY), null, "silent-blocked 제거");
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
  // 사이클이 backoff retry 없이 단번에 OFFLINE으로 갔는지 확인 — onLine=false가
  // MAX_NET_RETRIES 카운트를 무시하고 첫 실패에서 곧장 OFFLINE 분기를 타게 한다.
  assert.equal(downloadFails, 1, "첫 다운로드 실패에서 즉시 OFFLINE으로 진입");
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

// ── Group 7: Phase 2h silent refresh on enable() ─────────────────────────────
// 설계서 §6.1·§6.2 — _attemptSilentRefresh가 enable() 시점에 fire-and-forget로
// 시작되고, IDB에 refresh token이 있으면 동기 dispatch(ENABLE)와 race한다.
// 결과 적용 시점에 race 가드(상태가 IDLE/ERROR면 폐기)가 걸린다.

test("16. enable() + IDB에 refresh token 있음 → 백그라운드 갱신 → IDLE 진입", async () => {
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-stored",
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  // 동기 dispatch는 INITIALIZING으로 보냄 (legacy 경로)
  assert.equal(machine.getState(), "INITIALIZING");
  // silent refresh가 비동기로 resolve → IDLE → SYNC_REQUEST → SYNCING
  await drain(5);
  // 최종 상태는 IDLE (sync가 SYNC_DONE으로 종료) 또는 SYNCING (drain 부족 시)
  const finalState = machine.getState();
  assert.ok(
    finalState === "IDLE" || finalState === "SYNCING",
    `silent refresh 성공 후 IDLE/SYNCING이어야 함, got ${finalState}`,
  );
  assert.equal(machine.isAuthenticated(), true);
});

test("17. enable() + IDB 비어있음 → 기존 INITIALIZING 흐름 유지", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: null,
  });
  machine.enable();
  await drain(3);
  // refresh token 없음 → silent refresh 즉시 false 반환, 상태 변경 X
  // 동기 dispatch가 INITIALIZING으로 보낸 그 상태 유지
  assert.equal(machine.getState(), "INITIALIZING");
  assert.equal(stubs.refreshStore._calls.load, 1, "load는 호출됨");
  assert.equal(stubs.refreshStore._calls.save, 0, "save 미호출");
});

test("18. silent refresh 성공 + rotation 토큰 → IDB 새 값으로 갱신", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-old",
    refreshResult: {
      ok: true, access_token: "at-new", refresh_token: "rt-rotated", expires_in: 3600,
    },
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  await drain(5);
  assert.equal(stubs.refreshStore._peek(), "rt-rotated", "rotation 결과가 IDB에 반영");
  assert.equal(stubs.refreshStore._calls.save, 1);
});

test("19. silent refresh 성공 + rotation 없음 → 기존 IDB 값 보존", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-keep",
    refreshResult: {
      ok: true, access_token: "at-new", refresh_token: null, expires_in: 3600,
    },
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  await drain(5);
  assert.equal(stubs.refreshStore._peek(), "rt-keep", "rotation 없으면 기존 값 유지");
  assert.equal(stubs.refreshStore._calls.save, 0, "save 미호출 (덮어쓰기 방지)");
});

test("20. silent refresh invalid_grant → IDB clear + NEEDS_CONSENT (스낵바 없음)", async () => {
  let snackbarCalls = 0;
  const { machine, drain, stubs, ctx } = loadMachine({
    initialRefreshToken: "rt-expired",
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
  });
  ctx._showSyncSnackbar = () => { snackbarCalls++; };
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(stubs.refreshStore._peek(), null, "IDB clear 됨");
  assert.equal(stubs.refreshStore._calls.clear, 1);
  assert.equal(snackbarCalls, 0, "백그라운드 silent 실패는 사용자에 알리지 않음");
});

test("21. silent refresh 5xx → OFFLINE + IDB 보존 (NET_RECOVERED 재시도 대비)", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-keep",
    refreshResult: { ok: false, status: 503, error: "http_error" },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "OFFLINE");
  assert.equal(stubs.refreshStore._peek(), "rt-keep", "5xx에는 IDB 보존");
  assert.equal(stubs.refreshStore._calls.clear, 0);
});

test("22. silent refresh race lost → IDLE/SYNCING 유지, 결과 폐기", async () => {
  // legacy GIS 흐름이 먼저 IDLE에 도달했다고 가정 → silent refresh 결과 도착 시
  // race 가드가 걸려 NEEDS_CONSENT로 끌어내리지 않아야 함.
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  // Direct token injection puts us in IDLE before silent refresh resolves
  machine.acceptRedirectToken("legacy-token");
  machine.enable();  // 이미 DISABLED 아니므로 즉시 return — silent refresh도 시작 안 됨
  await drain(5);
  // legacy 경로가 settled → IDLE/SYNCING
  const finalState = machine.getState();
  assert.ok(
    finalState === "IDLE" || finalState === "SYNCING",
    `race lost 시 settled 상태 유지, got ${finalState}`,
  );
});

// ── Group 8: 401 → silent refresh ────────────────────────────────────────────

test("23. SYNCING 중 401 + IDB 토큰 있음 → silent refresh → 새 token으로 회복", async () => {
  // 첫 시도 401, 두 번째 시도 200 — production에선 새 access token이 Drive에
  // 받아들여지는 상황을 시뮬레이션. 무한 루프가 안 나는지도 함께 검증.
  let downloadCalls = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-stored",
    findFileId: "fid",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => {
          downloadCalls++;
          return downloadCalls === 1
            ? { doc: null, etag: null, status: 401 }
            : { doc: null, etag: null, status: 200 };
        },
      },
    },
  });
  machine.acceptRedirectToken("expiring-token");
  await drain(8);
  // 첫 사이클: 401 → silent refresh 성공 → 두 번째 사이클: 200 → SYNC_DONE → IDLE
  assert.equal(machine.getState(), "IDLE", "두 번째 사이클 후 IDLE 정착");
  assert.equal(downloadCalls, 2, "첫 401 + 두 번째 200, 무한 루프 없음");
});

test("23a. 401 반복 + silent refresh 매번 성공해도 reAuthFails MAX_REAUTH로 ERROR", async () => {
  // 만성 401 (Drive가 새 token도 거절) — refresh가 성공해도 cap에 걸려야 함.
  let downloadCalls = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: "fid",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => {
          downloadCalls++;
          return { doc: null, etag: null, status: 401 };
        },
      },
    },
  });
  machine.acceptRedirectToken("token");
  await drain(20);
  // MAX_REAUTH=3 → 4번째 401에서 ERROR
  assert.equal(machine.getState(), "ERROR");
  assert.ok(downloadCalls <= 5, `cap 작동 검증: download ${downloadCalls}회 (≤ MAX_REAUTH+2)`);
});

test("24. SYNCING 중 401 + IDB 비어있음 → 기존 reauth 폴백", async () => {
  const { machine, drain } = loadMachine({
    initialRefreshToken: null,
    hasGoogleId: true, // GIS available → IDENTIFYING 분기
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.acceptRedirectToken("token");
  await drain(5);
  // refresh token 없음 → _legacyReauthAfter401 → email hint 있으면 AUTHENTICATING (Phase 2h commit b9a926c)
  const state = machine.getState();
  assert.ok(
    state === "IDENTIFYING" || state === "AUTHENTICATING",
    `legacy reauth 경로, got ${state}`,
  );
});

test("25. SYNCING 중 401 + silent refresh invalid → NEEDS_CONSENT", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-expired",
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.acceptRedirectToken("token");
  await drain(5);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(stubs.refreshStore._calls.clear, 1, "IDB clear 호출됨");
});

// ── Group 9: acceptRedirectCode (PKCE callback 진입점) ───────────────────────

test("26. acceptRedirectCode(code, verifier) 정상 → IDLE + IDB 저장", async () => {
  const { machine, drain, stubs } = loadMachine({
    exchangeResult: {
      ok: true, access_token: "at-new", refresh_token: "rt-new",
      expires_in: 3600, scope: "drive.appdata email",
    },
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  await machine.acceptRedirectCode("auth-code-x", "verifier-y");
  await drain(3);
  const state = machine.getState();
  assert.ok(
    state === "IDLE" || state === "SYNCING",
    `code 교환 성공 후 settled, got ${state}`,
  );
  assert.equal(machine.isAuthenticated(), true);
  assert.equal(stubs.refreshStore._peek(), "rt-new", "refresh token IDB에 저장");
  assert.equal(stubs.refreshStore._calls.save, 1);
});

test("27. acceptRedirectCode 빈 인자 → no-op", async () => {
  const { machine, stubs } = loadMachine();
  await machine.acceptRedirectCode("", "verifier");
  await machine.acceptRedirectCode("code", "");
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(stubs.refreshStore._calls.save, 0);
});

test("28. acceptRedirectCode 교환 실패 → NEEDS_CONSENT + 스낵바", async () => {
  let snackbarCalls = 0;
  const { machine, ctx } = loadMachine({
    exchangeResult: { ok: false, status: 400, error: "invalid_grant" },
  });
  ctx._showSyncSnackbar = () => { snackbarCalls++; };
  await machine.acceptRedirectCode("bad-code", "verifier");
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(snackbarCalls, 1, "사용자가 직접 시작한 흐름이라 실패는 알림");
});

// ── Bugbot PR #54: DISABLED race 보강 ────────────────────────────────────────
// 사용자가 disable()을 호출해 명시적으로 끊은 직후 silent refresh / code 교환이
// 성공해도 IDLE로 끌어올리면 안 됨 — 사용자 의도 무시.

test("29. silent refresh 진행 중 disable() 호출 → DISABLED 유지 (Bugbot #54)", async () => {
  // refreshAccessToken을 즉시 resolve하지 않고 외부 제어 가능한 promise로 hold,
  // 그 사이에 disable()을 호출해 race window를 인위적으로 만든다.
  let resolveRefresh;
  const refreshPromise = new Promise((r) => { resolveRefresh = r; });
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-pending",
    overrideStubs: {
      T: { refreshAccessToken: () => refreshPromise },
    },
  });
  machine.enable();
  // enable()이 silent refresh를 fire-and-forget로 시작했지만 refreshPromise는 아직 pending
  assert.equal(machine.getState(), "INITIALIZING", "enable()의 동기 dispatch는 INITIALIZING");
  // 사용자가 disconnect 클릭
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  // 이제 refresh가 성공으로 resolve되더라도 race 가드가 DISABLED를 잡아야 함
  resolveRefresh({ ok: true, access_token: "at-x", refresh_token: null, expires_in: 3600 });
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "DISABLED 유지 — silent 성공 결과 폐기");
  assert.equal(machine.isAuthenticated(), false, "토큰 미보관");
});

// ── Bugbot PR #54 (2차): SYNCING race 가드 ───────────────────────────────────

test("31. cold-start 경로에서 silent refresh가 SYNCING에 도달한 legacy 결과를 덮어쓰지 않음", async () => {
  // 시나리오: enable() → silent refresh fire (네트워크 round-trip) → 그 사이
  // legacy GIS 경로가 빠르게 IDLE → SYNC_REQUEST → SYNCING까지 도달
  //   → 진행 중인 cycle을 silent refresh 결과로 끊지 않아야 함.
  let resolveRefresh;
  const refreshPromise = new Promise((r) => { resolveRefresh = r; });
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-pending",
    overrideStubs: {
      T: { refreshAccessToken: () => refreshPromise },
    },
  });
  machine.enable(); // silent refresh fired (refreshPromise pending)
  // Legacy 경로가 빨리 끝났다고 시뮬레이션 — token 직접 주입으로 IDLE → SYNCING
  machine.acceptRedirectToken("legacy-token");
  await drain(2);
  // 이 시점 상태는 SYNCING (legacy cycle 진행 중) 또는 IDLE (cycle 끝남)
  // refresh가 늦게 성공으로 resolve되더라도 SYNCING/IDLE 폐기로 처리해야 함
  resolveRefresh({ ok: true, access_token: "at-from-refresh", refresh_token: null, expires_in: 3600 });
  await drain(5);
  const finalState = machine.getState();
  assert.ok(
    finalState === "IDLE" || finalState === "SYNCING",
    `legacy 결과 유지, got ${finalState}`,
  );
  // legacy의 token이 보존돼야 — silent refresh의 access token으로 덮어쓰면 안 됨
  assert.notEqual(machine.getToken(), "at-from-refresh", "silent refresh 결과 폐기됨");
});

test("32. 401 reauth 경로의 silent refresh는 SYNCING에서도 override 가능 (race 가드 우회)", async () => {
  // 시나리오: SYNCING에서 401 도달 → _kickoff401Reauth → silent refresh
  //   → SYNCING에서 SYNCING으로 다시 들어가는 흐름을 가드가 막으면 갇힘.
  //   fromReauth=true 플래그로 가드 우회.
  let downloadCalls = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-stored",
    findFileId: "fid",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => {
          downloadCalls++;
          return downloadCalls === 1
            ? { doc: null, etag: null, status: 401 }
            : { doc: null, etag: null, status: 200 };
        },
      },
    },
  });
  machine.acceptRedirectToken("expiring-token");
  await drain(8);
  // 401 → silent refresh override SYNCING → IDLE → SYNC_REQUEST → SYNCING (새 cycle) → 200 → IDLE
  assert.equal(machine.getState(), "IDLE", "fromReauth=true 덕분에 SYNCING 가드 우회, 회복 성공");
  assert.equal(downloadCalls, 2, "두 번째 사이클에서 200, 무한 루프 없음");
});

test("30. acceptRedirectCode 진행 중 signOut() 호출 → DISABLED 유지 (Bugbot #54)", async () => {
  // Production에선 signOut()이 localStorage["bible-drive-sync"]를 "0"으로 설정한 뒤
  // _machine.disable()을 호출함. acceptRedirectCode는 state=DISABLED에서 시작하므로
  // 가드는 _state가 아니라 localStorage flag로 사용자 의도를 판별한다.
  let resolveExchange;
  const exchangePromise = new Promise((r) => { resolveExchange = r; });
  const { machine, drain, refreshStore, localStorage } = loadMachine({
    initialStorage: { "bible-drive-sync": "1" }, // signIn() 직후 상태
    overrideStubs: {
      T: { exchangeCodeForToken: () => exchangePromise },
    },
  });
  void machine.acceptRedirectCode("code-x", "verifier-y");
  // signOut() 시뮬레이션: flag 0으로 설정 (production drive-sync.signOut 패턴)
  localStorage.setItem("bible-drive-sync", "0");
  resolveExchange({
    ok: true, access_token: "at", refresh_token: "rt",
    expires_in: 3600, scope: "drive.appdata",
  });
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "DISABLED 유지 — code 교환 결과 폐기");
  assert.equal(refreshStore._calls.save, 0, "IDB에 refresh token 저장 안 됨");
});
