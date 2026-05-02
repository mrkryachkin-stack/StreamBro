const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// ─── GET /api/chat/:userId ────────────────────────────────
// Get chat history with a specific user
router.get("/:userId", authMiddleware, async (req, res) => {
  const otherUserId = req.params.userId;
  const before = req.query.before ? new Date(req.query.before) : undefined;
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 100);

  try {
    const where = {
      OR: [
        { senderId: req.user.id, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: req.user.id },
      ],
      ...(before && { createdAt: { lt: before } }),
    };

    const messages = await req.prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Mark unread as read
    await req.prisma.message.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: req.user.id,
        read: false,
      },
      data: { read: true },
    });

    res.json(messages.reverse());
  } catch (err) {
    console.error("[CHAT] History error:", err);
    res.status(500).json({ error: "Ошибка получения истории" });
  }
});

// ─── POST /api/chat/:userId ────────────────────────────────
// Send a message
router.post("/:userId", authMiddleware, async (req, res) => {
  const receiverId = req.params.userId;
  const { content } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: "Пустое сообщение" });
  if (content.length > 2000) return res.status(400).json({ error: "Слишком длинное сообщение" });

  try {
    // Verify they are friends
    const friendship = await req.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: receiverId },
          { requesterId: receiverId, addresseeId: req.user.id },
        ],
        status: "ACCEPTED",
      },
    });

    if (!friendship) return res.status(403).json({ error: "Можно писать только друзьям" });

    const message = await req.prisma.message.create({
      data: {
        senderId: req.user.id,
        receiverId,
        content: content.trim(),
      },
    });

    res.status(201).json(message);
  } catch (err) {
    console.error("[CHAT] Send error:", err);
    res.status(500).json({ error: "Ошибка отправки сообщения" });
  }
});

// ─── PATCH /api/chat/message/:messageId ────────────────────
// Edit a message (only own messages, within 24h)
router.patch("/message/:messageId", authMiddleware, async (req, res) => {
  const { messageId } = req.params;
  const { content } = req.body;

  if (!content || !content.trim()) return res.status(400).json({ error: "Пустое сообщение" });
  if (content.length > 2000) return res.status(400).json({ error: "Слишком длинное сообщение" });

  try {
    const message = await req.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
    if (message.senderId !== req.user.id) return res.status(403).json({ error: "Можно редактировать только свои сообщения" });

    // 24h edit window
    const hoursSinceCreation = (Date.now() - new Date(message.createdAt).getTime()) / 3600000;
    if (hoursSinceCreation > 24) return res.status(400).json({ error: "Время редактирования истекло (24ч)" });

    const updated = await req.prisma.message.update({
      where: { id: messageId },
      data: { content: content.trim(), edited: true },
    });

    res.json(updated);
  } catch (err) {
    console.error("[CHAT] Edit error:", err);
    res.status(500).json({ error: "Ошибка редактирования" });
  }
});

// ─── DELETE /api/chat/message/:messageId ────────────────────
// Delete a message (only own messages)
router.delete("/message/:messageId", authMiddleware, async (req, res) => {
  const { messageId } = req.params;

  try {
    const message = await req.prisma.message.findUnique({ where: { id: messageId } });
    if (!message) return res.status(404).json({ error: "Сообщение не найдено" });
    if (message.senderId !== req.user.id) return res.status(403).json({ error: "Можно удалять только свои сообщения" });

    await req.prisma.message.delete({ where: { id: messageId } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[CHAT] Delete error:", err);
    res.status(500).json({ error: "Ошибка удаления" });
  }
});

// ─── GET /api/chat/unread/count ────────────────────────────
// Get unread message count
router.get("/unread/count", authMiddleware, async (req, res) => {
  try {
    const count = await req.prisma.message.count({
      where: { receiverId: req.user.id, read: false },
    });
    res.json({ count });
  } catch (err) {
    console.error("[CHAT] Unread error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

module.exports = router;
