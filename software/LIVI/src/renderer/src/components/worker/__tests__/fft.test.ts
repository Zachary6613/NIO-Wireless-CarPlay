import { describe, expect, it } from 'vitest'
import { FFT } from '../fft'

// Bins 0..16 of testSignal(32), captured from a known-good reference implementation.
const GOLDEN_32: ReadonlyArray<readonly [number, number]> = [
  [0.482215457, 0],
  [0.631727941, 0.870350998],
  [-3.212079027, -8.876832253],
  [-0.325194059, -0.831760596],
  [-0.373324332, -0.13726705],
  [-1.082226858, 0.809406808],
  [4.454201997, -4.403511867],
  [1.136493267, -1.085312218],
  [0.787279412, -0.667618178],
  [0.65940304, -0.47883118],
  [0.595469985, -0.361055727],
  [0.558571233, -0.275283265],
  [0.535670964, -0.206722346],
  [0.521086388, -0.148279423],
  [0.512026761, -0.095953748],
  [0.507053032, -0.047162833],
  [0.505465247, 0]
]

function testSignal(n: number): Float32Array {
  const input = new Float32Array(n)
  for (let i = 0; i < n; i++) input[i] = Math.sin(i * 0.37) * 0.6 + Math.cos(i * 1.13) * 0.4
  return input
}

function bins(fft: FFT, input: Float32Array): Float64Array {
  const out = fft.createSpectrum()
  fft.transform(out, input)
  return out
}

describe('FFT', () => {
  it('rejects non-power-of-two sizes', () => {
    expect(() => new FFT(1000)).toThrow(/power of two/)
    expect(() => new FFT(0)).toThrow(/power of two/)
  })

  it('transforms DC into bin 0 only', () => {
    const n = 16
    const out = bins(new FFT(n), new Float32Array(n).fill(1))
    expect(out[0]).toBeCloseTo(n, 10)
    expect(out[1]).toBeCloseTo(0, 10)
    for (let i = 1; i <= n / 2; i++) {
      expect(Math.hypot(out[2 * i]!, out[2 * i + 1]!)).toBeCloseTo(0, 10)
    }
  })

  it('spreads a unit impulse flat across all bins', () => {
    const n = 32
    const input = new Float32Array(n)
    input[0] = 1
    const out = bins(new FFT(n), input)
    for (let i = 0; i <= n / 2; i++) {
      expect(out[2 * i]).toBeCloseTo(1, 10)
      expect(out[2 * i + 1]).toBeCloseTo(0, 10)
    }
  })

  it('puts a bin-aligned sine into exactly that bin', () => {
    const n = 64
    const k = 5
    const input = new Float32Array(n)
    for (let i = 0; i < n; i++) input[i] = Math.sin((2 * Math.PI * k * i) / n)
    const out = bins(new FFT(n), input)
    for (let i = 0; i <= n / 2; i++) {
      // float32 input rounding leaks ~1e-7 into the other bins, well under the n/2 peak
      const mag = Math.hypot(out[2 * i]!, out[2 * i + 1]!)
      if (i === k) expect(mag).toBeCloseTo(n / 2, 5)
      else expect(mag).toBeCloseTo(0, 5)
    }
  })

  it('matches the reference spectrum bin for bin', () => {
    const out = bins(new FFT(32), testSignal(32))
    GOLDEN_32.forEach(([re, im], i) => {
      expect(out[2 * i]).toBeCloseTo(re, 6)
      expect(out[2 * i + 1]).toBeCloseTo(im, 6)
    })
  })

  it('conserves energy between time and frequency domain (Parseval)', () => {
    for (const n of [64, 4096]) {
      const input = testSignal(n)
      const out = bins(new FFT(n), input)

      let time = 0
      for (let i = 0; i < n; i++) time += input[i]! * input[i]!

      // Sum the full spectrum: bins 1..n/2-1 stand in for their conjugate twins.
      let freq = out[0]! * out[0]! + out[n]! * out[n]!
      for (let i = 1; i < n / 2; i++) {
        freq += 2 * (out[2 * i]! ** 2 + out[2 * i + 1]! ** 2)
      }
      expect(freq / n).toBeCloseTo(time, 3)
    }
  })

  it('reuses the output buffer without allocating per transform', () => {
    const fft = new FFT(64)
    const out = fft.createSpectrum()
    const input = new Float32Array(64).fill(0.5)
    fft.transform(out, input)
    const first = out[0]
    fft.transform(out, input)
    expect(out[0]).toBe(first)
  })
})
