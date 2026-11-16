// Service Worker：让 Epoch 可以“安装到桌面”，并在离线时打开（训练数据本来就存在浏览器里，AI 功能需要联网）。
// 策略：页面走网络优先（保证总是最新，离线时用缓存）；带版本号的 v/<build>/ 资源与字体内容不变，缓存优先；/api/ 一律不缓存。
const CACHE = 'epoch-v2';
const SHELL = ['./', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    // 旧版本的带版本号资源用不到了，清掉（只保留当前页面引用的那一版）
    const c = await caches.open(CACHE);
    const page = await c.match('./');
    const cur = page && /v\/([0-9a-f]+)\//.exec(await page.clone().text())?.[1];
    if (cur) for (const req of await c.keys()) { const m = /\/v\/([0-9a-f]+)\//.exec(req.url); if (m && m[1] !== cur) await c.delete(req); }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  const rel = url.pathname.slice(scope.length);
  const immutable = /^v\/[0-9a-f]+\//.test(rel) || rel.startsWith('fonts/') || rel.startsWith('icons/');
  if (req.mode === 'navigate') {
    // 应用页面都是同一个 index.html（hash 路由）；widget.html 等独立页面单独缓存，不能覆盖应用外壳
    const shell = rel === '' || rel === 'index.html';
    const key = shell ? './' : req.url.split('?')[0];
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); } return res; })
      .catch(async () => (await caches.match(key)) || (shell ? Response.error() : (await caches.match('./')) || Response.error())));
    return;
  }
  if (immutable) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  // 其余（动态 import 的模块等）：网络优先，离线回落缓存
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || Response.error()));
});
