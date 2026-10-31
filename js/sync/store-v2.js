// @ts-check
// ── Sync Store v2 ─────────────────────────────────────────────────────────────
// Per-record mtime (_u) + tombstones + flat-map bookmark storage.
// Provides: loadLocal, saveLocal, loadBookmarks, saveBookmarks, save*/lastRead,
//           migrateLegacyIfNeeded, mergeDocs, buildSyncPayload, applyToLegacyKeys,
//           saveBaseIds/clearBaseIds/goneFromDrive (the base list).
//
// v2 layout in localStorage:
//   "bible-sync-meta"       { schemaVersion: 2, deviceId }
//   "bible-bookmarks-v2"    { bookmarks: {items, tombstones}, settings, lastRead }
//   "bible-drive-base-ids"  { fileId, at, days: { [day]: [id, …] } } — this device only, never uploaded

/** @typedef {import("../types").SyncDoc}            SyncDoc */
/** @typedef {import("../types").SyncFlatItem}       SyncFlatItem */
/** @typedef {import("../types").BookmarkTreeNode}   BookmarkTreeNode */
/** @typedef {import("../types").SettingKey}         SettingKey */
/** @typedef {import("../types").LastReadValue}      LastReadValue */
/** @typedef {import("../types").SaveOutcome}        SaveOutcome */
/** @typedef {import("../types").DriveBaseIds}       DriveBaseIds */

const _META_KEY  = "bible-sync-meta";
const _STORE_KEY = "bible-bookmarks-v2";
const _LEGACY_BM_KEY = "bible-bookmarks";

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

/** @type {{ schemaVersion: 2; deviceId: string } | null} */
let _unsavedMeta = null;

// A full storage refuses even this small write. The id then lasts for the page load instead of throwing: drive-sync.js
// reads it as it loads (createSyncMachine), before app.js, and a throw there left the page without sync.
/** @returns {{ schemaVersion: 2; deviceId: string }} */
function _getOrCreateMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(_META_KEY) ?? "null");
    if (m?.schemaVersion === 2 && m.deviceId) return m;
  } catch {}
  /** @type {{ schemaVersion: 2; deviceId: string }} */
  const meta = _unsavedMeta ?? { schemaVersion: 2, deviceId: _uuid() };
  try { localStorage.setItem(_META_KEY, JSON.stringify(meta)); _unsavedMeta = null; } catch { _unsavedMeta = meta; }
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

// The time an edit records: this device's clock, or one past the times the record already holds, whichever is larger.
// The merge keeps the copy with the later time, so an edit made after receiving another device's copy stays even when
// this device's clock is behind (known-issues §39). 기록마다 그 기록의 이전 시각만 본다(사용자 결정 2026-10-30): 문서
// 전체의 가장 늦은 시각을 보면, 시각이 빠른 기기 하나가 모든 기록의 새 시각을 그 시각보다 늦게 만든다.
// A value that is not a finite number counts as 0: a numeric string from a damaged file would concatenate
// ("9999999999999" + 1) and push the new time thousands of years ahead.
/** @param {number} now @param {...unknown} prev @returns {number} */
function _after(now, ...prev) {
  let m = 0;
  for (const p of prev) if (typeof p === "number" && Number.isFinite(p) && p > m) m = p;
  return Math.max(now, m + 1);
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

// A store not written yet reads as the one migrateLegacyIfNeeded writes, and a store with no bookmark record takes the
// legacy key's list: a move the browser refused left no store, the reading position then wrote one with an empty
// list, migration took the key for done, and the next bookmark save put that list over the legacy one (known-issues
// §34). A bookmark save writes the whole document, so until one fits the list stays in the legacy key and shows from
// there. Settings and the reading position are saved without it (_load(false)) — a document with no bookmark record
// leaves the move to be done, and saved with it they were refused, then lost to the stored values once the move went
// through (pre-PR review).
/** @param {boolean} withLegacyList @returns {SyncDoc} */
function _load(withLegacyList) {
  try {
    const raw = localStorage.getItem(_STORE_KEY);
    if (!raw) return _docFromLegacyKeys(withLegacyList);
    const doc = JSON.parse(raw);
    if (withLegacyList && _holdsNoBookmarks(doc)) _addLegacyItems(doc.bookmarks.items);
    return doc;
  } catch {}
  return _emptyDoc();
}

/** @returns {SyncDoc} */
function loadLocal() { return _load(true); }

/** @param {unknown} err @returns {boolean} */
function _isQuotaError(err) {
  return /** @type {{ name?: unknown } | null} */ (err)?.name === "QuotaExceededError";
}

// Says what the write came to rather than swallowing a refusal: bookmark saves and the sync's merge result tell the
// user (known-issues §15.4). Settings and the reading position still ignore it.
// A full storage gives up the base list first and tries once more: nothing decides on the list yet, and the next
// saved merge writes it again (저장 공간이 부족하면 목록을 지운다, 사용자 결정 2026-10-31).
/** @param {SyncDoc} doc @returns {SaveOutcome} */
function saveLocal(doc) {
  let text;
  try { text = JSON.stringify(doc); } catch { return "failed"; }
  /** @returns {SaveOutcome} */
  const write = () => {
    try {
      localStorage.setItem(_STORE_KEY, text);
      return "saved";
    } catch (err) {
      return _isQuotaError(err) ? "full" : "failed";
    }
  };
  const outcome = write();
  return outcome === "full" && _dropBaseIds() ? write() : outcome;
}

// ── Base list ─────────────────────────────────────────────────────────────────
// The bookmark ids alive in the Drive file this device last downloaded and merged, each under the day this device
// first saw it in that file. It lives on this device only and names the file it was read from: another file (made
// again after 「파일도 삭제」, or another account's) starts a new list.
// 1단계(사용자 결정 2026-10-31): 목록을 저장만 하고 병합 판단에는 쓰지 않는다. 2단계에서는 이 기기에는 살아 있는데
// 드라이브에는 항목도 삭제 기록도 없는 북마크를, 목록에 있고 처음 본 지 30일이 넘었으면 다른 기기에서 지운 것으로 볼
// 계획이다(규칙 다). 그때까지는 그런 북마크의 수만 센다(goneFromDrive).
// Days are whole days of this device's clock since 1970-01-01 (UTC), grouped so an id costs its own characters only.
const _BASE_KEY = "bible-drive-base-ids";
const _DAY_MS = 864e5;
// The age past which rule 다 would read a missing bookmark as deleted elsewhere: more than this many whole days
// between the day it was first seen and today, so at least 30 days have passed (a day key covers the whole day).
const _BASE_AGE_DAYS = 30;

/** @returns {number} */
function _today() { return Math.floor(Date.now() / _DAY_MS); }

/** @returns {boolean} true when there was a list and it is gone */
function _dropBaseIds() {
  try {
    if (localStorage.getItem(_BASE_KEY) === null) return false;
    localStorage.removeItem(_BASE_KEY);
    return true;
  } catch { return false; }
}

function clearBaseIds() { _dropBaseIds(); }

// The stored list as id → day first seen, or null when there is none for `fileId`. A malformed list reads as none.
// An id under two days keeps the earlier one.
/** @param {string} fileId @returns {Map<string, number> | null} */
function _loadBaseIds(fileId) {
  try {
    const rec = JSON.parse(localStorage.getItem(_BASE_KEY) ?? "null");
    if (!rec || typeof rec !== "object" || rec.fileId !== fileId) return null;
    const days = rec.days;
    if (!days || typeof days !== "object") return null;
    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const [key, ids] of Object.entries(days)) {
      const day = Number(key);
      if (!Number.isInteger(day) || !Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id !== "string") continue;
        const prev = seen.get(id);
        if (prev === undefined || day < prev) seen.set(id, day);
      }
    }
    return seen;
  } catch { return null; }
}

// Ids of the bookmark items (folders too) a document holds alive: its time is later than its id's tombstone, the
// same test mergeDocs makes. "__proto__" is left out, as the merge leaves it out.
/** @param {SyncDoc} doc @returns {string[]} */
function _aliveIds(doc) {
  const items = doc?.bookmarks?.items ?? {};
  const tombs = doc?.bookmarks?.tombstones ?? {};
  /** @type {string[]} */
  const out = [];
  for (const [id, node] of Object.entries(items)) {
    if (id === "__proto__" || !node) continue;
    if (node._u > (_own(tombs, id) ?? -Infinity)) out.push(id);
  }
  return out;
}

// Writes the list from `remote`, the file just downloaded — not from what is uploaded next: Drive does not guard
// writes (known-issues §42), so an upload can be overwritten by a device that never saw it, and an id this device
// only sent must not read as one Drive held. An id the previous list (same file) held keeps its day, a new one gets
// today, and one the file no longer holds drops out. A refused write leaves no list rather than an old one.
/** @param {string} fileId @param {SyncDoc} remote @returns {boolean} whether the list is saved */
function saveBaseIds(fileId, remote) {
  try {
    const prev = _loadBaseIds(fileId);
    const today = _today();
    /** @type {DriveBaseIds} */
    const rec = { fileId, at: Date.now(), days: {} };
    for (const id of _aliveIds(remote)) {
      const day = prev?.get(id) ?? today;
      (rec.days[day] ??= []).push(id);
    }
    localStorage.setItem(_BASE_KEY, JSON.stringify(rec));
    return true;
  } catch {
    _dropBaseIds();
    return false;
  }
}

// The bookmarks rule 다 would drop in this merge: shown on this device, held by `remote` neither as an item nor as a
// tombstone, and in the list of this same file for more than _BASE_AGE_DAYS days. Stage 1 only counts them; the merge
// keeps them as before.
/** @param {string} fileId @param {SyncDoc} local @param {SyncDoc} remote @returns {string[]} */
function goneFromDrive(fileId, local, remote) {
  try {
    const seen = _loadBaseIds(fileId);
    if (!seen?.size) return [];
    const today = _today();
    const rItems = remote?.bookmarks?.items ?? {};
    const rTombs = remote?.bookmarks?.tombstones ?? {};
    return _aliveIds(local).filter((id) => {
      if (Object.hasOwn(rItems, id) || Object.hasOwn(rTombs, id)) return false;
      const day = seen.get(id);
      return day !== undefined && today - day > _BASE_AGE_DAYS;
    });
  } catch { return []; }
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
    // A changed item goes past its own time, and a new one past a tombstone of its id: a bookmark brought back from a
    // backup keeps its id, and a tombstone a slow-clock device wrote can be ahead of this clock. An unchanged item a
    // stored tombstone already hides (a state an older build could leave) goes past it too — kept at its time, a
    // bookmark brought back from a backup stayed hidden.
    const tomb = _own(doc.bookmarks.tombstones, id);
    const hidden = typeof tomb === "number" && tomb >= (old?._u ?? 0);
    nextItems[id] = { ...node, _u: (sameContent && samePosition && !hidden)
      ? (old._u ?? now)
      : _after(now, old?._u, tomb) };
  }

  // Items removed → tombstone past the item's own time (only if not already tombstoned with a newer time). At `now`
  // alone, a slow-clock device's tombstone for an item it had just received was older than the item, and the next
  // merge brought the item back.
  for (const id of Object.keys(oldItems)) {
    if (Object.hasOwn(nextItems, id)) continue;
    const t = _after(now, _own(oldItems, id)?._u);
    if (!((_own(doc.bookmarks.tombstones, id) ?? -Infinity) > t)) doc.bookmarks.tombstones[id] = t;
  }

  doc.bookmarks.items = nextItems;
  return doc;
}

// Save a bookmark tree into v2 flat-map, preserving _u for unchanged items
// and adding tombstones for removed items.
/** @param {BookmarkTreeNode[]} tree @returns {SaveOutcome} */
function saveBookmarks(tree) {
  return saveLocal(_docWithBookmarks(tree));
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
  const doc = _load(false);
  // Settings store wraps every value in MTimed<T>; the per-key value type
  // is intentionally permissive (number for fontSize, string for the rest).
  doc.settings[key] = /** @type {SyncDoc["settings"][SettingKey]} */ ({ v: value, _u: _after(Date.now(), doc.settings?.[key]?._u) });
  saveLocal(doc);
}

/** @param {LastReadValue} value */
function saveLastRead(value) {
  const doc = _load(false);
  doc.lastRead = { v: value, _u: _after(Date.now(), doc.lastRead?._u) };
  saveLocal(doc);
}

// ── Migration v0/v1 → v2 ─────────────────────────────────────────────────────

// Items read from the legacy key take time 0, as the moved settings do: an edit or a deletion made on another device
// wins the merge over them. A time of their own beat those — read again at each start, it was a new one each time,
// and the list it had sent to Drive came back over the other devices' edits (pre-PR review).
const _LEGACY_U = 0;

/** @param {SyncDoc} doc @returns {boolean} */
function _holdsNoBookmarks(doc) {
  return !Object.keys(doc.bookmarks.items).length && !Object.keys(doc.bookmarks.tombstones).length;
}

// The legacy key's list: v0 (bare array) or v1 ({ _version:1, items:[...] }); [] when there is none.
/** @returns {BookmarkTreeNode[]} */
function _legacyTree() {
  try {
    const raw = localStorage.getItem(_LEGACY_BM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed?._version === 1 && Array.isArray(parsed.items)) return parsed.items;
    }
  } catch {}
  return [];
}

// What of the legacy list reads as bookmarks: an entry that is not one (null …) ends the walk there, as the move
// always did, rather than failing the read — loadLocal then gave an empty document, and the move saved it over the
// stored settings and reading position at every start (pre-PR review).
/** @param {{ [id: string]: SyncFlatItem }} items */
function _addLegacyItems(items) {
  try { _flattenTree(_legacyTree(), null, items, _LEGACY_U); } catch {}
}

/** @param {boolean} withList @returns {SyncDoc} */
function _docFromLegacyKeys(withList) {
  const doc = _emptyDoc();
  if (withList) _addLegacyItems(doc.bookmarks.items);

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

  return doc;
}

// Done once the store holds a bookmark record or the legacy key holds no list — not once the store's key exists
// (known-issues §34). Until then it is tried at every start. Nothing here may throw: it runs at the top of app.js's
// startup, and a throw stops the rest of it (a storage the browser blocks throws on reading).
function migrateLegacyIfNeeded() {
  try {
    const raw = localStorage.getItem(_STORE_KEY);
    if (raw && !_holdsNoBookmarks(JSON.parse(raw))) return;
    const doc = loadLocal();
    if (raw && _holdsNoBookmarks(doc)) return;   // the legacy key holds no list either
    saveLocal(doc);
    _getOrCreateMeta();
  } catch {}
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

// JSON with every object's keys in sorted order, so the same content always gives the same text.
/** @param {unknown} v @returns {string} */
function _stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(_stableJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = /** @type {Record<string, unknown>} */ (v);
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${_stableJson(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// A short value that changes whenever the synced part of a document does (bookmarks, settings, reading position) —
// cyrb53 (53-bit) over the sorted JSON. The 304 path compares it with the value saved at the last sync to tell whether
// this device has anything to upload (known-issues §38). The largest time could not tell: a bookmark made on a
// slow-clock device, or one moved from an old build's list (time 0), keeps the largest time where it was.
/** @param {SyncDoc} doc @returns {string} */
function fingerprint(doc) {
  let s;
  // A value nested a few thousand levels deep (an import keeps unknown fields) overflows this walk before it would
  // overflow JSON.stringify, so such a doc was stored and uploaded and then failed the whole sync cycle here. "" matches
  // no saved fingerprint: the 304 path uploads instead.
  try {
    s = _stableJson({ bookmarks: doc?.bookmarks ?? null, settings: doc?.settings ?? null, lastRead: doc?.lastRead ?? null });
  } catch { return ""; }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Drive's copy with this device's expand state: its value, or no value when this device holds none. Leaving the key
// out (rather than setting it to undefined) keeps the fingerprint of the merge equal to that of the stored doc.
/**
 * @param {SyncFlatItem} remote
 * @param {SyncFlatItem} local
 * @returns {SyncFlatItem}
 */
function _withLocalExpand(remote, local) {
  const { expanded: _drop, ...rest } = remote;
  return Object.hasOwn(local, "expanded") ? { ...rest, expanded: local.expanded } : rest;
}

// Per-record merge: the copy with the later time stays. Equal times keep Drive's copy, as settings do, so every device
// on this version ends with the copy Drive holds — but for a folder's expand state, which stays this device's
// (_withLocalExpand). 시각이 같을 때 기기 id 순서에 따라 한쪽을 남기던 때는 비교 상대가 마지막으로 올린 기기라, 한 기기는
// 자기 사본을 남기고 시각이 같아 올리지도 않았다. 드라이브와 다른 기기는 다른 사본을 보였다(2026-10-31 리뷰, 사용자
// 결정).
/**
 * @param {SyncDoc} local
 * @param {SyncDoc} remote
 * @param {string} _deviceId  no longer used — ties keep Drive's copy; kept so the callers need not change
 * @returns {SyncDoc}
 */
function mergeDocs(local, remote, _deviceId) {
  const merged = _emptyDoc();

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
      // A folder keeps this device's expand state at equal times: it is no content (_contentKey leaves it out, so
      // opening a folder keeps its time), and taken from Drive it closed the folder the user had just opened (2026-10-31
      // 리뷰, 사용자 결정). A folder with no stored state keeps none, so it stays closed here too.
      merged.bookmarks.items[id] = L._u > R._u ? L
        : L._u === R._u && L.type === "folder" && L.expanded !== R.expanded ? _withLocalExpand(R, L)
        : R;
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

// ── Retired settings GC ───────────────────────────────────────────────────────
// Remove retired settings entries older than ageDays (default 30). Retiring a
// setting key = writing { v: null, _u: now }; once the null has had time to
// propagate to every device, the entry is dropped so renamed/removed keys
// don't ride the sync doc forever. Entries with _u === 0 are the _emptyDoc
// defaults — every merge regenerates them, so sweeping them would only churn
// saveLocal. Safe to call anytime; only persists on removal.
// 북마크 삭제 기록은 지우지 않는다(사용자 결정 2026-10-31, known-issues §39). Swept on this device only, a tombstone
// came back from Drive at the next merge, so the sweep freed nothing while sync was on; with sync off for more than
// 30 days it was gone before that merge, and a bookmark deleted meanwhile came back from Drive. Their cleanup waits
// for stage 2 of the base list.
/** @param {number} [ageDays] */
function sweepRetiredSettings(ageDays = 30) {
  const cutoff = Date.now() - ageDays * _DAY_MS;
  const doc = loadLocal();
  let removed = 0;
  for (const [key, s] of Object.entries(doc.settings ?? {})) {
    if (s?.v === null && s._u > 0 && s._u < cutoff) { delete doc.settings[key]; removed++; }
  }
  if (removed > 0) saveLocal(doc);
}

// ── Apply remote doc to localStorage legacy keys ──────────────────────────────
// Keeps existing app.js helpers (loadFontSize, loadTheme, etc.) working — the settings and reading-position keys are
// what they read at startup; the bookmark key is a second copy (the list is read from this store, ADR-015 D7). Each
// key is written on its own, so one the browser refuses does not keep the others from being written.

/** @param {SyncDoc} doc @returns {string[]} the keys the browser refused */
function applyToLegacyKeys(doc) {
  /** @type {string[]} */
  const refused = [];
  /** @param {string} lsKey @param {string} value */
  const write = (lsKey, value) => {
    try { localStorage.setItem(lsKey, value); } catch { refused.push(lsKey); }
  };
  for (const [key, lsKey] of Object.entries(_SETTING_LS_KEYS)) {
    const s = doc.settings?.[/** @type {SettingKey} */ (key)];
    if (s?.v != null) write(lsKey, typeof s.v === "string" ? s.v : JSON.stringify(s.v));
  }
  if (doc.lastRead?.v != null) write(_LR_KEY, JSON.stringify(doc.lastRead.v));
  const { items, tombstones } = doc.bookmarks ?? { items: {}, tombstones: {} };
  /** @type {{ [id: string]: SyncFlatItem }} */
  const alive = {};
  for (const [id, node] of Object.entries(items)) {
    if (!((_own(tombstones, id) ?? -Infinity) > node._u)) alive[id] = node;
  }
  const tree = bookmarkTreeFromFlat(alive);
  write(_LEGACY_BM_KEY, JSON.stringify(tree));
  return refused;
}

window.syncStoreV2 = {
  getDeviceId,
  loadLocal, saveLocal,
  sweepRetiredSettings,
  saveBaseIds, clearBaseIds, goneFromDrive,
  loadBookmarks, saveBookmarks, projectedBookmarksEntry,
  saveSetting, saveLastRead,
  migrateLegacyIfNeeded,
  mergeDocs, maxU, fingerprint,
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
