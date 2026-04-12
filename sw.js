// Bump this version whenever books.json or shell files change (app.js, style.css, etc.).
// Bible chapter data (data/bible/*.json) is network-first and does not need a version bump.
const CACHE_NAME = "rev-9";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/app.js",
  "/gtag-init.js",
  "/style.css",
  "/search-worker.js",
  "/data/books.json",
  "/data/search-meta.json",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
];

// Cache app shell on install
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
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
    // Stale-while-revalidate for shell files
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fetched = fetch(event.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        });
        return cached || fetched;
      })
    );
  }
});
