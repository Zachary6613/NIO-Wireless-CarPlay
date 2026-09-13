// Writes the GNSS state to gpsData.json for external tools.

import type { GnssInfo } from '@shared/types/Gnss'
import { EMPTY_GNSS_INFO } from '@shared/types/Gnss'
import type { GpsPayload } from '@shared/types/Telemetry'
import { DebouncedJsonFile } from '../../status/DebouncedJsonFile'

export const GPS_DATA_VERSION = 2

export type GpsData = {
  version: number
  /** Unix-ms this file was written. */
  ts: number
  /** The fix as the consumers receive it. */
  fix: GpsPayload | null
  /** Receiver state without the per-satellite list . */
  receiver: Omit<GnssInfo, 'satellites'>
}

export class GpsFileWriter {
  private info: GnssInfo = EMPTY_GNSS_INFO
  private fix: GpsPayload | null = null
  private readonly sink: DebouncedJsonFile

  constructor(file?: string, opts: { debounceMs?: number; writeInitial?: boolean } = {}) {
    this.sink = new DebouncedJsonFile(() => this.snapshot(), {
      file,
      name: 'gpsData.json',
      tag: 'gpsFile',
      debounceMs: opts.debounceMs ?? 1000
    })
    if (opts.writeInitial) this.sink.flushNow()
  }

  setInfo(info: GnssInfo): void {
    this.info = info
    this.sink.schedule()
  }

  setFix(fix: GpsPayload): void {
    this.fix = { ...this.fix, ...fix }
    this.sink.schedule()
  }

  snapshot(): GpsData {
    const { satellites: _satellites, ...receiver } = this.info
    return {
      version: GPS_DATA_VERSION,
      ts: Date.now(),
      fix: this.fix,
      receiver
    }
  }

  /** Write now, skipping the debounce. */
  flushNow(): void {
    this.sink.flushNow()
  }

  dispose(): void {
    this.sink.cancel()
  }
}
