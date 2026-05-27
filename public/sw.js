const CACHE = 'dental-academy-v1';
const urlsToCache = [
  '/',
  '/css/style.css',
  '/js/main.js',
  '/images/icon.svg',
  '/images/default-avatar.png',
  '/images/default-course.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function(response) {
      return response || fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200 && event.request.url.startsWith(self.location.origin)) {
          var copy = networkResponse.clone();
          caches.open(CACHE).then(function(cache) { cache.put(event.request, copy); });
        }
        return networkResponse;
      });
    }).catch(function() {
      return caches.match('/');
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
});
