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

// `now` fixes this device's clock (Date.now) for the loaded store — a slow-clock device is one whose `now` is behind.
function load(initialStorage = {}, { now } = {}) {
  const localStorage = makeLocalStorage(initialStorage);
  const win = {};
  const ClockDate = now === undefined ? Date : class extends Date { static now() { return now; } };
  const ctx = {
    localStorage,
    window: win,
    JSON, Object, Array, Set, Map, String, Number, Boolean, Math, Date: ClockDate,
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

test("설정은 병합하면 _u 가 큰 쪽이 남는다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ settings: { theme: { v: "dark", _u: 200 } } }),
    doc({ settings: { theme: { v: "light", _u: 100 } } }),
    "device-a",
  );
  assert.deepEqual(plain(merged.settings.theme), { v: "dark", _u: 200 });
});

test("설정 _u 가 같으면 병합할 때 원격이 남는다", () => {
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

// 기기 id 순서로 고르던 때는 비교 상대가 마지막으로 올린 기기라, 한 기기는 자기 사본을 남기고 올리지도 않아 기기마다
// 다른 사본이 남았다(2026-10-31 리뷰, 사용자 결정).
test("수정 시각이 같으면 기기 id와 상관없이 드라이브의 사본이 남는다", () => {
  const { store } = load();
  const local  = doc({ items: { b1: { id: "b1", type: "bookmark", name: "L", _u: 100 } } });
  const remote = doc({ items: { b1: { id: "b1", type: "bookmark", name: "R", _u: 100 } },
                       deviceId: "device-z" });
  assert.equal(store.mergeDocs(local, remote, "device-a").bookmarks.items.b1.name, "R");
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

// ── 저장 결과 (known-issues §15.4, 실패를 성공과 같은 값으로 돌려주지 않는다) ──

test("applyToLegacyKeys는 브라우저가 거절한 키를 돌려주고, 나머지 키는 그대로 쓴다", () => {
  const { store, localStorage } = load();
  const setItem = localStorage.setItem;
  localStorage.setItem = (k, v) => {
    if (k === "bible-theme") throw Object.assign(new Error("refused"), { name: "QuotaExceededError" });
    setItem(k, v);
  };
  const refused = store.applyToLegacyKeys(doc({
    settings: { theme: { v: "dark", _u: 1 }, bookOrder: { v: "vulgate", _u: 1 } },
    lastRead: { v: { bookId: "john", chapter: 3 }, _u: 1 },
    items: { a: { id: "a", type: "folder", name: "가", parentId: null, _order: 0, _u: 1 } },
  }));
  assert.deepEqual(plain(refused), ["bible-theme"]);
  assert.equal(localStorage.getItem("bible-book-order"), "vulgate", "거절된 키 뒤의 설정도 쓴다");
  assert.equal(JSON.parse(localStorage.getItem("bible-last-read")).bookId, "john");
  assert.deepEqual(JSON.parse(localStorage.getItem("bible-bookmarks")).map((n) => n.id), ["a"]);
});

test("saveLocal과 saveBookmarks는 저장했으면 saved를 돌려준다", () => {
  const { store } = load();
  assert.equal(store.saveLocal(doc()), "saved");
  assert.equal(store.saveBookmarks([{ type: "folder", id: "f", name: "가", children: [] }]), "saved");
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["f"]);
});

test("브라우저가 쓰기를 거절하면 저장 공간이 찼을 때는 full, 그 밖에는 failed를 돌려주고 이전 문서는 그대로다", () => {
  for (const [name, outcome] of [["QuotaExceededError", "full"], ["SecurityError", "failed"]]) {
    const { store, localStorage } = load();
    store.saveBookmarks([{ type: "folder", id: "before", name: "가", children: [] }]);
    localStorage.setItem = () => { throw Object.assign(new Error("refused"), { name }); };
    assert.equal(store.saveLocal(doc()), outcome, name);
    assert.equal(store.saveBookmarks([{ type: "folder", id: "after", name: "나", children: [] }]), outcome, name);
    assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["before"], name);
  }
});

// ── 옛 키의 목록 옮기기 (known-issues §34) ──
// 2026-05-04 전의 버전은 북마크를 옛 키(bible-bookmarks)에만 두었다. 옮기는 저장이 거절되면 동기화 저장소 키가 없는 채로
// 남아 빈 목록이 보였고, 읽던 위치의 저장이 그 키를 만든 뒤로는 옮기기를 다시 하지 않아 다음 북마크 저장이 옛 목록을 지웠다.

const legacyBm = (i) => ({ type: "bookmark", id: `b${i}`, bookId: "john", chapter: 3, verseSpec: String(i + 1), label: `요한 3:${i + 1}` });
const LEGACY_LIST = [
  { type: "folder", id: "f", name: "폴더", children: [legacyBm(100)] },
  ...Array.from({ length: 50 }, (_, i) => legacyBm(i)),
];
const treeIds = (tree) => tree.flatMap((n) => [n.id, ...treeIds(n.children ?? [])]);
const LEGACY_IDS = treeIds(LEGACY_LIST);
const storedDoc = (localStorage) => JSON.parse(localStorage.getItem("bible-bookmarks-v2"));

// 키와 값을 합쳐 지금보다 `room`자를 넘게 늘리는 쓰기를 거절한다 — 저장 공간이 찬 브라우저처럼.
function fillStorage(localStorage, room) {
  const raw = localStorage._raw;
  const size = () => Object.entries(raw).reduce((n, [k, v]) => n + k.length + v.length, 0);
  const limit = size() + room;
  localStorage.setItem = (k, v) => {
    const value = String(v);
    if (size() - (k in raw ? k.length + raw[k].length : 0) + k.length + value.length > limit) {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    }
    raw[k] = value;
  };
}

test("옛 키에만 있는 목록은 시작할 때 동기화 저장소로 옮기고 옛 키는 그대로 둔다 — 배열과 _version 1 형식 모두", () => {
  for (const legacy of [LEGACY_LIST, { _version: 1, items: LEGACY_LIST }]) {
    const raw = JSON.stringify(legacy);
    const { store, localStorage } = load({ "bible-bookmarks": raw, "bible-theme": "dark" });
    store.migrateLegacyIfNeeded();
    const saved = storedDoc(localStorage);
    assert.deepEqual(Object.keys(saved.bookmarks.items).sort(), [...LEGACY_IDS].sort());
    assert.deepEqual(saved.settings.theme, { v: "dark", _u: 0 });
    assert.equal(localStorage.getItem("bible-bookmarks"), raw);
    assert.ok(localStorage.getItem("bible-sync-meta"));
  }
});

test("옮기는 저장이 거절되면 옛 키의 목록을 보이고, 읽던 위치는 옛 목록 없이 저장해 옮기기가 남는다", () => {
  const { store, localStorage } = load({ "bible-bookmarks": JSON.stringify(LEGACY_LIST) });
  fillStorage(localStorage, 1000);   // 옛 목록 없는 문서와 기기 id는 들어가고, 목록을 옮긴 문서는 들어가지 않는다
  store.migrateLegacyIfNeeded();
  assert.equal(localStorage.getItem("bible-bookmarks-v2"), null);
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), LEGACY_IDS);
  // 고치기 전에는 이 저장이 만든 키를 보고 옮겼다고 판단해, 그 뒤로 옮기기를 다시 하지 않았다.
  store.saveLastRead({ bookId: "john", chapter: 3 });
  assert.deepEqual(Object.keys(storedDoc(localStorage).bookmarks.items), []);
  assert.equal(storedDoc(localStorage).lastRead.v.bookId, "john");
  store.migrateLegacyIfNeeded();
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), LEGACY_IDS);
  // 북마크를 더해도, 하나를 지워도 저장 공간이 차 거절된다 — storage.js saveBookmarks는 그때 옛 키를 쓰지 않는다
  // (ADR-015 D7). 옛 키가 자리를 그대로 차지하고 지운 항목마다 삭제 기록이 남아, 한 번에 많이 지워야 저장된다.
  assert.equal(store.saveBookmarks([...store.loadBookmarks(), legacyBm(999)]), "full");
  assert.equal(store.saveBookmarks(store.loadBookmarks().slice(1)), "full");
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), LEGACY_IDS);
});

test("옮기지 못한 뒤 저장 공간이 생기면 다음 시작 때 옮기고, 그 전에 들어간 북마크 저장도 옛 목록과 함께 저장한다", () => {
  for (const next of ["start", "save"]) {
    const lastRead = { bookId: "john", chapter: 3 };
    const { store, localStorage } = load({
      "bible-bookmarks": JSON.stringify(LEGACY_LIST), "bible-last-read": JSON.stringify(lastRead),
    });
    const setItem = localStorage.setItem;
    fillStorage(localStorage, 1000);
    store.migrateLegacyIfNeeded();
    localStorage.setItem = setItem;
    if (next === "start") store.migrateLegacyIfNeeded();
    else assert.equal(store.saveBookmarks([...store.loadBookmarks(), legacyBm(999)]), "saved");
    const saved = storedDoc(localStorage);
    const expected = next === "start" ? LEGACY_IDS : [...LEGACY_IDS, "b999"];
    assert.deepEqual(Object.keys(saved.bookmarks.items).sort(), [...expected].sort(), next);
    assert.deepEqual(saved.lastRead, { v: lastRead, _u: 0 }, next);
  }
});

test("옮기지 못한 동안 바꾼 설정과 읽던 위치는 옮긴 뒤에도 남는다", () => {
  // 고치기 전 버전이 빈 목록으로 만든 동기화 저장소. 옛 목록을 담아 저장하면 거절되어, 옮긴 뒤 저장된 옛 값으로 돌아갔다.
  const { store, localStorage } = load({
    "bible-bookmarks": JSON.stringify(LEGACY_LIST),
    "bible-bookmarks-v2": JSON.stringify(doc({ settings: { theme: { v: "light", _u: 100 } }, lastRead: { v: { bookId: "gen", chapter: 1 }, _u: 100 } })),
  });
  const setItem = localStorage.setItem;
  fillStorage(localStorage, 1000);
  store.saveSetting("theme", "dark");
  store.saveLastRead({ bookId: "rev", chapter: 22 });
  localStorage.setItem = setItem;
  store.migrateLegacyIfNeeded();
  const saved = storedDoc(localStorage);
  assert.equal(Object.keys(saved.bookmarks.items).length, LEGACY_IDS.length);
  assert.equal(saved.settings.theme.v, "dark");
  assert.equal(saved.lastRead.v.bookId, "rev");
});

test("고치기 전 버전이 빈 목록으로 만든 동기화 저장소도 옛 키의 목록을 읽고, 다음 시작 때 옮긴다", () => {
  const lastRead = { v: { bookId: "john", chapter: 3 }, _u: 500 };
  const { store, localStorage } = load({
    "bible-bookmarks": JSON.stringify(LEGACY_LIST),
    "bible-bookmarks-v2": JSON.stringify(doc({ lastRead })),
  });
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), LEGACY_IDS);
  store.migrateLegacyIfNeeded();
  const saved = storedDoc(localStorage);
  assert.deepEqual(Object.keys(saved.bookmarks.items).sort(), [...LEGACY_IDS].sort());
  assert.deepEqual(saved.lastRead, lastRead);
});

test("북마크 기록이 하나라도 있거나 옛 키에 목록이 없으면 옛 키를 읽지 않고, 시작할 때 다시 저장하지도 않는다", () => {
  const stale = JSON.stringify([legacyBm(7)]);   // 옛 키는 두 번째 사본이라 늦을 수 있다(ADR-015 D7)
  const item = { ...legacyBm(1), id: "a", parentId: null, _order: 0, _u: 100 };
  for (const [v2, legacy, expected] of [
    [doc({ items: { a: item } }), stale, ["a"]],
    [doc({ tombstones: { b7: 100 } }), stale, []],
    [doc(), "[]", []],
    [doc(), null, []],
    [doc(), "[null]", []],   // 북마크로 읽히는 것이 없다
  ]) {
    const { store, localStorage } = load({ "bible-bookmarks-v2": JSON.stringify(v2), ...(legacy ? { "bible-bookmarks": legacy } : {}) });
    assert.deepEqual(treeIds(plain(store.loadBookmarks())), expected, legacy);
    let writes = 0;
    const setItem = localStorage.setItem;
    localStorage.setItem = (k, v) => { if (k === "bible-bookmarks-v2") writes++; setItem(k, v); };
    store.migrateLegacyIfNeeded();
    assert.equal(writes, 0, legacy);
  }
});

test("옛 목록에 북마크가 아닌 항목이 있어도 앞의 항목은 옮기고, 저장된 설정과 읽던 위치를 지우지 않는다", () => {
  const settings = { theme: { v: "dark", _u: 100 } };
  const lastRead = { v: { bookId: "rev", chapter: 22 }, _u: 100 };
  const { store, localStorage } = load({
    "bible-bookmarks": JSON.stringify([legacyBm(1), null, legacyBm(2)]),
    "bible-bookmarks-v2": JSON.stringify(doc({ settings, lastRead })),
  });
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), ["b1"]);
  store.migrateLegacyIfNeeded();
  const saved = storedDoc(localStorage);
  assert.deepEqual(Object.keys(saved.bookmarks.items), ["b1"]);
  assert.deepEqual(saved.settings.theme, settings.theme);
  assert.deepEqual(saved.lastRead, lastRead);
});

test("저장소를 읽을 수 없거나 꽉 차 기기 id를 저장하지 못해도 시작을 멈추지 않고, 한 번 연 동안 기기 id가 같다", () => {
  const { store, localStorage } = load({ "bible-bookmarks": JSON.stringify(LEGACY_LIST) });
  localStorage.setItem = () => { throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); };
  assert.doesNotThrow(() => store.migrateLegacyIfNeeded());
  assert.deepEqual(treeIds(plain(store.loadBookmarks())), LEGACY_IDS);
  assert.equal(store.getDeviceId(), store.getDeviceId());
  const blocked = load();
  blocked.localStorage.getItem = () => { throw Object.assign(new Error("blocked"), { name: "SecurityError" }); };
  assert.doesNotThrow(() => blocked.store.migrateLegacyIfNeeded());
});

test("옛 키에서 읽은 항목은 수정 시각이 0이라, 병합하면 다른 기기의 수정과 삭제가 남는다", () => {
  const { store } = load({ "bible-bookmarks": JSON.stringify(LEGACY_LIST) });
  const local = store.loadLocal();
  assert.deepEqual([...new Set(Object.values(local.bookmarks.items).map((n) => n._u))], [0]);
  const edited = { ...local.bookmarks.items.b1, label: "다른 기기에서 고침", _u: 2000 };
  const merged = store.mergeDocs(local, doc({ items: { b1: edited }, tombstones: { b2: 2000 } }), "device-a");
  assert.equal(merged.bookmarks.items.b1.label, "다른 기기에서 고침");
  assert.equal("b2" in merged.bookmarks.items, false);
  assert.equal(merged.bookmarks.tombstones.b2, 2000);
});

// ── 저장 전 크기 계산 (ADR-040 — 북마크 가져오기의 크기 검사) ──

test("projectedBookmarksEntry는 saveBookmarks가 쓸 항목의 글자 수 그대로다 — 쓰지는 않는다", () => {
  // 자식마다 되풀이되는 부모 id(1,000자), 바뀌지 않은 다시 저장(_u 유지), 덮어써 생기는 삭제 기록까지.
  const { store, localStorage } = load();
  const bm = (id) => ({ type: "bookmark", id, bookId: "john", chapter: 3, verseSpec: "16", label: "요한 3:16" });
  const longId = "f".repeat(1000);
  const first = [{ type: "folder", id: longId, name: "긴 id", children: [bm("a"), bm("b")] }, bm("c")];
  const second = [bm("d"), { type: "folder", id: "g", name: "", children: [] }];
  const occurrences = (id) => localStorage.getItem("bible-bookmarks-v2").split(id).length - 1;
  for (const [tree, longIds] of [[first, 4], [first, 4], [second, 1]]) {
    const before = JSON.stringify(localStorage._raw);
    const entry = store.projectedBookmarksEntry(tree);
    assert.equal(JSON.stringify(localStorage._raw), before);
    store.saveBookmarks(tree);
    assert.equal(entry.key, "bible-bookmarks-v2");
    assert.equal(entry.chars, entry.key.length + localStorage.getItem(entry.key).length);
    // 폴더의 키 · id, 자식 둘의 parentId — 덮어쓴 뒤에는 삭제 기록의 키 하나
    assert.equal(occurrences(longId), longIds);
  }
});

// ── __proto__ 검사 ──
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

// ── 기본 속성 이름의 id (known-issues §15.2) ──
// 저장소는 id를 일반 객체의 키로 쓴다. 일반 객체는 toString · constructor 같은 이름에 Object.prototype에서
// 물려받은 함수로 답하므로, 그 이름의 id가 하나만 있어도 목록 전체를 읽지 못했다(2026-10-19 실측). 가져오기
// 검사(ADR-040)가 없던 판(1.6.4 이하)에서 들인 기록은 동기화로 지금 판에도 들어온다.

/** @param {string} id @param {number} [_u] */
const flatBm = (id, _u = 5) =>
  ({ type: "bookmark", id, bookId: "gen", chapter: 1, verseSpec: "all", parentId: null, _order: 0, _u });

test("기본 속성 이름의 id도 저장했다 다시 읽으면 그대로다 — 폴더와 그 안의 항목까지", () => {
  const { store } = load();
  const tree = [
    { type: "folder", id: "toString", name: "가", children: [
      { type: "bookmark", id: "constructor", bookId: "gen", chapter: 1, verseSpec: "all" },
      { type: "folder", id: "hasOwnProperty", name: "나", children: [] },
    ] },
    { type: "bookmark", id: "valueOf", bookId: "exo", chapter: 2, verseSpec: "all" },
  ];
  store.saveBookmarks(tree);
  assert.deepEqual(plain(store.loadBookmarks()), tree);
});

test("applyToLegacyKeys도 기본 속성 이름의 id에서 멈추지 않고 옛 키에 트리를 쓴다", () => {
  const { store, localStorage } = load();
  store.applyToLegacyKeys(doc({ items: {
    toString:    { type: "folder", id: "toString", name: "가", parentId: null, _order: 0, _u: 5 },
    constructor: { ...flatBm("constructor"), parentId: "toString" },
  } }));
  assert.deepEqual(JSON.parse(localStorage.getItem("bible-bookmarks")), [
    { type: "folder", id: "toString", name: "가", children: [
      { type: "bookmark", id: "constructor", bookId: "gen", chapter: 1, verseSpec: "all" },
    ] },
  ]);
});

test("한쪽에만 있는 기본 속성 이름의 id도 병합 결과에 남는다", () => {
  // 없는 쪽에서 찾으면 물려받은 함수가 나와 삭제 시각이 NaN이 되고, 살아 있는 항목이 양쪽 모두 죽은 것으로 빠졌다.
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ items: { constructor: flatBm("constructor") } }),
    doc({ items: { toString: flatBm("toString") } }),
    "device-a",
  );
  assert.deepEqual(Object.keys(merged.bookmarks.items).sort(), ["constructor", "toString"]);
});

test("기본 속성 이름의 id에도 더 새로운 삭제 표식이 항목을 지우고, 표식은 병합 결과에 남는다", () => {
  const { store } = load();
  const merged = store.mergeDocs(
    doc({ tombstones: { toString: 10 } }),
    doc({ items: { toString: flatBm("toString", 5) } }),
    "device-a",
  );
  assert.equal(Object.hasOwn(merged.bookmarks.items, "toString"), false);
  assert.equal(merged.bookmarks.tombstones.toString, 10);
});

test("기본 속성 이름의 id를 지우면 삭제 표식이 남는다 — 다른 기기에서도 지워진다", () => {
  const { store } = load();
  const bm = (id) => ({ type: "bookmark", id, bookId: "gen", chapter: 1, verseSpec: "all" });
  store.saveBookmarks([bm("toString"), bm("b")]);
  store.saveBookmarks([bm("b")]);
  const { items, tombstones } = store.loadLocal().bookmarks;
  assert.deepEqual(Object.keys(items), ["b"]);
  assert.equal(typeof tombstones.toString, "number");
  assert.equal(Object.hasOwn(tombstones, "toString"), true);
});

test("__proto__ id의 폴더는 저장하지 않고, 안의 항목은 그 폴더의 자리로 올려 저장한다", () => {
  // 이 id는 일반 객체에 넣으면 키가 되지 않고 객체의 프로토타입을 바꾼다. 병합처럼 저장소에 두지 않는다. 안의 항목까지
  // 버리면 다음 저장이 그 항목을 삭제 기록으로 바꿔 모든 기기에서 지운다(PR #438 리뷰).
  const { store } = load();
  const bm = (id) => ({ type: "bookmark", id, bookId: "gen", chapter: 1, verseSpec: "all" });
  store.saveBookmarks([
    bm("a"),
    { type: "folder", id: "__proto__", name: "가", children: [bm("b"), bm("c")] },
    { type: "folder", id: "f", name: "나", children: [{ type: "folder", id: "__proto__", name: "다", children: [bm("d")] }] },
  ]);
  assert.deepEqual(plain(store.loadBookmarks()), [
    bm("a"), bm("b"), bm("c"),
    { type: "folder", id: "f", name: "나", children: [bm("d")] },
  ]);
  assert.deepEqual(Object.keys(store.loadLocal().bookmarks.items).sort(), ["a", "b", "c", "d", "f"]);
});

test("__proto__ id의 폴더가 없으면 순서 값은 전과 같다 — 다시 저장해도 수정 시각이 오르지 않는다", () => {
  const { store } = load();
  const bm = (id) => ({ type: "bookmark", id, bookId: "gen", chapter: 1, verseSpec: "all" });
  store.saveBookmarks([bm("a"), { type: "folder", id: "f", name: "가", children: [bm("b")] }, bm("c")]);
  const before = plain(store.loadLocal().bookmarks.items);
  assert.deepEqual([before.a._order, before.f._order, before.c._order, before.b._order], [0, 1, 2, 0]);
  store.saveBookmarks(store.loadBookmarks());
  assert.deepEqual(plain(store.loadLocal().bookmarks.items), before);
});

test("고치기 전 판이 남긴, 부모가 __proto__인 항목은 맨 위 항목 뒤에서 읽고 다음 저장에서 지우지 않는다", () => {
  // 옛 판의 저장은 폴더만 잃고 자식은 부모 id "__proto__"로 남겼다. 그 부모는 어떤 항목의 id도 아니어서, 맨 위부터
  // 그리면 그 자식이 보이지 않았고 다음 저장이 그 자식을 삭제 기록으로 바꿨다(PR #438 리뷰). 그 자식의 순서 값은
  // 옛 폴더 안에서 매긴 것이라 맨 위 항목과 겹친다. 맨 위 항목 사이에 섞으면 손대지 않은 맨 위 항목의 순서가 바뀌어
  // 수정 시각이 오르고, 다른 기기의 수정을 덮어쓴다(2차 리뷰).
  const { store } = load({
    "bible-bookmarks-v2": JSON.stringify(doc({ items: {
      x: { ...flatBm("x"), parentId: "__proto__", _order: 0 },
      a: { ...flatBm("a"), _order: 0 },
      b: { ...flatBm("b"), _order: 1 },
      y: { ...flatBm("y"), parentId: "__proto__", _order: 1 },
    } })),
  });
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["a", "b", "x", "y"]);
  store.saveBookmarks(store.loadBookmarks());
  const { items, tombstones } = store.loadLocal().bookmarks;
  assert.deepEqual(Object.keys(tombstones), []);
  assert.deepEqual([items.a._u, items.b._u], [5, 5]);     // the top level kept its order, so its times stand
  assert.deepEqual([items.x.parentId, items.x._order, items.y._order], [null, 2, 3]);
});

// ── 순서 값 (PR #438 리뷰, 사용자 결정 2026-10-26) ──
// 저장은 목록을 통째로 다시 펼친다. 순서 값을 0부터 다시 매기면, 지우거나 옮긴 항목 뒤의 손대지 않은 항목까지 값이
// 바뀌어 수정 시각이 오르고, 다른 기기에서 그 항목을 고친 것을 덮어쓴다. 앞뒤 순서가 그대로인 항목은 값을 그대로 둔다.

/** @param {Record<string, [number, string | null]>} spec  id → [_order, parentId] */
function seeded(spec) {
  const items = {};
  for (const [id, [order, parentId]] of Object.entries(spec)) {
    items[id] = id.startsWith("f")
      ? { type: "folder", id, name: id, parentId, _order: order, _u: 5 }
      : { ...flatBm(id), parentId, _order: order };
  }
  return load({ "bible-bookmarks-v2": JSON.stringify(doc({ items })) }).store;
}
const treeBm = (id) => ({ type: "bookmark", id, bookId: "gen", chapter: 1, verseSpec: "all" });
/** @param {any} store @param {string[]} ids */
const ordersOf = (store, ids) => ids.map((id) => store.loadLocal().bookmarks.items[id]._order);
/** @param {any} store @param {string[]} ids */
const keptOf = (store, ids) => ids.map((id) => store.loadLocal().bookmarks.items[id]._u === 5);

test("하나를 지우면 뒤의 항목은 순서 값도 수정 시각도 그대로다", () => {
  const store = seeded({ a: [0, null], b: [1, null], c: [2, null] });
  store.saveBookmarks([treeBm("a"), treeBm("c")]);
  assert.deepEqual(ordersOf(store, ["a", "c"]), [0, 2]);
  assert.deepEqual(keptOf(store, ["a", "c"]), [true, true]);
});

test("하나를 맨 앞으로 옮기면 그 항목만 새 값과 새 수정 시각을 받는다", () => {
  const store = seeded({ a: [0, null], b: [1, null], c: [2, null] });
  store.saveBookmarks([treeBm("c"), treeBm("a"), treeBm("b")]);
  assert.deepEqual(ordersOf(store, ["c", "a", "b"]), [-1, 0, 1]);
  assert.deepEqual(keptOf(store, ["c", "a", "b"]), [false, true, true]);
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["c", "a", "b"]);
});

test("빈 번호가 없는 사이에 넣으면 소수를 쓰고, 끝에 더하면 다음 정수를 쓴다", () => {
  const store = seeded({ a: [0, null], b: [1, null] });
  store.saveBookmarks([treeBm("a"), treeBm("x"), treeBm("b"), treeBm("y")]);
  assert.deepEqual(ordersOf(store, ["a", "x", "b", "y"]), [0, 0.5, 1, 2]);
  assert.deepEqual(keptOf(store, ["a", "b"]), [true, true]);
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["a", "x", "b", "y"]);
});

test("빈 번호가 있는 목록을 다시 저장해도 아무것도 바뀌지 않는다 — 병합 뒤 처음 저장할 때", () => {
  const store = seeded({ a: [0, null], c: [3, null], f1: [5, null], d: [0, "f1"], e: [4, "f1"] });
  const before = plain(store.loadLocal().bookmarks.items);
  store.saveBookmarks(store.loadBookmarks());
  assert.deepEqual(plain(store.loadLocal().bookmarks.items), before);
});

test("다른 폴더로 옮긴 항목은 그 폴더의 끝 값을 받고, 원래 폴더의 다른 항목은 그대로다", () => {
  const store = seeded({ a: [0, null], b: [1, null], f1: [2, null], d: [0, "f1"] });
  store.saveBookmarks([treeBm("b"), { type: "folder", id: "f1", name: "f1", children: [treeBm("d"), treeBm("a")] }]);
  const items = store.loadLocal().bookmarks.items;
  assert.deepEqual([items.a.parentId, items.a._order], ["f1", 1]);
  assert.deepEqual(keptOf(store, ["b", "f1", "d", "a"]), [true, true, true, false]);
});

test("순서 값이 같으면 id 순서로 놓는다 — 두 기기가 동시에 맨 앞으로 옮겨도 어느 기기에서나 같은 순서다", () => {
  // 두 기기가 서로 다른 항목을 맨 앞으로 옮기면 둘 다 같은 값(-1)을 받는다. 값이 같을 때 문서의 키 순서를 따르면,
  // 병합은 자기 기기의 키를 먼저 넣으므로 기기마다 순서가 달랐다(4차 리뷰).
  const store = seeded({ y: [-1, null], x: [-1, null], a: [0, null] });
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["x", "y", "a"]);
});

test("값을 더 나눌 수 없으면 그 폴더만 0부터 다시 매긴다", () => {
  const store = seeded({ a: [1, null], b: [1 + Number.EPSILON, null] });
  store.saveBookmarks([treeBm("a"), treeBm("x"), treeBm("b")]);
  assert.deepEqual(ordersOf(store, ["a", "x", "b"]), [0, 1, 2]);
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["a", "x", "b"]);
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

// ── 이전 수정 시각보다 늦은 시각으로 기록하기 (known-issues §39, 사용자 결정 2026-10-30) ──
// 새 수정 시각은 기기 시각과 「그 기록의 이전 수정 시각보다 1밀리초 늦은 시각」 가운데 늦은 쪽이다. 기기 시각만 기록하던 때는 시계가 느린 기기에서 받은 뒤
// 고친 내용이 먼저 고친 사본에 덮어써졌다.

const T = Date.UTC(2026, 9, 30, 12);          // 시계가 맞는 기기가 고친 시각
const SLOW = T - 10 * 60e3 + 60e3;            // 시계가 10분 느린 기기에서 1분 뒤
const bm = (extra = {}) => ({ id: "a", type: "bookmark", bookId: "gen", chapter: 1, note: "", parentId: null, _order: 0, _u: T, ...extra });
const stored = (d) => ({ "bible-bookmarks-v2": JSON.stringify(d) });
const remoteWith = (d) => ({ ...d, schemaVersion: 2, deviceId: "other" });

test("시계가 느린 기기가 받은 북마크를 고치면 이전 수정 시각보다 늦은 시각으로 기록하고, 병합하면 그 편집이 남는다", () => {
  const received = doc({ items: { a: bm() } });
  const { store } = load(stored(received), { now: SLOW });
  const tree = store.loadBookmarks();
  tree[0].note = "느린 기기가 나중에 고침";
  store.saveBookmarks(tree);
  const local = plain(store.loadLocal());
  assert.equal(local.bookmarks.items.a._u, T + 1);
  const merged = plain(store.mergeDocs(local, remoteWith(received), "slow"));
  assert.equal(merged.bookmarks.items.a.note, "느린 기기가 나중에 고침");
});

test("시계가 느린 기기가 방금 받은 북마크를 지우면 삭제 기록이 그 북마크보다 늦어서, 다음 병합에서 되살아나지 않는다", () => {
  const received = doc({ items: { a: bm() } });
  const { store } = load(stored(received), { now: SLOW });
  store.saveBookmarks([]);
  const local = plain(store.loadLocal());
  assert.equal(local.bookmarks.tombstones.a, T + 1);
  const merged = plain(store.mergeDocs(local, remoteWith(received), "slow"));
  assert.equal("a" in merged.bookmarks.items, false);
  assert.equal(merged.bookmarks.tombstones.a, T + 1);
});

test("같은 id의 삭제 기록이 기기 시각보다 늦은 시각이어도, 다시 넣은 북마크는 보인다 — 백업에서 되살릴 때", () => {
  const ahead = T + 3600e3;                     // 시각이 빠른 기기가 남긴 삭제 기록
  const { store } = load(stored(doc({ tombstones: { a: ahead } })), { now: T });
  store.saveBookmarks([{ id: "a", type: "bookmark", bookId: "gen", chapter: 1, note: "" }]);
  assert.equal(plain(store.loadLocal()).bookmarks.items.a._u, ahead + 1);
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["a"]);
});

test("설정과 읽던 위치도 그 값의 이전 수정 시각보다 늦은 시각으로 기록한다", () => {
  const received = doc({ settings: { theme: { v: "dark", _u: T } }, lastRead: { v: { bookId: "gen", chapter: 1 }, _u: T } });
  const { store } = load(stored(received), { now: SLOW });
  store.saveSetting("theme", "light");
  store.saveLastRead({ bookId: "john", chapter: 3 });
  const local = plain(store.loadLocal());
  assert.deepEqual(local.settings.theme, { v: "light", _u: T + 1 });
  assert.deepEqual(local.lastRead, { v: { bookId: "john", chapter: 3 }, _u: T + 1 });
});

test("시계가 맞으면 기기 시각을 그대로 기록한다", () => {
  const { store } = load(stored(doc({ items: { a: bm() }, settings: { theme: { v: "dark", _u: T } } })), { now: T + 5000 });
  const tree = store.loadBookmarks();
  tree[0].note = "고침";
  store.saveBookmarks(tree);
  store.saveSetting("theme", "light");
  const local = plain(store.loadLocal());
  assert.equal(local.bookmarks.items.a._u, T + 5000);
  assert.equal(local.settings.theme._u, T + 5000);
});

test("숫자가 아닌 이전 시각은 0으로 본다 — 새 시각이 숫자가 아닌 값이 되지 않는다", () => {
  const { store } = load(stored(doc({ items: { a: bm({ _u: "bad" }) }, settings: { theme: { v: "dark", _u: null } } })), { now: T });
  const tree = store.loadBookmarks();
  tree[0].note = "고침";
  store.saveBookmarks(tree);
  store.saveSetting("theme", "light");
  const local = plain(store.loadLocal());
  assert.equal(local.bookmarks.items.a._u, T);
  assert.equal(local.settings.theme._u, T);
});

// ── 문서 지문 (known-issues §38, 사용자 결정 2026-10-31) ──

test("지문은 키 순서와 문서 맨 위의 다른 필드에 상관없고, 내용이 바뀌면 달라진다", () => {
  const { store } = load();
  const a = doc({ items: { a: bm(), b: bm({ id: "b", _order: 1 }) }, settings: { theme: { v: "dark", _u: T } } });
  const reordered = {
    lastRead: a.lastRead, settings: { theme: { _u: T, v: "dark" } },
    bookmarks: { tombstones: {}, items: { b: bm({ id: "b", _order: 1 }), a: { ...bm(), _u: T } } },
    schemaVersion: 2, deviceId: "x",
  };
  assert.equal(store.fingerprint(reordered), store.fingerprint(a));
  assert.notEqual(store.fingerprint(doc({ items: { a: bm({ note: "고침" }), b: bm({ id: "b", _order: 1 }) }, settings: a.settings })), store.fingerprint(a));
});

test("가장 늦은 수정 시각이 같아도 북마크가 늘면 지문이 달라진다 — 시계가 느린 기기의 새 북마크", () => {
  const { store } = load();
  const synced = doc({ items: { a: bm() } });
  const withNew = doc({ items: { a: bm(), b: bm({ id: "b", _order: 1, _u: SLOW }) } });
  assert.equal(store.maxU(withNew), store.maxU(synced));
  assert.notEqual(store.fingerprint(withNew), store.fingerprint(synced));
});

test("시계가 느린 기기가 받은 북마크를 다른 폴더로 옮기면 이전 수정 시각보다 늦은 시각으로 기록한다", () => {
  const received = doc({ items: {
    f: { id: "f", type: "folder", name: "폴더", parentId: null, _order: 0, _u: T },
    a: bm({ _order: 1 }),
  } });
  const { store } = load(stored(received), { now: SLOW });
  const tree = plain(store.loadBookmarks());
  const a = tree.find((n) => n.id === "a");
  const folder = tree.find((n) => n.id === "f");
  folder.children = [a];
  store.saveBookmarks([folder]);
  const local = plain(store.loadLocal());
  assert.equal(local.bookmarks.items.a.parentId, "f");
  assert.equal(local.bookmarks.items.a._u, T + 1);
  assert.equal(local.bookmarks.items.f._u, T, "자리와 내용이 그대로인 폴더는 시각을 그대로 둔다");
});

test("저장된 삭제 기록에 가려진 북마크를 같은 내용으로 다시 넣어도 보인다 — 옛 버전이 남긴 상태", () => {
  const ahead = T + 3600e3;
  const { store } = load(stored(doc({ items: { a: bm() }, tombstones: { a: ahead } })), { now: T });
  assert.deepEqual(plain(store.loadBookmarks()), [], "삭제 기록이 더 늦어 가려져 있다");
  const { _u, parentId, _order, ...node } = bm();
  store.saveBookmarks([node]);
  assert.equal(plain(store.loadLocal()).bookmarks.items.a._u, ahead + 1);
  assert.deepEqual(plain(store.loadBookmarks()).map((n) => n.id), ["a"]);
});

test("지문은 설정과 읽던 위치가 바뀌어도 달라진다", () => {
  const { store } = load();
  const base = doc({ settings: { theme: { v: "dark", _u: T } }, lastRead: { v: { bookId: "gen", chapter: 1 }, _u: T } });
  const setting = doc({ settings: { theme: { v: "light", _u: T } }, lastRead: base.lastRead });
  const reading = doc({ settings: base.settings, lastRead: { v: { bookId: "gen", chapter: 2 }, _u: T } });
  assert.notEqual(store.fingerprint(setting), store.fingerprint(base));
  assert.notEqual(store.fingerprint(reading), store.fingerprint(base));
});

test("아주 깊게 중첩된 필드가 있어도 지문 계산이 멈추지 않고 빈 값을 돌려준다", () => {
  // 가져오기는 모르는 필드를 그대로 두므로 이런 북마크도 저장되고 올라간다. 지문 계산이 예외를 내면 동기화 전체가
  // 오류로 끝났다(2026-10-31 리뷰). 빈 값은 저장된 어느 지문과도 같지 않아 304 경로가 올린다.
  const { store } = load();
  let deep = {};
  for (let i = 0; i < 20000; i++) deep = { x: deep };
  assert.equal(store.fingerprint(doc({ items: { a: bm({ extra: deep }) } })), "");
});
