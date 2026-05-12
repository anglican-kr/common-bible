// @ts-check
// ── Audio cache LRU metadata store ────────────────────────────────────────────
// IndexedDB-backed sidecar metadata for AUDIO_CACHE (sw.js). Used by both the
// SW (importScripts) and the main page (<script src>). Cache API does not
// expose access time, so we record byteSize/lastPlayedAt/addedAt here and use
// them to drive LRU eviction. See ADR-016.
//
// IndexedDB layout:
//   db    = "bible-audio-cache" (v1)
//   store = "entries" (out-of-line key = url)
//     value: { url, byteSize, addedAt, lastPlayedAt: number | null }
//
// Public surface attached to globalThis.bibleAudioCache:
//   recordEntry(url, byteSize)  — idempotent insert, preserves play history
//   touch(url)                  — set lastPlayedAt = now
//   totalSize()                 — sum byteSize across all entries
//   pickEvictions(targetCap)    — choose urls to evict (null first, then asc)
//   removeEntries(urls)         — delete metadata (caller deletes from Cache API)
//   AUDIO_CACHE_NAME            — must match sw.js AUDIO_CACHE constant
//   SOFT_CAP, HARD_CAP          — bytes
//
// Why metadata-only (no Cache API ops): keeps this module testable without
// faking Cache API and lets each call site (SW vs page) own its own
// caches.open() — they already have their cache name in scope.

(function () {
  /** @typedef {{ url: string, byteSize: number, addedAt: number, lastPlayedAt: number | null }} AudioCacheEntry */

  const DB_NAME = "bible-audio-cache";
  const DB_VERSION = 1;
  const STORE = "entries";

  // Mirror sw.js. Name is fixed since ADR-021 — per-file invalidation is
  // driven by audio-manifest.json hash diffs in js/manifest-sync.js, so
  // there is no rev to bump.
  const AUDIO_CACHE_NAME = "audio";
  const SOFT_CAP = 300 * 1024 * 1024; // 300 MB
  const HARD_CAP = 360 * 1024 * 1024; // 360 MB

  /** @returns {Promise<IDBDatabase>} */
  function _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
    });
  }

  /**
   * @template T
   * @param {IDBRequest<T>} req
   * @returns {Promise<T>}
   */
  function _reqAsPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * @template T
   * @param {IDBTransactionMode} mode
   * @param {(store: IDBObjectStore) => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function _withStore(mode, fn) {
    const db = await _openDB();
    try {
      const store = db.transaction(STORE, mode).objectStore(STORE);
      return await fn(store);
    } finally {
      db.close();
    }
  }

  /**
   * Idempotent: re-recording an existing url preserves addedAt and
   * lastPlayedAt. byteSize is updated (in case the file was re-encoded).
   * @param {string} url
   * @param {number} byteSize
   */
  async function recordEntry(url, byteSize) {
    const safeBytes = Number.isFinite(byteSize) ? Math.max(0, Math.trunc(byteSize)) : 0;
    return _withStore("readwrite", async (store) => {
      /** @type {AudioCacheEntry | undefined} */
      const existing = await _reqAsPromise(store.get(url));
      const now = Date.now();
      /** @type {AudioCacheEntry} */
      const entry = {
        url,
        byteSize: safeBytes,
        addedAt: existing?.addedAt ?? now,
        lastPlayedAt: existing?.lastPlayedAt ?? null,
      };
      await _reqAsPromise(store.put(entry, url));
    });
  }

  /** @param {string} url */
  async function touch(url) {
    return _withStore("readwrite", async (store) => {
      /** @type {AudioCacheEntry | undefined} */
      const existing = await _reqAsPromise(store.get(url));
      if (!existing) return;
      existing.lastPlayedAt = Date.now();
      await _reqAsPromise(store.put(existing, url));
    });
  }

  /** @returns {Promise<AudioCacheEntry[]>} */
  async function _listAll() {
    return _withStore("readonly", async (store) => {
      /** @type {AudioCacheEntry[]} */
      const all = await _reqAsPromise(store.getAll());
      return all || [];
    });
  }

  /** @returns {Promise<number>} */
  async function totalSize() {
    const all = await _listAll();
    return all.reduce((s, e) => s + (e.byteSize || 0), 0);
  }

  /**
   * Sort: lastPlayedAt === null first (received but never played),
   * then ascending lastPlayedAt. Tiebreak by addedAt asc so older
   * unplayed entries go first.
   * @param {AudioCacheEntry} a
   * @param {AudioCacheEntry} b
   */
  function _evictionOrder(a, b) {
    if (a.lastPlayedAt === null && b.lastPlayedAt === null) {
      return (a.addedAt || 0) - (b.addedAt || 0);
    }
    if (a.lastPlayedAt === null) return -1;
    if (b.lastPlayedAt === null) return 1;
    return a.lastPlayedAt - b.lastPlayedAt;
  }

  /**
   * Pick the minimum set of urls to evict so that remaining total <= targetCap.
   * Returns empty list when already under cap.
   * @param {number} targetCap
   * @returns {Promise<{urls: string[], freedBytes: number}>}
   */
  async function pickEvictions(targetCap) {
    const all = await _listAll();
    const total = all.reduce((s, e) => s + (e.byteSize || 0), 0);
    if (total <= targetCap) return { urls: [], freedBytes: 0 };
    all.sort(_evictionOrder);
    const need = total - targetCap;
    let freed = 0;
    /** @type {string[]} */
    const urls = [];
    for (const e of all) {
      if (freed >= need) break;
      urls.push(e.url);
      freed += e.byteSize || 0;
    }
    return { urls, freedBytes: freed };
  }

  /** @param {string[]} urls */
  async function removeEntries(urls) {
    if (!urls || !urls.length) return;
    return _withStore("readwrite", async (store) => {
      for (const url of urls) await _reqAsPromise(store.delete(url));
    });
  }

  // Attach to globalThis (works in window, ServiceWorkerGlobalScope, vm context).
  /** @type {any} */ (globalThis).bibleAudioCache = {
    recordEntry,
    touch,
    totalSize,
    pickEvictions,
    removeEntries,
    AUDIO_CACHE_NAME,
    SOFT_CAP,
    HARD_CAP,
    _listAll, // exposed for diagnostics / tests
  };
})();
