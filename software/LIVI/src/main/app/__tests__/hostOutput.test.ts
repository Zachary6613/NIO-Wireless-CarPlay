import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { Mock } from 'vitest'
import {
  applyHostOutputMode,
  applyKioskDisplayMode,
  hostOutputCurrent,
  hostOutputName,
  listHostOutputModes
} from '../hostOutput'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ existsSync: vi.fn() }))

const mockedExec = execFileSync as Mock
const mockedExists = existsSync as Mock

const WLR_OUTPUT = [
  'HDMI-A-1 "Panel Corp 7in (HDMI-A-1)"',
  '  Modes:',
  '    800x480 px, 60.000000 Hz (preferred, current)',
  '    1024x600 px, 60.000000 Hz',
  '    800x480 px, 75.000000 Hz',
  '    640x480 px, 59.940 Hz',
  ''
].join('\n')

const WLR_4K = [
  'HDMI-A-1 "Big TV (HDMI-A-1)"',
  '  Modes:',
  '    3840x2160 px, 60.000000 Hz (preferred, current)',
  '    1920x1080 px, 60.000000 Hz',
  ''
].join('\n')

describe('hostOutput', () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    mockedExec.mockReturnValue(WLR_OUTPUT)
    mockedExists.mockReturnValue(false)
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  describe('hostOutputName', () => {
    test('returns the first output name from wlr-randr', () => {
      expect(hostOutputName()).toBe('HDMI-A-1')
      const [cmd, args, opts] = mockedExec.mock.calls[0]
      expect(cmd).toBe('wlr-randr')
      expect(args).toEqual([])
      expect(opts.env.WAYLAND_DISPLAY).toBe('wayland-0')
    })

    test('returns null when wlr-randr fails', () => {
      mockedExec.mockImplementation(() => {
        throw new Error('no display')
      })
      expect(hostOutputName()).toBeNull()
    })

    test('returns null off linux without running anything', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
      expect(hostOutputName()).toBeNull()
      expect(mockedExec).not.toHaveBeenCalled()
    })

    test('returns null for empty output', () => {
      mockedExec.mockReturnValue('')
      expect(hostOutputName()).toBeNull()
    })
  })

  describe('listHostOutputModes', () => {
    test('lists deduplicated modes widest first', () => {
      expect(listHostOutputModes()).toEqual(['1024x600', '800x480', '640x480'])
    })

    test('returns an empty list when wlr-randr fails', () => {
      mockedExec.mockImplementation(() => {
        throw new Error('no display')
      })
      expect(listHostOutputModes()).toEqual([])
    })
  })

  describe('applyHostOutputMode', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
      logSpy.mockRestore()
    })

    test('ignores malformed mode strings', () => {
      applyHostOutputMode('')
      applyHostOutputMode('auto')
      applyHostOutputMode('800x')
      expect(mockedExec).not.toHaveBeenCalled()
    })

    test('warns when no host output is reachable', () => {
      mockedExec.mockImplementation(() => {
        throw new Error('no display')
      })
      applyHostOutputMode('800x480')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no host output'))
    })

    test('warns when the output does not offer the mode', () => {
      applyHostOutputMode('1920x1080')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does not offer 1920x1080'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1024x600, 800x480, 640x480'))
    })

    test('reports "none" when the output offers no modes at all', () => {
      mockedExec.mockReturnValue('HDMI-A-1 "Panel"\n')
      applyHostOutputMode('800x480')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('offered: none'))
    })

    test('warns when the output refuses the mode switch', () => {
      mockedExec
        .mockReturnValueOnce(WLR_OUTPUT)
        .mockReturnValueOnce(WLR_OUTPUT)
        .mockImplementationOnce(() => {
          throw new Error('refused')
        })
      applyHostOutputMode('800x480')
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('refused 800x480'))
    })

    test('switches the mode and logs the result', () => {
      applyHostOutputMode('800x480')
      expect(mockedExec).toHaveBeenLastCalledWith(
        'wlr-randr',
        ['--output', 'HDMI-A-1', '--mode', '800x480'],
        expect.objectContaining({ timeout: 3000 })
      )
      expect(logSpy).toHaveBeenCalledWith('[hostOutput] HDMI-A-1 → 800x480')
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })

  describe('hostOutputCurrent', () => {
    test('parses the current mode and rounded refresh', () => {
      expect(hostOutputCurrent()).toEqual({ mode: '800x480', hz: 60 })
    })

    test('returns null when wlr-randr fails', () => {
      mockedExec.mockImplementation(() => {
        throw new Error('no display')
      })
      expect(hostOutputCurrent()).toBeNull()
    })

    test('returns null when no mode is marked current', () => {
      mockedExec.mockReturnValue('HDMI-A-1 "Panel"\n  Modes:\n    800x480 px, 60.000000 Hz\n')
      expect(hostOutputCurrent()).toBeNull()
    })

    test('skips current-marked lines that carry no mode', () => {
      mockedExec.mockReturnValue('HDMI-A-1 "Panel"\n  current settings apply\n')
      expect(hostOutputCurrent()).toBeNull()
    })

    test('falls back to 60 Hz when the refresh reads as zero', () => {
      mockedExec.mockReturnValue(
        'HDMI-A-1 "Panel"\n  Modes:\n    800x480 px, 0.000000 Hz (current)\n'
      )
      expect(hostOutputCurrent()).toEqual({ mode: '800x480', hz: 60 })
    })
  })

  describe('applyKioskDisplayMode', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
      logSpy.mockRestore()
    })

    test('applies the configured mode', () => {
      applyKioskDisplayMode('1024x600')
      expect(mockedExec).toHaveBeenLastCalledWith(
        'wlr-randr',
        ['--output', 'HDMI-A-1', '--mode', '1024x600'],
        expect.anything()
      )
    })

    test('skips the modeset when the panel already runs the configured mode', () => {
      applyKioskDisplayMode('800x480')
      const modesets = mockedExec.mock.calls.filter(([, args]) => args.includes('--mode'))
      expect(modesets).toEqual([])
    })

    test('snaps an unconfigured panel to the largest mode fitting 1280x720', () => {
      mockedExec.mockReturnValue(
        [
          'HDMI-A-1 "Big TV (HDMI-A-1)"',
          '  Modes:',
          '    3840x2160 px, 60.000000 Hz (preferred, current)',
          '    1920x1080 px, 60.000000 Hz',
          '    1280x720 px, 60.000000 Hz',
          '    1024x600 px, 60.000000 Hz',
          ''
        ].join('\n')
      )
      applyKioskDisplayMode('')
      expect(mockedExec).toHaveBeenLastCalledWith(
        'wlr-randr',
        ['--output', 'HDMI-A-1', '--mode', '1280x720'],
        expect.anything()
      )
    })

    test('falls back to the smallest offered mode when nothing fits 1280x720', () => {
      mockedExec.mockReturnValue(WLR_4K)
      applyKioskDisplayMode('')
      expect(mockedExec).toHaveBeenLastCalledWith(
        'wlr-randr',
        ['--output', 'HDMI-A-1', '--mode', '1920x1080'],
        expect.anything()
      )
    })

    test('leaves an unconfigured panel at or below 1280x720 alone', () => {
      applyKioskDisplayMode('')
      const modesets = mockedExec.mock.calls.filter(([, args]) => args.includes('--mode'))
      expect(modesets).toEqual([])
    })

    test('pins the effective mode in the cmdline when the helper is installed', () => {
      mockedExists.mockReturnValue(true)
      applyKioskDisplayMode('800x480')
      expect(mockedExec).toHaveBeenLastCalledWith(
        'sudo',
        ['-n', '/usr/local/lib/livi/livi-video-mode.sh', 'HDMI-A-1:800x480@60'],
        expect.objectContaining({ timeout: 5000 })
      )
      expect(logSpy).toHaveBeenCalledWith('[hostOutput] cmdline video pin → HDMI-A-1:800x480@60')
    })

    test('stays put when the panel lists no modes at all', () => {
      mockedExec
        .mockReturnValueOnce(WLR_4K)
        .mockReturnValueOnce('HDMI-A-1 "Big TV (HDMI-A-1)"\n  Modes:\n')
      applyKioskDisplayMode('')
      const modesets = mockedExec.mock.calls.filter(([, args]) => args.includes('--mode'))
      expect(modesets).toEqual([])
    })

    test('skips the pin when the host output cannot be reached', () => {
      mockedExists.mockReturnValue(true)
      mockedExec.mockImplementation(() => {
        throw new Error('no display')
      })
      applyKioskDisplayMode('800x480')
      const sudoCalls = mockedExec.mock.calls.filter(([cmd]) => cmd === 'sudo')
      expect(sudoCalls).toEqual([])
    })

    test('does not touch the cmdline without the helper', () => {
      applyKioskDisplayMode('800x480')
      const sudoCalls = mockedExec.mock.calls.filter(([cmd]) => cmd === 'sudo')
      expect(sudoCalls).toEqual([])
    })

    test('warns when the pin fails', () => {
      mockedExists.mockReturnValue(true)
      mockedExec.mockImplementation((cmd: string) => {
        if (cmd === 'sudo') throw new Error('sudo: a password is required')
        return WLR_OUTPUT
      })
      applyKioskDisplayMode('800x480')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('could not pin HDMI-A-1:800x480@60'),
        'sudo: a password is required'
      )
    })
  })
})
