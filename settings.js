// StreamBro — persistent user settings
// JSON file in app.getPath('userData')/settings.json
// Stream keys are encrypted via Electron safeStorage (DPAPI on Windows)

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

// v2 introduces profile / friends / sound / bugReports / updates blocks (1.1.0)
const SETTINGS_VERSION = 2;
const SETTINGS_FILE = 'settings.json';

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  ui: {
    theme: 'dark',           // 'dark' | 'light' | 'system'
    accentColor: '#ffd23c',
    targetFps: 60,           // canvas render fps
    reducedMotion: false,    // disables frame animations when GPU is slow
    showSafeAreas: false,
    showGrid: false,
  },
  stream: {
    platform: 'twitch',
    customServer: '',
    resolution: '1280x720',
    bitrate: 6000,
    fps: 30,
    keyEncrypted: null,      // base64-encoded ciphertext from safeStorage
  },
  audio: {
    monitoringEnabled: true,
    sampleRate: 48000,
  },
  recording: {
    outputFolder: '',        // '' = default (Videos/StreamBro)
    autoConvertToMp4: true,
  },
  signaling: {
    server: 'ws://localhost:7890',
    turnUrl:  '',
    turnUser: '',
    turnPass: '',
  },
  // per-source state by name (we cannot rely on stable IDs across restarts):
  fxStateByName: {},

  // ─── Profile / account (1.1.0) ───
  // Persistent identity. Without server we keep a local "dev" profile so the
  // user can use the app right away. When the server side lands, `serverId` /
  // `token` gets populated by the OAuth-style flow (deep link streambro://login).
  profile: {
    id: '',                  // local-only uuid (assigned on first launch)
    serverId: '',            // assigned by streambro.online after registration
    token: '',               // session token (encrypted via safeStorage when stored)
    tokenEncrypted: null,    // {enc:base64} | null
    nickname: 'StreamBro User',
    email: '',
    avatar: '',              // dataURL or remote URL
    statusManual: 'online',  // 'online'|'offline'|'streaming'|'gaming'|'away'|'dnd'|'invisible'
    autoStreamingStatus: true, // auto-flip to "streaming" when stream starts
    registered: false,       // true after server-side signup
    consents: {
      bugReports: true,      // user agreed to send anonymized bug reports
      analytics: false,      // future: feature usage stats
      tos: false,            // accepted terms of service
    },
  },

  // ─── Friends (1.1.0) ───
  // Local cache of friends + chat history. Real source of truth will be the
  // server (see docs/SERVER_PLAN.md). Cache lives so the UI works offline.
  friends: {
    list: [],                // [{id, nickname, avatar, status, lastSeen, addedAt}]
    requests: {
      incoming: [],          // [{id, from, fromNickname, fromAvatar, sentAt, message}]
      outgoing: [],          // [{id, to, toNickname, sentAt, message}]
    },
    chats: {},               // { friendId: [{id, from, text, ts, read}] }
    unread: {},              // { friendId: count }
  },

  // ─── Sounds (1.1.0) ───
  sound: {
    enabled: true,
    volume: 0.4,             // 0..1 master volume for app sounds
    perEvent: {              // null = use default; false = muted; number = override volume
      error: null,
      message: null,
      friendOnline: null,
      streamStart: null,
      streamStop: null,
      streamError: null,
      success: null,
      notification: null,
    },
  },

  // ─── Bug reports (1.1.0) ───
  bugReports: {
    queueSize: 0,            // pending reports waiting for upload
    lastSentAt: 0,
    endpoint: 'https://streambro.ru/api/bugs',  // override if self-hosted
    autoSend: true,          // send when network available
  },

  // ─── Auto-update (1.1.0) ───
  updates: {
    channel: 'latest',       // 'latest' | 'beta'
    autoCheck: true,
    autoDownload: true,
    autoInstallOnQuit: true,
    lastCheckAt: 0,
    skippedVersion: '',      // user pressed "skip this version"
  },
};

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

function _deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) {
      target[k] = _deepMerge(target[k] || {}, source[k]);
    } else {
      target[k] = source[k];
    }
  }
  return target;
}

function _migrate(parsed) {
  // v1 → v2: add profile/friends/sound/bugReports/updates blocks
  if (!parsed.version || parsed.version < 2) {
    if (!parsed.profile) {
      parsed.profile = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.profile));
    }
    if (!parsed.friends) {
      parsed.friends = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.friends));
    }
    if (!parsed.sound) {
      parsed.sound = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.sound));
    }
    if (!parsed.bugReports) {
      parsed.bugReports = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.bugReports));
    }
    if (!parsed.updates) {
      parsed.updates = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.updates));
    }
  }
  return parsed;
}

function _ensureProfileId(s) {
  if (!s.profile) s.profile = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.profile));
  if (!s.profile.id) {
    try { s.profile.id = require('crypto').randomUUID(); }
    catch (e) { s.profile.id = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10); }
  }
  return s;
}

function loadSettings() {
  try {
    const p = getSettingsPath();
    if (!fs.existsSync(p)) {
      const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      return _ensureProfileId(fresh);
    }
    const raw = fs.readFileSync(p, 'utf-8');
    let parsed = JSON.parse(raw);
    parsed = _migrate(parsed);
    const merged = _deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), parsed);
    merged.version = SETTINGS_VERSION;
    return _ensureProfileId(merged);
  } catch (e) {
    console.error('[Settings] Load failed, using defaults:', e.message);
    const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return _ensureProfileId(fresh);
  }
}

function saveSettings(settings) {
  try {
    const p = getSettingsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to .tmp then rename
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), { encoding: 'utf-8' });
    fs.renameSync(tmp, p);
    return { success: true };
  } catch (e) {
    console.error('[Settings] Save failed:', e.message);
    return { success: false, error: e.message };
  }
}

// ─── Encrypted secrets (stream keys) ───
// We never expose plaintext keys to the renderer except when explicitly requested
// for the stream start. Even then, the renderer never persists it.

function encryptSecret(plain) {
  if (!plain) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[Settings] safeStorage NOT available — secrets stored in plaintext (NOT recommended)');
      return { plaintext: plain };
    }
    const buf = safeStorage.encryptString(String(plain));
    return { enc: buf.toString('base64') };
  } catch (e) {
    console.error('[Settings] Encrypt failed:', e.message);
    return null;
  }
}

function decryptSecret(stored) {
  if (!stored) return '';
  try {
    if (stored.plaintext != null) return String(stored.plaintext);
    if (stored.enc) {
      if (!safeStorage.isEncryptionAvailable()) return '';
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
    }
    return '';
  } catch (e) {
    console.error('[Settings] Decrypt failed:', e.message);
    return '';
  }
}

module.exports = {
  loadSettings,
  saveSettings,
  encryptSecret,
  decryptSecret,
  getSettingsPath,
  DEFAULT_SETTINGS,
};
