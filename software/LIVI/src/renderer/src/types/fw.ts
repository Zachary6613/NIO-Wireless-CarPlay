export type FwPhase = 'start' | 'download' | 'ready' | 'error' | 'upload'

export type FwProgress = {
  percent?: number
  received?: number
  total?: number
}

export type FwDialogState = {
  open: boolean
  phase: FwPhase
  progress: FwProgress
  error: string
  message: string
  inFlight: boolean
}
