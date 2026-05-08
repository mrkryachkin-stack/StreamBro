const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// Presence server reference — set from index.js
let _presence = null;
function setPresence(presenceServer) { _presence = presenceServer; }

// ─── POST /api/rooms ──────────────────────────────────────
// Create a co-stream room
router.post("/", authMiddleware, async (req, res) => {
  const { name, maxPeers } = req.body;

  try {
    // Limit: max 2 active rooms per user
    const activeCount = await req.prisma.room.count({
      where: { creatorId: req.user.id, status: "ACTIVE" },
    });
    if (activeCount >= 2) {
      return res.status(429).json({ error: "Максимум 2 комнаты. Удалите старую чтобы создать новую." });
    }

    const code = generateRoomCode();

    const room = await req.prisma.room.create({
      data: {
        code,
        creatorId: req.user.id,
        name: name || null,
        maxPeers: maxPeers || 4,
        members: {
          create: { userId: req.user.id, role: "CREATOR" },
        },
      },
      include: {
        members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
      },
    });

    res.status(201).json(room);
  } catch (err) {
    console.error("[ROOMS] Create error:", err);
    res.status(500).json({ error: "Ошибка создания комнаты" });
  }
});

// ─── GET /api/rooms/mine/list ──────────────────────────────
// List rooms the user created (ACTIVE only, max 2 per user)
router.get("/mine/list", authMiddleware, async (req, res) => {
  try {
    const rooms = await req.prisma.room.findMany({
      where: {
        creatorId: req.user.id,
        status: "ACTIVE",
      },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        members: {
          where: { leftAt: null },
          select: { userId: true, role: true, joinedAt: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(rooms);
  } catch (err) {
    console.error("[ROOMS] Mine error:", err);
    res.status(500).json({ error: "Ошибка получения комнат" });
  }
});

// ─── GET /api/rooms/:code ─────────────────────────────────
// Get room info
router.get("/:code", authMiddleware, async (req, res) => {
  try {
    const room = await req.prisma.room.findUnique({
      where: { code: req.params.code.toUpperCase() },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        },
      },
    });

    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    if (room.status !== "ACTIVE") return res.status(410).json({ error: "Комната закрыта" });

    res.json(room);
  } catch (err) {
    console.error("[ROOMS] Get error:", err);
    res.status(500).json({ error: "Ошибка получения комнаты" });
  }
});

// ─── POST /api/rooms/:code/join ────────────────────────────
router.post("/:code/join", authMiddleware, async (req, res) => {
  const code = req.params.code.toUpperCase();

  try {
    const room = await req.prisma.room.findUnique({
      where: { code },
      include: { members: { where: { leftAt: null } } },
    });

    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    if (room.status !== "ACTIVE") return res.status(410).json({ error: "Комната закрыта" });
    if (room.members.length >= room.maxPeers) return res.status(409).json({ error: "Комната полна" });

    // Check if already a member
    const existing = room.members.find((m) => m.userId === req.user.id);
    if (existing) return res.json(room);

    const member = await req.prisma.roomMember.create({
      data: { roomId: room.id, userId: req.user.id },
    });

    // Notify existing room members that a peer joined
    if (_presence) {
      for (const m of room.members) {
        if (m.userId !== req.user.id) {
          _presence.notifyUser(m.userId, {
            type: "room-event",
            roomCode: code,
            event: "peer-joined",
            fromUserId: req.user.id,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Return updated room
    const updated = await req.prisma.room.findUnique({
      where: { code },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        },
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("[ROOMS] Join error:", err);
    res.status(500).json({ error: "Ошибка входа в комнату" });
  }
});

// ─── POST /api/rooms/:code/leave ───────────────────────────
router.post("/:code/leave", authMiddleware, async (req, res) => {
  const code = req.params.code.toUpperCase();

  try {
    const room = await req.prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: "Комната не найдена" });

    await req.prisma.roomMember.updateMany({
      where: { roomId: room.id, userId: req.user.id, leftAt: null },
      data: { leftAt: new Date() },
    });

    // If creator leaves, close room
    if (room.creatorId === req.user.id) {
      await req.prisma.room.update({
        where: { id: room.id },
        data: { status: "CLOSED" },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[ROOMS] Leave error:", err);
    res.status(500).json({ error: "Ошибка выхода из комнаты" });
  }
});

// ─── POST /api/rooms/:code/invite ──────────────────────────
// Invite a friend to a room (sends message)
router.post("/:code/invite", authMiddleware, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { friendId } = req.body;

  if (!friendId) return res.status(400).json({ error: "Укажите friendId" });

  try {
    // Verify friendship
    const friendship = await req.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: friendId },
          { requesterId: friendId, addresseeId: req.user.id },
        ],
        status: "ACCEPTED",
      },
    });

    if (!friendship) return res.status(403).json({ error: "Можно приглашать только друзей" });

    // Send invite message
    const msg = await req.prisma.message.create({
      data: {
        senderId: req.user.id,
        receiverId: friendId,
        content: `[room-invite:${code}]`,
      },
    });

    res.status(201).json({ ok: true, messageId: msg.id });
  } catch (err) {
    console.error("[ROOMS] Invite error:", err);
    res.status(500).json({ error: "Ошибка приглашения" });
  }
});

// ─── PATCH /api/rooms/:code ────────────────────────────────
// Rename a room (creator only)
router.patch("/:code", authMiddleware, async (req, res) => {
  const code = req.params.code.toUpperCase();
  const { name } = req.body;

  if (name !== undefined && typeof name !== "string") return res.status(400).json({ error: "name must be a string" });
  if (name !== undefined && name.length > 50) return res.status(400).json({ error: "name max 50 chars" });

  try {
    const room = await req.prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    if (room.creatorId !== req.user.id) return res.status(403).json({ error: "Только создатель может переименовать" });
    if (room.status !== "ACTIVE") return res.status(410).json({ error: "Комната закрыта" });

    const updated = await req.prisma.room.update({
      where: { id: room.id },
      data: { name: name !== undefined ? name : room.name },
    });

    res.json(updated);
  } catch (err) {
    console.error("[ROOMS] Rename error:", err);
    res.status(500).json({ error: "Ошибка переименования" });
  }
});

// ─── DELETE /api/rooms/:code ────────────────────────────────
// Delete/close a room (creator only)
router.delete("/:code", authMiddleware, async (req, res) => {
  const code = req.params.code.toUpperCase();

  try {
    const room = await req.prisma.room.findUnique({ where: { code } });
    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    if (room.creatorId !== req.user.id) return res.status(403).json({ error: "Только создатель может удалить" });

    // Mark all members as left and close the room
    await req.prisma.roomMember.updateMany({
      where: { roomId: room.id, leftAt: null },
      data: { leftAt: new Date() },
    });
    await req.prisma.room.update({
      where: { id: room.id },
      data: { status: "CLOSED" },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[ROOMS] Delete error:", err);
    res.status(500).json({ error: "Ошибка удаления" });
  }
});

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    if (i > 0) code += "-";
    for (let j = 0; j < 4; j++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return code;
}

module.exports = router;
module.exports.setPresence = setPresence;
