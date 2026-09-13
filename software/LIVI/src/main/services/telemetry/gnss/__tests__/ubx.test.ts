import {
  buildUbx,
  parseMonRf,
  parseMonVer,
  pollMonRf,
  pollMonVer,
  UBX_CLASS_MON,
  UBX_ID_MON_RF,
  UBX_ID_MON_VER,
  UbxParser,
  ubxChecksum
} from '../ubx'

/** 30-byte zero-padded extension field, as MON-VER lays them out. */
function field(text: string, size: number): Buffer {
  const buf = Buffer.alloc(size)
  buf.write(text, 'latin1')
  return buf
}

// Rebuilt from the MON-VER answer of the NEO-M9N on the Pi 5
const REAL_MON_VER = Buffer.concat([
  field('ROM CORE 4.04 (d964f4)', 30),
  field('00190000', 10),
  field('FWVER=SPG 4.04', 30),
  field('PROTVER=32.01', 30),
  field('GPS;GLO;GAL;BDS', 30),
  field('SBAS;QZSS', 30)
])

describe('ubxChecksum', () => {
  test('matches the known MON-VER poll trailer', () => {
    expect(ubxChecksum(Buffer.from([0x0a, 0x04, 0x00, 0x00]))).toEqual([0x0e, 0x34])
  })

  test('wraps at 8 bits', () => {
    const [a, b] = ubxChecksum(Buffer.from([0xff, 0xff, 0xff]))
    expect(a).toBeLessThanOrEqual(0xff)
    expect(b).toBeLessThanOrEqual(0xff)
  })
})

describe('buildUbx / pollMonVer', () => {
  test('builds the byte-exact MON-VER poll', () => {
    expect(pollMonVer().toString('hex')).toBe('b5620a0400000e34')
  })

  test('encodes the payload length little-endian', () => {
    const frame = buildUbx(0x06, 0x01, Buffer.alloc(300))
    expect(frame.readUInt16LE(4)).toBe(300)
    expect(frame.length).toBe(300 + 8)
  })
})

describe('UbxParser', () => {
  test('extracts a frame from a clean stream', () => {
    const p = new UbxParser()
    const frames = p.push(buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, REAL_MON_VER))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ cls: UBX_CLASS_MON, id: UBX_ID_MON_VER })
  })

  test('finds a frame embedded between NMEA sentences', () => {
    const p = new UbxParser()
    const stream = Buffer.concat([
      Buffer.from('$GNRMC,,V,,,,,,,,,,N,V*37\r\n', 'latin1'),
      buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, REAL_MON_VER),
      Buffer.from('$GNGGA,,,,,,0,00,99.99,,,,,,*56\r\n', 'latin1')
    ])
    expect(p.push(stream)).toHaveLength(1)
  })

  test('reassembles a frame split across three reads', () => {
    const p = new UbxParser()
    const frame = buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, REAL_MON_VER)
    expect(p.push(frame.subarray(0, 5))).toEqual([])
    expect(p.push(frame.subarray(5, 100))).toEqual([])
    const done = p.push(frame.subarray(100))
    expect(done).toHaveLength(1)
    expect(done[0].payload.equals(REAL_MON_VER)).toBe(true)
  })

  test('survives a split directly between the two sync bytes', () => {
    const p = new UbxParser()
    const frame = buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, Buffer.from([1, 2, 3]))
    expect(p.push(frame.subarray(0, 1))).toEqual([])
    expect(p.push(frame.subarray(1))).toHaveLength(1)
  })

  test('drops a frame with a bad checksum and recovers on the next one', () => {
    const p = new UbxParser()
    const bad = buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, Buffer.from([1, 2, 3]))
    bad[bad.length - 1] ^= 0xff
    const good = buildUbx(UBX_CLASS_MON, UBX_ID_MON_VER, Buffer.from([4, 5, 6]))
    const frames = p.push(Buffer.concat([bad, good]))
    expect(frames).toHaveLength(1)
    expect(frames[0].payload.equals(Buffer.from([4, 5, 6]))).toBe(true)
  })

  test('skips a lone sync byte that is not followed by the second', () => {
    const p = new UbxParser()
    const frames = p.push(
      Buffer.concat([Buffer.from([0xb5, 0x00, 0xb5, 0x01]), buildUbx(0x0a, 0x04, Buffer.alloc(0))])
    )
    expect(frames).toHaveLength(1)
  })

  test('rejects an absurd length instead of waiting forever', () => {
    const p = new UbxParser()
    const fake = Buffer.from([0xb5, 0x62, 0x0a, 0x04, 0xff, 0xff, 0x00, 0x00])
    const good = buildUbx(0x0a, 0x04, Buffer.from([9]))
    expect(p.push(Buffer.concat([fake, good]))).toHaveLength(1)
  })

  test('bounds the buffer when only NMEA ever arrives', () => {
    const p = new UbxParser()
    p.push(Buffer.from('$GNRMC,,V,,,,,,,,,,N,V*37\r\n'.repeat(500), 'latin1'))
    // Still able to pick up a frame afterwards, so the trim left the parser working
    expect(p.push(buildUbx(0x0a, 0x04, Buffer.from([1])))).toHaveLength(1)
  })
})

describe('parseMonVer', () => {
  test('decodes the receiver identity from the real answer', () => {
    expect(parseMonVer(REAL_MON_VER)).toEqual({
      software: 'ROM CORE 4.04 (d964f4)',
      hardware: '00190000',
      firmware: 'SPG 4.04',
      protocol: '32.01',
      supported: ['GPS', 'GLO', 'GAL', 'BDS', 'SBAS', 'QZSS']
    })
  })

  test('picks up a module name when the receiver reports one', () => {
    const payload = Buffer.concat([
      field('ROM CORE 4.04', 30),
      field('00190000', 10),
      field('MOD=NEO-M9N', 30)
    ])
    expect(parseMonVer(payload)?.model).toBe('NEO-M9N')
  })

  test('ignores extension strings it does not recognise', () => {
    const payload = Buffer.concat([
      field('ROM CORE 4.04', 30),
      field('00190000', 10),
      field('some vendor note', 30),
      field('', 30)
    ])
    const version = parseMonVer(payload)
    expect(version?.supported).toBeUndefined()
    expect(version?.software).toBe('ROM CORE 4.04')
  })

  test('returns null for a payload that is too short to be MON-VER', () => {
    expect(parseMonVer(Buffer.alloc(20))).toBeNull()
  })

  test('tolerates a trailing partial extension block', () => {
    const payload = Buffer.concat([field('ROM', 30), field('HW', 10), Buffer.alloc(12)])
    expect(parseMonVer(payload)?.software).toBe('ROM')
  })
})

describe('parseMonVer — field without a terminator', () => {
  test('reads a field that fills its slot completely', () => {
    const software = 'A'.repeat(30)
    const payload = Buffer.concat([Buffer.from(software, 'latin1'), field('00190000', 10)])
    expect(parseMonVer(payload)?.software).toBe(software)
  })
})

/** MON-RF payload: 4-byte header plus one 24-byte block. */
function monRfPayload(over: Partial<Record<string, number>> = {}): Buffer {
  const buf = Buffer.alloc(4 + 24)
  buf[0] = 0 // version
  buf[1] = 1 // one block
  const b = buf.subarray(4)
  b[0] = 0
  b[1] = over.jamming ?? 1
  b[2] = over.antStatus ?? 2
  b[3] = over.antPower ?? 1
  b.writeUInt16LE(over.noise ?? 87, 12)
  b.writeUInt16LE(over.agc ?? 4321, 14)
  b[16] = over.jamInd ?? 12
  return buf
}

describe('pollMonRf', () => {
  test('builds a zero-length MON-RF poll', () => {
    const frame = pollMonRf()
    expect(frame[2]).toBe(UBX_CLASS_MON)
    expect(frame[3]).toBe(UBX_ID_MON_RF)
    expect(frame.readUInt16LE(4)).toBe(0)
  })
})

describe('parseMonRf', () => {
  test('decodes the antenna supervisor and RF levels', () => {
    expect(parseMonRf(monRfPayload())).toEqual({
      antennaStatus: 'ok',
      antennaPower: 'on',
      jamming: 'ok',
      jammingIndicator: 12,
      agc: 4321,
      noise: 87
    })
  })

  test.each([
    [0, 'init'],
    [1, 'unknown'],
    [2, 'ok'],
    [3, 'short'],
    [4, 'open']
  ])('maps antenna status %i to %s', (raw, expected) => {
    expect(parseMonRf(monRfPayload({ antStatus: raw }))?.antennaStatus).toBe(expected)
  })

  test.each([
    [0, 'off'],
    [1, 'on'],
    [2, 'unknown']
  ])('maps antenna power %i to %s', (raw, expected) => {
    expect(parseMonRf(monRfPayload({ antPower: raw }))?.antennaPower).toBe(expected)
  })

  test.each([
    [0, 'unknown'],
    [1, 'ok'],
    [2, 'warning'],
    [3, 'critical']
  ])('maps jamming state %i to %s', (raw, expected) => {
    expect(parseMonRf(monRfPayload({ jamming: raw }))?.jamming).toBe(expected)
  })

  test('reads only the low two bits for the jamming state', () => {
    expect(parseMonRf(monRfPayload({ jamming: 0xfe }))?.jamming).toBe('warning')
  })

  test('falls back to unknown for values outside the tables', () => {
    const rf = parseMonRf(monRfPayload({ antStatus: 9, antPower: 9 }))
    expect(rf?.antennaStatus).toBe('unknown')
    expect(rf?.antennaPower).toBe('unknown')
  })

  test('returns null for a payload without a full block', () => {
    expect(parseMonRf(Buffer.alloc(20))).toBeNull()
  })
})
