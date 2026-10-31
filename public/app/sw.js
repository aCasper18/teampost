// Service Worker der App: Push-Mitteilungen anzeigen, beim Antippen die passende Seite öffnen,
// ohne Netz eine Hinweisseite statt eines Browser-Fehlers. Daten werden nicht zwischengespeichert (immer aktuell vom Server).
const CACHE = 'teampost-1';
const OFFLINE = '/app/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/app/icon.svg', '/app/badge-96.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { text: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titel || 'Neue Mitteilung', {
    body: d.text || '', icon: '/app/icon.svg', badge: '/app/badge-96.png', tag: d.tag, renotify: Boolean(d.tag),
    data: { url: d.url || '/mail' }, lang: 'de',
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = new URL(e.notification.data?.url || '/mail', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenster) => {
    const offen = fenster.find((f) => f.url.startsWith(self.location.origin));
    if (offen) return offen.navigate(ziel).then((f) => (f || offen).focus());
    return self.clients.openWindow(ziel);
  }));
});
