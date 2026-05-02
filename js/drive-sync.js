const CLIENT_ID = location.hostname === "localhost"
  ? "359209354241-esbmeba2ku58depo9fgg08v52crfthot.apps.googleusercontent.com"
  : "359209354241-do8kgvtcbnfvrge01f5hj29fee9cg195.apps.googleusercontent.com";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata email";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SYNC_ENABLED_KEY = "bible-drive-sync";
const SYNC_UPDATED_KEY = "bible-drive-sync-updated";
const SYNC_EMAIL_KEY = "bible-drive-sync-email";

let _accessToken = null; // memory-only: no localStorage to prevent XSS token theft
let _userEmail = null;
let _tokenClient = null;
let _uploadTimer = null;
let _initRetryCount = 0;
let _isRefreshing = false;

// ── Helpers ──────────────────────────────────────────────────────────────────

function _buildSyncPayload() {
  const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  return {
    version: 1,
    updatedAt: Date.now(),
    bookmarks: get("bible-bookmarks") ?? [],
    settings: {
      fontSize: get("bible-font-size"),
      colorScheme: get("bible-color-scheme"),
      theme: get("bible-theme"),
      bookOrder: get("bible-book-order"),
      startupBehavior: get("bible-startup"),
    },
    lastRead: get("bible-last-read"),
  };
}

async function _driveRequest(path, options = {}) {
  if (!_accessToken) throw new Error("not authenticated");
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${_accessToken}`, ...options.headers },
  });
  if (res.status === 401) {
    _accessToken = null;
    _updateSettingsUI();
    // Attempt silent re-auth; guard with _isRefreshing to prevent concurrent 401s
    // from triggering multiple re-auth requests and racing _downloadAndMerge calls.
    if (!_isRefreshing && localStorage.getItem(SYNC_ENABLED_KEY) === "1") {
      _isRefreshing = true;
      _silentSignIn();
    }
    throw new Error("token expired");
  }
  return res;
}

async function _findSyncFileId() {
  const res = await _driveRequest(
    "/files?spaces=appDataFolder&fields=files(id)&q=name='sync.json'"
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

// ── Upload / Download ─────────────────────────────────────────────────────────

async function _upload() {
  if (!_accessToken) return;
  const body = JSON.stringify(_buildSyncPayload());
  const fileId = await _findSyncFileId();

  if (fileId) {
    // Update existing file
    await fetch(`${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${_accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } else {
    // Create new file in appDataFolder
    const meta = JSON.stringify({ name: "sync.json", parents: ["appDataFolder"] });
    const form = new FormData();
    form.append("metadata", new Blob([meta], { type: "application/json" }));
    form.append("file", new Blob([body], { type: "application/json" }));
    await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
      method: "POST",
      headers: { Authorization: `Bearer ${_accessToken}` },
      body: form,
    });
  }
  localStorage.setItem(SYNC_UPDATED_KEY, String(Date.now()));
}

async function _downloadAndMerge() {
  if (!_accessToken) return;
  const fileId = await _findSyncFileId();
  if (!fileId) {
    // No remote data — upload current local state
    await _upload();
    return;
  }

  const res = await _driveRequest(`/files/${fileId}?alt=media`);
  if (!res.ok) return;
  let remote;
  try { remote = await res.json(); } catch { return; }

  const localUpdatedAt = Number(localStorage.getItem(SYNC_UPDATED_KEY) ?? 0);
  if (remote.updatedAt <= localUpdatedAt) {
    // Local is newer or equal — push to Drive
    await _upload();
    return;
  }

  // Remote is newer — apply to local
  _applyRemote(remote);
  localStorage.setItem(SYNC_UPDATED_KEY, String(remote.updatedAt));
  _showSnackbar("다른 기기에서 변경된 데이터를 불러왔습니다.");
}

function _validateRemote(data) {
  if (typeof data !== "object" || data === null) return false;
  if (data.version !== 1) return false;
  if (!Array.isArray(data.bookmarks)) return false;
  return true;
}

function _applyRemote(data) {
  if (!_validateRemote(data)) return;
  if (data.bookmarks !== undefined) {
    localStorage.setItem("bible-bookmarks", JSON.stringify(data.bookmarks));
    if (typeof window.loadBookmarks === "function" && typeof window.renderBookmarkTree === "function") {
      window.renderBookmarkTree();
    }
  }
  const s = data.settings ?? {};
  if (s.fontSize != null) { localStorage.setItem("bible-font-size", s.fontSize); if (typeof window.applyFontSize === "function") window.applyFontSize(s.fontSize); }
  if (s.colorScheme != null) { localStorage.setItem("bible-color-scheme", s.colorScheme); if (typeof window.applyColorScheme === "function") window.applyColorScheme(s.colorScheme); }
  if (s.theme != null) { localStorage.setItem("bible-theme", s.theme); if (typeof window.applyTheme === "function") window.applyTheme(s.theme); }
  if (s.bookOrder != null) { localStorage.setItem("bible-book-order", s.bookOrder); }
  if (s.startupBehavior != null) { localStorage.setItem("bible-startup", s.startupBehavior); }
  if (data.lastRead != null) { localStorage.setItem("bible-last-read", JSON.stringify(data.lastRead)); }
}

function _showSnackbar(msg) {
  const el = document.createElement("div");
  el.textContent = msg;
  el.style.cssText = "position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--popover-bg,#323232);color:var(--text,#fff);border:1px solid var(--border,transparent);padding:12px 20px;border-radius:8px;font-size:14px;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.25);";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function _onTokenResponse(resp) {
  _isRefreshing = false;
  if (resp.error) {
    console.warn("[drive-sync] token error:", resp.error);
    // Only notify on explicit user action (consent prompt), not on silent re-auth attempts.
    if (resp.error !== "user_cancel" && localStorage.getItem(SYNC_ENABLED_KEY) === "1") {
      _showSnackbar("Google Drive 동기화 세션이 만료됐습니다. 설정에서 재연결해 주세요.");
      localStorage.setItem(SYNC_ENABLED_KEY, "0");
      _updateSettingsUI();
    }
    return;
  }
  _accessToken = resp.access_token;
  localStorage.setItem(SYNC_ENABLED_KEY, "1");
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${_accessToken}` },
    });
    const info = await r.json();
    _userEmail = info.email ?? null;
    if (_userEmail) localStorage.setItem(SYNC_EMAIL_KEY, _userEmail);
  } catch (_) {
    _userEmail = null;
  }
  _updateSettingsUI();
  _downloadAndMerge();
}

function _initTokenClient() {
  if (!window.google?.accounts?.oauth2) return;
  _tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: _onTokenResponse,
  });
}

function _silentSignIn() {
  if (!_tokenClient) return;
  const hint = localStorage.getItem(SYNC_EMAIL_KEY) ?? undefined;
  // prompt:"" = no UI; returns token silently if previously authorized, error if not
  _tokenClient.requestAccessToken({ prompt: "", ...(hint ? { hint } : {}) });
}

// ── Public API ────────────────────────────────────────────────────────────────

function initDriveSync() {
  if (!window.google) {
    // GIS not loaded yet — retry up to 20 times (10 s) then give up silently.
    if (_initRetryCount++ < 20) setTimeout(initDriveSync, 500);
    return;
  }
  _initTokenClient();
  if (localStorage.getItem(SYNC_ENABLED_KEY) === "1") {
    _silentSignIn();
  }
}

function signIn() {
  if (!_tokenClient) _initTokenClient();
  if (!_tokenClient) return;
  _tokenClient.requestAccessToken({ prompt: "consent" });
}

function signOut() {
  if (_accessToken) {
    google.accounts.oauth2.revoke(_accessToken);
    _accessToken = null;
  }
  _userEmail = null;
  localStorage.removeItem(SYNC_EMAIL_KEY);
  localStorage.setItem(SYNC_ENABLED_KEY, "0");
  _updateSettingsUI();
}

function scheduleUpload() {
  if (!_accessToken) return;
  clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(_upload, 300);
}

function isEnabled() {
  return localStorage.getItem(SYNC_ENABLED_KEY) === "1";
}

function isAuthenticated() {
  return !!_accessToken;
}

function getUserEmail() {
  return _userEmail ?? localStorage.getItem(SYNC_EMAIL_KEY);
}

function _updateSettingsUI() {
  if (typeof window.rebuildDriveSyncSection === "function") {
    window.rebuildDriveSyncSection();
  }
}

window.driveSync = { initDriveSync, signIn, signOut, scheduleUpload, isEnabled, isAuthenticated, getUserEmail };
