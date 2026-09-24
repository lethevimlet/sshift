// SSHIFT service worker.
//
// Cache busting model (v1.8.2):
// - __VERSION__ is replaced with the package version by the server on every
//   request, and /sw.js is served with no-store. A new release therefore
//   produces a byte-different worker, which the browser installs as an
//   update.
// - Every asset the page references carries ?v=<version>; the cache is
//   named after the version too. Old caches (any name that is not this
//   version's) are deleted on activate, so nothing from a previous version
//   can ever be served again.
// - skipWaiting() + clients.claim(): the new worker replaces the old one as
//   soon as it has installed, for every open page at once. There is never a
//   "waiting" worker and never two versions alive side by side. The page's
//   registration script reloads on controllerchange so HTML, JS and CSS are
//   always from the same version.
// - Navigations (index.html) are network-first with a versioned offline
//   fallback; everything else same-origin is cache-first because the cache
//   is version-scoped. Socket.IO, the API and the worker script itself are
//   never cached.
const VERSION = '__VERSION__';
const CACHE_NAME = 'sshift-' + VERSION;
const NAV_CACHE = CACHE_NAME + '-nav';

const PRECACHE_URLS = [
  '/css/style.css?v=' + VERSION,
  '/libs/xterm/xterm.css?v=' + VERSION,
  '/libs/font-awesome/css/all.min.css?v=' + VERSION,
  '/libs/lucide/lucide.min.js?v=' + VERSION,
  '/manifest.json?v=' + VERSION
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((e) => {
            console.warn('[SW] Failed to precache:', url, e && e.message);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== NAV_CACHE)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

function isCacheable(url, request) {
  if (request.method !== 'GET') return false;
  if (url.origin !== self.location.origin) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.pathname.startsWith('/socket.io/')) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname === '/sw.js') return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!isCacheable(url, event.request)) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(NAV_CACHE).then((cache) => cache.put(event.request, clone)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone)).catch(() => {});
        }
        return response;
      });
    })
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = (msg) => {
    try {
      if (event.ports && event.ports[0]) event.ports[0].postMessage(msg);
      else if (event.source && event.source.postMessage) event.source.postMessage(msg);
    } catch (_) {}
  };
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys()
        .then((names) => Promise.all(names.map((name) => caches.delete(name))))
        .then(() => reply({ type: 'CACHES_CLEARED' }))
    );
  } else if (data.type === 'GET_VERSION') {
    reply({ type: 'VERSION', version: VERSION });
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
