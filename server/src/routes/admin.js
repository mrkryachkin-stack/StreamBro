const express = require("express");
const router = express.Router();
let speakeasy = null;
let qrcode = null;
try { speakeasy = require("speakeasy"); qrcode = require("qrcode"); } catch(e) { console.warn("[2FA] speakeasy/qrcode not installed, 2FA disabled"); }
const { authMiddleware, adminMiddleware } = require("../middleware/auth");
const aiBot = require("../ai-bot");

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

// ─── GET /api/admin/streams ──────────────────────────────
// Stream history with user info, filters, and aggregation
router.get("/streams", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const platform = req.query.platform || null;
    const activeOnly = req.query.active === 'true';

    const where = {};
    if (platform) where.platform = platform;
    if (activeOnly) where.endedAt = null;

    const [streams, total, byPlatform, avgDuration] = await Promise.all([
      req.prisma.streamEvent.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: { user: { select: { username: true, displayName: true, avatarUrl: true } } },
      }),
      req.prisma.streamEvent.count({ where }),
      req.prisma.streamEvent.groupBy({ by: ['platform'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } }),
      req.prisma.streamEvent.aggregate({ _avg: { duration: true }, _max: { duration: true } }),
    ]);

    res.json({ streams, total, byPlatform, avgDuration: avgDuration._avg.duration, maxDuration: avgDuration._max.duration });
  } catch (err) {
    console.error('[ADMIN] Streams error:', err);
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
    // Also cross-reference with AiConversation to tag AI responses
    const aiConvos = await req.prisma.aiConversation.findMany({
      select: { question: true, answer: true, provider: true, corrected: true, correction: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    // Build a set of AI answer texts for matching (by content similarity)
    const aiAnswersByUser = new Map();
    for (const ac of aiConvos) {
      if (!aiAnswersByUser.has(ac.userId)) aiAnswersByUser.set(ac.userId, []);
      aiAnswersByUser.get(ac.userId).push(ac);
    }

    const convMap = new Map();
    for (const msg of messages) {
      const partnerId = msg.senderId === supportUser.id ? msg.receiverId : msg.senderId;
      const partner = msg.senderId === supportUser.id ? msg.receiver : msg.sender;
      if (!convMap.has(partnerId)) {
        convMap.set(partnerId, { partner, messages: [] });
      }

      // Check if this message from support is an AI response
      let isAi = false;
      let aiProvider = null;
      let aiCorrected = false;
      let aiCorrection = null;
      if (msg.senderId === supportUser.id) {
        const userAiConvos = aiAnswersByUser.get(partnerId) || [];
        // Match by answer content and approximate timestamp
        const match = userAiConvos.find(ac =>
          ac.answer === msg.content ||
          (ac.answer && msg.content && ac.answer.length > 20 && msg.content.includes(ac.answer.slice(0, 50)))
        );
        if (match) {
          isAi = true;
          aiProvider = match.provider;
          aiCorrected = match.corrected;
          aiCorrection = match.correction;
        }
      }

      convMap.get(partnerId).messages.push({
        id: msg.id,
        content: msg.content,
        fromSupport: msg.senderId === supportUser.id,
        edited: msg.edited,
        read: msg.read,
        createdAt: msg.createdAt,
        isAi,
        aiProvider,
        aiCorrected,
        aiCorrection,
      });
    }

    // Need to know read status for unread count
    const fullMessages = await req.prisma.message.findMany({
      where: {
        senderId: { not: supportUser.id },
        receiverId: supportUser.id,
        read: false,
      },
      select: { id: true, senderId: true },
    });
    const unreadBySender = {};
    for (const m of fullMessages) {
      unreadBySender[m.senderId] = (unreadBySender[m.senderId] || 0) + 1;
    }

    const conversations = Array.from(convMap.values()).map(c => ({
      ...c,
      lastMessage: c.messages[0],
      unread: unreadBySender[c.partner.id] || 0,
      aiPaused: aiBot.isPaused(c.partner.id),
    }));

    res.json({ conversations });
  } catch (err) {
    console.error("[ADMIN] Feedback error:", err);
    res.status(500).json({ error: "Ошибка получения обратной связи" });
  }
});

// ─── POST /api/admin/feedback/:userId/read ──────────────────
// Mark all messages from this user (to support) as read
router.post("/feedback/:userId/read", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) return res.status(404).json({ error: "Support user not found" });
    await req.prisma.message.updateMany({
      where: {
        senderId: req.params.userId,
        receiverId: supportUser.id,
        read: false,
      },
      data: { read: true },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[ADMIN] Mark read error:", err);
    res.status(500).json({ error: "Ошибка" });
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

// ─── PATCH /api/admin/feedback/message/:messageId ──────────
// Admin edits a message (own or user's) — user sees the update via Presence WS
router.patch("/feedback/message/:messageId", authMiddleware, adminMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: "Пустое сообщение" });
  if (content.length > 2000) return res.status(400).json({ error: "Слишком длинное сообщение" });

  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) return res.status(404).json({ error: "Support user not found" });

    const message = await req.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Сообщение не найдено" });

    // Admin can edit messages in support conversations
    const isSupportConv = message.senderId === supportUser.id || message.receiverId === supportUser.id;
    if (!isSupportConv) return res.status(403).json({ error: "Можно редактировать только сообщения в чате поддержки" });

    const updated = await req.prisma.message.update({
      where: { id: messageId },
      data: { content: content.trim(), edited: true },
    });

    // Notify the other party via Presence WS
    const notifyUserId = message.senderId === supportUser.id ? message.receiverId : message.senderId;
    if (_presence) {
      _presence.notifyUser(notifyUserId, {
        type: "chat-edit",
        messageId: message.id,
        content: content.trim(),
        edited: true,
      });
    }

    res.json({ ok: true, message: updated });
  } catch (err) {
    console.error("[ADMIN] Edit message error:", err);
    res.status(500).json({ error: "Ошибка редактирования" });
  }
});

// ─── DELETE /api/admin/feedback/message/:messageId ──────────
// Admin deletes a message (own or user's) — user sees removal via Presence WS
router.delete("/feedback/message/:messageId", authMiddleware, adminMiddleware, async (req, res) => {
  const { messageId } = req.params;

  try {
    const supportUser = await req.prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) return res.status(404).json({ error: "Support user not found" });

    const message = await req.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Сообщение не найдено" });

    const isSupportConv = message.senderId === supportUser.id || message.receiverId === supportUser.id;
    if (!isSupportConv) return res.status(403).json({ error: "Можно удалять только сообщения в чате поддержки" });

    // Notify the other party BEFORE deleting
    const notifyUserId = message.senderId === supportUser.id ? message.receiverId : message.senderId;
    if (_presence) {
      _presence.notifyUser(notifyUserId, {
        type: "chat-delete",
        messageId: message.id,
      });
    }

    await req.prisma.message.delete({ where: { id: messageId } });
    res.json({ ok: true, deleted: messageId });
  } catch (err) {
    console.error("[ADMIN] Delete message error:", err);
    res.status(500).json({ error: "Ошибка удаления" });
  }
});

// ─── POST /api/admin/2fa/setup ────────────────────────────
// Generate TOTP secret and QR code (does not enable 2FA yet)
router.post("/2fa/setup", authMiddleware, adminMiddleware, async (req, res) => {
  if (!speakeasy) return res.status(503).json({ error: "2FA library not installed on server" });
  try {
    const secret = speakeasy.generateSecret({
      name: `StreamBro Admin (${req.user.username})`,
      issuer: "StreamBro",
      length: 20,
    });

    // Store secret temporarily (not enabled yet, pending verify)
    await req.prisma.user.update({
      where: { id: req.user.id },
      data: { totpSecret: secret.base32 },
    });

    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.json({
      secret: secret.base32,
      qrCode: qrDataUrl,
      otpauthUrl: secret.otpauth_url,
    });
  } catch (err) {
    console.error("[2FA] Setup error:", err);
    res.status(500).json({ error: "Ошибка настройки 2FA" });
  }
});

// ─── POST /api/admin/2fa/verify ──────────────────────────
// Verify TOTP code and enable 2FA
router.post("/2fa/verify", authMiddleware, adminMiddleware, async (req, res) => {
  if (!speakeasy) return res.status(503).json({ error: "2FA library not installed on server" });
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    const user = await req.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.totpSecret) return res.status(400).json({ error: "2FA не настроена" });

    const verified = speakeasy.totp.verify({
      secret: user.totpSecret,
      encoding: "base32",
      token: token.replace(/\s/g, ""),
      window: 2,
    });

    if (!verified) return res.status(400).json({ error: "Неверный код" });

    await req.prisma.user.update({
      where: { id: req.user.id },
      data: { totpEnabled: true },
    });

    res.json({ ok: true, message: "2FA успешно включена" });
  } catch (err) {
    console.error("[2FA] Verify error:", err);
    res.status(500).json({ error: "Ошибка верификации" });
  }
});

// ─── POST /api/admin/2fa/disable ─────────────────────────
// Disable 2FA (requires TOTP code if currently enabled)
router.post("/2fa/disable", authMiddleware, adminMiddleware, async (req, res) => {
  if (!speakeasy) return res.status(503).json({ error: "2FA library not installed on server" });
  try {
    const { token } = req.body;
    const user = await req.prisma.user.findUnique({ where: { id: req.user.id } });

    if (user?.totpEnabled) {
      if (!token) return res.status(400).json({ error: "Нужен TOTP код для отключения" });
      const verified = speakeasy.totp.verify({
        secret: user.totpSecret,
        encoding: "base32",
        token: token.replace(/\s/g, ""),
        window: 2,
      });
      if (!verified) return res.status(400).json({ error: "Неверный код" });
    }

    await req.prisma.user.update({
      where: { id: req.user.id },
      data: { totpEnabled: false, totpSecret: null },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[2FA] Disable error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

// ─── GET /api/admin/2fa/status ───────────────────────────
// Check if 2FA is currently enabled for this admin
router.get("/2fa/status", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const user = await req.prisma.user.findUnique({ where: { id: req.user.id } });
    res.json({ enabled: user?.totpEnabled || false });
  } catch (err) {
    res.status(500).json({ error: "Ошибка" });
  }
});

// ═══════════════════════════════════════════════════════════
// ─── AI Bot Management ───────────────────────────────────
// ═══════════════════════════════════════════════════════════

// ─── GET /api/admin/ai/stats ─────────────────────────────
// Get AI bot statistics
router.get("/ai/stats", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const stats = await aiBot.getStats();
    res.json(stats);
  } catch (err) {
    console.error("[AI-ADMIN] Stats error:", err);
    res.status(500).json({ error: "Ошибка получения статистики" });
  }
});

// ─── POST /api/admin/ai/toggle ──────────────────────────
// Enable or disable the AI bot
router.post("/ai/toggle", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== "boolean") return res.status(400).json({ error: "Укажите enabled: true/false" });

    aiBot.setEnabled(enabled);
    res.json({ ok: true, enabled: aiBot.isEnabled() });
  } catch (err) {
    console.error("[AI-ADMIN] Toggle error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

// ─── GET /api/admin/ai/conversations ─────────────────────
// List AI conversations (with optional filters)
router.get("/ai/conversations", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const corrected = req.query.corrected !== undefined ? req.query.corrected === "true" : undefined;
    const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
    const offset = parseInt(req.query.offset || "0", 10);

    const result = await aiBot.getConversations({ corrected, limit, offset });
    res.json(result);
  } catch (err) {
    console.error("[AI-ADMIN] Conversations error:", err);
    res.status(500).json({ error: "Ошибка получения диалогов" });
  }
});

// ─── POST /api/admin/ai/correct ─────────────────────────
// Correct an AI response (for training data quality)
router.post("/ai/correct", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { conversationId, correction, rating } = req.body;
    if (!conversationId || !correction) {
      return res.status(400).json({ error: "Укажите conversationId и correction" });
    }
    if (rating !== undefined && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: "Rating от 1 до 5" });
    }

    const result = await aiBot.correctConversation(conversationId, correction, rating);
    if (!result.ok) return res.status(404).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error("[AI-ADMIN] Correct error:", err);
    res.status(500).json({ error: "Ошибка исправления" });
  }
});

// ─── GET /api/admin/ai/export ────────────────────────────
// Export training data in OpenAI fine-tune JSONL format
router.get("/ai/export", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const onlyCorrected = req.query.only_corrected !== "false";  // default: only corrected
    const minRating = parseInt(req.query.min_rating || "4", 10);

    const data = await aiBot.exportTrainingData({ onlyCorrected, minRating });
    if (!data) return res.status(500).json({ error: "Ошибка экспорта" });

    res.setHeader("Content-Type", "application/jsonl");
    res.setHeader("Content-Disposition", "attachment; filename=streambro-training-data.jsonl");
    res.send(data);
  } catch (err) {
    console.error("[AI-ADMIN] Export error:", err);
    res.status(500).json({ error: "Ошибка экспорта" });
  }
});

// ─── POST /api/admin/ai/pause/:userId ────────────────────
// Pause AI for a specific user's chat (admin wants to talk manually)
router.post("/ai/pause/:userId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Укажите userId" });

    aiBot.pauseForUser(userId);
    res.json({ ok: true, state: aiBot.getPauseState(userId) });
  } catch (err) {
    console.error("[AI-ADMIN] Pause error:", err);
    res.status(500).json({ error: "Ошибка паузы" });
  }
});

// ─── POST /api/admin/ai/resume/:userId ────────────────────
// Resume AI for a specific user's chat.
// AI will NOT read old messages — it only responds to NEW ones after resume.
router.post("/ai/resume/:userId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Укажите userId" });

    aiBot.resumeForUser(userId);
    res.json({ ok: true, state: aiBot.getPauseState(userId) });
  } catch (err) {
    console.error("[AI-ADMIN] Resume error:", err);
    res.status(500).json({ error: "Ошибка возобновления" });
  }
});

// ─── GET /api/admin/ai/pause-state/:userId ────────────────
// Get AI pause state for a specific user
router.get("/ai/pause-state/:userId", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    res.json(aiBot.getPauseState(userId));
  } catch (err) {
    console.error("[AI-ADMIN] Pause state error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});


module.exports = router;

// Presence server reference for push notifications
let _presence = null;
function setPresence(p) { _presence = p; }
module.exports.setPresence = setPresence;
