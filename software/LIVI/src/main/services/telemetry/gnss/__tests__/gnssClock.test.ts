import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { GnssInfo } from '@shared/types/Gnss'
import { EMPTY_GNSS_INFO } from '@shared/types/Gnss'
import type { Mock } from 'vitest'
import { GnssClock, isTimeSourceTrustworthy } from '../gnssClock'

vi.mock('node:child_process', () => ({ execFile: vi.fn() }))
vi.mock('node:fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true)
  }
}))

const mockedExecFile = execFile as unknown as Mock
const mockedFs = fs as unknown as {
  writeFileSync: Mock
  rmSync: Mock
  existsSync: Mock
}

const NOW = 1_800_000_000_000

function goodFix(over: Partial<GnssInfo> = {}): GnssInfo {
  return {
    ...EMPTY_GNSS_INFO,
    connected: true,
    fixMode: '3d',
    fixQuality: 'gps',
    satellitesUsed: 8,
    hdop: 0.9,
    receiverTime: NOW,
    ...over
  }
}

describe('isTimeSourceTrustworthy', () => {
  test('accepts a 3D fix on enough satellites with usable geometry', () => {
    expect(isTimeSourceTrustworthy(goodFix())).toBe(true)
  })

  test('accepts a fix that reports no HDOP at all', () => {
    expect(isTimeSourceTrustworthy(goodFix({ hdop: undefined }))).toBe(true)
  })

  test.each([
    ['no receiver clock', { receiverTime: undefined }],
    ['only a 2D fix', { fixMode: '2d' as const }],
    ['too few satellites', { satellitesUsed: 3 }],
    ['poor geometry', { hdop: 9 }]
  ])('rejects %s', (_label, over) => {
    expect(isTimeSourceTrustworthy(goodFix(over))).toBe(false)
  })
})

describe('GnssClock', () => {
  let now = NOW
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>

  const make = (): GnssClock =>
    new GnssClock({ now: () => now, claimFile: '/tmp/claim', helper: '/helper.sh' })

  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks keeps implementations, so throwing stubs would leak between tests
    mockedFs.writeFileSync.mockImplementation(() => {})
    mockedFs.rmSync.mockImplementation(() => {})
    mockedFs.existsSync.mockReturnValue(true)
    now = NOW
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    logSpy.mockRestore()
  })

  test('claims the clock while the fix is trustworthy', () => {
    make().update(goodFix())
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith('/tmp/claim', `${NOW}\n`)
  })

  test('does not rewrite the claim on every update', () => {
    const clock = make()
    clock.update(goodFix())
    now += 1000
    clock.update(goodFix())
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test('refreshes the claim once it ages', () => {
    const clock = make()
    clock.update(goodFix())
    now += 31_000
    clock.update(goodFix())
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(2)
  })

  test('leaves the clock alone while the drift is small', () => {
    make().update(goodFix({ receiverTime: NOW + 1500 }))
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  test('steps the clock through the root helper on real drift', () => {
    make().update(goodFix({ receiverTime: NOW + 60_000 }))
    const [cmd, args] = mockedExecFile.mock.calls[0]
    expect(cmd).toBe('sudo')
    expect(args).toEqual(['-n', '/helper.sh', String(Math.round((NOW + 60_000) / 1000))])
  })

  test('logs the step once the helper succeeds', () => {
    make().update(goodFix({ receiverTime: NOW + 60_000 }))
    mockedExecFile.mock.calls[0][2](null)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('stepped by 60.0s'))
  })

  test('warns when the helper fails', () => {
    make().update(goodFix({ receiverTime: NOW + 60_000 }))
    mockedExecFile.mock.calls[0][2](new Error('not permitted'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed'), 'not permitted')
  })

  test('does not step again inside the cool-down', () => {
    const clock = make()
    clock.update(goodFix({ receiverTime: NOW + 60_000 }))
    now += 5_000
    clock.update(goodFix({ receiverTime: now + 60_000 }))
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
  })

  test('steps again once the cool-down passes', () => {
    const clock = make()
    clock.update(goodFix({ receiverTime: NOW + 60_000 }))
    now += 61_000
    clock.update(goodFix({ receiverTime: now + 60_000 }))
    expect(mockedExecFile).toHaveBeenCalledTimes(2)
  })

  test('points at the installer when the helper is missing', () => {
    mockedFs.existsSync.mockReturnValue(false)
    make().update(goodFix({ receiverTime: NOW + 60_000 }))
    expect(mockedExecFile).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('re-run the installer'))
  })

  test('drops the claim when the fix stops being trustworthy', () => {
    const clock = make()
    clock.update(goodFix())
    clock.update(goodFix({ fixMode: 'none' }))
    expect(mockedFs.rmSync).toHaveBeenCalledWith('/tmp/claim', { force: true })
  })

  test('release without a claim touches nothing', () => {
    make().release()
    expect(mockedFs.rmSync).not.toHaveBeenCalled()
  })

  test('a failing claim removal is not fatal', () => {
    mockedFs.rmSync.mockImplementation(() => {
      throw new Error('busy')
    })
    const clock = make()
    clock.update(goodFix())
    expect(() => clock.release()).not.toThrow()
  })

  test('warns when the claim cannot be written', () => {
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error('read-only fs')
    })
    make().update(goodFix())
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('could not claim'), 'read-only fs')
  })

  test('a plainly wrong clock is corrected from satellite time alone', () => {
    // No fix yet: the receiver has decoded time but cannot place itself
    const noFix = goodFix({ fixMode: 'none', satellitesUsed: 0, receiverTime: NOW + 3_600_000 })
    make().update(noFix)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'sudo',
      ['-n', '/helper.sh', String(Math.round((NOW + 3_600_000) / 1000))],
      expect.any(Function)
    )
  })

  test('a small drift without a lock is left alone', () => {
    make().update(goodFix({ fixMode: 'none', satellitesUsed: 0, receiverTime: NOW + 10_000 }))
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  test('without a lock the clock is not claimed, so CarPlay may still step', () => {
    make().update(goodFix({ fixMode: 'none', satellitesUsed: 0, receiverTime: NOW + 3_600_000 }))
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
  })

  test('a receiver without a clock releases the claim', () => {
    const clock = make()
    clock.update(goodFix())
    mockedFs.rmSync.mockClear()
    clock.update(goodFix({ receiverTime: undefined }))
    expect(mockedFs.rmSync).toHaveBeenCalledWith('/tmp/claim', { force: true })
  })
})
