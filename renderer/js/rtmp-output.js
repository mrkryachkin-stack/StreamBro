// RTMP / Recording Output Module v10
// - Streaming: WebCodecs (H.264 + AAC → MPEG-TS) → IPC → FFmpeg (copy, NO re-encode) → RTMP
//   Falls back to MediaRecorder (WebM) → IPC → FFmpeg (re-encode) if WebCodecs unavailable.
// - Recording: MediaRecorder → IPC → FFmpeg stdin → MP4 directly (no post-conversion).
//   If FFmpeg is unavailable we fall back to writing a WebM file.
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
    this._recLiveMode = false;
    this._recFallbackChunks = null;
    this._recFallbackBytes = 0;
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
    this._streamRecorder = null;   // MediaRecorder fallback
    this._videoEncoder = null;      // WebCodecs VideoEncoder
    this._audioEncoder = null;      // WebCodecs AudioEncoder
    this._audioSourceNode = null;   // MediaStreamSource for audio encoding
    this._audioProcessor = null;    // ScriptProcessor to feed raw audio to encoder
    this._frameTimer = null;        // setInterval for capturing VideoFrames
    this._useWebCodecs = false;     // true if using WebCodecs path
    this._streamStartTime = null;
    this._streamServer = '';
    this._streamKey = '';
    this._streamResolution = '1280x720';
    this._streamFps = 30;
    this._encoder = 'libx264';      // video encoder (libx264 / h264_nvenc / h264_amf / h264_qsv)
    this._streamStatus = 'offline';
    this._pendingTsPackets = [];    // buffer of MPEG-TS packets before first IPC
    this._audioSeq = 0;
    this._videoSeq = 0;
    this._ptsCounter = 0;           // PTS counter (90kHz clock)
    this._audioSamplesIn = 0;       // total audio samples fed
    this.onStart = null;
    this.onStop = null;
    this.onPause = null;
    this.onResume = null;
    this.onError = null;
    this.onStatus = null;

    // Check WebCodecs availability
    this._webCodecsSupported = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';

    // Subscribe to backend status updates
    if (window.electronAPI && window.electronAPI.onStreamStatus) {
      window.electronAPI.onStreamStatus((data) => {
        this._streamStatus = data.state;
        if (this.onStatus) this.onStatus(data.state, data.reason);
        if ((data.state === 'offline' || data.state === 'error') && this.isStreaming) {
          this.isStreaming = false;
          this.isPaused = false;
          this._streamStartTime = null;
          this._cleanupStreamEncoders();
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
  setEncoder(enc) {
    const allowed = ['libx264', 'h264_nvenc', 'h264_amf', 'h264_qsv'];
    this._encoder = allowed.includes(enc) ? enc : 'libx264';
  }
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
    const videoTracks = this.combinedStream ? this.combinedStream.getVideoTracks() : [];
    if (!videoTracks.length && this.canvas && this.canvas.captureStream) {
      return new MediaStream([...this.canvas.captureStream(this.fps).getVideoTracks(), ...audioTracks]);
    }
    return new MediaStream([...videoTracks, ...audioTracks]);
  }

  // ─── WebCodecs MPEG-TS helpers ───

  _mpegTsPacketHeader(pid, pts, isKeyframe, isAudio) {
    // Simplified MPEG-TS packet (188 bytes) header
    // Sync byte + PID + Adaptation + Continuity counter
    const pkt = new Uint8Array(188);
    let offset = 0;

    // Sync byte
    pkt[0] = 0x47;
    // Transport error=0, payload unit start=1, PID
    const pidVal = pid & 0x1FFF;
    pkt[1] = 0x40 | (pidVal >> 8);
    pkt[2] = pidVal & 0xFF;
    // Scrambling=0, adaptation=01 (payload only), continuity
    const cont = isAudio ? (this._audioSeq++) & 0xF : (this._videoSeq++) & 0xF;
    pkt[3] = 0x10 | cont;

    offset = 4;

    // If we have PTS, write adaptation field + PTS
    if (pts !== null) {
      pkt[3] = 0x30 | cont; // adaptation=11 (adaptation + payload)
      const adaptLen = 188 - 4 - 8 - 1; // header(4) + af(2+5+1) + payload
      // Actually: adaptation field length, then PTS
      // Simplified: just add padding for adaptation
      const adFieldLen = 7; // 1 flags + 3 pts base + 1 pts ext + 2
      pkt[4] = adFieldLen;
      pkt[5] = 0x80; // PTS flag set
      // Write 5-byte PTS (33-bit PTS)
      const pts33 = pts & 0x1FFFFFFFF;
      pkt[6] = (0x20 | ((pts33 >> 29) & 0x0E) | 1); // '0010' + 3 PTS bits + marker
      pkt[7] = ((pts33 >> 22) & 0xFF);
      pkt[8] = (((pts33 >> 14) & 0xFE) | 1);
      pkt[9] = ((pts33 >> 7) & 0xFF);
      pkt[10] = (((pts33 << 1) & 0xFE) | 1);
      offset = 11;
    }

    return { pkt, offset };
  }

  _makeMpegTsPackets(encodedChunk, isAudio) {
    // Convert an EncodedVideoChunk or EncodedAudioChunk into one or more MPEG-TS packets
    // This is a simplified PES → TS packetizer
    const data = new Uint8Array(encodedChunk.byteLength);
    encodedChunk.copyTo(data);

    const pid = isAudio ? 0x100 : 0x200;
    const pts90k = Math.round(encodedChunk.timestamp * 90 / 1000); // ms → 90kHz
    const isKey = !isAudio && (encodedChunk.type === 'key');

    // PES header
    const streamId = isAudio ? 0xC0 : 0xE0;
    const pesHeaderLen = isKey ? 19 : 14; // with DTS for keyframes
    const pesLen = 3 + 1 + 2 + 1 + pesHeaderLen + data.length;
    const pes = new Uint8Array(3 + 1 + 2 + 1 + pesHeaderLen + data.length);
    let o = 0;
    // PES start code
    pes[o++] = 0x00; pes[o++] = 0x00; pes[o++] = 0x01;
    pes[o++] = streamId;
    // PES packet length
    const pLen = pes.length - 6;
    pes[o++] = (pLen >> 8) & 0xFF;
    pes[o++] = pLen & 0xFF;
    // Flags
    pes[o++] = 0x80; // PTS present
    if (isKey) pes[o - 1] = 0xC0; // PTS + DTS
    pes[o++] = pesHeaderLen; // header data length placeholder area
    // PTS (5 bytes)
    const pts33 = pts90k & 0x1FFFFFFFF;
    pes[o++] = (0x21 | ((pts33 >> 29) & 0x0E));
    pes[o++] = ((pts33 >> 22) & 0xFF);
    pes[o++] = (((pts33 >> 14) & 0xFE) | 1);
    pes[o++] = ((pts33 >> 7) & 0xFF);
    pes[o++] = (((pts33 << 1) & 0xFE) | 1);
    // DTS for keyframes
    if (isKey) {
      const dts33 = pts33; // simplified: DTS = PTS for low-latency
      pes[o++] = (0x11 | ((dts33 >> 29) & 0x0E));
      pes[o++] = ((dts33 >> 22) & 0xFF);
      pes[o++] = (((dts33 >> 14) & 0xFE) | 1);
      pes[o++] = ((dts33 >> 7) & 0xFF);
      pes[o++] = (((dts33 << 1) & 0xFE) | 1);
    }
    // Payload
    pes.set(data, o);

    // Split into 188-byte TS packets
    const packets = [];
    let pos = 0;
    let firstPacket = true;
    while (pos < pes.length) {
      const remaining = pes.length - pos;
      const chunkSize = Math.min(remaining, 184);
      const pkt = new Uint8Array(188);

      // Sync byte
      pkt[0] = 0x47;
      // PID + PUSI (payload unit start indicator on first packet)
      const pidVal = pid & 0x1FFF;
      pkt[1] = (firstPacket ? 0x40 : 0x00) | (pidVal >> 8);
      pkt[2] = pidVal & 0xFF;
      // Continuity counter
      const cont = isAudio ? (this._audioSeq++) & 0xF : (this._videoSeq++) & 0xF;

      if (chunkSize < 184) {
        // Need adaptation field padding
        pkt[3] = 0x30 | cont; // adaptation + payload
        const padLen = 183 - chunkSize;
        pkt[4] = padLen;
        for (let i = 5; i < 5 + padLen; i++) pkt[i] = 0xFF;
        pkt.set(pes.subarray(pos, pos + chunkSize), 5 + padLen);
      } else {
        pkt[3] = 0x10 | cont; // payload only
        pkt.set(pes.subarray(pos, pos + 184), 4);
      }

      packets.push(pkt);
      pos += chunkSize;
      firstPacket = false;
    }

    return packets;
  }

  // ─── WebCodecs streaming path ───

  async _startWebCodecsStream(stream) {
    const self = this;
    const fps = this._streamFps || 30;
    const bitrate = this.bitrate * 1000;

    // Video encoder (H.264)
    this._videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        const tsPackets = self._makeMpegTsPackets(chunk, false);
        const combined = new Uint8Array(tsPackets.length * 188);
        for (let i = 0; i < tsPackets.length; i++) {
          combined.set(tsPackets[i], i * 188);
        }
        window.electronAPI.writeStreamChunk(combined.buffer).catch(() => {});
      },
      error: (e) => {
        if (window.__sbDev) console.error('[WebCodecs] VideoEncoder error:', e);
        if (self.onError) self.onError('Ошибка видео-энкодера: ' + e.message);
      }
    });

    this._videoEncoder.configure({
      codec: 'avc1.640028', // H.264 High profile
      width: parseInt(this._streamResolution.split('x')[0]) || 1280,
      height: parseInt(this._streamResolution.split('x')[1]) || 720,
      bitrate: bitrate,
      framerate: fps,
      latencyMode: 'realtime',
      hardwareAcceleration: 'prefer-hardware',
    });

    // Audio encoder (AAC)
    this._audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        const tsPackets = self._makeMpegTsPackets(chunk, true);
        const combined = new Uint8Array(tsPackets.length * 188);
        for (let i = 0; i < tsPackets.length; i++) {
          combined.set(tsPackets[i], i * 188);
        }
        window.electronAPI.writeStreamChunk(combined.buffer).catch(() => {});
      },
      error: (e) => {
        if (window.__sbDev) console.error('[WebCodecs] AudioEncoder error:', e);
      }
    });

    this._audioEncoder.configure({
      codec: 'mp4a.40.2', // AAC-LC
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 160000,
    });

    // Feed audio from MediaStream via AudioContext + ScriptProcessor
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length > 0) {
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
      this._audioSourceNode = source;
      // Use ScriptProcessor to get raw PCM and feed to AudioEncoder
      // (AudioWorklet would be better but more complex)
      const processor = audioCtx.createScriptProcessor(4096, 2, 2);
      this._audioProcessor = processor;
      processor.onaudioprocess = (e) => {
        if (!self.isStreaming || !self._audioEncoder || self._audioEncoder.state === 'closed') return;
        const left = e.inputBuffer.getChannelData(0);
        const right = e.inputBuffer.getChannelData(1);
        // Interleave stereo
        const interleaved = new Float32Array(left.length * 2);
        for (let i = 0; i < left.length; i++) {
          interleaved[i * 2] = left[i];
          interleaved[i * 2 + 1] = right[i];
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: 48000,
          numberOfFrames: left.length,
          numberOfChannels: 2,
          timestamp: self._audioSamplesIn * 1000000 / 48, // microseconds
          data: interleaved,
        });
        self._audioSamplesIn += left.length;
        if (self._audioEncoder.state === 'configured') {
          self._audioEncoder.encode(audioData);
        }
        audioData.close();
      };
      source.connect(processor);
      processor.connect(audioCtx.destination); // must connect to destination to process
    }

    // Capture VideoFrames from canvas at target FPS
    this._frameTimer = setInterval(() => {
      if (!self.isStreaming || !self.canvas || !self._videoEncoder || self._videoEncoder.state === 'closed') return;
      try {
        const frame = new VideoFrame(self.canvas, {
          timestamp: self._ptsCounter,
        });
        self._ptsCounter += 1000000 / fps; // microseconds per frame
        const isKeyframe = (self._videoEncoder.encodeQueueSize === 0) ||
          (Math.round(self._ptsCounter / 1000000) % 2 === 0); // keyframe every 2 seconds
        const opts = isKeyframe ? { keyFrame: true } : undefined;
        if (self._videoEncoder.state === 'configured') {
          self._videoEncoder.encode(frame, opts);
        }
        frame.close();
      } catch (e) {
        if (window.__sbDev) console.warn('[WebCodecs] frame capture error:', e);
      }
    }, 1000 / fps);

    this._useWebCodecs = true;
  }

  _cleanupStreamEncoders() {
    if (this._frameTimer) { clearInterval(this._frameTimer); this._frameTimer = null; }
    if (this._videoEncoder) {
      try {
        if (this._videoEncoder.state === 'configured') this._videoEncoder.flush();
        this._videoEncoder.close();
      } catch(e) {}
      this._videoEncoder = null;
    }
    if (this._audioEncoder) {
      try {
        if (this._audioEncoder.state === 'configured') this._audioEncoder.flush();
        this._audioEncoder.close();
      } catch(e) {}
      this._audioEncoder = null;
    }
    if (this._audioProcessor) { try { this._audioProcessor.disconnect(); } catch(e) {} this._audioProcessor = null; }
    if (this._audioSourceNode) { try { this._audioSourceNode.disconnect(); } catch(e) {} this._audioSourceNode = null; }
    if (this._streamRecorder) {
      try { if (this._streamRecorder.state !== 'inactive') this._streamRecorder.stop(); } catch(e) {}
      this._streamRecorder = null;
    }
    this._ptsCounter = 0;
    this._audioSamplesIn = 0;
    this._audioSeq = 0;
    this._videoSeq = 0;
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

      // Tell main process to start ffmpeg with rtmp output
      const result = await window.electronAPI.startStream({
        rtmpUrl: this._streamServer,
        streamKey: this._streamKey,
        bitrate: this.bitrate,
        resolution: this._streamResolution,
        fps: this._streamFps,
        webcodecs: this._webCodecsSupported, // tell main we might send MPEG-TS
        encoder: this._encoder,              // GPU or CPU video encoder
      });
      if (!result || !result.success) {
        if (this.onError) this.onError(result && result.error ? result.error : 'Ошибка запуска FFmpeg');
        return;
      }

      if (this._webCodecsSupported) {
        // WebCodecs path: H.264 + AAC → MPEG-TS → FFmpeg (copy, no re-encode)
        if (window.__sbDev) console.log('[Stream] Using WebCodecs path (no re-encode)');
        await this._startWebCodecsStream(stream);
      } else {
        // Fallback: MediaRecorder (WebM) → FFmpeg (re-encode to H.264)
        if (window.__sbDev) console.log('[Stream] Using MediaRecorder fallback (re-encode)');
        const mime = this._pickMime();
        if (!mime) {
          if (this.onError) this.onError('Формат не поддерживается');
          return;
        }
        const self = this;
        const recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: this.bitrate * 1000,
          audioBitsPerSecond: 160000,
        });
        this._streamRecorder = recorder;
        recorder.ondataavailable = async (e) => {
          if (!self.isStreaming) return;
          if (e.data && e.data.size > 0) {
            try {
              const buf = await e.data.arrayBuffer();
              await window.electronAPI.writeStreamChunk(buf);
            } catch (err) {}
          }
        };
        recorder.onerror = (e) => {
          if (this.onError) this.onError((e.error && e.error.message) || 'Recorder error');
        };
        recorder.start(250);
      }

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
    // WebCodecs: just stop sending frames (interval keeps running but no encode)
    if (this._useWebCodecs) {
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
    if (this._useWebCodecs) {
      this.isPaused = false;
      if (this.onResume) this.onResume();
    }
  }

  async stop() {
    if (!this.isStreaming) return;
    try {
      this._cleanupStreamEncoders();
      await window.electronAPI.stopStream();
    } catch (e) {}
    this.isStreaming = false;
    this.isPaused = false;
    this._streamStartTime = null;
    this._useWebCodecs = false;
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

      this._recLiveMode = false;
      this._recFallbackChunks = null;
      try {
        const r = await window.electronAPI.startFFmpegRecording({ outputPath: this._recMp4Path });
        if (r && r.success) this._recLiveMode = true;
        else if (window.__sbDev) console.warn('[Rec] FFmpeg start failed, falling back to WebM:', r && r.error);
      } catch (e) {
        if (window.__sbDev) console.warn('[Rec] FFmpeg pipe error, falling back to WebM:', e);
      }
      if (!this._recLiveMode) { this._recFallbackChunks = []; this._recFallbackBytes = 0; }

      this._recOnStoppedHandler = (data) => {};

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
          } catch (err) {}
        } else if (this._recFallbackChunks) {
          this._recFallbackBytes = (this._recFallbackBytes || 0) + e.data.size;
          if (this._recFallbackBytes > 500 * 1024 * 1024) {
            if (this.onRecStop) this.onRecStop(null);
            if (this.onError) this.onError('Запись слишком длинная для WebM — используйте MP4');
            this.stopRecording();
            return;
          }
          this._recFallbackChunks.push(e.data);
        }
      };

      const recInstance = this._recorder;
      this._recorder.onstop = async () => {
        if (this._recorder === recInstance) this._recorder = null;
        if (this._recLiveMode) {
          try { await window.electronAPI.stopFFmpegRecording(); } catch(e) {}
          if (this._showConverting) try { this._showConverting('Финализация MP4…'); } catch(e) {}
          if (this.onSaveDone) this.onSaveDone(this._recMp4Path);
        } else {
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
        if (this._recorder === recInstance) {
          this._recording = false;
          this._recPaused = false;
          this._recorder = null;
        }
        if (this._recLiveMode) {
          try { window.electronAPI.stopFFmpegRecording(); } catch(_) {}
        }
        if (this.onError) this.onError((e.error && e.error.message) || 'Recording error');
      };

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
    if (!this._recording || this._recPaused) return;
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
