// WebRTC P2P Connection Manager (v2 — co-session ready)
// - Handles peer connections, media streams, signaling
// - STUN (Google defaults) + optional TURN
// - High-quality encoding presets (VP9 prefer, 8 Mbps video, stereo Opus 192k)
// - Exposes data-channel hooks to CoScene engine for collaborative editing

class PeerConnection {
  constructor(peerId, isInitiator, signalingSend, iceServers, opts, myPeerId) {
    this.peerId = peerId;
    this.isInitiator = isInitiator;
    this.signalingSend = signalingSend;
    this._myPeerId = myPeerId || '';
    this.pc = null;
    this.localStream = null;
    this.remoteStream = null;
    this.dataChannel = null;
    this.onRemoteStream = null;
    this.onIceCandidate = null;
    this.onDisconnected = null;
    this.onConnected = null;
    this.onIceFailed = null;              // (peerId) => void — ICE connection failed
    this.onDataChannel = null;            // (dc) => void  — wired by manager
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
      const trackInfo = event.track ? event.track.kind+':'+event.track.id+' readyState='+event.track.readyState+' muted='+event.track.muted : 'null';
      _p2pLog('[WebRTC] ontrack: peer='+this.peerId+' stream='+(this.remoteStream?this.remoteStream.id:'null')+' track='+trackInfo+' streams='+(event.streams?.length||0));
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
      _p2pLog('[WebRTC] connectionState: '+state+' peer='+this.peerId);
      if (state === 'connected' && this.onConnected) {
        this.onConnected(this.peerId);
      }
      if ((state === 'disconnected' || state === 'failed' || state === 'closed') && this.onDisconnected) {
        this.onDisconnected(this.peerId);
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      _p2pLog('[WebRTC] ICE state: '+state+' peer: '+this.peerId);
      if (state === 'failed') {
        try {
          if (this.isInitiator && this.pc.restartIce) this.pc.restartIce();
        } catch (e) {}
        // Notify user that P2P connection failed
        if (this.onIceFailed) this.onIceFailed(this.peerId);
      }
      if (state === 'closed') {
        if (this.onDisconnected) this.onDisconnected(this.peerId);
      }
    };

    this.pc.onnegotiationneeded = () => {
      _p2pLog('[WebRTC] onnegotiationneeded peer='+this.peerId+' state='+this.pc.signalingState);
    };

    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === 'stable' && (this._pendingRenegotiate || this._needsRenegotiate)) {
        this._pendingRenegotiate = false;
        this._needsRenegotiate = false;
        _p2pLog('[WebRTC] stable — firing pending/needed renegotiate');
        this._renegotiate();
      }
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
      _p2pLog('[WebRTC] DC open with ' + this.peerId);
    };
    dc.onclose = () => {
      _p2pLog('[WebRTC] DC close with ' + this.peerId);
    };
    dc.onerror = () => {};
    // Defer onDataChannel callback to next microtask: for INITIATOR side
    // this method is called synchronously inside the PeerConnection constructor,
    // BEFORE the manager has wired pc.onDataChannel. Without deferring,
    // attachChannel() never runs for initiator → CoScene never sends/receives
    // snapshots → peer sources fall back to heuristic naming ("Микрофон друга"
    // for first audio, "Звук друга" for second) regardless of actual type.
    const fireCallback = () => {
      if (this.onDataChannel) {
        try { this.onDataChannel(dc, this.peerId); } catch (e) {}
      } else {
        // Manager hasn't wired callback yet — try again on next tick.
        // This can happen during a race where _setupPeerConnection runs
        // synchronously inside the manager's `new PeerConnection(...)` call.
        setTimeout(fireCallback, 0);
      }
    };
    queueMicrotask(fireCallback);
  }

  // ─── Track / Stream management ────────────────────────────────────────

  async addLocalStream(stream) {
    this.localStream = stream;
    const existingSenders = this.pc.getSenders();
    const existingTrackIds = new Set(existingSenders.filter(s => s.track).map(s => s.track.id));
    const senders = [];
    _p2pLog('[WebRTC] addLocalStream: existing senders='+existingSenders.length+' existing tracks=['+[...existingTrackIds].join(',')+'] new tracks=['+stream.getTracks().map(t=>t.kind+':'+t.id).join(',')+'] state='+this.pc.signalingState);
    for (const track of stream.getTracks()) {
      if (existingTrackIds.has(track.id)) continue; // already added
      const sender = this.pc.addTrack(track, stream);
      senders.push(sender);
      this._tuneSender(sender, track.kind);
    }
    if (senders.length === 0) return senders; // no new tracks
    _p2pLog('[WebRTC] addLocalStream: added '+senders.length+' new tracks, total senders='+this.pc.getSenders().length+' transceivers='+this.pc.getTransceivers().length);
    // Mark that we need renegotiation, but don't fire it immediately.
    // _scheduleRenegotiate will coalesce multiple addLocalStream calls
    // into a single renegotiation.
    this._needsRenegotiate = true;
    this._scheduleRenegotiate();
    return senders;
  }

  _scheduleRenegotiate() {
    if (this._renegotiateTimer) return; // already scheduled
    this._renegotiateTimer = setTimeout(async () => {
      this._renegotiateTimer = null;
      if (!this._needsRenegotiate) return;
      this._needsRenegotiate = false;
      if (this.pc.signalingState === 'stable') {
        try { await this._renegotiate(); } catch (e) {
          _p2pLog('[WebRTC] WARN: scheduled renegotiate failed: '+e.name+' '+e.message);
        }
      } else {
        this._pendingRenegotiate = true;
      }
    }, 250); // 250ms coalesce window — allows multiple tracks to be added before one renegotiate
  }

  // Attach local tracks to existing transceivers after setRemoteDescription(offer).
  // This is the correct way for a joiner to send media — NOT addTrack before offer
  // (addTrack BEFORE offer creates orphan transceivers that don't match offer m-lines).
  //
  // Strategy: use pc.addTrack(track, stream) AFTER setRemoteDescription. Chromium's
  // unified-plan tries to reuse existing recvonly transceivers (created by the offer)
  // when their sender has no track and direction allows sending. If reused, msid is
  // properly set on the existing m-line. If a new transceiver is created (because
  // we have more tracks than the offer's m-lines), the follow-up renegotiate
  // includes the additional m-line.
  //
  // This is the canonical way to attach tracks. It avoids two bugs we hit before:
  // (1) replaceTrack alone doesn't set a=msid in the answer SDP — receiver gets
  //     ontrack with event.streams=[] and CoScene binding fails (root cause of the
  //     "friend can't hear my mic/desktop" + duplicate-peer-source symptoms).
  // (2) Manual transceiver matching is fragile — Chrome's algorithm handles it
  //     correctly with the proper kind/direction/sender.track checks.
  _attachLocalTracksToTransceivers() {
    if (!this._pendingLocalStreams || !this._pendingLocalStreams.length) return;
    const streams = this._pendingLocalStreams;
    this._pendingLocalStreams = null;
    // Build set of track IDs already attached to a sender (don't re-attach).
    const existingTrackIds = new Set();
    for (const s of this.pc.getSenders()) {
      if (s.track) existingTrackIds.add(s.track.id);
    }
    let added = 0;
    let attempted = 0;
    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        attempted++;
        if (existingTrackIds.has(track.id)) {
          _p2pLog('[WebRTC] addTrack skipped (already on a sender): '+track.kind+':'+track.id);
          continue;
        }
        try {
          const sender = this.pc.addTrack(track, stream);
          existingTrackIds.add(track.id);
          this._tuneSender(sender, track.kind);
          // Force transceiver direction to sendrecv if addTrack reused a
          // recvonly transceiver (Chrome doesn't always auto-upgrade direction).
          // Without this, our track is silently dropped despite having a sender.
          try {
            const tr = this.pc.getTransceivers().find(t => t.sender === sender);
            if (tr && (tr.direction === 'recvonly' || tr.direction === 'inactive')) {
              tr.direction = 'sendrecv';
              _p2pLog('[WebRTC] Bumped transceiver direction to sendrecv after addTrack reuse: '+track.kind);
            }
          } catch (_) {}
          added++;
          _p2pLog('[WebRTC] addTrack(post-offer) '+track.kind+':'+track.id+' stream='+stream.id);
        } catch (e) {
          _p2pLog('[WebRTC] WARN: addTrack failed for '+track.kind+':'+track.id+': '+e.message);
        }
      }
    }
    _p2pLog('[WebRTC] _attachLocalTracksToTransceivers: added '+added+'/'+attempted+' tracks');
    // Always schedule a follow-up renegotiate. Reasons:
    // - If addTrack reused an existing transceiver, the answer SDP already carries
    //   correct a=msid; the renegotiate is a harmless no-op (signalingState check
    //   prevents double-offers).
    // - If addTrack created a new transceiver (we had more tracks than offer m-lines),
    //   the new transceiver isn't in the answer (m-lines must match offer); the
    //   follow-up offer carries the additional m-line so the peer can receive it.
    if (added > 0) {
      this._needsRenegotiate = true;
      this._scheduleRenegotiate();
    }
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
      _p2pLog('[WebRTC] WARN: _tuneSender failed: '+e.message);
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
    if (this.pc.signalingState !== 'stable') {
      _p2pLog('[WebRTC] WARN: _renegotiate: not stable, state='+this.pc.signalingState+' — deferring');
      this._pendingRenegotiate = true;
      return;
    }
    this._pendingRenegotiate = false; // clear flag to prevent double-renegotiate
    try {
      // Use the "perfect negotiation" pattern: create an SDP offer, set it
      // as local description, and send it. Chrome requires setLocalDescription
      // with the EXACT offer returned by createOffer (no munging before set).
      const offer = await this.pc.createOffer({});
      if (this.pc.signalingState !== 'stable') return;
      // Log m-lines for debugging
      const ml = offer.sdp.match(/^m=/gm);
      _p2pLog('[WebRTC] _renegotiate: offer m-lines='+(ml?ml.length:0)+' transceivers='+this.pc.getTransceivers().length+' senders='+this.pc.getSenders().length);
      await this.pc.setLocalDescription(offer);
      this._applyCodecPreferences();
      // Munge SDP only for the wire (stereo Opus) — not for setLocalDescription
      const outSdp = this._mungeSdpForStereoOpus(this.pc.localDescription.sdp);
      this.signalingSend({
        type: 'signal',
        targetPeerId: this.peerId,
        signal: { type: 'sdp-offer', sdp: { type: this.pc.localDescription.type, sdp: outSdp } },
      });
    } catch (e) {
      // If setLocalDescription fails due to m-line mismatch (Chrome 41+),
      // do a full ICE restart to clear the stale SDP state.
      _p2pLog('[WebRTC] WARN: _renegotiate failed: '+e.name+' '+e.message+' state='+this.pc.signalingState+' senders='+this.pc.getSenders().length);
      try {
        if (this.pc.signalingState !== 'stable') {
          await this.pc.setLocalDescription({ type: 'rollback' });
        }
        // Retry with restartIce to generate a fresh offer
        if (this.pc.restartIce) {
          _p2pLog('[WebRTC] retrying with restartIce');
          this.pc.restartIce();
        }
      } catch (e2) {
        _p2pLog('[WebRTC] WARN: rollback/restartIce also failed: '+e2.name+' '+e2.message);
      }
    }
  }

  async createOffer() {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    this._applyCodecPreferences();
    const mungedSdp = this._mungeSdpForStereoOpus(this.pc.localDescription.sdp);
    this.signalingSend({
      type: 'signal',
      targetPeerId: this.peerId,
      signal: { type: 'sdp-offer', sdp: { type: this.pc.localDescription.type, sdp: mungedSdp } },
    });
  }

  async handleSignal(signal) {
    if (signal.type === 'sdp-offer') {
      // Cancel joiner fallback renegotiate timer — initiator's offer arrived
      if (this._joinRenegotiateTimer) {
        clearTimeout(this._joinRenegotiateTimer);
        this._joinRenegotiateTimer = null;
      }
      // Perfect Negotiation / Polite Peer pattern:
      // If we also have a local offer (glare), the "impolite" peer wins.
      // The polite peer rolls back its offer and accepts the incoming one.
      const isGlare = this.pc.signalingState === 'have-local-offer';
      if (isGlare) {
        // Use peerId to deterministically decide who is "polite" (lower ID yields)
        const isPolite = this.peerId > (this._myPeerId || '');
        if (isPolite) {
          // We are polite: rollback our offer and accept theirs
          _p2pLog('[WebRTC] Glare resolved: we are polite, rolling back our offer for '+this.peerId);
          try {
            await this.pc.setLocalDescription({ type: 'rollback' });
          } catch (e) {
            _p2pLog('[WebRTC] WARN: Rollback failed: '+e.name+' '+e.message);
            return;
          }
          // After rollback, we need to re-send our tracks in a new renegotiate
          // after processing their offer. Schedule it.
          this._needsRenegotiate = true;
        } else {
          // We are impolite: ignore their offer, ours takes priority
          _p2pLog('[WebRTC] Glare resolved: we are impolite, ignoring incoming offer for '+this.peerId);
          return;
        }
      }
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } catch (e) {
        _p2pLog('[WebRTC] WARN: setRemoteDescription(offer) failed: '+e.name+' '+e.message);
        return;
      }
      // After setRemoteDescription(offer), transceivers are created for each m-line.
      // Now we can attach our local tracks to these transceivers.
      // This is the CORRECT way for a joiner to add tracks — NOT via addTrack before offer.
      this._attachLocalTracksToTransceivers();
      this._applyCodecPreferences();
      const answer = await this.pc.createAnswer();
      const mlA = answer.sdp.match(/^m=/gm);
      _p2pLog('[WebRTC] createAnswer: m-lines='+(mlA?mlA.length:0)+' transceivers='+this.pc.getTransceivers().length+' senders='+this.pc.getSenders().length);
      // Set local description FIRST with unmodified SDP (Chrome 41+ validates strictly)
      await this.pc.setLocalDescription(answer);
      // Now munge for sending
      const mungedSdp = this._mungeSdpForStereoOpus(this.pc.localDescription.sdp);
      // Tune any senders that exist now
      for (const s of this.pc.getSenders()) {
        if (s.track) this._tuneSender(s, s.track.kind);
      }
      this.signalingSend({
        type: 'signal',
        targetPeerId: this.peerId,
        signal: { type: 'sdp-answer', sdp: { type: this.pc.localDescription.type, sdp: mungedSdp } },
      });
    } else if (signal.type === 'sdp-answer') {
      // Cancel joiner fallback timer — our offer was answered
      if (this._joinRenegotiateTimer) {
        clearTimeout(this._joinRenegotiateTimer);
        this._joinRenegotiateTimer = null;
      }
      // Ignore stale answers when not expecting one
      if (this.pc.signalingState !== 'have-local-offer') return;
      try {
        await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      } catch (e) {
        _p2pLog('[WebRTC] WARN: setRemoteDescription(answer) failed: '+e.name+' '+e.message+' state='+this.pc.signalingState);
        // m-line mismatch: do a full ICE restart to recover
        try {
          if (this.pc.signalingState !== 'stable') {
            await this.pc.setLocalDescription({ type: 'rollback' });
          }
          // Schedule a fresh renegotiate after recovery
          this._needsRenegotiate = true;
          this._scheduleRenegotiate();
        } catch (e2) {
          _p2pLog('[WebRTC] WARN: recovery also failed: '+e2.name+' '+e2.message);
        }
        return;
      }
      // Tune senders once remote SDP is in
      for (const s of this.pc.getSenders()) {
        if (s.track) this._tuneSender(s, s.track.kind);
      }
    } else if (signal.type === 'ice-candidate') {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        _p2pLog('[WebRTC] WARN: Error adding ICE candidate: '+e.message);
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
    this._userJoinedRoom = false; // true only when user explicitly creates/joins a room
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
    this.signalingServerUrl = 'wss://streambro.ru/signaling';

    // Server-mediated signaling via Presence WS
    this._usePresenceSignaling = false; // true = use Presence WS relay
    this._presenceSignalSend = null;     // (msg) => void — sends via Presence WS

    this.turnUrl = '';
    this.turnUser = '';
    this.turnPass = '';

    // Quality preset (movie-grade)
    this.qualityOpts = {
      maxVideoBitrate: 2_500_000,
      maxAudioBitrate: 64_000,
      preferStereoOpus: false,
      preferVP9: false,
    };
  }

  setSignalingServer(url) { this.signalingServerUrl = url; }

  // Use Presence WebSocket as signaling channel (server-mediated P2P)
  setSignalingChannel(sendFn, onSignalFn) {
    this._usePresenceSignaling = true;
    this._presenceSignalSend = sendFn; // (msg) => void — posts signal to Presence WS
    if (onSignalFn) this._onPresenceSignal = onSignalFn;
  }

  // Called by main process when Presence WS receives a signal message
  handlePresenceSignal(msg) {
    if (msg.type === 'signal') {
      this._handleSignal(msg.fromPeerId, msg.signal);
    } else if (msg.type === 'room-joined-server') {
      // Server-room join: we get room code + list of existing peer user IDs
      // Only process if user explicitly created/joined a room — ignore stale reconnects
      if (!this._userJoinedRoom) {
        _p2pLog('[WebRTC] Ignoring stale room-joined-server (no user action)');
        return;
      }
      this.myPeerId = msg.myUserId;
      this.roomCode = msg.roomCode;
      for (const existingPeerId of msg.peers) {
        this._createPeerConnection(existingPeerId, true);
      }
      if (this.onRoomJoined) this.onRoomJoined(msg.roomCode, msg.myUserId, msg.peers);
      // Notify app.js to send source streams to the newly created peer connections
      if (this.onPeerConnectionsReady) this.onPeerConnectionsReady(msg.peers);
    } else if (msg.type === 'peer-joined-server') {
      this._createPeerConnection(msg.peerId, false);
      if (this.onPeersList) this.onPeersList(msg.peerId);
      // Notify app.js to send source streams to the new peer
      if (this.onPeerConnectionsReady) this.onPeerConnectionsReady([msg.peerId]);
    } else if (msg.type === 'peer-left-server') {
      this._removePeer(msg.peerId);
    }
  }

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
      _p2pLog('[WebRTC] TURN relay configured: '+base.replace(/\/\/.*@/, '//***@'));
    }
    return servers;
  }

  _signalingSend(msg) {
    if (this._usePresenceSignaling && this._presenceSignalSend) {
      // Route through Presence WS (server-mediated)
      const signalMsg = {
        type: 'signal',
        targetPeerId: msg.targetPeerId,
        signal: msg.signal,
        roomCode: this.roomCode,
      };
      _p2pLog('[WebRTC] Sending signal via Presence: '+msg.signal?.type+' target='+msg.targetPeerId+' roomCode='+this.roomCode);
      this._presenceSignalSend(signalMsg);
    } else if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.signalingServerUrl);

      this.ws.onopen = () => {
        _p2pLog('[Signaling] Connected to server');
        resolve();
      };

      this.ws.onerror = (err) => {
        _p2pLog('[Signaling] Connection error: '+(err?.message||err));
        reject(err);
      };

      this.ws.onclose = () => {
        _p2pLog('[Signaling] Disconnected from server');
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
    // If a PeerConnection already exists for this peer, close it first
    // (needed for reconnect after network interruption)
    if (this.peers.has(peerId)) {
      const old = this.peers.get(peerId);
      try { old.close(); } catch (_) {}
      this.peers.delete(peerId);
    }
    const iceServers = this._buildIceServers();
    const pc = new PeerConnection(peerId, isInitiator, (msg) => this._signalingSend(msg), iceServers, this.qualityOpts, this.myPeerId);

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
    pc.onIceFailed = (pid) => {
      if (this.onIceFailed) this.onIceFailed(pid);
    };
    pc.onDataChannel = (dc, pid) => {
      if (this.onDataChannel) this.onDataChannel(dc, pid);
    };

    this.peers.set(peerId, pc);

    // Do NOT replay localStreams or do bare renegotiate here.
    // app.js's onPeerConnectionsReady callback will call _sendSourceStreamsToPeers()
    // which adds all local tracks in one batch and triggers a single renegotiate.
  }

  async addLocalStreamToAllPeers(stream) {
    if (!stream) return;
    this.localStreams.add(stream);
    for (const [peerId, pc] of this.peers) {
      try { await pc.addLocalStream(stream); } catch (e) {
        _p2pLog('[WebRTC] WARN: addLocalStream failed for '+peerId+': '+e.message);
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
      pc = new PeerConnection(fromPeerId, false, (msg) => this._signalingSend(msg), iceServers, this.qualityOpts, this.myPeerId);
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
      pc.onIceFailed = (pid) => {
        if (this.onIceFailed) this.onIceFailed(pid);
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
