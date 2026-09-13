import { createTheme, ThemeProvider } from '@mui/material'
import { CarType } from '@shared/types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DashFrame } from '../DashFrame'

const useVehicleTelemetryMock = vi.fn()
const setClusterDashActive = vi.fn()
let carType: unknown

vi.mock('../../../hooks/useVehicleTelemetry', () => ({
  useVehicleTelemetry: () => useVehicleTelemetryMock()
}))

vi.mock('../../../components/DashShell', () => ({
  DashShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@store/store', () => ({
  useLiviStore: (selector: (s: { settings: { carType: unknown } }) => unknown) =>
    selector({ settings: { carType } }),
  useStatusStore: (selector: (s: { setClusterDashActive: unknown }) => unknown) =>
    selector({ setClusterDashActive })
}))

vi.mock('../../../widgets', () => ({
  GaugeArc: ({ value, shadow }: { value: number; shadow?: boolean }) => (
    <div>{`Gauge:${value}:${shadow}`}</div>
  ),
  FuelGauge: ({ level, mode }: { level: number; mode: string }) => (
    <div>{`Fuel:${mode}:${level}`}</div>
  ),
  TempGauge: ({ value }: { value: number }) => <div>{`Temp:${value}`}</div>,
  SoftReadout: ({
    value,
    label,
    backdropColor
  }: {
    value: string | number
    label: string
    backdropColor?: string
  }) => <div>{`Soft:${label}:${value}:${backdropColor}`}</div>,
  normalizeGear: (g: string | number) => String(g),
  TelltaleBar: ({
    turn,
    hazards,
    lights,
    highBeam,
    parkingBrake,
    ambientC
  }: {
    turn: string
    hazards: boolean
    lights: boolean
    highBeam: boolean
    parkingBrake: boolean
    ambientC?: number
  }) => <div>{`Telltale:${turn}:${hazards}:${lights}:${highBeam}:${parkingBrake}:${ambientC}`}</div>
}))

describe('DashFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    carType = undefined

    useVehicleTelemetryMock.mockReturnValue({ telemetry: {} })
  })

  test('renders the full-cluster frame and toggles the cluster-dash flag', () => {
    carType = CarType.Electric
    useVehicleTelemetryMock.mockReturnValue({
      telemetry: {
        speedKph: 88,
        rpm: 2200,
        gear: 'D',
        turn: 'left',
        hazards: true,
        lights: true,
        highBeam: true,
        parkingBrake: true,
        ambientC: 15,
        fuelPct: 40,
        oilC: 95
      }
    })

    const { unmount } = render(<DashFrame clusterFull />)

    expect(setClusterDashActive).toHaveBeenCalledWith(true)
    expect(screen.getByText('Fuel:battery:40')).toBeInTheDocument()
    expect(screen.getByText('Gauge:88:true')).toBeInTheDocument()
    expect(screen.getByText('Soft:KPH:88:rgba(255, 255, 255, 0.78)')).toBeInTheDocument()
    expect(screen.getByText('Telltale:left:true:true:true:true:15')).toBeInTheDocument()

    unmount()

    expect(setClusterDashActive).toHaveBeenLastCalledWith(false)
  })

  test('renders the plain frame with fallbacks when telemetry is empty', () => {
    render(<DashFrame />)

    expect(setClusterDashActive).not.toHaveBeenCalled()
    expect(screen.getByText('Fuel:fuel:0')).toBeInTheDocument()
    expect(screen.getByText('Soft:KPH:0:undefined')).toBeInTheDocument()
    expect(screen.getAllByText('Gauge:0:undefined')).toHaveLength(2)
    expect(screen.getByText('Telltale:none:false:false:false:false:undefined')).toBeInTheDocument()
  })

  test('forwards a right turn signal', () => {
    useVehicleTelemetryMock.mockReturnValue({ telemetry: { turn: 'right' } })

    render(<DashFrame />)

    expect(screen.getByText('Telltale:right:false:false:false:false:undefined')).toBeInTheDocument()
  })

  test('derives the stage scale from the window at first render', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 })
    try {
      const { container } = render(<DashFrame />)

      const stage = Array.from(container.querySelectorAll('div')).find((d) =>
        window.getComputedStyle(d).transform.includes('scale(0.5)')
      )
      expect(stage).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    }
  })

  test('rescales on a settled window resize, collapses blips and cancels on unmount', () => {
    vi.useFakeTimers()
    try {
      const { container, unmount } = render(<DashFrame />)

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1278 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 })
      fireEvent(window, new Event('resize'))
      act(() => {
        vi.advanceTimersByTime(50)
      })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
      fireEvent(window, new Event('resize'))
      act(() => {
        vi.advanceTimersByTime(150)
      })

      const stage = Array.from(container.querySelectorAll('div')).find((d) =>
        window.getComputedStyle(d).transform.includes('scale(1)')
      )
      expect(stage).toBeTruthy()

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 })
      fireEvent(window, new Event('resize'))
      act(() => {
        vi.advanceTimersByTime(150)
      })

      const fallback = Array.from(container.querySelectorAll('div')).find((d) =>
        window.getComputedStyle(d).transform.includes('scale(1)')
      )
      expect(fallback).toBeTruthy()

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 360 })
      fireEvent(window, new Event('resize'))
      unmount()
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(container.firstChild).toBeNull()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
      vi.useRealTimers()
    }
  })

  test('renders under a dark theme', () => {
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <DashFrame clusterFull />
      </ThemeProvider>
    )

    expect(screen.getAllByText('Gauge:0:true')).toHaveLength(2)
  })
})
