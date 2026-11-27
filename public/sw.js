/* MoneyFlow Service Worker：只缓存静态资源，不缓存 IndexedDB 业务数据，不注册 push（无后端）。 */
const VERSION = 'mf-v2';
const CACHE = `moneyflow-${VERSION}`;
const CORE = ['./', './index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('moneyflow-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith('http')) return;
  // 账户与管理员接口位于 /functions/v1/...，必须始终走网络，避免缓存旧数据。
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/functions/')) return;

  if (req.mode === 'navigate') {
    // 导航：网络优先，失败回退缓存的 index.html（离线打开）
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // 其他同源静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    }),
  );
});
