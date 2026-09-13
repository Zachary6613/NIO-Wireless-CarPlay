/**
 * GNSS receiver types.
 *
 * The fix itself travels as `GpsPayload` through the telemetry store, so it reaches
 * Android Auto, CarPlay and the dongle over the existing adapters. Everything here is
 * the extra detail only the receiver knows: firmware, its own clock, per-constellation
 * satellite health. Consumed by the GPS settings page.
 */

/** NMEA talker IDs map onto these. `unknown` keeps an unrecognised talker visible. */
export type GnssConstellation = 'gps' | 'glonass' | 'galileo' | 'beidou' | 'qzss' | 'unknown'

export type GnssSatellite = {
  /** Satellite id as reported by the receiver (PRN / slot, constellation-local). */
  id: number
  constellation: GnssConstellation
  /** Elevation above the horizon in degrees (0..90). */
  elevation?: number
  /** Azimuth in degrees (0 = north, clockwise). */
  azimuth?: number
  /** Carrier-to-noise density in dB-Hz. Absent while the receiver only sees the satellite. */
  snr?: number
  /** True once the satellite contributes to the fix (from GSA). */
  used: boolean
}

/** GGA fix quality — the raw NMEA numbering, kept as-is so nothing is lost in translation. */
export type GnssFixQuality =
  | 'none'
  | 'gps'
  | 'dgps'
  | 'pps'
  | 'rtk'
  | 'rtkFloat'
  | 'estimated'
  | 'manual'
  | 'simulated'

/** GSA fix mode. */
export type GnssFixMode = 'none' | '2d' | '3d'

/** Firmware identity, from UBX-MON-VER. Absent on receivers that only speak NMEA. */
export type GnssVersion = {
  /** e.g. "ROM CORE 4.04 (d964f4)" */
  software?: string
  /** e.g. "00190000" */
  hardware?: string
  /** e.g. "SPG 4.04" */
  firmware?: string
  /** e.g. "32.01" */
  protocol?: string
  /** e.g. "NEO-M9N" */
  model?: string
  /** Constellations the firmware supports, e.g. ["GPS", "GLO", "GAL", "BDS"]. */
  supported?: string[]
}

/** Antenna supervisor state from the receiver's RF front end. */
export type GnssAntennaStatus = 'init' | 'unknown' | 'ok' | 'short' | 'open'
export type GnssAntennaPower = 'off' | 'on' | 'unknown'
export type GnssJamming = 'unknown' | 'ok' | 'warning' | 'critical'

export type GnssRf = {
  antennaStatus: GnssAntennaStatus
  antennaPower: GnssAntennaPower
  jamming: GnssJamming
  /** 0..255; how strongly the receiver suspects interference. */
  jammingIndicator: number
  /** 0..8191; high gain with a weak signal means the antenna delivers too little. */
  agc: number
  /** Broadband noise level. */
  noise: number
}

export type GnssInfo = {
  /** False while the serial device is closed or unreachable. */
  connected: boolean
  /** Device path currently in use, e.g. "/dev/ttyAMA0". */
  device?: string
  baudRate?: number
  /** Last error that kept the receiver from opening, for the settings page. */
  error?: string

  version?: GnssVersion

  /** RF front end and antenna supervisor, from UBX-MON-RF. */
  rf?: GnssRf

  fixQuality: GnssFixQuality
  fixMode: GnssFixMode
  /** Satellites contributing to the fix. */
  satellitesUsed: number
  /** Satellites the receiver can see, fix or not. */
  satellitesVisible: number

  /** Dilution of precision — lower is better. */
  pdop?: number
  hdop?: number
  vdop?: number

  /** The receiver's own UTC clock as unix-ms, straight from RMC date + time. */
  receiverTime?: number

  /** IANA zone derived from the fix position. */
  timezone?: string

  /** Everything currently in view, newest GSV sweep, sorted by constellation then id. */
  satellites: GnssSatellite[]

  /** Systems this receiver has reported at all, so rows stay put at zero. */
  constellations: GnssConstellation[]

  /** Unix-ms of the last sentence we decoded — stale data is visible as an old timestamp. */
  updatedAt?: number
}

export const EMPTY_GNSS_INFO: GnssInfo = {
  connected: false,
  fixQuality: 'none',
  fixMode: 'none',
  satellitesUsed: 0,
  satellitesVisible: 0,
  satellites: [],
  constellations: []
}
