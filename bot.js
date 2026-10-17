const { randomUUID } = require('node:crypto');
function defaults() { return { commands: [], timers: [], regulars: [], filters: { links: false, caps: false, repetitions: false, blacklist: '', exemptRegulars: true }, logs: [] }; }
function privileged(message, config) { return message.mod || message.broadcaster || (config.filters.exemptRegulars && config.regulars.includes(message.login)); }
function violation(message, config) {
  if (privileged(message, config)) return null;
  const text = message.text;
  if (config.filters.links && /(?:https?:\/\/|www\.)\S+/i.test(text)) return 'Links';
  const letters = text.replace(/[^a-z]/gi, '');
  if (config.filters.caps && letters.length >= 15 && letters.replace(/[^A-Z]/g, '').length / letters.length > .8) return 'Excessive capitals';
  if (config.filters.repetitions && /(.)\1{14,}/iu.test(text)) return 'Repeated characters';
  if (config.filters.blacklist.split('\n').map(x => x.trim().toLowerCase()).filter(Boolean).some(word => text.toLowerCase().includes(word))) return 'Blocked phrase';
  return null;
}
function variables(template, context) {
  return template.replace(/\$\((user|channel|query|touser|count)\)/g, (_, key) => String(context[key] ?? '')).replace(/[\r\n]/g, ' ').slice(0, 450);
}
function permitted(level, message, config) {
  if (message.broadcaster) return true;
  if (level === 'owner') return false;
  if (message.mod) return true;
  if (level === 'moderator') return false;
  if (level === 'regular') return config.regulars.includes(message.login);
  if (level === 'subscriber') return message.subscriber;
  return true;
}
function validateItem(type, body, previous = {}) {
  const message = String(body.message || '').trim();
  if (!message || message.length > 450 || /[\r\n]/.test(message)) throw new Error('Message must be a single line, 1–450 characters.');
  const name = String(body.name || '').trim();
  if (!name || name.length > 50 || (type === 'commands' && !/^!\S{1,29}$/.test(name))) throw new Error('Commands must start with ! and contain no spaces (up to 30 characters). Timer names can be up to 50 characters.');
  const item = { ...previous, id: previous.id || randomUUID(), name: type === 'commands' ? name.toLowerCase() : name, message, enabled: body.enabled !== false };
  if (type === 'commands') {
    const cooldown = Number(body.cooldown);
    if (!Number.isInteger(cooldown) || cooldown < 5 || cooldown > 3600) throw new Error('Command cooldown must be 5–3600 seconds.');
    if (!['everyone', 'regular', 'subscriber', 'moderator', 'owner'].includes(body.level)) throw new Error('Invalid command user level.');
    Object.assign(item, { cooldown, level: body.level, count: previous.count || 0 });
  } else {
    const interval = Number(body.interval), lines = Number(body.lines);
    if (!Number.isInteger(interval) || interval < 1 || interval > 1440 || !Number.isInteger(lines) || lines < 1 || lines > 1000) throw new Error('Timer interval must be 1–1440 minutes; chat lines must be 1–1000.');
    Object.assign(item, { interval, lines });
  }
  return item;
}
module.exports = { defaults, violation, variables, permitted, validateItem };
