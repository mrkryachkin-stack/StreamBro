// Profile manager smoke test — runs outside Electron with a stubbed safeStorage.

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streambro-profile-test-'));
const _origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => tmp,
        getVersion: () => '0.0.0',
        getLocale: () => 'ru-RU',
      },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
      },
      shell: { openExternal: () => {} },
      net: { request: () => ({ on: () => {}, write: () => {}, end: () => {} }) },
    };
  }
  return _origLoad.call(this, request, ...rest);
};

const settings = require('../settings');
const profile = require('../modules/profile-manager');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}

console.log('## profile-manager');

// Bootstrap with default settings
const s = settings.loadSettings();
profile.init(s, () => {});

// Public profile shape
const pub = profile.getPublic();
assert(pub && typeof pub === 'object', 'getPublic returns object');
assert(typeof pub.id === 'string' && pub.id.length >= 8, 'profile.id present');
assert(pub.statusManual === 'online', 'default status = online');
assert(pub.hasToken === false, 'no token initially');
assert(pub.registered === false, 'not registered initially');

// Update — allowed fields
let res = profile.update({ nickname: 'Tester', statusManual: 'gaming' });
assert(res.success, 'update success');
const pub2 = profile.getPublic();
assert(pub2.nickname === 'Tester', 'nickname updated');
assert(pub2.statusManual === 'gaming', 'status updated');

// Update — consents merge (must keep prior values, only override given)
profile.update({ consents: { bugReports: false } });
const pub3 = profile.getPublic();
assert(pub3.consents.bugReports === false, 'consent bugReports updated');
assert(typeof pub3.consents.tos === 'boolean', 'consent tos still present (preserved)');

// Token round-trip
profile.setToken('SECRET_TOKEN_123', { id: 'srv-42', nickname: 'Server Tester', email: 'a@b.c', avatar: '' });
assert(profile.getToken() === 'SECRET_TOKEN_123', 'token round-trip');
const pub4 = profile.getPublic();
assert(pub4.hasToken === true, 'hasToken=true after setToken');
assert(pub4.serverId === 'srv-42', 'serverId set from setToken');
assert(pub4.registered === true, 'registered=true after setToken');

// Logout clears token + serverId
profile.logout();
assert(profile.getToken() === '', 'token cleared on logout');
assert(profile.getPublic().registered === false, 'registered cleared on logout');

// Deep-link parsing
const ok = profile.handleDeepLink('streambro://login?token=DEEP_TOKEN&id=srv-9&nickname=DLUser&email=dl%40x.io');
assert(ok === true, 'handleDeepLink returns true for valid url');
assert(profile.getToken() === 'DEEP_TOKEN', 'deep-link token applied');
assert(profile.getPublic().nickname === 'DLUser', 'deep-link nickname applied');
assert(profile.getPublic().email === 'dl@x.io', 'deep-link email applied');

// Bad deep links rejected
assert(profile.handleDeepLink('') === false, 'empty url rejected');
assert(profile.handleDeepLink('https://x') === false, 'wrong-scheme rejected');
assert(profile.handleDeepLink('streambro://login') === false, 'no token rejected');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
Module._load = _origLoad;

if (failed > 0) { console.error('\n## profile: ' + failed + ' FAILED'); process.exit(1); }
console.log('\n## profile: all tests passed');
