// Keep the dashboard focused on entering, drawing, and remembering winners.
$('settings').insertAdjacentHTML('afterbegin', '<div class="giveaway-type-row"><label>Eligibility<select id="level"><option value="everyone">Everyone</option><option value="subscriber">Subscribers + Mods</option><option value="moderator">Moderators</option><option value="owner">Broadcaster</option><option value="regular" hidden>Regulars (previous setting)</option></select></label><label>Giveaway Type<select id="mode"><option value="keyword">Keyword</option><option value="active">Active User</option></select></label></div><label id="active-window-row" hidden>Active within (minutes)<input id="activeMinutes" type="number" value="5" min="1" max="60"></label>');
for (const key of ['mode', 'activeMinutes', 'level']) $(key).addEventListener('input', () => {
  dirty = true;
  $('active-window-row').hidden = $('mode').value !== 'active';
  document.querySelector('.keyword-row').hidden = $('mode').value === 'active';
});
$('search').insertAdjacentHTML('afterend', '<button id="reset-eligibility" class="button small" title="Reset eligibility" aria-label="Reset eligibility">↻</button>');
$('reset-eligibility').onclick = () => {
  if (confirm('Make every viewer in this pool ineligible? You can include them again with their checkboxes.')) api('reset-eligibility');
};
$('copy-winner').insertAdjacentHTML('afterend', '<button id="announce-winner" class="button primary" hidden>Send Congratulations</button>');
$('announce-winner').onclick = async () => { if (await api('announce')) toast(state.demo ? 'Demo congratulations added locally.' : 'Winner announcement sent to Twitch.'); };
function routeGiveaway() {
  const isHistory = location.hash === '#history';
  document.querySelector('.breadcrumb').textContent = `Control Panel / ${isHistory ? 'Winner History' : 'Giveaways'}`;
  document.querySelector('.dashboard-grid').hidden = isHistory;
  $('history').hidden = !isHistory;
  document.querySelector('.page-heading h1').innerHTML = isHistory ? 'Winner History' : 'Giveaways <small>Hunt. Before. Punt</small>';
  $('demo').hidden = isHistory;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.hash === (isHistory ? '#history' : '#giveaway')));
}
window.renderGiveawayUI = () => {
  document.querySelector('.keyword-row').hidden = $('mode').value === 'active';
};
window.addEventListener('hashchange', routeGiveaway);
routeGiveaway();
if (state) render(state);
