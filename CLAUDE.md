# Ratespiel – Wer bin ich? · Projektregeln

## PFLICHT bei jeder Änderung: Version bumpen

Bei **jeder** Änderung am Spiel (Bug fix, Feature, Styling, Daten) MÜSSEN folgende drei Stellen gleichzeitig aktualisiert werden:

1. **`index.html`** – `<span class="version-label">vX.Y</span>` (sichtbar im Startscreen)
2. **`sw.js`** – `const CACHE = 'ratespiel-vN';` (N ist eine fortlaufende Ganzzahl, unabhängig von X.Y)
3. **`CLAUDE.md`** (diese Datei) – aktuelle Version unten in der Tabelle eintragen

Nie vergessen. Keine Ausnahme.

## Aktuelle Versionen

| App-Version | SW-Cache   | Datum      | Beschreibung                        |
|-------------|------------|------------|-------------------------------------|
| v1.0        | v5         | 2026-06-23 | Launch                              |
| v1.1        | v6         | 2026-06-23 | Kalibrierungs-UI redesign           |
| v1.2        | v7         | 2026-06-23 | Tiltrichtung korrigiert, Cooldown 300ms |
| v1.3        | v8         | 2026-06-23 | Kalibrierung als geführter 3-Schritt-Wizard, Tilt-Hint entfernt |
| v1.4        | v9         | 2026-06-23 | Berufe-Bild-Suche mit imageSearchSuffix " Beruf" disambiguiert |
| v1.5        | v10        | 2026-06-24 | Tilt: 3D-Richtungsvektor (beta+gamma) statt nur beta-Achse |
| v1.6        | v11        | 2026-06-24 | Versionslabel position:fixed statt absolute (kein Layout-Shift) |
| v1.7        | v12        | 2026-06-24 | Kalibrierung: OK-Klick für neutral, Auto-Detect für vorne/hinten; Schwelle 40°, Cooldown 1,2s |
| v1.8        | v13        | 2026-06-24 | Kalibrierung: Rückwärts-Schritt entfernt; nur neutral+vorwärts nötig, backward=−forward |
| v1.9        | v14        | 2026-06-24 | Sensor-Debug-Overlay: live β/γ/Projektion/Richtung zum Testen |
| v2.0        | v15        | 2026-06-24 | Debug-Neutral auto-detect beim Öffnen; screen.orientation.lock landscape |
| v2.1        | v16        | 2026-06-24 | Orientation-Lock erst bei Calib-OK/Spielstart; Toggle-Button auf Startscreen |
| v2.2        | v17        | 2026-06-24 | devicemotion statt deviceorientation (kein Gimbal Lock); lockLandscape Fix |
| v2.3        | v18        | 2026-06-24 | Zwei Startbuttons: kalibriert vs. auto (Y-Achse aus screen.orientation.angle) |
| v2.4        | v19        | 2026-06-24 | lockLandscape: requestFullscreen() vor orientation.lock() (Browser-Tab Support) |
| v2.5        | v20        | 2026-06-24 | Auto-Calib: X-Achse statt Y (Y=links/rechts, X=lenkrad oben/unten) |
| v2.6        | v21        | 2026-06-24 | Kalibrierung: 600ms halten bevor Step 1 feuert (verhindert versehentliche Rückwärts-Capture) |
| v2.7        | v22        | 2026-06-24 | Rotation-Lock + Auto-Start Button versteckt (hidden); Startbutton wieder "Starten" |
| v2.8        | v23        | 2026-06-24 | Endlos-Modus: hochzählender Timer (MM:SS) im Spielbildschirm |
| v2.9        | v24        | 2026-06-24 | Kalibrierungscard: Overlay "✅ Kalibriert" wenn bereits kalibriert, Klick zum Aufdecken |
| v3.0        | v25        | 2026-08-09 | Offline-fähig: SW cache-first, Netz-Timeouts, Bild-Vorabdownload je Kategorie |
| v3.1        | v26        | 2026-08-10 | "Bilder für offline"-Knopf (alle Kategorien) + Speicheranzeige; Bildmodus offline gesperrt, solange nichts geladen ist; Bilder per CORS-fetch statt <img> (opaque-Padding); Abbruch erst nach 5 Fehlschlägen **in Folge** |
| v3.2        | v27        | 2026-08-10 | Speicheranzeige zählt den Media-Cache selbst statt `storage.estimate()` – nach "Leeren" stand dort weiter der alte Wert |
| v3.3        | v28        | 2026-08-10 | Startzeit: Startscreen ohne JS sichtbar, AudioContext erst beim ersten Ton, Speicherzählung und SW-Registrierung in die Leerlaufzeit, SW frischt je Datei nur einmal pro Lebensdauer auf; Startdauer am Versionslabel abzulesen |
| v3.4        | v29        | 2026-08-10 | SW-Registrierung wieder sofort (v3.3 hat damit die Installierbarkeit zerschossen); dauerhafter „Als App installieren"-Knopf mit Anleitung, wenn der Browser kein `beforeinstallprompt` schickt |
| v3.5        | v31        | 2026-08-10 | Startbildschirm neu aufgeteilt: kein Scrollen, Ränder ringsum, Sprachauswahl als Aufklappmenü rechts vom Titel, Maße an der Viewport-Höhe; SW frischt am HTTP-Cache vorbei auf |

## Offline – die Regeln, die dabei gelernt wurden

1. **Niemals network-first für die Shell.** Ohne Datenverbindung *hängt* `fetch()` auf dem Handy
   oft einfach, statt abzulehnen — der `catch()`-Zweig mit dem Cache-Fallback greift dann nie.
   Genau daran ist die App auf einem Fest gestorben. Shell wird cache-first ausgeliefert,
   das Netz aktualisiert nur im Hintergrund (stale-while-revalidate).
2. **`navigator.onLine` ist kein Beweis für Internet.** Der Wert ist `true`, sobald irgendein
   Netzwerk anliegt. Jeder Netzzugriff braucht zusätzlich ein eigenes Zeitlimit
   (`AbortController`, hier 5 s).
3. **`caches.match()` kann `undefined` liefern** — das an `respondWith()` weiterzureichen erzeugt
   einen harten Netzwerkfehler. Immer eine echte `Response` zurückgeben.
4. **`cache.addAll()` ist all-or-nothing:** eine einzige fehlende Datei verhindert die komplette
   Offline-Fähigkeit. Deshalb einzeln `add()` mit `catch`.
5. **Kein Reload mitten im Spiel.** Ein SW-Update darf erst auf dem Startscreen neu laden.
6. **Beim Entwickeln hinkt cache-first eine Runde hinterher.** Nach einer Änderung an
   `app.js`/`style.css` zeigt der erste Reload noch die alte Datei — die neue landet dabei nur im
   Hintergrund im Cache und greift erst beim zweiten Reload. Wer das nicht weiß, testet die
   Vorgängerversion und wundert sich. Verschärft wird das dadurch, dass jede Datei nur **einmal
   pro Worker-Lebensdauer** aufgefrischt wird: solange der Worker warm bleibt, hilft auch der
   dritte Reload nicht. Zuverlässig ist nur `VERSION` hochzählen (dann installiert der Worker neu
   mit `cache: 'reload'`) oder den Shell-Cache löschen.
   Zusätzlich frischt der Worker mit `cache: 'no-cache'` auf — ohne das holt er sich unter
   Umständen genau die veraltete Datei aus dem **HTTP-Cache des Browsers** zurück, die er
   ersetzen wollte.
7. **Wikipedia drosselt (HTTP 429).** Eine Anfrage pro Wort × drei parallele Worker reicht schon,
   um nach ein paar hundert Wörtern gedrosselt zu werden. Deshalb Sammelabfrage
   (`titles=A|B|C`, bis zu 25 Stück) statt Einzelabfragen, und 429 als "warte kurz" behandeln,
   nicht als Netzausfall — sonst hält die App sich fälschlich für offline.
8. **Bilder per `fetch()` mit CORS holen, nicht per `new Image()`.** Ein `<img>` erzeugt eine
   no-cors-Anfrage; solche "opaque" Antworten rechnet der Browser mit ~7 MB pro Stück auf das
   Speicherkontingent an. 48 Bilder wurden so als 308 MB verbucht statt als 11 MB.
   Nötig dazu: `cache.match(req, { ignoreVary: true })`, sonst findet das `<img>` den per
   `fetch()` abgelegten Eintrag wegen abweichender `Accept`-Header nicht wieder.
9. **`navigator.storage.estimate()` taugt nicht als Live-Anzeige.** Der Wert umfasst die ganze
   Herkunft und wird nach `caches.delete()` erst irgendwann nachgeführt — nach dem Leeren stand
   dort weiter der alte Wert, obwohl der Cache schon weg war. Für eine Anzeige, die auf eine
   Nutzeraktion hin stimmen muss, die Einträge selbst summieren
   (`Content-Length`, ersatzweise `blob().size`) und nur bei echten Änderungen neu zählen.

## Startzeit — was gilt

Der Startbildschirm steht im HTML **ohne** `hidden` da. Er muss sichtbar sein, sobald HTML und
CSS aus dem Cache kommen, ohne auf `app.js` zu warten. Wer hier wieder ein `hidden` einbaut und
erst per JS einblendet, macht den Start wieder von der Skriptausführung abhängig.

Nichts Blockierendes vor dem ersten Bild:
- **kein `new AudioContext()` auf Modulebene** — der Konstruktor fährt die Audio-Hardware hoch
  und blockiert in einer synchronen `<script>`-Datei den Aufbau. Erst beim ersten Ton bauen.
- **keine Cache-Durchläufe im Startpfad** (Speicherzählung) — `requestIdleCallback`.
**Ausnahme, teuer gelernt:** `serviceWorker.register()` gehört **nicht** in den Leerlauf. Chrome
prüft kurz nach dem Laden, ob die Seite installierbar ist, und dazu muss der Worker registriert
sein. In v3.3 stand dort ein `requestIdleCallback` — Folge: `beforeinstallprompt` feuerte nicht
mehr und die App ließ sich nicht mehr installieren. Der Zeitgewinn war ohnehin eingebildet,
`register()` arbeitet asynchron.

## Startbildschirm: kein Scrollen, alles muss passen

Das Spiel läuft im Querformat, oft mit sichtbarer Browserleiste — dort bleiben teils nur ~320 px
Höhe. Regeln, damit nichts unter der Kante verschwindet:

- **Nicht scrollen.** Kein `overflow-y: auto` auf den Spalten. Was nicht passt, muss kleiner
  werden, nicht wegrutschen.
- **Blöcke verteilen sich mit `space-between`** über die volle Höhe. Zusammengehöriges (Label +
  Knopfreihe) steckt in einem `.start-block`, sonst reißt es auseinander.
- **Maße hängen an der Viewport-Höhe**, nicht an der Breite: `clamp(…, Xvh, …)` für Schriftgrößen,
  Innenabstände und Lücken. Im Querformat ist die Höhe die knappe Größe, nicht die Breite.
- **Ränder gehören ans Raster** (`.start-inner { padding }`), nicht an einzelne Elemente. Nichts
  wird `position: fixed` an den Bildschirmrand geklebt — das Versionslabel hing so ohne Abstand
  in der Ecke und überlagerte den Inhalt.
- Unter 430 px Höhe greift eine Media Query, die zusätzlich Beiwerk kürzt (Untertitel im
  Kalibrier-Kasten raus, engere Knöpfe).

Nach jeder Layout-Änderung gegenprüfen: bei 740×280, 915×320 und 915×412 darf
`scrollHeight - clientHeight` beider Spalten **0** sein und kein Element außerhalb des Viewports
liegen.

## Installation muss ohne `beforeinstallprompt` funktionieren

Der Knopf „Als App installieren" auf dem Startbildschirm ist immer da, solange die App im Browser
läuft (`isStandalone()` prüft `display-mode: standalone` **und** `fullscreen` — das Manifest sagt
`fullscreen`, `standalone` allein ist dort also falsch). Schickt der Browser ein
`beforeinstallprompt`, löst der Knopf es aus; sonst zeigt er die Anleitung für Chrome bzw. Safari.
Grund: Chrome unterdrückt das Ereignis unter anderem eine Weile nach einer Deinstallation — dann
gab es vorher überhaupt keinen Weg mehr zurück auf den Home-Bildschirm.

Gemessen wird nicht geschätzt: das Versionslabel zeigt die Startdauer (`v3.3 · 14 ms`). Steht dort
eine kleine Zahl, der Start fühlt sich aber trotzdem lang an, liegt es **vor** unserem Code
(Browser-Kaltstart, Service-Worker-Start, PWA-Splash) — dann bringt Optimieren an der App nichts.

## Projekt-Übersicht

- **Repo:** https://github.com/danielzaiser91/ratespiel-wer-bin-ich
- **Live:** https://danielzaiser91.github.io/ratespiel-wer-bin-ich/
- **Stack:** Vanilla HTML/CSS/JS, PWA, GitHub Pages
- **Sprachen:** DE + EN (i18n via `i18n.js`)
- **Bilder:** Wikimedia Commons API (live, network-first)
- **Tilt:** DeviceOrientationEvent, kalibrierbar, invertierbar, gespeichert in localStorage
