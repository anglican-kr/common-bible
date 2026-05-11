// @ts-check
// ── Drive Sync Facade ─────────────────────────────────────────────────────────
// Thin coordinator: creates the state machine, manages the upload debounce
// timer, absorbs PKCE redirect callbacks, exposes window.driveSync.
//
// Phase 2h 단계 4 이후 — GIS Token Client / Implicit Flow / FedCM 폴백은 모두
// 제거됐다. 인증은 데스크탑·Android·iOS 동일하게 PKCE Authorization Code +
// refresh token 단일 경로.
//
// Dependency load order (all defer, in order in index.html):
//   1. js/sync/debug-log.js     → window.syncDebugLog
//   2. js/sync/refresh-store.js → window.refreshStore
//   3. js/sync/transport.js     → window.syncTransport
//   4. js/sync/store-v2.js      → window.syncStoreV2
//   5. js/sync/state-machine.js → window.createSyncMachine
//   6. js/drive-sync.js (this file)

// Prod hostname is the only allowlisted production origin. Any other host
// (dev domain, forks, locally served bundles) routes to the dev Client ID,
// which Google's Cloud Console restricts to its registered dev origins —
// requests from unrecognized hosts fail at Google's origin check, not here.
const _IS_PROD_HOST = location.hostname === "bible.anglican.kr";
const _CLIENT_ID = _IS_PROD_HOST
  ? "359209354241-do8kgvtcbnfvrge01f5hj29fee9cg195.apps.googleusercontent.com"
  : "359209354241-esbmeba2ku58depo9fgg08v52crfthot.apps.googleusercontent.com";

// Make CLIENT_ID available to state-machine.js via window so we don't need an
// import system. The machine reads window._syncClientId on every redirect.
//
// client_secret is NOT in the SPA — Google's "Web application" OAuth client
// type requires it on /token requests (RFC 7636 deviation), so transport.js
// posts to a same-origin nginx proxy (/oauth/token) that injects the secret
// server-side before forwarding to oauth2.googleapis.com/token. See
// docs/decisions/011-bookmark-sync.md.
window._syncClientId = _CLIENT_ID;

// One-shot cleanup of Phase 2g's `bible-drive-silent-blocked` key (Phase 2h
// 단계 5). The key is dead — no code reads or writes it after step 4 — but
// existing user devices may still carry it. removeItem on a missing key is a
// no-op, so this is safe to run unconditionally on every load. Can be deleted
// after a few release cycles.
localStorage.removeItem("bible-drive-silent-blocked");

// ── PKCE redirect callback absorption ─────────────────────────────────────────
// Must run before app.js routes. Handles the `?code=…&state=…` query string
// that Google appends when redirecting back from accounts.google.com.
//
// The callback is single-use and arrives in the URL — we strip it via
// history.replaceState before any router or downstream logger sees it,
// then stash {code, verifier} on window for initDriveSync() to hand off to
// the state machine.
(function _consumeRedirectIfPresent() {
  const T = window.syncTransport;
  const log = window.syncDebugLog;
  if (!T?.consumeRedirectCallback) return;

  const result = T.consumeRedirectCallback();
  if (!result) return;

  // returnTo is set on success and on validated error responses (state nonce
  // matched). When the result is no_state / bad_state / state_mismatch we
  // can't trust the URL contents — drop the query entirely so the auth code
  // (or attacker-crafted noise) does not linger in URL bar / history / logs.
  if (result.ok || result.returnTo) {
    history.replaceState(null, "", result.ok ? result.returnTo : (result.returnTo ?? location.pathname));
  } else {
    history.replaceState(null, "", location.pathname);
  }

  if (result.ok) {
    window.__pendingRedirectCode = { code: result.code, verifier: result.verifier };
    window.__pendingRedirectHistoryDelta = result.historyDelta;
    localStorage.setItem("bible-drive-sync", "1");
    log?.log({ kind: "ACTION", event: "PKCE_CALLBACK_OK", historyDelta: result.historyDelta });
  } else {
    window.__pendingRedirectError = result.reason;
    log?.log({ kind: "ERROR", event: "PKCE_CALLBACK_FAIL", reason: result.reason });
  }
})();

const _machine = window.createSyncMachine({
  onStateChange: (state) => {
    window.syncDebugLog?.log({ kind: "TRANSITION", event: "STATE_CHANGE", state });
  },
});

// ── Network recovery ──────────────────────────────────────────────────────────
window.addEventListener("online", () => {
  window.syncDebugLog?.log({ kind: "ACTION", event: "NET_RECOVERED" });
  if (_machine.isEnabled()) _machine.dispatch({ type: "NET_RECOVERED" });
});

// ── Snackbar (UI notification, called by state machine) ────────────────────────
// Inverts page colors (bg=--text, fg=--bg) so contrast stays AA-grade across
// every theme/color-scheme combination.
window._showSyncSnackbar = function (msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;font-size:14px;line-height:1.4;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ── Upload debounce ────────────────────────────────────────────────────────────
/** @type {ReturnType<typeof setTimeout> | null} */
let _uploadTimer = null;

function _clearUploadTimer() {
  if (_uploadTimer !== null) clearTimeout(_uploadTimer);
  _uploadTimer = null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * @param {string} reason
 * @returns {string}
 */
function _redirectErrorMessage(reason) {
  switch (reason) {
    case "access_denied":
      return "Google 인증이 취소되었습니다. 다시 시도하려면 \"연결\"을 눌러 주세요.";
    case "state_expired":
      return "인증 시간이 초과됐습니다. 다시 \"연결\"을 눌러 주세요.";
    case "state_mismatch":
    case "no_state":
    case "bad_state":
      return "보안 검증에 실패했습니다. 다시 \"연결\"을 눌러 주세요.";
    default:
      return "Google 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

// Called by app.js after DOMContentLoaded idle.
function initDriveSync() {
  const enabled = localStorage.getItem("bible-drive-sync") === "1";
  window.syncDebugLog?.log({ kind: "ACTION", event: "INIT", enabled });

  // PKCE callback: code+verifier just landed. Hand off to the state machine
  // which exchanges them for access+refresh tokens and persists the refresh
  // token to IndexedDB. Async — the machine handles its own state transitions,
  // no further work needed here. Run BEFORE the early-return so a fresh signIn
  // (which sets bible-drive-sync=1 in the IIFE) lands cleanly even if the
  // user previously toggled sync off.
  if (window.__pendingRedirectCode) {
    const { code, verifier } = window.__pendingRedirectCode;
    const historyDelta = window.__pendingRedirectHistoryDelta ?? null;
    delete window.__pendingRedirectCode;
    delete window.__pendingRedirectHistoryDelta;
    void _machine.acceptRedirectCode(code, verifier, historyDelta);
    return;
  }

  if (!enabled) return;

  // PKCE redirect failed (denied, expired, etc). Surface the failure to
  // the user; machine will park in NEEDS_CONSENT via enable() → silent
  // refresh false → fallback transition.
  if (window.__pendingRedirectError) {
    const reason = window.__pendingRedirectError;
    delete window.__pendingRedirectError;
    window._showSyncSnackbar?.(_redirectErrorMessage(reason));
  }

  _machine.enable();
}

// Called by settings popover "연결" button.
function signIn() {
  const T = window.syncTransport;
  localStorage.setItem("bible-drive-sync", "1");
  // Reset attempt counter — this is an explicit user-initiated reconnect, so
  // any prior loop-cap should not block it. The cap exists to defend against
  // automatic re-redirect loops, not against user retries.
  // _syncRedirectAttemptsKey and _syncScope are set by state-machine.js at
  // load time (top-level assignment), so they're defined whenever signIn()
  // runs in response to a user click.
  localStorage.setItem(/** @type {string} */ (window._syncRedirectAttemptsKey), "0");
  window._showSyncSnackbar?.("Google 인증 페이지로 이동합니다. 인증 후 자동으로 돌아옵니다.");
  window.syncDebugLog?.log({ kind: "ACTION", event: "SIGN_IN_REDIRECT" });
  // Direct redirect (full-page navigation). Do NOT route through the machine:
  // when called from DISABLED with no refresh token, dispatching ENABLE would
  // race with the silent-refresh path that ends in NEEDS_CONSENT, leaving
  // a window where USER_CONSENT_REQUEST is dropped.
  void T.beginRedirectAuth(_CLIENT_ID, /** @type {string} */ (window._syncScope), { prompt: "consent" });
}

// Called by disconnect modal "파일 유지" path.
function signOut() {
  window.syncDebugLog?.log({ kind: "ACTION", event: "SIGN_OUT" });
  _clearUploadTimer();
  const token = _machine.getToken();
  if (token) window.syncTransport.revokeToken(token);
  // Clear refresh token from IDB so the next cold start lands in NEEDS_CONSENT
  // rather than silently re-authenticating as the user that just signed out.
  void window.refreshStore?.clearRefreshToken().catch(() => {});
  localStorage.removeItem("bible-drive-sync-email");
  localStorage.removeItem("bible-drive-sync-updated");
  localStorage.setItem("bible-drive-sync", "0");
  _machine.disable();
}

// Called by disconnect modal "삭제" path.
async function deleteRemoteFile() {
  window.syncDebugLog?.log({ kind: "ACTION", event: "DELETE_REMOTE_FILE" });
  await _machine.deleteRemoteFile();
}

// Called by all save* functions in app.js after any local data change.
function scheduleUpload() {
  const state = _machine.getState();
  window.syncDebugLog?.log({ kind: "ACTION", event: "LOCAL_CHANGE", syncState: state, willUpload: _machine.isAuthenticated() });
  if (!_machine.isAuthenticated()) return;
  _clearUploadTimer();
  _uploadTimer = setTimeout(() => {
    _uploadTimer = null;
    _machine.requestSync();
  }, 300);
}

function isEnabled()       { return _machine.isEnabled(); }
function isAuthenticated() { return _machine.isAuthenticated(); }
function getUserEmail()    { return _machine.getEmail(); }
function getStatus()       { return _machine.getState(); }

window.driveSync = {
  initDriveSync,
  signIn,
  signOut,
  deleteRemoteFile,
  scheduleUpload,
  requestSync: () => _machine.requestSync(),
  isEnabled,
  isAuthenticated,
  getUserEmail,
  getStatus,
};

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
