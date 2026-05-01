// StreamBro — profile manager (main process)
// Encapsulates user identity / session token / OAuth-style deep-link login.
//
// Storage model:
//   - settings.profile.{id, nickname, email, avatar, statusManual, ...}
//   - settings.profile.tokenEncrypted — session token encrypted via safeStorage
//
// Login flow (when server is online):
//   1. Renderer calls profile.openSignupPage() → main shells external URL.
//   2. Browser registers user, redirects to streambro://login?token=XYZ&email=...
//   3. OS routes the deep link to our app (registered as default protocol handler).
//   4. main.handleDeepLink('streambro://login?token=...') → updateToken().
//   5. Renderer is notified ('profile-updated' event) and refreshes UI.

const { safeStorage, shell } = require('electron');
const settingsMod = require('../settings');

const SIGNUP_URL  = 'https://streambro.ru/signup';
const LOGIN_URL   = 'https://streambro.ru/login';
const PROFILE_URL = 'https://streambro.ru/profile';

let _settings = null;
let _onChange = () => {};

function init(settingsRef, onChangeCb) {
  _settings = settingsRef;
  _onChange = typeof onChangeCb === 'function' ? onChangeCb : (() => {});
}

function _save() {
  if (!_settings) return { success: false, error: 'not initialized' };
  const res = settingsMod.saveSettings(_settings);
  if (res.success) _onChange(_settings);
  return res;
}

// ─── Public profile (safe to expose to renderer) ───
// We never expose the plaintext token unless explicitly requested for an HTTP call.
function getPublic() {
  if (!_settings) return null;
  const p = _settings.profile;
  return {
    id: p.id,
    serverId: p.serverId,
    nickname: p.nickname,
    email: p.email,
    avatar: p.avatar,
    statusManual: p.statusManual,
    autoStreamingStatus: p.autoStreamingStatus,
    registered: !!p.registered,
    consents: { ...(p.consents || {}) },
    hasToken: !!(p.tokenEncrypted),
  };
}

function update(patch) {
  if (!_settings || !patch) return { success: false };
  const allowed = ['nickname', 'email', 'avatar', 'statusManual', 'autoStreamingStatus'];
  for (const k of allowed) {
    if (patch[k] !== undefined) _settings.profile[k] = patch[k];
  }
  if (patch.consents && typeof patch.consents === 'object') {
    _settings.profile.consents = { ..._settings.profile.consents, ...patch.consents };
  }
  return _save();
}

// ─── Token / session ───
function _encryptToken(plain) {
  if (!plain) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return { plaintext: plain };
    return { enc: safeStorage.encryptString(String(plain)).toString('base64') };
  } catch (e) {
    console.error('[Profile] encryptToken failed:', e.message);
    return null;
  }
}

function _decryptToken(stored) {
  if (!stored) return '';
  try {
    if (stored.plaintext != null) return String(stored.plaintext);
    if (stored.enc) {
      if (!safeStorage.isEncryptionAvailable()) return '';
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
    }
    return '';
  } catch (e) {
    console.error('[Profile] decryptToken failed:', e.message);
    return '';
  }
}

function setToken(token, serverProfile) {
  if (!_settings) return { success: false };
  _settings.profile.tokenEncrypted = _encryptToken(token);
  if (serverProfile && typeof serverProfile === 'object') {
    if (serverProfile.id) _settings.profile.serverId = String(serverProfile.id);
    if (serverProfile.nickname) _settings.profile.nickname = String(serverProfile.nickname);
    if (serverProfile.email) _settings.profile.email = String(serverProfile.email);
    if (serverProfile.avatar) _settings.profile.avatar = String(serverProfile.avatar);
    _settings.profile.registered = true;
  }
  return _save();
}

function getToken() {
  if (!_settings) return '';
  return _decryptToken(_settings.profile.tokenEncrypted);
}

function logout() {
  if (!_settings) return { success: false };
  _settings.profile.tokenEncrypted = null;
  _settings.profile.serverId = '';
  _settings.profile.registered = false;
  return _save();
}

// ─── Deep-link handling: streambro://login?token=...&id=...&nickname=... ───
function handleDeepLink(url) {
  if (typeof url !== 'string' || !url.startsWith('streambro://')) return false;
  try {
    const u = new URL(url);
    if (u.host !== 'login' && u.pathname !== '/login') return false;
    const token = u.searchParams.get('token');
    if (!token) return false;
    const serverProfile = {
      id: u.searchParams.get('id') || '',
      nickname: u.searchParams.get('nickname') || '',
      email: u.searchParams.get('email') || '',
      avatar: u.searchParams.get('avatar') || '',
    };
    setToken(token, serverProfile);
    return true;
  } catch (e) {
    console.error('[Profile] Bad deep link:', e.message);
    return false;
  }
}

function openSignup()  { shell.openExternal(SIGNUP_URL  + '?device=' + encodeURIComponent(_settings?.profile?.id || '')); }
function openLogin()   { shell.openExternal(LOGIN_URL   + '?device=' + encodeURIComponent(_settings?.profile?.id || '')); }
function openProfile() { shell.openExternal(PROFILE_URL); }

module.exports = {
  init,
  getPublic,
  update,
  setToken,
  getToken,
  logout,
  handleDeepLink,
  openSignup,
  openLogin,
  openProfile,
  SIGNUP_URL,
  LOGIN_URL,
  PROFILE_URL,
};
