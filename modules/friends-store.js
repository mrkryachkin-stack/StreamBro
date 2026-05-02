// StreamBro — friends store (main process)
// Local cache + server sync via server-api. When authenticated, mutations
// go to the server and the local cache is updated from the response.
// When offline/not-authenticated, operates from local cache only.

const settingsMod = require('../settings');
let _serverApi = null;

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

function setServerApi(api) {
  _serverApi = api;
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
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

function _isAuthenticated() {
  return _settings && _settings.profile && _settings.profile.registered && _settings.profile.tokenEncrypted;
}

// ─── Sync from server ───
async function syncFromServer() {
  if (!_isAuthenticated() || !_serverApi) return { synced: false };
  try {
    const [friendsRes, pendingRes] = await Promise.all([
      _serverApi.friendsList(),
      _serverApi.friendsPending(),
    ]);

    // Update local friends list from server
    if (friendsRes && friendsRes.ok && Array.isArray(friendsRes.data)) {
      _settings.friends.list = friendsRes.data.map(f => ({
        id: f.id || f.friendId,
        serverId: f.id || f.friendId,
        nickname: f.username || f.displayName || 'Друг',
        avatar: f.avatarUrl || '',
        status: f.status || 'offline',
        lastSeen: f.lastLoginAt ? new Date(f.lastLoginAt).getTime() : Date.now(),
        addedAt: f.createdAt ? new Date(f.createdAt).getTime() : Date.now(),
      }));
    }

    // Update pending requests from server
    if (pendingRes && pendingRes.ok && Array.isArray(pendingRes.data)) {
      _settings.friends.requests.incoming = pendingRes.data.map(r => ({
        id: r.friendshipId || r.id,
        fromNickname: r.displayName || r.username || 'Пользователь',
        fromId: r.id,
        message: r.message || '',
        receivedAt: r.requestedAt ? new Date(r.requestedAt).getTime() : Date.now(),
      }));
      _settings.friends.requests.outgoing = [];
    } else {
      // No outgoing from server yet — keep local
    }

    _save();
    _emit('friends-changed', { reason: 'synced' });
    return { synced: true };
  } catch (err) {
    console.warn('[Friends] sync failed:', err.message);
    return { synced: false, error: err.message };
  }
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
async function sendFriendRequest({ code, nickname, message }) {
  if (!_settings) return { success: false };
  console.log(`[Friends] sendFriendRequest: code="${code}", auth=${!!_isAuthenticated()}, hasApi=${!!_serverApi}`);

  // If authenticated, send request via server
  if (_isAuthenticated() && _serverApi) {
    try {
      // Search by username/code first
      const searchResult = await _serverApi.friendsSearch(code);
      console.log('[Friends] search result:', JSON.stringify(searchResult).slice(0, 300));
      if (!searchResult || !searchResult.ok) {
        const errMsg = (searchResult && searchResult.error) || 'Ошибка поиска';
        return { success: false, error: errMsg };
      }
      const users = searchResult.data;
      // If found users, send request to the first match
      if (Array.isArray(users) && users.length > 0) {
        const targetUser = users[0];
        console.log(`[Friends] found user: ${targetUser.username} (${targetUser.id})`);
        const result = await _serverApi.friendsRequest(targetUser.id);
        console.log('[Friends] request result:', JSON.stringify(result).slice(0, 200));
        if (result && !result.ok) {
          return { success: false, error: result.error || 'Ошибка отправки заявки' };
        }
        _emit('friends-changed', { reason: 'request-sent' });
        return { success: true, serverId: targetUser.id };
      }
      return { success: false, error: 'Пользователь не найден' };
    } catch (err) {
      console.warn('[Friends] server request failed:', err.message);
      // Fall through to local-only mode
    }
  }

  // Fallback: local-only (offline or not authenticated)
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
  return { success: true, id, offline: true };
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

async function removeFriend(friendId) {
  if (!_settings || !friendId) return { success: false };

  // Remove from server if authenticated
  if (_isAuthenticated() && _serverApi) {
    try {
      await _serverApi.friendsRemove(friendId);
    } catch (err) {
      console.warn('[Friends] server remove failed:', err.message);
    }
  }

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
  setServerApi,
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
  syncFromServer,
  _genCode,
};
