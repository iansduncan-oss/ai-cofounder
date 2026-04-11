// Jarvis Voice — Service Worker (offline shell + cache)
const CACHE_NAME = "jarvis-voice-v1";
const SHELL = ["/voice/", "/voice/style.css", "/voice/app.js", "/voice/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Only cache GET requests for shell assets; let API calls pass through
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (!url.pathname.startsWith("/voice/")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      // Network-first for HTML, cache-first for assets
      if (url.pathname === "/voice/" || url.pathname === "/voice/index.html") {
        return fetch(e.request)
          .then((res) => {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
            return res;
          })
          .catch(() => cached);
      }
      return cached || fetch(e.request);
    }),
  );
});
