// StreamBro — bug reporter (main process)
// Stages local bug reports and uploads them to our backend when network is
// available + the user has consented. Offline reports queue up on disk under
// %APPDATA%/StreamBro/bug-reports/*.json so we never lose them.
//
// Privacy:
//   - Only fires if `settings.profile.consents.bugReports === true`.
//   - We strip stream keys / OAuth tokens / file paths under the user folder.
//   - The user can review the queue from Settings → Профиль.

const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');

let _settings = null;
let _onChange = () => {};
let _flushTimer = null;

function init(settingsRef, onChangeCb) {
  _settings = settingsRef;
  _onChange = typeof onChangeCb === 'function' ? onChangeCb : (() => {});
  _ensureDir();
  _refreshQueueSize();
  // Periodically retry sending queued reports (every 2 min)
  _flushTimer = setInterval(() => { flushQueue().catch(() => {}); }, 120000);
}

function shutdown() {
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
}

function _dir() {
  return path.join(app.getPath('userData'), 'bug-reports');
}

function _ensureDir() {
  try {
    const d = _dir();
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  } catch (e) {}
}

function _refreshQueueSize() {
  if (!_settings) return;
  try {
    const items = fs.readdirSync(_dir()).filter(n => n.endsWith('.json'));
    _settings.bugReports.queueSize = items.length;
    _onChange(_settings);
  } catch (e) { _settings.bugReports.queueSize = 0; }
}

function _scrub(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  // RTMP URLs with keys
  out = out.replace(/rtmps?:\/\/[^\s"]+/gi, 'rtmp://<server>/<key>');
  // Bearer tokens
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer <token>');
  // Sk_*** tokens
  out = out.replace(/\bsk_[A-Za-z0-9_-]{8,}/g, '<key>');
  // Home folder
  try {
    const home = (app && app.getPath('home')) || '';
    if (home) out = out.split(home).join('~');
  } catch (e) {}
  // E-mails (kebab-safe)
  out = out.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<email>');
  return out;
}

function _scrubReport(report) {
  const r = JSON.parse(JSON.stringify(report || {}));
  if (r.message) r.message = _scrub(String(r.message));
  if (r.stack)   r.stack   = _scrub(String(r.stack));
  if (r.context && typeof r.context === 'object') {
    for (const k of Object.keys(r.context)) {
      if (typeof r.context[k] === 'string') r.context[k] = _scrub(r.context[k]);
    }
  }
  return r;
}

// ─── Public API ───
function consented() {
  return !!(_settings && _settings.profile && _settings.profile.consents && _settings.profile.consents.bugReports);
}

function report(payload) {
  if (!_settings) return { success: false, error: 'not initialized' };
  if (!consented()) return { success: false, error: 'no consent' };

  const safe = _scrubReport({
    ...payload,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    locale: app.getLocale(),
    profileId: _settings.profile.id || '',
    serverId:  _settings.profile.serverId || '',
    ts: Date.now(),
  });

  try {
    _ensureDir();
    const fname = 'bug-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.json';
    fs.writeFileSync(path.join(_dir(), fname), JSON.stringify(safe, null, 2), 'utf-8');
    _refreshQueueSize();
  } catch (e) {
    return { success: false, error: e.message };
  }

  if (_settings.bugReports.autoSend) {
    flushQueue().catch(() => {});
  }
  return { success: true };
}

function _postOne(filePath) {
  return new Promise((resolve) => {
    let body;
    try {
      body = fs.readFileSync(filePath, 'utf-8');
    } catch (e) { return resolve({ ok: false, drop: true, error: 'read fail' }); }

    const endpoint = (_settings.bugReports && _settings.bugReports.endpoint) || '';
    if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
      return resolve({ ok: false, drop: false, error: 'no endpoint' });
    }
    let req;
    try {
      req = net.request({ method: 'POST', url: endpoint, headers: { 'Content-Type': 'application/json' } });
    } catch (e) { return resolve({ ok: false, drop: false, error: e.message }); }

    let timeout = setTimeout(() => { try { req.abort(); } catch (e) {} resolve({ ok: false, drop: false, error: 'timeout' }); }, 8000);

    req.on('response', (res) => {
      clearTimeout(timeout);
      if (res.statusCode >= 200 && res.statusCode < 300) resolve({ ok: true });
      else if (res.statusCode === 400 || res.statusCode === 413) resolve({ ok: false, drop: true, error: 'http ' + res.statusCode });
      else resolve({ ok: false, drop: false, error: 'http ' + res.statusCode });
      // Drain
      res.on('data', () => {}); res.on('end', () => {});
    });
    req.on('error', (err) => { clearTimeout(timeout); resolve({ ok: false, drop: false, error: err.message }); });
    try { req.write(body); req.end(); }
    catch (e) { clearTimeout(timeout); resolve({ ok: false, drop: false, error: e.message }); }
  });
}

async function flushQueue() {
  if (!_settings || !consented()) return { sent: 0 };
  let files = [];
  try { files = fs.readdirSync(_dir()).filter(n => n.endsWith('.json')); }
  catch (e) { return { sent: 0 }; }
  let sent = 0;
  for (const name of files) {
    const fp = path.join(_dir(), name);
    const result = await _postOne(fp);
    if (result.ok) {
      try { fs.unlinkSync(fp); } catch (e) {}
      sent++;
    } else if (result.drop) {
      // Bad request → drop so we don't loop forever
      try { fs.unlinkSync(fp); } catch (e) {}
    } else {
      // Network error → keep file, try again later
      break;
    }
  }
  if (sent > 0) {
    _settings.bugReports.lastSentAt = Date.now();
    _refreshQueueSize();
  }
  return { sent };
}

function getQueueSize() {
  _refreshQueueSize();
  return (_settings && _settings.bugReports && _settings.bugReports.queueSize) || 0;
}

function clearQueue() {
  try {
    const files = fs.readdirSync(_dir()).filter(n => n.endsWith('.json'));
    for (const name of files) { try { fs.unlinkSync(path.join(_dir(), name)); } catch (e) {} }
  } catch (e) {}
  _refreshQueueSize();
  return { success: true };
}

module.exports = {
  init,
  shutdown,
  report,
  flushQueue,
  getQueueSize,
  clearQueue,
  consented,
};
