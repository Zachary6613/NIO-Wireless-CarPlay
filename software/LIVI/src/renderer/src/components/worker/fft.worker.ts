import { FFT } from './fft'

// Worker for FFT: init with parameters
const FLOOR_DB = -80
const MIN_FREQ = 20

let fftSize: number
let points: number
let sampleRate: number
let windowFunc: Float32Array
let fftInstance: FFT
let fftOutput: Float64Array
let ringBuffer = new Float32Array(0)

// reusable buffers
let input: Float32Array
let sums: Float32Array

// precomputed log-scale constants
let logMin: number
let logMax: number
let logDen: number

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'init') {
    ;({ fftSize, points, sampleRate } = msg)

    // Hanning window
    windowFunc = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      windowFunc[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (fftSize - 1))
    }

    fftInstance = new FFT(fftSize)
    fftOutput = fftInstance.createSpectrum()
    ringBuffer = new Float32Array(0)

    // reusable buffers
    input = new Float32Array(fftSize)
    sums = new Float32Array(points)

    // log scale constants
    logMin = Math.log10(MIN_FREQ)
    logMax = Math.log10(sampleRate / 2)
    logDen = logMax - logMin
  } else if (msg.type === 'pcm' && msg.buffer) {
    // Ringbuffer
    const incoming = new Float32Array(msg.buffer)
    const old = ringBuffer
    ringBuffer = new Float32Array(old.length + incoming.length)
    ringBuffer.set(old)
    ringBuffer.set(incoming, old.length)

    while (ringBuffer.length >= fftSize) {
      const segment = ringBuffer.subarray(0, fftSize)

      // apply window (reuse input buffer)
      for (let i = 0; i < fftSize; i++) {
        input[i] = segment[i] * windowFunc[i]
      }

      // FFT
      fftInstance.transform(fftOutput, input)

      // reuse sums buffer
      sums.fill(0)

      const half = fftSize / 2
      const scale = half * half

      for (let i = 1; i <= half; i++) {
        const re = fftOutput[2 * i]
        const im = fftOutput[2 * i + 1]
        const freq = (i * sampleRate) / fftSize
        if (freq < MIN_FREQ || freq > sampleRate / 2) continue
        const pos = (Math.log10(freq) - logMin) / logDen
        const idx = Math.floor(pos * points)
        if (idx >= 0 && idx < points) {
          sums[idx] += (re * re + im * im) / scale
        }
      }

      // dB normalization
      const bins = new Float32Array(points)
      for (let i = 0; i < points; i++) {
        const amp = Math.sqrt(sums[i])
        const db = Math.min(Math.max(20 * Math.log10(amp + 1e-12), FLOOR_DB), 0)
        bins[i] = (db - FLOOR_DB) / -FLOOR_DB
      }

      const buffer = [bins.buffer] as unknown as string // TODO TS workaround. Fix type properly.
      self.postMessage({ type: 'bins', bins }, buffer)

      ringBuffer = ringBuffer.subarray(fftSize >> 2)
    }
  }
}
