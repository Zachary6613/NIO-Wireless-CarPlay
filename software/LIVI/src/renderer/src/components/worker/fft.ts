// Iterative radix-2 Cooley-Tukey FFT for real-valued input.
// Tables and scratch buffers are built once per size, the transform itself allocates nothing.

export class FFT {
  readonly size: number
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly rev: Uint32Array
  private readonly re: Float64Array
  private readonly im: Float64Array

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`)
    }
    this.size = size
    this.re = new Float64Array(size)
    this.im = new Float64Array(size)

    let bits = 0
    while (1 << bits < size) bits++
    this.rev = new Uint32Array(size)
    for (let i = 0; i < size; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) {
        if (i & (1 << b)) r |= 1 << (bits - 1 - b)
      }
      this.rev[i] = r
    }

    const half = size >> 1
    this.cos = new Float64Array(half)
    this.sin = new Float64Array(half)
    for (let i = 0; i < half; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / size)
      this.sin[i] = Math.sin((-2 * Math.PI * i) / size)
    }
  }

  /** Output buffer for transform(): interleaved re/im for bins 0..size/2. */
  createSpectrum(): Float64Array {
    return new Float64Array(this.size + 2)
  }

  /** Forward transform of `input` (size real samples) into `out` as bins 0..size/2. */
  transform(out: Float64Array, input: Float32Array): void {
    const { size, re, im, rev, cos, sin } = this

    for (let i = 0; i < size; i++) {
      const r = rev[i]!
      re[r] = input[i]!
      im[r] = 0
    }

    for (let len = 2; len <= size; len <<= 1) {
      const half = len >> 1
      const step = size / len
      for (let base = 0; base < size; base += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = cos[k]!
          const wi = sin[k]!
          const a = base + j
          const b = a + half
          const xr = re[b]! * wr - im[b]! * wi
          const xi = re[b]! * wi + im[b]! * wr
          re[b] = re[a]! - xr
          im[b] = im[a]! - xi
          re[a] = re[a]! + xr
          im[a] = im[a]! + xi
        }
      }
    }

    for (let i = 0, n = size >> 1; i <= n; i++) {
      out[2 * i] = re[i]!
      out[2 * i + 1] = im[i]!
    }
  }
}
