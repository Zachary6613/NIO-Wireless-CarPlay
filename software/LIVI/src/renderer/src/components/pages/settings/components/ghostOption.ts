import type { SelectOption } from '@renderer/routes/types'

// PipeWire bluez_output uses underscores, bluez_input uses colons in the MAC
export function extractBtMac(id: string | number | undefined | null): string | null {
  if (typeof id !== 'string') return null
  const m = id.match(/^bluez_(?:output|input|sink|source)\.([0-9A-Fa-f_:]{17})/)
  return m ? m[1]!.replace(/_/g, ':').toUpperCase() : null
}

export function findOptionForValue(
  options: SelectOption[],
  value: string | number | undefined | null
): SelectOption | undefined {
  const direct = options.find((o) => o.value === value)
  if (direct) return direct
  const mac = extractBtMac(value)
  if (!mac) return undefined
  return options.find((o) => !o.offline && extractBtMac(o.value) === mac)
}

// Append a ghost entry when the saved value isn't in the live options
export function withGhostOption(
  options: SelectOption[],
  value: string | number | undefined | null,
  savedLabel: string | undefined,
  formatOfflineLabel: (name: string) => string
): SelectOption[] {
  if (value === undefined || value === null || value === '') return options
  if (options.some((o) => o.value === value)) return options
  const valueMac = extractBtMac(value)
  if (valueMac && options.some((o) => extractBtMac(o.value) === valueMac)) return options
  if (!savedLabel) return options
  return [...options, { value, label: formatOfflineLabel(savedLabel) }]
}
