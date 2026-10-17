const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { winnerAnnouncement, winnerMessageTemplate, DEFAULT_WINNER_MESSAGE, newRound, enter } = require('../engine');

test('winner templates mention the selected login and reject unsafe or oversized text', () => {
  assert.equal(winnerAnnouncement({ login: 'cdew' }, DEFAULT_WINNER_MESSAGE), 'Congratulations @cdew! You Won. You have 60 seconds to respond.');
  assert.equal(winnerAnnouncement({ login: 'cdew' }, 'GG {winner}! Claim your prize.'), 'GG @cdew! Claim your prize.');
  for (const text of ['', '  ', 'hello\nworld', 'hello\0', 'a'.repeat(426), '{winner}'.repeat(30)]) assert.throws(() => winnerMessageTemplate(text));
});

test('announcements send automatically once, respect rate limits, persist settings, and never replay on restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mitchlucky-announcements-'));
  const origin = 'http://127.0.0.1:31888'; let child;
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '31888', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('error', reject); });
  }
  async function stop() { await new Promise(resolve => { child.once('exit', resolve); child.kill(); }); }
  t.after(() => { if (child?.exitCode === null) child.kill(); });
  const post = async (action, body = {}) => { const r = await fetch(origin + '/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const snapshot = async () => (await fetch(origin + '/api/state')).json();
  async function delivered() {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) { const s = await snapshot(); if (s.round.winner?.announcement?.status !== 'pending') return s; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('Announcement did not complete');
  }
  await start(); await post('demo');
  assert.equal((await post('winner-message', { channel: 'wrong', template: 'Hello' })).status, 400);
  assert.equal((await post('winner-message', { channel: '__demo__', template: 'bad\nmessage' })).status, 400);
  await post('winner-message', { channel: '__demo__', template: 'Saved {winner}' });
  const failed = await post('draw', { winnerMessageTemplate: 'bad\nmessage' });
  assert.equal(failed.status, 400); assert.equal((await snapshot()).round.status, 'open');
  await post('draw', { winnerMessageTemplate: 'GG {winner}! You won.' });
  let s = await delivered();
  assert.equal(s.round.winner.announcement.status, 'demo');
  assert.equal(s.chat.length, 1); assert.equal(s.chat[0].text, `GG @${s.round.winner.login}! You won.`);
  assert.equal((await post('draw')).status, 400); assert.equal((await snapshot()).chat.length, 1);
  // A second roll immediately after the first must queue, not lose its message.
  await post('demo'); await post('draw'); s = await delivered();
  assert.equal(s.round.winner.announcement.status, 'demo'); assert.equal(s.chat.length, 1);
  assert.equal(s.chat[0].text, `GG @${s.round.winner.login}! You won.`);
  const sentAt = s.round.winner.announcement.sentAt;
  await stop(); await start(); s = await snapshot();
  assert.equal(s.winnerMessageTemplate, 'GG {winner}! You won.');
  assert.equal(s.round.winner.announcement.sentAt, sentAt); assert.equal(s.chat.length, 0);
  await stop();
  // A real read-only channel may still roll, but cannot silently claim a send.
  const round = newRound(); round.status = 'open'; enter(round, 'viewer');
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ channel: 'testchannel', histories: {}, round }));
  await start(); await post('draw'); s = await delivered();
  assert.equal(s.round.status, 'drawn'); assert.equal(s.round.winner.announcement.status, 'not-sent');
  assert.match(s.round.winner.announcement.reason, /Read \+ Write/); assert.equal(s.chat.length, 0);
});
