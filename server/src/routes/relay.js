// StreamBro RTMP Relay — WebSocket endpoint for browser-based streaming
//
// Browser sends WebM chunks via WebSocket → server pipes to FFmpeg → RTMP
//
// Protocol:
//   1. Client connects to /api/relay (WebSocket, authenticated via JWT cookie)
//   2. Client sends: { type: "start", rtmpUrl: "rtmp://..." }
//   3. Server spawns FFmpeg: -f webm -i - -c:v libx264 ... -f flv rtmpUrl
//   4. Client sends: ArrayBuffer (WebM chunk) → written to FFmpeg stdin
//   5. Client sends: { type: "stop" } → FFmpeg killed gracefully
//
// Based on the same FFmpeg args as desktop main.js (see AGENTS.md §5.2)

const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");

const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const STALL_TIMEOUT = 10000; // 10s no data → kill FFmpeg
const MAX_ATTEMPTS = 3;

// Get FFmpeg path (same logic as desktop main.js)
function getFFmpegPath() {
  const candidates = [
    path.join(__dirname, "../../vendor/ffmpeg.exe"),           // dev
    path.join(__dirname, "../../vendor/ffmpeg"),               // linux
    "/usr/bin/ffmpeg",                                          // docker
    "/usr/local/bin/ffmpeg",                                    // manual install
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Fallback: hope ffmpeg is in PATH
  return "ffmpeg";
}

function buildFFmpegArgs(rtmpUrl, width = 1920, height = 1080, fps = 30, bitrate = 6000) {
  const g = fps * 2; // GOP = 2 seconds
  return [
    "-loglevel", "level+info",
    "-hide_banner",
    "-fflags", "+igndts+discardcorrupt",
    "-thread_queue_size", "1024",
    "-f", "webm",
    "-i", "-",  // stdin
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-fps_mode", "cfr",
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-profile:v", "main",
    "-level", "4.1",
    "-b:v", `${bitrate}k`,
    "-maxrate", `${bitrate}k`,
    "-bufsize", `${bitrate}k`,
    "-pix_fmt", "yuv420p",
    "-g", String(g),
    "-keyint_min", String(g),
    "-sc_threshold", "0",
    "-x264-params", `nal-hrd=cbr:keyint=${g}:min-keyint=${g}:scenecut=0`,
    "-af", "aresample=async=1000:first_pts=0",
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "48000",
    "-ac", "2",
    "-f", "flv",
    "-flv_flags", "no_duration_filesize",
    rtmpUrl,
  ];
}

// Mask stream key in log output
function maskKey(str) {
  return str
    .replace(/rtmps?:\/\/[^\s]+/gi, "rtmp://<server>/<key>")
    .replace(/\bsk_[A-Za-z0-9_-]{8,}/g, "<key>");
}

// Gracefully kill FFmpeg process
function safeKill(ffmpeg) {
  if (!ffmpeg || ffmpeg.exitCode !== null) return;
  try {
    ffmpeg.stdin?.write("q\n");
    ffmpeg.stdin?.end();
  } catch {}
  setTimeout(() => {
    try { ffmpeg.kill("SIGTERM"); } catch {}
  }, 500);
  setTimeout(() => {
    try { ffmpeg.kill("SIGKILL"); } catch {}
  }, 2000);
}

class RelaySession {
  constructor(ws, userId) {
    this.ws = ws;
    this.userId = userId;
    this.ffmpeg = null;
    this.attempts = 0;
    this.rtmpUrl = null;
    this.stallTimer = null;
    this.lastChunkTime = 0;
    this.width = 1920;
    this.height = 1080;
    this.fps = 30;
    this.bitrate = 6000;
  }

  start(rtmpUrl, opts = {}) {
    this.rtmpUrl = rtmpUrl;
    this.width = opts.width || 1920;
    this.height = opts.height || 1080;
    this.fps = opts.fps || 30;
    this.bitrate = opts.bitrate || 6000;
    this._spawnFFmpeg();
  }

  _spawnFFmpeg() {
    if (this.attempts >= MAX_ATTEMPTS) {
      this._sendStatus("error", `Превышен лимит попыток (${MAX_ATTEMPTS})`);
      return;
    }

    const ffmpegPath = getFFmpegPath();
    const args = buildFFmpegArgs(this.rtmpUrl, this.width, this.height, this.fps, this.bitrate);

    console.log(`[RELAY] User ${this.userId}: starting FFmpeg with ${maskKey(ffmpegPath)}`);
    this.ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    this.attempts++;

    this.ffmpeg.stdin.on("error", (err) => {
      console.warn(`[RELAY] FFmpeg stdin error: ${err.message}`);
    });

    this.ffmpeg.stderr.on("data", (data) => {
      const line = data.toString().trim();
      if (line && !line.startsWith("frame=") && !line.startsWith("Input #") && !line.startsWith("Output #")) {
        console.log(`[RELAY-FFMPEG] ${maskKey(line)}`);
      }
    });

    this.ffmpeg.on("close", (code) => {
      console.log(`[RELAY] FFmpeg exited with code ${code}`);
      clearInterval(this.stallTimer);
      this.ffmpeg = null;

      if (code !== 0 && this.ws.readyState === 1) {
        // If we haven't reached "live" yet, try reconnecting
        if (this.attempts < MAX_ATTEMPTS) {
          console.log(`[RELAY] Reconnecting attempt ${this.attempts}/${MAX_ATTEMPTS}...`);
          setTimeout(() => this._spawnFFmpeg(), 3000);
          this._sendStatus("reconnecting", `Попытка ${this.attempts}/${MAX_ATTEMPTS}`);
        } else {
          this._sendStatus("error", `FFmpeg exited with code ${code}`);
        }
      }
    });

    // Stall watchdog
    this.lastChunkTime = Date.now();
    this.stallTimer = setInterval(() => {
      if (Date.now() - this.lastChunkTime > STALL_TIMEOUT) {
        console.warn(`[RELAY] Stall detected (no data for ${STALL_TIMEOUT / 1000}s), killing FFmpeg`);
        safeKill(this.ffmpeg);
      }
    }, 2000);

    this._sendStatus("live", "Стрим запущен");
  }

  writeChunk(data) {
    if (!this.ffmpeg || this.ffmpeg.exitCode !== null) return;
    try {
      this.ffmpeg.stdin.write(data);
      this.lastChunkTime = Date.now();
    } catch (err) {
      console.warn(`[RELAY] Write error: ${err.message}`);
    }
  }

  stop() {
    clearInterval(this.stallTimer);
    safeKill(this.ffmpeg);
    this.ffmpeg = null;
    this.attempts = MAX_ATTEMPTS; // prevent reconnect
    this._sendStatus("offline", "Стрим остановлен");
  }

  _sendStatus(status, message) {
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: "status", status, message }));
    }
  }
}

// ─── WebSocket Relay Server ───
let relayWss = null;
const sessions = new Map(); // userId → RelaySession

function initRelayServer(server) {
  relayWss = new WebSocketServer({ server, path: "/api/relay" });

  relayWss.on("connection", (ws, req) => {
    ws.isAlive = true;
    ws.userId = null;
    ws.session = null;

    // Try to authenticate from cookie on upgrade request
    const cookieStr = req.headers.cookie || "";
    const tokenMatch = cookieStr.match(/(?:^|;\s*)token=([^;]+)/);
    if (tokenMatch) {
      try {
        const decoded = jwt.verify(tokenMatch[1], JWT_SECRET);
        ws.userId = decoded.id || decoded.userId;
        console.log(`[RELAY] User ${ws.userId} authenticated via cookie`);
      } catch {
        // Cookie auth failed, wait for explicit auth message
      }
    }

    // Auth timeout (skip if already authenticated via cookie)
    if (!ws.userId) {
      ws._authTimeout = setTimeout(() => {
        if (!ws.userId) ws.close(4001, "auth timeout");
      }, 10000);
    }

    ws.on("pong", () => { ws.isAlive = true; });

    ws.on("message", (raw) => {
      // Binary data = WebM chunk
      if (typeof raw !== "string" && !Buffer.isBuffer(raw) && !(raw instanceof ArrayBuffer)) {
        // Could be Buffer from ws
      }

      if (typeof raw === "string" || (Buffer.isBuffer(raw) && raw[0] === 0x7b)) {
        // JSON message
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        _handleMessage(ws, msg);
      } else {
        // Binary chunk → pipe to FFmpeg
        if (ws.session) {
          ws.session.writeChunk(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
        }
      }
    });

    ws.on("close", () => {
      clearTimeout(ws._authTimeout);
      if (ws.session) {
        ws.session.stop();
        sessions.delete(ws.userId);
      }
    });
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    if (!relayWss) return;
    relayWss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  relayWss.on("close", () => clearInterval(heartbeat));

  console.log("[RELAY] WebSocket RTMP relay server started on /api/relay");
}

function _handleMessage(ws, msg) {
  switch (msg.type) {
    case "auth": {
      clearTimeout(ws._authTimeout);
      try {
        const decoded = jwt.verify(msg.token || "", JWT_SECRET);
        ws.userId = decoded.id || decoded.userId;
        console.log(`[RELAY] User ${ws.userId} authenticated (explicit)`);
        ws.send(JSON.stringify({ type: "auth", ok: true }));
      } catch {
        ws.send(JSON.stringify({ type: "auth", ok: false, error: "Invalid token" }));
        ws.close(4003, "auth failed");
      }
      break;
    }

    case "auth-check": {
      clearTimeout(ws._authTimeout);
      if (ws.userId) {
        ws.send(JSON.stringify({ type: "auth", ok: true }));
      } else {
        ws.send(JSON.stringify({ type: "auth", ok: false, error: "Not authenticated" }));
        ws.close(4003, "not authenticated");
      }
      break;
    }

    case "start": {
      if (!ws.userId) {
        ws.send(JSON.stringify({ type: "error", message: "Not authenticated" }));
        return;
      }
      if (!msg.rtmpUrl) {
        ws.send(JSON.stringify({ type: "error", message: "Missing rtmpUrl" }));
        return;
      }

      // Kill existing session if any
      if (ws.session) ws.session.stop();

      const session = new RelaySession(ws, ws.userId);
      session.start(msg.rtmpUrl, {
        width: msg.width || 1920,
        height: msg.height || 1080,
        fps: msg.fps || 30,
        bitrate: msg.bitrate || 6000,
      });
      ws.session = session;
      sessions.set(ws.userId, session);
      break;
    }

    case "stop": {
      if (ws.session) {
        ws.session.stop();
        ws.session = null;
        sessions.delete(ws.userId);
      }
      break;
    }
  }
}

module.exports = { initRelayServer, sessions };
