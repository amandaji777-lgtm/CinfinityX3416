const CACHE_NAME = 'xingji-shell-v82';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/crypto-utils.js',
  './js/ai.js',
  './js/pages.js',
  './js/ui-dialog.js',
  './js/wallpaper.js',
  './js/splash-photo.js',
  './js/avatars.js',
  './js/resources.js',
  './js/chat.js',
  './js/memory.js',
  './js/proactive.js',
  './js/linkstatus.js',
  './js/bookmarks.js',
  './js/mood.js',
  './js/calendar.js',
  './js/backup.js',
  './js/more.js',
  './js/ambience.js',
  './js/silentsync.js',
  './js/splash.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/nav-bookmarks.png',
  './icons/nav-mood.png',
  './icons/nav-home.png',
  './icons/nav-calendar.png',
  './icons/nav-more.png'
];

// cache.addAll() 内部就是逐个 fetch()，默认缓存策略下会先看浏览器自己的 HTTP
// 缓存——如果这个文件最近被普通页面加载访问过、Cache-Control 还没过期，就会
// 直接拿 HTTP 缓存里那份旧内容去填新的 Cache Storage，新缓存的名字虽然换了，
// 塞进去的还是旧字节。逐个用 {cache:'reload'} 强制绕开 HTTP 缓存直接问网络，
// 才能保证每次真的换版本号时，装进新缓存里的必定是最新内容。
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res)))
      ))
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
