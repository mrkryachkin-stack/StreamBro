// WASAPI PCM → AudioWorklet processor
// Small jitter buffer (~200ms) — low latency, but enough headroom to avoid underruns
// that cause crackling/popping. Drops stale data on overflow to prevent drift.
class WasapiProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = 2;
    // 200ms at 48kHz stereo = 19200 floats ≈ 77KB
    // Enough to absorb IPC jitter without underrun crackle,
    // small enough to keep latency imperceptible (<200ms).
    const RING_SIZE = Math.ceil(48000 * 2 * 0.2);
    this._ring = new Float32Array(RING_SIZE);
    this._ringSize = RING_SIZE;
    this._writePos = 0;
    this._readPos = 0;
    this._available = 0;

    this.port.onmessage = (e) => {
      const data = e.data;
      if (data.channels) this._channels = data.channels;
      if (data.pcm) {
        const pcm = data.pcm;
        const len = pcm.length;

        // If incoming data is larger than entire ring — keep only the newest tail
        if (len >= this._ringSize) {
          const start = len - this._ringSize;
          this._ring.set(pcm.subarray(start));
          this._writePos = len % this._ringSize;
          this._readPos = 0;
          this._available = this._ringSize;
          return;
        }

        // If adding would overflow — advance readPos to drop oldest (prevent lag)
        if (this._available + len > this._ringSize) {
          const drop = (this._available + len) - this._ringSize;
          this._readPos = (this._readPos + drop) % this._ringSize;
          this._available -= drop;
        }

        // Write pcm into ring (may wrap around)
        const firstPart = Math.min(len, this._ringSize - this._writePos);
        this._ring.set(pcm.subarray(0, firstPart), this._writePos);
        if (firstPart < len) {
          this._ring.set(pcm.subarray(firstPart), 0);
        }
        this._writePos = (this._writePos + len) % this._ringSize;
        this._available += len;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || !out.length) return true;
    const ch = this._channels;
    const needed = out[0].length;

    if (this._available >= needed * ch) {
      if (ch === 2 && out.length >= 2) {
        for (let i = 0; i < needed; i++) {
          const idx = (this._readPos + i * 2) % this._ringSize;
          out[0][i] = this._ring[idx] || 0;
          out[1][i] = this._ring[(idx + 1) % this._ringSize] || 0;
        }
      } else if (ch === 1 && out.length >= 2) {
        for (let i = 0; i < needed; i++) {
          const idx = (this._readPos + i) % this._ringSize;
          out[0][i] = this._ring[idx] || 0;
          out[1][i] = this._ring[idx] || 0;
        }
      } else if (out.length >= 1) {
        for (let i = 0; i < needed; i++) {
          const idx = (this._readPos + i * ch) % this._ringSize;
          out[0][i] = this._ring[idx] || 0;
        }
      }
      const consumed = needed * ch;
      this._readPos = (this._readPos + consumed) % this._ringSize;
      this._available -= consumed;
    } else {
      // Not enough data — silence (soft fade to avoid pops)
      for (let c = 0; c < out.length; c++) out[c].fill(0);
    }
    return true;
  }
}

registerProcessor('wasapi-processor', WasapiProcessor);
