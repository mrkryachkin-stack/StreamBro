const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");
const { changePasswordSchema } = require("../utils/validation");

// ─── GET /api/user/me ─────────────────────────────────────
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        status: true,
        role: true,
        emailVerified: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            currentPeriodEnd: true,
            cancelAtEnd: true,
          },
        },
      },
    });
    if (!user) return res.status(404).json({ error: "Пользователь не найден" });
    res.json(user);
  } catch (err) {
    console.error("[USER] Me error:", err);
    res.status(500).json({ error: "Ошибка получения профиля" });
  }
});

// ─── PATCH /api/user/me ────────────────────────────────────
router.patch("/me", authMiddleware, async (req, res) => {
  const { displayName, avatarUrl, username } = req.body;

  // Validate username if changing
  if (username !== undefined) {
    if (!username || username.length < 2) {
      return res.status(400).json({ error: "Имя пользователя минимум 2 символа" });
    }
    if (username.length > 30) {
      return res.status(400).json({ error: "Имя пользователя максимум 30 символов" });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return res.status(400).json({ error: "Только латиница, цифры, _ и -" });
    }
    // Check if taken by another user
    const taken = await req.prisma.user.findFirst({
      where: { username, NOT: { id: req.user.id } },
    });
    if (taken) {
      return res.status(409).json({ error: "Это имя уже занято" });
    }
  }

  try {
    const user = await req.prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(username !== undefined && { username }),
      },
      select: {
        id: true, email: true, username: true, displayName: true, avatarUrl: true, role: true,
      },
    });
    res.json(user);
  } catch (err) {
    console.error("[USER] Update error:", err);
    res.status(500).json({ error: "Ошибка обновления профиля" });
  }
});

// ─── POST /api/user/change-password ───────────────────────
router.post("/change-password", authMiddleware, async (req, res) => {
  const parse = changePasswordSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.errors[0].message });
  }
  const { currentPassword, newPassword } = parse.data;

  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.user.id },
      select: { passwordHash: true },
    });
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Неверный текущий пароль" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await req.prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[USER] Change password error:", err);
    res.status(500).json({ error: "Ошибка смены пароля" });
  }
});

// ─── GET /api/user/test-cookie ──────────────────────────
// Diagnostic: checks if a valid auth cookie is present
router.get("/test-cookie", (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.replace("Bearer ", "");
  if (!token) {
    return res.status(401).json({ error: "No cookie received", hasCookie: false });
  }
  try {
    const jwt = require("jsonwebtoken");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.json({ hasCookie: true, username: decoded.username, iat: decoded.iat, exp: decoded.exp });
  } catch (err) {
    return res.status(401).json({ error: err.message, hasCookie: true, valid: false });
  }
});

module.exports = router;
