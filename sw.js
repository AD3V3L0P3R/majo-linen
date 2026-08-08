/*
 * MAJO OPS - service worker
 * ---------------------------------------------------------------------------
 * COSA FA
 * Tiene una copia locale dell'app dentro il telefono, cosi' si apre subito e
 * funziona anche senza campo. Non cambia niente di come l'app parla col
 * backend: le chiamate a Google Apps Script non passano MAI da qui.
 *
 * REGOLA CHE TI RIGUARDA: non devi ricordarti niente.
 * L'HTML e' sempre preso dalla rete quando c'e' rete, quindi appena carichi un
 * index.html nuovo su GitHub tutti lo vedono al primo avvio. Le immagini
 * vengono servite dalla copia locale e aggiornate in sottofondo: se un giorno
 * cambi una foto, si vede al secondo avvio. Non c'e' nessun numero di versione
 * da incrementare a ogni modifica.
 *
 * L'unico caso in cui si tocca questo file e' se cambiano i NOMI dei file
 * (per esempio una foto nuova con un nome diverso): allora si aggiorna la
 * lista PRECACHE qui sotto e si alza CACHE_NAME di uno.
 *
 * TRE COSE CHE NON DEVE FARE, ED E' SCRITTO PERCHE' NON LE FACCIA:
 * 1. Non tocca le richieste che non sono GET. Le scritture verso Apps Script
 *    sono POST: se finissero in cache si perderebbero o si duplicherebbero.
 * 2. Non tocca niente che non stia su questo dominio. Apps Script e i font
 *    Google passano dritti.
 * 3. Non serve mai un HTML vecchio quando la rete c'e'. Al massimo aspetta
 *    NETWORK_TIMEOUT_MS, poi ripiega sulla copia locale per non lasciare
 *    l'operatore davanti a una pagina bianca in cantina.
 */

var CACHE_NAME = 'majo-ops-1';
var NETWORK_TIMEOUT_MS = 3500;

/* Guscio dell'app: quello che serve per aprirla anche senza rete. */
var PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './img/logo-mark.png',
  './img/logo-word-light.png',
  './img/logo-word-dark.png',
  './img/casa-majo.webp',
  './img/casa-nievo.webp',
  './img/hero-majo.webp',
  './img/thumb-majo.webp',
  './img/thumb-nievo.webp',
  './img/icon-192.png',
  './img/icon-512.png',
  './img/icon-maskable-512.png',
  './img/apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function (c) {
      /* Uno alla volta e con catch: se un singolo file manca sul repo,
         l'installazione non deve fallire in blocco. */
      return Promise.all(PRECACHE.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        return n === CACHE_NAME ? null : caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isDocument(req) {
  return req.mode === 'navigate' ||
         req.destination === 'document' ||
         (req.headers.get('accept') || '').indexOf('text/html') >= 0;
}

/* Prima la rete, con un tetto di attesa. Se la rete tace o e' troppo lenta,
   si apre comunque con l'ultima copia buona. */
function reteConTimeout(req) {
  return new Promise(function (resolve, reject) {
    var chiuso = false;
    var t = setTimeout(function () {
      if (!chiuso) { chiuso = true; reject(new Error('timeout')); }
    }, NETWORK_TIMEOUT_MS);
    fetch(req).then(function (r) {
      if (chiuso) return;
      chiuso = true; clearTimeout(t); resolve(r);
    }).catch(function (err) {
      if (chiuso) return;
      chiuso = true; clearTimeout(t); reject(err);
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;

  /* 1. Solo GET. Le scritture verso Apps Script non passano di qui. */
  if (req.method !== 'GET') return;

  /* 2. Solo questo dominio. Apps Script, font e tutto il resto passano dritti. */
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  /* 3. L'HTML: prima la rete, la copia locale solo come rete di sicurezza. */
  if (isDocument(req)) {
    e.respondWith(
      reteConTimeout(req).then(function (res) {
        if (res && res.ok) {
          var copia = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put('./index.html', copia); });
        }
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (cached) {
          return cached || caches.match('./') || Response.error();
        });
      })
    );
    return;
  }

  /* 4. Tutto il resto (immagini, manifest, icone): si serve subito la copia
        locale e intanto si controlla in sottofondo se e' cambiata. */
  e.respondWith(
    caches.match(req).then(function (cached) {
      var rete = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copia = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copia); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || rete;
    })
  );
});

/* Le notifiche ad app chiusa arriveranno da qui quando ci sara' un servizio
   di invio. Per ora il gestore c'e' ma non lo chiama nessuno: e' innocuo e
   evita di dover rimettere le mani nel file piu' avanti. */
self.addEventListener('push', function (e) {
  var dati = { title: 'Majo Ops', body: '' };
  try { if (e.data) dati = Object.assign(dati, e.data.json()); } catch (err) {}
  e.waitUntil(self.registration.showNotification(dati.title, {
    body: dati.body,
    icon: 'img/icon-192.png',
    badge: 'img/icon-192.png',
    tag: dati.tag || 'majo-ops'
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        if ('focus' in lista[i]) return lista[i].focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
