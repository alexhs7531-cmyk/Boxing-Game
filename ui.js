/* =====================================================================
   ui.js  -  rendering + views
   ---------------------------------------------------------------------
   Views are plain functions returning HTML strings. render() swaps the
   content and calls a per-view wire() to attach that page's handlers.
   Global navigation/profile clicks are delegated once in app.js.
   ===================================================================== */

let currentRoute = 'dashboard';
let routeParams = {};
const views = {}; // route -> { html(params), wire(params) }

/* ------------------------------ helpers ------------------------------ */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function on(sel, evt, fn, root) { const e = $(sel, root); if (e) e.addEventListener(evt, fn); }
function val(id) { const e = $('#' + id); return e ? e.value.trim() : ''; }
function numv(id, def) { const e = $('#' + id); if (!e) return def; const n = parseFloat(e.value); return isNaN(n) ? def : n; }

function ratingColor(v) {
  if (v >= 88) return 'var(--gold)';
  if (v >= 75) return 'var(--green)';
  if (v >= 60) return 'var(--green-dim)';
  if (v >= 45) return 'var(--bone-dim)';
  if (v >= 30) return 'var(--amber)';
  return 'var(--red)';
}
function delta(n, opts) {
  n = Math.round(n);
  if (!n) return `<span class="delta delta--flat">±0${(opts && opts.suffix) || ''}</span>`;
  const cls = n > 0 ? 'delta--up' : 'delta--down';
  return `<span class="delta ${cls}">${n > 0 ? '+' : ''}${n.toLocaleString()}${(opts && opts.suffix) || ''}</span>`;
}
function chip(text, cls) { return `<span class="chip ${cls || ''}">${esc(text)}</span>`; }
function beltChip(belt, wc) { return `<span class="chip chip--belt" title="${esc(belt)} ${esc(wc || '')}">${esc(BELT_SHORT[belt] || belt)}</span>`; }

function methodBadge(res) {
  if (res.draw) return `<span class="chip chip--muted">${esc(res.method)}</span>`;
  const ko = res.method === 'KO' || res.method === 'TKO' || res.method === 'RTD';
  return `<span class="chip ${ko ? 'chip--ko' : 'chip--dec'}">${esc(res.method)}${res.timeStr !== 'Decision' ? ' R' + res.round : ''}</span>`;
}

function attrBar(key, val) {
  return `<div class="bar"><span class="bar__label">${esc(ATTR_LABELS[key] || key)}</span>
    <span class="bar__track"><span class="bar__fill" style="width:${val}%;background:${ratingColor(val)}"></span></span>
    <span class="bar__num">${val}</span></div>`;
}

/* tiny sparkline from numeric points */
function sparkline(points, opts) {
  opts = opts || {};
  const w = opts.w || 260, h = opts.h || 50, pad = 4, color = opts.color || 'var(--gold)';
  if (!points || points.length < 2) return `<div class="spark spark--empty">Not enough data yet</div>`;
  const min = Math.min.apply(null, points), max = Math.max.apply(null, points);
  const range = (max - min) || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const pts = points.map((p, i) => `${(pad + i * step).toFixed(1)},${(h - pad - ((p - min) / range) * (h - pad * 2)).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${(pad + (points.length - 1) * step).toFixed(1)}" cy="${(h - pad - ((last - min) / range) * (h - pad * 2)).toFixed(1)}" r="2.6" fill="${color}"/>
  </svg>`;
}

function selectOptions(arr, selected) {
  return arr.map(o => `<option value="${esc(o)}"${o === selected ? ' selected' : ''}>${esc(o)}</option>`).join('');
}

/* compact fighter row used in lists; clickable to profile */
function fighterRow(b, rightHtml, rankHtml) {
  const belts = heldBelts(b);
  return `<button class="lb-row" data-profile="${b.id}">
    ${rankHtml ? `<span class="lb-rank">${rankHtml}</span>` : ''}
    <span class="lb-main">
      <span class="lb-name">${esc(b.name)}${b.nickname ? ` <em>“${esc(b.nickname)}”</em>` : ''}
        ${belts.slice(0, 5).map(x => beltChip(x.belt, x.wc)).join('')}
        ${b.status === 'retired' ? '<span class="chip chip--muted">Retired</span>' : ''}
      </span>
      <span class="lb-sub">${esc(b.nationality)} · ${esc(b.weightClass)} · ${esc(b.style)} · Age ${b.age}</span>
    </span>
    <span class="lb-right">${rightHtml || ''}</span>
  </button>`;
}

/* fighter mini-card for grids */
function fighterCard(b) {
  const belts = heldBelts(b);
  return `<button class="fcard" data-profile="${b.id}">
    <span class="fcard__ovr" style="color:${ratingColor(overall(b))}">${overall(b)}</span>
    <span class="fcard__body">
      <span class="fcard__name">${esc(b.name)}</span>
      <span class="fcard__nick">${b.nickname ? '“' + esc(b.nickname) + '”' : esc(careerPhase(b))}</span>
      <span class="fcard__meta">${esc(WEIGHT_CLASS_SHORT[b.weightClass])} · ${esc(b.nationality)}</span>
      <span class="fcard__rec mono">${esc(recordStr(b))}</span>
    </span>
    <span class="fcard__foot">
      <span class="mono">ELO ${b.elo}</span>
      ${belts.length ? `<span>${belts.slice(0, 3).map(x => beltChip(x.belt)).join('')}</span>` : `<span class="muted">${fmtFollowers(b.followers)} fans</span>`}
    </span>
  </button>`;
}

/* ----- tale of the tape: the signature head-to-head ----- */
function taleOfTape(a, b, opts) {
  opts = opts || {};
  const rows = [
    ['Record', recordStr(a), recordStr(b)],
    ['ELO', a.elo, b.elo],
    ['Age', a.age, b.age],
    ['Height', a.height + ' cm', b.height + ' cm'],
    ['Reach', a.reach + ' cm', b.reach + ' cm'],
    ['Stance', a.stance, b.stance],
    ['Style', a.style, b.style],
    ['KO %', koPct(a) + '%', koPct(b) + '%'],
    ['Followers', fmtFollowers(a.followers), fmtFollowers(b.followers)],
    ['Overall', overall(a), overall(b)]
  ];
  const winA = opts.winA != null ? opts.winA : null;
  return `<div class="tale">
    <div class="tale__head">
      <div class="tale__fighter">
        <div class="tale__ovr" style="color:${ratingColor(overall(a))}">${overall(a)}</div>
        <div class="tale__name">${esc(a.name)}</div>
        <div class="tale__nick">${a.nickname ? '“' + esc(a.nickname) + '”' : esc(a.nationality)}</div>
      </div>
      <div class="tale__vs">VS</div>
      <div class="tale__fighter tale__fighter--b">
        <div class="tale__ovr" style="color:${ratingColor(overall(b))}">${overall(b)}</div>
        <div class="tale__name">${esc(b.name)}</div>
        <div class="tale__nick">${b.nickname ? '“' + esc(b.nickname) + '”' : esc(b.nationality)}</div>
      </div>
    </div>
    ${winA != null ? `<div class="winbar" title="Estimated win probability">
        <span class="winbar__a" style="width:${winA}%">${winA}%</span>
        <span class="winbar__b" style="width:${100 - winA}%">${100 - winA}%</span>
      </div>` : ''}
    <div class="tale__rows">
      ${rows.map(r => `<div class="tale__row"><span class="tale__a">${esc(r[1])}</span><span class="tale__k">${esc(r[0])}</span><span class="tale__b">${esc(r[2])}</span></div>`).join('')}
    </div>
  </div>`;
}

/* ----- modal + toast ----- */
function openModal(html, opts) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML = `<div class="scrim" data-close-modal></div>
    <div class="modal__box ${opts && opts.wide ? 'modal__box--wide' : ''}">
      <div class="modal__head"><h3>${esc((opts && opts.title) || '')}</h3><button class="icon-btn" data-close-modal aria-label="Close">✕</button></div>
      <div class="modal__body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  return wrap;
}
function closeModal() {
  const m = $('.modal'); if (m) m.remove();
  document.body.style.overflow = '';
}
function confirmModal(message, onYes, opts) {
  opts = opts || {};
  openModal(`<p class="confirm-msg">${message}</p>
    <div class="btn-row btn-row--end">
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn ${opts.danger ? 'btn--danger' : 'btn--primary'}" id="confirm-yes">${esc(opts.confirmLabel || 'Confirm')}</button>
    </div>`, { title: opts.title || 'Are you sure?' });
  on('#confirm-yes', 'click', () => { closeModal(); onYes(); });
}
let _toastTimer = null;
function toast(msg, kind) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.className = 'toast toast--' + (kind || 'ok') + ' show';
  t.textContent = msg;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
}

/* ----- reusable fighter picker (searchable) ----- */
function fighterPicker(id, opts) {
  opts = opts || {};
  return `<div class="picker" data-picker="${id}">
    <input type="text" class="picker__input" id="${id}-input" placeholder="${esc(opts.placeholder || 'Search a fighter…')}" autocomplete="off">
    <input type="hidden" id="${id}-value">
    <div class="picker__chosen" id="${id}-chosen"></div>
    <div class="picker__list" id="${id}-list" hidden></div>
  </div>`;
}
function wireFighterPicker(id, onPick, opts) {
  opts = opts || {};
  const input = $('#' + id + '-input'), list = $('#' + id + '-list'), chosen = $('#' + id + '-chosen'), hidden = $('#' + id + '-value');
  if (!input) return;
  function pool() {
    let arr = opts.includeRetired ? allBoxers() : activeBoxers();
    const div = opts.division && opts.division();
    if (div && div !== 'all') arr = arr.filter(b => b.weightClass === div);
    const exclude = opts.exclude && opts.exclude();
    if (exclude) arr = arr.filter(b => b.id !== exclude);
    return arr;
  }
  function renderList(q) {
    q = (q || '').toLowerCase().trim();
    let arr = pool();
    if (q) arr = arr.filter(b => (b.name + ' ' + b.nickname + ' ' + b.nationality).toLowerCase().includes(q));
    arr = arr.sort((a, b) => b.elo - a.elo).slice(0, 40);
    if (!arr.length) { list.innerHTML = `<div class="picker__empty">No fighters match.</div>`; list.hidden = false; return; }
    list.innerHTML = arr.map(b => `<button type="button" class="picker__item" data-pick="${b.id}">
      <span>${esc(b.name)} <em>${b.nickname ? '“' + esc(b.nickname) + '”' : ''}</em></span>
      <span class="mono muted">${esc(WEIGHT_CLASS_SHORT[b.weightClass])} · ${recordStr(b)} · ELO ${b.elo}</span></button>`).join('');
    list.hidden = false;
  }
  input.addEventListener('focus', () => renderList(input.value));
  input.addEventListener('input', () => renderList(input.value));
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-pick]'); if (!btn) return;
    const b = getBoxer(btn.dataset.pick);
    hidden.value = b.id; input.value = '';
    chosen.innerHTML = `<span class="picker__tag">${esc(b.name)} <span class="mono muted">(${recordStr(b)})</span><button type="button" class="picker__clear" aria-label="Clear">✕</button></span>`;
    list.hidden = true;
    chosen.querySelector('.picker__clear').addEventListener('click', () => { hidden.value = ''; chosen.innerHTML = ''; if (onPick) onPick(null); });
    if (onPick) onPick(b);
  });
  document.addEventListener('click', e => { if (!e.target.closest('[data-picker="' + id + '"]')) list.hidden = true; });
}

/* ------------------------------ render ------------------------------ */
function render() {
  const view = views[currentRoute] || views.dashboard;
  const root = $('#app-content');
  root.innerHTML = view.html(routeParams);
  window.scrollTo(0, 0);
  if (view.wire) view.wire(routeParams);
  $all('[data-link]').forEach(a => a.classList.toggle('navlink--active', a.dataset.link === currentRoute));
  updateTopbar();
}
function navigate(route, params) {
  currentRoute = route; routeParams = params || {};
  const drawer = $('.drawer'); if (drawer) drawer.classList.remove('open');
  const scrim = $('#drawer-scrim'); if (scrim) scrim.classList.remove('show');
  render();
}
function updateTopbar() {
  const d = $('#tb-date'); if (d) d.textContent = dateToStr(state.date);
  const s = $('#tb-speed'); if (s && s.value !== state.settings.speed) s.value = state.settings.speed;
}

/* =====================================================================
   VIEW: Dashboard
   ===================================================================== */
views.dashboard = {
  html() {
    const boxers = allBoxers();
    if (!boxers.length) {
      return `<div class="view">
        <header class="page-head"><div class="eyebrow">Commissioner’s desk</div><h1>Your boxing universe is empty</h1>
        <p class="lede">You are the god of this world. Nothing happens until you make it happen — every fighter, every fight, every belt is yours to create.</p></header>
        <div class="card card--cta">
          <h3>Start building</h3>
          <p>Create fighters one at a time, or generate a roster to populate divisions instantly. Records only ever change through fights you book.</p>
          <div class="btn-row">
            <button class="btn btn--primary" data-link="create">Create a fighter</button>
            <button class="btn btn--gold" id="dash-bulk">Generate a roster</button>
          </div>
        </div>
      </div>`;
    }
    const active = activeBoxers();
    let champCount = 0; const seen = new Set();
    WEIGHT_CLASSES.forEach(wc => BELTS.forEach(belt => { const id = state.champions[wc] && state.champions[wc][belt]; if (id) seen.add(id); }));
    champCount = seen.size;
    const p4p = rankBoard('p4p', { status: 'active' }, 5).rows;
    const recent = state.fights.slice().sort((a, b) => dateCompare(b.date, a.date)).slice(0, 6);
    const upcoming = state.cards.filter(c => c.status === 'scheduled').sort((a, b) => dateCompare(a.date, b.date)).slice(0, 4);

    return `<div class="view">
      <header class="page-head">
        <div class="eyebrow">Commissioner’s desk · ${esc(dateToStr(state.date))}</div>
        <h1>${esc(state.meta.universeName)}</h1>
      </header>
      <div class="stat-strip">
        <div class="stat"><span class="stat__value">${active.length}</span><span class="stat__label">Active fighters</span></div>
        <div class="stat"><span class="stat__value">${retiredBoxers().length}</span><span class="stat__label">Retired</span></div>
        <div class="stat"><span class="stat__value">${state.fights.length.toLocaleString()}</span><span class="stat__label">Fights staged</span></div>
        <div class="stat"><span class="stat__value">${champCount}</span><span class="stat__label">Champions</span></div>
      </div>
      <div class="quick-actions">
        <button class="qa" data-link="create"><span class="qa__i">＋</span>Create fighter</button>
        <button class="qa" data-link="book"><span class="qa__i">🥊</span>Book a fight</button>
        <button class="qa" data-link="time"><span class="qa__i">⏱</span>Advance time</button>
        <button class="qa" data-link="leaderboards"><span class="qa__i">≡</span>Leaderboards</button>
        <button class="qa" data-link="champions"><span class="qa__i">★</span>Champions</button>
        <button class="qa" data-link="archive"><span class="qa__i">⌸</span>Archive</button>
      </div>
      <div class="dash-grid">
        <section class="card">
          <div class="card__head"><h3>Pound-for-pound</h3><button class="link-btn" data-link="leaderboards">All boards →</button></div>
          ${p4p.length ? p4p.map((r, i) => fighterRow(r.box, `<span class="mono lb-val">${r.box.elo}</span>`, '' + (i + 1))).join('') : `<p class="muted">No active fighters yet.</p>`}
        </section>
        <section class="card">
          <div class="card__head"><h3>Latest results</h3><button class="link-btn" data-link="results">All results →</button></div>
          ${recent.length ? recent.map(f => resultLine(f)).join('') : `<p class="muted">No fights staged yet. <button class="link-btn" data-link="book">Book the first one →</button></p>`}
        </section>
        <section class="card">
          <div class="card__head"><h3>Scheduled cards</h3><button class="link-btn" data-link="cards">Fight cards →</button></div>
          ${upcoming.length ? upcoming.map(c => `<button class="evrow" data-open-card="${c.id}"><span><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.venue || 'Venue TBC')}</span></span><span class="mono">${esc(dateToStr(c.date))}</span></button>`).join('') : `<p class="muted">Nothing scheduled. Build a card and set it for a future date.</p>`}
        </section>
      </div>
    </div>`;
  },
  wire() {
    on('#dash-bulk', 'click', () => openBulkGenerate());
    $all('[data-open-card]').forEach(b => b.addEventListener('click', () => navigate('cards', { open: b.dataset.openCard })));
  }
};

/* compact result line used on dashboard/results */
function resultLine(f) {
  const a = getBoxer(f.aId), b = getBoxer(f.bId);
  if (!a || !b) return '';
  const r = f.result;
  const wName = r.draw ? null : (r.winnerId === a.id ? a.name : b.name);
  return `<button class="resrow" data-fight="${f.id}">
    <span class="resrow__main">
      <span class="resrow__names">${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)}</span>
      <span class="resrow__sub">${r.draw ? 'Draw' : esc(wName) + ' wins'} · ${esc(dateToStr(f.date))}${f.titleFight ? ' · <span class="chip chip--belt">TITLE</span>' : ''}</span>
    </span>
    ${methodBadge(r)}
  </button>`;
}

/* attribute groupings reflect how they function inside the fight engine */
const ATTR_GROUPS = [
  { name: 'Offence', keys: ['power', 'accuracy', 'jab', 'combinations', 'counterpunching', 'bodyPunching', 'killerInstinct'] },
  { name: 'Defence & Movement', keys: ['speed', 'footwork', 'defence', 'ringIQ', 'clinch'] },
  { name: 'Durability & Engine', keys: ['chin', 'stamina', 'recovery', 'cutResistance', 'heart'] },
  { name: 'Temperament', keys: ['aggression', 'discipline', 'adaptability'] }
];

function attrInfoModal() {
  openModal(`<div class="info-blocks">
    <p>Every attribute feeds the round-by-round engine. A few of the most important:</p>
    <ul class="info-list">
      <li><b>Power</b> & <b>Killer Instinct</b> — how much damage each clean shot does, and your finishing rate when an opponent is hurt.</li>
      <li><b>Accuracy</b>, <b>Jab</b>, <b>Combinations</b> — how much clean work you land. Combinations also lift your output.</li>
      <li><b>Counterpunching</b> — punishes aggressive opponents who lead; deadly against pressure and sluggers.</li>
      <li><b>Defence</b>, <b>Footwork</b>, <b>Ring IQ</b>, <b>Speed</b> — reduce what the opponent lands; elite defence can shut a fight down.</li>
      <li><b>Chin</b>, <b>Recovery</b>, <b>Heart</b> — resist knockdowns, recover between rounds, and refuse to be pulled out.</li>
      <li><b>Stamina</b> & <b>Discipline</b> — your gas tank. Fade late and you get hit more and stopped. Low discipline risks point deductions and DQ.</li>
      <li><b>Adaptability</b> — lets you solve a bad style matchup and land more as the rounds go on.</li>
      <li><b>Clinch</b> — ties up to survive when hurt and resists pressure fighters draining your tank.</li>
      <li><b>Cut Resistance</b> — fewer cuts, fewer doctor stoppages.</li>
      <li><b>Body Punching</b> — saps the opponent’s stamina and sets up late stoppages.</li>
    </ul>
    <p class="muted">Hidden stats (potential, prime age, decline age, improvement rate, durability) decide how a fighter develops and ages over the years.</p>
  </div>`, { title: 'How attributes shape a fight', wide: true });
}

/* =====================================================================
   VIEW: Create / Edit boxer
   ===================================================================== */
views.create = {
  html(params) {
    const editing = params && params.id ? getBoxer(params.id) : null;
    const b = editing || makeBoxer({ name: '', elo: 1000, followers: 0, hype: 30, credibility: 30, popularity: 30 });
    const a = b.attributes;
    const groups = ATTR_GROUPS.map(g => `<div class="attr-group"><h4 class="subhead">${g.name}</h4><div class="attr-grid">${g.keys.map(k =>
      `<label class="attr-input"><span>${esc(ATTR_LABELS[k])}</span>
        <input type="range" min="1" max="99" value="${a[k]}" id="attr-${k}" oninput="this.parentNode.querySelector('output').textContent=this.value">
        <output>${a[k]}</output></label>`).join('')}</div></div>`).join('');
    const traitChips = TRAITS.map(t => `<label class="trait-chip"><input type="checkbox" value="${esc(t)}" ${b.traits.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('');
    const h = b.hidden;

    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">${editing ? 'Edit fighter' : 'Create fighter'}</div>
        <h1>${editing ? esc(b.name || 'Fighter') : 'New fighter'}</h1>
        <p class="lede">Build a fighter from scratch at any time — drop a raw 17-year-old into a world full of veterans whenever you like.</p>
      </header>

      <section class="card">
        <h3>Identity</h3>
        <div class="form-grid">
          <div class="field"><label>Name</label><input id="f-name" value="${esc(b.name)}" placeholder="e.g. Marcus Reed"></div>
          <div class="field"><label>Nickname</label><input id="f-nick" value="${esc(b.nickname)}" placeholder="optional"></div>
          <div class="field"><label>Nationality</label><select id="f-nat">${selectOptions(NATIONALITIES, b.nationality)}</select></div>
          <div class="field"><label>Hometown</label><input id="f-home" value="${esc(b.hometown)}" placeholder="optional"></div>
          <div class="field"><label>Age</label><input id="f-age" type="number" min="16" max="50" value="${b.age}"></div>
          <div class="field"><label>Debut year</label><input id="f-debut" type="number" min="1950" max="2200" value="${b.debutYear}"></div>
          <div class="field"><label>Height (cm)</label><input id="f-height" type="number" min="140" max="230" value="${b.height}"></div>
          <div class="field"><label>Reach (cm)</label><input id="f-reach" type="number" min="140" max="250" value="${b.reach}"></div>
          <div class="field"><label>Weight class</label><select id="f-wc">${selectOptions(WEIGHT_CLASSES, b.weightClass)}</select></div>
          <div class="field"><label>Stance</label><select id="f-stance">${selectOptions(STANCES, b.stance)}</select></div>
          <div class="field"><label>Style</label><select id="f-style">${selectOptions(STYLES, b.style)}</select></div>
        </div>
      </section>

      <section class="card">
        <h3>Standing & fame</h3>
        <div class="form-grid">
          <div class="field"><label>ELO rating</label><input id="f-elo" type="number" min="650" max="2400" value="${b.elo}"><small>1000 unknown · 1300 prospect · 1500 contender · 1700 champion · 1900+ superstar</small></div>
          <div class="field"><label>Followers</label><input id="f-foll" type="number" min="0" value="${b.followers}"></div>
          <div class="field"><label>Hype</label><input id="f-hype" type="number" min="0" max="99" value="${b.hype}"></div>
          <div class="field"><label>Credibility</label><input id="f-cred" type="number" min="0" max="99" value="${b.credibility}"></div>
          <div class="field"><label>Popularity</label><input id="f-pop" type="number" min="0" max="99" value="${b.popularity}"></div>
          <div class="field"><label>Career earnings ($)</label><input id="f-earn" type="number" min="0" value="${b.earnings}"></div>
        </div>
        <h4 class="subhead">Starting record</h4>
        <div class="form-grid form-grid--rec">
          <div class="field"><label>Wins</label><input id="f-w" type="number" min="0" value="${b.record.w}"></div>
          <div class="field"><label>Losses</label><input id="f-l" type="number" min="0" value="${b.record.l}"></div>
          <div class="field"><label>Draws</label><input id="f-d" type="number" min="0" value="${b.record.d}"></div>
          <div class="field"><label>KO wins</label><input id="f-ko" type="number" min="0" value="${b.record.ko}"></div>
          <div class="field"><label>KO losses</label><input id="f-kol" type="number" min="0" value="${b.record.koLoss}"></div>
        </div>
      </section>

      <section class="card">
        <div class="card__head"><h3>Attributes</h3>
          <div class="btn-row btn-row--tight">
            <button class="btn btn--ghost btn--sm" id="attr-info">What do these do?</button>
            <button class="btn btn--ghost btn--sm" id="attr-rand">Randomise</button>
          </div>
        </div>
        <label class="trait-chip freeze-toggle"><input type="checkbox" id="f-frozen" ${b.frozen ? 'checked' : ''}><span>&#10052; Freeze attributes &mdash; lock this prime so stats never change from fights or ageing</span></label>
        ${groups}
      </section>

      <section class="card">
        <h3>Traits <span class="muted">(optional flavour)</span></h3>
        <div class="trait-wrap">${traitChips}</div>
      </section>

      <details class="card card--details">
        <summary>Advanced — development & ageing</summary>
        <div class="form-grid">
          <div class="field"><label>Potential (ceiling)</label><input id="h-pot" type="number" min="1" max="99" value="${h.potential}"></div>
          <div class="field"><label>Prime age</label><input id="h-prime" type="number" min="20" max="40" value="${h.primeAge}"></div>
          <div class="field"><label>Decline age</label><input id="h-decline" type="number" min="25" max="45" value="${h.declineAge}"></div>
          <div class="field"><label>Improvement rate</label><input id="h-imp" type="number" step="0.1" min="0.2" max="2" value="${h.improvementRate}"></div>
          <div class="field"><label>Confidence</label><input id="h-conf" type="number" min="1" max="99" value="${h.confidence}"></div>
        </div>
        <small class="muted">Two fighters of the same age can develop very differently: a high potential + improvement rate creates a late bloomer, a low decline age means an early fade.</small>
      </details>

      <div class="btn-row btn-row--end sticky-actions">
        <button class="btn btn--ghost" data-link="${editing ? 'profile' : 'database'}" ${editing ? `data-link-params='{"id":"${editing.id}"}'` : ''}>Cancel</button>
        <button class="btn btn--primary" id="f-save">${editing ? 'Save changes' : 'Create fighter'}</button>
      </div>
    </div>`;
  },
  wire(params) {
    const editing = params && params.id ? getBoxer(params.id) : null;
    on('#attr-info', 'click', attrInfoModal);
    on('#attr-rand', 'click', () => {
      const band = clamp((numv('f-elo', 1000) - 760) / 1000, 0.1, 0.95);
      const mean = 44 + band * 44, spread = 16 - band * 6;
      ATTR_KEYS.forEach(k => { const v = gaussAttr(mean, spread); const inp = $('#attr-' + k); if (inp) { inp.value = v; inp.parentNode.querySelector('output').textContent = v; } });
    });
    on('#f-save', 'click', () => {
      const name = val('f-name');
      if (!name) { toast('Give your fighter a name first.', 'warn'); $('#f-name').focus(); return; }
      const patch = readBoxerForm();
      if (editing) { updateBoxer(editing.id, patch); updatePeaks(getBoxer(editing.id)); autosave(); toast('Fighter updated.'); navigate('profile', { id: editing.id }); }
      else { const nb = addBoxer(patch); autosave(); toast('Fighter created.'); navigate('profile', { id: nb.id }); }
    });
  }
};

function readBoxerForm() {
  const attributes = {}; ATTR_KEYS.forEach(k => attributes[k] = clamp(Math.round(numv('attr-' + k, 50)), 1, 100));
  const traits = $all('.trait-wrap input:checked').map(i => i.value);
  return {
    name: val('f-name'), nickname: val('f-nick'), nationality: val('f-nat'), hometown: val('f-home'),
    age: clamp(Math.round(numv('f-age', 24)), 16, 50), debutYear: Math.round(numv('f-debut', state.date.y)),
    height: Math.round(numv('f-height', 178)), reach: Math.round(numv('f-reach', 180)),
    weightClass: val('f-wc'), stance: val('f-stance'), style: val('f-style'),
    elo: clamp(Math.round(numv('f-elo', 1000)), 650, 2400),
    followers: Math.max(0, Math.round(numv('f-foll', 0))),
    hype: clamp(Math.round(numv('f-hype', 30)), 0, 100),
    credibility: clamp(Math.round(numv('f-cred', 30)), 0, 100),
    popularity: clamp(Math.round(numv('f-pop', 30)), 0, 100),
    earnings: Math.max(0, Math.round(numv('f-earn', 0))),
    record: { w: Math.max(0, Math.round(numv('f-w', 0))), l: Math.max(0, Math.round(numv('f-l', 0))), d: Math.max(0, Math.round(numv('f-d', 0))), ko: Math.max(0, Math.round(numv('f-ko', 0))), koLoss: Math.max(0, Math.round(numv('f-kol', 0))) },
    traits,
    frozen: $('#f-frozen') ? $('#f-frozen').checked : false,
    attributes,
    hidden: { potential: clamp(Math.round(numv('h-pot', 75)), 1, 99), primeAge: Math.round(numv('h-prime', 28)), declineAge: Math.round(numv('h-decline', 34)), improvementRate: numv('h-imp', 1), confidence: clamp(Math.round(numv('h-conf', 60)), 1, 100) }
  };
}

/* =====================================================================
   VIEW: Boxer Database (browse / search / filter)
   ===================================================================== */
let dbState = { q: '', division: 'all', status: 'active', style: 'all', nat: 'all', sort: 'elo', page: 0 };
const DB_PAGE = 40;
const SORTS = { elo: ['ELO', b => b.elo], overall: ['Overall', b => overall(b)], wins: ['Wins', b => b.record.w], kos: ['KOs', b => b.record.ko], followers: ['Followers', b => b.followers], earnings: ['Earnings', b => b.earnings], legacy: ['Legacy', b => b.hidden.legacyScore], age: ['Age', b => b.age], name: ['Name', b => b.name] };

views.database = {
  html() {
    return `<div class="view">
      <header class="page-head"><div class="eyebrow">Database</div><h1>Boxer database</h1>
        <p class="lede">Every fighter you’ve created. Search, filter and dive into any profile.</p></header>
      <div class="toolbar">
        <input id="db-q" class="search" placeholder="Search name, nickname, country…" value="${esc(dbState.q)}">
        <div class="btn-row btn-row--tight">
          <button class="btn btn--primary btn--sm" data-link="create">＋ New fighter</button>
          <button class="btn btn--gold btn--sm" id="db-bulk">Generate</button>
          <button class="btn btn--ghost btn--sm" data-link="editor">Tools</button>
        </div>
      </div>
      <div class="filters">
        <label>Division<select id="db-div"><option value="all">All</option>${selectOptions(WEIGHT_CLASSES, dbState.division)}</select></label>
        <label>Status<select id="db-status"><option value="active"${dbState.status === 'active' ? ' selected' : ''}>Active</option><option value="retired"${dbState.status === 'retired' ? ' selected' : ''}>Retired</option><option value="all"${dbState.status === 'all' ? ' selected' : ''}>All</option></select></label>
        <label>Style<select id="db-style"><option value="all">All</option>${selectOptions(STYLES, dbState.style)}</select></label>
        <label>Country<select id="db-nat"><option value="all">All</option>${selectOptions(NATIONALITIES, dbState.nat)}</select></label>
        <label>Sort<select id="db-sort">${Object.keys(SORTS).map(k => `<option value="${k}"${dbState.sort === k ? ' selected' : ''}>${SORTS[k][0]}</option>`).join('')}</select></label>
      </div>
      <div id="db-results"></div>
    </div>`;
  },
  wire() {
    const refresh = () => {
      dbState.q = val('db-q'); dbState.division = val('db-div'); dbState.status = val('db-status');
      dbState.style = val('db-style'); dbState.nat = val('db-nat'); dbState.sort = val('db-sort');
      renderDbResults();
    };
    ['db-q'].forEach(id => on('#' + id, 'input', () => { dbState.page = 0; refresh(); }));
    ['db-div', 'db-status', 'db-style', 'db-nat', 'db-sort'].forEach(id => on('#' + id, 'change', () => { dbState.page = 0; refresh(); }));
    on('#db-bulk', 'click', openBulkGenerate);
    renderDbResults();
  }
};

function renderDbResults() {
  const box = $('#db-results'); if (!box) return;
  let list = applyFilters(allBoxers(), { division: dbState.division, status: dbState.status, style: dbState.style, nationality: dbState.nat });
  const q = dbState.q.toLowerCase().trim();
  if (q) list = list.filter(b => (b.name + ' ' + b.nickname + ' ' + b.nationality + ' ' + b.hometown).toLowerCase().includes(q));
  const sorter = SORTS[dbState.sort][1];
  list.sort((a, b) => dbState.sort === 'name' ? sorter(a).localeCompare(sorter(b)) : sorter(b) - sorter(a));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / DB_PAGE));
  dbState.page = clamp(dbState.page, 0, pages - 1);
  const slice = list.slice(dbState.page * DB_PAGE, dbState.page * DB_PAGE + DB_PAGE);

  if (!total) { box.innerHTML = `<div class="empty">No fighters match. <button class="link-btn" data-link="create">Create one →</button></div>`; return; }
  box.innerHTML = `<div class="result-count">${total} fighter${total === 1 ? '' : 's'}</div>
    <div class="grid grid--cards">${slice.map(fighterCard).join('')}</div>
    ${pages > 1 ? `<div class="pager">
      <button class="btn btn--ghost btn--sm" id="db-prev" ${dbState.page === 0 ? 'disabled' : ''}>← Prev</button>
      <span class="mono">Page ${dbState.page + 1} / ${pages}</span>
      <button class="btn btn--ghost btn--sm" id="db-next" ${dbState.page >= pages - 1 ? 'disabled' : ''}>Next →</button>
    </div>` : ''}`;
  on('#db-prev', 'click', () => { dbState.page--; renderDbResults(); });
  on('#db-next', 'click', () => { dbState.page++; renderDbResults(); });
}

/* ----- bulk generate modal (used from several places) ----- */
function openBulkGenerate() {
  openModal(`<div class="form-grid">
      <div class="field"><label>How many?</label><input id="bg-n" type="number" min="1" max="500" value="24"></div>
      <div class="field"><label>Division</label><select id="bg-div"><option value="all">Mixed (all)</option>${selectOptions(WEIGHT_CLASSES, '')}</select></div>
      <div class="field"><label>Nationality</label><select id="bg-nat"><option value="all">Mixed</option>${selectOptions(NATIONALITIES, '')}</select></div>
      <div class="field"><label>Talent level</label><select id="bg-band">
        <option value="mixed">Mixed (full spread)</option>
        <option value="prospect">Mostly prospects</option>
        <option value="contender">Contender level</option>
        <option value="elite">Elite</option>
      </select></div>
      <div class="field"><label>Career</label><select id="bg-vet">
        <option value="0">Debutants (0-0)</option>
        <option value="1">Veterans (give a record)</option>
      </select></div>
    </div>
    <label class="trait-chip" style="margin-top:8px"><input type="checkbox" id="bg-young"><span>Lean young (ages 18–26)</span></label>
    <div class="btn-row btn-row--end" style="margin-top:14px">
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn btn--primary" id="bg-go">Generate</button>
    </div>`, { title: 'Generate fighters' });
  on('#bg-go', 'click', () => {
    const n = clamp(Math.round(numv('bg-n', 24)), 1, 500);
    const div = val('bg-div'), nat = val('bg-nat'), bandSel = val('bg-band'), vet = val('bg-vet') === '1', young = $('#bg-young').checked;
    const made = [];
    for (let i = 0; i < n; i++) {
      const opts = { veteran: vet };
      if (div !== 'all') opts.weightClass = div;
      if (nat !== 'all') opts.nationality = nat;
      if (bandSel === 'prospect') opts.band = rnd(0.3, 0.6);
      else if (bandSel === 'contender') opts.band = rnd(0.55, 0.8);
      else if (bandSel === 'elite') opts.band = rnd(0.82, 0.97);
      if (young) opts.age = rndi(18, 26);
      made.push(addBoxer(randomBoxer(opts)));
    }
    autosave(); closeModal(); toast(`Generated ${made.length} fighters.`);
    if (currentRoute === 'database') renderDbResults(); else navigate('database');
  });
}

/* =====================================================================
   VIEW: Database Editor (universe tools)
   ===================================================================== */
views.editor = {
  html() {
    const kb = storageFootprintKB();
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">Tools</div><h1>Database editor</h1>
        <p class="lede">Build the universe in bulk, move fighters in and out as JSON, and manage your save.</p></header>

      <section class="card">
        <h3>Universe</h3>
        <div class="field"><label>Universe name</label><input id="ed-name" value="${esc(state.meta.universeName)}"></div>
        <div class="btn-row"><button class="btn btn--primary btn--sm" id="ed-rename">Rename</button></div>
      </section>

      <section class="card">
        <h3>Roster</h3>
        <p class="muted">Generate fighters into your world, or move fighters between universes as JSON.</p>
        <div class="btn-row">
          <button class="btn btn--gold" id="ed-gen">Generate fighters</button>
          <button class="btn btn--ghost" id="ed-import-fighters">Import fighters</button>
          <button class="btn btn--ghost" id="ed-export-fighters">Export all fighters</button>
        </div>
      </section>

      <section class="card">
        <h3>Backup & restore</h3>
        <p class="muted">Your universe autosaves in this browser. For long-term safety across months, export a JSON backup you can re-import anywhere.</p>
        <div class="btn-row">
          <button class="btn btn--primary" id="ed-export-uni">Export universe</button>
          <button class="btn btn--ghost" id="ed-import-uni">Import universe</button>
        </div>
        <label class="trait-chip" style="margin-top:10px"><input type="checkbox" id="ed-autosave" ${state.settings.autosave ? 'checked' : ''}><span>Autosave after every change</span></label>
        <div class="storage-note">
          <span>Save size: <b class="mono">${kb} KB</b> of ~5 MB</span>
          ${state.settings.compactSaved ? '<span class="warn-note">Old round-by-round detail was trimmed to save space. Export a backup to keep full detail.</span>' : ''}
        </div>
      </section>

      <section class="card card--danger">
        <h3>Danger zone</h3>
        <p class="muted">Reset wipes every fighter, fight and belt and starts a brand-new universe. This cannot be undone.</p>
        <button class="btn btn--danger" id="ed-reset">Reset universe</button>
      </section>
      <input type="file" id="ed-file" accept="application/json" hidden>
    </div>`;
  },
  wire() {
    on('#ed-rename', 'click', () => { state.meta.universeName = val('ed-name') || 'Boxing Universe'; autosave(); toast('Universe renamed.'); });
    on('#ed-gen', 'click', openBulkGenerate);
    on('#ed-export-fighters', 'click', () => { const ids = allBoxers().map(b => b.id); if (!ids.length) return toast('No fighters to export.', 'warn'); exportBoxers(ids); toast('Exported fighters.'); });
    on('#ed-export-uni', 'click', () => { exportUniverse(); toast('Universe exported.'); });
    on('#ed-autosave', 'change', e => { state.settings.autosave = e.target.checked; saveUniverse(); toast(e.target.checked ? 'Autosave on.' : 'Autosave off.'); });

    on('#ed-import-fighters', 'click', () => openImportModal('fighters'));
    on('#ed-import-uni', 'click', () => openImportModal('universe'));

    on('#ed-reset', 'click', () => confirmModal('This permanently deletes every fighter, fight, belt and record, and starts a new empty universe.', () => { resetUniverse(); toast('Universe reset.'); navigate('dashboard'); }, { danger: true, confirmLabel: 'Reset everything', title: 'Reset universe?' }));
  }
};

function openImportModal(kind) {
  const title = kind === 'universe' ? 'Import universe' : 'Import fighters';
  const warn = kind === 'universe' ? '<p class="warn-note">Importing a universe replaces everything currently in this browser. Export a backup first if you want to keep it.</p>' : '<p class="muted">Imported fighters arrive as fresh fighters in this universe (belts and fight history are not carried over).</p>';
  openModal(`${warn}
    <div class="field"><label>Choose a JSON file</label><input type="file" id="im-file" accept="application/json"></div>
    <div class="or-line">or paste JSON</div>
    <textarea id="im-text" class="code-area" placeholder='{ "boxers": [ … ] }'></textarea>
    <div class="btn-row btn-row--end" style="margin-top:12px">
      <button class="btn btn--ghost" data-close-modal>Cancel</button>
      <button class="btn ${kind === 'universe' ? 'btn--danger' : 'btn--primary'}" id="im-go">Import</button>
    </div>`, { title });

  const doImport = (text) => {
    try {
      if (kind === 'universe') {
        const parsed = JSON.parse(text);
        if (!parsed.boxers) throw new Error('Not a universe file.');
        replaceState(migrateState(parsed)); saveUniverse();
        closeModal(); toast('Universe imported.'); navigate('dashboard');
      } else {
        const added = importBoxersFromText(text);
        closeModal(); toast(`Imported ${added.length} fighter${added.length === 1 ? '' : 's'}.`); navigate('database');
      }
    } catch (err) { toast('Import failed: ' + err.message, 'warn'); }
  };
  on('#im-file', 'change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => doImport(r.result); r.readAsText(f); });
  on('#im-go', 'click', () => { const t = val('im-text'); if (!t) return toast('Paste some JSON or choose a file.', 'warn'); doImport(t); });
}

/* create -> simulate -> apply a fight, returning the completed fight */
function stageFight(aId, bId, opts) {
  opts = opts || {};
  const a = getBoxer(aId), b = getBoxer(bId);
  const fight = {
    id: genId('fight'), cardId: opts.cardId || null, date: opts.date || cloneDate(state.date),
    eventName: opts.eventName || '', venue: opts.venue || '',
    aId, bId, weightClass: opts.weightClass || a.weightClass, rounds: opts.rounds || 12,
    titleFight: !!opts.titleFight, belts: (opts.belts || []).slice(), result: null, simulated: false
  };
  fight.result = simulateFight(a, b, { rounds: fight.rounds, titleFight: fight.titleFight });
  applyFightResult(fight);
  return fight;
}

function showFightResult(fight) { openModal(renderFightDetail(fight), { title: 'Result', wide: true }); }

/* =====================================================================
   VIEW: Book Fight (instant single bout on the current date)
   ===================================================================== */
views.book = {
  html() {
    if (activeBoxers().length < 2) {
      return `<div class="view"><header class="page-head"><div class="eyebrow">Matchmaking</div><h1>Book a fight</h1></header>
        <div class="empty">You need at least two active fighters. <button class="link-btn" data-link="create">Create fighters →</button> or <button class="link-btn" id="bk-gen">generate a roster</button>.</div></div>`;
    }
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">Matchmaking · ${esc(dateToStr(state.date))}</div><h1>Book a fight</h1>
        <p class="lede">Pick the matchup and the stakes. The bigger the names and the belts, the bigger the swing in ELO, fame and money.</p></header>

      <section class="card">
        <div class="form-grid form-grid--2">
          <div class="field"><label>Corner A</label>${fighterPicker('bk-a', { placeholder: 'Search fighter A…' })}</div>
          <div class="field"><label>Corner B</label>${fighterPicker('bk-b', { placeholder: 'Search fighter B…' })}</div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Weight class</label><select id="bk-wc">${selectOptions(WEIGHT_CLASSES, 'Lightweight')}</select></div>
          <div class="field"><label>Scheduled rounds</label><select id="bk-rounds"><option>4</option><option>6</option><option>8</option><option>10</option><option selected>12</option></select></div>
          <div class="field"><label>Event name</label><input id="bk-event" placeholder="optional"></div>
          <div class="field"><label>Venue</label><input id="bk-venue" placeholder="optional"></div>
        </div>
        <label class="trait-chip"><input type="checkbox" id="bk-title"><span>Title fight</span></label>
        <div id="bk-belts" class="belts-pick" hidden></div>
      </section>

      <div id="bk-estimate"></div>

      <div class="btn-row btn-row--end sticky-actions">
        <button class="btn btn--ghost" id="bk-card">Add to a card</button>
        <button class="btn btn--primary" id="bk-sim">Simulate now</button>
      </div>
    </div>`;
  },
  wire() {
    on('#bk-gen', 'click', openBulkGenerate);
    let A = null, B = null;
    const wc = () => val('bk-wc');
    const refreshBelts = () => {
      const box = $('#bk-belts'); const title = $('#bk-title').checked;
      box.hidden = !title;
      if (!title) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="subhead">Belts on the line — winner takes them</div><div class="belts-row">` + BELTS.map(belt => {
        const champId = state.champions[wc()] && state.champions[wc()][belt];
        const champ = champId ? getBoxer(champId) : null;
        return `<label class="trait-chip"><input type="checkbox" class="bk-belt" value="${esc(belt)}"><span>${esc(belt)}${champ ? ` <em class="muted">(${esc(champ.name.split(' ').pop())})</em>` : ' <em class="muted">(vacant)</em>'}</span></label>`;
      }).join('') + `</div>`;
    };
    const refreshEstimate = () => {
      const box = $('#bk-estimate');
      A = val('bk-a-value') ? getBoxer(val('bk-a-value')) : null;
      B = val('bk-b-value') ? getBoxer(val('bk-b-value')) : null;
      if (!A || !B || A.id === B.id) { box.innerHTML = A && B && A.id === B.id ? `<div class="note">Pick two different fighters.</div>` : ''; return; }
      const belts = $all('.bk-belt:checked').map(i => i.value);
      const opts = { rounds: parseInt(val('bk-rounds'), 10), titleFight: $('#bk-title').checked, belts, weightClass: wc() };
      const est = estimateFight(A, B, opts);
      const favIsA = est.favId === A.id;
      box.innerHTML = `${taleOfTape(A, B, { winA: est.winA })}
        <section class="card est-card">
          <h3>Forecast</h3>
          <div class="est-grid">
            <div class="est"><span class="est__v mono">${est.stoppagePct}%</span><span class="est__l">Stoppage chance</span></div>
            <div class="est"><span class="est__v mono">${est.decisionPct}%</span><span class="est__l">Goes to decision</span></div>
            <div class="est"><span class="est__v mono">${est.hype}</span><span class="est__l">Hype rating</span></div>
            <div class="est"><span class="est__v mono">${fmtMoney(est.purseEst)}</span><span class="est__l">Combined purse</span></div>
            <div class="est"><span class="est__v">${delta(est.favReward)}</span><span class="est__l">ELO if ${esc((favIsA ? A : B).name.split(' ').pop())} wins</span></div>
            <div class="est"><span class="est__v">${delta(-est.favRisk)}</span><span class="est__l">ELO if ${esc((favIsA ? A : B).name.split(' ').pop())} loses</span></div>
            <div class="est"><span class="est__v mono">${fmtFollowers(est.social.a)}</span><span class="est__l">${esc(A.name.split(' ').pop())} fan swing</span></div>
            <div class="est"><span class="est__v mono">${fmtFollowers(est.social.b)}</span><span class="est__l">${esc(B.name.split(' ').pop())} fan swing</span></div>
          </div>
        </section>`;
    };
    wireFighterPicker('bk-a', b => { if (b) $('#bk-wc').value = b.weightClass; refreshBelts(); refreshEstimate(); }, { division: () => 'all' });
    wireFighterPicker('bk-b', () => refreshEstimate(), { division: () => 'all' });
    ['bk-wc', 'bk-rounds'].forEach(id => on('#' + id, 'change', () => { refreshBelts(); refreshEstimate(); }));
    on('#bk-title', 'change', () => { refreshBelts(); refreshEstimate(); });
    $('#bk-belts').addEventListener('change', refreshEstimate);

    on('#bk-sim', 'click', () => {
      const aId = val('bk-a-value'), bId = val('bk-b-value');
      if (!aId || !bId) return toast('Pick both fighters.', 'warn');
      if (aId === bId) return toast('A fighter cannot fight themselves.', 'warn');
      const belts = $all('.bk-belt:checked').map(i => i.value);
      const f = stageFight(aId, bId, { rounds: parseInt(val('bk-rounds'), 10), titleFight: $('#bk-title').checked, belts, weightClass: wc(), eventName: val('bk-event'), venue: val('bk-venue') });
      autosave(); showFightResult(f);
    });
    on('#bk-card', 'click', () => {
      const aId = val('bk-a-value'), bId = val('bk-b-value');
      if (!aId || !bId || aId === bId) return toast('Pick two different fighters first.', 'warn');
      addBoutToCardFlow({ aId, bId, weightClass: wc(), rounds: parseInt(val('bk-rounds'), 10), titleFight: $('#bk-title').checked, belts: $all('.bk-belt:checked').map(i => i.value) });
    });
  }
};

/* ----- date <-> input helpers ----- */
function dateToInput(d) { return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`; }
function parseDateInput(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return cloneDate(state.date); return { y: +m[1], m: +m[2], d: +m[3] }; }

function createCard(name, venue, date) {
  const c = { id: genId('card'), name: name || 'Untitled Card', venue: venue || '', date: date || cloneDate(state.date), status: 'draft', bouts: [] };
  state.cards.push(c); return c;
}

/* compact bout builder used to add a bout to a card */
function openBoutBuilder(card) {
  openModal(`<div class="form-grid form-grid--2">
      <div class="field"><label>Corner A</label>${fighterPicker('cb-a', { placeholder: 'Fighter A…' })}</div>
      <div class="field"><label>Corner B</label>${fighterPicker('cb-b', { placeholder: 'Fighter B…' })}</div>
    </div>
    <div class="form-grid">
      <div class="field"><label>Weight class</label><select id="cb-wc">${selectOptions(WEIGHT_CLASSES, 'Lightweight')}</select></div>
      <div class="field"><label>Rounds</label><select id="cb-rounds"><option>4</option><option>6</option><option>8</option><option>10</option><option selected>12</option></select></div>
    </div>
    <label class="trait-chip"><input type="checkbox" id="cb-title"><span>Title fight</span></label>
    <div id="cb-belts" class="belts-pick" hidden></div>
    <div class="btn-row btn-row--end" style="margin-top:12px"><button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="cb-add">Add bout</button></div>`, { title: 'Add a bout to ' + card.name });
  const wc = () => val('cb-wc');
  const refreshBelts = () => { const box = $('#cb-belts'); box.hidden = !$('#cb-title').checked; if (box.hidden) { box.innerHTML = ''; return; } box.innerHTML = `<div class="belts-row">` + BELTS.map(belt => { const champId = state.champions[wc()] && state.champions[wc()][belt]; const champ = champId ? getBoxer(champId) : null; return `<label class="trait-chip"><input type="checkbox" class="cb-belt" value="${esc(belt)}"><span>${esc(BELT_SHORT[belt])}${champ ? ` <em class="muted">(${esc(champ.name.split(' ').pop())})</em>` : ''}</span></label>`; }).join('') + `</div>`; };
  wireFighterPicker('cb-a', b => { if (b) $('#cb-wc').value = b.weightClass; refreshBelts(); }, { division: () => 'all' });
  wireFighterPicker('cb-b', null, { division: () => 'all' });
  on('#cb-title', 'change', refreshBelts); on('#cb-wc', 'change', refreshBelts);
  on('#cb-add', 'click', () => {
    const aId = val('cb-a-value'), bId = val('cb-b-value');
    if (!aId || !bId || aId === bId) return toast('Pick two different fighters.', 'warn');
    card.bouts.push({ aId, bId, weightClass: wc(), rounds: parseInt(val('cb-rounds'), 10), titleFight: $('#cb-title').checked, belts: $all('.cb-belt:checked').map(i => i.value), fightId: null });
    autosave(); closeModal(); toast('Bout added.'); navigate('cards', { open: card.id });
  });
}

function addBoutToCardFlow(bout) {
  const drafts = state.cards.filter(c => c.status === 'draft');
  openModal(`<div class="field"><label>Add to card</label><select id="ac-card">
      ${drafts.map(c => `<option value="${c.id}">${esc(c.name)} (${c.bouts.length} bouts)</option>`).join('')}
      <option value="__new">+ New card…</option></select></div>
    <div id="ac-new" ${drafts.length ? 'hidden' : ''}>
      <div class="field"><label>Card name</label><input id="ac-name" placeholder="e.g. Fight Night"></div>
      <div class="field"><label>Venue</label><input id="ac-venue" placeholder="optional"></div>
    </div>
    <div class="btn-row btn-row--end"><button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="ac-go">Add bout</button></div>`, { title: 'Add to a card' });
  const sel = $('#ac-card');
  const toggle = () => { $('#ac-new').hidden = sel.value !== '__new'; };
  if (sel) { sel.addEventListener('change', toggle); if (!drafts.length) sel.value = '__new'; toggle(); }
  on('#ac-go', 'click', () => {
    let card = (!sel || sel.value === '__new') ? createCard(val('ac-name'), val('ac-venue')) : state.cards.find(c => c.id === sel.value);
    card.bouts.push(Object.assign({ fightId: null }, bout));
    autosave(); closeModal(); toast('Bout added to ' + card.name + '.'); navigate('cards', { open: card.id });
  });
}

function boutPositionLabel(i, total) {
  if (i === total - 1) return 'Main Event';
  if (i === total - 2) return 'Co-Main Event';
  return 'Bout ' + (i + 1);
}

function simulateCard(card) {
  if (!card.bouts.length) return toast('Add at least one bout first.', 'warn');
  const pending = card.bouts.filter(bt => !bt.fightId);
  pending.forEach(bt => {
    const f = stageFight(bt.aId, bt.bId, { rounds: bt.rounds, titleFight: bt.titleFight, belts: bt.belts, weightClass: bt.weightClass, eventName: card.name, venue: card.venue, date: card.date, cardId: card.id });
    bt.fightId = f.id;
  });
  card.status = 'completed';
  autosave();
  const fights = card.bouts.map(bt => state.fights.find(f => f.id === bt.fightId)).filter(Boolean);
  openModal(`<div class="card-result-head"><h2>${esc(card.name)}</h2><p class="muted">${esc(card.venue || '')} · ${esc(dateToStr(card.date))}</p></div>
    ${fights.slice().reverse().map((f, i) => `<div class="bout-result"><span class="bout-pos">${boutPositionLabel(fights.length - 1 - i, fights.length)}</span>${resultLine(f)}</div>`).join('')}`, { title: 'Card results', wide: true });
  // re-render underlying view
  if (currentRoute === 'cards') setTimeout(() => navigate('cards', { open: card.id }), 0);
}

/* =====================================================================
   VIEW: Fight Cards
   ===================================================================== */
views.cards = {
  html(params) {
    const open = params && params.open ? state.cards.find(c => c.id === params.open) : null;
    const byStatus = s => state.cards.filter(c => c.status === s).sort((a, b) => dateCompare(b.date, a.date));
    const cardRow = c => `<button class="evrow" data-open-card="${c.id}">
      <span><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.venue || 'Venue TBC')} · ${c.bouts.length} bout${c.bouts.length === 1 ? '' : 's'}</span></span>
      <span class="mono">${esc(dateToStr(c.date))}</span></button>`;
    const section = (title, list, emptyMsg) => `<section class="card"><h3>${title}</h3>${list.length ? list.map(cardRow).join('') : `<p class="muted">${emptyMsg}</p>`}</section>`;

    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">Promotions</div><h1>Fight cards</h1>
        <p class="lede">Group bouts into a card, then run the whole card at once — or schedule it for a date and let time roll round to it.</p></header>
      <div class="btn-row"><button class="btn btn--primary" id="cd-new">＋ New card</button></div>
      ${open ? renderCardDetail(open) : ''}
      ${section('Draft cards', byStatus('draft'), 'No drafts. Create a card and start adding bouts.')}
      ${section('Scheduled', byStatus('scheduled'), 'Nothing scheduled.')}
      ${section('Completed', byStatus('completed').slice(0, 25), 'No cards have been run yet.')}
    </div>`;
  },
  wire(params) {
    on('#cd-new', 'click', () => {
      openModal(`<div class="field"><label>Card name</label><input id="nc-name" placeholder="e.g. Fight Night LHR"></div>
        <div class="field"><label>Venue</label><input id="nc-venue" placeholder="optional"></div>
        <div class="field"><label>Date</label><input id="nc-date" type="date" value="${dateToInput(state.date)}"></div>
        <div class="btn-row btn-row--end"><button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--primary" id="nc-go">Create card</button></div>`, { title: 'New card' });
      on('#nc-go', 'click', () => { const c = createCard(val('nc-name'), val('nc-venue'), parseDateInput(val('nc-date'))); autosave(); closeModal(); navigate('cards', { open: c.id }); });
    });
    $all('[data-open-card]').forEach(b => b.addEventListener('click', () => navigate('cards', { open: b.dataset.openCard })));

    const open = params && params.open ? state.cards.find(c => c.id === params.open) : null;
    if (!open) return;
    on('#card-addbout', 'click', () => openBoutBuilder(open));
    on('#card-sim', 'click', () => confirmModal(`Run all bouts on <b>${esc(open.name)}</b>? This updates every fighter’s record, ELO, fame and earnings.`, () => simulateCard(open), { confirmLabel: 'Run the card' }));
    on('#card-delete', 'click', () => confirmModal(`Delete the card <b>${esc(open.name)}</b>? ${open.status === 'completed' ? 'The fight results already happened and will remain in history.' : 'Its bouts have not been run, so nothing is lost.'}`, () => { state.cards = state.cards.filter(c => c.id !== open.id); autosave(); toast('Card deleted.'); navigate('cards'); }, { danger: true, confirmLabel: 'Delete card' }));
    on('#card-schedule', 'click', () => { open.date = parseDateInput(val('card-date')); open.status = 'scheduled'; autosave(); toast('Card scheduled for ' + dateToStr(open.date) + '.'); navigate('cards', { open: open.id }); });
    on('#card-unschedule', 'click', () => { open.status = 'draft'; autosave(); navigate('cards', { open: open.id }); });
    $all('[data-remove-bout]').forEach(btn => btn.addEventListener('click', () => { open.bouts.splice(parseInt(btn.dataset.removeBout, 10), 1); autosave(); navigate('cards', { open: open.id }); }));
    $all('[data-bout-fight]').forEach(btn => btn.addEventListener('click', () => { const f = state.fights.find(x => x.id === btn.dataset.boutFight); if (f) showFightResult(f); }));
  }
};

function renderCardDetail(card) {
  const total = card.bouts.length;
  const done = card.status === 'completed';
  const bouts = card.bouts.map((bt, i) => {
    const a = getBoxer(bt.aId), b = getBoxer(bt.bId);
    if (!a || !b) return `<div class="bout-row bout-row--bad">A fighter in this bout was deleted. <button class="link-btn" data-remove-bout="${i}">Remove</button></div>`;
    const f = bt.fightId ? state.fights.find(x => x.id === bt.fightId) : null;
    return `<div class="bout-row">
      <span class="bout-pos">${boutPositionLabel(i, total)}${bt.titleFight ? ' · <span class="chip chip--belt">TITLE</span>' : ''}</span>
      <span class="bout-names">${esc(a.name)} <span class="muted">vs</span> ${esc(b.name)} <span class="muted mono">· ${esc(WEIGHT_CLASS_SHORT[bt.weightClass])} · ${bt.rounds}rds</span></span>
      <span class="bout-act">${f ? `<button class="btn btn--ghost btn--xs" data-bout-fight="${f.id}">${methodBadge(f.result)}</button>` : `<button class="icon-btn" data-remove-bout="${i}" title="Remove bout">✕</button>`}</span>
    </div>`;
  }).join('');

  return `<section class="card card--open">
    <div class="card__head"><h3>${esc(card.name)} <span class="chip chip--${card.status}">${card.status}</span></h3>
      <button class="link-btn" data-link="cards">Close</button></div>
    <p class="muted">${esc(card.venue || 'Venue TBC')} · ${esc(dateToStr(card.date))}</p>
    <div class="bouts">${total ? bouts : '<p class="muted">No bouts yet.</p>'}</div>
    ${!done ? `<div class="btn-row" style="margin-top:12px">
        <button class="btn btn--ghost btn--sm" id="card-addbout">＋ Add bout</button>
        ${total ? `<button class="btn btn--primary btn--sm" id="card-sim">Run the card now</button>` : ''}
      </div>
      <div class="schedule-row">
        <input id="card-date" type="date" value="${dateToInput(card.date)}">
        ${card.status === 'scheduled' ? `<button class="btn btn--ghost btn--sm" id="card-unschedule">Move to draft</button>` : `<button class="btn btn--gold btn--sm" id="card-schedule">Schedule for date</button>`}
        <button class="btn btn--danger btn--sm" id="card-delete">Delete</button>
      </div>` : `<div class="btn-row" style="margin-top:12px"><button class="btn btn--danger btn--sm" id="card-delete">Delete card</button></div>`}
  </section>`;
}

/* =====================================================================
   VIEW: Simulate Time
   ===================================================================== */
const SPEED_INFO = {
  manual: 'You run every card yourself. Nothing simulates automatically.',
  slow: 'Scheduled cards run automatically when their date arrives.',
  fast: 'Scheduled cards run automatically as you advance, no prompts.',
  instant: 'Jump through time; due cards resolve instantly in the background.'
};
views.time = {
  html() {
    const upcoming = state.cards.filter(c => c.status === 'scheduled').sort((a, b) => dateCompare(a.date, b.date));
    const due = upcoming.filter(c => dateCompare(c.date, state.date) <= 0);
    const years = Object.keys(state.awards).map(Number).sort((a, b) => b - a).slice(0, 6);
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">The clock</div><h1>Simulate time</h1></header>

      <section class="card date-card">
        <div class="date-big mono">${esc(dateToStr(state.date))}</div>
        <div class="advance-grid">
          <button class="btn btn--ghost" data-adv="day">+1 day</button>
          <button class="btn btn--ghost" data-adv="week">+1 week</button>
          <button class="btn btn--ghost" data-adv="month">+1 month</button>
          <button class="btn btn--ghost" data-adv="quarter">+3 months</button>
          <button class="btn btn--gold" data-adv="year">+1 year</button>
        </div>
        ${due.length ? `<p class="note note--warn">${due.length} scheduled card${due.length === 1 ? '' : 's'} ${due.length === 1 ? 'is' : 'are'} due. ${state.settings.speed === 'manual' ? 'In manual mode they wait for you to run them.' : 'They will run automatically as you advance.'}</p>` : ''}
      </section>

      <section class="card">
        <h3>Simulation speed</h3>
        <div class="speed-row">
          ${['manual', 'slow', 'fast', 'instant'].map(s => `<button class="speed-btn ${state.settings.speed === s ? 'speed-btn--on' : ''}" data-speed="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
        </div>
        <p class="muted" id="speed-info">${esc(SPEED_INFO[state.settings.speed])}</p>
      </section>

      <section class="card">
        <h3>Scheduled cards</h3>
        ${upcoming.length ? upcoming.slice(0, 8).map(c => `<button class="evrow" data-open-card="${c.id}"><span><strong>${esc(c.name)}</strong><br><span class="muted">${c.bouts.length} bouts · ${esc(c.venue || 'Venue TBC')}</span></span><span class="mono ${dateCompare(c.date, state.date) <= 0 ? 'due' : ''}">${esc(dateToStr(c.date))}</span></button>`).join('') : '<p class="muted">Nothing scheduled. Build a card and set it for a future date.</p>'}
      </section>

      <section class="card info-card">
        <h3>What happens as time passes</h3>
        <ul class="info-list">
          <li>Fighters age on 1 January each year. Young fighters develop toward their potential; older or damaged fighters decline — each on their own curve.</li>
          <li>Year-end awards are decided automatically from the fights you staged that year.</li>
          <li>Records, ELO and fame never change on their own — only through fights you book.</li>
        </ul>
        ${years.length ? `<div class="pill-row">${years.map(y => `<button class="pill" data-link="awards" data-link-params='{"year":${y}}'>${y} awards</button>`).join('')}</div>` : ''}
      </section>
    </div>`;
  },
  wire() {
    $all('[data-adv]').forEach(b => b.addEventListener('click', () => advanceTime(b.dataset.adv)));
    $all('[data-speed]').forEach(b => b.addEventListener('click', () => {
      const s = b.dataset.speed; state.settings.speed = s; state.settings.autoSimScheduled = (s !== 'manual'); autosave();
      $all('[data-speed]').forEach(x => x.classList.toggle('speed-btn--on', x.dataset.speed === s));
      $('#speed-info').textContent = SPEED_INFO[s]; updateTopbar();
    }));
    $all('[data-open-card]').forEach(b => b.addEventListener('click', () => navigate('cards', { open: b.dataset.openCard })));
  }
};

/* =====================================================================
   Fight detail (used in modals from Results / Cards / Profile)
   ===================================================================== */
function statCompare(label, av, bv, fmt) {
  const max = Math.max(av, bv, 1);
  const aw = Math.round((av / max) * 100), bw = Math.round((bv / max) * 100);
  const f = fmt || (x => x);
  return `<div class="sc-row"><span class="sc-a mono">${f(av)}</span>
    <span class="sc-bars"><span class="sc-bar sc-bar--a"><span style="width:${aw}%"></span></span><span class="sc-k">${esc(label)}</span><span class="sc-bar sc-bar--b"><span style="width:${bw}%"></span></span></span>
    <span class="sc-b mono">${f(bv)}</span></div>`;
}
function attrChangeChips(map) {
  const keys = Object.keys(map || {}).filter(k => Math.abs(map[k]) >= 0.1);
  if (!keys.length) return '<span class="muted">No notable change</span>';
  return keys.map(k => `<span class="chip ${map[k] > 0 ? 'chip--up' : 'chip--down'}">${esc(ATTR_LABELS[k] || k)} ${map[k] > 0 ? '+' : ''}${map[k]}</span>`).join('');
}

function renderFightDetail(f) {
  const a = getBoxer(f.aId), b = getBoxer(f.bId);
  if (!a || !b) return '<p class="muted">One of these fighters no longer exists.</p>';
  const r = f.result, sa = r.stats.a, sb = r.stats.b;
  const winner = r.draw ? null : getBoxer(r.winnerId);
  const banner = r.draw
    ? `<div class="result-banner result-banner--draw">DRAW · ${esc(r.method)}</div>`
    : `<div class="result-banner"><span class="rb-win">${esc(winner.name)}</span><span class="rb-method">def. ${esc((winner.id === a.id ? b : a).name)} · ${esc(r.method)}${r.timeStr !== 'Decision' ? ` · ${esc(r.timeStr)} of R${r.round}` : ''}</span></div>`;

  const cards = `<div class="scorecards">${r.scorecards.map(c => `<div class="judgecard"><span class="jc-name">${esc(c.name)}</span><span class="jc-score mono">${c.a}–${c.b}</span></div>`).join('')}</div>`;

  const stats = `<div class="stat-compare">
    ${statCompare('Punches thrown', sa.thrown, sb.thrown)}
    ${statCompare('Landed', sa.landed, sb.landed)}
    ${statCompare('Power shots', sa.power, sb.power)}
    ${statCompare('Body shots', sa.body, sb.body)}
    ${statCompare('Counters', sa.counters, sb.counters)}
    ${statCompare('Connect %', sa.thrown ? Math.round(sa.landed / sa.thrown * 100) : 0, sb.thrown ? Math.round(sb.landed / sb.thrown * 100) : 0, x => x + '%')}
  </div>`;

  const roundTable = (r.rounds && r.rounds.length) ? `<details class="rounds-details"><summary>Round by round</summary>
    <table class="rounds-table"><thead><tr><th>R</th><th>${esc(a.name.split(' ').pop())}</th><th>${esc(b.name.split(' ').pop())}</th><th></th></tr></thead><tbody>
    ${r.rounds.map((rd, i) => `<tr class="${rd.win === 'A' ? 'rt-a' : rd.win === 'B' ? 'rt-b' : ''}">
      <td class="mono">${i + 1}</td><td class="mono">${rd.a.l}/${rd.a.t}</td><td class="mono">${rd.b.l}/${rd.b.t}</td>
      <td class="rt-notes">${rd.kdB ? `<span class="chip chip--ko">${esc(a.name.split(' ').pop())} KD${rd.kdB > 1 ? '×' + rd.kdB : ''}</span>` : ''}${rd.kdA ? `<span class="chip chip--ko">${esc(b.name.split(' ').pop())} KD${rd.kdA > 1 ? '×' + rd.kdA : ''}</span>` : ''}${rd.cutA ? '<span class="chip chip--muted">cut A</span>' : ''}${rd.cutB ? '<span class="chip chip--muted">cut B</span>' : ''}${rd.endRound ? '<span class="chip chip--ko">stoppage</span>' : ''}</td></tr>`).join('')}
    </tbody></table></details>` : '';

  const ch = r;
  const changesCol = (who, side) => `<div class="changes-col">
    <button class="changes-name" data-profile="${who.id}">${esc(who.name)}</button>
    <div class="change-line">ELO ${delta(ch.eloChange[side])}</div>
    <div class="change-line">Followers ${delta(ch.followerChange[side])}</div>
    <div class="change-line">Hype ${delta(ch.hypeChange[side])} · Cred ${delta(ch.credChange[side])} · Pop ${delta(ch.popChange[side])}</div>
    <div class="change-line">Purse <span class="mono gold">${fmtMoney(ch.purse ? ch.purse[side] : 0)}</span></div>
    <div class="change-attrs">${attrChangeChips(ch.attrChange ? ch.attrChange[side] : {})}</div>
  </div>`;

  return `<div class="fight-detail">
    <div class="fd-meta">${f.eventName ? `<strong>${esc(f.eventName)}</strong> · ` : ''}${esc(f.venue || '')}${f.venue ? ' · ' : ''}${esc(dateToStr(f.date))} · ${esc(f.weightClass)} · ${f.rounds} rounds${f.titleFight ? ' · <span class="chip chip--belt">' + (f.belts || []).map(x => BELT_SHORT[x]).join(' ') + ' TITLE</span>' : ''}</div>
    ${taleOfTape(a, b)}
    ${banner}
    <h4 class="subhead">Keys to the fight</h4><ul class="info-list fight-keys">${fightKeys(a, b, f)}</ul>
    <h4 class="subhead">Scorecards</h4>${cards}
    <h4 class="subhead">Fight stats</h4>${stats}
    ${roundTable}
    <h4 class="subhead">After the fight</h4>
    <div class="changes-grid">${changesCol(a, 'a')}${changesCol(b, 'b')}</div>
    <h4 class="subhead">Report</h4>
    <div class="commentary">${(r.commentary || []).map(l => `<p>${esc(l)}</p>`).join('')}</div>
  </div>`;
}

/* =====================================================================
   VIEW: Results
   ===================================================================== */
let resState = { q: '', division: 'all', titleOnly: false, page: 0 };
const RES_PAGE = 30;
views.results = {
  html() {
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">The record books</div><h1>Results</h1>
        <p class="lede">Every fight you’ve ever staged, newest first.</p></header>
      <div class="toolbar"><input id="res-q" class="search" placeholder="Search a fighter…" value="${esc(resState.q)}"></div>
      <div class="filters">
        <label>Division<select id="res-div"><option value="all">All</option>${selectOptions(WEIGHT_CLASSES, resState.division)}</select></label>
        <label class="check-inline"><input type="checkbox" id="res-title" ${resState.titleOnly ? 'checked' : ''}> Title fights only</label>
      </div>
      <div id="res-list"></div>
    </div>`;
  },
  wire() {
    const refresh = () => { resState.q = val('res-q'); resState.division = val('res-div'); resState.titleOnly = $('#res-title').checked; resState.page = 0; renderResults(); };
    on('#res-q', 'input', refresh); on('#res-div', 'change', refresh); on('#res-title', 'change', refresh);
    renderResults();
  }
};
function renderResults() {
  const box = $('#res-list'); if (!box) return;
  let list = state.fights.filter(f => f.simulated);
  if (resState.division !== 'all') list = list.filter(f => f.weightClass === resState.division);
  if (resState.titleOnly) list = list.filter(f => f.titleFight);
  const q = resState.q.toLowerCase().trim();
  if (q) list = list.filter(f => { const a = getBoxer(f.aId), b = getBoxer(f.bId); return a && b && (a.name + ' ' + b.name).toLowerCase().includes(q); });
  list.sort((a, b) => dateCompare(b.date, a.date));
  const total = list.length, pages = Math.max(1, Math.ceil(total / RES_PAGE));
  resState.page = clamp(resState.page, 0, pages - 1);
  const slice = list.slice(resState.page * RES_PAGE, resState.page * RES_PAGE + RES_PAGE);
  if (!total) { box.innerHTML = `<div class="empty">No fights match. <button class="link-btn" data-link="book">Book one →</button></div>`; return; }
  box.innerHTML = `<div class="result-count">${total} fight${total === 1 ? '' : 's'}</div>${slice.map(resultLine).join('')}
    ${pages > 1 ? `<div class="pager"><button class="btn btn--ghost btn--sm" id="res-prev" ${resState.page === 0 ? 'disabled' : ''}>← Prev</button><span class="mono">Page ${resState.page + 1} / ${pages}</span><button class="btn btn--ghost btn--sm" id="res-next" ${resState.page >= pages - 1 ? 'disabled' : ''}>Next →</button></div>` : ''}`;
  on('#res-prev', 'click', () => { resState.page--; renderResults(); });
  on('#res-next', 'click', () => { resState.page++; renderResults(); });
}

/* =====================================================================
   VIEW: Leaderboards (current + all-time)
   ===================================================================== */
let lbState = { board: 'p4p', division: 'all', nat: 'all', style: 'all', status: 'default', minFights: 0, undefeated: false, champions: false };
views.leaderboards = {
  html(params) {
    if (params && params.board) lbState.board = params.board;
    const picker = BOARD_GROUPS.map(g => `<div class="board-group"><div class="board-group__t">${esc(g.group)}</div><div class="board-pills">${g.items.map(it => `<button class="pill ${lbState.board === it.id ? 'pill--on' : ''}" data-board="${it.id}">${esc(it.label)}</button>`).join('')}</div></div>`).join('');
    return `<div class="view">
      <header class="page-head"><div class="eyebrow">Rankings</div><h1>Leaderboards</h1>
        <p class="lede">Live rankings of the active roster, plus all-time boards that keep the legends listed long after they retire.</p></header>
      <section class="card board-picker">${picker}</section>
      <div class="filters">
        <label>Division<select id="lb-div"><option value="all">All</option>${selectOptions(WEIGHT_CLASSES, lbState.division)}</select></label>
        <label>Country<select id="lb-nat"><option value="all">All</option>${selectOptions(NATIONALITIES, lbState.nat)}</select></label>
        <label>Style<select id="lb-style"><option value="all">All</option>${selectOptions(STYLES, lbState.style)}</select></label>
        <label>Status<select id="lb-status"><option value="default">Default</option><option value="active">Active</option><option value="retired">Retired</option><option value="all">All</option></select></label>
        <label>Min fights<input id="lb-minf" type="number" min="0" max="100" value="${lbState.minFights}" style="width:64px"></label>
        <label class="check-inline"><input type="checkbox" id="lb-undef" ${lbState.undefeated ? 'checked' : ''}> Undefeated</label>
        <label class="check-inline"><input type="checkbox" id="lb-champ" ${lbState.champions ? 'checked' : ''}> Champions</label>
      </div>
      <div id="lb-list"></div>
    </div>`;
  },
  wire() {
    $all('[data-board]').forEach(b => b.addEventListener('click', () => { lbState.board = b.dataset.board; $all('[data-board]').forEach(x => x.classList.toggle('pill--on', x.dataset.board === lbState.board)); renderLbList(); }));
    const refresh = () => { lbState.division = val('lb-div'); lbState.nat = val('lb-nat'); lbState.style = val('lb-style'); lbState.status = val('lb-status'); lbState.minFights = Math.max(0, Math.round(numv('lb-minf', 0))); lbState.undefeated = $('#lb-undef').checked; lbState.champions = $('#lb-champ').checked; renderLbList(); };
    ['lb-div', 'lb-nat', 'lb-style', 'lb-status'].forEach(id => on('#' + id, 'change', refresh));
    on('#lb-minf', 'input', refresh); on('#lb-undef', 'change', refresh); on('#lb-champ', 'change', refresh);
    $('#lb-status').value = lbState.status;
    renderLbList();
  }
};
function renderLbList() {
  const box = $('#lb-list'); if (!box) return;
  const filters = { division: lbState.division, nationality: lbState.nat, style: lbState.style, status: lbState.status, minFights: lbState.minFights || undefined, undefeatedOnly: lbState.undefeated, championsOnly: lbState.champions };
  const board = rankBoard(lbState.board, filters, 100);
  if (!board.rows.length) { box.innerHTML = `<div class="empty">No fighters match this board and filter.</div>`; return; }
  box.innerHTML = `<div class="lb-head"><h3>${esc(board.title)}</h3><span class="muted">${board.rows.length} ranked</span></div>
    <div class="lb-list">${board.rows.map((row, i) => fighterRow(row.box, `<span class="lb-val"><b class="mono">${row.display}</b><small>${esc(row.sub)}</small></span>`, '' + (i + 1))).join('')}</div>`;
}

/* rankings nav alias -> same view */
views.rankings = views.leaderboards;

/* attribute-driven tactical read of a finished fight (makes the attribute depth visible) */
function fightKeys(a, b, f) {
  const r = f.result, A = a.attributes, B = b.attributes, keys = [];
  const nA = a.name.split(' ').pop(), nB = b.name.split(' ').pop();
  const sa = r.stats.a, sb = r.stats.b;
  const g = k => A[k] - B[k];
  const landDiff = sa.landed - sb.landed;
  if (Math.abs(landDiff) > 12) { const lead = landDiff > 0 ? nA : nB; const sharp = Math.abs(g('combinations') + g('accuracy')) > 24; keys.push(`${lead} controlled the output, landing the busier and cleaner work${sharp ? ' behind sharp combinations and accuracy' : ''}.`); }
  const powG = g('power') + g('killerInstinct'); if (Math.abs(powG) > 24) keys.push(`${powG > 0 ? nA : nB} carried the heavier hands and the greater threat of a stoppage all night.`);
  const defG = g('defence') + g('footwork') + g('speed'); if (Math.abs(defG) > 38) { const who = defG > 0 ? A : B; keys.push(`${defG > 0 ? nA : nB} was the far harder man to hit, using ${who.footwork > who.defence ? 'footwork and angles' : 'head movement and reflexes'} to stay out of trouble.`); }
  if (f.rounds >= 10) { if (A.stamina < 50 && B.stamina >= 60) keys.push(`${nA} faded down the stretch as the pace exposed a suspect gas tank.`); else if (B.stamina < 50 && A.stamina >= 60) keys.push(`${nB} faded late as the pace told on a suspect engine.`); }
  if (A.counterpunching > 80 && B.aggression > 68) keys.push(`${nA} made ${nB} pay for leading, timing counters off the aggression.`);
  else if (B.counterpunching > 80 && A.aggression > 68) keys.push(`${nB} punished ${nA}'s aggression with well-timed counters.`);
  let kdA = 0, kdB = 0; (r.rounds || []).forEach(rd => { kdA += rd.kdA; kdB += rd.kdB; });
  if (kdA && !r.draw && r.winnerId === a.id) keys.push(`${nA} survived being dropped and still found a way to win — a real test of chin and heart.`);
  if (kdB && !r.draw && r.winnerId === b.id) keys.push(`${nB} climbed off the canvas to take it — chin and heart under fire.`);
  if (A.clinch > 80 && kdA) keys.push(`${nA} leaned on the clinch to weather the storm when hurt.`);
  if (B.clinch > 80 && kdB) keys.push(`${nB} tied up smartly to survive the bad moments.`);
  if (!keys.length) keys.push(r.draw ? `Two well-matched fighters who cancelled each other out.` : `A close, even contest decided by the finer margins.`);
  return keys.slice(0, 4).map(k => `<li>${esc(k)}</li>`).join('');
}

/* ----- god-mode belt management ----- */
function assignBelt(wc, belt, boxerId) {
  const prev = state.champions[wc] && state.champions[wc][belt];
  if (prev && prev === boxerId) return;
  if (prev) { const pb = getBoxer(prev); if (pb) pb.titles = pb.titles.filter(t => !(t.wc === wc && t.belt === belt)); }
  if (!state.champions[wc]) state.champions[wc] = {};
  state.champions[wc][belt] = boxerId;
  const nb = getBoxer(boxerId);
  if (nb && !nb.titles.some(t => t.wc === wc && t.belt === belt)) nb.titles.push({ wc, belt, since: dateToStr(state.date) });
  state.titleHistory.push({ weightClass: wc, belt, championId: boxerId, formerId: prev || null, date: cloneDate(state.date), fightId: null, vacated: false, awarded: true });
  autosave();
}
function vacateBelt(wc, belt) {
  const prev = state.champions[wc] && state.champions[wc][belt];
  if (!prev) return;
  const pb = getBoxer(prev); if (pb) pb.titles = pb.titles.filter(t => !(t.wc === wc && t.belt === belt));
  state.champions[wc][belt] = null;
  state.titleHistory.push({ weightClass: wc, belt, championId: null, formerId: prev, date: cloneDate(state.date), fightId: null, vacated: true });
  autosave();
}

/* =====================================================================
   VIEW: Champions + lineage
   ===================================================================== */
views.champions = {
  html(params) {
    const wc = (params && params.division) || views.champions._wc || WEIGHT_CLASSES[6];
    views.champions._wc = wc;
    const undisputed = undisputedChampion(wc);
    const champs = divisionChampions(wc);
    const beltCard = c => {
      const champ = c.championId ? getBoxer(c.championId) : null;
      return `<div class="card belt-card">
        <div class="belt-card__head"><span class="chip chip--belt">${esc(BELT_SHORT[c.belt])}</span><span class="belt-card__name">${esc(c.belt)}</span></div>
        ${champ ? `<button class="belt-champ" data-profile="${champ.id}">
            <span class="belt-champ__ovr" style="color:${ratingColor(overall(champ))}">${overall(champ)}</span>
            <span><span class="belt-champ__name">${esc(champ.name)}</span><span class="muted">${recordStr(champ)}${c.reign ? ` · reigning ${c.reign.days}d · ${c.reign.defences} def.` : ''}</span></span>
          </button>` : `<div class="belt-vacant">Vacant</div>`}
        <div class="btn-row btn-row--tight">
          <button class="btn btn--ghost btn--xs" data-assign="${esc(c.belt)}">Assign holder</button>
          ${champ ? `<button class="btn btn--ghost btn--xs" data-vacate="${esc(c.belt)}">Vacate</button>` : ''}
          <button class="btn btn--ghost btn--xs" data-lineage="${esc(c.belt)}">Lineage</button>
        </div>
      </div>`;
    };
    return `<div class="view">
      <header class="page-head"><div class="eyebrow">Titles</div><h1>Champions</h1></header>
      <div class="filters"><label>Division<select id="ch-div">${selectOptions(WEIGHT_CLASSES, wc)}</select></label>
        ${undisputed ? `<span class="chip chip--gold">Undisputed: ${esc(getBoxer(undisputed).name)}</span>` : ''}</div>
      <div class="grid grid--cards">${champs.map(beltCard).join('')}</div>
    </div>`;
  },
  wire() {
    on('#ch-div', 'change', () => navigate('champions', { division: val('ch-div') }));
    const wc = views.champions._wc;
    $all('[data-assign]').forEach(b => b.addEventListener('click', () => openAssignBelt(wc, b.dataset.assign)));
    $all('[data-vacate]').forEach(b => b.addEventListener('click', () => { const belt = b.dataset.vacate; confirmModal(`Strip the ${esc(belt)} ${esc(wc)} title and leave it vacant?`, () => { vacateBelt(wc, belt); toast('Belt vacated.'); navigate('champions', { division: wc }); }, { confirmLabel: 'Vacate belt' }); }));
    $all('[data-lineage]').forEach(b => b.addEventListener('click', () => openLineage(wc, b.dataset.lineage)));
  }
};

function openAssignBelt(wc, belt) {
  openModal(`<p class="muted">Hand the ${esc(belt)} ${esc(wc)} title to any fighter. This is a commissioner’s decree — no fight required.</p>
    <div class="field"><label>New champion</label>${fighterPicker('ab', { placeholder: 'Search fighter…' })}</div>
    <div class="btn-row btn-row--end"><button class="btn btn--ghost" data-close-modal>Cancel</button><button class="btn btn--gold" id="ab-go">Crown champion</button></div>`, { title: 'Assign ' + BELT_SHORT[belt] });
  wireFighterPicker('ab', null, { division: () => wc, includeRetired: false });
  on('#ab-go', 'click', () => { const id = val('ab-value'); if (!id) return toast('Pick a fighter.', 'warn'); assignBelt(wc, belt, id); closeModal(); toast('New champion crowned.'); navigate('champions', { division: wc }); });
}

function openLineage(wc, belt) {
  const reigns = lineage(wc, belt);
  const body = reigns.length ? `<div class="lineage">${reigns.map(rg => {
    const champ = getBoxer(rg.championId);
    return `<div class="lineage-row">
      <button class="lineage-name" data-profile="${rg.championId}">${champ ? esc(champ.name) : 'Unknown'}</button>
      <span class="lineage-meta mono">${esc(dateToStr(rg.from))} – ${rg.ongoing ? 'present' : esc(dateToStr(rg.to))} · ${rg.days}d · ${rg.defences} def.${rg.ongoing ? ' · <b class="gold">current</b>' : rg.lostMethod === 'vacated' ? ' · vacated' : ''}</span>
    </div>`;
  }).join('')}</div>` : '<p class="muted">No one has held this belt yet. Assign it, or put it on the line in a title fight.</p>';
  openModal(body, { title: BELT_SHORT[belt] + ' ' + wc + ' — lineage', wide: true });
}

function recentFollowerDelta(b, n) { const h = b.followerHistory; if (!h || h.length < 2) return 0; const from = h[Math.max(0, h.length - 1 - (n || 6))].f; return b.followers - from; }

/* =====================================================================
   VIEW: Social
   ===================================================================== */
views.social = {
  html() {
    const board = rankBoard('followers', { status: 'active' }, 20).rows;
    const movers = activeBoxers().filter(b => totalFights(b) > 0).map(b => ({ b, d: recentFollowerDelta(b, 6) })).filter(x => x.d !== 0).sort((x, y) => y.d - x.d);
    const top = board[0] ? board[0].box : null;
    return `<div class="view">
      <header class="page-head"><div class="eyebrow">Fame</div><h1>Social media</h1>
        <p class="lede">Following swings with how big a fight is. Win on a huge stage and your numbers explode; sit out and they stall.</p></header>
      ${top ? `<section class="card">
        <div class="card__head"><h3>${esc(top.name)} — following</h3><span class="mono gold">${fmtFollowers(top.followers)}</span></div>
        ${sparkline((top.followerHistory || []).map(p => p.f), { color: 'var(--gold)', w: 520, h: 70 })}
        <p class="muted">Peak ${fmtFollowers(top.peakFollowers)} · click any fighter for their full growth curve.</p>
      </section>` : ''}
      <div class="dash-grid">
        <section class="card">
          <h3>Most followed</h3>
          <div class="lb-list">${board.length ? board.map((r, i) => fighterRow(r.box, `<span class="lb-val"><b class="mono">${fmtFollowers(r.box.followers)}</b></span>`, '' + (i + 1))).join('') : '<p class="muted">No fighters yet.</p>'}</div>
        </section>
        <section class="card">
          <h3>Biggest recent movers</h3>
          ${movers.length ? movers.slice(0, 10).map(x => fighterRow(x.b, `<span class="lb-val">${delta(x.d)}</span>`)).join('') : '<p class="muted">Stage some fights to see followings move.</p>'}
        </section>
      </div>
    </div>`;
  },
  wire() {}
};

/* =====================================================================
   VIEW: History (universe timeline)
   ===================================================================== */
views.history = {
  html() {
    const events = [];
    state.titleHistory.forEach(t => {
      const wcS = WEIGHT_CLASS_SHORT[t.weightClass] || t.weightClass;
      if (t.championId) { const c = getBoxer(t.championId); events.push({ date: t.date, html: `<div class="tl-row"><span class="tl-date mono">${esc(dateToStr(t.date))}</span><span class="tl-body"><span class="chip chip--belt">${esc(BELT_SHORT[t.belt])}</span> ${c ? `<button class="link-btn" data-profile="${c.id}">${esc(c.name)}</button>` : 'Unknown'} ${t.awarded ? 'was awarded' : 'won'} the ${esc(wcS)} title</span></div>` }); }
      else if (t.vacated) { const f = getBoxer(t.formerId); events.push({ date: t.date, html: `<div class="tl-row"><span class="tl-date mono">${esc(dateToStr(t.date))}</span><span class="tl-body"><span class="chip chip--muted">${esc(BELT_SHORT[t.belt])}</span> ${esc(wcS)} title vacated${f ? ` by ${esc(f.name)}` : ''}</span></div>` }); }
    });
    state.fights.filter(f => f.simulated && (f.titleFight || f.result.excitement >= 82)).forEach(f => events.push({ date: f.date, html: `<div class="tl-row"><span class="tl-date mono">${esc(dateToStr(f.date))}</span><span class="tl-body">${resultLine(f)}</span></div>` }));
    retiredBoxers().forEach(b => { if (b.retiredDate) events.push({ date: b.retiredDate, html: `<div class="tl-row"><span class="tl-date mono">${esc(dateToStr(b.retiredDate))}</span><span class="tl-body">🥊 <button class="link-btn" data-profile="${b.id}">${esc(b.name)}</button> retired <span class="muted mono">(${recordStr(b)})</span></span></div>` }); });
    events.sort((a, b) => dateCompare(b.date, a.date));
    const years = Object.keys(state.awards).map(Number).sort((a, b) => b - a);
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">The story so far</div><h1>History</h1></header>
      ${years.length ? `<div class="pill-row">${years.slice(0, 8).map(y => `<button class="pill" data-link="awards" data-link-params='{"year":${y}}'>${y} awards</button>`).join('')}</div>` : ''}
      <section class="card">${events.length ? `<div class="timeline">${events.slice(0, 120).map(e => e.html).join('')}</div>` : '<p class="muted">Nothing has happened yet. Stage some fights and crown some champions.</p>'}</section>
    </div>`;
  },
  wire() {}
};

/* =====================================================================
   VIEW: Awards
   ===================================================================== */
views.awards = {
  html(params) {
    const years = Object.keys(state.awards).map(Number).sort((a, b) => b - a);
    if (!years.length) return `<div class="view view--narrow"><header class="page-head"><div class="eyebrow">Honours</div><h1>Year-end awards</h1></header><div class="empty">No awards yet. Stage fights through a calendar year, then advance past 1 January to crown that year’s winners.</div></div>`;
    const year = (params && params.year) ? Number(params.year) : years[0];
    const aw = state.awards[year] || state.awards[years[0]];
    const fighterAward = (title, id, note) => { const b = id ? getBoxer(id) : null; return `<section class="card award-card"><div class="award-title">${esc(title)}</div>${b ? fighterRow(b, note ? `<span class="lb-val"><small>${esc(note)}</small></span>` : '') : '<p class="muted">—</p>'}</section>`; };
    const fightAward = (title, id) => { const f = id ? state.fights.find(x => x.id === id) : null; return `<section class="card award-card"><div class="award-title">${esc(title)}</div>${f ? resultLine(f) : '<p class="muted">—</p>'}</section>`; };
    const rise = aw.biggestRise ? getBoxer(aw.biggestRise) : null;
    const fall = aw.biggestFall ? getBoxer(aw.biggestFall) : null;
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">Honours · ${year}</div><h1>Year-end awards</h1></header>
      <div class="filters"><label>Year<select id="aw-year">${years.map(y => `<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label></div>
      ${fighterAward('Fighter of the Year', aw.fighterOfYear)}
      ${fightAward('Fight of the Year', aw.fightOfYear)}
      ${fightAward('Knockout of the Year', aw.knockoutOfYear)}
      ${fightAward('Upset of the Year', aw.upsetOfYear)}
      ${fighterAward('Prospect of the Year', aw.prospectOfYear)}
      <div class="dash-grid">
        ${fighterAward('Most Improved', rise ? rise.id : null)}
        ${fall ? fighterAward('Biggest Faller', fall.id) : ''}
      </div>
    </div>`;
  },
  wire() { on('#aw-year', 'change', () => navigate('awards', { year: Number(val('aw-year')) })); }
};

/* =====================================================================
   VIEW: Archive (retired fighters)
   ===================================================================== */
let arState = { q: '', sort: 'earnings' };
views.archive = {
  html() {
    const retired = retiredBoxers();
    if (!retired.length) return `<div class="view"><header class="page-head"><div class="eyebrow">The Hall</div><h1>Archive</h1><p class="lede">Retired fighters live here forever, with their full record, history and career winnings intact.</p></header><div class="empty">No one has retired yet. Retirement is entirely your call — from any fighter’s profile.</div></div>`;
    return `<div class="view">
      <header class="page-head"><div class="eyebrow">The Hall</div><h1>Archive</h1>
        <p class="lede">${retired.length} retired fighter${retired.length === 1 ? '' : 's'}. Every record, belt history and dollar earned is preserved.</p></header>
      <div class="toolbar"><input id="ar-q" class="search" placeholder="Search retired fighters…" value="${esc(arState.q)}">
        <label>Sort<select id="ar-sort">
          <option value="earnings"${arState.sort === 'earnings' ? ' selected' : ''}>Career earnings</option>
          <option value="legacy"${arState.sort === 'legacy' ? ' selected' : ''}>Legacy</option>
          <option value="wins"${arState.sort === 'wins' ? ' selected' : ''}>Wins</option>
          <option value="peakElo"${arState.sort === 'peakElo' ? ' selected' : ''}>Peak ELO</option>
          <option value="name"${arState.sort === 'name' ? ' selected' : ''}>Name</option>
        </select></label></div>
      <div id="ar-list"></div>
    </div>`;
  },
  wire() {
    const refresh = () => { arState.q = val('ar-q'); arState.sort = val('ar-sort'); renderArchive(); };
    on('#ar-q', 'input', refresh); on('#ar-sort', 'change', refresh); renderArchive();
  }
};
function renderArchive() {
  const box = $('#ar-list'); if (!box) return;
  let list = retiredBoxers();
  const q = arState.q.toLowerCase().trim();
  if (q) list = list.filter(b => (b.name + ' ' + b.nickname + ' ' + b.nationality).toLowerCase().includes(q));
  const sorters = { earnings: b => b.earnings, legacy: b => b.hidden.legacyScore, wins: b => b.record.w, peakElo: b => b.peakElo, name: b => b.name };
  const s = sorters[arState.sort];
  list.sort((a, b) => arState.sort === 'name' ? s(a).localeCompare(s(b)) : s(b) - s(a));
  box.innerHTML = list.length ? `<div class="grid grid--cards">${list.map(b => `<button class="fcard" data-profile="${b.id}">
      <span class="fcard__ovr" style="color:${ratingColor(overall(b))}">${overall(b)}</span>
      <span class="fcard__body"><span class="fcard__name">${esc(b.name)}</span><span class="fcard__nick">${b.nickname ? '“' + esc(b.nickname) + '”' : 'Retired'}</span>
        <span class="fcard__meta">${esc(WEIGHT_CLASS_SHORT[b.weightClass])} · ${esc(b.nationality)}</span><span class="fcard__rec mono">${recordStr(b)}</span></span>
      <span class="fcard__foot"><span class="mono gold">${fmtMoney(b.earnings)}</span><span class="muted">peak ${b.peakElo}</span></span>
    </button>`).join('')}</div>` : `<div class="empty">No retired fighters match.</div>`;
}

/* =====================================================================
   VIEW: Save / Load
   ===================================================================== */
views.save = {
  html() {
    const kb = storageFootprintKB();
    return `<div class="view view--narrow">
      <header class="page-head"><div class="eyebrow">Your universe</div><h1>Save & load</h1>
        <p class="lede">Your world autosaves in this browser after every change. For a game you’ll play across months, keep a JSON backup too.</p></header>
      <section class="card">
        <h3>This browser</h3>
        <label class="trait-chip"><input type="checkbox" id="sv-autosave" ${state.settings.autosave ? 'checked' : ''}><span>Autosave after every change</span></label>
        <div class="storage-note"><span>Save size: <b class="mono">${kb} KB</b> of ~5 MB</span>${state.settings.compactSaved ? '<span class="warn-note">Old round-by-round detail was trimmed to fit. Export a backup to keep full detail.</span>' : ''}</div>
        <div class="btn-row"><button class="btn btn--primary" id="sv-save">Save now</button></div>
      </section>
      <section class="card">
        <h3>Backup file</h3>
        <p class="muted">Download everything as JSON, then re-import it here or on another device. This is the safe way to protect a long-running save.</p>
        <div class="btn-row"><button class="btn btn--primary" id="sv-export">Export universe</button><button class="btn btn--ghost" id="sv-import">Import universe</button></div>
      </section>
      <section class="card card--danger">
        <h3>Danger zone</h3>
        <p class="muted">Start over with a clean, empty universe. This cannot be undone.</p>
        <button class="btn btn--danger" id="sv-reset">Reset universe</button>
      </section>
    </div>`;
  },
  wire() {
    on('#sv-autosave', 'change', e => { state.settings.autosave = e.target.checked; saveUniverse(); toast(e.target.checked ? 'Autosave on.' : 'Autosave off.'); });
    on('#sv-save', 'click', () => { const r = saveUniverse(); toast(r.ok ? (r.trimmed ? 'Saved (old detail trimmed to fit).' : 'Saved.') : 'Save failed — export a backup.', r.ok ? 'ok' : 'warn'); });
    on('#sv-export', 'click', () => { exportUniverse(); toast('Universe exported.'); });
    on('#sv-import', 'click', () => openImportModal('universe'));
    on('#sv-reset', 'click', () => confirmModal('This permanently deletes everything and starts a new empty universe.', () => { resetUniverse(); toast('Universe reset.'); navigate('dashboard'); }, { danger: true, confirmLabel: 'Reset everything', title: 'Reset universe?' }));
  }
};

/* =====================================================================
   VIEW: Profile
   ===================================================================== */
views.profile = {
  html(params) {
    const b = params && params.id ? getBoxer(params.id) : null;
    if (!b) return `<div class="view"><div class="empty">That fighter no longer exists. <button class="link-btn" data-link="database">Back to the database →</button></div></div>`;
    const belts = heldBelts(b);
    const fights = b.fightHistory.map(id => state.fights.find(f => f.id === id)).filter(Boolean).sort((x, y) => dateCompare(y.date, x.date));
    const reigns = allReigns().filter(r => r.championId === b.id).sort((x, y) => dateCompare(y.from, x.from));
    const streak = b.currentStreak && b.currentStreak.count ? `${b.currentStreak.type}${b.currentStreak.count}` : '—';
    const best = b.bestWinId ? state.fights.find(f => f.id === b.bestWinId) : null;
    const worst = b.worstLossId ? state.fights.find(f => f.id === b.worstLossId) : null;
    const eloPts = (b.eloHistory || []).map(p => p.e);
    const folPts = (b.followerHistory || []).map(p => p.f);

    const stat = (v, l) => `<div class="stat"><span class="stat__value">${v}</span><span class="stat__label">${esc(l)}</span></div>`;
    const attrs = ATTR_GROUPS.map(g => `<div class="attr-group"><h4 class="subhead">${g.name}</h4>${g.keys.map(k => attrBar(k, b.attributes[k])).join('')}</div>`).join('');

    return `<div class="view view--narrow">
      <section class="card profile-hero">
        <div class="ph-top">
          <span class="ph-ovr" style="color:${ratingColor(overall(b))}">${overall(b)}</span>
          <div class="ph-id">
            <h1>${esc(b.name)} ${b.status === 'retired' ? '<span class="chip chip--muted">Retired</span>' : ''}${b.frozen ? ' <span class="chip chip--gold">&#10052; Frozen</span>' : ''}</h1>
            ${b.nickname ? `<div class="ph-nick">“${esc(b.nickname)}”</div>` : ''}
            <div class="ph-belts">${belts.length ? belts.map(x => `<span class="chip chip--belt">${esc(BELT_SHORT[x.belt])} ${esc(WEIGHT_CLASS_SHORT[x.wc])}</span>`).join('') : ''}</div>
            <div class="ph-meta muted">${esc(b.weightClass)} · ${esc(b.nationality)} · Age ${b.age} · ${esc(b.stance)} · ${esc(b.style)} · ${esc(careerPhase(b))}</div>
            <div class="ph-meta muted">${b.height} cm · ${b.reach} cm reach${b.hometown ? ' · ' + esc(b.hometown) : ''}</div>
          </div>
          <div class="ph-rec mono">${recordStr(b)}</div>
        </div>
        ${b.traits && b.traits.length ? `<div class="ph-traits">${b.traits.map(t => chip(t, 'chip--muted')).join('')}</div>` : ''}
        <div class="btn-row ph-actions">
          <button class="btn btn--ghost btn--sm" data-link="create" data-link-params='{"id":"${b.id}"}'>Edit</button>
          <button class="btn btn--ghost btn--sm" id="pf-dupe">Duplicate</button>
          <button class="btn btn--ghost btn--sm" id="pf-freeze">${b.frozen ? 'Unfreeze' : 'Freeze'}</button>
          ${b.status === 'active' ? `<button class="btn btn--ghost btn--sm" id="pf-retire">Retire</button>` : `<button class="btn btn--gold btn--sm" id="pf-unretire">Un-retire</button>`}
          <button class="btn btn--ghost btn--sm" id="pf-export">Export</button>
          <button class="btn btn--danger btn--sm" id="pf-delete">Delete</button>
        </div>
      </section>

      <div class="stat-strip">
        ${stat(b.elo, 'ELO')}
        ${stat(b.peakElo, 'Peak ELO')}
        ${stat(fmtMoney(b.earnings), 'Career earnings')}
        ${stat(b.hidden.legacyScore, 'Legacy')}
      </div>
      <div class="stat-strip">
        ${stat(fmtFollowers(b.followers), 'Followers')}
        ${stat(koPct(b) + '%', 'KO ratio')}
        ${stat(b.titleFightsW + '-' + b.titleFightsL, 'Title fights')}
        ${stat(b.titleDefences, 'Title defences')}
      </div>
      <div class="stat-strip">
        ${stat(totalFights(b), 'Total fights')}
        ${stat(b.rankedWins, 'Ranked wins')}
        ${stat(streak, 'Current streak')}
        ${stat(eloTier(b.elo), 'Tier')}
      </div>

      <div class="dash-grid">
        <section class="card"><div class="card__head"><h3>ELO history</h3><span class="mono muted">peak ${b.peakElo}</span></div>${sparkline(eloPts, { color: 'var(--gold)', w: 520, h: 64 })}</section>
        <section class="card"><div class="card__head"><h3>Following</h3><span class="mono muted">peak ${fmtFollowers(b.peakFollowers)}</span></div>${sparkline(folPts, { color: 'var(--accent)', w: 520, h: 64 })}</section>
      </div>

      ${(best || worst) ? `<div class="dash-grid">
        ${best ? `<section class="card"><h3>Best win</h3>${resultLine(best)}</section>` : ''}
        ${worst ? `<section class="card"><h3>Toughest loss</h3>${resultLine(worst)}</section>` : ''}
      </div>` : ''}

      <section class="card"><h3>Attributes</h3>
        <p class="muted" style="margin-top:-4px">${b.frozen ? '&#10052; Frozen &mdash; these won\'t change from fights or ageing. ' : ''}Every one of these feeds the fight engine. <button class="link-btn" id="pf-attrinfo">How attributes shape a fight →</button></p>
        ${attrs}
      </section>

      ${reigns.length ? `<section class="card"><h3>Title history</h3><div class="lineage">${reigns.map(rg => `<div class="lineage-row"><span class="lineage-name">${esc(BELT_SHORT[rg.belt])} ${esc(WEIGHT_CLASS_SHORT[rg.wc])}</span><span class="lineage-meta mono">${esc(dateToStr(rg.from))} – ${rg.ongoing ? 'present' : esc(dateToStr(rg.to))} · ${rg.days}d · ${rg.defences} def.</span></div>`).join('')}</div></section>` : ''}

      <section class="card"><div class="card__head"><h3>Fight history</h3><span class="muted">${fights.length} bout${fights.length === 1 ? '' : 's'}</span></div>
        ${fights.length ? fights.map(resultLine).join('') : '<p class="muted">No fights yet. <button class="link-btn" data-link="book">Book one →</button></p>'}
      </section>
    </div>`;
  },
  wire(params) {
    const b = getBoxer(params.id); if (!b) return;
    on('#pf-attrinfo', 'click', attrInfoModal);
    on('#pf-dupe', 'click', () => { const c = duplicateBoxer(b.id); autosave(); toast('Duplicated.'); navigate('profile', { id: c.id }); });
    on('#pf-freeze', 'click', () => { const nv = !b.frozen; updateBoxer(b.id, { frozen: nv }); autosave(); toast(nv ? 'Attributes frozen.' : 'Attributes unfrozen.'); navigate('profile', { id: b.id }); });
    on('#pf-export', 'click', () => { exportBoxers([b.id]); toast('Fighter exported.'); });
    on('#pf-retire', 'click', () => confirmModal(`Retire <b>${esc(b.name)}</b>? They keep their full record, history and winnings in the archive, and you can un-retire them whenever you like. Any belts they hold will be vacated.`, () => { retireBoxer(b.id); autosave(); toast(b.name + ' has retired.'); navigate('profile', { id: b.id }); }, { confirmLabel: 'Retire fighter' }));
    on('#pf-unretire', 'click', () => { unretireBoxer(b.id); autosave(); toast(b.name + ' is back.'); navigate('profile', { id: b.id }); });
    on('#pf-delete', 'click', () => confirmModal(`Permanently delete <b>${esc(b.name)}</b>? Their past fights stay in the record books but the fighter is gone for good. To keep their stats, retire them instead.`, () => { deleteBoxer(b.id); autosave(); toast('Fighter deleted.'); navigate('database'); }, { danger: true, confirmLabel: 'Delete fighter' }));
  }
};
