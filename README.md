# Boxing Universe — God Mode

A single-player sandbox where **you are the god and commissioner of an entire boxing world**. You create every fighter, book every fight, hand out (or strip) every belt, and roll time forward at your own pace. Nothing in the world changes unless you make it happen — records, ELO, fame and earnings only ever move through fights you set up.

It runs entirely in the browser, with no server, no build step and no account. Everything is saved locally so you can play the same universe across months.

---

## Run it

**Locally:** unzip the folder and double-click `index.html`. That's it — it opens in any modern browser and works straight off the file system.

**On the web (GitHub Pages):**
1. Create a new repository and upload every file in this folder (keep the structure flat — all files in the repo root).
2. In the repository, go to **Settings → Pages**, set the source to your default branch and the `/root` folder, and save.
3. Open the URL Pages gives you. The whole game is static, so it just works.

No frameworks, no bundler, no API keys.

---

## How to play

1. **Create fighters.** Build them one at a time on the *Create fighter* page, or hit *Generate* to populate divisions instantly (pick how many, which division, talent level, debutants or veterans). You can drop a raw 17-year-old into a world of grizzled veterans whenever you like — there are no restrictions on when or how many fighters you make. Building a prime version of a legend? Tick **Freeze attributes** and that fighter's ratings will never change from fights or ageing — their ELO, fame, earnings and record still move, but the prime stays the prime.
2. **Book a fight.** On *Book a fight*, pick two fighters and set the stakes (weight, rounds, whether belts are on the line). You get a live **tale-of-the-tape** with a win-probability bar and a full forecast: stoppage odds, hype, the ELO swing if the favourite wins or loses, the projected purse, and how each fighter's following will move. Simulate it instantly, or add it to a card.
3. **Build cards.** Group several bouts into a *Fight card*, then run the whole card at once, or schedule it for a future date.
4. **Advance time.** On *Simulate time*, move the clock by a day, week, month, quarter or year. Fighters age on 1 January each year — developing toward their potential when young, declining when old, each on their own curve. Year-end awards are decided automatically from the fights you staged. Set the speed to **Manual** to run every card yourself, or to **Slow/Fast/Instant** to have scheduled cards resolve automatically as time passes.
5. **Track everything.** *Leaderboards* cover current rankings and deep all-time boards (pound-for-pound, fame, records, earnings, longest reigns, legacy — the all-time boards keep retired legends listed forever). *Champions* shows every belt by division with reign length, defences and full lineage, and lets you assign or vacate belts by decree. *Social media*, *Results*, *History*, *Awards* and the *Archive* round out the record books.
6. **Retire on your terms.** Only you retire a fighter. Retired fighters move to the *Archive* with their full record, title history and career winnings intact — and you can un-retire them any time. Keep creating new fighters endlessly.

---

## Attributes drive the fights

Every fighter has 20 visible attributes, and **all of them feed the round-by-round engine** — there are no decorative stats. A few examples of how they shape a bout:

- **Power** and **Killer Instinct** set how much damage clean shots do and how reliably a hurt opponent gets finished.
- **Accuracy, Jab, Combinations** govern how much clean work lands; combinations also lift output.
- **Counterpunching** punishes opponents who lead — deadly against pressure and sluggers.
- **Defence, Footwork, Ring IQ, Speed** reduce what the opponent lands; elite defence can shut a fight down.
- **Chin, Recovery, Heart** decide who survives knockdowns, recovers between rounds and refuses to be pulled out.
- **Stamina** and **Discipline** are the gas tank and composure — fade late and you get hit more, stopped more, and risk point deductions.
- **Adaptability** lets a fighter solve a bad style matchup and land more as the rounds wear on.
- **Clinch** ties up to survive when hurt and blunts a pressure fighter draining your tank.
- **Body Punching** saps stamina and sets up late stoppages; **Cut Resistance** avoids doctor stoppages.

Every rating in the game is out of **99** — attributes as well as confidence, popularity, hype and credibility (so 99 is the ceiling for all of them). Hidden development stats (potential, prime age, decline age, improvement rate, durability) decide how each fighter grows and ages over the years, unless the fighter is frozen. Every result includes a **Keys to the fight** read generated from the actual attribute gaps and what happened in the ring, plus full scorecards, punch stats and an optional round-by-round breakdown — so you can see *why* a fight went the way it did. There's an in-app explainer on the Create and Profile pages too.

---

## Saving and backups

- Your universe **autosaves in this browser** after every change. Come back later on the same browser and it's still there.
- For a game you'll play across months, use **Save & load → Export universe** to download a JSON backup. You can re-import it here or on another device at any time. This is the safe way to protect a long-running save.
- If a very large universe approaches the browser's storage limit, the oldest *round-by-round* fight detail is trimmed automatically to make room (records, results, scorecards and stats are always kept). Exporting a backup preserves full detail.
- *Database tools* also lets you export/import individual fighters as JSON to move them between universes.

---

## File overview

| File | Purpose |
|------|---------|
| `index.html` | Shell, navigation and script load order |
| `styles.css` | The full visual identity |
| `database.js` | Constants, fighter model, CRUD, generators |
| `engine.js` | World progression: ELO, fame, money, titles, ageing, awards |
| `fightEngine.js` | The fight simulation — every attribute feeds this |
| `rankings.js` | Filters, leaderboards, champions and lineage |
| `save.js` | Local saving, autosave, export/import |
| `ui.js` | All pages and rendering |
| `app.js` | Boot, navigation and the time-advance loop |

Built to run offline, deploy as static files, and keep one boxing world alive for as long as you want to run it.
