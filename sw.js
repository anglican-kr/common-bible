// Cache identifiers — bump independently via scripts/release.py.
// Activating a new SHELL_CACHE clears only the prior shell cache; data/audio
// caches are preserved across shell-only releases. Bump DATA_CACHE only when
// bible JSON or search index format changes; bump AUDIO_CACHE only when mp3
// sources are re-encoded.
const SHELL_CACHE = "shell-50";
const DATA_CACHE = "data-1";
const AUDIO_CACHE = "audio-1"; // must equal js/audio-cache.js AUDIO_CACHE_NAME

// LRU metadata sidecar for AUDIO_CACHE. Loaded best-effort: if the import
// fails (e.g. file missing in older deploy), audio caching still works,
// just without LRU bookkeeping.
try {
  importScripts("/js/audio-cache.js");
} catch (_) { /* fall through; bibleAudioCache stays undefined */ }

// Separate cache for Google Font files (fonts.gstatic.com).
// Never cleared on cache bumps — font files are content-addressed and immutable.
const FONT_CACHE = "fonts-v1";

const KNOWN_CACHES = new Set([SHELL_CACHE, DATA_CACHE, AUDIO_CACHE, FONT_CACHE]);

const SHELL_FILES = [
  "/",
  "/index.html",
  "/privacy.html",
  "/js/app.js",
  "/js/drive-sync.js",
  "/js/audio-cache.js",
  "/js/sync/debug-log.js",
  "/js/sync/transport.js",
  "/js/sync/store-v2.js",
  "/js/sync/state-machine.js",
  "/js/pre-fetch.js",
  "/js/gtag-init.js",
  "/js/search-worker.js",
  "/css/style.css",
  "/version.json",
  "/data/books.json",
  "/data/search-meta.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-512-maskable.png",
];

// Route /data/* paths to the appropriate cache.
// Returns SHELL_CACHE for non-data paths and for shell-precached data files
// (books.json, search-meta.json) that ship with the app shell.
function cacheNameFor(pathname) {
  if (pathname.startsWith("/data/audio/")) return AUDIO_CACHE;
  if (pathname.startsWith("/data/bible/")) return DATA_CACHE;
  if (pathname === "/data/search-ot.json" ||
      pathname === "/data/search-nt.json" ||
      pathname === "/data/search-dc.json") {
    return DATA_CACHE;
  }
  return SHELL_CACHE;
}

// Cache app shell on install — do NOT skipWaiting() automatically.
// The client will send a SKIP_WAITING message after user confirms the update.
// Use { cache: "reload" } to bypass the HTTP cache; otherwise an immutable/max-age
// response for a prior shell revision can poison the new SW's cache with stale content.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })))
    )
  );
});

// Allow the client to trigger skipWaiting via postMessage,
// or to query this SW's bundled version for the update toast.
// GET_VERSION reads /version.json from THIS SW's own SHELL_CACHE so the
// reply reflects the version about to be installed, not the one currently
// active in the page (the active SW serves a stale copy of version.json).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "GET_VERSION") {
    const port = event.ports && event.ports[0];
    if (!port) return;
    event.waitUntil(
      caches.open(SHELL_CACHE)
        .then((cache) => cache.match("/version.json"))
        .then((res) => (res ? res.json() : null))
        .then((data) => port.postMessage({ version: (data && data.version) || "" }))
        .catch(() => port.postMessage({ version: "" }))
    );
  }
});

// Remove caches that are not in the active set on activate.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for Google Font files: immutable, content-addressed URLs.
// Stored in FONT_CACHE which persists across cache bumps.
function handleFontFile(event) {
  event.respondWith(
    caches.open(FONT_CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) cache.put(event.request, res.clone());
          return res;
        });
      })
    )
  );
}

// Cache-first for everything else, routed by pathname to shell/data/audio cache.
// Revalidate via { cache: "reload" } so a long-lived HTTP cache entry does not
// overwrite the SW cache with stale bytes during background refresh.
// Cache invalidation is handled by bumping the relevant cache name on release.
const DRIVE_HOSTNAMES = ["www.googleapis.com", "content.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"];

// Audio path: store in AUDIO_CACHE, record sidecar metadata, enforce hard cap.
// Runs inside event.waitUntil so the response is delivered immediately and the
// bookkeeping completes in background. Errors are swallowed — caching is
// best-effort and must never break playback. (See ADR-016.)
async function _putAudioAndEnforceCap(request, response) {
  const cache = await caches.open(AUDIO_CACHE);
  await cache.put(request, response);
  const ac = self.bibleAudioCache;
  if (!ac) return;
  const cl = response.headers.get("content-length");
  const byteSize = cl ? Number(cl) : 0;
  await ac.recordEntry(request.url, byteSize);
  const total = await ac.totalSize();
  if (total <= ac.HARD_CAP) return;
  const { urls } = await ac.pickEvictions(ac.SOFT_CAP);
  if (!urls.length) return;
  await Promise.all(urls.map((u) => cache.delete(u)));
  await ac.removeEntries(urls);
}

self.addEventListener("fetch", (event) => {
  // Cache API only supports GET. Without this guard, same-origin POSTs (most
  // notably the BFF endpoint /oauth/token) fall through to cache.put and throw
  // "Request method 'POST' is unsupported" — harmless to the request itself
  // but spams the console. Let non-GET pass through to the network untouched.
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const { hostname, pathname } = url;

  if (hostname === "fonts.gstatic.com") {
    handleFontFile(event);
    return;
  }

  // Bypass cache for Google OAuth and Drive API — always network-only.
  if (DRIVE_HOSTNAMES.includes(hostname)) return;

  // Serve app shell for all navigation requests (History API SPA routing).
  // Exception: standalone HTML pages (e.g. privacy.html) are served directly.
  if (event.request.mode === "navigate") {
    const standalonePages = ["/privacy.html"];
    if (standalonePages.includes(pathname)) {
      event.respondWith(
        caches.match(pathname).then((cached) => cached || fetch(pathname))
      );
      return;
    }
    event.respondWith(
      caches.match("/index.html").then((cached) => cached || fetch("/index.html"))
    );
    return;
  }

  const targetCache = cacheNameFor(pathname);
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(new Request(event.request, { cache: "reload" })).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          if (targetCache === AUDIO_CACHE) {
            event.waitUntil(_putAudioAndEnforceCap(event.request, clone).catch(() => {}));
          } else {
            caches.open(targetCache).then((cache) => cache.put(event.request, clone));
          }
        }
        return res;
      });
    })
  );
});
