// StreamBro — auto-updater wrapper (main process)
// Two-tier update system:
//   1. electron-updater — full auto-update with delta patches (needs NSIS build + publish host)
//   2. HTTP fallback — simple version check against a JSON file on our website,
//      shows a "new version available" toast with a download link in browser.
//      Works with portable .zip distribution, no special server needed.

const { net } = require('electron');

let _autoUpdater = null;
let _emit = () => {};
let _settings = null;
let _checkTimer = null;
let _appVersion = '0.0.0';

const CHECK_URL = 'https://streambro.ru/api/updates/win/latest.json';
// Expected JSON format:
// { "version": "1.1.1", "date": "2026-05-15", "changelog": "Fixed chat, added sounds",
//   "downloadUrl": "https://streambro.ru/download/StreamBro-1.1.1-portable.zip",
//   "sha512": "..." }

function _tryLoad() {
  if (_autoUpdater) return _autoUpdater;
  try {
    _autoUpdater = require('electron-updater').autoUpdater;
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Updater] electron-updater not available, using HTTP fallback');
    }
    _autoUpdater = null;
  }
  return _autoUpdater;
}

function _semverGt(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

function init(settingsRef, emitCb, appVersion) {
  _settings = settingsRef;
  _emit = typeof emitCb === 'function' ? emitCb : (() => {});
  _appVersion = appVersion || '0.0.0';

  const u = _tryLoad();
  if (u) {
    u.autoDownload = !!(_settings.updates && _settings.updates.autoDownload);
    u.autoInstallOnAppQuit = !!(_settings.updates && _settings.updates.autoInstallOnQuit);
    u.allowPrerelease = (_settings.updates && _settings.updates.channel) === 'beta';

    u.on('checking-for-update', () => _emit('update-state', { state: 'checking' }));
    u.on('update-available',    (info) => _emit('update-state', { state: 'available', version: info.version, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate }));
    u.on('update-not-available',(info) => _emit('update-state', { state: 'up-to-date', version: info.version }));
    u.on('error',               (err)  => _emit('update-state', { state: 'error', reason: err.message }));
    u.on('download-progress',   (p)    => _emit('update-state', { state: 'downloading', percent: Math.round(p.percent), bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
    u.on('update-downloaded',   (info) => _emit('update-state', { state: 'downloaded', version: info.version, releaseNotes: info.releaseNotes }));
  }

  // Periodic check (every 6h) when autoCheck is on
  if (_settings.updates && _settings.updates.autoCheck) {
    setTimeout(() => { check().catch(() => {}); }, 30000);
    _checkTimer = setInterval(() => { check().catch(() => {}); }, 6 * 60 * 60 * 1000);
  }
}

function shutdown() {
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null; }
}

async function check() {
  if (_settings && _settings.updates) _settings.updates.lastCheckAt = Date.now();

  // Try electron-updater first (full auto-update with NSIS)
  const u = _tryLoad();
  if (u) {
    try {
      const result = await u.checkForUpdates();
      return { success: true, version: result?.updateInfo?.version || null, method: 'electron-updater' };
    } catch (e) {
      // electron-updater failed (no publish host, dev mode, etc.) — fall through to HTTP check
    }
  }

  // Fallback: HTTP version check (works for portable .zip distribution)
  return _httpCheck();
}

function _httpCheck() {
  return new Promise((resolve) => {
    _emit('update-state', { state: 'checking' });

    let req;
    try {
      req = net.request({ method: 'GET', url: CHECK_URL });
    } catch (e) {
      _emit('update-state', { state: 'up-to-date', version: _appVersion });
      resolve({ success: true, method: 'http-fallback', available: false });
      return;
    }

    const timeout = setTimeout(() => {
      try { req.abort(); } catch (e) {}
      _emit('update-state', { state: 'up-to-date', version: _appVersion });
      resolve({ success: true, method: 'http-fallback', available: false });
    }, 8000);

    let body = '';
    req.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        clearTimeout(timeout);
        _emit('update-state', { state: 'up-to-date', version: _appVersion });
        resolve({ success: true, method: 'http-fallback', available: false });
        res.on('data', () => {}); res.on('end', () => {});
        return;
      }
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const info = JSON.parse(body);
          if (info.version && _semverGt(info.version, _appVersion)) {
            _emit('update-state', {
              state: 'available',
              version: info.version,
              changelog: info.changelog || '',
              downloadUrl: info.downloadUrl || '',
              date: info.date || '',
            });
            resolve({ success: true, method: 'http-fallback', available: true, info });
          } else {
            _emit('update-state', { state: 'up-to-date', version: _appVersion });
            resolve({ success: true, method: 'http-fallback', available: false });
          }
        } catch (e) {
          _emit('update-state', { state: 'up-to-date', version: _appVersion });
          resolve({ success: true, method: 'http-fallback', available: false });
        }
      });
    });
    req.on('error', () => {
      clearTimeout(timeout);
      _emit('update-state', { state: 'up-to-date', version: _appVersion });
      resolve({ success: true, method: 'http-fallback', available: false });
    });
    req.end();
  });
}

async function download() {
  const u = _tryLoad();
  if (!u) return { success: false, error: 'updater not available (portable mode — use downloadUrl from version info)' };
  try { await u.downloadUpdate(); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

function quitAndInstall() {
  const u = _tryLoad();
  if (!u) return { success: false, error: 'updater not available (portable mode — restart manually)' };
  try { u.quitAndInstall(false, true); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
}

function setChannel(channel) {
  if (!_settings) return { success: false };
  _settings.updates.channel = channel === 'beta' ? 'beta' : 'latest';
  const u = _tryLoad();
  if (u) u.allowPrerelease = _settings.updates.channel === 'beta';
  return { success: true };
}

module.exports = { init, shutdown, check, download, quitAndInstall, setChannel };
