// RNNoise AudioWorklet Processor
// RNNoise processes 480 samples at 48kHz (10ms frames).
// WASM instance is passed via port message after module loads.

'use strict';

const FRAME_SIZE = 480;

class RNNoiseProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._enabled = false;
    this._rnnoiseModule = null;
    this._denoiseState = null;
    this._inputBuf = new Float32Array(FRAME_SIZE);
    this._inputBufIdx = 0;
    this._outputBuf = new Float32Array(FRAME_SIZE);
    this._outputBufIdx = FRAME_SIZE; // start empty → passthrough until first frame

    this.port.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'enable') {
        this._enabled = e.data.enabled;
      } else if (type === 'init') {
        this._initRNNoise(e.data.wasmExports);
      }
    };
  }

  _initRNNoise(exports) {
    try {
      this._rnnoiseModule = exports;
      if (exports && typeof exports.rnnoise_create === 'function') {
        this._denoiseState = exports.rnnoise_create();
        this.port.postMessage({ type: 'ready' });
      } else {
        this.port.postMessage({ type: 'error', message: 'rnnoise_create not found in WASM exports' });
      }
    } catch (e) {
      this.port.postMessage({ type: 'error', message: e.message });
    }
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) return true;

    if (!this._enabled || !this._rnnoiseModule || !this._denoiseState) {
      // Passthrough
      if (output && output[0]) {
        output[0].set(input[0]);
        if (output[1] && input[1]) output[1].set(input[1]);
      }
      return true;
    }

    const inputCh = input[0];
    const outputCh = output[0];
    const blockSize = inputCh.length; // typically 128

    for (let i = 0; i < blockSize; i++) {
      this._inputBuf[this._inputBufIdx++] = inputCh[i];

      if (this._inputBufIdx >= FRAME_SIZE) {
        try {
          const mod = this._rnnoiseModule;
          const inputPtr = mod.malloc(FRAME_SIZE * 4);
          const outputPtr = mod.malloc(FRAME_SIZE * 4);

          // Write input to WASM heap
          const heap = new Float32Array(mod.memory.buffer);
          heap.set(this._inputBuf, inputPtr >> 2);

          mod.rnnoise_process_frame(this._denoiseState, outputPtr, inputPtr);

          this._outputBuf.set(
            new Float32Array(mod.memory.buffer, outputPtr, FRAME_SIZE)
          );

          mod.free(inputPtr);
          mod.free(outputPtr);
        } catch (e) {
          // On WASM error — copy input as passthrough
          this._outputBuf.set(this._inputBuf);
        }
        this._inputBufIdx = 0;
        this._outputBufIdx = 0;
      }
    }

    // Fill output from processed buffer
    if (this._outputBufIdx < FRAME_SIZE && outputCh) {
      const available = Math.min(blockSize, FRAME_SIZE - this._outputBufIdx);
      outputCh.set(
        this._outputBuf.subarray(this._outputBufIdx, this._outputBufIdx + available)
      );
      this._outputBufIdx += available;
    }

    // Mirror to second channel if stereo output
    if (output[1] && outputCh) output[1].set(outputCh);

    return true;
  }
}

registerProcessor('rnnoise-processor', RNNoiseProcessor);
