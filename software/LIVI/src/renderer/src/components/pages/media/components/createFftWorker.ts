export const createFftWorker = () =>
  new Worker(new URL('@worker/fft.worker.ts', import.meta.url), {
    type: 'module'
  })
