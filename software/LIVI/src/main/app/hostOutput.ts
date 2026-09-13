import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * The panel belongs to the host compositor (Cage in the kiosk), not to ours. Our own
 * WAYLAND_DISPLAY points at the nested compositor, so every query names the host.
 */
const HOST_DISPLAY = 'wayland-0'

function hostEnv(): NodeJS.ProcessEnv {
  return { ...process.env, WAYLAND_DISPLAY: HOST_DISPLAY }
}

function run(args: string[]): string | null {
  if (process.platform !== 'linux') return null
  try {
    return execFileSync('wlr-randr', args, { encoding: 'utf8', timeout: 3000, env: hostEnv() })
  } catch {
    return null
  }
}

/** Name of the host's first output, or null when it cannot be reached. */
export function hostOutputName(): string | null {
  const listed = run([])
  const name = listed?.split('\n')[0]?.trim().split(/\s+/)[0]
  return name || null
}

/** Modes the panel offers as "WIDTHxHEIGHT", widest first, without duplicates. */
export function listHostOutputModes(): string[] {
  const listed = run([])
  if (!listed) return []
  const seen = new Set<string>()
  for (const line of listed.split('\n')) {
    const m = line.trim().match(/^(\d+)x(\d+) px/)
    if (m) seen.add(`${m[1]}x${m[2]}`)
  }
  return [...seen].sort((a, b) => {
    const [aw, ah] = a.split('x').map(Number)
    const [bw, bh] = b.split('x').map(Number)
    return bw * bh - aw * ah
  })
}

/** Mode and refresh the panel is currently in, or null when it cannot be read. */
export function hostOutputCurrent(): { mode: string; hz: number } | null {
  const listed = run([])
  if (!listed) return null
  for (const line of listed.split('\n')) {
    if (!line.includes('current')) continue
    const m = line.trim().match(/^(\d+x\d+) px, ([\d.]+) Hz/)
    if (m) return { mode: m[1], hz: Math.round(Number(m[2])) || 60 }
  }
  return null
}

/**
 * Put the panel into the given mode, given as "WIDTHxHEIGHT". An empty mode leaves the
 * display at whatever it came up in. Applying a mode the output does not list leaves the
 * host compositor unable to test its swapchain, so the mode is checked before it is sent.
 */
export function applyHostOutputMode(mode: string): void {
  if (!/^\d+x\d+$/.test(mode)) return
  const name = hostOutputName()
  if (!name) {
    console.warn('[hostOutput] no host output found, leaving the panel at its own mode')
    return
  }
  const modes = listHostOutputModes()
  if (!modes.includes(mode)) {
    console.warn(
      `[hostOutput] ${name} does not offer ${mode}, leaving it as it is ` +
        `(offered: ${modes.join(', ') || 'none'})`
    )
    return
  }
  if (run(['--output', name, '--mode', mode]) === null) {
    console.warn(`[hostOutput] ${name} refused ${mode}, leaving it as it is`)
    return
  }
  console.log(`[hostOutput] ${name} → ${mode}`)
}

const fitsHd = (mode: string): boolean => {
  const [w, h] = mode.split('x').map(Number)
  return w <= 1280 && h <= 720
}

/** Every phone handles 720p projection, so an unconfigured panel snaps down to the
 *  largest offered mode fitting 1280x720 — or the smallest offered one when nothing fits. */
function resolveKioskMode(configured: string, current: { mode: string } | null): string {
  if (/^\d+x\d+$/.test(configured)) return configured
  if (!current || fitsHd(current.mode)) return ''
  const modes = listHostOutputModes()
  return modes.find(fitsHd) ?? modes.at(-1) ?? ''
}

const VIDEO_MODE_HELPER = '/usr/local/lib/livi/livi-video-mode.sh'

/** Pin the panel's mode in the kernel cmdline so console and boot splash come up in it.
 *  The helper ships with the headless installer; without it this is a no-op. */
function persistVideoMode(): void {
  if (!existsSync(VIDEO_MODE_HELPER)) return
  const name = hostOutputName()
  const current = hostOutputCurrent()
  if (!name || !current) return
  const pin = `${name}:${current.mode}@${current.hz}`
  try {
    execFileSync('sudo', ['-n', VIDEO_MODE_HELPER, pin], { stdio: 'ignore', timeout: 5000 })
    console.log(`[hostOutput] cmdline video pin → ${pin}`)
  } catch (e) {
    console.warn(`[hostOutput] could not pin ${pin} in the cmdline:`, (e as Error).message)
  }
}

/** Kiosk startup: apply the configured mode or the FHD preference when none is set
 *  then pin whatever the panel actually runs in into the kernel cmdline. */
export function applyKioskDisplayMode(configured: string): void {
  const current = hostOutputCurrent()
  const mode = resolveKioskMode(configured, current)
  if (mode && mode !== current?.mode) applyHostOutputMode(mode)
  persistVideoMode()
}
