class SCBitcrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bitDepth", defaultValue: 12, minValue: 2, maxValue: 16, automationRate: "k-rate" },
      { name: "reduction", defaultValue: 25, minValue: 0, maxValue: 100, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.phase = 0;
    this.held = [];
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const bitDepth = Math.max(2, Math.min(16, Math.round(parameters.bitDepth[0] ?? 12)));
    const steps = Math.pow(2, bitDepth - 1);
    const hold = Math.max(1, Math.round(1 + (parameters.reduction[0] ?? 25) / 100 * 63));
    const frames = output[0]?.length || 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const capture = this.phase === 0;
      for (let channel = 0; channel < output.length; channel += 1) {
        const source = input[channel] || input[0];
        if (capture) this.held[channel] = Math.round((source?.[frame] || 0) * steps) / steps;
        output[channel][frame] = this.held[channel] || 0;
      }
      this.phase = (this.phase + 1) % hold;
    }
    return true;
  }
}

registerProcessor("scdl-bitcrusher", SCBitcrusherProcessor);
