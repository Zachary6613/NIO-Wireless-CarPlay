/**
 * Minimal UBX support for u-blox receivers. NMEA already carries position and
 * satellite health, so this only covers MON-VER: the receiver's own identity.
 *
 * Frame: B5 62 | class | id | length (u16 LE) | payload | CK_A CK_B,
 * checksum = 8-bit Fletcher over everything between the sync words and itself.
 */

import type {
  GnssAntennaPower,
  GnssAntennaStatus,
  GnssJamming,
  GnssRf,
  GnssVersion
} from '@shared/types/Gnss'

const SYNC_1 = 0xb5
const SYNC_2 = 0x62

export const UBX_CLASS_MON = 0x0a
export const UBX_ID_MON_VER = 0x04
export const UBX_ID_MON_RF = 0x38

export type UbxFrame = {
  cls: number
  id: number
  payload: Buffer
}

/** 8-bit Fletcher checksum over class, id, length and payload. */
export function ubxChecksum(bytes: Buffer): [number, number] {
  let a = 0
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) & 0xff
    b = (b + a) & 0xff
  }
  return [a, b]
}

/** Build a complete frame, ready to write to the serial device. */
export function buildUbx(cls: number, id: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.from([cls, id, payload.length & 0xff, (payload.length >> 8) & 0xff])
  const body = Buffer.concat([head, payload])
  const [a, b] = ubxChecksum(body)
  return Buffer.concat([Buffer.from([SYNC_1, SYNC_2]), body, Buffer.from([a, b])])
}

/** A zero-length MON-VER message is the poll for it. */
export function pollMonVer(): Buffer {
  return buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER)
}

/** Same for MON-RF, the RF front end and antenna supervisor. */
export function pollMonRf(): Buffer {
  return buildUbx(UBX_CLASS_MON, UBX_ID_MON_RF)
}

/**
 * Pulls complete UBX frames out of a byte stream that also carries NMEA.
 * Keeps a partial tail across calls, so it survives arbitrary read boundaries.
 */
export class UbxParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): UbxFrame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    // Bound the buffer: a receiver sending only NMEA would otherwise grow it forever
    if (this.buffer.length > 8192) this.buffer = Buffer.from(this.buffer.subarray(-2048))

    const frames: UbxFrame[] = []
    let offset = 0

    for (;;) {
      const start = this.buffer.indexOf(SYNC_1, offset)
      if (start < 0 || start + 1 >= this.buffer.length) {
        // Keep a trailing sync byte, the second half may arrive next read
        offset = start < 0 ? this.buffer.length : start
        break
      }
      if (this.buffer[start + 1] !== SYNC_2) {
        offset = start + 1
        continue
      }
      if (start + 6 > this.buffer.length) {
        offset = start
        break
      }

      const length = this.buffer.readUInt16LE(start + 4)
      const end = start + 6 + length + 2
      if (length > 4096) {
        // Not a real frame — a stray sync pair inside NMEA text
        offset = start + 2
        continue
      }
      if (end > this.buffer.length) {
        offset = start
        break
      }

      const body = this.buffer.subarray(start + 2, start + 6 + length)
      const [a, b] = ubxChecksum(body)
      if (a === this.buffer[end - 2] && b === this.buffer[end - 1]) {
        frames.push({
          cls: this.buffer[start + 2],
          id: this.buffer[start + 3],
          payload: Buffer.from(this.buffer.subarray(start + 6, start + 6 + length))
        })
        offset = end
      } else {
        offset = start + 2
      }
    }

    this.buffer = offset > 0 ? Buffer.from(this.buffer.subarray(offset)) : this.buffer
    return frames
  }
}

/**
 * Decode a MON-VER payload: a 30-byte software version, a 10-byte hardware version,
 * then any number of 30-byte extension strings. All are zero-padded C strings.
 */
export function parseMonVer(payload: Buffer): GnssVersion | null {
  if (payload.length < 40) return null

  const version: GnssVersion = {
    software: cstr(payload.subarray(0, 30)),
    hardware: cstr(payload.subarray(30, 40))
  }

  const supported: string[] = []
  for (let off = 40; off + 30 <= payload.length; off += 30) {
    const ext = cstr(payload.subarray(off, off + 30))
    if (!ext) continue
    if (ext.startsWith('FWVER=')) version.firmware = ext.slice(6)
    else if (ext.startsWith('PROTVER=')) version.protocol = ext.slice(8)
    else if (ext.startsWith('MOD=')) version.model = ext.slice(4)
    // Constellation lists arrive as one or more "GPS;GLO;GAL;BDS" / "SBAS;QZSS" lines
    else if (/^[A-Z]{3,4}(;[A-Z]{3,4})*$/.test(ext)) supported.push(...ext.split(';'))
  }
  if (supported.length > 0) version.supported = supported

  return version
}

function cstr(buf: Buffer): string {
  const end = buf.indexOf(0)
  return buf
    .subarray(0, end < 0 ? buf.length : end)
    .toString('latin1')
    .trim()
}

const ANTENNA_STATUS: GnssAntennaStatus[] = ['init', 'unknown', 'ok', 'short', 'open']
const ANTENNA_POWER: GnssAntennaPower[] = ['off', 'on', 'unknown']
const JAMMING: [GnssJamming, GnssJamming, GnssJamming, GnssJamming] = [
  'unknown',
  'ok',
  'warning',
  'critical'
]

/**
 * Decode MON-RF: a 4-byte header, then one 24-byte block per RF path. Only the first
 * block is read — the second covers L2/L5 bands the M9N does not use for this.
 */
export function parseMonRf(payload: Buffer): GnssRf | null {
  if (payload.length < 4 + 24) return null
  const b = payload.subarray(4)
  return {
    jamming: JAMMING[(b[1] & 0x03) as 0 | 1 | 2 | 3],
    antennaStatus: ANTENNA_STATUS[b[2]] ?? 'unknown',
    antennaPower: ANTENNA_POWER[b[3]] ?? 'unknown',
    noise: b.readUInt16LE(12),
    agc: b.readUInt16LE(14),
    jammingIndicator: b[16]
  }
}
