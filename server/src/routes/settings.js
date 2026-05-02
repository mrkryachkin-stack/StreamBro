const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// ─── GET /api/settings ────────────────────────────────────
// Get encrypted settings blob
router.get("/", authMiddleware, async (req, res) => {
  try {
    const blob = await req.prisma.settingsBlob.findUnique({
      where: { userId: req.user.id },
    });

    if (!blob) return res.json({ exists: false });

    res.json({
      exists: true,
      encryptedData: blob.encryptedData,
      iv: blob.iv,
      version: blob.version,
      updatedAt: blob.updatedAt,
    });
  } catch (err) {
    console.error("[SETTINGS] Get error:", err);
    res.status(500).json({ error: "Ошибка получения настроек" });
  }
});

// ─── PUT /api/settings ────────────────────────────────────
// Upload encrypted settings blob
router.put("/", authMiddleware, async (req, res) => {
  const { encryptedData, iv } = req.body;

  if (!encryptedData || !iv) {
    return res.status(400).json({ error: "Укажите encryptedData и iv" });
  }

  if (encryptedData.length > 500000) {
    return res.status(400).json({ error: "Настройки слишком большие (макс 500 КБ)" });
  }

  try {
    const blob = await req.prisma.settingsBlob.upsert({
      where: { userId: req.user.id },
      update: {
        encryptedData,
        iv,
        version: { increment: 1 },
      },
      create: {
        userId: req.user.id,
        encryptedData,
        iv,
      },
    });

    res.json({ ok: true, version: blob.version, updatedAt: blob.updatedAt });
  } catch (err) {
    console.error("[SETTINGS] Save error:", err);
    res.status(500).json({ error: "Ошибка сохранения настроек" });
  }
});

// ─── DELETE /api/settings ─────────────────────────────────
router.delete("/", authMiddleware, async (req, res) => {
  try {
    await req.prisma.settingsBlob.deleteMany({
      where: { userId: req.user.id },
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[SETTINGS] Delete error:", err);
    res.status(500).json({ error: "Ошибка удаления настроек" });
  }
});

module.exports = router;
