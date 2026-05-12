// ── Unit tests for js/manifest-sync.js ───────────────────────────────────────
// Loads manifest-sync.js inside a fresh node:vm context per test with stubs
// for IndexedDB (snapshot store), Cache API (data + audio caches), and
// fetch (manifest endpoints). Covers the diff-based invalidation contract:
// removed entries are evicted, changed hashes are evicted, unchanged hashes
// stay, first-boot (no previous snapshot) is a no-op, and offline fetch
// failure leaves caches untouched.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../js/manifest-sync.js"),
  "utf8",
);

// ── In-memory IndexedDB (matches audio-cache.test.js shape) ──────────────────

function makeFakeIDB() {
  const databases = new Map();

  function fire(req, fn) {
    queueMicrotask(() => {
      try {
        req.result = fn();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
  }

  function makeStore(map) {
    return {
      get(key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        fire(req, () => map.get(key));
        return req;
      },
      put(value, key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        fire(req, () => { map.set(key, value); return key; });
        return req;
      },
    };
  }

  function makeTransaction(db, names) {
    const arr = Array.isArray(names) ? names : [names];
    const stores = arr.map((n) => makeStore(db.stores.get(n)));
    const tx = {
      oncomplete: null,
      onerror: null,
      objectStore(name) {
        const idx = arr.indexOf(name);
        return stores[idx];
      },
    };
    queueMicrotask(() => { if (tx.oncomplete) tx.oncomplete({}); });
    return tx;
  }

  return {
    open(name, version) {
      const req = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => {
        let db = databases.get(name);
        const isNew = !db;
        if (isNew) {
          db = { version: 0, stores: new Map() };
          databases.set(name, db);
        }
        const needsUpgrade = isNew || db.version < version;
        const handle = {
          objectStoreNames: { contains: (n) => db.stores.has(n) },
          createObjectStore: (n) => {
            const m = new Map();
            db.stores.set(n, m);
            return makeStore(m);
          },
          transaction: (names) => makeTransaction(db, names),
        };
        req.result = handle;
        if (needsUpgrade) {
          db.version = version;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
    _databases: databases,
  };
}

// ── In-memory Cache API ──────────────────────────────────────────────────────

function makeFakeCaches() {
  const caches = new Map();

  function makeCache(store) {
    return {
      keys: async () => Array.from(store.keys()).map((url) => ({ url })),
      delete: async (req) => {
        const url = typeof req === "string" ? req : req.url;
        return store.delete(url);
      },
      put: async (req, _res) => {
        const url = typeof req === "string" ? req : req.url;
        store.set(url, true);
      },
      match: async (req) => {
        const url = typeof req === "string" ? req : req.url;
        return store.has(url) ? {} : undefined;
      },
    };
  }

  return {
    async open(name) {
      if (!caches.has(name)) caches.set(name, new Map());
      return makeCache(caches.get(name));
    },
    _store: caches,
  };
}

// ── Manifest fixtures ────────────────────────────────────────────────────────

function manifest(entries) {
  return { format: 1, generated_at: "2026-01-01T00:00:00Z", entries };
}

// ── Test harness ─────────────────────────────────────────────────────────────

function load({ fetchStub } = {}) {
  const fakeIDB = makeFakeIDB();
  const fakeCaches = makeFakeCaches();
  const win = {};
  const ctx = {
    window: win,
    indexedDB: fakeIDB,
    caches: fakeCaches,
    fetch: fetchStub || (async () => { throw new Error("fetch not stubbed"); }),
    location: { origin: "https://example.test" },
    queueMicrotask,
    Promise,
    URL,
    Object,
    Set,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  return { ms: win.manifestSync, fakeCaches, fakeIDB };
}

// ── _staleKeys: pure-function diff contract ──────────────────────────────────

test("_staleKeys: no previous snapshot returns empty", () => {
  const { ms } = load();
  const cur = manifest({ "bible/gen-1.json": "sha256:a" });
  assert.equal(ms._staleKeys(cur, null).size, 0);
});

test("_staleKeys: unchanged entries are not stale", () => {
  const { ms } = load();
  const prev = manifest({ "bible/gen-1.json": "sha256:a", "bible/gen-2.json": "sha256:b" });
  const cur = manifest({ "bible/gen-1.json": "sha256:a", "bible/gen-2.json": "sha256:b" });
  assert.equal(ms._staleKeys(cur, prev).size, 0);
});

test("_staleKeys: changed hash marks entry stale", () => {
  const { ms } = load();
  const prev = manifest({ "bible/gen-1.json": "sha256:old" });
  const cur = manifest({ "bible/gen-1.json": "sha256:new" });
  const stale = ms._staleKeys(cur, prev);
  assert.equal(stale.size, 1);
  assert.ok(stale.has("bible/gen-1.json"));
});

test("_staleKeys: removed entry marks stale", () => {
  const { ms } = load();
  const prev = manifest({ "bible/gen-1.json": "sha256:a", "bible/gen-2.json": "sha256:b" });
  const cur = manifest({ "bible/gen-1.json": "sha256:a" });
  const stale = ms._staleKeys(cur, prev);
  assert.equal(stale.size, 1);
  assert.ok(stale.has("bible/gen-2.json"));
});

test("_staleKeys: entries new in current (not in previous) are not stale", () => {
  const { ms } = load();
  const prev = manifest({ "bible/gen-1.json": "sha256:a" });
  const cur = manifest({ "bible/gen-1.json": "sha256:a", "bible/gen-2.json": "sha256:b" });
  assert.equal(ms._staleKeys(cur, prev).size, 0);
});

// ── _urlToManifestKey: path stripping ────────────────────────────────────────

test("_urlToManifestKey: strips /data/ prefix", () => {
  const { ms } = load();
  assert.equal(
    ms._urlToManifestKey("https://app.test/data/bible/gen-1.json"),
    "bible/gen-1.json",
  );
});

test("_urlToManifestKey: audio paths", () => {
  const { ms } = load();
  assert.equal(
    ms._urlToManifestKey("https://app.test/data/audio/1chr-1.mp3"),
    "audio/1chr-1.mp3",
  );
});

test("_urlToManifestKey: non-data path returns null", () => {
  const { ms } = load();
  assert.equal(ms._urlToManifestKey("https://app.test/js/app.js"), null);
});

test("_urlToManifestKey: invalid URL returns null", () => {
  const { ms } = load();
  assert.equal(ms._urlToManifestKey("not-a-url"), null);
});

// ── syncManifests: end-to-end with stubs ─────────────────────────────────────

test("syncManifests: first boot leaves cache entries alone (no prev snapshot)", async () => {
  const bible = manifest({ "bible/gen-1.json": "sha256:a" });
  const audio = manifest({ "audio/1chr-1.mp3": "sha256:x" });
  const fetchStub = async (url) => {
    const u = typeof url === "string" ? url : url.url;
    const body = u.includes("audio") ? audio : bible;
    return { ok: true, json: async () => body };
  };
  const { ms, fakeCaches } = load({ fetchStub });

  // Pre-seed data cache with entries that ARE in the manifest.
  const dataCache = await fakeCaches.open("data");
  await dataCache.put({ url: "https://example.test/data/bible/gen-1.json" });
  const audioCache = await fakeCaches.open("audio");
  await audioCache.put({ url: "https://example.test/data/audio/1chr-1.mp3" });

  await ms.syncManifests();

  assert.equal(fakeCaches._store.get("data").size, 1, "data entry kept");
  assert.equal(fakeCaches._store.get("audio").size, 1, "audio entry kept");
});

test("syncManifests: second boot with changed hash evicts that entry only", async () => {
  // Boot 1: seed snapshot with "sha256:old".
  const oldBible = manifest({
    "bible/gen-1.json": "sha256:old",
    "bible/gen-2.json": "sha256:b",
  });
  const audio = manifest({});
  let currentBible = oldBible;
  const fetchStub = async (url) => {
    const u = typeof url === "string" ? url : url.url;
    const body = u.includes("audio") ? audio : currentBible;
    return { ok: true, json: async () => body };
  };
  const { ms, fakeCaches } = load({ fetchStub });

  const dataCache = await fakeCaches.open("data");
  await dataCache.put({ url: "https://example.test/data/bible/gen-1.json" });
  await dataCache.put({ url: "https://example.test/data/bible/gen-2.json" });

  await ms.syncManifests(); // snapshot stored

  // Boot 2: gen-1 hash changed, gen-2 unchanged.
  currentBible = manifest({
    "bible/gen-1.json": "sha256:new",
    "bible/gen-2.json": "sha256:b",
  });
  await ms.syncManifests();

  const remaining = Array.from(fakeCaches._store.get("data").keys());
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].endsWith("/data/bible/gen-2.json"),
            "gen-2 kept, gen-1 evicted");
});

test("syncManifests: network failure leaves caches untouched", async () => {
  const fetchStub = async () => { throw new Error("offline"); };
  const { ms, fakeCaches } = load({ fetchStub });

  const dataCache = await fakeCaches.open("data");
  await dataCache.put({ url: "https://example.test/data/bible/gen-1.json" });

  await ms.syncManifests();

  assert.equal(fakeCaches._store.get("data").size, 1,
               "cache preserved when manifest unreachable");
});

test("syncManifests: malformed manifest is ignored, cache preserved", async () => {
  const fetchStub = async () => ({ ok: true, json: async () => ({ no: "entries" }) });
  const { ms, fakeCaches } = load({ fetchStub });

  const dataCache = await fakeCaches.open("data");
  await dataCache.put({ url: "https://example.test/data/bible/gen-1.json" });

  await ms.syncManifests();

  assert.equal(fakeCaches._store.get("data").size, 1);
});

test("syncManifests: removed manifest entry evicts cache entry on second boot", async () => {
  let currentBible = manifest({
    "bible/gen-1.json": "sha256:a",
    "bible/gen-2.json": "sha256:b",
  });
  const audio = manifest({});
  const fetchStub = async (url) => {
    const u = typeof url === "string" ? url : url.url;
    return { ok: true, json: async () => (u.includes("audio") ? audio : currentBible) };
  };
  const { ms, fakeCaches } = load({ fetchStub });

  const dataCache = await fakeCaches.open("data");
  await dataCache.put({ url: "https://example.test/data/bible/gen-1.json" });
  await dataCache.put({ url: "https://example.test/data/bible/gen-2.json" });

  await ms.syncManifests(); // snapshot stored

  // gen-2 removed from manifest (e.g. book restructure).
  currentBible = manifest({ "bible/gen-1.json": "sha256:a" });
  await ms.syncManifests();

  const remaining = Array.from(fakeCaches._store.get("data").keys());
  assert.equal(remaining.length, 1);
  assert.ok(remaining[0].endsWith("/data/bible/gen-1.json"));
});
