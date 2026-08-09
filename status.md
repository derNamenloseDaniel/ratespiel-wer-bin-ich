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

1. **Committen + pushen** (1 SP) — Push geht direkt auf GitHub Pages.
2. **Auf dem echten Handy testen** (2 SP) — einmal mit WLAN öffnen, Kategorien per ⬇ laden,
   „✅ Offline spielbereit" abwarten, Flugmodus, spielen. Idealerweise auf Android *und* iOS,
   weil Safari den Service Worker anders behandelt.

## Zu besprechen

- **Speicherbedarf des Bild-Vorabdownloads:** eine Kategorie ≈ 50 Bilder ≈ 3–5 MB, alle elf
  also grob 40 MB. Reicht das Laden je Kategorie, oder soll ein „alles laden"-Knopf dazu?
- **Obergrenze des Media-Caches** steht aktuell bei 900 Einträgen (älteste fliegen zuerst).
  Bei elf voll geladenen Kategorien wird das knapp — anheben oder so lassen?
- **`AUFGABEN.md` ist veraltet:** enthält die ursprüngliche Bauanleitung, jeder Punkt noch
  unangehakt, obwohl das Spiel seit v1.0 läuft. Archivieren oder löschen?

## Warten auf Feedback

- Daniel: geht die Restpunkte gerade 1:1 durch (10.08.2026)

## Später (nice to have)

- Bilder auch für den Wortmodus vorhalten, damit man mitten in der Runde umschalten kann
- Anzeige, wie viel Speicher die geladenen Bilder belegen (`navigator.storage.estimate()`)

## Archiv

- **10.08.2026 – Lokale Verifikation v3.0 bestanden.** Auf `localhost:8080` geprüft: SW aktiv,
  alle 9 Shell-Dateien im Precache. Danach Server gestoppt und Seite neu geladen → App startet
  vollständig aus dem Cache. Wortmodus offline spielbar (Karten wechseln, Punkte zählen).
  Bildmodus mit vorab geladener Kategorie „Obst" (48/48 Bilder, 142 Media-Cache-Einträge) zeigt
  offline echte Bilder; Kategorie ohne Vorabdownload zeigt Wörter statt die Runde abzubrechen.
  SW-Reload wird mitten im Spiel unterdrückt. Keine Konsolenfehler.
- v2.9 und älter: siehe Versionstabelle in `CLAUDE.md`
