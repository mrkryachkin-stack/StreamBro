// StreamBro — friends store (main process)
// Local cache + thin server adapter. Real source of truth is the backend
// (see docs/SERVER_PLAN.md). When the backend isn't reachable we operate from
// the local cache so the UI stays functional offline.
//
// All mutations go through this module so we have a single place to wire the
// server sync later. Each method returns a structured result and emits
// 'friends-changed' / 'friends-message' through the onChange callback for the
// renderer to react to.

const settingsMod = require('../settings');

let _settings = null;
let _onChange = () => {};
let _emit = () => {};

const STATUSES = ['online', 'offline', 'streaming', 'gaming', 'away', 'dnd', 'invisible'];

function init(settingsRef, onChangeCb, emitCb) {
  _settings = settingsRef;
  _onChange = typeof onChangeCb === 'function' ? onChangeCb : (() => {});
  _emit = typeof emitCb === 'function' ? emitCb : (() => {});
  if (!_settings.friends) {
    _settings.friends = { list: [], requests: { incoming: [], outgoing: [] }, chats: {}, unread: {} };
  }
}

function _save() {
  if (!_settings) return { success: false };
  const res = settingsMod.saveSettings(_settings);
  if (res.success) _onChange(_settings);
  return res;
}

function _uid(prefix) {
  try { return prefix + '-' + require('crypto').randomUUID(); } catch (e) {}
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

function _genCode() {
  // 8-char human-readable invite code (no ambiguous chars)
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

// ─── Read ───
function listFriends() {
  if (!_settings) return [];
  return JSON.parse(JSON.stringify(_settings.friends.list || []));
}

function listRequests() {
  if (!_settings) return { incoming: [], outgoing: [] };
  return JSON.parse(JSON.stringify(_settings.friends.requests || { incoming: [], outgoing: [] }));
}

function getChat(friendId) {
  if (!_settings || !friendId) return [];
  return JSON.parse(JSON.stringify(_settings.friends.chats[friendId] || []));
}

function getUnreadCounts() {
  if (!_settings) return {};
  return { ...(_settings.friends.unread || {}) };
}

// ─── Friendship mutations ───
// In the local-only mode we accept any "add by code" request immediately so
// you can create two profiles and test the UI. Server mode will gate this with
// a real server response.
function sendFriendRequest({ code, nickname, message }) {
  if (!_settings) return { success: false };
  const id = _uid('fr');
  _settings.friends.requests.outgoing.push({
    id,
    code: String(code || '').toUpperCase(),
    toNickname: nickname || ('User ' + (code || '').slice(0, 4)),
    sentAt: Date.now(),
    message: String(message || '').slice(0, 280),
  });
  _save();
  _emit('friends-changed', { reason: 'request-sent' });
  return { success: true, id };
}

// Local-only "auto-accept" — useful for development. Adds a stub friend with
// random server id and a chat history channel so the rest of the UI can work.
function devAddFriend({ nickname, status }) {
  if (!_settings) return { success: false };
  const id = _uid('friend');
  const friend = {
    id,
    serverId: '',
    nickname: nickname || ('Друг ' + Math.floor(Math.random() * 99 + 1)),
    avatar: '',
    status: STATUSES.includes(status) ? status : 'offline',
    lastSeen: Date.now(),
    addedAt: Date.now(),
  };
  _settings.friends.list.push(friend);
  _settings.friends.chats[id] = [];
  _settings.friends.unread[id] = 0;
  _save();
  _emit('friends-changed', { reason: 'friend-added', friend });
  return { success: true, friend };
}

function removeFriend(friendId) {
  if (!_settings || !friendId) return { success: false };
  const before = _settings.friends.list.length;
  _settings.friends.list = _settings.friends.list.filter(f => f.id !== friendId);
  delete _settings.friends.chats[friendId];
  delete _settings.friends.unread[friendId];
  _save();
  _emit('friends-changed', { reason: 'friend-removed', friendId });
  return { success: _settings.friends.list.length < before };
}

function setFriendStatus(friendId, status) {
  if (!_settings || !friendId) return { success: false };
  if (!STATUSES.includes(status)) return { success: false, error: 'bad status' };
  const f = _settings.friends.list.find(x => x.id === friendId);
  if (!f) return { success: false, error: 'not found' };
  f.status = status;
  f.lastSeen = Date.now();
  _save();
  _emit('friends-changed', { reason: 'friend-status', friendId, status });
  return { success: true };
}

// ─── Chat ───
function sendMessage({ friendId, text, fromMe }) {
  if (!_settings || !friendId) return { success: false };
  const txt = String(text || '').trim();
  if (!txt) return { success: false, error: 'empty' };
  if (!_settings.friends.chats[friendId]) _settings.friends.chats[friendId] = [];
  const msg = {
    id: _uid('m'),
    from: fromMe ? 'me' : friendId,
    text: txt.slice(0, 2000),
    ts: Date.now(),
    read: !!fromMe,
  };
  _settings.friends.chats[friendId].push(msg);
  // Trim history (keep last 500 msgs per chat)
  if (_settings.friends.chats[friendId].length > 500) {
    _settings.friends.chats[friendId] = _settings.friends.chats[friendId].slice(-500);
  }
  if (!fromMe) {
    _settings.friends.unread[friendId] = (_settings.friends.unread[friendId] || 0) + 1;
  }
  _save();
  _emit('friends-message', { friendId, msg });
  return { success: true, msg };
}

function markRead(friendId) {
  if (!_settings || !friendId) return { success: false };
  _settings.friends.unread[friendId] = 0;
  const chat = _settings.friends.chats[friendId] || [];
  for (const m of chat) m.read = true;
  _save();
  _emit('friends-changed', { reason: 'marked-read', friendId });
  return { success: true };
}

// ─── Dev helper: simulate inbound message (so we can test pulse/chat UI) ───
function devSimulateInbound(friendId, text) {
  return sendMessage({ friendId, text, fromMe: false });
}

module.exports = {
  init,
  STATUSES,
  listFriends,
  listRequests,
  getChat,
  getUnreadCounts,
  sendFriendRequest,
  devAddFriend,
  removeFriend,
  setFriendStatus,
  sendMessage,
  markRead,
  devSimulateInbound,
  _genCode,
};
