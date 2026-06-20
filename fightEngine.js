/* =====================================================================
   fightEngine.js  -  fight simulation (pure: never mutates a boxer)
   ---------------------------------------------------------------------
   simulateFight(a, b, opts) -> result object. engine.js applies effects.

   This engine judges every round the way real boxing is scored — on the
   four criteria (clean/effective punching, effective aggression, ring
   generalship and defence) rather than raw volume — and runs a proper
   range/control battle (an out-boxer with the feet, reach and ring IQ
   keeps a pressure fighter on the end of the jab; lose the range war and
   you eat counters and lose rounds). Reach and stance (southpaw/orthodox)
   shade the contest. Overall ability is the primary driver: a clearly
   better fighter is favoured whatever the styles, but a heavy puncher is
   always one shot from changing the night, so live underdogs and upsets
   still happen. Every one of the 20 attributes feeds the round-by-round.

   All tunables sit in T so the model can be calibrated in one place.
   ===================================================================== */

const T = {
  /* landing (clean connect rate) */
  LAND_BASE: 0.300,     // baseline connect rate for an even fighter
  SKILL_K: 0.85,        // how hard the offence-vs-defence skill gap swings landing  (primary skill lever)
  CTRL_LAND: 0.045,     // winning ring generalship lifts your landing
  RANGE_LAND: 0.038,    // being dragged out of your preferred range hurts your landing
  REACH_LAND: 0.014,    // reach edge helps you land at long range
  TIRED_LAND: 0.34,     // a gassed opponent gets hit more

  /* range / control battle */
  CTRL_REACH: 0.005,    // reach weight inside the control battle (per cm, capped) — modest on purpose
  CTRL_K: 2.0,          // steepness mapping the control gap to a 0..1 share
  RANGE_PULL: 1.6,      // how strongly the controller drags the fight to his range

  /* stance */
  STANCE_EDGE: 0.010,   // raw southpaw-vs-orthodox landing edge, blunted by the other man's adaptability+IQ

  /* round scoring weights (four criteria), summed into a 0..1 round edge.
     Weighted toward clean punching and defence — the things a genuinely better
     fighter does — so a busier but less skilled man can't out-point a great on
     volume alone. */
  W_CLEAN: 0.51,        // clean, accurate, hurtful punching (dominant, as with real judges)
  W_AGG:   0.13,        // effective aggression — forward work that actually lands
  W_CTRL:  0.14,        // ring generalship / control of range and pace
  W_DEF:   0.22,        // defence — making the other man miss

  ROUND_NOISE: 1.70,    // SD of the shared per-round swing on the 0..1 edge scale (keeps close fights live)
  CLASS_EDGE: 0.006,    // pound-for-pound nudge per point of overall-rating difference (small)
  EVEN_BAND: 0.022,     // |edge| below this with no knockdown is a 10-10 round (kept rare)
  JUDGE_BIAS: 0.060,    // how far individual judges can differ
  NIGHT_FORM_SD: 0.030, // each fighter has slightly better/worse nights

  /* damage / stoppage — stoppages come from PUNCHING POWER (puncher's chance),
     not from simply out-boxing someone: slick boxers win wide decisions, big
     hitters score the knockouts. */
  DMG_BASE: 0.30,       // base damage per clean power shot (volume alone shouldn't stop you)
  DMG_POWER: 1.15,      // extra damage scaling with the puncher's power
  DMG_DOM: 0.15,        // a fighter being outclassed eats somewhat cleaner shots (small)
  PUNCH_CHANCE: 0.080,  // per-power-shot base chance of a flush "puncher's chance" shot (scaled by style KO threat)
  PUNCH_MULT_LO: 1.40,
  PUNCH_MULT_HI: 2.20,
  KD_RATE: 0.024,       // knockdown frequency (applied to a volume-saturated "flush shot" term)
  HAYMAKER: 1.60,       // the one-punch threat: a genuine banger can end it from nowhere, even losing
  KO_FROM_KD: 0.55,     // how often a clean knockdown is finished
  ACC_DMG: 270          // accumulation threshold before a one-sided beating gets waved off
};

function n100(x) { return x / 100; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

/* a style's preferred fighting range: +1 long (out-boxers) .. -1 inside (swarmers) */
function stylePref(style) {
  switch (style) {
    case 'Out Boxer': return 1.0;
    case 'Technical Boxer': return 0.7;
    case 'Defensive Master': return 0.6;
    case 'Counter Puncher': return 0.5;
    case 'Slugger': return -0.3;
    case 'Knockout Artist': return -0.35;
    case 'Body Puncher': return -0.5;
    case 'Volume Puncher': return -0.6;
    case 'Pressure Fighter': return -0.8;
    case 'Swarmer': return -1.0;
    default: return 0.0; // Balanced
  }
}
/* how much a style presses forward, for effective-aggression credit (0..1) */
function pressureFactor(style) {
  return clamp((-stylePref(style)) * 0.5 + 0.5, 0, 1); // swarmer ~1, out-boxer ~0
}

/* ----- style matchup: kept for engine.js's blended estimate (returns .win) ----- */
function styleMatchup(meStyle, oppStyle) {
  const me = STYLE_PROFILES[meStyle] || STYLE_PROFILES['Balanced'];
  const myPref = stylePref(meStyle), oppPref = stylePref(oppStyle);
  // an out-boxer profits from a pressure fighter he can out-move; a pressure
  // fighter profits from a passive boxer he can corner. small, symmetric.
  let win = 0;
  if ((meStyle === 'Counter Puncher' || meStyle === 'Defensive Master') &&
      ['Pressure Fighter', 'Swarmer', 'Slugger', 'Knockout Artist', 'Volume Puncher'].includes(oppStyle)) win += 0.06;
  if ((meStyle === 'Out Boxer' || meStyle === 'Technical Boxer') &&
      ['Pressure Fighter', 'Swarmer'].includes(oppStyle)) win += 0.04;
  if ((meStyle === 'Pressure Fighter' || meStyle === 'Swarmer') &&
      ['Out Boxer', 'Technical Boxer', 'Defensive Master', 'Counter Puncher'].includes(oppStyle)) win += 0.03;
  return { win, sp: me, koThreat: me.koThreat, decision: me.decision, drainOpp: me.drainOpp || 0 };
}

/* ----- derive fight ratings from a boxer (read-only) ----- */
function derive(b) {
  const a = b.attributes;
  const agePen = b.age > 32 ? (b.age - 32) * 0.012 : 0;

  const speed = n100(a.speed), foot = n100(a.footwork), iq = n100(a.ringIQ);
  const acc = n100(a.accuracy), jab = n100(a.jab), combo = n100(a.combinations);
  const defS = n100(a.defence), counter = n100(a.counterpunching), adapt = n100(a.adaptability);
  const power = n100(a.power), killer = n100(a.killerInstinct);
  const chin = n100(a.chin), recov = n100(a.recovery), heart = n100(a.heart);
  const stam = n100(a.stamina), disc = n100(a.discipline), aggr = n100(a.aggression);
  const bodyP = n100(a.bodyPunching), clinch = n100(a.clinch), cutRes = n100(a.cutResistance);
  const durab = n100(b.hidden ? b.hidden.durability : a.chin);
  const sp = STYLE_PROFILES[b.style] || STYLE_PROFILES['Balanced'];

  // clean, accurate punching (how clean the work lands)
  const offence = clamp(acc * 0.34 + jab * 0.16 + iq * 0.16 + speed * 0.16 + combo * 0.18 - agePen, 0.05, 0.99);
  // elusiveness (how hard to hit)
  const defence = clamp(defS * 0.34 + foot * 0.24 + iq * 0.18 + speed * 0.16 + adapt * 0.08 - agePen * 0.6, 0.05, 0.99);
  // ring generalship — control of range and pace (skill-driven; reach added separately)
  const general = clamp(iq * 0.34 + foot * 0.28 + speed * 0.18 + adapt * 0.12 + defS * 0.08 - agePen * 0.5, 0.05, 0.99);
  // stopping power
  const powerRating = clamp(power * 0.82 + killer * 0.18, 0.05, 0.99);
  // punch resistance
  const chinRating = clamp(chin * 0.5 + recov * 0.2 + durab * 0.15 + heart * 0.15 - agePen, 0.05, 0.99);

  const conditioning = clamp(stam * 0.62 + disc * 0.2 + recov * 0.18 - agePen, 0.2, 1);
  const outputBase = (0.52 + aggr * 0.48) * sp.volume * 56 * (0.9 + combo * 0.2);
  const powerShare = clamp(sp.power * (0.8 + power * 0.4), 0.18, 0.6);
  const bodyShare = clamp(0.12 + bodyP * 0.22 + (sp.body || 0), 0.08, 0.45);

  return {
    id: b.id, name: b.name, style: b.style, stance: b.stance, sp,
    ovr: overallFrom(a),
    offence, defence, general, powerRating, chinRating, conditioning,
    counter, adapt, iq, clinch, cutRes, disc, recov, heart,
    outputBase, powerShare, bodyShare,
    reach: b.reach || 183, rangePref: stylePref(b.style), pressF: pressureFactor(b.style),
    age: b.age
  };
}

/* ----- per-fight static edges that don't change round to round ----- */
function preFight(A, B) {
  // control battle: skill-dominant, reach a modest factor
  const reachAdv = clamp((A.reach - B.reach) * T.CTRL_REACH, -0.6, 0.6);
  const ctrlGap = (A.general - B.general) + reachAdv * 0.5;          // A's edge in dictating terms
  const shareA = sigmoid(ctrlGap * (T.CTRL_K * 2));                  // 0..1 — A's share of ring control
  // where the fight is fought: the controller pulls the range to his preference
  const wA = sigmoid(ctrlGap * T.RANGE_PULL), wB = 1 - wA;
  const fightRange = clamp(A.rangePref * wA + B.rangePref * wB, -1, 1);
  // how comfortable each man is at that range (1 = ideal, lower = forced out of his game)
  const comfortA = 1 - Math.abs(fightRange - A.rangePref) / 2;
  const comfortB = 1 - Math.abs(fightRange - B.rangePref) / 2;
  // reach matters most when the fight is at range
  const reachLong = clamp((fightRange + 1) / 2, 0, 1);

  // stance: opposite stances give the southpaw a small edge, blunted by the
  // orthodox man's adaptability + ring IQ (a switch-hitter neutralises it).
  let stanceA = 0, stanceB = 0;
  const aSw = A.stance === 'Switch', bSw = B.stance === 'Switch';
  if (!aSw && !bSw && A.stance !== B.stance) {
    const southpaw = A.stance === 'Southpaw' ? 'A' : 'B';
    if (southpaw === 'A') stanceA = T.STANCE_EDGE * (1 - (B.adapt * 0.6 + B.iq * 0.4) * 0.7);
    else stanceB = T.STANCE_EDGE * (1 - (A.adapt * 0.6 + A.iq * 0.4) * 0.7);
  }

  return { shareA, fightRange, comfortA, comfortB, reachLong, reachAdv, stanceA, stanceB };
}

/* ----- main ----- */
function nrand() { return ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2; } // ~[-1,1], SD ~0.33

function simulateFight(boxA, boxB, opts) {
  opts = opts || {};
  const scheduled = opts.rounds || 12;
  const A = derive(boxA), B = derive(boxB);
  // off/on night
  A.offence = clamp(A.offence * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);
  B.offence = clamp(B.offence * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);
  A.powerRating = clamp(A.powerRating * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);
  B.powerRating = clamp(B.powerRating * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);
  A.defence = clamp(A.defence * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);
  B.defence = clamp(B.defence * (1 + nrand() * T.NIGHT_FORM_SD), 0.05, 0.99);

  const pf = preFight(A, B);
  const pfB = { shareA: 1 - pf.shareA, fightRange: pf.fightRange, comfortA: pf.comfortB, comfortB: pf.comfortA, reachLong: pf.reachLong, reachAdv: -pf.reachAdv, stanceA: pf.stanceB, stanceB: pf.stanceA };

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
    const ro = simulateRound(A, B, pf, pfB, fs, r, scheduled);
    ['a', 'b'].forEach(s => {
      totals[s].thrown += ro[s].t; totals[s].landed += ro[s].l;
      totals[s].power += ro[s].p; totals[s].body += ro[s].b; totals[s].counters += ro[s].c;
    });
    totals.a.damageTaken += ro.dmgToA; totals.b.damageTaken += ro.dmgToB;
    scoreSumA += ro.scoreA; scoreSumB += ro.scoreB;

    const baseEdge = (ro.scoreA - ro.scoreB) + nrand() * T.ROUND_NOISE;
    cards.forEach(c => {
      const edge = baseEdge + c.bias * T.JUDGE_BIAS;
      let pa, pb;
      if (Math.abs(edge) < T.EVEN_BAND && ro.kdA === 0 && ro.kdB === 0) { pa = 10; pb = 10; }
      else if (edge >= 0) { pa = 10; pb = 9; } else { pa = 9; pb = 10; }
      pb -= ro.kdB; pa -= ro.kdA; pa -= ro.foulA; pb -= ro.foulB;
      c.a += clamp(pa, 6, 10); c.b += clamp(pb, 6, 10);
    });

    const win = baseEdge > T.EVEN_BAND ? 'A' : baseEdge < -T.EVEN_BAND ? 'B' : 'E';
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
function simulateRound(A, B, pfA, pfB, fs, r, scheduled) {
  const out = { a: { t: 0, l: 0, p: 0, b: 0, c: 0 }, b: { t: 0, l: 0, p: 0, b: 0, c: 0 } };
  const freshA = 0.55 + 0.45 * (fs.a.stam / 100), freshB = 0.55 + 0.45 * (fs.b.stam / 100);
  const hurtA = fs.a.health < 30 ? 0.82 : 1, hurtB = fs.b.health < 30 ? 0.82 : 1;
  const prog = (r - 1) / scheduled;

  // output: pressure fighters throw more, but being kept out of range curbs it
  const outA = A.outputBase * (0.78 + 0.22 * pfA.comfortA);
  const outB = B.outputBase * (0.78 + 0.22 * pfB.comfortA);
  out.a.t = Math.max(6, Math.round(outA * freshA * hurtA * rnd(0.82, 1.18)));
  out.b.t = Math.max(6, Math.round(outB * freshB * hurtB * rnd(0.82, 1.18)));

  const landA = clamp(landRate(A, B, pfA, freshB, prog), 0.06, 0.62);
  const landB = clamp(landRate(B, A, pfB, freshA, prog), 0.06, 0.62);
  out.a.l = Math.round(out.a.t * landA);
  out.b.l = Math.round(out.b.t * landB);

  out.a.p = Math.round(out.a.l * A.powerShare * rnd(0.85, 1.15));
  out.b.p = Math.round(out.b.l * B.powerShare * rnd(0.85, 1.15));
  out.a.b = Math.round(out.a.l * A.bodyShare);
  out.b.b = Math.round(out.b.l * B.bodyShare);
  // counters reward the counterpuncher most when the OPPONENT presses
  out.a.c = Math.round(out.a.l * clamp(A.counter * 0.32 + (A.sp.counter > 0 ? A.sp.counter * 0.4 : 0), 0, 0.55) * (B.pressF > 0.6 ? 1.25 : 0.7));
  out.b.c = Math.round(out.b.l * clamp(B.counter * 0.32 + (B.sp.counter > 0 ? B.sp.counter * 0.4 : 0), 0, 0.55) * (A.pressF > 0.6 ? 1.25 : 0.7));

  // clean, quality-weighted work (accuracy + power make landed shots score more)
  const qualA = 0.5 + A.offence * 0.3 + A.powerRating * 0.2;
  const qualB = 0.5 + B.offence * 0.3 + B.powerRating * 0.2;
  const cleanA = (out.a.l + out.a.c * 0.6) * qualA;
  const cleanB = (out.b.l + out.b.c * 0.6) * qualB;

  // damage from clean power shots (the better fighter lands cleaner -> hurts more)
  let dmgToB = damage(A, B, out.a.p, out.a.c, pfA, cleanA, cleanB);
  let dmgToA = damage(B, A, out.b.p, out.b.c, pfB, cleanB, cleanA);
  if (fs.b.health < 32) dmgToB *= (1 - B.clinch * 0.28);
  if (fs.a.health < 32) dmgToA *= (1 - A.clinch * 0.28);
  fs.b.health = clamp(fs.b.health - dmgToB, -25, 100);
  fs.a.health = clamp(fs.a.health - dmgToA, -25, 100);
  out.dmgToB = dmgToB; out.dmgToA = dmgToA;
  fs.b.dmgTaken += dmgToB; fs.a.dmgTaken += dmgToA;

  // stamina: body work and pressure drain; a good engine + clinch resist it
  fs.b.stam -= out.a.b * 0.08; fs.a.stam -= out.b.b * 0.08;
  fs.a.stam = clamp(fs.a.stam - out.a.t * (0.16 / (0.5 + A.conditioning)) - (B.pressF * 0.9) * (1 - A.clinch * 0.4) * (B.sp.drainOpp ? 6 : 3) + (4 + A.recov * 5), 0, 100);
  fs.b.stam = clamp(fs.b.stam - out.b.t * (0.16 / (0.5 + B.conditioning)) - (A.pressF * 0.9) * (1 - B.clinch * 0.4) * (A.sp.drainOpp ? 6 : 3) + (4 + B.recov * 5), 0, 100);

  // recovery between rounds, blunted by accumulated punishment and a heavy round
  const wearA = clamp(fs.a.dmgTaken / 470, 0, 0.36), wearB = clamp(fs.b.dmgTaken / 470, 0, 0.36);
  const recA = (fs.a.health < 25 ? (1.8 + A.recov * 1.9) : (3.2 + A.recov * 3.4)) * (1 - wearA) * clamp(1 - dmgToA / 42, 0.45, 1);
  const recB = (fs.b.health < 25 ? (1.8 + B.recov * 1.9) : (3.2 + B.recov * 3.4)) * (1 - wearB) * clamp(1 - dmgToB / 42, 0.45, 1);
  fs.a.health = clamp(fs.a.health + recA, -25, 100);
  fs.b.health = clamp(fs.b.health + recB, -25, 100);

  out.cutANew = 0; out.cutBNew = 0;
  if (chance(clamp(out.a.p * 0.011 * (1.25 - B.cutRes), 0, 0.5))) { fs.b.cut += rnd(1, 3) * (1.3 - B.cutRes); out.cutBNew = 1; }
  if (chance(clamp(out.b.p * 0.011 * (1.25 - A.cutRes), 0, 0.5))) { fs.a.cut += rnd(1, 3) * (1.3 - A.cutRes); out.cutANew = 1; }

  out.foulA = 0; out.foulB = 0;
  if (A.disc < 0.35 && chance((0.35 - A.disc) * 0.16)) { fs.a.fouls++; out.foulA = 1; }
  if (B.disc < 0.35 && chance((0.35 - B.disc) * 0.16)) { fs.b.fouls++; out.foulB = 1; }

  out.kdB = knockdownRoll(A, B, out.a.p, out.a.c, fs.b, pfA, cleanA, cleanB);
  out.kdA = knockdownRoll(B, A, out.b.p, out.b.c, fs.a, pfB, cleanB, cleanA);
  if (out.kdB) { fs.b.health = clamp(fs.b.health - rndi(10, 22) * out.kdB, -30, 100); }
  if (out.kdA) { fs.a.health = clamp(fs.a.health - rndi(10, 22) * out.kdA, -30, 100); }

  /* ---- round score: four judging criteria, each a 0..1 share, into a 0..1 edge ---- */
  const eps = 0.5;
  const cleanShareA = (cleanA + eps) / (cleanA + cleanB + 2 * eps);
  const effA = out.a.l * (0.7 + 0.6 * A.pressF), effB = out.b.l * (0.7 + 0.6 * B.pressF);
  const aggShareA = (effA + eps) / (effA + effB + 2 * eps);
  const ctrlShareA = clamp(pfA.shareA, 0.02, 0.98);
  const dInvA = 1 / (out.b.l + 1), dInvB = 1 / (out.a.l + 1);   // got hit less -> better defence
  const defShareA = dInvA / (dInvA + dInvB);

  out.scoreA = T.W_CLEAN * cleanShareA + T.W_AGG * aggShareA + T.W_CTRL * ctrlShareA + T.W_DEF * defShareA;
  out.scoreB = T.W_CLEAN * (1 - cleanShareA) + T.W_AGG * (1 - aggShareA) + T.W_CTRL * (1 - ctrlShareA) + T.W_DEF * (1 - defShareA);
  // pound-for-pound class: a small, deliberate nudge from raw overall rating so the
  // genuinely higher-rated fighter is reliably favoured even in a close stylistic
  // matchup — the intangible pedigree edge — without ever overriding what happens
  // in the ring (kept small so style, form and the punch still decide most rounds).
  const classEdge = clamp((A.ovr - B.ovr) * T.CLASS_EDGE, -0.06, 0.06);
  out.scoreA += classEdge;
  out.scoreB -= classEdge;
  // knockdowns dominate a round on the cards, exactly as in real boxing
  out.scoreA += out.kdB * 0.55;
  out.scoreB += out.kdA * 0.55;

  out.ended = resolveStoppage(A, B, fs, out, r, scheduled);
  return out;
}

function landRate(att, def, pf, oppFresh, prog) {
  let lr = T.LAND_BASE
    + (att.offence - def.defence) * T.SKILL_K       // the skill gap is the main lever
    + (pf.shareA - 0.5) * 2 * T.CTRL_LAND           // controlling range helps you land
    + (pf.comfortA - 0.85) * T.RANGE_LAND           // forced out of your range -> land less
    + pf.reachAdv * pf.reachLong * T.REACH_LAND     // reach pays at distance
    + pf.stanceA;                                   // stance edge
  lr += att.adapt * 0.05 * (prog || 0);             // solve the puzzle as rounds pass
  lr *= (1 + (1 - oppFresh) * T.TIRED_LAND);        // a tired opponent gets hit more
  return lr;
}
function damage(att, def, power, counters, pf, cleanMe, cleanOpp) {
  // per-shot stopping power scales with the puncher's power AND his style's KO threat,
  // so a slick high-volume boxer racks up rounds without necessarily ending the night,
  // while a genuine banger hurts you every time he connects clean.
  const dmgPerPower = (T.DMG_BASE + att.powerRating * T.DMG_POWER) * (0.62 + 0.45 * att.sp.koThreat);
  const chinFactor = clamp(1.12 - def.chinRating * 0.7, 0.4, 1.12);
  let dmg = (power + counters * 0.7) * dmgPerPower * chinFactor;
  // a fighter who is being comprehensively outboxed eats cleaner, heavier shots
  const dom = clamp((cleanMe - cleanOpp) / (cleanMe + cleanOpp + 1), 0, 0.6);
  dmg *= (1 + dom * T.DMG_DOM);
  // puncher's chance: a heavy hitter can land the flush shot even while losing rounds
  if (chance(clamp(T.PUNCH_CHANCE * (0.45 + 0.75 * att.sp.koThreat), 0, 0.24))) dmg *= rnd(T.PUNCH_MULT_LO, T.PUNCH_MULT_HI);
  return Math.max(0, dmg * rnd(0.8, 1.2));
}
function knockdownRoll(att, def, power, counters, defState, pf, cleanMe, cleanOpp) {
  const wear = clamp((defState.dmgTaken || 0) / 450, 0, 0.4);
  const effChin = clamp(def.chinRating * (1 - wear * 0.4), 0.05, 1);
  const healthOpen = 1 + (1 - defState.health / 100) * 1.4;
  const dom = clamp((cleanMe - cleanOpp) / (cleanMe + cleanOpp + 1), 0, 0.6);
  // ELITE DEFENCE MAKES THE BOMB MISS. Footwork, reflexes, ring IQ and guard (the
  // `defence` composite) decide how often a fighter gets caught flush at all. The
  // curve is deliberately steep at the top: a prime defensive great is dramatically
  // harder to land a clean knockdown shot on than a merely very good fighter, which
  // is the whole reason skill beats power — a puncher near the great's level still
  // cannot reliably catch him, while a lesser defender gets caught now and then.
  const evasion = clamp(Math.pow(clamp((1.06 - def.defence) / 0.18, 0.05, 1.55), 1.25), 0.10, 1.45);

  // (1) the flush shot — volume-saturated, so one bomb counts and ten taps do not
  const flush = Math.sqrt(Math.max(0, power + counters * 0.6));
  let p = flush * (0.45 + att.powerRating * 1.15) * (1.2 - effChin)
        * healthOpen * (1 + dom * 0.12) * (0.45 + 0.85 * att.sp.koThreat) * evasion * T.KD_RATE;

  // (2) the one-punch threat — a genuine banger's puncher's chance, gated on real
  // power (slick light-hitters never get it) and largest when he is BEHIND and being
  // out-landed, rather than amplifying a man already winning. Still filtered through
  // the same evasion gate, so it almost never lands on an elite defender.
  if (power > 0 || counters > 0) {
    const deficit = clamp((cleanOpp - cleanMe) / (cleanMe + cleanOpp + 1), 0, 0.6);
    const hay = clamp(att.powerRating - 0.80, 0, 0.20) * (0.7 + 0.5 * (att.sp.koThreat - 0.85))
              * (0.20 + deficit * 2.6) * evasion * T.HAYMAKER;
    p += Math.max(0, hay);
  }
  p = clamp(p, 0, 0.55);
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
      const koP = clamp((1 - defState.health / 100) * (1.1 - def.heart) * (kd >= 2 ? 1.5 : 1) * T.KO_FROM_KD, 0, 0.9);
      if (chance(koP)) return { method: 'KO', round: r, timeStr: t(), winner };
      if (defState.health <= 12 && chance(clamp((12 - defState.health) / 12 * 0.5 + 0.12, 0, 0.75))) return { method: 'TKO', round: r, timeStr: t(), winner };
    }
    if (defState.health <= 8 && chance(0.42)) return { method: 'TKO', round: r, timeStr: t(), winner };
    return null;
  };
  if (fs.b.health <= fs.a.health) {
    let k = koCheck(fs.b, B, 'a', 'kdB'); if (k) return k;
    k = koCheck(fs.a, A, 'b', 'kdA'); if (k) return k;
  } else {
    let k = koCheck(fs.a, A, 'b', 'kdA'); if (k) return k;
    k = koCheck(fs.b, B, 'a', 'kdB'); if (k) return k;
  }

  // accumulation: a sustained, one-sided beating gets waved off
  const accChk = (defState, attState, winner) => {
    if (defState.dmgTaken > T.ACC_DMG && defState.health < 34 && defState.dmgTaken > attState.dmgTaken * 2.0) {
      const p = clamp((defState.dmgTaken - T.ACC_DMG) / 320 + (34 - defState.health) / 34 * 0.16, 0, 0.30);
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

/* ----- concise commentary ----- */
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

  const N = 240;
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
