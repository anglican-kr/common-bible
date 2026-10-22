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
  updatedAt?: number;
  children?: BookmarkTreeNode[];
}

export interface BookmarkTreeFolder {
  id: string;
  type: "folder";
  name: string;
  expanded?: boolean;
  createdAt?: number;
  updatedAt?: number;
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
  updatedAt?: number;
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

// The index signature is deliberate: a newer build may store a setting key this
// build has never heard of, and the merge has to carry it through untouched
// instead of dropping it (which would delete that setting on the other device).
export type SyncSettings = Record<SettingKey, SyncSettingValue>
                         & Record<string, SyncSettingValue>;

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
  // "파일도 삭제" disconnect — true when Drive holds no sync.json any more, false when that could not be
  // confirmed, null when there was nothing to do (not connected). Stops sync first, takes the token out of
  // the machine (settings shows "연결" at once), deletes, then revokes it. `refreshToken` (already gone from
  // IDB) buys one quiet refresh if the access token has expired.
  deleteRemoteFile: (opts?: { refreshToken?: string | null }) => Promise<boolean | null>;
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

// findSyncFileId — 2xx with fileId null is "no file yet"; any other status (0 = network error or an
// unreadable body) is a failed lookup, never "no file".
export interface DriveFindResult {
  fileId: string | null;
  // Every sync.json the lookup listed (`fileId` is the first) — 「파일도 삭제」 deletes them all.
  fileIds: string[];
  status: number;
}

export interface DriveUploadResult {
  ok: boolean;
  status: number;
  etag: string | null;
  // multipart create only — the id of the file it made.
  fileId?: string;
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
  findSyncFileId: (token: string) => Promise<DriveFindResult>;
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
  deleteSyncFile: (token: string, fileId: string) => Promise<{ ok: boolean; status: number }>;
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
  /** This store's entry once saveBookmarks(tree) ran — its key, and the characters of key and value. */
  projectedBookmarksEntry: (tree: BookmarkTreeNode[]) => { key: string; chars: number };
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
  deleteRemoteFile: () => Promise<boolean | null>;
  // A 「파일도 삭제」 that did not finish (failed, or the page closed mid-way) — settings keeps a note until a
  // delete succeeds, the user reconnects or keeps the file.
  isDeletePending: () => boolean;
  clearDeletePending: () => void;
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

// Timestamped recent-search entry (ADR-014 개정 2026-06-07). Stored shape is
// `SearchHistoryEntry[]`; `ts` is the search time (ms) or null for entries
// migrated from the legacy `string[]` format.
export interface SearchHistoryEntry {
  q: string;
  ts: number | null;
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
export type ColorSchemeId = "navy" | "red" | "green" | "purple";

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

// `data/books.json` parse shape. 75 entries; `division` partitions OT/NT/DC, plus
// "liturgical" for the two prayer-book books (`lps` 전례시편 · `cant` 송가 — ADR-039)
// that the reading UI hides (the division tabs list only the three).
// `has_prologue` is true only for sir.
export interface BookEntry {
  id: string;
  name_ko: string;
  short_name_ko: string;
  name_en: string;
  division: "old_testament" | "new_testament" | "deuterocanon" | "liturgical";
  chapter_count: number;
  has_prologue: boolean;
}

export type BooksData = ReadonlyArray<BookEntry>;

// ADR-022 §2 — one entry inside a cite's `parallels`. `tradition` is a
// display-only label (e.g. "칠십인역") and is omitted when no label applies.
export interface CiteParallelRef {
  ref: string;
  tradition?: string;
}

// `data/bible/{book_id}-{chapter}.json` parse shape. `verses` is the rendered
// unit; segments hold prose/poetry mix and inter-verse stanza/paragraph cues.
export interface BibleVerseSegment {
  type: "prose" | "poetry";
  text: string;
  paragraph_break?: boolean;
  // ADR-039 — 전례시편·송가(lps·cant)의 계응 구조. 응답 반행(회중이 받는 줄)에만
  // 붙는다. 다른 책에는 없는 필드다(additive — 기존 렌더 경로에 무해).
  response?: boolean;
  // ADR-022 — citation metadata, omitted when absent.
  cite?: string;
  parallels?: CiteParallelRef[];
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
  // 다른 장에서 옮겨 실린 절의 원래 장 번호(ADR-003 — 이사 40 의 41:6-7). 파이프라인이 정수로 낸다(parser.py).
  chapter_ref?: number;
  stanza_break?: boolean;
  // ADR-039 — 전례시편·송가만. `versicle` = 번호 없는 후속 구절(¶, 앞 절의 번호를
  // 물려받는다 → 한 장에 같은 number 가 둘 이상 생긴다), `section` = 부(部) 번호로
  // 그 부의 모든 절에 붙는다(부분 발췌에서도 "(N)" 소제목을 붙일 수 있게).
  versicle?: boolean;
  section?: number;
  text?: string;
  segments?: BibleVerseSegment[];
  notes?: BibleVerseNote[];
}

// ADR-027 §2: a chapter-level parallel-passage marker. `range` is a verse-spec
// string (same grammar as `<cite src>`'s verse part: "<ch>", "<ch>:<v>-<v>",
// "<ch>:<v>-<ch>:<v>"). `src` carries one or more parallel sources with optional
// per-source `tradition` labels (CiteParallelRef shape).
export interface ChapterParallel {
  src: CiteParallelRef[];
  range: string;
}

export interface BibleChapter {
  book_id: string;
  book_name_ko: string;
  book_name_en: string;
  chapter: number;
  // 성무일과 송가(`cant`)만 — 인쇄본 제목(「즈가리야 송가 Benedictus Dominus Deus」). 다른 책에는 없다.
  chapter_title?: string;
  // 성무일과 송가(`cant`)만 — 끝에 영광송을 붙이지 않는 송가(창조송가 · 참회송가 · 찬양송가)가
  // `false` 다. 키가 없으면 붙인다(ADR-038 §3 — 영광송은 독서 뷰가 편 끝에 1회).
  gloria?: boolean;
  has_dual_numbering?: boolean;
  has_lxx_only?: boolean;
  verses: BibleVerse[];
  parallels?: ChapterParallel[];  // ADR-027: section-level parallel-passage markers
}

export interface BiblePrologue {
  book_id: string;
  book_name_ko: string;
  paragraphs: string[];
}

// ── Route descriptor (js/app/routing.js parsePath, ADR-009) ─────────────────
// What parsePath() reads off the URL — one member per view, discriminated by
// `view`. route() narrows on it; the calendar · lectionary members are what
// their renderers take.

/** /calendar · /calendar/YYYY-MM — `month` 가 null 이면 이번 달. 값의 검사는 뷰가 한다(잘못된 값은 뷰의 안내 화면). */
export interface CalendarRoute {
  view: "calendar";
  mode: "month";
  month: string | null;
}

/** /lectionary · /lectionary/YYYY-MM-DD — `date` 가 null 이면 오늘. 쿼리의 범위 밖 · 깨진 값은 null(routing.js `positive`). */
export interface LectionaryRoute {
  view: "lectionary";
  date: string | null;
  obs: string | null;
  track: 1 | 2 | null;
  set: number | null;
  collect: number | null;
}

export type Route =
  | { view: "books" }
  | { view: "search"; query: string; page: number; filterBooks: string[] }
  | { view: "bookmark-read"; folderId: string | null }
  | { view: "bookmarks" }
  | { view: "settings" }
  | CalendarRoute
  | LectionaryRoute
  | { view: "division"; division: string }
  | { view: "chapters"; bookId: string }
  | { view: "prologue"; bookId: string }
  | {
      view: "chapter";
      bookId: string;
      chapter: number;
      highlightQuery: string | null;
      highlightVerse: number | null;
      highlightVerseEnd: number | null;
      highlightVerseSpec: string | null;
      resume: boolean;
    };

// ── Liturgical engine (js/app/liturgical-engine.js, ADR-037 §6) ─────────────
// 엔진이 뷰·검색과 함께 쓰는 공유 타입(설계서 §3.2). 엔진 내부 계산용 shape
// (YearAnchors · TransferPass · 인덱스)은 그 파일 안의 @typedef 다.

export type LiturgicalSeason = "advent" | "christmas" | "ordinary" | "lent" | "easter";
export type LiturgicalDayType = "sunday" | "weekday" | "feast" | "fast";
// 일요일 코드는 없다 — 주일은 `type: "sunday"` 다(설계서 §5.1).
export type WeekdayCode = "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
// A/B/C 는 주일 주기(대림 전환), I/II 는 연중 평일 주기(1/1 전환) — 설계서 §4.7.
export type CycleCode = "A" | "B" | "C" | "I" | "II";
// 정식 전례색 넷과 선택 대체색 둘(장미색 · 청색)은 다른 축이다(설계서 R-6.4-color-order).
export type LiturgicalColor = "white" | "red" | "green" | "violet";
export type LiturgicalColorAlt = "rose" | "blue";
// 재일 — 대재일(재의 수요일 · 성 금요일) · 소재일(사순 주간 40일 · 사계재일 · 성탄절기 밖 금요일).
// `fastOf(resolved)` 의 반환이고 `ResolvedDate` 에는 싣지 않는다(설계서 R-6.3-friday-fast).
export type LiturgicalFast = "major" | "minor";
export type LiturgicalRank =
  | "principal" | "privileged_sunday" | "major_feast" | "sunday"
  | "minor_feast" | "commemoration" | "feria" | "regional_festival";
// 여섯 값 — 충돌 이동과 선택 봉헌을 한 열에 담는다(설계서 R-6.2-destinations).
export type TransferTo =
  | "next_day" | "commemorate_only" | "nearby_sunday"
  | "sunday_0102_0108" | "sunday_1030_1105" | "easter7_sunday";
// `null | 코드 | 코드 배열` 3형 — 원소 하나짜리 배열도 실재한다(설계서 §5.2).
export type CodeField<T extends string> = T | T[] | null;

/** 그날의 격자 좌표. `year` 는 연중 평일이면 I/II, 그 밖은 A/B/C(설계서 §5.1). */
export interface LiturgicalCoord {
  season: LiturgicalSeason;
  week: number | null;
  type: "sunday" | "weekday";
  weekday: WeekdayCode | null;
  year: CycleCode | null;
}

/** temporal-feasts 의 `rule` — 빌드 시 구조화돼 있다(ADR-036 §5). */
export interface LiturgicalRule {
  kind: string;
  days?: number;
  month?: number;
  day?: number;
  nth?: number;
  anchor?: { kind: string; days?: number; month?: number; day?: number };
}

/**
 * 관측일 — 정의 표(sanctoral · temporal-feasts)의 행을 **그대로** 담는다. 표의 행에 엔진이 합성한
 * 값(옮겨 온 날짜 등)은 얹지 않고 `Candidate` 가 싣는다(설계서 §1.3 · §5.5).
 * 격자(`grid:`) · 보호 기간(`guard:`)은 표에 없는 합성 관측일이고 id 접두사로 가린다 — 격자는 엔진이 통째로
 * 만들므로 `name` 처럼 「무엇인가」를 말하는 표지(`properWeekday`)를 단다. 「어디서 왔나」는 여기에도 싣지 않는다.
 */
export interface Observance {
  id: string;
  kind: "sanctoral" | "temporal";
  name: string;
  aliases?: string[] | null;
  // sanctoral
  date?: string | null;
  lunar?: string | null;
  sanctoral_class?: string | null;
  common_names?: string[] | null;
  has_proper?: boolean;
  // temporal
  coord_name?: string | null;
  season?: LiturgicalSeason | null;
  week?: number | null;
  type?: LiturgicalDayType | null;
  rule?: LiturgicalRule | null;
  note?: string | null;
  // 사계재 4행에만 `true`, 다른 행은 null 이거나 키가 없다 — `=== true` 로 읽는다(설계서 §5.2).
  penitential?: boolean | null;
  // 분류(ADR-036 §6 · §8)
  rank: LiturgicalRank | null;
  precedence: number | null;
  priority_group?: "A" | "B" | "C" | null;
  transferable?: boolean;
  transfer_to?: TransferTo | null;
  outranks_sunday?: boolean;
  color: LiturgicalColor | null;
  // `null | 스칼라 | 배열` 3형(ADR-036 §4 · 설계서 §5.2) — 대림 3주일은 ["rose", "blue"] 둘 다 허용한다.
  color_alt?: CodeField<LiturgicalColorAlt>;
  /**
   * 고유명 평일(성주간 월~수 · 재의 수요일 후 목~토)의 격자 관측일에만 `true` — 그 밖에는 키가 없다. 좌표가
   * `(lent, null, weekday)` 로 같은 날 가운데 이름이 그날의 고유 이름인 여섯 날의 표지라, 뷰가 좌표 의미를
   * 따로 들고 있지 않고 이것을 읽는다(설계서 §5.5). 정의 표의 행에는 없다 — 엔진이 격자를 합성하며 단다.
   */
  properWeekday?: true;
}

/**
 * 후보의 상태 — 여섯 값을 PR 2 가 전부 선언한다. PR 2 는 `proper` 만 내고 나머지는
 * B1(PR 3)이 만든다 — 닫힌 union 을 넷으로 두면 PR 3 의 정상 값이 타입 오류가 된다(설계서 §5.5).
 */
export type CandidateStatus =
  | "proper" | "transferred_in" | "transferred_out"
  | "optional" | "commemorated" | "omitted";

/** 관측일을 감싸는 래퍼 — 「어디서 왔나」·「왜 왔나」를 싣는다(설계서 §5.5). */
export interface Candidate {
  observance: Observance;
  status: CandidateStatus;
  /** 원래 날짜 "YYYY-MM-DD" — transferred_in · optional 에만. */
  from?: string;
  /** 도착 날짜 "YYYY-MM-DD" — transferred_out 에만. */
  to?: string;
  /** 밀어낸 것의 id — 충돌로 밀린 후보에만. 활성화된 선택 봉헌에는 없다(택한 것). */
  displacedBy?: string;
  /**
   * 저녁 전례(부활밤 — 성 토요일 저녁, 성탄 밤 — 12.24 저녁)에만 `true`. 그날의 대표 · 색 · 재분류에 참여하지
   * 않고 후보 목록 맨 끝에 온다 — 설계서 R-6.1-evening(미결20 닫힘, 사용자 결정 2026-10-15). `status` 는 `proper`.
   */
  evening?: true;
}

/** `periods.json` 의 겹침 표시 행(배너용 — 품계 비교에 참여하지 않는다). */
export interface LiturgicalPeriod {
  id: string;
  from: string;
  to: string;
  name: string;
  note?: string | null;
}

/**
 * `resolveDate` 의 반환. `official` 은 엔진이 정한 승자 — 뷰의 초기 선택이고, 후보는 전부
 * `candidates` 에 남는다(설계서 §5.5). 색 필드 셋(2026-10-10 사용자 결정 — 설계서 R-6.4-color-order ·
 * R-6.4-ember-color): `color` 는 그날의 대표색 하나, `colors` 는 병기 목록(책자의 [자/백] — 사계재 날
 * 축일이 이기면 둘, 그 밖은 `[color]`), `colorAlt` 는 선택 대체색(장미색 · 청색) 전용이고 데이터
 * `color_alt` 와 같은 3형이다(대림 3주일은 둘 다 — ["rose", "blue"]).
 */
export interface ResolvedDate {
  date: string;
  coord: LiturgicalCoord;
  candidates: Candidate[];
  official: Candidate | null;
  periods: LiturgicalPeriod[];
  color: LiturgicalColor | null;
  colorAlt: CodeField<LiturgicalColorAlt>;
  colors: LiturgicalColor[];
}

/** 독서 슬롯 — 위치가 아니라 `slot` 이름으로 읽는다(ADR-037 §1 「슬롯 배정」). */
export interface ReadingSlot {
  slot: "first" | "psalm" | "second" | "gospel";
  bookId: string;
  refs: Array<{ chapter: number; verseSpec: string }>;
  label: string;
  canticle?: string;
  scripture_ref?: string;
}

/**
 * 반절(상 `a` · 하 `b`) 하나의 경계 — 데이터 `lectionary/half-verses.json`(사용자 결정 2026-10-22, 원료는 데이터
 * 저장소 `liturgical/half-verses.md`). `line`은 그 절이 그려진 줄(1부터 — views.js appendVerses 의 줄)이다. `text`가
 * 있으면 그 줄 안의 경계 문구다 — 상은 문구까지(포함), 하는 문구부터. 없으면 줄 경계다 — 상은 그 줄까지, 하는 그
 * 줄부터. `whole`이면 나누지 않는다(로마 3:22하).
 */
export interface HalfVerse {
  bookId: string;
  chapter: number;
  verse: number;
  half: "a" | "b";
  line?: number;
  text?: string | null;
  whole?: boolean;
}

/**
 * `findReadings` 의 그룹 — 세트 하나가 그룹 하나. 고유는 본문 레코드에서, 성인 공통은
 * `commons.json` 에서 만든다(`common` 이 분류 키, id `common:<class>-s<set>`) — 설계서 §5.6.
 */
export interface ReadingGroup {
  id: string;
  title: string;
  reading_track: 1 | 2 | null;
  set_no: number;
  set_total: number;
  set_note: string | null;
  readings: ReadingSlot[];
  common: string | null;
}

/** 본기도 하나 — 같은 관측일의 자유선택 대체안이 `collect_no` 로 갈린다. 송영은 코드만(ADR-036 §3). */
export interface CollectOption {
  id: number | string;
  title: string;
  collect_no: number;
  collect_total: number;
  text: string;
  ending: "A" | "B" | "C" | null;
  common: string | null;
}

/** `findCollects` 의 원소 — 관측일별로 키잉한다(순서는 `candidates` 순, 설계서 §5.6). */
export interface CandidateCollects {
  candidate: Candidate;
  collects: CollectOption[];
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
  /** 운문 줄 머리 따옴표의 걸침 클래스(ADR-006) — 따옴표가 아니면 "". */
  hangingQuoteClass: (ch: string | undefined) => string;
  setInert: (on: boolean, selectors: string) => void;
  trapFocus: (container: HTMLElement) => () => void;
  dragReleaseAction: (h: number, vh: number) => "close" | "snap-min" | "stay";
  emptyState: (opts: {
    icon: Node | null;
    title: string;
    subtitle: string;
    tag?: keyof HTMLElementTagNameMap;
    role?: string;
  }) => HTMLElement;
  /** 헤더 아이콘의 SVG — path `d` 만 받는다(규격은 helpers.js 한 곳). 단추 · 링크와 그 동작은 호출 쪽 몫. */
  headerIcon: (d: string) => SVGSVGElement;
  /** 헤더 아이콘의 path — 글리프마다 하나(`back` 왼쪽 꺾쇠 · `home` 집). 같은 글리프를 그리는 곳은 모두 이것을 `headerIcon` 에 넘긴다. */
  HEADER_ICON_PATHS: Readonly<{ back: string; home: string }>;
  isModifiedClick: (e: Event) => boolean;
  /** 같은 화면을 다시 그리는 링크(`data-focus-key`)를 누른 자리 — 라우터가 이동 직전에 잰다(routing.js). 키가 없으면 null. */
  focusSpotOf: (a: Element, e: Event, root: Element | null) => FocusSpot | null;
  /**
   * 새 화면이 커밋된 뒤 같은 키(없으면 `fallback`)의 컨트롤에 포커스를 둔다 — 누른 때의 화면 위치로. 찾은 컨트롤 또는 null.
   * 포커스가 body 일 때만 — 다시 그리는 사이 독자가 다른 데(머리 검색 · 팝오버 · 탭 바)로 옮겼으면 아무것도 하지 않는다.
   */
  restoreFocusSpot: (spot: FocusSpot | null, root: Element | null) => HTMLElement | null;
}

/**
 * 다시 그린 화면에서 포커스를 돌려줄 자리(helpers.js `focusSpotOf` → `restoreFocusSpot`, 라우터가 잇는다) — 누른 컨트롤의
 * `data-focus-key` · 그 컨트롤이 없을 때 넘겨받을 `data-focus-fallback`, 그때의 스크롤 · 화면 위치(viewport top) · 바꿔
 * 그리는 루트(#app) 안에서의 위치. 새 화면의 같은 컨트롤을 누른 때와 같은 화면 위치에 둔다 — 스크롤 고정(scroll
 * anchoring)이 있는 브라우저는 `top` 으로, 없는 브라우저는 `y` · `offset` 으로.
 */
export interface FocusSpot {
  key: string;
  fallback: string | null;
  y: number;
  top: number;
  /** 루트 안 위치 — 루트 밖 컨트롤(머리의 구분 탭 — sticky)은 null. */
  offset: number | null;
  /** 마우스 · 탭으로 눌렀다(`detail` > 0) — 복원한 포커스에 링을 그리지 않는다. Enter 는 false. */
  pointer: boolean;
}

// ── Overlay/dialog lifecycle controller (js/app/overlay.js, ADR-032) ─────────
// Single factory over appHelpers primitives that owns the open/close + .hidden
// toggle + scrim + trapFocus + Escape + setInert + focus-restore plumbing for
// modals, drawers, sheets and popovers. See the module header for the Escape
// opt-in migration note.
export interface OverlayOptions {
  panel: HTMLElement;
  scrim?: HTMLElement | null;
  inertSelectors?: string | null;
  rootClass?: string | null;
  closeOnEsc?: boolean;
  closeOnOutside?: boolean;
  outsideIgnore?: string | null;
  trapContainer?: HTMLElement;
  initialFocus?: (() => HTMLElement | null) | HTMLElement | string | null;
  returnFocus?: boolean | HTMLElement;
  ariaExpanded?: string | null;
  onOpen?: (() => void) | null;
  onClose?: (() => void) | null;
  // Animated/async dismiss: close() defers panel.hidden=true to finalizeHide
  // (call on animation end); a re-open before then cancels it (seq-guarded).
  closeTransition?: ((panel: HTMLElement, finalizeHide: () => void) => void) | null;
}

export interface OverlayController {
  open: (returnFocusEl?: HTMLElement | null) => void;
  close: () => void;
  readonly isOpen: boolean;
}

export interface AppOverlay {
  createOverlay: (opts: OverlayOptions) => OverlayController;
  // Dismiss every currently-open overlay (route() calls this on navigation).
  // ADR-034 PR5b — replaces the router's hardcoded per-overlay teardown list.
  closeAllOverlays: () => void;
  // Bottom-sheet drag plumbing (ADR-032 §2), shared by the bookmark drawer +
  // cite sheet. Lifecycle stays with the overlay/caller; these only wire the
  // drag gesture onto a handle element.
  attachSheetDrag: (
    handle: HTMLElement,
    sheet: HTMLElement,
    opts: { onClose: () => void; maxRatio?: number },
  ) => void;
  attachSheetResize: (
    handle: HTMLElement,
    sheet: HTMLElement,
    opts?: { minWidth?: number; maxRatio?: number },
  ) => void;
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
  // Cite/note visibility (ADR-022 §6 — 인용 · 주석 표시 설정)
  loadCiteShow: () => boolean;
  saveCiteShow: (on: boolean) => void;
  // Audio book on/off (오디오 북 설정)
  loadAudioShow: () => boolean;
  saveAudioShow: (v: boolean) => void;

  // Search history
  normalizeSearchQuery: (q: unknown) => string;
  loadSearchHistory: () => SearchHistoryList;
  loadSearchHistoryEntries: () => SearchHistoryEntry[];
  saveSearchHistory: (list: SearchHistoryList | SearchHistoryEntry[]) => void;
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
  /** Rewrite stored bookmarks in place, both copies, keeping the sync store's per-item time (`_u`) — the move of pre-#205 verse ranges. */
  rewriteBookmarks: (patch: (bm: BookmarkTreeBookmark | SyncFlatItem) => boolean) => void;
  /** Every character localStorage would hold once saveBookmarks(store) ran — the bookmark import's size check (ADR-040). */
  projectedStorageChars: (store: BookmarkTreeNode[]) => number;

  // Lectionary track (ADR-038 §3 — 독서 1/2 선택). 마지막으로 고른 트랙 하나를 날짜 · 해와 무관하게 기억한다
  // (사용자 결정 2026-10-13). 로컬 전용(Drive 동기화 없음).
  loadLectionaryTrack: () => 1 | 2 | null;
  saveLectionaryTrack: (track: 1 | 2) => void;

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
  // Test seam — ADR-003 cross-chapter relocation lookup, bounded to RELOCATION_MAX_DISTANCE chapters.
  _findRelocated: (
    bookId: string,
    ch: number,
    parts: Array<{ startCh: number; startV: number; endCh: number | null; endV: number | null }>,
  ) => Promise<{ verses: Array<BibleVerse>; fromChapter: number; chapterData: BibleChapter } | null>;
  chipText: (
    src: string,
    parallels: ReadonlyArray<CiteParallelRef> | null | undefined,
    tradition: string | null | undefined,
  ) => string;
  buildCiteChip: (
    src: string,
    parallels: ReadonlyArray<CiteParallelRef> | null | undefined,
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
    body: string | ReadonlyArray<string | HTMLElement>,
  ) => void;
  closeNoteTooltip: () => void;
  openCiteSheet: (
    src: string,
    parallels: ReadonlyArray<CiteParallelRef> | null,
    tradition: string | null,
    returnFocusEl: HTMLElement | null,
  ) => Promise<void>;
  closeCiteSheet: () => void;
  initCiteSheet: () => void;
  maybeShowCoachmark: () => void;
}

// ── App parallels facade (js/app/parallels.js) ─────────────────────────────
// ADR-027 chapter-level parallel-passage banner. Inserted by views
// immediately before the first verse of each `ChapterParallel.range`.

export interface AppParallels {
  parseRange: (range: string) => {
    startCh: number;
    startV: number;
    endCh: number;
    endV: number | null;  // null = entire chapter shorthand (e.g. "13")
  } | null;
  buildTooltipBody: (parallel: ChapterParallel) => Array<string | HTMLElement>;
  buildParallelAnchor: (parallel: ChapterParallel) => HTMLElement;
  findParallelsStartingAt: (
    parallels: ReadonlyArray<ChapterParallel> | null | undefined,
    verseNumber: number,
    currentChapter?: number,
  ) => Array<ChapterParallel>;
  initParallels: () => void;
}

// ── App settings-ui facade (js/app/settings-ui.js) ──────────────────────────
// Phase 3 of the app.js modularization (ADR-018). Settings popover, icon
// recoloring, theme/color/font apply, launch screen.

export interface AppSettings {
  initSettings: () => void;
  renderSettingsView: () => void;
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
  selectAnchor: string | null;
}

// ── App bookmark facade (js/app/bookmark.js) ────────────────────────────────
// `window.appBookmark` — the aggregate bookmark.js assigns (nothing reads it today; other
// modules call the per-name globals below). The verse-spec helpers moved to verse-spec.js
// and the bookmark-core QUERY helpers (findExistingChapterBookmarks / _walkBookmarks /
// _findItemInStore / _findParentFolderId / removeItemById / insertItem / collectFolderOptions)
// are ESM-only — neither is on the aggregate.

export interface AppBookmark {
  moveBookmarkItem: (draggedId: string, targetId: string, position: "before" | "after" | "into") => void;
  closeSwipedRow: (except: HTMLElement | null) => void;
  _setupDragHandle: (li: HTMLElement, row: HTMLElement) => void;
  resetSwipedRow: () => void;
  closeSwipedRowIfOutside: (target: EventTarget | null) => void;
  buildBookmarkHeaderBtn: (bookId: string | null, chapter: number | null) => HTMLButtonElement;
  openBookmarkDrawer: (bookId: string | null, chapter: number | null) => void;
  closeBookmarkDrawer: () => void;
  renderBookmarkTree: (target?: HTMLElement) => void;
  renderBookmarksView: () => void;
  refreshBookmarkHeaderBtn: () => void;
  enterVerseSelectMode: (bookId: string, chapter: number) => void;
  exitVerseSelectMode: () => void;
  updateVerseSelectionBoundaries: (scope?: Element | null) => void;
  updateVerseSelectBar: () => void;
  enterBookmarkSelectMode: () => void;
  exitBookmarkSelectMode: () => void;
  openDriveDisconnectModal: () => void;
  initBookmarkSheetDrag: () => void;
  initBookmarkDrawerResize: () => void;
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

// ── Window augmentation ──────────────────────────────────────────────────────

declare global {
  // HTML `FocusOptions.focusVisible`(Safari 18.4+ · Chrome 145+ · Firefox 104+) — TS 5.9 의 lib.dom 에는 아직 없다.
  interface FocusOptions {
    focusVisible?: boolean;
  }
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

    // ADR-030 P2: 탭 바 검색 모핑 — search.js 가 commitTopSearch 노출, tabbar.js 가
    // exitTabSearch 노출(views 의 syncTabBarActive 가 라우트 변경 시 호출).
    commitTopSearch?: (rawQuery: string) => void;
    exitTabSearch?: () => void;
    syncTabSearchQuery?: () => void;
    resetTabCollapse?: () => void;
    closeTabSearch?: () => boolean;
    // ADR-030 후속⁵: 슬라이딩 인디케이터 재배치(스크롤 축소 해제·외부 트리거용).
    syncTabIndicator?: () => void;
    // ADR-034 PR3: tabbar.js 가 노출, route()(views)가 라우트마다 호출.
    syncTabBarActive?: () => void;

    // ADR-031: 탭 히스토리(탭별 위치 복원). tab-history.js 가 노출 — route() 가
    // onRouteStart/onRouteEnd 로 스크롤을 저장·복원하고, tabbar.js 가 lastPath/tabOf
    // 로 홈·검색·캘린더 탭(데스크톱은 헤더의 캘린더 단추) 재진입 시 마지막 경로를 복원한다.
    // "calendar" 는 /calendar · /lectionary 의 탭(ADR-038 §1 · §3).
    tabHistory?: {
      tabOf: (path: string) => "home" | "search" | "bookmarks" | "settings" | "calendar";
      fullPath: () => string;
      onRouteStart: () => void;
      onRouteEnd: () => void;
      requestRestore: () => void;
      lastPath: (tab: "home" | "search" | "bookmarks" | "settings" | "calendar") => string;
      recordPath: (path: string) => void;
      _scrollMemory: Map<string, number>;
      _lastPathForTab: Record<"home" | "search" | "bookmarks" | "settings" | "calendar", string>;
    };

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
    appOverlay: AppOverlay;
    appStorage: AppStorage;
    appSettings: AppSettings;
    appBookmark: AppBookmark;
    appCitations: AppCitations;
    appParallels: AppParallels;
    appViewsRouting: { [key: string]: any }; // Phase 7a aggregate (full type Phase 7b)
    readingContext: ReadingContext;

    // verse-spec.js facade reached as `window.X` (views.js — appendVerses' DOM ids · the
    // system-copy serializer). The other verse-spec facades are bare-global `function`
    // declarations below.
    serializeVerseRange: (firstNode: Node, lastNode: Node) => string;
    verseInstanceKeys: (verses: ReadonlyArray<BibleVerse>) => string[];

    // Phase 7a constants (also declared as bare globals above for app.js's
    // Phase 7b territory). Window assignment is what views.js does.

    // Phase 6b: bookmark UI module reads books metadata via this getter
    // since `booksCache` lives in views.js (Phase 7a). Always set
    // by views.js at module-load time.
    getBooksCache: () => BooksData | null;
    // Monotonic route counter (ADR-031 _routeSeq). Async view renderers read it
    // before awaiting and bail if it changed (ADR-033). Set by views.js.
    routeSeq?: () => number;
    // Phase 7b: Audio Player state lives in views.js; app.js's
    // Accessibility keydown handler reads currentAudio via this getter
    // for the spacebar play/pause toggle. Optional because views
    // only sets it after module load.
    getCurrentAudio?: () => HTMLAudioElement | null;
    // Google Analytics gtag.js wrapper — set by gtag-init.js (window.gtag).
    // Module-load assignment because each ESM module has its own gtag scope.
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    // App version mirror — set by views.js's loadVersion() (Phase 7a
    // owner). Read by settings-ui.js's version footer.
    appVersion?: string | null;

    // Install carousel object (Phase 4 owner: js/app/install.js). The module
    // assigns `window.install = install` at load time so settings-ui can read
    // `window.install.detectPlatform()` without a `declare const install`
    // redeclare conflict at the global scope.
    install?: InstallObject;
    openInstallModal?: () => void;
    closeInstallModal?: () => void;
    maybeShowInstallNudge?: () => void;

    // UI side-effects defined in app.js. Optional because state-machine.js
    // guards each call with `typeof ... === "function"`.
    rebuildDriveSyncSection?: () => void;
    _showSyncSnackbar?: (msg: string) => void;
    closeSettings?: () => void;
    closeChapterPopover?: () => void;
    closeBookmarkDrawer?: () => void;
    closeSaveModal?: () => void;
    closeNewFolderModal?: () => void;
    closeMergeModal?: () => void;
    closeImportModal?: () => void;
    closeConfirmModal?: () => void;
    closeDriveDisconnectModal?: () => void;
    renderBookmarkTree?: () => void;
    rerenderActiveBookmarkTree?: () => void;
    // bookmark-core.js — the move of pre-#205 verse ranges (coding-pitfalls §38): the stored list before the first
    // view (app.js), a merged sync document before it is saved (state-machine.js, optional for its unit harness).
    migrateStoredBookmarks: () => Promise<void>;
    migrateLegacyBookmarkDoc?: (doc: SyncDoc) => void;
    // route() calls these on every navigation (routing.js). bookmark.js re-exposes the
    // select-mode exit from bookmark-select.js; search.js owns the in-field book tokens.
    exitBookmarkSelectMode?: () => void;
    // bookmark.js re-exposes the select-mode entry too (its comment says for e2e; no test reads it today).
    enterBookmarkSelectMode?: () => void;
    syncSearchFields?: () => void;
    // search.js — patches the /search URL keeping the rest of its state (the tab-bar pill's clear keeps the book scope).
    navigateSearch?: (patch: { q?: string; page?: number; filterBooks?: string[] }) => void;
    // Bookmark reading view (ADR-035, bookmark-read.js) — resolves to the page title.
    renderBookmarkReadView: (folderId?: string | null) => Promise<string>;
    // Mobile tab-bar full-screen views (ADR-029 / P2). Always assigned at
    // module load; route() in views.js calls them on the mobile branch.
    renderBookmarksView: () => void;
    renderSettingsView: () => void;
    renderSearchView: (state?: { filterBooks?: string[] }) => Promise<void>;
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
  //   renderSearchResults, renderSearchView → search.js (Phase 5) — DONE
  //   openDriveDisconnectModal → bookmark.js (Phase 6) or stays
  //   clearAllCaches         → settings-ui? or app-main (Phase 8)
  //   parsePath, route, navigate → views.js (Phase 7)
  //   setTitle                   → views.js (Phase 7)
  //   hideAudioBar               → audio player section (Phase 7)
  //   renderError                → views.js (Phase 7)
  function announce(msg: string): void;
  function openInstallModal(): void;
  function maybeShowInstallNudge(): void;
  // Bookmark utility helpers (Phase 6a — js/app/bookmark.js). Module-load
  // assigns these to globalThis so app.js's Phase 6b territory (UI / tree
  // / modals / drawer handlers) can call them as bare globals until those
  // callers move into bookmark.js in Phase 6b.
  function parseVerseSpec(spec: string): Array<{ start: number; end: number; part?: string }>;
  function selectedVersesToSpec(refs: string[]): string;
  function mergeVerseSpecs(specA: string, specB: string): string;
  // bookmark-core QUERY helpers are ESM-only now (see Window interface note above).
  function moveBookmarkItem(draggedId: string, targetId: string, position: "before" | "after" | "into"): void;
  function closeSwipedRow(except: HTMLElement | null): void;
  function _setupDragHandle(li: HTMLElement, row: HTMLElement): void;
  function resetSwipedRow(): void;
  function closeSwipedRowIfOutside(target: EventTarget | null): void;
  // Phase 6b — bookmark UI surface. Module-load assigns these to globalThis
  // so app.js's Phase 7 territory (Views / Routing / chapter rendering /
  // initBookmarkSheetDrag) can call them as bare globals.
  // Phase 7a — views.js: data fetching + rendering helpers +
  // initCompactHeader. Module-load assigns these to globalThis so app.js's
  // Phase 7b territory (Views/Routing/Audio Player) can call them as bare
  // globals.
  function loadBooks(): Promise<BooksData>;
  function loadVersion(): Promise<string>;
  function loadChapter(bookId: string, chapter: number): Promise<BibleChapter>;
  function loadPrologue(bookId: string): Promise<BiblePrologue>;
  function setTitleWithChapterPicker(book: BookEntry, currentCh: number): void;
  function buildDivisionTabs(activeDivision: string): HTMLElement;
  // Partial like views.js DIVISION_LABELS — a lookup by an arbitrary string can miss.
  function divisionLabels(): Readonly<Partial<Record<string, string>>>;
  function divisionOrder(): string[];
  function effectiveDivision(book: BookEntry): string;
  // 「성서 목록으로」 destination — the book's division tab, or "/" for a book in no tab (전례시편 · 송가).
  function bookListPath(book: BookEntry): string;
  function initCompactHeader(): void;
  function initScrollElevation(): void;
  // (Phase 7a's temporary DIVISION_LABELS / OT_SUBCATEGORY{,_ORDER,_LABELS}
  // global declares were removed in Phase 7b — all callers now live inside
  // views.js so the bare-global hop is unnecessary.)
  // Google Analytics gtag wrapper (gtag-init.js) — module-load assigns
  // `window.gtag = gtag`. Declared as bare global so views.js's
  // trackPageView can `typeof gtag === "function"` guard + call directly.
  function gtag(...args: any[]): void;
  const dataLayer: any[];
  function buildHomeBtn(target: string, ariaLabel: string, focusBookId?: string): HTMLButtonElement;
  function setPendingBookFocus(bookId: string): void;
  function buildSettingsTrigger(): HTMLButtonElement;
  function buildBookmarkHeaderBtn(bookId: string | null, chapter: number | null): HTMLButtonElement;
  function openBookmarkDrawer(bookId: string | null, chapter: number | null): void;
  function closeBookmarkDrawer(): void;
  function closeSaveModal(): void;
  function closeNewFolderModal(): void;
  function closeMergeModal(): void;
  function closeImportModal(): void;
  function closeConfirmModal(): void;
  function renderBookmarkTree(target?: HTMLElement): void;
  function renderBookmarksView(): void;
  function enterVerseSelectMode(bookId: string, chapter: number): void;
  function exitVerseSelectMode(): void;
  function updateVerseSelectionBoundaries(article: Element | null): void;
  function updateVerseSelectBar(): void;
  function initBookmarkSheetDrag(): void;
  function initBookmarkDrawerResize(): void;
  function renderSearchResults(query: string, page: number, autoNavigate?: boolean, opts?: { filterBooks?: string[] }): Promise<void>;
  function renderSearchView(state?: { filterBooks?: string[] }): Promise<void>;
  function isMobile(): boolean;
  function appendTextWithHighlight(target: Node, text: string, query: string | null): void;
  function consumeSearchAutoNavigate(): boolean;
  function openDriveDisconnectModal(): void;
  function closeDriveDisconnectModal(): void;
  function clearAllCaches(): Promise<void>;
  // routing.js — the view-discriminated route descriptor (`Route` above).
  function parsePath(): Route;
  function route(): Promise<void>;
  function navigate(path: string): void;
  function setTitle(text: string): void;
  function hideAudioBar(): void;
  function renderError(msg: string): void;
}
