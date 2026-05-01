// Sounds module smoke test — runs in Node by stubbing the browser globals
// the module uses (window, AudioContext). We don't actually verify audio
// output (no audio in CI); we verify the API surface and gracefully handles
// missing AudioContext.

'use strict';

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}

console.log('## sounds');

// Build a fake browser-ish global with a stubbed AudioContext.
const oscillators = [];
const gains = [];

class FakeNode {
  constructor() { this._connections = []; }
  connect(target) { this._connections.push(target); return target; }
  disconnect() {}
}
class FakeOscillator extends FakeNode {
  constructor() { super(); this.type = 'sine'; this.frequency = { value: 0 }; this._started = false; this._stopped = false; oscillators.push(this); }
  start() { this._started = true; }
  stop() { this._stopped = true; }
}
class FakeGain extends FakeNode {
  constructor() { super(); this.gain = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }; gains.push(this); }
}
class FakeFilter extends FakeNode {
  constructor() { super(); this.type='lowpass'; this.frequency={value:0}; this.Q={value:0}; }
}
class FakeAudioContext {
  constructor() { this.currentTime = 0; this.destination = new FakeNode(); this.state = 'running'; }
  createOscillator() { return new FakeOscillator(); }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { return new FakeFilter(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

global.window = global.window || {
  AudioContext: FakeAudioContext,
  addEventListener: () => {},
  removeEventListener: () => {},
};
global.AudioContext = FakeAudioContext;

// Load module — it attaches to window.SBSounds
require('../renderer/js/sounds.js');
const SB = global.window.SBSounds;

assert(SB && typeof SB.play === 'function', 'SBSounds.play exists');
assert(Array.isArray(SB.PRESETS) && SB.PRESETS.includes('message'), 'PRESETS includes "message"');
assert(SB.PRESETS.includes('streamError'), 'PRESETS includes "streamError"');
assert(SB.PRESETS.includes('friendOnline'), 'PRESETS includes "friendOnline"');

// init / setVolume / setEnabled don't throw
SB.init({ volume: 0.5, enabled: true });
SB.setVolume(0.7);
SB.setEnabled(true);
SB.setPerEvent({ message: 0.3 });

// Play several presets — should create oscillators and not throw
oscillators.length = 0;
SB.play('message');
assert(oscillators.length >= 2, 'message preset spawned 2+ oscillators (chord)');

const before = oscillators.length;
SB.play('streamStart');
assert(oscillators.length > before, 'streamStart spawned more oscillators');

// Per-event mute (false) is honored
oscillators.length = 0;
SB.setPerEvent({ message: false });
SB.play('message');
assert(oscillators.length === 0, 'per-event "false" mutes the sound');

// Disabled = no oscillators
SB.setPerEvent({});
SB.setEnabled(false);
oscillators.length = 0;
SB.play('success');
assert(oscillators.length === 0, 'enabled=false silences playback');

// Unknown preset is a no-op (not a throw)
SB.setEnabled(true);
let threw = false;
try { SB.play('does-not-exist'); } catch (e) { threw = true; }
assert(!threw, 'unknown preset is a no-op');

if (failed > 0) { console.error('\n## sounds: ' + failed + ' FAILED'); process.exit(1); }
console.log('\n## sounds: all tests passed');
