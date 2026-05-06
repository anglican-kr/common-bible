// ── Drive Sync Facade ─────────────────────────────────────────────────────────
// Thin coordinator: creates the state machine, manages the upload debounce
// timer, registers the GIS-ready poll, and exposes window.driveSync.
//
// Dependency load order (all defer, in order in index.html):
//   1. js/sync/debug-log.js   → window.syncDebugLog
//   2. js/sync/transport.js   → window.syncTransport
//   3. js/sync/state-machine.js → window.createSyncMachine
//   4. js/drive-sync.js (this file)

const _CLIENT_ID = location.hostname === "localhost"
  ? "359209354241-esbmeba2ku58depo9fgg08v52crfthot.apps.googleusercontent.com"
  : "359209354241-do8kgvtcbnfvrge01f5hj29fee9cg195.apps.googleusercontent.com";

// Make CLIENT_ID available to state-machine.js via window so we don't need an
// import system. The machine reads window._syncClientId on GIS_READY.
window._syncClientId = _CLIENT_ID;

// ── iOS redirect callback absorption ──────────────────────────────────────────
// Must run before app.js routes — strips OAuth hash, validates state nonce, and
// stashes the token for initDriveSync() to inject into the machine.
(function _consumeRedirectIfPresent() {
  const T = window.syncTransport;
  if (!T?.consumeRedirectCallback) return;
  const result = T.consumeRedirectCallback();
  if (!result) return;

  // Use returnTo from both success and validated-error responses so the user
  // lands back on the chapter they were reading even after a denied/expired
  // OAuth round-trip.
  if (result.returnTo) {
    history.replaceState(null, "", result.returnTo);
  } else {
    history.replaceState(null, "", location.pathname + location.search);
  }

  if (result.ok) {
    window.__pendingRedirectToken = { access_token: result.token };
    localStorage.setItem("bible-drive-sync", "1");
    // NOTE: do NOT reset bible-drive-redirect-attempts here. The counter only
    // clears on a successful sync (SYNC_DONE in the state machine), so an
    // OAuth-success-then-Drive-401 loop still hits MAX_REDIRECT_ATTEMPTS.
    window.syncDebugLog?.log({ kind: "ACTION", event: "REDIRECT_CALLBACK_OK" });
  } else {
    window.__pendingRedirectError = result.reason;
    window.syncDebugLog?.log({
      kind: "ERROR", event: "REDIRECT_CALLBACK_FAIL", reason: result.reason,
    });
  }
})();

// ── User interaction timestamp (for state-machine "active reading" check) ─────
let _lastInteractionTs = 0;
const _markInteraction = () => { _lastInteractionTs = Date.now(); };
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) =>
  window.addEventListener(ev, _markInteraction, { passive: true, capture: true })
);
window.__driveSyncInteractionTs = () => _lastInteractionTs;

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
// every theme/color-scheme combination. The previous --popover-bg fallback was
// a fixed dark grey that became unreadable on light themes where --text is
// also dark.
window._showSyncSnackbar = function (msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);background:var(--text);color:var(--bg);padding:12px 20px;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;font-size:14px;line-height:1.4;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center;";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ── GIS polling ────────────────────────────────────────────────────────────────
let _gisRetryCount = 0;

function _pollGis() {
  if (window.google?.accounts?.oauth2) {
    _machine.onGisReady();
  } else if (_gisRetryCount++ < 20) {
    setTimeout(_pollGis, 500);
  } else {
    window.syncDebugLog?.log({ kind: "ERROR", event: "GIS_LOAD_TIMEOUT", attempts: _gisRetryCount });
  }
}

function _startPollingGis() {
  _gisRetryCount = 0;
  _pollGis();
}

// ── Upload debounce ────────────────────────────────────────────────────────────
let _uploadTimer = null;

function _clearUploadTimer() {
  clearTimeout(_uploadTimer);
  _uploadTimer = null;
}

// ── Public API ─────────────────────────────────────────────────────────────────

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
  if (!enabled) return;

  // iOS redirect-flow: callback already validated; inject token directly.
  // GIS may never load (or fail to initialize), so the machine must reach
  // IDLE without waiting for it.
  if (window.__pendingRedirectToken) {
    const { access_token } = window.__pendingRedirectToken;
    delete window.__pendingRedirectToken;
    _machine.acceptRedirectToken(access_token);
    return;
  }

  // iOS redirect-flow failed (denied, expired, etc). Surface the failure to
  // the user instead of silently falling through to the GIS path, which
  // never resolves on iOS.
  if (window.__pendingRedirectError) {
    const reason = window.__pendingRedirectError;
    delete window.__pendingRedirectError;
    if (window.syncTransport.isIOS()) {
      window._showSyncSnackbar?.(_redirectErrorMessage(reason));
    } else {
      window.syncDebugLog?.log({ kind: "ERROR", event: "UNEXPECTED_REDIRECT_ERROR", reason });
    }
    // Fall through to enable() — on iOS the machine parks in NEEDS_CONSENT
    // (see DISABLED + ENABLE handler) so settings shows a "연결" button.
  }

  _machine.enable();
  if (!window.syncTransport.isIOS()) _startPollingGis();
}

// Called by settings popover "연결" button.
function signIn() {
  const T = window.syncTransport;
  localStorage.setItem("bible-drive-sync", "1");

  if (T.isIOS()) {
    // Bypass GIS entirely — Safari does not support FedCM and PWA standalone
    // mode blocks popups even from user gestures. Reset the attempt counter
    // since this is an explicit user-initiated reconnect.
    localStorage.setItem("bible-drive-redirect-attempts", "0");
    window._showSyncSnackbar?.("Google 인증 페이지로 이동합니다. 인증 후 자동으로 돌아옵니다.");
    window.syncDebugLog?.log({ kind: "ACTION", event: "SIGN_IN_IOS_REDIRECT" });
    T.beginRedirectAuth(_CLIENT_ID, window._syncScope, { prompt: "consent" });
    return;
  }

  const state = _machine.getState();
  window.syncDebugLog?.log({ kind: "ACTION", event: "SIGN_IN", state });
  if (state === "DISABLED") {
    _machine.enable();
  } else if (state === "NEEDS_CONSENT" || state === "ERROR" || state === "IDENTIFYING") {
    // Silent identity already failed (or is parked). Take the user-gesture
    // route: dispatch USER_CONSENT_REQUEST so the machine calls
    // requestAccessToken({prompt:"consent"}) inside this click handler.
    _machine.dispatch({ type: "USER_CONSENT_REQUEST" });
  }
  if (_machine.getState() === "INITIALIZING") _startPollingGis();
}

// Called by disconnect modal "파일 유지" path.
function signOut() {
  window.syncDebugLog?.log({ kind: "ACTION", event: "SIGN_OUT" });
  _clearUploadTimer();
  const token = _machine.getToken();
  if (token) window.syncTransport.revokeToken(token);
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
  isEnabled,
  isAuthenticated,
  getUserEmail,
  getStatus,
};
