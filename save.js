/* =====================================================================
   save.js  -  persistence (localStorage) + JSON import / export
   ---------------------------------------------------------------------
   Built for a game played across months. The working copy lives in
   localStorage and autosaves after every change. Because localStorage is
   capped (~5MB), if it ever fills, we trim the oldest fights' verbose
   round-by-round detail (keeping the result, scorecards, stats and all
   rating changes) so the universe never fails to save. Export a JSON
   backup any time to keep absolutely everything.
   ===================================================================== */

const STORAGE_KEY = 'boxing-universe-god-mode-v1';
let _saveTimer = null;
let _lastSaveInfo = { ok: true, trimmed: 0, at: null };

function serializeState() { return JSON.stringify(state); }

/* fill in any fields missing from an older save so upgrades don't break */
function migrateState(s) {
  if (!s.meta) s.meta = { version: 1, created: Date.now(), universeName: 'Boxing Universe' };
  if (!s.settings) s.settings = { speed: 'manual', autoSimScheduled: false, autosave: true, compactSaved: false };
  if (s.settings.autosave == null) s.settings.autosave = true;
  if (!s.date) s.date = { y: 2026, m: 1, d: 1 };
  if (!s.boxers) s.boxers = {};
  if (!s.fights) s.fights = [];
  if (!s.cards) s.cards = [];
  if (!s.champions) s.champions = {};
  if (!s.titleHistory) s.titleHistory = [];
  if (!s.awards) s.awards = {};
  if (!s.counters) s.counters = { boxer: 1, fight: 1, card: 1 };
  WEIGHT_CLASSES.forEach(wc => { if (!s.champions[wc]) s.champions[wc] = {}; });
  // per-boxer forward-compat
  Object.values(s.boxers).forEach(b => {
    if (b.earnings == null) b.earnings = 0;
    if (b.peakElo == null) b.peakElo = b.elo;
    if (b.peakFollowers == null) b.peakFollowers = b.followers;
    if (b.titleDefences == null) b.titleDefences = 0;
    if (b.frozen == null) b.frozen = false;
    if (b.attributes) ATTR_KEYS.forEach(k => { if (b.attributes[k] > 99) b.attributes[k] = 99; });
    if (!b.currentStreak) b.currentStreak = { type: null, count: 0 };
    if (!b.eloHistory) b.eloHistory = [{ d: dateToStr(s.date), e: b.elo }];
    if (!b.followerHistory) b.followerHistory = [{ d: dateToStr(s.date), f: b.followers }];
    if (!b.fightHistory) b.fightHistory = [];
    if (!b.hidden) b.hidden = { potential: b.elo / 20 + 50, confidence: 60, durability: 60, damageAccumulation: 0, careerMomentum: 0, primeAge: 28, declineAge: 34, improvementRate: 1, legacyScore: 0 };
  });
  return s;
}

/* ----- core save / load ----- */
function saveUniverse() {
  try {
    localStorage.setItem(STORAGE_KEY, serializeState());
    _lastSaveInfo = { ok: true, trimmed: 0, at: Date.now() };
    return _lastSaveInfo;
  } catch (err) {
    // quota exceeded -> trim oldest verbose detail and retry
    let trimmed = 0;
    while (trimmed < state.fights.length) {
      const batch = trimOldestDetail(60);
      if (batch === 0) break;
      trimmed += batch;
      try {
        localStorage.setItem(STORAGE_KEY, serializeState());
        state.settings.compactSaved = true;
        _lastSaveInfo = { ok: true, trimmed, at: Date.now() };
        return _lastSaveInfo;
      } catch (e2) { /* keep trimming */ }
    }
    _lastSaveInfo = { ok: false, trimmed, at: Date.now() };
    return _lastSaveInfo;
  }
}

/* strip round-by-round detail from the n oldest fights that still have it */
function trimOldestDetail(n) {
  const withDetail = state.fights
    .filter(f => f.result && f.result.rounds && f.result.rounds.length)
    .sort((a, b) => dateCompare(a.date, b.date));
  let count = 0;
  for (const f of withDetail) {
    if (count >= n) break;
    f.result.rounds = null;
    f.result.commentary = ['Round-by-round detail was trimmed to save space. Export your universe to keep full detail.'];
    f.result._trimmed = true;
    count++;
  }
  return count;
}

function loadUniverse() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    replaceState(migrateState(parsed));
    return true;
  } catch (err) {
    console.warn('Could not load saved universe:', err);
    return false;
  }
}

function autosave() {
  if (!state.settings || !state.settings.autosave) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveUniverse, 400);
}

function resetUniverse() {
  replaceState(createEmptyUniverse());
  saveUniverse();
}

function storageFootprintKB() {
  try { return Math.round((serializeState().length * 2) / 1024); } catch (e) { return 0; }
}

/* ----- file download / upload ----- */
function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportUniverse() {
  const d = state.date;
  downloadJSON(state, `boxing-universe-${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}.json`);
}

function importUniverseFromFile(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.boxers) throw new Error('This file does not look like a Boxing Universe save.');
      replaceState(migrateState(parsed));
      saveUniverse();
      cb(null);
    } catch (err) { cb(err); }
  };
  reader.onerror = () => cb(new Error('Could not read the file.'));
  reader.readAsText(file);
}

/* ----- individual boxer import / export (share fighters) ----- */
function exportBoxers(ids) {
  const list = ids.map(getBoxer).filter(Boolean).map(b => JSON.parse(JSON.stringify(b)));
  downloadJSON({ type: 'boxing-universe-boxers', version: 1, boxers: list }, `boxers-${Date.now()}.json`);
}

function importBoxersFromText(text) {
  const parsed = JSON.parse(text);
  let arr = [];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed.boxers) arr = parsed.boxers;
  else if (parsed.attributes) arr = [parsed]; // single boxer object
  else throw new Error('No boxers found in that JSON.');

  const added = [];
  arr.forEach(raw => {
    // arrive as a freshly created fighter in THIS universe: keep identity,
    // ratings and record, but clear references to fights that do not exist here
    const clean = Object.assign({}, raw);
    delete clean.id;
    clean.fightHistory = [];
    clean.eloHistory = null;
    clean.followerHistory = null;
    clean.bestWinId = null; clean.worstLossId = null;
    clean.titles = [];                       // belts must be won/assigned in this universe
    clean.peakElo = raw.peakElo || raw.elo;
    clean.peakFollowers = raw.peakFollowers || raw.followers;
    added.push(addBoxer(clean));
  });
  saveUniverse();
  return added;
}
