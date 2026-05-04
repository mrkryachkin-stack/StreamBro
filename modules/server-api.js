// StreamBro — server API client (main process)
// Makes authenticated HTTP requests to the StreamBro backend.
// Uses the JWT token from profile-manager for authentication.

const { net } = require('electron');
const profileManager = require('./profile-manager');

const API_BASE = 'https://streambro.ru/api';

let _presenceWs = null;

// ─── Internal: make authenticated API request ───
async function _request(method, path, body) {
  const token = profileManager.getToken();
  if (!token) return { ok: false, error: 'not authenticated' };

  return new Promise((resolve) => {
    try {
      const url = `${API_BASE}${path}`;
      const opts = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      };

      const request = net.request(opts);

      // Timeout: abort after 12 seconds
      const timer = setTimeout(() => {
        request.abort();
        resolve({ ok: false, error: 'request timed out' });
      }, 12000);

      let data = '';
      request.on('response', (response) => {
        const status = response.statusCode;
        response.on('data', (chunk) => { data += chunk.toString(); });
        response.on('end', () => {
          clearTimeout(timer);
          try {
            const json = JSON.parse(data);
            if (status >= 400) {
              resolve({ ok: false, status, error: json.error || `HTTP ${status}` });
            } else {
              resolve({ ok: true, status, data: json });
            }
          } catch {
            if (status >= 400) {
              resolve({ ok: false, status, error: `HTTP ${status}` });
            } else {
              resolve({ ok: true, status, data });
            }
          }
        });
      });

      request.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, error: err.message });
      });

      if (body !== undefined) {
        request.write(JSON.stringify(body));
      }
      request.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// ─── Friends ───
async function friendsList() {
  return _request('GET', '/friends');
}

async function friendsPending() {
  return _request('GET', '/friends/pending');
}

async function friendsSearch(q) {
  // Strip leading @ for username search
  const query = q.replace(/^@+/, '');
  return _request('GET', `/friends/search?q=${encodeURIComponent(query)}`);
}

async function friendsRequest(userId) {
  return _request('POST', '/friends/request', { userId });
}

async function friendsAccept(friendshipId) {
  return _request('POST', '/friends/accept', { friendshipId });
}

async function friendsReject(friendshipId) {
  return _request('POST', '/friends/reject', { friendshipId });
}

async function friendsRemove(friendId) {
  return _request('DELETE', `/friends/${friendId}`);
}

async function friendsBlock(userId) {
  return _request('POST', '/friends/block', { userId });
}

// ─── Chat ───
async function chatHistory(userId, before, limit) {
  let qs = '';
  if (before) qs += `before=${encodeURIComponent(before)}&`;
  if (limit) qs += `limit=${limit}&`;
  return _request('GET', `/chat/${userId}${qs ? '?' + qs : ''}`);
}

async function chatSend(userId, content) {
  return _request('POST', `/chat/${userId}`, { content });
}

async function chatEdit(messageId, content) {
  return _request('PATCH', `/chat/message/${messageId}`, { content });
}

async function chatDelete(messageId) {
  return _request('DELETE', `/chat/message/${messageId}`);
}

async function chatUnread() {
  return _request('GET', '/chat/unread/count');
}

// ─── Rooms ───
async function roomsCreate(opts) {
  return _request('POST', '/rooms', opts || {});
}

async function roomsJoin(code) {
  return _request('POST', `/rooms/${code}/join`);
}

async function roomsLeave(code) {
  return _request('POST', `/rooms/${code}/leave`);
}

async function roomsGet(code) {
  return _request('GET', `/rooms/${code}`);
}

async function roomsList() {
  return _request('GET', '/rooms/mine/list');
}

async function roomsInvite(code, friendId) {
  return _request('POST', `/rooms/${code}/invite`, { friendId });
}

// ─── Stream Events ───
async function streamEventStart(platform) {
  return _request('POST', '/stream-events/start', { platform });
}

async function streamEventEnd(eventId, reconnects) {
  return _request('POST', `/stream-events/${eventId}/end`, { reconnects });
}

async function streamEventReconnect(eventId) {
  return _request('POST', `/stream-events/${eventId}/reconnect`);
}

async function streamEventHistory() {
  return _request('GET', '/stream-events/history');
}

async function streamEventStats() {
  return _request('GET', '/stream-events/stats');
}

// ─── Cloud Settings ───
async function cloudSettingsGet() {
  return _request('GET', '/settings');
}

async function cloudSettingsPut(blob) {
  return _request('PUT', '/settings', blob);
}

async function cloudSettingsDelete() {
  return _request('DELETE', '/settings');
}

// ─── Profile ───
async function profileUpdate(patch) {
  return _request('PATCH', '/user/profile', patch);
}

async function changePassword(currentPassword, newPassword) {
  return _request('POST', '/auth/change-password', { currentPassword, newPassword });
}

async function profileGetPublic(username) {
  return _request('GET', `/user/${username}/profile`);
}

// ─── User ───
async function userMe() {
  return _request('GET', '/user/me');
}

// ─── Presence WebSocket ───
const { WebSocket } = require('ws');

function presenceConnect() {
  const token = profileManager.getToken();
  if (!token) return { ok: false, error: 'not authenticated' };

  if (_presenceWs && _presenceWs.readyState === WebSocket.OPEN) {
    return { ok: true }; // already connected
  }

  const url = 'wss://streambro.ru/presence';
  _presenceWs = new WebSocket(url);

  _presenceWs.on('open', () => {
    _presenceWs.send(JSON.stringify({ type: 'auth', token }));
    console.log('[Presence] Connected and authenticating');
  });

  _presenceWs.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    // Forward relevant events to renderer via IPC
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.isDestroyed()) return;

    switch (msg.type) {
      case 'chat':
        win.webContents.send('friends-message', {
          friendId: msg.senderId,
          msg: {
            id: msg.messageId,
            messageId: msg.messageId,
            text: msg.content,
            content: msg.content,
            senderId: msg.senderId,
            from: msg.senderId,
            ts: msg.timestamp || Date.now(),
            createdAt: new Date(msg.timestamp || Date.now()).toISOString(),
          },
        });
        break;

      case 'chat-edit':
        win.webContents.send('friends-chat-edit', {
          messageId: msg.messageId,
          content: msg.content,
          edited: true,
        });
        break;

      case 'chat-delete':
        win.webContents.send('friends-chat-delete', {
          messageId: msg.messageId,
        });
        break;

      case 'presence':
        win.webContents.send('presence-update', {
          userId: msg.userId,
          status: msg.status,
          timestamp: msg.timestamp,
        });
        break;

      case 'friend-stream-start':
        win.webContents.send('stream-notification', {
          type: 'friend-stream-start',
          userId: msg.userId,
          platform: msg.platform,
          timestamp: msg.timestamp,
        });
        break;

      case 'friend-stream-end':
        win.webContents.send('stream-notification', {
          type: 'friend-stream-end',
          userId: msg.userId,
          timestamp: msg.timestamp,
        });
        break;

      case 'room-event':
        win.webContents.send('stream-notification', {
          type: 'room-event',
          roomCode: msg.roomCode,
          event: msg.event,
          fromUserId: msg.fromUserId,
          timestamp: msg.timestamp,
        });
        break;

      case 'signal':
        // WebRTC signal relay — forward to renderer for WebRTCManager
        win.webContents.send('presence-signal', {
          type: 'signal',
          fromPeerId: msg.fromPeerId,
          signal: msg.signal,
          roomCode: msg.roomCode,
          timestamp: msg.timestamp,
        });
        break;

      case 'announcement':
        win.webContents.send('stream-notification', {
          type: 'announcement',
          message: msg.message,
          timestamp: msg.timestamp,
        });
        break;

      case 'friend-accepted':
        // Someone accepted our friend request — trigger sync
        win.webContents.send('friends-changed', { reason: 'friend-accepted', userId: msg.userId });
        break;

      case 'friend-request':
        // New incoming friend request — trigger refresh
        win.webContents.send('friends-changed', { reason: 'friend-request', userId: msg.userId });
        break;
    }
  });

  _presenceWs.on('close', () => {
    console.log('[Presence] Disconnected — reconnecting in 5s');
    if (_presenceWs) { _presenceWs = null; }
    setTimeout(() => {
      if (profileManager.getToken()) {
        console.log('[Presence] Reconnecting...');
        presenceConnect();
      }
    }, 5000);
  });

  _presenceWs.on('error', (err) => {
    console.error('[Presence] Error:', err.message);
  });

  return { ok: true };
}

function presenceDisconnect() {
  if (_presenceWs) {
    _presenceWs.close();
    _presenceWs = null;
  }
  return { ok: true };
}

function presenceSetStatus(status) {
  if (_presenceWs && _presenceWs.readyState === WebSocket.OPEN) {
    _presenceWs.send(JSON.stringify({ type: 'status', status }));
    return { ok: true };
  }
  return { ok: false, error: 'not connected' };
}

// Send arbitrary message through Presence WS (e.g. WebRTC signal relay)
function presenceSend(msgJson) {
  if (_presenceWs && _presenceWs.readyState === WebSocket.OPEN) {
    _presenceWs.send(msgJson); // already JSON string
    return { ok: true };
  }
  return { ok: false, error: 'not connected' };
}

function presenceNotifyStreamStart(platform) {
  if (_presenceWs && _presenceWs.readyState === WebSocket.OPEN) {
    _presenceWs.send(JSON.stringify({ type: 'stream-start', platform }));
  }
}

function presenceNotifyStreamEnd() {
  if (_presenceWs && _presenceWs.readyState === WebSocket.OPEN) {
    _presenceWs.send(JSON.stringify({ type: 'stream-end' }));
  }
}

// Get TURN credentials from server API
async function getTurnCredentials() {
  return _request('GET', '/turn/credentials');
}

module.exports = {
  friendsList, friendsPending, friendsSearch, friendsRequest, friendsAccept, friendsReject, friendsRemove, friendsBlock,
  chatHistory, chatSend, chatEdit, chatDelete, chatUnread,
  roomsCreate, roomsJoin, roomsLeave, roomsGet, roomsList, roomsInvite,
  streamEventStart, streamEventEnd, streamEventReconnect, streamEventHistory, streamEventStats,
  cloudSettingsGet, cloudSettingsPut, cloudSettingsDelete,
  profileUpdate, profileGetPublic, userMe, changePassword,
  presenceConnect, presenceDisconnect, presenceSetStatus, presenceSend, presenceNotifyStreamStart, presenceNotifyStreamEnd,
  getTurnCredentials,
};
