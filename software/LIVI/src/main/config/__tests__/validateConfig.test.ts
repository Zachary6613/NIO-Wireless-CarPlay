import { validate } from '@main/config/validateConfig'

describe('validate', () => {
  test('fills missing values with defaults', () => {
    const schema = {
      width: 800,
      flags: { kiosk: true, language: 'en' },
      list: [] as string[]
    }

    const result = validate({}, schema)

    expect(result).toEqual(schema)
  })

  test('keeps values with matching types and falls back when types mismatch', () => {
    const schema = {
      width: 800,
      title: 'LIVI',
      flags: { kiosk: true },
      list: [] as string[]
    }

    const input = {
      width: 1024,
      title: 123,
      flags: { kiosk: false },
      list: 'not-array'
    }

    const result = validate(input, schema)

    expect(result).toEqual({
      width: 1024,
      title: 'LIVI',
      flags: { kiosk: false },
      list: []
    })
  })

  test('uses empty object as source when input is not an object', () => {
    const schema = {
      width: 800,
      title: 'LIVI'
    }

    expect(validate(null, schema)).toEqual(schema)
    expect(validate('invalid', schema)).toEqual(schema)
  })

  test('keeps array value when schema default and input value are both arrays', () => {
    const schema = {
      list: [] as string[]
    }

    const result = validate(
      {
        list: ['a', 'b', 'c']
      },
      schema
    )

    expect(result).toEqual({
      list: ['a', 'b', 'c']
    })
  })
})
