const { app, BrowserWindow, ipcMain, desktopCapturer, dialog, shell, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const wasapi = require('./wasapi-capture');
const settingsMod = require('./settings');
const profileMgr = require('./modules/profile-manager');
const friendsStore = require('./modules/friends-store');
const bugReporter = require('./modules/bug-reporter');
const autoUpdater = require('./modules/auto-updater');

const IS_PACKAGED = app.isPackaged;

// ─── Deep-link protocol: streambro://login?token=... ───
// Registers StreamBro as the OS handler for the streambro:// scheme so the
// website can drop an authenticated session into the desktop app after signup.
function _registerProtocol() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('streambro', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('streambro');
  }
}
_registerProtocol();

// In production we keep the safer defaults. In dev we keep the workaround flags
// for getDisplayMedia + chromeMediaSource constraint quirks in some Electron 33 builds.
if (!IS_PACKAGED) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-site-isolation');
}
app.commandLine.appendSwitch('enable-features', 'WebRtcAllowInputVolumeAdjustments,DesktopCaptureMediaAudio');

// Single instance lock — prevents multiple StreamBro windows competing for audio/video devices
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow;
let signalingServerProcess = null;
let ffmpegRecProcess = null;
let ffmpegStreamProcess = null;
let ffmpegStreamReconnectTimer = null;
let ffmpegStreamArgs = null; // saved for auto-reconnect
let ffmpegStreamAttempts = 0; // consecutive failed attempts (resets on live)
const FFMPEG_STREAM_MAX_ATTEMPTS = 3;

let appSettings = null; // loaded on app ready

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'StreamBro',
    backgroundColor: '#08081a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
      experimentalFeatures: true,
      spellcheck: false,
    },
    icon: path.join(__dirname, 'assets', IS_PACKAGED ? 'icon.ico' : 'icon.png'),
    show: false,
    frame: true,
    autoHideMenuBar: true,
  });

  // Hide the menu in production (kept available for F12 in dev)
  if (IS_PACKAGED) {
    Menu.setApplicationMenu(null);
  }

  // Allow only the media permissions we actually need
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['audioCapture', 'videoCapture', 'media', 'desktopCapture', 'displayCapture', 'clipboard-read', 'clipboard-sanitized-write'];
    if (!IS_PACKAGED) console.log('[SB] Permission request:', permission, '->', allowed.includes(permission));
    callback(allowed.includes(permission));
  });

  // getDisplayMedia: ask renderer to pick the source via custom UI (we have one).
  // The renderer first calls 'get-media-sources' and shows the picker, then triggers
  // getUserMedia with chromeMediaSourceId — that path bypasses this handler.
  // The handler below is only used when the renderer calls getDisplayMedia({...}).
  // We pass the 'preferred-source' through a stash that the renderer sets via IPC.
  let _preferredDisplaySource = null;
  ipcMain.handle('set-preferred-display-source', (_event, srcId) => {
    _preferredDisplaySource = srcId || null;
    return { success: true };
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!IS_PACKAGED) console.log('[SB] DisplayMedia request: video=', !!request.video, 'audio=', !!request.audio, 'preferred=', _preferredDisplaySource);
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then(sources => {
      let chosen = null;
      if (_preferredDisplaySource) {
        chosen = sources.find(s => s.id === _preferredDisplaySource);
      }
      if (!chosen) chosen = sources.find(s => s.id.startsWith('screen:')) || sources[0];
      _preferredDisplaySource = null;
      if (chosen) {
        callback({ video: chosen, audio: 'loopback' });
      } else {
        callback({});
      }
    }).catch(err => {
      console.error('[SB] DisplayMedia error:', err);
      callback({});
    });
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Forward renderer console messages to terminal — only in dev
  if (!IS_PACKAGED) {
    mainWindow.webContents.on('console-message', (event, level, message) => {
      const prefix = level === 2 ? '[RErr]' : level === 1 ? '[RWarn]' : '[RLog]';
      console.log(prefix, message);
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Bring window to front on launch (Windows z-order can bury new windows)
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    setTimeout(() => { mainWindow.setAlwaysOnTop(false); }, 1500);
  });

  // Set WASAPI module main window reference
  wasapi.setMainWindow(mainWindow);

  mainWindow.on('closed', () => {
    wasapi.setMainWindow(null);
    wasapi.stopCapture();
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in the system browser; deny everything else.
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block in-app navigation to external sites — we are a local app
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:/i.test(navUrl)) shell.openExternal(navUrl);
    }
  });
}

// Last-resort safety net: an EPIPE / write-EOF from a dying ffmpeg pipe must NOT
// blow up the main process and show the scary native error dialog.
process.on('uncaughtException', (err) => {
  const code = err && (err.code || err.errno);
  const msg = (err && err.message) || String(err);
  if (code === 'EPIPE' || code === 'ECONNRESET' || /write EOF|EPIPE|ECONNRESET/i.test(msg)) {
    console.warn('[SB] swallowed pipe error:', code, msg);
    return;
  }
  console.error('[SB] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[SB] unhandledRejection:', reason);
});

app.whenReady().then(() => {
  appSettings = settingsMod.loadSettings();

  // Profile / friends / bug-reporter / auto-updater wiring.
  // Each module gets the shared settings object (mutates in place) and a save
  // callback so the renderer is notified after persistence.
  profileMgr.init(appSettings, (s) => { appSettings = s; _emit('profile-updated', profileMgr.getPublic()); });
  friendsStore.init(appSettings, (s) => { appSettings = s; }, (channel, data) => _emit(channel, data));
  bugReporter.init(appSettings, (s) => { appSettings = s; });
  autoUpdater.init(appSettings, (channel, data) => _emit(channel, data), app.getVersion());

  createWindow();

  // macOS deep link arrives via 'open-url'; on Windows it arrives via
  // process.argv on second-instance.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    profileMgr.handleDeepLink(url);
  });
});

// Handle Windows deep-link cold start (URL is appended to process.argv)
function _consumeDeepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return;
  for (const arg of argv) {
    if (typeof arg === 'string' && arg.startsWith('streambro://')) {
      profileMgr.handleDeepLink(arg);
    }
  }
}
_consumeDeepLinkFromArgv(process.argv);

app.on('second-instance', (_event, argv) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  _consumeDeepLinkFromArgv(argv);
});

app.on('window-all-closed', () => {
  stopSignalingServer();
  app.quit();
});

app.on('before-quit', () => {
  stopSignalingServer();
  stopFFmpegRec();
  stopFFmpegStream();
  bugReporter.shutdown();
  autoUpdater.shutdown();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

// --- Signaling Server ---

function startSignalingServer() {
  if (signalingServerProcess) return 'already_running';
  const serverPath = path.join(__dirname, 'signaling-server', 'server.js');
  // In packaged app, spawn from app.asar.unpacked — see electron-builder config
  signalingServerProcess = spawn(process.execPath, [serverPath], {
    env: { ...process.env, SIGNALING_PORT: '7890', ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  signalingServerProcess.stdout.on('data', (data) => { if (!IS_PACKAGED) console.log('[Сигналинг]', data.toString().trim()); });
  signalingServerProcess.stderr.on('data', (data) => { console.error('[Сигналинг Ошибка]', data.toString().trim()); });
  signalingServerProcess.on('close', (code) => { if (!IS_PACKAGED) console.log(`[Сигналинг] Завершён с кодом ${code}`); signalingServerProcess = null; });
  return 'started';
}

function stopSignalingServer() {
  if (signalingServerProcess) { signalingServerProcess.kill(); signalingServerProcess = null; }
}

// --- FFmpeg utilities ---

function getFFmpegPath() {
  // Priority 1: bundled FFmpeg in /vendor (SChannel build for AWS IVS / Kick / Twitch RTMPS).
  // GnuTLS-based ffmpeg-static fails AWS IVS handshakes ("Decryption has failed"),
  // so we ship a Windows-SChannel build alongside the app.
  try {
    const vendorPath = IS_PACKAGED
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'vendor', 'ffmpeg.exe')
      : path.join(__dirname, 'vendor', 'ffmpeg.exe');
    if (fs.existsSync(vendorPath)) return vendorPath;
  } catch (e) {
    if (!IS_PACKAGED) console.warn('[SB] vendor ffmpeg lookup failed:', e);
  }

  // Priority 2: fallback to ffmpeg-static (gnutls; works for non-IVS endpoints).
  try {
    let p = require('ffmpeg-static');
    if (typeof p === 'object' && p && p.path) p = p.path;
    if (IS_PACKAGED && p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    return p;
  } catch (e) {
    console.error('[SB] ffmpeg-static not found:', e);
    return null;
  }
}

function stopFFmpegRec() {
  if (ffmpegRecProcess) {
    try { ffmpegRecProcess.stdin.write('q'); ffmpegRecProcess.stdin.end(); } catch(e) {}
    setTimeout(() => { try { ffmpegRecProcess.kill(); } catch(e) {} ffmpegRecProcess = null; }, 2000);
  }
}

function _safeKill(proc) {
  if (!proc) return;
  // 1. Best-effort graceful: tell ffmpeg to flush ('q' command) and close stdin
  try { proc.stdin && !proc.stdin.destroyed && proc.stdin.write('q\n'); } catch (e) {}
  try { proc.stdin && proc.stdin.end(); } catch (e) {}
  // 2. SIGTERM right away — some ffmpeg builds ignore 'q' on stdin pipes
  try { proc.kill('SIGTERM'); } catch (e) {}
  // 3. Hard SIGKILL fallback after 1.5s in case it hangs (no audio drain etc.)
  setTimeout(() => {
    try { if (!proc.killed) proc.kill('SIGKILL'); } catch (e) {}
  }, 1500);
}

// Attach error listeners to a child's stdio pipes so EPIPE / write-EOF on a closed
// ffmpeg never bubbles up as an uncaught exception (which would crash the main process).
function _silenceStdio(proc) {
  if (!proc) return;
  const noop = () => {};
  try { proc.on('error', noop); } catch (e) {}
  try { proc.stdin && proc.stdin.on('error', noop); } catch (e) {}
  try { proc.stdout && proc.stdout.on('error', noop); } catch (e) {}
  try { proc.stderr && proc.stderr.on('error', noop); } catch (e) {}
}

function stopFFmpegStream(reasonForRenderer) {
  if (ffmpegStreamReconnectTimer) {
    clearTimeout(ffmpegStreamReconnectTimer);
    ffmpegStreamReconnectTimer = null;
  }
  ffmpegStreamArgs = null;
  ffmpegStreamAttempts = 0;
  if (ffmpegStreamProcess) {
    _safeKill(ffmpegStreamProcess);
    ffmpegStreamProcess = null;
  }
  _emit('stream-status', { state: 'offline', reason: reasonForRenderer || null });
}

function _emit(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, data); } catch (e) {}
  }
}

// --- IPC Handlers ---

ipcMain.handle('get-media-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : null,
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
  } catch (e) { console.error('[SB] desktopCapturer error:', e); return []; }
});

ipcMain.handle('show-open-dialog', async (event, options) => { return dialog.showOpenDialog(mainWindow, options); });
ipcMain.handle('start-signaling-server', () => startSignalingServer());
ipcMain.handle('stop-signaling-server', () => { stopSignalingServer(); return 'stopped'; });
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('get-app-path', () => app.getAppPath());
ipcMain.handle('is-packaged', () => IS_PACKAGED);

ipcMain.handle('open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle('get-ffmpeg-path', () => { return getFFmpegPath(); });

// ─── Settings IPC ───

ipcMain.handle('settings-load', () => {
  // Decrypt the stream key once on load and return as plaintext (renderer needs it for the input field;
  // it is NOT persisted in renderer state beyond the input element).
  const s = appSettings || settingsMod.loadSettings();
  const out = JSON.parse(JSON.stringify(s));
  // Replace encrypted key with plaintext for renderer convenience
  out.stream.key = settingsMod.decryptSecret(s.stream.keyEncrypted) || '';
  delete out.stream.keyEncrypted;
  return out;
});

ipcMain.handle('settings-save', (_event, payload) => {
  if (!payload || typeof payload !== 'object') return { success: false, error: 'Invalid payload' };
  const next = JSON.parse(JSON.stringify(appSettings || settingsMod.DEFAULT_SETTINGS));
  // Merge plain-object sections.
  // 1.1.0: profile/friends are mutated server-side via their dedicated IPCs
  // (profile-update, friends-*) — we don't accept full overwrites from the
  // renderer over settings-save to avoid clobbering other-tab edits.
  for (const key of ['ui', 'audio', 'recording', 'signaling', 'fxStateByName', 'sound', 'updates', 'bugReports']) {
    if (payload[key]) next[key] = { ...(next[key] || {}), ...payload[key] };
  }
  // Stream object — handle key separately (encrypt)
  if (payload.stream) {
    const incoming = payload.stream;
    next.stream = next.stream || {};
    for (const f of ['platform', 'customServer', 'resolution', 'bitrate', 'fps']) {
      if (incoming[f] != null) next.stream[f] = incoming[f];
    }
    if (typeof incoming.key === 'string') {
      next.stream.keyEncrypted = settingsMod.encryptSecret(incoming.key);
    } else if (incoming.clearKey === true) {
      next.stream.keyEncrypted = null;
    }
  }
  const res = settingsMod.saveSettings(next);
  if (res.success) appSettings = next;
  return res;
});

ipcMain.handle('settings-get-stream-key', () => {
  const s = appSettings || settingsMod.loadSettings();
  return settingsMod.decryptSecret(s.stream.keyEncrypted) || '';
});

ipcMain.handle('start-ffmpeg-recording', (event, { outputPath }) => {
  stopFFmpegRec();
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg binary not found' };
  }

  // Live record: WebM (from MediaRecorder) → ffmpeg → MP4 directly on disk.
  // No post-conversion needed; the file produced is editable in any NLE.
  ffmpegRecProcess = spawn(ffmpegPath, [
    '-f', 'webm',
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    '-y',
    outputPath
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  _silenceStdio(ffmpegRecProcess);

  ffmpegRecProcess.stdout.on('data', () => {});
  ffmpegRecProcess.stderr.on('data', (d) => { if (!IS_PACKAGED) console.log('[FFmpegRec]', d.toString().trim()); });
  ffmpegRecProcess.on('close', (code) => {
    if (!IS_PACKAGED) console.log(`[FFmpegRec] exited with code ${code}`);
    ffmpegRecProcess = null;
    _emit('ffmpeg-rec-stopped', { code, path: outputPath });
  });

  return { success: true };
});

ipcMain.handle('stop-ffmpeg-recording', () => {
  if (!ffmpegRecProcess) return { success: false, error: 'Not recording' };
  try { ffmpegRecProcess.stdin.end(); } catch(e) {}
  return { success: true };
});

ipcMain.handle('write-rec-chunk', (event, { chunk }) => {
  const proc = ffmpegRecProcess;
  if (!proc || !proc.stdin) return { success: false };
  try {
    if (proc.killed || proc.exitCode !== null) return { success: false };
    if (!proc.stdin.writable || proc.stdin.destroyed) return { success: false };
    proc.stdin.write(Buffer.from(chunk), () => {});
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// ─── Real RTMP streaming via FFmpeg pipe ───
// Renderer pipes WebM chunks (canvas + mixed audio) → ffmpeg stdin → RTMP

ipcMain.handle('start-ffmpeg-stream', (event, opts) => {
  // opts: { rtmpUrl, streamKey, bitrate, resolution, fps }
  if (!opts || !opts.rtmpUrl) return { success: false, error: 'Missing RTMP URL' };
  // Get encrypted key from settings if streamKey not provided directly
  let key = opts.streamKey;
  if (!key) {
    const s = appSettings || settingsMod.loadSettings();
    key = settingsMod.decryptSecret(s.stream.keyEncrypted) || '';
  }
  if (!key) return { success: false, error: 'Stream key not set' };

  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg binary not found' };
  }

  // Sanitize URL — never log the full URL with key
  const fullUrl = opts.rtmpUrl.replace(/\/+$/, '') + '/' + key;
  const safeUrl = opts.rtmpUrl.replace(/\/+$/, '') + '/<key>';

  const bitrate = Math.max(500, Math.min(20000, parseInt(opts.bitrate) || 4500));
  const fps = Math.max(15, Math.min(60, parseInt(opts.fps) || 30));
  const res = (opts.resolution || '1280x720').match(/^(\d+)x(\d+)$/);
  const w = res ? parseInt(res[1]) : 1280;
  const h = res ? parseInt(res[2]) : 720;

  ffmpegStreamArgs = {
    args: [
      '-loglevel', 'level+info',
      '-hide_banner',
      // ── Input: WebM (VP9/Opus) from MediaRecorder over stdin.
      // Browser MediaRecorder gives PTS — trust them; do NOT rewrite with wallclock.
      // +igndts: ignore decode timestamps from input (let muxer derive from PTS).
      // +discardcorrupt: drop malformed packets instead of stalling.
      '-fflags', '+igndts+discardcorrupt',
      '-thread_queue_size', '1024',
      '-f', 'webm',
      '-i', '-',
      // ── Video: scale + letterbox to target resolution, force CFR
      '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
      '-fps_mode', 'cfr',
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',  // 'main' is more universally decoded than 'high' on AWS IVS web players
      '-level', '4.1',
      '-b:v', `${bitrate}k`,
      '-maxrate', `${bitrate}k`,
      '-bufsize', `${bitrate}k`,
      '-pix_fmt', 'yuv420p',
      '-g', String(fps * 2),
      '-keyint_min', String(fps * 2),
      '-sc_threshold', '0',
      '-x264-params', `nal-hrd=cbr:keyint=${fps * 2}:min-keyint=${fps * 2}:scenecut=0`,
      // ── Audio: AAC LC, stereo, 48 kHz, async resample (kills "Queue input is backward in time")
      '-af', 'aresample=async=1000:first_pts=0',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-ar', '48000',
      '-ac', '2',
      // ── Container
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      fullUrl
    ],
    safeUrl,
    bitrate, fps, w, h,
  };

  ffmpegStreamAttempts = 0;
  lastChunkAt = 0;
  _spawnStream(false);
  return { success: true };
});

function _spawnStream(isReconnect) {
  if (!ffmpegStreamArgs) return;
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath) {
    _emit('stream-status', { state: 'error', reason: 'FFmpeg not found' });
    ffmpegStreamArgs = null;
    return;
  }

  if (!IS_PACKAGED) console.log('[FFmpegStream] spawning →', ffmpegStreamArgs.safeUrl, 'reconnect=', isReconnect);
  _emit('stream-status', { state: isReconnect ? 'reconnecting' : 'connecting', reason: null });

  const proc = spawn(ffmpegPath, ffmpegStreamArgs.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  ffmpegStreamProcess = proc;
  _silenceStdio(proc);

  let stderr = '';
  let connected = false;
  // Don't optimistically declare "live" anymore — wait for real evidence from
  // FFmpeg ("Output #0" / "Stream mapping") so a misconfigured stream doesn't
  // pretend to be on-air.
  const connectTimer = setTimeout(() => {
    // Soft heartbeat — if FFmpeg has been alive 8s and didn't error out,
    // surface 'live' to the user. Real failure shows up in close handler.
    if (!connected && ffmpegStreamProcess === proc) {
      connected = true;
      ffmpegStreamAttempts = 0;
      _emit('stream-status', { state: 'live', reason: null });
    }
  }, 8000);

  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => {
    const txt = d.toString();
    stderr += txt;
    if (stderr.length > 8192) stderr = stderr.slice(-4096);
    if (!IS_PACKAGED) {
      // strip the URL+key from logs just in case
      const safe = txt.replace(/rtmps?:\/\/[^\s]+/gi, ffmpegStreamArgs.safeUrl);
      console.log('[FFmpegStream]', safe.trim());
    }
    if (!connected && /(Output #0|Press \[q\] to stop|Stream mapping)/.test(txt)) {
      connected = true;
      ffmpegStreamAttempts = 0;
      _emit('stream-status', { state: 'live', reason: null });
    }
  });

  proc.on('close', (code) => {
    clearTimeout(connectTimer);
    if (!IS_PACKAGED) console.log('[FFmpegStream] exited code=', code, 'connected=', connected, 'attempts=', ffmpegStreamAttempts);
    if (ffmpegStreamProcess === proc) ffmpegStreamProcess = null;
    if (!ffmpegStreamArgs) {
      _emit('stream-status', { state: 'offline', reason: null });
      return;
    }
    // Pull a friendly reason from the FFmpeg stderr tail
    const niceReason = _parseFFmpegError(stderr);
    if (!IS_PACKAGED && niceReason) console.log('[FFmpegStream] parsed reason:', niceReason);

    // If we never reached "live" — config issue (bad URL/key/DNS). Don't loop.
    if (!connected) {
      ffmpegStreamArgs = null;
      ffmpegStreamAttempts = 0;
      _emit('stream-status', { state: 'error', reason: niceReason || 'Не удалось подключиться к серверу. Проверьте URL и ключ стрима.' });
      return;
    }
    // Live drop → reconnect with cap. After N failed attempts, give up.
    ffmpegStreamAttempts++;
    if (ffmpegStreamAttempts > FFMPEG_STREAM_MAX_ATTEMPTS) {
      console.warn('[FFmpegStream] giving up after', ffmpegStreamAttempts, 'attempts');
      ffmpegStreamArgs = null;
      ffmpegStreamAttempts = 0;
      _emit('stream-status', { state: 'error', reason: niceReason || 'Соединение потеряно. Проверьте интернет и настройки стрима.' });
      return;
    }
    const retryMs = Math.min(3000 * ffmpegStreamAttempts, 15000);
    _emit('stream-status', { state: 'reconnecting', reason: niceReason || ('Соединение потеряно (попытка ' + ffmpegStreamAttempts + ')') });
    ffmpegStreamReconnectTimer = setTimeout(() => {
      ffmpegStreamReconnectTimer = null;
      if (ffmpegStreamArgs) _spawnStream(true);
    }, retryMs);
  });

  proc.on('error', (err) => {
    console.error('[FFmpegStream] spawn error:', err);
    _emit('stream-status', { state: 'error', reason: err.message });
  });
}

// Pull a single human-friendly line out of the noisy FFmpeg stderr tail.
// Skips FFmpeg's startup banner (configuration / version / library lines)
// and only returns lines that LOOK like errors.
function _parseFFmpegError(txt) {
  if (!txt) return null;
  const lines = txt.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Hard skip: anything that's clearly part of the banner / version listing.
  const isBanner = (l) =>
    /^configuration:/i.test(l) ||
    /^built with /i.test(l) ||
    /^ffmpeg version/i.test(l) ||
    /^Copyright \(c\)/i.test(l) ||
    /^lib(av|sw|post)\w+\s+\d+\.\s*\d+\.\s*\d+/i.test(l) ||
    /^Input #\d/i.test(l) ||
    /^Stream #\d/i.test(l) ||
    /^Output #\d/i.test(l) ||
    /^Press \[q\]/i.test(l) ||
    /^Stream mapping/i.test(l) ||
    /^\s+Metadata:/i.test(l) ||
    /^\s+encoder/i.test(l) ||
    /^\s+title/i.test(l) ||
    /frame=\s*\d/i.test(l) ||
    /^Duration:/i.test(l);

  // Patterns that DEFINITELY indicate a real error
  const errorPatterns = [
    /Connection refused/i,
    /Connection timed out/i,
    /No route to host/i,
    /Failed to resolve hostname/i,
    /Server returned [45]\d\d/i,
    /Unable to find a suitable output format/i,
    /handshake (failed|error)/i,
    /Operation not permitted/i,
    /TLS error/i,
    /tls.*alert/i,
    /Error number -?\d+ occurred/i,
    /^\[(rtmp|tls|tcp|flv|https?)[^\]]*\][^a-z]*(error|fail)/i,
    /Invalid argument/i,
    /Input\/output error/i,
    /Could not (write|connect|open|find)/i,
    /No such (file|host)/i,
    /Unauthorized/i,
    /Permission denied/i,
    /\bRTMP_/i,
    /Broken pipe/i,
    /End of file/i,
  ];

  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (isBanner(l)) continue;
    for (const re of errorPatterns) {
      if (re.test(l)) {
        let line = l.replace(/rtmps?:\/\/[^\s]+/gi, 'rtmp://<server>/<key>');
        // Extra safety net: scrub any "sk_*" Kick-style tokens that don't have URL prefix
        line = line.replace(/\bsk_[A-Za-z0-9_-]{8,}/g, '<key>');
        if (line.length > 200) line = line.slice(0, 200) + '…';
        return line;
      }
    }
  }
  return null;
}

ipcMain.handle('stop-ffmpeg-stream', () => {
  stopFFmpegStream('user');
  return { success: true };
});

let lastChunkAt = 0;

ipcMain.handle('write-stream-chunk', (event, { chunk }) => {
  const proc = ffmpegStreamProcess;
  if (!proc || !proc.stdin) return { success: false };
  try {
    // Guard against EPIPE / write-EOF when ffmpeg has died but reconnect timer hasn't fired yet.
    if (proc.killed || proc.exitCode !== null) return { success: false };
    if (!proc.stdin.writable || proc.stdin.destroyed) return { success: false };
    lastChunkAt = Date.now();
    proc.stdin.write(Buffer.from(chunk), (err) => { /* swallow EPIPE / EOF */ });
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
});

// Stall watchdog — if MediaRecorder in renderer stops sending chunks for 10s
// (window minimized, recorder bug, settings change), kill FFmpeg cleanly so it
// doesn't hang holding the RTMP socket open with no data flowing.
setInterval(() => {
  if (!ffmpegStreamProcess) return;
  if (!lastChunkAt) return;
  const idle = Date.now() - lastChunkAt;
  if (idle > 10000) {
    console.warn('[FFmpegStream] stdin stalled for', idle, 'ms — stopping');
    lastChunkAt = 0;
    stopFFmpegStream('Поток приостановлен (нет данных от рендерера)');
  }
}, 2000);

// ─── WASAPI Native Audio Capture IPC ───

ipcMain.handle('wasapi-get-output-devices', () => wasapi.getOutputDevices());
ipcMain.handle('wasapi-get-device-format', (event, { deviceId }) => wasapi.getDeviceFormat(deviceId));
ipcMain.handle('wasapi-start-capture', async (event, { deviceId }) => wasapi.startCapture(deviceId));
ipcMain.handle('wasapi-stop-capture', async () => wasapi.stopCapture());
ipcMain.handle('wasapi-is-capturing', () => wasapi.getIsCapturing());

ipcMain.handle('get-videos-dir', () => {
  const settings = appSettings || settingsMod.loadSettings();
  if (settings.recording && settings.recording.outputFolder && fs.existsSync(settings.recording.outputFolder)) {
    return settings.recording.outputFolder;
  }
  const videosDir = path.join(app.getPath('videos'), 'StreamBro');
  try { if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true }); } catch (e) {}
  return videosDir;
});

ipcMain.handle('save-rec-file', (event, { path: filePath, data }) => {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    fs.writeFileSync(filePath, buf);
    if (!IS_PACKAGED) console.log('[Rec] Saved WebM:', filePath, 'size:', (buf.length / 1024 / 1024).toFixed(2), 'MB');
    return { success: true };
  } catch (e) {
    console.error('[Rec] Save error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('show-in-folder', (event, { path: filePath }) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ─── Profile IPC (1.1.0) ───
ipcMain.handle('profile-get',         () => profileMgr.getPublic());
ipcMain.handle('profile-update',      (_e, patch) => profileMgr.update(patch));
ipcMain.handle('profile-logout',      () => profileMgr.logout());
ipcMain.handle('profile-open-signup', () => { profileMgr.openSignup();  return { success: true }; });
ipcMain.handle('profile-open-login',  () => { profileMgr.openLogin();   return { success: true }; });
ipcMain.handle('profile-open-page',   () => { profileMgr.openProfile(); return { success: true }; });
// Local-only login stub: lets us pretend the user finished signup so the rest
// of the UI can be tested before the backend is up. Returns the same payload
// shape that the real /login endpoint will return.
ipcMain.handle('profile-dev-login', (_e, payload) => {
  const fake = {
    id: 'local-' + Date.now().toString(36),
    nickname: (payload && payload.nickname) || 'Stream Brother',
    email: (payload && payload.email) || 'dev@streambro.local',
    avatar: '',
  };
  profileMgr.setToken('dev-' + Math.random().toString(36).slice(2, 18), fake);
  return { success: true, profile: profileMgr.getPublic() };
});

// ─── Friends IPC (1.1.0) ───
ipcMain.handle('friends-list',        () => friendsStore.listFriends());
ipcMain.handle('friends-requests',    () => friendsStore.listRequests());
ipcMain.handle('friends-chat',        (_e, friendId) => friendsStore.getChat(friendId));
ipcMain.handle('friends-unread',      () => friendsStore.getUnreadCounts());
ipcMain.handle('friends-add',         (_e, payload) => friendsStore.sendFriendRequest(payload || {}));
ipcMain.handle('friends-dev-add',     (_e, payload) => friendsStore.devAddFriend(payload || {}));
ipcMain.handle('friends-remove',      (_e, friendId) => friendsStore.removeFriend(friendId));
ipcMain.handle('friends-set-status',  (_e, { friendId, status }) => friendsStore.setFriendStatus(friendId, status));
ipcMain.handle('friends-send-msg',    (_e, payload) => friendsStore.sendMessage({ ...payload, fromMe: true }));
ipcMain.handle('friends-mark-read',   (_e, friendId) => friendsStore.markRead(friendId));
ipcMain.handle('friends-dev-inbound', (_e, { friendId, text }) => friendsStore.devSimulateInbound(friendId, text));

// ─── Bug reporter IPC (1.1.0) ───
ipcMain.handle('bug-report',          (_e, payload) => bugReporter.report(payload || {}));
ipcMain.handle('bug-flush',           () => bugReporter.flushQueue());
ipcMain.handle('bug-queue-size',      () => bugReporter.getQueueSize());
ipcMain.handle('bug-clear-queue',     () => bugReporter.clearQueue());

// ─── Auto-updater IPC (1.1.0) ───
ipcMain.handle('updater-check',       () => autoUpdater.check());
ipcMain.handle('updater-download',    () => autoUpdater.download());
ipcMain.handle('updater-install',     () => autoUpdater.quitAndInstall());
ipcMain.handle('updater-set-channel', (_e, ch) => autoUpdater.setChannel(ch));

ipcMain.handle('convert-to-mp4', (event, { inputPath, outputPath }) => {
  const ffmpegPath = getFFmpegPath();
  if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    return { success: false, error: 'FFmpeg not found' };
  }
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: 'Input file not found: ' + inputPath };
  }

  return new Promise((resolve) => {
    if (!IS_PACKAGED) console.log('[Rec] Converting WebM → MP4...');
    const proc = spawn(ffmpegPath, [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stderr.on('data', () => {});
    proc.stdout.on('data', () => {});

    proc.on('close', (code) => {
      if (code === 0) {
        try { fs.unlinkSync(inputPath); } catch(e) {}
        resolve({ success: true, path: outputPath });
      } else {
        resolve({ success: false, error: 'FFmpeg exit code ' + code });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    setTimeout(() => {
      try { proc.kill(); } catch(e) {}
      resolve({ success: false, error: 'Conversion timeout' });
    }, 600000);
  });
});
