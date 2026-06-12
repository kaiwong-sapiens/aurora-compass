/* Aurora Compass service worker — shell cache so the app opens with no network. */
const V = '108';
const SHELL = 'ac-shell-' + V;
const ASSETS = ['.', 'index.html', 'app.js?v=' + V, 'manifest.json', 'icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // live data feeds: never intercepted
  if (url.pathname.endsWith('version.json')) return;   // update check: network-only

  if (req.mode === 'navigate') {
    // network-first so online users always get the newest index; cached shell when offline
    e.respondWith(fetch(req).catch(() => caches.match('.')));
    return;
  }
  // shell assets: cache-first, fill cache on miss
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(r => {
      const copy = r.clone();
      caches.open(SHELL).then(c => c.put(req, copy));
      return r;
    }))
  );
});
