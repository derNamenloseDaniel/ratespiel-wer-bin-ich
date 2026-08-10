# Status – Ratespiel „Wer bin ich?"

Stand: 10.08.2026 · **v3.5 ist live** auf GitHub Pages. Offline-Test auf dem Handy bestanden.

## In Arbeit

*(nichts)*

## Queue

*(nichts)*

## Zu besprechen

*(nichts offen)*

## Warten auf Feedback

- **Daniel: App neu installieren** (1 SP) — Seite im Browser öffnen, links steht jetzt
  „📲 Als App installieren". Falls Chrome keinen Dialog anbietet, zeigt der Knopf die Anleitung
  über das ⋮-Menü.
- **Daniel: Startdauer vom Handy ablesen** (1 SP) — App vom Home-Bildschirm starten, unten links
  steht jetzt `v3.4 · <Zahl> ms`. Kleine Zahl trotz langem Warten heißt: die Zeit vergeht
  **vor** unserem Code (Browser-Kaltstart, Service-Worker-Start, PWA-Splash) und lässt sich in
  der App nicht wegoptimieren. Große Zahl heißt: es liegt weiter bei uns, dann weitersuchen.

## Entschieden

- **Bildmodus offline** (bestätigt 10.08.2026): gesperrt nur dann, wenn *keine* Bilder geladen
  sind. Mit vorab geladenen Bildern bleibt er offen. Kurzform: online herunterladen, offline
  spielen — ohne Daten und ohne Netz gesperrt.

## Später (nice to have)

- Bilder auch für den Wortmodus vorhalten, damit man mitten in der Runde umschalten kann

## Archiv

- **10.08.2026 – Offline-Test auf dem Handy bestanden** („klappt"). Damit ist der eigentliche
  Anlass — das Spiel lief auf dem Fest ohne Internet nicht — erledigt.
- **10.08.2026 – v3.4: Installierbarkeit repariert.** Von Daniel gemeldet: nach dem
  Deinstallieren bot die Seite keinen Weg zurück. Ursache war der v3.3-Umbau, der
  `serviceWorker.register()` in den Leerlauf verschob — ohne registrierten Worker stuft Chrome
  die Seite nicht als installierbar ein und `beforeinstallprompt` bleibt aus. Registrierung
  wieder sofort, dazu ein dauerhafter Installations-Knopf, der ohne Prompt die Anleitung zeigt.
  Nebenbei: die Standalone-Erkennung prüfte nur `display-mode: standalone`, das Manifest sagt
  aber `fullscreen`.
- **10.08.2026 – v3.3: Startpfad freigeräumt.** Größte Bremse war, dass gar nichts gerendert
  wurde, bevor `app.js` durch war (jeder Screen stand `hidden` im HTML). Dahinter
  `new AudioContext()` auf Modulebene, das die Audio-Hardware hochfährt und dabei blockiert.
  Beides behoben; Speicherzählung und SW-Registrierung laufen im Leerlauf, der Service Worker
  frischt jede Datei nur noch einmal pro Lebensdauer und nur online auf.
  Startdauer steht jetzt am Versionslabel. Lokal: 12–14 ms, mit gestopptem Server ebenfalls 12 ms.
- **10.08.2026 – v3.2: Speicheranzeige nach „Leeren" korrigiert.** Von Daniel gemeldet: nach dem
  Bestätigen wurde der Bildmodus richtig gesperrt, die Zeile zeigte aber weiter „22 MB
  offline gespeichert". Ursache war `navigator.storage.estimate()`, dessen Quota-Buchhaltung
  nach `caches.delete()` hinterherhinkt. Jetzt wird der Media-Cache selbst summiert
  (`Content-Length`), gezählt nur bei echten Änderungen. Nebenbei behoben: ein offener
  Debounce-Timer hätte das gerade geleerte Bild-Gedächtnis wieder zurückgeschrieben.
- **10.08.2026 – `AUFGABEN.md` gelöscht** (`9880737`). Ursprüngliche Bauanleitung vom Juni,
  kein Punkt je abgehakt. Stand steht in dieser Datei, Historie in `CLAUDE.md`.
- **10.08.2026 – v3.1: Bedienung des Vorabdownloads + drei echte Fehler dabei gefunden.**
  „⬇ Bilder für offline"-Knopf lädt alle Kategorien am Stück, Speicheranzeige mit Leeren-Knopf,
  Bildmodus offline gesperrt solange nichts geladen ist, nicht geladene Kategorien offline
  ausgegraut. Beim Testen aufgefallen und behoben: (1) Bilder per `<img>` geholt = opaque
  Antworten = 308 MB statt 11 MB angerechnet → jetzt CORS-`fetch` + `ignoreVary`;
  (2) Wikipedia drosselt mit HTTP 429 → Sammelabfrage für 25 Begriffe statt Einzelanfragen,
  429 wird abgewartet statt als Offline gewertet; (3) ein einzelner Fehlschlag hat die App
  fälschlich auf „offline" gestellt → erst drei in Folge zählen.
  Gemessen: eine Kategorie = 45 Bilder = 7,9 MB, alle elf also grob 90 MB.
  Media-Cache-Grenze deshalb auf 1500 Einträge, API-Antworten landen gar nicht mehr im Cache.
- **10.08.2026 – v3.0 committet und gepusht** (`e61d537`), damit auf GitHub Pages live.
- **10.08.2026 – Lokale Verifikation v3.0 bestanden.** Auf `localhost:8080` geprüft: SW aktiv,
  alle 9 Shell-Dateien im Precache. Danach Server gestoppt und Seite neu geladen → App startet
  vollständig aus dem Cache. Wortmodus offline spielbar (Karten wechseln, Punkte zählen).
  Bildmodus mit vorab geladener Kategorie „Obst" (48/48 Bilder, 142 Media-Cache-Einträge) zeigt
  offline echte Bilder; Kategorie ohne Vorabdownload zeigt Wörter statt die Runde abzubrechen.
  SW-Reload wird mitten im Spiel unterdrückt. Keine Konsolenfehler.
- v2.9 und älter: siehe Versionstabelle in `CLAUDE.md`
