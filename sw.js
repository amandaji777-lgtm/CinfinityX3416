// ASSET_VERSION 要跟 index.html 里每个 <script src="js/xxx.js?vNN"> /
// <link href="css/style.css?vNN"> 的查询参数完全一致——光靠缓存名字
// （CACHE_NAME）换新，只能让"这个 service worker 算不算新版本"这件事
// 变了，不能让 css/style.css 这个 URL 本身变成一个全新、从没被请求过的
// 地址。之前反复出现"GitHub Actions 明明说部署成功了，用户那边却死活
// 看不到新样式"，查了好几轮 service worker/HTTP 缓存的各种细节都没能
// 完全根治，怀疑是中间某一层（大概率是 GitHub Pages 自己的 CDN 边缘
// 节点）用的是"同一个 URL 在一段时间内直接复用旧缓存"这类更激进的策略，
// 不是单纯靠 Cache-Control/Service Worker 这层能绕开的。查询参数一换，
// 不管是浏览器缓存、Service Worker 缓存还是 CDN 边缘缓存，看到的都是
// "一个从没出现过的新地址"，没有旧内容可复用，只能老老实实回源拿最新的。
const ASSET_VERSION = 'v86';
const CACHE_NAME = 'xingji-shell-' + ASSET_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  `./css/style.css?${ASSET_VERSION}`,
  `./js/app.js?${ASSET_VERSION}`,
  `./js/db.js?${ASSET_VERSION}`,
  `./js/crypto-utils.js?${ASSET_VERSION}`,
  `./js/ai.js?${ASSET_VERSION}`,
  `./js/pages.js?${ASSET_VERSION}`,
  `./js/ui-dialog.js?${ASSET_VERSION}`,
  `./js/wallpaper.js?${ASSET_VERSION}`,
  `./js/splash-photo.js?${ASSET_VERSION}`,
  `./js/avatars.js?${ASSET_VERSION}`,
  `./js/resources.js?${ASSET_VERSION}`,
  `./js/chat.js?${ASSET_VERSION}`,
  `./js/memory.js?${ASSET_VERSION}`,
  `./js/proactive.js?${ASSET_VERSION}`,
  `./js/linkstatus.js?${ASSET_VERSION}`,
  `./js/bookmarks.js?${ASSET_VERSION}`,
  `./js/mood.js?${ASSET_VERSION}`,
  `./js/calendar.js?${ASSET_VERSION}`,
  `./js/backup.js?${ASSET_VERSION}`,
  `./js/more.js?${ASSET_VERSION}`,
  `./js/ambience.js?${ASSET_VERSION}`,
  `./js/silentsync.js?${ASSET_VERSION}`,
  `./js/splash.js?${ASSET_VERSION}`,
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
