/* Bob Daily Briefing service worker.
   App-shell requests are network-first so deploys update cleanly; cache is the
   offline fallback. Firebase and Google auth traffic always bypasses the cache. */
var CACHE_NAME = 'bob-briefing-shell-v44';

var briefingMessaging = null;
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');
  firebase.initializeApp({
    apiKey: 'AIzaSyB_6PnXWdtpR-x-jcJIuzOaROoVRplY5SM',
    authDomain: 'pokerhq-a67e4.firebaseapp.com',
    projectId: 'pokerhq-a67e4',
    storageBucket: 'pokerhq-a67e4.firebasestorage.app',
    messagingSenderId: '91226487101',
    appId: '1:91226487101:web:0cf1b3411ff9d17a00ad54'
  });
  briefingMessaging = firebase.messaging();
  briefingMessaging.onBackgroundMessage(function(payload) {
    var data = payload && payload.data || {};
    if (!data.title) return;
    return self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      tag: data.signature || 'bob-morning-five',
      renotify: true,
      actions: [
        {action: 'open', title: 'Open Command Center'},
        {action: 'mute', title: 'Mute delivery'}
      ],
      data: {url: data.url || './#command'}
    });
  });
} catch (error) {
  console.warn('[BobBriefing] Background messaging unavailable:', error);
}

var PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html',
  './lib/command-center-core.js',
  './lib/command-review-core.js',
  './lib/intelligence-search-core.js',
  './lib/evidence-sets-core.js',
  './lib/entity-timeline-core.js',
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

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = event.notification.data && event.notification.data.url || './#command';
  if (event.action === 'mute') {
    var muted = new URL(target, self.location.origin);
    muted.searchParams.set('mute', 'delivery');
    target = muted.href;
  }
  event.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(windows) {
    for (var i = 0; i < windows.length; i++) {
      if ('focus' in windows[i]) {
        if ('navigate' in windows[i]) return windows[i].navigate(target).then(function(client) { return client.focus(); });
        return windows[i].focus();
      }
    }
    return clients.openWindow ? clients.openWindow(target) : null;
  }));
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
