// ── Sync State Machine ────────────────────────────────────────────────────────
// Single dispatch() entry point. All GIS callbacks and fetch responses route
// through dispatch() — never mutate state directly.
//
// States
//   DISABLED      — sync off; token null, no ops running
//   INITIALIZING  — waiting for GIS library to finish loading
//   AUTHENTICATING — token request in flight (silent re-auth or consent)
//   IDLE          — authenticated, no sync in progress
//   SYNCING       — download/upload in progress
//   ERROR         — persistent failure; user must reconnect manually
//
// Events
//   ENABLE / DISABLE
//   GIS_READY
//   TOKEN_OK  { token, email }
//   TOKEN_FAIL { reason }   — reason from GIS error string
//   SYNC_REQUEST
//   SYNC_DONE
//   SYNC_FAIL { reason }   — "401" | "network" | other
//
// PR 1 scope: v1 data logic (document-level last-write-wins, document-level
// updatedAt). Per-record merge (v2) is added in PR 2.

const S = Object.freeze({
  DISABLED:       "DISABLED",
  INITIALIZING:   "INITIALIZING",
  AUTHENTICATING: "AUTHENTICATING",
  IDLE:           "IDLE",
  SYNCING:        "SYNCING",
  ERROR:          "ERROR",
});

// GIS error reasons that mean "user declined" — no snackbar, no ERROR state.
const SILENT_FAIL_REASONS = new Set([
  "user_cancel", "access_denied", "popup_closed_by_user",
]);

// ── Factory ───────────────────────────────────────────────────────────────────

function createSyncMachine({ onStateChange } = {}) {
  // Storage keys — kept inside closure to avoid colliding with app.js globals.
  const SYNC_ENABLED_KEY  = "bible-drive-sync";
  const SYNC_UPDATED_KEY  = "bible-drive-sync-updated";
  const SYNC_EMAIL_KEY    = "bible-drive-sync-email";
  const BM_KEY            = "bible-bookmarks";
  const FS_KEY            = "bible-font-size";
  const CS_KEY            = "bible-color-scheme";
  const TH_KEY            = "bible-theme";
  const BO_KEY            = "bible-book-order";
  const SU_KEY            = "bible-startup";
  const LR_KEY            = "bible-last-read";
  const T = window.syncTransport;
  const L = window.syncDebugLog;

  let _state = S.DISABLED;
  let _token = null;
  let _email = null;
  let _tokenClient = null;
  let _reAuthCount = 0;   // consecutive re-auth attempts since last TOKEN_OK
  let _syncPending = false; // true when a sync cycle is in flight

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _setState(next, event) {
    if (next === _state) return;
    L.log({ kind: "TRANSITION", event: event?.type, from: _state, to: next });
    _state = next;
    localStorage.setItem(SYNC_ENABLED_KEY, next === S.DISABLED || next === S.ERROR ? "0" : "1");
    if (onStateChange) onStateChange(next);
  }

  function _snackbar(msg) {
    if (typeof window._showSyncSnackbar === "function") window._showSyncSnackbar(msg);
  }

  // ── v1 data operations ────────────────────────────────────────────────────

  function _buildPayload() {
    const get = (k) => {
      const v = localStorage.getItem(k);
      try { return JSON.parse(v); } catch { return v; }
    };
    const rawBm = get(BM_KEY);
    const bookmarks = Array.isArray(rawBm)
      ? rawBm
      : (rawBm?._version === 1 && Array.isArray(rawBm.items) ? rawBm.items : []);
    return {
      version: 1,
      updatedAt: Date.now(),
      bookmarks,
      settings: {
        fontSize:        get(FS_KEY),
        colorScheme:     get(CS_KEY),
        theme:           get(TH_KEY),
        bookOrder:       get(BO_KEY),
        startupBehavior: get(SU_KEY),
      },
      lastRead: get(LR_KEY),
    };
  }

  function _validateRemote(data) {
    return (
      typeof data === "object" && data !== null &&
      data.version === 1 &&
      Array.isArray(data.bookmarks)
    );
  }

  function _applyRemote(data) {
    if (!_validateRemote(data)) return;
    localStorage.setItem(BM_KEY, JSON.stringify(data.bookmarks));
    if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
    const s = data.settings ?? {};
    if (s.fontSize        != null) { localStorage.setItem(FS_KEY, s.fontSize);        if (typeof window.applyFontSize    === "function") window.applyFontSize(s.fontSize); }
    if (s.colorScheme     != null) { localStorage.setItem(CS_KEY, s.colorScheme);     if (typeof window.applyColorScheme === "function") window.applyColorScheme(s.colorScheme); }
    if (s.theme           != null) { localStorage.setItem(TH_KEY, s.theme);           if (typeof window.applyTheme       === "function") window.applyTheme(s.theme); }
    if (s.bookOrder       != null)   localStorage.setItem(BO_KEY, s.bookOrder);
    if (s.startupBehavior != null)   localStorage.setItem(SU_KEY, s.startupBehavior);
    if (data.lastRead     != null)   localStorage.setItem(LR_KEY, JSON.stringify(data.lastRead));
  }

  async function _syncCycle() {
    if (_syncPending) return;
    _syncPending = true;
    try {
      if (!_token) throw new Error("no_token");
      const fileId = await T.findSyncFileId(_token);
      L.log({ kind: "NETWORK", event: "FIND_FILE", fileId: L.mask("fileId", fileId) });

      if (!fileId) {
        // No remote file — upload current local state.
        const payload = _buildPayload();
        const { ok, status } = await T.uploadSyncFile(_token, payload);
        L.log({ kind: "NETWORK", event: "UPLOAD_NEW", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        if (ok) localStorage.setItem(SYNC_UPDATED_KEY, String(payload.updatedAt));
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      const { doc: remote, etag, status: dlStatus } = await T.downloadSyncFile(_token, fileId);
      L.log({ kind: "NETWORK", event: "DOWNLOAD", status: dlStatus, etag: L.mask("etag", etag) });
      if (dlStatus === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
      if (!remote) { dispatch({ type: "SYNC_DONE" }); return; }

      const localUpdatedAt = Number(localStorage.getItem(SYNC_UPDATED_KEY) ?? 0) || 0;
      const remoteUpdatedAt = Number(remote.updatedAt) || 0;

      if (remoteUpdatedAt > localUpdatedAt) {
        if (!_validateRemote(remote)) { dispatch({ type: "SYNC_DONE" }); return; }
        _applyRemote(remote);
        localStorage.setItem(SYNC_UPDATED_KEY, String(remoteUpdatedAt));
        _snackbar("다른 기기에서 변경된 데이터를 불러왔습니다.");
        L.log({ kind: "ACTION", event: "APPLIED_REMOTE", remoteUpdatedAt, localUpdatedAt });
      } else if (remoteUpdatedAt < localUpdatedAt) {
        const payload = _buildPayload();
        const { ok, status } = await T.uploadSyncFile(_token, payload, { fileId });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        if (ok) localStorage.setItem(SYNC_UPDATED_KEY, String(payload.updatedAt));
      }
      dispatch({ type: "SYNC_DONE" });
    } catch (err) {
      L.log({ kind: "ERROR", event: "SYNC_EXCEPTION", reason: err.message });
      dispatch({ type: "SYNC_FAIL", reason: err.message });
    } finally {
      _syncPending = false;
    }
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  function dispatch(event) {
    L.log({ kind: "ACTION", event: event.type, state: _state });

    switch (_state) {

      case S.DISABLED:
        if (event.type === "ENABLE") {
          if (window.google?.accounts?.oauth2 && _tokenClient) {
            _setState(S.AUTHENTICATING, event);
            T.requestSilentToken(_tokenClient, localStorage.getItem(SYNC_EMAIL_KEY));
          } else {
            _setState(S.INITIALIZING, event);
          }
        }
        break;

      case S.INITIALIZING:
        if (event.type === "GIS_READY") {
          _tokenClient = T.initTokenClient(
            window._syncClientId,
            "https://www.googleapis.com/auth/drive.appdata email",
            (resp) => dispatch({ type: resp.error ? "TOKEN_FAIL" : "TOKEN_OK", ...resp, reason: resp.error })
          );
          _setState(S.AUTHENTICATING, event);
          T.requestSilentToken(_tokenClient, localStorage.getItem(SYNC_EMAIL_KEY));
        } else if (event.type === "DISABLE") {
          _setState(S.DISABLED, event);
        }
        break;

      case S.AUTHENTICATING:
        if (event.type === "TOKEN_OK") {
          _reAuthCount = 0;
          _token = event.access_token;
          L.log({ kind: "ACTION", event: "TOKEN_STORED", token: L.mask("token", _token) });
          _setState(S.IDLE, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
          // Fetch email asynchronously — GIS token callback doesn't include it.
          T.fetchUserInfo(_token).then(({ email }) => {
            _email = email;
            localStorage.setItem(SYNC_EMAIL_KEY, email ?? "");
            L.log({ kind: "ACTION", event: "EMAIL_FETCHED", email: L.mask("email", email) });
            if (email && typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
          }).catch((err) => {
            L.log({ kind: "ERROR", event: "EMAIL_FETCH_FAILED", reason: err.message });
          });
          // Trigger initial sync immediately after authentication.
          dispatch({ type: "SYNC_REQUEST" });
        } else if (event.type === "TOKEN_FAIL") {
          L.log({ kind: "ERROR", event: "TOKEN_FAIL", reason: event.reason });
          if (SILENT_FAIL_REASONS.has(event.reason)) {
            _setState(S.DISABLED, event);
          } else {
            _snackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
            _setState(S.ERROR, event);
          }
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        } else if (event.type === "DISABLE") {
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.IDLE:
        if (event.type === "SYNC_REQUEST") {
          _setState(S.SYNCING, event);
          _syncCycle();
        } else if (event.type === "DISABLE") {
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.SYNCING:
        if (event.type === "SYNC_DONE") {
          _setState(S.IDLE, event);
        } else if (event.type === "SYNC_FAIL") {
          if (event.reason === "401" && _reAuthCount < 3) {
            _reAuthCount++;
            L.log({ kind: "ACTION", event: "REAUTH", attempt: _reAuthCount });
            _token = null;
            _setState(S.AUTHENTICATING, event);
            T.requestSilentToken(_tokenClient, localStorage.getItem(SYNC_EMAIL_KEY));
          } else if (event.reason === "401") {
            _token = null;
            _snackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
            _setState(S.ERROR, event);
            if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
          } else {
            // Network / other error — return to IDLE silently (PR 3 adds backoff).
            _setState(S.IDLE, event);
          }
        } else if (event.type === "DISABLE") {
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.ERROR:
        if (event.type === "ENABLE") {
          // User manually retries connection.
          _reAuthCount = 0;
          _setState(S.AUTHENTICATING, event);
          T.requestConsentToken(_tokenClient);
        } else if (event.type === "DISABLE") {
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;
    }
  }

  // ── Public API (consumed by drive-sync.js facade) ─────────────────────────

  function enable() {
    dispatch({ type: "ENABLE" });
  }

  function disable() {
    dispatch({ type: "DISABLE" });
  }

  function onGisReady() {
    if (_state === S.INITIALIZING) dispatch({ type: "GIS_READY" });
  }

  function requestSync() {
    if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" });
  }

  function getState()  { return _state; }
  function getToken()  { return _token; }
  function getEmail()  { return _email ?? localStorage.getItem(SYNC_EMAIL_KEY); }
  function isEnabled() { return _state !== S.DISABLED && _state !== S.ERROR; }
  function isAuthenticated() { return !!_token; }

  async function deleteRemoteFile() {
    if (!_token) return;
    const fileId = await T.findSyncFileId(_token);
    L.log({ kind: "NETWORK", event: "DELETE_FIND_FILE", fileId: L.mask("fileId", fileId) });
    if (fileId) {
      const { ok } = await T.deleteSyncFile(_token, fileId);
      L.log({ kind: "NETWORK", event: "DELETE_FILE", ok });
    }
  }

  return { enable, disable, onGisReady, requestSync, getState, getToken, getEmail, isEnabled, isAuthenticated, deleteRemoteFile, dispatch };
}

window.createSyncMachine = createSyncMachine;
