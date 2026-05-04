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
    try { doc = await res.json(); } catch { return { doc: null, etag: null, status: res.status }; }
    return { doc, etag, status: res.status };
  } catch { return { doc: null, etag: null }; }
}

// Returns { ok, status, etag }. Never throws.
async function uploadSyncFile(token, body, { fileId } = {}) {
  const bodyStr = JSON.stringify(body);
  try {
    let res, etag;
    if (fileId) {
      res = await fetch(`${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
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
  fetchUserInfo,
  driveFetch,
  findSyncFileId,
  downloadSyncFile,
  uploadSyncFile,
  deleteSyncFile,
};
