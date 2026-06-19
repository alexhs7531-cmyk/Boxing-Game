/* =====================================================================
   fightEngine.js  -  fight simulation (pure: never mutates a boxer)
   ---------------------------------------------------------------------
   simulateFight(a, b, opts) -> result object. engine.js applies effects.
   The model: each fighter has a 0..100 "health" pool and a 0..100
   stamina pool. Power punches (weighted by power vs chin and by style
   matchup) drain health; knockdowns and accumulation cause stoppages.
   Style matchups, ageing-affected ratings, stamina fade and indiscipline
   all feed the outcome, so the ratings/leaderboards downstream stay real.
   ===================================================================== */

function n100(x) { return x / 100; }

/* ----- style matchup: modifiers for ME fighting OPP ----- */
function styleMatchup(meStyle, oppStyle) {
  const me = STYLE_PROFILES[meStyle] || STYLE_PROFILES['Balanced'];
  const oppAggressive = ['Pressure Fighter', 'Swarmer', 'Slugger', 'Volume Puncher', 'Knockout Artist'].includes(oppStyle);
  const oppRunner = ['Out Boxer', 'Defensive Master', 'Technical Boxer', 'Counter Puncher'].includes(oppStyle);

  let acc = 1, dmg = 1, output = 1, counterBonus = 0, win = 0;

  if ((meStyle === 'Counter Puncher' || meStyle === 'Defensive Master') && oppAggressive) {
    acc += 0.10; counterBonus += me.counter + 0.06; dmg += 0.08; win += 0.10;
  }
  if ((meStyle === 'Out Boxer' || meStyle === 'Technical Boxer') && oppAggressive) {
    acc += 0.04; win += 0.05;
  }
  if ((meStyle === 'Pressure Fighter' || meStyle === 'Swarmer') && oppRunner) {
    output += 0.05; win += 0.06;
  }
  if (meStyle === 'Slugger') { win -= 0.02; }

  return { acc, dmg, output, counterBonus, win, defReduce: me.defence, koThreat: me.koThreat, decision: me.decision, drainOpp: me.drainOpp || 0, sp: me };
}

/* ----- derive fight ratings from a boxer (read-only) ----- */
function derive(b) {
  const a = b.attributes;
  const agePen = b.age > 32 ? (b.age - 32) * 0.012 : 0;
  const conditioning = clamp(n100(a.stamina) * 0.65 + n100(a.discipline) * 0.2 + n100(a.recovery) * 0.15 - agePen, 0.2, 1);
  const offAcc = n100(a.accuracy) * 0.5 + n100(a.ringIQ) * 0.2 + n100(a.jab) * 0.15 + n100(a.speed) * 0.15;
  const defRating = clamp(n100(a.defence) * 0.38 + n100(a.footwork) * 0.24 + n100(a.ringIQ) * 0.19 + n100(a.speed) * 0.14 + n100(a.adaptability) * 0.05 - agePen * 0.5, 0.05, 0.98);
  const powerRating = clamp(n100(a.power) * 0.85 + n100(a.killerInstinct) * 0.15, 0.05, 1);
  const chinRating = clamp(n100(a.chin) * 0.55 + n100(a.recovery) * 0.2 + n100(b.hidden.durability) * 0.15 + n100(a.heart) * 0.1 - agePen, 0.05, 1);
  const sp = STYLE_PROFILES[b.style] || STYLE_PROFILES['Balanced'];
  const outputBase = (0.5 + n100(a.aggression) * 0.5) * sp.volume * 58 * (0.9 + n100(a.combinations) * 0.2);
  const powerShare = clamp(sp.power * (0.8 + n100(a.power) * 0.4), 0.18, 0.6);
  const bodyShare = clamp(0.12 + n100(a.bodyPunching) * 0.22 + (sp.body || 0), 0.08, 0.45);
  return {
    id: b.id, name: b.name, style: b.style, sp,
    conditioning, offAcc, defRating, powerRating, chinRating,
    heart: n100(a.heart), ringIQ: n100(a.ringIQ), recovery: n100(a.recovery),
    cutRes: n100(a.cutResistance), discipline: n100(a.discipline),
    counterAff: n100(a.counterpunching), combo: n100(a.combinations),
    adapt: n100(a.adaptability), clinch: n100(a.clinch),
    outputBase, powerShare, bodyShare, age: b.age
  };
}

/* ----- main ----- */
/* Judging variance: a small skill edge should win a round only ~55% of the
   time, so close fights are genuinely winnable by the underdog, while large
   gaps still sweep the cards (and usually end in stoppage anyway). Tuned
   against measured per-round score margins (~1.25 pts per rating-gap point). */
const ROUND_NOISE = 116;   // SD of the shared per-round judging swing
const EVEN_BAND = 0.6;     // |edge| below this is a 10-10 round (kept rare)
const JUDGE_BIAS = 3.0;    // how much individual judges can differ
const NIGHT_FORM_SD = 0.03; // each fighter has slightly better/worse nights
function nrand() { return ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2; } // ~[-1,1], SD ~0.33

function simulateFight(boxA, boxB, opts) {
  opts = opts || {};
  const scheduled = opts.rounds || 12;
  const A = derive(boxA), B = derive(boxB);
  // off/on night: a touch of per-fight variance so rematches aren't identical
  A.offAcc = clamp(A.offAcc * (1 + nrand() * NIGHT_FORM_SD), 0.05, 0.99);
  B.offAcc = clamp(B.offAcc * (1 + nrand() * NIGHT_FORM_SD), 0.05, 0.99);
  A.powerRating = clamp(A.powerRating * (1 + nrand() * NIGHT_FORM_SD), 0.05, 1);
  B.powerRating = clamp(B.powerRating * (1 + nrand() * NIGHT_FORM_SD), 0.05, 1);
  A.defRating = clamp(A.defRating * (1 + nrand() * NIGHT_FORM_SD), 0.05, 0.98);
  B.defRating = clamp(B.defRating * (1 + nrand() * NIGHT_FORM_SD), 0.05, 0.98);
  const mAB = styleMatchup(A.style, B.style);
  const mBA = styleMatchup(B.style, A.style);

  const fs = {
    a: { health: 100, stam: 100, cut: 0, fouls: 0, dmgTaken: 0 },
    b: { health: 100, stam: 100, cut: 0, fouls: 0, dmgTaken: 0 }
  };
  const totals = {
    a: { thrown: 0, landed: 0, power: 0, body: 0, counters: 0, damageTaken: 0 },
    b: { thrown: 0, landed: 0, power: 0, body: 0, counters: 0, damageTaken: 0 }
  };
  const cards = [
    { name: 'Judge A', bias: rnd(-0.85, 0.85), a: 0, b: 0 },
    { name: 'Judge B', bias: rnd(-0.85, 0.85), a: 0, b: 0 },
    { name: 'Judge C', bias: rnd(-0.85, 0.85), a: 0, b: 0 }
  ];

  const rounds = [];
  let ended = null, lastWinner = null, leadChanges = 0;
  let scoreSumA = 0, scoreSumB = 0;

  for (let r = 1; r <= scheduled; r++) {
    const ro = simulateRound(A, B, mAB, mBA, fs, r, scheduled);
    ['a', 'b'].forEach(s => {
      totals[s].thrown += ro[s].t; totals[s].landed += ro[s].l;
      totals[s].power += ro[s].p; totals[s].body += ro[s].b; totals[s].counters += ro[s].c;
    });
    totals.a.damageTaken += ro.dmgToA; totals.b.damageTaken += ro.dmgToB;
    scoreSumA += ro.scoreA; scoreSumB += ro.scoreB;

    // the round's outcome carries real variance: a shared swing the judges
    // mostly agree on, plus a small per-judge difference of opinion
    const baseEdge = (ro.scoreA - ro.scoreB) + nrand() * ROUND_NOISE;
    cards.forEach(c => {
      const edge = baseEdge + c.bias * JUDGE_BIAS;
      let pa, pb;
      if (Math.abs(edge) < EVEN_BAND && ro.kdA === 0 && ro.kdB === 0) { pa = 10; pb = 10; }
      else if (edge >= 0) { pa = 10; pb = 9; } else { pa = 9; pb = 10; }
      pb -= ro.kdB; pa -= ro.kdA; pa -= ro.foulA; pb -= ro.foulB;
      c.a += clamp(pa, 6, 10); c.b += clamp(pb, 6, 10);
    });

    const win = baseEdge > EVEN_BAND ? 'A' : baseEdge < -EVEN_BAND ? 'B' : 'E';
    if (win !== 'E') { if (lastWinner && lastWinner !== win) leadChanges++; lastWinner = win; }
    rounds.push({ a: ro.a, b: ro.b, kdA: ro.kdA, kdB: ro.kdB, cutA: ro.cutANew, cutB: ro.cutBNew, win });

    if (ro.ended) { ended = ro.ended; rounds[rounds.length - 1].endRound = true; break; }
  }

  const result = { rounds, scorecards: cards.map(c => ({ name: c.name, a: c.a, b: c.b })), stats: totals };
  let method, winnerId = null, loserId = null, draw = false, roundEnd = rounds.length, timeStr = 'Decision', dominant = false;

  if (ended) {
    method = ended.method; roundEnd = ended.round; timeStr = ended.timeStr;
    if (ended.winner === 'a') { winnerId = boxA.id; loserId = boxB.id; }
    else if (ended.winner === 'b') { winnerId = boxB.id; loserId = boxA.id; }
    else if (ended.winner === '__tech__') {
      const dec = decideDecision(cards, boxA.id, boxB.id, scoreSumA - scoreSumB);
      winnerId = dec.winnerId; loserId = dec.loserId; draw = dec.draw;
    } else { draw = true; }
    dominant = (method === 'KO' || method === 'TKO' || method === 'RTD');
  } else {
    const dec = decideDecision(cards, boxA.id, boxB.id, scoreSumA - scoreSumB);
    method = dec.method; draw = dec.draw; winnerId = dec.winnerId; loserId = dec.loserId;
    if (!draw) dominant = avgMargin(cards, winnerId === boxA.id ? 'a' : 'b') >= scheduled * 0.5;
  }

  result.method = method; result.round = roundEnd; result.timeStr = timeStr;
  result.draw = draw; result.winnerId = winnerId; result.loserId = loserId; result.dominant = dominant;
  result.excitement = excitementScore(result, totals, leadChanges, scheduled);
  result.commentary = buildCommentary(boxA, boxB, rounds, result);
  result.summary = buildSummary(boxA, boxB, result);
  return result;
}

/* ----- a single round ----- */
function simulateRound(A, B, mAB, mBA, fs, r, scheduled) {
  const out = { a: { t: 0, l: 0, p: 0, b: 0, c: 0 }, b: { t: 0, l: 0, p: 0, b: 0, c: 0 } };
  const freshA = 0.55 + 0.45 * (fs.a.stam / 100), freshB = 0.55 + 0.45 * (fs.b.stam / 100);
  const hurtA = fs.a.health < 30 ? 0.8 : 1, hurtB = fs.b.health < 30 ? 0.8 : 1;

  out.a.t = Math.max(6, Math.round(A.outputBase * mAB.output * freshA * hurtA * rnd(0.80, 1.20)));
  out.b.t = Math.max(6, Math.round(B.outputBase * mBA.output * freshB * hurtB * rnd(0.80, 1.20)));

  const landA = clamp(landRate(A, B, mAB, freshB, (r - 1) / scheduled), 0.08, 0.6);
  const landB = clamp(landRate(B, A, mBA, freshA, (r - 1) / scheduled), 0.08, 0.6);
  out.a.l = Math.round(out.a.t * landA);
  out.b.l = Math.round(out.b.t * landB);

  out.a.p = Math.round(out.a.l * A.powerShare * rnd(0.85, 1.15));
  out.b.p = Math.round(out.b.l * B.powerShare * rnd(0.85, 1.15));
  out.a.b = Math.round(out.a.l * A.bodyShare);
  out.b.b = Math.round(out.b.l * B.bodyShare);
  out.a.c = Math.round(out.a.l * clamp(A.counterAff * 0.3 + mAB.counterBonus, 0, 0.55) * (B.sp.volume > 1.05 ? 1.2 : 0.7));
  out.b.c = Math.round(out.b.l * clamp(B.counterAff * 0.3 + mBA.counterBonus, 0, 0.55) * (A.sp.volume > 1.05 ? 1.2 : 0.7));

  let dmgToB = damage(A, B, out.a.p, out.a.c, mAB);
  let dmgToA = damage(B, A, out.b.p, out.b.c, mBA);
  // a hurt fighter ties up — clinch reduces incoming punishment and buys survival
  if (fs.b.health < 32) dmgToB *= (1 - B.clinch * 0.28);
  if (fs.a.health < 32) dmgToA *= (1 - A.clinch * 0.28);
  fs.b.health = clamp(fs.b.health - dmgToB, -25, 100);
  fs.a.health = clamp(fs.a.health - dmgToA, -25, 100);
  out.dmgToB = dmgToB; out.dmgToA = dmgToA;
  fs.b.dmgTaken += dmgToB; fs.a.dmgTaken += dmgToA;

  fs.b.stam -= out.a.b * 0.08; fs.a.stam -= out.b.b * 0.08;
  // pressure drains the opponent, but a good clinch resists being mauled inside
  fs.a.stam = clamp(fs.a.stam - out.a.t * (0.16 / (0.5 + A.conditioning)) - mBA.drainOpp * 6 * (1 - A.clinch * 0.4) + (4 + A.recovery * 5), 0, 100);
  fs.b.stam = clamp(fs.b.stam - out.b.t * (0.16 / (0.5 + B.conditioning)) - mAB.drainOpp * 6 * (1 - B.clinch * 0.4) + (4 + B.recovery * 5), 0, 100);

  // recovery between rounds is blunted by accumulated punishment and by a heavy round
  const wearA = clamp(fs.a.dmgTaken / 460, 0, 0.36), wearB = clamp(fs.b.dmgTaken / 460, 0, 0.36);
  const recA = (fs.a.health < 25 ? (1.8 + A.recovery * 1.9) : (3.2 + A.recovery * 3.4)) * (1 - wearA) * clamp(1 - dmgToA / 42, 0.45, 1);
  const recB = (fs.b.health < 25 ? (1.8 + B.recovery * 1.9) : (3.2 + B.recovery * 3.4)) * (1 - wearB) * clamp(1 - dmgToB / 42, 0.45, 1);
  fs.a.health = clamp(fs.a.health + recA, -25, 100);
  fs.b.health = clamp(fs.b.health + recB, -25, 100);

  out.cutANew = 0; out.cutBNew = 0;
  if (chance(clamp(out.a.p * 0.012 * (1.25 - B.cutRes), 0, 0.5))) { fs.b.cut += rnd(1, 3) * (1.3 - B.cutRes); out.cutBNew = 1; }
  if (chance(clamp(out.b.p * 0.012 * (1.25 - A.cutRes), 0, 0.5))) { fs.a.cut += rnd(1, 3) * (1.3 - A.cutRes); out.cutANew = 1; }

  out.foulA = 0; out.foulB = 0;
  if (A.discipline < 0.35 && chance((0.35 - A.discipline) * 0.18)) { fs.a.fouls++; out.foulA = 1; }
  if (B.discipline < 0.35 && chance((0.35 - B.discipline) * 0.18)) { fs.b.fouls++; out.foulB = 1; }

  out.kdB = knockdownRoll(A, B, out.a.p, out.a.c, fs.b, mAB);
  out.kdA = knockdownRoll(B, A, out.b.p, out.b.c, fs.a, mBA);
  if (out.kdB) { fs.b.health = clamp(fs.b.health - rndi(10, 22) * out.kdB, -30, 100); }
  if (out.kdA) { fs.a.health = clamp(fs.a.health - rndi(10, 22) * out.kdA, -30, 100); }

  out.scoreA = out.a.l + out.a.p * 1.7 + out.a.c * 0.8 + out.kdB * 12;
  out.scoreB = out.b.l + out.b.p * 1.7 + out.b.c * 0.8 + out.kdA * 12;

  out.ended = resolveStoppage(A, B, fs, out, r, scheduled);
  return out;
}

function landRate(att, def, m, oppFresh, roundProg) {
  const base = 0.30 + (att.offAcc - 0.5) * 0.5 + (att.combo - 0.5) * 0.07; // combinations land cleaner in bunches
  const reduce = (def.defRating - 0.45) * 0.32 + m.defReduce * 0.12;
  let lr = base - reduce + (m.acc - 1) * 0.5 * (1 - def.adapt * 0.4); // an adaptable defender blunts a style edge
  lr += att.adapt * 0.05 * (roundProg || 0);                          // figures the opponent out as rounds pass
  lr *= (1 + (1 - oppFresh) * 0.35);                                  // a tired opponent gets hit more
  return lr;
}
function damage(att, def, power, counters, m) {
  const dmgPerPower = 0.42 + att.powerRating * 1.08;
  const chinFactor = clamp(1.12 - def.chinRating * 0.7, 0.4, 1.12);
  let dmg = (power + counters * 0.7) * dmgPerPower * chinFactor * m.dmg;
  // a fighter being comprehensively outboxed gets caught cleaner and harder
  const domGap = clamp(att.offAcc - def.defRating, 0, 0.5);
  dmg *= (1 + domGap * 0.4);
  if (chance(0.06 * m.koThreat)) dmg *= rnd(1.35, 2.0); // puncher's chance
  return Math.max(0, dmg * rnd(0.8, 1.2));
}
function knockdownRoll(att, def, power, counters, defState, m) {
  const wear = clamp((defState.dmgTaken || 0) / 440, 0, 0.4);
  const effChin = clamp(def.chinRating * (1 - wear * 0.4), 0.05, 1); // accumulated damage erodes the chin
  const healthOpen = 1 + (1 - defState.health / 100) * 1.4;
  let p = (power + counters * 0.8) / 8 * (0.5 + att.powerRating) * (1.2 - effChin) * healthOpen * 0.05 * m.koThreat;
  p = clamp(p, 0, 0.7);
  if (!chance(p)) return 0;
  return (defState.health < 18 && chance(0.22)) ? 2 : 1;
}

function resolveStoppage(A, B, fs, out, r, scheduled) {
  const t = () => `${rndi(0, 2)}:${String(rndi(0, 59)).padStart(2, '0')}`;
  if (fs.a.fouls >= 3) return { method: 'DQ', round: r, timeStr: t(), winner: 'b' };
  if (fs.b.fouls >= 3) return { method: 'DQ', round: r, timeStr: t(), winner: 'a' };

  const koCheck = (defState, def, winner, kdKey) => {
    const kd = out[kdKey];
    if (kd >= 3) return { method: 'TKO', round: r, timeStr: t(), winner };
    if (kd >= 1) {
      const koP = clamp((1 - defState.health / 100) * (1.1 - def.heart) * (kd >= 2 ? 1.5 : 1) * 0.62, 0, 0.9);
      if (chance(koP)) return { method: 'KO', round: r, timeStr: t(), winner };
      if (defState.health <= 12 && chance(clamp((12 - defState.health) / 12 * 0.55 + 0.14, 0, 0.8))) return { method: 'TKO', round: r, timeStr: t(), winner };
    }
    if (defState.health <= 8 && chance(0.45)) return { method: 'TKO', round: r, timeStr: t(), winner };
    return null;
  };
  if (fs.b.health <= fs.a.health) {
    let k = koCheck(fs.b, B, 'a', 'kdB'); if (k) return k;
    k = koCheck(fs.a, A, 'b', 'kdA'); if (k) return k;
  } else {
    let k = koCheck(fs.a, A, 'b', 'kdA'); if (k) return k;
    k = koCheck(fs.b, B, 'a', 'kdB'); if (k) return k;
  }

  // accumulation: a fighter taking a sustained, one-sided beating gets pulled out
  const accChk = (defState, attState, winner) => {
    if (defState.dmgTaken > 240 && defState.health < 34 && defState.dmgTaken > attState.dmgTaken * 2.0) {
      const p = clamp((defState.dmgTaken - 240) / 320 + (34 - defState.health) / 34 * 0.16, 0, 0.32);
      if (chance(p)) return { method: 'TKO', round: r, timeStr: t(), winner };
    }
    return null;
  };
  { let ac = accChk(fs.b, fs.a, 'a'); if (ac) return ac; ac = accChk(fs.a, fs.b, 'b'); if (ac) return ac; }

  if (r < scheduled) {
    if (fs.b.health < 22 && B.heart < 0.5 && chance((0.5 - B.heart) * 0.5)) return { method: 'RTD', round: r, timeStr: 'end of round', winner: 'a' };
    if (fs.a.health < 22 && A.heart < 0.5 && chance((0.5 - A.heart) * 0.5)) return { method: 'RTD', round: r, timeStr: 'end of round', winner: 'b' };
  }

  const docCheck = (defState, winner) => {
    if (defState.cut >= 6) {
      const p = clamp((defState.cut - 6) * 0.12 + 0.12 + r * 0.01, 0, 0.7);
      if (chance(p)) {
        if (chance(0.25)) {
          if (r >= 4) return { method: 'Technical Decision', round: r, timeStr: 'cut (clash)', winner: '__tech__' };
          return { method: 'Technical Draw', round: r, timeStr: 'cut (clash)', winner: null };
        }
        return { method: 'TKO', round: r, timeStr: 'doctor stops it', winner };
      }
    }
    return null;
  };
  let d = docCheck(fs.b, 'a'); if (d) return d;
  d = docCheck(fs.a, 'b'); if (d) return d;
  return null;
}

/* ----- decision from scorecards ----- */
function decideDecision(cards, aId, bId, tbreak) {
  let ja = 0, jb = 0, jd = 0;
  cards.forEach(c => { if (c.a > c.b) ja++; else if (c.b > c.a) jb++; else jd++; });
  const ta = cards.reduce((s, c) => s + c.a, 0), tb = cards.reduce((s, c) => s + c.b, 0);
  if (ja === 3) return { method: 'UD', winnerId: aId, loserId: bId, draw: false };
  if (jb === 3) return { method: 'UD', winnerId: bId, loserId: aId, draw: false };
  if (ja === 2 && jb === 1) return { method: 'SD', winnerId: aId, loserId: bId, draw: false };
  if (jb === 2 && ja === 1) return { method: 'SD', winnerId: bId, loserId: aId, draw: false };
  if (ja === 2 && jd === 1) return { method: 'MD', winnerId: aId, loserId: bId, draw: false };
  if (jb === 2 && jd === 1) return { method: 'MD', winnerId: bId, loserId: aId, draw: false };
  // level or three-way split: the official card tally decides; if that is level too,
  // the fight-long work breaks it, and only a genuinely dead-even fight is a draw.
  const lead = (ta !== tb) ? (ta - tb) : (tbreak || 0);
  const DRAW_EPS = 3;
  if (lead > DRAW_EPS || (ta > tb)) return { method: 'MD', winnerId: aId, loserId: bId, draw: false };
  if (lead < -DRAW_EPS || (tb > ta)) return { method: 'MD', winnerId: bId, loserId: aId, draw: false };
  if (ja === 1 && jb === 1 && jd === 1) return { method: 'Split Draw', draw: true, winnerId: null, loserId: null };
  return { method: 'Draw', draw: true, winnerId: null, loserId: null };
}
function avgMargin(cards, side) {
  let g = 0; cards.forEach(c => { g += side === 'a' ? (c.a - c.b) : (c.b - c.a); });
  return g / cards.length;
}

/* ----- excitement 5..100 ----- */
function excitementScore(res, totals, leadChanges, scheduled) {
  const totalLanded = totals.a.landed + totals.b.landed;
  const totalPower = totals.a.power + totals.b.power;
  let kd = 0; res.rounds.forEach(r => kd += r.kdA + r.kdB);
  let e = 30;
  e += clamp(totalLanded / scheduled, 0, 60) * 0.5;
  e += clamp(totalPower / (scheduled * 0.5), 0, 60) * 0.4;
  e += kd * 7 + leadChanges * 4;
  if (res.method === 'KO') e += 18; else if (res.method === 'TKO' || res.method === 'RTD') e += 12;
  if (!res.draw && (res.method === 'SD' || res.method === 'MD')) e += 8;
  if (res.method === 'Draw' || res.method === 'Split Draw') e += 6;
  return clamp(Math.round(e), 5, 100);
}

/* ----- concise commentary (you're not here to watch, so just the beats) ----- */
function buildCommentary(a, b, rounds, res) {
  const lines = [];
  const aN = a.name.split(' ').pop(), bN = b.name.split(' ').pop();
  const opener = [
    `${a.name} and ${b.name} touch gloves to get us underway.`,
    `The opening bell sounds — ${aN} and ${bN} feeling each other out.`,
    `${a.name} starts on the front foot against ${b.name}.`
  ];
  lines.push(pick(opener));
  rounds.forEach((r, i) => {
    const n = i + 1;
    if (r.kdB) lines.push(`Round ${n}: ${aN} drops ${bN}${r.kdB > 1 ? ' twice' : ''} — big moment in the fight.`);
    if (r.kdA) lines.push(`Round ${n}: ${bN} puts ${aN} on the canvas${r.kdA > 1 ? ' twice' : ''}!`);
    if (r.cutB && !r.kdB) lines.push(`Round ${n}: a cut opens up over ${bN}'s eye.`);
    if (r.cutA && !r.kdA) lines.push(`Round ${n}: ${aN} is marked up, blood trickling from a cut.`);
    if (r.endRound) {
      if (res.method === 'KO') lines.push(`Round ${n}: it's all over — ${res.winnerId === a.id ? aN : bN} lands flush and the fight is stopped. KO.`);
      else if (res.method === 'TKO') lines.push(`Round ${n}: the referee has seen enough — TKO win for ${res.winnerId === a.id ? aN : bN}.`);
      else if (res.method === 'RTD') lines.push(`Round ${n}: the corner pulls their fighter out between rounds.`);
      else if (res.method.indexOf('Technical') === 0) lines.push(`Round ${n}: the bout is waved off after a cut — it goes to the cards.`);
      else if (res.method === 'DQ') lines.push(`Round ${n}: disqualification — the fouls were too much to ignore.`);
    }
  });
  if (res.timeStr === 'Decision') {
    if (res.draw) lines.push(`After ${rounds.length} hard rounds, the judges can't separate them.`);
    else lines.push(`The final bell rings after ${rounds.length} rounds — it's in the hands of the judges.`);
  }
  return lines.slice(0, 8);
}

function buildSummary(a, b, res) {
  if (res.draw) {
    const med = medianCard(res.scorecards);
    return `${a.name} and ${b.name} fight to a ${res.method.toLowerCase()} (${med})`;
  }
  const w = res.winnerId === a.id ? a : b, l = res.winnerId === a.id ? b : a;
  if (res.timeStr === 'Decision') {
    const med = medianCard(res.scorecards, res.winnerId === a.id);
    const full = { UD: 'unanimous decision', SD: 'split decision', MD: 'majority decision', 'Technical Decision': 'technical decision' }[res.method] || res.method;
    return `${w.name} def. ${l.name} by ${full} (${med})`;
  }
  const full = { KO: 'KO', TKO: 'TKO', RTD: 'corner retirement', DQ: 'disqualification', 'Technical Decision': 'technical decision' }[res.method] || res.method;
  return `${w.name} def. ${l.name} by ${full}, Round ${res.round}`;
}
function medianCard(cards, aIsWinner) {
  // present the middle judge's card, winner's score first
  const sorted = cards.slice().sort((x, y) => (x.a - x.b) - (y.a - y.b));
  const m = sorted[1];
  if (aIsWinner === undefined) return `${m.a}-${m.b}`;
  return aIsWinner ? `${m.a}-${m.b}` : `${m.b}-${m.a}`;
}

/* ----- pre-fight estimates for the booking screen ----- */
function estimateFight(a, b, opts) {
  opts = opts || {};
  const rounds = opts.rounds || 12, titleFight = !!opts.titleFight, belts = opts.belts || [];
  const fake = { id: 'est', aId: a.id, bId: b.id, weightClass: opts.weightClass || a.weightClass, rounds, titleFight, belts, date: state.date };
  const stakes = stakesScore(fake);

  // Monte-Carlo the actual engine so the forecast reflects what truly happens,
  // including how decisive a big skill gap really is.
  const N = 200;
  let aw = 0, bw = 0, dr = 0, stop = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateFight(a, b, { rounds, titleFight });
    if (r.draw) dr++; else if (r.winnerId === a.id) aw++; else bw++;
    if (r.method === 'KO' || r.method === 'TKO' || r.method === 'RTD') stop++;
  }
  const winA = aw / N, winB = bw / N, stoppage = stop / N;
  const fav = winA >= winB ? a : b;

  const eA = expectedScore(a.elo, b.elo);
  const kA = (titleFight ? 40 : 30) * experienceK(a) * roundsK(rounds);
  const kB = (titleFight ? 40 : 30) * experienceK(b) * roundsK(rounds);
  const aWin = Math.round(kA * (1 - eA)), aLose = Math.round(kA * (0 - eA));
  const bWin = Math.round(kB * eA), bLose = Math.round(kB * (eA - 1));

  const favRisk = Math.abs(fav === a ? aLose : bLose);
  const favReward = fav === a ? aWin : bWin;

  const purseEst = computePurse(a, b, { draw: false, winnerId: a.id }, fake, a.id) + computePurse(b, a, { draw: false, winnerId: b.id }, fake, b.id);
  const socialA = Math.round(a.followers * (0.06 + 0.05 * stakes) + 8000 * stakes + 200);
  const socialB = Math.round(b.followers * (0.06 + 0.05 * stakes) + 8000 * stakes + 200);

  return {
    winA: Math.round(winA * 100), winB: Math.round(winB * 100), drawPct: Math.round(dr / N * 100),
    favId: fav.id,
    hype: clamp(Math.round(stakes * 62 + (a.hype + b.hype) / 4), 1, 100),
    stakes,
    stoppagePct: Math.round(stoppage * 100), decisionPct: Math.round((1 - stoppage) * 100),
    eloSwing: { aWin, aLose, bWin, bLose },
    favRisk, favReward,
    purseEst, social: { a: socialA, b: socialB }
  };
}
