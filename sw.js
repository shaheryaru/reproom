// Offline app shell. Bump VERSION whenever you change a cached file so phones pick up the update.
// Paths are resolved from this script, so a GitHub Pages project site at /reproom/ and a domain root both work.
const VERSION = 'reproom-v2.1.0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

const scopeUrl = () => new URL('./', self.location);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll rejects redirects and non-200 responses, so a broken shell never activates.
    await cache.addAll(SHELL.map(path => new URL(path, scopeUrl()).href));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function canStore(response) {
  return !!response && response.ok && response.status === 200 && response.type === 'basic' && !response.redirected;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  // Leave the worker script itself to the browser so an update check cannot be pinned to an old copy.
  if (url.pathname.endsWith('/sw.js')) return;
  const scope = scopeUrl().href;
  if (url.href !== scope.slice(0, -1) && !url.href.startsWith(scope)) return;

  event.respondWith(fetch(request).then(response => {
    if (canStore(response)) {
      const copy = response.clone();
      event.waitUntil(caches.open(VERSION).then(cache => cache.put(request, copy)).catch(() => {}));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Only navigations fall back to the app shell. A missing script must not come back as HTML.
    if (request.mode === 'navigate') {
      return (await caches.match(scope))
        || (await caches.match(new URL('./index.html', scope).href))
        || Response.error();
    }
    return Response.error();
  }));
});
