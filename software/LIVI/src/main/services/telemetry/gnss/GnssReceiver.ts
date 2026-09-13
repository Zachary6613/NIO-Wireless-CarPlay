// Serial GNSS receiver. NMEA for the fix, UBX for the module identity.
// Baud rate via stty, device read as a plain character device.

import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type {
  GnssFixMode,
  GnssFixQuality,
  GnssInfo,
  GnssRf,
  GnssSatellite,
  GnssVersion
} from '@shared/types/Gnss'
import type { GpsPayload } from '@shared/types/Telemetry'
import { NmeaDecoder } from './nmeaDecode'
import {
  parseMonRf,
  parseMonVer,
  pollMonRf,
  pollMonVer,
  UBX_CLASS_MON,
  UBX_ID_MON_RF,
  UBX_ID_MON_VER,
  UbxParser
} from './ubx'

export const DEFAULT_GNSS_DEVICE = '/dev/ttyAMA0'
export const DEFAULT_GNSS_BAUD = 38400

/** Reopen backoff after the device disappears. */
const RETRY_MS = 5_000
/** Fix state is dropped after this much silence. */
const STALE_MS = 10_000
/** Info updates are paced to this interval. */
const INFO_THROTTLE_MS = 1_000
/** Identity poll interval and attempt cap. */
const VERSION_POLL_MS = 2_000
const VERSION_POLL_TRIES = 5
/** Antenna state and interference change while running, so they are re-read. */
const RF_POLL_MS = 10_000

export type GnssReceiverDeps = {
  publishFix: (gps: GpsPayload) => void
  device?: string
  baudRate?: number
}

export interface GnssReceiverEvents {
  info: (info: GnssInfo) => void
}

export class GnssReceiver extends EventEmitter {
  private readonly nmea = new NmeaDecoder()
  private readonly ubx = new UbxParser()

  private stream: fs.ReadStream | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private staleTimer: NodeJS.Timeout | null = null
  private infoTimer: NodeJS.Timeout | null = null
  private versionTimer: NodeJS.Timeout | null = null
  private rfTimer: NodeJS.Timeout | null = null
  private versionAttempts = 0
  private running = false

  private readonly device: string
  private readonly baudRate: number

  private version: GnssVersion | undefined
  private rf: GnssRf | undefined
  private fixQuality: GnssFixQuality = 'none'
  private fixMode: GnssFixMode = 'none'
  private satellites: GnssSatellite[] = []
  private satellitesUsed = 0
  private pdop: number | undefined
  private hdop: number | undefined
  private vdop: number | undefined
  private receiverTime: number | undefined
  private accuracyM: number | undefined
  private lastFix: GpsPayload | undefined
  private portOpen = false
  private receiving = false
  private lastError: string | undefined
  private updatedAt: number | undefined

  constructor(private readonly deps: GnssReceiverDeps) {
    super()
    this.device = deps.device || DEFAULT_GNSS_DEVICE
    this.baudRate = deps.baudRate || DEFAULT_GNSS_BAUD
  }

  /** Idempotent. A missing device retries in the background. */
  start(): void {
    if (this.running) return
    this.running = true
    this.open()
  }

  stop(): void {
    this.running = false
    this.clearTimer('retryTimer')
    this.clearTimer('staleTimer')
    this.clearTimer('infoTimer')
    this.clearTimer('versionTimer')
    this.clearTimer('rfTimer')
    this.closeStream()
    if (this.portOpen || this.receiving) {
      this.portOpen = false
      this.receiving = false
      this.emitInfo(true)
    }
  }

  /** Current receiver state. */
  info(): GnssInfo {
    const info: GnssInfo = {
      connected: this.receiving,
      device: this.device,
      baudRate: this.baudRate,
      fixQuality: this.fixQuality,
      fixMode: this.fixMode,
      satellitesUsed: this.satellitesUsed,
      satellitesVisible: this.satellites.length,
      satellites: this.satellites,
      constellations: this.nmea.constellationsSeen()
    }
    if (this.version) info.version = this.version
    if (this.rf) info.rf = this.rf
    if (this.lastError) info.error = this.lastError
    if (this.pdop !== undefined) info.pdop = this.pdop
    if (this.hdop !== undefined) info.hdop = this.hdop
    if (this.vdop !== undefined) info.vdop = this.vdop
    if (this.receiverTime !== undefined) info.receiverTime = this.receiverTime
    if (this.updatedAt !== undefined) info.updatedAt = this.updatedAt
    return info
  }

  /** Last fix, including the GST accuracy. */
  fix(): GpsPayload | undefined {
    if (!this.lastFix) return undefined
    return this.accuracyM === undefined
      ? this.lastFix
      : { ...this.lastFix, accuracyM: this.accuracyM }
  }

  // ── serial lifecycle ────────────────────────────────────────────────────

  private open(): void {
    if (!this.running || this.stream) return

    if (!fs.existsSync(this.device)) {
      this.fail(`${this.device} not found`)
      return
    }

    execFile(
      'stty',
      ['-F', this.device, String(this.baudRate), 'raw', '-echo', '-crtscts'],
      (err) => {
        if (!this.running) return
        if (err) {
          this.fail(`stty failed: ${err.message}`)
          return
        }
        this.attach()
      }
    )
  }

  private attach(): void {
    if (!this.running || this.stream) return
    let stream: fs.ReadStream
    try {
      stream = fs.createReadStream(this.device, { flags: 'r' })
    } catch (e) {
      this.fail(`open failed: ${(e as Error).message}`)
      return
    }
    this.stream = stream

    stream.on('data', (chunk) => this.onData(chunk as Buffer))
    stream.on('error', (e) => this.fail(`read failed: ${e.message}`))
    stream.on('close', () => {
      if (this.stream === stream) this.fail(`${this.device} closed`)
    })

    this.lastError = undefined
    this.portOpen = true
    this.armStaleTimer()
    this.emitInfo(true)
    console.log(`[gnss] ${this.device} open at ${this.baudRate} baud`)
  }

  /** Poll the module identity, repeating until it answers or the cap is reached. */
  private askVersion(): void {
    if (!this.running || this.version) return
    if (this.versionAttempts >= VERSION_POLL_TRIES) return
    this.versionAttempts += 1

    fs.writeFile(this.device, pollMonVer(), (err) => {
      if (err) console.warn(`[gnss] version poll failed: ${err.message}`)
    })

    this.clearTimer('versionTimer')
    this.versionTimer = setTimeout(() => {
      this.versionTimer = null
      this.askVersion()
    }, VERSION_POLL_MS)
    this.versionTimer.unref?.()
  }

  /** Re-read the RF front end while the receiver keeps talking. */
  private askRf(): void {
    if (!this.running) return
    fs.writeFile(this.device, pollMonRf(), () => {})
    this.clearTimer('rfTimer')
    this.rfTimer = setTimeout(() => {
      this.rfTimer = null
      if (this.receiving) this.askRf()
    }, RF_POLL_MS)
    this.rfTimer.unref?.()
  }

  private closeStream(): void {
    const stream = this.stream
    this.stream = null
    if (!stream) return
    stream.removeAllListeners()
    stream.destroy()
  }

  private fail(reason: string): void {
    this.closeStream()
    if (this.lastError !== reason) console.warn(`[gnss] ${reason}`)
    this.lastError = reason
    this.portOpen = false
    this.receiving = false
    this.emitInfo(true)
    if (!this.running || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.open()
    }, RETRY_MS)
    this.retryTimer.unref?.()
  }

  // ── decoding ────────────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    this.armStaleTimer()
    this.updatedAt = Date.now()

    // First bytes from a receiver that may have powered up long after we opened
    if (!this.receiving) {
      this.receiving = true
      this.versionAttempts = 0
      this.askVersion()
      this.askRf()
      this.emitInfo(true)
    }

    for (const frame of this.ubx.push(chunk)) {
      if (frame.cls !== UBX_CLASS_MON) continue
      if (frame.id === UBX_ID_MON_RF) {
        const rf = parseMonRf(frame.payload)
        if (rf) {
          this.rf = rf
          this.emitInfo(true)
        }
        continue
      }
      if (frame.id !== UBX_ID_MON_VER) continue
      const version = parseMonVer(frame.payload)
      if (version) {
        this.version = version
        console.log(
          `[gnss] ${version.model || version.software || 'receiver'} — ` +
            `fw ${version.firmware || '?'}, protocol ${version.protocol || '?'}`
        )
        this.emitInfo(true)
      }
    }

    let fixPatch: GpsPayload | undefined
    for (const update of this.nmea.push(chunk)) {
      if (update.fixQuality !== undefined) this.fixQuality = update.fixQuality
      if (update.fixMode !== undefined) this.fixMode = update.fixMode
      if (update.satellitesUsed !== undefined) this.satellitesUsed = update.satellitesUsed
      if (update.satellites !== undefined) this.satellites = update.satellites
      if (update.pdop !== undefined) this.pdop = update.pdop
      if (update.hdop !== undefined) this.hdop = update.hdop
      if (update.vdop !== undefined) this.vdop = update.vdop
      if (update.receiverTime !== undefined) this.receiverTime = update.receiverTime
      if (update.gps) {
        if (update.gps.accuracyM !== undefined) this.accuracyM = update.gps.accuracyM
        fixPatch = { ...fixPatch, ...update.gps }
      }
    }

    if (fixPatch && fixPatch.lat !== undefined && fixPatch.lng !== undefined) {
      this.lastFix = { ...this.lastFix, ...fixPatch }
      const out =
        this.accuracyM === undefined ? fixPatch : { ...fixPatch, accuracyM: this.accuracyM }
      this.deps.publishFix(out)
    }

    this.emitInfo(false)
  }

  // ── housekeeping ────────────────────────────────────────────────────────

  /** Drops the fix state when the stream goes silent. */
  private armStaleTimer(): void {
    this.clearTimer('staleTimer')
    this.staleTimer = setTimeout(() => {
      this.staleTimer = null
      const wasReceiving = this.receiving
      this.receiving = false
      // A receiver that went away may be a different one when it returns
      this.version = undefined
      this.rf = undefined
      this.satellites = []
      if (this.fixQuality === 'none' && this.fixMode === 'none') {
        if (wasReceiving) this.emitInfo(true)
        return
      }
      console.warn(`[gnss] no sentences for ${STALE_MS / 1000}s, dropping the fix state`)
      this.fixQuality = 'none'
      this.fixMode = 'none'
      this.satellitesUsed = 0
      this.emitInfo(true)
    }, STALE_MS)
    this.staleTimer.unref?.()
  }

  /** `immediate` skips the pacing. */
  private emitInfo(immediate: boolean): void {
    if (immediate) {
      this.clearTimer('infoTimer')
      this.emit('info', this.info())
      return
    }
    if (this.infoTimer) return
    this.infoTimer = setTimeout(() => {
      this.infoTimer = null
      this.emit('info', this.info())
    }, INFO_THROTTLE_MS)
    this.infoTimer.unref?.()
  }

  private clearTimer(
    key: 'retryTimer' | 'staleTimer' | 'infoTimer' | 'versionTimer' | 'rfTimer'
  ): void {
    const timer = this[key]
    if (!timer) return
    clearTimeout(timer)
    this[key] = null
  }
}
