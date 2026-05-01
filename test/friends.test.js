// Friends store smoke test — runs outside Electron (stubbed safeStorage).

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streambro-friends-test-'));
const _origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: () => tmp, getVersion: () => '0.0.0', getLocale: () => 'ru-RU' },
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: (s) => Buffer.from(s, 'utf8'),
        decryptString: (b) => b.toString('utf8'),
      },
      shell: { openExternal: () => {} },
      net:   { request: () => ({ on: () => {}, write: () => {}, end: () => {} }) },
    };
  }
  return _origLoad.call(this, request, ...rest);
};

const settings = require('../settings');
const friends = require('../modules/friends-store');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}

console.log('## friends-store');

const events = [];
const s = settings.loadSettings();
friends.init(s, () => {}, (channel, data) => events.push({ channel, data }));

// Initial state
assert(Array.isArray(friends.listFriends()), 'listFriends returns array');
assert(friends.listFriends().length === 0, 'no friends initially');

// Statuses constant
assert(friends.STATUSES.includes('streaming'), 'STATUSES includes streaming');
assert(friends.STATUSES.includes('invisible'), 'STATUSES includes invisible');

// Dev-add a friend
const r1 = friends.devAddFriend({ nickname: 'Buddy A', status: 'online' });
assert(r1.success, 'devAddFriend success');
assert(r1.friend && r1.friend.nickname === 'Buddy A', 'friend nickname set');
assert(friends.listFriends().length === 1, 'list size = 1 after add');
assert(events.some(e => e.channel === 'friends-changed' && e.data.reason === 'friend-added'), 'friend-added event emitted');

// Set status
const fid = r1.friend.id;
const r2 = friends.setFriendStatus(fid, 'gaming');
assert(r2.success, 'setFriendStatus success');
assert(friends.listFriends()[0].status === 'gaming', 'status applied');

// Bad status rejected
const r3 = friends.setFriendStatus(fid, 'wat');
assert(!r3.success, 'bad status rejected');

// Send a message (from me)
const m1 = friends.sendMessage({ friendId: fid, text: 'hello!', fromMe: true });
assert(m1.success, 'sendMessage success');
const chat = friends.getChat(fid);
assert(chat.length === 1, 'chat has 1 msg');
assert(chat[0].from === 'me', 'msg.from = me');

// Inbound (simulated)
const m2 = friends.devSimulateInbound(fid, 'sup?');
assert(m2.success, 'inbound success');
assert(friends.getChat(fid).length === 2, 'chat has 2 msgs');
assert(friends.getUnreadCounts()[fid] === 1, 'unread counter incremented');
assert(events.some(e => e.channel === 'friends-message'), 'friends-message event emitted');

// Mark read clears unread
friends.markRead(fid);
assert((friends.getUnreadCounts()[fid] || 0) === 0, 'unread cleared');

// Empty text rejected
const m3 = friends.sendMessage({ friendId: fid, text: '   ', fromMe: true });
assert(!m3.success, 'empty msg rejected');

// Friend request (outgoing) is queued
const r4 = friends.sendFriendRequest({ code: 'ABCD-1234', message: 'hi' });
assert(r4.success, 'sendFriendRequest success');
assert(friends.listRequests().outgoing.length === 1, 'outgoing request stored');
assert(friends.listRequests().outgoing[0].code === 'ABCD-1234', 'request code preserved');

// Remove friend
const r5 = friends.removeFriend(fid);
assert(r5.success, 'removeFriend success');
assert(friends.listFriends().length === 0, 'friend removed from list');
assert(friends.getChat(fid).length === 0, 'chat history removed too');

// Code generator never has ambiguous chars
const code = friends._genCode();
assert(/^[A-HJ-NP-Z2-9]{8}$/.test(code), '_genCode shape (no ambiguous chars)');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
Module._load = _origLoad;

if (failed > 0) { console.error('\n## friends: ' + failed + ' FAILED'); process.exit(1); }
console.log('\n## friends: all tests passed');
