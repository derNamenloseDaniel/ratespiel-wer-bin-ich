# Status – Ratespiel „Wer bin ich?"

Stand: 09.08.2026 · Arbeitsstand **v3.0 (Offline-Fähigkeit)** liegt uneingecheckt im Arbeitsverzeichnis.

## In Arbeit

| Task | SP | Stand |
|---|---|---|
| Offline-Fähigkeit v3.0 | 5 | Code fertig, **nicht verifiziert, nicht committet** |

Was v3.0 geändert hat (Details in `CLAUDE.md`):

- `sw.js` → cache-first Shell + stale-while-revalidate, eigener dauerhafter Media-Cache für
  Wikipedia-Bilder, Icons mit im Precache, nie mehr `respondWith(undefined)`
- `app.js` → 5-s-Timeout auf jeden Netzzugriff, Bild-URL-Gedächtnis im localStorage,
  Bildmodus fällt offline auf das Wort zurück statt das Deck durchzurasen,
  Vorabdownload je Kategorie, Offline-Anzeige, kein SW-Reload mitten im Spiel
- `index.html` / `style.css` / `i18n.js` → Offline-Chip, HUD-Badge 📴, ⬇-Knopf je Kategorie
- Version auf v3.0 / SW-Cache v25 gebumpt

## Queue

1. **Auf dem echten Handy testen** (2 SP) — einmal mit WLAN öffnen, Kategorien per ⬇ laden,
   „✅ Offline spielbereit" abwarten, Flugmodus, spielen. Idealerweise auf Android *und* iOS,
   weil Safari den Service Worker anders behandelt.

## Zu besprechen

*(nichts offen)*

## Warten auf Feedback

- Daniel: geht die Restpunkte gerade 1:1 durch (10.08.2026)

## Später (nice to have)

- Bilder auch für den Wortmodus vorhalten, damit man mitten in der Runde umschalten kann
- Anzeige, wie viel Speicher die geladenen Bilder belegen (`navigator.storage.estimate()`)

## Archiv

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
