const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newRound, enter, draw, reroll, pool } = require('../engine');

test('rerolls keep the pool and luck progress, exclude every previous selection, and retain an audit history', () => {
  const round = newRound(), ledger = {}, history = []; round.status = 'open';
  for (const [i, name] of ['first', 'second', 'third'].entries()) enter(round, name, name, String(i + 1), ledger);
  const id = round.id, entrants = JSON.stringify(round.entrants);
  const first = draw(round, history, () => 0), closedAt = round.closedAt;
  const second = reroll(round, history, () => 0);
  assert.equal(second.login, 'second'); assert.notEqual(second.id, first.id);
  assert.equal(first.rerolled, true); assert.equal(round.id, id); assert.equal(round.closedAt, closedAt);
  assert.equal(JSON.stringify(round.entrants), entrants); assert.equal(ledger['id:1'].count, 1);
  assert.equal(round.status, 'drawn'); assert.equal(enter(round, 'late'), false);
  assert.equal(pool(round, history)[0].reason, 'Previously selected');
  const third = reroll(round, history, () => 0); assert.equal(third.login, 'third');
  const before = JSON.stringify({ round, history });
  assert.throws(() => reroll(round, history), /No eligible/);
  assert.equal(JSON.stringify({ round, history }), before);
  const next = newRound(); next.status = 'open'; enter(next, 'first', 'first', '1', ledger);
  assert.equal(pool(next, history)[0].wins, 0); assert.equal(pool(next, history)[0].weight, 110);
});

test('reroll honors identity exclusions, manual exclusions, and the original activity cutoff', () => {
  const round = newRound(), history = []; round.status = 'open';
  for (const [i, name] of ['first', 'second', 'third'].entries()) enter(round, name, name, String(i + 1));
  round.mode = 'active'; round.activeMinutes = 5;
  round.entrants[2].excluded = true;
  draw(round, history, () => 0);
  round.entrants[0].login = 'renamed';
  // The second viewer was active at the initial cutoff but not at the reroll time.
  round.entrants[1].lastActiveAt = new Date(Date.parse(round.closedAt) - 299999).toISOString();
  assert.equal(reroll(round, history, () => 0).login, 'second');
  assert.throws(() => reroll(round, history), /No eligible/);
  const fresh = newRound(); assert.throws(() => reroll(fresh, []), /Select a winner/);
});
