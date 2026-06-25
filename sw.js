/* Bob Daily Briefing service worker.
   App-shell requests are network-first so deploys update cleanly; cache is the
   offline fallback. Firebase and Google auth traffic always bypasses the cache. */
var CACHE_NAME = 'bob-briefing-shell-v37';

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './reports/mindanao-eq-2026.html',
  './reports/report-template.html',
  './assets/icons/bob-briefing-mark.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon-180.png'
];

var BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(key) {
        // Only clean up THIS app's own old caches. caches is per-origin and shared
        // with sibling apps (pokerhq, enclave) on github.io — never delete theirs.
        return key.indexOf('bob-briefing-shell-') === 0 && key !== CACHE_NAME;
      }).map(function(key) {
        return caches.delete(key);
      }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (BYPASS_HOSTS.indexOf(url.hostname) !== -1) return;

  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(
      fetch(req.mode === 'navigate' ? req : req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function(res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return caches.match(req, { ignoreSearch: true }).then(function(hit) {
          return hit || (req.mode === 'navigate' ? caches.match('./offline.html') : Response.error());
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function(hit) {
      var refresh = fetch(req).then(function(res) {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return hit;
      });
      return hit || refresh;
    })
  );
});
