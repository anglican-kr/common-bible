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
        findSyncFileId: async () => { findFileCalls.push(1); return { fileId: "fid-1", status: 200 }; },
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
        findSyncFileId: async () => { findCalls.push(1); return { fileId: "fid-cached", status: 200 }; },
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

// ── Group 11: PWA 스토리지 제약조건 (quota / SecurityError) 회복 ─────────────
// 캐시는 부수 최적화이므로 localStorage 작업 실패가 sync 자체를 망가뜨리면 안
// 된다. _saveCache의 throw가 _syncCycle catch까지 전파되면 사용자가 ERROR
// 상태로 떨어지는데, 이는 sync가 멀쩡한 상황에서 부적절하다.

test("35. _saveCache의 setItem이 quota error throw해도 sync는 IDLE 정착", async () => {
  // remote doc을 반환해 _syncCycle이 merge 후 _saveCache까지 도달하게 만든다.
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
  const { machine, drain, localStorage, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: "fid-1",
    overrideStubs: {
      T: {
        downloadSyncFile: async () => ({ doc: remoteDoc, etag: '"e1"', status: 200 }),
      },
    },
  });
  // 캐시 키 setItem만 throw — SYNC_ENABLED_KEY 등 다른 키는 그대로 동작해야
  // 상태 머신이 정상 진행한다.
  const origSet = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k.startsWith("bible-drive-cache-")) {
      throw new Error("QuotaExceededError");
    }
    return origSet(k, v);
  };
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE", "캐시 쓰기 실패해도 IDLE 정착");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "캐시 미저장");
  const cacheFail = logEntries.find((e) => e.event === "CACHE_SAVE_FAIL");
  assert.ok(cacheFail, "관찰 가능성을 위해 CACHE_SAVE_FAIL 로그 남김");
});

test("36. _loadCache의 getItem이 SecurityError throw → slow path graceful fallback", async () => {
  // 캐시는 분명히 채워져 있지만 getItem이 throw하는 환경(예: Safari ITP 차단)
  // → loadCache가 빈 캐시를 반환해야 하고 _syncCycle은 findSyncFileId로 폴백.
  const findCalls = [];
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        findSyncFileId: async () => { findCalls.push(1); return { fileId: null, status: 200 }; },
        uploadSyncFile: async () => ({ ok: true, status: 200, etag: '"e1"' }),
      },
    },
  });
  const origGet = localStorage.getItem;
  localStorage.getItem = (k) => {
    if (k.startsWith("bible-drive-cache-")) {
      throw new Error("SecurityError");
    }
    return origGet(k);
  };
  machine.enable();
  await drain(8);
  assert.equal(machine.getState(), "IDLE", "loadCache throw → slow path → IDLE");
  assert.equal(findCalls.length, 1, "캐시 무시하고 findSyncFileId 호출 (slow path)");
});

test("37. _clearCache의 removeItem throw해도 disable() 정상 진행", async () => {
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: null,
    uploadResult: { ok: true, status: 200, etag: '"e1"' },
  });
  machine.enable();
  await drain(5);
  assert.equal(machine.getState(), "IDLE", "사전 조건: IDLE");
  const origRemove = localStorage.removeItem;
  localStorage.removeItem = (k) => {
    if (k.startsWith("bible-drive-cache-")) {
      throw new Error("storage disabled");
    }
    return origRemove(k);
  };
  // _clearCache가 throw를 흘리면 dispatch가 실행되지 않고 state도 안 바뀜.
  machine.disable();
  assert.equal(machine.getState(), "DISABLED", "removeItem 실패해도 DISABLED 정착");
});

// ── Group 12: 세션 종료 시 캐시 무효화 (계정 전환 보호) ─────────────────────
// 토큰 자체가 폐기되는 NEEDS_CONSENT 진입점에서 캐시도 함께 비운다. Drive
// appDataFolder는 사용자별 격리되므로 데이터 누출은 없지만, 다른 계정으로
// 재로그인 시 stale fileId로 인한 404 round trip 1회를 절약.

test("38. silent refresh invalid_grant → 캐시도 함께 클리어", async () => {
  const { machine, drain, localStorage, stubs } = loadMachine({
    initialRefreshToken: "rt-expired",
    refreshResult: { ok: false, status: 400, error: "invalid_grant" },
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-prev-user",
      [CACHE_ETAG_KEY]: '"e-prev"',
      [CACHE_SYNCED_U_KEY]: "5",
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(stubs.refreshStore._calls.clear, 1, "refresh token IDB clear");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시 클리어");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시 클리어");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null, "syncedMaxU 캐시 클리어");
});

// ── Group 13: requestSync 폴 throttle ────────────────────────────────────────
// visibilitychange 트리거 폴이 1.1s 다운로드 round-trip을 4번 연속 쓰는 패턴이
// 디버그 로그에서 관찰됐다(+103/+105/+108/+110s). throttleMs 옵션으로 마지막
// 사이클 종료 후 N ms 이내 폴은 silent drop. 사용자 액션(scheduleUpload 후
// 업로드, pull-to-refresh)은 throttle 미지정 → 항상 진행.

test("40. requestSync({throttleMs}) — 첫 호출은 _lastSyncEndAt=0이라 throttle 미적용", async () => {
  const downloadCalls = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: async () => { downloadCalls.push(1); return { doc: null, etag: null, status: 304 }; },
      },
    },
  });
  machine.enable();
  await drain(8);
  // 1차 사이클 완료. 직후의 throttled 요청은 _lastSyncEndAt이 방금 채워졌으므로
  // throttle window 안 → drop.
  machine.requestSync({ throttleMs: 30_000 });
  await drain(2);
  assert.equal(downloadCalls.length, 1, "throttle window 안의 두 번째 폴은 drop");
});

test("41. requestSync({throttleMs}) — 마지막 사이클 종료 후 throttle window 안이면 drop", async () => {
  const downloadCalls = [];
  const log = [];
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: async () => { downloadCalls.push(1); return { doc: null, etag: null, status: 304 }; },
      },
    },
  });
  stubs.L.log = (e) => log.push(e);
  machine.enable();
  await drain(8);
  // 첫 사이클 끝 → 즉시 두 번째 폴 시도 (window 안)
  machine.requestSync({ throttleMs: 30_000 });
  machine.requestSync({ throttleMs: 30_000 });
  machine.requestSync({ throttleMs: 30_000 });
  await drain(2);
  assert.equal(downloadCalls.length, 1, "초기 사이클 1회만, 후속 폴 3건 모두 drop");
  const throttled = log.filter((e) => e.event === "SYNC_THROTTLED");
  assert.equal(throttled.length, 3, "drop된 폴 3건 모두 SYNC_THROTTLED 로그");
});

test("42. requestSync() (throttle 미지정) — 사용자 액션은 window 안에서도 항상 진행", async () => {
  const downloadCalls = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: async () => { downloadCalls.push(1); return { doc: null, etag: null, status: 304 }; },
      },
    },
  });
  machine.enable();
  await drain(8);
  // 첫 사이클 끝 직후 → pull-to-refresh 모사 (throttleMs 없음)
  machine.requestSync();
  await drain(8);
  assert.equal(downloadCalls.length, 2, "사용자 액션은 throttle 영향 없이 진행");
});

test("43. requestSync({throttleMs}) — SYNCING 중 폴은 throttle 분기 전에 IDLE 가드로 drop", async () => {
  // throttle 로직에 도달하기 전에 _state !== IDLE 가드에서 끊긴다.
  // SYNC_THROTTLED 로그가 찍히지 않는 것으로 분기 순서를 확인.
  const log = [];
  let resolveDownload;
  const dlPromise = new Promise((r) => { resolveDownload = r; });
  const { machine, drain, stubs } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: { downloadSyncFile: () => dlPromise },
    },
  });
  stubs.L.log = (e) => log.push(e);
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "다운로드 hold 중 SYNCING");
  machine.requestSync({ throttleMs: 30_000 });
  const throttled = log.filter((e) => e.event === "SYNC_THROTTLED");
  assert.equal(throttled.length, 0, "SYNCING 중 폴은 IDLE 가드에서 drop, throttle 진입 없음");
  resolveDownload({ doc: null, etag: null, status: 304 });
  await drain(5);
});

test("39. 401 + IDB 비어있음 → NEEDS_CONSENT + 캐시 클리어", async () => {
  // refresh token이 없는 상태에서 401 → _kickoff401Reauth는 silent refresh가
  // false를 반환받고 NEEDS_CONSENT 폴백 경로로 진입한다.
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: null,
    findFileId: "fid-prev",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-prev",
      [CACHE_ETAG_KEY]: '"e-prev"',
      [CACHE_SYNCED_U_KEY]: "5",
    },
    downloadResult: { doc: null, etag: null, status: 401 },
    exchangeResult: {
      ok: true, access_token: "at-x", refresh_token: "",
      expires_in: 3600, scope: "drive.appdata",
    },
  });
  // PKCE callback으로 token 주입 → IDLE → SYNCING → 401 → reauth 폴백
  await machine.acceptRedirectCode("c", "v");
  await drain(8);
  assert.equal(machine.getState(), "NEEDS_CONSENT");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "401 reauth no-token 폴백에서 캐시 클리어");
});

// ── Group 14: 사이클 도중 로그아웃 — 대기 뒤에는 Drive · 로컬을 건드리지 않는다 ──
// signOut()(→ disable → DISABLE)이 _syncCycle 의 네트워크 대기 중에 오면, 대기 뒤의 업로드가
// 로그아웃 뒤에 더한 편집까지 담아 `_token` 이 비워진 채(Bearer null)로 나갔다 — 실제 Drive 는 401
// 로 거절하지만 e2e 의 가짜 Drive 는 받아 test_sign_out_clears_sync 가 가끔 실패했다(known-issues §11).
// 대기마다 상태가 아직 SYNCING 인지 본다(_leftSyncing): 업로드 · 원격 자료 쓰기 · 캐시 다시 채우기 없음.
// 멈추는 자리 여섯(find_file · upload_new · download · upload_update · upload_upgrade · upload_merged)과
// catch(exception)를 하나씩 덮는다 — 대기 뒤 확인을 하나라도 빼면 그 자리의 테스트가 실패한다.

test("44. 파일 찾기 대기 중 disable() → 그 뒤 업로드하지 않는다", async () => {
  let resolveFind;
  const findPromise = new Promise((r) => { resolveFind = r; });
  const uploads = [];
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        findSyncFileId: () => findPromise,
        uploadSyncFile: async (token) => { uploads.push(token); return { ok: true, status: 200, etag: '"e1"' }; },
      },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "파일 찾기 hold 중 SYNCING");
  machine.disable();
  assert.equal(machine.getState(), "DISABLED");
  resolveFind({ fileId: null, status: 200 });   // Drive 에 파일이 아직 없다 — 옛 코드는 여기서 새 파일을 올렸다(token null)
  await drain(5);
  assert.deepEqual(uploads, [], "로그아웃 뒤 업로드 없음");
  assert.equal(machine.getState(), "DISABLED");
  assert.ok(logEntries.some((e) => e.event === "SYNC_ABORTED" && e.at === "find_file"), "SYNC_ABORTED(find_file) 로그");
});

test("45. 내려받기 대기 중 disable() → 원격 자료를 로컬에 쓰지 않고 캐시도 다시 채우지 않는다", async () => {
  let resolveDownload;
  const dlPromise = new Promise((r) => { resolveDownload = r; });
  const saved = [];
  const remoteDoc = { ...localDoc("remote"), schemaVersion: 2, deviceId: "remote" };
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: { downloadSyncFile: () => dlPromise },
      V2: { saveLocal: (doc) => { saved.push(doc); } },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "내려받기 hold 중 SYNCING");
  machine.disable();   // 캐시를 비운다(테스트 32)
  resolveDownload({ doc: remoteDoc, etag: '"e-remote"', status: 200 });
  await drain(5);
  assert.equal(saved.length, 0, "로그아웃 뒤 원격 자료를 로컬에 쓰지 않음");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시가 다시 차지 않음");
  assert.equal(machine.getState(), "DISABLED");
});

test("46. 올리기 대기 중 disable() → 업로드가 끝나도 캐시를 다시 채우지 않는다", async () => {
  // 업로드는 이미 나갔다(로그아웃 전에 만든 본문 · 그때의 토큰) — 막을 수 있는 것은 그 뒤의 캐시 쓰기다.
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let uploadCalls = 0;
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    downloadResult: { doc: null, etag: null, status: 304 },
    overrideStubs: {
      T: { uploadSyncFile: () => { uploadCalls++; return upPromise; } },
      V2: { maxU: () => 5 },   // 로컬이 마지막 동기화(0) 뒤에 바뀌었다 → 304 + 올리기만
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(uploadCalls, 1, "304 뒤 올리기 hold");
  assert.equal(machine.getState(), "SYNCING");
  machine.disable();
  resolveUpload({ ok: true, status: 200, etag: '"e-new"' });
  await drain(5);
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null, "syncedMaxU 캐시가 다시 차지 않음");
});

test("47. 새 파일 올리기 대기 중 disable() → 끝난 업로드로 SYNC_DONE 을 내지 않는다", async () => {
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let uploadCalls = 0;
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: null,   // Drive 에 파일이 없다 → 새 파일 올리기
    overrideStubs: {
      T: { uploadSyncFile: () => { uploadCalls++; return upPromise; } },
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(uploadCalls, 1, "새 파일 올리기 hold");
  assert.equal(machine.getState(), "SYNCING");
  machine.disable();
  const mark = logEntries.length;
  resolveUpload({ ok: true, status: 200, etag: '"e1"' });
  await drain(5);
  const after = logEntries.slice(mark);
  assert.ok(after.some((e) => e.event === "SYNC_ABORTED" && e.at === "upload_new"), "SYNC_ABORTED(upload_new) 로그");
  assert.ok(!after.some((e) => e.kind === "ACTION" && e.event === "SYNC_DONE"), "로그아웃 뒤 SYNC_DONE 없음");
  assert.equal(machine.getState(), "DISABLED");
});

test("48. v1 문서 올리기 대기 중 disable() → 업로드가 끝나도 캐시를 다시 채우지 않는다", async () => {
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let uploadCalls = 0;
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    downloadResult: { doc: { schemaVersion: 1, bookmarks: [] }, etag: '"e-v1"', status: 200 },
    overrideStubs: {
      T: { uploadSyncFile: () => { uploadCalls++; return upPromise; } },
      V2: { validateRemote: () => false },   // 원격이 옛 v1 문서 → v2 로 올린다
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(uploadCalls, 1, "v1 → v2 올리기 hold");
  assert.equal(machine.getState(), "SYNCING");
  machine.disable();
  resolveUpload({ ok: true, status: 200, etag: '"e-new"' });
  await drain(5);
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null, "syncedMaxU 캐시가 다시 차지 않음");
});

test("49. 합친 뒤 올리기 대기 중 disable() → 업로드가 끝나도 캐시를 다시 채우지 않는다", async () => {
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let uploadCalls = 0;
  const remoteDoc = { ...localDoc("remote"), schemaVersion: 2, deviceId: "remote" };
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    downloadResult: { doc: remoteDoc, etag: '"e-remote"', status: 200 },
    overrideStubs: {
      T: { uploadSyncFile: () => { uploadCalls++; return upPromise; } },
      // 로컬(합친 결과)이 원격보다 새롭다 → 합친 뒤 올린다
      V2: { maxU: (doc) => (doc && doc.deviceId === "remote" ? 0 : 5) },
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(uploadCalls, 1, "합친 뒤 올리기 hold");
  assert.equal(machine.getState(), "SYNCING");
  machine.disable();
  resolveUpload({ ok: true, status: 200, etag: '"e-new"' });
  await drain(5);
  assert.equal(machine.getState(), "DISABLED");
  assert.equal(localStorage.getItem(CACHE_FILE_ID_KEY), null, "fileId 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_ETAG_KEY), null, "etag 캐시가 다시 차지 않음");
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), null, "syncedMaxU 캐시가 다시 차지 않음");
});

test("50. 대기 중 disable() 뒤 그 대기가 예외로 끝나면 — 사유는 SYNC_EXCEPTION 으로 남기되 SYNC_FAIL 은 내지 않는다", async () => {
  // 지금의 transport.js 는 예외를 던지지 않고 status 0 을 돌려준다 — 그 계약이 바뀌어도 멈춘 사이클은 조용해야 한다.
  let rejectDownload;
  const dlPromise = new Promise((_, rej) => { rejectDownload = rej; });
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: { T: { downloadSyncFile: () => dlPromise } },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "내려받기 hold 중 SYNCING");
  machine.disable();
  const mark = logEntries.length;
  rejectDownload(new Error("network down"));
  await drain(5);
  const after = logEntries.slice(mark);
  assert.ok(after.some((e) => e.event === "SYNC_EXCEPTION" && e.reason === "network down"), "사유는 진단에 남는다");
  assert.ok(after.some((e) => e.event === "SYNC_ABORTED" && e.at === "exception"), "SYNC_ABORTED(exception) 로그");
  assert.ok(!after.some((e) => e.kind === "ACTION" && e.event === "SYNC_FAIL"), "멈춘 사이클은 SYNC_FAIL 을 내지 않는다");
  assert.equal(machine.getState(), "DISABLED");
});

// ── Group 15: 실패를 성공으로 치지 않는다 · 「파일도 삭제」 ─────────────────────
// 머지 전 /code-review(2026-10-17) 1 · 3 · 4번. 파일 찾기는 「없음」(2xx · fileId null)과 「실패」를 가르고,
// 실패한 찾기 · 내려받기 · v1 올리기는 SYNC_FAIL(백오프)로 간다 — 「파일 없음」 · 「원격 없음」 · 「동기화됨」으로
// 읽으면 sync.json 이 둘이 되거나 재시도 없이 끝났다. 「파일도 삭제」는 동기화를 먼저 멈추고, 진행 중 사이클이
// 이미 보낸 요청이 끝난 뒤에 찾아 지운다(그전엔 지운 뒤 도착한 새 파일 올리기가 파일을 되살렸다).

test("51. 파일 찾기가 실패(503)하면 새 파일을 올리지 않는다 — SYNC_FAIL 로 다시 시도", async () => {
  let uploadCalls = 0;
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    overrideStubs: {
      T: {
        findSyncFileId: async () => ({ fileId: null, status: 503 }),
        uploadSyncFile: async () => { uploadCalls++; return { ok: true, status: 200, etag: '"e1"' }; },
      },
    },
  });
  machine.enable();
  await drain(6);
  assert.equal(uploadCalls, 0, "실패한 찾기를 「파일 없음」으로 읽어 새 파일을 올리지 않음");
  assert.ok(logEntries.some((e) => e.kind === "ACTION" && e.event === "SYNC_FAIL"), "SYNC_FAIL");
  assert.ok(logEntries.some((e) => e.event === "RETRY_SCHEDULED"), "백오프 재시도 예약");
  assert.equal(machine.getState(), "IDLE", "백오프 대기");
});

test("52. 파일 찾기 401 → 새 파일을 올리지 않고 곧장 재인증", async () => {
  let uploadCalls = 0;
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    overrideStubs: {
      T: {
        findSyncFileId: async () => ({ fileId: null, status: 401 }),
        uploadSyncFile: async () => { uploadCalls++; return { ok: false, status: 401, etag: null }; },
      },
    },
  });
  machine.enable();
  await drain(8);
  assert.equal(uploadCalls, 0, "401 을 「파일 없음」으로 읽어 새 파일 올리기를 보내지 않음");
  assert.ok(logEntries.some((e) => e.event === "REAUTH"), "401 재인증 경로");
});

test("53. 내려받기 403 → SYNC_DONE 이 아니라 SYNC_FAIL — 백오프로 다시 시도, redirect 시도 횟수는 그대로", async () => {
  const { machine, drain, logEntries, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
      [REDIRECT_ATTEMPTS_KEY]: "2",
    },
    downloadResult: { doc: null, etag: null, status: 403 },
  });
  machine.enable();
  await drain(6);
  assert.ok(!logEntries.some((e) => e.kind === "ACTION" && e.event === "SYNC_DONE"), "SYNC_DONE 없음");
  assert.ok(logEntries.some((e) => e.kind === "ACTION" && e.event === "SYNC_FAIL"), "SYNC_FAIL");
  assert.ok(logEntries.some((e) => e.event === "RETRY_SCHEDULED"), "백오프 재시도 예약");
  assert.equal(localStorage.getItem(REDIRECT_ATTEMPTS_KEY), "2", "성공이 아니므로 redirect 시도 횟수를 0 으로 돌리지 않음");
});

test("54. v1 문서 올리기가 실패(503)하면 캐시를 「동기화됨」으로 쓰지 않고 SYNC_FAIL", async () => {
  const { machine, drain, logEntries, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    downloadResult: { doc: { schemaVersion: 1, bookmarks: [] }, etag: '"e-v1"', status: 200 },
    uploadResult: { ok: false, status: 503, etag: null },
    overrideStubs: {
      V2: { validateRemote: () => false, maxU: () => 7 },   // 원격이 옛 v1 · 로컬 maxU 7
    },
  });
  machine.enable();
  await drain(6);
  assert.equal(localStorage.getItem(CACHE_SYNCED_U_KEY), "0", "syncedMaxU 를 올리지 않음 — 다음 사이클이 다시 올린다");
  assert.ok(!logEntries.some((e) => e.kind === "ACTION" && e.event === "SYNC_DONE"), "SYNC_DONE 없음");
  assert.ok(logEntries.some((e) => e.kind === "ACTION" && e.event === "SYNC_FAIL"), "SYNC_FAIL");
});

test("55. deleteRemoteFile — 진행 중 사이클의 새 파일 올리기가 끝난 뒤에 찾아 지운다 · 토큰은 곧바로 내려놓고 지운 뒤 폐기한다", async () => {
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let created = false;
  const finds = [];
  const deletes = [];
  const revoked = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        findSyncFileId: async () => {
          finds.push(created);
          return created ? { fileId: "fid-new", fileIds: ["fid-new"], status: 200 } : { fileId: null, fileIds: [], status: 200 };
        },
        uploadSyncFile: () => upPromise.then((r) => { created = true; return r; }),
        deleteSyncFile: async (token, fileId) => { deletes.push({ token, fileId }); return { ok: true, status: 204 }; },
        revokeToken: (token) => { revoked.push(token); },
      },
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(machine.getState(), "SYNCING", "새 파일 올리기 hold");
  const token = machine.getToken();
  const done = machine.deleteRemoteFile();
  assert.equal(machine.getState(), "DISABLED", "지우기 전에 동기화를 멈춘다");
  assert.equal(machine.isAuthenticated(), false, "토큰을 곧바로 내려놓는다 — 설정은 「연결」");
  await drain(3);
  assert.deepEqual(finds, [false], "사이클의 찾기만 — 지우기의 찾기는 올리기가 끝나기를 기다린다");
  resolveUpload({ ok: true, status: 200, etag: '"e1"', fileId: "fid-new" });
  assert.equal(await done, true, "지웠다");
  assert.deepEqual(finds, [false, true], "지우기의 찾기는 만들어진 파일을 본다");
  assert.deepEqual(deletes, [{ token, fileId: "fid-new" }], "그 파일을 한 번만 지운다(목록 · 만든 id 가 겹친다)");
  assert.deepEqual(revoked, [token], "지운 뒤 그 토큰을 폐기한다");
});

test("56. deleteRemoteFile — 파일 찾기가 실패하면 false · 지우기를 보내지 않는다, 연결되어 있지 않으면 null(요청 없음)", async () => {
  let failFind = false;
  let finds = 0;
  const deletes = [];
  const { machine, drain, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        findSyncFileId: async () => {
          finds++;
          return failFind ? { fileId: null, fileIds: [], status: 503 } : { fileId: "fid-1", fileIds: ["fid-1"], status: 200 };
        },
        deleteSyncFile: async (_t, fileId) => { deletes.push(fileId); return { ok: true, status: 204 }; },
      },
    },
  });
  machine.enable();
  await drain(6);
  assert.equal(machine.getState(), "IDLE", "첫 사이클 끝");
  failFind = true;
  assert.equal(await machine.deleteRemoteFile(), false, "찾기 실패 — 지웠는지 알 수 없다");
  assert.deepEqual(deletes, [], "지우기를 보내지 않음");
  assert.ok(logEntries.some((e) => e.kind === "ERROR" && e.event === "DELETE_UNCONFIRMED" && e.reason === "lookup_http_503"),
    "진단의 오류 칸에 남는다");
  assert.equal(machine.getState(), "DISABLED");
  failFind = false;   // 찾기가 된다 해도 —
  const before = finds;
  assert.equal(await machine.deleteRemoteFile(), null, "토큰이 없으면 할 일이 없다(실패가 아니다)");
  assert.equal(finds, before, "토큰 없이 요청을 보내지 않는다(Bearer null)");
});

test("57. 「파일도 삭제」는 시작하자마자 설정을 다시 그린다 · 이어지는 signOut 의 disable() 도 다시 그린다(Copilot 1회차)", async () => {
  // 지우는 동안 토큰을 쥐고 있던 때는 그사이 연 설정이 「해제」(연결됨)를 그렸다. 이제 토큰을 곧바로 내려놓고
  // 다시 그리고, 이미 DISABLED 인 뒤의 disable() 도 다시 그린다(DISABLED 에는 DISABLE 처리기가 없다).
  let rebuilds = 0;
  const { machine, drain, ctx } = loadMachine({ initialRefreshToken: "rt-x", findFileId: "fid-1" });
  ctx.rebuildDriveSyncSection = () => { rebuilds++; };
  machine.enable();
  await drain(6);
  assert.equal(machine.getState(), "IDLE");
  const atStart = rebuilds;
  const done = machine.deleteRemoteFile();
  assert.equal(rebuilds, atStart + 1, "시작하자마자 다시 그린다");
  assert.equal(machine.isAuthenticated(), false, "그 화면은 「연결」");
  assert.equal(await done, true);
  const before = rebuilds;
  machine.disable();
  assert.equal(rebuilds, before + 1, "이미 DISABLED 여도 다시 그린다");
});

test("64. 「파일도 삭제」는 목록의 모든 sync.json 과 캐시된 파일을 지운다", async () => {
  const deletes = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-C",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    downloadResult: { doc: null, etag: null, status: 304 },
    overrideStubs: {
      T: {
        findSyncFileId: async () => ({ fileId: "fid-A", fileIds: ["fid-A", "fid-B"], status: 200 }),
        deleteSyncFile: async (_t, fileId) => { deletes.push(fileId); return { ok: true, status: 204 }; },
      },
    },
  });
  machine.enable();
  await drain(6);
  assert.equal(await machine.deleteRemoteFile(), true);
  assert.deepEqual([...deletes].sort(), ["fid-A", "fid-B", "fid-C"], "두 기기가 만든 둘과 캐시된 하나");
});

test("65. 「파일도 삭제」 — 지우기가 404 면 이미 없어진 것이라 true", async () => {
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    findFileId: "fid-1",
    overrideStubs: { T: { deleteSyncFile: async () => ({ ok: false, status: 404 }) } },
  });
  machine.enable();
  await drain(6);
  assert.equal(await machine.deleteRemoteFile(), true);
});

test("66. 「파일도 삭제」 — 401 이면 넘겨받은 refresh token 으로 한 번 갱신해 다시 시도한다", async () => {
  const findTokens = [];
  const refreshes = [];
  const revoked = [];
  let deleting = false;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        refreshAccessToken: async (rt) => {
          refreshes.push(rt);
          return { ok: true, access_token: deleting ? "fresh" : "boot", refresh_token: null, expires_in: 3600 };
        },
        findSyncFileId: async (token) => {
          if (deleting) findTokens.push(token);
          if (deleting && token !== "fresh") return { fileId: null, fileIds: [], status: 401 };   // 만료된 토큰
          return { fileId: "fid-1", fileIds: ["fid-1"], status: 200 };
        },
        revokeToken: (token) => { revoked.push(token); },
      },
    },
  });
  machine.enable();
  await drain(6);
  assert.equal(machine.getToken(), "boot");
  deleting = true;   // 그 뒤 한 시간쯤 사이클이 없어 액세스 토큰이 만료됐다
  assert.equal(await machine.deleteRemoteFile({ refreshToken: "rt-mem" }), true, "갱신한 토큰으로 지웠다");
  assert.deepEqual(findTokens, ["boot", "fresh"], "401 뒤 갱신한 토큰으로 다시 찾는다");
  assert.deepEqual(refreshes.slice(1), ["rt-mem"], "넘겨받은 refresh token 으로 한 번만");
  assert.deepEqual(revoked, ["boot", "fresh"], "만료된 토큰과 갱신한 토큰 모두 폐기");
});

/** 새 파일 올리기를 쥐고 있는 기계 — 「파일도 삭제」의 기다림 상한을 가짜 타이머로 본다. */
function heldCreateMachine() {
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  let created = false;
  const deletes = [];
  const loaded = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    overrideStubs: {
      T: {
        findSyncFileId: async () => (created
          ? { fileId: "fid-late", fileIds: ["fid-late"], status: 200 }
          : { fileId: null, fileIds: [], status: 200 }),
        uploadSyncFile: () => upPromise.then((r) => { created = true; return r; }),
        deleteSyncFile: async (_t, fileId) => { deletes.push(fileId); return { ok: true, status: 204 }; },
      },
    },
  });
  return { ...loaded, deletes, land: () => resolveUpload({ ok: true, status: 200, etag: '"e1"' }) };
}

test("67a. 「파일도 삭제」 — 진행 중 요청이 기다림 상한을 두 번 넘기면 false(안내가 남는다) · 로그아웃을 붙잡지 않는다", async () => {
  const { machine, drain, fireAllTimers, logEntries } = heldCreateMachine();
  machine.enable();
  await drain(4);
  assert.equal(machine.getState(), "SYNCING", "새 파일 올리기가 멈춰 있다");
  const done = machine.deleteRemoteFile();
  await drain(3);
  fireAllTimers();   // 첫 기다림(10초) 끝 — 찾아 보니 아직 없다
  await drain(3);
  fireAllTimers();   // 두 번째 기다림도 끝 — 그 요청이 뒤늦게 파일을 만들 수 있다
  assert.equal(await done, false, "지웠다고 말할 수 없다");
  assert.ok(logEntries.some((e) => e.event === "DELETE_UNCONFIRMED" && e.reason === "cycle_still_running"));
});

test("67b. 「파일도 삭제」 — 두 번째 기다림 안에 그 요청이 도착하면 다시 찾아 지운다", async () => {
  const { machine, drain, fireAllTimers, deletes, land } = heldCreateMachine();
  machine.enable();
  await drain(4);
  const done = machine.deleteRemoteFile();
  await drain(3);
  fireAllTimers();   // 첫 기다림 끝 — 아직 없다
  await drain(3);
  land();            // 늦게 도착한 새 파일 만들기
  assert.equal(await done, true, "다시 찾아 지웠다");
  assert.deepEqual(deletes, ["fid-late"]);
});

test("68. 「파일도 삭제」 — 지우는 사이 도착한 새 파일 만들기는, 목록이 아직 보여 주지 않아도 그 응답의 id 로 지운다", async () => {
  // 지우기가 캐시를 비운 뒤에 도착한 만들기라 캐시에는 없다 — 멈춘 사이클은 캐시를 쓰지 않는다.
  let resolveUpload;
  const upPromise = new Promise((r) => { resolveUpload = r; });
  const deletes = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    overrideStubs: {
      T: {
        findSyncFileId: async () => ({ fileId: null, fileIds: [], status: 200 }),   // 목록은 늘 비어 있다(늦다)
        uploadSyncFile: () => upPromise,
        deleteSyncFile: async (_t, fileId) => { deletes.push(fileId); return { ok: true, status: 204 }; },
      },
    },
  });
  machine.enable();
  await drain(4);
  assert.equal(machine.getState(), "SYNCING", "새 파일 만들기 hold");
  const done = machine.deleteRemoteFile();
  await drain(3);
  resolveUpload({ ok: true, status: 200, etag: '"e1"', fileId: "fid-created" });
  assert.equal(await done, true);
  assert.deepEqual(deletes, ["fid-created"], "목록에 없어도 만든 id 를 지운다");
});

// ── Group 16: 사이클 도중의 로컬 편집 — 덮지 않고, 버리지 않는다 ─────────────
// 머지 전 /code-review(2026-10-17, 사용자 실행) 1 · 7번. 사이클은 시작할 때 읽은 로컬 사본으로 병합한 뒤
// `_applyMergedDoc` 가 로컬 문서 전체를 덮어써, 파일 찾기 · 내려받기를 기다리는 동안 저장한 북마크 · 설정 ·
// 읽던 위치가 사라졌다. 304 갈래도 그 사본의 maxU 로 「변경 없음」을 판정했고, 도는 동안 들어온 사용자 요청
// (scheduleUpload → requestSync)은 버려져 다시 돌지 않았다. 이제 기다린 뒤에 로컬을 읽고, 사용자 요청은
// 사이클이 SYNC_DONE 으로 끝나면 한 번 더 돈다(폴은 쌓지 않는다).

/** 하네스 기본 문서 꼴에 꼬리표 · maxU 표지를 단 로컬 문서. */
function localDoc(tag, u = 0) {
  return {
    tag, u,
    bookmarks: { items: {}, tombstones: {} },
    settings: {
      fontSize: { v: null, _u: 0 }, colorScheme: { v: null, _u: 0 },
      theme: { v: null, _u: 0 }, bookOrder: { v: null, _u: 0 },
      startupBehavior: { v: null, _u: 0 },
    },
    lastRead: { v: null, _u: 0 },
  };
}

test("58. 내려받기 대기 중 저장한 편집이 병합에 들어간다 — 사이클 시작 때의 사본으로 덮지 않는다", async () => {
  let resolveDownload;
  const dlPromise = new Promise((r) => { resolveDownload = r; });
  let current = localDoc("before");
  const mergeInputs = [];
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: { downloadSyncFile: () => dlPromise },
      V2: {
        loadLocal: () => current,
        saveLocal: (doc) => { current = doc; },
        mergeDocs: (local) => { mergeInputs.push(local.tag); return local; },
      },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "내려받기 hold 중 SYNCING");
  current = localDoc("added-during-download");   // 그사이 북마크를 저장했다
  resolveDownload({ doc: { ...localDoc("remote"), schemaVersion: 2, deviceId: "remote" }, etag: '"e-remote"', status: 200 });
  await drain(5);
  assert.deepEqual(mergeInputs, ["added-during-download"], "병합은 기다린 뒤의 로컬로");
  assert.equal(current.tag, "added-during-download", "저장한 편집이 남는다");
});

test("59. 304 — 내려받기 대기 중 편집이 있으면 올린다", async () => {
  let resolveDownload;
  const dlPromise = new Promise((r) => { resolveDownload = r; });
  let current = localDoc("v0", 0);
  let uploads = 0;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: () => dlPromise,
        uploadSyncFile: async () => { uploads++; return { ok: true, status: 200, etag: '"e-new"' }; },
      },
      V2: { loadLocal: () => current, maxU: (doc) => doc.u ?? 0, buildSyncPayload: () => current },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING");
  current = localDoc("v1", 5);   // 내려받기를 기다리는 동안 편집
  resolveDownload({ doc: null, etag: null, status: 304 });
  await drain(5);
  assert.equal(uploads, 1, "304 여도 기다린 뒤의 로컬이 캐시보다 새로우면 올린다");
});

test("60. 사이클 도중의 사용자 요청(requestSync)은 버리지 않고 끝난 뒤 한 번 더 돈다", async () => {
  let downloads = 0;
  let resolveFirst;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: () => {
          downloads++;
          if (downloads === 1) return new Promise((r) => { resolveFirst = r; });
          return Promise.resolve({ doc: null, etag: null, status: 304 });
        },
      },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING");
  machine.requestSync();   // scheduleUpload 의 300ms 뒤 — 도는 중이라 예전엔 버려졌다
  resolveFirst({ doc: null, etag: null, status: 304 });
  await drain(8);
  assert.equal(downloads, 2, "한 번 더 돈다");
  assert.equal(machine.getState(), "IDLE");
});

test("61. 사이클 도중의 폴(requestSync({throttleMs}))은 쌓지 않는다 — 도는 사이클이 그 폴이다", async () => {
  let downloads = 0;
  let resolveFirst;
  const { machine, drain } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: () => {
          downloads++;
          if (downloads === 1) return new Promise((r) => { resolveFirst = r; });
          return Promise.resolve({ doc: null, etag: null, status: 304 });
        },
      },
    },
  });
  machine.enable();
  await drain(3);
  machine.requestSync({ throttleMs: 30_000 });
  resolveFirst({ doc: null, etag: null, status: 304 });
  await drain(8);
  assert.equal(downloads, 1, "폴은 다시 돌지 않는다");
});

// ── Group 17: 다시 시도가 끝난 뒤 — 연결된 기기에서 동기화가 멈추지 않는다 ────
// 머지 전 /code-review(사용자 실행) 3번. HTTP 실패(429 · 403 rate limit · 5xx)가 다섯 번 넘게 이어지면 OFFLINE
// 으로 갔는데, OFFLINE 은 `online` 이벤트로만 빠져나와 연결된 기기에서는 그 세션 내내 동기화가 멈췄다.
// 이제 HTTP 실패는 IDLE 로 돌아가 다음 요청이 다시 돌고, 네트워크 실패로 OFFLINE 이 된 뒤에도 기기가
// 온라인이면 다음 요청이 다시 시도한다(NET_RECOVERED).

/** 가짜 타이머로 백오프를 끝까지 돈다 — 첫 사이클 + 재시도 다섯 번. */
async function exhaustRetries(drain, fireAllTimers) {
  await drain(6);
  for (let i = 0; i < 6; i++) { fireAllTimers(); await drain(6); }
}

test("62. HTTP 실패(429)가 다섯 번 넘게 이어지면 OFFLINE 이 아니라 IDLE — 다음 요청이 다시 돈다", async () => {
  let downloads = 0;
  const { machine, drain, fireAllTimers, logEntries } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: { T: { downloadSyncFile: async () => { downloads++; return { doc: null, etag: null, status: 429 }; } } },
  });
  machine.enable();
  await exhaustRetries(drain, fireAllTimers);
  assert.equal(machine.getState(), "IDLE", "OFFLINE 에 갇히지 않는다");
  assert.ok(logEntries.some((e) => e.event === "RETRIES_EXHAUSTED"), "재시도를 다 썼다는 로그");
  const before = downloads;
  machine.requestSync();
  await drain(6);
  assert.equal(downloads, before + 1, "다음 요청이 다시 돈다");
});

test("63. 네트워크 실패(status 0)로 OFFLINE 이 된 뒤에도 온라인이면 다음 요청이 다시 시도한다", async () => {
  let downloads = 0;
  const { machine, drain, fireAllTimers } = loadMachine({
    initialRefreshToken: "rt-x",
    useRealTimers: false,
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: { T: { downloadSyncFile: async () => { downloads++; return { doc: null, etag: null, status: 0 }; } } },
  });
  machine.enable();
  await exhaustRetries(drain, fireAllTimers);
  assert.equal(machine.getState(), "OFFLINE", "네트워크 실패는 OFFLINE");
  const before = downloads;
  machine.requestSync();   // 기기는 온라인이라 `online` 이벤트가 오지 않는다
  await drain(8);
  assert.equal(downloads, before + 1, "NET_RECOVERED 로 다시 시도한다");
});

test("69. 사이클이 도는 사이 다시 SYNCING 이 되면 두 번째 사이클을 띄우지 않는다 — 돌던 사이클이 마무리한다", async () => {
  // 같은 페이지에서 disable() 뒤 다시 켜지는 길은 실제로는 없다(켬 표지 "0" 이 조용한 갱신을 물린다) — 표지를
  // 직접 "1" 로 돌려 그 경우를 만든다. _startCycle 의 가드가 없으면 사이클 둘이 겹쳐 돈다.
  let downloads = 0;
  let resolveFirst;
  const { machine, drain, localStorage } = loadMachine({
    initialRefreshToken: "rt-x",
    initialStorage: {
      [CACHE_FILE_ID_KEY]: "fid-cached",
      [CACHE_ETAG_KEY]: '"e-cached"',
      [CACHE_SYNCED_U_KEY]: "0",
    },
    overrideStubs: {
      T: {
        downloadSyncFile: () => {
          downloads++;
          if (downloads === 1) return new Promise((r) => { resolveFirst = r; });
          return Promise.resolve({ doc: null, etag: null, status: 304 });
        },
      },
    },
  });
  machine.enable();
  await drain(3);
  assert.equal(machine.getState(), "SYNCING", "첫 사이클이 내려받기에 멈춰 있다");
  machine.disable();
  localStorage.setItem(SYNC_ENABLED_KEY, "1");
  machine.enable();   // 조용한 갱신 → IDLE → SYNC_REQUEST → SYNCING
  await drain(6);
  assert.equal(machine.getState(), "SYNCING");
  assert.equal(downloads, 1, "두 번째 사이클을 띄우지 않았다");
  resolveFirst({ doc: null, etag: null, status: 304 });
  await drain(6);
  assert.equal(machine.getState(), "IDLE", "돌던 사이클이 다시 SYNCING 이 된 상태를 마무리했다");
});

