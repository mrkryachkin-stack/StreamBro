// StreamBro — Update Routes
// GET /api/updates/win/latest.yml  — electron-updater format
// GET /api/updates/win/latest.json — HTTP fallback format (portable .zip)
// GET /api/updates/win/*           — static update files

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");

const UPDATES_DIR = path.resolve(process.env.UPDATES_DIR || "./data/updates");

// GET /api/updates/win/latest.yml
router.get("/win/latest.yml", (req, res) => {
  const f = path.join(UPDATES_DIR, "latest.yml");
  if (fs.existsSync(f)) {
    res.type("text/yaml").sendFile(f);
  } else {
    res.status(404).send("version: 0.0.0\n# No latest.yml yet — publish a release first");
  }
});

// GET /api/updates/win/latest.json
router.get("/win/latest.json", (req, res) => {
  const f = path.join(UPDATES_DIR, "latest.json");
  if (fs.existsSync(f)) {
    try {
      res.json(JSON.parse(fs.readFileSync(f, "utf-8")));
    } catch {
      res.status(500).json({ error: "invalid json" });
    }
  } else {
    res.json({
      version: process.env.APP_VERSION || "1.1.0",
      date: new Date().toISOString().slice(0, 10),
      changelog: "Initial release",
      downloadUrl: "https://streambro.ru/download/StreamBro-1.1.0-portable.zip",
    });
  }
});

// Serve other update files (blockmap, exe, etc.)
router.use("/win", express.static(UPDATES_DIR));

module.exports = router;

