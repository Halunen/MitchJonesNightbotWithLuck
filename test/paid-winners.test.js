const { test } = require('node:test');
const assert = require('node:assert/strict');
const { demoPaidWinnersResponse, readDemoPaidWinners } = require('../paid-winners');
const { newRound, enter, pool, draw, luckReply } = require('../engine');

test('sample payouts mark known winners and remove the first-win bonus', () => {
  const round = newRound(); round.status = 'open';
  for (const name of ['CDEW', 'AndyM', 'CUDA', 'GJake']) enter(round, name);
  const paid = readDemoPaidWinners(), entries = pool(round, [], Date.now(), paid);
  assert.deepEqual(entries.map(e => e.weight), [100, 100, 105, 100]);
  assert.deepEqual(entries.map(e => e.paidWinner?.winCount || 0), [3, 1, 0, 2]);
  assert.equal(entries[0].paidWinner.totalPaidCents, 45000);
  assert.equal(pool(round, [{ login: 'cdew' }], Date.now(), paid)[0].wins, 3);
  round.cooldownMinutes = 60;
  assert.equal(pool(round, [], Date.now(), paid)[0].blocked, false);
  assert.match(luckReply(round, [], {}, { login: 'cdew' }, paid), /recorded win.*1.00x/);
});

test('drawing a winner does not manufacture or modify a payout', () => {
  const before = demoPaidWinnersResponse(), paid = readDemoPaidWinners();
  const round = newRound(); round.status = 'open'; enter(round, 'cuda');
  draw(round, [], () => 0, 25, paid);
  assert.deepEqual(demoPaidWinnersResponse(), before);
  assert.equal(paid.some(p => p.login === 'cuda'), false);
  assert.equal(pool(round, [round.winner], Date.now(), [])[0].paidWinner, null);
});
