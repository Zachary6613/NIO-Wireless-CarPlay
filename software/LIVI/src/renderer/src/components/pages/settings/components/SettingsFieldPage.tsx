import { SettingsNode } from '@renderer/routes'
import type { Config } from '@shared/types'
import { SettingsFieldControl } from './SettingsFieldControl'

type Props<T> = {
  node: SettingsNode<Config>
  value: T
  onChange: (v: T) => void
  savedLabel?: string
  onLabelChange?: (label: string) => void
  onDone?: () => void
}

export const SettingsFieldPage = <T,>({
  node,
  value,
  onChange,
  savedLabel,
  onLabelChange,
  onDone
}: Props<T>) => {
  return (
    <SettingsFieldControl
      node={node}
      value={value}
      onChange={onChange}
      savedLabel={savedLabel}
      onLabelChange={onLabelChange}
      onDone={onDone}
    />
  )
}
