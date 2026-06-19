/* =====================================================================
   rankings.js  -  leaderboards, champions, belt lineage, rivalries
   ---------------------------------------------------------------------
   "Current" boards rank active fighters by live values.
   "All-time" boards include retired fighters and use peak/career totals,
   so a legend stays on the board forever after they hang up the gloves.
   No DOM, no storage.
   ===================================================================== */

/* belts a fighter currently holds */
function heldBelts(b) {
  const out = [];
  WEIGHT_CLASSES.forEach(wc => {
    if (!state.champions[wc]) return;
    BELTS.forEach(belt => { if (state.champions[wc][belt] === b.id) out.push({ wc, belt }); });
  });
  return out;
}
function isChampion(b) { return heldBelts(b).length > 0; }

/* ELO change over the most recent n recorded points (for "fallers/risers") */
function recentEloDelta(b, n) {
  const h = b.eloHistory;
  if (h.length < 2) return 0;
  const from = h[Math.max(0, h.length - 1 - (n || 6))].e;
  return b.elo - from;
}

/* ----------------------------- filters ------------------------------ */
function applyFilters(list, f) {
  f = f || {};
  return list.filter(b => {
    if (f.division && f.division !== 'all' && b.weightClass !== f.division) return false;
    if (f.nationality && f.nationality !== 'all' && b.nationality !== f.nationality) return false;
    if (f.style && f.style !== 'all' && b.style !== f.style) return false;
    if (f.status === 'active' && b.status !== 'active') return false;
    if (f.status === 'retired' && b.status !== 'retired') return false;
    if (f.undefeatedOnly && !isUndefeated(b)) return false;
    if (f.championsOnly && !isChampion(b)) return false;
    if (f.minFights && totalFights(b) < f.minFights) return false;
    if (f.eloMin != null && b.elo < f.eloMin) return false;
    if (f.eloMax != null && b.elo > f.eloMax) return false;
    if (f.ageMin != null && b.age < f.ageMin) return false;
    if (f.ageMax != null && b.age > f.ageMax) return false;
    return true;
  });
}

/* ------------------------- board definitions ------------------------ */
/* grouped for the UI; each item = { id, label, scope } */
const BOARD_GROUPS = [
  {
    group: 'Pound-for-Pound', items: [
      { id: 'p4p', label: 'P4P — ELO', scope: 'current' },
      { id: 'division', label: 'Divisional ELO', scope: 'current' },
      { id: 'prospects', label: 'Top Prospects (≤23)', scope: 'current' }
    ]
  },
  {
    group: 'Fame & Reputation', items: [
      { id: 'followers', label: 'Most Followers', scope: 'current' },
      { id: 'hype', label: 'Biggest Hype', scope: 'current' },
      { id: 'credibility', label: 'Highest Credibility', scope: 'current' },
      { id: 'popularity', label: 'Most Popular', scope: 'current' }
    ]
  },
  {
    group: 'Records', items: [
      { id: 'wins', label: 'Most Wins', scope: 'current' },
      { id: 'kos', label: 'Most Knockouts', scope: 'current' },
      { id: 'undefeated', label: 'Best Unbeaten Records', scope: 'current' },
      { id: 'kopct', label: 'Highest KO %', scope: 'current' },
      { id: 'active', label: 'Most Active', scope: 'current' },
      { id: 'fallers', label: 'Biggest Fall-offs', scope: 'current' }
    ]
  },
  {
    group: 'All-Time (incl. retired)', items: [
      { id: 'allWins', label: 'All-Time Wins', scope: 'alltime' },
      { id: 'allKos', label: 'All-Time Knockouts', scope: 'alltime' },
      { id: 'peakElo', label: 'Highest Peak ELO', scope: 'alltime' },
      { id: 'peakFollowers', label: 'Peak Followers', scope: 'alltime' },
      { id: 'earnings', label: 'Career Earnings', scope: 'alltime' },
      { id: 'legacy', label: 'Highest Legacy', scope: 'alltime' },
      { id: 'defences', label: 'Most Title Defences', scope: 'alltime' },
      { id: 'reign', label: 'Longest Title Reign', scope: 'alltime' },
      { id: 'titleFights', label: 'Most Title Fights', scope: 'alltime' }
    ]
  }
];

function boardScope(id) {
  for (const g of BOARD_GROUPS) for (const it of g.items) if (it.id === id) return it.scope;
  return 'current';
}
function boardLabel(id) {
  for (const g of BOARD_GROUPS) for (const it of g.items) if (it.id === id) return it.label;
  return id;
}

/* ----------------------------- ranking ------------------------------ */
/* returns { title, unit, rows: [ { box, value, sub } ] } sorted desc */
function rankBoard(id, filters, limit) {
  filters = filters || {};
  const scope = boardScope(id);
  // default status by scope unless caller overrode it
  const f = Object.assign({}, filters);
  if (f.status == null || f.status === 'default') f.status = (scope === 'alltime') ? 'all' : 'active';

  let pool = applyFilters(allBoxers(), f);
  const reignMap = (id === 'reign') ? longestReignMap() : null;

  const config = {
    p4p: { unit: 'ELO', val: b => b.elo, sub: b => recordStr(b) },
    division: { unit: 'ELO', val: b => b.elo, sub: b => `${WEIGHT_CLASS_SHORT[b.weightClass]} · ${recordStr(b)}` },
    prospects: { unit: 'ELO', val: b => b.elo + b.hype, filterExtra: b => b.age <= 23 && b.status === 'active', sub: b => `Age ${b.age} · ${recordStr(b)} · Hype ${b.hype}` },
    followers: { unit: 'followers', val: b => b.followers, fmt: fmtFollowers, sub: b => `${recordStr(b)} · ${b.weightClass}` },
    hype: { unit: 'hype', val: b => b.hype, sub: b => `${recordStr(b)} · ELO ${b.elo}` },
    credibility: { unit: 'cred', val: b => b.credibility, sub: b => `${recordStr(b)} · ${b.rankedWins} ranked wins` },
    popularity: { unit: 'pop', val: b => b.popularity, sub: b => `${recordStr(b)}` },
    wins: { unit: 'wins', val: b => b.record.w, sub: b => `${recordStr(b)} · ${b.weightClass}` },
    kos: { unit: 'KOs', val: b => b.record.ko, sub: b => `${recordStr(b)} · ${koPct(b)}% KO` },
    undefeated: { unit: 'wins', val: b => b.record.w, filterExtra: b => isUndefeated(b), sub: b => `${recordStr(b)} · ${b.weightClass}` },
    kopct: { unit: 'KO %', val: b => koPct(b), filterExtra: b => totalFights(b) >= (f.minFights || 5), sub: b => `${recordStr(b)} · ${b.record.ko} KO` },
    active: { unit: 'fights', val: b => totalFights(b), sub: b => `${recordStr(b)} · ${b.weightClass}` },
    fallers: { unit: 'ELO drop', val: b => -recentEloDelta(b, 6), filterExtra: b => recentEloDelta(b, 6) < 0, sub: b => `now ${b.elo} · ${recordStr(b)}` },
    allWins: { unit: 'wins', val: b => b.record.w, sub: b => `${recordStr(b)} · ${b.status === 'retired' ? 'retired' : b.weightClass}` },
    allKos: { unit: 'KOs', val: b => b.record.ko, sub: b => `${recordStr(b)} · ${koPct(b)}%` },
    peakElo: { unit: 'peak ELO', val: b => b.peakElo, sub: b => `now ${b.elo} · ${recordStr(b)}` },
    peakFollowers: { unit: 'peak', val: b => b.peakFollowers, fmt: fmtFollowers, sub: b => `${recordStr(b)}` },
    earnings: { unit: 'earned', val: b => b.earnings, fmt: fmtMoney, sub: b => `${recordStr(b)} · ${totalFights(b)} fights` },
    legacy: { unit: 'legacy', val: b => b.hidden.legacyScore, sub: b => `${recordStr(b)} · ${b.titleFightsW} title wins` },
    defences: { unit: 'defences', val: b => b.titleDefences, filterExtra: b => b.titleDefences > 0, sub: b => `${recordStr(b)} · ${heldBelts(b).length || b.titles.length} belts` },
    reign: { unit: 'days', val: b => (reignMap[b.id] ? reignMap[b.id].days : 0), filterExtra: b => reignMap[b.id] && reignMap[b.id].days > 0, sub: b => reignMap[b.id] ? `${BELT_SHORT[reignMap[b.id].belt]} ${WEIGHT_CLASS_SHORT[reignMap[b.id].wc]} · ${reignMap[b.id].defences} def.` : '' },
    titleFights: { unit: 'title fights', val: b => b.titleFightsW + b.titleFightsL, filterExtra: b => (b.titleFightsW + b.titleFightsL) > 0, sub: b => `${b.titleFightsW}-${b.titleFightsL} in title fights` }
  }[id] || { unit: 'ELO', val: b => b.elo, sub: b => recordStr(b) };

  if (config.filterExtra) pool = pool.filter(config.filterExtra);
  const rows = pool
    .map(b => ({ box: b, value: config.val(b), display: config.fmt ? config.fmt(config.val(b)) : config.val(b), sub: config.sub(b) }))
    .sort((x, y) => y.value - x.value)
    .slice(0, limit || 100);

  return { title: boardLabel(id), unit: config.unit, rows };
}

/* ------------------------ champions + lineage ----------------------- */
/* build every title reign across history (chronological per belt) */
function allReigns() {
  const reigns = [];
  WEIGHT_CLASSES.forEach(wc => {
    BELTS.forEach(belt => {
      const entries = state.titleHistory
        .filter(t => t.weightClass === wc && t.belt === belt)
        .sort((a, b) => dateCompare(a.date, b.date));
      let prevChamp = null;
      entries.forEach((e, i) => {
        if (!e.championId) { prevChamp = null; return; } // vacancy ends a reign
        if (e.championId === prevChamp) return;          // a defence / re-affirmation, same reign
        prevChamp = e.championId;
        const from = e.date;
        // reign ends at the next entry whose champion differs (or a vacancy); defences are skipped
        let to = null, lostMethod = 'current';
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j].championId === e.championId) continue; // still the same champion
          to = entries[j].date; lostMethod = entries[j].vacated ? 'vacated' : 'lost'; break;
        }
        const ongoing = (to === null && state.champions[wc] && state.champions[wc][belt] === e.championId);
        const endDate = to || cloneDate(state.date);
        reigns.push({
          wc, belt, championId: e.championId, from, to,
          days: daysBetween(from, endDate),
          ongoing: ongoing,
          lostMethod: ongoing ? 'current' : lostMethod,
          startFightId: e.fightId
        });
      });
    });
  });
  // count defences per reign (title fights won by the champion within the window, minus the win itself)
  reigns.forEach(rg => {
    const wins = state.fights.filter(f =>
      f.titleFight && f.weightClass === rg.wc && (f.belts || []).includes(rg.belt) &&
      f.result && f.result.winnerId === rg.championId &&
      dateToKey(f.date) >= dateToKey(rg.from) && (rg.to ? dateToKey(f.date) < dateToKey(rg.to) : true)
    ).length;
    rg.defences = Math.max(0, wins - 1);
  });
  return reigns;
}
function daysBetween(a, b) {
  const da = new Date(a.y, a.m - 1, a.d), db = new Date(b.y, b.m - 1, b.d);
  return Math.max(0, Math.round((db - da) / 86400000));
}

/* longest reign per champion (for the all-time board) */
function longestReignMap() {
  const map = {};
  allReigns().forEach(rg => {
    if (!map[rg.championId] || rg.days > map[rg.championId].days) map[rg.championId] = rg;
  });
  return map;
}

/* lineage for a single belt: chronological reigns with holder + defences */
function lineage(wc, belt) {
  return allReigns().filter(r => r.wc === wc && r.belt === belt).sort((a, b) => dateCompare(b.from, a.from));
}

/* current champions table for a division */
function divisionChampions(wc) {
  const reigns = allReigns().filter(r => r.wc === wc && r.ongoing);
  return BELTS.map(belt => {
    const champId = state.champions[wc] ? state.champions[wc][belt] : null;
    const reign = reigns.find(r => r.belt === belt);
    return { belt, championId: champId || null, reign: reign || null };
  });
}

/* undisputed check: one fighter holds all five belts in a division */
function undisputedChampion(wc) {
  if (!state.champions[wc]) return null;
  const holders = BELTS.map(belt => state.champions[wc][belt]);
  if (holders.every(h => h && h === holders[0])) return holders[0];
  return null;
}

/* ----------------------------- rivalries ---------------------------- */
function rivalries(minFights) {
  minFights = minFights || 2;
  const map = {};
  state.fights.forEach(f => {
    if (!f.simulated) return;
    const key = [f.aId, f.bId].sort().join('~');
    if (!map[key]) map[key] = { ids: key.split('~'), fights: [], aWins: 0, bWins: 0, draws: 0 };
    map[key].fights.push(f);
  });
  const out = [];
  Object.values(map).forEach(r => {
    if (r.fights.length < minFights) return;
    const [id0, id1] = r.ids;
    let w0 = 0, w1 = 0, d = 0, fame = 0, excite = 0;
    r.fights.forEach(f => {
      if (f.result.draw) d++;
      else if (f.result.winnerId === id0) w0++;
      else w1++;
      excite += f.result.excitement;
    });
    const b0 = getBoxer(id0), b1 = getBoxer(id1);
    if (!b0 || !b1) return;
    out.push({
      a: b0, b: b1, count: r.fights.length, w0, w1, d,
      fights: r.fights.slice().sort((x, y) => dateCompare(x.date, y.date)),
      heat: Math.round(excite / r.fights.length + r.fights.length * 6)
    });
  });
  return out.sort((x, y) => y.heat - x.heat);
}
