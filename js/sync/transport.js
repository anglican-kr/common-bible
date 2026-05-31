// @ts-check
// ── Sync Transport ────────────────────────────────────────────────────────────
// Pure functions: no global state, token passed as argument.
// Each function returns structured results rather than throwing on HTTP errors,
// so callers (state machine) can decide how to handle each status code.
//
// Phase 2h 단계 4 이후 — OAuth는 PKCE Authorization Code 단일 경로.
// GIS Token Client / FedCM / Implicit Flow wrapper는 모두 제거됐다.

/** @typedef {import("../types").DriveFetchOptions}      DriveFetchOptions */
/** @typedef {import("../types").DriveFetchResult}       DriveFetchResult */
/** @typedef {import("../types").DriveDownloadResult}    DriveDownloadResult */
/** @typedef {import("../types").DriveUploadResult}      DriveUploadResult */
/** @typedef {import("../types").RedirectCallbackResult} RedirectCallbackResult */
/** @typedef {import("../types").SyncPayload}            SyncPayload */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const _OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
// Same-origin proxy. nginx (`location /oauth/token`) appends client_secret to
// the request body and forwards to https://oauth2.googleapis.com/token. This
// keeps client_secret out of the SPA bundle, git history, and GitHub's secret
// scanner — only the server has it.
const _OAUTH_TOKEN_URL = "/oauth/token";
const _OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Hostnames that must bypass the service worker cache (Drive + OAuth).
/** @type {readonly string[]} */
const DRIVE_HOSTNAMES = [
  "www.googleapis.com",
  "content.googleapis.com",
  "oauth2.googleapis.com",
];

// ── Platform detection ───────────────────────────────────────────────────────
// Kept because drive-sync / state-machine consumers still distinguish iOS for
// non-auth reasons (e.g. PWA install hints elsewhere). The PKCE redirect path
// is identical across platforms.

/** @returns {boolean} */
function isIOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/iPad/.test(ua)) return true;
  // iPadOS 13+ reports MacIntel UA but exposes touch.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

// ── PKCE Authorization Code Flow ─────────────────────────────────────────────
// Implements RFC 7636. All platforms (desktop, Android, iOS) share this path.
//
// Flow:
//   1. generatePKCEPair() → {verifier, challenge} where challenge = b64url(SHA-256(verifier))
//   2. beginRedirectAuth() persists verifier+nonce, navigates to Google's
//      auth endpoint with code_challenge=<challenge>, response_type=code.
//   3. After Google redirects back with ?code=...&state=..., consumeRedirectCallback()
//      validates nonce, returns {code, verifier, ...}.
//   4. exchangeCodeForToken(code, verifier) POSTs to /token endpoint, gets back
//      {access_token, refresh_token, expires_in}.
//   5. Later, refreshAccessToken(refreshToken) silently mints new access tokens
//      without any UI — handles refresh-token rotation when present.
//
// The sessionStorage key value retains the historical "-pkce" suffix so that
// any in-flight PKCE callback at the moment of a future deploy is still
// matched. The legacy "bible-drive-redirect-state" key (Implicit Flow,
// Phase 2f) was removed in Phase 2h step 4 along with consumeRedirectCallback's
// implicit-flow ancestor.

const _REDIRECT_STATE_KEY = "bible-drive-redirect-state-pkce";
const _REDIRECT_STATE_MAX_AGE_MS = 10 * 60 * 1000;

// Snapshot of session-history length taken right before the page navigates to
// Google. The state machine reads this after a successful callback to compute
// how many history entries the Google round trip added, so a single back-press
// from the app can jump directly to the page the user was on BEFORE clicking
// "연결". Held in its own key so consumeRedirectCallback's single-use cleanup
// of the OAuth state doesn't accidentally remove it.
const _BACK_NAV_KEY = "bible-drive-back-nav-context";

/** @returns {string} */
function _genNonce() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encode bytes as base64url-without-padding (RFC 4648 §5).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function _b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * @param {string} ascii
 * @returns {Promise<string>}
 */
async function _sha256Base64Url(ascii) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ascii));
  return _b64url(new Uint8Array(buf));
}

/**
 * Generate a fresh PKCE verifier/challenge pair. Verifier is 43 base64url
 * characters (32 random bytes), well within the RFC 7636 §4.1 length range
 * of 43-128.
 * @returns {Promise<{ verifier: string; challenge: string }>}
 */
async function generatePKCEPair() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const verifier = _b64url(buf);
  const challenge = await _sha256Base64Url(verifier);
  return { verifier, challenge };
}

/**
 * Begin OAuth 2.0 Authorization Code Flow with PKCE. Page navigates away
 * immediately; never await. Persists verifier + nonce + returnTo in
 * sessionStorage for the callback handler.
 * @param {string} clientId
 * @param {string} scope
 * @param {{ prompt?: string }} [opts]
 * @returns {Promise<void>}
 */
async function beginRedirectAuth(clientId, scope, { prompt } = {}) {
  const { verifier, challenge } = await generatePKCEPair();
  const nonce = _genNonce();
  const returnTo = location.pathname + location.search;
  sessionStorage.setItem(_REDIRECT_STATE_KEY, JSON.stringify({
    nonce, verifier, returnTo, ts: Date.now(), flow: "pkce-v1",
  }));
  // Capture history.length BEFORE the redirect so the post-callback back-nav
  // guard can compute "Google flow entry count" and jump past them in one
  // history.go() rather than absorbing back-presses indefinitely.
  sessionStorage.setItem(_BACK_NAV_KEY, JSON.stringify({
    historyLengthAtRedirect: history.length,
    ts: Date.now(),
  }));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: location.origin + "/",
    scope,
    state: nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    access_type: "offline",
  });
  if (prompt) params.set("prompt", prompt);
  const hint = localStorage.getItem("bible-drive-sync-email");
  if (hint) params.set("login_hint", hint);

  // Use href (not replace) so back-navigation can return to the app.
  location.href = `${_OAUTH_AUTH_URL}?${params}`;
}

// Synchronous PKCE callback consumption — must run before routing reads
// location. Code-flow callbacks arrive in the query string (?code=...&state=...).
//
// Returns null if no PKCE callback in URL, validation result otherwise. The
// code+verifier pair is single-use: caller must immediately POST them to the
// token endpoint via exchangeCodeForToken.
//
// Important: state nonce is verified BEFORE sessionStorage is consumed. A
// crafted URL like `?error=access_denied&state=anything` (no real OAuth
// initiation behind it) must not be able to clobber a legitimate in-flight
// OAuth state. Google echoes the state in both success and error responses,
// so requiring a match in both branches is correct per RFC 6749 §10.12.
/** @returns {RedirectCallbackResult | null} */
function consumeRedirectCallback() {
  const search = location.search;
  if (!search || search.length < 2) return null;
  const params = new URLSearchParams(search);
  const hasCode = params.has("code");
  const hasError = params.has("error");
  if (!hasCode && !hasError) return null;

  const raw = sessionStorage.getItem(_REDIRECT_STATE_KEY);
  // No saved state → can't validate; surface as error so callers can show
  // a clear message. (This branch only fires when ?code=... appears in URL
  // without our app having initiated the redirect — likely a stale link or
  // an attack attempt.)
  if (!raw) return { ok: false, reason: "no_state" };

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    // Corrupted state — safe to discard (nothing to preserve).
    sessionStorage.removeItem(_REDIRECT_STATE_KEY);
    return { ok: false, reason: "bad_state" };
  }

  if (saved.flow !== "pkce-v1") return null; // not our callback (forward-compat)

  // Validate nonce BEFORE consuming. Mismatch → leave sessionStorage intact
  // so a real callback that arrives shortly after can still validate.
  const returnedState = params.get("state");
  if (!returnedState || returnedState !== saved.nonce) {
    return { ok: false, reason: "state_mismatch" };
  }

  // State matched — single-use consume.
  sessionStorage.removeItem(_REDIRECT_STATE_KEY);
  const returnTo = saved.returnTo || "/";

  if (Date.now() - saved.ts > _REDIRECT_STATE_MAX_AGE_MS) {
    return { ok: false, reason: "state_expired", returnTo };
  }

  if (hasError) return { ok: false, reason: params.get("error") ?? "unknown_error", returnTo };

  const code = params.get("code");
  if (!code) return { ok: false, reason: "empty_code", returnTo };
  if (typeof saved.verifier !== "string" || !saved.verifier) {
    return { ok: false, reason: "missing_verifier", returnTo };
  }

  return { ok: true, code, verifier: saved.verifier, returnTo };
}

/**
 * Exchange an authorization code for an access + refresh token pair. Called
 * once per sign-in (or re-consent). Never throws — returns a structured result.
 *
 * Google's "Web application" OAuth client requires client_secret on /token
 * (RFC 7636 deviation). To keep the secret out of the SPA bundle and git
 * history, this POSTs to a same-origin nginx proxy at /oauth/token, which
 * injects client_secret server-side before forwarding to Google.
 *
 * @param {string} code
 * @param {string} verifier
 * @param {string} clientId
 * @returns {Promise<import("../types").TokenExchangeResponse>}
 */
async function exchangeCodeForToken(code, verifier, clientId) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: clientId,
    redirect_uri: location.origin + "/",
  });
  try {
    const res = await fetch(_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    /** @type {Record<string, unknown>} */
    let json;
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : "http_error",
      };
    }
    return {
      ok: true,
      access_token: typeof json.access_token === "string" ? json.access_token : "",
      refresh_token: typeof json.refresh_token === "string" ? json.refresh_token : "",
      expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
      scope: typeof json.scope === "string" ? json.scope : "",
    };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

/**
 * Mint a fresh access token from a stored refresh token. Google may rotate the
 * refresh token; if the response includes a new one we surface it so the
 * caller can persist the rotated value (failing to do so means the OLD token
 * stays valid for ~24h then breaks). If absent, the original refresh token
 * remains valid and the caller should NOT overwrite it.
 *
 * Posts to the same-origin /oauth/token proxy (see exchangeCodeForToken) which
 * injects client_secret server-side.
 *
 * @param {string} refreshToken
 * @param {string} clientId
 * @returns {Promise<import("../types").RefreshTokenResponse>}
 */
async function refreshAccessToken(refreshToken, clientId) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  try {
    const res = await fetch(_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    /** @type {Record<string, unknown>} */
    let json;
    try { json = await res.json(); } catch { json = {}; }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : "http_error",
      };
    }
    return {
      ok: true,
      access_token: typeof json.access_token === "string" ? json.access_token : "",
      // Only present when Google rotates — caller checks for non-null/non-empty.
      refresh_token: typeof json.refresh_token === "string" && json.refresh_token
        ? json.refresh_token : null,
      expires_in: typeof json.expires_in === "number" ? json.expires_in : 3600,
    };
  } catch {
    return { ok: false, status: 0, error: "network" };
  }
}

// Revoke an access (or refresh) token via Google's /revoke endpoint. Best
// effort — never throws. Used by signOut() for explicit credential cleanup.
/** @param {string | null} token */
function revokeToken(token) {
  if (!token) return;
  try {
    void fetch(`${_OAUTH_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }).catch(() => {});
  } catch (_) {}
}

// ── User info ─────────────────────────────────────────────────────────────────

// Returns { email } or { email: null } on failure.
/**
 * @param {string} token
 * @returns {Promise<{ email: string | null }>}
 */
async function fetchUserInfo(token) {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { email: null };
    const info = await r.json();
    return { email: info.email ?? null };
  } catch { return { email: null }; }
}

// ── Drive API primitives ──────────────────────────────────────────────────────

// Returns { res, status, ok, etag } — never throws on HTTP errors, only on
// network-level failures (no connection, timeout etc.).
/**
 * @param {string} path
 * @param {DriveFetchOptions} opts
 * @returns {Promise<DriveFetchResult>}
 */
async function driveFetch(path, { token, method = "GET", body, headers = {}, ifMatch } = /** @type {DriveFetchOptions} */ ({})) {
  /** @type {Record<string, string>} */
  const fetchHeaders = {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
  if (ifMatch) fetchHeaders["If-Match"] = ifMatch;
  /** @type {RequestInit} */
  const opts = { method, headers: fetchHeaders };
  if (body !== undefined && body !== null) opts.body = body;
  const res = await fetch(`${DRIVE_API}${path}`, opts);
  return {
    res,
    status: res.status,
    ok: res.ok,
    etag: res.headers.get("ETag") ?? null,
  };
}

// Returns the file ID of an appDataFolder file by name, or null if not found.
/**
 * @param {string} token
 * @param {string} name
 * @returns {Promise<string | null>}
 */
async function findFileId(token, name) {
  try {
    const { res, ok } = await driveFetch(
      `/files?spaces=appDataFolder&fields=files(id)&q=name='${encodeURIComponent(name)}'`,
      { token }
    );
    if (!ok) return null;
    let data;
    try { data = await res.json(); } catch { return null; }
    return data.files?.[0]?.id ?? null;
  } catch { return null; }
}

// List all appDataFolder files (id + name). Used by the notes layer (ADR-026)
// to reconcile per-note `note-<id>.json` files + the `notes-index.json`.
// Returns [] on any failure.
/**
 * @param {string} token
 * @returns {Promise<Array<{ id: string; name: string }>>}
 */
async function listFiles(token) {
  try {
    const { res, ok } = await driveFetch(
      "/files?spaces=appDataFolder&fields=files(id,name)&pageSize=1000",
      { token }
    );
    if (!ok) return [];
    let data;
    try { data = await res.json(); } catch { return []; }
    return Array.isArray(data.files) ? data.files : [];
  } catch { return []; }
}

// Returns { doc, etag, status } or nulls on failure. Generic over any JSON
// file (sync.json, notes-index.json, note-<id>.json). When `ifNoneMatch` is
// supplied, sends If-None-Match so Drive returns 304 with no body if unchanged.
/**
 * @param {string} token
 * @param {string} fileId
 * @param {{ ifNoneMatch?: string | null }} [opts]
 * @returns {Promise<DriveDownloadResult>}
 */
async function downloadFile(token, fileId, { ifNoneMatch } = {}) {
  try {
    /** @type {Record<string, string>} */
    const headers = {};
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    const { res, ok, etag, status } = await driveFetch(`/files/${fileId}?alt=media`, { token, headers });
    if (status === 304) return { doc: null, etag: null, status: 304 };
    if (!ok) return { doc: null, etag: null, status };
    let doc;
    try { doc = await res.json(); } catch { return { doc: null, etag: null, status }; }
    return { doc, etag, status };
  } catch { return { doc: null, etag: null, status: 0 }; }
}

// Generic upload. Create (multipart w/ name) when no fileId, else PATCH media.
// `name` is only used on the create path. Returns { ok, status, etag }.
/**
 * @param {string} token
 * @param {string} name
 * @param {unknown} body
 * @param {{ fileId?: string; ifMatch?: string | null }} [opts]
 * @returns {Promise<DriveUploadResult>}
 */
async function uploadFile(token, name, body, { fileId, ifMatch } = {}) {
  const bodyStr = JSON.stringify(body);
  try {
    /** @type {Response} */
    let res;
    /** @type {string | null} */
    let etag;
    if (fileId) {
      /** @type {Record<string, string>} */
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
      if (ifMatch) headers["If-Match"] = ifMatch;
      res = await fetch(`${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers,
        body: bodyStr,
      });
      etag = res.headers.get("ETag");
    } else {
      const meta = JSON.stringify({ name, parents: ["appDataFolder"] });
      const form = new FormData();
      form.append("metadata", new Blob([meta], { type: "application/json" }));
      form.append("file", new Blob([bodyStr], { type: "application/json" }));
      res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      etag = res.headers.get("ETag");
    }
    return { ok: res.ok, status: res.status, etag: etag ?? null };
  } catch { return { ok: false, status: 0, etag: null }; }
}

// Delete a Drive file by ID. Returns { ok }.
/**
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<{ ok: boolean }>}
 */
async function deleteFile(token, fileId) {
  try {
    const { ok } = await driveFetch(`/files/${fileId}`, { token, method: "DELETE" });
    return { ok };
  } catch { return { ok: false }; }
}

// ── sync.json wrappers (bookmarks/settings, ADR-011) ──
// Thin name-bound wrappers over the generic file ops so the state machine and
// transport.test.js keep their stable surface.

/** @param {string} token @returns {Promise<string | null>} */
function findSyncFileId(token) { return findFileId(token, "sync.json"); }

/**
 * @param {string} token
 * @param {string} fileId
 * @param {{ ifNoneMatch?: string | null }} [opts]
 * @returns {Promise<DriveDownloadResult>}
 */
function downloadSyncFile(token, fileId, opts) { return downloadFile(token, fileId, opts); }

/**
 * @param {string} token
 * @param {SyncPayload} body
 * @param {{ fileId?: string; ifMatch?: string | null }} [opts]
 * @returns {Promise<DriveUploadResult>}
 */
function uploadSyncFile(token, body, opts) { return uploadFile(token, "sync.json", body, opts); }

/** @param {string} token @param {string} fileId @returns {Promise<{ ok: boolean }>} */
function deleteSyncFile(token, fileId) { return deleteFile(token, fileId); }

window.syncTransport = {
  DRIVE_HOSTNAMES,
  isIOS,
  generatePKCEPair,
  beginRedirectAuth,
  consumeRedirectCallback,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  fetchUserInfo,
  driveFetch,
  findSyncFileId,
  downloadSyncFile,
  uploadSyncFile,
  deleteSyncFile,
  // Generic file ops (ADR-026 notes layer).
  findFileId,
  listFiles,
  downloadFile,
  uploadFile,
  deleteFile,
};

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
