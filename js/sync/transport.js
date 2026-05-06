// @ts-check
// ── Sync Transport ────────────────────────────────────────────────────────────
// Pure functions: no global state, token passed as argument.
// Each function returns structured results rather than throwing on HTTP errors,
// so callers (state machine) can decide how to handle each status code.

/** @typedef {import("../types").GsiTokenClient}         GsiTokenClient */
/** @typedef {import("../types").GsiTokenResponse}       GsiTokenResponse */
/** @typedef {import("../types").GsiCredentialResponse}  GsiCredentialResponse */
/** @typedef {import("../types").DriveFetchOptions}      DriveFetchOptions */
/** @typedef {import("../types").DriveFetchResult}       DriveFetchResult */
/** @typedef {import("../types").DriveDownloadResult}    DriveDownloadResult */
/** @typedef {import("../types").DriveUploadResult}      DriveUploadResult */
/** @typedef {import("../types").RedirectCallbackResult} RedirectCallbackResult */
/** @typedef {import("../types").SyncPayload}            SyncPayload */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// Hostnames that must bypass the service worker cache (Drive + OAuth).
/** @type {readonly string[]} */
const DRIVE_HOSTNAMES = [
  "www.googleapis.com",
  "content.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
];

// ── GIS wrappers ──────────────────────────────────────────────────────────────

/**
 * @param {string} clientId
 * @param {string} scope
 * @param {(resp: GsiTokenResponse) => void} onTokenResponse
 * @returns {GsiTokenClient | null}
 */
function initTokenClient(clientId, scope, onTokenResponse) {
  if (!window.google?.accounts?.oauth2) return null;
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    callback: onTokenResponse,
  });
}

/**
 * @param {GsiTokenClient | null} client
 * @param {string | null} emailHint
 */
function requestSilentToken(client, emailHint) {
  if (!client) return;
  /** @type {{ prompt: string; hint?: string }} */
  const opts = { prompt: "" };
  if (emailHint) opts.hint = emailHint;
  client.requestAccessToken(opts);
}

/** @param {GsiTokenClient | null} client */
function requestConsentToken(client) {
  if (!client) return;
  client.requestAccessToken({ prompt: "consent" });
}

/** @param {string | null} token */
function revokeToken(token) {
  if (!token || !window.google?.accounts?.oauth2) return;
  try { window.google.accounts.oauth2.revoke(token, () => {}); } catch (_) {}
}

// ── Identity client (FedCM / One Tap) ─────────────────────────────────────────
// Establishes user identity *without* opening a popup. iOS 17+ uses FedCM
// (browser-mediated, no popup); older platforms fall back to the Google One
// Tap UI which is rendered inline on the page rather than via window.open().
// Either way the iOS Safari popup-blocker prompt is never triggered.

/**
 * @param {string} clientId
 * @param {(resp: GsiCredentialResponse) => void} onIdToken
 * @returns {boolean}
 */
function initIdentityClient(clientId, onIdToken) {
  if (!window.google?.accounts?.id) return false;
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onIdToken(response),
    use_fedcm_for_prompt: true,
    auto_select: true,
    itp_support: true,
    cancel_on_tap_outside: false,
  });
  return true;
}

// Trigger silent identity prompt. We deliberately do NOT pass a callback —
// merely registering one makes GIS emit a FedCM-mandatory deprecation warning,
// regardless of which notification methods we touch. Success arrives via the
// credential callback set in initIdentityClient; failure (suppressed prompt,
// silent dismissal) is detected by the wall-clock timer in the state machine.
function promptIdentity() {
  if (!window.google?.accounts?.id) return;
  try { window.google.accounts.id.prompt(); } catch (_) { /* never throws */ }
}

function cancelIdentityPrompt() {
  if (!window.google?.accounts?.id) return;
  try { window.google.accounts.id.cancel(); } catch (_) {}
}

// ── iOS redirect-based OAuth ──────────────────────────────────────────────────
// Safari (any iOS version) does not support FedCM and blocks popup windows in
// PWA standalone mode even from user gestures. GIS Token Client is popup-only
// per Google docs ("only the popup UX is supported"), so iOS must bypass GIS
// entirely and use OAuth 2.0 Implicit Flow via full-page navigation.

const _REDIRECT_STATE_KEY = "bible-drive-redirect-state";
const _REDIRECT_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/** @returns {boolean} */
function isIOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/iPad/.test(ua)) return true;
  // iPadOS 13+ reports MacIntel UA but exposes touch.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

/** @returns {string} */
function _genNonce() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Begin OAuth implicit-flow redirect. Page navigates away immediately, so this
// returns void; never await it. Persists nonce + return URL in sessionStorage
// for the callback handler to validate.
/**
 * @param {string} clientId
 * @param {string} scope
 * @param {{ prompt?: string }} [opts]
 */
function beginRedirectAuth(clientId, scope, { prompt } = {}) {
  const nonce = _genNonce();
  const returnTo = location.pathname + location.search;
  // `silent` lets the callback handler distinguish app-open silent re-auth
  // (prompt=none) from explicit user-initiated consent flows. A silent
  // failure is expected (Google session expired / consent revoked) and
  // must not surface as a user-facing error toast.
  sessionStorage.setItem(_REDIRECT_STATE_KEY, JSON.stringify({
    nonce, returnTo, ts: Date.now(), flow: "implicit-v1",
    silent: prompt === "none",
  }));

  const params = new URLSearchParams({
    response_type: "token",
    client_id: clientId,
    redirect_uri: location.origin + "/",
    scope,
    state: nonce,
    include_granted_scopes: "true",
  });
  if (prompt) params.set("prompt", prompt);
  const hint = localStorage.getItem("bible-drive-sync-email");
  if (hint) params.set("login_hint", hint);

  // Use href (not replace) so back-navigation can return to the app.
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// Synchronous callback consumption — must run before routing reads location.
// Returns null if no callback hash, { ok: false, reason } on validation
// failure, or { ok: true, token, expiresIn, scope, returnTo } on success.
//
// Important: state nonce is verified BEFORE sessionStorage is consumed. A
// crafted URL like `#error=access_denied&state=anything` (no real OAuth
// initiation behind it) must not be able to clobber a legitimate in-flight
// OAuth state. Google echoes the state in both success and error responses,
// so requiring a match in both branches is correct per RFC 6749 §10.12.
/** @returns {RedirectCallbackResult | null} */
function consumeRedirectCallback() {
  const hash = location.hash;
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const hasToken = params.has("access_token");
  const hasError = params.has("error");
  if (!hasToken && !hasError) return null;

  const raw = sessionStorage.getItem(_REDIRECT_STATE_KEY);
  // No saved state → can't establish silent vs explicit. Treat as explicit
  // so the error surfaces to the user (this is the conservative default).
  if (!raw) return { ok: false, reason: "no_state", silent: false };

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    // Corrupted state — safe to discard (nothing to preserve).
    sessionStorage.removeItem(_REDIRECT_STATE_KEY);
    return { ok: false, reason: "bad_state", silent: false };
  }

  const silent = saved.silent === true;

  // Validate nonce BEFORE consuming. Mismatch → leave sessionStorage intact
  // so a real callback that arrives shortly after can still validate.
  const returnedState = params.get("state");
  if (!returnedState || returnedState !== saved.nonce) {
    return { ok: false, reason: "state_mismatch", silent };
  }

  // State matched — this is our callback. Now consume to prevent replay.
  sessionStorage.removeItem(_REDIRECT_STATE_KEY);

  // Error/expired branches still expose returnTo so the user lands back on
  // the chapter they were reading — only state_mismatch / no_state /
  // bad_state withhold it (state isn't trusted).
  const returnTo = saved.returnTo || "/";

  if (Date.now() - saved.ts > _REDIRECT_STATE_MAX_AGE_MS) {
    return { ok: false, reason: "state_expired", returnTo, silent };
  }

  if (hasError) return { ok: false, reason: params.get("error") ?? "unknown_error", returnTo, silent };

  const token = params.get("access_token");
  if (!token) return { ok: false, reason: "empty_token", returnTo, silent };

  return { ok: true, token, returnTo, silent };
}

// ── PKCE Authorization Code Flow (Phase 2i) ──────────────────────────────────
// Implements RFC 7636. Coexists with the implicit flow above during the
// migration; consumers select via a separate sessionStorage key so a callback
// can never be misrouted between flows.
//
// Flow:
//   1. generatePKCEPair() → {verifier, challenge} where challenge = b64url(SHA-256(verifier))
//   2. beginRedirectAuthPKCE() persists verifier+nonce, navigates to Google's
//      auth endpoint with code_challenge=<challenge>, response_type=code.
//   3. After Google redirects back with ?code=...&state=..., consumeRedirectCallbackPKCE()
//      validates nonce, returns {code, verifier, ...}.
//   4. exchangeCodeForToken(code, verifier) POSTs to /token endpoint, gets back
//      {access_token, refresh_token, expires_in}.
//   5. Later, refreshAccessToken(refreshToken) silently mints new access tokens
//      without any UI — handles refresh-token rotation when present.

const _REDIRECT_STATE_PKCE_KEY = "bible-drive-redirect-state-pkce";
const _OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const _OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

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
async function beginRedirectAuthPKCE(clientId, scope, { prompt } = {}) {
  const { verifier, challenge } = await generatePKCEPair();
  const nonce = _genNonce();
  const returnTo = location.pathname + location.search;
  sessionStorage.setItem(_REDIRECT_STATE_PKCE_KEY, JSON.stringify({
    nonce, verifier, returnTo, ts: Date.now(), flow: "pkce-v1",
    silent: prompt === "none",
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

  location.href = `${_OAUTH_AUTH_URL}?${params}`;
}

/**
 * Synchronous PKCE callback consumption — must run before routing reads
 * location. Code-flow callbacks arrive in the query string (?code=...&state=...),
 * unlike implicit-flow which uses fragment.
 *
 * Returns null if no PKCE callback in URL, validation result otherwise. The
 * code+verifier pair is single-use: caller must immediately POST them to the
 * token endpoint via exchangeCodeForToken.
 * @returns {import("../types").RedirectCallbackResultPKCE | null}
 */
function consumeRedirectCallbackPKCE() {
  const search = location.search;
  if (!search || search.length < 2) return null;
  const params = new URLSearchParams(search);
  const hasCode = params.has("code");
  const hasError = params.has("error");
  if (!hasCode && !hasError) return null;

  const raw = sessionStorage.getItem(_REDIRECT_STATE_PKCE_KEY);
  if (!raw) return { ok: false, reason: "no_state", silent: false };

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(_REDIRECT_STATE_PKCE_KEY);
    return { ok: false, reason: "bad_state", silent: false };
  }

  if (saved.flow !== "pkce-v1") return null; // not our callback
  const silent = saved.silent === true;

  const returnedState = params.get("state");
  if (!returnedState || returnedState !== saved.nonce) {
    return { ok: false, reason: "state_mismatch", silent };
  }

  // State matched — single-use consume.
  sessionStorage.removeItem(_REDIRECT_STATE_PKCE_KEY);
  const returnTo = saved.returnTo || "/";

  if (Date.now() - saved.ts > _REDIRECT_STATE_MAX_AGE_MS) {
    return { ok: false, reason: "state_expired", returnTo, silent };
  }

  if (hasError) return { ok: false, reason: params.get("error") ?? "unknown_error", returnTo, silent };

  const code = params.get("code");
  if (!code) return { ok: false, reason: "empty_code", returnTo, silent };
  if (typeof saved.verifier !== "string" || !saved.verifier) {
    return { ok: false, reason: "missing_verifier", returnTo, silent };
  }

  return { ok: true, code, verifier: saved.verifier, returnTo, silent };
}

/**
 * Exchange an authorization code for an access + refresh token pair. Called
 * once per sign-in (or re-consent). Never throws — returns a structured result.
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

// Decode the email claim from a Google ID token (JWT). Signature was already
// verified by GIS; we only need the payload's `email` claim as a login hint.
/**
 * @param {string | null | undefined} credential
 * @returns {{ email: string | null }}
 */
function parseIdToken(credential) {
  if (!credential || typeof credential !== "string") return { email: null };
  const parts = credential.split(".");
  if (parts.length < 2) return { email: null };
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "===".slice((b64.length + 3) % 4);
    const json = atob(padded);
    const payload = JSON.parse(decodeURIComponent(
      Array.from(json).map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
    ));
    return { email: payload.email ?? null };
  } catch { return { email: null }; }
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

// Returns the file ID of appDataFolder/sync.json, or null if not found.
/**
 * @param {string} token
 * @returns {Promise<string | null>}
 */
async function findSyncFileId(token) {
  try {
    const { res, ok } = await driveFetch(
      "/files?spaces=appDataFolder&fields=files(id)&q=name='sync.json'",
      { token }
    );
    if (!ok) return null;
    let data;
    try { data = await res.json(); } catch { return null; }
    return data.files?.[0]?.id ?? null;
  } catch { return null; }
}

// Returns { doc, etag } or { doc: null, etag: null } on any failure.
/**
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<DriveDownloadResult>}
 */
async function downloadSyncFile(token, fileId) {
  try {
    const { res, ok, etag } = await driveFetch(`/files/${fileId}?alt=media`, { token });
    if (!ok) return { doc: null, etag: null, status: res.status };
    let doc;
    try { doc = await res.json(); } catch { return { doc: null, etag: null }; }
    return { doc, etag, status: res.status };
  } catch { return { doc: null, etag: null, status: 0 }; }
}

// Returns { ok, status, etag }. Never throws.
// Pass ifMatch to send If-Match header; Drive returns 412 if ETag mismatches.
/**
 * @param {string} token
 * @param {SyncPayload} body
 * @param {{ fileId?: string; ifMatch?: string | null }} [opts]
 * @returns {Promise<DriveUploadResult>}
 */
async function uploadSyncFile(token, body, { fileId, ifMatch } = {}) {
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
      const meta = JSON.stringify({ name: "sync.json", parents: ["appDataFolder"] });
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

// Delete the sync file. Returns { ok }.
/**
 * @param {string} token
 * @param {string} fileId
 * @returns {Promise<{ ok: boolean }>}
 */
async function deleteSyncFile(token, fileId) {
  try {
    const { ok } = await driveFetch(`/files/${fileId}`, { token, method: "DELETE" });
    return { ok };
  } catch { return { ok: false }; }
}

window.syncTransport = {
  DRIVE_HOSTNAMES,
  initTokenClient,
  requestSilentToken,
  requestConsentToken,
  revokeToken,
  initIdentityClient,
  promptIdentity,
  cancelIdentityPrompt,
  parseIdToken,
  isIOS,
  beginRedirectAuth,
  consumeRedirectCallback,
  generatePKCEPair,
  beginRedirectAuthPKCE,
  consumeRedirectCallbackPKCE,
  exchangeCodeForToken,
  refreshAccessToken,
  fetchUserInfo,
  driveFetch,
  findSyncFileId,
  downloadSyncFile,
  uploadSyncFile,
  deleteSyncFile,
};
