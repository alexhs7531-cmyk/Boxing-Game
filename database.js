/* =====================================================================
   Boxing Universe: God Mode
   database.js  -  data model, constants, boxer CRUD, random generation
   ---------------------------------------------------------------------
   Plain browser globals (no modules) so the game runs from file://.
   This file touches NO DOM and NO localStorage, so it can be tested
   headless. The single shared universe lives in the `state` object,
   which is mutated in place (never reassigned) so every file keeps the
   same reference.
   ===================================================================== */

/* ----------------------------- constants ----------------------------- */

const WEIGHT_CLASSES = [
  'Heavyweight', 'Cruiserweight', 'Light Heavyweight', 'Super Middleweight',
  'Middleweight', 'Super Welterweight', 'Welterweight', 'Super Lightweight',
  'Lightweight', 'Super Featherweight', 'Featherweight', 'Super Bantamweight',
  'Bantamweight', 'Super Flyweight', 'Flyweight'
];

const WEIGHT_CLASS_SHORT = {
  'Heavyweight': 'HW', 'Cruiserweight': 'CW', 'Light Heavyweight': 'LHW',
  'Super Middleweight': 'SMW', 'Middleweight': 'MW', 'Super Welterweight': 'SWW',
  'Welterweight': 'WW', 'Super Lightweight': 'SLW', 'Lightweight': 'LW',
  'Super Featherweight': 'SFW', 'Featherweight': 'FW', 'Super Bantamweight': 'SBW',
  'Bantamweight': 'BW', 'Super Flyweight': 'SFLW', 'Flyweight': 'FLW'
};

const STYLES = [
  'Out Boxer', 'Pressure Fighter', 'Counter Puncher', 'Swarmer', 'Slugger',
  'Defensive Master', 'Technical Boxer', 'Body Puncher', 'Knockout Artist',
  'Volume Puncher', 'Balanced'
];

const STANCES = ['Orthodox', 'Southpaw', 'Switch'];

const BELTS = ['WBC', 'WBA', 'IBF', 'WBO', 'Ring Magazine'];
const BELT_SHORT = { 'WBC': 'WBC', 'WBA': 'WBA', 'IBF': 'IBF', 'WBO': 'WBO', 'Ring Magazine': 'RING' };

const ATTR_KEYS = [
  'power', 'speed', 'stamina', 'chin', 'defence', 'footwork', 'jab',
  'combinations', 'counterpunching', 'bodyPunching', 'accuracy', 'aggression',
  'ringIQ', 'heart', 'discipline', 'recovery', 'cutResistance', 'clinch',
  'adaptability', 'killerInstinct'
];

const ATTR_LABELS = {
  power: 'Power', speed: 'Speed', stamina: 'Stamina', chin: 'Chin',
  defence: 'Defence', footwork: 'Footwork', jab: 'Jab', combinations: 'Combinations',
  counterpunching: 'Counterpunching', bodyPunching: 'Body Punching', accuracy: 'Accuracy',
  aggression: 'Aggression', ringIQ: 'Ring IQ', heart: 'Heart', discipline: 'Discipline',
  recovery: 'Recovery', cutResistance: 'Cut Resistance', clinch: 'Clinch',
  adaptability: 'Adaptability', killerInstinct: 'Killer Instinct'
};

const HIDDEN_KEYS = [
  'potential', 'confidence', 'durability', 'damageAccumulation', 'careerMomentum',
  'primeAge', 'declineAge', 'improvementRate', 'legacyScore'
];

const TRAITS = [
  'Iron Chin', 'Glass Jaw', 'Fast Starter', 'Late Bloomer', 'Slow Starter',
  'Heavy Hands', 'Featherfist', 'Marathon Lungs', 'Gas Tank Issues', 'Showman',
  'Quiet Professional', 'Cut Prone', 'Granite', 'Comeback King', 'Front Runner',
  'Durable', 'Fragile Hands', 'Body Snatcher', 'Headhunter', 'Ring General',
  'Hot Head', 'Cool Customer', 'Crowd Pleaser', 'Spoiler', 'Knockout Power',
  'Slick', 'Pressure Cooker', 'Counter Sniper', 'Warrior Spirit', 'Protected Prospect'
];

/* nationality + name pools for random generation */
const NATIONALITIES = [
  'USA', 'Mexico', 'United Kingdom', 'Ukraine', 'Russia', 'Japan',
  'Philippines', 'Cuba', 'Nigeria', 'Kazakhstan', 'Puerto Rico', 'Argentina',
  'Ireland', 'France', 'Australia', 'Colombia'
];

const FIRST_NAMES = {
  'USA': ['Marcus', 'Andre', 'Terrence', 'Deontay', 'Errol', 'Shawn', 'Caleb', 'Jermall', 'Devin', 'Keyshawn', 'Brandon', 'Tyrone'],
  'Mexico': ['Saul', 'Juan', 'Emanuel', 'Rey', 'Oscar', 'Julio', 'Luis', 'Mauricio', 'Eduardo', 'Diego', 'Rafael', 'Israel'],
  'United Kingdom': ['Anthony', 'Tyson', 'Daniel', 'Callum', 'Liam', 'Joe', 'Conor', 'Lawrence', 'Chris', 'Josh', 'Dalton', 'Harlem'],
  'Ukraine': ['Oleksandr', 'Vasiliy', 'Denys', 'Serhii', 'Andriy', 'Bohdan', 'Yaroslav', 'Maksym', 'Roman', 'Taras', 'Ihor', 'Pavlo'],
  'Russia': ['Dmitry', 'Artur', 'Sergey', 'Murat', 'Maxim', 'Igor', 'Aslan', 'Ruslan', 'Nikita', 'Anton', 'Vadim', 'Timur'],
  'Japan': ['Naoya', 'Kenshiro', 'Ryota', 'Kazuto', 'Takashi', 'Hiroto', 'Sho', 'Yuki', 'Daigo', 'Kenta', 'Riku', 'Junto'],
  'Philippines': ['Manny', 'Nonito', 'Mark', 'Jerwin', 'John', 'Carl', 'Rey', 'Eumir', 'Marlon', 'Vince', 'Albert', 'Dave'],
  'Cuba': ['Yordenis', 'Erislandy', 'Guillermo', 'Robeisy', 'David', 'Lazaro', 'Yuniel', 'Osvaldo', 'Frank', 'Andy', 'Julio', 'Eddy'],
  'Nigeria': ['Efe', 'Anthony', 'Olanrewaju', 'Kabiru', 'Rilwan', 'Segun', 'Chukwuma', 'Tunde', 'Ikenna', 'Emeka', 'Femi', 'Bashir'],
  'Kazakhstan': ['Gennady', 'Daniyar', 'Zhanibek', 'Bekzad', 'Nursultan', 'Aibek', 'Azat', 'Yerlan', 'Kanat', 'Sanzhar', 'Ruslan', 'Olzhas'],
  'Puerto Rico': ['Felix', 'Hector', 'McWilliams', 'Subriel', 'Jose', 'Edgar', 'Wilfredo', 'Angel', 'Luis', 'Jonathan', 'Carlos', 'Emanuel'],
  'Argentina': ['Marcos', 'Brian', 'Sergio', 'Fabian', 'Lucas', 'Ramon', 'Nicolas', 'Diego', 'Ezequiel', 'Federico', 'Gaston', 'Maximiliano'],
  'Ireland': ['Katie', 'Michael', 'Jason', 'Aaron', 'Paddy', 'Gary', 'Tommy', 'Eric', 'Kieran', 'Sean', 'Niall', 'Dylan'],
  'France': ['Tony', 'Cedric', 'Nordine', 'Souleymane', 'Karim', 'Hugo', 'Romain', 'Bilal', 'Yvan', 'Mathieu', 'Sofiane', 'Theo'],
  'Australia': ['Jeff', 'George', 'Tim', 'Justis', 'Andrew', 'Jason', 'Liam', 'Harry', 'Brock', 'Cody', 'Sam', 'Nathan'],
  'Colombia': ['Eleider', 'Oscar', 'Deivis', 'Miguel', 'Jaider', 'Yeison', 'Breidis', 'Carlos', 'Andres', 'Jhon', 'Sebastian', 'Camilo']
};

const LAST_NAMES = {
  'USA': ['Reed', 'Carter', 'Hughes', 'Bishop', 'Coleman', 'Flowers', 'Marshall', 'Banks', 'Whitaker', 'Cross', 'Daniels', 'Mercer'],
  'Mexico': ['Ramirez', 'Vargas', 'Navarro', 'Quintero', 'Castillo', 'Mendoza', 'Salido', 'Beltran', 'Cuevas', 'Fuentes', 'Trejo', 'Lozano'],
  'United Kingdom': ['Okafor', 'Bellew', 'Hayes', 'Sterling', 'Crawley', 'Whitfield', 'Mason', 'Eubank', 'Catterall', 'Pratley', 'Ward', 'Dunne'],
  'Ukraine': ['Kovalenko', 'Bondarenko', 'Hryhoriev', 'Tkachenko', 'Melnyk', 'Shevchuk', 'Koval', 'Lytvyn', 'Marchenko', 'Boyko', 'Savchenko', 'Petrenko'],
  'Russia': ['Volkov', 'Petrov', 'Sokolov', 'Lebedev', 'Orlov', 'Morozov', 'Egorov', 'Pavlov', 'Bykov', 'Gusev', 'Zaytsev', 'Frolov'],
  'Japan': ['Tanaka', 'Sato', 'Watanabe', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Saito', 'Kato', 'Ishii', 'Mori', 'Hayashi', 'Ueno'],
  'Philippines': ['Santos', 'Reyes', 'Cruz', 'Bautista', 'Villanueva', 'Aquino', 'del Rosario', 'Pacquiao', 'Mercado', 'Domingo', 'Salud', 'Magramo'],
  'Cuba': ['Ugas', 'Lara', 'Rigondeaux', 'Ramirez', 'Iglesias', 'Cordova', 'Morales', 'Aguero', 'Cruz', 'Solis', 'Cespedes', 'Duarte'],
  'Nigeria': ['Ajagba', 'Joshua', 'Okolie', 'Adeleye', 'Balogun', 'Oyelola', 'Eze', 'Adewale', 'Nwosu', 'Okonkwo', 'Abubakar', 'Lawal'],
  'Kazakhstan': ['Golovkin', 'Yeleussinov', 'Alimkhanuly', 'Sapiyev', 'Zhakiyanov', 'Bekzhanov', 'Tursyngali', 'Yerdos', 'Mukhamediyev', 'Saparbay', 'Tanatar', 'Bekbolat'],
  'Puerto Rico': ['Verdejo', 'Camacho', 'Arroyo', 'Matias', 'Pedraza', 'Santiago', 'Rosario', 'Cintron', 'Vazquez', 'Berrios', 'Cruz', 'Rivera'],
  'Argentina': ['Maidana', 'Castano', 'Martinez', 'Aceituno', 'Romero', 'Coria', 'Farias', 'Aguero', 'Gimenez', 'Sosa', 'Ledesma', 'Cabral'],
  'Ireland': ['Conlan', 'Taylor', 'Quigley', 'McKenna', 'Donovan', 'Cully', 'McCarthy', 'Sheehan', 'Walsh', 'Nevin', 'Doheny', 'Marley'],
  'France': ['Yoka', 'Doumbe', 'Oubaali', 'Cisse', 'Bentahar', 'Mehidi', 'Bouafia', 'Diallo', 'Lemos', 'Faure', 'Roman', 'Tabiti'],
  'Australia': ['Horn', 'Kambosos', 'Tszyu', 'Huni', 'Moloney', 'Gallen', 'Wilson', 'Garside', 'Jennings', 'Brock', 'Zerafa', 'Opelu'],
  'Colombia': ['Alvarez', 'Negrete', 'Fuentes', 'Marriaga', 'Quinones', 'Caicedo', 'Rangel', 'Mosquera', 'Valencia', 'Romero', 'Polo', 'Cabrera']
};

const CITIES = {
  'USA': ['Brooklyn', 'Las Vegas', 'Philadelphia', 'Detroit', 'Houston', 'Cleveland', 'Atlanta', 'Oakland'],
  'Mexico': ['Guadalajara', 'Mexicali', 'Tijuana', 'Mexico City', 'Sonora', 'Culiacan', 'Monterrey', 'Los Mochis'],
  'United Kingdom': ['London', 'Manchester', 'Liverpool', 'Sheffield', 'Birmingham', 'Bolton', 'Leeds', 'Newcastle'],
  'Ukraine': ['Kyiv', 'Kharkiv', 'Lviv', 'Odesa', 'Simferopol', 'Dnipro', 'Donetsk', 'Zaporizhzhia'],
  'Russia': ['Moscow', 'Saint Petersburg', 'Yekaterinburg', 'Chelyabinsk', 'Nizhny Novgorod', 'Kazan', 'Sochi', 'Omsk'],
  'Japan': ['Tokyo', 'Osaka', 'Yokohama', 'Nagoya', 'Sapporo', 'Fukuoka', 'Kobe', 'Saitama'],
  'Philippines': ['Manila', 'General Santos', 'Cebu', 'Davao', 'Bacolod', 'Iloilo', 'Tagum', 'Quezon City'],
  'Cuba': ['Havana', 'Santiago de Cuba', 'Camaguey', 'Holguin', 'Guantanamo', 'Matanzas', 'Cienfuegos', 'Las Tunas'],
  'Nigeria': ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt', 'Benin City', 'Kaduna', 'Enugu'],
  'Kazakhstan': ['Almaty', 'Astana', 'Karaganda', 'Shymkent', 'Aktobe', 'Taraz', 'Pavlodar', 'Semey'],
  'Puerto Rico': ['San Juan', 'Bayamon', 'Ponce', 'Caguas', 'Carolina', 'Guaynabo', 'Mayaguez', 'Trujillo Alto'],
  'Argentina': ['Buenos Aires', 'Cordoba', 'Rosario', 'Mendoza', 'Santa Fe', 'Mar del Plata', 'Tucuman', 'Margarita'],
  'Ireland': ['Dublin', 'Belfast', 'Cork', 'Limerick', 'Bray', 'Monaghan', 'Mullingar', 'Galway'],
  'France': ['Paris', 'Marseille', 'Lyon', 'Lille', 'Nice', 'Toulouse', 'Strasbourg', 'Bordeaux'],
  'Australia': ['Sydney', 'Brisbane', 'Melbourne', 'Perth', 'Toowoomba', 'Adelaide', 'Newcastle', 'Gold Coast'],
  'Colombia': ['Bogota', 'Medellin', 'Cali', 'Barranquilla', 'Cartagena', 'Buenaventura', 'Cucuta', 'Pereira']
};

const NICKNAMES = [
  'The Hammer', 'King', 'The Truth', 'Iron', 'The Beast', 'Mr. Knockout', 'Sniper',
  'The Surgeon', 'Hitman', 'The Machine', 'Lightning', 'The Bull', 'Cobra', 'The Wolf',
  'Money', 'The Cobra', 'Pretty Boy', 'The Magic Man', 'El Toro', 'The Destroyer',
  'Bad Intentions', 'The Spider', 'Concrete', 'The Predator', 'Bones', 'The Mongoose',
  'Dynamite', 'The Reaper', 'Smooth', 'The Phantom', 'Thunder', 'The Tank', 'Diamond',
  'The Czar', 'The Saint', 'The Nightmare', 'Showtime', 'The Mexican Hawk', 'Sugar',
  'The Body Snatcher', 'The Technician', 'Goldenboy', 'The Viper', 'The Eraser', 'Vandal'
];

const STYLE_PROFILES = {
  /* volume: punch output multiplier, power: power-punch share, counter: bonus vs aggressors,
     defence: damage reduction, staminaUse: extra drain, koThreat: variance on stoppages,
     decision: close-decision edge */
  'Out Boxer':          { volume: 0.96, power: 0.26, counter: 0.10, defence: 0.14, staminaUse: 0.92, koThreat: 0.85, decision: 1.08 },
  'Pressure Fighter':   { volume: 1.10, power: 0.34, counter: -0.05, defence: -0.04, staminaUse: 1.06, koThreat: 1.05, decision: 0.98, drainOpp: 0.10 },
  'Counter Puncher':    { volume: 0.90, power: 0.36, counter: 0.30, defence: 0.10, staminaUse: 0.90, koThreat: 1.04, decision: 1.06 },
  'Swarmer':            { volume: 1.18, power: 0.32, counter: -0.06, defence: -0.06, staminaUse: 1.10, koThreat: 1.02, decision: 0.96, drainOpp: 0.12 },
  'Slugger':            { volume: 0.92, power: 0.46, counter: -0.04, defence: -0.10, staminaUse: 1.04, koThreat: 1.30, decision: 0.92 },
  'Defensive Master':   { volume: 0.88, power: 0.28, counter: 0.18, defence: 0.22, staminaUse: 0.86, koThreat: 0.80, decision: 1.10 },
  'Technical Boxer':    { volume: 1.00, power: 0.30, counter: 0.12, defence: 0.12, staminaUse: 0.94, koThreat: 0.90, decision: 1.14 },
  'Body Puncher':       { volume: 1.04, power: 0.36, counter: 0.04, defence: 0.02, staminaUse: 0.98, koThreat: 1.06, decision: 1.00, body: 0.18, drainOpp: 0.08 },
  'Knockout Artist':    { volume: 0.94, power: 0.48, counter: 0.00, defence: -0.06, staminaUse: 1.00, koThreat: 1.34, decision: 0.94 },
  'Volume Puncher':     { volume: 1.22, power: 0.28, counter: 0.00, defence: -0.02, staminaUse: 1.08, koThreat: 0.96, decision: 1.04, drainOpp: 0.06 },
  'Balanced':           { volume: 1.00, power: 0.32, counter: 0.06, defence: 0.06, staminaUse: 1.00, koThreat: 1.00, decision: 1.00 }
};

/* --------------------------- math helpers --------------------------- */

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function rndi(lo, hi) { return Math.floor(lo + Math.random() * (hi - lo + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }
function round1(x) { return Math.round(x * 10) / 10; }
/* approx normal via sum of uniforms, centred on `mean`, clamped 1..100 */
function gaussAttr(mean, spread) {
  const r = (Math.random() + Math.random() + Math.random()) / 3; // 0..1, centred
  return clamp(Math.round(mean + (r - 0.5) * 2 * spread), 1, 100);
}

/* ---------------------------- date helpers --------------------------- */

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); } // m is 1-12
function dateToStr(d) { return `${d.d} ${MONTH_NAMES[d.m - 1]} ${d.y}`; }
function dateToKey(d) { return d.y * 10000 + d.m * 100 + d.d; }
function dateCompare(a, b) { return dateToKey(a) - dateToKey(b); }
function cloneDate(d) { return { y: d.y, m: d.m, d: d.d }; }
function addDays(d, n) {
  let { y, m } = d, day = d.d + n;
  while (day > daysInMonth(y, m)) { day -= daysInMonth(y, m); m++; if (m > 12) { m = 1; y++; } }
  while (day < 1) { m--; if (m < 1) { m = 12; y--; } day += daysInMonth(y, m); }
  return { y, m, d: day };
}
function addMonths(d, n) {
  let total = (d.y * 12 + (d.m - 1)) + n;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  const day = Math.min(d.d, daysInMonth(y, m));
  return { y, m, d: day };
}

/* --------------------------- universe state -------------------------- */

const state = {};

function createEmptyUniverse() {
  return {
    meta: { version: 1, created: Date.now(), universeName: 'Boxing Universe' },
    settings: { speed: 'manual', autoSimScheduled: false, autosave: true, compactSaved: false },
    date: { y: 2026, m: 1, d: 1 },
    boxers: {},
    fights: [],
    cards: [],
    champions: {},          // weightClass -> { belt -> boxerId }
    titleHistory: [],       // { date, weightClass, belt, championId, formerId, fightId }
    awards: {},             // year -> { ... }
    counters: { boxer: 1, fight: 1, card: 1 }
  };
}

/* replace the universe in place so the shared `state` reference is kept */
function replaceState(obj) {
  Object.keys(state).forEach(k => delete state[k]);
  Object.assign(state, obj);
  // make sure champion buckets exist for every weight class
  WEIGHT_CLASSES.forEach(wc => { if (!state.champions[wc]) state.champions[wc] = {}; });
}

function genId(kind) {
  if (!state.counters) state.counters = { boxer: 1, fight: 1, card: 1 };
  const n = state.counters[kind] || 1;
  state.counters[kind] = n + 1;
  return `${kind[0]}${n}`;
}

/* --------------------------- boxer factory --------------------------- */

function defaultAttributes(level) {
  const m = level || 50;
  const a = {};
  ATTR_KEYS.forEach(k => { a[k] = m; });
  return a;
}

function deriveHidden(b) {
  const a = b.attributes;
  const ovr = overallFrom(a);
  return {
    potential: clamp(Math.round(ovr + rndi(2, 14)), ovr, 99),
    confidence: rndi(55, 72),
    durability: clamp(Math.round((a.chin * 0.5 + a.recovery * 0.3 + a.heart * 0.2)), 1, 100),
    damageAccumulation: 0,
    careerMomentum: 0,
    primeAge: rndi(27, 30),
    declineAge: rndi(33, 36),
    improvementRate: round1(rnd(0.7, 1.4)),
    legacyScore: 0
  };
}

function makeBoxer(p) {
  p = p || {};
  const today = (state.date && state.date.y) ? state.date : { y: 2026, m: 1, d: 1 };
  const attributes = Object.assign(defaultAttributes(50), p.attributes || {});
  ATTR_KEYS.forEach(k => { attributes[k] = clamp(Math.round(attributes[k]), 1, 100); });

  const age = p.age != null ? p.age : 24;
  const b = {
    id: p.id || genId('boxer'),
    name: p.name || 'New Boxer',
    nickname: p.nickname || '',
    nationality: p.nationality || 'USA',
    hometown: p.hometown || '',
    age: age,
    birthYear: today.y - age,
    height: p.height || 178,             // cm
    reach: p.reach || 180,               // cm
    weightClass: p.weightClass || 'Lightweight',
    stance: p.stance || 'Orthodox',
    style: p.style || 'Balanced',
    debutYear: p.debutYear || today.y,
    followers: Math.max(0, Math.round(p.followers != null ? p.followers : 0)),
    popularity: clamp(Math.round(p.popularity != null ? p.popularity : 30), 0, 100),
    hype: clamp(Math.round(p.hype != null ? p.hype : 30), 0, 100),
    credibility: clamp(Math.round(p.credibility != null ? p.credibility : 30), 0, 100),
    elo: Math.round(p.elo != null ? p.elo : 1000),
    record: Object.assign({ w: 0, l: 0, d: 0, ko: 0, koLoss: 0 }, p.record || {}),
    titles: p.titles ? p.titles.slice() : [],
    traits: p.traits ? p.traits.slice() : [],
    attributes: attributes,
    hidden: null,
    status: p.status || 'active',
    retiredDate: p.retiredDate || null,
    debutDate: p.debutDate || cloneDate(today),
    fightHistory: p.fightHistory ? p.fightHistory.slice() : [],
    eloHistory: p.eloHistory ? p.eloHistory.slice() : [{ d: dateToStr(today), e: Math.round(p.elo != null ? p.elo : 1000) }],
    followerHistory: p.followerHistory ? p.followerHistory.slice() : [{ d: dateToStr(today), f: Math.max(0, Math.round(p.followers != null ? p.followers : 0)) }],
    currentStreak: p.currentStreak || { type: null, count: 0 },
    bestWinId: p.bestWinId || null,
    worstLossId: p.worstLossId || null,
    titleFightsW: p.titleFightsW || 0,
    titleFightsL: p.titleFightsL || 0,
    titleDefences: p.titleDefences || 0,
    rankedWins: p.rankedWins || 0,
    earnings: Math.max(0, Math.round(p.earnings || 0)),
    peakElo: Math.round(p.peakElo || (p.elo != null ? p.elo : 1000)),
    peakFollowers: Math.max(0, Math.round(p.peakFollowers || (p.followers != null ? p.followers : 0))),
    injury: p.injury || null,
    created: p.created || Date.now()
  };
  b.hidden = p.hidden ? Object.assign(deriveHidden(b), p.hidden) : deriveHidden(b);
  return b;
}

/* ------------------------------- CRUD -------------------------------- */

function addBoxer(p) {
  const b = makeBoxer(p);
  state.boxers[b.id] = b;
  return b;
}
function getBoxer(id) { return state.boxers[id] || null; }
function allBoxers() { return Object.values(state.boxers); }
function activeBoxers() { return allBoxers().filter(b => b.status === 'active'); }
function retiredBoxers() { return allBoxers().filter(b => b.status === 'retired'); }

function updateBoxer(id, patch) {
  const b = state.boxers[id];
  if (!b) return null;
  Object.keys(patch).forEach(k => {
    if (k === 'attributes') { Object.assign(b.attributes, patch.attributes); }
    else if (k === 'hidden') { Object.assign(b.hidden, patch.hidden); }
    else if (k === 'record') { Object.assign(b.record, patch.record); }
    else { b[k] = patch[k]; }
  });
  ATTR_KEYS.forEach(k => { b.attributes[k] = clamp(Math.round(b.attributes[k]), 1, 100); });
  if (b.age != null) b.birthYear = state.date.y - b.age;
  return b;
}

function deleteBoxer(id) {
  delete state.boxers[id];
  // strip belts held
  WEIGHT_CLASSES.forEach(wc => {
    BELTS.forEach(belt => { if (state.champions[wc] && state.champions[wc][belt] === id) delete state.champions[wc][belt]; });
  });
}

function duplicateBoxer(id) {
  const src = state.boxers[id];
  if (!src) return null;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = genId('boxer');
  copy.name = src.name + ' (Copy)';
  copy.fightHistory = [];
  copy.titles = [];
  copy.record = { w: 0, l: 0, d: 0, ko: 0, koLoss: 0 };
  copy.currentStreak = { type: null, count: 0 };
  copy.earnings = 0;
  copy.titleDefences = 0;
  copy.titleFightsW = 0;
  copy.titleFightsL = 0;
  copy.rankedWins = 0;
  copy.peakElo = copy.elo;
  copy.peakFollowers = copy.followers;
  copy.bestWinId = null;
  copy.worstLossId = null;
  copy.injury = null;
  copy.eloHistory = [{ d: dateToStr(state.date), e: copy.elo }];
  copy.followerHistory = [{ d: dateToStr(state.date), f: copy.followers }];
  copy.created = Date.now();
  state.boxers[copy.id] = copy;
  return copy;
}

function retireBoxer(id) {
  const b = state.boxers[id];
  if (!b) return;
  b.status = 'retired';
  b.retiredDate = cloneDate(state.date);
  // vacate belts
  WEIGHT_CLASSES.forEach(wc => {
    BELTS.forEach(belt => {
      if (state.champions[wc] && state.champions[wc][belt] === id) {
        delete state.champions[wc][belt];
        state.titleHistory.push({ date: cloneDate(state.date), weightClass: wc, belt, championId: null, formerId: id, fightId: null, vacated: true });
      }
    });
  });
}
function unretireBoxer(id) {
  const b = state.boxers[id];
  if (!b) return;
  b.status = 'active';
  b.retiredDate = null;
}

/* --------------------------- ratings + format ------------------------ */

function overallFrom(a) {
  // weighted boxing overall on a 1..100 scale
  const w = {
    power: 1.1, speed: 1.0, stamina: 0.9, chin: 1.0, defence: 1.1, footwork: 0.9,
    jab: 0.8, combinations: 0.9, counterpunching: 0.8, bodyPunching: 0.7, accuracy: 1.0,
    aggression: 0.4, ringIQ: 1.1, heart: 0.7, discipline: 0.5, recovery: 0.7,
    cutResistance: 0.4, clinch: 0.4, adaptability: 0.8, killerInstinct: 0.9
  };
  let sum = 0, tot = 0;
  ATTR_KEYS.forEach(k => { sum += a[k] * w[k]; tot += w[k]; });
  return Math.round(sum / tot);
}
function overall(b) { return overallFrom(b.attributes); }

function recordStr(b) {
  const r = b.record;
  return `${r.w}-${r.l}${r.d ? '-' + r.d : ''} (${r.ko} KO)`;
}
function koPct(b) {
  const r = b.record;
  return r.w > 0 ? Math.round((r.ko / r.w) * 100) : 0;
}
function totalFights(b) { const r = b.record; return r.w + r.l + r.d; }
function isUndefeated(b) { return b.record.l === 0 && totalFights(b) > 0; }

function wcIndex(wc) { return WEIGHT_CLASSES.indexOf(wc); }

/* tier label from ELO, used in UI */
function eloTier(elo) {
  if (elo >= 1900) return 'Superstar';
  if (elo >= 1700) return 'Elite / Champion';
  if (elo >= 1500) return 'Contender';
  if (elo >= 1300) return 'Good Prospect';
  if (elo >= 1150) return 'Prospect';
  return 'Unknown';
}

/* ----------------------- random boxer generation --------------------- */

function eloFromOverall(ovr) {
  // map ovr (40..95) to a believable ELO with noise
  const base = 760 + (ovr - 40) * 22;
  return Math.round(clamp(base + rnd(-70, 70), 700, 2050));
}

function styleForAttrs() { return pick(STYLES); }

function randomBoxer(opts) {
  opts = opts || {};
  const nationality = opts.nationality || pick(NATIONALITIES);
  const first = pick(FIRST_NAMES[nationality] || FIRST_NAMES['USA']);
  const last = pick(LAST_NAMES[nationality] || LAST_NAMES['USA']);
  const wc = opts.weightClass || pick(WEIGHT_CLASSES);
  const style = opts.style || styleForAttrs();

  // talent band: 0 weak journeyman .. 1 elite
  const band = opts.band != null ? opts.band : clamp(rnd(0.15, 0.95), 0, 1);
  const mean = 44 + band * 44;          // ~44..88 mean attribute
  const spread = 16 - band * 6;         // tighter for elites

  const attributes = {};
  ATTR_KEYS.forEach(k => { attributes[k] = gaussAttr(mean, spread); });
  // tilt attributes toward the chosen style so the matchup engine has teeth
  const sp = STYLE_PROFILES[style];
  if (style === 'Slugger' || style === 'Knockout Artist') { attributes.power = clamp(attributes.power + rndi(6, 16), 1, 100); attributes.killerInstinct = clamp(attributes.killerInstinct + rndi(5, 14), 1, 100); }
  if (style === 'Out Boxer' || style === 'Technical Boxer') { attributes.jab = clamp(attributes.jab + rndi(5, 13), 1, 100); attributes.footwork = clamp(attributes.footwork + rndi(5, 13), 1, 100); attributes.ringIQ = clamp(attributes.ringIQ + rndi(4, 12), 1, 100); }
  if (style === 'Defensive Master') { attributes.defence = clamp(attributes.defence + rndi(8, 16), 1, 100); attributes.footwork = clamp(attributes.footwork + rndi(4, 12), 1, 100); }
  if (style === 'Pressure Fighter' || style === 'Swarmer') { attributes.aggression = clamp(attributes.aggression + rndi(8, 16), 1, 100); attributes.stamina = clamp(attributes.stamina + rndi(4, 12), 1, 100); }
  if (style === 'Volume Puncher') { attributes.combinations = clamp(attributes.combinations + rndi(6, 14), 1, 100); attributes.stamina = clamp(attributes.stamina + rndi(5, 12), 1, 100); }
  if (style === 'Counter Puncher') { attributes.counterpunching = clamp(attributes.counterpunching + rndi(8, 16), 1, 100); attributes.accuracy = clamp(attributes.accuracy + rndi(4, 12), 1, 100); }
  if (style === 'Body Puncher') { attributes.bodyPunching = clamp(attributes.bodyPunching + rndi(8, 16), 1, 100); }

  const ovr = overallFrom(attributes);
  const age = opts.age != null ? opts.age : rndi(18, 36);
  const height = ({ 'Heavyweight': 190, 'Cruiserweight': 186, 'Light Heavyweight': 184, 'Super Middleweight': 183, 'Middleweight': 180, 'Super Welterweight': 179, 'Welterweight': 177, 'Super Lightweight': 175, 'Lightweight': 173, 'Super Featherweight': 171, 'Featherweight': 169, 'Super Bantamweight': 168, 'Bantamweight': 166, 'Super Flyweight': 165, 'Flyweight': 164 }[wc] || 175) + rndi(-5, 6);
  const elo = opts.elo != null ? opts.elo : eloFromOverall(ovr);

  // followers/hype scale with talent + age + noise; clean (debut) unless veteran mode
  const fameBase = Math.pow(Math.max(0, ovr - 35) / 60, 2.4);
  const followers = Math.round(fameBase * rnd(20000, 1600000) + rnd(0, 8000));

  const traits = [];
  const nTraits = rndi(0, 3);
  for (let i = 0; i < nTraits; i++) { const t = pick(TRAITS); if (!traits.includes(t)) traits.push(t); }

  const seedEarnings = opts.veteran
    ? Math.round((record.w * rnd(0.3, 1.8) + record.ko * rnd(0.2, 1.2)) * 1e6 * Math.pow(clamp((ovr - 40) / 55, 0, 1), 1.6))
    : 0;

  let record = { w: 0, l: 0, d: 0, ko: 0, koLoss: 0 };
  if (opts.veteran) {
    const fights = clamp(Math.round((age - 17) * rnd(1.5, 3.2)), 0, 60);
    const winRate = clamp(0.3 + band * 0.55 + rnd(-0.1, 0.1), 0.1, 0.95);
    const w = Math.round(fights * winRate);
    const d = chance(0.3) ? rndi(0, 2) : 0;
    const l = Math.max(0, fights - w - d);
    record = { w, l, d, ko: Math.round(w * clamp(0.3 + (attributes.power / 250), 0.1, 0.8)), koLoss: Math.round(l * rnd(0.2, 0.5)) };
  }

  return {
    name: `${first} ${last}`,
    nickname: chance(0.55) ? pick(NICKNAMES) : '',
    nationality,
    hometown: pick(CITIES[nationality] || ['']),
    age,
    height,
    reach: height + rndi(-2, 8),
    weightClass: wc,
    stance: chance(0.78) ? 'Orthodox' : (chance(0.85) ? 'Southpaw' : 'Switch'),
    style,
    debutYear: state.date.y - clamp(age - 18, 0, 18),
    followers,
    popularity: clamp(Math.round(ovr - 25 + rnd(-10, 10)), 5, 100),
    hype: clamp(Math.round(ovr - 28 + (age < 24 ? 10 : 0) + rnd(-10, 12)), 5, 100),
    credibility: clamp(Math.round((opts.veteran ? ovr - 30 : ovr - 45) + rnd(-8, 8)), 0, 100),
    elo,
    record,
    earnings: seedEarnings,
    traits,
    attributes
  };
}

function bulkGenerate(n, opts) {
  const made = [];
  for (let i = 0; i < n; i++) made.push(addBoxer(randomBoxer(opts || {})));
  return made;
}

/* ----------------------- presentation helpers ----------------------- */
function fmtMoney(n) {
  n = Math.round(n || 0);
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.00$/, '') + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + n;
}
function fmtFollowers(n) {
  n = Math.round(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '' + n;
}
function careerPhase(b) {
  if (b.status === 'retired') return 'Retired';
  if (b.age <= 21) return 'Raw prospect';
  if (b.age <= 24) return 'Rising';
  if (b.age <= b.hidden.primeAge + 1) return 'Prime';
  if (b.age <= b.hidden.declineAge) return 'Veteran';
  return 'Faded';
}
