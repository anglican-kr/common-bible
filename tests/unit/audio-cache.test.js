// ── Unit tests for js/audio-cache.js ─────────────────────────────────────────
// Loads audio-cache.js inside a fresh node:vm context per test with an
// in-memory fake IndexedDB. Asserts the LRU contract: idempotent recordEntry,
// touch updates lastPlayedAt, pickEvictions sorts null-first then ascending
// lastPlayedAt with addedAt tiebreak, removeEntries deletes only the named
// urls, and the public constants stay locked to the ADR-016 values.

import test from "node:test";
// Non-strict assert: vm-context objects carry a different prototype than the
// test realm's plain objects, which trips assert/strict's prototype check.
// We still use strictEqual where prototype/type matters.
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(
  path.resolve(__dirname, "../../js/audio-cache.js"),
  "utf8",
);

// ── Minimal in-memory IndexedDB ──────────────────────────────────────────────
// Just enough surface for audio-cache.js: open() with onupgradeneeded,
// transaction(name).objectStore(name) with get/put/delete/getAll, all
// returning IDBRequest-shaped objects.

function makeFakeIDB() {
  /** @type {Map<string, {version: number, stores: Map<string, Map<unknown, unknown>>}>} */
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
      delete(key) {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        fire(req, () => { map.delete(key); return undefined; });
        return req;
      },
      getAll() {
        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        fire(req, () => [...map.values()]);
        return req;
      },
    };
  }

  function makeDb(record) {
    return {
      get objectStoreNames() {
        return { contains: (n) => record.stores.has(n) };
      },
      createObjectStore(name) {
        if (!record.stores.has(name)) record.stores.set(name, new Map());
        return makeStore(record.stores.get(name));
      },
      transaction(storeNames, _mode) {
        const names = Array.isArray(storeNames) ? storeNames : [storeNames];
        return {
          objectStore(n) {
            if (!names.includes(n)) throw new Error(`store ${n} not in scope`);
            const map = record.stores.get(n);
            if (!map) throw new Error(`store ${n} not found`);
            return makeStore(map);
          },
        };
      },
      close() {},
    };
  }

  return {
    indexedDB: {
      open(name, version) {
        const req = {
          result: null, error: null,
          onsuccess: null, onupgradeneeded: null, onerror: null,
        };
        queueMicrotask(() => {
          let rec = databases.get(name);
          const upgrade = !rec || rec.version < version;
          if (!rec) {
            rec = { version: 0, stores: new Map() };
            databases.set(name, rec);
          }
          req.result = makeDb(rec);
          if (upgrade) {
            const oldVersion = rec.version;
            rec.version = version;
            if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion, newVersion: version, target: req });
          }
          if (req.onsuccess) req.onsuccess({ target: req });
        });
        return req;
      },
    },
    peek: (db, store) => databases.get(db)?.stores.get(store),
  };
}

// ── Loader ───────────────────────────────────────────────────────────────────

function load({ now = 1000 } = {}) {
  const { indexedDB, peek } = makeFakeIDB();
  let _now = now;
  const ctx = {
    Promise, Object, Array, Map, Set, JSON, Error, Math, Number,
    setTimeout, clearTimeout,
    indexedDB,
    Date: class extends Date {
      static now() { return _now; }
    },
  };
  vm.createContext(ctx);
  ctx.globalThis = ctx;
  vm.runInContext(SOURCE, ctx, { filename: "audio-cache.js" });
  return {
    ac: ctx.bibleAudioCache,
    peek,
    setNow: (t) => { _now = t; },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("recordEntry inserts new entry with lastPlayedAt=null and addedAt=now", async () => {
  const { ac, peek } = load({ now: 5000 });
  await ac.recordEntry("/audio/gen-1.mp3", 4_000_000);
  const all = await ac._listAll();
  assert.equal(all.length, 1);
  assert.deepEqual(all[0], {
    url: "/audio/gen-1.mp3",
    byteSize: 4_000_000,
    addedAt: 5000,
    lastPlayedAt: null,
  });
  // And it landed in the right store/key
  const map = peek("bible-audio-cache", "entries");
  assert.equal(map.size, 1);
  assert.ok(map.has("/audio/gen-1.mp3"));
});

test("recordEntry is idempotent: preserves addedAt and lastPlayedAt on re-record", async () => {
  const { ac, setNow } = load({ now: 1000 });
  await ac.recordEntry("/audio/gen-1.mp3", 4_000_000);
  setNow(2000);
  await ac.touch("/audio/gen-1.mp3");
  setNow(3000);
  // Re-record (e.g. fetch happened again somehow). Should keep history.
  await ac.recordEntry("/audio/gen-1.mp3", 4_500_000);
  const all = await ac._listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].addedAt, 1000, "addedAt preserved");
  assert.equal(all[0].lastPlayedAt, 2000, "lastPlayedAt preserved");
  assert.equal(all[0].byteSize, 4_500_000, "byteSize updated");
});

test("recordEntry coerces non-finite/negative byteSize to 0", async () => {
  const { ac } = load();
  await ac.recordEntry("/a.mp3", NaN);
  await ac.recordEntry("/b.mp3", -100);
  await ac.recordEntry("/c.mp3", "not a number");
  const all = await ac._listAll();
  for (const e of all) assert.equal(e.byteSize, 0, `${e.url} coerced to 0`);
});

test("touch sets lastPlayedAt to current time, no-op for missing entries", async () => {
  const { ac, setNow } = load({ now: 1000 });
  await ac.recordEntry("/a.mp3", 1000);
  setNow(7777);
  await ac.touch("/a.mp3");
  await ac.touch("/missing.mp3"); // must not throw, must not insert
  const all = await ac._listAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].lastPlayedAt, 7777);
});

test("totalSize sums byteSize across all entries", async () => {
  const { ac } = load();
  await ac.recordEntry("/a.mp3", 1_000_000);
  await ac.recordEntry("/b.mp3", 2_500_000);
  await ac.recordEntry("/c.mp3", 0);
  assert.equal(await ac.totalSize(), 3_500_000);
});

test("pickEvictions returns empty list when total <= cap", async () => {
  const { ac } = load();
  await ac.recordEntry("/a.mp3", 100_000_000);
  const result = await ac.pickEvictions(200_000_000);
  assert.deepEqual(result, { urls: [], freedBytes: 0 });
});

test("pickEvictions sorts null lastPlayedAt before any played entries", async () => {
  const { ac, setNow } = load({ now: 1000 });
  // Played entries arrive first
  await ac.recordEntry("/played-old.mp3", 50_000_000);
  await ac.touch("/played-old.mp3"); // lastPlayedAt = 1000

  setNow(2000);
  await ac.recordEntry("/played-recent.mp3", 50_000_000);
  await ac.touch("/played-recent.mp3"); // lastPlayedAt = 2000

  setNow(3000);
  await ac.recordEntry("/never-played.mp3", 50_000_000); // lastPlayedAt = null
  // Total = 150 MB. Target 100 MB → must evict 50 MB.
  const result = await ac.pickEvictions(100_000_000);
  // Null entry should be picked first even though it was added LAST.
  assert.deepEqual(result.urls, ["/never-played.mp3"]);
  assert.equal(result.freedBytes, 50_000_000);
});

test("pickEvictions among null entries tiebreaks by addedAt asc", async () => {
  const { ac, setNow } = load({ now: 1000 });
  await ac.recordEntry("/older-null.mp3", 50_000_000); // addedAt=1000

  setNow(2000);
  await ac.recordEntry("/newer-null.mp3", 50_000_000); // addedAt=2000

  // Total 100 MB, target 50 MB → evict one. Older addedAt should go first.
  const result = await ac.pickEvictions(50_000_000);
  assert.deepEqual(result.urls, ["/older-null.mp3"]);
});

test("pickEvictions among played entries sorts by lastPlayedAt asc", async () => {
  const { ac, setNow } = load({ now: 1000 });
  await ac.recordEntry("/a.mp3", 30_000_000);
  await ac.recordEntry("/b.mp3", 30_000_000);
  await ac.recordEntry("/c.mp3", 30_000_000);

  setNow(5000); await ac.touch("/c.mp3"); // most recent
  setNow(2000); await ac.touch("/a.mp3"); // oldest
  setNow(3000); await ac.touch("/b.mp3"); // middle

  // Total 90 MB. Target 60 MB → evict 30 MB worth → /a.mp3 (oldest play).
  const result = await ac.pickEvictions(60_000_000);
  assert.deepEqual(result.urls, ["/a.mp3"]);
});

test("pickEvictions stops at minimum needed to fit cap", async () => {
  const { ac, setNow } = load({ now: 1000 });
  // Five 100 MB entries, all unplayed but added in ascending time.
  for (let i = 1; i <= 5; i++) {
    setNow(1000 + i);
    await ac.recordEntry(`/${i}.mp3`, 100_000_000);
  }
  // Total 500 MB. Target 250 MB → need to free 250 MB → 3 entries (300 MB).
  const result = await ac.pickEvictions(250_000_000);
  assert.equal(result.urls.length, 3);
  assert.deepEqual(result.urls, ["/1.mp3", "/2.mp3", "/3.mp3"]);
  assert.equal(result.freedBytes, 300_000_000);
});

test("removeEntries deletes only the named urls", async () => {
  const { ac } = load();
  await ac.recordEntry("/a.mp3", 1000);
  await ac.recordEntry("/b.mp3", 1000);
  await ac.recordEntry("/c.mp3", 1000);
  await ac.removeEntries(["/a.mp3", "/c.mp3"]);
  const all = await ac._listAll();
  assert.deepEqual(all.map((e) => e.url), ["/b.mp3"]);
});

test("removeEntries handles empty/null input without throwing", async () => {
  const { ac } = load();
  await ac.recordEntry("/a.mp3", 1000);
  await ac.removeEntries([]);
  await ac.removeEntries(null);
  await ac.removeEntries(undefined);
  const all = await ac._listAll();
  assert.equal(all.length, 1);
});

test("public constants match ADR-016 (cache name fixed per ADR-021)", async () => {
  const { ac } = load();
  assert.equal(ac.AUDIO_CACHE_NAME, "audio");
  assert.equal(ac.SOFT_CAP, 300 * 1024 * 1024);
  assert.equal(ac.HARD_CAP, 360 * 1024 * 1024);
  assert.ok(ac.SOFT_CAP < ac.HARD_CAP, "soft < hard");
});

test("end-to-end: hard-cap eviction scenario (SW path)", async () => {
  // Simulates SW behavior: recordEntry on each fetch, then if total > HARD_CAP
  // pickEvictions(SOFT_CAP) + removeEntries.
  const { ac, setNow } = load({ now: 1000 });
  // Fill with 100 entries × 4 MB = 400 MB (over hard cap 360 MB).
  for (let i = 1; i <= 100; i++) {
    setNow(1000 + i);
    await ac.recordEntry(`/c-${i}.mp3`, 4 * 1024 * 1024);
    if (i % 3 === 0) {
      setNow(10000 + i);
      await ac.touch(`/c-${i}.mp3`); // every 3rd is "played"
    }
  }
  const totalBefore = await ac.totalSize();
  assert.ok(totalBefore > ac.HARD_CAP, "setup over hard cap");

  const { urls } = await ac.pickEvictions(ac.SOFT_CAP);
  await ac.removeEntries(urls);

  const totalAfter = await ac.totalSize();
  assert.ok(totalAfter <= ac.SOFT_CAP, "post-evict total under soft cap");
  // None of the played entries should be evicted as long as unplayed ones
  // had enough room. Played entries: i ∈ {3,6,...,99} = 33 entries × 4 MB
  // = 132 MB, well under 300 MB cap, so none of them are touched.
  for (const u of urls) {
    const idx = Number(u.match(/c-(\d+)/)[1]);
    assert.ok(idx % 3 !== 0, `played entry ${u} should not be evicted`);
  }
});
