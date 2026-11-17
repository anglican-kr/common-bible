// ── Unit tests for js/offline-save.js (ADR-045) ──────────────────────────────
// Loads offline-save.js inside a fresh node:vm context per test with stubs for
// localStorage, the Cache API, fetch (size list + data files), and
// navigator.storage. Covers: only missing files are fetched, the unused office
// readings are skipped, at most six requests run at once, server errors and
// lost network pause the pass, a quota failure or a short estimate turns the
// switch off, `online` resumes, and turning off deletes DATA_CACHE.

import test from "node:test";
import assert from "node:assert";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, "../../js/offline-save.js"), "utf8");
const ORIGIN = "https://app.test";

const SIZES = {
  format: 1,
  sizes: {
    "bible/gen-1.json": 100,
    "bible/gen-2.json": 200,
    "search-ot.json": 300,
    "lectionary/sanctoral.json": 50,
    "lectionary/office-readings.json": 999,
  },
  gzip_sizes: {
    "bible/gen-1.json": 30,
    "bible/gen-2.json": 60,
    "search-ot.json": 90,
    "lectionary/sanctoral.json": 10,
    "lectionary/office-readings.json": 300,
  },
};

function makeCaches() {
  /** @type {Map<string, Map<string, unknown>>} */
  const stores = new Map();
  const api = {
    putError: null,
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        async keys() { return [...map.keys()].map((url) => ({ url })); },
        async put(url, res) {
          if (api.putError) throw api.putError;
          map.set(new URL(url, ORIGIN).href, res);
        },
      };
    },
    async delete(name) { return stores.delete(name); },
    has(name, key) { return !!stores.get(name)?.has(`${ORIGIN}/data/${key}`); },
    seed(name, key) {
      if (!stores.has(name)) stores.set(name, new Map());
      stores.get(name).set(`${ORIGIN}/data/${key}`, {});
    },
    stores,
  };
  return api;
}

/**
 * @param {{ enabled?: boolean, onLine?: boolean, estimate?: { quota: number, usage: number } | null,
 *           failKeys?: string[], sizes?: unknown }} [opts]
 */
function load(opts = {}) {
  const storage = new Map();
  if (opts.enabled) storage.set("bible-offline-save", "1");
  const caches = makeCaches();
  const calls = { data: [], headers: [], persist: 0, maxInFlight: 0 };
  let inFlight = 0;
  const navigator = {
    onLine: opts.onLine ?? true,
    storage: {
      async estimate() { return opts.estimate === undefined ? { quota: 1e9, usage: 0 } : opts.estimate; },
      async persist() { calls.persist++; return true; },
    },
  };
  const failKeys = new Set(opts.failKeys ?? []);
  async function fetch(url, init = {}) {
    const href = new URL(url, ORIGIN).href;
    if (href === `${ORIGIN}/data/bible-sizes.json`) {
      if (!navigator.onLine) throw new TypeError("offline");
      return new Response(JSON.stringify(opts.sizes ?? SIZES), { status: 200 });
    }
    const key = href.slice(`${ORIGIN}/data/`.length);
    calls.data.push(key);
    calls.headers.push(init.headers ?? {});
    inFlight++;
    calls.maxInFlight = Math.max(calls.maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (!navigator.onLine) throw new TypeError("offline");
    if (failKeys.has(key)) return new Response("", { status: 500 });
    return new Response("{}", { status: 200 });
  }
  const listeners = new Map();
  const ctx = {
    console, URL, Response, Promise, Set, Map, setTimeout,
    location: { href: `${ORIGIN}/settings` },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    navigator, caches, fetch,
    addEventListener: (type, fn) => listeners.set(type, fn),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const os = ctx.offlineSave;
  const fire = (type) => listeners.get(type)?.();
  const statuses = [];
  os.subscribe((s) => { if (statuses.at(-1) !== s.status) statuses.push(s.status); });
  /** Resolve once the pass reaches a resting status. */
  const settle = () => new Promise((resolve) => {
    const rest = ["done", "offline", "failed", "no-space", "off"];
    if (rest.includes(os.getState().status)) return resolve(os.getState());
    const un = os.subscribe((s) => { if (rest.includes(s.status)) { un(); resolve(s); } });
  });
  /** Resolve once the pass reaches `status`. */
  const until = (status) => new Promise((resolve) => {
    if (os.getState().status === status) return resolve(os.getState());
    const un = os.subscribe((s) => { if (s.status === status) { un(); resolve(s); } });
  });
  return { os, storage, caches, calls, navigator, fire, statuses, settle, until };
}

test("크기 목록을 묶음별로 더하고, 앱이 쓰지 않는 성무일과 독서표는 뺀다", () => {
  const { os } = load();
  const list = os._parseSizeList(SIZES);
  assert.deepEqual([...list.files.keys()].sort(),
    ["bible/gen-1.json", "bible/gen-2.json", "lectionary/sanctoral.json", "search-ot.json"]);
  assert.deepEqual({ ...list.summary.groups }, { bible: 300, search: 300, lectionary: 50 });
  assert.equal(list.summary.total, 650);
  assert.equal(list.summary.gzipTotal, 190);
});

test("형식이 맞지 않는 크기 목록은 쓰지 않는다", () => {
  const { os } = load();
  assert.equal(os._parseSizeList(null), null);
  assert.equal(os._parseSizeList({ entries: {} }), null);
  assert.equal(os._parseSizeList({ sizes: { "bible/gen-1.json": "100" } }), null);
});

test("켜면 아직 저장하지 않은 파일만 받고, 모두 저장하면 끝난다", async () => {
  const { os, storage, caches, calls, settle, statuses } = load();
  caches.seed("data", "bible/gen-1.json");  // 읽으며 이미 저장된 장
  os.enable();
  const s = await settle();
  assert.equal(s.status, "done");
  assert.equal(s.saved, 650);
  assert.equal(s.total, 650);
  assert.deepEqual(calls.data.sort(), ["bible/gen-2.json", "lectionary/sanctoral.json", "search-ot.json"]);
  assert.ok(!calls.data.includes("lectionary/office-readings.json"));
  for (const key of calls.data) assert.ok(caches.has("data", key), key);
  assert.equal(storage.get("bible-offline-save"), "1");
  assert.equal(calls.persist, 1, "켤 때 오래 보관을 요청한다");
  assert.ok(statuses.includes("saving"));
});

test("받는 요청에는 서비스 워커가 저장하지 않도록 머리글을 붙인다", async () => {
  const { os, calls, settle } = load();
  os.enable();
  await settle();
  assert.ok(calls.headers.length > 0);
  for (const h of calls.headers) assert.equal(h["X-Offline-Save"], "1");
});

test("한 번에 6개까지만 받는다", async () => {
  const sizes = { sizes: {} };
  for (let i = 1; i <= 30; i++) sizes.sizes[`bible/gen-${i}.json`] = 10;
  const { os, calls, settle } = load({ sizes });
  os.enable();
  assert.equal((await settle()).status, "done");
  assert.equal(calls.data.length, 30);
  assert.ok(calls.maxInFlight <= 6, `max in flight ${calls.maxInFlight}`);
  assert.ok(calls.maxInFlight > 1, "여러 개를 함께 받는다");
});

test("서버 오류가 나면 멈추고 스위치는 켜 둔다", async () => {
  const { os, storage, settle } = load({ failKeys: ["search-ot.json"] });
  os.enable();
  const s = await settle();
  assert.equal(s.status, "failed");
  assert.equal(storage.get("bible-offline-save"), "1");
  assert.ok(s.saved < s.total);
});

test("인터넷이 끊기면 멈추고, 다시 연결되면 남은 것만 받는다", async () => {
  const { os, navigator, calls, settle, until, fire } = load({ onLine: false });
  os.enable();
  assert.equal((await settle()).status, "offline");
  assert.equal(calls.data.length, 0);
  navigator.onLine = true;
  fire("online");
  const s = await until("done");
  assert.equal(s.status, "done");
  assert.equal(s.saved, 650);
});

test("저장이 공간 부족으로 실패하면 스위치를 끄고 받은 것은 남긴다", async () => {
  const { os, storage, caches, settle } = load();
  caches.seed("data", "bible/gen-1.json");
  caches.putError = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  os.enable();
  const s = await settle();
  assert.equal(s.status, "no-space");
  assert.equal(storage.has("bible-offline-save"), false);
  assert.ok(caches.has("data", "bible/gen-1.json"), "받은 파일은 지우지 않는다");
});

test("남은 공간이 모자라면 받지 않고 스위치를 끈다", async () => {
  const { os, storage, calls, settle } = load({ estimate: { quota: 1000, usage: 600 } });
  os.enable();
  assert.equal((await settle()).status, "no-space");
  assert.equal(calls.data.length, 0);
  assert.equal(storage.has("bible-offline-save"), false);
});

test("남은 공간을 알 수 없으면 받는다", async () => {
  const { os, settle } = load({ estimate: null });
  os.enable();
  assert.equal((await settle()).status, "done");
});

test("끄면 받기를 멈추고 DATA_CACHE를 지운다", async () => {
  const { os, storage, caches, settle } = load();
  os.enable();
  await settle();
  assert.ok(caches.stores.has("data"));
  await os.disable();
  assert.equal(os.getState().status, "off");
  assert.equal(caches.stores.has("data"), false);
  assert.equal(storage.has("bible-offline-save"), false);
});

test("받는 중에 끄면 그 뒤로 상태를 바꾸지 않는다", async () => {
  const sizes = { sizes: {} };
  for (let i = 1; i <= 30; i++) sizes.sizes[`bible/gen-${i}.json`] = 10;
  const { os, statuses } = load({ sizes });
  os.enable();
  await new Promise((r) => setTimeout(r, 3));
  await os.disable();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(os.getState().status, "off");
  assert.equal(statuses.at(-1), "off");
});

test("앱을 열 때는 스위치가 켜져 있을 때만 받는다", async () => {
  const off = load();
  off.os.resume();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(off.calls.data.length, 0);
  assert.equal(off.os.getState().status, "off");

  const on = load({ enabled: true });
  assert.equal(on.os.getState().status, "checking");
  on.os.resume();
  assert.equal((await on.settle()).status, "done");
  assert.equal(on.calls.persist, 0, "앱을 열 때는 오래 보관을 다시 요청하지 않는다");
});

test("크기 목록을 받지 못하면 인터넷이 있을 때는 실패, 없을 때는 기다림이다", async () => {
  const online = load({ enabled: true, sizes: { nope: true } });
  online.os.resume();
  assert.equal((await online.settle()).status, "failed");

  const offline = load({ enabled: true, onLine: false });
  offline.os.resume();
  assert.equal((await offline.settle()).status, "offline");
});

test("저장한 크기는 받을 목록 가운데 캐시에 있는 것만 센다", async () => {
  const { os, caches } = load();
  caches.seed("data", "bible/gen-2.json");
  caches.seed("data", "lectionary/office-readings.json");
  assert.equal(await os.savedBytes(), 200);
});

test("캐시 초기화는 스위치를 끈다", () => {
  const { os, storage } = load({ enabled: true });
  os.forget();
  assert.equal(storage.has("bible-offline-save"), false);
  assert.equal(os.isEnabled(), false);
});
