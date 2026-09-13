/**
 * Navigation status channel handler (CH.NAVIGATION = 12).
 *
 * Phone → HU only. Carries Google Maps turn-by-turn data so a HU with a
 * cluster / side widget can show maneuver + distance independently of the
 * main video stream. We translate it to LIVI's `NaviBag`
 * shape (Navi* keys) inside aaDriver.
 *
 * Message IDs (NavigationStatusMessageId.proto):
 *   0x8001 INSTRUMENT_CLUSTER_START          (StatusStart, empty)
 *   0x8002 INSTRUMENT_CLUSTER_STOP           (StatusStop,  empty)
 *   0x8003 INSTRUMENT_CLUSTER_NAVIGATION_STATUS    (NavigationStatus.status enum)
 *   0x8004 INSTRUMENT_CLUSTER_NAVIGATION_TURN_EVENT      [deprecated]
 *   0x8005 INSTRUMENT_CLUSTER_NAVIGATION_DISTANCE_EVENT  [deprecated]
 *   0x8006 INSTRUMENT_CLUSTER_NAVIGATION_STATE     (steps + destinations)
 *   0x8007 INSTRUMENT_CLUSTER_NAVIGATION_CURRENT_POSITION
 *
 * The deprecated TURN_EVENT / DISTANCE_EVENT pair is what current Maps
 * actually sends — modern STATE/CURRENT_POSITION are reserved for cluster
 * apps that aasdk hosts don't typically implement.
 */

import { EventEmitter } from 'node:events'
import { decodeFields, decodeVarintValue } from './protoEnc.js'

export const NAV_MSG = {
  START_INDICATION: 0x8001,
  STOP_INDICATION: 0x8002,
  STATUS: 0x8003,
  TURN_EVENT: 0x8004,
  DISTANCE_EVENT: 0x8005,
  STATE: 0x8006,
  CURRENT_POSITION: 0x8007
} as const

export type NavigationState = 'unavailable' | 'active' | 'inactive' | 'rerouting'

export type NavigationTurnSide = 'left' | 'right' | 'unspecified'

/** NextTurnEnum from NavigationNextTurnEvent.proto (deprecated TURN_EVENT). */
export type NavigationTurnEvent =
  | 'unknown'
  | 'depart'
  | 'name-change'
  | 'slight-turn'
  | 'turn'
  | 'sharp-turn'
  | 'u-turn'
  | 'on-ramp'
  | 'off-ramp'
  | 'fork'
  | 'merge'
  | 'roundabout-enter'
  | 'roundabout-exit'
  | 'roundabout-enter-and-exit'
  | 'straight'
  | 'ferry-boat'
  | 'ferry-train'
  | 'destination'

export interface NavigationStatusUpdate {
  state: NavigationState
}

export interface NavigationTurnUpdate {
  road?: string
  turnSide?: NavigationTurnSide
  event?: NavigationTurnEvent
  /** Raw turn-icon image bytes (PNG/bitmap). */
  image?: Buffer
  turnNumber?: number
  turnAngle?: number
}

export interface NavigationDistanceUpdate {
  distanceMeters: number
  timeToTurnSeconds: number
  /** Display value × 1000 in the unit indicated by displayUnit (e.g. 1.5 km = 1500). */
  displayDistanceE3?: number
  displayUnit?: number
}

/** Modern NavigationState (STATE, AA ≥ 1.7): current step + destination. */
export interface NavigationStateUpdate {
  /** NavigationManeuver.NavigationType enum of the current step. */
  maneuverType?: number
  /** Name of the step's target road. */
  roadName?: string
  /** First cue / alternate text for the step. */
  cue?: string
  /** First destination address. */
  destinationAddress?: string
}

/** Modern NavigationCurrentPosition (CURRENT_POSITION, AA ≥ 1.7): live distances. */
export interface NavigationPositionUpdate {
  /** Distance to the next step (maneuver), metres. */
  stepDistanceMeters?: number
  stepDistanceDisplay?: string
  /** Seconds to the next step. */
  timeToStepSeconds?: number
  /** Distance to the destination, metres. */
  destinationMeters?: number
  destinationDisplay?: string
  /** NavigationDistance.DistanceUnits enum. */
  destinationUnits?: number
  /** Clock time of arrival, e.g. "21:58". */
  etaText?: string
  /** Seconds remaining to the destination. */
  timeToArrivalSeconds?: number
  /** Name of the road currently driven. */
  currentRoadName?: string
}

export class NavigationChannel extends EventEmitter {
  // Events emitted:
  //   'nav-start'                            — instrument-cluster session began
  //   'nav-stop'                             — instrument-cluster session ended
  //   'nav-status'    (s: NavigationStatusUpdate)
  //   'nav-turn'      (t: NavigationTurnUpdate)       [deprecated path]
  //   'nav-distance'  (d: NavigationDistanceUpdate)   [deprecated path]
  //   'nav-state'     (s: NavigationStateUpdate)      [modern path, AA ≥ 1.7]
  //   'nav-position'  (p: NavigationPositionUpdate)   [modern path, AA ≥ 1.7]

  handleMessage(msgId: number, payload: Buffer): void {
    switch (msgId) {
      case NAV_MSG.START_INDICATION:
        console.log('[NavigationChannel] START')
        this.emit('nav-start')
        break

      case NAV_MSG.STOP_INDICATION:
        console.log('[NavigationChannel] STOP')
        this.emit('nav-stop')
        break

      case NAV_MSG.STATUS: {
        const s = this._decodeStatus(payload)
        console.log(`[NavigationChannel] status=${s.state}`)
        this.emit('nav-status', s)
        break
      }

      case NAV_MSG.TURN_EVENT: {
        const t = this._decodeTurnEvent(payload)
        console.log(
          `[NavigationChannel] turn road=${JSON.stringify(t.road)} event=${t.event}` +
            ` side=${t.turnSide} angle=${t.turnAngle} image=${t.image ? `${t.image.length}B` : 'none'}`
        )
        this.emit('nav-turn', t)
        break
      }

      case NAV_MSG.DISTANCE_EVENT: {
        const d = this._decodeDistanceEvent(payload)
        console.log(
          `[NavigationChannel] distance ${d.distanceMeters}m t=${d.timeToTurnSeconds}s` +
            ` display=${d.displayDistanceE3}/${d.displayUnit}`
        )
        this.emit('nav-distance', d)
        break
      }

      case NAV_MSG.STATE: {
        // Modern API (AA protocol ≥ 1.7): current step (maneuver/road/cue) + destination.
        const s = this._decodeState(payload)
        console.log(
          `[NavigationChannel] state maneuver=${s.maneuverType} road=${JSON.stringify(s.roadName)}` +
            ` dest=${JSON.stringify(s.destinationAddress)}`
        )
        this.emit('nav-state', s)
        break
      }

      case NAV_MSG.CURRENT_POSITION: {
        // Modern API: distance/time to the next step AND to the destination (+ ETA clock).
        const p = this._decodePosition(payload)
        console.log(
          `[NavigationChannel] position dest=${p.destinationMeters}m eta=${p.etaText}` +
            ` ttarr=${p.timeToArrivalSeconds}s step=${p.stepDistanceMeters}m`
        )
        this.emit('nav-position', p)
        break
      }

      default:
        console.log(
          `[NavigationChannel] unhandled msgId=0x${msgId.toString(16)} len=${payload.length}`
        )
    }
  }

  private _decodeStatus(payload: Buffer): NavigationStatusUpdate {
    let raw = 0
    for (const f of decodeFields(payload)) {
      if (f.field === 1 && f.wire === 0) raw = decodeVarintValue(f.bytes)
    }
    const state: NavigationState =
      raw === 1 ? 'active' : raw === 2 ? 'inactive' : raw === 3 ? 'rerouting' : 'unavailable'
    return { state }
  }

  private _decodeTurnEvent(payload: Buffer): NavigationTurnUpdate {
    const out: NavigationTurnUpdate = {}
    for (const f of decodeFields(payload)) {
      switch (f.field) {
        case 1: // road (required string)
          out.road = f.bytes.toString('utf8')
          break
        case 2: {
          // turn_side (TurnSide enum: 1=LEFT, 2=RIGHT, 3=UNSPECIFIED)
          const v = decodeVarintValue(f.bytes)
          out.turnSide = v === 1 ? 'left' : v === 2 ? 'right' : 'unspecified'
          break
        }
        case 3: // event (NextTurnEnum)
          out.event = mapNextTurnEnum(decodeVarintValue(f.bytes))
          break
        case 4: // image (bytes)
          out.image = Buffer.from(f.bytes)
          break
        case 5: // turn_number
          out.turnNumber = decodeVarintValue(f.bytes)
          break
        case 6: // turn_angle
          out.turnAngle = decodeVarintValue(f.bytes)
          break
      }
    }
    return out
  }

  private _decodeDistanceEvent(payload: Buffer): NavigationDistanceUpdate {
    let distanceMeters = 0
    let timeToTurnSeconds = 0
    let displayDistanceE3: number | undefined
    let displayUnit: number | undefined
    for (const f of decodeFields(payload)) {
      switch (f.field) {
        case 1:
          distanceMeters = decodeVarintValue(f.bytes)
          break
        case 2:
          timeToTurnSeconds = decodeVarintValue(f.bytes)
          break
        case 3:
          displayDistanceE3 = decodeVarintValue(f.bytes)
          break
        case 4:
          displayUnit = decodeVarintValue(f.bytes)
          break
      }
    }
    return { distanceMeters, timeToTurnSeconds, displayDistanceE3, displayUnit }
  }

  // NavigationState { steps=1 (NavigationStep), destinations=2 (NavigationDestination) }
  private _decodeState(payload: Buffer): NavigationStateUpdate {
    const out: NavigationStateUpdate = {}
    for (const f of decodeFields(payload)) {
      if (f.field === 1 && f.wire === 2 && out.maneuverType === undefined && !out.roadName) {
        // first NavigationStep { maneuver=1, road=2, lanes=3, cue=4 }
        for (const s of decodeFields(f.bytes)) {
          if (s.field === 1 && s.wire === 2) {
            // NavigationManeuver { type=1 }
            for (const m of decodeFields(s.bytes)) {
              if (m.field === 1 && m.wire === 0) out.maneuverType = decodeVarintValue(m.bytes)
            }
          } else if (s.field === 2 && s.wire === 2) {
            // NavigationRoad { name=1 }
            for (const r of decodeFields(s.bytes)) {
              if (r.field === 1 && r.wire === 2) out.roadName = r.bytes.toString('utf8')
            }
          } else if (s.field === 4 && s.wire === 2 && out.cue === undefined) {
            // NavigationCue { alternate_text=1 (repeated) } — take the first
            for (const c of decodeFields(s.bytes)) {
              if (c.field === 1 && c.wire === 2 && out.cue === undefined) {
                out.cue = c.bytes.toString('utf8')
              }
            }
          }
        }
      } else if (f.field === 2 && f.wire === 2 && out.destinationAddress === undefined) {
        // first NavigationDestination { address=1 }
        for (const d of decodeFields(f.bytes)) {
          if (d.field === 1 && d.wire === 2) out.destinationAddress = d.bytes.toString('utf8')
        }
      }
    }
    return out
  }

  // NavigationCurrentPosition { step_distance=1, destination_distances=2, current_road=3 }
  private _decodePosition(payload: Buffer): NavigationPositionUpdate {
    const out: NavigationPositionUpdate = {}
    for (const f of decodeFields(payload)) {
      if (f.field === 1 && f.wire === 2) {
        // NavigationStepDistance { distance=1, time_to_step_seconds=2 }
        for (const s of decodeFields(f.bytes)) {
          if (s.field === 1 && s.wire === 2) {
            const d = decodeNavDistance(s.bytes)
            out.stepDistanceMeters = d.meters
            out.stepDistanceDisplay = d.display
          } else if (s.field === 2 && s.wire === 0) {
            out.timeToStepSeconds = decodeVarintValue(s.bytes)
          }
        }
      } else if (f.field === 2 && f.wire === 2 && out.destinationMeters === undefined) {
        // first NavigationDestinationDistance { distance=1, eta=2, time_to_arrival=3 }
        for (const dd of decodeFields(f.bytes)) {
          if (dd.field === 1 && dd.wire === 2) {
            const d = decodeNavDistance(dd.bytes)
            out.destinationMeters = d.meters
            out.destinationDisplay = d.display
            out.destinationUnits = d.units
          } else if (dd.field === 2 && dd.wire === 2) {
            out.etaText = dd.bytes.toString('utf8')
          } else if (dd.field === 3 && dd.wire === 0) {
            out.timeToArrivalSeconds = decodeVarintValue(dd.bytes)
          }
        }
      } else if (f.field === 3 && f.wire === 2) {
        // NavigationRoad { name=1 }
        for (const r of decodeFields(f.bytes)) {
          if (r.field === 1 && r.wire === 2) out.currentRoadName = r.bytes.toString('utf8')
        }
      }
    }
    return out
  }
}

// NavigationDistance { meters=1, display_value=2, display_units=3 }
function decodeNavDistance(b: Buffer): { meters?: number; display?: string; units?: number } {
  const out: { meters?: number; display?: string; units?: number } = {}
  for (const f of decodeFields(b)) {
    if (f.field === 1 && f.wire === 0) out.meters = decodeVarintValue(f.bytes)
    else if (f.field === 2 && f.wire === 2) out.display = f.bytes.toString('utf8')
    else if (f.field === 3 && f.wire === 0) out.units = decodeVarintValue(f.bytes)
  }
  return out
}

function mapNextTurnEnum(v: number): NavigationTurnEvent {
  switch (v) {
    case 1:
      return 'depart'
    case 2:
      return 'name-change'
    case 3:
      return 'slight-turn'
    case 4:
      return 'turn'
    case 5:
      return 'sharp-turn'
    case 6:
      return 'u-turn'
    case 7:
      return 'on-ramp'
    case 8:
      return 'off-ramp'
    case 9:
      return 'fork'
    case 10:
      return 'merge'
    case 11:
      return 'roundabout-enter'
    case 12:
      return 'roundabout-exit'
    case 13:
      return 'roundabout-enter-and-exit'
    case 14:
      return 'straight'
    case 16:
      return 'ferry-boat'
    case 17:
      return 'ferry-train'
    case 19:
      return 'destination'
    default:
      return 'unknown'
  }
}
