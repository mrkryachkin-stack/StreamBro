// StreamBro — UI Module: themes, CSS variables, modals, tooltips, overlay sync, settings debounce
// Extracted from app.js — pure UI utilities.
// Access via window.SBUi
// Init: SBUi.init(S, D) — must be called before using any S/D-dependent method

(function(){
'use strict';

const SBUi = {
  _S: null,
  _D: null,

  init(S, D){ this._S = S; this._D = D; },
  get S(){ return this._S; },
  get D(){ return this._D; },

  // ─── HTML escape ───
  esc(s){
    const d=document.createElement('div');d.textContent=s;return d.innerHTML;
  },

  // ─── Theme ───
  applyTheme(){
    const S=this._S;
    const theme=(S.settings&&S.settings.ui&&S.settings.ui.theme)||'dark';
    let resolved=theme;
    if(theme==='system'){
      resolved=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches)?'light':'dark';
    }
    document.documentElement.setAttribute('data-theme',resolved);
    try{localStorage.setItem('sb_theme',theme);}catch(e){}
    document.documentElement.classList.toggle('reduced-motion',!!S.reducedMotion);
    S._cachedAccent=null;S._cachedHandleStroke=null;
  },

  readVar(name){
    try{
      const v=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v||null;
    }catch(e){return null;}
  },

  themeAccentCache(){
    const S=this._S;
    if(!S._cachedAccent) S._cachedAccent=this.readVar('--accent')||'#ffd23c';
    return S._cachedAccent;
  },

  themeHandleStrokeCache(){
    const S=this._S;
    if(!S._cachedHandleStroke) S._cachedHandleStroke=this.readVar('--handle-stroke')||'#1a1a2e';
    return S._cachedHandleStroke;
  },

  // ─── Modal show/hide ───
  showM(n, opts){
    const D=this._D, S=this._S;
    opts=opts||{};
    if(n==='connect'){D.connectModal.style.display='flex';}
    if(n==='addSource'){D.addSourceModal.style.display='flex';D.deviceSelector.style.display='none';opts.curType=null;}
    if(n==='addMic'){D.addMicModal.style.display='flex';if(opts.loadMicList)opts.loadMicList();}
    if(n==='rename')D.renameModal.style.display='flex';
    if(n==='settings'&&D.settingsModal){if(opts.populateSettings)opts.populateSettings();D.settingsModal.style.display='flex';}
    if(n==='help'&&D.helpModal){D.helpModal.style.display='flex';}
  },

  hideM(n){
    const D=this._D;
    if(n==='connect')D.connectModal.style.display='none';
    if(n==='addSource')D.addSourceModal.style.display='none';
    if(n==='addMic')D.addMicModal.style.display='none';
    if(n==='rename')D.renameModal.style.display='none';
    if(n==='settings'&&D.settingsModal)D.settingsModal.style.display='none';
    if(n==='help'&&D.helpModal)D.helpModal.style.display='none';
  },

  // ─── Overlay sync (sceneCanvas ↔ sceneOverlay positioning) ───
  syncOverlaySize(){
    const D=this._D;
    const cv=D.sceneCanvas, ov=D.sceneOverlay;
    if(!cv||!ov) return;
    const r=cv.getBoundingClientRect();
    const parentR=cv.parentElement.getBoundingClientRect();
    const w=Math.round(r.width), h=Math.round(r.height);
    const left=Math.round(r.left-parentR.left), top=Math.round(r.top-parentR.top);
    if(ov._syncW!==w||ov._syncH!==h||ov._syncL!==left||ov._syncT!==top){
      ov.style.width=w+'px';ov.style.height=h+'px';
      ov.style.left=left+'px';ov.style.top=top+'px';
      ov._syncW=w;ov._syncH=h;ov._syncL=left;ov._syncT=top;
    }
  },

  // ─── Hint tooltips (floating div on body level, not clipped by any parent) ───
  initHints(){
    const bubble=document.createElement('div');
    bubble.id='hintBubble';
    document.body.appendChild(bubble);
    document.addEventListener('mouseover',(e)=>{
      const el=e.target.closest('.hint-toggle');
      if(!el) return;
      bubble.textContent=el.dataset.hint||'';
      const r=el.getBoundingClientRect();
      let left=r.left+r.width/2-110;
      let top=r.top-8;
      left=Math.max(4,Math.min(left,window.innerWidth-228));
      if(top-120<0){top=r.bottom+8;bubble.style.top=top+'px';}else{bubble.style.top='';}
      bubble.style.left=left+'px';
      bubble.style.bottom=(window.innerHeight-r.top+8)+'px';
      bubble.style.top='';
      bubble.classList.add('show');
    });
    document.addEventListener('mouseout',(e)=>{
      const el=e.target.closest('.hint-toggle');
      if(el) bubble.classList.remove('show');
    });
  },

  // ─── Settings save debounce ───
  scheduleSettingsSave(persistFn){
    const S=this._S;
    if(S._settingsSaveTimer) clearTimeout(S._settingsSaveTimer);
    S._settingsSaveTimer=setTimeout(()=>{
      S._settingsSaveTimer=null;
      if(persistFn) persistFn();
    },400);
  },

  // ─── Empty scene indicator ───
  updateEmpty(){
    const S=this._S, D=this._D;
    D.sceneEmpty.style.display=S.items.some(x=>{
      const s=S.srcs.find(z=>z.id===x.sid);
      return s&&s.visible&&s.el;
    })?'none':'flex';
  },
};

window.SBUi = SBUi;
})();
