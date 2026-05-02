const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// ─── GET /api/friends ──────────────────────────────────────
// List all accepted friends
router.get("/", authMiddleware, async (req, res) => {
  try {
    const friendships = await req.prisma.friendship.findMany({
      where: {
        OR: [
          { requesterId: req.user.id, status: "ACCEPTED" },
          { addresseeId: req.user.id, status: "ACCEPTED" },
        ],
      },
      include: {
        requester: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true } },
        addressee: { select: { id: true, username: true, displayName: true, avatarUrl: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const friends = friendships.map((f) => {
      const isRequester = f.requesterId === req.user.id;
      return isRequester ? f.addressee : f.requester;
    });

    res.json(friends);
  } catch (err) {
    console.error("[FRIENDS] List error:", err);
    res.status(500).json({ error: "Ошибка получения списка друзей" });
  }
});

// ─── GET /api/friends/pending ──────────────────────────────
// List pending friend requests (received)
router.get("/pending", authMiddleware, async (req, res) => {
  try {
    const pending = await req.prisma.friendship.findMany({
      where: { addresseeId: req.user.id, status: "PENDING" },
      include: {
        requester: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const requests = pending.map((f) => ({
      friendshipId: f.id,
      ...f.requester,
      requestedAt: f.createdAt,
    }));

    res.json(requests);
  } catch (err) {
    console.error("[FRIENDS] Pending error:", err);
    res.status(500).json({ error: "Ошибка получения заявок" });
  }
});

// ─── POST /api/friends/request ─────────────────────────────
// Send a friend request
router.post("/request", authMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Укажите userId" });
  if (userId === req.user.id) return res.status(400).json({ error: "Нельзя добавить себя" });

  try {
    // Check if already friends or pending
    const existing = await req.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: userId },
          { requesterId: userId, addresseeId: req.user.id },
        ],
      },
    });

    if (existing) {
      if (existing.status === "ACCEPTED") return res.status(409).json({ error: "Уже в друзьях" });
      if (existing.status === "PENDING") return res.status(409).json({ error: "Заявка уже отправлена" });
      if (existing.status === "BLOCKED") return res.status(403).json({ error: "Заблокировано" });
    }

    // Check target user exists
    const target = await req.prisma.user.findUnique({ where: { id: userId } });
    if (!target) return res.status(404).json({ error: "Пользователь не найден" });

    const friendship = await req.prisma.friendship.create({
      data: { requesterId: req.user.id, addresseeId: userId },
    });

    res.status(201).json({ id: friendship.id, status: "PENDING" });
  } catch (err) {
    console.error("[FRIENDS] Request error:", err);
    res.status(500).json({ error: "Ошибка отправки заявки" });
  }
});

// ─── POST /api/friends/accept ──────────────────────────────
router.post("/accept", authMiddleware, async (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: "Укажите friendshipId" });

  try {
    const friendship = await req.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) return res.status(404).json({ error: "Заявка не найдена" });
    if (friendship.addresseeId !== req.user.id) return res.status(403).json({ error: "Не ваша заявка" });
    if (friendship.status !== "PENDING") return res.status(400).json({ error: "Заявка уже обработана" });

    await req.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: "ACCEPTED" },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[FRIENDS] Accept error:", err);
    res.status(500).json({ error: "Ошибка принятия заявки" });
  }
});

// ─── POST /api/friends/reject ──────────────────────────────
router.post("/reject", authMiddleware, async (req, res) => {
  const { friendshipId } = req.body;
  if (!friendshipId) return res.status(400).json({ error: "Укажите friendshipId" });

  try {
    const friendship = await req.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!friendship) return res.status(404).json({ error: "Заявка не найдена" });
    if (friendship.addresseeId !== req.user.id) return res.status(403).json({ error: "Не ваша заявка" });

    await req.prisma.friendship.delete({ where: { id: friendshipId } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[FRIENDS] Reject error:", err);
    res.status(500).json({ error: "Ошибка отклонения заявки" });
  }
});

// ─── DELETE /api/friends/:userId ───────────────────────────
// Remove a friend
router.delete("/:userId", authMiddleware, async (req, res) => {
  const targetId = req.params.userId;

  try {
    const friendship = await req.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: targetId },
          { requesterId: targetId, addresseeId: req.user.id },
        ],
        status: "ACCEPTED",
      },
    });

    if (!friendship) return res.status(404).json({ error: "Друг не найден" });

    await req.prisma.friendship.delete({ where: { id: friendship.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error("[FRIENDS] Remove error:", err);
    res.status(500).json({ error: "Ошибка удаления друга" });
  }
});

// ─── POST /api/friends/block ───────────────────────────────
router.post("/block", authMiddleware, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "Укажите userId" });

  try {
    // Find or create friendship as BLOCKED
    const existing = await req.prisma.friendship.findFirst({
      where: {
        OR: [
          { requesterId: req.user.id, addresseeId: userId },
          { requesterId: userId, addresseeId: req.user.id },
        ],
      },
    });

    if (existing) {
      await req.prisma.friendship.update({
        where: { id: existing.id },
        data: { status: "BLOCKED" },
      });
    } else {
      await req.prisma.friendship.create({
        data: { requesterId: req.user.id, addresseeId: userId, status: "BLOCKED" },
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[FRIENDS] Block error:", err);
    res.status(500).json({ error: "Ошибка блокировки" });
  }
});

// ─── GET /api/friends/search?q=... ─────────────────────────
// Search users by username
router.get("/search", authMiddleware, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (q.length < 2) return res.json([]);

  try {
    const users = await req.prisma.user.findMany({
      where: {
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { displayName: { contains: q, mode: "insensitive" } },
        ],
        id: { not: req.user.id },
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: 10,
    });

    res.json(users);
  } catch (err) {
    console.error("[FRIENDS] Search error:", err);
    res.status(500).json({ error: "Ошибка поиска" });
  }
});

module.exports = router;
