// StreamBro Signaling Server — production version
// Identical logic to signaling-server/server.js but reads config from env

const { WebSocketServer } = require('ws');
const crypto = require('crypto');

require('dotenv').config();

const PORT = parseInt(process.env.SIGNALING_PORT || '7890', 10);

const wss = new WebSocketServer({ port: PORT });
const rooms = new Map();
const peerCreateTimes = new Map();
const ROOM_CREATE_COOLDOWN = 5000;
const MAX_PEERS = 4;

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    if (i > 0) code += '-';
    for (let j = 0; j < 4; j++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return code;
}

function getRoom(code) {
  return rooms.get(code.toUpperCase());
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (room && room.peers.size === 0) {
    rooms.delete(code);
    console.log(`[Room] Deleted empty room: ${code}`);
  }
}

function sendTo(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.peerId = crypto.randomUUID();
  ws.ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  console.log(`[WS] Connect ${ws.peerId} from ${ws.ip}`);

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'create': {
        const now = Date.now();
        const lastCreate = peerCreateTimes.get(ws.peerId) || 0;
        if (now - lastCreate < ROOM_CREATE_COOLDOWN) {
          sendTo(ws, { type: 'error', message: 'Too many rooms — wait a few seconds' });
          return;
        }
        let code;
        do { code = generateRoomCode(); } while (rooms.has(code));
        rooms.set(code, { code, peers: new Map(), createdAt: now });
        ws.roomCode = code;
        rooms.get(code).peers.set(ws.peerId, ws);
        peerCreateTimes.set(ws.peerId, now);
        sendTo(ws, { type: 'room-created', code, peerId: ws.peerId });
        console.log(`[Room] Created: ${code} by ${ws.peerId}`);
        break;
      }

      case 'join': {
        const code = msg.code?.toUpperCase();
        const room = getRoom(code);
        if (!room) {
          sendTo(ws, { type: 'error', message: 'Room not found' });
          return;
        }
        if (room.peers.size >= MAX_PEERS) {
          sendTo(ws, { type: 'error', message: `Room is full (max ${MAX_PEERS} peers)` });
          return;
        }
        ws.roomCode = code;
        room.peers.set(ws.peerId, ws);

        const existingPeerIds = [];
        for (const [pid] of room.peers) {
          if (pid !== ws.peerId) existingPeerIds.push(pid);
        }
        sendTo(ws, { type: 'room-joined', code, peerId: ws.peerId, peers: existingPeerIds });

        for (const [pid, peerWs] of room.peers) {
          if (pid !== ws.peerId) {
            sendTo(peerWs, { type: 'peer-joined', peerId: ws.peerId });
          }
        }
        console.log(`[Room] ${ws.peerId} joined ${code} (${room.peers.size} peers)`);
        break;
      }

      case 'signal': {
        const room = rooms.get(ws.roomCode);
        if (!room) return;
        const targetWs = room.peers.get(msg.targetPeerId);
        if (targetWs) {
          sendTo(targetWs, {
            type: 'signal',
            fromPeerId: ws.peerId,
            signal: msg.signal,
          });
        }
        break;
      }

      case 'leave': {
        const code = ws.roomCode;
        const room = rooms.get(code);
        if (!room) return;
        room.peers.delete(ws.peerId);
        for (const [, peerWs] of room.peers) {
          sendTo(peerWs, { type: 'peer-left', peerId: ws.peerId });
        }
        ws.roomCode = null;
        cleanupRoom(code);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Disconnect ${ws.peerId}`);
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) {
        room.peers.delete(ws.peerId);
        for (const [pid, peerWs] of room.peers) {
          sendTo(peerWs, { type: 'peer-left', peerId: ws.peerId });
        }
        cleanupRoom(ws.roomCode);
      }
    }
  });
});

// Heartbeat
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(interval));

console.log(`StreamBro Signaling Server running on ws://0.0.0.0:${PORT}`);
