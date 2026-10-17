const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { normalize, validLogin, newRound, pool, enter, draw, parseChat } = require('./engine');
const { defaults, violation, variables, permitted, validateItem } = require('./bot');
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
let connection = { status: 'offline', message: 'Connect your Twitch channel to get started.' };
let socket, reconnectTimer, attempts = 0, credentials = null, buffer = '', stopped = false;
const clients = new Set();
const chat = [];
let persistTimer, publishTimer;
const history = () => state.histories[state.channel] ||= [];
const botConfig = () => { state.bots ||= {}; return state.bots[state.channel] ||= defaults(); };
const commandTimes = new Map(), timerTimes = new Map();
let chatTimes = [], lastSent = 0, connectionEpoch = Date.now();
function logBot(type, message) {
  const config = botConfig(); config.logs.push({ at: new Date().toISOString(), type, message });
  if (config.logs.length > 200) config.logs.shift(); save(); publish();
}
function sendChat(message) {
  if (connection.status !== 'connected' || !credentials?.scopes?.includes('chat:edit') || socket?.readyState !== WebSocket.OPEN || Date.now() - lastSent < 1700) return false;
  const text = String(message).replace(/[\r\n]/g, ' ').slice(0, 450);
  if (!text) return false;
  socket.send(`PRIVMSG #${state.channel} :${text}\r\n`); lastSent = Date.now(); return true;
}
async function moderate(message, reason) {
  if (!credentials?.scopes?.includes('moderator:manage:chat_messages') || !message.messageId) { logBot('filter', `${reason} detected from ${message.login}; not deleted (moderation permission required).`); return; }
  const auth = credentials;
  try {
    const response = await fetch(`https://api.twitch.tv/helix/moderation/chat?broadcaster_id=${auth.broadcasterId}&moderator_id=${auth.userId}&message_id=${encodeURIComponent(message.messageId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}`, 'Client-Id': auth.clientId }, signal: AbortSignal.timeout(10000) });
    logBot(response.ok ? 'moderation' : 'error', `${reason}: ${message.login} — ${response.ok ? 'message deleted' : `Twitch rejected deletion (${response.status}). Bot must be a moderator.`}`);
  } catch { logBot('error', 'Unable to reach Twitch moderation API.'); }
}
function processBot(message) {
  const config = botConfig();
  const reason = violation(message, config);
  if (reason) { void moderate(message, reason); return false; }
  const [name, ...args] = message.text.trim().split(/\s+/);
  if (name.toLowerCase() === '!commands' && Date.now() - (commandTimes.get('!commands') || 0) >= 10000) {
    if (sendChat(`Commands: ${config.commands.filter(c => c.enabled).map(c => c.name).join(', ') || 'No custom commands yet.'}`)) commandTimes.set('!commands', Date.now());
  }
  const command = config.commands.find(c => c.enabled && c.name === name.toLowerCase());
  if (command && permitted(command.level, message, config) && Date.now() - (commandTimes.get(command.id) || 0) >= command.cooldown * 1000) {
    const context = { user: message.displayName, channel: state.channel, query: args.join(' '), touser: args[0] || message.displayName, count: command.count + 1 };
    if (sendChat(variables(command.message, context))) { command.count++; commandTimes.set(command.id, Date.now()); logBot('command', `${command.name} used by ${message.login}`); }
  }
  return true;
}
function save() {
  clearTimeout(persistTimer); persistTimer = null;
  fs.writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2));
  fs.renameSync(statePath + '.tmp', statePath);
}
function snapshot() {
  const entrants = pool(state.round, history().filter(h => h.roundId !== state.round.id), state.round.winner ? Date.parse(state.round.winner.at) : Date.now());
  const total = entrants.reduce((sum, e) => sum + e.weight, 0);
  return { channel: state.channel, demo: state.channel === '__demo__', round: { ...state.round, entrants: entrants.map(e => ({ ...e, odds: total ? e.weight / total : 0 })) }, history: history(), connection, chat, bot: botConfig(), canSend: connection.status === 'connected' && Boolean(credentials?.scopes?.includes('chat:edit')) };
}
function publish() { const msg = `data: ${JSON.stringify(snapshot())}\n\n`; for (const client of clients) client.write(msg); }
function publishSoon() { if (!publishTimer) publishTimer = setTimeout(() => { publishTimer = null; publish(); }, 200); }
function saveSoon() { if (!persistTimer) persistTimer = setTimeout(save, 250); }
function status(value, message) { connection = { status: value, message }; publish(); }
function disconnect() {
  stopped = true; credentials = null; clearTimeout(reconnectTimer); commandTimes.clear(); timerTimes.clear(); chatTimes = []; connectionEpoch = Date.now();
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
      chatTimes.push(Date.now()); chatTimes = chatTimes.filter(t => t > Date.now() - 300000);
      const allowed = processBot(message);
      const qualifies = allowed && permitted(state.round.level, message, botConfig()) && (state.round.mode === 'active' || message.text.trim().toLowerCase() === state.round.keyword.toLowerCase());
      const accepted = qualifies && enter(state.round, message.login, message.displayName, message.userId);
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
    let auth = null;
    if (body.token) {
      const token = String(body.token).replace(/^oauth:/, '');
      const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('That Twitch token is invalid or expired.');
      const info = await response.json();
      if (!info.scopes?.includes('chat:read')) throw new Error('The token needs the chat:read permission.');
      const users = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, { headers: { Authorization: `Bearer ${token}`, 'Client-Id': info.client_id }, signal: AbortSignal.timeout(10000) });
      if (!users.ok) throw new Error('Unable to look up this Twitch channel.');
      const broadcaster = (await users.json()).data?.[0];
      if (!broadcaster) throw new Error('That Twitch channel does not exist.');
      auth = { login: info.login, token, scopes: info.scopes, userId: info.user_id, clientId: info.client_id, broadcasterId: broadcaster.id };
    }
    disconnect();
    if (state.channel !== channel) { state.channel = channel; state.round = newRound(); chat.length = 0; }
    credentials = auth; connect();
  } else if (route === 'disconnect') disconnect();
  else if (route === 'bot/save') {
    if (!state.channel) throw new Error('Connect a channel or use the demo first.');
    const config = botConfig(), type = body.type;
    if (!['commands', 'timers'].includes(type)) throw new Error('Invalid item type.');
    const previous = config[type].find(item => item.id === body.id);
    const item = validateItem(type, body, previous);
    if (config[type].some(c => c.name.toLowerCase() === item.name.toLowerCase() && c.id !== item.id)) throw new Error('That name already exists.');
    if (previous) config[type] = config[type].map(c => c.id === item.id ? item : c); else config[type].push(item);
    if (type === 'timers') timerTimes.set(item.id, Date.now());
  } else if (route === 'bot/delete' || route === 'bot/toggle') {
    if (!['commands', 'timers'].includes(body.type)) throw new Error('Invalid item type.');
    const config = botConfig();
    if (route.endsWith('delete')) config[body.type] = config[body.type].filter(c => c.id !== body.id);
    else { const item = config[body.type].find(c => c.id === body.id); if (!item) throw new Error('Item not found.'); item.enabled = !item.enabled; timerTimes.set(item.id, Date.now()); }
  } else if (route === 'bot/regulars') {
    if (!state.channel) throw new Error('Connect a channel or use the demo first.');
    const names = String(body.names || '').split(/[\s,;]+/).filter(Boolean).map(normalize);
    if (names.some(n => !validLogin(n))) throw new Error('Use Twitch usernames only.');
    botConfig().regulars = [...new Set(names)];
  } else if (route === 'bot/filters') {
    if (!state.channel) throw new Error('Connect a channel or use the demo first.');
    botConfig().filters = { links: Boolean(body.links), caps: Boolean(body.caps), repetitions: Boolean(body.repetitions), exemptRegulars: Boolean(body.exemptRegulars), blacklist: String(body.blacklist || '').slice(0, 10000) };
  } else if (route === 'announce') {
    if (!round.winner) throw new Error('Draw a winner first.');
    if (!sendChat(`Congratulations @${round.winner.login}! You won ${round.title}!`)) throw new Error('Connect with a chat:edit token to send. Wait a moment between messages.');
    logBot('announcement', `Winner announced: ${round.winner.login}`);
  }
  else if (route === 'demo') {
    disconnect(); state.channel = '__demo__'; state.round = newRound(); chat.length = 0;
    state.round.status = 'open';
    for (const name of ['pixelpilot', 'moonlit', 'mitchfan', 'cozycat', 'arcaneandy', 'ratjam', 'lilac', 'wowenjoyer', 'toastie', 'luckypanda', 'river', 'starboy']) enter(state.round, name);
    if (!history().length) history().push({ id: 'demo-seed', login: 'ratjam', displayName: 'ratjam', imported: true, at: new Date().toISOString(), title: 'Previous giveaway' });
    status('demo', 'Sandbox • no Twitch messages are sent.');
  } else if (route === 'settings') {
    if (round.status !== 'ready') throw new Error('Create a new giveaway before changing its rules.');
    const boost = Number(body.boost), cooldownMinutes = Number(body.cooldownMinutes);
    if (!Number.isInteger(boost) || boost < 0 || boost > 50 || !Number.isInteger(cooldownMinutes) || cooldownMinutes < 0 || cooldownMinutes > 43200) throw new Error('Boost must be 0–50%; winner cooldown must be 0–43,200 minutes (30 days).');
    const keyword = String(body.keyword || '').trim();
    if (!/^\S{1,30}$/.test(keyword)) throw new Error('Use a keyword without spaces (up to 30 characters).');
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
  } else if (route === 'draw') draw(round, history());
  else if (route === 'new') {
    if (round.status === 'open') throw new Error('Close entries before starting a new giveaway.');
    state.round = { ...newRound(), title: round.title, keyword: round.keyword, boost: round.boost, cooldownMinutes: round.cooldownMinutes, mode: round.mode, activeMinutes: round.activeMinutes, level: round.level };
  } else if (route === 'remove') {
    if (!['open', 'closed'].includes(round.status)) throw new Error('Entrants can only be removed before drawing.');
    const entrant = round.entrants.find(e => e.login === body.login); if (entrant) entrant.excluded = !entrant.excluded;
  } else if (route === 'reset-eligibility') {
    if (!['open', 'closed'].includes(round.status)) throw new Error('Reset eligibility before drawing.');
    round.entrants.forEach(e => e.excluded = true);
  } else if (route === 'import') {
    if (!state.channel) throw new Error('Connect a channel or enter demo mode first.');
    if (round.status === 'open' || round.status === 'closed') throw new Error('Import history before opening a giveaway.');
    const names = String(body.names || '').split(/[\s,;]+/).filter(Boolean).map(normalize);
    if (!names.length || names.length > 10000 || names.some(n => !validLogin(n))) throw new Error('Enter up to 10,000 Twitch usernames separated by commas or new lines.');
    for (const login of new Set(names)) if (!history().some(h => h.login === login)) history().push({ id: require('node:crypto').randomUUID(), login, displayName: login, imported: true, at: new Date().toISOString(), title: 'Imported past winner' });
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
  const files = { '/': 'index.html', '/app.js': 'app.js', '/bot-ui.js': 'bot-ui.js', '/style.css': 'style.css', '/theme.css': 'theme.css', '/giveaway.css': 'giveaway.css' };
  if (req.method !== 'GET' || !files[pathname]) { res.writeHead(404).end('Not found'); return; }
  res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(path.join(__dirname, 'public', files[pathname])));
});
const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); if ((state.round.mode === 'active' && state.round.status === 'open') || (state.round.cooldownMinutes > 0 && ['open', 'closed'].includes(state.round.status))) publish(); }, 20000);
setInterval(() => {
  if (connection.status !== 'connected') return;
  const now = Date.now(); chatTimes = chatTimes.filter(t => t > now - 300000);
  for (const timer of botConfig().timers) {
    if (timer.enabled && now - (timerTimes.get(timer.id) || connectionEpoch) >= timer.interval * 60000 && chatTimes.length >= timer.lines) {
      if (sendChat(variables(timer.message, { channel: state.channel, user: state.channel, count: '' }))) { timerTimes.set(timer.id, now); logBot('timer', `${timer.name} sent`); }
    }
  }
}, 5000).unref();
server.listen(port, '127.0.0.1', () => console.log(`MitchLucky is ready at http://127.0.0.1:${port}`));
process.on('SIGINT', () => { disconnect(); clearInterval(heartbeat); server.close(); process.exit(); });
