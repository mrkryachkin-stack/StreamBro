const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { authMiddleware } = require("../middleware/auth");

// ─── Avatar upload setup (multer) ──────────────────────────
const multer = require("multer");
const UPLOAD_DIR = process.env.AVATAR_DIR || path.join(__dirname, "../../uploads/avatars");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
}

const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `${req.user.id}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("Only jpg, png, gif, webp allowed"));
  },
});

// ─── POST /api/user/profile/avatar ────────────────────────
router.post("/profile/avatar", authMiddleware, avatarUpload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const baseUrl = process.env.FRONTEND_URL || "https://streambro.ru";
  const avatarUrl = `${baseUrl}/api/user/avatars/${req.file.filename}`;

  try {
    const user = await req.prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl },
      select: { id: true, username: true, avatarUrl: true },
    });
    res.json(user);
  } catch (err) {
    console.error("[USER] Avatar upload error:", err);
    res.status(500).json({ error: "Ошибка сохранения аватара" });
  }
});

// ─── PATCH /api/user/profile ──────────────────────────────
// Update public profile (bio, status, avatarUrl, displayName)
router.patch("/profile", authMiddleware, async (req, res) => {
  const { displayName, avatarUrl, bio, status } = req.body;

  const allowedStatuses = ["online", "streaming", "away", "dnd", "offline"];
  if (status && !allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Некорректный статус" });
  }

  if (bio && bio.length > 300) {
    return res.status(400).json({ error: "Bio слишком длинное (макс 300 символов)" });
  }

  try {
    const user = await req.prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(bio !== undefined && { bio }),
        ...(status !== undefined && { status }),
      },
      select: {
        id: true, username: true, displayName: true, avatarUrl: true, bio: true, status: true,
      },
    });

    res.json(user);
  } catch (err) {
    console.error("[USER] Profile update error:", err);
    res.status(500).json({ error: "Ошибка обновления профиля" });
  }
});

// ─── GET /api/user/avatars/:filename ─────────────────────
// Serve avatar files (since nginx may not have access to upload dir)
router.get("/avatars/:filename", (req, res) => {
  const fs = require("fs");
  const path = require("path");
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
  res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
  res.setHeader("Cache-Control", "public, max-age=2592000"); // 30 days
  fs.createReadStream(filePath).pipe(res);
});

// ─── GET /api/user/:username/profile ──────────────────────
// Get public profile of any user
router.get("/:username/profile", async (req, res) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { username: req.params.username },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        status: true,
        createdAt: true,
      },
    });

    if (!user) return res.status(404).json({ error: "Пользователь не найден" });

    res.json(user);
  } catch (err) {
    console.error("[USER] Public profile error:", err);
    res.status(500).json({ error: "Ошибка получения профиля" });
  }
});

module.exports = router;
