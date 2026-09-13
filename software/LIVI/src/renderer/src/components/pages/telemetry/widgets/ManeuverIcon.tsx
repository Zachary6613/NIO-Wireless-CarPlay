import DirectionsBoatIcon from '@mui/icons-material/DirectionsBoat'
import ExitToAppIcon from '@mui/icons-material/ExitToApp'
import FlagIcon from '@mui/icons-material/Flag'
import ForkLeftIcon from '@mui/icons-material/ForkLeft'
import ForkRightIcon from '@mui/icons-material/ForkRight'
import MergeIcon from '@mui/icons-material/Merge'
import NavigationOutlinedIcon from '@mui/icons-material/NavigationOutlined'
import RoundaboutRightIcon from '@mui/icons-material/RoundaboutRight'
import StraightIcon from '@mui/icons-material/Straight'
import SubdirectoryArrowLeftIcon from '@mui/icons-material/SubdirectoryArrowLeft'
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import TurnLeftIcon from '@mui/icons-material/TurnLeft'
import TurnRightIcon from '@mui/icons-material/TurnRight'
import TurnSharpLeftIcon from '@mui/icons-material/TurnSharpLeft'
import TurnSharpRightIcon from '@mui/icons-material/TurnSharpRight'
import TurnSlightLeftIcon from '@mui/icons-material/TurnSlightLeft'
import TurnSlightRightIcon from '@mui/icons-material/TurnSlightRight'
import UTurnLeftIcon from '@mui/icons-material/UTurnLeft'
import UTurnRightIcon from '@mui/icons-material/UTurnRight'
import { Box, Chip } from '@mui/material'
import { DrivingSide, ManeuverType, roundaboutExitNumber } from '@shared/types/NavigationTypes'

/**
 * iAP2 ManeuverType → MUI icon
 */

function RoundaboutWithExit({ exitNumber, size }: { exitNumber: number; size: number }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        display: 'grid',
        placeItems: 'center'
      }}
    >
      <RoundaboutRightIcon sx={{ fontSize: size }} />
      <Box sx={{ position: 'absolute', right: -6, bottom: -6 }}>
        <Chip
          size="small"
          label={exitNumber}
          sx={{ height: 20, fontSize: 12, '& .MuiChip-label': { px: 0.8 } }}
        />
      </Box>
    </Box>
  )
}

export function ManeuverIcon({
  type,
  turnSide,
  size
}: {
  type: number | undefined
  turnSide: number | undefined
  size: number
}) {
  const fs = { fontSize: size }
  const isRight = turnSide === DrivingSide.Right

  // No maneuver yet → a neutral heading arrow (never a "?").
  if (type == null) return <NavigationOutlinedIcon sx={fs} />

  const exitNumber = roundaboutExitNumber(type)
  if (exitNumber !== undefined) return <RoundaboutWithExit exitNumber={exitNumber} size={size} />

  switch (type) {
    case ManeuverType.NoTurn:
    case ManeuverType.Straight:
    case ManeuverType.FollowRoad:
      return <StraightIcon sx={fs} />
    case ManeuverType.LeftTurn:
      return <TurnLeftIcon sx={fs} />
    case ManeuverType.RightTurn:
      return <TurnRightIcon sx={fs} />
    case ManeuverType.UTurn:
    case ManeuverType.UTurnToRoute:
    case ManeuverType.UTurnWhenPossible:
      return isRight ? <UTurnRightIcon sx={fs} /> : <UTurnLeftIcon sx={fs} />
    case ManeuverType.EnterRoundabout:
    case ManeuverType.ExitRoundabout:
    case ManeuverType.RoundaboutUTurn:
      return <RoundaboutRightIcon sx={fs} />
    case ManeuverType.RampOff:
    case ManeuverType.RampOffLeft:
    case ManeuverType.RampOffRight:
      return <ExitToAppIcon sx={fs} />
    case ManeuverType.RampOn:
      return <MergeIcon sx={fs} />
    case ManeuverType.EndOfNavigation:
    case ManeuverType.Arrived:
    case ManeuverType.ArrivedLeft:
    case ManeuverType.ArrivedRight:
    case ManeuverType.EndOfDirections:
      return <FlagIcon sx={fs} />
    case ManeuverType.ProceedToRoute:
      // DEPART / proceed-to-route → straight-ahead arrow (matches Apple/Android Auto).
      return <StraightIcon sx={fs} />
    case ManeuverType.KeepLeft:
      return <ForkLeftIcon sx={fs} />
    case ManeuverType.KeepRight:
      return <ForkRightIcon sx={fs} />
    case ManeuverType.EnterFerry:
    case ManeuverType.ExitFerry:
    case ManeuverType.ChangeFerry:
      return <DirectionsBoatIcon sx={fs} />
    case ManeuverType.EndOfRoadLeft:
      return <SubdirectoryArrowLeftIcon sx={fs} />
    case ManeuverType.EndOfRoadRight:
      return <SubdirectoryArrowRightIcon sx={fs} />
    case ManeuverType.SharpLeft:
      return <TurnSharpLeftIcon sx={fs} />
    case ManeuverType.SharpRight:
      return <TurnSharpRightIcon sx={fs} />
    case ManeuverType.SlightLeft:
      return <TurnSlightLeftIcon sx={fs} />
    case ManeuverType.SlightRight:
      return <TurnSlightRightIcon sx={fs} />
    case ManeuverType.ChangeHighway:
      return <SwapHorizIcon sx={fs} />
    case ManeuverType.ChangeHighwayLeft:
      return <ForkLeftIcon sx={fs} />
    case ManeuverType.ChangeHighwayRight:
      return <ForkRightIcon sx={fs} />
    default:
      return <NavigationOutlinedIcon sx={fs} />
  }
}

/** Maneuver visual: the phone's PNG when present, otherwise the shared icon model. */
export function ManeuverGraphic({
  imageBase64,
  type,
  turnSide,
  size
}: {
  imageBase64?: string
  type: number | undefined
  turnSide: number | undefined
  size: number
}) {
  if (imageBase64) {
    return (
      <Box
        component="img"
        src={`data:image/png;base64,${imageBase64}`}
        alt="Navigation maneuver"
        sx={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      />
    )
  }
  return <ManeuverIcon type={type} turnSide={turnSide} size={size} />
}
