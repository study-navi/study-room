const CACHE_NAME = 'study-room-stable-no-html-cache-20260706';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Always go to network. This avoids stale app files after updates.
  return;
});
