// StreamBro v12 — persistent settings, real RTMP, themes, hotkeys, perf throttling

(function(){
'use strict';
document.oncontextmenu=e=>{
  // Allow right-click in chat panel for copy/edit/delete context menu
  if(e.target.closest('#friendChatPanel')) return;
  e.preventDefault();
};

const HANDLE_R=9, HIT_R=24, ROT_OFF=34, SNAP=30, MIN_DIM=20;
let _gateWorkletLoaded=null;    // Promise — resolved once noise-gate AudioWorklet is registered
let _rnnoiseWorkletLoaded=null; // Promise — resolved once rnnoise AudioWorklet is registered

const S={
  srcs:[], selId:null, items:[], wrtc:null, rtmp:null, streaming:false, roomCode:null,
  ctx:null, anim:null, gl:null, _useGL:false, overlayCtx:null,
  drag:null, res:null, rot:null, rotC:null, crop:null, selItem:null,
  spacePan:false,
  alt:false, cw:1920, ch:1080,
  viewZoom:1,
  desktopAudioId:null,
  frameAnimTime:0,
  // ─── Audio Pipeline ───
  audioCtx:null,
  audioDest:null,        // MediaStreamDestination → recording/stream output
  audioNodes:new Map(),  // srcId → { sourceNode, gainNode, monitorGain, analyser, effectsChain }
  audioEffects:new Map(), // srcId → { noiseGate, eqLow, eqMid, eqHigh, compressor, limiter, fxState }
  _soundsMutedByStream:false,
  // ─── RNNoise AI denoising ───
  _rnnoiseEnabled:false,
  _rnnoiseWasm:null,
  _rnnoiseWasmLoaded:false,
  _rnnoiseNodes:new Map(), // srcId → AudioWorkletNode
  combinedStream:null,
  _canvasVideoTrack:null,
  _recTimerInterval:null,
  _ffmpegRecPath:null,
  // ─── Persistent settings (mirrored from main process) ───
  settings:null,
  // ─── Performance ───
  targetFps:60,
  _captureFps:60,  // FPS for recording/streaming (never reduced by reducedMotion)
  _lastRenderAt:0,
  _levelsRAF:null,
  _settingsSaveTimer:null,
  _dirty:true,          // dirty-flag: true = scene needs repaint
  _sortedItemsCache:null,
  _srcMapCache:null,
  _userFps:null,        // saved user FPS preference (restored when reducedMotion off)
  // ─── Stream status ───
  streamStatus:'offline',
  // ─── Hotkeys / view ───
  showGrid:false,
  showSafeAreas:false,
  reducedMotion:false,
  // ─── Undo history (last 3 transformations) ───
  _undoStack:[],
  _undoMax:10,
  _lastRoomCreateAt:0,
  // ─── Co-session (collaborative scene) ───
  co:null,             // CoScene instance (lazy)
  myPeerId:null,       // assigned by signaling server on room-created/joined
  remoteCursors:new Map(), // peerId -> {x,y,t}
  _handledPeerStreams:new Set(), // stream.id already processed in _onPeerTrack (dedup)
  _perSourceStreams:new Map(),   // srcId -> MediaStream sent to peers individually
  _p2pLog:[],                   // P2P debug log — always collected, exportable to file
  _wrtcPrevPerSource:null,      // Map<srcId, MediaStream> last sent to WebRTC
};
const D={};
function $(id){return document.getElementById(id)}

// ═══════════════════════════════════════════════════════════
//  P2P DEBUG LOG — always collects, exportable to file for diagnostics
// ═══════════════════════════════════════════════════════════
function _p2pLog(msg){
  const ts=new Date().toISOString().substr(11,12); // HH:MM:SS.mmm
  const entry='['+ts+'] '+msg;
  if(window._sbP2pLog) window._sbP2pLog.push(entry);
  if(window._sbP2pLog && window._sbP2pLog.length>5000) window._sbP2pLog.splice(0,window._sbP2pLog.length-5000);
  if(window.__sbDev) console.log(entry);
}
// Re-export globals (streaming.js already created the stub)
window._p2pLog=_p2pLog;
window._sbP2pLog=S._p2pLog;

// ═══════════════════════════════════════════════════════════
//  CO-SESSION HELPERS — delegates to SBSources / inline
// ═══════════════════════════════════════════════════════════
function _newSid(){return SBSources.newSid();}
function _isRemote(){ return S.co && S.co.applyingRemote(); }
function _currentSrcOrder(){ return SBSources.currentSrcOrder(); }
// Debounced src.update broadcaster (used for high-rate UI like volume slider)
const _coUpdTimers=new Map();
function _coBroadcastSrcUpdateDebounced(s,delay){
  if(!S.co||_isRemote()) return;
  const id=s.id;
  clearTimeout(_coUpdTimers.get(id));
  _coUpdTimers.set(id,setTimeout(()=>{
    _coUpdTimers.delete(id);
    try{ _coSafe(co=>co.broadcastSourceUpdate()); }catch(e){if(window.__sbDev)console.warn('[co]',e);}
  },delay||120));
}
// Safe wrappers — call into CoScene without ever throwing into the caller.
function _coSafe(fn){
  if(!S.co) return;
  try{ fn(S.co); }catch(e){ if(window.__sbDev) console.warn('[co]',e); }
}

// ═══════════════════════════════════════════════════════════
//  FRAME PRESETS
// ═══════════════════════════════════════════════════════════
const framePresets={
  none:{enabled:false,style:'solid',color:'#ffd23c',thickness:8,opacity:1,glow:{enabled:false,color:'#ffd23c',size:15,inward:true,outward:true},animation:'none',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ffd23c',gradientColor2:'#ff6b35',gradientColor3:'#ffd23c'},
  goldClassic:{enabled:true,style:'double',color:'#ffd23c',thickness:10,opacity:1,glow:{enabled:true,color:'#ffd23c',size:12,inward:false,outward:true},animation:'none',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ffd23c',gradientColor2:'#ff6b35',gradientColor3:'#ffd23c'},
  goldThick:{enabled:true,style:'solid',color:'#ffd23c',thickness:14,opacity:1,glow:{enabled:true,color:'#b8860b',size:20,inward:true,outward:true},animation:'shimmer',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ffd23c',gradientColor2:'#ff6b35',gradientColor3:'#ffd23c'},
  neon:{enabled:true,style:'solid',color:'#00ffff',thickness:4,opacity:1,glow:{enabled:true,color:'#00ffff',size:25,inward:true,outward:true},animation:'shimmer',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#00ffff',gradientColor2:'#ff00ff',gradientColor3:'#00ffff'},
  neonPink:{enabled:true,style:'solid',color:'#ff00ff',thickness:5,opacity:1,glow:{enabled:true,color:'#ff00ff',size:22,inward:true,outward:true},animation:'pulse',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ff00ff',gradientColor2:'#00ffff',gradientColor3:'#ff00ff'},
  cinematic:{enabled:true,style:'solid',color:'#2a2a2a',thickness:16,opacity:0.9,glow:{enabled:false,color:'#000',size:0,inward:false,outward:false},animation:'none',vignette:{enabled:true,strength:0.4,size:25},vignetteColor:'#000000',gradientColor1:'#2a2a2a',gradientColor2:'#555',gradientColor3:'#2a2a2a'},
  stream:{enabled:true,style:'solid',color:'#9147ff',thickness:6,opacity:1,glow:{enabled:true,color:'#9147ff',size:18,inward:false,outward:true},animation:'pulse',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#9147ff',gradientColor2:'#ff6b9d',gradientColor3:'#9147ff'},
  elegant:{enabled:true,style:'ornate',color:'#c0c0c0',thickness:8,opacity:1,glow:{enabled:true,color:'#ffffff',size:8,inward:false,outward:true},animation:'none',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#c0c0c0',gradientColor2:'#ffd23c',gradientColor3:'#c0c0c0'},
  chrome:{enabled:true,style:'ridge',color:'#e0e0e0',thickness:5,opacity:1,glow:{enabled:true,color:'#ffffff',size:10,inward:true,outward:true},animation:'breathe',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#e0e0e0',gradientColor2:'#888',gradientColor3:'#e0e0e0'},
  minimal:{enabled:true,style:'solid',color:'#ffffff',thickness:2,opacity:0.6,glow:{enabled:false,color:'#fff',size:0,inward:false,outward:false},animation:'none',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ffffff',gradientColor2:'#aaa',gradientColor3:'#ffffff'},
  rainbow:{enabled:true,style:'gradient',color:'#ff0000',thickness:6,opacity:1,glow:{enabled:true,color:'#ff6b9d',size:15,inward:false,outward:true},animation:'colorShift',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ff0000',gradientColor2:'#00ff00',gradientColor3:'#0088ff'},
  sunset:{enabled:true,style:'gradient',color:'#ff6b35',thickness:8,opacity:1,glow:{enabled:true,color:'#ff6b35',size:14,inward:false,outward:true},animation:'flow',vignette:{enabled:true,strength:0.2,size:30},vignetteColor:'#1a0a2e',gradientColor1:'#ff6b35',gradientColor2:'#ffd23c',gradientColor3:'#ff2d95'},
  frost:{enabled:true,style:'inset',color:'#a8d8ea',thickness:6,opacity:0.9,glow:{enabled:true,color:'#a8d8ea',size:12,inward:true,outward:true},animation:'breathe',vignette:{enabled:true,strength:0.15,size:25},vignetteColor:'#0a1a2e',gradientColor1:'#a8d8ea',gradientColor2:'#ffffff',gradientColor3:'#a8d8ea'},
  fire:{enabled:true,style:'gradient',color:'#ff4500',thickness:8,opacity:1,glow:{enabled:true,color:'#ff4500',size:18,inward:false,outward:true},animation:'flow',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ff4500',gradientColor2:'#ffd700',gradientColor3:'#ff0000'},
  holographic:{enabled:true,style:'gradient',color:'#ff00ff',thickness:4,opacity:0.85,glow:{enabled:true,color:'#00ffff',size:16,inward:true,outward:true},animation:'rainbow',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ff00ff',gradientColor2:'#00ffff',gradientColor3:'#ffff00'},
  softWhite:{enabled:true,style:'glow',color:'#ffffff',thickness:8,opacity:0.7,glow:{enabled:true,color:'#ffffff',size:30,inward:false,outward:true},animation:'breathe',vignette:{enabled:true,strength:0.2,size:30},vignetteColor:'#1a1a1a',gradientColor1:'#ffffff',gradientColor2:'#cccccc',gradientColor3:'#ffffff'},
  retro:{enabled:true,style:'dashed',color:'#ffcc00',thickness:6,opacity:1,glow:{enabled:true,color:'#ff6600',size:8,inward:false,outward:true},animation:'flow',vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#ffcc00',gradientColor2:'#ff6600',gradientColor3:'#ffcc00'},
  cyber:{enabled:true,style:'dotted',color:'#00ff41',thickness:4,opacity:1,glow:{enabled:true,color:'#00ff41',size:20,inward:false,outward:true},animation:'shimmer',animIntensity:1.5,vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#00ff41',gradientColor2:'#0088ff',gradientColor3:'#00ff41'},
  // ─── НОВЫЕ КРЕАТИВНЫЕ ПРЕСЕТЫ ─── (мягкие свечения, выраженная анимация)
  plasma:{enabled:true,style:'glow',color:'#a3ff3a',thickness:5,opacity:1,glow:{enabled:true,color:'#a3ff3a',size:18,inward:true,outward:true},animation:'pulse',animIntensity:1.4,vignette:{enabled:false,strength:0.4,size:25},vignetteColor:'#000000',gradientColor1:'#a3ff3a',gradientColor2:'#00ffaa',gradientColor3:'#a3ff3a'},
  magma:{enabled:true,style:'gradient',color:'#ff3300',thickness:7,opacity:1,glow:{enabled:true,color:'#ff5500',size:16,inward:true,outward:true},animation:'shimmer',animIntensity:1.5,vignette:{enabled:true,strength:0.30,size:35},vignetteColor:'#1a0500',gradientColor1:'#ff0000',gradientColor2:'#ffa800',gradientColor3:'#ff3300'},
  amethyst:{enabled:true,style:'gradient',color:'#9d4edd',thickness:6,opacity:1,glow:{enabled:true,color:'#c77dff',size:14,inward:true,outward:true},animation:'breathe',animIntensity:1.2,vignette:{enabled:false,strength:0.3,size:30},vignetteColor:'#0a0014',gradientColor1:'#7b2cbf',gradientColor2:'#c77dff',gradientColor3:'#9d4edd'},
  electric:{enabled:true,style:'solid',color:'#00d4ff',thickness:4,opacity:1,glow:{enabled:true,color:'#80f0ff',size:20,inward:true,outward:true},animation:'shimmer',animIntensity:1.6,vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#00d4ff',gradientColor2:'#ffffff',gradientColor3:'#00d4ff'},
  roseGold:{enabled:true,style:'double',color:'#e8b4b8',thickness:7,opacity:1,glow:{enabled:true,color:'#f4c2c2',size:10,inward:false,outward:true},animation:'breathe',animIntensity:0.7,vignette:{enabled:true,strength:0.18,size:35},vignetteColor:'#2a1518',gradientColor1:'#e8b4b8',gradientColor2:'#d4a574',gradientColor3:'#e8b4b8'},
  aurora:{enabled:true,style:'gradient',color:'#00ff88',thickness:6,opacity:0.95,glow:{enabled:true,color:'#88ffaa',size:14,inward:true,outward:true},animation:'flow',animIntensity:1.2,vignette:{enabled:true,strength:0.18,size:30},vignetteColor:'#001020',gradientColor1:'#00ffaa',gradientColor2:'#a855f7',gradientColor3:'#00d4ff'},
  ember:{enabled:true,style:'gradient',color:'#ff6b35',thickness:7,opacity:1,glow:{enabled:true,color:'#ff8e72',size:14,inward:true,outward:true},animation:'flow',animIntensity:1.0,vignette:{enabled:true,strength:0.22,size:32},vignetteColor:'#1a0510',gradientColor1:'#ff2d95',gradientColor2:'#ffd23c',gradientColor3:'#ff6b35'},
  ocean:{enabled:true,style:'gradient',color:'#0077b6',thickness:6,opacity:1,glow:{enabled:true,color:'#48cae4',size:12,inward:true,outward:true},animation:'breathe',animIntensity:0.9,vignette:{enabled:true,strength:0.20,size:30},vignetteColor:'#000a14',gradientColor1:'#03045e',gradientColor2:'#48cae4',gradientColor3:'#0077b6'},
  vhs:{enabled:true,style:'double',color:'#ff006e',thickness:4,opacity:1,glow:{enabled:true,color:'#3a86ff',size:10,inward:true,outward:true},animation:'colorShift',animIntensity:1.3,vignette:{enabled:true,strength:0.28,size:28},vignetteColor:'#0a0a0a',gradientColor1:'#ff006e',gradientColor2:'#3a86ff',gradientColor3:'#ffbe0b'},
  emerald:{enabled:true,style:'ridge',color:'#10b981',thickness:7,opacity:1,glow:{enabled:true,color:'#34d399',size:11,inward:true,outward:true},animation:'shimmer',animIntensity:1.0,vignette:{enabled:false,strength:0.5,size:30},vignetteColor:'#000000',gradientColor1:'#10b981',gradientColor2:'#a7f3d0',gradientColor3:'#10b981'}
};

// ═══════════════════════════════════════════════════════════
//  AUDIO — delegates to SBAudio module
// ═══════════════════════════════════════════════════════════
function ensureAudioCtx(){SBAudio.ensureAudioCtx();}
function _rebuildCombinedStream(){SBAudio._rebuildCombinedStream();}
function _addCombinedStreamToWebRTC(){SBAudio._addCombinedStreamToWebRTC();}
function _sendSourceStreamsToPeers(){
  // Batch-add all local source tracks to all peers.
  // Initiator: add tracks + trigger renegotiate (sends offer).
  // Joiner: DO NOT add tracks yet — wait for initiator's offer.
  //   When offer arrives, handleSignal will call _addTracksOnOffer()
  //   which attaches our tracks to the transceivers created by the offer.
  //   This prevents transceiver mismatch (our addTrack creates transceivers
  //   that don't match the offer's m-lines, causing audio/video not to flow).
  if(!S.wrtc) return;
  _p2pLog('[P2P] _sendSourceStreamsToPeers called, peers='+S.wrtc.peers.size+' roomCode='+S.roomCode+' userJoined='+S.wrtc._userJoinedRoom);
  for(const [pid,pc] of S.wrtc.peers){
    try{
      if(pc.isInitiator){
        // Initiator: add all tracks and renegotiate
        const existingTrackIds=new Set(pc.pc.getSenders().filter(s=>s.track).map(s=>s.track.id));
        let added=0;
        for(const src of S.srcs){
          if(src.isPeer||!src.stream) continue;
          const tracks=src.stream.getTracks();
          if(!tracks.length) continue;
          for(const track of tracks){
            if(existingTrackIds.has(track.id)) continue;
            try{
              const sender=pc.pc.addTrack(track,src.stream);
              // Force transceiver direction to sendrecv if addTrack reused a
              // recvonly/inactive transceiver (created by peer's prior offer).
              try{
                const tr=pc.pc.getTransceivers().find(t=>t.sender===sender);
                if(tr && (tr.direction==='recvonly' || tr.direction==='inactive')){
                  tr.direction='sendrecv';
                  _p2pLog('[P2P] Bumped transceiver direction to sendrecv after addTrack reuse: '+track.kind);
                }
              }catch(_){}
              added++;
            }catch(e){
              _p2pLog('[P2P] WARN: addTrack failed: '+e.message);
            }
          }
          if(!S._wrtcPrevPerSource) S._wrtcPrevPerSource=new Map();
          S._wrtcPrevPerSource.set(src.id,src.stream);
        }
        pc._needsRenegotiate=true;
        pc._scheduleRenegotiate();
        _p2pLog('[P2P] Batch-added '+added+' tracks to initiator peer '+pid+', scheduled renegotiate');
      }else{
        // Joiner: do NOT add tracks via addTrack — they would create
        // mismatched transceivers. Instead, stash our streams and let
        // handleSignal add them after setRemoteDescription(offer).
        pc._pendingLocalStreams=[];
        for(const src of S.srcs){
          if(src.isPeer||!src.stream) continue;
          pc._pendingLocalStreams.push(src.stream);
          if(!S._wrtcPrevPerSource) S._wrtcPrevPerSource=new Map();
          S._wrtcPrevPerSource.set(src.id,src.stream);
        }
        _p2pLog('[P2P] Joiner: stashed '+pc._pendingLocalStreams.length+' streams, waiting for offer');
        // Fallback: if no offer arrives in 5s (reconnect scenario),
        // add tracks and renegotiate ourselves
        if(pc._joinRenegotiateTimer) clearTimeout(pc._joinRenegotiateTimer);
        pc._joinRenegotiateTimer=setTimeout(()=>{
          if(pc.pc.signalingState==='stable' && pc._pendingLocalStreams){
            _p2pLog('[P2P] Joiner fallback: no offer in 5s, adding tracks ourselves for peer '+pid);
            const existing=new Set(pc.pc.getSenders().filter(s=>s.track).map(s=>s.track.id));
            for(const stream of pc._pendingLocalStreams){
              for(const track of stream.getTracks()){
                if(!existing.has(track.id)){
                  try{
                    const sender=pc.pc.addTrack(track,stream);
                    try{
                      const tr=pc.pc.getTransceivers().find(t=>t.sender===sender);
                      if(tr && (tr.direction==='recvonly' || tr.direction==='inactive')){
                        tr.direction='sendrecv';
                      }
                    }catch(_){}
                  }catch(e){}
                }
              }
            }
            pc._pendingLocalStreams=null;
            pc._needsRenegotiate=true;
            pc._scheduleRenegotiate();
          }
        },5000);
      }
    }catch(e){ _p2pLog('[P2P] WARN: batch addTracks failed for '+pid+': '+e.message); }
  }
}

function _addSourceToPeers(src){
  // Add a single local source's tracks to all connected peers and renegotiate.
  // Used when a source is added DURING an active P2P session.
  // For initial connection, _sendSourceStreamsToPeers() does a batch add instead.
  if(!S.wrtc||!src||!src.stream) return;
  const tracks=src.stream.getTracks();
  if(!tracks.length) return;
  for(const [pid,pc] of S.wrtc.peers){
    try{
      if(!pc.isInitiator && pc._pendingLocalStreams){
        // Joiner hasn't received offer yet — stash stream
        pc._pendingLocalStreams.push(src.stream);
        _p2pLog('[P2P] Joiner: stashed additional source '+src.name+' for later');
      }else{
        const existingTrackIds=new Set(pc.pc.getSenders().filter(s=>s.track).map(s=>s.track.id));
        let added=0;
        for(const track of tracks){
          if(existingTrackIds.has(track.id)) continue;
          try{
            const sender=pc.pc.addTrack(track,src.stream);
            // Force transceiver direction to sendrecv. addTrack might reuse a
            // transceiver previously set to recvonly during a prior answer (e.g.,
            // when peer's renegotiate offered an m-line we had no track for).
            // Without this, our track is silently dropped despite having a sender.
            try{
              const tr=pc.pc.getTransceivers().find(t=>t.sender===sender);
              if(tr && (tr.direction==='recvonly' || tr.direction==='inactive')){
                tr.direction='sendrecv';
                _p2pLog('[P2P] Bumped transceiver direction to sendrecv after addTrack reuse: '+track.kind);
              }
            }catch(_){}
            added++;
          }catch(_){}
        }
        if(added>0){
          pc._needsRenegotiate=true;
          pc._scheduleRenegotiate();
        }
      }
    }catch(e){ _p2pLog('[P2P] WARN: addSourceToPeers failed for '+pid+': '+e.message); }
  }
  _p2pLog('[P2P] Added source to peers: '+src.name+' '+src.type);
}
function _removeSourceTracksFromPeers(src){
  // Remove a local source's tracks from all WebRTC PeerConnections
  if(!S.wrtc||!src||!src.stream) return;
  const trackIds=new Set(src.stream.getTracks().map(t=>t.id));
  if(!trackIds.size) return;
  for(const [pid,pc] of S.wrtc.peers){
    try{
      const senders=pc.pc.getSenders();
      let removed=0;
      for(const sender of senders){
        if(sender.track&&trackIds.has(sender.track.id)){
          try{ pc.pc.removeTrack(sender); removed++; }catch(_){}
        }
      }
      if(removed>0){
        pc._needsRenegotiate=true;
        pc._scheduleRenegotiate();
      }
    }catch(e){ _p2pLog('[P2P] WARN: removeTrack failed for '+pid+': '+e.message); }
  }
  // Remove from localStreams tracking
  S.wrtc.removeLocalStream(src.stream);
  if(S._wrtcPrevPerSource) S._wrtcPrevPerSource.delete(src.id);
  _p2pLog('[P2P] Removed source tracks from peers: '+src.name+' '+src.type);
}
async function _connectSource(src){return SBAudio._connectSource(src);}
function _disconnectSource(srcId){SBAudio._disconnectSource(srcId);}
function _updateGain(src){SBAudio._updateGain(src);}
function _resumeAudioCtx(){SBAudio._resumeAudioCtx();}
function _applyFxState(srcId){SBAudio._applyFxState(srcId);}
function _loadFxStateForName(name){return SBAudio._loadFxStateForName(name);}
function _hasFx(srcId){return SBAudio._hasFx(srcId);}
function _dbToLinear(db){return SBAudio._dbToLinear(db);}
function _toDb(avgByte){return SBAudio._toDb(avgByte);}
function _muteAppSounds(){SBAudio._muteAppSounds();}
function _unmuteAppSounds(){SBAudio._unmuteAppSounds();}
function updateLevels(){SBAudio.updateLevels();}
function _ensureLevelsLoop(){SBAudio._ensureLevelsLoop();}

// ═══════════════════════════════════════════════════════════
//  TRANSFORM MATH (unchanged)
// ═══════════════════════════════════════════════════════════
// ─── DIRTY-FLAG & CACHED LOOKUPS ────────────────────────────
// ─── Scene delegates (→ SBScene module) ───
// All scene/rendering logic lives in renderer/js/scene.js (window.SBScene).
// Local wrappers keep existing call-sites working.
function _markDirty(){SBScene.markDirty();}
function _getSortedItems(){return SBScene.getSortedItems();}
function _getSrcById(id){return SBScene.getSrcById(id);}

function rotMat(deg){return SBScene.rotMat(deg);}
function localToWorld(it,lx,ly){return SBScene.localToWorld(it,lx,ly);}
function worldToLocal(it,wx,wy){return SBScene.worldToLocal(it,wx,wy);}
function localHandles(it){return SBScene.localHandles(it);}
function opposite(hid,w,h){return SBScene.opposite(hid,w,h);}
function _enforceCircle(it){SBScene.enforceCircle(it);}
function _snapCircle(it){SBScene.snapCircle(it);}
const CIRCLE_PAN_ZOOM=SBScene.CIRCLE_PAN_ZOOM;

function hitHandle(mx,my,it){return SBScene.hitHandle(mx,my,it);}
function hitItem(mx,my,it){return SBScene.hitItem(mx,my,it);}
function cursorFor(hid){return SBScene.cursorFor(hid);}
function toCanvas(cv,e){return SBScene.toCanvas(cv,e);}

// ─── Undo delegates ───
function _pushUndo(label){SBScene.pushUndo(label);}
function _undo(){
  const result=SBScene.undo(msg);
  if(!result)return;
  if(result.type==='delete-source'&&result.restore){
    _undoRestoreSource(result.restore);
    msg('Отменено: «'+result.restore.srcName+'» восстановлен','info');
  }else{
    msg('Отменено'+(result.label?': '+result.label:''),'info');
  }
}

async function _undoRestoreSource(r){
  // Re-acquire the stream for the deleted source
  if(r.srcIsPeer){
    // Peer sources can't be re-created locally — they need the friend to re-add them
    msg('Невозможно восстановить источник друга — подключитесь заново','info');
    return;
  }
  try{
    let stream=null;
    if(r.srcType==='camera'){
      const constraints={video:true};
      if(r.deviceId) constraints.video={deviceId:{exact:r.deviceId}};
      stream=await navigator.mediaDevices.getUserMedia(constraints);
    }else if(r.srcType==='screen'||r.srcType==='window'){
      // Screen/window captures require user interaction — show message
      msg('Для восстановления экрана/окна добавьте его заново','info');
      return;
    }else if(r.srcType==='mic'){
      const constraints={audio:true};
      if(r.audioDeviceId) constraints.audio={deviceId:{exact:r.audioDeviceId}};
      stream=await navigator.mediaDevices.getUserMedia(constraints);
    }
    if(!stream){msg('Не удалось восстановить источник','info');return;}
    // Determine if video or audio source
    const hasVideo=stream.getVideoTracks().length>0;
    const hasAudio=stream.getAudioTracks().length>0;
    let newId;
    if(hasVideo){
      newId=addVideoSource(r.srcType,r.srcName,stream);
    }else if(hasAudio){
      newId=addAudioSource(r.srcType,r.srcName,stream);
    }
    if(!newId){msg('Не удалось восстановить источник','info');return;}
    // Restore saved item layout if available
    if(r.item){
      const it=S.items.find(x=>x.sid===newId);
      if(it){
        Object.assign(it,{
          cx:r.item.cx,cy:r.item.cy,w:r.item.w,h:r.item.h,z:r.item.z,
          rot:r.item.rot,flipH:r.item.flipH,flipV:r.item.flipV,
          crop:{...r.item.crop},cropMask:r.item.cropMask,
          frameSettings:r.item.frameSettings?JSON.parse(JSON.stringify(r.item.frameSettings)):it.frameSettings,
          uncropW:r.item.uncropW,uncropH:r.item.uncropH,uncropCx:r.item.uncropCx,uncropCy:r.item.uncropCy,
          panDx:r.item.panDx,panDy:r.item.panDy,
        });
      }
    }
    // Restore volume/mute/visible/locked
    const s=S.srcs.find(x=>x.id===newId);
    if(s){
      if(r.srcVol!==undefined) s.vol=r.srcVol;
      if(r.srcMuted!==undefined) s.muted=r.srcMuted;
      if(r.srcVisible!==undefined) s.visible=r.srcVisible;
      if(r.srcLocked!==undefined) s.locked=r.srcLocked;
    }
    rebuildZ();renderSources();renderMixer();updateE();
    // Co-session: broadcast the restored source + item
    if(S.co&&!_isRemote()){
      S.co.broadcastSourceAdd(s);
      const it=S.items.find(x=>x.sid===newId);
      if(it){ S.co.queueItemUpsert(it); S.co.flushAllItems(); }
    }
  }catch(e){
    if(window.__sbDev) console.warn('[Undo] Failed to restore source:',e);
    msg('Не удалось восстановить источник: '+e.message,'info');
  }
}
// (_snapCircle, hitHandle, hitItem, cursorFor, toCanvas are delegates to SBScene — defined above)

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
async function init(){
  if(window.__sbDev) console.log('[Init] StreamBro v12 starting...');
  SBScene.init(S, D);
  SBAudio.init(S, D, {_gateWorkletLoaded, _rnnoiseWorkletLoaded, _newSid, _coSafe, _wireTrackEndHandlers, renderMixer, updateE, msg, _scheduleSettingsSave, _coBroadcastSrcUpdateDebounced, _showFxModal});
  SBSources.init(S);
  SBUi.init(S, D);
  SBScene.injectSvgFilters();
  Object.keys({
    sceneCanvas:1,sceneOverlay:1,scenePreview:1,sceneEmpty:1,sourcesList:1,audioMixer:1,
    btnConnectFriend:1,btnAddSource:1,btnMixerAdd:1,mixerAddDropdown:1,
    btnStartStream:1,btnPauseStream:1,btnStopStream:1,
    btnStartRec:1,btnPauseRec:1,btnStopRec:1,
    streamUptime:1,recTimer:1,
    streamPlatform:1,streamKey:1,streamBitrateInput:1,streamResolution:1,
    btnToggleKeyVisibility:1,customServerGroup:1,customServer:1,
    roomStatus:1,connectModal:1,btnCloseConnectModal:1,
    btnCreateRoom:1,btnJoinRoom:1,joinRoomCode:1,signalingServer:1,
    turnServerUrl:1,turnServerUser:1,turnServerPass:1,
    roomCodeDisplay:1,roomCode:1,btnCopyCode:1,connectError:1,
    connectedPeersCreate:1,connectedPeersJoin:1,
    myRoomsList:1,btnLeaveRoomTop:1,
    roomNameInput:1,btnPasteCode:1,
    addSourceModal:1,btnCloseSourceModal:1,
    addMicModal:1,btnCloseMicModal:1,micSelect:1,btnConfirmMic:1,
    renameModal:1,btnCloseRenameModal:1,renameInput:1,btnConfirmRename:1,
    deviceSelector:1,deviceSelectorLabel:1,deviceSelect:1,
    btnConfirmSource:1,notifications:1,
    btnOpenSettings:1,settingsModal:1,btnCloseSettingsModal:1,
    btnOpenHelp:1,helpModal:1,btnCloseHelpModal:1,
    settingsFps:1,settingsReducedMotion:1,settingsShowGrid:1,settingsShowSafeArea:1,
    settingsAppMeta:1,themeGrid:1,
    streamStatusPill:1,streamStatusDot:1,streamStatusText:1,
  }).forEach(k=>D[k]=$(k));

  // Detect dev mode (renderer side) — used for verbose logging
  try{
    const packaged=await window.electronAPI.isPackaged();
    window.__sbDev=!packaged;
  }catch(e){window.__sbDev=true;}

  // Load persisted settings
  await _loadSettings();
  _applyTheme();
  // Onboarding tour — show on first launch (unless user checked "never show")
  if (!S.settings.onboardingComplete && !S.settings.onboardingNeverShow) {
    _startOnboarding();
  }

  bind();
  // WebGL2 renderer — experimental, disabled by default until fully polished.
  // Users can enable via settings → Performance → "GPU Rendering".
  S._useGL = false;
  if (S.settings && S.settings.ui && S.settings.ui.gpuRendering && window.GLRenderer) {
    if (GLRenderer.init(D.sceneCanvas)) {
      S._useGL = true;
      S.gl = GLRenderer;
      if (window.__sbDev) console.log('[Init] Using WebGL2 renderer (experimental)');
    } else {
      if (window.__sbDev) console.log('[Init] WebGL2 init failed, falling back to Canvas 2D');
    }
  }
  if (!S._useGL) {
    S.ctx = D.sceneCanvas.getContext('2d');
    if(S.ctx){S.ctx.imageSmoothingEnabled=true;S.ctx.imageSmoothingQuality='high';}
    if (window.__sbDev) console.log('[Init] Using Canvas 2D renderer');
  }
  // Overlay canvas for UI (handles, grid, safe-areas) — always 2D
  if (D.sceneOverlay) {
    S.overlayCtx = D.sceneOverlay.getContext('2d');
    D.sceneOverlay.width = S.cw;
    D.sceneOverlay.height = S.ch;
  }
  initRTMP(); setupScene(); loop(); _syncOverlaySize();
  _initScenePresets();
  _initHints();
  try{window.electronAPI.startSignalingServer();}catch(e){}
  // Listen for FFmpeg rec stop event
  try{window.electronAPI.onFFmpegRecStopped(data=>{
    if(window.__sbDev) console.log('[Rec] FFmpeg finished:',data);
    if(S.rtmp&&S.rtmp.onRecStop) S.rtmp.onRecStop(data.path||'Видео/StreamBro_...mp4');
  });}catch(e){}
  // Listen for Presence WS signal relay (WebRTC)
  try{window.electronAPI.onPresenceSignal(data=>{
    _p2pLog('[P2P] Presence signal received: '+data.type+' '+data.signal?.type+' from='+data.fromPeerId);
    if(S.wrtc&&S.wrtc.handlePresenceSignal) S.wrtc.handlePresenceSignal(data);
  });}catch(e){}
  // Handle Presence WS reconnect — rejoin P2P room if we were in one
  try{window.electronAPI.onPresenceReconnect(()=>{
    if(window.__sbDev) console.log('[Presence] Reconnected — checking P2P room');
    if(S.roomCode&&S.wrtc){
      // Clean up old PeerConnections (they're dead after network interruption)
      for(const [pid,pc] of S.wrtc.peers){
        try{pc.close();}catch(_){}
      }
      S.wrtc.peers.clear();
      // Clean up peer sources
      S.srcs=S.srcs.filter(s=>{
        if(s.isPeer){if(s.stream)s.stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});_disconnectSource(s.id);return false;}
        return true;
      });
      S.items=S.items.filter(x=>S.srcs.some(s=>s.id===x.sid));
      if(S.co){S.co=null;}
      S._handledPeerStreams.clear();
      // Re-join the room via server API, then create PeerConnections
      S.wrtc._userJoinedRoom=true;
      S.wrtc.setSignalingChannel((signalMsg)=>{
        window.electronAPI.presenceSend(JSON.stringify(signalMsg));
      });
      window.electronAPI.roomsJoin(S.roomCode).then(r=>{
        if(!r||!r.ok){
          _p2pLog('[P2P] WARN: Rejoin failed after reconnect: '+(r?.error||'unknown'));
          _hideActiveRoom();
          uRS('offline','Не подключён');
        }else{
          _p2pLog('[P2P] Rejoined room after reconnect');
          const roomData=r.data||{};
          const peerIds=roomData.members?roomData.members.filter(m=>m.userId!==S.wrtc.myPeerId).map(m=>m.userId):[];
          for(const pid of peerIds){S.wrtc._createPeerConnection(pid,true);}
          ensureAudioCtx();_rebuildCombinedStream();
          _sendSourceStreamsToPeers();
          if(S.wrtc.onRoomJoined)S.wrtc.onRoomJoined(S.roomCode,S.wrtc.myPeerId,peerIds);
        }
      }).catch(e=>{
        _p2pLog('[P2P] WARN: Rejoin error after reconnect: '+e.message);
        _hideActiveRoom();
        uRS('offline','Не подключён');
      });
      renderSources();renderMixer();updateE();
    }
  });}catch(e){}
  // Listen for room events (peer-joined, peer-left, invite) via Presence WS
  try{window.electronAPI.onStreamNotification(data=>{
    if(!data) return;
    if(data.type==='room-event'&&data.event==='peer-joined'&&S.wrtc){
      // Only create PC if we're actually in a room (prevent stale presence reconnects)
      if(!S.roomCode) return;
      const pid=data.fromUserId;
      if(pid&&pid!==S.wrtc.myPeerId){
        if(!S.wrtc.peers.has(pid)){
          // Room creator creates PC as joiner (isInitiator=false) — the new
          // participant (who called joinRoom) is the initiator and will send offer.
          S.wrtc._createPeerConnection(pid,false);
          _sendSourceStreamsToPeers();
        }
        if(S.co) S.co.setMyPeerId(S.myPeerId);
        msg('Друг подключился к комнате!','success');
      }
    }
  });}catch(e){}
  // Show permanent desktop audio fader
  _showDesktopAudioFader();
  // Auto-start WASAPI native capture
  _startWasapiCapture();

  // ─── 1.1.0 — sounds, profile, friends, updates wiring ───
  _initSoundSystem();
  _initProfileAndFriends();
  _initSettingsTabs();
  _initSoundSettingsPane();
  _initUpdatesPane();
  _initBugCapture();
  _initNetworkMonitor();
  _initSidebarResize();
  _initBottomResize();
}

// ═══════════════════════════════════════════════════════════
//  RNNOISE AI DENOISING — WebAssembly loader
// ═══════════════════════════════════════════════════════════
async function _loadRNNoise() {
  if (S._rnnoiseWasm) return S._rnnoiseWasm;
  try {
    const resp = await fetch('./js/rnnoise.wasm');
    if (!resp.ok) throw new Error('rnnoise.wasm not found (place it in renderer/js/)');
    const buf = await resp.arrayBuffer();
    const result = await WebAssembly.instantiate(buf, {
      env: { memory: new WebAssembly.Memory({ initial: 256 }) }
    });
    S._rnnoiseWasm = result.instance.exports;
    S._rnnoiseWasmLoaded = true;
    if (window.__sbDev) console.log('[RNNoise] WASM loaded');
    return S._rnnoiseWasm;
  } catch (e) {
    if (window.__sbDev) console.warn('[RNNoise] WASM load failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  ONBOARDING TOUR — interactive spotlight guide, shown once
// ═══════════════════════════════════════════════════════════
function _startOnboarding() {
  const overlay = document.getElementById('onboardingOverlay');
  const tooltip = document.getElementById('obTooltip');
  const arrow   = document.getElementById('obArrow');
  const stepNum = document.getElementById('obStepNum');
  const title   = document.getElementById('obTitle');
  const desc    = document.getElementById('obDesc');
  const nextBtn = document.getElementById('obNext');
  const skipBtn = document.getElementById('obSkip');
  const neverCb = document.getElementById('obNeverCb');
  if (!overlay || !tooltip) return;

  const ARROW_H = 12;
  const SPOT_PAD = 10;
  // One backdrop div with clip-path polygon: cuts a rectangular hole
  // around the target element. Has backdrop-filter:blur + dark tint.
  // The target element is never modified (no z-index hacks) — it simply
  // shows through the clip-path hole, crisp and unblurred.
  // No stacking-context issues. Tooltip has CSS transition for smooth slide.

  const steps = [
    {
      target: null,
      title: 'Добро пожаловать в StreamBro!',
      desc: 'Простой стриминг и запись для Windows.\nПройдём быстрый тур — за пару кликов.',
    },
    {
      target: '#btnAddSource',
      title: 'Добавь источник',
      desc: 'Нажми сюда, чтобы добавить камеру, экран или окно на сцену.\nПеретаскивай и изменяй размер прямо на холсте.',
    },
    {
      target: '#accPlatforms',
      title: 'Платформы и ключ стрима',
      desc: 'Здесь выбираешь Twitch, Kick или YouTube и вставляешь ключ стрима.\nЗатем нажимаешь «Стрим» ниже — и ты в эфире!',
    },
    {
      target: '#btnMixerAdd',
      title: 'Микшер звука',
      desc: 'Нажми + чтобы добавить микрофон.\nКнопка FX — шумодав, эквалайзер, компрессор.',
    },
    {
      target: '#accFriends',
      title: 'Друзья и поддержка',
      desc: 'Здесь твои друзья и чат.\nНапиши «StreamBro Поддержка» — AI-бот ответит на любые вопросы о приложении!',
    },
    {
      target: '#btnOpenSettings',
      title: 'Настройки',
      desc: 'Темы, производительность, друзья, профиль — всё здесь.',
    },
  ];

  let step = 0;
  let backdrop = null;
  let _rafId = null;

  function _ensureBackdrop() {
    if (backdrop) return;
    backdrop = document.createElement('div');
    backdrop.id = 'obBackdrop';
    overlay.insertBefore(backdrop, overlay.firstChild);
  }

  function _setClip(rect) {
    if (!backdrop) return;
    const p = SPOT_PAD;
    const x = rect.left - p;
    const y = rect.top - p;
    const r = rect.right + p;
    const b = rect.bottom + p;
    // Outer rect clockwise → move to inner → inner rect clockwise → even-odd fills outside
    backdrop.style.clipPath =
      'polygon(0% 0%,100% 0%,100% 100%,0% 100%,0% 0%,' +
      x + 'px ' + y + 'px,' +
      x + 'px ' + b + 'px,' +
      r + 'px ' + b + 'px,' +
      r + 'px ' + y + 'px,' +
      x + 'px ' + y + 'px)';
  }

  function _clearClip() {
    if (backdrop) backdrop.style.clipPath = 'none';
  }

  function _positionTooltip(target) {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }

    if (!target) {
      // Centered welcome — no hole, full backdrop
      _ensureBackdrop();
      _clearClip();
      backdrop.style.display = 'block';
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      arrow.style.display = 'none';
      return;
    }

    tooltip.style.transform = 'none';
    arrow.style.display = 'block';

    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) { _positionTooltip(null); return; }

    // Open accordion if target is inside a closed one
    const accItem = el.closest('.accordion-item');
    if (accItem && !accItem.classList.contains('open')) {
      accItem.classList.add('open');
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });

    // Wait two frames for layout to settle after scroll + accordion
    _rafId = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        _rafId = null;
        const r = el.getBoundingClientRect();
        _ensureBackdrop();
        backdrop.style.display = 'block';
        _setClip(r);

        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const gap = 14;

        const spaceBelow = vh - r.bottom;
        const spaceAbove = r.top;
        const placeBelow = spaceBelow >= th + gap + ARROW_H || spaceBelow > spaceAbove;

        let top, left;
        if (placeBelow) {
          top = r.bottom + SPOT_PAD + gap;
        } else {
          top = r.top - SPOT_PAD - gap - th;
        }
        left = r.left + (r.width / 2) - (tw / 2);
        left = Math.max(12, Math.min(left, vw - tw - 12));

        tooltip.style.top = top + 'px';
        tooltip.style.left = left + 'px';

        // Arrow
        const arrowLeft = r.left + (r.width / 2) - left;
        const clampedArrowLeft = Math.max(16, Math.min(arrowLeft, tw - 16));
        if (placeBelow) {
          arrow.style.top = -ARROW_H + 'px';
          arrow.style.bottom = '';
          arrow.style.left = clampedArrowLeft + 'px';
          arrow.className = 'ob-arrow-down';
        } else {
          arrow.style.bottom = -ARROW_H + 'px';
          arrow.style.top = '';
          arrow.style.left = clampedArrowLeft + 'px';
          arrow.className = 'ob-arrow-up';
        }
      });
    });
  }

  function renderStep() {
    const s = steps[step];
    stepNum.textContent = (step + 1) + ' / ' + steps.length;
    title.textContent = s.title;
    desc.textContent = s.desc;
    nextBtn.textContent = step === steps.length - 1 ? 'Готово!' : 'Далее →';
    _positionTooltip(s.target);
  }

  function finish() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (backdrop) backdrop.style.display = 'none';
    overlay.style.display = 'none';
    S.settings.onboardingComplete = true;
    if (neverCb && neverCb.checked) S.settings.onboardingNeverShow = true;
    _scheduleSettingsSave();
  }

  nextBtn.onclick = () => {
    if (step < steps.length - 1) { step++; renderStep(); }
    else finish();
  };
  skipBtn.onclick = finish;

  overlay.style.display = 'block';
  tooltip.style.display = 'block';
  if(neverCb) neverCb.checked = false;
  renderStep();
}

// ═══════════════════════════════════════════════════════════
//  PERSISTENT SETTINGS (loaded once, debounced save)
// ═══════════════════════════════════════════════════════════
async function _loadSettings(){
  try{
    const s=await window.electronAPI.settingsLoad();
    S.settings=s;
    S.targetFps=30;  // Preview always 30fps — saves CPU/GPU, output uses _captureFps
    S._captureFps=Math.max(15,Math.min(120,s.ui.targetFps||60));  // FPS for captureStream (recording/streaming)
    S._userFps=S._captureFps;
    S.reducedMotion=!!s.ui.reducedMotion;
    S.showGrid=!!s.ui.showGrid;
    S.showSafeAreas=!!s.ui.showSafeAreas;
    // Apply to UI inputs
    if(D.streamPlatform&&s.stream.platform) D.streamPlatform.value=s.stream.platform;
    if(D.streamResolution&&s.stream.resolution) D.streamResolution.value=s.stream.resolution;
    if(D.streamBitrateInput&&s.stream.bitrate) D.streamBitrateInput.value=String(s.stream.bitrate);
    if(D.customServer&&s.stream.customServer) D.customServer.value=s.stream.customServer;
    if(D.customServerGroup) D.customServerGroup.style.display=s.stream.platform==='custom'?'flex':'none';
    if(D.streamKey&&typeof s.stream.key==='string') D.streamKey.value=s.stream.key;
    if(D.signalingServer&&s.signaling&&s.signaling.server) D.signalingServer.value=s.signaling.server;
    if(D.turnServerUrl  &&s.signaling&&s.signaling.turnUrl)  D.turnServerUrl.value  =s.signaling.turnUrl;
    if(D.turnServerUser &&s.signaling&&s.signaling.turnUser) D.turnServerUser.value =s.signaling.turnUser;
    if(D.turnServerPass &&s.signaling&&s.signaling.turnPass) D.turnServerPass.value =s.signaling.turnPass;
    // Apply scene resolution
    if(s.stream.resolution){
      const m=s.stream.resolution.match(/^(\d+)x(\d+)$/);
      if(m){S.cw=parseInt(m[1]);S.ch=parseInt(m[2]);if(D.sceneCanvas){D.sceneCanvas.width=S.cw;D.sceneCanvas.height=S.ch;}if(D.sceneOverlay){D.sceneOverlay.width=S.cw;D.sceneOverlay.height=S.ch;}if(S._useGL&&S.gl)S.gl.resize(S.cw,S.ch);}
    }
  }catch(e){
    if(window.__sbDev) console.warn('[Settings] Load failed:',e.message);
    S.settings={ui:{theme:'dark',targetFps:60,reducedMotion:false,showGrid:false,showSafeAreas:false},stream:{platform:'twitch',customServer:'',resolution:'1280x720',bitrate:6000,fps:30,key:''},audio:{},recording:{},signaling:{server:'wss://streambro.ru/signaling',turnUrl:'',turnUser:'',turnPass:''},fxStateByName:{}};
  }
}

function _scheduleSettingsSave(){SBUi.scheduleSettingsSave(_persistSettings);}

async function _persistSettings(extra){
  if(!S.settings) return;
  // Build payload from current UI state
  const payload={
    ui:{
      theme:(S.settings.ui&&S.settings.ui.theme)||'dark',
      targetFps:S.targetFps,
      reducedMotion:S.reducedMotion,
      showGrid:S.showGrid,
      showSafeAreas:S.showSafeAreas,
    },
    stream:{
      platform:D.streamPlatform?D.streamPlatform.value:'twitch',
      customServer:D.customServer?D.customServer.value.trim():'',
      resolution:D.streamResolution?D.streamResolution.value:'1280x720',
      bitrate:D.streamBitrateInput?(parseInt(D.streamBitrateInput.value)||6000):6000,
      fps:30,
      key:D.streamKey?D.streamKey.value:'',
    },
    signaling:{
      server:D.signalingServer?D.signalingServer.value.trim()||'wss://streambro.ru/signaling':'wss://streambro.ru/signaling',
      turnUrl :D.turnServerUrl ?D.turnServerUrl.value.trim():'',
      turnUser:D.turnServerUser?D.turnServerUser.value.trim():'',
      turnPass:D.turnServerPass?D.turnServerPass.value.trim():'',
    },
    onboardingComplete: !!S.settings.onboardingComplete,
    onboardingNeverShow: !!S.settings.onboardingNeverShow,
    // 1.1.0 — preserve sound + updates blocks (mutated in place by their UI panes)
    ...(S.settings&&S.settings.sound?{sound:S.settings.sound}:{}),
    ...(S.settings&&S.settings.updates?{updates:S.settings.updates}:{}),
    ...(S.settings&&S.settings.friends?{friends:S.settings.friends}:{}),
    ...(S.settings&&S.settings.camSettingsByName?{camSettingsByName:S.settings.camSettingsByName}:{}),
    ...(S.settings&&S.settings.collapsedSections?{collapsedSections:S.settings.collapsedSections}:{}),
    ...(S.settings&&S.settings.scenePresets?{scenePresets:S.settings.scenePresets}:{}),
    // P2P room — save roomCode for auto-rejoin after restart
    p2p:{
      roomCode:S.roomCode||null,
    },
    ...(extra||{}),
  };
  if(window.__sbDev) console.log('[persistSettings] scenePresets count:',(payload.scenePresets||[]).length);
  try{await window.electronAPI.settingsSave(payload);}catch(e){if(window.__sbDev) console.warn('[Settings] Save failed:',e.message);}
}

function _applyTheme(){SBUi.applyTheme();}
function _readVar(name){return SBUi.readVar(name);}
function _themeAccentCache(){return SBUi.themeAccentCache();}
function _themeHandleStrokeCache(){return SBUi.themeHandleStrokeCache();}
function esc(s){return SBUi.esc(s);}

async function _autoEnumDevices(){
  try{
    const ds=await navigator.mediaDevices.enumerateDevices();
    const ai=ds.filter(d=>d.kind==='audioinput');
    const ao=ds.filter(d=>d.kind==='audiooutput');
    console.log('[Init] Audio inputs: '+ai.length+', Audio outputs: '+ao.length);
    ai.forEach((d,i)=>console.log('[Init]   IN ['+i+'] '+d.label));
  }catch(e){console.log('[Init] Enum error: '+e.message);}
}

// ═══════════════════════════════════════════════════════════
//  WASAPI NATIVE DESKTOP AUDIO — no dialog needed!
// ═══════════════════════════════════════════════════════════
let _wasapiWorkletNode=null;
let _wasapiCtx=null;
let _wasapiCapturing=false;
let _wasapiListenersSetup=false;

async function _startWasapiCapture(){
  try{
    console.log('[WASAPI] Starting native desktop audio capture...');
    const devices=await window.electronAPI.wasapiGetOutputDevices();
    console.log('[WASAPI] Output devices:', devices.length);
    const defDev=devices.find(d=>d.isDefault);
    if(!defDev){console.log('[WASAPI] No default output device');_updateDesktopFader(false);return;}

    const fmt=await window.electronAPI.wasapiGetDeviceFormat({deviceId:defDev.id});
    console.log('[WASAPI] Device format:', JSON.stringify(fmt));

    const result=await window.electronAPI.wasapiStartCapture({deviceId:defDev.id});
    if(!result.success){console.log('[WASAPI] Start failed:', result.error);_updateDesktopFader(false);return;}

    _wasapiCapturing=true;
    _setupWasapiPipeline(result.format);

  }catch(e){
    console.error('[WASAPI] Init error:', e);
    msg('WASAPI ошибка: '+e.message,'error');
    _updateDesktopFader(false);
  }
}

// Register IPC listeners once — they forward data to whatever workletNode is current
function _ensureWasapiListeners(){
  if(_wasapiListenersSetup) return;
  _wasapiListenersSetup=true;

  window.electronAPI.onWasapiAudioData((data)=>{
    if(!_wasapiWorkletNode) return;
    const arrBuf=new Uint8Array(data.buffer||data).buffer;
    const int16=new Int16Array(arrBuf, data.byteOffset||0, (data.byteLength||arrBuf.byteLength)/2);
    const float32=new Float32Array(int16.length);
    for(let i=0;i<int16.length;i++) float32[i]=int16[i]/32768;
    _wasapiWorkletNode.port.postMessage({pcm:float32, channels:_wasapiWorkletNode._wasapiCh||2});
  });

  window.electronAPI.onWasapiError((err)=>{
    console.error('[WASAPI] Error:', err);
    msg('Ошибка захвата звука: '+err,'error');
    _updateDesktopFader(false);
  });

  window.electronAPI.onWasapiDeviceChanged((data)=>{
    console.log('[WASAPI] Device changed event, new format:', JSON.stringify(data.format));
    msg('Аудиоустройство переключено автоматически','info');
    _onWasapiDeviceChanged(data);
  });
}

async function _setupWasapiPipeline(fmt){
  const sr=fmt?.sampleRate||48000;
  const ch=fmt?.channels||2;

  // Ensure IPC listeners are registered (only once)
  _ensureWasapiListeners();

  // Close old AudioContext if sample rate changed
  if(_wasapiCtx){
    if(_wasapiCtx.sampleRate!==sr){
      console.log('[WASAPI] Sample rate changed '+_wasapiCtx.sampleRate+'→'+sr+', recreating context');
      try{_wasapiCtx.close();}catch(e){}
      _wasapiCtx=null;
      _wasapiWorkletNode=null;
    }
  }

  // Remove old desktop source if exists (use rmSrc to properly clean up WebRTC tracks + CoScene)
  if(S.desktopAudioId){
    try{ rmSrc(S.desktopAudioId,{fromRecreate:true}); }catch(e){}
    S.desktopAudioId=null;
  }

  // Create AudioContext + AudioWorklet for off-thread PCM → MediaStream
  if(!_wasapiCtx||_wasapiCtx.state==='closed'){
    _wasapiCtx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:sr});
  }

  const workletUrl=new URL('js/wasapi-worklet.js',location.href).href;
  // addModule is idempotent for the same URL
  await _wasapiCtx.audioWorklet.addModule(workletUrl);

  const workletNode=new AudioWorkletNode(_wasapiCtx,'wasapi-processor',{outputChannelCount:[ch]});
  workletNode._wasapiCh=ch; // store channel count for the IPC listener
  const wasapiDest=_wasapiCtx.createMediaStreamDestination();
  workletNode.connect(wasapiDest);
  _wasapiWorkletNode=workletNode;

  console.log('[WASAPI] Pipeline ready: WASAPI PCM → AudioWorklet → MediaStream ('+sr+'Hz, '+ch+'ch)');

  // Feed the WASAPI MediaStream into the main audio pipeline
  const audioStream=wasapiDest.stream;

  ensureAudioCtx();
  _resumeAudioCtx();

  const id=_newSid();
  S.desktopAudioId=id;
  // Use addAudioSource to properly wire P2P streaming, CoScene broadcast, and audio chain
  // (was previously pushed directly to S.srcs which skipped WebRTC addTrack + CoScene src.add)
  const wasapiSrc=addAudioSource('desktop','Звук рабочего стола',audioStream,false,null,{gid:id,msid:audioStream.id});
  // Override the desktopAudioId with the actual id returned by addAudioSource
  S.desktopAudioId=wasapiSrc||id;
  // WASAPI activation may change peer mic monitor routing (feedback prevention)
  SBAudio._updatePeerMonitorRouting();
  console.log('[WASAPI] Desktop audio source added, id='+S.desktopAudioId);
  msg('Звук рабочего стола подключён (WASAPI)','success');
}

async function _onWasapiDeviceChanged(data){
  if(!_wasapiCapturing) return;
  console.log('[WASAPI] Rebuilding pipeline for new device...');
  _setupWasapiPipeline(data.format);
}

function _showDesktopAudioFader(){
  const el=document.createElement('div');
  el.className='audio-channel desktop-audio';
  el.id='desktopAudioFader';
  const src=S.desktopAudioId?S.srcs.find(s=>s.id===S.desktopAudioId):null;
  const connected=!!src;
  const vol=src?Math.round(src.vol*100):100;
  const muted=src?src.muted:false;
  const mi=muted?'<line x1="1" y1="1" x2="23" y2="23"/>':'<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>';
  el.innerHTML=`<div class="audio-channel-row">
    <span class="audio-channel-icon"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
    <span class="audio-channel-name">Рабочий стол</span>
    <div class="audio-controls">
      <div class="audio-fader-row"><input type="range" class="audio-slider" id="desktopSlider" min="0" max="100" value="${vol}" ${connected?'':'disabled'}/><span class="audio-db" id="desktopDb" style="color:${connected?'var(--text2)':'var(--muted)'}">${connected?(muted?'MUTE':vol+'%'):'—'}</span></div>
      <div class="level-meter-h-wrap"><div class="level-meter-h"><div class="level-meter-fill-h" id="lv_desktop" style="width:0%"></div></div><div class="level-db-scale"><span>-60</span><span>-30</span><span>-18</span><span>-9</span><span>0</span></div></div>
    </div>
    <div class="audio-btns">
      <button class="btn-icon ${muted?'muted':''}" id="btnDesktopMute" title="Mute" ${connected?'':'disabled'}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${mi}</svg></button>
      <button class="btn-icon ${_hasFx(S.desktopAudioId)?'fx-active':''}" id="btnDesktopFx" data-fxid="${S.desktopAudioId||''}" title="FX" ${connected?'':'disabled'}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="12" cy="6" r="3"/><line x1="8.5" y1="16" x2="10.5" y2="8"/><line x1="15.5" y1="16" x2="13.5" y2="8"/></svg></button>
    </div></div>`;
  D.audioMixer.appendChild(el);
  if(connected){
    document.getElementById('desktopSlider').oninput=(ev)=>{
      src.vol=parseInt(ev.target.value)/100;
      document.getElementById('desktopDb').textContent=src.muted?'MUTE':Math.round(src.vol*100)+'%';
      _updateGain(src);
      _coBroadcastSrcUpdateDebounced(src,150);
    };
    document.getElementById('btnDesktopMute').onclick=()=>{
      src.muted=!src.muted;
      _updateGain(src);
      document.getElementById('desktopDb').textContent=src.muted?'MUTE':Math.round(src.vol*100)+'%';
      _coSafe(co=>co.broadcastSourceUpdate());
      const btn=document.getElementById('btnDesktopMute');
      btn.classList.toggle('muted',src.muted);
      const mi2=src.muted?'<line x1="1" y1="1" x2="23" y2="23"/>':'<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>';
      btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+mi2+'</svg>';
    };
    // Desktop monitor button is disabled — no-op (monitoring desktop audio creates echo)
    // (button is already disabled in HTML, no onclick needed)
    // Track slider dragging to show % while dragging, dB when idle
    const slider=document.getElementById('desktopSlider');
    slider._dragging=false;
    slider.addEventListener('mousedown',()=>{slider._dragging=true;});
    slider.addEventListener('mouseup',()=>{slider._dragging=false;});
    slider.addEventListener('touchstart',()=>{slider._dragging=true;});
    slider.addEventListener('touchend',()=>{slider._dragging=false;});
    // FX button
    const fxBtn=document.getElementById('btnDesktopFx');
    if(fxBtn) fxBtn.onclick=()=>_showFxModal(S.desktopAudioId);
  }
}

function _updateDesktopFader(connected){
  // Re-render the mixer to update fader state
  renderMixer();
}

async function captureDesktopAudio(){
  // WASAPI capture is auto-started — no dialog needed
  // This function is kept for compatibility but just reports status
  if(S.desktopAudioId){
    msg('Звук рабочего стола уже подключён (WASAPI)','info');
  }else{
    msg('Запуск WASAPI захвата...','info');
    await _startWasapiCapture();
  }
}

function addAudioSource(type,name,stream,isP=false,pid=null,opts){
  // opts: { gid, ownerPeerId, msid, suppressBroadcast } — used when applying a remote src.add
  opts=opts||{};
  const id=opts.gid||_newSid();
  const owner=opts.ownerPeerId|| (isP?pid:S.myPeerId);
  const msid=opts.msid||(stream?stream.id:null);
  const src={id,gid:id,ownerPeerId:owner,name,type,stream,msid,el:null,visible:true,vol:1,muted:false,isPeer:isP,peerId:pid,vst:[],monitor:isP,fxState:_loadFxStateForName(name)};
  S.srcs.push(src);
  if(window.__sbDev) console.log('[Audio] Source added: '+name+', tracks='+(stream?stream.getAudioTracks().length:0));
  _p2pLog('[Audio] Source added: '+name+' type='+type+' isPeer='+isP+' tracks='+(stream?stream.getAudioTracks().length:0)+' msid='+(msid||'null'));
  ensureAudioCtx();
  _resumeAudioCtx();
  if(stream&&stream.getAudioTracks().length>0) _connectSource(src);
  _rebuildCombinedStream();
  // (peer-owned audio is NOT relayed back — anti-echo)
  _wireTrackEndHandlers(src);
  renderMixer();updateE();
  if(!isP&&S.co&&!opts.suppressBroadcast) S.co.broadcastSourceAdd(src);
  // Send this source's original stream to all connected peers
  // Only queue the stream — don't trigger renegotiate here.
  // _sendSourceStreamsToPeers() will batch-add all streams when connecting to a room,
  // and for sources added mid-session, _addSourceToPeers triggers renegotiate.
  if(!isP&&stream&&stream.getTracks().length&&S.wrtc){
    if(!S._wrtcPrevPerSource) S._wrtcPrevPerSource=new Map();
    S._wrtcPrevPerSource.set(id,stream);
    S.wrtc.localStreams.add(stream);
    // Only add to existing peers and renegotiate if we're in an active P2P session
    if(S.wrtc.peers.size>0){
      _addSourceToPeers(src);
    }
    _p2pLog('[P2P] Audio source queued for peers: '+name+' '+type+' msid='+stream.id);
  }
  return id;
}

function _syncOverlaySize(){SBUi.syncOverlaySize();}

function _initHints(){SBUi.initHints();}

function initRTMP(){
  S.rtmp=new RTMPOutput();S.rtmp.setCanvas(D.sceneCanvas);
  S.rtmp.onStart=()=>{S.streaming=true;D.btnStartStream.classList.add('streaming');D.btnStartStream.innerHTML='<span class="stream-dot"></span> Подключение...';D.btnPauseStream.disabled=false;D.btnStopStream.disabled=false;msg('Подключение к серверу...','info');_muteAppSounds();};
  S.rtmp.onStop=()=>{S.streaming=false;D.btnStartStream.classList.remove('streaming');D.btnStartStream.innerHTML='<span class="stream-dot"></span> Стрим';D.btnPauseStream.disabled=true;D.btnStopStream.disabled=true;D.btnPauseStream.textContent='Пауза';D.streamUptime.textContent='00:00:00';msg('Стрим остановлен','info');_setStreamStatus('offline');_unmuteAppSounds();};
  S.rtmp.onPause=()=>{D.btnPauseStream.textContent='Продолжить';msg('Стрим на паузе','info');};
  S.rtmp.onResume=()=>{D.btnPauseStream.textContent='Пауза';msg('Стрим продолжен','info');};
  S.rtmp.onError=m=>msg('Ошибка: '+m,'error');
  S.rtmp.onStatus=(state,reason)=>_setStreamStatus(state,reason);
  S.rtmp.onRecStart=()=>{D.btnStartRec.classList.add('recording');D.btnStartRec.innerHTML='<span class="rec-dot"></span> REC';D.btnStartRec.disabled=true;D.btnPauseRec.disabled=false;D.btnStopRec.disabled=false;D.recTimer.classList.add('active');S._recTimerInterval=setInterval(()=>{if(S.rtmp)D.recTimer.textContent=S.rtmp.getRecTime();},200);msg('Локальная запись начата','success');_muteAppSounds();};
  S.rtmp.onRecStop=(p)=>{
    clearInterval(S._recTimerInterval);S._recTimerInterval=null;
    D.btnStartRec.classList.remove('recording');
    D.btnStartRec.innerHTML='<span class="rec-dot"></span> Запись';
    D.btnStartRec.disabled=false;
    D.btnPauseRec.disabled=true;D.btnPauseRec.textContent='Пауза';
    D.btnStopRec.disabled=true;
    D.recTimer.classList.remove('active');D.recTimer.textContent='00:00:00';
    _unmuteAppSounds();
    if(p===null){
      msg('Сохранение записи...','info');
    }else{
      msg('Запись сохранена: '+(p||'Видео'),'success');
    }
  };
  // Status hint while ffmpeg flushes / finalises the MP4 container
  S.rtmp._showConverting=(text)=>{msg(text||'Финализация MP4...','info');};
  S.rtmp.onRecPause=()=>{D.btnPauseRec.textContent='Продолжить';D.recTimer.classList.remove('active');msg('Запись на паузе','info');};
  S.rtmp.onRecResume=()=>{D.btnPauseRec.textContent='Пауза';D.recTimer.classList.add('active');msg('Запись продолжена','info');};
  S.rtmp.onSaveDone=(p)=>{msg('Запись сохранена: '+(p||'Видео'),'success');};
  S.rtmp.onError=m=>{
    // Re-enable both stream and recording buttons after an error so the user
    // can try again without restarting the whole app.
    msg('Ошибка: '+m,'error');
    try{
      // Recording UI reset
      clearInterval(S._recTimerInterval);S._recTimerInterval=null;
      D.btnStartRec.classList.remove('recording');
      D.btnStartRec.innerHTML='<span class="rec-dot"></span> Запись';
      D.btnStartRec.disabled=false;
      D.btnPauseRec.disabled=true;D.btnPauseRec.textContent='Пауза';
      D.btnStopRec.disabled=true;
      D.recTimer.classList.remove('active');D.recTimer.textContent='00:00:00';
      // Stream UI reset
      D.btnStartStream.classList.remove('streaming','connecting');
      D.btnStartStream.innerHTML='<span class="stream-dot"></span> Стрим';
      D.btnPauseStream.disabled=true;D.btnPauseStream.textContent='Пауза';
      D.btnStopStream.disabled=true;
      D.streamUptime.textContent='00:00:00';
      S.streaming=false;
    }catch(e){if(window.__sbDev)console.warn('[ui-reset]',e);}
  };
}

function loop(){
  let _lastOverlaySync=0;
  (function f(){
    const now=performance.now();
    const minDelta=1000/Math.max(15,Math.min(120,S.targetFps||60));
    if(now-S._lastRenderAt>=minDelta-0.5){
      S._lastRenderAt=now;
      // Dirty-flag: skip full render when scene is static (no video sources, not streaming, not dragging)
      const hasVideoSources=S.srcs.some(s=>s.el&&s.el.readyState>=2&&(s.type==='camera'||s.type==='screen'||s.type==='window'||s.type==='peer-video'));
      if(S._dirty||hasVideoSources||S.streaming||S.drag||S.res||S.rot||S.rotC||S.crop||S._sceneTransition){
        // Process scene transition (fade) before render
        if(S._sceneTransition){
          const tr=S._sceneTransition;
          const elapsed=performance.now()-tr.start;
          const dur=300;
          if(tr.phase==='out'){
            tr.alpha=Math.max(0,1-elapsed/dur);
            if(tr.alpha<=0){
              // Fade-out complete → apply preset, then fade in
              S._sceneTransition={phase:'loading',start:performance.now()};
              if(tr.targetPreset){
                _applyScenePreset(tr.targetPreset).then(()=>{
                  S._sceneTransition={phase:'in',alpha:0,start:performance.now()};
                  _markDirty();
                }).catch(e=>{
                  if(window.__sbDev)console.error('[SceneTransition] apply failed:',e);
                  S._sceneTransition=null;
                });
              }else{
                S._sceneTransition={phase:'in',alpha:0,start:performance.now()};
              }
            }
          }else if(tr.phase==='in'){
            tr.alpha=Math.min(1,elapsed/dur);
            if(tr.alpha>=1) S._sceneTransition=null;
          }else if(tr.phase==='loading'){
            // Waiting for _applyScenePreset to resolve — keep rendering black
            // Timeout after 5s
            if(elapsed>5000){
              S._sceneTransition=null;
            }
          }
        }
        try{render();}catch(e){if(window.__sbDev)console.error('[render]',e);}
        S._dirty=false;
      }
      // Sync overlay position to canvas (cheap, throttled to ~1Hz)
      if(now-_lastOverlaySync>1000){_syncOverlaySize();_lastOverlaySync=now;}
      // Co-session: while user is actively dragging/resizing, queue throttled
      // updates for the affected item so the friend sees motion in real time.
      try{_coTickActiveEdit();}catch(e){}
    }
    S.anim=requestAnimationFrame(f);
  })();
}

// Throttle "live edit broadcasts" to ~30 Hz inside CoScene. Here we just
// enqueue the current item; CoScene coalesces multiple calls into one msg.
function _coTickActiveEdit(){
  if(!S.co) return;
  const sid=S.drag?S.drag.sid:S.res?S.res.sid:S.rot?S.rot.sid:S.rotC?S.rotC.sid:S.crop?S.crop.sid:null;
  if(!sid) return;
  const it=S.items.find(x=>x.sid===sid);
  if(it) S.co.queueItemUpsert(it);
}

// ═══════════════════════════════════════════════════════════
//  STREAM STATUS UI
// ═══════════════════════════════════════════════════════════
// Mute/unmute app sounds during stream/recording so they don't leak via WASAPI

function _setStreamStatus(state,reason){
  S.streamStatus=state;  if(!D.btnStartStream)return;
  const map={offline:'Стрим',connecting:'Подключение...',live:'Идёт стрим',reconnecting:'Переподключение...',error:'Ошибка'};
  const label=map[state]||state;
  // On error/offline, fully reset the stream-side UI so the user can press "Стрим" again.
  if(state==='offline'||state==='error'){
    D.btnStartStream.innerHTML='<span class="stream-dot"></span> Стрим';
    D.btnStartStream.classList.remove('streaming','connecting');
    D.btnPauseStream.disabled=true; D.btnPauseStream.textContent='Пауза';
    D.btnStopStream.disabled=true;
    D.streamUptime.textContent='00:00:00';
    S.streaming=false;
  }else{
    D.btnStartStream.innerHTML='<span class="stream-dot"></span> '+label;
    D.btnStartStream.classList.toggle('streaming',state==='live');
    D.btnStartStream.classList.toggle('connecting',state==='connecting'||state==='reconnecting');
  }
  if(state==='reconnecting') msg(reason?('Переподключение... '+reason):'Соединение потеряно — переподключение...','info');
  if(state==='error') { msg(reason?('Ошибка стрима: '+reason):'Ошибка стрима','error'); _sbSound('streamError'); _sbReportBug({type:'stream-error',reason:reason||''}); }
  if(state==='live') { msg('Стрим в эфире','success'); _sbSound('streamStart'); _sbApplyAutoStreamingStatus(true); }
  if(state==='offline') { _sbApplyAutoStreamingStatus(false); if(S._wasLive) _sbSound('streamStop'); }
  S._wasLive = (state==='live');
  // Update stream status pill in header
  if(D.streamStatusDot){
    const dotMap={offline:'offline',connecting:'connecting',live:'live',reconnecting:'reconnecting',error:'error'};
    D.streamStatusDot.className='status-dot '+(dotMap[state]||'offline');
  }
  if(D.streamStatusText){
    const pillMap={offline:'Стрим выкл',connecting:'Подключение...',live:'В эфире',reconnecting:'Переподключение...',error:'Ошибка'};
    D.streamStatusText.textContent=pillMap[state]||'Стрим выкл';
  }
  // Make stream pill visually active (clickable hint to go to stream section)
  if(D.streamStatusPill){
    D.streamStatusPill.classList.toggle('live',state==='live');
    D.streamStatusPill.classList.toggle('connecting',state==='connecting'||state==='reconnecting');
    D.streamStatusPill.classList.toggle('error',state==='error');
  }
}

// ═══════════════════════════════════════════════════════════
//  DEVICE DISCONNECT HANDLING
//  Wire onended on every track so we react to camera/mic unplug.
// ═══════════════════════════════════════════════════════════
function _wireTrackEndHandlers(src){
  if(!src||!src.stream||src._trackHandlersWired) return;
  src._trackHandlersWired=true;
  const tracks=src.stream.getTracks();
  for(const t of tracks){
    t.addEventListener('ended',()=>{
      if(window.__sbDev) console.warn('[Device] Track ended:',src.name,t.kind,'isPeer='+src.isPeer);
      if(src.isPeer){
        // Peer track ended = friend removed this source → remove it from our list too
        // Check if ALL tracks in this source's stream have ended
        const allEnded=src.stream.getTracks().every(tr=>tr.readyState==='ended');
        if(allEnded){
          _p2pLog('[P2P] All peer tracks ended, removing source: '+src.name);
          try{ rmSrc(src.id,{fromRemote:true}); }catch(e){
            _p2pLog('[P2P] WARN: Failed to remove ended peer source: '+e.message);
          }
        }
        return;
      }
      // Desktop audio is restarted automatically by WASAPI watcher
      if(src.id===S.desktopAudioId) return;
      msg('Устройство отключено: '+src.name,'error');
      try{rmSrc(src.id);}catch(e){}
    });
    // For peer sources: handle track unmute — WebRTC audio tracks can
    // arrive muted and only produce sound after unmute event.
    if(src.isPeer){
      t.addEventListener('unmute',()=>{
        _p2pLog('[P2P] Track unmuted: '+src.name+' '+t.kind);
        // Reconnect audio chain to pick up the now-active track
        if(t.kind==='audio'){
          try{ _disconnectSource(src.id); _connectSource(src); _rebuildCombinedStream(); }catch(e){
            _p2pLog('[P2P] WARN: unmute reconnect failed: '+e.message);
          }
        }
        _markDirty();
      });
      // Also log mute events for debugging
      t.addEventListener('mute',()=>{
        _p2pLog('[P2P] Track muted: '+src.name+' '+t.kind);
      });
      // CRITICAL FIX: if the track is ALREADY unmuted when we wire handlers,
      // the 'unmute' event already fired and we missed it.
      // This happens when:
      //   a) Initial connection: ICE connects before CoScene snapshot arrives (0.9s gap)
      //   b) Re-added sources: ICE already active, unmute fires ~20ms after ontrack
      //      but grace period is 2.5s → source created way after unmute
      // In these cases, createMediaStreamSource was called with an "already-unmuted"
      // track and Chrome's audio pipeline doesn't produce data without reconnect.
      // Solution: schedule a reconnect after 200ms (after _connectSource finishes async).
      if(t.kind==='audio' && !t.muted){
        _p2pLog('[P2P] Track already unmuted at wire time: '+src.name+' - scheduling reconnect');
        setTimeout(()=>{
          if(!S.srcs.find(s=>s.id===src.id)) return; // source removed
          _p2pLog('[P2P] Executing scheduled reconnect for already-unmuted track: '+src.name);
          try{ _disconnectSource(src.id); _connectSource(src); _rebuildCombinedStream(); }catch(e){
            _p2pLog('[P2P] WARN: scheduled reconnect failed: '+e.message);
          }
        }, 200);
      }
    }
  }
  // For peer sources: listen for removetrack on the stream (WebRTC fires this
  // when the remote peer removes a track via removeTrack + renegotiate).
  // IMPORTANT: do NOT delete the source on removetrack — during renegotiate,
  // WebRTC may temporarily remove all tracks and then add new ones. Deleting
  // the source kills the audio chain, and the new onPeerTrack creates a
  // duplicate source instead of reconnecting. Just mark dirty and let
  // the next onPeerTrack handle it.
  if(src.isPeer && src.stream){
    src.stream.addEventListener('removetrack',(e)=>{
      _p2pLog('[P2P] removetrack on peer stream: '+src.name+' '+e.track?.kind);
      // Only delete if the source stream has NO live tracks AND no new
      // tracks appear within 8 seconds (grace period for renegotiate).
      const remaining=src.stream.getTracks().filter(tr=>tr.readyState!=='ended');
      if(remaining.length===0){
        // Don't delete immediately — renegotiate may add new tracks via onPeerTrack
        // with a DIFFERENT stream.id (new MediaStream). onPeerTrack creates a fallback
        // source. So we check: if a new source from the same peer already exists,
        // we can safely delete this one. Otherwise, wait 8s before deleting.
        const samePeerSrcs=S.srcs.filter(s=>s.isPeer&&s.peerId===src.peerId&&s.id!==src.id);
        if(samePeerSrcs.length>0){
          // New sources from this peer already exist — safe to delete the old one
          _p2pLog('[P2P] removetrack: peer has other sources, deleting old: '+src.name);
          try{ rmSrc(src.id,{fromRemote:true}); }catch(e2){}
        } else {
          // No new sources yet — wait for renegotiate to deliver them
          if(src._removetrackTimer) clearTimeout(src._removetrackTimer);
          src._removetrackTimer=setTimeout(()=>{
            // Re-check: maybe new sources appeared from this peer
            const nowAlive=src.stream.getTracks().filter(tr=>tr.readyState!=='ended');
            const peerHasNew=S.srcs.filter(s=>s.isPeer&&s.peerId===src.peerId&&s.id!==src.id);
            if(nowAlive.length===0 && peerHasNew.length===0 && S.srcs.some(s=>s.id===src.id)){
              _p2pLog('[P2P] Grace expired, no new sources from peer, deleting: '+src.name);
              try{ rmSrc(src.id,{fromRemote:true}); }catch(e2){}
            } else if(nowAlive.length===0 && S.srcs.some(s=>s.id===src.id)){
              _p2pLog('[P2P] Grace expired but peer has new sources, deleting old: '+src.name);
              try{ rmSrc(src.id,{fromRemote:true}); }catch(e2){}
            }
          },8000);
        }
      }else{
        _markDirty();
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════
//  EVENTS
// ═══════════════════════════════════════════════════════════
function bind(){
  D.btnConnectFriend.onclick=()=>showM('connect');
  D.btnAddSource.onclick=()=>{curType=null;showM('addSource');};
  if(D.btnOpenSettings) D.btnOpenSettings.onclick=()=>showM('settings');
  // Logo click → open StreamBro website
  const logoEl=document.querySelector('.logo');
  if(logoEl){
    logoEl.style.cursor='pointer';
    logoEl.onclick=()=>{
      try{window.electronAPI.openExternal('https://streambro.ru');}catch(e){window.open('https://streambro.ru','_blank');}
    };
  }
  // Stream status pill click → open stream section
  if(D.streamStatusPill){
    D.streamStatusPill.style.cursor='pointer';
    D.streamStatusPill.onclick=()=>{
      const accStream=document.getElementById('accStream');
      if(accStream&&!accStream.classList.contains('open')){
        const hdr=accStream.querySelector('.accordion-header');
        if(hdr) hdr.click();
      }
      accStream.scrollIntoView({behavior:'smooth',block:'nearest'});
    };
  }
  if(D.btnCloseSettingsModal) D.btnCloseSettingsModal.onclick=()=>hideM('settings');
  if(D.settingsModal) D.settingsModal.onclick=e=>{if(e.target===D.settingsModal)hideM('settings');};
  if(D.btnOpenHelp) D.btnOpenHelp.onclick=()=>showM('help');
  if(D.btnCloseHelpModal) D.btnCloseHelpModal.onclick=()=>hideM('help');
  if(D.helpModal) D.helpModal.onclick=e=>{if(e.target===D.helpModal)hideM('help');};
  // Restart onboarding from help modal
  const btnRestart = document.getElementById('btnRestartOnboarding');
  if(btnRestart) btnRestart.onclick=()=>{hideM('help');_startOnboarding();};
  D.btnMixerAdd.onclick=e=>{e.stopPropagation();D.mixerAddDropdown.classList.toggle('open');};
  document.addEventListener('click',e=>{if(!D.mixerAddDropdown.contains(e.target)&&e.target!==D.btnMixerAdd)D.mixerAddDropdown.classList.remove('open');});
  D.mixerAddDropdown.querySelectorAll('[data-madd]').forEach(b=>b.onclick=()=>{const t=b.dataset.madd;D.mixerAddDropdown.classList.remove('open');if(t==='mic')showM('addMic');else if(t==='desktop'){if(S.desktopAudioId&&S.srcs.find(s=>s.id===S.desktopAudioId)){msg('Звук рабочего стола уже подключён','info');}else{captureDesktopAudio();}}});
  D.btnStartStream.onclick=startStream;
  D.btnStopStream.onclick=()=>S.rtmp.stop();
  D.btnPauseStream.onclick=()=>{if(S.rtmp.isPaused)S.rtmp.resume();else S.rtmp.pause();};
  D.btnStartRec.onclick=startRecording;
  D.btnPauseRec.onclick=()=>{if(S.rtmp.isRecPaused)S.rtmp.resumeRecording();else S.rtmp.pauseRecording();};
  D.btnStopRec.onclick=()=>S.rtmp.stopRecording();
  D.streamPlatform.onchange=()=>{D.customServerGroup.style.display=D.streamPlatform.value==='custom'?'flex':'none';_scheduleSettingsSave();};
  D.btnToggleKeyVisibility.onclick=()=>{const i=D.streamKey;i.type=i.type==='password'?'text':'password';};
  D.streamKey.oninput=_scheduleSettingsSave;
  D.streamKey.onchange=_scheduleSettingsSave;
  D.customServer.oninput=_scheduleSettingsSave;
  D.streamBitrateInput.oninput=_scheduleSettingsSave;
  D.streamResolution.onchange=()=>{
    const[w,h]=D.streamResolution.value.split('x').map(Number);
    S.cw=w;S.ch=h;D.sceneCanvas.width=w;D.sceneCanvas.height=h;if(D.sceneOverlay){D.sceneOverlay.width=w;D.sceneOverlay.height=h;}if(S._useGL&&S.gl)S.gl.resize(w,h);
    _rebuildCombinedStream();
    _scheduleSettingsSave();
  };
  D.signalingServer.onchange=_scheduleSettingsSave;
  D.turnServerUrl.onchange=_scheduleSettingsSave;
  D.turnServerUser.onchange=_scheduleSettingsSave;
  D.turnServerPass.onchange=_scheduleSettingsSave;
  D.btnCloseConnectModal.onclick=()=>hideM('connect');
  D.btnCreateRoom.onclick=createRoom;
  D.btnJoinRoom.onclick=joinRoom;
  D.btnCopyCode.onclick=copyCode;
  if(D.btnLeaveRoomTop)D.btnLeaveRoomTop.onclick=leaveCurrentRoom;
  const expBtn=document.getElementById('btnExportP2pLog');
  if(expBtn) expBtn.onclick=_exportP2pLog;
  if(D.btnPasteCode)D.btnPasteCode.onclick=async()=>{
    try{const t=await navigator.clipboard.readText();if(t){D.joinRoomCode.value=t;D.joinRoomCode.dispatchEvent(new Event('input'));}}catch{};
  };
  document.querySelectorAll('#connectModal .tab-btn').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('#connectModal .tab-btn').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('#connectModal .tab-content').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const tabMap={create:'tabCreate',join:'tabJoin',myrooms:'tabMyRooms'};
    const id=tabMap[b.dataset.tab]||('tab'+b.dataset.tab.charAt(0).toUpperCase()+b.dataset.tab.slice(1));
    const el=$(id);if(el)el.classList.add('active');
    if(b.dataset.tab==='myrooms') loadMyRooms();
  });
  D.btnCloseSourceModal.onclick=()=>hideM('addSource');
  document.querySelectorAll('.source-type-btn').forEach(b=>b.onclick=()=>pickType(b.dataset.source));
  D.btnConfirmSource.onclick=confirmAdd;
  D.btnCloseMicModal.onclick=()=>hideM('addMic');
  D.btnConfirmMic.onclick=confirmAddMic;
  D.addMicModal.onclick=e=>{if(e.target===D.addMicModal)hideM('addMic');};
  D.btnCloseRenameModal.onclick=()=>hideM('rename');
  D.btnConfirmRename.onclick=_confirmRename;
  D.renameModal.onclick=e=>{if(e.target===D.renameModal)hideM('rename');};
  D.renameInput.onkeydown=e=>{if(e.key==='Enter')_confirmRename();if(e.key==='Escape')hideM('rename');};
  D.connectModal.onclick=e=>{if(e.target===D.connectModal)hideM('connect');};
  D.addSourceModal.onclick=e=>{if(e.target===D.addSourceModal)hideM('addSource');};
  document.onkeydown=e=>{
    // Don't intercept while typing into inputs/selects/textareas
    const tg=e.target&&e.target.tagName;
    const isField=tg==='INPUT'||tg==='TEXTAREA'||tg==='SELECT'||(e.target&&e.target.isContentEditable);
    if(e.key==='Alt'){S.alt=true;e.preventDefault();}
    if(e.key===' '&&!isField){S.spacePan=true;e.preventDefault();}
    // Ctrl+Z / Cmd+Z — undo last transform/crop/mask change. Match by e.code (KeyZ) to support non-Latin layouts
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(e.code==='KeyZ'||e.key==='z'||e.key==='Z'||e.key==='я'||e.key==='Я')){
      if(!isField){_undo();e.preventDefault();return;}
    }
    if(e.key==='Escape'){
      hideM('connect');hideM('addSource');hideM('addMic');hideM('settings');hideM('help');hideM('rename');
      S.selItem=null;_closeContextMenu();
      const cm=document.getElementById('camModal');
      if(cm){if(S._camRAF){cancelAnimationFrame(S._camRAF[0]);cancelAnimationFrame(S._camRAF[1]);S._camRAF=null;}cm.remove();}
      const fm=document.getElementById('fxModal');if(fm)fm.remove();
      const sp=document.getElementById('screenPickerModal');if(sp)sp.remove();
    }
    if(e.key==='Delete'&&!isField){
      if(S.selId)rmSrc(S.selId);else if(S.selItem)rmSrc(S.selItem);
    }
    // Hotkeys (block when modal is open or in a field). Use e.code (physical key) to support RU layout
    if(isField) return;
    const sel=S.selItem||S.selId;
    const code=e.code||'';
    if(code==='KeyR'||e.key==='r'||e.key==='R'){
      if(sel){const it=S.items.find(x=>x.sid===sel);if(it){_pushUndo('сброс');_resetTransform(it);e.preventDefault();}}
    }
    if(code==='KeyH'||e.key==='h'||e.key==='H'){
      if(sel){togVis(sel);e.preventDefault();}
    }
    if(code==='KeyL'||e.key==='l'||e.key==='L'){
      if(sel){togLock(sel);e.preventDefault();}
    }
    if(code==='KeyG'||e.key==='g'||e.key==='G'){
      S.showGrid=!S.showGrid;_scheduleSettingsSave();_markDirty();e.preventDefault();
    }
    if((code==='KeyM'||e.key==='m'||e.key==='M')&&!e.ctrlKey&&!e.metaKey){
      // Toggle mute on all microphone sources (not desktop/system audio)
      const mics=S.srcs.filter(x=>x.stream&&x.stream.getAudioTracks().length>0&&x.type!=='desktop');
      if(mics.length){
        // If any are unmuted, mute all; otherwise unmute all
        const anyUnmuted=mics.some(x=>!x.muted);
        mics.forEach(x=>{x.muted=anyUnmuted;_updateGain(x);_coSafe(co=>co.broadcastSourceUpdate(x));});
        renderMixer();_scheduleSettingsSave();
        msg(anyUnmuted?'Все микрофоны выключены':'Все микрофоны включены',anyUnmuted?'info':'ok');
        e.preventDefault();
      }
    }
    if(e.key==='F11'){
      // toggle fullscreen of app window — let Electron handle via menu, ignore here
    }
  };
  document.onkeyup=e=>{if(e.key==='Alt')S.alt=false;if(e.key===' ')S.spacePan=false;};
  D.sourcesList.onclick=e=>{
    const it=e.target.closest('.source-item');
    const b=e.target.closest('[data-a]');
    if(b){
      e.stopPropagation();
      const sid=b.closest('.source-item')?.dataset.sid;
      if(!sid)return;
      if(b.dataset.a==='del')rmSrc(sid);
      else if(b.dataset.a==='tog')togVis(sid);
      else if(b.dataset.a==='lock')togLock(sid);
      else if(b.dataset.a==='cam')_showCamSettingsModal(sid);
      else if(b.dataset.a==='rename')_showRenameModal(sid);
      return;
    }
    if(it)selSrc(it.dataset.sid);
  };
  let dragSid=null;
  D.sourcesList.addEventListener('dragstart',e=>{dragSid=e.target.closest('.source-item')?.dataset.sid;if(dragSid)e.dataTransfer.effectAllowed='move';});
  D.sourcesList.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
  D.sourcesList.addEventListener('drop',e=>{e.preventDefault();const target=e.target.closest('.source-item')?.dataset.sid;if(dragSid&&target&&dragSid!==target){const fi=S.srcs.findIndex(s=>s.id===dragSid),ti=S.srcs.findIndex(s=>s.id===target);const[src]=S.srcs.splice(fi,1);S.srcs.splice(ti,0,src);rebuildZ();renderSources();_coSafe(co=>co.broadcastSrcReorder(_currentSrcOrder()));}dragSid=null;});
  D.joinRoomCode.oninput=e=>{let v=e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();if(v.length>4)v=v.slice(0,4)+'-'+v.slice(4);if(v.length>9)v=v.slice(0,9)+'-'+v.slice(9);if(v.length>14)v=v.slice(0,14)+'-'+v.slice(14);if(v.length>19)v=v.slice(0,19);e.target.value=v;};
  document.querySelectorAll('.accordion-header').forEach(h=>h.onclick=()=>h.closest('.accordion-item').classList.toggle('open'));
  // Listen for system device changes — update visible source/mic lists if any modal is open
  if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
    navigator.mediaDevices.addEventListener('devicechange',()=>{
      if(D.addSourceModal&&D.addSourceModal.style.display==='flex'&&curType==='camera') loadD('videoinput','Камера');
      if(D.addMicModal&&D.addMicModal.style.display==='flex') loadMicList();
    });
  }
  // React to OS theme changes when user picked 'system'
  if(window.matchMedia){
    const mq=window.matchMedia('(prefers-color-scheme: light)');
    if(mq&&mq.addEventListener) mq.addEventListener('change',()=>{
      if(S.settings&&S.settings.ui&&S.settings.ui.theme==='system') _applyTheme();
    });
  }
}

function rebuildZ(){SBSources.rebuildZ();_markDirty();}

// ═══════════════════════════════════════════════════════════
//  SCENE INTERACTION (unchanged)
// ═══════════════════════════════════════════════════════════
function setupScene(){
  const cv=D.sceneCanvas;
  // Resize observer: sync both canvas and overlay CSS sizes
  if(typeof ResizeObserver!=='undefined'&&D.scenePreview){
    const ro=new ResizeObserver(()=>{_syncOverlaySize();});
    ro.observe(D.scenePreview);
  }
  cv.onmousedown=e=>{
    const{x:mx,y:my}=toCanvas(cv,e);
    const sorted=[...S.items].sort((a,b)=>b.z-a.z);
    for(const it of sorted){
      const src=S.srcs.find(s=>s.id===it.sid);
      if(!src||!src.visible||!src.el)continue;
      if(src.locked){
        // Click on locked item — only allow selection (no drag/resize)
        if(hitItem(mx,my,it)){S.selItem=it.sid;S.selId=it.sid;renderSources();e.preventDefault();return;}
        continue;
      }
      if(S.selItem===it.sid){
        const hid=hitHandle(mx,my,it);
        if(hid){
          if(hid==='rot'){_pushUndo('поворот');S.rot={sid:it.sid,origW:it.w,origH:it.h,origFlipH:it.flipH,origFlipV:it.flipV,startDist:Math.max(1,Math.hypot(mx-it.cx,my-it.cy)),_fp:false};}
          else if(S.alt){_pushUndo('кроп');const _rmI=rotMat(-it.rot);S.crop={sid:it.sid,hid,startLocal:{x:_rmI.a*(mx-it.uncropCx)+_rmI.c*(my-it.uncropCy),y:_rmI.b*(mx-it.uncropCx)+_rmI.d*(my-it.uncropCy)},origCrop:{...it.crop}};}
          else if('tl tr bl br'.includes(hid)){_pushUndo('масштаб углом');S.rotC={sid:it.sid,origRot:it.rot,origW:it.w,origH:it.h,origAR:it.w/it.h,startAngle:Math.atan2(my-it.cy,mx-it.cx)*180/Math.PI,startDist:Math.hypot(mx-it.cx,my-it.cy)};}
          else{_pushUndo('масштаб');const opL=opposite(hid,it.w,it.h);S.res={sid:it.sid,hid,anchorWorld:localToWorld(it,opL.x,opL.y),origW:it.w,origH:it.h,origAR:it.w/it.h};}
          e.preventDefault();return;
        }
      }
      if(hitItem(mx,my,it)){
        if(S.spacePan){_pushUndo('сдвиг кропа');S.drag={sid:it.sid,startPanDx:it.panDx||0,startPanDy:it.panDy||0,startMx:mx,startMy:my,panCrop:true};}
        else{_pushUndo('перемещение');S.drag={sid:it.sid,dx:mx-it.cx,dy:my-it.cy};}
        S.selItem=it.sid;S.selId=it.sid;renderSources();e.preventDefault();return;
      }
    }
    S.selItem=null;S.selId=null;renderSources();
  };
  cv.ondblclick=e=>{const{x:mx,y:my}=toCanvas(cv,e);const cw=S.cw,ch=S.ch;for(const it of[...S.items].sort((a,b)=>b.z-a.z)){if(hitItem(mx,my,it)){if(it.prevRect){it.cx=it.prevRect.cx;it.cy=it.prevRect.cy;it.w=it.prevRect.w;it.h=it.prevRect.h;it.rot=it.prevRect.rot;it.flipH=it.prevRect.flipH;it.flipV=it.prevRect.flipV;it.uncropW=it.prevRect.uncropW;it.uncropH=it.prevRect.uncropH;it.uncropCx=it.prevRect.uncropCx;it.uncropCy=it.prevRect.uncropCy;it.panDx=it.prevRect.panDx||0;it.panDy=it.prevRect.panDy||0;it.prevRect=null;}else{it.prevRect={cx:it.cx,cy:it.cy,w:it.w,h:it.h,rot:it.rot,flipH:it.flipH,flipV:it.flipV,uncropW:it.uncropW,uncropH:it.uncropH,uncropCx:it.uncropCx,uncropCy:it.uncropCy,panDx:it.panDx||0,panDy:it.panDy||0};const a=((it.rot%360)+360)%360;const natAR=it.naturalAR||it.w/it.h;if(a===90||a===270){it.h=Math.min(cw,ch/natAR);it.w=it.h*natAR;}else{it.w=Math.min(cw,ch*natAR);it.h=it.w/natAR;}it.cx=cw/2;it.cy=ch/2;const cr=it.crop||{l:0,t:0,r:0,b:0};it.uncropW=it.w/Math.max(.1,1-cr.l-cr.r);it.uncropH=it.h/Math.max(.1,1-cr.t-cr.b);const rm=rotMat(it.rot);it.uncropCx=it.cx-rm.a*(cr.l-cr.r)*it.uncropW/2-rm.c*(cr.t-cr.b)*it.uncropH/2;it.uncropCy=it.cy-rm.b*(cr.l-cr.r)*it.uncropW/2-rm.d*(cr.t-cr.b)*it.uncropH/2;it.panDx=0;it.panDy=0;}S.selItem=it.sid;S.selId=it.sid;renderSources();if(S.co){S.co.queueItemUpsert(it);S.co.flushItem(it.sid);}return;}}};
  // Canvas mousemove: only handles cursor preview when no interaction is active.
  // Active drag/resize/rotate/crop are handled by the document mousemove below
  // (so the interaction continues even when the mouse leaves the canvas).
  cv.onmousemove=e=>{
    if(S.drag||S.res||S.rot||S.rotC||S.crop){
      // The shared document handler will update geometry; just hint at cursor here.
      if(S.drag) cv.style.cursor=S.drag.panCrop?'move':'grabbing';
      else if(S.crop) cv.style.cursor='crosshair';
      else if(S.res) cv.style.cursor=cursorFor(S.res.hid);
      else if(S.rotC) cv.style.cursor='grab';
      else if(S.rot) cv.style.cursor='ew-resize';
      return;
    }
    const{x:mx,y:my}=toCanvas(cv,e);
    let cur='default';
    for(const it of[...S.items].sort((a,b)=>b.z-a.z)){
      if(S.selItem===it.sid&&hitHandle(mx,my,it)){cur=cursorFor(hitHandle(mx,my,it));break;}
      if(hitItem(mx,my,it)){cur='grab';break;}
    }
    cv.style.cursor=cur;
  };
  const endI=()=>{
    let finishedSid=null;
    if(S.res||S.rot||S.rotC||S.crop||S.drag){
      finishedSid=S.res?S.res.sid:S.rot?S.rot.sid:S.rotC?S.rotC.sid:S.crop?S.crop.sid:S.drag?S.drag.sid:null;
    }
    if(S.res||S.rot||S.rotC){
      const sid=finishedSid;
      if(sid){const it=S.items.find(s=>s.sid===sid);if(it)_snapCircle(it);}
    }
    S.drag=null;S.res=null;S.rot=null;S.rotC=null;S.crop=null;
    _markDirty();
    // Final flush of the in-progress edit so peers see the exact final state
    if(finishedSid&&S.co){
      const it=S.items.find(s=>s.sid===finishedSid);
      if(it){ S.co.queueItemUpsert(it); S.co.flushItem(finishedSid); }
    }
  };
  cv.onmouseup=endI;
  document.addEventListener('mouseup',e=>{if(S.drag||S.res||S.rot||S.rotC||S.crop)endI();});
  document.addEventListener('mousemove',e=>{if(!S.drag&&!S.res&&!S.rot&&!S.rotC&&!S.crop)return;const{x:mx,y:my}=toCanvas(cv,e);const cw=S.cw,ch=S.ch;if(S.drag){const it=S.items.find(s=>s.sid===S.drag.sid);if(!it)return;const cr=it.crop||{l:0,t:0,r:0,b:0};if(S.drag.panCrop){const rmI=rotMat(-it.rot);const ddx=mx-S.drag.startMx,ddy=my-S.drag.startMy;const lx=rmI.a*ddx+rmI.c*ddy,ly=rmI.b*ddx+rmI.d*ddy;let px=S.drag.startPanDx+lx,py=S.drag.startPanDy+ly;const hasMask=it.cropMask&&it.cropMask!=='none';if(hasMask){
        // For masked sources we use COVER scaling × CIRCLE_PAN_ZOOM — gives wiggle room on BOTH axes
        const _src=S.srcs.find(s=>s.id===it.sid);
        const sw=Math.max(1,_src&&_src.el?(_src.el.videoWidth*(1-cr.l-cr.r)):it.w);
        const sh=Math.max(1,_src&&_src.el?(_src.el.videoHeight*(1-cr.t-cr.b)):it.h);
        const cs=Math.max(it.w/sw,it.h/sh)*CIRCLE_PAN_ZOOM;
        const dw=sw*cs,dh=sh*cs;
        const maxPx=Math.max(0,(dw-it.w)/2);
        const maxPy=Math.max(0,(dh-it.h)/2);
        px=Math.max(-maxPx,Math.min(maxPx,px));
        py=Math.max(-maxPy,Math.min(maxPy,py));
      }else{const vw=1-cr.l-cr.r,vh=1-cr.t-cr.b;if(vw>0.01){const mxL=cr.l*it.w/vw,mxR=-cr.r*it.w/vw;px=Math.max(mxR,Math.min(mxL,px));}else px=0;if(vh>0.01){const myT=cr.t*it.h/vh,myB=-cr.b*it.h/vh;py=Math.max(myB,Math.min(myT,py));}else py=0;}it.panDx=px;it.panDy=py;return;}let ncx=mx-S.drag.dx,ncy=my-S.drag.dy;if(Math.abs(ncx-it.w/2)<SNAP)ncx=it.w/2;if(Math.abs(ncy-it.h/2)<SNAP)ncy=it.h/2;if(Math.abs(ncx+it.w/2-cw)<SNAP)ncx=cw-it.w/2;if(Math.abs(ncy+it.h/2-ch)<SNAP)ncy=ch-it.h/2;if(Math.abs(ncx-cw/2)<SNAP)ncx=cw/2;if(Math.abs(ncy-ch/2)<SNAP)ncy=ch/2;it.cx=ncx;it.cy=ncy;const rm=rotMat(it.rot);it.uncropCx=it.cx-rm.a*(cr.l-cr.r)*it.uncropW/2-rm.c*(cr.t-cr.b)*it.uncropH/2;it.uncropCy=it.cy-rm.b*(cr.l-cr.r)*it.uncropW/2-rm.d*(cr.t-cr.b)*it.uncropH/2;return;}if(S.rot){const it=S.items.find(s=>s.sid===S.rot.sid);if(!it)return;let ns=Math.hypot(mx-it.cx,my-it.cy)/S.rot.startDist;ns=Math.max(.02,Math.min(10,ns));if(ns<.06&&!S.rot._fp){S.rot._fp=true;it.flipH=!it.flipH;}if(ns>.12)S.rot._fp=false;it.w=S.rot.origW*ns;it.h=S.rot.origH*ns;if(it.cropMask==='circle'||it.cropMask==='rect'){const s=Math.max(it.w,it.h);it.w=s;it.h=s;}_enforceCircle(it);return;}if(S.rotC){const it=S.items.find(s=>s.sid===S.rotC.sid);if(!it)return;let newRot=S.rotC.origRot+(Math.atan2(my-it.cy,mx-it.cx)*180/Math.PI-S.rotC.startAngle);for(const s of[0,90,180,270,-90,-180,-270]){if(Math.abs(newRot-s)<5){newRot=s;break;}}it.rot=newRot;let r=Math.hypot(mx-it.cx,my-it.cy)/Math.max(1,S.rotC.startDist);let nw=Math.max(MIN_DIM,S.rotC.origW*r),nh=Math.max(MIN_DIM,S.rotC.origH*r);it.w=nw;it.h=nh;if(it.cropMask==='circle'||it.cropMask==='rect'){const s=Math.max(nw,nh);it.w=s;it.h=s;}_enforceCircle(it);return;}if(S.crop){const it=S.items.find(s=>s.sid===S.crop.sid);if(!it)return;const hid=S.crop.hid;const oc=S.crop.origCrop;const n={...oc};const rm0=rotMat(-it.rot);const dx0=mx-it.uncropCx,dy0=my-it.uncropCy;const mLoc={x:rm0.a*dx0+rm0.c*dy0,y:rm0.b*dx0+rm0.d*dy0};const sLoc=S.crop.startLocal;const dlx=mLoc.x-sLoc.x,dly=mLoc.y-sLoc.y;const bw=it.uncropW,bh=it.uncropH;if(hid==='tm'){n.t=Math.max(0,Math.min(.9,oc.t+dly/bh));}else if(hid==='bm'){n.b=Math.max(0,Math.min(.9,oc.b-dly/bh));}else if(hid==='ml'){n.l=Math.max(0,Math.min(.9,oc.l+dlx/bw));}else if(hid==='mr'){n.r=Math.max(0,Math.min(.9,oc.r-dlx/bw));}else if(hid==='tl'){const cf_l=Math.max(0,Math.min(.45,oc.l+dlx/bw));const cf_t=Math.max(0,Math.min(.45,oc.t+dly/bh));n.l=cf_l;n.r=cf_l;n.t=cf_t;n.b=cf_t;}else if(hid==='tr'){const cf_r=Math.max(0,Math.min(.45,oc.r-dlx/bw));const cf_t=Math.max(0,Math.min(.45,oc.t+dly/bh));n.l=cf_r;n.r=cf_r;n.t=cf_t;n.b=cf_t;}else if(hid==='bl'){const cf_l=Math.max(0,Math.min(.45,oc.l+dlx/bw));const cf_b=Math.max(0,Math.min(.45,oc.b-dly/bh));n.l=cf_l;n.r=cf_l;n.t=cf_b;n.b=cf_b;}else if(hid==='br'){const cf_r=Math.max(0,Math.min(.45,oc.r-dlx/bw));const cf_b=Math.max(0,Math.min(.45,oc.b-dly/bh));n.l=cf_r;n.r=cf_r;n.t=cf_b;n.b=cf_b;}it.crop=n;if(hid==='tl'||hid==='tr'||hid==='bl'||hid==='br'){const avg=(n.l+n.r+n.t+n.b)/4;if(Math.abs(n.l-avg)<0.015&&Math.abs(n.r-avg)<0.015&&Math.abs(n.t-avg)<0.015&&Math.abs(n.b-avg)<0.015){n.l=avg;n.r=avg;n.t=avg;n.b=avg;it.crop=n;}for(const preset of[0.25,0.33,0.5]){if(Math.abs(n.l-preset)<0.008){n.l=preset;n.r=preset;n.t=preset;n.b=preset;it.crop=n;break;}}}const visW=1-n.l-n.r,visH=1-n.t-n.b;it.w=it.uncropW*visW;it.h=it.uncropH*visH;const nlcx=(n.l-n.r)*it.uncropW/2;const nlcy=(n.t-n.b)*it.uncropH/2;const rm=rotMat(it.rot);it.cx=it.uncropCx+rm.a*nlcx+rm.c*nlcy;it.cy=it.uncropCy+rm.b*nlcx+rm.d*nlcy;return;}if(S.res){const it=S.items.find(s=>s.sid===S.res.sid);if(!it)return;const rm=rotMat(it.rot);const dwx=mx-S.res.anchorWorld.x,dwy=my-S.res.anchorWorld.y;let nw,nh;const natAR=(it.cropMask==='circle'||it.cropMask==='rect')?1:(it.naturalAR||S.res.origAR);if(e.shiftKey){nh=Math.abs(rm.c*dwx+rm.d*dwy);nw=Math.abs(rm.a*dwx+rm.b*dwy);}else{const d=Math.hypot(rm.a*dwx+rm.b*dwy,rm.c*dwx+rm.d*dwy)/Math.max(1,Math.hypot(S.res.origW,S.res.origH))*2;nw=S.res.origW*d;nh=nw/natAR;}nw=Math.max(MIN_DIM,nw);nh=Math.max(MIN_DIM,nh);it.w=nw;it.h=nh;if(it.cropMask==='circle'||it.cropMask==='rect'){const s=Math.max(nw,nh);it.w=s;it.h=s;}_enforceCircle(it);const op=opposite(S.res.hid,it.w,it.h);it.cx=S.res.anchorWorld.x-(rm.a*op.x+rm.c*op.y);it.cy=S.res.anchorWorld.y-(rm.b*op.x+rm.d*op.y);return;}});
  cv.onwheel=e=>{
    e.preventDefault();
    const delta=e.deltaY>0?0.9:1.1;
    S.viewZoom=Math.max(0.1,Math.min(5,S.viewZoom*delta));
    _applyViewZoom();
  };
  cv.oncontextmenu=e=>{
    e.preventDefault();
    const{x:mx,y:my}=toCanvas(cv,e);
    const sorted=[...S.items].sort((a,b)=>b.z-a.z);
    let hitIt=null;
    for(const it of sorted){
      const src=S.srcs.find(s=>s.id===it.sid);
      if(!src||!src.visible||!src.el)continue;
      if(hitItem(mx,my,it)){hitIt=it;break;}
    }
    if(!hitIt)return;
    S.selItem=hitIt.sid;S.selId=hitIt.sid;renderSources();
    _showContextMenu(e.clientX,e.clientY,hitIt);
  };
}

function _applyViewZoom(){
  const preview=D.scenePreview;
  if(!preview) return;
  const cv=D.sceneCanvas;
  if(!cv) return;
  const z=S.viewZoom;
  cv.style.transform=`scale(${z})`;
  cv.style.transformOrigin='center center';
  // Show border when zoomed out so user can see streaming frame boundaries
  if(z<1){
    cv.style.outline='2px dashed rgba(255,210,60,0.4)';
    cv.style.outlineOffset='0px';
  }else{
    cv.style.outline='none';
  }
}

// ═══════════════════════════════════════════════════════════
//  CONTEXT MENU (right-click on scene items)
// ═══════════════════════════════════════════════════════════
function _showContextMenu(cx,cy,it){
  _closeContextMenu();
  const menu=document.createElement('div');
  menu.className='context-menu glass';
  menu.id='ctxMenu';
  const maskType=it.cropMask||'none';
  menu.innerHTML=`
    <button class="ctx-item" data-action="rotL">↺ Повернуть влево на 90°</button>
    <button class="ctx-item" data-action="rotR">↻ Повернуть вправо на 90°</button>
    <button class="ctx-item" data-action="flipH">⇔ Отзеркалить по горизонтали</button>
    <button class="ctx-item" data-action="flipV">⇕ Отзеркалить по вертикали</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item" data-action="reset">Сбросить</button>
    <div class="ctx-sep"></div>
    <div class="ctx-submenu-parent">
      <button class="ctx-item">✂ Обрезать →</button>
      <div class="ctx-submenu glass">
        <button class="ctx-item${maskType==='none'?' active':''}" data-action="maskNone">Без обрезки</button>
        <button class="ctx-item${maskType==='circle'?' active':''}" data-action="maskCircle">Круг</button>
        <button class="ctx-item${maskType==='rounded'?' active':''}" data-action="maskRounded">Закруглённый</button>
        <button class="ctx-item${maskType==='rect'?' active':''}" data-action="maskRect">Прямоугольник</button>
      </div>
    </div>
    <div class="ctx-sep"></div>
    <button class="ctx-item" data-action="frameSettings">⚙ Настройки рамки</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item danger" data-action="delete">✕ Удалить источник</button>
  `;
  document.body.appendChild(menu);
  // Position
  const mw=menu.offsetWidth,mh=menu.offsetHeight;
  let left=cx,top=cy;
  if(left+mw>window.innerWidth) left=window.innerWidth-mw-4;
  if(top+mh>window.innerHeight) top=window.innerHeight-mh-4;
  menu.style.left=left+'px';
  menu.style.top=top+'px';

  // Actions
  menu.onclick=e=>{
    const btn=e.target.closest('[data-action]');
    if(!btn)return;
    const a=btn.dataset.action;
    // Snapshot before any context-menu modification (for Ctrl+Z)
    if(a!=='frameSettings'&&a!=='delete') _pushUndo(a);
    if(a==='rotL') it.rot=((it.rot||0)-90+360)%360;
    else if(a==='rotR') it.rot=((it.rot||0)+90)%360;
    else if(a==='flipH') it.flipH=!it.flipH;
    else if(a==='flipV') it.flipV=!it.flipV;
    else if(a==='reset') _resetTransform(it);
    else if(a==='maskNone') it.cropMask='none';
    else if(a==='maskCircle'){it.cropMask='circle';const sq=Math.min(it.w,it.h);it.w=sq;it.h=sq;_enforceCircle(it);}
    else if(a==='maskRounded') it.cropMask='rounded';
    else if(a==='maskRect'){it.cropMask='rect';const sq=Math.min(it.w,it.h);it.w=sq;it.h=sq;_enforceCircle(it);}
    else if(a==='frameSettings'){_closeContextMenu();_showCamSettingsModal(it.sid,'design');return;}
    else if(a==='delete'){rmSrc(it.sid);_closeContextMenu();return;}
    // Broadcast the new state to peers
    if(S.co){ S.co.queueItemUpsert(it); S.co.flushItem(it.sid); }
    _closeContextMenu();
  };
  // Close on click outside
  setTimeout(()=>{
    document.addEventListener('mousedown',_ctxCloseHandler);
  },50);
}

function _ctxCloseHandler(e){
  if(!e.target.closest('.context-menu')) _closeContextMenu();
}

function _closeContextMenu(){
  const m=document.getElementById('ctxMenu');
  if(m)m.remove();
  document.removeEventListener('mousedown',_ctxCloseHandler);
}

function _resetTransform(it){
  const cw=S.cw,ch=S.ch;
  const natAR=it.naturalAR||it.w/it.h;
  const wasRot=((it.rot%360)+360)%360;
  it.rot=0;
  it.flipH=false;
  it.flipV=false;
  it.crop={l:0,t:0,r:0,b:0};
  it.cropMask='none';
  it.frameSettings=JSON.parse(JSON.stringify(framePresets.none));
  // Fit to canvas — if was rotated 90/270, stretch vertically; otherwise horizontally
  if(wasRot===90||wasRot===270){
    it.h=Math.min(ch,cw/natAR);
    it.w=it.h*natAR;
  }else{
    it.w=Math.min(cw,ch*natAR);
    it.h=it.w/natAR;
  }
  it.cx=cw/2;
  it.cy=ch/2;
  it.uncropW=it.w;
  it.uncropH=it.h;
  it.uncropCx=it.cx;
  it.uncropCy=it.cy;
  it.panDx=0;
  it.panDy=0;
  it.prevRect=null;
}

// ═══════════════════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════════════════
//  RENDER — delegates to SBScene
// ═══════════════════════════════════════════════════════════
function render(){SBScene.render();}
function _renderOverlay(cw,ch){SBScene.renderOverlay(cw,ch);}
function _drawBorderGlowOut(c,it){SBScene.drawBorderGlowOut(c,it);}
function _drawBorder(c,it){SBScene.drawBorder(c,it);}
function _roundedRectPath(c,x,y,w,h,r){SBScene.roundedRectPath(c,x,y,w,h,r);}
function _borderPath(c,hw,hh,w,h,isRound,isRounded,rr){SBScene.borderPath(c,hw,hh,w,h,isRound,isRounded,rr);}
function _hexToRGBA(hex,alpha){return SBScene.hexToRGBA(hex,alpha);}
function _hexToHSL(hex){return SBScene.hexToHSL(hex);}
function _hslToHex(h,s,l){return SBScene.hslToHex(h,s,l);}

// ═══════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════
let curType=null,curDevs=[],curMicDevs=[];
function showM(n){SBUi.showM(n,{curType,loadMicList,populateSettings:_populateSettingsModal});}
function hideM(n){SBUi.hideM(n);}

async function _populateSettingsModal(){
  if(!S.settings) await _loadSettings();
  // Active theme
  const theme=(S.settings.ui&&S.settings.ui.theme)||'dark';
  document.querySelectorAll('#themeGrid .theme-tile').forEach(t=>t.classList.toggle('active',t.dataset.theme===theme));
  document.querySelectorAll('#themeGrid .theme-tile').forEach(t=>{
    t.onclick=()=>{
      S.settings.ui.theme=t.dataset.theme;
      document.querySelectorAll('#themeGrid .theme-tile').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      _applyTheme();
      _scheduleSettingsSave();
    };
  });
  if(D.settingsFps){
    D.settingsFps.value=String(S._captureFps||60);
    D.settingsFps.onchange=()=>{
      S._captureFps=parseInt(D.settingsFps.value)||60;
      _scheduleSettingsSave();
    };
  }
  if(D.settingsReducedMotion){
    D.settingsReducedMotion.checked=!!S.reducedMotion;
    D.settingsReducedMotion.onchange=()=>{
      S.reducedMotion=D.settingsReducedMotion.checked;
      _applyTheme();
      _scheduleSettingsSave();
      _markDirty();
    };
  }
  if(D.settingsShowGrid){
    D.settingsShowGrid.checked=!!S.showGrid;
    D.settingsShowGrid.onchange=()=>{S.showGrid=D.settingsShowGrid.checked;_scheduleSettingsSave();_markDirty();};
  }
  if(D.settingsShowSafeArea){
    D.settingsShowSafeArea.checked=!!S.showSafeAreas;
    D.settingsShowSafeArea.onchange=()=>{S.showSafeAreas=D.settingsShowSafeArea.checked;_scheduleSettingsSave();_markDirty();};
  }
  if(D.settingsAppMeta){
    try{
      const v=await window.electronAPI.getAppVersion();
      D.settingsAppMeta.textContent='Версия '+v+' · настройки шифруются (DPAPI на Windows)';
    }catch(e){D.settingsAppMeta.textContent='—';}
  }
}
function msg(m,t='info'){const e=document.createElement('div');e.className='notification '+t;e.textContent=m;D.notifications.appendChild(e);setTimeout(()=>{e.style.opacity='0';e.style.transition='.4s';setTimeout(()=>e.remove(),400);},2000);}

// ═══════════════════════════════════════════════════════════
//  SOURCES (video)
// ═══════════════════════════════════════════════════════════
async function pickType(t){
  curType=t;
  document.querySelectorAll('.source-type-btn').forEach(b=>b.style.borderColor=b.dataset.source===t?'var(--accent)':'var(--glass-border)');
  if(t==='camera') await loadD('videoinput','Камера');
  else if(t==='screen'||t==='window'){
    D.deviceSelector.style.display='block';
    D.deviceSelectorLabel.textContent=t==='screen'?'Захват экрана':'Захват окна';
    // Replace plain <select> with a thumbnail grid
    let host=D.deviceSelector.querySelector('.screen-grid');
    if(!host){host=document.createElement('div');host.className='screen-grid';D.deviceSelector.insertBefore(host,D.btnConfirmSource);D.deviceSelect.style.display='none';}
    host.innerHTML='<div style="grid-column:span 2;color:var(--muted);text-align:center;font-size:11px;padding:18px">Загрузка...</div>';
    try{
      const s=await window.electronAPI.getMediaSources();
      const f=s.filter(x=>x.type===t);
      curDevs=f;
      host.innerHTML='';
      if(!f.length){host.innerHTML='<div style="grid-column:span 2;color:var(--muted);text-align:center;font-size:11px;padding:18px">Нет доступных '+(t==='screen'?'экранов':'окон')+'</div>';return;}
      let chosenIdx=0;
      f.forEach((x,i)=>{
        const tile=document.createElement('div');
        tile.className='screen-tile'+(i===chosenIdx?' selected':'');
        tile.dataset.idx=String(i);
        const thumb=x.thumbnail?`<img class="screen-tile-thumb" src="${x.thumbnail}" alt=""/>`:`<div class="screen-tile-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:11px">нет превью</div>`;
        tile.innerHTML=thumb+`<div class="screen-tile-name" title="${esc(x.name)}">${esc(x.name)}</div>`;
        tile.onclick=()=>{
          chosenIdx=i;
          host.querySelectorAll('.screen-tile').forEach(z=>z.classList.toggle('selected',z===tile));
          D.deviceSelect.value=String(i);
        };
        host.appendChild(tile);
      });
      // sync hidden select for confirmAdd backward compat
      D.deviceSelect.innerHTML='';
      f.forEach((x,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=x.name;D.deviceSelect.appendChild(o);});
      D.deviceSelect.value='0';
    }catch(e){host.innerHTML='<div style="grid-column:span 2;color:var(--red);text-align:center;font-size:11px;padding:18px">Ошибка: '+esc(e.message||String(e))+'</div>';}
  }
}
async function loadD(k,l){
  D.deviceSelector.style.display='block';
  D.deviceSelectorLabel.textContent=l;
  // Show hidden select, hide any previous screen grid
  D.deviceSelect.style.display='';
  const oldGrid=D.deviceSelector.querySelector('.screen-grid');if(oldGrid)oldGrid.remove();
  try{
    let ds;
    try{ds=await navigator.mediaDevices.enumerateDevices();}catch(e){ds=[];}
    let cams=ds.filter(d=>d.kind===k&&d.label);
    if(!cams.length){
      const ts=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
      ts.getTracks().forEach(t=>t.stop());
      ds=await navigator.mediaDevices.enumerateDevices();
      cams=ds.filter(d=>d.kind===k);
    }
    // Mark already-added camera deviceIds (so user can't add same camera twice)
    const usedIds=new Set();
    for(const s of S.srcs){
      if(!s||!s.stream||s.type!=='camera') continue;
      try{
        const t=s.stream.getVideoTracks()[0];
        if(t){
          const st=t.getSettings?.();
          if(st&&st.deviceId) usedIds.add(st.deviceId);
        }
      }catch(_){}
    }
    curDevs=cams;
    D.deviceSelect.innerHTML='';
    curDevs.forEach((d,i)=>{
      const isUsed=usedIds.has(d.deviceId);
      const o=document.createElement('option');
      o.value=String(i);
      o.textContent=(d.label||l+(i+1))+(isUsed?' (уже добавлена)':'');
      o.disabled=isUsed;
      D.deviceSelect.appendChild(o);
    });
    // auto-select first available
    for(let i=0;i<curDevs.length;i++){
      if(!usedIds.has(curDevs[i].deviceId)){D.deviceSelect.value=String(i);break;}
    }
  }catch(e){msg('Нет доступа к камере','error');}
}
let _confirmAddLock=false;
async function confirmAdd(){
  if(_confirmAddLock) return;
  _confirmAddLock=true;
  D.btnConfirmSource.disabled=true;
  try{
  if(!curType)return;
  try{
    let st;
    if(curType==='camera'){
      const i=parseInt(D.deviceSelect.value);
      if(i<0||!curDevs[i]){msg('Выберите камеру','error');return;}
      const d=curDevs[i];
      // Guard: do not add the same camera twice
      const alreadyAdded=S.srcs.some(s=>{
        if(s.type!=='camera'||!s.stream) return false;
        try{const t=s.stream.getVideoTracks()[0];const st=t&&t.getSettings?.();return st&&st.deviceId===d.deviceId;}catch(_){return false;}
      });
      if(alreadyAdded){msg('Эта камера уже добавлена','error');return;}
      st=await navigator.mediaDevices.getUserMedia({
        video:{deviceId:{exact:d.deviceId},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,min:15}},
        audio:false
      });
      addVideoSource('camera',d.label||'Камера',st);
    }else{
      const i=parseInt(D.deviceSelect.value);
      if(i<0||!curDevs[i]){msg('Выберите '+(curType==='screen'?'экран':'окно'),'error');return;}
      const d=curDevs[i];
      try{await window.electronAPI.setPreferredDisplaySource(d.id);}catch(e){}
      st=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{mandatory:{chromeMediaSource:'desktop',chromeMediaSourceId:d.id,maxWidth:3840,maxHeight:2160,maxFrameRate:30}}
      });
      addVideoSource(curType,d.name||(curType==='screen'?'Экран':'Окно'),st);
    }
    hideM('addSource');
    msg('Источник добавлен','success');
  }catch(e){msg('Ошибка доступа: '+(e.message||e),'error');}
  }finally{_confirmAddLock=false;D.btnConfirmSource.disabled=false;}
}

// ═══════════════════════════════════════════════════════════
//  MICROPHONE — dedup by groupId, strip Default/Communications prefix
// ═══════════════════════════════════════════════════════════
async function loadMicList(){
  D.micSelect.innerHTML='<option value="-1">Загрузка...</option>';
  try{
    const ts=await navigator.mediaDevices.getUserMedia({audio:true});
    ts.getTracks().forEach(t=>t.stop());
    const ds=await navigator.mediaDevices.enumerateDevices();
    const all=ds.filter(d=>d.kind==='audioinput');
    if(window.__sbDev) console.log('[Mic] All audio inputs:', all.length, all.map(d=>d.label));
    const groups=new Map();
    for(const d of all){
      const gid=d.groupId||d.deviceId;
      if(!groups.has(gid)||d.label.length>groups.get(gid).label.length) groups.set(gid,d);
    }
    curMicDevs=[...groups.values()];
    // Track already-used mic deviceIds and groupIds (multi-key match for OS dedup)
    const usedIds=new Set(),usedGroups=new Set();
    for(const s of S.srcs){
      if(!s||!s.stream||s.type!=='mic') continue;
      try{
        const t=s.stream.getAudioTracks()[0];
        if(t){
          const st=t.getSettings?.();
          if(st&&st.deviceId) usedIds.add(st.deviceId);
          if(st&&st.groupId) usedGroups.add(st.groupId);
        }
      }catch(_){}
    }
    D.micSelect.innerHTML='';
    if(!curMicDevs.length){D.micSelect.appendChild(Object.assign(document.createElement('option'),{value:'-1',textContent:'Нет микрофонов'}));}
    else{
      curMicDevs.forEach((d,i)=>{
        const isUsed=usedIds.has(d.deviceId)||(d.groupId&&usedGroups.has(d.groupId));
        const o=document.createElement('option');
        o.value=String(i);
        o.textContent=(d.label||('Микрофон '+(i+1)))+(isUsed?' (уже добавлен)':'');
        o.disabled=isUsed;
        D.micSelect.appendChild(o);
      });
      for(let i=0;i<curMicDevs.length;i++){
        const d=curMicDevs[i];
        const isUsed=usedIds.has(d.deviceId)||(d.groupId&&usedGroups.has(d.groupId));
        if(!isUsed){D.micSelect.value=String(i);break;}
      }
    }
  }catch(e){curMicDevs=[];D.micSelect.innerHTML='<option value="-1">Нет доступа</option>';}
}

let _confirmMicLock=false;
async function confirmAddMic(){
  if(_confirmMicLock) return;
  _confirmMicLock=true;
  D.btnConfirmMic.disabled=true;
  try{
  const i=parseInt(D.micSelect.value);if(i<0||!curMicDevs[i]){msg('Выберите микрофон','error');return;}
  const d=curMicDevs[i];
  // Guard: do not add the same microphone twice
  const alreadyAdded=S.srcs.some(s=>{
    if(s.type!=='mic'||!s.stream) return false;
    try{
      const t=s.stream.getAudioTracks()[0];
      const st=t&&t.getSettings?.();
      return st&&(st.deviceId===d.deviceId||(d.groupId&&st.groupId===d.groupId));
    }catch(_){return false;}
  });
  if(alreadyAdded){msg('Этот микрофон уже добавлен','error');return;}
  try{
    const st=await navigator.mediaDevices.getUserMedia({
      audio:{
        deviceId:{exact:d.deviceId},
        echoCancellation:false,
        noiseSuppression:false,
        autoGainControl:false,
        channelCount:{ideal:2}
      },
      video:false
    });
    let l=d.label||'Микрофон';
    addAudioSource('mic',l,st);
    hideM('addMic');
    msg('Микрофон добавлен: '+l,'success');
  }catch(e){msg('Ошибка: '+(e.message||e),'error');}
  }finally{_confirmMicLock=false;D.btnConfirmMic.disabled=false;}
}

let _renameSid=null;
function _showRenameModal(sid){
  const src=S.srcs.find(s=>s.id===sid);
  if(!src) return;
  _renameSid=sid;
  D.renameInput.value=src.name;
  showM('rename');
  setTimeout(()=>{D.renameInput.focus();D.renameInput.select();},50);
}
function _confirmRename(){
  if(!_renameSid) return;
  const src=S.srcs.find(s=>s.id===_renameSid);
  if(!src){hideM('rename');return;}
  const newName=D.renameInput.value.trim();
  if(!newName){msg('Имя не может быть пустым','error');return;}
  if(newName!==src.name){
    src.name=newName;
    renderSources();
    _coSafe(co=>co.broadcastSourceUpdate(src));
    _markDirty();
    _scheduleSettingsSave();
  }
  hideM('rename');
  _renameSid=null;
}

function addVideoSource(type,name,stream,isP=false,pid=null,opts){
  // opts: { gid, ownerPeerId, msid, suppressBroadcast, _existingSrcMeta } for replication
  opts=opts||{};
  const id=opts.gid||_newSid();
  const owner=opts.ownerPeerId|| (isP?pid:S.myPeerId);
  const msid=opts.msid||(stream?stream.id:null);
  const _savedCam=(S.settings&&S.settings.camSettingsByName&&S.settings.camSettingsByName[name])||{};
  const src={id,gid:id,ownerPeerId:owner,name,type,stream,msid,el:null,visible:true,locked:false,vol:1,muted:false,isPeer:isP,peerId:pid,vst:[],monitor:false,camSettings:Object.assign({},SBSources.defaultCamSettings(),_savedCam),fxState:_loadFxStateForName(name)};
  if(stream&&stream.getVideoTracks().length){const v=document.createElement('video');v.srcObject=stream;v.muted=true;v.playsInline=true;v.play().catch(()=>{});src.el=v;}
  SBSources.insertSource(src,isP);
  _p2pLog('[Video] Source added: '+name+' type='+type+' isPeer='+isP+' tracks='+(stream?stream.getVideoTracks().length:0)+' msid='+(msid||'null'));
  if(src.el) addScene(src,!opts.suppressBroadcast); // create item; broadcast unless we're applying a remote op
  _wireTrackEndHandlers(src);
  rebuildZ();renderSources();updateE();_markDirty();
  if(!isP&&S.co&&!opts.suppressBroadcast) S.co.broadcastSourceAdd(src);
  // Send this source's original stream to all connected peers
  // Only queue the stream — don't trigger renegotiate here.
  // _sendSourceStreamsToPeers() will batch-add all streams when connecting to a room,
  // and for sources added mid-session, _addSourceToPeers triggers renegotiate.
  if(!isP&&stream&&stream.getTracks().length&&S.wrtc){
    if(!S._wrtcPrevPerSource) S._wrtcPrevPerSource=new Map();
    S._wrtcPrevPerSource.set(id,stream);
    S.wrtc.localStreams.add(stream);
    // Only add to existing peers and renegotiate if we're in an active P2P session
    if(S.wrtc.peers.size>0){
      _addSourceToPeers(src);
    }
    _p2pLog('[P2P] Video source queued for peers: '+name+' '+type+' msid='+stream.id);
  }
  return id;
}

async function _changeCamResolution(src,w,h,fps){
  try{
    const oldTrack=src.stream&&src.stream.getVideoTracks()[0];
    if(!oldTrack) return;
    const oldSettings=oldTrack.getSettings()||{};
    const deviceId=oldSettings.deviceId;
    try{oldTrack.stop();}catch(_){}
    try{src.stream.removeTrack(oldTrack);}catch(_){}
    const targetFps=fps>0?fps:30;
    const constraints={audio:false,video:{frameRate:{ideal:targetFps,min:10}}};
    if(deviceId) constraints.video.deviceId={exact:deviceId};
    if(w>0&&h>0){constraints.video.width={ideal:w};constraints.video.height={ideal:h};}
    const ns=await navigator.mediaDevices.getUserMedia(constraints);
    const nt=ns.getVideoTracks()[0];
    if(!nt){msg('Не удалось переключить параметры камеры','error');return;}
    ns.removeTrack(nt);
    src.stream.addTrack(nt);
    ns.getTracks().forEach(t=>{try{t.stop();}catch(_){}});
    if(src.el){
      src.el.srcObject=src.stream;
      try{await src.el.play();}catch(_){}
    }
    src._offCv=null;
    const infoEl=document.getElementById('camTrackInfo');
    if(infoEl){
      const ns2=nt.getSettings()||{};
      infoEl.textContent='Камера: '+(ns2.width||'?')+'x'+(ns2.height||'?')+' @ '+Math.round(ns2.frameRate||0)+' fps';
    }
    const desc=[];
    if(w&&h) desc.push(w+'x'+h);
    if(fps>0) desc.push(fps+' fps');
    msg('Камера: '+(desc.length?desc.join(', '):'авто'),'success');
  }catch(e){
    msg('Не удалось применить параметры камеры: '+(e.message||e),'error');
  }
}

// ─── Scene Presets: serialize / load ───

function _serializeScene(name){
  const srcs=S.srcs.map(s=>{
    const vt=s.stream?s.stream.getVideoTracks()[0]:null;
    const at=s.stream?s.stream.getAudioTracks()[0]:null;
    const vs=vt?vt.getSettings():{};
    const as_=at?at.getSettings():{};
    return {
      type:s.type, name:s.name, gid:s.gid,
      vol:s.vol, muted:s.muted, visible:s.visible, locked:s.locked,
      monitor:s.monitor, channelMode:s.channelMode||'auto',
      fxState:s.fxState?{...s.fxState}:null,
      camSettings:s.camSettings?{...s.camSettings}:null,
      deviceId:vs.deviceId||null,
      audioDeviceId:as_.deviceId||null,
      deviceIdLabel:vs.deviceId?null:null, // will fill below
      isPeer:s.isPeer||false, peerId:s.peerId||null,
    };
  });
  // Try to get device labels for better restoration
  srcs.forEach(s=>{
    if(s.deviceId){
      const dev=S._lastDeviceList?S._lastDeviceList.find(d=>d.deviceId===s.deviceId):null;
      if(dev) s.deviceIdLabel=dev.label||null;
    }
    if(s.audioDeviceId){
      const dev=S._lastAudioDeviceList?S._lastAudioDeviceList.find(d=>d.deviceId===s.audioDeviceId):null;
      if(dev) s.audioDeviceIdLabel=dev.label||null;
    }
  });
  const items=S.items.map(it=>{
    const src=S.srcs.find(s=>s.id===it.sid);
    return {
      srcName:src?src.name:null,
      cx:it.cx, cy:it.cy, w:it.w, h:it.h,
      rot:it.rot, flipH:it.flipH, flipV:it.flipV, z:it.z,
      crop:{...it.crop}, cropMask:it.cropMask||'none',
      frameSettings:it.frameSettings?JSON.parse(JSON.stringify(it.frameSettings)):null,
      uncropW:it.uncropW, uncropH:it.uncropH, uncropCx:it.uncropCx, uncropCy:it.uncropCy,
      panDx:it.panDx||0, panDy:it.panDy||0,
    };
  });
  return {
    name,
    version:2,
    srcs,
    items,
    canvasW:S.cw, canvasH:S.ch,
    createdAt:Date.now(),
  };
}

async function _loadScenePreset(preset){
  if(!preset||!preset.srcs){if(window.__sbDev)console.log('[ScenePreset] _loadScenePreset: invalid preset');return;}
  if(window.__sbDev) console.log('[ScenePreset] _loadScenePreset: starting fade-out, srcs:',preset.srcs.length,'items:',preset.items.length);
  // Fade out current scene
  S._sceneTransition={phase:'out',alpha:1,targetPreset:preset,start:performance.now()};
  _markDirty();
}

async function _applyScenePreset(preset){
  if(window.__sbDev) console.log('[ScenePreset] _applyScenePreset starting, preset srcs:',preset.srcs.length,'items:',preset.items.length);
  // Build name→itemData lookup
  const itemMap=new Map();
  for(const itData of (preset.items||[])){
    if(itData.srcName) itemMap.set(itData.srcName,itData);
  }
  // Build name→srcData lookup from preset
  const srcDataMap=new Map();
  for(const sData of preset.srcs){
    if(!sData.isPeer && sData.name) srcDataMap.set(sData.name,sData);
  }
  // 1) Remove sources NOT in preset (that aren't peer-owned)
  const toRemove=S.srcs.filter(s=>!s.isPeer && !srcDataMap.has(s.name));
  for(const s of toRemove) rmSrc(s.id);
  // 2) For sources that already exist — just update settings + item position
  //    For sources that don't exist yet — create them
  for(const sData of preset.srcs){
    if(sData.isPeer) continue;
    const existing=S.srcs.find(s=>s.name===sData.name&&!s.isPeer&&s.type===sData.type);
    if(existing){
      // Source already exists — update its settings
      if(sData.vol!==undefined) existing.vol=sData.vol;
      if(sData.muted!==undefined) existing.muted=sData.muted;
      if(sData.visible!==undefined) existing.visible=sData.visible;
      if(sData.locked!==undefined) existing.locked=sData.locked;
      if(sData.fxState){existing.fxState={...sData.fxState};S.audioEffects.set(existing.id,{...sData.fxState});}
      if(sData.camSettings){existing.camSettings={...sData.camSettings};}
      if(sData.channelMode) existing.channelMode=sData.channelMode;
      if(existing.fxState) SBAudio._applyFxState(existing.id);
      // Update existing item position
      const itData=itemMap.get(sData.name);
      const item=S.items.find(i=>i.sid===existing.id);
      if(item&&itData){
        item.cx=itData.cx;item.cy=itData.cy;
        item.w=itData.w;item.h=itData.h;
        item.rot=itData.rot||0;item.flipH=itData.flipH||false;item.flipV=itData.flipV||false;
        if(itData.crop) item.crop={...itData.crop};
        if(itData.cropMask) item.cropMask=itData.cropMask;
        if(itData.frameSettings) item.frameSettings=itData.frameSettings;
        item.uncropW=itData.uncropW||itData.w;
        item.uncropH=itData.uncropH||itData.h;
        item.uncropCx=itData.uncropCx||itData.cx;
        item.uncropCy=itData.uncropCy||itData.cy;
        item.panDx=itData.panDx||0;
        item.panDy=itData.panDy||0;
      }
    }else{
      // Source doesn't exist — create it
      let newSrcId=null;
      if(sData.type==='desktop'){
        try{
          const ds=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
          newSrcId=addVideoSource(sData.type,sData.name||'Desktop',ds,null,false,null);
        }catch(e){if(window.__sbDev)console.warn('[ScenePreset] desktop capture failed:',e);}
      }else if(sData.type==='camera'){
        try{
          const constraints={video:true,audio:false};
          if(sData.deviceId) constraints.video={deviceId:{ideal:sData.deviceId}};
          else if(sData.camSettings&&sData.camSettings.resolution){
            const [w,h]=sData.camSettings.resolution.split('x').map(Number);
            if(w&&h) constraints.video={width:{ideal:w},height:{ideal:h}};
          }
          const ms=await navigator.mediaDevices.getUserMedia(constraints);
          newSrcId=addVideoSource('camera',sData.name||'Camera',ms,null,false,null);
        }catch(e){msg('Камера '+(sData.name||'Camera')+' не найдена','error');}
      }else if(sData.type==='image'){
        newSrcId=addVideoSource('image',sData.name||'Image',null,null,false,null);
      }else if(sData.type==='mic'){
        try{
          const constraints={audio:true};
          if(sData.audioDeviceId) constraints.audio={deviceId:{ideal:sData.audioDeviceId}};
          const ms=await navigator.mediaDevices.getUserMedia(constraints);
          newSrcId=addAudioSource('mic',sData.name||'Микрофон',ms);
        }catch(e){msg('Микрофон '+(sData.name||'Микрофон')+' не найден','error');}
      }
      // Apply settings + item position for new source
      if(newSrcId){
        const src=S.srcs.find(s=>s.id===newSrcId);
        if(src){
          if(sData.vol!==undefined) src.vol=sData.vol;
          if(sData.muted!==undefined) src.muted=sData.muted;
          if(sData.visible!==undefined) src.visible=sData.visible;
          if(sData.locked!==undefined) src.locked=sData.locked;
          if(sData.fxState){src.fxState={...sData.fxState};S.audioEffects.set(src.id,{...sData.fxState});}
          if(sData.camSettings){src.camSettings={...sData.camSettings};}
          if(sData.channelMode) src.channelMode=sData.channelMode;
          if(src.fxState) SBAudio._applyFxState(src.id);
        }
        const itData=itemMap.get(sData.name);
        const item=S.items.find(i=>i.sid===newSrcId);
        if(item&&itData){
          item.cx=itData.cx;item.cy=itData.cy;
          item.w=itData.w;item.h=itData.h;
          item.rot=itData.rot||0;item.flipH=itData.flipH||false;item.flipV=itData.flipV||false;
          if(itData.crop) item.crop={...itData.crop};
          if(itData.cropMask) item.cropMask=itData.cropMask;
          if(itData.frameSettings) item.frameSettings=itData.frameSettings;
          item.uncropW=itData.uncropW||itData.w;
          item.uncropH=itData.uncropH||itData.h;
          item.uncropCx=itData.uncropCx||itData.cx;
          item.uncropCy=itData.uncropCy||itData.cy;
          item.panDx=itData.panDx||0;
          item.panDy=itData.panDy||0;
        }
      }
    }
  }
  rebuildZ();
  _markDirty();
  renderSources();
  renderMixer();
  updateE();
  _coSafe(co=>co.broadcastSourceUpdate());
}

function _saveScenePreset(name){
  const preset=_serializeScene(name);
  if(window.__sbDev) console.log('[ScenePreset] Saving:',name,'srcs:',preset.srcs.length,'items:',preset.items.length);
  if(!S.settings.scenePresets) S.settings.scenePresets=[];
  // Update if exists, else add
  const idx=S.settings.scenePresets.findIndex(p=>p.name===name);
  if(idx>=0) S.settings.scenePresets[idx]=preset;
  else S.settings.scenePresets.push(preset);
  if(window.__sbDev) console.log('[ScenePreset] Saved, total:',S.settings.scenePresets.length,'calling _scheduleSettingsSave');
  _scheduleSettingsSave();
  _renderScenePresetsList();
  msg('Сцена «'+name+'» сохранена','success');
}

function _deleteScenePreset(name){
  if(!S.settings.scenePresets) return;
  S.settings.scenePresets=S.settings.scenePresets.filter(p=>p.name!==name);
  _scheduleSettingsSave();
  _renderScenePresetsList();
}

function _initScenePresets(){
  const saveBtn=document.getElementById('scenePresetSaveBtn');
  const nameInput=document.getElementById('scenePresetNameInput');
  if(window.__sbDev) console.log('[ScenePresets] Init: saveBtn=',!!saveBtn,'nameInput=',!!nameInput);
  // Save button (icon in header)
  if(saveBtn){
    saveBtn.onclick=()=>{
      if(window.__sbDev) console.log('[ScenePresets] Save button clicked!');
      let name=nameInput&&nameInput.value.trim();
      if(!name){
        const num=(S.settings.scenePresets||[]).length+1;
        name='Сцена '+num;
      }
      _saveScenePreset(name);
      if(nameInput) nameInput.value='';
    };
  }
  if(nameInput){
    nameInput.onkeydown=(e)=>{if(e.key==='Enter'&&saveBtn)saveBtn.click();};
  }
  _renderScenePresetsList();
}

function _renderScenePresetsList(){
  const list=document.getElementById('scenePresetsList');
  if(!list) return;
  const presets=S.settings.scenePresets||[];
  if(!presets.length){
    list.innerHTML='<div style="font-size:10px;color:var(--muted);padding:4px">Нет сохранённых сцен</div>';
    return;
  }
  list.innerHTML=presets.map(p=>`
    <div class="scene-preset-item" data-scene="${esc(p.name)}">
      <span class="scene-preset-name">${esc(p.name)}</span>
      <button class="scene-preset-load" title="Загрузить" data-load="${esc(p.name)}">▸</button>
      <button class="scene-preset-del" title="Удалить" data-del="${esc(p.name)}">✕</button>
    </div>
  `).join('');
  // Wire handlers
  list.querySelectorAll('.scene-preset-load').forEach(btn=>{
    btn.onclick=(e)=>{e.stopPropagation();const n=btn.dataset.load;const p=S.settings.scenePresets.find(p=>p.name===n);if(p)_loadScenePreset(p);};
  });
  list.querySelectorAll('.scene-preset-del').forEach(btn=>{
    btn.onclick=(e)=>{e.stopPropagation();_deleteScenePreset(btn.dataset.del);};
  });
  list.querySelectorAll('.scene-preset-item').forEach(el=>{
    el.onclick=()=>{const n=el.dataset.scene;const p=S.settings.scenePresets.find(p=>p.name===n);if(p)_loadScenePreset(p);};
  });
}

function rmSrc(sid,opts){
  opts=opts||{};
  const i=S.srcs.findIndex(s=>s.id===sid);if(i===-1)return;const s=S.srcs[i];
  _disconnectSource(sid);
  // Clean up GL texture for this source
  if(S._useGL && S.gl) S.gl.removeSource(sid);
  // Save source data for Ctrl+Z restore before stopping tracks
  const savedItem=S.items.find(x=>x.sid===sid);
  const restoreData=SBSources.buildRestoreData(s,savedItem);
  // Remove tracks from WebRTC PeerConnection if this is our local source
  if(s.stream&&!s.isPeer&&S.wrtc){
    try{ _removeSourceTracksFromPeers(s); }catch(e){ if(window.__sbDev) console.warn('[rmSrc] WebRTC remove tracks failed:',e); }
  }
  // Don't stop peer-owned tracks (they belong to the friend's MediaStream)
  if(s.stream&&!s.isPeer)s.stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});
  if(s.el){s.el.srcObject=null;s.el=null;}
  if(sid===S.desktopAudioId){ S.desktopAudioId=null; SBAudio._updatePeerMonitorRouting(); }
  if(S.settings.camSettingsByName&&s.name){delete S.settings.camSettingsByName[s.name];_scheduleSettingsSave();}
  // Clean up offscreen canvas for cam effects
  if(s._offCv){s._offCv=null;}
  // Clean up dedup tracking for this source's stream
  if(s.msid) S._handledPeerStreams.delete(s.msid);
  S.items=S.items.filter(x=>x.sid!==sid);S.srcs.splice(i,1);
  if(S.selId===sid){S.selId=null;S.selItem=null;}
  // Push undo entry with delete-source data
  S._undoStack.push({label:'удаление «'+s.name+'»',type:'delete-source',restore:restoreData,t:Date.now()});
  while(S._undoStack.length>S._undoMax) S._undoStack.shift();
  rebuildZ();renderSources();renderMixer();updateE();_markDirty();
  // Broadcast removal — only when triggered by local action (not from remote src.remove op)
  // opts.fromRemote=true means this deletion came from a CoScene src.remove → no echo
  // opts.fromRecreate=true means this deletion is for re-creation (e.g. WASAPI device change) → no broadcast
  if(S.co&&!_isRemote()&&!opts.fromRemote&&!opts.fromRecreate) S.co.broadcastSourceRemove(sid);
}
function togVis(sid){const s=S.srcs.find(x=>x.id===sid);if(s){s.visible=!s.visible;renderSources();updateE();_markDirty();_coSafe(co=>co.broadcastSourceUpdate(s));}}
function togLock(sid){const s=S.srcs.find(x=>x.id===sid);if(!s)return;const locked=SBSources.toggleLock(s);rebuildZ();renderSources();msg(locked?'Источник заблокирован':'Источник разблокирован','info');_markDirty();_coSafe(co=>co.broadcastSourceUpdate(s));}
function selSrc(sid){
  const s=S.srcs.find(x=>x.id===sid);
  if(s&&s.locked){msg('Источник заблокирован — снимите блокировку для редактирования','info');return;}
  S.selId=sid;S.selItem=sid;renderSources();
}
function addScene(src,broadcast){
  // If an item for this src already exists (e.g. applied from remote snapshot), don't duplicate.
  if(S.items.some(x=>x.sid===src.id)) return;
  const cw=S.cw,ch=S.ch;const ex=S.items.filter(x=>S.srcs.find(s=>s.id===x.sid&&s.el));
  const isDisplay=(src.type==='screen'||src.type==='window'||src.type==='desktop');
  let w,h,cx,cy;
  if(!ex.length||isDisplay){cx=cw/2;cy=ch/2;w=cw;h=ch;}else{w=cw*.3;h=ch*.3;cx=cw-w/2-10;cy=ch-h/2-10;}
  const it={sid:src.id,cx,cy,w,h,z:0,rot:0,flipH:false,flipV:false,crop:{l:0,t:0,r:0,b:0},cropMask:'none',frameSettings:JSON.parse(JSON.stringify(framePresets.none)),uncropW:w,uncropH:h,uncropCx:cx,uncropCy:cy,origVW:0,origVH:0,naturalAR:w/h,prevRect:null,panDx:0,panDy:0};
  S.items.push(it);
  if(src.el){const r=()=>{it.origVW=src.el.videoWidth||1920;it.origVH=src.el.videoHeight||1080;it.naturalAR=it.origVW/it.origVH;};if(src.el.readyState>=1)r();else src.el.onloadedmetadata=r;}
  if(broadcast!==false&&S.co&&!_isRemote()) S.co.queueItemUpsert(it);
}
function updateE(){SBUi.updateEmpty();}

function renderSources(){
  D.sourcesList.innerHTML='';
  S.srcs.filter(s=>s.el).forEach((s,idx)=>{
    const el=document.createElement('div');
    el.className='source-item'+(s.id===S.selId?' selected':'')+(s.isPeer?' peer-src':'')+(!s.visible?' hidden-src':'')+(s.locked?' locked-src':'');
    el.dataset.sid=s.id;
    el.draggable=!s.locked;
    const ic=s.visible?'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>':'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
    const lockSvg=s.locked?'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>':'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>';
    const tl={camera:'Камера',screen:'Экран',window:'Окно'}[s.type]||s.type;
    const gearBtn=s.el?`<button class="btn-icon" data-a="cam" title="Настройки источника"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>`:'';
    const typeIcon={camera:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',screen:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',window:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="10" y1="21" x2="14" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>','peer-video':'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'}[s.type]||'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/></svg>';
    el.innerHTML=`<span class="source-order">${idx+1}</span>
      <div class="source-icon">${typeIcon}</div>
      <div class="source-info"><div class="source-name">${esc(s.name)}</div><div class="source-type">${tl}${s.isPeer?' (друг)':''}${s.locked?' · 🔒':''}</div></div>
      <div class="source-actions">
        <button class="btn-icon" data-a="rename" title="Переименовать"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg></button>
        ${gearBtn}
        <button class="btn-icon ${s.locked?'locked':''}" data-a="lock" title="${s.locked?'Разблокировать':'Заблокировать'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${lockSvg}</svg></button>
        <button class="btn-icon ${!s.visible?'':'toggle-on'}" data-a="tog" title="${s.visible?'Скрыть':'Показать'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ic}</svg></button>
        <button class="btn-icon" data-a="del" title="Удалить"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>`;
    D.sourcesList.appendChild(el);
  });
}

// ═══════════════════════════════════════════════════════════
//  MIXER
// ═══════════════════════════════════════════════════════════
function renderMixer(){
  D.audioMixer.innerHTML='';
  _showDesktopAudioFader();
  for(const s of S.srcs){
    if(!s.stream||!s.stream.getAudioTracks().length)continue;
    if(s.id===S.desktopAudioId)continue;
    addMixerCh(s);
  }
  _ensureLevelsLoop();
}

function addMixerCh(s){
  const isD=s.id===S.desktopAudioId;
  const el=document.createElement('div');el.className='audio-channel';if(isD)el.classList.add('desktop-audio');
  const mi=s.muted?'<line x1="1" y1="1" x2="23" y2="23"/>':'<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/>';
  const ti=isD?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>':'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>';
  const showChMode=s.type==='mic'||(s.type==='desktop')||isD;
  const chMode=s.channelMode||'auto';
  const chLbl=chMode==='mono'?'M':(chMode==='stereo'?'S':'A');
  const chTitle=chMode==='mono'?'Моно (L+R = центр)':(chMode==='stereo'?'Стерео (L/R как есть)':'Авто (моно → центр)');
  const chBtn=showChMode?`<button class="btn-icon ch-mode-btn" data-chmode="${s.id}" title="${chTitle}" style="font-weight:600;font-size:9px;width:18px">${chLbl}</button>`:'';
  el.innerHTML=`<div class="audio-channel-row"><span class="audio-channel-icon">${ti}</span><span class="audio-channel-name">${esc(s.name)}</span><div class="audio-controls"><div class="audio-fader-row"><input type="range" class="audio-slider" min="0" max="100" value="${Math.round(s.vol*100)}"/><span class="audio-db">${s.muted?'MUTE':Math.round(s.vol*100)+'%'}</span></div><div class="level-meter-h-wrap"><div class="level-meter-h"><div class="level-meter-fill-h" id="lv_${s.id}" style="width:0%"></div></div><div class="level-db-scale"><span>-60</span><span>-30</span><span>-18</span><span>-9</span><span>0</span></div></div></div><div class="audio-btns"><button class="btn-icon ${s.muted?'muted':''}" data-mid="${s.id}" title="Mute"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${mi}</svg></button><button class="btn-icon ${s.monitor?'monitoring':''}" data-monid="${s.id}" title="Мониторинг"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></button>${chBtn}<button class="btn-icon ${_hasFx(s.id)?'fx-active':''}" data-fxid="${s.id}" title="FX"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="12" cy="6" r="3"/><line x1="8.5" y1="16" x2="10.5" y2="8"/><line x1="15.5" y1="16" x2="13.5" y2="8"/></svg></button>${!isD?`<button class="btn-icon" data-mdel="${s.id}" title="Удалить"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>`:''}</div></div>`;
  el.querySelector('.audio-slider').oninput=ev=>{s.vol=parseInt(ev.target.value)/100;el.querySelector('.audio-db').textContent=s.muted?'MUTE':Math.round(s.vol*100)+'%';_updateGain(s);_coBroadcastSrcUpdateDebounced(s,150);};
  const sl=el.querySelector('.audio-slider');sl._dragging=false;
  sl.addEventListener('mousedown',()=>{sl._dragging=true;});
  sl.addEventListener('mouseup',()=>{sl._dragging=false;});
  sl.addEventListener('touchstart',()=>{sl._dragging=true;});
  sl.addEventListener('touchend',()=>{sl._dragging=false;});
  el.querySelector('[data-mid="'+s.id+'"]').onclick=()=>{s.muted=!s.muted;_updateGain(s);renderMixer();_coSafe(co=>co.broadcastSourceUpdate(s));};
  el.querySelector('[data-monid="'+s.id+'"]').onclick=()=>{
    s.monitor=!s.monitor;
    _updateGain(s);
    el.querySelector('[data-monid="'+s.id+'"]').classList.toggle('monitoring',s.monitor);
    _resumeAudioCtx();
    console.log('[Audio] Monitor toggle:',s.name,'monitor='+s.monitor);
    msg(s.monitor?'Мониторинг вкл — звук идёт в колонки':'Мониторинг выкл','info');
    // Monitor is local-only — DO NOT replicate to peers (each side decides for itself
    // whether they want to hear a source through their speakers).
  };
  const db=el.querySelector('[data-mdel="'+s.id+'"]');if(db)db.onclick=()=>rmSrc(s.id);
  const fxBtn=el.querySelector('[data-fxid="'+s.id+'"]');
  if(fxBtn)fxBtn.onclick=()=>_showFxModal(s.id);
  const chBtnEl=el.querySelector('[data-chmode="'+s.id+'"]');
  if(chBtnEl)chBtnEl.onclick=async()=>{
    const cycle={auto:'mono',mono:'stereo',stereo:'auto'};
    s.channelMode=cycle[s.channelMode||'auto'];
    // Rebuild audio chain so new channel routing takes effect
    _disconnectSource(s.id);
    await _connectSource(s);
    _rebuildCombinedStream();
    _scheduleSettingsSave();
    renderMixer();
    msg('Канал: '+(s.channelMode==='mono'?'Моно':s.channelMode==='stereo'?'Стерео':'Авто'),'info');
    _coSafe(co=>co.broadcastSourceUpdate());
  };
  D.audioMixer.appendChild(el);
}


// ═══════════════════════════════════════════════════════════
//  AUDIO EFFECTS — _showFxModal remains in app.js (heavy DOM)
//  _applyFxState, _hasFx, _dbToLinear, _toDb → SBAudio delegates above
// ═══════════════════════════════════════════════════════════
function _showFxModal(srcId){
  const src=S.srcs.find(s=>s.id===srcId);
  if(!src) return;
  // Always read from src.fxState (persisted)
  let fx=src.fxState||{noiseGate:false,eq:false,compressor:false,limiter:false,
    eqLow:0,eqMid:0,eqHigh:0,compThresh:-24,compRatio:4,compGain:6,gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150,limThresh:-3};

  const old=document.getElementById('fxModal');if(old)old.remove();

  const modal=document.createElement('div');
  modal.className='modal-overlay';modal.id='fxModal';modal.style.display='flex';

  const gateOn=fx.noiseGate;
  const eqOn=fx.eq;
  const compOn=fx.compressor;
  const limOn=fx.limiter;

  modal.innerHTML=`<div class="modal glass" style="width:420px">
    <div class="modal-header"><h2>${esc(src.name)}</h2>
    <button class="btn-icon" id="btnCloseFx"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body fx-body">
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Шумоподавление</span><button class="fx-toggle ${gateOn?'on':''}" id="fxGate">${gateOn?'ВКЛ':'ВЫКЛ'}</button></div>
        <div class="fx-params">
          <div class="fx-row" style="gap:6px">
            <button class="btn fx-preset-btn${fx.gateThresh===-30&&fx.gateRange===-20?' active':''}" data-preset="light">Лёгкое</button>
            <button class="btn fx-preset-btn${fx.gateThresh===-40&&fx.gateRange===-40?' active':''}" data-preset="medium">Среднее</button>
            <button class="btn fx-preset-btn${fx.gateThresh===-50&&fx.gateRange===-60?' active':''}" data-preset="heavy">Сильное</button>
            <button class="btn fx-preset-btn${fx.gateThresh===-55&&fx.gateRange===-80?' active':''}" data-preset="mute">Заглушение</button>
          </div>
          <div class="fx-row"><span class="fx-label">Порог</span><input type="range" class="fx-slider" id="fxGateThresh" min="-80" max="-10" value="${fx.gateThresh}" step="1"/><span class="fx-val" id="fxGateThreshVal">${fx.gateThresh}dB</span></div>
          <div class="fx-row"><span class="fx-label">Глубина</span><input type="range" class="fx-slider" id="fxGateRange" min="-80" max="-6" value="${fx.gateRange}" step="1"/><span class="fx-val" id="fxGateRangeVal">${fx.gateRange}dB</span></div>
          <div class="fx-row"><span class="fx-label">Атака</span><input type="range" class="fx-slider" id="fxGateAttack" min="1" max="100" value="${fx.gateAttack}" step="1"/><span class="fx-val" id="fxGateAttackVal">${fx.gateAttack}мс</span></div>
          <div class="fx-row"><span class="fx-label">Удерж.</span><input type="range" class="fx-slider" id="fxGateHold" min="10" max="500" value="${fx.gateHold}" step="10"/><span class="fx-val" id="fxGateHoldVal">${fx.gateHold}мс</span></div>
          <div class="fx-row"><span class="fx-label">Спад</span><input type="range" class="fx-slider" id="fxGateRelease" min="20" max="500" value="${fx.gateRelease}" step="10"/><span class="fx-val" id="fxGateReleaseVal">${fx.gateRelease}мс</span></div>
          <div class="fx-row" style="align-items:center;gap:8px">
            <span class="fx-label" style="flex:1">Состояние</span>
            <span style="font-size:10px" id="fxGateState">—</span>
          </div>
          <div class="fx-row" style="align-items:center;gap:8px">
            <span class="fx-label" style="flex:1">Уровень сигнала</span>
            <div style="width:80px;height:6px;border-radius:3px;background:var(--bg1);overflow:hidden;position:relative">
              <div id="fxGateLevel" style="height:100%;width:0%;border-radius:3px;transition:width 0.15s;background:#86efac"></div>
            </div>
            <span style="font-size:9px;color:var(--muted);min-width:32px" id="fxGateLevelDb">—</span>
          </div>
        </div>
      </div>
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Эквалайзер</span><button class="fx-toggle ${eqOn?'on':''}" id="fxEq">${eqOn?'ВКЛ':'ВЫКЛ'}</button></div>
        <div class="fx-params">
          <div class="fx-row" style="gap:6px">
            <button class="btn fx-preset-btn fx-eq-preset${fx.eqLow===3&&fx.eqMid===0&&fx.eqHigh===-2?' active':''}" data-eqpreset="warm">Тёплый</button>
            <button class="btn fx-preset-btn fx-eq-preset${fx.eqLow===-2&&fx.eqMid===0&&fx.eqHigh===4?' active':''}" data-eqpreset="bright">Яркий</button>
            <button class="btn fx-preset-btn fx-eq-preset${fx.eqLow===0&&fx.eqMid===-4&&fx.eqHigh===0?' active':''}" data-eqpreset="midcut">Убрать сер.</button>
            <button class="btn fx-preset-btn fx-eq-preset${fx.eqLow===-6&&fx.eqMid===2&&fx.eqHigh===4?' active':''}" data-eqpreset="vocal">Голос</button>
          </div>
          <div class="fx-row"><span class="fx-label">Низкие</span><input type="range" class="fx-slider" id="fxEqLow" min="-12" max="12" value="${fx.eqLow}" step="1"/><span class="fx-val" id="fxEqLowVal">${fx.eqLow>0?'+':''}${fx.eqLow}dB</span></div>
          <div class="fx-row"><span class="fx-label">Средние</span><input type="range" class="fx-slider" id="fxEqMid" min="-12" max="12" value="${fx.eqMid}" step="1"/><span class="fx-val" id="fxEqMidVal">${fx.eqMid>0?'+':''}${fx.eqMid}dB</span></div>
          <div class="fx-row"><span class="fx-label">Высокие</span><input type="range" class="fx-slider" id="fxEqHigh" min="-12" max="12" value="${fx.eqHigh}" step="1"/><span class="fx-val" id="fxEqHighVal">${fx.eqHigh>0?'+':''}${fx.eqHigh}dB</span></div>
        </div>
      </div>
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Компрессор</span><button class="fx-toggle ${compOn?'on':''}" id="fxComp">${compOn?'ВКЛ':'ВЫКЛ'}</button></div>
        <div class="fx-params">
          <div class="fx-row" style="gap:6px">
            <button class="btn fx-preset-btn fx-comp-preset${fx.compThresh===-18&&fx.compRatio===3&&fx.compGain===6?' active':''}" data-comppreset="gentle">Мягкий</button>
            <button class="btn fx-preset-btn fx-comp-preset${fx.compThresh===-24&&fx.compRatio===4&&fx.compGain===8?' active':''}" data-comppreset="vocal">Голос</button>
            <button class="btn fx-preset-btn fx-comp-preset${fx.compThresh===-30&&fx.compRatio===6&&fx.compGain===12?' active':''}" data-comppreset="heavy">Сильный</button>
          </div>
          <div class="fx-row"><span class="fx-label">Порог</span><input type="range" class="fx-slider" id="fxCompThresh" min="-60" max="0" value="${fx.compThresh}" step="1"/><span class="fx-val" id="fxCompThreshVal">${fx.compThresh}dB</span></div>
          <div class="fx-row"><span class="fx-label">Соотн.</span><input type="range" class="fx-slider" id="fxCompRatio" min="1" max="20" value="${fx.compRatio}" step="0.5"/><span class="fx-val" id="fxCompRatioVal">${fx.compRatio}:1</span></div>
          <div class="fx-row"><span class="fx-label">Усилен.</span><input type="range" class="fx-slider" id="fxCompGain" min="0" max="30" value="${fx.compGain}" step="1"/><span class="fx-val" id="fxCompGainVal">+${fx.compGain}dB</span></div>
        </div>
      </div>
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Лимитер</span><button class="fx-toggle ${limOn?'on':''}" id="fxLimiter">${limOn?'ВКЛ':'ВЫКЛ'}</button></div>
        <div class="fx-params">
          <div class="fx-row"><span class="fx-label">Порог</span><input type="range" class="fx-slider" id="fxLimThresh" min="-12" max="0" value="${fx.limThresh||-3}" step="1"/><span class="fx-val" id="fxLimThreshVal">${fx.limThresh||-3}dB</span></div>
        </div>
      </div>
      <div style="text-align:right;margin-top:4px"><button class="btn" id="btnFxReset">Сброс</button></div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Force re-apply all FX state to audio nodes when opening the modal
  // This fixes the issue where FX settings appear to "stop working" after a while
  _applyFxState(srcId);
  // Sync gate state to AudioWorklet on modal open
  {
    const n=S.audioNodes.get(srcId);
    if(n && n.effectsChain && n.effectsChain.gateNode && n.effectsChain.gateNode.port){
      const fx=src.fxState;
      n.effectsChain.gateNode.port.postMessage({
        enabled: fx.noiseGate||false,
        thresh:  fx.gateThresh||-40,
        range:   fx.gateRange||-40,
        attack:  (fx.gateAttack||10)/1000,
        hold:    (fx.gateHold||100)/1000,
        release: (fx.gateRelease||150)/1000,
      });
    }
  }

  document.getElementById('btnCloseFx').onclick=()=>{modal.remove();_saveFxFromModal(srcId);};
  modal.onclick=e=>{if(e.target===modal){modal.remove();_saveFxFromModal(srcId);}};

  // Reset button
  document.getElementById('btnFxReset').onclick=()=>{
    document.getElementById('fxGate').textContent='ВЫКЛ';
    document.getElementById('fxGate').className='fx-toggle';
    document.getElementById('fxGateThresh').value=-40;
    document.getElementById('fxGateThreshVal').textContent='-40dB';
    document.getElementById('fxGateRange').value=-40;
    document.getElementById('fxGateRangeVal').textContent='-40dB';
    document.getElementById('fxGateAttack').value=10;
    document.getElementById('fxGateAttackVal').textContent='10мс';
    document.getElementById('fxGateHold').value=100;
    document.getElementById('fxGateHoldVal').textContent='100мс';
    document.getElementById('fxGateRelease').value=150;
    document.getElementById('fxGateReleaseVal').textContent='150мс';
    document.querySelectorAll('.fx-preset-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('fxEq').textContent='ВЫКЛ';
    document.getElementById('fxEq').className='fx-toggle';
    document.getElementById('fxEqLow').value=0;
    document.getElementById('fxEqMid').value=0;
    document.getElementById('fxEqHigh').value=0;
    document.getElementById('fxEqLowVal').textContent='0dB';
    document.getElementById('fxEqMidVal').textContent='0dB';
    document.getElementById('fxEqHighVal').textContent='0dB';
    document.querySelectorAll('.fx-eq-preset').forEach(b=>b.classList.remove('active'));
    document.getElementById('fxComp').textContent='ВЫКЛ';
    document.getElementById('fxComp').className='fx-toggle';
    document.getElementById('fxCompThresh').value=-24;
    document.getElementById('fxCompRatio').value=4;
    document.getElementById('fxCompGain').value=6;
    document.getElementById('fxCompThreshVal').textContent='-24dB';
    document.getElementById('fxCompRatioVal').textContent='4:1';
    document.getElementById('fxCompGainVal').textContent='+6dB';
    document.querySelectorAll('.fx-comp-preset').forEach(b=>b.classList.remove('active'));
    document.getElementById('fxLimiter').textContent='ВЫКЛ';
    document.getElementById('fxLimiter').className='fx-toggle';
    document.getElementById('fxLimThresh').value=-3;
    document.getElementById('fxLimThreshVal').textContent='-3dB';
    liveUpdate();
  };

  const liveUpdate=()=>{
    const n=S.audioNodes.get(srcId);
    if(!n) return;
    const c=n.effectsChain;
    const ctx=S.audioCtx;
    if(!ctx) return;
    const t=ctx.currentTime;

    // Gate
    const gateOn=document.getElementById('fxGate').classList.contains('on');
    const gateThreshV=parseInt(document.getElementById('fxGateThresh').value);
    const gateRangeV=parseInt(document.getElementById('fxGateRange').value);
    const gateAttackV=parseInt(document.getElementById('fxGateAttack').value);
    const gateHoldV=parseInt(document.getElementById('fxGateHold').value);
    const gateReleaseV=parseInt(document.getElementById('fxGateRelease').value);
    // Update fxState and push to AudioWorkletNode in real-time
    src.fxState.noiseGate=gateOn;
    src.fxState.gateThresh=gateThreshV;
    src.fxState.gateRange=gateRangeV;
    src.fxState.gateAttack=gateAttackV;
    src.fxState.gateHold=gateHoldV;
    src.fxState.gateRelease=gateReleaseV;
    {const _n=S.audioNodes.get(srcId);
     if(_n&&_n.effectsChain&&_n.effectsChain.gateNode&&_n.effectsChain.gateNode.port)
       _n.effectsChain.gateNode.port.postMessage({enabled:gateOn,thresh:gateThreshV,range:gateRangeV,attack:gateAttackV/1000,hold:gateHoldV/1000,release:gateReleaseV/1000});}
    document.getElementById('fxGateThreshVal').textContent=gateThreshV+'dB';
    document.getElementById('fxGateRangeVal').textContent=gateRangeV+'dB';
    document.getElementById('fxGateAttackVal').textContent=gateAttackV+'мс';
    document.getElementById('fxGateHoldVal').textContent=gateHoldV+'мс';
    document.getElementById('fxGateReleaseVal').textContent=gateReleaseV+'мс';
    document.getElementById('fxGate').textContent=gateOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('fxGate').className='fx-toggle'+(gateOn?' on':'');

    // EQ
    const eqOn=document.getElementById('fxEq').classList.contains('on');
    const eqLowV=parseInt(document.getElementById('fxEqLow').value);
    const eqMidV=parseInt(document.getElementById('fxEqMid').value);
    const eqHighV=parseInt(document.getElementById('fxEqHigh').value);
    c.eqLow.gain.setTargetAtTime(eqOn?eqLowV:0,t,0.02);
    c.eqMid.gain.setTargetAtTime(eqOn?eqMidV:0,t,0.02);
    c.eqHigh.gain.setTargetAtTime(eqOn?eqHighV:0,t,0.02);
    src.fxState.eqLow=eqLowV; src.fxState.eqMid=eqMidV; src.fxState.eqHigh=eqHighV;
    src.fxState.eq=eqOn;
    document.getElementById('fxEqLowVal').textContent=(eqLowV>0?'+':'')+eqLowV+'dB';
    document.getElementById('fxEqMidVal').textContent=(eqMidV>0?'+':'')+eqMidV+'dB';
    document.getElementById('fxEqHighVal').textContent=(eqHighV>0?'+':'')+eqHighV+'dB';
    document.getElementById('fxEq').textContent=eqOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('fxEq').className='fx-toggle'+(eqOn?' on':'');

    // Compressor
    const compOn=document.getElementById('fxComp').classList.contains('on');
    const compThreshV=parseInt(document.getElementById('fxCompThresh').value);
    const compRatioV=parseFloat(document.getElementById('fxCompRatio').value);
    const compGainV=parseInt(document.getElementById('fxCompGain').value);
    c.compressor.threshold.setTargetAtTime(compOn?compThreshV:0,t,0.02);
    c.compressor.ratio.setTargetAtTime(compOn?compRatioV:1,t,0.02);
    c.compMakeup.gain.setTargetAtTime(compOn?_dbToLinear(compGainV):1,t,0.02);
    src.fxState.compressor=compOn; src.fxState.compThresh=compThreshV;
    src.fxState.compRatio=compRatioV; src.fxState.compGain=compGainV;
    document.getElementById('fxCompThreshVal').textContent=compThreshV+'dB';
    document.getElementById('fxCompRatioVal').textContent=compRatioV+':1';
    document.getElementById('fxCompGainVal').textContent='+'+compGainV+'dB';
    document.getElementById('fxComp').textContent=compOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('fxComp').className='fx-toggle'+(compOn?' on':'');

    // Limiter
    const limOn=document.getElementById('fxLimiter').classList.contains('on');
    const limThreshV=parseInt(document.getElementById('fxLimThresh').value);
    c.limiter.threshold.setTargetAtTime(limOn?limThreshV:0,t,0.02);
    c.limiter.ratio.setTargetAtTime(limOn?20:1,t,0.02);
    src.fxState.limiter=limOn; src.fxState.limThresh=limThreshV;
    document.getElementById('fxLimThreshVal').textContent=limThreshV+'dB';
    document.getElementById('fxLimiter').textContent=limOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('fxLimiter').className='fx-toggle'+(limOn?' on':'');

    // Sync to audioEffects map
    S.audioEffects.set(srcId,{...src.fxState});

    // Update FX button highlight
    const hasFx=gateOn||eqOn||compOn||limOn;
    const fxBtn=document.querySelector(`[data-fxid="${srcId}"]`);
    if(fxBtn) fxBtn.classList.toggle('fx-active',hasFx);
  };

  // Toggle buttons: click toggles on/off state then live-updates
  ['fxGate','fxEq','fxComp','fxLimiter'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onclick=()=>{
      el.classList.toggle('on');
      el.textContent=el.classList.contains('on')?'ВКЛ':'ВЫКЛ';
      liveUpdate();
    };
  });
  // All sliders = live update
  ['fxGateThresh','fxGateRange','fxGateAttack','fxGateHold','fxGateRelease','fxEqLow','fxEqMid','fxEqHigh','fxCompThresh','fxCompRatio','fxCompGain','fxLimThresh'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=liveUpdate;
  });

  // Gate activity monitoring — shows state (open/closed) and signal level from worklet
  const _gateNode = S.audioNodes.get(srcId)?.effectsChain?.gateNode;
  if (_gateNode && _gateNode.port) {
    _gateNode.port.onmessage = (ev) => {
      if (ev.data.type !== 'gate-state') return;
      const stateEl = document.getElementById('fxGateState');
      const levelEl = document.getElementById('fxGateLevel');
      const levelDbEl = document.getElementById('fxGateLevelDb');
      const gateOn = document.getElementById('fxGate')?.classList.contains('on');
      if (stateEl) {
        if (!gateOn) {
          stateEl.textContent = 'выключен';
          stateEl.style.color = 'var(--muted)';
        } else if (ev.data.open) {
          stateEl.textContent = 'открыт';
          stateEl.style.color = '#86efac';
        } else {
          stateEl.textContent = 'закрыт';
          stateEl.style.color = '#fca5a5';
        }
      }
      if (levelEl) {
        const pct = Math.max(0, Math.min(100, (ev.data.rmsDb + 60) / 60 * 100));
        levelEl.style.width = pct + '%';
        levelEl.style.background = ev.data.rmsDb > -6 ? '#fca5a5' : ev.data.rmsDb > -20 ? '#fde68a' : '#86efac';
      }
      if (levelDbEl) {
        levelDbEl.textContent = Math.round(ev.data.rmsDb) + 'dB';
      }
    };
  }

  // Preset buttons for noise suppression
  const gatePresets={
    light: {gateThresh:-30,gateRange:-20,gateAttack:20,gateHold:200,gateRelease:200},
    medium:{gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150},
    heavy: {gateThresh:-50,gateRange:-60,gateAttack:5,gateHold:50,gateRelease:100},
    mute:  {gateThresh:-55,gateRange:-80,gateAttack:2,gateHold:20,gateRelease:50}
  };
  document.querySelectorAll('.fx-preset-btn:not(.fx-eq-preset):not(.fx-comp-preset)').forEach(btn=>{
    btn.onclick=()=>{
      const p=gatePresets[btn.dataset.preset];
      if(!p) return;
      document.getElementById('fxGate').classList.add('on');
      document.getElementById('fxGate').textContent='ВКЛ';
      document.getElementById('fxGateThresh').value=p.gateThresh;
      document.getElementById('fxGateRange').value=p.gateRange;
      document.getElementById('fxGateAttack').value=p.gateAttack;
      document.getElementById('fxGateHold').value=p.gateHold;
      document.getElementById('fxGateRelease').value=p.gateRelease;
      document.querySelectorAll('.fx-preset-btn:not(.fx-eq-preset):not(.fx-comp-preset)').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      liveUpdate();
    };
  });

  // EQ presets
  const eqPresets={
    warm:  {eqLow:3,eqMid:0,eqHigh:-2},
    bright:{eqLow:-2,eqMid:0,eqHigh:4},
    midcut:{eqLow:0,eqMid:-4,eqHigh:0},
    vocal: {eqLow:-6,eqMid:2,eqHigh:4}
  };
  document.querySelectorAll('.fx-eq-preset').forEach(btn=>{
    btn.onclick=()=>{
      const p=eqPresets[btn.dataset.eqpreset];
      if(!p) return;
      document.getElementById('fxEq').classList.add('on');
      document.getElementById('fxEq').textContent='ВКЛ';
      document.getElementById('fxEqLow').value=p.eqLow;
      document.getElementById('fxEqMid').value=p.eqMid;
      document.getElementById('fxEqHigh').value=p.eqHigh;
      document.querySelectorAll('.fx-eq-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      liveUpdate();
    };
  });

  // Compressor presets
  const compPresets={
    gentle:{compThresh:-18,compRatio:3,compGain:6},
    vocal: {compThresh:-24,compRatio:4,compGain:8},
    heavy: {compThresh:-30,compRatio:6,compGain:12}
  };
  document.querySelectorAll('.fx-comp-preset').forEach(btn=>{
    btn.onclick=()=>{
      const p=compPresets[btn.dataset.comppreset];
      if(!p) return;
      document.getElementById('fxComp').classList.add('on');
      document.getElementById('fxComp').textContent='ВКЛ';
      document.getElementById('fxCompThresh').value=p.compThresh;
      document.getElementById('fxCompRatio').value=p.compRatio;
      document.getElementById('fxCompGain').value=p.compGain;
      document.querySelectorAll('.fx-comp-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      liveUpdate();
    };
  });
}

function _saveFxFromModal(srcId){
  const src=S.srcs.find(s=>s.id===srcId);
  if(!src) return;
  S.audioEffects.set(srcId,{...src.fxState});
  const hasFx=src.fxState.noiseGate||src.fxState.eq||src.fxState.compressor||src.fxState.limiter;
  const fxBtn=document.querySelector(`[data-fxid="${srcId}"]`);
  if(fxBtn) fxBtn.classList.toggle('fx-active',hasFx);
  // Persist FX by source name (so it survives restarts)
  if(S.settings){
    if(!S.settings.fxStateByName) S.settings.fxStateByName={};
    S.settings.fxStateByName[src.name]={...src.fxState};
    // Strip transient runtime keys (the ones starting with _) from persistence
    const clean={};for(const k of Object.keys(S.settings.fxStateByName[src.name])){if(!k.startsWith('_'))clean[k]=S.settings.fxStateByName[src.name][k];}
    S.settings.fxStateByName[src.name]=clean;
    _scheduleSettingsSave();
    try{window.electronAPI.settingsSave({fxStateByName:S.settings.fxStateByName});}catch(e){}
  }
}

// ═══════════════════════════════════════════════════════════
//  CAMERA SETTINGS MODAL
// ═══════════════════════════════════════════════════════════
function _showCamSettingsModal(srcId,openTab){
  const src=S.srcs.find(s=>s.id===srcId);
  if(!src) return;
  const cs=src.camSettings||{brightness:0,contrast:0,saturation:0,temperature:6500,sharpness:0,hue:0,sepia:0,autoFocus:true,resolution:''};
  const it=S.items.find(i=>i.sid===srcId);
  const fs=it?it.frameSettings:JSON.parse(JSON.stringify(framePresets.none));
  if(!fs.glow) fs.glow={enabled:false,color:fs.color||'#ffd23c',size:15,inward:true,outward:true};
  if(!fs.vignette) fs.vignette={enabled:false,strength:0.5,size:30};
  if(fs.animIntensity===undefined) fs.animIntensity=1.0;
  if(!fs.gradientColor1) fs.gradientColor1=fs.color||'#ffd23c';
  if(!fs.gradientColor2) fs.gradientColor2='#ff6b35';
  if(!fs.gradientColor3) fs.gradientColor3=fs.gradientColor1;
  if(!fs.vignetteColor) fs.vignetteColor='#000000';
  if(it){it.frameSettings=fs;}

  const old=document.getElementById('camModal');if(old)old.remove();

  const modal=document.createElement('div');
  modal.className='modal-overlay';modal.id='camModal';modal.style.display='flex';

  // Get available resolutions from the video track
  let resOpts='';
  const vt=src.stream?src.stream.getVideoTracks()[0]:null;
  const resolutions=[
    {label:'Авто',value:''},
    {label:'3840×2160 (4K)',value:'3840x2160'},
    {label:'2560×1440 (2K)',value:'2560x1440'},
    {label:'1920×1080 (Full HD)',value:'1920x1080'},
    {label:'1280×720 (HD)',value:'1280x720'},
    {label:'854×480 (SD)',value:'854x480'},
    {label:'640×360',value:'640x360'}
  ];
  resOpts=resolutions.map(r=>`<option value="${r.value}"${cs.resolution===r.value?' selected':''}>${r.label}</option>`).join('');

  const startTab=openTab==='design'?'design':(src.type!=='camera'?'design':'settings');

  modal.innerHTML=`<div class="modal glass" style="width:780px;max-height:90vh;overflow-y:auto">
    <div class="modal-header"><h2>${esc(src.name)} — Настройки</h2>
    <button class="btn-icon" id="btnCloseCam"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid var(--glass-border);padding-bottom:0">
      <button class="cam-tab-btn${startTab==='settings'?' active':''}" data-camtab="settings" id="camTabSettings">Настройка</button>
      <button class="cam-tab-btn${startTab==='design'?' active':''}" data-camtab="design" id="camTabDesign">Дизайн</button>
    </div>

    <div id="camTabContentSettings" style="display:${startTab==='settings'?'flex':'none'};gap:16px">
      <div style="flex:1;min-width:0">
        <!-- PRESETS — collapsible -->
        <div class="fx-section fx-collapsible" data-coll="camPresets">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Пресеты</span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body" style="gap:6px">
            <div class="fx-row" style="gap:6px;flex-wrap:wrap">
              <button class="btn fx-preset-btn cam-preset" data-cp="default">По умолчанию</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="studio">Студия</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="portrait">Портрет</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="gaming">Гейминг</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="vivid">Яркий</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="warm">Тёплый</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="cool">Холодный</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="cinematic">Кинематограф</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="bw">Ч/Б</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="night">Ночь</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="vintage">Винтаж</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="neonGlow">Неон</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="sunset">Закат</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="arctic">Арктика</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="film">Плёнка</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="dramatic">Драма</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="dreamy">Мечта</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="retro70s">70-е</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="noir">Нуар</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="retro">Ретро</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="hologram">Голограмма</button>
            </div>
          </div>
        </div>
        <!-- COLOR — brightness, contrast, saturation, WB, hue, sepia -->
        <div class="fx-section fx-collapsible" data-coll="camColor">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Цвет и свет</span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body">
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Яркость</span><input type="range" class="fx-slider" id="camBr" min="-100" max="100" value="${cs.brightness}" step="1"/><span class="fx-val" id="camBrVal" style="width:34px;text-align:right">${cs.brightness>0?'+':''}${cs.brightness}</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Контраст</span><input type="range" class="fx-slider" id="camCn" min="-100" max="100" value="${cs.contrast}" step="1"/><span class="fx-val" id="camCnVal" style="width:34px;text-align:right">${cs.contrast>0?'+':''}${cs.contrast}</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Насыщенность</span><input type="range" class="fx-slider" id="camSa" min="-100" max="100" value="${cs.saturation}" step="1"/><span class="fx-val" id="camSaVal" style="width:34px;text-align:right">${cs.saturation>0?'+':''}${cs.saturation}</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Баланс белого <span class="hint-toggle" data-hint="Температура цвета в Кельвинах. 3000K — тёплый жёлтый, 6500K — нейтральный, 9000K — холодный голубой.">?</span></span><input type="range" class="fx-slider" id="camWb" min="3000" max="9000" value="${cs.temperature}" step="100"/><span class="fx-val" id="camWbVal" style="width:44px;text-align:right">${cs.temperature}K</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Оттенок</span><input type="range" class="fx-slider" id="camHue" min="-180" max="180" value="${cs.hue||0}" step="1"/><span class="fx-val" id="camHueVal" style="width:34px;text-align:right">${cs.hue||0}°</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Сепия</span><input type="range" class="fx-slider" id="camSepia" min="0" max="100" value="${cs.sepia||0}" step="1"/><span class="fx-val" id="camSepiaVal" style="width:34px;text-align:right">${cs.sepia||0}%</span></div>
          </div>
        </div>
        <!-- SHARPNESS -->
        <div class="fx-section fx-collapsible" data-coll="camSharp">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Резкость <span class="hint-toggle" data-hint="Unsharp mask (SVG-фильтр). Усиливает контраст границ — чётче изображение. 0 = без обработки.">?</span></span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body">
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Резкость</span><input type="range" class="fx-slider" id="camSh" min="0" max="100" value="${cs.sharpness}" step="1"/><span class="fx-val" id="camShVal" style="width:34px;text-align:right">${cs.sharpness}</span></div>
          </div>
        </div>
        <!-- CAPTURE — resolution, FPS, autofocus -->
        <div class="fx-section fx-collapsible" data-coll="camCapture">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Захват камеры</span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body">
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Разрешение</span><select id="camRes" style="flex:1;padding:4px 7px;border:1px solid var(--glass-border);border-radius:var(--r-sm);background:rgba(255,255,255,.04);color:var(--text);font-size:12px">${resOpts}</select></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">FPS <span class="hint-toggle" data-hint="Частота кадров камеры. 24 — киношный вид, 30 — стандарт, 60 — плавное. Авто — камера выберет сама.">?</span></span><select id="camFps" style="flex:1;padding:4px 7px;border:1px solid var(--glass-border);border-radius:var(--r-sm);background:rgba(255,255,255,.04);color:var(--text);font-size:12px"><option value="0"${(cs.fps||0)===0?' selected':''}>Авто</option><option value="15"${(cs.fps||0)===15?' selected':''}>15 fps</option><option value="24"${(cs.fps||0)===24?' selected':''}>24 fps (кино)</option><option value="30"${(cs.fps||0)===30?' selected':''}>30 fps</option><option value="60"${(cs.fps||0)===60?' selected':''}>60 fps</option></select></div>
            <div class="fx-row" style="justify-content:space-between;align-items:center"><div style="display:flex;align-items:center;gap:6px"><span class="fx-label">Автофокус <span class="hint-toggle" data-hint="Автофокусировка камеры. Выкл если фокус «плавает» при смене освещения.">?</span></span></div><label class="fx-switch"><input type="checkbox" id="camAF" ${cs.autoFocus?'checked':''}/><span class="fx-switch-label" id="afBadge">${cs.autoFocus?'ВКЛ':'ВЫКЛ'}</span></label></div>
            <div id="camHwCaps" style="display:none;margin-top:8px">
              <div style="font-size:10px;color:var(--accent);margin-bottom:4px">🎛 Аппаратные настройки камеры</div>
              <div id="camHwBody"></div>
            </div>
          </div>
        </div>
        <!-- DIGITAL ZOOM — collapsible -->
        <div class="fx-section fx-collapsible" data-coll="camZoom">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Цифровой зум <span class="hint-toggle" data-hint="Зум из исходника камеры — берёт центральную часть и растягивает. Качество выше чем масштабирование в сцене. Без потери FPS.">?</span></span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body">
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Зум</span><input type="range" class="fx-slider" id="camDZ" min="100" max="300" value="${Math.round((cs.digitalZoom||1)*100)}" step="5"/><span class="fx-val" id="camDZVal" style="width:40px;text-align:right">${(cs.digitalZoom||1).toFixed(1)}x</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Пан X</span><input type="range" class="fx-slider" id="camPanX" min="-100" max="100" value="${Math.round((cs.digitalZoomX||0)*100)}" step="1"/><span class="fx-val" id="camPanXVal" style="width:34px;text-align:right">${Math.round((cs.digitalZoomX||0)*100)}</span></div>
            <div class="fx-row" style="align-items:center;gap:8px"><span class="fx-label" style="min-width:80px">Пан Y</span><input type="range" class="fx-slider" id="camPanY" min="-100" max="100" value="${Math.round((cs.digitalZoomY||0)*100)}" step="1"/><span class="fx-val" id="camPanYVal" style="width:34px;text-align:right">${Math.round((cs.digitalZoomY||0)*100)}</span></div>
          </div>
        </div>
        <!-- FLIP — collapsible -->
        <div class="fx-section fx-collapsible" data-coll="camFlip">
          <div class="fx-header coll-toggle" style="cursor:pointer"><span class="fx-name">Зеркало</span><span class="coll-arrow" style="margin-left:auto">▸</span></div>
          <div class="fx-params coll-body">
            <div class="fx-row" style="gap:10px">
              <button class="btn fx-preset-btn${cs.flipH?' active':''}" id="camFlipH" style="flex:1">↔ Горизонт.</button>
              <button class="btn fx-preset-btn${cs.flipV?' active':''}" id="camFlipV" style="flex:1">↕ Вертикал.</button>
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">Переворот видеопотока, не влияет на позицию в сцене.</div>
          </div>
        </div>
        <div id="camTrackInfo" style="margin-top:8px;font-size:10px;color:var(--muted);text-align:center;max-width:240px"></div>
        <div style="text-align:right;margin-top:4px"><button class="btn" id="btnCamReset">Сброс настроек</button></div>
      </div>
      <div style="width:300px;flex-shrink:0;display:flex;flex-direction:column;align-items:center">
        <span style="font-size:11px;color:var(--text2);margin-bottom:6px">Предпросмотр</span>
        <div id="camPreviewWrap" class="transparent-preview" style="width:300px;height:350px;border-radius:var(--r);overflow:hidden;position:relative">
          <canvas id="camPreviewCanvas" width="300" height="350" style="width:100%;height:100%"></canvas>
        </div>
      </div>
    </div>

    <div id="camTabContentDesign" style="display:${startTab==='design'?'flex':'none'};gap:16px">
      <div style="flex:1;min-width:0;overflow-y:auto;max-height:500px;padding-right:4px">
        <div class="fx-section fx-collapsible" data-coll="creative">
          <div class="fx-header coll-toggle"><span class="fx-name">Креативные пресеты</span><span style="font-size:10px;color:var(--muted)">с анимацией</span><span class="coll-arrow">▸</span></div>
          <div class="fx-params coll-body" style="gap:6px">
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="plasma" style="background:linear-gradient(120deg,rgba(163,255,58,.15),rgba(0,255,170,.10));border:1.5px solid #a3ff3a;box-shadow:0 0 12px rgba(163,255,58,.25)"><span style="color:#a3ff3a;text-shadow:0 0 8px #a3ff3a">⬢</span> Плазма</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="magma" style="background:linear-gradient(120deg,rgba(255,51,0,.18),rgba(255,168,0,.12));border:1.5px solid #ff5500;box-shadow:0 0 12px rgba(255,85,0,.30)"><span style="color:#ff5500;text-shadow:0 0 8px #ff3300">🔥</span> Магма</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="amethyst" style="background:linear-gradient(120deg,rgba(199,125,255,.18),rgba(123,44,191,.10));border:1.5px solid #c77dff;box-shadow:0 0 14px rgba(199,125,255,.30)"><span style="color:#c77dff;text-shadow:0 0 8px #9d4edd">◈</span> Аметист</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="electric" style="background:linear-gradient(120deg,rgba(0,212,255,.18),rgba(255,255,255,.08));border:1.5px solid #00d4ff;box-shadow:0 0 14px rgba(0,212,255,.35)"><span style="color:#00d4ff;text-shadow:0 0 10px #00d4ff">⚡</span> Электро</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="aurora" style="background:linear-gradient(120deg,rgba(0,255,170,.15),rgba(168,85,247,.12));border:1.5px solid #00ffaa;box-shadow:0 0 12px rgba(0,255,170,.25)"><span style="color:#00ffaa;text-shadow:0 0 8px #00ffaa">🌌</span> Аврора</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="ember" style="background:linear-gradient(120deg,rgba(255,107,53,.16),rgba(255,45,149,.12));border:1.5px solid #ff6b35;box-shadow:0 0 12px rgba(255,107,53,.28)"><span style="color:#ff6b35;text-shadow:0 0 8px #ff6b35">◐</span> Уголь</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="ocean" style="background:linear-gradient(120deg,rgba(0,119,182,.18),rgba(72,202,228,.12));border:1.5px solid #48cae4;box-shadow:0 0 12px rgba(72,202,228,.28)"><span style="color:#48cae4;text-shadow:0 0 8px #0077b6">≈</span> Океан</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="vhs" style="background:linear-gradient(120deg,rgba(255,0,110,.16),rgba(58,134,255,.12));border:1.5px solid #ff006e;box-shadow:0 0 12px rgba(255,0,110,.28)"><span style="color:#ff006e;text-shadow:0 0 8px #ff006e">▒</span> VHS</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="emerald" style="background:linear-gradient(120deg,rgba(16,185,129,.18),rgba(167,243,208,.10));border:1.5px solid #10b981;box-shadow:0 0 12px rgba(16,185,129,.28)"><span style="color:#10b981;text-shadow:0 0 8px #10b981">◆</span> Изумруд</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="roseGold" style="background:linear-gradient(120deg,rgba(232,180,184,.20),rgba(212,165,116,.12));border:1.5px solid #e8b4b8;box-shadow:0 0 10px rgba(232,180,184,.25)"><span style="color:#e8b4b8;text-shadow:0 0 8px #e8b4b8">✦</span> Розовое золото</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="holographic" style="background:linear-gradient(120deg,rgba(255,0,255,.15),rgba(0,255,255,.12),rgba(255,255,0,.10));border:1.5px solid #ff00ff;box-shadow:0 0 12px rgba(255,0,255,.28)"><span style="background:linear-gradient(90deg,#ff00ff,#00ffff,#ffff00);-webkit-background-clip:text;-webkit-text-fill-color:transparent">◇</span> Голограмма</button>
              <button class="btn fx-preset-btn frame-preset preset-creative" data-fp="cyber" style="background:linear-gradient(120deg,rgba(0,255,65,.15),rgba(0,136,255,.10));border:1.5px solid #00ff41;box-shadow:0 0 12px rgba(0,255,65,.28)"><span style="color:#00ff41;text-shadow:0 0 8px #00ff41">⌘</span> Кибер</button>
            </div>
          </div>
        </div>
        <div class="fx-section fx-collapsible" data-coll="simple">
          <div class="fx-header coll-toggle"><span class="fx-name">Простые пресеты</span><span style="font-size:10px;color:var(--muted)">для тонкой настройки</span><span class="coll-arrow">▸</span></div>
          <div class="fx-params coll-body" style="gap:6px">
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
              <button class="btn fx-preset-btn frame-preset" data-fp="none" style="border-color:rgba(127,127,127,.3)">— Без</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="goldClassic" style="border-left:3px solid #ffd23c"><span style="color:#ffd23c">✦</span> Золото</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="goldThick" style="border-left:3px solid #ffaa00"><span style="color:#ffaa00">▐</span> Золото×</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="neon" style="border-left:3px solid #00ffff"><span style="color:#00ffff">◈</span> Неон</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="neonPink" style="border-left:3px solid #ff00ff"><span style="color:#ff00ff">◈</span> Розовый</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="stream" style="border-left:3px solid #9147ff"><span style="color:#9147ff">▶</span> Стрим</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="cinematic" style="border-left:3px solid #555"><span style="color:#aaa">▬</span> Кино</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="elegant" style="border-left:3px solid #c0c0c0"><span style="color:#c0c0c0">✧</span> Элегант</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="chrome" style="border-left:3px solid #e0e0e0"><span style="color:#bbb">⬡</span> Хром</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="rainbow" style="border-left:3px solid #ff6b00"><span style="background:linear-gradient(90deg,#f00,#0f0,#00f);-webkit-background-clip:text;-webkit-text-fill-color:transparent">●</span> Радуга</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="sunset" style="border-left:3px solid #ff6b35"><span style="color:#ff6b35">◐</span> Закат</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="frost" style="border-left:3px solid #a8d8ea"><span style="color:#a8d8ea">❄</span> Лёд</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="fire" style="border-left:3px solid #ff4500"><span style="color:#ff4500">🔥</span> Огонь</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="softWhite" style="border-left:3px solid #fff"><span style="color:#ddd">☀</span> Свет</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="retro" style="border-left:3px solid #ffcc00"><span style="color:#ffcc00">⎚</span> Ретро</button>
              <button class="btn fx-preset-btn frame-preset" data-fp="minimal" style="border-left:3px solid rgba(255,255,255,.5)"><span style="color:rgba(255,255,255,.6)">─</span> Минимал</button>
            </div>
          </div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Стиль рамки</span></div>
          <div class="fx-params"><select id="frameStyle" style="width:100%;padding:6px 9px;border:1px solid var(--input-border);border-radius:var(--r-sm);background:var(--input-bg);color:var(--text);font-size:12px;outline:none">
            <option value="solid"${fs.style==='solid'?' selected':''}>Сплошная</option>
            <option value="double"${fs.style==='double'?' selected':''}>Двойная</option>
            <option value="dashed"${fs.style==='dashed'?' selected':''}>Пунктир</option>
            <option value="dotted"${fs.style==='dotted'?' selected':''}>Точечная</option>
            <option value="ornate"${fs.style==='ornate'?' selected':''}>Орнамент</option>
            <option value="gradient"${fs.style==='gradient'?' selected':''}>Градиент</option>
            <option value="ridge"${fs.style==='ridge'?' selected':''}>Рельеф</option>
            <option value="inset"${fs.style==='inset'?' selected':''}>Врезка</option>
            <option value="glow"${fs.style==='glow'?' selected':''}>Чистое свечение</option>
          </select></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Цвет рамки</span><input type="color" id="frameColor" value="${fs.color}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0;margin-left:8px"/></div>
        </div>
        <div class="fx-section" id="gradientSection" style="display:${fs.style==='gradient'?'block':'none'}">
          <div class="fx-header"><span class="fx-name">Градиент</span></div>
          <div class="fx-params">
            <div class="fx-row"><span class="fx-label">Цвет 1</span><input type="color" id="frameGrad1" value="${fs.gradientColor1||'#ffd23c'}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/></div>
            <div class="fx-row"><span class="fx-label">Цвет 2</span><input type="color" id="frameGrad2" value="${fs.gradientColor2||'#ff6b35'}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/></div>
            <div class="fx-row"><span class="fx-label">Цвет 3</span><input type="color" id="frameGrad3" value="${fs.gradientColor3||'#ffd23c'}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/></div>
          </div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Толщина</span><span class="fx-val" id="frameThickVal">${fs.thickness}px</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="frameThick" min="1" max="40" value="${fs.thickness}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Прозрачность</span><span class="fx-val" id="frameOpacityVal">${Math.round(fs.opacity*100)}%</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="frameOpacity" min="0" max="100" value="${Math.round(fs.opacity*100)}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Свечение</span><label class="fx-switch"><input type="checkbox" id="frameGlowOn" ${fs.glow.enabled?'checked':''}/><span class="fx-switch-label" id="glowBadge">${fs.glow.enabled?'ВКЛ':'ВЫКЛ'}</span></label></div>
          <div class="fx-params">
            <div class="fx-row"><span class="fx-label">Цвет свечения</span><input type="color" id="frameGlowColor" value="${fs.glow.color}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/></div>
            <div class="fx-row"><span class="fx-label">Размер</span><input type="range" class="fx-slider" id="frameGlowSize" min="2" max="60" value="${fs.glow.size}" step="1"/><span class="fx-val" id="glowSizeVal">${fs.glow.size}</span></div>
            <div class="fx-row"><span class="fx-label">Направление</span><label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="frameGlowIn" ${fs.glow.inward?'checked':''}/> Внутрь</label><label style="font-size:12px;display:flex;align-items:center;gap:4px;margin-left:12px"><input type="checkbox" id="frameGlowOut" ${fs.glow.outward?'checked':''}/> Наружу</label></div>
          </div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Анимация</span></div>
          <div class="fx-params">
            <select id="frameAnim" style="width:100%;padding:6px 9px;border:1px solid var(--input-border);border-radius:var(--r-sm);background:var(--input-bg);color:var(--text);font-size:12px;outline:none">
              <option value="none"${fs.animation==='none'?' selected':''}>Нет</option>
              <option value="pulse"${fs.animation==='pulse'?' selected':''}>Пульсация</option>
              <option value="breathe"${fs.animation==='breathe'?' selected':''}>Дыхание</option>
              <option value="colorShift"${fs.animation==='colorShift'?' selected':''}>Смена цветов</option>
              <option value="rainbow"${fs.animation==='rainbow'?' selected':''}>Радуга</option>
              <option value="shimmer"${fs.animation==='shimmer'?' selected':''}>Блики</option>
              <option value="flow"${fs.animation==='flow'?' selected':''}>Поток</option>
            </select>
            <div class="fx-row" style="margin-top:6px"><span class="fx-label">Интенсив.</span><input type="range" class="fx-slider" id="frameAnimI" min="0" max="2" step="0.05" value="${fs.animIntensity!==undefined?fs.animIntensity:1}"/><span class="fx-val" id="frameAnimIVal">${(fs.animIntensity!==undefined?fs.animIntensity:1).toFixed(2)}×</span></div>
          </div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Виньетка</span><label class="fx-switch"><input type="checkbox" id="frameVigOn" ${fs.vignette.enabled?'checked':''}/><span class="fx-switch-label" id="vigBadge">${fs.vignette.enabled?'ВКЛ':'ВЫКЛ'}</span></label></div>
          <div class="fx-params">
            <div class="fx-row"><span class="fx-label">Сила</span><input type="range" class="fx-slider" id="frameVigStr" min="0.1" max="1" value="${fs.vignette.strength}" step="0.05"/><span class="fx-val" id="vigStrVal">${fs.vignette.strength}</span></div>
            <div class="fx-row"><span class="fx-label">Размер</span><input type="range" class="fx-slider" id="frameVigSize" min="10" max="60" value="${fs.vignette.size}" step="1"/><span class="fx-val" id="vigSizeVal">${fs.vignette.size}</span></div>
            <div class="fx-row"><span class="fx-label">Цвет</span><input type="color" id="frameVigColor" value="${fs.vignetteColor||'#000000'}" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/></div>
          </div>
        </div>
        <div style="text-align:right;margin-top:4px"><button class="btn" id="btnFrameReset">Сброс рамки</button></div>
      </div>
      <div style="width:220px;flex-shrink:0;display:flex;flex-direction:column;align-items:center">
        <span style="font-size:11px;color:var(--text2);margin-bottom:6px">Предпросмотр</span>
        <div id="framePreviewWrap" class="transparent-preview" style="width:220px;height:160px;border-radius:var(--r);overflow:hidden;position:relative">
          <canvas id="framePreviewCanvas" width="220" height="160" style="width:100%;height:100%"></canvas>
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;justify-content:center">
          <button class="btn fx-preset-btn mask-btn${it.cropMask==='none'||!it.cropMask?' active':''}" data-mask="none" title="Без маски">☐</button>
          <button class="btn fx-preset-btn mask-btn${it.cropMask==='rect'?' active':''}" data-mask="rect" title="Прямоугольник">▭</button>
          <button class="btn fx-preset-btn mask-btn${it.cropMask==='circle'?' active':''}" data-mask="circle" title="Круг">●</button>
          <button class="btn fx-preset-btn mask-btn${it.cropMask==='rounded'?' active':''}" data-mask="rounded" title="Скруглённый">⬜</button>
        </div>
      </div>
    </div>
  </div>`;

  // Add tab styling inline
  const styleEl=document.createElement('style');
  styleEl.textContent='.cam-tab-btn{padding:8px 20px;background:none;border:none;border-bottom:2px solid transparent;color:var(--text2);cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}.cam-tab-btn:hover{color:var(--text)}.cam-tab-btn.active{color:var(--accent);border-bottom-color:var(--accent)}';
  modal.appendChild(styleEl);

  document.body.appendChild(modal);

  // Tab switching
  document.getElementById('camTabSettings').onclick=()=>{
    document.getElementById('camTabSettings').classList.add('active');
    document.getElementById('camTabDesign').classList.remove('active');
    document.getElementById('camTabContentSettings').style.display='flex';
    document.getElementById('camTabContentDesign').style.display='none';
    const mEl=document.querySelector('#camModal .modal');if(mEl)mEl.scrollTop=0;
  };
  document.getElementById('camTabDesign').onclick=()=>{
    document.getElementById('camTabDesign').classList.add('active');
    document.getElementById('camTabSettings').classList.remove('active');
    document.getElementById('camTabContentDesign').style.display='flex';
    document.getElementById('camTabContentSettings').style.display='none';
    const mEl=document.querySelector('#camModal .modal');if(mEl)mEl.scrollTop=0;
  };

  // Preview canvas rendering — shows exactly what's on stream (crop, mask, frame)
  const previewCv=document.getElementById('camPreviewCanvas');
  const previewCtx=previewCv?previewCv.getContext('2d'):null;
  let _previewRAF=null;
  let _previewFrame=0;

  function _renderPreview(){
    if(!document.getElementById('camModal'))return;
    if(!previewCtx||!src.el||src.el.readyState<2){_previewRAF=requestAnimationFrame(_renderPreview);return;}
    _previewFrame++;
    if(_previewFrame%3!==0){_previewRAF=requestAnimationFrame(_renderPreview);return;}
    const v=src.el;
    const vw=v.videoWidth||300,vh=v.videoHeight||350;
    const cw=300,ch=350;
    previewCtx.clearRect(0,0,cw,ch);

    if(!it){
      const sc=Math.min(cw/vw,ch/vh);
      const dw=vw*sc,dh=vh*sc;
      const hasCamFx=src.camSettings&&(src.camSettings.sharpness>0||src.camSettings.denoise>0||src.camSettings.brightness!==0||src.camSettings.contrast!==0||src.camSettings.saturation!==0||(src.camSettings.temperature&&src.camSettings.temperature!==6500)||(src.camSettings.hue&&src.camSettings.hue!==0)||(src.camSettings.sepia&&src.camSettings.sepia>0));
      const _drawSrc=hasCamFx?SBScene._applyCamFxOffscreen(src,v,src.camSettings):v;
      // Camera-level flip
      if(src.camSettings&&(src.camSettings.flipH||src.camSettings.flipV)){previewCtx.save();previewCtx.scale(src.camSettings.flipH?-1:1,src.camSettings.flipV?-1:1);}
      previewCtx.drawImage(_drawSrc,(cw-dw)/2,(ch-dh)/2,dw,dh);
      if(src.camSettings&&(src.camSettings.flipH||src.camSettings.flipV)) previewCtx.restore();
      if(!document.getElementById('camModal'))return;
      _previewRAF=requestAnimationFrame(_renderPreview);
      return;
    }

    // Render item as miniature — exactly like on stream
    const maxW=cw-16,maxH=ch-16;
    const itemScale=Math.min(maxW/it.w,maxH/it.h);
    const dw=it.w*itemScale,dh=it.h*itemScale;
    const dcx=cw/2,dcy=ch/2;

    previewCtx.save();
    previewCtx.translate(dcx,dcy);
    previewCtx.rotate(it.rot*Math.PI/180);
    previewCtx.scale(it.flipH?-1:1,it.flipV?-1:1);

    // Outward glow first (mark as preview-mode so reach isn't auto-clipped to scene size)
    _drawBorderGlowOut(previewCtx,{w:dw,h:dh,cx:0,cy:0,rot:0,flipH:false,flipV:false,cropMask:it.cropMask||'none',frameSettings:it.frameSettings,_isPreview:true});

    // Crop mask
    const cr=it.crop||{l:0,t:0,r:0,b:0};
    const maskType=it.cropMask||'none';
    if(maskType==='circle'){
      const pcr_=Math.min(dw,dh)/2;previewCtx.beginPath();previewCtx.arc(0,0,pcr_,0,Math.PI*2);previewCtx.clip();
    }else if(maskType==='rounded'){
      const rr2=Math.min(dw,dh)*0.15;
      _roundedRectPath(previewCtx,-dw/2,-dh/2,dw,dh,rr2);previewCtx.clip();
    }else if(maskType==='rect'){
      previewCtx.beginPath();previewCtx.rect(-dw/2,-dh/2,dw,dh);previewCtx.clip();
    }

    // Cam filter
    const hasCamFx=src.camSettings&&(src.camSettings.brightness!==0||src.camSettings.contrast!==0||src.camSettings.saturation!==0||(src.camSettings.temperature&&src.camSettings.temperature!==6500)||(src.camSettings.sharpness&&src.camSettings.sharpness>0)||(src.camSettings.hue&&src.camSettings.hue!==0)||(src.camSettings.sepia&&src.camSettings.sepia!==0));
    const _cs=src.camSettings;
    // Camera flip in preview
    if(_cs&&(_cs.flipH||_cs.flipV)) previewCtx.scale(_cs.flipH?-1:1,_cs.flipV?-1:1);
    // Digital zoom in preview
    let _sx=cr.l*vw,_sy=cr.t*vh,_sw=Math.max(1,vw*(1-cr.l-cr.r)),_sh=Math.max(1,vh*(1-cr.t-cr.b));
    if(_cs&&_cs.digitalZoom&&_cs.digitalZoom>1.01){const dz=_cs.digitalZoom,dzx=_cs.digitalZoomX||0,dzy=_cs.digitalZoomY||0;const zw=_sw/dz,zh=_sh/dz;_sx=_sx+(_sw-zw)/2+(dzx*(_sw-zw)/2);_sy=_sy+(_sh-zh)/2+(dzy*(_sh-zh)/2);_sw=zw;_sh=zh;}
    const pdx2=it.panDx||0,pdy2=it.panDy||0;
    if(hasCamFx){
      const _drawSrc2=SBScene._applyCamFxOffscreen(src,v,_cs);
      if(it.cropMask&&it.cropMask!=='none'){const cs2=Math.max(dw/_sw,dh/_sh)*CIRCLE_PAN_ZOOM;const ddw=_sw*cs2,ddh=_sh*cs2;previewCtx.drawImage(_drawSrc2,_sx-pdx2*(_sw/ddw),_sy-pdy2*(_sh/ddh),_sw,_sh,-ddw/2,-ddh/2,ddw,ddh);}else{const scX2=_sw/dw,scY2=_sh/dh;previewCtx.drawImage(_drawSrc2,_sx-pdx2*scX2,_sy-pdy2*scY2,_sw,_sh,-dw/2,-dh/2,dw,dh);}
    }else{
      if(it.cropMask&&it.cropMask!=='none'){const cs2=Math.max(dw/_sw,dh/_sh)*CIRCLE_PAN_ZOOM;const ddw=_sw*cs2,ddh=_sh*cs2;previewCtx.drawImage(v,_sx-pdx2*(_sw/ddw),_sy-pdy2*(_sh/ddh),_sw,_sh,-ddw/2,-ddh/2,ddw,ddh);}else{const scX2=_sw/dw,scY2=_sh/dh;previewCtx.drawImage(v,_sx-pdx2*scX2,_sy-pdy2*scY2,_sw,_sh,-dw/2,-dh/2,dw,dh);}
    }

    // Draw border (preview-mode flag for adaptive halo). Edge fade is applied inside _drawBorder.
    const fakeIt={w:dw,h:dh,cx:0,cy:0,rot:0,flipH:false,flipV:false,cropMask:it.cropMask||'none',frameSettings:it.frameSettings,_isPreview:true};
    _drawBorder(previewCtx,fakeIt);
    previewCtx.restore();

    if(!document.getElementById('camModal'))return;
    _previewRAF=requestAnimationFrame(_renderPreview);
  }
  _renderPreview();

  // Frame preview canvas rendering (Дизайн tab) — shows stream view zoomed in
  const frameCv=document.getElementById('framePreviewCanvas');
  const frameCtx=frameCv?frameCv.getContext('2d'):null;
  let _framePreviewRAF=null;
  let _framePreviewFrame=0;

  function _renderFramePreview(){
    if(!document.getElementById('camModal'))return;
    if(!frameCtx||!src.el||src.el.readyState<2||!it){_framePreviewRAF=requestAnimationFrame(_renderFramePreview);return;}
    _framePreviewFrame++;
    const hasAnim=it.frameSettings.animation&&it.frameSettings.animation!=='none';
    if(!hasAnim&&_framePreviewFrame%4!==0){_framePreviewRAF=requestAnimationFrame(_renderFramePreview);return;}

    const v=src.el;
    const vw=v.videoWidth||300,vh=v.videoHeight||350;
    const cw=220,ch=160;

    frameCtx.clearRect(0,0,cw,ch);

    // Fit item into preview canvas preserving aspect ratio
    const maxW=cw-16,maxH=ch-16;
    const itemScale=Math.min(maxW/it.w,maxH/it.h);
    const dw=it.w*itemScale,dh=it.h*itemScale;
    const dcx=cw/2,dcy=ch/2;

    frameCtx.save();
    frameCtx.translate(dcx,dcy);
    frameCtx.rotate(it.rot*Math.PI/180);
    frameCtx.scale(it.flipH?-1:1,it.flipV?-1:1);

    // Crop mask
    const cr=it.crop||{l:0,t:0,r:0,b:0};
    const maskType=it.cropMask||'none';
    if(maskType==='circle'){
      const fcr_=Math.min(dw,dh)/2;frameCtx.beginPath();frameCtx.arc(0,0,fcr_,0,Math.PI*2);frameCtx.clip();
    }else if(maskType==='rounded'){
      const rr2=Math.min(dw,dh)*0.15;
      _roundedRectPath(frameCtx,-dw/2,-dh/2,dw,dh,rr2);frameCtx.clip();
    }else if(maskType==='rect'){
      frameCtx.beginPath();frameCtx.rect(-dw/2,-dh/2,dw,dh);frameCtx.clip();
    }

    // Cam filter
    const camFs=_buildCamFilterStr(src.camSettings);
    if(camFs) frameCtx.filter=camFs;
    const sx=cr.l*vw,sy=cr.t*vh;const pdx3=it.panDx||0,pdy3=it.panDy||0;const sw3=Math.max(1,vw*(1-cr.l-cr.r)),sh3=Math.max(1,vh*(1-cr.t-cr.b));if(it.cropMask&&it.cropMask!=='none'){const cs3=Math.max(dw/sw3,dh/sh3)*CIRCLE_PAN_ZOOM;const ddw3=sw3*cs3,ddh3=sh3*cs3;frameCtx.drawImage(v,sx-pdx3*(sw3/ddw3),sy-pdy3*(sh3/ddh3),sw3,sh3,-ddw3/2,-ddh3/2,ddw3,ddh3);}else{const scX3=sw3/dw,scY3=sh3/dh;frameCtx.drawImage(v,sx-pdx3*scX3,sy-pdy3*scY3,sw3,sh3,-dw/2,-dh/2,dw,dh);}
    frameCtx.filter='none';

    // Draw frame
    const fakeIt={w:dw,h:dh,cx:0,cy:0,rot:0,flipH:false,flipV:false,cropMask:it.cropMask||'none',frameSettings:it.frameSettings};
    _drawBorderGlowOut(frameCtx,fakeIt);
    _drawBorder(frameCtx,fakeIt);
    frameCtx.restore();

    if(!document.getElementById('camModal'))return;
    _framePreviewRAF=requestAnimationFrame(_renderFramePreview);
  }
  _renderFramePreview();

  function _buildCamFilterStr(cs){
    if(!cs) return '';
    const fArr=[];
    if(cs.brightness!==0) fArr.push('brightness('+(1+cs.brightness/100)+')');
    if(cs.contrast!==0) fArr.push('contrast('+(1+cs.contrast/100)+')');
    if(cs.saturation!==0) fArr.push('saturate('+(1+cs.saturation/100)+')');
    if(cs.temperature&&cs.temperature!==6500){
      const shift=(cs.temperature-6500)/2500;
      if(shift>0) fArr.push('sepia('+Math.min(shift*0.5,0.6)+') saturate('+(1+shift*0.15)+')');
      else fArr.push('hue-rotate('+(shift*15)+'deg) saturate('+(1+Math.abs(shift)*0.1)+')');
    }
    if(cs.sharpness&&cs.sharpness>0) fArr.push('contrast('+(1+cs.sharpness*0.003)+')');
    if(cs.hue&&cs.hue!==0) fArr.push('hue-rotate('+cs.hue+'deg)');
    if(cs.sepia&&cs.sepia!==0) fArr.push('sepia('+(cs.sepia/100)+')');
    return fArr.join(' ');
  }

  // Live update for camera settings (Настройка tab)
  const liveUpdate=()=>{
    const br=parseInt(document.getElementById('camBr').value);
    const cn=parseInt(document.getElementById('camCn').value);
    const sa=parseInt(document.getElementById('camSa').value);
    const wb=parseInt(document.getElementById('camWb').value);
    const sh=parseInt(document.getElementById('camSh').value);
    const hue=parseInt(document.getElementById('camHue')?document.getElementById('camHue').value:'0');
    const sepia=parseInt(document.getElementById('camSepia')?document.getElementById('camSepia').value:'0');
    const af=document.getElementById('camAF').checked;
    const res=document.getElementById('camRes').value;
    const fps=parseInt(document.getElementById('camFps')?document.getElementById('camFps').value:'0')||0;
    const dn=0; // denoise removed from camera UI
    const dz=parseInt(document.getElementById('camDZ')?document.getElementById('camDZ').value:'100')/100;
    const panX=parseInt(document.getElementById('camPanX')?document.getElementById('camPanX').value:'0')/100;
    const panY=parseInt(document.getElementById('camPanY')?document.getElementById('camPanY').value:'0')/100;
    src.camSettings.brightness=br;
    src.camSettings.contrast=cn;
    src.camSettings.saturation=sa;
    src.camSettings.temperature=wb;
    src.camSettings.sharpness=sh;
    src.camSettings.hue=hue;
    src.camSettings.sepia=sepia;
    src.camSettings.autoFocus=af;
    src.camSettings.resolution=res;
    src.camSettings.fps=fps;
    src.camSettings.denoise=dn;
    src.camSettings.digitalZoom=dz;
    src.camSettings.digitalZoomX=panX;
    src.camSettings.digitalZoomY=panY;
    src._offCv=null;
    document.getElementById('camBrVal').textContent=(br>0?'+':'')+br;
    document.getElementById('camCnVal').textContent=(cn>0?'+':'')+cn;
    document.getElementById('camSaVal').textContent=(sa>0?'+':'')+sa;
    document.getElementById('camWbVal').textContent=wb+'K';
    document.getElementById('camShVal').textContent=sh;
    document.getElementById('camHueVal').textContent=hue+'°';
    document.getElementById('camSepiaVal').textContent=sepia+'%';
    document.getElementById('afBadge').textContent=af?'ВКЛ':'ВЫКЛ';
    document.getElementById('afBadge').className='fx-switch-label'+(af?' on':'');
    // denoise removed from camera UI — value stays 0
    const dzEl=document.getElementById('camDZVal');if(dzEl)dzEl.textContent=dz.toFixed(1)+'x';
    const pxEl=document.getElementById('camPanXVal');if(pxEl)pxEl.textContent=Math.round(panX*100);
    const pyEl=document.getElementById('camPanYVal');if(pyEl)pyEl.textContent=Math.round(panY*100);
    document.querySelectorAll('.cam-preset').forEach(b=>b.classList.remove('active'));
    // Persist camSettings per source name
    if(!S.settings.camSettingsByName) S.settings.camSettingsByName={};
    S.settings.camSettingsByName[src.name]={...src.camSettings};
    _coSafe(co=>co.broadcastSourceUpdate());
    // Resolution/FPS change — reinit camera track when res or fps actually changed
    if(vt){
      if(src.camSettings._prevRes===undefined) src.camSettings._prevRes=res;
      if(src.camSettings._prevFps===undefined) src.camSettings._prevFps=fps;
      const settings=vt.getSettings();
      const prevRes=src.camSettings._prevRes;
      const prevFps=src.camSettings._prevFps;
      if(res&&res!==prevRes){
        const [w,h]=res.split('x').map(Number);
        if(w&&h){_changeCamResolution(src,w,h,fps>0?fps:30);}
      }else if(!res&&prevRes){
        _changeCamResolution(src,0,0,fps>0?fps:30);
      }else if(fps!==prevFps&&fps>0){
        _changeCamResolution(src,0,0,fps);
      }
      src.camSettings._prevRes=res;
      src.camSettings._prevFps=fps;
    }
  };

  // Live update for frame settings (Дизайн tab)
  const liveFrameUpdate=()=>{
    if(!it) return;
    const style=document.getElementById('frameStyle').value;
    const color=document.getElementById('frameColor').value;
    const thickness=parseInt(document.getElementById('frameThick').value);
    const opacity=parseInt(document.getElementById('frameOpacity').value)/100;
    const glowOn=document.getElementById('frameGlowOn').checked;
    const glowColor=document.getElementById('frameGlowColor').value;
    const glowSize=parseInt(document.getElementById('frameGlowSize').value);
    const glowIn=document.getElementById('frameGlowIn').checked;
    const glowOut=document.getElementById('frameGlowOut').checked;
    const animation=document.getElementById('frameAnim').value;
    const animIntensity=parseFloat(document.getElementById('frameAnimI')?document.getElementById('frameAnimI').value:1)||1;
    const vigOn=document.getElementById('frameVigOn').checked;
    const vigStr=parseFloat(document.getElementById('frameVigStr').value);
    const vigSize=parseInt(document.getElementById('frameVigSize').value);
    const vigColor=document.getElementById('frameVigColor')?document.getElementById('frameVigColor').value:'#000000';
    const grad1=document.getElementById('frameGrad1')?document.getElementById('frameGrad1').value:color;
    const grad2=document.getElementById('frameGrad2')?document.getElementById('frameGrad2').value:color;
    const grad3=document.getElementById('frameGrad3')?document.getElementById('frameGrad3').value:color;

    const _srcEl=document.activeElement;
    const _vigIds=['frameVigOn','frameVigStr','frameVigSize','frameVigColor'];
    const _isVigChange=_srcEl&&_vigIds.includes(_srcEl.id);
    if(!_isVigChange) it.frameSettings.enabled=true;
    it.frameSettings.style=style;
    it.frameSettings.color=color;
    it.frameSettings.thickness=thickness;
    it.frameSettings.opacity=opacity;
    it.frameSettings.glow.enabled=glowOn;
    it.frameSettings.glow.color=glowColor;
    it.frameSettings.glow.size=glowSize;
    it.frameSettings.glow.inward=glowIn;
    it.frameSettings.glow.outward=glowOut;
    it.frameSettings.animation=animation;
    it.frameSettings.animIntensity=animIntensity;
    it.frameSettings.vignette.enabled=vigOn;
    it.frameSettings.vignette.strength=vigStr;
    it.frameSettings.vignette.size=vigSize;
    it.frameSettings.vignetteColor=vigColor;
    it.frameSettings.gradientColor1=grad1;
    it.frameSettings.gradientColor2=grad2;
    it.frameSettings.gradientColor3=grad3;

    document.getElementById('frameThickVal').textContent=thickness+'px';
    document.getElementById('frameOpacityVal').textContent=Math.round(opacity*100)+'%';
    document.getElementById('glowBadge').textContent=glowOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('glowBadge').className='fx-switch-label'+(glowOn?' on':'');
    document.getElementById('glowSizeVal').textContent=glowSize;
    document.getElementById('vigBadge').textContent=vigOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('vigBadge').className='fx-switch-label'+(vigOn?' on':'');
    document.getElementById('vigStrVal').textContent=vigStr;
    document.getElementById('vigSizeVal').textContent=vigSize;
    const aiVal=document.getElementById('frameAnimIVal');if(aiVal) aiVal.textContent=animIntensity.toFixed(2)+'×';

    // Show/hide gradient section
    const gradSection=document.getElementById('gradientSection');
    if(gradSection) gradSection.style.display=style==='gradient'?'block':'none';

    // Clear frame preset active states
    document.querySelectorAll('.frame-preset').forEach(b=>b.classList.remove('active'));

    // Co-session: replicate the new frame state to all peers (throttled)
    if(S.co){ S.co.queueItemUpsert(it); }
  };

  // Camera presets
  const camPresets={
    default:{brightness:0,contrast:0,saturation:0,temperature:6500,sharpness:0,denoise:0,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    vivid:{brightness:15,contrast:40,saturation:60,temperature:6000,sharpness:20,denoise:0,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    warm:{brightness:10,contrast:15,saturation:10,temperature:4000,sharpness:5,denoise:0,hue:10,sepia:25,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    cool:{brightness:-5,contrast:20,saturation:-20,temperature:9000,sharpness:10,denoise:0,hue:-15,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    cinematic:{brightness:-10,contrast:45,saturation:-25,temperature:4500,sharpness:10,denoise:5,hue:5,sepia:15,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    bw:{brightness:5,contrast:35,saturation:-100,temperature:6500,sharpness:25,denoise:0,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    vintage:{brightness:5,contrast:10,saturation:-30,temperature:5500,sharpness:0,denoise:20,hue:15,sepia:40,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    neonGlow:{brightness:20,contrast:50,saturation:80,temperature:7500,sharpness:15,denoise:0,hue:-30,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    sunset:{brightness:15,contrast:25,saturation:40,temperature:3500,sharpness:5,denoise:0,hue:20,sepia:35,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    arctic:{brightness:-15,contrast:30,saturation:-40,temperature:10000,sharpness:15,denoise:0,hue:-20,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    film:{brightness:-5,contrast:20,saturation:-15,temperature:5000,sharpness:0,denoise:10,hue:8,sepia:20,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    dramatic:{brightness:-15,contrast:60,saturation:-10,temperature:5000,sharpness:20,denoise:0,hue:0,sepia:10,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    dreamy:{brightness:20,contrast:-10,saturation:20,temperature:7000,sharpness:-10,denoise:15,hue:25,sepia:15,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    retro70s:{brightness:10,contrast:15,saturation:30,temperature:4000,sharpness:-5,denoise:20,hue:30,sepia:50,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    noir:{brightness:-10,contrast:55,saturation:-80,temperature:5500,sharpness:30,denoise:0,hue:0,sepia:20,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    hologram:{brightness:25,contrast:35,saturation:50,temperature:8000,sharpness:10,denoise:0,hue:90,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    studio:{brightness:5,contrast:25,saturation:15,temperature:6200,sharpness:35,denoise:0,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    portrait:{brightness:8,contrast:10,saturation:20,temperature:5500,sharpness:15,denoise:10,hue:5,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    gaming:{brightness:10,contrast:40,saturation:55,temperature:6800,sharpness:45,denoise:0,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    night:{brightness:30,contrast:-5,saturation:-10,temperature:6000,sharpness:15,denoise:55,hue:0,sepia:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0},
    retro:{brightness:5,contrast:15,saturation:-25,temperature:5200,sharpness:0,denoise:20,hue:12,sepia:45,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0}
  };

  document.querySelectorAll('.cam-preset').forEach(btn=>{
    btn.onclick=()=>{
      const p=camPresets[btn.dataset.cp];
      if(!p) return;
      const _set=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
      _set('camBr',p.brightness);
      _set('camCn',p.contrast);
      _set('camSa',p.saturation);
      _set('camWb',p.temperature);
      _set('camSh',p.sharpness);
      // denoise removed from camera UI
      if(document.getElementById('camHue')) document.getElementById('camHue').value=p.hue||0;
      if(document.getElementById('camSepia')) document.getElementById('camSepia').value=p.sepia||0;
      _set('camDZ',Math.round((p.digitalZoom||1)*100));
      _set('camPanX',Math.round((p.digitalZoomX||0)*100));
      _set('camPanY',Math.round((p.digitalZoomY||0)*100));
      src.camSettings.flipH=p.flipH||false;
      src.camSettings.flipV=p.flipV||false;
      const fhBtn=document.getElementById('camFlipH');if(fhBtn)fhBtn.classList.toggle('active',p.flipH||false);
      const fvBtn=document.getElementById('camFlipV');if(fvBtn)fvBtn.classList.toggle('active',p.flipV||false);
      document.querySelectorAll('.cam-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      liveUpdate();
    };
  });

  // Mask buttons (crop mask under frame preview)
  document.querySelectorAll('.mask-btn').forEach(btn=>{
    btn.onclick=()=>{
      if(!it) return;
      const mask=btn.dataset.mask;
      it.cropMask=mask==='none'?undefined:mask;
      if(mask==='circle'||mask==='rect'){const sq=Math.min(it.w,it.h);it.w=sq;it.h=sq;_enforceCircle(it);}
      document.querySelectorAll('.mask-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  // Collapsible sections (Креативные / Простые / etc)
  document.querySelectorAll('.fx-collapsible .coll-toggle').forEach(h=>{
    h.style.cursor='pointer';
    h.onclick=()=>{
      const sec=h.closest('.fx-collapsible');
      if(!sec) return;
      sec.classList.toggle('open');
      const arr=h.querySelector('.coll-arrow');
      if(arr) arr.textContent=sec.classList.contains('open')?'▾':'▸';
      // Persist collapsed state
      const collName=sec.dataset.coll;
      if(collName){
        if(!S.settings.collapsedSections) S.settings.collapsedSections={};
        S.settings.collapsedSections[collName]=!sec.classList.contains('open');
        _scheduleSettingsSave();
      }
    };
  });
  // Restore collapsed state from settings
  if(S.settings.collapsedSections){
    document.querySelectorAll('.fx-collapsible[data-coll]').forEach(sec=>{
      const collName=sec.dataset.coll;
      if(collName && S.settings.collapsedSections[collName]===true){
        sec.classList.remove('open');
        const arr=sec.querySelector('.coll-arrow');
        if(arr) arr.textContent='▸';
      } else if(collName && S.settings.collapsedSections[collName]===false){
        sec.classList.add('open');
        const arr=sec.querySelector('.coll-arrow');
        if(arr) arr.textContent='▾';
      }
    });
  }

  // Frame presets
  document.querySelectorAll('.frame-preset').forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.fp;
      const p=framePresets[key];
      if(!p||!it) return;
      it.frameSettings=JSON.parse(JSON.stringify(p));
      // Update all controls
      document.getElementById('frameStyle').value=p.style;
      document.getElementById('frameColor').value=p.color;
      document.getElementById('frameThick').value=p.thickness;
      document.getElementById('frameOpacity').value=Math.round(p.opacity*100);
      document.getElementById('frameGlowOn').checked=p.glow.enabled;
      document.getElementById('frameGlowColor').value=p.glow.color;
      document.getElementById('frameGlowSize').value=p.glow.size;
      document.getElementById('frameGlowIn').checked=p.glow.inward;
      document.getElementById('frameGlowOut').checked=p.glow.outward;
      document.getElementById('frameAnim').value=p.animation;
      document.getElementById('frameVigOn').checked=p.vignette.enabled;
      document.getElementById('frameVigStr').value=p.vignette.strength;
      document.getElementById('frameVigSize').value=p.vignette.size;
      const vigCEl=document.getElementById('frameVigColor');
      if(vigCEl) vigCEl.value=p.vignetteColor||'#000000';
      // Gradient colors
      const g1=document.getElementById('frameGrad1');
      const g2=document.getElementById('frameGrad2');
      const g3=document.getElementById('frameGrad3');
      if(g1) g1.value=p.gradientColor1||p.color;
      if(g2) g2.value=p.gradientColor2||p.color;
      if(g3) g3.value=p.gradientColor3||p.color;
      // Update display values
      document.getElementById('frameThickVal').textContent=p.thickness+'px';
      document.getElementById('frameOpacityVal').textContent=Math.round(p.opacity*100)+'%';
      document.getElementById('glowBadge').textContent=p.glow.enabled?'ВКЛ':'ВЫКЛ';
      document.getElementById('glowBadge').className='fx-switch-label'+(p.glow.enabled?' on':'');
      document.getElementById('glowSizeVal').textContent=p.glow.size;
      document.getElementById('vigBadge').textContent=p.vignette.enabled?'ВКЛ':'ВЫКЛ';
      document.getElementById('vigBadge').className='fx-switch-label'+(p.vignette.enabled?' on':'');
      document.getElementById('vigStrVal').textContent=p.vignette.strength;
      document.getElementById('vigSizeVal').textContent=p.vignette.size;
      // Show/hide gradient section
      const gradSection=document.getElementById('gradientSection');
      if(gradSection) gradSection.style.display=p.style==='gradient'?'block':'none';
      document.querySelectorAll('.frame-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    };
  });

  document.getElementById('btnCloseCam').onclick=()=>{cancelAnimationFrame(_previewRAF);cancelAnimationFrame(_framePreviewRAF);modal.remove();};
  modal.onclick=e=>{if(e.target===modal){cancelAnimationFrame(_previewRAF);cancelAnimationFrame(_framePreviewRAF);modal.remove();}};

  document.getElementById('btnCamReset').onclick=()=>{
    document.getElementById('camBr').value=0;
    document.getElementById('camCn').value=0;
    document.getElementById('camSa').value=0;
    document.getElementById('camWb').value=6500;
    document.getElementById('camSh').value=0;
    if(document.getElementById('camHue')) document.getElementById('camHue').value=0;
    if(document.getElementById('camSepia')) document.getElementById('camSepia').value=0;
    // denoise removed from camera UI
    if(document.getElementById('camDZ')) document.getElementById('camDZ').value=100;
    if(document.getElementById('camPanX')) document.getElementById('camPanX').value=0;
    if(document.getElementById('camPanY')) document.getElementById('camPanY').value=0;
    document.getElementById('camAF').checked=true;
    document.getElementById('camRes').value='';
    if(document.getElementById('camFps')) document.getElementById('camFps').value='0';
    src.camSettings.flipH=false;src.camSettings.flipV=false;
    const fhBtn=document.getElementById('camFlipH');if(fhBtn)fhBtn.classList.remove('active');
    const fvBtn=document.getElementById('camFlipV');if(fvBtn)fvBtn.classList.remove('active');
    // Reset hardware camera settings
    if(vt){
      try{
        const caps=vt.getCapabilities?vt.getCapabilities():{};
        const adv=[];
        if(caps.exposureCompensation) adv.push({exposureCompensation:0});
        if(caps.focusMode) adv.push({focusMode:'continuous'});
        if(caps.whiteBalanceMode) adv.push({whiteBalanceMode:'continuous'});
        if(caps.brightness){const mid=Math.round((caps.brightness.min+caps.brightness.max)/2);adv.push({brightness:mid});}
        if(adv.length>0) vt.applyConstraints({advanced:adv});
      }catch(_){}
    }
    document.querySelectorAll('.cam-preset').forEach(b=>b.classList.remove('active'));
    liveUpdate();
  };

  document.getElementById('btnFrameReset').onclick=()=>{
    if(!it) return;
    const defPreset=framePresets.none;
    it.frameSettings=JSON.parse(JSON.stringify(defPreset));
    // Reset all frame controls
    document.getElementById('frameStyle').value=defPreset.style;
    document.getElementById('frameColor').value=defPreset.color;
    document.getElementById('frameThick').value=defPreset.thickness;
    document.getElementById('frameOpacity').value=Math.round(defPreset.opacity*100);
    document.getElementById('frameGlowOn').checked=defPreset.glow.enabled;
    document.getElementById('frameGlowColor').value=defPreset.glow.color;
    document.getElementById('frameGlowSize').value=defPreset.glow.size;
    document.getElementById('frameGlowIn').checked=defPreset.glow.inward;
    document.getElementById('frameGlowOut').checked=defPreset.glow.outward;
    document.getElementById('frameAnim').value=defPreset.animation;
    document.getElementById('frameVigOn').checked=defPreset.vignette.enabled;
    document.getElementById('frameVigStr').value=defPreset.vignette.strength;
    document.getElementById('frameVigSize').value=defPreset.vignette.size;
    const vigCEl=document.getElementById('frameVigColor');
    if(vigCEl) vigCEl.value=defPreset.vignetteColor||'#000000';
    const g1=document.getElementById('frameGrad1');
    const g2=document.getElementById('frameGrad2');
    const g3=document.getElementById('frameGrad3');
    if(g1) g1.value=defPreset.gradientColor1||defPreset.color;
    if(g2) g2.value=defPreset.gradientColor2||defPreset.color;
    if(g3) g3.value=defPreset.gradientColor3||defPreset.color;
    document.getElementById('frameThickVal').textContent=defPreset.thickness+'px';
    document.getElementById('frameOpacityVal').textContent=Math.round(defPreset.opacity*100)+'%';
    document.getElementById('glowBadge').textContent=defPreset.glow.enabled?'ВКЛ':'ВЫКЛ';
    document.getElementById('glowBadge').className='fx-switch-label'+(defPreset.glow.enabled?' on':'');
    document.getElementById('glowSizeVal').textContent=defPreset.glow.size;
    document.getElementById('vigBadge').textContent=defPreset.vignette.enabled?'ВКЛ':'ВЫКЛ';
    document.getElementById('vigBadge').className='fx-switch-label'+(defPreset.vignette.enabled?' on':'');
    document.getElementById('vigStrVal').textContent=defPreset.vignette.strength;
    document.getElementById('vigSizeVal').textContent=defPreset.vignette.size;
    // Show/hide gradient section
    const gradSection=document.getElementById('gradientSection');
    if(gradSection) gradSection.style.display='none';
    document.querySelectorAll('.frame-preset').forEach(b=>b.classList.remove('active'));
  };

  ['camBr','camCn','camSa','camWb','camSh','camHue','camSepia'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=liveUpdate;
  });
  document.getElementById('camAF').onchange=liveUpdate;
  document.getElementById('camRes').onchange=liveUpdate;
  document.getElementById('camFps').onchange=liveUpdate;
  // denoise removed from camera UI
  if(document.getElementById('camDZ')) document.getElementById('camDZ').oninput=liveUpdate;
  if(document.getElementById('camPanX')) document.getElementById('camPanX').oninput=liveUpdate;
  if(document.getElementById('camPanY')) document.getElementById('camPanY').oninput=liveUpdate;
  // Flip H/V buttons
  const flipHBtn=document.getElementById('camFlipH');
  if(flipHBtn) flipHBtn.onclick=()=>{
    src.camSettings.flipH=!src.camSettings.flipH;
    flipHBtn.classList.toggle('active',src.camSettings.flipH);
    _markDirty();_coSafe(co=>co.broadcastSourceUpdate());
  };
  const flipVBtn=document.getElementById('camFlipV');
  if(flipVBtn) flipVBtn.onclick=()=>{
    src.camSettings.flipV=!src.camSettings.flipV;
    flipVBtn.classList.toggle('active',src.camSettings.flipV);
    _markDirty();_coSafe(co=>co.broadcastSourceUpdate());
  };
  // Hardware camera probe
  if(vt){
    const st=vt.getSettings()||{};
    const infoEl=document.getElementById('camTrackInfo');
    if(infoEl) infoEl.textContent='Камера: '+(st.width||'?')+'x'+(st.height||'?')+' @ '+Math.round(st.frameRate||0)+' fps';
    try{
      if(typeof ImageCapture!=='undefined'){
        const ic=new ImageCapture(vt);
        const tCaps=vt.getCapabilities?vt.getCapabilities():{};
        const hwBody=document.getElementById('camHwBody');
        const hwCaps=document.getElementById('camHwCaps');
        const hwItems=[];
        if(tCaps.exposureCompensation&&tCaps.exposureCompensation.min!==undefined){
          hwItems.push('<div class="fx-row" style="margin-top:4px"><span class="fx-label" style="font-size:11px">Экспозиция</span><input type="range" class="fx-slider" id="hwExposure" min="'+tCaps.exposureCompensation.min+'" max="'+tCaps.exposureCompensation.max+'" step="'+(tCaps.exposureCompensation.step||1)+'" value="'+(tCaps.exposureCompensation.current||0)+'"/><span class="fx-val" id="hwExpVal" style="width:28px;text-align:right">'+(tCaps.exposureCompensation.current||0)+'</span></div>');
        }
        if(tCaps.colorTemperature&&tCaps.colorTemperature.min!==undefined){
          hwItems.push('<div class="fx-row" style="margin-top:4px"><span class="fx-label" style="font-size:11px">Цвет (hw)</span><input type="range" class="fx-slider" id="hwColorTemp" min="'+tCaps.colorTemperature.min+'" max="'+tCaps.colorTemperature.max+'" step="'+(tCaps.colorTemperature.step||100)+'" value="'+(tCaps.colorTemperature.current||6500)+'"/><span class="fx-val" id="hwColorTempVal" style="width:40px;text-align:right">'+(tCaps.colorTemperature.current||6500)+'K</span></div>');
        }
        if(tCaps.brightness&&tCaps.brightness.min!==undefined){
          hwItems.push('<div class="fx-row" style="margin-top:4px"><span class="fx-label" style="font-size:11px">Яркость (hw)</span><input type="range" class="fx-slider" id="hwBrightness" min="'+tCaps.brightness.min+'" max="'+tCaps.brightness.max+'" step="'+(tCaps.brightness.step||1)+'" value="'+(tCaps.brightness.current!=null?tCaps.brightness.current:Math.round((tCaps.brightness.min+tCaps.brightness.max)/2))+'"/><span class="fx-val" id="hwBrightnessVal" style="width:28px;text-align:right">'+(tCaps.brightness.current!=null?tCaps.brightness.current:Math.round((tCaps.brightness.min+tCaps.brightness.max)/2))+'</span></div>');
        }
        if(hwItems.length>0&&hwBody&&hwCaps){
          hwBody.innerHTML=hwItems.join('');
          hwCaps.style.display='block';
          const hwExpEl=document.getElementById('hwExposure');
          if(hwExpEl) hwExpEl.oninput=()=>{const v=parseFloat(hwExpEl.value);document.getElementById('hwExpVal').textContent=v;try{vt.applyConstraints({advanced:[{exposureCompensation:v}]});}catch(_){}};
          const hwCtEl=document.getElementById('hwColorTemp');
          if(hwCtEl) hwCtEl.oninput=()=>{const v=parseInt(hwCtEl.value);document.getElementById('hwColorTempVal').textContent=v+'K';try{vt.applyConstraints({advanced:[{colorTemperature:v,whiteBalanceMode:'manual'}]});}catch(_){}};
          const hwBrEl=document.getElementById('hwBrightness');
          if(hwBrEl) hwBrEl.oninput=()=>{const v=parseFloat(hwBrEl.value);document.getElementById('hwBrightnessVal').textContent=v;try{vt.applyConstraints({advanced:[{brightness:v}]});}catch(_){}};
        }
      }
    }catch(_){}
  }

  // Frame controls live update
  ['frameThick','frameOpacity','frameGlowSize','frameBlurSize','frameBlurStr','frameVigStr','frameVigSize','frameAnimI'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=liveFrameUpdate;
  });
  ['frameStyle','frameAnim'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onchange=liveFrameUpdate;
  });
  ['frameColor','frameGlowColor','frameGrad1','frameGrad2','frameGrad3','frameVigColor'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=liveFrameUpdate;
  });
  ['frameGlowOn','frameGlowIn','frameGlowOut','frameBlurOn','frameVigOn','frameHideFrame'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onchange=liveFrameUpdate;
  });
}

async function _changeCamResolution(src,w,h){
  try{
    const oldTrack=src.stream&&src.stream.getVideoTracks()[0];
    if(!oldTrack) return;
    const oldSettings=oldTrack.getSettings()||{};
    const deviceId=oldSettings.deviceId;
    // Hard release: stop old track BEFORE requesting new one (Windows USB cams keep buffers otherwise)
    try{oldTrack.stop();}catch(_){}
    try{src.stream.removeTrack(oldTrack);}catch(_){}
    const constraints={audio:false,video:{frameRate:{ideal:30,min:15}}};
    if(deviceId) constraints.video.deviceId={exact:deviceId};
    if(w>0&&h>0){constraints.video.width={ideal:w};constraints.video.height={ideal:h};}
    const ns=await navigator.mediaDevices.getUserMedia(constraints);
    const nt=ns.getVideoTracks()[0];
    if(!nt){msg('Не удалось переключить разрешение','error');return;}
    src.stream.addTrack(nt);
    if(src.el){
      src.el.srcObject=src.stream;
      try{await src.el.play();}catch(_){}
    }
    msg(w&&h?('Разрешение: '+w+'×'+h):'Разрешение: авто','success');
  }catch(e){
    msg('Не удалось применить разрешение: '+(e.message||e),'error');
  }
}

// ═══════════════════════════════════════════════════════════
//  STREAM
// ═══════════════════════════════════════════════════════════
async function startStream(){
  if(S.streaming)return;
  const k=D.streamKey.value.trim();
  if(!k){msg('Введите ключ стрима','error');return;}

  // Detect hardware encoder once per session and cache result
  if(!S._hwEncoder){
    try{
      const r=await window.electronAPI.detectHwEncoder();
      S._hwEncoder=r&&r.encoder?r.encoder:'libx264';
      if(window.__sbDev)console.log('[Stream] HW encoder:',S._hwEncoder);
      const infoEl=document.getElementById('hwEncoderInfo');
      if(infoEl){
        const label=S._hwEncoder==='h264_nvenc'?'NVENC (NVIDIA GPU)'
          :S._hwEncoder==='h264_amf'?'AMF (AMD GPU)'
          :S._hwEncoder==='h264_qsv'?'QSV (Intel GPU)'
          :'libx264 (CPU)';
        infoEl.textContent='Кодировщик: '+label;
      }
    }catch(e){S._hwEncoder='libx264';}
  }
  const p=D.streamPlatform.value;
  let srv;
  switch(p){
    case'twitch':srv='rtmp://live.twitch.tv/app';break;
    case'kick':srv='rtmps://fa723fc1b171.global-contribute.live-video.net:443/app';break;
    case'youtube':srv='rtmp://a.rtmp.youtube.com/live2';break;
    case'custom':srv=D.customServer.value.trim();break;
    default:srv='';
  }
  if(!srv){msg('Укажите сервер','error');return;}
  if(!/^rtmps?:\/\//i.test(srv)){msg('Адрес должен начинаться с rtmp:// или rtmps://','error');return;}
  // Warn about Kick free-tier limits (1080p / >4500 kbps silently dropped on AWS IVS edge)
  if(p==='kick'){
    const br=parseInt(D.streamBitrateInput.value)||6000;
    const rs=D.streamResolution.value||'1280x720';
    if(br>4500||/1920x1080/.test(rs)){
      msg('Внимание: Kick free-tier лимит 720p @ 4500 kbps. Партнёрский статус нужен для 1080p/6000+. Если плеер не показывает — снизь разрешение/битрейт.','info');
    }
  }
  // Auto-fix common AWS IVS URL mistakes (Kick / Twitch hosted on IVS):
  // they require the application path '/app' or '/app2' on port 443.
  if(/live-video\.net|twitch-ingest/i.test(srv)){
    let fixed=srv;
    // Strip trailing slashes for predictable matching
    fixed=fixed.replace(/\/+$/,'');
    // If port missing, add :443
    if(!/:\d+(\/|$)/.test(fixed)){
      fixed=fixed.replace(/^(rtmps?:\/\/[^\/]+)/i,'$1:443');
    }
    // If path missing, append /app
    if(!/\/[a-zA-Z0-9_-]+(\/.*)?$/.test(fixed.replace(/^rtmps?:\/\/[^\/]+/i,''))){
      fixed=fixed+'/app';
    }
    if(fixed!==srv){
      console.warn('[Stream] Auto-corrected RTMP URL:',srv,'→',fixed);
      msg('URL скорректирован: добавлен :443/app для AWS IVS','info');
      srv=fixed;
      if(p==='custom'&&D.customServer){D.customServer.value=srv;_scheduleSettingsSave();}
    }
  }
  // Sanity check that we have at least one source on scene
  const haveSrc=S.items.some(x=>{const s=S.srcs.find(z=>z.id===x.sid);return s&&s.visible&&s.el;});
  if(!haveSrc){msg('Добавьте источник на сцену','error');return;}
  ensureAudioCtx();_resumeAudioCtx();_rebuildCombinedStream();
  // Persist current settings before starting (encrypted via main process)
  _persistSettings();
  S.rtmp.setServer(srv);
  S.rtmp.setStreamKey(k);
  S.rtmp.setBitrate(parseInt(D.streamBitrateInput.value)||6000);
  S.rtmp.setResolution(D.streamResolution.value||'1280x720');
  S.rtmp.setFps(S._captureFps||60);
  S.rtmp.setEncoder(S._hwEncoder||'libx264');
  S.rtmp.start();
}

function startRecording(){
  ensureAudioCtx();_resumeAudioCtx();_rebuildCombinedStream();
  console.log('[Rec] Starting recording, combinedStream:',S.combinedStream?'yes':'no','tracks:',S.combinedStream?S.combinedStream.getTracks().length:0);
  if(!S.combinedStream){msg('Нет потока — добавьте источники','error');return;}
  // Warn about echo if mic monitoring is on
  const monitoringMics=S.srcs.filter(s=>s.monitor&&!s.muted&&s.stream&&s.stream.getAudioTracks().length);
  if(monitoringMics.length>0 && S.desktopAudioId){
    msg('Внимание: мониторинг микрофона может дать эхо в записи','info');
  }
  S.rtmp.startRecording();
}

// ═══════════════════════════════════════════════════════════
//  WebRTC
// ═══════════════════════════════════════════════════════════
async function createRoom(){
  try{
    const now=Date.now();if(now-S._lastRoomCreateAt<5000){msg('Подождите 5 секунд','info');return;}
    S._lastRoomCreateAt=now;
    // Check room limit (max 2)
    if(window.electronAPI?.roomsList){
      const lr=await window.electronAPI.roomsList();
      if(lr&&lr.ok&&Array.isArray(lr.data)&&lr.data.length>=2){
        msg('Максимум 2 комнаты. Удалите старую во вкладке «Мои комнаты».','error');return;
      }
    }
    if(!S.wrtc)S.wrtc=new WebRTCManager();
    S.wrtc._userJoinedRoom=true;
    // Auto-fetch TURN credentials from server
    try{const tc=await window.electronAPI.getTurnCredentials?.();if(tc&&tc.url)S.wrtc.setTurnConfig(tc.url,tc.username,tc.credential);}catch{}
    setupW();
    D.connectError.style.display='none';
    D.btnCreateRoom.textContent='Создание...';D.btnCreateRoom.disabled=true;
    if(window.electronAPI&&window.electronAPI.roomsCreate){
      const roomName=(D.roomNameInput?.value||'').trim();
      const r=await window.electronAPI.roomsCreate({name:roomName});
      if(!r||!r.ok){throw new Error(r?.error||'Ошибка создания комнаты');}
      const code=r.data?.code;
      if(!code){throw new Error('Сервер не вернул код комнаты');}
      S.wrtc.roomCode=code;
      S.wrtc.myPeerId=S.settings?.profile?.serverId||S.settings?.profile?.id||'local';
      S.wrtc.setSignalingChannel((signalMsg)=>{
        window.electronAPI.presenceSend(JSON.stringify(signalMsg));
      });
      if(S.wrtc.onRoomCreated)S.wrtc.onRoomCreated(code,S.wrtc.myPeerId);
      // Source streams will be sent when peers connect via onPeerConnectionsReady callback
      ensureAudioCtx();_rebuildCombinedStream();
      msg('Комната создана: '+code,'ok');
    }else{
      S.wrtc.setSignalingServer('wss://streambro.ru/signaling');
      await S.wrtc.connect();S.wrtc.createRoom();
    }
    D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;
  }catch(e){
    D.connectError.textContent='Ошибка: '+(e.message||e);D.connectError.style.display='block';
    D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;
  }
}

async function _autoRejoinRoom(){
  // If user was in a P2P room before restart, automatically rejoin it.
  // roomCode is saved in settings.p2p.roomCode and cleared on explicit leave.
  const savedRoomCode=S.settings?.p2p?.roomCode;
  if(!savedRoomCode) return;
  // Only rejoin if user is logged in (has Presence WS) — rooms are server-managed
  if(!window.electronAPI?.roomsJoin) return;
  _p2pLog('[P2P] Auto-rejoining room: '+savedRoomCode);
  // Delay slightly to let Presence WS settle
  setTimeout(async()=>{
    try{
      // Verify the room still exists on the server
      const info=await window.electronAPI.roomsGet(savedRoomCode);
      if(!info||!info.ok||!info.data||info.data.status!=='ACTIVE'){
        _p2pLog('[P2P] Saved room no longer active, clearing');
        S.roomCode=null;
        _scheduleSettingsSave();
        return;
      }
      // Rejoin — same as manually entering the code
      D.joinRoomCode.value=savedRoomCode;
      await joinRoom();
      _p2pLog('[P2P] Auto-rejoin succeeded');
    }catch(e){
      _p2pLog('[P2P] WARN: Auto-rejoin failed: '+e.message);
      S.roomCode=null;
      _scheduleSettingsSave();
    }
  },2000);
}

async function joinRoom(){
  try{
    if(!S.wrtc)S.wrtc=new WebRTCManager();
    S.wrtc._userJoinedRoom=true;
    try{const tc=await window.electronAPI.getTurnCredentials?.();if(tc&&tc.url)S.wrtc.setTurnConfig(tc.url,tc.username,tc.credential);}catch{}
    setupW();
    const c=D.joinRoomCode.value.trim().toUpperCase();
    if(!c){D.connectError.textContent='Введите код';D.connectError.style.display='block';return;}
    D.connectError.style.display='none';
    D.btnJoinRoom.textContent='Подключение...';D.btnJoinRoom.disabled=true;
    if(window.electronAPI&&window.electronAPI.roomsJoin){
      const r=await window.electronAPI.roomsJoin(c);
      if(!r||!r.ok){throw new Error(r?.error||'Комната не найдена');}
      S.wrtc.roomCode=c;
      S.wrtc.myPeerId=S.settings?.profile?.serverId||S.settings?.profile?.id||'local';
      S.wrtc.setSignalingChannel((signalMsg)=>{
        window.electronAPI.presenceSend(JSON.stringify(signalMsg));
      });
      const roomData=r.data||{};
      const peerIds=roomData.members?roomData.members.filter(m=>m.userId!==S.wrtc.myPeerId).map(m=>m.userId):[];
      // When joining an existing room, we are the initiator for our PeerConnections
      // (we create data channel, send offer). The room creator will receive
      // peer-joined notification and create their PC as joiner (isInitiator=false).
      for(const pid of peerIds){S.wrtc._createPeerConnection(pid,true);}
      ensureAudioCtx();_rebuildCombinedStream();
      _sendSourceStreamsToPeers();
      if(S.wrtc.onRoomJoined)S.wrtc.onRoomJoined(c,S.wrtc.myPeerId,peerIds);
      msg('Вы в комнате: '+c,'ok');
    }else{
      S.wrtc.setSignalingServer('wss://streambro.ru/signaling');
      await S.wrtc.connect();S.wrtc.joinRoom(c);
    }
    D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;
  }catch(e){
    D.connectError.textContent='Ошибка: '+(e.message||e);D.connectError.style.display='block';
    D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;
  }
}
function setupW(){
  // ── Co-session engine — wired ONCE per page lifetime ──
  if(!S.co){
    S.co=new CoScene({log:(...a)=>{ if(window.__sbDev) console.log(...a); }});
    S.co.setHandlers({
      // Snapshot for handshake: send our own srcs (with stream stripped) + items.
      // The receiver uses `msid` to attach the matching ontrack media.
      // msid = the MediaStream id that the peer sees in ontrack (same as src.stream.id
      // since we send original streams, not new MediaStream copies).
      getSnapshot:()=>({
        srcs:S.srcs.map(s=>({
          gid:s.id,ownerPeerId:s.ownerPeerId,type:s.type,name:s.name,
          isPeer:s.isPeer,peerId:s.peerId,
          visible:s.visible,locked:!!s.locked,vol:s.vol,muted:s.muted,
          monitor:!!s.monitor,channelMode:s.channelMode||'auto',
          msid:s.stream?s.stream.id:(s.msid||null),
          camSettings:s.camSettings,fxState:s.fxState,
        })),
        items:S.items.map(it=>JSON.parse(JSON.stringify(it))),
        order:S.srcs.map(s=>s.id),
      }),
      applySrcAdd:(meta,pending,fromPid)=>_applyRemoteSrcAdd(meta,pending,fromPid),
      applySrcUpdate:(meta)=>_applyRemoteSrcUpdate(meta),
      applySrcRemove:(gid)=>{ const s=S.srcs.find(x=>x.id===gid); if(s) rmSrc(gid,{fromRemote:true}); },
      applySrcReorder:(order)=>_applySrcReorder(order),
      applyItemUpsert:(it)=>_applyRemoteItemUpsert(it),
      applyItemRemove:(sid)=>{ S.items=S.items.filter(x=>x.sid!==sid); rebuildZ(); updateE(); },
      applyCursor:(pid,x,y)=>{ S.remoteCursors.set(pid,{x,y,t:Date.now()}); },
    });
  }
  S.wrtc.onRoomCreated=c=>{
    S.roomCode=c;
    S.myPeerId=S.wrtc.myPeerId;
    if(S.co) S.co.setMyPeerId(S.myPeerId);
    D.roomCodeDisplay.style.display='block';D.roomCode.textContent=c;
    D.btnCreateRoom.textContent='Комната создана';D.btnCreateRoom.disabled=false;
    _showActiveRoom(c);
    uRS('online','Комната: '+c);msg('Комната создана! '+c,'success');
    _scheduleSettingsSave(); // persist roomCode for auto-rejoin
  };
  S.wrtc.onRoomJoined=c=>{
    S.roomCode=c;
    S.myPeerId=S.wrtc.myPeerId;
    if(S.co) S.co.setMyPeerId(S.myPeerId);
    _showActiveRoom(c);
    uRS('online','Подключён: '+c);msg('Подключён','success');
    D.btnJoinRoom.textContent='Подключён';D.btnJoinRoom.disabled=false;
    _scheduleSettingsSave(); // persist roomCode for auto-rejoin
  };
  S.wrtc.onPeerConnected=()=>msg('Друг подключился!','success');
  S.wrtc.onPeerDisconnected=pid=>{
    S.srcs=S.srcs.filter(s=>{
      if(s.isPeer&&s.peerId===pid){
        if(s.stream)s.stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});
        _disconnectSource(s.id);return false;
      }
      return true;
    });
    S.items=S.items.filter(x=>S.srcs.some(s=>s.id===x.sid));
    if(S.co) S.co.detachPeer(pid);
    S.remoteCursors.delete(pid);
    // Clean up dedup set for this peer's streams
    for(const s of S.srcs){/* already removed above */}
    // Note: _handledPeerStreams entries are per-stream.id, not per-peer,
    // so we don't clear them here — they'll be garbage collected naturally
    // when the stream ends.
    msg('Друг отключился','info');renderSources();renderMixer();updateE();
  };
  S.wrtc.onIceFailed=pid=>{
    msg('Не удалось подключиться к другу. Проверьте интернет.','error');
  };
  // Wire co-session data channels as soon as they appear
  S.wrtc.onDataChannel=(dc,pid)=>{ if(S.co) S.co.attachChannel(pid,dc); };
  // Wire ontrack to bind incoming MediaStreams to gids (instead of auto-creating peer items)
  S.wrtc.onPeerTrack=(event,pid)=>_onPeerTrack(event,pid);
  // When peer connections are ready (room-joined or peer-joined), send our source streams
  S.wrtc.onPeerConnectionsReady=(peerIds)=>{
    _p2pLog('[P2P] onPeerConnectionsReady — sending source streams to '+peerIds);
    ensureAudioCtx();_rebuildCombinedStream();
    _sendSourceStreamsToPeers();
  };
  // onRemoteStream is intentionally NOT wired — _onPeerTrack handles all
  // incoming tracks. The legacy _handleRemoteStream created duplicates
  // (both a CoScene source AND a fallback source for the same stream).
  S.wrtc.onError=m=>{
    D.connectError.textContent=m;D.connectError.style.display='block';
    D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;
    D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;
    _hideActiveRoom();
  };
}

// ─── Co-session: apply remote ops ──────────────────────────────────────────

function _applyRemoteSrcAdd(meta,pending,fromPid){
  // Don't recreate if we already have it (snapshot replays etc.)
  if(S.srcs.some(s=>s.id===meta.gid)) return;
  // Also check by msid — fallback may have already created a source for this stream
  // before CoScene src.add arrived. In that case, update the existing source's gid
  // instead of creating a duplicate.
  if(meta.msid){
    const existingByMsid=S.srcs.find(s=>s.msid===meta.msid);
    if(existingByMsid){
      if(window.__sbDev) console.log('[CoScene] src.add matched existing source by msid:',meta.gid,'→ existing id='+existingByMsid.id,'name='+existingByMsid.name);
      // Update the existing source's gid to match the CoScene gid
      // so future src.update/remove ops can find it
      existingByMsid.id=meta.gid;
      existingByMsid.gid=meta.gid;
      // Also update name/type if different from fallback guess
      if(meta.name&&meta.name!==existingByMsid.name) existingByMsid.name=meta.name;
      if(meta.type&&meta.type!==existingByMsid.type) existingByMsid.type=meta.type;
      renderSources();renderMixer();
      return;
    }
  }
  // For OUR own gid (meta.ownerPeerId === our id) — never re-create (echo guard)
  if(meta.ownerPeerId&&meta.ownerPeerId===S.myPeerId) return;
  // If incoming streams already arrived, attach them; otherwise stash the meta
  // and wait for the matching ontrack to arrive (don't create a dead source with empty MediaStream).
  let videoStream=null,audioStream=null;
  if(pending&&Array.isArray(pending.streams)){
    for(const e of pending.streams){
      if(e.kind==='video'&&!videoStream) videoStream=e.stream;
      if(e.kind==='audio'&&!audioStream) audioStream=e.stream;
    }
  }
  // For audio-only sources (mic/desktop), prefer audioStream over videoStream
  const t=meta.type||'camera';
  const stream=(t==='mic'||t==='desktop') ? (audioStream||videoStream) : (videoStream||audioStream);
  // If no stream available yet, stash the src.add in CoScene's pending and wait for ontrack
  if(!stream){
    if(window.__sbDev) console.log('[CoScene] src.add without stream yet, stashing:',meta.gid,meta.type,'msid='+meta.msid);
    if(S.co&&meta.msid){
      S.co._pendingSrcByMsid.set(meta.msid,{srcMeta:meta,fromPid:fromPid||meta.ownerPeerId});
    }
    return;
  }
  const opts={gid:meta.gid,ownerPeerId:meta.ownerPeerId,msid:meta.msid,suppressBroadcast:true};
  if(t==='mic'||t==='desktop'){
    addAudioSource(t,meta.name||'Звук друга',stream,true,fromPid||meta.ownerPeerId,opts);
  }else{
    addVideoSource(t,meta.name||'Камера друга',stream,true,fromPid||meta.ownerPeerId,opts);
  }
}

function _applyRemoteSrcUpdate(meta){
  if(!meta||!meta.gid) return;
  const s=S.srcs.find(x=>x.id===meta.gid);
  if(!s) return;
  // Only patch the user-visible fields. NEVER touch MediaStream/element/audio bindings.
  let needAudio=false, needRender=false;
  if(meta.name!==undefined&&meta.name!==s.name){s.name=meta.name;needRender=true;}
  if(meta.visible!==undefined&&meta.visible!==s.visible){s.visible=meta.visible;needRender=true;}
  if(meta.locked!==undefined&&meta.locked!==!!s.locked){s.locked=!!meta.locked;needRender=true;}
  if(meta.vol!==undefined&&Number.isFinite(meta.vol)&&meta.vol!==s.vol){s.vol=meta.vol;needAudio=true;}
  if(meta.muted!==undefined&&!!meta.muted!==!!s.muted){s.muted=!!meta.muted;needAudio=true;}
  if(meta.monitor!==undefined&&!!meta.monitor!==!!s.monitor){s.monitor=!!meta.monitor;needAudio=true;}
  if(meta.channelMode!==undefined&&meta.channelMode!==s.channelMode){
    s.channelMode=meta.channelMode;
    // Re-route audio chain if channel mode changed
    try{ _disconnectSource(s.id); _connectSource(s); _rebuildCombinedStream(); }catch(_){}
  }
  if(meta.camSettings){ /* camSettings are applied on the peer's side; we receive the processed video */ }
  if(meta.fxState){ Object.assign(s.fxState||(s.fxState={}),meta.fxState); needAudio=true; }
  if(needAudio) try{ _updateGain(s); }catch(_){}
  if(needRender){ try{ renderSources(); renderMixer(); updateE(); }catch(_){} }
}

function _applyRemoteItemUpsert(remoteIt){
  const idx=S.items.findIndex(x=>x.sid===remoteIt.sid);
  if(idx>=0){
    // Existing item — only patch non-visual fields.
    // Each user controls their own layout for remote sources (position, size, crop, frames).
    // We only sync: name, visible, z-order.
    const it=S.items[idx];
    if(remoteIt.name!==undefined) it.name=remoteIt.name;
    if(remoteIt.visible!==undefined) it.visible=remoteIt.visible;
    // z-order is local — don't override from remote
  }else{
    // New item — create with local defaults. The source will appear at
    // a default position/size and the user arranges it themselves.
    // Use sensible defaults for a new remote source.
    S.items.push(Object.assign({
      cx:0.5,cy:0.5,w:0.5,h:0.5,z:0,rot:0,flipH:false,flipV:false,
      crop:{l:0,t:0,r:0,b:0},cropMask:'none',
      frameSettings:JSON.parse(JSON.stringify(framePresets.none)),
      uncropW:1,uncropH:1,uncropCx:0.5,uncropCy:0.5,
      origVW:0,origVH:0,naturalAR:1,prevRect:null,panDx:0,panDy:0,
      srcName:remoteIt.srcName||'',
    },remoteIt));
  }
  rebuildZ();updateE();
}

function _applySrcReorder(order){
  if(!Array.isArray(order)||!order.length) return;
  const byId=new Map(S.srcs.map(s=>[s.id,s]));
  const seen=new Set();
  const next=[];
  for(const gid of order){
    const s=byId.get(gid);
    if(s){next.push(s);seen.add(gid);}
  }
  // Append anything not in the order so it's not lost
  for(const s of S.srcs) if(!seen.has(s.id)) next.push(s);
  S.srcs=next;
  rebuildZ();renderSources();
}

// ─── Incoming WebRTC tracks: bind to a co-session src by msid ───────────────

function _onPeerTrack(event,fromPid){
  const stream=event.streams&&event.streams[0];
  if(!stream) return;
  const kind=event.track?event.track.kind:'';
  const trackState=event.track?{readyState:event.track.readyState,muted:event.track.muted,enabled:event.track.enabled}:{};
  _p2pLog('[P2P] onPeerTrack: stream='+stream.id+' kind='+kind+' from='+fromPid+' trackState='+JSON.stringify(trackState)+' streamTracks='+stream.getTracks().length);

  // Dedup: if we already processed this exact stream.id, this is just
  // an additional track (audio arriving after video for the same stream).
  if(S._handledPeerStreams.has(stream.id)){
    _p2pLog('[P2P] dedup: additional track for stream '+stream.id+' '+kind);
    // Find the existing source by msid and reconnect audio if needed
    const existing=S.srcs.find(s=>s.msid===stream.id);
    if(existing&&kind==='audio'){
      // Add incoming audio track to existing video source's stream
      try{
        const audioTracks=stream.getAudioTracks();
        for(const at of audioTracks){
          if(!existing.stream.getAudioTracks().some(t=>t.id===at.id)){
            existing.stream.addTrack(at);
          }
        }
        _disconnectSource(existing.id); _connectSource(existing); _rebuildCombinedStream();
      }catch(e){_p2pLog('[P2P] WARN: dedup reconnect failed: '+e.message);}
    }
    return;
  }
  S._handledPeerStreams.add(stream.id);

  // Renegotiate-induced rebind: WebRTC may deliver an existing logical track
  // through a NEW MediaStream wrapper (different stream.id) when negotiation
  // re-runs (peer removed/re-added a sender, or our own setStreams ran). If we
  // already have a peer source from this same peerId+kind whose old stream has
  // no live tracks, just rebind it to the new stream — DO NOT create a duplicate.
  // This protects against the "Микрофон друга + Звук друга" duplicate.
  try{
    const peerSources=S.srcs.filter(s=>s.isPeer&&s.peerId===fromPid);
    for(const ps of peerSources){
      if(!ps.stream) continue;
      // Match kind: video stream → video peer source, audio stream → audio peer source
      const psKind=(ps.type==='peer-video'||ps.type==='camera'||ps.type==='screen'||ps.type==='window')?'video':'audio';
      if(psKind!==kind) continue;
      // Only rebind if old stream has no live tracks of this kind
      const oldLive=ps.stream.getTracks().filter(t=>t.kind===kind&&t.readyState!=='ended');
      if(oldLive.length>0) continue;
      _p2pLog('[P2P] Rebinding peer source after renegotiate: '+ps.name+' (old msid='+ps.msid+' → new msid='+stream.id+')');
      // Cancel any pending removetrack grace timer
      if(ps._removetrackTimer){clearTimeout(ps._removetrackTimer);ps._removetrackTimer=null;}
      // Update msid and stream reference
      if(ps.msid) S._handledPeerStreams.delete(ps.msid);
      ps.stream=stream;
      ps.msid=stream.id;
      ps._trackHandlersWired=false; // allow re-wiring for new stream
      _disconnectSource(ps.id); _connectSource(ps); _rebuildCombinedStream();
      _wireTrackEndHandlers(ps);
      renderMixer();updateE();_markDirty();
      return;
    }
  }catch(e){_p2pLog('[P2P] WARN: rebind check failed: '+e.message);}

  // Try CoScene binding first — if src.add already arrived via data-channel,
  // we can match this track to the correct source by msid.
  if(S.co){
    const r=S.co.bindIncomingStream(stream,kind,fromPid);
    if(r){
      if(window.__sbDev) console.log('[CoScene] track→src bound:',stream.id,r.srcMeta.gid);
      const pending={streams:[{stream,kind,peerId:fromPid}]};
      _applyRemoteSrcAdd(r.srcMeta,pending,r.fromPid||fromPid);
      return;
    }
  }
  // Fallback: no CoScene match yet — stash this stream and wait for src.add
  // to arrive over data-channel (typically within 200-400ms).
  // If it doesn't arrive, create a default source after a grace period.
  _p2pLog('[P2P] No CoScene match yet, stashing stream '+stream.id+' '+kind+' from '+fromPid);
  // Store pending stream for CoScene to pick up later
  if(S.co){
    const list=S.co._pendingTracksByMsid.get(stream.id)||{streams:[]};
    list.streams.push({stream,kind,peerId:fromPid});
    list.peerId=fromPid;
    S.co._pendingTracksByMsid.set(stream.id,list);
  }
  // Grace period: if no src.add arrives within 1.5s, create a default source
  setTimeout(()=>{
    // Check if CoScene already handled it
    if(S.srcs.some(s=>s.msid===stream.id)) return;
    _p2pLog('[P2P] Grace expired, creating fallback source for stream '+stream.id+' '+kind);
    // IMPORTANT: pass the original WebRTC stream directly — do NOT create
    // new MediaStream from extracted tracks, that breaks audio decoding.
    try{
    if(kind==='video'){
      addVideoSource('peer-video','Камера друга',stream,true,fromPid,{msid:stream.id});
    }else if(kind==='audio'){
      // Try to guess type: if stream also has video tracks → likely desktop audio
      const hasVideo=stream.getVideoTracks().length>0;
      // Count existing peer audio sources from this peer
      const peerAudioCount=S.srcs.filter(s=>s.isPeer&&s.peerId===fromPid&&(s.type==='mic'||s.type==='desktop')).length;
      // Heuristic: first audio from peer = mic, second = desktop
      const srcType=hasVideo?'desktop':(peerAudioCount>0?'desktop':'mic');
      const srcName=hasVideo?'Звук друга':(peerAudioCount>0?'Звук друга':'Микрофон друга');
      _p2pLog('[P2P] Fallback audio type guess: hasVideo='+hasVideo+' peerAudioCount='+peerAudioCount+' → '+srcType+' / '+srcName);
      addAudioSource(srcType,srcName,stream,true,fromPid,{msid:stream.id});
    }
    }catch(e){_p2pLog('[P2P] WARN: Fallback source creation failed: '+e.message);}
  },2500);
}

// Legacy fallback: for older peers without coscene OR if the protocol stalls.
// Creates a "Камера друга / Микрофон друга" item just like before.
function _handleRemoteStream(st,pid,event){
  if(!st) return;
  if(S.co){
    const msid=st.id;
    // Was already handled by _onPeerTrack via msid binding? If a src for this msid
    // exists (now or after a short grace), do nothing.
    const matched=S.srcs.some(s=>s.msid===msid);
    if(matched) return;
  }
  // Wait briefly for src.add to arrive over data-channel; if not, create a default item.
  setTimeout(()=>{
    const matched=S.srcs.some(s=>s.msid===st.id);
    if(matched) return;
    if(st.getVideoTracks().length) addVideoSource('camera','Камера друга',new MediaStream(st.getVideoTracks()),true,pid);
    if(st.getAudioTracks().length) addAudioSource('mic','Микрофон друга',new MediaStream(st.getAudioTracks()),true,pid);
  },800);
}
function uRS(s,t){D.roomStatus.querySelector('.status-dot').className='status-dot '+s;D.roomStatus.querySelector('.status-text').textContent=t;}
function copyCode(){if(!S.roomCode)return;navigator.clipboard.writeText(S.roomCode).then(()=>{msg('Код скопирован!','success');D.btnCopyCode.textContent='Скопировано!';setTimeout(()=>D.btnCopyCode.textContent='Скопировать код',2000);}).catch(()=>msg('Код: '+S.roomCode,'info'));}

// ─── My Rooms ──────────────────────────────────────────────
function _showActiveRoom(code){
  if(D.btnLeaveRoomTop)D.btnLeaveRoomTop.style.display='inline-flex';
  const expBtn=document.getElementById('btnExportP2pLog');
  if(expBtn) expBtn.style.display='inline-flex';
}
function _hideActiveRoom(){
  if(D.btnLeaveRoomTop)D.btnLeaveRoomTop.style.display='none';
  const expBtn=document.getElementById('btnExportP2pLog');
  if(expBtn) expBtn.style.display='none';
  S.roomCode=null;
  _scheduleSettingsSave(); // persist roomCode=null so auto-rejoin doesn't fire on restart
}
async function _exportP2pLog(){
  const header='StreamBro P2P Debug Log\n'+
    'Version: '+navigator.userAgent.match(/StreamBro\/([\d.]+)/)?.[1]+' (1.4.0-beta11)\n'+
    'Date: '+new Date().toISOString()+'\n'+
    'Room: '+(S.roomCode||'none')+'\n'+
    'Sources: '+S.srcs.map(s=>s.name+'('+s.type+(s.isPeer?',peer':'')+')').join(', ')+'\n'+
    '---\n';
  const log=header+(window._sbP2pLog||S._p2pLog||[]).join('\n');
  const r=await window.electronAPI.saveP2pLog(log);
  if(r&&r.success) msg('Лог сохранён: '+r.path,'success');
  else msg('Ошибка: '+(r?.error||'не удалось сохранить'),'error');
}
async function loadMyRooms(){
  const el=D.myRoomsList;if(!el)return;
  el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px">Загрузка...</div>';
  try{
    const r=await window.electronAPI.roomsList();
    if(!r||!r.ok){
      const reason=r?.error||'неизвестная ошибка';
      el.innerHTML=`<div style="color:var(--muted);text-align:center;padding:20px">${_esc(reason)}</div>`;
      return;
    }
    const rooms=r.data||[];
    if(!rooms.length){el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px">Нет активных комнат.<br>Создайте новую на вкладке «Создать».</div>';return;}
    el.innerHTML=`<div style="color:var(--text2);font-size:11px;margin-bottom:8px">Ваши комнаты (${rooms.length}/2)</div>`+rooms.map(rm=>{
      const isCurrentRoom=S.roomCode===rm.code;
      const members=(rm.members||[]).length||1;
      const name=rm.name||rm.code;
      return `<div class="my-room-card${isCurrentRoom?' my-room-current':''}" data-code="${rm.code}">
        <div class="my-room-info">
          <div class="my-room-name">${_esc(name)}${isCurrentRoom?' <span style="color:var(--accent);font-size:10px">● текущая</span>':''}</div>
          <div class="my-room-meta"><span style="color:var(--accent)">Создатель</span></div>
        </div>
        <div class="my-room-actions">
          <button class="btn sm" data-action="copy" data-code="${rm.code}">Скопировать код</button>
          ${isCurrentRoom?`<button class="btn sm btn-danger" data-action="leave" data-code="${rm.code}">Покинуть</button>`:`<button class="btn sm" data-action="rejoin" data-code="${rm.code}">Войти</button>`}
          <button class="btn sm" data-action="rename" data-code="${rm.code}" data-name="${_esc(rm.name||'')}">✏️</button>
          <button class="btn sm btn-danger" data-action="delete" data-code="${rm.code}">🗑</button>
        </div>
      </div>`;
    }).join('');
    // Wire action buttons
    el.querySelectorAll('[data-action]').forEach(btn=>{
      btn.onclick=async()=>{
        const action=btn.dataset.action;
        const code=btn.dataset.code;
        if(action==='copy'){navigator.clipboard.writeText(code).then(()=>{btn.textContent='Скопировано!';setTimeout(()=>btn.textContent='Скопировать код',1500);}).catch(()=>msg('Код: '+code,'info'));}
        else if(action==='rejoin') {_rejoinRoom(code);}
        else if(action==='leave') {await leaveCurrentRoom();loadMyRooms();}
        else if(action==='rename') {_renameRoomPrompt(code,btn.dataset.name);}
        else if(action==='delete') {_deleteRoomPrompt(code);}
      };
    });
  }catch(e){
    el.innerHTML='<div style="color:var(--muted);text-align:center;padding:20px">Ошибка загрузки</div>';
  }
}

async function _rejoinRoom(code){
  if(S.roomCode===code&&S.wrtc){msg('Вы уже в этой комнате','info');return;}
  // Leave current room first if in one
  if(S.roomCode) await leaveCurrentRoom();
  D.joinRoomCode.value=code;
  await joinRoom();
}

function _renameRoomPrompt(code,currentName){
  // Find the rename button and replace with inline input
  const card=document.querySelector(`.my-room-card[data-code="${code}"]`);
  if(!card)return;
  const actionsEl=card.querySelector('.my-room-actions');
  if(!actionsEl||actionsEl.querySelector('.rename-input'))return;
  const input=document.createElement('input');
  input.type='text';input.className='rename-input';input.value=currentName||'';
  input.placeholder='Название';input.maxLength=50;
  input.style.cssText='width:100px;font-size:12px;padding:3px 6px;border:1px solid var(--accent);border-radius:4px;background:var(--bg1);color:var(--text)';
  const okBtn=document.createElement('button');okBtn.className='btn sm';okBtn.textContent='OK';
  const cancelBtn=document.createElement('button');okBtn.className='btn sm';cancelBtn.textContent='✕';
  cancelBtn.style.cssText='color:var(--muted)';
  // Hide existing buttons, show input
  const existing=actionsEl.querySelectorAll('.btn');
  existing.forEach(b=>b.style.display='none');
  actionsEl.prepend(input,okBtn,cancelBtn);
  input.focus();input.select();
  const finish=(save)=>{
    if(save&&input.value.trim()&&input.value.trim()!==currentName){
      window.electronAPI.roomsRename(code,input.value.trim()).then(r=>{
        if(r&&r.ok){msg('Комната переименована','success');loadMyRooms();}
        else{msg(r?.error||'Ошибка переименования','error');loadMyRooms();}
      }).catch(()=>{msg('Ошибка переименования','error');loadMyRooms();});
    }else{loadMyRooms();}
  };
  okBtn.onclick=()=>finish(true);
  cancelBtn.onclick=()=>finish(false);
  input.onkeydown=e=>{if(e.key==='Enter')finish(true);if(e.key==='Escape')finish(false);};
}

function _deleteRoomPrompt(code){
  // Use a simple custom confirm approach
  const card=document.querySelector(`.my-room-card[data-code="${code}"]`);
  if(!card||card.dataset.deleting)return;
  card.dataset.deleting='1';
  const actionsEl=card.querySelector('.my-room-actions');
  if(!actionsEl)return;
  const existing=actionsEl.querySelectorAll('.btn');
  existing.forEach(b=>b.style.display='none');
  const warn=document.createElement('span');warn.style.cssText='font-size:11px;color:#ef4444;margin-right:4px';warn.textContent='Удалить?';
  const yesBtn=document.createElement('button');yesBtn.className='btn sm btn-danger';yesBtn.textContent='Да';
  const noBtn=document.createElement('button');noBtn.className='btn sm';noBtn.textContent='Нет';
  actionsEl.prepend(warn,yesBtn,noBtn);
  const finish=(del)=>{
    if(del){
      window.electronAPI.roomsDelete(code).then(r=>{
        if(r&&r.ok){msg('Комната удалена','success');if(S.roomCode===code)_hideActiveRoom();loadMyRooms();}
        else{msg(r?.error||'Ошибка удаления','error');loadMyRooms();}
      }).catch(()=>{msg('Ошибка удаления','error');loadMyRooms();});
    }else{delete card.dataset.deleting;loadMyRooms();}
  };
  yesBtn.onclick=()=>finish(true);
  noBtn.onclick=()=>finish(false);
}

async function leaveCurrentRoom(){
  if(!S.roomCode)return;
  const code=S.roomCode;
  // Check if user is the creator — creators keep the room alive when disconnecting
  let isCreator=false;
  try{
    const info=await window.electronAPI.roomsGet(code);
    if(info&&info.ok&&info.data){
      isCreator=info.data.creatorId===(S.settings?.profile?.serverId||'');
    }
  }catch{}
  // Only call server leave for non-creators (creators just disconnect WebRTC)
  if(!isCreator){
    try{await window.electronAPI.roomsLeave(code);}catch{}
  }
  // Clean up WebRTC
  if(S.wrtc){
    try{S.wrtc.disconnect();}catch(_){}
    S.wrtc=null;
  }
  // Remove peer sources
  S.srcs=S.srcs.filter(s=>{
    if(s.isPeer){if(s.stream)s.stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});_disconnectSource(s.id);return false;}
    return true;
  });
  S.items=S.items.filter(x=>S.srcs.some(s=>s.id===x.sid));
  if(S.co){S.co=null;}
  S.remoteCursors.clear();
  if(S._handledPeerStreams) S._handledPeerStreams.clear();
  _hideActiveRoom();
  uRS('offline','Не подключён');
  D.roomCodeDisplay.style.display='none';
  D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;
  D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;
  D.connectedPeersCreate.innerHTML='';D.connectedPeersJoin.innerHTML='';
  renderSources();renderMixer();updateE();
  msg(isCreator?'Вы отключились от комнаты (комната осталась активной)':'Вы покинули комнату','info');
}

function _esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ═══════════════════════════════════════════════════════════════
//  1.1.0 — sounds, profile, friends, updates, bug capture
// ═══════════════════════════════════════════════════════════════

function _sbSound(name, opts) {
  try { if (window.SBSounds) window.SBSounds.play(name, opts); } catch (e) {}
}

function _sbReportBug(payload) {
  try {
    if (window.electronAPI && window.electronAPI.bugReport) {
      window.electronAPI.bugReport({
        ...payload,
        url: location.href,
        ua: navigator.userAgent,
      });
    }
  } catch (e) {}
}

// Sync our own status (Друзья → self picker / settings → profile) when stream
// starts/stops. Only flips when user opted in (profile.autoStreamingStatus).
let _statusBeforeStream = null;
function _sbApplyAutoStreamingStatus(streaming) {
  try {
    const p = window.SBProfile && window.SBProfile.getCached();
    if (!p || !p.autoStreamingStatus) return;
    if (streaming) {
      _statusBeforeStream = p.statusManual || 'online';
      window.electronAPI.profileUpdate({ statusManual: 'streaming' });
    } else {
      const restore = _statusBeforeStream || 'online';
      _statusBeforeStream = null;
      // Don't override if the user already manually picked something else
      if (p.statusManual === 'streaming') window.electronAPI.profileUpdate({ statusManual: restore });
    }
  } catch (e) {}
}

function _initSoundSystem() {
  if (!window.SBSounds || !S.settings || !S.settings.sound) return;
  const s = S.settings.sound;
  window.SBSounds.init({ volume: s.volume, enabled: s.enabled, perEvent: s.perEvent || {} });
}

async function _initProfileAndFriends() {
  try { if (window.SBProfile) await window.SBProfile.boot(); } catch (e) { console.warn('[Profile] boot failed', e); }
  try { if (window.SBFriends) await window.SBFriends.boot(); } catch (e) { console.warn('[Friends] boot failed', e); }
  // Auto-connect to Presence WS if logged in (for signaling + presence + chat)
  if (window.electronAPI && window.electronAPI.presenceConnect) {
    try { await window.electronAPI.presenceConnect(); } catch (e) { if(window.__sbDev) console.warn('[Presence] auto-connect failed', e); }
  }
  // Auto-rejoin P2P room if roomCode was saved before restart
  _autoRejoinRoom();
}

function _initNetworkMonitor() {
  const el = document.getElementById('netStatus');
  const dot = document.getElementById('netDot');
  const txt = document.getElementById('netText');
  if (!el || !dot || !txt) return;

  let _online = navigator.onLine;
  let _weak = false;
  let _failCount = 0;     // consecutive probe failures
  let _checkTimer = null;

  function _update() {
    el.classList.remove('net-offline', 'net-weak');
    if (!_online) {
      el.classList.add('net-offline');
      dot.className = 'net-dot';
      txt.textContent = 'Нет сети';
    } else if (_weak) {
      el.classList.add('net-weak');
      dot.className = 'net-dot';
      txt.textContent = 'Слабая сеть';
    } else {
      dot.className = 'net-dot';
      txt.textContent = 'В сети';
    }
  }

  function _probe() {
    // Lightweight health check to detect captive portals / real connectivity.
    // Use 'cors' mode (not 'no-cors') — opaque responses always resolve even when
    // the server is down, making the probe useless. The health endpoint is public
    // and returns CORS headers. Timeout = 4s.
    const url = 'https://streambro.ru/api/health?t=' + Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    fetch(url, { mode: 'cors', cache: 'no-store', signal: controller.signal })
      .then(() => {
        // Any HTTP response (even 5xx) means the server is reachable
        _failCount = 0;
        _weak = false;
        _update();
      })
      .catch(() => {
        // navigator.onLine can be true even when only local network is available
        if (navigator.onLine) {
          _failCount++;
          // Require 2+ consecutive failures before showing "weak" — prevents
          // false positives from a single timeout / server hiccup
          if (_failCount >= 2) { _weak = true; _update(); }
        }
      })
      .finally(() => clearTimeout(timeout));
  }

  window.addEventListener('online', () => {
    _online = true;
    _weak = false;
    _failCount = 0;
    _update();
    _probe(); // verify real connectivity
    if (window.__sbDev) console.log('[Net] online');
  });

  window.addEventListener('offline', () => {
    _online = false;
    _weak = false;
    _failCount = 0;
    _update();
    if (window.__sbDev) console.log('[Net] offline');
  });

  // Periodic probe every 30s to detect silent disconnects
  _checkTimer = setInterval(_probe, 30000);

  // Initial state + probe
  _update();
  if (_online) _probe();
}

function _initSidebarResize(){
  const handle=document.getElementById('sidebarResize');
  const sidebar=document.getElementById('sidebar');
  if(!handle||!sidebar) return;

  const MIN_W=240,MAX_W=500;
  let dragging=false,startX=0,startW=0;

  // Restore saved width
  const saved=S.settings&&S.settings._sidebarWidth;
  if(saved&&saved>=MIN_W&&saved<=MAX_W){
    sidebar.style.width=saved+'px';
    document.documentElement.style.setProperty('--sidebar-w',saved+'px');
  }

  handle.addEventListener('mousedown',e=>{
    e.preventDefault();
    dragging=true;
    startX=e.clientX;
    startW=sidebar.offsetWidth;
    handle.classList.add('active');
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
  });

  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    // Sidebar is on the right — dragging left increases width
    const delta=startX-e.clientX;
    const newW=Math.min(MAX_W,Math.max(MIN_W,startW+delta));
    sidebar.style.width=newW+'px';
    document.documentElement.style.setProperty('--sidebar-w',newW+'px');
  });

  document.addEventListener('mouseup',()=>{
    if(!dragging) return;
    dragging=false;
    handle.classList.remove('active');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    // Persist
    const w=sidebar.offsetWidth;
    if(!S.settings) S.settings={};
    S.settings._sidebarWidth=w;
    _scheduleSettingsSave();
    _markDirty();
  });
}

function _initBottomResize(){
  const handle=document.getElementById('bottomResize');
  const panel=document.getElementById('bottomPanel');
  if(!handle||!panel) return;

  const MIN_H=100,MAX_H=450;
  let dragging=false,startY=0,startH=0;

  // Restore saved height
  const saved=S.settings&&S.settings._bottomHeight;
  if(saved&&saved>=MIN_H&&saved<=MAX_H){
    panel.style.height=saved+'px';
    document.documentElement.style.setProperty('--bottom-h',saved+'px');
  }

  handle.addEventListener('mousedown',e=>{
    e.preventDefault();
    dragging=true;
    startY=e.clientY;
    startH=panel.offsetHeight;
    handle.classList.add('active');
    document.body.style.cursor='row-resize';
    document.body.style.userSelect='none';
  });

  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    // Bottom panel — dragging up increases height
    const delta=startY-e.clientY;
    const newH=Math.min(MAX_H,Math.max(MIN_H,startH+delta));
    panel.style.height=newH+'px';
    document.documentElement.style.setProperty('--bottom-h',newH+'px');
  });

  document.addEventListener('mouseup',()=>{
    if(!dragging) return;
    dragging=false;
    handle.classList.remove('active');
    document.body.style.cursor='';
    document.body.style.userSelect='';
    // Persist
    const h=panel.offsetHeight;
    if(!S.settings) S.settings={};
    S.settings._bottomHeight=h;
    _scheduleSettingsSave();
    _markDirty();
  });
}

function _initSettingsTabs() {
  const tabs = document.querySelectorAll('.settings-tab');
  const panes = document.querySelectorAll('.settings-pane');
  tabs.forEach(t => t.addEventListener('click', () => {
    const target = t.dataset.stab;
    tabs.forEach(x => x.classList.toggle('active', x === t));
    panes.forEach(p => p.classList.toggle('active', p.dataset.spane === target));
  }));
}

function _initSoundSettingsPane() {
  const enabled = document.getElementById('soundEnabled');
  const vol = document.getElementById('soundVolume');
  const volLbl = document.getElementById('soundVolumeLabel');
  if (!enabled || !vol) return;

  enabled.checked = !!(S.settings && S.settings.sound && S.settings.sound.enabled);
  const v = (S.settings && S.settings.sound) ? Math.round((S.settings.sound.volume || 0) * 100) : 40;
  vol.value = v;
  if (volLbl) volLbl.textContent = v + '%';

  enabled.addEventListener('change', () => {
    if (!S.settings) return;
    S.settings.sound = S.settings.sound || {};
    S.settings.sound.enabled = enabled.checked;
    if (window.SBSounds) window.SBSounds.setEnabled(enabled.checked);
    _persistSettingsSafe();
  });
  vol.addEventListener('input', () => {
    if (volLbl) volLbl.textContent = vol.value + '%';
    if (!S.settings) return;
    S.settings.sound = S.settings.sound || {};
    S.settings.sound.volume = (+vol.value) / 100;
    if (window.SBSounds) window.SBSounds.setVolume(S.settings.sound.volume);
  });
  vol.addEventListener('change', () => _persistSettingsSafe());

  document.querySelectorAll('.sound-grid [data-sound]').forEach(b => {
    b.addEventListener('click', () => _sbSound(b.dataset.sound));
  });
}

function _initUpdatesPane() {
  const ac = document.getElementById('updatesAutoCheck');
  const ad = document.getElementById('updatesAutoDownload');
  const ai = document.getElementById('updatesAutoInstall');
  const ch = document.getElementById('updatesChannel');
  const btn = document.getElementById('btnCheckUpdate');
  const box = document.getElementById('updateStatusBox');
  if (!ac) return;

  const u = (S.settings && S.settings.updates) || { autoCheck: true, autoDownload: true, autoInstallOnQuit: true, channel: 'latest' };
  ac.checked = !!u.autoCheck;
  ad.checked = !!u.autoDownload;
  ai.checked = !!u.autoInstallOnQuit;
  ch.value = u.channel || 'latest';

  function persist() {
    if (!S.settings) return;
    S.settings.updates = S.settings.updates || {};
    S.settings.updates.autoCheck = ac.checked;
    S.settings.updates.autoDownload = ad.checked;
    S.settings.updates.autoInstallOnQuit = ai.checked;
    S.settings.updates.channel = ch.value;
    _persistSettingsSafe();
    try { window.electronAPI.updaterSetChannel(ch.value); } catch (e) {}
  }
  ac.addEventListener('change', persist);
  ad.addEventListener('change', persist);
  ai.addEventListener('change', persist);
  ch.addEventListener('change', persist);

  btn && btn.addEventListener('click', async () => {
    if (box) { box.className = 'update-status checking'; box.textContent = 'Проверяем обновления...'; }
    try {
      const r = await window.electronAPI.updaterCheck();
      if (!r || !r.success) {
        if (box) { box.className = 'update-status'; box.textContent = 'Не удалось проверить: ' + ((r && r.error) || 'неизвестная ошибка'); }
      }
    } catch (e) {
      if (box) { box.className = 'update-status error'; box.textContent = 'Ошибка: ' + e.message; }
    }
  });

  if (window.electronAPI && window.electronAPI.onUpdateState) {
    window.electronAPI.onUpdateState(_handleUpdateState);
  }
}

let _lastUpdateState = null;
function _handleUpdateState(state) {
  if (state && state.state === 'available') _lastUpdateState = state;
  const box = document.getElementById('updateStatusBox');
  const toast = document.getElementById('updateToast');
  const tTitle = document.getElementById('updateToastTitle');
  const tDesc = document.getElementById('updateToastDesc');
  const tDl = document.getElementById('updateToastDownload');
  const tIn = document.getElementById('updateToastInstall');
  const tDis = document.getElementById('updateToastDismiss');
  if (!state) return;
  const fmtBytes = (n) => n ? (n / 1024 / 1024).toFixed(1) + ' MB' : '';
  const showToast = () => { if (toast) toast.style.display = 'flex'; };
  const hideToast = () => { if (toast) toast.style.display = 'none'; };

  switch (state.state) {
    case 'checking':
      if (box) { box.className = 'update-status checking'; box.textContent = 'Проверяем обновления...'; }
      break;
    case 'up-to-date':
      if (box) { box.className = 'update-status'; box.textContent = 'У вас последняя версия (' + (state.version || '') + ').'; }
      break;
    case 'available':
      _sbSound('update');
      if (state.downloadUrl) {
        // HTTP fallback — portable mode: open browser to download .zip
        if (box) { box.className = 'update-status available'; box.textContent = 'Доступна версия ' + state.version + '. Скачать с сайта.'; }
        if (tTitle) tTitle.textContent = 'Доступно обновление';
        if (tDesc) tDesc.textContent = 'Версия ' + state.version + (state.changelog ? ' — ' + state.changelog : '');
        if (tDl) { tDl.style.display = ''; tDl.textContent = 'Скачать с сайта'; }
        if (tIn) tIn.style.display = 'none';
        showToast();
      } else {
        // electron-updater — full auto-update
        if (box) { box.className = 'update-status available'; box.textContent = 'Доступна версия ' + state.version + '. Скачивание...'; }
        if (tTitle) tTitle.textContent = 'Доступно обновление';
        if (tDesc) tDesc.textContent = 'Версия ' + state.version;
        if (tDl) { tDl.style.display = ''; tDl.textContent = 'Скачать'; }
        if (tIn) tIn.style.display = 'none';
        showToast();
      }
      break;
    case 'downloading':
      if (box) { box.className = 'update-status checking'; box.textContent = 'Загрузка ' + (state.percent||0) + '% (' + fmtBytes(state.transferred) + ' / ' + fmtBytes(state.total) + ')'; }
      if (tDesc) tDesc.textContent = 'Загрузка ' + (state.percent||0) + '%';
      break;
    case 'downloaded':
      if (box) { box.className = 'update-status available'; box.textContent = 'Версия ' + state.version + ' готова. Перезапустите для установки.'; }
      _sbSound('success');
      if (tTitle) tTitle.textContent = 'Обновление готово';
      if (tDesc) tDesc.textContent = 'Версия ' + state.version + ' готова к установке';
      if (tDl) tDl.style.display = 'none';
      if (tIn) tIn.style.display = '';
      showToast();
      break;
    case 'error':
      if (box) { box.className = 'update-status error'; box.textContent = 'Ошибка обновления: ' + (state.reason || ''); }
      break;
    case 'disabled':
      if (box) { box.className = 'update-status'; box.textContent = 'Авто-обновление отключено в этой сборке.'; }
      break;
  }

  if (tDl) tDl.onclick = () => {
    // If we have a direct downloadUrl (HTTP fallback / portable mode) → open browser
    if (_lastUpdateState && _lastUpdateState.downloadUrl) {
      try { window.electronAPI.openExternal(_lastUpdateState.downloadUrl); } catch (e) {}
    } else {
      try { window.electronAPI.updaterDownload(); } catch (e) {}
    }
  };
  if (tIn) tIn.onclick = () => { try { window.electronAPI.updaterInstall(); } catch (e) {} };
  if (tDis) tDis.onclick = hideToast;
}

function _initBugCapture() {
  // Capture uncaught errors + unhandled rejections in renderer.
  // Throttled (max 1 report per 30s for the same message) so a render loop
  // bug doesn't flood our endpoint.
  const recent = new Map();
  function shouldReport(key) {
    const now = Date.now();
    const last = recent.get(key) || 0;
    if (now - last < 30000) return false;
    recent.set(key, now);
    if (recent.size > 100) {
      // crude GC
      const firstKey = recent.keys().next().value;
      recent.delete(firstKey);
    }
    return true;
  }
  window.addEventListener('error', (ev) => {
    const msg = (ev && ev.message) || 'window error';
    if (!shouldReport(msg)) return;
    _sbReportBug({
      type: 'window-error',
      message: msg,
      stack: ev.error && ev.error.stack,
      filename: ev.filename, lineno: ev.lineno, colno: ev.colno,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev && ev.reason;
    const msg = (reason && (reason.message || String(reason))) || 'unhandled rejection';
    if (!shouldReport(msg)) return;
    _sbReportBug({ type: 'unhandled-rejection', message: msg, stack: reason && reason.stack });
  });
}

function _persistSettingsSafe() {
  try {
    if (typeof _scheduleSettingsSave === 'function') _scheduleSettingsSave();
    else if (typeof _persistSettings === 'function') _persistSettings();
    else if (S.settings && window.electronAPI && window.electronAPI.settingsSave) window.electronAPI.settingsSave(S.settings);
  } catch (e) {}
}

// ─── Virtual Camera UI ───────────────────────────────────────────────
let _vcamEnabled = false;

async function _initVcamUI() {
  const toggleBtn = document.getElementById('btnVcamToggle');
  const deviceSel = document.getElementById('vcamDeviceSelect');
  const refreshBtn = document.getElementById('btnVcamRefresh');
  const statusText = document.getElementById('vcamStatusText');

  if (!toggleBtn) return;

  async function _refreshDevices() {
    deviceSel.innerHTML = '<option value="">Обнаружение...</option>';
    try {
      const r = await window.electronAPI.vcamListDevices();
      deviceSel.innerHTML = '';
      if (r.devices && r.devices.length > 0) {
        r.devices.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d; opt.textContent = d;
          if (d.toLowerCase().includes('obs')) opt.selected = true;
          deviceSel.appendChild(opt);
        });
      } else {
        const opt = document.createElement('option');
        opt.value = 'OBS Virtual Camera'; opt.textContent = 'OBS Virtual Camera (по умолчанию)';
        deviceSel.appendChild(opt);
        if (r.error) { const e = document.createElement('option'); e.value = ''; e.textContent = '— нет DirectShow камер —'; deviceSel.appendChild(e); }
      }
    } catch (e) {
      deviceSel.innerHTML = '<option value="OBS Virtual Camera">OBS Virtual Camera</option>';
    }
  }

  refreshBtn.addEventListener('click', _refreshDevices);

  toggleBtn.addEventListener('click', async () => {
    if (_vcamEnabled) {
      await window.electronAPI.vcamStop();
      _vcamEnabled = false;
      toggleBtn.textContent = 'Включить';
      toggleBtn.style.background = '';
      statusText.textContent = 'Выключена';
    } else {
      const device = deviceSel.value || 'OBS Virtual Camera';
      const res = S.settings?.streaming?.resolution || '1280x720';
      const [w, h] = res.split('x').map(Number);
      const r = await window.electronAPI.vcamStart({ device, width: w || 1280, height: h || 720, fps: S._captureFps || 30 });
      if (r.ok) {
        _vcamEnabled = true;
        toggleBtn.textContent = 'Выключить';
        toggleBtn.style.background = 'var(--accent)';
        statusText.textContent = `✓ ${device}`;
        _startVcamFeed();
      } else {
        statusText.textContent = `Ошибка: ${r.error || 'не удалось запустить'}`;
      }
    }
  });

  window.electronAPI.onVcamStatus(data => {
    _vcamEnabled = data.enabled;
    toggleBtn.textContent = data.enabled ? 'Выключить' : 'Включить';
    toggleBtn.style.background = data.enabled ? 'var(--accent)' : '';
    statusText.textContent = data.enabled ? `✓ ${data.device}` : 'Выключена';
    if (!data.enabled) _stopVcamFeed();
  });

  window.electronAPI.onVcamError(msg => {
    if (window.__sbDev) console.warn('[VCam] error:', msg);
    statusText.textContent = `Ошибка: ${msg.substring(0, 60)}`;
  });

  await _refreshDevices();
}

let _vcamFeedRecorder = null;
function _startVcamFeed() {
  if (_vcamFeedRecorder || !S.combinedStream) return;
  try {
    _vcamFeedRecorder = new MediaRecorder(S.combinedStream, {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: 8000000,
    });
    _vcamFeedRecorder.ondataavailable = async e => {
      if (!_vcamEnabled || !e.data || e.data.size === 0) return;
      const buf = await e.data.arrayBuffer();
      window.electronAPI.vcamWriteChunk(buf).catch(() => {});
    };
    _vcamFeedRecorder.start(100);
  } catch (e) {
    if (window.__sbDev) console.warn('[VCam] feed start error:', e);
  }
}

function _stopVcamFeed() {
  if (_vcamFeedRecorder) {
    try { _vcamFeedRecorder.stop(); } catch {}
    _vcamFeedRecorder = null;
  }
}

document.addEventListener('DOMContentLoaded',init);
window.msg = msg;
window._scheduleSettingsSave = _scheduleSettingsSave;
// Expose for hotkeys module
window.S = S;
window._markDirty = _markDirty;
window._resetTransform = _resetTransform;
window._undo = _undo;
window._getSelectedItem = () => S.items?.find(it => it.sid === S.selId);
window.togVis = togVis;
window.togLock = togLock;
window.rmSrc = rmSrc;
window._updateGain = _updateGain;
// Initialize virtual camera UI after DOM ready
window.addEventListener('DOMContentLoaded', () => { _initVcamUI().catch(() => {}); });
})();
