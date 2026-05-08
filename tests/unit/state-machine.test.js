// ── state-machine.js unit tests ─────────────────────────────────────────────
// Run with: node --test tests/unit/state-machine.test.js
//
// Phase 2h 단계 4 이후 — 단일 PKCE 경로. GIS / Implicit Flow / FedCM 의존이
// 사라졌으므로 INITIALIZING / IDENTIFYING / AUTHENTICATING 분기 테스트도 함께
// 사라졌다. 남은 시나리오는 모두 데스크탑/Android/iOS 동일하게 동작한다.
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
  SYNC_ENABLED_KEY,
  MAX_REDIRECT_ATTEMPTS,
  CACHE_FILE_ID_KEY,
  CACHE_ETAG_KEY,
  CACHE_SYNCED_U_KEY,
} from "./harness.js";

// ── Group 1: 초기 상태 + ENABLE 분기 ─────────────────────────────────────────

test("1. 초기 상태는 DISABLED", () => {
  const { machine } = loadMachine();
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(machine.isEnabled(), false);
  assert.equal(machine.isAuthenticated(), false);
});

test("2. enable() + IDB 비어있음 → 비동기로 NEEDS_CONSENT 진입", async () => {
  // Phase 2h 단계 4: GIS 폴백이 사라졌으므로 cold start에 refresh token이 없으면
  // 다른 경로 없이 곧장 NEEDS_CONSENT로 정착해 사용자 제스처를 대기한다.
  const { machine, drain } = loadMachine({ initialRefreshToken: null });
  machine.enable();
  // enable()은 silent refresh를 fire-and-forget로 시작 → IDB 비어있으면 false 반환 →
  // NEEDS_CONSENT 전이는 microtask 이후 발생.
  assert.equal(machine.getState(), "DISABLED", "동기 시점엔 아직 DISABLED");
  await drain(3);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
});

test("3. enable() + IDB에 refresh token 있음 → 백그라운드 갱신 → IDLE/SYNCING", async () => {
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-stored",
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  await drain(5);
  const finalState = machine.getState();
  assert.ok(
    finalState === "IDLE" || finalState === "SYNCING",
    `silent refresh 성공 후 IDLE/SYNCING이어야 함, got ${finalState}`,
  );
  assert.equal(machine.isAuthenticated(), true);
});

test("4. enable() 중 disable() → DISABLED 유지 (silent refresh 결과 폐기)", async () => {
  // refreshAccessToken을 hold한 채로 disable()을 호출 → race window
  let resolveRefresh;
  const refreshPromise = new Promise((r) => { resolveRefresh = r; });
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-pending",
    overrideStubs: {
      T: { refreshAccessToken: () => refreshPromise },
    },
  });
  machine.enable();
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  resolveRefresh({ ok: true, access_token: "at-x", refresh_token: null, expires_in: 3600 });
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "silent refresh 결과 폐기");
  assert.equal(machine.isAuthenticated(), false);
});

// ── Group 2: silent refresh 결과 분기 ────────────────────────────────────────

test("5. silent refresh 성공 + rotation 토큰 → IDB 새 값으로 갱신", async () => {
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

test("6. silent refresh 성공 + rotation 없음 → 기존 IDB 값 보존", async () => {
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

test("7. silent refresh invalid_grant → IDB clear + NEEDS_CONSENT (스낵바 없음)", async () => {
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

test("8. silent refresh 5xx → OFFLINE + IDB 보존 (NET_RECOVERED 재시도 대비)", async () => {
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

// ── Group 3: USER_CONSENT_REQUEST → PKCE redirect ────────────────────────────

test("9. NEEDS_CONSENT + USER_CONSENT_REQUEST → beginRedirectAuth 호출", async () => {
  const beginCalls = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: null,
    overrideStubs: {
      T: { beginRedirectAuth: async (_clientId, _scope, opts) => { beginCalls.push(opts); } },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(beginCalls.length, 1, "리디렉션 1회 호출");
  assert.equal(beginCalls[0]?.prompt, "consent");
});

test("10. USER_CONSENT_REQUEST + attempts ≥ MAX → ERROR + redirect 차단", () => {
  let beginCalls = 0;
  const { machine } = loadMachine({
    initialStorage: { [REDIRECT_ATTEMPTS_KEY]: String(MAX_REDIRECT_ATTEMPTS) },
    overrideStubs: {
      T: { beginRedirectAuth: async () => { beginCalls++; } },
    },
  });
  // ERROR 상태로 부팅한 셈 — NEEDS_CONSENT보다 직접적인 cap 검증 케이스.
  // USER_CONSENT_REQUEST는 모든 비-IDLE/SYNCING 상태에서 _beginRedirect를 호출.
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(beginCalls, 0, "cap 초과 시 리디렉션 호출 차단");
  assert.equal(machine.getState(), "ERROR");
});

test("11. IDLE 상태에서 USER_CONSENT_REQUEST → no-op (이미 인증됨)", async () => {
  let beginCalls = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
    overrideStubs: {
      T: { beginRedirectAuth: async () => { beginCalls++; } },
    },
  });
  machine.enable();
  await drain(5);
  // IDLE 도달 후 USER_CONSENT_REQUEST는 무시
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(beginCalls, 0, "IDLE에서는 redirect 안 함");
});

// ── Group 4: SYNC_DONE + redirect-attempts 카운터 ────────────────────────────

test("12. SYNC_DONE 시 redirect-attempts 카운터 0으로 리셋", async () => {
  const initial = { [REDIRECT_ATTEMPTS_KEY]: "2" };
  const { machine, localStorage, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: initial,
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  await drain(5);
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "0", "SYNC_DONE 후 리셋");
});

// ── Group 5: 401 → silent refresh 회복 ───────────────────────────────────────

test("13. SYNCING 중 401 + IDB 토큰 있음 → silent refresh → 새 token으로 회복", async () => {
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
  machine.enable();
  await drain(10);
  assert.equal(machine.getState(), "IDLE", "두 번째 사이클 후 IDLE 정착");
  assert.equal(downloadCalls, 2, "첫 401 + 두 번째 200, 무한 루프 없음");
});

test("14. 401 반복 + silent refresh 매번 성공해도 reAuthFails MAX_REAUTH로 ERROR", async () => {
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
  machine.enable();
  await drain(20);
  // MAX_REAUTH=3 → 4번째 401에서 ERROR
  assert.equal(machine.getState(), "ERROR");
  assert.ok(downloadCalls <= 5, `cap 작동 검증: download ${downloadCalls}회 (≤ MAX_REAUTH+2)`);
});

test("15. SYNCING 중 401 + IDB 비어있음 → NEEDS_CONSENT", async () => {
  // refresh token이 없으면 fallback PKCE redirect도 자동으로 안 함
  // (페이지 이탈은 사용자 액션이므로 NEEDS_CONSENT에 정착).
  // 401은 acceptRedirectCode에서 강제로 IDLE→SYNCING 진입한 후 시뮬레이션.
  const { machine, drain } = loadMachine({
    initialRefreshToken: null,
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
    exchangeResult: {
      ok: true, access_token: "at-x", refresh_token: "",
      expires_in: 3600, scope: "drive.appdata",
    },
  });
  // PKCE callback으로 token 주입 → IDLE → SYNCING (refresh token은 빈 문자열이라
  // IDB 저장 안 됨, refreshStore 비어있음 유지)
  await machine.acceptRedirectCode("c", "v");
  await drain(8);
  assert.equal(machine.getState(), "NEEDS_CONSENT", "IDB 비어있음 → NEEDS_CONSENT 폴백");
});

test("16. SYNCING 중 401 + silent refresh invalid → NEEDS_CONSENT", async () => {
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-expired",
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(stubs.refreshStore._calls.clear, 1, "IDB clear 호출됨");
});

test("17. 401 reauth 진행 중 disable() → DISABLED 유지 (Bugbot PR #54 race 가드)", async () => {
  // 시나리오: SYNCING에서 401 발생 → _kickoff401Reauth가 _attemptSilentRefresh
  // await 중 사용자가 disable() 호출 → silent 경로가 false 반환했을 때
  // NEEDS_CONSENT로 전이하면 안 됨 (사용자 의도 무시).
  let resolveLoad;
  const loadPromise = new Promise((r) => { resolveLoad = r; });
  const refreshStore = {
    saveRefreshToken: async () => {},
    loadRefreshToken: () => loadPromise,
    clearRefreshToken: async () => {},
    _peek: () => null,
    _calls: { save: 0, load: 0, clear: 0 },
  };
  const { machine, drain } = loadMachine({
    findFileId: "fid",
    downloadResult: { doc: null, etag: null, status: 401 },
    exchangeResult: {
      ok: true, access_token: "at", refresh_token: "",
      expires_in: 3600, scope: "drive.appdata",
    },
    overrideStubs: { refreshStore },
  });
  await machine.acceptRedirectCode("c", "v");
  await drain(3);
  // 첫 sync cycle이 401로 _kickoff401Reauth 진입 → loadRefreshToken에서 hold
  machine.disable();
  assert.equal(machine.getState(), "DISABLED", "disable() 즉시 DISABLED");
  resolveLoad(null);
  await drain(5);
  assert.equal(machine.getState(), "DISABLED", "race 가드: DISABLED 유지");
});

// ── Group 6: OFFLINE + NET_RECOVERED ─────────────────────────────────────────

test("18. OFFLINE → NET_RECOVERED + IDB 토큰 있음 → silent refresh → IDLE", async () => {
  // 5xx 한 번으로 OFFLINE 진입 (onlineFlag=false라 cap 우회)
  let downloadCalls = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    onlineFlag: false,
    findFileId: "fid",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => {
          downloadCalls++;
          // 첫 사이클: 5xx → OFFLINE / 두 번째 사이클 (NET_RECOVERED 후): 200
          return downloadCalls === 1
            ? { doc: null, etag: null, status: 500 }
            : { doc: null, etag: null, status: 200 };
        },
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "OFFLINE");
  machine.dispatch({ type: "NET_RECOVERED" });
  await drain(8);
  assert.equal(machine.getState(), "IDLE", "복귀 후 silent refresh 성공 → IDLE");
});

test("19. OFFLINE → NET_RECOVERED + IDB 비어있음 → NEEDS_CONSENT", async () => {
  // 토큰이 없는 OFFLINE 상태에서 net 복구되면 NEEDS_CONSENT로 정착
  const { machine, drain, ctx } = loadMachine({
    initialRefreshToken: null,
    onlineFlag: false,
  });
  // OFFLINE에 직접 진입시키기 위해 dispatch SYNC_FAIL이 가능하려면 SYNCING이어야 하므로,
  // 대신 _attemptSilentRefresh를 5xx로 OFFLINE 진입시키는 우회를 사용한 후 IDB를 비움.
  // 더 단순한 방법: refreshStore.loadRefreshToken을 매번 다른 값으로 stub.
  const refreshStore = {
    saveRefreshToken: async () => {},
    loadRefreshToken: async () => "rt-once", // 처음 enable() 때만 사용
    clearRefreshToken: async () => {},
    _peek: () => null,
    _calls: { save: 0, load: 0, clear: 0 },
  };
  const { machine: m2, drain: d2 } = loadMachine({
    onlineFlag: false,
    refreshResult: { ok: false, status: 503, error: "http_error" },
    overrideStubs: {
      refreshStore: {
        ...refreshStore,
        loadRefreshToken: async () => {
          // 첫 호출 시 토큰 반환 (OFFLINE 진입), 그 후엔 null (NET_RECOVERED 시 NEEDS_CONSENT)
          if (refreshStore._calls.load === 0) {
            refreshStore._calls.load++;
            return "rt-x";
          }
          refreshStore._calls.load++;
          return null;
        },
      },
    },
  });
  m2.enable();
  await d2(5);
  assert.equal(m2.getState(), "OFFLINE");
  m2.dispatch({ type: "NET_RECOVERED" });
  await d2(5);
  assert.equal(m2.getState(), "NEEDS_CONSENT", "토큰 없으면 NEEDS_CONSENT 폴백");
});

// ── Group 7: acceptRedirectCode (PKCE callback 진입점) ───────────────────────

test("20. acceptRedirectCode(code, verifier) 정상 → IDLE + IDB 저장", async () => {
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

test("21. acceptRedirectCode 빈 인자 → no-op", async () => {
  const { machine, stubs } = loadMachine();
  await machine.acceptRedirectCode("", "verifier");
  await machine.acceptRedirectCode("code", "");
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(stubs.refreshStore._calls.save, 0);
});

test("22. acceptRedirectCode 교환 실패 → NEEDS_CONSENT + 스낵바", async () => {
  let snackbarCalls = 0;
  const { machine, ctx } = loadMachine({
    exchangeResult: { ok: false, status: 400, error: "invalid_grant" },
  });
  ctx._showSyncSnackbar = () => { snackbarCalls++; };
  await machine.acceptRedirectCode("bad-code", "verifier");
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(snackbarCalls, 1, "사용자가 직접 시작한 흐름이라 실패는 알림");
});

test("23. acceptRedirectCode 진행 중 signOut() → DISABLED 유지 (Bugbot #54)", async () => {
  // Production에선 signOut()이 localStorage["bible-drive-sync"]를 "0"으로 설정한 뒤
  // _machine.disable()을 호출함. acceptRedirectCode는 state=DISABLED에서 시작하므로
  // 가드는 _state가 아니라 localStorage flag로 사용자 의도를 판별한다.
  let resolveExchange;
  const exchangePromise = new Promise((r) => { resolveExchange = r; });
  const { machine, drain, refreshStore, localStorage } = loadMachine({
    initialStorage: { [SYNC_ENABLED_KEY]: "1" },
    overrideStubs: {
      T: { exchangeCodeForToken: () => exchangePromise },
    },
  });
  void machine.acceptRedirectCode("code-x", "verifier-y");
  localStorage.setItem(SYNC_ENABLED_KEY, "0");
  resolveExchange({
    ok: true, access_token: "at", refresh_token: "rt",
    expires_in: 3600, scope: "drive.appdata",
  });
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "DISABLED 유지 — code 교환 결과 폐기");
  assert.equal(refreshStore._calls.save, 0, "IDB에 refresh token 저장 안 됨");
});

// ── Group 8: ERROR 상태 복구 ─────────────────────────────────────────────────

test("24. ERROR 상태에서 ENABLE → cap 리셋 + redirect 시도", () => {
  const beginCalls = [];
  const { machine } = loadMachine({
    initialStorage: { [REDIRECT_ATTEMPTS_KEY]: String(MAX_REDIRECT_ATTEMPTS) },
    overrideStubs: {
      T: { beginRedirectAuth: async (_c, _s, opts) => { beginCalls.push(opts); } },
    },
  });
  // 강제로 ERROR 진입: cap 초과 USER_CONSENT_REQUEST가 가장 빠른 경로
  machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  assert.equal(machine.getState(), "ERROR");
  // 사용자가 다시 "연결" 클릭 → ENABLE 재진입 → cap 리셋 후 redirect
  machine.dispatch({ type: "ENABLE" });
  assert.equal(beginCalls.length, 1);
  assert.equal(beginCalls[0]?.prompt, "consent");
});

// ── Group 9: race lost 가드 ──────────────────────────────────────────────────

test("25. silent refresh race lost (이미 IDLE) → 결과 폐기", async () => {
  // 시나리오: enable() → silent refresh fire (네트워크 hold) → 그 사이
  // acceptRedirectCode로 IDLE 도달 → silent refresh 결과 도착 시 폐기.
  let resolveRefresh;
  const refreshPromise = new Promise((r) => { resolveRefresh = r; });
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-pending",
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
    overrideStubs: {
      T: { refreshAccessToken: () => refreshPromise },
    },
  });
  machine.enable();
  // PKCE callback으로 IDLE 진입
  await machine.acceptRedirectCode("c", "v");
  await drain(2);
  resolveRefresh({ ok: false, status: 400, error: "invalid_grant" });
  await drain(5);
  const finalState = machine.getState();
  assert.ok(
    finalState === "IDLE" || finalState === "SYNCING",
    `race lost 시 IDLE/SYNCING 유지, got ${finalState}`,
  );
});

// ── Bugbot PR #57: IDB await 갭의 SYNC_ENABLED_KEY 재확인 ───────────────────
// race guard 통과 후 IDB rotation save / clear 동안 disable() 도착 시 후속
// _transition이 IDLE/NEEDS_CONSENT로 전이하면서 SYNC_ENABLED_KEY를 "1"로
// 덮어쓰는 회귀를 방어. 단계 4 후 enable()이 동기적으로 DISABLED를 빠져나가지
// 않으므로 state-based race guard만으로는 cold-start 경로 보호 불가.

test("26a. silent refresh 성공 + rotation IDB save 중 disable() → DISABLED 유지", async () => {
  let resolveSave;
  const savePromise = new Promise((r) => { resolveSave = r; });
  const refreshStore = {
    saveRefreshToken: () => savePromise, // hold
    loadRefreshToken: async () => "rt-stored",
    clearRefreshToken: async () => {},
    _peek: () => "rt-stored",
    _calls: { save: 0, load: 0, clear: 0 },
  };
  const { machine, drain, localStorage } = loadMachine({
    refreshResult: {
      ok: true, access_token: "at-new", refresh_token: "rt-rotated", expires_in: 3600,
    },
    overrideStubs: { refreshStore },
  });
  machine.enable();
  // refreshAccessToken은 즉시 resolve (200 OK + rotation 토큰) → saveRefreshToken에서 hold
  await drain(2);
  // 사용자가 disconnect 클릭 — disable()이 SYNC_ENABLED_KEY를 "0"으로 설정
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  // 이제 IDB save resolve → 가드가 SYNC_ENABLED_KEY="0"을 잡아야 함
  resolveSave();
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "IDB save 갭 race 가드: DISABLED 유지");
  assert.equal(localStorage.getItem(SYNC_ENABLED_KEY), "0", "사용자 의도 보존");
});

test("26b. silent refresh invalid_grant + IDB clear 중 disable() → DISABLED 유지", async () => {
  let resolveClear;
  const clearPromise = new Promise((r) => { resolveClear = r; });
  const refreshStore = {
    saveRefreshToken: async () => {},
    loadRefreshToken: async () => "rt-expired",
    clearRefreshToken: () => clearPromise, // hold
    _peek: () => "rt-expired",
    _calls: { save: 0, load: 0, clear: 0 },
  };
  const { machine, drain, localStorage } = loadMachine({
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
    overrideStubs: { refreshStore },
  });
  machine.enable();
  await drain(2);
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  resolveClear();
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "IDB clear 갭 race 가드: DISABLED 유지");
  assert.equal(localStorage.getItem(SYNC_ENABLED_KEY), "0");
});

test("26c. acceptRedirectCode 성공 후 IDB save 중 disable() → DISABLED 유지", async () => {
  let resolveSave;
  const savePromise = new Promise((r) => { resolveSave = r; });
  const refreshStore = {
    saveRefreshToken: () => savePromise, // hold
    loadRefreshToken: async () => null,
    clearRefreshToken: async () => {},
    _peek: () => null,
    _calls: { save: 0, load: 0, clear: 0 },
  };
  const { machine, drain, localStorage } = loadMachine({
    initialStorage: { [SYNC_ENABLED_KEY]: "1" },
    exchangeResult: {
      ok: true, access_token: "at", refresh_token: "rt-new",
      expires_in: 3600, scope: "drive.appdata",
    },
    overrideStubs: { refreshStore },
  });
  void machine.acceptRedirectCode("c", "v");
  // exchangeCodeForToken이 resolve된 다음 saveRefreshToken에서 hold
  await drain(2);
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  resolveSave();
  await drain(3);
  assert.equal(machine.getState(), "DISABLED", "code exchange + IDB save 갭 race 가드");
  assert.equal(localStorage.getItem(SYNC_ENABLED_KEY), "0");
});

test("26. 401 reauth 경로의 silent refresh는 SYNCING에서도 override (fromReauth=true)", async () => {
  // 시나리오: SYNCING에서 401 도달 → _kickoff401Reauth → silent refresh
  //   → SYNCING에서 SYNCING으로 다시 들어가는 흐름을 가드가 막으면 갇힘.
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
  machine.enable();
  await drain(10);
  assert.equal(machine.getState(), "IDLE", "fromReauth=true 덕분에 SYNCING 가드 우회, 회복 성공");
  assert.equal(downloadCalls, 2, "두 번째 사이클에서 200, 무한 루프 없음");
});

// ── Group 10: Sync 캐시 (fileId / etag / syncedMaxU 라운드트립 단축) ─────────
// _syncCycle은 매 사이클 직렬로 3 round trip(findSyncFileId + download +
// upload)을 발생시켰다. 캐시는 (a) 안정적인 fileId를 재사용해 files.list를
// 생략, (b) If-None-Match로 304를 받아 다운로드 본문 전송을 차단, (c)
// localMaxU == syncedMaxU 일 때 merge·upload 자체를 생략한다.

test("27. 첫 sync 후 fileId·etag·syncedMaxU가 localStorage에 캐시됨", async () => {
  const findFileCalls = [];
  const remoteDoc = {
    schemaVersion: 2,
    bookmarks: { items: {}, tombstones: {} },
    settings: {
      fontSize: { v: null, _u: 0 }, colorScheme: { v: null, _u: 0 },
      theme: { v: null, _u: 0 }, bookOrder: { v: null, _u: 0 },
      startupBehavior: { v: null, _u: 0 },
    },
    lastRead: { v: null, _u: 0 },
    deviceId: "remote",
  };
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        findSyncFileId: async () => { findFileCalls.push(1); return "fid-1"; },
        downloadSyncFile: async () => ({ doc: remoteDoc, etag: '"e1"', status: 200 }),
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE");
  assert.equal(findFileCalls.length, 1, "첫 사이클은 findSyncFileId 1회");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), "fid-1", "fileId 캐시됨");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), '"e1"', "etag 캐시됨");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), "0", "syncedMaxU 캐시됨");
});

test("28. 캐시 hit + 304 + 로컬 변화 없음 → upload·findSyncFileId 모두 생략", async () => {
  const findCalls = [];
  const downloadCalls = [];
  const uploadCalls = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        findSyncFileId: async () => { findCalls.push(1); return "fid-cached"; },
        downloadSyncFile: async (_t, _id, opts) => {
          downloadCalls.push(opts ?? {});
          return { doc: null, etag: null, status: 304 };
        },
        uploadSyncFile: async () => { uploadCalls.push(1); return { ok: true, status: 200, etag: '"new"' }; },
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE");
  assert.equal(findCalls.length, 0, "캐시 hit이라 files.list 생략");
  assert.equal(downloadCalls.length, 1, "조건부 GET 1회");
  assert.equal(downloadCalls[0].ifNoneMatch, '"e-cached"', "캐시 etag로 If-None-Match");
  assert.equal(uploadCalls.length, 0, "변화 없음 → upload 생략");
});

test("29. 캐시 hit + 304 + 로컬만 변경 → merge 건너뛰고 upload-only", async () => {
  // V2.maxU stub만 1로 바꿔 localMaxU > syncedMaxU 시나리오를 만든다.
  const uploadCalls = [];
  const mergeCalls = [];
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "10",
    },
    overrideStubs: {
      V2: {
        maxU: () => 20, // local 변경됨
        mergeDocs: (l) => { mergeCalls.push(1); return l; },
      },
      T: {
        downloadSyncFile: async () => ({ doc: null, etag: null, status: 304 }),
        uploadSyncFile: async (_t, _b, opts) => {
          uploadCalls.push(opts);
          return { ok: true, status: 200, etag: '"e-after-upload"' };
        },
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE");
  assert.equal(mergeCalls.length, 0, "remote 미변경이라 merge 호출 안 됨");
  assert.equal(uploadCalls.length, 1, "upload 1회");
  assert.equal(uploadCalls[0].fileId, "fid-cached", "캐시된 fileId 사용");
  assert.equal(uploadCalls[0].ifMatch, '"e-cached"', "캐시 etag로 If-Match");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), '"e-after-upload"', "새 etag 캐시 반영");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), "20", "syncedMaxU 갱신");
});

test("30. 캐시 hit + 다운로드 404 → 캐시 무효화 + SYNC_FAIL", async () => {
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-stale",
      [CACHE_ETAG_KEY]: '"e-stale"',
      [CACHE_SYNCED_U_KEY]: "5",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: async () => ({ doc: null, etag: null, status: 404 }),
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시 클리어");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시 클리어");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null, "syncedMaxU 캐시 클리어");
});

test("31. 캐시 hit + 304 + upload 412 → 캐시 무효화 (다음 사이클 재머지)", async () => {
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-c",
      [CACHE_ETAG_KEY]: '"e-c"',
      [CACHE_SYNCED_U_KEY]: "1",
    },
    overrideStubs: {
      V2: { maxU: () => 2 },
      T: {
        downloadSyncFile: async () => ({ doc: null, etag: null, status: 304 }),
        uploadSyncFile: async () => ({ ok: false, status: 412, etag: null }),
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "412에 캐시 클리어");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null);
});

test("32. disable() → 캐시 클리어 (다른 계정 로그인 보호)", () => {
  const { machine, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-c",
      [CACHE_ETAG_KEY]: '"e-c"',
      [CACHE_SYNCED_U_KEY]: "5",
    },
  });
  machine.disable();
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null);
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null);
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null);
});

test("33. 캐시 hit + 200 (원격 변경됨) → 일반 merge 경로 + 새 etag 캐시", async () => {
  const remoteDoc = {
    schemaVersion: 2,
    bookmarks: { items: {}, tombstones: {} },
    settings: {
      fontSize: { v: null, _u: 0 }, colorScheme: { v: null, _u: 0 },
      theme: { v: null, _u: 0 }, bookOrder: { v: null, _u: 0 },
      startupBehavior: { v: null, _u: 0 },
    },
    lastRead: { v: null, _u: 0 },
  };
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-c",
      [CACHE_ETAG_KEY]: '"e-old"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        // 200 returned because remote changed since cached etag
        downloadSyncFile: async () => ({ doc: remoteDoc, etag: '"e-new"', status: 200 }),
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), '"e-new"', "새 etag 캐시 반영");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), "fid-c", "fileId 유지");
});

test("34. 캐시 비어있을 때 downloadSyncFile에 ifNoneMatch 미전달", async () => {
  const downloadCalls = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: "fid-1",
    overrideStubs: {
      T: {
        downloadSyncFile: async (_t, _id, opts) => {
          downloadCalls.push(opts);
          return { doc: null, etag: '"e1"', status: 200 };
        },
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(downloadCalls.length, 1);
  assert.ok(
    !downloadCalls[0]?.ifNoneMatch,
    "캐시 미스 시 If-None-Match 헤더 안 보냄",
  );
});
