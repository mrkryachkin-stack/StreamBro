const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { authMiddleware } = require("../middleware/auth");

// Generates time-limited TURN credentials using HMAC
// (coturn must be configured with use-auth-secret + same static-auth-secret)

// ─── GET /api/turn/credentials ─────────────────────────────
router.get("/credentials", authMiddleware, (req, res) => {
  const secret = process.env.COTURN_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "TURN сервер не настроен" });
  }

  // Credentials valid for 24 hours
  const ttl = 86400;
  const timestamp = Math.floor(Date.now() / 1000) + ttl;

  // Username = "timestamp:userId"
  const username = `${timestamp}:${req.user.id}`;

  // Password = HMAC-SHA1(secret, username)
  const password = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  res.json({
    urls: [
      `turn:streambro.ru:3478?transport=udp`,
      `turn:streambro.ru:3478?transport=tcp`,
      `turns:streambro.ru:5349?transport=tcp`,
    ],
    username,
    password,
    ttl,
  });
});

module.exports = router;
