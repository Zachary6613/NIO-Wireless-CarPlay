import { useEffect } from 'react'
import { useLiviStore } from '../store/store'

// Feed the FFT spectrum store from the main-process audio chunks.
export function useFftPcm(delayMs = 0): void {
  const setPcmData = useLiviStore((s) => s.setPcmData)

  useEffect(() => {
    const ipc = window.projection?.ipc
    if (!ipc || typeof ipc.onAudioChunk !== 'function') return

    const timers = new Set<number>()

    const handleAudio = (payload: unknown) => {
      if (!payload || typeof payload !== 'object') return

      const m = payload as { chunk?: { buffer?: ArrayBuffer } }
      const buf = m.chunk?.buffer
      if (!buf) return

      // mono Int16 from main -> Float32 [-1, 1] for FFT
      const int16 = new Int16Array(buf)
      const f32 = new Float32Array(int16.length)
      for (let i = 0; i < int16.length; i += 1) {
        f32[i] = int16[i] / 32768
      }

      const id = window.setTimeout(() => {
        timers.delete(id)
        setPcmData(f32)
      }, delayMs)
      timers.add(id)
    }

    ipc.onAudioChunk(handleAudio)

    return () => {
      if (typeof ipc.offAudioChunk === 'function') ipc.offAudioChunk(handleAudio)
      for (const id of timers) {
        window.clearTimeout(id)
      }
      timers.clear()
    }
  }, [setPcmData, delayMs])
}
