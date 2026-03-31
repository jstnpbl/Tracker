const CACHE_NAME = "budget-app-v2";
const ASSETS = [
  ".",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("Service Worker: Caching assets");
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.map(name => {
          if (name !== CACHE_NAME) {
            console.log("Service Worker: Deleting old cache", name);
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(cachedRes => {
      const fetchPromise = fetch(e.request).then(networkRes => {
        if (networkRes && networkRes.status === 200) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(e.request, networkRes.clone());
          });
        }
        return networkRes;
      }).catch(err => {
        if (!cachedRes) {
          return caches.match("./index.html");
        }
        throw err;
      });
      return cachedRes || fetchPromise;
    })
  );
});