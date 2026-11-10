'use strict';
// Bei jeder Änderung an app.js oder style.css: VERSION hier und ?v= in den HTML-Dateien erhöhen.
const VERSION = 'v5';
const APP = 'hydranten-app-' + VERSION;
const TILES = 'hydranten-tiles';
const MAX_TILES = 800;
const PRECACHE = [
  '/', '/app.js?v=5', '/style.css?v=5', '/manifest.webmanifest', '/impressum', '/datenschutz',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/favicon-32.png',
  '/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/vendor/leaflet/images/marker-icon.png', '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/cluster/leaflet.markercluster.js', '/vendor/cluster/MarkerCluster.css', '/vendor/cluster/MarkerCluster.Default.css',
  '/data/hydrants.json', '/data/districts.geojson'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hydranten-app-') && k !== APP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map(k => cache.delete(k)));
}

// Gespeichert ausliefern und im Hintergrund aktualisieren
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, {ignoreSearch: cacheName === APP && request.mode === 'navigate'});
  const network = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', e => {
  const {request} = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Kartenkacheln: nur bereits angesehene Ausschnitte werden gespeichert (kein Vorladen)
  if (url.hostname === 'mapsneu.wien.gv.at' && url.pathname.startsWith('/basemap/')) {
    e.respondWith(caches.open(TILES).then(async cache => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const res = await fetch(request);
      if (res.ok && res.type === 'cors') { cache.put(request, res.clone()); trimTiles(); }
      return res;
    }));
    return;
  }
  // Veröffentlichte Notizen auch offline anzeigen
  if (url.origin === location.origin && url.pathname === '/api/notes') {
    e.respondWith(fetch(request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(request, copy)); }
      return res;
    }).catch(async () => (await caches.match(request)) || Response.error()));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/notiz/')) return;

  if (request.mode === 'navigate') {
    // Seiten: zuerst Netz, offline die gespeicherte Version
    e.respondWith(fetch(request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(APP).then(c => c.put(url.pathname, copy)); }
      return res;
    }).catch(async () => (await caches.match(url.pathname)) || caches.match('/')));
    return;
  }
  e.respondWith(staleWhileRevalidate(request, APP));
});
