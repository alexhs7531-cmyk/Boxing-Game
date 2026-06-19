/* =====================================================================
   engine.js  -  world progression
   ---------------------------------------------------------------------
   Turns a raw fight result (produced by fightEngine, no mutation) into
   real changes across the universe: records, ELO, followers, attributes,
   hype / credibility / popularity, streaks, titles, legacy, ageing and
   yearly awards. No DOM, no storage.
   ===================================================================== */

/* -------------------------- ELO probability -------------------------- */

function expectedScore(ra, rb) { return 1 / (1 + Math.pow(10, (rb - ra) / 400)); }

/* blended win probability for booking estimates + ELO leniency:
   60% ELO expectation, 40% attribute & style edge */
function winProbability(a, b) {
  const eloP = expectedScore(a.elo, b.elo);
  const oa = overall(a), ob = overall(b);
  let attrP = 1 / (1 + Math.pow(10, (ob - oa) / 16));
  // style nudge
  const ma = styleMatchup(a.style, b.style), mb = styleMatchup(b.style, a.style);
  const styleEdge = (ma.win - mb.win); // -ish small
  attrP = clamp(attrP + styleEdge * 0.12, 0.02, 0.98);
  const p = clamp(eloP * 0.6 + attrP * 0.4, 0.02, 0.98);
  return { a: p, b: 1 - p };
}

/* fighter "fame" 0..1 from followers + popularity, for social/ELO weighting */
function fame(b) {
  const f = Math.log10(Math.max(10, b.followers)) / 7.3; // 10 -> .14, 20M -> ~1
  return clamp(f * 0.7 + (b.popularity / 100) * 0.3, 0, 1.1);
}

/* --------------------------- apply a fight --------------------------- */
/* fight: { aId, bId, weightClass, rounds, titleFight, belts, date, eventName,
            venue, result } where result was produced by simulateFight().
   Mutates both boxers and the universe, fills change fields on result,
   appends to state.fights and to each boxer's history. Returns the fight. */
function applyFightResult(fight) {
  const a = getBoxer(fight.aId), b = getBoxer(fight.bId);
  const res = fight.result;
  const draw = res.draw;
  const winner = draw ? null : getBoxer(res.winnerId);
  const loser = draw ? null : getBoxer(res.loserId);
  const koMethod = (res.method === 'KO' || res.method === 'TKO');

  /* ---- ELO ---- */
  const elo = applyElo(a, b, res, fight);
  res.eloChange = elo;

  /* ---- records ---- */
  if (draw) {
    a.record.d++; b.record.d++;
  } else {
    winner.record.w++;
    loser.record.l++;
    if (koMethod) { winner.record.ko++; loser.record.koLoss++; }
  }

  /* ---- streaks ---- */
  applyStreak(a, draw ? 'D' : (winner === a ? 'W' : 'L'));
  applyStreak(b, draw ? 'D' : (winner === b ? 'W' : 'L'));

  /* ---- titles ---- */
  if (fight.titleFight && fight.belts && fight.belts.length) updateChampions(fight, winner, loser, draw);
  if (fight.titleFight) {
    if (draw) { /* champion retains; no W/L on title ledger */ }
    else { winner.titleFightsW++; loser.titleFightsL++; }
  }

  /* ---- ranked wins (beat a top-15 P4P/divisional ELO) ---- */
  if (!draw) {
    if (loser.elo >= 1500 || isRankedTop(loser)) winner.rankedWins++;
  }

  /* ---- best win / worst loss ---- */
  if (!draw) {
    const prevLoserElo = loser.elo - elo.b; // approx pre-fight (b changed) -- use opponent strength
    if (!winner.bestWinId || beatsBetter(winner, loser, fight)) winner.bestWinId = fight.id;
    if (!loser.worstLossId || worseLoss(loser, winner, fight)) loser.worstLossId = fight.id;
  }

  /* ---- followers / social ---- */
  const soc = applyFollowers(a, b, res, fight);
  res.followerChange = soc;

  /* ---- hype / credibility / popularity ---- */
  const meta = applyReputation(a, b, res, fight);
  res.hypeChange = meta.hype; res.credChange = meta.cred; res.popChange = meta.pop;

  /* ---- purses / career earnings ---- */
  const purseA = computePurse(a, b, res, fight, a.id);
  const purseB = computePurse(b, a, res, fight, b.id);
  a.earnings += purseA; b.earnings += purseB;
  res.purse = { a: purseA, b: purseB };

  /* ---- attributes + damage ---- */
  const attr = {};
  attr.a = applyAttributes(a, res, b, fight);
  attr.b = applyAttributes(b, res, a, fight);
  res.attrChange = attr;

  /* ---- legacy ---- */
  recomputeLegacy(a); recomputeLegacy(b);

  /* ---- history bookkeeping ---- */
  updatePeaks(a); updatePeaks(b);
  a.fightHistory.push(fight.id);
  b.fightHistory.push(fight.id);
  a.eloHistory.push({ d: dateToStr(fight.date), e: a.elo });
  b.eloHistory.push({ d: dateToStr(fight.date), e: b.elo });
  a.followerHistory.push({ d: dateToStr(fight.date), f: a.followers });
  b.followerHistory.push({ d: dateToStr(fight.date), f: b.followers });
  trimHist(a); trimHist(b);

  fight.simulated = true;
  state.fights.push(fight);
  return fight;
}

function trimHist(b) {
  if (b.eloHistory.length > 80) b.eloHistory = b.eloHistory.slice(-80);
  if (b.followerHistory.length > 80) b.followerHistory = b.followerHistory.slice(-80);
}

/* ------------------------------ ELO calc ----------------------------- */
function applyElo(a, b, res, fight) {
  const eA = expectedScore(a.elo, b.elo);
  const eB = 1 - eA;
  let sA, sB;
  if (res.draw) { sA = 0.5; sB = 0.5; }
  else if (res.winnerId === a.id) { sA = 1; sB = 0; }
  else { sA = 0; sB = 1; }

  const kBase = fight.titleFight ? 40 : 30;
  const kA = kBase * experienceK(a) * roundsK(fight.rounds);
  const kB = kBase * experienceK(b) * roundsK(fight.rounds);

  // performance multiplier: stoppage + dominance gives bonus to the winner
  let bonus = 1;
  if (!res.draw) {
    if (res.method === 'KO') bonus = 1.30;
    else if (res.method === 'TKO') bonus = 1.20;
    else if (res.dominant) bonus = 1.12;
    else if (res.method === 'SD' || res.method === 'MD') bonus = 0.85; // razor thin
  }

  let dA = kA * (sA - eA);
  let dB = kB * (sB - eB);
  if (!res.draw) {
    if (res.winnerId === a.id) { if (dA > 0) dA *= bonus; } else { if (dB > 0) dB *= bonus; }
    // upset sweetener: winner was the underdog
    const winnerWasDog = (res.winnerId === a.id && eA < 0.42) || (res.winnerId === b.id && eB < 0.42);
    if (winnerWasDog) { if (res.winnerId === a.id) dA *= 1.18; else dB *= 1.18; }
  }

  const before = { a: a.elo, b: b.elo };
  a.elo = Math.round(clamp(a.elo + dA, 650, 2400));
  b.elo = Math.round(clamp(b.elo + dB, 650, 2400));
  return { a: a.elo - before.a, b: b.elo - before.b };
}
function experienceK(b) {
  const f = totalFights(b);
  if (b.age < 23) return 1.35;
  if (f < 6) return 1.25;
  if (f < 15) return 1.05;
  if (f < 30) return 0.9;
  return 0.78;
}
function roundsK(r) { return r >= 12 ? 1.15 : r >= 10 ? 1.05 : r >= 8 ? 0.95 : r >= 6 ? 0.85 : 0.75; }

/* ----------------------------- streaks ------------------------------- */
function applyStreak(b, type) {
  if (b.currentStreak.type === type) b.currentStreak.count++;
  else b.currentStreak = { type, count: 1 };
}

/* ------------------------- titles / champions ------------------------ */
function updateChampions(fight, winner, loser, draw) {
  if (draw) return; // champion retains belt(s); no change
  const wc = fight.weightClass;
  if (!state.champions[wc]) state.champions[wc] = {};
  const wasChampOfAny = fight.belts.some(belt => state.champions[wc][belt] === winner.id);
  if (wasChampOfAny) winner.titleDefences++;
  fight.belts.forEach(belt => {
    const former = state.champions[wc][belt] || null;
    state.champions[wc][belt] = winner.id;
    // winner gains title
    if (!winner.titles.some(t => t.weightClass === wc && t.belt === belt)) winner.titles.push({ weightClass: wc, belt, wonDate: dateToStr(fight.date) });
    // loser loses it if they had it
    loser.titles = loser.titles.filter(t => !(t.weightClass === wc && t.belt === belt));
    state.titleHistory.push({ date: cloneDate(fight.date), weightClass: wc, belt, championId: winner.id, formerId: former, fightId: fight.id });
  });
}

function isRankedTop(b) {
  // top 15 by ELO in their division
  const div = activeBoxers().filter(x => x.weightClass === b.weightClass).sort((p, q) => q.elo - p.elo);
  return div.slice(0, 15).some(x => x.id === b.id);
}
function beatsBetter(winner, loser, fight) {
  const cur = state.fights.find(f => f.id === winner.bestWinId);
  if (!cur) return true;
  const curOpp = getBoxer(cur.aId === winner.id ? cur.bId : cur.aId);
  return !curOpp || loser.elo >= curOpp.elo;
}
function worseLoss(loser, winner, fight) {
  const cur = state.fights.find(f => f.id === loser.worstLossId);
  if (!cur) return true;
  const curOpp = getBoxer(cur.aId === loser.id ? cur.bId : cur.aId);
  return !curOpp || winner.elo <= curOpp.elo;
}

/* ----------------------------- followers ----------------------------- */
function applyFollowers(a, b, res, fight) {
  return { a: followerDelta(a, b, res, fight, a.id), b: followerDelta(b, a, res, fight, b.id) };
}
function followerDelta(me, opp, res, fight, meId) {
  const won = !res.draw && res.winnerId === meId;
  const lost = !res.draw && res.loserId === meId;
  const drew = res.draw;
  const koWin = won && (res.method === 'KO' || res.method === 'TKO');
  const koLoss = lost && (res.method === 'KO' || res.method === 'TKO');

  const stakes = stakesScore(fight);             // 0..~1.6
  const excite = res.excitement / 100;           // 0..~1.2
  const oppFame = fame(opp);                      // 0..1.1
  const beatFamous = won ? oppFame : 0;

  // base % growth on current following, plus a flat newcomer bump
  let pct = 0;
  if (won) pct = 0.06 + 0.05 * stakes + 0.05 * excite + 0.07 * beatFamous + (koWin ? 0.05 : 0);
  else if (drew) pct = 0.01 + 0.03 * excite + 0.02 * stakes;
  else { // loss
    pct = -0.04 - (koLoss ? 0.05 : 0) - 0.02 * stakes + 0.05 * excite; // exciting losses soften the blow
  }
  // unbeaten momentum
  if (won && isUndefeated(me) && totalFights(me) >= 4) pct += 0.03;
  // long losing streak bleeds harder
  if (lost && me.currentStreak.type === 'L' && me.currentStreak.count >= 3) pct -= 0.03;

  const flat = won ? (200 + 7000 * stakes + 4000 * excite + 60000 * beatFamous)
    : drew ? (100 + 1500 * excite)
      : (-50 + 2500 * excite);

  // diminishing returns: growth slows hard as a fighter approaches mega-stardom
  const sat = clamp(1 - me.followers / 60000000, 0.1, 1);
  if (pct > 0) pct *= sat;
  let delta = Math.round(me.followers * pct + flat * sat);
  delta = clamp(delta, -8000000, 6000000); // no single fight can 100x a following
  const before = me.followers;
  me.followers = Math.max(0, me.followers + delta);
  return me.followers - before;
}

/* ---------------------- hype / credibility / pop --------------------- */
function applyReputation(a, b, res, fight) {
  return {
    hype: { a: repHype(a, b, res, fight, a.id), b: repHype(b, a, res, fight, b.id) },
    cred: { a: repCred(a, b, res, fight, a.id), b: repCred(b, a, res, fight, b.id) },
    pop: { a: repPop(a, b, res, fight, a.id), b: repPop(b, a, res, fight, b.id) }
  };
}
function repHype(me, opp, res, fight, meId) {
  const won = !res.draw && res.winnerId === meId;
  const lost = !res.draw && res.loserId === meId;
  const ko = res.method === 'KO' || res.method === 'TKO';
  let d = 0;
  if (won) d = 3 + (ko ? 4 : 0) + Math.round(stakesScore(fight) * 5) + (isUndefeated(me) ? 2 : 0);
  else if (res.draw) d = -1 + Math.round(res.excitement / 30);
  else d = -6 - (ko ? 4 : 0) + Math.round(res.excitement / 35);
  if (lost && me.currentStreak.type === 'L' && me.currentStreak.count >= 2) d -= 3;
  const before = me.hype; me.hype = clamp(me.hype + d, 0, 100); return me.hype - before;
}
function repCred(me, opp, res, fight, meId) {
  const won = !res.draw && res.winnerId === meId;
  const lost = !res.draw && res.loserId === meId;
  const oppStrength = clamp((opp.elo - 1100) / 800, -0.4, 1.2);
  let d = 0;
  if (won) d = Math.round(2 + oppStrength * 6 + (res.dominant ? 2 : 0) + (fight.titleFight ? 2 : 0));
  else if (res.draw) d = Math.round(oppStrength * 2);
  else d = Math.round(-3 + oppStrength * 4); // losing to elite hurts less than losing to nobody
  const before = me.credibility; me.credibility = clamp(me.credibility + d, 0, 100); return me.credibility - before;
}
function repPop(me, opp, res, fight, meId) {
  const won = !res.draw && res.winnerId === meId;
  let d = Math.round((res.excitement - 45) / 12) + (won ? 2 : 0) + Math.round(stakesScore(fight) * 2);
  const before = me.popularity; me.popularity = clamp(me.popularity + d, 0, 100); return me.popularity - before;
}

/* stakes = how big the fight is: title, belts, combined fame, ELO level */
function stakesScore(fight) {
  const a = getBoxer(fight.aId), b = getBoxer(fight.bId);
  let s = 0;
  if (fight.titleFight) s += 0.5 + 0.12 * (fight.belts ? fight.belts.length : 0);
  s += (fame(a) + fame(b)) * 0.4;
  s += clamp((a.elo + b.elo - 2600) / 1400, 0, 0.5);
  if (fight.rounds >= 12) s += 0.1;
  return clamp(s, 0, 1.7);
}

/* ----------------------- attribute development ----------------------- */
function applyAttributes(me, res, opp, fight) {
  const meId = me.id;
  if (me.frozen) return {}; // frozen primes never change their attributes
  const won = !res.draw && res.winnerId === meId;
  const lost = !res.draw && res.loserId === meId;
  const drew = res.draw;
  const ko = res.method === 'KO' || res.method === 'TKO';
  const dominant = res.dominant && won;
  const youngFactor = me.age < 24 ? 1.7 : me.age < 28 ? 1.2 : me.age < 32 ? 1.0 : me.age < 36 ? 0.7 : 0.45;
  const learn = youngFactor * me.hidden.improvementRate;
  const deltas = {};
  const bump = (k, base) => {
    const headroom = me.hidden.potential - me.attributes[k];
    let amt = base * learn;
    if (amt > 0) amt *= clamp(headroom / 20, 0.15, 1.3); // slows near potential
    const nv = clamp(Math.round((me.attributes[k] + amt) * 100) / 100, 1, 99);
    const d = nv - me.attributes[k];
    if (Math.abs(d) >= 0.01) { me.attributes[k] = nv; deltas[k] = round1((deltas[k] || 0) + d); }
  };

  if (won) {
    bump('ringIQ', 0.5); bump('confidence', 0); // confidence handled in hidden below
    me.hidden.confidence = clamp(me.hidden.confidence + 3 + (ko ? 3 : 0), 1, 99);
    if (dominant) { bump('accuracy', 0.6); bump('combinations', 0.5); bump('power', 0.3); bump('defence', 0.4); bump('stamina', 0.4); }
    else { bump('ringIQ', 0.3); bump('jab', 0.2); }
    me.hidden.careerMomentum = clamp(me.hidden.careerMomentum + 6, -100, 100);
  } else if (drew) {
    bump('ringIQ', 0.4); bump('heart', 0.3); bump('adaptability', 0.3);
  } else { // lost
    bump('ringIQ', 0.5); bump('heart', 0.6); bump('adaptability', 0.5); // experience
    me.hidden.confidence = clamp(me.hidden.confidence - 4 - (ko ? 5 : 0), 1, 99);
    me.hidden.careerMomentum = clamp(me.hidden.careerMomentum - 7 - (ko ? 4 : 0), -100, 100);
    // bad performance erosion
    bump('stamina', -0.3);
    if (ko) { bump('chin', -0.8); bump('recovery', -0.4); me.hidden.durability = clamp(me.hidden.durability - 4, 1, 99); }
    if (me.currentStreak.type === 'L' && me.currentStreak.count >= 3) { bump('power', -0.3); bump('speed', -0.3); bump('discipline', -0.4); }
  }

  /* damage accumulation from the fight (drives long-term wear) */
  const dmgTaken = res.stats[meId === fight.aId ? 'a' : 'b'].damageTaken || 0;
  me.hidden.damageAccumulation = clamp(me.hidden.damageAccumulation + dmgTaken * 0.4, 0, 1000);
  // heavy single-night damage can shave chin/recovery a touch
  if (dmgTaken > 70) { bump('chin', -0.3); }

  /* injury: a brutal KO loss can sideline a fighter (player still controls bookings) */
  if (lost && ko && chance(0.2 + (me.age > 33 ? 0.15 : 0))) {
    me.injury = { type: pick(['hand', 'eye socket', 'concussion', 'rib']), since: dateToStr(fight.date) };
  } else if (won && me.injury && chance(0.5)) {
    me.injury = null; // shook off a niggle
  }

  return deltas;
}

/* ------------------------------ legacy ------------------------------- */
function recomputeLegacy(b) {
  const r = b.record;
  const winQuality = b.rankedWins * 8 + r.ko * 2;
  const titlePts = b.titleFightsW * 12 + (b.titles.length * 6);
  const elite = clamp((b.elo - 1300) / 12, 0, 70);
  const longevity = clamp(totalFights(b) * 1.2, 0, 60);
  const drama = clamp((b.popularity - 30) / 2, 0, 25);
  const peak = b.hidden.legacyScore; // monotonic-ish: keep best
  const val = Math.round(winQuality + titlePts + elite + longevity + drama);
  b.hidden.legacyScore = Math.max(peak, val);
}

/* ------------------------------ ageing ------------------------------- */
/* called once per in-game year (on the 1 Jan crossing) for active fighters */
function ageBoxerOneYear(b) {
  if (b.frozen) return; // frozen primes do not age or change
  b.age++;
  b.birthYear = state.date.y - b.age;
  const a = b.attributes;
  const adj = (k, d) => { a[k] = clamp(Math.round((a[k] + d) * 10) / 10, 1, 99); };

  if (b.age <= 24) {
    // late development toward potential
    const phys = ['power', 'speed', 'stamina', 'combinations', 'accuracy', 'jab'];
    phys.forEach(k => { const head = b.hidden.potential - a[k]; if (head > 0) adj(k, clamp(head * 0.12, 0, 3) * b.hidden.improvementRate); });
    adj('ringIQ', 1.2); adj('footwork', 0.6);
  } else if (b.age <= b.hidden.primeAge + 1) {
    adj('ringIQ', 0.8); adj('combinations', 0.3); adj('counterpunching', 0.3);
    if (chance(0.4)) adj('power', 0.4);
  } else if (b.age <= b.hidden.declineAge) {
    // slow decline; ring IQ still climbs
    const wear = 0.4 + b.hidden.damageAccumulation / 400;
    adj('speed', -1.0 * wear); adj('stamina', -0.9 * wear); adj('recovery', -0.7 * wear);
    adj('ringIQ', 0.6); adj('chin', -0.4 * wear);
  } else {
    const wear = 1.0 + b.hidden.damageAccumulation / 250;
    adj('speed', -2.2 * wear); adj('stamina', -2.0 * wear); adj('recovery', -1.8 * wear);
    adj('power', -1.2 * wear); adj('chin', -1.4 * wear); adj('reflexes', 0);
    adj('footwork', -1.5 * wear); adj('killerInstinct', -1.0);
    adj('ringIQ', 0.2);
    // older + damaged => higher injury risk flag
    if (chance(0.12)) b.injury = { type: pick(['back', 'shoulder', 'hand', 'knee']), since: dateToStr(state.date) };
  }
  // confidence drifts toward 60 when idle
  b.hidden.confidence = clamp(Math.round(b.hidden.confidence + (60 - b.hidden.confidence) * 0.1), 1, 99);
}

function ageAllForYear() {
  activeBoxers().forEach(ageBoxerOneYear);
}

/* ------------------------------ awards ------------------------------- */
function computeAwardsForYear(year) {
  const fights = state.fights.filter(f => f.date.y === year && f.simulated);
  if (!fights.length) return null;

  // fighter-year aggregates
  const agg = {};
  const touch = id => { if (!agg[id]) agg[id] = { id, w: 0, l: 0, d: 0, ko: 0, eloGain: 0, quality: 0, fights: 0 }; return agg[id]; };
  fights.forEach(f => {
    const r = f.result;
    const A = touch(f.aId), B = touch(f.bId);
    A.fights++; B.fights++;
    A.eloGain += r.eloChange.a; B.eloGain += r.eloChange.b;
    if (r.draw) { A.d++; B.d++; }
    else {
      const win = touch(r.winnerId), lose = touch(r.loserId);
      win.w++; lose.l++;
      if (r.method === 'KO' || r.method === 'TKO') win.ko++;
      const opp = getBoxer(r.loserId);
      win.quality += clamp((opp ? opp.elo : 1000) - 1100, 0, 900) / 100 + (f.titleFight ? 4 : 0);
    }
  });

  const arr = Object.values(agg).map(x => { x.box = getBoxer(x.id); return x; }).filter(x => x.box);

  const foty = arr.slice().sort((p, q) => (q.quality + q.w * 2 + q.eloGain / 25) - (p.quality + p.w * 2 + p.eloGain / 25))[0];
  const rise = arr.slice().sort((p, q) => q.eloGain - p.eloGain)[0];
  const fall = arr.slice().sort((p, q) => p.eloGain - q.eloGain)[0];
  const prospects = arr.filter(x => x.box.age <= 24).sort((p, q) => (q.w * 2 + q.eloGain / 20) - (p.w * 2 + p.eloGain / 20));
  const prospect = prospects[0];

  const foy = fights.slice().sort((p, q) => q.result.excitement - p.result.excitement)[0];
  const kos = fights.filter(f => f.result.method === 'KO' || f.result.method === 'TKO');
  const koty = kos.slice().sort((p, q) => (q.result.excitement + (q.result.round <= 3 ? 15 : 0)) - (p.result.excitement + (p.result.round <= 3 ? 15 : 0)))[0];
  const upsets = fights.filter(f => !f.result.draw).map(f => {
    const w = getBoxer(f.result.winnerId), l = getBoxer(f.result.loserId);
    return { f, gap: (l ? l.elo : 0) - (w ? w.elo - f.result.eloChange.a : 0) };
  }).sort((p, q) => q.gap - p.gap);
  const upset = upsets[0];

  const out = {
    year,
    fighterOfYear: foty ? foty.id : null,
    fightOfYear: foy ? foy.id : null,
    knockoutOfYear: koty ? koty.id : null,
    upsetOfYear: upset ? upset.f.id : null,
    prospectOfYear: prospect ? prospect.id : null,
    biggestRise: rise ? rise.id : null,
    biggestFall: (fall && fall.eloGain < 0) ? fall.id : null
  };
  state.awards[year] = out;
  return out;
}

/* ------------------------- purses / earnings ------------------------- */
/* A fight pays both fighters (win or lose). Purse scales with the
   fighter's own draw (fame + ELO), the size of the fight (stakes), the
   number of rounds, and a winner bump. Big names in big title fights
   pull in eye-watering purses -> all-time earnings board stays alive. */
function computePurse(me, opp, res, fight, meId) {
  const stakes = stakesScore(fight);                 // 0..~1.7
  const drawPower = 60000 + fame(me) * 4200000 + Math.max(0, me.elo - 1200) * 3200;
  const eventBump = 1 + stakes * 1.4;                // big cards pay everyone more
  const titleMult = fight.titleFight ? (1.35 + 0.12 * (fight.belts ? fight.belts.length : 0)) : 1;
  const roundsMult = fight.rounds >= 12 ? 1.3 : fight.rounds >= 10 ? 1.12 : fight.rounds >= 8 ? 1.0 : 0.85;
  const won = !res.draw && res.winnerId === meId;
  const winMult = won ? 1.18 : res.draw ? 1.0 : 0.92;
  const base = drawPower * eventBump * titleMult * roundsMult * winMult;
  return Math.max(2000, Math.round(base * rnd(0.9, 1.12)));
}

/* ------------------------------ peaks -------------------------------- */
function updatePeaks(b) {
  if (b.elo > (b.peakElo || 0)) b.peakElo = b.elo;
  if (b.followers > (b.peakFollowers || 0)) b.peakFollowers = b.followers;
}
