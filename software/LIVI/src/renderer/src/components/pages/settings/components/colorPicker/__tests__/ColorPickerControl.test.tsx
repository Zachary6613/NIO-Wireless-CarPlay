import { fireEvent, render, screen } from '@testing-library/react'
import { ColorPickerControl } from '../ColorPickerControl'
import { defaultColorForPath } from '../colorUtils'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => `t:${k}` })
}))

let capturedSliders: any[] = []

vi.mock('@mui/material', async () => {
  const actual = await vi.importActual('@mui/material')
  return {
    ...actual,
    Slider: (props: any) => {
      capturedSliders.push(props)
      return (
        <input
          data-testid="slider"
          type="range"
          value={props.value}
          onChange={(e) => {
            const next = Number(e.currentTarget.value)
            props.onChange?.(e, next)
          }}
        />
      )
    },
    IconButton: ({ onClick, disabled, children }: any) => (
      <button data-testid="reset" disabled={disabled} onClick={onClick}>
        {children}
      </button>
    )
  }
})

const colorNode = { type: 'color', label: 'Primary', path: 'primaryColorDark' } as any

describe('ColorPickerControl', () => {
  beforeEach(() => {
    capturedSliders = []
  })

  test('shows the default color when no custom value is set', () => {
    render(<ColorPickerControl node={colorNode} value={null} onChange={vi.fn()} />)

    expect(
      screen.getByDisplayValue(defaultColorForPath('primaryColorDark').toUpperCase())
    ).toBeInTheDocument()
    expect(screen.getByTestId('reset')).toBeDisabled()
  })

  test('shows an uppercased custom hex and enables reset', () => {
    render(<ColorPickerControl node={colorNode} value="#abcdef" onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('#ABCDEF')).toBeInTheDocument()
    expect(screen.getByTestId('reset')).not.toBeDisabled()
  })

  test('previews on drag without committing and commits on release', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#ff0000" onChange={onChange} />)

    const hueSlider = capturedSliders[0]
    hueSlider.onChange({}, 200)
    expect(onChange).not.toHaveBeenCalled()

    hueSlider.onChangeCommitted({}, 200)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('commits saturation and lightness rows', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#3366cc" onChange={onChange} />)

    capturedSliders[1].onChangeCommitted({}, 50)
    capturedSliders[2].onChangeCommitted({}, 40)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  test('reset clears the custom value', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#112233" onChange={onChange} />)

    fireEvent.click(screen.getByTestId('reset'))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  test('syncs local state when the incoming value changes externally', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorPickerControl node={colorNode} value="#111111" onChange={onChange} />
    )
    expect(screen.getByDisplayValue('#111111')).toBeInTheDocument()

    rerender(<ColorPickerControl node={colorNode} value="#222222" onChange={onChange} />)
    expect(screen.getByDisplayValue('#222222')).toBeInTheDocument()
  })

  test('keeps the local draft when the committed value echoes back', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ColorPickerControl node={colorNode} value="#ff0000" onChange={onChange} />
    )

    capturedSliders[0].onChangeCommitted({}, 120)
    const committed = onChange.mock.calls[0][0] as string

    rerender(<ColorPickerControl node={colorNode} value={committed} onChange={onChange} />)
    expect(screen.getByDisplayValue(committed.toUpperCase())).toBeInTheDocument()
  })

  test('a typed hex is emitted verbatim, not rounded through HSL', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#000000" onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '#3a7bd5' } })
    expect(onChange).toHaveBeenCalledWith('#3a7bd5')
  })

  test('accepts a hex without the leading hash and normalises it', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#000000" onChange={onChange} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ABCDEF' } })
    expect(onChange).toHaveBeenCalledWith('#abcdef')
  })

  test('a half-typed hex commits nothing', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#000000" onChange={onChange} />)

    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: '#3a7' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue('#3a7')
  })

  test('an invalid draft is dropped on blur', () => {
    const onChange = vi.fn()
    render(<ColorPickerControl node={colorNode} value="#112233" onChange={onChange} />)

    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'zzz' } })
    fireEvent.blur(field)
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue('#112233')
  })

  test('typing moves the sliders with the colour', () => {
    render(<ColorPickerControl node={colorNode} value="#000000" onChange={vi.fn()} />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '#ff0000' } })
    expect(capturedSliders.at(-3).value).toBe(0) // hue
    expect(capturedSliders.at(-2).value).toBe(100) // saturation
    expect(capturedSliders.at(-1).value).toBe(50) // lightness
  })

  test('Enter leaves the field', () => {
    render(<ColorPickerControl node={colorNode} value="#112233" onChange={vi.fn()} />)

    const field = screen.getByRole('textbox')
    field.focus()
    fireEvent.keyDown(field, { key: 'a' })
    expect(field).toHaveFocus()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(field).not.toHaveFocus()
  })

  test('falls back to the default color for a node without a path', () => {
    const pathlessNode = { type: 'color', label: 'X' } as any
    render(<ColorPickerControl node={pathlessNode} value="   " onChange={vi.fn()} />)

    expect(
      screen.getByDisplayValue(defaultColorForPath(undefined).toUpperCase())
    ).toBeInTheDocument()
  })
})
