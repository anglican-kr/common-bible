// Bump this version on every release. Activating a new CACHE_NAME clears all
// prior caches (shell + data), ensuring bible/search updates reach clients.
const CACHE_NAME = "rev-30";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/js/app.js",
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

// Stale-while-revalidate for everything.
// Revalidate via { cache: "reload" } so a long-lived HTTP cache entry does not
// overwrite the SW cache with stale bytes during background refresh.
// Bible/search data updates are propagated by bumping CACHE_NAME on release,
// which clears the old cache during activate().
self.addEventListener("fetch", (event) => {
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
});
