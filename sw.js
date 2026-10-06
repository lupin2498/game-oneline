const CACHE = 'one-line-v5';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './firebase-config.js', './lib/online.js',
  './privacy.html', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './icons/maskable-512.png'];

self.addEventListener('install', function (e) {
  // cache:'reload' -> lấy bản mới từ máy chủ, không dùng bản cũ trong HTTP cache (GitHub Pages để max-age=600)
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () {
    return self.skipWaiting();
  }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  // chỉ cache file của chính game; không đụng tới Firebase, ảnh đại diện, trang đăng nhập
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\/(login\.html|__\/)/.test(url.pathname)) return;
  e.respondWith(caches.match(req).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match('./index.html'); });
  }));
});
