// Batch mono samples on the audio thread; no microphone audio is routed to the speakers.
class WakeCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(Math.round(sampleRate / 10));
    this.position = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const value of channel) {
        this.samples[this.position++] = Math.max(-1, Math.min(1, value));
        if (this.position === this.samples.length) {
          this.port.postMessage(this.samples, [this.samples.buffer]);
          this.samples = new Float32Array(Math.round(sampleRate / 10));
          this.position = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('kitchen-wake-capture', WakeCapture);
