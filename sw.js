/*
  Service Worker für das Wartungsprotokoll.

  Aufgabe: Die Anwendung nach dem ersten Online-Aufruf vollständig im Gerät
  ablegen, damit sie anschließend ohne Internetverbindung startet.

  Strategie:
  - Navigationsaufrufe (die Seite selbst) werden zuerst aus dem Cache bedient,
    damit der Start auch ohne Netz sofort funktioniert. Im Hintergrund wird
    geprüft, ob auf dem Server eine neuere Fassung liegt.
  - Übrige Dateien (Icons, Manifest) ebenso: erst Cache, dann Netz.
  - Eingegebene Protokolldaten liegen unverändert in localStorage und werden
    vom Service Worker nicht angefasst.

  WICHTIG bei Aktualisierungen: CACHE_VERSION hochzählen, sonst behalten
  bereits installierte Geräte die alte Fassung.
*/

const CACHE_VERSION = "wp-v4.1.0";
const CACHE_NAME = "wartungsprotokoll-" + CACHE_VERSION;

// Alles, was für den Offline-Betrieb gebraucht wird.
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* ------------------------------------------------------------------
   Installation: Anwendung vollständig in den Cache legen
   ------------------------------------------------------------------ */
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Einzeln hinzufügen: Schlägt eine Datei fehl, scheitert nicht die
      // gesamte Installation (z. B. wenn ein Icon noch fehlt).
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(new Request(url, { cache: "reload" })).catch(function (err) {
            console.warn("[SW] Nicht zwischengespeichert:", url, err);
          });
        })
      );
    })
  );
});

/* ------------------------------------------------------------------
   Aktivierung: veraltete Caches früherer Versionen entfernen
   ------------------------------------------------------------------ */
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (namen) {
      return Promise.all(
        namen.map(function (name) {
          if (name.indexOf("wartungsprotokoll-") === 0 && name !== CACHE_NAME) {
            return caches.delete(name);
          }
          return null;
        })
      );
    }).then(function () {
      // Ab sofort auch für bereits offene Tabs zuständig sein
      return self.clients.claim();
    })
  );
});

/* ------------------------------------------------------------------
   Abrufe beantworten
   ------------------------------------------------------------------ */
self.addEventListener("fetch", function (event) {
  const request = event.request;

  // Nur normale Leseabrufe behandeln
  if (request.method !== "GET") return;

  // Fremde Domains nicht anfassen
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(request, { ignoreSearch: true }).then(function (cached) {

        // Im Hintergrund nach einer neueren Fassung sehen
        const netzAbruf = fetch(request)
          .then(function (response) {
            if (response && response.status === 200 && response.type === "basic") {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(function () {
            return null;   // offline – völlig normal
          });

        if (cached) {
          // Sofort aus dem Cache antworten, Aktualisierung läuft nebenher
          return cached;
        }

        // Noch nichts im Cache: auf das Netz warten
        return netzAbruf.then(function (response) {
          if (response) return response;

          // Offline und nichts im Cache: Startseite als Rettungsanker
          if (request.mode === "navigate") {
            return cache.match("./index.html") || cache.match("./");
          }
          return new Response("", { status: 504, statusText: "Offline" });
        });
      });
    })
  );
});

/* ------------------------------------------------------------------
   Sofortiges Übernehmen einer neuen Fassung auf Wunsch der Seite
   ------------------------------------------------------------------ */
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
