const express = require("express");
const router = express.Router();
const { authMiddleware, adminMiddleware } = require("../middleware/auth");

// ─── POST /api/admin/setup ────────────────────────────────
// One-time setup: create admin user. Requires ADMIN_SECRET.
// Must be defined BEFORE the auth middleware below.
router.post("/setup", async (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: "ADMIN_SECRET not configured" });

  const authHeader = req.headers.authorization || "";
  if (authHeader !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });

  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "Укажите username, email, password" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Пароль минимум 6 символов" });
  }

  try {
    const prisma = req.prisma;
    // Check if admin user already exists
    const existingAdmin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (existingAdmin) {
      return res.status(409).json({ error: "Admin-пользователь уже существует", username: existingAdmin.username });
    }

    const bcrypt = require("bcryptjs");
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        passwordHash,
        displayName: "Admin",
        role: "ADMIN",
        emailVerified: true,
      },
      select: { id: true, username: true, email: true, role: true },
    });

    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "Пользователь с таким именем/email уже существует" });
    }
    console.error("[ADMIN] Setup error:", err);
    res.status(500).json({ error: "Ошибка создания admin" });
  }
});

// All admin routes below require auth + admin role
router.use(authMiddleware, adminMiddleware);

// Helper: write audit log entry
async function _audit(req, action, targetId, targetType, details) {
  try {
    await req.prisma.auditLog.create({
      data: {
        adminId: req.user.id,
        action,
        targetId: targetId || null,
        targetType: targetType || null,
        details: details ? JSON.stringify(details) : null,
        ip: req.headers['x-forwarded-for'] || req.ip || null,
      },
    });
  } catch (e) {
    console.warn('[AUDIT] Failed to write audit log:', e.message);
  }
}

// ─── GET /api/admin/audit ────────────────────────────────
router.get("/audit", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logs = await req.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { admin: { select: { username: true, displayName: true } } },
    });
    res.json(logs);
  } catch (err) {
    console.error('[ADMIN] Audit log error:', err);
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ─── GET /api/admin/stats ─────────────────────────────────
router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsers,
      activeToday,
      streamingNow,
      totalStreams,
      activeRooms,
      totalBugs,
    ] = await Promise.all([
      req.prisma.user.count(),
      req.prisma.user.count({
        where: { lastLoginAt: { gte: new Date(Date.now() - 86400000) } },
      }),
      req.prisma.streamEvent.count({
        where: { endedAt: null },
      }),
      req.prisma.streamEvent.count(),
      req.prisma.room.count({
        where: { status: "ACTIVE" },
      }),
      req.prisma.bugReport.count().catch(() => 0),
    ]);

    // Users by registration date (last 30 days)
    const recentUsers = await req.prisma.user.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 86400000) } },
      select: { createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Streams by platform
    const streamsByPlatform = await req.prisma.streamEvent.groupBy({
      by: ["platform"],
      _count: { id: true },
    });

    res.json({
      totalUsers,
      activeToday,
      streamingNow,
      totalStreams,
      activeRooms,
      totalBugs,
      recentUsers: recentUsers.length,
      streamsByPlatform: streamsByPlatform.map((s) => ({
        platform: s.platform,
        count: s._count.id,
      })),
    });
  } catch (err) {
    console.error("[ADMIN] Stats error:", err);
    res.status(500).json({ error: "Ошибка статистики" });
  }
});

// ─── GET /api/admin/users ──────────────────────────────────
router.get("/users", async (req, res) => {
  const page = parseInt(req.query.page || "1", 10);
  const limit = parseInt(req.query.limit || "25", 10);
  const search = req.query.search || "";

  try {
    const where = search
      ? {
          OR: [
            { username: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { displayName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      req.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: true,
          emailVerified: true,
          avatarUrl: true,
          createdAt: true,
          lastLoginAt: true,
          _count: { select: { accounts: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      req.prisma.user.count({ where }),
    ]);

    res.json({ users, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error("[ADMIN] Users error:", err);
    res.status(500).json({ error: "Ошибка получения пользователей" });
  }
});

// ─── GET /api/admin/users/:id ──────────────────────────────
router.get("/users/:id", async (req, res) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        accounts: { select: { provider: true, providerId: true, createdAt: true } },
        subscription: true,
        _count: { select: { friendRequests: true, friendAddresses: true, streamEvents: true } },
      },
    });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    res.json(user);
  } catch (err) {
    console.error("[ADMIN] User detail error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

// ─── PATCH /api/admin/users/:id ────────────────────────────
router.patch("/users/:id", async (req, res) => {
  const { role, banned, resetPassword } = req.body;

  try {
    const data = {};
    if (role && ["USER", "ADMIN"].includes(role)) data.role = role;
    if (typeof banned === "boolean") data.banned = banned;

    if (resetPassword) {
      const bcrypt = require("bcryptjs");
      data.passwordHash = await bcrypt.hash(resetPassword, 12);
    }

    const user = await req.prisma.user.update({
      where: { id: req.params.id },
      data,
      select: { id: true, username: true, role: true, banned: true },
    });
    await _audit(req, typeof banned === 'boolean' ? (banned ? 'ban_user' : 'unban_user') : 'update_user',
      req.params.id, 'user', { role, banned, resetPassword: !!resetPassword });
    res.json(user);
  } catch (err) {
    console.error("[ADMIN] User update error:", err);
    res.status(500).json({ error: "Ошибка обновления" });
  }
});

// ─── DELETE /api/admin/users/:id ───────────────────────────
router.delete("/users/:id", async (req, res) => {
  try {
    // Cascade delete related records
    await req.prisma.account.deleteMany({ where: { userId: req.params.id } });
    await req.prisma.roomMember.deleteMany({ where: { userId: req.params.id } });
    await req.prisma.streamEvent.deleteMany({ where: { userId: req.params.id } });
    await req.prisma.settingsBlob.deleteMany({ where: { userId: req.params.id } });
    await req.prisma.message.deleteMany({
      where: { OR: [{ senderId: req.params.id }, { receiverId: req.params.id }] },
    });
    await req.prisma.friendship.deleteMany({
      where: { OR: [{ requesterId: req.params.id }, { addresseeId: req.params.id }] },
    });

    await _audit(req, 'delete_user', req.params.id, 'user', null);
    await req.prisma.user.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN] User delete error:", err);
    res.status(500).json({ error: "Ошибка удаления" });
  }
});

// ─── GET /api/admin/rooms ──────────────────────────────────
router.get("/rooms", async (req, res) => {
  try {
    const rooms = await req.prisma.room.findMany({
      where: { status: "ACTIVE" },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        members: {
          where: { leftAt: null },
          include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json(rooms);
  } catch (err) {
    console.error("[ADMIN] Rooms error:", err);
    res.status(500).json({ error: "Ошибка получения комнат" });
  }
});

// ─── GET /api/admin/bugs ───────────────────────────────────
router.get("/bugs", async (req, res) => {
  try {
    const bugs = await req.prisma.bugReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    }).catch(() => []);

    // Fallback: read from filesystem if no table
    if (bugs.length === 0) {
      const fs = require("fs");
      const path = require("path");
      const bugsDir = path.join(__dirname, "../../data/bugs");
      if (fs.existsSync(bugsDir)) {
        const files = fs.readdirSync(bugsDir).filter((f) => f.endsWith(".json")).reverse().slice(0, 100);
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(bugsDir, file), "utf8"));
            bugs.push(data);
          } catch {}
        }
      }
    }

    res.json({ count: bugs.length, shown: bugs.length, bugs });
  } catch (err) {
    console.error("[ADMIN] Bugs error:", err);
    res.status(500).json({ error: "Ошибка получения багов" });
  }
});

// ─── POST /api/admin/announce ───────────────────────────────
router.post("/announce", async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Сообщение обязательно" });

  try {
    // Broadcast to all connected presence WebSocket clients
    if (req.app.get("presenceServer")) {
      const ps = req.app.get("presenceServer");
      for (const [userId, ws] of ps.connections) {
        ps._send(ws, {
          type: "announcement",
          message,
          from: "admin",
          timestamp: Date.now(),
        });
      }
    }
    // Also save announcement as a message from StreamBro to all online users
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (supportUser) {
      const onlineUsers = Array.from(_presence?.connections?.keys() || []);
      for (const userId of onlineUsers) {
        try {
          await req.prisma.message.create({
            data: { senderId: supportUser.id, receiverId: userId, content: message.trim() },
          });
        } catch (e) { /* skip if friendship doesn't exist */ }
      }
    }

    res.json({ ok: true, sent: true });
  } catch (err) {
    console.error("[ADMIN] Announce error:", err);
    res.status(500).json({ error: "Ошибка рассылки" });
  }
});

// ─── GET /api/admin/feedback ──────────────────────────────
// Get all conversations with the StreamBro support user
router.get("/feedback", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) return res.json({ conversations: [] });

    // Get all messages involving the support user, grouped by the other user
    const messages = await req.prisma.message.findMany({
      where: {
        OR: [
          { senderId: supportUser.id },
          { receiverId: supportUser.id },
        ],
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        receiver: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // Group by conversation partner
    const convMap = new Map();
    for (const msg of messages) {
      const partnerId = msg.senderId === supportUser.id ? msg.receiverId : msg.senderId;
      const partner = msg.senderId === supportUser.id ? msg.receiver : msg.sender;
      if (!convMap.has(partnerId)) {
        convMap.set(partnerId, { partner, messages: [] });
      }
      convMap.get(partnerId).messages.push({
        id: msg.id,
        content: msg.content,
        fromSupport: msg.senderId === supportUser.id,
        edited: msg.edited,
        createdAt: msg.createdAt,
      });
    }

    const conversations = Array.from(convMap.values()).map(c => ({
      ...c,
      lastMessage: c.messages[0],
      unread: c.messages.filter(m => !m.fromSupport && !m.read).length,
    }));

    res.json({ conversations });
  } catch (err) {
    console.error("[ADMIN] Feedback error:", err);
    res.status(500).json({ error: "Ошибка получения обратной связи" });
  }
});

// ─── POST /api/admin/feedback/reply ──────────────────────
// Reply to a user as the StreamBro support user
router.post("/feedback/reply", authMiddleware, adminMiddleware, async (req, res) => {
  const { userId, content } = req.body;
  if (!userId || !content) return res.status(400).json({ error: "Укажите userId и content" });

  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) return res.status(404).json({ error: "Support user not found" });

    const message = await req.prisma.message.create({
      data: {
        senderId: supportUser.id,
        receiverId: userId,
        content: content.slice(0, 2000),
      },
    });

    // Push message via presence if user is online
    if (_presence) {
      _presence.notifyUser(userId, {
        type: "chat",
        senderId: supportUser.id,
        content: message.content,
        messageId: message.id,
        timestamp: Date.now(),
      });
    }

    res.json({ ok: true, message });
  } catch (err) {
    console.error("[ADMIN] Feedback reply error:", err);
    res.status(500).json({ error: "Ошибка отправки ответа" });
  }
});

module.exports = router;

// Presence server reference for push notifications
let _presence = null;
function setPresence(p) { _presence = p; }
module.exports.setPresence = setPresence;
