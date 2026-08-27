class AudioEncoderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const dataL = input[0];
    const dataR = input.length > 1 ? input[1] : dataL;
    this.port.postMessage({ left: dataL, right: dataR });
    return true;
  }
}

registerProcessor('audio-encoder-processor', AudioEncoderProcessor);
