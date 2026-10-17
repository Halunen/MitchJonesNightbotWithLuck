const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
execFileSync(process.execPath, ['scripts/build-public-demo.js'], { cwd: root, stdio: 'pipe' });
function visitor(t, storage = new Map()) {
  const timers = new Set();
  const context = vm.createContext({ crypto: webcrypto, Response, Uint32Array, queueMicrotask,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    setTimeout: (fn, delay) => { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
    setInterval: () => 0,
  });
  context.window = context;
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  for (const file of ['engine.js', 'paid-winners.js', 'demo-api.js']) vm.runInContext(fs.readFileSync(path.join(root, 'docs', 'app', file), 'utf8'), context);
  const request = async (route, body) => {
    const response = await context.demoApi.fetch('/api/' + route, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { request, storage };
}

test('public demo uses isolated browser data, shared draw rules, rerolls, and automatic announcements', async t => {
  const a = visitor(t), b = visitor(t);
  const initial = (await a.request('state')).body;
  assert.equal(initial.round.status, 'open'); assert.equal(initial.round.entrants.length, 12);
  assert.equal(initial.payouts.selectedWinner, null);
  assert.equal(initial.round.entrants.find(e => e.login === 'cdew').weight, 100);
  assert.equal(initial.round.entrants.find(e => e.login === 'cuda').weight, 105);
  assert.ok(initial.round.entrants.every(e => e.paidWinner === undefined));
  const picked = (await a.request('draw', { roundId: initial.round.id, winnerMessageTemplate: 'GG {winner}!' })).body;
  assert.equal(picked.round.status, 'drawn');
  assert.equal((await b.request('state')).body.round.status, 'open');
  assert.equal((await a.request('draw', { roundId: initial.round.id })).status, 400);
  const rolled = await a.request('reroll', { roundId: initial.round.id, winnerId: picked.round.winner.id });
  assert.equal(rolled.status, 200); assert.notEqual(rolled.body.round.winner.login, picked.round.winner.login);
  assert.equal(rolled.body.round.entrants.length, 12);
  assert.ok(rolled.body.round.entrants.every(e => e.luckEntries === 1));
  assert.equal((await a.request('reroll', { roundId: initial.round.id, winnerId: picked.round.winner.id })).status, 400);
  await new Promise(resolve => setTimeout(resolve, 40));
  const sent = (await a.request('state')).body;
  assert.equal(sent.round.winner.announcement.status, 'demo');
  assert.equal(sent.chat.at(-1).text, `GG @${sent.round.winner.login}!`);
  const reloaded = visitor(t, a.storage);
  assert.equal((await reloaded.request('state')).body.round.winner.id, sent.round.winner.id);
  await a.request('new', {});
  const ready = (await a.request('state')).body;
  assert.equal(ready.round.entrants.length, 0);
  const opened = (await a.request('open', {})).body;
  assert.equal(opened.round.entrants.length, 12);
  assert.equal(opened.round.entrants.find(e => e.login === 'cuda').luckEntries, 2);
});

test('public artifact has relative assets and no credential fields or live network adapter', async t => {
  const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /id="token"|id="channel"|id="connect-dialog"|src="\/|href="\//);
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g)) assert.ok(fs.existsSync(path.join(root, 'docs', match[1])), match[1]);
  const client = fs.readFileSync(path.join(root, 'docs', 'app', 'app.js'), 'utf8');
  assert.match(client, /window\.demoApi\.fetch/); assert.doesNotMatch(client, /new EventSource|oauth|id\.twitch\.tv|api\.twitch\.tv/);
  const a = visitor(t);
  assert.equal((await a.request('connect', { token: 'not-a-real-token', channel: 'example' })).status, 400);
  assert.equal((await a.request('winner-message', { channel: '__demo__', template: 'bad\nmessage' })).status, 400);
  assert.equal((await a.request('state')).body.round.status, 'open');
});
