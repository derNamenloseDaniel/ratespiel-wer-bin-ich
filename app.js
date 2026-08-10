// ── State ──────────────────────────────────────────────────────────────────
const S = {
  lang: 'de',
  roundMode: 'infinite', // 'infinite' | 'time' | 'cards'
  roundValue: 0,      // seconds or card count (0 = infinite)
  category: null,
  deck: [],
  index: 0,
  correct: 0,
  wrong: 0,
  startTime: 0,
  timer: null,
  timeLeft: 0,
  advancing: false,
  currentImage: null,
};

window.LANG = 'de';

// ── Audio ──────────────────────────────────────────────────────────────────
// Der AudioContext wird erst beim ersten Ton gebaut, nicht beim Laden. Sein
// Konstruktor fährt die Audio-Hardware hoch und blockiert dabei auf dem Handy
// spürbar – am Anfang einer synchronen <script>-Datei heißt das: der Nutzer
// sieht so lange gar nichts. Nebeneffekt: auf iOS ist ein nach einer
// Nutzergeste erzeugter Context ohnehin der einzige, der klingen darf.
let AC = null;
function audio() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  return AC;
}

function beep(freq, duration, type = 'sine', gain = 0.3) {
  const ac = audio();
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.connect(g); g.connect(ac.destination);
  osc.frequency.value = freq;
  osc.type = type;
  g.gain.setValueAtTime(gain, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.start(); osc.stop(ac.currentTime + duration);
}

function soundCorrect() { beep(880, 0.15); setTimeout(() => beep(1320, 0.2), 100); }
function soundWrong()   { beep(200, 0.3, 'sawtooth', 0.2); }

// ── Netz ───────────────────────────────────────────────────────────────────
// Jeder Netzzugriff bekommt ein hartes Zeitlimit. Ohne das hängt die App bei
// Empfang-ohne-Daten (Fest, überlastete Zelle) minutenlang statt sofort in den
// Offline-Weg zu fallen – fetch() lehnt dort nicht ab, es antwortet nur nie.
const NET_TIMEOUT = 5000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Zusätzlich 429-fest: Wikipedia drosselt, wenn man zu schnell fragt. Ein 429
// ist kein Netzausfall, sondern eine Bitte zu warten – wer ihn als Fehler
// zählt, hält fälschlich das ganze Gerät für offline.
async function fetchTimed(url, ms = NET_TIMEOUT, retries = 2) {
  for (let i = 0; ; i++) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms);
    let r;
    try { r = await fetch(url, { signal: ctl.signal }); }
    finally { clearTimeout(to); }
    if (r.status !== 429 || i >= retries) return r;
    const wait = Number(r.headers.get('Retry-After')) * 1000 || 1000 * (i + 1);
    await sleep(Math.min(wait, 5000));
  }
}

// Holt die Bild-Bytes in den Cache. Bewusst per fetch() mit CORS statt über ein
// <img>: ein <img> stellt eine no-cors-Anfrage, die Antwort ist "opaque" – und
// opaque Antworten rechnet der Browser aus Datenschutzgründen mit rund 7 MB pro
// Stück auf das Speicherkontingent an, egal wie klein das Bild wirklich ist.
// 500 Bilder wären so über 3 GB "belegt" und der Cache flöge raus.
// upload.wikimedia.org erlaubt CORS, also kostet uns das nichts.
async function warmImage(url, ms = 15000) {
  try { const r = await fetchTimed(url, ms); return r.ok; }
  catch { return false; }
}

// Lädt ein Bild wirklich (nicht nur die URL). false = offline / nicht im Cache.
function loadImage(src, ms = NET_TIMEOUT) {
  return new Promise(resolve => {
    const im = new Image();
    let done = false;
    const finish = ok => { if (done) return; done = true; clearTimeout(to); resolve(ok); };
    const to = setTimeout(() => { im.src = ''; finish(false); }, ms);
    im.onload  = () => finish(true);
    im.onerror = () => finish(false);
    im.src = src;
  });
}

// ── Bild-Gedächtnis ────────────────────────────────────────────────────────
// Wort → Bild-URL (oder '' für "es gibt keins"). Liegt im localStorage, damit
// offline gar keine API-Anfrage mehr nötig ist: die URL steht fest, die Bytes
// liegen im Media-Cache des Service Workers.
// v2: Schluessel hochgezaehlt, weil die alten Eintraege noch die per
// Ortsnamen falsch aufgeloesten Bilder enthalten (Wappen statt Motiv).
const IMG_MEMO_KEY = 'img_memo_v2';
const CAT_READY_KEY = 'cat_offline_v2';
for (const alt of ['img_memo_v1', 'cat_offline_v1']) {
  try { localStorage.removeItem(alt); } catch {}
}

let IMG_MEMO = {};
try { IMG_MEMO = JSON.parse(localStorage.getItem(IMG_MEMO_KEY) || '{}'); } catch { IMG_MEMO = {}; }

let _memoTimer = null;
function memoSet(key, val) {
  IMG_MEMO[key] = val;
  clearTimeout(_memoTimer);
  _memoTimer = setTimeout(() => {
    try { localStorage.setItem(IMG_MEMO_KEY, JSON.stringify(IMG_MEMO)); } catch {}
  }, 400);
}

function catReadyMap() {
  try { return JSON.parse(localStorage.getItem(CAT_READY_KEY) || '{}'); } catch { return {}; }
}
function catReadySet(id, lang, count) {
  const m = catReadyMap();
  m[`${lang}|${id}`] = count;
  try { localStorage.setItem(CAT_READY_KEY, JSON.stringify(m)); } catch {}
}
function catReadyGet(id, lang) { return catReadyMap()[`${lang}|${id}`] || 0; }

// ── Wikimedia ──────────────────────────────────────────────────────────────
//
// Alltagswörter sind auf Wikipedia mehrdeutig, und die Volltextsuche entscheidet
// die Mehrdeutigkeit fast immer zugunsten von Ortsnamen: "singen" landete bei
// Singen (Hohentwiel) und zeigte dessen Wappen, "laufen" bei Laufen an der
// Salzach. Deutsche Städte haben Artikel mit Wappen, und die ranken hoch.
//
// Zwei Filter fangen genau diese Fehltreffer ab:
//   geo    – die Seite hat Koordinaten, ist also ein Ort. Außer in den
//            Ortskategorien ist das immer die falsche Bedeutung.
//   vector – das Bild ist eine SVG-Grafik, also Wappen, Flagge, Logo oder
//            Karte statt Foto. Erwünscht nur bei Ländern (Flaggen) und
//            Marken (Logos).
// Beide Angaben kommen aus derselben Anfrage, kosten also nichts extra. Und
// verworfen zu werden ist billig: seit v4.0 steht auf jeder Karte ohnehin das
// Wort, ein fehlendes Bild fällt also kaum auf – ein falsches sehr wohl.
function imgPolicy(catId) {
  const cat = CATEGORIES.find(c => c.id === catId);
  return { geo: !!cat?.geo, vector: !!cat?.vector };
}

function pickThumb(page, pol) {
  if (!page) return null;
  if (!pol.geo && page.coordinates) return null;
  const src = page.thumbnail?.source;
  if (!src) return null;
  if (!pol.vector && /\.svg(\.|$)/i.test(src)) return null;
  return src;
}

async function fetchWikiImageByTitle(title, lang, pol) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}`
            + `&prop=pageimages%7Ccoordinates&format=json&pithumbsize=600&redirects=1&origin=*`;
  const r = await fetchTimed(url);
  const j = await r.json();
  const pages = j.query?.pages;
  return pickThumb(pages ? Object.values(pages)[0] : null, pol);
}

// Eine Anfrage für bis zu 25 Begriffe statt 25 Anfragen. Ohne das läuft der
// Vorabdownload nach ein paar hundert Wörtern in Wikipedias Rate-Limit.
async function wikiThumbsBatch(titles, lang, pol) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*`
            + `&prop=pageimages%7Ccoordinates&pithumbsize=600&redirects=1&titles=`
            + titles.map(encodeURIComponent).join('%7C');
  const r = await fetchTimed(url, 15000);
  const j = await r.json();
  const q = j.query || {};

  // Wikipedia normalisiert Titel und folgt Weiterleitungen. Der Rückweg vom
  // gelieferten Seitentitel zum angefragten Begriff muss nachgebaut werden.
  const current = new Map(titles.map(t => [t, t]));
  for (const step of [q.normalized, q.redirects]) {
    if (!step) continue;
    const m = new Map(step.map(s => [s.from, s.to]));
    for (const [orig, cur] of current) if (m.has(cur)) current.set(orig, m.get(cur));
  }

  const thumbs = new Map();
  for (const p of Object.values(q.pages || {})) {
    const src = pickThumb(p, pol);
    if (src) thumbs.set(p.title, src);
  }

  const out = new Map();
  for (const [orig, cur] of current) out.set(orig, thumbs.get(cur) || null);
  return out;
}

// Wirft bei Netzproblemen, gibt null zurück wenn die API geantwortet hat,
// es aber kein brauchbares Bild gibt.
async function lookupWikiImage(term, pol, skipDirect = false) {
  const lang = S.lang === 'de' ? 'de' : 'en';
  const direct = skipDirect ? null : await fetchWikiImageByTitle(term, lang, pol);
  if (direct) return direct;

  // Die Suche liefert mehrere Treffer. Statt Titel für Titel einzeln zu fragen,
  // holen wir sie in einem Rutsch und nehmen den ersten, der die Filter
  // übersteht — spart Anfragen und findet den passenden Artikel auch dann,
  // wenn ein Ortsname davor liegt.
  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search`
                  + `&srsearch=${encodeURIComponent(term)}&srlimit=4&format=json&origin=*`;
  const sj = await (await fetchTimed(searchUrl)).json();
  const hits = (sj.query?.search || []).map(h => h.title);
  if (!hits.length) return null;

  const found = await wikiThumbsBatch(hits, lang, pol);
  for (const titel of hits) {
    const url = found.get(titel);
    if (url) return url;
  }
  return null;
}

// → { url: string|null, offline: bool }
async function resolveImage(term, pol, skipDirect = false) {
  const key = `${S.lang}|${pol.geo ? 'g' : ''}${pol.vector ? 'v' : ''}|${term}`;
  if (key in IMG_MEMO) return { url: IMG_MEMO[key] || null, offline: false };
  if (!navigator.onLine) return { url: null, offline: true };
  try {
    const url = await lookupWikiImage(term, pol, skipDirect);
    memoSet(key, url || '');
    noteNetSuccess();
    return { url, offline: false };
  } catch {
    noteNetFailure();
    return { url: null, offline: true };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $(id).classList.remove('hidden');
const hide = id => $(id).classList.add('hidden');
const hideAll = () => ['screen-start','screen-category','screen-game','screen-summary'].forEach(hide);

function setLang(l) { S.lang = l; window.LANG = l; renderAll(); renderOfflineStatus(); }

// ── Offline-Status ─────────────────────────────────────────────────────────
let _netDown = false;

function setOffline(off) {
  _netDown = off;
  $('offline-badge')?.classList.toggle('hidden', !off);
  renderOfflineStatus();
}

function isOffline() { return _netDown || !navigator.onLine; }

// Ein einzelner fehlgeschlagener Request heißt noch nicht "kein Internet" –
// Wikipedia hat gelegentlich Aussetzer. Erst eine Serie zählt als offline,
// jeder Erfolg setzt den Zähler zurück.
let _failStreak = 0;
function noteNetFailure() { if (++_failStreak >= 3) setOffline(true); }
function noteNetSuccess() { _failStreak = 0; if (_netDown && navigator.onLine) setOffline(false); }

function renderOfflineStatus() {
  const el = $('offline-status');
  if (!el) return;
  const installed = !!navigator.serviceWorker?.controller;
  const key = isOffline() ? 'offlineNow' : installed ? 'offlineReady' : 'offlinePrep';
  el.textContent = t(key);
  el.className = 'offline-status ' + (isOffline() ? 'off' : installed ? 'ok' : 'wait');
  // Herunterladen geht nur mit Netz; das Wort läuft ohnehin immer.
  const dl = $('btn-dl-all');
  if (dl) dl.classList.toggle('hidden', isOffline());
  renderStorageLine();
}

// ── Speicheranzeige ────────────────────────────────────────────────────────
// Bewusst NICHT über navigator.storage.estimate(): dessen Zahl umfasst die
// ganze Herkunft und wird nach caches.delete() erst irgendwann nachgeführt –
// nach dem Leeren stand dort weiter der alte Wert. Der Cache selbst weiß es
// sofort und genau, also zählen wir dort.
const MEDIA_CACHE = 'ratespiel-media';
let _mediaBytes = 0;

async function mediaCacheSize() {
  if (!('caches' in window) || !(await caches.has(MEDIA_CACHE))) return 0;
  const c = await caches.open(MEDIA_CACHE);
  const keys = await c.keys();
  const sizes = await Promise.all(keys.map(async k => {
    const r = await c.match(k, { ignoreVary: true });
    // Nur der Header, bewusst kein Rückgriff auf blob(): das würde jedes Bild
    // aus dem Speicher lesen – bei 500 Bildern zig MB, nur um eine Zahl
    // anzuzeigen. Content-Length ist auch bei CORS-Antworten lesbar.
    return r ? Number(r.headers.get('content-length')) || 0 : 0;
  }));
  return sizes.reduce((a, b) => a + b, 0);
}

// Läuft über alle Cache-Einträge, gehört also nie in den Startpfad.
function refreshStorageWhenIdle() {
  const run = () => refreshStorage();
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1200);
}

// Die Größe zu zählen kostet einen Durchlauf über alle Einträge – deshalb nur
// dann, wenn sich wirklich etwas geändert hat, nicht bei jedem Neuzeichnen.
async function refreshStorage() {
  _mediaBytes = await mediaCacheSize();
  renderStorageLine();
}

function renderStorageLine() {
  const line = $('storage-line');
  if (!line) return;
  if (!_mediaBytes) {
    line.classList.add('hidden');
    $('storage-size').textContent = '';   // kein alter Wert, der beim nächsten Einblenden aufblitzt
    return;
  }
  const mb = _mediaBytes / 1048576;
  line.classList.remove('hidden');
  $('storage-size').textContent = `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB ${t('storageUsed')}`;
}

async function clearOfflineImages() {
  if (!confirm(t('clearConfirm'))) return;
  await caches.delete(MEDIA_CACHE);
  IMG_MEMO = {};
  clearTimeout(_memoTimer);          // sonst schreibt der Nachzügler alles zurück
  try {
    localStorage.removeItem(IMG_MEMO_KEY);
    localStorage.removeItem(CAT_READY_KEY);
  } catch {}
  const dl = $('btn-dl-all');
  if (dl) { dl.textContent = t('dlAll'); dl.disabled = false; dl.dataset.busy = ''; }
  await refreshStorage();
  renderOfflineStatus();
}

window.addEventListener('offline', () => setOffline(true));
window.addEventListener('online',  () => setOffline(false));

function renderAll() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── Screen: Start ──────────────────────────────────────────────────────────
function showStart() {
  stopTimer();
  hideAll();
  show('screen-start');
  renderAll();
  renderRoundOptions();
  renderOfflineStatus();
  unlockLandscape();
  applyPendingReload();
}

function renderRoundOptions() {
  const mode = S.roundMode;
  document.querySelectorAll('.round-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.rmode === mode);
  });
  hide('time-options'); hide('cards-options');
  if (mode === 'time') show('time-options');
  if (mode === 'cards') show('cards-options');
}

// ── Screen: Category ──────────────────────────────────────────────────────
function showCategory() {
  hideAll();
  show('screen-category');
  renderAll();
  // Jede Kategorie ist immer spielbar — ohne Bilder eben nur mit Wörtern.
  $('cat-hint').classList.toggle('hidden', isOffline());

  const grid = $('cat-grid');
  grid.innerHTML = '';
  CATEGORIES.forEach(cat => {
    if (cat.onlyDE && S.lang === 'en') return;

    const cell = document.createElement('div');
    cell.className = 'cat-cell';
    const have = catReadyGet(cat.id, S.lang);

    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.textContent = t(`cats.${cat.id}`);
    btn.onclick = () => { S.category = cat.id; startGame(); };
    cell.appendChild(btn);

    // Bilder je Kategorie vorab holen, damit sie später auch ohne Netz da
    // sind. Der Service Worker behält sie dauerhaft.
    const dl = document.createElement('button');
    dl.className = 'cat-dl';
    dl.textContent = have > 0 ? `✅ ${have}` : '⬇';
    dl.title = t('prefetchHint');
    dl.disabled = isOffline();
    dl.onclick = ev => { ev.stopPropagation(); prefetchCategory(cat, dl); };
    cell.appendChild(dl);

    grid.appendChild(cell);
  });
}

// Holt Bilder ins Offline-Depot. Bricht ab, sobald das Netz mehrfach nicht
// antwortet – sonst läuft man in lauter 5-Sekunden-Timeouts.
// onProgress bekommt einen Bruchteil 0..1. Die Bild-Bytes sind der langsame
// Teil, also bekommt der auch den größten Teil des Balkens.
async function prefetchWords(words, suffix, onProgress, pol) {
  const lang  = S.lang === 'de' ? 'de' : 'en';
  const terms = [...new Set(words.map(w => w + suffix))];
  const total = terms.length;
  const key   = term => `${S.lang}|${term}`;
  let ok = 0, failed = 0, streak = 0, aborted = false;

  const note = bad => {
    if (bad) { failed++; return ++streak; }
    streak = 0; return 0;
  };

  // Phase 1 (0–20 %): Sammelabfrage, 25 Begriffe pro Anfrage.
  const unknown = terms.filter(t => !(key(t) in IMG_MEMO));
  const missedDirect = new Set();
  for (let i = 0; i < unknown.length && !aborted; i += 25) {
    const chunk = unknown.slice(i, i + 25);
    try {
      const found = await wikiThumbsBatch(chunk, lang, pol);
      for (const term of chunk) {
        const url = found.get(term);
        if (url) memoSet(key(term), url); else missedDirect.add(term);
      }
      noteNetSuccess(); note(false);
    } catch {
      noteNetFailure();
      if (note(true) >= 3) aborted = true;
    }
    onProgress?.((i + chunk.length) / unknown.length * 0.2);
  }

  // Phase 2 (20–40 %): Was die Sammelabfrage nicht kannte, einzeln über die
  // Volltextsuche – nacheinander, damit das Limit nicht doch noch reißt.
  const rest = aborted ? [] : [...missedDirect];
  for (let i = 0; i < rest.length && !aborted; i++) {
    const res = await resolveImage(rest[i], pol, true);  // Direktabfrage war schon erfolglos
    if (note(res.offline) >= 5) aborted = true;
    onProgress?.(0.2 + (i + 1) / rest.length * 0.2);
  }

  // Phase 3 (40–100 %): die Bilder selbst. Die kommen vom CDN, nicht von der
  // API – der verträgt Parallelität ohne Drosselung.
  const urls = terms.map(t => IMG_MEMO[key(t)]).filter(Boolean);
  const queue = urls.slice();
  let done = 0;
  const worker = async () => {
    while (queue.length && !aborted) {
      const u = queue.shift();
      if (await warmImage(u)) { ok++; note(false); }
      else if (note(true) >= 8) aborted = true;
      onProgress?.(0.4 + (++done) / urls.length * 0.6);
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  return { ok, failed, aborted, total };
}

async function prefetchCategory(cat, btn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';

  const words = getWords(cat.id, S.lang);
  const r = await prefetchWords(
    words,
    cat.imageSearchSuffix?.[S.lang] || '',
    frac => { btn.textContent = `${Math.round(frac * 100)} %`; },
    imgPolicy(cat.id)
  );

  catReadySet(cat.id, S.lang, r.ok);
  btn.dataset.busy = '';
  btn.textContent = r.aborted ? `⚠ ${r.ok}` : `✅ ${r.ok}`;
  await refreshStorage();
  renderOfflineStatus();
  return r;
}

// Alle Kategorien am Stück – der Knopf auf dem Startbildschirm.
async function prefetchAll(btn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.disabled = true;

  const cats = CATEGORIES.filter(c => !(c.onlyDE && S.lang === 'en'));
  const grand = cats.reduce((n, c) => n + getWords(c.id, S.lang).length, 0);
  let before = 0, ok = 0, aborted = false;

  for (const cat of cats) {
    const words = getWords(cat.id, S.lang);
    const r = await prefetchWords(
      words,
      cat.imageSearchSuffix?.[S.lang] || '',
      frac => { btn.textContent = `${Math.round((before + frac * words.length) / grand * 100)} %`; },
      imgPolicy(cat.id)
    );
    catReadySet(cat.id, S.lang, r.ok);
    before += r.total;
    ok += r.ok;
    await refreshStorage();
    if (r.aborted) { aborted = true; break; }
  }

  btn.dataset.busy = '';
  btn.disabled = false;
  btn.textContent = aborted ? `⚠ ${ok}` : t('dlAllDone');
  renderOfflineStatus();
}

// ── Screen: Game ──────────────────────────────────────────────────────────
async function startGame() {
  lockLandscape();
  S.deck = shuffle(getWords(S.category, S.lang));
  S.index = 0; S.correct = 0; S.wrong = 0;
  S.startTime = Date.now();
  S.advancing = false;
  hideAll(); show('screen-game');
  hide('timer-display');
  renderAll();
  updateProgress();
  if (S.roundMode === 'time') startTimer();
  else if (S.roundMode === 'infinite') startElapsedTimer();
  await showCard();
  startTilt();
}

function searchTermFor(word) {
  const cat = CATEGORIES.find(c => c.id === S.category);
  return word + (cat?.imageSearchSuffix?.[S.lang] || '');
}

// Immer beides: das Wort steht sofort da, das Bild kommt dazu, sobald es da
// ist. Keine Modus-Auswahl mehr — ohne Netz und ohne vorgeladenes Bild bleibt
// einfach das Wort, und die Karte wird nie übersprungen.
async function showCard() {
  if (S.index >= S.deck.length) { endGame(); return; }
  const word = S.deck[S.index];
  const shownFor = S.index;

  const area = document.querySelector('.card-area');
  $('card-image').src = '';
  $('card-image').classList.add('hidden');
  area.classList.remove('has-image');
  $('card-word').textContent = word;      // sofort lesbar, ohne aufs Netz zu warten
  updateProgress();

  const res = await resolveImage(searchTermFor(word), imgPolicy(S.category));
  if (S.index !== shownFor) return;       // Karte ist inzwischen weiter
  if (!res.url) { if (res.offline) setOffline(true); return; }

  const ok = await loadImage(res.url);
  if (S.index !== shownFor) return;
  if (!ok) { setOffline(true); return; }

  $('card-image').src = res.url;
  $('card-image').classList.remove('hidden');
  area.classList.add('has-image');

  // Nächste Karte im Hintergrund vorbereiten
  const next = S.deck[S.index + 1];
  if (next && navigator.onLine) resolveImage(searchTermFor(next), imgPolicy(S.category));
}

function updateProgress() {
  const total = S.roundMode === 'cards' ? S.roundValue : S.deck.length;
  $('progress-text').textContent = S.roundMode === 'cards'
    ? `${S.index} / ${total}`
    : S.index > 0 ? `${S.index}` : '';
  $('score-text').textContent = S.correct;
}

function triggerCorrect() {
  if (S.advancing) return;
  S.advancing = true;
  S.correct++;
  navigator.vibrate?.(100);
  try { soundCorrect(); } catch(e) {}
  flashOverlay('flash-correct');
  advance();
}

function triggerWrong() {
  if (S.advancing) return;
  S.advancing = true;
  S.wrong++;
  navigator.vibrate?.([80, 40, 80]);
  try { soundWrong(); } catch(e) {}
  flashOverlay('flash-wrong');
  advance();
}

function flashOverlay(id) {
  const el = $(id);
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 600);
}

async function advance() {
  S.index++;
  if (S.roundMode === 'cards' && S.index >= S.roundValue) { endGame(); return; }
  if (S.index >= S.deck.length) { endGame(); return; }
  await showCard();
  S.advancing = false;
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer() {
  S.timeLeft = S.roundValue;
  $('timer-display').textContent = formatTime(S.timeLeft);
  show('timer-display');
  S.timer = setInterval(() => {
    S.timeLeft--;
    $('timer-display').textContent = formatTime(S.timeLeft);
    if (S.timeLeft <= 0) endGame();
  }, 1000);
}

function startElapsedTimer() {
  show('timer-display');
  S.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - S.startTime) / 1000);
    $('timer-display').textContent = formatTime(elapsed);
  }, 1000);
}

function stopTimer() {
  clearInterval(S.timer);
  S.timer = null;
}

// ── End Game ──────────────────────────────────────────────────────────────
function endGame() {
  stopTimer();
  stopTilt();
  const elapsed = Math.floor((Date.now() - S.startTime) / 1000);
  hideAll(); show('screen-summary');
  renderAll();
  $('sum-time').textContent = formatTime(elapsed);
  $('sum-correct').textContent = S.correct;
  $('sum-wrong').textContent = S.wrong;
  $('sum-score').textContent = S.correct;
}

// ── Kipperkennung ──────────────────────────────────────────────────────────
//
// Gemessen wird EIN Winkel: wie weit die Bildschirmebene aus der Senkrechten
// gekippt ist.
//
//   pitch = asin(gz / |g|)     0° = senkrecht (Spielhaltung), ±90° = flach
//
// Die Z-Achse des Geräts steht senkrecht auf dem Bildschirm. Ihr Anteil an der
// Schwerkraft hängt deshalb NUR davon ab, wie weit nach vorne oder hinten
// gekippt wurde. Dreht man das Handy in seiner eigenen Ebene (wie ein Lenkrad)
// oder dreht den Kopf zur Seite, bleibt gz unverändert.
//
// Genau daran ist die alte Fassung gescheitert: sie projizierte die Differenz
// zweier Schwerkraftvektoren auf eine gespeicherte Richtung. Zwei Drehungen
// kombiniert (vorne + ein bisschen seitlich) verkürzen diese Projektion, und
// ab etwa 20° Seitwärtsneigung reichte sie nicht mehr über die Schwelle —
// obwohl nach vorne genauso weit gekippt wurde wie vorher.
//
// Dazu die drei Bausteine, die bei Neigungserkennung üblich sind:
//   1. Tiefpass auf den Schwerkraftvektor (~1,3 Hz), damit Handzittern und
//      Beschleunigung beim Bewegen nicht als Kippen durchgehen.
//   2. Schmitt-Trigger: auslösen bei 30°, erst wieder scharf unter 12°.
//      Ersetzt die alte 1,2-Sekunden-Sperre — schnelles Spielen bleibt möglich,
//      ein einzelnes Kippen kann trotzdem nicht doppelt zählen.
//   3. Haltezeit von 150 ms und Verwerfen von Proben, bei denen der Betrag der
//      Beschleunigung deutlich von 1 g abweicht (= das Handy wird geschüttelt).

const TILT = {
  trigger: 30,     // Grad – ab hier zählt es als Kippen
  release: 12,     // Grad – so weit zurück, bevor das nächste Kippen zählt
  dwellMs: 150,    // so lange muss der Winkel gehalten werden
  tau: 0.12,       // Zeitkonstante des Tiefpasses in Sekunden (~1,3 Hz)
  maxShake: 3.5,   // m/s² Abweichung von 1 g – darüber gilt die Probe als Wackler
  baseMs: 700,     // Ruhephase am Rundenstart, um die Haltung einzumessen
  baseSpread: 6,   // Grad – so ruhig muss es dabei sein
  driftTau: 2.5,   // Sekunden – so träge folgt die Ruhelage der Haltung
  driftBand: 22,   // Grad – bis hierhin gilt "wird gehalten, nicht gekippt"
};

const RAD = 180 / Math.PI;

const _tilt = {
  source: null,     // 'gravity' (Sensor-API) | 'motion' (devicemotion)
  sensor: null,
  onMotion: null,
  g: null,          // gefilterter Schwerkraftvektor
  lastT: 0,
  neutral: 0,       // Ruhewinkel in Grad
  sign: -1,         // welche Richtung ist "vorne"
  armed: false,
  since: 0,
  baseline: null,   // Sammelphase am Rundenstart
  onAngle: null,    // Rückmeldung für Kalibrierung und Debug-Anzeige
};

function tiltPitch(g) {
  const m = Math.hypot(g.x, g.y, g.z);
  if (m < 1) return null;
  return Math.asin(Math.max(-1, Math.min(1, g.z / m))) * RAD;
}

// Nimmt eine rohe Schwerkraftprobe an und gibt Winkel + Ruhe-Flag zurück.
function tiltFeed(x, y, z, alreadyFiltered) {
  const raw = { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
  const now = performance.now();

  if (alreadyFiltered) {
    _tilt.g = raw;                       // Sensor-API liefert bereits Schwerkraft
  } else {
    const dt = _tilt.g ? Math.min(0.25, (now - _tilt.lastT) / 1000) : null;
    const k = dt === null ? 1 : dt / (TILT.tau + dt);
    _tilt.g = _tilt.g
      ? { x: _tilt.g.x + k * (raw.x - _tilt.g.x),
          y: _tilt.g.y + k * (raw.y - _tilt.g.y),
          z: _tilt.g.z + k * (raw.z - _tilt.g.z) }
      : raw;
  }
  _tilt.lastT = now;

  const pitch = tiltPitch(_tilt.g);
  if (pitch === null) return null;
  const steady = Math.abs(Math.hypot(raw.x, raw.y, raw.z) - 9.81) <= TILT.maxShake;
  return { pitch, steady, now };
}

// Eine Quelle abonnieren. GravitySensor kommt aus der Generic-Sensor-API und
// liefert die vom Betriebssystem aus Beschleunigung UND Gyroskop verrechnete
// Schwerkraft – deutlich ruhiger als alles, was sich im JavaScript filtern
// lässt. Gibt es sie nicht (Safari/iOS), bleibt devicemotion mit eigenem
// Tiefpass.
function tiltSubscribe(onSample) {
  try {
    if ('GravitySensor' in window) {
      const s = new GravitySensor({ frequency: 50 });
      s.addEventListener('reading', () => onSample(s.x, s.y, s.z, true));
      s.addEventListener('error', () => { tiltUnsubscribe(); tiltMotionFallback(onSample); });
      s.start();
      _tilt.sensor = s;
      _tilt.source = 'gravity';
      return;
    }
  } catch { /* nicht verfügbar oder verboten – unten weiter */ }
  tiltMotionFallback(onSample);
}

function tiltMotionFallback(onSample) {
  _tilt.onMotion = e => {
    const a = e.accelerationIncludingGravity;
    if (a) onSample(a.x, a.y, a.z, false);
  };
  window.addEventListener('devicemotion', _tilt.onMotion);
  _tilt.source = 'motion';
}

function tiltUnsubscribe() {
  if (_tilt.sensor) { try { _tilt.sensor.stop(); } catch {} _tilt.sensor = null; }
  if (_tilt.onMotion) { window.removeEventListener('devicemotion', _tilt.onMotion); _tilt.onMotion = null; }
  _tilt.source = null;
}

function startTilt() {
  stopTilt();
  _tilt.g = null;
  _tilt.armed = false;
  _tilt.since = 0;
  loadCalib();
  // Ohne von Hand gesetzten Nullpunkt misst die Runde ihn selbst ein. Mit
  // gesetztem Nullpunkt bleibt der stehen — sonst wäre der Knopf wirkungslos.
  _tilt.baseline = _tilt.manual ? null : { until: performance.now() + TILT.baseMs, vals: [] };
  _tilt.armed = !_tilt.baseline;

  tiltSubscribe((x, y, z, filtered) => {
    const s = tiltFeed(x, y, z, filtered);
    if (!s) return;
    _tilt.onAngle?.(s);

    // Rundenstart: kurz zuhören, wie das Handy gehalten wird. Nur übernehmen,
    // wenn es dabei ruhig lag – sonst bleibt der kalibrierte Wert stehen.
    if (_tilt.baseline) {
      _tilt.baseline.vals.push(s.pitch);
      if (s.now < _tilt.baseline.until) return;
      const v = _tilt.baseline.vals;
      const spread = Math.max(...v) - Math.min(...v);
      if (spread <= TILT.baseSpread) _tilt.neutral = v.reduce((a, b) => a + b, 0) / v.length;
      _tilt.baseline = null;
      _tilt.armed = true;
      return;
    }

    if (S.advancing) return;
    const rel = (s.pitch - _tilt.neutral) * _tilt.sign;

    const abs = Math.abs(rel);

    // Ruhelage langsam nachführen, solange nicht deutlich gekippt wird. Damit
    // macht sich die Erkennung selbst passend zu der Haltung des Spielers —
    // eine Kalibrierung von Hand wird überflüssig.
    //
    // Das Band ist bewusst breiter als die Rückkehrschwelle: wer das Handy
    // dauerhaft ein Stück schräg hält, säße sonst in einem toten Bereich fest,
    // in dem weder ausgelöst noch nachgeführt wird — und hätte dann in die eine
    // Richtung zu wenig Weg bis zur Schwelle und in die andere zu viel. Genau
    // diese Schieflage ist im Test als letzter Fehlerfall aufgefallen.
    // Eine echte Geste kann das Band nicht aufsaugen: die dauert Bruchteile
    // einer Sekunde, die Nachführung braucht Sekunden.
    if (abs < TILT.driftBand && s.steady) {
      const dt = Math.min(0.25, Math.max(0, (s.now - (_tilt.driftT || s.now)) / 1000));
      _tilt.neutral += (s.pitch - _tilt.neutral) * (dt / (TILT.driftTau + dt));
    }
    _tilt.driftT = s.now;

    if (abs < TILT.release) { _tilt.armed = true; _tilt.since = 0; return; }
    if (!_tilt.armed || !s.steady) { _tilt.since = 0; return; }
    if (abs < TILT.trigger) { _tilt.since = 0; return; }

    if (!_tilt.since) { _tilt.since = s.now; return; }
    if (s.now - _tilt.since < TILT.dwellMs) return;

    _tilt.armed = false;
    _tilt.since = 0;
    if (rel > 0) triggerCorrect(); else triggerWrong();
  });
}

function stopTilt() {
  tiltUnsubscribe();
  _tilt.onAngle = null;
  _tilt.baseline = null;
}

// Aktuelle Haltung als Nullpunkt merken. Bewusst über eine kurze Messung statt
// einer Einzelprobe, und nur die zweite Hälfte zählt — die erste braucht der
// Tiefpass zum Einschwingen.
async function captureZero(btn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1';
  btn.textContent = '…';

  loadCalib();
  stopTilt();
  _tilt.g = null;
  const vals = [];
  tiltSubscribe((x, y, z, filtered) => {
    const s = tiltFeed(x, y, z, filtered);
    if (s) vals.push(s.pitch);
  });
  await sleep(TILT.baseMs);
  stopTilt();

  if (vals.length >= 4) {
    const hinten = vals.slice(Math.floor(vals.length / 2));
    _tilt.neutral = hinten.reduce((a, b) => a + b, 0) / hinten.length;
    _tilt.manual = true;
    saveCalib();
    btn.textContent = `${t('zeroDone')} ${Math.round(_tilt.neutral)}°`;
  } else {
    btn.textContent = t('zeroFail');     // kein Sensor oder keine Freigabe
  }
  setTimeout(() => { btn.textContent = t('zeroTilt'); btn.dataset.busy = ''; }, 1600);
}

async function requestSensor() {
  if (typeof DeviceMotionEvent?.requestPermission === 'function') {
    try {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm === 'granted') $('sensor-area').classList.add('hidden');
    } catch(e) { console.warn(e); }
  } else {
    $('sensor-area').classList.add('hidden');
  }
}

// ── Ruhelage und Kipprichtung ──────────────────────────────────────
// Der geführte Kalibrier-Assistent ist ersatzlos entfallen. Er hat einen
// 3D-Richtungsvektor eingemessen — genau das war die Ursache der
// Fehlerkennungen. Ein einzelner Neigungswinkel braucht keine Einmessung:
// senkrecht ist 0°, die Ruhelage führt sich während des Spiels selbst nach,
// und die Richtung ist physikalisch festgelegt. Bleibt genau ein Handgriff
// für den Fall, dass ein Gerät die Achse gespiegelt meldet: umdrehen.
function saveCalib() {
  try {
    localStorage.setItem('tilt_calib_v2', JSON.stringify({
      neutral: _tilt.neutral, sign: _tilt.sign, manual: !!_tilt.manual,
    }));
  } catch {}
}

function loadCalib() {
  try {
    const c = JSON.parse(localStorage.getItem('tilt_calib_v2') || 'null');
    if (c) {
      _tilt.neutral = Number.isFinite(c.neutral) ? c.neutral : 0;
      _tilt.sign = c.sign === 1 ? 1 : -1;
      _tilt.manual = !!c.manual;
      return true;
    }
  } catch {}
  _tilt.manual = false;
  // Ohne Kalibrierung ist die Physik der beste Vorgabewert: senkrecht gehalten
  // ist 0°, und nach vorne kippen dreht den Bildschirm zum Boden (gz negativ).
  _tilt.neutral = 0;
  _tilt.sign = -1;
  return false;
}

// ── PWA Install ────────────────────────────────────────────────────────────
let _deferredInstall = null;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstall = e;
  if (!isStandalone()) {
    show('btn-install-inline');
    show('install-overlay');
    show('btn-install-app');
    hide('install-ios-hint');
    hide('install-android-hint');
  }
});

// Ist die App laut Browser schon installiert? Chrome/Android beantwortet das
// über getInstalledRelatedApps, sofern das Manifest sich selbst unter
// related_applications aufführt. Wichtig, weil ein vom Startbildschirm
// gewischtes Symbol die App NICHT deinstalliert: sie bleibt installiert, und
// solange sie das ist, schickt Chrome kein `beforeinstallprompt` mehr.
async function installedElsewhere() {
  try {
    const apps = await navigator.getInstalledRelatedApps?.();
    return Array.isArray(apps) && apps.length > 0;
  } catch { return false; }
}

// Eine Webseite kann sich nicht selbst installieren – die einzige Möglichkeit
// ist, das vom Browser geschickte `beforeinstallprompt` auszulösen. Fehlt es,
// bleibt nur zu erklären, woran es liegt.
async function openInstall() {
  const hints = ['install-ios-hint', 'install-android-hint', 'install-already-hint'];

  if (_deferredInstall) {
    show('btn-install-app');
    hints.forEach(hide);
    _deferredInstall.prompt();
    await _deferredInstall.userChoice;
    _deferredInstall = null;
    hide('install-overlay');
    return;
  }

  hide('btn-install-app');
  hints.forEach(hide);
  $('install-title').textContent = t('installTitle');
  $('install-desc').textContent = t('installDesc');
  $('btn-install-skip').textContent = t('close');
  show('install-overlay');

  // Das Ereignis kann kurz nach dem Laden noch eintrudeln – einmal abwarten,
  // bevor wir aufgeben.
  if (!(await installedElsewhere())) {
    await sleep(700);
    if (_deferredInstall) { hide('install-overlay'); return openInstall(); }
  }

  if (await installedElsewhere()) {
    $('install-title').textContent = t('installedTitle');
    $('install-desc').textContent = t('installedDesc');
    show('install-already-hint');
  } else {
    show(isIOS() ? 'install-ios-hint' : 'install-android-hint');
  }
}

// ── Update-Reload ──────────────────────────────────────────────────────────
// Neue Version = Neuladen. Aber nie mitten in einer laufenden Runde – das hat
// im Spiel den Punktestand gekostet. Stattdessen bis zum Startscreen warten.
let _reloadPending = false;

function queueReload() {
  _reloadPending = true;
  applyPendingReload();
}

function applyPendingReload() {
  if (!_reloadPending) return;
  const inGame = !$('screen-game').classList.contains('hidden');
  if (inGame) return;
  _reloadPending = false;
  window.location.reload();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function lockLandscape() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    }
    await screen.orientation?.lock?.('landscape');
  } catch(_) {}
}
function unlockLandscape() {
  try { screen.orientation?.unlock?.(); } catch(_) {}
}

document.addEventListener('DOMContentLoaded', () => {
  // Sprachauswahl: eine Flagge sichtbar, Rest im Aufklappmenü
  const langSelect = document.querySelector('.lang-select');
  const langMenu   = $('lang-menu');
  const LANG_FLAGS = { de: '🇩🇪', en: '🇬🇧' };

  const closeLangMenu = () => {
    langSelect.classList.remove('open');
    langMenu.classList.add('hidden');
    $('lang-current').setAttribute('aria-expanded', 'false');
  };

  $('lang-current').addEventListener('click', e => {
    e.stopPropagation();
    const open = langSelect.classList.toggle('open');
    langMenu.classList.toggle('hidden', !open);
    $('lang-current').setAttribute('aria-expanded', String(open));
  });

  document.querySelectorAll('.lang-option').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const l = b.dataset.lang;
      document.querySelectorAll('.lang-option').forEach(x => x.classList.toggle('active', x === b));
      $('lang-flag').textContent = LANG_FLAGS[l] || '';
      $('lang-code').textContent = l.toUpperCase();
      closeLangMenu();
      setLang(l);
    });
  });

  // Tippen irgendwo sonst schließt das Menü wieder
  document.addEventListener('click', closeLangMenu);

  // Bilder für offline: alles am Stück laden + Speicheranzeige
  $('btn-dl-all').addEventListener('click', () => prefetchAll($('btn-dl-all')));
  $('btn-storage-clear').addEventListener('click', clearOfflineImages);

  // Round mode buttons
  document.querySelectorAll('.round-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.round-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.roundMode = b.dataset.rmode;
      if (S.roundMode === 'time')  S.roundValue = 30;
      if (S.roundMode === 'cards') S.roundValue = 5;
      renderRoundOptions();
    });
  });

  // Time preset buttons
  document.querySelectorAll('.time-preset').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.time-preset').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (b.dataset.val === 'custom') {
        show('time-custom-wrap');
      } else {
        hide('time-custom-wrap');
        S.roundValue = parseInt(b.dataset.val);
      }
    });
  });

  $('time-custom-input').addEventListener('input', e => {
    S.roundValue = Math.max(1, Math.min(3600, parseInt(e.target.value) || 60));
  });

  // Cards preset buttons
  document.querySelectorAll('.cards-preset').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.cards-preset').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (b.dataset.val === 'custom') {
        show('cards-custom-wrap');
      } else {
        hide('cards-custom-wrap');
        S.roundValue = parseInt(b.dataset.val);
      }
    });
  });

  $('cards-custom-input').addEventListener('input', e => {
    S.roundValue = Math.max(1, parseInt(e.target.value) || 10);
  });

  // Central tap zone → correct
  $('tap-zone').addEventListener('click', triggerCorrect);

  // Orientation lock toggle button
  let _orientLocked = false;
  $('btn-orient-lock').addEventListener('click', () => {
    if (_orientLocked) {
      unlockLandscape();
      _orientLocked = false;
      $('btn-orient-lock').textContent = '🔒 Landscape fixieren';
    } else {
      lockLandscape();
      _orientLocked = true;
      $('btn-orient-lock').textContent = '🔓 Rotation freigeben';
    }
  });

  // Zwei getrennte Handgriffe, bewusst ohne Überschneidung:
  // "Mitte setzen" merkt sich die aktuelle Haltung als Nullpunkt,
  // "Umdrehen" vertauscht nur Richtig und Weiter. Vorher hat Umdrehen den
  // Nullpunkt gleich mit überschrieben — das war ein Fehler.
  $('btn-zero-tilt').addEventListener('click', () => captureZero($('btn-zero-tilt')));

  $('btn-flip-tilt').addEventListener('click', () => {
    loadCalib();                       // Nullpunkt unangetastet übernehmen
    _tilt.sign = -_tilt.sign;
    saveCalib();
    const b = $('btn-flip-tilt');
    b.textContent = t('flipDone');
    setTimeout(() => { b.textContent = t('flipTilt'); }, 1400);
  });

  // Sensor-Test: zeigt live, was die Erkennung misst
  $('btn-open-debug').addEventListener('click', () => {
    show('sensor-debug');
    loadCalib();
    stopTilt();
    _tilt.g = null;
    let neutral = null, drift = 0;
    tiltSubscribe((x, y, z, filtered) => {
      const s = tiltFeed(x, y, z, filtered);
      if (!s) return;
      if (neutral === null) neutral = s.pitch;
      const rel = (s.pitch - neutral) * _tilt.sign;
      if (Math.abs(rel) < TILT.release && s.steady) {
        const dt = Math.min(0.25, Math.max(0, (s.now - (drift || s.now)) / 1000));
        neutral += (s.pitch - neutral) * (dt / (TILT.driftTau + dt));
      }
      drift = s.now;
      $('dbg-beta').textContent  = `${s.pitch.toFixed(0)}°`;
      $('dbg-gamma').textContent = `${neutral.toFixed(0)}°`;
      $('dbg-proj').textContent  = `${rel >= 0 ? '+' : ''}${rel.toFixed(0)}° (${_tilt.source === 'gravity' ? 'Sensor' : 'Motion'})`;
      $('dbg-dir').textContent = !s.steady ? '～ Wackler'
        : rel >= TILT.trigger ? '✅ RICHTIG'
        : rel <= -TILT.trigger ? '❌ WEITER'
        : '↔ neutral';
    });
  });
  $('btn-debug-close').addEventListener('click', () => {
    hide('sensor-debug');
    stopTilt();
  });

  // Navigation
  $('btn-to-category').addEventListener('click', () => { S.autoCalib = false; showCategory(); });
  $('btn-to-category-auto').addEventListener('click', () => { S.autoCalib = true; showCategory(); });
  $('btn-back-from-category').addEventListener('click', showStart);
  $('btn-end-game').addEventListener('click', endGame);
  $('btn-play-again').addEventListener('click', () => { S.category ? showCategory() : showStart(); });
  $('btn-to-start').addEventListener('click', showStart);
  $('btn-sensor').addEventListener('click', requestSensor);

  // Keyboard fallback (space = correct, enter = wrong, for testing on desktop)
  document.addEventListener('keydown', e => {
    const gs = !$('screen-game').classList.contains('hidden');
    if (!gs) return;
    if (e.code === 'Space') { e.preventDefault(); triggerCorrect(); }
    if (e.code === 'Enter') { e.preventDefault(); triggerWrong(); }
  });

  // iOS sensor check (DeviceMotion requires explicit permission on iOS 13+)
  if (typeof DeviceMotionEvent?.requestPermission === 'function') {
    show('sensor-area');
  }

  // PWA install
  $('btn-install-inline').addEventListener('click', openInstall);
  $('btn-install-app').addEventListener('click', openInstall);

  $('btn-install-skip').addEventListener('click', () => {
    hide('install-overlay');
    // Request fullscreen so browser mode feels like the app.
    // Das Versprechen muss abgefangen werden: ohne echte Nutzergeste lehnt
    // Chrome mit "Permissions check failed" ab und die Ablehnung landet
    // ungefangen in der Konsole.
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
    try { req?.call(el)?.catch?.(() => {}); } catch {}
  });

  // Läuft die App im Browser statt vom Home-Bildschirm, ist der Installations-
  // knopf dauerhaft da – unabhängig davon, ob der Browser ein
  // `beforeinstallprompt` schickt.
  if (!isStandalone()) {
    show('btn-install-inline');
    if (isIOS()) {
      show('install-overlay');
      hide('btn-install-app');
      show('install-ios-hint');
    }
  }

  // Service Worker – auto-reload when a new version activates.
  // Die Registrierung MUSS sofort passieren und darf nicht in den Leerlauf
  // verschoben werden: Chrome prüft kurz nach dem Laden, ob die Seite
  // installierbar ist, und dazu muss ein Service Worker registriert sein.
  // In v3.3 stand hier ein requestIdleCallback – Ergebnis war, dass
  // `beforeinstallprompt` nicht mehr feuerte und die App sich nicht mehr
  // installieren ließ. Der Zeitgewinn war ohnehin eingebildet: register()
  // arbeitet asynchron, der Abruf von sw.js blockiert den Hauptthread nicht.
  if ('serviceWorker' in navigator) {
    // Beim allerersten Besuch übernimmt der SW die Seite (clients.claim) –
    // das ist ein Controller-Wechsel ohne neue Version und darf kein Reload sein.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) queueReload();
      else { hadController = true; renderOfflineStatus(); }
    });

    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(renderOfflineStatus)
      .catch(console.warn);
  }

  setOffline(!navigator.onLine);

  loadCalib();
  showStart();
  renderAll();
  refreshStorageWhenIdle();

  // Startdauer sichtbar machen – sonst ist "gefühlt langsam" nicht messbar.
  // Erst direkt setzen (requestAnimationFrame feuert in einem Hintergrund-Tab
  // gar nicht), dann beim ersten echten Bild auf den genauen Wert nachziehen.
  const bootEl = $('boot-ms');
  if (bootEl) {
    const stamp = () => { bootEl.textContent = `· ${Math.round(performance.now())} ms`; };
    stamp();
    requestAnimationFrame(() => requestAnimationFrame(stamp));
  }
});
