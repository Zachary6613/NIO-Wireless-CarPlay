import { SettingsNode } from '@renderer/routes'
import type { Config } from '@shared/types'
import { ReactNode } from 'react'

export interface StackItemProps {
  children?: ReactNode
  withForwardIcon?: boolean
  value?: unknown
  showValue?: boolean
  onClick?: () => void
  node?: SettingsNode<Config>
  savedLabel?: string
  focusable?: boolean
  ownIcon?: boolean
  dimmed?: boolean
  disabled?: boolean
}

export type SettingsCustomPageProps<TState = Config, TValue = unknown> = {
  state: TState
  onChange: (value: TValue) => void
}
