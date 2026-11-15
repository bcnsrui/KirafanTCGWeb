/* Serves updated packs from Cache Storage when present; otherwise network.
 * pics/: network-first so local art swaps show up without clearing site data. */

const CACHE_NAME = "kirafan-data-v5";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  const p = url.pathname;
  if (!(p.includes("/data/") || p.includes("/pics/") || p.includes("/sound/"))) return;
  if (p.endsWith("/manifest.json")) return;

  const isPic = p.includes("/pics/");

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    if (isPic) {
      try {
        const res = await fetch(event.request, { cache: "no-store" });
        if (res && res.ok) {
          cache.put(event.request, res.clone()).catch(() => {});
          return res;
        }
      } catch { /* fall back to cache */ }
      const hit = await cache.match(event.request) || await cache.match(url.href.split("?")[0]);
      if (hit) return hit;
      return fetch(event.request);
    }

    try {
      const hit = await cache.match(event.request) || await cache.match(url.href.split("?")[0]);
      if (hit) return hit;
    } catch { /* fall through */ }
    return fetch(event.request);
  })());
});
