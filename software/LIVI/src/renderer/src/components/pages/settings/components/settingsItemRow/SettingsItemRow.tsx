import { Typography } from '@mui/material'
import { SettingsNode } from '@renderer/routes'
import type { Config } from '@shared/types'
import { ReactNode } from 'react'
import { StackItem } from '../stackItem'

type Props = {
  label: string
  node?: SettingsNode<Config>
  children?: ReactNode
  focusable?: boolean
}

export const SettingsItemRow = ({ label, node, children, focusable }: Props) => {
  return (
    <StackItem node={node} focusable={focusable}>
      <Typography>{label}</Typography>
      {children}
    </StackItem>
  )
}
