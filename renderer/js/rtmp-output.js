// RTMP / Recording Output Module v9
// - Recording: MediaRecorder → IPC → FFmpeg stdin → MP4 directly (no post-conversion).
//   If FFmpeg is unavailable for some reason we fall back to writing a WebM file.
// - Streaming: MediaRecorder (WebM chunks) → IPC → FFmpeg stdin → RTMP (real, live)
// All UI status transitions are exposed via callbacks.

class RTMPOutput {
  constructor() {
    this.canvas = null;
    this.combinedStream = null;
    this.bitrate = 6000;
    this.fps = 30;

    // Recording state
    this._recorder = null;
    this._recChunks = [];
    this._recording = false;
    this._recPaused = false;
    this._recStartTime = null;
    this._recPauseAccum = 0;
    this._recPauseStart = null;
    this._recWebmPath = null;
    this._recMp4Path = null;
    this._recLiveMode = false;       // true → live-pipe to ffmpeg → MP4
    this._recFallbackChunks = null;  // used only if live ffmpeg pipe fails to start
    this._recOnStoppedHandler = null;
    this.onRecStart = null;
    this.onRecStop = null;
    this.onRecPause = null;
    this.onRecResume = null;
    this.onSaveDone = null;
    this._showConverting = null;

    // Streaming state
    this.isStreaming = false;
    this.isPaused = false;
    this._streamRecorder = null;
    this._streamStartTime = null;
    this._streamServer = '';
    this._streamKey = '';
    this._streamResolution = '1280x720';
    this._streamFps = 30;
    this._streamStatus = 'offline'; // offline | connecting | live | reconnecting | error
    this.onStart = null;
    this.onStop = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onStatus = null;       // (state, reason) => void

    // Subscribe to backend status updates once
    if (window.electronAPI && window.electronAPI.onStreamStatus) {
      window.electronAPI.onStreamStatus((data) => {
        this._streamStatus = data.state;
        if (this.onStatus) this.onStatus(data.state, data.reason);
        // Stop the renderer-side MediaRecorder when the stream is permanently offline
        // or has errored — otherwise it keeps producing WebM chunks that go nowhere
        // and bloats memory in the renderer process.
        if ((data.state === 'offline' || data.state === 'error') && this.isStreaming) {
          this.isStreaming = false;
          this.isPaused = false;
          this._streamStartTime = null;
          try {
            if (this._streamRecorder && this._streamRecorder.state !== 'inactive') {
              this._streamRecorder.stop();
            }
          } catch (e) {}
          this._streamRecorder = null;
          if (this.onStop) this.onStop();
        }
      });
    }
  }

  setCanvas(el) { this.canvas = el; }
  setServer(url) { this._streamServer = url; }
  setStreamKey(key) { this._streamKey = key; }
  setBitrate(kbps) { this.bitrate = kbps; }
  setResolution(res) { this._streamResolution = res; }
  setFps(fps) { this._streamFps = fps; this.fps = fps; }
  setCombinedStream(stream) { this.combinedStream = stream; }

  getUptime() {
    if (!this._streamStartTime) return '00:00:00';
    return _fmtTime(Date.now() - this._streamStartTime);
  }

  getRecTime() {
    if (!this._recStartTime) return '00:00:00';
    let elapsed = Date.now() - this._recStartTime - this._recPauseAccum;
    if (this._recPaused && this._recPauseStart) elapsed -= (Date.now() - this._recPauseStart);
    return _fmtTime(Math.max(0, elapsed));
  }

  getStreamStatus() { return this._streamStatus; }

  _pickMime() {
    const m = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
    for (const t of m) { if (MediaRecorder.isTypeSupported(t)) return t; }
    return '';
  }

  _buildStream() {
    const audioTracks = this.combinedStream ? this.combinedStream.getAudioTracks() : [];
    let videoTracks = [];
    if (this.canvas && this.canvas.captureStream) {
      videoTracks = this.canvas.captureStream(this.fps).getVideoTracks();
    }
    return new MediaStream([...videoTracks, ...audioTracks]);
  }

  // ─── Live RTMP streaming ───
  async start() {
    if (this.isStreaming) return;
    try {
      const stream = this._buildStream();
      if (!stream.getTracks().length) {
        if (this.onError) this.onError('Нет потока — добавьте источники');
        return;
      }
      const mime = this._pickMime();
      if (!mime) {
        if (this.onError) this.onError('Формат не поддерживается');
        return;
      }
      // Tell main process to start ffmpeg with rtmp output
      const result = await window.electronAPI.startStream({
        rtmpUrl: this._streamServer,
        streamKey: this._streamKey,
        bitrate: this.bitrate,
        resolution: this._streamResolution,
        fps: this._streamFps,
      });
      if (!result || !result.success) {
        if (this.onError) this.onError(result && result.error ? result.error : 'Ошибка запуска FFmpeg');
        return;
      }

      // Spin up MediaRecorder that pipes WebM chunks into ffmpeg
      this._streamRecorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: this.bitrate * 1000,
        audioBitsPerSecond: 160000,
      });
      this._streamRecorder.ondataavailable = async (e) => {
        if (!this.isStreaming) return;
        if (e.data && e.data.size > 0) {
          try {
            const buf = await e.data.arrayBuffer();
            await window.electronAPI.writeStreamChunk(buf);
          } catch (err) {
            // Pipe broken — main will reconnect ffmpeg automatically
          }
        }
      };
      this._streamRecorder.onerror = (e) => {
        if (this.onError) this.onError((e.error && e.error.message) || 'Recorder error');
      };
      // Send small chunks for low latency (250ms)
      this._streamRecorder.start(250);

      this.isStreaming = true;
      this.isPaused = false;
      this._streamStartTime = Date.now();
      if (this.onStart) this.onStart();
    } catch (err) {
      if (this.onError) this.onError(err.message || String(err));
    }
  }

  pause() {
    if (!this.isStreaming || this.isPaused) return;
    if (this._streamRecorder && this._streamRecorder.state === 'recording') {
      try { this._streamRecorder.pause(); } catch(e) {}
      this.isPaused = true;
      if (this.onPause) this.onPause();
    }
  }

  resume() {
    if (!this.isStreaming || !this.isPaused) return;
    if (this._streamRecorder && this._streamRecorder.state === 'paused') {
      try { this._streamRecorder.resume(); } catch(e) {}
      this.isPaused = false;
      if (this.onResume) this.onResume();
    }
  }

  async stop() {
    if (!this.isStreaming) return;
    try {
      if (this._streamRecorder && this._streamRecorder.state !== 'inactive') {
        try { this._streamRecorder.stop(); } catch(e) {}
      }
      this._streamRecorder = null;
      await window.electronAPI.stopStream();
    } catch (e) {}
    this.isStreaming = false;
    this.isPaused = false;
    this._streamStartTime = null;
    if (this.onStop) this.onStop();
  }

  // ─── Local recording (live MP4 via FFmpeg pipe) ───
  async startRecording() {
    if (this._recording) return;
    const stream = this._buildStream();
    if (!stream.getTracks().length) {
      if (this.onError) this.onError('Нет потока — добавьте источники');
      return;
    }
    const mime = this._pickMime();
    if (!mime) { if (this.onError) this.onError('Формат не поддерживается'); return; }

    try {
      const videosDir = await window.electronAPI.getVideosDir();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      this._recMp4Path  = videosDir + '\\StreamBro_' + ts + '.mp4';
      this._recWebmPath = videosDir + '\\StreamBro_' + ts + '.webm';

      // Try to start a live FFmpeg pipe that writes MP4 directly. If FFmpeg is missing
      // we transparently fall back to "save WebM blob" path.
      this._recLiveMode = false;
      this._recFallbackChunks = null;
      try {
        const r = await window.electronAPI.startFFmpegRecording({ outputPath: this._recMp4Path });
        if (r && r.success) this._recLiveMode = true;
        else if (window.__sbDev) console.warn('[Rec] FFmpeg start failed, falling back to WebM:', r && r.error);
      } catch (e) {
        if (window.__sbDev) console.warn('[Rec] FFmpeg pipe error, falling back to WebM:', e);
      }
      if (!this._recLiveMode) this._recFallbackChunks = [];

      // Wire the once-only "ffmpeg-rec-stopped" handler that finalises the file path
      // (we use renderer-side onSaveDone — the IPC event also confirms the close).
      this._recOnStoppedHandler = (data) => {
        // data: { code, path } — already wired in app.js; we don't need to do anything
        // extra here, but keep the hook for future progress UI.
      };

      this._recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: this.bitrate * 1000,
        audioBitsPerSecond: 192000,
      });
      this._recChunks = [];

      this._recorder.ondataavailable = async (e) => {
        if (!e.data || e.data.size === 0) return;
        if (this._recLiveMode) {
          try {
            const buf = await e.data.arrayBuffer();
            await window.electronAPI.writeRecChunk(buf);
          } catch (err) {
            // Pipe broken — silently drop; ffmpeg will close and trigger onstop flow.
          }
        } else if (this._recFallbackChunks) {
          this._recFallbackChunks.push(e.data);
        }
      };

      this._recorder.onstop = async () => {
        this._recorder = null;
        if (this._recLiveMode) {
          // Tell FFmpeg to finalise; the file appears once the process closes.
          try { await window.electronAPI.stopFFmpegRecording(); } catch(e) {}
          if (this._showConverting) try { this._showConverting('Финализация MP4…'); } catch(e) {}
          // Wait briefly for ffmpeg to finalise; main emits 'ffmpeg-rec-stopped' that
          // app.js listens to. We just announce the intended path here.
          if (this.onSaveDone) this.onSaveDone(this._recMp4Path);
        } else {
          // WebM blob fallback (no FFmpeg available)
          const chunks = this._recFallbackChunks || [];
          this._recFallbackChunks = null;
          if (chunks.length === 0) {
            if (this.onSaveDone) this.onSaveDone('Запись остановлена (нет данных)');
            return;
          }
          await this._saveBlobFallback(chunks);
        }
      };

      this._recorder.onerror = (e) => {
        this._recording = false;
        this._recPaused = false;
        this._recorder = null;
        if (this._recLiveMode) {
          try { window.electronAPI.stopFFmpegRecording(); } catch(_) {}
        }
        if (this.onError) this.onError((e.error && e.error.message) || 'Recording error');
      };

      // Smaller chunk interval gives ffmpeg-pipe nicer cadence; 1000 ms is a fine balance.
      this._recorder.start(this._recLiveMode ? 1000 : 2000);
      this._recording = true; this._recPaused = false;
      this._recStartTime = Date.now(); this._recPauseAccum = 0; this._recPauseStart = null;
      if (this.onRecStart) this.onRecStart();
    } catch (err) {
      this._recording = false;
      if (this.onError) this.onError(err.message || String(err));
    }
  }

  async _saveBlobFallback(chunks) {
    if (!chunks || !chunks.length) return;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = await blob.arrayBuffer();
    try {
      await window.electronAPI.saveRecFile({ path: this._recWebmPath, data: buf });
      // Best-effort post-conversion to MP4 if ffmpeg is reachable
      try {
        const r = await window.electronAPI.convertToMp4({ inputPath: this._recWebmPath, outputPath: this._recMp4Path });
        if (r && r.success) {
          if (this.onSaveDone) this.onSaveDone(this._recMp4Path);
          return;
        }
      } catch(_) {}
      if (this.onSaveDone) this.onSaveDone(this._recWebmPath);
    } catch(e) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = this._recWebmPath.split('\\').pop();
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      if (this.onSaveDone) this.onSaveDone(a.download);
    }
  }

  pauseRecording() {
    if (!this._recording || this._recPaused) return;
    if (this._recorder && this._recorder.state === 'recording') {
      this._recorder.pause(); this._recPaused = true; this._recPauseStart = Date.now();
      if (this.onRecPause) this.onRecPause();
    }
  }

  resumeRecording() {
    if (!this._recording || !this._recPaused) return;
    if (this._recorder && this._recorder.state === 'paused') {
      this._recorder.resume();
      if (this._recPauseStart) { this._recPauseAccum += Date.now() - this._recPauseStart; this._recPauseStart = null; }
      this._recPaused = false;
      if (this.onRecResume) this.onRecResume();
    }
  }

  stopRecording() {
    if (!this._recording) return;
    this._recording = false;
    this._recPaused = false;
    this._recStartTime = null;
    if (this.onRecStop) this.onRecStop(null);
    if (this._recorder && this._recorder.state !== 'inactive') {
      try { this._recorder.stop(); } catch(e) { this._recorder = null; }
    } else {
      this._recorder = null;
    }
  }

  get isRecording() { return this._recording; }
  get isRecPaused() { return this._recPaused; }
}

function _fmtTime(ms) {
  const t = Math.floor(ms / 1000);
  return `${Math.floor(t/3600).toString().padStart(2,'0')}:${Math.floor((t%3600)/60).toString().padStart(2,'0')}:${(t%60).toString().padStart(2,'0')}`;
}

window.RTMPOutput = RTMPOutput;
