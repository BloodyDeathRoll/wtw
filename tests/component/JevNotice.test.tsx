import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import JevNotice from '@/app/components/JevNotice'

// The dev-only banner: says how many times Jev failed and the last error,
// and "Got it" marks seen up to the newest failure SHOWN (not "now").

const failures = [
  { at: '2026-11-05T12:00:00.000Z', where: 'rerank', error: 'Jev request failed (402): payment required' },
  { at: '2026-11-05T11:00:00.000Z', where: 'rerank', error: 'Jev request failed (503)' },
]

afterEach(() => { vi.unstubAllGlobals() })

describe('JevNotice', () => {
  it('renders nothing with no failures', () => {
    const { container } = render(<JevNotice failures={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count and the newest error', () => {
    render(<JevNotice failures={failures} />)
    expect(screen.getByRole('status')).toHaveTextContent('Jev failed 2 times')
    expect(screen.getByRole('status')).toHaveTextContent('payment required')
    expect(screen.getByRole('status')).not.toHaveTextContent('(503)')
  })

  it('says "once" for a single failure', () => {
    render(<JevNotice failures={[failures[1]]} />)
    expect(screen.getByRole('status')).toHaveTextContent('Jev failed once')
  })

  it('"Got it" hides the banner and marks seen at the newest failure shown', () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<JevNotice failures={failures} />)

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))

    expect(screen.queryByRole('status')).toBeNull()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/jev-failures')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ at: '2026-11-05T12:00:00.000Z' })
  })

  it('a failed dismiss call does not throw or bring the banner back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    render(<JevNotice failures={failures} />)
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await Promise.resolve()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
