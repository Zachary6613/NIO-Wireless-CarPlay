/**
 * NMEA-0183 decoder for a connected receiver — the counterpart to ../nmea.ts,
 * which encodes a fix for the phone.
 *
 * GSV arrives as a sweep of several sentences per constellation, so satellites are
 * collected per talker and only published once that talker's last sentence lands.
 */

import type {
  GnssConstellation,
  GnssFixMode,
  GnssFixQuality,
  GnssSatellite
} from '@shared/types/Gnss'
import type { GpsPayload } from '@shared/types/Telemetry'

const TALKERS: Record<string, GnssConstellation> = {
  GP: 'gps',
  GL: 'glonass',
  GA: 'galileo',
  GB: 'beidou',
  BD: 'beidou',
  GQ: 'qzss'
}

const FIX_QUALITY: Record<number, GnssFixQuality> = {
  0: 'none',
  1: 'gps',
  2: 'dgps',
  3: 'pps',
  4: 'rtk',
  5: 'rtkFloat',
  6: 'estimated',
  7: 'manual',
  8: 'simulated'
}

const KNOTS_TO_MS = 0.514444

/** What one decoded sentence changed. Fields stay absent when the sentence said nothing. */
export type NmeaUpdate = {
  gps?: GpsPayload
  fixQuality?: GnssFixQuality
  fixMode?: GnssFixMode
  pdop?: number
  hdop?: number
  vdop?: number
  receiverTime?: number
  satellites?: GnssSatellite[]
  satellitesVisible?: number
  satellitesUsed?: number
}

/** Verify the `*hh` trailer. Sentences without one are accepted — some receivers omit it. */
export function nmeaChecksumValid(sentence: string): boolean {
  const star = sentence.lastIndexOf('*')
  if (star < 0) return true
  const body = sentence.slice(sentence.startsWith('$') ? 1 : 0, star)
  const want = sentence.slice(star + 1, star + 3)
  if (!/^[0-9a-fA-F]{2}$/.test(want)) return false
  let sum = 0
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i)
  return sum === Number.parseInt(want, 16)
}

/**
 * Folds a receiver's sentence stream into position, fix quality and satellite health.
 * Feed it raw bytes; it handles sentence framing and partial reads itself.
 */
export class NmeaDecoder {
  private buffer = ''
  // Per-talker GSV sweeps, swapped into `visible` only once a sweep completes
  private readonly pendingSweep = new Map<string, GnssSatellite[]>()
  private readonly visible = new Map<GnssConstellation, GnssSatellite[]>()
  // Satellite ids from GSA, which names them without saying which constellation
  private usedIds = new Set<number>()
  private readonly seen = new Set<GnssConstellation>()
  private lastDate = ''

  /** Feed raw serial bytes. Returns one update per complete, valid sentence. */
  push(chunk: string | Buffer): NmeaUpdate[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1')
    // A receiver that is misconfigured or sending binary would grow this unbounded
    if (this.buffer.length > 16384) this.buffer = this.buffer.slice(-4096)

    const out: NmeaUpdate[] = []
    let nl: number
    while ((nl = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, nl).trim()
      this.buffer = this.buffer.slice(nl + 1)
      if (!line.startsWith('$')) continue
      const update = this.decode(line)
      if (update) out.push(update)
    }
    return out
  }

  /** Decode a single complete sentence. Returns null when it carries nothing useful. */
  decode(sentence: string): NmeaUpdate | null {
    if (!nmeaChecksumValid(sentence)) return null
    const star = sentence.lastIndexOf('*')
    const body = sentence.slice(sentence.startsWith('$') ? 1 : 0, star < 0 ? undefined : star)
    const fields = body.split(',')
    const header = fields[0]
    if (header.length < 5) return null

    const talker = header.slice(0, 2)
    const type = header.slice(2)

    switch (type) {
      case 'GGA':
        return this.decodeGga(fields)
      case 'RMC':
        return this.decodeRmc(fields)
      case 'GSA':
        return this.decodeGsa(fields)
      case 'GSV':
        return this.decodeGsv(talker, fields)
      case 'GST':
        return this.decodeGst(fields)
      default:
        return null
    }
  }

  /** Systems this receiver has reported at all. */
  constellationsSeen(): GnssConstellation[] {
    return [...this.seen].sort()
  }

  /** Everything currently in view across all constellations, stable order. */
  satellitesInView(): GnssSatellite[] {
    const all: GnssSatellite[] = []
    for (const list of this.visible.values()) {
      for (const sat of list) all.push({ ...sat, used: this.usedIds.has(sat.id) })
    }
    all.sort((a, b) =>
      a.constellation === b.constellation
        ? a.id - b.id
        : a.constellation.localeCompare(b.constellation)
    )
    return all
  }

  private decodeGga(f: string[]): NmeaUpdate | null {
    const quality = FIX_QUALITY[num(f[6]) ?? -1] ?? 'none'
    const update: NmeaUpdate = { fixQuality: quality }

    const used = num(f[7])
    if (used !== undefined) update.satellitesUsed = used
    const hdop = num(f[8])
    if (hdop !== undefined) update.hdop = hdop

    const lat = coord(f[2], f[3])
    const lng = coord(f[4], f[5])
    if (quality !== 'none' && lat !== undefined && lng !== undefined) {
      const gps: GpsPayload = { lat, lng }
      const alt = num(f[9])
      if (alt !== undefined) gps.alt = alt
      if (used !== undefined) gps.satellites = used
      update.gps = gps
    }
    return update
  }

  private decodeRmc(f: string[]): NmeaUpdate | null {
    const active = f[2] === 'A'
    const update: NmeaUpdate = {}

    if (f[9]) this.lastDate = f[9]
    const time = utcMs(f[1], f[9] || this.lastDate)
    if (time !== undefined) update.receiverTime = time

    if (!active) return update

    const lat = coord(f[3], f[4])
    const lng = coord(f[5], f[6])
    if (lat === undefined || lng === undefined) return update

    const gps: GpsPayload = { lat, lng }
    const knots = num(f[7])
    if (knots !== undefined) gps.speedMs = knots * KNOTS_TO_MS
    const course = num(f[8])
    // Course is meaningless when standing still, and receivers emit noise there
    if (course !== undefined && knots !== undefined && knots > 0.5) gps.heading = course
    if (time !== undefined) gps.fixTs = time
    update.gps = gps
    return update
  }

  private decodeGsa(f: string[]): NmeaUpdate {
    const mode = num(f[2])
    const update: NmeaUpdate = {
      fixMode: mode === 3 ? '3d' : mode === 2 ? '2d' : 'none'
    }
    const pdop = num(f[15])
    const hdop = num(f[16])
    const vdop = num(f[17])
    if (pdop !== undefined) update.pdop = pdop
    if (hdop !== undefined) update.hdop = hdop
    if (vdop !== undefined) update.vdop = vdop

    // Fields 3..14 are the satellite ids carrying the fix. Multi-constellation
    // receivers send one GSA per system, so ids accumulate until the next GGA cycle.
    const ids = new Set(this.usedIds)
    for (let i = 3; i <= 14; i++) {
      const id = num(f[i])
      if (id !== undefined) ids.add(id)
    }
    this.usedIds = ids
    update.satellites = this.satellitesInView()
    return update
  }

  private decodeGsv(talker: string, f: string[]): NmeaUpdate | null {
    const total = num(f[1])
    const index = num(f[2])
    if (total === undefined || index === undefined) return null

    const constellation = TALKERS[talker] ?? 'unknown'
    // An empty sweep still proves the chip covers this system
    this.seen.add(constellation)
    const sweep = index === 1 ? [] : (this.pendingSweep.get(talker) ?? [])

    // Blocks of four: id, elevation, azimuth, SNR. A trailing signal id may follow.
    for (let i = 4; i + 2 < f.length; i += 4) {
      const id = num(f[i])
      if (id === undefined) continue
      const sat: GnssSatellite = { id, constellation, used: false }
      const elevation = num(f[i + 1])
      const azimuth = num(f[i + 2])
      const snr = num(f[i + 3])
      if (elevation !== undefined) sat.elevation = elevation
      if (azimuth !== undefined) sat.azimuth = azimuth
      if (snr !== undefined) sat.snr = snr
      // Multi-band receivers list a satellite once per signal; keep the strongest
      const seen = sweep.findIndex((s) => s.id === id)
      if (seen < 0) sweep.push(sat)
      else if ((snr ?? -1) > (sweep[seen].snr ?? -1)) sweep[seen] = sat
    }

    if (index < total) {
      this.pendingSweep.set(talker, sweep)
      return null
    }

    // Sweep complete — publish this constellation
    this.pendingSweep.delete(talker)
    if (sweep.length === 0) this.visible.delete(constellation)
    else this.visible.set(constellation, sweep)

    const satellites = this.satellitesInView()
    return { satellites, satellitesVisible: satellites.length }
  }

  private decodeGst(f: string[]): NmeaUpdate | null {
    const latErr = num(f[6])
    const lngErr = num(f[7])
    if (latErr === undefined || lngErr === undefined) return null
    // Combine the per-axis standard deviations into one horizontal figure
    return { gps: { accuracyM: Math.hypot(latErr, lngErr) } }
  }
}

function num(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** "ddmm.mmmm" + hemisphere → signed decimal degrees. */
function coord(value: string | undefined, hemi: string | undefined): number | undefined {
  if (!value || !hemi) return undefined
  const raw = Number(value)
  if (!Number.isFinite(raw)) return undefined
  const deg = Math.floor(Math.abs(raw) / 100)
  const min = Math.abs(raw) - deg * 100
  const dec = deg + min / 60
  return hemi === 'S' || hemi === 'W' ? -dec : dec
}

/** "hhmmss.sss" + "ddmmyy" → unix ms. Without a date the receiver clock is unusable. */
function utcMs(time: string | undefined, date: string | undefined): number | undefined {
  if (!time || time.length < 6 || !date || date.length < 6) return undefined
  const hh = Number(time.slice(0, 2))
  const mm = Number(time.slice(2, 4))
  const ss = Number(time.slice(4))
  const dd = Number(date.slice(0, 2))
  const mo = Number(date.slice(2, 4))
  const yy = Number(date.slice(4, 6))
  if (![hh, mm, ss, dd, mo, yy].every(Number.isFinite)) return undefined
  return Date.UTC(2000 + yy, mo - 1, dd, hh, mm, Math.floor(ss), Math.round((ss % 1) * 1000))
}
