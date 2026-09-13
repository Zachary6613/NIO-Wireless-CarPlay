import { Box, Typography } from '@mui/material'
import { StackItem } from './stackItem'

type Props = {
  label: string
  selected: boolean
  onClick?: () => void
}

// One pickable option as a standard settings row; the selected option carries a dot marker.
export const SelectOptionRow = ({ label, selected, onClick }: Props) => (
  <StackItem onClick={onClick}>
    <Typography>{label}</Typography>
    <Box
      sx={{
        flex: 'none',
        width: 'clamp(8px, 1.6svh, 12px)',
        height: 'clamp(8px, 1.6svh, 12px)',
        borderRadius: '50%',
        bgcolor: selected ? 'primary.main' : 'transparent'
      }}
    />
  </StackItem>
)
