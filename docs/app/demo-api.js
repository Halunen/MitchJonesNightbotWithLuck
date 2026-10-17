// Public sandbox: every action runs in this visitor's browser. No Twitch or
// payout service is contacted, and no credentials are accepted.
(() => {
  'use strict';
  const engine = window.MitchLuckyEngine, paid = window.MitchLuckyPaidWinners;
  const storageKey = 'mitchlucky-public-demo-v1', instanceId = crypto.randomUUID();
  const listeners = new Set(), queue = [];
  let revision = 0, announcementTimer, lastSent = 0, storageAvailable = true, checkedAt = new Date().toISOString();
  let state;
  try { state = JSON.parse(localStorage.getItem(storageKey)); } catch { storageAvailable = false; }
  if (!state || state.version !== 1 || state.channel !== '__demo__' || !Array.isArray(state.round?.entrants) || !Array.isArray(state.history)) state = { version: 1, channel: '__demo__', history: [], ledger: {}, template: engine.DEFAULT_WINNER_MESSAGE, chat: [], round: engine.newRound() };
  for (const winner of [...state.history, state.round.winner].filter(Boolean)) if (winner.announcement?.status === 'pending') Object.assign(winner.announcement, { status: 'not-sent', reason: 'The page was closed before the demo message was confirmed.' });
  function save() { try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { storageAvailable = false; } }
  function sampleEntrants() {
    const characters = ['Thrall', 'Jaina', 'Arthas', 'Sylvanas', 'Illidan', 'Anduin', 'Tyrande', 'Malfurion', 'Garrosh', 'Voljin', 'Guldan', 'Khadgar', 'Alexstrasza', 'Chromie', 'Velen', 'Baine'];
    for (let i = characters.length - 1; i > 0; i--) { const j = window.MitchLuckyRandomInt(i + 1); [characters[i], characters[j]] = [characters[j], characters[i]]; }
    const names = ['CDEW', 'AndyM', 'CUDA', 'GJake', ...characters.slice(0, 8)];
    names.forEach((name, i) => {
      if (!engine.permitted(state.round.level, { login: name.toLowerCase(), broadcaster: i === 0, mod: i === 1, subscriber: i === 2 || i > 5 })) return;
      engine.enter(state.round, name, name, null, state.ledger);
    });
  }
  function startDemo() {
    state.round = engine.newRound(); state.round.status = 'open'; state.chat = [];
    checkedAt = new Date().toISOString(); sampleEntrants();
  }
  if (state.round.status === 'ready' && !state.history.length && !Object.keys(state.ledger).length) startDemo();
  function snapshot() {
    const records = paid.readDemoPaidWinners();
    const entrants = engine.pool(state.round, state.history.filter(h => h.roundId !== state.round.id), state.round.winner ? Date.parse(state.round.winner.at) : Date.now(), records);
    const total = entrants.reduce((sum, e) => sum + e.weight, 0);
    return { instanceId, revision, channel: '__demo__', demo: true, publicDemo: true, storageAvailable, serverNow: new Date().toISOString(), winnerMessageTemplate: state.template,
      payouts: { source: 'demo', checkedAt, refreshSeconds: 30, selectedWinner: state.round.winner ? records.find(w => w.login === state.round.winner.login) || null : null },
      round: { ...state.round, entrants: entrants.map(({ paidWinner, ...e }) => ({ ...e, odds: total ? e.weight / total : 0 })) },
      history: state.history, chat: state.chat, connection: { status: 'demo', message: 'Public sandbox: all viewers and payouts are sample data.' }, canRead: false, canSend: true };
  }
  function publish() { revision++; const event = { data: JSON.stringify(snapshot()) }; for (const listener of listeners) listener.onmessage?.(event); }
  function drain() {
    announcementTimer = null;
    while (queue.length) {
      const winner = queue[0], delivery = winner.announcement;
      if (delivery.status !== 'pending') { queue.shift(); continue; }
      const delay = 1700 - (Date.now() - lastSent);
      if (delay > 0) { announcementTimer = setTimeout(drain, delay + 10); return; }
      state.chat.push({ login: 'mitchlucky', displayName: 'MitchLucky (demo)', text: delivery.message, outgoing: true });
      if (state.chat.length > 40) state.chat.shift();
      lastSent = Date.now(); Object.assign(delivery, { status: 'demo', sentAt: new Date().toISOString() });
      queue.shift(); save(); publish();
    }
  }
  function action(route, body) {
    const round = state.round;
    if (route === 'demo') startDemo();
    else if (route === 'demo/payouts/refresh') checkedAt = new Date().toISOString();
    else if (route === 'winner-message') {
      if (body.channel !== '__demo__') throw new Error('This public demo only supports its sample channel.');
      state.template = engine.winnerMessageTemplate(body.template);
    } else if (route === 'luck') {
      if (body.roundId !== round.id || !['ready', 'open', 'closed'].includes(round.status)) throw new Error('The giveaway changed. Start a new giveaway to adjust luck.');
      const boost = Number(body.boost);
      if (!Number.isInteger(boost) || boost < 0 || boost > 50) throw new Error('First-win luck must be 0–50%.'); round.boost = boost;
    } else if (route === 'settings') {
      if (round.status !== 'ready') throw new Error('Create a new giveaway before changing its rules.');
      const boost = Number(body.boost), cooldownMinutes = Number(body.cooldownMinutes), keyword = String(body.keyword || '').trim();
      const mode = body.mode || 'keyword', level = body.level || 'everyone', activeMinutes = Number(body.activeMinutes || 5);
      if (!Number.isInteger(boost) || boost < 0 || boost > 50 || !Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43200) throw new Error('Invalid luck cap or cooldown.');
      if (!/^\S{1,30}$/.test(keyword) || engine.matchesKeyword(keyword, '!luck')) throw new Error('Choose a keyword without spaces; !luck is reserved.');
      if (!['keyword', 'active'].includes(mode) || !['everyone', 'subscriber', 'moderator', 'owner', 'regular'].includes(level) || !Number.isInteger(activeMinutes) || activeMinutes < 1 || activeMinutes > 60) throw new Error('Invalid giveaway eligibility settings.');
      Object.assign(round, { title: String(body.title || 'Community giveaway').trim().slice(0, 100), keyword, boost, cooldownMinutes, mode, level, activeMinutes });
    } else if (route === 'open') {
      if (!['ready', 'closed'].includes(round.status)) throw new Error('Start a new giveaway first.');
      round.status = 'open'; delete round.closedAt; if (!round.entrants.length) sampleEntrants();
    } else if (route === 'close') {
      if (round.status !== 'open') throw new Error('Entries are not open.'); round.status = 'closed'; round.closedAt = new Date().toISOString();
    } else if (route === 'draw' || route === 'reroll') {
      if (body.roundId !== round.id) throw new Error('The giveaway changed. Review the current pool.');
      if (route === 'reroll' && (!round.winner || body.winnerId !== round.winner.id)) throw new Error('The selected winner changed.');
      const template = engine.winnerMessageTemplate(body.winnerMessageTemplate === undefined ? state.template : body.winnerMessageTemplate);
      const previous = round.winner;
      const winner = route === 'reroll' ? engine.reroll(round, state.history, undefined, paid.readDemoPaidWinners()) : engine.draw(round, state.history, undefined, body.boost === undefined ? round.boost : Number(body.boost), paid.readDemoPaidWinners());
      if (route === 'reroll' && previous?.announcement?.status === 'pending') Object.assign(previous.announcement, { status: 'not-sent', reason: 'Rerolled before the demo message was posted.' });
      state.template = template; winner.announcement = { status: 'pending', message: engine.winnerAnnouncement(winner, template) };
      queue.push(winner); if (!announcementTimer) announcementTimer = setTimeout(drain, 0);
    } else if (route === 'new') {
      if (round.status === 'open') throw new Error('Close entries before starting a new giveaway.');
      const { title, keyword, boost, cooldownMinutes, mode, activeMinutes, level } = round;
      state.round = { ...engine.newRound(), title, keyword, boost, cooldownMinutes, mode, activeMinutes, level };
    } else if (route === 'remove' || route === 'reset-eligibility') {
      if (!['open', 'closed'].includes(round.status)) throw new Error('Change eligibility before drawing.');
      if (route === 'reset-eligibility') round.entrants.forEach(e => e.excluded = true);
      else { const entry = round.entrants.find(e => e.login === body.login); if (entry) entry.excluded = !entry.excluded; }
    } else throw new Error('This public sandbox does not connect to Twitch or accept credentials.');
    save(); publish(); return snapshot();
  }
  window.demoApi = {
    async fetch(url, options = {}) {
      try {
        const route = String(url).replace(/^\/api\//, '');
        if (options.method === 'POST') return new Response(JSON.stringify(action(route, JSON.parse(options.body || '{}'))), { status: 200 });
        if (route === 'state') return new Response(JSON.stringify(snapshot()), { status: 200 });
        if (route === 'demo/paid-winners') return new Response(JSON.stringify(paid.demoPaidWinnersResponse()), { status: 200 });
        throw new Error('Unsupported public demo action.');
      } catch (error) { return new Response(JSON.stringify({ error: error.message }), { status: 400 }); }
    },
    EventSource: class {
      constructor() { listeners.add(this); queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(snapshot()) })); }
      close() { listeners.delete(this); }
    },
  };
  save();
  setInterval(() => { checkedAt = new Date().toISOString(); publish(); }, 30000);
  setInterval(() => { if (state.round.mode === 'active' || state.round.cooldownMinutes) publish(); }, 20000);
})();
