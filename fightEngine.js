/* =====================================================================
   fightEngine.js  -  fight simulation (pure: never mutates a boxer)
   ---------------------------------------------------------------------
   simulateFight(a, b, opts) -> result object. engine.js applies effects.

   DESIGN
   ------
   Every round is judged the way real boxing is scored — on the four
   criteria (clean/effective punching, effective aggression, ring
   generalship and defence) rather than raw volume — over a proper
   range/control battle. All twenty attributes feed the round-by-round
   exchange, plus the hidden durability/recovery/momentum a boxer carries.

   The model separates two questions that are easy to conflate:

     (1) WHO WINS.  Skill decides this. A clearly better fighter out-lands,
         out-controls and out-defends, banks rounds, and is favoured
         whatever the styles. The pound-for-pound class nudge guarantees
         the higher-rated man is favoured even in a close stylistic clash.

     (2) WHETHER IT IS STOPPED.  Power and accumulation decide this, and a
         stoppage can happen in ANY fight, including between two greats.
         There are several realistic routes, and — as in real heavyweight
         boxing — referee/accumulation stoppages (TKO/RTD) are more common
         than the clean one-punch count-out (KO):

           * flush KNOCKDOWN -> count-out KO      (a banger's one-shot path,
             available even from behind: the puncher's chance)
           * HURT fighter being teed off on       -> referee TKO
           * sustained one-sided ACCUMULATION      -> referee/corner TKO
           * worn-down fighter pulled out          -> corner retirement (RTD)
           * bad CUT                               -> doctor stoppage
           * repeated low fouls                    -> disqualification

   Crucially, the accumulation and referee routes are driven by who is
   landing — i.e. who is winning — so the better fighter usually delivers
   them; the flush count-out is the power wildcard that gives the puncher
   his chance. That keeps skill on top while letting the bombs land.

   Defence makes the flush shot MISS (a slick great is hard to catch cold),
   but it does not make a fighter immune to being worn down: stand in long
   enough against a real hitter and you can still be broken up. So elite-
   vs-elite fights carry a genuine, if smaller, stoppage threat.

   All tunables live in T so the whole model calibrates from one place.
   ===================================================================== */

const T = {
  /* ---------- output / work-rate ---------- */
  BASE_OUTPUT: 56,        // reference scaler for punches thrown per round
  AGGR_OUTPUT: 0.48,      // share of output driven by aggression
  COMBO_OUTPUT: 0.20,     // combination punching lifts volume
  STAM_OUTPUT: 0.42,      // a full tank vs an empty one, effect on output
  HURT_OUTPUT: 0.55,      // a badly hurt fighter throws far less
  PACE_SD: 0.16,          // round-to-round randomness in work-rate

  /* ---------- landing (clean connect rate) ---------- */
  LAND_BASE: 0.300,       // baseline connect rate for an even fighter
  SKILL_K: 0.70,          // how hard the offence-vs-defence gap swings landing (primary skill lever)
  CTRL_LAND: 0.045,       // winning ring generalship lifts your landing
  RANGE_LAND: 0.038,      // being dragged out of your range hurts your landing
  REACH_LAND: 0.013,      // reach edge helps you land at range
  STANCE_EDGE: 0.006,     // raw southpaw-vs-orthodox edge, blunted by adaptability+IQ
  TIRED_LAND: 0.34,       // a gassed opponent gets hit more
  HURT_LAND_OPEN: 0.32,   // a hurt opponent is far easier to hit clean
  ADAPT_LAND: 0.05,       // solve the puzzle as the rounds pass

  /* ---------- range / control battle ---------- */
  CTRL_REACH: 0.005,      // reach weight inside the control battle (per cm, capped)
  CTRL_K: 2.0,            // steepness mapping the control gap to a 0..1 share
  RANGE_PULL: 1.6,        // how strongly the controller drags the fight to his range

  /* ---------- punch composition ---------- */
  POWER_SHARE_K: 0.40,    // how much raw power tilts the mix toward power shots
  BODY_SHARE_BASE: 0.12,  // baseline share of work to the body
  BODY_SHARE_K: 0.22,     // body-punching attribute's effect on that share
  COUNTER_K: 0.32,        // counterpunching attribute -> share of work that is countering

  /* ---------- accumulated (grinding) damage ---------- */
  DMG_BASE: 0.33,         // health damage per clean POWER shot for a light hitter
  DMG_POWER: 1.30,        // extra per-shot damage scaling with the puncher's power
  DMG_KOTHREAT: 0.34,     // per-shot damage scaling with the style's KO threat
  DMG_CHIN: 0.82,         // how much the target's chin/durability soaks per-shot damage
  DMG_DOM: 0.05,          // a fighter being comprehensively outboxed eats cleaner, heavier shots
  DMG_HURT: 0.22,         // a hurt man eats every shot cleaner — accelerates a finish
  DMG_BODY: 0.20,         // body shots cost a little health too (mostly they drain the tank)
  CEIL_DMG: 0.130,        // accumulated damage lowers the ceiling a fighter can recover back to

  /* ---------- the flush "big shot" (sets up hurt / knockdowns) ---------- */
  BIGSHOT_BASE: 0.050,    // per-power-shot base chance of catching the opponent flush
  BIGSHOT_KOTHREAT: 0.65, // how much the style's KO threat raises that chance
  BIGSHOT_ACC: 0.45,      // accuracy's contribution to landing flush
  BIGSHOT_DMG_LO: 11,     // a flush shot's acute health hit (low)
  BIGSHOT_DMG_HI: 24,     // a flush shot's acute health hit (high)
  EVASION_LO: 0.44,       // floor of the evasion multiplier — the slickest are caught least
  EVASION_HI: 1.70,       // ceiling — a wide-open fighter is caught far more
  EVASION_REF: 0.985,     // defensive rating mapped to the floor (a prime defensive great)
  EVASION_SLOPE: 4.0,     // how fast catchability rises as defensive skill drops

  /* ---------- hurt state ---------- */
  HURT_HEALTH: 42,        // dropping below this in a round flags a fighter as hurt
  HURT_DECAY: 0.48,       // how much of the hurt level carries into the next round
  HURT_RECOVER: 0.40,     // a hurt fighter's recovery rating still buys some respite

  /* ---------- knockdowns ---------- */
  KD_RATE: 0.95,          // overall knockdown frequency on a flush, hurtful shot
  KD_POWER: 1.30,         // power's weight in dropping a man
  KD_HURT: 1.30,          // a already-hurt fighter is far easier to put down
  KD_CHIN: 0.95,          // chin/durability resistance to being dropped
  KD_SECOND: 0.30,        // chance a knockdown is a second/third in the same flurry

  /* ---------- stoppage routes ---------- */
  KO_COUNT_BASE: 0.68,    // base chance a dropped, badly hurt man is counted out
  KO_COUNT_HEALTH: 1.28,  // how steeply low health raises the count-out chance
  KO_COUNT_HEART: 0.85,   // heart/recovery's resistance to being counted out
  KO_MULTI_KD: 1.45,      // multiple knockdowns in the round make a finish far likelier
  REF_STOP_BASE: 0.40,    // base referee-stoppage chance when a hurt man is being teed off on
  REF_STOP_DOM: 0.78,     // how one-sided the round must be for the ref to step in
  REF_STOP_FINISH: 0.55,  // the attacker's finishing instinct closing the show
  REF_STOP_HEART: 0.80,   // the hurt man's heart buying him the benefit of the doubt
  ACC_DMG: 165,           // accumulated damage past which a one-sided beating gets waved off
  ACC_STOP_K: 0.46,       // accumulation-stoppage frequency once that threshold is crossed
  ACC_DOM_RATIO: 1.9,     // how lopsided the damage must be (taken vs given) for an acc. stop
  RTD_K: 0.34,            // corner-retirement frequency for a worn, dispirited fighter
  /* breakdown TKO: a skilled boxer out-landing a man by a CLEAR, sustained margin
     breaks him down for a late stoppage. Volume-driven (not power), so it is the
     better fighter's stoppage route — and it works for a slick light hitter (Ali)
     against a bigger puncher. Gated to wide cumulative margins so a THIN edge
     (e.g. 86 vs 84) never triggers it, which keeps small-gap fights from being
     amplified into lopsided stoppage records. */
  BD_MARGIN: 0.115,        // minimum cumulative landing edge (lopsidedness) to break a man down
  BD_HEALTH: 55,          // he must also be worn down to this, not merely out-pointed
  BD_K: 0.82,             // how fast the stoppage chance grows past the margin
  CUT_OPEN: 0.011,        // per-power-shot chance of opening a cut, scaled by cut resistance
  CUT_STOP_K: 0.12,       // doctor-stoppage frequency once a cut is bad

  /* ---------- round scoring (four criteria -> 0..1 edge) ---------- */
  W_CLEAN: 0.50,          // clean, accurate, hurtful punching (dominant, as real judges score)
  W_AGG:   0.14,          // effective aggression — forward work that lands
  W_CTRL:  0.14,          // ring generalship / control of range and pace
  W_DEF:   0.22,          // defence — making the other man miss
  KD_SCORE: 0.55,         // a knockdown's weight on the round on the cards
  ROUND_NOISE: 1.70,      // SD of the shared per-round swing (keeps close rounds live)
  CLASS_EDGE: 0.006,      // pound-for-pound nudge per point of overall difference (small)
  EVEN_BAND: 0.022,       // |edge| below this with no knockdown is a 10-10 round
  JUDGE_BIAS: 0.060,      // how far individual judges differ
  NIGHT_FORM_SD: 0.030,   // each fighter has slightly better / worse nights

  /* ---------- stamina / recovery ---------- */
  STAM_VOL: 0.16,         // tank cost of throwing
  STAM_PRESS: 0.90,       // tank cost of absorbing pressure
  STAM_BODY: 0.08,        // tank cost of taking body shots
  REC_BASE: 2.8,          // base health recovered between rounds
  REC_RATE: 3.0,          // recovery rating's contribution to that
  REC_HURT: 1.9           // a hurt man recovers less
};

/* ============================ helpers ============================ */
function n100(x) { return x / 100; }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function nrand() { return ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2; } // ~[-1,1], SD ~0.33
function lerp(a, b, t) { return a + (b - a) * t; }

/* a style's preferred range: +1 long (out-boxers) .. -1 inside (swarmers) */
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

/* style matchup — kept for engine.js's blended pre-fight estimate (returns .win) */
function styleMatchup(meStyle, oppStyle) {
  const me = STYLE_PROFILES[meStyle] || STYLE_PROFILES['Balanced'];
  let win = 0;
  if ((meStyle === 'Counter Puncher' || meStyle === 'Defensive Master') &&
      ['Pressure Fighter', 'Swarmer', 'Slugger', 'Knockout Artist', 'Volume Puncher'].includes(oppStyle)) win += 0.06;
  if ((meStyle === 'Out Boxer' || meStyle === 'Technical Boxer') &&
      ['Pressure Fighter', 'Swarmer'].includes(oppStyle)) win += 0.04;
  if ((meStyle === 'Pressure Fighter' || meStyle === 'Swarmer') &&
      ['Out Boxer', 'Technical Boxer', 'Defensive Master', 'Counter Puncher'].includes(oppStyle)) win += 0.03;
  return { win, sp: me, koThreat: me.koThreat, decision: me.decision, drainOpp: me.drainOpp || 0 };
}

/* ===================== derive fight ratings ====================== */
/* Pure read of a boxer into the composite ratings the simulation uses.
   Every one of the twenty visible attributes contributes, plus the hidden
   durability and (lightly) career momentum. Nothing here is mutated. */
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
  const momentum = b.hidden ? clamp((b.hidden.careerMomentum || 0) / 100, -1, 1) : 0;

  // clean, accurate punching — how cleanly the work lands
  const offence = clamp(acc * 0.34 + jab * 0.16 + iq * 0.16 + speed * 0.16 + combo * 0.18 - agePen + momentum * 0.01, 0.05, 0.99);
  // elusiveness — how hard to hit clean
  const defence = clamp(defS * 0.34 + foot * 0.24 + iq * 0.18 + speed * 0.16 + adapt * 0.08 - agePen * 0.6, 0.05, 0.99);
  // ring generalship — control of range and pace (skill-driven; reach added separately)
  const general = clamp(iq * 0.34 + foot * 0.28 + speed * 0.18 + adapt * 0.12 + defS * 0.08 - agePen * 0.5, 0.05, 0.99);
  // stopping power
  const powerRating = clamp(power * 0.80 + killer * 0.20, 0.05, 0.99);
  // punch resistance — how much you can take before you wobble
  const chinRating = clamp(chin * 0.50 + recov * 0.18 + durab * 0.17 + heart * 0.15 - agePen, 0.05, 0.99);
  // recovery — getting up, clearing the head, recovering between rounds
  const recovery = clamp(recov * 0.55 + heart * 0.25 + stam * 0.20 - agePen, 0.05, 0.99);
  // finishing — turning a hurt opponent into a stoppage
  const finishing = clamp(killer * 0.52 + power * 0.28 + aggr * 0.20, 0.05, 0.99);
  // gas tank
  const conditioning = clamp(stam * 0.62 + disc * 0.20 + recov * 0.18 - agePen, 0.20, 1);

  const outputBase = (0.52 + aggr * T.AGGR_OUTPUT) * sp.volume * T.BASE_OUTPUT * (0.9 + combo * T.COMBO_OUTPUT);
  const powerShare = clamp(sp.power * (0.8 + power * T.POWER_SHARE_K), 0.18, 0.6);
  const bodyShare = clamp(T.BODY_SHARE_BASE + bodyP * T.BODY_SHARE_K + (sp.body || 0), 0.08, 0.45);

  return {
    id: b.id, name: b.name, style: b.style, stance: b.stance, sp,
    ovr: overallFrom(a),
    offence, defence, general, powerRating, chinRating, recovery, finishing, conditioning,
    counter, adapt, iq, clinch, cutRes, disc, recov, heart, killer, aggr, bodyP, durab,
    outputBase, powerShare, bodyShare,
    reach: b.reach || 183, rangePref: stylePref(b.style), pressF: pressureFactor(b.style),
    age: b.age
  };
}

/* ============ per-fight static edges (set once) ================= */
function preFight(A, B) {
  // control battle: skill-dominant, reach a modest factor
  const reachAdv = clamp((A.reach - B.reach) * T.CTRL_REACH, -0.6, 0.6);
  const ctrlGap = (A.general - B.general) + reachAdv * 0.5;          // A's edge in dictating terms
  const shareA = sigmoid(ctrlGap * (T.CTRL_K * 2));                  // 0..1 — A's share of ring control
  // where the fight is fought: the controller pulls the range to his preference
  const wA = sigmoid(ctrlGap * T.RANGE_PULL), wB = 1 - wA;
  const fightRange = clamp(A.rangePref * wA + B.rangePref * wB, -1, 1);
  const comfortA = 1 - Math.abs(fightRange - A.rangePref) / 2;
  const comfortB = 1 - Math.abs(fightRange - B.rangePref) / 2;
  const reachLong = clamp((fightRange + 1) / 2, 0, 1);               // reach pays most at range

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

/* ===================== the main entry point ===================== */
function simulateFight(boxA, boxB, opts) {
  opts = opts || {};
  const scheduled = opts.rounds || 12;
  const A = derive(boxA), B = derive(boxB);

  // an on-night / off-night wobble on the key ratings
  const formA = 1 + nrand() * T.NIGHT_FORM_SD, formB = 1 + nrand() * T.NIGHT_FORM_SD;
  A.offence = clamp(A.offence * formA, 0.05, 0.99);  B.offence = clamp(B.offence * formB, 0.05, 0.99);
  A.powerRating = clamp(A.powerRating * formA, 0.05, 0.99); B.powerRating = clamp(B.powerRating * formB, 0.05, 0.99);
  A.defence = clamp(A.defence * formA, 0.05, 0.99);  B.defence = clamp(B.defence * formB, 0.05, 0.99);

  const pf = preFight(A, B);
  const pfB = {
    shareA: 1 - pf.shareA, fightRange: pf.fightRange, comfortA: pf.comfortB, comfortB: pf.comfortA,
    reachLong: pf.reachLong, reachAdv: -pf.reachAdv, stanceA: pf.stanceB, stanceB: pf.stanceA
  };

  // live fight state for each man
  const fs = {
    a: { health: 100, stam: 100, cut: 0, fouls: 0, dmgTaken: 0, hurt: 0, downs: 0, landed: 0 },
    b: { health: 100, stam: 100, cut: 0, fouls: 0, dmgTaken: 0, hurt: 0, downs: 0, landed: 0 }
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

/* =========================== a round ============================ */
function simulateRound(A, B, pfA, pfB, fs, r, scheduled) {
  const out = { a: { t: 0, l: 0, p: 0, b: 0, c: 0 }, b: { t: 0, l: 0, p: 0, b: 0, c: 0 } };
  const prog = (r - 1) / Math.max(1, scheduled - 1);

  /* ---- work-rate: pressure fighters throw more; range, gas and being hurt curb it ---- */
  const freshA = (1 - T.STAM_OUTPUT) + T.STAM_OUTPUT * (fs.a.stam / 100);
  const freshB = (1 - T.STAM_OUTPUT) + T.STAM_OUTPUT * (fs.b.stam / 100);
  const okA = hurtThrottle(fs.a), okB = hurtThrottle(fs.b);
  const outA = A.outputBase * (0.78 + 0.22 * pfA.comfortA);
  const outB = B.outputBase * (0.78 + 0.22 * pfB.comfortA);
  out.a.t = Math.max(5, Math.round(outA * freshA * okA * rnd(1 - T.PACE_SD, 1 + T.PACE_SD)));
  out.b.t = Math.max(5, Math.round(outB * freshB * okB * rnd(1 - T.PACE_SD, 1 + T.PACE_SD)));

  /* ---- clean connect rate ---- */
  const landA = clamp(landRate(A, B, pfA, freshB, prog, fs.b.hurt), 0.05, 0.66);
  const landB = clamp(landRate(B, A, pfB, freshA, prog, fs.a.hurt), 0.05, 0.66);
  out.a.l = Math.round(out.a.t * landA);
  out.b.l = Math.round(out.b.t * landB);
  fs.a.landed += out.a.l; fs.b.landed += out.b.l;   // running totals feed the breakdown/attrition route

  /* ---- punch composition: power shots, body work, counters ---- */
  out.a.p = Math.round(out.a.l * A.powerShare * rnd(0.85, 1.15));
  out.b.p = Math.round(out.b.l * B.powerShare * rnd(0.85, 1.15));
  out.a.b = Math.round(out.a.l * A.bodyShare);
  out.b.b = Math.round(out.b.l * B.bodyShare);
  // counters reward the counterpuncher most when the OPPONENT presses
  out.a.c = Math.round(out.a.l * clamp(A.counter * T.COUNTER_K + (A.sp.counter > 0 ? A.sp.counter * 0.4 : 0), 0, 0.55) * (B.pressF > 0.6 ? 1.25 : 0.7));
  out.b.c = Math.round(out.b.l * clamp(B.counter * T.COUNTER_K + (B.sp.counter > 0 ? B.sp.counter * 0.4 : 0), 0, 0.55) * (A.pressF > 0.6 ? 1.25 : 0.7));

  // clean, quality-weighted work (accuracy + power make landed shots score more)
  const qualA = 0.5 + A.offence * 0.3 + A.powerRating * 0.2;
  const qualB = 0.5 + B.offence * 0.3 + B.powerRating * 0.2;
  const cleanA = (out.a.l + out.a.c * 0.6) * qualA;
  const cleanB = (out.b.l + out.b.c * 0.6) * qualB;

  /* ---- accumulated (grinding) damage from clean power work ---- */
  let dmgToB = grindDamage(A, B, out.a.p, out.a.c, cleanA, cleanB, fs.b);
  let dmgToA = grindDamage(B, A, out.b.p, out.b.c, cleanB, cleanA, fs.a);
  // body work mostly drains the tank, but costs a little health too
  dmgToB += out.a.b * T.DMG_BODY * (1.1 - B.chinRating * 0.5);
  dmgToA += out.b.b * T.DMG_BODY * (1.1 - A.chinRating * 0.5);
  // a man in survival mode can smother some of it
  if (fs.b.health < 32) dmgToB *= (1 - B.clinch * 0.26);
  if (fs.a.health < 32) dmgToA *= (1 - A.clinch * 0.26);

  /* ---- the flush "big shot": acute health hit, sets up hurt and knockdowns ---- */
  const bigB = bigShot(A, B, out.a.p, fs.b);   // A catches B flush?
  const bigA = bigShot(B, A, out.b.p, fs.a);   // B catches A flush?
  dmgToB += bigB.dmg;
  dmgToA += bigA.dmg;

  fs.b.health = clamp(fs.b.health - dmgToB, -35, 100);
  fs.a.health = clamp(fs.a.health - dmgToA, -35, 100);
  out.dmgToB = dmgToB; out.dmgToA = dmgToA;
  fs.b.dmgTaken += dmgToB; fs.a.dmgTaken += dmgToA;

  /* ---- hurt state: a flush shot or a health collapse rocks a man ---- */
  updateHurt(fs.b, bigB.hit, B);
  updateHurt(fs.a, bigA.hit, A);

  /* ---- knockdowns: a flush shot on an open / hurt man puts him down ---- */
  out.kdB = knockdownRoll(A, B, out.a.p, out.a.c, fs.b, cleanA, cleanB, bigB.hit);
  out.kdA = knockdownRoll(B, A, out.b.p, out.b.c, fs.a, cleanB, cleanA, bigA.hit);
  if (out.kdB) { fs.b.health = clamp(fs.b.health - rndi(9, 20) * out.kdB, -40, 100); fs.b.hurt = clamp(fs.b.hurt + 0.5, 0, 1); fs.b.downs += out.kdB; }
  if (out.kdA) { fs.a.health = clamp(fs.a.health - rndi(9, 20) * out.kdA, -40, 100); fs.a.hurt = clamp(fs.a.hurt + 0.5, 0, 1); fs.a.downs += out.kdA; }

  /* ---- stamina drain + between-rounds recovery ---- */
  staminaUpdate(A, B, out, fs, 'a', 'b');
  staminaUpdate(B, A, out, fs, 'b', 'a');
  recover(fs.a, A, dmgToA);
  recover(fs.b, B, dmgToB);

  /* ---- cuts ---- */
  out.cutANew = 0; out.cutBNew = 0;
  if (chance(clamp(out.a.p * T.CUT_OPEN * (1.25 - B.cutRes), 0, 0.5))) { fs.b.cut += rnd(1, 3) * (1.3 - B.cutRes); out.cutBNew = 1; }
  if (chance(clamp(out.b.p * T.CUT_OPEN * (1.25 - A.cutRes), 0, 0.5))) { fs.a.cut += rnd(1, 3) * (1.3 - A.cutRes); out.cutANew = 1; }

  /* ---- fouls ---- */
  out.foulA = 0; out.foulB = 0;
  if (A.disc < 0.35 && chance((0.35 - A.disc) * 0.16)) { fs.a.fouls++; out.foulA = 1; }
  if (B.disc < 0.35 && chance((0.35 - B.disc) * 0.16)) { fs.b.fouls++; out.foulB = 1; }

  /* ---- score the round on the four criteria ---- */
  scoreRound(A, B, pfA, out, cleanA, cleanB);

  /* ---- did the round produce a stoppage? ---- */
  out.ended = resolveStoppage(A, B, fs, out, r, scheduled, cleanA, cleanB);
  return out;
}

/* throttle on a hurt fighter's output (he covers up, holds, survives) */
function hurtThrottle(st) {
  if (st.hurt <= 0) return 1;
  return clamp(1 - st.hurt * (1 - T.HURT_OUTPUT), T.HURT_OUTPUT, 1);
}

/* clean connect rate for `att` against `def` */
function landRate(att, def, pf, oppFresh, prog, defHurt) {
  let lr = T.LAND_BASE
    + (att.offence - def.defence) * T.SKILL_K       // the skill gap is the main lever
    + (pf.shareA - 0.5) * 2 * T.CTRL_LAND           // controlling range helps you land
    + (pf.comfortA - 0.85) * T.RANGE_LAND           // forced out of your range -> land less
    + pf.reachAdv * pf.reachLong * T.REACH_LAND     // reach pays at distance
    + pf.stanceA;                                   // stance edge
  lr += att.adapt * T.ADAPT_LAND * (prog || 0);     // solve the puzzle as rounds pass
  lr *= (1 + (1 - oppFresh) * T.TIRED_LAND);        // a tired opponent gets hit more
  if (defHurt > 0) lr *= (1 + defHurt * T.HURT_LAND_OPEN); // a hurt opponent is open
  return lr;
}

/* ----- accumulated, grinding damage from clean power work ----- */
function grindDamage(att, def, power, counters, cleanMe, cleanOpp, defState) {
  // per-shot stopping power scales with the puncher's power AND his style's KO
  // threat, so a slick high-volume boxer racks up rounds without ending the night,
  // while a genuine banger hurts every time he lands clean.
  const dmgPerPower = (T.DMG_BASE + att.powerRating * T.DMG_POWER) * (0.80 + att.sp.koThreat * T.DMG_KOTHREAT);
  // chin + accumulated wear: a worn man soaks less
  const wear = clamp((defState.dmgTaken || 0) / 520, 0, 0.42);
  const effChin = clamp(def.chinRating * (1 - wear * 0.45), 0.05, 1);
  const chinFactor = clamp(1.18 - effChin * T.DMG_CHIN, 0.34, 1.18);
  let dmg = (power + counters * 0.7) * dmgPerPower * chinFactor;
  // a fighter being comprehensively outboxed eats cleaner, heavier shots
  const dom = clamp((cleanMe - cleanOpp) / (cleanMe + cleanOpp + 1), 0, 0.6);
  dmg *= (1 + dom * T.DMG_DOM);
  // a hurt man eats everything cleaner
  if (defState.hurt > 0) dmg *= (1 + defState.hurt * T.DMG_HURT);
  return Math.max(0, dmg * rnd(0.85, 1.15));
}

/* ----- evasion gate: how catchable a man is with the FLUSH (cold) shot, by his
   defensive skill. Steep at the top: a prime defensive great is genuinely hard to
   catch clean, which is what stops a puncher from simply cold-cocking a better
   boxer. It does NOT shield him from being worn down — grinding damage (below) is
   only lightly gated — so elite-vs-elite fights still carry a real stoppage threat,
   it just tends to come the slow way rather than out of nowhere. */
function evasionGate(def) {
  return clamp(T.EVASION_LO + (T.EVASION_REF - def.defence) * T.EVASION_SLOPE, T.EVASION_LO, T.EVASION_HI);
}

/* ----- the flush "big shot" -----
   A clean, fight-changing shot. Its chance rises with the attacker's power,
   accuracy and KO-threat and with how open / hurt / tired the target is, and
   it is gated (mildly) by the target's evasion. Returns whether it landed and
   the acute health it took. */
function bigShot(att, def, power, defState) {
  if (power <= 0) return { hit: false, dmg: 0 };
  const evasion = evasionGate(def);
  // a hurt/worn man is somewhat easier to catch clean — but only somewhat, so a thin
  // round-to-round edge doesn't snowball a stoppage out of a competitive fight
  const opening = 1 + (1 - defState.health / 100) * 0.40 + defState.hurt * 0.50;
  // landing-volume matters only weakly: getting your power shots off at all is most of
  // it, so the busier man doesn't convert a small volume edge into far more flush shots
  const vol = clamp(0.7 + power * 0.06, 0.7, 1.25);
  let p = T.BIGSHOT_BASE * vol
        * (0.55 + att.powerRating * 0.9)
        * (0.78 + att.sp.koThreat * T.BIGSHOT_KOTHREAT)
        * (0.7 + att.offence * T.BIGSHOT_ACC)
        * opening * evasion;
  p = clamp(p, 0, 0.6);
  if (!chance(p)) return { hit: false, dmg: 0 };
  // how much it hurts: power vs chin, amplified if the man is already compromised
  const wear = clamp((defState.dmgTaken || 0) / 520, 0, 0.42);
  const effChin = clamp(def.chinRating * (1 - wear * 0.45), 0.05, 1);
  const sev = (1.25 - effChin) * (0.7 + att.powerRating * 0.8);
  const dmg = rnd(T.BIGSHOT_DMG_LO, T.BIGSHOT_DMG_HI) * sev * (1 + defState.hurt * 0.4);
  return { hit: true, dmg: Math.max(0, dmg) };
}

/* ----- update a fighter's hurt level after the exchange ----- */
function updateHurt(defState, gotBigShot, def) {
  // a flush shot or a health collapse rocks a man
  if (gotBigShot || defState.health < T.HURT_HEALTH) {
    const sev = clamp((T.HURT_HEALTH - defState.health) / T.HURT_HEALTH, 0, 1);
    const add = (gotBigShot ? 0.45 : 0) + sev * 0.6;
    defState.hurt = clamp(defState.hurt + add * (1.05 - def.chinRating * 0.45), 0, 1);
  }
}

/* ----- knockdowns -----
   A man goes down off a flush, hurtful shot. The chance is driven by the
   attacker's power and whether he caught the man clean (bigShot) or already
   had him hurt, and resisted by the target's chin/durability. */
function knockdownRoll(att, def, power, counters, defState, cleanMe, cleanOpp, gotBigShot) {
  if (power <= 0 && counters <= 0) return 0;
  const wear = clamp((defState.dmgTaken || 0) / 520, 0, 0.42);
  const effChin = clamp(def.chinRating * (1 - wear * 0.45), 0.05, 1);
  // base opportunity: you really only get dropped off something flush or when hurt
  const flushFactor = (gotBigShot ? 1 : 0.18) + defState.hurt * 0.7;
  const open = 1 + (1 - defState.health / 100) * 0.6;
  let p = T.KD_RATE * flushFactor
        * (0.35 + att.powerRating * T.KD_POWER)
        * (0.62 + att.sp.koThreat * 0.5)
        * (1.25 - effChin * T.KD_CHIN)
        * open
        * (defState.hurt > 0 ? (1 + defState.hurt * (T.KD_HURT - 1)) : 1)
        * 0.10;
  p = clamp(p, 0, 0.6);
  if (!chance(p)) return 0;
  // a really compromised man can be dropped more than once
  if ((defState.health < 22 || defState.hurt > 0.7) && chance(T.KD_SECOND)) return 2;
  return 1;
}

/* ----- stamina drain + between-round recovery ----- */
function staminaUpdate(att, def, out, fs, atk, dfn) {
  fs[dfn].stam -= out[atk].b * T.STAM_BODY; // taking body shots drains the tank
  fs[atk].stam = clamp(
    fs[atk].stam
      - out[atk].t * (T.STAM_VOL / (0.5 + att.conditioning))
      - (def.pressF * T.STAM_PRESS) * (1 - att.clinch * 0.4) * (def.sp.drainOpp ? 6 : 3)
      + (4 + att.recov * 5),
    0, 100
  );
}
function recover(defState, def, dmgThisRound) {
  const wear = clamp(defState.dmgTaken / 470, 0, 0.5);
  const base = (defState.health < 25 ? (T.REC_HURT + def.recovery * 1.9) : (T.REC_BASE + def.recovery * T.REC_RATE));
  const rec = base * (1 - wear) * clamp(1 - dmgThisRound / 42, 0.4, 1) * (defState.hurt > 0 ? T.HURT_RECOVER + (1 - T.HURT_RECOVER) * (1 - defState.hurt) : 1);
  // accumulated punishment lowers the ceiling a man can climb back to
  const ceiling = clamp(100 - defState.dmgTaken * T.CEIL_DMG, 28, 100);
  defState.health = clamp(Math.min(ceiling, defState.health + rec), -40, 100);
  // hurt fades between rounds (a good recovery clears the head faster)
  defState.hurt = clamp(defState.hurt * T.HURT_DECAY * (1 - def.recovery * 0.25), 0, 1);
}

/* ======================= round scoring ========================== */
function scoreRound(A, B, pfA, out, cleanA, cleanB) {
  const eps = 0.5;
  const cleanShareA = (cleanA + eps) / (cleanA + cleanB + 2 * eps);
  const effA = out.a.l * (0.7 + 0.6 * A.pressF), effB = out.b.l * (0.7 + 0.6 * B.pressF);
  const aggShareA = (effA + eps) / (effA + effB + 2 * eps);
  const ctrlShareA = clamp(pfA.shareA, 0.02, 0.98);
  const dInvA = 1 / (out.b.l + 1), dInvB = 1 / (out.a.l + 1);   // got hit less -> better defence
  const defShareA = dInvA / (dInvA + dInvB);

  out.scoreA = T.W_CLEAN * cleanShareA + T.W_AGG * aggShareA + T.W_CTRL * ctrlShareA + T.W_DEF * defShareA;
  out.scoreB = T.W_CLEAN * (1 - cleanShareA) + T.W_AGG * (1 - aggShareA) + T.W_CTRL * (1 - ctrlShareA) + T.W_DEF * (1 - defShareA);

  // pound-for-pound class: a small, deliberate nudge from raw overall rating so
  // the genuinely higher-rated fighter is reliably favoured even in a close
  // stylistic matchup — the intangible pedigree edge — without overriding the ring.
  const classEdge = clamp((A.ovr - B.ovr) * T.CLASS_EDGE, -0.06, 0.06);
  out.scoreA += classEdge;
  out.scoreB -= classEdge;

  // knockdowns dominate a round on the cards, exactly as in real boxing
  out.scoreA += out.kdB * T.KD_SCORE;
  out.scoreB += out.kdA * T.KD_SCORE;
}

/* ===================== stoppage resolution ====================== */
/* Several realistic routes, checked each round. The more-compromised man is
   checked first so the right fighter gets stopped. Accumulation/ref routes are
   driven by DOMINANCE (who is landing) so the better fighter usually delivers
   them; the count-out KO is the power wildcard available even from behind. */
function resolveStoppage(A, B, fs, out, r, scheduled, cleanA, cleanB) {
  const t = () => `${rndi(0, 2)}:${String(rndi(0, 59)).padStart(2, '0')}`;
  if (fs.a.fouls >= 3) return { method: 'DQ', round: r, timeStr: t(), winner: 'b' };
  if (fs.b.fouls >= 3) return { method: 'DQ', round: r, timeStr: t(), winner: 'a' };

  // domination this round (clean-work edge) — who is doing the hurting
  const domA = clamp((cleanA - cleanB) / (cleanA + cleanB + 1), -1, 1);

  // package the per-man data so we can check both directions with one routine
  const sideA = { me: fs.a, my: A, opp: fs.b, oppD: B, kd: out.kdA, dom: -domA, power: out.b.p, winner: 'b' };
  const sideB = { me: fs.b, my: B, opp: fs.a, oppD: A, kd: out.kdB, dom: domA, power: out.a.p, winner: 'a' };
  // ^ for sideB, the man at risk is B; the attacker is A (winner 'a'); dom>0 means A dominating

  const order = (fs.a.health <= fs.b.health) ? [sideA, sideB] : [sideB, sideA];
  for (const s of order) {
    const k = checkFinish(s, A, B, r, t);
    if (k) return k;
  }

  // ---- breakdown TKO: out-landed by a clear, sustained margin and worn down ----
  // The skilled boxer's route to a stoppage: he batters a man round after round and
  // the corner / referee eventually steps in. Volume-driven, so a slick light hitter
  // can earn it; gated to WIDE cumulative margins so thin-edge fights never trigger it.
  const breakdownChk = (defState, defRt, attState, attRt, winner) => {
    const tot = defState.landed + attState.landed;
    if (tot < 40 || r < 5) return null;
    const margin = (attState.landed - defState.landed) / tot;
    if (margin < T.BD_MARGIN || defState.health > T.BD_HEALTH) return null;
    const p = clamp(
      ((margin - T.BD_MARGIN) * T.BD_K + (T.BD_HEALTH - defState.health) / T.BD_HEALTH * 0.20)
      * (0.45 + r / scheduled)
      * (0.65 + attRt.finishing * 0.5)
      * (1.12 - defRt.heart * 0.5) * (1.08 - defRt.recovery * 0.35),
      0, 0.30);
    if (chance(p)) return { method: 'TKO', round: r, timeStr: t(), winner };
    return null;
  };
  { let bd = breakdownChk(fs.b, B, fs.a, A, 'a'); if (bd) return bd; bd = breakdownChk(fs.a, A, fs.b, B, 'b'); if (bd) return bd; }

  // ---- accumulation: a sustained, one-sided beating gets waved off ----
  const accChk = (defState, attState, attDom, winner) => {
    if (defState.dmgTaken > T.ACC_DMG && defState.health < 36 && defState.dmgTaken > attState.dmgTaken * T.ACC_DOM_RATIO) {
      const p = clamp(((defState.dmgTaken - T.ACC_DMG) / 300 + (36 - defState.health) / 36 * 0.18) * (0.7 + Math.max(0, attDom)) * (T.ACC_STOP_K / 0.26), 0, 0.34);
      if (chance(p)) return { method: 'TKO', round: r, timeStr: t(), winner };
    }
    return null;
  };
  { let ac = accChk(fs.b, fs.a, domA, 'a'); if (ac) return ac; ac = accChk(fs.a, fs.b, -domA, 'b'); if (ac) return ac; }

  // ---- corner retirement: a worn, dispirited fighter is pulled out ----
  if (r < scheduled) {
    const rtd = (defState, def, winner) => {
      if (defState.health < 24 && defState.dmgTaken > T.ACC_DMG * 0.8) {
        const p = clamp((24 - defState.health) / 24 * (1.05 - def.heart) * T.RTD_K, 0, 0.5);
        if (chance(p)) return { method: 'RTD', round: r, timeStr: 'end of round', winner };
      }
      return null;
    };
    let q = rtd(fs.b, B, 'a'); if (q) return q; q = rtd(fs.a, A, 'b'); if (q) return q;
  }

  // ---- doctor stoppage on a bad cut ----
  const docCheck = (defState, winner) => {
    if (defState.cut >= 6) {
      const p = clamp((defState.cut - 6) * T.CUT_STOP_K + 0.12 + r * 0.01, 0, 0.7);
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

/* the two acute finishes for one man at risk: count-out KO and referee TKO.
   In `s`: me/my = the at-risk fighter's state/ratings, oppD = the attacker's
   ratings, power = the attacker's power punches this round, dom>0 = attacker
   dominating, winner = who is awarded the stoppage. */
function checkFinish(s, A, B, r, t) {
  const risk = s.me, riskRt = s.my, atkRt = s.oppD;

  // three knockdowns in a round -> automatic
  if (s.kd >= 3) return { method: 'TKO', round: r, timeStr: t(), winner: s.winner };

  // count-out KO off a knockdown
  if (s.kd >= 1) {
    const healthSev = clamp(1 - risk.health / 100, 0, 1);
    let koP = T.KO_COUNT_BASE * Math.pow(healthSev, 1) * T.KO_COUNT_HEALTH
            * (1.05 - riskRt.recovery * T.KO_COUNT_HEART)
            * (0.7 + atkRt.finishing * T.REF_STOP_FINISH)
            * (s.kd >= 2 ? T.KO_MULTI_KD : 1);
    koP = clamp(koP, 0, 0.95);
    if (chance(koP)) return { method: 'KO', round: r, timeStr: t(), winner: s.winner };
    // didn't finish, but a man dropped and badly hurt can still be pulled out
    if (risk.health <= 14 && chance(clamp((14 - risk.health) / 14 * 0.5 + 0.14, 0, 0.8))) return { method: 'TKO', round: r, timeStr: t(), winner: s.winner };
  }

  // referee stoppage: a hurt man being teed off on, one-sided, no meaningful reply
  if ((risk.hurt > 0.45 || risk.health < 26) && s.power >= 2 && s.dom > 0.12) {
    const healthSev = clamp(1 - risk.health / 100, 0, 1);
    let refP = T.REF_STOP_BASE
             * (0.35 + healthSev * 0.9)
             * (0.4 + risk.hurt * 0.9)
             * clamp(s.dom * T.REF_STOP_DOM, 0, 1.1)
             * (0.6 + atkRt.finishing * T.REF_STOP_FINISH)
             * (1.05 - riskRt.heart * T.REF_STOP_HEART);
    refP = clamp(refP, 0, 0.75);
    if (chance(refP)) return { method: 'TKO', round: r, timeStr: t(), winner: s.winner };
  }
  return null;
}

/* ====================== decision from cards ===================== */
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

/* ====================== excitement 5..100 ======================= */
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

/* ======================= commentary ============================= */
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
    if (r.kdB) lines.push(`Round ${n}: ${aN} drops ${bN}${r.kdB > 1 ? ' twice' : ''} — huge moment in the fight.`);
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

/* ================= pre-fight booking estimate =================== */
function estimateFight(a, b, opts) {
  opts = opts || {};
  const rounds = opts.rounds || 12, titleFight = !!opts.titleFight, belts = opts.belts || [];
  const fake = { id: 'est', aId: a.id, bId: b.id, weightClass: opts.weightClass || a.weightClass, rounds, titleFight, belts, date: state.date };
  const stakes = stakesScore(fake);

  const N = 240;
  let aw = 0, bw = 0, dr = 0, stop = 0, ko = 0;
  for (let i = 0; i < N; i++) {
    const r = simulateFight(a, b, { rounds, titleFight });
    if (r.draw) dr++; else if (r.winnerId === a.id) aw++; else bw++;
    if (r.method === 'KO' || r.method === 'TKO' || r.method === 'RTD') stop++;
    if (r.method === 'KO') ko++;
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
    koPct: Math.round(ko / N * 100),
    eloSwing: { aWin, aLose, bWin, bLose },
    favRisk, favReward,
    purseEst, social: { a: socialA, b: socialB }
  };
}
