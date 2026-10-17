const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRound, pool, enter, draw, parseChat, permitted, matchesKeyword, winnerAnnouncement, chatText } = require('../engine');
const fixture = () => { const round = newRound(); round.status = 'open'; enter(round, 'newviewer', 'NewViewer', '1'); enter(round, 'pastwinner', 'PastWinner', '2'); return { round, history: [{ login: 'pastwinner', userId: '2', imported: false }] }; };
test('new viewers get exactly 25% extra weight; odds sum to one', () => {
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
    assert.throws(() => draw(round, history), /Close entries/);
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
test('draw rejects empty pools, ineligible pools, and open rounds', () => {
  const round = newRound(); assert.throws(() => draw(round, []), /Close entries/);
  round.status = 'open'; enter(round, 'viewer'); assert.throws(() => draw(round, []), /Close entries/);
  round.status = 'closed'; round.cooldownMinutes = 1; assert.throws(() => draw(round, [{ login: 'viewer', at: new Date().toISOString() }]), /No eligible/);
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
