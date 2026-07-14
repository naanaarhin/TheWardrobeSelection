// Bump this version string whenever you want to force every device to pick
// up new files immediately. Changing it makes browsers see this as a
// different service worker file, which triggers an update + full cache wipe.
const CACHE = "tws-v2";
const ASSETS = ["/manifest.json", "/icon-192.png", "/icon-512.png", "/favicon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell (HTML/JS/CSS) so updates land immediately
// whenever the device is online. Falls back to cache only when offline.
// Cache-first only for the static icon/manifest files, which rarely change.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  const isStaticAsset = ASSETS.some((a) => url.pathname.endsWith(a));

  if (isStaticAsset) {
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
    return;
  }

  // Network-first: always try the network so a new deploy is picked up
  // right away; only fall back to the cached copy if offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
