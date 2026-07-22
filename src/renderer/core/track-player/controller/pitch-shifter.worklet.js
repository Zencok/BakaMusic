/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const PROCESSOR_NAME = "bakamusic-pitch-shifter";
const MIN_DELAY_SAMPLES = 128;
const DELAY_RANGE_SECONDS = 0.04;
const RING_BUFFER_SECONDS = 0.25;
const PARAMETER_SMOOTHING_SECONDS = 0.02;

class BakaMusicPitchShifterProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{
            name: "semitones",
            defaultValue: 0,
            minValue: -12,
            maxValue: 12,
            automationRate: "k-rate",
        }];
    }

    constructor() {
        super();
        this.ringLength = Math.max(
            4096,
            Math.ceil(sampleRate * RING_BUFFER_SECONDS),
        );
        this.delayRange = Math.min(
            Math.ceil(sampleRate * DELAY_RANGE_SECONDS),
            this.ringLength - MIN_DELAY_SAMPLES - 2,
        );
        this.channelBuffers = [];
        this.writeIndex = 0;
        this.phase = 0;
        this.currentRatio = 1;
        this.wet = 0;
        this.smoothingFactor = 1 - Math.exp(
            -1 / (sampleRate * PARAMETER_SMOOTHING_SECONDS),
        );
    }

    ensureChannelBuffers(channelCount) {
        while (this.channelBuffers.length < channelCount) {
            this.channelBuffers.push(new Float32Array(this.ringLength));
        }
    }

    readInterpolated(buffer, position) {
        let wrappedPosition = position % this.ringLength;
        if (wrappedPosition < 0) {
            wrappedPosition += this.ringLength;
        }
        const firstIndex = Math.floor(wrappedPosition);
        const secondIndex = (firstIndex + 1) % this.ringLength;
        const fraction = wrappedPosition - firstIndex;
        return buffer[firstIndex]
            + (buffer[secondIndex] - buffer[firstIndex]) * fraction;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        if (!output?.length) {
            return true;
        }

        const frameCount = output[0].length;
        this.ensureChannelBuffers(output.length);
        const semitoneValues = parameters.semitones;

        for (let frame = 0; frame < frameCount; frame++) {
            const semitones = semitoneValues.length > 1
                ? semitoneValues[frame]
                : semitoneValues[0];
            const targetRatio = 2 ** (semitones / 12);
            const targetWet = Math.abs(semitones) < 0.001 ? 0 : 1;
            this.currentRatio += (targetRatio - this.currentRatio)
                * this.smoothingFactor;
            this.wet += (targetWet - this.wet) * this.smoothingFactor;

            const secondPhase = (this.phase + 0.5) % 1;
            const shiftUp = this.currentRatio >= 1;
            const firstDelay = MIN_DELAY_SAMPLES + this.delayRange
                * (shiftUp ? 1 - this.phase : this.phase);
            const secondDelay = MIN_DELAY_SAMPLES + this.delayRange
                * (shiftUp ? 1 - secondPhase : secondPhase);
            const firstWindow = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase);
            const secondWindow = 0.5 - 0.5 * Math.cos(2 * Math.PI * secondPhase);
            const windowSum = firstWindow + secondWindow;

            for (let channel = 0; channel < output.length; channel++) {
                const inputChannel = input?.[channel] ?? input?.[0];
                const sample = inputChannel?.[frame] ?? 0;
                const ringBuffer = this.channelBuffers[channel];
                ringBuffer[this.writeIndex] = sample;

                const firstSample = this.readInterpolated(
                    ringBuffer,
                    this.writeIndex - firstDelay,
                );
                const secondSample = this.readInterpolated(
                    ringBuffer,
                    this.writeIndex - secondDelay,
                );
                const shiftedSample = (
                    firstSample * firstWindow + secondSample * secondWindow
                ) / Math.max(windowSum, 0.0001);

                output[channel][frame] = sample * (1 - this.wet)
                    + shiftedSample * this.wet;
            }

            this.writeIndex = (this.writeIndex + 1) % this.ringLength;
            this.phase += Math.abs(1 - this.currentRatio) / this.delayRange;
            if (this.phase >= 1) {
                this.phase -= Math.floor(this.phase);
            }
        }

        return true;
    }
}

registerProcessor(PROCESSOR_NAME, BakaMusicPitchShifterProcessor);
