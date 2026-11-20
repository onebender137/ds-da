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
// Bump this on any deploy that changes a cache-first asset (js/css/png/mp3).
// Static assets are cache-first, so a returning player keeps serving the old
// copy out of the cache until the version changes — activate() deletes every
// cache whose key isn't this one. v2: the gapless DSDA Radio (radio/radio.js).
// v3: new TappyCat screenshot (v2 six-world overhaul).
// v4: Beaverz pass 4 (particles/look/HP) — bust cache so a stale/corrupt
//     three.module.js entry (e.g. a cached Cloudflare challenge page) is
//     dropped and re-fetched; fixes players stuck on the loading screen.
// v5: Neon Circuit v2 — new cabinet screenshot/og image.
// v6: Poke It cabinet — new screenshot/og art + arcade-social.js learns 'poke-it'.
// v7: player accounts — arcade-social.js loads /games/arcade-account.js (absolute path).
const CACHE = 'dsda-arcade-v7';
const CORE = [
  './',
  './manifest.webmanifest',
  './three.module.js',
  './icon-192.png',
  './icon-512.png',
  '../style.css?v=2.0.7',
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
  const isStatic = /\.(js|css|png|webmanifest|ico|svg|woff2?|ogg|mp3)$/i.test(url.pathname);

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
