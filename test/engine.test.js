const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRound, pool, enter, draw, parseChat, permitted, matchesKeyword, winnerAnnouncement, chatText, luckReply } = require('../engine');
const fixture = () => { const round = newRound(); round.status = 'open'; enter(round, 'newviewer', 'NewViewer', '1'); enter(round, 'pastwinner', 'PastWinner', '2'); round.entrants[0].luckEntries = 10; return { round, history: [{ login: 'pastwinner', userId: '2', imported: false }] }; };
test('experienced never-winners reach the configured cap; previous winners stay at standard weight', () => {
  const { round, history } = fixture(); const entries = pool(round, history);
  assert.deepEqual(entries.map(e => e.weight), [125, 100]); assert.equal(entries[0].weight / 225, 5 / 9);
});
test('one entry per normalized username or Twitch user ID', () => {
  const round = newRound(); round.status = 'open'; assert.equal(enter(round, 'Viewer', 'Viewer', '123'), true);
  assert.equal(enter(round, 'VIEWER', 'Viewer', '123'), false); assert.equal(enter(round, 'renamed', 'Renamed', '123'), false);
  round.status = 'closed'; assert.equal(enter(round, 'another'), false);
});
test('weighted draw ticket boundaries give 125 tickets to new viewer and 100 to previous winner', () => {
  for (const [ticket, expected] of [[0, 'newviewer'], [124, 'newviewer'], [125, 'pastwinner'], [224, 'pastwinner']]) {
    const { round, history } = fixture(); round.status = 'closed';
    const winner = draw(round, history, total => { assert.equal(total, 225); return ticket; });
    assert.equal(winner.login, expected); assert.equal(round.status, 'drawn'); assert.equal(history.length, 2);
    assert.throws(() => draw(round, history), /new giveaway/);
  }
});
test('a first win removes the bonus in the next giveaway, including after renaming', () => {
  const { round, history } = fixture(); round.status = 'closed'; draw(round, history, () => 0);
  const next = newRound(); next.status = 'open'; enter(next, 'renamed', 'Renamed', '1');
  assert.equal(pool(next, history)[0].weight, 100);
});
test('time cooldown expires exactly at its boundary regardless of other draws', () => {
  const { round } = fixture(); round.cooldownMinutes = 60;
  const wonAt = Date.parse('2026-10-17T12:00:00Z');
  const history = [{ login: 'pastwinner', userId: '2', at: new Date(wonAt).toISOString() }, { login: 'newviewer', imported: true, at: new Date(wonAt).toISOString() }];
  assert.deepEqual(pool(round, history, wonAt + 3599999).map(e => e.weight), [100, 0]);
  history.push({ login: 'third', at: new Date(wonAt + 1000).toISOString() });
  assert.equal(pool(round, history, wonAt + 3599999)[1].weight, 0);
  assert.equal(pool(round, history, wonAt + 3600000)[1].weight, 100);
  round.entrants[1].login = 'renamed';
  assert.equal(pool(round, history, wonAt + 1000)[1].weight, 0);
  round.cooldownMinutes = 0;
  assert.equal(pool(round, history, wonAt + 1000)[1].weight, 100);
});
test('failed rolls leave an open giveaway collecting entries', () => {
  const round = newRound(); assert.throws(() => draw(round, []), /Open entries/);
  round.status = 'open'; assert.throws(() => draw(round, []), /No eligible/);
  assert.equal(round.status, 'open');
  enter(round, 'viewer'); round.cooldownMinutes = 1;
  const history = [{ login: 'viewer', at: new Date().toISOString() }];
  assert.throws(() => draw(round, history), /No eligible/);
  assert.equal(round.status, 'open'); assert.equal(history.length, 1);
});
test('rolling an open giveaway applies the current boost and stops new entries exactly once', () => {
  const { round, history } = fixture();
  assert.throws(() => draw(round, history, () => 0, 51), /0–50/);
  assert.equal(round.status, 'open'); assert.equal(round.boost, 25);
  const winner = draw(round, history, total => { assert.equal(total, 250); return 149; }, 50);
  assert.equal(winner.login, 'newviewer'); assert.equal(winner.odds, .6);
  assert.equal(winner.boost, 50); assert.equal(round.boost, 50);
  assert.equal(round.closedAt, winner.at); assert.equal(round.status, 'drawn');
  assert.equal(enter(round, 'lateviewer'), false);
  assert.throws(() => draw(round, history), /new giveaway/);
  assert.equal(history.length, 2);
});
test('IRC parsing reads verified Twitch identity and ignores protocol messages', () => {
  assert.deepEqual(parseChat('@display-name=Viewer;user-id=123 :viewer!viewer@viewer.tmi.twitch.tv PRIVMSG #channel :!luck'), { login: 'viewer', displayName: 'Viewer', userId: '123', channel: 'channel', text: '!luck' });
  assert.equal(parseChat('PING :tmi.twitch.tv'), null);
});
test('active-user eligibility freezes at closing time and manual exclusion persists', () => {
  const { round, history } = fixture(); round.mode = 'active'; round.activeMinutes = 5;
  round.closedAt = '2026-10-15T12:10:00Z';
  round.entrants[0].lastActiveAt = '2026-10-15T12:06:00Z'; round.entrants[1].lastActiveAt = '2026-10-15T12:04:59Z';
  assert.deepEqual(pool(round, history).map(e => e.weight), [125, 0]);
  round.entrants[0].excluded = true; assert.equal(pool(round, history)[0].weight, 0);
  assert.equal(enter(round, 'newviewer'), false); assert.equal(round.entrants[0].excluded, true);
});
test('giveaway eligibility honors subscriber and moderator permissions', () => {
  assert.equal(permitted('subscriber', { login: 'viewer', subscriber: true }), true);
  assert.equal(permitted('subscriber', { login: 'viewer' }), false);
  assert.equal(permitted('moderator', { login: 'viewer' }), false);
  assert.equal(permitted('subscriber', { login: 'mod', mod: true }), true);
  assert.equal(permitted('owner', { login: 'mod', mod: true }), false);
  assert.equal(permitted('owner', { login: 'owner', broadcaster: true }), true);
});
test('yo keyword accepts every capitalization but requires the complete message', () => {
  assert.equal(newRound().keyword, 'yo');
  for (const text of ['yo', 'YO', 'Yo', 'yO', '  YO  ']) assert.equal(matchesKeyword(text, 'yo'), true);
  for (const text of ['yoyo', '!yo', 'yo chat', 'hello yo']) assert.equal(matchesKeyword(text, 'yo'), false);
});
test('winner message includes the winner and chat rejects invalid single-line messages', () => {
  assert.equal(winnerAnnouncement({ login: 'viewer' }), 'Congratulations @viewer! You won.');
  assert.equal(chatText('  Hello chat!  '), 'Hello chat!');
  for (const text of ['', '  ', 'a'.repeat(451), 'hello\r\nJOIN #other', 'hello\0']) assert.throws(() => chatText(text), /single-line/);
});

test('participation grows once per entered giveaway, persists through reload and renames, and caps', () => {
  let ledger = {};
  for (let i = 1; i <= 12; i++) {
    const round = newRound(); round.status = 'open';
    const name = i > 2 ? 'renamedviewer' : 'viewer';
    assert.equal(enter(round, name, name, '123', ledger), true);
    assert.equal(enter(round, name.toUpperCase(), name, '123', ledger), false);
    assert.equal(enter(round, 'anothername', name, '123', ledger), false);
    round.status = 'closed'; round.status = 'open';
    assert.equal(enter(round, name, name, '123', ledger), false);
    const entry = pool(round, [])[0];
    assert.equal(entry.luckEntries, i);
    assert.equal(entry.bonus, Math.min(i * 5, 25));
    assert.equal(entry.weight, 100 + Math.min(i * 5, 25));
    assert.equal(pool({ ...round, boost: 50 }, [])[0].weight, 100 + Math.min(i * 5, 50));
    assert.equal(pool({ ...round, boost: 0 }, [])[0].weight, 100);
    ledger = JSON.parse(JSON.stringify(ledger));
  }
  const unrelated = newRound(); unrelated.status = 'open';
  enter(unrelated, 'other', 'other', '999', ledger);
  assert.equal(ledger['id:123'].count, 12);
  const separateChannel = {}; enter(unrelated, 'viewer', 'viewer', '123', separateChannel);
  assert.equal(separateChannel['id:123'].count, 1);
});

test('luck replies explain participation and actual odds without adding an entry', () => {
  const round = newRound(); round.status = 'open'; const ledger = {};
  enter(round, 'viewer', 'Viewer', '1', ledger);
  assert.match(luckReply(round, [], ledger, { login: 'viewer', userId: '1' }), /1 giveaway\(s\).*\+5% draw weight.*1.05x.*Current chance: 100.0000%/);
  assert.match(luckReply(round, [], ledger, { login: 'outsider', userId: '2' }), /not entered/);
  assert.match(luckReply(round, [{ login: 'viewer', userId: '1' }], ledger, { login: 'viewer', userId: '1' }), /recorded win.*1.00x/);
  assert.equal(round.entrants.length, 1); assert.equal(ledger['id:1'].count, 1);
});

test('8,000 entrants have normalized odds and a bounded participation advantage', () => {
  const round = newRound(); round.boost = 50;
  round.entrants = Array.from({ length: 8000 }, (_, i) => ({ login: `viewer${i}`, luckEntries: i === 0 ? 1000 : 1 }));
  const entries = pool(round, []), total = entries.reduce((sum, e) => sum + e.weight, 0);
  assert.equal(entries[0].weight, 150); assert.equal(entries[1].weight, 105);
  assert.ok(entries.every(e => e.weight / total < .0002));
  assert.ok(Math.abs(entries.reduce((sum, e) => sum + e.weight / total, 0) - 1) < 1e-12);
});
