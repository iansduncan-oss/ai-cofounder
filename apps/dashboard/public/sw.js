// Jarvis Dashboard — Service Worker (app shell cache)
const CACHE_NAME = "jarvis-dashboard-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // Only cache GET requests for dashboard assets; API calls pass through
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) return;
  if (!url.pathname.startsWith("/dashboard/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful responses for offline fallback
        if (res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css"))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
