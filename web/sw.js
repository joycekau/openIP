// oneIP service worker — deliberately minimal + network-first so the app is installable as a PWA
// WITHOUT ever serving stale content (this app ships updates constantly). We only fall back to a
// cached response when the network is unavailable; we don't proactively pre-cache the shell.
const CACHE = "oneip-runtime-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // drop any old caches, then take control
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        const res = await fetch(req);
        // cache a copy of successful same-origin GETs for offline fallback only
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || Response.error();
      }
    })(),
  );
});
