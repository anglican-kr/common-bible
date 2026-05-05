// ── Sync State Machine (statechart) ───────────────────────────────────────────
// Explicit context object eliminates "hidden state" bugs:
//   _ctx = { netFails, conflictFails, reAuthFails, backoffTimer }
//
// All state changes go through _transition(nextState, ctxPatch).
// By default every transition resets all counts and clears the backoff timer.
// To carry a value forward, pass it explicitly in ctxPatch:
//   _transition(S.IDLE, { netFails: _ctx.netFails + 1, backoffTimer: timer })
//
// This inverts the bug pattern: "forget to reset" is impossible — you have to
// actively opt in to preserving a value across a transition.
//
// States:  DISABLED | INITIALIZING | IDENTIFYING | AUTHENTICATING | IDLE |
//          SYNCING | OFFLINE | NEEDS_CONSENT | ERROR
// Events:  ENABLE | DISABLE | GIS_READY | IDENTITY_OK | IDENTITY_FAIL |
//          USER_CONSENT_REQUEST | TOKEN_OK | TOKEN_FAIL | SYNC_REQUEST |
//          SYNC_DONE | SYNC_FAIL { reason } | NET_RECOVERED
//
// SYNC_FAIL reasons:
//   "401"       — token expired  → re-identify (silent FedCM/One Tap)
//   "412"       — ETag mismatch  → re-merge retry (max 3)
//   "no_token"  — guard tripped  → ERROR (deterministic)
//   "exception" — JS error       → ERROR (deterministic)
//   other       — network/5xx    → backoff (max 5), then OFFLINE
//
// Authentication flow:
//   • Non-iOS (Android/desktop): GIS popup-based flow (Phase 2d/2e).
//       1. IDENTIFYING  — google.accounts.id.prompt() (FedCM / One Tap) for
//                         silent identity establishment. No window.open().
//       2. AUTHENTICATING — google.accounts.oauth2.requestAccessToken silently
//                           exchanges identity for a Drive access token.
//       3. NEEDS_CONSENT — silent failure path; "연결" click triggers
//                          requestAccessToken({prompt:"consent"}) inside the
//                          user gesture.
//   • iOS Safari (Phase 2f): full-page redirect flow via OAuth implicit.
//       Safari does not support FedCM and PWA standalone mode blocks popups
//       even from user gestures. transport.beginRedirectAuth() navigates to
//       accounts.google.com and Google redirects back with the token in the
//       URL hash; drive-sync.js consumes the callback before routing and
//       calls _machine.acceptRedirectToken() to land directly in IDLE.

const S = Object.freeze({
  DISABLED:       "DISABLED",
  INITIALIZING:   "INITIALIZING",
  IDENTIFYING:    "IDENTIFYING",
  AUTHENTICATING: "AUTHENTICATING",
  IDLE:           "IDLE",
  SYNCING:        "SYNCING",
  OFFLINE:        "OFFLINE",
  NEEDS_CONSENT:  "NEEDS_CONSENT",
  ERROR:          "ERROR",
});

const SILENT_FAIL_REASONS = new Set([
  "user_cancel", "access_denied", "popup_closed_by_user",
]);

const MAX_REAUTH    = 3;
const MAX_CONFLICTS = 3;
const MAX_NET_RETRIES = 5; // 5 retries → delays 1s/2s/4s/8s/16s; OFFLINE on 6th failure
const MAX_REDIRECT_ATTEMPTS = 3;
const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata email";
const ACTIVE_READING_IDLE_MS = 5000;

// ── Factory ───────────────────────────────────────────────────────────────────

function createSyncMachine({ onStateChange } = {}) {
  const SYNC_ENABLED_KEY = "bible-drive-sync";
  const SYNC_EMAIL_KEY   = "bible-drive-sync-email";
  const T  = window.syncTransport;
  const L  = window.syncDebugLog;
  const V2 = window.syncStoreV2;
  const _deviceId = V2.getDeviceId();

  let _state = S.DISABLED;
  let _token = null;
  let _email = null;
  let _tokenClient = null;
  let _syncPending = false;

  // ── Context (all "hidden state" in one place) ─────────────────────────────
  // Mutated only by _transition().

  let _ctx = _emptyCtx();

  function _emptyCtx() {
    return { netFails: 0, conflictFails: 0, reAuthFails: 0, backoffTimer: null };
  }

  // ── _transition: the ONLY place that changes state + context ─────────────
  // 1. Clear pending backoff timer (always safe).
  // 2. Reset all counts to zero.
  // 3. Apply ctxPatch to selectively carry values forward.
  // 4. Persist enabled flag; fire onStateChange.

  function _transition(next, ctxPatch = {}, event) {
    clearTimeout(_ctx.backoffTimer);
    _ctx = { ..._emptyCtx(), ...ctxPatch };

    if (next === _state) return;
    L.log({ kind: "TRANSITION", event: event?.type ?? "—", from: _state, to: next });
    _state = next;
    const enabled = next !== S.DISABLED && next !== S.ERROR;
    localStorage.setItem(SYNC_ENABLED_KEY, enabled ? "1" : "0");
    if (onStateChange) onStateChange(next);
  }

  // ── Identity helpers ──────────────────────────────────────────────────────
  // Always call promptIdentity *outside* of requestAccessToken to keep popup
  // calls confined to user-gesture handlers (NEEDS_CONSENT path).

  // No callback: success arrives via the credential callback registered in
  // initIdentityClient. Dismissal/suppression is silent under modern FedCM —
  // the user retries via the always-visible "연결" button in settings, which
  // dispatches USER_CONSENT_REQUEST and falls through to the OAuth flow.
  function _promptIdentity() {
    T.promptIdentity();
  }

  // ── Side-effect helpers ───────────────────────────────────────────────────

  function _refreshUI() {
    if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
  }

  function _snackbar(msg) {
    if (typeof window._showSyncSnackbar === "function") window._showSyncSnackbar(msg);
  }

  function _emailHint() { return localStorage.getItem(SYNC_EMAIL_KEY); }

  // Backoff timer that fires a SYNC_REQUEST if still IDLE.
  // Stored in ctxPatch so _transition will clear it on next transition.
  function _makeBackoffTimer(failCount) {
    const delays = [1000, 2000, 4000, 8000, 16000];
    const base   = delays[Math.min(failCount - 1, delays.length - 1)];
    const delay  = base + Math.random() * 500 - 250;
    L.log({ kind: "ACTION", event: "RETRY_SCHEDULED", attempt: failCount, delayMs: Math.round(delay) });
    return setTimeout(() => {
      if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" });
    }, delay);
  }

  // Short timer for 412 re-sync (waits for _syncPending to clear).
  function _makeConflictTimer() {
    return setTimeout(() => {
      if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" });
    }, 200);
  }

  function _reqSilentToken() {
    T.requestSilentToken(_tokenClient, _emailHint());
  }

  // ── iOS redirect helpers ──────────────────────────────────────────────────

  function _isUserActivelyReading() {
    if (document.visibilityState !== "visible") return false;
    if (!document.hasFocus()) return false;
    const ts = window.__driveSyncInteractionTs?.() ?? 0;
    return Date.now() - ts <= ACTIVE_READING_IDLE_MS;
  }

  function _redirectAttempts() {
    return parseInt(localStorage.getItem(REDIRECT_ATTEMPTS_KEY) ?? "0", 10) || 0;
  }

  // Trigger full-page redirect to OAuth endpoint. Returns true if the redirect
  // was initiated (caller should `return` immediately — the page is leaving),
  // false if blocked by the attempt cap.
  function _beginRedirect(prompt) {
    const attempts = _redirectAttempts();
    if (attempts >= MAX_REDIRECT_ATTEMPTS) {
      L.log({ kind: "ERROR", event: "REDIRECT_CAP_EXCEEDED", attempts });
      _snackbar("재연결을 여러 번 시도했지만 실패했습니다. 잠시 후 다시 시도해 주세요.");
      _transition(S.ERROR, {}, { type: "REDIRECT_CAP" });
      _refreshUI();
      return false;
    }
    localStorage.setItem(REDIRECT_ATTEMPTS_KEY, String(attempts + 1));
    L.log({ kind: "ACTION", event: "REDIRECT_AUTH_BEGIN", attempt: attempts + 1, prompt: prompt ?? "" });
    T.beginRedirectAuth(window._syncClientId, SCOPE, { prompt });
    return true;
  }

  function _storeToken(token) {
    _token = token;
    L.log({ kind: "ACTION", event: "TOKEN_STORED", token: L.mask("token", token) });
    T.fetchUserInfo(token).then(({ email }) => {
      _email = email;
      localStorage.setItem(SYNC_EMAIL_KEY, email ?? "");
      L.log({ kind: "ACTION", event: "EMAIL_FETCHED", email: L.mask("email", email) });
      if (email) _refreshUI();
    }).catch((err) => {
      L.log({ kind: "ERROR", event: "EMAIL_FETCH_FAILED", reason: err.message });
    });
  }

  // ── v2 data operations ────────────────────────────────────────────────────

  function _applyMergedDoc(merged, hadRemoteChanges) {
    V2.saveLocal(merged);
    V2.applyToLegacyKeys(merged);
    if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
    if (hadRemoteChanges) {
      const s = merged.settings ?? {};
      if (s.fontSize?.v    != null && typeof window.applyFontSize    === "function") window.applyFontSize(s.fontSize.v);
      if (s.colorScheme?.v != null && typeof window.applyColorScheme === "function") window.applyColorScheme(s.colorScheme.v);
      if (s.theme?.v       != null && typeof window.applyTheme       === "function") window.applyTheme(s.theme.v);
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

      const local      = V2.loadLocal();
      const localMaxU  = V2.maxU(local);

      // ── No remote file yet: upload local state ──
      if (!fileId) {
        const { ok, status } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId));
        L.log({ kind: "NETWORK", event: "UPLOAD_NEW", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (!ok)                        { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` });   return; }
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      // ── Download remote ──
      const { doc: remote, etag, status: dlStatus } = await T.downloadSyncFile(_token, fileId);
      L.log({ kind: "NETWORK", event: "DOWNLOAD", status: dlStatus, etag: L.mask("etag", etag) });
      if (dlStatus === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
      if (dlStatus === 0 || dlStatus >= 500) { dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` }); return; }
      if (!remote)                      { dispatch({ type: "SYNC_DONE" });                             return; }

      // ── Remote is legacy v1: upgrade Drive to v2 ──
      if (!V2.validateRemote(remote)) {
        L.log({ kind: "ACTION", event: "REMOTE_SCHEMA_MISMATCH", schema: remote?.schemaVersion });
        const { ok, status } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId), { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (status === 412)             { dispatch({ type: "SYNC_FAIL", reason: "412" });              return; }
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      // ── Merge and conditionally upload ──
      const remoteMaxU = V2.maxU(remote);
      const merged     = V2.mergeDocs(local, remote, _deviceId);
      const mergedMaxU = V2.maxU(merged);

      const hadRemoteChanges = (
        Object.keys(merged.settings ?? {}).some(k =>
          (merged.settings[k]?._u ?? 0) > (local.settings?.[k]?._u ?? 0)) ||
        (merged.lastRead?._u ?? 0) > (local.lastRead?._u ?? 0) ||
        Object.keys(merged.bookmarks?.items ?? {}).some(id =>
          (merged.bookmarks.items[id]?._u ?? 0) > (local.bookmarks?.items?.[id]?._u ?? 0)) ||
        Object.keys(merged.bookmarks?.tombstones ?? {}).some(id =>
          (merged.bookmarks.tombstones[id] ?? 0) > (local.bookmarks?.tombstones?.[id] ?? 0))
      );

      L.log({ kind: "ACTION", event: "MERGE", localMaxU, remoteMaxU, mergedMaxU, hadRemoteChanges });
      _applyMergedDoc(merged, hadRemoteChanges);

      const remoteCount = Object.keys(remote.bookmarks?.items ?? {}).length
                        + Object.keys(remote.bookmarks?.tombstones ?? {}).length;
      const mergedCount = Object.keys(merged.bookmarks?.items ?? {}).length
                        + Object.keys(merged.bookmarks?.tombstones ?? {}).length;

      if (mergedMaxU > remoteMaxU || mergedCount > remoteCount) {
        const { ok, status } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId), { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (status === 412)             { dispatch({ type: "SYNC_FAIL", reason: "412" });              return; }
        if (!ok)                        { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` });   return; }
      }

      dispatch({ type: "SYNC_DONE" });
    } catch (err) {
      L.log({ kind: "ERROR", event: "SYNC_EXCEPTION", reason: err.message });
      dispatch({ type: "SYNC_FAIL", reason: err.message === "no_token" ? "no_token" : "exception" });
    } finally {
      _syncPending = false;
    }
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  function dispatch(event) {
    L.log({ kind: "ACTION", event: event.type, state: _state, ctx: { ..._ctx, backoffTimer: !!_ctx.backoffTimer } });

    switch (_state) {

      case S.DISABLED:
        if (event.type === "ENABLE") {
          if (window.google?.accounts?.id && window.google?.accounts?.oauth2 && _tokenClient) {
            _transition(S.IDENTIFYING, {}, event);
            _promptIdentity();
          } else {
            _transition(S.INITIALIZING, {}, event);
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
          if (window.google?.accounts?.id) {
            T.initIdentityClient(
              window._syncClientId,
              (resp) => {
                if (resp?.credential) {
                  const { email } = T.parseIdToken(resp.credential);
                  dispatch({ type: "IDENTITY_OK", email, credential: resp.credential });
                } else {
                  dispatch({ type: "IDENTITY_FAIL", reason: "no_credential" });
                }
              }
            );
            _transition(S.IDENTIFYING, {}, event);
            _promptIdentity();
          } else {
            _transition(S.AUTHENTICATING, {}, event);
            _reqSilentToken();
          }
        } else if (event.type === "DISABLE") {
          _transition(S.DISABLED, {}, event);
        }
        break;

      case S.IDENTIFYING:
        if (event.type === "IDENTITY_OK") {
          if (event.email) {
            localStorage.setItem(SYNC_EMAIL_KEY, event.email);
            _email = event.email;
          }
          L.log({ kind: "ACTION", event: "IDENTITY_OK", email: L.mask("email", event.email) });
          _transition(S.AUTHENTICATING, { reAuthFails: _ctx.reAuthFails }, event);
          _reqSilentToken();
        } else if (event.type === "IDENTITY_FAIL") {
          L.log({ kind: "ACTION", event: "IDENTITY_FAIL", reason: event.reason });
          // Silent identity unavailable (e.g. iOS 16↓ first run, ITP blocked
          // session). Park in NEEDS_CONSENT and wait for a real user gesture
          // — never auto-call requestAccessToken from here, that would trigger
          // the iOS popup-blocker dialog.
          _transition(S.NEEDS_CONSENT, {}, event);
          _refreshUI();
        } else if (event.type === "USER_CONSENT_REQUEST") {
          T.cancelIdentityPrompt();
          if (T.isIOS()) {
            if (_beginRedirect("consent")) return;
          } else {
            // User gesture anchors the popup.
            _transition(S.AUTHENTICATING, {}, event);
            T.requestConsentToken(_tokenClient);
          }
        } else if (event.type === "DISABLE") {
          T.cancelIdentityPrompt();
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;

      case S.NEEDS_CONSENT:
        if (event.type === "USER_CONSENT_REQUEST") {
          if (T.isIOS()) {
            if (_beginRedirect("consent")) return;
          } else {
            _transition(S.AUTHENTICATING, {}, event);
            T.requestConsentToken(_tokenClient);
          }
        } else if (event.type === "DISABLE") {
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;

      case S.AUTHENTICATING:
        if (event.type === "TOKEN_OK") {
          _storeToken(event.access_token);
          _transition(S.IDLE, {}, event);
          _refreshUI();
          dispatch({ type: "SYNC_REQUEST" });
        } else if (event.type === "TOKEN_FAIL") {
          L.log({ kind: "ERROR", event: "TOKEN_FAIL", reason: event.reason });
          if (SILENT_FAIL_REASONS.has(event.reason)) {
            _transition(S.DISABLED, {}, event);
          } else {
            _snackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
            _transition(S.ERROR, {}, event);
          }
          _refreshUI();
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;

      case S.IDLE:
        if (event.type === "SYNC_REQUEST") {
          // Carry failure counts forward — they must accumulate across retry cycles.
          // backoffTimer is NOT carried (cleared by _transition default).
          _transition(S.SYNCING, {
            netFails:     _ctx.netFails,
            conflictFails: _ctx.conflictFails,
            reAuthFails:  _ctx.reAuthFails,
          }, event);
          _syncCycle();
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event); // timer cleared here
          _refreshUI();
        }
        break;

      case S.SYNCING:
        if (event.type === "SYNC_DONE") {
          // A successful sync means the redirect→token→Drive cycle completed
          // end-to-end; only here is it safe to clear the redirect-attempts
          // counter. Resetting on token receipt alone (in acceptRedirectToken
          // or the IIFE) would defeat the loop cap when a 401 fires
          // immediately after every fresh token.
          localStorage.setItem(REDIRECT_ATTEMPTS_KEY, "0");
          _transition(S.IDLE, {}, event); // all counts reset, timer cleared
        } else if (event.type === "SYNC_FAIL") {
          _handleSyncFail(event);
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event); // timer cleared
          _refreshUI();
        }
        break;

      case S.OFFLINE:
        if (event.type === "NET_RECOVERED") {
          // Re-establish identity silently before requesting a token.
          if (window.google?.accounts?.id) {
            _transition(S.IDENTIFYING, {}, event);
            _promptIdentity();
          } else {
            _transition(S.AUTHENTICATING, {}, event);
            _reqSilentToken();
          }
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;

      case S.ERROR:
        if (event.type === "ENABLE" || event.type === "USER_CONSENT_REQUEST") {
          if (T.isIOS()) {
            // ERROR-driven retry — clear stale attempt counter so user-initiated
            // reconnect gets a fresh window of MAX_REDIRECT_ATTEMPTS chances.
            localStorage.setItem(REDIRECT_ATTEMPTS_KEY, "0");
            if (_beginRedirect("consent")) return;
          } else {
            _transition(S.AUTHENTICATING, {}, event);
            T.requestConsentToken(_tokenClient);
          }
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;
    }
  }

  // ── SYNC_FAIL handler (extracted for readability) ─────────────────────────
  // All branches use _transition() with explicit ctxPatch — no implicit resets.

  function _handleSyncFail(event) {
    const { reason } = event;

    if (reason === "401") {
      _token = null;
      if (_ctx.reAuthFails < MAX_REAUTH) {
        L.log({ kind: "ACTION", event: "REAUTH", attempt: _ctx.reAuthFails + 1 });
        if (T.isIOS()) {
          // Hybrid policy: defer the disruptive full-page redirect when the
          // user is actively reading; otherwise reauthorize transparently.
          if (_isUserActivelyReading()) {
            L.log({ kind: "ACTION", event: "REAUTH_DEFERRED", reason: "active_reading" });
            _snackbar("Google 동기화 재연결이 필요합니다. 설정 → 연결을 눌러 주세요.");
            _transition(S.NEEDS_CONSENT, {}, event);
            _refreshUI();
          } else {
            // No prompt parameter — Google will silently re-issue the token
            // when the existing session still has the granted scope.
            _beginRedirect(undefined);
            return;
          }
        } else if (window.google?.accounts?.id) {
          // Re-identify silently first (FedCM/One Tap, no popup) so the
          // follow-up requestAccessToken({prompt:""}) has a fresh email hint.
          _transition(S.IDENTIFYING, { reAuthFails: _ctx.reAuthFails + 1 }, event);
          _promptIdentity();
        } else {
          _transition(S.AUTHENTICATING, { reAuthFails: _ctx.reAuthFails + 1 }, event);
          _reqSilentToken();
        }
      } else {
        _snackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
        _transition(S.ERROR, {}, event);
        _refreshUI();
      }

    } else if (reason === "412") {
      if (_ctx.conflictFails < MAX_CONFLICTS) {
        const timer = _makeConflictTimer();
        _transition(S.IDLE, { conflictFails: _ctx.conflictFails + 1, backoffTimer: timer }, event);
      } else {
        _snackbar("동기화 충돌이 반복됩니다. 잠시 후 다시 시도해 주세요.");
        _transition(S.IDLE, {}, event); // conflictFails reset
      }

    } else if (reason === "no_token" || reason === "exception") {
      _token = null;
      _snackbar("동기화 중 오류가 발생했습니다. 설정에서 재연결해 주세요.");
      _transition(S.ERROR, {}, event);
      _refreshUI();

    } else {
      // Network / 5xx — exponential backoff, then OFFLINE.
      const n = _ctx.netFails + 1;
      if (n > MAX_NET_RETRIES || !navigator.onLine) {
        _transition(S.OFFLINE, {}, event);
        _refreshUI();
      } else {
        const timer = _makeBackoffTimer(n);
        _transition(S.IDLE, { netFails: n, backoffTimer: timer }, event);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function enable()      { dispatch({ type: "ENABLE" }); }
  function disable()     { dispatch({ type: "DISABLE" }); }
  function onGisReady()  { if (_state === S.INITIALIZING) dispatch({ type: "GIS_READY" }); }
  function requestSync() { if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" }); }

  // iOS redirect-flow entry: callback handler in drive-sync.js calls this
  // after consumeRedirectCallback validates the token. Bypasses GIS entirely.
  // Does NOT reset the redirect-attempts counter — only a successful sync
  // (SYNC_DONE) clears it, so a server-side scope revocation that issues a
  // token but immediately 401s on Drive cannot bypass MAX_REDIRECT_ATTEMPTS.
  function acceptRedirectToken(access_token) {
    if (!access_token) return;
    L.log({ kind: "ACTION", event: "REDIRECT_TOKEN_ACCEPTED" });
    _storeToken(access_token);
    _transition(S.IDLE, {}, { type: "REDIRECT_TOKEN" });
    _refreshUI();
    dispatch({ type: "SYNC_REQUEST" });
  }

  function getState()        { return _state; }
  function getToken()        { return _token; }
  function getEmail()        { return _email ?? localStorage.getItem(SYNC_EMAIL_KEY); }
  function isEnabled()       { return _state !== S.DISABLED && _state !== S.ERROR; }
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

  return { enable, disable, onGisReady, requestSync, dispatch, acceptRedirectToken,
           getState, getToken, getEmail, isEnabled, isAuthenticated, deleteRemoteFile };
}

window.createSyncMachine = createSyncMachine;
