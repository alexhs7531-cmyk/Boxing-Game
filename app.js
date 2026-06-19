/* =====================================================================
   app.js  -  boot, shell wiring, global events, time advance
   ===================================================================== */

/* run a card without opening a modal (used by auto-advance) */
function runCardSilently(card) {
  card.bouts.filter(bt => !bt.fightId).forEach(bt => {
    const f = stageFight(bt.aId, bt.bId, { rounds: bt.rounds, titleFight: bt.titleFight, belts: bt.belts, weightClass: bt.weightClass, eventName: card.name, venue: card.venue, date: card.date, cardId: card.id });
    bt.fightId = f.id;
  });
  card.status = 'completed';
}

/* advance the clock; age fighters at year turns; auto-run due cards in non-manual modes */
function advanceTime(unit) {
  const before = cloneDate(state.date);
  let target;
  if (unit === 'week') target = addDays(state.date, 7);
  else if (unit === 'month') target = addMonths(state.date, 1);
  else if (unit === 'quarter') target = addMonths(state.date, 3);
  else if (unit === 'year') target = addMonths(state.date, 12);
  else target = addDays(state.date, 1);

  const summary = { aged: 0, awards: [], cards: 0, fights: 0 };

  // age everyone once per 1 January crossed, and decide that year's awards
  for (let y = before.y; y < target.y; y++) {
    ageAllForYear();
    summary.aged++;
    const aw = computeAwardsForYear(y);
    if (aw) summary.awards.push(y);
  }

  // run scheduled cards that have come due (only outside manual mode)
  if (state.settings.autoSimScheduled) {
    const due = state.cards
      .filter(c => c.status === 'scheduled' && dateCompare(c.date, target) <= 0)
      .sort((a, b) => dateCompare(a.date, b.date));
    due.forEach(c => { summary.fights += c.bouts.filter(bt => !bt.fightId).length; runCardSilently(c); summary.cards++; });
  }

  state.date = target;
  saveUniverse();
  render();

  let msg = 'Now ' + dateToStr(target);
  const bits = [];
  if (summary.aged) bits.push(summary.aged === 1 ? 'a year passed' : summary.aged + ' years passed');
  if (summary.cards) bits.push(summary.cards + ' card' + (summary.cards === 1 ? '' : 's') + ' run (' + summary.fights + ' fights)');
  if (summary.awards.length) bits.push('awards for ' + summary.awards.join(', '));
  if (bits.length) msg += ' · ' + bits.join(' · ');
  toast(msg);
}

/* ----- shell wiring ----- */
function wireShell() {
  const drawer = $('.drawer'), scrim = $('#drawer-scrim'), menuBtn = $('#menu-btn');
  function closeDrawer() { drawer.classList.remove('open'); scrim.classList.remove('show'); }
  function openDrawer() { drawer.classList.add('open'); scrim.classList.add('show'); }
  if (menuBtn) menuBtn.addEventListener('click', () => drawer.classList.contains('open') ? closeDrawer() : openDrawer());
  if (scrim) scrim.addEventListener('click', closeDrawer);

  const speed = $('#tb-speed');
  if (speed) {
    speed.value = state.settings.speed;
    speed.addEventListener('change', () => {
      state.settings.speed = speed.value;
      state.settings.autoSimScheduled = (speed.value !== 'manual');
      saveUniverse();
      if (currentRoute === 'time') render();
    });
  }

  // one delegated handler for navigation, profiles, fight detail and modal close
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-link]');
    if (link) {
      let params = {};
      if (link.dataset.linkParams) { try { params = JSON.parse(link.dataset.linkParams); } catch (err) { } }
      closeModal();
      navigate(link.dataset.link, params);
      return;
    }
    const prof = e.target.closest('[data-profile]');
    if (prof) { closeModal(); navigate('profile', { id: prof.dataset.profile }); return; }
    const fight = e.target.closest('[data-fight]');
    if (fight) { const f = state.fights.find(x => x.id === fight.dataset.fight); if (f) showFightResult(f); return; }
    if (e.target.closest('[data-close-modal]')) { closeModal(); return; }
  });

  // Esc closes any open modal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

/* ----- boot ----- */
function boot() {
  if (!loadUniverse()) replaceState(createEmptyUniverse());
  wireShell();
  navigate('dashboard');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
