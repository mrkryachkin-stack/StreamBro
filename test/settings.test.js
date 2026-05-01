// Settings module smoke test — exercises load/save/migration paths without Electron app.
// safeStorage is unavailable outside Electron; the encryptSecret falls back to plaintext (with warning).

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

// Stub Electron modules so we can require ./settings.js outside Electron
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streambro-test-'));
const Module = require('module');
const _origResolve = Module._resolveFilename;
const _origLoad = Module._load;
Module._load = function(request, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => name === 'userData' ? tmp : tmp,
        getVersion: () => '0.0.0',
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
      },
    };
  }
  return _origLoad.call(this, request, ...rest);
};

const settings = require('../settings');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}

console.log('## settings');

// Defaults present
const def = settings.loadSettings();
assert(def && def.ui && def.stream, 'defaults loaded');
assert(def.ui.theme === 'dark', 'default theme = dark');
assert(def.stream.platform === 'twitch', 'default platform = twitch');

// Save round-trip
const next = JSON.parse(JSON.stringify(def));
next.ui.theme = 'neon';
next.ui.targetFps = 30;
next.stream.bitrate = 4500;
next.stream.keyEncrypted = settings.encryptSecret('LIVE_secret_key_999');

const r = settings.saveSettings(next);
assert(r.success, 'saveSettings success');

const reloaded = settings.loadSettings();
assert(reloaded.ui.theme === 'neon', 'theme persisted');
assert(reloaded.ui.targetFps === 30, 'fps persisted');
assert(reloaded.stream.bitrate === 4500, 'bitrate persisted');
assert(typeof reloaded.stream.keyEncrypted === 'object' && reloaded.stream.keyEncrypted !== null, 'keyEncrypted is an object');

// Decryption round-trip (in this test it falls back to plaintext)
const dec = settings.decryptSecret(reloaded.stream.keyEncrypted);
assert(dec === 'LIVE_secret_key_999', 'decryptSecret round-trip');

// Empty/null inputs
assert(settings.encryptSecret('') === null || settings.encryptSecret('') === undefined, 'encrypt empty → null');
assert(settings.decryptSecret(null) === '', 'decrypt null → empty');
assert(settings.decryptSecret(undefined) === '', 'decrypt undefined → empty');

// 1.1.0 — new sections present in defaults
assert(def.profile && typeof def.profile === 'object', 'profile section exists');
assert(def.profile.statusManual === 'online', 'default status = online');
assert(def.friends && Array.isArray(def.friends.list), 'friends.list is array');
assert(def.sound && typeof def.sound.volume === 'number', 'sound.volume is number');
assert(def.bugReports && typeof def.bugReports.endpoint === 'string', 'bugReports.endpoint is string');
assert(def.updates && def.updates.channel === 'latest', 'updates.channel = latest');

// 1.1.0 — auto-assigned profile.id on first load (UUID-like)
assert(typeof def.profile.id === 'string' && def.profile.id.length >= 8, 'profile.id auto-assigned');

// v1 → v2 migration: write a v1-shaped file, reload, expect new sections to appear
const v1path = require('path').join(tmp, 'settings.json');
const v1payload = {
  version: 1,
  ui: { theme: 'light' },
  stream: { platform: 'kick' },
  audio: {}, recording: {}, signaling: {}, fxStateByName: {},
};
fs.writeFileSync(v1path, JSON.stringify(v1payload));
const migrated = settings.loadSettings();
assert(migrated.ui.theme === 'light', 'v1→v2: ui.theme preserved');
assert(migrated.stream.platform === 'kick', 'v1→v2: stream.platform preserved');
assert(migrated.profile && migrated.profile.statusManual === 'online', 'v1→v2: profile section added');
assert(migrated.sound && typeof migrated.sound.volume === 'number', 'v1→v2: sound section added');
assert(migrated.updates && migrated.updates.channel === 'latest', 'v1→v2: updates section added');
assert(migrated.version === 2, 'v1→v2: version bumped');

// Cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
Module._load = _origLoad;
Module._resolveFilename = _origResolve;

if (failed > 0) {
  console.error('\n## settings: ' + failed + ' FAILED');
  process.exit(1);
}
console.log('\n## settings: all tests passed');
