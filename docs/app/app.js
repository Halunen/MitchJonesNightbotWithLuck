// Generated public-demo client.
const $ = id => document.getElementById(id);
let state, dirty = false, boostDirty = false, rolling = false, pending = false, toastTimer, clockOffsetMs = 0, templateDirty = false, messageSaveTimer;
let apiQueue = Promise.resolve();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = value => `${(value * 100).toFixed(value > 0 && value < .001 ? 4 : 2)}%`;
function paidWinnerTag(winner) {
  if (!winner) return '';
  const amount = (winner.totalPaidCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return '<span class="paid-winner-tag">Already won · ' + winner.winCount + (winner.winCount === 1 ? ' win' : ' wins') + '</span><small class="paid-winner-total">' + escapeHtml(winner.currency) + ' ' + amount + ' paid · demo</small>';
}

function elapsedLabel(start) {
  const seconds = Math.max(0, Math.floor((Date.now() + clockOffsetMs - Date.parse(start)) / 1000));
  const pad = n => String(n).padStart(2, '0');
  return `${seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:` : ''}${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}
function updateWinnerTimers() {
  if (!state?.round.winner || !$('winner-elapsed')) return;
  $('winner-elapsed').textContent = elapsedLabel(state.round.winner.at);
}
setInterval(updateWinnerTimers, 1000);
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = error ? 'error' : ''; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function api(action, data = {}) {
  const request = apiQueue.then(async () => {
    pending = true;
    try { const response = await window.demoApi.fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); render(result); return true; }
    catch (error) { toast(error.message, true); return false; }
    finally { pending = false; }
  });
  apiQueue = request;
  return request;
}
function updateBoost() {
  const value = Number($('boost').value);
  $('boost-badge').textContent = `Cap +${value}%`; $('boost-value').textContent = `${(1 + value / 100).toFixed(2)}× max`;
  $('weight-explanation').textContent = `Never-winners earn +5% draw weight per giveaway entered, up to +${value}% (${(1 + value / 100).toFixed(2)}×). First entry: +${Math.min(5, value)}%. Winning removes the bonus. This is extra weight, not a guaranteed win chance.`;
}
function render(next) {
  if (state?.instanceId === next.instanceId && next.revision < state.revision) return;
  const changedRound = state?.round.id !== next.round.id;
  const changedChannel = state?.channel !== next.channel;
  if (changedChannel) { templateDirty = false; clearTimeout(messageSaveTimer); }
  state = next; const { round, connection, demo, history } = state;
  if (next.serverNow) clockOffsetMs = Date.parse(next.serverNow) - Date.now();
  $('channel-label').textContent = demo ? 'Demo sandbox' : state.channel ? `#${state.channel}` : 'Your channel';
  $('connection-badge').textContent = `● ${demo ? 'Demo mode' : connection.status === 'connected' ? `#${state.channel}` : connection.status}`;
  $('connection-badge').className = `connection ${connection.status === 'connected' ? 'live' : ''}`;
  $('connect-open').textContent = 'Public Demo'; $('connect-open').disabled = true;
  $('mode-banner').hidden = !demo && !['reconnecting', 'error'].includes(connection.status);
  $('mode-banner').textContent = demo ? 'Public demo: sample viewers and fictional payouts. Your sandbox is saved only in this browser.' : connection.message;
  $('stat-total').textContent = round.entrants.length;
  const first = round.entrants.filter(e => !e.wins).length;
  $('stat-new').textContent = first; $('stat-returning').textContent = round.entrants.length - first;
  $('stat-new-caption').textContent = round.entrants.length ? `${Math.round(first / round.entrants.length * 100)}% of your entry pool` : 'Waiting for their moment';
  const editable = round.status === 'ready';
  if (changedRound) $('luck-status').textContent = 'Adjust anytime — luck applies automatically.';
  if (!dirty || changedRound) {
    for (const key of ['title', 'keyword', 'cooldownMinutes', 'mode', 'activeMinutes', 'level']) if ($(key)) $(key).value = round[key]; dirty = false;
  }
  if (changedRound || round.status === 'drawn') boostDirty = false;
  if (!boostDirty) { $('boost').value = round.boost; updateBoost(); }
  $('boost').disabled = round.status === 'drawn';
  for (const key of ['title', 'keyword', 'cooldownMinutes', 'save-settings', 'mode', 'activeMinutes', 'level']) if ($(key)) $(key).disabled = !editable;
  if ($('active-window-row')) $('active-window-row').hidden = $('mode').value !== 'active';
  document.querySelector('.keyword-row p').textContent = `Type ${$('keyword').value} in chat to enter. Not case-sensitive.`;
  $('round-status').textContent = { ready: 'Ready to start', open: '● Entries open', closed: 'Entries closed', drawn: 'Winner drawn' }[round.status];
  $('round-status').className = `pill ${round.status === 'open' ? 'open' : ''}`;
  $('open').hidden = !['ready', 'closed'].includes(round.status); $('open').textContent = round.status === 'closed' ? 'Reopen Entries' : 'Open Entries';
  $('close').hidden = round.status !== 'open'; $('draw').hidden = !['open', 'closed'].includes(round.status); $('draw').disabled = rolling || !round.entrants.some(e => e.weight > 0);
  $('new').hidden = !['drawn', 'closed'].includes(round.status);
  document.querySelector('.giveaway-card').hidden = round.status === 'drawn';
  (round.status === 'drawn' ? $('winner-actions') : document.querySelector('.giveaway-actions')).appendChild($('new'));
  $('reroll').hidden = round.status !== 'drawn';
  $('reroll').disabled = rolling || !round.entrants.some(e => e.weight > 0 && e.login !== round.winner?.login && !(e.userId && e.userId === round.winner?.userId));
  $('reroll').title = $('reroll').disabled ? 'No other eligible entrants remain, or a roll is in progress.' : 'Choose another winner from this entry pool.';
  $('entry-count').textContent = round.entrants.length;
  $('payout-source').hidden = !demo;
  $('payout-status').textContent = demo ? 'Sample payouts · checked ' + new Date(state.payouts.checkedAt).toLocaleTimeString() + ' · refreshes every 30s' : '';
  $('payout-refresh').disabled = !demo;
  renderEntrants();
  $('chat-dot').className = `chat-dot ${connection.status === 'connected' ? 'live' : ''}`;
  if (!templateDirty || changedChannel) $('winner-message').value = state.winnerMessageTemplate;
  $('winner-message').disabled = !state.channel || round.status === 'drawn';
  const delivery = round.winner?.announcement;
  $('announcement-delivery').textContent = delivery?.status === 'pending' ? 'Winner selected — announcement queued…' : delivery?.status === 'demo' ? 'Winner message posted automatically in this demo. Nothing was sent to Twitch.' : delivery?.status === 'sent' ? 'Winner message sent automatically to Twitch.' : delivery?.status === 'not-sent' ? 'Winner selected. Message not sent: ' + delivery.reason : round.winner ? 'No automatic message was scheduled for this earlier selection.' : demo ? 'Sent automatically after selection. Demo messages stay here.' : state.canSend ? 'Sent automatically after selection through Read + Write Chat.' : 'Connect Read + Write Chat to announce winners automatically.';
  $('announcement-delivery').className = 'help' + (delivery?.status === 'not-sent' ? ' delivery-error' : '');
  $('chat-footer').textContent = `${round.mode === 'active' ? `Active viewers · last ${round.activeMinutes} min` : `Watching for ${round.keyword}`} · ${round.status === 'open' ? 'Collecting entries' : 'Entries paused'}`;
  $('chat').innerHTML = state.chat.length ? state.chat.slice(-20).map(c => `<div class="chat-line"><strong>${escapeHtml(c.displayName)}</strong> ${escapeHtml(c.text)}${c.entered ? '<span class="entry-tag">ENTERED</span>' : ''}</div>`).join('') : `<div class="chat-empty">${demo ? 'Roll a winner to see their automatic announcement here. This demo never connects to Twitch.' : escapeHtml(connection.message)}</div>`;
  $('chat').scrollTop = $('chat').scrollHeight;
  $('winner').className = `winner-body ${round.winner ? 'selected' : ''}`;
  $('winner').innerHTML = round.winner ? `<h3>${escapeHtml(round.winner.displayName)}</h3>${demo ? (paidWinnerTag(state.payouts.selectedWinner) || '<p class="paid-winner-empty">No previous paid wins in demo records.</p>') : ''}<p>${round.winner.firstWin ? 'First recorded win' : 'Previous winner'} · ${pct(round.winner.odds)} chance</p><div class="winner-timers"><div><small>Time since selected</small><output id="winner-elapsed" role="timer" aria-live="off">00:00</output></div></div>` : '<p>Click <strong>Roll It!</strong> while entries are open to select a winner.</p>';
  updateWinnerTimers();
  if ($('reset-eligibility')) $('reset-eligibility').disabled = !['open', 'closed'].includes(round.status);
  $('history-count').textContent = history.length;
  $('history-empty').hidden = history.length > 0;
  $('history-rows').innerHTML = [...history].reverse().slice(0, 100).map(h => `<tr><td class="viewer">${escapeHtml(h.displayName)}</td><td>${escapeHtml(h.title)}</td><td>${escapeHtml(new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td><span class="weight ${h.rerolled || h.imported || !h.firstWin ? 'normal' : ''}">${h.rerolled ? 'Rerolled' : h.imported ? 'Imported winner' : h.firstWin ? '✧ First win' : 'Returning winner'}</span></td></tr>`).join('');
  window.renderGiveawayUI?.(state);
}
function renderEntrants() {
  if (!state) return;
  const query = $('search').value.toLowerCase();
  const cap = boostDirty ? Number($('boost').value) : state.round.boost;
  const preview = state.round.entrants.map(e => { const bonus = e.wins ? 0 : Math.min(cap, Math.max(1, e.luckEntries || 1) * 5); return { ...e, bonus, weight: e.blocked ? 0 : 100 + bonus }; });
  const total = preview.reduce((sum, e) => sum + e.weight, 0);
  const entrants = preview.map(e => ({ ...e, odds: total ? e.weight / total : 0 })).filter(e => `${e.login} ${e.displayName}`.toLowerCase().includes(query));
  $('empty').hidden = state.round.entrants.length > 0;
  $('entrants').innerHTML = entrants.slice(0, 500).map(e => `<tr class="${e.blocked ? 'ineligible' : ''}"><td><button class="eligibility-check ${e.blocked ? '' : 'checked'}" data-remove="${escapeHtml(e.login)}" ${['open', 'closed'].includes(state.round.status) ? '' : 'disabled'} aria-label="${e.excluded ? 'Include' : 'Exclude'} ${escapeHtml(e.login)}" aria-pressed="${!e.blocked}">${e.blocked ? '' : '✓'}</button></td><td class="viewer" title="${e.wins ? 'Standard luck' : 'No recorded wins'}">${escapeHtml(e.displayName)}<small>${e.wins ? 'Standard luck' : `${e.luckEntries || 1} giveaway${e.luckEntries === 1 || !e.luckEntries ? '' : 's'} entered · no wins`}</small></td><td><span class="weight ${e.wins || e.blocked ? 'normal' : ''}" title="${e.wins ? 'Previous winner: standard weight' : `+5% per giveaway entered, capped at +${cap}%`}">${e.blocked ? escapeHtml(e.reason === 'Previously selected' ? 'Rerolled' : e.reason) : `+${e.bonus}% · ${(e.weight / 100).toFixed(2)}×`}</span></td><td>${pct(e.odds)}</td></tr>`).join('');
  $('pool-footer').textContent = `${entrants.length > 500 ? `Showing 500 of ${entrants.length} matching viewers. ` : ''}Exact chances update as viewers join. ${state.round.entrants.filter(e => e.blocked).length} ineligible.`;
}
for (const key of ['title', 'keyword', 'cooldownMinutes']) $(key).addEventListener('input', () => { dirty = true; document.querySelector('.keyword-row p').textContent = `Type ${$('keyword').value} in chat to enter. Not case-sensitive.`; });
$('boost').addEventListener('input', () => { boostDirty = true; updateBoost(); renderEntrants(); $('luck-status').textContent = 'Preview — release to apply'; });
$('boost').addEventListener('change', async () => {
  const boost = Number($('boost').value), roundId = state.round.id;
  $('luck-status').textContent = 'Applying luck…';
  const ok = await api('luck', { boost, roundId });
  if (state.round.id === roundId && Number($('boost').value) === boost) {
    boostDirty = false;
    if (!ok) { $('boost').value = state.round.boost; updateBoost(); renderEntrants(); }
    $('luck-status').textContent = ok ? 'Luck applied automatically' : 'Could not apply luck — try again';
  }
});
$('search').addEventListener('input', renderEntrants);
$('payout-refresh').onclick = () => api('demo/payouts/refresh');
$('entrants').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) api('remove', { login: button.dataset.remove }); });
const settings = () => Object.fromEntries(['title', 'keyword', 'boost', 'cooldownMinutes', 'mode', 'activeMinutes', 'level'].filter(key => $(key)).map(key => [key, $(key).value]));
$('settings').addEventListener('submit', async event => { event.preventDefault(); dirty = false; if (await api('settings', settings())) toast('Giveaway rules saved.'); });
$('open').onclick = async () => { if (state.round.status === 'ready') { dirty = false; if (!await api('settings', settings())) return; } await api('open'); };
for (const name of ['close']) $(name).onclick = () => api(name);
$('draw').onclick = async () => {
  if (rolling) return;
  rolling = true; $('draw').disabled = true;
  const ok = await api('draw', { roundId: state.round.id, boost: Number($('boost').value), winnerMessageTemplate: $('winner-message').value });
  if (ok) { templateDirty = false; clearTimeout(messageSaveTimer); $('message-save-status').textContent = 'Message saved'; }
  rolling = false;
  render(state);
};
$('reroll').onclick = async () => {
  if (rolling || !state.round.winner) return;
  rolling = true; $('reroll').disabled = true;
  await api('reroll', { roundId: state.round.id, winnerId: state.round.winner.id, winnerMessageTemplate: $('winner-message').value });
  rolling = false; render(state);
};
$('new').onclick = () => { if (state.round.entrants.length && !state.round.winner && !confirm('Clear this entry pool and start a new giveaway?')) return; api('new'); };
$('demo').onclick = () => { if (state?.round.entrants.length && !confirm('Switch to the demo sandbox? This clears the current entry pool. Winner history is preserved.')) return; api('demo'); };
document.querySelectorAll('.dismiss').forEach(button => button.onclick = () => button.closest('dialog').close());
async function saveWinnerMessage() {
  clearTimeout(messageSaveTimer);
  if (!templateDirty || !state?.channel) return;
  const template = $('winner-message').value, channel = state.channel;
  $('message-save-status').textContent = 'Saving…';
  const ok = await api('winner-message', { template, channel });
  if (channel === state.channel && template === $('winner-message').value) {
    templateDirty = !ok;
    $('message-save-status').textContent = ok ? 'Message saved automatically' : 'Could not save — check the message';
  }
}
$('winner-message').oninput = () => {
  templateDirty = true; clearTimeout(messageSaveTimer);
  $('message-save-status').textContent = 'Unsaved changes';
  messageSaveTimer = setTimeout(saveWinnerMessage, 500);
};
$('winner-message').onblur = saveWinnerMessage;
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ channel: state.channel, history: state.history }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `mitchlucky-${state.channel || 'channel'}-winners.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const events = new window.demoApi.EventSource('/api/events');
events.onmessage = event => render(JSON.parse(event.data));
events.onerror = () => { $('connection-badge').textContent = '● Dashboard reconnecting'; };
