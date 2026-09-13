/**
 * Maps AA navigation events to the shared iAP2 codes (ManeuverType/DrivingSide).
 */

import { DrivingSide, ManeuverType } from '@shared/types/NavigationTypes'
import type { NavigationTurnEvent, NavigationTurnSide } from './NavigationChannel.js'

/** ManeuverType for a given AA turn-event + turn-side combination. */
export function turnEventToManeuverType(
  event: NavigationTurnEvent | undefined,
  side: NavigationTurnSide | undefined
): ManeuverType | undefined {
  if (!event) return undefined
  const isLeft = side === 'left'
  const isRight = side === 'right'

  switch (event) {
    case 'unknown':
      return ManeuverType.NoTurn
    case 'depart':
      return ManeuverType.ProceedToRoute
    case 'name-change':
      return ManeuverType.FollowRoad
    case 'slight-turn':
      return isRight ? ManeuverType.SlightRight : ManeuverType.SlightLeft
    case 'turn':
      return isRight ? ManeuverType.RightTurn : ManeuverType.LeftTurn
    case 'sharp-turn':
      return isRight ? ManeuverType.SharpRight : ManeuverType.SharpLeft
    case 'u-turn':
      return ManeuverType.UTurn
    case 'on-ramp':
      return ManeuverType.RampOn
    case 'off-ramp':
      return isRight
        ? ManeuverType.RampOffRight
        : isLeft
          ? ManeuverType.RampOffLeft
          : ManeuverType.RampOff
    case 'fork':
      return isRight ? ManeuverType.KeepRight : ManeuverType.KeepLeft
    case 'merge':
      return ManeuverType.RampOn // closest match
    case 'roundabout-enter':
      return ManeuverType.EnterRoundabout
    case 'roundabout-exit':
      return ManeuverType.ExitRoundabout
    case 'roundabout-enter-and-exit':
      return ManeuverType.EnterRoundabout // exit number isn't carried in deprecated event
    case 'straight':
      return ManeuverType.Straight
    case 'ferry-boat':
    case 'ferry-train':
      return ManeuverType.EnterFerry
    case 'destination':
      return isRight
        ? ManeuverType.ArrivedRight
        : isLeft
          ? ManeuverType.ArrivedLeft
          : ManeuverType.Arrived
    default:
      return ManeuverType.NoTurn
  }
}

export function turnSideToNaviCode(side: NavigationTurnSide | undefined): DrivingSide | undefined {
  if (side === 'left') return DrivingSide.Left
  if (side === 'right') return DrivingSide.Right
  return undefined
}

/** ManeuverType for an AA ManeuverType (modern nav, AA >= 1.7). */
export function navManeuverTypeToCode(type: number | undefined): ManeuverType | undefined {
  switch (type) {
    case 0:
      return ManeuverType.NoTurn // UNKNOWN
    case 1:
      return ManeuverType.ProceedToRoute // DEPART
    case 2:
      return ManeuverType.FollowRoad // NAME_CHANGE
    case 3:
      return ManeuverType.KeepLeft
    case 4:
      return ManeuverType.KeepRight
    case 5:
      return ManeuverType.SlightLeft // TURN_SLIGHT_LEFT
    case 6:
      return ManeuverType.SlightRight // TURN_SLIGHT_RIGHT
    case 7:
      return ManeuverType.LeftTurn // TURN_NORMAL_LEFT
    case 8:
      return ManeuverType.RightTurn // TURN_NORMAL_RIGHT
    case 9:
      return ManeuverType.SharpLeft // TURN_SHARP_LEFT
    case 10:
      return ManeuverType.SharpRight // TURN_SHARP_RIGHT
    case 11:
    case 12:
      return ManeuverType.UTurn // U_TURN_*
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
    case 20:
      return ManeuverType.RampOn // ON_RAMP_*
    case 21:
    case 23:
      return ManeuverType.RampOffLeft // OFF_RAMP_*_LEFT
    case 22:
    case 24:
      return ManeuverType.RampOffRight // OFF_RAMP_*_RIGHT
    case 25:
      return ManeuverType.KeepLeft // FORK_LEFT
    case 26:
      return ManeuverType.KeepRight // FORK_RIGHT
    case 27:
    case 28:
    case 29:
      return ManeuverType.RampOn // MERGE_* (closest)
    case 30:
      return ManeuverType.EnterRoundabout // ROUNDABOUT_ENTER
    case 31:
      return ManeuverType.ExitRoundabout // ROUNDABOUT_EXIT
    case 32:
    case 33:
    case 34:
    case 35:
      return ManeuverType.EnterRoundabout // ROUNDABOUT_ENTER_AND_EXIT_*
    case 36:
      return ManeuverType.Straight // STRAIGHT
    case 37:
    case 38:
      return ManeuverType.EnterFerry // FERRY_*
    case 39:
    case 40:
      return ManeuverType.Arrived // DESTINATION(_STRAIGHT)
    case 41:
      return ManeuverType.ArrivedLeft // DESTINATION_LEFT
    case 42:
      return ManeuverType.ArrivedRight // DESTINATION_RIGHT
    default:
      return undefined
  }
}

/** DrivingSide implied by an AA ManeuverType. */
export function navManeuverTypeToSide(type: number | undefined): DrivingSide | undefined {
  switch (type) {
    case 3: // KEEP_LEFT
    case 5: // TURN_SLIGHT_LEFT
    case 7: // TURN_NORMAL_LEFT
    case 9: // TURN_SHARP_LEFT
    case 11: // U_TURN_LEFT
    case 25: // FORK_LEFT
    case 41: // DESTINATION_LEFT
      return DrivingSide.Left
    case 4: // KEEP_RIGHT
    case 6: // TURN_SLIGHT_RIGHT
    case 8: // TURN_NORMAL_RIGHT
    case 10: // TURN_SHARP_RIGHT
    case 12: // U_TURN_RIGHT
    case 26: // FORK_RIGHT
    case 42: // DESTINATION_RIGHT
      return DrivingSide.Right
    default:
      return undefined
  }
}
