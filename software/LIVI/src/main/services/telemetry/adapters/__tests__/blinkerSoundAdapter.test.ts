import { EventEmitter } from 'node:events'
import type { TelemetryStore } from '../../TelemetryStore'
import { attachBlinkerSound } from '../blinkerSoundAdapter'

function fakeStore(): TelemetryStore {
  return new EventEmitter() as unknown as TelemetryStore
}

const emitChange = (store: TelemetryStore, snapshot: Record<string, unknown>): void => {
  ;(store as unknown as EventEmitter).emit('change', {}, snapshot)
}

describe('attachBlinkerSound', () => {
  test('activates on left/right turn and on hazards, only on transitions', () => {
    const store = fakeStore()
    const setActive = vi.fn()
    attachBlinkerSound({ store, setActive })

    emitChange(store, { turn: 'left' })
    expect(setActive).toHaveBeenLastCalledWith(true)

    // no transition → no further call
    emitChange(store, { turn: 'right' })
    expect(setActive).toHaveBeenCalledTimes(1)

    emitChange(store, { turn: 'none' })
    expect(setActive).toHaveBeenLastCalledWith(false)

    emitChange(store, { hazards: true })
    expect(setActive).toHaveBeenLastCalledWith(true)
    expect(setActive).toHaveBeenCalledTimes(3)
  })

  test('swallows a throwing setActive', () => {
    const store = fakeStore()
    const setActive = vi.fn(() => {
      throw new Error('audio dead')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    attachBlinkerSound({ store, setActive })
    expect(() => emitChange(store, { turn: 'left' })).not.toThrow()
    expect(warn).toHaveBeenCalled()

    warn.mockRestore()
  })

  test('detach removes the listener and turns the relay off when it was active', () => {
    const store = fakeStore()
    const setActive = vi.fn()
    const detach = attachBlinkerSound({ store, setActive })

    emitChange(store, { turn: 'left' })
    expect(setActive).toHaveBeenLastCalledWith(true)

    detach()
    expect(setActive).toHaveBeenLastCalledWith(false)

    // listener gone → no more reactions
    setActive.mockClear()
    emitChange(store, { turn: 'right' })
    expect(setActive).not.toHaveBeenCalled()
  })

  test('detach does not turn off when it was already inactive', () => {
    const store = fakeStore()
    const setActive = vi.fn()
    const detach = attachBlinkerSound({ store, setActive })

    detach()
    expect(setActive).not.toHaveBeenCalled()
  })

  test('detach swallows a throwing setActive', () => {
    const store = fakeStore()
    const setActive = vi.fn()
    const detach = attachBlinkerSound({ store, setActive })

    emitChange(store, { turn: 'left' })
    setActive.mockImplementation(() => {
      throw new Error('audio dead')
    })
    expect(() => detach()).not.toThrow()
  })
})
