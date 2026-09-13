import * as messages from '@main/services/projection/messages'

describe('messages barrel export', () => {
  test('exports expected members', () => {
    expect(messages.Message).toBeDefined()
    expect(messages.SendableMessage).toBeDefined()
    expect((messages as Record<string, unknown>).DongleDriver).toBeUndefined()
    expect(messages.DEFAULT_CONFIG).toBeDefined()
    expect(messages.decodeTypeMap).toBeDefined()
  })

  test('no longer exports the dongle wire header types', () => {
    const barrel = messages as Record<string, unknown>
    expect(barrel.MessageHeader).toBeUndefined()
    expect(barrel.MessageType).toBeUndefined()
  })
})
