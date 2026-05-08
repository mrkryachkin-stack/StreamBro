// StreamBro — Scene Module: transforms, rendering, handles, undo, borders, glow
// Extracted from app.js — all functions that deal with visual scene composition.
// Access via window.SBScene
// Init: SBScene.init(S, D) — must be called before using any S-dependent method

(function(){
'use strict';

const HANDLE_R=9, HIT_R=24, ROT_OFF=34, CIRCLE_PAN_ZOOM=1.18;

const SBScene = {
  _S: null,
  _D: null,

  // ─── Constants ───
  HANDLE_R, HIT_R, ROT_OFF, CIRCLE_PAN_ZOOM,

  // ─── Init (call once from app.js after S/D are created) ───
  init(S, D){ this._S = S; this._D = D; },

  // shorthand accessors
  get S(){ return this._S; },
  get D(){ return this._D; },

  // ─── Transform math ───
  rotMat(deg){const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);return{a:c,b:s,c:-s,d:c};},
  localToWorld(it,lx,ly){const m=this.rotMat(it.rot);return{x:it.cx+m.a*lx+m.c*ly,y:it.cy+m.b*lx+m.d*ly};},
  worldToLocal(it,wx,wy){const m=this.rotMat(-it.rot);const dx=wx-it.cx,dy=wy-it.cy;return{x:m.a*dx+m.c*dy,y:m.b*dx+m.d*dy};},
  localHandles(it){const hw=it.w/2,hh=it.h/2;return[{id:'tl',x:-hw,y:-hh},{id:'tr',x:hw,y:-hh},{id:'bl',x:-hw,y:hh},{id:'br',x:hw,y:hh},{id:'tm',x:0,y:-hh},{id:'bm',x:0,y:hh},{id:'ml',x:-hw,y:0},{id:'mr',x:hw,y:0},{id:'rot',x:hw+ROT_OFF,y:0}];},
  opposite(hid,w,h){const hw=w/2,hh=h/2;const m={tl:{x:hw,y:hh},tr:{x:-hw,y:hh},bl:{x:hw,y:-hh},br:{x:-hw,y:-hh},tm:{x:0,y:hh},bm:{x:0,y:-hh},ml:{x:hw,y:0},mr:{x:-hw,y:0}};return m[hid]||{x:0,y:0};},
  hitHandle(mx,my,it){const loc=this.worldToLocal(it,mx,my);for(const h of this.localHandles(it)){if(Math.hypot(loc.x-h.x,loc.y-h.y)<HIT_R)return h.id;}return null;},
  hitItem(mx,my,it){const loc=this.worldToLocal(it,mx,my);return Math.abs(loc.x)<=it.w/2+6&&Math.abs(loc.y)<=it.h/2+6;},
  cursorFor(hid){if(hid==='tl'||hid==='tr'||hid==='bl'||hid==='br')return'grab';const m={tm:'ns-resize',bm:'ns-resize',ml:'ew-resize',mr:'ew-resize',rot:'ew-resize'};return m[hid]||'default';},
  toCanvas(cv,e){const r=cv.getBoundingClientRect();return{x:(e.clientX-r.left)*(cv.width/r.width),y:(e.clientY-r.top)*(cv.height/r.height)};},

  // ─── Crop / circle helpers ───
  enforceCircle(it){const cr=it.crop||{l:0,t:0,r:0,b:0};it.uncropW=it.w/Math.max(.1,1-cr.l-cr.r);it.uncropH=it.h/Math.max(.1,1-cr.t-cr.b);const rm=this.rotMat(it.rot);it.uncropCx=it.cx-rm.a*(cr.l-cr.r)*it.uncropW/2-rm.c*(cr.t-cr.b)*it.uncropH/2;it.uncropCy=it.cy-rm.b*(cr.l-cr.r)*it.uncropW/2-rm.d*(cr.t-cr.b)*it.uncropH/2;},
  snapCircle(it){if(it.cropMask==='circle'||it.cropMask==='rect'){const s=Math.min(it.w,it.h);it.w=s;it.h=s;this.enforceCircle(it);}},

  // ─── Dirty-flag / cache ───
  markDirty(){const S=this._S;S._dirty=true;S._sortedItemsCache=null;S._srcMapCache=null;},
  getSortedItems(){const S=this._S;if(!S._sortedItemsCache)S._sortedItemsCache=[...S.items].sort((a,b)=>a.z-b.z);return S._sortedItemsCache;},
  getSrcById(id){const S=this._S;if(!S._srcMapCache){S._srcMapCache=new Map();for(const s of S.srcs)S._srcMapCache.set(s.id,s);}return S._srcMapCache.get(id);},

  // ─── Undo ───
  snapshotItems(){
    const S=this._S;
    return S.items.map(it=>({
      sid:it.sid,cx:it.cx,cy:it.cy,w:it.w,h:it.h,z:it.z,rot:it.rot,
      flipH:it.flipH,flipV:it.flipV,
      crop:it.crop?{...it.crop}:{l:0,t:0,r:0,b:0},
      cropMask:it.cropMask||'none',
      uncropW:it.uncropW,uncropH:it.uncropH,uncropCx:it.uncropCx,uncropCy:it.uncropCy,
      panDx:it.panDx||0,panDy:it.panDy||0,
      frameSettings:it.frameSettings?JSON.parse(JSON.stringify(it.frameSettings)):null,
    }));
  },
  pushUndo(label){
    const S=this._S;
    try{
      S._undoStack.push({label:label||'',snap:this.snapshotItems(),t:Date.now()});
      while(S._undoStack.length>S._undoMax)S._undoStack.shift();
    }catch(e){if(window.__sbDev)console.warn('undo push failed',e);}
  },
  undo(msgFn){
    const S=this._S;
    if(!S._undoStack.length){msgFn('Нечего отменять','info');return null;}
    const entry=S._undoStack.pop();
    if(entry.type==='delete-source'&&entry.restore){
      return {type:'delete-source',restore:entry.restore};
    }
    const map=new Map(entry.snap.map(e=>[e.sid,e]));
    for(const it of S.items){
      const e=map.get(it.sid);if(!e)continue;
      Object.assign(it,{
        cx:e.cx,cy:e.cy,w:e.w,h:e.h,z:e.z,rot:e.rot,
        flipH:e.flipH,flipV:e.flipV,
        crop:{...e.crop},cropMask:e.cropMask,
        uncropW:e.uncropW,uncropH:e.uncropH,uncropCx:e.uncropCx,uncropCy:e.uncropCy,
        panDx:e.panDx,panDy:e.panDy,
        frameSettings:e.frameSettings?JSON.parse(JSON.stringify(e.frameSettings)):it.frameSettings,
      });
    }
    if(S.co){for(const it of S.items){S.co.queueItemUpsert(it);}S.co.flushAllItems();}
    return {type:'transform',label:entry.label};
  },

  // ─── Color utilities ───
  hexToRGBA(hex,alpha){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return'rgba('+r+','+g+','+b+','+alpha+')';},
  hexToHSL(hex){
    let r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b);let h,s,l=(max+min)/2;
    if(max===min){h=s=0;}else{
      const d=max-min;s=l>0.5?d/(2-max-min):d/(max+min);
      switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}
    }return{h:h*360,s:s*100,l:l*100};
  },
  hslToHex(h,s,l){
    h/=360;s/=100;l/=100;let r,g,b;
    if(s===0){r=g=b=l;}else{
      const hue2rgb=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
      const q=l<0.5?l*(1+s):l+s-l*s;const p=2*l-q;
      r=hue2rgb(p,q,h+1/3);g=hue2rgb(p,q,h);b=hue2rgb(p,q,h-1/3);
    }
    const toHex=v=>{const hx=Math.round(Math.min(255,Math.max(0,v*255))).toString(16);return hx.length===1?'0'+hx:hx;};
    return'#'+toHex(r)+toHex(g)+toHex(b);
  },

  // ─── Rounded rect helper ───
  roundedRectPath(c,x,y,w,h,r){r=Math.min(r,w/2,h/2);c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.arcTo(x+w,y,x+w,y+r,r);c.lineTo(x+w,y+h-r);c.arcTo(x+w,y+h,x+w-r,y+h,r);c.lineTo(x+r,y+h);c.arcTo(x,y+h,x,y+h-r,r);c.lineTo(x,y+r);c.arcTo(x,y,x+r,y,r);c.closePath();},
  borderPath(c,hw,hh,w,h,isRound,isRounded,rr){
    if(isRound){c.beginPath();c.ellipse(0,0,hw,hh,0,0,Math.PI*2);}
    else if(isRounded){this.roundedRectPath(c,-hw,-hh,w,h,rr);}
    else{c.beginPath();c.rect(-hw,-hh,w,h);}
  },

  // ─── Border glow (outward) ───
  drawBorderGlowOut(c,it){
    const S=this._S;
    const fs=it.frameSettings;if(!fs)return;
    if(!fs.glow||!fs.glow.enabled||!fs.glow.outward)return;
    const hw=it.w/2,hh=it.h/2;
    const maskType=it.cropMask||'none';
    const isRound=maskType==='circle';
    const isRounded=maskType==='rounded';
    const rr=isRounded?Math.min(it.w,it.h)*0.15:0;
    const t=S.frameAnimTime||0;
    let color=fs.color,glowColor=fs.glow.color,thickness=fs.thickness,opacity=fs.opacity;
    const animType=S.reducedMotion?'none':(fs.animation||'none');
    const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;
    if(animType==='pulse') thickness=fs.thickness*(1+0.5*animI*Math.sin(t*3));
    else if(animType==='breathe') opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
    else if(animType==='colorShift'){const hsl=this.hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;color=this.hslToHex(hsl.h,hsl.s,hsl.l);if(fs.glow.color===fs.color)glowColor=color;}
    else if(animType==='rainbow'){const h2=this.hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;color=this.hslToHex(h2.h,90,55);glowColor=color;}
    thickness=Math.max(1,thickness);opacity=Math.max(0,Math.min(1,opacity));
    const glowSize=Math.max(2,fs.glow.size||15);
    let reach=glowSize*1.6;
    const isPreview=it._isPreview||(Math.abs(it.cx||0)<1&&Math.abs(it.cy||0)<1);
    if(!isPreview){
      const sceneMaxX=Math.max(20,Math.min(it.cx,Math.max(20,(S.cw||1920)-it.cx))-Math.max(hw,hh));
      const sceneMaxY=Math.max(20,Math.min(it.cy,Math.max(20,(S.ch||1080)-it.cy))-Math.max(hw,hh));
      const sceneRoom=Math.max(20,Math.min(sceneMaxX,sceneMaxY));
      reach=Math.min(reach,sceneRoom);
    }
    const SB=this;
    function strokeShape(){
      if(isRound){c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.stroke();}
      else if(isRounded){SB.roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
      else c.strokeRect(-hw,-hh,it.w,it.h);
    }
    if(isRound){
      c.save();
      const baseR=Math.min(hw,hh);const innerR=baseR*0.985;const outerR=baseR+reach*1.10;
      const grd=c.createRadialGradient(0,0,innerR,0,0,outerR);
      grd.addColorStop(0.00,this.hexToRGBA(glowColor,opacity*0.55));
      grd.addColorStop(0.10,this.hexToRGBA(glowColor,opacity*0.38));
      grd.addColorStop(0.28,this.hexToRGBA(glowColor,opacity*0.20));
      grd.addColorStop(0.55,this.hexToRGBA(glowColor,opacity*0.08));
      grd.addColorStop(0.82,this.hexToRGBA(glowColor,opacity*0.025));
      grd.addColorStop(1.00,this.hexToRGBA(glowColor,0));
      c.fillStyle=grd;const M=Math.max(hw,hh),pad=reach*1.2+thickness*2+40;
      c.fillRect(-M-pad,-M-pad,(M+pad)*2,(M+pad)*2);
      c.globalCompositeOperation='destination-out';
      c.beginPath();c.arc(0,0,baseR,0,Math.PI*2);c.fill();
      c.restore();
    }else{
      const baseW=Math.max(thickness*1.0,reach*0.08);
      const passes=S.reducedMotion?[
        {blur:reach*0.35,lw:baseW+reach*0.40,alpha:0.18},
        {blur:reach*0.08,lw:baseW+reach*0.08,alpha:0.35},
      ]:[
        {blur:reach*1.05,lw:baseW+reach*1.30,alpha:0.04},
        {blur:reach*0.80,lw:baseW+reach*0.95,alpha:0.07},
        {blur:reach*0.55,lw:baseW+reach*0.65,alpha:0.11},
        {blur:reach*0.35,lw:baseW+reach*0.40,alpha:0.16},
        {blur:reach*0.18,lw:baseW+reach*0.20,alpha:0.22},
        {blur:reach*0.06,lw:baseW+reach*0.06,alpha:0.30},
      ];
      for(const p of passes){
        c.save();c.filter='blur('+Math.max(0,p.blur).toFixed(1)+'px)';
        c.strokeStyle=glowColor;c.lineWidth=Math.max(1,p.lw);
        c.globalAlpha=opacity*p.alpha;c.lineJoin='round';c.lineCap='round';
        strokeShape();c.filter='none';c.restore();
      }
      c.save();c.globalCompositeOperation='destination-out';c.fillStyle='#000';
      if(isRounded){this.roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.fill();}
      else c.fillRect(-hw,-hh,it.w,it.h);
      c.restore();
    }
  },

  // ─── Border (stroke + inward glow + vignette) ───
  drawBorder(c,it){
    const S=this._S;
    const fs=it.frameSettings;
    const hw=it.w/2,hh=it.h/2;
    const maskType=it.cropMask||'none';
    const isRound=maskType==='circle';
    const isRounded=maskType==='rounded';
    const rr=isRounded?Math.min(it.w,it.h)*0.15:0;
    const t=S.frameAnimTime||0;
    const SB=this;
    function strokeOutline(){
      if(isRound){c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.stroke();}
      else if(isRounded){SB.roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
      else c.strokeRect(-hw,-hh,it.w,it.h);
    }
    // Vignette
    if(fs&&fs.vignette&&fs.vignette.enabled){
      c.save();c.globalAlpha=fs.vignette.strength;
      const vSize=fs.vignette.size/100;
      const innerR=Math.max(0,Math.min(hw,hh)*(1-vSize)),outerR=Math.max(1,Math.min(hw,hh));
      if(outerR>innerR){
      const grd=c.createRadialGradient(0,0,innerR,0,0,outerR);
      grd.addColorStop(0,'rgba(0,0,0,0)');
      const vc=SB.hexToRGBA(fs.vignetteColor||'#000000',0.95);
      grd.addColorStop(1,vc);
      c.fillStyle=grd;SB.borderPath(c,hw,hh,it.w,it.h,isRound,isRounded,rr);c.fill();}
      c.restore();
    }
    if(!fs||!fs.enabled)return;
    let thickness=fs.thickness,opacity=fs.opacity,color=fs.color;
    let animType=S.reducedMotion?'none':(fs.animation||'none');
    let glowColor=fs.glow?fs.glow.color:color;
    let glowSize=fs.glow?fs.glow.size:0;
    const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;
    if(animType==='pulse') thickness=fs.thickness*(1+0.5*animI*Math.sin(t*3));
    else if(animType==='breathe') opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
    else if(animType==='colorShift'){const hsl=SB.hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;color=SB.hslToHex(hsl.h,hsl.s,hsl.l);if(fs.glow&&fs.glow.enabled&&fs.glow.color===fs.color)glowColor=color;}
    else if(animType==='rainbow'){const h2=SB.hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;color=SB.hslToHex(h2.h,90,55);glowColor=color;}
    else if(animType==='shimmer'){opacity=fs.opacity*(0.55+0.45*animI*Math.sin(t*8));glowSize=glowSize*(1+0.6*animI*Math.sin(t*6));}
    else if(animType==='flow'){const hsl=SB.hexToHSL(fs.color);hsl.h=(hsl.h+Math.sin(t*1.5)*60*animI)%360;color=SB.hslToHex(hsl.h,hsl.s,hsl.l);glowColor=color;}
    thickness=Math.max(1,thickness);opacity=Math.max(0,Math.min(1,opacity));
    function strokeMask(){
      if(isRound){c.beginPath();c.ellipse(0,0,hw,hh,0,0,Math.PI*2);c.stroke();}
      else if(isRounded){SB.roundedRectPath(c,-hw,-hh,it.w,it.h,rr);c.stroke();}
      else c.strokeRect(-hw,-hh,it.w,it.h);
    }
    function pathMaskInset(ins){
      if(isRound){c.beginPath();c.ellipse(0,0,Math.max(1,hw-ins),Math.max(1,hh-ins),0,0,Math.PI*2);}
      else if(isRounded){SB.roundedRectPath(c,-hw+ins,-hh+ins,it.w-ins*2,it.h-ins*2,Math.max(0,rr-ins));}
      else{c.beginPath();c.rect(-hw+ins,-hh+ins,it.w-ins*2,it.h-ins*2);}
    }
    c.save();c.globalAlpha=opacity;
    // Inward glow
    if(fs.glow&&fs.glow.enabled&&fs.glow.inward&&glowSize>0){
      if(isRound){
        c.save();c.globalCompositeOperation='source-over';
        const innerR=Math.max(1,Math.min(hw,hh)-glowSize*1.8);
        const outerR=Math.max(innerR+1,Math.min(hw,hh)*1.02);
        const innerGrd=c.createRadialGradient(0,0,innerR,0,0,outerR);
        innerGrd.addColorStop(0.00,SB.hexToRGBA(glowColor,0));
        innerGrd.addColorStop(0.45,SB.hexToRGBA(glowColor,opacity*0.06));
        innerGrd.addColorStop(0.72,SB.hexToRGBA(glowColor,opacity*0.16));
        innerGrd.addColorStop(0.90,SB.hexToRGBA(glowColor,opacity*0.32));
        innerGrd.addColorStop(1.00,SB.hexToRGBA(glowColor,opacity*0.48));
        c.fillStyle=innerGrd;c.beginPath();c.arc(0,0,Math.min(hw,hh),0,Math.PI*2);c.fill();
        c.restore();
      }else{
        c.save();
        if(isRounded){SB.roundedRectPath(c,-hw,-hh,it.w,it.h,rr);}
        else{c.beginPath();c.rect(-hw,-hh,it.w,it.h);}
        c.clip();
        const gDist=Math.min(glowSize*1.8,Math.min(hw,hh)*0.8);
        const gAlpha=opacity*0.45;
        const gT=c.createLinearGradient(0,-hh,0,-hh+gDist);gT.addColorStop(0,SB.hexToRGBA(glowColor,gAlpha));gT.addColorStop(0.3,SB.hexToRGBA(glowColor,gAlpha*0.5));gT.addColorStop(0.7,SB.hexToRGBA(glowColor,gAlpha*0.12));gT.addColorStop(1,SB.hexToRGBA(glowColor,0));c.fillStyle=gT;c.fillRect(-hw,-hh,it.w,gDist);
        const gB=c.createLinearGradient(0,hh,0,hh-gDist);gB.addColorStop(0,SB.hexToRGBA(glowColor,gAlpha));gB.addColorStop(0.3,SB.hexToRGBA(glowColor,gAlpha*0.5));gB.addColorStop(0.7,SB.hexToRGBA(glowColor,gAlpha*0.12));gB.addColorStop(1,SB.hexToRGBA(glowColor,0));c.fillStyle=gB;c.fillRect(-hw,hh-gDist,it.w,gDist);
        const gL=c.createLinearGradient(-hw,0,-hw+gDist,0);gL.addColorStop(0,SB.hexToRGBA(glowColor,gAlpha));gL.addColorStop(0.3,SB.hexToRGBA(glowColor,gAlpha*0.5));gL.addColorStop(0.7,SB.hexToRGBA(glowColor,gAlpha*0.12));gL.addColorStop(1,SB.hexToRGBA(glowColor,0));c.fillStyle=gL;c.fillRect(-hw,-hh,gDist,it.h);
        const gR=c.createLinearGradient(hw,0,hw-gDist,0);gR.addColorStop(0,SB.hexToRGBA(glowColor,gAlpha));gR.addColorStop(0.3,SB.hexToRGBA(glowColor,gAlpha*0.5));gR.addColorStop(0.7,SB.hexToRGBA(glowColor,gAlpha*0.12));gR.addColorStop(1,SB.hexToRGBA(glowColor,0));c.fillStyle=gR;c.fillRect(hw-gDist,-hh,gDist,it.h);
        c.restore();
      }
    }
    // Border styles
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
      else if(isRounded){[{x:-hw+rr,y:-hh+rr},{x:hw-rr,y:-hh+rr},{x:hw-rr,y:hh+rr},{x:-hw+rr,y:hh+rr}].forEach(p=>{c.save();c.translate(p.x,p.y);c.rotate(Math.PI/4);c.fillRect(-dSize/2,-dSize/2,dSize,dSize);c.restore();});}
      else{[{x:-hw,y:-hh},{x:hw,y:-hh},{x:-hw,y:hh},{x:hw,y:hh}].forEach(p=>{c.save();c.translate(p.x,p.y);c.rotate(Math.PI/4);c.fillRect(-dSize/2,-dSize/2,dSize,dSize);c.restore();});}
    }
    else if(style==='gradient'){
      const g1=fs.gradientColor1||color,g2=fs.gradientColor2||SB.hslToHex((SB.hexToHSL(color).h+120)%360,SB.hexToHSL(color).s,SB.hexToHSL(color).l),g3=fs.gradientColor3||g1;
      const grad=c.createLinearGradient(-hw,-hh,hw,hh);const gOff=animType==='flow'?(t*0.3)%1:0;
      grad.addColorStop(0,g1);grad.addColorStop(Math.min(0.5,0.33+gOff*0.34),g2);grad.addColorStop(1,g3);
      c.strokeStyle=grad;c.lineWidth=thickness;c.setLineDash([]);strokeMask();
    }
    else if(style==='ridge'){c.strokeStyle=SB.hslToHex(SB.hexToHSL(color).h,SB.hexToHSL(color).s,Math.max(0,SB.hexToHSL(color).l-25));c.lineWidth=thickness;c.setLineDash([]);strokeMask();c.strokeStyle=SB.hslToHex(SB.hexToHSL(color).h,SB.hexToHSL(color).s,Math.min(100,SB.hexToHSL(color).l+25));c.lineWidth=thickness*0.35;pathMaskInset(thickness*0.35);c.stroke();}
    else if(style==='inset'){c.strokeStyle=SB.hslToHex(SB.hexToHSL(color).h,SB.hexToHSL(color).s,Math.min(100,SB.hexToHSL(color).l+20));c.lineWidth=thickness*0.5;c.setLineDash([]);strokeMask();c.strokeStyle=SB.hslToHex(SB.hexToHSL(color).h,SB.hexToHSL(color).s,Math.max(0,SB.hexToHSL(color).l-20));c.lineWidth=thickness*0.5;pathMaskInset(thickness*0.5);c.stroke();}
    else if(style==='glow'){(S.reducedMotion?[{blur:thickness,alpha:0.5},{blur:thickness*0.4,alpha:0.8}]:[{blur:thickness*3,alpha:0.1},{blur:thickness*2,alpha:0.2},{blur:thickness,alpha:0.4},{blur:thickness*0.4,alpha:0.7}]).forEach(l=>{c.save();c.shadowColor=color;c.shadowBlur=l.blur;c.strokeStyle=color;c.lineWidth=thickness*0.3;c.globalAlpha=opacity*l.alpha;strokeMask();c.shadowBlur=0;c.restore();});}
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
  },

  // ─── Main render (Canvas 2D) ───
  render(){
    const S=this._S, D=this._D;
    S.frameAnimTime=performance.now()/1000;
    const cw=S.cw,ch=S.ch;
    if(S._useGL&&S.gl&&S.gl.ready){
      this._renderGL(cw,ch);
      this.renderOverlay(cw,ch);
      if(S.streaming&&S.rtmp)D.streamUptime.textContent=S.rtmp.getUptime();
      return;
    }
    const c=S.ctx;if(!c)return;
    c.clearRect(0,0,cw,ch);
    for(const it of this.getSortedItems()){
      const src=this.getSrcById(it.sid);if(!src||!src.visible||!src.el)continue;const v=src.el;if(v.readyState<2)continue;const cr=it.crop||{l:0,t:0,r:0,b:0};
      try{
      c.save();c.translate(it.cx,it.cy);c.rotate(it.rot*Math.PI/180);c.scale(it.flipH?-1:1,it.flipV?-1:1);
      this.drawBorderGlowOut(c,it);
      const maskType=it.cropMask||'none';
      if(maskType==='circle'){const cr_=Math.min(it.w,it.h)/2;c.beginPath();c.arc(0,0,cr_,0,Math.PI*2);c.clip();}
      else if(maskType==='rounded'){const r=Math.min(it.w,it.h)*0.15;this.roundedRectPath(c,-it.w/2,-it.h/2,it.w,it.h,r);c.clip();}
      else if(maskType==='rect'){c.beginPath();c.rect(-it.w/2,-it.h/2,it.w,it.h);c.clip();}
      const cs=src.camSettings;
      // Camera-level flip (independent of item transform)
      const camFlipH=cs&&cs.flipH;const camFlipV=cs&&cs.flipV;
      if(camFlipH||camFlipV){c.save();c.scale(camFlipH?-1:1,camFlipV?-1:1);}
      // Camera FX — render to offscreen buffer (prevents SVG filter geometry distortion)
      const _hasCamFx=cs&&(cs.sharpness>0||cs.denoise>0||cs.brightness!==0||cs.contrast!==0||cs.saturation!==0||(cs.temperature&&cs.temperature!==6500)||(cs.hue&&cs.hue!==0)||(cs.sepia&&cs.sepia>0));
      const _drawSrc=_hasCamFx?this._applyCamFxOffscreen(src,v,cs):v;
      const sx=cr.l*v.videoWidth,sy=cr.t*v.videoHeight;
      const pdx=it.panDx||0,pdy=it.panDy||0;
      let sw=Math.max(1,v.videoWidth*(1-cr.l-cr.r)),sh=Math.max(1,v.videoHeight*(1-cr.t-cr.b));
      // Digital zoom (camera-level crop-zoom)
      if(cs&&cs.digitalZoom&&cs.digitalZoom>1.01){
        const dz=cs.digitalZoom,dzx=cs.digitalZoomX||0,dzy=cs.digitalZoomY||0;
        const zw=sw/dz,zh=sh/dz;
        sx=sx+(sw-zw)/2+(dzx*(sw-zw)/2);
        sy=sy+(sh-zh)/2+(dzy*(sh-zh)/2);
        sw=zw;sh=zh;
      }
      try{
        if(it.cropMask==='circle'||it.cropMask==='rect'||it.cropMask==='rounded'){
          const cs_=Math.max(it.w/sw,it.h/sh)*CIRCLE_PAN_ZOOM;
          const dw=sw*cs_,dh=sh*cs_;
          c.drawImage(_drawSrc,sx-pdx*(sw/dw),sy-pdy*(sh/dh),sw,sh,-dw/2,-dh/2,dw,dh);
        }else{
          const scX=sw/it.w,scY=sh/it.h;
          c.drawImage(_drawSrc,sx-pdx*scX,sy-pdy*scY,sw,sh,-it.w/2,-it.h/2,it.w,it.h);
        }
      }catch(e){}
      if(camFlipH||camFlipV) c.restore();
      this.drawBorder(c,it);
      c.restore();
      }catch(e){try{c.restore();}catch(e2){}}
    }
    if(S.streaming&&S.rtmp)D.streamUptime.textContent=S.rtmp.getUptime();
    // Scene transition fade overlay (state managed in app.js loop)
    if(S._sceneTransition){
      const tr=S._sceneTransition;
      if(tr.phase==='out'){
        // alpha already computed in loop(), just draw overlay
        c.save();c.globalAlpha=1-tr.alpha;c.fillStyle='#000';c.fillRect(0,0,cw,ch);c.restore();
      }else if(tr.phase==='in'){
        c.save();c.globalAlpha=1-tr.alpha;c.fillStyle='#000';c.fillRect(0,0,cw,ch);c.restore();
      }else if(tr.phase==='loading'){
        // Full black while loading
        c.save();c.fillStyle='#000';c.fillRect(0,0,cw,ch);c.restore();
      }
    }
    this.renderOverlay(cw,ch);
  },

  // ─── WebGL render ───
  _renderGL(cw,ch){
    const S=this._S;
    const gl=S.gl;if(!gl||!gl.ready)return;
    gl.beginFrame();
    for(const it of this.getSortedItems()){
      const src=this.getSrcById(it.sid);if(!src||!src.visible||!src.el)continue;
      const v=src.el;if(v.readyState<2)continue;
      const cr=it.crop||{l:0,t:0,r:0,b:0};const fs=it.frameSettings;
      if(fs&&fs.glow&&fs.glow.enabled&&fs.glow.outward){
        const glowSize=Math.max(2,fs.glow.size||15);let glowColor=fs.glow.color||fs.color||'#ffd23c';let opacity=fs.opacity||1.0;
        const animType=S.reducedMotion?'none':(fs.animation||'none');const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;const t=S.frameAnimTime||0;
        if(animType==='breathe')opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
        else if(animType==='colorShift'){const hsl=this.hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;glowColor=this.hslToHex(hsl.h,hsl.s,hsl.l);}
        else if(animType==='rainbow'){const h2=this.hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;glowColor=this.hslToHex(h2.h,90,55);}
        opacity=Math.max(0,Math.min(1,opacity));gl.drawGlowOut(it,fs,glowColor,glowSize,opacity,0);
      }
      gl.drawSource(src.id,v,it,cr);
      if(fs&&fs.glow&&fs.glow.enabled&&fs.glow.inward){
        const glowSize=Math.max(2,fs.glow.size||15);let glowColor=fs.glow.color||fs.color||'#ffd23c';let opacity=fs.opacity||1.0;
        const animType=S.reducedMotion?'none':(fs.animation||'none');const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;const t=S.frameAnimTime||0;
        if(animType==='breathe')opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
        else if(animType==='colorShift'){const hsl=this.hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;glowColor=this.hslToHex(hsl.h,hsl.s,hsl.l);}
        else if(animType==='rainbow'){const h2=this.hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;glowColor=this.hslToHex(h2.h,90,55);}
        opacity=Math.max(0,Math.min(1,opacity));gl.drawGlowOut(it,fs,glowColor,glowSize,opacity*0.8,1);
      }
      if(fs&&fs.vignette&&fs.vignette.enabled){gl.drawVignette(it,fs.vignetteColor||'#000000',fs.vignette.strength,fs.vignette.size);}
      if(fs&&fs.enabled){
        let thickness=fs.thickness,opacity=fs.opacity,color=fs.color;
        let animType=S.reducedMotion?'none':(fs.animation||'none');const animI=fs.animIntensity!==undefined?fs.animIntensity:1.0;const t=S.frameAnimTime||0;
        if(animType==='pulse')thickness=fs.thickness*(1+0.5*animI*Math.sin(t*3));
        else if(animType==='breathe')opacity=fs.opacity*(Math.max(0,1-0.7*animI)+0.7*animI*(0.5+0.5*Math.sin(t*2)));
        else if(animType==='colorShift'){const hsl=this.hexToHSL(fs.color);hsl.h=(hsl.h+t*60*animI)%360;color=this.hslToHex(hsl.h,hsl.s,hsl.l);}
        else if(animType==='rainbow'){const h2=this.hexToHSL('#ff0000');h2.h=(h2.h+t*120*animI)%360;color=this.hslToHex(h2.h,90,55);}
        thickness=Math.max(1,thickness);opacity=Math.max(0,Math.min(1,opacity));
        const style=fs.style||'solid';
        if(style==='glow'){gl.drawGlowOut(it,fs,color,thickness*3,opacity*0.5,0);}
        else{gl.drawBorderStroke(it,color,thickness,opacity,style);}
      }
    }
  },

  // ─── Camera FX: build CSS/SVG filter string ───
  _buildCamFilterStr(cs){
    if(!cs) return '';
    const f=[];
    if(cs.denoise&&cs.denoise>0){
      const bpx=cs.denoise<=33?0.4:cs.denoise<=66?0.8:1.3;
      f.push('blur('+bpx+'px)');
    }
    if(cs.sharpness&&cs.sharpness>0){
      const lvl=cs.sharpness<=33?1:cs.sharpness<=66?2:3;
      f.push('url(#sbSharp'+lvl+')');
      if(cs.sharpness>75) f.push('contrast(1.04)');
    }
    if(cs.brightness!==0) f.push('brightness('+(1+cs.brightness/100)+')');
    if(cs.contrast!==0) f.push('contrast('+(1+cs.contrast/100)+')');
    if(cs.saturation!==0) f.push('saturate('+Math.max(0,1+cs.saturation/100)+')');
    if(cs.temperature&&cs.temperature!==6500){
      const t=cs.temperature;
      if(t<6500){
        const w=Math.min(1,(6500-t)/3500);
        f.push('sepia('+(w*0.55).toFixed(3)+')');
        if(w>0.15) f.push('saturate('+(1+w*0.25).toFixed(3)+')');
      }else{
        const c2=Math.min(1,(t-6500)/3000);
        f.push('hue-rotate('+(-c2*18).toFixed(1)+'deg)');
        f.push('saturate('+(1-c2*0.12).toFixed(3)+')');
      }
    }
    if(cs.hue&&cs.hue!==0) f.push('hue-rotate('+cs.hue+'deg)');
    if(cs.sepia&&cs.sepia>0) f.push('sepia('+(cs.sepia/100).toFixed(3)+')');
    return f.join(' ');
  },

  // ─── Camera FX: offscreen buffer (isolated from scene geometry) ───
  _applyCamFxOffscreen(src, videoEl, cs){
    const vw=videoEl.videoWidth||1920, vh=videoEl.videoHeight||1080;
    const camFs=this._buildCamFilterStr(cs);
    if(!camFs) return videoEl;
    if(!src._offCv||src._offCv.width!==vw||src._offCv.height!==vh){
      src._offCv=document.createElement('canvas');src._offCv.width=vw;src._offCv.height=vh;
    }
    const oCtx=src._offCv.getContext('2d');
    oCtx.clearRect(0,0,vw,vh);
    oCtx.filter=camFs;
    oCtx.drawImage(videoEl,0,0,vw,vh);
    oCtx.filter='none';
    return src._offCv;
  },

  // ─── SVG filter injection (sharpness levels) ───
  injectSvgFilters(){
    if(document.getElementById('sbSvgFilters')) return;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.id='sbSvgFilters';
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
    svg.style.cssText='position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    svg.innerHTML='<defs>'+
      '<filter id="sbSharp1" x="0" y="0" width="100%" height="100%"><feConvolveMatrix order="3" kernelMatrix="0 -0.5 0  -0.5 3 -0.5  0 -0.5 0" preserveAlpha="true"/></filter>'+
      '<filter id="sbSharp2" x="0" y="0" width="100%" height="100%"><feConvolveMatrix order="3" kernelMatrix="0 -1 0  -1 5 -1  0 -1 0" preserveAlpha="true"/></filter>'+
      '<filter id="sbSharp3" x="0" y="0" width="100%" height="100%"><feConvolveMatrix order="3" kernelMatrix="-0.5 -1 -0.5  -1 7 -1  -0.5 -1 -0.5" preserveAlpha="true"/></filter>'+
      '</defs>';
    document.body.appendChild(svg);
  },

  // ─── Overlay (handles, grid, safe-areas) ───
  renderOverlay(cw,ch){
    const S=this._S;
    const oc=S.overlayCtx;if(!oc)return;
    oc.clearRect(0,0,cw,ch);
    oc.strokeStyle='rgba(255,210,60,.12)';oc.lineWidth=4;oc.strokeRect(2,2,cw-4,ch-4);
    if(S.showGrid){
      oc.save();oc.strokeStyle='rgba(255,210,60,.35)';oc.lineWidth=4;
      oc.shadowColor='rgba(255,210,60,.45)';oc.shadowBlur=10;oc.beginPath();
      for(let i=1;i<3;i++){oc.moveTo((cw/3)*i,0);oc.lineTo((cw/3)*i,ch);oc.moveTo(0,(ch/3)*i);oc.lineTo(cw,(ch/3)*i);}
      oc.stroke();oc.shadowBlur=0;oc.strokeStyle='rgba(255,255,255,.55)';oc.lineWidth=1.5;oc.setLineDash([10,6]);oc.beginPath();
      for(let i=1;i<3;i++){oc.moveTo((cw/3)*i,0);oc.lineTo((cw/3)*i,ch);oc.moveTo(0,(ch/3)*i);oc.lineTo(cw,(ch/3)*i);}
      oc.stroke();oc.setLineDash([]);oc.strokeStyle='rgba(255,210,60,.7)';oc.lineWidth=1.5;const cs=14;
      oc.beginPath();oc.moveTo(cw/2-cs,ch/2);oc.lineTo(cw/2+cs,ch/2);oc.moveTo(cw/2,ch/2-cs);oc.lineTo(cw/2,ch/2+cs);oc.stroke();oc.restore();
    }
    if(S.showSafeAreas){
      oc.save();oc.strokeStyle='rgba(255,210,60,.35)';oc.lineWidth=2;oc.setLineDash([8,8]);
      const o5=Math.min(cw,ch)*0.05,o10=Math.min(cw,ch)*0.10;
      oc.strokeRect(o5,o5,cw-o5*2,ch-o5*2);oc.strokeStyle='rgba(231,76,60,.35)';oc.strokeRect(o10,o10,cw-o10*2,ch-o10*2);oc.setLineDash([]);oc.restore();
    }
    for(const it of this.getSortedItems()){
      if(S.selItem!==it.sid)continue;const src=this.getSrcById(it.sid);if(!src)continue;
      oc.save();oc.translate(it.cx,it.cy);oc.rotate(it.rot*Math.PI/180);
      // Theme accent/handle stroke — read from CSS variables cached in app.js
      const accent=S._cachedAccent||'#ffd23c';
      const handleStroke=S._cachedHandleStroke||'#1a1a2e';
      const isLocked=src.locked;oc.shadowColor=accent;oc.shadowBlur=isLocked?0:8;
      oc.strokeStyle=isLocked?'#f0a030':accent;oc.lineWidth=3;oc.strokeRect(-it.w/2,-it.h/2,it.w,it.h);oc.shadowBlur=0;
      if(!isLocked){
        oc.fillStyle=accent;const hw=it.w/2,hh=it.h/2;
        for(const p of[{x:-hw,y:-hh},{x:hw,y:-hh},{x:-hw,y:hh},{x:hw,y:hh},{x:0,y:-hh},{x:0,y:hh},{x:-hw,y:0},{x:hw,y:0}]){
          oc.beginPath();oc.arc(p.x,p.y,HANDLE_R,0,Math.PI*2);oc.fill();oc.strokeStyle=handleStroke;oc.lineWidth=2;oc.stroke();
        }
        oc.beginPath();oc.moveTo(hw+4,0);oc.lineTo(hw+ROT_OFF-HANDLE_R,0);oc.strokeStyle=accent;oc.lineWidth=2;oc.stroke();
        oc.beginPath();oc.arc(hw+ROT_OFF,0,HANDLE_R+2,0,Math.PI*2);oc.fillStyle=accent;oc.fill();oc.strokeStyle=handleStroke;oc.lineWidth=2;oc.stroke();
      }else{
        const hw=it.w/2,hh=it.h/2;oc.fillStyle='rgba(240,160,48,.92)';
        oc.beginPath();oc.arc(hw-12,-hh+12,10,0,Math.PI*2);oc.fill();oc.strokeStyle='#1a1a2e';oc.lineWidth=1;oc.stroke();
        oc.fillStyle='#1a1a2e';oc.font='bold 11px Segoe UI';oc.textAlign='center';oc.textBaseline='middle';
        oc.fillText('\u{1F512}',hw-12,-hh+12);
      }
      oc.restore();
    }
  },
};

window.SBScene = SBScene;
})();
