// Service worker: chạy offline + tự cập nhật.
// Chiến lược "trả bản đã lưu ngay, đồng thời tải bản mới về cho lần mở sau" (stale-while-revalidate),
// nên sửa bất kỳ file nào (kể cả firebase-config.js) rồi deploy là người chơi nhận được ở lần mở kế tiếp.
const CACHE = 'one-line-v6';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './firebase-config.js', './lib/online.js',
  './privacy.html', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './icons/maskable-512.png'];

self.addEventListener('install', function (e) {
  // cache:'reload' -> lấy bản mới từ máy chủ, bỏ qua HTTP cache của trình duyệt
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
  // chỉ lo file của chính game; không đụng tới Firebase, ảnh đại diện, trang đăng nhập
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\/(login\.html|__\/)/.test(url.pathname)) return;
  var key = url.origin + url.pathname;                       // bỏ ?query để không lưu trùng
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      var fresh = fetch(new Request(key, { cache: 'no-cache' })).then(function (res) {
        if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
        return res;
      });
      if (hit) { e.waitUntil(fresh.catch(function () {})); return hit; }
      return fresh.catch(function () { return cache.match(new URL('./index.html', self.location).href); });
    });
  }));
});
