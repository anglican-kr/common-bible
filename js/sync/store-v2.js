// @ts-check
// ── Sync Store v2 ─────────────────────────────────────────────────────────────
// Per-record mtime (_u) + tombstones + flat-map bookmark storage.
// Provides: loadLocal, saveLocal, loadBookmarks, saveBookmarks, save*/lastRead,
//           migrateLegacyIfNeeded, mergeDocs, buildSyncPayload, applyToLegacyKeys.
//
// v2 layout in localStorage:
//   "bible-sync-meta"       { schemaVersion: 2, deviceId }
//   "bible-bookmarks-v2"    { bookmarks: {items, tombstones}, settings, lastRead }

/** @typedef {import("../types").SyncDoc}            SyncDoc */
/** @typedef {import("../types").SyncFlatItem}       SyncFlatItem */
/** @typedef {import("../types").BookmarkTreeNode}   BookmarkTreeNode */
/** @typedef {import("../types").SettingKey}         SettingKey */
/** @typedef {import("../types").LastReadValue}      LastReadValue */

const _META_KEY  = "bible-sync-meta";
const _STORE_KEY = "bible-bookmarks-v2";

/** @type {Record<SettingKey, string>} */
const _SETTING_LS_KEYS = {
  fontSize:        "bible-font-size",
  colorScheme:     "bible-color-scheme",
  theme:           "bible-theme",
  bookOrder:       "bible-book-order",
  startupBehavior: "bible-startup",
  citeShow:        "bible-cite-show",
  audioShow:       "bible-audio-show",
};
const _LR_KEY = "bible-last-read";

// ── Device ID ─────────────────────────────────────────────────────────────────

/** @returns {string} */
function _uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** @returns {{ schemaVersion: 2; deviceId: string }} */
function _getOrCreateMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(_META_KEY) ?? "null");
    if (m?.schemaVersion === 2 && m.deviceId) return m;
  } catch {}
  /** @type {{ schemaVersion: 2; deviceId: string }} */
  const meta = { schemaVersion: 2, deviceId: _uuid() };
  localStorage.setItem(_META_KEY, JSON.stringify(meta));
  return meta;
}

/** @returns {string} */
function getDeviceId() { return _getOrCreateMeta().deviceId; }

// ── Flat-map helpers ──────────────────────────────────────────────────────────

// An id-keyed map's own entry, or undefined. Items and tombstones are plain objects keyed by id, and a plain object
// answers every name it inherits from Object.prototype (toString, constructor, …) with a function — an id the
// import check (ADR-040) leaves out, but one a pre-check import (1.6.4 and before) still brings in through sync.
/**
 * @template T
 * @param {{ [id: string]: T } | undefined} map
 * @param {string} id
 * @returns {T | undefined}
 */
function _own(map, id) {
  return map != null && Object.hasOwn(map, id) ? map[id] : undefined;
}

// Recursively walk a bookmark tree and produce a flat {[id]: node} map.
// Each node gets parentId and _order; _u is preserved if already set.
/**
 * @param {BookmarkTreeNode[]} nodes
 * @param {string | null} parentId
 * @param {{ [id: string]: SyncFlatItem }} out
 * @param {number} now
 * @returns {{ [id: string]: SyncFlatItem }}
 */
function _flattenTree(nodes, parentId, out, now) {
  let order = 0;
  /** @param {BookmarkTreeNode[]} level */
  const place = (level) => level.forEach((node) => {
    // Assigning "__proto__" would rewrite `out`'s prototype instead of adding an entry, so the store does not hold
    // this id (mergeDocs skips it too). A folder of that id gives its place to what it holds: dropped with it, they
    // would turn into tombstones on the next save and vanish from every device (PR #438 review).
    if (node.id === "__proto__") {
      if (Array.isArray(node.children)) place(node.children);
      return;
    }
    // `children` and `_u` are stripped/overridden; everything else is spread as-is.
    const { children, ...rest } = /** @type {BookmarkTreeNode & { _u?: number }} */ (node);
    out[node.id] = /** @type {SyncFlatItem} */ ({
      ...rest,
      parentId: parentId ?? null,
      _order:   order++,
      _u:       rest._u ?? now,
    });
    if (Array.isArray(children) && children.length) {
      _flattenTree(children, node.id, out, now);
    }
  });
  place(nodes);
  return out;
}

// Reconstruct a bookmark tree from a flat map.
// Tombstoned items must already be filtered out before calling.
/**
 * @param {{ [id: string]: SyncFlatItem }} items
 * @returns {BookmarkTreeNode[]}
 */
function bookmarkTreeFromFlat(items) {
  // A Map, not a plain object: every id is looked up here as a parent, and a plain object's inherited names
  // (toString …) made the whole list fail to load (known-issues §15.2).
  /** @type {Map<string, SyncFlatItem[]>} */
  const byParent = new Map();
  for (const node of Object.values(items)) {
    const p = node.parentId ?? "";
    const siblings = byParent.get(p);
    if (siblings) siblings.push(node);
    else byParent.set(p, [node]);
  }
  /**
   * @param {string} parentId
   * @returns {BookmarkTreeNode[]}
   */
  function build(parentId) {
    return (byParent.get(parentId) ?? [])
      // Equal values break on id: two devices that each move an item to the front give both the same value, and the
      // document's key order (each merge puts its own keys first) showed them differently per device (4th review).
      .sort((a, b) => (a._order ?? 0) - (b._order ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((flat) => {
        const { parentId: _p, _order: _o, _u: _t, ...rest } = flat;
        const kids = build(rest.id);
        if (kids.length)             return /** @type {BookmarkTreeNode} */ ({ ...rest, children: kids });
        if (rest.type === "folder")  return /** @type {BookmarkTreeNode} */ ({ ...rest, children: [] });
        return /** @type {BookmarkTreeNode} */ (rest);
      });
  }
  // No item has the id "__proto__" (_flattenTree), but an older build saved what such a folder held under it as the
  // parent: nothing reached those items, and the next save tombstoned them on every device (PR #438 review). They are
  // read after the top level — their _order was counted inside the lost folder, so mixed in they would reorder the
  // untouched top-level items, whose new times would then beat other devices' edits (2nd review).
  return [...build(""), ...build("__proto__")];
}

// ── Empty document ────────────────────────────────────────────────────────────

/** @returns {SyncDoc} */
function _emptyDoc() {
  return {
    bookmarks: { items: {}, tombstones: {} },
    settings: {
      fontSize:        { v: null, _u: 0 },
      colorScheme:     { v: null, _u: 0 },
      theme:           { v: null, _u: 0 },
      bookOrder:       { v: null, _u: 0 },
      startupBehavior: { v: null, _u: 0 },
      citeShow:        { v: null, _u: 0 },
      audioShow:       { v: null, _u: 0 },
    },
    lastRead: { v: null, _u: 0 },
  };
}

// ── Load / Save ───────────────────────────────────────────────────────────────

/** @returns {SyncDoc} */
function loadLocal() {
  try {
    const raw = localStorage.getItem(_STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return _emptyDoc();
}

/** @param {SyncDoc} doc */
function saveLocal(doc) {
  try { localStorage.setItem(_STORE_KEY, JSON.stringify(doc)); } catch {}
}

// ── Bookmark CRUD (tree ↔ flat-map) ──────────────────────────────────────────

// Stable content fingerprint for conflict detection (excludes positional fields).
/**
 * @param {SyncFlatItem} node
 * @returns {string}
 */
function _contentKey(node) {
  // createdAt/updatedAt are content: include them so an edit that bumps only
  // updatedAt (e.g. a no-op re-save) still bumps _u and therefore syncs. Without
  // this, "수정한 날짜" could change locally yet never propagate after merge.
  const { id, type, name, bookId, chapter, vref, verseSpec, color, label, note, createdAt, updatedAt } = node;
  return JSON.stringify({ id, type, name, bookId, chapter, vref, verseSpec, color, label, note, createdAt, updatedAt });
}

// The _order values for one list of siblings, in display order. `stored[i]` is that sibling's stored _order if it sat
// under the same parent before, else undefined. The longest run of stored values that still increases keeps them;
// the rest (moved or new) get values between their kept neighbours: steps of 1 from the left neighbour when they fit
// below the right one, else even fractions. When the numbers can no longer be told apart, the list is renumbered from 0.
/** @param {Array<number | undefined>} stored @returns {number[]} */
function _keepOrders(stored) {
  const n = stored.length;
  /** @type {number[]} */
  const tails = [];   // tails[k]: index ending the best increasing run of length k + 1
  const prev = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const v = stored[i];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (/** @type {number} */ (stored[tails[mid]]) < v) lo = mid + 1; else hi = mid; }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }
  const keep = new Array(n).fill(false);
  for (let i = tails.length ? tails[tails.length - 1] : -1; i !== -1; i = prev[i]) keep[i] = true;

  /** @type {number[]} */
  const out = new Array(n);
  for (let i = 0; i < n; ) {
    if (keep[i]) { out[i] = /** @type {number} */ (stored[i]); i++; continue; }
    let j = i;
    while (j < n && !keep[j]) j++;
    const k = j - i, lo = i > 0 ? out[i - 1] : -Infinity, hi = j < n ? /** @type {number} */ (stored[j]) : Infinity;
    for (let t = 0; t < k; t++) {
      out[i + t] = lo === -Infinity && hi === Infinity ? t
        : hi === Infinity ? lo + 1 + t
        : lo === -Infinity ? hi - k + t
        : hi - lo > k ? lo + 1 + t
        : lo + ((hi - lo) * (t + 1)) / (k + 1);
    }
    i = j;
  }
  for (let i = 1; i < n; i++) if (!(out[i] > out[i - 1])) return out.map((_, idx) => idx);
  return out;
}

// The document saveBookmarks(tree) writes — the stored one with `tree` flattened in, _u preserved for unchanged
// items and tombstones added for removed ones — built without writing it.
/** @param {BookmarkTreeNode[]} tree @returns {SyncDoc} */
function _docWithBookmarks(tree) {
  const now = Date.now();
  const doc = loadLocal();
  const oldItems = doc.bookmarks.items;
  const newFlat  = _flattenTree(tree, null, {}, now);

  // An item whose place among its siblings is unchanged keeps its stored _order, so a removal or a move re-times only
  // what moved. Renumbered from 0, every later sibling took a new _u and beat other devices' edits of it
  // (PR #438 review, 사용자 결정 2026-10-26).
  /** @type {Map<string | null, SyncFlatItem[]>} */
  const siblings = new Map();
  for (const node of Object.values(newFlat)) {
    const list = siblings.get(node.parentId);
    if (list) list.push(node);
    else siblings.set(node.parentId, [node]);
  }
  for (const [parentId, list] of siblings) {
    list.sort((a, b) => a._order - b._order);   // _flattenTree's 0, 1, 2 …: Object.values lists numeric-looking ids first
    const stored = list.map((node) => {
      const old = _own(oldItems, node.id);
      return old && (old.parentId ?? null) === parentId ? old._order : undefined;
    });
    _keepOrders(stored).forEach((order, i) => { list[i]._order = order; });
  }

  /** @type {{ [id: string]: SyncFlatItem }} */
  const nextItems = {};
  for (const [id, node] of Object.entries(newFlat)) {
    const old = _own(oldItems, id);
    const sameContent  = old && _contentKey(old)  === _contentKey(node);
    const samePosition = old && old._order         === node._order
                              && old.parentId       === node.parentId;
    nextItems[id] = { ...node, _u: (sameContent && samePosition) ? (old._u ?? now) : now };
  }

  // Items removed → tombstone (only if not already tombstoned with a newer time).
  for (const id of Object.keys(oldItems)) {
    if (!Object.hasOwn(nextItems, id) && !((_own(doc.bookmarks.tombstones, id) ?? -Infinity) > now)) {
      doc.bookmarks.tombstones[id] = now;
    }
  }

  doc.bookmarks.items = nextItems;
  return doc;
}

// Save a bookmark tree into v2 flat-map, preserving _u for unchanged items
// and adding tombstones for removed items.
/** @param {BookmarkTreeNode[]} tree */
function saveBookmarks(tree) {
  saveLocal(_docWithBookmarks(tree));
}

// This store's localStorage entry once saveBookmarks(tree) ran — its key, and the characters of key and value. The
// bookmark import adds it up with the rest before saving (storage.js projectedStorageChars, ADR-040): measured from
// the very document saveBookmarks writes, so a parentId repeated under every child and the tombstones an overwrite
// leaves are counted as they will be stored.
/** @param {BookmarkTreeNode[]} tree @returns {{ key: string, chars: number }} */
function projectedBookmarksEntry(tree) {
  return { key: _STORE_KEY, chars: _STORE_KEY.length + JSON.stringify(_docWithBookmarks(tree)).length };
}

// Load and reconstruct the bookmark tree, filtering out tombstoned items.
/** @returns {BookmarkTreeNode[]} */
function loadBookmarks() {
  const doc = loadLocal();
  const { items, tombstones } = doc.bookmarks;
  /** @type {{ [id: string]: SyncFlatItem }} */
  const alive = {};
  for (const [id, node] of Object.entries(items)) {
    if (!((_own(tombstones, id) ?? -Infinity) > node._u)) alive[id] = node;
  }
  return bookmarkTreeFromFlat(alive);
}

// ── Settings / lastRead ───────────────────────────────────────────────────────

/**
 * @param {SettingKey} key
 * @param {unknown} value
 */
function saveSetting(key, value) {
  const doc = loadLocal();
  // Settings store wraps every value in MTimed<T>; the per-key value type
  // is intentionally permissive (number for fontSize, string for the rest).
  doc.settings[key] = /** @type {SyncDoc["settings"][SettingKey]} */ ({ v: value, _u: Date.now() });
  saveLocal(doc);
}

/** @param {LastReadValue} value */
function saveLastRead(value) {
  const doc = loadLocal();
  doc.lastRead = { v: value, _u: Date.now() };
  saveLocal(doc);
}

// ── Migration v0/v1 → v2 ─────────────────────────────────────────────────────

function migrateLegacyIfNeeded() {
  if (localStorage.getItem(_STORE_KEY)) return; // already migrated

  const now = Date.now();
  const doc = _emptyDoc();

  // Bookmarks: detect v0 (bare array) or v1 ({ _version:1, items:[...] }).
  try {
    const raw = localStorage.getItem("bible-bookmarks");
    if (raw) {
      const parsed = JSON.parse(raw);
      const tree = Array.isArray(parsed)
        ? parsed
        : (parsed?._version === 1 && Array.isArray(parsed.items) ? parsed.items : []);
      _flattenTree(tree, null, doc.bookmarks.items, now);
    }
  } catch {}

  // Settings: _u = 0 so that any remote data wins on first sync.
  for (const [key, lsKey] of Object.entries(_SETTING_LS_KEYS)) {
    const raw = localStorage.getItem(lsKey);
    if (raw !== null) {
      let v; try { v = JSON.parse(raw); } catch { v = raw; }
      doc.settings[/** @type {SettingKey} */ (key)] = /** @type {SyncDoc["settings"][SettingKey]} */ ({ v, _u: 0 });
    }
  }

  // lastRead
  try {
    const raw = localStorage.getItem(_LR_KEY);
    if (raw) doc.lastRead = { v: JSON.parse(raw), _u: 0 };
  } catch {}

  saveLocal(doc);
  _getOrCreateMeta();
}

// ── Merge ─────────────────────────────────────────────────────────────────────

// Returns the maximum _u across all records in a doc (for quick staleness check).
/**
 * @param {SyncDoc} doc
 * @returns {number}
 */
function maxU(doc) {
  let m = 0;
  for (const n of Object.values(doc.bookmarks?.items    ?? {})) m = Math.max(m, n._u ?? 0);
  for (const t of Object.values(doc.bookmarks?.tombstones ?? {})) m = Math.max(m, t);
  for (const s of Object.values(doc.settings ?? {})) m = Math.max(m, s._u ?? 0);
  if (doc.lastRead?._u) m = Math.max(m, doc.lastRead._u);
  return m;
}

// Per-record LWW merge. Conflict policy: higher _u wins; tie → deviceId sort.
/**
 * @param {SyncDoc} local
 * @param {SyncDoc} remote
 * @param {string} deviceId
 * @returns {SyncDoc}
 */
function mergeDocs(local, remote, deviceId) {
  const merged = _emptyDoc();
  const remoteDeviceId = remote.deviceId ?? "";

  // Bookmarks
  const allIds = new Set([
    ...Object.keys(local.bookmarks?.items    ?? {}),
    ...Object.keys(remote.bookmarks?.items   ?? {}),
    ...Object.keys(local.bookmarks?.tombstones  ?? {}),
    ...Object.keys(remote.bookmarks?.tombstones ?? {}),
  ]);

  for (const id of allIds) {
    // A parsed doc can carry "__proto__" as an own key; assigning it would
    // rewrite the merged object's prototype instead of adding an entry.
    if (id === "__proto__") continue;
    // Own entries only: an id one side lacks read an inherited function there, the death time became NaN, and
    // the item was dropped as dead on both sides (known-issues §15.2).
    const L  = _own(local.bookmarks?.items, id);
    const R  = _own(remote.bookmarks?.items, id);
    const LT = _own(local.bookmarks?.tombstones, id)  ?? -Infinity;
    const RT = _own(remote.bookmarks?.tombstones, id) ?? -Infinity;
    const death = Math.max(LT, RT);
    const aliveL = L && L._u > death;
    const aliveR = R && R._u > death;

    if (!aliveL && !aliveR) {
      if (isFinite(death)) merged.bookmarks.tombstones[id] = death;
    } else if (aliveL && aliveR) {
      if (L._u !== R._u)         merged.bookmarks.items[id] = L._u > R._u ? L : R;
      else                       merged.bookmarks.items[id] = deviceId <= remoteDeviceId ? L : R;
    } else {
      merged.bookmarks.items[id] = /** @type {SyncFlatItem} */ (aliveL ? L : R);
    }
  }

  // Settings: per-key LWW over the **union** of both docs' keys. Iterating only
  // the keys this build knows (_emptyDoc) would silently drop a setting written
  // by a newer client: this device would upload a doc without it, and the other
  // device would see its own setting deleted on the next sync.
  const settingKeys = new Set([
    ...Object.keys(merged.settings),
    ...Object.keys(local.settings  ?? {}),
    ...Object.keys(remote.settings ?? {}),
  ]);
  for (const key of settingKeys) {
    if (key === "__proto__") continue; // same prototype-rewrite guard as above
    const lv = local.settings?.[key]  ?? { v: null, _u: 0 };
    const rv = remote.settings?.[key] ?? { v: null, _u: 0 };
    merged.settings[key] = rv._u >= lv._u ? rv : lv;
  }

  // lastRead: LWW
  const ll = local.lastRead  ?? { v: null, _u: 0 };
  const rl = remote.lastRead ?? { v: null, _u: 0 };
  merged.lastRead = rl._u >= ll._u ? rl : ll;

  return merged;
}

// ── Sync payload (for upload) ─────────────────────────────────────────────────

/**
 * @param {string} deviceId
 * @returns {import("../types").SyncPayload}
 */
function buildSyncPayload(deviceId) {
  const doc = loadLocal();
  return { ...doc, schemaVersion: /** @type {2} */ (2), deviceId };
}

// Validate a remote doc is v2.
/**
 * @param {unknown} data
 * @returns {boolean}
 */
function validateRemote(data) {
  if (typeof data !== "object" || data === null) return false;
  const d = /** @type {{ schemaVersion?: unknown; bookmarks?: { items?: unknown } }} */ (data);
  return d.schemaVersion === 2 && typeof d.bookmarks?.items === "object";
}

// ── Tombstone GC ──────────────────────────────────────────────────────────────
// Remove bookmark tombstones and retired settings entries older than ageDays
// (default 30). Retiring a setting key = writing { v: null, _u: now }; once
// the null has had time to propagate to every device, the entry is dropped so
// renamed/removed keys don't ride the sync doc forever. Entries with _u === 0
// are the _emptyDoc defaults — every merge regenerates them, so sweeping them
// would only churn saveLocal. Safe to call anytime; only persists on removal.
/** @param {number} [ageDays] */
function sweepTombstones(ageDays = 30) {
  const cutoff = Date.now() - ageDays * 864e5;
  const doc = loadLocal();
  let removed = 0;
  for (const [id, ts] of Object.entries(doc.bookmarks.tombstones)) {
    if (ts < cutoff) { delete doc.bookmarks.tombstones[id]; removed++; }
  }
  for (const [key, s] of Object.entries(doc.settings ?? {})) {
    if (s?.v === null && s._u > 0 && s._u < cutoff) { delete doc.settings[key]; removed++; }
  }
  if (removed > 0) saveLocal(doc);
}

// ── Apply remote doc to localStorage legacy keys ──────────────────────────────
// Keeps existing app.js helpers (loadFontSize, loadTheme, etc.) working.

/** @param {SyncDoc} doc */
function applyToLegacyKeys(doc) {
  for (const [key, lsKey] of Object.entries(_SETTING_LS_KEYS)) {
    const s = doc.settings?.[/** @type {SettingKey} */ (key)];
    if (s?.v != null) localStorage.setItem(lsKey, typeof s.v === "string" ? s.v : JSON.stringify(s.v));
  }
  if (doc.lastRead?.v != null) localStorage.setItem(_LR_KEY, JSON.stringify(doc.lastRead.v));
  const { items, tombstones } = doc.bookmarks ?? { items: {}, tombstones: {} };
  /** @type {{ [id: string]: SyncFlatItem }} */
  const alive = {};
  for (const [id, node] of Object.entries(items)) {
    if (!((_own(tombstones, id) ?? -Infinity) > node._u)) alive[id] = node;
  }
  const tree = bookmarkTreeFromFlat(alive);
  localStorage.setItem("bible-bookmarks", JSON.stringify(tree));
}

window.syncStoreV2 = {
  getDeviceId,
  loadLocal, saveLocal,
  sweepTombstones,
  loadBookmarks, saveBookmarks, projectedBookmarksEntry,
  saveSetting, saveLastRead,
  migrateLegacyIfNeeded,
  mergeDocs, maxU,
  buildSyncPayload, validateRemote,
  bookmarkTreeFromFlat, applyToLegacyKeys,
};

// Marker so TypeScript treats this file as an ES module (function/typedef
// scope = module scope). Required because js/app/storage.js (ADR-018 Phase 2)
// also defines top-level `saveBookmarks`/`loadBookmarks`, which would
// otherwise collide at the global script scope. Other sync files reach
// these functions only through the `window.syncStoreV2` facade above, so
// no caller change is needed. See ADR-018 §"채택 방식 — module-vs-script 예외".
export {};
