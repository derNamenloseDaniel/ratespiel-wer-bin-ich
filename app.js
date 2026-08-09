// ── State ──────────────────────────────────────────────────────────────────
const S = {
  lang: 'de',
  mode: 'word',       // 'word' | 'image'
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
  neutralGravity: null, // {x,y,z} from accelerationIncludingGravity, auto-detected at game start
  tiltDirX: 0,          // normalized forward-tilt direction vector in gravity space
  tiltDirY: 1,
  tiltDirZ: 0,
  autoCalib: false,     // true = axis derived from screen.orientation.angle, false = saved wizard calib
  currentImage: null,
};

window.LANG = 'de';

// ── Audio ──────────────────────────────────────────────────────────────────
const AC = new (window.AudioContext || window.webkitAudioContext)();

function beep(freq, duration, type = 'sine', gain = 0.3) {
  const osc = AC.createOscillator();
  const g = AC.createGain();
  osc.connect(g); g.connect(AC.destination);
  osc.frequency.value = freq;
  osc.type = type;
  g.gain.setValueAtTime(gain, AC.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + duration);
  osc.start(); osc.stop(AC.currentTime + duration);
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
const IMG_MEMO_KEY = 'img_memo_v1';
const CAT_READY_KEY = 'cat_offline_v1';

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
async function fetchWikiImageByTitle(title, lang) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=600&origin=*`;
  const r = await fetchTimed(url);
  const j = await r.json();
  const pages = j.query?.pages;
  const page = pages ? Object.values(pages)[0] : null;
  return page?.thumbnail?.source || null;
}

// Eine Anfrage für bis zu 25 Begriffe statt 25 Anfragen. Ohne das läuft der
// Vorabdownload nach ein paar hundert Wörtern in Wikipedias Rate-Limit.
async function wikiThumbsBatch(titles, lang) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*`
            + `&prop=pageimages&pithumbsize=600&redirects=1&titles=`
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
    if (p.thumbnail?.source) thumbs.set(p.title, p.thumbnail.source);
  }

  const out = new Map();
  for (const [orig, cur] of current) out.set(orig, thumbs.get(cur) || null);
  return out;
}

// Wirft bei Netzproblemen, gibt null zurück wenn die API geantwortet hat,
// es aber schlicht kein Bild gibt. Diese Unterscheidung ist wichtig: das eine
// heißt "Karte überspringen", das andere "offline, Wort zeigen".
async function lookupWikiImage(term, skipDirect = false) {
  const lang = S.lang === 'de' ? 'de' : 'en';
  const direct = skipDirect ? null : await fetchWikiImageByTitle(term, lang);
  if (direct) return direct;

  const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=3&format=json&origin=*`;
  const sr = await fetchTimed(searchUrl);
  const sj = await sr.json();
  const hits = sj.query?.search || [];
  for (const hit of hits) {
    const img = await fetchWikiImageByTitle(hit.title, lang);
    if (img) return img;
  }
  return null;
}

// → { url: string|null, offline: bool }
async function resolveImage(term, skipDirect = false) {
  const key = `${S.lang}|${term}`;
  if (key in IMG_MEMO) return { url: IMG_MEMO[key] || null, offline: false };
  if (!navigator.onLine) return { url: null, offline: true };
  try {
    const url = await lookupWikiImage(term, skipDirect);
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
  updateModeAvailability();
  renderStorageLine();
}

// Gibt es überhaupt vorab geladene Bilder?
function hasOfflineImages() {
  return Object.values(catReadyMap()).some(n => n > 0);
}

// Der Bildmodus ist offline nur wählbar, wenn Bilder vorab geladen wurden –
// sonst führt die Auswahl in eine Sackgasse. Mit geladenen Bildern bleibt er
// offen, denn genau dafür ist der Vorabdownload da.
function updateModeAvailability() {
  const imgBtn = document.querySelector('.mode-btn[data-mode="image"]');
  const wordBtn = document.querySelector('.mode-btn[data-mode="word"]');
  if (!imgBtn) return;

  const allowed = !isOffline() || hasOfflineImages();
  imgBtn.disabled = !allowed;
  imgBtn.title = allowed ? '' : t('imageNeedsNet');

  if (!allowed && S.mode === 'image') {
    S.mode = 'word';
    imgBtn.classList.remove('active');
    wordBtn.classList.add('active');
  }

  const dl = $('btn-dl-all');
  if (dl) dl.classList.toggle('hidden', isOffline());
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
    if (!r) return 0;
    // Content-Length ist auch bei CORS-Antworten lesbar (safelisted header).
    const len = Number(r.headers.get('content-length'));
    return len || (await r.clone().blob()).size;
  }));
  return sizes.reduce((a, b) => a + b, 0);
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
  $('cat-hint').classList.toggle('hidden', S.mode !== 'image');

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
    // Offline im Bildmodus: was nicht geladen wurde, gibt es hier auch nicht.
    if (S.mode === 'image' && isOffline() && have === 0) {
      btn.disabled = true;
      btn.title = t('catNeedsDownload');
    }
    cell.appendChild(btn);

    // Im Bildmodus: pro Kategorie die Bilder vorab holen, damit sie später
    // auch ohne Netz da sind. Der Service Worker behält sie dauerhaft.
    if (S.mode === 'image') {
      const dl = document.createElement('button');
      dl.className = 'cat-dl';
      dl.textContent = have > 0 ? `✅ ${have}` : '⬇';
      dl.title = t('prefetchHint');
      dl.disabled = isOffline();
      dl.onclick = ev => { ev.stopPropagation(); prefetchCategory(cat, dl); };
      cell.appendChild(dl);
    }

    grid.appendChild(cell);
  });
}

// Holt Bilder ins Offline-Depot. Bricht ab, sobald das Netz mehrfach nicht
// antwortet – sonst läuft man in lauter 5-Sekunden-Timeouts.
// onProgress bekommt einen Bruchteil 0..1. Die Bild-Bytes sind der langsame
// Teil, also bekommt der auch den größten Teil des Balkens.
async function prefetchWords(words, suffix, onProgress) {
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
      const found = await wikiThumbsBatch(chunk, lang);
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
    const res = await resolveImage(rest[i], true);   // direkte Abfrage war schon erfolglos
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
    frac => { btn.textContent = `${Math.round(frac * 100)} %`; }
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
      frac => { btn.textContent = `${Math.round((before + frac * words.length) / grand * 100)} %`; }
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
function applyAutoCalib() {
  // "Steering wheel toward you" rotates around the short axis of the landscape phone.
  // In device gravity coordinates this shows up on the X axis (Y was left/right).
  // Sign depends on which landscape rotation the phone is in.
  const angle = screen.orientation?.angle ?? 90;
  const sign = angle === 270 ? 1 : -1;
  S.tiltDirX = sign;
  S.tiltDirY = 0;
  S.tiltDirZ = 0;
}

async function startGame() {
  lockLandscape();
  if (S.autoCalib) applyAutoCalib();
  S.deck = shuffle(getWords(S.category, S.lang));
  S.index = 0; S.correct = 0; S.wrong = 0;
  S.startTime = Date.now();
  S.advancing = false; S.neutralGravity = null;
  hideAll(); show('screen-game');
  hide('timer-display');
  renderAll();
  updateProgress();
  if (S.roundMode === 'time') startTimer();
  else if (S.roundMode === 'infinite') startElapsedTimer();
  await showCard();
  calibrateTilt();
}

function searchTermFor(word) {
  const cat = CATEGORIES.find(c => c.id === S.category);
  return word + (cat?.imageSearchSuffix?.[S.lang] || '');
}

async function showCard(skips = 0) {
  if (S.index >= S.deck.length) { endGame(); return; }
  const word = S.deck[S.index];
  $('card-word').textContent = '';
  $('card-image').src = '';
  $('card-image').classList.add('hidden');
  $('card-word').classList.remove('hidden');

  if (S.mode === 'image') {
    $('card-word').textContent = t('loading');
    const res = await resolveImage(searchTermFor(word));
    const ok  = res.url ? await loadImage(res.url) : false;

    if (ok) {
      $('card-image').src = res.url;
      $('card-image').classList.remove('hidden');
      $('card-word').classList.add('hidden');
      // nächste Karte vorbereiten (nur wenn Netz da ist)
      const next = S.deck[S.index + 1];
      if (next && navigator.onLine) resolveImage(searchTermFor(next));
    } else if (res.offline || res.url) {
      // Netzproblem: entweder kam die URL gar nicht erst, oder sie ist bekannt,
      // die Bytes fehlen aber im Cache. In beiden Fällen: Wort zeigen, statt
      // die Runde zu killen. (Vorher wurde hier übersprungen – offline hieß das:
      // das ganze Deck rast in Sekunden durch und das Spiel endet sofort.)
      setOffline(true);
      $('card-word').textContent = word;
    } else if (skips < 12) {
      // Online, aber zu diesem Begriff gibt es wirklich kein Bild → überspringen
      S.index++;
      if (S.index >= S.deck.length) { endGame(); return; }
      await showCard(skips + 1);
      return;
    } else {
      $('card-word').textContent = word;
    }
  } else {
    $('card-word').textContent = word;
  }
  updateProgress();
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
  removeOrientationListener();
  const elapsed = Math.floor((Date.now() - S.startTime) / 1000);
  hideAll(); show('screen-summary');
  renderAll();
  $('sum-time').textContent = formatTime(elapsed);
  $('sum-correct').textContent = S.correct;
  $('sum-wrong').textContent = S.wrong;
  $('sum-score').textContent = S.correct;
}

// ── DeviceMotion (gravity vector, no gimbal lock) ─────────────────────────
// Uses accelerationIncludingGravity instead of DeviceOrientation Euler angles.
// The gravity vector is smooth in all orientations, including flat/landscape.
const TILT_THRESHOLD = 5; // m/s² ≈ 30° tilt from neutral

let _orientHandler = null;

function _grav(e) {
  const g = e.accelerationIncludingGravity;
  return g ? { x: g.x ?? 0, y: g.y ?? 0, z: g.z ?? 0 } : null;
}

function calibrateTilt() {
  const autoCalib = e => {
    const g = _grav(e);
    if (!g) return;
    S.neutralGravity = g;
    window.removeEventListener('devicemotion', autoCalib);
    listenTilt();
  };
  window.addEventListener('devicemotion', autoCalib);
}

function listenTilt() {
  let tiltCooldown = false;
  _orientHandler = e => {
    if (S.advancing || tiltCooldown || !S.neutralGravity) return;
    const g = _grav(e);
    if (!g) return;
    const dx = g.x - S.neutralGravity.x;
    const dy = g.y - S.neutralGravity.y;
    const dz = g.z - S.neutralGravity.z;
    const proj = dx * S.tiltDirX + dy * S.tiltDirY + dz * S.tiltDirZ;
    if (proj > TILT_THRESHOLD) {
      tiltCooldown = true;
      setTimeout(() => { tiltCooldown = false; }, 1200);
      triggerCorrect();
    } else if (proj < -TILT_THRESHOLD) {
      tiltCooldown = true;
      setTimeout(() => { tiltCooldown = false; }, 1200);
      triggerWrong();
    }
  };
  window.addEventListener('devicemotion', _orientHandler);
}

function removeOrientationListener() {
  if (_orientHandler) {
    window.removeEventListener('devicemotion', _orientHandler);
    _orientHandler = null;
  }
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

// ── Calibration Wizard ─────────────────────────────────────────────────────
const CALIB_DETECT_THRESHOLD = 3.5; // m/s² ≈ 21° tilt — enough to confirm forward tilt

const _calib = {
  step: 0,
  latest: { x: 0, y: 0, z: 0 },
  neutral: { x: 0, y: 0, z: 0 },
  forward: { x: 0, y: 0, z: 0 },
  handler: null,
  timer: null,
};

const CALIB_STEPS_CFG = [
  { icon: '📱', key: 'calibStep1' },
  { icon: '✅', key: 'calibStep2' },
];

function loadCalib() {
  const stored = localStorage.getItem('tilt_calib');
  if (stored) {
    const c = JSON.parse(stored);
    S.tiltDirX = c.dirX ?? 0;
    S.tiltDirY = c.dirY ?? 1;
    S.tiltDirZ = c.dirZ ?? 0;
  }
}

function openCalib() {
  _calib.step = 0;
  _calib.latest = { x: 0, y: 0, z: 0 };
  _calib.neutral = { x: 0, y: 0, z: 0 };
  _calib.forward = { x: 0, y: 0, z: 0 };
  show('calib-overlay');
  show('calib-wizard');
  hide('calib-done');
  _calibRunStep(0);
}

function closeCalib() {
  hide('calib-overlay');
  if (_calib.handler) { window.removeEventListener('devicemotion', _calib.handler); _calib.handler = null; }
  clearTimeout(_calib.timer);
}

function _calibRunStep(step) {
  if (_calib.handler) { window.removeEventListener('devicemotion', _calib.handler); _calib.handler = null; }
  clearTimeout(_calib.timer);
  _calib.step = step;

  if (step > 1) { _calibSave(); return; }

  const cfg = CALIB_STEPS_CFG[step];
  $('calib-wizard-icon').textContent = cfg.icon;
  $('calib-wizard-text').textContent = t(cfg.key);
  document.querySelectorAll('.calib-dot').forEach((d, i) => {
    d.classList.toggle('calib-dot-active', i === step);
  });

  if (step === 0) {
    // Hold straight → click OK
    show('calib-step0-ui');
    hide('calib-tilt-wrap');
    _calib.handler = e => {
      const g = _grav(e);
      if (!g) return;
      _calib.latest = g;
      const mag = Math.sqrt(g.x*g.x + g.y*g.y + g.z*g.z);
      $('calib-live-angles').textContent = `Sensor: ${mag.toFixed(1)} m/s²`;
    };
    window.addEventListener('devicemotion', _calib.handler);
  } else {
    // Tilt forward → must hold above threshold for 600ms to avoid accidental triggers
    hide('calib-step0-ui');
    show('calib-tilt-wrap');
    $('calib-tilt-fill').style.width = '0%';
    let holdTimer = null;
    let holdGravity = null;
    _calib.handler = e => {
      const g = _grav(e);
      if (!g) return;
      const dx = g.x - _calib.neutral.x;
      const dy = g.y - _calib.neutral.y;
      const dz = g.z - _calib.neutral.z;
      const mag = Math.sqrt(dx*dx + dy*dy + dz*dz);
      $('calib-tilt-fill').style.width = Math.min(100, (mag / CALIB_DETECT_THRESHOLD) * 100) + '%';
      if (mag >= CALIB_DETECT_THRESHOLD) {
        holdGravity = g;
        if (!holdTimer) holdTimer = setTimeout(() => {
          _calib.forward = holdGravity;
          _calibRunStep(2);
        }, 600);
      } else {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    window.addEventListener('devicemotion', _calib.handler);
  }
}

function _calibSave() {
  // 3D direction vector = normalize(forward − neutral). Backward = its inverse.
  const dx = _calib.forward.x - _calib.neutral.x;
  const dy = _calib.forward.y - _calib.neutral.y;
  const dz = _calib.forward.z - _calib.neutral.z;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const dirX = len > 0.5 ? dx/len : 0;
  const dirY = len > 0.5 ? dy/len : 1;
  const dirZ = len > 0.5 ? dz/len : 0;
  S.tiltDirX = dirX; S.tiltDirY = dirY; S.tiltDirZ = dirZ;
  localStorage.setItem('tilt_calib', JSON.stringify({ dirX, dirY, dirZ }));
  document.querySelectorAll('.calib-dot').forEach((d, i) => {
    d.classList.toggle('calib-dot-active', i === 2);
  });
  hide('calib-wizard');
  show('calib-done');
  _calib.timer = setTimeout(closeCalib, 1500);
}

// ── PWA Install ────────────────────────────────────────────────────────────
let _deferredInstall = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstall = e;
  // Only show if not already installed
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    show('install-overlay');
  }
});

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
  // Language buttons
  document.querySelectorAll('.lang-btn').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.lang-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      setLang(b.dataset.lang);
    });
  });

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      document.querySelectorAll('.mode-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      S.mode = b.dataset.mode;
    });
  });

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

  // Calibration
  $('btn-open-calib').addEventListener('click', openCalib);
  $('btn-calib-cancel').addEventListener('click', closeCalib);
  $('btn-calib-step-ok').addEventListener('click', () => {
    if (_calib.step !== 0) return;
    lockLandscape();
    _calib.neutral = { ..._calib.latest };
    _calibRunStep(1);
  });

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

  // Sensor debug
  let _dbgHandler = null;
  $('btn-open-debug').addEventListener('click', () => {
    show('sensor-debug');
    let dbgNeutral = null;
    _dbgHandler = e => {
      const g = _grav(e);
      if (!g) return;
      if (dbgNeutral === null) dbgNeutral = { x: g.x, y: g.y, z: g.z };
      const mag = Math.sqrt(g.x*g.x + g.y*g.y + g.z*g.z);
      $('dbg-beta').textContent  = `x:${g.x.toFixed(1)} y:${g.y.toFixed(1)}`;
      $('dbg-gamma').textContent = `z:${g.z.toFixed(1)}  |g|:${mag.toFixed(1)}`;
      const dx = g.x - dbgNeutral.x;
      const dy = g.y - dbgNeutral.y;
      const dz = g.z - dbgNeutral.z;
      const proj = dx * S.tiltDirX + dy * S.tiltDirY + dz * S.tiltDirZ;
      $('dbg-proj').textContent = proj.toFixed(1) + ' m/s²';
      const dir = proj > TILT_THRESHOLD ? '✅ RICHTIG' : proj < -TILT_THRESHOLD ? '❌ WEITER' : '↔ neutral';
      $('dbg-dir').textContent = dir;
    };
    window.addEventListener('devicemotion', _dbgHandler);
  });
  $('btn-debug-close').addEventListener('click', () => {
    hide('sensor-debug');
    if (_dbgHandler) { window.removeEventListener('devicemotion', _dbgHandler); _dbgHandler = null; }
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

  // PWA install buttons
  $('btn-install-app').addEventListener('click', async () => {
    if (_deferredInstall) {
      // Android/Chrome: trigger native install prompt
      _deferredInstall.prompt();
      const { outcome } = await _deferredInstall.userChoice;
      _deferredInstall = null;
    }
    hide('install-overlay');
  });

  $('btn-install-skip').addEventListener('click', () => {
    hide('install-overlay');
    // Request fullscreen so browser mode feels like the app
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen)?.call(el);
  });

  // iOS: show manual instructions instead of install button
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIOS && !isStandalone) {
    show('install-overlay');
    hide('btn-install-app');
    show('install-ios-hint');
  }

  // Service Worker – auto-reload when a new version activates
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.ready)
      .then(renderOfflineStatus)
      .catch(console.warn);

    // Beim allerersten Besuch übernimmt der SW die Seite (clients.claim) –
    // das ist ein Controller-Wechsel ohne neue Version und darf kein Reload sein.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) queueReload();
      else { hadController = true; renderOfflineStatus(); }
    });
  }

  setOffline(!navigator.onLine);

  loadCalib();
  if (localStorage.getItem('tilt_calib')) {
    const overlay = $('calib-done-overlay');
    overlay.classList.remove('hidden');
    overlay.addEventListener('click', () => overlay.classList.add('hidden'), { once: true });
  }
  showStart();
  renderAll();
  refreshStorage();
});
