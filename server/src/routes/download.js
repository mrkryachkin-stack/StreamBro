const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

const CURRENT_VERSION = "1.3.2";

// ─── GET /api/download/latest ──────────────────────────────
// Public — returns latest version info + download URL
router.get("/latest", (_req, res) => {
  res.json({
    version: CURRENT_VERSION,
    platform: "win-x64",
    url: `/api/download/portable/StreamBro-${CURRENT_VERSION}-portable.zip`,
    filename: `StreamBro-${CURRENT_VERSION}-portable.zip`,
    releaseNotes: "https://streambro.ru/changelog",
    minWindowsVersion: "10",
  });
});

// ─── GET /api/download/file ────────────────────────────────
// Streams the installer. In production, replace with S3/CDN redirect.
router.get("/file", authMiddleware, async (req, res) => {
  try {
    // Log the download
    await req.prisma.download.create({
      data: {
        userId: req.user.id,
        version: CURRENT_VERSION,
        platform: "win-x64",
        ip: req.ip,
      },
    });

    // In production: redirect to S3/CDN signed URL
    // For now, return a placeholder response
    const s3Url = process.env.DOWNLOAD_S3_BUCKET
      ? `https://${process.env.DOWNLOAD_S3_BUCKET}.s3.${process.env.DOWNLOAD_S3_REGION}.amazonaws.com/StreamBro-Setup-${CURRENT_VERSION}.exe`
      : null;

    if (s3Url) {
      return res.redirect(s3Url);
    }

    res.json({
      message: "Скачивание доступно после настройки S3/CDN хранилища",
      version: CURRENT_VERSION,
    });
  } catch (err) {
    console.error("[DOWNLOAD] File error:", err);
    res.status(500).json({ error: "Ошибка скачивания" });
  }
});

// ─── GET /api/download/history ─────────────────────────────
router.get("/history", authMiddleware, async (req, res) => {
  try {
    const downloads = await req.prisma.download.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    res.json(downloads);
  } catch (err) {
    console.error("[DOWNLOAD] History error:", err);
    res.status(500).json({ error: "Ошибка получения истории" });
  }
});

// --- Public portable zip download (no auth required) ---
router.get("/portable/:filename", (req, res) => {
  const fs = require("fs");
  const path = require("path");
  const filename = req.params.filename;
  const downloadsDir = path.resolve(process.env.DOWNLOADS_DIR || "./downloads");
  const filePath = path.join(downloadsDir, filename);
  if (!filename.endsWith("-portable.zip")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }
  res.download(filePath, filename);
});

module.exports = router;
