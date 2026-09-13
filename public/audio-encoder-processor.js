// AudioWorklet processor for SupersmartX Studio export pipeline
// Captures stereo audio from MediaElementSource and posts Float32Array chunks to main thread
// Served from Next.js public/ → https://studio.supersmartx.com/audio-encoder-processor.js
class AudioEncoderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    // input[0] = left, input[1] = right (if stereo)
    if (input.length === 1) {
      // Mono → duplicate to stereo for mp4-muxer 2-channel AAC
      const mono = input[0];
      if (mono.length > 0) {
        this.port.postMessage({ left: mono.slice(0), right: mono.slice(0) });
      }
    } else {
      const left = input[0];
      const right = input[1];
      if (left.length > 0) {
        this.port.postMessage({ left: left.slice(0), right: right.slice(0) });
      }
    }
    return true;
  }
}
registerProcessor('audio-encoder-processor', AudioEncoderProcessor);
