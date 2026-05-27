const CACHE = 'dental-static-v2';
const STATIC_URLS = [
  '/css/style.css',
  '/js/main.js',
  '/images/icon.svg',
  '/images/default-avatar.png',
  '/images/default-course.png'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(STATIC_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', function(event) {
  if (event.request.method !== 'GET') return;

  var url = new URL(event.request.url);

  // فقط خزن الملفات الثابتة (CSS, JS, images, fonts)
  if (/\.(css|js|svg|png|jpg|jpeg|gif|ico|woff2?|ttf|eot)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var fetchPromise = fetch(event.request).then(function(networkResp) {
          if (networkResp && networkResp.status === 200) {
            var copy = networkResp.clone();
            caches.open(CACHE).then(function(cache) { cache.put(event.request, copy); });
          }
          return networkResp;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // صفحات HTML → دائماً من الشبكة (بدون كاش)
  event.respondWith(
    fetch(event.request).catch(function() {
      return caches.match('/');
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});
