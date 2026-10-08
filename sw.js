// Service worker: lets the app open offline and keeps the big
// background-removal download so it only happens once.
const APP_CACHE = 'outfit-app-v2';
const LIB_CACHE = 'outfit-libs-v1';
const APP_FILES = [
  './', 'index.html', 'styles.css', 'app.js', 'settings.js', 'scoring.js', 'colour.js',
  'weather.js', 'storage.js', 'photo.js', 'analyse.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'staticimgly.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('outfit-app-') && k !== APP_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App files: try the network first so updates show straight away; use the copy offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(APP_CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))),
    );
    return;
  }

  // Background-removal code and model: versioned files that never change, so keep them.
  if (LIB_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(LIB_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.status === 200) cache.put(req, res.clone());
        return res;
      }),
    );
  }
  // Everything else (weather) goes straight to the network.
});
