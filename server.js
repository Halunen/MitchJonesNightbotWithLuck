const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomInt } = require('node:crypto');
const { demoPaidWinnersResponse, readDemoPaidWinners } = require('./paid-winners');
const { WebSocket } = require('ws');
const { normalize, validLogin, newRound, pool, enter, draw, parseChat, permitted, matchesKeyword, winnerAnnouncement, chatText, trackEntry, luckReply } = require('./engine');
const port = Number(process.env.PORT || 38741);
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const statePath = path.join(dataDir, 'state.json');
let state = { channel: '', histories: {}, round: newRound() };
if (fs.existsSync(statePath)) {
  try { state = JSON.parse(fs.readFileSync(statePath, 'utf8')); }
  catch { throw new Error('Saved state could not be read. Restore data/state.json from a backup before starting.'); }
}
// Never silently keep collecting after a server restart.
if (state.round.status === 'open') { state.round.status = 'closed'; state.round.closedAt = new Date().toISOString(); }
state.round = { mode: 'keyword', activeMinutes: 5, level: 'everyone', ...state.round };
// A draw-count setting has no direct time equivalent. Previously enabled
// cooldowns become 24 hours; disabled cooldowns stay disabled.
if (state.round.cooldownMinutes === undefined) state.round.cooldownMinutes = state.round.cooldown > 0 ? 1440 : 0;
delete state.round.cooldown;
state.participations ||= {};
const participation = () => state.participations[state.channel] ||= {};
// Older versions did not record participation. Count the saved pool once,
// without inventing participation in giveaways we never tracked.
for (const entrant of state.round.entrants) if (!entrant.luckEntries) trackEntry(state.round, entrant, participation());
let connection = { status: 'offline', message: 'Connect your Twitch channel to get started.' };
let socket, reconnectTimer, attempts = 0, credentials = null, buffer = '', stopped = false;
const clients = new Set();
const chat = [];
let persistTimer, publishTimer;
const history = () => state.histories[state.channel] ||= [];
let paidWinnerCache = { checkedAt: null, records: [] };
function refreshDemoPayouts() { paidWinnerCache = { checkedAt: new Date().toISOString(), records: readDemoPaidWinners() }; }
const paidWinners = () => state.channel === '__demo__' ? paidWinnerCache.records : [];
if (state.channel === '__demo__') refreshDemoPayouts();
let lastSent = 0;
function sendChat(message) {
  const text = chatText(message), demo = state.channel === '__demo__';
  if (Date.now() - lastSent < 1700) return false;
  if (!demo && (connection.status !== 'connected' || !credentials?.writeEnabled || !credentials?.scopes?.includes('chat:edit') || socket?.readyState !== WebSocket.OPEN)) return false;
  if (!demo) socket.send(`PRIVMSG #${state.channel} :${text}\r\n`);
  chat.push({ login: demo ? 'mitchlucky' : credentials.login, displayName: demo ? 'MitchLucky (demo)' : credentials.login, text, outgoing: true });
  if (chat.length > 40) chat.shift();
  lastSent = Date.now(); return true;
}
function save() {
  clearTimeout(persistTimer); persistTimer = null;
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(statePath + '.tmp', statePath);
}
function snapshot() {
  const entrants = pool(state.round, history().filter(h => h.roundId !== state.round.id), state.round.winner ? Date.parse(state.round.winner.at) : Date.now(), paidWinners());
  const total = entrants.reduce((sum, e) => sum + e.weight, 0);
  const selectedWinner = state.round.winner ? paidWinners().find(w => w.login === state.round.winner.login) || null : null;
  return { channel: state.channel, demo: state.channel === '__demo__', payouts: { source: state.channel === '__demo__' ? 'demo' : 'not-connected', checkedAt: state.channel === '__demo__' ? paidWinnerCache.checkedAt : null, refreshSeconds: 30, selectedWinner }, serverNow: new Date().toISOString(), round: { ...state.round, entrants: entrants.map(({ paidWinner, ...e }) => ({ ...e, odds: total ? e.weight / total : 0 })) }, history: history(), connection, chat, canRead: connection.status === 'connected', canSend: state.channel === '__demo__' || (connection.status === 'connected' && Boolean(credentials?.writeEnabled && credentials?.scopes?.includes('chat:edit'))) };
}
function publish() { const msg = `data: ${JSON.stringify(snapshot())}\n\n`; for (const client of clients) client.write(msg); }
function publishSoon() { if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = null; publish(); }, 200); }
function saveSoon() { if (!persistTimer) persistTimer = setTimeout(save, 250); }
function status(value, message) { connection = { status: value, message }; publish(); }
function disconnect() {
  stopped = true; credentials = null; clearTimeout(reconnectTimer);
  if (socket) { socket.removeAllListeners(); socket.on('error', () => {}); socket.terminate(); socket = null; }
  if (state.round.status === 'open') { state.round.status = 'closed'; state.round.closedAt = new Date().toISOString(); }
  save(); status('offline', 'Disconnected. Entry collection is paused.');
}
function connect() {
  stopped = false; buffer = ''; status('connecting', attempts ? 'Reconnecting to Twitch…' : 'Connecting to Twitch…');
  const ws = socket = new WebSocket('wss://irc-ws.chat.twitch.tv:443', { handshakeTimeout: 15000 });
  ws.on('open', () => {
    ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    if (credentials) ws.send(`PASS oauth:${credentials.token}\r\nNICK ${credentials.login}\r\n`);
    else ws.send(`PASS SCHMOOPIIE\r\nNICK justinfan${Math.floor(Math.random() * 999999)}\r\n`);
    ws.send(`JOIN #${state.channel}\r\n`);
  });
  ws.on('message', data => {
    buffer += data.toString();
    const lines = buffer.split('\r\n'); buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('PING ')) { ws.send(line.replace('PING', 'PONG') + '\r\n'); continue; }
      if (line.includes('Login authentication failed') || line.includes('Improperly formatted auth')) {
        stopped = true; credentials = null; status('error', 'Twitch rejected the token. Check your credentials.'); ws.close(); continue;
      }
      if (/ (?:366|ROOMSTATE) /.test(line)) { attempts = 0; status('connected', `Listening to #${state.channel}`); }
      if (line.includes(' RECONNECT')) ws.close();
      const message = parseChat(line);
      if (!message || message.channel !== state.channel) continue;
      if (credentials && message.login === credentials.login) continue;
      message.mod = /(?:^|;)mod=1(?:;| )/.test(line);
      message.broadcaster = /badges=[^ ]*broadcaster\/1/.test(line) || message.login === state.channel;
      message.subscriber = /(?:^|;)subscriber=1(?:;| )/.test(line);
      message.messageId = line.match(/(?:^@|;)id=([^; ]+)/)?.[1];
      const asksLuck = matchesKeyword(message.text, '!luck');
      if (asksLuck && connection.status === 'connected' && credentials?.writeEnabled && Date.now() - lastSent >= 1700) sendChat(luckReply(state.round, history(), participation(), message, paidWinners()));
      const qualifies = !asksLuck && permitted(state.round.level, message, state.bots?.[state.channel]?.regulars || []) && (state.round.mode === 'active' || matchesKeyword(message.text, state.round.keyword));
      const accepted = qualifies && enter(state.round, message.login, message.displayName, message.userId, participation());
      if (qualifies && state.round.status === 'open') {
        const entrant = state.round.entrants.find(e => e.login === message.login || (message.userId && e.userId === message.userId));
        if (entrant) entrant.lastActiveAt = new Date().toISOString();
      }
      chat.push({ ...message, entered: Boolean(accepted) }); if (chat.length > 40) chat.shift();
      if (qualifies && state.round.status === 'open') saveSoon(); publishSoon();
    }
  });
  ws.on('error', () => status('error', 'Twitch connection interrupted. Retrying…'));
  ws.on('close', () => {
    if (stopped) return;
    if (!credentials && attempts >= 3) { stopped = true; status('error', 'Anonymous Twitch connection failed. Open Connect Twitch and supply a user OAuth token with chat:read (and chat:edit for replies).'); return; }
    status('reconnecting', credentials ? 'Connection lost. Entries are only collected while connected.' : 'Anonymous Twitch connection interrupted. Retrying; an authenticated token may be needed.');
    reconnectTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
  });
}
async function action(route, body) {
  const round = state.round;
  if (route === 'connect') {
    const channel = normalize(body.channel);
    if (!validLogin(channel)) throw new Error('Enter a valid Twitch channel name.');
    if (body.writeEnabled && !body.token) throw new Error('Read + Write Chat requires a Twitch user token with chat:read and chat:edit.');
    let auth = null;
    if (body.token) {
      const token = String(body.token).replace(/^oauth:/, '');
      const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('That Twitch token is invalid or expired.');
      const info = await response.json();
      if (!info.scopes?.includes('chat:read')) throw new Error('The token needs the chat:read permission.');
      if (body.writeEnabled && !info.scopes?.includes('chat:edit')) throw new Error('Writing to chat requires the chat:edit permission. Choose Read Chat Only or use a token with both permissions.');
      const users = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': info.client_id }, signal: AbortSignal.timeout(10000) });
      if (!users.ok) throw new Error('Unable to look up this Twitch channel.');
      const broadcaster = (await users.json()).data?.[0];
      if (!broadcaster) throw new Error('That Twitch channel does not exist.');
      auth = { login: info.login, token, scopes: info.scopes, userId: info.user_id, clientId: info.client_id, broadcasterId: broadcaster.id, writeEnabled: Boolean(body.writeEnabled) };
    }
    disconnect();
    if (state.channel !== channel) { state.channel = channel; state.round = newRound(); chat.length = 0; }
    attempts = 0; credentials = auth; connect();
  } else if (route === 'disconnect') disconnect();
  else if (route === 'announce') {
    if (!round.winner) throw new Error('Draw a winner first.');
    if (!sendChat(winnerAnnouncement(round.winner))) throw new Error('Choose Read + Write Chat with a chat:edit token to send. Wait a moment between messages.');
  } else if (route === 'chat/send') {
    const text = chatText(body.message);
    if (!sendChat(text)) throw new Error('Choose Read + Write Chat with a chat:edit token to send. Wait a moment between messages.');
  }
  else if (route === 'demo') {
    disconnect(); state.channel = '__demo__'; state.round = newRound(); chat.length = 0;
    refreshDemoPayouts();
    state.round.status = 'open';
    const wowCharacters = ['Thrall', 'Jaina', 'Arthas', 'Sylvanas', 'Illidan', 'Anduin', 'Tyrande', 'Malfurion', 'Garrosh', 'Voljin', 'Guldan', 'Khadgar', 'Alexstrasza', 'Chromie', 'Velen', 'Baine'];
    // Fisher–Yates gives each demo a fresh mix of WoW characters.
    for (let i = wowCharacters.length - 1; i > 0; i--) { const j = randomInt(i + 1); [wowCharacters[i], wowCharacters[j]] = [wowCharacters[j], wowCharacters[i]]; }
    for (const name of ['CDEW', 'AndyM', 'CUDA', 'GJake', ...wowCharacters.slice(0, 8)]) enter(state.round, name, name, null, participation());
    if (!history().length) history().push({ id: 'demo-seed', login: 'cdew', displayName: 'CDEW', roundId: 'demo-previous-round', firstWin: true, at: new Date().toISOString(), title: 'Sample previous giveaway' });
    const demoSeed = history().find(h => h.id === 'demo-seed');
    if (demoSeed) Object.assign(demoSeed, { login: 'cdew', displayName: 'CDEW' });
    status('demo', 'Sandbox • no Twitch messages are sent.');
  } else if (route === 'demo/payouts/refresh') {
    if (state.channel !== '__demo__') throw new Error('Sample payout records are only available in the demo sandbox.');
    refreshDemoPayouts();
  } else if (route === 'luck') {
    if (body.roundId !== round.id) throw new Error('The giveaway changed. Adjust the slider again.');
    if (!['ready', 'open', 'closed'].includes(round.status)) throw new Error('Start a new giveaway to change luck after a winner has been drawn.');
    const boost = Number(body.boost);
    if (!Number.isInteger(boost) || boost < 0 || boost > 50) throw new Error('First-win luck must be 0–50%.');
    round.boost = boost;
  } else if (route === 'settings') {
    if (round.status !== 'ready') throw new Error('Create a new giveaway before changing its rules.');
    const boost = Number(body.boost), cooldownMinutes = Number(body.cooldownMinutes);
    if (!Number.isInteger(boost) || boost < 0 || boost > 50 || !Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43200) throw new Error('Boost must be 0–50%; winner cooldown must be 0–43,200 minutes (30 days).');
    const keyword = String(body.keyword || '').trim();
    if (!/^\S{1,30}$/.test(keyword)) throw new Error('Use a keyword without spaces (up to 30 characters).');
    if (matchesKeyword(keyword, '!luck')) throw new Error('!luck is reserved for checking viewer luck. Choose another entry keyword.');
    const mode = body.mode || 'keyword', activeMinutes = Number(body.activeMinutes || 5), level = body.level || 'everyone';
    if (!['keyword', 'active'].includes(mode) || !Number.isInteger(activeMinutes) || activeMinutes < 1 || activeMinutes > 60 || !['everyone', 'subscriber', 'regular', 'moderator', 'owner'].includes(level)) throw new Error('Invalid giveaway type, activity window, or eligibility level.');
    Object.assign(round, { title: String(body.title || 'Community giveaway').trim().slice(0, 100), keyword, boost, cooldownMinutes, mode, activeMinutes, level });
  } else if (route === 'open') {
    if (!['ready', 'closed'].includes(round.status)) throw new Error('Create a new giveaway first.');
    if (state.channel !== '__demo__' && connection.status !== 'connected') throw new Error('Connect to Twitch before opening entries.');
    round.status = 'open';
    delete round.closedAt;
  } else if (route === 'close') {
    if (round.status !== 'open') throw new Error('Entries are not open.'); round.status = 'closed'; round.closedAt = new Date().toISOString();
  } else if (route === 'draw') {
    if (body.roundId && body.roundId !== round.id) throw new Error('The giveaway changed. Review the current entry pool before rolling.');
    draw(round, history(), undefined, body.boost === undefined ? round.boost : Number(body.boost), paidWinners());
  }
  else if (route === 'new') {
    if (round.status === 'open') throw new Error('Close entries before starting a new giveaway.');
    state.round = { ...newRound(), title: round.title, keyword: round.keyword, boost: round.boost, cooldownMinutes: round.cooldownMinutes, mode: round.mode, activeMinutes: round.activeMinutes, level: round.level };
  } else if (route === 'remove') {
    if (!['open', 'closed'].includes(round.status)) throw new Error('Entrants can only be removed before drawing.');
    const entrant = round.entrants.find(e => e.login === body.login); if (entrant) entrant.excluded = !entrant.excluded;
  } else if (route === 'reset-eligibility') {
    if (!['open', 'closed'].includes(round.status)) throw new Error('Reset eligibility before drawing.');
    round.entrants.forEach(e => e.excluded = true);
  } else throw new Error('Unknown action.');
  save(); publish(); return snapshot();
}
let busy = false;
const server = http.createServer(async (req, res) => {
  const host = req.headers.host;
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) { res.writeHead(403).end(); return; }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
  const pathname = new URL(req.url, `http://${host}`).pathname;
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res); res.write(`data: ${JSON.stringify(snapshot())}\n\n`); req.on('close', () => clients.delete(res)); return;
  }
  if (req.method === 'GET' && pathname === '/api/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(snapshot())); return; }
  if (req.method === 'GET' && pathname === '/api/demo/paid-winners' && state.channel === '__demo__') {
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(demoPaidWinnersResponse())); return;
  }
  if (req.method === 'POST' && pathname.startsWith('/api/')) {
    if (req.headers.origin !== `http://${host}` || req.headers['content-type'] !== 'application/json') { res.writeHead(403).end(); return; }
    if (busy) { res.writeHead(409).end(JSON.stringify({ error: 'Another action is in progress. Try again.' })); return; }
    busy = true; res.setHeader('Content-Type', 'application/json');
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 300000) throw new Error('Request too large.'); }
      res.end(JSON.stringify(await action(pathname.slice(5), JSON.parse(raw || '{}'))));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ error: error.message })); }
    finally { busy = false; } return;
  }
  const files = { '/': 'index.html', '/app.js': 'app.js', '/giveaway-ui.js': 'giveaway-ui.js', '/style.css': 'style.css', '/theme.css': 'theme.css', '/giveaway.css': 'giveaway.css', '/mitch-logo.png': 'mitch-logo.png' };
  if (req.method !== 'GET' || !files[pathname]) { res.writeHead(404).end('Not found'); return; }
  res.setHeader('Content-Type', pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(path.join(__dirname, 'public', files[pathname])));
});
const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); if ((state.round.mode === 'active' && state.round.status === 'open') || (state.round.cooldownMinutes > 0 && ['open', 'closed'].includes(state.round.status))) publish(); }, 20000);
const payoutRefresh = setInterval(() => { if (state.channel === '__demo__') { refreshDemoPayouts(); publish(); } }, 30000);
server.listen(port, '127.0.0.1', () => console.log(`MitchLucky is ready at http://127.0.0.1:${port}`));
process.on('SIGINT', () => { disconnect(); clearInterval(heartbeat); clearInterval(payoutRefresh); server.close(); process.exit(); });
