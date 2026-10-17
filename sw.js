/* Daybook service worker.
   The app page opens from the cache and refreshes behind itself (openShell);
   other requests of Daybook's own are network-first, with the cache as the
   offline fallback. Firebase and Google auth traffic always bypasses the cache. */
var CACHE_NAME = 'bob-briefing-shell-v309';

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
        {action: 'open', title: data.type === 'watch-reminders' ? 'Open Today' : 'Open Command Center'},
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
  './lib/app-reliability.js',
  './lib/ui-shell.js',
  './lib/daily-boost.js',
  './lib/weekly-mirror.js',
  './lib/command-center-core.js',
  './lib/command-review-core.js',
  './lib/intelligence-search-core.js',
  './lib/evidence-sets-core.js',
  './lib/entity-timeline-core.js',
  './lib/radar-assistant-core.js',
  './lib/flights-core.js',
  './lib/sports-trust-core.js',
  './lib/pse-research-core.js',
  './lib/pse-research-ui.js',
  './lib/flights-ui.js',
  './lib/daybook-calendar-core.js',
  './lib/daybook-calendar-ui.js',
  './lib/weekly-review-core.js',
  './lib/health-core.js',
  './lib/checkup-core.js',
  './lib/lifestyle-core.js',
  './lib/weekly-review-ui.js',
  './reports/mindanao-eq-2026.html',
  './reports/report-template.html',
  './assets/icons/daybook-mark.svg',
  './assets/icons/favicon-32.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/maskable-192.png',
  './assets/icons/maskable-512.png',
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
      // Past the browser's own cache (GitHub Pages allows 10 minutes), so a new
      // release never stores the page it replaces.
      return cache.addAll(PRECACHE.map(function(path) { return new Request(path, { cache: 'reload' }); }));
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// A tap on a push opens Daybook at the page it names. The address is shared
// with the other apps on github.io (PokerHQ, SonicVault), so only windows under
// Daybook's own scope count: steering one of theirs fails and nothing opens.
// The window is raised first, while the tap still allows it (a raise after a
// slow load is refused), then moved; a window this worker cannot move is told
// to go there itself (index.html openFromServiceWorker).
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var scope = self.registration.scope;
  var target = new URL(event.notification.data && event.notification.data.url || './#command', scope);
  if (target.href.indexOf(scope) !== 0) target = new URL('./#command', scope);
  if (event.action === 'mute') target.searchParams.set('mute', 'delivery');
  var url = target.href;
  // The app counts the tap (push_open) from this mark, then removes it.
  target.searchParams.set('from', 'push');
  var marked = target.href;
  event.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(windows) {
    // Most recently focused first, so this is the Daybook window he used last.
    var mine = windows.filter(function(w) { return w.url && w.url.indexOf(scope) === 0; })[0];
    if (!mine) return clients.openWindow ? clients.openWindow(marked) : null;
    return Promise.resolve(mine.focus ? mine.focus() : mine).catch(function() { return mine; }).then(function(client) {
      client = client || mine;
      var tell = function() { client.postMessage({type: 'daybook-open', url: marked}); return client; };
      // Already there: raised and told, so the tap counts without a reload.
      if (client.url === url) return tell();
      return client.navigate ? client.navigate(marked).then(function(moved) { return moved || tell(); }, tell) : tell();
    });
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

// The app itself (index.html) opens from the cache at once. From the network
// it took 3–4 s after each release on Bob's connection (17 Oct 2026: the page
// is about 517 KB compressed), and a weak signal held it up with no limit. A
// fresh copy is fetched behind it and kept for the next open; when that copy
// is a new release, open Daybook windows are told, so they can offer it.
function shellKey() { return new URL('./', self.registration.scope).href; }
function isShell(url) {
  var page = url.href.split(/[?#]/)[0], base = shellKey();
  return page === base || page === base + 'index.html';
}
function versionOf(res) { return (res && res.headers && (res.headers.get('etag') || res.headers.get('last-modified'))) || ''; }
function tellUpdated() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windows) {
    windows.filter(function(w) { return w.url && w.url.indexOf(self.registration.scope) === 0; })
      .forEach(function(w) { w.postMessage({ type: 'daybook-update' }); });
  });
}
function openShell(event) {
  var key = shellKey();
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(key).then(function(hit) {
      var fresh = fetch(key, { cache: 'no-cache', credentials: 'same-origin' }).then(function(res) {
        if (!res || res.status !== 200) return res;
        var changed = !!hit && versionOf(hit) !== '' && versionOf(res) !== versionOf(hit);
        return cache.put(key, res.clone()).then(function() { return changed ? tellUpdated() : null; }).then(function() { return res; });
      });
      if (hit) {
        event.waitUntil(fresh.catch(function() {}));
        return hit;
      }
      return fresh.catch(function() { return caches.match(new URL('./offline.html', self.registration.scope).href); });
    });
  });
}

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (BYPASS_HOSTS.indexOf(url.hostname) !== -1) return;

  if (req.mode === 'navigate' && isShell(url)) {
    event.respondWith(openShell(event));
    return;
  }

  // Everything else of Daybook's own (data such as the shared sports feed,
  // reports, icons) stays network-first, with the cache as the offline copy.
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
