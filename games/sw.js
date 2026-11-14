/* DSDA Arcade service worker — makes the arcade installable (PWA) and
   playable offline. Scope: /games/.
   Strategy:
   - Navigations (HTML): network-first, cache fallback  → fresh after each
     deploy, still works on a dead connection.
   - JSON (leaderboards): network-first, cache fallback → the board stays
     live when online, readable when offline.
   - Static assets (js/css/png/webmanifest): cache-first, then network →
     the 1.2MB vendored three.js + screenshots load instantly after visit 1.
   - Cross-origin (gtag.js, Google Fonts): never touched — plain network. */
const CACHE = 'dsda-arcade-v1';
const CORE = [
  './',
  './manifest.webmanifest',
  './three.module.js',
  './icon-192.png',
  './icon-512.png',
  '../style.css?v=2.0.4',
  '../theme.js?v=1'
];

self.addEventListener('install', (e) => {
  // Per-item (not c.addAll): one failed entry shouldn't zero the whole
  // precache. Offline on first visit is fine — we keep going.
  e.waitUntil(
    caches.open(CACHE)
      .then(async (c) => {
        for (const u of CORE) {
          try { await c.add(u); } catch (err) { /* skip this entry */ }
        }
      })
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      // same origin only

  const isNav = req.mode === 'navigation';
  const isJson = url.pathname.endsWith('.json');
  const isStatic = /\.(js|css|png|webmanifest|ico|svg|woff2?)$/i.test(url.pathname);

  if (isNav || isJson) {
    // network-first with cache fallback (fresh code + live board when online)
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error()))
    );
  } else if (isStatic) {
    // cache-first (immutable per URL — cache-busting query params make new URLs)
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
      )
    );
  }
  // everything else (fonts, gtag): default network handling
});
