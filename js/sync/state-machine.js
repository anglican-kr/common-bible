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
//   other       — any other failed request (network · 403 · 429 · 5xx …, as
//                  `http_<status>`) → backoff (max 5); out of retries, a
//                  network failure (`http_0`) parks in OFFLINE, an HTTP one
//                  goes back to IDLE (the next request retries)
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
const MAX_NET_RETRIES = 5; // 5 retries → delays 1s/2s/4s/8s/16s; on the 6th failure a network one parks in OFFLINE, an HTTP one goes back to IDLE
const MAX_REDIRECT_ATTEMPTS = 3;
// 「파일도 삭제」 waits at most this long for a running cycle to finish the request it already sent.
const CYCLE_WAIT_MS = 10_000;
const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata email";

// ── Sync cache (per-cycle round-trip elimination) ────────────────────────────
// localStorage cache populated after every successful sync. Survives reloads
// so the *next* cycle starts with a fileId, ETag, and the fingerprint of the
// doc as last synced. Three cooperating outcomes in _syncCycle:
//   - cached fileId → skip files.list lookup unconditionally.
//   - cached etag   → conditional GET with If-None-Match. 304 means remote
//                     is byte-identical to last sync, so the JSON body is
//                     never transferred or merged.
//   - cached hash   → if the local doc's fingerprint matches, local is also
//                     unchanged. 304 + matching fingerprint = the entire cycle
//                     is a no-op (visibilitychange / focus polling case).
//                     304 + diverged fingerprint = upload-only (skip merge —
//                     remote == cached state == base of local edits, so local
//                     IS the merge result).
//
// Drive sends no ETag the app can read, on the download or the upload (2026-10-30 dev 시험, ADR-011 Phase 2j,
// known-issues §42), so in production the etag stays uncached and every cycle downloads and merges; the 304 branch
// runs only where an ETag arrives (the unit harness).
//
// Invalidated by 404/412 (file deleted or etag conflict), explicit disable()
// (user disconnect), and deleteRemoteFile().
const CACHE_FILE_ID_KEY     = "bible-drive-cache-file-id";
const CACHE_ETAG_KEY        = "bible-drive-cache-etag";
const CACHE_SYNCED_HASH_KEY = "bible-drive-cache-synced-hash";
// Held the largest record time of the last sync until 2026-10-31; removed when the cache is written or cleared.
const LEGACY_CACHE_SYNCED_U_KEY = "bible-drive-cache-synced-u";

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
  // A user-driven SYNC_REQUEST that arrives while a cycle runs (requestSync) is not dropped — that cycle
  // may already have read or uploaded local state without the edit it carries. One more cycle runs once
  // this one settles with SYNC_DONE (a failure retries through its own backoff anyway).
  let _resyncRequested = false;
  // The running _syncCycle (resolved when none). deleteRemoteFile waits on it so that a request the
  // cycle already sent has landed before the lookup that decides what to delete.
  /** @type {Promise<void>} */
  let _cycleDone = Promise.resolve();
  // Files this page created (multipart create answers with the id) — 「파일도 삭제」 deletes them even when
  // the listing does not show them yet.
  /** @type {Set<string>} */
  const _createdFileIds = new Set();
  // Timestamp (ms) when the last _syncCycle finished. Read by requestSync()
  // to throttle "poll" callers (visibilitychange) that would otherwise pay a
  // full 1+s round-trip even when nothing has changed. 0 means no cycle has
  // completed yet, so the first request always proceeds.
  let _lastSyncEndAt = 0;

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
   *   것이 우리 책임이므로 SYNCING 경쟁 상태 검사를 우회.
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
      // Session credentials are gone — drop the sync cache too so a re-auth
      // as a different account doesn't waste a 404 round trip on the prior
      // user's stale fileId/etag. Drive's appDataFolder isolation would
      // self-heal, but pre-clearing is one fewer surprise round trip.
      _clearCache();
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
  //
  // After the token exchange succeeds we install a popstate-based back guard
  // (see _installOAuthBackGuard below) so a back-press from the app doesn't
  // land the user on Google's sign-in screen. We tried history.go(-delta)
  // earlier — fragile in practice because history.length is capped on Safari
  // and varies when the click had a non-empty forward stack. The guard sits
  // above whatever Google added to history and absorbs back-presses for 60s.
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

    // Install a back-navigation guard so a back-press from the app doesn't
    // surface Google's sign-in screen. See _installOAuthBackGuard for the
    // popstate-based mechanism + 60s auto-disable.
    _installOAuthBackGuard();
  }

  // Back-navigation guard installed after a successful OAuth callback.
  //
  // Goal: a single back-press from the post-OAuth page should land the user
  // on the page they were viewing BEFORE they clicked "연결" — not on Google's
  // sign-in screen, and not on a "stuck at current page" no-op.
  //
  // Mechanism:
  //   1. Push a same-origin guard entry on top of the post-OAuth page. The
  //      guard's URL equals the current URL so there is no visible flicker.
  //   2. On the first popstate that leaves the guard (user pressed back), read
  //      the history.length snapshot transport.js captured at click time. The
  //      difference (now − snapshot) is the number of entries Google's flow
  //      added; history.go(-delta) from the post-guard position lands exactly
  //      on the entry the user was viewing before the connect button click.
  //   3. If the snapshot is missing, unreliable, or out of a sane range
  //      (Safari history.length cap, non-empty forward stack at click time),
  //      fall back to re-pushing the guard so back-press is at worst absorbed
  //      — never escalates to a Google screen.
  //   4. Auto-disable after 60s so a forgotten guard cannot hijack normal
  //      back-navigation forever.
  function _installOAuthBackGuard() {
    if (typeof window === "undefined" || !window.history) return;
    const guardUrl = window.location.href;

    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      window.removeEventListener("popstate", onPop);
      L.log({ kind: "ACTION", event: "OAUTH_BACK_GUARD_RELEASED" });
    };

    /** @param {PopStateEvent} e */
    const onPop = (e) => {
      if (!active) return;
      // Popstate that lands us back ON the guard (e.g., forward navigation
      // returning to it). No action needed; let the user proceed.
      const state = /** @type {{ __oauthGuard?: boolean } | null} */ (e.state);
      if (state?.__oauthGuard) return;

      // User pressed back, leaving the guard. Try the precise jump first.
      const ctx = _readBackNavContext();
      if (ctx && ctx.historyLengthAtRedirect >= 2) {
        const delta = window.history.length - ctx.historyLengthAtRedirect;
        // Sanity range: at least 2 (the bare redirect + callback), no more
        // than 10 (defensive cap against pathological Google flows or stale
        // payloads). Within this band we trust the snapshot enough to jump.
        if (delta >= 2 && delta <= 10) {
          _clearBackNavContext();
          L.log({ kind: "ACTION", event: "OAUTH_BACK_GUARD_JUMP", delta });
          release();
          window.history.go(-delta);
          return;
        }
      }

      // Snapshot missing or out of range — re-push the guard so the user is
      // not delivered to Google's sign-in screen by the next back-press.
      try {
        window.history.pushState({ __oauthGuard: true }, "", guardUrl);
        L.log({ kind: "ACTION", event: "OAUTH_BACK_GUARD_RE_PUSH" });
      } catch (_) { /* best effort */ }
    };

    try {
      window.history.pushState({ __oauthGuard: true }, "", guardUrl);
    } catch (_) { return; }
    window.addEventListener("popstate", onPop);
    L.log({ kind: "ACTION", event: "OAUTH_BACK_GUARD_INSTALLED" });
    setTimeout(release, 60_000);
  }

  // Read back-nav snapshot stashed by transport.beginRedirectAuth. Defensive
  // parsing — a malformed payload (manual tampering, version skew) yields null
  // and the caller falls back to the trap-absorb behavior.
  /** @returns {{ historyLengthAtRedirect: number; ts: number } | null} */
  function _readBackNavContext() {
    try {
      const raw = sessionStorage.getItem("bible-drive-back-nav-context");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed?.historyLengthAtRedirect !== "number") return null;
      if (typeof parsed?.ts !== "number") return null;
      // Stale snapshots (>10min) likely belong to an orphaned attempt — ignore.
      if (Date.now() - parsed.ts > 10 * 60 * 1000) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function _clearBackNavContext() {
    try { sessionStorage.removeItem("bible-drive-back-nav-context"); } catch (_) {}
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

  // All three helpers swallow storage errors. The cache is a pure optimization;
  // any failure (QuotaExceededError, SecurityError on disabled storage, ITP
  // partitioning) MUST degrade to the slow path rather than propagate up to
  // _syncCycle's catch block — a quota error during _saveCache would otherwise
  // knock the user into the ERROR state when sync itself was healthy.

  /** @returns {{ fileId: string | null; etag: string | null; syncedHash: string | null }} */
  function _loadCache() {
    try {
      return {
        fileId:     localStorage.getItem(CACHE_FILE_ID_KEY),
        etag:       localStorage.getItem(CACHE_ETAG_KEY),
        syncedHash: localStorage.getItem(CACHE_SYNCED_HASH_KEY),
      };
    } catch {
      // localStorage access threw (e.g. SecurityError when cookies disabled).
      // Return empty cache — _syncCycle treats this as cache miss.
      return { fileId: null, etag: null, syncedHash: null };
    }
  }

  /**
   * @param {{ fileId?: string | null; etag?: string | null; syncedHash?: string }} patch
   *   Only non-null fields are written. Null etag (e.g. server omitted ETag
   *   header) leaves the cached value alone — better to keep a stale etag and
   *   discover divergence on next cycle than to drop into the slow path.
   */
  function _saveCache({ fileId, etag, syncedHash } = {}) {
    try {
      // The fingerprint goes before the etag: when storage refuses the second write, an old etag beside a new
      // fingerprint only downloads once more, where a new etag beside an old fingerprint uploads once more.
      if (syncedHash) {
        localStorage.setItem(CACHE_SYNCED_HASH_KEY, syncedHash);
        localStorage.removeItem(LEGACY_CACHE_SYNCED_U_KEY);
      }
      if (fileId)                      localStorage.setItem(CACHE_FILE_ID_KEY, fileId);
      if (etag)                        localStorage.setItem(CACHE_ETAG_KEY, etag);
    } catch (err) {
      // Most likely QuotaExceededError. Cache write failure is non-fatal — the
      // next cycle just takes the slow path and retries the write. Log so the
      // pattern is visible if it becomes chronic.
      L.log({ kind: "ERROR", event: "CACHE_SAVE_FAIL", reason: err instanceof Error ? err.message : String(err) });
    }
  }

  function _clearCache() {
    try {
      localStorage.removeItem(CACHE_FILE_ID_KEY);
      localStorage.removeItem(CACHE_ETAG_KEY);
      localStorage.removeItem(CACHE_SYNCED_HASH_KEY);
      localStorage.removeItem(LEGACY_CACHE_SYNCED_U_KEY);
    } catch {
      // Same rationale as _saveCache — silent. Stale cache that can't be
      // cleared still safely degrades: 404/412 paths re-clear next cycle.
    }
  }

  // ── v2 data operations ────────────────────────────────────────────────────

  /**
   * @param {import("../types").SyncDoc} merged
   * @param {boolean} hadRemoteChanges
   * @returns {import("../types").SaveOutcome} the merged doc's save — anything but "saved" leaves this device as it was
   */
  function _applyMergedDoc(merged, hadRemoteChanges) {
    // 옛 판의 북마크 절 범위(2026-06-06 #205 전의 줄 글자)는 지금 표기로 옮겨 저장한다 — per-item times unchanged,
    // so the merge's pick between two copies of one time cannot bring the old form back (coding-pitfalls §38).
    if (typeof window.migrateLegacyBookmarkDoc === "function") window.migrateLegacyBookmarkDoc(merged);
    const outcome = V2.saveLocal(merged);
    if (outcome !== "saved") {
      L.log({ kind: "ERROR", event: "MERGE_SAVE_FAIL", reason: hadRemoteChanges ? outcome : `${outcome}, no remote changes` });
      // Said only when something came from the other devices — the same turn as the success line below (사용자 결정
      // 2026-10-26, known-issues §15.4). Deleting a bookmark frees room and wakes the sync (scheduleUpload).
      if (hadRemoteChanges) {
        _snackbar(outcome === "full"
          ? "저장 공간이 가득 차 다른 기기에서 변경된 데이터를 불러오지 못했습니다. 쓰지 않는 북마크를 지우면 다시 동기화합니다."
          : "다른 기기에서 변경된 데이터를 불러오지 못했습니다.");
      }
      return outcome;
    }
    // The doc above is saved, so a key the browser refuses here must not end the cycle in the "reconnect" error
    // (ADR-015 D7). A refused bookmark key is a stale second copy; a refused setting or reading-position key leaves
    // its old value for the next start until a later merge writes it (known-issues §35).
    try {
      const refused = V2.applyToLegacyKeys(merged);
      if (refused?.length) L.log({ kind: "ERROR", event: "LEGACY_KEYS_FAIL", reason: refused.join(", ") });
    } catch (err) {
      L.log({ kind: "ERROR", event: "LEGACY_KEYS_FAIL", reason: err instanceof Error ? err.message : String(err) });
    }
    // Refresh the visible bookmark surface (drawer or /bookmarks full view).
    if (typeof window.rerenderActiveBookmarkTree === "function") window.rerenderActiveBookmarkTree();
    else if (typeof window.renderBookmarkTree === "function") window.renderBookmarkTree();
    if (hadRemoteChanges) {
      // SyncSettings stores `MTimed<unknown>`; the apply* helpers expect
      // narrowed primitive types. Cast at the boundary — runtime guarantees
      // the value matches because saveSetting is the only writer.
      const s = merged.settings;
      if (s.fontSize?.v    != null && typeof window.applyFontSize    === "function") window.applyFontSize(/** @type {number | string} */ (s.fontSize.v));
      if (s.colorScheme?.v != null && typeof window.applyColorScheme === "function") window.applyColorScheme(/** @type {string} */ (s.colorScheme.v));
      if (s.theme?.v       != null && typeof window.applyTheme       === "function") window.applyTheme(/** @type {string} */ (s.theme.v));
      if (s.citeShow?.v    != null && typeof window.applyCiteShow    === "function") window.applyCiteShow(/** @type {boolean} */ (s.citeShow.v));
      if (s.audioShow?.v   != null && typeof window.applyAudioShow   === "function") window.applyAudioShow(/** @type {boolean} */ (s.audioShow.v));
      _snackbar("다른 기기에서 변경된 데이터를 불러왔습니다.");
    }
    return outcome;
  }

  /** @param {number | undefined} status */
  function _is2xx(status) { return typeof status === "number" && status >= 200 && status < 300; }

  // The failure branches every upload shares — 401 re-auth, 412 (another device wrote first: drop the
  // cache so the retry takes the full download + merge path), any other failure as `http_<status>`.
  // True when it dispatched; the caller returns.
  /** @param {boolean} ok @param {number} status */
  function _uploadFailed(ok, status) {
    if (status === 401) { dispatch({ type: "SYNC_FAIL", reason: "401" });              return true; }
    if (status === 412) { _clearCache(); dispatch({ type: "SYNC_FAIL", reason: "412" }); return true; }
    if (!ok)            { dispatch({ type: "SYNC_FAIL", reason: `http_${status}` });   return true; }
    return false;
  }

  // DISABLE (signOut · disable) can land during any network await of a cycle. Sync is off from then
  // on, so the rest of the cycle must not touch Drive or local data — no upload built after the await
  // (it would carry edits made after sign-out, sent with the token already cleared), no remote doc
  // merged into local storage, no cache re-filled after disable() cleared it. Every await in
  // _syncCycle is followed by this check, and so is its catch (an await that rejects after DISABLE).
  // It reads the state, not a per-cycle id: were the machine SYNCING again by the time the await
  // returns, this cycle is the one that settles it — _syncPending keeps that SYNC_REQUEST from
  // starting a second cycle.
  // A check per await is the chosen shape — cancelling in-flight requests (an AbortController per
  // cycle) or a shared await wrapper was weighed and declined (2026-10-17, coding-pitfalls §11):
  // a request already sent before sign-out carries pre-sign-out edits and may finish.
  /** @param {string} at */
  function _leftSyncing(at) {
    if (_state === S.SYNCING) return false;
    L.log({ kind: "ACTION", event: "SYNC_ABORTED", at, state: _state });
    return true;
  }

  // The one place a cycle starts — a cycle still running (it left SYNCING and came back) settles this
  // SYNCING itself (see _leftSyncing), and _cycleDone keeps pointing at it.
  function _startCycle() {
    if (_syncPending) return;
    _cycleDone = _syncCycle();
  }

  async function _syncCycle() {
    _syncPending = true;
    try {
      if (!_token) throw new Error("no_token");

      const cache     = _loadCache();

      // ── Resolve fileId: cache hit skips files.list (~500ms saved) ──
      // The appDataFolder/sync.json file ID is stable for the lifetime of the
      // file, so caching it after first discovery is safe. Stale cache (file
      // deleted from another device) → 404 below → clear + retry next cycle.
      let fileId = cache.fileId;
      if (!fileId) {
        const found = await T.findSyncFileId(_token);
        L.log({ kind: "NETWORK", event: "FIND_FILE", status: found.status, fileId: L.mask("fileId", found.fileId) });
        if (_leftSyncing("find_file")) return;
        // Only a successful lookup may read as "no file yet" — a failed one retries instead of creating a
        // second sync.json next to the one it could not see.
        if (found.status === 401)   { dispatch({ type: "SYNC_FAIL", reason: "401" });                   return; }
        if (!_is2xx(found.status))  { dispatch({ type: "SYNC_FAIL", reason: `http_${found.status}` }); return; }
        fileId = found.fileId;
      } else {
        L.log({ kind: "ACTION", event: "FIND_FILE_CACHED", fileId: L.mask("fileId", fileId) });
      }

      // ── No remote file yet: upload local state ──
      // The create answers with the new id: cache it (the next cycle skips files.list) and remember it
      // for 「파일도 삭제」. The etag stays uncached — the next cycle downloads once without If-None-Match.
      if (!fileId) {
        const { ok, status, fileId: createdId } = await T.uploadSyncFile(_token, V2.buildSyncPayload(_deviceId));
        if (createdId) _createdFileIds.add(createdId);
        L.log({ kind: "NETWORK", event: "UPLOAD_NEW", ok, status, fileId: L.mask("fileId", createdId ?? null) });
        if (_leftSyncing("upload_new")) return;
        if (_uploadFailed(ok, status)) return;
        if (createdId) _saveCache({ fileId: createdId });
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
      if (_leftSyncing("download")) return;

      if (dlStatus === 401)             { dispatch({ type: "SYNC_FAIL", reason: "401" });              return; }
      if (dlStatus === 404) {
        // File was deleted (likely via deleteRemoteFile on another device).
        // Drop the cache so the next cycle re-discovers via files.list and
        // creates a fresh sync.json.
        _clearCache();
        dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` });
        return;
      }
      // Every other failure retries with backoff — Drive asks for it on 403 rate limits · 429 · 5xx, and a
      // 400 or another 403 stops at the retry cap. `doc` is null on any failure, so falling through would
      // read it as "no remote doc" and settle with SYNC_DONE.
      if (typeof dlStatus === "number" && dlStatus !== 304 && !_is2xx(dlStatus)) {
        dispatch({ type: "SYNC_FAIL", reason: `http_${dlStatus}` });
        return;
      }

      // Read local now, not at cycle start: edits saved while the lookup / download were in flight
      // (bookmarks · settings · reading position) must reach the merge — `_applyMergedDoc` writes the
      // whole doc, so a snapshot from before the awaits would erase them. No await separates this read
      // from that write.
      const local     = V2.loadLocal();
      const localMaxU = V2.maxU(local);

      // ── 304 Not Modified: remote == cached snapshot. Skip merge entirely. ──
      // Two sub-cases by local divergence:
      //   fingerprint == cache.syncedHash → nothing changed on either side,
      //     full no-op (typical visibilitychange/focus poll case).
      //   fingerprint != cache.syncedHash → local edits since last sync but
      //     remote untouched. Upload-only is correct: the cached state IS
      //     remote IS the base our local edits sit on, so local already
      //     equals merge(local, remote).
      // The largest time could not tell these apart: a bookmark made on a slow-clock device kept it where it was, and
      // the edit never went up while Drive stayed the same (known-issues §38).
      if (dlStatus === 304) {
        if (V2.fingerprint(local) === cache.syncedHash) {
          dispatch({ type: "SYNC_DONE" });
          return;
        }
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(
          _token, payload,
          { fileId, ifMatch: cache.etag },
        );
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (_leftSyncing("upload_update")) return;
        if (_uploadFailed(ok, status)) return;   // 412: another device wrote between our 304 and our PATCH
        // What was uploaded — an edit saved during the PATCH is newer and goes up next cycle.
        _saveCache({ fileId, etag: newEtag, syncedHash: V2.fingerprint(payload) });
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      if (!remote)                      { dispatch({ type: "SYNC_DONE" });                             return; }

      // ── Remote is legacy v1: upgrade Drive to v2 ──
      if (!V2.validateRemote(remote)) {
        L.log({ kind: "ACTION", event: "REMOTE_SCHEMA_MISMATCH", schema: remote?.schemaVersion });
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(_token, payload, { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (_leftSyncing("upload_upgrade")) return;
        if (_uploadFailed(ok, status)) return;
        _saveCache({ fileId, etag: newEtag, syncedHash: V2.fingerprint(payload) });
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      // ── Merge and conditionally upload ──
      const remoteMaxU = V2.maxU(remote);
      const merged     = V2.mergeDocs(local, remote, _deviceId);
      const mergedMaxU = V2.maxU(merged);

      // Local bookmark entries are read as own entries only: an id like `toString` read an inherited function
      // there, and a tombstone received for it counted as no change (known-issues §15.2).
      const localItems      = local.bookmarks?.items      ?? {};
      const localTombstones = local.bookmarks?.tombstones ?? {};
      const hadRemoteChanges = (
        Object.keys(merged.settings).some(k =>
          (merged.settings[k]?._u ?? 0) > (local.settings?.[k]?._u ?? 0)) ||
        (merged.lastRead?._u ?? 0) > (local.lastRead?._u ?? 0) ||
        // An item this device lacks came from Drive whatever its time: one moved from an old build's list has time 0
        // (store-v2.js _LEGACY_U), and read against 0 it went unseen — a refused save then said nothing (PR #451 review).
        // Equal times keep Drive's copy (store-v2.js mergeDocs) but do not count here: the list is redrawn after every
        // merge anyway, and an old verse range meeting its moved form at the same time is no change to tell about.
        Object.keys(merged.bookmarks?.items ?? {}).some(id =>
          !Object.hasOwn(localItems, id) || (merged.bookmarks.items[id]?._u ?? 0) > (localItems[id]._u ?? 0)) ||
        // A tombstone counts only when it removes an item this device shows. Counting every tombstone newer than this
        // device's showed 「다른 기기에서 변경된 데이터를 불러왔습니다.」 at every start: the 30-day cleanup
        // (sweepTombstones) drops old tombstones here and the merge brings them back from Drive (2026-10-31 리뷰).
        Object.keys(localItems).some(id =>
          !Object.hasOwn(merged.bookmarks?.items ?? {}, id)
          && !((Object.hasOwn(localTombstones, id) ? localTombstones[id] : -Infinity) > (localItems[id]?._u ?? 0)))
      );

      L.log({ kind: "ACTION", event: "MERGE", localMaxU, remoteMaxU, mergedMaxU, hadRemoteChanges });
      if (_applyMergedDoc(merged, hadRemoteChanges) !== "saved") {
        // The payload is read back from local storage (buildSyncPayload), which still holds the doc from before the
        // merge — uploading it would put Drive back to it and drop the other devices' edits for every device. That holds
        // even when no newer time came in: of two copies with the same time the merge keeps Drive's, so the stored doc
        // is not the merge (PR #445 review). No upload and no cache: the next cycle downloads
        // and merges again; this device's own edits wait for room (known-issues §15.4, ADR-015 D7).
        dispatch({ type: "SYNC_DONE" });
        return;
      }

      const remoteCount = Object.keys(remote.bookmarks?.items ?? {}).length
                        + Object.keys(remote.bookmarks?.tombstones ?? {}).length;
      const mergedCount = Object.keys(merged.bookmarks?.items ?? {}).length
                        + Object.keys(merged.bookmarks?.tombstones ?? {}).length;

      // Also uploaded when the merge holds a record Drive lacks or one newer than Drive's — the count and the largest
      // time can both stay put: an item moved from an old build's list has time 0 (store-v2.js _LEGACY_U), and when a
      // tombstone Drive kept beside a restored item drops out in the same merge, the item never went up (PR #451
      // review). A setting newer than Drive's but older than Drive's newest record did not go up either.
      const remoteItems      = remote.bookmarks?.items      ?? {};
      const remoteTombstones = remote.bookmarks?.tombstones ?? {};
      const addsToRemote = (
        Object.keys(merged.settings).some(k =>
          (merged.settings[k]?._u ?? 0) > (remote.settings?.[k]?._u ?? 0)) ||
        (merged.lastRead?._u ?? 0) > (remote.lastRead?._u ?? 0) ||
        Object.keys(merged.bookmarks?.items ?? {}).some(id =>
          !Object.hasOwn(remoteItems, id) || (merged.bookmarks.items[id]?._u ?? 0) > (remoteItems[id]._u ?? 0)) ||
        Object.keys(merged.bookmarks?.tombstones ?? {}).some(id =>
          !Object.hasOwn(remoteTombstones, id) || (merged.bookmarks.tombstones[id] ?? 0) > remoteTombstones[id])
      );

      if (mergedMaxU > remoteMaxU || mergedCount > remoteCount || addsToRemote) {
        const payload = V2.buildSyncPayload(_deviceId);
        const { ok, status, etag: newEtag } = await T.uploadSyncFile(_token, payload, { fileId, ifMatch: etag });
        L.log({ kind: "NETWORK", event: "UPLOAD_UPDATE", ok, status });
        if (_leftSyncing("upload_merged")) return;
        if (_uploadFailed(ok, status)) return;
        _saveCache({ fileId, etag: newEtag, syncedHash: V2.fingerprint(payload) });
      } else {
        // No upload needed — local now matches remote post-merge. Cache the
        // remote etag so the next cycle's conditional GET can hit 304. `merged` is what was just saved (old verse
        // ranges are moved in it before the save, ADR-011).
        _saveCache({ fileId, etag, syncedHash: V2.fingerprint(merged) });
      }

      dispatch({ type: "SYNC_DONE" });
    } catch (err) {
      // Always reported (the reason is what a copied diagnostic needs) — but a cycle that has stopped
      // (sign-out) or already settled dispatches nothing more.
      const msg = err instanceof Error ? err.message : String(err);
      L.log({ kind: "ERROR", event: "SYNC_EXCEPTION", reason: msg });
      if (_leftSyncing("exception")) return;
      dispatch({ type: "SYNC_FAIL", reason: msg === "no_token" ? "no_token" : "exception" });
    } finally {
      _syncPending = false;
      _lastSyncEndAt = Date.now();
    }
  }

  // ── _stopSync: the one way sync turns off ─────────────────────────────────
  // disable() (DISABLE, from any state) and deleteRemoteFile() both come here.
  //   • The flag goes to "0" first, so in-flight async work (silent refresh, code exchange) sees the
  //     intent through the flag guards even when no transition fires (already DISABLED, a silent
  //     refresh still pending).
  //   • The cache goes, so a later sign-in (possibly another Google account) does not reuse a
  //     fileId/etag that is no longer its own.
  //   • The token goes, so no cycle can start and a running one stops at its next await (_leftSyncing).
  //   • Settings redraws in every state — deleteRemoteFile() → signOut() → disable() lands in DISABLED.

  /** @param {SyncEvent | { type: string }} event */
  function _stopSync(event) {
    localStorage.setItem(SYNC_ENABLED_KEY, "0");
    _clearCache();
    _token = null;
    _transition(S.DISABLED, {}, event);   // from DISABLED this only resets the ctx
    _refreshUI();
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

    // DISABLE (sign-out · settings off · another tab signed out) works from every state, DISABLED included.
    if (event.type === "DISABLE") {
      _stopSync(event);
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
        // Left only by USER_CONSENT_REQUEST and DISABLE, both handled above.
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
          // A new cycle reads local state afresh, so a pending re-run is covered by it.
          _resyncRequested = false;
          _startCycle();
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
          if (_resyncRequested) {
            _resyncRequested = false;
            // Next microtask: this dispatch runs inside the finishing cycle, whose finally (_syncPending
            // = false) has not run yet — a SYNC_REQUEST now would find a cycle "still running".
            void Promise.resolve().then(() => dispatch({ type: "SYNC_REQUEST" }));
          }
        } else if (event.type === "SYNC_FAIL") {
          _handleSyncFail(event);
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
        }
        break;

      case S.ERROR:
        if (event.type === "ENABLE") {
          // ERROR-driven retry — clear stale attempt counter so user-initiated
          // reconnect gets a fresh window of MAX_REDIRECT_ATTEMPTS chances.
          localStorage.setItem(REDIRECT_ATTEMPTS_KEY, "0");
          _beginRedirect("consent");
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
    // Same rationale as the invalid_grant branch above: token is gone, so
    // pre-clear cache to avoid a stale-fileId 404 if the user re-auths as
    // a different account.
    _clearCache();
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
      // Any other failed request — exponential backoff (Drive asks for it on 403 rate limits · 429 · 5xx).
      // A device that is offline, or out of retries on a network failure (`http_0`), parks in OFFLINE —
      // the `online` event or the next request (requestSync) retries. Out of retries on an HTTP failure
      // goes back to IDLE: the server did answer, and an `online` event never comes on a connected
      // device, so OFFLINE would stop syncing for the rest of the session.
      const n = _ctx.netFails + 1;
      if (!navigator.onLine || (n > MAX_NET_RETRIES && reason === "http_0")) {
        _transition(S.OFFLINE, {}, event);
        _refreshUI();
      } else if (n > MAX_NET_RETRIES) {
        L.log({ kind: "ACTION", event: "RETRIES_EXHAUSTED", reason });
        _transition(S.IDLE, {}, event);   // counts reset — the next request starts afresh
      } else {
        const timer = _makeBackoffTimer(n);
        _transition(S.IDLE, { netFails: n, backoffTimer: timer }, event);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function enable()      { dispatch({ type: "ENABLE" }); }
  function disable()     { dispatch({ type: "DISABLE" }); }   // every state — _stopSync
  // Public sync entry point. Internal callers (silent refresh, timers,
  // acceptRedirectCode) dispatch SYNC_REQUEST directly — only requests that
  // arrive from the UI/app layer go through here. Pass `throttleMs` to skip
  // when a cycle finished within that window; used by visibilitychange polls
  // where firing four 1+s round-trips in 10 seconds (observed in logs) buys
  // no value over a single recent cycle.
  /** @param {{ throttleMs?: number }} [opts] */
  function requestSync(opts) {
    const throttleMs = opts?.throttleMs;
    const isPoll = typeof throttleMs === "number" && throttleMs > 0;
    // A poll during a cycle is already served by it; a user-driven request is kept for one more cycle.
    if (_state === S.SYNCING && !isPoll) { _resyncRequested = true; return; }
    // OFFLINE waits for the `online` event, which never fires on a device that stayed online (requests
    // that kept failing while connected) — any request retries from there instead.
    if (_state === S.OFFLINE && navigator.onLine) { dispatch({ type: "NET_RECOVERED" }); return; }
    if (_state !== S.IDLE) return;
    if (isPoll && _lastSyncEndAt > 0) {
      const elapsed = Date.now() - _lastSyncEndAt;
      if (elapsed < throttleMs) {
        L.log({ kind: "ACTION", event: "SYNC_THROTTLED", elapsedMs: elapsed, throttleMs });
        return;
      }
    }
    dispatch({ type: "SYNC_REQUEST" });
  }

  function getState()        { return _state; }
  function getToken()        { return _token; }
  function getEmail()        { return _email ?? localStorage.getItem(SYNC_EMAIL_KEY); }
  function isEnabled()       { return _state !== S.DISABLED && _state !== S.ERROR; }
  function isAuthenticated() { return !!_token; }

  // "파일도 삭제" disconnect (bookmark.js; drive-sync.js has already cleared what would outlive a page
  // closed mid-delete — the IDB refresh token, the sign-in flag, the account keys — and signOut() follows).
  // Resolves true when Drive holds no sync.json any more, false when that could not be confirmed, null
  // when there was nothing to do (not connected).
  //
  // Sync stops first and stays stopped: the token leaves `_token` — settings draws "연결" at once, no new
  // cycle can start, a running one stops at its next await (_leftSyncing) — and this waits for that cycle
  // (CYCLE_WAIT_MS at most — a hung request must not hold the sign-out) so a request it already sent has
  // landed: a create landing after the delete would put the file back. Every sync.json the lookup lists
  // is deleted, plus the cached file and any this page created (the listing may lag behind a create).
  // If the cycle did not settle in time, it waits once more and deletes again. A 401 gets one quiet
  // refresh with `refreshToken`. The token is revoked here, after the delete.
  /**
   * @param {{ refreshToken?: string | null }} [opts]
   * @returns {Promise<boolean | null>}
   */
  async function deleteRemoteFile({ refreshToken = null } = {}) {
    let token = _token;
    if (!token) return null;
    const cachedId = _loadCache().fileId;
    _stopSync({ type: "DELETE_REMOTE_FILE" });   // the cached file is about to go; a stopped cycle won't refill it

    let refreshed = false;
    /**
     * One quiet refresh on the first 401 — no state change; the new token is the one revoked below.
     * @template {{ status: number }} R
     * @param {(t: string) => Promise<R>} call
     * @returns {Promise<R>}
     */
    const withAuth = async (call) => {
      let res = await call(/** @type {string} */ (token));
      if (res.status === 401 && refreshToken && !refreshed) {
        refreshed = true;
        const resp = await T.refreshAccessToken(refreshToken, /** @type {string} */ (window._syncClientId));
        L.log({ kind: "ACTION", event: "DELETE_TOKEN_REFRESH", ok: resp.ok, ...(resp.ok ? {} : { status: resp.status }) });
        if (resp.ok) {
          if (token) T.revokeToken(token);   // the expired one — harmless, keeps nothing behind
          token = resp.access_token;
          res = await call(token);
        }
      }
      return res;
    };
    /** @type {string | null} why the delete could not be confirmed — reported as an ERROR entry */
    let unconfirmed = null;
    const deleteAll = async () => {
      const found = await withAuth((t) => T.findSyncFileId(t));
      L.log({ kind: "NETWORK", event: "DELETE_FIND_FILE", status: found.status, fileId: L.mask("fileId", found.fileId) });
      if (!_is2xx(found.status)) { unconfirmed = `lookup_http_${found.status}`; return false; }
      const ids = new Set(found.fileIds);
      if (cachedId) ids.add(cachedId);
      for (const id of _createdFileIds) ids.add(id);
      for (const id of ids) {
        const { ok, status } = await withAuth((t) => T.deleteSyncFile(t, id));
        L.log({ kind: "NETWORK", event: "DELETE_FILE", ok, status, fileId: L.mask("fileId", id) });
        if (!ok && status !== 404) { unconfirmed = `delete_http_${status}`; return false; }   // 404 — already gone
      }
      _createdFileIds.clear();
      return true;
    };

    let settled = await _settles(_cycleDone, CYCLE_WAIT_MS);
    let deleted = await deleteAll();
    if (deleted && !settled) {
      // The cycle's request may still land and create a file — wait once more, then look again.
      settled = await _settles(_cycleDone, CYCLE_WAIT_MS);
      if (!settled) unconfirmed = "cycle_still_running";
      deleted = settled && await deleteAll();
    }
    if (!deleted) L.log({ kind: "ERROR", event: "DELETE_UNCONFIRMED", reason: unconfirmed ?? "unknown" });
    T.revokeToken(token);
    return deleted;
  }

  /**
   * True when `p` settles within `ms`, false when the time runs out first (the timer is cleared either way).
   * @param {Promise<unknown>} p
   * @param {number} ms
   * @returns {Promise<boolean>}
   */
  function _settles(p, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      const done = () => { clearTimeout(timer); resolve(true); };
      p.then(done, done);
    });
  }

  return { enable, disable, requestSync, dispatch,
           acceptRedirectCode,
           getState, getToken, getEmail, isEnabled, isAuthenticated, deleteRemoteFile };
}

window.createSyncMachine = createSyncMachine;
window._syncScope = SCOPE;
window._syncRedirectAttemptsKey = REDIRECT_ATTEMPTS_KEY;

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
