// StreamBro — Audio Module: audio chain, FX, mixer, levels, WASAPI
// Extracted from app.js — all audio pipeline logic.
// Access via window.SBAudio
// Init: SBAudio.init(S, D, deps) — must be called before using any S-dependent method
// deps: { _gateWorkletLoaded, _rnnoiseWorkletLoaded, _newSid, _coSafe, _wireTrackEndHandlers,
//         renderMixer, updateE, msg, _scheduleSettingsSave, _coBroadcastSrcUpdateDebounced,
//         _rebuildCombinedStream (self-ref), _showFxModal }

(function(){
'use strict';

const SBAudio = {
  _S: null,
  _D: null,
  _deps: null,

  // ─── Init ───
  init(S, D, deps){ this._S = S; this._D = D; this._deps = deps; },
  get S(){ return this._S; },
  get D(){ return this._D; },

  // ─── AudioContext ───
  ensureAudioCtx(){
    const S=this._S;
    if(S.audioCtx && S.audioCtx.state!=='closed'){
      if(S.audioCtx.state==='suspended') S.audioCtx.resume();
      return;
    }
    S.audioCtx=new AudioContext({sampleRate:48000});
    S.audioDest=S.audioCtx.createMediaStreamDestination();
    S.audioNodes.clear();
    if(window.__sbDev) console.log('[Audio] AudioContext created, state='+S.audioCtx.state);
    if(typeof _p2pLog==='function') _p2pLog('[Audio] AudioContext created, state='+S.audioCtx.state);
    if(S.audioCtx.state==='suspended') S.audioCtx.resume().then(()=>{ if(window.__sbDev) console.log('[Audio] AudioContext resumed'); });
    const deps=this._deps;
    deps._gateWorkletLoaded = S.audioCtx.audioWorklet.addModule('js/noise-gate-worklet.js')
      .catch(e=>{ if(window.__sbDev) console.warn('[Audio] noise-gate-worklet load failed, will use passthrough:',e); });
    deps._rnnoiseWorkletLoaded = S.audioCtx.audioWorklet.addModule('js/rnnoise-worklet.js')
      .catch(e=>{ if(window.__sbDev) console.warn('[Audio] rnnoise-worklet load failed:',e); });
    for(const src of S.srcs){
      if(src.stream&&src.stream.getAudioTracks().length) this._connectSource(src);
    }
    this._rebuildCombinedStream();
  },

  // ─── Combined stream ───
  _rebuildCombinedStream(){
    const S=this._S, D=this._D;
    if(!S.audioCtx||!S.audioDest) return;
    let vt=[];
    if(S._canvasVideoTrack){
      if(S._canvasVideoTrack.readyState==='live') vt=[S._canvasVideoTrack];
      else S._canvasVideoTrack=null;
    }
    if(!vt.length){
      const cv=D.sceneCanvas;
      if(cv && cv.captureStream){
        const cs=cv.captureStream(S._captureFps||60);
        vt=cs.getVideoTracks();
        if(vt.length) S._canvasVideoTrack=vt[0];
      }
    }
    S.combinedStream=new MediaStream([...vt,...S.audioDest.stream.getAudioTracks()]);
    if(window.__sbDev) console.log('[Audio] Combined: '+vt.length+'v, '+S.audioDest.stream.getAudioTracks().length+'a');
    if(typeof _p2pLog==='function') _p2pLog('[Audio] Combined: '+vt.length+'v, '+S.audioDest.stream.getAudioTracks().length+'a');
    if(S.rtmp) S.rtmp.setCombinedStream(S.combinedStream);
    // P2P individual source streaming is handled in addVideoSource/addAudioSource
    // and _sendSourceStreamsToPeers(). We do NOT send combinedStream to peers anymore.
  },

  _addCombinedStreamToWebRTC(){
    // P2P: send INDIVIDUAL source streams to peers so they appear as
    // separate sources on the friend's scene (not a composited canvas).
    // We send the original MediaStream directly so msid matches src.msid
    // for CoScene binding on the receiving side.
    const S=this._S;
    if(!S.wrtc) return;
    // Remove old per-source streams
    if(S._wrtcPrevPerSource){
      for(const [,str] of S._wrtcPrevPerSource){
        if(str!==S.combinedStream) S.wrtc.removeLocalStream(str);
      }
    }
    S._wrtcPrevPerSource=new Map();
    // Send each non-peer source's original stream to all peers
    for(const src of S.srcs){
      if(src.isPeer) continue; // never re-send peer-owned streams upstream
      if(!src.stream) continue;
      const tracks=src.stream.getTracks();
      if(!tracks.length) continue;
      S._wrtcPrevPerSource.set(src.id,src.stream);
      S.wrtc.addLocalStreamToAllPeers(src.stream);
      if(window.__sbDev) console.log('[P2P] Sending source to peers:',src.name,src.type,'tracks='+tracks.length,'msid='+src.stream.id);
      if(typeof _p2pLog==='function') _p2pLog('[P2P] Sending source to peers: '+src.name+' '+src.type+' tracks='+tracks.length+' msid='+src.stream.id);
    }
  },

  // ─── Connect source with FX chain ───
  async _connectSource(src){
    const S=this._S, deps=this._deps;
    if(!S.audioCtx) return;
    if(S.audioNodes.has(src.id)){
      const n=S.audioNodes.get(src.id);
      n.gainNode.gain.value=src.muted?0:src.vol;
      n.monitorGain.gain.value=src.monitor?(src.muted?0:src.vol):0;
      if(n.peerAudioEl){
        const _pm=src.isPeer&&src.type==='mic'; const _wa=!!S.desktopAudioId;
        n.peerAudioEl.muted=!!(src.muted);
        n.peerAudioEl.volume=src.muted?0:(_pm&&_wa?Math.min(src.vol,0.5):(src.vol||1));
      }
      return;
    }
    if(!src.stream.getAudioTracks().length) return;
    if(S.audioCtx.state==='suspended') S.audioCtx.resume();

    const ctx=S.audioCtx;
    // Log audio track state for peer sources (always, for remote diagnostics)
    if(src.isPeer){
      const audioTracks=src.stream.getAudioTracks();
      const stateStr=audioTracks.map(t=>t.readyState+'/muted='+t.muted+'/en='+t.enabled).join(',');
      if(typeof _p2pLog==='function') _p2pLog('[Audio] _connectSource peer: '+src.name+' tracks='+audioTracks.length+' states='+stateStr+' monitor='+src.monitor+' vol='+src.vol);
      if(window.__sbDev) console.log('[Audio] _connectSource peer audio:',src.name,'tracks='+audioTracks.length,'states='+stateStr,'monitor='+src.monitor,'vol='+src.vol);
    }
    const rawSource=ctx.createMediaStreamSource(src.stream);
    // Diagnostic: create a test <audio> element for peer sources to verify stream has audio data
    if(src.isPeer&&window.__sbDev){
      try{
        const testAudio=document.createElement('audio');
        testAudio.srcObject=src.stream;testAudio.volume=0;testAudio.muted=true;
        testAudio.play().catch(()=>{});
        setTimeout(()=>{
          try{
            const tc=testAudio.getChannelData?.length;
            const trackCount=src.stream.getAudioTracks().length;
            const trackStates=src.stream.getAudioTracks().map(t=>t.readyState+'/'+t.muted+'/'+t.enabled).join(',');
            console.log('[Audio] Peer stream test:',src.name,'audioEl.readyState='+testAudio.readyState,'tracks='+trackCount,'trackStates='+trackStates);
          }catch(e){}
        },2000);
      }catch(e){}
    }
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
    const _stereoIfy=(n)=>{try{n.channelCount=2;n.channelCountMode='explicit';n.channelInterpretation='speakers';}catch(e){}};
    _stereoIfy(merger);
    const gainNode=ctx.createGain(); _stereoIfy(gainNode);
    gainNode.gain.value=src.muted?0:src.vol;
    const monitorGain=ctx.createGain(); _stereoIfy(monitorGain);
    monitorGain.gain.value=src.monitor?(src.muted?0:src.vol):0;
    const analyser=ctx.createAnalyser();
    analyser.fftSize=256; analyser.smoothingTimeConstant=0.3;

    const fxState=src.fxState||this._loadFxStateForName(src.name);

    // Noise gate
    let gateNode;
    try{
      if(deps._gateWorkletLoaded) await deps._gateWorkletLoaded;
      gateNode=new AudioWorkletNode(ctx,'noise-gate',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
      gateNode.port.postMessage({
        enabled: fxState.noiseGate||false,
        thresh: fxState.gateThresh||-40,
        range: fxState.gateRange||-40,
        attack: (fxState.gateAttack||10)/1000,
        hold: (fxState.gateHold||100)/1000,
        release: (fxState.gateRelease||150)/1000,
      });
    }catch(e){
      if(window.__sbDev) console.warn('[Audio] Gate worklet unavailable, using passthrough:',e);
      gateNode=ctx.createGain(); gateNode.gain.value=1;
    }

    // 3-Band EQ
    const eqLow=ctx.createBiquadFilter(); eqLow.type='lowshelf'; eqLow.frequency.value=320; eqLow.gain.value=fxState.eq?fxState.eqLow:0; _stereoIfy(eqLow);
    const eqMid=ctx.createBiquadFilter(); eqMid.type='peaking'; eqMid.frequency.value=1000; eqMid.Q.value=1.0; eqMid.gain.value=fxState.eq?fxState.eqMid:0; _stereoIfy(eqMid);
    const eqHigh=ctx.createBiquadFilter(); eqHigh.type='highshelf'; eqHigh.frequency.value=3200; eqHigh.gain.value=fxState.eq?fxState.eqHigh:0; _stereoIfy(eqHigh);

    // Compressor
    const compressor=ctx.createDynamicsCompressor();
    compressor.threshold.value=fxState.compressor?fxState.compThresh:0;
    compressor.ratio.value=fxState.compressor?fxState.compRatio:1;
    compressor.knee.value=10; compressor.attack.value=0.003; compressor.release.value=0.25;
    const compMakeup=ctx.createGain();
    compMakeup.gain.value=fxState.compressor?this._dbToLinear(fxState.compGain):1;

    // Limiter
    const limiter=ctx.createDynamicsCompressor();
    limiter.threshold.value=fxState.limiter?(fxState.limThresh||-3):0;
    limiter.ratio.value=fxState.limiter?20:1;
    limiter.knee.value=0; limiter.attack.value=0.001; limiter.release.value=0.1;

    // RNNoise
    let rnnoiseNode = null;
    if(S._rnnoiseEnabled && S._rnnoiseWasmLoaded){
      try{
        if(deps._rnnoiseWorkletLoaded) await deps._rnnoiseWorkletLoaded;
        rnnoiseNode = new AudioWorkletNode(ctx,'rnnoise-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2]});
        rnnoiseNode.port.postMessage({type:'init',wasmExports:S._rnnoiseWasm});
        rnnoiseNode.port.postMessage({type:'enable',enabled:true});
        S._rnnoiseNodes.set(src.id, rnnoiseNode);
      }catch(e){
        if(window.__sbDev) console.warn('[RNNoise] node create failed:',e);
        rnnoiseNode=null;
      }
    }

    // Chain
    sourceNode.connect(gateNode);
    if(rnnoiseNode){gateNode.connect(rnnoiseNode);rnnoiseNode.connect(eqLow);}
    else gateNode.connect(eqLow);
    eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(compressor);
    compressor.connect(compMakeup); compMakeup.connect(limiter);

    limiter.connect(gainNode); gainNode.connect(S.audioDest); gainNode.connect(analyser);
    // Monitor routing:
    // - Peer sources → <audio autoplay> element (bypasses Web Audio pipeline;
    //   createMediaStreamSource is unreliable for WebRTC remote tracks in Electron/Chrome)
    // - Local mic / other local → Web Audio monitorGain → ctx.destination
    // - Local desktop (WASAPI) → NEVER monitored (would create echo loop)
    const isLocalDesktop = !src.isPeer && src.type==='desktop';
    const isPeerMic = src.isPeer && src.type==='mic';
    const wasapiActive = !!S.desktopAudioId;
    let peerAudioEl = null;
    if(src.isPeer){
      // Direct <audio> playback for peer — most reliable cross-platform approach
      peerAudioEl = document.createElement('audio');
      peerAudioEl.srcObject = src.stream;
      peerAudioEl.autoplay = true;
      peerAudioEl.muted = !!(src.muted);
      // Reduce peer mic volume when WASAPI is active (feedback prevention)
      peerAudioEl.volume = src.muted ? 0 : (isPeerMic && wasapiActive ? Math.min(src.vol||1, 0.5) : (src.vol||1));
      // Must be in DOM for autoplay policy compliance in Electron
      peerAudioEl.style.cssText='position:absolute;width:0;height:0;opacity:0;pointer-events:none;';
      document.body.appendChild(peerAudioEl);
      peerAudioEl.play().catch(e=>{
        if(typeof _p2pLog==='function') _p2pLog('[Audio] Peer <audio>.play() failed: '+e.message);
      });
      if(typeof _p2pLog==='function') _p2pLog('[Audio] Peer audio element created: '+src.name+' vol='+peerAudioEl.volume.toFixed(2)+' muted='+peerAudioEl.muted);
    } else if(!isLocalDesktop){
      // Local mic/camera: standard Web Audio monitoring
      limiter.connect(monitorGain);
      monitorGain.connect(ctx.destination);
    } else {
      // Local desktop: no monitoring
      if(src.monitor) src.monitor=false;
    }

    S.audioNodes.set(src.id,{sourceNode,gainNode,monitorGain,analyser,
      effectsChain:{gateNode,eqLow,eqMid,eqHigh,compressor,compMakeup,limiter},rawSource,splitter,peerAudioEl});
    S.audioEffects.set(src.id,fxState);
    src.fxState=fxState;
    if(window.__sbDev) console.log('[Audio] Connected with FX chain:',src.name);
    if(typeof _p2pLog==='function') _p2pLog('[Audio] Connected with FX chain: '+src.name);

    // For peer audio: schedule a delayed check to see if audio is actually flowing
    if(src.isPeer){
      setTimeout(()=>{
        if(!S.audioNodes.has(src.id)) return;
        const an=S.audioNodes.get(src.id).analyser;
        const data=new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(data);
        const peak=Math.max(...data);
        const tracks=src.stream.getAudioTracks();
        const stateStr=tracks.map(t=>t.readyState+'/muted='+t.muted).join(',');
        if(typeof _p2pLog==='function') _p2pLog('[Audio] Level check 3s: '+src.name+' analyser_peak='+peak+' tracks='+stateStr);
        if(window.__sbDev) console.log('[Audio] Peer audio level check (3s):',src.name,'peak='+peak,stateStr);
      },3000);
    }
  },

  // ─── Disconnect source ───
  _disconnectSource(srcId){
    const S=this._S;
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
    if(n.rawSource) try{n.rawSource.disconnect();}catch(e){}
    if(n.splitter) try{n.splitter.disconnect();}catch(e){}
    if(n.peerAudioEl){
      try{n.peerAudioEl.pause();n.peerAudioEl.srcObject=null;n.peerAudioEl.remove();}catch(e){}
    }
    const rnNode=S._rnnoiseNodes.get(srcId);
    if(rnNode){try{rnNode.disconnect();}catch(e){}S._rnnoiseNodes.delete(srcId);}
    S.audioNodes.delete(srcId);
    S.audioEffects.delete(srcId);
  },

  // ─── Update gain ───
  _updateGain(src){
    const S=this._S;
    const n=S.audioNodes.get(src.id);if(!n||!S.audioCtx)return;
    const ctx=S.audioCtx;
    n.gainNode.gain.setTargetAtTime(src.muted?0:src.vol,ctx.currentTime,0.02);
    if(n.peerAudioEl){
      // Peer sources: control volume via <audio> element
      const isPeerMic=src.isPeer&&src.type==='mic';
      const wasapiActive=!!S.desktopAudioId;
      n.peerAudioEl.muted=!!(src.muted);
      n.peerAudioEl.volume=src.muted?0:(isPeerMic&&wasapiActive?Math.min(src.vol,0.5):src.vol);
    } else {
      // Local sources: control via monitorGain
      const monVol=src.monitor?(src.muted?0:src.vol):0;
      n.monitorGain.gain.setTargetAtTime(monVol,ctx.currentTime,0.02);
    }
  },

  // ─── Re-evaluate monitor routing when WASAPI state changes ───
  _updatePeerMonitorRouting(){
    const S=this._S;
    if(!S.audioCtx) return;
    const wasapiActive=!!S.desktopAudioId;
    for(const src of S.srcs){
      if(!src.isPeer) continue;
      const n=S.audioNodes.get(src.id);
      if(!n) continue;
      const isPeerMic=src.type==='mic';
      const vol=src.muted?0:(isPeerMic&&wasapiActive?Math.min(src.vol,0.5):src.vol);
      if(n.peerAudioEl){
        // Peer sources use <audio> element — update its volume directly
        n.peerAudioEl.muted=!!(src.muted);
        n.peerAudioEl.volume=vol;
      } else {
        n.monitorGain.gain.setTargetAtTime(vol,S.audioCtx.currentTime,0.02);
      }
      src.monitor=true;
      if(window.__sbDev) console.log('[Audio] Peer monitor routing:',src.name,'vol='+vol.toFixed(2),'wasapi='+wasapiActive);
      if(typeof _p2pLog==='function') _p2pLog('[Audio] Peer monitor routing: '+src.name+' vol='+vol.toFixed(2)+' wasapi='+wasapiActive);
    }
  },

  _resumeAudioCtx(){
    const S=this._S;
    if(S.audioCtx&&S.audioCtx.state==='suspended') S.audioCtx.resume();
  },

  // ─── Apply FX state to audio nodes ───
  _applyFxState(srcId){
    const S=this._S;
    const n=S.audioNodes.get(srcId);
    const fx=S.audioEffects.get(srcId);
    if(!n||!fx) return;
    const c=n.effectsChain;
    const ctx=S.audioCtx; if(!ctx) return;
    const t=ctx.currentTime;

    if(c.gateNode && c.gateNode.port){
      c.gateNode.port.postMessage({
        enabled: fx.noiseGate||false,
        thresh: fx.gateThresh||-40,
        range: fx.gateRange||-40,
        attack: (fx.gateAttack||10)/1000,
        hold: (fx.gateHold||100)/1000,
        release: (fx.gateRelease||150)/1000,
      });
    }
    c.eqLow.gain.setTargetAtTime(fx.eq?fx.eqLow:0,t,0.02);
    c.eqMid.gain.setTargetAtTime(fx.eq?fx.eqMid:0,t,0.02);
    c.eqHigh.gain.setTargetAtTime(fx.eq?fx.eqHigh:0,t,0.02);
    c.compressor.threshold.setTargetAtTime(fx.compressor?fx.compThresh:0,t,0.02);
    c.compressor.ratio.setTargetAtTime(fx.compressor?fx.compRatio:1,t,0.02);
    c.compMakeup.gain.setTargetAtTime(fx.compressor?this._dbToLinear(fx.compGain):1,t,0.02);
    c.limiter.threshold.setTargetAtTime(fx.limiter?(fx.limThresh||-3):0,t,0.02);
    c.limiter.ratio.setTargetAtTime(fx.limiter?20:1,t,0.02);
    if(window.__sbDev) console.log('[FX] Applied:',JSON.stringify(fx));
  },

  // ─── FX helpers ───
  _loadFxStateForName(name){
    const S=this._S;
    const def={noiseGate:false,eq:false,compressor:false,limiter:false,eqLow:0,eqMid:0,eqHigh:0,compThresh:-24,compRatio:4,compGain:6,gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150,limThresh:-3};
    if(S.settings&&S.settings.fxStateByName&&S.settings.fxStateByName[name]){
      return Object.assign({},def,S.settings.fxStateByName[name]);
    }
    return def;
  },
  _hasFx(srcId){
    const fx=this._S.audioEffects.get(srcId);
    if(!fx) return false;
    return fx.noiseGate||fx.eq||fx.compressor||fx.limiter;
  },
  _dbToLinear(db){return Math.pow(10,db/20);},
  _toDb(avgByte){
    if(avgByte<1) return '-60';
    const db=20*Math.log10(avgByte/255);
    return Math.round(db)+'dB';
  },

  // ─── Mute/Unmute app sounds ───
  _muteAppSounds(){
    const S=this._S;
    if(S._soundsMutedByStream) return;
    S._soundsMutedByStream=true;
    if(window.SBSounds) SBSounds.setEnabled(false);
  },
  _unmuteAppSounds(){
    const S=this._S;
    if(!S.streaming && !(S.rtmp&&S.rtmp._recording)){
      S._soundsMutedByStream=false;
      if(window.SBSounds && S.settings && S.settings.sound && S.settings.sound.enabled!==false){
        SBSounds.setEnabled(true);
      }
    }
  },

  // ─── Mixer ───
  updateLevels(){
    const S=this._S;
    const mixerVisible=this._D.audioMixer&&this._D.audioMixer.offsetParent!==null;
    for(const[sid,n]of S.audioNodes){
      if(!n._levelBuf) n._levelBuf=new Uint8Array(n.analyser.frequencyBinCount);
      const d=n._levelBuf;
      n.analyser.getByteFrequencyData(d);
      let sum=0;for(let i=0;i<d.length;i++)sum+=d[i];
      const avg=sum/d.length;
      const pct=Math.min(100,Math.round(avg/255*100*2.5));
      const elId=sid===S.desktopAudioId?'lv_desktop':'lv_'+sid;
      const el=document.getElementById(elId);
      if(el){el.style.width=pct+'%';el.classList.toggle('clipping',pct>=95);}
      if(!mixerVisible) continue;
      const ch=el?.closest('.audio-channel');if(!ch)continue;
      const slider=ch.querySelector('.audio-slider');if(slider&&slider._dragging)continue;
      const dbEl=ch.querySelector('.audio-db');if(!dbEl)continue;
      const src=S.srcs.find(s=>s.id===sid);
      if(src&&src.muted){dbEl.textContent='MUTE';}
      else if(src){dbEl.textContent=this._toDb(avg);}
    }
    S._levelsRAF=requestAnimationFrame(()=>this.updateLevels());
  },

  _ensureLevelsLoop(){
    const S=this._S;
    if(S._levelsRAF) return;
    S._levelsRAF=requestAnimationFrame(()=>this.updateLevels());
  },
};

window.SBAudio = SBAudio;
})();
