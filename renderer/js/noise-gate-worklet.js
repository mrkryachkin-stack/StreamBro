// AudioWorklet processor for noise gate
// Replaces deprecated ScriptProcessorNode
// Runs on the audio rendering thread — no main-thread scheduling jitter

class NoisGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Default settings (gate off = passthrough)
    this._enabled  = false;
    this._thresh   = -40;   // dB — below this the gate closes
    this._range    = -40;   // dB — attenuation when closed (negative)
    this._attack   = 0.01;  // seconds — how fast gate opens
    this._hold     = 0.10;  // seconds — how long to stay open after signal drops
    this._release  = 0.15;  // seconds — how fast gate closes

    // Internal state
    this._currentGain = 1.0;
    this._targetGain  = 1.0;
    this._gateOpen    = true;
    this._holdSamples = 0;

    // Receive settings updates from main thread
    this.port.onmessage = ({ data }) => {
      if (data.enabled  !== undefined) this._enabled  = !!data.enabled;
      if (data.thresh   !== undefined) this._thresh   = data.thresh;
      if (data.range    !== undefined) this._range    = data.range;
      if (data.attack   !== undefined) this._attack   = Math.max(0.001, data.attack);
      if (data.hold     !== undefined) this._hold     = Math.max(0,     data.hold);
      if (data.release  !== undefined) this._release  = Math.max(0.001, data.release);
    };
  }

  process(inputs, outputs) {
    const input  = inputs[0];
    const output = outputs[0];
    if (!input || !input.length || !output || !output.length) return true;

    const channels  = Math.max(input.length, output.length);
    const frameLen  = (input[0] || output[0]).length;

    if (!this._enabled) {
      // Gate off — clean passthrough, reset state
      // CRITICAL: when input is mono and output is stereo, duplicate channel 0 to all output channels
      const lastInIdx = Math.max(0, input.length - 1);
      for (let ch = 0; ch < output.length; ch++) {
        const inp = input[Math.min(ch, lastInIdx)] || new Float32Array(frameLen);
        output[ch].set(inp);
      }
      this._currentGain = 1.0;
      this._targetGain  = 1.0;
      this._gateOpen    = true;
      return true;
    }

    // ── RMS from all input channels ──────────────────────────
    let sumSq = 0, count = 0;
    for (let ch = 0; ch < input.length; ch++) {
      const samples = input[ch];
      for (let i = 0; i < samples.length; i++) { sumSq += samples[i] * samples[i]; count++; }
    }
    const rmsLin = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const rmsDb  = 20 * Math.log10(Math.max(rmsLin, 1e-10));

    // ── Gate state machine ───────────────────────────────────
    const openTarget   = 1.0;
    const closedTarget = Math.pow(10, this._range / 20);

    if (rmsDb > this._thresh) {
      this._gateOpen    = true;
      this._holdSamples = Math.round(this._hold * sampleRate);
      this._targetGain  = openTarget;
    } else if (this._gateOpen) {
      this._holdSamples -= frameLen;
      if (this._holdSamples <= 0) {
        this._gateOpen   = false;
        this._targetGain = closedTarget;
      }
    }

    // ── Smooth gain per-sample (different coeff for attack vs release) ──
    const openCoeff  = Math.exp(-1 / Math.max(this._attack  * sampleRate, 1));
    const closeCoeff = Math.exp(-1 / Math.max(this._release * sampleRate, 1));
    const coeff      = this._gateOpen ? openCoeff : closeCoeff;

    // Calculate gain envelope once, apply to all channels
    const gainEnv = new Float32Array(frameLen);
    let g = this._currentGain;
    const tgt = this._targetGain;
    for (let i = 0; i < frameLen; i++) {
      g += (tgt - g) * (1 - coeff);
      gainEnv[i] = g;
    }
    this._currentGain = g;

    // Duplicate mono input across all stereo output channels
    const lastInIdx = Math.max(0, input.length - 1);
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[Math.min(ch, lastInIdx)] || new Float32Array(frameLen);
      const out = output[ch];
      for (let i = 0; i < frameLen; i++) out[i] = inp[i] * gainEnv[i];
    }

    return true; // keep processor alive
  }
}

registerProcessor('noise-gate', NoisGateProcessor);
