// ── Common Bible PWA — Sync Layer Types ──────────────────────────────────────
// Type definitions for js/sync/* and js/drive-sync.js. Domain types are
// exported (importable via JSDoc `@typedef {import("../types").Foo} Foo`),
// while runtime singletons attached to `window.*` are augmented onto the
// global Window interface so that `window.syncTransport.X()` is type-safe
// from any caller.
//
// Style: pragmatic over precise. Where a shape is genuinely fluid (legacy
// localStorage values), we lean on broader unions rather than exhaustive
// overloads.
//
// Phase 2h 단계 4 이후 — GIS/Implicit Flow 관련 타입 (GsiTokenClient,
// GsiCredentialResponse, GoogleIdentityServices 등)은 모두 제거됐다.

// ── MTimed wrapper (per-record mtime) ────────────────────────────────────────

export type MTimed<T> = { v: T | null; _u: number };

// ── Bookmark / Folder shapes ─────────────────────────────────────────────────
// Two views: tree form (used at app.js boundary) and flat-map form (used
// inside store-v2 and on the wire).

export interface BookmarkTreeBookmark {
  id: string;
  type: "bookmark";
  bookId?: string;
  chapter?: number;
  vref?: string;
  verseSpec?: string;
  color?: string;
  label?: string;
  note?: string;
  name?: string;
  createdAt?: number;
  children?: BookmarkTreeNode[];
}

export interface BookmarkTreeFolder {
  id: string;
  type: "folder";
  name: string;
  expanded?: boolean;
  children: BookmarkTreeNode[];
}

export type BookmarkTreeNode = BookmarkTreeBookmark | BookmarkTreeFolder;

// Flat-map form: every node has positional metadata. `type` left as union
// rather than discriminated because store-v2 manipulates these uniformly.
export interface SyncFlatItem {
  id: string;
  type: "bookmark" | "folder";
  name?: string;
  bookId?: string;
  chapter?: number;
  vref?: string;
  verseSpec?: string;
  color?: string;
  label?: string;
  note?: string;
  createdAt?: number;
  expanded?: boolean;
  parentId: string | null;
  _order: number;
  _u: number;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export type SettingKey =
  | "fontSize"
  | "colorScheme"
  | "theme"
  | "bookOrder"
  | "startupBehavior";

// Per-setting value type. All settings store one MTimed wrapper; the inner
// value type is intentionally `unknown` so that store-v2 can index by a
// dynamic SettingKey without TS computing an intersection of mismatched
// MTimed<T> instantiations. Caller-side narrowing happens at apply-time
// (applyFontSize / applyTheme / etc.).
export type SyncSettingValue = MTimed<unknown>;

export type SyncSettings = Record<SettingKey, SyncSettingValue>;

export interface LastReadValue {
  bookId: string;
  chapter: number;
  verseSpec?: string;
}

// ── Sync document (canonical shape, both local and remote) ───────────────────

export interface SyncDoc {
  bookmarks: {
    items: { [id: string]: SyncFlatItem };
    tombstones: { [id: string]: number };
  };
  settings: SyncSettings;
  lastRead: MTimed<LastReadValue>;
  schemaVersion?: 2;
  deviceId?: string;
}

// Outgoing payload always includes schemaVersion + deviceId.
export interface SyncPayload extends SyncDoc {
  schemaVersion: 2;
  deviceId: string;
}

// ── State machine ────────────────────────────────────────────────────────────
// Phase 2h 단계 4: GIS와 묶여있던 INITIALIZING/IDENTIFYING/AUTHENTICATING 제거.

export type SyncState =
  | "DISABLED"
  | "IDLE"
  | "SYNCING"
  | "OFFLINE"
  | "NEEDS_CONSENT"
  | "ERROR";

export type SyncEvent =
  | { type: "ENABLE" }
  | { type: "DISABLE" }
  | { type: "USER_CONSENT_REQUEST" }
  | { type: "SYNC_REQUEST" }
  | { type: "SYNC_DONE" }
  | { type: "SYNC_FAIL"; reason: string }
  | { type: "NET_RECOVERED" }
  // Internal "tag" events used only for transition logging — never dispatched
  // through the public API but still reach _transition's `event` parameter.
  | { type: "REDIRECT_CAP" }
  | { type: "REDIRECT_CODE_RECEIVED" }
  | { type: "REDIRECT_CODE_ACCEPTED" }
  | { type: "CODE_EXCHANGE_FAIL" }
  | { type: "SILENT_REFRESH_OK" }
  | { type: "SILENT_REFRESH_INVALID" }
  | { type: "SILENT_REFRESH_NET_FAIL" }
  | { type: "ENABLE_NO_REFRESH_TOKEN" }
  | { type: "NET_RECOVERED_NO_TOKEN" };

export interface SyncMachineCtx {
  netFails: number;
  conflictFails: number;
  reAuthFails: number;
  backoffTimer: ReturnType<typeof setTimeout> | null;
}

export interface SyncMachine {
  enable: () => void;
  disable: () => void;
  requestSync: () => void;
  dispatch: (event: SyncEvent) => void;
  // PKCE entry: drive-sync.js IIFE stashes {code, verifier} from a redirect
  // callback; initDriveSync hands them off here. Exchanges for access+refresh
  // tokens, persists refresh to IndexedDB, transitions to IDLE.
  acceptRedirectCode: (code: string, verifier: string) => Promise<void>;
  getState: () => SyncState;
  getToken: () => string | null;
  getEmail: () => string | null;
  isEnabled: () => boolean;
  isAuthenticated: () => boolean;
  deleteRemoteFile: () => Promise<void>;
}

// ── Transport (Drive REST + PKCE OAuth) ──────────────────────────────────────

export interface DriveFetchOptions {
  token: string;
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  ifMatch?: string | null;
}

export interface DriveFetchResult {
  res: Response;
  status: number;
  ok: boolean;
  etag: string | null;
}

export interface DriveDownloadResult {
  doc: SyncDoc | null;
  etag: string | null;
  status?: number;
}

export interface DriveUploadResult {
  ok: boolean;
  status: number;
  etag: string | null;
}

// PKCE Authorization Code callback. Success branch carries the auth code and
// PKCE verifier for the follow-up POST to /token.
export type RedirectCallbackResult =
  | { ok: true; code: string; verifier: string; returnTo: string }
  | { ok: false; reason: string; returnTo?: string };

// /token endpoint responses for the two grant types we use.
// Failure path is structured so callers can branch on `status` / `error`
// without throwing.
export type TokenExchangeResponse =
  | {
      ok: true;
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
    }
  | { ok: false; status: number; error: string };

export type RefreshTokenResponse =
  | {
      ok: true;
      access_token: string;
      // null when Google did NOT rotate — caller must keep the existing
      // refresh token in storage rather than overwriting it.
      refresh_token: string | null;
      expires_in: number;
    }
  | { ok: false; status: number; error: string };

export interface SyncTransport {
  DRIVE_HOSTNAMES: readonly string[];
  isIOS: () => boolean;
  // PKCE Authorization Code Flow
  generatePKCEPair: () => Promise<{ verifier: string; challenge: string }>;
  beginRedirectAuth: (
    clientId: string,
    scope: string,
    opts?: { prompt?: string },
  ) => Promise<void>;
  consumeRedirectCallback: () => RedirectCallbackResult | null;
  exchangeCodeForToken: (
    code: string,
    verifier: string,
    clientId: string,
  ) => Promise<TokenExchangeResponse>;
  refreshAccessToken: (
    refreshToken: string,
    clientId: string,
  ) => Promise<RefreshTokenResponse>;
  revokeToken: (token: string | null) => void;
  fetchUserInfo: (token: string) => Promise<{ email: string | null }>;
  driveFetch: (path: string, opts: DriveFetchOptions) => Promise<DriveFetchResult>;
  findSyncFileId: (token: string) => Promise<string | null>;
  downloadSyncFile: (token: string, fileId: string) => Promise<DriveDownloadResult>;
  uploadSyncFile: (
    token: string,
    body: SyncPayload,
    opts?: { fileId?: string; ifMatch?: string | null },
  ) => Promise<DriveUploadResult>;
  deleteSyncFile: (token: string, fileId: string) => Promise<{ ok: boolean }>;
}

// ── Refresh Token Store (Phase 2h 단계 1) ────────────────────────────────────
// AES-GCM encrypted IndexedDB persistence for OAuth refresh tokens.

export interface RefreshTokenStore {
  saveRefreshToken: (plain: string) => Promise<void>;
  loadRefreshToken: () => Promise<string | null>;
  clearRefreshToken: () => Promise<void>;
}

// ── Audio cache LRU sidecar (ADR-016) ────────────────────────────────────────
// IndexedDB-backed metadata for AUDIO_CACHE (sw.js). Cache API does not
// expose access time, so we record byteSize/lastPlayedAt/addedAt here and
// drive LRU eviction from both SW (hard cap on put) and page (soft cap on
// visibilitychange).

export interface AudioCacheEntry {
  url: string;
  byteSize: number;
  addedAt: number;
  // null = received but never played; sorted before any non-null entries
  // when picking eviction candidates (ADR-016 §D).
  lastPlayedAt: number | null;
}

export interface BibleAudioCache {
  recordEntry: (url: string, byteSize: number) => Promise<void>;
  touch: (url: string) => Promise<void>;
  totalSize: () => Promise<number>;
  pickEvictions: (targetCap: number) => Promise<{ urls: string[]; freedBytes: number }>;
  removeEntries: (urls: string[]) => Promise<void>;
  AUDIO_CACHE_NAME: string;
  SOFT_CAP: number;
  HARD_CAP: number;
  _listAll: () => Promise<AudioCacheEntry[]>;
}

// ── Store v2 ─────────────────────────────────────────────────────────────────

export interface SyncStoreV2 {
  getDeviceId: () => string;
  loadLocal: () => SyncDoc;
  saveLocal: (doc: SyncDoc) => void;
  sweepTombstones: (ageDays?: number) => void;
  loadBookmarks: () => BookmarkTreeNode[];
  saveBookmarks: (tree: BookmarkTreeNode[]) => void;
  saveSetting: (key: SettingKey, value: unknown) => void;
  saveLastRead: (value: LastReadValue) => void;
  migrateLegacyIfNeeded: () => void;
  mergeDocs: (local: SyncDoc, remote: SyncDoc, deviceId: string) => SyncDoc;
  maxU: (doc: SyncDoc) => number;
  buildSyncPayload: (deviceId: string) => SyncPayload;
  validateRemote: (data: unknown) => boolean;
  bookmarkTreeFromFlat: (items: { [id: string]: SyncFlatItem }) => BookmarkTreeNode[];
  applyToLegacyKeys: (doc: SyncDoc) => void;
}

// ── Debug log ────────────────────────────────────────────────────────────────

export type SyncLogKind = "TRANSITION" | "ACTION" | "NETWORK" | "ERROR";

export interface SyncLogEntry {
  kind: SyncLogKind;
  event?: string;
  // Free-form fields tolerated; extras are spread into the entry. Typed as
  // `any` (not `unknown`) so callers and `_format` can interpolate fields
  // into template literals without explicit casts at every site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export type SyncLogMaskField = "token" | "email" | "fileId" | "etag" | "payload" | string;

export interface SyncDebugLog {
  log: (entry: SyncLogEntry) => void;
  mask: (field: SyncLogMaskField, value: unknown) => string | null | undefined;
  dump: () => string;
  copyToClipboard: () => Promise<boolean>;
}

// ── Drive sync facade (drive-sync.js) ────────────────────────────────────────

export interface DriveSyncFacade {
  initDriveSync: () => void;
  signIn: () => void;
  signOut: () => void;
  deleteRemoteFile: () => Promise<void>;
  scheduleUpload: () => void;
  isEnabled: () => boolean;
  isAuthenticated: () => boolean;
  getUserEmail: () => string | null;
  getStatus: () => SyncState;
}

// ── Window augmentation ──────────────────────────────────────────────────────

declare global {
  interface Window {
    // Sync layer singletons (set by their respective modules at load time).
    syncTransport: SyncTransport;
    syncStoreV2: SyncStoreV2;
    syncDebugLog: SyncDebugLog;
    refreshStore: RefreshTokenStore;
    bibleAudioCache: BibleAudioCache;
    createSyncMachine: (opts?: {
      onStateChange?: (state: SyncState) => void;
    }) => SyncMachine;
    driveSync: DriveSyncFacade;

    // Cross-module globals set by drive-sync.js / state-machine.js.
    _syncClientId?: string;
    _syncScope?: string;
    _syncRedirectAttemptsKey?: string;
    // PKCE callback stash — populated by the IIFE in drive-sync.js, consumed
    // by initDriveSync().
    __pendingRedirectCode?: { code: string; verifier: string };
    __pendingRedirectError?: string;

    // UI side-effects defined in app.js. Optional because state-machine.js
    // guards each call with `typeof ... === "function"`.
    rebuildDriveSyncSection?: () => void;
    _showSyncSnackbar?: (msg: string) => void;
    renderBookmarkTree?: () => void;
    applyFontSize?: (size: number | string) => void;
    applyColorScheme?: (scheme: string) => void;
    applyTheme?: (theme: string) => void;
  }
}
