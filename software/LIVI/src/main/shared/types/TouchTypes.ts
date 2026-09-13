import type { MultiTouchAction } from './ProjectionEnums'

export type MultiTouchPoint = {
  x: number
  y: number
  action: MultiTouchAction
  id: number
}
