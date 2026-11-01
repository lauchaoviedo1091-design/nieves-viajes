// Permite abrir la app aunque falle internet (muestra lo último guardado en este dispositivo).
// Siempre intenta primero la versión nueva; solo usa la copia si no hay conexión.
// Los datos de pasajeros NO se guardan acá: solo los archivos de la app.
const CACHE = 'nv-app-2.0.0';
const SHELL = [
  './', 'index.html', 'css/app.css?v=2.0.0', 'js/config.js?v=2.0.0', 'js/app.js?v=2.0.0', 'vendor/supabase.js',
  'manifest.webmanifest', 'img/logo-192.png', 'img/icon-192.png', 'img/favicon-48.png',
  'fonts/source-sans-3-latin-400-normal.woff2', 'fonts/source-sans-3-latin-600-normal.woff2',
  'fonts/source-sans-3-latin-700-normal.woff2', 'fonts/source-sans-3-latin-400-italic.woff2',
  'fonts/libre-baskerville-latin-400-normal.woff2', 'fonts/libre-baskerville-latin-700-normal.woff2',
  'fonts/libre-baskerville-latin-400-italic.woff2', 'fonts/cinzel-latin-600-normal.woff2', 'fonts/cinzel-latin-700-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return; // la base de datos y las fotos nunca pasan por acá
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match(req, { ignoreSearch: true }))
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
      )
  );
});
