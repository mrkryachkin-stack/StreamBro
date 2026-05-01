// StreamBro — synthesized UI sounds
// Pure Web Audio API — no asset files. Each "voice" is a short additive
// envelope (osc + gain + lowpass) so the result is soft and unintrusive.
//
// Usage:
//   SBSounds.init({ volume: 0.4 });
//   SBSounds.play('message');
//   SBSounds.play('error', { volume: 0.6 });
//   SBSounds.setVolume(0.5);
//
// Why synthesized: keeps installer small, themable (we can shift pitch on
// dark/neon themes), and avoids loading delays.

(function (global) {
  'use strict';

  const PRESETS = {
    // Soft glass tap — generic notification
    notification: {
      voices: [
        { type: 'sine', freq: 880, dur: 0.18, gain: 0.5, attack: 0.005, release: 0.18, lp: 4000 },
        { type: 'sine', freq: 1320, dur: 0.14, gain: 0.25, attack: 0.005, release: 0.14, lp: 4000, delay: 0.05 },
      ],
    },
    // Two-note chime — incoming chat message
    message: {
      voices: [
        { type: 'sine', freq: 660, dur: 0.12, gain: 0.4, attack: 0.005, release: 0.14, lp: 3500 },
        { type: 'sine', freq: 990, dur: 0.18, gain: 0.35, attack: 0.005, release: 0.22, lp: 3500, delay: 0.09 },
      ],
    },
    // Friend came online — warm rising third
    friendOnline: {
      voices: [
        { type: 'triangle', freq: 523, dur: 0.16, gain: 0.35, attack: 0.01, release: 0.2, lp: 3000 },
        { type: 'triangle', freq: 659, dur: 0.16, gain: 0.35, attack: 0.01, release: 0.2, lp: 3000, delay: 0.08 },
        { type: 'triangle', freq: 784, dur: 0.22, gain: 0.4,  attack: 0.01, release: 0.28, lp: 3000, delay: 0.16 },
      ],
    },
    // Stream started — confident pad swell
    streamStart: {
      voices: [
        { type: 'triangle', freq: 392, dur: 0.45, gain: 0.4, attack: 0.04, release: 0.4, lp: 2500 },
        { type: 'sine',     freq: 587, dur: 0.45, gain: 0.3, attack: 0.06, release: 0.4, lp: 2500 },
        { type: 'sine',     freq: 783, dur: 0.5,  gain: 0.25, attack: 0.08, release: 0.45, lp: 2500 },
      ],
    },
    // Stream stopped — soft descending fall
    streamStop: {
      voices: [
        { type: 'sine', freq: 660, dur: 0.18, gain: 0.35, attack: 0.005, release: 0.18, lp: 2200 },
        { type: 'sine', freq: 440, dur: 0.24, gain: 0.4,  attack: 0.005, release: 0.24, lp: 2200, delay: 0.1 },
      ],
    },
    // Stream error — low warm thud, never harsh
    streamError: {
      voices: [
        { type: 'sine', freq: 220, dur: 0.32, gain: 0.5, attack: 0.004, release: 0.32, lp: 900 },
        { type: 'sine', freq: 165, dur: 0.4,  gain: 0.4, attack: 0.005, release: 0.4,  lp: 900, delay: 0.05 },
      ],
    },
    // Generic error — quick muted "doot"
    error: {
      voices: [
        { type: 'sine', freq: 277, dur: 0.16, gain: 0.45, attack: 0.005, release: 0.18, lp: 1200 },
        { type: 'sine', freq: 196, dur: 0.18, gain: 0.4,  attack: 0.005, release: 0.2,  lp: 1200, delay: 0.05 },
      ],
    },
    // Success / saved
    success: {
      voices: [
        { type: 'sine', freq: 740, dur: 0.13, gain: 0.4,  attack: 0.005, release: 0.14, lp: 4000 },
        { type: 'sine', freq: 1110, dur: 0.18, gain: 0.32, attack: 0.005, release: 0.2, lp: 4000, delay: 0.07 },
      ],
    },
    // App update available
    update: {
      voices: [
        { type: 'sine',     freq: 523, dur: 0.18, gain: 0.35, attack: 0.005, release: 0.2, lp: 4000 },
        { type: 'triangle', freq: 783, dur: 0.22, gain: 0.32, attack: 0.005, release: 0.24, lp: 4000, delay: 0.1 },
        { type: 'sine',     freq: 1046, dur: 0.26, gain: 0.28, attack: 0.005, release: 0.28, lp: 4000, delay: 0.2 },
      ],
    },
  };

  let _ctx = null;
  let _masterGain = null;
  let _volume = 0.4;
  let _enabled = true;
  let _perEvent = {};

  function _ensureCtx() {
    if (_ctx) return _ctx;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      _ctx = new C({ sampleRate: 48000, latencyHint: 'interactive' });
      _masterGain = _ctx.createGain();
      _masterGain.gain.value = _volume;
      _masterGain.connect(_ctx.destination);
    } catch (e) {
      console.warn('[SBSounds] AudioContext unavailable:', e);
      return null;
    }
    return _ctx;
  }

  function init(opts) {
    opts = opts || {};
    if (typeof opts.volume === 'number') _volume = Math.max(0, Math.min(1, opts.volume));
    if (typeof opts.enabled === 'boolean') _enabled = opts.enabled;
    if (opts.perEvent && typeof opts.perEvent === 'object') _perEvent = opts.perEvent;
    // Don't create AudioContext yet — Chrome requires a user gesture.
    // It will be created on first play(). We warm it up on first user interaction
    // so the very first sound has no startup latency.
    const warm = () => {
      _ensureCtx();
      try { if (_ctx && _ctx.state === 'suspended') _ctx.resume(); } catch (e) {}
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
    };
    window.addEventListener('pointerdown', warm, { once: true });
    window.addEventListener('keydown', warm, { once: true });
  }

  function setVolume(v) {
    _volume = Math.max(0, Math.min(1, +v || 0));
    if (_masterGain) _masterGain.gain.setTargetAtTime(_volume, _ctx.currentTime, 0.02);
  }

  function setEnabled(b) { _enabled = !!b; }
  function setPerEvent(map) { _perEvent = map || {}; }

  function _playVoice(v, eventGain) {
    const ctx = _ctx;
    const start = ctx.currentTime + (v.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = v.type || 'sine';
    osc.frequency.value = v.freq;

    const gain = ctx.createGain();
    const peak = (v.gain || 0.3) * eventGain;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + (v.attack || 0.005));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + v.dur + (v.release || 0.1));

    let node = osc;
    if (v.lp) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = v.lp;
      lp.Q.value = 0.7;
      node.connect(lp);
      node = lp;
    }
    node.connect(gain);
    gain.connect(_masterGain);

    osc.start(start);
    osc.stop(start + v.dur + (v.release || 0.1) + 0.05);
  }

  function play(name, opts) {
    if (!_enabled) return;
    const preset = PRESETS[name];
    if (!preset) return;
    const ctx = _ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }

    // Per-event override: false = mute, number = volume multiplier
    const ev = _perEvent[name];
    if (ev === false) return;
    let eventGain = 1.0;
    if (typeof ev === 'number') eventGain = Math.max(0, Math.min(2, ev));
    if (opts && typeof opts.volume === 'number') eventGain = Math.max(0, Math.min(2, opts.volume));

    try {
      for (const v of preset.voices) _playVoice(v, eventGain);
    } catch (e) {
      console.warn('[SBSounds] play failed:', e);
    }
  }

  global.SBSounds = {
    init,
    play,
    setVolume,
    setEnabled,
    setPerEvent,
    PRESETS: Object.keys(PRESETS),
  };
})(window);
