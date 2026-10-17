const { randomInt, randomUUID } = require('node:crypto');
const normalize = value => String(value || '').trim().replace(/^[@#]/, '').toLowerCase();
function validLogin(value) { return /^[a-z0-9_]{1,25}$/.test(value); }
function permitted(level, message, legacyRegulars = []) {
  if (message.broadcaster) return true;
  if (level === 'owner') return false;
  if (message.mod) return true;
  if (level === 'moderator') return false;
  if (level === 'subscriber') return Boolean(message.subscriber);
  if (level === 'regular') return legacyRegulars.includes(message.login);
  return true;
}
function newRound() { return { id: randomUUID(), title: 'Community giveaway', keyword: '!luck', mode: 'keyword', activeMinutes: 5, level: 'everyone', boost: 25, cooldownMinutes: 0, status: 'ready', entrants: [], winner: null }; }
function pool(round, history, now = Date.now()) {
  const cutoff = now - round.cooldownMinutes * 60000;
  const recentDraws = round.cooldownMinutes > 0 ? history.filter(h => !h.imported && Date.parse(h.at) > cutoff && Date.parse(h.at) <= now) : [];
  const recent = new Set(recentDraws.map(h => h.login));
  const recentIds = new Set(recentDraws.map(h => h.userId).filter(Boolean));
  const winsByLogin = new Map(), winsById = new Map(), winsByPair = new Map();
  for (const h of history) {
    winsByLogin.set(h.login, (winsByLogin.get(h.login) || 0) + 1);
    if (h.userId) {
      winsById.set(h.userId, (winsById.get(h.userId) || 0) + 1);
      const pair = `${h.login}:${h.userId}`; winsByPair.set(pair, (winsByPair.get(pair) || 0) + 1);
    }
  }
  return round.entrants.map(e => {
    const wins = (winsByLogin.get(e.login) || 0) + (e.userId ? (winsById.get(e.userId) || 0) - (winsByPair.get(`${e.login}:${e.userId}`) || 0) : 0);
    const coolingDown = round.cooldownMinutes > 0 && (recent.has(e.login) || (e.userId && recentIds.has(e.userId)));
    const inactive = round.mode === 'active' && Date.parse(e.lastActiveAt || e.joinedAt) < (round.closedAt ? Date.parse(round.closedAt) : now) - round.activeMinutes * 60000;
    const blocked = Boolean(e.excluded || coolingDown || inactive);
    return { ...e, wins, blocked, reason: e.excluded ? 'Excluded' : coolingDown ? 'Cooldown' : inactive ? 'Inactive' : '', weight: blocked ? 0 : wins ? 100 : 100 + round.boost };
  });
}
function enter(round, login, displayName = login, userId = null) {
  login = normalize(login);
  if (round.status !== 'open' || !validLogin(login) || round.entrants.some(e => e.login === login || (userId && e.userId === userId))) return false;
  round.entrants.push({ login, displayName: String(displayName).slice(0, 40), userId, joinedAt: new Date().toISOString() });
  return true;
}
function draw(round, history, rng = randomInt) {
  if (round.status !== 'closed') throw new Error('Close entries before drawing.');
  const now = Date.now();
  const candidates = pool(round, history, now);
  const total = candidates.reduce((sum, e) => sum + e.weight, 0);
  if (!total) throw new Error('No eligible entrants. Check the winner cooldown.');
  let ticket = rng(total);
  const selected = candidates.find(e => (ticket -= e.weight) < 0);
  const winner = { id: randomUUID(), roundId: round.id, title: round.title, login: selected.login, displayName: selected.displayName, userId: selected.userId, firstWin: selected.wins === 0, at: new Date(now).toISOString(), odds: selected.weight / total, boost: round.boost, cooldownMinutes: round.cooldownMinutes, eligible: candidates.filter(e => e.weight).length };
  history.push(winner);
  round.winner = winner;
  round.status = 'drawn';
  return winner;
}
function parseChat(line) {
  const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)!\S+ PRIVMSG #([^ ]+) :([\s\S]*)$/);
  if (!match) return null;
  const tags = Object.fromEntries((match[1] || '').split(';').map(t => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
  return { login: normalize(match[2]), channel: normalize(match[3]), text: match[4], userId: tags['user-id'] || null, displayName: tags['display-name'] || match[2] };
}
module.exports = { normalize, validLogin, newRound, pool, enter, draw, parseChat, permitted };
