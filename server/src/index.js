require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");

const { PrismaClient } = require("@prisma/client");
const { csrfMiddleware } = require("./middleware/auth");
const prisma = new PrismaClient();

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const profileRoutes = require("./routes/profile");
const subscriptionRoutes = require("./routes/subscription");
const downloadRoutes = require("./routes/download");
const bugRoutes = require("./routes/bugs");
const updateRoutes = require("./routes/updates");
const turnRoutes = require("./routes/turn");
const friendsRoutes = require("./routes/friends");
const chatRoutes = require("./routes/chat");
const roomsRoutes = require("./routes/rooms");
const streamEventRoutes = require("./routes/stream-events");
const settingsRoutes = require("./routes/settings");
const adminRoutes = require("./routes/admin");

const PresenceServer = require("./presence");

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3001;

// ─── Presence WebSocket ────────────────────────────────────
const presence = new PresenceServer(server);
presence.setPrisma(prisma);
app.set("presenceServer", presence);

// Inject presence server into routes that need push notifications
friendsRoutes.setPresence(presence);
adminRoutes.setPresence(presence);
chatRoutes.setPresence(presence);

app.set("trust proxy", 1);

// Disable ETag for all responses — prevents Cloudflare from serving 304 Not Modified
// for auth-dependent API responses that were previously cached
app.set("etag", false);

app.use(helmet({
  contentSecurityPolicy: false,
  hsts: false,            // nginx handles HSTS
  frameguard: false,      // nginx handles X-Frame-Options
  noSniff: false,         // nginx handles X-Content-Type-Options
  referrerPolicy: false,  // nginx handles Referrer-Policy
  xssFilter: false,       // nginx handles X-XSS-Protection
}));
app.use(cors({
  origin: process.env.FRONTEND_URL || "https://streambro.ru",
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

// Attach prisma to request
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// ─── Rate limiting (app-level, behind nginx rate limits) ──
const _rl = (max, windowSec) => rateLimit({
  windowMs: windowSec * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown',
  handler: (req, res) => res.status(429).json({ error: "Слишком много запросов, попробуйте позже" }),
  skip: (req) => process.env.NODE_ENV !== 'production',
});
// Strict: auth endpoints — 10 attempts per 5 min
const authLimiter   = _rl(10, 300);
// Moderate: friend requests — 15 per min
const friendsLimiter = _rl(15, 60);
// Chat: 60 messages per min
const chatLimiter   = _rl(60, 60);
// General API: 120 per min
const apiLimiter    = _rl(120, 60);

// ─── CSRF protection ──────────────────────────────────────
app.use("/api", csrfMiddleware);

// ─── Routes ────────────────────────────────────────────────
// Cloudflare cache bypass — prevent CDN from caching any API response
// (Cloudflare respects Surrogate-Control and CDN-Cache-Control)
app.use("/api", (req, res, next) => {
  res.setHeader("Surrogate-Control", "no-store");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.removeHeader("ETag");
  next();
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/user", apiLimiter, userRoutes);
app.use("/api/user", apiLimiter, profileRoutes);
app.use("/api/subscription", apiLimiter, subscriptionRoutes);
app.use("/api/download", apiLimiter, downloadRoutes);
app.use("/api/bugs", apiLimiter, bugRoutes);
app.use("/api/updates", updateRoutes);
app.use("/api/turn", apiLimiter, turnRoutes);
app.use("/api/friends", friendsLimiter, friendsRoutes);
app.use("/api/chat", chatLimiter, chatRoutes.router || chatRoutes);
app.use("/api/rooms", apiLimiter, roomsRoutes);
app.use("/api/stream-events", apiLimiter, streamEventRoutes);
app.use("/api/settings", apiLimiter, settingsRoutes);
app.use("/api/admin", adminRoutes);

// ─── Health check ──────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── 404 ───────────────────────────────────────────────────
app.use("/api", (req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Global error handler ──────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${err.message}`, err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production" ? "Internal error" : err.message,
  });
});

// ─── Room cleanup cron ────────────────────────────────────
// Every hour: close rooms with no active members for >24h, expire old CLOSED rooms
setInterval(async () => {
  try {
    const dayAgo = new Date(Date.now() - 86400000);
    // Close ACTIVE rooms where all members have leftAt set and >24h old
    const staleRooms = await prisma.room.findMany({
      where: { status: "ACTIVE", createdAt: { lt: dayAgo } },
      include: { members: true },
    });
    for (const room of staleRooms) {
      const activeMembers = room.members.filter((m) => !m.leftAt);
      if (activeMembers.length === 0) {
        await prisma.room.update({ where: { id: room.id }, data: { status: "EXPIRED" } });
      }
    }
    // Delete CLOSED rooms older than 7 days
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const oldRooms = await prisma.room.findMany({
      where: { status: { in: ["CLOSED", "EXPIRED"] }, updatedAt: { lt: weekAgo } },
      select: { id: true },
    });
    if (oldRooms.length > 0) {
      await prisma.room.deleteMany({ where: { id: { in: oldRooms.map((r) => r.id) } } });
      console.log(`[ROOMS] Cleaned up ${oldRooms.length} old rooms`);
    }
  } catch (err) {
    console.error("[ROOMS] Cleanup error:", err.message);
  }
}, 3600000); // 1 hour

// ─── Start ─────────────────────────────────────────────────
async function _ensureSupportUser() {
  try {
    let supportUser = await prisma.user.findFirst({ where: { username: "StreamBro" } });
    if (!supportUser) {
      supportUser = await prisma.user.create({
        data: {
          username: "StreamBro",
          email: "support@streambro.ru",
          passwordHash: "_system_",
          role: "SUPPORT",
          displayName: "StreamBro Поддержка",
          avatarUrl: "https://streambro.ru/logo.png",
          emailVerified: true,
          status: "online",
        },
      });
      console.log(`[SUPPORT] Created support user: ${supportUser.id}`);
    }

    // Auto-friend ALL existing users with StreamBro support
    const users = await prisma.user.findMany({
      where: { role: { not: "SUPPORT" } },
      select: { id: true },
    });
    let added = 0;
    for (const u of users) {
      const existing = await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: supportUser.id, addresseeId: u.id },
            { requesterId: u.id, addresseeId: supportUser.id },
          ],
        },
      });
      if (!existing) {
        await prisma.friendship.create({
          data: {
            requesterId: supportUser.id,
            addresseeId: u.id,
            status: "ACCEPTED",
          },
        });
        added++;
      }
    }
    if (added > 0) console.log(`[SUPPORT] Auto-friended ${added} users with StreamBro`);
  } catch (err) {
    console.error("[SUPPORT] Failed to create support user:", err.message);
  }
}

async function start() {
  try {
    await prisma.$connect();
    console.log("[DB] PostgreSQL connected");
    await _ensureSupportUser();
    server.listen(PORT, () => {
      console.log(`[API] StreamBro server running on :${PORT}`);
      console.log(`[PRESENCE] WebSocket on /presence`);
    });
  } catch (err) {
    console.error("[FATAL] Cannot start server:", err);
    process.exit(1);
  }
}

start();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = { presence };
