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
  | "startupBehavior"
  | "citeShow"
  | "audioShow";

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
  // opts.throttleMs: skip if a cycle finished within this many ms. Used by
  // poll-style callers (visibilitychange) to avoid back-to-back round-trips.
  requestSync: (opts?: { throttleMs?: number }) => void;
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
  downloadSyncFile: (
    token: string,
    fileId: string,
    opts?: { ifNoneMatch?: string | null },
  ) => Promise<DriveDownloadResult>;
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

// ── Content-hash manifest sync (js/manifest-sync.js, ADR-021) ───────────────

export interface ManifestEntries {
  [path: string]: string;
}

export interface ContentManifest {
  format: number;
  generated_at: string;
  entries: ManifestEntries;
}

export interface ManifestSync {
  syncManifests: () => Promise<void>;
  _staleKeys: (current: ContentManifest, previous: ContentManifest | null) => Set<string>;
  _urlToManifestKey: (requestUrl: string) => string | null;
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
  requestSync: () => void;
  // Throttled requestSync for visibilitychange-style polling: drops the
  // request if a cycle finished within the last POLL_THROTTLE_MS.
  pollSync: () => void;
  isEnabled: () => boolean;
  isAuthenticated: () => boolean;
  getUserEmail: () => string | null;
  getStatus: () => SyncState;
}

// ── App-level (app.js) domain types ─────────────────────────────────────────
// Shapes consumed by js/app.js. Local-only (not all are part of the Drive
// sync wire format) — see `LastReadValue` for the synced equivalent of
// `ReadingPosition`.

// `STORAGE_KEY = "bible-last-read"`. Distinct from `LastReadValue` (synced
// shape uses `verseSpec?: string`) — here `verse` is a single integer
// populated by the scroll-tracking heuristic. Both shapes are intentional:
// app.js consumes the local form, the sync layer carries the synced form.
// `chapter` may be the literal string "prologue" for books that have one
// (e.g. Sirach prologue) — see ADR-002.
export interface ReadingPosition {
  bookId: string;
  chapter: number | "prologue";
  verse: number | null;
}

// `AUDIO_POS_KEY`. Resume-from-time-offset for the chapter audio player.
export interface AudioPosition {
  bookId: string;
  chapter: number;
  time: number;
}

// `SEARCH_HISTORY_KEY`. Whitespace-normalized strings, LRU-deduped, capped
// at SEARCH_HISTORY_MAX. Local-only (see ADR-014).
export type SearchHistoryList = string[];

// Active during a touch/pointer drag over verse rows in select mode
// (module-state `_verseSelectDrag`).
export interface VerseSelectDrag {
  startIdx: number;
  allVerses: HTMLElement[];
  isAdding: boolean;
  moved: boolean;
  /**
   * Snapshot of `readingContext.selectedVerses` taken at pointerdown so that
   * a subsequent pointerup with no drag movement can revert (deselect what
   * was tentatively highlighted during the in-flight drag). Optional because
   * older drag-init paths set this lazily.
   */
  snapshot?: Set<string>;
}

// Active during a bookmark-list reorder drag (module-state `_dragState`).
export interface DragState {
  id: string;
  ghost: HTMLElement;
  origLi: HTMLElement;
  startY: number;
  origTop: number;
}

// `COLOR_SCHEME_KEY`. Drives both data-color-scheme attribute and recolored
// favicon/apple-touch-icon. The COLOR_SCHEMES array's `id` field is the
// authoritative source — keep these in sync if a scheme is added/removed.
export type ColorSchemeId = "navy" | "terracotta" | "green" | "purple";

// `THEME_KEY`. "system" defers to prefers-color-scheme; light/dark are
// explicit overrides.
export type ThemeMode = "dark" | "light" | "system";

// `BOOK_ORDER_KEY`. Whether deuterocanonical books are shown in their own
// (canonical/Korean Anglican Communion) division or interleaved with the OT
// (vulgate/Catholic ordering).
export type BookOrderKind = "canonical" | "vulgate";

// One entry of the COLOR_SCHEMES module-level array (app.js). `iconBg` drives
// the runtime canvas recolor of the favicon/apple-touch-icon.
export interface ColorSchemeEntry {
  id: ColorSchemeId;
  name: string;
  swatch: string;
  iconBg: string;
}

// `data/books.json` parse shape. 73 entries; `division` partitions OT/NT/DC.
// `has_prologue` is true only for sir.
export interface BookEntry {
  id: string;
  name_ko: string;
  short_name_ko: string;
  name_en: string;
  division: "old_testament" | "new_testament" | "deuterocanon";
  chapter_count: number;
  has_prologue: boolean;
}

export type BooksData = ReadonlyArray<BookEntry>;

// `data/bible/{book_id}-{chapter}.json` parse shape. `verses` is the rendered
// unit; segments hold prose/poetry mix and inter-verse stanza/paragraph cues.
export interface BibleVerseSegment {
  type: "prose" | "poetry";
  text: string;
  paragraph_break?: boolean;
  // ADR-022 — citation metadata, omitted when absent.
  cite?: string;
  parallels?: string[];
  tradition?: string;
}

export interface BibleVerseNote {
  id: string;
  anchor: string;
  body: string;
  anchor_occurrence?: number;
}

export interface BibleVerse {
  number: number;
  part?: string;
  range_end?: number;
  alt_ref?: number | null;
  lxx_only?: boolean;
  chapter_ref?: string;
  stanza_break?: boolean;
  text?: string;
  segments?: BibleVerseSegment[];
  notes?: BibleVerseNote[];
}

export interface BibleChapter {
  book_id: string;
  book_name_ko: string;
  book_name_en: string;
  chapter: number;
  has_dual_numbering?: boolean;
  has_lxx_only?: boolean;
  verses: BibleVerse[];
}

export interface BiblePrologue {
  book_id: string;
  book_name_ko: string;
  paragraphs: string[];
}

// ── App helpers facade (js/app/helpers.js) ──────────────────────────────────
// Phase 1 of the app.js modularization (ADR-018). Common DOM helpers shared
// by all app/* modules.

export interface AppHelpers {
  _$: (id: string) => HTMLElement;
  chUnit: (bookId: string) => string;
  el: <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, any> | null,
    ...children: Array<Node | string | null | undefined>
  ) => HTMLElementTagNameMap[K];
  clearNode: (node: Node) => void;
  setInert: (on: boolean, selectors: string) => void;
  trapFocus: (container: HTMLElement) => () => void;
  dragReleaseAction: (h: number, vh: number) => "close" | "snap-min" | "stay";
}

// ── App storage facade (js/app/storage.js) ──────────────────────────────────
// Phase 2 of the app.js modularization (ADR-018). All localStorage-backed
// load/save helpers. Each save also notifies the sync layer (window.syncStoreV2
// + window.driveSync) when applicable.

// `INSTALL_NUDGE_KEY` shape — install.js `maybeShowInstallNudge` controls when
// the Add-to-Home prompt re-appears. Stored as JSON in localStorage.
export interface InstallNudgeState {
  visits: number;
  nextShow: number;
  neverShow: boolean;
}

export interface AppStorage {
  // UI-shared constants (also used by settings popover in Phase 3 and search
  // history panel controller in Phase 5).
  readonly FONT_SIZES: ReadonlyArray<number>;
  readonly DEFAULT_FONT_SIZE: number;
  readonly COLOR_SCHEMES: ReadonlyArray<ColorSchemeEntry>;
  readonly SEARCH_HISTORY_MAX: number;

  // Reading position
  saveReadingPosition: (
    bookId: string,
    chapter: number | "prologue",
    verse?: number | null,
  ) => void;
  loadReadingPosition: () => ReadingPosition | null;
  clearReadingPosition: () => void;

  // Audio time
  saveAudioTime: (bookId: string, chapter: number, time: number) => void;
  loadAudioTime: (bookId: string, chapter: number) => number | null;
  clearAudioTime: () => void;

  // Search history
  normalizeSearchQuery: (q: unknown) => string;
  loadSearchHistory: () => SearchHistoryList;
  saveSearchHistory: (list: SearchHistoryList) => void;
  pushSearchHistory: (q: string) => SearchHistoryList;
  removeSearchHistory: (q: string) => SearchHistoryList;
  clearSearchHistory: () => SearchHistoryList;

  // Settings
  loadStartupBehavior: () => string;
  saveStartupBehavior: (val: string) => void;
  loadFontSize: () => number;
  saveFontSize: (size: number) => void;
  loadColorScheme: () => ColorSchemeId;
  saveColorScheme: (scheme: ColorSchemeId) => void;
  loadTheme: () => ThemeMode;
  saveTheme: (theme: string) => void;
  loadBookOrder: () => BookOrderKind;
  saveBookOrder: (order: string) => void;

  // Bookmarks
  generateId: () => string;
  loadBookmarks: () => BookmarkTreeNode[];
  saveBookmarks: (store: BookmarkTreeNode[]) => void;

  // Install nudge state
  _loadNudgeState: () => InstallNudgeState;
  _saveNudgeState: (state: InstallNudgeState) => void;

  // Persisted-storage one-shot request — also called from audio play (Phase 7
  // owner). State `_persistAttempted` is encapsulated in the module.
  _maybeRequestPersist: () => void;
}

// ── App citations facade (js/app/citations.js) ─────────────────────────────
// ADR-022 cite chip + verse note rendering helpers.

export interface AppCitations {
  _computeCiteShowPositions: (verses: ReadonlyArray<BibleVerse>) => Set<string>;
  chipText: (
    src: string,
    parallels: ReadonlyArray<string> | null | undefined,
    tradition: string | null | undefined,
  ) => string;
  buildCiteChip: (
    src: string,
    parallels: ReadonlyArray<string> | null | undefined,
    tradition: string | null | undefined,
    segmentType: "prose" | "poetry",
  ) => HTMLElement;
  wrapNoteAnchorsInArticle: (
    article: HTMLElement,
    verses: ReadonlyArray<BibleVerse>,
  ) => void;
  openNoteTooltip: (
    anchorEl: HTMLElement,
    anchor: string,
    body: string,
  ) => void;
  closeNoteTooltip: () => void;
  openCiteSheet: (
    src: string,
    parallels: ReadonlyArray<string> | null,
    tradition: string | null,
    returnFocusEl: HTMLElement | null,
  ) => Promise<void>;
  closeCiteSheet: () => void;
  initCiteSheet: () => void;
  maybeShowCoachmark: () => void;
}

// ── App settings-ui facade (js/app/settings-ui.js) ──────────────────────────
// Phase 3 of the app.js modularization (ADR-018). Settings popover, icon
// recoloring, theme/color/font apply, launch screen.

export interface AppSettings {
  initSettings: () => void;
  applyFontSize: (size: number | string) => void;
  applyTheme: (theme: string) => void;
  applyColorScheme: (schemeName: string) => void;
  applyCiteShow: (on: boolean) => void;
  dismissLaunchScreen: () => void;
}

// ── Reading context (js/app/reading-context.js) ─────────────────────────────
// Phase 6a of the app.js modularization (ADR-018 §5.1 Option A). Cross-
// module transient state for the chapter view.

export interface ReadingContext {
  bookId: string | null;
  chapter: number | null;
  verseSelectMode: boolean;
  selectedVerses: Set<string>;
  verseSelectDrag: VerseSelectDrag | null;
}

// ── App bookmark facade (js/app/bookmark.js) ────────────────────────────────
// Phase 6a of the app.js modularization (ADR-018). Verse spec utilities,
// bookmark store query helpers, drag & drop pointer handling. UI rendering
// (tree, drawer, modals) joins this module in Phase 6b.

export interface AppBookmark {
  parseVerseSpec: (spec: string) => Array<{ start: number; end: number; part?: string }>;
  collapseFullVerseRefs: (refs: string[], article: Element | null | undefined) => string[];
  selectedVersesToSpec: (refs: string[]) => string;
  mergeVerseSpecs: (specA: string, specB: string) => string;
  findExistingChapterBookmarks: (bookId: string, chapter: number) => BookmarkTreeBookmark[];
  _walkBookmarks: (
    store: BookmarkTreeNode[],
    fn: (item: BookmarkTreeNode, parent: BookmarkTreeNode[]) => unknown,
  ) => boolean;
  _findItemInStore: (
    store: BookmarkTreeNode[],
    id: string,
  ) => { item: BookmarkTreeNode; parent: BookmarkTreeNode[]; index: number } | null;
  _findParentFolderId: (
    store: BookmarkTreeNode[],
    id: string,
    parentId?: string | null,
  ) => string | null | undefined;
  removeItemById: (store: BookmarkTreeNode[], id: string) => void;
  insertItem: (
    store: BookmarkTreeNode[],
    folderId: string | null | undefined,
    item: BookmarkTreeNode,
  ) => void;
  collectFolderOptions: (
    store: BookmarkTreeNode[],
    depth?: number,
    options?: Array<{ id: string; name: string; depth: number }>,
  ) => Array<{ id: string; name: string; depth: number }>;
  moveBookmarkItem: (draggedId: string, targetId: string, position: "before" | "after" | "into") => void;
  closeSwipedRow: (except: HTMLElement | null) => void;
  _setupDragHandle: (li: HTMLElement, row: HTMLElement) => void;
  resetSwipedRow: () => void;
  closeSwipedRowIfOutside: (target: EventTarget | null) => void;
  initBookmarkSheetDrag: () => void;
  initBookmarkDrawerResize: () => void;
}

// ── App search facade (js/app/search.js) ────────────────────────────────────
// Phase 5 of the app.js modularization (ADR-018). Search worker wire-up,
// desktop top-bar input, mobile bottom sheet, history panel, drag init.

export interface AppSearch {
  openSearchSheet: (query?: string) => void;
  closeSearchSheet: () => void;
  renderSearchResults: (query: string, page: number, autoNavigate?: boolean) => Promise<void>;
  initSheetDrag: () => void;
  isMobile: () => boolean;
  appendTextWithHighlight: (target: Node, text: string, query: string) => void;
  consumeSearchAutoNavigate: () => boolean;
}

// ── App install facade (js/app/install.js) ──────────────────────────────────
// Phase 4 of the app.js modularization (ADR-018). PWA install detection,
// install guide modal, and install nudge auto-show.

export interface InstallSubscriptionState {
  platform: string;
  canPrompt: boolean;
}

export interface InstallObject {
  isStandalone: () => boolean;
  detectPlatform: () => string;
  subscribe: (fn: (state: InstallSubscriptionState) => void) => () => void;
  triggerPrompt: () => Promise<{ outcome: string }>;
}

export interface AppInstall {
  install: InstallObject;
  openInstallModal: () => void;
  closeInstallModal: () => void;
  maybeShowInstallNudge: () => void;
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
    manifestSync: ManifestSync;
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

    // Pre-fetched data/books.json promise (js/pre-fetch.js). app.js's
    // loadBooks() awaits this when present rather than re-issuing the fetch.
    booksPromise?: Promise<BooksData>;

    // App-layer module facades (ADR-018, see docs/design/app-modularization.md).
    appHelpers: AppHelpers;
    appStorage: AppStorage;
    appSettings: AppSettings;
    appInstall: AppInstall;
    appSearch: AppSearch;
    appBookmark: AppBookmark;
    appCitations: AppCitations;
    appViewsRouting: { [key: string]: any }; // Phase 7a aggregate (full type Phase 7b)
    readingContext: ReadingContext;

    // Phase 7a constants (also declared as bare globals above for app.js's
    // Phase 7b territory). Window assignment is what views-routing.js does.

    // Phase 6b: bookmark UI module reads books metadata via this getter
    // since `booksCache` lives in views-routing.js (Phase 7a). Always set
    // by views-routing.js at module-load time.
    getBooksCache: () => BooksData | null;
    // Phase 7b: Audio Player state lives in views-routing.js; app.js's
    // Accessibility keydown handler reads currentAudio via this getter
    // for the spacebar play/pause toggle. Optional because views-routing
    // only sets it after module load.
    getCurrentAudio?: () => HTMLAudioElement | null;
    // Google Analytics gtag.js wrapper — set by gtag-init.js (window.gtag).
    // Module-load assignment because each ESM module has its own gtag scope.
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    // App version mirror — set by views-routing.js's loadVersion() (Phase 7a
    // owner). Read by settings-ui.js's version footer.
    appVersion?: string | null;

    // Install carousel object (Phase 4 owner: js/app/install.js). The module
    // assigns `window.install = install` at load time so settings-ui can read
    // `window.install.detectPlatform()` without a `declare const install`
    // redeclare conflict at the global scope.
    install?: InstallObject;
    openInstallModal?: () => void;
    maybeShowInstallNudge?: () => void;

    // UI side-effects defined in app.js. Optional because state-machine.js
    // guards each call with `typeof ... === "function"`.
    rebuildDriveSyncSection?: () => void;
    _showSyncSnackbar?: (msg: string) => void;
    renderBookmarkTree?: () => void;
    applyFontSize?: (size: number | string) => void;
    applyColorScheme?: (scheme: string) => void;
    applyTheme?: (theme: string) => void;
    applyCiteShow?: (on: boolean) => void;
    applyAudioShow?: (on: boolean) => void;
    // Manual SW update check — set by app.js inside registerServiceWorker()
    // so it can capture the registration and reuse showUpdateToast(). Returns
    // a status object the caller can surface as transient feedback.
    checkForUpdates?: () => Promise<{ ok: boolean; status?: string; reason?: string }>;
  }

  // App-layer functions still owned by app.js as of Phase 5 (ADR-018). Each
  // declared global is assigned via `window.X = X` by its owning module at
  // module-load time, so callers can use bare `openInstallModal()` etc. Migration
  // out of this global declaration as their owners ship in later phases:
  //   announce               → moves with $announce anchor (Phase 8 owner)
  //   openInstallModal       → install.js (Phase 4) — DONE
  //   maybeShowInstallNudge  → install.js (Phase 4) — DONE
  //   openSearchSheet, closeSearchSheet, renderSearchResults, initSheetDrag
  //                          → search.js (Phase 5) — DONE
  //   openDriveDisconnectModal → bookmark.js (Phase 6) or stays
  //   clearAllCaches         → settings-ui? or app-main (Phase 8)
  //   parsePath, route, navigate → views-routing.js (Phase 7)
  //   setTitle                   → views-routing.js (Phase 7)
  //   hideAudioBar               → audio player section (Phase 7)
  //   renderError                → views-routing.js (Phase 7)
  function announce(msg: string): void;
  function openInstallModal(): void;
  function maybeShowInstallNudge(): void;
  // Bookmark utility helpers (Phase 6a — js/app/bookmark.js). Module-load
  // assigns these to globalThis so app.js's Phase 6b territory (UI / tree
  // / modals / drawer handlers) can call them as bare globals until those
  // callers move into bookmark.js in Phase 6b.
  function parseVerseSpec(spec: string): Array<{ start: number; end: number; part?: string }>;
  function collapseFullVerseRefs(refs: string[], article: Element | null | undefined): string[];
  function selectedVersesToSpec(refs: string[]): string;
  function mergeVerseSpecs(specA: string, specB: string): string;
  function findExistingChapterBookmarks(bookId: string, chapter: number): BookmarkTreeBookmark[];
  function _walkBookmarks(
    store: BookmarkTreeNode[],
    fn: (item: BookmarkTreeNode, parent: BookmarkTreeNode[]) => unknown,
  ): boolean;
  function _findItemInStore(
    store: BookmarkTreeNode[],
    id: string,
  ): { item: BookmarkTreeNode; parent: BookmarkTreeNode[]; index: number } | null;
  function _findParentFolderId(
    store: BookmarkTreeNode[],
    id: string,
    parentId?: string | null,
  ): string | null | undefined;
  function removeItemById(store: BookmarkTreeNode[], id: string): void;
  function insertItem(
    store: BookmarkTreeNode[],
    folderId: string | null | undefined,
    item: BookmarkTreeNode,
  ): void;
  function collectFolderOptions(
    store: BookmarkTreeNode[],
    depth?: number,
    options?: Array<{ id: string; name: string; depth: number }>,
  ): Array<{ id: string; name: string; depth: number }>;
  function moveBookmarkItem(draggedId: string, targetId: string, position: "before" | "after" | "into"): void;
  function closeSwipedRow(except: HTMLElement | null): void;
  function _setupDragHandle(li: HTMLElement, row: HTMLElement): void;
  function resetSwipedRow(): void;
  function closeSwipedRowIfOutside(target: EventTarget | null): void;
  // Phase 6b — bookmark UI surface. Module-load assigns these to globalThis
  // so app.js's Phase 7 territory (Views / Routing / chapter rendering /
  // initBookmarkSheetDrag) can call them as bare globals.
  // Phase 7a — views-routing.js: data fetching + rendering helpers +
  // initCompactHeader. Module-load assigns these to globalThis so app.js's
  // Phase 7b territory (Views/Routing/Audio Player) can call them as bare
  // globals.
  function loadBooks(): Promise<BooksData>;
  function loadVersion(): Promise<string>;
  function loadChapter(bookId: string, chapter: number): Promise<BibleChapter>;
  function loadPrologue(bookId: string): Promise<BiblePrologue>;
  function setTitleWithChapterPicker(book: BookEntry, currentCh: number): void;
  function buildDivisionTabs(activeDivision: string): HTMLElement;
  function divisionLabels(): Record<string, string>;
  function divisionOrder(): string[];
  function effectiveDivision(book: BookEntry): string;
  function initCompactHeader(): void;
  // (Phase 7a's temporary DIVISION_LABELS / OT_SUBCATEGORY{,_ORDER,_LABELS}
  // global declares were removed in Phase 7b — all callers now live inside
  // views-routing.js so the bare-global hop is unnecessary.)
  // Google Analytics gtag wrapper (gtag-init.js) — module-load assigns
  // `window.gtag = gtag`. Declared as bare global so views-routing.js's
  // trackPageView can `typeof gtag === "function"` guard + call directly.
  function gtag(...args: any[]): void;
  const dataLayer: any[];
  function buildBackBtn(ariaLabel: string, fallback: string): HTMLButtonElement;
  function buildHomeBtn(target: string, ariaLabel: string): HTMLButtonElement;
  function buildSettingsTrigger(): HTMLButtonElement;
  function buildBookmarkHeaderBtn(bookId: string | null, chapter: number | null): HTMLButtonElement;
  function openBookmarkDrawer(bookId: string | null, chapter: number | null): void;
  function closeBookmarkDrawer(): void;
  function renderBookmarkTree(): void;
  function enterVerseSelectMode(bookId: string, chapter: number): void;
  function exitVerseSelectMode(): void;
  function updateVerseSelectionBoundaries(article: Element | null): void;
  function updateVerseSelectBar(): void;
  function initBookmarkSheetDrag(): void;
  function initBookmarkDrawerResize(): void;
  function openSearchSheet(query?: string): void;
  function closeSearchSheet(): void;
  function renderSearchResults(query: string, page: number, autoNavigate?: boolean): Promise<void>;
  function initSheetDrag(): void;
  function isMobile(): boolean;
  function appendTextWithHighlight(target: Node, text: string, query: string): void;
  function consumeSearchAutoNavigate(): boolean;
  function openDriveDisconnectModal(): void;
  function clearAllCaches(): Promise<void>;
  // parsePath returns a view-discriminated union with extra view-specific
  // fields (page, resume, highlightQuery, etc.). Typed as `any` here until
  // views-routing.js (Phase 7) ships a precise discriminated-union type.
  function parsePath(): any;
  function route(): Promise<void>;
  function navigate(path: string): void;
  function setTitle(text: string): void;
  function hideAudioBar(): void;
  function renderError(msg: string): void;
}
