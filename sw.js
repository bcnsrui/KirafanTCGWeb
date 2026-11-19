/* Serves updated packs from Cache Storage when present; otherwise network.
 * pics/: same-origin first, then cache, then GitHub raw (Railway shell has no art). */

const CACHE_NAME = "kirafan-data-v7";
const GH_TCG = "https://raw.githubusercontent.com/bcnsrui/KirafanTCG/main";

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

function githubAssetUrl(pathname) {
  // /pics/small/x.jpg → KirafanTCG/web/pics/small/x.jpg (source=data in manifest)
  // /pics/x.jpg → KirafanTCG/pics/x.jpg
  // /data/... → KirafanTCG/web/data/...
  // /sound/... → KirafanTCG/sound/...
  const m = pathname.match(/\/(data|pics|sound)\/(.+)$/);
  if (!m) return null;
  const kind = m[1];
  const rest = m[2];
  if (kind === "pics" && rest.startsWith("small/")) {
    return `${GH_TCG}/web/pics/${rest}`;
  }
  if (kind === "pics") return `${GH_TCG}/pics/${rest}`;
  if (kind === "data") return `${GH_TCG}/web/data/${rest}`;
  if (kind === "sound") return `${GH_TCG}/sound/${rest}`;
  return null;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  const p = url.pathname;
  if (!(p.includes("/data/") || p.includes("/pics/") || p.includes("/sound/"))) return;
  if (p.endsWith("/manifest.json")) return;

  // pics + data: same-origin network first (local puzzle/script edits, fresh deploys).
  // sound: keep cache-first (large, rarely edited).
  const networkFirst = p.includes("/pics/") || p.includes("/data/");

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const gh = githubAssetUrl(p);

    if (networkFirst) {
      try {
        const res = await fetch(event.request, { cache: "no-store" });
        if (res && res.ok) {
          cache.put(event.request, res.clone()).catch(() => {});
          return res;
        }
      } catch { /* fall back */ }
      const hit = await cache.match(event.request) || await cache.match(url.href.split("?")[0]);
      if (hit) return hit;
      if (gh) {
        try {
          const res = await fetch(gh, { cache: "no-store", mode: "cors" });
          if (res && res.ok) {
            cache.put(event.request, res.clone()).catch(() => {});
            return res;
          }
        } catch { /* ignore */ }
      }
      return fetch(event.request);
    }

    try {
      const hit = await cache.match(event.request) || await cache.match(url.href.split("?")[0]);
      if (hit) return hit;
    } catch { /* fall through */ }
    if (gh) {
      try {
        const res = await fetch(gh, { cache: "no-store", mode: "cors" });
        if (res && res.ok) {
          cache.put(event.request, res.clone()).catch(() => {});
          return res;
        }
      } catch { /* ignore */ }
    }
    return fetch(event.request);
  })());
});
