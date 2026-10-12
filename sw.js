/* sw.js — 离线缓存。改完代码后把 VERSION 加 1，用户下次打开即更新 */
var VERSION = 'tt-v15';
var ASSETS = [
  './', './index.html', './app.js', './core.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './favicon.ico', './apple-touch-icon.png', './seed.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) {
      return Promise.all(ASSETS.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // 网络优先：保证改代码后能拿到最新版；离线时回落缓存
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
