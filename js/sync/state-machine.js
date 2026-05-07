// @ts-check
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

/** @typedef {import("../types").SyncState}      SyncState */
/** @typedef {import("../types").SyncEvent}      SyncEvent */
/** @typedef {import("../types").SyncMachineCtx} SyncMachineCtx */
/** @typedef {import("../types").SyncMachine}    SyncMachine */

/** @type {Readonly<Record<SyncState, SyncState>>} */
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

/** @type {Set<string>} */
const SILENT_FAIL_REASONS = new Set([
  "user_cancel", "access_denied", "popup_closed_by_user",
]);

const MAX_REAUTH    = 3;
const MAX_CONFLICTS = 3;
const MAX_NET_RETRIES = 5; // 5 retries → delays 1s/2s/4s/8s/16s; OFFLINE on 6th failure
const MAX_REDIRECT_ATTEMPTS = 3;
const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
// Set when an app-open silent re-auth (prompt=none) returns
// interaction_required / login_required / consent_required. The next app
// open must NOT auto-retry — Google has signaled that user interaction is
// needed, so park in NEEDS_CONSENT instead. Cleared on signIn() (user
// gesture) and on SYNC_DONE (defense in depth: a subsequent successful
// sync proves the silent path can resume).
const SILENT_BLOCKED_KEY = "bible-drive-silent-blocked";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata email";
const ACTIVE_READING_IDLE_MS = 5000;

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * @param {{ onStateChange?: (state: SyncState) => void }} [opts]
 * @returns {SyncMachine}
 */
function createSyncMachine({ onStateChange } = {}) {
  const SYNC_ENABLED_KEY = "bible-drive-sync";
  const SYNC_EMAIL_KEY   = "bible-drive-sync-email";
  const T  = window.syncTransport;
  const L  = window.syncDebugLog;
  const V2 = window.syncStoreV2;
  const _deviceId = V2.getDeviceId();

  /** @type {SyncState} */
  let _state = S.DISABLED;
  /** @type {string | null} */
  let _token = null;
  /** @type {string | null} */
  let _email = null;
  /** @type {import("../types").GsiTokenClient | null} */
  let _tokenClient = null;
  let _syncPending = false;

  // ── Context (all "hidden state" in one place) ─────────────────────────────
  // Mutated only by _transition().

  /** @type {SyncMachineCtx} */
  let _ctx = _emptyCtx();

  /** @returns {SyncMachineCtx} */
  function _emptyCtx() {
    return { netFails: 0, conflictFails: 0, reAuthFails: 0, backoffTimer: null };
  }

  // ── _transition: the ONLY place that changes state + context ─────────────
  // 1. Clear pending backoff timer (always safe).
  // 2. Reset all counts to zero.
  // 3. Apply ctxPatch to selectively carry values forward.
  // 4. Persist enabled flag; fire onStateChange.

  /**
   * @param {SyncState} next
   * @param {Partial<SyncMachineCtx>} [ctxPatch]
   * @param {SyncEvent | { type: string }} [event]
   */
  function _transition(next, ctxPatch = {}, event) {
    if (_ctx.backoffTimer !== null) clearTimeout(_ctx.backoffTimer);
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

  /** @param {string} msg */
  function _snackbar(msg) {
    if (typeof window._showSyncSnackbar === "function") window._showSyncSnackbar(msg);
  }

  /** @returns {string | null} */
  function _emailHint() { return localStorage.getItem(SYNC_EMAIL_KEY); }

  // Backoff timer that fires a SYNC_REQUEST if still IDLE.
  // Stored in ctxPatch so _transition will clear it on next transition.
  /**
   * @param {number} failCount
   * @returns {ReturnType<typeof setTimeout>}
   */
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
  /** @returns {ReturnType<typeof setTimeout>} */
  function _makeConflictTimer() {
    return setTimeout(() => {
      if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" });
    }, 200);
  }

  function _reqSilentToken() {
    T.requestSilentToken(_tokenClient, _emailHint());
  }

  // ── iOS redirect helpers ──────────────────────────────────────────────────

  /** @returns {boolean} */
  function _isUserActivelyReading() {
    if (document.visibilityState !== "visible") return false;
    if (!document.hasFocus()) return false;
    const ts = window.__driveSyncInteractionTs?.() ?? 0;
    return Date.now() - ts <= ACTIVE_READING_IDLE_MS;
  }

  /** @returns {number} */
  function _redirectAttempts() {
    return parseInt(localStorage.getItem(REDIRECT_ATTEMPTS_KEY) ?? "0", 10) || 0;
  }

  // Trigger full-page redirect to OAuth endpoint. Returns true if the redirect
  // was initiated (caller should `return` immediately — the page is leaving),
  // false if blocked by the attempt cap.
  /**
   * @param {string | undefined} prompt
   * @returns {boolean}
   */
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
    // _syncClientId is set by drive-sync.js IIFE before this module ever
    // starts a redirect, so the bang assertion is safe in practice.
    T.beginRedirectAuth(/** @type {string} */ (window._syncClientId), SCOPE, { prompt });
    return true;
  }

  // ── Phase 2h: PKCE refresh-token helpers ──────────────────────────────────
  // _attemptSilentRefresh tries to mint a fresh access token from the
  // IndexedDB-stored refresh token. Three outcomes:
  //   - refresh success → store access token, optionally rotate refresh,
  //     transition to IDLE, dispatch SYNC_REQUEST. Returns true.
  //   - refresh 4xx (invalid_grant, etc.) → drop unrecoverable refresh token
  //     from IDB, transition to NEEDS_CONSENT silently. Returns true.
  //   - refresh 5xx / network → keep refresh token, transition to OFFLINE.
  //     NET_RECOVERED will retry. Returns true.
  //   - no refresh token in IDB → no transition; return false so caller
  //     can fall back to legacy GIS / implicit flow.
  // The "true means I took action" contract lets enable() and 401 handler
  // skip their legacy paths cleanly.

  /**
   * @param {Partial<SyncMachineCtx>} [ctxPatch]
   *   401 reauth 경로에서 호출 시 reAuthFails 카운터를 carry forward해야 함.
   *   IDLE 전이 시에만 적용 (실패 경로는 reset이 자연스러움).
   * @param {boolean} [fromReauth]
   *   true면 401 reauth 경로 — SYNCING 상태에서 호출됐고 그 상태를 빠져나오는
   *   것이 우리 책임이므로 SYNCING race 가드를 우회. false (기본)면 cold start
   *   경로 — SYNCING은 legacy GIS가 이미 settled한 상태이므로 폐기해야 함.
   * @returns {Promise<boolean>}
   */
  async function _attemptSilentRefresh(ctxPatch = {}, fromReauth = false) {
    if (!window.refreshStore) return false;
    /** @type {string | null} */
    let rt;
    try {
      rt = await window.refreshStore.loadRefreshToken();
    } catch (err) {
      L.log({ kind: "ERROR", event: "REFRESH_LOAD_FAIL", reason: err instanceof Error ? err.message : String(err) });
      return false;
    }
    if (!rt) return false;

    L.log({ kind: "ACTION", event: "SILENT_REFRESH_BEGIN" });
    const resp = await T.refreshAccessToken(rt, /** @type {string} */ (window._syncClientId));

    // Race guards (§6.2 + Bugbot 1차·2차):
    //   1. _state === IDLE → legacy GIS path already authenticated us. Don't
    //      override (the existing access token is just as good).
    //   2. _state === SYNCING && !fromReauth → cold start race: legacy got to
    //      SYNCING faster, with an in-flight cycle. Don't disrupt it. The
    //      401 reauth path explicitly sets fromReauth=true because *we* need
    //      to push out of SYNCING (the failed cycle is what triggered us).
    //   3. SYNC_ENABLED_KEY === "0" → user called signOut()/disable() during
    //      the async window, OR ERROR state was reached (cap exhaustion).
    //      Either way the user has explicitly stopped sync — honoring our
    //      success would silently resurrect it. _transition flips this flag
    //      to "0" whenever the next state is DISABLED or ERROR.
    if (_state === S.IDLE) {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", finalState: _state });
      return true;
    }
    if (_state === S.SYNCING && !fromReauth) {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", finalState: _state, reason: "in_flight_sync" });
      return true;
    }
    if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", reason: "sync_disabled" });
      return true;
    }

    if (resp.ok) {
      _storeToken(resp.access_token);
      // Rotation: Google may issue a new refresh token. Persist if present;
      // null means "keep existing" — caller of save would overwrite, so guard.
      if (resp.refresh_token) {
        try {
          await window.refreshStore.saveRefreshToken(resp.refresh_token);
          L.log({ kind: "ACTION", event: "REFRESH_TOKEN_ROTATED" });
        } catch (err) {
          L.log({ kind: "ERROR", event: "ROTATION_SAVE_FAIL", reason: err instanceof Error ? err.message : String(err) });
          // Continue: new access token is still good, old refresh is still
          // valid in Google's grace period. Worst case: invalid_grant on next
          // refresh → user re-consents.
        }
      }
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_OK" });
      // ctxPatch carries reAuthFails forward when this is called from the
      // 401 reauth path. Without it, a chronic 401 (Drive rejecting even
      // fresh tokens) would loop forever — counter resets to 0 each cycle.
      _transition(S.IDLE, ctxPatch, { type: "SILENT_REFRESH_OK" });
      _refreshUI();
      dispatch({ type: "SYNC_REQUEST" });
      return true;
    }

    if (resp.status >= 400 && resp.status < 500) {
      // invalid_grant or similar — refresh token is unusable. Drop it so
      // we don't loop on subsequent app opens.
      L.log({ kind: "ERROR", event: "SILENT_REFRESH_INVALID", status: resp.status, error: resp.error });
      try { await window.refreshStore.clearRefreshToken(); } catch {}
      _transition(S.NEEDS_CONSENT, {}, { type: "SILENT_REFRESH_INVALID" });
      _refreshUI();
      return true;
    }

    // Network / 5xx — keep refresh token, OFFLINE will be retried by NET_RECOVERED.
    L.log({ kind: "ERROR", event: "SILENT_REFRESH_NET_FAIL", status: resp.status });
    _transition(S.OFFLINE, {}, { type: "SILENT_REFRESH_NET_FAIL" });
    _refreshUI();
    return true;
  }

  // PKCE redirect-flow entry: drive-sync.js IIFE stashes {code, verifier}
  // and initDriveSync calls this. Exchanges for access+refresh tokens, persists
  // refresh to IDB, transitions to IDLE.
  /**
   * @param {string} code
   * @param {string} verifier
   */
  async function acceptRedirectCode(code, verifier) {
    if (!code || !verifier) return;
    L.log({ kind: "ACTION", event: "REDIRECT_CODE_RECEIVED" });
    const resp = await T.exchangeCodeForToken(
      code, verifier, /** @type {string} */ (window._syncClientId),
    );
    // Race guard (Bugbot #54): user may have called signOut() during the
    // exchange round-trip. State-based check doesn't help here — we ENTER
    // this function with _state === DISABLED (initDriveSync calls before
    // any enable()), so an unchanged DISABLED is normal. Use the localStorage
    // SYNC_ENABLED_KEY flag instead, which signOut() flips to "0".
    if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
      L.log({ kind: "ACTION", event: "REDIRECT_CODE_RACE_LOST", reason: "sync_disabled" });
      return;
    }
    if (!resp.ok) {
      L.log({ kind: "ERROR", event: "CODE_EXCHANGE_FAIL", status: resp.status, error: resp.error });
      _snackbar("인증 처리 중 오류가 발생했습니다. 설정에서 다시 연결해 주세요.");
      _transition(S.NEEDS_CONSENT, {}, { type: "CODE_EXCHANGE_FAIL" });
      _refreshUI();
      return;
    }
    _storeToken(resp.access_token);
    if (resp.refresh_token && window.refreshStore) {
      try {
        await window.refreshStore.saveRefreshToken(resp.refresh_token);
      } catch (err) {
        L.log({ kind: "ERROR", event: "REFRESH_TOKEN_SAVE_FAIL", reason: err instanceof Error ? err.message : String(err) });
        // Don't abort: access token is still usable for the current session.
        // Next cold start will re-prompt consent. Surface to user.
        _snackbar("새 인증 정보 저장에 실패했습니다. 다음 앱 열기 시 재연결이 필요할 수 있습니다.");
      }
    }
    L.log({ kind: "ACTION", event: "REDIRECT_CODE_ACCEPTED" });
    _transition(S.IDLE, {}, { type: "REDIRECT_CODE_ACCEPTED" });
    _refreshUI();
    dispatch({ type: "SYNC_REQUEST" });
  }

  /** @param {string} token */
  function _storeToken(token) {
    _token = token;
    L.log({ kind: "ACTION", event: "TOKEN_STORED", token: L.mask("token", token) });
    T.fetchUserInfo(token).then(({ email }) => {
      _email = email;
      localStorage.setItem(SYNC_EMAIL_KEY, email ?? "");
      L.log({ kind: "ACTION", event: "EMAIL_FETCHED", email: L.mask("email", email) });
      if (email) _refreshUI();
    }).catch((err) => {
      L.log({ kind: "ERROR", event: "EMAIL_FETCH_FAILED", reason: err instanceof Error ? err.message : String(err) });
    });
  }

  // ── v2 data operations ────────────────────────────────────────────────────

  /**
   * @param {import("../types").SyncDoc} merged
   * @param {boolean} hadRemoteChanges
   */
  function _applyMergedDoc(merged, hadRemoteChanges) {
    V2.saveLocal(merged);
    V2.applyToLegacyKeys(merged);
    if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
    if (hadRemoteChanges) {
      // SyncSettings stores `MTimed<unknown>`; the apply* helpers expect
      // narrowed primitive types. Cast at the boundary — runtime guarantees
      // the value matches because saveSetting is the only writer.
      const s = merged.settings;
      if (s.fontSize?.v    != null && typeof window.applyFontSize    === "function") window.applyFontSize(/** @type {number | string} */ (s.fontSize.v));
      if (s.colorScheme?.v != null && typeof window.applyColorScheme === "function") window.applyColorScheme(/** @type {string} */ (s.colorScheme.v));
      if (s.theme?.v       != null && typeof window.applyTheme       === "function") window.applyTheme(/** @type {string} */ (s.theme.v));
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
      if (dlStatus === 0 || (dlStatus !== undefined && dlStatus >= 500)) { dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` }); return; }
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
        /** @type {Array<import("../types").SettingKey>} */ (Object.keys(merged.settings)).some(k =>
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
      const msg = err instanceof Error ? err.message : String(err);
      L.log({ kind: "ERROR", event: "SYNC_EXCEPTION", reason: msg });
      dispatch({ type: "SYNC_FAIL", reason: msg === "no_token" ? "no_token" : "exception" });
    } finally {
      _syncPending = false;
    }
  }

  // ── dispatch ──────────────────────────────────────────────────────────────

  /** @param {SyncEvent} event */
  function dispatch(event) {
    L.log({ kind: "ACTION", event: event.type, state: _state, ctx: { ..._ctx, backoffTimer: !!_ctx.backoffTimer } });

    switch (_state) {

      case S.DISABLED:
        if (event.type === "ENABLE") {
          if (T.isIOS()) {
            // iOS bypasses GIS entirely. Phase 2g: when the user has a prior
            // successful connection (saved email) and silent re-auth hasn't
            // been blocked by Google, attempt prompt=none redirect to resume
            // sync transparently — the in-memory access token was lost on
            // app close and Implicit Flow has no refresh token. On any
            // failure path (no email, blocked, redirect cap), park in
            // NEEDS_CONSENT so the settings UI shows the "연결" button.
            const emailHint = _emailHint();
            const silentBlocked = localStorage.getItem(SILENT_BLOCKED_KEY) === "1";
            if (emailHint && !silentBlocked) {
              if (_beginRedirect("none")) return;
              // Cap reached: _beginRedirect already transitioned to ERROR.
            } else {
              _transition(S.NEEDS_CONSENT, {}, event);
              _refreshUI();
            }
          } else if (window.google?.accounts?.id && window.google?.accounts?.oauth2 && _tokenClient) {
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
            /** @type {string} */ (window._syncClientId),
            SCOPE,
            (resp) => {
              if (resp.error) {
                dispatch({ type: "TOKEN_FAIL", reason: resp.error });
              } else if (resp.access_token) {
                dispatch({
                  type: "TOKEN_OK",
                  access_token: resp.access_token,
                  expires_in: resp.expires_in,
                  scope: resp.scope,
                });
              } else {
                // GIS contract guarantees one of the two, but a malformed
                // response (e.g. transport-level breakage, future SDK change)
                // would otherwise leave AUTHENTICATING permanently stuck —
                // there's no timeout-based recovery. Treat as token failure.
                dispatch({ type: "TOKEN_FAIL", reason: "empty_response" });
              }
            }
          );
          if (window.google?.accounts?.id) {
            T.initIdentityClient(
              /** @type {string} */ (window._syncClientId),
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
          if (event.reason && SILENT_FAIL_REASONS.has(event.reason)) {
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
          // Successful sync also proves the Google session can issue tokens
          // silently — clear any stale Phase 2g silent-blocked flag.
          localStorage.removeItem(SILENT_BLOCKED_KEY);
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
          if (T.isIOS()) {
            // GIS never loads on iOS — redirect flow requires a user gesture,
            // so park in NEEDS_CONSENT to show the connect button rather than
            // transitioning to AUTHENTICATING where no event can advance us.
            _transition(S.NEEDS_CONSENT, {}, event);
            _refreshUI();
          } else if (window.google?.accounts?.id) {
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

  /** @param {{ type: "SYNC_FAIL"; reason: string }} event */
  function _handleSyncFail(event) {
    const { reason } = event;

    if (reason === "401") {
      _token = null;
      // MAX_REAUTH cap upfront — defends against a chronic 401 (Drive
      // rejecting even fresh tokens, e.g. revoked scope server-side). Without
      // this gate, silent refresh would loop forever because successful IDLE
      // transitions reset the legacy reauth counter.
      if (_ctx.reAuthFails >= MAX_REAUTH) {
        _snackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
        _transition(S.ERROR, {}, event);
        _refreshUI();
        return;
      }
      L.log({ kind: "ACTION", event: "REAUTH", attempt: _ctx.reAuthFails + 1 });
      // Phase 2h: silent refresh from IDB takes precedence over legacy GIS /
      // implicit reauth. _attemptSilentRefresh handles its own state
      // transitions (IDLE on success, NEEDS_CONSENT on invalid_grant, OFFLINE
      // on net fail). Only fall through to legacy when no refresh token
      // exists in IDB (returns false). The async kickoff is fire-and-forget.
      _kickoff401Reauth(event, _ctx.reAuthFails + 1);
      return;
    }
    _handleSyncFailNon401(event);
  }

  /**
   * @param {{ type: "SYNC_FAIL"; reason: string }} event
   * @param {number} nextReAuthFails
   */
  async function _kickoff401Reauth(event, nextReAuthFails) {
    // fromReauth=true allows _attemptSilentRefresh to override the SYNCING
    // state we entered with — that's the whole point of this path.
    if (await _attemptSilentRefresh({ reAuthFails: nextReAuthFails }, true)) return;
    _legacyReauthAfter401(event);
  }

  /** @param {{ type: "SYNC_FAIL"; reason: string }} event */
  function _legacyReauthAfter401(event) {
    // Phase 2h: cap check + REAUTH log moved upfront to _handleSyncFail("401")
    // so they fire even on the silent-refresh path. Reaching here means
    // reAuthFails < MAX_REAUTH guaranteed.
    if (T.isIOS()) {
      // Hybrid policy: defer the disruptive full-page redirect when the
      // user is actively reading; otherwise reauthorize transparently.
      if (_isUserActivelyReading()) {
        L.log({ kind: "ACTION", event: "REAUTH_DEFERRED", reason: "active_reading" });
        _snackbar("Google 동기화 재연결이 필요합니다. 설정 → 연결을 눌러 주세요.");
        _transition(S.NEEDS_CONSENT, { reAuthFails: _ctx.reAuthFails + 1 }, event);
        _refreshUI();
      } else {
        // No prompt parameter — Google will silently re-issue the token
        // when the existing session still has the granted scope.
        // Do NOT pre-transition to NEEDS_CONSENT: if _beginRedirect hits the
        // cap it already transitions to ERROR internally, causing a double
        // state transition with a stale intermediate.
        if (!_beginRedirect(undefined)) return;
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
  }

  /** @param {{ type: "SYNC_FAIL"; reason: string }} event */
  function _handleSyncFailNon401(event) {
    const { reason } = event;
    if (reason === "412") {
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

  // Phase 2h: kick off silent refresh fire-and-forget alongside the legacy
  // dispatch. enable() stays synchronous so existing tests / callers don't
  // need to await. The two paths race; whoever finishes first wins, with
  // race guards inside _attemptSilentRefresh that respect a settled state
  // (IDLE / ERROR). Only the legacy path runs synchronously, so on cold
  // start the user sees its outcome first; silent refresh's eventual result
  // either upgrades us (IDLE) or is discarded if legacy already settled.
  function enable() {
    if (_state !== S.DISABLED) return;
    void _attemptSilentRefresh();
    dispatch({ type: "ENABLE" });
  }
  function disable()     { dispatch({ type: "DISABLE" }); }
  function onGisReady()  { if (_state === S.INITIALIZING) dispatch({ type: "GIS_READY" }); }
  function requestSync() { if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" }); }

  // iOS redirect-flow entry: callback handler in drive-sync.js calls this
  // after consumeRedirectCallback validates the token. Bypasses GIS entirely.
  // Does NOT reset the redirect-attempts counter — only a successful sync
  // (SYNC_DONE) clears it, so a server-side scope revocation that issues a
  // token but immediately 401s on Drive cannot bypass MAX_REDIRECT_ATTEMPTS.
  /** @param {string} access_token */
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

  return { enable, disable, onGisReady, requestSync, dispatch,
           acceptRedirectToken, acceptRedirectCode,
           getState, getToken, getEmail, isEnabled, isAuthenticated, deleteRemoteFile };
}

window.createSyncMachine = createSyncMachine;
window._syncScope = SCOPE;
window._syncRedirectAttemptsKey = REDIRECT_ATTEMPTS_KEY;
window._syncSilentBlockedKey = SILENT_BLOCKED_KEY;
