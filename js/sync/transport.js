// ── Sync Transport ────────────────────────────────────────────────────────────
// Pure functions: no global state, token passed as argument.
// Each function returns structured results rather than throwing on HTTP errors,
// so callers (state machine) can decide how to handle each status code.

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

// Hostnames that must bypass the service worker cache (Drive + OAuth).
const DRIVE_HOSTNAMES = [
  "www.googleapis.com",
  "content.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
];

// ── GIS wrappers ──────────────────────────────────────────────────────────────

function initTokenClient(clientId, scope, onTokenResponse) {
  if (!window.google?.accounts?.oauth2) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope,
    callback: onTokenResponse,
  });
}

function requestSilentToken(client, emailHint) {
  if (!client) return;
  const opts = { prompt: "" };
  if (emailHint) opts.hint = emailHint;
  client.requestAccessToken(opts);
}

function requestConsentToken(client) {
  if (!client) return;
  client.requestAccessToken({ prompt: "consent" });
}

function revokeToken(token) {
  if (!token || !window.google?.accounts?.oauth2) return;
  try { google.accounts.oauth2.revoke(token, () => {}); } catch (_) {}
}

// ── Identity client (FedCM / One Tap) ─────────────────────────────────────────
// Establishes user identity *without* opening a popup. iOS 17+ uses FedCM
// (browser-mediated, no popup); older platforms fall back to the Google One
// Tap UI which is rendered inline on the page rather than via window.open().
// Either way the iOS Safari popup-blocker prompt is never triggered.

function initIdentityClient(clientId, onIdToken) {
  if (!window.google?.accounts?.id) return false;
  google.accounts.id.initialize({
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
  try { google.accounts.id.prompt(); } catch (_) { /* never throws */ }
}

function cancelIdentityPrompt() {
  if (!window.google?.accounts?.id) return;
  try { google.accounts.id.cancel(); } catch (_) {}
}

// ── iOS redirect-based OAuth ──────────────────────────────────────────────────
// Safari (any iOS version) does not support FedCM and blocks popup windows in
// PWA standalone mode even from user gestures. GIS Token Client is popup-only
// per Google docs ("only the popup UX is supported"), so iOS must bypass GIS
// entirely and use OAuth 2.0 Implicit Flow via full-page navigation.

const _REDIRECT_STATE_KEY = "bible-drive-redirect-state";
const _REDIRECT_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function isIOS() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/.test(ua)) return true;
  if (/iPad/.test(ua)) return true;
  // iPadOS 13+ reports MacIntel UA but exposes touch.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return true;
  return false;
}

function _genNonce() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Begin OAuth implicit-flow redirect. Page navigates away immediately, so this
// returns void; never await it. Persists nonce + return URL in sessionStorage
// for the callback handler to validate.
function beginRedirectAuth(clientId, scope, { prompt } = {}) {
  const nonce = _genNonce();
  const returnTo = location.pathname + location.search;
  sessionStorage.setItem(_REDIRECT_STATE_KEY, JSON.stringify({
    nonce, returnTo, ts: Date.now(), flow: "implicit-v1",
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
function consumeRedirectCallback() {
  const hash = location.hash;
  if (!hash || hash.length < 2) return null;
  const params = new URLSearchParams(hash.slice(1));
  const hasToken = params.has("access_token");
  const hasError = params.has("error");
  if (!hasToken && !hasError) return null;

  const raw = sessionStorage.getItem(_REDIRECT_STATE_KEY);
  if (!raw) return { ok: false, reason: "no_state" };

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    // Corrupted state — safe to discard (nothing to preserve).
    sessionStorage.removeItem(_REDIRECT_STATE_KEY);
    return { ok: false, reason: "bad_state" };
  }

  // Validate nonce BEFORE consuming. Mismatch → leave sessionStorage intact
  // so a real callback that arrives shortly after can still validate.
  const returnedState = params.get("state");
  if (!returnedState || returnedState !== saved.nonce) {
    return { ok: false, reason: "state_mismatch" };
  }

  // State matched — this is our callback. Now consume to prevent replay.
  sessionStorage.removeItem(_REDIRECT_STATE_KEY);

  // Error/expired branches still expose returnTo so the user lands back on
  // the chapter they were reading — only state_mismatch / no_state /
  // bad_state withhold it (state isn't trusted).
  const returnTo = saved.returnTo || "/";

  if (Date.now() - saved.ts > _REDIRECT_STATE_MAX_AGE_MS) {
    return { ok: false, reason: "state_expired", returnTo };
  }

  if (hasError) return { ok: false, reason: params.get("error"), returnTo };

  const token = params.get("access_token");
  if (!token) return { ok: false, reason: "empty_token", returnTo };

  return {
    ok: true,
    token,
    expiresIn: parseInt(params.get("expires_in") ?? "3600", 10),
    scope: params.get("scope"),
    returnTo,
  };
}

// Decode the email claim from a Google ID token (JWT). Signature was already
// verified by GIS; we only need the payload's `email` claim as a login hint.
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
async function driveFetch(path, { token, method = "GET", body, headers = {}, ifMatch } = {}) {
  const fetchHeaders = {
    Authorization: `Bearer ${token}`,
    ...headers,
  };
  if (ifMatch) fetchHeaders["If-Match"] = ifMatch;
  const opts = { method, headers: fetchHeaders };
  if (body !== undefined) opts.body = body;
  const res = await fetch(`${DRIVE_API}${path}`, opts);
  return {
    res,
    status: res.status,
    ok: res.ok,
    etag: res.headers.get("ETag") ?? null,
  };
}

// Returns the file ID of appDataFolder/sync.json, or null if not found.
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
async function uploadSyncFile(token, body, { fileId, ifMatch } = {}) {
  const bodyStr = JSON.stringify(body);
  try {
    let res, etag;
    if (fileId) {
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
  fetchUserInfo,
  driveFetch,
  findSyncFileId,
  downloadSyncFile,
  uploadSyncFile,
  deleteSyncFile,
};
