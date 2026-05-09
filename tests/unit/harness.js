// ── Test harness for js/sync/state-machine.js ────────────────────────────────
// Loads the state machine inside a fresh node:vm context per test, with all
// browser-only globals (window, localStorage, navigator, document, setTimeout)
// stubbed. Exposes loadMachine(opts) which returns { machine, ctx, stubs,
// logEntries, fireAllTimers } so tests can drive transitions and inspect
// internal state via the L.log spy.
//
// Why node:vm? state-machine.js is loaded as a classic <script> in the browser
// — it relies on `window.syncTransport`, `window.syncStoreV2`, `window.syncDebugLog`
// being set before the file runs, and exports its factory by writing to
// `window.createSyncMachine`. We replicate that environment without ESM.

import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Sync files are ES modules in production (ADR-019, browser loads them via
// `<script type="module">`). The vm-based test harness uses `runInContext`,
// which only accepts classic scripts — `export {}` would throw SyntaxError.
// Strip the trailing ESM marker before evaluating; the rest of the file is
// classic-script-compatible. First regex matches the standard 2-comment
// preamble + `export {};`, second is a fallback for the bare marker.
function stripEsmMarker(src) {
  return src.replace(/\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*export\s*\{\s*\}\s*;?\s*$/, "")
            .replace(/\n\s*export\s*\{\s*\}\s*;?\s*$/, "");
}

const STATE_MACHINE_PATH = path.resolve(__dirname, "../../js/sync/state-machine.js");
const SOURCE = stripEsmMarker(fs.readFileSync(STATE_MACHINE_PATH, "utf8"));
const REFRESH_STORE_PATH = path.resolve(__dirname, "../../js/sync/refresh-store.js");
const REFRESH_STORE_SOURCE = stripEsmMarker(fs.readFileSync(REFRESH_STORE_PATH, "utf8"));
const TRANSPORT_PATH = path.resolve(__dirname, "../../js/sync/transport.js");
const TRANSPORT_SOURCE = stripEsmMarker(fs.readFileSync(TRANSPORT_PATH, "utf8"));

// Constants mirrored from state-machine.js — kept here so tests can assert
// against them without parsing the source. Only those actually used by
// state-machine.test.js are exported.
export const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
export const SYNC_ENABLED_KEY = "bible-drive-sync";
export const SYNC_EMAIL_KEY = "bible-drive-sync-email";
export const MAX_REDIRECT_ATTEMPTS = 3;
// Sync cache keys (mirrored from state-machine.js).
export const CACHE_FILE_ID_KEY  = "bible-drive-cache-file-id";
export const CACHE_ETAG_KEY     = "bible-drive-cache-etag";
export const CACHE_SYNCED_U_KEY = "bible-drive-cache-synced-u";

// ── In-memory localStorage ───────────────────────────────────────────────────

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    _raw: store,
  };
}

// ── Stub factories ───────────────────────────────────────────────────────────

function makeTransportStub({
  isIOS = false, uploadResult, findFileId, downloadResult,
  refreshResult, exchangeResult,
} = {}) {
  return {
    isIOS: () => isIOS,
    revokeToken: () => {},
    beginRedirectAuth: async () => {},
    consumeRedirectCallback: () => null,
    generatePKCEPair: async () => ({ verifier: "v".repeat(43), challenge: "c".repeat(43) }),
    exchangeCodeForToken: async () => (exchangeResult ?? {
      ok: true, access_token: "test-access", refresh_token: "test-refresh",
      expires_in: 3600, scope: "drive.appdata email",
    }),
    refreshAccessToken: async () => (refreshResult ?? {
      ok: true, access_token: "test-access-2", refresh_token: null, expires_in: 3600,
    }),
    fetchUserInfo: async () => ({ email: "test@example.com" }),
    findSyncFileId: async () => (findFileId !== undefined ? findFileId : null),
    downloadSyncFile: async () => (downloadResult ?? { doc: null, etag: null, status: 200 }),
    uploadSyncFile: async () => (uploadResult ?? { ok: true, status: 200, etag: '"etag-1"' }),
    deleteSyncFile: async () => ({ ok: true }),
    DRIVE_HOSTNAMES: [],
  };
}

// In-memory refreshStore for state-machine tests. Mirrors the IDB-backed
// real implementation's contract: load returns null if no token, save
// overwrites, clear removes.
function makeRefreshStoreStub({ initialToken = null } = {}) {
  let token = initialToken;
  const calls = { save: 0, load: 0, clear: 0 };
  return {
    saveRefreshToken: async (t) => { calls.save++; token = t; },
    loadRefreshToken: async () => { calls.load++; return token; },
    clearRefreshToken: async () => { calls.clear++; token = null; },
    /** @returns {string | null} */
    _peek: () => token,
    _calls: calls,
  };
}

function makeStoreV2Stub() {
  const emptyDoc = () => ({
    bookmarks: { items: {}, tombstones: {} },
    settings: {
      fontSize: { v: null, _u: 0 }, colorScheme: { v: null, _u: 0 },
      theme: { v: null, _u: 0 }, bookOrder: { v: null, _u: 0 },
      startupBehavior: { v: null, _u: 0 },
    },
    lastRead: { v: null, _u: 0 },
  });
  return {
    getDeviceId: () => "test-device",
    loadLocal: () => emptyDoc(),
    saveLocal: () => {},
    sweepTombstones: () => {},
    loadBookmarks: () => [],
    saveBookmarks: () => {},
    saveSetting: () => {},
    saveLastRead: () => {},
    migrateLegacyIfNeeded: () => {},
    mergeDocs: (local) => local,
    maxU: () => 0,
    buildSyncPayload: (deviceId) => ({ schemaVersion: 2, deviceId, ...emptyDoc() }),
    validateRemote: () => true,
    bookmarkTreeFromFlat: () => [],
    applyToLegacyKeys: () => {},
  };
}

function makeDebugLogStub() {
  const entries = [];
  return {
    entries,
    log: (entry) => { entries.push(entry); },
    mask: (_, value) => (value == null ? value : `[masked]`),
    dump: () => "",
    copyToClipboard: async () => true,
  };
}

// ── Fake timers ──────────────────────────────────────────────────────────────
// Stored as { id, fn, delay } so tests can fire all pending timers and observe
// resulting transitions. Used when useRealTimers: false. The map is created
// per-loader-call inside loadMachine so each machine has independent state.

function fireAllPending(pending) {
  const ids = [...pending.keys()];
  const fns = ids.map((id) => pending.get(id).fn);
  pending.clear();
  for (const fn of fns) {
    try { fn(); } catch (_) { /* surface via test assertions */ }
  }
}

// ── Minimal in-memory IndexedDB ──────────────────────────────────────────────
// Just enough surface for refresh-store.js: open() + transaction(name).objectStore(name)
// + get/put/delete returning IDBRequest-shaped objects. CryptoKey values are
// stored by reference (no structured-clone) which is fine for unit tests.

function makeFakeIndexedDB() {
  /** Map<dbName, { version, stores: Map<storeName, Map<key, value>> }> */
  const databases = new Map();

  function _fireAsync(req, fn) {
    Promise.resolve().then(() => {
      try {
        const result = fn();
        req.result = result;
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
  }

  function _makeStore(map) {
    return {
      get(key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        _fireAsync(req, () => map.get(key));
        return req;
      },
      put(value, key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        _fireAsync(req, () => { map.set(key, value); return key; });
        return req;
      },
      delete(key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        _fireAsync(req, () => { map.delete(key); return undefined; });
        return req;
      },
    };
  }

  function _makeDb(record) {
    return {
      get objectStoreNames() {
        return { contains: (n) => record.stores.has(n) };
      },
      createObjectStore(name) {
        if (!record.stores.has(name)) record.stores.set(name, new Map());
        return _makeStore(record.stores.get(name));
      },
      transaction(storeNames, _mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        return {
          objectStore(n) {
            if (!names.includes(n)) throw new Error(`store ${n} not in transaction scope`);
            const map = record.stores.get(n);
            if (!map) throw new Error(`store ${n} not found`);
            return _makeStore(map);
          },
        };
      },
      close() {},
    };
  }

  const indexedDB = {
    open(name, version) {
      const req = {
        result: null, error: null,
        onsuccess: null, onupgradeneeded: null, onerror: null,
      };
      Promise.resolve().then(() => {
        let record = databases.get(name);
        const isUpgrade = !record || record.version < version;
        if (!record) {
          record = { version: 0, stores: new Map() };
          databases.set(name, record);
        }
        const dbHandle = _makeDb(record);
        req.result = dbHandle;
        if (isUpgrade) {
          const oldVersion = record.version;
          record.version = version;
          if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version, target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };

  return {
    indexedDB,
    /** Direct access to underlying maps for assertions / tampering. */
    _peek: (dbName, storeName) => {
      const rec = databases.get(dbName);
      return rec ? rec.stores.get(storeName) : undefined;
    },
    _reset: () => databases.clear(),
  };
}

// ── refresh-store loader ─────────────────────────────────────────────────────
// Each call creates a fresh vm context with isolated fake IDB + Node's real
// Web Crypto. Real crypto means the AES-GCM round-trip and `extractable: false`
// behavior are exercised, not just stubbed.

export function loadRefreshStore() {
  const { indexedDB, _peek, _reset } = makeFakeIndexedDB();

  const ctx = {
    console, Promise, Object, Array, Map, Set, JSON, Error,
    Uint8Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder,
    crypto: globalThis.crypto,
    indexedDB,
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(REFRESH_STORE_SOURCE, ctx, { filename: "refresh-store.js" });

  return {
    store: ctx.refreshStore,
    ctx,
    peek: _peek,
    reset: _reset,
  };
}

// ── transport loader (for PKCE function tests) ───────────────────────────────
// transport.js needs only: location/sessionStorage/localStorage stubs, real
// Web Crypto, real fetch (overridable per-test), and Node base globals. No
// window.google or other browser-only auth SDK is required — Phase 2h step 4
// removed the GIS Token Client wrapper, so transport.js is pure PKCE +
// fetch().

/**
 * @param {object} [opts]
 * @param {{pathname?: string, search?: string, hash?: string, origin?: string}} [opts.location]
 * @param {Record<string, string>} [opts.sessionStorageInit]
 * @param {Record<string, string>} [opts.localStorageInit]
 * @param {(input: any, init?: any) => Promise<any>} [opts.fetch]
 * @param {string} [opts.userAgent]
 */
export function loadTransport(opts = {}) {
  const {
    location: locInit = {},
    sessionStorageInit = {},
    localStorageInit = {},
    fetch: fetchStub,
    userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/120",
  } = opts;

  const sessionStorage = makeLocalStorage(sessionStorageInit);
  const localStorage = makeLocalStorage(localStorageInit);

  // Capturing location proxy: tests inspect what `location.href = ...`
  // received without actually navigating.
  const location = {
    pathname: locInit.pathname ?? "/",
    search: locInit.search ?? "",
    hash: locInit.hash ?? "",
    origin: locInit.origin ?? "http://localhost:8080",
    _hrefAssignments: [],
    /** @type {string} */
    _href: "",
  };
  Object.defineProperty(location, "href", {
    get() { return location._href; },
    set(v) { location._href = v; location._hrefAssignments.push(v); },
  });

  // Wrap whichever fetch implementation we end up using so `fetchCalls`
  // captures every request (test-provided stubs included).
  const fetchCalls = [];
  const innerFetch = fetchStub ?? (async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => "",
  }));
  const fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return innerFetch(url, init);
  };

  const ctx = {
    console, Promise, Object, Array, Map, Set, JSON, Error,
    Uint8Array, ArrayBuffer, DataView,
    TextEncoder, TextDecoder,
    URL, URLSearchParams,
    btoa, atob,
    Date, Math,
    parseInt, parseFloat, String, Number, Boolean,
    setTimeout, clearTimeout, setImmediate, clearImmediate,
    crypto: globalThis.crypto,
    location,
    sessionStorage,
    localStorage,
    navigator: { userAgent, platform: "Linux x86_64", maxTouchPoints: 0 },
    fetch: (url, init) => fetch(url, init),
  };
  vm.createContext(ctx);
  ctx.window = ctx;
  vm.runInContext(TRANSPORT_SOURCE, ctx, { filename: "transport.js" });

  return {
    transport: ctx.syncTransport,
    ctx,
    location,
    sessionStorage,
    localStorage,
    fetchCalls,
  };
}

// ── Main loader ──────────────────────────────────────────────────────────────

export function loadMachine(opts = {}) {
  const {
    isIOS = false,
    uploadResult,
    findFileId,
    downloadResult,
    refreshResult,
    exchangeResult,
    initialRefreshToken = null,
    initialStorage = {},
    overrideStubs = {},
    useRealTimers = true,
    onlineFlag = true,
  } = opts;

  const localStorage = makeLocalStorage(initialStorage);
  const T = {
    ...makeTransportStub({
      isIOS, uploadResult, findFileId, downloadResult,
      refreshResult, exchangeResult,
    }),
    ...overrideStubs.T,
  };
  const V2 = { ...makeStoreV2Stub(), ...overrideStubs.V2 };
  const L = makeDebugLogStub();
  const refreshStore = overrideStubs.refreshStore ?? makeRefreshStoreStub({ initialToken: initialRefreshToken });

  const fakePending = new Map();
  let fakeNextId = 1;
  const fakeSetTimeout = (fn, delay) => {
    const id = fakeNextId++;
    fakePending.set(id, { fn, delay });
    return id;
  };
  const fakeClearTimeout = (id) => { fakePending.delete(id); };

  // Build context. window/self-reference must be set after createContext.
  const ctx = {
    console,
    Date,
    Math,
    Promise,
    Object,
    Array,
    Set,
    Map,
    JSON,
    Error,
    parseInt,
    parseFloat,
    String,
    Number,
    Boolean,
    Symbol,
    isFinite,
    isNaN,
    setTimeout: useRealTimers ? setTimeout : fakeSetTimeout,
    clearTimeout: useRealTimers ? clearTimeout : fakeClearTimeout,
    setImmediate,
    clearImmediate,
    localStorage,
    navigator: { onLine: onlineFlag },
    syncTransport: T,
    syncStoreV2: V2,
    syncDebugLog: L,
    refreshStore,
    _syncClientId: "test-client-id",
  };

  vm.createContext(ctx);
  // Self-reference: scripts that read `window.X` should resolve to the same
  // bag of globals that the script writes to (e.g. `window.createSyncMachine = ...`).
  ctx.window = ctx;

  vm.runInContext(SOURCE, ctx, { filename: "state-machine.js" });

  const onStateChange = () => {};
  const machine = ctx.createSyncMachine({ onStateChange });

  // Helper: find ctx snapshot at a specific event in the log.
  function ctxAt(eventType) {
    const entry = L.entries.find((e) => e.kind === "ACTION" && e.event === eventType);
    return entry?.ctx ?? null;
  }

  // Helper: drain microtasks so async _syncCycle settles.
  async function drain(times = 1) {
    for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r));
  }

  return {
    machine,
    ctx,
    stubs: { T, V2, L, refreshStore },
    logEntries: L.entries,
    localStorage,
    refreshStore,
    ctxAt,
    drain,
    fireAllTimers: () => fireAllPending(fakePending),
    pendingTimers: fakePending,
  };
}
