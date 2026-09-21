const CACHE_NAME = 'inventory-sheets-v71';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './puntos.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './logo.png',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/lucide@0.344.0/dist/umd/lucide.min.js',
  'https://unpkg.com/lucide@latest',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js'
];

// Assets que SIEMPRE deben ir a la red primero (nunca servir versión vieja cacheada)
const NETWORK_FIRST_PATTERNS = [
  /app\.js/,
  /index\.html/,
  /puntos\.html/,
  /styles\.css/,
];


// 1. Install: Precache all essential offline assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' })
            .then((resp) => {
              if (resp && (resp.ok || resp.type === 'opaque')) {
                return cache.put(url, resp);
              }
            })
            .catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Activate: Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Fetch: Network-First para JS/HTML/CSS críticos, Cache-First para el resto
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Nunca cachear: API Google, imágenes de Drive, ni peticiones POST
  if (
    event.request.method !== 'GET' ||
    url.includes('script.google.com') ||
    url.includes('googleusercontent.com') ||
    url.includes('drive.google.com/thumbnail') ||
    url.includes('drive.google.com/uc')
  ) {
    return;
  }

  // Network-First para app.js, index.html, styles.css (siempre la versión más reciente)
  const isNetworkFirst = NETWORK_FIRST_PATTERNS.some((pattern) => pattern.test(url));

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Sin red: servir desde caché como fallback
          return caches.match(event.request).then(cached => cached || caches.match('./index.html'));
        })
    );
    return;
  }

  // Cache-First para el resto (CDNs, imágenes, etc.)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});
