// StreamBro — Sources Module: source utilities, ID helpers, CoScene helpers
// Extracted from app.js — pure logic (no DOM).
// Access via window.SBSources
// Init: SBSources.init(S) — must be called before using any S-dependent method

(function(){
'use strict';

const SBSources = {
  _S: null,

  init(S){ this._S = S; },
  get S(){ return this._S; },

  // ─── Source ID ───
  newSid(){
    if(window.CoSceneHelpers&&window.CoSceneHelpers.newGid) return window.CoSceneHelpers.newGid();
    return 'g-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  },

  // ─── Source order (for CoScene src.reorder) ───
  currentSrcOrder(){ return this._S.srcs.map(s=>s.id); },

  // ─── Z-order rebuild ───
  rebuildZ(){
    const S=this._S;
    S.items.forEach(it=>{
      const idx=S.srcs.findIndex(s=>s.id===it.sid);
      if(idx>=0) it.z=S.srcs.length-idx;
    });
  },

  // ─── Source lookup helpers ───
  findSrcById(id){ return this._S.srcs.find(s=>s.id===id); },
  findItemBySid(sid){ return this._S.items.find(x=>x.sid===sid); },

  // ─── Default FX state for a new source ───
  defaultFxState(){
    return {noiseGate:false,eq:false,compressor:false,limiter:false,
      eqLow:0,eqMid:0,eqHigh:0,compThresh:-24,compRatio:4,compGain:6,
      gateThresh:-40,gateRange:-40,gateAttack:10,gateHold:100,gateRelease:150,limThresh:-3};
  },

  // ─── Default cam settings for a new video source ───
  defaultCamSettings(){
    return {brightness:0,contrast:0,saturation:0,temperature:6500,sharpness:0,denoise:0,hue:0,sepia:0,autoFocus:true,resolution:'',fps:0,flipH:false,flipV:false,digitalZoom:1.0,digitalZoomX:0,digitalZoomY:0};
  },

  // ─── Build restore data for undo on source deletion ───
  buildRestoreData(s, savedItem){
    const S=this._S;
    return {
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
      srcCamSettings:s.camSettings?{...s.camSettings}:null,
      deviceId:s.stream&&s.stream.getVideoTracks().length?s.stream.getVideoTracks()[0].getSettings().deviceId:null,
      audioDeviceId:s.stream&&s.stream.getAudioTracks().length?s.stream.getAudioTracks()[0].getSettings().deviceId:null,
      item:savedItem?{
        cx:savedItem.cx,cy:savedItem.cy,w:savedItem.w,h:savedItem.h,z:savedItem.z,
        rot:savedItem.rot,flipH:savedItem.flipH,flipV:savedItem.flipV,
        crop:{...savedItem.crop},cropMask:savedItem.cropMask,
        frameSettings:savedItem.frameSettings?JSON.parse(JSON.stringify(savedItem.frameSettings)):null,
        uncropW:savedItem.uncropW,uncropH:savedItem.uncropH,uncropCx:savedItem.uncropCx,uncropCy:savedItem.uncropCy,
        panDx:savedItem.panDx||0,panDy:savedItem.panDy||0,
      }:null,
    };
  },

  // ─── Insert source respecting locked-z ordering ───
  insertSource(src, isPeer){
    const S=this._S;
    if(!isPeer){
      const lastLockedIdx=S.srcs.findLastIndex(s=>s.locked);
      if(lastLockedIdx>=0) S.srcs.splice(lastLockedIdx+1,0,src);
      else S.srcs.unshift(src);
    }else{
      S.srcs.push(src);
    }
  },

  // ─── Toggle lock and reorder ───
  toggleLock(s){
    const S=this._S;
    s.locked=!s.locked;
    if(s.locked&&S.selItem===s.id){S.selItem=null;S.selId=null;}
    const idx=S.srcs.indexOf(s);
    if(idx>=0) S.srcs.splice(idx,1);
    if(s.locked){
      S.srcs.unshift(s);
    }else{
      const lastLocked=S.srcs.findLastIndex(x=>x.locked);
      if(lastLocked>=0) S.srcs.splice(lastLocked+1,0,s);
      else S.srcs.unshift(s);
    }
    return s.locked;
  },
};

window.SBSources = SBSources;
})();
