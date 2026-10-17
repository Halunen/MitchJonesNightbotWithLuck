const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, violation, variables, permitted, validateItem } = require('../bot');
test('filters are disabled by default; privileged users bypass configured filters', () => {
  const config = defaults(); const message = { login: 'viewer', text: 'https://example.com' };
  assert.equal(violation(message, config), null); config.filters.links = true;
  assert.equal(violation(message, config), 'Links'); assert.equal(violation({ ...message, mod: true }, config), null);
  config.regulars.push('viewer'); assert.equal(violation(message, config), null);
});
test('caps, repeated characters, and blocked phrases have explicit boundaries', () => {
  const config = defaults(); Object.assign(config.filters, { caps: true, repetitions: true, blacklist: 'bad phrase' });
  assert.equal(violation({ login: 'x', text: 'SHORT CAPS' }, config), null);
  assert.equal(violation({ login: 'x', text: 'THIS IS A LONG ALL CAPS MESSAGE' }, config), 'Excessive capitals');
  assert.equal(violation({ login: 'x', text: 'aaaaaaaaaaaaaaa' }, config), 'Repeated characters');
  assert.equal(violation({ login: 'x', text: 'A BAD PHRASE here' }, config), 'Blocked phrase');
});
test('command levels reject unauthorized viewers and accept moderators', () => {
  const config = defaults(); assert.equal(permitted('moderator', { login: 'x' }, config), false);
  assert.equal(permitted('regular', { login: 'x', mod: true }, config), true);
  assert.equal(permitted('owner', { login: 'x', mod: true }, config), false);
  config.regulars.push('x'); assert.equal(permitted('regular', { login: 'x' }, config), true);
});
test('command templates substitute supported variables without evaluating arbitrary code', () => {
  assert.equal(variables('Hi $(user), $(query) #$(count) $(unknown)', { user: 'Viewer', query: 'hello', count: 2 }), 'Hi Viewer, hello #2 $(unknown)');
  assert.equal(variables('hi\r\nJOIN #x', {}), 'hi  JOIN #x');
});
test('command and timer configuration rejects invalid messages and timing', () => {
  assert.throws(() => validateItem('commands', { name: '!test', message: 'hi\nJOIN', cooldown: 30, level: 'everyone' }), /single line/);
  assert.throws(() => validateItem('timers', { name: 'timer', message: 'hi', interval: 0, lines: 1 }), /interval/);
  const item = validateItem('commands', { name: '!Hello', message: 'Hello $(user)', cooldown: 30, level: 'everyone' });
  assert.equal(item.name, '!hello'); assert.equal(item.enabled, true);
});
