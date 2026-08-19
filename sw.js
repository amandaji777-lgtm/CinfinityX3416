const CACHE_NAME = 'shiguang-shell-v4';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/crypto-utils.js',
  './js/ai.js',
  './js/wizard.js',
  './js/resources.js',
  './js/chat.js',
  './js/memory.js',
  './js/proactive.js',
  './js/linkstatus.js',
  './js/bookmarks.js',
  './js/mood.js',
  './js/backup.js',
  './js/more.js',
  './js/ambience.js',
  './js/splash.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App shell: cache-first. Everything else (AI API calls, CDN fonts): network-only,
// never cache third-party responses so we don't accidentally cache API replies.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;

  if (!isSameOrigin || event.request.method !== 'GET') {
    return; // let the network handle it directly
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('', { status: 503, statusText: 'offline' });
      });
    })
  );
});
