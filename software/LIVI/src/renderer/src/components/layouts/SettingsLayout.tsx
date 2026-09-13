import ArrowBackIosOutlinedIcon from '@mui/icons-material/ArrowBackIosOutlined'
import RestartAltOutlinedIcon from '@mui/icons-material/RestartAltOutlined'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import { useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { SettingsLayoutProps } from './types'

type Vp = { w: number; h: number }

const clampPx = (min: number, pref: number, max: number) => Math.max(min, Math.min(pref, max))

export const SettingsLayout = ({
  children,
  title,
  showRestart,
  onRestart
}: SettingsLayoutProps) => {
  const navigate = useNavigate()
  const theme = useTheme()
  const location = useLocation()

  //const handleNavigate = () => navigate(-1)
  const handleNavigate = () => {
    const el = document.activeElement as HTMLElement | null
    if (el && el !== document.body) el.blur?.()
    requestAnimationFrame(() => navigate(-1))
  }

  const showBack = location.pathname !== '/settings'

  const [vp, setVp] = useState<Vp>(() => {
    const vv = window.visualViewport
    return {
      w: Math.round(vv?.width ?? window.innerWidth),
      h: Math.round(vv?.height ?? window.innerHeight)
    }
  })

  useLayoutEffect(() => {
    const vv = window.visualViewport

    const update = () => {
      setVp({
        w: Math.round(vv?.width ?? window.innerWidth),
        h: Math.round(vv?.height ?? window.innerHeight)
      })
    }

    update()
    window.addEventListener('resize', update)
    vv?.addEventListener('resize', update)

    return () => {
      window.removeEventListener('resize', update)
      vv?.removeEventListener('resize', update)
    }
  }, [])

  const px = useMemo(() => {
    const vw = vp.w / 100
    const vh = vp.h / 100

    const pl = clampPx(12, 1.5 * vw, 28)
    const pr = pl
    const pt = clampPx(8, 2.2 * vh, 18)
    const pb = clampPx(10, 2.2 * vh, 18)

    const headerH = clampPx(32, 5.5 * vh, 44)
    const headerMb = 12
    const rowH = Math.round(clampPx(36, 18.7 * vh, 52))
    // icon slot, placeholder and divider insets derive from these.
    const rowPad = Math.round(clampPx(10, 1.9 * vh, 16))
    const rowGap = Math.round(clampPx(12, 2.6 * vh, 48))
    const rowIcon = Math.round(clampPx(20, 3.6 * vh, 26))
    // Divider: from the text edge to the chevron's right edge.
    const rowInset = rowPad + rowIcon + rowGap + rowPad
    const rowInsetR = rowPad
    const slotLeftW = clampPx(36, 6 * vw, 56)
    const slotRightW = clampPx(36, 8 * vw, 100)
    const iconPx = clampPx(18, 3.2 * vh, 28)
    const titlePx = clampPx(16, 3.6 * vh, 34)
    const applyPx = clampPx(13, 1.8 * vh, 16)
    // Fill the visible area below the header so flex-1 pages (sliders, calibration) can center.
    // Floored so a rounding overhang never creates a 1px scroll on non-scrolling pages.
    const contentMinH = Math.max(0, Math.floor(vp.h - pt - pb - headerH - headerMb))

    return {
      pl,
      pr,
      pt,
      pb,
      headerH,
      headerMb,
      contentMinH,
      rowH,
      rowPad,
      rowGap,
      rowIcon,
      rowInset,
      rowInsetR,
      slotLeftW,
      slotRightW,
      iconPx,
      titlePx,
      applyPx
    }
  }, [vp.h, vp.w])

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        pl: `${px.pl}px`,
        pr: `${px.pr}px`,
        pt: `${px.pt}px`,
        pb: `${px.pb}px`,
        '--livi-row-h': `${px.rowH}px`,
        '--livi-row-pad': `${px.rowPad}px`,
        '--livi-row-gap': `${px.rowGap}px`,
        '--livi-row-icon': `${px.rowIcon}px`,
        '--livi-row-inset': `${px.rowInset}px`,
        '--livi-row-inset-r': `${px.rowInsetR}px`
      }}
    >
      <Box
        data-scrolled-wrapper
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y'
        }}
      >
        <Box
          sx={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: `${px.headerH}px`,
            px: '0.5rem',
            boxSizing: 'border-box',
            flex: '0 0 auto',
            mb: `${px.headerMb}px`
          }}
        >
          <Box
            sx={{
              width: `${px.slotLeftW}px`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              flex: '0 0 auto'
            }}
          >
            {showBack ? (
              <IconButton
                onClick={handleNavigate}
                aria-label="Back"
                className="nav-focus-primary"
                disableRipple
                disableFocusRipple
                disableTouchRipple
                sx={{
                  width: `${px.slotLeftW}px`,
                  height: '100%',
                  p: 0,
                  m: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <ArrowBackIosOutlinedIcon sx={{ fontSize: `${px.iconPx}px` }} />
              </IconButton>
            ) : null}
          </Box>

          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${Math.max(px.slotLeftW, px.slotRightW)}px`,
              right: `${Math.max(px.slotLeftW, px.slotRightW)}px`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none'
            }}
          >
            <Typography
              sx={{
                textAlign: 'center',
                fontWeight: 800,
                lineHeight: 1.05,
                fontSize: `${px.titlePx}px`,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%'
              }}
            >
              {title}
            </Typography>
          </Box>

          <Box
            sx={{
              width: `${px.slotRightW}px`,
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flex: '0 0 auto'
            }}
          >
            {showRestart ? (
              <IconButton
                onClick={onRestart}
                aria-label="Apply"
                sx={{
                  width: `${px.slotRightW}px`,
                  height: '100%',
                  p: 0,
                  m: 0,
                  color: theme.palette.primary.main,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    whiteSpace: 'nowrap',
                    fontSize: `${px.applyPx}px`,
                    gap: '0.5rem'
                  }}
                >
                  <span>Apply</span>
                  <RestartAltOutlinedIcon sx={{ fontSize: `${px.iconPx}px` }} />
                </Box>
              </IconButton>
            ) : null}
          </Box>
        </Box>

        <Stack
          spacing={0}
          sx={{
            minHeight: `${px.contentMinH}px`,
            padding: '0 0.5rem 2px',
            // Rows are direct children; sibling logic finds the group ends even
            // when non-row content precedes or follows the rows.
            '& > [data-nav-row]': {
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10
            },
            '& > [data-nav-row] ~ [data-nav-row]': {
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0
            },
            '& > [data-nav-row]:not(:has(~ [data-nav-row]))': {
              borderBottomLeftRadius: 10,
              borderBottomRightRadius: 10,
              '&::after': { backgroundColor: 'transparent' }
            }
          }}
        >
          {children}
        </Stack>
      </Box>
    </Box>
  )
}
