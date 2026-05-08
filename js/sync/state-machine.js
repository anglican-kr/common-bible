// @ts-check
// ── Sync State Machine (statechart) ───────────────────────────────────────────
// Phase 2h 단계 4 이후 — PKCE Authorization Code + refresh token 단일 경로.
// Implicit Flow / GIS Token Client / FedCM 의존은 모두 제거됐다.
//
// Explicit context object eliminates "hidden state" bugs:
//   _ctx = { netFails, conflictFails, reAuthFails, backoffTimer }
//
// All state changes go through _transition(nextState, ctxPatch).
// By default every transition resets all counts and clears the backoff timer.
// To carry a value forward, pass it explicitly in ctxPatch:
//   _transition(S.IDLE, { netFails: _ctx.netFails + 1, backoffTimer: timer })
//
// States:  DISABLED | IDLE | SYNCING | OFFLINE | NEEDS_CONSENT | ERROR
// Events:  ENABLE | DISABLE | USER_CONSENT_REQUEST | SYNC_REQUEST |
//          SYNC_DONE | SYNC_FAIL { reason } | NET_RECOVERED
//
// SYNC_FAIL reasons:
//   "401"       — token expired  → silent refresh from IDB; if no refresh
//                                  token, NEEDS_CONSENT
//   "412"       — ETag mismatch  → re-merge retry (max 3)
//   "no_token"  — guard tripped  → ERROR (deterministic)
//   "exception" — JS error       → ERROR (deterministic)
//   other       — network/5xx    → backoff (max 5), then OFFLINE
//
// Authentication flow (uniform across desktop/Android/iOS):
//   • Cold start with refresh token in IDB → silent refresh (background fetch
//     to /token) → IDLE. No UI, no popup, no redirect.
//   • Cold start without refresh token → NEEDS_CONSENT. Settings UI surfaces
//     the "연결" button.
//   • User clicks "연결" → USER_CONSENT_REQUEST → full-page redirect to
//     accounts.google.com → callback ?code=…&state=… → acceptRedirectCode
//     exchanges for access + refresh tokens, persists refresh to IDB → IDLE.
//   • 401 mid-sync → silent refresh; if no refresh token, NEEDS_CONSENT.

/** @typedef {import("../types").SyncState}      SyncState */
/** @typedef {import("../types").SyncEvent}      SyncEvent */
/** @typedef {import("../types").SyncMachineCtx} SyncMachineCtx */
/** @typedef {import("../types").SyncMachine}    SyncMachine */

/** @type {Readonly<Record<SyncState, SyncState>>} */
const S = Object.freeze({
  DISABLED:      "DISABLED",
  IDLE:          "IDLE",
  SYNCING:       "SYNCING",
  OFFLINE:       "OFFLINE",
  NEEDS_CONSENT: "NEEDS_CONSENT",
  ERROR:         "ERROR",
});

const MAX_REAUTH    = 3;
const MAX_CONFLICTS = 3;
const MAX_NET_RETRIES = 5; // 5 retries → delays 1s/2s/4s/8s/16s; OFFLINE on 6th failure
const MAX_REDIRECT_ATTEMPTS = 3;
const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata email";

// ── Sync cache (per-cycle round-trip elimination) ────────────────────────────
// localStorage cache populated after every successful sync. Survives reloads
// so the *next* cycle starts with a fileId, ETag, and the maxU snapshot from
// the last sync. Three cooperating outcomes in _syncCycle:
//   - cached fileId → skip files.list lookup unconditionally.
//   - cached etag   → conditional GET with If-None-Match. 304 means remote
//                     is byte-identical to last sync, so the JSON body is
//                     never transferred or merged.
//   - cached _u     → if localMaxU == cached _u, local is also unchanged.
//                     304 + matching maxU = the entire cycle is a no-op
//                     (visibilitychange / focus polling case). 304 + diverged
//                     maxU = upload-only (skip merge — remote == cached state
//                     == base of local edits, so local IS the merge result).
//
// Invalidated by 404/412 (file deleted or etag conflict), explicit disable()
// (user disconnect), and deleteRemoteFile().
const CACHE_FILE_ID_KEY  = "bible-drive-cache-file-id";
const CACHE_ETAG_KEY     = "bible-drive-cache-etag";
const CACHE_SYNCED_U_KEY = "bible-drive-cache-synced-u";

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

  // ── Side-effect helpers ───────────────────────────────────────────────────

  function _refreshUI() {
    if (typeof window.rebuildDriveSyncSection === "function") window.rebuildDriveSyncSection();
  }

  /** @param {string} msg */
  function _snackbar(msg) {
    if (typeof window._showSyncSnackbar === "function") window._showSyncSnackbar(msg);
  }

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

  // ── PKCE redirect helpers ─────────────────────────────────────────────────

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
    void T.beginRedirectAuth(/** @type {string} */ (window._syncClientId), SCOPE, { prompt });
    return true;
  }

  // ── Phase 2h: PKCE refresh-token helpers ──────────────────────────────────
  // _attemptSilentRefresh tries to mint a fresh access token from the
  // IndexedDB-stored refresh token. Four outcomes:
  //   - refresh success → store access token, optionally rotate refresh,
  //     transition to IDLE, dispatch SYNC_REQUEST. Returns true.
  //   - refresh 4xx (invalid_grant, etc.) → drop unrecoverable refresh token
  //     from IDB, transition to NEEDS_CONSENT silently. Returns true.
  //   - refresh 5xx / network → keep refresh token, transition to OFFLINE.
  //     NET_RECOVERED will retry. Returns true.
  //   - no refresh token in IDB → no transition; return false so caller
  //     can fall back to NEEDS_CONSENT (cold start with no prior consent).
  // The "true means I took action" contract lets enable() and 401 handler
  // skip their fallback paths cleanly.

  /**
   * @param {Partial<SyncMachineCtx>} [ctxPatch]
   *   401 reauth 경로에서 호출 시 reAuthFails 카운터를 carry forward해야 함.
   *   IDLE 전이 시에만 적용 (실패 경로는 reset이 자연스러움).
   * @param {boolean} [fromReauth]
   *   true면 401 reauth 경로 — SYNCING 상태에서 호출됐고 그 상태를 빠져나오는
   *   것이 우리 책임이므로 SYNCING race 가드를 우회.
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
    //   1. _state === IDLE → another path already authenticated us. Don't
    //      override (the existing access token is just as good).
    //   2. _state === SYNCING && !fromReauth → cold start race: an in-flight
    //      cycle is already running with a valid token. Don't disrupt it. The
    //      401 reauth path explicitly sets fromReauth=true because *we* need
    //      to push out of SYNCING (the failed cycle is what triggered us).
    //   3. _state === ERROR → cap exhaustion. Honoring our success would
    //      silently resurrect a flow the user has been told is broken.
    //   4. SYNC_ENABLED_KEY === "0" → user called signOut()/disable() during
    //      the async window. _transition flips this flag to "0" whenever the
    //      next state is DISABLED or ERROR.
    if (_state === S.IDLE) {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", finalState: _state });
      return true;
    }
    if (_state === S.SYNCING && !fromReauth) {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", finalState: _state, reason: "in_flight_sync" });
      return true;
    }
    if (_state === S.ERROR) {
      L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", finalState: _state, reason: "cap_exhausted" });
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
      // Re-check sync flag after the IDB rotation save — disable() may have
      // arrived during that await window, and _transition(IDLE) would
      // otherwise flip SYNC_ENABLED_KEY back to "1" and override user intent.
      if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
        L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", reason: "sync_disabled_post_save" });
        return true;
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
      // Re-check after the IDB clear — same rationale as the resp.ok branch.
      // _transition(NEEDS_CONSENT) would flip SYNC_ENABLED_KEY back to "1".
      if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
        L.log({ kind: "ACTION", event: "SILENT_REFRESH_RACE_LOST", reason: "sync_disabled_post_clear" });
        return true;
      }
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
    // Re-check after the IDB save — disable() may have arrived during that
    // await window. _transition(IDLE) would otherwise flip SYNC_ENABLED_KEY
    // back to "1" and resurrect a session the user just terminated.
    if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
      L.log({ kind: "ACTION", event: "REDIRECT_CODE_RACE_LOST", reason: "sync_disabled_post_save" });
      return;
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

  // ── Sync cache helpers ────────────────────────────────────────────────────
  // See CACHE_*_KEY block at top of module for the rationale. Three keys
  // instead of one JSON blob keeps the read path branch-free and lets a
  // partial corruption (e.g. a missing etag) degrade gracefully — the slow
  // path simply runs.

  /** @returns {{ fileId: string | null; etag: string | null; syncedMaxU: number }} */
  function _loadCache() {
    const rawU = localStorage.getItem(CACHE_SYNCED_U_KEY);
    const u = rawU !== null ? parseInt(rawU, 10) : NaN;
    return {
      fileId: localStorage.getItem(CACHE_FILE_ID_KEY),
      etag:   localStorage.getItem(CACHE_ETAG_KEY),
      syncedMaxU: Number.isFinite(u) ? u : -1,
    };
  }

  /**
   * @param {{ fileId?: string | null; etag?: string | null; syncedMaxU?: number }} patch
   *   Only non-null fields are written. Null etag (e.g. server omitted ETag
   *   header) leaves the cached value alone — better to keep a stale etag and
   *   discover divergence on next cycle than to drop into the slow path.
   */
  function _saveCache({ fileId, etag, syncedMaxU } = {}) {
    if (fileId)                      localStorage.setItem(CACHE_FILE_ID_KEY, fileId);
    if (etag)                        localStorage.setItem(CACHE_ETAG_KEY, etag);
    if (typeof syncedMaxU === "number" && Number.isFinite(syncedMaxU)) {
      localStorage.setItem(CACHE_SYNCED_U_KEY, String(syncedMaxU));
    }
  }

  function _clearCache() {
    localStorage.removeItem(CACHE_FILE_ID_KEY);
    localStorage.removeItem(CACHE_ETAG_KEY);
    localStorage.removeItem(CACHE_SYNCED_U_KEY);
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

      const local     = V2.loadLocal();
      const localMaxU = V2.maxU(local);
      const cache     = _loadCache();

      // ── Resolve fileId: cache hit skips files.list (~500ms saved) ──
      // The appDataFolder/sync.json file ID is stable for the lifetime of the
      // file, so caching it after first discovery is safe. Stale cache (file
      // deleted from another device) → 404 below → clear + retry next cycle.
      let fileId = cache.fileId;
      if (!fileId) {
        fileId = await T.findSyncFileId(_token);
        L.log({ kind: "NETWORK", event: "FIND_FILE", fileId: L.mask("fileId", fileId) });
      } else {
        L.log({ kind: "ACTION", event: "FIND_FILE_CACHED", fileId: L.mask("fileId", fileId) });
      }

      // ── No remote file yet: upload local state ──
      // No fileId to cache after a fresh upload — the multipart create
      // response is parsed by uploadSyncFile but the new ID isn't surfaced.
      // Next cycle will pay one findSyncFileId before the cache fills.
      if (!fileId) {
        const { ok, status } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId));
        L.log({ kind: "NETWORK", event: "UPLOAD_NEW", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (!ok)                        { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` });   return; }
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      // ── Conditional download with cached etag (304 fast path) ──
      // Only attach If-None-Match when the etag came from the same cached
      // fileId. Mismatch means we just resolved a fresh fileId via
      // findSyncFileId — cached etag belongs to a different file (or was
      // never set), so a 304 here would be misleading.
      const conditionalEtag = (fileId === cache.fileId) ? cache.etag : null;
      const { doc: remote, etag, status: dlStatus } = await T.downloadSyncFile(
        _token, fileId,
        conditionalEtag ? { ifNoneMatch: conditionalEtag } : {},
      );
      L.log({ kind: "NETWORK", event: "DOWNLOAD", status: dlStatus, etag: L.mask("etag", etag) });

      if (dlStatus === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
      if (dlStatus === 404) {
        // File was deleted (likely via deleteRemoteFile on another device).
        // Drop the cache so the next cycle re-discovers via files.list and
        // creates a fresh sync.json.
        _clearCache();
        dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` });
        return;
      }
      if (dlStatus === 0 || (dlStatus !== undefined && dlStatus >= 500)) {
        dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` });
        return;
      }

      // ── 304 Not Modified: remote == cached snapshot. Skip merge entirely. ──
      // Two sub-cases by local divergence:
      //   localMaxU == cache.syncedMaxU → nothing changed on either side,
      //     full no-op (typical visibilitychange/focus poll case).
      //   localMaxU >  cache.syncedMaxU → local edits since last sync but
      //     remote untouched. Upload-only is correct: the cached state IS
      //     remote IS the base our local edits sit on, so local already
      //     equals merge(local, remote).
      if (dlStatus === 304) {
        if (localMaxU === cache.syncedMaxU) {
          dispatch({ type: "SYNC_DONE" });
          return;
        }
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(
          _token, V2.buildSyncPayload(_deviceId),
          { fileId, ifMatch: cache.etag },
        );
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" }); return; }
        if (status === 412) {
          // Lost race: another device wrote between our 304 and our PATCH.
          // Drop cache so the retry takes the full download+merge path.
          _clearCache();
          dispatch({ type: "SYNC_FAIL", reason: "412" });
          return;
        }
        if (!ok)            { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` }); return; }
        _saveCache({ fileId, etag: newEtag, syncedMaxU: localMaxU });
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      if (!remote)                      { dispatch({ type: "SYNC_DONE" });                             return; }

      // ── Remote is legacy v1: upgrade Drive to v2 ──
      if (!V2.validateRemote(remote)) {
        L.log({ kind: "ACTION", event: "REMOTE_SCHEMA_MISMATCH", schema: remote?.schemaVersion });
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId), { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (status === 412)             { _clearCache(); dispatch({ type: "SYNC_FAIL", reason: "412" }); return; }
        _saveCache({ fileId, etag: newEtag, syncedMaxU: localMaxU });
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
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId), { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (status === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
        if (status === 412)             { _clearCache(); dispatch({ type: "SYNC_FAIL", reason: "412" }); return; }
        if (!ok)                        { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` });   return; }
        _saveCache({ fileId, etag: newEtag, syncedMaxU: mergedMaxU });
      } else {
        // No upload needed — local now matches remote post-merge. Cache the
        // remote etag so the next cycle's conditional GET can hit 304.
        _saveCache({ fileId, etag, syncedMaxU: mergedMaxU });
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

    // USER_CONSENT_REQUEST is a user-initiated retry — works from any state
    // except IDLE/SYNCING (no need / don't interrupt). Single uniform path:
    // full-page PKCE redirect to Google.
    if (event.type === "USER_CONSENT_REQUEST") {
      if (_state === S.IDLE || _state === S.SYNCING) return;
      _beginRedirect("consent");
      return;
    }

    switch (_state) {

      case S.DISABLED:
        if (event.type === "ENABLE") {
          // Single uniform path across desktop/Android/iOS: fire silent refresh
          // fire-and-forget. Three async outcomes:
          //   • took action (true) → already transitioned to IDLE/NEEDS_CONSENT/OFFLINE
          //   • no refresh token (false) → park in NEEDS_CONSENT here
          // No GIS, no popup, no redirect on cold start.
          void (async () => {
            const took = await _attemptSilentRefresh();
            if (!took && _state === S.DISABLED &&
                localStorage.getItem(SYNC_ENABLED_KEY) !== "0") {
              _transition(S.NEEDS_CONSENT, {}, { type: "ENABLE_NO_REFRESH_TOKEN" });
              _refreshUI();
            }
          })();
        }
        break;

      case S.NEEDS_CONSENT:
        if (event.type === "DISABLE") {
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
          // A successful sync proves the auth + Drive cycle completed
          // end-to-end; only here is it safe to clear the redirect-attempts
          // counter. Resetting on token receipt alone (in acceptRedirectCode
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
          // Try silent refresh again. If no refresh token exists in IDB
          // (shouldn't happen unless IDB was cleared while offline), fall
          // back to NEEDS_CONSENT.
          void (async () => {
            const took = await _attemptSilentRefresh();
            if (!took && _state === S.OFFLINE &&
                localStorage.getItem(SYNC_ENABLED_KEY) !== "0") {
              _transition(S.NEEDS_CONSENT, {}, { type: "NET_RECOVERED_NO_TOKEN" });
              _refreshUI();
            }
          })();
        } else if (event.type === "DISABLE") {
          _token = null;
          _transition(S.DISABLED, {}, event);
          _refreshUI();
        }
        break;

      case S.ERROR:
        if (event.type === "ENABLE") {
          // ERROR-driven retry — clear stale attempt counter so user-initiated
          // reconnect gets a fresh window of MAX_REDIRECT_ATTEMPTS chances.
          localStorage.setItem(REDIRECT_ATTEMPTS_KEY, "0");
          _beginRedirect("consent");
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
    // No refresh token in IDB. Race guard (Bugbot PR #54 3차): user may have
    // called disable()/signOut() during the IDB load. Mirror the localStorage
    // flag check used by the silent path.
    if (localStorage.getItem(SYNC_ENABLED_KEY) === "0") {
      L.log({ kind: "ACTION", event: "REAUTH_RACE_LOST", reason: "sync_disabled" });
      return;
    }
    // Park in NEEDS_CONSENT — user must click "연결" to start a new PKCE round.
    _transition(S.NEEDS_CONSENT, { reAuthFails: nextReAuthFails }, event);
    _refreshUI();
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

  function enable()      { dispatch({ type: "ENABLE" }); }
  function disable() {
    // Set the SYNC_ENABLED_KEY flag to "0" defensively before dispatching, so
    // any in-flight async work (silent refresh, code exchange) sees the user
    // intent through the flag-based race guards even when no transition fires
    // (e.g. disable() while still DISABLED waiting for silent refresh to
    // resolve — _transition would not flip the flag in that branch).
    localStorage.setItem(SYNC_ENABLED_KEY, "0");
    // Drop the sync cache so a subsequent sign-in (potentially as a different
    // Google account) doesn't reuse a fileId/etag that no longer belongs to
    // the new identity.
    _clearCache();
    dispatch({ type: "DISABLE" });
  }
  function requestSync() { if (_state === S.IDLE) dispatch({ type: "SYNC_REQUEST" }); }

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
    // Cached fileId/etag now point to a deleted file — drop them.
    _clearCache();
  }

  return { enable, disable, requestSync, dispatch,
           acceptRedirectCode,
           getState, getToken, getEmail, isEnabled, isAuthenticated, deleteRemoteFile };
}

window.createSyncMachine = createSyncMachine;
window._syncScope = SCOPE;
window._syncRedirectAttemptsKey = REDIRECT_ATTEMPTS_KEY;
