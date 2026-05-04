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
  OFFLINE:        "OFFLINE",
  ERROR:          "ERROR",
});

// GIS error reasons that mean "user declined" — no snackbar, no ERROR state.
const SILENT_FAIL_REASONS = new Set([
  "user_cancel", "access_denied", "popup_closed_by_user",
]);

// ── Factory ───────────────────────────────────────────────────────────────────

function createSyncMachine({ onStateChange } = {}) {
  // Storage keys
  const SYNC_ENABLED_KEY = "bible-drive-sync";
  const SYNC_EMAIL_KEY   = "bible-drive-sync-email";
  const T = window.syncTransport;
  const L = window.syncDebugLog;

  let _state = S.DISABLED;
  let _token = null;
  let _email = null;
  let _tokenClient = null;
  let _reAuthCount = 0;
  let _syncPending = false;
  let _netFailCount = 0;    // consecutive network/5xx failures
  let _conflictCount = 0;   // consecutive 412 conflicts
  let _backoffTimer = null; // pending retry setTimeout
  const MAX_NET_RETRIES = 5; // delays: 1s/2s/4s/8s/16s; OFFLINE after 6th failure

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

  // Exponential backoff: 1s/2s/4s/8s/16s with ±250ms jitter.
  function _scheduleRetry() {
    const delays = [1000, 2000, 4000, 8000, 16000];
    const base = delays[Math.min(_netFailCount - 1, delays.length - 1)];
    const delay = base + Math.random() * 500 - 250;
    clearTimeout(_backoffTimer);
    L.log({ kind: "ACTION", event: "RETRY_SCHEDULED", attempt: _netFailCount, delayMs: Math.round(delay) });
    _backoffTimer = setTimeout(() => {
      _backoffTimer = null;
      if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" });
    }, delay);
  }

  // ── v2 data operations (via syncStoreV2) ─────────────────────────────────────

  const V2 = window.syncStoreV2;
  const _deviceId = V2.getDeviceId();

  function _applyMergedDoc(merged, hadRemoteChanges) {
    V2.saveLocal(merged);
    V2.applyToLegacyKeys(merged);
    if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
    if (hadRemoteChanges) {
      const s = merged.settings ?? {};
      if (s.fontSize?.v        != null && typeof window.applyFontSize    === "function") window.applyFontSize(s.fontSize.v);
      if (s.colorScheme?.v     != null && typeof window.applyColorScheme === "function") window.applyColorScheme(s.colorScheme.v);
      if (s.theme?.v           != null && typeof window.applyTheme       === "function") window.applyTheme(s.theme.v);
      _snackbar("다른 기기에서 변경된 데이터를 불러왔습니다.");
    }
  }

  async function _syncCycle() {
    if (_syncPending) return;
    _syncPending = true;
    try {
      if (!_token) throw new Error("no_token");
      const fileId = await T.findSyncFileId(_token);
      L.log({ kind: "NETWORK", event: "FIND_FILE", fileId: L.mask("fileId", fileId) });

      const local = V2.loadLocal();
      const localMaxU = V2.maxU(local);

      if (!fileId) {
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status } = await T.uploadSyncFile(_token, payload);
        L.log({ kind: "NETWORK", event: "UPLOAD_NEW", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        if (!ok) { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` }); return; }
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      const { doc: remote, etag, status: dlStatus } = await T.downloadSyncFile(_token, fileId);
      L.log({ kind: "NETWORK", event: "DOWNLOAD", status: dlStatus, etag: L.mask("etag", etag) });
      if (dlStatus === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
      if (dlStatus >= 500) { dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` }); return; }
      if (!remote) { dispatch({ type: "SYNC_DONE" }); return; }

      // Remote v2: merge per-record. Remote v1 (legacy): treat as no remote data.
      if (!V2.validateRemote(remote)) {
        L.log({ kind: "ACTION", event: "REMOTE_SCHEMA_MISMATCH", schema: remote?.schemaVersion });
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status } = await T.uploadSyncFile(_token, payload, { fileId });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      const remoteMaxU = V2.maxU(remote);
      const merged = V2.mergeDocs(local, remote, _deviceId);
      const mergedMaxU = V2.maxU(merged);

      // Per-record comparison: did any merged record come from remote?
      const hadRemoteChanges = (
        Object.keys(merged.settings ?? {}).some(k =>
          (merged.settings[k]?._u ?? 0) > (local.settings?.[k]?._u ?? 0)
        ) ||
        (merged.lastRead?._u ?? 0) > (local.lastRead?._u ?? 0) ||
        Object.keys(merged.bookmarks?.items ?? {}).some(id =>
          (merged.bookmarks.items[id]?._u ?? 0) > (local.bookmarks?.items?.[id]?._u ?? 0)
        ) ||
        Object.keys(merged.bookmarks?.tombstones ?? {}).some(id =>
          (merged.bookmarks.tombstones[id] ?? 0) > (local.bookmarks?.tombstones?.[id] ?? 0)
        )
      );

      L.log({ kind: "ACTION", event: "MERGE", localMaxU, remoteMaxU, mergedMaxU, hadRemoteChanges });
      _applyMergedDoc(merged, hadRemoteChanges);

      // Upload if merged has newer data OR more records than remote
      // (local-only records with _u < remoteMaxU are caught by count check).
      const remoteRecordCount = Object.keys(remote.bookmarks?.items ?? {}).length
                              + Object.keys(remote.bookmarks?.tombstones ?? {}).length;
      const mergedRecordCount = Object.keys(merged.bookmarks?.items ?? {}).length
                              + Object.keys(merged.bookmarks?.tombstones ?? {}).length;
      if (mergedMaxU > remoteMaxU || mergedRecordCount > remoteRecordCount) {
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status } = await T.uploadSyncFile(_token, payload, { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        if (status === 412) { dispatch({ type: "SYNC_FAIL", reason: "412" }); return; }
        if (!ok) { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` }); return; }
      }

      dispatch({ type: "SYNC_DONE" });
    } catch (err) {
      L.log({ kind: "ERROR", event: "SYNC_EXCEPTION", reason: err.message });
      dispatch({ type: "SYNC_FAIL", reason: "network" });
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
          clearTimeout(_backoffTimer);
          _backoffTimer = null;
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.SYNCING:
        if (event.type === "SYNC_DONE") {
          _netFailCount = 0;
          _conflictCount = 0;
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
          } else if (event.reason === "412") {
            // ETag mismatch — another device uploaded concurrently. Retry sync.
            _conflictCount++;
            if (_conflictCount <= 3) {
              _setState(S.IDLE, event);
              setTimeout(() => { if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" }); }, 200);
            } else {
              _conflictCount = 0;
              _snackbar("동기화 충돌이 반복됩니다. 잠시 후 다시 시도해 주세요.");
              _setState(S.IDLE, event);
            }
          } else {
            // Network / 5xx — backoff retry, then OFFLINE after 5 failures.
            _netFailCount++;
            if (_netFailCount > MAX_NET_RETRIES || !navigator.onLine) {
              _setState(S.OFFLINE, event);
              if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
            } else {
              _setState(S.IDLE, event);
              _scheduleRetry();
            }
          }
        } else if (event.type === "DISABLE") {
          clearTimeout(_backoffTimer);
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.OFFLINE:
        if (event.type === "NET_RECOVERED") {
          _netFailCount = 0;
          _setState(S.AUTHENTICATING, event);
          T.requestSilentToken(_tokenClient, localStorage.getItem(SYNC_EMAIL_KEY));
        } else if (event.type === "DISABLE") {
          clearTimeout(_backoffTimer);
          _token = null;
          _setState(S.DISABLED, event);
          if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
        }
        break;

      case S.ERROR:
        if (event.type === "ENABLE") {
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
