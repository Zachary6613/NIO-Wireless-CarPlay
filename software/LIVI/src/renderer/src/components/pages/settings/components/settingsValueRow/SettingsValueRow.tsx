import { Typography } from '@mui/material'
import { ReactNode } from 'react'
import { SettingsItemRow } from '../settingsItemRow'

const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

type Props = {
  label: string
  value: ReactNode
  /** Monospace the value. */
  mono?: boolean
}

export const SettingsValueRow = ({ label, value, mono }: Props) => {
  return (
    <SettingsItemRow label={label} focusable>
      <Typography
        component="span"
        sx={{
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          ...(mono ? { fontFamily: MONO_STACK } : null)
        }}
      >
        {value}
      </Typography>
    </SettingsItemRow>
  )
}
