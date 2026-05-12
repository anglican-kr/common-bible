// @ts-check

// Content-hash manifest sync. Replaces the prior DATA_CACHE / AUDIO_CACHE
// rev-bump strategy with per-entry lazy invalidation (ADR-021).
//
// On boot, fetch /data/bible-manifest.json + /data/audio-manifest.json
// (sw.js routes both network-first), diff against the previous snapshot
// stored in IndexedDB, and delete Cache API entries whose hash changed
// since last sync. The user pulls fresh content on demand the next time
// they navigate to that chapter or play that mp3.
//
// First boot has no previous snapshot, so nothing is invalidated — the
// matching cache name changes from the migration release (data-3 → data,
// audio-1 → audio) already purge legacy entries via the activate handler.

window.manifestSync = (() => {
  const DB_NAME = "bible-manifest-sync";
  const DB_VERSION = 1;
  const STORE = "snapshots";

  const BIBLE_MANIFEST_URL = "/data/bible-manifest.json";
  const AUDIO_MANIFEST_URL = "/data/audio-manifest.json";
  const DATA_CACHE = "data";
  const AUDIO_CACHE = "audio";

  /** @typedef {{ format: number, generated_at: string, entries: Record<string, string> }} Manifest */

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
   * @param {string} key
   * @returns {Promise<Manifest | null>}
   */
  async function _getSnapshot(key) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * @param {string} key
   * @param {Manifest} manifest
   */
  async function _putSnapshot(key, manifest) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(manifest, key);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * @param {string} url
   * @returns {Promise<Manifest | null>}
   */
  async function _fetchManifest(url) {
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object" || !data.entries) return null;
      return /** @type {Manifest} */ (data);
    } catch {
      return null;
    }
  }

  /**
   * Convert a cached request URL (e.g. https://app/data/bible/gen-1.json)
   * to the manifest entry key (e.g. bible/gen-1.json). Returns null when
   * the path is not under /data/.
   * @param {string} requestUrl
   * @returns {string | null}
   */
  function _urlToManifestKey(requestUrl) {
    try {
      const { pathname } = new URL(requestUrl);
      const prefix = "/data/";
      if (!pathname.startsWith(prefix)) return null;
      return pathname.slice(prefix.length);
    } catch {
      return null;
    }
  }

  /**
   * Diff current vs previous manifest. Returns the manifest keys whose
   * hash should cause the corresponding cache entry to be evicted:
   *  - removed from current (file deleted)
   *  - hash changed between previous and current (content changed)
   *
   * Entries present in current but absent from previous are NOT invalidated:
   * the cached entry could have been written before the manifest existed
   * and the manifest entry is the new ground truth — we keep it until the
   * next change.
   *
   * @param {Manifest} current
   * @param {Manifest | null} previous
   * @returns {Set<string>}
   */
  function _staleKeys(current, previous) {
    const stale = new Set();
    if (!previous) return stale;
    for (const [key, oldHash] of Object.entries(previous.entries)) {
      const newHash = current.entries[key];
      if (newHash === undefined) {
        stale.add(key);
      } else if (newHash !== oldHash) {
        stale.add(key);
      }
    }
    return stale;
  }

  /**
   * @param {string} cacheName
   * @param {Set<string>} staleKeys
   */
  async function _invalidateCache(cacheName, staleKeys) {
    if (!staleKeys.size) return 0;
    let cache;
    try { cache = await caches.open(cacheName); } catch { return 0; }
    const requests = await cache.keys();
    let evicted = 0;
    for (const req of requests) {
      const key = _urlToManifestKey(req.url);
      if (!key) continue;
      if (!staleKeys.has(key)) continue;
      await cache.delete(req);
      evicted++;
    }
    return evicted;
  }

  /**
   * Also clear the matching rows from the audio LRU sidecar so totalSize
   * accounting and pickEvictions don't reference deleted Cache entries.
   * @param {Set<string>} staleKeys
   */
  async function _pruneAudioSidecar(staleKeys) {
    if (!staleKeys.size) return;
    const ac = window.bibleAudioCache;
    if (!ac) return;
    const urls = [];
    for (const key of staleKeys) {
      urls.push(`${location.origin}/data/${key}`);
    }
    try { await ac.removeEntries(urls); } catch { /* best-effort */ }
  }

  /** Run one sync pass. Safe to call repeatedly; cheap when no diff. */
  async function syncManifests() {
    const [bibleCurrent, audioCurrent] = await Promise.all([
      _fetchManifest(BIBLE_MANIFEST_URL),
      _fetchManifest(AUDIO_MANIFEST_URL),
    ]);

    if (bibleCurrent) {
      const prev = await _getSnapshot("bible").catch(() => null);
      const stale = _staleKeys(bibleCurrent, prev);
      await _invalidateCache(DATA_CACHE, stale);
      await _putSnapshot("bible", bibleCurrent).catch(() => {});
    }

    if (audioCurrent) {
      const prev = await _getSnapshot("audio").catch(() => null);
      const stale = _staleKeys(audioCurrent, prev);
      await _invalidateCache(AUDIO_CACHE, stale);
      await _pruneAudioSidecar(stale);
      await _putSnapshot("audio", audioCurrent).catch(() => {});
    }
  }

  return {
    syncManifests,
    // Internals exposed for unit tests; not part of the public surface.
    _staleKeys,
    _urlToManifestKey,
  };
})();
