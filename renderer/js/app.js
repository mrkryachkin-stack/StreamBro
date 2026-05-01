// StreamBro v12 — persistent settings, real RTMP, themes, hotkeys, perf throttling

(function(){
'use strict';
document.oncontextmenu=e=>e.preventDefault();

const HANDLE_R=9, HIT_R=24, ROT_OFF=34, SNAP=30, MIN_DIM=20;
let _gateWorkletLoaded=null; // Promise — resolved once AudioWorklet module is registered

const S={
  srcs:[], selId:null, items:[], wrtc:null, rtmp:null, streaming:false, roomCode:null,
  ctx:null, anim:null,
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
  combinedStream:null,
  _recTimerInterval:null,
  _ffmpegRecPath:null,
  // ─── Persistent settings (mirrored from main process) ───
  settings:null,
  // ─── Performance ───
  targetFps:60,
  _lastRenderAt:0,
  _levelsRAF:null,
  _settingsSaveTimer:null,
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
};
const D={};
function $(id){return document.getElementById(id)}

// ═══════════════════════════════════════════════════════════
//  CO-SESSION HELPERS
// ═══════════════════════════════════════════════════════════
// Globally-unique source id. Local sources get a UUID at creation; once
// generated the id stays the same forever and is used as `it.sid` too.
function _newSid(){
  if(window.CoSceneHelpers&&window.CoSceneHelpers.newGid) return window.CoSceneHelpers.newGid();
  return 'g-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}
// Convenience wrapper — returns true while applying a remote op (suppresses re-broadcast)
function _isRemote(){ return S.co && S.co.applyingRemote(); }
// Returns the gid order of all local + replicated sources (for src.reorder ops)
function _currentSrcOrder(){ return S.srcs.map(s=>s.id); }
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
//  AUDIO — source → gain → audioDest (record/stream)
//                   gain → analyser (levels)
//                → monitorGain → audioCtx.destination (speakers/monitoring)
// ═══════════════════════════════════════════════════════════
function ensureAudioCtx(){
  if(S.audioCtx && S.audioCtx.state!=='closed') {
    if(S.audioCtx.state==='suspended') S.audioCtx.resume();
    return;
  }
  S.audioCtx=new AudioContext({sampleRate:48000});
  S.audioDest=S.audioCtx.createMediaStreamDestination();
  S.audioNodes.clear();
  if(window.__sbDev) console.log('[Audio] AudioContext created, state='+S.audioCtx.state);
  if(S.audioCtx.state==='suspended') S.audioCtx.resume().then(()=>{ if(window.__sbDev) console.log('[Audio] AudioContext resumed'); });
  // Register noise-gate AudioWorklet (replaces deprecated ScriptProcessorNode)
  _gateWorkletLoaded = S.audioCtx.audioWorklet.addModule('js/noise-gate-worklet.js')
    .catch(e=>{ if(window.__sbDev) console.warn('[Audio] noise-gate-worklet load failed, will use passthrough:',e); });
  for(const src of S.srcs){
    if(src.stream&&src.stream.getAudioTracks().length) _connectSource(src);
  }
  _rebuildCombinedStream();
}

function _rebuildCombinedStream(){
  if(!S.audioCtx||!S.audioDest) return;
  let vt=[];
  if(S.combinedStream) vt=S.combinedStream.getVideoTracks();
  if(!vt.length){
    const cv=D.sceneCanvas;
    if(cv && cv.captureStream) vt=cv.captureStream(30).getVideoTracks();
  }
  S.combinedStream=new MediaStream([...vt,...S.audioDest.stream.getAudioTracks()]);
  console.log('[Audio] Combined: '+vt.length+'v, '+S.audioDest.stream.getAudioTracks().length+'a');
  if(S.rtmp) S.rtmp.setCombinedStream(S.combinedStream);
}

async function _connectSource(src){
  if(!S.audioCtx) return;
  if(S.audioNodes.has(src.id)){
    const n=S.audioNodes.get(src.id);
    n.gainNode.gain.value=src.muted?0:src.vol;
    n.monitorGain.gain.value=src.monitor?(src.muted?0:src.vol):0;
    return;
  }
  if(!src.stream.getAudioTracks().length) return;
  if(S.audioCtx.state==='suspended') S.audioCtx.resume();

  const ctx=S.audioCtx;
  const rawSource=ctx.createMediaStreamSource(src.stream);
  // channelMode (default 'auto'):
  //   auto   — mono input → duplicate to both channels; stereo input → pass-through L/R
  //   mono   — force ch0 to both outputs (sums stereo to centre)
  //   stereo — leave channels as-is (mono input will only sound in left ear)
  const mode=src.channelMode||'auto';
  const splitter=ctx.createChannelSplitter(2);
  const merger=ctx.createChannelMerger(2);
  rawSource.connect(splitter);
  if(mode==='stereo'){
    splitter.connect(merger,0,0);
    try{ splitter.connect(merger,1,1); }catch(e){}
  }else if(mode==='mono'){
    splitter.connect(merger,0,0);
    splitter.connect(merger,0,1);
  }else{
    splitter.connect(merger,0,0);
    splitter.connect(merger,0,1);
    try{ splitter.connect(merger,1,1); }catch(e){}
  }
  const sourceNode=merger;
  // Helper to force stereo mode on an audio node
  const _stereoIfy=(n)=>{try{n.channelCount=2;n.channelCountMode='explicit';n.channelInterpretation='speakers';}catch(e){}};
  _stereoIfy(merger);
  const gainNode=ctx.createGain();
  _stereoIfy(gainNode);
  gainNode.gain.value=src.muted?0:src.vol;
  const monitorGain=ctx.createGain();
  monitorGain.gain.value=src.monitor?(src.muted?0:src.vol):0;
  _stereoIfy(monitorGain);
  const analyser=ctx.createAnalyser();
  analyser.fftSize=256;
  analyser.smoothingTimeConstant=0.3;

  // ─── Effects chain (all bypassed by default = clean passthrough) ───
  const fxState=src.fxState||{noiseGate:false,eq:false,compressor:false,limiter:false,
    eqLow:0,eqMid:0,eqHigh:0,compThresh:-24,compRatio:4,compGain:6,gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150,limThresh:-3};

  // Bypass gain: when effect is OFF, gain=1 (passthrough). When ON, gain=1 too but effect is in chain.
  // Key: all nodes are ALWAYS in the chain. Bypass = set params to "do nothing":
  //   - EQ: all gains = 0dB (flat, no change)
  //   - Compressor: threshold=0dB, ratio=1:1, makeup=0dB → no compression
  //   - Limiter: threshold=0dB, ratio=1:1 → no limiting
  //   - Gate: threshold=-100dB → nothing gated

  // Noise gate via AudioWorkletNode (replaces deprecated ScriptProcessorNode)
  let gateNode;
  try{
    if(_gateWorkletLoaded) await _gateWorkletLoaded;
    gateNode=new AudioWorkletNode(ctx,'noise-gate',{
      numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2]
    });
    gateNode.port.postMessage({
      enabled: fxState.noiseGate||false,
      thresh:  fxState.gateThresh||-40,
      range:   fxState.gateRange||-40,
      attack:  (fxState.gateAttack||10)/1000,
      hold:    (fxState.gateHold||100)/1000,
      release: (fxState.gateRelease||150)/1000,
    });
  }catch(e){
    // Fallback: simple GainNode passthrough if worklet unavailable
    if(window.__sbDev) console.warn('[Audio] Gate worklet unavailable, using passthrough:',e);
    gateNode=ctx.createGain();
    gateNode.gain.value=1;
  }

  // 3-Band EQ (flat = 0dB gain = passthrough)
  const eqLow=ctx.createBiquadFilter();
  eqLow.type='lowshelf'; eqLow.frequency.value=320; eqLow.gain.value=fxState.eq?fxState.eqLow:0;
  _stereoIfy(eqLow);
  const eqMid=ctx.createBiquadFilter();
  eqMid.type='peaking'; eqMid.frequency.value=1000; eqMid.Q.value=1.0; eqMid.gain.value=fxState.eq?fxState.eqMid:0;
  _stereoIfy(eqMid);
  const eqHigh=ctx.createBiquadFilter();
  eqHigh.type='highshelf'; eqHigh.frequency.value=3200; eqHigh.gain.value=fxState.eq?fxState.eqHigh:0;
  _stereoIfy(eqHigh);

  // Compressor (threshold=0 + ratio=1 + makeup=0 = passthrough)
  const compressor=ctx.createDynamicsCompressor();
  compressor.threshold.value=fxState.compressor?fxState.compThresh:0;
  compressor.ratio.value=fxState.compressor?fxState.compRatio:1;
  compressor.knee.value=10;
  compressor.attack.value=0.003;
  compressor.release.value=0.25;
  const compMakeup=ctx.createGain();
  compMakeup.gain.value=fxState.compressor?_dbToLinear(fxState.compGain):1;

  // Limiter (threshold from fxState, ratio=1 = passthrough)
  const limiter=ctx.createDynamicsCompressor();
  limiter.threshold.value=fxState.limiter?(fxState.limThresh||-3):0;
  limiter.ratio.value=fxState.limiter?20:1;
  limiter.knee.value=0;
  limiter.attack.value=0.001;
  limiter.release.value=0.1;

  // Chain: source → gateNode (AudioWorklet) → eqLow → eqMid → eqHigh → comp → compMakeup → limiter → [output]
  sourceNode.connect(gateNode);
  gateNode.connect(eqLow);
  eqLow.connect(eqMid);
  eqMid.connect(eqHigh);
  eqHigh.connect(compressor);
  compressor.connect(compMakeup);
  compMakeup.connect(limiter);

  // Output split
  limiter.connect(gainNode);
  gainNode.connect(S.audioDest);
  gainNode.connect(analyser);
  // Desktop audio monitoring is disabled — it would create echo/feedback
  // since desktop audio IS the system audio playing through speakers
  if(src.type!=='desktop'){
    limiter.connect(monitorGain);
    monitorGain.connect(ctx.destination);
  }

  S.audioNodes.set(src.id,{sourceNode,gainNode,monitorGain,analyser,
    effectsChain:{gateNode,eqLow,eqMid,eqHigh,compressor,compMakeup,limiter}});
  S.audioEffects.set(src.id,fxState);
  src.fxState=fxState;
  console.log('[Audio] Connected with FX chain:',src.name);
}

function _disconnectSource(srcId){
  const n=S.audioNodes.get(srcId);if(!n)return;
  try{n.sourceNode.disconnect();}catch(e){}
  try{n.gainNode.disconnect();}catch(e){}
  try{n.monitorGain.disconnect();}catch(e){}
  if(n.effectsChain){
    try{n.effectsChain.gateNode.disconnect();}catch(e){}
    try{n.effectsChain.eqLow.disconnect();}catch(e){}
    try{n.effectsChain.eqMid.disconnect();}catch(e){}
    try{n.effectsChain.eqHigh.disconnect();}catch(e){}
    try{n.effectsChain.compressor.disconnect();}catch(e){}
    try{n.effectsChain.compMakeup.disconnect();}catch(e){}
    try{n.effectsChain.limiter.disconnect();}catch(e){}
  }
  S.audioNodes.delete(srcId);
}

function _updateGain(src){
  const n=S.audioNodes.get(src.id);if(!n||!S.audioCtx)return;
  n.gainNode.gain.setTargetAtTime(src.muted?0:src.vol,S.audioCtx.currentTime,0.02);
  n.monitorGain.gain.setTargetAtTime(src.monitor?(src.muted?0:src.vol):0,S.audioCtx.currentTime,0.02);
}

function _resumeAudioCtx(){
  if(S.audioCtx&&S.audioCtx.state==='suspended') S.audioCtx.resume();
}

// ═══════════════════════════════════════════════════════════
//  TRANSFORM MATH (unchanged)
// ═══════════════════════════════════════════════════════════
function rotMat(deg){const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return{a:c,b:s,c:-s,d:c};}
function localToWorld(it,lx,ly){const m=rotMat(it.rot);return{x:it.cx+m.a*lx+m.c*ly,y:it.cy+m.b*lx+m.d*ly};}
function worldToLocal(it,wx,wy){const m=rotMat(-it.rot);const dx=wx-it.cx,dy=wy-it.cy;return{x:m.a*dx+m.c*dy,y:m.b*dx+m.d*dy};}
function localHandles(it){const hw=it.w/2,hh=it.h/2;return[{id:'tl',x:-hw,y:-hh},{id:'tr',x:hw,y:-hh},{id:'bl',x:-hw,y:hh},{id:'br',x:hw,y:hh},{id:'tm',x:0,y:-hh},{id:'bm',x:0,y:hh},{id:'ml',x:-hw,y:0},{id:'mr',x:hw,y:0},{id:'rot',x:hw+ROT_OFF,y:0}];}
function opposite(hid,w,h){const hw=w/2,hh=h/2;const m={tl:{x:hw,y:hh},tr:{x:-hw,y:hh},bl:{x:hw,y:-hh},br:{x:-hw,y:-hh},tm:{x:0,y:hh},bm:{x:0,y:-hh},ml:{x:hw,y:0},mr:{x:-hw,y:0}};return m[hid]||{x:0,y:0};}
function _enforceCircle(it){const cr=it.crop||{l:0,t:0,r:0,b:0};it.uncropW=it.w/Math.max(.1,1-cr.l-cr.r);it.uncropH=it.h/Math.max(.1,1-cr.t-cr.b);const rm=rotMat(it.rot);it.uncropCx=it.cx-rm.a*(cr.l-cr.r)*it.uncropW/2-rm.c*(cr.t-cr.b)*it.uncropH/2;it.uncropCy=it.cy-rm.b*(cr.l-cr.r)*it.uncropW/2-rm.d*(cr.t-cr.b)*it.uncropH/2;}
// Extra zoom for circle mask so user can pan in BOTH axes even when video aspect = item aspect
const CIRCLE_PAN_ZOOM=1.18;

// ─── UNDO STACK ───────────────────────────────────────────
// Captures only item geometry/crop/mask state (not the heavy stream/element refs)
function _snapshotItems(){
  return S.items.map(it=>({
    sid:it.sid,cx:it.cx,cy:it.cy,w:it.w,h:it.h,z:it.z,rot:it.rot,
    flipH:it.flipH,flipV:it.flipV,
    crop:it.crop?{...it.crop}:{l:0,t:0,r:0,b:0},
    cropMask:it.cropMask||'none',
    uncropW:it.uncropW,uncropH:it.uncropH,uncropCx:it.uncropCx,uncropCy:it.uncropCy,
    panDx:it.panDx||0,panDy:it.panDy||0,
    frameSettings:it.frameSettings?JSON.parse(JSON.stringify(it.frameSettings)):null,
  }));
}
function _pushUndo(label){
  try{
    S._undoStack.push({label:label||'',snap:_snapshotItems(),t:Date.now()});
    while(S._undoStack.length>S._undoMax) S._undoStack.shift();
  }catch(e){if(window.__sbDev) console.warn('undo push failed',e);}
}
function _undo(){
  if(!S._undoStack.length){msg('Нечего отменять','info');return;}
  const entry=S._undoStack.pop();
  // Handle source deletion undo
  if(entry.type==='delete-source'&&entry.restore){
    const r=entry.restore;
    _undoRestoreSource(r);
    msg('Отменено: «'+r.srcName+'» восстановлен','info');
    return;
  }
  // Handle transform/crop/mask undo
  const map=new Map(entry.snap.map(e=>[e.sid,e]));
  for(const it of S.items){
    const e=map.get(it.sid);if(!e) continue;
    Object.assign(it,{
      cx:e.cx,cy:e.cy,w:e.w,h:e.h,z:e.z,rot:e.rot,
      flipH:e.flipH,flipV:e.flipV,
      crop:{...e.crop},cropMask:e.cropMask,
      uncropW:e.uncropW,uncropH:e.uncropH,uncropCx:e.uncropCx,uncropCy:e.uncropCy,
      panDx:e.panDx,panDy:e.panDy,
      frameSettings:e.frameSettings?JSON.parse(JSON.stringify(e.frameSettings)):it.frameSettings,
    });
  }
  msg('Отменено'+(entry.label?': '+entry.label:''),'info');
  // Replicate the rolled-back item state to peers so we don't desync
  if(S.co){
    for(const it of S.items){ S.co.queueItemUpsert(it); }
    S.co.flushAllItems();
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
function _snapCircle(it){if(it.cropMask==='circle'){const s=Math.min(it.w,it.h);it.w=s;it.h=s;_enforceCircle(it);}}
function hitHandle(mx,my,it){const loc=worldToLocal(it,mx,my);for(const h of localHandles(it)){if(Math.hypot(loc.x-h.x,loc.y-h.y)<HIT_R)return h.id;}return null;}
function hitItem(mx,my,it){const loc=worldToLocal(it,mx,my);return Math.abs(loc.x)<=it.w/2+6&&Math.abs(loc.y)<=it.h/2+6;}
function cursorFor(hid){if(hid==='tl'||hid==='tr'||hid==='bl'||hid==='br')return'grab';const m={tm:'ns-resize',bm:'ns-resize',ml:'ew-resize',mr:'ew-resize',rot:'ew-resize'};return m[hid]||'default';}
function toCanvas(cv,e){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*(cv.width/r.width),y:(e.clientY-r.top)*(cv.height/r.height)};}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
async function init(){
  if(window.__sbDev) console.log('[Init] StreamBro v12 starting...');
  Object.keys({
    sceneCanvas:1,scenePreview:1,sceneEmpty:1,sourcesList:1,audioMixer:1,
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
    addSourceModal:1,btnCloseSourceModal:1,
    addMicModal:1,btnCloseMicModal:1,micSelect:1,btnConfirmMic:1,
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

  bind(); S.ctx=D.sceneCanvas.getContext('2d');
  initRTMP(); setupScene(); loop();
  try{window.electronAPI.startSignalingServer();}catch(e){}
  // Listen for FFmpeg rec stop event
  try{window.electronAPI.onFFmpegRecStopped(data=>{
    if(window.__sbDev) console.log('[Rec] FFmpeg finished:',data);
    if(S.rtmp&&S.rtmp.onRecStop) S.rtmp.onRecStop(data.path||'Видео/StreamBro_...mp4');
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
}

// ═══════════════════════════════════════════════════════════
//  PERSISTENT SETTINGS (loaded once, debounced save)
// ═══════════════════════════════════════════════════════════
async function _loadSettings(){
  try{
    const s=await window.electronAPI.settingsLoad();
    S.settings=s;
    S.targetFps=Math.max(15,Math.min(120,s.ui.targetFps||60));
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
      if(m){S.cw=parseInt(m[1]);S.ch=parseInt(m[2]);if(D.sceneCanvas){D.sceneCanvas.width=S.cw;D.sceneCanvas.height=S.ch;}}
    }
  }catch(e){
    if(window.__sbDev) console.warn('[Settings] Load failed:',e.message);
    S.settings={ui:{theme:'dark',targetFps:60,reducedMotion:false,showGrid:false,showSafeAreas:false},stream:{platform:'twitch',customServer:'',resolution:'1280x720',bitrate:6000,fps:30,key:''},audio:{},recording:{},signaling:{server:'wss://streambro.ru/signaling',turnUrl:'',turnUser:'',turnPass:''},fxStateByName:{}};
  }
}

function _scheduleSettingsSave(){
  if(S._settingsSaveTimer) clearTimeout(S._settingsSaveTimer);
  S._settingsSaveTimer=setTimeout(()=>{
    S._settingsSaveTimer=null;
    _persistSettings();
  },400);
}

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
    // 1.1.0 — preserve sound + updates blocks (mutated in place by their UI panes)
    ...(S.settings&&S.settings.sound?{sound:S.settings.sound}:{}),
    ...(S.settings&&S.settings.updates?{updates:S.settings.updates}:{}),
    ...(extra||{}),
  };
  try{await window.electronAPI.settingsSave(payload);}catch(e){if(window.__sbDev) console.warn('[Settings] Save failed:',e.message);}
}

function _applyTheme(){
  const theme=(S.settings&&S.settings.ui&&S.settings.ui.theme)||'dark';
  let resolved=theme;
  if(theme==='system'){
    resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
  }
  document.documentElement.setAttribute('data-theme',resolved);
  document.documentElement.classList.toggle('reduced-motion',!!S.reducedMotion);
  // Invalidate theme color caches so canvas redraw picks up new accents
  S._cachedAccent=null;S._cachedHandleStroke=null;
}

function _readVar(name){
  try{
    const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v||null;
  }catch(e){return null;}
}
function _themeAccentCache(){
  if(!S._cachedAccent) S._cachedAccent=_readVar('--accent')||'#ffd23c';
  return S._cachedAccent;
}
function _themeHandleStrokeCache(){
  if(!S._cachedHandleStroke) S._cachedHandleStroke=_readVar('--handle-stroke')||'#1a1a2e';
  return S._cachedHandleStroke;
}

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

  // Remove old desktop source if exists
  if(S.desktopAudioId){
    const oldIdx=S.srcs.findIndex(s=>s.id===S.desktopAudioId);
    if(oldIdx>=0){
      _disconnectSource(S.desktopAudioId);
      S.srcs.splice(oldIdx,1);
    }
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
  const src={id,gid:id,ownerPeerId:S.myPeerId,name:'Звук рабочего стола',type:'desktop',stream:audioStream,msid:audioStream.id,el:null,visible:true,vol:1,muted:false,isPeer:false,peerId:null,vst:[],monitor:false,fxState:_loadFxStateForName('Звук рабочего стола')};
  S.srcs.push(src);
  // Send desktop audio (incl. movie sound) to all peers — needed for movie watching together.
  if(S.wrtc) S.wrtc.addLocalStreamToAllPeers(audioStream);
  _coSafe(co=>co.broadcastSourceAdd());
  console.log('[Audio] Source added: Звук рабочего стола, tracks='+audioStream.getAudioTracks().length);
  ensureAudioCtx();
  _resumeAudioCtx();
  if(audioStream.getAudioTracks().length>0) _connectSource(src);
  _rebuildCombinedStream();
  renderMixer();updateE();
  console.log('[WASAPI] Desktop audio source added, id='+id);
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
  const src={id,gid:id,ownerPeerId:owner,name,type,stream,msid,el:null,visible:true,vol:1,muted:false,isPeer:isP,peerId:pid,vst:[],monitor:false,fxState:_loadFxStateForName(name)};
  S.srcs.push(src);
  if(window.__sbDev) console.log('[Audio] Source added: '+name+', tracks='+(stream?stream.getAudioTracks().length:0));
  ensureAudioCtx();
  _resumeAudioCtx();
  if(stream&&stream.getAudioTracks().length>0) _connectSource(src);
  _rebuildCombinedStream();
  // Send local sources to peers (peer-owned audio is NOT relayed back — anti-echo)
  if(!isP&&S.wrtc&&stream)S.wrtc.addLocalStreamToAllPeers(stream);
  _wireTrackEndHandlers(src);
  renderMixer();updateE();
  if(!isP&&S.co&&!opts.suppressBroadcast) S.co.broadcastSourceAdd(src);
  return id;
}

function _loadFxStateForName(name){
  const def={noiseGate:false,eq:false,compressor:false,limiter:false,eqLow:0,eqMid:0,eqHigh:0,compThresh:-24,compRatio:4,compGain:6,gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150,limThresh:-3};
  if(S.settings&&S.settings.fxStateByName&&S.settings.fxStateByName[name]){
    return Object.assign({},def,S.settings.fxStateByName[name]);
  }
  return def;
}

function initRTMP(){
  S.rtmp=new RTMPOutput();S.rtmp.setCanvas(D.sceneCanvas);
  S.rtmp.onStart=()=>{S.streaming=true;D.btnStartStream.classList.add('streaming');D.btnStartStream.innerHTML='<span class="stream-dot"></span> Подключение...';D.btnPauseStream.disabled=false;D.btnStopStream.disabled=false;msg('Подключение к серверу...','info');};
  S.rtmp.onStop=()=>{S.streaming=false;D.btnStartStream.classList.remove('streaming');D.btnStartStream.innerHTML='<span class="stream-dot"></span> Стрим';D.btnPauseStream.disabled=true;D.btnStopStream.disabled=true;D.btnPauseStream.textContent='Пауза';D.streamUptime.textContent='00:00:00';msg('Стрим остановлен','info');_setStreamStatus('offline');};
  S.rtmp.onPause=()=>{D.btnPauseStream.textContent='Продолжить';msg('Стрим на паузе','info');};
  S.rtmp.onResume=()=>{D.btnPauseStream.textContent='Пауза';msg('Стрим продолжен','info');};
  S.rtmp.onError=m=>msg('Ошибка: '+m,'error');
  S.rtmp.onStatus=(state,reason)=>_setStreamStatus(state,reason);
  S.rtmp.onRecStart=()=>{D.btnStartRec.classList.add('recording');D.btnStartRec.innerHTML='<span class="rec-dot"></span> REC';D.btnStartRec.disabled=true;D.btnPauseRec.disabled=false;D.btnStopRec.disabled=false;D.recTimer.classList.add('active');S._recTimerInterval=setInterval(()=>{if(S.rtmp)D.recTimer.textContent=S.rtmp.getRecTime();},200);msg('Локальная запись начата','success');};
  S.rtmp.onRecStop=(p)=>{
    clearInterval(S._recTimerInterval);S._recTimerInterval=null;
    D.btnStartRec.classList.remove('recording');
    D.btnStartRec.innerHTML='<span class="rec-dot"></span> Запись';
    D.btnStartRec.disabled=false;
    D.btnPauseRec.disabled=true;D.btnPauseRec.textContent='Пауза';
    D.btnStopRec.disabled=true;
    D.recTimer.classList.remove('active');D.recTimer.textContent='00:00:00';
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
  (function f(){
    const now=performance.now();
    const minDelta=1000/Math.max(15,Math.min(120,S.targetFps||60));
    if(now-S._lastRenderAt>=minDelta-0.5){
      S._lastRenderAt=now;
      try{render();}catch(e){if(window.__sbDev)console.error('[render]',e);}
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
function _setStreamStatus(state,reason){
  S.streamStatus=state;
  if(!D.btnStartStream)return;
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
      if(window.__sbDev) console.warn('[Device] Track ended:',src.name,t.kind);
      // For peers we wait for WebRTC to handle reconnect
      if(src.isPeer) return;
      // Desktop audio is restarted automatically by WASAPI watcher
      if(src.id===S.desktopAudioId) return;
      msg('Устройство отключено: '+src.name,'error');
      try{rmSrc(src.id);}catch(e){}
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
    S.cw=w;S.ch=h;D.sceneCanvas.width=w;D.sceneCanvas.height=h;
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
  document.querySelectorAll('.tab-btn').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));b.classList.add('active');const id='tab'+b.dataset.tab.charAt(0).toUpperCase()+b.dataset.tab.slice(1);const el=$(id);if(el)el.classList.add('active');});
  D.btnCloseSourceModal.onclick=()=>hideM('addSource');
  document.querySelectorAll('.source-type-btn').forEach(b=>b.onclick=()=>pickType(b.dataset.source));
  D.btnConfirmSource.onclick=confirmAdd;
  D.btnCloseMicModal.onclick=()=>hideM('addMic');
  D.btnConfirmMic.onclick=confirmAddMic;
  D.addMicModal.onclick=e=>{if(e.target===D.addMicModal)hideM('addMic');};
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
      hideM('connect');hideM('addSource');hideM('addMic');hideM('settings');hideM('help');
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
      S.showGrid=!S.showGrid;_scheduleSettingsSave();e.preventDefault();
    }
    if((code==='KeyM'||e.key==='m'||e.key==='M')&&!e.ctrlKey&&!e.metaKey){
      if(sel){const s=S.srcs.find(x=>x.id===sel);if(s&&s.stream&&s.stream.getAudioTracks().length){s.muted=!s.muted;_updateGain(s);renderMixer();e.preventDefault();}}
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
      return;
    }
    if(it)selSrc(it.dataset.sid);
  };
  let dragSid=null;
  D.sourcesList.addEventListener('dragstart',e=>{dragSid=e.target.closest('.source-item')?.dataset.sid;if(dragSid)e.dataTransfer.effectAllowed='move';});
  D.sourcesList.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';});
  D.sourcesList.addEventListener('drop',e=>{e.preventDefault();const target=e.target.closest('.source-item')?.dataset.sid;if(dragSid&&target&&dragSid!==target){const fi=S.srcs.findIndex(s=>s.id===dragSid),ti=S.srcs.findIndex(s=>s.id===target);const[src]=S.srcs.splice(fi,1);S.srcs.splice(ti,0,src);rebuildZ();renderSources();_coSafe(co=>co.broadcastSrcReorder(_currentSrcOrder()));}dragSid=null;});
  D.joinRoomCode.oninput=e=>{let v=e.target.value.replace(/[^A-Za-z0-9]/g,'').toUpperCase();if(v.length>4)v=v.slice(0,4)+'-'+v.slice(4,8);e.target.value=v;};
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

function rebuildZ(){S.items.forEach(it=>{const idx=S.srcs.findIndex(s=>s.id===it.sid);if(idx>=0)it.z=S.srcs.length-idx;});}

// ═══════════════════════════════════════════════════════════
//  SCENE INTERACTION (unchanged)
// ═══════════════════════════════════════════════════════════
function setupScene(){
  const cv=D.sceneCanvas;
  // Resize observer: scale canvas display size to fill available area while keeping 16:9 aspect
  if(typeof ResizeObserver!=='undefined'&&D.scenePreview){
    const ro=new ResizeObserver(()=>{
      const area=D.scenePreview;
      const aw=area.clientWidth-4, ah=area.clientHeight-4;
      if(aw>0&&ah>0){
        const scaleX=aw/S.cw, scaleY=ah/S.ch;
        const scale=Math.min(scaleX,scaleY);
        cv.style.width=Math.round(S.cw*scale)+'px';
        cv.style.height=Math.round(S.ch*scale)+'px';
        cv.style.maxWidth='none';cv.style.maxHeight='none';
      }
    });
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
    // Final flush of the in-progress edit so peers see the exact final state
    if(finishedSid&&S.co){
      const it=S.items.find(s=>s.sid===finishedSid);
      if(it){ S.co.queueItemUpsert(it); S.co.flushItem(finishedSid); }
    }
  };
  cv.onmouseup=endI;
  document.addEventListener('mouseup',e=>{if(S.drag||S.res||S.rot||S.rotC||S.crop)endI();});
  document.addEventListener('mousemove',e=>{if(!S.drag&&!S.res&&!S.rot&&!S.rotC&&!S.crop)return;const{x:mx,y:my}=toCanvas(cv,e);const cw=S.cw,ch=S.ch;if(S.drag){const it=S.items.find(s=>s.sid===S.drag.sid);if(!it)return;if(S.drag.panCrop){const rmI=rotMat(-it.rot);const ddx=mx-S.drag.startMx,ddy=my-S.drag.startMy;const lx=rmI.a*ddx+rmI.c*ddy,ly=rmI.b*ddx+rmI.d*ddy;let px=S.drag.startPanDx+lx,py=S.drag.startPanDy+ly;const cr=it.crop||{l:0,t:0,r:0,b:0};const isCircle=it.cropMask==='circle';      if(isCircle){
        // For circle mask we use COVER scaling × CIRCLE_PAN_ZOOM — gives wiggle room on BOTH axes
        const _src=S.srcs.find(s=>s.id===it.sid);
        const sw=Math.max(1,_src&&_src.el?(_src.el.videoWidth*(1-cr.l-cr.r)):it.w);
        const sh=Math.max(1,_src&&_src.el?(_src.el.videoHeight*(1-cr.t-cr.b)):it.h);
        const cs=Math.max(it.w/sw,it.h/sh)*CIRCLE_PAN_ZOOM;
        const dw=sw*cs,dh=sh*cs;
        const maxPx=Math.max(0,(dw-it.w)/2);
        const maxPy=Math.max(0,(dh-it.h)/2);
        px=Math.max(-maxPx,Math.min(maxPx,px));
        py=Math.max(-maxPy,Math.min(maxPy,py));
      }else{const vw=1-cr.l-cr.r,vh=1-cr.t-cr.b;if(vw>0.01){const mxL=cr.l*it.w/vw,mxR=-cr.r*it.w/vw;px=Math.max(mxR,Math.min(mxL,px));}else px=0;if(vh>0.01){const myT=cr.t*it.h/vh,myB=-cr.b*it.h/vh;py=Math.max(myB,Math.min(myT,py));}else py=0;}it.panDx=px;it.panDy=py;return;}let ncx=mx-S.drag.dx,ncy=my-S.drag.dy;if(Math.abs(ncx-it.w/2)<SNAP)ncx=it.w/2;if(Math.abs(ncy-it.h/2)<SNAP)ncy=it.h/2;if(Math.abs(ncx+it.w/2-cw)<SNAP)ncx=cw-it.w/2;if(Math.abs(ncy+it.h/2-ch)<SNAP)ncy=ch-it.h/2;if(Math.abs(ncx-cw/2)<SNAP)ncx=cw/2;if(Math.abs(ncy-ch/2)<SNAP)ncy=ch/2;it.cx=ncx;it.cy=ncy;const cr=it.crop||{l:0,t:0,r:0,b:0};const rm=rotMat(it.rot);it.uncropCx=it.cx-rm.a*(cr.l-cr.r)*it.uncropW/2-rm.c*(cr.t-cr.b)*it.uncropH/2;it.uncropCy=it.cy-rm.b*(cr.l-cr.r)*it.uncropW/2-rm.d*(cr.t-cr.b)*it.uncropH/2;return;}if(S.rot){const it=S.items.find(s=>s.sid===S.rot.sid);if(!it)return;let ns=Math.hypot(mx-it.cx,my-it.cy)/S.rot.startDist;ns=Math.max(.02,Math.min(10,ns));if(ns<.06&&!S.rot._fp){S.rot._fp=true;it.flipH=!it.flipH;}if(ns>.12)S.rot._fp=false;it.w=S.rot.origW*ns;it.h=S.rot.origH*ns;if(it.cropMask==='circle'){const s=Math.max(it.w,it.h);it.w=s;it.h=s;}_enforceCircle(it);return;}if(S.rotC){const it=S.items.find(s=>s.sid===S.rotC.sid);if(!it)return;let newRot=S.rotC.origRot+(Math.atan2(my-it.cy,mx-it.cx)*180/Math.PI-S.rotC.startAngle);for(const s of[0,90,180,270,-90,-180,-270]){if(Math.abs(newRot-s)<5){newRot=s;break;}}it.rot=newRot;let r=Math.hypot(mx-it.cx,my-it.cy)/Math.max(1,S.rotC.startDist);let nw=Math.max(MIN_DIM,S.rotC.origW*r),nh=Math.max(MIN_DIM,S.rotC.origH*r);it.w=nw;it.h=nh;if(it.cropMask==='circle'){const s=Math.max(nw,nh);it.w=s;it.h=s;}_enforceCircle(it);return;}if(S.crop){const it=S.items.find(s=>s.sid===S.crop.sid);if(!it)return;const hid=S.crop.hid;const oc=S.crop.origCrop;const n={...oc};const rm0=rotMat(-it.rot);const dx0=mx-it.uncropCx,dy0=my-it.uncropCy;const mLoc={x:rm0.a*dx0+rm0.c*dy0,y:rm0.b*dx0+rm0.d*dy0};const sLoc=S.crop.startLocal;const dlx=mLoc.x-sLoc.x,dly=mLoc.y-sLoc.y;const bw=it.uncropW,bh=it.uncropH;if(hid==='tm'){n.t=Math.max(0,Math.min(.9,oc.t+dly/bh));}else if(hid==='bm'){n.b=Math.max(0,Math.min(.9,oc.b-dly/bh));}else if(hid==='ml'){n.l=Math.max(0,Math.min(.9,oc.l+dlx/bw));}else if(hid==='mr'){n.r=Math.max(0,Math.min(.9,oc.r-dlx/bw));}else if(hid==='tl'){const cf_l=Math.max(0,Math.min(.45,oc.l+dlx/bw));const cf_t=Math.max(0,Math.min(.45,oc.t+dly/bh));n.l=cf_l;n.r=cf_l;n.t=cf_t;n.b=cf_t;}else if(hid==='tr'){const cf_r=Math.max(0,Math.min(.45,oc.r-dlx/bw));const cf_t=Math.max(0,Math.min(.45,oc.t+dly/bh));n.l=cf_r;n.r=cf_r;n.t=cf_t;n.b=cf_t;}else if(hid==='bl'){const cf_l=Math.max(0,Math.min(.45,oc.l+dlx/bw));const cf_b=Math.max(0,Math.min(.45,oc.b-dly/bh));n.l=cf_l;n.r=cf_l;n.t=cf_b;n.b=cf_b;}else if(hid==='br'){const cf_r=Math.max(0,Math.min(.45,oc.r-dlx/bw));const cf_b=Math.max(0,Math.min(.45,oc.b-dly/bh));n.l=cf_r;n.r=cf_r;n.t=cf_b;n.b=cf_b;}it.crop=n;if(hid==='tl'||hid==='tr'||hid==='bl'||hid==='br'){const avg=(n.l+n.r+n.t+n.b)/4;if(Math.abs(n.l-avg)<0.03&&Math.abs(n.r-avg)<0.03&&Math.abs(n.t-avg)<0.03&&Math.abs(n.b-avg)<0.03){n.l=avg;n.r=avg;n.t=avg;n.b=avg;it.crop=n;}for(const preset of[0.25,0.33,0.5]){if(Math.abs(n.l-preset)<0.02){n.l=preset;n.r=preset;n.t=preset;n.b=preset;it.crop=n;break;}}}const visW=1-n.l-n.r,visH=1-n.t-n.b;it.w=it.uncropW*visW;it.h=it.uncropH*visH;const nlcx=(n.l-n.r)*it.uncropW/2;const nlcy=(n.t-n.b)*it.uncropH/2;const rm=rotMat(it.rot);it.cx=it.uncropCx+rm.a*nlcx+rm.c*nlcy;it.cy=it.uncropCy+rm.b*nlcx+rm.d*nlcy;return;}if(S.res){const it=S.items.find(s=>s.sid===S.res.sid);if(!it)return;const rm=rotMat(it.rot);const dwx=mx-S.res.anchorWorld.x,dwy=my-S.res.anchorWorld.y;let nw,nh;const natAR=it.cropMask==='circle'?1:(it.naturalAR||S.res.origAR);if(e.shiftKey){nh=Math.abs(rm.c*dwx+rm.d*dwy);nw=Math.abs(rm.a*dwx+rm.b*dwy);}else{const d=Math.hypot(rm.a*dwx+rm.b*dwy,rm.c*dwx+rm.d*dwy)/Math.max(1,Math.hypot(S.res.origW,S.res.origH))*2;nw=S.res.origW*d;nh=nw/natAR;}nw=Math.max(MIN_DIM,nw);nh=Math.max(MIN_DIM,nh);it.w=nw;it.h=nh;if(it.cropMask==='circle'){const s=Math.max(nw,nh);it.w=s;it.h=s;}_enforceCircle(it);const op=opposite(S.res.hid,it.w,it.h);it.cx=S.res.anchorWorld.x-(rm.a*op.x+rm.c*op.y);it.cy=S.res.anchorWorld.y-(rm.b*op.x+rm.d*op.y);return;}});
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
    else if(a==='maskRect') it.cropMask='rect';
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
function render(){
  S.frameAnimTime=performance.now()/1000;
  const c=S.ctx;if(!c)return;const cw=S.cw,ch=S.ch;
  // Канвас остаётся ПРОЗРАЧНЫМ — фон сцены рисуется CSS-ом под ним. Это позволяет
  // edge-dissolve реально РАСТВОРЯТЬ края в прозрачность (а не показывать чёрный).
  c.clearRect(0,0,cw,ch);
  // Тонкая декоративная рамка сцены (рисуем поверх — она сама по себе прозрачна).
  c.strokeStyle='rgba(255,210,60,.12)';c.lineWidth=4;c.strokeRect(2,2,cw-4,ch-4);
  // Optional rule-of-thirds grid — visible but unobtrusive
  if(S.showGrid){
    c.save();
    // Glow outline first (wider, more transparent)
    c.strokeStyle='rgba(255,210,60,.35)';
    c.lineWidth=4;
    c.shadowColor='rgba(255,210,60,.45)';c.shadowBlur=10;
    c.beginPath();
    for(let i=1;i<3;i++){
      c.moveTo((cw/3)*i,0);c.lineTo((cw/3)*i,ch);
      c.moveTo(0,(ch/3)*i);c.lineTo(cw,(ch/3)*i);
    }
    c.stroke();
    c.shadowBlur=0;
    // Sharp inner line
    c.strokeStyle='rgba(255,255,255,.55)';
    c.lineWidth=1.5;
    c.setLineDash([10,6]);
    c.beginPath();
    for(let i=1;i<3;i++){
      c.moveTo((cw/3)*i,0);c.lineTo((cw/3)*i,ch);
      c.moveTo(0,(ch/3)*i);c.lineTo(cw,(ch/3)*i);
    }
    c.stroke();
    // Center cross marker
    c.setLineDash([]);
    c.strokeStyle='rgba(255,210,60,.7)';
    c.lineWidth=1.5;
    const cs=14;
    c.beginPath();
    c.moveTo(cw/2-cs,ch/2);c.lineTo(cw/2+cs,ch/2);
    c.moveTo(cw/2,ch/2-cs);c.lineTo(cw/2,ch/2+cs);
    c.stroke();
    c.restore();
  }
  // Optional safe-area overlays (5% / 10%)
  if(S.showSafeAreas){
    c.save();
    c.strokeStyle='rgba(255,210,60,.35)';
    c.lineWidth=2;
    c.setLineDash([8,8]);
    const o5=Math.min(cw,ch)*0.05;
    const o10=Math.min(cw,ch)*0.10;
    c.strokeRect(o5,o5,cw-o5*2,ch-o5*2);
    c.strokeStyle='rgba(231,76,60,.35)';
    c.strokeRect(o10,o10,cw-o10*2,ch-o10*2);
    c.setLineDash([]);
    c.restore();
  }
  for(const it of[...S.items].sort((a,b)=>a.z-b.z)){
    const src=S.srcs.find(s=>s.id===it.sid);if(!src||!src.visible||!src.el)continue;const v=src.el;if(v.readyState<2)continue;const cr=it.crop||{l:0,t:0,r:0,b:0};
    try{
    c.save();c.translate(it.cx,it.cy);c.rotate(it.rot*Math.PI/180);c.scale(it.flipH?-1:1,it.flipV?-1:1);
    // Draw outward glow BEFORE clipping (so it extends beyond mask)
    _drawBorderGlowOut(c,it);
    // Apply crop mask clipping (before drawImage so mask affects the video)
    const maskType=it.cropMask||'none';
    if(maskType==='circle'){
      const cr_=Math.min(it.w,it.h)/2;
      c.beginPath();c.arc(0,0,cr_,0,Math.PI*2);c.clip();
    }else if(maskType==='rounded'){
      const r=Math.min(it.w,it.h)*0.15;
      _roundedRectPath(c,-it.w/2,-it.h/2,it.w,it.h,r);c.clip();
    }else if(maskType==='rect'){
      c.beginPath();c.rect(-it.w/2,-it.h/2,it.w,it.h);c.clip();
    }
    // Apply camera settings via filter ONLY if non-default
    const cs=src.camSettings;
    const hasCamFx=cs&&(cs.brightness!==0||cs.contrast!==0||cs.saturation!==0||(cs.temperature&&cs.temperature!==6500)||(cs.sharpness&&cs.sharpness>0)||(cs.hue&&cs.hue!==0)||(cs.sepia&&cs.sepia!==0));
    if(hasCamFx){
      const fs=[];
      if(cs.brightness!==0) fs.push('brightness('+(1+cs.brightness/100)+')');
      if(cs.contrast!==0) fs.push('contrast('+(1+cs.contrast/100)+')');
      if(cs.saturation!==0) fs.push('saturate('+(1+cs.saturation/100)+')');
      if(cs.temperature&&cs.temperature!==6500){
        const shift=(cs.temperature-6500)/2500;
        if(shift>0) fs.push('sepia('+Math.min(shift*0.5,0.6)+') saturate('+(1+shift*0.15)+')');
        else fs.push('hue-rotate('+(shift*15)+'deg) saturate('+(1+Math.abs(shift)*0.1)+')');
      }
      if(cs.sharpness&&cs.sharpness>0) fs.push('contrast('+(1+cs.sharpness*0.003)+')');
      if(cs.hue&&cs.hue!==0) fs.push('hue-rotate('+cs.hue+'deg)');
      if(cs.sepia&&cs.sepia!==0) fs.push('sepia('+(cs.sepia/100)+')');
      if(fs.length) c.filter=fs.join(' ');
    }
    const sx=cr.l*v.videoWidth,sy=cr.t*v.videoHeight;
    const pdx=it.panDx||0,pdy=it.panDy||0;
    const sw=Math.max(1,v.videoWidth*(1-cr.l-cr.r)),sh=Math.max(1,v.videoHeight*(1-cr.t-cr.b));
    try{
      if(it.cropMask==='circle'){
        const cs=Math.max(it.w/sw,it.h/sh)*CIRCLE_PAN_ZOOM;
        const dw=sw*cs,dh=sh*cs;
        c.drawImage(v,sx-pdx*(sw/dw),sy-pdy*(sh/dh),sw,sh,-dw/2,-dh/2,dw,dh);
      }else{
        const scX=sw/it.w,scY=sh/it.h;
        c.drawImage(v,sx-pdx*scX,sy-pdy*scY,sw,sh,-it.w/2,-it.h/2,it.w,it.h);
      }
    }catch(e){}
    // Edge dissolve (transparent fade) is handled inside _drawBorder so it works for preview too.
    if(hasCamFx) c.filter='none';
    // Draw border/frame inside the clip (inward glow + stroke + blur + vignette)
    _drawBorder(c,it);
    c.restore();
    }catch(e){try{c.restore();}catch(e2){}}
    if(S.selItem===it.sid){
      c.save();c.translate(it.cx,it.cy);c.rotate(it.rot*Math.PI/180);
      const accent=(_themeAccentCache())||'#ffd23c';
      const handleStroke=(_themeHandleStrokeCache())||'#1a1a2e';
      const isLocked=src.locked;
      // Outline (slightly thicker, with subtle outer glow for premium feel)
      c.shadowColor=accent;c.shadowBlur=isLocked?0:8;
      c.strokeStyle=isLocked?'#f0a030':accent;c.lineWidth=3;
      c.strokeRect(-it.w/2,-it.h/2,it.w,it.h);
      c.shadowBlur=0;
      if(!isLocked){
        c.fillStyle=accent;
        const hw=it.w/2,hh=it.h/2;
        for(const p of[{x:-hw,y:-hh},{x:hw,y:-hh},{x:-hw,y:hh},{x:hw,y:hh},{x:0,y:-hh},{x:0,y:hh},{x:-hw,y:0},{x:hw,y:0}]){
          c.beginPath();c.arc(p.x,p.y,HANDLE_R,0,Math.PI*2);c.fill();
          c.strokeStyle=handleStroke;c.lineWidth=2;c.stroke();
        }
        c.beginPath();c.moveTo(hw+4,0);c.lineTo(hw+ROT_OFF-HANDLE_R,0);
        c.strokeStyle=accent;c.lineWidth=2;c.stroke();
        c.beginPath();c.arc(hw+ROT_OFF,0,HANDLE_R+2,0,Math.PI*2);c.fillStyle=accent;c.fill();
        c.strokeStyle=handleStroke;c.lineWidth=2;c.stroke();
      }else{
        // Lock badge — small lock icon at top-right corner
        const hw=it.w/2,hh=it.h/2;
        c.fillStyle='rgba(240,160,48,.92)';
        c.beginPath();c.arc(hw-12,-hh+12,10,0,Math.PI*2);c.fill();
        c.strokeStyle='#1a1a2e';c.lineWidth=1;c.stroke();
        c.fillStyle='#1a1a2e';c.font='bold 11px Segoe UI';c.textAlign='center';c.textBaseline='middle';
        c.fillText('🔒',hw-12,-hh+12);
      }
      c.restore();
    }
  }
  if(S.streaming&&S.rtmp)D.streamUptime.textContent=S.rtmp.getUptime();
}

function _roundedRectPath(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  c.beginPath();
  c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);
  c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);
  c.lineTo(x+r,y+h);c.arcTo(x,y+h,x,y+h-r,r);
  c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);
  c.closePath();
}

function _drawBorderGlowOut(c,it){
  const fs=it.frameSettings;
  if(!fs) return;
  if(!fs.glow||!fs.glow.enabled||!fs.glow.outward) return;
  const hw=it.w/2,hh=it.h/2;
  const maskType=it.cropMask||'none';
  const isRound=maskType==='circle';
  const isRounded=maskType==='rounded';
  const rr=isRounded?Math.min(it.w,it.h)*0.15:0;
  const t=S.frameAnimTime||0;
  let color=fs.color,glowColor=fs.glow.color,thickness=fs.thickness,opacity=fs.opacity;
  const animType=fs.animation||'none';
  const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;
  if(animType==='pulse') thickness=fs.thickness*(1+0.5*animI*Math.sin(t*3));
  else if(animType==='breathe') opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
  else if(animType==='colorShift'){const hsl=_hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;color=_hslToHex(hsl.h,hsl.s,hsl.l);if(fs.glow.color===fs.color)glowColor=color;}
  else if(animType==='rainbow'){const h2=_hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;color=_hslToHex(h2.h,90,55);glowColor=color;}
  thickness=Math.max(1,thickness);opacity=Math.max(0,Math.min(1,opacity));
  const glowSize=Math.max(2,fs.glow.size||15);

  // Adaptive reach: halo SHOULD NOT extend further than free space around the item, otherwise we
  // see a sharp clipping at the canvas border ("обрезанные границы"). Auto-limit by available room.
  // Skip auto-limit for preview-mode items (cx/cy ≈ 0) so design preview shows full halo.
  let reach=glowSize*1.6;
  const isPreview=it._isPreview||(Math.abs(it.cx||0)<1&&Math.abs(it.cy||0)<1);
  if(!isPreview){
    const sceneMaxX=Math.max(20,Math.min(it.cx,Math.max(20,(S.cw||1920)-it.cx))-Math.max(hw,hh));
    const sceneMaxY=Math.max(20,Math.min(it.cy,Math.max(20,(S.ch||1080)-it.cy))-Math.max(hw,hh));
    const sceneRoom=Math.max(20,Math.min(sceneMaxX,sceneMaxY));
    reach=Math.min(reach,sceneRoom);
  }

  // Helper: stroke the path that matches the crop shape (so glow follows the actual outline)
  function strokeShape(){
    if(isRound){c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.stroke();}
    else if(isRounded){_roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
    else c.strokeRect(-hw,-hh,it.w,it.h);
  }

  if(isRound){
    // ── Круг — мягкий радиальный halo с расширенным fadeout для дифузии.
    c.save();
    const baseR=Math.min(hw,hh);
    // Старт градиента почти от края, очень мягкий «hot-spot» и длинный шлейф.
    const innerR=baseR*0.985;
    const outerR=baseR+reach*1.10;
    const grd=c.createRadialGradient(0,0,innerR,0,0,outerR);
    // НИЗКИЕ значения альфы и многоступенчатый fade — не «ореол», а «дымка».
    grd.addColorStop(0.00,_hexToRGBA(glowColor,opacity*0.55));
    grd.addColorStop(0.10,_hexToRGBA(glowColor,opacity*0.38));
    grd.addColorStop(0.28,_hexToRGBA(glowColor,opacity*0.20));
    grd.addColorStop(0.55,_hexToRGBA(glowColor,opacity*0.08));
    grd.addColorStop(0.82,_hexToRGBA(glowColor,opacity*0.025));
    grd.addColorStop(1.00,_hexToRGBA(glowColor,0));
    c.fillStyle=grd;
    const M=Math.max(hw,hh),pad=reach*1.2+thickness*2+40;
    c.fillRect(-M-pad,-M-pad,(M+pad)*2,(M+pad)*2);
    // Вычистить пиксели внутри маски — halo только снаружи.
    c.globalCompositeOperation='destination-out';
    c.beginPath();c.arc(0,0,baseR,0,Math.PI*2);c.fill();
    c.restore();
  }else{
    // ── SHAPE-AWARE HALO для rect / rounded / none — мягче и диффузнее.
    // 6 проходов: больше Gaussian-blur, плавнее нарастание, меньшая пиковая альфа.
    const baseW=Math.max(thickness*1.0, reach*0.08);
    const passes=[
      {blur:reach*1.05, lw:baseW+reach*1.30, alpha:0.04},
      {blur:reach*0.80, lw:baseW+reach*0.95, alpha:0.07},
      {blur:reach*0.55, lw:baseW+reach*0.65, alpha:0.11},
      {blur:reach*0.35, lw:baseW+reach*0.40, alpha:0.16},
      {blur:reach*0.18, lw:baseW+reach*0.20, alpha:0.22},
      {blur:reach*0.06, lw:baseW+reach*0.06, alpha:0.30},
    ];
    for(const p of passes){
      c.save();
      c.filter='blur('+Math.max(0,p.blur).toFixed(1)+'px)';
      c.strokeStyle=glowColor;
      c.lineWidth=Math.max(1,p.lw);
      c.globalAlpha=opacity*p.alpha;
      c.lineJoin='round';c.lineCap='round';
      strokeShape();
      c.filter='none';
      c.restore();
    }
    // Вычистить halo внутри маски — оставляем только наружный «свет».
    c.save();
    c.globalCompositeOperation='destination-out';
    c.fillStyle='#000';
    if(isRounded){_roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.fill();}
    else c.fillRect(-hw,-hh,it.w,it.h);
    c.restore();
  }
}

function _drawBorder(c,it){
  const fs=it.frameSettings;
  const hw=it.w/2, hh=it.h/2;
  const maskType=it.cropMask||'none';
  const isRound=maskType==='circle';
  const isRounded=maskType==='rounded';
  const rr=isRounded?Math.min(it.w,it.h)*0.15:0;
  const t=S.frameAnimTime||0;

  // Helper: stroke the outline path matching the crop shape
  function strokeOutline(){
    if(isRound){c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.stroke();}
    else if(isRounded){_roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
    else c.strokeRect(-hw,-hh,it.w,it.h);
  }

  // ─── VIGNETTE (затемнение по краям) ───
  if(fs&&fs.vignette&&fs.vignette.enabled){
    c.save();c.globalAlpha=fs.vignette.strength;
    const vSize=fs.vignette.size/100;
    const innerR=Math.max(0,Math.min(hw,hh)*(1-vSize)),outerR=Math.max(1,Math.min(hw,hh));
    if(outerR>innerR){
    const grd=c.createRadialGradient(0,0,innerR,0,0,outerR);
    grd.addColorStop(0,'rgba(0,0,0,0)');
    const vc=_hexToRGBA(fs.vignetteColor||'#000000',0.95);
    grd.addColorStop(1,vc);
    c.fillStyle=grd;_borderPath(c,hw,hh,it.w,it.h,isRound,isRounded,rr);c.fill();}
    c.restore();
  }

  // ─── FRAME BORDER (stroke) — only if enabled AND not hidden ───
  if(!fs||!fs.enabled) return;

  let thickness=fs.thickness,opacity=fs.opacity,color=fs.color;
  let animType=fs.animation||'none';
  let glowColor=fs.glow?fs.glow.color:color;
  let glowSize=fs.glow?fs.glow.size:0;

  const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;
  if(animType==='pulse') thickness=fs.thickness*(1+0.5*animI*Math.sin(t*3));
  else if(animType==='breathe') opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
  else if(animType==='colorShift'){const hsl=_hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;color=_hslToHex(hsl.h,hsl.s,hsl.l);if(fs.glow&&fs.glow.enabled&&fs.glow.color===fs.color)glowColor=color;}
  else if(animType==='rainbow'){const h2=_hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;color=_hslToHex(h2.h,90,55);glowColor=color;}
  else if(animType==='shimmer'){opacity=fs.opacity*(0.55+0.45*animI*Math.sin(t*8));glowSize=glowSize*(1+0.6*animI*Math.sin(t*6));}
  else if(animType==='flow'){const hsl=_hexToHSL(fs.color);hsl.h=(hsl.h+Math.sin(t*1.5)*60*animI)%360;color=_hslToHex(hsl.h,hsl.s,hsl.l);glowColor=color;}

  thickness=Math.max(1,thickness);opacity=Math.max(0,Math.min(1,opacity));

  function strokeMask(){
    if(isRound){c.beginPath();c.ellipse(0,0,hw,hh,0,0,Math.PI*2);c.stroke();}
    else if(isRounded){_roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
    else c.strokeRect(-hw,-hh,it.w,it.h);
  }
  function pathMaskInset(ins){
    if(isRound){c.beginPath();c.ellipse(0,0,Math.max(1,hw-ins),Math.max(1,hh-ins),0,0,Math.PI*2);}
    else if(isRounded){_roundedRectPath(c,-hw+ins,-hh+ins,it.w-ins*2,it.h-ins*2,Math.max(0,rr-ins));}
    else{c.beginPath();c.rect(-hw+ins,-hh+ins,it.w-ins*2,it.h-ins*2);}
  }

  c.save();c.globalAlpha=opacity;

  // Inward glow — мягкая «дымка», переходящая в едва заметный rim, без резкого ореола.
  if(fs.glow&&fs.glow.enabled&&fs.glow.inward&&glowSize>0){
    // 1) Радиальный градиент от прозрачного центра к ОЧЕНЬ мягкому краю.
    c.save();
    c.globalCompositeOperation='source-over';
    const innerR=Math.max(1,Math.min(hw,hh)-glowSize*1.8);
    const outerR=Math.max(innerR+1,Math.min(hw,hh)*1.02);
    const innerGrd=c.createRadialGradient(0,0,innerR,0,0,outerR);
    innerGrd.addColorStop(0.00,_hexToRGBA(glowColor,0));
    innerGrd.addColorStop(0.45,_hexToRGBA(glowColor,opacity*0.06));
    innerGrd.addColorStop(0.72,_hexToRGBA(glowColor,opacity*0.16));
    innerGrd.addColorStop(0.90,_hexToRGBA(glowColor,opacity*0.32));
    innerGrd.addColorStop(1.00,_hexToRGBA(glowColor,opacity*0.48));
    c.fillStyle=innerGrd;
    if(isRound){c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.fill();}
    else if(isRounded){_roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.fill();}
    else c.fillRect(-hw,-hh,it.w,it.h);
    c.restore();
    // 2) Мягкие blur-страйки внутрь — два прохода, низкая альфа.
    const layers=[
      {blur:glowSize*1.4,alpha:0.10,lw:thickness*0.8},
      {blur:glowSize*0.6,alpha:0.20,lw:thickness*0.5},
    ];
    for(const layer of layers){
      c.save();c.shadowColor=glowColor;c.shadowBlur=layer.blur;c.strokeStyle=color;c.lineWidth=layer.lw;c.globalAlpha=opacity*layer.alpha;
      strokeMask();c.shadowBlur=0;c.restore();
    }
  }

  const style=fs.style||'solid';
  if(style==='solid'){c.strokeStyle=color;c.lineWidth=thickness;c.setLineDash([]);strokeMask();}
  else if(style==='double'){const gap=Math.max(2,thickness*0.4);c.strokeStyle=color;c.lineWidth=thickness*0.6;c.setLineDash([]);strokeMask();const inset=thickness*0.3+gap;pathMaskInset(inset);c.stroke();}
  else if(style==='dashed'){c.strokeStyle=color;c.lineWidth=thickness;c.setLineDash([thickness*3,thickness*2]);strokeMask();c.setLineDash([]);}
  else if(style==='dotted'){c.strokeStyle=color;c.lineWidth=thickness;c.setLineDash([thickness*0.5,thickness*1.5]);c.lineCap='round';strokeMask();c.setLineDash([]);c.lineCap='butt';}
  else if(style==='ornate'){
    const gap=Math.max(2,thickness*0.35);c.strokeStyle=color;c.lineWidth=thickness*0.55;c.setLineDash([]);strokeMask();
    const inset=thickness*0.25+gap;pathMaskInset(inset);c.stroke();
    const dSize=thickness*0.8;c.fillStyle=color;
    if(isRound){for(let i=0;i<8;i++){const ang=i*Math.PI/4;c.save();c.translate(Math.cos(ang)*hw,Math.sin(ang)*hh);c.rotate(ang+Math.PI/4);c.fillRect(-dSize/2,-dSize/2,dSize,dSize);c.restore();}}
    else if(isRounded){[{x:-hw+rr,y:-hh+rr},{x:hw-rr,y:-hh+rr},{x:hw-rr,y:hh-rr},{x:-hw+rr,y:hh-rr}].forEach(p=>{c.save();c.translate(p.x,p.y);c.rotate(Math.PI/4);c.fillRect(-dSize/2,-dSize/2,dSize,dSize);c.restore();});}
    else{[{x:-hw,y:-hh},{x:hw,y:-hh},{x:-hw,y:hh},{x:hw,y:hh}].forEach(p=>{c.save();c.translate(p.x,p.y);c.rotate(Math.PI/4);c.fillRect(-dSize/2,-dSize/2,dSize,dSize);c.restore();});}
  }
  else if(style==='gradient'){
    const g1=fs.gradientColor1||color,g2=fs.gradientColor2||_hslToHex((_hexToHSL(color).h+120)%360,_hexToHSL(color).s,_hexToHSL(color).l),g3=fs.gradientColor3||g1;
    const grad=c.createLinearGradient(-hw,-hh,hw,hh);const gOff=animType==='flow'?(t*0.3)%1:0;
    grad.addColorStop(0,g1);grad.addColorStop(Math.min(0.5,0.33+gOff*0.34),g2);grad.addColorStop(1,g3);
    c.strokeStyle=grad;c.lineWidth=thickness;c.setLineDash([]);strokeMask();
  }
  else if(style==='ridge'){c.strokeStyle=_hslToHex(_hexToHSL(color).h,_hexToHSL(color).s,Math.max(0,_hexToHSL(color).l-25));c.lineWidth=thickness;c.setLineDash([]);strokeMask();c.strokeStyle=_hslToHex(_hexToHSL(color).h,_hexToHSL(color).s,Math.min(100,_hexToHSL(color).l+25));c.lineWidth=thickness*0.35;pathMaskInset(thickness*0.35);c.stroke();}
  else if(style==='inset'){c.strokeStyle=_hslToHex(_hexToHSL(color).h,_hexToHSL(color).s,Math.min(100,_hexToHSL(color).l+20));c.lineWidth=thickness*0.5;c.setLineDash([]);strokeMask();c.strokeStyle=_hslToHex(_hexToHSL(color).h,_hexToHSL(color).s,Math.max(0,_hexToHSL(color).l-20));c.lineWidth=thickness*0.5;pathMaskInset(thickness*0.5);c.stroke();}
  else if(style==='glow'){[{blur:thickness*3,alpha:0.1},{blur:thickness*2,alpha:0.2},{blur:thickness,alpha:0.4},{blur:thickness*0.4,alpha:0.7}].forEach(l=>{c.save();c.shadowColor=color;c.shadowBlur=l.blur;c.strokeStyle=color;c.lineWidth=thickness*0.3;c.globalAlpha=opacity*l.alpha;strokeMask();c.shadowBlur=0;c.restore();});}

  if(animType==='flow'&&style!=='gradient'){c.save();c.globalAlpha=opacity*0.6;c.strokeStyle=color;c.lineWidth=thickness*0.6;c.setLineDash([thickness*4,thickness*8]);c.lineDashOffset=-t*80;strokeMask();c.setLineDash([]);c.restore();}

  if(animType==='shimmer'){
    c.save();const seed=Math.floor(t*8);
    let pm;if(isRound)pm=2*Math.PI*Math.max(hw,hh);else pm=2*(it.w+it.h);
    for(let i=0;i<16;i++){
      const hash=((seed*31+i*17)%1000)/1000,pos=hash*pm;let sx,sy;
      if(isRound){const ang=pos/Math.max(hw,hh);sx=Math.cos(ang)*hw;sy=Math.sin(ang)*hh;}
      else{if(pos<it.w){sx=-hw+pos;sy=-hh;}else if(pos<it.w+it.h){sx=hw;sy=-hh+(pos-it.w);}else if(pos<2*it.w+it.h){sx=hw-(pos-it.w-it.h);sy=hh;}else{sx=-hw;sy=hh-(pos-2*it.w-it.h);}}
      const br=0.5+0.5*Math.sin(t*12+i*2.5);
      if(br>0.5){c.fillStyle=color;c.globalAlpha=opacity*br;const sz=Math.max(2,thickness*0.5);c.save();c.translate(sx,sy);c.rotate(t*2+i);c.beginPath();for(let p=0;p<4;p++){const a=p*Math.PI/2;c.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);c.lineTo(Math.cos(a+Math.PI/4)*sz*0.3,Math.sin(a+Math.PI/4)*sz*0.3);}c.closePath();c.fill();c.restore();}
    }
    c.restore();
  }
  c.restore();
}

function _borderPath(c,hw,hh,w,h,isRound,isRounded,rr){
  if(isRound){c.beginPath();c.ellipse(0,0,hw,hh,0,0,Math.PI*2);}
  else if(isRounded){_roundedRectPath(c,-hw,-hh,w,h,rr);}
  else{c.beginPath();c.rect(-hw,-hh,w,h);}
}

function _hexToRGBA(hex,alpha){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return 'rgba('+r+','+g+','+b+','+alpha+')';
}

// Color utility functions for animation
function _hexToHSL(hex){
  let r=parseInt(hex.slice(1,3),16)/255;
  let g=parseInt(hex.slice(3,5),16)/255;
  let b=parseInt(hex.slice(5,7),16)/255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b);
  let h,s,l=(max+min)/2;
  if(max===min){h=s=0;}else{
    const d=max-min;
    s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max){
      case r:h=((g-b)/d+(g<b?6:0))/6;break;
      case g:h=((b-r)/d+2)/6;break;
      case b:h=((r-g)/d+4)/6;break;
    }
  }
  return{h:h*360,s:s*100,l:l*100};
}
function _hslToHex(h,s,l){
  h/=360;s/=100;l/=100;
  let r,g,b;
  if(s===0){r=g=b=l;}else{
    const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
    const q=l<0.5?l*(1+s):l+s-l*s;
    const p=2*l-q;
    r=hue2rgb(p,q,h+1/3);
    g=hue2rgb(p,q,h);
    b=hue2rgb(p,q,h-1/3);
  }
  const toHex=v=>{const hx=Math.round(Math.min(255,Math.max(0,v*255))).toString(16);return hx.length===1?'0'+hx:hx;};
  return'#'+toHex(r)+toHex(g)+toHex(b);
}

// ═══════════════════════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════════════════════
let curType=null,curDevs=[],curMicDevs=[];
function showM(n){
  if(n==='connect')D.connectModal.style.display='flex';
  if(n==='addSource'){D.addSourceModal.style.display='flex';D.deviceSelector.style.display='none';curType=null;}
  if(n==='addMic'){D.addMicModal.style.display='flex';loadMicList();}
  if(n==='settings'&&D.settingsModal){_populateSettingsModal();D.settingsModal.style.display='flex';}
  if(n==='help'&&D.helpModal){D.helpModal.style.display='flex';}
}
function hideM(n){
  if(n==='connect')D.connectModal.style.display='none';
  if(n==='addSource')D.addSourceModal.style.display='none';
  if(n==='addMic')D.addMicModal.style.display='none';
  if(n==='settings'&&D.settingsModal)D.settingsModal.style.display='none';
  if(n==='help'&&D.helpModal)D.helpModal.style.display='none';
}

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
    D.settingsFps.value=String(S.targetFps||60);
    D.settingsFps.onchange=()=>{
      S.targetFps=parseInt(D.settingsFps.value)||60;
      _scheduleSettingsSave();
    };
  }
  if(D.settingsReducedMotion){
    D.settingsReducedMotion.checked=!!S.reducedMotion;
    D.settingsReducedMotion.onchange=()=>{
      S.reducedMotion=D.settingsReducedMotion.checked;
      _applyTheme();
      _scheduleSettingsSave();
    };
  }
  if(D.settingsShowGrid){
    D.settingsShowGrid.checked=!!S.showGrid;
    D.settingsShowGrid.onchange=()=>{S.showGrid=D.settingsShowGrid.checked;_scheduleSettingsSave();};
  }
  if(D.settingsShowSafeArea){
    D.settingsShowSafeArea.checked=!!S.showSafeAreas;
    D.settingsShowSafeArea.onchange=()=>{S.showSafeAreas=D.settingsShowSafeArea.checked;_scheduleSettingsSave();};
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
async function confirmAdd(){
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
        video:{deviceId:{exact:d.deviceId},width:{ideal:1920},height:{ideal:1080}},
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

async function confirmAddMic(){
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
}

function addVideoSource(type,name,stream,isP=false,pid=null,opts){
  // opts: { gid, ownerPeerId, msid, suppressBroadcast, _existingSrcMeta } for replication
  opts=opts||{};
  const id=opts.gid||_newSid();
  const owner=opts.ownerPeerId|| (isP?pid:S.myPeerId);
  const msid=opts.msid||(stream?stream.id:null);
  const src={id,gid:id,ownerPeerId:owner,name,type,stream,msid,el:null,visible:true,locked:false,vol:1,muted:false,isPeer:isP,peerId:pid,vst:[],monitor:false,camSettings:{brightness:0,contrast:0,saturation:0,temperature:6500,sharpness:0,hue:0,sepia:0,autoFocus:true,resolution:''},fxState:_loadFxStateForName(name)};
  if(stream&&stream.getVideoTracks().length){const v=document.createElement('video');v.srcObject=stream;v.muted=true;v.playsInline=true;v.play().catch(()=>{});src.el=v;}
  S.srcs.push(src);
  if(src.el) addScene(src,!opts.suppressBroadcast); // create item; broadcast unless we're applying a remote op
  if(!isP&&S.wrtc&&stream) S.wrtc.addLocalStreamToAllPeers(stream);
  _wireTrackEndHandlers(src);
  rebuildZ();renderSources();updateE();
  if(!isP&&S.co&&!opts.suppressBroadcast) S.co.broadcastSourceAdd(src);
  return id;
}

function rmSrc(sid){
  const i=S.srcs.findIndex(s=>s.id===sid);if(i===-1)return;const s=S.srcs[i];
  _disconnectSource(sid);
  // Save source data for Ctrl+Z restore before stopping tracks
  const savedItem=S.items.find(x=>x.sid===sid);
  const restoreData={
    type:'delete-source',
    srcId:s.id,
    srcType:s.type,
    srcName:s.name,
    srcIsPeer:s.isPeer||false,
    srcPeerId:s.peerId||null,
    srcVol:s.vol,
    srcMuted:s.muted,
    srcVisible:s.visible,
    srcLocked:s.locked,
    srcCamSettings:s.camSettings?{...s.camCamSettings}:null,
    // Device info for re-acquiring the stream
    deviceId:s.stream&&s.stream.getVideoTracks().length?s.stream.getVideoTracks()[0].getSettings().deviceId:null,
    audioDeviceId:s.stream&&s.stream.getAudioTracks().length?s.stream.getAudioTracks()[0].getSettings().deviceId:null,
    // Saved item layout for undo
    item:savedItem?{
      cx:savedItem.cx,cy:savedItem.cy,w:savedItem.w,h:savedItem.h,z:savedItem.z,
      rot:savedItem.rot,flipH:savedItem.flipH,flipV:savedItem.flipV,
      crop:{...savedItem.crop},cropMask:savedItem.cropMask,
      frameSettings:savedItem.frameSettings?JSON.parse(JSON.stringify(savedItem.frameSettings)):null,
      uncropW:savedItem.uncropW,uncropH:savedItem.uncropH,uncropCx:savedItem.uncropCx,uncropCy:savedItem.uncropCy,
      panDx:savedItem.panDx||0,panDy:savedItem.panDy||0,
    }:null,
  };
  // Don't stop peer-owned tracks (they belong to the friend's MediaStream)
  if(s.stream&&!s.isPeer)s.stream.getTracks().forEach(t=>{try{t.stop();}catch(_){}});
  if(s.el){s.el.srcObject=null;s.el=null;}
  if(sid===S.desktopAudioId) S.desktopAudioId=null;
  S.items=S.items.filter(x=>x.sid!==sid);S.srcs.splice(i,1);
  if(S.selId===sid){S.selId=null;S.selItem=null;}
  // Push undo entry with delete-source data
  S._undoStack.push({label:'удаление «'+s.name+'»',type:'delete-source',restore:restoreData,t:Date.now()});
  while(S._undoStack.length>S._undoMax) S._undoStack.shift();
  rebuildZ();renderSources();renderMixer();updateE();
  // Broadcast removal — only the owner deletes; remote peers can also request removal but
  // CoScene relies on LWW + each peer's own copy: broadcast whenever a local action triggered it.
  if(S.co&&!_isRemote()) S.co.broadcastSourceRemove(sid);
}
function togVis(sid){const s=S.srcs.find(x=>x.id===sid);if(s){s.visible=!s.visible;renderSources();updateE();_coSafe(co=>co.broadcastSourceUpdate(s));}}
function togLock(sid){const s=S.srcs.find(x=>x.id===sid);if(s){s.locked=!s.locked;if(s.locked&&S.selItem===sid){S.selItem=null;S.selId=null;}renderSources();msg(s.locked?'Источник заблокирован':'Источник разблокирован','info');_coSafe(co=>co.broadcastSourceUpdate(s));}}
function selSrc(sid){
  const s=S.srcs.find(x=>x.id===sid);
  if(s&&s.locked){msg('Источник заблокирован — снимите блокировку для редактирования','info');return;}
  S.selId=sid;S.selItem=sid;renderSources();
}
function addScene(src,broadcast){
  // If an item for this src already exists (e.g. applied from remote snapshot), don't duplicate.
  if(S.items.some(x=>x.sid===src.id)) return;
  const cw=S.cw,ch=S.ch;const ex=S.items.filter(x=>S.srcs.find(s=>s.id===x.sid&&s.el));
  let w,h,cx,cy;
  if(!ex.length){cx=cw/2;cy=ch/2;w=cw;h=ch;}else{w=cw*.3;h=ch*.3;cx=cw-w/2-10;cy=ch-h/2-10;}
  const it={sid:src.id,cx,cy,w,h,z:0,rot:0,flipH:false,flipV:false,crop:{l:0,t:0,r:0,b:0},cropMask:'none',frameSettings:JSON.parse(JSON.stringify(framePresets.none)),uncropW:w,uncropH:h,uncropCx:cx,uncropCy:cy,origVW:0,origVH:0,naturalAR:w/h,prevRect:null,panDx:0,panDy:0};
  S.items.push(it);
  if(src.el){const r=()=>{it.origVW=src.el.videoWidth||1920;it.origVH=src.el.videoHeight||1080;it.naturalAR=it.origVW/it.origVH;};if(src.el.readyState>=1)r();else src.el.onloadedmetadata=r;}
  if(broadcast!==false&&S.co&&!_isRemote()) S.co.queueItemUpsert(it);
}
function updateE(){D.sceneEmpty.style.display=S.items.some(x=>{const s=S.srcs.find(z=>z.id===x.sid);return s&&s.visible&&s.el;})?'none':'flex';}

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
    el.innerHTML=`<span class="source-order">${idx+1}</span>
      <div class="source-icon"><video autoplay muted playsinline></video></div>
      <div class="source-info"><div class="source-name">${esc(s.name)}</div><div class="source-type">${tl}${s.isPeer?' (друг)':''}${s.locked?' · 🔒':''}</div></div>
      <div class="source-actions">
        ${gearBtn}
        <button class="btn-icon ${s.locked?'locked':''}" data-a="lock" title="${s.locked?'Разблокировать':'Заблокировать'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${lockSvg}</svg></button>
        <button class="btn-icon ${!s.visible?'':'toggle-on'}" data-a="tog" title="${s.visible?'Скрыть':'Показать'}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ic}</svg></button>
        <button class="btn-icon" data-a="del" title="Удалить"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>
      </div>`;
    const tv=el.querySelector('.source-icon video');
    if(tv)tv.srcObject=s.stream;
    D.sourcesList.appendChild(el);
  });
}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

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

function updateLevels(){
  for(const[sid,n]of S.audioNodes){
    const d=new Uint8Array(n.analyser.frequencyBinCount);
    n.analyser.getByteFrequencyData(d);
    let sum=0;for(let i=0;i<d.length;i++)sum+=d[i];
    const avg=sum/d.length;
    const pct=Math.min(100,Math.round(avg/255*100*2.5));
    const elId=sid===S.desktopAudioId?'lv_desktop':'lv_'+sid;
    const el=document.getElementById(elId);
    if(el){
      el.style.width=pct+'%';
      el.classList.toggle('clipping',pct>=95);
    }
    const ch=el?.closest('.audio-channel');
    if(!ch)continue;
    const slider=ch.querySelector('.audio-slider');
    if(slider&&slider._dragging)continue;
    const dbEl=ch.querySelector('.audio-db');
    if(!dbEl)continue;
    const src=S.srcs.find(s=>s.id===sid);
    if(src&&src.muted){dbEl.textContent='MUTE';}
    else if(src){dbEl.textContent=_toDb(avg);}
  }
  // Single owner of the levels RAF — guard against duplicate scheduling
  S._levelsRAF=requestAnimationFrame(updateLevels);
}

function _ensureLevelsLoop(){
  if(S._levelsRAF) return;
  S._levelsRAF=requestAnimationFrame(updateLevels);
}

function _toDb(avgByte){
  if(avgByte<1) return '-60';
  const db=20*Math.log10(avgByte/255);
  return Math.round(db)+'dB';
}

function _hasFx(srcId){
  const fx=S.audioEffects.get(srcId);
  if(!fx) return false;
  return fx.noiseGate||fx.eq||fx.compressor||fx.limiter;
}

function _dbToLinear(db){return Math.pow(10,db/20);}

// ═══════════════════════════════════════════════════════════
//  AUDIO EFFECTS — per-fader noise gate, EQ, compressor, limiter
// ═══════════════════════════════════════════════════════════
function _applyFxState(srcId){
  const n=S.audioNodes.get(srcId);
  const fx=S.audioEffects.get(srcId);
  if(!n||!fx) return;
  const c=n.effectsChain;
  const ctx=S.audioCtx;
  if(!ctx) return;
  const t=ctx.currentTime;

  // Gate: send settings to AudioWorkletNode via MessagePort
  if(c.gateNode && c.gateNode.port){
    c.gateNode.port.postMessage({
      enabled: fx.noiseGate||false,
      thresh:  fx.gateThresh||-40,
      range:   fx.gateRange||-40,
      attack:  (fx.gateAttack||10)/1000,
      hold:    (fx.gateHold||100)/1000,
      release: (fx.gateRelease||150)/1000,
    });
  }

  // EQ: all 0 = flat (off)
  c.eqLow.gain.setTargetAtTime(fx.eqLow,t,0.02);
  c.eqMid.gain.setTargetAtTime(fx.eqMid,t,0.02);
  c.eqHigh.gain.setTargetAtTime(fx.eqHigh,t,0.02);

  // Compressor
  c.compressor.threshold.setTargetAtTime(fx.compressor?fx.compThresh:0,t,0.02);
  c.compressor.ratio.setTargetAtTime(fx.compressor?fx.compRatio:1,t,0.02);
  c.compMakeup.gain.setTargetAtTime(fx.compressor?_dbToLinear(fx.compGain):1,t,0.02);

  // Limiter
  c.limiter.threshold.setTargetAtTime(fx.limiter?(fx.limThresh||-3):0,t,0.02);
  c.limiter.ratio.setTargetAtTime(fx.limiter?20:1,t,0.02);

  console.log('[FX] Applied:',JSON.stringify(fx));
}

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
  const eqOn=fx.eq||(fx.eqLow!==0||fx.eqMid!==0||fx.eqHigh!==0);
  const compOn=fx.compressor||fx.compThresh<0;
  const limOn=fx.limiter;

  modal.innerHTML=`<div class="modal glass" style="width:420px">
    <div class="modal-header"><h2>${esc(src.name)}</h2>
    <button class="btn-icon" id="btnCloseFx"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body fx-body">
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Шумоподавление</span><label class="fx-switch"><input type="checkbox" id="fxGate" ${gateOn?'checked':''}/><span class="fx-switch-label" id="gateBadge">${gateOn?'ВКЛ':'ВЫКЛ'}</span></label></div>
        <div class="fx-params">
          <div class="fx-row" style="gap:6px">
            <button class="btn fx-preset-btn${fx.gateThresh===-30&&fx.gateRange===-20?' active':''}" data-preset="light">Лёгкое</button>
            <button class="btn fx-preset-btn${fx.gateThresh===-40&&fx.gateRange===-40?' active':''}" data-preset="medium">Среднее</button>
            <button class="btn fx-preset-btn${fx.gateThresh===-50&&fx.gateRange===-60?' active':''}" data-preset="heavy">Сильное</button>
          </div>
          <div class="fx-row"><span class="fx-label">Порог</span><input type="range" class="fx-slider" id="fxGateThresh" min="-80" max="-10" value="${fx.gateThresh}" step="1"/><span class="fx-val" id="fxGateThreshVal">${fx.gateThresh}dB</span></div>
          <div class="fx-row"><span class="fx-label">Глубина</span><input type="range" class="fx-slider" id="fxGateRange" min="-80" max="-6" value="${fx.gateRange}" step="1"/><span class="fx-val" id="fxGateRangeVal">${fx.gateRange}dB</span></div>
          <div class="fx-row"><span class="fx-label">Атака</span><input type="range" class="fx-slider" id="fxGateAttack" min="1" max="100" value="${fx.gateAttack}" step="1"/><span class="fx-val" id="fxGateAttackVal">${fx.gateAttack}мс</span></div>
          <div class="fx-row"><span class="fx-label">Удерж.</span><input type="range" class="fx-slider" id="fxGateHold" min="10" max="500" value="${fx.gateHold}" step="10"/><span class="fx-val" id="fxGateHoldVal">${fx.gateHold}мс</span></div>
          <div class="fx-row"><span class="fx-label">Спад</span><input type="range" class="fx-slider" id="fxGateRelease" min="20" max="500" value="${fx.gateRelease}" step="10"/><span class="fx-val" id="fxGateReleaseVal">${fx.gateRelease}мс</span></div>
        </div>
      </div>
      <div class="fx-section">
        <div class="fx-header"><span class="fx-name">Эквалайзер</span><span class="fx-badge ${eqOn?'on':''}" id="eqBadge">${eqOn?'ВКЛ':'ВЫКЛ'}</span></div>
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
        <div class="fx-header"><span class="fx-name">Компрессор</span><label class="fx-switch"><input type="checkbox" id="fxComp" ${compOn?'checked':''}/><span class="fx-switch-label" id="compBadge">${compOn?'ВКЛ':'ВЫКЛ'}</span></label></div>
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
        <div class="fx-header"><span class="fx-name">Лимитер</span><label class="fx-switch"><input type="checkbox" id="fxLimiter" ${limOn?'checked':''}/><span class="fx-switch-label" id="limBadge">${limOn?'ВКЛ':'ВЫКЛ'}</span></label></div>
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
    document.getElementById('fxGate').checked=false;
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
    document.getElementById('gateBadge').textContent='ВЫКЛ';
    document.getElementById('gateBadge').className='fx-switch-label';
    document.getElementById('fxEqLow').value=0;
    document.getElementById('fxEqMid').value=0;
    document.getElementById('fxEqHigh').value=0;
    document.getElementById('fxEqLowVal').textContent='0dB';
    document.getElementById('fxEqMidVal').textContent='0dB';
    document.getElementById('fxEqHighVal').textContent='0dB';
    document.getElementById('eqBadge').textContent='ВЫКЛ';
    document.getElementById('eqBadge').className='fx-badge';
    document.querySelectorAll('.fx-eq-preset').forEach(b=>b.classList.remove('active'));
    document.getElementById('fxComp').checked=false;
    document.getElementById('fxCompThresh').value=0;
    document.getElementById('fxCompRatio').value=4;
    document.getElementById('fxCompGain').value=6;
    document.getElementById('fxCompThreshVal').textContent='0dB';
    document.getElementById('fxCompRatioVal').textContent='4:1';
    document.getElementById('fxCompGainVal').textContent='+6dB';
    document.getElementById('compBadge').textContent='ВЫКЛ';
    document.getElementById('compBadge').className='fx-switch-label';
    document.querySelectorAll('.fx-comp-preset').forEach(b=>b.classList.remove('active'));
    document.getElementById('fxLimiter').checked=false;
    document.getElementById('fxLimThresh').value=-3;
    document.getElementById('fxLimThreshVal').textContent='-3dB';
    document.getElementById('limBadge').textContent='ВЫКЛ';
    document.getElementById('limBadge').className='fx-switch-label';
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
    const gateOn=document.getElementById('fxGate').checked;
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
    document.getElementById('gateBadge').textContent=gateOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('gateBadge').className='fx-switch-label'+(gateOn?' on':'');

    // EQ
    const eqLowV=parseInt(document.getElementById('fxEqLow').value);
    const eqMidV=parseInt(document.getElementById('fxEqMid').value);
    const eqHighV=parseInt(document.getElementById('fxEqHigh').value);
    const eqOn=eqLowV!==0||eqMidV!==0||eqHighV!==0;
    c.eqLow.gain.setTargetAtTime(eqLowV,t,0.02);
    c.eqMid.gain.setTargetAtTime(eqMidV,t,0.02);
    c.eqHigh.gain.setTargetAtTime(eqHighV,t,0.02);
    src.fxState.eqLow=eqLowV; src.fxState.eqMid=eqMidV; src.fxState.eqHigh=eqHighV;
    src.fxState.eq=eqOn;
    document.getElementById('fxEqLowVal').textContent=(eqLowV>0?'+':'')+eqLowV+'dB';
    document.getElementById('fxEqMidVal').textContent=(eqMidV>0?'+':'')+eqMidV+'dB';
    document.getElementById('fxEqHighVal').textContent=(eqHighV>0?'+':'')+eqHighV+'dB';
    document.getElementById('eqBadge').textContent=eqOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('eqBadge').className='fx-badge'+(eqOn?' on':'');

    // Compressor
    const compOn=document.getElementById('fxComp').checked;
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
    document.getElementById('compBadge').textContent=compOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('compBadge').className='fx-switch-label'+(compOn?' on':'');

    // Limiter
    const limOn=document.getElementById('fxLimiter').checked;
    const limThreshV=parseInt(document.getElementById('fxLimThresh').value);
    c.limiter.threshold.setTargetAtTime(limOn?limThreshV:0,t,0.02);
    c.limiter.ratio.setTargetAtTime(limOn?20:1,t,0.02);
    src.fxState.limiter=limOn; src.fxState.limThresh=limThreshV;
    document.getElementById('fxLimThreshVal').textContent=limThreshV+'dB';
    document.getElementById('limBadge').textContent=limOn?'ВКЛ':'ВЫКЛ';
    document.getElementById('limBadge').className='fx-switch-label'+(limOn?' on':'');

    // Sync to audioEffects map
    S.audioEffects.set(srcId,{...src.fxState});

    // Update FX button highlight
    const hasFx=gateOn||eqOn||compOn||limOn;
    const fxBtn=document.querySelector(`[data-fxid="${srcId}"]`);
    if(fxBtn) fxBtn.classList.toggle('fx-active',hasFx);
  };

  // All checkboxes and sliders = live update
  ['fxGate','fxComp','fxLimiter'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.onchange=liveUpdate;
  });
  ['fxGateThresh','fxGateRange','fxGateAttack','fxGateHold','fxGateRelease','fxEqLow','fxEqMid','fxEqHigh','fxCompThresh','fxCompRatio','fxCompGain','fxLimThresh'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.oninput=liveUpdate;
  });

  // Preset buttons for noise suppression
  const gatePresets={
    light: {gateThresh:-30,gateRange:-20,gateAttack:20,gateHold:200,gateRelease:200},
    medium:{gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150},
    heavy: {gateThresh:-50,gateRange:-60,gateAttack:5,gateHold:50,gateRelease:100}
  };
  document.querySelectorAll('.fx-preset-btn:not(.fx-eq-preset):not(.fx-comp-preset)').forEach(btn=>{
    btn.onclick=()=>{
      const p=gatePresets[btn.dataset.preset];
      if(!p) return;
      document.getElementById('fxGate').checked=true;
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
      document.getElementById('fxComp').checked=true;
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
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Пресеты</span></div>
          <div class="fx-params" style="gap:6px">
            <div class="fx-row" style="gap:6px;flex-wrap:wrap">
              <button class="btn fx-preset-btn cam-preset" data-cp="default">По умолчанию</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="vivid">Яркий</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="warm">Тёплый</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="cool">Холодный</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="cinematic">Кинематограф</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="bw">Ч/Б</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="vintage">Винтаж</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="neonGlow">Неон</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="sunset">Закат</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="arctic">Арктика</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="film">Плёнка</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="dramatic">Драма</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="dreamy">Мечта</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="retro70s">70-е</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="noir">Нуар</button>
              <button class="btn fx-preset-btn cam-preset" data-cp="hologram">Голограмма</button>
            </div>
          </div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Яркость</span><span class="fx-val" id="camBrVal">${cs.brightness>0?'+':''}${cs.brightness}</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camBr" min="-100" max="100" value="${cs.brightness}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Контрастность</span><span class="fx-val" id="camCnVal">${cs.contrast>0?'+':''}${cs.contrast}</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camCn" min="-100" max="100" value="${cs.contrast}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Насыщенность</span><span class="fx-val" id="camSaVal">${cs.saturation>0?'+':''}${cs.saturation}</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camSa" min="-100" max="100" value="${cs.saturation}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Баланс белого</span><span class="fx-val" id="camWbVal">${cs.temperature}K</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camWb" min="3000" max="9000" value="${cs.temperature}" step="100"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Чёткость</span><span class="fx-val" id="camShVal">${cs.sharpness}</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camSh" min="0" max="100" value="${cs.sharpness}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Оттенок</span><span class="fx-val" id="camHueVal">${cs.hue||0}°</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camHue" min="-180" max="180" value="${cs.hue||0}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Сепия</span><span class="fx-val" id="camSepiaVal">${cs.sepia||0}%</span></div>
          <div class="fx-params"><div class="fx-row"><input type="range" class="fx-slider" id="camSepia" min="0" max="100" value="${cs.sepia||0}" step="1"/></div></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Автофокус</span><label class="fx-switch"><input type="checkbox" id="camAF" ${cs.autoFocus?'checked':''}/><span class="fx-switch-label" id="afBadge">${cs.autoFocus?'ВКЛ':'ВЫКЛ'}</span></label></div>
        </div>
        <div class="fx-section">
          <div class="fx-header"><span class="fx-name">Разрешение</span></div>
          <div class="fx-params"><select id="camRes" style="width:100%;padding:5px 8px;border:1px solid var(--glass-border);border-radius:var(--r-sm);background:rgba(255,255,255,.04);color:var(--text);font-size:12px">${resOpts}</select></div>
        </div>
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
      const hasCamFx=src.camSettings&&(src.camSettings.brightness!==0||src.camSettings.contrast!==0||src.camSettings.saturation!==0||(src.camSettings.temperature&&src.camSettings.temperature!==6500)||(src.camSettings.sharpness&&src.camSettings.sharpness>0)||(src.camSettings.hue&&src.camSettings.hue!==0)||(src.camSettings.sepia&&src.camSettings.sepia!==0));
      if(hasCamFx){const f=_buildCamFilterStr(src.camSettings);if(f)previewCtx.filter=f;}
      previewCtx.drawImage(v,(cw-dw)/2,(ch-dh)/2,dw,dh);
      if(hasCamFx) previewCtx.filter='none';
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
    if(hasCamFx){const f=_buildCamFilterStr(src.camSettings);if(f)previewCtx.filter=f;}

    const sx=cr.l*vw,sy=cr.t*vh;const pdx2=it.panDx||0,pdy2=it.panDy||0;const sw2=Math.max(1,vw*(1-cr.l-cr.r)),sh2=Math.max(1,vh*(1-cr.t-cr.b));if(it.cropMask==='circle'){const cs2=Math.max(dw/sw2,dh/sh2)*CIRCLE_PAN_ZOOM;const ddw=sw2*cs2,ddh=sh2*cs2;previewCtx.drawImage(v,sx-pdx2*(sw2/ddw),sy-pdy2*(sh2/ddh),sw2,sh2,-ddw/2,-ddh/2,ddw,ddh);}else{const scX2=sw2/dw,scY2=sh2/dh;previewCtx.drawImage(v,sx-pdx2*scX2,sy-pdy2*scY2,sw2,sh2,-dw/2,-dh/2,dw,dh);}
    if(hasCamFx) previewCtx.filter='none';

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
    const sx=cr.l*vw,sy=cr.t*vh;const pdx3=it.panDx||0,pdy3=it.panDy||0;const sw3=Math.max(1,vw*(1-cr.l-cr.r)),sh3=Math.max(1,vh*(1-cr.t-cr.b));if(it.cropMask==='circle'){const cs3=Math.max(dw/sw3,dh/sh3);const ddw3=sw3*cs3,ddh3=sh3*cs3;frameCtx.drawImage(v,sx-pdx3*(sw3/ddw3),sy-pdy3*(sh3/ddh3),sw3,sh3,-ddw3/2,-ddh3/2,ddw3,ddh3);}else{const scX3=sw3/dw,scY3=sh3/dh;frameCtx.drawImage(v,sx-pdx3*scX3,sy-pdy3*scY3,sw3,sh3,-dw/2,-dh/2,dw,dh);}
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
    src.camSettings.brightness=br;
    src.camSettings.contrast=cn;
    src.camSettings.saturation=sa;
    src.camSettings.temperature=wb;
    src.camSettings.sharpness=sh;
    src.camSettings.hue=hue;
    src.camSettings.sepia=sepia;
    src.camSettings.autoFocus=af;
    src.camSettings.resolution=res;
    document.getElementById('camBrVal').textContent=(br>0?'+':'')+br;
    document.getElementById('camCnVal').textContent=(cn>0?'+':'')+cn;
    document.getElementById('camSaVal').textContent=(sa>0?'+':'')+sa;
    document.getElementById('camWbVal').textContent=wb+'K';
    document.getElementById('camShVal').textContent=sh;
    document.getElementById('camHueVal').textContent=hue+'°';
    document.getElementById('camSepiaVal').textContent=sepia+'%';
    document.getElementById('afBadge').textContent=af?'ВКЛ':'ВЫКЛ';
    document.getElementById('afBadge').className='fx-switch-label'+(af?' on':'');
    document.querySelectorAll('.cam-preset').forEach(b=>b.classList.remove('active'));
    // Co-session: replicate camera settings to peers
    _coSafe(co=>co.broadcastSourceUpdate());
    // Resolution change — including "auto" (empty res) → fully reinit camera so old big buffers are released
    if(vt){
      const settings=vt.getSettings();
      if(res){
        const [w,h]=res.split('x').map(Number);
        if(w&&h&&(settings.width!==w||settings.height!==h)){
          _changeCamResolution(src,w,h);
        }
      }else{
        // Auto: reinit to release any high-res buffers
        if(settings.width&&settings.height&&settings.width>=1920){
          _changeCamResolution(src,0,0);
        }
      }
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
    default:{brightness:0,contrast:0,saturation:0,temperature:6500,sharpness:0,hue:0,sepia:0},
    vivid:{brightness:15,contrast:40,saturation:60,temperature:6000,sharpness:20,hue:0,sepia:0},
    warm:{brightness:10,contrast:15,saturation:10,temperature:4000,sharpness:5,hue:10,sepia:25},
    cool:{brightness:-5,contrast:20,saturation:-20,temperature:9000,sharpness:10,hue:-15,sepia:0},
    cinematic:{brightness:-10,contrast:45,saturation:-25,temperature:4500,sharpness:10,hue:5,sepia:15},
    bw:{brightness:5,contrast:35,saturation:-100,temperature:6500,sharpness:25,hue:0,sepia:0},
    vintage:{brightness:5,contrast:10,saturation:-30,temperature:5500,sharpness:0,hue:15,sepia:40},
    neonGlow:{brightness:20,contrast:50,saturation:80,temperature:7500,sharpness:15,hue:-30,sepia:0},
    sunset:{brightness:15,contrast:25,saturation:40,temperature:3500,sharpness:5,hue:20,sepia:35},
    arctic:{brightness:-15,contrast:30,saturation:-40,temperature:10000,sharpness:15,hue:-20,sepia:0},
    film:{brightness:-5,contrast:20,saturation:-15,temperature:5000,sharpness:0,hue:8,sepia:20},
    dramatic:{brightness:-15,contrast:60,saturation:-10,temperature:5000,sharpness:20,hue:0,sepia:10},
    dreamy:{brightness:20,contrast:-10,saturation:20,temperature:7000,sharpness:-10,hue:25,sepia:15},
    retro70s:{brightness:10,contrast:15,saturation:30,temperature:4000,sharpness:-5,hue:30,sepia:50},
    noir:{brightness:-10,contrast:55,saturation:-80,temperature:5500,sharpness:30,hue:0,sepia:20},
    hologram:{brightness:25,contrast:35,saturation:50,temperature:8000,sharpness:10,hue:90,sepia:0}
  };

  document.querySelectorAll('.cam-preset').forEach(btn=>{
    btn.onclick=()=>{
      const p=camPresets[btn.dataset.cp];
      if(!p) return;
      document.getElementById('camBr').value=p.brightness;
      document.getElementById('camCn').value=p.contrast;
      document.getElementById('camSa').value=p.saturation;
      document.getElementById('camWb').value=p.temperature;
      document.getElementById('camSh').value=p.sharpness;
      if(document.getElementById('camHue')) document.getElementById('camHue').value=p.hue||0;
      if(document.getElementById('camSepia')) document.getElementById('camSepia').value=p.sepia||0;
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
      if(mask==='circle'){const sq=Math.min(it.w,it.h);it.w=sq;it.h=sq;_enforceCircle(it);}
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
    };
  });

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
    document.getElementById('camAF').checked=true;
    document.getElementById('camRes').value='';
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
    const constraints={audio:false,video:{}};
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
function startStream(){
  if(S.streaming)return;
  const k=D.streamKey.value.trim();
  if(!k){msg('Введите ключ стрима','error');return;}
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
  S.rtmp.setFps(30);
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
async function createRoom(){try{const now=Date.now();if(now-S._lastRoomCreateAt<5000){msg('Подождите 5 секунд перед созданием новой комнаты','info');return;}S._lastRoomCreateAt=now;if(!S.wrtc)S.wrtc=new WebRTCManager();S.wrtc.setSignalingServer(D.signalingServer.value.trim()||'wss://streambro.ru/signaling');S.wrtc.setTurnConfig(D.turnServerUrl?D.turnServerUrl.value:'',D.turnServerUser?D.turnServerUser.value:'',D.turnServerPass?D.turnServerPass.value:'');setupW();D.connectError.style.display='none';D.btnCreateRoom.textContent='Подключение...';D.btnCreateRoom.disabled=true;await S.wrtc.connect();S.wrtc.createRoom();}catch(e){D.connectError.textContent='Ошибка: '+(e.message||e);D.connectError.style.display='block';D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;}}
async function joinRoom(){try{if(!S.wrtc)S.wrtc=new WebRTCManager();S.wrtc.setSignalingServer(D.signalingServer.value.trim()||'wss://streambro.ru/signaling');S.wrtc.setTurnConfig(D.turnServerUrl?D.turnServerUrl.value:'',D.turnServerUser?D.turnServerUser.value:'',D.turnServerPass?D.turnServerPass.value:'');setupW();const c=D.joinRoomCode.value.trim().toUpperCase();if(!c){D.connectError.textContent='Введите код';D.connectError.style.display='block';return;}D.connectError.style.display='none';D.btnJoinRoom.textContent='Подключение...';D.btnJoinRoom.disabled=true;await S.wrtc.connect();S.wrtc.joinRoom(c);}catch(e){D.connectError.textContent='Ошибка: '+(e.message||e);D.connectError.style.display='block';D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;}}
function setupW(){
  // ── Co-session engine — wired ONCE per page lifetime ──
  if(!S.co){
    S.co=new CoScene({log:(...a)=>{ if(window.__sbDev) console.log(...a); }});
    S.co.setHandlers({
      // Snapshot for handshake: send our own srcs (with stream stripped) + items.
      // The receiver only USES the meta + our `msid` to attach the matching ontrack media.
      getSnapshot:()=>({
        srcs:S.srcs.map(s=>({
          gid:s.id,ownerPeerId:s.ownerPeerId,type:s.type,name:s.name,
          isPeer:s.isPeer,peerId:s.peerId,
          visible:s.visible,locked:!!s.locked,vol:s.vol,muted:s.muted,
          monitor:!!s.monitor,channelMode:s.channelMode||'auto',msid:s.msid||null,
          camSettings:s.camSettings,fxState:s.fxState,
        })),
        items:S.items.map(it=>JSON.parse(JSON.stringify(it))),
        order:S.srcs.map(s=>s.id),
      }),
      applySrcAdd:(meta,pending,fromPid)=>_applyRemoteSrcAdd(meta,pending,fromPid),
      applySrcUpdate:(meta)=>_applyRemoteSrcUpdate(meta),
      applySrcRemove:(gid)=>{ const s=S.srcs.find(x=>x.id===gid); if(s) rmSrc(gid); },
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
    uRS('online','Комната: '+c);msg('Комната создана! '+c,'success');
  };
  S.wrtc.onRoomJoined=c=>{
    S.roomCode=c;
    S.myPeerId=S.wrtc.myPeerId;
    if(S.co) S.co.setMyPeerId(S.myPeerId);
    uRS('online','Подключён: '+c);msg('Подключён','success');
    D.btnJoinRoom.textContent='Подключён';D.btnJoinRoom.disabled=false;
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
    msg('Друг отключился','info');renderSources();renderMixer();updateE();
  };
  // Wire co-session data channels as soon as they appear
  S.wrtc.onDataChannel=(dc,pid)=>{ if(S.co) S.co.attachChannel(pid,dc); };
  // Wire ontrack to bind incoming MediaStreams to gids (instead of auto-creating peer items)
  S.wrtc.onPeerTrack=(event,pid)=>_onPeerTrack(event,pid);
  // Keep onRemoteStream as a fallback: when no src.add ever arrives (legacy peers), still create a default item.
  S.wrtc.onRemoteStream=(st,pid,event)=>_handleRemoteStream(st,pid,event);
  S.wrtc.onError=m=>{
    D.connectError.textContent=m;D.connectError.style.display='block';
    D.btnCreateRoom.textContent='Создать комнату';D.btnCreateRoom.disabled=false;
    D.btnJoinRoom.textContent='Подключиться';D.btnJoinRoom.disabled=false;
  };
}

// ─── Co-session: apply remote ops ──────────────────────────────────────────

function _applyRemoteSrcAdd(meta,pending,fromPid){
  // Don't recreate if we already have it (snapshot replays etc.)
  if(S.srcs.some(s=>s.id===meta.gid)) return;
  // For OUR own gid (meta.ownerPeerId === our id) — never re-create (echo guard)
  if(meta.ownerPeerId&&meta.ownerPeerId===S.myPeerId) return;
  // If incoming streams already arrived, attach them; otherwise create a "shadow" src.
  let videoStream=null,audioStream=null;
  if(pending&&Array.isArray(pending.streams)){
    for(const e of pending.streams){
      if(e.kind==='video'&&!videoStream) videoStream=e.stream;
      if(e.kind==='audio'&&!audioStream) audioStream=e.stream;
    }
  }
  // Use the original MediaStream (which carries both audio+video for screen share, or one kind for cam/mic)
  const stream= (videoStream||audioStream) || null;
  const opts={gid:meta.gid,ownerPeerId:meta.ownerPeerId,msid:meta.msid,suppressBroadcast:true};
  const t=meta.type||'camera';
  if(t==='mic'||t==='desktop'){
    // Audio-only source (e.g. friend's mic, friend's desktop audio incl. movie sound)
    addAudioSource(t,meta.name||'Звук друга',stream||new MediaStream(),true,fromPid||meta.ownerPeerId,opts);
  }else{
    addVideoSource(t,meta.name||'Камера друга',stream||new MediaStream(),true,fromPid||meta.ownerPeerId,opts);
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
  if(meta.camSettings){ s.camSettings=Object.assign(s.camSettings||{},meta.camSettings); needRender=true; }
  if(meta.fxState){ Object.assign(s.fxState||(s.fxState={}),meta.fxState); needAudio=true; }
  if(needAudio) try{ _updateGain(s); }catch(_){}
  if(needRender){ try{ renderSources(); renderMixer(); updateE(); }catch(_){} }
}

function _applyRemoteItemUpsert(remoteIt){
  const idx=S.items.findIndex(x=>x.sid===remoteIt.sid);
  if(idx>=0){
    Object.assign(S.items[idx],remoteIt);
  }else{
    // Item arrived before its src — keep it as a placeholder; it will start drawing
    // once the matching `src.el` becomes ready.
    S.items.push(Object.assign({
      cx:0,cy:0,w:1,h:1,z:0,rot:0,flipH:false,flipV:false,
      crop:{l:0,t:0,r:0,b:0},cropMask:'none',
      frameSettings:JSON.parse(JSON.stringify(framePresets.none)),
      uncropW:1,uncropH:1,uncropCx:0,uncropCy:0,
      origVW:0,origVH:0,naturalAR:1,prevRect:null,panDx:0,panDy:0,
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
  if(!stream||!S.co) return;
  const kind=event.track?event.track.kind:'';
  // If we already created a src for this MediaStream (e.g. a previous track
  // event triggered it), this is just an additional track (typical: screen
  // share with both video+audio). Keep our existing audio chain in sync.
  const existing=S.srcs.find(s=>s.msid===stream.id);
  if(existing){
    if(window.__sbDev) console.log('[CoScene] additional track for existing src',existing.id,kind);
    // For additional audio tracks we need to re-wire the audio chain so the
    // newly arrived audio actually plays / mixes.
    if(kind==='audio'){
      try{ _disconnectSource(existing.id); _connectSource(existing); _rebuildCombinedStream(); }catch(_){}
    }
    return;
  }
  // Ask CoScene if we already have meta for this msid (came via data-channel earlier)
  const r=S.co.bindIncomingStream(stream,kind,fromPid);
  if(r){
    if(window.__sbDev) console.log('[CoScene] track→src bound:',stream.id,r.srcMeta.gid);
    const pending={streams:[{stream,kind,peerId:fromPid}]};
    _applyRemoteSrcAdd(r.srcMeta,pending,r.fromPid||fromPid);
  }
  // Otherwise the track is parked in pending; src.add will pick it up
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

document.addEventListener('DOMContentLoaded',init);
})();
