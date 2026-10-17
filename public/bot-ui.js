$('settings').insertAdjacentHTML('afterbegin', '<div class="giveaway-type-row"><label>Eligibility<select id="level"><option value="everyone">Everyone</option><option value="subscriber">Subscribers + Mods</option><option value="regular">Regulars + Mods</option><option value="moderator">Moderators</option><option value="owner">Broadcaster</option></select></label><label>Giveaway Type<select id="mode"><option value="active">Active User</option><option value="keyword">Keyword</option></select></label></div><label id="active-window-row" hidden>Active within (minutes)<input id="activeMinutes" type="number" value="5" min="1" max="60"></label>');
for (const key of ['mode', 'activeMinutes', 'level']) $(key).addEventListener('input', () => { dirty = true; $('active-window-row').hidden = $('mode').value !== 'active'; });
$('search').insertAdjacentHTML('afterend', '<button id="reset-eligibility" class="button small" title="Reset eligibility" aria-label="Reset eligibility">↻</button>');
$('reset-eligibility').onclick = () => { if (confirm('Make every viewer in this pool ineligible? You can include them again with their checkboxes.')) api('reset-eligibility'); };
$('copy-winner').insertAdjacentHTML('afterend', '<button id="announce-winner" class="button primary" hidden>Announce in Twitch chat</button>');
$('announce-winner').onclick = async () => { if (await api('announce')) toast('Winner announcement sent to Twitch.'); };
const botPages = document.createElement('div'); botPages.className = 'page-content bot-pages'; botPages.hidden = true; document.querySelector('main').append(botPages);
const botSections = { commands: ['⌘', 'Commands'], timers: ['◷', 'Timers'], regulars: ['♙', 'Regulars'], filters: ['♧', 'Spam Protection'], logs: ['▤', 'Logs'] };
const nav = document.querySelector('nav');
for (const [id, [icon, title]] of Object.entries(botSections)) { const a = document.createElement('a'); a.href = `#${id}`; a.innerHTML = `${icon} <span>${title}</span>`; nav.insertBefore(a, $('import-open')); }
let botRoute = '', itemType = 'commands';
const botDialog = document.createElement('dialog'); botDialog.id = 'bot-dialog';
botDialog.innerHTML = `<form id="bot-item-form"><div class="dialog-header"><h2 id="bot-dialog-title">Add command</h2><button type="button" id="bot-dialog-close" class="icon-button" aria-label="Close">×</button></div><input id="item-id" type="hidden"><label>NAME<input id="item-name" required maxlength="50" placeholder="!discord"></label><label>MESSAGE<input id="item-message" required maxlength="450" placeholder="Join our Discord: https://discord.gg/your-server"></label><p class="help">Variables: $(user), $(channel), $(query), $(touser), $(count).</p><div id="command-options"><label>USER LEVEL<select id="item-level"><option value="everyone">Everyone</option><option value="subscriber">Subscribers</option><option value="regular">Regulars</option><option value="moderator">Moderators</option><option value="owner">Owner</option></select></label><label>COOLDOWN (SECONDS)<input id="item-cooldown" type="number" min="5" max="3600" value="30"></label></div><div id="timer-options" hidden><label>INTERVAL (MINUTES)<input id="item-interval" type="number" min="1" max="1440" value="15"></label><label>MINIMUM CHAT LINES IN LAST 5 MINUTES<input id="item-lines" type="number" min="1" max="1000" value="5"></label></div><button type="submit" class="button primary">Submit</button></form>`;
document.body.append(botDialog);
$('bot-dialog-close').onclick = () => botDialog.close();
function showItem(type, id) {
  itemType = type; const item = state.bot[type].find(x => x.id === id);
  $('bot-dialog-title').textContent = `${item ? 'Edit' : 'Add'} ${type === 'commands' ? 'Command' : 'Timer'}`;
  $('item-id').value = item?.id || ''; $('item-name').value = item?.name || ''; $('item-message').value = item?.message || '';
  $('item-name').placeholder = type === 'commands' ? '!discord' : 'Discord reminder';
  $('item-level').value = item?.level || 'everyone'; $('item-cooldown').value = item?.cooldown || 30;
  $('item-interval').value = item?.interval || 15; $('item-lines').value = item?.lines || 5;
  $('command-options').hidden = type !== 'commands'; $('timer-options').hidden = type !== 'timers'; botDialog.showModal();
}
$('bot-item-form').onsubmit = async event => {
  event.preventDefault(); const id = $('item-id').value;
  const previous = state.bot[itemType].find(x => x.id === id);
  if (await api('bot/save', { type: itemType, id, name: $('item-name').value, message: $('item-message').value, level: $('item-level').value, cooldown: $('item-cooldown').value, interval: $('item-interval').value, lines: $('item-lines').value, enabled: previous?.enabled !== false })) { botDialog.close(); toast('Saved.'); }
};
function routeBot() {
  botRoute = location.hash.slice(1);
  const isBot = Boolean(botSections[botRoute]);
  const isHistory = botRoute === 'history';
  document.querySelector('.breadcrumb').textContent = `Control Panel / ${isBot ? botSections[botRoute][1] : isHistory ? 'Winner History' : 'Giveaways'}`;
  document.querySelector('main > .page-content').hidden = isBot; botPages.hidden = !isBot;
  document.querySelector('.dashboard-grid').hidden = isHistory;
  $('history').hidden = !isHistory;
  document.querySelector('main > .page-content .page-heading h1').innerHTML = isHistory ? 'Winner History' : 'Giveaways <small>Manage your channel giveaways</small>';
  $('demo').hidden = isHistory;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.hash === location.hash || (!location.hash && a.hash === '#giveaway')));
  if (state) window.renderBot(state);
}
window.addEventListener('hashchange', routeBot);
window.renderBot = function(snapshot) {
  if (!botSections[botRoute]) return;
  // Do not replace text fields while the operator is editing them.
  if (botPages.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const config = snapshot.bot;
  const header = `<div class="page-heading"><div><h1>${botSections[botRoute][1]}</h1><p>${{ commands: 'Create and manage custom chat commands.', timers: 'Post recurring messages when your chat is active.', regulars: 'Give trusted viewers access to regular-only commands.', filters: 'Configure automatic message filters for your channel.', logs: 'Recent bot commands, timer messages, and moderation events.' }[botRoute]}</p></div>${['commands', 'timers'].includes(botRoute) ? '<button class="button primary" id="add-item">+ Add ' + (botRoute === 'commands' ? 'Command' : 'Timer') + '</button>' : ''}</div>`;
  const notice = `<div class="bot-notice">${snapshot.demo ? 'Demo sandbox. Settings here are separate from your channel.' : snapshot.canSend ? 'Authenticated bot connected. Commands and enabled timers can send messages to chat.' : 'Connect with a Twitch token containing chat:read and chat:edit to enable command replies and timers.'}</div>`;
  let body = '';
  if (['commands', 'timers'].includes(botRoute)) {
    const items = config[botRoute];
    body = `<section class="card"><div class="table-scroll"><table><thead><tr><th>STATUS</th><th>NAME</th><th>MESSAGE</th><th>${botRoute === 'commands' ? 'USER LEVEL / COOLDOWN' : 'INTERVAL / CHAT LINES'}</th><th>ACTIONS</th></tr></thead><tbody>${items.map(item => `<tr><td><span class="pill ${item.enabled ? 'open' : ''}">${item.enabled ? 'Enabled' : 'Disabled'}</span></td><td class="viewer">${escapeHtml(item.name)}</td><td class="message-cell">${escapeHtml(item.message)}</td><td>${botRoute === 'commands' ? `${escapeHtml(item.level)} / ${item.cooldown}s` : `${item.interval} min / ${item.lines} lines`}</td><td><button class="button small" data-edit="${item.id}">Edit</button> <button class="button small" data-toggle="${item.id}">${item.enabled ? 'Disable' : 'Enable'}</button> <button class="button small" data-delete="${item.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>${items.length ? '' : '<div class="empty compact">No items yet. Click Add to create one.</div>'}</section><p class="help">${botRoute === 'commands' ? 'The built-in !commands lists enabled commands. Supported variables are shown in the command editor.' : 'Timers require both the interval and minimum chat activity. All outgoing messages share a rate limit; busy commands may delay timers.'}</p>`;
  } else if (botRoute === 'regulars') {
    body = `<section class="card form-card"><h2>Channel regulars</h2><p>One Twitch username per line. Changes replace your regulars list.</p><form id="regulars-form"><textarea id="regular-names" rows="12">${escapeHtml(config.regulars.join('\n'))}</textarea><button class="button primary" type="submit">Save regulars</button></form></section>`;
  } else if (botRoute === 'filters') {
    body = `<section class="card form-card"><h2>Spam filter settings</h2><p>Moderators and the broadcaster are exempt. Enabled filters delete matching messages when your token has <code>moderator:manage:chat_messages</code> and the bot is a channel moderator; otherwise detections are logged. Filtered messages cannot enter the giveaway.</p><form id="filters-form">${[['links', 'Links', 'Block http, https, and www links.'], ['caps', 'Excessive capitals', 'Over 80% capitals with at least 15 letters.'], ['repetitions', 'Repeated characters', '15 or more repeated characters.'], ['exemptRegulars', 'Exempt regulars', 'Allow regulars to bypass these filters.']].map(([key, label, description]) => `<label class="check-row"><input type="checkbox" id="filter-${key}" ${config.filters[key] ? 'checked' : ''}><div><strong>${label}</strong><small>${description}</small></div></label>`).join('')}<label>BLOCKED PHRASES (ONE PER LINE)<textarea id="filter-blacklist" rows="6">${escapeHtml(config.filters.blacklist)}</textarea></label><p class="help">Phrases match case-insensitive substrings. These are simple filters, not Twitch AutoMod.</p><button type="submit" class="button primary">Save filters</button></form></section>`;
  } else {
    body = `<section class="card"><div class="table-scroll"><table><thead><tr><th>TIME</th><th>TYPE</th><th>EVENT</th></tr></thead><tbody>${[...config.logs].reverse().map(log => `<tr><td>${escapeHtml(new Date(log.at).toLocaleString())}</td><td>${escapeHtml(log.type)}</td><td class="message-cell">${escapeHtml(log.message)}</td></tr>`).join('')}</tbody></table></div>${config.logs.length ? '' : '<div class="empty compact">Bot events will appear here. The latest 200 are saved.</div>'}</section>`;
  }
  botPages.innerHTML = header + notice + body;
  if ($('add-item')) $('add-item').onclick = () => showItem(botRoute);
  botPages.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => showItem(botRoute, b.dataset.edit));
  botPages.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => api('bot/toggle', { type: botRoute, id: b.dataset.toggle }));
  botPages.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => { if (confirm('Delete this item?')) api('bot/delete', { type: botRoute, id: b.dataset.delete }); });
  if ($('regulars-form')) $('regulars-form').onsubmit = async event => { event.preventDefault(); if (await api('bot/regulars', { names: $('regular-names').value })) toast('Regulars saved.'); };
  if ($('filters-form')) $('filters-form').onsubmit = async event => { event.preventDefault(); const body = Object.fromEntries(['links', 'caps', 'repetitions', 'exemptRegulars'].map(key => [key, $(`filter-${key}`).checked])); body.blacklist = $('filter-blacklist').value; if (await api('bot/filters', body)) toast('Spam filters saved.'); };
};
routeBot();
// The initial state event can arrive before these controls finish loading.
if (state) render(state);
