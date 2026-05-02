const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// ─── POST /api/stream-events/start ────────────────────────
// Log stream start
router.post("/start", authMiddleware, async (req, res) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: "Укажите платформу" });

  try {
    const event = await req.prisma.streamEvent.create({
      data: { userId: req.user.id, platform },
    });

    res.status(201).json({ id: event.id, startedAt: event.startedAt });
  } catch (err) {
    console.error("[STREAM] Start error:", err);
    res.status(500).json({ error: "Ошибка логирования стрима" });
  }
});

// ─── POST /api/stream-events/:id/end ───────────────────────
// Log stream end
router.post("/:id/end", authMiddleware, async (req, res) => {
  const { reconnects } = req.body;

  try {
    const event = await req.prisma.streamEvent.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: "Событие не найдено" });
    if (event.userId !== req.user.id) return res.status(403).json({ error: "Не ваш стрим" });
    if (event.endedAt) return res.status(400).json({ error: "Стрим уже завершён" });

    const endedAt = new Date();
    const duration = Math.round((endedAt - event.startedAt) / 1000);

    await req.prisma.streamEvent.update({
      where: { id: req.params.id },
      data: {
        endedAt,
        duration,
        reconnects: reconnects || event.reconnects,
      },
    });

    res.json({ ok: true, duration });
  } catch (err) {
    console.error("[STREAM] End error:", err);
    res.status(500).json({ error: "Ошибка завершения стрима" });
  }
});

// ─── POST /api/stream-events/:id/reconnect ────────────────
// Increment reconnect counter
router.post("/:id/reconnect", authMiddleware, async (req, res) => {
  try {
    const event = await req.prisma.streamEvent.findUnique({ where: { id: req.params.id } });
    if (!event) return res.status(404).json({ error: "Событие не найдено" });
    if (event.userId !== req.user.id) return res.status(403).json({ error: "Не ваш стрим" });

    await req.prisma.streamEvent.update({
      where: { id: req.params.id },
      data: { reconnects: { increment: 1 } },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[STREAM] Reconnect error:", err);
    res.status(500).json({ error: "Ошибка" });
  }
});

// ─── GET /api/stream-events/history ────────────────────────
// Get stream history
router.get("/history", authMiddleware, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);

  try {
    const events = await req.prisma.streamEvent.findMany({
      where: { userId: req.user.id },
      orderBy: { startedAt: "desc" },
      take: limit,
    });

    res.json(events);
  } catch (err) {
    console.error("[STREAM] History error:", err);
    res.status(500).json({ error: "Ошибка получения истории" });
  }
});

// ─── GET /api/stream-events/stats ─────────────────────────
// Get aggregate stats
router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const events = await req.prisma.streamEvent.findMany({
      where: { userId: req.user.id, endedAt: { not: null } },
    });

    const totalStreams = events.length;
    const totalDuration = events.reduce((sum, e) => sum + (e.duration || 0), 0);
    const totalReconnects = events.reduce((sum, e) => sum + (e.reconnects || 0), 0);
    const avgDuration = totalStreams > 0 ? Math.round(totalDuration / totalStreams) : 0;
    const byPlatform = {};
    for (const e of events) {
      byPlatform[e.platform] = (byPlatform[e.platform] || 0) + 1;
    }

    // This month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thisMonth = events.filter((e) => e.startedAt >= monthStart);
    const thisMonthDuration = thisMonth.reduce((sum, e) => sum + (e.duration || 0), 0);

    res.json({
      totalStreams,
      totalDuration,
      totalReconnects,
      avgDuration,
      byPlatform,
      thisMonthStreams: thisMonth.length,
      thisMonthDuration,
    });
  } catch (err) {
    console.error("[STREAM] Stats error:", err);
    res.status(500).json({ error: "Ошибка статистики" });
  }
});

module.exports = router;
