// SHELL_CACHE name is derived from /sw-version.js (release.py rewrites it
// per release). Bumping APP_VERSION changes this importScripts target's
// byte-diff, which is how the SW update algorithm detects new releases.
// DATA_CACHE / AUDIO_CACHE / FONT_CACHE names are fixed: content-hash
// manifests (bible-manifest.json, audio-manifest.json) drive per-entry
// invalidation through js/manifest-sync.js — see ADR-021.
importScripts("/sw-version.js");
const SHELL_CACHE = "shell-" + self.APP_VERSION;
const DATA_CACHE = "data";
const AUDIO_CACHE = "audio"; // must equal js/audio-cache.js AUDIO_CACHE_NAME
const FONT_CACHE = "fonts";

// LRU metadata sidecar for AUDIO_CACHE. Loaded best-effort: if the import
// fails (e.g. file missing in older deploy), audio caching still works,
// just without LRU bookkeeping.
try {
  importScripts("/js/audio-cache.js");
} catch (_) { /* fall through; bibleAudioCache stays undefined */ }

const KNOWN_CACHES = new Set([SHELL_CACHE, DATA_CACHE, AUDIO_CACHE, FONT_CACHE]);

const SHELL_FILES = [
  "/",
  "/index.html",
  "/privacy.html",
  "/js/app.js",
  "/js/app/helpers.js",
  "/js/app/storage.js",
  "/js/app/settings-ui.js",
  "/js/app/install.js",
  "/js/app/search.js",
  "/js/app/reading-context.js",
  "/js/app/bookmark.js",
  "/js/app/citations.js",
  "/js/app/views-routing.js",
  "/js/app/bottom-nav.js",
  "/js/drive-sync.js",
  "/js/audio-cache.js",
  "/js/manifest-sync.js",
  "/js/sync/debug-log.js",
  "/js/sync/refresh-store.js",
  "/js/sync/transport.js",
  "/js/sync/store-v2.js",
  "/js/sync/state-machine.js",
  "/js/pre-fetch.js",
  "/js/gtag-init.js",
  "/js/search-worker.js",
  "/css/style.css",
  "/version.json",
  "/sw-version.js",
  "/data/books.json",
  "/data/search-meta.json",
  "/data/bible-manifest.json",
  "/data/audio-manifest.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/assets/icons/icon-512-maskable.png",
];

// Route /data/* paths to the appropriate cache.
// Returns SHELL_CACHE for non-data paths and for shell-precached data files
// (books.json, search-meta.json, *-manifest.json) that ship with the app shell.
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

const MANIFEST_PATHS = new Set([
  "/data/bible-manifest.json",
  "/data/audio-manifest.json",
]);

// Network-first for content-hash manifests. The manifest must reflect what
// the server currently advertises so js/manifest-sync.js can detect drift
// and invalidate stale Cache API entries. Fall back to the precached copy
// in SHELL_CACHE when offline so the app still boots.
function handleManifest(event, pathname) {
  event.respondWith((async () => {
    try {
      const res = await fetch(new Request(event.request, { cache: "no-cache" }));
      if (res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(event.request, res.clone());
      }
      return res;
    } catch {
      const cached = await caches.match(pathname);
      if (cached) return cached;
      return new Response("", { status: 504, statusText: "Manifest unreachable" });
    }
  })());
}

// Cache app shell on install — do NOT skipWaiting() automatically.
// The client will send a SKIP_WAITING message after user confirms the update.
//
// Cache-busting strategy: fetch each shell URL with `?v=<APP_VERSION>` appended
// and `{ cache: "reload" }`, then store the response under the ORIGINAL request
// (no query) so the runtime fetch handler — which sees page requests without the
// query — still finds it. `cache: "reload"` only bypasses the browser HTTP cache;
// any CDN/origin layer that serves a stale 200 for the unversioned URL would
// otherwise poison SHELL_CACHE with the previous release's bytes, leaving
// version.json fresh (different bytes per release) but JS/CSS stale (same URL,
// same etag, cached). The unique query forces every layer to revalidate.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Fetch every shell file first (mirrors cache.addAll's atomicity: if any
    // fetch fails, the whole install fails before any cache.put runs, leaving
    // SHELL_CACHE in its prior state instead of half-updated).
    const pairs = await Promise.all(SHELL_FILES.map(async (url) => {
      const bust = url + (url.includes("?") ? "&" : "?") + "v=" + encodeURIComponent(self.APP_VERSION);
      const res = await fetch(bust, { cache: "reload" });
      if (!res.ok) throw new Error("Precache fetch failed: " + bust + " → " + res.status);
      return /** @type {[string, Response]} */ ([url, res]);
    }));
    await Promise.all(pairs.map(([url, res]) => cache.put(new Request(url), res)));
  })());
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

// Remove caches that are not in the active set on activate, then reconcile
// the AUDIO_CACHE sidecar (IDB metadata) with Cache API contents so stale
// state from prior incomplete writes or DevTools-cleared storage doesn't
// drift the LRU bookkeeping.
//
// clients.claim() is awaited INSIDE waitUntil after reconcile, not outside.
// If we claimed early, fetch events from claimed clients could arrive while
// reconcile is mid-flight: a concurrent _putAudioAndEnforceCap recordEntry()
// could add an IDB row whose URL was orphan in reconcile's snapshot — step
// (b)'s removeEntries would then delete the freshly added row, recreating
// the drift we are trying to fix (Bugbot PR #67).
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => !KNOWN_CACHES.has(k)).map((k) => caches.delete(k)));
    await _reconcileAudioCache().catch(() => { /* best-effort */ });
    await self.clients.claim();
  })());
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
// Cache invalidation (data/audio) is driven by js/manifest-sync.js comparing
// content-hash manifests on each app boot — see ADR-021.
const DRIVE_HOSTNAMES = ["www.googleapis.com", "content.googleapis.com", "oauth2.googleapis.com", "accounts.google.com"];

// URLs currently being put + cap-enforced. Two concurrent fetches without this
// guard could pick overlapping eviction sets and delete each other's just-put
// mp3 before playback starts. Eviction filters this set out.
const _inflightAudioUrls = new Set();

// Audio path: store in AUDIO_CACHE, record sidecar metadata, enforce hard cap.
// Runs inside event.waitUntil so the response is delivered immediately and the
// bookkeeping completes in background. Errors are swallowed — caching is
// best-effort and must never break playback. (See ADR-016.)
async function _putAudioAndEnforceCap(request, response) {
  _inflightAudioUrls.add(request.url);
  try {
    const ac = self.bibleAudioCache;

    // Compute byteSize BEFORE cache.put consumes the response body. Prefer
    // Content-Length (cheap, no body read), fall back to clone().blob().size
    // when missing/invalid (chunked transfer / gzip / Range / proxy stripped
    // it). Without this fallback the LRU sidecar records 0 bytes and the
    // entry escapes cap accounting forever — quota exhaustion follow.
    let byteSize = 0;
    if (ac) {
      const cl = response.headers.get("content-length");
      byteSize = cl ? Number(cl) : 0;
      if (!Number.isFinite(byteSize) || byteSize <= 0) {
        try {
          const blob = await response.clone().blob();
          byteSize = blob.size;
        } catch { byteSize = 0; }
      }
    }

    const cache = await caches.open(AUDIO_CACHE);
    await cache.put(request, response);

    if (!ac) return;
    await ac.recordEntry(request.url, byteSize);
    const total = await ac.totalSize();
    if (total <= ac.HARD_CAP) return;
    const { urls } = await ac.pickEvictions(ac.SOFT_CAP);
    // Filter out URLs currently being put — these are mid-fetch, deleting
    // them would race the put and break playback. They'll be re-evaluated
    // after their own _putAudioAndEnforceCap call returns.
    const evictable = urls.filter((u) => !_inflightAudioUrls.has(u));
    if (!evictable.length) return;
    await Promise.all(evictable.map((u) => cache.delete(u)));
    await ac.removeEntries(evictable);
  } finally {
    _inflightAudioUrls.delete(request.url);
  }
}

// Reconcile AUDIO_CACHE sidecar (IDB metadata) with Cache API contents.
// Called on SW activate. Two drift scenarios this fixes:
//   (a) cache.put succeeded but recordEntry failed in a prior session
//       → mp3 in Cache, no IDB row → escapes LRU forever. Recover by
//          recording the entry with byteSize from the cached blob.
//   (b) DevTools or browser settings cleared one side → IDB rows for mp3s
//       no longer in Cache → repeated fetches think the file is cached.
//       Remove orphan IDB rows.
// Cost is bounded by number of mismatches, not full cache size — typical
// healthy state finishes in microseconds.
async function _reconcileAudioCache() {
  const ac = self.bibleAudioCache;
  if (!ac) return;
  let cache;
  try { cache = await caches.open(AUDIO_CACHE); } catch { return; }
  const requests = await cache.keys();
  const cacheUrls = new Set(requests.map((r) => r.url));
  const idbEntries = await ac._listAll();
  const idbUrls = new Set(idbEntries.map((e) => e.url));

  // (a) Cache entries without IDB metadata → record them.
  for (const req of requests) {
    if (idbUrls.has(req.url)) continue;
    try {
      const res = await cache.match(req);
      if (!res) continue;
      const blob = await res.clone().blob();
      await ac.recordEntry(req.url, blob.size);
    } catch { /* skip individual failures, keep reconciling */ }
  }

  // (b) IDB rows without Cache entries → remove the orphans.
  const orphans = idbEntries.filter((e) => !cacheUrls.has(e.url)).map((e) => e.url);
  if (orphans.length) await ac.removeEntries(orphans);
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

  if (MANIFEST_PATHS.has(pathname)) {
    handleManifest(event, pathname);
    return;
  }

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
