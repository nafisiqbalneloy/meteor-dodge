/* METEOR DODGE service worker: lets the game open offline. Always tries the network first so updates show up. */
const CACHE = 'meteor-dodge-v4';
const CORE = ['./', 'index.html', 'style.css', 'game.js', '404.html', 'manifest.json', 'og-image-v2.png',
  'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/PressStart2P-Regular.ttf'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r, { cache: 'no-cache' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match('index.html')))
  );
});
