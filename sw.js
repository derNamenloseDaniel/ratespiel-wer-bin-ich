// ── Service Worker: offline-first ───────────────────────────────────────────
//
// WICHTIG (Lehre vom Fest, 09.08.2026): Die App lief hier vorher "network-first" –
// jeder Request ging erst ins Netz, Cache war nur der Fallback im catch().
// Auf einem Fest mit Funkempfang, aber ohne nutzbare Datenverbindung schlägt
// fetch() nicht fehl, sondern hängt (kein DNS, kein RST – einfach Stille).
// Der catch() greift also nie oder erst nach Minuten → die App startete nicht.
// Deshalb: Shell IMMER zuerst aus dem Cache, Netz nur noch im Hintergrund.

const VERSION   = 'v29';
const SHELL     = `ratespiel-shell-${VERSION}`;
const MEDIA     = 'ratespiel-media';   // Wikipedia-Bilder/-Antworten, überlebt Versionswechsel
// Reicht für alle elf Kategorien (~540 Bilder) mit reichlich Luft. Gezählt
// werden nur Bilder – die API-Antworten landen bewusst nicht im Cache, weil
// die Bild-URLs ohnehin im localStorage stehen (IMG_MEMO). Sonst wäre über die
// Hälfte der Einträge Beiwerk und würde echte Bilder aus dem Cache verdrängen.
const MEDIA_MAX = 1500;

const ASSETS = [
  './', './index.html', './style.css', './app.js', './i18n.js', './data.js',
  './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
];

const isWiki   = url => /(^|\.)wiki(p|m)edia\.org$/.test(url.hostname);
const isWikiApi = url => url.pathname.endsWith('/api.php');

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // Einzeln statt addAll(): eine einzige fehlende Datei darf nicht die
    // komplette Offline-Fähigkeit verhindern (addAll ist all-or-nothing).
    await Promise.all(ASSETS.map(a =>
      c.add(new Request(a, { cache: 'reload' })).catch(() => {})
    ));
    self.skipWaiting();
  })());
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== SHELL && k !== MEDIA)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isWiki(url)) {
    // API-Antworten laufen ungecacht durch – offline werden sie nicht
    // gebraucht, die Bild-URLs stehen im localStorage.
    if (!isWikiApi(url)) e.respondWith(mediaFirst(req));
    return;
  }
  if (url.origin !== location.origin) return;          // Fremdes: Browser macht das
  if (url.pathname.endsWith('/sw.js')) return;         // SW-Update nie aus dem Cache

  e.respondWith(shellFirst(req));
});

// Jede Datei wird pro SW-Lebensdauer höchstens einmal aufgefrischt. Ohne das
// stößt ein Start neun Netzanfragen an – offline hängen die bis zum Timeout und
// halten Funk und Service Worker unnötig wach.
const revalidated = new Set();

// Cache zuerst, Netz nur im Hintergrund zum Auffrischen.
async function shellFirst(req) {
  const cache  = await caches.open(SHELL);
  const cached = await cache.match(req);

  if (cached) {
    // stale-while-revalidate: blockiert nie, aktualisiert für den nächsten Start
    if (navigator.onLine && !revalidated.has(req.url)) {
      revalidated.add(req.url);
      fetch(req).then(r => { if (r && r.ok) cache.put(req, r.clone()); }).catch(() => {});
    }
    return cached;
  }

  try {
    const r = await fetch(req);
    if (r && r.ok) cache.put(req, r.clone());
    return r;
  } catch {
    // Offline und nichts im Cache: Navigation trotzdem auf die App lenken,
    // statt die Browser-Fehlerseite zu zeigen.
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('./');
      if (fallback) return fallback;
    }
    return new Response('', { status: 503, statusText: 'offline' });
  }
}

// Wikipedia: einmal geholt = für immer offline verfügbar.
async function mediaFirst(req) {
  const cache = await caches.open(MEDIA);
  // ignoreVary, weil der Vorabdownload per fetch() lädt, das <img> im Spiel
  // aber andere Accept-Header schickt – ohne das wäre der Treffer futsch.
  const cached = await cache.match(req, { ignoreVary: true });
  if (cached) return cached;

  try {
    const r = await fetch(req);
    // opaque (no-cors-Bilder) haben status 0 – die wollen wir trotzdem behalten
    if (r && (r.ok || r.type === 'opaque')) {
      cache.put(req, r.clone()).then(() => trim(cache));
    }
    return r;
  } catch {
    return new Response('', { status: 503, statusText: 'offline' });
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MEDIA_MAX) return;
  // keys() liefert Einfügereihenfolge → die ältesten fliegen zuerst
  await Promise.all(keys.slice(0, keys.length - MEDIA_MAX).map(k => cache.delete(k)));
}
