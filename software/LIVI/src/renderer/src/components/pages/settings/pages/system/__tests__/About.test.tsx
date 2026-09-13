import { render, screen } from '@testing-library/react'
import { About } from '../About'
;(globalThis as any).__BUILD_RUN__ = '123'
;(globalThis as any).__BUILD_SHA__ = 'abcdef0'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: string) => fb ?? key
  })
}))

describe('About page', () => {
  test('renders package metadata rows', () => {
    render(<About />)

    expect(screen.getByText('settings.name')).toBeInTheDocument()
    expect(screen.queryByText('settings.description')).not.toBeInTheDocument()
    expect(screen.getByText('settings.version')).toBeInTheDocument()
    expect(screen.queryByText('Commit')).not.toBeInTheDocument()
    expect(screen.getByText('#123 - abcdef0')).toBeInTheDocument()
    expect(screen.getByText('settings.url')).toBeInTheDocument()
    expect(screen.getByText('settings.author')).toBeInTheDocument()
    expect(screen.getByText('settings.contributors')).toBeInTheDocument()

    const nameLabel = screen.getByText('settings.name')
    expect(nameLabel.nextSibling?.textContent).toBe('A test')
    expect(screen.queryByText('test-app')).not.toBeInTheDocument()
    expect(screen.getByText((v) => /^\d+\.\d+\.\d+/.test(v))).toBeInTheDocument()
  })

  test('renders author and contributors rows with values', () => {
    render(<About />)

    const authorLabel = screen.getByText('settings.author')
    const contributorsLabel = screen.getByText('settings.contributors')

    expect(authorLabel.nextSibling).toBeInTheDocument()
    expect(contributorsLabel.nextSibling).toBeInTheDocument()
    expect(authorLabel.nextSibling?.textContent).not.toBe('')
    expect(contributorsLabel.nextSibling?.textContent).not.toBe('')
  })
})

// Test the helper functions via a mock of package.json
vi.mock(
  '@pkg',
  () => ({
    name: 'test-app',
    version: '9.9.9',
    description: 'A test',
    homepage: 'https://example.com',
    author: { name: 'Jane', email: 'jane@example.com', url: 'https://jane.dev' },
    contributors: [{ name: 'Alice', email: 'alice@example.com' }, 'Bob']
  }),
  { virtual: false }
)

describe('About page with object author and contributors', () => {
  test('renders object author as formatted string (name email url)', () => {
    render(<About />)

    const authorLabel = screen.getByText('settings.author')
    expect(authorLabel.nextSibling?.textContent).toContain('Jane')
    expect(authorLabel.nextSibling?.textContent).toContain('jane@example.com')
  })

  test('renders contributor objects and strings from array', () => {
    render(<About />)

    const contribLabel = screen.getByText('settings.contributors')
    expect(contribLabel.nextSibling?.textContent).toContain('Alice')
    expect(contribLabel.nextSibling?.textContent).toContain('Bob')
  })
})

const pkgPath = '@pkg'

const renderWith = async (pkg: Record<string, unknown>, run: unknown, sha: unknown) => {
  vi.resetModules()
  vi.doMock(pkgPath, () => pkg)
  ;(globalThis as any).__BUILD_RUN__ = run
  ;(globalThis as any).__BUILD_SHA__ = sha
  const mod = await import('../About')
  return render(<mod.About />)
}

describe('About page metadata edge cases', () => {
  test('handles string author, blank/null/number/object fields and non-array contributors', async () => {
    await renderWith(
      {
        name: '   ',
        description: null,
        version: 5,
        homepage: { x: 1 },
        author: 'Solo',
        contributors: 'not-an-array'
      },
      '',
      ''
    )

    expect(screen.getByText('5')).toBeInTheDocument()

    const authorLabel = screen.getByText('settings.author')
    expect(authorLabel.nextSibling?.textContent).toBe('Solo')

    const contribLabel = screen.getByText('settings.contributors')
    expect(contribLabel.nextSibling?.textContent).toBe('—')
  })

  test('renders blank for empty person author and nameless contributors', async () => {
    await renderWith(
      {
        name: 'App',
        description: 'Desc',
        version: '1.0.0',
        homepage: 'https://h',
        author: {},
        contributors: [{ email: 'e@x.dev' }, 7]
      },
      '9',
      'abc1234'
    )

    const authorLabel = screen.getByText('settings.author')
    expect(authorLabel.nextSibling?.textContent).toBe('—')

    const contribLabel = screen.getByText('settings.contributors')
    expect(contribLabel.nextSibling?.textContent).toBe('—')

    expect(screen.getByText('#9 - abc1234')).toBeInTheDocument()
  })

  test('renders blank author and commit dev when metadata is missing', async () => {
    await renderWith(
      {
        name: 'App',
        description: 'D',
        version: '1',
        homepage: '   ',
        author: null,
        contributors: []
      },
      undefined,
      undefined
    )

    const authorLabel = screen.getByText('settings.author')
    expect(authorLabel.nextSibling?.textContent).toBe('—')

    const contribLabel = screen.getByText('settings.contributors')
    expect(contribLabel.nextSibling?.textContent).toBe('—')

    expect(screen.getByText('dev')).toBeInTheDocument()
  })
})
