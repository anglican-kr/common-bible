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

test("9. non-iOS + GIS id available + 401 + email hint → AUTHENTICATING (silent reauth)", async () => {
  // acceptRedirectToken → _storeToken → fetchUserInfo가 SYNC_EMAIL_KEY를
  // 채우므로, 401 reauth 시점엔 항상 email hint가 존재한다. 이 경로는
  // FedCM 카드 없이 silent token 요청으로 직행한다 (silentAuthInFlight=true).
  const { machine, drain } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.acceptRedirectToken("token");
  await drain(3);
  assert.equal(machine.getState(), "AUTHENTICATING");
});

test("9b. non-iOS + 401 + email hint 없음 → IDENTIFYING (FedCM 경로 유지)", async () => {
  // fetchUserInfo가 email을 못 가져오는 경계 케이스 — IDENTIFYING으로
  // 떨어져 FedCM이 hint를 제공해야 한다.
  const { machine, drain } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
    overrideStubs: {
      T: { fetchUserInfo: async () => ({ email: null }) },
    },
  });
  machine.acceptRedirectToken("token");
  await drain(3);
  assert.equal(machine.getState(), "IDENTIFYING");
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
  // email hint 보유 시 IDENTIFYING을 건너뛰고 AUTHENTICATING으로 직행 (silent)
  assert.equal(machine.getState(), "AUTHENTICATING");
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

// ── Group 7: 데스크탑 silent-auth bypass (FedCM 카드 회피) ───────────────────

test("16. non-iOS GIS_READY + email hint → IDENTIFYING 건너뛰고 AUTHENTICATING (silent)", () => {
  // 저장된 email은 OAuth가 한 번 성공했음을 의미 → FedCM/One Tap 카드를
  // 띄울 이유가 없다. silent token 요청으로 바로 진입한다.
  let promptIdentityCalls = 0;
  let silentTokenCalls = 0;
  const { machine } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    initialStorage: { [SYNC_EMAIL_KEY]: "user@example.com" },
    overrideStubs: {
      T: {
        promptIdentity: () => { promptIdentityCalls++; },
        requestSilentToken: () => { silentTokenCalls++; },
      },
    },
  });
  machine.enable();
  machine.dispatch({ type: "GIS_READY" });
  assert.equal(promptIdentityCalls, 0, "FedCM prompt 미호출");
  assert.equal(silentTokenCalls, 1, "silent token 1회 호출");
  assert.equal(machine.getState(), "AUTHENTICATING");
});

test("17. non-iOS GIS_READY + email hint 없음 → 기존 IDENTIFYING 경로 유지", () => {
  // 첫 사용자는 email이 없으므로 FedCM/One Tap으로 식별을 받아야 한다.
  let promptIdentityCalls = 0;
  const { machine } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    overrideStubs: {
      T: { promptIdentity: () => { promptIdentityCalls++; } },
    },
  });
  machine.enable();
  machine.dispatch({ type: "GIS_READY" });
  assert.equal(promptIdentityCalls, 1, "FedCM prompt 1회 호출");
  assert.equal(machine.getState(), "IDENTIFYING");
});

test("18. silent AUTHENTICATING + TOKEN_FAIL → NEEDS_CONSENT (스낵바 없음)", () => {
  // 백그라운드 silent 시도 실패는 사용자에게 알릴 일이 아니다 — 설정의
  // "연결" 버튼이 NEEDS_CONSENT 상태에서 노출되므로 그쪽으로 정착한다.
  let snackbarCalls = 0;
  const { machine, ctx } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
    initialStorage: { [SYNC_EMAIL_KEY]: "user@example.com" },
  });
  ctx._showSyncSnackbar = () => { snackbarCalls++; };
  machine.enable();
  machine.dispatch({ type: "GIS_READY" });
  assert.equal(machine.getState(), "AUTHENTICATING");
  machine.dispatch({ type: "TOKEN_FAIL", reason: "interaction_required" });
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(snackbarCalls, 0, "silent 실패 시 스낵바 미호출");
});

test("19. user-gesture AUTHENTICATING + TOKEN_FAIL → ERROR + 스낵바 (기존 동작)", () => {
  // NEEDS_CONSENT에서 USER_CONSENT_REQUEST로 진입한 경우는 사용자가 명시적으로
  // 요청한 경로이므로 실패 시 스낵바로 알리고 ERROR로 떨어진다.
  let snackbarCalls = 0;
  const { machine, ctx } = loadMachine({
    isIOS: false,
    hasGoogleId: true,
  });
  ctx._showSyncSnackbar = () => { snackbarCalls++; };
  // IDENTIFYING → USER_CONSENT_REQUEST → AUTHENTICATING (silentAuthInFlight=false)
  machine.enable();
  machine.dispatch({ type: "GIS_READY" });
  assert.equal(machine.getState(), "IDENTIFYING");
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(machine.getState(), "AUTHENTICATING");
  machine.dispatch({ type: "TOKEN_FAIL", reason: "server_error" });
  assert.equal(machine.getState(), "ERROR");
  assert.equal(snackbarCalls, 1, "user-gesture 실패는 스낵바로 알림");
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
