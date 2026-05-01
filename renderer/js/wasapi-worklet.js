// WASAPI PCM → AudioWorklet processor
// Runs on a dedicated audio thread — no main-thread blocking!
class WasapiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(0);
    this._channels = 2;
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.channels) this._channels = data.channels;
      if (data.pcm) {
        // Append incoming Float32 PCM
        const pcm = data.pcm;
        const newBuf = new Float32Array(this._buffer.length + pcm.length);
        newBuf.set(this._buffer);
        newBuf.set(pcm, this._buffer.length);
        this._buffer = newBuf;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const ch = this._channels;
    const needed = out[0].length;

    if (this._buffer.length >= needed * ch) {
      if (ch === 2 && out.length >= 2) {
        const buf32 = this._buffer; // avoid repeated property access
        for (let i = 0; i < needed; i++) {
          out[0][i] = buf32[i * 2] || 0;
          out[1][i] = buf32[i * 2 + 1] || 0;
        }
      } else if (ch === 1 && out.length >= 2) {
        for (let i = 0; i < needed; i++) {
          out[0][i] = this._buffer[i] || 0;
          out[1][i] = this._buffer[i] || 0;
        }
      } else if (out.length >= 1) {
        for (let i = 0; i < needed; i++) {
          out[0][i] = this._buffer[i * ch] || 0;
        }
      }
      this._buffer = this._buffer.subarray(needed * ch);
    } else {
      // Not enough data — silence
      for (let c = 0; c < out.length; c++) out[c].fill(0);
    }
    return true;
  }
}

registerProcessor('wasapi-processor', WasapiProcessor);
