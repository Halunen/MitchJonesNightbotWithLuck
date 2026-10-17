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
function newRound() { return { id: randomUUID(), title: 'Community giveaway', keyword: 'yo', mode: 'keyword', activeMinutes: 5, level: 'everyone', boost: 25, cooldownMinutes: 0, status: 'ready', entrants: [], winner: null }; }
function matchesKeyword(text, keyword) { return String(text).trim().toLowerCase() === String(keyword).trim().toLowerCase(); }
const DEFAULT_WINNER_MESSAGE = 'Congratulations {winner}! You Won. You have 60 seconds to respond.';
function winnerMessageTemplate(value) {
  const template = chatText(value);
  if (template.length > 425) throw new Error('Winner messages must be 1–425 characters. Use {winner} to mention the winner.');
  if (template.replaceAll('{winner}', '@' + 'a'.repeat(25)).length > 450) throw new Error('Too many {winner} placeholders: the final message must fit within 450 characters.');
  return template;
}
function winnerAnnouncement(winner, template) {
  if (template === undefined) return `Congratulations${winner ? ` @${winner.login}` : ''}! You won.`;
  return chatText(winnerMessageTemplate(template).replaceAll('{winner}', `@${winner.login}`));
}
function chatText(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 450 || /[\r\n\x00]/.test(value)) throw new Error('Enter a single-line message of 1–450 characters.');
  return value.trim();
}
const LUCK_STEP = 5;
function luckBonus(entries, cap) { return Math.min(cap, Math.max(1, entries || 1) * LUCK_STEP); }
// Each channel owns a ledger. Twitch IDs remain stable across name changes.
function trackEntry(round, entrant, ledger) {
  const idKey = entrant.userId ? `id:${entrant.userId}` : null, loginKey = `login:${entrant.login}`;
  let record = (idKey && ledger[idKey]) || ledger[loginKey];
  if (!record || (entrant.userId && record.userId && record.userId !== entrant.userId)) record = { count: 0 };
  if (record.lastRoundId !== round.id) { record.count++; record.lastRoundId = round.id; }
  if (entrant.userId) { record.userId = entrant.userId; ledger[idKey] = record; }
  ledger[loginKey] = record;
  entrant.luckEntries = record.count;
}
function luckReply(round, history, ledger, message, paidWinners = []) {
  const entrant = round.entrants.find(e => message.userId ? e.userId === message.userId || (!e.userId && e.login === message.login) : e.login === message.login);
  const record = (message.userId && ledger[`id:${message.userId}`]) || ledger[`login:${message.login}`];
  const entry = entrant || { ...message, luckEntries: record?.count || 0 };
  const view = pool({ ...round, entrants: [entry] }, history, Date.now(), paidWinners)[0];
  if (view.wins) return `@${message.login} You have a recorded win, so your draw weight is 1.00x. Never-winners earn +5% weight per giveaway entered, capped at +${round.boost}%.`;
  if (!entrant || !['open', 'closed'].includes(round.status)) {
    const count = record?.count || entrant?.luckEntries || 0, bonus = count ? luckBonus(count, round.boost) : 0;
    return `@${message.login} You are not entered in an available draw. ${count} giveaway(s) entered with no recorded wins: +${bonus}% saved draw weight (cap +${round.boost}%). Enter the next giveaway for another +5%, up to the cap. Repeating the keyword adds nothing.`;
  }
  const candidates = pool(round, history, Date.now(), paidWinners), total = candidates.reduce((sum, e) => sum + e.weight, 0);
  return `@${message.login} ${view.luckEntries || 1} giveaway(s) entered with no recorded wins: +${view.bonus}% draw weight (${(1 + view.bonus / 100).toFixed(2)}x; cap +${round.boost}%). Current chance: ${total ? (view.weight / total * 100).toFixed(4) : '0.0000'}%. Once per giveaway; repeating the keyword adds nothing.`;
}
function pool(round, history, now = Date.now(), paidWinners = []) {
  history = history.filter(h => !h.rerolled);
  const previousNames = new Set((round.previousSelections || []).map(w => w.login));
  const previousIds = new Set((round.previousSelections || []).map(w => w.userId).filter(Boolean));
  const paidByLogin = new Map(paidWinners.map(w => [w.login, w]));
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
    const paidWinner = paidByLogin.get(e.login) || null;
    const localWins = (winsByLogin.get(e.login) || 0) + (e.userId ? (winsById.get(e.userId) || 0) - (winsByPair.get(`${e.login}:${e.userId}`) || 0) : 0);
    // Sources may describe the same wins. Do not add overlapping counts.
    const wins = Math.max(localWins, paidWinner?.winCount || 0);
    const coolingDown = round.cooldownMinutes > 0 && (recent.has(e.login) || (e.userId && recentIds.has(e.userId)));
    const inactive = round.mode === 'active' && Date.parse(e.lastActiveAt || e.joinedAt) < (round.closedAt ? Date.parse(round.closedAt) : now) - round.activeMinutes * 60000;
    const previouslySelected = previousNames.has(e.login) || (e.userId && previousIds.has(e.userId));
    const blocked = Boolean(e.excluded || previouslySelected || coolingDown || inactive);
    const bonus = wins ? 0 : luckBonus(e.luckEntries, round.boost);
    return { ...e, wins, paidWinner, bonus, blocked, reason: e.excluded ? 'Excluded' : previouslySelected ? 'Previously selected' : coolingDown ? 'Cooldown' : inactive ? 'Inactive' : '', weight: blocked ? 0 : 100 + bonus };
  });
}
function enter(round, login, displayName = login, userId = null, ledger = null) {
  login = normalize(login);
  if (round.status !== 'open' || !validLogin(login) || round.entrants.some(e => e.login === login || (userId && e.userId === userId))) return false;
  const entrant = { login, displayName: String(displayName).slice(0, 40), userId, joinedAt: new Date().toISOString(), luckEntries: 1 };
  if (ledger) trackEntry(round, entrant, ledger);
  round.entrants.push(entrant);
  return true;
}
function draw(round, history, rng = randomInt, boost = round.boost, paidWinners = []) {
  if (!['open', 'closed'].includes(round.status)) throw new Error('Open entries or start a new giveaway before rolling.');
  if (!Number.isInteger(boost) || boost < 0 || boost > 50) throw new Error('First-win luck must be 0–50%.');
  const now = Date.now();
  const candidates = pool({ ...round, boost, closedAt: round.status === 'open' ? undefined : round.closedAt }, history, now, paidWinners);
  const total = candidates.reduce((sum, e) => sum + e.weight, 0);
  if (!total) throw new Error('No eligible entrants. Check the winner cooldown.');
  let ticket = rng(total);
  const selected = candidates.find(e => (ticket -= e.weight) < 0);
  const winner = { id: randomUUID(), roundId: round.id, title: round.title, login: selected.login, displayName: selected.displayName, userId: selected.userId, firstWin: selected.wins === 0, at: new Date(now).toISOString(), odds: selected.weight / total, boost, cooldownMinutes: round.cooldownMinutes, eligible: candidates.filter(e => e.weight).length };
  history.push(winner);
  if (round.status === 'open') round.closedAt = winner.at;
  round.boost = boost;
  round.winner = winner;
  round.status = 'drawn';
  return winner;
}
function reroll(round, history, rng = randomInt, paidWinners = []) {
  if (round.status !== 'drawn' || !round.winner) throw new Error('Select a winner before rerolling.');
  const previous = round.winner;
  const next = { ...round, status: 'closed', winner: null, previousSelections: [...(round.previousSelections || []), { login: previous.login, userId: previous.userId }] };
  // Work on a copy so an exhausted pool leaves the current winner intact.
  const activeHistory = history.filter(h => !h.rerolled && h.id !== previous.id);
  const winner = draw(next, activeHistory, rng, round.boost, paidWinners);
  previous.rerolled = true;
  const record = history.find(h => h.id === previous.id);
  if (record) record.rerolled = true;
  history.push(winner);
  Object.assign(round, next);
  return winner;
}
function parseChat(line) {
  const match = line.match(/^(?:@([^ ]+) )?:([^! ]+)!\S+ PRIVMSG #([^ ]+) :([\s\S]*)$/);
  if (!match) return null;
  const tags = Object.fromEntries((match[1] || '').split(';').map(t => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
  return { login: normalize(match[2]), channel: normalize(match[3]), text: match[4], userId: tags['user-id'] || null, displayName: tags['display-name'] || match[2] };
}
module.exports = { normalize, validLogin, newRound, pool, enter, draw, reroll, parseChat, permitted, matchesKeyword, winnerAnnouncement, winnerMessageTemplate, DEFAULT_WINNER_MESSAGE, chatText, trackEntry, luckBonus, luckReply };
