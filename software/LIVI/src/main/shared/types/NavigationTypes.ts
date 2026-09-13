/**
 * Turn-by-turn navigation codes.
 */

/** iAP2 ManeuverType . */
export enum ManeuverType {
  NoTurn = 0,
  LeftTurn = 1,
  RightTurn = 2,
  Straight = 3,
  UTurn = 4,
  FollowRoad = 5,
  EnterRoundabout = 6,
  ExitRoundabout = 7,
  RampOff = 8,
  RampOn = 9,
  EndOfNavigation = 10,
  ProceedToRoute = 11,
  Arrived = 12,
  KeepLeft = 13,
  KeepRight = 14,
  EnterFerry = 15,
  ExitFerry = 16,
  ChangeFerry = 17,
  UTurnToRoute = 18,
  RoundaboutUTurn = 19,
  EndOfRoadLeft = 20,
  EndOfRoadRight = 21,
  RampOffLeft = 22,
  RampOffRight = 23,
  ArrivedLeft = 24,
  ArrivedRight = 25,
  UTurnWhenPossible = 26,
  EndOfDirections = 27,
  RoundaboutExit1 = 28,
  RoundaboutExit2 = 29,
  RoundaboutExit3 = 30,
  RoundaboutExit4 = 31,
  RoundaboutExit5 = 32,
  RoundaboutExit6 = 33,
  RoundaboutExit7 = 34,
  RoundaboutExit8 = 35,
  RoundaboutExit9 = 36,
  RoundaboutExit10 = 37,
  RoundaboutExit11 = 38,
  RoundaboutExit12 = 39,
  RoundaboutExit13 = 40,
  RoundaboutExit14 = 41,
  RoundaboutExit15 = 42,
  RoundaboutExit16 = 43,
  RoundaboutExit17 = 44,
  RoundaboutExit18 = 45,
  RoundaboutExit19 = 46,
  SharpLeft = 47,
  SharpRight = 48,
  SlightLeft = 49,
  SlightRight = 50,
  ChangeHighway = 51,
  ChangeHighwayLeft = 52,
  ChangeHighwayRight = 53
}

/** iAP2 DrivingSide (Table 15-17). Roundabouts: Right = anti-clockwise. */
export enum DrivingSide {
  Right = 0,
  Left = 1
}

/** iAP2 JunctionType (Table 15-18). */
export enum JunctionType {
  Intersection = 0,
  Roundabout = 1
}

/** First roundabout-exit code; exit number = code - RoundaboutExit1 + 1. */
export const ROUNDABOUT_EXIT_BASE = ManeuverType.RoundaboutExit1

/** Exit number (1-19) for roundabout-exit maneuvers, undefined for all others. */
export function roundaboutExitNumber(type: number): number | undefined {
  if (type >= ManeuverType.RoundaboutExit1 && type <= ManeuverType.RoundaboutExit19) {
    return type - ROUNDABOUT_EXIT_BASE + 1
  }
  return undefined
}

/**
 * Navigation state as accumulated from the drivers, JSON-compatible.
 */
export type NaviInfo = {
  NaviStatus?: number
  NaviTimeToDestination?: number
  NaviDestinationName?: string
  NaviDistanceToDestination?: number
  NaviAPPName?: string
  NaviRemainDistance?: number

  NaviRoadName?: string
  NaviAfterRoadName?: string
  NaviOrderType?: number
  NaviManeuverType?: ManeuverType | number
  NaviJunctionType?: JunctionType | number
  NaviTurnAngle?: number
  NaviTurnSide?: DrivingSide | number
  NaviImageBase64?: string
} & Record<string, unknown>

export type NaviBag = Record<string, unknown>
