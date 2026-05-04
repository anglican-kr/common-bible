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

const _machine = window.createSyncMachine({
  onStateChange: (state) => {
    window.syncDebugLog?.log({ kind: "TRANSITION", event: "STATE_CHANGE", state });
  },
});

// ── Snackbar (UI notification, called by state machine) ────────────────────────
window._showSyncSnackbar = function (msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--popover-bg,#323232);color:var(--text,#fff);border:1px solid var(--border,transparent);padding:12px 20px;border-radius:8px;font-size:14px;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);";
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

// Called by app.js after DOMContentLoaded idle.
function initDriveSync() {
  if (localStorage.getItem("bible-drive-sync") === "1") {
    _machine.enable();
    _startPollingGis();
  }
}

// Called by settings popover "연결" button.
function signIn() {
  localStorage.setItem("bible-drive-sync", "1");
  if (_machine.getState() === "DISABLED" || _machine.getState() === "ERROR") {
    _machine.enable();
  }
  if (_machine.getState() === "INITIALIZING") _startPollingGis();
}

// Called by disconnect modal "파일 유지" path.
function signOut() {
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
