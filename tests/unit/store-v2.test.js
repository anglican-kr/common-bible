// ── Unit tests for js/sync/store-v2.js ───────────────────────────────────────
// Loads the real module in a node:vm context with localStorage/window stubbed
// (it is a classic-script module in the browser that publishes
// `window.syncStoreV2`), then drives the merge and the store round-trip.
//
// The merge is the one place in the sync layer that rebuilds a document from
// scratch, so it is the one place that can silently *lose* data — hence the
// unknown-setting-key cases below.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stripEsmMarker, makeLocalStorage } from "./harness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = stripEsmMarker(
  fs.readFileSync(path.resolve(__dirname, "../../js/sync/store-v2.js"), "utf8"),
);

function load(initialStorage = {}) {
  const localStorage = makeLocalStorage(initialStorage);
  const win = {};
  const ctx = {
    localStorage,
    window: win,
    JSON, Object, Array, Set, Map, String, Number, Boolean, Math, Date,
    console, Error, isNaN, parseInt,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx, { filename: "store-v2.js" });
  return { store: win.syncStoreV2, localStorage, ctx };
}

// Cross-realm objects have the vm's prototypes, which trips assert.deepEqual.
const plain = (v) => JSON.parse(JSON.stringify(v));

function doc({ settings = {}, items = {}, tombstones = {}, lastRead, deviceId } = {}) {
  return {
    bookmarks: { items, tombstones },
    settings,
    lastRead: lastRead ?? { v: null, _u: 0 },
    ...(deviceId ? { deviceId } : {}),
  };
}

// ── 설정 병합 (LWW) ──

test("설정은 _u 가 큰 쪽이 이긴다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { theme: { v: "dark", _u: 200 } } }),
    doc({ settings: { theme: { v: "light", _u: 100 } } }),
    "device-a",
  );
  assert.deepEqual(plain(merged.settings.theme), { v: "dark", _u: 200 });
});

test("설정 _u 가 같으면 원격이 이긴다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { theme: { v: "dark", _u: 100 } } }),
    doc({ settings: { theme: { v: "light", _u: 100 } } }),
    "device-a",
  );
  assert.equal(merged.settings.theme.v, "light");
});

test("한쪽에만 있는 알려진 설정도 살아남는다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { fontSize: { v: 18, _u: 50 } } }),
    doc(),
    "device-a",
  );
  assert.equal(merged.settings.fontSize.v, 18);
});

// ── 모르는 설정 키 보존 ──
// 새 빌드가 쓴 키를 구 빌드가 병합할 때 떨어뜨리면, 구 빌드가 업로드한 문서에서
// 그 설정이 사라져 다른 기기에서 삭제된 것처럼 보인다.

test("원격에만 있는 모르는 키가 보존된다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { theme: { v: "dark", _u: 10 } } }),
    doc({ settings: { "future-setting": { v: "seoul", _u: 20 } } }),
    "device-a",
  );
  assert.deepEqual(plain(merged.settings["future-setting"]), { v: "seoul", _u: 20 });
  assert.equal(merged.settings.theme.v, "dark", "알려진 키가 함께 유지되어야 한다");
});

test("로컬에만 있는 모르는 키가 보존된다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { "future-setting": { v: 3, _u: 20 } } }),
    doc(),
    "device-a",
  );
  assert.equal(merged.settings["future-setting"].v, 3);
});

test("모르는 키도 LWW 를 따른다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { "future-setting": { v: "old", _u: 5 } } }),
    doc({ settings: { "future-setting": { v: "new", _u: 9 } } }),
    "device-a",
  );
  assert.equal(merged.settings["future-setting"].v, "new");
});

test("병합 결과를 다시 병합해도 모르는 키가 남는다", () => {
  // 왕복 시나리오: 병합 → 업로드 → 다시 내려받아 병합.
  const { store } = load();
  const once = store.mergeDocs(
    doc(),
    doc({ settings: { "future-setting": { v: "x", _u: 7 } } }),
    "device-a",
  );
  const twice = store.mergeDocs(once, doc(), "device-a");
  assert.equal(twice.settings["future-setting"].v, "x");
});

// ── 북마크 병합·삭제 표식 ──

test("삭제 표식이 더 새로우면 항목이 되살아나지 않는다", () => {
  const { store } = load();
  const item = { id: "b1", type: "bookmark", bookId: "gen", chapter: 1, _u: 100 };
  const merged = store.mergeDocs(
    doc({ items: { b1: item } }),
    doc({ tombstones: { b1: 200 } }),
    "device-a",
  );
  assert.equal(merged.bookmarks.items.b1, undefined);
  assert.equal(merged.bookmarks.tombstones.b1, 200);
});

test("항목이 삭제 표식보다 새로우면 되살아난다", () => {
  const { store } = load();
  const item = { id: "b1", type: "bookmark", bookId: "gen", chapter: 1, _u: 300 };
  const merged = store.mergeDocs(
    doc({ items: { b1: item } }),
    doc({ tombstones: { b1: 200 } }),
    "device-a",
  );
  assert.equal(merged.bookmarks.items.b1.bookId, "gen");
});

test("_u 동률이면 deviceId 사전순으로 이긴다", () => {
  const { store } = load();
  const local  = doc({ items: { b1: { id: "b1", type: "bookmark", name: "L", _u: 100 } } });
  const remote = doc({ items: { b1: { id: "b1", type: "bookmark", name: "R", _u: 100 } },
                       deviceId: "device-z" });
  assert.equal(store.mergeDocs(local, remote, "device-a").bookmarks.items.b1.name, "L");
  assert.equal(store.mergeDocs(local, remote, "device-zz").bookmarks.items.b1.name, "R");
});

// ── maxU ──

test("maxU 는 모르는 설정 키의 _u 도 센다", () => {
  const { store } = load();
  assert.equal(store.maxU(doc({ settings: { "future-setting": { v: 1, _u: 555 } } })), 555);
});

// ── 저장 왕복 ──

test("모르는 설정 키는 저장·로드를 통과한다", () => {
  const { store } = load();
  const d = doc({ settings: { "future-setting": { v: "keep", _u: 42 } } });
  store.saveLocal(d);
  assert.equal(store.loadLocal().settings["future-setting"].v, "keep");
});

test("buildSyncPayload 는 모르는 키까지 담아 올린다", () => {
  const { store } = load();
  store.saveLocal(doc({ settings: { "future-setting": { v: "keep", _u: 42 } } }));
  const payload = store.buildSyncPayload("device-a");
  assert.equal(payload.schemaVersion, 2);
  assert.equal(payload.deviceId, "device-a");
  assert.equal(payload.settings["future-setting"].v, "keep");
});

test("applyToLegacyKeys 는 아는 키만 localStorage 에 쓴다", () => {
  // 모르는 키는 어느 localStorage 키에 대응하는지 이 빌드가 모르므로 쓰지 않는다
  // — 문서에 보존되기만 하면 된다.
  const { store, localStorage } = load();
  store.applyToLegacyKeys(doc({
    settings: {
      theme: { v: "dark", _u: 1 },
      "future-setting": { v: "seoul", _u: 1 },
    },
  }));
  assert.equal(localStorage.getItem("bible-theme"), "dark");
  assert.equal(
    Object.keys(localStorage._raw).some((k) => localStorage._raw[k] === "seoul"),
    false,
  );
});

// ── __proto__ 가드 ──
// JSON.parse 는 "__proto__" 를 own key 로 만들 수 있고, 그 키를 그대로 대입하면
// 병합 결과 객체의 프로토타입이 바뀐다(키 탈락 + 오염). 병합은 이 키를 무시한다.

test("원격 settings 의 __proto__ 키는 병합에서 무시된다", () => {
  const { store } = load();
  const evil = doc();
  evil.settings = JSON.parse('{"__proto__": { "v": "polluted", "_u": 999 }}');
  const merged = store.mergeDocs(doc(), evil, "device-a");
  assert.equal(Object.prototype.hasOwnProperty.call(merged.settings, "__proto__"), false);
  // 프로토타입이 바뀌었다면 v 가 상속 프로퍼티로 보인다
  assert.equal(merged.settings.v, undefined);
});

test("원격 북마크의 __proto__ id 는 병합에서 무시된다", () => {
  const { store } = load();
  const evil = doc();
  evil.bookmarks.items = JSON.parse(
    '{"__proto__": { "id": "__proto__", "type": "bookmark", "_u": 100 }}',
  );
  const merged = store.mergeDocs(doc(), evil, "device-a");
  assert.equal(Object.prototype.hasOwnProperty.call(merged.bookmarks.items, "__proto__"), false);
  assert.equal(merged.bookmarks.items.id, undefined);
});

// ── 설정 GC ──

test("오래된 null 설정 항목은 sweepTombstones 가 걷어낸다", () => {
  // 은퇴 규약: 키를 없앨 때 { v: null, _u: now } 를 쓰고, 30일 뒤 sweep 이 걷어낸다.
  const { store } = load();
  store.saveLocal(doc({ settings: {
    "retired-setting": { v: null,   _u: 1 },          // 은퇴 표식, 30일 경과 → 제거
    theme:             { v: "dark", _u: 1 },          // 값이 있으면 나이와 무관하게 유지
    fontSize:          { v: null,   _u: 0 },          // _emptyDoc 기본값은 유지
    "fresh-null":      { v: null,   _u: Date.now() }, // 아직 30일 안 지난 null 은 유지
  } }));
  store.sweepTombstones();
  const s = store.loadLocal().settings;
  assert.equal("retired-setting" in s, false);
  assert.equal(s.theme.v, "dark");
  assert.deepEqual(plain(s.fontSize), { v: null, _u: 0 });
  assert.equal(s["fresh-null"].v, null);
});
