import type { PanelGeometry } from '../panelEdid'

const readFileSyncMock = vi.fn()
const readdirSyncMock = vi.fn()

vi.mock('node:fs', () => ({
  default: {
    readFileSync: (...args: unknown[]) => readFileSyncMock(...args),
    readdirSync: (...args: unknown[]) => readdirSyncMock(...args)
  }
}))

const makeEdid = (opts?: {
  widthMm?: number
  heightMm?: number
  widthPx?: number
  heightPx?: number
  emptyDtd?: boolean
  short?: boolean
}) => {
  if (opts?.short) return Buffer.alloc(64)
  const buf = Buffer.alloc(128)
  if (opts?.emptyDtd) return buf
  const widthMm = opts?.widthMm ?? 400
  const heightMm = opts?.heightMm ?? 234
  const widthPx = opts?.widthPx ?? 400
  const heightPx = opts?.heightPx ?? 234
  const dtd = buf.subarray(0x36, 0x48)
  dtd.writeUInt16LE(813, 0)
  dtd[2] = widthPx & 0xff
  dtd[4] = ((widthPx >> 4) & 0xf0) | 0
  dtd[5] = heightPx & 0xff
  dtd[7] = ((heightPx >> 4) & 0xf0) | 0
  dtd[12] = widthMm & 0xff
  dtd[13] = heightMm & 0xff
  dtd[14] = (((widthMm >> 8) & 0x0f) << 4) | ((heightMm >> 8) & 0x0f)
  return buf
}

const originalPlatform = process.platform

const loadModule = async () => {
  vi.resetModules()
  return await import('../panelEdid')
}

describe('edidPanelGeometry', () => {
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  test('parses physical size and native resolution from the first DTD', async () => {
    const { edidPanelGeometry } = await loadModule()
    expect(edidPanelGeometry(makeEdid())).toEqual({
      widthMm: 400,
      heightMm: 234,
      widthPx: 400,
      heightPx: 234
    } satisfies PanelGeometry)
  })

  test('rejects blobs shorter than one EDID block', async () => {
    const { edidPanelGeometry } = await loadModule()
    expect(edidPanelGeometry(makeEdid({ short: true }))).toBeNull()
  })

  test('rejects an empty first DTD', async () => {
    const { edidPanelGeometry } = await loadModule()
    expect(edidPanelGeometry(makeEdid({ emptyDtd: true }))).toBeNull()
  })

  test('rejects zero-sized dimensions', async () => {
    const { edidPanelGeometry } = await loadModule()
    expect(edidPanelGeometry(makeEdid({ widthMm: 0 }))).toBeNull()
    expect(edidPanelGeometry(makeEdid({ heightMm: 0 }))).toBeNull()
    expect(edidPanelGeometry(makeEdid({ widthPx: 0 }))).toBeNull()
    expect(edidPanelGeometry(makeEdid({ heightPx: 0 }))).toBeNull()
  })
})

describe('sysfsPanelGeometry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  test('returns null off Linux without touching the filesystem', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toBeNull()
    expect(readFileSyncMock).not.toHaveBeenCalled()
  })

  test('reads the forced-EDID connector from the kernel cmdline', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'quiet drm.edid_firmware=HDMI-A-1:edid/livi.edid'
      if (path === '/sys/class/drm/card0-HDMI-A-1/status') return 'connected\n'
      if (path === '/sys/class/drm/card0-HDMI-A-1/edid') return makeEdid()
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card0-HDMI-A-1', 'card0-HDMI-A-2', 'version'])
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toEqual({
      widthMm: 400,
      heightMm: 234,
      widthPx: 400,
      heightPx: 234
    })
  })

  test('falls back to the single connected connector without a forced EDID', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'quiet splash'
      if (path === '/sys/class/drm/card1-DSI-1/status') return 'connected'
      if (path === '/sys/class/drm/card1-DSI-2/status') throw new Error('no status')
      if (path === '/sys/class/drm/card1-DSI-1/edid') return makeEdid()
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card1-DSI-1', 'card1-DSI-2'])
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toEqual(expect.objectContaining({ widthMm: 400, heightMm: 234 }))
  })

  test('stays null when several connectors are connected and none is forced', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'quiet'
      if (path.endsWith('/status')) return 'connected'
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card0-HDMI-A-1', 'card0-DSI-1'])
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toBeNull()
  })

  test('stays null when the picked connector has no parsable EDID', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'quiet'
      if (path.endsWith('/status')) return 'connected'
      if (path.endsWith('/edid')) return makeEdid({ emptyDtd: true })
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card0-DSI-1'])
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toBeNull()
  })

  test('caches the first result and skips later filesystem reads', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'quiet'
      if (path.endsWith('/status')) return 'connected'
      if (path.endsWith('/edid')) return makeEdid()
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card0-DSI-1'])
    const { sysfsPanelGeometry } = await loadModule()

    const first = sysfsPanelGeometry()
    const callsAfterFirst = readFileSyncMock.mock.calls.length
    const second = sysfsPanelGeometry()

    expect(second).toBe(first)
    expect(readFileSyncMock.mock.calls.length).toBe(callsAfterFirst)
  })

  test('caches null when sysfs is unreadable', async () => {
    readFileSyncMock.mockImplementation(() => {
      throw new Error('no cmdline')
    })
    readdirSyncMock.mockImplementation(() => {
      throw new Error('no drm')
    })
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toBeNull()
    const callsAfterFirst = readFileSyncMock.mock.calls.length
    expect(sysfsPanelGeometry()).toBeNull()
    expect(readFileSyncMock.mock.calls.length).toBe(callsAfterFirst)
  })

  test('ignores a cmdline EDID without a connector prefix', async () => {
    readFileSyncMock.mockImplementation((path: string) => {
      if (path === '/proc/cmdline') return 'drm.edid_firmware=edid/livi.edid'
      if (path.endsWith('/status')) return 'connected'
      if (path.endsWith('/edid')) return makeEdid()
      throw new Error(`unexpected read ${path}`)
    })
    readdirSyncMock.mockReturnValue(['card0-DSI-1'])
    const { sysfsPanelGeometry } = await loadModule()

    expect(sysfsPanelGeometry()).toEqual(expect.objectContaining({ widthPx: 400 }))
  })
})
