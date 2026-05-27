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
  nodes.forEach((node, idx) => {
    // `children` and `_u` are stripped/overridden; everything else is spread as-is.
    const { children, ...rest } = /** @type {BookmarkTreeNode & { _u?: number }} */ (node);
    out[node.id] = /** @type {SyncFlatItem} */ ({
      ...rest,
      parentId: parentId ?? null,
      _order:   idx,
      _u:       rest._u ?? now,
    });
    if (Array.isArray(children) && children.length) {
      _flattenTree(children, node.id, out, now);
    }
  });
  return out;
}

// Reconstruct a bookmark tree from a flat map.
// Tombstoned items must already be filtered out before calling.
/**
 * @param {{ [id: string]: SyncFlatItem }} items
 * @returns {BookmarkTreeNode[]}
 */
function bookmarkTreeFromFlat(items) {
  /** @type {{ [parentId: string]: SyncFlatItem[] }} */
  const byParent = {};
  for (const node of Object.values(items)) {
    const p = node.parentId ?? "";
    (byParent[p] ??= []).push(node);
  }
  /**
   * @param {string} parentId
   * @returns {BookmarkTreeNode[]}
   */
  function build(parentId) {
    return (byParent[parentId] ?? [])
      .sort((a, b) => (a._order ?? 0) - (b._order ?? 0))
      .map((flat) => {
        const { parentId: _p, _order: _o, _u: _t, ...rest } = flat;
        const kids = build(rest.id);
        if (kids.length)             return /** @type {BookmarkTreeNode} */ ({ ...rest, children: kids });
        if (rest.type === "folder")  return /** @type {BookmarkTreeNode} */ ({ ...rest, children: [] });
        return /** @type {BookmarkTreeNode} */ (rest);
      });
  }
  return build("");
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
  const { id, type, name, bookId, chapter, vref, verseSpec, color, label, note } = node;
  return JSON.stringify({ id, type, name, bookId, chapter, vref, verseSpec, color, label, note });
}

// Save a bookmark tree into v2 flat-map, preserving _u for unchanged items
// and adding tombstones for removed items.
/** @param {BookmarkTreeNode[]} tree */
function saveBookmarks(tree) {
  const now = Date.now();
  const doc = loadLocal();
  const oldItems = doc.bookmarks.items;
  const newFlat  = _flattenTree(tree, null, {}, now);

  /** @type {{ [id: string]: SyncFlatItem }} */
  const nextItems = {};
  for (const [id, node] of Object.entries(newFlat)) {
    const old = oldItems[id];
    const sameContent  = old && _contentKey(old)  === _contentKey(node);
    const samePosition = old && old._order         === node._order
                              && old.parentId       === node.parentId;
    nextItems[id] = { ...node, _u: (sameContent && samePosition) ? (old._u ?? now) : now };
  }

  // Items removed → tombstone (only if not already tombstoned with a newer time).
  for (const id of Object.keys(oldItems)) {
    if (!nextItems[id] && !(doc.bookmarks.tombstones[id] > now)) {
      doc.bookmarks.tombstones[id] = now;
    }
  }

  doc.bookmarks.items = nextItems;
  saveLocal(doc);
}

// Load and reconstruct the bookmark tree, filtering out tombstoned items.
/** @returns {BookmarkTreeNode[]} */
function loadBookmarks() {
  const doc = loadLocal();
  const { items, tombstones } = doc.bookmarks;
  /** @type {{ [id: string]: SyncFlatItem }} */
  const alive = {};
  for (const [id, node] of Object.entries(items)) {
    if (!(tombstones[id] > node._u)) alive[id] = node;
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
    const L  = local.bookmarks?.items?.[id];
    const R  = remote.bookmarks?.items?.[id];
    const LT = local.bookmarks?.tombstones?.[id]  ?? -Infinity;
    const RT = remote.bookmarks?.tombstones?.[id] ?? -Infinity;
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

  // Settings: per-key LWW. Object.keys() is `string[]`, so cast to SettingKey.
  for (const key of /** @type {SettingKey[]} */ (Object.keys(merged.settings))) {
    const lv = local.settings?.[key]  ?? { v: null, _u: 0 };
    const rv = remote.settings?.[key] ?? { v: null, _u: 0 };
    merged.settings[key] = /** @type {SyncDoc["settings"][SettingKey]} */ (rv._u >= lv._u ? rv : lv);
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
// Remove tombstones older than ageDays (default 30). Safe to call anytime;
// only persists if there's anything to remove.
/** @param {number} [ageDays] */
function sweepTombstones(ageDays = 30) {
  const cutoff = Date.now() - ageDays * 864e5;
  const doc = loadLocal();
  const before = Object.keys(doc.bookmarks.tombstones).length;
  for (const [id, ts] of Object.entries(doc.bookmarks.tombstones)) {
    if (ts < cutoff) delete doc.bookmarks.tombstones[id];
  }
  if (Object.keys(doc.bookmarks.tombstones).length < before) saveLocal(doc);
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
    if (!(tombstones?.[id] > node._u)) alive[id] = node;
  }
  const tree = bookmarkTreeFromFlat(alive);
  localStorage.setItem("bible-bookmarks", JSON.stringify(tree));
}

window.syncStoreV2 = {
  getDeviceId,
  loadLocal, saveLocal,
  sweepTombstones,
  loadBookmarks, saveBookmarks,
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
