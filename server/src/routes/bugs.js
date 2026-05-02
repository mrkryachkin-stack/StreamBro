// StreamBro — Bug Report Routes
// POST /api/bugs   — submit bug report (anonymous or authenticated)
// GET  /api/bugs   — list bugs (admin only)
// GET  /api/bugs/stats — stats (admin only)
// DELETE /api/bugs/:id — delete (admin only)

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BUGS_DIR = path.resolve(process.env.BUGS_DIR || "./data/bugs");

// Ensure directory
if (!fs.existsSync(BUGS_DIR)) fs.mkdirSync(BUGS_DIR, { recursive: true });

// Admin auth middleware — accepts ADMIN_SECRET or JWT admin role
function adminOnly(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: "ADMIN_SECRET not configured" });
  const header = req.headers.authorization || "";
  // 1. Direct ADMIN_SECRET bearer token
  if (header === `Bearer ${secret}`) return next();
  // 2. JWT token with admin role (cookie or bearer)
  const token = req.cookies?.token || header.replace("Bearer ", "");
  if (token) {
    try {
      const jwt = require("jsonwebtoken");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded.role === "ADMIN") return next();
    } catch {}
  }
  return res.status(401).json({ error: "unauthorized" });
}

// POST /api/bugs — submit bug report
router.post("/", async (req, res) => {
  const report = req.body;
  if (!report || typeof report !== "object") return res.status(400).json({ error: "invalid body" });

  const type = report.type || "unknown";
  const message = report.message || "";
  if (!message && type === "unknown") return res.status(400).json({ error: "missing message or type" });

  const bugId = crypto.randomUUID();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip;

  // Save to Prisma (primary) + filesystem (fallback)
  try {
    await req.prisma.bugReport.create({
      data: {
        id: bugId,
        type,
        message: message || null,
        stackTrace: report.stackTrace || report.stack || null,
        appVersion: report.appVersion || null,
        platform: report.platform || "win-x64",
        profileId: report.profileId || null,
        ip,
      },
    });
  } catch (e) {
    console.error("[Bugs] Prisma write error:", e.message);
  }

  // Also save to filesystem as backup
  const saved = {
    ...report,
    id: bugId,
    receivedAt: new Date().toISOString(),
    ip,
  };
  const fname = `bug-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
  try {
    fs.writeFileSync(path.join(BUGS_DIR, fname), JSON.stringify(saved, null, 2), "utf-8");
  } catch (e) {
    console.error("[Bugs] File write error:", e.message);
  }

  console.log(`[Bugs] Saved ${type} from ${saved.profileId || "anon"} v${saved.appVersion || "?"}`);
  res.status(200).json({ ok: true, id: bugId });
});

// GET /api/bugs — list bugs (admin)
router.get("/", adminOnly, async (req, res) => {
  try {
    // Try Prisma first
    const bugs = await req.prisma.bugReport.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    if (bugs.length > 0) {
      return res.json({ count: bugs.length, shown: bugs.length, bugs });
    }

    // Fallback to filesystem
    const files = fs.readdirSync(BUGS_DIR).filter((n) => n.endsWith(".json")).sort().reverse();
    const fileBugs = files.slice(0, 200).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), "utf-8")); }
      catch { return null; }
    }).filter(Boolean);
    res.json({ count: files.length, shown: fileBugs.length, bugs: fileBugs });
  } catch (e) {
    res.status(500).json({ error: "read error" });
  }
});

// GET /api/bugs/stats — bug statistics (admin)
router.get("/stats", adminOnly, async (req, res) => {
  try {
    // Try Prisma first
    const total = await req.prisma.bugReport.count();
    if (total > 0) {
      const byType = await req.prisma.bugReport.groupBy({ by: ["type"], _count: { id: true } });
      const byVersion = await req.prisma.bugReport.groupBy({ by: ["appVersion"], _count: { id: true } });
      return res.json({
        total,
        byType: Object.fromEntries(byType.map((b) => [b.type, b._count.id])),
        byVersion: Object.fromEntries(byVersion.map((b) => [b.appVersion || "unknown", b._count.id])),
      });
    }

    // Fallback to filesystem
    const files = fs.readdirSync(BUGS_DIR).filter((n) => n.endsWith(".json"));
    const byType = {};
    const byVersion = {};
    let fileTotal = 0;
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), "utf-8"));
        fileTotal++;
        byType[r.type || "unknown"] = (byType[r.type || "unknown"] || 0) + 1;
        byVersion[r.appVersion || "unknown"] = (byVersion[r.appVersion || "unknown"] || 0) + 1;
      } catch {}
    }
    res.json({ total: fileTotal, byType, byVersion });
  } catch (e) {
    res.status(500).json({ error: "read error" });
  }
});

// DELETE /api/bugs/:id — delete bug (admin)
router.delete("/:id", adminOnly, async (req, res) => {
  const target = req.params.id;
  try {
    // Try Prisma first
    const deleted = await req.prisma.bugReport.deleteMany({ where: { id: target } });
    if (deleted.count > 0) {
      // Also remove from filesystem
      const files = fs.readdirSync(BUGS_DIR).filter((n) => n.endsWith(".json"));
      for (const f of files) {
        try {
          const r = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), "utf-8"));
          if (r.id === target) fs.unlinkSync(path.join(BUGS_DIR, f));
        } catch {}
      }
      return res.json({ ok: true, deleted: target });
    }

    // Fallback: filesystem only
    const files = fs.readdirSync(BUGS_DIR).filter((n) => n.endsWith(".json"));
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), "utf-8"));
        if (r.id === target) {
          fs.unlinkSync(path.join(BUGS_DIR, f));
          return res.json({ ok: true, deleted: f });
        }
      } catch {}
    }
    res.status(404).json({ error: "not found" });
  } catch (e) {
    res.status(500).json({ error: "read error" });
  }
});

module.exports = router;
