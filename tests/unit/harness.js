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
const STATE_MACHINE_PATH = path.resolve(__dirname, "../../js/sync/state-machine.js");
const SOURCE = fs.readFileSync(STATE_MACHINE_PATH, "utf8");

// Constants mirrored from state-machine.js — kept here so tests can assert
// against them without parsing the source. Only those actually used by
// state-machine.test.js are exported.
export const REDIRECT_ATTEMPTS_KEY = "bible-drive-redirect-attempts";
export const MAX_REDIRECT_ATTEMPTS = 3;

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

function makeTransportStub({ isIOS = false, hasGoogleId = false, uploadResult, findFileId, downloadResult } = {}) {
  return {
    isIOS: () => isIOS,
    initTokenClient: () => ({ requestAccessToken: () => {} }),
    requestSilentToken: () => {},
    requestConsentToken: () => {},
    revokeToken: () => {},
    initIdentityClient: () => hasGoogleId,
    promptIdentity: () => {},
    cancelIdentityPrompt: () => {},
    parseIdToken: () => ({ email: "test@example.com" }),
    beginRedirectAuth: () => {},
    fetchUserInfo: async () => ({ email: "test@example.com" }),
    findSyncFileId: async () => (findFileId !== undefined ? findFileId : null),
    downloadSyncFile: async () => (downloadResult ?? { doc: null, etag: null, status: 200 }),
    uploadSyncFile: async () => (uploadResult ?? { ok: true, status: 200, etag: '"etag-1"' }),
    deleteSyncFile: async () => ({ ok: true }),
    consumeRedirectCallback: () => null,
    DRIVE_HOSTNAMES: [],
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

// ── Main loader ──────────────────────────────────────────────────────────────

export function loadMachine(opts = {}) {
  const {
    isIOS = false,
    hasGoogleId = false,
    uploadResult,
    findFileId,
    downloadResult,
    initialStorage = {},
    activeReading = false,
    overrideStubs = {},
    useRealTimers = true,
    onlineFlag = true,
  } = opts;

  const localStorage = makeLocalStorage(initialStorage);
  const T = { ...makeTransportStub({ isIOS, hasGoogleId, uploadResult, findFileId, downloadResult }), ...overrideStubs.T };
  const V2 = { ...makeStoreV2Stub(), ...overrideStubs.V2 };
  const L = makeDebugLogStub();

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
    document: {
      visibilityState: "visible",
      hasFocus: () => true,
    },
    google: hasGoogleId ? { accounts: { id: {}, oauth2: {} } } : undefined,
    syncTransport: T,
    syncStoreV2: V2,
    syncDebugLog: L,
    _syncClientId: "test-client-id",
    __driveSyncInteractionTs: () => (activeReading ? Date.now() - 1000 : 0),
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
    stubs: { T, V2, L },
    logEntries: L.entries,
    localStorage,
    ctxAt,
    drain,
    fireAllTimers: () => fireAllPending(fakePending),
    pendingTimers: fakePending,
  };
}
