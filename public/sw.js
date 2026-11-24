/* عامل خدمة سوقي: يستقبل إشعارات Firebase Cloud Messaging ويعرضها، ويفتح الرابط عند الضغط */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch { p = { notification: { body: event.data && event.data.text() } }; }
  // FCM يرسل notification/data؛ عند وجود notification مع fcm_options قد يعرضه المتصفح تلقائيًا، فنعرض فقط إن لم يُعرض
  const n = p.notification || {};
  const d = p.data || {};
  const title = n.title || d.title || 'سوقي';
  const link = (d.link && d.link.startsWith('/')) ? d.link : '/account/notifications';
  event.waitUntil(self.registration.showNotification(title, {
    body: n.body || d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', dir: 'rtl', lang: 'ar',
    tag: (d.tag || link), renotify: true, data: { link },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.link) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { if (w.url.startsWith(self.location.origin)) { await w.focus(); return w.navigate(url); } }
    return self.clients.openWindow(url);
  })());
});
