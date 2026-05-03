// StreamBro — Keyboard Shortcuts Module
// Extracted from app.js for organization. All functions reference global S and
// functions defined in app.js (which loads first).
// window.SBHotkeys is exposed for initialization.

window.SBHotkeys = (() => {
  'use strict';

  // Register listeners only when app.js has NOT already set document.onkeydown.
  // app.js uses `document.onkeydown = ...` (property setter); as long as that
  // binding exists this module skips adding duplicate listeners to avoid
  // double-firing togVis/togLock/etc.  When the keyboard block is eventually
  // removed from bind() in app.js, this module automatically takes over.
  function _init() {
    if (!document.onkeydown) {
      document.addEventListener('keydown', _onKeyDown);
      document.addEventListener('keyup', _onKeyUp);
    }
  }

  function _onKeyDown(e) {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;

    if (document.querySelector('.modal-overlay[style*="flex"]')) return;

    const it = window._getSelectedItem ? window._getSelectedItem() : null;

    switch (e.key.toLowerCase()) {
      case 'delete':
      case 'backspace':
        if (window.S?.selId && window.rmSrc) { e.preventDefault(); window.rmSrc(window.S.selId); }
        break;
      case 'r':
        if (it && window._resetTransform) { e.preventDefault(); window._pushUndo?.('сброс'); window._resetTransform(it); }
        break;
      case 'h':
        if (it && window.togVis) { e.preventDefault(); window.togVis(it.sid); }
        break;
      case 'l':
        if (it && window.togLock) { e.preventDefault(); window.togLock(it.sid); }
        break;
      case 'm':
        if (!e.ctrlKey && !e.metaKey && window.S && window._updateGain) {
          e.preventDefault();
          const mics = window.S.srcs?.filter(x => x.stream && x.stream.getAudioTracks().length > 0 && x.type !== 'desktop') || [];
          if (mics.length) {
            const anyUnmuted = mics.some(x => !x.muted);
            mics.forEach(x => { x.muted = anyUnmuted; window._updateGain(x); });
            window._scheduleSettingsSave?.();
          }
        }
        break;
      case 'g':
        if (window.S) { e.preventDefault(); window.S.showGrid = !window.S.showGrid; window._scheduleSettingsSave?.(); window._markDirty?.(); }
        break;
      case 'escape':
        document.querySelectorAll('.modal-overlay').forEach(m => {
          if (m.style.display !== 'none') {
            const closeBtn = m.querySelector('.btn-icon');
            if (closeBtn) closeBtn.click();
          }
        });
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); window._undo?.(); }
        break;
      case ' ':
        if (window.S) { window.S.spacePan = true; e.preventDefault(); }
        break;
    }
  }

  function _onKeyUp(e) {
    if (e.key === 'Alt' && window.S) window.S.alt = false;
    if (e.key === ' ' && window.S) window.S.spacePan = false;
  }

  return { init: _init };
})();

// Self-initialize: hotkeys.js is loaded with defer after app.js, so app.js
// keyboard handling is already set up when this runs.
window.SBHotkeys.init();
