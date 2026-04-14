// Bump this version whenever books.json or shell files change (app.js, style.css, etc.).
// Bible chapter data (data/bible/*.json) is network-first and does not need a version bump.
const CACHE_NAME = "rev-23";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/js/app.js",
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

// Cache app shell on install — do NOT skipWaiting() automatically.
// The client will send a SKIP_WAITING message after user confirms the update.
// Use { cache: "reload" } to bypass the HTTP cache; otherwise an immutable/max-age
// response for a prior shell revision can poison the new SW's cache with stale content.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(SHELL_FILES.map((url) => new Request(url, { cache: "reload" })))
    )
  );
});

// Allow the client to trigger skipWaiting via postMessage
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Remove old caches on activate
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for JSON data, cache-first for shell
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/data/bible/") ||
      (url.pathname.startsWith("/data/search-") && url.pathname !== "/data/search-meta.json")) {
    // Network-first for chapter data (cache as accessed)
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Stale-while-revalidate for shell files.
    // Revalidate via { cache: "reload" } so a long-lived HTTP cache entry does not
    // overwrite the SW cache with stale bytes during background refresh.
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetched = fetch(new Request(event.request, { cache: "reload" })).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetched;
      })
    );
  }
});
