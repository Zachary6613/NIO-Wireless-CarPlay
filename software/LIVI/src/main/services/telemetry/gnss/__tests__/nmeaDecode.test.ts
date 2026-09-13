import { NmeaDecoder, nmeaChecksumValid } from '../nmeaDecode'

// Captured from a NEO-M9N on a Pi 5 during cold start, before the first lock
const COLD = [
  '$GNRMC,,V,,,,,,,,,,N,V*37',
  '$GNVTG,,,,,,,,,N*2E',
  '$GNGGA,,,,,,0,00,99.99,,,,,,*56',
  '$GNGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99,1*33',
  '$GPGSV,1,1,00,1*64',
  '$GLGSV,1,1,00,1*78'
]

const GGA_FIX = '$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*69'
const RMC_FIX = '$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230326,,,A*5B'

describe('nmeaChecksumValid', () => {
  test('accepts a correct trailer', () => {
    expect(nmeaChecksumValid('$GNRMC,,V,,,,,,,,,,N,V*37')).toBe(true)
  })

  test('rejects a corrupted trailer', () => {
    expect(nmeaChecksumValid('$GNRMC,,V,,,,,,,,,,N,V*38')).toBe(false)
  })

  test('rejects a malformed trailer', () => {
    expect(nmeaChecksumValid('$GPGGA,1*ZZ')).toBe(false)
  })

  test('accepts a sentence without a trailer', () => {
    expect(nmeaChecksumValid('$GPGGA,123519.00')).toBe(true)
  })
})

describe('NmeaDecoder — framing', () => {
  test('splits on CRLF and ignores non-sentence noise', () => {
    const d = new NmeaDecoder()
    const updates = d.push(`noise\r\n${COLD.join('\r\n')}\r\n`)
    expect(updates.length).toBeGreaterThan(0)
  })

  test('reassembles a sentence split across reads', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GPGGA,123519.00,4807.038,N,0113')).toEqual([])
    const updates = d.push('1.000,E,1,08,0.9,545.4,M,46.9,M,,*69\r\n')
    expect(updates[0]?.gps?.lat).toBeCloseTo(48.1173, 4)
  })

  test('drops a sentence with a broken checksum', () => {
    const d = new NmeaDecoder()
    expect(
      d.push('$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*00\r\n')
    ).toEqual([])
  })

  test('caps the buffer when the receiver sends unframed garbage', () => {
    const d = new NmeaDecoder()
    d.push('x'.repeat(20000))
    // Still decodes normally afterwards, so the trim kept the stream usable
    const updates = d.push(`\r\n${GGA_FIX}\r\n`)
    expect(updates[0]?.fixQuality).toBe('gps')
  })

  test('ignores an unknown sentence type', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GPZDA,123519.00,23,03,2026,00,00*6F\r\n')).toEqual([])
  })

  test('ignores a truncated header', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GP\r\n')).toEqual([])
  })

  test('accepts a Buffer chunk', () => {
    const d = new NmeaDecoder()
    const updates = d.push(Buffer.from(`${GGA_FIX}\r\n`, 'latin1'))
    expect(updates[0]?.fixQuality).toBe('gps')
  })
})

describe('NmeaDecoder — GGA', () => {
  test('decodes position, altitude and fix quality', () => {
    const d = new NmeaDecoder()
    const [u] = d.push(`${GGA_FIX}\r\n`)
    expect(u.fixQuality).toBe('gps')
    expect(u.satellitesUsed).toBe(8)
    expect(u.hdop).toBe(0.9)
    expect(u.gps?.lat).toBeCloseTo(48.1173, 4)
    expect(u.gps?.lng).toBeCloseTo(11.51667, 4)
    expect(u.gps?.alt).toBe(545.4)
    expect(u.gps?.satellites).toBe(8)
  })

  test('reports no position while the receiver has no fix', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GNGGA,,,,,,0,00,99.99,,,,,,*56\r\n')
    expect(u.fixQuality).toBe('none')
    expect(u.gps).toBeUndefined()
    expect(u.satellitesUsed).toBe(0)
  })

  test('maps the southern and western hemispheres to negative degrees', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPGGA,123519.00,3352.000,S,15112.000,W,1,06,1.2,10.0,M,0.0,M,,*6B\r\n')
    expect(u.gps?.lat).toBeLessThan(0)
    expect(u.gps?.lng).toBeLessThan(0)
  })

  test('maps an unknown fix quality to none', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPGGA,123519.00,4807.038,N,01131.000,E,9,08,0.9,545.4,M,,,,*39\r\n')
    expect(u.fixQuality).toBe('none')
  })
})

describe('NmeaDecoder — RMC', () => {
  test('decodes speed, course and the receiver clock', () => {
    const d = new NmeaDecoder()
    const [u] = d.push(`${RMC_FIX}\r\n`)
    expect(u.gps?.speedMs).toBeCloseTo(22.4 * 0.514444, 3)
    expect(u.gps?.heading).toBeCloseTo(84.4, 1)
    expect(u.receiverTime).toBe(Date.UTC(2026, 2, 23, 12, 35, 19))
    expect(u.gps?.fixTs).toBe(u.receiverTime)
  })

  test('suppresses the course while standing still', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPRMC,123519.00,A,4807.038,N,01131.000,E,000.1,084.4,230326,,,A*5E\r\n')
    expect(u.gps?.heading).toBeUndefined()
    expect(u.gps?.speedMs).toBeDefined()
  })

  test('reports the clock but no position while void', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPRMC,123519.00,V,,,,,,,230326,,,N*76\r\n')
    expect(u.gps).toBeUndefined()
  })

  test('carries the date forward to sentences that omit it', () => {
    const d = new NmeaDecoder()
    d.push(`${RMC_FIX}\r\n`)
    const [u] = d.push('$GPRMC,123520.00,A,4807.038,N,01131.000,E,022.4,084.4,,,,A*57\r\n')
    expect(u.receiverTime).toBe(Date.UTC(2026, 2, 23, 12, 35, 20))
  })

  test('reports no clock before any date has been seen', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,,,,A*5D\r\n')
    expect(u.receiverTime).toBeUndefined()
    expect(u.gps?.lat).toBeCloseTo(48.1173, 4)
  })

  test('ignores a void sentence with an unusable position', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GNRMC,,V,,,,,,,,,,N,V*37\r\n')
    expect(u.gps).toBeUndefined()
    expect(u.receiverTime).toBeUndefined()
  })
})

describe('NmeaDecoder — GSA', () => {
  test('decodes the 3D mode and DOP values', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39\r\n')
    expect(u.fixMode).toBe('3d')
    expect(u.pdop).toBe(2.5)
    expect(u.hdop).toBe(1.3)
    expect(u.vdop).toBe(2.1)
  })

  test('maps mode 2 and 1 to 2d and none', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GPGSA,A,2,04,,,,,,,,,,,,2.5,1.3,2.1*31\r\n')[0].fixMode).toBe('2d')
    expect(d.push('$GNGSA,A,1,,,,,,,,,,,,,99.99,99.99,99.99,1*33\r\n')[0].fixMode).toBe('none')
  })

  test('marks the satellites carrying the fix as used', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,70,050,45,05,44,120,40*7E\r\n')
    d.push('$GPGSA,A,3,04,,,,,,,,,,,,2.5,1.3,2.1*30\r\n')
    const sats = d.satellitesInView()
    expect(sats.find((s) => s.id === 4)?.used).toBe(true)
    expect(sats.find((s) => s.id === 5)?.used).toBe(false)
  })
})

describe('NmeaDecoder — GSV', () => {
  test('publishes a constellation only once its sweep completes', () => {
    const d = new NmeaDecoder()
    const first = d.push('$GPGSV,2,1,05,04,70,050,45,05,44,120,40,09,30,200,38,12,20,290,33*73\r\n')
    expect(first).toEqual([])
    expect(d.satellitesInView()).toEqual([])

    const second = d.push('$GPGSV,2,2,05,24,10,330,28*41\r\n')
    expect(second[0]?.satellitesVisible).toBe(5)
    expect(d.satellitesInView()).toHaveLength(5)
  })

  test('separates constellations by talker id', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,01,04,70,050,45*4F\r\n')
    d.push('$GLGSV,1,1,01,68,40,100,42*59\r\n')
    d.push('$GAGSV,1,1,01,07,60,100,44*59\r\n')
    d.push('$GBGSV,1,1,01,21,50,150,40*5C\r\n')
    const byConstellation = d.satellitesInView().map((s) => s.constellation)
    expect(new Set(byConstellation)).toEqual(new Set(['gps', 'glonass', 'galileo', 'beidou']))
  })

  test('decodes elevation, azimuth and SNR', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,01,04,70,050,45*4F\r\n')
    const [sat] = d.satellitesInView()
    expect(sat).toMatchObject({ id: 4, elevation: 70, azimuth: 50, snr: 45 })
  })

  test('keeps the strongest signal when a satellite repeats across bands', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,70,050,30,04,70,050,48*74\r\n')
    const sats = d.satellitesInView()
    expect(sats).toHaveLength(1)
    expect(sats[0].snr).toBe(48)
  })

  test('an empty sweep clears that constellation', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,01,04,70,050,45*4F\r\n')
    expect(d.satellitesInView()).toHaveLength(1)
    d.push('$GPGSV,1,1,00,1*64\r\n')
    expect(d.satellitesInView()).toEqual([])
  })

  test('maps an unrecognised talker to unknown', () => {
    const d = new NmeaDecoder()
    d.push('$XXGSV,1,1,01,04,70,050,45*58\r\n')
    expect(d.satellitesInView()[0]?.constellation).toBe('unknown')
  })

  test('ignores a sweep header without counts', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GPGSV,,,01,04,70,050,45*4F\r\n')).toEqual([])
  })

  test('tolerates a satellite block with missing fields', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,,,,05,44,120,40*4D\r\n')
    const sats = d.satellitesInView()
    expect(sats.find((s) => s.id === 4)?.snr).toBeUndefined()
    expect(sats.find((s) => s.id === 5)?.snr).toBe(40)
  })

  test('restarts the sweep when a new first sentence arrives', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,2,1,05,04,70,050,45*48\r\n')
    d.push('$GPGSV,2,1,02,09,30,200,38*4B\r\n')
    d.push('$GPGSV,2,2,02,12,20,290,33*41\r\n')
    const ids = d.satellitesInView().map((s) => s.id)
    expect(ids).toEqual([9, 12])
  })
})

describe('NmeaDecoder — GST', () => {
  test('combines the per-axis errors into a horizontal accuracy', () => {
    const d = new NmeaDecoder()
    const [u] = d.push('$GPGST,123519.00,1.5,,,,3.0,4.0,2.0*750\r\n')
    expect(u?.gps?.accuracyM).toBeCloseTo(5, 5)
  })

  test('ignores a sentence without error estimates', () => {
    const d = new NmeaDecoder()
    expect(d.push('$GPGST,123519.00,1.5,,,,,,*5E\r\n')).toEqual([])
  })
})

describe('NmeaDecoder — malformed input', () => {
  const d = () => new NmeaDecoder()

  test('decode accepts a sentence without the leading dollar', () => {
    expect(
      d().decode('GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*69')?.fixQuality
    ).toBe('gps')
  })

  test('GGA without a fix-quality field reports none', () => {
    const [u] = d().push('$GPGGA,123519.00,4807.038,N,01131.000,E,,,,,M,,M,,*4C\r\n')
    expect(u.fixQuality).toBe('none')
    expect(u.satellitesUsed).toBeUndefined()
    expect(u.hdop).toBeUndefined()
  })

  test('GGA with a fix but no altitude or satellite count', () => {
    const [u] = d().push('$GPGGA,123519.00,4807.038,N,01131.000,E,1,,,,M,,M,,*7D\r\n')
    expect(u.gps).toMatchObject({ lat: expect.any(Number) })
    expect(u.gps?.alt).toBeUndefined()
    expect(u.gps?.satellites).toBeUndefined()
  })

  test('an active RMC without a usable position yields no fix', () => {
    const [u] = d().push('$GPRMC,123519.00,A,,,,,022.4,084.4,230326,,,A*62\r\n')
    expect(u.gps).toBeUndefined()
    expect(u.receiverTime).toBeDefined()
  })

  test('an active RMC without speed keeps the position', () => {
    const [u] = d().push('$GPRMC,123519.00,A,4807.038,N,01131.000,E,,,230326,,,A*57\r\n')
    expect(u.gps?.lat).toBeCloseTo(48.1173, 3)
    expect(u.gps?.speedMs).toBeUndefined()
    expect(u.gps?.heading).toBeUndefined()
  })

  test('GSA without DOP values reports only the mode', () => {
    const [u] = d().push('$GPGSA,A,3,04,,,,,,,,,,,,,,*18\r\n')
    expect(u.fixMode).toBe('3d')
    expect(u.pdop).toBeUndefined()
    expect(u.hdop).toBeUndefined()
    expect(u.vdop).toBeUndefined()
  })

  test('a GSV continuation without a preceding first sentence still completes', () => {
    const dec = d()
    const [u] = dec.push('$GPGSV,2,2,02,24,10,330,28*46\r\n')
    expect(u.satellitesVisible).toBe(1)
  })

  test('a GSV block with an empty satellite id is skipped', () => {
    const dec = d()
    dec.push('$GPGSV,1,1,02,,,,,05,44,120,40*49\r\n')
    expect(dec.satellitesInView().map((s) => s.id)).toEqual([5])
  })

  test('a repeated satellite without SNR does not displace the stronger entry', () => {
    const dec = d()
    dec.push('$GPGSV,1,1,02,04,70,050,45,04,70,050,*7A\r\n')
    expect(dec.satellitesInView()[0].snr).toBe(45)
  })

  test('non-numeric fields are treated as absent', () => {
    const [u] = d().push('$GPGGA,123519.00,abc,N,def,E,1,xx,yy,zz,M,,M,,*48\r\n')
    expect(u.gps).toBeUndefined()
    expect(u.hdop).toBeUndefined()
  })

  test('a coordinate that cannot be parsed yields no position', () => {
    const [u] = d().push('$GPGGA,123519.00,9e999,N,01131.000,E,1,08,0.9,545.4,M,,M,,*07\r\n')
    expect(u.gps).toBeUndefined()
  })

  test('a non-numeric date yields no receiver clock', () => {
    const [u] = d().push('$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,abcdef,,,A*5A\r\n')
    expect(u.receiverTime).toBeUndefined()
  })
})

describe('NmeaDecoder — repeated satellite keeps the stronger signal', () => {
  test('a weaker repeat does not replace the first entry', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,70,050,48,04,70,050,30*74\r\n')
    const sats = d.satellitesInView()
    expect(sats).toHaveLength(1)
    expect(sats[0].snr).toBe(48)
  })

  test('an equally strong repeat leaves the first entry in place', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,70,050,40,04,10,200,40*7A\r\n')
    const sats = d.satellitesInView()
    expect(sats).toHaveLength(1)
    expect(sats[0].elevation).toBe(70)
  })

  test('a repeat with a signal replaces an entry that had none', () => {
    const d = new NmeaDecoder()
    d.push('$GPGSV,1,1,02,04,70,050,,04,10,200,40*7E\r\n')
    const sats = d.satellitesInView()
    expect(sats).toHaveLength(1)
    expect(sats[0].snr).toBe(40)
    expect(sats[0].elevation).toBe(10)
  })
})
