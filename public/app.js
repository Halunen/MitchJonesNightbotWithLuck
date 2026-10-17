const $ = id => document.getElementById(id);
let state, dirty = false, pending = false, toastTimer;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = value => `${(value * 100).toFixed(2)}%`;
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = error ? 'error' : ''; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
async function api(action, data = {}) {
  if (pending) return;
  pending = true;
  try { const response = await fetch(`/api/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); render(result); return true; }
  catch (error) { toast(error.message, true); return false; }
  finally { pending = false; }
}
function updateBoost() {
  const value = Number($('boost').value);
  $('boost-badge').textContent = `+${value}%`; $('boost-value').textContent = `${(1 + value / 100).toFixed(2)}×`;
  $('weight-explanation').textContent = `Users with no recorded wins get ${(1 + value / 100).toFixed(2)}× draw weight. Past winners get 1×.`;
}
function render(next) {
  const changedRound = state?.round.id !== next.round.id;
  state = next; const { round, connection, demo, history } = state;
  $('channel-label').textContent = demo ? 'Demo sandbox' : state.channel ? `#${state.channel}` : 'Your channel';
  $('connection-badge').textContent = `● ${demo ? 'Demo mode' : connection.status === 'connected' ? `#${state.channel}` : connection.status}`;
  $('connection-badge').className = `connection ${connection.status === 'connected' ? 'live' : ''}`;
  $('connect-open').textContent = connection.status === 'connected' ? 'Channel settings ↗' : 'Connect Twitch ↗';
  $('mode-banner').hidden = !demo && !['reconnecting', 'error'].includes(connection.status);
  $('mode-banner').textContent = demo ? 'Demo mode: sample users and history. Connect Twitch to run a real giveaway.' : connection.message;
  $('stat-total').textContent = round.entrants.length;
  const first = round.entrants.filter(e => !e.wins).length;
  $('stat-new').textContent = first; $('stat-returning').textContent = round.entrants.length - first;
  $('stat-new-caption').textContent = round.entrants.length ? `${Math.round(first / round.entrants.length * 100)}% of your entry pool` : 'Waiting for their moment';
  const editable = round.status === 'ready';
  if (!dirty || changedRound) {
    for (const key of ['title', 'keyword', 'boost', 'cooldownMinutes', 'mode', 'activeMinutes', 'level']) if ($(key)) $(key).value = round[key]; dirty = false; updateBoost();
  }
  for (const key of ['title', 'keyword', 'boost', 'cooldownMinutes', 'save-settings', 'mode', 'activeMinutes', 'level']) if ($(key)) $(key).disabled = !editable;
  if ($('active-window-row')) $('active-window-row').hidden = $('mode').value !== 'active';
  $('round-status').textContent = { ready: 'Ready to start', open: '● Entries open', closed: 'Entries closed', drawn: 'Winner drawn' }[round.status];
  $('round-status').className = `pill ${round.status === 'open' ? 'open' : ''}`;
  $('open').hidden = !['ready', 'closed'].includes(round.status); $('open').textContent = round.status === 'closed' ? 'Reopen Entries' : 'Open Entries';
  $('close').hidden = round.status !== 'open'; $('draw').hidden = round.status !== 'closed'; $('draw').disabled = !round.entrants.some(e => e.weight > 0);
  $('new').hidden = !['drawn', 'closed'].includes(round.status);
  $('entry-count').textContent = round.entrants.length;
  renderEntrants();
  $('chat-dot').className = `chat-dot ${connection.status === 'connected' ? 'live' : ''}`;
  $('chat-footer').textContent = `${round.mode === 'active' ? `Active viewers · last ${round.activeMinutes} min` : `Watching for ${round.keyword}`} · ${round.status === 'open' ? 'Collecting entries' : 'Entries paused'}`;
  $('chat').innerHTML = state.chat.length ? state.chat.slice(-20).map(c => `<div class="chat-line"><strong>${escapeHtml(c.displayName)}</strong> ${escapeHtml(c.text)}${c.entered ? '<span class="entry-tag">ENTERED</span>' : ''}</div>`).join('') : `<div class="chat-empty">${demo ? 'Demo entrants are ready. Close entries and draw a winner to try it out.' : escapeHtml(connection.message)}</div>`;
  $('chat').scrollTop = $('chat').scrollHeight;
  $('winner').className = `winner-body ${round.winner ? 'selected' : ''}`;
  $('winner').innerHTML = round.winner ? `<h3>${escapeHtml(round.winner.displayName)}</h3><p>${round.winner.firstWin ? 'First recorded win' : 'Previous winner'} · ${pct(round.winner.odds)} chance</p><a class="winner-channel" href="https://www.twitch.tv/${encodeURIComponent(round.winner.login)}" target="_blank" rel="noopener noreferrer">View Channel ↗</a>` : '<p>No winner selected. Close entries and click <strong>Roll It!</strong> to pick a winner.</p>';
  $('copy-winner').hidden = !round.winner;
  if ($('announce-winner')) $('announce-winner').hidden = !round.winner || !state.canSend;
  if ($('reset-eligibility')) $('reset-eligibility').disabled = !['open', 'closed'].includes(round.status);
  $('history-count').textContent = history.length;
  $('history-empty').hidden = history.length > 0;
  $('history-rows').innerHTML = [...history].reverse().slice(0, 100).map(h => `<tr><td class="viewer">${escapeHtml(h.displayName)}</td><td>${escapeHtml(h.title)}</td><td>${escapeHtml(new Date(h.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</td><td><span class="weight ${h.imported || !h.firstWin ? 'normal' : ''}">${h.imported ? 'Imported winner' : h.firstWin ? '✧ First win' : 'Returning winner'}</span></td></tr>`).join('');
  window.renderBot?.(state);
}
function renderEntrants() {
  if (!state) return;
  const query = $('search').value.toLowerCase();
  const entrants = state.round.entrants.filter(e => `${e.login} ${e.displayName}`.toLowerCase().includes(query));
  $('empty').hidden = state.round.entrants.length > 0;
  $('entrants').innerHTML = entrants.slice(0, 500).map(e => `<tr class="${e.blocked ? 'ineligible' : ''}"><td><button class="eligibility-check ${e.blocked ? '' : 'checked'}" data-remove="${escapeHtml(e.login)}" ${['open', 'closed'].includes(state.round.status) ? '' : 'disabled'} aria-label="${e.excluded ? 'Include' : 'Exclude'} ${escapeHtml(e.login)}" aria-pressed="${!e.blocked}">${e.blocked ? '' : '✓'}</button></td><td class="viewer" title="${e.wins} recorded wins">${escapeHtml(e.displayName)}<small>${e.wins ? `${e.wins} past ${e.wins === 1 ? 'win' : 'wins'}` : 'Never won'}</small></td><td><span class="weight ${e.wins || e.blocked ? 'normal' : ''}">${e.blocked ? escapeHtml(e.reason) : `${(e.weight / 100).toFixed(2)}×`}</span></td><td>${pct(e.odds)}</td></tr>`).join('');
  $('pool-footer').textContent = `${entrants.length > 500 ? `Showing 500 of ${entrants.length} matching viewers. ` : ''}Exact chances update as viewers join. ${state.round.entrants.filter(e => e.blocked).length} ineligible.`;
}
for (const key of ['title', 'keyword', 'boost', 'cooldownMinutes']) $(key).addEventListener('input', () => { dirty = true; updateBoost(); });
$('search').addEventListener('input', renderEntrants);
$('entrants').addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) api('remove', { login: button.dataset.remove }); });
const settings = () => Object.fromEntries(['title', 'keyword', 'boost', 'cooldownMinutes', 'mode', 'activeMinutes', 'level'].filter(key => $(key)).map(key => [key, $(key).value]));
$('settings').addEventListener('submit', async event => { event.preventDefault(); dirty = false; if (await api('settings', settings())) toast('Giveaway rules saved.'); });
$('open').onclick = async () => { if (state.round.status === 'ready') { dirty = false; if (!await api('settings', settings())) return; } await api('open'); };
for (const name of ['close', 'draw', 'disconnect']) $(name).onclick = () => api(name);
$('new').onclick = () => { if (state.round.entrants.length && !state.round.winner && !confirm('Clear this entry pool and start a new giveaway?')) return; api('new'); };
$('demo').onclick = () => { if (state?.round.entrants.length && !confirm('Switch to the demo sandbox? This clears the current entry pool. Winner history is preserved.')) return; api('demo'); };
$('connect-open').onclick = () => { $('channel').value = state?.demo ? '' : state?.channel || ''; $('connect-dialog').showModal(); };
$('import-open').onclick = () => $('import-dialog').showModal();
document.querySelectorAll('.dismiss').forEach(button => button.onclick = () => button.closest('dialog').close());
$('connect-form').onsubmit = async event => { event.preventDefault(); if (state?.round.entrants.length && $('channel').value.toLowerCase() !== state.channel && !confirm('Switch channels and clear the current entry pool? Winner history is preserved.')) return; if (await api('connect', { channel: $('channel').value, token: $('token').value.trim() })) { $('token').value = ''; $('connect-dialog').close(); } };
$('import-form').onsubmit = async event => { event.preventDefault(); if (await api('import', { names: $('import-names').value })) { $('import-names').value = ''; $('import-dialog').close(); toast('Past winners imported.'); } };
$('copy-winner').onclick = async () => { try { await navigator.clipboard.writeText(`Congratulations @${state.round.winner.login}! You won ${state.round.title}!`); toast('Winner announcement copied. Paste it into Twitch chat.'); } catch { toast('Clipboard unavailable. Winner: ' + state.round.winner.login); } };
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ channel: state.channel, history: state.history }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `mitchlucky-${state.channel || 'channel'}-winners.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
const events = new EventSource('/api/events');
events.onmessage = event => render(JSON.parse(event.data));
events.onerror = () => { $('connection-badge').textContent = '● Dashboard reconnecting'; };
