// WASAPI Loopback Capture Module — native Windows audio capture without dialogs
const { AudioRecorder } = require('native-recorder-nodejs');

let recorder = null;
let mainWindow = null;
let isCapturing = false;
let currentDeviceId = null;
let currentFormat = null;
let deviceCheckInterval = null;
let lastDataTime = 0;

function setMainWindow(win) {
  mainWindow = win;
}

function getOutputDevices() {
  try {
    return AudioRecorder.getDevices('output');
  } catch (e) {
    console.error('[WASAPI] getDevices error:', e);
    return [];
  }
}

function getDeviceFormat(deviceId) {
  try {
    return AudioRecorder.getDeviceFormat(deviceId);
  } catch (e) {
    console.error('[WASAPI] getDeviceFormat error:', e);
    return { sampleRate: 44100, channels: 2, bitDepth: 16 };
  }
}

async function startCapture(deviceId) {
  if (isCapturing) {
    console.log('[WASAPI] Already capturing');
    return { success: false, error: 'Already capturing' };
  }

  try {
    // Use default device if none specified
    if (!deviceId) {
      const devices = AudioRecorder.getDevices('output');
      const defDev = devices.find(d => d.isDefault);
      if (!defDev) {
        return { success: false, error: 'No default output device' };
      }
      deviceId = defDev.id;
    }

    const fmt = AudioRecorder.getDeviceFormat(deviceId);
    console.log('[WASAPI] Starting capture on device:', deviceId, 'format:', JSON.stringify(fmt));
    currentFormat = fmt;

    recorder = new AudioRecorder();
    currentDeviceId = deviceId;
    isCapturing = true;

    recorder.on('data', (buffer) => {
      lastDataTime = Date.now();
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Send PCM data to renderer
        mainWindow.webContents.send('wasapi-audio-data', {
          buffer: buffer.buffer,
          byteOffset: buffer.byteOffset,
          byteLength: buffer.byteLength,
          sampleRate: fmt.sampleRate,
          channels: fmt.channels
        });
      }
    });

    recorder.on('error', (err) => {
      console.error('[WASAPI] Recorder error:', err);
      isCapturing = false;
      currentDeviceId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wasapi-error', err.message);
      }
    });

    await recorder.start({ deviceType: 'output', deviceId: deviceId });
    console.log('[WASAPI] Capture started successfully');
    lastDataTime = Date.now();

    // Start watching for default device changes
    _startDeviceWatch();

    return { success: true, format: fmt };
  } catch (e) {
    console.error('[WASAPI] Start error:', e);
    isCapturing = false;
    currentDeviceId = null;
    return { success: false, error: e.message };
  }
}

async function stopCapture() {
  _stopDeviceWatch();

  if (!isCapturing || !recorder) {
    return { success: false, error: 'Not capturing' };
  }

  try {
    await recorder.stop();
    isCapturing = false;
    currentDeviceId = null;
    currentFormat = null;
    recorder = null;
    console.log('[WASAPI] Capture stopped');
    return { success: true };
  } catch (e) {
    console.error('[WASAPI] Stop error:', e);
    isCapturing = false;
    recorder = null;
    currentDeviceId = null;
    currentFormat = null;
    return { success: false, error: e.message };
  }
}

// Restart capture on a new device — used when default audio device changes
async function restartCapture(newDeviceId) {
  if (!isCapturing) {
    return { success: false, error: 'Not capturing' };
  }

  // Same device — no restart needed
  if (newDeviceId === currentDeviceId) {
    return { success: true, sameDevice: true };
  }

  console.log('[WASAPI] Default device changed! Restarting: ' + currentDeviceId + ' → ' + newDeviceId);

  // Stop old recorder
  _stopDeviceWatch();
  try {
    if (recorder) {
      recorder.removeAllListeners();
      await recorder.stop();
    }
  } catch (e) {
    console.error('[WASAPI] Stop error during restart:', e);
  }
  recorder = null;
  isCapturing = false;

  // Start on new device
  try {
    const fmt = AudioRecorder.getDeviceFormat(newDeviceId);
    console.log('[WASAPI] Restarting on new device:', newDeviceId, 'format:', JSON.stringify(fmt));
    currentFormat = fmt;

    recorder = new AudioRecorder();
    currentDeviceId = newDeviceId;
    isCapturing = true;

    recorder.on('data', (buffer) => {
      lastDataTime = Date.now();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wasapi-audio-data', {
          buffer: buffer.buffer,
          byteOffset: buffer.byteOffset,
          byteLength: buffer.byteLength,
          sampleRate: fmt.sampleRate,
          channels: fmt.channels
        });
      }
    });

    recorder.on('error', (err) => {
      console.error('[WASAPI] Recorder error (after restart):', err);
      isCapturing = false;
      currentDeviceId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wasapi-error', err.message);
      }
    });

    await recorder.start({ deviceType: 'output', deviceId: newDeviceId });
    console.log('[WASAPI] Capture restarted successfully on new device');
    lastDataTime = Date.now();
    _startDeviceWatch();

    // Notify renderer about device change + new format
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wasapi-device-changed', {
        deviceId: newDeviceId,
        format: fmt
      });
    }

    return { success: true, format: fmt };
  } catch (e) {
    console.error('[WASAPI] Restart error:', e);
    isCapturing = false;
    currentDeviceId = null;
    // Notify renderer about failure
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('wasapi-error', 'Restart failed: ' + e.message);
    }
    return { success: false, error: e.message };
  }
}

// Poll for default device changes and disconnected devices every 2 seconds
function _startDeviceWatch() {
  _stopDeviceWatch();
  deviceCheckInterval = setInterval(() => {
    if (!isCapturing) { _stopDeviceWatch(); return; }
    try {
      const devices = AudioRecorder.getDevices('output');
      const defDev = devices.find(d => d.isDefault);

      // Check if capture went silent (no data for 5s) — device may have silently stopped
      if (lastDataTime > 0 && (Date.now() - lastDataTime) > 5000) {
        console.log('[WASAPI] No data for 5s — capture may be stuck, forcing restart...');
        const restartId = defDev ? defDev.id : currentDeviceId;
        lastDataTime = Date.now(); // reset to avoid restart loop
        // Force restart even on same device — stop old, start fresh
        _stopDeviceWatch();
        try {
          if (recorder) { recorder.removeAllListeners(); recorder.stop(); }
        } catch(e) {}
        recorder = null;
        isCapturing = false;
        currentDeviceId = null;
        // Re-start from scratch
        if (restartId) {
          startCapture(restartId).then(result => {
            if (result.success) {
              console.log('[WASAPI] Force-restarted after silence');
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('wasapi-device-changed', {
                  deviceId: restartId,
                  format: result.format
                });
              }
            } else {
              console.error('[WASAPI] Force-restart failed:', result.error);
            }
          });
        }
        return;
      }

      // Check if current device was disconnected (no longer in device list)
      const currentStillExists = devices.some(d => d.id === currentDeviceId);
      if (!currentStillExists) {
        console.log('[WASAPI] Current device disconnected! Was: ' + currentDeviceId);
        if (defDev) {
          console.log('[WASAPI] Switching to new default: ' + defDev.id + ' (' + defDev.name + ')');
          restartCapture(defDev.id).then(result => {
            if (result.success) {
              console.log('[WASAPI] Auto-switched after disconnect');
            } else {
              console.error('[WASAPI] Auto-switch failed:', result.error);
              // Stop capturing — no valid device available
              isCapturing = false;
              currentDeviceId = null;
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('wasapi-error', 'Аудиоустройство отключено и нет замены');
              }
            }
          });
        } else {
          // No default device at all
          console.log('[WASAPI] No default device available after disconnect');
          isCapturing = false;
          currentDeviceId = null;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('wasapi-error', 'Аудиоустройство отключено');
          }
        }
        return;
      }

      // Check if default device changed (user switched in Windows settings)
      if (defDev && defDev.id !== currentDeviceId) {
        console.log('[WASAPI] Default device changed detected: ' + currentDeviceId + ' → ' + defDev.id + ' (' + defDev.name + ')');
        restartCapture(defDev.id).then(result => {
          if (result.success) {
            console.log('[WASAPI] Auto-switched to new default device');
          } else {
            console.error('[WASAPI] Auto-switch failed:', result.error);
          }
        });
      }
    } catch (e) {
      // Silently ignore — device enumeration can fail briefly during device switches
    }
  }, 2000);
}

function _stopDeviceWatch() {
  if (deviceCheckInterval) {
    clearInterval(deviceCheckInterval);
    deviceCheckInterval = null;
  }
}

function getIsCapturing() {
  return isCapturing;
}

function getCurrentDeviceId() {
  return currentDeviceId;
}

function getCurrentFormat() {
  return currentFormat;
}

module.exports = {
  setMainWindow,
  getOutputDevices,
  getDeviceFormat,
  startCapture,
  stopCapture,
  restartCapture,
  getIsCapturing,
  getCurrentDeviceId,
  getCurrentFormat
};
