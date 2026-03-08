const CACHE_NAME = 'forgeai-v1';
const PRECACHE_URLS = [
  '/',
  '/forge.svg',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Network-first for API calls
  if (event.request.url.includes('/api/') || event.request.url.includes('/health')) {
    return;
  }
  // Cache-first for static assets
  event.respondWith((async () => {
    const cached = await caches.match(event.request);

    try {
      const response = await fetch(event.request);

      if (response.ok) {
        const clone = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, clone);
      }

      return response;
    } catch {
      if (cached) return cached;

      if (event.request.mode === 'navigate') {
        const appShell = await caches.match('/');
        if (appShell) return appShell;
      }

      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});
