import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DebouncedJsonFile } from '../DebouncedJsonFile'

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => os.tmpdir()) } }))

function tmpFile(): string {
  return path.join(os.tmpdir(), `livi-json-${Math.random().toString(36).slice(2)}.json`)
}

describe('DebouncedJsonFile', () => {
  test('writes the snapshot on demand', () => {
    const file = tmpFile()
    new DebouncedJsonFile(() => ({ a: 1 }), { file }).flushNow()
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ a: 1 })
  })

  test('collapses a burst into a single write', async () => {
    const file = tmpFile()
    let calls = 0
    const sink = new DebouncedJsonFile(
      () => {
        calls += 1
        return { calls }
      },
      { file, debounceMs: 5 }
    )
    sink.schedule()
    sink.schedule()
    sink.schedule()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toBe(1)
  })

  test('leaves no temporary file behind', () => {
    const file = tmpFile()
    new DebouncedJsonFile(() => ({ a: 1 }), { file }).flushNow()
    expect(fs.existsSync(`${file}.tmp`)).toBe(false)
  })

  test('cancel drops a pending write', async () => {
    const file = tmpFile()
    const sink = new DebouncedJsonFile(() => ({ a: 1 }), { file, debounceMs: 5 })
    sink.schedule()
    sink.cancel()
    await new Promise((r) => setTimeout(r, 20))
    expect(fs.existsSync(file)).toBe(false)
  })

  test('cancel without a pending write is a no-op', () => {
    expect(() => new DebouncedJsonFile(() => ({}), { file: tmpFile() }).cancel()).not.toThrow()
  })

  test('falls back to userData with the given name', () => {
    const sink = new DebouncedJsonFile(() => ({ a: 1 }), { name: 'fallback-demo.json' })
    sink.flushNow()
    const expected = path.join(os.tmpdir(), 'fallback-demo.json')
    expect(fs.existsSync(expected)).toBe(true)
    fs.rmSync(expected, { force: true })
  })

  test('uses the default name when none is given', () => {
    new DebouncedJsonFile(() => ({ a: 1 })).flushNow()
    const expected = path.join(os.tmpdir(), 'data.json')
    expect(fs.existsSync(expected)).toBe(true)
    fs.rmSync(expected, { force: true })
  })

  test('reports a failing write under the default tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })
    new DebouncedJsonFile(() => ({ a: 1 }), { file: tmpFile() }).flushNow()
    expect(warn).toHaveBeenCalledWith('[jsonFile] write failed:', 'disk full')
    write.mockRestore()
    warn.mockRestore()
  })

  test('reports a failing write under a caller tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full')
    })
    new DebouncedJsonFile(() => ({ a: 1 }), { file: tmpFile(), tag: 'demo' }).flushNow()
    expect(warn).toHaveBeenCalledWith('[demo] write failed:', 'disk full')
    write.mockRestore()
    warn.mockRestore()
  })
})
