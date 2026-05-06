// ── Common Bible PWA — Sync Layer Types ──────────────────────────────────────
// Type definitions for js/sync/* and js/drive-sync.js. Domain types are
// exported (importable via JSDoc `@typedef {import("../types").Foo} Foo`),
// while runtime singletons attached to `window.*` are augmented onto the
// global Window interface so that `window.syncTransport.X()` is type-safe
// from any caller.
//
// Style: pragmatic over precise. Where a shape is genuinely fluid (legacy
// localStorage values, GIS responses), we lean on broader unions rather
// than exhaustive overloads.

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

export type SyncState =
  | "DISABLED"
  | "INITIALIZING"
  | "IDENTIFYING"
  | "AUTHENTICATING"
  | "IDLE"
  | "SYNCING"
  | "OFFLINE"
  | "NEEDS_CONSENT"
  | "ERROR";

export type SyncEvent =
  | { type: "ENABLE" }
  | { type: "DISABLE" }
  | { type: "GIS_READY" }
  | { type: "IDENTITY_OK"; email?: string | null; credential?: string }
  | { type: "IDENTITY_FAIL"; reason?: string }
  | { type: "USER_CONSENT_REQUEST" }
  | { type: "TOKEN_OK"; access_token: string; expires_in?: number; scope?: string }
  | { type: "TOKEN_FAIL"; reason?: string }
  | { type: "SYNC_REQUEST" }
  | { type: "SYNC_DONE" }
  | { type: "SYNC_FAIL"; reason: string }
  | { type: "NET_RECOVERED" }
  // Internal "tag" events used only for transition logging — never dispatched
  // through the public API but still reach _transition's `event` parameter.
  | { type: "REDIRECT_CAP" }
  | { type: "REDIRECT_TOKEN" };

export interface SyncMachineCtx {
  netFails: number;
  conflictFails: number;
  reAuthFails: number;
  backoffTimer: ReturnType<typeof setTimeout> | null;
}

export interface SyncMachine {
  enable: () => void;
  disable: () => void;
  onGisReady: () => void;
  requestSync: () => void;
  dispatch: (event: SyncEvent) => void;
  acceptRedirectToken: (access_token: string) => void;
  getState: () => SyncState;
  getToken: () => string | null;
  getEmail: () => string | null;
  isEnabled: () => boolean;
  isAuthenticated: () => boolean;
  deleteRemoteFile: () => Promise<void>;
}

// ── Transport (Drive REST + GIS wrappers) ────────────────────────────────────

export interface GsiTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export interface GsiTokenClient {
  requestAccessToken: (overrides?: { prompt?: string; hint?: string }) => void;
}

export interface GsiCredentialResponse {
  credential?: string;
  select_by?: string;
  clientId?: string;
}

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

export type RedirectCallbackResult =
  | { ok: true; token: string; returnTo: string; silent: boolean }
  | { ok: false; reason: string; returnTo?: string; silent: boolean };

export interface SyncTransport {
  DRIVE_HOSTNAMES: readonly string[];
  initTokenClient: (
    clientId: string,
    scope: string,
    onTokenResponse: (resp: GsiTokenResponse) => void,
  ) => GsiTokenClient | null;
  requestSilentToken: (client: GsiTokenClient | null, emailHint: string | null) => void;
  requestConsentToken: (client: GsiTokenClient | null) => void;
  revokeToken: (token: string | null) => void;
  initIdentityClient: (
    clientId: string,
    onIdToken: (resp: GsiCredentialResponse) => void,
  ) => boolean;
  promptIdentity: () => void;
  cancelIdentityPrompt: () => void;
  parseIdToken: (credential: string | null | undefined) => { email: string | null };
  isIOS: () => boolean;
  beginRedirectAuth: (
    clientId: string,
    scope: string,
    opts?: { prompt?: string },
  ) => void;
  consumeRedirectCallback: () => RedirectCallbackResult | null;
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

// ── Refresh Token Store (Phase 2i) ───────────────────────────────────────────
// AES-GCM encrypted IndexedDB persistence for OAuth refresh tokens.

export interface RefreshTokenStore {
  saveRefreshToken: (plain: string) => Promise<void>;
  loadRefreshToken: () => Promise<string | null>;
  clearRefreshToken: () => Promise<void>;
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

// ── Google Identity Services (narrow ambient declaration) ────────────────────
// We do not depend on @types/google.accounts; only the surface our code
// actually touches is declared.

export interface GsiIdInitializeConfig {
  client_id: string;
  callback: (response: GsiCredentialResponse) => void;
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
  itp_support?: boolean;
  cancel_on_tap_outside?: boolean;
}

export interface GsiOauth2InitTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: GsiTokenResponse) => void;
}

export interface GoogleIdentityServices {
  accounts: {
    id: {
      initialize: (config: GsiIdInitializeConfig) => void;
      prompt: () => void;
      cancel: () => void;
    };
    oauth2: {
      initTokenClient: (
        config: GsiOauth2InitTokenClientConfig,
      ) => GsiTokenClient;
      revoke: (token: string, callback: () => void) => void;
    };
  };
}

// ── Window augmentation ──────────────────────────────────────────────────────

declare global {
  interface Window {
    // Sync layer singletons (set by their respective modules at load time).
    syncTransport: SyncTransport;
    syncStoreV2: SyncStoreV2;
    syncDebugLog: SyncDebugLog;
    refreshStore: RefreshTokenStore;
    createSyncMachine: (opts?: {
      onStateChange?: (state: SyncState) => void;
    }) => SyncMachine;
    driveSync: DriveSyncFacade;

    // Cross-module globals set by drive-sync.js.
    _syncClientId?: string;
    _syncScope?: string;
    _syncRedirectAttemptsKey?: string;
    _syncSilentBlockedKey?: string;
    __pendingRedirectToken?: { access_token: string };
    __pendingRedirectError?: string;
    __driveSyncInteractionTs?: () => number;

    // UI side-effects defined in app.js. Optional because state-machine.js
    // guards each call with `typeof ... === "function"`.
    rebuildDriveSyncSection?: () => void;
    _showSyncSnackbar?: (msg: string) => void;
    renderBookmarkTree?: () => void;
    applyFontSize?: (size: number | string) => void;
    applyColorScheme?: (scheme: string) => void;
    applyTheme?: (theme: string) => void;

    // Google Identity Services library (loaded via <script> tag, may be
    // unavailable on iOS or before script load completes).
    google?: GoogleIdentityServices;
  }
}
