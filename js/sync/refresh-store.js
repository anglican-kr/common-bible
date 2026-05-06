// @ts-check
// ── Refresh Token Store ───────────────────────────────────────────────────────
// AES-GCM encrypted IndexedDB store for OAuth refresh tokens (Phase 2i / PKCE).
//
// Key is generated extractable: false so structured-clone roundtrip into IDB
// preserves it, but no JS code (ours or attacker's via subtle.exportKey) can
// pull the raw bytes out — the key only flows through encrypt/decrypt.
//
// XSS still beats us: an attacker that runs in our origin can call
// loadRefreshToken() the same way we do. Strict CSP (index.html line 5) is
// the actual XSS defense; encryption-at-rest only hardens against passive
// storage exfiltration (malicious extensions reading IDB, device-level dump).
//
// IndexedDB layout:
//   db   = "bible-drive-sync" (v1)
//   keys store: { id="aes" → CryptoKey (non-extractable AES-GCM 256) }
//   tokens store: { id="refresh" → { iv: Uint8Array(12), ciphertext: ArrayBuffer } }

/** @typedef {import("../types").RefreshTokenStore} RefreshTokenStore */

const _DB_NAME = "bible-drive-sync";
const _DB_VERSION = 1;
const _KEYS_STORE = "keys";
const _TOKENS_STORE = "tokens";
const _KEY_ID = "aes";
const _TOKEN_ID = "refresh";

// ── IndexedDB plumbing ────────────────────────────────────────────────────────
// Each operation opens its own connection and closes it when done. IDB
// connections are cheap; sharing one across async work invites version-change
// blocking when the schema upgrades in another tab.

/** @returns {Promise<IDBDatabase>} */
function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_DB_NAME, _DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(_KEYS_STORE))   db.createObjectStore(_KEYS_STORE);
      if (!db.objectStoreNames.contains(_TOKENS_STORE)) db.createObjectStore(_TOKENS_STORE);
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
    req.onerror   = () => reject(req.error);
  });
}

// ── Key management ────────────────────────────────────────────────────────────

/** @returns {Promise<CryptoKey>} */
async function _getOrCreateKey() {
  const db = await _openDB();
  try {
    /** @type {CryptoKey | undefined} */
    const existing = await _reqAsPromise(
      db.transaction(_KEYS_STORE, "readonly").objectStore(_KEYS_STORE).get(_KEY_ID),
    );
    if (existing) return existing;

    // First call ever: generate a fresh AES-GCM key. extractable: false is the
    // load-bearing flag — once stored, neither our code nor an attacker can
    // call subtle.exportKey on it.
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await _reqAsPromise(
      db.transaction(_KEYS_STORE, "readwrite").objectStore(_KEYS_STORE).put(key, _KEY_ID),
    );
    return key;
  } finally {
    db.close();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @param {string} plain
 * @returns {Promise<void>}
 */
async function saveRefreshToken(plain) {
  const key = await _getOrCreateKey();
  // AES-GCM requires a unique IV per (key, plaintext) pair. 12 bytes is the
  // standard length and keeps overhead minimal.
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  const db = await _openDB();
  try {
    await _reqAsPromise(
      db.transaction(_TOKENS_STORE, "readwrite")
        .objectStore(_TOKENS_STORE)
        .put({ iv, ciphertext }, _TOKEN_ID),
    );
  } finally {
    db.close();
  }
}

/** @returns {Promise<string | null>} */
async function loadRefreshToken() {
  /** @type {IDBDatabase} */
  let db;
  try {
    db = await _openDB();
  } catch {
    // Safari private mode, quota exhausted, etc. Caller treats as "no token"
    // and falls through to NEEDS_CONSENT.
    return null;
  }

  try {
    /** @type {{ iv: Uint8Array; ciphertext: ArrayBuffer } | undefined} */
    const record = await _reqAsPromise(
      db.transaction(_TOKENS_STORE, "readonly").objectStore(_TOKENS_STORE).get(_TOKEN_ID),
    );
    if (!record) return null;

    let key;
    try {
      key = await _getOrCreateKey();
    } catch {
      return null;
    }

    try {
      // Cast around TS 5.7+ Uint8Array<ArrayBufferLike> vs ArrayBuffer
      // distinction. Runtime invariant: we only ever store Uint8Array IVs
      // produced by crypto.getRandomValues, which are always ArrayBuffer-backed.
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: /** @type {BufferSource} */ (record.iv) },
        key,
        record.ciphertext,
      );
      return new TextDecoder().decode(plain);
    } catch {
      // Decrypt failure = stale ciphertext (key was regenerated, IDB partially
      // wiped, etc.). Drop the unrecoverable record so we don't loop on every
      // cold start.
      await _reqAsPromise(
        db.transaction(_TOKENS_STORE, "readwrite")
          .objectStore(_TOKENS_STORE)
          .delete(_TOKEN_ID),
      ).catch(() => {});
      return null;
    }
  } finally {
    db.close();
  }
}

/** @returns {Promise<void>} */
async function clearRefreshToken() {
  /** @type {IDBDatabase} */
  let db;
  try {
    db = await _openDB();
  } catch {
    return;
  }
  try {
    await _reqAsPromise(
      db.transaction(_TOKENS_STORE, "readwrite")
        .objectStore(_TOKENS_STORE)
        .delete(_TOKEN_ID),
    ).catch(() => {});
  } finally {
    db.close();
  }
}

window.refreshStore = { saveRefreshToken, loadRefreshToken, clearRefreshToken };
