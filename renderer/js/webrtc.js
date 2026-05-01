// WebRTC P2P Connection Manager (v2 — co-session ready)
// - Handles peer connections, media streams, signaling
// - STUN (Google defaults) + optional TURN
// - High-quality encoding presets (VP9 prefer, 8 Mbps video, stereo Opus 192k)
// - Exposes data-channel hooks to CoScene engine for collaborative editing

class PeerConnection {
  constructor(peerId, isInitiator, signalingSend, iceServers, opts) {
    this.peerId = peerId;
    this.isInitiator = isInitiator;
    this.signalingSend = signalingSend;
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.dataChannel = null;
    this.onRemoteStream = null;
    this.onIceCandidate = null;
    this.onDisconnected = null;
    this.onConnected = null;
    this.onDataChannel = null;          // (dc) => void  — wired by manager
    this.onTrack = null;                // (event)        — wired by manager

    // Quality / encoding hints
    this.opts = opts || {};
    this.maxVideoBitrate = this.opts.maxVideoBitrate || 8_000_000; // 8 Mbps
    this.maxAudioBitrate = this.opts.maxAudioBitrate || 192_000;   // 192 kbps stereo
    this.preferStereoOpus = this.opts.preferStereoOpus !== false;
    this.preferVP9 = this.opts.preferVP9 !== false;

    this.iceServers = iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ];

    this._init();
  }

  _init() {
    this.pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      // Lower-latency hint for the peer (movie watching with friends).
      // Browser ignores unknown fields; this is just informative.
      // sdpSemantics: 'unified-plan' is default in modern Chromium.
    });

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingSend({
          type: 'signal',
          targetPeerId: this.peerId,
          signal: { type: 'ice-candidate', candidate: event.candidate },
        });
      }
    };

    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams && event.streams[0];
      // Forward to manager-level handler with the full event so we can
      // grab transceiver.mid / streams[0].id for source binding.
      if (this.onTrack) {
        try { this.onTrack(event, this.peerId); } catch (e) {}
      }
      if (this.onRemoteStream && this.remoteStream) {
        try { this.onRemoteStream(this.remoteStream, this.peerId, event); } catch (e) {}
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected' && this.onConnected) {
        this.onConnected(this.peerId);
      }
      if ((state === 'disconnected' || state === 'failed' || state === 'closed') && this.onDisconnected) {
        this.onDisconnected(this.peerId);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'failed') {
        try {
          if (this.isInitiator && this.pc.restartIce) this.pc.restartIce();
        } catch (e) {}
      }
      if (state === 'closed') {
        if (this.onDisconnected) this.onDisconnected(this.peerId);
      }
    };

    this.pc.onnegotiationneeded = () => {
      // We renegotiate explicitly when adding tracks — ignore implicit
      // triggers to avoid double-offers.
    };

    // If initiator, create data channel and send offer
    if (this.isInitiator) {
      // ordered:true preserves message ordering (important for snapshot+ops);
      // priority:'high' lets the channel jump video queues for low latency.
      this.dataChannel = this.pc.createDataChannel('streamco-control', {
        ordered: true,
        priority: 'high',
      });
      this._wireDataChannel(this.dataChannel);
    } else {
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._wireDataChannel(this.dataChannel);
      };
    }
  }

  _wireDataChannel(dc) {
    if (!dc) return;
    dc.onopen = () => {
      if (window.__sbDev) console.log('[WebRTC] DC open with ' + this.peerId);
    };
    dc.onclose = () => {
      if (window.__sbDev) console.log('[WebRTC] DC close with ' + this.peerId);
    };
    dc.onerror = () => {};
    if (this.onDataChannel) {
      try { this.onDataChannel(dc, this.peerId); } catch (e) {}
    }
  }

  // ─── Track / Stream management ────────────────────────────────────────

  async addLocalStream(stream) {
    this.localStream = stream;
    const senders = [];
    for (const track of stream.getTracks()) {
      const sender = this.pc.addTrack(track, stream);
      senders.push(sender);
      this._tuneSender(sender, track.kind);
    }
    // Renegotiate on add
    if (this.isInitiator || this.pc.signalingState === 'stable') {
      try { await this._renegotiate(); } catch (e) {
        if (window.__sbDev) console.warn('[WebRTC] renegotiate after addLocalStream failed:', e);
      }
    }
    return senders;
  }

  // Apply quality tuning to an outgoing sender (high bitrate, priority).
  _tuneSender(sender, kind) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) params.encodings = [{}];
      const enc = params.encodings[0];
      if (kind === 'video') {
        enc.maxBitrate = this.maxVideoBitrate;
        enc.priority = 'high';
        enc.networkPriority = 'high';
        if (params.degradationPreference !== 'maintain-resolution') {
          // For "shared movie watching" we prefer to keep resolution and drop framerate
          // when the network gets tight. Also makes drag/edit jitter less noticeable.
          params.degradationPreference = 'maintain-resolution';
        }
      } else if (kind === 'audio') {
        enc.maxBitrate = this.maxAudioBitrate;
        enc.priority = 'high';
        enc.networkPriority = 'high';
      }
      sender.setParameters(params).catch(() => {});
    } catch (e) {
      if (window.__sbDev) console.warn('[WebRTC] _tuneSender failed:', e);
    }
  }

  _applyCodecPreferences() {
    if (typeof RTCRtpReceiver === 'undefined' || !RTCRtpReceiver.getCapabilities) return;
    try {
      // Video: VP9 → VP8 → H264 → AV1
      const vCaps = RTCRtpReceiver.getCapabilities('video');
      if (vCaps && vCaps.codecs && this.preferVP9) {
        const order = (mt) => {
          const m = (mt || '').toLowerCase();
          if (m.includes('vp9')) return 0;
          if (m.includes('vp8')) return 1;
          if (m.includes('h264')) return 2;
          if (m.includes('av1')) return 3;
          return 9;
        };
        const sorted = vCaps.codecs.slice().sort((a, b) => order(a.mimeType) - order(b.mimeType));
        for (const tr of this.pc.getTransceivers()) {
          if (tr.receiver && tr.receiver.track && tr.receiver.track.kind === 'video' && tr.setCodecPreferences) {
            try { tr.setCodecPreferences(sorted); } catch (_) {}
          } else if (tr.sender && tr.sender.track && tr.sender.track.kind === 'video' && tr.setCodecPreferences) {
            try { tr.setCodecPreferences(sorted); } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  // SDP munging: tell Opus to operate in stereo with a higher max bitrate.
  // This is necessary because Chromium's default fmtp is mono Opus 32 kbps.
  _mungeSdpForStereoOpus(sdp) {
    if (!this.preferStereoOpus || !sdp) return sdp;
    try {
      // Find the dynamic payload type for opus, then enrich its fmtp line.
      const lines = sdp.split('\r\n');
      const ptMap = new Map();
      const ptRegex = /^a=rtpmap:(\d+)\s+opus\/48000\/2/i;
      for (const l of lines) {
        const m = l.match(ptRegex);
        if (m) ptMap.set(m[1], true);
      }
      if (!ptMap.size) return sdp;
      const out = [];
      const fmtpHave = new Set();
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const fm = l.match(/^a=fmtp:(\d+)\s+(.*)$/);
        if (fm && ptMap.has(fm[1])) {
          fmtpHave.add(fm[1]);
          let body = fm[2];
          if (!/stereo=/.test(body))         body += ';stereo=1';
          if (!/sprop-stereo=/.test(body))   body += ';sprop-stereo=1';
          if (!/maxaveragebitrate=/.test(body)) body += ';maxaveragebitrate=' + Math.round(this.maxAudioBitrate);
          if (!/useinbandfec=/.test(body))   body += ';useinbandfec=1';
          out.push('a=fmtp:' + fm[1] + ' ' + body);
        } else {
          out.push(l);
        }
      }
      // For payload types that had rtpmap but no fmtp line, append one
      for (const pt of ptMap.keys()) {
        if (!fmtpHave.has(pt)) {
          // Insert fmtp after the corresponding rtpmap line
          const idx = out.findIndex(l => l.startsWith('a=rtpmap:' + pt + ' '));
          if (idx >= 0) {
            out.splice(idx + 1, 0,
              'a=fmtp:' + pt + ' minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=' + Math.round(this.maxAudioBitrate));
          }
        }
      }
      return out.join('\r\n');
    } catch (e) {
      return sdp;
    }
  }

  async _renegotiate() {
    // Either side may add tracks at any time (e.g. answerer mutes a mic later
    // and adds a camera). The "polite peer" pattern below avoids glare:
    if (this.pc.signalingState !== 'stable') {
      // Already negotiating — let the in-flight offer/answer settle first
      return;
    }
    try {
      const offer = await this.pc.createOffer({});
      offer.sdp = this._mungeSdpForStereoOpus(offer.sdp);
      // If the remote sent a competing offer in between, abandon ours
      if (this.pc.signalingState !== 'stable') return;
      await this.pc.setLocalDescription(offer);
      this._applyCodecPreferences();
      this.signalingSend({
        type: 'signal',
        targetPeerId: this.peerId,
        signal: { type: 'sdp-offer', sdp: this.pc.localDescription },
      });
    } catch (e) {
      if (window.__sbDev) console.warn('[WebRTC] _renegotiate failed:', e);
    }
  }

  async createOffer() {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    offer.sdp = this._mungeSdpForStereoOpus(offer.sdp);
    await this.pc.setLocalDescription(offer);
    this._applyCodecPreferences();
    this.signalingSend({
      type: 'signal',
      targetPeerId: this.peerId,
      signal: { type: 'sdp-offer', sdp: this.pc.localDescription },
    });
  }

  async handleSignal(signal) {
    if (signal.type === 'sdp-offer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      this._applyCodecPreferences();
      const answer = await this.pc.createAnswer();
      answer.sdp = this._mungeSdpForStereoOpus(answer.sdp);
      await this.pc.setLocalDescription(answer);
      // Tune any senders that exist now
      for (const s of this.pc.getSenders()) {
        if (s.track) this._tuneSender(s, s.track.kind);
      }
      this.signalingSend({
        type: 'signal',
        targetPeerId: this.peerId,
        signal: { type: 'sdp-answer', sdp: this.pc.localDescription },
      });
    } else if (signal.type === 'sdp-answer') {
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      // Tune senders once remote SDP is in
      for (const s of this.pc.getSenders()) {
        if (s.track) this._tuneSender(s, s.track.kind);
      }
    } else if (signal.type === 'ice-candidate') {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        if (window.__sbDev) console.warn('[WebRTC] Error adding ICE candidate:', e);
      }
    }
  }

  sendControlMessage(data) {
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try { this.dataChannel.send(typeof data === 'string' ? data : JSON.stringify(data)); } catch (_) {}
    }
  }

  close() {
    if (this.dataChannel) try { this.dataChannel.close(); } catch (_) {}
    if (this.pc) try { this.pc.close(); } catch (_) {}
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
  }
}

class WebRTCManager {
  constructor() {
    this.peers = new Map(); // peerId -> PeerConnection
    this.myPeerId = null;
    this.ws = null;
    this.roomCode = null;
    // Track all local streams we want to keep replicated across peers — when a
    // new peer joins later, we replay these so they immediately receive all our media.
    this.localStreams = new Set();
    this.onRemoteStream = null;
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onRoomCreated = null;
    this.onRoomJoined = null;
    this.onError = null;
    this.onPeersList = null;
    this.onDataChannel = null;     // (dc, peerId) — for CoScene
    this.onPeerTrack = null;       // (event, peerId) — raw track event
    this.signalingServerUrl = 'ws://localhost:7890';

    this.turnUrl = '';
    this.turnUser = '';
    this.turnPass = '';

    // Quality preset (movie-grade)
    this.qualityOpts = {
      maxVideoBitrate: 8_000_000,
      maxAudioBitrate: 192_000,
      preferStereoOpus: true,
      preferVP9: true,
    };
  }

  setSignalingServer(url) { this.signalingServerUrl = url; }

  setTurnConfig(url, user, pass) {
    this.turnUrl  = (url  || '').trim();
    this.turnUser = (user || '').trim();
    this.turnPass = (pass || '').trim();
  }

  setQualityOpts(opts) {
    this.qualityOpts = Object.assign({}, this.qualityOpts, opts || {});
  }

  _buildIceServers() {
    const servers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
    ];
    if (this.turnUrl && this.turnUser && this.turnPass) {
      const base = this.turnUrl.replace(/\/$/, '');
      servers.push({
        urls: [
          base + '?transport=udp',
          base + '?transport=tcp',
          ...(base.startsWith('turns:') || base.match(/:443\b/) ? [base + '?transport=tcp'] : []),
        ],
        username: this.turnUser,
        credential: this.turnPass,
      });
      if (window.__sbDev) console.log('[WebRTC] TURN relay configured:', base.replace(/\/\/.*@/, '//***@'));
    }
    return servers;
  }

  _signalingSend(msg) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingServerUrl);

      this.ws.onopen = () => {
        if (window.__sbDev) console.log('[Signaling] Connected to server');
        resolve();
      };

      this.ws.onerror = (err) => {
        if (window.__sbDev) console.error('[Signaling] Connection error:', err);
        reject(err);
      };

      this.ws.onclose = () => {
        if (window.__sbDev) console.log('[Signaling] Disconnected from server');
      };

      this.ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        this._handleSignalingMessage(msg);
      };
    });
  }

  _handleSignalingMessage(msg) {
    switch (msg.type) {
      case 'room-created':
        this.myPeerId = msg.peerId;
        this.roomCode = msg.code;
        if (this.onRoomCreated) this.onRoomCreated(msg.code, msg.peerId);
        break;

      case 'room-joined':
        this.myPeerId = msg.peerId;
        this.roomCode = msg.code;
        for (const existingPeerId of msg.peers) {
          this._createPeerConnection(existingPeerId, true);
        }
        if (this.onRoomJoined) this.onRoomJoined(msg.code, msg.peerId, msg.peers);
        break;

      case 'peer-joined':
        this._createPeerConnection(msg.peerId, false);
        if (this.onPeersList) this.onPeersList(msg.peerId);
        break;

      case 'signal':
        this._handleSignal(msg.fromPeerId, msg.signal);
        break;

      case 'peer-left':
        this._removePeer(msg.peerId);
        break;

      case 'error':
        if (this.onError) this.onError(msg.message);
        break;
    }
  }

  _createPeerConnection(peerId, isInitiator) {
    if (this.peers.has(peerId)) return;
    const iceServers = this._buildIceServers();
    const pc = new PeerConnection(peerId, isInitiator, (msg) => this._signalingSend(msg), iceServers, this.qualityOpts);

    pc.onRemoteStream = (stream, pid, event) => {
      if (this.onRemoteStream) this.onRemoteStream(stream, pid, event);
    };
    pc.onTrack = (event, pid) => {
      if (this.onPeerTrack) this.onPeerTrack(event, pid);
    };
    pc.onConnected = (pid) => {
      if (this.onPeerConnected) this.onPeerConnected(pid);
    };
    pc.onDisconnected = (pid) => {
      if (this.onPeerDisconnected) this.onPeerDisconnected(pid);
    };
    pc.onDataChannel = (dc, pid) => {
      if (this.onDataChannel) this.onDataChannel(dc, pid);
    };

    this.peers.set(peerId, pc);

    // Replay all locally-owned streams to this new peer so they receive our
    // mic / camera / screen / desktop-audio without us having to re-add them.
    const replay = async () => {
      for (const s of this.localStreams) {
        try { await pc.addLocalStream(s); } catch (e) {
          if (window.__sbDev) console.warn('[WebRTC] replay addLocalStream failed:', e);
        }
      }
      if (isInitiator) {
        // Either createOffer for the first time, or _renegotiate after replay
        // (the latter is a no-op if there are no streams).
        if (this.localStreams.size === 0) await pc.createOffer();
        // else: addLocalStream already triggers _renegotiate inside
      }
    };
    replay();
  }

  async addLocalStreamToAllPeers(stream) {
    if (!stream) return;
    this.localStreams.add(stream);
    for (const [peerId, pc] of this.peers) {
      try { await pc.addLocalStream(stream); } catch (e) {
        if (window.__sbDev) console.warn('[WebRTC] addLocalStream failed for', peerId, e);
      }
    }
  }

  async addLocalStreamToPeer(peerId, stream) {
    const pc = this.peers.get(peerId);
    if (pc) await pc.addLocalStream(stream);
  }

  removeLocalStream(stream) {
    this.localStreams.delete(stream);
  }

  async _handleSignal(fromPeerId, signal) {
    let pc = this.peers.get(fromPeerId);
    if (!pc) {
      const iceServers = this._buildIceServers();
      pc = new PeerConnection(fromPeerId, false, (msg) => this._signalingSend(msg), iceServers, this.qualityOpts);
      pc.onRemoteStream = (stream, pid, event) => {
        if (this.onRemoteStream) this.onRemoteStream(stream, pid, event);
      };
      pc.onTrack = (event, pid) => {
        if (this.onPeerTrack) this.onPeerTrack(event, pid);
      };
      pc.onConnected = (pid) => {
        if (this.onPeerConnected) this.onPeerConnected(pid);
      };
      pc.onDisconnected = (pid) => {
        if (this.onPeerDisconnected) this.onPeerDisconnected(pid);
      };
      pc.onDataChannel = (dc, pid) => {
        if (this.onDataChannel) this.onDataChannel(dc, pid);
      };
      this.peers.set(fromPeerId, pc);
      // Replay our local streams (so far) to the just-created PC
      for (const s of this.localStreams) {
        try { await pc.addLocalStream(s); } catch (_) {}
      }
    }
    await pc.handleSignal(signal);
  }

  _removePeer(peerId) {
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
    if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
  }

  createRoom() { this._signalingSend({ type: 'create' }); }
  joinRoom(code) { this._signalingSend({ type: 'join', code }); }

  leaveRoom() {
    this._signalingSend({ type: 'leave' });
    for (const [peerId, pc] of this.peers) {
      pc.close();
    }
    this.peers.clear();
    this.localStreams.clear();
    this.roomCode = null;
  }

  disconnect() {
    this.leaveRoom();
    if (this.ws) this.ws.close();
  }
}

window.WebRTCManager = WebRTCManager;
window.PeerConnection = PeerConnection;
