import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type { GnssInfo } from '@shared/types/Gnss'
import type { GpsPayload } from '@shared/types/Telemetry'
import type { Mock } from 'vitest'
import { GnssReceiver } from '../GnssReceiver'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    createReadStream: vi.fn(),
    writeFile: vi.fn()
  }
}))

const mockedExecFile = execFile as unknown as Mock
const mockedFs = fs as unknown as {
  existsSync: Mock
  createReadStream: Mock
  writeFile: Mock
}

class FakeStream extends EventEmitter {
  destroy = vi.fn()
}

const GGA = '$GPGGA,123519.00,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*69\r\n'
const RMC = '$GPRMC,123519.00,A,4807.038,N,01131.000,E,022.4,084.4,230326,,,A*5B\r\n'
const GSA = '$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39\r\n'

/** A MON-RF answer: 4-byte header plus one 24-byte block. */
function monRfFrame(antStatus: number, antPower: number): Buffer {
  const payload = Buffer.alloc(28)
  payload[1] = 1
  const b = payload.subarray(4)
  b[1] = 1
  b[2] = antStatus
  b[3] = antPower
  b.writeUInt16LE(87, 12)
  b.writeUInt16LE(4321, 14)
  b[16] = 12
  const body = Buffer.concat([Buffer.from([0x0a, 0x38, payload.length, 0]), payload])
  let a = 0
  let c = 0
  for (const byte of body) {
    a = (a + byte) & 0xff
    c = (c + a) & 0xff
  }
  return Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, c])])
}

/** A MON-VER answer carrying the given firmware string. */
function monVerFrame(firmware: string): Buffer {
  const payload = Buffer.alloc(70)
  payload.write('ROM CORE 4.04', 0, 'latin1')
  payload.write('00190000', 30, 'latin1')
  payload.write(`FWVER=${firmware}`, 40, 'latin1')
  const body = Buffer.concat([Buffer.from([0x0a, 0x04, 70, 0]), payload])
  let a = 0
  let b = 0
  for (const byte of body) {
    a = (a + byte) & 0xff
    b = (b + a) & 0xff
  }
  return Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])])
}

function start(): {
  receiver: GnssReceiver
  stream: FakeStream
  fixes: GpsPayload[]
  infos: GnssInfo[]
} {
  const stream = new FakeStream()
  mockedFs.createReadStream.mockReturnValue(stream)
  const fixes: GpsPayload[] = []
  const infos: GnssInfo[] = []
  const receiver = new GnssReceiver({
    device: '/dev/ttyAMA0',
    baudRate: 38400,
    publishFix: (gps) => fixes.push(gps)
  })
  receiver.on('info', (info: GnssInfo) => infos.push(info))
  receiver.start()
  // stty callback → attaches the read stream
  mockedExecFile.mock.calls[0][2](null)
  return { receiver, stream, fixes, infos }
}

describe('GnssReceiver', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.writeFile.mockImplementation(
      (_p: string, _d: unknown, cb: (e: Error | null) => void) => cb(null)
    )
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  test('sets the line discipline with stty before reading', () => {
    start()
    const [cmd, args] = mockedExecFile.mock.calls[0]
    expect(cmd).toBe('stty')
    expect(args).toEqual(['-F', '/dev/ttyAMA0', '38400', 'raw', '-echo', '-crtscts'])
  })

  test('is not connected while the port is open but silent', () => {
    const { receiver } = start()
    expect(receiver.info().connected).toBe(false)
  })

  test('reports connected once the first bytes arrive', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(receiver.info().connected).toBe(true)
  })

  test('drops back to disconnected when the receiver goes silent', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    vi.advanceTimersByTime(10_000)
    expect(receiver.info().connected).toBe(false)
  })

  test('does not poll the identity before the receiver speaks', () => {
    start()
    expect(mockedFs.writeFile).not.toHaveBeenCalled()
  })

  test('polls the identity on the first bytes, even long after opening', () => {
    const { stream } = start()
    vi.advanceTimersByTime(120_000)
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(mockedFs.writeFile.mock.calls[0][1].toString('hex')).toBe('b5620a0400000e34')
  })

  test('warns when the identity poll cannot be written', () => {
    mockedFs.writeFile.mockImplementation((_p: string, _d: unknown, cb: (e: Error) => void) =>
      cb(new Error('EIO'))
    )
    const { stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('version poll failed'))
  })

  test('publishes a decoded fix', () => {
    const { stream, fixes } = start()
    stream.emit('data', Buffer.from(GGA + RMC, 'latin1'))
    expect(fixes[0]).toMatchObject({ lat: expect.closeTo(48.1173, 3), speedMs: expect.any(Number) })
  })

  test('keeps satellites and DOP in the info snapshot', () => {
    const { stream, receiver } = start()
    stream.emit('data', Buffer.from(`${GGA}${GSA}`, 'latin1'))
    const info = receiver.info()
    expect(info).toMatchObject({ fixQuality: 'gps', fixMode: '3d', satellitesUsed: 8, hdop: 1.3 })
    expect(info.pdop).toBe(2.5)
  })

  test('carries the GST accuracy into later fixes', () => {
    const { stream, fixes } = start()
    stream.emit('data', Buffer.from('$GPGST,123519.00,1.5,,,,3.0,4.0,2.0*75\r\n', 'latin1'))
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(fixes.at(-1)?.accuracyM).toBeCloseTo(5, 5)
  })

  test('fix() returns the merged last fix with its accuracy', () => {
    const { stream, receiver } = start()
    stream.emit('data', Buffer.from('$GPGST,123519.00,1.5,,,,3.0,4.0,2.0*75\r\n', 'latin1'))
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(receiver.fix()).toMatchObject({ accuracyM: expect.closeTo(5, 5) })
  })

  test('fix() is undefined before anything decoded', () => {
    const { receiver } = start()
    expect(receiver.fix()).toBeUndefined()
  })

  test('decodes the module identity from a UBX answer', () => {
    const { stream, receiver } = start()
    const payload = Buffer.alloc(100)
    payload.write('ROM CORE 4.04 (d964f4)', 0, 'latin1')
    payload.write('00190000', 30, 'latin1')
    payload.write('FWVER=SPG 4.04', 40, 'latin1')
    payload.write('PROTVER=32.01', 70, 'latin1')
    const head = Buffer.from([0x0a, 0x04, payload.length & 0xff, payload.length >> 8])
    const body = Buffer.concat([head, payload])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    expect(receiver.info().version).toMatchObject({ firmware: 'SPG 4.04', protocol: '32.01' })
  })

  test('throttles info updates while sentences stream in', () => {
    const { stream, infos } = start()
    // The first chunk flips to receiving and emits at once
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const before = infos.length
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(infos.length).toBe(before)
    vi.advanceTimersByTime(1000)
    expect(infos.length).toBe(before + 1)
  })

  test('drops the fix state after the receiver goes quiet', () => {
    const { stream, receiver } = start()
    stream.emit('data', Buffer.from(`${GGA}${GSA}`, 'latin1'))
    expect(receiver.info().fixQuality).toBe('gps')
    vi.advanceTimersByTime(10_000)
    expect(receiver.info()).toMatchObject({
      fixQuality: 'none',
      fixMode: 'none',
      satellitesUsed: 0
    })
  })

  test('a quiet receiver that never had a fix stays silent', () => {
    const { infos } = start()
    const before = infos.length
    vi.advanceTimersByTime(10_000)
    expect(infos.length).toBe(before)
  })

  test('retries when the device is missing', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    expect(receiver.info().error).toContain('not found')
    mockedFs.existsSync.mockReturnValue(true)
    mockedFs.createReadStream.mockReturnValue(new FakeStream())
    vi.advanceTimersByTime(5000)
    expect(mockedExecFile).toHaveBeenCalled()
    receiver.stop()
  })

  test('reports a failing stty', () => {
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    mockedExecFile.mock.calls[0][2](new Error('no such device'))
    expect(receiver.info().error).toContain('stty failed')
    receiver.stop()
  })

  test('ignores the stty result after stop', () => {
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    receiver.stop()
    mockedExecFile.mock.calls[0][2](null)
    expect(mockedFs.createReadStream).not.toHaveBeenCalled()
  })

  test('reports a stream that cannot be opened', () => {
    mockedFs.createReadStream.mockImplementation(() => {
      throw new Error('EACCES')
    })
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    mockedExecFile.mock.calls[0][2](null)
    expect(receiver.info().error).toContain('open failed')
    receiver.stop()
  })

  test('reports a read error and reconnects', () => {
    const { receiver, stream } = start()
    stream.emit('error', new Error('EIO'))
    expect(receiver.info()).toMatchObject({
      connected: false,
      error: expect.stringContaining('EIO')
    })
    receiver.stop()
  })

  test('treats an unexpected close as a disconnect', () => {
    const { receiver, stream } = start()
    stream.emit('close')
    expect(receiver.info().connected).toBe(false)
    receiver.stop()
  })

  test('does not log the same failure twice across retries', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    receiver.stop()
  })

  test('start is idempotent', () => {
    const { receiver } = start()
    receiver.start()
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
  })

  test('stop closes the stream and reports disconnected', () => {
    const { receiver, stream } = start()
    receiver.stop()
    expect(stream.destroy).toHaveBeenCalled()
    expect(receiver.info().connected).toBe(false)
  })

  test('stop on a receiver that never connected is quiet', () => {
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    expect(() => receiver.stop()).not.toThrow()
  })

  test('defaults the device and baud rate', () => {
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    expect(receiver.info()).toMatchObject({ device: '/dev/ttyAMA0', baudRate: 38400 })
  })

  test('reports the receiver clock once RMC carried a date', () => {
    const { stream, receiver } = start()
    stream.emit('data', Buffer.from(RMC, 'latin1'))
    expect(receiver.info().receiverTime).toBe(Date.UTC(2026, 2, 23, 12, 35, 19))
  })

  test('fix() without a GST accuracy returns the plain fix', () => {
    const { stream, receiver } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(receiver.fix()).toMatchObject({ lat: expect.any(Number) })
    expect(receiver.fix()?.accuracyM).toBeUndefined()
  })

  test('a second open attempt while the stream is up is ignored', () => {
    const { receiver } = start()
    ;(receiver as unknown as { open: () => void }).open()
    expect(mockedFs.createReadStream).toHaveBeenCalledTimes(1)
  })

  test('attach after the stream is already up is ignored', () => {
    const { receiver } = start()
    ;(receiver as unknown as { attach: () => void }).attach()
    expect(mockedFs.createReadStream).toHaveBeenCalledTimes(1)
  })

  test('a close from a superseded stream does not disturb the live one', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const stale = new FakeStream()
    stale.emit('close')
    expect(receiver.info().connected).toBe(true)
    stream.destroy.mockClear()
  })

  test('stops polling the identity once it arrived', () => {
    const { stream } = start()
    const payload = Buffer.alloc(40)
    payload.write('ROM CORE 4.04', 0, 'latin1')
    payload.write('00190000', 30, 'latin1')
    const body = Buffer.concat([Buffer.from([0x0a, 0x04, 40, 0]), payload])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    const polls = mockedFs.writeFile.mock.calls.length
    vi.advanceTimersByTime(10_000)
    expect(mockedFs.writeFile.mock.calls.length).toBe(polls)
  })

  test('gives up polling the identity after the attempt cap', () => {
    start()
    vi.advanceTimersByTime(30_000)
    expect(mockedFs.writeFile.mock.calls.length).toBeLessThanOrEqual(5)
  })

  test('ignores a UBX frame that is not the version answer', () => {
    const { stream, receiver } = start()
    const body = Buffer.from([0x01, 0x07, 0x00, 0x00])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    expect(receiver.info().version).toBeUndefined()
  })

  test('names the module in the log when it reports one', () => {
    const { stream } = start()
    const payload = Buffer.alloc(70)
    payload.write('ROM CORE 4.04', 0, 'latin1')
    payload.write('00190000', 30, 'latin1')
    payload.write('MOD=NEO-M9N', 40, 'latin1')
    const body = Buffer.concat([Buffer.from([0x0a, 0x04, 70, 0]), payload])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('NEO-M9N'))
  })

  test('a failure while a retry is already pending does not stack timers', () => {
    mockedFs.existsSync.mockReturnValue(false)
    const receiver = new GnssReceiver({ publishFix: vi.fn() })
    receiver.start()
    ;(receiver as unknown as { fail: (r: string) => void }).fail('again')
    vi.advanceTimersByTime(5000)
    expect(mockedExecFile).not.toHaveBeenCalled()
    receiver.stop()
  })

  test('a close from a stream that was already replaced is ignored', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const internal = receiver as unknown as { stream: unknown }
    internal.stream = new FakeStream()
    stream.emit('close')
    expect(receiver.info().connected).toBe(true)
    receiver.stop()
  })

  test('ignores a MON-VER answer too short to parse', () => {
    const { stream, receiver } = start()
    const body = Buffer.concat([Buffer.from([0x0a, 0x04, 8, 0]), Buffer.alloc(8)])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    expect(receiver.info().version).toBeUndefined()
  })

  test('logs a receiver that reports neither model nor software', () => {
    const { stream } = start()
    const payload = Buffer.alloc(40)
    const body = Buffer.concat([Buffer.from([0x0a, 0x04, 40, 0]), payload])
    let a = 0
    let b = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      b = (b + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, b])]))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('receiver'))
  })

  test('unplug and replug: disconnects, then reconnects and re-queries the identity', () => {
    const { receiver, stream } = start()

    // plugged in: data flows, identity gets polled and answered
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(receiver.info().connected).toBe(true)
    stream.emit('data', monVerFrame('SPG 4.04'))
    expect(receiver.info().version?.firmware).toBe('SPG 4.04')

    // unplugged: silence
    vi.advanceTimersByTime(10_000)
    expect(receiver.info().connected).toBe(false)
    expect(receiver.info().version).toBeUndefined()

    // plugged back in: connected again and the identity is asked for anew
    mockedFs.writeFile.mockClear()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    expect(receiver.info().connected).toBe(true)
    expect(mockedFs.writeFile.mock.calls[0][1].toString('hex')).toBe('b5620a0400000e34')

    stream.emit('data', monVerFrame('SPG 5.10'))
    expect(receiver.info().version?.firmware).toBe('SPG 5.10')
  })

  test('polls the RF front end on first contact and decodes the answer', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))

    const polled = mockedFs.writeFile.mock.calls.map((c) => (c[1] as Buffer).toString('hex'))
    expect(polled).toContain('b5620a38000042d0')

    stream.emit('data', monRfFrame(4, 0))
    expect(receiver.info().rf).toEqual({
      antennaStatus: 'open',
      antennaPower: 'off',
      jamming: 'ok',
      jammingIndicator: 12,
      agc: 4321,
      noise: 87
    })
  })

  test('re-reads the RF front end while the receiver keeps talking', () => {
    const { stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const before = mockedFs.writeFile.mock.calls.length
    vi.advanceTimersByTime(10_000)
    expect(mockedFs.writeFile.mock.calls.length).toBeGreaterThan(before)
  })

  test('ignores a MON-RF answer without a full block', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const body = Buffer.concat([Buffer.from([0x0a, 0x38, 8, 0]), Buffer.alloc(8)])
    let a = 0
    let c = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      c = (c + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, c])]))
    expect(receiver.info().rf).toBeUndefined()
  })

  test('forgets the RF state when the receiver goes silent', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    stream.emit('data', monRfFrame(2, 1))
    expect(receiver.info().rf).toBeDefined()
    vi.advanceTimersByTime(10_000)
    expect(receiver.info().rf).toBeUndefined()
  })

  test('stops re-reading the RF front end after stop', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    receiver.stop()
    const before = mockedFs.writeFile.mock.calls.length
    vi.advanceTimersByTime(30_000)
    expect(mockedFs.writeFile.mock.calls.length).toBe(before)
  })

  test('ignores a MON frame that is neither the identity nor the RF answer', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    const body = Buffer.from([0x0a, 0x09, 0x00, 0x00])
    let a = 0
    let c = 0
    for (const byte of body) {
      a = (a + byte) & 0xff
      c = (c + a) & 0xff
    }
    stream.emit('data', Buffer.concat([Buffer.from([0xb5, 0x62]), body, Buffer.from([a, c])]))
    expect(receiver.info().rf).toBeUndefined()
    expect(receiver.info().version).toBeUndefined()
  })

  test('an RF poll scheduled past stop does nothing', () => {
    const { receiver, stream } = start()
    stream.emit('data', Buffer.from(GGA, 'latin1'))
    receiver.stop()
    mockedFs.writeFile.mockClear()
    ;(receiver as unknown as { askRf: () => void }).askRf()
    expect(mockedFs.writeFile).not.toHaveBeenCalled()
  })
})
