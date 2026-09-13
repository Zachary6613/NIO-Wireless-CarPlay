import fs from 'node:fs'

export type PanelGeometry = {
  widthMm: number
  heightMm: number
  widthPx: number
  heightPx: number
}

/** Physical size and native resolution from an EDID blob's first DTD. */
export function edidPanelGeometry(edid: Buffer): PanelGeometry | null {
  if (edid.length < 128) return null
  const dtd = edid.subarray(0x36, 0x48)
  if (dtd.readUInt16LE(0) === 0) return null
  const widthMm = ((dtd[14] & 0xf0) << 4) | dtd[12]
  const heightMm = ((dtd[14] & 0x0f) << 8) | dtd[13]
  const widthPx = ((dtd[4] & 0xf0) << 4) | dtd[2]
  const heightPx = ((dtd[7] & 0xf0) << 4) | dtd[5]
  if (widthMm <= 0 || heightMm <= 0 || widthPx <= 0 || heightPx <= 0) return null
  return { widthMm, heightMm, widthPx, heightPx }
}

// Nested compositor outputs carry no physical size; the kernel EDID does.
let sysfsMainPanel: PanelGeometry | null | undefined
export function sysfsPanelGeometry(): PanelGeometry | null {
  if (process.platform !== 'linux') return null
  if (sysfsMainPanel !== undefined) return sysfsMainPanel
  sysfsMainPanel = null
  try {
    const forced = /drm\.edid_firmware=(?:([A-Za-z0-9-]+):)?/.exec(
      fs.readFileSync('/proc/cmdline', 'utf8')
    )?.[1]
    const connectors = fs
      .readdirSync('/sys/class/drm')
      .filter((n) => /^card\d+-/.test(n))
      .filter((n) => {
        try {
          return fs.readFileSync(`/sys/class/drm/${n}/status`, 'utf8').trim() === 'connected'
        } catch {
          return false
        }
      })
    // Unambiguous only via the forced-EDID connector or a single connected display.
    const pick = forced
      ? connectors.find((n) => n.endsWith(`-${forced}`))
      : connectors.length === 1
        ? connectors[0]
        : undefined
    if (pick) {
      const geo = edidPanelGeometry(fs.readFileSync(`/sys/class/drm/${pick}/edid`))
      if (geo) {
        console.log(
          `[panel] EDID of ${pick}: ${geo.widthMm}x${geo.heightMm} mm, ${geo.widthPx}x${geo.heightPx} px`
        )
        sysfsMainPanel = geo
      }
    }
  } catch {
    sysfsMainPanel = null
  }
  return sysfsMainPanel
}
