// StreamBro Presence WebSocket — real-time events
// Handles: presence (online/offline), stream notifications, chat delivery, room events
// Mounted at /ws/presence (proxied via nginx from /presence)

const { WebSocketServer } = require("ws");
const { WebSocket } = require("ws");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const HEARTBEAT_MS = 30000;

class PresenceServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server, path: "/presence" });
    this.connections = new Map(); // userId -> ws
    this.userStatus = new Map(); // userId -> status string

    this.wss.on("connection", (ws, req) => {
      ws.isAlive = true;
      ws.userId = null;
      ws.ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;

      ws.on("pong", () => { ws.isAlive = true; });

      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        this._handleMessage(ws, msg);
      });

      ws.on("close", () => {
        if (ws.userId) {
          this.connections.delete(ws.userId);
          this.userStatus.delete(ws.userId);
          this._broadcastPresence(ws.userId, "offline");
          this._updateDbStatus(ws.userId, "offline");
        }
      });

      // Wait for auth message
      ws._authTimeout = setTimeout(() => {
        if (!ws.userId) ws.close(4001, "auth timeout");
      }, 10000);
    });

    // Heartbeat
    this._heartbeat = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
      });
    }, HEARTBEAT_MS);

    this.wss.on("close", () => clearInterval(this._heartbeat));

    console.log("[PRESENCE] WebSocket server ready at /presence");
  }

  _send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case "auth": {
        clearTimeout(ws._authTimeout);
        try {
          const decoded = jwt.verify(msg.token, JWT_SECRET);
          ws.userId = decoded.id;

          // Close existing connection for same user
          const existing = this.connections.get(ws.userId);
          if (existing && existing !== ws) {
            existing.close(4002, "duplicate connection");
          }

          const status = msg.status || "online";
          this.connections.set(ws.userId, ws);
          this.userStatus.set(ws.userId, status);
          this._broadcastPresence(ws.userId, status);
          this._send(ws, { type: "auth-ok" });

          // Update status in database
          this._updateDbStatus(ws.userId, status);

          // Send pending messages
          this._deliverPendingMessages(ws);
        } catch {
          ws.close(4003, "invalid token");
        }
        break;
      }

      case "status": {
        if (!ws.userId) return;
        const status = msg.status || "online";
        this.userStatus.set(ws.userId, status);
        this._broadcastPresence(ws.userId, status);
        this._updateDbStatus(ws.userId, status);
        break;
      }

      case "chat": {
        if (!ws.userId) return;
        this._handleChat(ws, msg);
        break;
      }

      case "stream-start": {
        if (!ws.userId) return;
        this._handleStreamStart(ws, msg);
        break;
      }

      case "stream-end": {
        if (!ws.userId) return;
        this._handleStreamEnd(ws, msg);
        break;
      }

      case "room-event": {
        if (!ws.userId) return;
        this._handleRoomEvent(ws, msg);
        break;
      }

      case "signal": {
        if (!ws.userId) return;
        this._handleSignal(ws, msg);
        break;
      }

      default:
        break;
    }
  }

  async _deliverPendingMessages(ws) {
    // This is called after auth — we could check DB for unread messages
    // For now, the REST API handles message history
  }

  _handleChat(ws, msg) {
    const { receiverId, content, messageId } = msg;
    if (!receiverId || !content) return;

    const targetWs = this.connections.get(receiverId);
    if (targetWs) {
      this._send(targetWs, {
        type: "chat",
        senderId: ws.userId,
        content,
        messageId,
        timestamp: Date.now(),
      });
    }
  }

  _handleStreamStart(ws, msg) {
    const { platform } = msg;
    // Notify all friends that this user started streaming
    this._notifyFriends(ws.userId, {
      type: "friend-stream-start",
      userId: ws.userId,
      platform: platform || "unknown",
      timestamp: Date.now(),
    });

    // Update status
    this.userStatus.set(ws.userId, "streaming");
    this._broadcastPresence(ws.userId, "streaming");
  }

  _handleStreamEnd(ws, msg) {
    this._notifyFriends(ws.userId, {
      type: "friend-stream-end",
      userId: ws.userId,
      timestamp: Date.now(),
    });

    this.userStatus.set(ws.userId, "online");
    this._broadcastPresence(ws.userId, "online");
  }

  _handleRoomEvent(ws, msg) {
    const { roomCode, event, targetUserId } = msg;
    if (!roomCode) return;

    if (targetUserId) {
      // Send to specific user (e.g., invite)
      const targetWs = this.connections.get(targetUserId);
      if (targetWs) {
        this._send(targetWs, {
          type: "room-event",
          roomCode,
          event,
          fromUserId: ws.userId,
          timestamp: Date.now(),
        });
      }
    }
  }

  // ─── WebRTC Signal Relay ──────────────────────────────────
  // Relays WebRTC offers/answers/ICE candidates between room members
  _handleSignal(ws, msg) {
    const { targetPeerId, signal, roomCode } = msg;
    if (!targetPeerId || !signal) return;

    // Verify both users are in the same room
    if (this.prisma && roomCode) {
      this.prisma.room.findUnique({
        where: { code: roomCode.toUpperCase() },
        include: { members: { where: { leftAt: null }, select: { userId: true } } },
      }).then((room) => {
        if (!room || room.status !== "ACTIVE") return;
        const memberIds = room.members.map((m) => m.userId);
        if (!memberIds.includes(ws.userId) || !memberIds.includes(targetPeerId)) return;

        // Relay signal to target peer
        const targetWs = this.connections.get(targetPeerId);
        if (targetWs) {
          this._send(targetWs, {
            type: "signal",
            fromPeerId: ws.userId,
            signal,
            roomCode,
            timestamp: Date.now(),
          });
        }
      }).catch((err) => {
        console.error("[PRESENCE] Signal relay error:", err.message);
      });
    } else {
      // Without DB check (fallback): just relay
      const targetWs = this.connections.get(targetPeerId);
      if (targetWs) {
        this._send(targetWs, {
          type: "signal",
          fromPeerId: ws.userId,
          signal,
          roomCode,
          timestamp: Date.now(),
        });
      }
    }
  }

  async _notifyFriends(userId, message) {
    // Find accepted friends and push notification
    // We need prisma for this — inject it or use a static reference
    if (this.prisma) {
      try {
        const friendships = await this.prisma.friendship.findMany({
          where: {
            OR: [
              { requesterId: userId, status: "ACCEPTED" },
              { addresseeId: userId, status: "ACCEPTED" },
            ],
          },
          select: {
            requesterId: true,
            addresseeId: true,
          },
        });

        const friendIds = new Set();
        for (const f of friendships) {
          if (f.requesterId !== userId) friendIds.add(f.requesterId);
          if (f.addresseeId !== userId) friendIds.add(f.addresseeId);
        }

        for (const friendId of friendIds) {
          const friendWs = this.connections.get(friendId);
          if (friendWs) {
            this._send(friendWs, message);
          }
        }
      } catch (err) {
        console.error("[PRESENCE] Notify friends error:", err.message);
      }
    }
  }

  _broadcastPresence(userId, status) {
    // Notify friends of status change
    this._notifyFriends(userId, {
      type: "presence",
      userId,
      status,
      timestamp: Date.now(),
    });
  }

  setPrisma(prisma) {
    this.prisma = prisma;
  }

  // Send a message to a specific user (if online)
  notifyUser(targetId, message) {
    if (!targetId) return false;
    const ws = this.connections.get(targetId);
    if (ws) {
      this._send(ws, message);
      return true;
    }
    return false;
  }

  _updateDbStatus(userId, status) {
    if (!this.prisma) return;
    const allowedStatuses = ["online", "streaming", "away", "dnd", "offline"];
    if (!allowedStatuses.includes(status)) status = "online";
    this.prisma.user.update({
      where: { id: userId },
      data: { status },
    }).catch((err) => {
      console.error("[PRESENCE] DB status update error:", err.message);
    });
  }

  getStatus(userId) {
    return this.userStatus.get(userId) || "offline";
  }
}

module.exports = PresenceServer;
