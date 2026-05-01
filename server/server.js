// StreamBro API Server — Express
// Handles: bug reports, auto-updates, health check
// Future: auth, friends, chat

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'change-me';
const BUGS_DIR = path.resolve(process.env.BUGS_DIR || './data/bugs');
const UPDATES_DIR = path.resolve(process.env.UPDATES_DIR || './data/updates');

// ─── Middleware ───
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// General rate limit
app.use(rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false }));

// ─── Ensure data dirs ───
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(BUGS_DIR);
ensureDir(UPDATES_DIR);

// ─── Health ───
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'streambro-api', version: '1.0.0', ts: Date.now() });
});

// ─── Bug Reports ───
const bugLimiter = rateLimit({ windowMs: 60 * 1000, max: 10 });

app.post('/bugs', bugLimiter, (req, res) => {
  const report = req.body;
  if (!report || typeof report !== 'object') {
    return res.status(400).json({ error: 'invalid body' });
  }

  // Validate required fields
  const type = report.type || 'unknown';
  const message = report.message || '';
  if (!message && type === 'unknown') {
    return res.status(400).json({ error: 'missing message or type' });
  }

  // Enrich
  const saved = {
    ...report,
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip,
  };

  // Save to disk
  const fname = `bug-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.json`;
  try {
    fs.writeFileSync(path.join(BUGS_DIR, fname), JSON.stringify(saved, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Bugs] Write error:', e.message);
    return res.status(500).json({ error: 'storage error' });
  }

  console.log(`[Bugs] Saved ${type} from ${saved.profileId || 'anon'} v${saved.appVersion || '?'}`);
  res.status(200).json({ ok: true, id: saved.id });
});

// Admin: list bugs (requires secret)
app.get('/bugs', (req, res) => {
  if (req.headers.authorization !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const files = fs.readdirSync(BUGS_DIR).filter(n => n.endsWith('.json')).sort().reverse();
    const bugs = files.slice(0, 200).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), 'utf-8')); }
      catch { return null; }
    }).filter(Boolean);
    res.json({ count: files.length, shown: bugs.length, bugs });
  } catch (e) {
    res.status(500).json({ error: 'read error' });
  }
});

// Admin: bug stats
app.get('/bugs/stats', (req, res) => {
  if (req.headers.authorization !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const files = fs.readdirSync(BUGS_DIR).filter(n => n.endsWith('.json'));
    const byType = {};
    const byVersion = {};
    let total = 0;
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), 'utf-8'));
        total++;
        byType[r.type || 'unknown'] = (byType[r.type || 'unknown'] || 0) + 1;
        byVersion[r.appVersion || 'unknown'] = (byVersion[r.appVersion || 'unknown'] || 0) + 1;
      } catch {}
    }
    res.json({ total, byType, byVersion, oldestFile: files[files.length - 1], newestFile: files[0] });
  } catch (e) {
    res.status(500).json({ error: 'read error' });
  }
});

// Admin: delete bug
app.delete('/bugs/:id', (req, res) => {
  if (req.headers.authorization !== `Bearer ${ADMIN_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const target = req.params.id;
  try {
    const files = fs.readdirSync(BUGS_DIR).filter(n => n.endsWith('.json'));
    for (const f of files) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(BUGS_DIR, f), 'utf-8'));
        if (r.id === target) {
          fs.unlinkSync(path.join(BUGS_DIR, f));
          return res.json({ ok: true, deleted: f });
        }
      } catch {}
    }
    res.status(404).json({ error: 'not found' });
  } catch (e) {
    res.status(500).json({ error: 'read error' });
  }
});

// ─── Updates ───
// electron-updater format (for NSIS builds)
app.get('/win/latest.yml', (req, res) => {
  const f = path.join(UPDATES_DIR, 'latest.yml');
  if (fs.existsSync(f)) {
    res.type('text/yaml').sendFile(f);
  } else {
    res.status(404).send('version: 0.0.0\n# No latest.yml yet — publish a release first');
  }
});

// HTTP fallback format (for portable .zip — used by auto-updater.js _httpCheck)
app.get('/win/latest.json', (req, res) => {
  const f = path.join(UPDATES_DIR, 'latest.json');
  if (fs.existsSync(f)) {
    res.json(JSON.parse(fs.readFileSync(f, 'utf-8')));
  } else {
    res.json({
      version: process.env.APP_VERSION || '1.1.0',
      date: new Date().toISOString().slice(0, 10),
      changelog: 'Initial release',
      downloadUrl: 'https://streambro.online/downloads/StreamBro-1.1.0-portable.zip',
    });
  }
});

// Serve update files (blockmap, exe, etc.)
app.use('/win', express.static(UPDATES_DIR));

// ─── Catch-all ───
app.use((req, res) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

// ─── Start ───
app.listen(PORT, '0.0.0.0', () => {
  console.log(`StreamBro API listening on http://0.0.0.0:${PORT}`);
  console.log(`  Bugs dir:  ${BUGS_DIR}`);
  console.log(`  Updates:   ${UPDATES_DIR}`);
});
