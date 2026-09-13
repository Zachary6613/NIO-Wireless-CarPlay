import { render, screen } from '@testing-library/react'
import { SettingsFieldPage } from '../SettingsFieldPage'

vi.mock('../SettingsFieldControl', () => ({
  SettingsFieldControl: () => <div data-testid="field-control" />
}))

describe('SettingsFieldPage', () => {
  test('renders the field control without the page description', () => {
    render(
      <SettingsFieldPage
        node={
          {
            type: 'string',
            path: 'name',
            label: 'Name',
            page: { labelDescription: 'settings.name.desc', description: 'plain desc' }
          } as any
        }
        value="x"
        onChange={vi.fn()}
      />
    )

    expect(screen.getByTestId('field-control')).toBeInTheDocument()
    expect(screen.queryByText('settings.name.desc')).toBeNull()
    expect(screen.queryByText('t:settings.name.desc')).toBeNull()
    expect(screen.queryByText('plain desc')).toBeNull()
  })
})
