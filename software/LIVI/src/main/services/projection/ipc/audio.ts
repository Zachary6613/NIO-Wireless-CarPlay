import { registerIpcOn } from '@main/ipc/register'
import type { LogicalStreamKey } from '../services/ProjectionAudio'
import type { ProjectionIpcHost } from './types'

type Deps = Pick<ProjectionIpcHost, 'setAudioStreamVolume' | 'setAudioVisualizerEnabled'>

export function registerAudioIpc(host: Deps): void {
  const tracked = new Set<number>()

  registerIpcOn(
    'projection-set-volume',
    (_evt, payload: { stream: LogicalStreamKey; volume: number }) => {
      const { stream, volume } = payload || {}
      host.setAudioStreamVolume(stream, volume)
    }
  )

  registerIpcOn('projection-set-visualizer-enabled', (evt, enabled: boolean) => {
    const id = evt?.sender?.id
    host.setAudioVisualizerEnabled(Boolean(enabled), id)

    if (enabled && id != null && typeof evt?.sender?.once === 'function' && !tracked.has(id)) {
      tracked.add(id)
      evt.sender.once('destroyed', () => {
        tracked.delete(id)
        host.setAudioVisualizerEnabled(false, id)
      })
    }
  })
}
