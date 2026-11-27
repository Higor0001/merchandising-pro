const STATIC_CACHE = 'merchandising-pro-static-v3';
const API_CACHE = 'merchandising-pro-api-v3';
const STATIC_ASSETS = ['/manifest.json', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([STATIC_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_API_CACHE') {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. Navegação / index.html: Network-First para sempre receber novos builds após deploy
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match('/index.html')))
    );
    return;
  }

  // 2. Rotas de API: Network-First e só cachear respostas HTTP 200 OK (nunca cachear 401/500)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res && res.ok && res.status === 200) {
            const clone = res.clone();
            caches.open(API_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 3. Assets estáticos versionados (/assets/*): Cache-First com fallback para rede
  if (url.pathname.startsWith('/assets/') || STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        });
      })
    );
  }
});
