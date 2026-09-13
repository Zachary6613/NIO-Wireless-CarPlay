import fs from 'node:fs'
import { EMPTY_GNSS_INFO } from '@shared/types/Gnss'
import type { Mock } from 'vitest'
import { GPS_DATA_VERSION, GpsFileWriter } from '../GpsFileWriter'

vi.mock('node:fs', () => ({
  default: { mkdirSync: vi.fn(), writeFileSync: vi.fn() }
}))

const mockedFs = fs as unknown as { mkdirSync: Mock; writeFileSync: Mock }

const written = (): { fix: unknown; receiver: unknown; version: number; ts: number } =>
  JSON.parse(mockedFs.writeFileSync.mock.calls.at(-1)?.[1] as string)

describe('GpsFileWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('writes nothing until the debounce elapses', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 100 })
    w.setFix({ lat: 1, lng: 2 })
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test('collapses a burst of updates into one write', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 100 })
    w.setFix({ lat: 1, lng: 2 })
    w.setInfo({ ...EMPTY_GNSS_INFO, connected: true })
    w.setFix({ lat: 3, lng: 4 })
    vi.advanceTimersByTime(100)
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test('carries the fix and the wider receiver state', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 0 })
    w.setInfo({
      ...EMPTY_GNSS_INFO,
      connected: true,
      satellitesUsed: 7,
      satellitesVisible: 12,
      hdop: 0.8,
      constellations: ['gps', 'galileo']
    })
    w.setFix({ lat: 48.1, lng: 11.5, accuracyM: 2.5 })
    w.flushNow()

    const data = written()
    expect(data.version).toBe(GPS_DATA_VERSION)
    expect(data.fix).toMatchObject({ lat: 48.1, lng: 11.5, accuracyM: 2.5 })
    expect(data.receiver).toMatchObject({
      satellitesUsed: 7,
      satellitesVisible: 12,
      hdop: 0.8,
      constellations: ['gps', 'galileo']
    })
  })

  test('leaves the per-satellite list out of the file', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 0 })
    w.setInfo({
      ...EMPTY_GNSS_INFO,
      satellitesVisible: 1,
      satellites: [{ id: 4, constellation: 'galileo', snr: 44, used: true }]
    })
    w.flushNow()
    expect(written().receiver).not.toHaveProperty('satellites')
  })

  test('merges successive partial fixes', () => {
    const w = new GpsFileWriter('/tmp/gps.json')
    w.setFix({ lat: 1, lng: 2 })
    w.setFix({ alt: 500 })
    w.flushNow()
    expect(written().fix).toMatchObject({ lat: 1, lng: 2, alt: 500 })
  })

  test('creates the directory before writing', () => {
    new GpsFileWriter('/nested/dir/gps.json').flushNow()
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith('/nested/dir', { recursive: true })
  })

  test('writes immediately when asked to on construction', () => {
    new GpsFileWriter('/tmp/gps.json', { writeInitial: true })
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1)
    expect(written().fix).toBeNull()
  })

  test('swallows a failing write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(() => new GpsFileWriter('/tmp/gps.json').flushNow()).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[gpsFile] write failed:', 'disk full')
    warn.mockRestore()
  })

  test('flushNow cancels a pending debounce instead of writing twice', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 100 })
    w.setFix({ lat: 1, lng: 2 })
    w.flushNow()
    vi.advanceTimersByTime(200)
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1)
  })

  test('dispose drops a pending write', () => {
    const w = new GpsFileWriter('/tmp/gps.json', { debounceMs: 100 })
    w.setFix({ lat: 1, lng: 2 })
    w.dispose()
    vi.advanceTimersByTime(200)
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled()
  })

  test('dispose without a pending write is a no-op', () => {
    expect(() => new GpsFileWriter('/tmp/gps.json').dispose()).not.toThrow()
  })

  test('falls back to the userData path when none is given', () => {
    new GpsFileWriter().flushNow()
    expect(mockedFs.writeFileSync.mock.calls[0][0]).toContain('gpsData.json')
  })
})
