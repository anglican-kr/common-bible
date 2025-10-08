self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open("app-shell-v1");
      await cache.addAll([
        "./",
        "./verse-style.css",
        "./verse-navigator.js",
        "./pwa.js",
      ]);
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 단순 SWR: JSON/텍스트, 캐시우선: 이미지/폰트
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;

  if (
    url.pathname.includes("/static/search/") ||
    req.headers.get("accept")?.includes("application/json") ||
    url.pathname.endsWith(".json")
  ) {
    // Stale-While-Revalidate for JSON/text
    event.respondWith(
      (async () => {
        const cache = await caches.open("data-swr-v1");
        const cached = await cache.match(req);
        const fetchPromise = fetch(req)
          .then((res) => {
            cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })()
    );
    return;
  }

  if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|otf)$/)) {
    // Cache First for assets
    event.respondWith(
      (async () => {
        const cache = await caches.open("assets-v1");
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        cache.put(req, res.clone());
        return res;
      })()
    );
    return;
  }
});
