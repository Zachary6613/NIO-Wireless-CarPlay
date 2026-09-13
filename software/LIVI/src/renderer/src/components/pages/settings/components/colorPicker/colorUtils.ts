import { themeColors } from '@renderer/theme/themeColors'

export type Hsl = { h: number; s: number; l: number }

export const defaultColorForPath = (path?: string): string => {
  switch (path) {
    case 'primaryColorDark':
      return themeColors.primaryColorDark
    case 'primaryColorLight':
      return themeColors.primaryColorLight
    case 'highlightColorDark':
      return themeColors.highlightColorDark
    case 'highlightColorLight':
      return themeColors.highlightColorLight
    case 'backgroundColorDark':
      return themeColors.dark
    case 'backgroundColorLight':
      return themeColors.light
    default:
      return themeColors.highlightColorDark
  }
}

const HEX_RE = /^#?([0-9a-f]{6})$/i

export const isHex = (value: string): boolean => HEX_RE.test(value.trim())

export const normalizeHex = (value: string): string =>
  `#${value.trim().replace(/^#/, '').toLowerCase()}`

export function hexToHsl(hex: string): Hsl {
  const m = HEX_RE.exec(hex.trim())
  if (!m) return { h: 0, s: 0, l: 0 }
  const n = Number.parseInt(m[1]!, 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min

  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
    if (h < 0) h += 360
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = ln - c / 2

  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]

  const toByte = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`
}
