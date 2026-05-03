// StreamBro — Virtual Camera Module
// Pushes the StreamBro canvas as a virtual webcam via FFmpeg → DirectShow.
// Requirements: OBS Virtual Camera (or any DirectShow virtual camera driver) must be installed.
// The user installs OBS and enables its Virtual Camera once — after that StreamBro uses it.

'use strict';

const { ipcMain, net } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let _ffmpegProc = null;
let _win = null;
let _enabled = false;
let _ffmpegPath = null;
let _deviceName = 'OBS Virtual Camera'; // default DirectShow device name

async function init(mainWindow, ffmpegPathFn) {
  _win = mainWindow;
  _ffmpegPath = typeof ffmpegPathFn === 'function' ? ffmpegPathFn() : ffmpegPathFn;

  ipcMain.handle('vcam-list-devices', async () => {
    return _listVirtualCamDevices();
  });

  ipcMain.handle('vcam-start', async (_event, opts = {}) => {
    return _start(opts);
  });

  ipcMain.handle('vcam-stop', async () => {
    return _stop();
  });

  ipcMain.handle('vcam-status', async () => {
    return { enabled: _enabled, device: _deviceName, pid: _ffmpegProc?.pid || null };
  });

  ipcMain.handle('vcam-write-chunk', async (_event, chunk) => {
    if (!_ffmpegProc || !_ffmpegProc.stdin || _ffmpegProc.stdin.destroyed) return;
    try {
      _ffmpegProc.stdin.write(Buffer.from(chunk));
    } catch (e) {
      // ignore pipe errors
    }
  });
}

async function _listVirtualCamDevices() {
  if (!_ffmpegPath) return { devices: [], error: 'ffmpeg not found' };

  return new Promise(resolve => {
    // Use FFmpeg to enumerate DirectShow devices
    const proc = spawn(_ffmpegPath, [
      '-hide_banner',
      '-list_devices', 'true',
      '-f', 'dshow',
      '-i', 'dummy',
    ], { windowsHide: true });

    let output = '';
    const onData = d => { output += d.toString(); };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    const timeout = setTimeout(() => { try { proc.kill(); } catch {} }, 5000);

    proc.on('close', () => {
      clearTimeout(timeout);
      // Parse "DirectShow video devices" section
      const videoSection = output.split('DirectShow video devices')[1] || '';
      const devices = [];
      const matches = videoSection.matchAll(/"([^"]+)"\s*\(video\)/g);
      for (const m of matches) {
        devices.push(m[1]);
      }
      resolve({ devices, raw: videoSection.substring(0, 500) });
    });
    proc.on('error', err => {
      clearTimeout(timeout);
      resolve({ devices: [], error: err.message });
    });
  });
}

async function _start(opts = {}) {
  if (_enabled) await _stop();

  const device = opts.device || _deviceName;
  const width = opts.width || 1280;
  const height = opts.height || 720;
  const fps = opts.fps || 30;

  _deviceName = device;
  _ffmpegPath = _ffmpegPath || opts.ffmpegPath;

  if (!_ffmpegPath) return { ok: false, error: 'FFmpeg not found' };

  // FFmpeg args: read WebM from stdin → push to DirectShow virtual camera
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-fflags', '+igndts+discardcorrupt',
    '-thread_queue_size', '512',
    '-f', 'webm',
    '-i', 'pipe:0',
    // Scale to requested resolution
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    '-fps_mode', 'cfr',
    '-r', String(fps),
    // Output: DirectShow virtual camera
    '-f', 'dshow',
    '-vcodec', 'rawvideo',
    '-pix_fmt', 'yuv420p',
    `video=${device}`,
  ];

  try {
    _ffmpegProc = spawn(_ffmpegPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    _ffmpegProc.stderr?.on('data', d => {
      const msg = d.toString();
      if (msg.includes('error') || msg.includes('Error')) {
        if (_win) _win.webContents.send('vcam-error', msg.substring(0, 200));
      }
    });

    _ffmpegProc.on('close', code => {
      _enabled = false;
      _ffmpegProc = null;
      if (_win) _win.webContents.send('vcam-status-change', { enabled: false, code });
    });

    _ffmpegProc.on('error', err => {
      _enabled = false;
      _ffmpegProc = null;
      if (_win) _win.webContents.send('vcam-error', err.message);
    });

    _enabled = true;
    if (_win) _win.webContents.send('vcam-status-change', { enabled: true, device });

    return { ok: true, device, pid: _ffmpegProc.pid };
  } catch (e) {
    _enabled = false;
    return { ok: false, error: e.message };
  }
}

async function _stop() {
  _enabled = false;
  if (!_ffmpegProc) return { ok: true };

  return new Promise(resolve => {
    const proc = _ffmpegProc;
    _ffmpegProc = null;

    try { proc.stdin?.write('q\n'); } catch {}
    try { proc.stdin?.end(); } catch {}

    const timeout = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ ok: true });
    }, 2000);

    proc.on('close', () => {
      clearTimeout(timeout);
      resolve({ ok: true });
    });

    try { proc.kill('SIGTERM'); } catch {}
  });
}

function shutdown() {
  _stop().catch(() => {});
}

module.exports = { init, shutdown };
